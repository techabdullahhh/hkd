import { afterEach, describe, expect, it } from 'vitest'
import { freshDb, teardown, actAs } from './helpers'
import { localAdaptiveThreshold, windowHalfFor, dotsForPaper } from '../src/main/printer/thermalImage'
import { renderInvoice } from '../src/main/printer/renderInvoice'
import { getPrinterSettings, updatePrinterSettings, getInvoiceLogo } from '../src/main/services/printer'
import type { InvoiceSnapshot } from '@shared/types'

afterEach(teardown)

/* ------------------------- the thermal conversion ------------------------ */

const field = (w: number, h: number, value: number): Float64Array => {
  const a = new Float64Array(w * h)
  a.fill(value)
  return a
}

const inkCount = (a: Uint8Array): number => a.reduce((n, v) => n + v, 0)

describe('thermal line art — flat areas never burn', () => {
  // This is the property the whole approach exists for. The HKD logo is drawn
  // on solid black; a global threshold would burn that entire field, wasting
  // a band of paper on every receipt and overheating the head.
  it('a solid black field produces no ink at all', () => {
    const ink = localAdaptiveThreshold(field(64, 64, 0), 64, 64, 4, 0.14 * 255)
    expect(inkCount(ink)).toBe(0)
  })

  it('a solid white field produces no ink either', () => {
    const ink = localAdaptiveThreshold(field(64, 64, 255), 64, 64, 4, 0.14 * 255)
    expect(inkCount(ink)).toBe(0)
  })

  it('a mid-grey field produces no ink — it is the flatness that matters, not the level', () => {
    const ink = localAdaptiveThreshold(field(64, 64, 128), 64, 64, 4, 0.14 * 255)
    expect(inkCount(ink)).toBe(0)
  })
})

describe('thermal line art — bright marks on a dark ground become ink', () => {
  it('a bright square on black burns, and burns far less than the whole square', () => {
    const w = 64
    const lum = field(w, w, 0)
    for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) lum[y * w + x] = 255

    const ink = localAdaptiveThreshold(lum, w, w, 4, 0.14 * 255)
    const burnt = inkCount(ink)

    expect(burnt).toBeGreaterThan(0)
    // The mark is rendered, but as line art: nothing like the 576 dots a
    // filled 24×24 block would cost.
    expect(burnt).toBeLessThan(24 * 24)
    // The black surround stays clean.
    expect(ink[0]).toBe(0)
    expect(ink[w * w - 1]).toBe(0)
  })

  it('a dark mark on a bright ground is left as paper — only bright marks burn', () => {
    const w = 64
    const lum = field(w, w, 255)
    for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) lum[y * w + x] = 0
    const ink = localAdaptiveThreshold(lum, w, w, 4, 0.14 * 255)
    // Interior of the dark square is never brighter than its neighbourhood.
    expect(ink[32 * w + 32]).toBe(0)
  })
})

describe('thermal line art — window scales with the head', () => {
  it('58 mm and 80 mm map to the standard dot widths', () => {
    expect(dotsForPaper(58)).toBe(384)
    expect(dotsForPaper(80)).toBe(576)
  })

  it('the comparison window grows with the print width, so 80 mm is not thinner art', () => {
    expect(windowHalfFor(384)).toBe(12)
    expect(windowHalfFor(576)).toBe(18)
  })

  it('never collapses to a degenerate window on a tiny image', () => {
    expect(windowHalfFor(8)).toBeGreaterThanOrEqual(2)
  })
})

/* ---------------------------- the printed page --------------------------- */

const SNAP: InvoiceSnapshot = {
  restaurantName: 'HASHMI KA DERA',
  restaurantNameUrdu: 'ہاشمی کا ڈیرہ',
  restaurantPhone: '',
  restaurantAddress: '',
  footerText: 'Thank you!',
  paperWidth: 80,
  invoiceNumber: 'INV-20260901-0001',
  orderNumber: 'ORD-20260901-0001',
  employeeName: 'Victor 1',
  sessionId: 1,
  businessDate: '2026-09-01',
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

describe('invoice rendering with a logo', () => {
  it('places the logo at the top of the receipt when one is supplied', () => {
    const doc = renderInvoice(SNAP, { logoDataUrl: 'data:image/png;base64,AAAA' })
    expect(doc.html).toContain('class="logo"')
    expect(doc.html).toContain('data:image/png;base64,AAAA')
    // above the restaurant name, which is what "at the top" means here
    expect(doc.html.indexOf('class="logo"')).toBeLessThan(doc.html.indexOf('HASHMI KA DERA'))
  })

  it('renders no image element at all when there is no logo', () => {
    const doc = renderInvoice(SNAP)
    expect(doc.html).not.toContain('<img')
  })

  it('never resamples the logo — a smoothed 1-bit image prints as mush', () => {
    const doc = renderInvoice(SNAP, { logoDataUrl: 'data:image/png;base64,AAAA' })
    expect(doc.html).toContain('image-rendering:pixelated')
  })

  it('leaves the plain-text/ESC-POS output alone — it cannot carry a raster', () => {
    const doc = renderInvoice(SNAP, { logoDataUrl: 'data:image/png;base64,AAAA' })
    expect(doc.text).not.toContain('data:image')
    expect(doc.text).toContain('HASHMI KA DERA')
  })
})

describe('logo printer setting', () => {
  it('is on by default — the shipped logo prints without anyone enabling it', () => {
    freshDb()
    expect(getPrinterSettings().printLogo).toBe(true)
  })

  it('turning it off suppresses the logo without deleting it', async () => {
    freshDb()
    actAs('admin')
    await updatePrinterSettings({ printLogo: false })
    expect(getPrinterSettings().printLogo).toBe(false)
    expect(getInvoiceLogo(80)).toBeNull()
  })
})
