import type { Env } from '../../../../_shared/env';
import type { RequestData } from '../../../../_shared/principal';
import { HttpError } from '../../../../_shared/http';
import { answer, api, readBody, requireUser } from '../../../../_shared/auth/api';
import { setShared } from '../../../../_shared/community';
import { sharedOf } from '../../../../_shared/projects';

// POST /api/me/projects/:id/share {shared: boolean} - share the account's
// project to the community gallery, or withdraw it (docs/accounts.md §13).
// true sends it for review (pending) from not shared or rejected: a model
// or timelapse only (400 reason mode), 20 shares a day (429); pending or
// public already changes nothing; hidden is 409 wrong_state {shared}.
// false takes it out at once, from any state. Answers {id, shared,
// shared_at, review_reason}, the reason only while rejected or hidden.
// Another account's project, or a template, is 404 not_found. Audited
// (project.share, project.withdraw), without the title.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, params, data, waitUntil }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    const body = await readBody(request);
    if (typeof body.shared !== 'boolean') throw new HttpError('shared: true or false', 400, 'bad_request', { reason: 'shared' });
    const row = await setShared(env, user, String(params.id), body.shared, data.now, waitUntil);
    return answer({ id: row.id, ...sharedOf(row) });
  });
