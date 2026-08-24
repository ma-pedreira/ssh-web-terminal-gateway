import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '#lib/db/client'
import { getEnv } from '#lib/env'
import { CSRF_HEADER, isCsrfValid } from '#lib/auth/csrf'
import { parseCookies, SESSION_COOKIE } from '#lib/auth/cookies'
import { resolveSession, type ResolvedSession } from '#lib/auth/session'
import { ApiError } from '#lib/api/respond'
import type { User } from '#types'

export interface RequestContext {
  readonly db: DatabaseSync
  readonly user: User
  readonly session: ResolvedSession
  readonly clientIp: string | null
}

/** Client address, honouring a local reverse proxy. */
export function clientIpOf(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first.slice(0, 64)
  }
  return request.headers.get('x-real-ip')?.slice(0, 64) ?? null
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Requires a valid session and, on state-changing methods, a CSRF token.
 * Throws ApiError, which the handler turns into a response.
 */
export function requireUser(request: Request): RequestContext {
  const db = getDb()
  const cookies = parseCookies(request.headers.get('cookie'))
  const token = cookies[SESSION_COOKIE]

  if (!token) throw new ApiError('No active session', 401)

  const session = resolveSession(db, token)
  if (!session) throw new ApiError('The session has expired', 401)

  if (MUTATING.has(request.method)) {
    if (!isCsrfValid(request.headers.get(CSRF_HEADER), session.csrfHash)) {
      throw new ApiError('Missing or invalid CSRF token', 403)
    }
    // Origin must match the target: blocks cross-site requests.
    const origin = request.headers.get('origin')
    if (origin) {
      const host = request.headers.get('host')
      const expected = new URL(request.url)
      if (new URL(origin).host !== (host ?? expected.host)) {
        throw new ApiError('Origin not allowed', 403)
      }
    }
  }

  return Object.freeze({ db, user: session.user, session, clientIp: clientIpOf(request) })
}

export function isSecureCookies(): boolean {
  return getEnv().SSH_WEB_SECURE_COOKIES
}
