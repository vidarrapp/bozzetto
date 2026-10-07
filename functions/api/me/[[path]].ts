import type { Env } from '../../_shared/env';
import type { RequestData } from '../../_shared/principal';
import { HttpError, notYet } from '../../_shared/http';
import { meOf } from '../../_shared/auth/account';
import { answer, api, readBody, requireUser } from '../../_shared/auth/api';
import { auditStatement } from '../../_shared/auth/audit';
import {
  HANDLE_CHANGE_EVERY,
  HANDLE_HOLD,
  handleProblem,
  handleShape,
  normalizeHandle,
} from '../../_shared/auth/handles';
import { tooMany } from '../../_shared/auth/ratelimit';

// GET /api/me - the signed-in account (docs/accounts.md §3): {id, handle,
// role, status, usage: {used, reserved, quota}}, reserved being what its
// uploads in progress hold. No address: this is what the client keeps.
// Signed out (or expired, suspended, or being deleted): 401 signin.
//
// PATCH /api/me {handle} - a new handle, at most once per 30 days (429
// rate_limited with Retry-After until then). Lower-cased first; a shape
// that will not do is a 400 with `reason` format or reserved, and one
// taken or retired a 409 handle_taken with `reason`. The old handle is
// held from anyone else for 90 days. Audited. Answers as GET /api/me.
//
// They are answered here, not in an index.ts, because Pages tries a
// catch-all with more segments first, and /api/me/[[path]] matches /api/me
// itself. Every other /api/me/* path without a route of its own is one
// still to come (Batch 5: projects, media, export, deletion) and answers
// 501 not_implemented; with accounts off, the middleware beside this has
// answered 404 accounts_off before either.
export const onRequest: PagesFunction<Env, string, RequestData> = ({ request, env, params, data }) => {
  const path = params.path;
  const root = path === undefined || path === '' || (Array.isArray(path) && path.length === 0);
  if (root && request.method === 'GET') {
    return api(async () => answer(await meOf(env, requireUser(data.principal).user)));
  }
  if (root && request.method === 'PATCH') return api(() => changeHandle(request, env, data));
  return notYet(env);
};

async function changeHandle(request: Request, env: Env, data: RequestData): Promise<Response> {
  const { user } = requireUser(data.principal);
  const { now } = data;
  const handle = normalizeHandle((await readBody(request)).handle);
  const shape = handleShape(handle);
  if (shape) throw new HttpError('That handle cannot be used', 400, 'bad_request', { reason: shape });
  if (handle === user.handle.toLowerCase()) throw new HttpError('That is already your handle', 400, 'bad_request');
  const since = user.handle_changed_at;
  if (since !== null && now - since < HANDLE_CHANGE_EVERY) {
    throw tooMany(Math.ceil((since + HANDLE_CHANGE_EVERY - now) / 1000), {}, 'A handle can be changed once every 30 days');
  }
  const problem = await handleProblem(env, handle, now);
  if (problem) throw new HttpError('That handle is taken', 409, 'handle_taken', { reason: problem });
  const renamed = { sql: 'SELECT 1 FROM users WHERE id = ? AND handle = ?', binds: [user.id, handle] };
  let changed: D1Result;
  try {
    [changed] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET handle = ?, handle_changed_at = ?, updated_at = ?
         WHERE id = ? AND handle = ? AND (handle_changed_at IS NULL OR handle_changed_at <= ?)`,
      ).bind(handle, now, now, user.id, user.handle, now - HANDLE_CHANGE_EVERY),
      // The old handle is held, once the new one is the account's.
      env.DB.prepare(
        `INSERT INTO retired_handles (handle, until) SELECT ?, ? WHERE EXISTS (${renamed.sql})
         ON CONFLICT (handle) DO UPDATE SET until = MAX(until, excluded.until)`,
      ).bind(user.handle, now + HANDLE_HOLD, ...renamed.binds),
      auditStatement(env, { actor: user.id, action: 'account.handle', subject: user.id, at: now }, renamed),
    ]);
  } catch (err) {
    // Taken by another account since it was checked.
    if (/UNIQUE/i.test(String((err as Error)?.message ?? err))) {
      throw new HttpError('That handle is taken', 409, 'handle_taken', { reason: 'taken' });
    }
    throw err;
  }
  // Another change got there first.
  if (!changed.meta.changes) throw tooMany(Math.ceil(HANDLE_CHANGE_EVERY / 1000), {}, 'A handle can be changed once every 30 days');
  return answer(await meOf(env, { ...user, handle, handle_changed_at: now, updated_at: now }));
}
