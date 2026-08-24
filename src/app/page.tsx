'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiRequestError } from '@/client/api'
import { Button, Notice, Panel } from '@/components/ui/primitives'
import { Brand } from '@/components/ui/Brand'
import { HostForm } from '@/components/hosts/HostForm'
import { HostGrid } from '@/components/hosts/HostGrid'
import {
  SecretPrompt,
  type SecretAnswer,
  type SecretRequest,
  type VaultState,
} from '@/components/hosts/SecretPrompt'
import { SessionTable } from '@/components/sessions/SessionTable'
import type { ConfiguredHost, SessionSummary, User } from '#types'

/**
 * 428: a secret only the user holds is missing, or the one they sent was
 * rejected by the remote host. Either way it has to be asked for again.
 */
const SECRET_REQUIRED = 428

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [hosts, setHosts] = useState<readonly ConfiguredHost[]>([])
  const [sessions, setSessions] = useState<readonly SessionSummary[]>([])
  const [busyAlias, setBusyAlias] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<SecretRequest | null>(null)
  const [vaultState, setVaultState] = useState<VaultState>('disabled')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [hostList, sessionList, settings] = await Promise.all([
      api<{ hosts: readonly ConfiguredHost[] }>('/api/hosts'),
      api<{ sessions: readonly SessionSummary[] }>('/api/sessions'),
      api<{ vault: { state: VaultState } }>('/api/settings'),
    ])
    setHosts(hostList.hosts)
    setSessions(sessionList.sessions)
    setVaultState(settings.vault.state)
  }, [])

  useEffect(() => {
    api<{ user: User }>('/api/auth/me')
      .then(async (data) => {
        setUser(data.user)
        await refresh()
      })
      .catch(() => router.replace('/login'))
  }, [refresh, router])

  // Periodic refresh, so sessions that change state on their own show up.
  useEffect(() => {
    if (!user) return
    const timer = setInterval(() => void refresh().catch(() => undefined), 10_000)
    return () => clearInterval(timer)
  }, [user, refresh])

  const openSession = useCallback(
    async (
      alias: string,
      secrets: { password?: string; passphrase?: string; remember?: boolean } = {},
    ) => {
      setBusyAlias(alias)
      setError(null)
      try {
        const { sessionId } = await api<{ sessionId: string }>('/api/sessions', {
          method: 'POST',
          body: { alias, cols: 100, rows: 30, ...secrets },
        })
        router.push(`/terminal/${sessionId}`)
      } catch (cause) {
        if (cause instanceof ApiRequestError && cause.status === SECRET_REQUIRED) {
          // The message tells whether the password or the passphrase is needed.
          const kind = /passphrase/i.test(cause.message) ? 'passphrase' : 'password'
          setPrompt({ alias, kind, message: cause.message })
        } else {
          setError(cause instanceof ApiRequestError ? cause.message : 'Could not connect')
        }
        setBusyAlias(null)
      }
    },
    [router],
  )

  /**
   * When the user asks to remember the password and the vault is not open, it
   * is opened first with their application password, then the session starts.
   */
  async function connectWithSecret(
    alias: string,
    kind: 'password' | 'passphrase',
    answer: SecretAnswer,
  ) {
    if (answer.appPassword) {
      try {
        const { state } = await api<{ state: VaultState }>('/api/vault/unlock', {
          method: 'POST',
          body: { password: answer.appPassword },
        })
        setVaultState(state)
      } catch (cause) {
        setError(
          cause instanceof ApiRequestError
            ? `Could not open the vault: ${cause.message}`
            : 'Could not open the vault',
        )
        return
      }
    }

    const secrets =
      kind === 'password'
        ? { password: answer.secret, remember: answer.remember }
        : { passphrase: answer.secret }

    await openSession(alias, secrets)
    await refresh().catch(() => undefined)
  }

  async function removeHost(host: ConfiguredHost) {
    if (!window.confirm(`Delete the "Host ${host.alias}" block from ~/.ssh/config?`)) return
    try {
      await api(`/api/hosts/${encodeURIComponent(host.alias)}`, { method: 'DELETE' })
      await refresh()
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not delete it')
    }
  }

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    router.replace('/login')
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="label-tech">Loading</p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <Brand subtitle="terminal gateway" />
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-ink-dim">{user.username}</span>
          <Button tone="neutral" onClick={() => router.push('/settings')}>
            Settings
          </Button>
          <Button tone="neutral" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      {error ? <Notice tone="rose">{error}</Notice> : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 className="label-tech">Hosts · ~/.ssh/config</h2>
          <div className="h-px flex-1 bg-hairline" />
          <HostForm onCreated={() => void refresh()} />
        </div>
        <HostGrid
          hosts={hosts}
          busyAlias={busyAlias}
          onConnect={(host) => void openSession(host.alias)}
          onDelete={removeHost}
        />
      </section>

      <SessionTable
        sessions={sessions}
        onClearHistory={async () => {
          const { cleared } = await api<{ cleared: number }>('/api/sessions', { method: 'DELETE' })
          if (cleared === 0) setError('There are no finished sessions to delete.')
          await refresh()
        }}
        onResume={(session) => router.push(`/terminal/${session.id}`)}
        onClose={async (session) => {
          await api(`/api/sessions/${session.id}`, { method: 'DELETE' }).catch(() => undefined)
          await refresh()
        }}
      />

      <Panel title="Where everything lives">
        <ul className="flex flex-col gap-1.5 p-4 text-[11px] text-ink-dim">
          <li>Your hosts are in ~/.ssh/config, in standard OpenSSH format.</li>
          <li>Server fingerprints are in ~/.ssh/known_hosts, pinned on first use.</li>
          <li>Private keys are read from the mounted directory and never copied.</li>
          <li>
            {vaultState === 'open'
              ? 'Passwords you tick are stored encrypted with your sign-in password.'
              : 'Passwords are not stored unless you tick "Remember it" when connecting.'}
          </li>
        </ul>
      </Panel>

      {prompt ? (
        <SecretPrompt
          request={prompt}
          vaultState={vaultState}
          onCancel={() => setPrompt(null)}
          onSubmit={(answer: SecretAnswer) => {
            const alias = prompt.alias
            setPrompt(null)
            void connectWithSecret(alias, prompt.kind, answer)
          }}
        />
      ) : null}
    </main>
  )
}
