# Deployment

Running Bozzetto locally is in [development.md](development.md), building and releasing the desktop app in [desktop.md](desktop.md), and the accounts' design in [accounts.md](accounts.md).

Bozzetto runs entirely on Cloudflare Pages, Functions, D1 and R2. No server to run yourself.

Hosted on [Cloudflare Pages](https://pages.cloudflare.com/) through the GitHub integration, so every push to `main` builds and deploys.

- Build command `npm run build`, output directory `dist`, with the build variable `NODE_VERSION=22`: the passkey library and its certificate parser need Node 20 or later, and CI builds on 22.
- The `prebuild` step generates the demo timelapse, so those assets ship without being committed.
- Bindings (Pages → Settings → Functions): a D1 database bound as `DB` and an R2 bucket bound as `BUCKET`. Apply migrations with `npm run db:migrate`, before the code that needs them deploys: from `0002_visibility.sql` on, every list, manifest and media read asks for the `visibility` column, and from `0003_accounts.sql` on, the gallery lists templates, which 0003 makes of every public project, so it shows the same set as before. 0003 only adds, and 0.5.5 runs on it. It is applied in production, through the console and recorded; staging takes it with `npx wrangler d1 migrations apply bozzetto-staging --remote`, from a `wrangler.toml` that names that database.
- Functions run on `/api/*`, `/admin/api/*`, `/admin/login`, `/media/*` and `/m/*` only, which `public/_routes.json` lists. Without it, the root middleware (`functions/_middleware.ts`) would run for every static file, each billed as a Functions request. A Function on any other path never runs until the file names it.
- Admin auth: put a Cloudflare Access application in front of `/admin*`, including `/admin/api/*`. Add every hostname you edit from, both `*.pages.dev` and any custom domain. The identity header Access adds can be sent by anyone wherever Access does not front a route, so on every host but a local one (`localhost`, `127.0.0.1`, `[::1]`) the admin routes also verify the Access token, and `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are required: until both are set, every admin request is answered 503, "Access verification is not configured". Set them in Pages → Settings for both Production and Preview. The team domain is the `<team>.cloudflareaccess.com` host the login page redirects to; the audience is the application's Audience (AUD) tag, on its page in Zero Trust → Access → Applications. `ADMIN_EMAILS` is optional: set it to limit which identities may write; unset, anyone the Access policy lets in is the owner. In the application's cookie settings, set the SameSite attribute to Lax, so a page on another site cannot make a signed-in browser send the session with a write. With accounts on, once the owner has made an account (`/admin/` offers **Create your account** the first time), the owner tools want that account signed in as well: a second lock, not a replacement, so the Access application stays.
- The Access application's session duration decides how often the installed app asks to sign in again (Zero Trust → Access → Applications → the app → Session Duration).
- Production is served at `bozzetto.vidarrapp.se` as a custom domain on the Pages project.
- The files host, `files.vidarrapp.se`, is a second custom domain on the same Pages project (Custom domains → Set up a domain; the dashboard makes the proxied CNAME). It serves the templates' files on `/m/` and answers nothing else. Once it answers, set `MEDIA_ORIGIN` to it, with `APP_ORIGIN` beside it, since it lets the app's pages read its files by naming that origin; until both are set, manifests name the files on the app's own `/media/`, which serves the same. Build with `VITE_MEDIA_ORIGIN` set to the same origin, so the installed app keeps the files host's thumbnails as it keeps the others.

Without Wrangler at hand, a migration can go in through the D1 dashboard's
**Console**: run the file's statements one at a time, then record it so a later
`npm run db:migrate` skips it. A database first set up without `db:migrate`
has no bookkeeping table yet, so create it as Wrangler would:

```sql
CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO d1_migrations (name) VALUES ('0001_init.sql'), ('0002_visibility.sql');
```

After a console run of `0003_accounts.sql`, record it the same way: `INSERT INTO d1_migrations (name) VALUES ('0003_accounts.sql');`.

`wrangler.toml` is gitignored. The committed `wrangler.toml.example` is the template, and lists every variable below.

## Turning on accounts

**Accounts are off until the owner sets their secrets and turns them on with `ACCOUNTS_ENABLED=true`.** Unset, the site is 0.5.5 with templates: `/api/config` says `accounts: false`, `/api/auth/*` and `/api/me/*` answer 404, and the owner signs in through Cloudflare Access alone. The rest can be set ahead of the switch, which changes nothing until it is thrown. The design, and why each part is as it is, is in [accounts.md](accounts.md).

Set them in Pages → Settings → Variables and Secrets, for Production; staging has a project of its own (below). Locally the variables go under `[vars]` in `wrangler.toml` and the secrets in `.dev.vars`.

| Name | Kind | Production | Unset |
| --- | --- | --- | --- |
| `ACCOUNTS_ENABLED` | variable | `true` | accounts off, whatever else is set |
| `APP_ORIGIN` | variable | `https://bozzetto.vidarrapp.se` | passkeys and Turnstile refused (503), and the files host not used |
| `RP_ID` | variable | `bozzetto.vidarrapp.se` | passkeys refused (503); codes still sign in |
| `MEDIA_ORIGIN` | variable | `https://files.vidarrapp.se` | the templates' files come from the app's own `/media/` |
| `MAIL_FROM` | variable | `Bozzetto <login@vidarrapp.se>` | mail refused (503), once `RESEND_API_KEY` is set |
| `TURNSTILE_SITE_KEY` | variable | the widget's site key | no bot-check widget is drawn |
| `AUTH_SECRET` | secret | `openssl rand -base64 32`, one per project | every sign-in and Join refused (503): it keys the codes and the rate limits |
| `TURNSTILE_SECRET` | secret | the widget's secret key | Join and every code refused (503) |
| `RESEND_API_KEY` | secret | Resend's API key | every mail refused (503) |
| `VITE_MEDIA_ORIGIN` | build variable | `https://files.vidarrapp.se` | the installed app keeps no thumbnails from the files host |
| `NODE_VERSION` | build variable | `22` | the build image's own Node |

Then, with accounts on, the owner opens `/admin/`, makes the owner's account with **Create your account**, and sends the first invites from the **Invites** tab. The dashboard work this needs (Resend, Turnstile, the files host, the WAF rules) is in the checklist below.

**Staging** is a second Pages project, `bozzetto-staging`, on this repository with `staging` as its production branch: its own D1 and R2 (both `bozzetto-staging`), the hosts `bozzetto-staging.vidarrapp.se` and `files-staging.vidarrapp.se`, its own Access application, `RP_ID=bozzetto-staging.vidarrapp.se`, and accounts on, so they are tried there first, on the real iPad too. Not the Preview environment: its bindings and secrets would reach every branch preview. Staging may use Cloudflare's Turnstile test keys (`1x00000000000000000000AA` with the secret `1x0000000000000000000000000000000AA`), which pass every check and so keep nobody out.

### What accounts bring

- **By invite.** An invite link opens **Join**: a handle, an email address, a box to confirm you are 13 or older and accept the Terms, and Cloudflare's bot check; a six-digit code by mail finishes it.
- **Passkeys and email codes.** Sign in with a passkey (Face ID, Touch ID, a phone or a security key) or a code mailed to you, in a dialog over the page, so the work on it stays put. No passwords.
- **My projects.** Save to library and Capture keep your work on the server, private to you, in 250 MB of your own, with a meter that shows how much is used. Open, rename, download and delete it from **My projects**, where the list stays readable offline.
- **Your data, and leaving.** **Account** changes your handle and address, manages passkeys and where you are signed in, downloads everything the site keeps about you as one zip, and deletes the account with everything in it.
- **Templates.** The gallery's templates open as copies that are yours to keep.
- **Owner tools.** Invites, the accounts (suspend, sign out, quota, recount, finish a deletion) and the audit log, on `/admin/`, behind Cloudflare Access and the owner's own account.
- **Privacy.** No analytics and no ads; the Privacy notice and the Terms are at `/legal/`.

With accounts on, tabs beside **Projects** on `/admin/` hold the owner's tools over accounts. **Invites** makes invite links, each admitting from 1 to 500 accounts (one unless you say) for 1 to 90 days (14 unless you say), with a label for your own use; a link is shown once, as it is made, with **Copy**, and the list gives each one's uses, dates and state, with **Revoke** for a live one. **Users** lists the accounts, newest first, 50 a page: handle, address, role, status, when each joined and was last seen, how many projects, and storage used against the quota as a bar. **Manage** on one counts its passkeys and sessions and offers what can be done from where it stands: **Suspend** (with a reason, which is mailed to its holder) or **Unsuspend**, **Revoke sessions**, its **Quota** in MiB, **Recount** its storage from the files themselves, and **Finish deletion** for a deletion its holder began and left, which are flagged at the top once they have waited a day. Your own account is not suspended or signed out from there. **Audit** lists what was done, newest first, filtered by action or by an account's or project's id.

## Security settings checklist

What the repository cannot set for itself: settings made by hand in the
Cloudflare and GitHub dashboards. Go through them once, and again after
changing the deployment.

Cloudflare:

- [ ] The Access variables from the admin auth bullet above are set for both
  **Production** and **Preview** (Pages → Settings → Variables and Secrets).
- [ ] The Access application's cookie has **SameSite** set to **Lax**
  (Zero Trust → Access → Applications → the app → Settings → Cookie settings).
- [ ] The Access application covers every hostname that serves `/admin`: the
  custom domain `bozzetto.vidarrapp.se`, `bozzetto-3me.pages.dev`, and
  `*.bozzetto-3me.pages.dev` for preview deployments.
- [ ] Preview deployments do not bind the production D1 database or R2
  bucket (Pages → Settings → Bindings, Preview): give Preview its own, or none.
- [ ] HSTS is on for the zone (SSL/TLS → Edge Certificates → HTTP Strict
  Transport Security). Include subdomains only if every subdomain of the zone
  serves HTTPS.

Accounts, before `ACCOUNTS_ENABLED` is turned on ([accounts.md](accounts.md) §11), in
production and again for staging:

- [ ] **Resend.** An account, with the domain added (Resend → Domains:
  `vidarrapp.se`, or a sending subdomain such as `mail.vidarrapp.se`, which
  Resend recommends: the same records one level down), its DNS records in
  Cloudflare, and open and click tracking off, since tracking would route
  sign-in links through Resend. `RESEND_API_KEY` is stored as a secret and
  `MAIL_FROM` set, in both projects. The free tier sends 100 mails a day;
  the server stops at 90. The values come from Resend's page for the domain:

  | Type | Name | Value |
  | --- | --- | --- |
  | MX | `send` | `feedback-smtp.<region>.amazonses.com`, priority 10 |
  | TXT | `send` | `v=spf1 include:amazonses.com ~all` |
  | TXT | `resend._domainkey` | the DKIM key, DNS only (not proxied) |
  | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<owner>`, only if there is none yet; `p=quarantine` after two clean weeks |

  The `send` records are the bounce address, so the root's own SPF record
  stays as it is.
- [ ] **Turnstile.** One Managed widget whose hostnames are both app hosts,
  `bozzetto.vidarrapp.se` and `bozzetto-staging.vidarrapp.se` (Turnstile →
  Add widget). `TURNSTILE_SITE_KEY` is set as a variable and
  `TURNSTILE_SECRET` stored as a secret.
- [ ] **`AUTH_SECRET`.** Made with `openssl rand -base64 32`, a different one
  for each project, and stored as a secret.
- [ ] **The files host.** `files.vidarrapp.se` is a custom domain on the
  Pages project, and `files-staging.vidarrapp.se` on staging's (Pages → the
  project → Custom domains); `MEDIA_ORIGIN`, `APP_ORIGIN` and the build's
  `VITE_MEDIA_ORIGIN` name them.
- [ ] **WAF custom rules** (Security → WAF → Custom rules; Free allows 5),
  each with the action **Block**:
  - `http.host in {"files.vidarrapp.se" "files-staging.vidarrapp.se"} and not starts_with(http.request.uri.path, "/m/")`:
    the files hosts serve `/m/` and nothing else. The Functions refuse the
    rest already; this keeps the static files, which never reach them, off
    those hosts too.
  - `starts_with(http.request.uri.path, "/api/dev/")`: the test hooks,
    which answer on `localhost` alone, are not reachable at all.
- [ ] **WAF rate limiting** (Security → WAF → Rate limiting rules; Free allows
  one, counting per IP over 10 seconds): requests matching
  `starts_with(http.request.uri.path, "/api/auth/")`, more than 20 in 10
  seconds, are blocked for 10 seconds. The server keeps its own limits on
  mail, codes and sign-ups; this one stops a flood before it costs a request.
  On Pro, a second rule: `starts_with(http.request.uri.path, "/m/") or starts_with(http.request.uri.path, "/media/")`,
  more than 600 a minute, blocked for a minute; generous, since a timelapse
  fetches hundreds of frames.
- [ ] **The addresses.** The contact address for privacy requests and the
  takedown address for reports exist, and are written into
  `public/legal/privacy.html` and `public/legal/terms.html` in place of the
  bracketed placeholders, with the owner's other decisions there (what copies
  of the templates may be used for, and nudity). The accounts suite checks
  that the placeholders are there, so its legal-pages check changes with them.

GitHub (Settings):

- [ ] Secret scanning and push protection are on (Advanced Security).
- [ ] Private vulnerability reporting is on (Advanced Security); `SECURITY.md`
  sends reporters there.
- [ ] Release immutability is on (General → Releases), so a published
  release's files and tag cannot be changed.
- [ ] A tag ruleset: nobody may move or delete a `v*` tag (GitHub's import
  refuses a bypass entry for Actions, so creation stays open to whoever can
  push: the owner and the release workflow). Save this as `ruleset.json` and run
  `gh api repos/vidarrapp/bozzetto/rulesets --method POST --input ruleset.json`:

  ```json
  {
    "name": "Release tags",
    "target": "tag",
    "enforcement": "active",
    "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
    "rules": [{ "type": "update" }, { "type": "deletion" }],
    "bypass_actors": [
      { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
    ]
  }
  ```

  `5` is the repository admin role. `15368` is GitHub Actions, which is how
  **Release desktop** run from the Actions tab tags `main` itself. Leave that
  entry out to make the tags admins-only; releases then start from a tag you
  push.
- [ ] A `main` ruleset requiring CI to pass. Admins bypass it, so pushing
  straight to `main` still works; pull requests, Dependabot's included, wait
  for the three checks. The same command, with this file:

  ```json
  {
    "name": "main: CI passes",
    "target": "branch",
    "enforcement": "active",
    "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
    "rules": [
      {
        "type": "required_status_checks",
        "parameters": {
          "strict_required_status_checks_policy": false,
          "do_not_enforce_on_create": false,
          "required_status_checks": [
            { "context": "typecheck-build", "integration_id": 15368 },
            { "context": "functions", "integration_id": 15368 },
            { "context": "e2e-smoke", "integration_id": 15368 }
          ]
        }
      }
    ],
    "bypass_actors": [
      { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
    ]
  }
  ```
