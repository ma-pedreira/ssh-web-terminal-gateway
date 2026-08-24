import { SESSION_TTL_HOURS } from '#lib/auth/session'

export const SESSION_COOKIE = 'ssh_web_session'
/** Readable by the browser on purpose: it is echoed back as the CSRF header. */
export const CSRF_COOKIE = 'ssh_web_csrf'

/** Parses the Cookie header with no framework dependency. */
export function parseCookies(header: string | null | undefined): Readonly<Record<string, string>> {
  if (!header) return Object.freeze({})

  const entries = header
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const index = part.indexOf('=')
      if (index < 1) return null
      const name = part.slice(0, index).trim()
      const value = part.slice(index + 1).trim()
      try {
        return [name, decodeURIComponent(value)] as const
      } catch {
        return [name, value] as const
      }
    })
    .filter((entry): entry is readonly [string, string] => entry !== null)

  return Object.freeze(Object.fromEntries(entries))
}

interface CookieOptions {
  readonly secure: boolean
  readonly maxAgeSeconds?: number
  readonly httpOnly?: boolean
}

function serialize(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'SameSite=Strict']
  if (options.httpOnly !== false) parts.push('HttpOnly')
  if (options.secure) parts.push('Secure')
  parts.push(`Max-Age=${options.maxAgeSeconds ?? SESSION_TTL_HOURS * 3600}`)
  return parts.join('; ')
}

export function sessionCookie(token: string, secure: boolean): string {
  return serialize(SESSION_COOKIE, token, { secure })
}

/** No HttpOnly: the client must be able to read it for the double submit. */
export function csrfCookie(token: string, secure: boolean): string {
  return serialize(CSRF_COOKIE, token, { secure, httpOnly: false })
}

export function expiredCookies(secure: boolean): readonly string[] {
  return Object.freeze([
    serialize(SESSION_COOKIE, '', { secure, maxAgeSeconds: 0 }),
    serialize(CSRF_COOKIE, '', { secure, maxAgeSeconds: 0, httpOnly: false }),
  ])
}
