import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { auditStatement } from '../../../_shared/auth/audit';
import { answer, api, readBody, requireUser } from '../../../_shared/auth/api';
import { SESSION_IDLE, clearAuthCookies, withCookies } from '../../../_shared/auth/session';

// POST /api/me/sessions/revoke-all {keepCurrent} - sign out everywhere
// (docs/accounts.md §3): every good session of the account's is revoked,
// and this request's own too unless keepCurrent is true - then its cookies
// are cleared as well. keepCurrent left out is false. Audited. Answers
// {revoked: n}, the number of sessions signed out.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, data }) =>
  api(async () => {
    const { user, session } = requireUser(data.principal);
    const { keepCurrent = false } = await readBody(request, { optional: true });
    if (typeof keepCurrent !== 'boolean') throw new HttpError('keepCurrent: expected true or false', 400, 'bad_request');
    const keep = keepCurrent ? session.id : '';
    const [revoked] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE sessions SET revoked_at = ?1
         WHERE user_id = ?2 AND revoked_at IS NULL AND expires_at > ?1 AND last_seen_at > ?3 AND id <> ?4`,
      ).bind(data.now, user.id, data.now - SESSION_IDLE, keep),
      auditStatement(env, {
        actor: user.id,
        action: 'session.revoke_all',
        subject: user.id,
        at: data.now,
        detail: { keepCurrent },
      }),
    ]);
    const res = answer({ revoked: revoked.meta.changes });
    return keepCurrent ? res : withCookies(res, clearAuthCookies());
  });
