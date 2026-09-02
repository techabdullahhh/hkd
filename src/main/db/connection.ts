import { app } from 'electron'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import * as schema from './schema'
import { runMigrations } from './migrate'

let sqlite: Database.Database | null = null
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null
let _dbPath = ''

export function getDbPath(): string {
  if (_dbPath) return _dbPath
  // In tests / CLI there may be no Electron app context.
  let base: string
  try {
    base = app.getPath('userData')
  } catch {
    base = process.env.HKD_DATA_DIR || join(process.cwd(), '.hkd-data')
  }
  const dir = join(base, 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  _dbPath = process.env.HKD_DB_PATH || join(dir, 'taste-of-hkd.db')
  return _dbPath
}

export function getBackupDir(): string {
  let base: string
  try {
    base = app.getPath('userData')
  } catch {
    base = process.env.HKD_DATA_DIR || join(process.cwd(), '.hkd-data')
  }
  const dir = join(base, 'backups')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function getImagesDir(): string {
  let base: string
  try {
    base = app.getPath('userData')
  } catch {
    base = process.env.HKD_DATA_DIR || join(process.cwd(), '.hkd-data')
  }
  const dir = join(base, 'images')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function initDatabase(opts: { path?: string } = {}): void {
  if (sqlite) return
  const path = opts.path || getDbPath()
  _dbPath = path
  sqlite = new Database(path)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('busy_timeout = 5000')
  _db = drizzle(sqlite, { schema })
  runMigrations(sqlite)
}

export function rawDb(): Database.Database {
  if (!sqlite) throw new Error('Database not initialised — call initDatabase() first')
  return sqlite
}

export function closeDatabase(): void {
  sqlite?.close()
  sqlite = null
  _db = null
}

export function reopenDatabase(): void {
  closeDatabase()
  _dbPath = ''
  initDatabase()
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_t, prop) {
    if (!_db) throw new Error('Database not initialised — call initDatabase() first')
    // @ts-expect-error dynamic proxy passthrough
    return _db[prop]
  }
})

export { schema }
