import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

export type Platform = NodeJS.Platform

export function isWindows(platform: Platform = process.platform): boolean {
  return platform === 'win32'
}

/**
 * Inside the container the paths are set by docker-compose through environment
 * variables. Outside, the usual folders for each system are used.
 */
export function inContainer(): boolean {
  return existsSync('/.dockerenv') || process.env.SSH_WEB_IN_CONTAINER === 'true'
}

export function homeDirectory(): string {
  return process.env.SSH_WEB_HOME ?? homedir()
}

/** OpenSSH folder: the same relative path on Windows and on Linux. */
export function defaultSshDir(platform: Platform = process.platform): string {
  if (inContainer()) return '/ssh'
  void platform
  return join(homeDirectory(), '.ssh')
}

export function defaultKeysDir(platform: Platform = process.platform): string {
  if (inContainer()) return '/ssh-keys'
  return defaultSshDir(platform)
}

/** Application settings: %APPDATA% on Windows, ~/.config elsewhere. */
export function defaultConfigDir(platform: Platform = process.platform): string {
  if (inContainer()) return '/data'
  if (isWindows(platform)) {
    return join(process.env.APPDATA ?? join(homeDirectory(), 'AppData', 'Roaming'), 'ssh-web')
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homeDirectory(), '.config'), 'ssh-web')
}

export function defaultDataDir(platform: Platform = process.platform): string {
  if (inContainer()) return '/data'
  if (isWindows(platform)) {
    return join(process.env.LOCALAPPDATA ?? join(homeDirectory(), 'AppData', 'Local'), 'ssh-web')
  }
  return join(process.env.XDG_DATA_HOME ?? join(homeDirectory(), '.local', 'share'), 'ssh-web')
}

/**
 * Folders the user may choose from the settings screen. This is the boundary
 * that stops the web interface from becoming arbitrary write access to disk.
 */
export function defaultAllowedRoots(platform: Platform = process.platform): readonly string[] {
  if (inContainer()) return Object.freeze(['/data', '/ssh', '/ssh-keys'])
  return Object.freeze([homeDirectory(), defaultConfigDir(platform), defaultDataDir(platform)])
}

/**
 * Restrictive file modes only have an effect on Unix systems. On Windows the
 * equivalent protection is NTFS ACLs, inherited from the containing folder;
 * that is why the vault lives under the user's profile.
 */
export function fileMode(mode: number, platform: Platform = process.platform): number | undefined {
  return isWindows(platform) ? undefined : mode
}
