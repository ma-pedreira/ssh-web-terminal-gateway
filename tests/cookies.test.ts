import { describe, expect, it } from 'vitest'
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  csrfCookie,
  expiredCookies,
  parseCookies,
  sessionCookie,
} from '#lib/auth/cookies'

describe('cookies', () => {
  it('parses several cookies', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' })
  })

  it('returns empty with no header', () => {
    expect(parseCookies(null)).toEqual({})
    expect(parseCookies(undefined)).toEqual({})
    expect(parseCookies('')).toEqual({})
  })

  it('decodes values and tolerates badly encoded ones', () => {
    expect(parseCookies('t=a%20b')).toEqual({ t: 'a b' })
    expect(parseCookies('t=%E0%A4%A')).toEqual({ t: '%E0%A4%A' })
  })

  it('keeps an equals sign inside the value', () => {
    expect(parseCookies('t=abc==')).toEqual({ t: 'abc==' })
  })

  it('ignores nameless fragments', () => {
    expect(parseCookies('=huerfano; b=2')).toEqual({ b: '2' })
    expect(parseCookies('suelto; b=2')).toEqual({ b: '2' })
  })

  it('the session cookie is HttpOnly and SameSite strict', () => {
    const cookie = sessionCookie('token-de-sesion', false)
    expect(cookie).toContain(`${SESSION_COOKIE}=token-de-sesion`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Secure')
  })

  it('adds Secure when served over HTTPS', () => {
    expect(sessionCookie('t', true)).toContain('Secure')
  })

  it('the CSRF cookie is not HttpOnly: the client must read it', () => {
    const cookie = csrfCookie('token-csrf', true)
    expect(cookie).toContain(`${CSRF_COOKIE}=token-csrf`)
    expect(cookie).not.toContain('HttpOnly')
    expect(cookie).toContain('Secure')
  })

  it('signing out expires both cookies', () => {
    const cookies = expiredCookies(false)
    expect(cookies).toHaveLength(2)
    expect(cookies.every((cookie) => cookie.includes('Max-Age=0'))).toBe(true)
  })
})
