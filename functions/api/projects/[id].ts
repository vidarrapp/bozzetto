import type { Env } from '../../_shared/env';
import { error, handle, json } from '../../_shared/http';
import { getProjectRow, toManifest } from '../../_shared/projects';

// GET /api/projects/:id — public manifest for the viewer, of a template
// the gallery lists. Anything else is not found here, exactly as a missing
// project is; its owner reads it through GET /admin/api/projects/:id.
export const onRequestGet: PagesFunction<Env> = ({ env, params }) =>
  handle(async () => {
    const row = await getProjectRow(env, String(params.id), 'public');
    return row ? json(toManifest(row)) : error('Not found', 404);
  });
