-- Accounts, phase 1 (docs/accounts.md §1): users and their passkeys,
-- sessions, sign-ins in progress, invites, uploads in progress, the audit
-- log and rate limits, and four columns on projects - who owns it, whether
-- it is a template, where in R2 its files are, and what they weigh.
--
-- It only adds, and 0.5.5 runs on it, so it is applied before the code
-- that uses it. Every statement stands alone and none is a trigger, so the
-- D1 console can run them; no comment holds a semicolon, so splitting the
-- file at each one splits it where SQLite does. After a console run,
-- record it as `wrangler d1 migrations apply` would have:
--
--   INSERT INTO d1_migrations (name) VALUES ('0003_accounts.sql')
--
-- The UPDATE is the template migration: every project public today becomes
-- a template, so the gallery, which now lists template = 1 AND visibility =
-- 'public', shows exactly the set it showed before. No R2 object moves: a
-- row without a storage_prefix keeps its files under projects/<id>/.
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
