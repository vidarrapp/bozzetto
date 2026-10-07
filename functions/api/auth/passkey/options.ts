import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import type { CredentialRef } from '../../../_shared/auth/webauthn';
import { HttpError } from '../../../_shared/http';
import { answer, api, readBody, requireUser } from '../../../_shared/auth/api';
import { normalizeHandle } from '../../../_shared/auth/handles';
import { PASSKEY_HANDLE, PASSKEY_OPTIONS, clientIp, rateLimit } from '../../../_shared/auth/ratelimit';
import { withCookies } from '../../../_shared/auth/session';
import {
  authenticationOptions,
  beginCeremony,
  credentialRefs,
  handleRefs,
  relyingParty,
} from '../../../_shared/auth/webauthn';

// POST /api/auth/passkey/options [{reauth?: true} | {handle?}] - the start
// of a passkey sign-in (docs/accounts.md §3): options for
// navigator.credentials.get() (rpId, a 32-byte challenge, user
// verification required, no credentials named, 300 s), with the challenge
// held five minutes and bound to this browser by the __Host-bz_wa cookie.
// The body may be left out.
//
// With {handle}, the same naming that account's passkeys (id and
// transports), for a browser that offers none unless they are named
// (Safari with 1Password on an iPad). A handle with none - no such account,
// or one without a passkey - is answered with one or two decoys instead
// (webauthn.ts, decoyRefs), the same for that handle every time, so the
// answer says nothing of which it is. Verify knows only real passkeys.
//
// With {reauth: true} and a session, the same for re-authenticating: only
// the account's own passkeys are offered, and the answer (verify, with
// reauth: true) sets the session's reauth_at. No session is 401 signin;
// an account with no passkey is a 400, and confirms by a code instead
// (/api/auth/email/start and verify, with reauth: true). A handle beside
// it is not looked at.
//
// 60 per 10 minutes per IP, sign-in, re-authentication and new passkeys
// together, and 20 per 10 minutes per handle named; past either, 429
// rate_limited with Retry-After.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, data, waitUntil }) =>
  api(async () => {
    const rp = relyingParty(env);
    const body = await readBody(request, { optional: true });
    const reauth = body.reauth === true;
    const me = reauth ? requireUser(data.principal) : null;
    const handle = reauth ? null : handleOf(body.handle);
    const limited =
      (await rateLimit(env, PASSKEY_OPTIONS, clientIp(request), data.now, waitUntil)) ??
      (handle === null ? null : await rateLimit(env, PASSKEY_HANDLE, handle, data.now, waitUntil));
    if (limited) return limited;
    let allow: CredentialRef[] = [];
    if (me) {
      allow = await credentialRefs(env, me.user.id);
      if (allow.length === 0) throw new HttpError('This account has no passkey', 400, 'bad_request');
    } else if (handle !== null) {
      allow = await handleRefs(env, handle);
    }
    const options = await authenticationOptions(rp, allow);
    const cookie = await beginCeremony(env, request, data.now, reauth ? 'reauth' : 'sign_in', me?.user.id ?? null, options.challenge);
    return withCookies(answer(options), [cookie]);
  });

/** The handle a sign-in names, as handles are stored (trimmed, lower-cased); null when it names none. */
function handleOf(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'string') throw new HttpError('handle: expected a handle', 400, 'bad_request');
  return normalizeHandle(raw);
}
