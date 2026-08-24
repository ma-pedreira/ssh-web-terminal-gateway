'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiRequestError } from '@/client/api'
import { Button, Field, Notice, Panel } from '@/components/ui/primitives'
import { Brand } from '@/components/ui/Brand'

export default function LoginPage() {
  const router = useRouter()
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ needsSetup: boolean }>('/api/setup')
      .then((data) => setNeedsSetup(data.needsSetup))
      .catch(() => setNeedsSetup(false))
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (needsSetup) {
        await api('/api/setup', { method: 'POST', body: { username, password } })
      }
      await api('/api/auth/login', { method: 'POST', body: { username, password } })
      router.replace('/')
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Unexpected error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-baseline justify-between gap-2">
          <Brand interactive={false} />
          <span className="label-tech">terminal gateway</span>
        </div>

        <Panel title={needsSetup ? 'First-time setup' : 'Sign in'} className="glow-cyan">
          <form onSubmit={submit} className="flex flex-col gap-4 p-4">
            {needsSetup ? (
              <Notice tone="amber">
                There is no user yet. The first account created becomes the administrator and
                sign-up is then closed for good.
              </Notice>
            ) : null}

            <Field
              label="Username"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
            <Field
              label="Password"
              type="password"
              autoComplete={needsSetup ? 'new-password' : 'current-password'}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              hint={needsSetup ? 'At least 12 characters' : undefined}
            />

            {error ? <Notice tone="rose">{error}</Notice> : null}

            <Button type="submit" disabled={busy || needsSetup === null}>
              {busy ? 'Checking' : needsSetup ? 'Create account' : 'Sign in'}
            </Button>
          </form>
        </Panel>

        <p className="mt-4 text-[10px] leading-relaxed text-ink-faint">
          Your hosts live in ~/.ssh/config. Passwords are never stored unless you choose to,
          and then only encrypted with this password.
        </p>
      </div>
    </main>
  )
}
