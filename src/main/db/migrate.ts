import type Database from 'better-sqlite3'

/**
 * Schema DDL kept in lock-step with schema.ts. Runs on every boot; every
 * statement is idempotent (`IF NOT EXISTS`). A `schema_meta` row tracks the
 * version so future additive migrations can be appended below.
 */

const SCHEMA_VERSION = 3

const DDL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'EMPLOYEE',
  status TEXT NOT NULL DEFAULT 'PENDING',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  approved_at INTEGER,
  approved_by INTEGER,
  last_login_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (lower(username));
CREATE INDEX IF NOT EXISTS users_status_idx ON users (status);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens (user_id);

-- A pure reporting dimension. No open/close lifecycle — the restaurant is
-- always operational. One row per reporting day that has had activity,
-- created lazily. Never gates login/POS, never bounds a session.
CREATE TABLE IF NOT EXISTS business_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_date TEXT NOT NULL,
  first_activity_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS business_days_date_unique ON business_days (business_date);

CREATE TABLE IF NOT EXISTS work_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  business_day_id INTEGER REFERENCES business_days(id),
  business_date TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  opened_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  closed_at INTEGER,
  opening_note TEXT,
  closing_note TEXT,
  summary_json TEXT
);
CREATE INDEX IF NOT EXISTS work_sessions_user_idx ON work_sessions (user_id);
CREATE INDEX IF NOT EXISTS work_sessions_status_idx ON work_sessions (status);
CREATE INDEX IF NOT EXISTS work_sessions_bday_idx ON work_sessions (business_day_id);
CREATE UNIQUE INDEX IF NOT EXISTS work_sessions_one_open_per_user
  ON work_sessions (user_id) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_urdu TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS categories_sort_idx ON categories (sort_order);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  name_urdu TEXT,
  description TEXT,
  image_path TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_popular INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1,
  is_archived INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category_id);
CREATE INDEX IF NOT EXISTS products_archived_idx ON products (is_archived);

-- Menu photography. Kept in the database (not on disk) so backup/restore
-- carries it; kept out of products/deals so ordinary menu reads stay light.
CREATE TABLE IF NOT EXISTS menu_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  byte_size INTEGER NOT NULL,
  bytes BLOB NOT NULL,
  credit TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS menu_images_owner_unique ON menu_images (owner_type, owner_id);

CREATE TABLE IF NOT EXISTS product_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant TEXT NOT NULL DEFAULT 'STANDARD',
  label TEXT NOT NULL,
  price_minor INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS product_prices_product_idx ON product_prices (product_id);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_price_id INTEGER NOT NULL REFERENCES product_prices(id),
  old_price_minor INTEGER,
  new_price_minor INTEGER NOT NULL,
  changed_by INTEGER REFERENCES users(id),
  changed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  reason TEXT
);

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_urdu TEXT,
  description TEXT,
  image_path TEXT,
  price_minor INTEGER NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  is_available INTEGER NOT NULL DEFAULT 1,
  is_archived INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS deal_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id),
  product_id INTEGER REFERENCES products(id),
  product_name TEXT NOT NULL,
  variant TEXT NOT NULL DEFAULT 'STANDARD',
  quantity INTEGER NOT NULL DEFAULT 1,
  note TEXT
);
CREATE INDEX IF NOT EXISTS deal_items_deal_idx ON deal_items (deal_id);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'HELD',
  user_id INTEGER NOT NULL REFERENCES users(id),
  session_id INTEGER REFERENCES work_sessions(id),
  business_day_id INTEGER REFERENCES business_days(id),
  business_date TEXT,
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  discount_reason TEXT,
  service_charge_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  order_note TEXT,
  customer_name TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  completed_at INTEGER,
  cancelled_at INTEGER,
  cancel_reason TEXT,
  cancelled_by INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_number_unique ON orders (order_number);
CREATE INDEX IF NOT EXISTS orders_session_idx ON orders (session_id);
CREATE INDEX IF NOT EXISTS orders_bday_idx ON orders (business_day_id);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at);

CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL DEFAULT 'PRODUCT',
  ref_id INTEGER,
  product_price_id INTEGER,
  name TEXT NOT NULL,
  name_urdu TEXT,
  variant_label TEXT,
  quantity INTEGER NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  line_discount_minor INTEGER NOT NULL DEFAULT 0,
  line_total_minor INTEGER NOT NULL,
  note TEXT,
  components_json TEXT
);
CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines (order_id);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  requires_reference INTEGER NOT NULL DEFAULT 0,
  allows_change INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_code_unique ON payment_methods (code);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  method TEXT NOT NULL,
  method_label TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  tendered_minor INTEGER,
  change_minor INTEGER,
  reference TEXT,
  is_refund INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  created_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  order_number TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  user_full_name TEXT NOT NULL,
  session_id INTEGER REFERENCES work_sessions(id),
  business_day_id INTEGER REFERENCES business_days(id),
  business_date TEXT,
  issued_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  subtotal_minor INTEGER NOT NULL,
  discount_minor INTEGER NOT NULL,
  service_charge_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  payment_method_label TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  print_status TEXT NOT NULL DEFAULT 'NOT_PRINTED',
  print_count INTEGER NOT NULL DEFAULT 0,
  last_printed_at INTEGER,
  last_print_error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_number_unique ON invoices (invoice_number);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_order_unique ON invoices (order_id);
CREATE INDEX IF NOT EXISTS invoices_session_idx ON invoices (session_id);
CREATE INDEX IF NOT EXISTS invoices_bday_idx ON invoices (business_day_id);
CREATE INDEX IF NOT EXISTS invoices_issued_idx ON invoices (issued_at);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  name TEXT NOT NULL,
  name_urdu TEXT,
  variant_label TEXT,
  quantity INTEGER NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  line_total_minor INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS invoice_lines_invoice_idx ON invoice_lines (invoice_id);

CREATE TABLE IF NOT EXISTS print_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  kind TEXT NOT NULL DEFAULT 'PRINT',
  status TEXT NOT NULL,
  message TEXT,
  printer_name TEXT,
  requested_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS print_jobs_invoice_idx ON print_jobs (invoice_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  actor_id INTEGER REFERENCES users(id),
  actor_name TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  summary TEXT NOT NULL,
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS audit_logs_at_idx ON audit_logs (at);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_id);

CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS held_order_owners (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (order_id, user_id)
);
`

/**
 * Immutability guards for financial history. Once an order is COMPLETED,
 * its lines and payments cannot be altered or removed, and invoice rows
 * cannot be deleted or have their financial columns rewritten. Only the
 * print-tracking columns of an invoice may change.
 */
const TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS invoice_lines_no_update
BEFORE UPDATE ON invoice_lines
BEGIN
  SELECT RAISE(ABORT, 'invoice_lines are immutable');
END;

CREATE TRIGGER IF NOT EXISTS invoice_lines_no_delete
BEFORE DELETE ON invoice_lines
BEGIN
  SELECT RAISE(ABORT, 'invoice_lines are immutable');
END;

CREATE TRIGGER IF NOT EXISTS invoices_no_delete
BEFORE DELETE ON invoices
BEGIN
  SELECT RAISE(ABORT, 'invoices are immutable and cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS invoices_financials_locked
BEFORE UPDATE ON invoices
FOR EACH ROW WHEN
  OLD.invoice_number <> NEW.invoice_number OR
  OLD.total_minor    <> NEW.total_minor OR
  OLD.subtotal_minor <> NEW.subtotal_minor OR
  OLD.discount_minor <> NEW.discount_minor OR
  OLD.snapshot_json  <> NEW.snapshot_json OR
  OLD.order_id       <> NEW.order_id
BEGIN
  SELECT RAISE(ABORT, 'invoice financial fields are immutable');
END;

CREATE TRIGGER IF NOT EXISTS payments_no_delete
BEFORE DELETE ON payments
BEGIN
  SELECT RAISE(ABORT, 'payments are immutable and cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS payments_no_update
BEFORE UPDATE ON payments
BEGIN
  SELECT RAISE(ABORT, 'payments are immutable');
END;

CREATE TRIGGER IF NOT EXISTS order_lines_locked_after_complete
BEFORE UPDATE ON order_lines
FOR EACH ROW WHEN
  (SELECT status FROM orders WHERE id = OLD.order_id) IN ('COMPLETED','REFUNDED')
BEGIN
  SELECT RAISE(ABORT, 'order lines are immutable once the order is completed');
END;

CREATE TRIGGER IF NOT EXISTS order_lines_no_delete_after_complete
BEFORE DELETE ON order_lines
FOR EACH ROW WHEN
  (SELECT status FROM orders WHERE id = OLD.order_id) IN ('COMPLETED','REFUNDED')
BEGIN
  SELECT RAISE(ABORT, 'order lines cannot be removed once the order is completed');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit log entries are append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit log entries are append-only');
END;
`

