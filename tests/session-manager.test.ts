import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'

// La conexion SSH real se sustituye por una doble: aqui se prueba la maquina
// de estados del gestor, no el protocolo, que cubre scripts/e2e-terminal.mjs.
const establishConnection = vi.fn()
vi.mock('#lib/ssh/connect', () => ({
  establishConnection,
  CONNECT_TIMEOUT_MS: 1000,
  HostKeyMismatchError: class extends Error {
    keyType: string | null = null
    fingerprint: string | null = null
  },
  MissingSecretError: class extends Error {},
}))

const { createTestDb } = await import('#lib/db/client')
const { createUser } = await import('#lib/repos/users')
const { findSession, listSessions } = await import('#lib/repos/sessions')
const manager = await import('#lib/ssh/session-manager')
type ResolvedHost = Parameters<typeof manager.openSession>[1]

// El host ya no sale de la base de datos: viene resuelto de ~/.ssh/config.
const HOST: ResolvedHost = Object.freeze({
  alias: 'target',
  hostname: '10.0.0.10',
  user: 'debian',
  port: 22,
  identityFile: null,
  extra: Object.freeze({}),
})

class FakeStream extends EventEmitter {
  written: string[] = []
  ended = false
  window: readonly number[] | null = null
  stderr = new EventEmitter()

  write(data: string): boolean {
    this.written.push(data)
    return true
  }

  end(): void {
    this.ended = true
  }

  setWindow(rows: number, cols: number): void {
    this.window = [rows, cols]
  }
}

class FakeClient extends EventEmitter {
  ended = false
  end(): void {
    this.ended = true
  }
}

function collector() {
  const chunks: Buffer[] = []
  const events: unknown[] = []
  const terminations: string[] = []
  return {
    sink: {
      deliver: (chunk: Buffer) => chunks.push(chunk),
      notify: (event: unknown) => events.push(event),
      terminate: (reason: string) => terminations.push(reason),
    },
    text: () => Buffer.concat(chunks).toString('utf8'),
    events,
    terminations,
  }
}

let db: DatabaseSync
let userId: string
let otherUserId: string
let stream: FakeStream
let client: FakeClient

beforeEach(async () => {
  db = createTestDb()
  userId = (await createUser(db, 'operator', 'test-password-1')).id
  otherUserId = (await createUser(db, 'stranger', 'test-password-2')).id

  stream = new FakeStream()
  client = new FakeClient()
  establishConnection.mockReset()
  establishConnection.mockResolvedValue({ client, stream, fingerprint: 'SHA256:falsa' })
})

afterEach(() => {
  manager.shutdown(db)
})

const open = () => manager.openSession(db, HOST, { userId, clientIp: '127.0.0.1', cols: 80, rows: 24 })

