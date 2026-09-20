/**
 * ESC/POS byte encoding for the receipt.
 *
 * Every thermal receipt printer sold for point-of-sale — Black Copper,
 * Xprinter, Epson TM, Rongta, Gprinter, the unbranded 58 mm units — speaks
 * this command set, originally Epson's. Sending it directly means the
 * printer, not a Windows driver, decides the layout: the text lands in the
 * printer's own font at the paper's native column count, the logo is burnt
 * dot-for-dot, and the cutter fires at the end. No page size, no scaling, no
 * blank feed — the problems a driver introduces cannot arise.
 *
 * This module only produces bytes; it touches no hardware. The transport is
 * in EscposRawAdapter.
 */

import type { RenderedInvoice } from './types'
import type { ThermalRaster } from './thermalImage'

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

export interface EscposOptions {
  /** 1-bit logo already sized to the head; omitted → no logo. */
  logo?: ThermalRaster | null
  /** Blank lines fed before the cut so the last line clears the blade. */
  feedLines?: number
  /** Fire the cutter. Off only for printers without one. */
  cut?: boolean
}

/**
 * Printers do not understand UTF-8; anything outside plain ASCII would print
 * as garbage or shift the code page mid-receipt. The receipt text is already
 * ASCII (amounts, names, rules) — this guards the odd stray character.
 */
export function toPrinterAscii(s: string): string {
  return s
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/×/g, 'x')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e\n]/g, '?')
}

/** `GS v 0` — print a raster bit image, normal size. */
export function rasterCommand(logo: ThermalRaster): Buffer {
  const { bytesPerRow, height, data } = logo
  const header = Buffer.from([
    GS,
    0x76, // v
    0x30, // 0
    0x00, // m = normal
    bytesPerRow & 0xff,
    (bytesPerRow >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff
  ])
  return Buffer.concat([header, data])
}

/**
 * The whole receipt as one byte stream:
 *   initialise → (centred logo) → left-aligned text, TOTAL in bold →
 *   feed → partial cut.
 */
export function buildEscPos(doc: RenderedInvoice, opts: EscposOptions = {}): Buffer {
  const parts: Buffer[] = []
  const bytes = (...b: number[]): void => {
    parts.push(Buffer.from(b))
  }
  const text = (s: string): void => {
    parts.push(Buffer.from(toPrinterAscii(s), 'latin1'))
  }

  bytes(ESC, 0x40) // ESC @  initialise — clears any state left by a previous job

  if (opts.logo && opts.logo.height > 0) {
    bytes(ESC, 0x61, 0x01) // centre
    parts.push(rasterCommand(opts.logo))
    bytes(LF)
  }

  bytes(ESC, 0x61, 0x00) // left align — the text is already padded to the columns
  for (const line of doc.text.replace(/\r\n/g, '\n').split('\n')) {
    // The grand total is the one line staff and customers look for.
    const emphasise = /^TOTAL\b/i.test(line)
    if (emphasise) bytes(ESC, 0x45, 0x01)
    text(line)
    if (emphasise) bytes(ESC, 0x45, 0x00)
    bytes(LF)
  }

  const feed = Math.max(0, Math.min(10, opts.feedLines ?? 4))
  for (let i = 0; i < feed; i++) bytes(LF)

  if (opts.cut !== false) bytes(GS, 0x56, 0x42, 0x00) // GS V B 0 — partial cut

  return Buffer.concat(parts)
}
