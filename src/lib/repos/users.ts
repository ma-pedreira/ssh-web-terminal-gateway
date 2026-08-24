import type { DatabaseSync } from 'node:sqlite'
import { newId } from '#lib/crypto/tokens'
import { hashPassword } from '#lib/crypto/password'
import type { User } from '#types'

interface UserRow {
  id: string
  username: string
  password_hash: string
  created_at: string
  last_login_at: string | null
}

function toUser(row: UserRow): User {
  return Object.freeze({
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  })
}

export async function createUser(
  db: DatabaseSync,
  username: string,
  password: string,
): Promise<User> {
  const id = newId()
  const passwordHash = await hashPassword(password)
  db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run(
    id,
    username.toLowerCase(),
    passwordHash,
  )
  return findUserById(db, id) as User
}

export function findUserById(db: DatabaseSync, id: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  return row ? toUser(row) : null
}

/** Returns the whole row, hash included. Sign-in flow only. */
export function findUserWithHash(db: DatabaseSync, username: string): UserRow | null {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase()) as
    | UserRow
    | undefined
  return row ?? null
}

export function countUsers(db: DatabaseSync): number {
  const row = db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }
  return row.n
}

export function touchLastLogin(db: DatabaseSync, userId: string): void {
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId)
}
