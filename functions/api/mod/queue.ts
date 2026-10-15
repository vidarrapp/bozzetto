import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import { answer, api } from '../../_shared/auth/api';
import { requireModerator } from '../../_shared/auth/permissions';
import { CURSOR_ID, listLimit, reviewQueue } from '../../_shared/community';
import { readCursor } from '../../_shared/owner';

// GET /api/mod/queue?after=<shared_at>.<id>&limit= - the review queue
// (docs/accounts.md §13): the projects waiting for review, oldest first,
// 50 a page (limit 1-100), as {items, next}. Each item is {id, title,
// mode, fps, shared, shared_at, updated_at, review_reason, author:
// {handle}, reports, thumb, media}: `reports` its open reports, `media`
// the reviewers' private route to its files (/api/mod/media/<id>). The
// owner and moderators alone (401 signin, 403 forbidden). Never cached.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ request, env, data }) =>
  api(async () => {
    requireModerator(data.principal);
    const q = new URL(request.url).searchParams;
    const page = await reviewQueue(env, { after: readCursor(q, 'after', CURSOR_ID), limit: listLimit(q, 50, 100) });
    return answer(page);
  });
