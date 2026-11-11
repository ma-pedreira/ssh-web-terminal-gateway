import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#lib/db/client'
import { createUser } from '#lib/repos/users'
import { createAppSession } from '#lib/auth/session'
import { CSRF_HEADER } from '#lib/auth/csrf'
import { SESSION_COOKIE } from '#lib/auth/cookies'
import { clientIpOf, requireUser } from '#lib/api/guard'
import { ApiError } from '#lib/api/respond'

const db = getDb()
let token: string
let csrf: string
let username = 0

beforeEach(async () => {
  db.exec('DELETE FROM app_sessions')
  db.exec('DELETE FROM users')
  username += 1
  const user = await createUser(db, `guard${username}`, 'test-password-1')
  const issued = createAppSession(db, user.id, { clientIp: '127.0.0.1', userAgent: 'vitest' })
  token = issued.token
  csrf = issued.csrfToken
})

function request(
  method: string,
  headers: Readonly<Record<string, string>> = {},
): Request {
  return new Request('http://localhost:3030/api/hosts', { method, headers })
}

const withSession = (extra: Readonly<Record<string, string>> = {}) => ({
  cookie: `${SESSION_COOKIE}=${token}`,
  ...extra,
})

describe('API guard', () => {
  it('accepts a read with a valid session', () => {
    const context = requireUser(request('GET', withSession()))
    expect(context.user.username).toBe(`guard${username}`)
  })

  it('rejects when there is no cookie', () => {
    expect(() => requireUser(request('GET'))).toThrow(ApiError)
    try {
      requireUser(request('GET'))
    } catch (error) {
      expect((error as ApiError).status).toBe(401)
    }
  })

  it('rejects an unknown token', () => {
    expect(() => requireUser(request('GET', { cookie: `${SESSION_COOKIE}=inventado` }))).toThrow(
      /expired/i,
    )
  })

  it('rejects an expired session', () => {
    db.prepare("UPDATE app_sessions SET expires_at = datetime('now', '-1 hour')").run()
    expect(() => requireUser(request('GET', withSession()))).toThrow(/expired/i)
  })

  it('requires a CSRF token on state-changing methods', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(() => requireUser(request(method, withSession()))).toThrow(/CSRF/i)
    }
  })

  it('accepts the mutation with the right CSRF token', () => {
    const context = requireUser(request('POST', withSession({ [CSRF_HEADER]: csrf })))
    expect(context.user.username).toBe(`guard${username}`)
  })

  it('rejects a CSRF token that does not match', () => {
    expect(() =>
      requireUser(request('POST', withSession({ [CSRF_HEADER]: 'token-ajeno' }))),
    ).toThrow(/CSRF/i)
  })

  it('rejects an origin different from the target', () => {
    expect(() =>
      requireUser(
        request('POST', withSession({ [CSRF_HEADER]: csrf, origin: 'http://evil.example' })),
      ),
    ).toThrow(/[Oo]rigin/)
  })

  it('accepts an origin matching the host', () => {
    const context = requireUser(
      request(
        'POST',
        withSession({ [CSRF_HEADER]: csrf, origin: 'http://localhost:3030', host: 'localhost:3030' }),
      ),
    )
    expect(context.user).toBeTruthy()
  })

  it('reads the client address that server.ts resolved', () => {
    expect(clientIpOf(request('GET', { 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(clientIpOf(request('GET'))).toBeNull()
  })

  it('does not believe X-Forwarded-For, which the client can write', () => {
    expect(clientIpOf(request('GET', { 'x-forwarded-for': '203.0.113.7' }))).toBeNull()
  })

  it('caps the length of the received address', () => {
    const ip = clientIpOf(request('GET', { 'x-real-ip': '9'.repeat(200) }))
    expect(ip).toHaveLength(64)
  })
})