describe('opening a session', () => {
  it('leaves the session live in the process, awaiting a client', async () => {
    const id = await open()
    expect(findSession(db, id, userId)?.status).toBe('suspended')
    expect(manager.isLive(id, userId)).toBe(true)
    expect(manager.liveSessionIds(userId).has(id)).toBe(true)
  })

  it('refuses to open more sessions than the limit per user', async () => {
    const fresh = () => {
      establishConnection.mockResolvedValueOnce({ client: new FakeClient(), stream: new FakeStream() })
      return open()
    }
    for (let count = 0; count < manager.maxSessionsPerUser(); count += 1) await fresh()

    await expect(open()).rejects.toBeInstanceOf(manager.SessionLimitError)
    // The limit is per user: someone else can still connect.
    establishConnection.mockResolvedValueOnce({ client: new FakeClient(), stream: new FakeStream() })
    await expect(
      manager.openSession(db, HOST, { userId: otherUserId, clientIp: null, cols: 80, rows: 24 }),
    ).resolves.toBeTypeOf('string')
  })

  it('counts connections still being established towards the limit', async () => {
    // Otherwise a burst of parallel requests would all pass the check before
    // any of them had registered as live.
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    establishConnection.mockImplementation(async () => {
      await gate
      return { client: new FakeClient(), stream: new FakeStream() }
    })

    const limit = manager.maxSessionsPerUser()
    const burst = Array.from({ length: limit + 3 }, () => open())
    const settled = Promise.allSettled(burst)
    release()

    const results = await settled
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(limit)
    expect(
      results.filter(
        (result) => result.status === 'rejected' && result.reason instanceof manager.SessionLimitError,
      ),
    ).toHaveLength(3)
  })

  it('frees the reserved slot when a connection fails', async () => {
    establishConnection.mockRejectedValue(new Error('connection refused'))
    for (let count = 0; count < manager.maxSessionsPerUser() + 2; count += 1) {
      await expect(open()).rejects.toThrow('connection refused')
    }
  })

  it('passes the terminal size to the connection', async () => {
    await manager.openSession(db, HOST, { userId, clientIp: null, cols: 120, rows: 40 })
    expect(establishConnection).toHaveBeenCalledWith(HOST, { cols: 120, rows: 40 }, {})
  })

  it('forwards the typed secret without storing it anywhere', async () => {
    await manager.openSession(db, HOST, {
      userId,
      clientIp: null,
      cols: 80,
      rows: 24,
      secrets: { password: 'typed-password' },
    })

    expect(establishConnection).toHaveBeenCalledWith(HOST, { cols: 80, rows: 24 }, {
      password: 'typed-password',
    })

    // El secreto no debe aparecer en ninguna tabla.
    const volcado = ['ssh_sessions', 'audit_log']
      .map((table) => JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all()))
      .join(' ')
    expect(volcado).not.toContain('typed-password')
  })

  it('marks the session as failed when the connection is not established', async () => {
    establishConnection.mockRejectedValue(new Error('connection refused'))
    await expect(open()).rejects.toThrow('connection refused')

    const [session] = listSessions(db, userId, new Set())
    expect(session?.status).toBe('failed')
    expect(session?.closeReason).toBe('connection refused')
    expect(manager.liveSessionIds(userId).size).toBe(0)
  })

  it('does not expose the session to another user', async () => {
    const id = await open()
    expect(manager.isLive(id, otherUserId)).toBe(false)
    expect(manager.liveSessionIds(otherUserId).size).toBe(0)
  })
})

describe('attaching and resuming', () => {
  it('delivers output to the attached clients', async () => {
    const id = await open()
    const first = collector()
    manager.attach(db, id, userId, first.sink)

    stream.emit('data', Buffer.from('hola '))
    stream.stderr.emit('data', Buffer.from('mundo'))

    expect(first.text()).toBe('hola mundo')
    expect(first.events).toContainEqual({ type: 'status', status: 'active' })
  })

  it('repaints the retained output on re-attach', async () => {
    const id = await open()
    const first = collector()
    manager.attach(db, id, userId, first.sink)
    stream.emit('data', Buffer.from('earlier-output'))
    manager.detach(db, id, first.sink)

    expect(findSession(db, id, userId)?.status).toBe('suspended')

    const second = collector()
    expect(manager.attach(db, id, userId, second.sink)).toBe(true)
    expect(second.text()).toBe('earlier-output')
    expect(findSession(db, id, userId)?.status).toBe('active')
  })

  it('broadcasts to several clients at once', async () => {
    const id = await open()
    const a = collector()
    const b = collector()
    manager.attach(db, id, userId, a.sink)
    manager.attach(db, id, userId, b.sink)

    stream.emit('data', Buffer.from('shared'))
    expect(a.text()).toBe('shared')
    expect(b.text()).toBe('shared')
  })

  it('stays active while any client remains', async () => {
    const id = await open()
    const a = collector()
    const b = collector()
    manager.attach(db, id, userId, a.sink)
    manager.attach(db, id, userId, b.sink)

    manager.detach(db, id, a.sink)
    expect(findSession(db, id, userId)?.status).toBe('active')
  })

  it('drops a client that fails to receive', async () => {
    const id = await open()
    const broken = {
      deliver: () => {
        throw new Error('socket closed')
      },
      notify: () => undefined,
      terminate: () => undefined,
    }
    manager.attach(db, id, userId, broken)
    expect(() => stream.emit('data', Buffer.from('x'))).not.toThrow()
  })

  it('the buffer does not grow without bound', async () => {
    const id = await open()
    // El entorno de pruebas fija 8 KB de retencion.
    for (let i = 0; i < 200; i += 1) stream.emit('data', Buffer.alloc(1024, 97))

    const sink = collector()
    manager.attach(db, id, userId, sink.sink)
    expect(sink.text().length).toBeLessThanOrEqual(8 * 1024)
  })

  it('refuses to attach to foreign or nonexistent sessions', async () => {
    const id = await open()
    expect(manager.attach(db, id, otherUserId, collector().sink)).toBe(false)
    expect(manager.attach(db, 'does-not-exist', userId, collector().sink)).toBe(false)
  })

  it('detaching from something nonexistent does not break', () => {
    expect(() => manager.detach(db, 'does-not-exist', collector().sink)).not.toThrow()
  })
})

