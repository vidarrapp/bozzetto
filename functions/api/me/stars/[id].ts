import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { answer, api, noContent, requireUser } from '../../../_shared/auth/api';
import { isStarred, setStar } from '../../../_shared/stats';

// PUT /api/me/stars/:id - the signed-in member stars a work in the
// community gallery (docs/accounts.md §13); DELETE unstars it. Both
// idempotent, 204. Starring wants the work public now (404 not_found
// otherwise) and not the member's own (400 reason own); unstarring removes
// the member's star whatever the work's state now. 200 changes a day per
// account (429 rate_limited). The work's star count moves in the same
// batch. Signed out: 401 signin.
//
// GET /api/me/stars/:id - {starred}: whether the member starred it, for
// the viewer's Star button. Never cached.
export const onRequestPut: PagesFunction<Env, string, RequestData> = ({ env, params, data, waitUntil }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    await setStar(env, user, String(params.id), true, data.now, waitUntil);
    return noContent();
  });

export const onRequestDelete: PagesFunction<Env, string, RequestData> = ({ env, params, data, waitUntil }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    await setStar(env, user, String(params.id), false, data.now, waitUntil);
    return noContent();
  });

export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    return answer({ starred: await isStarred(env, user.id, String(params.id)) });
  });
