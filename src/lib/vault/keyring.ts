/**
 * In-memory keyring: maps each application session to the key that opens its
 * credential vault.
 *
 * Never persisted. It disappears when the server restarts, and stored
 * passwords are then unavailable until the user signs in again: that is the
 * price of the vault depending on their password.
 */
interface Keyring {
  readonly keys: Map<string, Buffer>
}

const globalKey = Symbol.for('ssh-web.vault-keyring')
const store = globalThis as unknown as Record<symbol, Keyring | undefined>
const state: Keyring = store[globalKey] ?? { keys: new Map<string, Buffer>() }
store[globalKey] = state

export function rememberKey(sessionId: string, key: Buffer): void {
  state.keys.set(sessionId, key)
}

export function keyFor(sessionId: string): Buffer | null {
  return state.keys.get(sessionId) ?? null
}

export function forgetKey(sessionId: string): void {
  const key = state.keys.get(sessionId)
  // Overwritten before being released, so it is not left floating in the heap.
  key?.fill(0)
  state.keys.delete(sessionId)
}
