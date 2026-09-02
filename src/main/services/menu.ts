import { and, asc, eq, like, or, sql } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'
import type { Category, Deal, Product, ProductPrice } from '@shared/types'
import type { ProductWriteInput } from '@shared/ipc'
import { audit } from './audit'
import { requireAdmin, requireAuth } from './context'
import { listDeals } from './deals'
import { applyImageWrite, imageUrlFor } from './images'

const VARIANTS = ['STANDARD', 'HALF', 'FULL']

/* ------------------------------- categories ------------------------------ */

function toCategory(row: typeof schema.categories.$inferSelect, productCount?: number): Category {
  return {
    id: row.id,
    name: row.name,
    nameUrdu: row.nameUrdu,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    productCount
  }
}

export function listCategories(includeInactive = false): Category[] {
  requireAuth()
  const rows = db
    .select()
    .from(schema.categories)
    .where(includeInactive ? undefined : eq(schema.categories.isActive, true))
    .orderBy(asc(schema.categories.sortOrder))
    .all()
  return rows.map((r) => {
    const c = db
      .select({ c: sql<number>`count(*)` })
      .from(schema.products)
      .where(and(eq(schema.products.categoryId, r.id), eq(schema.products.isArchived, false)))
      .get()!.c
    return toCategory(r, c)
  })
}

export function createCategory(name: string, nameUrdu?: string): Category {
  requireAdmin()
  if ((name ?? '').trim().length < 2) throw new AppError('VALIDATION', 'Category name is required.')
  const max = db.select({ m: sql<number>`coalesce(max(sort_order), -1)` }).from(schema.categories).get()!.m
  const res = db
    .insert(schema.categories)
    .values({ name: name.trim(), nameUrdu: nameUrdu?.trim() || null, sortOrder: max + 1 })
    .run()
  audit({ action: 'CATEGORY_CREATED', summary: `Created category "${name.trim()}"`, entityType: 'category', entityId: Number(res.lastInsertRowid) })
  return toCategory(db.select().from(schema.categories).where(eq(schema.categories.id, Number(res.lastInsertRowid))).get()!)
}

export function updateCategory(i: { id: number; name?: string; nameUrdu?: string; isActive?: boolean }): Category {
  requireAdmin()
  const row = db.select().from(schema.categories).where(eq(schema.categories.id, i.id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Category not found.')
  const set: Partial<typeof schema.categories.$inferInsert> = {}
  if (i.name != null) set.name = i.name.trim()
  if (i.nameUrdu !== undefined) set.nameUrdu = i.nameUrdu?.trim() || null
  if (i.isActive != null) set.isActive = i.isActive
  db.update(schema.categories).set(set).where(eq(schema.categories.id, i.id)).run()
  audit({ action: 'CATEGORY_UPDATED', summary: `Updated category "${row.name}"`, entityType: 'category', entityId: i.id })
  return toCategory(db.select().from(schema.categories).where(eq(schema.categories.id, i.id)).get()!)
}

export function reorderCategories(orderedIds: number[]): void {
  requireAdmin()
  db.transaction(() => {
    orderedIds.forEach((id, idx) => {
      db.update(schema.categories).set({ sortOrder: idx }).where(eq(schema.categories.id, id)).run()
    })
  })
  audit({ action: 'CATEGORY_REORDERED', summary: `Reordered ${orderedIds.length} categories`, entityType: 'category' })
}

/* -------------------------------- products ------------------------------- */

function pricesFor(productId: number, includeInactive = false): ProductPrice[] {
  const rows = db
    .select()
    .from(schema.productPrices)
    .where(
      includeInactive
        ? eq(schema.productPrices.productId, productId)
        : and(eq(schema.productPrices.productId, productId), eq(schema.productPrices.isActive, true))
    )
    .orderBy(asc(schema.productPrices.id))
    .all()
  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    variant: r.variant as ProductPrice['variant'],
    label: r.label,
    priceMinor: r.priceMinor,
    isActive: r.isActive
  }))
}

