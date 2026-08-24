# Architecture and security model

Technical document. For day-to-day use see the [user guide](USER-GUIDE.md).

## Overall shape

A single Node process serves the application and handles the terminal
WebSocket on the same port:

```
browser ──HTTP──▶ Next 16 (App Router)  ─┬─▶ ~/.ssh/config      (read and write)
        ──WS────▶ terminal gateway      ─┼─▶ ~/.ssh/known_hosts (read and write)
                                         ├─▶ private keys       (read only)
                                         ├─▶ ssh2 ──▶ remote host
                                         └─▶ SQLite: sessions and audit
```

Two decisions define the project.

**The SSH connection lives in the server process, not in the tab.** That is why
a session survives closing the browser. The session manager keeps the
connection, retains recent output in a bounded ring buffer and repaints it when
a client attaches again.

**Configuration state lives in the standard OpenSSH files, not in the
database.** The application keeps no inventory of its own. Direct consequences:

- Restoring an installation means copying `~/.ssh/config`.
- The same configuration works for `ssh`, `scp` and `rsync`.
- Losing the database costs you the history, nothing more.
- There is no key to guard: the vault key is derived from the sign-in password
  and only exists in memory for the duration of the session.

| Piece | Location |
| --- | --- |
| Startup and WebSocket upgrade | `server.ts`, `src/server/terminal-gateway.ts` |
| Live SSH sessions | `src/lib/ssh/session-manager.ts` |
| Connection and key verification | `src/lib/ssh/connect.ts` |
| Parsing and writing `ssh_config` | `src/lib/ssh-config/` |
| Reading and writing `known_hosts` | `src/lib/ssh/known-hosts-file.ts` |
| Encrypted password vault | `src/lib/vault/` |
| Effective settings and allowed paths | `src/lib/settings/`, `src/lib/paths/` |
| Platform defaults | `src/lib/platform.ts` |
| Application passwords and tokens | `src/lib/crypto/` |
| Database and schema | `src/lib/db/` |
| Data access | `src/lib/repos/` |
| REST routes | `src/app/api/` |
| Interface | `src/app/`, `src/components/` |

## Import constraint

Node runs the TypeScript in `src/` **uncompiled**, and the same code is bundled
by Next. Three rules follow, and they must be respected when touching the
project:

1. In `src/lib`, `src/server` and `server.ts`, the package.json *subpath
   imports* are used (`#lib/*`, `#types`), which resolve in both environments.
   The `@/` alias is only resolved by the bundler: use it exclusively in
   `src/app`, `src/components`, `src/hooks` and `src/client`.
2. No `enum`, `namespace` or parameter properties
   (`constructor(private readonly x)`). Node's strip-only mode does not support
   them and the server will not start.
3. Do not locate files with `import.meta.dirname` in code that Next bundles: it
   does not exist in the bundle. That is why migrations are embedded in
   `src/lib/db/migrations.ts`.

## No compiled dependencies

Encryption uses `node:crypto` and the database uses `node:sqlite`, both native
to Node 24. The optional `ssh2` binding is not built (`npm ci
--ignore-scripts`). This allows a container with no toolchain and a read-only
root filesystem, and removes a whole class of installation problems.

## What is supported from ssh_config

The parser applies the real ssh resolution: **the first value found wins**,
reading the file top to bottom among blocks whose pattern matches. That is why
a `Host *` block at the end acts as defaults.

| Interpreted | Preserved but not applied |
| --- | --- |
| `Host` with wildcards `*`, `?` and negation `!` | `Include` |
| `HostName`, `User`, `Port`, `IdentityFile` | `Match` |
| Comments and formatting when rewriting | `ProxyJump`, `ProxyCommand` and the rest |

This is deliberate: better to support a subset and say so than to fake full
compatibility and lie about which configuration is being applied.

The writer only touches the lines of the directives it manages. It refuses to
modify blocks shared by several aliases or containing wildcards, because
rewriting them would change the configuration of hosts nobody asked to touch.

## Security model

### Secrets

By default none are stored.

