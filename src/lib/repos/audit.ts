import type { DatabaseSync } from 'node:sqlite'
import type { AuditAction, AuditEntry } from '#types'

export interface AuditInput {
  readonly userId?: string | null
  readonly action: AuditAction
  readonly targetId?: string | null
  readonly clientIp?: string | null
  readonly detail?: string | null
}

/** Records an auditable event. Secrets are never written to `detail`. */
export function record(db: DatabaseSync, entry: AuditInput): void {
  db.prepare(
    'INSERT INTO audit_log (user_id, action, target_id, client_ip, detail) VALUES (?, ?, ?, ?, ?)',
  ).run(
    entry.userId ?? null,
    entry.action,
    entry.targetId ?? null,
    entry.clientIp ?? null,
    entry.detail ?? null,
  )
}

export function listRecent(db: DatabaseSync, userId: string, limit = 100): readonly AuditEntry[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, action, target_id, client_ip, detail, created_at
       FROM audit_log
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(userId, Math.min(limit, 500)) as ReadonlyArray<Record<string, unknown>>

  return Object.freeze(
    rows.map((row) =>
      Object.freeze({
        id: Number(row.id),
        userId: (row.user_id as string | null) ?? null,
        action: row.action as AuditAction,
        targetId: (row.target_id as string | null) ?? null,
        clientIp: (row.client_ip as string | null) ?? null,
        detail: (row.detail as string | null) ?? null,
        createdAt: String(row.created_at),
      }),
    ),
  )
}
