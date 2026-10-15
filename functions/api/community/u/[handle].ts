import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { api } from '../../../_shared/auth/api';
import { normalizeHandle } from '../../../_shared/auth/handles';
import { CURSOR_ID, communityAnswer, findAuthor, listCommunity, listLimit } from '../../../_shared/community';
import { readCursor } from '../../../_shared/owner';

// GET /api/community/u/:handle?after=&limit= - one member's work in the
// community gallery (docs/accounts.md §13): {handle, items, next}, the
// items and cursor as GET /api/community gives them, the handle as the
// account spells it. The handle is matched in any capitals; no active
// account with it is 404 not_found (a suspended one's page is gone with
// its work, and an old handle leads nowhere). Anyone may ask; kept a
// minute (max-age=60).
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ request, env, params }) =>
  api(async () => {
    const author = await findAuthor(env, normalizeHandle(String(params.handle)));
    if (!author) throw new HttpError('Not found', 404, 'not_found');
    const q = new URL(request.url).searchParams;
    const page = await listCommunity(env, {
      after: readCursor(q, 'after', CURSOR_ID),
      limit: listLimit(q),
      author: author.id,
    });
    return communityAnswer(page, { handle: author.handle });
  });

