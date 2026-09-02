import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'
import type { SessionSummary, WorkSession } from '@shared/types'
import { audit } from './audit'
import { getCurrentUser, requireAdmin, requireAuth } from './context'
import { currentBusinessDayContext } from './businessDay'

function toDto(row: typeof schema.workSessions.$inferSelect): WorkSession {
  const user = db
    .select({ n: schema.users.fullName })
    .from(schema.users)
    .where(eq(schema.users.id, row.userId))
    .get()
  return {
    id: row.id,
    userId: row.userId,
    userFullName: user?.n ?? 'Unknown',
    businessDate: row.businessDate ?? '',
    status: row.status as WorkSession['status'],
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    openingNote: row.openingNote,
    closingNote: row.closingNote
  }
}

export function getCurrentSessionRow(userId: number) {
  return db
    .select()
    .from(schema.workSessions)
    .where(and(eq(schema.workSessions.userId, userId), eq(schema.workSessions.status, 'OPEN')))
    .get()
}

export function getCurrentSession(): WorkSession | null {
  const cu = requireAuth()
  const row = getCurrentSessionRow(cu.id)
  return row ? toDto(row) : null
}

/** Used by the POS/checkout path. Fails loudly if no session is open. */
export function requireActiveSession(userId: number) {
  const row = getCurrentSessionRow(userId)
  if (!row) throw new AppError('NO_SESSION', 'You need to start a session before taking orders.')
  return row
}

export function openSession(openingNote?: string): WorkSession {
  const cu = requireAuth()
  // No "open restaurant" requirement — the restaurant is always operational.
  const existing = getCurrentSessionRow(cu.id)
  if (existing)
    throw new AppError('CONFLICT', 'You already have an open session. End it before starting a new one.')

  const now = Date.now()
  const bday = currentBusinessDayContext(now) // lazily records the reporting-day label
  const res = db
    .insert(schema.workSessions)
    .values({
      userId: cu.id,
      businessDayId: bday.id,
      businessDate: bday.businessDate,
      status: 'OPEN',
      openedAt: now,
      openingNote: openingNote?.trim() || null
    })
    .run()
  audit({
    action: 'SESSION_STARTED',
    summary: `${cu.fullName} started a session (reporting day ${bday.businessDate})`,
    entityType: 'work_session',
    entityId: Number(res.lastInsertRowid)
  })
  return toDto(db.select().from(schema.workSessions).where(eq(schema.workSessions.id, Number(res.lastInsertRowid))).get()!)
}

/**
 * Compute a session's performance PURELY from `orders.session_id`.
 *
 * There is deliberately NO date filter anywhere here. An order created at
 * 12:01 AM references the same open session as one created at 11:59 PM, so
 * both count. Midnight is irrelevant to session reporting.
 */
export function computeSessionSummary(sessionRow: typeof schema.workSessions.$inferSelect): SessionSummary {
  const session = toDto(sessionRow)
  const endMs = sessionRow.closedAt ?? Date.now()
  const durationMs = endMs - sessionRow.openedAt

  const completed = db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.sessionId, sessionRow.id), inArray(schema.orders.status, ['COMPLETED', 'REFUNDED'])))
    .all()

  const cancelledCount = db
    .select({ c: sql<number>`count(*)` })
    .from(schema.orders)
    .where(and(eq(schema.orders.sessionId, sessionRow.id), eq(schema.orders.status, 'CANCELLED')))
    .get()!.c

  const orderCount = completed.length
  const grossSales = completed.reduce((s, o) => s + o.subtotalMinor, 0)
  const discountTotal = completed.reduce((s, o) => s + o.discountMinor, 0)
  const serviceChargeTotal = completed.reduce((s, o) => s + o.serviceChargeMinor, 0)

  const orderIds = completed.map((o) => o.id)
  let refundTotal = 0
  const paymentBreakdownMap = new Map<string, { label: string; amount: number; count: number }>()

  if (orderIds.length) {
    const pays = db
      .select()
      .from(schema.payments)
      .where(inArray(schema.payments.orderId, orderIds))
      .all()
    for (const p of pays) {
      if (p.isRefund) {
        refundTotal += p.amountMinor
        continue
      }
      const cur = paymentBreakdownMap.get(p.method) ?? { label: p.methodLabel, amount: 0, count: 0 }
      cur.amount += p.amountMinor
      cur.count += 1
      paymentBreakdownMap.set(p.method, cur)
    }
  }

  const invoiceCount = db
    .select({ c: sql<number>`count(*)` })
    .from(schema.invoices)
    .where(eq(schema.invoices.sessionId, sessionRow.id))
    .get()!.c

  // net = product revenue − discounts + service charges − refunds
  const netSales = grossSales - discountTotal + serviceChargeTotal - refundTotal

  return {
    session,
    durationMs,
    orderCount,
    invoiceCount,
    grossSales,
    discountTotal,
    serviceChargeTotal,
    refundTotal,
    netSales,
    cancelledCount,
    paymentBreakdown: [...paymentBreakdownMap.entries()].map(([method, v]) => ({
      method,
      label: v.label,
      amount: v.amount,
      count: v.count
    }))
  }
}

