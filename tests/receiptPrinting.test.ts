/**
 * Getting a receipt out of a wired thermal printer correctly.
 *
 * Two paths exist — the printer's driver, and raw ESC/POS to its queue — and
 * these tests pin down the parts of each that can be checked without the
 * hardware on the desk: the page geometry the driver is asked for, the byte
 * stream the printer is sent, and how the printer is chosen.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, schema } from '../src/main/db/connection'
import { freshDb, teardown, actAs } from './helpers'
import { columnsForPaper, dotsForPaper, paperWidthMicrons, pickReceiptPrinter, receiptPageSize } from '../src/main/printer/paper'
import { buildEscPos, rasterCommand, toPrinterAscii } from '../src/main/printer/escpos'
import { packRaster } from '../src/main/printer/thermalImage'
import { renderInvoice } from '../src/main/printer/renderInvoice'
import { getPrinterSettings, updatePrinterSettings } from '../src/main/services/printer'
import type { InvoiceSnapshot, PrinterInfo } from '@shared/types'

/* ------------------------------- geometry -------------------------------- */

describe('receipt page geometry — the page is as long as the receipt, no longer', () => {
  it('a 9 cm receipt asks the driver for a ~9.6 cm page, not an A4 one', () => {
    // 340 CSS px ≈ 90 mm at 96 dpi
    const page = receiptPageSize(340, 80)
    expect(page.width).toBe(80_000)
    expect(page.height).toBeGreaterThan(90_000)
    expect(page.height).toBeLessThan(100_000)
    expect(page.height).toBeLessThan(297_000) // the old fixed A4 length
  })

  it('a long receipt (100 lines) gets a proportionally long page', () => {
    const short = receiptPageSize(340, 80).height
    const long = receiptPageSize(2400, 80).height
    expect(long).toBeGreaterThan(short * 5)
  })

  it('never asks for a page shorter than a driver will accept', () => {
    expect(receiptPageSize(0, 58).height).toBeGreaterThanOrEqual(40_000)
    expect(receiptPageSize(-50, 80).height).toBeGreaterThanOrEqual(40_000)
  })

  it('caps a runaway measurement instead of requesting a two-metre page', () => {
    expect(receiptPageSize(1_000_000, 80).height).toBeLessThanOrEqual(2_000_000)
  })

  it('width follows the paper, as do columns and dots', () => {
    expect(paperWidthMicrons(58)).toBe(58_000)
    expect(receiptPageSize(300, 58).width).toBe(58_000)
    expect(columnsForPaper(58)).toBe(32)
    expect(columnsForPaper(80)).toBe(48)
    expect(dotsForPaper(58)).toBe(384)
    expect(dotsForPaper(80)).toBe(576)
  })
})

/* ---------------------------- printer selection --------------------------- */

const printer = (name: string, isDefault = false): PrinterInfo => ({
  name,
  displayName: name,
  description: '',
  status: 0,
  isDefault
})

describe('choosing a printer when the admin has not chosen one', () => {
  it('prefers the one that is obviously a receipt printer over the office default', () => {
    const picked = pickReceiptPrinter([printer('HP LaserJet Pro', true), printer('Black Copper BC-85AC')])
    expect(picked?.name).toBe('Black Copper BC-85AC')
  })

  it('recognises the common thermal brands', () => {
    for (const n of ['XP-80C', 'POS-58', 'EPSON TM-T88V', 'Rongta RP80', 'Generic 80mm Thermal', 'Receipt Printer']) {
      expect(pickReceiptPrinter([printer('Microsoft Print to PDF', true), printer(n)])?.name).toBe(n)
    }
  })

  it('falls back to the OS default, then to the first one', () => {
    expect(pickReceiptPrinter([printer('A'), printer('B', true)])?.name).toBe('B')
    expect(pickReceiptPrinter([printer('A'), printer('B')])?.name).toBe('A')
    expect(pickReceiptPrinter([])).toBeNull()
  })
})

