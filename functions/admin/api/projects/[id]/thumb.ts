import type { Env } from '../../../../_shared/env';
import { bodyLimit, error, handle, json } from '../../../../_shared/http';
import { ownerScope, requireAdmin, type RequestData } from '../../../../_shared/principal';
import { putThumb } from '../../../../_shared/projects';

// POST /admin/api/projects/:id/thumb — store the project's gallery thumbnail.
const MAX_THUMB_BYTES = 4 * 1024 * 1024;
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  handle(async () => {
    const denied = requireAdmin(data);
    if (denied) return denied;

    const tooBig = bodyLimit(request, MAX_THUMB_BYTES, true);
    if (tooBig) return tooBig;
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return error('empty body', 400);
    if (body.byteLength > MAX_THUMB_BYTES) return error('thumbnail too large', 413);

    await putThumb(env, String(params.id), body, ownerScope(data.principal));
    return json({ ok: true }, 201);
  });
