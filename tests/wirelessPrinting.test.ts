/**
 * Printing without a cable: Bluetooth and network.
 *
 * Three things can be pinned down on a development machine with no printer
 * attached, and they are the three that actually go wrong:
 *
 *   1. **Address parsing.** A network printer is configured by typing an
 *      address, which means a typo becomes a receipt that never prints. The
 *      parser has to accept what people type and reject what is not an address
 *      — including a print queue name, which is the ambiguous case.
 *   2. **Which transports a machine can use.** Chrome OS cannot do Bluetooth
 *      and cannot use a print driver. Offering either would produce a setting
 *      that saves cleanly and then fails silently at the counter.
 *   3. **Settings validation.** Switching to network printing without an
 *      address, or picking a mode this machine cannot use, must be refused
 *      where the admin can see it rather than at the till.
 *
 * What cannot be checked here is the last hop in either case: a real RFCOMM
 * link to a real printer, and a real socket to one. Both need hardware.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { freshDb, teardown, actAs } from './helpers'
import {
  DEFAULT_PORT,
  formatTarget,
  isNetworkTarget,
  localSubnets,
  parseTarget
} from '../src/main/printer/networkPrinter'
import { BAUD_RATES, DEFAULT_BAUD, isBluetoothPort, isSerialPort } from '../src/main/printer/serialPort'
import { getPrinterSettings, updatePrinterSettings } from '../src/main/services/printer'

/* ------------------------- network address parsing ------------------------ */

describe('a network printer address is whatever someone can reasonably type', () => {
  it('accepts a bare IP address and assumes the standard raw-printing port', () => {
    expect(parseTarget('192.168.1.50')).toEqual({ host: '192.168.1.50', port: 9100 })
    expect(DEFAULT_PORT).toBe(9100)
  })

  it('accepts an explicit port', () => {
    expect(parseTarget('192.168.1.50:9100')).toEqual({ host: '192.168.1.50', port: 9100 })
    expect(parseTarget('10.0.0.7:9101')).toEqual({ host: '10.0.0.7', port: 9101 })
  })

  it('accepts a hostname, which is how a printer on a managed network is reached', () => {
    expect(parseTarget('printer.local')).toEqual({ host: 'printer.local', port: 9100 })
    expect(parseTarget('till-printer:9100')?.host).toBe('till-printer')
  })

  it('tolerates the whitespace that comes with copy and paste', () => {
    expect(parseTarget('  192.168.1.50  ')).toEqual({ host: '192.168.1.50', port: 9100 })
  })
})

describe('an address that is not an address is rejected, not guessed at', () => {
  it('rejects a print queue name — the case that would otherwise be ambiguous', () => {
    // A bare word could be a hostname, but it is far more likely to be someone
    // typing the printer's name, so it is refused rather than silently used.
    expect(parseTarget('XP-80C')).toBeNull()
    expect(parseTarget('Black Copper BC-85AC')).toBeNull()
  })

  it('rejects a USB device node, so the modes cannot be confused', () => {
    expect(parseTarget('/dev/usb/lp0')).toBeNull()
    expect(parseTarget('/dev/rfcomm0')).toBeNull()
  })

  it('rejects nothing at all', () => {
    for (const v of ['', '   ', null, undefined]) expect(parseTarget(v)).toBeNull()
  })

  it('rejects impossible numbers rather than truncating them', () => {
    expect(parseTarget('192.168.1.999')).toBeNull()
    expect(parseTarget('192.168.1.50:70000')).toBeNull()
    expect(parseTarget('192.168.1.50:0')).toBeNull()
  })

  it('agrees with isNetworkTarget, so the mode dispatch cannot disagree with the parser', () => {
    for (const v of ['192.168.1.50', '192.168.1.50:9100', 'printer.local']) {
      expect(isNetworkTarget(v)).toBe(true)
      expect(parseTarget(v)).not.toBeNull()
    }
    for (const v of ['XP-80C', '/dev/usb/lp0', 'COM3', '']) {
      expect(isNetworkTarget(v)).toBe(false)
      expect(parseTarget(v)).toBeNull()
    }
  })
})

describe('formatting an address back for display', () => {
  it('hides the port when it is the standard one, and shows it when it is not', () => {
    expect(formatTarget({ host: '192.168.1.50', port: 9100 })).toBe('192.168.1.50')
    expect(formatTarget({ host: '192.168.1.50', port: 9101 })).toBe('192.168.1.50:9101')
  })

  it('round-trips, so a saved address is the one that was typed', () => {
    for (const v of ['192.168.1.50', '192.168.1.50:9101', 'printer.local']) {
      expect(formatTarget(parseTarget(v)!)).toBe(v)
    }
  })
})

