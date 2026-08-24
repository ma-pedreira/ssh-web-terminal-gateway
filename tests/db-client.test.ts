import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createTestDb, migrate } from '#lib/db/client'
import { MIGRATIONS } from '#lib/db/migrations'

describe('database client', () => {
  it('applies the migrations and is idempotent', () => {
    const db = new DatabaseSync(':memory:')
    const first = migrate(db)
    expect(first).toEqual(MIGRATIONS.map((migration) => migration.name))
    expect(migrate(db)).toEqual([])
  })

  it('records what was applied in schema_migrations', () => {
    const db = createTestDb()
    const row = db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }
    expect(row.n).toBe(MIGRATIONS.length)
  })

  it('creates every domain table', () => {
    const db = createTestDb()
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as ReadonlyArray<{
        name: unknown
      }>
    ).map((row) => String(row.name))

    for (const table of [
      'users',
      'app_sessions',
      'ssh_sessions',
      'audit_log',
      'login_attempts',
    ]) {
      expect(names).toContain(table)
    }
  })

  it('no table of secrets or inventory is left', () => {
    const db = createTestDb()
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as ReadonlyArray<{
        name: unknown
      }>
    ).map((row) => String(row.name))

    // El inventario vive en ~/.ssh/config y la aplicacion no guarda secretos.
    for (const table of ['hosts', 'credentials', 'known_hosts']) {
      expect(names).not.toContain(table)
    }
  })

  it('enables foreign keys', () => {
    const db = createTestDb()
    expect(() =>
      db
        .prepare(
          `INSERT INTO ssh_sessions (id, user_id, host_alias, hostname, port, status)
           VALUES ('s1', 'usuario-inexistente', 'a', 'h', 22, 'active')`,
        )
        .run(),
    ).toThrow()
  })

  it('rejects session states outside the allowed set', () => {
    const db = createTestDb()
    expect(() =>
      db
        .prepare(
          `INSERT INTO ssh_sessions (id, user_id, host_alias, hostname, port, status)
           VALUES ('s1', 'u1', 'a', 'h', 22, 'made-up')`,
        )
        .run(),
    ).toThrow()
  })

  it('rolls back the transaction when a migration fails', () => {
    const db = new DatabaseSync(':memory:')
    // Una tabla que choca con la migracion fuerza el error.
    db.exec('CREATE TABLE users (id TEXT)')
    expect(() => migrate(db)).toThrow(/001_init/)
    const applied = db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }
    expect(applied.n).toBe(0)
  })
})
