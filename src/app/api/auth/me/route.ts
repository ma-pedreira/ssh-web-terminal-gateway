import { ok } from '#lib/api/respond'
import { route } from '#lib/api/route'
import { requireUser } from '#lib/api/guard'

export const GET = route(async (request: Request) => {
  const { user } = requireUser(request)
  return ok({ user })
})
