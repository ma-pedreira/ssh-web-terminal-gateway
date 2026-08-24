import type { DatabaseSync } from 'node:sqlite'
import type { Client, ClientChannel } from 'ssh2'
import { RingBuffer } from '#lib/ssh/ring-buffer'
import { establishConnection, MissingSecretError, type ConnectSecrets } from '#lib/ssh/connect'
import { getSettings } from '#lib/settings/store'
import { logger } from '#lib/logger'
import { record } from '#lib/repos/audit'
import * as sessions from '#lib/repos/sessions'
import type { ResolvedHost } from '#lib/ssh-config/types'

/** Destination for terminal output: in production, a WebSocket. */
export interface TerminalSink {
  deliver(chunk: Buffer): void
  notify(event: SessionEvent): void
  terminate(reason: string): void
}

export type SessionEvent =
  | { readonly type: 'status'; readonly status: 'active' | 'suspended' | 'closed' | 'failed' }
  | { readonly type: 'error'; readonly message: string }
  | { readonly type: 'exit'; readonly code: number | null }

interface LiveSession {
  readonly id: string
  readonly userId: string
  readonly hostAlias: string
  readonly client: Client
  readonly stream: ClientChannel
  readonly buffer: RingBuffer
  readonly sinks: Set<TerminalSink>
  cols: number
  rows: number
  idleTimer: NodeJS.Timeout | null
  closing: boolean
}

interface ManagerState {
  readonly live: Map<string, LiveSession>
}

// A single registry per process, resilient to Next's hot reload.
const globalKey = Symbol.for('ssh-web.session-manager')
const store = globalThis as unknown as Record<symbol, ManagerState | undefined>
const state: ManagerState = store[globalKey] ?? { live: new Map<string, LiveSession>() }
store[globalKey] = state

function broadcast(session: LiveSession, chunk: Buffer): void {
  for (const sink of session.sinks) {
    try {
      sink.deliver(chunk)
    } catch (error) {
      logger.warn('Could not deliver output to a client', {
        sessionId: session.id,
        error: (error as Error).message,
      })
      session.sinks.delete(sink)
    }
  }
}

function announce(session: LiveSession, event: SessionEvent): void {
  for (const sink of session.sinks) {
    try {
      sink.notify(event)
    } catch {
      session.sinks.delete(sink)
    }
  }
}

function clearIdleTimer(session: LiveSession): void {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer)
    session.idleTimer = null
  }
}

function startIdleTimer(db: DatabaseSync, session: LiveSession): void {
  clearIdleTimer(session)
  const minutes = getSettings().sessionIdleMinutes
  session.idleTimer = setTimeout(
    () => {
      logger.info('Suspended session closed after inactivity', {
        sessionId: session.id,
        minutes,
      })
      closeSession(db, session.id, session.userId, `Idle for ${minutes} minutes`)
    },
    minutes * 60_000,
  )
  session.idleTimer.unref?.()
}

function teardown(
  db: DatabaseSync,
  session: LiveSession,
  reason: string,
  exitCode: number | null,
  failed: boolean,
): void {
  if (session.closing) return
  session.closing = true
  clearIdleTimer(session)

  sessions.setStatus(db, session.id, failed ? 'failed' : 'closed', {
    exitCode,
    closeReason: reason,
  })
  record(db, {
    userId: session.userId,
    action: failed ? 'session.failed' : 'session.closed',
    targetId: session.id,
    detail: reason,
  })

  announce(session, { type: 'status', status: failed ? 'failed' : 'closed' })
  for (const sink of session.sinks) {
    try {
      sink.terminate(reason)
    } catch {
      // The client had already gone.
    }
  }

  session.sinks.clear()
  try {
    session.stream.end()
    session.client.end()
  } catch {
    // Ya estaba cerrado.
  }
  state.live.delete(session.id)
}

export interface OpenOptions {
  readonly userId: string
  readonly clientIp: string | null
  readonly cols: number
  readonly rows: number
  /** Secrets the user has just typed. They are not stored anywhere. */
  readonly secrets?: ConnectSecrets
}

