import { readFileSync } from 'node:fs'
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { getSettings } from '#lib/settings/store'
import { logger } from '#lib/logger'
import { resolveIdentityPath } from '#lib/ssh-config/paths'
import { knownHostKeyAlgorithms, trustHostKey, verifyKnownHost } from '#lib/ssh-config/store'
import type { ResolvedHost } from '#lib/ssh-config/types'

export const CONNECT_TIMEOUT_MS = 20_000

export class HostKeyMismatchError extends Error {
  readonly hostname: string

  constructor(hostname: string) {
    super(
      'The server key does not match the one in known_hosts. ' +
        'The connection was cut for safety.',
    )
    this.name = 'HostKeyMismatchError'
    this.hostname = hostname
  }
}

export class MissingSecretError extends Error {
  readonly kind: 'password' | 'passphrase'

  constructor(kind: 'password' | 'passphrase') {
    super(
      kind === 'password'
        ? 'This host needs a password to connect'
        : 'The private key is protected and needs its passphrase',
    )
    this.name = 'MissingSecretError'
    this.kind = kind
  }
}

export class AuthenticationFailedError extends Error {
  constructor() {
    super(
      'The server rejected the credentials. Check the user, the password, or ' +
        'that the private key is authorised on the host.',
    )
    this.name = 'AuthenticationFailedError'
  }
}

export class SshConnectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SshConnectionError'
  }
}

/**
 * Translates the ssh2 error into something the user can act on.
 * These messages are about the remote host, not the internals of the
 * application, so showing them leaks nothing.
 */
export function describeSshError(cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause)
  const code = (cause as { code?: string } | null)?.code

  if (/All configured authentication methods failed/i.test(message)) {
    return new AuthenticationFailedError()
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(message)) {
    return new SshConnectionError('The server is not accepting connections on that port')
  }
  if (code === 'ENOTFOUND' || /ENOTFOUND|EAI_AGAIN/.test(message)) {
    return new SshConnectionError(
      'The host name could not be resolved from the ssh-web server',
    )
  }
  if (code === 'EHOSTUNREACH' || /EHOSTUNREACH|ENETUNREACH/.test(message)) {
    return new SshConnectionError('The host is unreachable from the ssh-web server')
  }
  if (code === 'ETIMEDOUT' || /timed out|timeout/i.test(message)) {
    return new SshConnectionError('The host did not respond in time')
  }

  return new SshConnectionError(`The SSH connection failed: ${message}`)
}

export interface EstablishedConnection {
  readonly client: Client
  readonly stream: ClientChannel
}

export interface ConnectSecrets {
  /** Only lives in memory during the handshake. Never stored. */
  readonly password?: string
  readonly passphrase?: string
}

interface Viewport {
  readonly cols: number
  readonly rows: number
}

function loadIdentity(identityFile: string): Buffer {
  const path = resolveIdentityPath(identityFile, getSettings().keysDir)
  try {
    return readFileSync(path)
  } catch (cause) {
    throw new Error(`Could not read the private key given in IdentityFile (${identityFile})`, {
      cause,
    })
  }
}

/**
 * Opens an SSH connection and an interactive shell.
 * Secrets arrive as parameters and only exist in memory: the application never
 * writes a password or passphrase to disk.
 */
export function establishConnection(
  host: ResolvedHost,
  viewport: Viewport,
  secrets: ConnectSecrets = {},
): Promise<EstablishedConnection> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      client.end()
      reject(error)
    }

    const config: ConnectConfig = {
      host: host.hostname,
      port: host.port,
      username: host.user ?? 'root',
      readyTimeout: CONNECT_TIMEOUT_MS,
      keepaliveInterval: 20_000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer): boolean => {
        const verdict = verifyKnownHost(host.hostname, host.port, key)

        if (verdict.outcome === 'mismatch') {
          logger.error('The server key does not match known_hosts', {
            hostname: host.hostname,
            port: host.port,
            keyType: verdict.keyType,
          })
          fail(new HostKeyMismatchError(host.hostname))
          return false
        }

        if (verdict.outcome === 'unknown') {
          // Trust on first use: pinned in the standard file, exactly as the
          // ssh client does the first time you connect.
          trustHostKey(host.hostname, host.port, key)
        }

        return true
      },
    }

    // A pinned host is asked only for the key types on file: the verifier
    // refuses any other type, so the server must not be free to pick one.
    const pinned = knownHostKeyAlgorithms(host.hostname, host.port)
    if (pinned.length > 0) {
      config.algorithms = {
        serverHostKey: pinned as NonNullable<ConnectConfig['algorithms']>['serverHostKey'],
      }
    }

    if (host.identityFile) {
      try {
        config.privateKey = loadIdentity(host.identityFile)
      } catch (error) {
        reject(error as Error)
        return
      }
      if (secrets.passphrase) config.passphrase = secrets.passphrase
    }

    if (secrets.password) config.password = secrets.password

    const agent = process.env.SSH_AUTH_SOCK
    if (agent && !config.privateKey && !config.password) config.agent = agent

    if (!config.privateKey && !config.password && !config.agent) {
      reject(new MissingSecretError('password'))
      return
    }

    client.on('ready', () => {
      client.shell(
        { term: 'xterm-256color', cols: viewport.cols, rows: viewport.rows },
        (error, stream) => {
          if (error) {
            fail(error)
            return
          }
          settled = true
          resolve({ client, stream })
        },
      )
    })

    client.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error)
      // ssh2 does not distinguish an encrypted key from an invalid one.
      if (/passphrase/i.test(message) && !secrets.passphrase) {
        fail(new MissingSecretError('passphrase'))
        return
      }
      fail(describeSshError(error))
    })

    client.connect(config)
  })
}
