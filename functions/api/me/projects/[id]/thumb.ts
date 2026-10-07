import type { Env } from '../../../../_shared/env';
import type { RequestData } from '../../../../_shared/principal';
import { MEMBER_LIMITS } from '../../../../_shared/config';
import { HttpError, bodyLimit } from '../../../../_shared/http';
import { answer, api, requireUser } from '../../../../_shared/auth/api';
import { putMemberThumb } from '../../../../_shared/uploads';

// POST /api/me/projects/:id/thumb - the account's project's thumbnail
// (docs/accounts.md §4): a JPEG (415 bad_type otherwise), at most 1 MiB
// (413 file_too_large), counted against the quota as a frame is. The
// project's updated_at moves with it. Answers 201 {ok: true}.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    const cap = MEMBER_LIMITS.thumbBytes;
    const tooBig = bodyLimit(request, cap, true);
    if (tooBig) throw new HttpError('A thumbnail may be at most 1 MiB', tooBig.status, tooBig.status === 411 ? 'bad_request' : 'file_too_large');
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) throw new HttpError('empty body', 400, 'bad_request');
    if (body.byteLength > cap) throw new HttpError('A thumbnail may be at most 1 MiB', 413, 'file_too_large');
    await putMemberThumb(env, user, String(params.id), body, data.now);
    return answer({ ok: true }, 201);
  });
