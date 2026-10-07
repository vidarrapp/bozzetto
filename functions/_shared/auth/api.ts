import type { ErrorCode } from '../http';
import type { Principal, UserPrincipal } from '../principal';
import { HttpError, json, readJson } from '../http';

/**
 * What every accounts route (/api/auth/*, /api/me/*, the bootstrap) shares:
 * refusals as `{error, code}` (docs/accounts.md §3), JSON bodies read with
 * a cap, and the sign-in a route needs.
 */

/** The code a refusal without one is given, by its status. */
function codeFor(status: number): ErrorCode {
  switch (status) {
    case 401:
      return 'signin';
    case 404:
      return 'not_found';
    case 413:
      return 'file_too_large';
    case 415:
      return 'bad_type';
    case 429:
      return 'rate_limited';
    case 503:
      return 'not_configured';
    default:
      return 'bad_request';
  }
}

/**
 * Run an accounts route: a thrown HttpError answers as `{error, code}`,
 * given one by its status if it came without (readJson's, for one), with
 * whatever headers it carries (Retry-After, a cookie cleared), and
 * anything else is logged and answers 500.
 */
export function api(fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((e: unknown) => {
    if (e instanceof HttpError) return e.toResponse(e.code ?? codeFor(e.status));
    console.error(e);
    return json({ error: 'Internal error' }, 500, { 'cache-control': 'no-store' });
  });
}

/** A JSON answer no cache keeps: everything an accounts route says is someone's own. */
export function answer(data: unknown, status = 200): Response {
  return json(data, status, { 'cache-control': 'no-store' });
}

/** An empty answer, kept by no cache. */
export function noContent(): Response {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

/** The most an accounts route reads of a body: a passkey's response is a few kilobytes. */
const MAX_BODY = 64 * 1024;

/**
 * A request body that must be a JSON object, as readJson reads one
 * (application/json, which no other site can send without a preflight),
 * and no larger than `max`. With `optional`, a request with no body at all
 * - no type, nothing in it - is `{}`; one with a body is held to the rules.
 */
export async function readBody(
  request: Request,
  { optional = false, max = MAX_BODY }: { optional?: boolean; max?: number } = {},
): Promise<Record<string, unknown>> {
  const declared = request.headers.get('content-length');
  if (declared !== null && !(Number(declared) <= max)) throw new HttpError('Body too large', 413, 'file_too_large');
  if (optional && !request.headers.get('content-type') && (declared === null || Number(declared) === 0)) {
    const text = await capped(request, max);
    if (text.length === 0) return {};
    throw new HttpError('expected a JSON body (content-type: application/json)', 415, 'bad_type');
  }
  if (declared === null) {
    // No declared length (a chunked body): read no more than the cap, then
    // hand the text over as the body readJson parses.
    const text = await capped(request, max);
    return readJson(new Request(request.url, { method: 'POST', headers: request.headers, body: text }));
  }
  return readJson(request);
}

/** The body as text, refused once it passes `max` bytes rather than read whole first. */
async function capped(request: Request, max: number): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError('Body too large', 413, 'file_too_large');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * The signed-in account asking, or a 401 signin: the client opens the
 * sign-in dialog. A suspended account's cookie is 403 suspended instead,
 * since signing in again would not help.
 */
export function requireUser(principal: Principal): UserPrincipal {
  if (principal.kind === 'user') return principal;
  if (principal.kind === 'guest' && principal.refused === 'suspended') {
    throw new HttpError('This account is suspended', 403, 'suspended');
  }
  throw new HttpError('Sign in first', 401, 'signin');
}

/**
 * The same, authenticated in the last ten minutes, or a 401 reauth: the
 * client asks for the passkey (or a code) again, then retries.
 */
export function requireRecentAuth(principal: Principal): UserPrincipal {
  const p = requireUser(principal);
  if (!p.recentAuth) throw new HttpError('Confirm it is you first', 401, 'reauth');
  return p;
}
