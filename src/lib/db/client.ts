import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getEnv } from '#lib/env'
import { defaultDataDir } from '#lib/platform'
import { logger } from '#lib/logger'
import { MIGRATIONS } from '#lib/db/migrations'

let instance: DatabaseSync | null = null

function applyPragmas(db: DatabaseSync): void {
  // WAL: concurrent reads without blocking the active session's writes.
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec('PRAGMA temp_store = MEMORY')
}

function ensureMigrationsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    ) STRICT
  `)
}

/** Applies any missing migrations in order. Idempotent. */
export function migrate(db: DatabaseSync): readonly string[] {
  ensureMigrationsTable(db)

  const applied = new Set(
    db
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((row) => String((row as { name: unknown }).name)),
  )

  const pending = MIGRATIONS.filter((migration) => !applied.has(migration.name))
  const record = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)')

  for (const migration of pending) {
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      record.run(migration.name)
      db.exec('COMMIT')
      logger.info('Migration applied', { migration: migration.name })
    } catch (error) {
      db.exec('ROLLBACK')
      throw new Error(`Migration ${migration.name} failed`, { cause: error })
    }
  }

  return Object.freeze(pending.map((migration) => migration.name))
}

/** Opens the database, migrates it and memoises the connection for the process. */
export function getDb(): DatabaseSync {
  if (instance) return instance

  const path = getEnv().SSH_WEB_DB_PATH ?? join(defaultDataDir(), 'ssh-web.db')
  mkdirSync(dirname(path), { recursive: true })

  const db = new DatabaseSync(path)
  applyPragmas(db)
  migrate(db)

  instance = db
  return instance
}

/** Creates an already-migrated in-memory database, for tests. */
export function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

/** Closes the memoised connection. Used when shutting the server down. */
export function closeDb(): void {
  instance?.close()
  instance = null
}
