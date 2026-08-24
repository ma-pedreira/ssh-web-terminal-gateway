# User guide

Everything you need to use ssh-web day to day. No knowledge of the internals
required.

- [First sign-in](#first-sign-in)
- [Adding a host](#adding-a-host)
- [Connecting and using the terminal](#connecting-and-using-the-terminal)
- [Storing passwords](#storing-passwords)
- [Settings: where everything is stored](#settings-where-everything-is-stored)
- [Installing it as an app](#installing-it-as-an-app)
- [Sessions that outlive the browser](#sessions-that-outlive-the-browser)
- [When a server key changes](#when-a-server-key-changes)
- [Deleting a host](#deleting-a-host)
- [Limits and timings](#limits-and-timings)
- [Common problems](#common-problems)
- [Not in the interface yet](#not-in-the-interface-yet)
- [Backups](#backups)

---

## First sign-in

The first time you open the application you get **First-time setup** instead of
the normal sign-in form.

1. Pick a username (at least 3 characters; letters, digits, dot, hyphen and
   underscore).
2. Pick a password of **at least 12 characters**.
3. Press **Create account**.

> Sign-up closes as soon as an account exists. There is no way to create a
> second user from the interface: this is a tool meant for a single operator.

From then on you always get **Sign in**.

---

## Adding a host

The hosts in ssh-web **are the ones in your `~/.ssh/config`**. There are two
equally valid ways to add them, and you can mix them.

### From the interface

Press **+ Add host**. The fields:

| Field | What to put |
| --- | --- |
| **Alias** | The short name: `home-server`, `nas`, `vps`. This is the `Host` in the file |
| **Host or IP** | `192.168.0.50`, `nas.local`, `my-vps.example.com`, `2001:db8::1` |
| **Port** | `22` unless you changed it |
| **Remote user** | The account you log in as: `debian`, `root` |
| **Private key** | One of the keys in the mounted directory, or none |

Saving writes a block into `~/.ssh/config`:

```
Host home-server
    HostName 192.168.0.50
    User debian
    Port 2222
    IdentityFile /ssh-keys/id_ed25519
```

That block works just as well for your everyday `ssh` client: from then on
`ssh home-server` works from the terminal.

The *Host or IP* field accepts IPv4, IPv6 and host names, and checks them
properly. If you type something that cannot work it tells you exactly why:

| You type | It says |
| --- | --- |
| `192.168.1.300` | Each number in an IPv4 address must be between 0 and 255 |
| `192.168.1` | An IPv4 address has four numbers separated by dots |
| `010.0.0.1` | No leading zeros: some systems read them as octal |
| `0.0.0.0` | Does not identify any machine |
| `nas..local` | The name has an extra dot |
| `ssh://nas` | Only letters, digits and hyphens |

### By editing the file by hand

Open `~/.ssh/config` in your editor and add whatever you like. The application
reads it on every load, so it shows up without restarting anything. This is the
recommended route for configuration the interface does not cover.

> **What the application respects when writing:** it only touches the
> `HostName`, `User`, `Port` and `IdentityFile` lines. Your comments, your
> formatting and any other directive in the block stay exactly as they were.
> And it refuses to modify blocks that define several aliases at once or that
> use wildcards, so it cannot change other hosts by accident.

### What is interpreted from the file

| Applied | Preserved but **not** applied |
| --- | --- |
| `Host` with wildcards `*`, `?` and negation `!` | `Include` |
| `HostName`, `User`, `Port`, `IdentityFile` | `Match` |
| | `ProxyJump`, `ProxyCommand` and the rest |

As in `ssh`, the first value that appears reading the file top to bottom wins.
That is why a `Host *` block at the end works as defaults:

```
Host *
    User debian
    Port 22
```

Directives that are not applied stay in the file and your normal `ssh` client
still uses them; ssh-web simply does not take them into account when
connecting.

### Authentication

**With a private key.** Pick a key from the dropdown, or write `IdentityFile`
in the file. Keys are read from the mounted directory and are **never copied**
anywhere. If the key is protected you will be asked for the passphrase when
connecting.

**Without a key.** Pressing *Connect* opens a dialog asking for the password.
By default it is not stored: it travels as far as the handshake with the server
and is discarded. If you enable the vault, that dialog also offers a
*Remember it* checkbox. See [Storing passwords](#storing-passwords).

**With the SSH agent.** If whoever administers the server has mounted the agent
socket, it is used automatically when the host has neither a key nor a
password.

If the card shows *"The key given in IdentityFile is not in the mounted
directory"* in red, the file points at a key the application cannot read:
either the path is wrong, or that key is not among the mounted ones.

---

## Connecting and using the terminal

Press **Connect** on the host card. The card sweeps with light while the
connection is established and then the terminal opens full screen.

Inside the terminal everything you expect from a console works: colours,
`htop`, `vim`, `tmux`, tab completion, `Ctrl+C`. The size follows the browser
window and is reported to the remote machine, so full-screen applications
redraw correctly.

The top bar shows the link status:

| Indicator | Meaning |
| --- | --- |
| **linking** | Establishing the WebSocket |
| **online** | All good, the dot pulses |
| **suspended** | The session is alive but nobody is watching |
| **closed** | It ended |
| **error** | The connection to the remote machine was lost |

And two buttons:

- **Leave running** — goes back to the dashboard **without closing** the
  session. Whatever was running keeps running.
- **Close session** — actually ends the SSH session.

Clicking **SSH WEB** at the top left also takes you back to the dashboard, and
behaves like *Leave running*.

---

## Storing passwords

This is **off by default**: if you do nothing, ssh-web stores no password and
asks for it on every connection.

### How to enable it

Two ways, and they do the same thing:

- In **Settings → Password vault**, choose "Yes: store them encrypted in the
  file". It asks for your sign-in password.
- Or simply tick *Remember it* the next time a host asks you for a password.
  The dialog then asks for your ssh-web password right there.

It asks on purpose: **that password is what encrypts the vault**. Without it
the file is unreadable even if somebody walks off with the whole thing.

### How a password gets stored

When connecting to a host that needs one, tick *Remember it*. It is stored
**only if the connection works**, so a wrong password is never kept.

From then on that host connects without asking you anything.

### What you should know

**The key only lives in memory.** It is computed when you sign in and erased
when you sign out. If the server restarts, the vault shows as *locked* and
stored passwords are unavailable until you sign in again. Nothing is lost: it
just needs your password once more.

**It is write-only.** There is no way, in the interface or in the API, for
ssh-web to give you back a stored password. It is only decrypted in memory to
hand to the SSH server.

**If you change your password, the vault stops opening.** There is no password
change in the application today precisely because of this. If there ever is,
the vault will have to be re-encrypted.

To delete a stored password, **Settings** lists the hosts that have one, each
with a *Forget* button.

---

## Settings: where everything is stored

The **Settings** button in the dashboard lets you choose where each thing
lives.

| Setting | What for |
| --- | --- |
| **OpenSSH folder** | Where `config` and `known_hosts` are. Point it at your usual `.ssh` |
| **Private keys folder** | Where keys are read from. Read-only |
| **Vault file** | Where the encrypted password file is stored |
| **Password vault** | On or off |
| **Idle minutes** | When a suspended session closes itself |
| **Retained kilobytes** | How much output is repainted when you resume |

### The paths are limited on purpose

You cannot type any path on the system: only folders inside an allowed list,
which the screen shows you. This is deliberate. Without that boundary, anyone
who got into the application could make it write anywhere on disk with the
process's permissions.

Whoever administers the installation can widen that list with
`SSH_WEB_ALLOWED_ROOTS`.

### Changing a folder does not move the files

If you change the OpenSSH folder, ssh-web starts reading from the new one. Any
files in the old one stay where they were. Copy them across yourself first if
you want to keep them.

---

## Installing it as an app

ssh-web can be installed on a phone or a computer and opened like any other
application, with its own icon and no browser chrome.

### Prerequisite: a secure connection

Browsers **only allow installing web applications served over HTTPS or from
`localhost`**. That is not a decision of this project, it is a browser rule and
it cannot be worked around.

With the default configuration, `http://localhost:3030` on the machine itself
qualifies. But if you connect from another machine using the network address,
for example `http://192.168.0.50:3030`, **the install option will not appear**.

Two ways to fix it:

| How | Works for |
| --- | --- |
| **SSH tunnel**: `ssh -L 3030:127.0.0.1:3030 user@server`, then open `http://localhost:3030` | Desktop |
| **Reverse proxy with TLS** in front of ssh-web, with `SSH_WEB_SECURE_COOKIES=true` | Desktop and mobile |

For mobile, the TLS proxy is the only practical route. And it also stops
everything you type into the terminal travelling in the clear across your
network, which is reason enough on its own.

### Installing

**Chrome, Edge and similar (desktop).** An install icon appears in the address
bar. Also in the menu, *Install ssh-web*.

**Android.** Browser menu → *Install app* or *Add to home screen*.

**iPhone and iPad.** Safari → share button → *Add to Home Screen*. On iOS it is
the only browser that can do this, even if you use another one day to day.

**macOS, Safari.** *File* menu → *Add to Dock*.

### What changes once installed

It opens full screen, with no address bar, which leaves noticeably more room
for the terminal. The icon sits with the rest of your applications.

What does **not** change: it still needs the server to be running and
reachable. It does not work offline, and it could not: there is a live SSH
session at the other end.

> **About mobile, frankly.** It installs and it works, but a terminal with a
> touch keyboard is awkward: no `Ctrl`, `Esc` or arrow keys unless your
> keyboard provides them. Fine for checking on a process you left running or
> running something short; for real work, use a computer.

---

## Sessions that outlive the browser

This is the main feature. The SSH connection lives on the server, not in the
browser tab.

**You can close the tab, shut the laptop or lose the wifi**: the session goes
*suspended*, not dead. Whatever you left running (a backup, a build, an
`apt upgrade`) carries on.

To come back: in the dashboard, in the **Sessions** table, press **Resume** on
the matching row. You get the session back with the recent output already
repainted.

In that table each session shows:

| Status | Meaning |
| --- | --- |
| **active** | Somebody is watching it right now |
| **suspended** | Alive on the server, nobody attached. You can resume it |
| **closed** | Finished. The right-hand column says why |
| **failed** | It could not connect, or the connection was lost |
| **connecting** | Being established |

Only live sessions have the *Resume* and *Close* buttons; on the rest you see
the reason it closed.

> **A handy detail:** one session accepts several browsers at once, and they
> all see the same thing live. Useful for watching from your phone what you
> left running on your laptop.

### Clearing the history

The **Clear history** button, top right of the table, removes sessions that
have already finished. Live ones are always kept: deleting their row would
orphan an SSH connection still open on the server.

The clearing is recorded in the audit log, with how many were deleted. That is
deliberate: clearing the history must not clear the trace that it was cleared.

---

## When a server key changes

The first time you connect to a host, ssh-web writes its key fingerprint into
`~/.ssh/known_hosts`, exactly as the `ssh` client does. If on a later
connection the fingerprint does not match, it **cuts the connection** and shows:

> The server key does not match the one in known_hosts. The connection was cut
> for safety.

This means one of two things:

1. **Somebody is interposing** between ssh-web and your server. That is the
   case this protection exists to detect.
2. **You reinstalled the server**, migrated the machine or regenerated its host
   keys. Then the change is legitimate and expected.

**Do not authorise the change lightly.** First check the real fingerprint from
a terminal you trust:

```bash
ssh-keyscan -p 22 192.168.0.50 | ssh-keygen -lf -
```

If it matches what you expect, there are two ways to authorise the change.

**With your editor**, which is the most direct: delete that host's lines from
`~/.ssh/known_hosts`. Or with the usual tool:

```bash
ssh-keygen -R 192.168.0.50          # port 22
ssh-keygen -R '[192.168.0.50]:2222' # another port
```

**From the application**, in the browser console (`F12` → *Console*):

```js
await fetch('/api/hosts/home-server/hostkey', {
  method: 'DELETE',
  headers: { 'x-ssh-web-csrf': document.cookie.match(/ssh_web_csrf=([^;]+)/)[1] },
}).then((r) => r.json())
```

The next connection pins the new key and it is recorded in the audit log.

---

## Deleting a host

**Delete** on the card asks for confirmation and removes the whole `Host` block
from `~/.ssh/config`, along with whatever directives and comments it contained.

What it does **not** touch:

- The fingerprint in `known_hosts`, which stays.
- Your private key, which is never touched.
- The session history, which keeps a copy of the host data so it stays
  readable.

It cannot be undone from the interface, but since it is a text file, if you
have a backup you recover it by pasting the block back.

---

## Limits and timings

| Limit | Default |
| --- | --- |
| Suspended session idle before closing itself | **120 minutes** |
| Terminal output kept for repainting on resume | **256 KB** |
| Web session lifetime before asking for your password again | **12 hours** |
| Failed sign-in attempts before blocking | **5 every 15 minutes** |

If you exceed the attempts, the message tells you how many minutes remain. The
block is per user, so you cannot lock anybody else out.

The first two values can be changed from **Settings**.

---

## Common problems

**The *Connect* button is disabled.**
The host's `IdentityFile` points at a key that is not in the mounted directory.
Fix the path in the file or pick another key.

**It fails to connect and the session shows as *failed*.**
Look at the reason in the right-hand column of the sessions table. The usual
ones: the server is not accepting connections on that port, the name could not
be resolved from the ssh-web server (not from your laptop), or the server
rejected the credentials.

**When I resume I see little history.**
Only the last 256 KB of output is kept. A very chatty process eats through
that. For long jobs, use `tmux` or `screen` on the remote machine.

**A session I had in the background closed itself.**
More than 120 minutes passed with nobody attached.

**I restarted the ssh-web server and lost the sessions.**
That is expected: SSH connections live in the process memory. Sessions show as
*closed* with the matching reason, so the history does not lie.

**It asks for my password again.**
The web session lasts 12 hours.

---

## Not in the interface yet

These work in the API but have no button. Use the browser console as in the
example above:

- **Editing a host** (`PATCH /api/hosts/<alias>`): change host, port, user or
  key. From the interface you have to delete and recreate, though editing the
  file by hand is usually quicker.
- **Reading the audit log** (`GET /api/audit`): who signed in, when, which
  hosts were created, which sessions were opened and closed, and any detected
  server key change.
- **Forgetting a server key** (`DELETE /api/hosts/<alias>/hostkey`), explained
  above.

---

## Backups

This is the upside of relying on the usual files:

| What | Where | Contains secrets |
| --- | --- | --- |
| Your hosts | `config` in the OpenSSH folder | No |
| Server fingerprints | `known_hosts` in that same folder | No |
| Your private keys | the keys folder | **Yes** |
| Stored passwords | the vault file | Yes, but **encrypted** |
| Account, history and audit | the database | No |

The first two are plain text: copy them wherever you like. The vault is
encrypted with your password, so backing it up is safe, but **without that
password it cannot be recovered**.

If you lose the database you only lose the history and will have to create your
account again; the hosts are untouched in the file. And if you recreate the
account with a different password, the vault will no longer open.

The exact paths depend on your system and on what you chose in Settings; that
screen shows them to you.
