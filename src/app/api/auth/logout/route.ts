import { getDb } from '#lib/db/client'
import { destroySession } from '#lib/auth/session'
import { expiredCookies, parseCookies, SESSION_COOKIE } from '#lib/auth/cookies'
import { record } from '#lib/repos/audit'
import { ok } from '#lib/api/respond'
import { route } from '#lib/api/route'
import { clientIpOf, isSecureCookies, requireUser } from '#lib/api/guard'
import { forgetKey } from '#lib/vault/keyring'

export const POST = route(async (request: Request) => {
  const context = requireUser(request)
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE]
  if (token) destroySession(getDb(), token)
  forgetKey(context.session.sessionId)
  record(context.db, {
    userId: context.user.id,
    action: 'user.logout',
    clientIp: clientIpOf(request),
  })

  const response = ok({ ended: true })
  for (const cookie of expiredCookies(isSecureCookies())) {
    response.headers.append('Set-Cookie', cookie)
  }
  return response
})
