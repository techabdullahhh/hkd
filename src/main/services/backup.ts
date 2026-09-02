import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { db, schema, rawDb, getBackupDir, getDbPath, reopenDatabase } from '../db/connection'
import { AppError } from '@shared/errors'
import { audit } from './audit'
import { requireAdmin } from './context'
import { formatDateTime } from '@shared/time'

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function createBackup(note?: string): { path: string; sizeBytes: number; createdAt: number } {
  const admin = requireAdmin()
  const dir = getBackupDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const name = `hkd-backup-${stamp()}.db`
  const dest = join(dir, name)

  // Use SQLite's online backup API for a consistent copy while the app runs.
  const source = rawDb()
  source.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  copyFileSync(getDbPath(), dest)

  const sizeBytes = statSync(dest).size
  const createdAt = Date.now()
  db.insert(schema.backups)
    .values({ path: dest, name, sizeBytes, note: note?.trim() || null, createdBy: admin.id, createdAt })
    .run()
  audit({ action: 'BACKUP_CREATED', summary: `Created backup ${name} (${(sizeBytes / 1024).toFixed(0)} KB)`, entityType: 'backup' })
  return { path: dest, sizeBytes, createdAt }
}

export function listBackups(): { path: string; name: string; sizeBytes: number; createdAt: number }[] {
  requireAdmin()
  const dir = getBackupDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const full = join(dir, f)
      const st = statSync(full)
      return { path: full, name: f, sizeBytes: st.size, createdAt: st.mtimeMs }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Restore is destructive. The caller must echo back the exact confirmation
 * phrase. The current database is itself backed up first (a "pre-restore"
 * safety copy) so a restore can never silently lose data.
 */
export function restoreBackup(path: string, confirm: string): { restored: boolean } {
  requireAdmin()
  if (confirm !== 'RESTORE') throw new AppError('VALIDATION', 'Type RESTORE to confirm this destructive action.')
  if (!existsSync(path)) throw new AppError('NOT_FOUND', 'That backup file no longer exists.')

  const st = statSync(path)
  if (st.size < 1024) throw new AppError('VALIDATION', 'That file does not look like a valid database backup.')

  // pre-restore safety snapshot of the CURRENT db
  const dir = getBackupDir()
  const safety = join(dir, `pre-restore-${stamp()}.db`)
  rawDb().exec('PRAGMA wal_checkpoint(TRUNCATE)')
  copyFileSync(getDbPath(), safety)

  audit({
    action: 'BACKUP_RESTORE',
    summary: `Restored database from ${path}. Prior state saved to ${safety}.`,
    entityType: 'backup'
  })

  // swap the file and reopen
  copyFileSync(path, getDbPath())
  // remove stale WAL/SHM so the restored file is authoritative
  for (const ext of ['-wal', '-shm']) {
    const p = getDbPath() + ext
    if (existsSync(p)) {
      try {
        writeFileSync(p, '')
      } catch {
        /* ignore */
      }
    }
  }
  reopenDatabase()
  return { restored: true }
}

/** Human-readable JSON export of all business data (not a restore format). */
export function exportJson(): { path: string } {
  requireAdmin()
  const dir = getBackupDir()
  const dest = join(dir, `hkd-export-${stamp()}.json`)
  const dump = {
    exportedAt: formatDateTime(Date.now()),
    users: db.select().from(schema.users).all().map((u) => ({ ...u, passwordHash: '***redacted***' })),
    businessDays: db.select().from(schema.businessDays).all(),
    sessions: db.select().from(schema.workSessions).all(),
    categories: db.select().from(schema.categories).all(),
    products: db.select().from(schema.products).all(),
    productPrices: db.select().from(schema.productPrices).all(),
    deals: db.select().from(schema.deals).all(),
    dealItems: db.select().from(schema.dealItems).all(),
    orders: db.select().from(schema.orders).all(),
    orderLines: db.select().from(schema.orderLines).all(),
    payments: db.select().from(schema.payments).all(),
    invoices: db.select().from(schema.invoices).all(),
    invoiceLines: db.select().from(schema.invoiceLines).all(),
    auditLogs: db.select().from(schema.auditLogs).all()
  }
  writeFileSync(dest, JSON.stringify(dump, null, 2), 'utf-8')
  audit({ action: 'DATA_EXPORTED', summary: `Exported data to ${dest}`, entityType: 'backup' })
  return { path: dest }
}