/* -------------------------------- ESC/POS -------------------------------- */

const SNAP: InvoiceSnapshot = {
  restaurantName: 'HASHMI KA DERA',
  restaurantNameUrdu: 'ہاشمی کا ڈیرہ',
  restaurantPhone: '',
  restaurantAddress: '',
  footerText: 'Thank you!',
  paperWidth: 80,
  invoiceNumber: 'INV-20260920-0001',
  orderNumber: 'ORD-20260920-0001',
  employeeName: 'Victor 1',
  sessionId: 1,
  businessDate: '2026-09-20',
  issuedAt: Date.now(),
  lines: [{ name: 'Naan', nameUrdu: null, variantLabel: null, quantity: 2, unitPriceMinor: 3000, lineTotalMinor: 6000 }],
  subtotalMinor: 6000,
  discountMinor: 0,
  discountReason: null,
  serviceChargeMinor: 3000,
  totalMinor: 9000,
  paymentMethodLabel: 'Cash',
  tenderedMinor: 10000,
  changeMinor: 1000
}

const ESC = 0x1b
const GS = 0x1d

describe('ESC/POS byte stream', () => {
  it('starts by initialising the printer and ends with a partial cut', () => {
    const b = buildEscPos(renderInvoice(SNAP))
    expect([...b.subarray(0, 2)]).toEqual([ESC, 0x40])
    expect([...b.subarray(b.length - 4)]).toEqual([GS, 0x56, 0x42, 0x00])
  })

  it('carries the receipt text, with the TOTAL line emphasised', () => {
    const b = buildEscPos(renderInvoice(SNAP))
    const s = b.toString('latin1')
    expect(s).toContain('HASHMI KA DERA')
    expect(s).toContain('Service Charges')
    // ESC E 1 … TOTAL … ESC E 0
    const bold = s.indexOf('\x1bE\x01')
    expect(bold).toBeGreaterThan(-1)
    expect(s.indexOf('TOTAL')).toBeGreaterThan(bold)
    expect(s.indexOf('\x1bE\x00', bold)).toBeGreaterThan(s.indexOf('TOTAL'))
  })

  it('feeds paper before cutting so the last line clears the blade', () => {
    const b = buildEscPos(renderInvoice(SNAP), { feedLines: 4 })
    const tail = [...b.subarray(b.length - 8, b.length - 4)]
    expect(tail).toEqual([0x0a, 0x0a, 0x0a, 0x0a])
  })

  it('can skip the cut for printers without a cutter', () => {
    const b = buildEscPos(renderInvoice(SNAP), { cut: false })
    expect([...b.subarray(b.length - 4)]).not.toEqual([GS, 0x56, 0x42, 0x00])
  })

  it('never sends a byte the printer cannot represent', () => {
    const b = buildEscPos(renderInvoice(SNAP))
    for (const byte of b) {
      // commands are below 0x20; text is printable ASCII
      expect(byte).toBeLessThan(0x80)
    }
    expect(toPrinterAscii('Chai – 2 × 80… “ok”')).toBe('Chai - 2 x 80... "ok"')
    expect(toPrinterAscii('ہاشمی')).toBe('?????')
  })

  it('places the logo raster before the text, centred', () => {
    const raster = packRaster({ width: 16, height: 2, ink: new Uint8Array(32).fill(1) })
    const b = buildEscPos(renderInvoice(SNAP), { logo: raster })
    const s = b.toString('latin1')
    const centre = s.indexOf('\x1ba\x01')
    const gsv0 = s.indexOf('\x1dv0')
    const left = s.indexOf('\x1ba\x00')
    expect(centre).toBeGreaterThan(-1)
    expect(gsv0).toBeGreaterThan(centre)
    expect(left).toBeGreaterThan(gsv0)
    expect(s.indexOf('HASHMI')).toBeGreaterThan(left)
  })
})

