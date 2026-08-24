import { createHash, randomBytes, randomUUID } from 'node:crypto'

/** Opaque identifier for database rows. */
export function newId(): string {
  return randomUUID()
}

/** Session or CSRF token, safe for headers and cookies. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/**
 * Fingerprint of the token, for storing in the database.
 * The plaintext token only ever exists in the client cookie, never on disk.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}
