import {
  WebAuthnAbortService,
  WebAuthnError,
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { apiFetch, isDesktop, type ApiResult } from './origin';
import { isInstalled } from '../ui/launch';

/**
 * Accounts, as the client sees them (docs/accounts.md §3, §7): what this
 * deployment is (`/api/config`), who is signed in (`/api/me`), and every
 * call behind the sign-in dialog and the Account page - passkeys through
 * @simplewebauthn/browser, email codes, invites, handles and sessions -
 * with Cloudflare Turnstile's widget wherever a code is asked for, and each
 * refusal said as a sentence a person can act on.
 *
 * Everything goes through apiFetch, as the owner's calls do: a plain
 * same-origin fetch on the web, whose cookies (the session's, and the
 * flow's and the ceremony's, all HttpOnly) the browser keeps and sends by
 * itself; the main process's proxy in the desktop app.
 */

// --- what the server says ---------------------------------------------------------------

/** GET /api/config: what this deployment is, the same for everyone. */
export interface AccountsConfig {
  /** Whether there are accounts at all. Off, the site is 0.5.5 with templates and the owner signs in through Access. */
  accounts: boolean;
  /** The passkey relying party, the app's host name. Passkeys work only where the page's host is this. */
  rpId: string | null;
  /** Turnstile's widget key; null where nothing checks a token (a local server), and no widget is drawn. */
  turnstileSiteKey: string | null;
  mediaOrigin: string | null;
  /** The terms Join asks a new account to accept. */
  termsVersion: string;
  /** What a member may store and keep: the quota, the passkey limit and the file caps, in bytes. */
  limits: Record<string, number>;
}

/** An account's role, as the server keeps it. */
export type AccountRole = 'owner' | 'moderator' | 'member';

/** GET /api/me, and what every sign-in answers with: no address in it. */
export interface Me {
  id: string;
  handle: string;
  role: AccountRole;
  status: string;
  /** Bytes stored, reserved by uploads in progress, and the quota. */
  usage: { used: number; reserved: number; quota: number };
}

/** A passkey as the account lists it. */
export interface Passkey {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  /** 'multiDevice' for a synced passkey (iCloud Keychain, Google Password Manager), else 'singleDevice'. */
  deviceType: string;
  backedUp: boolean;
  aaguid: string | null;
  /** When a sign-in last reported a counter no higher than before (a cloned key, or a synced one); null if never. */
  counterWarningAt: number | null;
}

/** A session as the account lists it. */
export interface SessionView {
  id: string;
  client: string;
  userAgent: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  /** passkey, email (a code), link (the code mail's link), bootstrap. */
  method: string;
  /** This browser's own. */
  current: boolean;
}

/** GET /api/me/account: the Account page's, never cached. */
export interface AccountDetails {
  email: string;
  createdAt: number;
  termsVersion: string;
  passkeys: Passkey[];
  sessions: SessionView[];
}

/** What a request for a code answers (202): when it runs out, and when another may be sent. */
export interface CodeSent {
  expiresAt: number;
  /** Seconds before a new code may be asked for. */
  resendAfter: number;
  resendsLeft: number;
}

/** GET /admin/api/whoami: the Access identity, and the owner's account once there is one. */
export interface Whoami {
  email: string;
  owner: { id: string; handle: string } | null;
}

/**
 * What a sign-in says it is (docs/accounts.md §2): the web, unless this
 * page is the desktop app's sign-in window, which the app opens at
 * `/?signin=desktop` and whose session cookie it then uses for its own
 * requests (forDesktopApp).
 */
let client: 'web' | 'desktop' = 'web';

/**
 * This page is the desktop app's sign-in window (`/?signin=desktop`): its
 * sign-ins say `client: 'desktop'`, a code mail carries no link (it would
 * open the default browser, not this window), and nothing is offered that
 * only a browser can keep - passkeys made here, or the autofill's. A
 * passkey on a phone or a security key still signs in.
 */
export function signInForDesktopApp(): void {
  client = 'desktop';
}

/** Whether this page is the desktop app's sign-in window. */
export const forDesktopApp = (): boolean => client === 'desktop';

// --- config -------------------------------------------------------------------------------

let config: Promise<AccountsConfig | null> | null = null;

/**
 * This deployment's config, asked for once per page: null where there is
 * none to be had - a server from before accounts, a host serving the app
 * alone, no connection and no copy kept - which every caller reads as
 * "accounts off", the site as it was. A failure is not kept, so the next
 * caller asks again.
 */
export function loadConfig(): Promise<AccountsConfig | null> {
  if (!config) {
    const asked = fetchConfig();
    config = asked;
    void asked.then((c) => {
      if (!c && config === asked) config = null;
    });
  }
  return config;
}

async function fetchConfig(): Promise<AccountsConfig | null> {
  let res: ApiResult;
  try {
    res = await apiFetch('/api/config');
  } catch {
    return null;
  }
  const raw = jsonOf(res) as Partial<AccountsConfig> | null;
  if (!res.ok || !raw || typeof raw.accounts !== 'boolean') return null;
  return {
    accounts: raw.accounts,
    rpId: typeof raw.rpId === 'string' && raw.rpId ? raw.rpId : null,
    turnstileSiteKey: typeof raw.turnstileSiteKey === 'string' && raw.turnstileSiteKey ? raw.turnstileSiteKey : null,
    mediaOrigin: typeof raw.mediaOrigin === 'string' ? raw.mediaOrigin : null,
    termsVersion: typeof raw.termsVersion === 'string' ? raw.termsVersion : '',
    limits: raw.limits && typeof raw.limits === 'object' ? raw.limits : {},
  };
}

/** Whether this site has accounts. */
export async function accountsOn(): Promise<boolean> {
  return (await loadConfig())?.accounts === true;
}

/**
 * Whether passkeys can work on this page. They are bound to the RP ID,
 * which `*.pages.dev` previews and a bare IP address never match, so where
 * the page's host is not it, only email codes are offered (§7). The
 * desktop app signs in through a window of its own (Batch 9).
 */
export function passkeysHere(c: AccountsConfig | null): boolean {
  return !!c?.rpId && c.rpId === location.hostname && browserSupportsWebAuthn() && !isDesktop();
}

/**
 * Why passkeys cannot be used on this page, as the start of a sentence
 * (no full stop); null where they can. Said where codes are offered alone,
 * and where Account cannot add one.
 */
export function noPasskeysWhy(c: AccountsConfig | null): string | null {
  if (passkeysHere(c)) return null;
  if (!c?.rpId) return 'Passkeys are not set up on this server';
  if (isDesktop()) return `In the desktop app, passkeys are added in a browser, at ${c.rpId}`;
  if (c.rpId !== location.hostname) return `Passkeys work at ${c.rpId}, not at this address`;
  return 'This browser cannot use passkeys';
}

/**
 * Whether a code mail should carry a sign-in link as well (§3): only for a
 * browser that is neither an installed app nor on an iPad or iPhone. An
 * installed app keeps a cookie jar of its own, and there a mail's link
 * opens Safari, which is not the browser that asked; the code is typed
 * instead.
 */
export function wantsLink(): boolean {
  if (isInstalled() || isDesktop() || forDesktopApp()) return false;
  return !onAppleTouch();
}

/** An iPad or an iPhone. iPadOS Safari says it is a Mac; its touch points give it away. */
function onAppleTouch(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * Whether this is Safari on an iPad or iPhone rather than Bozzetto
 * installed on its Home Screen, which keeps a sign-in of its own (§7, iPad
 * PWA): an account joined or signed in to here is signed in to again
 * there, with the passkey iCloud Keychain keeps, or a code.
 */
export const inSafariBesideApp = (): boolean => onAppleTouch() && !isInstalled();

// --- requests and refusals ---------------------------------------------------------------

/**
 * A refusal from an accounts route, said as a sentence (`message`), with
 * the code it came with (docs/accounts.md §3) and whatever the code
 * carries: seconds to wait, tries left, codes left, a handle's reason.
 * `offline` is a request that never reached a server.
 */
export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }

  private num(key: string): number | null {
    const v = this.body[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  /** Seconds until it is worth asking again (rate_limited, mail_paused). */
  get retryAfter(): number | null {
    return this.num('retryAfter');
  }

  /** Tries left on a code (code_invalid). */
  get attemptsLeft(): number | null {
    return this.num('attemptsLeft');
  }

  /** Codes a flow may still send (a refused resend). */
  get resendsLeft(): number | null {
    return this.num('resendsLeft');
  }

  /** Why a handle will not do: format, reserved, taken, retired. */
  get reason(): string | null {
    return typeof this.body.reason === 'string' ? this.body.reason : null;
  }
}

/** The Access session in front of /admin/ has run out: only a page load through Access renews it. */
export class AccessExpiredError extends AccountError {
  constructor() {
    super('Your Cloudflare Access sign-in has expired. Reload the page to sign in again.', 401, 'access');
  }
}

/** How long to wait, as the end of a sentence: "in 45 seconds", "in 4 minutes", "in 23 days". */
export function inWait(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return 'in a moment';
  const s = Math.ceil(seconds);
  if (s < 60) return `in ${s} second${s === 1 ? '' : 's'}`;
  const minutes = Math.ceil(s / 60);
  if (minutes < 90) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(s / 3600);
  if (hours < 36) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.ceil(s / 86400);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

/**
 * A suspended account, as said wherever it shows: its reason when the
 * server gives one, else where the reason is - the mail that told the
 * holder (the owner's tools mail it, and keep it off the audit log).
 */
export function suspensionText(reason: string | null): string {
  const why = reason?.trim();
  return why
    ? `Your account is suspended: ${why.replace(/[.\s]+$/, '')}.`
    : 'Your account is suspended. The mail that told you says why, and how to object.';
}

/** Why a handle will not do, as a sentence (GET /api/auth/handle's reasons, and the refusals'). */
export function handleReasonText(reason: string | null): string {
  switch (reason) {
    case 'format':
      return 'A handle is 3 to 30 characters: lower-case letters, digits, _ and -, starting with a letter or digit.';
    case 'reserved':
      return 'That handle is reserved.';
    case 'retired':
      return 'That handle was given up recently, and is held for 90 days.';
    default:
      return 'That handle is taken.';
  }
}

/** A refusal's sentence, by its code and what it carries. */
function sentence(status: number, code: string, body: Record<string, unknown>): string {
  const said = typeof body.error === 'string' ? body.error : '';
  const n = (key: string): number | null => (typeof body[key] === 'number' ? (body[key] as number) : null);
  switch (code) {
    case 'code_invalid': {
      const left = n('attemptsLeft');
      if (left === 0) return 'That code is not right, and that was the last try. Ask for a new code.';
      return left === null ? 'That code is not right.' : `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`;
    }
    case 'signin':
      return 'You are not signed in. Sign in, then try again.';
    case 'reauth':
      return 'Confirm it is you first.';
    case 'cross_site':
      return 'The request was refused as coming from another site.';
    case 'turnstile':
      return 'The check that keeps out bots did not pass. Try again.';
    case 'suspended':
      return suspensionText(typeof body.reason === 'string' ? body.reason : null);
    case 'owner_session':
      return "Owner tools need you signed in to the owner's account.";
    case 'not_found':
      return 'That is not there any more.';
    case 'owner_exists':
      return "The owner's account exists already.";
    case 'handle_taken':
      return handleReasonText(typeof body.reason === 'string' ? body.reason : 'taken');
    case 'invite_invalid':
      return 'This invite does not work any more: it may have been used, withdrawn or have run out. Ask whoever sent it for a new one.';
    case 'flow_expired':
      return 'That code has run out. Ask for a new one.';
    case 'rate_limited':
      return `Too many tries for now. Try again ${inWait(n('retryAfter'))}.`;
    case 'accounts_off':
      return 'Accounts are not open on this site.';
    case 'not_configured':
      return 'Signing in is not set up on this server yet.';
    case 'turnstile_down':
      return 'The check that keeps out bots cannot be reached just now. Try again in a moment.';
    case 'mail_paused':
      return `Bozzetto has sent all the mail it may today. Try again ${inWait(n('retryAfter'))}.`;
    case 'bad_request':
      if (typeof body.reason === 'string') return handleReasonText(body.reason);
      if (typeof body.limit === 'number') return `An account can have at most ${body.limit} passkeys. Remove one to add another.`;
      return said || 'That was not accepted.';
    default:
      if (status >= 500) return 'Something went wrong on the server. Try again in a moment.';
      return said || `The request was refused (${status}).`;
  }
}

function jsonOf(res: ApiResult): Record<string, unknown> | null {
  if (!res.bytes || res.bytes.byteLength === 0 || !res.contentType.includes('application/json')) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(res.bytes)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The refusal a response is. */
function refusalOf(res: ApiResult): AccountError {
  if (res.signedOut) return new AccessExpiredError();
  // The desktop's proxy reports no server, or a connection it could not make, as status 0.
  if (res.status === 0) return new AccountError(res.error ?? 'No connection. Check it, then try again.', 0, 'offline');
  const body = jsonOf(res) ?? {};
  const code = typeof body.code === 'string' ? body.code : res.status >= 500 ? 'server' : 'refused';
  return new AccountError(sentence(res.status, code, body), res.status, code, body);
}

/** One call: the answer's status and JSON (null for a 204), or an AccountError. */
async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T | null }> {
  let res: ApiResult;
  try {
    res = await apiFetch(
      path,
      body === undefined
        ? { method }
        : {
            method,
            body: new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer,
            contentType: 'application/json',
          },
    );
  } catch {
    throw new AccountError('No connection. Check it, then try again.', 0, 'offline');
  }
  if (!res.ok) throw refusalOf(res);
  return { status: res.status, data: jsonOf(res) as T | null };
}

/** The same, wanting a body back. */
async function callFor<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { data } = await call<T>(method, path, body);
  if (data === null) throw new AccountError('The server answered with nothing.', 500, 'server');
  return data;
}

// --- who is signed in -----------------------------------------------------------------

/**
 * The account signed in here, or null when the server says nobody is (401:
 * signed out, or the session over). Throws when there was no answer.
 */
export async function getMe(): Promise<Me | null> {
  try {
    return await callFor<Me>('GET', '/api/me');
  } catch (err) {
    if (err instanceof AccountError && err.status === 401) return null;
    throw err;
  }
}

export const getAccount = (): Promise<AccountDetails> => callFor<AccountDetails>('GET', '/api/me/account');

/** Sign this browser out: its session revoked, its auth cookies cleared. */
export async function signOutHere(): Promise<void> {
  await call('POST', '/api/auth/signout');
}

// --- invites, handles, codes -------------------------------------------------------------

/** When an invite stops working; an AccountError (invite_invalid) when it already has. */
export async function checkInvite(invite: string): Promise<number> {
  const { expiresAt } = await callFor<{ expiresAt: number }>('POST', '/api/auth/invite/check', { invite });
  return expiresAt;
}

/** Whether a handle can be had, as typed: its reason when not. */
export const checkHandle = (handle: string): Promise<{ available: boolean; reason?: string }> =>
  callFor('GET', `/api/auth/handle?h=${encodeURIComponent(handle)}`);

/** The shape a handle must have, checked here before asking (functions/_shared/auth/handles.ts). */
export const HANDLE_SHAPE = /^[a-z0-9][a-z0-9_-]{2,29}$/;

/** A code as typed - spaces and dashes are fine, as the mail spaces it - or null unless six digits remain. */
export function readCode(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** An invite as pasted: the link it came in, or the token alone; null when it is neither. */
export function readInvite(raw: string): string | null {
  const text = raw.trim();
  let token = text;
  const asked = /[?&]invite=([^&#\s]+)/.exec(text);
  if (asked) token = decodeURIComponent(asked[1]);
  return /^[A-Za-z0-9_-]{22}$/.test(token) ? token : null;
}

export interface JoinRequest {
  invite: string;
  handle: string;
  email: string;
  turnstile?: string;
}

/** Join's first step: the invite, handle and address checked, and a code mailed (202). */
export const startJoin = (r: JoinRequest): Promise<CodeSent> =>
  callFor('POST', '/api/auth/register/start', { ...r, acceptTerms: true, ageConfirmed: true, link: wantsLink() });

/** Join's code: the account made and signed in (201). `handle` replaces one taken meanwhile. */
export async function finishJoin(code: string, handle?: string): Promise<Me> {
  const { user } = await callFor<{ user: Me }>('POST', '/api/auth/register/verify', {
    code,
    client,
    ...(handle ? { handle } : {}),
  });
  return user;
}

/** "Email me a code": 202 whether or not the address has an account. */
export const startEmailSignIn = (email: string, turnstile?: string): Promise<CodeSent> =>
  callFor('POST', '/api/auth/email/start', { email, turnstile, link: wantsLink() });

/** A code to the account's own address, to confirm it is you (no link: the code is typed where it was asked for). */
export const startEmailReauth = (turnstile?: string): Promise<CodeSent> =>
  callFor('POST', '/api/auth/email/start', { reauth: true, turnstile, link: false });

/** A new code for the flow in progress, whichever began it. */
export const resendCode = (turnstile?: string): Promise<CodeSent> =>
  callFor('POST', '/api/auth/email/resend', { turnstile });

/** A sign-in's code: signed in (200). */
export async function finishEmailSignIn(code: string): Promise<Me> {
  const { user } = await callFor<{ user: Me }>('POST', '/api/auth/email/verify', { code, client });
  return user;
}

/** A re-authentication's code: this session counts as recent (204). */
export async function finishEmailReauth(code: string): Promise<void> {
  await call('POST', '/api/auth/email/verify', { code, reauth: true });
}

/**
 * The sign-in link a code mail carries (`/?link=<token>`), in the browser
 * that asked for the code: a sign-in (200) or Join (201) answers the
 * account, a re-authentication (204) nothing.
 */
export async function followLink(token: string): Promise<{ joined: boolean; user: Me | null }> {
  const { status, data } = await call<{ user: Me }>('POST', '/api/auth/email/link', { token, client });
  return { joined: status === 201, user: data?.user ?? null };
}

// --- the account ----------------------------------------------------------------------

/** A new handle; at most one change in 30 days (rate_limited, with the wait). */
export const changeHandle = (handle: string): Promise<Me> => callFor('PATCH', '/api/me', { handle });

/** A code to a new address (needs recent authentication). */
export const startEmailChange = (email: string, turnstile?: string): Promise<CodeSent> =>
  callFor('POST', '/api/me/email/start', { email, turnstile });

/** The new address's code: the address swapped, the old one told. */
export async function finishEmailChange(code: string): Promise<string> {
  return (await callFor<{ email: string }>('POST', '/api/me/email/verify', { code })).email;
}

export async function renamePasskey(id: string, name: string): Promise<Passkey> {
  return (await callFor<{ passkey: Passkey }>('PATCH', `/api/me/passkeys/${encodeURIComponent(id)}`, { name })).passkey;
}

/** Remove a passkey (needs recent authentication). The last one may go. */
export async function removePasskey(id: string): Promise<void> {
  await call('DELETE', `/api/me/passkeys/${encodeURIComponent(id)}`);
}

/** Sign one session out; signing out this browser's own clears its cookies too. */
export async function revokeSession(id: string): Promise<void> {
  await call('DELETE', `/api/me/sessions/${encodeURIComponent(id)}`);
}

/** Sign out everywhere, this browser too unless `keepCurrent`. Answers how many sessions went. */
export async function revokeAllSessions(keepCurrent: boolean): Promise<number> {
  return (await callFor<{ revoked: number }>('POST', '/api/me/sessions/revoke-all', { keepCurrent })).revoked;
}

/** The owner's own account, from the Access identity, once (docs/accounts.md §8); signed in by it. */
export async function bootstrapOwner(handle: string): Promise<Me> {
  const { user } = await callFor<{ user: Me }>('POST', '/admin/api/owner/bootstrap', {
    handle,
    acceptTerms: true,
    ageConfirmed: true,
  });
  return user;
}

/** /admin/api/whoami, as the owner tools read it: an AccountError for any refusal. */
export const whoami = (): Promise<Whoami> => callFor<Whoami>('GET', '/admin/api/whoami');

// --- passkeys ---------------------------------------------------------------------------

/**
 * Options for a passkey sign-in, or with `reauth` for confirming it is you
 * (only the account's own passkeys). Each call begins a new ceremony and
 * ends the one before it: this browser has one at a time.
 */
export const passkeyOptions = (reauth = false): Promise<PublicKeyCredentialRequestOptionsJSON> =>
  callFor('POST', '/api/auth/passkey/options', reauth ? { reauth: true } : {});

/**
 * Sign in with a passkey, from options asked for before. Modal, the
 * browser's own prompt, unless `autofill`: then the request waits on the
 * email field's suggestions (conditional mediation) until a passkey is
 * picked there or another ceremony takes its place. The browser's call is
 * made before anything is awaited, so a button's click still counts as
 * the gesture iPadOS before 17.4 wants.
 */
export async function passkeySignIn(
  optionsJSON: PublicKeyCredentialRequestOptionsJSON,
  { autofill = false }: { autofill?: boolean } = {},
): Promise<Me> {
  const response = await startAuthentication({ optionsJSON, useBrowserAutofill: autofill });
  const { user } = await callFor<{ user: Me }>('POST', '/api/auth/passkey/verify', { response, client });
  return user;
}

/** Confirm it is you with a passkey, from reauth options asked for before: this session counts as recent. */
export async function passkeyReauth(optionsJSON: PublicKeyCredentialRequestOptionsJSON): Promise<void> {
  const response = await startAuthentication({ optionsJSON });
  await call('POST', '/api/auth/passkey/verify', { response, reauth: true });
}

/** Whether the email field's suggestions can offer passkeys here (conditional mediation). */
export async function autofillAvailable(): Promise<boolean> {
  try {
    return await browserSupportsWebAuthnAutofill();
  } catch {
    return false;
  }
}

/** Stop whatever passkey request is waiting: the autofill's, before a modal one, or any as a dialog closes. */
export function cancelPasskeyRequest(): void {
  WebAuthnAbortService.cancelCeremony();
}

/** Options for a new passkey (needs recent authentication; 400 with `limit` at ten). */
export const newPasskeyOptions = (): Promise<PublicKeyCredentialCreationOptionsJSON> =>
  callFor('POST', '/api/me/passkeys/options', {});

/** Make a passkey from options asked for before, and save it to the account. */
export async function addPasskey(optionsJSON: PublicKeyCredentialCreationOptionsJSON, name?: string): Promise<Passkey> {
  const response = await startRegistration({ optionsJSON });
  const { passkey } = await callFor<{ passkey: Passkey }>('POST', '/api/me/passkeys', {
    response,
    ...(name ? { name } : {}),
  });
  return passkey;
}

/**
 * A passkey request that ended with nothing to say: stopped for another
 * one, or by a dialog closing. A person closing the browser's prompt is
 * not this; that is said (passkeyErrorText).
 */
export function passkeyAborted(err: unknown): boolean {
  if (err instanceof WebAuthnError) return err.code === 'ERROR_CEREMONY_ABORTED';
  return err instanceof Error && err.name === 'AbortError';
}

/** Why a passkey request failed, as a sentence. */
export function passkeyErrorText(err: unknown): string {
  if (err instanceof AccountError) return err.message;
  const code = err instanceof WebAuthnError ? err.code : '';
  // The browser's own error is the cause of the library's.
  const cause = err instanceof WebAuthnError ? ((err as Error & { cause?: unknown }).cause as Error | undefined) : undefined;
  const name = cause?.name ?? (err as Error | null)?.name;
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'This device already has a passkey for your account.';
  if (code === 'ERROR_INVALID_DOMAIN' || code === 'ERROR_INVALID_RP_ID' || name === 'SecurityError') {
    return 'Passkeys do not work at this address. Sign in with an email code instead.';
  }
  if (name === 'NotAllowedError') return 'The passkey request was cancelled, or timed out.';
  if (name === 'InvalidStateError') return 'This device already has a passkey for your account.';
  if (name === 'NotSupportedError') return 'This device cannot make a passkey that Bozzetto accepts.';
  const message = err instanceof Error ? err.message : String(err);
  return `The passkey did not work: ${message}`;
}

/** Any failure, as a sentence: an account route's refusal, a passkey's, a bot check's, or a dropped connection. */
export function errorText(err: unknown): string {
  if (err instanceof AccountError || err instanceof BotCheckError) return err.message;
  if (err instanceof WebAuthnError || (err instanceof Error && /^(NotAllowed|InvalidState|Security|NotSupported|Abort)Error$/.test(err.name))) {
    return passkeyErrorText(err);
  }
  if (err instanceof TypeError) return 'No connection. Check it, then try again.';
  return err instanceof Error ? err.message : String(err);
}

// --- Turnstile ----------------------------------------------------------------------------

/** Rendered explicitly, so each form decides where its widget goes and when. */
const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** The actions the server expects (functions/_shared/auth/turnstile.ts): Join's start, and everything that mails a code. */
export type BotAction = 'register' | 'email-code';

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
  reset(widget?: string): void;
  remove(widget?: string): void;
}

/** The bot check could not be had: its script would not load, or no token came in time. */
export class BotCheckError extends Error {}

let turnstileScript: Promise<TurnstileApi> | null = null;

/** Cloudflare's script, loaded once a page, and only when a form needs it. */
function loadTurnstile(): Promise<TurnstileApi> {
  const ready = (window as { turnstile?: TurnstileApi }).turnstile;
  if (ready) return Promise.resolve(ready);
  turnstileScript ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.addEventListener('load', () => {
      const api = (window as { turnstile?: TurnstileApi }).turnstile;
      if (api) resolve(api);
      else reject(new BotCheckError('The check that keeps out bots did not start. Reload the page, then try again.'));
    });
    script.addEventListener('error', () => {
      script.remove();
      turnstileScript = null;
      reject(new BotCheckError('The check that keeps out bots could not load. Check the connection, then try again.'));
    });
    document.head.appendChild(script);
  });
  return turnstileScript;
}

/** How long a submit waits for a token before saying so. Interaction-only widgets usually need none. */
const TOKEN_WAIT_MS = 60_000;

/**
 * One form's Turnstile widget (docs/accounts.md §6): drawn into `host`
 * with the form's action, invisible unless Cloudflare wants an
 * interaction (`appearance: 'interaction-only'`). Each submit takes a
 * fresh token - a token validates once, and lasts 300 s - and taking one
 * resets the widget, so the next is on its way before it is needed. With
 * no site key (a local server, where nothing checks a token) nothing is
 * loaded or drawn, and take() answers undefined.
 */
export class BotCheck {
  private widget: string | null = null;
  private api: TurnstileApi | null = null;
  private token: string | null = null;
  private waiting: Array<(token: string) => void> = [];
  private started: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly siteKey: string | null,
    private readonly action: BotAction,
  ) {}

  /** Draw the widget now, so a token is ready by the time the form is sent. */
  start(): Promise<void> {
    if (!this.siteKey) return Promise.resolve();
    this.started ??= loadTurnstile().then((api) => {
      if (this.disposed) return;
      this.api = api;
      this.widget =
        api.render(this.host, {
          sitekey: this.siteKey,
          action: this.action,
          appearance: 'interaction-only',
          callback: (token: string) => {
            this.token = token;
            const give = this.waiting.shift();
            if (give) give(this.take1());
          },
          'expired-callback': () => {
            this.token = null;
          },
          // Turnstile retries by itself; returning true keeps it from throwing as well.
          'error-callback': () => true,
        }) ?? null;
    });
    this.started.catch(() => {
      this.started = null;
    });
    return this.started;
  }

  /** The token in hand, given out once; the widget starts on the next. */
  private take1(): string {
    const token = this.token ?? '';
    this.token = null;
    if (this.api && this.widget !== null) {
      try {
        this.api.reset(this.widget);
      } catch {
        // A widget already gone: the next start() draws another.
      }
    }
    return token;
  }

  /** A fresh token for one submit; undefined where no widget is drawn. */
  async take(): Promise<string | undefined> {
    if (!this.siteKey) return undefined;
    await this.start();
    if (this.token) return this.take1();
    return new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiting = this.waiting.filter((w) => w !== give);
        reject(new BotCheckError('The check that keeps out bots did not finish. Try again.'));
      }, TOKEN_WAIT_MS);
      const give = (token: string): void => {
        window.clearTimeout(timer);
        resolve(token);
      };
      this.waiting.push(give);
    });
  }

  /** Take the widget away, with the form it was for. */
  dispose(): void {
    this.disposed = true;
    this.waiting = [];
    if (this.api && this.widget !== null) {
      try {
        this.api.remove(this.widget);
      } catch {
        // Gone already.
      }
    }
    this.widget = null;
  }
}

// --- the invite a link brought -------------------------------------------------------------

/** Where `/?invite=<token>` puts its token: this tab only, and gone with it. */
const INVITE_KEY = 'bozzetto-invite';

export function rememberInvite(token: string): void {
  try {
    sessionStorage.setItem(INVITE_KEY, token);
  } catch {
    // Storage refused: Join asks for the invite link instead.
  }
}

export function rememberedInvite(): string | null {
  try {
    return sessionStorage.getItem(INVITE_KEY);
  } catch {
    return null;
  }
}

export function forgetInvite(): void {
  try {
    sessionStorage.removeItem(INVITE_KEY);
  } catch {
    // Nothing kept.
  }
}

// --- dates, as the account pages say them -------------------------------------------

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "7 October 2026". */
export const dayOf = (t: number): string => DATE.format(new Date(t));
/** "7 Oct 2026, 14:05". */
export const momentOf = (t: number): string => DATE_TIME.format(new Date(t));
