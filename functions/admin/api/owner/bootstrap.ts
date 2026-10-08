import type { Env } from '../../../_shared/env';
import type { RequestData } from '../../../_shared/principal';
import type { UserRow } from '../../../_shared/types';
import { accountsOn } from '../../../_shared/env';
import { HttpError, error, refuse } from '../../../_shared/http';
import { randomId, randomToken } from '../../../_shared/crypto';
import { TERMS_VERSION } from '../../../_shared/config';
import { RECOUNT_LISTINGS, recountUsage } from '../../../_shared/quota';
import { auditStatement } from '../../../_shared/auth/audit';
import { meOf } from '../../../_shared/auth/account';
import { answer, api, readBody } from '../../../_shared/auth/api';
import { handleProblem, normalizeHandle } from '../../../_shared/auth/handles';
import { newSession, signInCookies, userAgentOf, withCookies } from '../../../_shared/auth/session';

/** The owner's storage: 10 GiB, where a member has 250 MiB (docs/accounts.md §4). */
const OWNER_QUOTA = 10 * 1024 * 1024 * 1024;

// POST /admin/api/owner/bootstrap {handle, acceptTerms, ageConfirmed} - the
// owner's own account (docs/accounts.md §8), made once, with accounts on.
// Cloudflare Access alone lets this in (lock 1): before it there is no
// owner account for lock 2 to ask for. Once there is one it is refused,
// 409 owner_exists, whoever asks.
//
// The account is the owner's (role 'owner'), under the Access identity's
// address, with a 10 GiB quota and the terms and age confirmed now. It
// claims the projects nobody owns that are not templates - the owner's own
// before accounts - and their bytes count against it. Those rows predate
// the counting (their `bytes` 0), so once claimed they are counted from R2
// (recountUsage), each project's bytes and the account's usage, as far as
// this request's subrequests allow (RECOUNT_LISTINGS listings); past that,
// or if R2 fails, the answer says recount: 'partial', and the owner's
// Recount (Users) counts the rest. The owner is then
// signed in (method 'bootstrap'), which counts as recent authentication,
// so the page can offer a passkey at once. All of it but the count is one
// batch, audited.
//
// The handle may be one of the protected names (handles.ts), such as the
// owner's own, which every other account is refused: they are kept so that
// nobody can pass for the owner, and the owner is who they protect.
//
// Answers 201 {user} (as GET /api/me) with the session cookie, and
// recount: 'partial' beside it when the claimed projects are not all
// counted yet. A handle
// that is malformed or a route name, which not even the owner may take, is
// a 400 with `reason` (format, reserved); one taken or retired a 409
// handle_taken with `reason`; terms or age not confirmed, or an account
// already under the Access address, a 400.
export const onRequestPost: PagesFunction<Env, string, RequestData> = ({ request, env, data }) =>
  api(async () => {
    if (!accountsOn(env)) return refuse(404, 'accounts_off', 'Accounts are off');
    const p = data.principal;
    const exists = (): Response => refuse(409, 'owner_exists', 'The owner account already exists');
    if (p.kind === 'guest' && p.refused === 'owner_session') return exists();
    if (p.kind !== 'admin') return error('Unauthorized', 403);
    if (p.owner) return exists();

    const body = await readBody(request);
    if (body.acceptTerms !== true || body.ageConfirmed !== true) {
      throw new HttpError('Accept the terms and confirm you are 13 or older', 400, 'bad_request');
    }
    const { now } = data;
    const handle = normalizeHandle(body.handle);
    // The owner's account, alone, may take a protected name.
    const problem = await handleProblem(env, handle, now, { owner: true });
    if (problem === 'format' || problem === 'reserved') {
      throw new HttpError('That handle cannot be used', 400, 'bad_request', { reason: problem });
    }
    if (problem) throw new HttpError('That handle is taken', 409, 'handle_taken', { reason: problem });
    const email = p.email.trim();
    if (await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) {
      throw new HttpError('An account already has the address Access signed you in with', 400, 'bad_request');
    }

    const id = randomId('u');
    const unclaimed = 'owner_id IS NULL AND template = 0';
    const claimed = await env.DB.prepare(`SELECT COUNT(*) AS n FROM projects WHERE ${unclaimed}`).first<{ n: number }>();
    const made = { sql: 'SELECT 1 FROM users WHERE id = ?', binds: [id] };
    const session = await newSession(env, {
      userId: id,
      method: 'bootstrap',
      client: 'web',
      userAgent: userAgentOf(request),
      now,
      onlyIf: made,
    });
    let results: D1Result[];
    try {
      results = await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO users (id, handle, email, webauthn_user_id, role, status, quota_bytes, bytes_used,
                              terms_version, terms_accepted_at, age_confirmed_at, created_at, updated_at)
           SELECT ?, ?, ?, ?, 'owner', 'active', ?, (SELECT COALESCE(SUM(bytes), 0) FROM projects WHERE ${unclaimed}),
                  ?, ?, ?, ?, ?
           WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'owner')`,
        ).bind(id, handle, email, randomToken(32), OWNER_QUOTA, TERMS_VERSION, now, now, now, now),
        env.DB.prepare(`UPDATE projects SET owner_id = ? WHERE ${unclaimed} AND EXISTS (${made.sql})`).bind(id, id),
        session.insert,
        auditStatement(
          env,
          {
            actor: id,
            action: 'owner.bootstrap',
            subject: id,
            at: now,
            detail: { claimed: claimed?.n ?? 0, session: session.id },
          },
          made,
        ),
      ]);
    } catch (err) {
      // Another request got there first: the owner (one at most, by index),
      // the handle or the address.
      const message = String((err as Error)?.message ?? err);
      if (!/UNIQUE/i.test(message)) throw err;
      if (/role/.test(message)) return exists();
      if (/handle/.test(message)) throw new HttpError('That handle is taken', 409, 'handle_taken', { reason: 'taken' });
      throw new HttpError('An account already has the address Access signed you in with', 400, 'bad_request');
    }
    if (!results[0].meta.changes) return exists();
    let partial = false;
    if ((claimed?.n ?? 0) > 0) {
      try {
        partial = (await recountUsage(env, id, { listings: RECOUNT_LISTINGS })).next !== null;
      } catch (err) {
        // The account is made: the Recount tool can count them later.
        console.error('bootstrap recount failed:', err);
        partial = true;
      }
    }
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
    if (!user) throw new Error('the owner account is not there after its batch');
    const answered = { user: await meOf(env, user), ...(partial ? { recount: 'partial' } : {}) };
    return withCookies(answer(answered, 201), signInCookies(session.token));
  });
