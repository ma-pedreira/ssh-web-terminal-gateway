import { describe, expect, it } from 'vitest'
import { parseConfig, resolveHost } from '#lib/ssh-config/parser'
import { removeHost, upsertHost } from '#lib/ssh-config/writer'

const EXISTENTE = `# Mi configuracion
Host nas
    HostName nas.local
    User admin
    ServerAliveInterval 30
    # comment inside the block

Host other
    HostName other.local
`

describe('adding hosts', () => {
  it('appends a new host at the end', () => {
    const result = upsertHost('', {
      alias: 'new',
      hostname: '10.0.0.1',
      user: 'root',
      port: 22,
      identityFile: null,
    })
    const host = resolveHost(parseConfig(result), 'new')
    expect(host).toMatchObject({ hostname: '10.0.0.1', user: 'root', port: 22 })
  })

  it('omits the port when it is 22', () => {
    const result = upsertHost('', {
      alias: 'n',
      hostname: 'h',
      user: null,
      port: 22,
      identityFile: null,
    })
    expect(result).not.toContain('Port')
  })

  it('writes the port when it is not the standard one', () => {
    const result = upsertHost('', {
      alias: 'n',
      hostname: 'h',
      user: null,
      port: 2222,
      identityFile: null,
    })
    expect(result).toContain('Port 2222')
  })

  it('writes IdentityFile when given', () => {
    const result = upsertHost('', {
      alias: 'n',
      hostname: 'h',
      user: 'u',
      port: 22,
      identityFile: '/ssh-keys/id_ed25519',
    })
    expect(resolveHost(parseConfig(result), 'n')?.identityFile).toBe('/ssh-keys/id_ed25519')
  })

  it('does not touch hosts that were already there', () => {
    const result = upsertHost(EXISTENTE, {
      alias: 'new',
      hostname: '10.0.0.9',
      user: 'x',
      port: 22,
      identityFile: null,
    })
    expect(result).toContain('# Mi configuracion')
    expect(resolveHost(parseConfig(result), 'nas')?.hostname).toBe('nas.local')
    expect(resolveHost(parseConfig(result), 'other')?.hostname).toBe('other.local')
  })
})

describe('editing hosts', () => {
  it('updates only the managed directives', () => {
    const result = upsertHost(EXISTENTE, {
      alias: 'nas',
      hostname: 'nas-new.local',
      user: 'admin',
      port: 2200,
      identityFile: null,
    })
    const host = resolveHost(parseConfig(result), 'nas')
    expect(host).toMatchObject({ hostname: 'nas-new.local', port: 2200 })
  })

  it('keeps the directives we do not manage', () => {
    const result = upsertHost(EXISTENTE, {
      alias: 'nas',
      hostname: 'other.local',
      user: 'admin',
      port: 22,
      identityFile: null,
    })
    expect(result).toContain('ServerAliveInterval 30')
  })

  it('keeps the comments inside the block', () => {
    const result = upsertHost(EXISTENTE, {
      alias: 'nas',
      hostname: 'other.local',
      user: 'admin',
      port: 22,
      identityFile: null,
    })
    expect(result).toContain('# comment inside the block')
  })

  it('does not duplicate the block when editing it', () => {
    const result = upsertHost(EXISTENTE, {
      alias: 'nas',
      hostname: 'x',
      user: 'y',
      port: 22,
      identityFile: null,
    })
    expect(result.match(/^Host nas$/gm)).toHaveLength(1)
  })

  it('removes the directive when the value becomes empty', () => {
    const result = upsertHost(EXISTENTE, {
      alias: 'nas',
      hostname: 'nas.local',
      user: null,
      port: 22,
      identityFile: null,
    })
    expect(resolveHost(parseConfig(result), 'nas')?.user).toBeNull()
  })

  it('refuses to touch a block with several patterns', () => {
    const shared = 'Host one two\n  HostName compartido\n'
    expect(() =>
      upsertHost(shared, {
        alias: 'one',
        hostname: 'x',
        user: null,
        port: 22,
        identityFile: null,
      }),
    ).toThrow(/several aliases/i)
  })

  it('refuses to touch a block with wildcards', () => {
    expect(() =>
      upsertHost('Host *\n  Port 22\n', {
        alias: '*',
        hostname: 'x',
        user: null,
        port: 22,
        identityFile: null,
      }),
    ).toThrow()
  })
})

describe('removing hosts', () => {
  it('removes the whole block', () => {
    const result = removeHost(EXISTENTE, 'nas')
    expect(resolveHost(parseConfig(result), 'nas')).toBeNull()
    expect(result).not.toContain('ServerAliveInterval')
  })

  it('leaves the others untouched', () => {
    const result = removeHost(EXISTENTE, 'nas')
    expect(resolveHost(parseConfig(result), 'other')?.hostname).toBe('other.local')
    expect(result).toContain('# Mi configuracion')
  })

  it('deleting something nonexistent leaves the file unchanged', () => {
    expect(removeHost(EXISTENTE, 'does-not-exist')).toBe(EXISTENTE)
  })

  it('refuses to delete a shared block', () => {
    expect(() => removeHost('Host one two\n  HostName x\n', 'one')).toThrow(/several aliases/i)
  })
})

describe('round trip', () => {
  it('the file is still parseable after several operations', () => {
    let text = EXISTENTE
    for (let i = 0; i < 5; i += 1) {
      text = upsertHost(text, {
        alias: `host-${i}`,
        hostname: `10.0.0.${i}`,
        user: 'u',
        port: 2000 + i,
        identityFile: null,
      })
    }
    text = removeHost(text, 'host-2')

    const config = parseConfig(text)
    expect(resolveHost(config, 'host-2')).toBeNull()
    expect(resolveHost(config, 'host-4')?.port).toBe(2004)
    expect(resolveHost(config, 'nas')?.hostname).toBe('nas.local')
    expect(text).not.toMatch(/\n\n\n\n/)
  })
})
