import { and, desc, eq, like, or, sql } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'
import type { Order, OrderLine, Paginated, Payment } from '@shared/types'
import type { CheckoutInput, HoldOrderInput, OrderListQuery } from '@shared/ipc'
import { audit } from './audit'
import { requireAdmin, requireAuth } from './context'
import { currentBusinessDate, getOrCreateBusinessDay } from './businessDay'
import { requireActiveSession } from './session'
import { getPaymentMethodByCode, getSettings } from './settings'
import { resolveLines, subtotalOf } from './pricing'
import { nextOrderNumber } from './numbering'
import { createInvoiceForOrder, getInvoiceByOrderId, printInvoiceById } from './invoices'

/* ------------------------------- mappers -------------------------------- */

function mapLine(r: typeof schema.orderLines.$inferSelect): OrderLine {
  return {
    id: r.id,
    orderId: r.orderId,
    kind: r.kind as OrderLine['kind'],
    refId: r.refId,
    productPriceId: r.productPriceId,
    name: r.name,
    nameUrdu: r.nameUrdu,
    variantLabel: r.variantLabel,
    quantity: r.quantity,
    unitPriceMinor: r.unitPriceMinor,
    lineDiscountMinor: r.lineDiscountMinor,
    lineTotalMinor: r.lineTotalMinor,
    note: r.note,
    components: r.componentsJson ? JSON.parse(r.componentsJson) : undefined
  }
}

function mapPayment(r: typeof schema.payments.$inferSelect): Payment {
  return {
    id: r.id,
    orderId: r.orderId,
    method: r.method,
    methodLabel: r.methodLabel,
    amountMinor: r.amountMinor,
    tenderedMinor: r.tenderedMinor,
    changeMinor: r.changeMinor,
    reference: r.reference,
    createdAt: r.createdAt,
    isRefund: r.isRefund
  }
}

export function mapOrder(r: typeof schema.orders.$inferSelect): Order {
  const user = db.select({ n: schema.users.fullName }).from(schema.users).where(eq(schema.users.id, r.userId)).get()
  const lines = db
    .select()
    .from(schema.orderLines)
    .where(eq(schema.orderLines.orderId, r.id))
    .orderBy(schema.orderLines.id)
    .all()
    .map(mapLine)
  const payments = db
    .select()
    .from(schema.payments)
    .where(eq(schema.payments.orderId, r.id))
    .orderBy(schema.payments.id)
    .all()
    .map(mapPayment)
  const invoice = getInvoiceByOrderId(r.id)
  return {
    id: r.id,
    orderNumber: r.orderNumber,
    status: r.status as Order['status'],
    userId: r.userId,
    userFullName: user?.n ?? 'Unknown',
    sessionId: r.sessionId,
    businessDayId: r.businessDayId,
    businessDate: r.businessDate,
    subtotalMinor: r.subtotalMinor,
    discountMinor: r.discountMinor,
    discountReason: r.discountReason,
    serviceChargeMinor: r.serviceChargeMinor,
    totalMinor: r.totalMinor,
    orderNote: r.orderNote,
    customerName: r.customerName,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    lines,
    payments,
    invoice
  }
}

