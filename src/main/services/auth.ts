import bcrypt from 'bcryptjs'
import { customAlphabet } from 'nanoid'
import { eq, sql } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import { AppError } from '@shared/errors'
import type { AuthUser, Role, User } from '@shared/types'
import type { LoginInput, SignupInput } from '@shared/ipc'
import { audit } from './audit'
import { setCurrentUser } from './context'

const tokenId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', 48)
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 14 // 14 days
const BCRYPT_ROUNDS = 11

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_ROUNDS)
}

export function verifyPassword(plain: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plain, hash)
  } catch {
    return false
  }
}

/** Password policy shared by signup, reset and change flows. */
export function validatePasswordStrength(pw: string): void {
  if (typeof pw !== 'string' || pw.length < 8)
    throw new AppError('VALIDATION', 'Password must be at least 8 characters.')
  if (pw.length > 200) throw new AppError('VALIDATION', 'Password is too long.')
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw))
    throw new AppError('VALIDATION', 'Password must contain at least one letter and one number.')
}

function validateUsername(u: string): string {
  const v = (u ?? '').trim()
  if (v.length < 3 || v.length > 40)
    throw new AppError('VALIDATION', 'Username must be 3–40 characters.')
  if (!/^[A-Za-z0-9_.\- ]+$/.test(v))
    throw new AppError('VALIDATION', 'Username may only contain letters, numbers, spaces and _ . -')
  return v
}

function toUser(row: typeof schema.users.$inferSelect): User {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    role: row.role as Role,
    status: row.status as User['status'],
    mustChangePassword: row.mustChangePassword,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    lastLoginAt: row.lastLoginAt
  }
}

export function countUsers(): number {
  return db.select({ c: sql<number>`count(*)` }).from(schema.users).get()!.c
}

export function signup(input: SignupInput): { user: User } {
  const username = validateUsername(input.username)
  const fullName = (input.fullName ?? '').trim()
  if (fullName.length < 2) throw new AppError('VALIDATION', 'Please enter your full name.')
  validatePasswordStrength(input.password)

  const existing = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(sql`lower(${schema.users.username}) = lower(${username})`)
    .get()
  if (existing) throw new AppError('CONFLICT', 'That username is already taken.')

  // The very first account bootstraps as an ACTIVE ADMIN so the system is
  // usable. Every subsequent signup is a PENDING EMPLOYEE awaiting approval.
  const isFirst = countUsers() === 0
  const nowMs = Date.now()
  const res = db
    .insert(schema.users)
    .values({
      username,
      fullName,
      passwordHash: hashPassword(input.password),
      role: isFirst ? 'ADMIN' : 'EMPLOYEE',
      status: isFirst ? 'ACTIVE' : 'PENDING',
      mustChangePassword: false,
      approvedAt: isFirst ? nowMs : null
    })
    .run()

  const user = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, Number(res.lastInsertRowid)))
    .get()!

  audit({
    action: 'USER_SIGNUP',
    summary: isFirst
      ? `First account "${username}" created and bootstrapped as ADMIN`
      : `New account "${username}" registered — pending admin approval`,
    entityType: 'user',
    entityId: user.id,
    actorId: user.id,
    actorName: user.fullName
  })

  return { user: toUser(user) }
}

function issueToken(userId: number): string {
  const token = tokenId()
  db.insert(schema.authTokens)
    .values({ token, userId, expiresAt: Date.now() + TOKEN_TTL_MS })
    .run()
  // prune expired tokens opportunistically
  db.delete(schema.authTokens).where(sql`${schema.authTokens.expiresAt} < ${Date.now()}`).run()
  return token
}

export function login(input: LoginInput): AuthUser {
  const username = (input.username ?? '').trim()
  const row = db
    .select()
    .from(schema.users)
    .where(sql`lower(${schema.users.username}) = lower(${username})`)
    .get()

  // Constant-ish time: always run a bcrypt compare.
  const ok = row ? verifyPassword(input.password ?? '', row.passwordHash) : verifyPassword('x', '$2a$11$0000000000000000000000000000000000000000000000000000')
  if (!row || !ok) throw new AppError('BAD_CREDENTIALS', 'Incorrect username or password.')

  if (row.status === 'PENDING')
    throw new AppError('ACCOUNT_PENDING', 'Your account is awaiting administrator approval.')
  if (row.status === 'DISABLED')
    throw new AppError('ACCOUNT_DISABLED', 'This account has been disabled. Contact your administrator.')
  if (row.status === 'ARCHIVED')
    throw new AppError('ACCOUNT_DISABLED', 'This account has been archived. Contact your administrator.')

  const token = issueToken(row.id)
  db.update(schema.users).set({ lastLoginAt: Date.now() }).where(eq(schema.users.id, row.id)).run()
  setCurrentUser({ id: row.id, username: row.username, fullName: row.fullName, role: row.role as Role })

  audit({
    action: 'AUTH_LOGIN',
    summary: `${row.fullName} signed in`,
    entityType: 'user',
    entityId: row.id,
    actorId: row.id,
    actorName: row.fullName
  })

  return { ...toUser({ ...row, lastLoginAt: Date.now() }), token }
}

export function restore(token: string): AuthUser {
  const rec = db
    .select()
    .from(schema.authTokens)
    .where(eq(schema.authTokens.token, token))
    .get()
  if (!rec || rec.expiresAt < Date.now()) {
    if (rec) db.delete(schema.authTokens).where(eq(schema.authTokens.token, token)).run()
    throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.')
  }
  const row = db.select().from(schema.users).where(eq(schema.users.id, rec.userId)).get()
  if (!row) throw new AppError('SESSION_EXPIRED', 'Your session is no longer valid.')
  if (row.status !== 'ACTIVE')
    throw new AppError('ACCOUNT_DISABLED', 'This account is not active.')

  db.update(schema.authTokens)
    .set({ lastSeenAt: Date.now() })
    .where(eq(schema.authTokens.token, token))
    .run()
  setCurrentUser({ id: row.id, username: row.username, fullName: row.fullName, role: row.role as Role })
  return { ...toUser(row), token }
}

export function logout(token?: string): void {
  if (token) db.delete(schema.authTokens).where(eq(schema.authTokens.token, token)).run()
  setCurrentUser(null)
}

export function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string
): { token: string } {
  const row = db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  if (!row) throw new AppError('NOT_FOUND', 'Account not found.')
  if (!verifyPassword(currentPassword ?? '', row.passwordHash))
    throw new AppError('BAD_CREDENTIALS', 'Your current password is incorrect.')
  validatePasswordStrength(newPassword)
  if (verifyPassword(newPassword, row.passwordHash))
    throw new AppError('VALIDATION', 'Please choose a password you have not used before.')

  db.update(schema.users)
    .set({ passwordHash: hashPassword(newPassword), mustChangePassword: false })
    .where(eq(schema.users.id, userId))
    .run()
  // Invalidate every existing token for this user, then keep THIS device
  // signed in with a fresh one.
  db.delete(schema.authTokens).where(eq(schema.authTokens.userId, userId)).run()
  const token = issueToken(userId)
  setCurrentUser({ id: row.id, username: row.username, fullName: row.fullName, role: row.role as Role })
  audit({
    action: 'AUTH_PASSWORD_CHANGE',
    summary: `${row.fullName} changed their password`,
    entityType: 'user',
    entityId: userId
  })
  return { token }
}

export { toUser }