describe('the subnets a scan would cover', () => {
  it('only ever offers /24 networks, and never a loopback address', () => {
    // Scanning anything larger than a /24 is not something to do on a button
    // press; this asserts the restriction rather than the machine's own IPs.
    for (const prefix of localSubnets()) {
      expect(prefix).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/)
      expect(prefix).not.toBe('127.0.0')
    }
  })
})

/* --------------------------- serial port naming --------------------------- */

describe('telling a serial port from everything else a printer can be called', () => {
  it('recognises the port names each operating system creates for Bluetooth', () => {
    for (const n of ['COM3', 'COM12', '/dev/rfcomm0', '/dev/cu.RPP02N', '/dev/tty.Printer']) {
      expect(isSerialPort(n)).toBe(true)
    }
  })

  it('recognises a wired serial printer on the same transport', () => {
    for (const n of ['/dev/ttyUSB0', '/dev/ttyACM0']) expect(isSerialPort(n)).toBe(true)
  })

  it('does not mistake a USB printer node or a queue name for a serial port', () => {
    for (const n of ['/dev/usb/lp0', '/dev/lp0', 'XP-80C', '192.168.1.50', '', null, undefined]) {
      expect(isSerialPort(n)).toBe(false)
    }
  })

  it('separates a Bluetooth link from a cable, because the failure advice differs', () => {
    expect(isBluetoothPort('/dev/rfcomm0')).toBe(true)
    expect(isBluetoothPort('/dev/cu.RPP02N')).toBe(true)
    // A cable: "check the cable", not "re-pair the printer".
    expect(isBluetoothPort('/dev/ttyUSB0')).toBe(false)
    expect(isBluetoothPort('/dev/usb/lp0')).toBe(false)
  })
})

/* ---------------------- which modes a machine can use --------------------- */

describe('mode availability per host', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  const loadModes = async (chromeOs: boolean): Promise<typeof import('../src/main/printer/modes')> => {
    vi.resetModules()
    vi.doMock('../src/main/platform', () => ({ isChromeOsContainer: () => chromeOs }))
    return import('../src/main/printer/modes')
  }

  it('on Chrome OS, neither the driver nor Bluetooth is offered', async () => {
    const { modeAvailability } = await loadModes(true)
    const byMode = new Map(modeAvailability().map((m) => [m.mode, m]))

    expect(byMode.get('SYSTEM')!.available).toBe(false)
    expect(byMode.get('ESCPOS_BLUETOOTH')!.available).toBe(false)
    // And the wireless option that does work is available.
    expect(byMode.get('ESCPOS_NETWORK')!.available).toBe(true)
    expect(byMode.get('ESCPOS_RAW')!.available).toBe(true)
  })

  it('and each refusal explains itself, because "unavailable" alone is useless', async () => {
    const { modeAvailability } = await loadModes(true)
    const byMode = new Map(modeAvailability().map((m) => [m.mode, m]))

    expect(byMode.get('SYSTEM')!.reason).toMatch(/no print system/i)
    // The Bluetooth message has to say it is the platform, not a setup step,
    // and point at what to use instead.
    const bt = byMode.get('ESCPOS_BLUETOOTH')!.reason
    expect(bt).toMatch(/does not give its Linux container access to Bluetooth/i)
    expect(bt).toMatch(/USB|network/i)
  })

  it('every mode carries an availability entry, so the UI can never miss one', async () => {
    const { ALL_MODES, modeAvailability } = await loadModes(false)
    expect(modeAvailability().map((m) => m.mode).sort()).toEqual([...ALL_MODES].sort())
  })

  it('raw ESC/POS is available everywhere — it is the fallback the others rely on', async () => {
    for (const chromeOs of [true, false]) {
      const { isModeAvailable } = await loadModes(chromeOs)
      expect(isModeAvailable('ESCPOS_RAW')).toBe(true)
    }
  })
})

