import type { Env } from './env';
import { appOrigin, onMediaHost } from './env';
import { PROJECT_FILE, getFileRow, prefixFor, type FileRow, type Scope } from './projects';

/** What a media route hands over: the request, the bindings, and work to finish after answering. */
export interface MediaContext {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}

type Kind = 'scene' | 'thumb' | 'frame';
const kindOf = (file: string): Kind => (file === 'scene.bozz' ? 'scene' : file === 'thumb.jpg' ? 'thumb' : 'frame');

/**
 * The type each file is served as, by its name and never by what was stored
 * with it (docs/accounts.md §4): the name is from a fixed set, and the
 * stored type is whatever the uploader's request said.
 */
const TYPES: Record<Kind, string> = {
  scene: 'application/x-bozzetto',
  thumb: 'image/jpeg',
  frame: 'model/gltf-binary',
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'public, no-cache';

/**
 * Stream one of a project's R2 objects (a frame, the thumbnail, a scene
 * file), if the asker may see it.
 *
 * Three routes serve these, differing in `scope`. The open ones - /m/* on
 * the files host and this one, and /media/* for the apps installed before
 * /m/ - never look at identity: Cloudflare Access does not front them, so
 * the identity headers there are whatever the client chose to send, and a
 * private project behind a forgeable header would not be private. They
 * serve the templates the gallery lists ('public'), cacheable by anyone and
 * readable by the app's pages from the files host. The owner's
 * /admin/api/media/* sits under the Access application, which is what makes
 * the identity the root middleware read there worth trusting; it reaches
 * whatever owner tools do, and nothing may keep what it sends.
 *
 * The key is the row's prefix and a file name from the fixed set, never a
 * path from the URL (docs/accounts.md §4). Every refusal is the same 404: a
 * private project, another's, a missing one and a missing file answer
 * alike, so guessing ids learns nothing about which exist. A Range of one
 * span is served as such, and the conditions a request can carry are
 * judged against the stored object, by R2 or the cache where they judge
 * as RFC 9110 does (conditions()).
 *
 * On the open routes a frame or thumbnail asked for at the project's
 * current version (?v=<updated_at>, as manifests name them) is the same
 * bytes for as long as that version stands, and is kept in the Cache API
 * under it. The cache is read beside the row, but answered from only once
 * the row has said the project is still a listed template, so a template
 * made private stops being served at once, cached or not. What it cached
 * is left where it is: the change of visibility moved updated_at, so that
 * entry's version is never the current one again, and it ages out unread.
 * (The Cache API is per data centre; there is no reaching every copy from
 * here, nor any need to.)
 */
export async function serveMedia(ctx: MediaContext, segments: string[], scope: Scope): Promise<Response> {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const open = scope === 'public';
  const shared = open ? openHeaders(url, env) : {};
  const [id, ...rest] = segments;
  const file = rest.join('/');
  if (!id || !PROJECT_FILE.test(file)) return notFound(shared);
  const kind = kindOf(file);
  const asked = version(url);
  const range = byteRange(request.headers.get('range'));
  const onlyIf = conditions(request.headers);
  const options: R2GetOptions = { onlyIf, ...(range && range !== UNSATISFIABLE ? { range } : {}) };

  // A frame or thumbnail at a named version may be in the cache, if the
  // request asks nothing the cache cannot answer for itself.
  const cacheKey =
    open && kind !== 'scene' && asked !== null && range !== UNSATISFIABLE && !CONDITIONS_R2_ONLY.some((h) => request.headers.has(h))
      ? `${url.origin}/m/${encodeURIComponent(id)}/${file}?v=${encodeURIComponent(asked)}`
      : null;
  const rowRead = getFileRow(env, id, scope);
  const hit = cacheKey ? await fromCache(cacheKey, request, range !== null) : null;
  // The row decides who may read and where the file is, so the object can
  // only be asked for once it is known - unless it is where 0.5 put it, as
  // every row from before accounts is. That key is read beside the row, and
  // used only if the row says it is the one: a 0.5 frame costs the slower
  // of the two round trips instead of both, and the timelapse viewer asks
  // for hundreds. Not when the cache has the answer already.
  const legacy = `projects/${id}/${file}`;
  const early = hit || range === UNSATISFIABLE ? null : read(env, legacy, options);
  early?.catch(() => {}); // awaited below if it is used; a failure of one that is not is nobody's
  const row = await rowRead;
  if (!row) {
    discard(hit, early);
    return notFound(shared);
  }
  const current = asked !== null && asked === String(row.updated_at);
  const policy = { kind, row, open, shared, cache: cacheControl(open, kind, current) };
  if (hit && current) return finish(new Response(hit.body, hit), policy);
  discard(hit);

  const key = prefixFor(row) + file;
  if (key !== legacy) discard(early);
  if (range === UNSATISFIABLE) return unsatisfiable(env, key, shared);
  let got = key === legacy && early ? await early : await read(env, key, options);
  if (got === UNSATISFIABLE) return unsatisfiable(env, key, shared);
  let ranged = 'range' in options;
  // If-Range: the span only of the copy the client already has part of,
  // else the whole file anew - one more read, on the rare occasion it
  // changed between a download's start and its resumption.
  if (ranged && got && hasBody(got) && !ifRangeHolds(request, got)) {
    discard(got);
    got = await read(env, key, { onlyIf });
    ranged = false;
  }
  if (got === UNSATISFIABLE || !got) return notFound(shared);
  const object = got;

  const headers = new Headers({ etag: object.httpEtag, 'last-modified': object.uploaded.toUTCString(), 'accept-ranges': 'bytes' });
  if (modifiedSince(request, object)) {
    discard(object);
    return finish(new Response(null, { status: 412, headers }), { ...policy, cache: 'no-store' });
  }
  if (!hasBody(object)) {
    // A condition did not hold, and R2 sent the object's details alone.
    const status = unmetStatus(request, object);
    return finish(new Response(null, { status, headers }), status === 304 ? policy : { ...policy, cache: 'no-store' });
  }
  if (ranged && options.range) {
    const { start, end } = servedSpan(options.range as R2Range, object.size);
    headers.set('content-range', `bytes ${start}-${end}/${object.size}`);
    return finish(new Response(object.body, { status: 206, headers }), policy);
  }
  headers.set('content-length', String(object.size));
  let body: ReadableStream = object.body;
  if (cacheKey && current) {
    // Kept as the cache will answer it: the bytes, what they are, and for
    // how long. Who may read it is added on the way out, every time.
    const [mine, kept] = body.tee();
    body = mine;
    const stored = new Headers(headers);
    stored.set('content-type', TYPES[kind]);
    stored.set('cache-control', IMMUTABLE);
    ctx.waitUntil(caches.default.put(cacheKey, new Response(kept, { headers: stored })).catch(() => {}));
  }
  return finish(new Response(body, { status: 200, headers }), policy);
}

/** R2 sends an object without its body when a condition did not hold. */
const hasBody = (o: R2Object | R2ObjectBody): o is R2ObjectBody => 'body' in o;

/** Request conditions the cache does not judge: a request with one is answered from R2. */
const CONDITIONS_R2_ONLY = ['if-match', 'if-unmodified-since', 'if-range'];

/** A Range header asking for nothing a file could hold (`bytes=-0`, a start past any size). */
const UNSATISFIABLE = Symbol('unsatisfiable');

/** The one ?v= a URL carries, or null for none or several. */
function version(url: URL): string | null {
  const all = url.searchParams.getAll('v');
  return all.length === 1 ? all[0] : null;
}

/**
 * A Range header's one span, as R2 takes it: `bytes=a-b`, `bytes=a-` or
 * `bytes=-n`. Anything else - several spans, another unit, a malformed
 * header - is ignored, as RFC 9110 allows, and the whole file is sent.
 */
function byteRange(header: string | null): R2Range | typeof UNSATISFIABLE | null {
  const m = header?.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!m || (m[1] === '' && m[2] === '')) return null;
  const [first, last] = [m[1] === '' ? null : Number(m[1]), m[2] === '' ? null : Number(m[2])];
  if (first === null) return last === 0 ? UNSATISFIABLE : { suffix: Math.min(last!, Number.MAX_SAFE_INTEGER) };
  if (!Number.isSafeInteger(first)) return UNSATISFIABLE;
  if (last === null) return { offset: first };
  if (last < first) return null;
  return { offset: first, length: Math.min(last, Number.MAX_SAFE_INTEGER) - first + 1 };
}

