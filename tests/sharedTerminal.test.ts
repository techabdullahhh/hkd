/**
 * One PC, several people, back-to-back shifts.
 *
 * This is how the restaurant actually runs the software: a single terminal
 * that two or three staff share, each taking a five-to-six hour slot. Nobody
 * gets their own machine, so everything depends on *who is signed in* being
 * the only thing that decides whose numbers a sale lands on.
 *
 * The risks worth pinning down are all about the handover:
 *   - signing out must not end the session someone is midway through
 *   - the next person's sales must not touch the previous person's totals
 *   - a session left open at the end of a shift must be closable by the admin
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '../src/main/db/connection'
import { freshDb, teardown, actAs } from './helpers'
import { setCurrentUser } from '../src/main/services/context'
import * as auth from '../src/main/services/auth'
import {
  openSession,
  closeSession,
  getSessionSummary,
  getCurrentSessionRow,
  listActiveSessions
} from '../src/main/services/session'
import { checkout } from '../src/main/services/orders'

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

/** Sign in for real (token and all), the way the shared terminal does. */
function signIn(username: string, password: string): string {
  const res = auth.login({ username, password })
  return res.token
}

/** Clear the forced first-login password change so login() is usable. */
function readyAccount(username: string): void {
  db.update(schema.users)
    .set({ mustChangePassword: false })
    .where(eq(schema.users.username, username))
    .run()
}

describe('shared terminal — two employees, back-to-back shifts on one PC', () => {
  beforeEach(() => {
    freshDb()
    readyAccount('victor1')
    readyAccount('victor2')
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 1, 16, 0, 0)) // 4 PM, start of shift one
  })
  afterEach(() => {
    vi.useRealTimers()
    teardown()
  })

  it('signing out mid-shift does NOT end the session — it is still open on the way back in', () => {
    const token = signIn('victor1', 'Victor@12345')
    const opened = openSession()

    // The employee steps away and signs out of the terminal.
    auth.logout(token)
    expect(db.select().from(schema.authTokens).where(eq(schema.authTokens.token, token)).get()).toBeUndefined()

    // Back at the till ten minutes later.
    vi.setSystemTime(new Date(2026, 8, 1, 16, 10, 0))
    signIn('victor1', 'Victor@12345')
    const still = getCurrentSessionRow(
      db.select().from(schema.users).where(eq(schema.users.username, 'victor1')).get()!.id
    )
    expect(still?.id).toBe(opened.id)
    expect(still?.status).toBe('OPEN')
  })

  it('a full handover keeps each shift’s takings entirely separate', async () => {
    // ---- Shift one: 4 PM to 10 PM, three sales.
    const t1 = signIn('victor1', 'Victor@12345')
    const s1 = openSession()
    await ringUpOne()
    await ringUpOne()
    await ringUpOne()

    vi.setSystemTime(new Date(2026, 8, 1, 22, 0, 0))
    const shiftOne = closeSession(s1.id, 'End of shift')
    auth.logout(t1)

    // ---- Shift two: the next person signs in on the same PC.
    signIn('victor2', 'Victor@12345')
    const s2 = openSession()
    await ringUpOne()
    await ringUpOne()

    expect(shiftOne.orderCount).toBe(3)
    expect(getSessionSummary(s2.id).orderCount).toBe(2)

    // On a shared PC this matters: the person on shift two cannot read what
    // the person on shift one took.
    expect(() => getSessionSummary(s1.id)).toThrow(/only view your own session/i)

    // The admin can, and the first shift's frozen total is untouched by
    // anything the second one did.
    actAs('admin')
    expect(getSessionSummary(s1.id).orderCount).toBe(3)
    expect(getSessionSummary(s1.id).netSales).toBe(shiftOne.netSales)
  })

  it('a sale is attributed to whoever is signed in, never to the terminal', async () => {
    signIn('victor1', 'Victor@12345')
    const s1 = openSession()
    await ringUpOne()
    closeSession(s1.id)

    signIn('victor2', 'Victor@12345')
    const s2 = openSession()
    await ringUpOne()

    const owners = db
      .select({ sessionId: schema.orders.sessionId, userId: schema.orders.userId })
      .from(schema.orders)
      .all()
    const v1 = db.select().from(schema.users).where(eq(schema.users.username, 'victor1')).get()!
    const v2 = db.select().from(schema.users).where(eq(schema.users.username, 'victor2')).get()!

    expect(owners.filter((o) => o.userId === v1.id).map((o) => o.sessionId)).toEqual([s1.id])
    expect(owners.filter((o) => o.userId === v2.id).map((o) => o.sessionId)).toEqual([s2.id])
  })

  it('overlapping shifts are fine — both people can hold an open session at once', async () => {
    signIn('victor1', 'Victor@12345')
    const s1 = openSession()
    await ringUpOne()

    // The next person comes on before the first has closed out.
    signIn('victor2', 'Victor@12345')
    const s2 = openSession()
    await ringUpOne()
    await ringUpOne()

    actAs('admin')
    const active = listActiveSessions()
    expect(active.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort())
    expect(getSessionSummary(s1.id).orderCount).toBe(1)
    expect(getSessionSummary(s2.id).orderCount).toBe(2)
  })
})

describe('shared terminal — a session left open at the end of a shift', () => {
  beforeEach(() => {
    freshDb()
    readyAccount('victor1')
  })
  afterEach(teardown)

  it('the admin can close it for them; another employee cannot', async () => {
    signIn('victor1', 'Victor@12345')
    const s1 = openSession()
    await ringUpOne()

    // Someone else on the same terminal must not be able to close it.
    readyAccount('victor2')
    signIn('victor2', 'Victor@12345')
    expect(() => closeSession(s1.id)).toThrow(/only end your own session/i)

    // The owner/admin can, and the takings are preserved in the frozen summary.
    actAs('admin')
    const summary = closeSession(s1.id, 'Closed by admin — staff went home')
    expect(summary.orderCount).toBe(1)
    expect(getSessionSummary(s1.id).session.status).toBe('CLOSED')
  })

  it('refuses to close while an order is still held, so nothing is silently stranded', async () => {
    signIn('victor1', 'Victor@12345')
    const s1 = openSession()
    const { productId, priceId } = anyProductPrice()
    const { holdOrder } = await import('../src/main/services/orders')
    holdOrder({ lines: [{ kind: 'PRODUCT', refId: productId, productPriceId: priceId, quantity: 1 }] })

    actAs('admin')
    expect(() => closeSession(s1.id)).toThrow(/held order/i)
  })
})

describe('shared terminal — account setup for the PC', () => {
  beforeEach(freshDb)
  afterEach(teardown)

  it('an employee the admin has not approved cannot sign in and start ringing up sales', () => {
    setCurrentUser(null)
    auth.signup({ username: 'newhire', fullName: 'New Hire', password: 'Newhire@12345' })
    const row = db.select().from(schema.users).where(eq(schema.users.username, 'newhire')).get()!
    // Seeded dev users already exist here, so this is never the bootstrap account.
    expect(row.role).toBe('EMPLOYEE')
    expect(row.status).toBe('PENDING')
    expect(() => auth.login({ username: 'newhire', password: 'Newhire@12345' })).toThrow()
  })
})
