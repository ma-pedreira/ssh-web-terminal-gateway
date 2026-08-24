# CLAUDE.md - ssh-web

## Project overview

SSH access from the browser for local or published hosts. A single Node process
serves the Next 16 (App Router) application and handles the terminal WebSocket
on the same port. SSH sessions live in the server, so they survive closing the
browser and can be resumed.

**Configuration state lives in the standard OpenSSH files**, not in the
database: hosts in `~/.ssh/config` and fingerprints in `~/.ssh/known_hosts`,
both read and written by the application. SQLite only holds accounts, sessions
and the audit trail.

Stack: TypeScript, Next 16, React 19, xterm.js, ssh2, SQLite (`node:sqlite`
with WAL), Zod, Tailwind 4, vitest. **No compiled dependencies**: everything
relies on native Node modules, which allows a container with no toolchain and a
read-only root filesystem.

## Critical rules

### 1. Code organisation

- Many small files rather than a few large ones
- High cohesion, low coupling
- 200-400 lines per file as the norm, 800 maximum
- Organise by feature/domain, not by type

### 2. Code style

- No emojis in code, comments or documentation
- Immutability always: never mutate objects or arrays
- No console.log in production code
- Proper error handling with try/catch
- Input validation with Zod or similar

### 3. Testing

- TDD: write the tests first
- 80% minimum coverage
- Unit tests for utilities
- Integration tests for APIs
- E2E tests for critical flows

### 4. Security

- No secrets written into the code
- Environment variables for sensitive data
- Validate every user input
- Parameterised queries only
- CSRF protection enabled

Rules specific to this project:

- **Secrets are only stored in the encrypted vault, and only if the user
  enables it.** Never in the database, in the logs or in the configuration
  file. Passphrases and private keys are never stored.
- **The vault is write-only.** Do not add any route that returns a stored
  password, not even encrypted.
- **The vault key never touches disk.** It lives in the in-memory keyring, tied
  to the session. If something appears to need it persisted, the design is
  wrong.
- **Every user-chosen path goes through `resolveInsideAny`.** Without that
  confinement, the settings screen is arbitrary write access to the disk.
- **Every value written to `ssh_config` goes through the writer's own check.**
  `ProxyCommand` executes system commands: a newline in any field would be a
  path to code execution. Validate at the input layer *and* in the writer.
- **The effective configuration is read with `getSettings()`, not
  `getEnv()`.** The environment only supplies the starting values.
- **No hand-written paths or separators.** Use `node:path` and
  `src/lib/platform.ts`: the same code runs on Linux and on Windows.
- Never log secrets. `src/lib/logger.ts` redacts sensitive keys; do not route
  around it with `console.log`.
- Sessions and the audit trail filter by `user_id`, even when the resource
  identifier is known.
- Do not weaken the `known_hosts` check: a key change must abort the connection
  and be recorded in the audit trail.
- Remote host errors are translated with `describeSshError` into something
  actionable. Do not let them fall into the generic 500: they describe the
  host, not the application internals, so showing them leaks nothing.

## File structure

```
server.ts             # Startup: Next + WebSocket upgrade
start.cmd             # Windows launcher
src/
|-- app/              # Next App Router and API routes
|-- components/       # Reusable UI components
|-- hooks/            # Custom React hooks
|-- client/           # Browser-side API client and write queue
|-- server/           # Terminal gateway (WebSocket)
|-- lib/
|   |-- api/          # Responses, request guard, route wrapper
|   |-- auth/         # Application sessions, CSRF, attempt limiting
|   |-- crypto/       # scrypt, tokens, constant-time comparison
|   |-- db/           # SQLite client and embedded migrations
|   |-- paths/        # Cross-platform path containment
|   |-- repos/        # Sessions and audit, always filtered by user
|   |-- settings/     # Effective settings chosen by the user
|   |-- ssh-config/   # Parsing and writing ~/.ssh/config, key paths
|   |-- ssh/          # Connection, known_hosts, ring buffer, sessions
|   |-- vault/        # Encrypted password vault
|   `-- validation/   # Zod schemas
`-- types/            # TypeScript definitions
```

### Important import constraint

Node runs the TypeScript in `src/` **uncompiled**, and the same code is bundled
by Next. Therefore:

- Inside `src/lib`, `src/server` and `server.ts`, use the package.json *subpath
  imports* (`#lib/*`, `#types`), which resolve in both environments. The `@/`
  alias is only resolved by the bundler: use it only in `src/app`,
  `src/components`, `src/hooks` and `src/client`.
- No `enum`, `namespace` or parameter properties
  (`constructor(private readonly x)`): Node's strip-only mode does not support
  them and the server will not start.
- Do not read files with `import.meta.dirname` in code that Next bundles: it
  does not exist in the bundle. That is why migrations are embedded in
  `src/lib/db/migrations.ts`.

## Key patterns

### API response format

```typescript
interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}
```

### Error handling

```typescript
try {
  const result = await operation()
  return { success: true, data: result }
} catch (error) {
  console.error('Operation failed:', error)
  return { success: false, error: 'User-friendly message' }
}
```

## Environment variables

Validated with Zod at startup (`src/lib/env.ts`); the process fails if anything
is off. See `.env.example`.

```bash
PORT=3030
SSH_WEB_DB_PATH=/data/ssh-web.db
SSH_WEB_CONFIG_DIR=/data          # holds settings.json
SSH_WEB_SSH_DIR=/ssh              # config and known_hosts, read and write
SSH_WEB_KEYS_DIR=/ssh-keys        # private keys, read only
SSH_WEB_VAULT_PATH=/data/vault    # encrypted password file
SSH_WEB_ALLOWED_ROOTS=/data:/ssh  # boundary for user-chosen paths
SSH_WEB_SECURE_COOKIES=false      # true when serving over HTTPS
SSH_WEB_SESSION_IDLE_MINUTES=120
SSH_WEB_REPLAY_BUFFER_KB=256
SSH_WEB_LOG_LEVEL=info
```

## Available commands

```bash
npm run dev           # development server
npm run build         # production build
npm start             # production server
npm test              # unit suite
npm run test:coverage # with coverage thresholds
npm run typecheck     # tsc --noEmit
npm run icons         # regenerates the application icons
# On Windows: double-click start.cmd
```

End-to-end terminal check: `scripts/e2e-terminal.mjs`.

## Git workflow

- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
- Never commit directly to main
- PRs require review
- All tests must pass before merge
