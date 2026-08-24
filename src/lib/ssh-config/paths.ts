import { isAbsolute, join, normalize, resolve, sep } from 'node:path'

/**
 * Translates the IdentityFile value into a real path inside the mounted keys
 * directory. This is a security control: the application must never open a
 * file outside that directory, even if the configuration file asks it to.
 */
export function resolveIdentityPath(identityFile: string, keysDir: string): string {
  const value = identityFile.trim()
  if (value.length === 0) {
    throw new Error('Empty IdentityFile')
  }

  const root = resolve(keysDir)

  // The usual ~/.ssh/... notation is rewritten to the mounted directory.
  const relative = value.startsWith('~/')
    ? value.replace(/^~\/(\.ssh\/)?/, '')
    : value

  const candidate = isAbsolute(relative) ? normalize(relative) : resolve(root, normalize(relative))

  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new Error(
      `The key "${identityFile}" falls outside the allowed keys directory (${keysDir})`,
    )
  }

  return candidate
}

/** Path of the configuration file inside the SSH directory. */
export function configPath(sshDir: string): string {
  return join(sshDir, 'config')
}

/** Path of the known_hosts file inside the SSH directory. */
export function knownHostsPath(sshDir: string): string {
  return join(sshDir, 'known_hosts')
}
