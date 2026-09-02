import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, schema } from '../src/main/db/connection'
import { freshDb, teardown } from './helpers'
import { dispatch } from '../src/main/ipc/handlers'
import { setCurrentUser } from '../src/main/services/context'

async function ok<T = any>(channel: any, payload?: any): Promise<T> {
  const r = await dispatch(channel, payload ?? {})
  if (!r.ok) throw new Error(`${channel} failed: ${r.error.code} ${r.error.message}`)
  return r.data as T
}

/** End-to-end through the exact IPC surface the renderer uses. */
describe('full POS workflow via IPC dispatch', () => {
  beforeEach(() => {
    freshDb()
    setCurrentUser(null)
  })
  afterEach(teardown)

  it('login → start session (no "open restaurant") → sell → invoice → end session summary', async () => {
    // clear forced-password flags so login succeeds cleanly
    db.update(schema.users).set({ mustChangePassword: false }).run()

    // an employee signs in and starts a session — NO admin action first
    await ok('auth:login', { username: 'victor1', password: 'Victor@12345' })
    let session = await ok('session:current')
    expect(session).toBeNull()
    session = await ok('session:open', {})
    expect(session.status).toBe('OPEN')
    const today = (await ok('businessDay:current')).businessDate

    // read the POS menu
    const menu = await ok('menu:posMenu')
    expect(menu.categories.length).toBeGreaterThan(0)
    const seekh = menu.products.find((p: any) => p.name === 'Seekh Kabab')
    const karahi = menu.products.find((p: any) => p.name === 'Chicken Karahi')

    // hold an order, then resume + check out
    const held = await ok('pos:holdOrder', {
      lines: [{ kind: 'PRODUCT', refId: seekh.id, productPriceId: seekh.prices[0].id, quantity: 2 }]
    })
    expect((await ok<any[]>('pos:heldOrders')).length).toBe(1)

    const checkout = await ok('pos:checkout', {
      lines: [
        { kind: 'PRODUCT', refId: seekh.id, productPriceId: seekh.prices[0].id, quantity: 2 },
        { kind: 'PRODUCT', refId: karahi.id, productPriceId: karahi.prices.find((x: any) => x.label === 'Half').id, quantity: 1 }
      ],
      payment: { method: 'CASH', tenderedMinor: 200000 },
      fromHeldOrderId: held.id,
      autoPrint: false
    })
    expect(checkout.order.status).toBe('COMPLETED')
    expect(checkout.order.subtotalMinor).toBe(2 * 10000 + 80000)
    expect(checkout.order.serviceChargeMinor).toBe(3000)
    expect(checkout.order.totalMinor).toBe(2 * 10000 + 80000 + 3000)
    expect(checkout.invoice.serviceChargeMinor).toBe(3000)
    expect(checkout.invoice.invoiceNumber).toMatch(/^INV-/)
    expect(checkout.invoice.sessionId).toBe(session.id)
    expect(checkout.invoice.businessDate).toBe(today)

    // held order is gone
    expect((await ok<any[]>('pos:heldOrders')).length).toBe(0)

    // a couple more sales
    for (let i = 0; i < 3; i++) {
      await ok('pos:checkout', {
        lines: [{ kind: 'PRODUCT', refId: seekh.id, productPriceId: seekh.prices[0].id, quantity: 1 }],
        payment: { method: 'CARD' },
        autoPrint: false
      })
    }

    // employee's own session summary
    const mySummary = await ok('session:summary', { sessionId: session.id })
    expect(mySummary.orderCount).toBe(4)
    expect(mySummary.invoiceCount).toBe(4)

    // end the session → frozen summary
    const closed = await ok('session:close', { sessionId: session.id })
    expect(closed.orderCount).toBe(4)
    expect(closed.session.status).toBe('CLOSED')
    expect(closed.paymentBreakdown.map((p: any) => p.method).sort()).toEqual(['CARD', 'CASH'])

    // admin dashboard reflects today's reporting day
    await ok('auth:login', { username: 'admin', password: 'Admin@12345' })
    const dash = await ok('dashboard:stats')
    expect(dash.orderCount).toBe(4)
    expect(dash.invoiceCount).toBe(4)
    expect(dash.revenueMinor).toBeGreaterThan(0)
    expect(dash.businessDay.businessDate).toBe(today)

    // reporting-day report — bucketed by date, no open/close
    const rpt = await ok('reports:businessDay', { businessDate: today })
    expect(rpt.totals.orderCount).toBe(4)
    expect(rpt.sessions[0].sessionOrderCount).toBe(4)
  })

  it('an employee can start a session with NO prior admin action; checkout still needs a session', async () => {
    db.update(schema.users).set({ mustChangePassword: false }).run()
    await ok('auth:login', { username: 'victor1', password: 'Victor@12345' })

    const menuBefore = await ok('menu:posMenu')
    const s = menuBefore.products.find((p: any) => p.name === 'Seekh Kabab')

    // checkout without a session is refused
    const noSession0 = await dispatch('pos:checkout', {
      lines: [{ kind: 'PRODUCT', refId: s.id, productPriceId: s.prices[0].id, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    expect(noSession0.ok).toBe(false)
    if (!noSession0.ok) expect(noSession0.error.code).toBe('NO_SESSION')

    // but the employee can open one immediately, with no admin/"open restaurant" step
    const session = await ok('session:open', {})
    expect(session.status).toBe('OPEN')

    // and now checkout works
    const done = await ok('pos:checkout', {
      lines: [{ kind: 'PRODUCT', refId: s.id, productPriceId: s.prices[0].id, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    expect(done.order.status).toBe('COMPLETED')
    expect(done.order.sessionId).toBe(session.id)
  })
})