export function getOrder(id: number): Order {
  const cu = requireAuth()
  const row = db.select().from(schema.orders).where(eq(schema.orders.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Order not found.')
  if (cu.role !== 'ADMIN' && row.userId !== cu.id)
    throw new AppError('UNAUTHORIZED', 'You can only view your own orders.')
  return mapOrder(row)
}

/* ------------------------------ discounts ------------------------------- */

function validateDiscount(subtotal: number, discountMinor: number, reason: string | undefined, isAdmin: boolean) {
  if (!discountMinor) return { discountMinor: 0, discountReason: null as string | null }
  if (!Number.isInteger(discountMinor) || discountMinor < 0)
    throw new AppError('VALIDATION', 'Discount must be a whole, non-negative amount.')
  if (discountMinor > subtotal) throw new AppError('VALIDATION', 'Discount cannot exceed the subtotal.')
  const settings = getSettings()
  if (!isAdmin) {
    if (!settings.allowEmployeeDiscount)
      throw new AppError('UNAUTHORIZED', 'Employees are not authorised to apply discounts.')
    const pct = (discountMinor / subtotal) * 100
    if (pct > settings.maxEmployeeDiscountPercent + 0.001)
      throw new AppError(
        'UNAUTHORIZED',
        `Discount exceeds the ${settings.maxEmployeeDiscountPercent}% limit for employees.`
      )
  }
  if (!reason || reason.trim().length < 3)
    throw new AppError('VALIDATION', 'Please give a reason for the discount.')
  return { discountMinor, discountReason: reason.trim() }
}

/* -------------------------------- hold --------------------------------- */

export function holdOrder(input: HoldOrderInput): Order {
  const cu = requireAuth()
  const session = requireActiveSession(cu.id)
  const resolved = resolveLines(input.lines)
  const subtotal = subtotalOf(resolved)
  const nowMs = Date.now()
  const bday = getOrCreateBusinessDay(currentBusinessDate(nowMs), nowMs)

  const orderId = db.transaction(() => {
    let id: number
    if (input.heldOrderId) {
      const existing = db.select().from(schema.orders).where(eq(schema.orders.id, input.heldOrderId)).get()
      if (!existing || existing.status !== 'HELD')
        throw new AppError('CONFLICT', 'That held order can no longer be updated.')
      if (existing.userId !== cu.id) throw new AppError('UNAUTHORIZED', 'That held order belongs to someone else.')
      db.delete(schema.orderLines).where(eq(schema.orderLines.orderId, existing.id)).run()
      id = existing.id
      db.update(schema.orders)
        .set({
          subtotalMinor: subtotal,
          totalMinor: subtotal,
          orderNote: input.orderNote?.trim() || null,
          customerName: input.customerName?.trim() || null
        })
        .where(eq(schema.orders.id, id))
        .run()
    } else {
      const orderNumber = nextOrderNumber(bday.businessDate)
      const res = db
        .insert(schema.orders)
        .values({
          orderNumber,
          status: 'HELD',
          userId: cu.id,
          sessionId: session.id,
          businessDayId: bday.id,
          businessDate: bday.businessDate,
          subtotalMinor: subtotal,
          totalMinor: subtotal,
          orderNote: input.orderNote?.trim() || null,
          customerName: input.customerName?.trim() || null
        })
        .run()
      id = Number(res.lastInsertRowid)
      db.insert(schema.heldOrderOwners).values({ orderId: id, userId: cu.id }).onConflictDoNothing().run()
    }
    for (const l of resolved) {
      db.insert(schema.orderLines)
        .values({
          orderId: id,
          kind: l.kind,
          refId: l.refId,
          productPriceId: l.productPriceId,
          name: l.name,
          nameUrdu: l.nameUrdu,
          variantLabel: l.variantLabel,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
          lineTotalMinor: l.lineTotalMinor,
          note: l.note,
          componentsJson: l.components ? JSON.stringify(l.components) : null
        })
        .run()
    }
    return id
  })

  audit({
    action: 'ORDER_HELD',
    summary: `${cu.fullName} held order ${db.select({ n: schema.orders.orderNumber }).from(schema.orders).where(eq(schema.orders.id, orderId)).get()?.n}`,
    entityType: 'order',
    entityId: orderId
  })
  return mapOrder(db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()!)
}

export function listHeldOrders(): Order[] {
  const cu = requireAuth()
  const conds = [eq(schema.orders.status, 'HELD')]
  if (cu.role !== 'ADMIN') conds.push(eq(schema.orders.userId, cu.id))
  const rows = db
    .select()
    .from(schema.orders)
    .where(and(...conds))
    .orderBy(desc(schema.orders.createdAt))
    .all()
  return rows.map(mapOrder)
}

export function resumeHeldOrder(orderId: number): Order {
  const cu = requireAuth()
  const row = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()
  if (!row || row.status !== 'HELD') throw new AppError('NOT_FOUND', 'That held order is no longer available.')
  if (cu.role !== 'ADMIN' && row.userId !== cu.id)
    throw new AppError('UNAUTHORIZED', 'That held order belongs to someone else.')
  return mapOrder(row)
}

export function deleteHeldOrder(orderId: number, reason?: string): void {
  const cu = requireAuth()
  const row = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()
  if (!row || row.status !== 'HELD') throw new AppError('NOT_FOUND', 'That held order is no longer available.')
  if (cu.role !== 'ADMIN' && row.userId !== cu.id)
    throw new AppError('UNAUTHORIZED', 'That held order belongs to someone else.')
  db.transaction(() => {
    db.delete(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)).run()
    db.delete(schema.heldOrderOwners).where(eq(schema.heldOrderOwners.orderId, orderId)).run()
    db.update(schema.orders)
      .set({ status: 'CANCELLED', cancelledAt: Date.now(), cancelledBy: cu.id, cancelReason: reason?.trim() || 'Held order discarded' })
      .where(eq(schema.orders.id, orderId))
      .run()
  })
  audit({
    action: 'ORDER_HELD_DISCARDED',
    summary: `${cu.fullName} discarded held order ${row.orderNumber}${reason ? ` — ${reason}` : ''}`,
    entityType: 'order',
    entityId: orderId
  })
}

/* ------------------------------ checkout ------------------------------- */

export interface CheckoutOutcome {
  order: Order
  invoiceId: number
}

export async function checkout(
  input: CheckoutInput
): Promise<CheckoutOutcome & { printed: boolean; printMessage: string }> {
  const cu = requireAuth()
  const session = requireActiveSession(cu.id)
  const bday = getOrCreateBusinessDay(currentBusinessDate())

  const resolved = resolveLines(input.lines)
  const subtotal = subtotalOf(resolved)
  const { discountMinor, discountReason } = validateDiscount(
    subtotal,
    input.discountMinor ?? 0,
    input.discountReason,
    cu.role === 'ADMIN'
  )
  // Fixed service charge (configurable in Settings, default PKR 30). Frozen
  // onto this order/invoice so a later settings change never rewrites it.
  const serviceChargeMinor = Math.max(0, Math.round(getSettings().serviceChargeMinor))
  const total = subtotal - discountMinor + serviceChargeMinor
  if (total < 0) throw new AppError('PAYMENT_INVALID', 'Order total cannot be negative.')

  const method = getPaymentMethodByCode(input.payment?.method ?? '')
  if (!method || !method.isActive) throw new AppError('PAYMENT_INVALID', 'Choose a valid payment method.')
  if (method.requiresReference && !(input.payment.reference && input.payment.reference.trim()))
    throw new AppError('PAYMENT_INVALID', `${method.label} payments need a reference.`)

  let tendered: number | null = null
  let change: number | null = null
  if (method.allowsChange) {
    tendered = input.payment.tenderedMinor ?? total
    if (!Number.isInteger(tendered) || tendered < total)
      throw new AppError('PAYMENT_INVALID', 'Amount tendered is less than the total due.')
    change = tendered - total
  }

  // --- everything financial happens in one transaction ---
  const result = db.transaction((): CheckoutOutcome => {
    let orderId: number
    const nowMs = Date.now()

    if (input.fromHeldOrderId) {
      const held = db.select().from(schema.orders).where(eq(schema.orders.id, input.fromHeldOrderId)).get()
      if (!held || held.status !== 'HELD')
        throw new AppError('CONFLICT', 'That held order has already been completed or discarded.')
      if (held.userId !== cu.id && cu.role !== 'ADMIN')
        throw new AppError('UNAUTHORIZED', 'That held order belongs to someone else.')
      orderId = held.id
      db.delete(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)).run()
      db.delete(schema.heldOrderOwners).where(eq(schema.heldOrderOwners.orderId, orderId)).run()
      db.update(schema.orders)
        .set({
          status: 'COMPLETED',
          sessionId: session.id,
          businessDayId: bday.id,
          businessDate: bday.businessDate,
          subtotalMinor: subtotal,
          discountMinor,
          discountReason,
          serviceChargeMinor,
          totalMinor: total,
          orderNote: input.orderNote?.trim() || held.orderNote,
          customerName: input.customerName?.trim() || held.customerName,
          completedAt: nowMs
        })
        .where(eq(schema.orders.id, orderId))
        .run()
    } else {
      const orderNumber = nextOrderNumber(bday.businessDate)
      const res = db
        .insert(schema.orders)
        .values({
          orderNumber,
          status: 'COMPLETED',
          userId: cu.id,
          sessionId: session.id,
          businessDayId: bday.id,
          businessDate: bday.businessDate,
          subtotalMinor: subtotal,
          discountMinor,
          discountReason,
          serviceChargeMinor,
          totalMinor: total,
          orderNote: input.orderNote?.trim() || null,
          customerName: input.customerName?.trim() || null,
          completedAt: nowMs
        })
        .run()
      orderId = Number(res.lastInsertRowid)
    }

    for (const l of resolved) {
      db.insert(schema.orderLines)
        .values({
          orderId,
          kind: l.kind,
          refId: l.refId,
          productPriceId: l.productPriceId,
          name: l.name,
          nameUrdu: l.nameUrdu,
          variantLabel: l.variantLabel,
          quantity: l.quantity,
          unitPriceMinor: l.unitPriceMinor,
          lineTotalMinor: l.lineTotalMinor,
          note: l.note,
          componentsJson: l.components ? JSON.stringify(l.components) : null
        })
        .run()
    }

    db.insert(schema.payments)
      .values({
        orderId,
        method: method.code,
        methodLabel: method.label,
        amountMinor: total,
        tenderedMinor: tendered,
        changeMinor: change,
        reference: input.payment.reference?.trim() || null,
        isRefund: false,
        createdBy: cu.id
      })
      .run()

    const invoiceId = createInvoiceForOrder(orderId, {
      tenderedMinor: tendered,
      changeMinor: change
    })

    return { order: mapOrder(db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()!), invoiceId }
  })

  audit({
    action: 'ORDER_COMPLETED',
    summary: `${cu.fullName} completed ${result.order.orderNumber} — ${(total / 100).toFixed(0)} via ${method.label}`,
    entityType: 'order',
    entityId: result.order.id,
    details: { subtotal, discountMinor, serviceChargeMinor, total, method: method.code }
  })

  // --- printing happens AFTER the commit; failure never loses the invoice ---
  let printed = false
  let printMessage = 'Printing skipped — mark as printed from the Invoices screen.'
  if (input.autoPrint !== false) {
    const outcome = await printInvoiceById(result.invoiceId, 'PRINT', cu.id)
    printed = outcome.ok
    printMessage = outcome.message
  }

  return {
    order: mapOrder(db.select().from(schema.orders).where(eq(schema.orders.id, result.order.id)).get()!),
    invoiceId: result.invoiceId,
    printed,
    printMessage
  }
}

