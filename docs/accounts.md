# Accounts, phase 1 (Bozzetto 0.6)

Design for release 0.6, written against 47caede and reviewed by the owner; the brief for the batches in §12. It takes the owner's decisions and the audit's requirements as given; where it had to choose, the reason follows in a line.

## Decisions in brief

- **Identity.** One principal per request, resolved in a new root `functions/_middleware.ts`. `/admin/*` needs the Access JWT and the owner's app session; everything else needs the app session alone.
- **Sign-in.** Passkeys come first, via `@simplewebauthn/server` 14.0.3 (exact pin) and `@simplewebauthn/browser` 14.0.0.
  - Six-digit email codes cover sign-up, recovery and sign-in without a passkey.
  - Invites and Turnstile gate registration.
- **Projects** gain `owner_id`, `template`, `storage_prefix` and `bytes`. Migration 0003 makes every public project a template. No R2 object moves, because the key prefix lives on the row.
- **Files.** Private files are served only through authenticated app-origin routes. Public files (templates now, community work in phase 3) come from `files.vidarrapp.se`, a second custom domain on the same Pages project, served by code.
  - Why not an R2 public domain: it publishes every object by key, while "public" here is a row property that changes.
- **Flag.** Everything sits behind `ACCOUNTS_ENABLED`; unset, the site is 0.5.5 with templates.
- **Platform.** The design fits the Workers Free plan (10 ms of CPU and 50 subrequests per request, bindings included). Hence zips built on the client, deletion that resumes across requests, and one D1 read per session.

**simplewebauthn on Workers, verified:**

- **No Node APIs.** The 14.0.3 ESM build has no `node:` imports and needs only `globalThis.crypto` and `SubtleCrypto`, both workerd globals. JSR lists Cloudflare Workers as a runtime.
- **Runs on Web APIs alone.** An esbuild bundle ran a `none`-attestation registration and an assertion in a V8 context with only Web APIs, and refused a wrong origin.
- **Cost.** 309 KB minified, 85 KB gzipped, and about 1 ms of CPU per warm assertion. It typechecks under `tsconfig.functions.json`.
- **Next and fallback.** `check.mjs` confirms it in workerd. If it fails there, use 13.3.3: the same API, without 14.0.2's CRL fixes.

## 1. Data model

`migrations/0003_accounts.sql` only adds, and 0.5.5 runs on it, so it is applied before the code. Every statement stands alone and none is a trigger, so the D1 console can run them. They ran here on SQLite 3.51, with the statements of §3–4.

```sql
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                       -- 'u-' + 26 base32 chars (128 bits)
  handle TEXT NOT NULL COLLATE NOCASE,       -- ^[a-z0-9][a-z0-9_-]{2,29}$
  email TEXT NOT NULL COLLATE NOCASE, webauthn_user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','moderator','member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleting')),
  quota_bytes INTEGER NOT NULL DEFAULT 262144000, bytes_used INTEGER NOT NULL DEFAULT 0 CHECK (bytes_used >= 0),
  invite_id TEXT, terms_version TEXT NOT NULL, terms_accepted_at INTEGER NOT NULL, age_confirmed_at INTEGER NOT NULL,
  handle_changed_at INTEGER, suspended_reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle ON users (handle);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_webauthn ON users (webauthn_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_one_owner ON users (role) WHERE role = 'owner';
CREATE TABLE IF NOT EXISTS retired_handles (handle TEXT PRIMARY KEY COLLATE NOCASE, until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  public_key BLOB NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]',
  device_type TEXT NOT NULL, backed_up INTEGER NOT NULL DEFAULT 0, aaguid TEXT, name TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_used_at INTEGER, counter_warning_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials (user_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,      -- public id, SHA-256 of the cookie token
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  method TEXT NOT NULL, client TEXT NOT NULL DEFAULT 'web', user_agent TEXT,
  created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, reauth_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, revoked_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id, revoked_at);
CREATE TABLE IF NOT EXISTS pending_auth (                   -- email codes and WebAuthn challenges
  id TEXT PRIMARY KEY,                       -- SHA-256 of the flow or ceremony cookie token
  kind TEXT NOT NULL, purpose TEXT NOT NULL, -- email|webauthn, register|sign_in|reauth|add_passkey|change_email
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE, email TEXT, handle TEXT, invite_id TEXT,
  secret TEXT NOT NULL,                      -- HMAC(AUTH_SECRET, id:code), or the challenge
  link_hash TEXT, attempts INTEGER NOT NULL DEFAULT 0, sends INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL DEFAULT '',
  max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 500), uses INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users (id) ON DELETE CASCADE, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, revoked_at INTEGER, CHECK (uses <= max_uses));
ALTER TABLE projects ADD COLUMN owner_id TEXT REFERENCES users (id);   -- NULL: template (or owner's, pre-bootstrap)
ALTER TABLE projects ADD COLUMN template INTEGER NOT NULL DEFAULT 0 CHECK (template IN (0, 1));
ALTER TABLE projects ADD COLUMN storage_prefix TEXT;                   -- NULL: legacy 'projects/<id>/'
ALTER TABLE projects ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN moderation TEXT NOT NULL DEFAULT 'none';  -- phase-3 stub
UPDATE projects SET template = 1 WHERE visibility = 'public';          -- the template migration
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_template ON projects (template, visibility, created_at DESC);
CREATE TABLE IF NOT EXISTS pending_uploads (
  id TEXT PRIMARY KEY, r2_upload_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE,     -- NULL: a template, no quota
  file TEXT NOT NULL, declared_bytes INTEGER NOT NULL, replaces_bytes INTEGER NOT NULL DEFAULT 0,
  header_ok INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, UNIQUE (project_id, file));
CREATE TABLE IF NOT EXISTS upload_parts (
  upload_id TEXT NOT NULL REFERENCES pending_uploads (id) ON DELETE CASCADE,
  part INTEGER NOT NULL, user_id TEXT, bytes INTEGER NOT NULL, PRIMARY KEY (upload_id, part)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_upload_parts_user ON upload_parts (user_id);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
  actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT, detail TEXT NOT NULL DEFAULT '{}');
CREATE INDEX IF NOT EXISTS idx_audit_subject ON audit_log (subject, at);
CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT NOT NULL, win INTEGER NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY (bucket, win)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS dev_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
  to_addr TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL);       -- stub mailer, loopback only
```

