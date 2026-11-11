import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { getSettings, updateSettings } from '#lib/settings/store'
import { configPath, knownHostsPath } from '#lib/ssh-config/paths'
import {
  deleteHost,
  findConfiguredHost,
  forgetKnownHost,
  hasKnownHost,
  knownHostKeyAlgorithms,
  listConfiguredHosts,
  readHostOwnValues,
  saveHost,
  trustHostKey,
  verifyKnownHost,
} from '#lib/ssh-config/store'
import { findHost, listAvailableKeys, listHosts } from '#lib/ssh-config/inventory'
import { forgetKey, keyFor, rememberKey } from '#lib/vault/keyring'
import { openOrCreateVault, vaultExists, vaultPath } from '#lib/vault/store'
import {
  forgetPassword,
  recallPassword,
  rememberPassword,
  storedAliases,
  VaultLockedError,
  vaultState,
} from '#lib/vault/credentials'

function blob(algorithm: string, body = 'key-body'): Buffer {
  const name = Buffer.from(algorithm, 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(name.byteLength)
  return Buffer.concat([length, name, Buffer.from(body, 'utf8')])
}

const KEY = blob('ssh-ed25519')
const settings = getSettings()

beforeEach(() => {
  for (const path of [configPath(settings.sshDir), knownHostsPath(settings.sshDir), vaultPath()]) {
    rmSync(path, { force: true })
  }
  forgetKey('session-a')
  forgetKey('session-b')
})

describe('hosts in the configuration file', () => {
  const entry = { alias: 'nas', hostname: '10.0.0.5', user: 'debian', port: 2222, identityFile: null }

  it('saves, reads back, edits and deletes a host', () => {
    expect(listConfiguredHosts()).toEqual([])

    saveHost(entry)
    expect(findConfiguredHost('nas')).toMatchObject({ hostname: '10.0.0.5', port: 2222 })
    expect(readHostOwnValues('nas')).toMatchObject({ user: 'debian' })

    saveHost({ ...entry, hostname: '10.0.0.6' })
    expect(listConfiguredHosts()).toHaveLength(1)
    expect(findConfiguredHost('nas')?.hostname).toBe('10.0.0.6')

    expect(deleteHost('nas')).toBe(true)
    expect(deleteHost('nas')).toBe(false)
    expect(findConfiguredHost('nas')).toBeNull()
  })

  it('decorates hosts with what the interface needs', () => {
    writeFileSync(join(settings.keysDir, 'id_test'), 'not a real key')
    saveHost({ ...entry, identityFile: 'id_test' })
    saveHost({ ...entry, alias: 'lost', identityFile: 'missing_key' })

    expect(findHost('nas')).toMatchObject({ identityReadable: true, known: false })
    expect(findHost('lost')).toMatchObject({ identityReadable: false })
    expect(findHost('nobody')).toBeNull()
    expect(listHosts().map((host) => host.alias)).toEqual(['nas', 'lost'])
  })

  it('lists private keys and leaves public ones out', () => {
    writeFileSync(join(settings.keysDir, 'id_test'), 'private')
    writeFileSync(join(settings.keysDir, 'id_test.pub'), 'public')
    expect(listAvailableKeys()).toContain('id_test')
    expect(listAvailableKeys()).not.toContain('id_test.pub')
  })
})

describe('server keys on disk', () => {
  it('pins on first use, recognises the key afterwards and forgets on request', () => {
    expect(hasKnownHost('10.0.0.5', 22)).toBe(false)
    expect(verifyKnownHost('10.0.0.5', 22, KEY).outcome).toBe('unknown')
    expect(knownHostKeyAlgorithms('10.0.0.5', 22)).toEqual([])

    trustHostKey('10.0.0.5', 22, KEY)
    expect(hasKnownHost('10.0.0.5', 22)).toBe(true)
    expect(verifyKnownHost('10.0.0.5', 22, KEY).outcome).toBe('trusted')
    expect(verifyKnownHost('10.0.0.5', 22, blob('ssh-rsa')).outcome).toBe('mismatch')
    expect(knownHostKeyAlgorithms('10.0.0.5', 22)).toEqual(['ssh-ed25519'])

    expect(forgetKnownHost('10.0.0.5', 22)).toBe(1)
    expect(forgetKnownHost('10.0.0.5', 22)).toBe(0)
    expect(verifyKnownHost('10.0.0.5', 22, blob('ssh-rsa')).outcome).toBe('unknown')
  })
})

describe('vault keyring', () => {
  it('keeps one key per session and wipes it when forgotten', () => {
    const key = Buffer.from('0123456789abcdef')
    rememberKey('session-a', key)

    expect(keyFor('session-a')).toBe(key)
    expect(keyFor('session-b')).toBeNull()

    forgetKey('session-a')
    expect(keyFor('session-a')).toBeNull()
    // Overwritten, not just dropped: nothing is left readable in the heap.
    expect(key.every((byte) => byte === 0)).toBe(true)
  })
})

describe('stored passwords', () => {
  it('is disabled until a vault exists', () => {
    expect(vaultExists()).toBe(false)
    expect(vaultState('session-a')).toBe('disabled')
    expect(storedAliases()).toEqual([])
    expect(recallPassword('session-a', 'nas')).toBeNull()
    expect(forgetPassword('nas')).toBe(false)
  })

  it('stores, recalls and removes a password for the session holding the key', async () => {
    rememberKey('session-a', await openOrCreateVault('sign-in-password-1'))
    expect(existsSync(vaultPath())).toBe(true)
    expect(vaultState('session-a')).toBe('open')

    rememberPassword('session-a', 'nas', 'host-password')
    expect(storedAliases()).toEqual(['nas'])
    expect(recallPassword('session-a', 'nas')).toBe('host-password')
    expect(recallPassword('session-a', 'other')).toBeNull()

    expect(forgetPassword('nas')).toBe(true)
    expect(storedAliases()).toEqual([])
  })

  it('is locked for a session without the key', async () => {
    rememberKey('session-a', await openOrCreateVault('sign-in-password-1'))
    rememberPassword('session-a', 'nas', 'host-password')

    expect(vaultState('session-b')).toBe('locked')
    expect(recallPassword('session-b', 'nas')).toBeNull()
    expect(() => rememberPassword('session-b', 'nas', 'x')).toThrow(VaultLockedError)
  })

  it('does not open with another password', async () => {
    await openOrCreateVault('sign-in-password-1')
    await expect(openOrCreateVault('another-password')).rejects.toThrow()
  })

  it('returns nothing when the stored entry cannot be decrypted with this key', async () => {
    rememberKey('session-a', await openOrCreateVault('sign-in-password-1'))
    rememberPassword('session-a', 'nas', 'host-password')
    rememberKey('session-b', Buffer.alloc(32, 7))
    expect(recallPassword('session-b', 'nas')).toBeNull()
  })
})

describe('saving settings', () => {
  it('persists a change and refuses a path outside the allowed folders', () => {
    const before = getSettings().sessionIdleMinutes
    expect(updateSettings({ sessionIdleMinutes: 45 }).sessionIdleMinutes).toBe(45)
    expect(getSettings().sessionIdleMinutes).toBe(45)
    updateSettings({ sessionIdleMinutes: before })

    expect(() => updateSettings({ sshDir: '/etc' })).toThrow()
    expect(getSettings().sshDir).toBe(settings.sshDir)
  })
})
