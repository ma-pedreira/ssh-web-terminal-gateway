import { existsSync, readdirSync, statSync } from 'node:fs'
import { getSettings } from '#lib/settings/store'
import { resolveIdentityPath } from '#lib/ssh-config/paths'
import { findConfiguredHost, hasKnownHost, listConfiguredHosts } from '#lib/ssh-config/store'
import type { ConfiguredHost } from '#types'
import type { ResolvedHost } from '#lib/ssh-config/types'

function identityReadable(identityFile: string | null): boolean {
  if (!identityFile) return false
  try {
    return existsSync(resolveIdentityPath(identityFile, getSettings().keysDir))
  } catch {
    return false
  }
}

function decorate(host: ResolvedHost): ConfiguredHost {
  return Object.freeze({
    alias: host.alias,
    hostname: host.hostname,
    user: host.user,
    port: host.port,
    identityFile: host.identityFile,
    extra: host.extra,
    identityReadable: identityReadable(host.identityFile),
    known: hasKnownHost(host.hostname, host.port),
  })
}

export function listHosts(): readonly ConfiguredHost[] {
  return Object.freeze(listConfiguredHosts().map(decorate))
}

export function findHost(alias: string): ConfiguredHost | null {
  const host = findConfiguredHost(alias)
  return host ? decorate(host) : null
}

/** Keys available in the mounted directory, offered when adding a host. */
export function listAvailableKeys(): readonly string[] {
  const dir = getSettings().keysDir
  if (!existsSync(dir)) return Object.freeze([])

  try {
    return Object.freeze(
      readdirSync(dir)
        .filter((name) => !name.endsWith('.pub'))
        .filter((name) => {
          try {
            return statSync(`${dir}/${name}`).isFile()
          } catch {
            return false
          }
        })
        .sort(),
    )
  } catch {
    return Object.freeze([])
  }
}
