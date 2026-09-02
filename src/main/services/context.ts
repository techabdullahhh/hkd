import { eq } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import type { Role } from '@shared/types'
import { AppError } from '@shared/errors'

/**
 * The main process tracks exactly one signed-in user for the desktop window.
 * IPC handlers read it through `requireAuth` / `requireAdmin`. The renderer
 * additionally persists an opaque token so it can call `auth:restore` after
 * an app relaunch.
 */

export interface CurrentUser {
  id: number
  username: string
  fullName: string
  role: Role
}

let current: CurrentUser | null = null

export function setCurrentUser(u: CurrentUser | null): void {
  current = u
}

export function getCurrentUser(): CurrentUser | null {
  return current
}

export function requireAuth(): CurrentUser {
  if (!current) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue.')
  // Re-check the account is still active on every privileged call.
  const row = db
    .select({ status: schema.users.status, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.id, current.id))
    .get()
  if (!row) throw new AppError('UNAUTHENTICATED', 'Your account no longer exists.')
  if (row.status === 'DISABLED') throw new AppError('ACCOUNT_DISABLED', 'Your account has been disabled.')
  if (row.status === 'ARCHIVED') throw new AppError('ACCOUNT_DISABLED', 'Your account has been archived.')
  if (row.status === 'PENDING') throw new AppError('ACCOUNT_PENDING', 'Your account is awaiting approval.')
  current.role = row.role as Role
  return current
}

export function requireAdmin(): CurrentUser {
  const u = requireAuth()
  if (u.role !== 'ADMIN') throw new AppError('UNAUTHORIZED', 'Only an administrator can do that.')
  return u
}
