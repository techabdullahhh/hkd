import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../src/main/db/connection'
import { freshDb, teardown, actAs } from './helpers'
import { openSession } from '../src/main/services/session'
import { checkout, refundOrder } from '../src/main/services/orders'
import { updateSettings } from '../src/main/services/settings'

function priceFor(name: string, label = 'Standard'): { productId: number; priceId: number; priceMinor: number } {
  const p = db.select().from(schema.products).where(eq(schema.products.name, name)).get()!
  const pr = db
    .select()
    .from(schema.productPrices)
    .where(and(eq(schema.productPrices.productId, p.id), eq(schema.productPrices.label, label)))
    .get()!
  return { productId: p.id, priceId: pr.id, priceMinor: pr.priceMinor }
}

describe('order + invoice creation', () => {
  beforeEach(() => {
    freshDb()
    actAs('admin')
    actAs('victor1')
    openSession()
  })
  afterEach(teardown)

  it('computes totals from server prices, ignoring anything the client claims', async () => {
    const seekh = priceFor('Seekh Kabab') // Rs. 100 -> 10000
    const naan = priceFor('Naan') // Rs. 30 -> 3000
    const r = await checkout({
      lines: [
        { kind: 'PRODUCT', refId: seekh.productId, productPriceId: seekh.priceId, quantity: 3 },
        { kind: 'PRODUCT', refId: naan.productId, productPriceId: naan.priceId, quantity: 4 }
      ],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    expect(r.order.subtotalMinor).toBe(3 * 10000 + 4 * 3000) // 42000
    expect(r.order.serviceChargeMinor).toBe(3000) // fixed PKR 30
    expect(r.order.totalMinor).toBe(42000 + 3000) // subtotal + service charge
    expect(r.invoiceId).toBeGreaterThan(0)
    const inv = db.select().from(schema.invoices).where(eq(schema.invoices.id, r.invoiceId)).get()!
    expect(inv.subtotalMinor).toBe(42000)
    expect(inv.serviceChargeMinor).toBe(3000)
    expect(inv.totalMinor).toBe(45000)
    expect(JSON.parse(inv.snapshotJson).serviceChargeMinor).toBe(3000)
    expect(inv.printStatus).toBe('NOT_PRINTED')
  })

  it('records change for cash and rejects underpayment (service charge included in the total due)', async () => {
    const seekh = priceFor('Seekh Kabab')
    const r = await checkout({
      lines: [{ kind: 'PRODUCT', refId: seekh.productId, productPriceId: seekh.priceId, quantity: 2 }],
      payment: { method: 'CASH', tenderedMinor: 25000 },
      autoPrint: false
    })
    const pay = db.select().from(schema.payments).where(eq(schema.payments.orderId, r.order.id)).get()!
    expect(pay.amountMinor).toBe(20000 + 3000) // 2×100 + PKR 30 = 23000
    expect(pay.changeMinor).toBe(2000) // 25000 tendered − 23000 due

    await expect(
      checkout({
        lines: [{ kind: 'PRODUCT', refId: seekh.productId, productPriceId: seekh.priceId, quantity: 2 }],
        payment: { method: 'CASH', tenderedMinor: 5000 },
        autoPrint: false
      })
    ).rejects.toThrow(/less than the total/i)
  })

  it('numbers invoices sequentially per business day and never reuses a number', async () => {
    const seekh = priceFor('Seekh Kabab')
    const nums: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = await checkout({
        lines: [{ kind: 'PRODUCT', refId: seekh.productId, productPriceId: seekh.priceId, quantity: 1 }],
        payment: { method: 'CASH', tenderedMinor: 100000 },
        autoPrint: false
      })
      nums.push(db.select().from(schema.invoices).where(eq(schema.invoices.id, r.invoiceId)).get()!.invoiceNumber)
    }
    expect(nums).toEqual([...new Set(nums)]) // all unique
    expect(nums[0]).toMatch(/^INV-\d{8}-0001$/)
    expect(nums[3]).toMatch(/0004$/)
  })

  it('blocks an employee discount unless enabled, then honours the cap', async () => {
    const karahi = priceFor('Chicken Karahi', 'Full') // 150000
    await expect(
      checkout({
        lines: [{ kind: 'PRODUCT', refId: karahi.productId, productPriceId: karahi.priceId, quantity: 1 }],
        discountMinor: 10000,
        discountReason: 'regular customer',
        payment: { method: 'CASH', tenderedMinor: 200000 },
        autoPrint: false
      })
    ).rejects.toThrow(/not authorised/i)

    actAs('admin')
    updateSettings({ allowEmployeeDiscount: true, maxEmployeeDiscountPercent: 10 })
    actAs('victor1')

    await expect(
      checkout({
        lines: [{ kind: 'PRODUCT', refId: karahi.productId, productPriceId: karahi.priceId, quantity: 1 }],
        discountMinor: 30000, // 20% — over the cap
        discountReason: 'too much',
        payment: { method: 'CASH', tenderedMinor: 200000 },
        autoPrint: false
      })
    ).rejects.toThrow(/limit for employees/i)

    const ok = await checkout({
      lines: [{ kind: 'PRODUCT', refId: karahi.productId, productPriceId: karahi.priceId, quantity: 1 }],
      discountMinor: 15000, // 10%
      discountReason: 'regular customer',
      payment: { method: 'CASH', tenderedMinor: 200000 },
      autoPrint: false
    })
    expect(ok.order.discountMinor).toBe(15000)
    expect(ok.order.serviceChargeMinor).toBe(3000)
    expect(ok.order.totalMinor).toBe(150000 - 15000 + 3000) // 138000
  })

  it('applies the configured service charge and freezes it onto historical invoices', async () => {
    const seekh = priceFor('Seekh Kabab')
    // admin changes the charge AFTER the first sale
    const first = await checkout({
      lines: [{ kind: 'PRODUCT', refId: seekh.productId, productPriceId: seekh.priceId, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    expect(first.order.serviceChargeMinor).toBe(3000)

    actAs('admin')
    updateSettings({ serviceChargeMinor: 5000 }) // PKR 50 going forward
    actAs('victor1')

    const second = await checkout({
      lines: [{ kind: 'PRODUCT', refId: seekh.productId, productPriceId: seekh.priceId, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    expect(second.order.serviceChargeMinor).toBe(5000)
    expect(second.order.totalMinor).toBe(10000 + 5000)

    // the first invoice is unchanged — still PKR 30
    const firstInv = db.select().from(schema.invoices).where(eq(schema.invoices.id, first.invoiceId)).get()!
    expect(firstInv.serviceChargeMinor).toBe(3000)
    expect(firstInv.totalMinor).toBe(13000)
  })

  it('a zero service charge produces no service-charge line', async () => {
    actAs('admin')
    updateSettings({ serviceChargeMinor: 0 })
    actAs('victor1')
    const seekh = priceFor('Seekh Kabab')
    const r = await checkout({
      lines: [{ kind: 'PRODUCT', refId: seekh.productId, productPriceId: seekh.priceId, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    expect(r.order.serviceChargeMinor).toBe(0)
    expect(r.order.totalMinor).toBe(10000)
  })

  it('rejects an unknown payment method', async () => {
    const seekh = priceFor('Seekh Kabab')
    await expect(
      checkout({
        lines: [{ kind: 'PRODUCT', refId: seekh.productId, productPriceId: seekh.priceId, quantity: 1 }],
        payment: { method: 'CRYPTO' },
        autoPrint: false
      })
    ).rejects.toThrow(/valid payment method/i)
  })

  it('deal lines are priced at the deal price and snapshot their components', async () => {
    const deal = db.select().from(schema.deals).get()!
    const r = await checkout({
      lines: [{ kind: 'DEAL', refId: deal.id, quantity: 2 }],
      payment: { method: 'CASH', tenderedMinor: 1000000 },
      autoPrint: false
    })
    expect(r.order.subtotalMinor).toBe(deal.priceMinor * 2)
    const line = db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, r.order.id)).get()!
    expect(line.kind).toBe('DEAL')
    expect(JSON.parse(line.componentsJson!).length).toBeGreaterThan(0)
  })

  it('refund is recorded as an immutable negative payment and flips status', async () => {
    const karahi = priceFor('Chicken Karahi', 'Half')
    const r = await checkout({
      lines: [{ kind: 'PRODUCT', refId: karahi.productId, productPriceId: karahi.priceId, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    actAs('admin')
    const updated = refundOrder(r.order.id, 20000, 'partial refund - hair in food')
    expect(updated.status).toBe('REFUNDED')
    const refund = db
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.orderId, r.order.id), eq(schema.payments.isRefund, true)))
      .get()!
    expect(refund.amountMinor).toBe(20000)
  })
})
