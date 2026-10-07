import type { Env } from '../env';
import { appOrigin, isLoopback } from '../env';
import { HttpError } from '../http';
import { clientIp } from './ratelimit';

/**
 * Turnstile (docs/accounts.md §6): what keeps scripts from registering and
 * from having codes mailed. The widget is rendered with an action - the
 * Join form's `register`, and `email-code` wherever a code is asked for or
 * sent again - and its token is checked here, once, with siteverify: it
 * must succeed, for APP_ORIGIN's host name and for the action the route
 * expects, so a token made on another site, or for another form, is no
 * good here.
 *
 * - A failed check is 403 turnstile; the client renders a fresh widget.
 * - siteverify out of reach (no answer, an error status, its own
 *   internal-error) is tried once more with the same idempotency key, so
 *   a token it did see is not spent twice, and then is 503 turnstile_down:
 *   our side's trouble, not the visitor's.
 * - No TURNSTILE_SECRET: on a loopback host every check passes (/api/config
 *   sends no site key, so the client renders no widget); anywhere else it
 *   is 503 not_configured, never a quiet pass.
 * - TURNSTILE_VERIFY_URL stands in for siteverify on a loopback host (the
 *   check suite's fake), and is ignored anywhere else.
 * - Cloudflare's published test secrets accept only their dummy token,
 *   whose answer names no real host and no action of ours; with one of
 *   those, success alone is asked, so staging can run on the test keys.
 *   They protect nothing, which is logged off loopback.
 */
export type TurnstileAction = 'register' | 'email-code';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Turnstile's own cap on a token. */
const MAX_TOKEN = 2048;
/** A siteverify that hangs must not hold the request with it. */
const TIMEOUT_MS = 5000;
/** Cloudflare's test secrets (developers.cloudflare.com/turnstile/troubleshooting/testing). */
const TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

/** Each misconfiguration is logged once per isolate, not on every request. */
const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(message);
}

const refused = (): HttpError => new HttpError('The Turnstile check failed; try again', 403, 'turnstile');
const down = (): HttpError =>
  new HttpError('Turnstile cannot be reached; try again in a moment', 503, 'turnstile_down');
const notConfigured = (): HttpError => new HttpError('Turnstile is not configured', 503, 'not_configured');

/** What siteverify answered, as much of it as is read. */
interface Verdict {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
  'error-codes'?: unknown;
}

/** One siteverify call: its verdict, or 'down' for no answer, an error status, a body that is not JSON. */
async function siteverify(endpoint: string, form: URLSearchParams): Promise<Verdict | 'down'> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return 'down';
    const verdict = (await res.json()) as Verdict | null;
    if (typeof verdict !== 'object' || verdict === null) return 'down';
    if (verdict.success !== true && errorCodes(verdict).includes('internal-error')) return 'down';
    return verdict;
  } catch {
    return 'down';
  }
}

function errorCodes(verdict: Verdict): string[] {
  const codes = verdict['error-codes'];
  return Array.isArray(codes) ? codes.filter((c): c is string => typeof c === 'string') : [];
}

/**
 * Check a Turnstile token for `action`, or throw: 403 turnstile when it is
 * not good, 503 turnstile_down when siteverify cannot say, 503
 * not_configured when nothing here can check it. The visitor's IP goes
 * with it as `remoteip` (and is kept nowhere); `idempotencyKey`, a UUID,
 * is made here when the caller has none.
 */
export async function verifyTurnstile(
  env: Env,
  request: Request,
  opts: { token: unknown; action: TurnstileAction; idempotencyKey?: string },
): Promise<void> {
  const local = isLoopback(new URL(request.url));
  const secret = env.TURNSTILE_SECRET?.trim();
  if (!secret) {
    if (local) return;
    warnOnce('secret', 'Turnstile refused every check: set TURNSTILE_SECRET');
    throw notConfigured();
  }
  const { token } = opts;
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN) throw refused();
  const test = TEST_SECRETS.has(secret);
  const app = appOrigin(env);
  if (!app && !test) {
    warnOnce('origin', 'Turnstile refused every check: APP_ORIGIN, whose host a token must name, is not set');
    throw notConfigured();
  }
  let endpoint = SITEVERIFY;
  if (env.TURNSTILE_VERIFY_URL) {
    if (local) endpoint = env.TURNSTILE_VERIFY_URL;
    else warnOnce('url', 'TURNSTILE_VERIFY_URL is set but ignored: it applies on localhost only');
  }
  const form = new URLSearchParams({
    secret,
    response: token,
    idempotency_key: opts.idempotencyKey ?? crypto.randomUUID(),
  });
  const ip = clientIp(request);
  if (ip !== 'unknown') form.set('remoteip', ip);

  let verdict = await siteverify(endpoint, form);
  if (verdict === 'down') verdict = await siteverify(endpoint, form);
  if (verdict === 'down') {
    console.error('Turnstile siteverify is out of reach');
    throw down();
  }
  if (verdict.success !== true) {
    const codes = errorCodes(verdict);
    if (codes.includes('missing-input-secret') || codes.includes('invalid-input-secret')) {
      warnOnce('invalid', 'Turnstile refused the secret: check TURNSTILE_SECRET');
      throw notConfigured();
    }
    throw refused();
  }
  if (test) {
    if (!local) warnOnce('test', 'TURNSTILE_SECRET is one of Cloudflare\'s test secrets: it keeps nobody out');
    return;
  }
  if (verdict.hostname !== new URL(app!).hostname || verdict.action !== opts.action) throw refused();
}
