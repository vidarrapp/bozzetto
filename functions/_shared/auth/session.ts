import type { Env } from '../env';
import type { SessionRow, UserRow } from '../types';
import { randomId, randomToken, sha256Hex } from '../crypto';

/**
 * Sessions and the cookies that carry them (docs/accounts.md §2).
 *
 * The session cookie holds `bz1_` and 32 random bytes; the database keeps
 * only their SHA-256 (sessions.token_hash), so a copy of the database signs
 * nobody in. A session is good while it is not revoked, is younger than 90
 * days, and was seen in the last 30; and while its account is active - or
 * being deleted, which reaches POST /api/me/delete and nothing else (the
 * root middleware sees to that, resolvePrincipal).
 *
 * Every cookie here is `__Host-`: Secure, Path=/ and no Domain, so neither
 * the files host nor any other subdomain can set or read one.
 */

export const SESSION_COOKIE = '__Host-bz_session';
/** The WebAuthn ceremony in progress: its challenge is in pending_auth under this token's hash. */
export const CEREMONY_COOKIE = '__Host-bz_wa';
/**
 * The email-code flow in progress (codes.ts): its code is in pending_auth
 * under this token's hash. Cleared by every sign-in.
 */
export const FLOW_COOKIE = '__Host-bz_flow';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A session's whole life, from the sign-in that made it. */
export const SESSION_TTL = 90 * DAY;
/** How long a session may go unused. */
export const SESSION_IDLE = 30 * DAY;
/** What counts as recent authentication: adding or removing a passkey, and the like, need it. */
export const RECENT_AUTH = 10 * MINUTE;
/** How long the flow cookie lives: past its code's 10 minutes, and set again by each resend. */
export const FLOW_TTL = 15 * MINUTE;
/** last_seen_at is written at most this often, so most requests cost the one read and no write. */
export const SEEN_EVERY = HOUR;

/** A session cookie's value; anything else is no session, and costs no query. */
const TOKEN = /^bz1_[A-Za-z0-9_-]{43}$/;
/** What sessions keep of a user agent, for the sessions list. */
const MAX_USER_AGENT = 256;

// --- cookies -------------------------------------------------------------------

/** One cookie of the request, or null. Cookie names are matched exactly. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

type SameSite = 'Lax' | 'Strict';

function cookie(name: string, value: string, maxAgeSeconds: number, sameSite: SameSite): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}`;
}

/** The session cookie for a token just minted: SameSite=Lax, so a link into the app arrives signed in. */
export function sessionCookie(token: string): string {
  return cookie(SESSION_COOKIE, token, SESSION_TTL / 1000, 'Lax');
}

/** A ceremony cookie, SameSite=Strict, living as long as its challenge. */
export function ceremonyCookie(token: string, ttlMs: number): string {
  return cookie(CEREMONY_COOKIE, token, Math.floor(ttlMs / 1000), 'Strict');
}

export const clearCeremony = (): string => cookie(CEREMONY_COOKIE, '', 0, 'Strict');

/** An email flow's cookie, SameSite=Strict, for FLOW_TTL. */
export function flowCookie(token: string): string {
  return cookie(FLOW_COOKIE, token, FLOW_TTL / 1000, 'Strict');
}

export const clearFlow = (): string => cookie(FLOW_COOKIE, '', 0, 'Strict');

/** Every auth cookie, cleared: what signing out sends. */
export function clearAuthCookies(): string[] {
  return [cookie(SESSION_COOKIE, '', 0, 'Lax'), clearCeremony(), clearFlow()];
}

/** What every sign-in sends: the new session, and the other auth cookies cleared (§2). */
export function signInCookies(token: string): string[] {
  return [sessionCookie(token), clearCeremony(), clearFlow()];
}

/** A response with these Set-Cookie headers added, one each. */
export function withCookies(response: Response, cookies: string[]): Response {
  const out = new Response(response.body, response);
  for (const c of cookies) out.headers.append('set-cookie', c);
  return out;
}

// --- minting -------------------------------------------------------------------

export type Client = 'web' | 'desktop';

/** The client a sign-in says it is: the desktop app says so, anything else is the web. */
export const clientOf = (v: unknown): Client => (v === 'desktop' ? 'desktop' : 'web');

/** The user agent as sessions keep it: cut short, and null when there is none. */
export function userAgentOf(request: Request): string | null {
  const ua = request.headers.get('user-agent')?.trim();
  return ua ? ua.slice(0, MAX_USER_AGENT) : null;
}

/** A session about to be made: its cookie's token, its public id, and the statement that stores it. */
export interface NewSession {
  token: string;
  id: string;
  insert: D1PreparedStatement;
}

/**
 * A new session for `userId`, signed in by `method` at `now`, which counts
 * as recent authentication. The statement goes in the batch that makes the
 * sign-in, so the session exists exactly when the rest of it does; with
 * `onlyIf` (a SELECT), only if that finds something as the batch runs.
 */
