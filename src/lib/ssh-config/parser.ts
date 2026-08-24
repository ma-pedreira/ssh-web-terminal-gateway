import {
  DEFAULT_PORT,
  KNOWN_KEYWORDS,
  type Directive,
  type HostBlock,
  type ResolvedHost,
  type SshConfig,
} from '#lib/ssh-config/types'

const WILDCARD = /[*?!]/

function stripComment(line: string): string {
  const index = line.indexOf('#')
  return index === -1 ? line : line.slice(0, index)
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/** Splits `Keyword value` or `Keyword=value`, with optional quotes. */
function splitDirective(line: string): { keyword: string; value: string } | null {
  const content = stripComment(line).trim()
  if (content.length === 0) return null

  const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*(?:=\s*|\s+)(.*)$/.exec(content)
  if (!match) return null

  const keyword = (match[1] ?? '').toLowerCase()
  const value = unquote(match[2] ?? '')
  if (value.length === 0) return null

  return { keyword, value }
}

/** A Host pattern with the ssh wildcards: `*` and `?`. */
export function matchesPattern(pattern: string, alias: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const expression = `^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`
  return new RegExp(expression).test(alias)
}

function blockMatches(block: HostBlock, alias: string): boolean {
  const negated = block.patterns.filter((pattern) => pattern.startsWith('!'))
  if (negated.some((pattern) => matchesPattern(pattern.slice(1), alias))) return false
  return block.patterns
    .filter((pattern) => !pattern.startsWith('!'))
    .some((pattern) => matchesPattern(pattern, alias))
}

export function parseConfig(text: string): SshConfig {
  const lines = text.split('\n')
  const blocks: HostBlock[] = []

  let patterns: string[] | null = null
  let directives: Directive[] = []
  let startLine = 0

  const close = (endLine: number): void => {
    if (patterns) {
      blocks.push({
        patterns: Object.freeze([...patterns]),
        directives: Object.freeze([...directives]),
        startLine,
        endLine,
      })
    }
  }

  lines.forEach((line, index) => {
    const parsed = splitDirective(line)
    if (!parsed) return

    // `Match` opens a scope we do not interpret: close the current block so
    // directives that may not apply are not attributed to it.
    if (parsed.keyword === 'host' || parsed.keyword === 'match') {
      close(index - 1)
      if (parsed.keyword === 'host') {
        patterns = parsed.value.split(/\s+/).filter((pattern) => pattern.length > 0)
        directives = []
        startLine = index
      } else {
        patterns = null
        directives = []
      }
      return
    }

    if (patterns) {
      directives.push({ keyword: parsed.keyword, value: parsed.value, line: index })
    }
  })

  close(lines.length - 1)

  return Object.freeze({ lines: Object.freeze(lines), blocks: Object.freeze(blocks) })
}

/** Connectable aliases: the literal patterns, no wildcards, in order. */
export function listAliases(config: SshConfig): readonly string[] {
  const aliases: string[] = []
  for (const block of config.blocks) {
    for (const pattern of block.patterns) {
      if (!WILDCARD.test(pattern) && !aliases.includes(pattern)) aliases.push(pattern)
    }
  }
  return Object.freeze(aliases)
}

/**
 * Resolves the effective configuration of an alias.
 * The first value found while reading the file top to bottom wins, which is
 * how ssh itself behaves.
 */
export function resolveHost(config: SshConfig, alias: string): ResolvedHost | null {
  if (!listAliases(config).includes(alias)) return null

  const first = new Map<string, string>()
  for (const block of config.blocks) {
    if (!blockMatches(block, alias)) continue
    for (const directive of block.directives) {
      if (!first.has(directive.keyword)) first.set(directive.keyword, directive.value)
    }
  }

  const rawPort = Number(first.get('port'))
  const port =
    Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : DEFAULT_PORT

  const extra = Object.fromEntries(
    [...first.entries()].filter(([keyword]) => !KNOWN_KEYWORDS.includes(keyword)),
  )

  return Object.freeze({
    alias,
    hostname: first.get('hostname') ?? alias,
    user: first.get('user') ?? null,
    port,
    identityFile: first.get('identityfile') ?? null,
    extra: Object.freeze(extra),
  })
}

export interface OwnDirectives {
  readonly hostname?: string
  readonly user?: string
  readonly port?: number
  readonly identityFile?: string
}

/**
 * Directives declared by the block of the alias itself, without inheritance.
 * Only these should be rewritten when editing a host: materialising a value
 * inherited from `Host *` would disconnect it from that block forever.
 */
export function ownDirectives(config: SshConfig, alias: string): OwnDirectives | null {
  const block = config.blocks.find(
    (candidate) => candidate.patterns.length === 1 && candidate.patterns[0] === alias,
  )
  if (!block) return null

  const value = (keyword: string): string | undefined =>
    block.directives.find((directive) => directive.keyword === keyword)?.value

  const rawPort = Number(value('port'))
  const own: Record<string, string | number> = {}

  const hostname = value('hostname')
  if (hostname !== undefined) own.hostname = hostname
  const user = value('user')
  if (user !== undefined) own.user = user
  if (Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535) own.port = rawPort
  const identityFile = value('identityfile')
  if (identityFile !== undefined) own.identityFile = identityFile

  return Object.freeze(own) as OwnDirectives
}

/** Every connectable host, already resolved. */
export function resolveAll(config: SshConfig): readonly ResolvedHost[] {
  return Object.freeze(
    listAliases(config)
      .map((alias) => resolveHost(config, alias))
      .filter((host): host is ResolvedHost => host !== null),
  )
}
