import type { Env } from '../../../../_shared/env';
import type { RequestData } from '../../../../_shared/principal';
import { MEMBER_LIMITS } from '../../../../_shared/config';
import { HttpError, bodyLimit } from '../../../../_shared/http';
import { answer, api, requireUser } from '../../../../_shared/auth/api';
import { putMemberFrame } from '../../../../_shared/uploads';

// POST /api/me/projects/:id/frames?index=N - one frame of the account's
// project (docs/accounts.md §4): glTF 2.0 binary, as it is or gzipped (415
// bad_type otherwise), at most 32 MiB (413 file_too_large), N from 0 to
// 9999. What it adds to what was stored under N is reserved against the
// quota before the put (413 quota_exceeded {used, quota}) and given back if
// the put fails. A PUT of the project with its frame list publishes it, as
// on owner tools. Answers 201 {index, size}.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    // Digits only: a missing or empty ?index must not quietly be frame 0.
    const raw = new URL(request.url).searchParams.get('index');
    const max = MEMBER_LIMITS.framesPerProject;
    const index = raw !== null && /^\d{1,5}$/.test(raw) ? Number(raw) : -1;
    if (index < 0 || index >= max) throw new HttpError(`?index=<0 to ${max - 1}> required`, 400, 'bad_request');
    const cap = MEMBER_LIMITS.frameBytes;
    const tooBig = bodyLimit(request, cap, true);
    if (tooBig) throw new HttpError('A frame may be at most 32 MiB', tooBig.status, tooBig.status === 411 ? 'bad_request' : 'file_too_large');
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) throw new HttpError('empty body', 400, 'bad_request');
    if (body.byteLength > cap) throw new HttpError('A frame may be at most 32 MiB', 413, 'file_too_large');
    await putMemberFrame(env, user, String(params.id), index, body);
    return answer({ index, size: body.byteLength }, 201);
  });
