import { getDb } from '#lib/db/client'
import { findUserWithHash } from '#lib/repos/users'
import { verifyPassword } from '#lib/crypto/password'
import { createAppSession } from '#lib/auth/session'
import { csrfCookie, sessionCookie } from '#lib/auth/cookies'
import { checkLoginRate, clearLoginAttempts, recordFailedLogin } from '#lib/auth/rate-limit'
import { record } from '#lib/repos/audit'
import { ApiError, ok } from '#lib/api/respond'
import { jsonBody, route } from '#lib/api/route'
import { clientIpOf, isSecureCookies } from '#lib/api/guard'
import { loginSchema } from '#lib/validation/schemas'
import { getSettings } from '#lib/settings/store'
import { openOrCreateVault, vaultExists } from '#lib/vault/store'
import { rememberKey } from '#lib/vault/keyring'
import { logger } from '#lib/logger'

export const POST = route(async (request: Request) => {
  const db = getDb()
  const clientIp = clientIpOf(request)
  const { username, password } = loginSchema.parse(await jsonBody(request))
  const identifier = username.toLowerCase()

  const rate = checkLoginRate(db, identifier)
  if (rate.blocked) {
    throw new ApiError(
      `Too many failed attempts. Try again in ${Math.ceil(rate.retryAfterSeconds / 60)} minutes.`,
      429,
    )
  }

  const stored = findUserWithHash(db, identifier)
  // Always verified against a hash so timing does not reveal whether the
  // user exists. The error message does not distinguish either.
  const referenceHash =
    stored?.password_hash ?? 'scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAA=='
  const valid = await verifyPassword(password, referenceHash)

  if (!stored || !valid) {
    recordFailedLogin(db, identifier)
    record(db, {
      userId: stored?.id ?? null,
      action: 'user.login.failed',
      clientIp,
      detail: identifier,
    })
    throw new ApiError('Incorrect username or password', 401)
  }

  clearLoginAttempts(db, identifier)
  const issued = createAppSession(db, stored.id, {
    clientIp,
    userAgent: request.headers.get('user-agent'),
  })
  record(db, { userId: stored.id, action: 'user.login', clientIp })

  // The vault key is derived here, while the password is still in memory, and
  // is tied to this session. It is not stored anywhere.
  if (getSettings().vaultEnabled || vaultExists()) {
    try {
      rememberKey(issued.sessionId, await openOrCreateVault(password))
    } catch (error) {
      logger.warn('The credential vault could not be opened with this password', {
        error: (error as Error).message,
      })
    }
  }

  const secure = isSecureCookies()
  const response = ok({ username: stored.username, csrfToken: issued.csrfToken })
  response.headers.append('Set-Cookie', sessionCookie(issued.token, secure))
  response.headers.append('Set-Cookie', csrfCookie(issued.csrfToken, secure))
  return response
})
