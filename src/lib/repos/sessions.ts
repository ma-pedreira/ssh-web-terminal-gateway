import type { DatabaseSync } from 'node:sqlite'
import { newId } from '#lib/crypto/tokens'
import type { SessionSummary, SshSession, SshSessionStatus } from '#types'

interface SessionRow {
  id: string
  user_id: string
  host_alias: string
  hostname: string
  host_user: string | null
  port: number
  status: string
  client_ip: string | null
  cols: number
  rows: number
  started_at: string
  last_activity_at: string
  ended_at: string | null
  exit_code: number | null
  close_reason: string | null
}

function toSession(row: SessionRow): SshSession {
  return Object.freeze({
    id: row.id,
    userId: row.user_id,
    hostAlias: row.host_alias,
    hostname: row.hostname,
    hostUser: row.host_user,
    port: row.port,
    status: row.status as SshSessionStatus,
    clientIp: row.client_ip,
    startedAt: row.started_at,
    lastActivityAt: row.last_activity_at,
    endedAt: row.ended_at,
    exitCode: row.exit_code,
    closeReason: row.close_reason,
  })
}

export interface OpenSessionInput {
  readonly userId: string
  readonly hostAlias: string
  readonly hostname: string
  readonly hostUser: string | null
  readonly port: number
  readonly clientIp: string | null
  readonly cols: number
  readonly rows: number
}

export function openSession(db: DatabaseSync, input: OpenSessionInput): SshSession {
  const id = newId()
  db.prepare(
    `INSERT INTO ssh_sessions
       (id, user_id, host_alias, hostname, host_user, port, status, client_ip, cols, rows)
     VALUES (?, ?, ?, ?, ?, ?, 'connecting', ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    input.hostAlias,
    input.hostname,
    input.hostUser,
    input.port,
    input.clientIp,
    input.cols,
    input.rows,
  )
  return findSession(db, id, input.userId) as SshSession
}

export function findSession(db: DatabaseSync, id: string, userId: string): SshSession | null {
  const row = db
    .prepare('SELECT * FROM ssh_sessions WHERE id = ? AND user_id = ?')
    .get(id, userId) as SessionRow | undefined
  return row ? toSession(row) : null
}

export function setStatus(
  db: DatabaseSync,
  id: string,
  status: SshSessionStatus,
  options: { readonly exitCode?: number | null; readonly closeReason?: string | null } = {},
): void {
  const terminal = status === 'closed' || status === 'failed'
  db.prepare(
    `UPDATE ssh_sessions
     SET status = ?,
         last_activity_at = datetime('now'),
         ended_at = CASE WHEN ? = 1 THEN datetime('now') ELSE ended_at END,
         exit_code = COALESCE(?, exit_code),
         close_reason = COALESCE(?, close_reason)
     WHERE id = ?`,
  ).run(status, terminal ? 1 : 0, options.exitCode ?? null, options.closeReason ?? null, id)
}

export function touchActivity(db: DatabaseSync, id: string): void {
  db.prepare("UPDATE ssh_sessions SET last_activity_at = datetime('now') WHERE id = ?").run(id)
}

export function setViewport(db: DatabaseSync, id: string, cols: number, rows: number): void {
  db.prepare('UPDATE ssh_sessions SET cols = ?, rows = ? WHERE id = ?').run(cols, rows, id)
}

export function listSessions(
  db: DatabaseSync,
  userId: string,
  liveIds: ReadonlySet<string>,
  limit = 50,
): readonly SessionSummary[] {
  const rows = db
    .prepare(
      `SELECT * FROM ssh_sessions
       WHERE user_id = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(userId, Math.min(limit, 200)) as unknown as readonly SessionRow[]

  return Object.freeze(
    rows.map((row) => Object.freeze({ ...toSession(row), resumable: liveIds.has(row.id) })),
  )
}

/**
 * Deletes a user's already-finished sessions from the history.
 * Live ones are kept: deleting their row would orphan an SSH connection that
 * is still open on the server.
 */
export function deleteFinishedSessions(db: DatabaseSync, userId: string): number {
  const result = db
    .prepare("DELETE FROM ssh_sessions WHERE user_id = ? AND status IN ('closed', 'failed')")
    .run(userId)
  return Number(result.changes)
}

/**
 * Discards a session that never got as far as being attempted.
 * Used when a secret is missing: asking for one is a precondition, not a
 * connection attempt, and must not show up in the history.
 */
export function discardSession(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM ssh_sessions WHERE id = ?').run(id)
}

/** Sessions left marked as live after a server restart. */
export function reconcileOrphans(db: DatabaseSync): number {
  const result = db
    .prepare(
      `UPDATE ssh_sessions
       SET status = 'closed',
           ended_at = datetime('now'),
           close_reason = 'The server restarted'
       WHERE status IN ('connecting', 'active', 'suspended')`,
    )
    .run()
  return Number(result.changes)
}
