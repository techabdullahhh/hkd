/**
 * Relational schema for Hashmi Ka Dera (HKD) POS.
 *
 * Conventions
 *  - Money is stored as INTEGER minor units (paisa).
 *  - Timestamps are INTEGER epoch milliseconds (local-clock instants).
 *  - Enums are TEXT with a CHECK-like constraint enforced in the service
 *    layer and, for the financial tables, by SQL triggers (see migrate.ts).
 *  - Historical financial rows (orders once COMPLETED, order_lines, payments,
 *    invoices, invoice_lines) are immutable. Only invoice print-tracking
 *    columns may change after creation.
 */

import { sql } from 'drizzle-orm'
import {
  blob,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'

const now = sql`(unixepoch() * 1000)`

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    fullName: text('full_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull().default('EMPLOYEE'), // ADMIN | EMPLOYEE
    status: text('status').notNull().default('PENDING'), // PENDING | ACTIVE | DISABLED | ARCHIVED
    mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(now),
    approvedAt: integer('approved_at'),
    approvedBy: integer('approved_by'),
    lastLoginAt: integer('last_login_at')
  },
  (t) => ({
    usernameUnique: uniqueIndex('users_username_unique').on(sql`lower(${t.username})`),
    statusIdx: index('users_status_idx').on(t.status)
  })
)

export const authTokens = sqliteTable(
  'auth_tokens',
  {
    token: text('token').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: integer('created_at').notNull().default(now),
    expiresAt: integer('expires_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull().default(now)
  },
  (t) => ({ userIdx: index('auth_tokens_user_idx').on(t.userId) })
)

/**
 * A pure reporting dimension — one row per calendar reporting day that has
 * had activity. There is NO open/close lifecycle: the restaurant is always
 * operational. Rows are created lazily on first order/session of the day.
 * A reporting day never gates login or the POS, and never touches sessions.
 */
export const businessDays = sqliteTable(
  'business_days',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    businessDate: text('business_date').notNull(), // YYYY-MM-DD reporting label
    firstActivityAt: integer('first_activity_at').notNull().default(now)
  },
  (t) => ({
    dateUnique: uniqueIndex('business_days_date_unique').on(t.businessDate)
  })
)

export const workSessions = sqliteTable(
  'work_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    /** reporting-day bucket the session STARTED in — informational only; the
     *  session itself is unbounded and ends only when the employee ends it */
    businessDayId: integer('business_day_id').references(() => businessDays.id),
    businessDate: text('business_date'),
    status: text('status').notNull().default('OPEN'), // OPEN | CLOSED
    openedAt: integer('opened_at').notNull().default(now),
    closedAt: integer('closed_at'),
    openingNote: text('opening_note'),
    closingNote: text('closing_note'),
    /** frozen JSON summary written when the session closes */
    summaryJson: text('summary_json')
  },
  (t) => ({
    userIdx: index('work_sessions_user_idx').on(t.userId),
    statusIdx: index('work_sessions_status_idx').on(t.status),
    bdayIdx: index('work_sessions_bday_idx').on(t.businessDayId),
    oneOpenPerUser: uniqueIndex('work_sessions_one_open_per_user')
      .on(t.userId)
      .where(sql`${t.status} = 'OPEN'`)
  })
)

export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    nameUrdu: text('name_urdu'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => ({ sortIdx: index('categories_sort_idx').on(t.sortOrder) })
)

export const products = sqliteTable(
  'products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id),
    name: text('name').notNull(),
    nameUrdu: text('name_urdu'),
    description: text('description'),
    imagePath: text('image_path'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    isPopular: integer('is_popular', { mode: 'boolean' }).notNull().default(false),
    isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(true),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => ({
    catIdx: index('products_category_idx').on(t.categoryId),
    archivedIdx: index('products_archived_idx').on(t.isArchived)
  })
)

/**
 * Menu photography.
 *
 * The bytes live in SQLite rather than on disk for one deliberate reason:
 * `backup:create` copies the database file, so images are backed up and
 * restored with everything else instead of silently going missing. Every
 * row is already downscaled and re-encoded (see services/images.ts), so a
 * full menu is on the order of a megabyte.
 *
 * The blob is in its own table so the many `SELECT * FROM products` reads
 * never drag image bytes along with them.
 */
export const menuImages = sqliteTable(
  'menu_images',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerType: text('owner_type').notNull(), // PRODUCT | DEAL
    ownerId: integer('owner_id').notNull(),
    mime: text('mime').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    byteSize: integer('byte_size').notNull(),
    bytes: blob('bytes', { mode: 'buffer' }).notNull(),
    /** Attribution for bundled photography; null for admin uploads. */
    credit: text('credit'),
    updatedAt: integer('updated_at').notNull().default(now)
  },
  (t) => ({ ownerUnique: uniqueIndex('menu_images_owner_unique').on(t.ownerType, t.ownerId) })
)

