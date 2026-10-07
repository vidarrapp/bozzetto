import type { Env } from '../env';
import { HttpError } from '../http';
import { hmacHex, randomToken, sha256Hex } from '../crypto';
import { authSecret } from './ratelimit';
import { FLOW_COOKIE, clearFlow, readCookie } from './session';

/**
 * Email codes (docs/accounts.md §3): a flow is one address, one purpose,
 * and the code mailed for it, bound to the browser that asked.
 *
 * The browser holds `__Host-bz_flow` (32 random bytes, SameSite=Strict);
 * pending_auth keeps the flow (kind 'email') under that token's SHA-256,
 * which is the flow's id. The code is never stored, only
 * HMAC-SHA256(AUTH_SECRET, `${id}:${code}`), so a copy of the database
 * holds no code, and a code is good only with the cookie of the flow it
 * was made for. A flow begun with link: true keeps the SHA-256 of a
 * second token as well, mailed as a sign-in link that works the same way.
 *
 * A code lasts 10 minutes. Each check counts an attempt before anything is
 * compared, at most 5 to a code; a match consumes the flow. A resend makes
 * a new code (and link), at most 3 sends to a flow, 60 s apart, and the
 * new code has its own 10 minutes and 5 attempts.
 */
export type FlowPurpose = 'register' | 'sign_in' | 'reauth' | 'change_email';

const MINUTE = 60_000;
/** How long a code (and its link) is good for. */
export const CODE_TTL = 10 * MINUTE;
/** How long after a send the next may be asked for. */
export const RESEND_AFTER = 60_000;
/** The most codes a flow sends: the first and two more. */
export const MAX_SENDS = 3;
/** The most checks a code allows, wrong or right. */
export const MAX_ATTEMPTS = 5;
/** A flow cookie's token, or a link's: 32 bytes as base64url. */
export const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The largest multiple of a million below 2^32: draws at or above it are thrown back. */
const DRAW_LIMIT = 4_294_000_000;

/** A code: six digits, 000000-999999, each as likely, from crypto.getRandomValues. */
export function newCode(): string {
  const draw = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(draw);
    if (draw[0] < DRAW_LIMIT) return String(draw[0] % 1_000_000).padStart(6, '0');
  }
}

/** A code as typed - spaces and dashes between digits are fine, as the mail spaces it - or null unless six digits remain. */
export function readCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 32) return null;
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** What pending_auth keeps of a code. */
export function codeSecret(env: Env, flowId: string, code: string): Promise<string> {
  return hmacHex(authSecret(env), `${flowId}:${code}`);
}

/** The flow cookie's token, when it is one a flow could have. */
export function flowToken(request: Request): string | null {
  const token = readCookie(request, FLOW_COOKIE);
  return token !== null && TOKEN.test(token) ? token : null;
}

/** The id of the flow this browser's cookie names, or null. */
export async function flowIdOf(request: Request): Promise<string | null> {
  const token = flowToken(request);
  return token ? sha256Hex(token) : null;
}

/** A flow as pending_auth keeps it. */
export interface FlowRow {
  id: string;
  purpose: FlowPurpose;
  /** The account it is for: the one signing in, re-authenticating or changing address; null for a registration, or an address with no account. */
  user_id: string | null;
  /** Where the code goes: the address signing in or registering, the account's own, or its new one. */
  email: string;
  /** A registration's handle. */
  handle: string | null;
  invite_id: string | null;
  secret: string;
  link_hash: string | null;
  attempts: number;
  sends: number;
  created_at: number;
  expires_at: number;
}

const COLUMNS = 'id, purpose, user_id, email, handle, invite_id, secret, link_hash, attempts, sends, created_at, expires_at';

/**
 * The refusal for a flow that cannot be completed - expired, used, spent,
 * never begun - with its cookie cleared. With `clear` false, for a flow
 * that is there but not this request's to complete (another purpose,
 * another account's, no link mailed): the cookie stays, so the code the
 * browser is waiting for still works where it belongs.
 */
export function flowExpired(clear = true): HttpError {
  return new HttpError(
    'This code has expired; ask for a new one',
    410,
    'flow_expired',
    {},
    clear ? { 'set-cookie': clearFlow() } : {},
  );
}

/** A flow about to begin. */
export interface NewFlow {
  purpose: FlowPurpose;
  userId: string | null;
  email: string;
  handle?: string | null;
  inviteId?: string | null;
  /** Mail a sign-in link beside the code (desktop browsers). */
  link: boolean;
}

/** A flow just begun: its cookie's token, its id, its code and link token (to mail), and when the code expires. */
export interface BegunFlow {
  token: string;
  id: string;
  code: string;
  linkToken: string | null;
  sends: number;
  expiresAt: number;
}

/**
 * Begin a flow at `now`: store it under a new token's hash with a new
 * code (and link). The flow this browser had going is dropped, and so is
 * every one, of anyone's, whose time is up.
 */
