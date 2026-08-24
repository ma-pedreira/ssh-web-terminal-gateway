'use client'

import { useEffect, useState } from 'react'
import { api, ApiRequestError } from '@/client/api'
import { Button, Field, Notice, Panel, Select } from '@/components/ui/primitives'

export function HostForm({ onCreated }: { readonly onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [keys, setKeys] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    api<{ keys: readonly string[] }>('/api/keys')
      .then((data) => setKeys(data.keys))
      .catch(() => setKeys([]))
  }, [open])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const form = new FormData(event.currentTarget)
    const identityFile = String(form.get('identityFile') ?? '')

    try {
      await api('/api/hosts', {
        method: 'POST',
        body: {
          alias: String(form.get('alias') ?? ''),
          hostname: String(form.get('hostname') ?? ''),
          port: Number(form.get('port') ?? 22),
          user: String(form.get('user') ?? ''),
          identityFile: identityFile.length > 0 ? identityFile : undefined,
        },
      })
      setOpen(false)
      onCreated()
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Unexpected error')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button tone="violet" onClick={() => setOpen(true)}>
        + Add host
      </Button>
    )
  }

  return (
    <Panel title="New host" className="w-full">
      <form onSubmit={submit} className="grid gap-4 p-4 sm:grid-cols-2">
        <Field
          label="Alias"
          name="alias"
          required
          placeholder="servidor-casa"
          hint="The name of the Host block in ~/.ssh/config"
        />
        <Field
          label="Host or IP"
          name="hostname"
          required
          placeholder="192.168.0.50"
          hint="IPv4, IPv6 or host name"
        />
        <Field label="Port" name="port" type="number" defaultValue={22} min={1} max={65535} />
        <Field label="Remote user" name="user" required placeholder="debian" />

        <div className="sm:col-span-2">
          <Select label="Private key (IdentityFile)" name="identityFile" defaultValue="">
            <option value="">None: it will ask for a password on connect</option>
            {keys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </Select>
        </div>

        {keys.length === 0 ? (
          <div className="sm:col-span-2">
            <Notice tone="cyan">
              There are no keys in the mounted directory. Without one, the password is asked for on
              every connection and is not stored anywhere.
            </Notice>
          </div>
        ) : null}

        {error ? (
          <div className="sm:col-span-2">
            <Notice tone="rose">{error}</Notice>
          </div>
        ) : null}

        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving' : 'Save to ~/.ssh/config'}
          </Button>
          <Button type="button" tone="neutral" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Panel>
  )
}
