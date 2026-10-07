# Security policy

## Reporting a vulnerability

Please report security problems privately, through GitHub's private
vulnerability reporting: on the repository's **Security** tab, choose
**Report a vulnerability**
(<https://github.com/vidarrapp/bozzetto/security/advisories/new>). Please do
not open a public issue, pull request or discussion for one.

A useful report says what is affected (the site, the account system, the
desktop app, the release workflow), the version or the commit, the steps to reproduce it, and
what an attacker gains. A proof of concept helps; keep it to your own data
and accounts.

Bozzetto is maintained by one person, so allow a few days for a first
answer. Once a fix is out, the advisory is published with credit to you,
unless you would rather not be named.

## Supported versions

Fixes go into the current versions only:

| What | Supported |
| --- | --- |
| The web app, as deployed from `main` | yes |
| The latest desktop release | yes |
| Older desktop releases | no: update to the latest |

## Scope

In scope:

- The web app: the viewer, sculpt and armature modes, the public editor at
  `/create/` and the editor at `/admin/`, including how they open files
  someone else made (`.bozz` scenes, meshes, timelapses).
- The Pages Functions under `functions/`: `/api`, `/admin/api`, `/media` and
  `/m` (also on the files host, `files.vidarrapp.se`), and how they check
  identity and visibility.
- The account system (`/api/auth`, `/api/me`, and the owner's tools over
  accounts on `/admin/api`; see `docs/accounts.md`): sessions and their
  cookies, passkeys, the six-digit email codes and the sign-in links,
  invites and registration, re-authentication, the rate limits and the
  Turnstile check, the storage quotas and the checks on uploaded files, one
  account reaching another's projects or files, the data download, account
  deletion, and the two locks on the owner tools. Reports about it are in
  scope whether or not accounts are switched on in production yet; test
  them on your own deployment or on `localhost` (`npm run cf:dev`), with
  accounts of your own.
- The desktop app: the Electron shell in `electron/`, its `bozzetto://`
  protocol, the native file handling, and how it talks to a server you point
  it at.
- The release pipeline: the workflows in `.github/workflows/`, and the
  installers, `SHA256SUMS` and provenance attestations they publish.

Out of scope:

- Cloudflare's, GitHub's and Resend's own platforms, and Cloudflare Access
  and Turnstile themselves.
- A deployment that does not follow `docs/deployment.md` (no Access
  application in front of `/admin`, say), unless that document itself is
  what is wrong.
- That the desktop builds are unsigned, so macOS and Windows warn before
  opening them. This is known; check a download against `SHA256SUMS` and its
  attestation instead (see Releasing in `docs/desktop.md`).
- Denial of service by volume, and social engineering.
- Vulnerabilities in a dependency with no demonstrated effect on Bozzetto:
  please report those to the dependency.
