import { hashToken } from '#lib/crypto/tokens'
import { safeEquals } from '#lib/crypto/compare'

export const CSRF_HEADER = 'x-ssh-web-csrf'

/**
 * Double submit: the token travels in a readable cookie and is repeated in a
 * header. A third-party site can trigger the request but cannot read the
 * cookie to fill in the header.
 */
export function isCsrfValid(headerToken: string | null, storedHash: string): boolean {
  if (!headerToken) return false
  return safeEquals(hashToken(headerToken), storedHash)
}
