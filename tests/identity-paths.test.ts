import { describe, expect, it } from 'vitest'
import { resolveIdentityPath } from '#lib/ssh-config/paths'

const KEYS = '/ssh-keys'

describe('resolving the private key path', () => {
  it('accepts a bare name inside the keys directory', () => {
    expect(resolveIdentityPath('id_ed25519', KEYS)).toBe('/ssh-keys/id_ed25519')
  })

  it('translates the ~/.ssh notation to the mounted directory', () => {
    expect(resolveIdentityPath('~/.ssh/id_rsa', KEYS)).toBe('/ssh-keys/id_rsa')
  })

  it('accepts an absolute path inside the keys directory', () => {
    expect(resolveIdentityPath('/ssh-keys/sub/clave', KEYS)).toBe('/ssh-keys/sub/clave')
  })

  it('rejects absolute paths outside the keys directory', () => {
    expect(() => resolveIdentityPath('/etc/shadow', KEYS)).toThrow(/outside the allowed keys directory/i)
    expect(() => resolveIdentityPath('/home/otro/.ssh/id_rsa', KEYS)).toThrow(/outside the allowed keys directory/i)
  })

  it('rejects escaping with dot segments', () => {
    expect(() => resolveIdentityPath('../../etc/shadow', KEYS)).toThrow(/outside the allowed keys directory/i)
    expect(() => resolveIdentityPath('sub/../../fuera', KEYS)).toThrow(/outside the allowed keys directory/i)
  })

  it('rejects a prefix that merely looks like the keys directory', () => {
    expect(() => resolveIdentityPath('/ssh-keys-falso/clave', KEYS)).toThrow(/outside the allowed keys directory/i)
  })

  it('rejects empty values', () => {
    expect(() => resolveIdentityPath('   ', KEYS)).toThrow()
  })
})
