import { describe, expect, it } from 'vitest'
import { isInside, resolveInsideAny } from '#lib/paths/containment'

describe('path containment on Linux', () => {
  const root = '/home/usuario/.ssh'

  it('accepts the directory itself and anything under it', () => {
    expect(isInside('/home/usuario/.ssh', root, 'linux')).toBe(true)
    expect(isInside('/home/usuario/.ssh/config', root, 'linux')).toBe(true)
    expect(isInside('/home/usuario/.ssh/sub/clave', root, 'linux')).toBe(true)
  })

  it('rejects anything outside', () => {
    expect(isInside('/etc/shadow', root, 'linux')).toBe(false)
    expect(isInside('/home/usuario', root, 'linux')).toBe(false)
  })

  it('rejects a prefix that merely looks similar', () => {
    expect(isInside('/home/usuario/.sshhh/x', root, 'linux')).toBe(false)
    expect(isInside('/home/usuario/.ssh-falso', root, 'linux')).toBe(false)
  })

  it('is case sensitive, as Linux is', () => {
    expect(isInside('/home/usuario/.SSH/config', root, 'linux')).toBe(false)
  })
})

describe('path containment on Windows', () => {
  const root = 'C:\\Users\\pepe\\.ssh'

  it('accepts anything under the directory', () => {
    expect(isInside('C:\\Users\\pepe\\.ssh\\config', root, 'win32')).toBe(true)
  })

  it('ignores case, as Windows does', () => {
    expect(isInside('c:\\users\\PEPE\\.SSH\\config', root, 'win32')).toBe(true)
    expect(isInside('C:\\Users\\Pepe\\.Ssh', root, 'win32')).toBe(true)
  })

  it('rejects a different drive', () => {
    expect(isInside('D:\\Users\\pepe\\.ssh\\config', root, 'win32')).toBe(false)
  })

  it('rejects a prefix that merely looks similar', () => {
    expect(isInside('C:\\Users\\pepe\\.ssh-falso\\x', root, 'win32')).toBe(false)
  })

  it('rejects unrelated UNC paths', () => {
    expect(isInside('\\\\servidor\\compartido\\x', root, 'win32')).toBe(false)
  })
})

describe('resolving against several allowed roots', () => {
  const roots = ['/home/usuario/.ssh', '/datos/ssh-web']

  it('returns the normalised path when it is inside a root', () => {
    expect(resolveInsideAny('/datos/ssh-web/vault.enc', roots, 'linux')).toBe(
      '/datos/ssh-web/vault.enc',
    )
  })

  it('resolves dot segments before checking', () => {
    expect(resolveInsideAny('/datos/ssh-web/sub/../vault.enc', roots, 'linux')).toBe(
      '/datos/ssh-web/vault.enc',
    )
  })

  it('rejects escaping with dot segments', () => {
    expect(() => resolveInsideAny('/datos/ssh-web/../../etc/shadow', roots, 'linux')).toThrow(
      /allowed folder/i,
    )
  })

  it('rejects a path that is in no root', () => {
    expect(() => resolveInsideAny('/var/tmp/x', roots, 'linux')).toThrow(/allowed folder/i)
  })

  it('names the allowed roots in the error', () => {
    expect(() => resolveInsideAny('/var/tmp/x', roots, 'linux')).toThrow(/\/home\/usuario\/\.ssh/)
  })

  it('rejects relative paths: they must be absolute', () => {
    expect(() => resolveInsideAny('relativa/x', roots, 'linux')).toThrow(/absolute/i)
  })

  it('rejects an empty list of roots', () => {
    expect(() => resolveInsideAny('/x', [], 'linux')).toThrow()
  })

  it('rejects a null byte', () => {
    expect(() => resolveInsideAny('/datos/ssh-web/x\0y', roots, 'linux')).toThrow()
  })
})
