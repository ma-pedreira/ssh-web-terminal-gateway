import { describe, expect, it } from 'vitest'
import { bufferToText, type BufferLike } from '@/client/terminal-text'

function buffer(lines: ReadonlyArray<string | readonly [string, boolean]>): BufferLike {
  const rows = lines.map((line) => (typeof line === 'string' ? ([line, false] as const) : line))
  return {
    length: rows.length,
    getLine(index) {
      const row = rows[index]
      if (!row) return undefined
      const [text, isWrapped] = row
      return {
        isWrapped,
        translateToString: (trimRight?: boolean) => (trimRight ? text.replace(/\s+$/, '') : text),
      }
    },
  }
}

describe('bufferToText', () => {
  it('joins lines with newlines and trims trailing spaces', () => {
    expect(bufferToText(buffer(['$ ls   ', 'a  b'] ))).toBe('$ ls\na  b')
  })

  it('rejoins lines the terminal wrapped', () => {
    expect(bufferToText(buffer(['abc', ['def', true], 'next']))).toBe('abcdef\nnext')
  })

  it('drops the empty rows below the cursor', () => {
    expect(bufferToText(buffer(['prompt$', '', '   ', '']))).toBe('prompt$')
  })

  it('keeps only the last lines when asked', () => {
    expect(bufferToText(buffer(['1', '2', '3', '4']), 2)).toBe('3\n4')
  })

  it('returns an empty string for an empty buffer', () => {
    expect(bufferToText(buffer([]))).toBe('')
  })
})
