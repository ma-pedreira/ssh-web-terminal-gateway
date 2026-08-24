import { timingSafeEqual } from 'node:crypto'

/** Constant-time comparison for values of the same purpose. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.byteLength !== right.byteLength) return false
  return timingSafeEqual(left, right)
}
