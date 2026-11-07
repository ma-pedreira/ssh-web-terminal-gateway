import { describe, expect, it } from 'vitest'
import {
  applyModifiers,
  classifyClipboardKey,
  clampViewport,
  specialKeySequence,
  type KeyLike,
} from '@/client/terminal-keys'

const key = (overrides: Partial<KeyLike>): KeyLike => ({
  type: 'keydown',
  key: 'c',
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...overrides,
})

describe('classifyClipboardKey', () => {
  it('copies with Ctrl+Shift+C', () => {
    expect(classifyClipboardKey(key({ key: 'C', ctrlKey: true, shiftKey: true }), false)).toBe('copy')
  })

  it('copies with Ctrl+C only when there is a selection', () => {
    expect(classifyClipboardKey(key({ ctrlKey: true }), true)).toBe('copy')
    expect(classifyClipboardKey(key({ ctrlKey: true }), false)).toBeNull()
  })

  it('copies with Cmd+C on macOS', () => {
    expect(classifyClipboardKey(key({ metaKey: true }), true)).toBe('copy')
  })

  it('pastes with Ctrl+Shift+V and Cmd+V, but leaves plain Ctrl+V to the shell', () => {
    expect(classifyClipboardKey(key({ key: 'V', ctrlKey: true, shiftKey: true }), false)).toBe('paste')
    expect(classifyClipboardKey(key({ key: 'v', metaKey: true }), false)).toBe('paste')
    expect(classifyClipboardKey(key({ key: 'v', ctrlKey: true }), false)).toBeNull()
  })

  it('pastes with Shift+Insert', () => {
    expect(classifyClipboardKey(key({ key: 'Insert', shiftKey: true }), false)).toBe('paste')
  })

  it('ignores keyup events and unrelated keys', () => {
    expect(classifyClipboardKey(key({ type: 'keyup', ctrlKey: true, shiftKey: true }), true)).toBeNull()
    expect(classifyClipboardKey(key({ key: 'x', ctrlKey: true }), true)).toBeNull()
    expect(classifyClipboardKey(key({ key: 'c' }), true)).toBeNull()
  })

  it('does not treat AltGr combinations as copy', () => {
    expect(classifyClipboardKey(key({ ctrlKey: true, altKey: true }), true)).toBeNull()
  })
})

describe('applyModifiers', () => {
  it('returns the data untouched without modifiers', () => {
    expect(applyModifiers('a', { ctrl: false, alt: false })).toBe('a')
  })

  it('turns letters into control characters, case-insensitively', () => {
    expect(applyModifiers('c', { ctrl: true, alt: false })).toBe('\x03')
    expect(applyModifiers('C', { ctrl: true, alt: false })).toBe('\x03')
    expect(applyModifiers('a', { ctrl: true, alt: false })).toBe('\x01')
    expect(applyModifiers('z', { ctrl: true, alt: false })).toBe('\x1a')
  })

  it('maps the punctuation that has a control code', () => {
    expect(applyModifiers('[', { ctrl: true, alt: false })).toBe('\x1b')
    expect(applyModifiers('\\', { ctrl: true, alt: false })).toBe('\x1c')
    expect(applyModifiers(']', { ctrl: true, alt: false })).toBe('\x1d')
    expect(applyModifiers(' ', { ctrl: true, alt: false })).toBe('\x00')
    expect(applyModifiers('@', { ctrl: true, alt: false })).toBe('\x00')
    expect(applyModifiers('?', { ctrl: true, alt: false })).toBe('\x7f')
  })

  it('leaves characters without a control code as they are', () => {
    expect(applyModifiers('1', { ctrl: true, alt: false })).toBe('1')
  })

  it('prefixes ESC for Alt', () => {
    expect(applyModifiers('b', { ctrl: false, alt: true })).toBe('\x1bb')
    expect(applyModifiers('c', { ctrl: true, alt: true })).toBe('\x1b\x03')
  })

  it('applies only to the first character of a longer chunk', () => {
    expect(applyModifiers('cd', { ctrl: true, alt: false })).toBe('\x03d')
  })

  it('handles an empty chunk', () => {
    expect(applyModifiers('', { ctrl: true, alt: true })).toBe('')
  })
})

describe('specialKeySequence', () => {
  it('sends normal-mode cursor keys by default', () => {
    expect(specialKeySequence('up', false)).toBe('\x1b[A')
    expect(specialKeySequence('down', false)).toBe('\x1b[B')
    expect(specialKeySequence('right', false)).toBe('\x1b[C')
    expect(specialKeySequence('left', false)).toBe('\x1b[D')
  })

  it('sends application-mode cursor keys when the remote asks for them', () => {
    expect(specialKeySequence('up', true)).toBe('\x1bOA')
    expect(specialKeySequence('left', true)).toBe('\x1bOD')
    expect(specialKeySequence('home', true)).toBe('\x1bOH')
  })

  it('maps the remaining keys', () => {
    expect(specialKeySequence('esc', false)).toBe('\x1b')
    expect(specialKeySequence('tab', false)).toBe('\t')
    expect(specialKeySequence('home', false)).toBe('\x1b[H')
    expect(specialKeySequence('end', false)).toBe('\x1b[F')
    expect(specialKeySequence('pgup', false)).toBe('\x1b[5~')
    expect(specialKeySequence('pgdn', false)).toBe('\x1b[6~')
  })
})

describe('clampViewport', () => {
  it('keeps sizes the server accepts', () => {
    expect(clampViewport(120, 40)).toEqual({ cols: 120, rows: 40 })
  })

  it('raises sizes below the server minimum', () => {
    expect(clampViewport(3, 1)).toEqual({ cols: 20, rows: 5 })
  })

  it('caps sizes above the server maximum', () => {
    expect(clampViewport(900, 900)).toEqual({ cols: 500, rows: 200 })
  })

  it('rejects sizes that are not usable at all', () => {
    expect(clampViewport(0, 30)).toBeNull()
    expect(clampViewport(Number.NaN, 30)).toBeNull()
  })
})
