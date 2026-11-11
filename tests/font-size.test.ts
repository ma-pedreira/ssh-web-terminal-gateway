import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  parseFontSize,
  stepFontSize,
} from '@/client/font-size'

describe('stepFontSize', () => {
  it('grows and shrinks one point at a time', () => {
    expect(stepFontSize(13, 1)).toBe(14)
    expect(stepFontSize(13, -1)).toBe(12)
  })

  it('stays within the readable range', () => {
    expect(stepFontSize(MAX_FONT_SIZE, 1)).toBe(MAX_FONT_SIZE)
    expect(stepFontSize(MIN_FONT_SIZE, -1)).toBe(MIN_FONT_SIZE)
  })
})

describe('parseFontSize', () => {
  it('reads a stored size', () => {
    expect(parseFontSize('16')).toBe(16)
  })

  it('falls back to the default for anything unusable', () => {
    expect(parseFontSize(null)).toBe(DEFAULT_FONT_SIZE)
    expect(parseFontSize('')).toBe(DEFAULT_FONT_SIZE)
    expect(parseFontSize('huge')).toBe(DEFAULT_FONT_SIZE)
    expect(parseFontSize('13.5')).toBe(DEFAULT_FONT_SIZE)
  })

  it('brings an out-of-range stored value back into range', () => {
    expect(parseFontSize('400')).toBe(MAX_FONT_SIZE)
    expect(parseFontSize('1')).toBe(MIN_FONT_SIZE)
  })
})
