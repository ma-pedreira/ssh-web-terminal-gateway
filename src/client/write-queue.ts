'use client'

const DEFAULT_LIMIT = 1024 * 1024

type Writer = (data: string) => void

/**
 * Holds output that arrives before the terminal exists.
 *
 * The server sends the whole history as soon as the WebSocket connects, but
 * xterm is loaded with a dynamic import(): without buffering, the first time
 * round (cold cache, slow download) the history arrives before the terminal
 * and is lost entirely.
 */
export class TerminalWriteQueue {
  private pending: string[] = []
  private bytes = 0
  private writer: Writer | null = null
  private readonly limit: number

  constructor(limit: number = DEFAULT_LIMIT) {
    this.limit = limit
  }

  get pendingCount(): number {
    return this.pending.length
  }

  get pendingBytes(): number {
    return this.bytes
  }

  push(data: string): void {
    if (data.length === 0) return

    if (this.writer) {
      this.writer(data)
      return
    }

    this.pending = [...this.pending, data]
    this.bytes += data.length
    this.trim()
  }

  /** Attaches the terminal and flushes what was held, in order. */
  attach(writer: Writer): void {
    this.writer = writer

    const held = this.pending
    this.pending = []
    this.bytes = 0

    for (const data of held) {
      try {
        writer(data)
      } catch {
        // A failure writing one chunk must not drop the rest.
      }
    }
  }

  detach(): void {
    this.writer = null
  }

  /** If the terminal never arrives, the tail is kept: the most recent output. */
  private trim(): void {
    while (this.bytes > this.limit && this.pending.length > 1) {
      const [first, ...rest] = this.pending
      this.bytes -= first?.length ?? 0
      this.pending = rest
    }

    const only = this.pending[0]
    if (this.pending.length === 1 && only && only.length > this.limit) {
      const trimmed = only.slice(only.length - this.limit)
      this.pending = [trimmed]
      this.bytes = trimmed.length
    }
  }
}