/* ------------------------- cancel / refund ---------------------------- */

export function cancelOrder(orderId: number, reason: string): Order {
  const admin = requireAdmin()
  const row = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Order not found.')
  if (row.status === 'CANCELLED') throw new AppError('DUPLICATE_ACTION', 'That order is already cancelled.')
  if (row.status === 'REFUNDED') throw new AppError('CONFLICT', 'That order was refunded and cannot be cancelled.')
  if ((reason ?? '').trim().length < 3) throw new AppError('VALIDATION', 'Please give a cancellation reason.')

  // A completed order with an issued invoice is reversed with a full refund
  // rather than deletion — the invoice stays on the record forever.
  db.transaction(() => {
    if (row.status === 'COMPLETED') {
      const paid = db
        .select({ s: sql<number>`coalesce(sum(amount_minor),0)` })
        .from(schema.payments)
        .where(and(eq(schema.payments.orderId, orderId), eq(schema.payments.isRefund, false)))
        .get()!.s
      const refunded = db
        .select({ s: sql<number>`coalesce(sum(amount_minor),0)` })
        .from(schema.payments)
        .where(and(eq(schema.payments.orderId, orderId), eq(schema.payments.isRefund, true)))
        .get()!.s
      const outstanding = paid - refunded
      if (outstanding > 0) {
        db.insert(schema.payments)
          .values({
            orderId,
            method: 'CASH',
            methodLabel: 'Cash refund (cancellation)',
            amountMinor: outstanding,
            isRefund: true,
            reference: `Cancellation: ${reason.trim()}`,
            createdBy: admin.id
          })
          .run()
      }
    }
    db.update(schema.orders)
      .set({ status: 'CANCELLED', cancelledAt: Date.now(), cancelledBy: admin.id, cancelReason: reason.trim() })
      .where(eq(schema.orders.id, orderId))
      .run()
  })

  audit({
    action: 'ORDER_CANCELLED',
    summary: `Cancelled ${row.orderNumber} — ${reason.trim()}`,
    entityType: 'order',
    entityId: orderId
  })
  return mapOrder(db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()!)
}

