import { and, desc, eq, like, or, sql } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'
import type { Invoice, InvoiceLine, InvoiceSnapshot, Paginated } from '@shared/types'
import type { OrderListQuery } from '@shared/ipc'
import { renderInvoice } from '../printer/renderInvoice'
import { audit } from './audit'
import { requireAuth } from './context'
import { getSettings } from './settings'
import { getPrinterSettings, attemptPrint, getInvoiceLogo } from './printer'
import { nextInvoiceNumber } from './numbering'

function mapLine(r: typeof schema.invoiceLines.$inferSelect): InvoiceLine {
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    name: r.name,
    nameUrdu: r.nameUrdu,
    variantLabel: r.variantLabel,
    quantity: r.quantity,
    unitPriceMinor: r.unitPriceMinor,
    lineTotalMinor: r.lineTotalMinor
  }
}

export function mapInvoice(r: typeof schema.invoices.$inferSelect): Invoice {
  const lines = db
    .select()
    .from(schema.invoiceLines)
    .where(eq(schema.invoiceLines.invoiceId, r.id))
    .orderBy(schema.invoiceLines.id)
    .all()
    .map(mapLine)
  return {
    id: r.id,
    invoiceNumber: r.invoiceNumber,
    orderId: r.orderId,
    orderNumber: r.orderNumber,
    userId: r.userId,
    userFullName: r.userFullName,
    sessionId: r.sessionId,
    businessDayId: r.businessDayId,
    businessDate: r.businessDate,
    issuedAt: r.issuedAt,
    subtotalMinor: r.subtotalMinor,
    discountMinor: r.discountMinor,
    serviceChargeMinor: r.serviceChargeMinor,
    totalMinor: r.totalMinor,
    paymentMethod: r.paymentMethod,
    paymentMethodLabel: r.paymentMethodLabel,
    printStatus: r.printStatus as Invoice['printStatus'],
    printCount: r.printCount,
    lastPrintedAt: r.lastPrintedAt,
    lastPrintError: r.lastPrintError,
    lines,
    snapshot: JSON.parse(r.snapshotJson) as InvoiceSnapshot
  }
}

export function getInvoiceByOrderId(orderId: number): Invoice | null {
  const row = db.select().from(schema.invoices).where(eq(schema.invoices.orderId, orderId)).get()
  return row ? mapInvoice(row) : null
}

/**
 * Create the immutable invoice for a completed order. Must run inside the
 * checkout transaction. Builds a frozen JSON snapshot that carries
 * everything needed to reprint the invoice forever, independent of later
 * menu/price/settings changes.
 */
export function createInvoiceForOrder(orderId: number, extra: { tenderedMinor: number | null; changeMinor: number | null }): number {
  const order = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()
  if (!order) throw new AppError('NOT_FOUND', 'Order not found.')
  if (order.status !== 'COMPLETED') throw new AppError('CONFLICT', 'Only completed orders get an invoice.')

  const dup = db.select().from(schema.invoices).where(eq(schema.invoices.orderId, orderId)).get()
  if (dup) throw new AppError('DUPLICATE_ACTION', 'This order already has an invoice.')

  const lines = db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)).orderBy(schema.orderLines.id).all()
  const payment = db
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.orderId, orderId), eq(schema.payments.isRefund, false)))
    .get()
  if (!payment) throw new AppError('PAYMENT_INVALID', 'Cannot issue an invoice without a payment.')

  const user = db.select().from(schema.users).where(eq(schema.users.id, order.userId)).get()!
  const settings = getSettings()
  const printer = getPrinterSettings()
  const invoiceNumber = nextInvoiceNumber(order.businessDate!)
  const issuedAt = order.completedAt ?? Date.now()

  const snapshot: InvoiceSnapshot = {
    restaurantName: settings.restaurantName,
    restaurantNameUrdu: settings.restaurantNameUrdu,
    restaurantPhone: settings.restaurantPhone,
    restaurantAddress: settings.restaurantAddress,
    footerText: settings.invoiceFooter,
    paperWidth: printer.paperWidth,
    invoiceNumber,
    orderNumber: order.orderNumber,
    employeeName: user.fullName,
    sessionId: order.sessionId,
    businessDate: order.businessDate,
    issuedAt,
    lines: lines.map((l) => ({
      name: l.name,
      nameUrdu: l.nameUrdu,
      variantLabel: l.variantLabel,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      lineTotalMinor: l.lineTotalMinor
    })),
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    discountReason: order.discountReason,
    serviceChargeMinor: order.serviceChargeMinor,
    totalMinor: order.totalMinor,
    paymentMethodLabel: payment.methodLabel,
    tenderedMinor: extra.tenderedMinor,
    changeMinor: extra.changeMinor
  }

  const res = db
    .insert(schema.invoices)
    .values({
      invoiceNumber,
      orderId,
      orderNumber: order.orderNumber,
      userId: order.userId,
      userFullName: user.fullName,
      sessionId: order.sessionId,
      businessDayId: order.businessDayId,
      businessDate: order.businessDate,
      issuedAt,
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      serviceChargeMinor: order.serviceChargeMinor,
      totalMinor: order.totalMinor,
      paymentMethod: payment.method,
      paymentMethodLabel: payment.methodLabel,
      snapshotJson: JSON.stringify(snapshot),
      printStatus: 'NOT_PRINTED',
      printCount: 0
    })
    .run()
  const invoiceId = Number(res.lastInsertRowid)

  for (const l of lines) {
    db.insert(schema.invoiceLines)
      .values({
        invoiceId,
        name: l.name,
        nameUrdu: l.nameUrdu,
        variantLabel: l.variantLabel,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        lineTotalMinor: l.lineTotalMinor
      })
      .run()
  }

  audit({
    action: 'INVOICE_ISSUED',
    summary: `Invoice ${invoiceNumber} issued for ${order.orderNumber}`,
    entityType: 'invoice',
    entityId: invoiceId
  })
  return invoiceId
}