/**
 * The span R2 sent for one asked of a file of `size` bytes: what was asked,
 * stopped at the file's end, as R2 stops it. (A span starting at or past
 * the end never gets here: R2 refuses it.)
 */
function servedSpan(range: R2Range, size: number): { start: number; end: number } {
  if ('suffix' in range) return { start: size - Math.min(range.suffix, size), end: size - 1 };
  const start = range.offset ?? 0;
  return { start, end: range.length === undefined ? size - 1 : Math.min(start + range.length, size) - 1 };
}

/** One object from R2: null when there is none, UNSATISFIABLE when the span asked for is past its end. */
async function read(env: Env, key: string, options: R2GetOptions): Promise<R2Object | R2ObjectBody | null | typeof UNSATISFIABLE> {
  try {
    return await env.BUCKET.get(key, options);
  } catch (err) {
    if (options.range && /\(10039\)|range is not satisfiable|InvalidRange/i.test(String((err as Error)?.message ?? err))) {
      return UNSATISFIABLE;
    }
    throw err;
  }
}

/** 416, with the size the span missed, or the 404 when there is no file at all. */
async function unsatisfiable(env: Env, key: string, shared: Record<string, string>): Promise<Response> {
  const head = await env.BUCKET.head(key);
  if (!head) return notFound(shared);
  return new Response(null, {
    status: 416,
    headers: { ...shared, 'content-range': `bytes */${head.size}`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

/**
 * The request's conditions R2 judges as RFC 9110 does: If-Match,
 * If-None-Match and If-Modified-Since. If-Unmodified-Since is left out:
 * R2 holds it only for a file stored strictly before the date, where the
 * RFC lets the date itself pass, so it is judged here (modifiedSince).
 */
function conditions(given: Headers): Headers {
  const out = new Headers();
  for (const name of ['if-match', 'if-none-match', 'if-modified-since']) {
    const value = given.get(name);
    if (value !== null) out.set(name, value);
  }
  return out;
}

/** If-Unmodified-Since, unless If-Match overrides it: whether the file changed after the date. */
function modifiedSince(request: Request, object: R2Object): boolean {
  if (request.headers.has('if-match')) return false;
  const since = Date.parse(request.headers.get('if-unmodified-since') ?? '');
  return !Number.isNaN(since) && seconds(object.uploaded) > since;
}

/**
 * Which failed condition decides the status, in RFC 9110's order: If-Match
 * not holding is 412; otherwise it was If-None-Match or If-Modified-Since,
 * and the client's copy is current: 304.
 */
function unmetStatus(request: Request, object: R2Object): 304 | 412 {
  const ifMatch = request.headers.get('if-match');
  if (ifMatch === null) return 304;
  return ifMatch.split(',').some((t) => t.trim() === '*' || t.trim() === object.httpEtag) ? 304 : 412;
}

/** If-Range holds for a strong ETag equal to the object's, or its exact Last-Modified date. */
function ifRangeHolds(request: Request, object: R2Object): boolean {
  const given = request.headers.get('if-range')?.trim();
  if (given === undefined) return true;
  if (given.startsWith('"')) return given === object.httpEtag;
  return !given.startsWith('W/') && Date.parse(given) === seconds(object.uploaded);
}

/** A time as an HTTP date says it: to the second. */
const seconds = (d: Date): number => Math.floor(d.getTime() / 1000) * 1000;

/**
 * The cache's answer for a key, judged by the cache itself against the
 * request's Range, If-None-Match and If-Modified-Since: 200, 206 or 304, or
 * null for anything else - a miss, an unsatisfiable span (R2 says so with
 * the size), a cache that is not there.
 */
async function fromCache(key: string, request: Request, ranged: boolean): Promise<Response | null> {
  const headers = new Headers();
  for (const name of ['if-none-match', 'if-modified-since', ...(ranged ? ['range'] : [])]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  try {
    const hit = await caches.default.match(new Request(key, { headers }));
    if (hit && (hit.status === 200 || hit.status === 206 || hit.status === 304)) return hit;
    discard(hit);
  } catch {
    // The cache is a saving, never a reason to fail.
  }
  return null;
}

interface Policy {
  kind: Kind;
  row: FileRow;
  open: boolean;
  shared: Record<string, string>;
  cache: string;
}

/**
 * Every answer with a file in it, or about one, from R2 or the cache: what
 * it is, how long it may be kept, and that it is data, never a page. The
 * type a browser acts on is the one the name says, and a file opened on its
 * own is sandboxed: no script, no plugins, and an origin apart from this
 * site's. A scene is a download named after its project; a thumbnail is a
 * picture to show.
 */
function finish(res: Response, { kind, row, open, shared, cache }: Policy): Response {
  const h = res.headers;
  for (const [name, value] of Object.entries(shared)) h.set(name, value);
  h.set('content-type', TYPES[kind]);
  h.set('cache-control', cache);
  h.set('x-content-type-options', 'nosniff');
  h.set('content-security-policy', "default-src 'none'; sandbox");
  if (kind === 'scene') h.set('content-disposition', attachment(row.title, row.id));
  else if (kind === 'thumb') h.set('content-disposition', 'inline');
  // The owner's files are this origin's alone. The open routes' carry
  // `same-site` (openHeaders), so the app may embed the files host's.
  if (!open) h.set('cross-origin-resource-policy', 'same-origin');
  return res;
}

/**
 * A file the private route serves is kept nowhere it could outlive the
 * session that fetched it. On the open routes, a frame or thumbnail at the
 * project's current version is the same bytes for as long as that version
 * stands, and may be kept for good: a save moves updated_at, and with it
 * every URL a manifest names. Anything else revalidates on every read - a
 * scene, which is re-saved in place under one name, and a file asked for
 * at no version or a past one, whose bytes are whatever is stored now.
 */
function cacheControl(open: boolean, kind: Kind, current: boolean): string {
  if (!open) return 'private, no-store';
  return kind !== 'scene' && current ? IMMUTABLE : REVALIDATE;
}

/**
 * What every answer on the open routes says of who may read it, the 404s
 * included, so that one for a private project and one for a missing file
 * are the same answer. The app's pages may read them by script (CORS) from
 * the files host, and embed them (CORP same-site: the hosts are siblings),
 * and the files host is HTTPS-only, as the app's static files say of it.
 */
function openHeaders(url: URL, env: Env): Record<string, string> {
  const out: Record<string, string> = { 'cross-origin-resource-policy': 'same-site' };
  const app = appOrigin(env);
  if (app) {
    out['access-control-allow-origin'] = app;
    out.vary = 'origin';
  }
  if (onMediaHost(url, env)) out['strict-transport-security'] = 'max-age=31536000';
  return out;
}

/**
 * `attachment; filename="<title>.bozz"` (docs/accounts.md §4). A title is
 * anyone's text and a header is not the place for all of it: the plain
 * `filename` gets printable ASCII alone, anything else as `_`, and the
 * whole title, when that changed it, goes in `filename*` (RFC 6266).
 */
function attachment(title: string, id: string): string {
  const base = (title.trim() || id)
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd')
    .replace(/[\u0000-\u001f\u007f"\\/]/g, '_');
  const name = /\.bozz$/i.test(base) ? base : `${base}.bozz`;
  const ascii = name.replace(/[^\x20-\x7e]/g, '_');
  const plain = `attachment; filename="${ascii}"`;
  if (ascii === name) return plain;
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${plain}; filename*=UTF-8''${encoded}`;
}

/** Let go of bodies that will not be sent: responses, R2 objects, or reads still on their way. */
function discard(...unused: unknown[]): void {
  for (const u of unused) {
    if (u instanceof Promise) {
      void u.then((v) => discard(v)).catch(() => {});
    } else if (u && typeof u === 'object' && 'body' in u && u.body instanceof ReadableStream) {
      void u.body.cancel().catch(() => {});
    }
  }
}

/** The one 404 every media route answers, with what the route says of every answer (openHeaders). */
export function notFound(extra: Record<string, string> = {}): Response {
  return new Response('Not found', {
    status: 404,
    headers: { ...extra, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

/** A [[path]] catch-all hands over one segment or several. */
export function pathSegments(path: string | string[] | undefined): string[] {
  if (Array.isArray(path)) return path;
  return path ? [path] : [];
}
