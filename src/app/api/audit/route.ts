import { listRecent } from '#lib/repos/audit'
import { ok } from '#lib/api/respond'
import { route } from '#lib/api/route'
import { requireUser } from '#lib/api/guard'

export const GET = route(async (request: Request) => {
  const { db, user } = requireUser(request)
  const limit = Number(new URL(request.url).searchParams.get('limit') ?? 60)
  return ok({ entries: listRecent(db, user.id, Number.isFinite(limit) ? limit : 60) })
})
