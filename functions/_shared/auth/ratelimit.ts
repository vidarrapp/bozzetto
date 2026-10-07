import type { Env } from '../env';
import { HttpError, refuse } from '../http';
import { hmacHex } from '../crypto';

/**
 * Fixed-window rate limits (docs/accounts.md §3), counted in rate_limits.
 *
 * A bucket is the limit's name and an HMAC of what it counts by (an IP
 * here; an address, for the mail limits of Batch 4) under AUTH_SECRET,
 * cut to 128 bits: the table never holds an IP or an address, and nobody
 * without the secret can tell whose a bucket is. A window is named by the
 * time it starts, so rows of every limit age alike; they are kept 48 hours.
 * Counting is one upsert that answers the new count.
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

/** Passkey options (sign-in, reauthentication, a new passkey): 60 per 10 minutes per IP. */
export const PASSKEY_OPTIONS: Limit = { name: 'passkey-options', max: 60, windowMs: 10 * MINUTE };
/** Handle checks (GET /api/auth/handle): 60 per 10 minutes per IP. */
export const HANDLE_CHECKS: Limit = { name: 'handle', max: 60, windowMs: 10 * MINUTE };

/** How long a window's row is kept after it starts. */
const KEEP = 48 * HOUR;
/** The share of new windows that also sweep the expired rows: often enough to keep the table small. */
const SWEEP_SHARE = 0.05;

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
  const bucket = `${limit.name}:${await hmacHex(authSecret(env), key, 16)}`;
  const win = now - (now % limit.windowMs);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, win, count) VALUES (?, ?, 1)
     ON CONFLICT (bucket, win) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(bucket, win)
    .first<{ count: number }>();
  const count = row?.count ?? 1;
  if (count === 1 && waitUntil && Math.random() < SWEEP_SHARE) {
    waitUntil(
      env.DB.prepare('DELETE FROM rate_limits WHERE win < ?')
        .bind(now - KEEP)
        .run()
        .catch((err: unknown) => console.error('rate limit sweep failed:', err)),
    );
  }
  if (count <= limit.max) return null;
  const retryAfter = Math.max(1, Math.ceil((win + limit.windowMs - now) / 1000));
  return withRetryAfter(
    refuse(429, 'rate_limited', 'Too many requests; try again later', { retryAfter }),
    retryAfter,
  );
}

function withRetryAfter(response: Response, seconds: number): Response {
  response.headers.set('retry-after', String(seconds));
  return response;
}
