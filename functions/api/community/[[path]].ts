import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import { refuse } from '../../_shared/http';
import { api } from '../../_shared/auth/api';
import { communityAnswer, communityQuery, listCommunity } from '../../_shared/community';
import { withStarred } from '../../_shared/stats';

// GET /api/community?sort=&q=&after=&limit= - the community gallery
// (docs/accounts.md §13), 24 a page (limit 1-48): {items: [{id, title,
// mode, fps, shared_at, author: {handle}, thumb, media}], next}. `sort` is
// new (the default: newest approval first), old, views (most viewed, then
// newest) or stars (most starred, then newest); anything else is 400
// reason sort. `q` (trimmed, at most 100 characters) matches the title or
// the author's handle, any capitals; `@name` the handle alone. `media` is
// where the project's files are read from, the open routes as a
// template's; `thumb` its thumbnail at its current version; `next` the
// opaque cursor for the page after in the same sort (base64url JSON), null
// at the end. Only what anyone may see: approved, its author's account
// active. No counts, ever. Anyone may ask: without a session cookie it is
// kept a minute (public, max-age=60, Vary: Cookie); a signed-in member's
// answer says on each card whether they starred it (`starred`) and is
// private, no-store. A cursor, sort or limit that is not one is 400
// bad_request with `reason`.
//
// It is answered here, not in an index.ts, because Pages tries a catch-all
// with more segments first, and /api/community/[[path]] matches
// /api/community itself (as /api/me/[[path]] does). Any other path under
// /api/community, or a method a route does not answer, is 404 not_found.
export const onRequest: PagesFunction<Env, string, RequestData> = ({ request, env, params, data }) => {
  const path = params.path;
  const root = path === undefined || path === '' || (Array.isArray(path) && path.length === 0);
  if (!root || request.method !== 'GET') return Promise.resolve(refuse(404, 'not_found', 'Not found'));
  return api(async () => {
    const query = communityQuery(new URL(request.url).searchParams);
    let page = await listCommunity(env, query);
    if (data.principal.kind === 'user') page = await withStarred(env, data.principal.user.id, page);
    return communityAnswer(page, request);
  });
};
