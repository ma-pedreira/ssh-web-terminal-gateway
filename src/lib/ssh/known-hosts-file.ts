import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

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

/** Fingerprint as `ssh-keygen -lf` prints it, to compare by eye. */
export function fingerprintOf(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
}

interface Entry {
  readonly patterns: readonly string[]
  readonly hashed: { readonly salt: Buffer; readonly hash: Buffer } | null
  readonly keyType: string
  readonly key: string
  readonly revoked: boolean
  /** A CA line vouches for certificates; it does not pin a host key. */
  readonly certAuthority: boolean
}

function parseLine(line: string): Entry | null {
  const content = line.trim()
  if (content.length === 0 || content.startsWith('#')) return null

  const fields = content.split(/\s+/)
  let index = 0
  let revoked = false
  let certAuthority = false

  // The @revoked and @cert-authority markers precede the pattern.
  if (fields[index]?.startsWith('@')) {
    revoked = fields[index] === '@revoked'
    certAuthority = fields[index] === '@cert-authority'
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
      certAuthority,
    }
  }

  return { patterns: hosts.split(','), hashed: null, keyType, key, revoked, certAuthority }
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

/** Entries that pin a key for this host. Certificate authorities do not. */
function entriesFor(text: string, hostname: string, port: number): readonly Entry[] {
  const pattern = hostPattern(hostname, port)
  return text
    .split('\n')
    .map(parseLine)
    .filter((entry): entry is Entry => entry !== null)
    .filter((entry) => !entry.certAuthority)
    .filter((entry) => matchesHost(entry, pattern, hostname))
}

/**
 * Checks the server key against the standard known_hosts file.
 * `unknown` means first use; `mismatch` means the key changed or was revoked.
 *
 * A host that is already pinned must present a pinned key. A key of another
 * algorithm is a mismatch, not a first use: if it were, whoever intercepts
 * the connection would only need a key of a different type to be trusted.
 */
export function verifyAgainstKnownHosts(
  text: string,
  hostname: string,
  port: number,
  key: Buffer,
): KnownHostsVerdict {
  const keyType = keyTypeOf(key) ?? 'unknown'
  const encoded = key.toString('base64')
  const entries = entriesFor(text, hostname, port)
  const candidates = entries.filter((entry) => entry.keyType === keyType)

  const trusted = candidates.filter((entry) => !entry.revoked && entry.key === encoded)
  if (trusted.length > 0) return { outcome: 'trusted', keyType }

  if (candidates.length > 0) {
    return {
      outcome: 'mismatch',
      keyType,
      expected: Object.freeze(candidates.map((entry) => entry.key)),
    }
  }

  const pinnedOtherTypes = entries.filter((entry) => !entry.revoked)
  if (pinnedOtherTypes.length > 0) {
    return {
      outcome: 'mismatch',
      keyType,
      expected: Object.freeze(pinnedOtherTypes.map((entry) => entry.key)),
    }
  }

  return { outcome: 'unknown', keyType }
}

// What ssh2 can negotiate for each key type stored in known_hosts. An RSA key
// is stored as "ssh-rsa" whatever signature algorithm is used on the wire.
const NEGOTIABLE: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'ssh-ed25519': ['ssh-ed25519'],
  'ecdsa-sha2-nistp256': ['ecdsa-sha2-nistp256'],
  'ecdsa-sha2-nistp384': ['ecdsa-sha2-nistp384'],
  'ecdsa-sha2-nistp521': ['ecdsa-sha2-nistp521'],
  'ssh-rsa': ['rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa'],
})

/**
 * Host key algorithms to request from a host that is already pinned, so the
 * server answers with a key type we can verify. Without this, a server with
 * several keys could present one that is not in the file and be refused even
 * though nothing changed. Empty means no restriction (first use).
 */
export function pinnedHostKeyAlgorithms(
  text: string,
  hostname: string,
  port: number,
): readonly string[] {
  const algorithms = entriesFor(text, hostname, port)
    .filter((entry) => !entry.revoked)
    .flatMap((entry) => NEGOTIABLE[entry.keyType] ?? [])
  return Object.freeze([...new Set(algorithms)])
}

/**
 * Whether the file has any entry for this host, whatever the key type.
 * Used to tell whether the next connection will be a first use.
 */
export function hasKnownHostEntry(text: string, hostname: string, port: number): boolean {
  return entriesFor(text, hostname, port).length > 0
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