- **Remote passwords.** Asked for on connect, travel as far as the handshake
  and are discarded. A test dumps the tables after a connection and verifies
  the secret appears nowhere.
- **Passphrases.** The same, and never stored.
- **Private keys.** Never copied: read from the configured directory at the
  moment of connecting.

If the user enables the vault, the passwords they tick are stored encrypted.
See below.

### Password vault

A JSON file with each password encrypted individually using **AES-256-GCM**.

The key is derived from the sign-in password with **scrypt** (N=2¹⁶), using its
own salt stored in the file itself and a domain prefix (`ssh-web:vault:v1 `).
That separation matters: the same password also produces the sign-in hash, and
without distinct salt and domain, compromising one would bring an attacker
closer to the other.

- The key **lives only in memory**, in a keyring tied to the application
  session (`src/lib/vault/keyring.ts`). It never touches disk. On sign-out it
  is overwritten with zeros before being released, and a server restart wipes
  it: the vault is then *locked* until the next sign-in.
- Each entry carries the **alias as authenticated data**, so a ciphertext
  copied into another entry cannot be decrypted.
- An encrypted **verifier** allows checking that the password opens the vault
  before attempting to use any entry.
- It is **write-only**: no API route ever returns a password.
- A password is only stored **after** the connection works, so a wrong one is
  never kept.
- Enabling it requires **re-authentication**, because the password is what
  encrypts it.

Trade-off taken: there is no password change in the application, because it
would force re-encrypting the vault.

### Paths chosen by the user

The settings screen allows choosing where each thing lives, and that is
potentially arbitrary write access to disk. The control is `resolveInsideAny`,
which requires every path to fall inside a list of allowed folders.

The containment check (`src/lib/paths/containment.ts`) compares **segment by
segment** with `path.relative`, not by text prefix: a prefix check would accept
`/home/u/.ssh-evil` against `/home/u/.ssh`. And it only ignores case on
Windows, where the file system does not distinguish it either; doing so on
Linux would open a hole.

`resolveIdentityPath` confines every key read to the mounted directory. An
`IdentityFile` pointing at `/etc/shadow`, at `../../` or at a prefix that
merely looks like the allowed directory is rejected. Without that control,
anyone able to edit the configuration file would turn the application into an
arbitrary file reader.

### ssh_config injection

`ssh_config` supports `ProxyCommand`, which executes a system command. A
newline smuggled into any field would allow writing arbitrary directives into
the user's file, which their own `ssh` client also reads.

Defended at two independent layers: input validation, and the writer itself,
which rejects newlines, carriage returns, tabs and null bytes without assuming
its caller validated anything. Tests check both layers with six injection
variants.

### Application authentication

Passwords with **scrypt** (N=2¹⁶, 16-byte random salt). Only the SHA-256
fingerprint of the session token is stored in the database; the plaintext token
only exists in the client cookie.

Cookies are `HttpOnly`, `SameSite=Strict` and `Secure` when served over HTTPS.
CSRF protection by double submit plus an origin check on state-changing
methods.

Sign-in always verifies against a hash, even for a nonexistent user, so timing
does not reveal whether the account exists. Limit of 5 failed attempts per user
every 15 minutes.

**Why there is a sign-in at all**, even for a local tool: the browser is a
hostile environment. A DNS rebinding attack can make a malicious site's scripts
read responses from a service on `127.0.0.1`, and the same-origin check does
not stop it, because from the browser's point of view it *is* the same origin.
What does stop it is authentication: the session cookie is bound to the
original host name and is not sent to the attacker's domain. On top of that,
the vault's encryption is derived from that password; removing the sign-in
would mean inventing a separate master password, which is a sign-in by another
name.

### Terminal transport

The WebSocket requires **same origin**: without it, any page could open a
terminal with the victim's cookies. Every client message is validated with Zod
before reaching the shell, with a size cap.

### Remote host

Trust on first use against `~/.ssh/known_hosts`, in full OpenSSH format:
ordinary entries, several comma-separated names, bracketed ports, names hashed
with HMAC-SHA1, and `@revoked` markers. A key that changes or has been revoked
aborts the connection and is recorded in the audit log.

### Data isolation

