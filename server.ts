// Single server: serves the Next application and handles the terminal
// WebSocket upgrade on the same port. Node runs this TypeScript uncompiled.
import { createServer } from 'node:http'
import next from 'next'
import { getEnv } from '#lib/env'
import { logger } from '#lib/logger'
import { closeDb, getDb } from '#lib/db/client'
import { purgeExpiredSessions } from '#lib/auth/session'
import { purgeOldAttempts } from '#lib/auth/rate-limit'
import { reconcileOrphans } from '#lib/repos/sessions'
import { shutdown } from '#lib/ssh/session-manager'
import { attachTerminalGateway } from './src/server/terminal-gateway.ts'

const env = getEnv()
// By argument rather than NODE_ENV: "NODE_ENV=x command" does not work in
// cmd.exe, and this same package.json has to work on Windows.
const dev = process.argv.includes('--dev') || env.NODE_ENV === 'development'

const db = getDb()

// After a restart no SSH connection survives in memory: rows left open are
// closed so the history does not lie.
const orphans = reconcileOrphans(db)
if (orphans > 0) logger.info('Orphaned sessions closed at startup', { orphans })

const app = next({ dev, hostname: '0.0.0.0', port: env.PORT })
const handle = app.getRequestHandler()

await app.prepare()

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    logger.error('Failed to serve the request', {
      url: request.url,
      error: (error as Error).message,
    })
    response.statusCode = 500
    response.end()
  })
})

attachTerminalGateway(server)

// Periodic cleanup of expired sessions and sign-in attempts.
const maintenance = setInterval(
  () => {
    const sessions = purgeExpiredSessions(db)
    const attempts = purgeOldAttempts(db)
    if (sessions > 0 || attempts > 0) logger.debug('Maintenance', { sessions, attempts })
  },
  15 * 60_000,
)
maintenance.unref()

server.listen(env.PORT, () => {
  logger.info('ssh-web listening', { port: env.PORT, dev })
})

let stopping = false
function stop(signal: string): void {
  if (stopping) return
  stopping = true
  logger.info('Shutting down', { signal })
  clearInterval(maintenance)
  shutdown(db)
  server.close(() => {
    closeDb()
    process.exit(0)
  })
  // Safety net in case a connection does not close in time.
  setTimeout(() => process.exit(0), 5000).unref()
}

process.on('SIGTERM', () => stop('SIGTERM'))
process.on('SIGINT', () => stop('SIGINT'))
