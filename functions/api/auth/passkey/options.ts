import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { answer, api, readBody, requireUser } from '../../../_shared/auth/api';
import { PASSKEY_OPTIONS, clientIp, rateLimit } from '../../../_shared/auth/ratelimit';
import { withCookies } from '../../../_shared/auth/session';
import {
  authenticationOptions,
  beginCeremony,
  credentialRefs,
  relyingParty,
} from '../../../_shared/auth/webauthn';

// POST /api/auth/passkey/options [{reauth?: true}] - the start of a
// passkey sign-in (docs/accounts.md §3): options for
// navigator.credentials.get() (rpId, a 32-byte challenge, user
// verification required, no credentials named, 300 s), with the challenge
// held five minutes and bound to this browser by the __Host-bz_wa cookie.
// The body may be left out.
//
// With {reauth: true} and a session, the same for re-authenticating: only
// the account's own passkeys are offered, and the answer (verify, with
// reauth: true) sets the session's reauth_at. No session is 401 signin;
// an account with no passkey is a 400, and confirms by a code instead
// (/api/auth/email/start and verify, with reauth: true).
//
// 60 per 10 minutes per IP, sign-in, re-authentication and new passkeys
// together; past that, 429 rate_limited with Retry-After.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, data, waitUntil }) =>
  api(async () => {
    const rp = relyingParty(env);
    const body = await readBody(request, { optional: true });
    const reauth = body.reauth === true;
    const me = reauth ? requireUser(data.principal) : null;
    const limited = await rateLimit(env, PASSKEY_OPTIONS, clientIp(request), data.now, waitUntil);
    if (limited) return limited;
    const allow = me ? await credentialRefs(env, me.user.id) : [];
    if (me && allow.length === 0) throw new HttpError('This account has no passkey', 400, 'bad_request');
    const options = await authenticationOptions(rp, allow);
    const cookie = await beginCeremony(env, request, data.now, reauth ? 'reauth' : 'sign_in', me?.user.id ?? null, options.challenge);
    return withCookies(answer(options), [cookie]);
  });
