import { and, desc, eq, sql } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'
import type { BusinessDay } from '@shared/types'
import { businessDateKey } from '@shared/time'
import { requireAuth } from './context'
import { getBusinessDayConfig } from './settings'

/**
 * The business day here is a PURE REPORTING DIMENSION.
 *
 * The restaurant is always operational — there is no "open restaurant" /
 * "close restaurant" action, no gate on login or the POS, and a reporting
 * day NEVER bounds, resets or splits an employee session. Rows are created
 * lazily the first time an order or session lands on a given reporting date.
 *
 * `businessDateKey()` (configurable rollover hour, default 6 PM) only decides
 * which calendar label a timestamp is reported under.
 */

export function currentBusinessDate(at: number = Date.now()): string {
  return businessDateKey(at, getBusinessDayConfig())
}

/** Get (or lazily create) the reporting-day row for a label. */
export function getOrCreateBusinessDay(businessDate: string, activityAt: number = Date.now()): { id: number; businessDate: string } {
  db.insert(schema.businessDays)
    .values({ businessDate, firstActivityAt: activityAt })
    .onConflictDoNothing({ target: schema.businessDays.businessDate })
    .run()
  const row = db
    .select({ id: schema.businessDays.id, businessDate: schema.businessDays.businessDate })
    .from(schema.businessDays)
    .where(eq(schema.businessDays.businessDate, businessDate))
    .get()!
  return row
}

/** The reporting-day context for "now" — always available, never gated. */
export function currentBusinessDayContext(at: number = Date.now()): { id: number; businessDate: string } {
  return getOrCreateBusinessDay(currentBusinessDate(at), at)
}

function toDto(businessDate: string, id: number | null): BusinessDay {
  const orders = db
    .select({
      c: sql<number>`count(*)`,
      net: sql<number>`coalesce(sum(case when ${schema.orders.status} in ('COMPLETED','REFUNDED') then ${schema.orders.totalMinor} else 0 end),0)`
    })
    .from(schema.orders)
    .where(eq(schema.orders.businessDate, businessDate))
    .get()!
  const invoiceCount = db
    .select({ c: sql<number>`count(*)` })
    .from(schema.invoices)
    .where(eq(schema.invoices.businessDate, businessDate))
    .get()!.c
  const openSessions = db
    .select({ c: sql<number>`count(*)` })
    .from(schema.workSessions)
    .where(and(eq(schema.workSessions.businessDate, businessDate), eq(schema.workSessions.status, 'OPEN')))
    .get()!.c
  const firstActivityAt =
    (id != null
      ? db.select({ t: schema.businessDays.firstActivityAt }).from(schema.businessDays).where(eq(schema.businessDays.id, id)).get()?.t
      : null) ?? Date.now()
  return {
    id: id ?? 0,
    businessDate,
    firstActivityAt,
    orderCount: orders.c,
    invoiceCount,
    netMinor: orders.net,
    openSessionCount: openSessions
  }
}

/** Today's reporting day — created on demand, always returned. */
export function getCurrentBusinessDay(): BusinessDay {
  requireAuth()
  const { id, businessDate } = currentBusinessDayContext()
  return toDto(businessDate, id)
}

export function listBusinessDays(limit = 90): BusinessDay[] {
  requireAuth()
  const today = currentBusinessDate()
  const dates = new Set<string>([today])
  for (const r of db
    .selectDistinct({ d: schema.orders.businessDate })
    .from(schema.orders)
    .where(sql`${schema.orders.businessDate} is not null`)
    .orderBy(desc(schema.orders.businessDate))
    .limit(limit)
    .all()) {
    if (r.d) dates.add(r.d)
  }
  const idByDate = new Map(
    db.select({ id: schema.businessDays.id, d: schema.businessDays.businessDate }).from(schema.businessDays).all().map((r) => [r.d, r.id])
  )
  return [...dates]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, limit)
    .map((d) => toDto(d, idByDate.get(d) ?? null))
}

export function getBusinessDayById(id: number): BusinessDay {
  const row = db.select().from(schema.businessDays).where(eq(schema.businessDays.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'That reporting day has no recorded activity.')
  return toDto(row.businessDate, row.id)
}

export function getBusinessDayByDate(businessDate: string): BusinessDay {
  const row = db.select().from(schema.businessDays).where(eq(schema.businessDays.businessDate, businessDate)).get()
  return toDto(businessDate, row?.id ?? null)
}
