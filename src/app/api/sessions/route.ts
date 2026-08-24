import { findConfiguredHost } from '#lib/ssh-config/store'
import { deleteFinishedSessions, listSessions } from '#lib/repos/sessions'
import { record } from '#lib/repos/audit'
import * as manager from '#lib/ssh/session-manager'
import { ApiError, ok } from '#lib/api/respond'
import { jsonBody, route } from '#lib/api/route'
import { requireUser } from '#lib/api/guard'
import { openSessionSchema } from '#lib/validation/schemas'
import { getSettings } from '#lib/settings/store'
import { recallPassword, rememberPassword, VaultLockedError } from '#lib/vault/credentials'
import { logger } from '#lib/logger'

export const GET = route(async (request: Request) => {
  const { db, user } = requireUser(request)
  return ok({ sessions: listSessions(db, user.id, manager.liveSessionIds(user.id)) })
})

/**
 * Clears the history. Only already-finished sessions are deleted: live ones
 * are kept, because deleting their row would orphan an open connection.
 */
export const DELETE = route(async (request: Request) => {
  const { db, user, clientIp } = requireUser(request)

  const cleared = deleteFinishedSessions(db, user.id)
  if (cleared > 0) {
    record(db, {
      userId: user.id,
      action: 'history.cleared',
      clientIp,
      detail: `${cleared} finished sessions`,
    })
  }

  return ok({ cleared })
})

/**
 * Opens an SSH session. Secrets that arrive here travel as far as the
 * handshake and are stored nowhere: not on disk, not in the database, not in
 * the logs.
 */
export const POST = route(async (request: Request) => {
  const { db, user, session, clientIp } = requireUser(request)
  const input = openSessionSchema.parse(await jsonBody(request))

  const host = findConfiguredHost(input.alias)
  if (!host) throw new ApiError('That host is not in the configuration file', 404)

  // If the user types no password, the one stored in the vault is tried.
  const password = input.password ?? recallPassword(session.sessionId, input.alias) ?? undefined

  const sessionId = await manager.openSession(db, host, {
    userId: user.id,
    clientIp,
    cols: input.cols,
    rows: input.rows,
    secrets: { password, passphrase: input.passphrase },
  })

  // Only stored after connecting, so a wrong password is never kept.
  if (input.remember && input.password && getSettings().vaultEnabled) {
    try {
      rememberPassword(session.sessionId, input.alias, input.password)
      record(db, {
        userId: user.id,
        action: 'credential.stored',
        targetId: input.alias,
        clientIp,
        detail: 'stored while connecting',
      })
    } catch (error) {
      if (!(error instanceof VaultLockedError)) throw error
      logger.warn('Could not store the password: the vault is locked', {
        alias: input.alias,
      })
    }
  }

  return ok({ sessionId }, { status: 201 })
})
