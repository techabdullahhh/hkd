import { and, eq } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'
import type { CheckoutLineInput } from '@shared/ipc'

export interface ResolvedLine {
  kind: 'PRODUCT' | 'DEAL'
  refId: number | null
  productPriceId: number | null
  name: string
  nameUrdu: string | null
  variantLabel: string | null
  quantity: number
  unitPriceMinor: number
  lineTotalMinor: number
  note: string | null
  components: { name: string; quantity: number; variantLabel: string | null }[] | null
}

/**
 * Resolve raw checkout lines to concrete, server-priced order lines.
 * Prices ALWAYS come from the database — the renderer's numbers are never
 * trusted. Unavailable / archived items are rejected here.
 */
export function resolveLines(lines: CheckoutLineInput[]): ResolvedLine[] {
  if (!Array.isArray(lines) || lines.length === 0)
    throw new AppError('VALIDATION', 'The order is empty.')

  const out: ResolvedLine[] = []
  for (const line of lines) {
    const qty = Number(line.quantity)
    if (!Number.isInteger(qty) || qty < 1 || qty > 999)
      throw new AppError('VALIDATION', 'Item quantity must be between 1 and 999.')
    const note = line.note?.trim() || null

    if (line.kind === 'PRODUCT') {
      const product = db.select().from(schema.products).where(eq(schema.products.id, line.refId)).get()
      if (!product) throw new AppError('VALIDATION', 'One of the items no longer exists.')
      if (product.isArchived) throw new AppError('VALIDATION', `"${product.name}" is no longer on the menu.`)
      if (!product.isAvailable || !product.isActive)
        throw new AppError('VALIDATION', `"${product.name}" is currently unavailable.`)

      let price
      if (line.productPriceId) {
        price = db
          .select()
          .from(schema.productPrices)
          .where(and(eq(schema.productPrices.id, line.productPriceId), eq(schema.productPrices.productId, product.id)))
          .get()
      } else {
        price = db
          .select()
          .from(schema.productPrices)
          .where(and(eq(schema.productPrices.productId, product.id), eq(schema.productPrices.isActive, true)))
          .get()
      }
      if (!price || !price.isActive)
        throw new AppError('VALIDATION', `No valid price found for "${product.name}".`)

      out.push({
        kind: 'PRODUCT',
        refId: product.id,
        productPriceId: price.id,
        name: product.name,
        nameUrdu: product.nameUrdu,
        variantLabel: price.variant === 'STANDARD' ? null : price.label,
        quantity: qty,
        unitPriceMinor: price.priceMinor,
        lineTotalMinor: price.priceMinor * qty,
        note,
        components: null
      })
    } else if (line.kind === 'DEAL') {
      const deal = db.select().from(schema.deals).where(eq(schema.deals.id, line.refId)).get()
      if (!deal) throw new AppError('VALIDATION', 'One of the deals no longer exists.')
      if (deal.isArchived) throw new AppError('VALIDATION', `Deal "${deal.name}" is no longer available.`)
      if (!deal.isAvailable || !deal.isActive)
        throw new AppError('VALIDATION', `Deal "${deal.name}" is currently unavailable.`)
      const items = db.select().from(schema.dealItems).where(eq(schema.dealItems.dealId, deal.id)).all()

      out.push({
        kind: 'DEAL',
        refId: deal.id,
        productPriceId: null,
        name: deal.name,
        nameUrdu: deal.nameUrdu,
        variantLabel: 'Deal',
        quantity: qty,
        unitPriceMinor: deal.priceMinor,
        lineTotalMinor: deal.priceMinor * qty,
        note,
        components: items.map((it) => ({
          name: it.productName,
          quantity: it.quantity * qty,
          variantLabel: it.variant === 'STANDARD' ? null : it.variant === 'HALF' ? 'Half' : 'Full'
        }))
      })
    } else {
      throw new AppError('VALIDATION', 'Unknown order line type.')
    }
  }
  return out
}

export function subtotalOf(lines: ResolvedLine[]): number {
  return lines.reduce((s, l) => s + l.lineTotalMinor, 0)
}
