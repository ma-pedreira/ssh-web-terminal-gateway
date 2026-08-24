import { findHost } from '#lib/ssh-config/inventory'
import {
  deleteHost,
  findConfiguredHost,
  readHostOwnValues,
  saveHost,
} from '#lib/ssh-config/store'
import { record } from '#lib/repos/audit'
import { ApiError, ok } from '#lib/api/respond'
import { jsonBody, route } from '#lib/api/route'
import { requireUser } from '#lib/api/guard'
import { aliasSchema, hostUpdateSchema } from '#lib/validation/schemas'

interface Params {
  readonly params: Promise<{ readonly alias: string }>
}

export const GET = route<Params>(async (request, { params }) => {
  requireUser(request)
  const alias = aliasSchema.parse((await params).alias)
  const host = findHost(alias)
  if (!host) throw new ApiError('Host not found', 404)
  return ok({ host })
})

export const PATCH = route<Params>(async (request, { params }) => {
  const { db, user, clientIp } = requireUser(request)
  const alias = aliasSchema.parse((await params).alias)
  const current = findConfiguredHost(alias)
  if (!current) throw new ApiError('Host not found', 404)

  const patch = hostUpdateSchema.parse(await jsonBody(request))
  const own = readHostOwnValues(alias) ?? {}

  // Start from what the block declares by itself: if the user does not touch
  // a directive that was inherited from "Host *", it must stay inherited.
  saveHost({
    alias,
    hostname: patch.hostname ?? own.hostname ?? current.hostname,
    user: patch.user ?? own.user ?? null,
    port: patch.port ?? own.port ?? 22,
    identityFile: patch.identityFile ?? own.identityFile ?? null,
  })

  record(db, { userId: user.id, action: 'host.updated', targetId: alias, clientIp })
  return ok({ host: findHost(alias) })
})

export const DELETE = route<Params>(async (request, { params }) => {
  const { db, user, clientIp } = requireUser(request)
  const alias = aliasSchema.parse((await params).alias)

  if (!deleteHost(alias)) throw new ApiError('Host not found', 404)

  record(db, { userId: user.id, action: 'host.deleted', targetId: alias, clientIp })
  return ok({ deleted: true })
})
