import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { getDb } from '#lib/db/client'
import { logger } from '#lib/logger'
import { parseCookies, SESSION_COOKIE } from '#lib/auth/cookies'
import { resolveSession } from '#lib/auth/session'
import { clientMessageSchema } from '#lib/validation/schemas'
import * as manager from '#lib/ssh/session-manager'
import type { SessionEvent, TerminalSink } from '#lib/ssh/session-manager'

export const TERMINAL_PATH = '/api/terminal'

const PING_INTERVAL_MS = 30_000

interface Authorized {
  readonly userId: string
  readonly sessionId: string
}

/**
 * Same origin is mandatory: without it, any page could open a WebSocket with
 * the user's cookies and drive their terminal.
 */
function isSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin
  if (!origin) return true // Non-browser clients do not send Origin.
  const host = request.headers.host
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function authorize(request: IncomingMessage): Authorized | null {
  if (!isSameOrigin(request)) return null

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  if (url.pathname !== TERMINAL_PATH) return null

  const sessionId = url.searchParams.get('session')
  if (!sessionId) return null

  const token = parseCookies(request.headers.cookie)[SESSION_COOKIE]
  if (!token) return null

  const resolved = resolveSession(getDb(), token)
  if (!resolved) return null

  if (!manager.isLive(sessionId, resolved.user.id)) return null

  return { userId: resolved.user.id, sessionId }
}

function makeSink(socket: WebSocket): TerminalSink {
  return {
    deliver(chunk: Buffer): void {
      if (socket.readyState === socket.OPEN) socket.send(chunk, { binary: true })
    },
    notify(event: SessionEvent): void {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event))
    },
    terminate(reason: string): void {
      if (socket.readyState === socket.OPEN) socket.close(1000, reason.slice(0, 120))
    },
  }
}

function reject(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

/** Attaches the terminal gateway to the existing HTTP server. */
export function attachTerminalGateway(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 })

  server.on('upgrade', (request, socket, head) => {
    const url = request.url ?? ''
    if (!url.startsWith(TERMINAL_PATH)) return // Handled by Next (hot reload).

    const authorized = authorize(request)
    if (!authorized) {
      logger.warn('Terminal connection rejected', { url })
      reject(socket, 401, 'Unauthorized')
      return
    }

    wss.handleUpgrade(request, socket, head, (socket_) => {
      wss.emit('connection', socket_, request, authorized)
    })
  })

  wss.on('connection', (socket: WebSocket, _request: IncomingMessage, authorized: Authorized) => {
    const db = getDb()
    const sink = makeSink(socket)

    if (!manager.attach(db, authorized.sessionId, authorized.userId, sink)) {
      socket.close(1011, 'That session is no longer available')
      return
    }

    let alive = true
    socket.on('pong', () => {
      alive = true
    })
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate()
        return
      }
      alive = false
      socket.ping()
    }, PING_INTERVAL_MS)
    heartbeat.unref?.()

    socket.on('message', (raw, isBinary) => {
      if (isBinary) return

      let payload: unknown
      try {
        payload = JSON.parse(raw.toString('utf8'))
      } catch {
        return
      }

      const parsed = clientMessageSchema.safeParse(payload)
      if (!parsed.success) {
        sink.notify({ type: 'error', message: 'Mensaje no valido' })
        return
      }

      const message = parsed.data
      if (message.type === 'input') {
        manager.write(db, authorized.sessionId, authorized.userId, message.data)
      } else if (message.type === 'resize') {
        manager.resize(db, authorized.sessionId, authorized.userId, message.cols, message.rows)
      } else if (message.type === 'close') {
        manager.closeSession(db, authorized.sessionId, authorized.userId)
      }
    })

    socket.on('close', () => {
      clearInterval(heartbeat)
      // The SSH session is not closed: it suspends and can be resumed.
      manager.detach(db, authorized.sessionId, sink)
    })

    socket.on('error', (error: Error) => {
      logger.warn('Error on the terminal WebSocket', {
        sessionId: authorized.sessionId,
        error: error.message,
      })
    })
  })

  return wss
}
