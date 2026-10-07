import type { Env } from './env';
import { accountsOn, isLoopback } from './env';

/**
 * Every JSON answer is sent with nosniff, so no browser ever reads one as
 * HTML or script, whatever a stored title in it happens to look like.
 */
export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/**
 * What a refusal can say it is (docs/accounts.md §3). The routes that came
 * before accounts answer `{error}` alone, as they always have; everything
 * since adds one of these, which the client acts on - the text is for a
 * person.
 */
export type ErrorCode =
  | 'bad_request'
  | 'code_invalid'
  | 'signin'
  | 'reauth'
  | 'cross_site'
  | 'turnstile'
  | 'suspended'
  | 'owner_session'
  | 'not_found'
  | 'owner_exists'
  | 'handle_taken'
  | 'invite_invalid'
  | 'flow_expired'
  | 'file_too_large'
  | 'quota_exceeded'
  | 'bad_type'
  | 'bad_scene'
  | 'rate_limited'
  | 'accounts_off'
  | 'not_configured'
  | 'mail_paused'
  | 'not_implemented';

/** A refusal as `{error, code}`, plus whatever the code carries. No cache keeps one. */
export function refuse(
  status: number,
  code: ErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return json({ ...extra, error: message, code }, status, { 'cache-control': 'no-store' });
}

/**
 * Refuse a body the client declares as larger than `max` before a byte of
 * it is read, and - for the binary uploads - insist on the declaration:
 * without it a chunked upload is buffered whole before any cap applies.
 */
export function bodyLimit(request: Request, max: number, required = false): Response | null {
  const raw = request.headers.get('content-length');
  if (raw === null) return required ? error('Content-Length required', 411) : null;
  const declared = Number(raw);
  if (!Number.isFinite(declared) || declared > max) return error('body too large', 413);
  return null;
}

export class HttpError extends Error {
  /** With a code, it answers as `refuse` does, `extra` and all; without, as `error`. */
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: ErrorCode,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Wrap a handler so thrown HttpErrors become clean JSON responses. */
export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((e: unknown) => {
    if (e instanceof HttpError) return e.code ? refuse(e.status, e.code, e.message, e.extra) : error(e.message, e.status);
    console.error(e);
    return error('Internal error', 500);
  });
}

/**
 * A request body that must be a JSON object. The type is required, not
 * sniffed: a page on another site can send text/plain or a form without
 * asking first, but application/json makes the browser ask (a CORS
 * preflight), and nothing here answers one. A body that does not parse,
 * or parses to something other than an object, is the client's mistake
 * and a 400, not an internal error.
 */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError('expected a JSON body (content-type: application/json)', 415);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError('malformed JSON body');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError('expected a JSON object');
  return body as Record<string, unknown>;
}

/** Each misconfiguration is logged once per isolate, not on every request. */
let devAdminWarned = false;
let unverifiedWarned = false;

/**
 * The authenticated admin email, or null. Cloudflare Access injects
 * `Cf-Access-Authenticated-User-Email` on protected routes; an optional
 * ADMIN_EMAILS allowlist narrows it further (unset, anyone Access let in
 * is the owner: the Access policy already decides who that can be).
 *
 * That header is only unforgeable while an Access application actually
 * fronts the route - drop the application, or miss a hostname, and any
 * client can send it. So on any host but this machine's own the gate
 * verifies the `Cf-Access-Jwt-Assertion` JWT as well: RS256 against the
 * team's published keys, audience, issuer and expiry, and its email claim
 * must match the header. That needs ACCESS_TEAM_DOMAIN and ACCESS_AUD, and
 * without both every admin request is a 503: a missing variable must
 * never quietly fall back to trusting a header anyone can send.
 *
 * Only on a loopback host is the header taken alone, since Access is never
 * there to sign a token and only this machine can reach it. DEV_ADMIN,
 * which skips identity altogether, is honoured there and nowhere else.
 */
