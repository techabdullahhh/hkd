import { asc, eq, sql } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'
import type { AppSettings, PaymentMethod } from '@shared/types'
import type { BusinessDayConfig } from '@shared/time'
import { audit } from './audit'
import { requireAdmin } from './context'

const DEFAULTS: AppSettings = {
  restaurantName: 'HASHMI KA DERA',
  restaurantNameUrdu: 'ہاشمی کا ڈیرہ',
  restaurantPhone: '',
  restaurantAddress: '',
  invoiceFooter: 'Thank you for dining with us!',
  serviceChargeMinor: 3000, // PKR 30
  businessDayStartHour: 18,
  businessDayLengthHours: 12,
  allowEmployeeDiscount: false,
  maxEmployeeDiscountPercent: 10,
  invoicePrefix: 'INV',
  orderPrefix: 'ORD'
}

type Key = keyof AppSettings

function coerce<K extends Key>(key: K, raw: string): AppSettings[K] {
  const def = DEFAULTS[key]
  if (typeof def === 'number') return Number(raw) as AppSettings[K]
  if (typeof def === 'boolean') return (raw === 'true' || raw === '1') as AppSettings[K]
  return raw as AppSettings[K]
}

export function getSettings(): AppSettings {
  const rows = db.select().from(schema.appSettings).all()
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const out = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as Key[]) {
    if (map.has(key)) {
      // @ts-expect-error indexed assignment across union
      out[key] = coerce(key, map.get(key)!)
    }
  }
  return out
}

export function getBusinessDayConfig(): BusinessDayConfig {
  const s = getSettings()
  return { startHour: s.businessDayStartHour, lengthHours: s.businessDayLengthHours }
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const admin = requireAdmin()
  const allowed = new Set(Object.keys(DEFAULTS))
  const changes: string[] = []
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.has(k)) continue
    if (k === 'businessDayStartHour' && (Number(v) < 0 || Number(v) > 23))
      throw new AppError('VALIDATION', 'Reporting-day rollover hour must be between 0 and 23.')
    if (k === 'businessDayLengthHours' && (Number(v) < 1 || Number(v) > 24))
      throw new AppError('VALIDATION', 'Reporting-day length must be between 1 and 24 hours.')
    if (k === 'maxEmployeeDiscountPercent' && (Number(v) < 0 || Number(v) > 100))
      throw new AppError('VALIDATION', 'Discount cap must be between 0 and 100.')
    if (k === 'serviceChargeMinor' && (!Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > 1_000_00))
      throw new AppError('VALIDATION', 'Service charge must be a whole amount between PKR 0 and PKR 1,000.')
    const value = String(v)
    db.insert(schema.appSettings)
      .values({ key: k, value, updatedBy: admin.id, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: schema.appSettings.key,
        set: { value, updatedBy: admin.id, updatedAt: Date.now() }
      })
      .run()
    changes.push(`${k}=${value}`)
  }
  if (changes.length)
    audit({ action: 'SETTINGS_CHANGED', summary: `Updated settings: ${changes.join(', ')}`, entityType: 'settings' })
  return getSettings()
}

/** Ensure defaults exist as rows on first boot (so admins see them populated). */
export function ensureSettingsSeeded(): void {
  const count = db.select({ c: sql<number>`count(*)` }).from(schema.appSettings).get()!.c
  if (count > 0) return
  for (const [k, v] of Object.entries(DEFAULTS)) {
    db.insert(schema.appSettings).values({ key: k, value: String(v) }).onConflictDoNothing().run()
  }
}

/* ----------------------------- payment methods --------------------------- */

function toMethod(r: typeof schema.paymentMethods.$inferSelect): PaymentMethod {
  return {
    id: r.id,
    code: r.code,
    label: r.label,
    requiresReference: r.requiresReference,
    allowsChange: r.allowsChange,
    isActive: r.isActive,
    sortOrder: r.sortOrder
  }
}

export function listPaymentMethods(includeInactive = false): PaymentMethod[] {
  const rows = db
    .select()
    .from(schema.paymentMethods)
    .where(includeInactive ? undefined : eq(schema.paymentMethods.isActive, true))
    .orderBy(asc(schema.paymentMethods.sortOrder))
    .all()
  return rows.map(toMethod)
}

export function getPaymentMethodByCode(code: string): PaymentMethod | null {
  const r = db.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.code, code)).get()
  return r ? toMethod(r) : null
}

export function createPaymentMethod(i: {
  code: string
  label: string
  requiresReference?: boolean
  allowsChange?: boolean
}): PaymentMethod {
  requireAdmin()
  const code = (i.code ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9_]{2,20}$/.test(code))
    throw new AppError('VALIDATION', 'Code must be 2–20 uppercase letters, numbers or underscores.')
  if ((i.label ?? '').trim().length < 2) throw new AppError('VALIDATION', 'Label is required.')
  const dup = db.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.code, code)).get()
  if (dup) throw new AppError('CONFLICT', 'A payment method with that code already exists.')
  const max = db.select({ m: sql<number>`coalesce(max(sort_order), -1)` }).from(schema.paymentMethods).get()!.m
  const res = db
    .insert(schema.paymentMethods)
    .values({
      code,
      label: i.label.trim(),
      requiresReference: !!i.requiresReference,
      allowsChange: !!i.allowsChange,
      sortOrder: max + 1
    })
    .run()
  audit({ action: 'PAYMENT_METHOD_CREATED', summary: `Added payment method ${code}`, entityType: 'payment_method', entityId: Number(res.lastInsertRowid) })
  return toMethod(db.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.id, Number(res.lastInsertRowid))).get()!)
}

export function updatePaymentMethod(i: {
  id: number
  label?: string
  isActive?: boolean
  requiresReference?: boolean
  allowsChange?: boolean
}): PaymentMethod {
  requireAdmin()
  const row = db.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.id, i.id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Payment method not found.')
  const set: Partial<typeof schema.paymentMethods.$inferInsert> = {}
  if (i.label != null) set.label = i.label.trim()
  if (i.isActive != null) set.isActive = i.isActive
  if (i.requiresReference != null) set.requiresReference = i.requiresReference
  if (i.allowsChange != null) set.allowsChange = i.allowsChange
  if (Object.keys(set).length === 0) return toMethod(row)
  db.update(schema.paymentMethods).set(set).where(eq(schema.paymentMethods.id, i.id)).run()
  audit({ action: 'PAYMENT_METHOD_UPDATED', summary: `Updated payment method ${row.code}`, entityType: 'payment_method', entityId: i.id })
  return toMethod(db.select().from(schema.paymentMethods).where(eq(schema.paymentMethods.id, i.id)).get()!)
}
