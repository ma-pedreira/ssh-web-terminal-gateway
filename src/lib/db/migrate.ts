// Entry point for applying migrations from the command line.
import { getDb } from '#lib/db/client'
import { logger } from '#lib/logger'

const db = getDb()
const version = db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }
logger.info('Database ready', { migrations: version.n })
db.close()
