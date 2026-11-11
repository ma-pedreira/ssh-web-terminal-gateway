import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Directorio efimero por ejecucion: los ficheros de SSH de las pruebas nunca
// tocan la configuracion real de quien las ejecuta.
const dir = mkdtempSync(join(tmpdir(), 'ssh-web-test-'))
mkdirSync(join(dir, 'keys'), { recursive: true })

process.env.SSH_WEB_DB_PATH = join(dir, 'test.db')
process.env.SSH_WEB_SSH_DIR = dir
// Settings and the vault also stay inside the ephemeral directory: without
// this they would default to the real profile of whoever runs the tests.
process.env.SSH_WEB_CONFIG_DIR = dir
process.env.SSH_WEB_VAULT_PATH = join(dir, 'test.vault')
process.env.SSH_WEB_ALLOWED_ROOTS = dir
process.env.SSH_WEB_KEYS_DIR = join(dir, 'keys')
process.env.SSH_WEB_SESSION_IDLE_MINUTES = '5'
process.env.SSH_WEB_REPLAY_BUFFER_KB = '8'
process.env.SSH_WEB_LOG_LEVEL = 'error'
