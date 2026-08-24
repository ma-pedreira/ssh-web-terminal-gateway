# Installing on Windows

ssh-web runs natively on Windows, without Docker and without WSL. It is the
same code as on Linux: there is no compiled dependency, and Node 24 runs the
TypeScript directly.

## Requirements

**Node.js 24 or later.** Download it from [nodejs.org](https://nodejs.org) and
install it with the default options. To check, open a command prompt and type:

```
node --version
```

It must answer `v24.x.x` or later. Version 24 is the first that runs TypeScript
without compiling, which is what this project relies on.

## Starting it

1. Download or clone the project into a folder, for example
   `C:\Tools\ssh-web`.
2. Double-click **`start.cmd`**.

The first run takes a few minutes: it installs the dependencies and builds the
application. Later runs start in seconds. When it is ready the browser opens at
`http://localhost:3030`.

To stop it, close the black window or press `Ctrl+C` in it.

For a different port:

```
set PORT=8080
start.cmd
```

## Where it stores things

With the default configuration, in the usual Windows folders:

| What | Where |
| --- | --- |
| Hosts and server fingerprints | `%USERPROFILE%\.ssh\` |
| Private keys | `%USERPROFILE%\.ssh\` |
| Account, history and audit | `%LOCALAPPDATA%\ssh-web\` |
| Password vault and settings | `%APPDATA%\ssh-web\` |

All of that can be changed from **Settings** inside the application.

> **If you already used SSH on Windows**, your hosts show up on their own:
> OpenSSH ships with Windows 10 and 11 and keeps its configuration in exactly
> `%USERPROFILE%\.ssh\config`, which is the file ssh-web reads.

## One important security difference

On Linux sensitive files are created with `600` permissions, which stop other
users of the system reading them. **On Windows that does not exist**: the
equivalent protection is NTFS ACLs, inherited from the containing folder.

That is why the defaults point inside your user profile (`%USERPROFILE%`,
`%APPDATA%`, `%LOCALAPPDATA%`), which Windows already protects from other
accounts. **If you change the paths in the settings screen, choose folders
inside your profile.** A folder like `C:\data` shared between users would leave
the password vault readable by all of them.

The vault is encrypted with your sign-in password, so nobody opens it without
that password even with the file in front of them. But there is no reason to
make it easy.

## Starting with the computer

`start.cmd` is deliberately not installed as a service: it is easier to
diagnose when something goes wrong. If you want it to start on its own:

1. Press `Win + R`, type `shell:startup` and accept.
2. Create a shortcut to `start.cmd` there.

A console window will open when you sign in. To hide it, set *Run: Minimized*
in the shortcut properties.

## Common problems

**"Node.js was not found".**
It is not installed, or it was installed without adding it to the PATH.
Reinstall it and reopen the command prompt.

**"Node.js N is too old".**
You have a version earlier than 24. Install the current one from nodejs.org.

**Windows Defender or your antivirus blocks the launch.**
`start.cmd` only calls `npm` and `node`. If your antivirus blocks `.cmd`
scripts, add the project folder to its exclusions.

**The port is already in use.**
Another application is on 3030. Use `set PORT=8080` before starting.

**Installing dependencies fails behind a corporate proxy.**
Configure npm with your network proxy:

```
npm config set proxy http://your-proxy:port
npm config set https-proxy http://your-proxy:port
```

**I want to start from scratch.**
Delete `%APPDATA%\ssh-web` and `%LOCALAPPDATA%\ssh-web`. Your hosts and keys
are in `%USERPROFILE%\.ssh` and are not touched.

## Uninstalling

There is no installer and no registry to clean up:

1. Delete the project folder.
2. Delete `%APPDATA%\ssh-web` and `%LOCALAPPDATA%\ssh-web` if you do not want
   to keep the account and the history.

Your `%USERPROFILE%\.ssh` is left exactly as it was, with your hosts and keys
intact and usable by the ordinary `ssh` client.
