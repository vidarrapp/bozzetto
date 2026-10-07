import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import { passkeysOf, sessionsOf } from '../../_shared/auth/account';
import { answer, api, requireUser } from '../../_shared/auth/api';

// GET /api/me/account - the account page's (docs/accounts.md §3): {email,
// createdAt, termsVersion, passkeys, sessions}. passkeys: {id, name,
// createdAt, lastUsedAt, deviceType, backedUp, aaguid, counterWarningAt}
// each, oldest first; sessions: the good ones, {id, client, userAgent,
// createdAt, lastSeenAt, expiresAt, method, current} each, most recently
// used first, `current` on this request's. Never cached.
export const onRequestGet: PagesFunction<Env, string, RequestData> = ({ env, data }) =>
  api(async () => {
    const { user, session } = requireUser(data.principal);
    const [passkeys, sessions] = await Promise.all([
      passkeysOf(env, user.id),
      sessionsOf(env, user.id, session.id, data.now),
    ]);
    return answer({
      email: user.email,
      createdAt: user.created_at,
      termsVersion: user.terms_version,
      passkeys,
      sessions,
    });
  });
