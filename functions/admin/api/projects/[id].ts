import type { Env } from '../../../_shared/env';
import { bodyLimit, error, handle, json, readJson } from '../../../_shared/http';
import { ownerActor, ownerScope, requireAdmin, type RequestData } from '../../../_shared/principal';
import {
  MAX_DATA_BYTES,
  deleteProject,
  getProjectRow,
  toManifest,
  toOwnerRow,
  updateProject,
} from '../../../_shared/projects';

// GET /admin/api/projects/:id — the owner's manifest: any template or the
// owner's own project, private included, with frame and scene paths on the
// media route that will serve them to the owner.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  handle(async () => {
    const denied = requireAdmin(data);
    if (denied) return denied;
    const row = await getProjectRow(env, String(params.id), ownerScope(data.principal));
    return row ? json(toManifest(row, env)) : error('Not found', 404);
  });

// PUT /admin/api/projects/:id — update metadata (title, visibility, mode,
// fps), lighting, stages, frames. Fields left out are kept. Made public, a
// project becomes a template, as the Template switch makes one.
export const onRequestPut: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  handle(async () => {
    const denied = requireAdmin(data);
    if (denied) return denied;
    // The stored row is capped below MAX_DATA_BYTES, so a patch declared
    // past twice that cannot succeed and need not be parsed.
    const tooBig = bodyLimit(request, MAX_DATA_BYTES * 2);
    if (tooBig) return tooBig;
    const patch = await readJson(request);
    const row = await updateProject(env, String(params.id), patch, ownerScope(data.principal), ownerActor(data));
    return json(toOwnerRow(row, env));
  });

// DELETE /admin/api/projects/:id — remove the project and its R2 objects.
export const onRequestDelete: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  handle(async () => {
    const denied = requireAdmin(data);
    if (denied) return denied;
    await deleteProject(env, String(params.id), ownerScope(data.principal));
    return json({ deleted: true });
  });
