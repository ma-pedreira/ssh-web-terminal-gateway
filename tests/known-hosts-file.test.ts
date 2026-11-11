import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  appendHostKey,
  fingerprintOf,
  hasKnownHostEntry,
  hostPattern,
  keyTypeOf,
  pinnedHostKeyAlgorithms,
  removeHostEntries,
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

  it('does not let a port-22 entry pin another port of the same machine', () => {
    // Two servers can share an address on different ports (a container next
    // to the host). The second must be free to pin its own key.
    const text = `nas.local ssh-ed25519 ${B64}\n`
    expect(verifyAgainstKnownHosts(text, 'nas.local', 2222, OTRA).outcome).toBe('unknown')
  })

  it('compares host names without regard to case', () => {
    const text = `nas.local ssh-ed25519 ${B64}\n`
    expect(verifyAgainstKnownHosts(text, 'NAS.Local', 22, CLAVE).outcome).toBe('trusted')
  })

  it('honours wildcard patterns, so a host pinned by one cannot swap its key', () => {
    const text = `*.lan,10.0.0.? ssh-ed25519 ${B64}\n`
    expect(verifyAgainstKnownHosts(text, 'nas.lan', 22, CLAVE).outcome).toBe('trusted')
    expect(verifyAgainstKnownHosts(text, 'nas.lan', 22, OTRA).outcome).toBe('mismatch')
    expect(verifyAgainstKnownHosts(text, '10.0.0.7', 22, OTRA).outcome).toBe('mismatch')
    expect(verifyAgainstKnownHosts(text, '10.0.0.77', 22, OTRA).outcome).toBe('unknown')
    expect(verifyAgainstKnownHosts(text, 'nas.wan', 22, OTRA).outcome).toBe('unknown')
  })

  it('honours negated patterns', () => {
    const text = `*.lan,!guest.lan ssh-ed25519 ${B64}\n`
    expect(verifyAgainstKnownHosts(text, 'nas.lan', 22, CLAVE).outcome).toBe('trusted')
    expect(verifyAgainstKnownHosts(text, 'guest.lan', 22, CLAVE).outcome).toBe('unknown')
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

  it('rejects a key of a different type when the host is already pinned', () => {
    // Otherwise whoever intercepts the connection only has to present a key
    // of another algorithm to be treated as a first use and trusted.
    const text = `nas.local ssh-ed25519 ${B64}\n`
    const verdict = verifyAgainstKnownHosts(text, 'nas.local', 22, blob('ssh-rsa', 'intruder'))
    expect(verdict.outcome).toBe('mismatch')
  })

  it('trusts a host pinned with several key types', () => {
    const rsa = blob('ssh-rsa', 'rsa-body')
    const text = `nas.local ssh-ed25519 ${B64}\nnas.local ssh-rsa ${rsa.toString('base64')}\n`
    expect(verifyAgainstKnownHosts(text, 'nas.local', 22, rsa).outcome).toBe('trusted')
    expect(verifyAgainstKnownHosts(text, 'nas.local', 22, CLAVE).outcome).toBe('trusted')
  })

  it('does not let a certificate authority line pin a host', () => {
    const text = `@cert-authority nas.local ssh-rsa ${B64}\n`
    expect(verifyAgainstKnownHosts(text, 'nas.local', 22, CLAVE).outcome).toBe('unknown')
    expect(hasKnownHostEntry(text, 'nas.local', 22)).toBe(false)
  })

  it('does not count a revoked key of another type as a pin', () => {
    const text = `@revoked nas.local ssh-rsa ${B64}\n`
    expect(verifyAgainstKnownHosts(text, 'nas.local', 22, CLAVE).outcome).toBe('unknown')
  })
})

describe('host key algorithms to request', () => {
  it('returns nothing for a host that is not pinned', () => {
    expect(pinnedHostKeyAlgorithms('', 'nas.local', 22)).toEqual([])
  })

  it('asks only for the pinned type', () => {
    const text = `nas.local ssh-ed25519 ${B64}\n`
    expect(pinnedHostKeyAlgorithms(text, 'nas.local', 22)).toEqual(['ssh-ed25519'])
  })

  it('expands RSA to its modern signature algorithms', () => {
    const text = `[nas.local]:2222 ssh-rsa ${B64}\n`
    expect(pinnedHostKeyAlgorithms(text, 'nas.local', 2222)).toEqual([
      'rsa-sha2-512',
      'rsa-sha2-256',
      'ssh-rsa',
    ])
  })

  it('combines several pinned types without repeating them', () => {
    const text = `nas.local ecdsa-sha2-nistp256 ${B64}\nnas.local ssh-ed25519 ${B64}\nnas.local ssh-ed25519 ${B64}\n`
    expect(pinnedHostKeyAlgorithms(text, 'nas.local', 22)).toEqual([
      'ecdsa-sha2-nistp256',
      'ssh-ed25519',
    ])
  })

  it('skips revoked keys, authorities and types the client cannot negotiate', () => {
    const text = [
      `@revoked nas.local ssh-rsa ${B64}`,
      `@cert-authority nas.local ecdsa-sha2-nistp256 ${B64}`,
      `nas.local sk-ssh-ed25519@openssh.com ${B64}`,
    ].join('\n')
    expect(pinnedHostKeyAlgorithms(text, 'nas.local', 22)).toEqual([])
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

describe('key fingerprint', () => {
  it('matches the format ssh-keygen -lf prints', () => {
    const expected = `SHA256:${createHash('sha256').update(CLAVE).digest('base64').replace(/=+$/, '')}`
    expect(fingerprintOf(CLAVE)).toBe(expected)
    expect(fingerprintOf(CLAVE)).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
  })
})

describe('forgetting a host', () => {
  const hashedLine = (name: string): string => {
    const salt = Buffer.from('test-salt-1234567890').subarray(0, 20)
    const hash = createHmac('sha1', salt).update(name).digest()
    return `|1|${salt.toString('base64')}|${hash.toString('base64')} ssh-rsa ${B64}`
  }

  it('removes plain and hashed entries of the host and keeps the rest', () => {
    const text = [
      '# a comment',
      `nas.local ssh-ed25519 ${B64}`,
      hashedLine('nas.local'),
      `other.local ssh-ed25519 ${B64}`,
      '',
    ].join('\n')

    const result = removeHostEntries(text, 'nas.local', 22)
    expect(result.removed).toBe(2)
    expect(result.text).toBe(`# a comment\nother.local ssh-ed25519 ${B64}\n`)
    expect(hasKnownHostEntry(result.text, 'nas.local', 22)).toBe(false)
  })

  it('removes only the entry of the given port', () => {
    const text = `nas.local ssh-ed25519 ${B64}\n[nas.local]:2222 ssh-ed25519 ${B64}\n`
    const result = removeHostEntries(text, 'nas.local', 2222)
    expect(result.removed).toBe(1)
    expect(result.text).toBe(`nas.local ssh-ed25519 ${B64}\n`)
  })

  it('keeps revocations and certificate authorities: they were written on purpose', () => {
    const text = `@revoked nas.local ssh-ed25519 ${B64}\n@cert-authority nas.local ssh-rsa ${B64}\n`
    expect(removeHostEntries(text, 'nas.local', 22)).toEqual({ text, removed: 0 })
  })

  it('leaves the text untouched when there is nothing to remove', () => {
    const text = `other.local ssh-ed25519 ${B64}\n`
    expect(removeHostEntries(text, 'nas.local', 22)).toEqual({ text, removed: 0 })
  })
})