/** Opens an SSH session and registers it as live in the process. */
export async function openSession(
  db: DatabaseSync,
  host: ResolvedHost,
  options: OpenOptions,
): Promise<string> {
  const row = sessions.openSession(db, {
    userId: options.userId,
    hostAlias: host.alias,
    hostname: host.hostname,
    hostUser: host.user,
    port: host.port,
    clientIp: options.clientIp,
    cols: options.cols,
    rows: options.rows,
  })

  try {
    const { client, stream } = await establishConnection(
      host,
      { cols: options.cols, rows: options.rows },
      options.secrets ?? {},
    )

    const session: LiveSession = {
      id: row.id,
      userId: options.userId,
      hostAlias: host.alias,
      client,
      stream,
      buffer: new RingBuffer(getSettings().replayBufferKb * 1024),
      sinks: new Set<TerminalSink>(),
      cols: options.cols,
      rows: options.rows,
      idleTimer: null,
      closing: false,
    }

    stream.on('data', (chunk: Buffer) => {
      session.buffer.push(chunk)
      broadcast(session, chunk)
    })
    stream.stderr?.on('data', (chunk: Buffer) => {
      session.buffer.push(chunk)
      broadcast(session, chunk)
    })
    stream.on('close', (code: number | null) => {
      announce(session, { type: 'exit', code: code ?? null })
      teardown(db, session, 'The remote shell exited', code ?? null, false)
    })
    client.on('error', (error: Error) => {
      announce(session, { type: 'error', message: error.message })
      teardown(db, session, error.message, null, true)
    })

    state.live.set(session.id, session)
    // Suspended, not active: the connection exists but no client is watching
    // it yet. It becomes active when the WebSocket arrives.
    sessions.setStatus(db, session.id, 'suspended')
    record(db, {
      userId: options.userId,
      action: 'session.opened',
      targetId: session.id,
      clientIp: options.clientIp,
      detail: `${host.alias} (${host.user ?? 'root'}@${host.hostname}:${host.port})`,
    })

    // Nadie enganchado todavia: cuenta como suspendida hasta que llegue el WebSocket.
    startIdleTimer(db, session)
    return session.id
  } catch (error) {
    // A secret only the user can supply is missing: the interface will ask
    // and retry. This is not a failed attempt, so it leaves no trace.
    if (error instanceof MissingSecretError) {
      sessions.discardSession(db, row.id)
      throw error
    }

    const message = (error as Error).message
    sessions.setStatus(db, row.id, 'failed', { closeReason: message })
    record(db, {
      userId: options.userId,
      action: 'session.failed',
      targetId: row.id,
      clientIp: options.clientIp,
      detail: message,
    })
    throw error
  }
}

/**
 * Attaches a client to a live session and repaints the retained output.
 * This is what makes it possible to close the browser and resume the session
 * exactly where it was.
 */
export function attach(
  db: DatabaseSync,
  sessionId: string,
  userId: string,
  sink: TerminalSink,
): boolean {
  const session = state.live.get(sessionId)
  if (!session || session.userId !== userId) return false

  clearIdleTimer(session)
  const replay = session.buffer.snapshot()
  if (replay.byteLength > 0) sink.deliver(replay)

  session.sinks.add(sink)
  sessions.setStatus(db, sessionId, 'active')
  record(db, { userId, action: 'session.attached', targetId: sessionId })
  sink.notify({ type: 'status', status: 'active' })
  return true
}

/** Detaches a client. The SSH session stays live and becomes suspended. */
export function detach(db: DatabaseSync, sessionId: string, sink: TerminalSink): void {
  const session = state.live.get(sessionId)
  if (!session) return

  session.sinks.delete(sink)
  if (session.sinks.size > 0) return

  sessions.setStatus(db, sessionId, 'suspended')
  record(db, { userId: session.userId, action: 'session.detached', targetId: sessionId })
  startIdleTimer(db, session)
}

export function write(db: DatabaseSync, sessionId: string, userId: string, data: string): boolean {
  const session = state.live.get(sessionId)
  if (!session || session.userId !== userId || session.closing) return false
  session.stream.write(data)
  sessions.touchActivity(db, sessionId)
  return true
}

export function resize(
  db: DatabaseSync,
  sessionId: string,
  userId: string,
  cols: number,
  rows: number,
): boolean {
  const session = state.live.get(sessionId)
  if (!session || session.userId !== userId || session.closing) return false
  session.cols = cols
  session.rows = rows
  session.stream.setWindow(rows, cols, 0, 0)
  sessions.setViewport(db, sessionId, cols, rows)
  return true
}

export function closeSession(
  db: DatabaseSync,
  sessionId: string,
  userId: string,
  reason = 'Closed by the user',
): boolean {
  const session = state.live.get(sessionId)
  if (!session || session.userId !== userId) return false
  teardown(db, session, reason, null, false)
  return true
}

/** Identifiers of the sessions that can be resumed right now. */
export function liveSessionIds(userId?: string): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const [id, session] of state.live) {
    if (!userId || session.userId === userId) ids.add(id)
  }
  return ids
}

export function isLive(sessionId: string, userId: string): boolean {
  const session = state.live.get(sessionId)
  return session !== undefined && session.userId === userId
}

/** Closes everything when the process shuts down. */
export function shutdown(db: DatabaseSync): void {
  for (const session of [...state.live.values()]) {
    teardown(db, session, 'The server is shutting down', null, false)
  }
}
