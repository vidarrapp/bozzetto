import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import { HttpError } from '../../_shared/http';
import { answer, api, readBody, requireRecentAuth, requireUser } from '../../_shared/auth/api';
import { auditStatement } from '../../_shared/auth/audit';
import { normalizeHandle } from '../../_shared/auth/handles';
import { notify } from '../../_shared/auth/mail';
import { clearAuthCookies, withCookies } from '../../_shared/auth/session';
import { Budget, DELETION_BUDGET, continueDeletion } from '../../_shared/deletion';

// POST /api/me/delete {handle} - delete the account (docs/accounts.md §3).
//
// The first call needs recent authentication (401 reauth) and the
// account's handle, typed (400 bad_request with reason 'handle' when it is
// not the account's). It marks the account `deleting` - from then on its
// session reaches this route and nothing else - signs out every other
// session, writes the audit row, and mails the holder that the deletion
// has begun (the address is certain to be there then, and the holder hears
// of it while it runs). Then, like every later call, it carries the
// deletion as far as one request's subrequests allow (_shared/deletion.ts):
// uploads, each project's files and row, the rest of the account's
// folder, then the account itself, its handle held for 90 days.
//
// Answers {done: false, remaining} - uploads and projects still to go -
// until {done: true}, which also clears the cookies: the session is gone
// with the account. A later call needs no body and no recent
// authentication: what it continues was confirmed.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, data, waitUntil }) =>
  api(async () => {
    const { user, session } = requireUser(data.principal);
    const { now } = data;
    const budget = new Budget(DELETION_BUDGET);
    if (user.status !== 'deleting') {
      requireRecentAuth(data.principal);
      const { handle } = await readBody(request);
      if (normalizeHandle(handle) !== user.handle.toLowerCase()) {
        throw new HttpError('Type your handle to confirm', 400, 'bad_request', { reason: 'handle' });
      }
      const active = { sql: "SELECT 1 FROM users WHERE id = ? AND status = 'active'", binds: [user.id] };
      budget.take();
      await env.DB.batch([
        auditStatement(env, { actor: user.id, action: 'account.delete', subject: user.id, at: now }, active),
        env.DB.prepare("UPDATE users SET status = 'deleting', updated_at = ? WHERE id = ? AND status = 'active'").bind(now, user.id),
        env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL').bind(
          now,
          user.id,
          session.id,
        ),
      ]);
      // The day's mail count and the mail: two more.
      budget.take(2);
      await notify(env, { request, now, waitUntil }, user, { kind: 'account.deleted' });
    }
    const progress = await continueDeletion(env, user, now, user.id, budget);
    return progress.done ? withCookies(answer(progress), clearAuthCookies()) : answer(progress);
  });
