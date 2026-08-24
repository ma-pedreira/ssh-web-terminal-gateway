import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '#lib/crypto/password'

describe('password hashing', () => {
  it('verifies the right password', async () => {
    const hash = await hashPassword('contrasena-larga-y-buena')
    expect(await verifyPassword('contrasena-larga-y-buena', hash)).toBe(true)
  })

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('contrasena-larga-y-buena')
    expect(await verifyPassword('contrasena-larga-y-mala', hash)).toBe(false)
  })

  it('does not store the password in the hash', async () => {
    const hash = await hashPassword('secreto-en-claro')
    expect(hash).not.toContain('secreto-en-claro')
    expect(hash.startsWith('scrypt$')).toBe(true)
  })

  it('generates different salts for the same password', async () => {
    const a = await hashPassword('misma-contrasena')
    const b = await hashPassword('misma-contrasena')
    expect(a).not.toBe(b)
  })

  it('normalises unicode before deriving', async () => {
    const hash = await hashPassword('café-au-lait-long-password')
    expect(await verifyPassword('café-au-lait-long-password', hash)).toBe(true)
  })

  it('rejects hashes with an invalid format', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$1$2$3$4')).toBe(false)
    expect(await verifyPassword('x', 'bcrypt$65536$8$1$c2FsdA==$aGFzaA==')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$abc$8$1$c2FsdA==$aGFzaA==')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$65536$8$1$$aGFzaA==')).toBe(false)
  })
})
