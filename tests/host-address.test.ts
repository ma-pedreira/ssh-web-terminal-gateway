import { describe, expect, it } from 'vitest'
import { validateHostAddress } from '#lib/validation/host-address'

const ok = (value: string) => validateHostAddress(value).ok
const reason = (value: string) => {
  const r = validateHostAddress(value)
  return r.ok ? '' : r.reason
}

describe('IPv4 addresses', () => {
  it('accepts well-formed ones', () => {
    for (const ip of ['192.168.0.50', '10.0.0.1', '127.0.0.1', '8.8.8.8', '172.16.31.254']) {
      expect(ok(ip)).toBe(true)
    }
  })

  it('recognises them as IPv4', () => {
    const r = validateHostAddress('192.168.0.50')
    expect(r.ok && r.kind).toBe('ipv4')
  })

  it('rejects out-of-range octets', () => {
    for (const ip of ['192.168.1.300', '256.1.1.1', '1.1.1.999']) {
      expect(ok(ip)).toBe(false)
      expect(reason(ip)).toMatch(/between 0 and 255/i)
    }
  })

  it('rejects the wrong number of octets', () => {
    expect(ok('192.168.1')).toBe(false)
    expect(reason('192.168.1')).toMatch(/four numbers/i)
    expect(ok('192.168.1.1.1')).toBe(false)
  })

  it('rejects leading zeros, which some systems read as octal', () => {
    expect(ok('010.0.0.1')).toBe(false)
    expect(reason('010.0.0.1')).toMatch(/leading zeros/i)
    expect(ok('192.168.01.1')).toBe(false)
  })

  it('accepts a bare zero as an octet', () => {
    expect(ok('10.0.0.1')).toBe(true)
  })

  it('rejects addresses that are useless as a destination', () => {
    expect(reason('0.0.0.0')).toMatch(/does not identify/i)
    expect(reason('255.255.255.255')).toMatch(/broadcast/i)
    expect(reason('224.0.0.1')).toMatch(/[Mm]ulticast/)
    expect(reason('239.255.255.250')).toMatch(/[Mm]ulticast/)
  })

  it('accepts loopback: it is valid through a tunnel', () => {
    expect(ok('127.0.0.1')).toBe(true)
  })
})

describe('IPv6 addresses', () => {
  it('accepts well-formed ones', () => {
    for (const ip of ['::1', '2001:db8::1', 'fe80::1', '2001:0db8:0000:0000:0000:0000:0000:0001']) {
      expect(ok(ip)).toBe(true)
    }
  })

  it('recognises them as IPv6', () => {
    const r = validateHostAddress('2001:db8::1')
    expect(r.ok && r.kind).toBe('ipv6')
  })

  it('rejects malformed ones', () => {
    for (const ip of ['2001:db8:::1', 'gggg::1', '2001:db8::1::2', ':::']) {
      expect(ok(ip)).toBe(false)
    }
  })

  it('rejects the unspecified address', () => {
    expect(reason('::')).toMatch(/does not identify/i)
  })
})

describe('host names', () => {
  it('accepts ordinary ones', () => {
    for (const h of ['nas.local', 'server', 'my-vps.example.com', 'a.b.c.d.example.org']) {
      expect(ok(h)).toBe(true)
    }
  })

  it('recognises them as a name', () => {
    const r = validateHostAddress('nas.local')
    expect(r.ok && r.kind).toBe('hostname')
  })

  it('rejects empty labels', () => {
    expect(ok('a..b')).toBe(false)
    expect(ok('.nas.local')).toBe(false)
    expect(ok('nas.local.')).toBe(false)
  })

  it('rejects hyphens at either end of a label', () => {
    expect(ok('-nas.local')).toBe(false)
    expect(ok('nas-.local')).toBe(false)
    expect(ok('nas.-local')).toBe(false)
  })

  it('rejects labels longer than 63 characters', () => {
    expect(ok(`${'a'.repeat(64)}.com`)).toBe(false)
    expect(ok(`${'a'.repeat(63)}.com`)).toBe(true)
  })

  it('rejects names longer than 253 characters', () => {
    expect(ok(`${'a'.repeat(60)}.`.repeat(5) + 'com')).toBe(false)
  })

  it('rejects characters that have no business in a host name', () => {
    for (const h of ['host with space', 'ssh://host', 'host;rm -rf /', 'host|cat', '$(whoami)', 'h\u00f3st']) {
      expect(ok(h)).toBe(false)
    }
  })

  it('rejects something that looks like an IP but is not', () => {
    // All digits and dots: an IP was intended, so it is validated as one.
    expect(ok('1.2.3.4.5')).toBe(false)
    expect(ok('999.999.999.999')).toBe(false)
  })

  it('rejects the empty value', () => {
    expect(ok('')).toBe(false)
    expect(ok('   ')).toBe(false)
  })
})
