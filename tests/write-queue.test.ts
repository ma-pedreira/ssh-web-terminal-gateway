import { describe, expect, it } from 'vitest'
import { TerminalWriteQueue } from '@/client/write-queue'

describe('terminal write queue', () => {
  it('holds what arrives before the terminal exists', () => {
    const queue = new TerminalWriteQueue()
    queue.push('history')
    expect(queue.pendingCount).toBe(1)
  })

  it('flushes what was held when the terminal attaches', () => {
    const queue = new TerminalWriteQueue()
    queue.push('first')
    queue.push('second')

    const written: string[] = []
    queue.attach((data) => written.push(data))

    expect(written).toEqual(['first', 'second'])
    expect(queue.pendingCount).toBe(0)
  })

  it('keeps the order between held and later output', () => {
    const queue = new TerminalWriteQueue()
    queue.push('one')

    const written: string[] = []
    queue.attach((data) => written.push(data))
    queue.push('two')

    expect(written).toEqual(['one', 'two'])
  })

  it('writes directly once a terminal exists', () => {
    const queue = new TerminalWriteQueue()
    const written: string[] = []
    queue.attach((data) => written.push(data))

    queue.push('direct')
    expect(written).toEqual(['direct'])
    expect(queue.pendingCount).toBe(0)
  })

  it('holds again if the terminal detaches', () => {
    const queue = new TerminalWriteQueue()
    const written: string[] = []
    queue.attach((data) => written.push(data))
    queue.push('before')

    queue.detach()
    queue.push('during')

    expect(written).toEqual(['before'])
    expect(queue.pendingCount).toBe(1)
  })

  it('ignores empty chunks', () => {
    const queue = new TerminalWriteQueue()
    queue.push('')
    expect(queue.pendingCount).toBe(0)
  })

  it('does not grow without bound if the terminal never arrives', () => {
    const queue = new TerminalWriteQueue(1024)
    for (let i = 0; i < 500; i += 1) queue.push('x'.repeat(100))
    expect(queue.pendingBytes).toBeLessThanOrEqual(1024)
  })

  it('when trimming it keeps the tail, the most recently seen output', () => {
    const queue = new TerminalWriteQueue(10)
    queue.push('oldddddddddddddd')
    queue.push('new')

    const written: string[] = []
    queue.attach((data) => written.push(data))
    expect(written.join('')).toContain('new')
    expect(written.join('')).not.toContain('oldddddddddddddd')
  })

  it('a write failure does not lose the rest', () => {
    const queue = new TerminalWriteQueue()
    queue.push('one')
    queue.push('two')

    const written: string[] = []
    let first = true
    expect(() =>
      queue.attach((data) => {
        if (first) {
          first = false
          throw new Error('terminal not ready')
        }
        written.push(data)
      }),
    ).not.toThrow()

    expect(written).toEqual(['two'])
  })
})
