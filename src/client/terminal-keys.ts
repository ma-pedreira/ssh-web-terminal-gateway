/**
 * Pure keyboard helpers for the terminal: clipboard shortcuts, the sticky
 * Ctrl/Alt modifiers of the touch key bar, and the escape sequences of the
 * keys that phone keyboards do not have.
 */

export interface KeyLike {
  readonly type: string
  readonly key: string
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly metaKey: boolean
}

export type ClipboardAction = 'copy' | 'paste'

/**
 * Decides whether a key event is a clipboard shortcut that the browser should
 * handle instead of the shell.
 *
 * - Ctrl+Shift+C / Cmd+C copy. Plain Ctrl+C copies only when there is a
 *   selection; otherwise it stays SIGINT, as in Windows Terminal.
 * - Ctrl+Shift+V, Cmd+V and Shift+Insert paste. Plain Ctrl+V is left to the
 *   shell (it is "literal next" in readline and vim).
 */
export function classifyClipboardKey(event: KeyLike, hasSelection: boolean): ClipboardAction | null {
  if (event.type !== 'keydown') return null
  // Ctrl+Alt is AltGr on many layouts: never a shortcut.
  if (event.ctrlKey && event.altKey) return null

  const letter = event.key.toLowerCase()

  if (event.key === 'Insert' && event.shiftKey && !event.ctrlKey && !event.metaKey) return 'paste'

  if (letter === 'c') {
    if (event.ctrlKey && event.shiftKey) return 'copy'
    if (event.metaKey && hasSelection) return 'copy'
    if (event.ctrlKey && hasSelection) return 'copy'
    return null
  }

  if (letter === 'v') {
    if (event.ctrlKey && event.shiftKey) return 'paste'
    if (event.metaKey) return 'paste'
  }

  return null
}

export interface Modifiers {
  readonly ctrl: boolean
  readonly alt: boolean
}

const CONTROL_PUNCTUATION: Readonly<Record<string, string>> = {
  ' ': '\x00',
  '@': '\x00',
  '[': '\x1b',
  '\\': '\x1c',
  ']': '\x1d',
  '^': '\x1e',
  _: '\x1f',
  '?': '\x7f',
}

function toControl(char: string): string {
  const lower = char.toLowerCase()
  if (lower >= 'a' && lower <= 'z' && lower.length === 1) {
    return String.fromCharCode(lower.charCodeAt(0) - 96)
  }
  return CONTROL_PUNCTUATION[char] ?? char
}

/**
 * Applies the sticky modifiers to what the keyboard produced. Phone keyboards
 * sometimes deliver a whole word at once: only the first character is
 * modified, as if the modifier had been held for one key.
 */
export function applyModifiers(data: string, modifiers: Modifiers): string {
  if (data.length === 0) return data
  const [first = '', ...rest] = Array.from(data)
  const controlled = modifiers.ctrl ? toControl(first) : first
  const prefixed = modifiers.alt ? `\x1b${controlled}` : controlled
  return prefixed + rest.join('')
}

export type SpecialKey = 'esc' | 'tab' | 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'pgup' | 'pgdn'

const CURSOR_FINAL: Readonly<Partial<Record<SpecialKey, string>>> = {
  up: 'A',
  down: 'B',
  right: 'C',
  left: 'D',
  home: 'H',
  end: 'F',
}

const FIXED: Readonly<Partial<Record<SpecialKey, string>>> = {
  esc: '\x1b',
  tab: '\t',
  pgup: '\x1b[5~',
  pgdn: '\x1b[6~',
}

/**
 * Escape sequence for a key of the touch bar. Cursor keys follow the
 * application cursor mode (DECCKM) that full-screen programs such as vim and
 * less switch on.
 */
export function specialKeySequence(key: SpecialKey, applicationCursor: boolean): string {
  const final = CURSOR_FINAL[key]
  if (final) return applicationCursor ? `\x1bO${final}` : `\x1b[${final}`
  return FIXED[key] ?? ''
}

// Same bounds as clientMessageSchema: a size outside them would be rejected
// by the gateway and reported as an error.
const MIN_COLS = 20
const MAX_COLS = 500
const MIN_ROWS = 5
const MAX_ROWS = 200

export interface Viewport {
  readonly cols: number
  readonly rows: number
}

/** Brings a measured size into the range the gateway accepts. */
export function clampViewport(cols: number, rows: number): Viewport | null {
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return null
  return {
    cols: Math.min(MAX_COLS, Math.max(MIN_COLS, Math.floor(cols))),
    rows: Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.floor(rows))),
  }
}
