'use client'

import { useEffect, useRef, type RefObject } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { classifyClipboardKey } from '@/client/terminal-keys'
import { copyText } from '@/client/clipboard'
import type { TerminalWriteQueue } from '@/client/write-queue'
import { TERMINAL_OPTIONS } from '@/components/terminal/theme'

interface Options {
  readonly hostRef: RefObject<HTMLDivElement | null>
  readonly queue: TerminalWriteQueue
  /** Everything the user types, after xterm has encoded it. */
  readonly onData: (data: string) => void
  /** Every size change, including the first measurement. */
  readonly onResize: (cols: number, rows: number) => void
  /** Called after a copy shortcut, with whether the copy succeeded. */
  readonly onCopied?: (ok: boolean) => void
  /** Font size in pixels. Changing it refits and reports the new size. */
  readonly fontSize: number
}

/**
 * Creates the xterm instance, keeps it fitted to its container and reports
 * every size it takes.
 *
 * The first size matters: the session is opened with a placeholder size, and
 * the old code only reported changes, so a terminal that never changed size
 * stayed at the placeholder until the window was resized.
 */
export function useXterm({ hostRef, queue, onData, onResize, onCopied, fontSize }: Options): RefObject<Terminal | null> {
  const termRef = useRef<Terminal | null>(null)
  const refitRef = useRef<(() => void) | null>(null)
  // Read when the terminal is created, without making its creation depend on
  // it: a size change must not rebuild the terminal.
  const fontSizeRef = useRef(fontSize)
  // Callbacks behind refs: changing them must not rebuild the terminal.
  const handlers = useRef({ onData, onResize, onCopied })
  useEffect(() => {
    handlers.current = { onData, onResize, onCopied }
  })

  useEffect(() => {
    let disposed = false
    let terminal: Terminal | null = null
    let fit: FitAddon | null = null
    let observer: ResizeObserver | null = null
    let frame = 0

    const refit = (): void => {
      if (disposed || !fit || !hostRef.current) return
      // A hidden or collapsed container measures as zero: nothing to fit.
      if (hostRef.current.clientWidth === 0 || hostRef.current.clientHeight === 0) return
      try {
        fit.fit()
      } catch {
        // The renderer may not be measurable yet; the next observation retries.
      }
    }

    const scheduleRefit = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(refit)
    }

    async function boot(): Promise<void> {
      const [{ Terminal: Ctor }, { FitAddon: Fit }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ])
      const host = hostRef.current
      if (disposed || !host) return

      terminal = new Ctor({ ...TERMINAL_OPTIONS, fontSize: fontSizeRef.current })
      fit = new Fit()
      terminal.loadAddon(fit)
      terminal.loadAddon(new WebLinksAddon())

      const target = terminal
      // Clipboard shortcuts go to the browser: returning false makes xterm
      // skip the key without preventDefault, so the native copy/paste event
      // fires and xterm's own handlers move the selection or the pasted text.
      target.attachCustomKeyEventHandler((event) => {
        const action = classifyClipboardKey(event, target.hasSelection())
        if (action === 'copy') {
          const selected = target.getSelection()
          if (event.ctrlKey && event.shiftKey) {
            // Chrome and Firefox bind Ctrl+Shift+C to DevTools: the default
            // must be cancelled and the copy done here. The key press is a
            // user gesture, so the execCommand fallback works over HTTP.
            event.preventDefault()
            if (selected.length === 0) return false
            void copyText(selected).then((ok) => {
              if (ok) target.clearSelection()
              handlers.current.onCopied?.(ok)
            })
            return false
          }
          setTimeout(() => {
            target.clearSelection()
            handlers.current.onCopied?.(true)
          }, 0)
          return false
        }
        return action !== 'paste'
      })

      // Subscribed before the first fit, so that one is reported as well.
      target.onResize(({ cols, rows }) => handlers.current.onResize(cols, rows))
      target.onData((data) => handlers.current.onData(data))

      target.open(host)
      refit()
      handlers.current.onResize(target.cols, target.rows)

      termRef.current = target
      refitRef.current = scheduleRefit
      queue.attach((data) => target.write(data))
      target.focus()

      observer = new ResizeObserver(scheduleRefit)
      observer.observe(host)
      // The layout may still settle after the first paint (header wrapping,
      // web fonts): measure again once it has.
      scheduleRefit()
      void document.fonts?.ready.then(scheduleRefit)
    }

    void boot()

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer?.disconnect()
      queue.detach()
      terminal?.dispose()
      termRef.current = null
      refitRef.current = null
    }
  }, [hostRef, queue])

  // A different font size changes how many columns and rows fit: the refit
  // triggers onResize, which tells the remote side.
  useEffect(() => {
    fontSizeRef.current = fontSize
    const terminal = termRef.current
    if (!terminal || terminal.options.fontSize === fontSize) return
    terminal.options.fontSize = fontSize
    refitRef.current?.()
  }, [fontSize])

  return termRef
}