Sessions and the audit log filter by `user_id`. The configuration file, by
contrast, is **shared**: it is a system file, not a file belonging to an
application user. With sign-up closed after the first account this is not a
problem, but it is one more reason not to turn this into a multi-user tool
without rethinking it.

### Container

No root (`node`, uid 1000), read-only rootfs, `cap_drop: ALL`,
`no-new-privileges`, PID and memory limits. The only writable points are the
data volume, the SSH directory and the tmpfs mounts.

> **Mount trade-off.** Pointing the keys directory at your whole `~/.ssh` is
> the most convenient option and exposes every private key you own to any flaw
> in the application, including keys for hosts you never use here. A separate
> directory with only the necessary keys bounds the damage.

### Windows

The same code runs natively on Windows. Two real differences:

- **There are no `600` modes.** `fileMode()` returns `undefined` on Windows,
  where the equivalent protection is NTFS ACLs. That is why the defaults live
  inside the user profile (`%APPDATA%`, `%LOCALAPPDATA%`, `%USERPROFILE%`),
  which Windows already isolates from other accounts.
- **Paths are case-insensitive**, and the containment check accounts for it.

### Logging

`src/lib/logger.ts` writes JSON to stderr and redacts sensitive keys in one
place (`password`, `secret`, `token`, `privateKey`, `passphrase`, `credential`,
`cookie`). Do not route around it with `console.log`.

## Configuration

| Variable | Default | What for |
| --- | --- | --- |
| `PORT` | `3030` | Listening port |
| `SSH_WEB_DB_PATH` | per system | SQLite file |
| `SSH_WEB_CONFIG_DIR` | per system | Folder holding `settings.json` |
| `SSH_WEB_SSH_DIR` | per system | Folder with `config` and `known_hosts` |
| `SSH_WEB_KEYS_DIR` | per system | Private keys folder, read-only |
| `SSH_WEB_VAULT_PATH` | next to `settings.json` | Encrypted password file |
| `SSH_WEB_ALLOWED_ROOTS` | user profile | Folders selectable in the settings screen |
| `SSH_WEB_SECURE_COOKIES` | `false` | `Secure` flag on cookies |
| `SSH_WEB_SESSION_IDLE_MINUTES` | `120` | Closing suspended sessions |
| `SSH_WEB_REPLAY_BUFFER_KB` | `256` | Output retained for resuming |
| `SSH_WEB_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

Validated with Zod at startup (`src/lib/env.ts`); the process fails if anything
is off. These are **starting values**: whatever the user changes from the
settings screen is saved to `settings.json` and takes precedence. The effective
configuration is always read with `getSettings()`, never `getEnv()` directly.

Outside Docker nearly all of them can be omitted: `src/lib/platform.ts` picks
the usual folders for each system.

To use the host's SSH agent, mount its socket and expose `SSH_AUTH_SOCK` in the
container: it is used when the host has neither `IdentityFile` nor a password.

## Development

```bash
npm install
SSH_WEB_DB_PATH=./data/ssh-web.db SSH_WEB_SSH_DIR=./ssh SSH_WEB_KEYS_DIR=./ssh-keys npm run dev

npm test              # unit suite
npm run test:coverage # with coverage thresholds
npm run typecheck
npm run icons         # regenerates the application icons
```

End-to-end check of the terminal, against a running server and an already open
session:

```bash
SC=<ssh_web_session cookie> SID=<session id> node scripts/e2e-terminal.mjs
```

It checks that the command reaches the remote host, that the WebSocket rejects
cross origins and unauthenticated requests, and that the session survives
closing the browser by repainting the retained output.

## Operations

- Suspended sessions close themselves after
  `SSH_WEB_SESSION_IDLE_MINUTES`.
- After a server restart no SSH connection survives: rows left open are marked
  closed so the history does not lie.
- **Backups:** `config` and `known_hosts` are plain text with no secrets; copy
  them anywhere. Private keys with the usual care. The vault is encrypted with
  the user's password, so backing it up is safe but useless without that
  password. The database only holds the account, sessions and audit trail:
  losing it costs the history, nothing more.
