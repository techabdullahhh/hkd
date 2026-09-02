import { sql } from 'drizzle-orm'
import { db, schema } from './connection'
import { hashPassword } from '../services/auth'
import { ensureSettingsSeeded } from '../services/settings'
import { seedBundledImages, seedBundledLogo } from '../services/images'
import {
  SEED_CATEGORIES,
  SEED_DEALS,
  SEED_PAYMENT_METHODS,
  SEED_PRODUCTS
} from '@shared/menu-data'

/**
 * Development seed.
 *
 * Credentials are DEV-ONLY and documented in README.md. Every seeded account
 * is created with `must_change_password = 1`, so the real password is set on
 * first login and no production secret ever lives in source control.
 *
 *   Admin       →  username: admin     password: Admin@12345
 *   Employee 1  →  username: victor1   password: Victor@12345
 *   Employee 2  →  username: victor2   password: Victor@12345
 */
export const DEV_CREDENTIALS = [
  { username: 'admin', fullName: 'Restaurant Admin', role: 'ADMIN' as const, password: 'Admin@12345' },
  { username: 'victor1', fullName: 'Victor 1', role: 'EMPLOYEE' as const, password: 'Victor@12345' },
  { username: 'victor2', fullName: 'Victor 2', role: 'EMPLOYEE' as const, password: 'Victor@12345' }
]

function isEmpty(table: any): boolean {
  return db.select({ c: sql<number>`count(*)` }).from(table).get()!.c === 0
}

export function seedMenu(): void {
  ensureSettingsSeeded()

  if (isEmpty(schema.paymentMethods)) {
    for (const m of SEED_PAYMENT_METHODS) {
      db.insert(schema.paymentMethods).values(m).onConflictDoNothing().run()
    }
  }

  if (isEmpty(schema.categories)) {
    SEED_CATEGORIES.forEach((c, i) => {
      db.insert(schema.categories).values({ name: c.name, nameUrdu: c.nameUrdu, sortOrder: i }).run()
    })
  }

  const catId = (name: string): number =>
    db.select({ id: schema.categories.id }).from(schema.categories).where(sql`${schema.categories.name} = ${name}`).get()!.id

  if (isEmpty(schema.products)) {
    SEED_PRODUCTS.forEach((p, i) => {
      const res = db
        .insert(schema.products)
        .values({
          categoryId: catId(p.category),
          name: p.name,
          nameUrdu: p.nameUrdu,
          description: p.description ?? p.configurableNote ?? null,
          isPopular: !!p.popular,
          sortOrder: i
        })
        .run()
      const pid = Number(res.lastInsertRowid)
      for (const price of p.prices) {
        db.insert(schema.productPrices)
          .values({ productId: pid, variant: price.variant, label: price.label, priceMinor: price.price * 100 })
          .run()
      }
    })
  }

  if (isEmpty(schema.deals)) {
    const dealsCat = catId('Deals')
    SEED_DEALS.forEach((d, i) => {
      const res = db
        .insert(schema.deals)
        .values({
          name: d.name,
          nameUrdu: d.nameUrdu,
          description: d.configurableNote ?? d.description ?? null,
          priceMinor: d.price * 100,
          categoryId: dealsCat,
          sortOrder: i
        })
        .run()
      const dealId = Number(res.lastInsertRowid)
      for (const it of d.items) {
        const prod = db
          .select({ id: schema.products.id })
          .from(schema.products)
          .where(sql`${schema.products.name} = ${it.productName}`)
          .get()
        db.insert(schema.dealItems)
          .values({
            dealId,
            productId: prod?.id ?? null,
            productName: it.productName,
            variant: it.variant,
            quantity: it.quantity
          })
          .run()
      }
    })
  }

  // Attach the bundled photography last, once products and deals exist.
  // Idempotent: an item that already has an image (including an admin's own
  // upload) is left untouched.
  seedBundledImages()
  seedBundledLogo()
}

export function seedDevUsers(): void {
  if (!isEmpty(schema.users)) return
  const now = Date.now()
  for (const c of DEV_CREDENTIALS) {
    db.insert(schema.users)
      .values({
        username: c.username,
        fullName: c.fullName,
        passwordHash: hashPassword(c.password),
        role: c.role,
        status: 'ACTIVE',
        mustChangePassword: true,
        approvedAt: now
      })
      .run()
  }
  db.insert(schema.auditLogs)
    .values({
      action: 'SEED',
      actorName: 'system',
      summary: 'Seeded development users (admin, victor1, victor2) — all must change password on first login',
      entityType: 'system'
    })
    .run()
}

export function seedAll(opts: { withDevUsers: boolean }): void {
  seedMenu()
  if (opts.withDevUsers) seedDevUsers()
}
