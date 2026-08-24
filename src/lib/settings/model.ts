import { z } from 'zod'
import { PathNotAllowedError, resolveInsideAny, type Platform } from '#lib/paths/containment'

export interface Settings {
  readonly sshDir: string
  readonly keysDir: string
  readonly vaultPath: string
  readonly vaultEnabled: boolean
  readonly sessionIdleMinutes: number
  readonly replayBufferKb: number
}

export type SettingsPatch = Partial<Settings>

const pathField = z
  .string()
  .trim()
  .min(1, 'Required')
  .max(4096)
  .refine((value) => !value.includes('\0'), 'Invalid path')

export const settingsPatchSchema = z.object({
  sshDir: pathField.optional(),
  keysDir: pathField.optional(),
  vaultPath: pathField.optional(),
  vaultEnabled: z.boolean().optional(),
  sessionIdleMinutes: z.coerce.number().int().min(1).max(10080).optional(),
  replayBufferKb: z.coerce.number().int().min(8).max(4096).optional(),
})

/** Fields that are paths and therefore need confining. */
const PATH_FIELDS = ['sshDir', 'keysDir', 'vaultPath'] as const

const KNOWN_FIELDS: ReadonlyArray<keyof Settings> = [
  'sshDir',
  'keysDir',
  'vaultPath',
  'vaultEnabled',
  'sessionIdleMinutes',
  'replayBufferKb',
]

/** What the user saved overrides the platform defaults. */
export function mergeSettings(defaults: Settings, stored: SettingsPatch): Settings {
  const overrides = Object.fromEntries(
    Object.entries(stored).filter(
      ([key, value]) => value !== undefined && KNOWN_FIELDS.includes(key as keyof Settings),
    ),
  )
  return Object.freeze({ ...defaults, ...overrides }) as Settings
}

/**
 * Requires every chosen path to fall inside the allowed folders and returns it
 * normalised. Without this, the settings screen would be arbitrary write
 * access to the disk with the process's permissions.
 */
export function validatePaths(
  patch: SettingsPatch,
  roots: readonly string[],
  platform: Platform = process.platform,
): SettingsPatch {
  const result: Record<string, unknown> = { ...patch }

  for (const field of PATH_FIELDS) {
    const value = patch[field]
    if (value === undefined) continue
    try {
      result[field] = resolveInsideAny(value, roots, platform)
    } catch (cause) {
      const error = cause as PathNotAllowedError
      throw new PathNotAllowedError(
        `${field}: ${error.message}`,
        error.attempted ?? String(value),
        error.roots ?? roots,
      )
    }
  }

  return Object.freeze(result) as SettingsPatch
}
