import { getDb } from '#lib/db/client'
import { countUsers, createUser } from '#lib/repos/users'
import { record } from '#lib/repos/audit'
import { ApiError, ok } from '#lib/api/respond'
import { jsonBody, route } from '#lib/api/route'
import { clientIpOf } from '#lib/api/guard'
import { passwordSchema, usernameSchema } from '#lib/validation/schemas'
import { z } from 'zod'

const setupSchema = z.object({ username: usernameSchema, password: passwordSchema })

/** Whether there is still no user, so the initial sign-up can be shown. */
export const GET = route(async () => {
  return ok({ needsSetup: countUsers(getDb()) === 0 })
})

/** Creates the first user. Closes for good as soon as one exists. */
export const POST = route(async (request: Request) => {
  const db = getDb()
  if (countUsers(db) > 0) {
    throw new ApiError('Initial sign-up has already been completed', 409)
  }

  const { username, password } = setupSchema.parse(await jsonBody(request))
  const user = await createUser(db, username, password)
  record(db, {
    userId: user.id,
    action: 'user.login',
    clientIp: clientIpOf(request),
    detail: 'initial sign-up',
  })

  return ok({ username: user.username }, { status: 201 })
})
