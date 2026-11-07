import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText, readClipboard } from '@/client/clipboard'

afterEach(() => {
  vi.unstubAllGlobals()
})

function fakeDocument(execResult: boolean) {
  const textarea = {
    value: '',
    style: {} as Record<string, string>,
    setAttribute: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    remove: vi.fn(),
  }
  const doc = {
    createElement: vi.fn(() => textarea),
    body: { appendChild: vi.fn() },
    execCommand: vi.fn(() => execResult),
    activeElement: null,
  }
  return { doc, textarea }
}

describe('copyText', () => {
  it('uses the async clipboard in a secure context', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    await expect(copyText('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to execCommand over plain HTTP', async () => {
    const { doc, textarea } = fakeDocument(true)
    vi.stubGlobal('window', { isSecureContext: false })
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', doc)

    await expect(copyText('over http')).resolves.toBe(true)
    expect(textarea.value).toBe('over http')
    expect(doc.execCommand).toHaveBeenCalledWith('copy')
    expect(textarea.remove).toHaveBeenCalled()
  })

  it('falls back when the async clipboard rejects', async () => {
    const { doc } = fakeDocument(true)
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } })
    vi.stubGlobal('document', doc)

    await expect(copyText('x')).resolves.toBe(true)
    expect(doc.execCommand).toHaveBeenCalledWith('copy')
  })

  it('reports failure when nothing works', async () => {
    const { doc } = fakeDocument(false)
    vi.stubGlobal('window', { isSecureContext: false })
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', doc)

    await expect(copyText('x')).resolves.toBe(false)
  })

  it('does nothing for empty text', async () => {
    await expect(copyText('')).resolves.toBe(false)
  })
})

describe('readClipboard', () => {
  it('reads text in a secure context', async () => {
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn(async () => 'pasted') } })
    await expect(readClipboard()).resolves.toBe('pasted')
  })

  it('returns null when reading is not allowed', async () => {
    vi.stubGlobal('window', { isSecureContext: false })
    vi.stubGlobal('navigator', {})
    await expect(readClipboard()).resolves.toBeNull()
  })

  it('returns null when the browser refuses', async () => {
    vi.stubGlobal('window', { isSecureContext: true })
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn(async () => Promise.reject(new Error('no'))) } })
    await expect(readClipboard()).resolves.toBeNull()
  })
})
