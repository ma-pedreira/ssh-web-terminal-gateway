import { ZodError } from 'zod'
import { PathNotAllowedError } from '#lib/paths/containment'
import { ApiError, fail } from '#lib/api/respond'
import { logger } from '#lib/logger'
import {
  AuthenticationFailedError,
  HostKeyMismatchError,
  MissingSecretError,
  SshConnectionError,
} from '#lib/ssh/connect'
import { SessionLimitError } from '#lib/ssh/session-manager'

/** Field names as they appear in the forms. */
const FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  alias: 'Alias',
  hostname: 'Host or IP',
  port: 'Port',
  user: 'Remote user',
  identityFile: 'Private key',
  username: 'Username',
  password: 'Password',
  passphrase: 'Passphrase',
  sshDir: 'OpenSSH folder',
  keysDir: 'Keys folder',
  vaultPath: 'Vault file',
  sessionIdleMinutes: 'Idle minutes',
  replayBufferKb: 'Retained kilobytes',
})

type Handler<T> = (request: Request, context: T) => Promise<Response>

/**
 * Wraps a route handler and turns known errors into responses.
 * Unexpected errors never leak internal detail to the client.
 */
export function route<T>(handler: Handler<T>): Handler<T> {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (error) {
      if (error instanceof ApiError) {
        return fail(error.message, error.status)
      }
      // A forbidden path is an invalid choice by the user, not a server
      // failure, and the message tells them where they can save instead.
      if (error instanceof PathNotAllowedError) {
        return fail(error.message, 422)
      }
      if (error instanceof ZodError) {
        const first = error.issues[0]
        const field = first?.path.join('.') ?? ''
        const message = first?.message ?? 'Invalid data'
        // The internal field name means nothing to whoever uses the app.
        const label = FIELD_LABELS[field]
        return fail(label ? `${label}: ${message}` : message, 422)
      }
      if (error instanceof HostKeyMismatchError) {
        return fail(error.message, 409)
      }
      // 428: a secret only the user can supply is missing, either because it
      // was not sent or because the host rejected it. The interface asks for
      // it and retries. 401 is not used here: it means the app session has
      // expired and would trigger an unwanted sign-out.
      if (error instanceof MissingSecretError || error instanceof AuthenticationFailedError) {
        return fail(error.message, 428)
      }
      if (error instanceof SessionLimitError) {
        return fail(error.message, 429)
      }
      if (error instanceof SshConnectionError) {
        return fail(error.message, 502)
      }
      logger.error('Unhandled error in the API', {
        url: request.url,
        method: request.method,
        error: (error as Error).message,
      })
      return fail('Internal server error', 500)
    }
  }
}

/** JSON body with a size cap, so absurd payloads are not accepted. */
export async function jsonBody(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const raw = await request.text()
  if (raw.length > maxBytes) throw new ApiError('Request body too large', 413)
  if (raw.length === 0) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new ApiError('The body is not valid JSON', 400)
  }
}