export function refundOrder(orderId: number, amountMinor: number, reason: string, methodCode?: string): Order {
  const admin = requireAdmin()
  const row = db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Order not found.')
  if (row.status !== 'COMPLETED' && row.status !== 'REFUNDED')
    throw new AppError('CONFLICT', 'Only a completed order can be refunded.')
  if (!Number.isInteger(amountMinor) || amountMinor <= 0)
    throw new AppError('VALIDATION', 'Refund amount must be a positive whole amount.')
  if ((reason ?? '').trim().length < 3) throw new AppError('VALIDATION', 'Please give a refund reason.')

  const paid = db
    .select({ s: sql<number>`coalesce(sum(amount_minor),0)` })
    .from(schema.payments)
    .where(and(eq(schema.payments.orderId, orderId), eq(schema.payments.isRefund, false)))
    .get()!.s
  const alreadyRefunded = db
    .select({ s: sql<number>`coalesce(sum(amount_minor),0)` })
    .from(schema.payments)
    .where(and(eq(schema.payments.orderId, orderId), eq(schema.payments.isRefund, true)))
    .get()!.s
  if (amountMinor > paid - alreadyRefunded)
    throw new AppError('VALIDATION', 'Refund exceeds the amount still paid on this order.')

  const method = methodCode ? getPaymentMethodByCode(methodCode) : getPaymentMethodByCode('CASH')

  db.transaction(() => {
    db.insert(schema.payments)
      .values({
        orderId,
        method: method?.code ?? 'CASH',
        methodLabel: `${method?.label ?? 'Cash'} refund`,
        amountMinor,
        isRefund: true,
        reference: reason.trim(),
        createdBy: admin.id
      })
      .run()
    db.update(schema.orders).set({ status: 'REFUNDED' }).where(eq(schema.orders.id, orderId)).run()
  })

  audit({
    action: 'ORDER_REFUNDED',
    summary: `Refunded ${(amountMinor / 100).toFixed(0)} on ${row.orderNumber} — ${reason.trim()}`,
    entityType: 'order',
    entityId: orderId,
    details: { amountMinor, method: method?.code }
  })
  return mapOrder(db.select().from(schema.orders).where(eq(schema.orders.id, orderId)).get()!)
}

