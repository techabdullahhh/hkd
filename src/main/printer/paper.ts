/**
 * Receipt paper geometry, shared by both print paths.
 *
 * A thermal receipt printer has a fixed width and an effectively endless
 * length: the page is however long the receipt is, and the printer cuts
 * after it. Nothing in the desktop printing model expects that. Ask for an
 * A4-length page — which is what this app used to do — and the driver feeds
 * ~30 cm of paper for a 9 cm receipt, blank from the total down to the cut.
 *
 * So the page is sized to the content: measure the rendered receipt, add a
 * short tail so the cut lands below the footer, and hand the driver exactly
 * that. The width is the paper's printable width, not its nominal width —
 * an "80 mm" roll prints 72 mm wide, a "58 mm" roll 48 mm.
 */

import type { PrinterInfo } from '@shared/types'

export type PaperWidth = 58 | 80

/** Nominal roll width, in microns — what the driver calls the paper. */
export function paperWidthMicrons(paper: PaperWidth): number {
  return paper === 58 ? 58_000 : 80_000
}

/** Character columns for the printer's built-in font at that width. */
export function columnsForPaper(paper: PaperWidth): number {
  return paper === 58 ? 32 : 48
}

/** Printable dots across the paper — the standard 203 dpi head widths. */
export function dotsForPaper(paper: PaperWidth): number {
  return paper === 58 ? 384 : 576
}

/**
 * The logo's share of the printable width. Full width made a 72 mm badge on
 * every 80 mm receipt — legible from across the room and a real cost in
 * paper. 62 % keeps HKD's lettering crisp at both paper sizes.
 */
const LOGO_WIDTH_RATIO = 0.62

/**
 * Logo width in dots, rounded to whole bytes so the ESC/POS raster has no
 * padding column and the driver path prints the bitmap 1:1.
 */
export function logoDotsForPaper(paper: PaperWidth): number {
  return Math.round((dotsForPaper(paper) * LOGO_WIDTH_RATIO) / 8) * 8
}

/** The same logo width in millimetres, for the HTML path (203 dpi ≈ 8 dots/mm). */
export function logoWidthMm(paper: PaperWidth): number {
  return logoDotsForPaper(paper) / 8
}

/** CSS px → microns at the 96 dpi Chromium lays receipts out in. */
const MICRONS_PER_CSS_PX = 25_400 / 96

/** Room below the footer so the cut never clips the last line. */
const TAIL_MM = 6
/** A page shorter than this is a driver-rejected paper size on some models. */
const MIN_HEIGHT_MM = 40
/** Sanity cap: past this something has gone wrong with the measurement. */
const MAX_HEIGHT_MM = 2_000

/**
 * The exact page to request from the driver for a receipt whose rendered
 * content is `contentPx` tall. Returned in microns, which is what Electron's
 * `pageSize` takes.
 */
export function receiptPageSize(contentPx: number, paper: PaperWidth): { width: number; height: number } {
  const contentMicrons = Math.max(0, contentPx) * MICRONS_PER_CSS_PX
  const withTail = contentMicrons + TAIL_MM * 1_000
  const clamped = Math.min(MAX_HEIGHT_MM * 1_000, Math.max(MIN_HEIGHT_MM * 1_000, withTail))
  return { width: paperWidthMicrons(paper), height: Math.round(clamped) }
}

/**
 * Names that receipt printers give themselves. Used only when the admin has
 * not chosen a printer, so the app does something sensible on a fresh PC
 * where the thermal printer is plugged in but nobody has visited Settings.
 */
const RECEIPT_PRINTER_HINT =
  /black\s*copper|bc[-\s]?\d|xprinter|xp[-\s]?\d|pos[-\s]?\d|thermal|receipt|epson\s*tm|tm[-\s]?[tu]\d|rongta|rp[-\s]?\d|gprinter|gp[-\s]?\d|bixolon|star\s*tsp|citizen\s*ct|\b58\b|\b80\b|zj[-\s]?\d|hoin|munbyn|goojprt/i

/**
 * Pick the printer most likely to be the receipt printer: a name that looks
 * like one wins, the OS default is next, then whatever is first. Null only
 * when there are no printers at all.
 */
export function pickReceiptPrinter(printers: PrinterInfo[]): PrinterInfo | null {
  if (printers.length === 0) return null
  const looksLikeReceipt = printers.filter((p) => RECEIPT_PRINTER_HINT.test(`${p.name} ${p.displayName}`))
  if (looksLikeReceipt.length > 0) {
    return looksLikeReceipt.find((p) => p.isDefault) ?? looksLikeReceipt[0]
  }
  return printers.find((p) => p.isDefault) ?? printers[0]
}
