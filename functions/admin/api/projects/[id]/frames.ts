import type { Env } from '../../../../_shared/types';
import { error, handle, json, requireAdmin } from '../../../../_shared/http';
import { putFrame } from '../../../../_shared/projects';

// POST /admin/api/projects/:id/frames?index=N — upload one frame's .glb bytes.
export const onRequestPost: PagesFunction<Env> = ({ env, request, params }) =>
  handle(async () => {
    const denied = requireAdmin(request, env);
    if (denied) return denied;

    const index = Number(new URL(request.url).searchParams.get('index'));
    if (!Number.isInteger(index) || index < 0) return error('?index=<n> required', 400);

    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return error('empty body', 400);

    const key = await putFrame(env, String(params.id), index, body);
    return json({ key, index, size: body.byteLength }, 201);
  });
