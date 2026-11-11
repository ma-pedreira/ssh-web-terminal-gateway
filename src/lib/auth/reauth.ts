import type { DatabaseSync } from 'node:sqlite'
import { verifyPassword } from '#lib/crypto/password'
import { findUserWithHash } from '#lib/repos/users'
import { checkLoginRate, clearLoginAttempts, recordFailedLogin } from '#lib/auth/rate-limit'
import { ApiError } from '#lib/api/respond'
import type { User } from '#types'

/**
 * Asks a signed-in user for their password again, for the operations that
 * need it (the password is what encrypts the vault).
 *
 * Limited like the sign-in form: a stolen session must not become a way of
 * guessing the password without a cap. The counter is separate, so failures
 * here never lock the sign-in form.
 */
export async function confirmPassword(db: DatabaseSync, user: User, password: string): Promise<void> {
  const identifier = `reauth:${user.id}`

  const rate = checkLoginRate(db, identifier)
  if (rate.blocked) {
    throw new ApiError(
      `Too many failed attempts. Try again in ${Math.ceil(rate.retryAfterSeconds / 60)} minutes.`,
      429,
    )
  }

  const stored = findUserWithHash(db, user.username)
  if (!stored || !(await verifyPassword(password, stored.password_hash))) {
    recordFailedLogin(db, identifier)
    throw new ApiError('That password is not correct', 403)
  }

  clearLoginAttempts(db, identifier)
}
