import { afterEach, describe, expect, it, vi } from 'vitest'
import { businessDateKey, businessDayEnd, businessDayStart, isWithinBusinessDay } from '../src/shared/time'
import { freshDb, teardown, actAs } from './helpers'
import {
  currentBusinessDate,
  getCurrentBusinessDay,
  getOrCreateBusinessDay,
  listBusinessDays
} from '../src/main/services/businessDay'
import { openSession } from '../src/main/services/session'
import { checkout } from '../src/main/services/orders'
import { db, schema } from '../src/main/db/connection'

const CFG = { startHour: 18, lengthHours: 12 }

describe('businessDateKey — the reporting day crosses midnight (labels only)', () => {
  it('buckets 11:59 PM and 12:01 AM into the SAME reporting day', () => {
    expect(businessDateKey(new Date(2026, 8, 1, 23, 59), CFG)).toBe('2026-09-01')
    expect(businessDateKey(new Date(2026, 8, 2, 0, 1), CFG)).toBe('2026-09-01')
    expect(businessDateKey(new Date(2026, 8, 2, 1, 0), CFG)).toBe('2026-09-01')
  })

  it('5:59 AM still belongs to the previous calendar date; 6:00 PM starts the next', () => {
    expect(businessDateKey(new Date(2026, 8, 2, 5, 59), CFG)).toBe('2026-09-01')
    expect(businessDateKey(new Date(2026, 8, 2, 17, 59), CFG)).toBe('2026-09-01')
    expect(businessDateKey(new Date(2026, 8, 2, 18, 0), CFG)).toBe('2026-09-02')
  })

  it('a midnight rollover (startHour 0) gives pure calendar dates', () => {
    const c = { startHour: 0, lengthHours: 24 }
    expect(businessDateKey(new Date(2026, 8, 1, 23, 59), c)).toBe('2026-09-01')
    expect(businessDateKey(new Date(2026, 8, 2, 0, 1), c)).toBe('2026-09-02')
  })

  it('the window helper still spans midnight', () => {
    expect(businessDayStart('2026-09-01', CFG).getHours()).toBe(18)
    expect(businessDayEnd('2026-09-01', CFG).getDate()).toBe(2)
    expect(isWithinBusinessDay(new Date(2026, 8, 2, 2, 0), '2026-09-01', CFG)).toBe(true)
  })
})

describe('reporting-day dimension — no open/close, no gate', () => {
  afterEach(teardown)

  it('an employee can start a session and sell with NO admin action first', async () => {
    freshDb()
    actAs('victor1') // plain employee, nobody "opened" anything
    const session = openSession()
    expect(session.status).toBe('OPEN')

    const price = db.select().from(schema.productPrices).get()!
    const r = await checkout({
      lines: [{ kind: 'PRODUCT', refId: price.productId, productPriceId: price.id, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    expect(r.order.status).toBe('COMPLETED')
    expect(r.order.businessDate).toBe(currentBusinessDate())
  })

  it('reporting-day rows are created lazily and today is always available', () => {
    freshDb()
    actAs('admin')
    const today = getCurrentBusinessDay()
    expect(today.businessDate).toBe(currentBusinessDate())
    // idempotent
    const a = getOrCreateBusinessDay('2026-09-01')
    const b = getOrCreateBusinessDay('2026-09-01')
    expect(a.id).toBe(b.id)
  })

  it('opening a session at 1 AM labels it under the previous calendar date', () => {
    freshDb()
    actAs('victor1')
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 2, 1, 0, 0)) // 1 AM Sep 2
    const s = openSession()
    expect(s.businessDate).toBe('2026-09-01')
    vi.useRealTimers()
  })

  it('listBusinessDays returns distinct dates that had activity (no status)', async () => {
    freshDb()
    actAs('victor1')
    openSession()
    const price = db.select().from(schema.productPrices).get()!
    await checkout({
      lines: [{ kind: 'PRODUCT', refId: price.productId, productPriceId: price.id, quantity: 1 }],
      payment: { method: 'CASH', tenderedMinor: 100000 },
      autoPrint: false
    })
    const days = listBusinessDays()
    expect(days.length).toBeGreaterThanOrEqual(1)
    expect(days[0]).not.toHaveProperty('status')
    expect(days.some((d) => d.businessDate === currentBusinessDate())).toBe(true)
  })
})
