import type { Env } from '../../../../_shared/types';
import { error, handle, json, requireAdmin } from '../../../../_shared/http';
import { putFrame } from '../../../../_shared/projects';

// POST /admin/api/projects/:id/frames?index=N — upload one frame's .glb bytes.
/** Generous for a single quantized-gzip frame (the 16M-tri ceiling lands well under this). */
const MAX_FRAME_BYTES = 96 * 1024 * 1024;
export const onRequestPost: PagesFunction<Env> = ({ env, request, params }) =>
  handle(async () => {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;

    const index = Number(new URL(request.url).searchParams.get('index'));
    if (!Number.isInteger(index) || index < 0) return error('?index=<n> required', 400);

    // Cap before buffering: a runaway upload should fail fast, not fill R2.
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_FRAME_BYTES) return error('frame too large', 413);
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return error('empty body', 400);
    if (body.byteLength > MAX_FRAME_BYTES) return error('frame too large', 413);

    const key = await putFrame(env, String(params.id), index, body);
    return json({ key, index, size: body.byteLength }, 201);
  });
