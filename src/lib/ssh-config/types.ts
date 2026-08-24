export interface Directive {
  readonly keyword: string
  readonly value: string
  /** Line index in the original file, so rewriting does not destroy it. */
  readonly line: number
}

export interface HostBlock {
  readonly patterns: readonly string[]
  readonly directives: readonly Directive[]
  readonly startLine: number
  readonly endLine: number
}

export interface SshConfig {
  readonly lines: readonly string[]
  readonly blocks: readonly HostBlock[]
}

export interface ResolvedHost {
  readonly alias: string
  readonly hostname: string
  readonly user: string | null
  readonly port: number
  readonly identityFile: string | null
  /** Directives we do not interpret, kept so they can be shown. */
  readonly extra: Readonly<Record<string, string>>
}

export const DEFAULT_PORT = 22

/** Directives with their own meaning. The rest travels in `extra`. */
export const KNOWN_KEYWORDS = Object.freeze(['hostname', 'user', 'port', 'identityfile'])
