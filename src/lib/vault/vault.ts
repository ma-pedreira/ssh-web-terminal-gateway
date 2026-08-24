import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import type { ScryptOptions } from 'node:crypto'

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const SALT_BYTES = 16
const CHECK_PLAINTEXT = 'ssh-web:vault:ok'
const CHECK_ALIAS = 'ssh-web:internal:check'

/**
 * Domain separation: the vault key is derived from the same password used to
 * sign in, but with its own salt and this prefix, so knowing the sign-in hash
 * gets nobody any closer to the vault key.
 */
const DOMAIN = 'ssh-web:vault:v1 '

export const VAULT_VERSION = 1

export interface KdfParams {
  readonly algorithm: 'scrypt'
  readonly N: number
  readonly r: number
  readonly p: number
}

export const DEFAULT_KDF: KdfParams = Object.freeze({
  algorithm: 'scrypt',
  N: 2 ** 16,
  r: 8,
  p: 1,
})

export interface SealedValue {
  readonly iv: string
  readonly tag: string
  readonly ciphertext: string
}

export interface Vault {
  readonly version: number
  readonly kdf: KdfParams & { readonly salt: string }
  readonly check: SealedValue
  readonly entries: Readonly<Record<string, SealedValue>>
}

/** The alias travels as authenticated data: a ciphertext is useless in another entry. */
function contextFor(alias: string): Buffer {
  return Buffer.from(`ssh-web:vault:v1:${alias}`, 'utf8')
}

function seal(key: Buffer, context: Buffer, plaintext: string): SealedValue {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(context)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return Object.freeze({
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  })
}

function unseal(key: Buffer, context: Buffer, sealed: SealedValue): string {
  const iv = Buffer.from(sealed.iv, 'base64')
  const tag = Buffer.from(sealed.tag, 'base64')
  if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES) {
    throw new Error('The vault contents could not be decrypted: invalid format')
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAAD(context)
  decipher.setAuthTag(tag)

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch (cause) {
    throw new Error('The vault contents could not be decrypted', { cause })
  }
}

async function derive(password: string, salt: Buffer, kdf: KdfParams): Promise<Buffer> {
  return scrypt(DOMAIN + password.normalize('NFKC'), salt, KEY_BYTES, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 256 * 1024 * 1024,
  })
}

/** Creates an empty vault protected by the sign-in password. */
export async function createVault(password: string, kdf: KdfParams = DEFAULT_KDF): Promise<Vault> {
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt, kdf)

  return Object.freeze({
    version: VAULT_VERSION,
    kdf: Object.freeze({ ...kdf, salt: salt.toString('base64') }),
    check: seal(key, contextFor(CHECK_ALIAS), CHECK_PLAINTEXT),
    entries: Object.freeze({}),
  })
}

/**
 * Derives the key and checks that it opens the vault.
 * The returned key must only live in memory for the duration of the session.
 */
export async function unlockVault(vault: Vault, password: string): Promise<Buffer> {
  const key = await derive(password, Buffer.from(vault.kdf.salt, 'base64'), vault.kdf)

  let verified: string
  try {
    verified = unseal(key, contextFor(CHECK_ALIAS), vault.check)
  } catch (cause) {
    throw new Error('That password does not open the credential vault', { cause })
  }

  const expected = Buffer.from(CHECK_PLAINTEXT, 'utf8')
  const actual = Buffer.from(verified, 'utf8')
  if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected)) {
    throw new Error('That password does not open the credential vault')
  }

  return key
}

export function putEntry(vault: Vault, key: Buffer, alias: string, secret: string): Vault {
  return Object.freeze({
    ...vault,
    entries: Object.freeze({ ...vault.entries, [alias]: seal(key, contextFor(alias), secret) }),
  })
}

/** Returns the secret, or null if there is no entry for that alias. */
export function openEntry(vault: Vault, key: Buffer, alias: string): string | null {
  const sealed = vault.entries[alias]
  if (!sealed) return null
  return unseal(key, contextFor(alias), sealed)
}

export function removeEntry(vault: Vault, alias: string): Vault {
  const entries = Object.fromEntries(
    Object.entries(vault.entries).filter(([name]) => name !== alias),
  )
  return Object.freeze({ ...vault, entries: Object.freeze(entries) })
}

/** Aliases are not secret: they can be listed without opening the vault. */
export function listVaultAliases(vault: Vault): readonly string[] {
  return Object.freeze(Object.keys(vault.entries).sort())
}

export function serializeVault(vault: Vault): string {
  return `${JSON.stringify(vault, null, 2)}\n`
}

export function parseVault(text: string): Vault {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (cause) {
    throw new Error('The vault file is not valid JSON', { cause })
  }

  const vault = data as Partial<Vault>
  if (vault.version !== VAULT_VERSION) {
    throw new Error(`Unsupported vault version: ${String(vault.version)}`)
  }
  if (!vault.kdf?.salt || !vault.check || typeof vault.entries !== 'object') {
    throw new Error('The vault file is incomplete or corrupt')
  }

  return Object.freeze({
    version: vault.version,
    kdf: Object.freeze(vault.kdf),
    check: Object.freeze(vault.check),
    entries: Object.freeze({ ...vault.entries }),
  })
}
