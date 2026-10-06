import type { Env } from '../../_shared/types';
import { error, handle, json } from '../../_shared/http';
import { getPublicProjectRow, toManifest } from '../../_shared/projects';

// GET /api/projects/:id — public manifest for the viewer. A private project
// is not found here, exactly as a missing one is; its owner reads it
// through GET /admin/api/projects/:id.
export const onRequestGet: PagesFunction<Env> = ({ env, params }) =>
  handle(async () => {
    const row = await getPublicProjectRow(env, String(params.id));
    return row ? json(toManifest(row)) : error('Not found', 404);
  });
