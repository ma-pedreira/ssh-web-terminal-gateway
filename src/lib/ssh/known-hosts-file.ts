import { createHmac, timingSafeEqual } from 'node:crypto'

export type KnownHostsVerdict =
  | { readonly outcome: 'trusted'; readonly keyType: string }
  | { readonly outcome: 'unknown'; readonly keyType: string }
  | { readonly outcome: 'mismatch'; readonly keyType: string; readonly expected: readonly string[] }

/** Pattern exactly as OpenSSH writes it: bracketed when the port is not 22. */
export function hostPattern(hostname: string, port: number): string {
  return port === 22 ? hostname : `[${hostname}]:${port}`
}

/**
 * Extracts the algorithm from the public key blob.
 * SSH format: a 4-byte length integer followed by the name.
 */
export function keyTypeOf(key: Buffer): string | null {
  if (key.byteLength < 4) return null
  const length = key.readUInt32BE(0)
  if (length <= 0 || length > 64 || key.byteLength < 4 + length) return null

  const name = key.subarray(4, 4 + length).toString('utf8')
  return /^[a-z0-9@.-]+$/i.test(name) ? name : null
}

interface Entry {
  readonly patterns: readonly string[]
  readonly hashed: { readonly salt: Buffer; readonly hash: Buffer } | null
  readonly keyType: string
  readonly key: string
  readonly revoked: boolean
}

function parseLine(line: string): Entry | null {
  const content = line.trim()
  if (content.length === 0 || content.startsWith('#')) return null

  const fields = content.split(/\s+/)
  let index = 0
  let revoked = false

  // The @revoked and @cert-authority markers precede the pattern.
  if (fields[index]?.startsWith('@')) {
    revoked = fields[index] === '@revoked'
    index += 1
  }

  const hosts = fields[index]
  const keyType = fields[index + 1]
  const key = fields[index + 2]
  if (!hosts || !keyType || !key) return null

  if (hosts.startsWith('|1|')) {
    const [, saltRaw, hashRaw] = hosts.split('|').filter((part) => part.length > 0)
    if (!saltRaw || !hashRaw) return null
    return {
      patterns: [],
      hashed: { salt: Buffer.from(saltRaw, 'base64'), hash: Buffer.from(hashRaw, 'base64') },
      keyType,
      key,
      revoked,
    }
  }

  return { patterns: hosts.split(','), hashed: null, keyType, key, revoked }
}

function matchesHost(entry: Entry, pattern: string, hostname: string): boolean {
  if (entry.hashed) {
    // The name is stored as HMAC-SHA1 using the salt of the entry itself.
    const computed = createHmac('sha1', entry.hashed.salt).update(pattern).digest()
    if (computed.byteLength !== entry.hashed.hash.byteLength) return false
    if (timingSafeEqual(computed, entry.hashed.hash)) return true

    const bare = createHmac('sha1', entry.hashed.salt).update(hostname).digest()
    return (
      bare.byteLength === entry.hashed.hash.byteLength && timingSafeEqual(bare, entry.hashed.hash)
    )
  }

  return entry.patterns.includes(pattern) || entry.patterns.includes(hostname)
}

/**
 * Checks the server key against the standard known_hosts file.
 * `unknown` means first use; `mismatch` means the key changed or was revoked.
 */
export function verifyAgainstKnownHosts(
  text: string,
  hostname: string,
  port: number,
  key: Buffer,
): KnownHostsVerdict {
  const keyType = keyTypeOf(key) ?? 'unknown'
  const pattern = hostPattern(hostname, port)
  const encoded = key.toString('base64')

  const candidates = text
    .split('\n')
    .map(parseLine)
    .filter((entry): entry is Entry => entry !== null)
    .filter((entry) => matchesHost(entry, pattern, hostname))
    .filter((entry) => entry.keyType === keyType)

  if (candidates.length === 0) return { outcome: 'unknown', keyType }

  const trusted = candidates.filter((entry) => !entry.revoked && entry.key === encoded)
  if (trusted.length > 0) return { outcome: 'trusted', keyType }

  return {
    outcome: 'mismatch',
    keyType,
    expected: Object.freeze(candidates.map((entry) => entry.key)),
  }
}

/**
 * Whether the file has any entry for this host, whatever the key type.
 * Used to tell whether the next connection will be a first use.
 */
export function hasKnownHostEntry(text: string, hostname: string, port: number): boolean {
  const pattern = hostPattern(hostname, port)
  return text
    .split('\n')
    .map(parseLine)
    .filter((entry): entry is Entry => entry !== null)
    .some((entry) => matchesHost(entry, pattern, hostname))
}

/** Appends the key to the file, in the same format ssh writes. */
export function appendHostKey(
  text: string,
  hostname: string,
  port: number,
  key: Buffer,
): string {
  const keyType = keyTypeOf(key)
  if (!keyType) {
    throw new Error('The server key is not in a recognisable format')
  }

  const line = `${hostPattern(hostname, port)} ${keyType} ${key.toString('base64')}`
  const separator = text.length === 0 || text.endsWith('\n') ? '' : '\n'
  return `${text}${separator}${line}\n`
}