/* -------------------------------- list -------------------------------- */

export function listOrders(q: OrderListQuery): Paginated<Order> {
  const cu = requireAuth()
  const page = Math.max(1, q.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 25))
  const conds = []

  if (cu.role !== 'ADMIN') {
    conds.push(eq(schema.orders.userId, cu.id))
  } else if (q.userId) {
    conds.push(eq(schema.orders.userId, q.userId))
  }
  if (q.businessDate) conds.push(eq(schema.orders.businessDate, q.businessDate))
  if (q.sessionId) conds.push(eq(schema.orders.sessionId, q.sessionId))
  if (q.status) conds.push(eq(schema.orders.status, q.status))
  if (q.dateFrom) conds.push(sql`${schema.orders.businessDate} >= ${q.dateFrom}`)
  if (q.dateTo) conds.push(sql`${schema.orders.businessDate} <= ${q.dateTo}`)
  if (q.paymentMethod) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${schema.payments} p WHERE p.order_id = ${schema.orders.id} AND p.method = ${q.paymentMethod} AND p.is_refund = 0)`
    )
  }
  if (q.search) {
    const s = `%${q.search}%`
    conds.push(
      or(
        like(schema.orders.orderNumber, s),
        like(schema.orders.customerName, s),
        sql`EXISTS (SELECT 1 FROM ${schema.invoices} i WHERE i.order_id = ${schema.orders.id} AND i.invoice_number LIKE ${s})`
      )
    )
  }

  const where = conds.length ? and(...conds) : undefined
  const total = db.select({ c: sql<number>`count(*)` }).from(schema.orders).where(where).get()!.c
  const rows = db
    .select()
    .from(schema.orders)
    .where(where)
    .orderBy(desc(schema.orders.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return { rows: rows.map(mapOrder), total, page, pageSize }
}
