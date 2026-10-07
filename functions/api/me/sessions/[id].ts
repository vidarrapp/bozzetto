import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import { HttpError } from '../../../_shared/http';
import { auditStatement } from '../../../_shared/auth/audit';
import { api, noContent, requireUser } from '../../../_shared/auth/api';
import { clearAuthCookies, withCookies } from '../../../_shared/auth/session';

// DELETE /api/me/sessions/:id - sign one of the account's sessions out
// (docs/accounts.md §2), by the id GET /api/me/account lists it under. 204,
// with the cookies cleared when it is this request's own; anyone else's,
// or one already revoked, is 404 not_found. Audited.
export const onRequestDelete: PagesFunction<Env, string, RequestData> = ({ env, params, data }) =>
  api(async () => {
    const { user, session } = requireUser(data.principal);
    const id = String(params.id);
    const guard = 'SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL';
    const [, revoked] = await env.DB.batch([
      auditStatement(
        env,
        { actor: user.id, action: 'session.revoke', subject: user.id, at: data.now, detail: { session: id } },
        { sql: guard, binds: [id, user.id] },
      ),
      env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').bind(
        data.now,
        id,
        user.id,
      ),
    ]);
    if (!revoked.meta.changes) throw new HttpError('Not found', 404, 'not_found');
    return id === session.id ? withCookies(noContent(), clearAuthCookies()) : noContent();
  });
