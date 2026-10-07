import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { api, readBody } from '../../../_shared/auth/api';
import { startFlow } from '../../../_shared/auth/flows';
import { handleProblem, handleShape, normalizeHandle } from '../../../_shared/auth/handles';
import { inviteInvalid, liveInvite } from '../../../_shared/auth/invites';
import { mailTransport, normalizeEmail } from '../../../_shared/auth/mail';
import { REGISTRATIONS, clientIp, enforce } from '../../../_shared/auth/ratelimit';
import { verifyTurnstile } from '../../../_shared/auth/turnstile';

// POST /api/auth/register/start {invite, handle, email, acceptTerms,
// ageConfirmed, turnstile, link?} - Join (docs/accounts.md §3 step 3).
//
// In order: the terms and the age box (both must be true), the handle's
// shape (400 with `reason` format or reserved) and the address (400) are
// read; mail must be able to go out (503 not_configured); Turnstile, for
// the action `register` (403 turnstile, 503 turnstile_down); 5
// registrations begun per hour per IP (429); the invite (410
// invite_invalid); the handle free (409 handle_taken with `reason` taken
// or retired). Then the mail limits, and the flow.
//
// Answers 202 {expiresAt, resendAfter: 60, resendsLeft: 2} with
// __Host-bz_flow, and mails a code (with a sign-in link beside it when
// link is true). An address that has an account gets the notice that it
// has one instead, and the answer is the same 202: the flow it starts
// can never be completed, since no code for it was sent anywhere.
export const onRequestPost: PagesFunction<Env, string, RequestData> = (ctx) =>
  api(async () => {
    const { request, env, data, waitUntil } = ctx;
    const body = await readBody(request);
    if (body.acceptTerms !== true || body.ageConfirmed !== true) {
      throw new HttpError('Accept the terms and confirm you are 13 or older', 400, 'bad_request');
    }
    const handle = normalizeHandle(body.handle);
    const shape = handleShape(handle);
    if (shape) throw new HttpError('That handle cannot be used', 400, 'bad_request', { reason: shape });
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError('email: expected an email address', 400, 'bad_request');
    if (body.link !== undefined && typeof body.link !== 'boolean') {
      throw new HttpError('link: expected true or false', 400, 'bad_request');
    }
    mailTransport(env, request);
    await verifyTurnstile(env, request, { token: body.turnstile, action: 'register' });
    await enforce(env, REGISTRATIONS, clientIp(request), data.now, waitUntil);
    const invite = await liveInvite(env, body.invite, data.now);
    if (!invite) throw inviteInvalid();
    const problem = await handleProblem(env, handle, data.now);
    if (problem) throw new HttpError('That handle is taken', 409, 'handle_taken', { reason: problem });
    const registered = await env.DB.prepare('SELECT 1 AS found FROM users WHERE email = ?').bind(email).first();
    return startFlow(
      ctx,
      { purpose: 'register', userId: null, email, handle, inviteId: invite.id, link: body.link === true },
      registered ? 'registered' : 'code',
    );
  });