function getInvoiceRow(id: number) {
  const row = db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Invoice not found.')
  return row
}

export function getInvoice(id: number): Invoice {
  const cu = requireAuth()
  const row = getInvoiceRow(id)
  if (cu.role !== 'ADMIN' && row.userId !== cu.id)
    throw new AppError('UNAUTHORIZED', 'You can only view your own invoices.')
  return mapInvoice(row)
}

/**
 * Print (or reprint) an invoice. The invoice's OWN frozen paper width and
 * snapshot are used. Records a print_jobs row and updates print tracking.
 * An invoice is only ever marked PRINTED when the printer confirmed the job.
 */
export async function printInvoiceById(
  id: number,
  kind: 'PRINT' | 'REPRINT' | 'TEST',
  actorId?: number
): Promise<{ ok: boolean; message: string }> {
  const row = getInvoiceRow(id)
  const snapshot = JSON.parse(row.snapshotJson) as InvoiceSnapshot
  const doc = renderInvoice(snapshot, { logoDataUrl: getInvoiceLogo(snapshot.paperWidth) })

  const result = await attemptPrint(doc)

  db.insert(schema.printJobs)
    .values({
      invoiceId: id,
      kind,
      status: result.ok ? 'PRINTED' : 'FAILED',
      message: result.message,
      printerName: result.printerName ?? null,
      requestedBy: actorId ?? null
    })
    .run()

  if (result.ok) {
    db.update(schema.invoices)
      .set({
        printStatus: 'PRINTED',
        printCount: row.printCount + 1,
        lastPrintedAt: Date.now(),
        lastPrintError: null
      })
      .where(eq(schema.invoices.id, id))
      .run()
  } else {
    db.update(schema.invoices)
      .set({
        // never downgrade a previously successful print to FAILED
        printStatus: row.printStatus === 'PRINTED' ? 'PRINTED' : 'FAILED',
        lastPrintError: result.message
      })
      .where(eq(schema.invoices.id, id))
      .run()
  }

  return result
}

export async function printInvoice(id: number): Promise<Invoice> {
  const cu = requireAuth()
  const row = getInvoiceRow(id)
  if (cu.role !== 'ADMIN' && row.userId !== cu.id)
    throw new AppError('UNAUTHORIZED', 'You can only print your own invoices.')
  const res = await printInvoiceById(id, row.printCount > 0 ? 'REPRINT' : 'PRINT', cu.id)
  if (!res.ok) throw new AppError('PRINT_FAILED', res.message)
  return mapInvoice(getInvoiceRow(id))
}

