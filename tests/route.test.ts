import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { PathNotAllowedError } from '#lib/paths/containment'
import { ApiError, fail, ok } from '#lib/api/respond'
import { jsonBody, route } from '#lib/api/route'
import {
  AuthenticationFailedError,
  HostKeyMismatchError,
  MissingSecretError,
  SshConnectionError,
} from '#lib/ssh/connect'

const req = (body?: string, method = 'POST') =>
  new Request('http://localhost:3030/api/x', { method, body })

describe('API responses', () => {
  it('wraps the data with success true and no caching', async () => {
    const response = ok({ valor: 1 })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({ success: true, data: { valor: 1 } })
  })

  it('returns the error with its status', async () => {
    const response = fail('broken', 418)
    expect(response.status).toBe(418)
    await expect(response.json()).resolves.toEqual({ success: false, error: 'broken' })
  })
})

describe('route wrapper', () => {
  it('lets a successful response through', async () => {
    const handler = route(async () => ok({ ok: true }))
    expect((await handler(req(), {})).status).toBe(200)
  })

  it('translates ApiError to its status', async () => {
    const handler = route(async () => {
      throw new ApiError('not found', 404)
    })
    const response = await handler(req(), {})
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'not found' })
  })

  it('translates validation errors to 422 using the form label', async () => {
    const handler = route(async () => {
      z.object({ port: z.number() }).parse({ port: 'not-a-number' })
      return ok({})
    })
    const response = await handler(req(), {})
    expect(response.status).toBe(422)
    const payload = (await response.json()) as { error: string }
    // "Port", not "port": the internal name means nothing to the user.
    expect(payload.error).toContain('Port')
    expect(payload.error).not.toContain('port:')
  })

  it('omits the prefix when the field has no known label', async () => {
    const handler = route(async () => {
      z.object({ internalField: z.number() }).parse({ internalField: 'x' })
      return ok({})
    })
    const payload = (await (await handler(req(), {})).json()) as { error: string }
    expect(payload.error).not.toContain('internalField')
  })

  it('translates a changed server key to 409', async () => {
    const handler = route(async () => {
      throw new HostKeyMismatchError('nas.local')
    })
    const response = await handler(req(), {})
    expect(response.status).toBe(409)
  })

  it('translates a missing secret to 428 so the interface asks for it', async () => {
    const handler = route(async () => {
      throw new MissingSecretError('password')
    })
    const response = await handler(req(), {})
    expect(response.status).toBe(428)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toMatch(/password/i)
  })

  it('a rejected secret also asks for a retry, it does not sign you out', async () => {
    const handler = route(async () => {
      throw new AuthenticationFailedError()
    })
    const response = await handler(req(), {})
    // 401 would end the app session, which is not what failed.
    expect(response.status).toBe(428)
    await expect(response.json()).resolves.toMatchObject({ success: false })
  })

  it('a network failure of the remote host is reported as 502 with its reason', async () => {
    const handler = route(async () => {
      throw new SshConnectionError('The server is not accepting connections on that port')
    })
    const response = await handler(req(), {})
    expect(response.status).toBe(502)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toMatch(/not accepting connections/i)
  })

  it('does not leak internal detail on an unexpected error', async () => {
    const handler = route(async () => {
      throw new Error('the database password is hunter2')
    })
    const response = await handler(req(), {})
    expect(response.status).toBe(500)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toBe('Internal server error')
    expect(payload.error).not.toContain('hunter2')
  })
})

describe('JSON body', () => {
  it('parses an object', async () => {
    await expect(jsonBody(req('{"a":1}'))).resolves.toEqual({ a: 1 })
  })

  it('treats an empty body as an empty object', async () => {
    await expect(jsonBody(req(''))).resolves.toEqual({})
  })

  it('rejects invalid JSON', async () => {
    await expect(jsonBody(req('{not-json'))).rejects.toThrow(/JSON/i)
  })

  it('rejects bodies that are too large', async () => {
    await expect(jsonBody(req(`"${'x'.repeat(200)}"`), 100)).rejects.toThrow(/too large/i)
  })
})

describe('forbidden paths', () => {
  it('are reported as 422 with the allowed folders in the message', async () => {
    const handler = route(async () => {
      throw new PathNotAllowedError(
        'sshDir: The path "/etc" is not inside any allowed folder (/home/u)',
        '/etc',
        ['/home/u'],
      )
    })
    const response = await handler(req(), {})
    expect(response.status).toBe(422)
    const payload = (await response.json()) as { error: string }
    expect(payload.error).toContain('/home/u')
    expect(payload.error).toContain('sshDir')
  })
})
