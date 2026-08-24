'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import '@xterm/xterm/css/xterm.css'
import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import { useTerminalSocket, type LinkState } from '@/hooks/useTerminalSocket'
import { TerminalWriteQueue } from '@/client/write-queue'
import { Badge, Button, Dot } from '@/components/ui/primitives'
import { Brand } from '@/components/ui/Brand'

const LINK: Record<LinkState, { readonly tone: 'lime' | 'cyan' | 'amber' | 'neutral' | 'rose'; readonly text: string }> = {
  connecting: { tone: 'cyan', text: 'linking' },
  online: { tone: 'lime', text: 'online' },
  suspended: { tone: 'amber', text: 'suspended' },
  closed: { tone: 'neutral', text: 'closed' },
  error: { tone: 'rose', text: 'error' },
}

const THEME = {
  background: '#04060a',
  foreground: '#e6f1f7',
  cursor: '#22d3ee',
  cursorAccent: '#04060a',
  selectionBackground: '#0e7490',
  black: '#0b1119',
  red: '#fb7185',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#38bdf8',
  magenta: '#a78bfa',
  cyan: '#22d3ee',
  white: '#cbd5e1',
  brightBlack: '#5a6b7a',
  brightRed: '#fda4af',
  brightGreen: '#6ee7b7',
  brightYellow: '#fcd34d',
  brightBlue: '#7dd3fc',
  brightMagenta: '#c4b5fd',
  brightCyan: '#67e8f9',
  brightWhite: '#f1f5f9',
} as const

export function TerminalView({
  sessionId,
  title,
  onExit,
}: {
  readonly sessionId: string
  readonly title: string
  readonly onExit: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const decoder = useRef(new TextDecoder())
  const queueRef = useRef<TerminalWriteQueue | null>(null)
  if (queueRef.current === null) queueRef.current = new TerminalWriteQueue()
  const [notice, setNotice] = useState<string | null>(null)

  // The server sends the history as soon as the WebSocket connects, and xterm
  // is loaded with a dynamic import(). Without the queue, the first time round
  // (cold cache) the history arrives before the terminal and is lost.
  const onOutput = useCallback((chunk: Uint8Array) => {
    queueRef.current?.push(decoder.current.decode(chunk, { stream: true }))
  }, [])

  const onNotice = useCallback((message: string) => setNotice(message), [])

  const link = useTerminalSocket({ sessionId, onOutput, onNotice })
  const { send, resize } = link

  useEffect(() => {
    let disposed = false
    let terminal: Terminal | null = null
    let observer: ResizeObserver | null = null

    async function boot(): Promise<void> {
      const [{ Terminal: Ctor }, { FitAddon: Fit }, { WebLinksAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
      ])
      if (disposed || !hostRef.current) return

      terminal = new Ctor({
        theme: THEME,
        fontFamily:
          "ui-monospace, 'JetBrains Mono', 'SFMono-Regular', 'Cascadia Mono', Menlo, monospace",
        fontSize: 13,
        lineHeight: 1.3,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 5000,
        allowProposedApi: true,
      })

      const fit = new Fit()
      terminal.loadAddon(fit)
      terminal.loadAddon(new WebLinksAddon())
      terminal.open(hostRef.current)
      fit.fit()

      termRef.current = terminal
      fitRef.current = fit
      terminal.focus()

      // The terminal exists now: flush what was held, then write directly.
      const target = terminal
      queueRef.current?.attach((data) => target.write(data))

      terminal.onData((data) => send(data))
      terminal.onResize(({ cols, rows }) => resize(cols, rows))

      observer = new ResizeObserver(() => fitRef.current?.fit())
      observer.observe(hostRef.current)
    }

    void boot()

    return () => {
      disposed = true
      observer?.disconnect()
      queueRef.current?.detach()
      terminal?.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [send, resize])

  const status = LINK[link.state]
  const finished = link.state === 'closed' || link.state === 'error'

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-hairline bg-panel/80 px-4 py-2 backdrop-blur-sm">
        <Brand />
        <span className="truncate text-ink">{title}</span>
        <Badge tone={status.tone}>
          <Dot tone={status.tone} live={link.state === 'online'} />
          {status.text}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button tone="neutral" onClick={onExit}>
            {finished ? 'Back' : 'Leave running'}
          </Button>
          <Button
            tone="rose"
            onClick={() => {
              link.close()
              onExit()
            }}
            disabled={finished}
          >
            Close session
          </Button>
        </div>
      </header>

      {notice ? (
        <p className="border-b border-hairline bg-amber/5 px-4 py-1.5 text-[11px] text-amber">
          {notice}
        </p>
      ) : null}

      {link.state === 'suspended' ? (
        <p className="border-b border-hairline bg-cyan/5 px-4 py-1.5 text-[11px] text-cyan">
          Session suspended on the server. It is still alive and you can resume it.
        </p>
      ) : null}

      <div ref={hostRef} className="min-h-0 flex-1 bg-void px-2 py-1" />
    </div>
  )
}
