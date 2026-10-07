import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { api, readBody } from '../../../_shared/auth/api';
import { TOKEN } from '../../../_shared/auth/codes';
import { checkFlow } from '../../../_shared/auth/flows';
import { clientOf } from '../../../_shared/auth/session';

// POST /api/auth/email/link {token, client?} - the sign-in link a code mail
// carries when its flow began with link: true (docs/accounts.md §3), which
// the app posts from /?link=<token>. It works once, only with the
// __Host-bz_flow of the browser that asked, and consumes the code with it:
// a mail scanner that follows the link has no cookie, and gets nothing.
//
// It completes whatever the flow was for, as its code would:
// - a sign-in: 200 {user} with the session cookie ('link');
// - Join: 201 {user} with the session cookie, the account made;
// - a re-authentication (with that account's session): 204.
// A wrong link is 400 code_invalid {attemptsLeft}, a try like a wrong
// code's; no flow, or one without a link, 410 flow_expired; a token that
// is not one, 400 bad_request. Counted with the code checks, 30 per 10
// minutes per IP.
export const onRequestPost: PagesFunction<Env, string, RequestData> = (ctx) =>
  api(async () => {
    const body = await readBody(ctx.request);
    const token = typeof body.token === 'string' && TOKEN.test(body.token) ? body.token : null;
    if (!token) throw new HttpError('token: expected a sign-in link token', 400, 'bad_request');
    const p = ctx.data.principal;
    return checkFlow(
      ctx,
      { link: token },
      { purposes: ['register', 'sign_in', 'reauth'], userId: p.kind === 'user' ? p.user.id : undefined },
      { client: clientOf(body.client) },
    );
  });
