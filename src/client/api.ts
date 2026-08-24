'use client'

import type { ApiResponse } from '#types'

const CSRF_COOKIE = 'ssh_web_csrf'
const CSRF_HEADER = 'x-ssh-web-csrf'

function csrfToken(): string {
  const match = document.cookie.split(';').find((part) => part.trim().startsWith(`${CSRF_COOKIE}=`))
  return match ? decodeURIComponent(match.split('=').slice(1).join('=').trim()) : ''
}

export class ApiRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

/** Single API client: attaches the CSRF token and unwraps the response. */
export async function api<T>(
  path: string,
  options: { readonly method?: string; readonly body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = {}

  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET' && method !== 'HEAD') headers[CSRF_HEADER] = csrfToken()

  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  let payload: ApiResponse<T>
  try {
    payload = (await response.json()) as ApiResponse<T>
  } catch {
    throw new ApiRequestError('Unreadable response from the server', response.status)
  }

  if (!response.ok || !payload.success) {
    throw new ApiRequestError(payload.error ?? 'The request failed', response.status)
  }

  return payload.data as T
}
