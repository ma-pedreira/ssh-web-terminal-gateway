'use client'

import { Badge, Button, Dot, Panel } from '@/components/ui/primitives'
import type { ConfiguredHost } from '#types'

export function HostGrid({
  hosts,
  busyAlias,
  onConnect,
  onEdit,
  onForgetKey,
  onDelete,
}: {
  readonly hosts: readonly ConfiguredHost[]
  readonly busyAlias: string | null
  readonly onConnect: (host: ConfiguredHost) => void
  readonly onEdit: (host: ConfiguredHost) => void
  readonly onForgetKey: (host: ConfiguredHost) => void
  readonly onDelete: (host: ConfiguredHost) => void
}) {
  if (hosts.length === 0) {
    return (
      <Panel title="Hosts">
        <p className="p-4 text-ink-faint">
          There is no Host block in the configuration file. Add the first one, or edit
          <span className="text-ink-dim"> ~/.ssh/config </span>
          by hand: the application reads it from there.
        </p>
      </Panel>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {hosts.map((host) => {
        const connecting = busyAlias === host.alias
        const keyMissing = host.identityFile !== null && !host.identityReadable
        return (
          <article
            key={host.alias}
            className={`bracket-frame border border-hairline bg-panel/80 p-4 transition-colors hover:border-hairline-bright ${connecting ? 'scan-line' : ''}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-ink">{host.alias}</h3>
                <p className="truncate text-[11px] text-ink-dim">
                  {host.user ?? 'root'}@{host.hostname}
                  <span className="text-ink-faint">:{host.port}</span>
                </p>
              </div>
              <Badge tone={host.identityFile ? 'cyan' : 'violet'}>
                <Dot tone={host.identityFile ? 'cyan' : 'violet'} />
                {host.identityFile ? 'key' : 'password'}
              </Badge>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {host.known ? (
                <Badge tone="lime">key pinned</Badge>
              ) : (
                <Badge tone="amber">first use</Badge>
              )}
              {host.identityFile ? (
                <Badge tone={keyMissing ? 'rose' : 'neutral'}>{host.identityFile}</Badge>
              ) : null}
            </div>

            {keyMissing ? (
              <p className="mt-3 text-[10px] text-rose">
                The key given in IdentityFile is not in the mounted directory.
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button onClick={() => onConnect(host)} disabled={connecting || keyMissing}>
                {connecting ? 'Connecting' : 'Connect'}
              </Button>
              <Button tone="neutral" onClick={() => onEdit(host)} disabled={connecting}>
                Edit
              </Button>
              {host.known ? (
                <Button
                  tone="amber"
                  onClick={() => onForgetKey(host)}
                  disabled={connecting}
                  title="Remove this server's key from known_hosts"
                >
                  Forget key
                </Button>
              ) : null}
              <Button tone="rose" onClick={() => onDelete(host)} disabled={connecting}>
                Delete
              </Button>
            </div>
          </article>
        )
      })}
    </div>
  )
}
