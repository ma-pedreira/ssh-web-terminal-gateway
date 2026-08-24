'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { api } from '@/client/api'
import { Notice } from '@/components/ui/primitives'
import { TerminalView } from '@/components/terminal/TerminalView'
import type { SshSession } from '#types'

export default function TerminalPage() {
  const router = useRouter()
  const params = useParams<{ sessionId: string }>()
  const sessionId = params.sessionId
  const [title, setTitle] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) return
    api<{ session: SshSession; resumable: boolean }>(`/api/sessions/${sessionId}`)
      .then(({ session, resumable }) => {
        if (!resumable) {
          setError('This session is no longer alive on the server.')
          return
        }
        setTitle(`${session.hostUser ?? 'root'}@${session.hostname}:${session.port}`)
      })
      .catch(() => setError('Could not open the session.'))
  }, [sessionId])

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="flex max-w-sm flex-col gap-3">
          <Notice tone="rose">{error}</Notice>
          <button className="label-tech text-left hover:text-cyan" onClick={() => router.replace('/')}>
            Volver al panel
          </button>
        </div>
      </main>
    )
  }

  if (!title || !sessionId) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="label-tech">Linking terminal</p>
      </main>
    )
  }

  return <TerminalView sessionId={sessionId} title={title} onExit={() => router.push('/')} />
}
