/**
 * Editor API client. Writes, and every read of the owner's own projects, go
 * through the Access-gated `/admin/api/*` routes (Cloudflare Access supplies
 * the identity in production; the local `DEV_ADMIN` var stands in for it in
 * dev); the public list stays on `/api/projects`.
 */

import { apiFetch, isDesktop, type ApiResult } from '../net/origin';
import { forgetOwnerCaches } from '../net/ownerCaches';
import { AccountError, getMe, loadConfig, signOutHere, suspensionText, type Me } from '../net/account';

export type Visibility = 'public' | 'private';

/** What a scene card shows: recorded by the server when the file landed. */
export interface SceneMeta {
  objects: number;
  tris: number;
  bytes: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  /** 'timelapse' | 'model' | 'scene' - a string, so a newer mode is still listed. */
  mode: string;
  fps: number;
  updated_at: number;
  frameCount: number;
  /** Absent from a server older than the visibility migration, where all was public. */
  visibility?: Visibility;
  /** A scene's counts and size; null until its first upload has completed. */
  scene?: SceneMeta | null;
  /**
   * The site's template rather than anyone's own (docs/accounts.md §5):
   * all the public list holds, and on the owner's list the ones that
   * belong to no one. Absent from a server before accounts, whose public
   * projects were the gallery.
   */
  template?: boolean;
  /**
   * The base its files are read from, as the server names it: for a listed
   * template an open route, on this site (`/media/<id>`) or, once the
   * server has a files host, there (`https://files.…/m/<id>`); for
   * anything else the Access-gated `/admin/api/media/<id>`. Taken as
   * given, whichever it is. Absent from a server before accounts
   * (mediaPath falls back).
   */
  media?: string;
}

/**
 * A scene project's manifest, as GET /admin/api/projects/:id returns it to
 * the owner and GET /api/projects/:id a listed template's to anyone.
 */
export interface SceneProject {
  id: string;
  title: string;
  mode: string;
  visibility?: Visibility;
  template?: boolean;
  media?: string;
  updated_at: number;
  scene?: (SceneMeta & { file: string }) | null;
}

export interface CreateInput {
  /** Optional for a scene, whose id the server picks. */
  id?: string;
  title?: string;
  mode?: string;
  fps?: number;
  visibility?: Visibility;
}

/**
 * A file base as a server names one: a path on this site (`/media/<id>`),
 * or an address on another (`https://files.…/m/<id>`). Anything else - a
 * protocol-relative `//host/…`, another scheme - is not one.
 */
