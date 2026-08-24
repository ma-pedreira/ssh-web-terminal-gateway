export interface Migration {
  readonly name: string
  readonly sql: string
}

/**
 * Migraciones embebidas a proposito, no leidas del disco: el mismo codigo
 * lo ejecuta Node directamente y lo empaqueta Next, y en el bundle no existe
 * ni `import.meta.dirname` ni el arbol de ficheros original.
 * Para anadir una migracion, agrega una entrada al final. Nunca edites una ya aplicada.
 */
export const MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    name: '001_init.sql',
    sql: `-- Esquema inicial de ssh-web.
-- Ningun secreto se guarda en claro: la tabla credentials solo contiene
-- texto cifrado con AES-256-GCM y la clave vive fuera de este fichero.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
) STRICT;

CREATE TABLE app_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash  TEXT NOT NULL,
  client_ip  TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX idx_app_sessions_user ON app_sessions(user_id);
CREATE INDEX idx_app_sessions_expiry ON app_sessions(expires_at);

CREATE TABLE hosts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  hostname    TEXT NOT NULL,
  port        INTEGER NOT NULL DEFAULT 22,
  username    TEXT NOT NULL,
  auth_method TEXT NOT NULL CHECK (auth_method IN ('password', 'private-key', 'agent')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, label)
) STRICT;

CREATE INDEX idx_hosts_user ON hosts(user_id);

-- Un host tiene como maximo una credencial. Solo texto cifrado.
CREATE TABLE credentials (
  host_id        TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('password', 'private-key')),
  cipher_version INTEGER NOT NULL,
  iv             TEXT NOT NULL,
  tag            TEXT NOT NULL,
  ciphertext     TEXT NOT NULL,
  -- Frase de paso de la clave privada, cifrada por separado.
  passphrase_iv         TEXT,
  passphrase_tag        TEXT,
  passphrase_ciphertext TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

-- Confianza en la clave del servidor: se fija en el primer uso y se
-- rechaza cualquier cambio posterior (defensa frente a man in the middle).
CREATE TABLE known_hosts (
  host_id      TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
  key_type     TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE ssh_sessions (
  id               TEXT PRIMARY KEY,
  host_id          TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL CHECK (
                     status IN ('connecting', 'active', 'suspended', 'closed', 'failed')
                   ),
  client_ip        TEXT,
  cols             INTEGER NOT NULL DEFAULT 80,
  rows             INTEGER NOT NULL DEFAULT 24,
  started_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at         TEXT,
  exit_code        INTEGER,
  close_reason     TEXT
) STRICT;

CREATE INDEX idx_ssh_sessions_user ON ssh_sessions(user_id, started_at DESC);
CREATE INDEX idx_ssh_sessions_status ON ssh_sessions(status);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  target_id  TEXT,
  client_ip  TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_action ON audit_log(action, created_at DESC);

CREATE TABLE login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier  TEXT NOT NULL,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE INDEX idx_login_attempts ON login_attempts(identifier, attempted_at DESC);`,
  },
  {
    name: '002_config_files.sql',
    sql: `-- El inventario de hosts pasa a ~/.ssh/config y las huellas a ~/.ssh/known_hosts.
-- La aplicacion deja de almacenar secretos: no hay tabla de credenciales.
DROP TABLE IF EXISTS credentials;
DROP TABLE IF EXISTS known_hosts;
DROP TABLE IF EXISTS ssh_sessions;
DROP TABLE IF EXISTS hosts;

-- Las sesiones guardan una copia de los datos del host para que el historial
-- siga siendo legible aunque despues se edite o se borre del fichero.
CREATE TABLE ssh_sessions (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_alias       TEXT NOT NULL,
  hostname         TEXT NOT NULL,
  host_user        TEXT,
  port             INTEGER NOT NULL DEFAULT 22,
  status           TEXT NOT NULL CHECK (
                     status IN ('connecting', 'active', 'suspended', 'closed', 'failed')
                   ),
  client_ip        TEXT,
  cols             INTEGER NOT NULL DEFAULT 80,
  rows             INTEGER NOT NULL DEFAULT 24,
  started_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at         TEXT,
  exit_code        INTEGER,
  close_reason     TEXT
) STRICT;

CREATE INDEX idx_ssh_sessions_user ON ssh_sessions(user_id, started_at DESC);
CREATE INDEX idx_ssh_sessions_status ON ssh_sessions(status);`,
  },
])
