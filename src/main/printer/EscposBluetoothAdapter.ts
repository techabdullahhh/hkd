import type { PrinterInfo } from '@shared/types'
import type { PrinterAdapter, PrintOptions, PrintResult, RenderedInvoice } from './types'

/**
 * ================== HARDWARE ADAPTER — CONFIGURE ONCE ==================
 *
 * Direct ESC/POS over a Bluetooth serial (SPP / RFCOMM) link, for the case
 * where the exact printer model does NOT behave well as a generic OS
 * printer and needs raw ESC/POS bytes.
 *
 * This adapter is intentionally INERT until the printer model is known.
 * To enable it you must supply, in Settings → Printer (mode = ESCPOS_BLUETOOTH):
 *
 *   1. The Bluetooth device address / serial port name
 *      (e.g. "COM5" on Windows, "/dev/tty.XXX" on macOS).
 *   2. Confirm the printer's ESC/POS dialect and code page.
 *
 * and then wire a transport here. The recommended transport is a small
 * native/serial dependency chosen for the target printer:
 *   - Windows generic SPP  ->  `serialport`
 *   - printers with a vendor SDK  ->  that SDK
 *
 * `buildEscPos()` below already produces a valid byte stream for the
 * common Epson-compatible command set; only the `openTransport()` call
 * needs a real implementation.
 *
 * Until then every method fails loudly and honestly — it never pretends a
 * printer is connected.
 */
export class EscposBluetoothAdapter implements PrinterAdapter {
  readonly mode = 'ESCPOS_BLUETOOTH' as const

  constructor(private readonly address: string | null) {}

  async listPrinters(): Promise<PrinterInfo[]> {
    return []
  }

  async probe(): Promise<{ reachable: boolean; message: string }> {
    return {
      reachable: false,
      message:
        'Direct ESC/POS Bluetooth mode is selected but no transport is configured for this printer model. ' +
        'Set the serial port in Settings → Printer and complete the adapter in EscposBluetoothAdapter.ts, ' +
        'or switch to System printer mode.'
    }
  }

  async print(_doc: RenderedInvoice, _opts: PrintOptions): Promise<PrintResult> {
    return {
      ok: false,
      message:
        'Cannot print: the direct Bluetooth ESC/POS transport is not implemented for this printer yet. ' +
        (this.address
          ? `Configured address: ${this.address}. `
          : 'No Bluetooth address configured. ') +
        'Use System printer mode until the hardware adapter is completed.',
      printerName: this.address
    }
  }

  /** Ready-to-use ESC/POS encoder for when a transport is wired in. */
  static buildEscPos(doc: RenderedInvoice): Buffer {
    const ESC = 0x1b
    const GS = 0x1d
    const chunks: number[] = []
    const push = (...b: number[]) => chunks.push(...b)
    const write = (s: string) => {
      for (const ch of Buffer.from(s, 'ascii')) chunks.push(ch)
    }
    push(ESC, 0x40) // initialise
    push(ESC, 0x61, 0x00) // left align
    write(doc.text.replace(/\r?\n/g, '\n'))
    push(0x0a, 0x0a, 0x0a)
    push(GS, 0x56, 0x42, 0x00) // partial cut
    return Buffer.from(chunks)
  }

  /**
   * TODO(hardware): open the Bluetooth serial transport for `this.address`
   * (e.g. via `serialport`) and write `EscposBluetoothAdapter.buildEscPos(doc)`
   * to it, then resolve on drain. Until implemented, `print()` fails loudly.
   */
}
