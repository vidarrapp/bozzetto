import type { Env } from '../../../_shared/types';
import { bodyLimit, handle, json, requireAdmin } from '../../../_shared/http';
import { createProject } from '../../../_shared/projects';

// POST /admin/api/projects — create a project (Access-gated).
export const onRequestPost: PagesFunction<Env> = ({ env, request }) =>
  handle(async () => {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
    const tooBig = bodyLimit(request, 64 * 1024); // id, title, mode, fps
    if (tooBig) return tooBig;
    const body = (await request.json()) as Record<string, unknown>;
    return json(await createProject(env, body), 201);
  });
