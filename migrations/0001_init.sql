-- Project registry. Binary frame meshes live in R2 under projects/<id>/...;
-- this table holds the metadata (title, mode, fps) and a JSON `data` blob with
-- defaults, camera, lighting, stages/comments, and the frame list.
CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  title      TEXT    NOT NULL,
  mode       TEXT    NOT NULL DEFAULT 'timelapse',  -- 'timelapse' | 'model'
  fps        REAL    NOT NULL DEFAULT 4,
  data       TEXT    NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects (updated_at DESC);
