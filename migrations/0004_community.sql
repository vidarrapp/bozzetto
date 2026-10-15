-- Accounts, phase 3 (docs/accounts.md §13): the community gallery. Five
-- columns on projects - whether a member's project is shared and where
-- its review stands, when it was submitted or approved, and who last
-- reviewed it, when and why - and the reports members make of shared work.
--
-- It only adds, and the code before it runs on it, so it is applied before
-- the code that uses it, as 0003 was. Every statement stands alone and none
-- is a trigger, so the D1 console can run them one at a time. No comment
-- holds a semicolon, so splitting the file at each one splits it where
-- SQLite does. After a console run, record it as `wrangler d1 migrations
-- apply` would have:
--
--   INSERT INTO d1_migrations (name) VALUES ('0004_community.sql')
--
-- Every row starts unshared ('none'): nothing becomes public by this file.
-- Templates are never shared (template = 1 means shared = 'none'), and a
-- member's project stays visibility = 'private' - `shared` is what makes it
-- public, once a reviewer approves it.
ALTER TABLE projects ADD COLUMN shared TEXT NOT NULL DEFAULT 'none'
  CHECK (shared IN ('none','pending','public','rejected','hidden'));
ALTER TABLE projects ADD COLUMN shared_at INTEGER;       -- when it was submitted / approved (ordering)
ALTER TABLE projects ADD COLUMN reviewed_at INTEGER;     -- last review action
ALTER TABLE projects ADD COLUMN reviewed_by TEXT;        -- users.id of the reviewer
ALTER TABLE projects ADD COLUMN review_reason TEXT;      -- rejection / hide reason shown to the author (<= 500)
CREATE INDEX IF NOT EXISTS idx_projects_shared ON projects (shared, shared_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('nudity','minors','stolen','spam','other')),
  note TEXT NOT NULL DEFAULT '',                           -- <= 500 chars
  created_at INTEGER NOT NULL, resolved_at INTEGER, resolved_by TEXT,
  outcome TEXT CHECK (outcome IN ('dismissed','hidden','removed')),
  UNIQUE (project_id, reporter_id));
CREATE INDEX IF NOT EXISTS idx_reports_open ON reports (resolved_at, created_at);
