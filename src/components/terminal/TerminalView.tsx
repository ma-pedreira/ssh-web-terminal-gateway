'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import '@xterm/xterm/css/xterm.css'
import { useTerminalSocket, type LinkState } from '@/hooks/useTerminalSocket'
import { useXterm } from '@/hooks/useXterm'
import { useCoarsePointer, useVisibleArea } from '@/hooks/useViewport'
import { TerminalWriteQueue } from '@/client/write-queue'
import { copyText, readClipboard } from '@/client/clipboard'
import { bufferToText } from '@/client/terminal-text'
import {
  applyModifiers,
  clampViewport,
  specialKeySequence,
  type Modifiers,
  type SpecialKey,
} from '@/client/terminal-keys'
import { Badge, Button, Dot } from '@/components/ui/primitives'
import { Brand } from '@/components/ui/Brand'
import { MobileKeyBar } from '@/components/terminal/MobileKeyBar'
import { PasteSheet, SelectSheet } from '@/components/terminal/TextSheet'

const LINK: Record<LinkState, { readonly tone: 'lime' | 'cyan' | 'amber' | 'neutral' | 'rose'; readonly text: string }> = {
  connecting: { tone: 'cyan', text: 'linking' },
  online: { tone: 'lime', text: 'online' },
  suspended: { tone: 'amber', text: 'suspended' },
  closed: { tone: 'neutral', text: 'closed' },
  error: { tone: 'rose', text: 'error' },
}

const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false }
const FLASH_MS = 1800
// Enough to cover the scrollback without building a huge DOM node.
const SELECT_MAX_LINES = 5000

