import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { api, readBody, requireRecentAuth } from '../../../_shared/auth/api';
import { startFlow } from '../../../_shared/auth/flows';
import { mailTransport, normalizeEmail } from '../../../_shared/auth/mail';
import { verifyTurnstile } from '../../../_shared/auth/turnstile';

// POST /api/me/email/start {email, turnstile} - begin changing the
// account's address (docs/accounts.md §3). It needs recent authentication
// (401 reauth: a passkey, or a code by email/start with reauth: true).
// The new address must be one (400) and not the account's own (400);
// Turnstile for `email-code`; the mail limits count against the new
// address. A code goes to the new address - or, when another account has
// it, the notice that it has an account instead, under the same answer:
// 202 {expiresAt, resendAfter: 60, resendsLeft: 2} with __Host-bz_flow.
// POST /api/me/email/verify finishes it.
export const onRequestPost: PagesFunction<Env, string, RequestData> = (ctx) =>
  api(async () => {
    const { request, env, data } = ctx;
    const { user } = requireRecentAuth(data.principal);
    const body = await readBody(request);
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError('email: expected an email address', 400, 'bad_request');
    if (email === user.email.toLowerCase()) throw new HttpError('That is already your address', 400, 'bad_request');
    mailTransport(env, request);
    await verifyTurnstile(env, request, { token: body.turnstile, action: 'email-code' });
    const taken = await env.DB.prepare('SELECT 1 AS found FROM users WHERE email = ?').bind(email).first();
    return startFlow(ctx, { purpose: 'change_email', userId: user.id, email, link: false }, taken ? 'registered' : 'code');
  });
