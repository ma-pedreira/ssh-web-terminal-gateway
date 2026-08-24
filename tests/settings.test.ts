import { describe, expect, it } from 'vitest'
import { mergeSettings, settingsPatchSchema, validatePaths } from '#lib/settings/model'

const DEFAULTS = {
  sshDir: '/home/user/.ssh',
  keysDir: '/home/user/.ssh',
  vaultPath: '/home/user/.config/ssh-web/credenciales.vault',
  vaultEnabled: false,
  sessionIdleMinutes: 120,
  replayBufferKb: 256,
}

const ROOTS = ['/home/user', '/data']

describe('merging settings', () => {
  it('with no stored file it returns the defaults', () => {
    expect(mergeSettings(DEFAULTS, {})).toEqual(DEFAULTS)
  })

  it('stored values take precedence over the defaults', () => {
    const result = mergeSettings(DEFAULTS, { sshDir: '/data/ssh', vaultEnabled: true })
    expect(result.sshDir).toBe('/data/ssh')
    expect(result.vaultEnabled).toBe(true)
    expect(result.keysDir).toBe(DEFAULTS.keysDir)
  })

  it('ignores unknown keys in the file', () => {
    const result = mergeSettings(DEFAULTS, { madeUp: 'x' } as never)
    expect(result).toEqual(DEFAULTS)
  })

  it('does not mutate the defaults', () => {
    mergeSettings(DEFAULTS, { sshDir: '/data/otro' })
    expect(DEFAULTS.sshDir).toBe('/home/user/.ssh')
  })
})

describe('form validation', () => {
  it('accepts a full change', () => {
    const result = settingsPatchSchema.safeParse({
      sshDir: '/data/ssh',
      keysDir: '/data/claves',
      vaultPath: '/data/x.vault',
      vaultEnabled: true,
      sessionIdleMinutes: 60,
      replayBufferKb: 512,
    })
    expect(result.success).toBe(true)
  })

  it('accepts partial changes', () => {
    expect(settingsPatchSchema.safeParse({ vaultEnabled: true }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({}).success).toBe(true)
  })

  it('caps the times and sizes', () => {
    expect(settingsPatchSchema.safeParse({ sessionIdleMinutes: 0 }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ sessionIdleMinutes: 99_999 }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ replayBufferKb: 1 }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ replayBufferKb: 999_999 }).success).toBe(false)
  })

  it('rejects empty paths', () => {
    expect(settingsPatchSchema.safeParse({ sshDir: '' }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ sshDir: '   ' }).success).toBe(false)
  })
})

describe('confining the chosen paths', () => {
  it('accepts paths inside the allowed roots', () => {
    const result = validatePaths(
      { sshDir: '/home/user/.ssh', vaultPath: '/data/x.vault' },
      ROOTS,
      'linux',
    )
    expect(result).toMatchObject({ sshDir: '/home/user/.ssh', vaultPath: '/data/x.vault' })
  })

  it('rejects a path outside the roots', () => {
    expect(() => validatePaths({ sshDir: '/etc' }, ROOTS, 'linux')).toThrow(/allowed folder/i)
  })

  it('rejects escaping with dot segments', () => {
    expect(() => validatePaths({ vaultPath: '/data/../etc/shadow' }, ROOTS, 'linux')).toThrow(
      /allowed folder/i,
    )
  })

  it('normalises accepted paths', () => {
    const result = validatePaths({ keysDir: '/data/sub/../claves' }, ROOTS, 'linux')
    expect(result.keysDir).toBe('/data/claves')
  })

  it('lets non-path fields through', () => {
    const result = validatePaths({ vaultEnabled: true, sessionIdleMinutes: 30 }, ROOTS, 'linux')
    expect(result).toEqual({ vaultEnabled: true, sessionIdleMinutes: 30 })
  })

  it('says in the error which path failed', () => {
    expect(() => validatePaths({ sshDir: '/etc' }, ROOTS, 'linux')).toThrow(/sshDir/)
  })

  it('validates Windows paths', () => {
    const roots = ['C:\\Users\\pepe']
    expect(
      validatePaths({ sshDir: 'C:\\Users\\pepe\\.ssh' }, roots, 'win32').sshDir,
    ).toBe('C:\\Users\\pepe\\.ssh')
    expect(() => validatePaths({ sshDir: 'D:\\otro' }, roots, 'win32')).toThrow(/allowed folder/i)
  })
})
