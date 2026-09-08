import type { Env } from '../../../_shared/types';
import { bodyLimit, handle, json, requireAdmin } from '../../../_shared/http';
import { MAX_DATA_BYTES, deleteProject, updateProject } from '../../../_shared/projects';

// PUT /admin/api/projects/:id — update metadata, lighting, stages, frames.
export const onRequestPut: PagesFunction<Env> = ({ env, request, params }) =>
  handle(async () => {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    // The stored row is capped below MAX_DATA_BYTES, so a patch declared
    // past twice that cannot succeed and need not be parsed.
    const tooBig = bodyLimit(request, MAX_DATA_BYTES * 2);
    if (tooBig) return tooBig;
    const patch = (await request.json()) as Record<string, unknown>;
    return json(await updateProject(env, String(params.id), patch));
  });

// DELETE /admin/api/projects/:id — remove the project and its R2 objects.
export const onRequestDelete: PagesFunction<Env> = ({ env, request, params }) =>
  handle(async () => {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    await deleteProject(env, String(params.id));
    return json({ deleted: true });
  });
