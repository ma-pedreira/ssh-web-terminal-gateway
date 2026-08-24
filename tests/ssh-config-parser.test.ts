import { describe, expect, it } from 'vitest'
import {
  listAliases,
  matchesPattern,
  ownDirectives,
  parseConfig,
  resolveHost,
} from '#lib/ssh-config/parser'

const SAMPLE = `# Example configuration
Host home-server
    HostName 192.168.0.50
    User debian
    Port 2222
    IdentityFile ~/.ssh/id_ed25519

Host nas
  HostName nas.local
  User admin

Host *.example.com
    User remoto

Host *
    Port 22
    ServerAliveInterval 30
`

describe('parsing ssh_config', () => {
  it('finds the connectable aliases and drops the wildcards', () => {
    expect(listAliases(parseConfig(SAMPLE))).toEqual(['home-server', 'nas'])
  })

  it('resolves the directives of a host', () => {
    const host = resolveHost(parseConfig(SAMPLE), 'home-server')
    expect(host).toMatchObject({
      alias: 'home-server',
      hostname: '192.168.0.50',
      user: 'debian',
      port: 2222,
      identityFile: '~/.ssh/id_ed25519',
    })
  })

  it('inherits from the wildcard block what the host does not define', () => {
    const host = resolveHost(parseConfig(SAMPLE), 'nas')
    expect(host?.hostname).toBe('nas.local')
    expect(host?.port).toBe(22)
  })

  it('the first value found wins, as ssh does', () => {
    // El bloque del host va antes que "Host *", asi que su Port manda.
    expect(resolveHost(parseConfig(SAMPLE), 'home-server')?.port).toBe(2222)
  })

  it('uses the alias as hostname when there is no HostName', () => {
    const config = parseConfig('Host alias-only\n  User x\n')
    expect(resolveHost(config, 'alias-only')?.hostname).toBe('alias-only')
  })

  it('accepts the equals separator and quoted values', () => {
    const config = parseConfig('Host odd\n  HostName="my host.local"\n  User = joe\n')
    expect(resolveHost(config, 'odd')).toMatchObject({
      hostname: 'my host.local',
      user: 'joe',
    })
  })

  it('treats keywords case-insensitively', () => {
    const config = parseConfig('host X\n  hostname h.local\n  USER u\n  PORT 2200\n')
    expect(resolveHost(config, 'X')).toMatchObject({ hostname: 'h.local', user: 'u', port: 2200 })
  })

  it('accepts several aliases on one Host line', () => {
    const config = parseConfig('Host one two\n  HostName shared.local\n')
    expect(listAliases(config)).toEqual(['one', 'two'])
    expect(resolveHost(config, 'two')?.hostname).toBe('shared.local')
  })

  it('returns null for a nonexistent alias', () => {
    expect(resolveHost(parseConfig(SAMPLE), 'does-not-exist')).toBeNull()
  })

  it('ignores comments and blank lines', () => {
    const config = parseConfig('# comment\n\nHost h\n  # another\n  HostName x\n')
    expect(resolveHost(config, 'h')?.hostname).toBe('x')
  })

  it('keeps the directives it does not interpret', () => {
    const host = resolveHost(parseConfig(SAMPLE), 'home-server')
    expect(host?.extra).toMatchObject({ serveraliveinterval: '30' })
  })

  it('does not swallow an invalid Port', () => {
    const config = parseConfig('Host h\n  HostName x\n  Port no-es-numero\n')
    expect(resolveHost(config, 'h')?.port).toBe(22)
  })

  it('tolerates an empty file', () => {
    expect(listAliases(parseConfig(''))).toEqual([])
  })
})

describe('Host patterns', () => {
  it('compares literally', () => {
    expect(matchesPattern('nas', 'nas')).toBe(true)
    expect(matchesPattern('nas', 'otro')).toBe(false)
  })

  it('supports asterisk and question mark', () => {
    expect(matchesPattern('*', 'cualquiera')).toBe(true)
    expect(matchesPattern('*.example.com', 'web.example.com')).toBe(true)
    expect(matchesPattern('*.example.com', 'example.com')).toBe(false)
    expect(matchesPattern('host?', 'host1')).toBe(true)
    expect(matchesPattern('host?', 'host12')).toBe(false)
  })

  it('escapes regular-expression metacharacters', () => {
    expect(matchesPattern('a.b', 'axb')).toBe(false)
    expect(matchesPattern('a.b', 'a.b')).toBe(true)
  })
})

describe('block-local values, without inheritance', () => {
  const CONFIG = `Host home
    HostName 10.0.0.1

Host *
    User inherited
    Port 2200
`

  it('resolveHost inherits from the wildcard', () => {
    expect(resolveHost(parseConfig(CONFIG), 'home')).toMatchObject({
      user: 'inherited',
      port: 2200,
    })
  })

  it('ownDirectives returns only what the block declares', () => {
    const own = ownDirectives(parseConfig(CONFIG), 'home')
    expect(own).toEqual({ hostname: '10.0.0.1' })
  })

  it('does not confuse the wildcard block with the host block', () => {
    expect(ownDirectives(parseConfig(CONFIG), 'home')?.user).toBeUndefined()
    expect(ownDirectives(parseConfig(CONFIG), 'home')?.port).toBeUndefined()
  })

  it('returns null when the alias has no block of its own', () => {
    expect(ownDirectives(parseConfig(CONFIG), 'nonexistent')).toBeNull()
  })

  it('reads every managed directive when present', () => {
    const config = parseConfig('Host x\n  HostName h\n  User u\n  Port 22\n  IdentityFile k\n')
    expect(ownDirectives(config, 'x')).toEqual({
      hostname: 'h',
      user: 'u',
      port: 22,
      identityFile: 'k',
    })
  })
})
