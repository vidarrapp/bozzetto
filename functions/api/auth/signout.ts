import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import { api, noContent } from '../../_shared/auth/api';
import { SESSION_COOKIE, clearAuthCookies, readCookie, tokenHash, withCookies } from '../../_shared/auth/session';

// POST /api/auth/signout - sign this browser out (docs/accounts.md §2):
// the session its cookie names is revoked, whether or not it was still
// good, and every auth cookie is cleared. 204 even when nobody was signed
// in, so signing out twice, or after the session expired, is not an error.
// The body, if any, is not read; the root middleware has already refused
// a cross-site request.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, data }) =>
  api(async () => {
    const hash = await tokenHash(readCookie(request, SESSION_COOKIE));
    if (hash) {
      await env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
        .bind(data.now, hash)
        .run();
    }
    return withCookies(noContent(), clearAuthCookies());
  });
