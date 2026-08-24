import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { getEnv } from '#lib/env'
import { logger } from '#lib/logger'
import {
  defaultAllowedRoots,
  defaultConfigDir,
  defaultKeysDir,
  defaultSshDir,
  fileMode,
} from '#lib/platform'
import {
  mergeSettings,
  validatePaths,
  type Settings,
  type SettingsPatch,
} from '#lib/settings/model'

const FILE_NAME = 'settings.json'

let cached: Settings | null = null

export function configDirectory(): string {
  return getEnv().SSH_WEB_CONFIG_DIR ?? defaultConfigDir()
}

export function settingsFilePath(): string {
  return join(configDirectory(), FILE_NAME)
}

/** Folders the user is allowed to choose as a save location. */
export function allowedRoots(): readonly string[] {
  const configured = getEnv().SSH_WEB_ALLOWED_ROOTS
  if (configured) {
    const roots = configured
      .split(delimiter)
      .map((root) => root.trim())
      .filter((root) => root.length > 0)
    if (roots.length > 0) return Object.freeze(roots)
  }
  return defaultAllowedRoots()
}

/** Starting values: environment variables if present, otherwise the platform. */
function defaultSettings(): Settings {
  const env = getEnv()
  return Object.freeze({
    sshDir: env.SSH_WEB_SSH_DIR ?? defaultSshDir(),
    keysDir: env.SSH_WEB_KEYS_DIR ?? defaultKeysDir(),
    vaultPath: env.SSH_WEB_VAULT_PATH ?? join(configDirectory(), 'credenciales.vault'),
    vaultEnabled: false,
    sessionIdleMinutes: env.SSH_WEB_SESSION_IDLE_MINUTES,
    replayBufferKb: env.SSH_WEB_REPLAY_BUFFER_KB,
  })
}

function readStored(): SettingsPatch {
  const path = settingsFilePath()
  if (!existsSync(path)) return {}

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SettingsPatch
  } catch (error) {
    logger.warn('Could not read the settings file; falling back to defaults', {
      path,
      error: (error as Error).message,
    })
    return {}
  }
}

export function getSettings(): Settings {
  if (cached) return cached
  cached = mergeSettings(defaultSettings(), readStored())
  return cached
}

/** Saves the changes after confining paths to the allowed folders. */
export function updateSettings(patch: SettingsPatch): Settings {
  const safe = validatePaths(patch, allowedRoots())
  const next = mergeSettings(getSettings(), safe)

  const path = settingsFilePath()
  mkdirSync(configDirectory(), { recursive: true })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: fileMode(0o600) })

  cached = next
  logger.info('Settings updated', { path, fields: Object.keys(safe) })
  return next
}
