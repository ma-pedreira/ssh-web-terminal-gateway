/** API response contract, shared by every route. */
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export type SshSessionStatus = 'connecting' | 'active' | 'suspended' | 'closed' | 'failed'

export interface User {
  readonly id: string
  readonly username: string
  readonly createdAt: string
  readonly lastLoginAt: string | null
}

/**
 * A host as the interface sees it. It comes from ~/.ssh/config, not from the
 * database: the application keeps no inventory of its own.
 */
export interface ConfiguredHost {
  readonly alias: string
  readonly hostname: string
  readonly user: string | null
  readonly port: number
  readonly identityFile: string | null
  /** Directives in the file that the application does not interpret. */
  readonly extra: Readonly<Record<string, string>>
  /** Whether the key given in IdentityFile exists and is readable. */
  readonly identityReadable: boolean
  /** Whether a fingerprint is already pinned for this host in known_hosts. */
  readonly known: boolean
}

export interface SshSession {
  readonly id: string
  readonly userId: string
  readonly hostAlias: string
  readonly hostname: string
  readonly hostUser: string | null
  readonly port: number
  readonly status: SshSessionStatus
  readonly clientIp: string | null
  readonly startedAt: string
  readonly lastActivityAt: string
  readonly endedAt: string | null
  readonly exitCode: number | null
  readonly closeReason: string | null
}

export interface SessionSummary extends SshSession {
  readonly resumable: boolean
}

export type AuditAction =
  | 'user.login'
  | 'user.login.failed'
  | 'user.logout'
  | 'host.created'
  | 'host.updated'
  | 'host.deleted'
  | 'credential.stored'
  | 'credential.deleted'
  | 'settings.updated'
  | 'history.cleared'
  | 'session.opened'
  | 'session.attached'
  | 'session.detached'
  | 'session.closed'
  | 'session.failed'
  | 'hostkey.pinned'
  | 'hostkey.mismatch'
  | 'hostkey.forgotten'

export interface AuditEntry {
  readonly id: number
  readonly userId: string | null
  readonly action: AuditAction
  readonly targetId: string | null
  readonly clientIp: string | null
  readonly detail: string | null
  readonly createdAt: string
}
