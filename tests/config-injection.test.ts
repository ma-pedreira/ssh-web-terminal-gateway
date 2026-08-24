import { describe, expect, it } from 'vitest'
import { parseConfig, resolveHost } from '#lib/ssh-config/parser'
import { upsertHost } from '#lib/ssh-config/writer'
import { hostCreateSchema } from '#lib/validation/schemas'

/**
 * ssh_config supports ProxyCommand, which executes a system command. Smuggling
 * a newline into any field would allow writing arbitrary directives into the
 * file, and from there executing code on the machine.
 *
 * Checked at both layers: input validation and the writer.
 */
const POISONS = [
  'host\nProxyCommand touch /tmp/comprometido',
  'host\r\nProxyCommand id',
  'host\n\tProxyCommand id',
  'host\rProxyCommand id',
  'host ProxyCommand id',
  'hostProxyCommand id',
]

describe('input validation rejects the injection', () => {
  it('in the host name', () => {
    for (const poison of POISONS) {
      const r = hostCreateSchema.safeParse({ alias: 'x', hostname: poison, user: 'debian' })
      expect(r.success, `accepted: ${JSON.stringify(poison)}`).toBe(false)
    }
  })

  it('in the alias', () => {
    for (const poison of POISONS) {
      const r = hostCreateSchema.safeParse({ alias: poison, hostname: 'h', user: 'debian' })
      expect(r.success, `accepted: ${JSON.stringify(poison)}`).toBe(false)
    }
  })

  it('in the remote user', () => {
    for (const poison of POISONS) {
      const r = hostCreateSchema.safeParse({ alias: 'x', hostname: 'h', user: poison })
      expect(r.success, `accepted: ${JSON.stringify(poison)}`).toBe(false)
    }
  })

  it('in the private key path', () => {
    for (const poison of POISONS) {
      const r = hostCreateSchema.safeParse({
        alias: 'x',
        hostname: 'h',
        user: 'debian',
        identityFile: poison,
      })
      expect(r.success, `accepted: ${JSON.stringify(poison)}`).toBe(false)
    }
  })
})

describe('the writer defends itself', () => {
  it('rejects any value able to smuggle a directive', () => {
    for (const poison of POISONS.filter((v) => v !== 'hostProxyCommand id')) {
      expect(
        () =>
          upsertHost('', {
            alias: 'x',
            hostname: poison,
            user: null,
            port: 22,
            identityFile: null,
          }),
        `accepted: ${JSON.stringify(poison)}`,
      ).toThrow()
    }
  })

  it('names the problem when rejecting a newline', () => {
    expect(() =>
      upsertHost('', {
        alias: 'x',
        hostname: 'host\nProxyCommand id',
        user: null,
        port: 22,
        identityFile: null,
      }),
    ).toThrow(/newline/i)
  })

  it('a value with no newlines or spaces is written as is', () => {
    // "hostProxyCommand" is an odd but harmless host name: with no separator
    // it is not a directive, and the writer has no business guessing.
    const text = upsertHost('', {
      alias: 'x',
      hostname: 'hostProxyCommand',
      user: null,
      port: 22,
      identityFile: null,
    })
    expect(text).toContain('HostName hostProxyCommand')
    expect(text.split('\n').filter((l) => /^\s*ProxyCommand\s/i.test(l))).toHaveLength(0)
  })

  it('rejects an alias containing a newline', () => {
    expect(() =>
      upsertHost('', {
        alias: 'x\nHost otro',
        hostname: 'h',
        user: null,
        port: 22,
        identityFile: null,
      }),
    ).toThrow()
  })

  it('ProxyCommand never appears in the file, whatever happens', () => {
    let text = 'Host previous\n  HostName 10.0.0.1\n'
    for (const poison of POISONS) {
      try {
        text = upsertHost(text, {
          alias: 'x',
          hostname: poison,
          user: null,
          port: 22,
          identityFile: null,
        })
      } catch {
        // Rejected, which is correct.
      }
    }
    expect(text).not.toMatch(/ProxyCommand/i)
    expect(resolveHost(parseConfig(text), 'previous')?.hostname).toBe('10.0.0.1')
  })

  it('lets legitimate values through', () => {
    const text = upsertHost('', {
      alias: 'casa',
      hostname: '192.168.1.10',
      user: 'debian',
      port: 2222,
      identityFile: 'id_ed25519',
    })
    expect(resolveHost(parseConfig(text), 'casa')).toMatchObject({
      hostname: '192.168.1.10',
      user: 'debian',
      port: 2222,
    })
  })
})
