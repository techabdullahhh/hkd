/**
 * Running on Chrome OS.
 *
 * Chrome OS runs this app inside a Linux container (Crostini). Two things
 * differ from a Windows till and both can be checked here without a
 * Chromebook on the desk: how the printer is reached, and how the container
 * is recognised.
 *
 * What cannot be checked here is the last hop — writing to a real device
 * node on real hardware.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pickReceiptPrinter } from '../src/main/printer/paper'
import { isDeviceNode, PERMISSION_HINT } from '../src/main/printer/usbDevice'
import type { PrinterInfo } from '@shared/types'

const p = (name: string, opts: Partial<PrinterInfo> = {}): PrinterInfo => ({
  name,
  displayName: opts.displayName ?? name,
  description: '',
  status: opts.status ?? 0,
  isDefault: opts.isDefault ?? false
})

describe('choosing a printer on Chrome OS — the USB node wins', () => {
  it('prefers the device node over a CUPS queue, because Crostini has no spooler', () => {
    const picked = pickReceiptPrinter([p('Some-Queue', { isDefault: true }), p('/dev/usb/lp0')])
    expect(picked?.name).toBe('/dev/usb/lp0')
  })

  it('prefers the device node even over a printer whose name looks like a receipt printer', () => {
    const picked = pickReceiptPrinter([p('XP-80C'), p('/dev/usb/lp0')])
    expect(picked?.name).toBe('/dev/usb/lp0')
  })

  it('skips a node this user cannot write to and falls back to a working queue', () => {
    // status 1 = present but not writable (user not in the `lp` group)
    const picked = pickReceiptPrinter([p('/dev/usb/lp0', { status: 1 }), p('XP-80C')])
    expect(picked?.name).toBe('XP-80C')
  })

  it('still returns an unwritable node when it is the only thing there, so the UI can explain the fix', () => {
    const picked = pickReceiptPrinter([p('/dev/usb/lp0', { status: 1 })])
    expect(picked?.name).toBe('/dev/usb/lp0')
  })

  it('picks the first writable node when several are present', () => {
    const picked = pickReceiptPrinter([p('/dev/usb/lp0', { status: 1 }), p('/dev/usb/lp1')])
    expect(picked?.name).toBe('/dev/usb/lp1')
  })

  it('behaves exactly as before on a machine with no device nodes', () => {
    expect(pickReceiptPrinter([p('HP LaserJet', { isDefault: true }), p('Black Copper BC-85AC')])?.name).toBe(
      'Black Copper BC-85AC'
    )
    expect(pickReceiptPrinter([])).toBeNull()
  })
})

describe('telling a device node from a print queue', () => {
  it('recognises the node paths the kernel creates', () => {
    for (const n of ['/dev/usb/lp0', '/dev/usblp0', '/dev/lp0']) expect(isDeviceNode(n)).toBe(true)
  })
  it('does not mistake a queue name for one', () => {
    for (const n of ['XP-80C', 'Black Copper', '', null, undefined]) expect(isDeviceNode(n)).toBe(false)
  })
})

describe('the permission failure gives the command that fixes it', () => {
  it('names the group and the exact command', () => {
    expect(PERMISSION_HINT).toContain('usermod -aG lp')
    expect(PERMISSION_HINT).toMatch(/sign out/i)
  })
})

describe('Chrome OS container detection', () => {
  afterEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const load = async (): Promise<typeof import('../src/main/platform')> => {
    vi.resetModules()
    return import('../src/main/platform')
  }

  it('is false on a plain Linux box with none of the markers', async () => {
    vi.doMock('fs', () => ({ existsSync: () => false }))
    vi.stubEnv('SOMMELIER_VERSION', '')
    vi.stubEnv('HOSTNAME', 'some-desktop')
    const { isChromeOsContainer } = await load()
    expect(isChromeOsContainer()).toBe(process.platform === 'linux' ? false : false)
  })

  it('recognises the container from the Wayland bridge alone', async () => {
    vi.doMock('fs', () => ({ existsSync: () => false }))
    vi.stubEnv('SOMMELIER_VERSION', '0.1.0')
    const { isChromeOsContainer } = await load()
    // Only meaningful on Linux; elsewhere it must stay false.
    expect(isChromeOsContainer()).toBe(process.platform === 'linux')
  })

  it('recognises it from the Chrome OS marker file alone', async () => {
    vi.doMock('fs', () => ({ existsSync: (f: string) => f === '/dev/.cros_milestone' }))
    vi.stubEnv('SOMMELIER_VERSION', '')
    const { isChromeOsContainer } = await load()
    expect(isChromeOsContainer()).toBe(process.platform === 'linux')
  })

  it('never claims Chrome OS on Windows or macOS', async () => {
    vi.doMock('fs', () => ({ existsSync: () => true }))
    vi.stubEnv('SOMMELIER_VERSION', '0.1.0')
    const { isChromeOsContainer } = await load()
    if (process.platform !== 'linux') expect(isChromeOsContainer()).toBe(false)
  })
})
