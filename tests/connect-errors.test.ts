import { describe, expect, it } from 'vitest'
import { AuthenticationFailedError, SshConnectionError, describeSshError } from '#lib/ssh/connect'

describe('translating ssh2 errors', () => {
  it('recognises rejected credentials', () => {
    const error = describeSshError(new Error('All configured authentication methods failed'))
    expect(error).toBeInstanceOf(AuthenticationFailedError)
    expect(error.message).toMatch(/rejected the credentials/i)
  })

  it('explains that the server refuses connections', () => {
    const error = describeSshError(
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:22'), { code: 'ECONNREFUSED' }),
    )
    expect(error).toBeInstanceOf(SshConnectionError)
    expect(error.message).toMatch(/not accepting connections/i)
  })

  it('explains that the name does not resolve', () => {
    const error = describeSshError(
      Object.assign(new Error('getaddrinfo ENOTFOUND nas.local'), { code: 'ENOTFOUND' }),
    )
    expect(error.message).toMatch(/could not be resolved/i)
  })

  it('explains a timeout', () => {
    const error = describeSshError(new Error('Timed out while waiting for handshake'))
    expect(error).toBeInstanceOf(SshConnectionError)
    expect(error.message).toMatch(/did not respond in time/i)
  })

  it('keeps the original message when it is not recognised', () => {
    const error = describeSshError(new Error('something odd in the protocol'))
    expect(error).toBeInstanceOf(SshConnectionError)
    expect(error.message).toContain('something odd in the protocol')
  })

  it('accepts values that are not Error', () => {
    expect(describeSshError('loose failure').message).toContain('loose failure')
  })
})