type Sheet = { readonly kind: 'select'; readonly text: string } | { readonly kind: 'paste' } | null

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
  const decoder = useRef(new TextDecoder())
  const [queue] = useState(() => new TerminalWriteQueue())
  const [notice, setNotice] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet>(null)
  const [modifiers, setModifiers] = useState<Modifiers>(NO_MODIFIERS)
  const modifiersRef = useRef<Modifiers>(NO_MODIFIERS)
  // True while terminal.paste() runs: pasted text must not consume a modifier.
  const pastingRef = useRef(false)
  const coarse = useCoarsePointer()
  const visible = useVisibleArea()

  // The server sends the history as soon as the WebSocket connects, and xterm
  // is loaded with a dynamic import(). Without the queue, the first time round
  // (cold cache) the history arrives before the terminal and is lost.
  const onOutput = useCallback(
    (chunk: Uint8Array) => queue.push(decoder.current.decode(chunk, { stream: true })),
    [queue],
  )
  const onNotice = useCallback((message: string) => setNotice(message), [])

  const link = useTerminalSocket({ sessionId, onOutput, onNotice })
  const { send, resize, state } = link

  const updateModifiers = useCallback((next: Modifiers) => {
    modifiersRef.current = next
    setModifiers(next)
  }, [])

  const showFlash = useCallback((message: string) => setFlash(message), [])
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])

  const reportSize = useCallback(
    (cols: number, rows: number) => {
      const size = clampViewport(cols, rows)
      if (size) resize(size.cols, size.rows)
    },
    [resize],
  )

  const onData = useCallback(
    (data: string) => {
      const armed = modifiersRef.current
      // xterm also emits its own replies (device attributes, cursor reports,
      // focus events) through onData; they all start with ESC and must not
      // consume an armed modifier.
      const typed = !pastingRef.current && !data.startsWith('\x1b')
      if (typed && (armed.ctrl || armed.alt)) {
        updateModifiers(NO_MODIFIERS)
        send(applyModifiers(data, armed))
        return
      }
      send(data)
    },
    [send, updateModifiers],
  )

  const termRef = useXterm({
    hostRef,
    queue,
    onData,
    onResize: reportSize,
    onCopied: (ok) => showFlash(ok ? 'Copied' : 'The browser blocked the clipboard'),
  })

  // The first size is measured before the WebSocket is open, and messages
  // sent before that are dropped: report it again as soon as the link is up.
  // This is what fixes a new terminal stuck at the placeholder size.
  useEffect(() => {
    if (state !== 'online') return
    const terminal = termRef.current
    if (terminal) reportSize(terminal.cols, terminal.rows)
  }, [state, reportSize, termRef])

  const focusTerminal = useCallback(() => termRef.current?.focus(), [termRef])

  // Sheets need the on-screen keyboard closed: it would cover the text and
  // keep typing going to the terminal behind the dialog.
  const openSheet = useCallback(
    (next: NonNullable<Sheet>) => {
      termRef.current?.blur()
      setSheet(next)
    },
    [termRef],
  )

  const pasteIntoTerminal = useCallback(
    (text: string) => {
      const terminal = termRef.current
      if (!terminal || text.length === 0) return
      pastingRef.current = true
      try {
        terminal.paste(text)
      } finally {
        pastingRef.current = false
      }
    },
    [termRef],
  )

  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text)
      showFlash(ok ? 'Copied' : 'The browser blocked the clipboard')
    },
    [showFlash],
  )

  const copySelectionOrOpen = useCallback(() => {
    const terminal = termRef.current
    if (!terminal) return
    const selected = terminal.getSelection()
    if (selected.length > 0) {
      void copy(selected)
      terminal.clearSelection()
      return
    }
    openSheet({ kind: 'select', text: bufferToText(terminal.buffer.active, SELECT_MAX_LINES) })
  }, [copy, openSheet, termRef])

  const openSelect = useCallback(() => {
    const terminal = termRef.current
    if (terminal) openSheet({ kind: 'select', text: bufferToText(terminal.buffer.active, SELECT_MAX_LINES) })
  }, [openSheet, termRef])

  const paste = useCallback(async () => {
    const text = await readClipboard()
    if (text === null) {
      openSheet({ kind: 'paste' })
      return
    }
    pasteIntoTerminal(text)
    focusTerminal()
  }, [focusTerminal, openSheet, pasteIntoTerminal])

  const pressSpecial = useCallback(
    (key: SpecialKey) => {
      const applicationCursor = termRef.current?.modes.applicationCursorKeysMode ?? false
      const sequence = specialKeySequence(key, applicationCursor)
      const armed = modifiersRef.current
      // Alt+arrow is ESC-prefixed by most terminals; Ctrl only applies to text.
      send(armed.alt ? `\x1b${sequence}` : sequence)
      if (armed.ctrl || armed.alt) updateModifiers(NO_MODIFIERS)
      focusTerminal()
    },
    [focusTerminal, send, termRef, updateModifiers],
  )

  const closeSheet = useCallback(() => {
    setSheet(null)
    focusTerminal()
  }, [focusTerminal])

  const status = LINK[state]
  const finished = state === 'closed' || state === 'error'

  return (
    <div
      className="fixed inset-x-0 top-0 flex h-dvh flex-col"
      style={visible ? { height: visible.height, transform: `translateY(${visible.offsetTop}px)` } : undefined}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-hairline bg-panel/80 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur-sm sm:gap-3 sm:px-4">
        <span className="hidden sm:block">
          <Brand />
        </span>
        <span className="min-w-0 truncate text-ink">{title}</span>
        <Badge tone={status.tone}>
          <Dot tone={status.tone} live={state === 'online'} />
          {status.text}
        </Badge>
        {flash ? (
          <span role="status" className="text-[11px] text-lime">
            {flash}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button tone="neutral" className="hidden sm:inline-flex" onClick={copySelectionOrOpen} title="Ctrl+Shift+C">
            Copy
          </Button>
          <Button tone="neutral" className="hidden sm:inline-flex" onClick={() => void paste()} title="Ctrl+Shift+V">
            Paste
          </Button>
          <Button tone="neutral" onClick={onExit}>
            {finished ? 'Back' : coarse ? 'Leave' : 'Leave running'}
          </Button>
          <Button
            tone="rose"
            onClick={() => {
              link.close()
              onExit()
            }}
            disabled={finished}
          >
            {coarse ? 'Close' : 'Close session'}
          </Button>
        </div>
      </header>

      {notice ? (
        <p className="border-b border-hairline bg-amber/5 px-4 py-1.5 text-[11px] text-amber">{notice}</p>
      ) : null}

      {state === 'suspended' ? (
        <p className="border-b border-hairline bg-cyan/5 px-4 py-1.5 text-[11px] text-cyan">
          Session suspended on the server. It is still alive and you can resume it.
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0 bg-void px-2 py-1" onClick={focusTerminal} />
        {sheet?.kind === 'select' ? (
          <SelectSheet text={sheet.text} onCopy={(text) => void copy(text)} onClose={closeSheet} />
        ) : null}
        {sheet?.kind === 'paste' ? (
          <PasteSheet
            onSend={(text) => {
              pasteIntoTerminal(text)
              closeSheet()
            }}
            onClose={closeSheet}
          />
        ) : null}
      </div>

      {coarse && !finished ? (
        <MobileKeyBar
          modifiers={modifiers}
          onToggleModifier={(name) => {
            updateModifiers({ ...modifiersRef.current, [name]: !modifiersRef.current[name] })
            focusTerminal()
          }}
          onSpecial={pressSpecial}
          onText={(text) => {
            onData(text)
            focusTerminal()
          }}
          onSelect={openSelect}
          onPaste={() => void paste()}
          onKeyboard={focusTerminal}
        />
      ) : null}
    </div>
  )
}
