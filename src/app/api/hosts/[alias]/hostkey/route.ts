import { findConfiguredHost, forgetKnownHost } from '#lib/ssh-config/store'
import { record } from '#lib/repos/audit'
import { ApiError, ok } from '#lib/api/respond'
import { route } from '#lib/api/route'
import { requireUser } from '#lib/api/guard'
import { aliasSchema } from '#lib/validation/schemas'

interface Params {
  readonly params: Promise<{ readonly alias: string }>
}

/**
 * Forgets this host's known_hosts entries so a new first use is allowed.
 * Only makes sense when the key change is expected.
 */
export const DELETE = route<Params>(async (request, { params }) => {
  const { db, user, clientIp } = requireUser(request)
  const alias = aliasSchema.parse((await params).alias)

  const host = findConfiguredHost(alias)
  if (!host) throw new ApiError('Host not found', 404)

  const removed = forgetKnownHost(host.hostname, host.port)
  if (removed > 0) {
    record(db, {
      userId: user.id,
      action: 'hostkey.forgotten',
      targetId: alias,
      clientIp,
      detail: 'the user authorised a new first use',
    })
  }

  return ok({ removed })
})
