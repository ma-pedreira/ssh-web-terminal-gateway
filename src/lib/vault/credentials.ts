import { logger } from '#lib/logger'
import { getSettings } from '#lib/settings/store'
import { keyFor } from '#lib/vault/keyring'
import { readVault, vaultExists, writeVault } from '#lib/vault/store'
import { listVaultAliases, openEntry, putEntry, removeEntry } from '#lib/vault/vault'

export type VaultState = 'disabled' | 'locked' | 'open'

/**
 * `locked` means a vault exists but this session does not hold its key: that
 * happens after a server restart, because the key only lives in memory.
 */
export function vaultState(sessionId: string): VaultState {
  if (!getSettings().vaultEnabled && !vaultExists()) return 'disabled'
  return keyFor(sessionId) ? 'open' : 'locked'
}

/** Aliases with a stored password. Aliases are not secret. */
export function storedAliases(): readonly string[] {
  const vault = readVault()
  return vault ? listVaultAliases(vault) : Object.freeze([])
}

/** Recovers a host's stored password, or null if there is none or the vault is locked. */
export function recallPassword(sessionId: string, alias: string): string | null {
  const key = keyFor(sessionId)
  const vault = readVault()
  if (!key || !vault) return null

  try {
    return openEntry(vault, key, alias)
  } catch (error) {
    logger.warn('Could not decrypt the stored password', {
      alias,
      error: (error as Error).message,
    })
    return null
  }
}

export class VaultLockedError extends Error {
  constructor() {
    super(
      'The credential vault is not open in this session. ' +
        'Sign in again to unlock it.',
    )
    this.name = 'VaultLockedError'
  }
}

export function rememberPassword(sessionId: string, alias: string, password: string): void {
  const key = keyFor(sessionId)
  const vault = readVault()
  if (!key || !vault) throw new VaultLockedError()

  writeVault(putEntry(vault, key, alias, password))
  logger.info('Password stored in the vault', { alias })
}

export function forgetPassword(alias: string): boolean {
  const vault = readVault()
  if (!vault || !listVaultAliases(vault).includes(alias)) return false

  writeVault(removeEntry(vault, alias))
  logger.info('Password removed from the vault', { alias })
  return true
}
