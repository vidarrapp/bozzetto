import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import { refuse } from '../../_shared/http';
import { api } from '../../_shared/auth/api';
import { CURSOR_ID, communityAnswer, listCommunity, listLimit } from '../../_shared/community';
import { readCursor } from '../../_shared/owner';

// GET /api/community?after=<shared_at>.<id>&limit= - the community gallery
// (docs/accounts.md §13), newest approval first, 24 a page (limit 1-48):
// {items: [{id, title, mode, fps, shared_at, author: {handle}, thumb,
// media}], next}. `media` is where the project's files are read from, the
// open routes as a template's; `thumb` its thumbnail at its current
// version; `next` the cursor for the page after, null at the end. Only
// what anyone may see: approved, its author's account active. Anyone may
// ask, signed in or not; kept a minute (max-age=60). A cursor or limit that
// is not one is 400 bad_request with `reason`.
//
// It is answered here, not in an index.ts, because Pages tries a catch-all
// with more segments first, and /api/community/[[path]] matches
// /api/community itself (as /api/me/[[path]] does). Any other path under
// /api/community, or a method a route does not answer, is 404 not_found.
export const onRequest: PagesFunction<Env, string, RequestData> = ({ request, env, params }) => {
  const path = params.path;
  const root = path === undefined || path === '' || (Array.isArray(path) && path.length === 0);
  if (!root || request.method !== 'GET') return Promise.resolve(refuse(404, 'not_found', 'Not found'));
  return api(async () => {
    const q = new URL(request.url).searchParams;
    const page = await listCommunity(env, { after: readCursor(q, 'after', CURSOR_ID), limit: listLimit(q) });
    return communityAnswer(page);
  });
};
