import type { Env } from './env';
import type { SessionRow, UserRow } from './types';
import type { OwnerScope } from './projects';
import type { Actor } from './auth/audit';
import { accountsOn, onMediaHost } from './env';
import { HttpError, adminEmail, error, refuse } from './http';
import { SESSION_COOKIE, findOwner, findSession, readCookie, recentAuth, touch } from './auth/session';

/**
 * Who is asking (docs/accounts.md §2). The root middleware works it out
 * once per request, before any route runs, and leaves it on ctx.data.
 *
 * - guest: nobody in particular. On /admin/api/ a guest may carry
 *   `refused: 'owner_session'`: Access vouched for them (lock 1), but the
 *   owner's session did not come with it (lock 2), which owner routes
 *   answer with a 403 the page acts on.
 * - user: a signed-in account, outside /admin/ (its session, and whether
 *   it authenticated in the last ten minutes).
 * - admin: on /admin/* only, the owner as Cloudflare Access vouched for
 *   them (lock 1), with their account once accounts have an owner (lock 2).
 */
export type Principal =
  | { kind: 'guest'; refused?: 'owner_session' }
  | { kind: 'user'; user: UserRow; session: SessionRow; recentAuth: boolean }
  | { kind: 'admin'; email: string; owner: UserRow | null };

/** A signed-in account's principal. */
export type UserPrincipal = Extract<Principal, { kind: 'user' }>;

/** What the root middleware leaves on ctx.data for every Function after it. */
export type RequestData = {
  principal: Principal;
  /** The request's time in milliseconds: the clock, or X-Test-Now under the test hooks. */
  now: number;
};

const GUEST: Principal = { kind: 'guest' };

/**
 * The one route an account being deleted reaches (Batch 5 brings it): each
 * call there carries the deletion a step further, and nothing else of the
 * account answers meanwhile.
 */
const DELETION = { method: 'POST', path: '/api/me/delete' };

/**
 * The principal for one request, at `now`. Neither lock has a query behind
 * it while accounts are off, and a guest never costs one.
 *
 * Under /admin/api/ the Access identity is lock 1, today's adminEmail(),
 * and enough alone while accounts are off or no owner exists - `owner:
 * null`. Once there is an owner (accounts on), lock 2 wants the owner's own
 * session cookie as well: one read finds the owner and, when the cookie is
 * theirs and good, the session. Failing lock 2 is a guest marked
 * `refused: 'owner_session'`, never an admin, so no owner route can serve
 * one by forgetting to look; requireAdmin answers the 403 the page acts on.
 *
 * Everywhere else the Access headers and its cookie are ignored: Access
 * does not front those paths, so they are whatever the client chose to
 * send. With accounts off nobody there is anybody but a guest; with them
 * on, the session cookie decides, at the cost of one `sessions JOIN users`
 * read when there is a cookie. The files host is a guest's whatever it is
 * sent: no session cookie is ever meant for it, and nothing it serves
 * depends on who asks.
 *
 * A session in use is noted (last_seen_at) at most hourly, after the
 * answer has gone, through `waitUntil`.
 */
export async function resolvePrincipal(
  request: Request,
  env: Env,
  url: URL,
  now: number = Date.now(),
  waitUntil: (p: Promise<unknown>) => void = () => {},
): Promise<Principal> {
  if (onMediaHost(url, env)) return GUEST;
  // Case and all, as adminEmail checks it: /ADMIN/... is no Access path.
  if (url.pathname.startsWith('/admin/')) {
    // The way back in after an Access login (/admin/login) reads no
    // identity, as it never has: Access ran before it, and all it does is
    // send the browser back to its page, which an outage at Access's key
    // server must not keep it from. Every other /admin/ Function is the API.
    if (!url.pathname.startsWith('/admin/api/')) return GUEST;
    const email = await adminEmail(request, env);
    if (!email) return GUEST;
    if (!accountsOn(env)) return { kind: 'admin', email, owner: null };
    const owner = await findOwner(env, readCookie(request, SESSION_COOKIE), now);
    if (!owner) return { kind: 'admin', email, owner: null };
    if (!owner.session) return { kind: 'guest', refused: 'owner_session' };
    touch(env, owner.session, now, waitUntil);
    return { kind: 'admin', email, owner: owner.user };
  }
  if (!accountsOn(env)) return GUEST;
  // Public files are the same whoever asks, and the timelapse viewer asks
  // for hundreds: no session is looked up for them.
  if (url.pathname.startsWith('/media/') || url.pathname.startsWith('/m/')) return GUEST;
  const token = readCookie(request, SESSION_COOKIE);
  if (token === null) return GUEST;
  const found = await findSession(env, token, now);
  if (!found) return GUEST;
  if (
    found.user.status === 'deleting' &&
    !(request.method.toUpperCase() === DELETION.method && url.pathname === DELETION.path)
  ) {
    return GUEST;
  }
  touch(env, found.session, now, waitUntil);
  return { kind: 'user', user: found.user, session: found.session, recentAuth: recentAuth(found.session, now) };
}

/**
 * A 403 unless the root middleware found the owner (both locks, once there
 * is an owner); else null. Every owner route asks it first. Lock 2 failing
 * is `owner_session`, which the page answers by opening the sign-in dialog.
 */
export function requireAdmin(data: RequestData): Response | null {
  const p = data.principal;
  if (p.kind === 'admin') return null;
  if (p.kind === 'guest' && p.refused === 'owner_session') {
    return refuse(403, 'owner_session', "Sign in to the owner's account");
  }
  return error('Unauthorized', 403);
}

/**
 * What owner tools may reach for this principal: templates and the owner's
 * own projects. Before the bootstrap has made the owner an account, their
 * projects are the ones with no owner at all, so `owner` is null - which is
 * why anyone else asking is refused here too rather than handed that null.
 */
export function ownerScope(principal: Principal): OwnerScope {
  if (principal.kind !== 'admin') throw new HttpError('Unauthorized', 403);
  return { owner: principal.owner?.id ?? null };
}

/**
 * Who an owner tool acts as in the audit log, and when: the owner's
 * account once there is one, else the Access identity, at the request's
 * time.
 */
export function ownerActor(data: RequestData): Actor {
  if (data.principal.kind !== 'admin') throw new HttpError('Unauthorized', 403);
  return { actor: data.principal.owner?.id ?? data.principal.email, at: data.now };
}
