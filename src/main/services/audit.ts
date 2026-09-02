import { and, desc, eq, like, or, sql } from 'drizzle-orm'
import { db, schema } from '../db/connection'
import type { AuditLogEntry, Paginated } from '@shared/types'
import { getCurrentUser } from './context'

export interface AuditInput {
  action: string
  summary: string
  entityType?: string
  entityId?: string | number
  details?: unknown
  actorId?: number
  actorName?: string
}

/** Append-only. The DB triggers forbid UPDATE/DELETE on audit_logs. */
export function audit(input: AuditInput): void {
  const cu = getCurrentUser()
  db.insert(schema.auditLogs)
    .values({
      action: input.action,
      summary: input.summary,
      entityType: input.entityType ?? null,
      entityId: input.entityId != null ? String(input.entityId) : null,
      detailsJson: input.details != null ? JSON.stringify(input.details) : null,
      actorId: input.actorId ?? cu?.id ?? null,
      actorName: input.actorName ?? cu?.fullName ?? 'system'
    })
    .run()
}

export function listAudit(q: {
  page?: number
  pageSize?: number
  action?: string
  actorId?: number
  search?: string
}): Paginated<AuditLogEntry> {
  const page = Math.max(1, q.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50))
  const conds = []
  if (q.action) conds.push(eq(schema.auditLogs.action, q.action))
  if (q.actorId) conds.push(eq(schema.auditLogs.actorId, q.actorId))
  if (q.search) {
    const s = `%${q.search}%`
    conds.push(or(like(schema.auditLogs.summary, s), like(schema.auditLogs.entityId, s)))
  }
  const where = conds.length ? and(...conds) : undefined

  const total = db
    .select({ c: sql<number>`count(*)` })
    .from(schema.auditLogs)
    .where(where)
    .get()!.c

  const rows = db
    .select()
    .from(schema.auditLogs)
    .where(where)
    .orderBy(desc(schema.auditLogs.at))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()

  return {
    rows: rows.map((r) => ({
      id: r.id,
      at: r.at,
      actorId: r.actorId,
      actorName: r.actorName,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      summary: r.summary,
      detailsJson: r.detailsJson
    })),
    total,
    page,
    pageSize
  }
}
