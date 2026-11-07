import type { ITerminalOptions } from '@xterm/xterm'

export const THEME = {
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

export const TERMINAL_OPTIONS: ITerminalOptions = {
  theme: THEME,
  fontFamily: "ui-monospace, 'JetBrains Mono', 'SFMono-Regular', 'Cascadia Mono', Menlo, monospace",
  fontSize: 13,
  lineHeight: 1.3,
  cursorBlink: true,
  cursorStyle: 'bar',
  scrollback: 5000,
  allowProposedApi: true,
  // Right click selects the word under the pointer, so the context menu
  // offers "Copy" on every platform, not only on macOS.
  rightClickSelectsWord: true,
  // With a program that captures the mouse (tmux, htop, vim), Alt+drag on
  // macOS and Shift+drag elsewhere still select text.
  macOptionClickForcesSelection: true,
}
