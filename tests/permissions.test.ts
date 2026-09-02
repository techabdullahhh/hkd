import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, schema } from '../src/main/db/connection'
import { freshDb, teardown, actAs } from './helpers'
import { openSession } from '../src/main/services/session'
import { checkout, cancelOrder } from '../src/main/services/orders'
import { updatePrice, archiveProduct } from '../src/main/services/menu'
import { employeesReport } from '../src/main/services/reports'
import { createUser } from '../src/main/services/users'
import { updateSettings } from '../src/main/services/settings'
import { dispatch } from '../src/main/ipc/handlers'

function seekh(): { productId: number; priceId: number } {
  const p = db.select().from(schema.products).where(eq(schema.products.name, 'Seekh Kabab')).get()!
  const pr = db.select().from(schema.productPrices).where(eq(schema.productPrices.productId, p.id)).get()!
  return { productId: p.id, priceId: pr.id }
}

describe('role permissions', () => {
  beforeEach(() => {
    freshDb()
    actAs('admin')
  })
  afterEach(teardown)

  it('an employee cannot change a price', () => {
    const s = seekh()
    actAs('victor1')
    expect(() => updatePrice({ id: s.priceId, priceMinor: 1 })).toThrow(/administrator/i)
  })

  it('an employee cannot archive a product', () => {
    const s = seekh()
    actAs('victor1')
    expect(() => archiveProduct(s.productId)).toThrow(/administrator/i)
  })

  it('an employee cannot cancel an order', async () => {
    actAs('victor1')
    openSession()
    const s = seekh()
    const r = await checkout({
      lines: [{ kind: 'PRODUCT', refId: s.productId, productPriceId: s.priceId, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    expect(() => cancelOrder(r.order.id, 'changed mind')).toThrow(/administrator/i)
  })

  it('an employee cannot run admin reports or manage users or settings', () => {
    actAs('victor1')
    expect(() => employeesReport({ from: '2026-01-01', to: '2026-12-31' })).toThrow(/administrator/i)
    expect(() => createUser({ username: 'x', fullName: 'X Y', password: 'Passw0rd!', role: 'ADMIN' })).toThrow(/administrator/i)
    expect(() => updateSettings({ restaurantName: 'Hacked' })).toThrow(/administrator/i)
  })

  it('the IPC dispatcher blocks unauthenticated and non-admin calls', async () => {
    // unauthenticated
    ;(await import('../src/main/services/context')).setCurrentUser(null)
    const a = await dispatch('dashboard:stats', {})
    expect(a.ok).toBe(false)
    if (!a.ok) expect(a.error.code).toBe('UNAUTHENTICATED')

    // employee hitting an admin channel
    actAs('victor1')
    const b = await dispatch('users:list', {})
    expect(b.ok).toBe(false)
    if (!b.ok) expect(b.error.code).toBe('UNAUTHORIZED')

    // admin allowed
    actAs('admin')
    const c = await dispatch('users:list', {})
    expect(c.ok).toBe(true)
  })

  it('an admin CAN do all of the above', async () => {
    actAs('victor1')
    openSession()
    const s = seekh()
    const r = await checkout({
      lines: [{ kind: 'PRODUCT', refId: s.productId, productPriceId: s.priceId, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    actAs('admin')
    expect(() => updatePrice({ id: s.priceId, priceMinor: 12000, reason: 'cost up' })).not.toThrow()
    expect(cancelOrder(r.order.id, 'test cancel').status).toBe('CANCELLED')
    expect(employeesReport({ from: '2026-01-01', to: '2026-12-31' }).employees).toBeInstanceOf(Array)
  })

  it('the first account bootstraps as ADMIN; later signups are PENDING employees', async () => {
    // fresh, with NO dev users
    teardown()
    const { closeDatabase, initDatabase } = await import('../src/main/db/connection')
    closeDatabase()
    process.env.HKD_DB_PATH = ''
    freshDbNoUsers()
    const auth = await import('../src/main/services/auth')
    const first = auth.signup({ username: 'owner', fullName: 'The Owner', password: 'Passw0rd1' })
    expect(first.user.role).toBe('ADMIN')
    expect(first.user.status).toBe('ACTIVE')
    const second = auth.signup({ username: 'newbie', fullName: 'New Person', password: 'Passw0rd1' })
    expect(second.user.role).toBe('EMPLOYEE')
    expect(second.user.status).toBe('PENDING')
    void initDatabase
  })
})

import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { closeDatabase, initDatabase } from '../src/main/db/connection'
import { seedMenu } from '../src/main/db/seed'
import { setCurrentUser } from '../src/main/services/context'

function freshDbNoUsers(): void {
  closeDatabase()
  const dir = mkdtempSync(join(tmpdir(), 'hkd-nousers-'))
  process.env.HKD_DB_PATH = join(dir, 'test.db')
  initDatabase({ path: process.env.HKD_DB_PATH })
  seedMenu()
  setCurrentUser(null)
}