export async function beginFlow(env: Env, request: Request, now: number, flow: NewFlow): Promise<BegunFlow> {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const code = newCode();
  const linkToken = flow.link ? randomToken(32) : null;
  const expiresAt = now + CODE_TTL;
  const statements: D1PreparedStatement[] = [];
  const previous = await flowIdOf(request);
  if (previous) statements.push(env.DB.prepare("DELETE FROM pending_auth WHERE id = ? AND kind = 'email'").bind(previous));
  statements.push(
    env.DB.prepare("DELETE FROM pending_auth WHERE kind = 'email' AND expires_at <= ?").bind(now),
    env.DB.prepare(
      `INSERT INTO pending_auth (id, kind, purpose, user_id, email, handle, invite_id, secret, link_hash, attempts, sends, created_at, expires_at)
       VALUES (?, 'email', ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
    ).bind(
      id,
      flow.purpose,
      flow.userId,
      flow.email,
      flow.handle ?? null,
      flow.inviteId ?? null,
      await codeSecret(env, id, code),
      linkToken ? await sha256Hex(linkToken) : null,
      now,
      expiresAt,
    ),
  );
  await env.DB.batch(statements);
  return { token, id, code, linkToken, sends: 1, expiresAt };
}

/** The flow this id names while it can still be used at `now`: not expired, and its attempts not spent. */
export async function liveFlow(env: Env, id: string, now: number): Promise<FlowRow | null> {
  return env.DB.prepare(
    `SELECT ${COLUMNS} FROM pending_auth WHERE id = ? AND kind = 'email' AND expires_at > ? AND attempts < ?`,
  )
    .bind(id, now, MAX_ATTEMPTS)
    .first<FlowRow>();
}

/**
 * A new code (and link, if the flow mails one) for a live flow, counted as
 * one more send, with its own 10 minutes and 5 attempts. Null when the
 * flow changed under it: another resend, a check, its time running out.
 */
export async function renewFlow(
  env: Env,
  flow: FlowRow,
  now: number,
): Promise<{ code: string; linkToken: string | null; sends: number; expiresAt: number } | null> {
  const code = newCode();
  const linkToken = flow.link_hash ? randomToken(32) : null;
  const expiresAt = now + CODE_TTL;
  const { meta } = await env.DB.prepare(
    `UPDATE pending_auth SET secret = ?, link_hash = ?, sends = sends + 1, attempts = 0, expires_at = ?
     WHERE id = ? AND kind = 'email' AND sends = ? AND attempts < ? AND expires_at > ?`,
  )
    .bind(
      await codeSecret(env, flow.id, code),
      linkToken ? await sha256Hex(linkToken) : null,
      expiresAt,
      flow.id,
      flow.sends,
      MAX_ATTEMPTS,
      now,
    )
    .run();
  return meta.changes ? { code, linkToken, sends: flow.sends + 1, expiresAt } : null;
}

/** Which flows a check may be made on: by purpose, and for an account's own flows, whose. */
export interface FlowMatch {
  purposes: FlowPurpose[];
  /** The account asking: its reauth and change_email flows match, nobody else's. */
  userId?: string;
  /** A link is checked: only flows that mailed one. */
  link?: boolean;
}

/**
 * Count one attempt at the flow `id` names, before anything is compared,
 * and answer it as it stands - or null when there is no live flow there
 * that `match` allows, which then costs it nothing.
 */
export async function attemptFlow(env: Env, id: string, now: number, match: FlowMatch): Promise<FlowRow | null> {
  const open = match.purposes.filter((p) => p === 'register' || p === 'sign_in');
  const owned = match.userId ? match.purposes.filter((p) => p === 'reauth' || p === 'change_email') : [];
  const alternatives: string[] = [];
  const binds: unknown[] = [id, now, MAX_ATTEMPTS];
  if (open.length > 0) {
    alternatives.push(`purpose IN (${open.map(() => '?').join(', ')})`);
    binds.push(...open);
  }
  if (owned.length > 0) {
    alternatives.push(`(purpose IN (${owned.map(() => '?').join(', ')}) AND user_id = ?)`);
    binds.push(...owned, match.userId);
  }
  if (alternatives.length === 0) return null;
  return env.DB.prepare(
    `UPDATE pending_auth SET attempts = attempts + 1
     WHERE id = ? AND kind = 'email' AND expires_at > ? AND attempts < ?
       AND (${alternatives.join(' OR ')})${match.link ? ' AND link_hash IS NOT NULL' : ''}
     RETURNING ${COLUMNS}`,
  )
    .bind(...binds)
    .first<FlowRow>();
}

/** Take a flow for good: deleted, and answered, by whichever request gets there first; null for the rest. */
export async function consumeFlow(env: Env, id: string): Promise<FlowRow | null> {
  return env.DB.prepare(`DELETE FROM pending_auth WHERE id = ? AND kind = 'email' RETURNING ${COLUMNS}`)
    .bind(id)
    .first<FlowRow>();
}

/** Drop a flow that can come to nothing any more. */
export async function dropFlow(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM pending_auth WHERE id = ? AND kind = 'email'").bind(id).run();
}
