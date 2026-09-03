import type { Env } from '../../../../_shared/types';
import { error, handle, json, requireAdmin } from '../../../../_shared/http';
import { putThumb } from '../../../../_shared/projects';

// POST /admin/api/projects/:id/thumb — store the project's gallery thumbnail.
const MAX_THUMB_BYTES = 4 * 1024 * 1024;
export const onRequestPost: PagesFunction<Env> = ({ env, request, params }) =>
  handle(async () => {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;

    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_THUMB_BYTES) return error('thumbnail too large', 413);
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return error('empty body', 400);
    if (body.byteLength > MAX_THUMB_BYTES) return error('thumbnail too large', 413);

    await putThumb(env, String(params.id), body);
    return json({ ok: true }, 201);
  });
