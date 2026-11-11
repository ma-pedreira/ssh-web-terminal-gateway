import { confirmPassword } from '#lib/auth/reauth'
import { allowedRoots, getSettings, updateSettings } from '#lib/settings/store'
import { settingsPatchSchema } from '#lib/settings/model'
import { openOrCreateVault } from '#lib/vault/store'
import { rememberKey } from '#lib/vault/keyring'
import { storedAliases, vaultState } from '#lib/vault/credentials'
import { defaultAllowedRoots } from '#lib/platform'
import { ApiError, ok } from '#lib/api/respond'
import { jsonBody, route } from '#lib/api/route'
import { requireUser } from '#lib/api/guard'
import { z } from 'zod'

export const GET = route(async (request: Request) => {
  const { session } = requireUser(request)
  return ok({
    settings: getSettings(),
    allowedRoots: allowedRoots(),
    platform: process.platform,
    vault: {
      state: vaultState(session.sessionId),
      aliases: storedAliases(),
    },
    // The system folders are reported in case the user wants to go back.
    suggestions: defaultAllowedRoots(),
  })
})

const bodySchema = settingsPatchSchema.extend({
  // Enabling the vault requires re-authentication: the password encrypts it.
  password: z.string().max(1024).optional(),
})

export const PUT = route(async (request: Request) => {
  const { db, user, session } = requireUser(request)
  const { password, ...patch } = bodySchema.parse(await jsonBody(request))

  const enabling = patch.vaultEnabled === true && !getSettings().vaultEnabled
  if (enabling) {
    if (!password) {
      throw new ApiError('Enabling the vault needs your password: it is what encrypts it', 428)
    }
    await confirmPassword(db, user, password)
  }

  const settings = updateSettings(patch)

  if (enabling && password) {
    rememberKey(session.sessionId, await openOrCreateVault(password))
  }

  return ok({ settings, vault: { state: vaultState(session.sessionId) } })
})
