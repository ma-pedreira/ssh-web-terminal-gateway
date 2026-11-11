import { describe, expect, it } from 'vitest'
import { resolveClientAddress } from '#lib/api/client-address'

describe('resolveClientAddress', () => {
  it('uses the socket address and ignores forwarded headers by default', () => {
    // Anyone can send X-Forwarded-For: without a proxy in front it is just
    // a way of writing a false address into the audit trail.
    const address = resolveClientAddress(
      { forwardedFor: '203.0.113.7', realIp: '198.51.100.4' },
      '192.168.0.50',
      false,
    )
    expect(address).toBe('192.168.0.50')
  })

  it('honours the proxy headers when a trusted proxy is declared', () => {
    expect(resolveClientAddress({ forwardedFor: '203.0.113.7, 10.0.0.1' }, '172.18.0.2', true)).toBe(
      '203.0.113.7',
    )
    expect(resolveClientAddress({ realIp: '198.51.100.4' }, '172.18.0.2', true)).toBe('198.51.100.4')
  })

  it('falls back to the socket address when the proxy sent nothing', () => {
    expect(resolveClientAddress({}, '172.18.0.2', true)).toBe('172.18.0.2')
  })

  it('unwraps IPv4 addresses mapped into IPv6', () => {
    expect(resolveClientAddress({}, '::ffff:192.168.0.50', false)).toBe('192.168.0.50')
  })

  it('returns null when nothing is known and caps absurd values', () => {
    expect(resolveClientAddress({}, undefined, false)).toBeNull()
    expect(resolveClientAddress({ forwardedFor: '9'.repeat(200) }, undefined, true)).toHaveLength(64)
  })
})