export function toProduct(row: typeof schema.products.$inferSelect, includeInactivePrices = false): Product {
  const cat = db.select({ n: schema.categories.name }).from(schema.categories).where(eq(schema.categories.id, row.categoryId)).get()
  return {
    id: row.id,
    categoryId: row.categoryId,
    categoryName: cat?.n ?? '',
    name: row.name,
    nameUrdu: row.nameUrdu,
    description: row.description,
    imageUrl: imageUrlFor('PRODUCT', row.id),
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    isPopular: row.isPopular,
    isAvailable: row.isAvailable,
    isArchived: row.isArchived,
    createdAt: row.createdAt,
    prices: pricesFor(row.id, includeInactivePrices)
  }
}

export function listProducts(q: { categoryId?: number; includeArchived?: boolean; search?: string } = {}): Product[] {
  requireAuth()
  const conds = []
  if (!q.includeArchived) conds.push(eq(schema.products.isArchived, false))
  if (q.categoryId) conds.push(eq(schema.products.categoryId, q.categoryId))
  if (q.search) {
    const s = `%${q.search}%`
    conds.push(or(like(schema.products.name, s), like(schema.products.nameUrdu, s)))
  }
  const rows = db
    .select()
    .from(schema.products)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(schema.products.sortOrder), asc(schema.products.name))
    .all()
  return rows.map((r) => toProduct(r, !!q.includeArchived))
}

