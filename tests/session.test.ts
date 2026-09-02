import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '../src/main/db/connection'
import { freshDb, teardown, actAs } from './helpers'
import { openSession, closeSession, getSessionSummary, getCurrentSessionRow } from '../src/main/services/session'
import { checkout } from '../src/main/services/orders'
import { updateSettings } from '../src/main/services/settings'

function anyProductPrice(): { productId: number; priceId: number } {
  const price = db
    .select({ id: schema.productPrices.id, productId: schema.productPrices.productId })
    .from(schema.productPrices)
    .get()!
  return { productId: price.productId, priceId: price.id }
}

async function ringUpOne(): Promise<void> {
  const { productId, priceId } = anyProductPrice()
  await checkout({
    lines: [{ kind: 'PRODUCT', refId: productId, productPriceId: priceId, quantity: 1 }],
    payment: { method: 'CASH', tenderedMinor: 100000 },
    autoPrint: false
  })
}

describe('employee session — Victor 1 works 6 PM → 2 AM (no "open restaurant" step)', () => {
  beforeEach(() => {
    freshDb()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 1, 18, 0, 0)) // 6:00 PM Sep 1
  })
  afterEach(() => {
    vi.useRealTimers()
    teardown()
  })

  it('5 invoices before midnight + 6 after = 11 in the SAME active session — midnight never resets it', async () => {
    actAs('victor1') // plain employee, nobody opened anything
    vi.setSystemTime(new Date(2026, 8, 1, 18, 0, 0))
    const session = openSession()

    // 5 sales before midnight
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(new Date(2026, 8, 1, 21, i * 5, 0))
      await ringUpOne()
    }

    // midnight passes — 6 more sales (12:10 AM – 1:10 AM Sep 2)
    for (let i = 0; i < 6; i++) {
      vi.setSystemTime(new Date(2026, 8, 2, 0, 10 + i * 10, 0))
      await ringUpOne()
    }

    // the session is STILL the active one — check it live, before ending
    const live = getSessionSummary(session.id)
    expect(live.orderCount).toBe(11)
    expect(live.invoiceCount).toBe(11)

    vi.setSystemTime(new Date(2026, 8, 2, 2, 0, 0)) // 2:00 AM — employee ends the session
    const summary = closeSession(session.id)

    expect(summary.orderCount).toBe(11)
    expect(summary.invoiceCount).toBe(11)
    expect(summary.session.businessDate).toBe('2026-09-01') // started under this label, unchanged

    // every order and invoice references THIS one session
    const orders = db.select().from(schema.orders).where(eq(schema.orders.sessionId, session.id)).all()
    expect(orders).toHaveLength(11)
    const invoices = db.select().from(schema.invoices).where(eq(schema.invoices.sessionId, session.id)).all()
    expect(invoices).toHaveLength(11)

    // total revenue is one continuous number across midnight — 11 orders,
    // each carrying the PKR 30 service charge
    const revenue = orders.reduce((sum, o) => sum + o.totalMinor, 0)
    expect(summary.serviceChargeTotal).toBe(11 * 3000)
    expect(summary.grossSales).toBe(revenue - summary.serviceChargeTotal)
    expect(summary.netSales).toBe(revenue)
  })

  it('even with a MIDNIGHT reporting rollover, one session keeps 20 + 5 = 25 across two reporting dates', async () => {
    actAs('admin')
    updateSettings({ businessDayStartHour: 0 }) // reporting date = calendar date
    actAs('victor1')

    vi.setSystemTime(new Date(2026, 8, 1, 20, 0, 0))
    const session = openSession()
    for (let i = 0; i < 20; i++) {
      vi.setSystemTime(new Date(2026, 8, 1, 20 + Math.floor(i / 15), i, 0))
      await ringUpOne()
    }
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(new Date(2026, 8, 2, 0, 30 + i * 12, 0))
      await ringUpOne()
    }
    vi.setSystemTime(new Date(2026, 8, 2, 2, 0, 0))

    const summary = closeSession(session.id)
    expect(summary.orderCount).toBe(25) // session total — never split

    // the orders DID land on two different reporting dates
    const dates = new Set(
      db.select().from(schema.orders).where(eq(schema.orders.sessionId, session.id)).all().map((o) => o.businessDate)
    )
    expect(dates).toEqual(new Set(['2026-09-01', '2026-09-02']))
  })

  it('a second employee has a separate, independent session', async () => {
    actAs('victor1')
    const s1 = openSession()
    await ringUpOne()
    await ringUpOne()

    actAs('victor2')
    const s2 = openSession()
    await ringUpOne()

    actAs('admin')
    expect(getSessionSummary(s1.id).orderCount).toBe(2)
    expect(getSessionSummary(s2.id).orderCount).toBe(1)
    expect(s1.id).not.toBe(s2.id)
  })

  it('the frozen summary persists unchanged after the session closes', async () => {
    actAs('victor1')
    const s = openSession()
    await ringUpOne()
    const closed = closeSession(s.id)
    // later orders can never be attributed to a closed session
    const row = getCurrentSessionRow(actAs('victor1'))
    expect(row).toBeUndefined()
    const reread = getSessionSummary(s.id)
    expect(reread.orderCount).toBe(closed.orderCount)
    expect(reread.netSales).toBe(closed.netSales)
  })

  it('cannot open a second session while one is open', () => {
    actAs('victor1')
    openSession()
    expect(() => openSession()).toThrow(/open session/i)
  })
})
