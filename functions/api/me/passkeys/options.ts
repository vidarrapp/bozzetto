import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { MEMBER_LIMITS } from '../../../_shared/config';
import { HttpError } from '../../../_shared/http';
import { answer, api, readBody, requireRecentAuth } from '../../../_shared/auth/api';
import { PASSKEY_OPTIONS, clientIp, rateLimit } from '../../../_shared/auth/ratelimit';
import { withCookies } from '../../../_shared/auth/session';
import { beginCeremony, credentialRefs, registrationOptions, relyingParty } from '../../../_shared/auth/webauthn';

// POST /api/me/passkeys/options - the start of adding a passkey
// (docs/accounts.md §3): options for navigator.credentials.create() - RP
// 'Bozzetto' at RP_ID, the account's user handle and handle, attestation
// none, a discoverable credential with user verification required, the
// account's passkeys excluded, 300 s - with the challenge bound to this
// browser by __Host-bz_wa for five minutes. The body may be left out.
//
// It needs recent authentication (401 reauth; a new session counts), and
// an account below the limit of 10 passkeys (400 otherwise, with `limit`).
// Counted with the other passkey options against 60 per 10 minutes per IP.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, data, waitUntil }) =>
  api(async () => {
    const rp = relyingParty(env);
    const { user } = requireRecentAuth(data.principal);
    await readBody(request, { optional: true });
    const limited = await rateLimit(env, PASSKEY_OPTIONS, clientIp(request), data.now, waitUntil);
    if (limited) return limited;
    const existing = await credentialRefs(env, user.id);
    if (existing.length >= MEMBER_LIMITS.passkeys) {
      throw new HttpError(`An account holds at most ${MEMBER_LIMITS.passkeys} passkeys`, 400, 'bad_request', {
        limit: MEMBER_LIMITS.passkeys,
      });
    }
    const options = await registrationOptions(rp, user, existing);
    const cookie = await beginCeremony(env, request, data.now, 'add_passkey', user.id, options.challenge);
    return withCookies(answer(options), [cookie]);
  });
