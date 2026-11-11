import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { createTestDb } from '#lib/db/client'
import { createUser } from '#lib/repos/users'
import { confirmPassword } from '#lib/auth/reauth'
import { MAX_ATTEMPTS } from '#lib/auth/rate-limit'
import type { User } from '#types'

let db: DatabaseSync
let user: User

beforeEach(async () => {
  db = createTestDb()
  user = await createUser(db, 'operator', 'correct-password-1')
})

describe('confirmPassword', () => {
  it('accepts the right password', async () => {
    await expect(confirmPassword(db, user, 'correct-password-1')).resolves.toBeUndefined()
  })

  it('rejects a wrong password with 403', async () => {
    await expect(confirmPassword(db, user, 'nope')).rejects.toMatchObject({ status: 403 })
  })

  it('blocks further attempts after too many failures, even with the right password', async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await expect(confirmPassword(db, user, 'nope')).rejects.toMatchObject({ status: 403 })
    }
    await expect(confirmPassword(db, user, 'correct-password-1')).rejects.toMatchObject({ status: 429 })
  })

  it('does not lock the sign-in form: the counters are separate', async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await expect(confirmPassword(db, user, 'nope')).rejects.toBeDefined()
    }
    const row = db
      .prepare('SELECT count(*) AS n FROM login_attempts WHERE identifier = ?')
      .get(user.username) as { n: number }
    expect(row.n).toBe(0)
  })

  it('forgets earlier failures after a success', async () => {
    await expect(confirmPassword(db, user, 'nope')).rejects.toBeDefined()
    await confirmPassword(db, user, 'correct-password-1')
    const row = db.prepare('SELECT count(*) AS n FROM login_attempts').get() as { n: number }
    expect(row.n).toBe(0)
  })
})
