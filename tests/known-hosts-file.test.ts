import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  appendHostKey,
  hasKnownHostEntry,
  hostPattern,
  keyTypeOf,
  verifyAgainstKnownHosts,
} from '#lib/ssh/known-hosts-file'

/** Construye un blob de clave publica en formato SSH: longitud + algoritmo. */
function blob(algorithm: string, body = 'key-body'): Buffer {
  const name = Buffer.from(algorithm, 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(name.byteLength)
  return Buffer.concat([length, name, Buffer.from(body, 'utf8')])
}

const CLAVE = blob('ssh-ed25519')
const OTRA = blob('ssh-ed25519', 'a-different-key')
const B64 = CLAVE.toString('base64')

describe('host pattern format', () => {
  it('uses the bare name on port 22', () => {
    expect(hostPattern('nas.local', 22)).toBe('nas.local')
  })

  it('uses brackets when the port is not the standard one', () => {
    expect(hostPattern('nas.local', 2222)).toBe('[nas.local]:2222')
  })
})

describe('key type', () => {
  it('extracts it from the blob', () => {
    expect(keyTypeOf(CLAVE)).toBe('ssh-ed25519')
    expect(keyTypeOf(blob('ecdsa-sha2-nistp256'))).toBe('ecdsa-sha2-nistp256')
  })

  it('returns null for an unreadable blob', () => {
    expect(keyTypeOf(Buffer.from('basura'))).toBeNull()
  })
})

describe('verifying against known_hosts', () => {
  it('marks what is absent as unknown', () => {
    expect(verifyAgainstKnownHosts('', 'nas.local', 22, CLAVE)).toMatchObject({
      outcome: 'unknown',
    })
  })

  it('trusts a key that matches', () => {
    const text = `nas.local ssh-ed25519 ${B64}\n`
    expect(verifyAgainstKnownHosts(text, 'nas.local', 22, CLAVE)).toMatchObject({
      outcome: 'trusted',
    })
  })

  it('detects a key change', () => {
    const text = `nas.local ssh-ed25519 ${B64}\n`
    const verdict = verifyAgainstKnownHosts(text, 'nas.local', 22, OTRA)
    expect(verdict.outcome).toBe('mismatch')
  })

  it('honours the port in the pattern', () => {
    const text = `[nas.local]:2222 ssh-ed25519 ${B64}\n`
    expect(verifyAgainstKnownHosts(text, 'nas.local', 2222, CLAVE).outcome).toBe('trusted')
    expect(verifyAgainstKnownHosts(text, 'nas.local', 22, CLAVE).outcome).toBe('unknown')
  })

  it('accepts several comma-separated names', () => {
    const text = `nas.local,192.168.0.10 ssh-ed25519 ${B64}\n`
    expect(verifyAgainstKnownHosts(text, '192.168.0.10', 22, CLAVE).outcome).toBe('trusted')
  })

  it('understands entries with a hashed name', () => {
    const salt = Buffer.from('test-salt-1234567890').subarray(0, 20)
    const hash = createHmac('sha1', salt).update('nas.local').digest()
    const text = `|1|${salt.toString('base64')}|${hash.toString('base64')} ssh-ed25519 ${B64}\n`
    expect(verifyAgainstKnownHosts(text, 'nas.local', 22, CLAVE).outcome).toBe('trusted')
  })

  it('ignores comments and blank lines', () => {
    const text = `# comentario\n\nnas.local ssh-ed25519 ${B64}\n`
    expect(verifyAgainstKnownHosts(text, 'nas.local', 22, CLAVE).outcome).toBe('trusted')
  })

  it('treats a revoked key as a key change', () => {
    const text = `@revoked nas.local ssh-ed25519 ${B64}\n`
    expect(verifyAgainstKnownHosts(text, 'nas.local', 22, CLAVE).outcome).toBe('mismatch')
  })

  it('ignores entries of a different key type', () => {
    const text = `nas.local ssh-rsa ${B64}\n`
    expect(verifyAgainstKnownHosts(text, 'nas.local', 22, CLAVE).outcome).toBe('unknown')
  })
})

describe('adding to known_hosts', () => {
  it('appends the entry in OpenSSH format', () => {
    const text = appendHostKey('', 'nas.local', 2222, CLAVE)
    expect(text.trim()).toBe(`[nas.local]:2222 ssh-ed25519 ${B64}`)
  })

  it('the appended entry verifies correctly', () => {
    const text = appendHostKey('', 'nas.local', 22, CLAVE)
    expect(verifyAgainstKnownHosts(text, 'nas.local', 22, CLAVE).outcome).toBe('trusted')
  })

  it('keeps the previous entries', () => {
    const previous = `other.local ssh-ed25519 ${B64}\n`
    const text = appendHostKey(previous, 'nas.local', 22, CLAVE)
    expect(text).toContain('other.local')
    expect(verifyAgainstKnownHosts(text, 'nas.local', 22, CLAVE).outcome).toBe('trusted')
  })

  it('rejects a blob with no recognisable type', () => {
    expect(() => appendHostKey('', 'h', 22, Buffer.from('basura'))).toThrow()
  })
})

describe('presence of a host in the file', () => {
  it('detects an entry even when the key type differs', () => {
    const text = `nas.local ssh-rsa ${B64}\n`
    expect(hasKnownHostEntry(text, 'nas.local', 22)).toBe(true)
  })

  it('returns false when the host is absent', () => {
    expect(hasKnownHostEntry(`otro ssh-ed25519 ${B64}\n`, 'nas.local', 22)).toBe(false)
    expect(hasKnownHostEntry('', 'nas.local', 22)).toBe(false)
  })

  it('distinguishes by port', () => {
    const text = `[nas.local]:2222 ssh-ed25519 ${B64}\n`
    expect(hasKnownHostEntry(text, 'nas.local', 2222)).toBe(true)
    expect(hasKnownHostEntry(text, 'nas.local', 22)).toBe(false)
  })
})
