import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { noContent } from '../../../_shared/auth/api';
import { countView } from '../../../_shared/stats';

// POST /api/community/:id/view - the viewer opened a work from the community
// gallery (docs/accounts.md §13). Counted once a day per visitor (the
// account when signed in, else the address and browser), keyed by an HMAC
// under AUTH_SECRET so no address or identity is kept; never the author's
// own opens or a reviewer's, only a project public now, and nothing past
// 300 an hour from one address. Always 204, signed in or not, counted or
// not: the answer never says whether it counted. No body is read.
export const onRequestPost: PagesFunction<Env, string, RequestData> = async ({ request, env, params, data, waitUntil }) => {
  try {
    await countView(env, data.principal, request, String(params.id), data.now, waitUntil);
  } catch (err) {
    console.error('view not counted:', err);
  }
  return noContent();
};
