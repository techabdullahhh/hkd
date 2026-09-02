import { app } from 'electron'
import { statSync } from 'fs'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import type { DashboardStats } from '@shared/types'
import { getDbPath } from '../db/connection'
import { requireAdmin } from './context'
import { getCurrentBusinessDay, currentBusinessDate } from './businessDay'
import { computeSessionSummary } from './session'
import { probePrinter, getPrinterSettings } from './printer'

const startedAt = Date.now()

export async function getDashboardStats(): Promise<DashboardStats> {
  requireAdmin()
  const businessDay = getCurrentBusinessDay() // today's reporting day — always present
  const today = currentBusinessDate()

  let revenueMinor = 0
  let orderCount = 0
  let invoiceCount = 0
  let cancelledCount = 0
  let refundCount = 0
  let refundTotalMinor = 0
  let topProducts: DashboardStats['topProducts'] = []
  let salesByEmployee: DashboardStats['salesByEmployee'] = []

  {
    const orders = db.select().from(schema.orders).where(eq(schema.orders.businessDate, today)).all()
    const completed = orders.filter((o) => o.status === 'COMPLETED' || o.status === 'REFUNDED')
    orderCount = completed.length
    revenueMinor = completed.reduce((s, o) => s + o.totalMinor, 0)
    cancelledCount = orders.filter((o) => o.status === 'CANCELLED').length
    const ids = completed.map((o) => o.id)
    if (ids.length) {
      invoiceCount = db.select({ c: sql<number>`count(*)` }).from(schema.invoices).where(inArray(schema.invoices.orderId, ids)).get()!.c
      const refunds = db
        .select({ c: sql<number>`count(*)`, s: sql<number>`coalesce(sum(amount_minor),0)` })
        .from(schema.payments)
        .where(and(inArray(schema.payments.orderId, ids), eq(schema.payments.isRefund, true)))
        .get()!
      refundCount = refunds.c
      refundTotalMinor = refunds.s
      topProducts = db
        .select({
          name: schema.orderLines.name,
          quantity: sql<number>`sum(${schema.orderLines.quantity})`,
          revenueMinor: sql<number>`sum(${schema.orderLines.lineTotalMinor})`
        })
        .from(schema.orderLines)
        .where(inArray(schema.orderLines.orderId, ids))
        .groupBy(schema.orderLines.name)
        .orderBy(sql`sum(${schema.orderLines.quantity}) desc`)
        .limit(8)
        .all()
    }

    const byEmp = new Map<number, { userFullName: string; orderCount: number; salesMinor: number }>()
    for (const o of completed) {
      const u = db.select({ n: schema.users.fullName }).from(schema.users).where(eq(schema.users.id, o.userId)).get()
      const cur = byEmp.get(o.userId) ?? { userFullName: u?.n ?? 'Unknown', orderCount: 0, salesMinor: 0 }
      cur.orderCount += 1
      cur.salesMinor += o.totalMinor
      byEmp.set(o.userId, cur)
    }
    salesByEmployee = [...byEmp.values()].sort((a, b) => b.salesMinor - a.salesMinor)
  }

  const openSessions = db.select().from(schema.workSessions).where(eq(schema.workSessions.status, 'OPEN')).all()
  const activeSessions = openSessions.map((s) => {
    const sum = computeSessionSummary(s)
    return {
      sessionId: s.id,
      userFullName: sum.session.userFullName,
      openedAt: s.openedAt,
      orderCount: sum.orderCount,
      salesMinor: sum.netSales
    }
  })

  // sales by session across the last 20 sessions
  const recentSessions = db
    .select()
    .from(schema.workSessions)
    .orderBy(sql`${schema.workSessions.openedAt} desc`)
    .limit(20)
    .all()
  const salesBySession = recentSessions.map((s) => {
    const sum = s.status === 'CLOSED' && s.summaryJson ? JSON.parse(s.summaryJson) : computeSessionSummary(s)
    return {
      sessionId: s.id,
      userFullName: sum.session.userFullName,
      businessDate: s.businessDate ?? '',
      salesMinor: sum.netSales,
      orderCount: sum.orderCount
    }
  })

  const printerProbe = await probePrinter().catch(() => ({ reachable: false, message: 'Printer check unavailable.' }))
  const printer = getPrinterSettings()

  let dbSizeBytes = 0
  const dbPath = getDbPath()
  try {
    dbSizeBytes = statSync(dbPath).size
  } catch {
    dbSizeBytes = 0
  }
  const lastBackup = db.select().from(schema.backups).orderBy(sql`created_at desc`).get()

  return {
    businessDay,
    revenueMinor,
    orderCount,
    invoiceCount,
    cancelledCount,
    refundCount,
    refundTotalMinor,
    activeSessions,
    topProducts,
    salesByEmployee,
    salesBySession,
    printer: {
      reachable: printerProbe.reachable,
      message: printerProbe.message,
      selectedPrinter: printer.selectedPrinter
    },
    systemHealth: {
      dbSizeBytes,
      dbPath,
      lastBackupAt: lastBackup?.createdAt ?? null,
      appVersion: safeVersion(),
      uptimeMs: Date.now() - startedAt
    }
  }
}

function safeVersion(): string {
  try {
    return app.getVersion()
  } catch {
    return '0.0.0-dev'
  }
}
