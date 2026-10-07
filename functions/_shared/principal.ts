import type { Env } from './env';
import type { SessionRow, UserRow } from './types';
import type { OwnerScope } from './projects';
import type { Actor } from './auth/audit';
import { accountsOn, onMediaHost } from './env';
import { HttpError, adminEmail, error } from './http';

/**
 * Who is asking (docs/accounts.md §2). The root middleware works it out
 * once per request, before any route runs, and leaves it on ctx.data.
 *
 * - guest: nobody in particular.
 * - user: a signed-in account, outside /admin/ (its session, and whether
 *   it authenticated in the last ten minutes).
 * - admin: on /admin/* only, the owner as Cloudflare Access vouched for
 *   them (lock 1), with their account once accounts have an owner (lock 2).
 */
export type Principal =
  | { kind: 'guest' }
  | { kind: 'user'; user: UserRow; session: SessionRow; recentAuth: boolean }
  | { kind: 'admin'; email: string; owner: UserRow | null };

/** What the root middleware leaves on ctx.data for every Function after it. */
export type RequestData = {
  principal: Principal;
  /** The request's time in milliseconds: the clock, or X-Test-Now under the test hooks. */
  now: number;
};

const GUEST: Principal = { kind: 'guest' };

/**
 * The principal for one request. Neither lock has a query behind it while
 * accounts are off, and a guest never costs one.
 *
 * Under /admin/api/ the Access identity is lock 1, today's adminEmail(),
 * and enough alone while accounts are off or no owner exists - `owner:
 * null`, as here. Lock 2, the owner's own session once there is an owner,
 * comes with sessions (Batch 3), and goes where the comment says.
 *
 * Everywhere else the Access headers and its cookie are ignored: Access
 * does not front those paths, so they are whatever the client chose to
 * send. With accounts off nobody there is anybody but a guest; with them
 * on, the session cookie decides (Batch 3) - until then, a guest too. The
 * files host is a guest's whatever it is sent: no session cookie is ever
 * meant for it, and nothing it serves depends on who asks.
 */
export async function resolvePrincipal(request: Request, env: Env, url: URL): Promise<Principal> {
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
    // Lock 2 (Batch 3): with accounts on and an owner, the owner's session
    // cookie must come too, and requireAdmin answers 403 owner_session
    // without it - there, not here, so the login bounce never meets it.
    return { kind: 'admin', email, owner: null };
  }
  if (!accountsOn(env)) return GUEST;
  // Public files are the same whoever asks, and the timelapse viewer asks
  // for hundreds: no session is looked up for them.
  if (url.pathname.startsWith('/media/') || url.pathname.startsWith('/m/')) return GUEST;
  // Batch 3: the __Host-bz_session cookie, read once (sessions JOIN users).
  return GUEST;
}

/** A 403 unless the root middleware found the owner; else null. Every owner route asks it first. */
export function requireAdmin(data: RequestData): Response | null {
  return data.principal.kind === 'admin' ? null : error('Unauthorized', 403);
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
 * Who an owner tool acts as in the audit log, and when: the Access
 * identity for now (docs/accounts.md §12, Batch 3 names the owner's
 * account once there is one), at the request's time.
 */
export function ownerActor(data: RequestData): Actor {
  if (data.principal.kind !== 'admin') throw new HttpError('Unauthorized', 403);
  return { actor: data.principal.email, at: data.now };
}
