import type { DatabaseSync } from 'node:sqlite'
import { hashToken, newId, newToken } from '#lib/crypto/tokens'
import { findUserById, touchLastLogin } from '#lib/repos/users'
import type { User } from '#types'

/** Lifetime of the web application session (not of the SSH session). */
export const SESSION_TTL_HOURS = 12

// expires_at is stored as ISO 8601 ("2026-01-01T17:00:00.000Z") and SQLite's
// datetime('now') is "2026-01-01 20:00:00". Compared as plain text, "T" sorts
// after " ", so an expired session stayed valid until midnight UTC. Both
// sides go through datetime() so they are compared as moments, not as text.
const NOT_EXPIRED = "datetime(expires_at) > datetime('now')"
const EXPIRED = "datetime(expires_at) <= datetime('now')"

export interface IssuedSession {
  readonly sessionId: string
  readonly token: string
  readonly csrfToken: string
  readonly expiresAt: string
}

export interface ResolvedSession {
  readonly sessionId: string
  readonly user: User
  readonly csrfHash: string
}

export interface SessionContext {
  readonly clientIp: string | null
  readonly userAgent: string | null
}

export function createAppSession(
  db: DatabaseSync,
  userId: string,
  context: SessionContext,
): IssuedSession {
  const sessionId = newId()
  const token = newToken(32)
  const csrfToken = newToken(24)
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3_600_000).toISOString()

  db.prepare(
    `INSERT INTO app_sessions (id, user_id, token_hash, csrf_hash, client_ip, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    userId,
    hashToken(token),
    hashToken(csrfToken),
    context.clientIp,
    context.userAgent?.slice(0, 256) ?? null,
    expiresAt,
  )

  touchLastLogin(db, userId)
  return Object.freeze({ sessionId, token, csrfToken, expiresAt })
}

/** Resolves the session from the plaintext token in the cookie. */
export function resolveSession(db: DatabaseSync, token: string): ResolvedSession | null {
  if (token.length === 0) return null

  const row = db
    .prepare(
      `SELECT id, user_id, csrf_hash
       FROM app_sessions
       WHERE token_hash = ? AND ${NOT_EXPIRED}`,
    )
    .get(hashToken(token)) as { id: string; user_id: string; csrf_hash: string } | undefined

  if (!row) return null

  const user = findUserById(db, row.user_id)
  if (!user) return null

  return Object.freeze({ sessionId: row.id, user, csrfHash: row.csrf_hash })
}

export function destroySession(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM app_sessions WHERE token_hash = ?').run(hashToken(token))
}

/**
 * Whether an application session still exists and has not expired. Used to
 * re-check long-lived connections (the terminal WebSocket) that were
 * authorised when they were opened.
 */
export function isSessionActive(db: DatabaseSync, sessionId: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS found FROM app_sessions WHERE id = ? AND ${NOT_EXPIRED}`)
    .get(sessionId)
  return row !== undefined
}

/** Sessions about to be purged, so what hangs off them can be released. */
export function expiredSessionIds(db: DatabaseSync): readonly string[] {
  const rows = db.prepare(`SELECT id FROM app_sessions WHERE ${EXPIRED}`).all()
  return Object.freeze(rows.map((row) => String(row.id)))
}

export function purgeExpiredSessions(db: DatabaseSync): number {
  const result = db.prepare(`DELETE FROM app_sessions WHERE ${EXPIRED}`).run()
  return Number(result.changes)
}
