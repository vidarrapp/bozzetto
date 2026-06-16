import type { Env } from '../../../_shared/types';
import { handle, json, requireAdmin } from '../../../_shared/http';
import { createProject } from '../../../_shared/projects';

// POST /admin/api/projects — create a project (Access-gated).
export const onRequestPost: PagesFunction<Env> = ({ env, request }) =>
  handle(async () => {
    const denied = requireAdmin(request, env);
    if (denied) return denied;
    const body = (await request.json()) as Record<string, unknown>;
    return json(await createProject(env, body), 201);
  });
