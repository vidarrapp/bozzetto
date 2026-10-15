-- Accounts, phase 3 (docs/accounts.md §13): the community gallery. Five
-- columns on projects - whether a member's project is shared and where
-- its review stands, when it was submitted or approved, and who last
-- reviewed it, when and why - and the reports members make of shared work.
--
-- It only adds, and the code before it runs on it, so it is applied before
-- the code that uses it, as 0003 was. Every statement stands alone and none
-- is a trigger. No statement carries a comment on its own line: the D1
-- console stopped after the second ALTER when they did (2026-10-15), so
-- check every column and the reports table after a console run. Then
-- record it as `wrangler d1 migrations apply` would have:
--
--   INSERT INTO d1_migrations (name) VALUES ('0004_community.sql')
--
-- Every row starts unshared ('none'): nothing becomes public by this file.
-- Templates are never shared (template = 1 means shared = 'none'), and a
-- member's project stays visibility = 'private' - `shared` is what makes it
-- public, once a reviewer approves it.
ALTER TABLE projects ADD COLUMN shared TEXT NOT NULL DEFAULT 'none'
  CHECK (shared IN ('none','pending','public','rejected','hidden'));
ALTER TABLE projects ADD COLUMN shared_at INTEGER;
ALTER TABLE projects ADD COLUMN reviewed_at INTEGER;
ALTER TABLE projects ADD COLUMN reviewed_by TEXT;
ALTER TABLE projects ADD COLUMN review_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_shared ON projects (shared, shared_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('nudity','minors','stolen','spam','other')),
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT,
  outcome TEXT CHECK (outcome IN ('dismissed','hidden','removed')),
  UNIQUE (project_id, reporter_id));
CREATE INDEX IF NOT EXISTS idx_reports_open ON reports (resolved_at, created_at);
