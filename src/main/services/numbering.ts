import { eq, like, sql } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { getSettings } from './settings'

function compact(businessDate: string): string {
  return businessDate.replace(/-/g, '')
}

/**
 * Next order number for a reporting day, e.g. ORD-20260901-0007.
 * Called inside the checkout transaction so the count is consistent.
 * The sequence is per reporting-day label — it has nothing to do with
 * sessions and never resets one.
 */
export function nextOrderNumber(businessDate: string): string {
  const prefix = getSettings().orderPrefix || 'ORD'
  const n = db
    .select({ c: sql<number>`count(*)` })
    .from(schema.orders)
    .where(eq(schema.orders.businessDate, businessDate))
    .get()!.c
  return `${prefix}-${compact(businessDate)}-${String(n + 1).padStart(4, '0')}`
}

/**
 * Next invoice number for a reporting day, e.g. INV-20260901-0007.
 * The uniqueness index on invoices.invoice_number is the final guard.
 */
export function nextInvoiceNumber(businessDate: string): string {
  const prefix = getSettings().invoicePrefix || 'INV'
  const base = `${prefix}-${compact(businessDate)}-`
  const n = db
    .select({ c: sql<number>`count(*)` })
    .from(schema.invoices)
    .where(like(schema.invoices.invoiceNumber, `${base}%`))
    .get()!.c
  let seq = n + 1
  // defensive: skip collisions if a number was ever reserved out of band
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = `${base}${String(seq).padStart(4, '0')}`
    const exists = db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.invoiceNumber, candidate))
      .get()
    if (!exists) return candidate
    seq += 1
  }
}