describe('bringing a stored mode forward to one that works here', () => {
  afterEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  const loadModes = async (chromeOs: boolean): Promise<typeof import('../src/main/printer/modes')> => {
    vi.resetModules()
    vi.doMock('../src/main/platform', () => ({ isChromeOsContainer: () => chromeOs }))
    return import('../src/main/printer/modes')
  }

  it('a Windows database restored onto a Chromebook does not keep a mode that cannot print', async () => {
    const { reconcileMode } = await loadModes(true)
    // This is the real scenario: back up on the Windows till, restore on the
    // Chromebook. SYSTEM would silently never print.
    expect(reconcileMode('SYSTEM')).toBe('ESCPOS_RAW')
    expect(reconcileMode('ESCPOS_BLUETOOTH')).toBe('ESCPOS_RAW')
  })

  it('but a mode that works is left exactly as it was', async () => {
    const { reconcileMode } = await loadModes(true)
    expect(reconcileMode('ESCPOS_NETWORK')).toBe('ESCPOS_NETWORK')
    expect(reconcileMode('ESCPOS_RAW')).toBe('ESCPOS_RAW')
  })

  it('an unrecognised or missing value falls back to the host default, not a crash', async () => {
    const { reconcileMode, defaultModeForHost } = await loadModes(false)
    for (const v of [undefined, null, '', 'ESCPOS_CARRIER_PIGEON', 42, {}]) {
      expect(reconcileMode(v)).toBe(defaultModeForHost())
    }
  })

  it('Chrome OS defaults to raw ESC/POS, so a fresh install can print over USB', async () => {
    const { defaultModeForHost } = await loadModes(true)
    expect(defaultModeForHost()).toBe('ESCPOS_RAW')
  })
})

/* ---------------------------- settings validation ------------------------- */

describe('configuring a network printer', () => {
  beforeEach(() => {
    freshDb()
    actAs('admin')
  })
  afterEach(teardown)

  it('refuses to switch to network printing with no address — the failure would otherwise show up at the till', async () => {
    await expect(updatePrinterSettings({ mode: 'ESCPOS_NETWORK' })).rejects.toThrow(/IP address/i)
    // and nothing was saved
    expect(getPrinterSettings().mode).not.toBe('ESCPOS_NETWORK')
  })

  it('refuses an address that is not an address, naming what was wrong', async () => {
    await expect(updatePrinterSettings({ networkAddress: 'the printer in the kitchen' })).rejects.toThrow(
      /not a printer address/i
    )
  })

  it('accepts a valid address and keeps it', async () => {
    // 127.0.0.1 so the reachability check fails instantly rather than waiting
    // for a timeout — this asserts the setting, not the printer.
    await updatePrinterSettings({ networkAddress: '127.0.0.1' })
    expect(getPrinterSettings().networkAddress).toBe('127.0.0.1')
  })

  it('treats a blank address as "no address", not as the string ""', async () => {
    await updatePrinterSettings({ networkAddress: '127.0.0.1' })
    await updatePrinterSettings({ networkAddress: '   ' })
    expect(getPrinterSettings().networkAddress).toBeNull()
  })

  it('keeps the address when the mode changes, so trying another transport does not lose it', async () => {
    await updatePrinterSettings({ networkAddress: '127.0.0.1', mode: 'ESCPOS_NETWORK' })
    // The whole reason networkAddress is its own field rather than reusing
    // selectedPrinter: switching away and back must not mean retyping it.
    await updatePrinterSettings({ mode: 'ESCPOS_RAW' })
    expect(getPrinterSettings().networkAddress).toBe('127.0.0.1')
    await updatePrinterSettings({ mode: 'ESCPOS_NETWORK' })
    expect(getPrinterSettings().mode).toBe('ESCPOS_NETWORK')
  })
})

describe('configuring the serial line speed', () => {
  beforeEach(() => {
    freshDb()
    actAs('admin')
  })
  afterEach(teardown)

  it('defaults to the speed nearly every thermal printer uses', () => {
    expect(getPrinterSettings().baudRate).toBe(DEFAULT_BAUD)
    expect(DEFAULT_BAUD).toBe(9600)
  })

  it('accepts the standard speeds', async () => {
    for (const baud of BAUD_RATES) {
      await updatePrinterSettings({ baudRate: baud })
      expect(getPrinterSettings().baudRate).toBe(baud)
    }
  })

  it('refuses a speed no printer has, listing the ones that work', async () => {
    await expect(updatePrinterSettings({ baudRate: 1234 })).rejects.toThrow(/9600/)
  })
})

describe('an unusable mode is refused where the admin can see it', () => {
  beforeEach(() => {
    freshDb()
    actAs('admin')
  })
  afterEach(teardown)

  it('rejects a mode outright rather than saving it', async () => {
    await expect(updatePrinterSettings({ mode: 'ESCPOS_TELEPATHY' as never })).rejects.toThrow(/invalid printer mode/i)
  })

  it('every mode this host reports as available can actually be selected', async () => {
    const { modeAvailability } = await import('../src/main/printer/modes')
    for (const m of modeAvailability()) {
      if (!m.available) continue
      // Network needs an address first; that is a separate rule, tested above.
      if (m.mode === 'ESCPOS_NETWORK') await updatePrinterSettings({ networkAddress: '127.0.0.1' })
      await updatePrinterSettings({ mode: m.mode })
      expect(getPrinterSettings().mode).toBe(m.mode)
    }
  })
})
