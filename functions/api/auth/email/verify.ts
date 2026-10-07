import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { api, readBody, requireUser } from '../../../_shared/auth/api';
import { readCode } from '../../../_shared/auth/codes';
import { checkFlow } from '../../../_shared/auth/flows';
import { clientOf } from '../../../_shared/auth/session';

// POST /api/auth/email/verify {code, client?} - the code a sign-in mailed
// (docs/accounts.md §3), with this browser's __Host-bz_flow. A match
// consumes the flow and answers 200 {user} (as GET /api/me) with a new
// session cookie ('email'), the flow cookie cleared and a session this
// browser held before revoked; client: 'desktop' marks the desktop app's.
//
// {code, reauth: true} with a session: the code of a re-authentication
// (email/start with reauth: true), which marks this session as recently
// authenticated and answers 204.
//
// 400 code_invalid {attemptsLeft} for a wrong code (5 tries to a code);
// 410 flow_expired for no flow, or one expired, spent or used; 400
// bad_request for anything but six digits, which costs no try. 30 code
// checks per 10 minutes per IP.
export const onRequestPost: PagesFunction<Env, string, RequestData> = (ctx) =>
  api(async () => {
    const body = await readBody(ctx.request);
    const code = readCode(body.code);
    if (!code) throw new HttpError('code: expected six digits', 400, 'bad_request');
    const client = clientOf(body.client);
    if (body.reauth === true) {
      const { user } = requireUser(ctx.data.principal);
      return checkFlow(ctx, { code }, { purposes: ['reauth'], userId: user.id }, { client });
    }
    return checkFlow(ctx, { code }, { purposes: ['sign_in'] }, { client });
  });
