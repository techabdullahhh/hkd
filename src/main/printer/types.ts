import type { InvoiceSnapshot, PrinterInfo } from '@shared/types'

export interface RenderedInvoice {
  /** print-ready HTML sized for the configured paper width */
  html: string
  /** plain-text fallback (also the basis for ESC/POS) */
  text: string
  paperWidth: 58 | 80
}

export interface PrintOptions {
  deviceName?: string | null
  copies?: number
  paperWidth: 58 | 80
}

export interface PrintResult {
  ok: boolean
  message: string
  printerName?: string | null
}

export interface PrinterAdapter {
  readonly mode: 'SYSTEM' | 'ESCPOS_BLUETOOTH'
  listPrinters(): Promise<PrinterInfo[]>
  probe(deviceName?: string | null): Promise<{ reachable: boolean; message: string }>
  print(doc: RenderedInvoice, opts: PrintOptions): Promise<PrintResult>
}

export type { InvoiceSnapshot }
