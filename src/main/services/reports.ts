import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'
import type { DateRangeQuery } from '@shared/ipc'
import { requireAdmin } from './context'
import { computeSessionSummary } from './session'

/**
 * Reporting.
 *
 * Two bucketing strategies, used deliberately:
 *  - Business-day / date-range reports filter on `orders.business_date`
 *    (the restaurant day label), NOT the calendar `created_at`.
 *  - Employee & session reports are computed PER SESSION from
 *    `orders.session_id`. A session that opened before midnight and closed
 *    after it is one contiguous bucket — midnight never splits it.
 */

interface Totals {
  orderCount: number
  invoiceCount: number
  grossMinor: number
  discountMinor: number
  serviceChargeMinor: number
  refundMinor: number
  netMinor: number
}

function emptyTotals(): Totals {
  return {
    orderCount: 0,
    invoiceCount: 0,
    grossMinor: 0,
    discountMinor: 0,
    serviceChargeMinor: 0,
    refundMinor: 0,
    netMinor: 0
  }
}

function dateRangeConds(q: DateRangeQuery) {
  if (!q.from || !q.to) throw new AppError('VALIDATION', 'A date range is required.')
  return and(gte(schema.orders.businessDate, q.from), lte(schema.orders.businessDate, q.to))
}

function totalsForOrders(orderRows: (typeof schema.orders.$inferSelect)[]): Totals {
  const t = emptyTotals()
  const completed = orderRows.filter((o) => o.status === 'COMPLETED' || o.status === 'REFUNDED')
  t.orderCount = completed.length
  t.grossMinor = completed.reduce((s, o) => s + o.subtotalMinor, 0)
  t.discountMinor = completed.reduce((s, o) => s + o.discountMinor, 0)
  t.serviceChargeMinor = completed.reduce((s, o) => s + o.serviceChargeMinor, 0)
  const ids = completed.map((o) => o.id)
  if (ids.length) {
    t.refundMinor = db
      .select({ s: sql<number>`coalesce(sum(amount_minor),0)` })
      .from(schema.payments)
      .where(and(inArray(schema.payments.orderId, ids), eq(schema.payments.isRefund, true)))
      .get()!.s
    t.invoiceCount = db
      .select({ c: sql<number>`count(*)` })
      .from(schema.invoices)
      .where(inArray(schema.invoices.orderId, ids))
      .get()!.c
  }
  t.netMinor = t.grossMinor - t.discountMinor + t.serviceChargeMinor - t.refundMinor
  return t
}

/**
 * A single reporting day's sales, bucketed by `orders.business_date`.
 * Sessions that touched this day are shown for context, but a session's
 * own totals are always the whole session (they are not split by date).
 */
export function businessDayReport(businessDate: string) {
  requireAdmin()
  if (!businessDate) throw new AppError('VALIDATION', 'A reporting date is required.')
  const orderRows = db.select().from(schema.orders).where(eq(schema.orders.businessDate, businessDate)).all()
  const totals = totalsForOrders(orderRows)
  const cancelled = orderRows.filter((o) => o.status === 'CANCELLED').length

  // sessions that produced at least one order on this reporting day
  const sessionIds = [...new Set(orderRows.map((o) => o.sessionId).filter((x): x is number => x != null))]
  const sessions = sessionIds
    .map((sid) => db.select().from(schema.workSessions).where(eq(schema.workSessions.id, sid)).get())
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => {
      const sum = s.status === 'CLOSED' && s.summaryJson ? JSON.parse(s.summaryJson) : computeSessionSummary(s)
      const dayOrders = orderRows.filter((o) => o.sessionId === s.id && (o.status === 'COMPLETED' || o.status === 'REFUNDED'))
      return {
        sessionId: s.id,
        employee: sum.session.userFullName,
        status: s.status,
        openedAt: s.openedAt,
        closedAt: s.closedAt,
        // this day's slice of the session
        orderCount: dayOrders.length,
        grossMinor: dayOrders.reduce((a, o) => a + o.subtotalMinor, 0),
        discountMinor: dayOrders.reduce((a, o) => a + o.discountMinor, 0),
        netMinor: dayOrders.reduce((a, o) => a + o.totalMinor, 0),
        // whole-session totals, for reference (never split by date)
        sessionOrderCount: sum.orderCount,
        sessionNetMinor: sum.netSales
      }
    })

  return {
    businessDay: { businessDate },
    totals: { ...totals, cancelledCount: cancelled },
    paymentBreakdown: paymentBreakdown(orderRows),
    sessions,
    topProducts: topProducts(orderRows),
    categoryBreakdown: categoryBreakdown(orderRows)
  }
}

