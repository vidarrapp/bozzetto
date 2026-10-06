import type { Env } from '../../../../_shared/env';
import { bodyLimit, error, handle, json } from '../../../../_shared/http';
import { ownerScope, requireAdmin, type RequestData } from '../../../../_shared/principal';
import { MAX_FRAMES, putFrame } from '../../../../_shared/projects';

// POST /admin/api/projects/:id/frames?index=N — upload one frame's .glb bytes.
/** Generous for a single quantized-gzip frame (the 16M-tri ceiling lands well under this). */
const MAX_FRAME_BYTES = 96 * 1024 * 1024;
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  handle(async () => {
    const denied = requireAdmin(data);
    if (denied) return denied;

    // Digits only. Number() reads a missing or empty ?index as 0, which
    // quietly overwrote the first frame, and takes '1e3' and '0x10' too.
    const raw = new URL(request.url).searchParams.get('index');
    const index = raw !== null && /^\d+$/.test(raw) ? Number(raw) : -1;
    if (index < 0 || index >= MAX_FRAMES) return error(`?index=<0 to ${MAX_FRAMES - 1}> required`, 400);

    // Cap before buffering: a runaway upload should fail fast, not fill R2.
    const tooBig = bodyLimit(request, MAX_FRAME_BYTES, true);
    if (tooBig) return tooBig;
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return error('empty body', 400);
    if (body.byteLength > MAX_FRAME_BYTES) return error('frame too large', 413);

    const key = await putFrame(env, String(params.id), index, body, ownerScope(data.principal));
    return json({ key, index, size: body.byteLength }, 201);
  });