describe('input and size', () => {
  it('forwards input to the remote shell', async () => {
    const id = await open()
    expect(manager.write(db, id, userId, 'ls -la\n')).toBe(true)
    expect(stream.written).toEqual(['ls -la\n'])
  })

  it('does not accept input from another user', async () => {
    const id = await open()
    expect(manager.write(db, id, otherUserId, 'rm -rf /\n')).toBe(false)
    expect(stream.written).toEqual([])
  })

  it('propagates the resize and persists it', async () => {
    const id = await open()
    expect(manager.resize(db, id, userId, 132, 43)).toBe(true)
    expect(stream.window).toEqual([43, 132])

    const row = db.prepare('SELECT cols, rows FROM ssh_sessions WHERE id = ?').get(id) as {
      cols: number
      rows: number
    }
    expect(row).toMatchObject({ cols: 132, rows: 43 })
  })

  it('does not resize a foreign session', async () => {
    const id = await open()
    expect(manager.resize(db, id, otherUserId, 200, 50)).toBe(false)
  })
})

describe('closing', () => {
  it('closes on user request and notifies the clients', async () => {
    const id = await open()
    const sink = collector()
    manager.attach(db, id, userId, sink.sink)

    expect(manager.closeSession(db, id, userId, 'end of test')).toBe(true)
    expect(findSession(db, id, userId)?.status).toBe('closed')
    expect(findSession(db, id, userId)?.closeReason).toBe('end of test')
    expect(sink.terminations).toEqual(['end of test'])
    expect(manager.isLive(id, userId)).toBe(false)
    expect(stream.ended && client.ended).toBe(true)
  })

  it('does not allow closing another user session', async () => {
    const id = await open()
    expect(manager.closeSession(db, id, otherUserId)).toBe(false)
    // Sigue viva y sin cambios: el intento ajeno no la toca.
    expect(findSession(db, id, userId)?.status).toBe('suspended')
    expect(manager.isLive(id, userId)).toBe(true)
  })

  it('closes when the remote shell exits', async () => {
    const id = await open()
    const sink = collector()
    manager.attach(db, id, userId, sink.sink)

    stream.emit('close', 0)
    expect(findSession(db, id, userId)?.status).toBe('closed')
    expect(sink.events).toContainEqual({ type: 'exit', code: 0 })
  })

  it('marks the session failed when the SSH client errors', async () => {
    const id = await open()
    const sink = collector()
    manager.attach(db, id, userId, sink.sink)

    client.emit('error', new Error('the connection was lost'))
    const session = findSession(db, id, userId)
    expect(session?.status).toBe('failed')
    expect(session?.closeReason).toBe('the connection was lost')
    expect(sink.events).toContainEqual({ type: 'error', message: 'the connection was lost' })
  })

  it('a write after closing does not reach the shell', async () => {
    const id = await open()
    manager.closeSession(db, id, userId)
    expect(manager.write(db, id, userId, 'too late\n')).toBe(false)
  })

  it('shutdown closes every live session', async () => {
    const a = await open()
    stream = new FakeStream()
    client = new FakeClient()
    establishConnection.mockResolvedValue({ client, stream, fingerprint: 'SHA256:falsa' })
    const b = await open()

    manager.shutdown(db)
    expect(manager.liveSessionIds(userId).size).toBe(0)
    for (const id of [a, b]) {
      expect(findSession(db, id, userId)?.closeReason).toBe('The server is shutting down')
    }
  })
})

