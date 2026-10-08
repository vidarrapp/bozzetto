import type { Env } from '../../../../_shared/env';
import type { RequestData } from '../../../../_shared/principal';
import { HttpError, bodyLimit } from '../../../../_shared/http';
import { answer, api, requireUser } from '../../../../_shared/auth/api';
import { memberMediaBase, toManifest } from '../../../../_shared/projects';
import { MAX_ARMATURE_BODY, putArmatureFile } from '../../../../_shared/armatureFile';

// POST /api/me/projects/:id/armature - an armature project's file
// (docs/accounts.md §4), armature.json (shared/armature.ts): gzip or plain
// JSON, at most 4 MiB either way (413 file_too_large), 415 bad_type if it
// is neither, 422 bad_armature {reason} unless it is one object with `v`
// 1, a figure the app has and no `__proto__`. It replaces the one stored,
// the difference counted against the quota (413 quota_exceeded). Not an
// armature project: 400; another account's: 404. Answers the project's
// manifest, its files on the private route.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ env, request, params, data }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    const tooBig = bodyLimit(request, MAX_ARMATURE_BODY, true);
    if (tooBig) throw new HttpError('An armature may be at most 4 MiB', tooBig.status, tooBig.status === 411 ? 'bad_request' : 'file_too_large');
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) throw new HttpError('empty body', 400, 'bad_request');
    const row = await putArmatureFile(env, { kind: 'member', user }, String(params.id), body, data.now);
    return answer(toManifest(row, env, memberMediaBase(row.id)));
  });
