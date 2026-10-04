-- Who may see a project. 'public' is what every project was before this
-- (the gallery, the public API and /media serve it to anyone); 'private' is
-- the owner's alone, served only through the Access-gated /admin/api routes.
-- Existing rows keep today's behaviour through the default. Scenes saved
-- from sculpt mode are created private by the API rather than by this
-- default, so a published timelapse and a saved sculpt start out where each
-- belongs.
--
-- The same change brings a third `mode`, 'scene': a sculpt saved to the
-- library, whose .bozz file and thumbnail live in R2 beside the frames a
-- timelapse would have (projects/<id>/scene.bozz, projects/<id>/thumb.jpg).
-- mode has no CHECK to widen; the API decides which values it accepts.
ALTER TABLE projects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'private'));

-- The public list asks for exactly this: public projects, newest first.
CREATE INDEX IF NOT EXISTS idx_projects_visibility_created
  ON projects (visibility, created_at DESC);
