/**
 * Clipboard access that also works when the application is served over plain
 * HTTP on the LAN: the async Clipboard API only exists in secure contexts, so
 * copying falls back to the legacy execCommand route.
 */

function hasAsyncClipboard(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard !== 'undefined'
  )
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  const previous = document.activeElement as HTMLElement | null
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  // 16px keeps iOS from zooming in when the element takes focus.
  area.style.fontSize = '16px'
  document.body.appendChild(area)
  try {
    area.select()
    // iOS ignores select() on a textarea; an explicit range works everywhere.
    area.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    previous?.focus?.()
  }
}

/** Copies text. Resolves to false when the browser would not allow it. */
export async function copyText(text: string): Promise<boolean> {
  if (text.length === 0) return false
  if (hasAsyncClipboard() && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Permission refused or document not focused: try the legacy route.
    }
  }
  return legacyCopy(text)
}

/** Reads text, or null when the browser does not allow it (plain HTTP). */
export async function readClipboard(): Promise<string | null> {
  if (!hasAsyncClipboard() || typeof navigator.clipboard.readText !== 'function') return null
  try {
    return await navigator.clipboard.readText()
  } catch {
    return null
  }
}
