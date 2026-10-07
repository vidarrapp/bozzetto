import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { api, readBody } from '../../../_shared/auth/api';
import { resendFlow } from '../../../_shared/auth/flows';

// POST /api/auth/email/resend {turnstile} - a new code for the flow this
// browser's __Host-bz_flow names (docs/accounts.md §3), whichever began it:
// Join, a sign-in, a re-authentication, a new address. The code before it
// (and its link) stops working; the new one has its own 10 minutes and 5
// tries. At most 3 codes to a flow, 60 s apart: 429 rate_limited with
// Retry-After and `resendsLeft` otherwise. Turnstile (`email-code`) and the
// mail limits as a start's. Answers 202 {expiresAt, resendAfter: 60,
// resendsLeft} with the flow cookie set again; 410 flow_expired when
// there is no flow to send for. What the address is sent - a code, the
// notice that it has an account, or nothing - is what the start sent.
export const onRequestPost: PagesFunction<Env, string, RequestData> = (ctx) =>
  api(async () => resendFlow(ctx, await readBody(ctx.request)));
