/**
 * The bindings and variables the Functions run with. Only DB and BUCKET
 * are required; every variable is optional, and what each one's absence
 * means is said beside it. Accounts (docs/accounts.md) stay off until
 * ACCOUNTS_ENABLED says otherwise, whatever else is set, so the variables
 * for them can be set ahead of the switch.
 */
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  /**
   * Optional comma-separated allowlist of admin emails (from Access). Unset,
   * any identity the Access policy let in is the owner.
   */
  ADMIN_EMAILS?: string;
  /**
   * Local-dev only: when "true", treats every admin request on a loopback
   * host (localhost, 127.0.0.1, [::1]) as the owner. Ignored on any other.
   */
  DEV_ADMIN?: string;
  /**
   * Required on every host but a loopback one: admin routes verify the
   * Access JWT (`Cf-Access-Jwt-Assertion`) against the team's public keys
   * rather than trust the email header, which is only unforgeable while an
   * Access application actually fronts the route, and answer 503 while
   * either is missing. TEAM_DOMAIN is the `<team>.cloudflareaccess.com`
   * host; AUD is the application's audience tag.
   */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;

  /**
   * "true" turns accounts on. Unset (or anything else), the site is 0.5.5
   * with templates: the owner signs in through Access alone, everyone else
   * is a guest, and /api/auth/* and /api/me/* are not found.
   */
  ACCOUNTS_ENABLED?: string;
  /** The app's own origin, `https://bozzetto.vidarrapp.se`: what WebAuthn and Turnstile check against. */
  APP_ORIGIN?: string;
  /** The WebAuthn relying party, the app's host name: `bozzetto.vidarrapp.se`. */
  RP_ID?: string;
  /**
   * The origin public files are served from, `https://files.vidarrapp.se`:
   * a second custom domain on this project, where nothing but GET /m/* is
   * answered. Unset (local, tests, previews), public files come from this
   * origin's own /m/.
   */
  MEDIA_ORIGIN?: string;
  /** Keys every HMAC: email codes, rate-limit buckets. A secret; `openssl rand -base64 32`. */
  AUTH_SECRET?: string;
  /** Turnstile's widget key, sent to the client only while TURNSTILE_SECRET is set too. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  /** Loopback only: where Turnstile tokens are verified, so the tests can stand in for Cloudflare. */
  TURNSTILE_VERIFY_URL?: string;
  /** Resend's API key. Unset, mail goes to dev_outbox on loopback and is refused elsewhere. */
  RESEND_API_KEY?: string;
  /** The sender, `Bozzetto <login@vidarrapp.se>`. */
  MAIL_FROM?: string;
  /**
   * Loopback only: when "true", the test hooks answer - the X-Test-Now
   * clock and the /api/dev/* routes. Ignored on any other host.
   */
  DEV_TEST_HOOKS?: string;
}

/**
 * A variable set to true. Pages hands every variable over as a string, but
 * a wrangler.toml may say `true` bare, which arrives as a boolean.
 */
function flag(v: unknown): boolean {
  return v === true || v === 'true';
}

/** Whether accounts are on: ACCOUNTS_ENABLED set to "true", and nothing else. */
export function accountsOn(env: Env): boolean {
  return flag(env.ACCOUNTS_ENABLED);
}

/** Hosts only this machine can reach: `wrangler pages dev` and the check suite. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLoopback(url: URL): boolean {
  return LOOPBACK.has(url.hostname);
}

/** Each misconfiguration is logged once per isolate, not on every request. */
let hooksWarned = false;
let mediaWarned = false;

/**
 * Whether the test hooks answer this request: DEV_TEST_HOOKS on a loopback
 * host. Anywhere else they are not there at all, whatever the variable
 * says, so a deployment that has it set by mistake lends nobody a clock.
 */
export function testHooks(request: Request, env: Env): boolean {
  if (!flag(env.DEV_TEST_HOOKS)) return false;
  if (isLoopback(new URL(request.url))) return true;
  if (!hooksWarned) {
    hooksWarned = true;
    console.warn('DEV_TEST_HOOKS is set but ignored: it applies on localhost only');
  }
  return false;
}

/**
 * The time this request is handled at, in milliseconds. The tests set it
 * with X-Test-Now, so expiry can be checked without waiting for it; that
 * header counts only where the test hooks do.
 */
export function requestTime(request: Request, env: Env): number {
  const asked = request.headers.get('x-test-now');
  if (asked !== null && /^\d{1,15}$/.test(asked) && testHooks(request, env)) return Number(asked);
  return Date.now();
}

/**
 * MEDIA_ORIGIN as an origin (scheme, host and any port), or null when it
 * is unset or not a URL. A malformed value is logged and treated as unset:
 * taken as given, it would refuse the app's own requests on whatever host
 * it happened to name.
 */
export function mediaOrigin(env: Env): string | null {
  const raw = env.MEDIA_ORIGIN?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    if (!mediaWarned) {
      mediaWarned = true;
      console.error('MEDIA_ORIGIN is not a URL, so it is ignored');
    }
    return null;
  }
}

/** Whether a request was made to the files host rather than the app's. */
export function onMediaHost(url: URL, env: Env): boolean {
  const origin = mediaOrigin(env);
  return origin !== null && new URL(origin).host === url.host;
}
