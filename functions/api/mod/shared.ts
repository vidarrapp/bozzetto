import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import { json } from '../../_shared/http';
import { api } from '../../_shared/auth/api';
import { requireModerator } from '../../_shared/auth/permissions';
import { CURSOR_ID, listLimit, listShared, sharedQuery } from '../../_shared/community';
import { readCursor } from '../../_shared/owner';

// GET /api/mod/shared?q=&state=all|public|hidden&after=<shared_at>.<id>&limit=
// - the Gallery tab (docs/accounts.md §13): every project in the Community
// now, public or hidden, newest first, 24 a page (limit 1-48), as {items,
// next}, each as the queue lists one. `q` (trimmed, at most 100
// characters) matches the title or the author's handle anywhere in it, any
// capitals; `@name` the handle alone. `state` narrows it (400 reason state
// otherwise). The owner and moderators alone (401 signin, 403 forbidden).
// `private, no-store`.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ request, env, data }) =>
  api(async () => {
    requireModerator(data.principal);
    const params = new URL(request.url).searchParams;
    const { q, state } = sharedQuery(params);
    const page = await listShared(env, { after: readCursor(params, 'after', CURSOR_ID), limit: listLimit(params), q, state });
    return json({ items: page.items, next: page.next }, 200, { 'cache-control': 'private, no-store' });
  });
