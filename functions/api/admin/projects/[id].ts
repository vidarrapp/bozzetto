import type { Env } from '../../../_shared/types';
import { handle, json, requireAdmin } from '../../../_shared/http';
import { deleteProject, updateProject } from '../../../_shared/projects';

// PUT /api/admin/projects/:id — update metadata, lighting, stages, frames.
export const onRequestPut: PagesFunction<Env> = ({ env, request, params }) =>
  handle(async () => {
    const denied = requireAdmin(request, env);
    if (denied) return denied;
    const patch = (await request.json()) as Record<string, unknown>;
    return json(await updateProject(env, String(params.id), patch));
  });

// DELETE /api/admin/projects/:id — remove the project and its R2 objects.
export const onRequestDelete: PagesFunction<Env> = ({ env, request, params }) =>
  handle(async () => {
    const denied = requireAdmin(request, env);
    if (denied) return denied;
    await deleteProject(env, String(params.id));
    return json({ deleted: true });
  });