export async function adminEmail(request: Request, env: Env): Promise<string | null> {
  const url = new URL(request.url);
  // An identity is only worth anything where Access fronts the path. The
  // router matches paths case-insensitively, so /ADMIN/api/... reaches the
  // same Function; Access normalises today, but nothing here relies on it.
  if (!url.pathname.startsWith('/admin/')) return null;
  const local = isLoopback(url);

  if (env.DEV_ADMIN === 'true') {
    if (local) return 'dev@localhost';
    if (!devAdminWarned) {
      devAdminWarned = true;
      console.warn('DEV_ADMIN is set but ignored: it applies on localhost only');
    }
  }

  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (!local) {
    const team = env.ACCESS_TEAM_DOMAIN;
    const aud = env.ACCESS_AUD;
    if (!team || !aud) {
      // The variable names go to the log, not to whoever is asking.
      if (!unverifiedWarned) {
        unverifiedWarned = true;
        console.error('Admin routes refused: set both ACCESS_TEAM_DOMAIN and ACCESS_AUD');
      }
      throw new HttpError('Access verification is not configured', 503);
    }
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!email || !jwt) return null;
    const claimed = await verifyAccessJwt(jwt, team, aud);
    if (!claimed || claimed.toLowerCase() !== email.toLowerCase()) return null;
  }
  if (!email) return null;
  const allow = env.ADMIN_EMAILS?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow && allow.length > 0 && !allow.includes(email.toLowerCase())) return null;
  return email;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A write another site's page made the browser send. The Access cookie
 * rides along with such a request like any other, so the session alone
 * proves nothing about who asked. Browsers say where a request came from,
 * and a write is refused when Sec-Fetch-Site or Origin names anywhere but
 * this origin. Sec-Fetch-Site `none` is a request no page started (an
 * address typed, the desktop app's main process); one with neither header
 * (the desktop app, curl) is no browser acting for a page, and the cookie
 * or the token decides as before.
 *
 * The root middleware asks this of every request a Function sees, before
 * any route runs, so no write anywhere is reachable without it. `same-site`
 * is refused too: the files host is a sibling of the app's.
 */
export function crossSiteWrite(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
  const site = request.headers.get('Sec-Fetch-Site');
  if (site !== null && site !== 'same-origin' && site !== 'none') return true;
  const origin = request.headers.get('Origin');
  return origin !== null && origin !== new URL(request.url).origin;
}

/**
 * The answer of every /api/auth/* and /api/me/* route until the batch that
 * brings it (docs/accounts.md §12). With accounts off those routes are not
 * there, and say why: 404 accounts_off, as they will once they exist. With
 * accounts on, a 501, so a staging run never mistakes a stub for a refusal.
 */
export function notYet(env: Env): Response {
  return accountsOn(env)
    ? refuse(501, 'not_implemented', 'Not implemented yet')
    : refuse(404, 'accounts_off', 'Accounts are off');
}

// --- Access JWT verification ------------------------------------------------

interface Jwk extends JsonWebKey {
  kid?: string;
}

/** Team public keys, cached per isolate (Access rotates them rarely). */
let jwksCache: { host: string; keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;
/**
 * How often an UNKNOWN kid may force a refetch inside the TTL. Access
 * rotates its signing keys, and the first token signed by a new key must
 * not be refused for an hour because the old set is cached - but an
 * attacker sending made-up kids must not be able to turn every request
 * into a fetch either.
 */
const JWKS_MISS_REFETCH_MS = 60 * 1000;
/** A key server that hangs must not hold every admin request with it. */
const JWKS_TIMEOUT_MS = 5000;

function teamHost(teamDomain: string): string {
  return teamDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/**
 * The team's current keys. Any failure to get them - an error status, a
 * timeout, no connection, a body that is not JSON - is an outage on our
 * side and a 503, never a refusal that would read as "not the owner".
 */
async function fetchAccessKeys(host: string): Promise<Jwk[]> {
  let body: { keys?: unknown } | null;
  try {
    const res = await fetch(`https://${host}/cdn-cgi/access/certs`, {
      signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    body = (await res.json()) as { keys?: unknown } | null;
  } catch (err) {
    console.error('Access keys unavailable:', err);
    throw new HttpError('Access keys unavailable', 503);
  }
  jwksCache = { host, keys: Array.isArray(body?.keys) ? (body.keys as Jwk[]) : [], fetchedAt: Date.now() };
  return jwksCache.keys;
}

/** The key with this kid: from the cache, or after one refetch on a miss. */
async function accessKey(teamDomain: string, kid: string): Promise<Jwk | null> {
  const host = teamHost(teamDomain);
  const fresh = jwksCache && jwksCache.host === host && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  let keys = fresh ? jwksCache!.keys : await fetchAccessKeys(host);
  let key = keys.find((k) => k.kid === kid);
  if (!key && fresh && Date.now() - jwksCache!.fetchedAt > JWKS_MISS_REFETCH_MS) {
    keys = await fetchAccessKeys(host);
    key = keys.find((k) => k.kid === kid);
  }
  return key ?? null;
}

function b64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Verify an Access application token and return its email claim, or null.
 * Any malformed input is a null, never a throw: the caller turns null into
 * a 403 and an attacker learns nothing about which check failed. The one
 * exception is the key set being unreachable, which is an outage on our
 * side and reports as a 503 rather than masquerading as a refusal.
 */
async function verifyAccessJwt(token: string, teamDomain: string, aud: string): Promise<string | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(b64url(parts[0]))) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return null;
    const jwk = await accessKey(teamDomain, header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64url(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64url(parts[1]))) as {
      aud?: string | string[];
      iss?: string;
      exp?: number;
      nbf?: number;
      email?: string;
    };
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(aud)) return null;
    if (claims.iss !== `https://${teamHost(teamDomain)}`) return null;
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp < now) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > now + 60) return null;
    return typeof claims.email === 'string' && claims.email ? claims.email : null;
  } catch (err) {
    if (err instanceof HttpError) throw err; // the key set is down: say so
    return null;
  }
}
