import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { closeDatabase, initDatabase } from '../src/main/db/connection'
import { seedAll } from '../src/main/db/seed'
import { setCurrentUser } from '../src/main/services/context'
import * as auth from '../src/main/services/auth'
import { db, schema } from '../src/main/db/connection'
import { eq } from 'drizzle-orm'

export interface TestCtx {
  dbPath: string
}

/** Spin up an isolated on-disk database with menu + dev users seeded. */
export function freshDb(): TestCtx {
  closeDatabase()
  const dir = mkdtempSync(join(tmpdir(), 'hkd-db-'))
  const dbPath = join(dir, 'test.db')
  process.env.HKD_DB_PATH = dbPath
  initDatabase({ path: dbPath })
  seedAll({ withDevUsers: true })
  setCurrentUser(null)
  return { dbPath }
}

export function teardown(): void {
  closeDatabase()
  delete process.env.HKD_DB_PATH
}

/** Sign in a seeded user and make them the current actor. Clears mustChangePassword. */
export function actAs(username: string): number {
  const u = db.select().from(schema.users).where(eq(schema.users.username, username)).get()!
  db.update(schema.users).set({ mustChangePassword: false }).where(eq(schema.users.id, u.id)).run()
  setCurrentUser({ id: u.id, username: u.username, fullName: u.fullName, role: u.role as 'ADMIN' | 'EMPLOYEE' })
  return u.id
}

export function loginAs(username: string, password: string): void {
  auth.login({ username, password })
}
