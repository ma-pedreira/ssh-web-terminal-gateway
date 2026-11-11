export interface ForwardedHeaders {
  readonly forwardedFor?: string | null
  readonly realIp?: string | null
}

const MAX_LENGTH = 64
const MAPPED_IPV4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (trimmed.length === 0) return null
  const unwrapped = MAPPED_IPV4.exec(trimmed)?.[1] ?? trimmed
  return unwrapped.slice(0, MAX_LENGTH)
}

/**
 * Address of whoever made the request.
 *
 * X-Forwarded-For and X-Real-IP are written by the client unless a proxy
 * overwrites them, so they are only believed when the deployment declares a
 * trusted proxy in front. Otherwise the address of the TCP connection is the
 * only one that cannot be made up, and the audit trail records that one.
 */
export function resolveClientAddress(
  headers: ForwardedHeaders,
  socketAddress: string | undefined,
  trustProxy: boolean,
): string | null {
  if (trustProxy) {
    const first = headers.forwardedFor?.split(',')[0]
    return clean(first) ?? clean(headers.realIp) ?? clean(socketAddress)
  }
  return clean(socketAddress)
}
