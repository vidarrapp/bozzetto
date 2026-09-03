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
 */
export async function adminEmail(request: Request, env: Env): Promise<string | null> {
  // Local-dev escape hatch. Set DEV_ADMIN="true" only in a local wrangler.toml
  // (gitignored); production has no such var, so this never fires there.
  if (env.DEV_ADMIN === 'true') return 'dev@localhost';

  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (!email) return null;
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
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

async function accessKeys(teamDomain: string): Promise<Jwk[]> {
  const host = teamDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (jwksCache && jwksCache.host === host && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(`https://${host}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError('Access keys unavailable', 503);
  const body = (await res.json()) as { keys?: Jwk[] };
  jwksCache = { host, keys: body.keys ?? [], fetchedAt: Date.now() };
  return jwksCache.keys;
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
 * a 403 and an attacker learns nothing about which check failed.
 */
async function verifyAccessJwt(token: string, teamDomain: string, aud: string): Promise<string | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(b64url(parts[0]))) as { alg?: string; kid?: string };
    if (header.alg !== 'RS256' || !header.kid) return null;
    const keys = await accessKeys(teamDomain);
    const jwk = keys.find((k) => k.kid === header.kid);
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
    const host = teamDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (claims.iss !== `https://${host}`) return null;
    const now = Math.floor(Date.now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp < now) return null;
    if (typeof claims.nbf === 'number' && claims.nbf > now + 60) return null;
    return typeof claims.email === 'string' && claims.email ? claims.email : null;
  } catch {
    return null;
  }
}
