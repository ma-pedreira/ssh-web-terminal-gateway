import { z } from 'zod'

/**
 * Bootstrap variables only. Everything the user can change from the settings
 * screen lives in settings.json and is read through getSettings(); what is
 * here are the starting values plus the ones that would make no sense to
 * change without restarting the process.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3030),

  SSH_WEB_DB_PATH: z.string().min(1).optional(),
  SSH_WEB_CONFIG_DIR: z.string().min(1).optional(),

  // Starting values, overridable from the settings screen.
  SSH_WEB_SSH_DIR: z.string().min(1).optional(),
  SSH_WEB_KEYS_DIR: z.string().min(1).optional(),
  SSH_WEB_VAULT_PATH: z.string().min(1).optional(),

  // Folders the user may choose as a save location, separated by the system
  // delimiter (":" on Unix, ";" on Windows).
  SSH_WEB_ALLOWED_ROOTS: z.string().optional(),

  SSH_WEB_SECURE_COOKIES: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  // True only behind a reverse proxy that overwrites X-Forwarded-For. Without
  // one, that header is whatever the client chose to send.
  SSH_WEB_TRUST_PROXY: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
  // Live SSH sessions one user may hold at once.
  SSH_WEB_MAX_SESSIONS: z.coerce.number().int().min(1).max(100).default(10),
  SSH_WEB_SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(10080).default(120),
  SSH_WEB_REPLAY_BUFFER_KB: z.coerce.number().int().min(8).max(4096).default(256),
})

export type Env = Readonly<z.infer<typeof schema>>

let cached: Env | null = null

/** Reads and validates the environment once. Fails at startup if anything is off. */
export function getEnv(): Env {
  if (cached) return cached

  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid environment configuration -> ${detail}`)
  }

  cached = Object.freeze(parsed.data)
  return cached
}

/** Test-only: discards the memoised environment. */
export function resetEnvCache(): void {
  cached = null
}
