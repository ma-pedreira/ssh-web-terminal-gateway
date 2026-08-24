import { listAvailableKeys } from '#lib/ssh-config/inventory'
import { ok } from '#lib/api/respond'
import { route } from '#lib/api/route'
import { requireUser } from '#lib/api/guard'

/** Names of the available keys. Never their contents. */
export const GET = route(async (request: Request) => {
  requireUser(request)
  return ok({ keys: listAvailableKeys() })
})
