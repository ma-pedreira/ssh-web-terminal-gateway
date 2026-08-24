'use client'

import { Badge, Button, Dot, Panel } from '@/components/ui/primitives'
import type { SessionSummary, SshSessionStatus } from '#types'

const STATUS: Record<SshSessionStatus, { readonly tone: 'lime' | 'amber' | 'neutral' | 'rose' | 'cyan'; readonly text: string }> = {
  connecting: { tone: 'cyan', text: 'connecting' },
  active: { tone: 'lime', text: 'active' },
  suspended: { tone: 'amber', text: 'suspended' },
  closed: { tone: 'neutral', text: 'closed' },
  failed: { tone: 'rose', text: 'failed' },
}

function when(value: string): string {
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function SessionTable({
  sessions,
  onResume,
  onClose,
  onClearHistory,
}: {
  readonly sessions: readonly SessionSummary[]
  readonly onResume: (session: SessionSummary) => void
  readonly onClose: (session: SessionSummary) => void
  readonly onClearHistory: () => Promise<void>
}) {
  // Only finished ones can be deleted: live sessions still hold an SSH
  // connection on the server and their row must not disappear.
  const finished = sessions.filter(
    (session) => session.status === 'closed' || session.status === 'failed',
  ).length

  return (
    <Panel
      title="Sessions"
      aside={
        <div className="flex items-center gap-3">
          <span className="label-tech">{sessions.length} recorded</span>
          {finished > 0 ? (
            <Button
              tone="rose"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete ${finished} finished ${finished === 1 ? 'session' : 'sessions'} from the history? Live ones are kept.`,
                  )
                ) {
                  void onClearHistory()
                }
              }}
            >
              Clear history
            </Button>
          ) : null}
        </div>
      }
    >
      {sessions.length === 0 ? (
        <p className="p-4 text-ink-faint">No sessions yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="label-tech px-4 py-2 font-normal">Host</th>
                <th className="label-tech px-4 py-2 font-normal">Status</th>
                <th className="label-tech px-4 py-2 font-normal">Started</th>
                <th className="label-tech px-4 py-2 font-normal">Last activity</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const status = STATUS[session.status]
                return (
                  <tr key={session.id} className="border-b border-hairline/60 last:border-0">
                    <td className="px-4 py-2">
                      <span className="text-ink">{session.hostAlias}</span>
                      <span className="ml-2 text-ink-faint">
                        {session.hostUser ?? 'root'}@{session.hostname}:{session.port}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={status.tone}>
                        <Dot tone={status.tone} live={session.status === 'active'} />
                        {status.text}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-ink-dim">{when(session.startedAt)}</td>
                    <td className="px-4 py-2 text-ink-dim">{when(session.lastActivityAt)}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-2">
                        {session.resumable ? (
                          <>
                            <Button onClick={() => onResume(session)}>Resume</Button>
                            <Button tone="rose" onClick={() => onClose(session)}>
                              Close
                            </Button>
                          </>
                        ) : (
                          <span className="text-ink-faint">{session.closeReason ?? '—'}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
