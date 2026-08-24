import { describe, expect, it } from 'vitest'
import {
  createVault,
  listVaultAliases,
  openEntry,
  putEntry,
  removeEntry,
  serializeVault,
  parseVault,
  unlockVault,
} from '#lib/vault/vault'

// Cheap parameters: the real cost factor is not exercised in every case.
const FAST = { algorithm: 'scrypt' as const, N: 1024, r: 8, p: 1 }
const SIGN_IN_PASSWORD = 'a-long-sign-in-password'

async function vaultWithEntry(secret = 'the-server-password') {
  const vault = await createVault(SIGN_IN_PASSWORD, FAST)
  const key = await unlockVault(vault, SIGN_IN_PASSWORD)
  return { vault: putEntry(vault, key, 'home', secret), key }
}

describe('creating and opening', () => {
  it('opens with the right password', async () => {
    const vault = await createVault(SIGN_IN_PASSWORD, FAST)
    await expect(unlockVault(vault, SIGN_IN_PASSWORD)).resolves.toBeInstanceOf(Buffer)
  })

  it('rejects the wrong password', async () => {
    const vault = await createVault(SIGN_IN_PASSWORD, FAST)
    await expect(unlockVault(vault, 'another-long-password')).rejects.toThrow(/does not open/i)
  })

  it('uses a different salt for each vault', async () => {
    const a = await createVault(SIGN_IN_PASSWORD, FAST)
    const b = await createVault(SIGN_IN_PASSWORD, FAST)
    expect(a.kdf.salt).not.toBe(b.kdf.salt)
  })

  it('the derived key is 32 bytes', async () => {
    const vault = await createVault(SIGN_IN_PASSWORD, FAST)
    expect((await unlockVault(vault, SIGN_IN_PASSWORD)).byteLength).toBe(32)
  })

  it('detects a tampered verifier', async () => {
    const vault = await createVault(SIGN_IN_PASSWORD, FAST)
    const broken = { ...vault, check: { ...vault.check, tag: Buffer.alloc(16).toString('base64') } }
    await expect(unlockVault(broken, SIGN_IN_PASSWORD)).rejects.toThrow()
  })
})

describe('entries', () => {
  it('stores and recovers a secret', async () => {
    const { vault, key } = await vaultWithEntry()
    expect(openEntry(vault, key, 'home')).toBe('the-server-password')
  })

  it('does not leave the secret readable in the file', async () => {
    const { vault } = await vaultWithEntry('a-very-recognisable-secret')
    const text = serializeVault(vault)
    expect(text).not.toContain('a-very-recognisable-secret')
    expect(Buffer.from(vault.entries.home!.ciphertext, 'base64').toString('utf8')).not.toContain(
      'secret',
    )
  })

  it('a secret copied into another entry cannot be decrypted', async () => {
    const { vault, key } = await vaultWithEntry()
    const forged = {
      ...vault,
      entries: { ...vault.entries, other: vault.entries.home! },
    }
    expect(() => openEntry(forged, key, 'other')).toThrow(/could not be decrypted/i)
  })

  it('replaces an existing entry without duplicating it', async () => {
    const { vault, key } = await vaultWithEntry('first')
    const updated = putEntry(vault, key, 'home', 'second')
    expect(openEntry(updated, key, 'home')).toBe('second')
    expect(Object.keys(updated.entries)).toEqual(['home'])
  })

  it('does not mutate the original vault', async () => {
    const { vault, key } = await vaultWithEntry('first')
    putEntry(vault, key, 'home', 'second')
    expect(openEntry(vault, key, 'home')).toBe('first')
  })

  it('returns null when the entry does not exist', async () => {
    const { vault, key } = await vaultWithEntry()
    expect(openEntry(vault, key, 'nonexistent')).toBeNull()
  })

  it('removes an entry', async () => {
    const { vault, key } = await vaultWithEntry()
    const without = removeEntry(vault, 'home')
    expect(openEntry(without, key, 'home')).toBeNull()
    expect(listVaultAliases(without)).toEqual([])
  })

  it('lists aliases without needing the key', async () => {
    const { vault } = await vaultWithEntry()
    expect(listVaultAliases(vault)).toEqual(['home'])
  })

  it('a different key does not open the entry', async () => {
    const { vault } = await vaultWithEntry()
    const other = await createVault('a-different-long-password', FAST)
    const otherKey = await unlockVault(other, 'a-different-long-password')
    expect(() => openEntry(vault, otherKey, 'home')).toThrow(/could not be decrypted/i)
  })
})

describe('persistence', () => {
  it('survives serialising and reading back', async () => {
    const { vault, key } = await vaultWithEntry('persistent')
    const reread = parseVault(serializeVault(vault))
    expect(openEntry(reread, key, 'home')).toBe('persistent')
  })

  it('the password still opens it after rereading', async () => {
    const { vault } = await vaultWithEntry()
    const reread = parseVault(serializeVault(vault))
    await expect(unlockVault(reread, SIGN_IN_PASSWORD)).resolves.toBeInstanceOf(Buffer)
  })

  it('rejects a file with an invalid format', () => {
    expect(() => parseVault('{}')).toThrow()
    expect(() => parseVault('not json')).toThrow()
    expect(() => parseVault('{"version":99}')).toThrow(/version/i)
  })

  it('is stored as readable JSON with the data encrypted', async () => {
    const { vault } = await vaultWithEntry()
    const data = JSON.parse(serializeVault(vault))
    expect(data.kdf.algorithm).toBe('scrypt')
    expect(data.entries.home).toHaveProperty('ciphertext')
    expect(data).not.toHaveProperty('password')
  })
})
