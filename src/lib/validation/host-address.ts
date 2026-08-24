export type AddressKind = 'ipv4' | 'ipv6' | 'hostname'

export type AddressResult =
  | { readonly ok: true; readonly kind: AddressKind; readonly value: string }
  | { readonly ok: false; readonly reason: string }

const DIGITS_AND_DOTS = /^[0-9.]+$/
const LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/

function reject(reason: string): AddressResult {
  return { ok: false, reason }
}

/**
 * Validates a real IPv4 address, not just the character set.
 *
 * Leading zeros are rejected because some resolvers read them as octal:
 * 010.0.0.1 would not be 10.0.0.1 but 8.0.0.1, and that silent difference
 * can point a connection at a different machine than intended.
 */
function validateIpv4(value: string): AddressResult {
  const parts = value.split('.')
  if (parts.length !== 4) {
    return reject('An IPv4 address has four numbers separated by dots')
  }

  const octets: number[] = []
  for (const part of parts) {
    if (part.length === 0 || !/^[0-9]+$/.test(part)) {
      return reject('An IPv4 address contains only digits and dots')
    }
    if (part.length > 1 && part.startsWith('0')) {
      return reject('No leading zeros: some systems read them as octal')
    }
    const number = Number(part)
    if (number > 255) {
      return reject('Each number in an IPv4 address must be between 0 and 255')
    }
    octets.push(number)
  }

  const [a, b, c, d] = octets as [number, number, number, number]

  if (a === 0 && b === 0 && c === 0 && d === 0) {
    return reject('0.0.0.0 does not identify any machine')
  }
  if (a === 255 && b === 255 && c === 255 && d === 255) {
    return reject('255.255.255.255 is the broadcast address, not a destination')
  }
  if (a >= 224 && a <= 239) {
    return reject('Multicast addresses cannot be used as an SSH destination')
  }

  return { ok: true, kind: 'ipv4', value }
}

/** Validates IPv6, accepting the shorthand "::" at most once. */
function validateIpv6(value: string): AddressResult {
  const generic = reject('That is not a valid IPv6 address')

  const shorthands = value.split('::').length - 1
  if (shorthands > 1) return generic

  const [left = '', right = ''] = shorthands === 1 ? value.split('::') : [value, '']
  const groupsOf = (text: string) => (text.length === 0 ? [] : text.split(':'))

  const groups = [...groupsOf(left), ...(shorthands === 1 ? groupsOf(right) : [])]

  if (groups.some((group) => !/^[0-9A-Fa-f]{1,4}$/.test(group))) return generic

  if (shorthands === 1) {
    if (groups.length > 7) return generic
  } else if (groups.length !== 8) {
    return generic
  }

  if (groups.length === 0) {
    return reject(':: does not identify any machine')
  }

  return { ok: true, kind: 'ipv6', value }
}

function validateHostname(value: string): AddressResult {
  if (value.length > 253) {
    return reject('A host name cannot exceed 253 characters')
  }

  for (const label of value.split('.')) {
    if (label.length === 0) {
      return reject('The name has an extra dot, or starts or ends with one')
    }
    if (label.length > 63) {
      return reject('Each part of the name can be at most 63 characters')
    }
    if (!LABEL.test(label)) {
      return reject('Only unaccented letters, digits and hyphens, not at either end')
    }
  }

  return { ok: true, kind: 'hostname', value }
}

/**
 * Checks that the typed value works as a destination: an IPv4, an IPv6 or a
 * host name. Anything that looks like an IP address is validated as one,
 * instead of slipping through because it also looks like a name.
 */
export function validateHostAddress(input: string): AddressResult {
  const value = input.trim()

  if (value.length === 0) return reject('Enter the host address')
  if (value.includes(':')) return validateIpv6(value)
  if (DIGITS_AND_DOTS.test(value)) return validateIpv4(value)

  return validateHostname(value)
}
