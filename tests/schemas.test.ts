import { describe, expect, it } from 'vitest'
import {
  clientMessageSchema,
  hostCreateSchema,
  hostUpdateSchema,
  loginSchema,
  openSessionSchema,
  usernameSchema,
} from '#lib/validation/schemas'

describe('input validation', () => {
  it('accepts a host with no key: it will ask for a password', () => {
    const result = hostCreateSchema.safeParse({
      alias: 'casa',
      hostname: '192.168.1.10',
      port: 22,
      user: 'debian',
    })
    expect(result.success).toBe(true)
  })

  it('accepts a host with a private key from the mounted directory', () => {
    const result = hostCreateSchema.safeParse({
      alias: 'casa',
      hostname: '192.168.1.10',
      user: 'debian',
      identityFile: 'id_ed25519',
    })
    expect(result.success).toBe(true)
  })

  it('rejects key paths that escape the directory', () => {
    for (const identityFile of ['../fuera', 'sub/../../fuera', 'a/../..']) {
      expect(
        hostCreateSchema.safeParse({
          alias: 'casa',
          hostname: 'h',
          user: 'debian',
          identityFile,
        }).success,
      ).toBe(false)
    }
  })

  it('rejects aliases with wildcards or spaces', () => {
    for (const alias of ['*', 'con espacio', 'a*b', '!negado', 'a?b']) {
      expect(
        hostCreateSchema.safeParse({ alias, hostname: 'h', user: 'debian' }).success,
      ).toBe(false)
    }
  })

  it('applies port 22 by default', () => {
    const result = hostCreateSchema.parse({
      alias: 'casa',
      hostname: 'servidor.local',
      user: 'debian',
    })
    expect(result.port).toBe(22)
  })




  it('rejects hosts with shell characters or a scheme', () => {
    for (const hostname of ['a b', 'host;rm -rf /', 'ssh://host', 'host|cat', '$(whoami)', '-mala']) {
      expect(
        hostCreateSchema.safeParse({ alias: 'x', hostname, user: 'debian' }).success,
      ).toBe(false)
    }
  })

  it('rejects out-of-range ports', () => {
    for (const port of [0, 65_536, -1]) {
      expect(hostUpdateSchema.safeParse({ port }).success).toBe(false)
    }
  })

  it('validates the application username', () => {
    expect(usernameSchema.safeParse('operator').success).toBe(true)
    expect(usernameSchema.safeParse('op').success).toBe(false)
    expect(usernameSchema.safeParse('con espacios').success).toBe(false)
    expect(usernameSchema.safeParse('a'.repeat(65)).success).toBe(false)
  })

  it('requires a username and password to sign in', () => {
    expect(loginSchema.safeParse({ username: 'operator', password: 'x' }).success).toBe(true)
    expect(loginSchema.safeParse({ username: 'operator', password: '' }).success).toBe(false)
  })

  it('validates the alias when opening a session', () => {
    expect(openSessionSchema.safeParse({ alias: 'con espacio' }).success).toBe(false)
    expect(openSessionSchema.safeParse({ alias: 'home-server' }).success).toBe(true)
  })

  it('accepts the optional secrets when opening a session', () => {
    const result = openSessionSchema.parse({ alias: 'casa', password: 'x' })
    expect(result.password).toBe('x')
    expect(openSessionSchema.parse({ alias: 'casa' }).password).toBeUndefined()
  })

  it('caps the terminal size', () => {
    const base = { alias: 'casa' }
    expect(openSessionSchema.safeParse({ ...base, cols: 5000 }).success).toBe(false)
    expect(openSessionSchema.safeParse({ ...base, rows: 1 }).success).toBe(false)
  })

  it('validates the terminal messages', () => {
    expect(clientMessageSchema.safeParse({ type: 'input', data: 'ls\n' }).success).toBe(true)
    expect(clientMessageSchema.safeParse({ type: 'resize', cols: 120, rows: 40 }).success).toBe(true)
    expect(clientMessageSchema.safeParse({ type: 'ping' }).success).toBe(true)
    expect(clientMessageSchema.safeParse({ type: 'desconocido' }).success).toBe(false)
    expect(clientMessageSchema.safeParse({ type: 'input', data: 'x'.repeat(9000) }).success).toBe(
      false,
    )
  })
})
