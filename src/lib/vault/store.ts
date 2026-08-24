import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { logger } from '#lib/logger'
import { fileMode } from '#lib/platform'
import { getSettings } from '#lib/settings/store'
import {
  createVault,
  parseVault,
  serializeVault,
  unlockVault,
  type Vault,
} from '#lib/vault/vault'

export function vaultPath(): string {
  return getSettings().vaultPath
}

export function vaultExists(): boolean {
  return existsSync(vaultPath())
}

export function readVault(): Vault | null {
  const path = vaultPath()
  if (!existsSync(path)) return null
  return parseVault(readFileSync(path, 'utf8'))
}

export function writeVault(vault: Vault): void {
  const path = vaultPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, serializeVault(vault), { mode: fileMode(0o600) })
}

/**
 * Opens the vault with the sign-in password, creating it if it did not exist.
 * Returns the key, which must only live in memory for the session.
 */
export async function openOrCreateVault(password: string): Promise<Buffer> {
  const existing = readVault()
  if (existing) return unlockVault(existing, password)

  const vault = await createVault(password)
  writeVault(vault)
  logger.info('Credential vault created', { path: vaultPath() })
  return unlockVault(vault, password)
}
