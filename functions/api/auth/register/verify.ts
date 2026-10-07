import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { api, readBody } from '../../../_shared/auth/api';
import { readCode } from '../../../_shared/auth/codes';
import { checkFlow } from '../../../_shared/auth/flows';
import { handleShape, normalizeHandle } from '../../../_shared/auth/handles';
import { clientOf } from '../../../_shared/auth/session';

// POST /api/auth/register/verify {code, handle?, client?} - the code Join
// mailed (docs/accounts.md §3 step 4), with this browser's __Host-bz_flow.
//
// - 201 {user} (as GET /api/me) with the session cookie and the flow
//   cookie cleared: the account is made (a member, the terms version in
//   force, the terms and age confirmed now), the invite used, and the
//   browser signed in ('email'), which counts as recent authentication.
// - 400 code_invalid {attemptsLeft}: not the code; 5 tries to a code.
// - 410 flow_expired: no flow, or expired, spent or used.
// - 410 invite_invalid: the invite admits nobody any more (revoked,
//   expired, or its last use taken by someone else first).
// - 409 handle_taken {reason}: the handle was taken meanwhile; the flow is
//   kept, and the same code with another `handle` completes it.
//
// A code that is not six digits is a 400 bad_request, and costs no try;
// 30 code checks per 10 minutes per IP.
export const onRequestPost: PagesFunction<Env, string, RequestData> = (ctx) =>
  api(async () => {
    const body = await readBody(ctx.request);
    const code = readCode(body.code);
    if (!code) throw new HttpError('code: expected six digits', 400, 'bad_request');
    let handle: string | undefined;
    if (body.handle !== undefined) {
      handle = normalizeHandle(body.handle);
      const shape = handleShape(handle);
      if (shape) throw new HttpError('That handle cannot be used', 400, 'bad_request', { reason: shape });
    }
    return checkFlow(ctx, { code }, { purposes: ['register'] }, { client: clientOf(body.client), handle });
  });
