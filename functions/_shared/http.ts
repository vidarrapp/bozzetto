import type { Env } from './types';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export class HttpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Wrap a handler so thrown HttpErrors become clean JSON responses. */
export function handle(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((e: unknown) => {
    if (e instanceof HttpError) return error(e.message, e.status);
    console.error(e);
    return error('Internal error', 500);
  });
}

/**
 * The authenticated admin email, or null. Cloudflare Access injects
 * `Cf-Access-Authenticated-User-Email` on protected routes; an optional
 * ADMIN_EMAILS allowlist narrows it further.
 *
 * That header is only unforgeable while an Access application actually
 * fronts the route - drop the application (or miss a hostname) and any
 * client can send it. With ACCESS_TEAM_DOMAIN + ACCESS_AUD configured the
 * gate verifies the `Cf-Access-Jwt-Assertion` JWT instead: RS256 against
 * the team's published keys, audience, issuer and expiry, and the email
 * claim must match the header. Without them the header is trusted as
 * before, so an existing deployment keeps working until the vars land.
 * With only ONE of them set the gate fails closed: a half-finished
 * configuration must not silently fall back to trusting a forgeable header.
 */
export async function adminEmail(request: Request, env: Env): Promise<string | null> {
  // Local-dev escape hatch. Set DEV_ADMIN="true" only in a local wrangler.toml
  // (gitignored); production has no such var, so this never fires there.
  if (env.DEV_ADMIN === 'true') return 'dev@localhost';

  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (!email) return null;
  if (env.ACCESS_TEAM_DOMAIN || env.ACCESS_AUD) {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
      throw new HttpError('Access verification is half-configured: set both ACCESS_TEAM_DOMAIN and ACCESS_AUD', 503);
    }
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!jwt) return null;
    const claimed = await verifyAccessJwt(jwt, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
    if (!claimed || claimed.toLowerCase() !== email.toLowerCase()) return null;
  }
  const allow = env.ADMIN_EMAILS?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow && allow.length > 0 && !allow.includes(email.toLowerCase())) return null;
  return email;
}

/** Returns a 403 Response if the request is not an allowed admin, else null. */
export async function requireAdmin(request: Request, env: Env): Promise<Response | null> {
  return (await adminEmail(request, env)) ? null : error('Unauthorized', 403);
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

function teamHost(teamDomain: string): string {
  return teamDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

async function fetchAccessKeys(host: string): Promise<Jwk[]> {
  const res = await fetch(`https://${host}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError('Access keys unavailable', 503);
  const body = (await res.json()) as { keys?: Jwk[] };
  jwksCache = { host, keys: body.keys ?? [], fetchedAt: Date.now() };
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