const MEDIA_BASE = /^(?:https?:\/\/[^/?#]+)?\/(?!\/)[^?#]*$/;

/**
 * Where one of a project's files is read from: under the base its summary
 * or manifest names, which the server sets by where the project is served
 * - a listed template's off an open route, on this site or the files
 * host, anything else's through the Access-gated mount. Every file path
 * the client builds is built here. A server from before accounts names no
 * base, and its routes follow the visibility: a private project's files
 * through the gated mount, a public one's off the open /media.
 */
export function mediaPath(p: Pick<ProjectSummary, 'id' | 'visibility' | 'media'>, file: string): string {
  if (typeof p.media === 'string' && MEDIA_BASE.test(p.media)) return `${p.media.replace(/\/+$/, '')}/${file}`;
  const base = p.visibility === 'private' ? '/admin/api/media' : '/media';
  return `${base}/${encodeURIComponent(p.id)}/${file}`;
}

/**
 * What the Public/Private switch means, wherever the owner meets it: on
 * the owner's own work, Public makes it a template, the gallery's and no
 * one's; on a template, it is whether the gallery lists it
 * (docs/accounts.md §5).
 */
export const VISIBILITY_HINT =
  "Private: only you see it, signed in. Public: a template, in everyone's gallery, belonging to no one.";

/** And the Template switch, beside it on the Projects page. */
export const TEMPLATE_HINT =
  "A template belongs to no one; public, it is in everyone's gallery, where a scene opens as a copy. " +
  'Off, it is yours again, and private.';

/** Whether a URL is on another origin than this page's: a template's files host. */
function otherOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Point a thumbnail at its file. One on another origin - a template's, on
 * the files host - is asked for with CORS (`crossorigin="anonymous"`),
 * which that host answers for this site's pages: the picture is then the
 * page's own to read, and the service worker can keep it, which it never
 * does with the opaque answer a plain cross-origin image gets. Set before
 * the source, so the request goes out as that.
 */
export function setThumbSrc(img: HTMLImageElement, src: string): void {
  if (otherOrigin(src)) img.crossOrigin = 'anonymous';
  img.src = src;
}

/**
 * Every admin call goes through here, so the browser's same-origin fetch and
 * the desktop's main-process proxy stay one code path. The proxy exists
 * because a renderer on bozzetto://app cannot reach a deployment at all: no
 * CORS headers, no OPTIONS handler, and an auth header that Cloudflare
 * Access injects only after a cookie login.
 */
async function call<T>(
  pathname: string,
  init?: { method?: string; body?: ArrayBuffer; contentType?: string },
): Promise<T> {
  const res = await apiFetch(pathname, init);
  if (res.signedOut) throw new AuthExpiredError();
  if (!res.ok) {
    // The server's own words where it gave some (a 400, 415 or 503 says
    // what was wrong with the request, or with the server's setup).
    let said: string | null = null;
    let code: string | null = null;
    let reason: string | null = null;
    if (res.bytes) {
      try {
        const body = JSON.parse(new TextDecoder().decode(res.bytes)) as { error?: unknown; code?: unknown; reason?: unknown };
        if (typeof body.error === 'string' && body.error) said = body.error;
        if (typeof body.code === 'string') code = body.code;
        if (typeof body.reason === 'string') reason = body.reason;
      } catch {
        /* non-JSON error body */
      }
    }
    // Access let the owner through, but the owner's own session did not
    // come with it (docs/accounts.md §2, lock 2): signing in to the
    // account mends it, in the dialog, without leaving the page.
    if (res.status === 403 && code === 'owner_session') throw new OwnerSessionError();
    // The account is suspended: signing in again would not help.
    if (res.status === 403 && code === 'suspended') throw new SuspendedError(reason);
    let message = said ?? `Request failed (${res.status})`;
    // A 403 is one of two refusals (functions/_shared/http.ts): a write the
    // browser said another site's page sent, which signing in again would
    // not change, or someone who is not the owner.
    if (res.status === 403) {
      message =
        said === 'Cross-site request refused'
          ? 'The request was refused as coming from another site'
          : 'Not authorized — sign in via Cloudflare Access.';
    }
    // The desktop reports "no server configured" as status 0; saying that is
    // more use than a generic failure.
    if (res.status === 0) message = res.error ?? 'No server configured.';
    throw new ApiError(message, res.status);
  }
  // An Access login page answering in the API's place is a sign-in problem,
  // not a reply: parsing it would throw "Unexpected token '<'".
  if (res.contentType.includes('text/html')) throw new ApiError('Not signed in', 401);
  return (res.bytes ? JSON.parse(new TextDecoder().decode(res.bytes)) : null) as T;
}

/** A refused call, with the status kept for callers that branch on it. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Cloudflare Access sent the call to its login page: the session has run
 * out (Access sessions expire, and an installed iPad app keeps a cookie jar
 * of its own, apart from Safari's). Not a dropped connection, and not a
 * refusal of what was asked: signing in again and repeating it works.
 */
export class AuthExpiredError extends ApiError {
  /**
   * Which sign-in ran out: Cloudflare Access's (`access`), which only a
   * page load through Access renews (/admin/login), or the account's own
   * session (`session`), which the sign-in dialog renews in place.
   */
  readonly via: SignInVia;
  constructor(via: SignInVia = 'access') {
    super('Your sign-in has expired', 401);
    this.via = via;
  }
}

/** The two sign-ins a call can find gone. */
export type SignInVia = 'access' | 'session';

/**
 * An owner route refused for want of the owner's own session (403
 * owner_session): Access vouched for the owner, but once the owner has an
 * account, the owner tools want that account signed in too (lock 2). The
 * sign-in dialog mends it.
 */
export class OwnerSessionError extends AuthExpiredError {
  constructor() {
    super('session');
    this.message = "Sign in to the owner's account";
  }
}

/**
 * The account asking is suspended (403 suspended, docs/accounts.md §2): its
 * cookie answers nothing until the owner lifts it, and signing in again
 * would not help, so nothing offers to. `reason` when the server gives one.
 */
export class SuspendedError extends ApiError {
  constructor(readonly reason: string | null = null) {
    super(suspensionText(reason), 403);
  }
}

/**
 * A request that never reached a server: offline, or a connection that
 * dropped. "Failed to fetch" says neither. An expired sign-in used to look
 * like this too, Access's redirect to its login on another origin failing
 * the fetch the same way; it is an AuthExpiredError now (see apiFetch).
 */
export class UnreachableError extends Error {
  constructor() {
    super('the server could not be reached');
  }
}

/**
 * Why an upload did not happen, which decides what the notice offers: a
 * sign-in, a wait for the connection, the suspension said and nothing
 * offered, or the server's own words.
 */
export type UploadFailure = 'expired' | 'offline' | 'suspended' | 'refused';

export function uploadFailure(err: unknown): UploadFailure {
  if (err instanceof AuthExpiredError) return 'expired';
  if (err instanceof SuspendedError) return 'suspended';
  // A rejected fetch, or a lazy chunk that could not load, is a connection.
  if (err instanceof UnreachableError || err instanceof TypeError) return 'offline';
  // The desktop's proxy reports a connection it could not make as status 0.
  if (err instanceof ApiError && err.status === 0) return 'offline';
  return 'refused';
}

/**
 * A failure as the editor says it. The editor is itself a page behind
 * Access, so a session that expires while it is open is mended by loading
 * the page again, which runs the login; saying so beats "failed".
 */
export function failureText(err: unknown): string {
  if (err instanceof OwnerSessionError) return "the owner tools need you signed in to the owner's account";
  if (err instanceof AuthExpiredError) return 'your sign-in has expired. Reload the page to sign in again';
  return err instanceof Error ? err.message : String(err);
}

const asJson = (body: unknown): { body: ArrayBuffer; contentType: string } => ({
  body: new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer,
  contentType: 'application/json',
});

/** What the sign-in probe found. */
export interface SignIn {
  /**
   * With accounts off, the owner's email while the Access session holds
   * (offline, the service worker's last answer). Never set with accounts
   * on: the account (`me`) says who it is.
   */
  email: string | null;
  /**
   * The server turned the probe away on a device someone has signed in on:
   * the session ran out. Owner work stays reachable (Save to library keeps
   * the scene here, recording goes on) and Sign in again is offered.
   */
  expired: boolean;
  /** Whether this site has accounts (/api/config); absent or false, the Access probe answered. */
  accounts?: boolean;
  /** With accounts on, the account signed in here (GET /api/me), or null. */
  me?: Me | null;
  /**
   * With accounts on, the account signed in here is suspended (403
   * suspended): signed in, and answered nothing, until the owner lifts it.
   * Its reason when the server gives one.
   */
  suspended?: { reason: string | null } | null;
}

/**
 * The last sign-in the probe confirmed on this device, so a signed-out
 * answer can be told apart: Access answers a guest who never signed in and
 * an owner whose session ran out in exactly the same way.
 */
const SIGNED_IN_KEY = 'bozzetto-signed-in';
/** Set once the gallery has said a sign-in expired; the next sign-in clears it. */
const EXPIRY_TOLD_KEY = 'bozzetto-sign-in-expiry-told';
/**
 * How long a remembered sign-in makes a signed-out answer read as expired
 * rather than as a guest: as long as the service worker keeps the probe's
 * answer (vite.config.ts), which is how long an installed app went on
 * treating its owner as signed in before.
 */
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

function remember(): void {
  try {
    // When, and nothing else: the address is never read back, and a
    // device the owner has left need not keep it.
    localStorage.setItem(SIGNED_IN_KEY, JSON.stringify({ at: Date.now() }));
    localStorage.removeItem(EXPIRY_TOLD_KEY);
  } catch {
    // Storage refused: a later signed-out answer reads as a guest's.
  }
}

function forget(): void {
  try {
    localStorage.removeItem(SIGNED_IN_KEY);
  } catch {
    // Nothing remembered that could be.
  }
}

/**
 * Whether the owner has signed in on this device lately. The desktop app
 * keeps its sign-in in its own window and says so in Server Settings, so
 * this is the web's question only.
 */
export function signedInHereBefore(): boolean {
  if (isDesktop()) return false;
  try {
    const raw = localStorage.getItem(SIGNED_IN_KEY);
    const rec = raw ? (JSON.parse(raw) as { at?: unknown; email?: unknown }) : null;
    const at = rec?.at;
    // Records from before kept the owner's address too: kept no longer.
    if (typeof at === 'number' && rec?.email !== undefined) localStorage.setItem(SIGNED_IN_KEY, JSON.stringify({ at }));
    return typeof at === 'number' && Date.now() - at < REMEMBER_MS;
  } catch {
    return false;
  }
}

/**
 * True the first time it is asked after a sign-in expired, false after
 * that until the owner has signed in again: the gallery says it once.
 */
export function takeExpiryNotice(): boolean {
  try {
    if (localStorage.getItem(EXPIRY_TOLD_KEY)) return false;
    localStorage.setItem(EXPIRY_TOLD_KEY, '1');
    return true;
  } catch {
    return false; // could not record it was said, so it is not said at all
  }
}

/**
 * Who is signed in here, and whether a signed-out answer is a sign-in that
 * expired. The deployment's config comes first (docs/accounts.md §7):
 * with accounts on, the account's session decides (checkAccount); with
 * them off, or no config to be had (a server from before accounts, or
 * offline with none kept), Cloudflare Access does, as it always has.
 *
 * The Access probe: whether this session holds an admin identity. Only a
 * JSON 200 is the owner. Access's redirect to its login is "signed out":
 * the owner's session expired when this device remembers a sign-in, a
 * guest otherwise. A refusal from the API itself (403) is someone Access
 * let through who is not the owner, so the memory goes. Anything else -
 * no network and nothing cached, an HTML page where JSON belongs - reads
 * as a guest, as it always has.
 */
export async function checkSignIn(): Promise<SignIn> {
  const config = await loadConfig();
  if (config?.accounts) return checkAccount();
  let res: ApiResult;
  try {
    res = await apiFetch('/admin/api/whoami');
  } catch {
    return { email: null, expired: false };
  }
  if (res.signedOut) {
    // The session has gone, so the worker's copies of the owner's private
    // answers go with it: offline they would go on showing the private
    // list to whoever has the device. The remembered sign-in stays, so the
    // gallery can still say the sign-in expired.
    await forgetOwnerCaches();
    return { email: null, expired: signedInHereBefore() };
  }
  const email = whoamiEmail(res);
  if (email) {
    remember();
    return { email, expired: false };
  }
  if (res.status === 403) {
    forget();
    await forgetOwnerCaches();
  }
  return { email: null, expired: false };
}

/**
 * The account signed in here (GET /api/me, which the service worker keeps
 * for offline use): a 401 is signed out, or expired where this device
 * remembers a sign-in, and the worker's copies of private answers go with
 * it (docs/accounts.md §7). A 403 suspended is an account signed in and
 * suspended, which no sign-in mends: said as that, with the copies gone
 * too. No answer at all reads as a guest's, as the Access probe's does.
 */
async function checkAccount(): Promise<SignIn> {
  const signedOut = { email: null, expired: false, accounts: true, me: null };
  let me: Me | null;
  try {
    me = await getMe();
  } catch (err) {
    if (err instanceof AccountError && err.code === 'suspended') {
      await forgetOwnerCaches();
      const reason = typeof err.body.reason === 'string' ? err.body.reason : null;
      return { ...signedOut, suspended: { reason } };
    }
    return signedOut;
  }
  if (me) {
    remember();
    return { ...signedOut, me };
  }
  await forgetOwnerCaches();
  return { ...signedOut, expired: signedInHereBefore() };
}

/**
 * Where Sign out goes: Cloudflare Access's logout on this site, which
 * deletes the session cookie here and revokes the session for every Access
 * application (developers.cloudflare.com, Access session management). The
 * team domain's logout would do the same, but this page cannot learn the
 * team's host - Access's redirect to its login reaches a page fetch
 * without its Location - and it is not written into the source. `returnTo`
 * asks to come back to the gallery: the team domain's logout takes it
 * (Cloudflare's own answers; the documentation names no parameter), and
 * where it is ignored Access shows its signed-out page instead. Either way
 * the session ends.
 */
export function signOutHref(): string {
  return `/cdn-cgi/access/logout?returnTo=${encodeURIComponent(new URL('/', window.location.href).href)}`;
}

/**
 * Sign out of this device: end the sign-in, forget the remembered one (so
 * nothing reads as an expired one afterwards), drop the worker's copies of
 * private answers, and go to the gallery. With accounts on, the account's
 * session is what ends (docs/accounts.md §7): the server revokes it and
 * clears its cookie first, and a sign-out that got no answer throws with
 * everything as it was, since the cookie is beyond the page's reach. With
 * them off, the Access session ends, through its logout and back. The
 * device's own copies of scenes stay: they are on the shelf, which is the
 * device's. Recording needs nothing more: it follows the sign-in check,
 * which reads as a guest's once the remembered sign-in is gone.
 */
export async function signOut(): Promise<void> {
  const accounts = (await loadConfig())?.accounts === true;
  if (accounts) await signOutHere();
  forget();
  try {
    localStorage.removeItem(EXPIRY_TOLD_KEY);
  } catch {
    // Nothing was remembered that could be.
  }
  await forgetOwnerCaches();
  window.location.assign(accounts ? '/' : signOutHref());
}

function whoamiEmail(res: ApiResult): string | null {
  if (!res.ok || !res.bytes || !res.contentType.includes('application/json')) return null;
  try {
    const body = JSON.parse(new TextDecoder().decode(res.bytes)) as { email?: unknown };
    return typeof body.email === 'string' ? body.email : null;
  } catch {
    return null;
  }
}

/**
 * Who the page is for, as everything that depends on a sign-in asks it:
 * the owner, a moderator or a member signed in (docs/accounts.md §7; with
 * accounts off, the owner is whoever Access vouches for), an account
 * signed in and suspended, someone whose sign-in expired, or a guest.
 */
export type Role = 'owner' | 'moderator' | 'member' | 'suspended' | 'expired' | 'guest';

export const roleOf = (s: SignIn): Role =>
  s.me ? s.me.role : s.suspended ? 'suspended' : s.email ? 'owner' : s.expired ? 'expired' : 'guest';

const project = (id: string): string => `/admin/api/projects/${encodeURIComponent(id)}`;

export const api = {
  /** The public list: what a guest's gallery shows. */
  list: () => call<ProjectSummary[]>('/api/projects'),

  /** Every project, private ones and scenes included, each with its visibility. */
  adminList: () => call<ProjectSummary[]>('/admin/api/projects'),

  /** The owner's manifest: any project, with paths to where its files are served to the owner. */
  get: (id: string) => call(project(id)),

  create: (input: CreateInput) => call<ProjectSummary>('/admin/api/projects', { method: 'POST', ...asJson(input) }),

  update: (id: string, patch: unknown) => call<ProjectSummary>(project(id), { method: 'PUT', ...asJson(patch) }),

  /**
   * Public or private. Made public, a project becomes a template, the
   * gallery's and no one's (docs/accounts.md §1); made private, a template
   * stays one, taken off the gallery. The answer says which it now is.
   */
  setVisibility: (id: string, visibility: Visibility) => api.update(id, { visibility }),

  /**
   * Make a project a template, or the owner's own again (docs/accounts.md
   * §5). On, it belongs to no one, and Public is whether the gallery lists
   * it; off, it is the owner's, and private. Answers the updated summary.
   */
  setTemplate: (id: string, template: boolean) =>
    call<ProjectSummary>(`${project(id)}/template`, { method: 'POST', ...asJson({ template }) }),

  rename: (id: string, title: string) => api.update(id, { title }),

  remove: (id: string) => call(project(id), { method: 'DELETE' }),

  uploadFrame: (id: string, index: number, glb: ArrayBuffer) =>
    call<{ key: string; index: number; size: number }>(`${project(id)}/frames?index=${index}`, {
      method: 'POST',
      body: glb,
    }),

  uploadThumb: async (id: string, blob: Blob) =>
    call<{ ok: boolean }>(`${project(id)}/thumb`, {
      method: 'POST',
      body: await blob.arrayBuffer(),
      contentType: blob.type || 'image/jpeg',
    }),

  /** Begin a scene file upload; the server says how big each part should be. */
  sceneStart: (id: string) =>
    call<{ uploadId: string; partSize: number }>(`${project(id)}/scene`, { method: 'POST' }),

  scenePart: (id: string, uploadId: string, part: number, bytes: ArrayBuffer) =>
    call<{ part: number; etag: string }>(
      `${project(id)}/scene?upload=${encodeURIComponent(uploadId)}&part=${part}`,
      { method: 'PUT', body: bytes, contentType: 'application/octet-stream' },
    ),

  sceneComplete: (
    id: string,
    uploadId: string,
    body: { parts: { part: number; etag: string }[]; objects: number; tris: number },
  ) =>
    call<SceneProject>(`${project(id)}/scene?upload=${encodeURIComponent(uploadId)}`, {
      method: 'POST',
      ...asJson(body),
    }),

  sceneAbort: (id: string, uploadId: string) =>
    call(`${project(id)}/scene?upload=${encodeURIComponent(uploadId)}`, { method: 'DELETE' }),
};
