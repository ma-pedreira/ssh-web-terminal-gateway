'use client'

import type { MouseEvent, PointerEvent, ReactNode } from 'react'
import type { Modifiers, SpecialKey } from '@/client/terminal-keys'

interface Props {
  readonly modifiers: Modifiers
  readonly onToggleModifier: (name: keyof Modifiers) => void
  readonly onSpecial: (key: SpecialKey) => void
  readonly onText: (text: string) => void
  readonly onSelect: () => void
  readonly onPaste: () => void
  readonly onKeyboard: () => void
  readonly onFontSize: (delta: 1 | -1) => void
}

const SPECIALS: ReadonlyArray<readonly [SpecialKey, string]> = [
  ['esc', 'Esc'],
  ['tab', 'Tab'],
]

const ARROWS: ReadonlyArray<readonly [SpecialKey, string, string]> = [
  ['left', '←', 'Left'],
  ['down', '↓', 'Down'],
  ['up', '↑', 'Up'],
  ['right', '→', 'Right'],
]

const NAVIGATION: ReadonlyArray<readonly [SpecialKey, string]> = [
  ['home', 'Home'],
  ['end', 'End'],
  ['pgup', 'PgUp'],
  ['pgdn', 'PgDn'],
]

// Characters that are buried in secondary layers of phone keyboards.
const SYMBOLS = ['|', '~', '/', '-', '_', '*', '&', '$'] as const

// Keeping focus where it is keeps the on-screen keyboard open: a button that
// takes focus would close it on every press.
const keepFocus = (event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>): void =>
  event.preventDefault()

function Key({
  children,
  onPress,
  active = false,
  label,
}: {
  readonly children: ReactNode
  readonly onPress: () => void
  readonly active?: boolean
  readonly label?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={onPress}
      className={`min-w-10 shrink-0 border px-2.5 py-2 text-xs ${
        active ? 'border-cyan bg-cyan/20 text-cyan' : 'border-hairline bg-panel-raised text-ink-dim'
      } active:bg-cyan/30`}
    >
      {children}
    </button>
  )
}

/**
 * Keys that phone keyboards lack. Ctrl and Alt are sticky: press one, then the
 * letter, as with the accessibility "sticky keys" on desktop.
 */
export function MobileKeyBar({
  modifiers,
  onToggleModifier,
  onSpecial,
  onText,
  onSelect,
  onPaste,
  onKeyboard,
  onFontSize,
}: Props) {
  return (
    <div
      role="toolbar"
      aria-label="Terminal keys"
      className="flex gap-1 overflow-x-auto border-t border-hairline bg-panel px-1 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
    >
      {SPECIALS.map(([key, text]) => (
        <Key key={key} onPress={() => onSpecial(key)}>
          {text}
        </Key>
      ))}
      <Key active={modifiers.ctrl} onPress={() => onToggleModifier('ctrl')}>
        Ctrl
      </Key>
      <Key active={modifiers.alt} onPress={() => onToggleModifier('alt')}>
        Alt
      </Key>
      {ARROWS.map(([key, text, label]) => (
        <Key key={key} label={label} onPress={() => onSpecial(key)}>
          {text}
        </Key>
      ))}
      {SYMBOLS.map((symbol) => (
        <Key key={symbol} onPress={() => onText(symbol)}>
          {symbol}
        </Key>
      ))}
      {NAVIGATION.map(([key, text]) => (
        <Key key={key} onPress={() => onSpecial(key)}>
          {text}
        </Key>
      ))}
      <Key onPress={onSelect}>Select</Key>
      <Key onPress={onPaste}>Paste</Key>
      <Key label="Smaller text" onPress={() => onFontSize(-1)}>
        A-
      </Key>
      <Key label="Larger text" onPress={() => onFontSize(1)}>
        A+
      </Key>
      <Key label="Show keyboard" onPress={onKeyboard}>
        Kbd
      </Key>
    </div>
  )
}