describe('lifecycle audit trail', () => {
  it('leaves a trail of open, attach, detach and close', async () => {
    const id = await open()
    const sink = collector()
    manager.attach(db, id, userId, sink.sink)
    manager.detach(db, id, sink.sink)
    manager.closeSession(db, id, userId)

    const actions = (
      db.prepare('SELECT action FROM audit_log ORDER BY id').all() as unknown as ReadonlyArray<{
        action: unknown
      }>
    ).map((row) => String(row.action))

    expect(actions).toEqual([
      'session.opened',
      'session.attached',
      'session.detached',
      'session.closed',
    ])
  })
})

describe('server key events', () => {
  const actions = () =>
    (db.prepare('SELECT action, detail FROM audit_log ORDER BY id').all() as unknown as ReadonlyArray<{
      action: unknown
      detail: unknown
    }>).map((row) => ({ action: String(row.action), detail: String(row.detail) }))

  const firstUse = { keyType: 'ssh-ed25519', fingerprint: 'SHA256:abc', firstUse: true }

  it('records in the audit trail that a new server key was pinned', async () => {
    establishConnection.mockResolvedValue({ client, stream, hostKey: firstUse })
    await open()
    expect(actions()).toContainEqual({
      action: 'hostkey.pinned',
      detail: 'target (10.0.0.10:22): ssh-ed25519 SHA256:abc',
    })
  })

  it('does not record a pin for a host that was already known', async () => {
    establishConnection.mockResolvedValue({
      client,
      stream,
      hostKey: { ...firstUse, firstUse: false },
    })
    await open()
    expect(actions().map((entry) => entry.action)).not.toContain('hostkey.pinned')
  })

  it('tells the first client that attaches about the pinned key, once', async () => {
    establishConnection.mockResolvedValue({ client, stream, hostKey: firstUse })
    const id = await open()

    const first = collector()
    manager.attach(db, id, userId, first.sink)
    expect(first.events).toContainEqual({
      type: 'hostkey',
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:abc',
    })

    const second = collector()
    manager.attach(db, id, userId, second.sink)
    expect(second.events.some((event) => (event as { type: string }).type === 'hostkey')).toBe(false)
  })

  it('records a server key change in the audit trail', async () => {
    const { HostKeyMismatchError } = await import('#lib/ssh/connect')
    const error = Object.assign(new HostKeyMismatchError('10.0.0.10'), {
      keyType: 'ssh-rsa',
      fingerprint: 'SHA256:intruder',
    })
    establishConnection.mockRejectedValue(error)

    await expect(open()).rejects.toBe(error)
    expect(actions()).toContainEqual({
      action: 'hostkey.mismatch',
      detail: 'target (10.0.0.10:22) presented ssh-rsa SHA256:intruder',
    })
  })
})

describe('asking for a secret', () => {
  it('leaves no failed-session trace when asking for the password', async () => {
    // Pedir un secreto es una condicion previa, no un intento de conexion:
    // no debe ensuciar el historial ni la auditoria.
    const { MissingSecretError } = await import('#lib/ssh/connect')
    establishConnection.mockRejectedValue(new MissingSecretError('password'))

    await expect(open()).rejects.toThrow()

    expect(listSessions(db, userId, new Set())).toHaveLength(0)
    const events = db.prepare('SELECT count(*) AS n FROM audit_log').get() as { n: number }
    expect(events.n).toBe(0)
  })

  it('a real failure is recorded', async () => {
    establishConnection.mockRejectedValue(new Error('connection refused'))
    await expect(open()).rejects.toThrow()

    const [sesion] = listSessions(db, userId, new Set())
    expect(sesion?.status).toBe('failed')
  })
})

describe('initial session state', () => {
  it('is born suspended: connected but nobody watching', async () => {
    const id = await open()
    // "active" debe significar que hay alguien enganchado, no solo que la
    // conexion existe. Si no, el panel miente sobre lo que esta pasando.
    expect(findSession(db, id, userId)?.status).toBe('suspended')
  })

  it('becomes active as soon as somebody attaches', async () => {
    const id = await open()
    manager.attach(db, id, userId, collector().sink)
    expect(findSession(db, id, userId)?.status).toBe('active')
  })

  it('goes back to suspended when the last client detaches', async () => {
    const id = await open()
    const sink = collector().sink
    manager.attach(db, id, userId, sink)
    manager.detach(db, id, sink)
    expect(findSession(db, id, userId)?.status).toBe('suspended')
  })
})
