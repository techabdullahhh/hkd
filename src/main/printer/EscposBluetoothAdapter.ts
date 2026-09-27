import type { PrinterInfo } from '@shared/types'
import type { PrinterAdapter, PrintOptions, PrintResult, RenderedInvoice } from './types'
import type { ThermalRaster } from './thermalImage'
import { buildEscPos } from './escpos'
import {
  DEFAULT_BAUD,
  isSerialPort,
  listSerialPorts,
  serialPortsAsPrinters,
  writeToSerialPort
} from './serialPort'
import { bluetoothAvailability, listPairedDevices, pairingInstructions, rfcommBindCommand } from './bluetooth'

/**
 * ESC/POS over Bluetooth.
 *
 * The bytes are identical to every other mode — same logo raster, same bold
 * total, same cut. Only the transport differs, and the transport is a serial
 * port, because that is what a paired Bluetooth printer *is* to the operating
 * system (see serialPort.ts). So this adapter is thin on purpose: list the
 * ports, pick one, write to it.
 *
 * What it adds beyond the transport is diagnosis. A Bluetooth printer fails in
 * ways a cable does not — paired but not bound, paired but out of range, asleep,
 * bound to a port another program holds — and each of those is indistinguishable
 * from the others if all the user sees is "printing failed". `probe` separates
 * them, because on a restaurant counter the difference between "switch the
 * printer on" and "run this command once" is the difference between a fix and a
 * support call.
 */
export class EscposBluetoothAdapter implements PrinterAdapter {
  readonly mode = 'ESCPOS_BLUETOOTH' as const

  constructor(
    private readonly logoFor: (paperWidth: 58 | 80) => ThermalRaster | null,
    private readonly baudRate: number = DEFAULT_BAUD
  ) {}

  /** Every serial port, Bluetooth links first. */
  async listPrinters(): Promise<PrinterInfo[]> {
    if (!bluetoothAvailability().available) return []
    return serialPortsAsPrinters()
  }

  async probe(deviceName?: string | null): Promise<{ reachable: boolean; message: string }> {
    const availability = bluetoothAvailability()
    if (!availability.available) {
      return { reachable: false, message: availability.reason }
    }

    const ports = await listSerialPorts()

    if (ports.length === 0) {
      // Paired but no port is the characteristic Linux failure, and the fix is
      // a single command — so name it rather than saying "not found".
      const paired = await listPairedDevices()
      if (paired.length > 0 && process.platform === 'linux') {
        const likely = paired.find((d) => /print|pos|thermal|bt-?\d|rp\d|xp-?\d/i.test(d.name)) ?? paired[0]
        return {
          reachable: false,
          message:
            `"${likely.name}" is paired but has no serial port yet — on Linux that has to be created once. Run:\n\n    ${rfcommBindCommand(likely.address)}\n\n` +
            'Then press Refresh printers.'
        }
      }
      return { reachable: false, message: `No Bluetooth printer found. ${pairingInstructions()}` }
    }

    const target = this.resolve(ports, deviceName)
    if (!target) {
      return { reachable: false, message: `"${deviceName}" is not connected right now. Check the printer is switched on and in range.` }
    }
    if (!target.writable) {
      return {
        reachable: false,
        message:
          process.platform === 'linux'
            ? `${target.path} exists but this user may not write to it. Run this once, then sign out and back in:\n\n    sudo usermod -aG dialout $USER`
            : `${target.path} could not be opened. Another program may be holding it.`
      }
    }

    // A port existing does not prove the printer is awake — that only shows up
    // on the first write — so this is deliberately worded as "ready to send".
    return {
      reachable: true,
      message: `Ready — ${target.bluetooth ? 'Bluetooth' : 'serial'} on ${target.path}. A test print confirms the printer is awake and in range.`
    }
  }

  private resolve(
    ports: Awaited<ReturnType<typeof listSerialPorts>>,
    deviceName?: string | null
  ): Awaited<ReturnType<typeof listSerialPorts>>[number] | null {
    if (deviceName && isSerialPort(deviceName)) {
      return ports.find((p) => p.path.toUpperCase() === deviceName.toUpperCase()) ?? null
    }
    // No explicit choice: a Bluetooth link is what this mode is for, so prefer
    // one, and prefer a writable port over one that would fail.
    return (
      ports.find((p) => p.bluetooth && p.writable) ??
      ports.find((p) => p.writable) ??
      ports.find((p) => p.bluetooth) ??
      ports[0] ??
      null
    )
  }

  async print(doc: RenderedInvoice, opts: PrintOptions): Promise<PrintResult> {
    const availability = bluetoothAvailability()
    if (!availability.available) {
      return { ok: false, message: availability.reason, printerName: opts.deviceName ?? null }
    }

    const ports = await listSerialPorts()
    const target = this.resolve(ports, opts.deviceName)
    if (!target) {
      const probe = await this.probe(opts.deviceName)
      return { ok: false, message: probe.message, printerName: opts.deviceName ?? null }
    }

    const payload = buildEscPos(doc, { logo: this.logoFor(opts.paperWidth) })
    const copies = Math.max(1, opts.copies ?? 1)

    try {
      for (let i = 0; i < copies; i++) {
        await writeToSerialPort(target.path, payload, this.baudRate)
      }
      return {
        ok: true,
        message: `Sent ${payload.length.toLocaleString()} bytes over ${target.bluetooth ? 'Bluetooth' : 'serial'} to ${target.path}.`,
        printerName: target.path
      }
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        printerName: target.path
      }
    }
  }
}