export function getProduct(id: number): Product {
  requireAuth()
  const row = db.select().from(schema.products).where(eq(schema.products.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Product not found.')
  return toProduct(row, true)
}

function validatePrices(prices: ProductWriteInput['prices']) {
  if (!Array.isArray(prices) || prices.length === 0)
    throw new AppError('VALIDATION', 'A product needs at least one price.')
  for (const p of prices) {
    if (!VARIANTS.includes(p.variant)) throw new AppError('VALIDATION', `Invalid variant "${p.variant}".`)
    if (!Number.isInteger(p.priceMinor) || p.priceMinor < 0)
      throw new AppError('VALIDATION', 'Prices must be a whole, non-negative amount.')
    if ((p.label ?? '').trim().length === 0) throw new AppError('VALIDATION', 'Each price needs a label.')
  }
}

export function createProduct(input: ProductWriteInput): Product {
  requireAdmin()
  if ((input.name ?? '').trim().length < 2) throw new AppError('VALIDATION', 'Product name is required.')
  const cat = db.select().from(schema.categories).where(eq(schema.categories.id, input.categoryId)).get()
  if (!cat) throw new AppError('VALIDATION', 'Choose a valid category.')
  validatePrices(input.prices)

  const max = db
    .select({ m: sql<number>`coalesce(max(sort_order), -1)` })
    .from(schema.products)
    .where(eq(schema.products.categoryId, input.categoryId))
    .get()!.m

  const created = db.transaction(() => {
    const res = db
      .insert(schema.products)
      .values({
        categoryId: input.categoryId,
        name: input.name.trim(),
        nameUrdu: input.nameUrdu?.trim() || null,
        description: input.description?.trim() || null,
        isPopular: !!input.isPopular,
        isAvailable: input.isAvailable ?? true,
        isActive: input.isActive ?? true,
        sortOrder: max + 1
      })
      .run()
    const pid = Number(res.lastInsertRowid)
    for (const p of input.prices) {
      db.insert(schema.productPrices)
        .values({ productId: pid, variant: p.variant, label: p.label.trim(), priceMinor: p.priceMinor })
        .run()
    }
    applyImageWrite('PRODUCT', pid, input)
    return pid
  })

  audit({ action: 'PRODUCT_CREATED', summary: `Created product "${input.name.trim()}"`, entityType: 'product', entityId: created })
  return getProduct(created)
}

export function updateProduct(input: ProductWriteInput & { id: number }): Product {
  const admin = requireAdmin()
  const row = db.select().from(schema.products).where(eq(schema.products.id, input.id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Product not found.')
  validatePrices(input.prices)

  db.transaction(() => {
    db.update(schema.products)
      .set({
        categoryId: input.categoryId,
        name: input.name.trim(),
        nameUrdu: input.nameUrdu?.trim() || null,
        description: input.description?.trim() || null,
        isPopular: !!input.isPopular,
        isAvailable: input.isAvailable ?? row.isAvailable,
        isActive: input.isActive ?? row.isActive
      })
      .where(eq(schema.products.id, input.id))
      .run()

    const existing = pricesFor(input.id, true)
    const keepIds = new Set<number>()
    for (const p of input.prices) {
      if (p.id) {
        const prev = existing.find((e) => e.id === p.id)
        if (prev && prev.priceMinor !== p.priceMinor) {
          db.insert(schema.priceHistory)
            .values({
              productPriceId: p.id,
              oldPriceMinor: prev.priceMinor,
              newPriceMinor: p.priceMinor,
              changedBy: admin.id,
              reason: 'Product edit'
            })
            .run()
          audit({
            action: 'PRICE_CHANGED',
            summary: `Price of "${row.name}" (${p.label.trim()}) ${prev.priceMinor / 100} → ${p.priceMinor / 100}`,
            entityType: 'product_price',
            entityId: p.id
          })
        }
        db.update(schema.productPrices)
          .set({ variant: p.variant, label: p.label.trim(), priceMinor: p.priceMinor, isActive: true })
          .where(eq(schema.productPrices.id, p.id))
          .run()
        keepIds.add(p.id)
      } else {
        const res = db
          .insert(schema.productPrices)
          .values({ productId: input.id, variant: p.variant, label: p.label.trim(), priceMinor: p.priceMinor })
          .run()
        keepIds.add(Number(res.lastInsertRowid))
      }
    }
    applyImageWrite('PRODUCT', input.id, input)

    // deactivate removed price rows (never hard-delete — invoices may reference them)
    for (const e of existing) {
      if (!keepIds.has(e.id) && e.isActive) {
        db.update(schema.productPrices).set({ isActive: false }).where(eq(schema.productPrices.id, e.id)).run()
      }
    }
  })

  audit({ action: 'PRODUCT_UPDATED', summary: `Updated product "${input.name.trim()}"`, entityType: 'product', entityId: input.id })
  return getProduct(input.id)
}

export function archiveProduct(id: number, reason?: string): Product {
  requireAdmin()
  const row = db.select().from(schema.products).where(eq(schema.products.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Product not found.')
  db.update(schema.products)
    .set({ isArchived: true, isActive: false, isAvailable: false, archivedAt: Date.now() })
    .where(eq(schema.products.id, id))
    .run()
  audit({
    action: 'PRODUCT_ARCHIVED',
    summary: `Archived product "${row.name}"${reason ? ` — ${reason}` : ''}`,
    entityType: 'product',
    entityId: id
  })
  return getProduct(id)
}

export function restoreProduct(id: number): Product {
  requireAdmin()
  const row = db.select().from(schema.products).where(eq(schema.products.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Product not found.')
  db.update(schema.products)
    .set({ isArchived: false, isActive: true, isAvailable: true, archivedAt: null })
    .where(eq(schema.products.id, id))
    .run()
  audit({ action: 'PRODUCT_RESTORED', summary: `Restored product "${row.name}"`, entityType: 'product', entityId: id })
  return getProduct(id)
}

export function reorderProducts(categoryId: number, orderedIds: number[]): void {
  requireAdmin()
  db.transaction(() => {
    orderedIds.forEach((id, idx) => {
      db.update(schema.products)
        .set({ sortOrder: idx })
        .where(and(eq(schema.products.id, id), eq(schema.products.categoryId, categoryId)))
        .run()
    })
  })
  audit({ action: 'PRODUCT_REORDERED', summary: `Reordered products in category #${categoryId}`, entityType: 'category', entityId: categoryId })
}

export function createPrice(i: { productId: number; variant: string; label: string; priceMinor: number }): Product {
  requireAdmin()
  const row = db.select().from(schema.products).where(eq(schema.products.id, i.productId)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Product not found.')
  if (!VARIANTS.includes(i.variant)) throw new AppError('VALIDATION', 'Invalid variant.')
  if (!Number.isInteger(i.priceMinor) || i.priceMinor < 0) throw new AppError('VALIDATION', 'Invalid price.')
  const res = db
    .insert(schema.productPrices)
    .values({ productId: i.productId, variant: i.variant, label: i.label.trim(), priceMinor: i.priceMinor })
    .run()
  audit({ action: 'PRICE_CREATED', summary: `Added ${i.label} price for "${row.name}"`, entityType: 'product_price', entityId: Number(res.lastInsertRowid) })
  return getProduct(i.productId)
}

export function updatePrice(i: { id: number; label?: string; priceMinor?: number; reason?: string }): Product {
  const admin = requireAdmin()
  const row = db.select().from(schema.productPrices).where(eq(schema.productPrices.id, i.id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Price not found.')
  const set: Partial<typeof schema.productPrices.$inferInsert> = {}
  if (i.label != null) set.label = i.label.trim()
  if (i.priceMinor != null) {
    if (!Number.isInteger(i.priceMinor) || i.priceMinor < 0) throw new AppError('VALIDATION', 'Invalid price.')
    set.priceMinor = i.priceMinor
    if (i.priceMinor !== row.priceMinor) {
      db.insert(schema.priceHistory)
        .values({
          productPriceId: i.id,
          oldPriceMinor: row.priceMinor,
          newPriceMinor: i.priceMinor,
          changedBy: admin.id,
          reason: i.reason || 'Manual price change'
        })
        .run()
      const p = db.select({ n: schema.products.name }).from(schema.products).where(eq(schema.products.id, row.productId)).get()
      audit({
        action: 'PRICE_CHANGED',
        summary: `Price of "${p?.n}" (${row.label}) ${row.priceMinor / 100} → ${i.priceMinor / 100}${i.reason ? ` — ${i.reason}` : ''}`,
        entityType: 'product_price',
        entityId: i.id
      })
    }
  }
  db.update(schema.productPrices).set(set).where(eq(schema.productPrices.id, i.id)).run()
  return getProduct(row.productId)
}

export function archivePrice(id: number): Product {
  requireAdmin()
  const row = db.select().from(schema.productPrices).where(eq(schema.productPrices.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Price not found.')
  const remaining = db
    .select({ c: sql<number>`count(*)` })
    .from(schema.productPrices)
    .where(and(eq(schema.productPrices.productId, row.productId), eq(schema.productPrices.isActive, true)))
    .get()!.c
  if (remaining <= 1) throw new AppError('VALIDATION', 'A product must keep at least one active price.')
  db.update(schema.productPrices).set({ isActive: false }).where(eq(schema.productPrices.id, id)).run()
  audit({ action: 'PRICE_ARCHIVED', summary: `Archived ${row.label} price #${id}`, entityType: 'product_price', entityId: id })
  return getProduct(row.productId)
}

/* ------------------------------- POS menu -------------------------------- */

export function getPosMenu(): { categories: Category[]; products: Product[]; deals: Deal[] } {
  requireAuth()
  const categories = db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.isActive, true))
    .orderBy(asc(schema.categories.sortOrder))
    .all()
    .map((r) => toCategory(r))
  const products = db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.isArchived, false), eq(schema.products.isActive, true)))
    .orderBy(asc(schema.products.sortOrder), asc(schema.products.name))
    .all()
    .map((r) => toProduct(r))
  const deals = listDeals(false).filter((d) => d.isActive && !d.isArchived)
  return { categories, products, deals }
}
