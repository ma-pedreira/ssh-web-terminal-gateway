'use client'

import { useState } from 'react'
import { Button, Field, Notice, Panel } from '@/components/ui/primitives'

export interface SecretRequest {
  readonly alias: string
  readonly kind: 'password' | 'passphrase'
  readonly message: string
}

export type VaultState = 'disabled' | 'locked' | 'open'

export interface SecretAnswer {
  readonly secret: string
  readonly remember: boolean
  /** Application password, only when the vault needs opening. */
  readonly appPassword?: string
}

/**
 * Asks for the secret right before connecting. It only lives in this
 * component's state and is discarded on submit.
 *
 * The remember checkbox is always shown: if the vault is not open, it can be
 * unlocked right here without a detour to Settings.
 */
export function SecretPrompt({
  request,
  vaultState,
  onSubmit,
  onCancel,
}: {
  readonly request: SecretRequest
  readonly vaultState: VaultState
  readonly onSubmit: (answer: SecretAnswer) => void
  readonly onCancel: () => void
}) {
  const [secret, setSecret] = useState('')
  const [remember, setRemember] = useState(false)
  const [appPassword, setAppPassword] = useState('')

  const isPassword = request.kind === 'password'
  const needsVaultOpen = remember && vaultState !== 'open'
  const ready = secret.length > 0 && (!needsVaultOpen || appPassword.length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/85 p-6 backdrop-blur-sm">
      <div className="w-full max-w-sm">
        <Panel
          title={isPassword ? 'Remote password' : 'Passphrase'}
          className="glow-cyan"
        >
          <form
            className="flex flex-col gap-4 p-4"
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit({
                secret,
                remember,
                ...(needsVaultOpen ? { appPassword } : {}),
              })
              setSecret('')
              setAppPassword('')
            }}
          >
            <p className="text-[11px] text-ink-dim">
              {request.message} for <span className="text-cyan">{request.alias}</span>.
            </p>

            <Field
              label={isPassword ? `Password for ${request.alias}` : 'Passphrase'}
              type="password"
              autoComplete="off"
              autoFocus
              required
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
            />

            {isPassword ? (
              <label className="flex items-center gap-2 text-[11px] text-ink-dim">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                  className="size-3 accent-[var(--color-cyan)]"
                />
                Remember it so you do not type it again
              </label>
            ) : null}

            {needsVaultOpen ? (
              <>
                <Notice tone="amber">
                  {vaultState === 'disabled'
                    ? 'An encrypted vault will be created using your ssh-web password. Confirm it.'
                    : 'The vault is locked in this session. Confirm your ssh-web password to open it.'}
                </Notice>
                <Field
                  label="Your ssh-web password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={appPassword}
                  onChange={(event) => setAppPassword(event.target.value)}
                  hint="Not the remote server one: this is the password you sign in with"
                />
              </>
            ) : null}

            <Notice tone="cyan">
              {remember
                ? 'It will be stored encrypted, and only if the connection works.'
                : 'Not stored. It only travels as far as the handshake with the server.'}
            </Notice>

            <div className="flex gap-2">
              <Button type="submit" disabled={!ready}>
                Connect
              </Button>
              <Button type="button" tone="neutral" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  )
}
