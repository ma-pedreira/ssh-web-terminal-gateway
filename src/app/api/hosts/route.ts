import { findHost, listHosts } from '#lib/ssh-config/inventory'
import { findConfiguredHost, saveHost } from '#lib/ssh-config/store'
import { record } from '#lib/repos/audit'
import { ApiError, ok } from '#lib/api/respond'
import { jsonBody, route } from '#lib/api/route'
import { requireUser } from '#lib/api/guard'
import { hostCreateSchema } from '#lib/validation/schemas'

/** The inventory lives in ~/.ssh/config, not in the database. */
export const GET = route(async (request: Request) => {
  requireUser(request)
  return ok({ hosts: listHosts() })
})

export const POST = route(async (request: Request) => {
  const { db, user, clientIp } = requireUser(request)
  const input = hostCreateSchema.parse(await jsonBody(request))

  if (findConfiguredHost(input.alias)) {
    throw new ApiError(`A host with the alias "${input.alias}" already exists`, 409)
  }

  saveHost({
    alias: input.alias,
    hostname: input.hostname,
    user: input.user,
    port: input.port,
    identityFile: input.identityFile ?? null,
  })

  record(db, {
    userId: user.id,
    action: 'host.created',
    targetId: input.alias,
    clientIp,
    detail: `${input.user}@${input.hostname}:${input.port}`,
  })

  return ok({ host: findHost(input.alias) }, { status: 201 })
})
