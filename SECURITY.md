# Security policy

## Reporting a vulnerability

Please report security problems privately, through GitHub's private
vulnerability reporting: on the repository's **Security** tab, choose
**Report a vulnerability**
(<https://github.com/vidarrapp/bozzetto/security/advisories/new>). Please do
not open a public issue, pull request or discussion for one.

A useful report says what is affected (the site, the desktop app, the
release workflow), the version or the commit, the steps to reproduce it, and
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
- The Pages Functions under `functions/`: `/api`, `/admin/api` and `/media`,
  and how they check identity and visibility.
- The desktop app: the Electron shell in `electron/`, its `bozzetto://`
  protocol, the native file handling, and how it talks to a server you point
  it at.
- The release pipeline: the workflows in `.github/workflows/`, and the
  installers, `SHA256SUMS` and provenance attestations they publish.

Out of scope:

- Cloudflare's and GitHub's own platforms, and Cloudflare Access itself.
- A deployment that does not follow the README (no Access application in
  front of `/admin`, say), unless the README itself is what is wrong.
- That the desktop builds are unsigned, so macOS and Windows warn before
  opening them. This is known; check a download against `SHA256SUMS` and its
  attestation instead (see the README's Releasing section).
- Denial of service by volume, and social engineering.
- Vulnerabilities in a dependency with no demonstrated effect on Bozzetto:
  please report those to the dependency.
