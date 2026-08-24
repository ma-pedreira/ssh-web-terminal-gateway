'use client'

import { useRouter } from 'next/navigation'

/**
 * The application wordmark. When navigation makes sense it is a button that
 * goes to the dashboard: that is where everyone expects to click to go back.
 */
export function Brand({
  subtitle,
  interactive = true,
}: {
  readonly subtitle?: string
  readonly interactive?: boolean
}) {
  const router = useRouter()

  const wordmark = (
    <>
      <span className="text-lg tracking-[0.3em] text-cyan">SSH</span>
      <span className="text-lg tracking-[0.3em] text-ink-dim">WEB</span>
    </>
  )

  return (
    <div className="flex items-baseline gap-2">
      {interactive ? (
        <button
          type="button"
          onClick={() => router.push('/')}
          title="Back to the dashboard"
          aria-label="Back to the dashboard"
          className="flex items-baseline gap-2 transition-opacity hover:opacity-70"
        >
          {wordmark}
        </button>
      ) : (
        <div className="flex items-baseline gap-2">{wordmark}</div>
      )}
      {subtitle ? <span className="label-tech">{subtitle}</span> : null}
    </div>
  )
}
