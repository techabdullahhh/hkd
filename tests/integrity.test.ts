import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema, rawDb } from '../src/main/db/connection'
import { freshDb, teardown, actAs } from './helpers'
import { openSession } from '../src/main/services/session'
import { checkout } from '../src/main/services/orders'
import { archiveProduct, getProduct } from '../src/main/services/menu'
import { getInvoice } from '../src/main/services/invoices'

function seekh(): { productId: number; priceId: number } {
  const p = db.select().from(schema.products).where(eq(schema.products.name, 'Seekh Kabab')).get()!
  const pr = db.select().from(schema.productPrices).where(eq(schema.productPrices.productId, p.id)).get()!
  return { productId: p.id, priceId: pr.id }
}

describe('historical financial integrity', () => {
  beforeEach(() => {
    freshDb()
    actAs('admin')
    actAs('victor1')
    openSession()
  })
  afterEach(teardown)

  it('SQL triggers forbid mutating or deleting invoice lines', async () => {
    const s = seekh()
    const r = await checkout({
      lines: [{ kind: 'PRODUCT', refId: s.productId, productPriceId: s.priceId, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    const raw = rawDb()
    expect(() => raw.prepare('UPDATE invoice_lines SET line_total_minor = 1 WHERE invoice_id = ?').run(r.invoiceId)).toThrow(
      /immutable/i
    )
    expect(() => raw.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(r.invoiceId)).toThrow(/immutable/i)
    expect(() => raw.prepare('DELETE FROM invoices WHERE id = ?').run(r.invoiceId)).toThrow(/immutable/i)
  })

  it('invoice financial columns cannot be rewritten, but print tracking can', async () => {
    const s = seekh()
    const r = await checkout({
      lines: [{ kind: 'PRODUCT', refId: s.productId, productPriceId: s.priceId, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    const raw = rawDb()
    expect(() => raw.prepare('UPDATE invoices SET total_minor = 999 WHERE id = ?').run(r.invoiceId)).toThrow(/immutable/i)
    // print tracking update is allowed
    raw.prepare("UPDATE invoices SET print_status = 'PRINTED', print_count = 1 WHERE id = ?").run(r.invoiceId)
    expect(getInvoice(r.invoiceId).printStatus).toBe('PRINTED')
  })

  it('payments are append-only', async () => {
    const s = seekh()
    const r = await checkout({
      lines: [{ kind: 'PRODUCT', refId: s.productId, productPriceId: s.priceId, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    const raw = rawDb()
    expect(() => raw.prepare('UPDATE payments SET amount_minor = 0 WHERE order_id = ?').run(r.order.id)).toThrow()
    expect(() => raw.prepare('DELETE FROM payments WHERE order_id = ?').run(r.order.id)).toThrow()
  })

  it('archiving a product keeps past invoices intact and readable', async () => {
    const s = seekh()
    const r = await checkout({
      lines: [{ kind: 'PRODUCT', refId: s.productId, productPriceId: s.priceId, quantity: 2 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    actAs('admin')
    archiveProduct(s.productId, 'seasonal')
    expect(getProduct(s.productId).isArchived).toBe(true)

    const inv = getInvoice(r.invoiceId)
    expect(inv.lines[0].name).toBe('Seekh Kabab')
    expect(inv.lines[0].lineTotalMinor).toBe(20000)
    expect(inv.snapshot.lines[0].name).toBe('Seekh Kabab')

    // and the archived product can no longer be sold
    actAs('victor1')
    await expect(
      checkout({
        lines: [{ kind: 'PRODUCT', refId: s.productId, productPriceId: s.priceId, quantity: 1 }],
        payment: { method: 'CASH', tenderedMinor: 100000 },
        autoPrint: false
      })
    ).rejects.toThrow(/no longer on the menu/i)
  })

  it('audit log rows cannot be edited or deleted', () => {
    const raw = rawDb()
    raw.prepare("INSERT INTO audit_logs (action, summary) VALUES ('X', 'y')").run()
    expect(() => raw.prepare('UPDATE audit_logs SET summary = ?').run('z')).toThrow(/append-only/i)
    expect(() => raw.prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/i)
  })
})
