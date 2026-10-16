-- Accounts, phase 3 (docs/accounts.md §13): views and stars in the
-- community gallery. Two counters on projects - how many visitors opened a
-- public work (one a visitor a day), and how many members starred it - the
-- stars themselves, and the day's marks that keep a view from counting twice.
--
-- It only adds, and the code before it runs on it, so it is applied before
-- the code that uses it, as 0003 and 0004 were. Every statement stands
-- alone and none is a trigger. No statement line carries a comment: the D1
-- console stopped mid-file when they did (0004, 2026-10-15), so after a
-- console run check that projects has `views` and `stars`, that the
-- `stars` and `view_marks` tables are there, and the five indexes. Then
-- record it as `wrangler d1 migrations apply` would have:
--
--   INSERT INTO d1_migrations (name) VALUES ('0005_community_stats.sql')
--
-- Every row starts at no views and no stars. `stars` on projects is kept in
-- step with the stars table by the statements that star and unstar, and by
-- an account's deletion. A view mark's key is an HMAC under AUTH_SECRET of
-- the day, the project and the visitor (an account id, or an address and
-- browser): no address or identity is stored, and the marks go after two days.
ALTER TABLE projects ADD COLUMN views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN stars INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_projects_shared_views ON projects (shared, views DESC, shared_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_shared_stars ON projects (shared, stars DESC, shared_at DESC);

CREATE TABLE IF NOT EXISTS stars (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, project_id));
CREATE INDEX IF NOT EXISTS idx_stars_project ON stars (project_id);
CREATE INDEX IF NOT EXISTS idx_stars_user ON stars (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS view_marks (key TEXT PRIMARY KEY, day INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_view_marks_day ON view_marks (day);
