'use client'

import { useCallback, useState } from 'react'
import { api } from '@/client/api'
import { Badge, Button, Panel } from '@/components/ui/primitives'
import type { AuditAction, AuditEntry } from '#types'

type Tone = 'lime' | 'amber' | 'neutral' | 'rose' | 'cyan' | 'violet'

/** What deserves a second look stands out; the routine stays quiet. */
function toneOf(action: AuditAction): Tone {
  if (action === 'hostkey.mismatch' || action === 'user.login.failed' || action === 'session.failed') {
    return 'rose'
  }
  if (action === 'hostkey.pinned' || action === 'hostkey.forgotten') return 'amber'
  if (action.startsWith('credential.')) return 'violet'
  if (action.startsWith('host.') || action === 'settings.updated') return 'cyan'
  if (action === 'user.login') return 'lime'
  return 'neutral'
}

function when(value: string): string {
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const LIMIT = 100

/**
 * Recent activity of the account: sign-ins, host changes, sessions and server
 * key events. Loaded on demand, because most visits never look at it.
 */
export function AuditPanel() {
  const [entries, setEntries] = useState<readonly AuditEntry[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    try {
      const data = await api<{ entries: readonly AuditEntry[] }>(`/api/audit?limit=${LIMIT}`)
      setEntries(data.entries)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <Panel
      title="Activity"
      aside={
        <div className="flex items-center gap-2">
          {entries ? (
            <Button tone="neutral" onClick={() => setEntries(null)}>
              Hide
            </Button>
          ) : null}
          <Button tone="neutral" onClick={() => void load()} disabled={busy}>
            {busy ? 'Loading' : entries ? 'Refresh' : 'Show'}
          </Button>
        </div>
      }
    >
      {failed ? <p className="p-4 text-rose">Could not load the activity log.</p> : null}
      {entries === null ? (
        failed ? null : (
          <p className="p-4 text-ink-faint">
            Sign-ins, host changes, sessions and server key events, most recent first.
          </p>
        )
      ) : entries.length === 0 ? (
        <p className="p-4 text-ink-faint">Nothing recorded yet.</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full min-w-[640px] border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="label-tech px-4 py-2 font-normal">When</th>
                <th className="label-tech px-4 py-2 font-normal">Event</th>
                <th className="label-tech px-4 py-2 font-normal">Detail</th>
                <th className="label-tech px-4 py-2 font-normal">From</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-hairline/60 align-top last:border-0">
                  <td className="px-4 py-2 whitespace-nowrap text-ink-dim">{when(entry.createdAt)}</td>
                  <td className="px-4 py-2">
                    <Badge tone={toneOf(entry.action)}>{entry.action}</Badge>
                  </td>
                  <td className="px-4 py-2 break-all text-ink-dim">
                    {entry.detail ?? entry.targetId ?? '—'}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-ink-faint">{entry.clientIp ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
