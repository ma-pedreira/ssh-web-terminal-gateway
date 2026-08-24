import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import type { ScryptOptions } from 'node:crypto'
import { promisify } from 'node:util'

// promisify drops the options overload, so it is typed by hand.
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>

const PREFIX = 'scrypt'
const SALT_BYTES = 16
const KEY_BYTES = 64
const COST = Object.freeze({ N: 2 ** 16, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })

/** Derives an scrypt hash with a random salt. Format: scrypt$N$r$p$salt$hash */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await scrypt(password.normalize('NFKC'), salt, KEY_BYTES, { ...COST })
  return [PREFIX, COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join('$')
}

/** Verifies a password against a stored hash, in constant time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== PREFIX) return false

  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) return false
  if (N < 2 || r < 1 || p < 1) return false

  const salt = Buffer.from(parts[4] ?? '', 'base64')
  const expected = Buffer.from(parts[5] ?? '', 'base64')
  if (salt.byteLength === 0 || expected.byteLength === 0) return false

  const actual = await scrypt(password.normalize('NFKC'), salt, expected.byteLength, {
    N,
    r,
    p,
    maxmem: COST.maxmem,
  })

  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected)
}
