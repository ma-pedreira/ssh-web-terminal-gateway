import { z } from 'zod'
import { findUserWithHash } from '#lib/repos/users'
import { verifyPassword } from '#lib/crypto/password'
import { getSettings, updateSettings } from '#lib/settings/store'
import { openOrCreateVault } from '#lib/vault/store'
import { rememberKey } from '#lib/vault/keyring'
import { vaultState } from '#lib/vault/credentials'
import { ApiError, ok } from '#lib/api/respond'
import { jsonBody, route } from '#lib/api/route'
import { requireUser } from '#lib/api/guard'

const bodySchema = z.object({ password: z.string().min(1).max(1024) })

/**
 * Opens the vault for this session, creating and enabling it if needed.
 *
 * One path for the two cases the user perceives identically: "I want to store
 * passwords and right now I cannot". It requires the sign-in password because
 * that password encrypts the vault, not as a formality.
 */
export const POST = route(async (request: Request) => {
  const { db, user, session } = requireUser(request)
  const { password } = bodySchema.parse(await jsonBody(request))

  const stored = findUserWithHash(db, user.username)
  if (!stored || !(await verifyPassword(password, stored.password_hash))) {
    throw new ApiError('That password is not correct', 403)
  }

  if (!getSettings().vaultEnabled) updateSettings({ vaultEnabled: true })

  rememberKey(session.sessionId, await openOrCreateVault(password))

  return ok({ state: vaultState(session.sessionId) })
})
