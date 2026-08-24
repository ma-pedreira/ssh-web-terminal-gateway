type Level = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const REDACTED = '[redacted]'
const SENSITIVE = /^(password|secret|token|privateKey|passphrase|credential|cookie)$/i

function threshold(): number {
  const configured = process.env.SSH_WEB_LOG_LEVEL as Level | undefined
  return ORDER[configured ?? 'info'] ?? ORDER.info
}

function redact(context: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, SENSITIVE.test(key) ? REDACTED : value]),
  )
}

function emit(level: Level, message: string, context: Readonly<Record<string, unknown>>): void {
  if (ORDER[level] < threshold()) return
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...redact(context),
  })
  process.stderr.write(`${line}\n`)
}

/**
 * Structured logging to stderr. Never use console.log: sensitive keys are
 * redacted here, in one place.
 */
export const logger = Object.freeze({
  debug: (message: string, context: Readonly<Record<string, unknown>> = {}) =>
    emit('debug', message, context),
  info: (message: string, context: Readonly<Record<string, unknown>> = {}) =>
    emit('info', message, context),
  warn: (message: string, context: Readonly<Record<string, unknown>> = {}) =>
    emit('warn', message, context),
  error: (message: string, context: Readonly<Record<string, unknown>> = {}) =>
    emit('error', message, context),
})
