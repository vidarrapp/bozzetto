import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { api } from '../../../_shared/auth/api';
import { normalizeHandle } from '../../../_shared/auth/handles';
import { communityAnswer, communityQuery, findAuthor, listCommunity } from '../../../_shared/community';
import { withStarred } from '../../../_shared/stats';

// GET /api/community/u/:handle?sort=&q=&after=&limit= - one member's work
// in the community gallery (docs/accounts.md §13): {handle, items, next},
// the items, sorts and cursor as GET /api/community gives them, `q` matching
// the title alone; the handle as the account spells it. The handle is
// matched in any capitals; no active account with it is 404 not_found (a
// suspended one's page is gone with its work, and an old handle leads
// nowhere). Anyone may ask; cached as GET /api/community is (a minute
// without a session cookie, `starred` and no-store with one).
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ request, env, params, data }) =>
  api(async () => {
    const author = await findAuthor(env, normalizeHandle(String(params.handle)));
    if (!author) throw new HttpError('Not found', 404, 'not_found');
    const query = communityQuery(new URL(request.url).searchParams);
    let page = await listCommunity(env, { ...query, author: author.id, titleOnly: true });
    if (data.principal.kind === 'user') page = await withStarred(env, data.principal.user.id, page);
    return communityAnswer(page, request, { handle: author.handle });
  });
