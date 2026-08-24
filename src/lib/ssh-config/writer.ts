import { parseConfig } from '#lib/ssh-config/parser'
import { DEFAULT_PORT, type HostBlock, type SshConfig } from '#lib/ssh-config/types'

export interface HostEntry {
  readonly alias: string
  readonly hostname: string
  readonly user: string | null
  readonly port: number
  readonly identityFile: string | null
}

const INDENT = '    '

// Characters that would break a directive and allow writing others.
const CONTROL = /[\n\r\t\0]/

/**
 * Second barrier, independent of input validation.
 *
 * ssh_config supports ProxyCommand, which executes a system command. A newline
 * in any value would allow smuggling arbitrary directives into the file that
 * the user's own ssh client also reads. The writer does not assume its caller
 * has validated anything.
 */
function requireSafeValue(field: string, value: string | null): void {
  if (value === null) return
  if (CONTROL.test(value)) {
    throw new Error(`The value of ${field} contains a newline or control character`)
  }
  if (value.includes(' ') && field !== 'HostName') {
    throw new Error(`The value of ${field} cannot contain spaces`)
  }
}

function requireSafeEntry(entry: HostEntry): void {
  requireSafeValue('Host', entry.alias)
  if (/\s/.test(entry.alias)) {
    throw new Error('The alias cannot contain spaces')
  }
  requireSafeValue('HostName', entry.hostname)
  if (/\s/.test(entry.hostname)) {
    throw new Error('The host name cannot contain spaces')
  }
  requireSafeValue('User', entry.user)
  requireSafeValue('IdentityFile', entry.identityFile)
}

/**
 * Only blocks with a single literal pattern are written.
 * A block with several aliases, or with wildcards, is shared with other hosts:
 * rewriting it would change configuration nobody asked us to touch.
 */
function findWritableBlock(config: SshConfig, alias: string): HostBlock | null {
  const block = config.blocks.find((candidate) => candidate.patterns.includes(alias))
  if (!block) return null

  if (block.patterns.length > 1) {
    throw new Error(
      `The block "Host ${block.patterns.join(' ')}" defines several aliases at once. ` +
        'Edit it by hand so the configuration of the others is left alone.',
    )
  }
  if (/[*?!]/.test(block.patterns[0] ?? '')) {
    throw new Error('Blocks with wildcards cannot be edited from the application.')
  }

  return block
}

/** Managed directives, in the order they are written. */
function managedValues(entry: HostEntry): ReadonlyArray<readonly [string, string | null]> {
  return [
    ['HostName', entry.hostname],
    ['User', entry.user],
    ['Port', entry.port === DEFAULT_PORT ? null : String(entry.port)],
    ['IdentityFile', entry.identityFile],
  ]
}

function renderBlock(entry: HostEntry): string[] {
  const lines = [`Host ${entry.alias}`]
  for (const [keyword, value] of managedValues(entry)) {
    if (value !== null && value.length > 0) lines.push(`${INDENT}${keyword} ${value}`)
  }
  return lines
}

function appendBlock(text: string, entry: HostEntry): string {
  const body = renderBlock(entry).join('\n')
  if (text.trim().length === 0) return `${body}\n`
  const separator = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  return `${text}${separator}${body}\n`
}

const keywordAt = (line: string): string | undefined =>
  /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*(?:=|\s)/.exec(line)?.[1]?.toLowerCase()

/**
 * Creates or updates the block of a host.
 * Only the lines of the managed directives are touched: comments, formatting
 * and any other directive in the block survive untouched.
 */
export function upsertHost(text: string, entry: HostEntry): string {
  requireSafeEntry(entry)

  const config = parseConfig(text)
  const block = findWritableBlock(config, entry.alias)
  if (!block) return appendBlock(text, entry)

  // Work on a copy of the block, so there is no need to track how the lines of
  // the rest of the file shift around.
  const region = config.lines.slice(block.startLine, block.endLine + 1)

  const updated = managedValues(entry).reduce<readonly string[]>((current, [keyword, value]) => {
    const lowered = keyword.toLowerCase()
    const at = current.findIndex((line) => keywordAt(line) === lowered)

    if (at !== -1) {
      if (value === null || value.length === 0) {
        return [...current.slice(0, at), ...current.slice(at + 1)]
      }
      const indent = /^(\s*)/.exec(current[at] ?? '')?.[1] ?? INDENT
      return [...current.slice(0, at), `${indent}${keyword} ${value}`, ...current.slice(at + 1)]
    }

    if (value === null || value.length === 0) return current

    // Inserted after the last managed directive that already exists, or right
    // after the Host line if there is none.
    const anchor = managedValues(entry).reduce((last, [other]) => {
      const position = current.findIndex((line) => keywordAt(line) === other.toLowerCase())
      return position > last ? position : last
    }, 0)

    return [
      ...current.slice(0, anchor + 1),
      `${INDENT}${keyword} ${value}`,
      ...current.slice(anchor + 1),
    ]
  }, region)

  return [
    ...config.lines.slice(0, block.startLine),
    ...updated,
    ...config.lines.slice(block.endLine + 1),
  ].join('\n')
}

/** Removes the block of a host. If it does not exist, returns the text unchanged. */
export function removeHost(text: string, alias: string): string {
  requireSafeValue('Host', alias)

  const config = parseConfig(text)
  const block = findWritableBlock(config, alias)
  if (!block) return text

  const lines = [...config.lines]
  lines.splice(block.startLine, block.endLine - block.startLine + 1)

  // Avoids leaving a gap of blank lines where the block used to be.
  while (
    block.startLine > 0 &&
    lines[block.startLine]?.trim() === '' &&
    lines[block.startLine - 1]?.trim() === ''
  ) {
    lines.splice(block.startLine, 1)
  }

  return lines.join('\n')
}
