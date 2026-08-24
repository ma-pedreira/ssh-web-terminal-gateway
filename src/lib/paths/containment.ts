import { posix, win32 } from 'node:path'

export type Platform = 'win32' | 'linux' | 'darwin' | NodeJS.Platform

/** The path chosen by the user is not inside any allowed folder. */
export class PathNotAllowedError extends Error {
  readonly attempted: string
  readonly roots: readonly string[]

  constructor(message: string, attempted: string, roots: readonly string[]) {
    super(message)
    this.name = 'PathNotAllowedError'
    this.attempted = attempted
    this.roots = roots
  }
}

function engineFor(platform: Platform) {
  return platform === 'win32' ? win32 : posix
}

/** Windows paths are case-insensitive; Linux paths are not. */
function normalizeCase(value: string, platform: Platform): string {
  return platform === 'win32' ? value.toLowerCase() : value
}

/**
 * Checks that an already-resolved path falls inside a root.
 * Compares segment by segment instead of by text prefix: a prefix check would
 * accept "/home/user/.ssh-evil" against "/home/user/.ssh".
 */
export function isInside(candidate: string, root: string, platform: Platform = process.platform): boolean {
  const engine = engineFor(platform)
  const from = engine.resolve(normalizeCase(root, platform))
  const to = engine.resolve(normalizeCase(candidate, platform))

  if (from === to) return true

  const relative = engine.relative(from, to)
  return (
    relative.length > 0 &&
    !relative.startsWith('..') &&
    !engine.isAbsolute(relative)
  )
}

/**
 * Resolves a user-chosen path and requires it to fall inside one of the
 * allowed roots. This is the control that stops the settings screen from
 * becoming arbitrary write access to the disk.
 */
export function resolveInsideAny(
  candidate: string,
  roots: readonly string[],
  platform: Platform = process.platform,
): string {
  if (candidate.includes('\0')) {
    throw new PathNotAllowedError('The path contains characters that are not allowed', candidate, roots)
  }
  if (roots.length === 0) {
    throw new PathNotAllowedError('No allowed folder has been configured', candidate, roots)
  }

  const engine = engineFor(platform)
  if (!engine.isAbsolute(candidate)) {
    throw new PathNotAllowedError(`The path must be absolute: "${candidate}"`, candidate, roots)
  }

  const resolved = engine.resolve(candidate)
  if (roots.some((root) => isInside(resolved, root, platform))) return resolved

  throw new PathNotAllowedError(
    `The path "${candidate}" is not inside any allowed folder (${roots.join(', ')})`,
    candidate,
    roots,
  )
}
