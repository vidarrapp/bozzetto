import type { Env } from '../../../_shared/types';
import { bodyLimit, handle, json, requireAdmin } from '../../../_shared/http';
import { createProject, listProjects } from '../../../_shared/projects';

// GET /admin/api/projects — every project, private ones and scenes
// included, each with its visibility (Access-gated).
export const onRequestGet: PagesFunction<Env> = ({ env, request }) =>
  handle(async () => {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    return json(await listProjects(env, { all: true }));
  });

// POST /admin/api/projects — create a project (Access-gated). A scene
// (mode 'scene') may leave out its id, which the server then picks, and
// starts private; everything else starts public unless asked otherwise.
export const onRequestPost: PagesFunction<Env> = ({ env, request }) =>
  handle(async () => {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    const tooBig = bodyLimit(request, 64 * 1024); // id, title, mode, fps, visibility
    if (tooBig) return tooBig;
    const body = (await request.json()) as Record<string, unknown>;
    return json(await createProject(env, body), 201);
  });