function columnNames(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name)
}

/**
 * v2 — remove the restaurant open/close ("business day") lifecycle.
 *
 * The restaurant is always operational. `business_days` becomes a pure
 * reporting dimension ({id, business_date, first_activity_at}); its
 * status / opened_by / closed_by / scheduled_* columns are dropped.
 * `work_sessions` gains a `business_date` label (back-filled from the old
 * business day) but is otherwise unbounded.
 *
 * Runs only when the OLD shape is detected, so fresh installs skip it.
 */
function migrateV2(sqlite: Database.Database): void {
  const bdCols = columnNames(sqlite, 'business_days')
  if (bdCols.length === 0 || !bdCols.includes('status')) return // fresh or already migrated

  sqlite.pragma('foreign_keys = OFF')
  const tx = sqlite.transaction(() => {
    // 1. give work_sessions a business_date and back-fill from the old table
    if (!columnNames(sqlite, 'work_sessions').includes('business_date')) {
      sqlite.exec(`ALTER TABLE work_sessions ADD COLUMN business_date TEXT`)
    }
    sqlite.exec(`
      UPDATE work_sessions
         SET business_date = (SELECT bd.business_date FROM business_days bd WHERE bd.id = work_sessions.business_day_id)
       WHERE business_date IS NULL
    `)

    // 2. rebuild business_days as a bare dimension, keeping the same ids
    sqlite.exec(`DROP INDEX IF EXISTS business_days_status_idx`)
    sqlite.exec(`
      CREATE TABLE business_days__v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_date TEXT NOT NULL,
        first_activity_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      INSERT INTO business_days__v2 (id, business_date, first_activity_at)
        SELECT id, business_date, opened_at FROM business_days;
      DROP TABLE business_days;
      ALTER TABLE business_days__v2 RENAME TO business_days;
      CREATE UNIQUE INDEX business_days_date_unique ON business_days (business_date);
    `)
  })
  tx()
  sqlite.pragma('foreign_keys = ON')
}

/** v3 — a fixed per-order service charge, stored on each order and invoice. */
function migrateV3(sqlite: Database.Database): void {
  if (!columnNames(sqlite, 'orders').includes('service_charge_minor')) {
    sqlite.exec(`ALTER TABLE orders ADD COLUMN service_charge_minor INTEGER NOT NULL DEFAULT 0`)
  }
  if (!columnNames(sqlite, 'invoices').includes('service_charge_minor')) {
    sqlite.exec(`ALTER TABLE invoices ADD COLUMN service_charge_minor INTEGER NOT NULL DEFAULT 0`)
  }
}

export function runMigrations(sqlite: Database.Database): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  const row = sqlite
    .prepare(`SELECT value FROM schema_meta WHERE key = 'version'`)
    .get() as { value: string } | undefined
  const current = row ? Number(row.value) : 0

  // structural migrations first (operate on the OLD shape)
  const hasBusinessDays = !!sqlite
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_days'`)
    .get()
  if (hasBusinessDays && current < 2) migrateV2(sqlite)
  const hasOrders = !!sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='orders'`).get()
  if (hasOrders && current < 3) migrateV3(sqlite)

  // then bring any missing tables/columns/indexes up to date for fresh installs
  sqlite.exec(DDL)
  sqlite.exec(TRIGGERS)

  if (current < SCHEMA_VERSION) {
    sqlite
      .prepare(
        `INSERT INTO schema_meta (key, value) VALUES ('version', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(String(SCHEMA_VERSION))
  }
}
