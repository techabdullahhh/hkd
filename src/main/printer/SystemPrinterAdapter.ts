import { BrowserWindow } from 'electron'
import type { PrinterInfo } from '@shared/types'
import type { PrinterAdapter, PrintOptions, PrintResult, RenderedInvoice } from './types'
import { pickReceiptPrinter, receiptPageSize } from './paper'

/**
 * Prints through the operating system's printer driver — the way any desktop
 * application prints. A USB (wired) receipt printer whose driver is installed
 * in Windows, or a Bluetooth one the OS has paired, simply shows up in
 * `listPrinters()` and works here.
 *
 * The receipt HTML is rendered in a hidden window and sent with
 * `webContents.print()`. Two details make this behave on a roll printer:
 *
 *  - **The page is sized to the receipt.** The rendered height is measured
 *    and requested as the page height, so the driver feeds exactly one
 *    receipt's worth of paper and cuts, instead of a fixed A4 length with
 *    20 cm of blank roll after the total.
 *  - **Silent.** No print dialog ever appears on the till.
 *
 * Electron reports whether the job reached the spooler; a thrown error or a
 * `false` flag is treated as a failure so an invoice is never marked printed
 * when it was not. Some thermal drivers ignore custom page sizes entirely and
 * fall back to their own default form — if a printer still feeds blank paper
 * after this, that is the driver, and the ESC/POS raw mode is the fix.
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

  /** The printer a job will actually go to, honouring an explicit choice first. */
  async resolvePrinter(deviceName?: string | null): Promise<{ printer: PrinterInfo | null; autoPicked: boolean; all: PrinterInfo[] }> {
    const all = await this.listPrinters()
    if (deviceName) {
      return { printer: all.find((p) => p.name === deviceName) ?? null, autoPicked: false, all }
    }
    return { printer: pickReceiptPrinter(all), autoPicked: true, all }
  }

  async probe(deviceName?: string | null): Promise<{ reachable: boolean; message: string }> {
    const { printer, autoPicked, all } = await this.resolvePrinter(deviceName)
    if (all.length === 0)
      return {
        reachable: false,
        message:
          'No printers are installed on this computer. Plug the receipt printer in, install its driver (or pair it, if Bluetooth), then Refresh.'
      }
    if (!printer) {
      return {
        reachable: false,
        message: `The selected printer "${deviceName}" is not installed right now. It may be unplugged or its driver removed. Pick another under Configuration.`
      }
    }
    // Windows: 0 = ready/idle. Other values usually mean paused, offline or error.
    if (printer.status !== 0 && printer.status !== 3 /* idle on some backends */)
      return {
        reachable: false,
        message: `Printer "${printer.displayName}" reports a problem (status ${printer.status}). Check the cable, power and paper.`
      }
    return {
      reachable: true,
      message: autoPicked
        ? `Ready — will print to "${printer.displayName}" (chosen automatically; pick a printer under Configuration to lock it in).`
        : `Printer "${printer.displayName}" is ready.`
    }
  }

  async print(doc: RenderedInvoice, opts: PrintOptions): Promise<PrintResult> {
    const { printer, all } = await this.resolvePrinter(opts.deviceName)
    if (!printer) {
      return {
        ok: false,
        message:
          all.length === 0
            ? 'No printer is installed on this computer. Plug the receipt printer in and install its driver.'
            : `Printer "${opts.deviceName}" is not installed right now — it may be unplugged. Pick another under Printer.`,
        printerName: opts.deviceName ?? null
      }
    }
    const target = printer.name

    const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: true } })
    try {
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(doc.html))
      // let fonts and the logo image settle before measuring
      await new Promise((r) => setTimeout(r, 150))
      // body's box is the receipt itself. documentElement.scrollHeight is NOT
      // usable here: it is never smaller than the hidden window's viewport, so
      // a short receipt would measure as 600 px and print 6 cm of blank tail.
      const contentPx = (await win.webContents.executeJavaScript(
        `Math.ceil(Math.max(
           document.body.getBoundingClientRect().height,
           (document.querySelector('.rcpt') || document.body).getBoundingClientRect().bottom
         ))`
      )) as number
      const pageSize = receiptPageSize(contentPx, opts.paperWidth)

      const copies = Math.max(1, opts.copies ?? 1)
      for (let i = 0; i < copies; i++) {
        const ok = await new Promise<{ success: boolean; failureReason: string }>((resolve) => {
          win.webContents.print(
            {
              silent: true,
              printBackground: true,
              deviceName: target,
              margins: { marginType: 'none' },
              pageSize,
              // The HTML is already laid out for the paper; never let the
              // driver "fit to page" it into a postage stamp.
              scaleFactor: 100
            },
            (success, failureReason) => resolve({ success, failureReason })
          )
        })
        if (!ok.success) {
          return {
            ok: false,
            message: ok.failureReason || 'The print job was cancelled or the printer rejected it.',
            printerName: target
          }
        }
      }
      return {
        ok: true,
        message: `Sent to ${printer.displayName} (${(pageSize.height / 1000).toFixed(0)} mm receipt).`,
        printerName: target
      }
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : 'Unknown printing error.',
        printerName: target
      }
    } finally {
      win.destroy()
    }
  }
}
