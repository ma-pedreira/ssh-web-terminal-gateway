import { z } from 'zod'
import { findConfiguredHost } from '#lib/ssh-config/store'
import { forgetPassword, rememberPassword, VaultLockedError } from '#lib/vault/credentials'
import { getSettings } from '#lib/settings/store'
import { record } from '#lib/repos/audit'
import { ApiError, ok } from '#lib/api/respond'
import { jsonBody, route } from '#lib/api/route'
import { requireUser } from '#lib/api/guard'
import { aliasSchema } from '#lib/validation/schemas'

interface Params {
  readonly params: Promise<{ readonly alias: string }>
}

const bodySchema = z.object({ password: z.string().min(1).max(1024) })

/**
 * Stores a host's password in the encrypted vault.
 * Write-only: no endpoint ever returns it.
 */
export const PUT = route<Params>(async (request, { params }) => {
  const { db, user, session, clientIp } = requireUser(request)
  const alias = aliasSchema.parse((await params).alias)

  if (!getSettings().vaultEnabled) {
    throw new ApiError('The credential vault is disabled', 409)
  }
  if (!findConfiguredHost(alias)) throw new ApiError('Host not found', 404)

  const { password } = bodySchema.parse(await jsonBody(request))

  try {
    rememberPassword(session.sessionId, alias, password)
  } catch (error) {
    if (error instanceof VaultLockedError) throw new ApiError(error.message, 428)
    throw error
  }

  record(db, {
    userId: user.id,
    action: 'credential.stored',
    targetId: alias,
    clientIp,
    detail: 'password stored in the encrypted vault',
  })
  return ok({ stored: true })
})

export const DELETE = route<Params>(async (request, { params }) => {
  const { db, user, clientIp } = requireUser(request)
  const alias = aliasSchema.parse((await params).alias)

  const removed = forgetPassword(alias)
  if (removed) {
    record(db, { userId: user.id, action: 'credential.deleted', targetId: alias, clientIp })
  }
  return ok({ removed })
})
