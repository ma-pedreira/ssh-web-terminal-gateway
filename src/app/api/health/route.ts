import { getDb } from '#lib/db/client'
import { ok } from '#lib/api/respond'
import { route } from '#lib/api/route'

/**
 * Probe for the container health check. Needs no session and reveals neither
 * version nor internals: only whether the process can read the database.
 */
export const GET = route(async () => {
  getDb().prepare('SELECT 1').get()
  return ok({ status: 'ok' })
})
