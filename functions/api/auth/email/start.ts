import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { api, readBody, requireUser } from '../../../_shared/auth/api';
import { startFlow } from '../../../_shared/auth/flows';
import { mailTransport, normalizeEmail } from '../../../_shared/auth/mail';
import { verifyTurnstile } from '../../../_shared/auth/turnstile';

// POST /api/auth/email/start {email, turnstile, link?} - "Email me a code"
// (docs/accounts.md §3): sign-in, and recovery for an account with no
// passkey at hand. Turnstile is checked for the action `email-code`; a code
// goes only to an active account's address, but the answer is always
// 202 {expiresAt, resendAfter: 60, resendsLeft: 2} with __Host-bz_flow,
// counted against the same limits, so it says nothing of whose address it
// is. With link: true (desktop browsers) the mail adds a sign-in link that
// works only in this browser (POST /api/auth/email/link).
//
// {reauth: true, turnstile, link?} with a session: the same, to the
// account's own address, for re-authentication (POST /api/auth/email/verify
// with reauth: true); no session is 401 signin.
//
// 400 for an address that is not one; 403 turnstile, 503 turnstile_down;
// 429 with Retry-After past the mail limits (10 per hour per IP, 3 per 15
// minutes and 10 per day per address); 503 mail_paused past the day's 90,
// and not_configured where nothing can send mail.
export const onRequestPost: PagesFunction<Env, string, RequestData> = (ctx) =>
  api(async () => {
    const { request, env, data } = ctx;
    const body = await readBody(request);
    if (body.link !== undefined && typeof body.link !== 'boolean') {
      throw new HttpError('link: expected true or false', 400, 'bad_request');
    }
    const link = body.link === true;
    if (body.reauth === true) {
      const { user } = requireUser(data.principal);
      mailTransport(env, request);
      await verifyTurnstile(env, request, { token: body.turnstile, action: 'email-code' });
      return startFlow(ctx, { purpose: 'reauth', userId: user.id, email: user.email, link }, 'code');
    }
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError('email: expected an email address', 400, 'bad_request');
    mailTransport(env, request);
    await verifyTurnstile(env, request, { token: body.turnstile, action: 'email-code' });
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ? AND status = 'active'")
      .bind(email)
      .first<{ id: string }>();
    return startFlow(ctx, { purpose: 'sign_in', userId: user?.id ?? null, email, link }, user ? 'code' : 'none');
  });