describe('GS v 0 raster header', () => {
  it('encodes width in bytes and height in dots, little-endian', () => {
    // 576 dots wide = 72 bytes; 300 rows = 0x012C
    const data = Buffer.alloc(72 * 300)
    const cmd = rasterCommand({ width: 576, height: 300, bytesPerRow: 72, data })
    expect([...cmd.subarray(0, 8)]).toEqual([GS, 0x76, 0x30, 0x00, 72, 0, 0x2c, 0x01])
    expect(cmd.length).toBe(8 + data.length)
  })
})

describe('raster packing — eight dots per byte, MSB first, 1 = burn', () => {
  it('packs a known pattern exactly', () => {
    // row 0: 1 0 0 0 0 0 0 0 | 1  → 0x80, 0x80   (9 dots wide → 2 bytes/row)
    // row 1: 0 1 1 1 1 1 1 1 | 0  → 0x7f, 0x00
    const ink = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0])
    const r = packRaster({ width: 9, height: 2, ink })
    expect(r.bytesPerRow).toBe(2)
    expect([...r.data]).toEqual([0x80, 0x80, 0x7f, 0x00])
  })

  it('the head width divides evenly — no wasted padding column on real paper', () => {
    expect(dotsForPaper(58) % 8).toBe(0)
    expect(dotsForPaper(80) % 8).toBe(0)
  })
})

/* ------------------------------- settings -------------------------------- */

describe('printer mode setting', () => {
  beforeEach(() => {
    freshDb()
    actAs('admin')
  })
  afterEach(teardown)

  it('defaults to the driver path with automatic printer choice', () => {
    const s = getPrinterSettings()
    expect(s.mode).toBe('SYSTEM')
    expect(s.selectedPrinter).toBeNull()
  })

  it('accepts raw ESC/POS mode and rejects anything else', async () => {
    await updatePrinterSettings({ mode: 'ESCPOS_RAW' })
    expect(getPrinterSettings().mode).toBe('ESCPOS_RAW')
    await expect(updatePrinterSettings({ mode: 'FAX' as never })).rejects.toThrow(/mode/i)
  })

  it('reads an old ESCPOS_BLUETOOTH setting as raw mode instead of breaking', () => {
    db.insert(schema.appSettings)
      .values({
        key: 'printer.settings',
        value: JSON.stringify({ mode: 'ESCPOS_BLUETOOTH', escposAddress: 'COM5', paperWidth: 58 }),
        updatedAt: Date.now()
      })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value: JSON.stringify({ mode: 'ESCPOS_BLUETOOTH', escposAddress: 'COM5', paperWidth: 58 }) }
      })
      .run()
    const s = getPrinterSettings()
    expect(s.mode).toBe('ESCPOS_RAW')
    expect(s.paperWidth).toBe(58)
    expect('escposAddress' in s).toBe(false)
  })
})

describe('logo sizing — both print paths agree, and it fits the roll', () => {
  it('is a whole number of bytes wide and well under the paper width', async () => {
    const { logoDotsForPaper, logoWidthMm } = await import('../src/main/printer/paper')
    for (const paper of [58, 80] as const) {
      const dots = logoDotsForPaper(paper)
      expect(dots % 8).toBe(0)
      expect(dots).toBeLessThan(dotsForPaper(paper))
      expect(dots).toBeGreaterThan(dotsForPaper(paper) * 0.5)
      // 203 dpi → 8 dots per mm; the HTML lays it out at exactly this size
      expect(logoWidthMm(paper)).toBe(dots / 8)
    }
    expect(logoWidthMm(80)).toBeCloseTo(45, 0)
    expect(logoWidthMm(58)).toBeCloseTo(30, 0)
  })

  it('the HTML lays the logo out at its physical width, not 100 %', () => {
    const doc = renderInvoice(SNAP, { logoDataUrl: 'data:image/png;base64,AAAA' })
    expect(doc.html).toMatch(/\.logo\s*\{[^}]*width:45mm/)
    expect(doc.html).not.toMatch(/\.logo\s*\{[^}]*width:100%/)
  })
})
