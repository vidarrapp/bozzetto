/**
 * Where a URL points, and how the app calls its server.
 *
 * On the web the app and its server are the same place, which is why the
 * codebase spells both as root-anchored strings ('/assets/matcaps/vr01.png',
 * '/api/projects'). This module is where that is stated rather than
 * assumed, and where the API calls go, so the sign-in handling for the
 * owner's routes sits in one place.
 */

/**
 * An asset that ships WITH the app - matcaps, brush stencils, HDRIs, the
 * bundled demo, fonts. Always resolves against the app.
 *
 * BASE_URL is '/' today, so this is a no-op; it exists so that the answer
 * is stated rather than assumed, and so a future non-root deployment has
 * one place to change.
 */
export function appAsset(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return path.startsWith('/') ? `${base.replace(/\/$/, '')}${path}` : `${base}${path}`;
}

export interface ApiResult {
  ok: boolean;
  status: number;
  contentType: string;
  bytes: ArrayBuffer | null;
  error?: string;
  /**
   * Cloudflare Access turned the request away to its login page: a server
   * answered, and the answer is "sign in". A request that never reached a
   * server is not this - on the web it rejects, as a fetch does.
   */
  signedOut?: boolean;
}

/** The routes Cloudflare Access fronts, as far as the API goes. */
const isOwnerRoute = (pathname: string): boolean => pathname.startsWith('/admin/api/');

/**
 * Statuses that mean Access turned the request away: a redirect to its
 * login, which is what it answers today, or a bare 401. None of the
 * Functions under /admin/api answers with either - they refuse with a 403 -
 * so on those routes these can only be Access.
 */
const SIGN_IN_STATUSES = new Set([301, 302, 303, 307, 308, 401]);

/**
 * Call an API route, or fetch one of a project's files: a plain fetch,
 * same-origin for the API, and CORS for a template's file on the files
 * host, which answers this site's pages.
 */
export async function apiFetch(
  pathname: string,
  init: { method?: string; body?: ArrayBuffer; contentType?: string } = {},
): Promise<ApiResult> {
  // The owner's routes are fetched without following redirects. When the
  // session cookie is missing or has expired, Cloudflare Access answers
  // every /admin/api request with a redirect to its login page on another
  // origin. Followed, that lands on a page with no CORS headers and the
  // fetch rejects with the same TypeError as having no network at all,
  // which is how an expired sign-in read as "the server could not be
  // reached" - and how the service worker, taking the rejection for a
  // dropped connection, answered the sign-in probe from its cache. Not
  // followed, the redirect comes back as a response (an opaqueredirect,
  // status 0), the worker passes it through as it does any network answer,
  // and it can be read for what it is.
  const owner = isOwnerRoute(pathname);
  const res = await fetch(pathname, {
    method: init.method ?? 'GET',
    headers: init.contentType ? { 'content-type': init.contentType } : undefined,
    body: init.body,
    ...(owner ? { redirect: 'manual' as const } : {}),
  });
  if (owner && (res.type === 'opaqueredirect' || SIGN_IN_STATUSES.has(res.status))) {
    return { ok: false, status: res.status, contentType: '', bytes: null, signedOut: true };
  }
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
 * root-absolute frame paths (/media/<id>/frames/...) must resolve against;
 * a frame named on a files host is a full address, and resolves to itself.
 */
export function apiManifestUrl(pathname: string): string {
  return new URL(pathname, window.location.href).href;
}
