'use client'

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

type Tone = 'cyan' | 'violet' | 'lime' | 'amber' | 'rose' | 'neutral'

const TONE_TEXT: Record<Tone, string> = {
  cyan: 'text-cyan',
  violet: 'text-violet',
  lime: 'text-lime',
  amber: 'text-amber',
  rose: 'text-rose',
  neutral: 'text-ink-dim',
}

const TONE_BORDER: Record<Tone, string> = {
  cyan: 'border-cyan/40 bg-cyan/5',
  violet: 'border-violet/40 bg-violet/5',
  lime: 'border-lime/40 bg-lime/5',
  amber: 'border-amber/40 bg-amber/5',
  rose: 'border-rose/40 bg-rose/5',
  neutral: 'border-hairline bg-white/2',
}

export function Panel({
  children,
  title,
  aside,
  className = '',
}: {
  readonly children: ReactNode
  readonly title?: string
  readonly aside?: ReactNode
  readonly className?: string
}) {
  return (
    <section
      className={`bracket-frame border border-hairline bg-panel/80 backdrop-blur-sm ${className}`}
    >
      {title ? (
        <header className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
          <h2 className="label-tech">{title}</h2>
          {aside}
        </header>
      ) : null}
      {children}
    </section>
  )
}

export function Button({
  tone = 'cyan',
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly tone?: Tone }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 border px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${TONE_BORDER[tone]} ${TONE_TEXT[tone]} hover:brightness-150 ${className}`}
    >
      {children}
    </button>
  )
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  readonly tone?: Tone
  readonly children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] ${TONE_BORDER[tone]} ${TONE_TEXT[tone]}`}
    >
      {children}
    </span>
  )
}

export function Dot({ tone = 'lime', live = false }: { readonly tone?: Tone; readonly live?: boolean }) {
  const color = { cyan: 'bg-cyan', violet: 'bg-violet', lime: 'bg-lime', amber: 'bg-amber', rose: 'bg-rose', neutral: 'bg-ink-faint' }[tone]
  return <span className={`inline-block size-1.5 rounded-full ${color} ${live ? 'live-dot' : ''}`} />
}

export function Field({
  label,
  hint,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { readonly label: string; readonly hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label-tech">{label}</span>
      <input
        {...rest}
        className="border border-hairline bg-abyss px-2.5 py-1.5 text-ink placeholder:text-ink-faint focus:border-cyan/60 focus:outline-none"
      />
      {hint ? <span className="text-[10px] text-ink-faint">{hint}</span> : null}
    </label>
  )
}

export function TextArea({
  label,
  hint,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { readonly label: string; readonly hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label-tech">{label}</span>
      <textarea
        {...rest}
        className="border border-hairline bg-abyss px-2.5 py-1.5 text-ink placeholder:text-ink-faint focus:border-cyan/60 focus:outline-none"
      />
      {hint ? <span className="text-[10px] text-ink-faint">{hint}</span> : null}
    </label>
  )
}

export function Select({
  label,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { readonly label: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label-tech">{label}</span>
      <select
        {...rest}
        className="border border-hairline bg-abyss px-2.5 py-1.5 text-ink focus:border-cyan/60 focus:outline-none"
      >
        {children}
      </select>
    </label>
  )
}

export function Notice({ tone, children }: { readonly tone: Tone; readonly children: ReactNode }) {
  return (
    <p className={`border px-3 py-2 text-[11px] ${TONE_BORDER[tone]} ${TONE_TEXT[tone]}`}>{children}</p>
  )
}
