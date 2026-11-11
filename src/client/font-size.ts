/** Terminal font size, chosen by the user and remembered per browser. */

export const DEFAULT_FONT_SIZE = 13
export const MIN_FONT_SIZE = 9
export const MAX_FONT_SIZE = 24

const STORAGE_KEY = 'ssh-web:terminal-font-size'

function clamp(size: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size))
}

export function stepFontSize(current: number, delta: 1 | -1): number {
  return clamp(current + delta)
}

/** Reads what was stored, tolerating anything a browser may hand back. */
export function parseFontSize(stored: string | null): number {
  if (stored === null || !/^\d+$/.test(stored)) return DEFAULT_FONT_SIZE
  return clamp(Number(stored))
}

// Storage can be unavailable (private windows, blocked site data): the
// terminal must work the same without it, only without remembering.
export function loadFontSize(): number {
  try {
    return parseFontSize(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_FONT_SIZE
  }
}

export function saveFontSize(size: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(clamp(size)))
  } catch {
    // Not remembered; nothing else depends on it.
  }
}
