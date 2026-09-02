import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '../src/main/db/connection'
import { freshDb, teardown, actAs } from './helpers'
import { openSession } from '../src/main/services/session'
import { checkout } from '../src/main/services/orders'
import { printInvoiceById } from '../src/main/services/invoices'
import { updatePrinterSettings } from '../src/main/services/printer'

function seekh(): { productId: number; priceId: number } {
  const p = db.select().from(schema.products).where(eq(schema.products.name, 'Seekh Kabab')).get()!
  const pr = db.select().from(schema.productPrices).where(eq(schema.productPrices.productId, p.id)).get()!
  return { productId: p.id, priceId: pr.id }
}

describe('printer failure handling', () => {
  beforeEach(async () => {
    freshDb()
    actAs('admin')
    // direct ESC/POS mode with no transport = deterministic, honest failure
    await updatePrinterSettings({ mode: 'ESCPOS_BLUETOOTH', escposAddress: null })
    actAs('victor1')
    openSession()
  })
  afterEach(teardown)

  it('a failed print never marks the invoice as PRINTED, and the invoice is not lost', async () => {
    const s = seekh()
    const r = await checkout({
      lines: [{ kind: 'PRODUCT', refId: s.productId, productPriceId: s.priceId, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: true
    })
    expect(r.printed).toBe(false)
    expect(r.printMessage).toMatch(/not implemented|transport|System printer/i)

    const inv = db.select().from(schema.invoices).where(eq(schema.invoices.id, r.invoiceId)).get()!
    expect(inv.printStatus).toBe('FAILED')
    expect(inv.printCount).toBe(0)
    expect(inv.lastPrintError).toBeTruthy()

    // a failed print job is recorded
    const jobs = db.select().from(schema.printJobs).where(eq(schema.printJobs.invoiceId, r.invoiceId)).all()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].status).toBe('FAILED')
  })

  it('retrying still fails cleanly and remains recoverable', async () => {
    const s = seekh()
    const r = await checkout({
      lines: [{ kind: 'PRODUCT', refId: s.productId, productPriceId: s.priceId, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    const res1 = await printInvoiceById(r.invoiceId, 'PRINT', 1)
    const res2 = await printInvoiceById(r.invoiceId, 'REPRINT', 1)
    expect(res1.ok).toBe(false)
    expect(res2.ok).toBe(false)
    const jobs = db.select().from(schema.printJobs).where(eq(schema.printJobs.invoiceId, r.invoiceId)).all()
    expect(jobs.length).toBe(2)
  })
})
