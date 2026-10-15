import type { Env } from '../../_shared/env';
import { error, handle, json } from '../../_shared/http';
import { authorOf } from '../../_shared/community';
import { publicFiles } from '../../_shared/media';
import { getProjectRow, toManifest } from '../../_shared/projects';

// GET /api/projects/:id — public manifest for the viewer, of a template
// the gallery lists, or (accounts on) a member's project approved for the
// community gallery while its author's account is active, which adds
// `community: true` and `author: {handle}` (docs/accounts.md §13).
// Anything else is not found here, exactly as a missing project is; its
// owner reads it through GET /admin/api/projects/:id or /api/me.
export const onRequestGet: PagesFunction<Env> = ({ env, params }) =>
  handle(async () => {
    const row = await getProjectRow(env, String(params.id), publicFiles(env));
    if (!row) return error('Not found', 404);
    const manifest = toManifest(row, env);
    if (row.template === 1) return json(manifest);
    return json({ ...(manifest as object), community: true, author: await authorOf(env, row) });
  });
