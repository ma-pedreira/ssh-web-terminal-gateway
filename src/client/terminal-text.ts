/** Minimal shape of an xterm buffer, so the conversion can be tested alone. */
export interface BufferLineLike {
  readonly isWrapped: boolean
  translateToString(trimRight?: boolean): string
}

export interface BufferLike {
  readonly length: number
  getLine(index: number): BufferLineLike | undefined
}

/**
 * Plain text of the terminal buffer (scrollback and screen). Lines the
 * terminal wrapped because they were wider than the screen are joined again,
 * so a copied command or path comes out whole.
 */
export function bufferToText(buffer: BufferLike, maxLines: number = Number.POSITIVE_INFINITY): string {
  const logical: string[] = []

  for (let index = 0; index < buffer.length; index += 1) {
    const line = buffer.getLine(index)
    if (!line) continue
    const text = line.translateToString(true)
    const last = logical.length - 1
    if (line.isWrapped && last >= 0) {
      logical[last] = `${logical[last] ?? ''}${text}`
    } else {
      logical.push(text)
    }
  }

  let end = logical.length
  while (end > 0 && (logical[end - 1] ?? '').trim() === '') end -= 1

  const start = Math.max(0, end - maxLines)
  return logical.slice(start, end).join('\n')
}
