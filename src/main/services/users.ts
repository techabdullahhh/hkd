import { desc, eq, ne, sql } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'
import type { Role, User } from '@shared/types'
import type { SignupInput } from '@shared/ipc'
import { hashPassword, toUser, validatePasswordStrength } from './auth'
import { audit } from './audit'
import { requireAdmin } from './context'

export function listUsers(includeArchived = false): User[] {
  const rows = db
    .select()
    .from(schema.users)
    .where(includeArchived ? undefined : ne(schema.users.status, 'ARCHIVED'))
    .orderBy(desc(schema.users.createdAt))
    .all()
  return rows.map(toUser)
}

function getUserOrThrow(id: number) {
  const row = db.select().from(schema.users).where(eq(schema.users.id, id)).get()
  if (!row) throw new AppError('NOT_FOUND', 'That employee could not be found.')
  return row
}

export function createUser(input: SignupInput & { role: Role }): User {
  requireAdmin()
  const username = (input.username ?? '').trim()
  if (username.length < 3) throw new AppError('VALIDATION', 'Username must be at least 3 characters.')
  if ((input.fullName ?? '').trim().length < 2)
    throw new AppError('VALIDATION', 'Please enter the employee’s full name.')
  validatePasswordStrength(input.password)
  if (input.role !== 'ADMIN' && input.role !== 'EMPLOYEE')
    throw new AppError('VALIDATION', 'Invalid role.')

  const dup = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.username}) = lower(${username})`)
    .get()
  if (dup) throw new AppError('CONFLICT', 'That username is already taken.')

  const res = db
    .insert(schema.users)
    .values({
      username,
      fullName: input.fullName.trim(),
      passwordHash: hashPassword(input.password),
      role: input.role,
      status: 'ACTIVE',
      mustChangePassword: true,
      approvedAt: Date.now()
    })
    .run()
  const row = getUserOrThrow(Number(res.lastInsertRowid))
  audit({
    action: 'USER_CREATED',
    summary: `Created ${input.role.toLowerCase()} account "${username}"`,
    entityType: 'user',
    entityId: row.id
  })
  return toUser(row)
}

export function approveUser(userId: number, role: Role): User {
  requireAdmin()
  const row = getUserOrThrow(userId)
  if (row.status !== 'PENDING') throw new AppError('CONFLICT', 'That account is not pending approval.')
  db.update(schema.users)
    .set({ status: 'ACTIVE', role, approvedAt: Date.now() })
    .where(eq(schema.users.id, userId))
    .run()
  audit({
    action: 'USER_APPROVED',
    summary: `Approved "${row.username}" as ${role}`,
    entityType: 'user',
    entityId: userId
  })
  return toUser(getUserOrThrow(userId))
}

export function setUserStatus(userId: number, status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED'): User {
  const admin = requireAdmin()
  const row = getUserOrThrow(userId)
  if (userId === admin.id && status !== 'ACTIVE')
    throw new AppError('VALIDATION', 'You cannot disable or archive your own account.')
  if (row.role === 'ADMIN' && status !== 'ACTIVE') {
    const otherAdmins = db
      .select({ c: sql<number>`count(*)` })
      .from(schema.users)
      .where(sql`${schema.users.role} = 'ADMIN' AND ${schema.users.status} = 'ACTIVE' AND ${schema.users.id} <> ${userId}`)
      .get()!.c
    if (otherAdmins === 0)
      throw new AppError('VALIDATION', 'At least one active administrator must remain.')
  }
  // Ending sessions / tokens for disabled or archived users.
  if (status !== 'ACTIVE') {
    db.delete(schema.authTokens).where(eq(schema.authTokens.userId, userId)).run()
  }
  db.update(schema.users).set({ status }).where(eq(schema.users.id, userId)).run()
  audit({
    action: status === 'DISABLED' ? 'USER_DISABLED' : status === 'ARCHIVED' ? 'USER_ARCHIVED' : 'USER_REACTIVATED',
    summary: `${status === 'ACTIVE' ? 'Reactivated' : status === 'DISABLED' ? 'Disabled' : 'Archived'} "${row.username}"`,
    entityType: 'user',
    entityId: userId
  })
  return toUser(getUserOrThrow(userId))
}

export function setUserRole(userId: number, role: Role): User {
  const admin = requireAdmin()
  const row = getUserOrThrow(userId)
  if (userId === admin.id && role !== 'ADMIN')
    throw new AppError('VALIDATION', 'You cannot remove your own admin rights.')
  if (row.role === 'ADMIN' && role === 'EMPLOYEE') {
    const otherAdmins = db
      .select({ c: sql<number>`count(*)` })
      .from(schema.users)
      .where(sql`${schema.users.role} = 'ADMIN' AND ${schema.users.status} = 'ACTIVE' AND ${schema.users.id} <> ${userId}`)
      .get()!.c
    if (otherAdmins === 0) throw new AppError('VALIDATION', 'At least one administrator must remain.')
  }
  db.update(schema.users).set({ role }).where(eq(schema.users.id, userId)).run()
  audit({
    action: 'USER_ROLE_CHANGED',
    summary: `Changed "${row.username}" role ${row.role} → ${role}`,
    entityType: 'user',
    entityId: userId
  })
  return toUser(getUserOrThrow(userId))
}

export function resetUserPassword(userId: number, newPassword: string): void {
  requireAdmin()
  const row = getUserOrThrow(userId)
  validatePasswordStrength(newPassword)
  db.update(schema.users)
    .set({ passwordHash: hashPassword(newPassword), mustChangePassword: true })
    .where(eq(schema.users.id, userId))
    .run()
  db.delete(schema.authTokens).where(eq(schema.authTokens.userId, userId)).run()
  audit({
    action: 'USER_PASSWORD_RESET',
    summary: `Reset password for "${row.username}" (must change on next login)`,
    entityType: 'user',
    entityId: userId
  })
}

export function updateUser(userId: number, fullName?: string): User {
  requireAdmin()
  const row = getUserOrThrow(userId)
  if (fullName != null) {
    if (fullName.trim().length < 2) throw new AppError('VALIDATION', 'Full name is too short.')
    db.update(schema.users).set({ fullName: fullName.trim() }).where(eq(schema.users.id, userId)).run()
    audit({
      action: 'USER_UPDATED',
      summary: `Renamed "${row.username}" to ${fullName.trim()}`,
      entityType: 'user',
      entityId: userId
    })
  }
  return toUser(getUserOrThrow(userId))
}