export const productPrices = sqliteTable(
  'product_prices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id),
    variant: text('variant').notNull().default('STANDARD'), // STANDARD | HALF | FULL
    label: text('label').notNull(),
    priceMinor: integer('price_minor').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at').notNull().default(now)
  },
  (t) => ({ productIdx: index('product_prices_product_idx').on(t.productId) })
)

/** Append-only history of price changes for audit + reporting. */
export const priceHistory = sqliteTable('price_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  productPriceId: integer('product_price_id')
    .notNull()
    .references(() => productPrices.id),
  oldPriceMinor: integer('old_price_minor'),
  newPriceMinor: integer('new_price_minor').notNull(),
  changedBy: integer('changed_by').references(() => users.id),
  changedAt: integer('changed_at').notNull().default(now),
  reason: text('reason')
})

export const deals = sqliteTable('deals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  nameUrdu: text('name_urdu'),
  description: text('description'),
  imagePath: text('image_path'),
  priceMinor: integer('price_minor').notNull(),
  categoryId: integer('category_id').references(() => categories.id),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  isAvailable: integer('is_available', { mode: 'boolean' }).notNull().default(true),
  isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
  archivedAt: integer('archived_at'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: integer('created_at').notNull().default(now)
})

export const dealItems = sqliteTable(
  'deal_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    dealId: integer('deal_id')
      .notNull()
      .references(() => deals.id),
    productId: integer('product_id').references(() => products.id),
    productName: text('product_name').notNull(),
    variant: text('variant').notNull().default('STANDARD'),
    quantity: integer('quantity').notNull().default(1),
    note: text('note')
  },
  (t) => ({ dealIdx: index('deal_items_deal_idx').on(t.dealId) })
)

export const orders = sqliteTable(
  'orders',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderNumber: text('order_number').notNull(),
    status: text('status').notNull().default('HELD'), // HELD | COMPLETED | CANCELLED | REFUNDED
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    sessionId: integer('session_id').references(() => workSessions.id),
    businessDayId: integer('business_day_id').references(() => businessDays.id),
    businessDate: text('business_date'),
    subtotalMinor: integer('subtotal_minor').notNull().default(0),
    discountMinor: integer('discount_minor').notNull().default(0),
    discountReason: text('discount_reason'),
    serviceChargeMinor: integer('service_charge_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull().default(0),
    orderNote: text('order_note'),
    customerName: text('customer_name'),
    createdAt: integer('created_at').notNull().default(now),
    completedAt: integer('completed_at'),
    cancelledAt: integer('cancelled_at'),
    cancelReason: text('cancel_reason'),
    cancelledBy: integer('cancelled_by').references(() => users.id)
  },
  (t) => ({
    orderNumberUnique: uniqueIndex('orders_number_unique').on(t.orderNumber),
    sessionIdx: index('orders_session_idx').on(t.sessionId),
    bdayIdx: index('orders_bday_idx').on(t.businessDayId),
    userIdx: index('orders_user_idx').on(t.userId),
    statusIdx: index('orders_status_idx').on(t.status),
    createdIdx: index('orders_created_idx').on(t.createdAt)
  })
)

export const orderLines = sqliteTable(
  'order_lines',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    kind: text('kind').notNull().default('PRODUCT'), // PRODUCT | DEAL
    refId: integer('ref_id'), // product id or deal id (nullable if archived later)
    productPriceId: integer('product_price_id'),
    name: text('name').notNull(),
    nameUrdu: text('name_urdu'),
    variantLabel: text('variant_label'),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    lineDiscountMinor: integer('line_discount_minor').notNull().default(0),
    lineTotalMinor: integer('line_total_minor').notNull(),
    note: text('note'),
    componentsJson: text('components_json') // resolved deal components snapshot
  },
  (t) => ({ orderIdx: index('order_lines_order_idx').on(t.orderId) })
)

