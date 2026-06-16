import type { Env } from '../../../../_shared/types';
import { error, handle, json, requireAdmin } from '../../../../_shared/http';
import { putThumb } from '../../../../_shared/projects';

// POST /admin/api/projects/:id/thumb — store the project's gallery thumbnail.
export const onRequestPost: PagesFunction<Env> = ({ env, request, params }) =>
  handle(async () => {
    const denied = requireAdmin(request, env);
    if (denied) return denied;

    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return error('empty body', 400);

    await putThumb(env, String(params.id), body);
    return json({ ok: true }, 201);
  });
