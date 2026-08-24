import { describe, expect, it } from 'vitest'
import { RingBuffer } from '#lib/ssh/ring-buffer'

describe('RingBuffer', () => {
  it('preserves arrival order', () => {
    const buffer = new RingBuffer(64)
    buffer.push(Buffer.from('hello '))
    buffer.push(Buffer.from('world'))
    expect(buffer.snapshot().toString()).toBe('hello world')
    expect(buffer.byteLength).toBe(11)
  })

  it('drops the oldest data when it hits the cap', () => {
    const buffer = new RingBuffer(10)
    buffer.push(Buffer.from('abcdefghij'))
    buffer.push(Buffer.from('KLM'))
    expect(buffer.byteLength).toBe(10)
    expect(buffer.snapshot().toString()).toBe('defghijKLM')
  })

  it('trims a chunk larger than the cap and keeps the tail', () => {
    const buffer = new RingBuffer(5)
    buffer.push(Buffer.from('0123456789'))
    expect(buffer.byteLength).toBe(5)
    expect(buffer.snapshot().toString()).toBe('56789')
  })

  it('never exceeds capacity across many writes', () => {
    const buffer = new RingBuffer(32)
    for (let i = 0; i < 500; i += 1) {
      buffer.push(Buffer.from(`line-${i}\n`))
      expect(buffer.byteLength).toBeLessThanOrEqual(32)
    }
    expect(buffer.snapshot().toString()).toContain('line-499')
  })

  it('ignores empty chunks', () => {
    const buffer = new RingBuffer(8)
    buffer.push(Buffer.alloc(0))
    expect(buffer.byteLength).toBe(0)
  })

  it('can be cleared', () => {
    const buffer = new RingBuffer(8)
    buffer.push(Buffer.from('data'))
    buffer.clear()
    expect(buffer.byteLength).toBe(0)
    expect(buffer.snapshot().toString()).toBe('')
  })

  it('requires a positive capacity', () => {
    expect(() => new RingBuffer(0)).toThrow(/capacity/i)
    expect(() => new RingBuffer(-1)).toThrow(/capacity/i)
  })

  it('exposes the configured capacity', () => {
    expect(new RingBuffer(128).capacity).toBe(128)
  })
})
