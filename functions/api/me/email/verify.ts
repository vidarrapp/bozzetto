import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { api, readBody, requireUser } from '../../../_shared/auth/api';
import { readCode } from '../../../_shared/auth/codes';
import { checkFlow } from '../../../_shared/auth/flows';

// POST /api/me/email/verify {code} - the code mailed to the new address
// (docs/accounts.md §3), with the session that asked for it and this
// browser's __Host-bz_flow. A match swaps the address, audits it (no
// address in the row), tells the old address, with the new one masked,
// and answers 200 {email}, the flow cookie cleared. The session must be
// the account's that began it, but need not be recent any more: the start
// asked for that, and the code proves the new address.
//
// 400 code_invalid {attemptsLeft}; 410 flow_expired for no flow (or
// another account's, or one expired or spent), and when another account
// has taken the address meanwhile; 401 signin without a session.
export const onRequestPost: PagesFunction<Env, string, RequestData> = (ctx) =>
  api(async () => {
    const { user } = requireUser(ctx.data.principal);
    const code = readCode((await readBody(ctx.request)).code);
    if (!code) throw new HttpError('code: expected six digits', 400, 'bad_request');
    return checkFlow(ctx, { code }, { purposes: ['change_email'], userId: user.id }, { client: 'web' });
  });
