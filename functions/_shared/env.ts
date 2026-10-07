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
   * Access JWT (`Cf-Access-Jwt-Assertion`, or the `CF_Authorization` cookie
   * that holds the same token) against the team's public keys rather than
   * trust the email header, which is only unforgeable while an Access
   * application actually fronts the route, and answer 503 while either is
   * missing. TEAM_DOMAIN is the `<team>.cloudflareaccess.com` host; AUD is
   * the application's audience tag.
   */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;

  /**
   * "true" turns accounts on. Unset (or anything else), the site is 0.5.5
   * with templates: the owner signs in through Access alone, everyone else
   * is a guest, and /api/auth/* and /api/me/* are not found.
   */
  ACCOUNTS_ENABLED?: string;
  /**
   * The app's own origin, `https://bozzetto.vidarrapp.se`: what WebAuthn
   * and Turnstile check against, and the one origin whose pages may read
   * the public files by script (CORS).
   */
  APP_ORIGIN?: string;
  /** The WebAuthn relying party, the app's host name: `bozzetto.vidarrapp.se`. */
  RP_ID?: string;
  /**
   * The origin public files are served from, `https://files.vidarrapp.se`:
   * a second custom domain on this project, where nothing but GET /m/* is
   * answered. Unset (local, tests, previews), manifests name public files
   * on this origin's own /media/, as they do while APP_ORIGIN is unset
   * (filesOrigin); /m/ answers here too.
   */
  MEDIA_ORIGIN?: string;
  /** Keys every HMAC: email codes, rate-limit buckets. A secret; `openssl rand -base64 32`. */
  AUTH_SECRET?: string;
  /** Turnstile's widget key, sent to the client only while TURNSTILE_SECRET is set too. */
  TURNSTILE_SITE_KEY?: string;
  /**
   * What Turnstile tokens are checked with (auth/turnstile.ts). Unset, every
   * check passes on a loopback host and is a 503 anywhere else. One of
   * Cloudflare's test secrets is held to success alone, for staging.
   */
  TURNSTILE_SECRET?: string;
  /** Loopback only: where Turnstile tokens are verified, so the tests can stand in for Cloudflare. */
  TURNSTILE_VERIFY_URL?: string;
  /** Resend's API key. Unset, mail goes to dev_outbox on loopback and is refused (503) elsewhere. */
  RESEND_API_KEY?: string;
  /** The sender, `Bozzetto <login@vidarrapp.se>`; mail is refused without it once RESEND_API_KEY is set. */
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
const originWarned = new Set<string>();

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
 * A variable that names an origin, as one (scheme, host and any port), or
 * null when it is unset or not a URL. A malformed value is logged and
 * treated as unset: taken as given, MEDIA_ORIGIN would refuse the app's
 * own requests on whatever host it happened to name, and APP_ORIGIN would
 * hand the files to an origin nobody meant. A value with no scheme
 * (`files.example:8788`) parses with an opaque origin, which is no origin
 * either.
 */
function originVar(name: 'MEDIA_ORIGIN' | 'APP_ORIGIN', raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let origin = 'null';
  try {
    origin = new URL(value).origin;
  } catch {
    /* not a URL */
  }
  if (origin !== 'null') return origin;
  if (!originWarned.has(name)) {
    originWarned.add(name);
    console.error(`${name} is not a URL, so it is ignored`);
  }
  return null;
}

/** MEDIA_ORIGIN as an origin, or null when it is unset or malformed (see originVar). */
export function mediaOrigin(env: Env): string | null {
  return originVar('MEDIA_ORIGIN', env.MEDIA_ORIGIN);
}

/**
 * APP_ORIGIN as an origin, or null when it is unset or malformed: the one
 * other origin public files may be read from by script (CORS), besides
 * what WebAuthn and Turnstile check against.
 */
export function appOrigin(env: Env): string | null {
  return originVar('APP_ORIGIN', env.APP_ORIGIN);
}

/** Whether a request was made to the files host rather than the app's. */
export function onMediaHost(url: URL, env: Env): boolean {
  const origin = mediaOrigin(env);
  return origin !== null && new URL(origin).host === url.host;
}

let filesWarned = false;

/**
 * The origin manifests name public files on: MEDIA_ORIGIN, once APP_ORIGIN
 * is set beside it, or null for this origin's own /media/ (mediaBase). The
 * files host lets the app's pages read what it serves by naming APP_ORIGIN
 * (CORS); with no APP_ORIGIN to name, the browser would refuse the app
 * every frame and thumbnail there, so until both are set the files stay on
 * the app's own origin, which needs no permission. The files host still
 * answers GET /m/* alone (onMediaHost) whatever this says.
 */
export function filesOrigin(env: Env): string | null {
  const media = mediaOrigin(env);
  if (!media || appOrigin(env)) return media;
  if (!filesWarned) {
    filesWarned = true;
    console.error('MEDIA_ORIGIN is set but APP_ORIGIN is not, so public files stay on this origin');
  }
  return null;
}
