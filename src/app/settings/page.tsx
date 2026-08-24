'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiRequestError } from '@/client/api'
import { Badge, Button, Dot, Field, Notice, Panel, Select } from '@/components/ui/primitives'
import { Brand } from '@/components/ui/Brand'

interface Settings {
  sshDir: string
  keysDir: string
  vaultPath: string
  vaultEnabled: boolean
  sessionIdleMinutes: number
  replayBufferKb: number
}

interface SettingsResponse {
  settings: Settings
  allowedRoots: readonly string[]
  platform: string
  vault: { state: 'disabled' | 'locked' | 'open'; aliases: readonly string[] }
  suggestions: readonly string[]
}

const VAULT_STATE = {
  disabled: { tone: 'neutral' as const, text: 'disabled' },
  locked: { tone: 'amber' as const, text: 'locked' },
  open: { tone: 'lime' as const, text: 'open' },
}

export default function SettingsPage() {
  const router = useRouter()
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [form, setForm] = useState<Settings | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const response = await api<SettingsResponse>('/api/settings')
    setData(response)
    setForm({ ...response.settings })
  }, [])

  useEffect(() => {
    load().catch(() => router.replace('/login'))
  }, [load, router])

  const enablingVault = form?.vaultEnabled === true && data?.settings.vaultEnabled === false

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!form) return
    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      await api('/api/settings', {
        method: 'PUT',
        body: { ...form, ...(enablingVault ? { password } : {}) },
      })
      setPassword('')
      await load()
      setNotice('Settings saved.')
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  async function forget(alias: string) {
    if (!window.confirm(`Delete the stored password for "${alias}"?`)) return
    await api(`/api/hosts/${encodeURIComponent(alias)}/password`, { method: 'DELETE' }).catch(
      () => undefined,
    )
    await load()
  }

  if (!data || !form) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="label-tech">Loading</p>
      </main>
    )
  }

  const vault = VAULT_STATE[data.vault.state]

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <Brand subtitle="settings" />
        <div className="ml-auto">
          <Button tone="neutral" onClick={() => router.push('/')}>
            Back to the dashboard
          </Button>
        </div>
      </header>

      {error ? <Notice tone="rose">{error}</Notice> : null}
      {notice ? <Notice tone="lime">{notice}</Notice> : null}

      <form onSubmit={save} className="flex flex-col gap-6">
        <Panel
          title="Where information is stored"
          aside={<span className="label-tech">{data.platform}</span>}
        >
          <div className="flex flex-col gap-4 p-4">
            <Notice tone="cyan">
              Paths must be inside the allowed folders:{' '}
              <span className="text-ink">{data.allowedRoots.join('  ·  ')}</span>
            </Notice>

            <Field
              label="OpenSSH folder (config and known_hosts)"
              value={form.sshDir}
              onChange={(event) => setForm({ ...form, sshDir: event.target.value })}
              hint="Your hosts and server fingerprints are read and written here"
            />
            <Field
              label="Private keys folder"
              value={form.keysDir}
              onChange={(event) => setForm({ ...form, keysDir: event.target.value })}
              hint="Read-only. No key outside this folder is reachable"
            />
            <Field
              label="Password vault file"
              value={form.vaultPath}
              onChange={(event) => setForm({ ...form, vaultPath: event.target.value })}
              hint="Encrypted with AES-256-GCM. Choose where it should live"
            />
          </div>
        </Panel>

        <Panel
          title="Password vault"
          aside={
            <Badge tone={vault.tone}>
              <Dot tone={vault.tone} live={data.vault.state === 'open'} />
              {vault.text}
            </Badge>
          }
        >
          <div className="flex flex-col gap-4 p-4">
            <Select
              label="Store host passwords"
              value={form.vaultEnabled ? 'yes' : 'no'}
              onChange={(event) => setForm({ ...form, vaultEnabled: event.target.value === 'yes' })}
            >
              <option value="no">No: ask for the password on every connection</option>
              <option value="yes">Yes: store them encrypted in the file</option>
            </Select>

            {enablingVault ? (
              <>
                <Notice tone="amber">
                  The vault is encrypted with your sign-in password. Confirm it to enable it.
                </Notice>
                <Field
                  label="Your password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </>
            ) : null}

            {data.vault.state === 'locked' ? (
              <Notice tone="amber">
                A vault exists but this session does not hold its key: the key only lives in memory
                and is lost when the server restarts. It opens by signing in again, or by confirming
                your password the next time you connect to a host and tick Remember.
              </Notice>
            ) : null}

            {data.vault.aliases.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="label-tech">Stored passwords</span>
                <ul className="flex flex-col gap-1.5">
                  {data.vault.aliases.map((alias) => (
                    <li
                      key={alias}
                      className="flex items-center justify-between border border-hairline px-3 py-1.5"
                    >
                      <span className="text-ink">{alias}</span>
                      <Button type="button" tone="rose" onClick={() => void forget(alias)}>
                        Forget
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Sessions">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field
              label="Idle minutes before closing"
              type="number"
              min={1}
              max={10080}
              value={form.sessionIdleMinutes}
              onChange={(event) =>
                setForm({ ...form, sessionIdleMinutes: Number(event.target.value) })
              }
              hint="Applies to suspended sessions"
            />
            <Field
              label="Kilobytes of output retained"
              type="number"
              min={8}
              max={4096}
              value={form.replayBufferKb}
              onChange={(event) => setForm({ ...form, replayBufferKb: Number(event.target.value) })}
              hint="What gets repainted when you resume a session"
            />
          </div>
        </Panel>

        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving' : 'Save settings'}
          </Button>
          <Button type="button" tone="neutral" onClick={() => setForm({ ...data.settings })}>
            Discard changes
          </Button>
        </div>
      </form>

      <p className="text-[10px] leading-relaxed text-ink-faint">
        Changing the folders does not move files that already exist: point them at where the files
        are, or copy them first. The vault is encrypted with your sign-in password, so if you change
        that password you will have to store the host passwords again.
      </p>
    </main>
  )
}