function paymentBreakdown(orderRows: (typeof schema.orders.$inferSelect)[]) {
  const ids = orderRows.filter((o) => o.status === 'COMPLETED' || o.status === 'REFUNDED').map((o) => o.id)
  if (!ids.length) return []
  const rows = db
    .select({
      method: schema.payments.method,
      label: schema.payments.methodLabel,
      isRefund: schema.payments.isRefund,
      amount: sql<number>`sum(${schema.payments.amountMinor})`,
      count: sql<number>`count(*)`
    })
    .from(schema.payments)
    .where(inArray(schema.payments.orderId, ids))
    .groupBy(schema.payments.method, schema.payments.isRefund)
    .all()
  const map = new Map<string, { method: string; label: string; amountMinor: number; count: number }>()
  for (const r of rows) {
    const cur = map.get(r.method) ?? { method: r.method, label: r.label.replace(/ refund.*/i, ''), amountMinor: 0, count: 0 }
    cur.amountMinor += r.isRefund ? -r.amount : r.amount
    if (!r.isRefund) cur.count += r.count
    map.set(r.method, cur)
  }
  return [...map.values()]
}

function topProducts(orderRows: (typeof schema.orders.$inferSelect)[], limit = 10) {
  const ids = orderRows.filter((o) => o.status === 'COMPLETED' || o.status === 'REFUNDED').map((o) => o.id)
  if (!ids.length) return []
  return db
    .select({
      name: schema.orderLines.name,
      quantity: sql<number>`sum(${schema.orderLines.quantity})`,
      revenueMinor: sql<number>`sum(${schema.orderLines.lineTotalMinor})`
    })
    .from(schema.orderLines)
    .where(inArray(schema.orderLines.orderId, ids))
    .groupBy(schema.orderLines.name)
    .orderBy(sql`sum(${schema.orderLines.quantity}) desc`)
    .limit(limit)
    .all()
}

function categoryBreakdown(orderRows: (typeof schema.orders.$inferSelect)[]) {
  const ids = orderRows.filter((o) => o.status === 'COMPLETED' || o.status === 'REFUNDED').map((o) => o.id)
  if (!ids.length) return []
  return db
    .select({
      category: sql<string>`coalesce(${schema.categories.name}, ${schema.orderLines.variantLabel}, 'Other')`,
      quantity: sql<number>`sum(${schema.orderLines.quantity})`,
      revenueMinor: sql<number>`sum(${schema.orderLines.lineTotalMinor})`
    })
    .from(schema.orderLines)
    .leftJoin(schema.products, eq(schema.products.id, schema.orderLines.refId))
    .leftJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId))
    .where(inArray(schema.orderLines.orderId, ids))
    .groupBy(sql`1`)
    .orderBy(sql`sum(${schema.orderLines.lineTotalMinor}) desc`)
    .all()
}

export function dateRangeReport(q: DateRangeQuery) {
  requireAdmin()
  const rows = db.select().from(schema.orders).where(dateRangeConds(q)).all()
  const byDay = new Map<string, (typeof schema.orders.$inferSelect)[]>()
  for (const o of rows) {
    const k = o.businessDate ?? 'unknown'
    if (!byDay.has(k)) byDay.set(k, [])
    byDay.get(k)!.push(o)
  }
  const days = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([businessDate, dayRows]) => ({
      businessDate,
      ...totalsForOrders(dayRows),
      cancelledCount: dayRows.filter((o) => o.status === 'CANCELLED').length
    }))
  return { range: q, days, totals: totalsForOrders(rows), paymentBreakdown: paymentBreakdown(rows), topProducts: topProducts(rows) }
}

export function employeesReport(q: DateRangeQuery) {
  requireAdmin()
  // Session-based: every session whose START reporting-day falls in the range.
  // A session's totals are always the WHOLE session — never split by date,
  // even when it spans midnight.
  const sessions = db
    .select()
    .from(schema.workSessions)
    .where(and(gte(schema.workSessions.businessDate, q.from), lte(schema.workSessions.businessDate, q.to)))
    .all()

  const byEmployee = new Map<number, any>()
  for (const s of sessions) {
    const sum = s.status === 'CLOSED' && s.summaryJson ? JSON.parse(s.summaryJson) : computeSessionSummary(s)
    const cur =
      byEmployee.get(s.userId) ??
      {
        userId: s.userId,
        userFullName: sum.session.userFullName,
        sessionCount: 0,
        orderCount: 0,
        invoiceCount: 0,
        grossMinor: 0,
        discountMinor: 0,
        serviceChargeMinor: 0,
        refundMinor: 0,
        netMinor: 0
      }
    cur.sessionCount += 1
    cur.orderCount += sum.orderCount
    cur.invoiceCount += sum.invoiceCount
    cur.grossMinor += sum.grossSales
    cur.discountMinor += sum.discountTotal
    cur.serviceChargeMinor += sum.serviceChargeTotal ?? 0
    cur.refundMinor += sum.refundTotal
    cur.netMinor += sum.netSales
    byEmployee.set(s.userId, cur)
  }
  return { range: q, employees: [...byEmployee.values()].sort((a, b) => b.netMinor - a.netMinor) }
}

