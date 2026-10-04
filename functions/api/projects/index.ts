import type { Env } from '../../_shared/types';
import { handle, json } from '../../_shared/http';
import { listProjects } from '../../_shared/projects';

// GET /api/projects — public list of projects for the landing page. Public
// projects only; the owner's full list is GET /admin/api/projects.
export const onRequestGet: PagesFunction<Env> = ({ env }) =>
  handle(async () => json(await listProjects(env)));