export async function newSession(
  env: Env,
  opts: {
    userId: string;
    method: string;
    client: Client;
    userAgent: string | null;
    now: number;
    onlyIf?: { sql: string; binds: unknown[] };
  },
): Promise<NewSession> {
  const token = `bz1_${randomToken(32)}`;
  const id = randomId('s');
  const { userId, method, client, userAgent, now, onlyIf } = opts;
  const values = [id, await sha256Hex(token), userId, method, client, userAgent, now, now, now, now + SESSION_TTL];
  const columns = 'id, token_hash, user_id, method, client, user_agent, created_at, last_seen_at, reauth_at, expires_at';
  const insert = onlyIf
    ? env.DB.prepare(
        `INSERT INTO sessions (${columns}) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${onlyIf.sql})`,
      ).bind(...values, ...onlyIf.binds)
    : env.DB.prepare(`INSERT INTO sessions (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...values);
  return { token, id, insert };
}

// --- reading --------------------------------------------------------------------

/** A session and its account, as one read finds them. */
export interface SessionUser {
  user: UserRow;
  session: SessionRow;
}

/** The session's columns, renamed so they cannot collide with the user's in a join. */
const SESSION_COLUMNS = [
  'id',
  'token_hash',
  'user_id',
  'method',
  'client',
  'user_agent',
  'created_at',
  'last_seen_at',
  'reauth_at',
  'expires_at',
  'revoked_at',
] as const;
const SELECT_SESSION = SESSION_COLUMNS.map((c) => `s.${c} AS s_${c}`).join(', ');
/** What makes a session good at ?2, with its hash at ?1. */
const LIVE = 's.token_hash = ?1 AND s.revoked_at IS NULL AND s.expires_at > ?2 AND s.last_seen_at > ?3';

type Joined = UserRow & { [K in (typeof SESSION_COLUMNS)[number] as `s_${K}`]: SessionRow[K] | null };

/** A joined row taken apart; the session is null when the join found none (a LEFT JOIN). */
function split(row: Joined): SessionUser | { user: UserRow; session: null } {
  const user: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('s_')) session[k.slice(2)] = v;
    else user[k] = v;
  }
  return {
    user: user as unknown as UserRow,
    session: session.id === null || session.id === undefined ? null : (session as unknown as SessionRow),
  };
}

/** The hash a cookie's token is stored under, or null for a value no session could have. */
export async function tokenHash(token: string | null): Promise<string | null> {
  return token !== null && TOKEN.test(token) ? sha256Hex(token) : null;
}

/**
 * The good session this token belongs to, with its account, or null: one
 * `sessions JOIN users` read by token_hash, and none at all for a value
 * that is no token. An account that is suspended has no good session; one
 * being deleted does, and the caller decides what it reaches.
 */
export async function findSession(env: Env, token: string | null, now: number): Promise<SessionUser | null> {
  const hash = await tokenHash(token);
  if (!hash) return null;
  const row = await env.DB.prepare(
    `SELECT u.*, ${SELECT_SESSION} FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE ${LIVE} AND u.status IN ('active', 'deleting')`,
  )
    .bind(hash, now, now - SESSION_IDLE)
    .first<Joined>();
  if (!row) return null;
  const found = split(row);
  return found.session ? (found as SessionUser) : null;
}

/**
 * The owner's account, and their good session when this token is one: the
 * second lock on /admin/* (§2), in one read. Null when there is no owner
 * yet, and the first lock is enough alone; `session` null when there is an
 * owner but the cookie is not theirs (or not good, or the owner not
 * active), which is a 403 owner_session.
 */
export async function findOwner(
  env: Env,
  token: string | null,
  now: number,
): Promise<{ user: UserRow; session: SessionRow | null } | null> {
  const row = await env.DB.prepare(
    `SELECT u.*, ${SELECT_SESSION} FROM users u LEFT JOIN sessions s ON s.user_id = u.id AND ${LIVE}
     WHERE u.role = 'owner'`,
  )
    .bind(await tokenHash(token), now, now - SESSION_IDLE)
    .first<Joined>();
  if (!row) return null;
  const found = split(row);
  return { user: found.user, session: found.user.status === 'active' ? found.session : null };
}

/** Whether a session authenticated in the last ten minutes. */
export const recentAuth = (session: SessionRow, now: number): boolean => now - session.reauth_at < RECENT_AUTH;

/**
 * Write down that a session was used, if the last note is an hour old or
 * more, after the answer has gone (waitUntil). The condition is in the
 * statement too, so two requests that both find it due write it once.
 */
export function touch(env: Env, session: SessionRow, now: number, waitUntil: (p: Promise<unknown>) => void): void {
  if (now - session.last_seen_at < SEEN_EVERY) return;
  waitUntil(
    env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ? AND last_seen_at <= ?')
      .bind(now, session.id, now - SEEN_EVERY)
      .run()
      .catch((err: unknown) => console.error('session touch failed:', err)),
  );
}
