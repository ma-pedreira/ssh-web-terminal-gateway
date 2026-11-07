'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/primitives'

function Sheet({
  title,
  onClose,
  children,
}: {
  readonly title: string
  readonly onClose: () => void
  readonly children: ReactNode
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="absolute inset-0 z-20 flex flex-col bg-void/95 backdrop-blur-sm"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <h2 className="label-tech">{title}</h2>
        <Button tone="neutral" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </header>
      {children}
    </div>
  )
}

/**
 * The terminal output as ordinary text. xterm draws its own selection and
 * does not support touch selection, so on phones this is where text is
 * selected and copied with the system's native handles.
 */
export function SelectSheet({
  text,
  onCopy,
  onClose,
}: {
  readonly text: string
  readonly onCopy: (text: string) => void
  readonly onClose: () => void
}) {
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const pre = preRef.current
    if (pre) pre.scrollTop = pre.scrollHeight
  }, [text])

  const copySelection = (): void => {
    const selected = window.getSelection()?.toString() ?? ''
    onCopy(selected.length > 0 ? selected : text)
  }

  return (
    <Sheet title="Select text" onClose={onClose}>
      <pre
        ref={preRef}
        className="min-h-0 flex-1 select-text overflow-auto px-3 py-2 text-[13px] leading-snug whitespace-pre text-ink"
        style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
      >
        {text}
      </pre>
      <footer className="flex gap-2 border-t border-hairline px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <Button onClick={copySelection}>Copy selection</Button>
        <Button tone="neutral" onClick={() => onCopy(text)}>
          Copy all
        </Button>
      </footer>
    </Sheet>
  )
}

/**
 * Fallback for pasting when the browser does not allow reading the clipboard
 * (plain HTTP): the user pastes into a normal text box with the system menu.
 */
export function PasteSheet({
  onSend,
  onClose,
}: {
  readonly onSend: (text: string) => void
  readonly onClose: () => void
}) {
  const [value, setValue] = useState('')

  return (
    <Sheet title="Paste" onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <p className="text-[11px] text-ink-dim">
          This browser does not let the page read the clipboard. Paste here and send it to the terminal.
        </p>
        <textarea
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-h-0 flex-1 resize-none border border-hairline bg-panel p-2 text-base text-ink outline-none focus:border-cyan"
        />
        <Button disabled={value.length === 0} onClick={() => onSend(value)}>
          Send to terminal
        </Button>
      </div>
    </Sheet>
  )
}
