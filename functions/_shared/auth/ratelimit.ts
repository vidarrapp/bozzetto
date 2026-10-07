import type { Env } from '../env';
import { HttpError } from '../http';
import { hmacHex } from '../crypto';

/**
 * Fixed-window rate limits (docs/accounts.md §3), counted in rate_limits.
 *
 * A bucket is the limit's name and an HMAC of what it counts by - an IP,
 * the address a mail would go to, or a handle - under AUTH_SECRET, cut to
 * 128 bits: the table never holds an IP or an address, and nobody without
 * the secret can tell whose a bucket is. A window is named by the time it starts (a
 * day's at midnight UTC), so rows of every limit age alike; they are kept
 * 48 hours. Counting is one upsert that answers the new count.
 */
export interface Limit {
  /** The bucket's prefix: one per thing limited. */
  name: string;
  /** How many a window allows. */
  max: number;
  windowMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Passkey options (sign-in, reauthentication, a new passkey): 60 per 10 minutes per IP. */
export const PASSKEY_OPTIONS: Limit = { name: 'passkey-options', max: 60, windowMs: 10 * MINUTE };
/** Sign-in options naming a handle (the dialog's fallback): 20 per 10 minutes per handle, beside the IP's. */
export const PASSKEY_HANDLE: Limit = { name: 'passkey-handle', max: 20, windowMs: 10 * MINUTE };
/** Handle checks (GET /api/auth/handle): 60 per 10 minutes per IP. */
export const HANDLE_CHECKS: Limit = { name: 'handle', max: 60, windowMs: 10 * MINUTE };
/**
 * Mail someone asked for (a code, or the notice that an address has an
 * account already), per address it would go to: 3 per 15 minutes...
 */
export const MAIL_PER_ADDRESS: Limit = { name: 'mail-address', max: 3, windowMs: 15 * MINUTE };
/** ...and 10 per day. */
export const MAIL_PER_ADDRESS_DAY: Limit = { name: 'mail-address-day', max: 10, windowMs: DAY };
/** The same, per IP asking: 10 per hour. */
export const MAIL_PER_IP: Limit = { name: 'mail-ip', max: 10, windowMs: HOUR };
/**
 * Every mail the site sends, notices included, per UTC day: Resend's free
 * tier allows 100. Past it, 503 mail_paused rather than 429 (mail.ts).
 */
export const MAIL_ALL: Limit = { name: 'mail-all', max: 90, windowMs: DAY };
/**
 * Codes and sign-in links checked, per IP: 30 per 10 minutes. Each flow
 * allows 5 attempts besides (pending_auth.attempts).
 */
export const CODE_CHECKS: Limit = { name: 'code-checks', max: 30, windowMs: 10 * MINUTE };
/** Registrations begun (POST /api/auth/register/start), per IP: 5 per hour. */
export const REGISTRATIONS: Limit = { name: 'register', max: 5, windowMs: HOUR };
/** Invite checks (POST /api/auth/invite/check), per IP: 20 per hour. */
export const INVITE_CHECKS: Limit = { name: 'invite-check', max: 20, windowMs: HOUR };

/** How long a window's row is kept after it starts. */
const KEEP = 48 * HOUR;
/** The share of new windows that also sweep the expired rows: often enough to keep the table small. */
const SWEEP_SHARE = 0.05;
/**
 * Whether this isolate has swept yet. Its first new window always does:
 * on a quiet site isolates rarely outlive a request, so rows still go
 * close to 48 hours after they start, while a busy one sweeps by share.
 */
let swept = false;

/** AUTH_SECRET, or a 503: without it nothing can be keyed, and nothing is counted in the clear instead. */
export function authSecret(env: Env): string {
  const secret = env.AUTH_SECRET;
  if (!secret) {
    console.error('Accounts need AUTH_SECRET');
    throw new HttpError('Accounts are not configured', 503, 'not_configured');
  }
  return secret;
}

/** The address a request came from, as Cloudflare reports it (locally, miniflare). */
export function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

/** Where a window stands for one key: how many it has counted, and the seconds until it ends. */
export interface Tally {
  count: number;
  retryAfter: number;
}

async function bucketOf(env: Env, limit: Limit, key: string): Promise<string> {
  return `${limit.name}:${await hmacHex(authSecret(env), key, 16)}`;
}

function windowOf(limit: Limit, now: number): { win: number; retryAfter: number } {
  const win = now - (now % limit.windowMs);
  return { win, retryAfter: Math.max(1, Math.ceil((win + limit.windowMs - now) / 1000)) };
}

/**
 * Count one more against `limit` for `key` at `now`, and answer where the
 * window stands. A new window may sweep the rows past 48 hours, after the
 * answer has gone (waitUntil).
 */
export async function countOne(
  env: Env,
  limit: Limit,
  key: string,
  now: number,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Tally> {
  const bucket = await bucketOf(env, limit, key);
  const { win, retryAfter } = windowOf(limit, now);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, win, count) VALUES (?, ?, 1)
     ON CONFLICT (bucket, win) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(bucket, win)
    .first<{ count: number }>();
  const count = row?.count ?? 1;
  if (count === 1 && waitUntil && (!swept || Math.random() < SWEEP_SHARE)) {
    swept = true;
    waitUntil(
      env.DB.prepare('DELETE FROM rate_limits WHERE win < ?')
        .bind(now - KEEP)
        .run()
        .catch((err: unknown) => console.error('rate limit sweep failed:', err)),
    );
  }
  return { count, retryAfter };
}

/** Where the window stands for `key`, without counting anything. */
export async function peekCount(env: Env, limit: Limit, key: string, now: number): Promise<Tally> {
  const { win, retryAfter } = windowOf(limit, now);
  const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE bucket = ? AND win = ?')
    .bind(await bucketOf(env, limit, key), win)
    .first<{ count: number }>();
  return { count: row?.count ?? 0, retryAfter };
}

/** A 429 rate_limited, with Retry-After and `retryAfter`, the seconds until it is worth asking again. */
export function tooMany(retryAfter: number, extra: Record<string, unknown> = {}, message = 'Too many requests; try again later'): HttpError {
  return new HttpError(message, 429, 'rate_limited', { ...extra, retryAfter }, { 'retry-after': String(retryAfter) });
}

/**
 * Count one more against `limit` for `key` at `now`; null while within it,
 * else a 429 rate_limited with Retry-After, the seconds until the window
 * ends. What is refused still counts: a client that keeps asking stays
 * refused until the window ends, not one request past it.
 */
export async function rateLimit(
  env: Env,
  limit: Limit,
  key: string,
  now: number,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response | null> {
  const { count, retryAfter } = await countOne(env, limit, key, now, waitUntil);
  return count <= limit.max ? null : tooMany(retryAfter).toResponse();
}

/** The same, thrown: the 429 for an accounts route's api() to answer. */
export async function enforce(
  env: Env,
  limit: Limit,
  key: string,
  now: number,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<void> {
  const { count, retryAfter } = await countOne(env, limit, key, now, waitUntil);
  if (count > limit.max) throw tooMany(retryAfter);
}
