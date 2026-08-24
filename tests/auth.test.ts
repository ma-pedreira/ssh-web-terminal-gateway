import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { createTestDb } from '#lib/db/client'
import { createUser } from '#lib/repos/users'
import {
  createAppSession,
  destroySession,
  purgeExpiredSessions,
  resolveSession,
} from '#lib/auth/session'
import { isCsrfValid } from '#lib/auth/csrf'
import {
  MAX_ATTEMPTS,
  checkLoginRate,
  clearLoginAttempts,
  purgeOldAttempts,
  recordFailedLogin,
} from '#lib/auth/rate-limit'
import { hashToken } from '#lib/crypto/tokens'
import type { User } from '#types'

let db: DatabaseSync
let user: User
const context = { clientIp: '127.0.0.1', userAgent: 'vitest' }

beforeEach(async () => {
  db = createTestDb()
  user = await createUser(db, 'operator', 'test-password-1')
})

describe('application sessions', () => {
  it('resolves the session from the token', () => {
    const issued = createAppSession(db, user.id, context)
    const resolved = resolveSession(db, issued.token)
    expect(resolved?.user.id).toBe(user.id)
    expect(resolved?.sessionId).toBe(issued.sessionId)
  })

  it('stores only the token fingerprint, never the token', () => {
    const issued = createAppSession(db, user.id, context)
    const row = db.prepare('SELECT token_hash, csrf_hash FROM app_sessions').get() as {
      token_hash: string
      csrf_hash: string
    }
    expect(row.token_hash).toBe(hashToken(issued.token))
    expect(row.token_hash).not.toBe(issued.token)
    expect(row.csrf_hash).not.toBe(issued.csrfToken)
  })

  it('rejects unknown and empty tokens', () => {
    expect(resolveSession(db, 'token-inventado')).toBeNull()
    expect(resolveSession(db, '')).toBeNull()
  })

  it('rejects expired sessions', () => {
    const issued = createAppSession(db, user.id, context)
    db.prepare("UPDATE app_sessions SET expires_at = datetime('now', '-1 hour')").run()
    expect(resolveSession(db, issued.token)).toBeNull()
  })

  it('records the user last sign-in', () => {
    createAppSession(db, user.id, context)
    const row = db.prepare('SELECT last_login_at FROM users WHERE id = ?').get(user.id) as {
      last_login_at: string | null
    }
    expect(row.last_login_at).not.toBeNull()
  })

  it('destroys the session on sign-out', () => {
    const issued = createAppSession(db, user.id, context)
    destroySession(db, issued.token)
    expect(resolveSession(db, issued.token)).toBeNull()
  })

  it('purges expired sessions', () => {
    createAppSession(db, user.id, context)
    db.prepare("UPDATE app_sessions SET expires_at = datetime('now', '-1 hour')").run()
    expect(purgeExpiredSessions(db)).toBe(1)
  })

  it('truncates overly long user-agent headers', () => {
    createAppSession(db, user.id, { clientIp: null, userAgent: 'x'.repeat(1000) })
    const row = db.prepare('SELECT user_agent FROM app_sessions').get() as { user_agent: string }
    expect(row.user_agent).toHaveLength(256)
  })
})

describe('CSRF', () => {
  it('accepts the token matching the stored fingerprint', () => {
    const issued = createAppSession(db, user.id, context)
    const resolved = resolveSession(db, issued.token)
    expect(isCsrfValid(issued.csrfToken, resolved!.csrfHash)).toBe(true)
  })

  it('rejects a missing or different token', () => {
    const issued = createAppSession(db, user.id, context)
    const resolved = resolveSession(db, issued.token)
    expect(isCsrfValid(null, resolved!.csrfHash)).toBe(false)
    expect(isCsrfValid('otro-token', resolved!.csrfHash)).toBe(false)
  })
})

describe('sign-in attempt limit', () => {
  it('lets through below the limit', () => {
    recordFailedLogin(db, 'operator')
    const state = checkLoginRate(db, 'operator')
    expect(state.blocked).toBe(false)
    expect(state.attempts).toBe(1)
  })

  it('blocks on reaching the limit', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordFailedLogin(db, 'operator')
    const state = checkLoginRate(db, 'operator')
    expect(state.blocked).toBe(true)
    expect(state.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('counts per identifier independently', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordFailedLogin(db, 'operator')
    expect(checkLoginRate(db, 'otro').blocked).toBe(false)
  })

  it('a successful sign-in clears the counter', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordFailedLogin(db, 'operator')
    clearLoginAttempts(db, 'operator')
    expect(checkLoginRate(db, 'operator').blocked).toBe(false)
  })

  it('ignores attempts outside the window', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) recordFailedLogin(db, 'operator')
    db.prepare("UPDATE login_attempts SET attempted_at = datetime('now', '-1 hour')").run()
    expect(checkLoginRate(db, 'operator').blocked).toBe(false)
  })

  it('purges old attempts', () => {
    recordFailedLogin(db, 'operator')
    db.prepare("UPDATE login_attempts SET attempted_at = datetime('now', '-2 days')").run()
    expect(purgeOldAttempts(db)).toBe(1)
  })
})