- **Visibility.** The landing shows `template = 1 AND visibility = 'public'`; a privatised template is `private`. Members' projects are always `private`: the member API refuses `public`, and nothing is unlisted.
- **Ownership.** Member writes use `WHERE id = ? AND owner_id = ?`. Owner tools use `WHERE id = ? AND (template = 1 OR owner_id IS ?)`.
- **Usage** is `bytes_used` plus the user's `upload_parts`.
- **Constraints.** Enumerated columns get CHECKs like `role`'s. `audit_log.detail` never holds an IP, code, token or email, and `rate_limits` holds IPs only as keyed hashes.
- **Foreign keys.** D1 enforces them, and `projects.owner_id` has no ON DELETE action, so nobody who still owns projects can be deleted before R2 is cleared.
- **`d1_migrations`** stays hand-kept: after the console run, `INSERT INTO d1_migrations (name) VALUES ('0003_accounts.sql');`. Staging uses `wrangler d1 migrations apply`.

## 2. Identity and sessions

A root middleware compiles to `include: ["/*"]` (wrangler's `convertRoutesToGlobPatterns`), which would bill every static file. So `public/_routes.json` includes only `/api/*`, `/admin/api/*`, `/admin/login`, `/media/*` and `/m/*`. On those paths the middleware:

1. answers 404 on the `MEDIA_ORIGIN` host to anything but `GET /m/*`;
2. runs `crossSiteWrite()`, moved unchanged out of `requireAdmin`, on every write;
3. sets `ctx.data.principal`:

```ts
type Principal =
  | { kind: 'guest' }
  | { kind: 'user'; user: UserRow; session: SessionRow; recentAuth: boolean }  // outside /admin/
  | { kind: 'admin'; email: string; owner: UserRow | null };                    // /admin/* only
```

**On `/admin/*`:**

- **Lock 1** is today's `adminEmail()`, which verifies the Access JWT. It is enough alone while accounts are off or no owner exists (`owner: null`).
- **Lock 2** applies once an owner exists: `__Host-bz_session` must belong to the `role = 'owner'` user.
- **Failing lock 2** gives 403 `owner_session`, and the page opens the sign-in dialog.

**Elsewhere:**

- Access headers and `CF_Authorization` are ignored.
- No cookie is `guest`, with no query.
- A cookie costs one `sessions JOIN users` read by `token_hash`. It requires `revoked_at IS NULL`, `expires_at > now`, `last_seen_at > now − 30 d`, and status `active` (or `deleting`, which reaches only `POST /api/me/delete`).
- `last_seen_at` is rewritten at most hourly, in `waitUntil`.

**Roles.** `functions/_shared/auth/permissions.ts` is the one map:

- `owner`: everything;
- `moderator`: `content.moderate` (no routes until phase 3) plus own projects;
- `member`: own projects.

| Path | Credential | Grants |
|---|---|---|
| `/admin/*` | Access JWT + owner session (once an owner exists) | owner tools |
| `/api/*`, app-origin `/m/*` | app session | own data, public reads |
| `files.vidarrapp.se/m/*` | none | public files |

| Cookie | Value | Attributes | Max-Age |
|---|---|---|---|
| `__Host-bz_session` | `bz1_` + base64url(32 random bytes) | Path=/; Secure; HttpOnly; SameSite=Lax | 90 d |
| `__Host-bz_flow` | email-flow token (32 bytes) | same, SameSite=Strict | 15 min |
| `__Host-bz_wa` | ceremony token (32 bytes) | same, SameSite=Strict | 5 min |

- **Lifetimes.** Sessions last 90 days absolute and 30 days idle (the design proposed 60 and 14; an occasional sculptor on an iPad would be asked to sign in too often, and a passkey re-check is cheap). Recent authentication (`reauth_at`) means the last 10 minutes. Every sign-in mints a fresh token and clears the other cookies.
- **CSRF, three layers:**
  - SameSite on every cookie.
  - `crossSiteWrite()`: Sec-Fetch-Site must be `same-origin` or `none`, else the Origin must match. This refuses the same-site files host too.
  - `readJson()` requires `application/json`, and binary bodies use `application/octet-stream`. Both force a preflight that nothing answers.
- **Sessions.** `GET /api/me/account` lists them (id, client, user agent, dates, method, current). `DELETE /api/me/sessions/:id`, `POST /api/me/sessions/revoke-all {keepCurrent}` and `POST /api/auth/signout` revoke them. Suspension and deletion revoke them all.

**Desktop.** Only `electron/server.cjs` changes.

1. **`server:signIn`** reads `/api/config`. With accounts on, it opens `<server>/?signin=desktop` and polls for `__Host-bz_session` instead of `CF_Authorization`; with accounts off, it opens today's Access window.
   - The page leads with the email code. An unsigned Electron build gets no Touch ID passkeys (that needs `app.configureWebAuthn` and a keychain entitlement), and platform passkeys elsewhere in Electron are unproven.
   - It keeps "Use a passkey" for phones and security keys, sends `client: 'desktop'`, and skips the service worker.
2. **`server:get`** reports signed in while the cookie exists. The renderer confirms with `GET /api/me`.
3. **`server:signOut`** posts `/api/auth/signout` through the jar, then clears cookies.
4. **`ALLOWED` gains `m`.** `HttpSource` already maps foreign frame URLs to the server path, and the app host serves template `/m/*`.

## 3. Auth flows

**Errors** are `{error, code}`. With accounts off, `/api/auth/*` and `/api/me/*` answer 404 `accounts_off`.

| Status | Codes |
|---|---|
| 400 | `bad_request`, `code_invalid {attemptsLeft}` |
| 401 | `signin`, `reauth` |
| 403 | `cross_site`, `turnstile`, `suspended`, `owner_session` |
| 404 | `not_found` (also anything not yours) |
| 409 | `handle_taken` |
| 410 | `invite_invalid`, `flow_expired` |
| 413 | `file_too_large`, `quota_exceeded` |
| 415 | `bad_type` |
| 422 | `bad_scene` |
| 429 | `rate_limited`, with Retry-After |
| 503 | `accounts_off`, `not_configured`, `mail_paused` |

**Rate limits** are fixed windows in `rate_limits`. Each is keyed by HMAC(AUTH_SECRET, IP or address), cut to 128 bits and kept 48 hours.

| What | Limit |
|---|---|
| Mail per address | 3 per 15 min, 10 per day |
| Mail per IP | 10 per hour |
| All mail | 90 per UTC day (Resend's free tier allows 100); then 503 `mail_paused` |
| Code checks per IP | 30 per 10 min, plus 5 per code |
| Passkey options per IP | 60 per 10 min |
| Registrations per IP | 5 per hour |
| Invite checks per IP | 20 per hour |
| Handle checks per IP | 60 per 10 min |

**Config and identity.**

- `GET /api/config` is public and returns `{accounts, rpId, turnstileSiteKey, mediaOrigin, termsVersion, limits}`.
- `GET /api/me` returns `{id, handle, role, status, usage: {used, reserved, quota}}`.
- `GET /api/me/account` returns `{email, createdAt, termsVersion, passkeys, sessions}`.

**Invite and registration.**

1. **Link.** `https://bozzetto.vidarrapp.se/?invite=<16 random bytes, base64url>`. The app moves the token to sessionStorage and opens Join.
2. **Live checks.** `POST /api/auth/invite/check {invite}` returns 200 `{expiresAt}` or 410. `GET /api/auth/handle?h=` returns `{available, reason?: format|reserved|taken|retired}`.
   - Input is lower-cased before the regex.
   - The reserved list in `functions/_shared/auth/handles.ts` starts with: admin, administrator, api, app, owner, moderator, mod, staff, support, help, bozzetto, vidarrapp, me, u, user, account, settings, login, logout, signin, signup, register, join, invite, media, files, static, assets, templates, gallery, root, system, null, undefined, abuse, security, privacy, terms, legal, www, mail.
3. **Start.** `POST /api/auth/register/start {invite, handle, email, acceptTerms, ageConfirmed, turnstile, link?}`:
   - checks Turnstile (`register`), the invite, the handle and the address;
   - stores the pending account in `pending_auth`, mails the code, and sets the flow cookie;
   - returns 202 `{expiresAt, resendAfter: 60}`.

   A registered address gets an "already registered" mail instead, and the same 202.
4. **Verify.** `POST /api/auth/register/verify {code}` checks the code (see email code, step 3), then runs one D1 batch:
   1. `INSERT INTO users … SELECT … FROM invites WHERE id = ? AND revoked_at IS NULL AND expires_at > ? AND uses < max_uses`;
   2. `UPDATE invites SET uses = uses + 1 WHERE id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ?)` (its CHECK rolls back a raced last use);
   3. the session, the flow's deletion, and the audit row.

   - No row: 410.
   - UNIQUE clash: 409, and the flow is kept.
   - Success: 201 `{user}` with the cookie.
5. **Passkey offer.** The new session counts as recent authentication. The offer can be skipped, and comes back after each code sign-in.

**Passkey sign-in.**

1. **Options.** Opening the dialog calls `POST /api/auth/passkey/options`, which returns:
   - `rpId: RP_ID`, `userVerification: 'required'`, `allowCredentials: []`, and a 300 000 ms timeout;
   - a 32-byte challenge, held 5 minutes and bound to `__Host-bz_wa`.
2. **Client.**
   - Where `browserSupportsWebAuthnAutofill()` holds, it calls `startAuthentication({optionsJSON, useBrowserAutofill: true})` on an email field marked `autocomplete="username webauthn"`.
   - A button starts the modal ceremony from the click, because iPadOS before 17.4 needs a gesture.
3. **Verify.** `POST /api/auth/passkey/verify {response, client?}`:
   1. consumes the challenge first (`DELETE … RETURNING`, single-use even on failure);
   2. runs `verifyAuthenticationResponse` with `expectedOrigin: APP_ORIGIN`, `expectedRPID: RP_ID` and `requireUserVerification: true`;
   3. checks `crossOrigin !== true`, `userHandle === webauthn_user_id`, and an active user.

   Any failure is the same 400.
4. **Counter.** The library throws on a regression, so it gets `counter: 0` and the comparison is ours. A stored counter above 0 with a new one no higher is accepted, sets `counter_warning_at`, and is audited.

**Email code (sign-in, recovery).**

1. **Start.** `POST /api/auth/email/start {email, turnstile, link?}` checks Turnstile (`email-code`). It mails a code only if an active account has that address, but always returns 202 with the flow cookie.
2. **Resend.** `POST /api/auth/email/resend {turnstile}` sends a new code: at most 3 per flow, 60 s apart.
3. **Verify.** `POST /api/auth/email/verify {code}`:
   1. increments `attempts` `WHERE attempts < 5 AND expires_at > ? RETURNING …`; no row is 410 `flow_expired`;
   2. compares HMACs with `crypto.subtle.timingSafeEqual`; a mismatch is 400 `code_invalid`;
   3. on a match, consumes the row with `DELETE … RETURNING` and starts a session.
4. **Codes** come from `crypto.getRandomValues`, rejection-sampled into 000000–999999. They expire after 10 minutes and are stored as HMAC-SHA256(AUTH_SECRET, `flowId:code`).
5. **Link variant,** for desktop browsers only. The client sends `link: true` when neither standalone nor on iOS.
   - The mail adds `/?link=<32-byte token>`, which the app posts to `/api/auth/email/link`.
   - It works once, only with that browser's flow cookie, and consumes the code. A mail scanner gets nothing.

**Reauthentication and passkeys.**

- **Reauthentication** is required within 10 minutes for adding or removing a passkey, changing email, export, and deletion. The passkey and email endpoints take `{reauth: true}` with a session, offer only the user's credentials, and set `reauth_at` (204).
- **Registration options.** `POST /api/me/passkeys/options` calls `generateRegistrationOptions({rpName: 'Bozzetto', rpID, userID: webauthn_user_id, userName: handle, attestationType: 'none', authenticatorSelection: {residentKey: 'required', userVerification: 'required'}, excludeCredentials, timeout: 300000})`.
  - It leaves out `preferredAuthenticatorType`, whose `'localDevice'` forces `authenticatorAttachment: 'platform'` and locks out phones and security keys.
- **Saving.** `POST /api/me/passkeys {response, name?}` runs the same checks. The name defaults from the user agent; an account holds at most 10.
- **Managing.** `PATCH` and `DELETE /api/me/passkeys/:id`. Delete needs recent authentication, and the last passkey may go. Changes are mailed.
- **Email and handle.** `POST /api/me/email/start {email, turnstile}` needs recent authentication and mails a code to the new address. `POST /api/me/email/verify {code}` swaps the address and tells the old one. `PATCH /api/me {handle}` works at most once per 30 days, and the old handle is retired for 90 days.
- **Sign out everywhere.** `POST /api/me/sessions/revoke-all {keepCurrent: false}` revokes all sessions, audits, and clears the cookie.

**Export.** `GET /api/me/export` returns `bozzetto-export/1` JSON:

- account: handle, email, role, dates, terms;
- passkeys: name, dates, type, AAGUID;
- sessions;
- projects: metadata, `data`, and files with sizes and `/api/me/media/…` URLs;
- audit rows.

The client zips it with client-zip 2.5.1 (MIT, no dependencies), one file per request. The archive holds `account.json`, `projects/<slug>-<id>/{project.json, scene.bozz, thumb.jpg, frames/NNNN.glb}` and `README.txt`.

- **Why client-side:** a zip needs a CRC-32 over every byte, which is beyond 10 ms of CPU for 250 MiB; one file per request also stays far under 50 subrequests.
- **iPad:** the zip is held in memory there, so per-project downloads remain the fallback.

**Deletion.** `POST /api/me/delete {handle}`.

- **First call:** sets `status = 'deleting'`, revokes other sessions, audits, and mails.
- **Each later call** (or the owner's Finish deletion) spends up to 40 subrequests on, in order:
  1. aborting uploads;
  2. per project, R2 `list` and `delete` (1,000 keys a call), then the row;
  3. sweeping `users/<uid>/`, except prefixes templates still use (owner only);
  4. deleting credentials, `pending_auth`, invites, sessions, then the user;
  5. holding the handle in `retired_handles` for 90 days.
- **Response:** `{done: false, remaining}` until `{done: true}`.
- **Audit rows** keep only the bare id, and expire after 12 months.

## 4. Storage and quota

**Keys** are `prefixFor(row) + file`, with `file` matching `^(scene\.bozz|thumb\.jpg|frames/sd/\d{4}\.glb)$`. Nothing is taken from the URL.

- New rows use `users/<uid>/projects/<pid>/…`.
- Pre-0.6 rows (`storage_prefix` NULL) use `projects/<id>/…`.
- Templates keep their prefix, because a move is a copy plus a delete per object, for up to 10,000 frames.

**Member caps** (owner tools keep today's):

| Item | Cap |
|---|---|
| Scene | 100 MiB |
| Upload parts | 8 MiB asked, ≤ 32 MiB accepted |
| Frame | 32 MiB |
| Thumbnail | 1 MiB |
| Projects | 500 |
| Frames per project | 10,000 |
| Quota | 250 MiB (owner 10 GiB, adjustable) |

**Routes.** Member routes mirror the owner's, so the client swaps a base path:

```
GET|POST        /api/me/projects             list (with bytes) | create {title, mode} → 'p-<26>', private
GET|PUT|DELETE  /api/me/projects/:id         manifest | patch | delete
POST|PUT|DELETE /api/me/projects/:id/scene   start {size} | ?upload=&part= | ?upload= complete {parts, objects, tris} | abort
POST            /api/me/projects/:id/frames?index=N   /api/me/projects/:id/thumb
GET             /api/me/media/:id/<file>[?download=1]
```

**Quota.** One atomic statement admits each part before R2 sees it:

```sql
INSERT INTO upload_parts (upload_id, part, user_id, bytes)
SELECT :up, :part, u.id, :n FROM users u JOIN pending_uploads pu ON pu.id = :up AND pu.user_id = u.id
WHERE u.id = :uid AND u.status = 'active'
  AND u.bytes_used - pu.replaces_bytes + :n + (SELECT COALESCE(SUM(bytes), 0) FROM upload_parts
        WHERE user_id = :uid AND NOT (upload_id = :up AND part = :part)) <= u.quota_bytes
  AND :n + (SELECT COALESCE(SUM(bytes), 0) FROM upload_parts WHERE upload_id = :up AND part <> :part) <= pu.declared_bytes
ON CONFLICT (upload_id, part) DO UPDATE SET bytes = excluded.bytes;
```

- **Refusals.** No row means 413 `quota_exceeded {used, quota}`. A retried part replaces its own reservation.
- **Completion.** R2 `complete()`, then one batch: it moves `bytes_used` and `projects.bytes` by size − `replaces_bytes`, and deletes the pending upload with its parts.
- **Concurrency.** One upload per (project, file). A start aborts the user's uploads older than 24 hours; R2 drops them at 7 days.
- **Frames and thumbnails** reserve with a conditional `UPDATE users SET bytes_used = bytes_used + :delta WHERE … <= quota_bytes` before the `put`, and are refunded if the put fails.
- **Recount.** An owner tool recounts from R2 listings.

**Content checks** run in memory, before R2.

- **Scene part 1** must come first and start `1f 8b 08` or `BOZ1`.
  - `DecompressionStream('gzip')` inflates only `8 + headerLen` bytes. The server caps the header at 1 MiB; the client allows 16 MiB.
  - Those bytes pass `readLayout()`, moved unchanged from `SceneFile.ts` to `shared/bozz.ts` (included in both tsconfigs).
  - Then a new `checkHeader()`: the parts of `validSavedScene` and `sanitize.ts` that need no array contents. That is version, buffer refs in range and used once, array kind and length per mesh field, depth ≤ 32, no `__proto__`, names ≤ 200 characters, ≤ 1,024 materials, and ≤ 1 GiB unpacked.
  - Failure is 422 `bad_scene {reason}`. `unpackScene` runs both checks first too, so they cannot drift.
- **Scene last part.** Its gzip ISIZE must equal the unpacked size mod 2³².
- **Thumbnails** start `FF D8 FF`. Frames are `glTF` v2, raw or gzipped.
- **Anything else** is 415 `bad_type`.

**Serving.** Every route sends:

- a type from a fixed per-file map;
- `nosniff`;
- `Content-Security-Policy: default-src 'none'; sandbox`;
- `Content-Disposition: attachment; filename="<title>.bozz"` (`inline` for thumbnails);
- a 404 for anything missing, private or not yours.

| Route | Who | Caching, cross-origin |
|---|---|---|
| app `/api/me/media/:id/<file>` | the row's owner (`WHERE id = ? AND owner_id = ?`) | `private, no-store`; CORP `same-origin` |
| app `/admin/api/media/*` | owner tools | as today |
| `files.vidarrapp.se/m/:id/<file>` | anyone; public templates (phase 3: approved work) | `public, max-age=31536000, immutable` with the current `?v=` (scenes, and any other `?v=`, `public, no-cache`); ACAO `APP_ORIGIN`; CORP `same-site`; HSTS; Cache API after the row check |
| app `/m/*`, `/media/*` | public templates only | as above; `/media/*` serves 0.5 apps until 0.7 |

- **No `MEDIA_ORIGIN`** (local, tests, previews), or no `APP_ORIGIN` for the files host to answer: manifests use same-origin `/media/`, which installed 0.5 desktop apps can reach until desktop 0.6 ships; `/m/` answers there too.
- **Owner routes.** `/admin/api/projects*` and `/admin/api/media/*` stay for owner tools: templates and the owner's own projects, behind both locks.
- **The owner's Sculpt saves** go to `/api/me/*`, like everyone's.

## 5. Templates and galleries

- **Public API.** `GET /api/projects[/:id]` keeps its URLs and shapes, now meaning public templates, and adds `template: true` and `media` (a base URL).
  - It stays unversioned, so installed apps' worker rule (`/\/api\/projects/`) and their caches keep working.
  - Old clients' `mediaPath()` lands on `/media/*`.
- **Landing.** The Create tile and the device's cards, then public templates for everyone.
  - Scene templates open as copies (`/?sculpt=1&template=<id>`, no project link), so Save to library makes the user's own project, or a download for guests.
  - Model and timelapse templates play in the viewer.
  - Armature templates need a server format, so they wait for phase 2.
- **Projects page.** It lists templates and the owner's own projects. A **Template** switch sits beside Public/Private (`POST /admin/api/projects/:id/template {template}`).
  - On: `owner_id = NULL` and `template = 1`; the bytes leave the owner's usage.
  - Off: the project returns to the owner, private.
  - On a template, Public/Private means listed or privatised.
- **Edit in Sculpt** (owner only, from Projects): `/?sculpt=1&project=<id>&scope=admin` loads and saves through `/admin/api`. Saves bump `updated_at`, so every `?v=` changes. From the gallery, the owner gets a copy like anyone else.

## 6. Email and Turnstile

**Resend.**

- **Request.** `POST https://api.resend.com/emails` with `Authorization: Bearer RESEND_API_KEY`, `{from, to, subject, text, html}`, and `Idempotency-Key: <flow id>:<send n>` (kept 24 hours).
- **Sender.** `Bozzetto <login@vidarrapp.se>` (`MAIL_FROM`). Tracking is off; it would route sign-in links through Resend.
- **Mails sent:** codes; already registered; passkey added or removed; email changed (to the old address); suspended; deleted.

```
Subject: 123456 is your Bozzetto code
Your code is 123 456. Type it where Bozzetto asked. It works once, for 10 minutes.
[desktop browsers: or open https://bozzetto.vidarrapp.se/?link=… in the same browser]
Did not ask? Ignore this mail: the code is useless without the device that asked.
```

The code field is `autocomplete="one-time-code" inputmode="numeric"`.

**DNS.** Values come from Resend → Domains → `vidarrapp.se`.

| Type | Name | Value |
|---|---|---|
| MX | `send` | `feedback-smtp.<region>.amazonses.com`, priority 10 |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | DKIM key, DNS only |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<owner>` |

- **SPF.** The `send` records are the return path, so the root SPF is untouched.
- **DMARC.** Only if none exists; move to `p=quarantine` after two clean weeks.
- **Subdomain.** Resend recommends a sending subdomain such as `mail.vidarrapp.se`: the same records one level down.
- **Free tier.** 3,000 a month, 100 a day.

**Stub.** Without `RESEND_API_KEY`:

- loopback writes `dev_outbox` (read via `GET /api/dev/outbox?to=` with `DEV_TEST_HOOKS=true`) and logs;
- other hosts answer 503 `not_configured`.

**Turnstile.**

- **Widget.** Rendered explicitly (`api.js?render=explicit`, `appearance: 'interaction-only'`) in Join, and wherever a code is requested or resent. Each submit uses a fresh token: tokens last 300 s and validate once.
- **Server.** It posts `secret`, `response`, `remoteip` (not stored) and `idempotency_key` to `https://challenges.cloudflare.com/turnstile/v0/siteverify`. It requires `success`, `hostname` equal to APP_ORIGIN's host, and the expected `action`. If siteverify is unreachable, it answers 503.
- **No `TURNSTILE_SECRET`.** Loopback passes and `/api/config` sends `turnstileSiteKey: null`; other hosts answer 503.
- **Testing.** Tests point `TURNSTILE_VERIFY_URL` (loopback only) at a fake. Staging can use Cloudflare's test keys: `1x00000000000000000000AA` with `1x0000000000000000000000000000000AA` pass, and the `2x…` keys fail.
- **CSP.** `script-src` and `frame-src` add `https://challenges.cloudflare.com`; `connect-src` and `img-src` add the files host.

## 7. Client UI

**The sign-in dialog.** Sign-in is a dialog, so the page and its work stay put, with no Access round trip.

- It opens from the gallery chip, from Sculpt's notices (a failed save retries afterwards), and from `/?signin`, `/?invite=` and `/?link=`.
- **Sign in:** a passkey button, autofill on the email field, and "Email me a code".
- **Join with an invite:**
  1. invite, live-checked handle, email, the 13+ and terms box, and Turnstile;
  2. then the code;
  3. then a passkey offer.

**Where passkeys work.**

- Passkeys are bound to `rpId`, and `*.pages.dev` hosts never match it.
- The client compares `rpId` from `/api/config` with `location.hostname`, and shows only email codes where they differ.
- `/?me`, `/?account` and the sign-in links are queries on `/`, which the worker's `navigateFallbackAllowlist` already serves offline.

**Top row.** A guest sees Sign in and Install. Signed in, it shows My projects and an `@handle` menu (Account, Sign out). The owner also gets Owner tools.

**My projects (`/?me`).**

- A storage meter: used, reserved while uploading, quota.
- Cards with thumbnail, renamable title, mode, size and date.
- Actions: **Open** (Sculpt for scenes, else the viewer), **Download** (`.bozz` or a frames zip), **Delete**.
- Read-only offline.

**Account (`/?account`).**

- Handle, and email changed by code.
- Passkeys, and sessions (revoke one or all).
- Download my data, and Delete account.
- The legal pages.

**Save to library.**

- **Guest:** downloads a `.bozz`, as today.
- **Signed in:** saves to My projects. This is today's owner flow on `/api/me`.
- **Expired sign-in:** the scene stays on the device as Not uploaded, and **Sign in** opens the dialog in place.
- **Full quota:** the scene also stays: "Your storage is full (248 of 250 MB)".
- **Capture** publishes to My projects, with no id and no visibility choice. Recording follows "signed in", not "owner".

**Roles.**

- `checkSignIn()` reads `/api/config`, then `GET /api/me`. A 401 means signed out, or expired where the device remembers a sign-in.
- `Role` becomes `'owner'|'moderator'|'member'|'expired'|'guest'`.
- With accounts off, the whoami probe stays.

**Service worker.**

- `/api/me` (no email in it) and `/api/me/projects` are NetworkFirst, and dropped on sign-out or 401.
- `/api/me/account`, `/api/auth/*` and `/api/me/media/*` are never cached.
- The thumbnail rule also takes `<VITE_MEDIA_ORIGIN>/m/<id>/thumb.jpg`, with `crossorigin="anonymous"` images.

**iPad PWA.** It has its own cookie jar, and mail links open Safari. So codes are typed, and after an invite is redeemed in Safari the user signs in again in the app; the passkey is in iCloud Keychain.

- Passkeys need iPadOS 16+.
- 17.4 replaced WebAuthn's user-gesture rule with rate limiting.
- Safari's conditional UI regressed until 26.3.
- Apple's forums report passkey prompts misbehaving more on pages opened from Home Screen shortcuts (iOS 18.6.2, unresolved).

Hence Batch 0: test on the real iPad first.

## 8. Owner tools (phase 1)

These are tabs beside Projects on `/admin/`, behind Access and the owner session.

- **Invites.**
  - Create with `{label, maxUses 1–500 (default 1), expiresInDays 1–90 (default 14)}`. The link is shown once.
  - The list shows uses, expiry and state; each invite can be revoked.
  - Routes: `GET|POST /admin/api/invites`, `POST /admin/api/invites/:id/revoke`.
- **Users.**
  - The list shows handle, email, role, status, dates, and used versus quota.
  - Actions:
    - Suspend `{reason}`, which revokes sessions and mails the user, and Unsuspend;
    - Revoke sessions, Quota override (MiB), Recount;
    - Finish deletion. Deletions pending over 24 hours are flagged.
  - Routes: `GET /admin/api/users?cursor=`, `POST /admin/api/users/:id/{suspend,unsuspend,revoke-sessions,recount,finish-deletion}`, `PUT /admin/api/users/:id/quota`.
- **Audit.**
  - Newest first, 50 a page, filtered by action or subject (`GET /admin/api/audit?before=&action=&subject=`).
  - Each load deletes up to 500 rows past 12 months.
- **Bootstrap.**
  - With accounts on and no owner, "Create your account" calls `POST /admin/api/owner/bootstrap {handle, acceptTerms, ageConfirmed}`. It needs Access alone, and is refused once an owner exists.
  - It creates the `role = 'owner'` user with the Access email and a 10 GiB quota, and claims the rows with `owner_id IS NULL AND template = 0`.
  - It then signs the owner in (method `bootstrap`) and offers a passkey.

## 9. Legal pages (outlines, not legal advice)

`public/legal/privacy.html` and `public/legal/terms.html` (with sections `#content` and `#takedown`) are static and precached. They are linked from Join, Account and the gallery's foot. Join records `TERMS_VERSION` (`2026-10`); asking again after a change comes in phase 2.

**Privacy notice.**

- **Controller and contact:** the owner.
- **Contract (Art. 6(1)(b)):** the account and its work.
- **Legitimate interest in security (6(1)(f)):** passkey keys, sessions with user agent, the audit log, keyed IP hashes kept up to 48 h, and Turnstile.
- **Processors:** Cloudflare (hosting, D1, R2, Turnstile, Access) and Resend, which keeps logs 30 days. The Install card also calls api.github.com.
- **Retention:**
  - account data until deletion;
  - D1 point-in-time history for 7 days (Free) or 30 days (Paid);
  - the audit log for 12 months;
  - retired handles for 90 days.
- **No consent banner:** there are no analytics or ads, only necessary cookies and storage.
- **Rights:** export and erasure in the app; rectification, restriction, objection and portability on request; complaints to IMY.
- **Age:** 13 and over.

**Terms.**

- Free, invite-only, as is; it may change or end with notice and time to export.
- One person per account.
- You keep your work, licensing only its storage and display back to you. Public sharing is opt-in (phase 3).
- Templates may be used as starting points (owner to confirm).
- 250 MB and file checks.
- Suspension or removal comes with reasons and a way to object.
- Swedish law; consumer rights intact.

**Content policy.**

- Nothing illegal.
- Zero tolerance for sexual content involving minors; it is reported.
- No non-consensual intimate imagery, harassment, threats or hate.
- No infringement of others' work or likeness.
- No malware or crafted files, no spam, no impersonation.
- Artistic nudity in figure work is the owner's call.

**Takedown.**

- **Address:** for example `abuse@vidarrapp.se`.
- **A notice names** the project, why it is unlawful, a contact, and a good-faith statement.
- **Response:** acknowledged within 7 days, faster for child safety and threats. This is the DSA's notice and action for hosts.

**Consent and age.** Join has a required, unticked box: "I am 13 or older and accept the Terms, including the content policy". No birth date is asked or kept. 13 is Sweden's age of digital consent.

## 10. Testing

`tests/functions/check.mjs` becomes a runner over `tests/functions/suites/*.mjs` (Batch 1).

**Harness.**

- It symlinks `node_modules` into its temp project, so wrangler resolves simplewebauthn.
- It sets `APP_ORIGIN`, `RP_ID=localhost`, `ACCOUNTS_ENABLED=true`, `AUTH_SECRET`, `DEV_TEST_HOOKS=true` and `TURNSTILE_SECRET=test`.
- It points `TURNSTILE_VERIFY_URL` at a node:http fake:
  - `pass` passes;
  - `pass-other-action` returns a different action;
  - `down` returns 500;
  - anything else fails.
- It honours an `X-Test-Now` clock on loopback with hooks on.
- It adds `tests/functions/authenticator.mjs`, the software ES256 authenticator used for the check above.

**Suites.**

- **migration:** 0001+0002 fixtures through 0003.
- **two locks:**
  - Access alone is refused once an owner exists;
  - a member session is refused on `/admin`;
  - Access headers are ignored on `/api`.
- **cookies:** attributes, hashing, idle and absolute expiry, revocation.
- **CSRF:** every write.
- **registration:**
  - an invite that is used up, revoked or expired;
  - a raced last use;
  - handle rules;
  - Turnstile failures and outage;
  - no code for a registered address.
- **passkeys:**
  - no UV;
  - wrong origin or RP ID;
  - `crossOrigin`;
  - a replayed or expired challenge, or another browser's ceremony cookie;
  - counter regression accepted with a warning;
  - reauthentication;
  - the limit of 10.
- **codes:**
  - 5 attempts, expiry and single use;
  - a wrong flow cookie, and the link without it;
  - resends;
  - every limit, with Retry-After.
- **isolation:** another member's id is 404 everywhere.
- **quota:** concurrent parts where only some fit, retries, declared size, caps, abort.
- **content:** non-gzip scene, bad header, ISIZE mismatch, polyglot thumbnail, bad GLB.
- **templates:** switch, privatise, public list, headers, host split, `/media/*`.
- **deletion cascade:** rows, R2 keys (via `GET /api/dev/r2?prefix=`), sessions, invites, resumed steps.
- **owner tools:** suspend, quota, audit rows without personal data.
- **accounts off.**

**E2E.** `tests/e2e/accounts.mjs` runs on `wrangler pages dev dist` at `http://localhost:<port>`, because WebAuthn takes `localhost` as an RP ID but not an IP. Codes come from the outbox, and Turnstile is bypassed.

- **Authenticator.** CDP `WebAuthn.enable`, then `WebAuthn.addVirtualAuthenticator` with `{options: {protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, defaultBackupEligibility: true, defaultBackupState: true}}`. `WebAuthn.setUserVerified` covers the UV failure.
- **Path:**
  1. Invite, join, passkey, sign out.
  2. Modal passkey sign-in. Conditional UI is only asserted as requested, since its picker can't be driven.
  3. A second passkey with reauthentication, then remove it.
  4. Revoke sessions.
  5. Save to library, then My projects: size, open, download, delete.
  6. Copy a template.
  7. Export the zip.
  8. Delete the account.
- **Desktop.** `desktop.mjs` adds sign-in and sign-out against a local server.
- **CI.** The accounts suite joins `e2e-smoke`.

## 11. Rollout

1. Apply 0003 in the console and record it; deploy Batches 1–2. The gallery shows the same set as before, now as templates.
2. Bring `files.vidarrapp.se` live, then set `MEDIA_ORIGIN`.
3. Deploy Batches 3–9 with `ACCOUNTS_ENABLED` unset in production and `true` on staging. Test there, the real iPad included.
4. Set the production secrets and `ACCOUNTS_ENABLED=true`. The owner bootstraps, then sends the first invites. Desktop 0.6.0 follows.

**Staging** is a second Pages project, `bozzetto-staging`, on the same repository with production branch `staging`.

- Its own D1 and R2, both named `bozzetto-staging`.
- Hosts `bozzetto-staging.vidarrapp.se` and `files-staging.vidarrapp.se`.
- Its own Access app, and `RP_ID=bozzetto-staging.vidarrapp.se`.

Why not the Preview environment: its bindings and secrets would reach every branch preview, and the checklist keeps Preview unbound.

**Owner's checklist:**

- [ ] **Resend.** Account, domain, the records in §6, tracking off. Store `RESEND_API_KEY` as a secret in both projects.
- [ ] **Turnstile.** One Managed widget for both app hosts. Set `TURNSTILE_SITE_KEY` as a variable and `TURNSTILE_SECRET` as a secret.
- [ ] **`AUTH_SECRET`.** Generate it with `openssl rand -base64 32`; store it as a secret in each project.
- [ ] **Variables.** `APP_ORIGIN=https://bozzetto.vidarrapp.se`, `RP_ID=bozzetto.vidarrapp.se`, `MEDIA_ORIGIN=https://files.vidarrapp.se`, `MAIL_FROM`, `ACCOUNTS_ENABLED`. Build variables: `VITE_MEDIA_ORIGIN`, and `NODE_VERSION=22` (simplewebauthn 14 targets Node 22).
- [ ] **Files domain.** `files.vidarrapp.se` as a custom domain on the Pages project; the dashboard makes the proxied CNAME.
- [ ] **WAF custom rules** (Free allows 5):
  - Block `http.host eq "files.vidarrapp.se" and not starts_with(http.request.uri.path, "/m/")`.
  - Block `starts_with(http.request.uri.path, "/api/dev/")`.
- [ ] **WAF rate limiting.** Free allows one rule (10 s window, per IP, path only).
  - Free: `starts_with(http.request.uri.path, "/api/auth/")` over 20 in 10 s → block 10 s.
  - Pro adds a second: `starts_with(http.request.uri.path, "/m/") or starts_with(http.request.uri.path, "/media/")` over 600 a minute → block a minute. Keep it generous, because timelapses prefetch hundreds of frames.
- [ ] **Addresses.** The privacy and takedown addresses exist, and the README checklist gains these items.

**What ships when:**

- **0.6.0:** all of the above.
- **0.6.x:** staging fixes.
- **Phase 2:** Google sign-in; desktop sign-in through the browser (device link); the moderator UI; re-consent after a terms change; armature templates.
- **Phase 3:** public member work and approvals, `/u/<handle>`, reports.

## 12. Implementation plan

Every batch leaves main deployable with accounts off. It passes `typecheck`, `typecheck:functions`, `check:functions` and the smoke suites. Batches that touch `src/` start after the current UI-tweaks work merges.

| # | Batch | Scope | Main files | Tests |
|---|---|---|---|---|
| 0 | iPad spike | Diagnostics → Passkey check: `create()`, modal `get()`, conditional availability, Turnstile test widget, in Safari and the installed app; no server | `src/ui/passkeyCheck.ts`, `src/ui/Preferences.ts` | e2e, virtual authenticator |
| 1 | Schema, middleware | 0003; root middleware (host split, CSRF everywhere, principal with accounts off); `/api/config`; `_routes.json`; keys from rows; public list as templates; suites split | `migrations/0003_accounts.sql`, `functions/_middleware.ts`, `functions/_shared/{principal,env,crypto,projects}.ts`, `functions/api/config.ts`, `public/_routes.json` | migration, principal, CSRF |
| 2a | Templates, server | `/m/*`, `/media/*`, switch, manifests on `MEDIA_ORIGIN` | `functions/{m,media}/[[path]].ts`, `functions/_shared/media.ts`, `functions/admin/api/projects/[id]/template.ts` | templates |
| 2b | Templates, client | gallery copies, switch, SW and CSP, desktop `m` | `src/ui/Landing.ts`, `src/admin/{main,api}.ts`, `src/sculpt/mode.ts`, `vite.config.ts`, `public/_headers`, `electron/server.cjs` | smoke mocks |
| 3 | Sessions, passkeys | sessions, cookies, WebAuthn, reauth, passkey and session management, two locks, bootstrap, audit | `functions/_shared/auth/{session,webauthn,audit,handles}.ts`, `functions/api/auth/{passkey/*,signout.ts}`, `functions/api/me/{index,account,passkeys,sessions}*`, `functions/admin/api/owner/bootstrap.ts` | passkeys, sessions, locks |
| 4 | Email, invites, Turnstile | codes and links, Resend and stub, Turnstile and fake, rate limits, registration, email change, dev hooks | `functions/_shared/auth/{codes,mail,turnstile,ratelimit}.ts`, `functions/api/auth/{email,register,invite,handle}*`, `functions/api/me/email/*`, `functions/api/dev/*` | registration, codes, limits |
| 5 | Member storage | `/api/me/projects`, quota uploads, caps, content checks, private media, export, deletion | `functions/api/me/{projects,media,export,delete}/**`, `functions/_shared/{quota,uploads}.ts`, `shared/bozz.ts` | quota, content, isolation, cascade |
| 6 | Owner tools API | invites, users, audit | `functions/admin/api/{invites,users,audit}/**` | owner tools |
| 7 | Client: sign-in, account | dialog, Turnstile loader, roles, chips, Account, legal pages | `src/net/account.ts`, `src/ui/account/*`, `src/admin/api.ts`, `src/ui/Landing.ts`, `src/main.ts`, `public/legal/*` | e2e accounts |
| 8 | Client: My projects, Sculpt | `/?me`, Save to library and Capture for members, export zip, SW rules | `src/ui/account/myProjects.ts`, `src/sculpt/bridge/{FileActions,SceneProjects,GallerySave}.ts`, `src/sculpt/ui/*`, `vite.config.ts` | e2e accounts |
| 9 | Desktop, owner UI | sign-in window, Server settings; admin tabs | `electron/server.cjs`, `src/desktop/ServerSettings.ts`, `src/admin/{invites,users,audit}.ts` | `desktop.mjs`, e2e |
| 10 | Docs, release | README (Deployment, checklist, Changelog), `docs/accounts.md`, `SECURITY.md`, 0.6.0 | | |

**Order:**

1. Batches 0 and 1.
2. 2a, 2b and 3 together.
3. 4, 5 and 6 together.
4. 7.
5. 8 and 9 together.
6. 10.

**Shared files:**

- `Landing.ts`, `src/admin/api.ts` and `vite.config.ts` change in 2b, before 7 and 8.
- `package.json` takes one dependency line per batch, and the later batch rebases:
  - batch 3: server 14.0.3;
  - batch 7: browser 14.0.0;
  - batch 8: client-zip 2.5.1.
- Batch 7 can start against mocks of 3 and 4.

## Open questions for the owner

1. **Workers Paid?** It lifts the 10 ms CPU and 50-subrequest limits behind export, deletion and uploads.
2. **Zone plan?** Free allows one rate-limiting rule.
3. **Mail domain:** `vidarrapp.se` itself, or a subdomain as Resend recommends?
4. **Addresses:** what are the contact and takedown addresses?
5. **Templates:** what licence covers copies made from them?
6. **Nudity:** is artistic nudity in figure work allowed?

## Sources

- **simplewebauthn:** [changelog](https://github.com/MasterKale/SimpleWebAuthn/blob/master/CHANGELOG.md), [JSR](https://jsr.io/@simplewebauthn/server), [docs](https://simplewebauthn.dev/docs/packages/server), npm metadata, and the scratch test above.
- **Cloudflare Workers:** [limits](https://developers.cloudflare.com/workers/platform/limits/), [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), [Cache](https://developers.cloudflare.com/workers/runtime-apis/cache/).
- **Cloudflare Pages:** [pricing](https://developers.cloudflare.com/pages/functions/pricing/), [routing](https://developers.cloudflare.com/pages/functions/routing/), [limits](https://developers.cloudflare.com/pages/platform/limits/), [branch domains](https://developers.cloudflare.com/pages/how-to/custom-branch-aliases/), and the wrangler 3.114 source.
- **D1:** [foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/), [batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
- **R2:** [API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
- **Turnstile:** [validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/), [CSP](https://developers.cloudflare.com/turnstile/reference/content-security-policy/), [rendering](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/).
- **WAF:** [rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/), [custom rules](https://developers.cloudflare.com/waf/custom-rules/).
- **Resend:** [API](https://resend.com/docs/api-reference/emails/send-email), [DNS on Cloudflare](https://resend.com/docs/knowledge-base/cloudflare), [domains](https://resend.com/docs/dashboard/domains/introduction), [pricing](https://resend.com/pricing).
- **Sweden, age 13:** [DLA Piper, Sweden](https://www.dlapiperdataprotection.com/index.html?t=law&c=SE) (Dataskyddslagen 2:4).
- **Apple platforms:** [Corbado on gestures](https://www.corbado.com/blog/safari-webauthn-user-activated-events), forum threads [814044](https://developer.apple.com/forums/thread/814044) and [815784](https://developer.apple.com/forums/thread/815784), [passkeys.dev](https://passkeys.dev/docs/reference/ios/).
- **Testing and desktop:** [CDP WebAuthn](https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/), [Electron #51411](https://github.com/electron/electron/pull/51411).