export async function reprintInvoice(id: number, reason?: string): Promise<Invoice> {
  const cu = requireAuth()
  const row = getInvoiceRow(id)
  if (cu.role !== 'ADMIN' && row.userId !== cu.id)
    throw new AppError('UNAUTHORIZED', 'You can only reprint your own invoices.')
  const res = await printInvoiceById(id, 'REPRINT', cu.id)
  audit({
    action: 'INVOICE_REPRINTED',
    summary: `Reprinted ${row.invoiceNumber}${reason ? ` — ${reason}` : ''} (${res.ok ? 'ok' : 'failed'})`,
    entityType: 'invoice',
    entityId: id
  })
  if (!res.ok) throw new AppError('PRINT_FAILED', res.message)
  return mapInvoice(getInvoiceRow(id))
}

export async function testPrint(): Promise<{ ok: boolean; message: string }> {
  const cu = requireAuth()
  const settings = getSettings()
  const printer = getPrinterSettings()
  const now = Date.now()
  const svc = Math.max(0, Math.round(settings.serviceChargeMinor))
  const snapshot: InvoiceSnapshot = {
    restaurantName: settings.restaurantName,
    restaurantNameUrdu: settings.restaurantNameUrdu,
    restaurantPhone: settings.restaurantPhone,
    restaurantAddress: settings.restaurantAddress,
    footerText: 'This is a TEST print — not a real sale.',
    paperWidth: printer.paperWidth,
    invoiceNumber: 'TEST-0000',
    orderNumber: 'TEST',
    employeeName: cu.fullName,
    sessionId: null,
    businessDate: null,
    issuedAt: now,
    lines: [
      { name: 'Seekh Kabab', nameUrdu: 'سیخ کباب', variantLabel: null, quantity: 2, unitPriceMinor: 10000, lineTotalMinor: 20000 },
      { name: 'Chicken Karahi', nameUrdu: 'چکن کڑاہی', variantLabel: 'Half', quantity: 1, unitPriceMinor: 80000, lineTotalMinor: 80000 },
      { name: 'Naan', nameUrdu: 'نان', variantLabel: null, quantity: 4, unitPriceMinor: 3000, lineTotalMinor: 12000 }
    ],
    subtotalMinor: 112000,
    discountMinor: 0,
    discountReason: null,
    serviceChargeMinor: svc,
    totalMinor: 112000 + svc,
    paymentMethodLabel: 'Cash',
    tenderedMinor: 112000 + svc + 8000,
    changeMinor: 8000
  }
  const result = await attemptPrint(renderInvoice(snapshot, { logoDataUrl: getInvoiceLogo(snapshot.paperWidth) }))
  audit({ action: 'PRINTER_TEST', summary: `Test print ${result.ok ? 'succeeded' : 'failed'}: ${result.message}`, entityType: 'printer' })
  if (!result.ok) throw new AppError('PRINT_FAILED', result.message)
  return { ok: true, message: result.message }
}

export function listInvoices(q: OrderListQuery): Paginated<Invoice> {
  const cu = requireAuth()
  const page = Math.max(1, q.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25))
  const conds = []
  if (cu.role !== 'ADMIN') conds.push(eq(schema.invoices.userId, cu.id))
  else if (q.userId) conds.push(eq(schema.invoices.userId, q.userId))
  if (q.businessDate) conds.push(eq(schema.invoices.businessDate, q.businessDate))
  if (q.sessionId) conds.push(eq(schema.invoices.sessionId, q.sessionId))
  if (q.paymentMethod) conds.push(eq(schema.invoices.paymentMethod, q.paymentMethod))
  if (q.status) conds.push(eq(schema.invoices.printStatus, q.status))
  if (q.dateFrom) conds.push(sql`${schema.invoices.businessDate} >= ${q.dateFrom}`)
  if (q.dateTo) conds.push(sql`${schema.invoices.businessDate} <= ${q.dateTo}`)
  if (q.search) {
    const s = `%${q.search}%`
    conds.push(or(like(schema.invoices.invoiceNumber, s), like(schema.invoices.orderNumber, s), like(schema.invoices.userFullName, s)))
  }
  const where = conds.length ? and(...conds) : undefined
  const total = db.select({ c: sql<number>`count(*)` }).from(schema.invoices).where(where).get()!.c
  const rows = db
    .select()
    .from(schema.invoices)
    .where(where)
    .orderBy(desc(schema.invoices.issuedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()
  return { rows: rows.map(mapInvoice), total, page, pageSize }
}
