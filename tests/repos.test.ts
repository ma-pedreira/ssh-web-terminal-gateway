import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { createTestDb } from '#lib/db/client'
import { countUsers, createUser, findUserById, findUserWithHash } from '#lib/repos/users'
import { listRecent, record } from '#lib/repos/audit'
import * as sessions from '#lib/repos/sessions'
import type { User } from '#types'

let db: DatabaseSync
let user: User

beforeEach(async () => {
  db = createTestDb()
  user = await createUser(db, 'operator', 'test-password-1')
})

describe('users', () => {
  it('creates the user and counts it', () => {
    expect(countUsers(db)).toBe(1)
    expect(user.username).toBe('operator')
  })

  it('normalises the name to lower case', async () => {
    await createUser(db, 'UPPERCASE', 'test-password-2')
    expect(findUserWithHash(db, 'uppercase')).not.toBeNull()
    expect(findUserWithHash(db, 'UPPERCASE')).not.toBeNull()
  })

  it('prevents duplicate names', async () => {
    await expect(createUser(db, 'operator', 'test-password-3')).rejects.toThrow()
  })

  it('returns null for a nonexistent user', () => {
    expect(findUserById(db, 'does-not-exist')).toBeNull()
    expect(findUserWithHash(db, 'ghost')).toBeNull()
  })
})

describe('SSH sessions', () => {
  const open = () =>
    sessions.openSession(db, {
      userId: user.id,
      hostAlias: 'home-server',
      hostname: '192.168.0.50',
      hostUser: 'debian',
      port: 2222,
      clientIp: '127.0.0.1',
      cols: 80,
      rows: 24,
    })

  it('starts in the connecting state', () => {
    expect(open().status).toBe('connecting')
  })

  it('keeps a copy of the host data for the history', () => {
    const session = open()
    expect(session).toMatchObject({
      hostAlias: 'home-server',
      hostname: '192.168.0.50',
      hostUser: 'debian',
      port: 2222,
    })
  })

  it('the history survives the host disappearing from the file', () => {
    const session = open()
    // No hay clave ajena a ninguna tabla de hosts: el fichero puede cambiar.
    expect(sessions.findSession(db, session.id, user.id)?.hostAlias).toBe('home-server')
  })

  it('closes recording the exit code and reason', () => {
    const session = open()
    sessions.setStatus(db, session.id, 'closed', { exitCode: 0, closeReason: 'fin' })
    const closed = sessions.findSession(db, session.id, user.id)
    expect(closed).toMatchObject({ status: 'closed', exitCode: 0, closeReason: 'fin' })
    expect(closed?.endedAt).not.toBeNull()
  })

  it('does not expose other users sessions', async () => {
    const session = open()
    const other = await createUser(db, 'nosy', 'test-password-6')
    expect(sessions.findSession(db, session.id, other.id)).toBeNull()
  })

  it('marks as resumable only what is still live', () => {
    const live = open()
    const dead = open()
    sessions.setStatus(db, dead.id, 'closed')

    const list = sessions.listSessions(db, user.id, new Set([live.id]))
    expect(list.find((s) => s.id === live.id)?.resumable).toBe(true)
    expect(list.find((s) => s.id === dead.id)?.resumable).toBe(false)
  })

  it('stores the terminal size', () => {
    const session = open()
    sessions.setViewport(db, session.id, 120, 40)
    const row = db.prepare('SELECT cols, rows FROM ssh_sessions WHERE id = ?').get(session.id) as {
      cols: number
      rows: number
    }
    expect(row).toMatchObject({ cols: 120, rows: 40 })
  })

  it('closes sessions orphaned by a restart', () => {
    open()
    open()
    expect(sessions.reconcileOrphans(db)).toBe(2)
    expect(sessions.listSessions(db, user.id, new Set()).every((s) => s.status === 'closed')).toBe(
      true,
    )
  })

  it('rejects states outside the allowed set', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO ssh_sessions (id, user_id, host_alias, hostname, port, status)
           VALUES ('x', ?, 'a', 'h', 22, 'made-up')`,
        )
        .run(user.id),
    ).toThrow()
  })
})

describe('audit log', () => {
  it('records and returns the user events', () => {
    record(db, { userId: user.id, action: 'session.opened', targetId: 'alias', detail: 'ok' })
    record(db, { userId: user.id, action: 'user.login', clientIp: '10.0.0.5' })
    const entries = listRecent(db, user.id)
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.action)).toContain('session.opened')
  })

  it('accepts events with no user', () => {
    record(db, { action: 'user.login.failed', detail: 'usuario desconocido' })
    const row = db.prepare('SELECT user_id FROM audit_log').get() as { user_id: string | null }
    expect(row.user_id).toBeNull()
  })
})

describe('clearing the history', () => {
  function crear(estado: 'closed' | 'failed' | 'active' | 'suspended') {
    const s = sessions.openSession(db, {
      userId: user.id,
      hostAlias: 'docker',
      hostname: '10.0.0.1',
      hostUser: 'debian',
      port: 22,
      clientIp: null,
      cols: 80,
      rows: 24,
    })
    sessions.setStatus(db, s.id, estado)
    return s.id
  }

  it('deletes the finished sessions', () => {
    crear('closed')
    crear('failed')
    expect(sessions.deleteFinishedSessions(db, user.id)).toBe(2)
    expect(sessions.listSessions(db, user.id, new Set())).toHaveLength(0)
  })

  it('keeps the ones that are still live', () => {
    const live = crear('active')
    const suspendida = crear('suspended')
    crear('closed')

    expect(sessions.deleteFinishedSessions(db, user.id)).toBe(1)
    const remaining = sessions.listSessions(db, user.id, new Set()).map((s) => s.id)
    expect(remaining).toContain(live)
    expect(remaining).toContain(suspendida)
  })

  it('does not touch another user history', async () => {
    crear('closed')
    const other = await createUser(db, 'stranger', 'test-password-9')
    const theirs = sessions.openSession(db, {
      userId: other.id,
      hostAlias: 'otro',
      hostname: '10.0.0.2',
      hostUser: 'root',
      port: 22,
      clientIp: null,
      cols: 80,
      rows: 24,
    })
    sessions.setStatus(db, theirs.id, 'closed')

    expect(sessions.deleteFinishedSessions(db, user.id)).toBe(1)
    expect(sessions.listSessions(db, other.id, new Set())).toHaveLength(1)
  })

  it('deletes nothing when the history is empty', () => {
    expect(sessions.deleteFinishedSessions(db, user.id)).toBe(0)
  })
})
