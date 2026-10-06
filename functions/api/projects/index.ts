import type { Env } from '../../_shared/env';
import { handle, json } from '../../_shared/http';
import { listProjects } from '../../_shared/projects';

// GET /api/projects — public list for the landing page: the templates
// listed there (template = 1 AND visibility = 'public'), each marked
// `template: true` with the base its files are read from. The URL and the
// shape are 0.5's, so installed apps and their caches keep working; the
// owner's full list is GET /admin/api/projects.
export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  handle(async () => json(await listProjects(env, 'public')));