export function sessionsReport(q: DateRangeQuery) {
  requireAdmin()
  const sessions = db
    .select()
    .from(schema.workSessions)
    .where(and(gte(schema.workSessions.businessDate, q.from), lte(schema.workSessions.businessDate, q.to)))
    .all()
  return {
    range: q,
    sessions: sessions
      .map((s) => {
        const sum = s.status === 'CLOSED' && s.summaryJson ? JSON.parse(s.summaryJson) : computeSessionSummary(s)
        return {
          sessionId: s.id,
          businessDate: s.businessDate,
          employee: sum.session.userFullName,
          status: s.status,
          openedAt: s.openedAt,
          closedAt: s.closedAt,
          durationMs: (s.closedAt ?? Date.now()) - s.openedAt,
          orderCount: sum.orderCount,
          invoiceCount: sum.invoiceCount,
          grossMinor: sum.grossSales,
          discountMinor: sum.discountTotal,
          refundMinor: sum.refundTotal,
          netMinor: sum.netSales,
          paymentBreakdown: sum.paymentBreakdown
        }
      })
      .sort((a, b) => b.openedAt - a.openedAt)
  }
}

export function productsReport(q: DateRangeQuery) {
  requireAdmin()
  const rows = db.select().from(schema.orders).where(dateRangeConds(q)).all()
  return { range: q, products: topProducts(rows, 500) }
}

export function categoriesReport(q: DateRangeQuery) {
  requireAdmin()
  const rows = db.select().from(schema.orders).where(dateRangeConds(q)).all()
  return { range: q, categories: categoryBreakdown(rows) }
}

export function dealsReport(q: DateRangeQuery) {
  requireAdmin()
  const rows = db.select().from(schema.orders).where(dateRangeConds(q)).all()
  const ids = rows.filter((o) => o.status === 'COMPLETED' || o.status === 'REFUNDED').map((o) => o.id)
  if (!ids.length) return { range: q, deals: [] }
  const deals = db
    .select({
      name: schema.orderLines.name,
      quantity: sql<number>`sum(${schema.orderLines.quantity})`,
      revenueMinor: sql<number>`sum(${schema.orderLines.lineTotalMinor})`
    })
    .from(schema.orderLines)
    .where(and(inArray(schema.orderLines.orderId, ids), eq(schema.orderLines.kind, 'DEAL')))
    .groupBy(schema.orderLines.name)
    .orderBy(sql`sum(${schema.orderLines.lineTotalMinor}) desc`)
    .all()
  return { range: q, deals }
}

export function paymentsReport(q: DateRangeQuery) {
  requireAdmin()
  const rows = db.select().from(schema.orders).where(dateRangeConds(q)).all()
  return { range: q, methods: paymentBreakdown(rows) }
}

export function cancellationsReport(q: DateRangeQuery) {
  requireAdmin()
  const rows = db
    .select()
    .from(schema.orders)
    .where(and(dateRangeConds(q), eq(schema.orders.status, 'CANCELLED')))
    .all()
  return {
    range: q,
    count: rows.length,
    orders: rows.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      businessDate: o.businessDate,
      totalMinor: o.totalMinor,
      cancelledAt: o.cancelledAt,
      reason: o.cancelReason
    }))
  }
}

export function refundsReport(q: DateRangeQuery) {
  requireAdmin()
  const orderRows = db.select().from(schema.orders).where(dateRangeConds(q)).all()
  const ids = orderRows.map((o) => o.id)
  if (!ids.length) return { range: q, count: 0, totalMinor: 0, refunds: [] }
  const refunds = db
    .select()
    .from(schema.payments)
    .where(and(inArray(schema.payments.orderId, ids), eq(schema.payments.isRefund, true)))
    .all()
  const orderById = new Map(orderRows.map((o) => [o.id, o]))
  return {
    range: q,
    count: refunds.length,
    totalMinor: refunds.reduce((s, r) => s + r.amountMinor, 0),
    refunds: refunds.map((r) => ({
      id: r.id,
      orderNumber: orderById.get(r.orderId)?.orderNumber ?? '',
      businessDate: orderById.get(r.orderId)?.businessDate ?? null,
      amountMinor: r.amountMinor,
      method: r.methodLabel,
      reason: r.reference,
      createdAt: r.createdAt
    }))
  }
}
