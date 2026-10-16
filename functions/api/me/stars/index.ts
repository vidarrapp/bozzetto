import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { answer, api, requireUser } from '../../../_shared/auth/api';
import { CURSOR_ID, listLimit } from '../../../_shared/community';
import { readCursor } from '../../../_shared/owner';
import { listStars } from '../../../_shared/stats';

// GET /api/me/stars?after=&limit= - the works the signed-in member starred
// (docs/accounts.md §13), the most recently starred first, 24 a page (limit
// 1-48): {items, next}, each a community card as GET /api/community gives
// one, with `starred: true`; `next` is `<starred_at>.<id>`, null at the
// end. Only what is public now: a hidden or withdrawn work drops out of
// the list while its star stays, until the project is deleted. Never
// cached. Signed out: 401 signin.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ request, env, data }) =>
  api(async () => {
    const { user } = requireUser(data.principal);
    const params = new URL(request.url).searchParams;
    const page = await listStars(env, user.id, { after: readCursor(params, 'after', CURSOR_ID), limit: listLimit(params) });
    return answer({ items: page.items, next: page.next });
  });
