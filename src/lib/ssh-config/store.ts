import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { getSettings } from '#lib/settings/store'
import { logger } from '#lib/logger'
import { fileMode } from '#lib/platform'
import { configPath, knownHostsPath } from '#lib/ssh-config/paths'
import {
  ownDirectives,
  parseConfig,
  resolveAll,
  resolveHost,
  type OwnDirectives,
} from '#lib/ssh-config/parser'
import { removeHost, upsertHost, type HostEntry } from '#lib/ssh-config/writer'
import {
  appendHostKey,
  hasKnownHostEntry,
  verifyAgainstKnownHosts,
  type KnownHostsVerdict,
} from '#lib/ssh/known-hosts-file'
import type { ResolvedHost } from '#lib/ssh-config/types'

function readOrEmpty(path: string): string {
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf8')
}

/**
 * Writes in place, without renaming.
 * These files often arrive as a single-file bind mount, and replacing the
 * inode would break that mount.
 */
function writeInPlace(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, { mode: fileMode(0o600) })
}

export function readSshConfig(): string {
  return readOrEmpty(configPath(getSettings().sshDir))
}

/** Connectable hosts declared in the configuration file. */
export function listConfiguredHosts(): readonly ResolvedHost[] {
  return resolveAll(parseConfig(readSshConfig()))
}

export function findConfiguredHost(alias: string): ResolvedHost | null {
  return resolveHost(parseConfig(readSshConfig()), alias)
}

/**
 * What the block itself declares, without inheritance. This is the correct
 * basis for an edit: writing the inherited values too would disconnect the
 * host from the wildcard block it was taking them from.
 */
export function readHostOwnValues(alias: string): OwnDirectives | null {
  return ownDirectives(parseConfig(readSshConfig()), alias)
}

export function saveHost(entry: HostEntry): void {
  const path = configPath(getSettings().sshDir)
  writeInPlace(path, upsertHost(readOrEmpty(path), entry))
  logger.info('Host saved to the SSH configuration', { alias: entry.alias })
}

export function deleteHost(alias: string): boolean {
  const path = configPath(getSettings().sshDir)
  const before = readOrEmpty(path)
  const after = removeHost(before, alias)
  if (after === before) return false

  writeInPlace(path, after)
  logger.info('Host removed from the SSH configuration', { alias })
  return true
}

export function verifyKnownHost(hostname: string, port: number, key: Buffer): KnownHostsVerdict {
  const path = knownHostsPath(getSettings().sshDir)
  return verifyAgainstKnownHosts(readOrEmpty(path), hostname, port, key)
}

/** Whether a fingerprint is already pinned for this host, of any key type. */
export function hasKnownHost(hostname: string, port: number): boolean {
  return hasKnownHostEntry(readOrEmpty(knownHostsPath(getSettings().sshDir)), hostname, port)
}

/** Pins a new key, just as ssh does on first use. */
export function trustHostKey(hostname: string, port: number, key: Buffer): void {
  const path = knownHostsPath(getSettings().sshDir)
  writeInPlace(path, appendHostKey(readOrEmpty(path), hostname, port, key))
  logger.info('Server key pinned in known_hosts', { hostname, port })
}

/** Forgets every entry for a host so a new first use is allowed. */
export function forgetKnownHost(hostname: string, port: number): number {
  const path = knownHostsPath(getSettings().sshDir)
  const text = readOrEmpty(path)
  if (text.length === 0) return 0

  const patterns = new Set([hostname, `[${hostname}]:${port}`])
  const kept: string[] = []
  let removed = 0

  for (const line of text.split('\n')) {
    const hosts = line.trim().split(/\s+/)[0] ?? ''
    const names = hosts.replace(/^@[a-z-]+\s*/, '').split(',')
    if (names.some((name) => patterns.has(name))) {
      removed += 1
      continue
    }
    kept.push(line)
  }

  if (removed > 0) writeInPlace(path, kept.join('\n'))
  return removed
}
