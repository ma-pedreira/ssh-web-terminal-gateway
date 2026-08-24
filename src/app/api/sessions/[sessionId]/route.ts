import { findSession } from '#lib/repos/sessions'
import * as manager from '#lib/ssh/session-manager'
import { ApiError, ok } from '#lib/api/respond'
import { route } from '#lib/api/route'
import { requireUser } from '#lib/api/guard'
import { idSchema } from '#lib/validation/schemas'

interface Params {
  readonly params: Promise<{ readonly sessionId: string }>
}

export const GET = route<Params>(async (request, { params }) => {
  const { db, user } = requireUser(request)
  const sessionId = idSchema.parse((await params).sessionId)
  const session = findSession(db, sessionId, user.id)
  if (!session) throw new ApiError('Session not found', 404)
  return ok({ session, resumable: manager.isLive(sessionId, user.id) })
})

export const DELETE = route<Params>(async (request, { params }) => {
  const { db, user } = requireUser(request)
  const sessionId = idSchema.parse((await params).sessionId)
  if (!findSession(db, sessionId, user.id)) throw new ApiError('Session not found', 404)

  const closed = manager.closeSession(db, sessionId, user.id)
  return ok({ closed })
})