export function getSessionSummary(sessionId: number): SessionSummary {
  const cu = requireAuth()
  const row = db.select().from(schema.workSessions).where(eq(schema.workSessions.id, sessionId)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Session not found.')
  if (cu.role !== 'ADMIN' && row.userId !== cu.id)
    throw new AppError('UNAUTHORIZED', 'You can only view your own session.')

  if (row.status === 'CLOSED' && row.summaryJson) {
    const frozen = JSON.parse(row.summaryJson) as SessionSummary
    return frozen
  }
  return computeSessionSummary(row)
}

export function closeSession(sessionId: number, closingNote?: string): SessionSummary {
  const cu = requireAuth()
  const row = db.select().from(schema.workSessions).where(eq(schema.workSessions.id, sessionId)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Session not found.')
  if (row.userId !== cu.id && cu.role !== 'ADMIN')
    throw new AppError('UNAUTHORIZED', 'You can only end your own session.')
  if (row.status === 'CLOSED') throw new AppError('DUPLICATE_ACTION', 'This session has already ended.')

  const heldForUser = db
    .select({ c: sql<number>`count(*)` })
    .from(schema.orders)
    .where(and(eq(schema.orders.sessionId, sessionId), eq(schema.orders.status, 'HELD')))
    .get()!.c
  if (heldForUser > 0)
    throw new AppError('CONFLICT', `You have ${heldForUser} held order(s). Complete or discard them before ending your session.`)

  const closedAt = Date.now()
  const summary = computeSessionSummary({ ...row, closedAt })
  // freeze the summary permanently
  db.update(schema.workSessions)
    .set({
      status: 'CLOSED',
      closedAt,
      closingNote: closingNote?.trim() || null,
      summaryJson: JSON.stringify({ ...summary, session: { ...summary.session, status: 'CLOSED', closedAt } })
    })
    .where(eq(schema.workSessions.id, sessionId))
    .run()

  audit({
    action: 'SESSION_ENDED',
    summary: `${summary.session.userFullName} ended session #${sessionId} — ${summary.orderCount} orders, net ${(summary.netSales / 100).toFixed(0)}`,
    entityType: 'work_session',
    entityId: sessionId,
    details: {
      orderCount: summary.orderCount,
      invoiceCount: summary.invoiceCount,
      grossSales: summary.grossSales,
      netSales: summary.netSales
    }
  })

  return getSessionSummary(sessionId)
}

export function listSessions(q: {
  userId?: number
  businessDate?: string
  limit?: number
}): WorkSession[] {
  const cu = requireAuth()
  const conds = []
  if (cu.role !== 'ADMIN') conds.push(eq(schema.workSessions.userId, cu.id))
  else if (q.userId) conds.push(eq(schema.workSessions.userId, q.userId))
  if (q.businessDate) conds.push(eq(schema.workSessions.businessDate, q.businessDate))
  const rows = db
    .select()
    .from(schema.workSessions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.workSessions.openedAt))
    .limit(q.limit ?? 100)
    .all()
  return rows.map(toDto)
}

export function listActiveSessions(): WorkSession[] {
  requireAdmin()
  const rows = db
    .select()
    .from(schema.workSessions)
    .where(eq(schema.workSessions.status, 'OPEN'))
    .orderBy(desc(schema.workSessions.openedAt))
    .all()
  return rows.map(toDto)
}

export function getCurrentSessionForUser(): WorkSession | null {
  const cu = getCurrentUser()
  if (!cu) return null
  const row = getCurrentSessionRow(cu.id)
  return row ? toDto(row) : null
}
