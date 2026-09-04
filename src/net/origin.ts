/**
 * Where a URL points: at the app, or at a server.
 *
 * On the web these are the same place, which is why the codebase spells
 * both as root-anchored strings ('/assets/matcaps/vr01.png', '/api/projects')
 * and never asks the question. In the desktop shell they are not: the app is
 * served from bozzetto://app and any real deployment is somewhere else
 * entirely - so every absolute URL now has to say which of the two it means.
 *
 * Getting it backwards is not a crash, which is what makes it worth a module
 * of its own. Ask the server for an app asset and opening a remote project
 * quietly pulls ten matcaps and a 1.5 MB HDRI off the user's Cloudflare
 * deployment; ask the app for an API route and publishing fails against a
 * file that was never there.
 */

/** True when running inside the Electron shell rather than a browser tab. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!(window as DesktopWindow).bozzettoDesktop;
}

interface DesktopBridge {
  api(init: {
    pathname: string;
    method?: string;
    body?: ArrayBuffer;
    contentType?: string;
  }): Promise<{
    ok: boolean;
    status: number;
    contentType?: string;
    bytes?: ArrayBuffer;
    error?: string;
  }>;
  getServer(): Promise<{ url: string | null; signedIn: boolean }>;
}

interface DesktopWindow extends Window {
  bozzettoDesktop?: DesktopBridge;
}

function bridge(): DesktopBridge | null {
  return (window as DesktopWindow).bozzettoDesktop ?? null;
}

/**
 * An asset that ships WITH the app - matcaps, brush stencils, HDRIs, the
 * bundled demo, fonts. Always resolves against the app, never against a
 * configured server, in every build.
 *
 * BASE_URL is '/' on the web and on the custom protocol alike, so this is a
 * no-op today; it exists so that the answer is stated rather than assumed,
 * and so a future non-root deployment has one place to change.
 */
export function appAsset(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return path.startsWith('/') ? `${base.replace(/\/$/, '')}${path}` : `${base}${path}`;
}

/**
 * Is there a server to talk to at all? On the web, yes: the site itself.
 * On the desktop only once one has been configured, so callers can offer
 * publishing rather than fail at it.
 */
export async function hasServer(): Promise<boolean> {
  if (!isDesktop()) return true;
  const b = bridge();
  if (!b) return false;
  return !!(await b.getServer()).url;
}

/** Whether a Cloudflare Access login is in force (desktop only). */
export async function isSignedIn(): Promise<boolean> {
  if (!isDesktop()) return true; // the browser's own cookie decides
  const b = bridge();
  return b ? (await b.getServer()).signedIn : false;
}

export interface ApiResult {
  ok: boolean;
  status: number;
  contentType: string;
  bytes: ArrayBuffer | null;
  error?: string;
}

/**
 * Call an API route.
 *
 * On the web this is a plain same-origin fetch. On the desktop it goes
 * through the main process instead - not for tidiness, but because a
 * renderer on bozzetto://app cannot reach a deployment at all: the
 * Functions send no CORS headers and answer no preflight, and the admin
 * routes authenticate on a header Cloudflare Access injects only after a
 * cookie login. Requests from the main process carry no Origin, so no CORS
 * check applies, and they ride the session partition holding that cookie.
 */
export async function apiFetch(
  pathname: string,
  init: { method?: string; body?: ArrayBuffer; contentType?: string } = {},
): Promise<ApiResult> {
  if (isDesktop()) {
    const b = bridge();
    if (!b) return { ok: false, status: 0, contentType: '', bytes: null, error: 'No bridge' };
    const r = await b.api({ pathname, ...init });
    return {
      ok: r.ok,
      status: r.status,
      contentType: r.contentType ?? '',
      bytes: r.bytes ?? null,
      ...(r.error ? { error: r.error } : {}),
    };
  }
  const res = await fetch(pathname, {
    method: init.method ?? 'GET',
    headers: init.contentType ? { 'content-type': init.contentType } : undefined,
    body: init.body,
  });
  return {
    ok: res.ok,
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    bytes: await res.arrayBuffer(),
  };
}

/** The same, decoded as JSON. Null on any failure, including "no server". */
export async function apiJson<T>(
  pathname: string,
  init?: { method?: string; body?: ArrayBuffer; contentType?: string },
): Promise<T | null> {
  try {
    const r = await apiFetch(pathname, init);
    if (!r.ok || !r.bytes) return null;
    // An HTML answer means no API is there - a Cloudflare Access login page,
    // or a host answering unknown paths with its app shell. Either way it is
    // "no server", not a parse error worth showing anyone.
    if (r.contentType.includes('text/html')) return null;
    return JSON.parse(new TextDecoder().decode(r.bytes)) as T;
  } catch {
    return null;
  }
}

/**
 * The absolute URL an API manifest was fetched from, which is what its
 * root-absolute frame paths (/media/<id>/frames/...) must resolve against.
 * On the web that is this origin; on the desktop it is the configured
 * server, which the renderer never otherwise learns the address of.
 */
export async function apiManifestUrl(pathname: string): Promise<string> {
  if (!isDesktop()) return new URL(pathname, window.location.href).href;
  const b = bridge();
  const server = b ? (await b.getServer()).url : null;
  return server ? new URL(pathname, server).href : pathname;
}
