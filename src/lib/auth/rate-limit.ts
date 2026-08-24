import type { DatabaseSync } from 'node:sqlite'

export const MAX_ATTEMPTS = 5
const WINDOW_MINUTES = 15

export interface RateLimitState {
  readonly blocked: boolean
  readonly attempts: number
  readonly retryAfterSeconds: number
}

/** Counts recent failed attempts for an identifier. */
export function checkLoginRate(db: DatabaseSync, identifier: string): RateLimitState {
  const row = db
    .prepare(
      `SELECT count(*) AS n, max(attempted_at) AS last
       FROM login_attempts
       WHERE identifier = ? AND attempted_at > datetime('now', ?)`,
    )
    .get(identifier, `-${WINDOW_MINUTES} minutes`) as { n: number; last: string | null }

  const attempts = row.n
  if (attempts < MAX_ATTEMPTS) {
    return Object.freeze({ blocked: false, attempts, retryAfterSeconds: 0 })
  }

  const last = row.last ? Date.parse(`${row.last.replace(' ', 'T')}Z`) : Date.now()
  const elapsed = Math.max(0, Date.now() - last)
  const remaining = Math.max(1, Math.ceil((WINDOW_MINUTES * 60_000 - elapsed) / 1000))

  return Object.freeze({ blocked: true, attempts, retryAfterSeconds: remaining })
}

export function recordFailedLogin(db: DatabaseSync, identifier: string): void {
  db.prepare('INSERT INTO login_attempts (identifier) VALUES (?)').run(identifier)
}

export function clearLoginAttempts(db: DatabaseSync, identifier: string): void {
  db.prepare('DELETE FROM login_attempts WHERE identifier = ?').run(identifier)
}

export function purgeOldAttempts(db: DatabaseSync): number {
  const result = db
    .prepare("DELETE FROM login_attempts WHERE attempted_at <= datetime('now', '-1 day')")
    .run()
  return Number(result.changes)
}
