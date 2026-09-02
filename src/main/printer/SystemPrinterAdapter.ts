import { BrowserWindow } from 'electron'
import type { PrinterInfo } from '@shared/types'
import type { PrinterAdapter, PrintOptions, PrintResult, RenderedInvoice } from './types'

/**
 * Prints through the operating-system print stack. A Bluetooth thermal
 * printer that the OS has paired and exposes as a normal printer works here
 * with no extra configuration — it simply appears in `listPrinters()`.
 *
 * Implementation: render the receipt HTML in a hidden BrowserWindow and
 * drive `webContents.print({ silent, deviceName })`. Electron reports back
 * whether the job was handed to the spooler; we treat a thrown error or a
 * `false` success flag as a print failure so the invoice is never marked
 * printed when it was not.
 */
export class SystemPrinterAdapter implements PrinterAdapter {
  readonly mode = 'SYSTEM' as const

  async listPrinters(): Promise<PrinterInfo[]> {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
    try {
      const printers = await win.webContents.getPrintersAsync()
      return printers.map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        description: p.description || '',
        status: p.status,
        isDefault: p.isDefault
      }))
    } finally {
      win.destroy()
    }
  }

  async probe(deviceName?: string | null): Promise<{ reachable: boolean; message: string }> {
    const printers = await this.listPrinters()
    if (printers.length === 0)
      return { reachable: false, message: 'No printers are installed on this computer. Pair the Bluetooth printer in the operating system, then Refresh.' }
    if (!deviceName)
      return { reachable: false, message: 'No printer has been selected. Choose one in Settings → Printer.' }
    const match = printers.find((p) => p.name === deviceName)
    if (!match)
      return { reachable: false, message: `The selected printer "${deviceName}" is not currently available. It may be turned off or out of Bluetooth range.` }
    // Windows: 0 = ready/idle. Other values often mean paused/offline/error.
    if (match.status !== 0 && match.status !== 3 /* idle on some backends */)
      return { reachable: false, message: `Printer "${deviceName}" reports a problem (status ${match.status}). Check paper and power.` }
    return { reachable: true, message: `Printer "${match.displayName}" is ready.` }
  }

  async print(doc: RenderedInvoice, opts: PrintOptions): Promise<PrintResult> {
    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: true } })
    const widthMicrons = opts.paperWidth === 58 ? 58000 : 80000
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(doc.html))
      // give the layout a beat to settle
      await new Promise((r) => setTimeout(r, 120))
      const copies = Math.max(1, opts.copies ?? 1)
      for (let i = 0; i < copies; i++) {
        const ok = await new Promise<{ success: boolean; failureReason: string }>((resolve) => {
          win.webContents.print(
            {
              silent: true,
              printBackground: true,
              deviceName: opts.deviceName || undefined,
              margins: { marginType: 'none' },
              pageSize: { width: widthMicrons, height: 297000 }
            },
            (success, failureReason) => resolve({ success, failureReason })
          )
        })
        if (!ok.success) {
          return {
            ok: false,
            message: ok.failureReason || 'The print job was cancelled or the printer rejected it.',
            printerName: opts.deviceName
          }
        }
      }
      return { ok: true, message: `Sent to ${opts.deviceName || 'default printer'}.`, printerName: opts.deviceName }
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : 'Unknown printing error.',
        printerName: opts.deviceName
      }
    } finally {
      win.destroy()
    }
  }
}