export const paymentMethods = sqliteTable('payment_methods', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull(),
  label: text('label').notNull(),
  requiresReference: integer('requires_reference', { mode: 'boolean' }).notNull().default(false),
  allowsChange: integer('allows_change', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0)
})

export const payments = sqliteTable(
  'payments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    method: text('method').notNull(),
    methodLabel: text('method_label').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    tenderedMinor: integer('tendered_minor'),
    changeMinor: integer('change_minor'),
    reference: text('reference'),
    isRefund: integer('is_refund', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().default(now),
    createdBy: integer('created_by').references(() => users.id)
  },
  (t) => ({ orderIdx: index('payments_order_idx').on(t.orderId) })
)

export const invoices = sqliteTable(
  'invoices',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    invoiceNumber: text('invoice_number').notNull(),
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    orderNumber: text('order_number').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    userFullName: text('user_full_name').notNull(),
    sessionId: integer('session_id').references(() => workSessions.id),
    businessDayId: integer('business_day_id').references(() => businessDays.id),
    businessDate: text('business_date'),
    issuedAt: integer('issued_at').notNull().default(now),
    subtotalMinor: integer('subtotal_minor').notNull(),
    discountMinor: integer('discount_minor').notNull(),
    serviceChargeMinor: integer('service_charge_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    paymentMethod: text('payment_method').notNull(),
    paymentMethodLabel: text('payment_method_label').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    // print tracking — the ONLY mutable columns after creation
    printStatus: text('print_status').notNull().default('NOT_PRINTED'),
    printCount: integer('print_count').notNull().default(0),
    lastPrintedAt: integer('last_printed_at'),
    lastPrintError: text('last_print_error')
  },
  (t) => ({
    invoiceNumberUnique: uniqueIndex('invoices_number_unique').on(t.invoiceNumber),
    orderUnique: uniqueIndex('invoices_order_unique').on(t.orderId),
    sessionIdx: index('invoices_session_idx').on(t.sessionId),
    bdayIdx: index('invoices_bday_idx').on(t.businessDayId),
    issuedIdx: index('invoices_issued_idx').on(t.issuedAt)
  })
)

export const invoiceLines = sqliteTable(
  'invoice_lines',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    invoiceId: integer('invoice_id')
      .notNull()
      .references(() => invoices.id),
    name: text('name').notNull(),
    nameUrdu: text('name_urdu'),
    variantLabel: text('variant_label'),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    lineTotalMinor: integer('line_total_minor').notNull()
  },
  (t) => ({ invoiceIdx: index('invoice_lines_invoice_idx').on(t.invoiceId) })
)

export const printJobs = sqliteTable('print_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invoiceId: integer('invoice_id')
    .notNull()
    .references(() => invoices.id),
  kind: text('kind').notNull().default('PRINT'), // PRINT | REPRINT | TEST
  status: text('status').notNull(), // PRINTED | FAILED
  message: text('message'),
  printerName: text('printer_name'),
  requestedBy: integer('requested_by').references(() => users.id),
  createdAt: integer('created_at').notNull().default(now)
})

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull().default(now),
  updatedBy: integer('updated_by').references(() => users.id)
})

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull().default(now),
    actorId: integer('actor_id').references(() => users.id),
    actorName: text('actor_name').notNull().default('system'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    summary: text('summary').notNull(),
    detailsJson: text('details_json')
  },
  (t) => ({
    atIdx: index('audit_logs_at_idx').on(t.at),
    actionIdx: index('audit_logs_action_idx').on(t.action),
    actorIdx: index('audit_logs_actor_idx').on(t.actorId)
  })
)

export const backups = sqliteTable('backups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  path: text('path').notNull(),
  name: text('name').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  note: text('note'),
  createdAt: integer('created_at').notNull().default(now),
  createdBy: integer('created_by').references(() => users.id)
})

/** Composite helper table: which held order belongs to which user (for POS resume). */
export const heldOrderOwners = sqliteTable(
  'held_order_owners',
  {
    orderId: integer('order_id')
      .notNull()
      .references(() => orders.id),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id)
  },
  (t) => ({ pk: primaryKey({ columns: [t.orderId, t.userId] }) })
)

export type Db = typeof import('./connection')['db']
