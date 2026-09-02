import { asc, eq, sql } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'
import type { Deal, DealItem } from '@shared/types'
import type { DealWriteInput } from '@shared/ipc'
import { audit } from './audit'
import { requireAdmin, requireAuth } from './context'
import { applyImageWrite, imageUrlFor } from './images'

function itemsFor(dealId: number): DealItem[] {
  return db
    .select()
    .from(schema.dealItems)
    .where(eq(schema.dealItems.dealId, dealId))
    .orderBy(asc(schema.dealItems.id))
    .all()
    .map((r) => ({
      id: r.id,
      dealId: r.dealId,
      productId: r.productId,
      productName: r.productName,
      variant: r.variant as DealItem['variant'],
      quantity: r.quantity,
      note: r.note
    }))
}

export function toDeal(row: typeof schema.deals.$inferSelect): Deal {
  return {
    id: row.id,
    name: row.name,
    nameUrdu: row.nameUrdu,
    description: row.description,
    imageUrl: imageUrlFor('DEAL', row.id),
    priceMinor: row.priceMinor,
    categoryId: row.categoryId,
    isActive: row.isActive,
    isAvailable: row.isAvailable,
    isArchived: row.isArchived,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    items: itemsFor(row.id)
  }
}

export function listDeals(includeArchived = false): Deal[] {
  requireAuth()
  const rows = db
    .select()
    .from(schema.deals)
    .where(includeArchived ? undefined : eq(schema.deals.isArchived, false))
    .orderBy(asc(schema.deals.sortOrder), asc(schema.deals.name))
    .all()
  return rows.map(toDeal)
}

export function getDeal(id: number): Deal {
  requireAuth()
  const row = db.select().from(schema.deals).where(eq(schema.deals.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Deal not found.')
  return toDeal(row)
}

function validate(input: DealWriteInput) {
  if ((input.name ?? '').trim().length < 2) throw new AppError('VALIDATION', 'Deal name is required.')
  if (!Number.isInteger(input.priceMinor) || input.priceMinor < 0)
    throw new AppError('VALIDATION', 'Deal price must be a whole, non-negative amount.')
  if (!Array.isArray(input.items) || input.items.length === 0)
    throw new AppError('VALIDATION', 'A deal needs at least one item.')
  for (const it of input.items) {
    if ((it.productName ?? '').trim().length === 0)
      throw new AppError('VALIDATION', 'Each deal item needs a name.')
    if (!Number.isInteger(it.quantity) || it.quantity < 1)
      throw new AppError('VALIDATION', 'Deal item quantity must be at least 1.')
  }
}

export function createDeal(input: DealWriteInput): Deal {
  requireAdmin()
  validate(input)
  const max = db.select({ m: sql<number>`coalesce(max(sort_order), -1)` }).from(schema.deals).get()!.m
  const id = db.transaction(() => {
    const res = db
      .insert(schema.deals)
      .values({
        name: input.name.trim(),
        nameUrdu: input.nameUrdu?.trim() || null,
        description: input.description?.trim() || null,
        priceMinor: input.priceMinor,
        categoryId: input.categoryId ?? null,
        isAvailable: input.isAvailable ?? true,
        isActive: input.isActive ?? true,
        sortOrder: max + 1
      })
      .run()
    const dealId = Number(res.lastInsertRowid)
    for (const it of input.items) {
      db.insert(schema.dealItems)
        .values({
          dealId,
          productId: it.productId ?? null,
          productName: it.productName.trim(),
          variant: it.variant,
          quantity: it.quantity,
          note: it.note?.trim() || null
        })
        .run()
    }
    applyImageWrite('DEAL', dealId, input)
    return dealId
  })
  audit({ action: 'DEAL_CREATED', summary: `Created deal "${input.name.trim()}"`, entityType: 'deal', entityId: id })
  return getDeal(id)
}

export function updateDeal(input: DealWriteInput & { id: number }): Deal {
  requireAdmin()
  const row = db.select().from(schema.deals).where(eq(schema.deals.id, input.id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Deal not found.')
  validate(input)
  db.transaction(() => {
    db.update(schema.deals)
      .set({
        name: input.name.trim(),
        nameUrdu: input.nameUrdu?.trim() || null,
        description: input.description?.trim() || null,
        priceMinor: input.priceMinor,
        categoryId: input.categoryId ?? null,
        isAvailable: input.isAvailable ?? row.isAvailable,
        isActive: input.isActive ?? row.isActive
      })
      .where(eq(schema.deals.id, input.id))
      .run()
    applyImageWrite('DEAL', input.id, input)

    // deal_items are a live configuration (not financial history) — safe to rebuild
    db.delete(schema.dealItems).where(eq(schema.dealItems.dealId, input.id)).run()
    for (const it of input.items) {
      db.insert(schema.dealItems)
        .values({
          dealId: input.id,
          productId: it.productId ?? null,
          productName: it.productName.trim(),
          variant: it.variant,
          quantity: it.quantity,
          note: it.note?.trim() || null
        })
        .run()
    }
  })
  audit({
    action: 'DEAL_UPDATED',
    summary: `Updated deal "${input.name.trim()}" (price ${row.priceMinor / 100} → ${input.priceMinor / 100})`,
    entityType: 'deal',
    entityId: input.id
  })
  return getDeal(input.id)
}

export function archiveDeal(id: number): Deal {
  requireAdmin()
  const row = db.select().from(schema.deals).where(eq(schema.deals.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Deal not found.')
  db.update(schema.deals)
    .set({ isArchived: true, isActive: false, isAvailable: false, archivedAt: Date.now() })
    .where(eq(schema.deals.id, id))
    .run()
  audit({ action: 'DEAL_ARCHIVED', summary: `Archived deal "${row.name}"`, entityType: 'deal', entityId: id })
  return getDeal(id)
}

export function restoreDeal(id: number): Deal {
  requireAdmin()
  const row = db.select().from(schema.deals).where(eq(schema.deals.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Deal not found.')
  db.update(schema.deals)
    .set({ isArchived: false, isActive: true, isAvailable: true, archivedAt: null })
    .where(eq(schema.deals.id, id))
    .run()
  audit({ action: 'DEAL_RESTORED', summary: `Restored deal "${row.name}"`, entityType: 'deal', entityId: id })
  return getDeal(id)
}
