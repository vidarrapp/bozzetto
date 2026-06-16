import type { Env } from '../../_shared/types';
import { error, handle, json } from '../../_shared/http';
import { getProjectRow, toManifest } from '../../_shared/projects';

// GET /api/projects/:id — public manifest for the viewer.
export const onRequestGet: PagesFunction<Env> = ({ env, params }) =>
  handle(async () => {
    const row = await getProjectRow(env, String(params.id));
    return row ? json(toManifest(row)) : error('Not found', 404);
  });
