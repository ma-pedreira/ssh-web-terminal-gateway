/**
 * Fixed-capacity ring buffer of bytes.
 * Retains the most recent terminal output so it can be repainted when the
 * browser re-attaches to a suspended session.
 */
export class RingBuffer {
  private chunks: readonly Buffer[] = []
  private size = 0
  private readonly capacityBytes: number

  constructor(capacityBytes: number) {
    if (capacityBytes <= 0) {
      throw new Error('The buffer capacity must be positive')
    }
    this.capacityBytes = capacityBytes
  }

  get byteLength(): number {
    return this.size
  }

  get capacity(): number {
    return this.capacityBytes
  }

  push(chunk: Buffer): void {
    if (chunk.byteLength === 0) return

    // A chunk larger than the cap is trimmed: only the tail matters.
    const incoming =
      chunk.byteLength > this.capacityBytes ? chunk.subarray(chunk.byteLength - this.capacityBytes) : chunk

    const next = [...this.chunks, incoming]
    let total = this.size + incoming.byteLength

    let start = 0
    while (total > this.capacityBytes && start < next.length) {
      const head = next[start]
      if (!head) break
      const excess = total - this.capacityBytes
      if (head.byteLength <= excess) {
        total -= head.byteLength
        start += 1
      } else {
        next[start] = head.subarray(excess)
        total -= excess
      }
    }

    this.chunks = Object.freeze(next.slice(start))
    this.size = total
  }

  /** A single copy of everything retained, in arrival order. */
  snapshot(): Buffer {
    return Buffer.concat(this.chunks as Buffer[], this.size)
  }

  clear(): void {
    this.chunks = []
    this.size = 0
  }
}
