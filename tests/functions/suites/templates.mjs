// The templates' files and the Template switch (docs/accounts.md §4, §5).
//
// /m/<id>/<file> serves a listed template's files to anyone, on the files
// host (MEDIA_ORIGIN, here files.example) and on the app's own host, and
// /media/* is the same handler under the name 0.5's apps use. Manifests
// name the files host. Every refusal is one 404, whatever the reason. A
// frame or thumbnail at the current ?v= is kept in the Cache API, behind
// the row check. The switch hands a project between the owner and the
// site, moving its bytes and writing an audit row.
//
// Over HTTP the owner tools act as no account (Batch 3 brings the owner's),
// and the servers' database must not hold an owner account either - Batch
// 3's bootstrap starts from none - so the switch with an owner account,
// and its byte accounting, are checked directly: functions/_shared on a
// fresh SQLite with every migration, the owner and a member seeded there.
import {
  DATA,
  DATA_ONE_FRAME,
  DEPLOYED_HOST,
  FILES_HOST,
  OWNER,
  asOwner,
  asStranger,
  d1,
  bozz,
  ids,
  jpeg,
  migratedDatabase,
  pattern,
  same,
} from '../lib.mjs';

export const needs = ['off'];

const MEMBER = 'u-tmmember0000000000000000';
const LEGACY_FRAME = pattern(3000, 61);
const row = (id, visibility, template, owner, prefix, data = DATA) =>
  `('${id}', '${id}', 'timelapse', 4, '${data}', '${visibility}', ${template}, ${owner ? `'${owner}'` : 'NULL'}, ${prefix ? `'${prefix}'` : 'NULL'}, 5000, 5000)`;

export const seed = {
  sql: `
INSERT INTO users (id, handle, email, webauthn_user_id, role, terms_version, terms_accepted_at, age_confirmed_at, created_at, updated_at)
  VALUES ('${MEMBER}', 'tmmember', 'tm-member@example.com', 'wa-tm-member', 'member', '2026-10', 0, 0, 0, 0);
INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at) VALUES
  ${row('tm-legacy', 'public', 1, null, null, DATA_ONE_FRAME)},
  ${row('tm-public-own', 'public', 0, null, null)},
  ${row('tm-member', 'public', 0, MEMBER, `users/${MEMBER}/projects/tm-member/`)},
  ${row('tm-window', 'public', 1, null, `users/${MEMBER}/projects/tm-member/`)},
  ${row('tm-member-private', 'private', 0, MEMBER, `users/${MEMBER}/projects/tm-member-private/`)};
`,
  // Stored with a type of its own, where 0.5 put it: served as what its name says.
  r2: [{ key: 'projects/tm-legacy/frames/sd/0000.glb', bytes: LEGACY_FRAME, type: 'text/html' }],
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'public, no-cache';
/** Headers that differ from one moment, or one transfer, to the next. */
const VOLATILE = new Set(['date', 'age', 'cf-cache-status', 'cf-ray', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);
/** A response as everything but the volatile: status, body and headers. */
const shape = (r) =>
  JSON.stringify([r.status, new TextDecoder().decode(r.bytes), [...r.headers].filter(([k]) => !VOLATILE.has(k)).sort()]);
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const pathOf = (url) => String(url ?? '').replace(/^https?:\/\/[^/]+/, '');

export async function run({ checks, off, compileShared, repo }) {
  const { call, callHost, port } = off;
  const APP = `http://localhost:${port}`;
  const appHost = `localhost:${port}`;
  const h = (r, name) => r.headers.get(name);
  /** Ask until the Cache API answers (cf-cache-status: HIT), since it is filled after the answer goes. */
  const untilHit = async (path, opts = {}) => {
    let r;
    for (let i = 0; i < 30; i++) {
      r = await call('GET', path, opts);
      if (h(r, 'cf-cache-status') === 'HIT') return r;
      await wait(100);
    }
    return r;
  };

  // --- the projects ------------------------------------------------------------
  let t = checks('functions: templates, set up');
  const frame = pattern(6000, 51);
  const thumb = jpeg(52);
  const sceneBytes = bozz({ vertices: 80, seed: 53 });
  const made = [];
  const owner = (method, path, opts = {}) => call(method, path, { headers: asOwner, ...opts });
  made.push(await owner('POST', '/admin/api/projects', { json: { id: 'tm-reel', title: 'A reel' } }));
  made.push(await owner('POST', '/admin/api/projects/tm-reel/frames?index=0', { bytes: frame }));
  made.push(await owner('PUT', '/admin/api/projects/tm-reel', { json: { frames: [{ index: 0, tris: 12 }] } }));
  made.push(await owner('POST', '/admin/api/projects/tm-reel/thumb', { bytes: thumb }));
  for (const [id, visibility] of [
    ['tm-own', 'private'],
    ['tm-priv', 'public'],
    ['tm-empty', 'public'],
  ]) {
    made.push(await owner('POST', '/admin/api/projects', { json: { id, visibility } }));
    if (id !== 'tm-empty') made.push(await owner('POST', `/admin/api/projects/${id}/thumb`, { bytes: jpeg(54) }));
  }
  made.push(await owner('POST', '/admin/api/projects/tm-own/frames?index=0', { bytes: frame }));
  made.push(await owner('PUT', '/admin/api/projects/tm-own', { json: { frames: [{ index: 0, tris: 12 }] } }));
  made.push(await owner('PUT', '/admin/api/projects/tm-priv', { json: { visibility: 'private' } }));
  made.push(await owner('POST', '/admin/api/projects/tm-window/thumb', { bytes: jpeg(55) }));
  const sc = await owner('POST', '/admin/api/projects', { json: { mode: 'scene', title: 'Clay "study"\n/ é' } });
  made.push(sc);
  const scene = sc.json?.id;
  const up = await owner('POST', `/admin/api/projects/${scene}/scene`);
  const u = encodeURIComponent(up.json?.uploadId ?? '');
  const part = await owner('PUT', `/admin/api/projects/${scene}/scene?upload=${u}&part=1`, { bytes: sceneBytes });
  made.push(await owner('POST', `/admin/api/projects/${scene}/scene?upload=${u}`, { json: { parts: [part.json], objects: 1, tris: 2 } }));
  made.push(await owner('PUT', `/admin/api/projects/${scene}`, { json: { visibility: 'public' } }));
  t.ok(made.every((m) => m.status === 200 || m.status === 201), `the projects and their files are in place (${made.map((m) => m.status).join(' ')})`);
  t.report();

  // --- manifests -----------------------------------------------------------------
  t = checks('functions: manifests name the files host');
  const reel = (await call('GET', '/api/projects/tm-reel')).json;
  const base = `http://${FILES_HOST}/m/tm-reel`;
  const v = reel?.updated_at;
  t.eq(reel?.media, base, 'a listed template\'s base is /m/ on MEDIA_ORIGIN');
  t.eq(reel?.frames?.[0]?.sd, `${base}/frames/sd/0000.glb?v=${v}`, 'its frames follow it, at the version updated_at says');
  const listed = ((await call('GET', '/api/projects')).json ?? []).find((p) => p.id === 'tm-reel');
  t.eq(listed?.media, base, 'the public list names the same base');
  const sceneManifest = (await call('GET', `/api/projects/${scene}`)).json;
  t.eq(sceneManifest?.scene?.file, `http://${FILES_HOST}/m/${scene}/scene.bozz?v=${sceneManifest?.updated_at}`, 'and a scene template\'s file');
  let r = await owner('GET', '/admin/api/projects/tm-reel');
  t.ok(r.json?.media === base && r.json?.frames?.[0]?.sd === `${base}/frames/sd/0000.glb?v=${v}`, `the owner's manifest of a listed template uses the public base too (${r.json?.media})`);
  r = await owner('GET', '/admin/api/projects/tm-own');
  t.ok(r.json?.media === '/admin/api/media/tm-own' && r.json?.frames?.[0]?.sd?.startsWith('/admin/api/media/tm-own/frames/sd/0000.glb?v='), `the owner's own project stays on the gated route (${r.json?.media}, ${r.json?.frames?.[0]?.sd})`);
  r = await owner('GET', '/admin/api/projects/tm-priv');
  t.eq(r.json?.media, '/admin/api/media/tm-priv', 'and so does a privatised template');
  r = await owner('PUT', '/admin/api/projects/tm-reel', { json: { title: 'A reel' } });
  t.ok(r.json?.media === base && r.json?.updated_at > v, `an owner tool's answer names the base as well, at the new version (${r.json?.media})`);
  const v2 = r.json?.updated_at;
  t.report();

  // --- serving, and the headers of §4 ---------------------------------------------
  t = checks('functions: /m/ serves listed templates, with the headers of §4');
  const framePath = `/m/tm-reel/frames/sd/0000.glb?v=${v2}`;
  r = await call('GET', framePath);
  t.ok(r.status === 200 && same(r.bytes, frame), `a frame at the current version streams (${r.status}, ${r.bytes.length} bytes)`);
  t.eq(h(r, 'content-type'), 'model/gltf-binary', 'typed by its name');
  t.eq(h(r, 'cache-control'), IMMUTABLE, 'and kept for good: the version names these bytes');
  t.eq(h(r, 'x-content-type-options'), 'nosniff', 'never sniffed');
  t.eq(h(r, 'content-security-policy'), "default-src 'none'; sandbox", 'sandboxed when opened on its own');
  t.eq(h(r, 'content-disposition'), null, 'a frame names no disposition, as before');
  t.eq(h(r, 'access-control-allow-origin'), APP, "the app's pages may read it (APP_ORIGIN)");
  t.ok(/(^|,\s*)origin(\s*,|$)/i.test(h(r, 'vary') ?? ''), `with Vary: Origin (${h(r, 'vary')})`);
  t.eq(h(r, 'cross-origin-resource-policy'), 'same-site', 'and embed it from a sibling host');
  t.eq(h(r, 'strict-transport-security'), null, 'no HSTS from a Function on the app host');
  t.ok(/^"[^"]+"$/.test(h(r, 'etag') ?? '') && !Number.isNaN(Date.parse(h(r, 'last-modified'))) && h(r, 'accept-ranges') === 'bytes', `validators and ranges are offered (${h(r, 'etag')}, ${h(r, 'last-modified')})`);
  r = await call('GET', `/m/tm-reel/thumb.jpg?v=${v2}`);
  t.ok(r.status === 200 && same(r.bytes, thumb) && h(r, 'content-type') === 'image/jpeg', `a thumbnail is a JPEG (${r.status} ${h(r, 'content-type')})`);
  t.ok(h(r, 'content-disposition') === 'inline' && h(r, 'cache-control') === IMMUTABLE, `shown inline, kept for good (${h(r, 'content-disposition')}; ${h(r, 'cache-control')})`);
  r = await call('GET', pathOf(sceneManifest?.scene?.file));
  t.ok(r.status === 200 && same(r.bytes, sceneBytes) && h(r, 'content-type') === 'application/x-bozzetto', `a scene is a Bozzetto scene (${r.status} ${h(r, 'content-type')})`);
  t.eq(h(r, 'cache-control'), REVALIDATE, 'revalidated on every read, ?v= or not: it is re-saved in place');
  t.eq(h(r, 'content-disposition'), `attachment; filename="Clay _study___ _.bozz"; filename*=UTF-8''Clay%20_study___%20%C3%A9.bozz`, 'downloaded under its title: plain ASCII, no quote, slash or line break, and the whole title in filename*');
  for (const [what, path] of [
    ['no version', '/m/tm-reel/frames/sd/0000.glb'],
    ['a past version', `/m/tm-reel/frames/sd/0000.glb?v=${v}`],
    ['two versions', `/m/tm-reel/frames/sd/0000.glb?v=${v2}&v=${v2}`],
    ['no version, a thumbnail', '/m/tm-reel/thumb.jpg'],
  ]) {
    r = await call('GET', path);
    t.ok(r.status === 200 && h(r, 'cache-control') === REVALIDATE, `asked at ${what}, it revalidates: the bytes are whatever is stored now (${r.status} ${h(r, 'cache-control')})`);
  }
  r = await call('GET', '/m/tm-legacy/frames/sd/0000.glb?v=5000');
  t.ok(r.status === 200 && same(r.bytes, LEGACY_FRAME), `a 0.5 template's frame comes from where 0.5 put it (${r.status})`);
  t.eq(h(r, 'content-type'), 'model/gltf-binary', 'typed by its name, not by the text/html it was stored with');
  r = await callHost(FILES_HOST, 'GET', framePath);
  t.ok(r.status === 200 && same(r.bytes, frame), `the files host serves the same (${r.status})`);
  t.ok(h(r, 'strict-transport-security') === 'max-age=31536000' && h(r, 'access-control-allow-origin') === APP && h(r, 'cross-origin-resource-policy') === 'same-site', `with HSTS there, the same CORS and CORP (${h(r, 'strict-transport-security')}, ${h(r, 'access-control-allow-origin')})`);
  for (const path of ['/media/tm-reel/thumb.jpg', '/api/projects/tm-reel', '/admin/api/media/tm-reel/thumb.jpg']) {
    r = await callHost(FILES_HOST, 'GET', path, { headers: asOwner });
    t.ok(r.status === 404 && h(r, 'access-control-allow-origin') === null, `and nothing but /m/: ${path} is the middleware's 404 there (${r.status})`);
  }
  r = await call('GET', `/m/tm-window/thumb.jpg?v=5000`);
  t.ok(r.status === 200 && same(r.bytes, jpeg(55)), `a file is in the member's project folder, put there through a template sharing it (${r.status})`);
  t.report();

  // --- /media/ -------------------------------------------------------------------
  t = checks('functions: /media/ is /m/ under its old name');
  for (const file of [`frames/sd/0000.glb?v=${v2}`, `thumb.jpg?v=${v2}`, 'frames/sd/0000.glb']) {
    const a = await call('GET', `/m/tm-reel/${file}`);
    const b = await call('GET', `/media/tm-reel/${file}`);
    t.ok(b.status === 200 && same(a.bytes, b.bytes) && shape(a) === shape(b), `${file}: the same bytes and headers on both (${a.status}, ${b.status})`);
  }
  const sm = await call('GET', pathOf(sceneManifest?.scene?.file));
  const sm0 = await call('GET', pathOf(sceneManifest?.scene?.file).replace(/^\/m\//, '/media/'));
  t.ok(sm0.status === 200 && shape(sm) === shape(sm0), `a scene too, disposition and all (${sm0.status})`);
  const a404 = await call('GET', '/m/tm-own/thumb.jpg');
  const b404 = await call('GET', '/media/tm-own/thumb.jpg');
  t.ok(b404.status === 404 && shape(a404) === shape(b404), `a private project's file is the same 404 on both (${a404.status}, ${b404.status})`);
  t.report();

  // --- refusals --------------------------------------------------------------------
  t = checks('functions: every refusal is the same 404');
  const missing = await call('GET', '/m/tm-not-there/thumb.jpg');
  t.ok(missing.status === 404 && h(missing, 'cache-control') === 'no-store' && h(missing, 'access-control-allow-origin') === APP, `a project that is not there: 404, kept by no cache, readable by the app (${missing.status})`);
  const privV = (await owner('GET', '/admin/api/projects/tm-priv')).json?.updated_at;
  const refusals = [
    ['a privatised template', '/m/tm-priv/thumb.jpg', {}],
    ['a privatised template, at its version', `/m/tm-priv/thumb.jpg?v=${privV}`, {}],
    ["the owner's own project", '/m/tm-own/frames/sd/0000.glb', {}],
    ["a member's project marked public, its file there", '/m/tm-member/thumb.jpg', {}],
    ['a public row that is no template', '/m/tm-public-own/thumb.jpg', {}],
    ['a listed template without that file', '/m/tm-empty/thumb.jpg', {}],
    ['a listed template without that frame', '/m/tm-reel/frames/sd/0001.glb', {}],
    ['a private one, asked for a span', '/m/tm-priv/thumb.jpg', { range: 'bytes=0-9' }],
    ['a private one, asked for a span past its end', '/m/tm-priv/thumb.jpg', { range: 'bytes=99999-' }],
    ['a private one, asked conditionally', '/m/tm-priv/thumb.jpg', { 'if-none-match': '*' }],
    ['a private one on /media/', '/media/tm-priv/thumb.jpg', {}],
    ['a private one, with the owner header Access does not vouch for here', '/m/tm-own/thumb.jpg', asOwner],
  ];
  for (const name of ['data.json', 'frames/sd/1.glb', 'frames/sd/00000.glb', 'frames/sd/0000.glb.gz', 'frames/hd/0000.glb', 'frames/sd/-001.glb', 'THUMB.JPG', 'thumb.jpg/x', 'scene.bozz.tmp', '']) {
    refusals.push([`a name outside the set (${JSON.stringify(name)})`, `/m/tm-reel/${name}`, {}]);
  }
  // Each against a project that is not there, asked the same way: the dev
  // server compresses an answer unless it was asked for a span.
  const unlike = [];
  for (const [what, path, headers] of refusals) {
    const [res, none] = [await call('GET', path, { headers }), await call('GET', '/m/tm-not-there/thumb.jpg', { headers })];
    if (res.status !== 404 || shape(res) !== shape(none)) unlike.push(`${what}: ${res.status}`);
  }
  t.ok(unlike.length === 0, `${refusals.length} refusals answer exactly as a project that is not there${unlike.length ? ` (not: ${unlike.join('; ')})` : ''}`);
  const filesMissing = await callHost(FILES_HOST, 'GET', '/m/tm-not-there/thumb.jpg');
  const filesUnlike = [];
  for (const [what, path, headers] of refusals.filter(([, path]) => path.startsWith('/m/'))) {
    const [res, none] = [await callHost(FILES_HOST, 'GET', path, { headers }), await callHost(FILES_HOST, 'GET', '/m/tm-not-there/thumb.jpg', { headers })];
    if (res.status !== 404 || shape(res) !== shape(none)) filesUnlike.push(`${what}: ${res.status}`);
  }
  t.ok(filesMissing.status === 404 && h(filesMissing, 'strict-transport-security') === 'max-age=31536000' && filesUnlike.length === 0, `and alike on the files host, HSTS included${filesUnlike.length ? ` (not: ${filesUnlike.join('; ')})` : ''}`);
  // Sent as written: fetch would resolve the dot segments before sending.
  const rawMissing = await callHost(appHost, 'GET', '/m/tm-not-there/thumb.jpg');
  const traversals = [
    '/m/tm-reel/../tm-own/thumb.jpg',
    '/m/tm-reel/%2e%2e/tm-own/thumb.jpg',
    '/m/tm-reel/frames/sd/..%2F..%2Fthumb.jpg',
    '/m/tm-reel/frames/sd/..%2F..%2F..%2Ftm-own%2Fthumb.jpg',
    '/m/..%2Ftm-own/thumb.jpg',
    '/m/tm-reel%2F..%2Ftm-own/thumb.jpg',
    '/m/tm-reel\\..\\tm-own\\thumb.jpg',
    '/m/tm-reel/thumb.jpg%00',
    '/m/tm-reel/thumb.jpg%2F..%2F..%2Ftm-own%2Fthumb.jpg',
    '/m/tm-reel/frames/sd/0000.glb%2F..%2F..%2F..%2Fthumb.jpg',
  ];
  const escaped = [];
  for (const path of traversals) {
    const res = await callHost(appHost, 'GET', path);
    if (shape(res) !== shape(rawMissing)) escaped.push(`${path}: ${res.status}`);
  }
  t.ok(escaped.length === 0, `paths that climb out of a project, or smuggle a name past the set, are that 404 too${escaped.length ? ` (not: ${escaped.join('; ')})` : ''}`);
  t.report();

  // --- Range and conditions ----------------------------------------------------------
  t = checks('functions: ranges and conditional requests');
  const plainPath = '/m/tm-reel/frames/sd/0000.glb';
  const span = async (path, range, extra = {}) => call('GET', path, { headers: { range, ...extra } });
  r = await span(plainPath, 'bytes=0-99');
  t.ok(r.status === 206 && h(r, 'content-range') === 'bytes 0-99/6000' && same(r.bytes, frame.slice(0, 100)), `bytes=0-99 is those 100 bytes (${r.status} ${h(r, 'content-range')})`);
  t.ok(h(r, 'cache-control') === REVALIDATE && h(r, 'access-control-allow-origin') === APP && h(r, 'content-type') === 'model/gltf-binary', 'with the headers a whole file has');
  r = await span(plainPath, 'bytes=5900-');
  t.ok(r.status === 206 && h(r, 'content-range') === 'bytes 5900-5999/6000' && same(r.bytes, frame.slice(5900)), `an open-ended span runs to the end (${h(r, 'content-range')})`);
  r = await span(plainPath, 'bytes=-50');
  t.ok(r.status === 206 && h(r, 'content-range') === 'bytes 5950-5999/6000' && same(r.bytes, frame.slice(5950)), `a suffix is the last bytes (${h(r, 'content-range')})`);
  r = await span(plainPath, 'bytes=5990-9999');
  t.ok(r.status === 206 && h(r, 'content-range') === 'bytes 5990-5999/6000' && r.bytes.length === 10, `a span past the end stops at it (${h(r, 'content-range')})`);
  for (const range of ['bytes=6000-', 'bytes=-0', 'bytes=99999999999999999999-']) {
    r = await span(plainPath, range);
    t.ok(r.status === 416 && h(r, 'content-range') === 'bytes */6000' && h(r, 'access-control-allow-origin') === APP, `${range} cannot be satisfied: 416 with the size (${r.status} ${h(r, 'content-range')})`);
  }
  for (const range of ['bytes=0-1,5-6', 'items=0-1', 'bytes=9-3', 'bytes=abc']) {
    r = await span(plainPath, range);
    t.ok(r.status === 200 && same(r.bytes, frame), `${range} is ignored: the whole file (${r.status})`);
  }
  const sceneFile = pathOf(sceneManifest?.scene?.file);
  r = await span(sceneFile, 'bytes=1000-');
  t.ok(r.status === 206 && same(r.bytes, sceneBytes.slice(1000)) && h(r, 'content-disposition')?.startsWith('attachment;'), `a scene download resumes where it stopped (${r.status} ${h(r, 'content-range')})`);
  const etag = h(await call('GET', plainPath), 'etag');
  const modified = h(await call('GET', plainPath), 'last-modified');
  const conditional = [
    ['If-None-Match, the current ETag', { 'if-none-match': etag }, 304],
    ['If-None-Match, among others', { 'if-none-match': `"other", ${etag}` }, 304],
    ['If-None-Match: *', { 'if-none-match': '*' }, 304],
    ['If-None-Match, another ETag', { 'if-none-match': '"other"' }, 200],
    ['If-Modified-Since, its own date', { 'if-modified-since': modified }, 304],
    ['If-Modified-Since, long before', { 'if-modified-since': 'Mon, 01 Jan 2001 00:00:00 GMT' }, 200],
    ['If-Match, the current ETag', { 'if-match': etag }, 200],
    ['If-Match, another', { 'if-match': '"other"' }, 412],
    ['If-Unmodified-Since, long before', { 'if-unmodified-since': 'Mon, 01 Jan 2001 00:00:00 GMT' }, 412],
    ['If-Unmodified-Since, its own date', { 'if-unmodified-since': modified }, 200],
  ];
  for (const [what, headers, want] of conditional) {
    r = await call('GET', plainPath, { headers });
    const empty = r.bytes.length === 0;
    t.ok(r.status === want && (want === 200 ? same(r.bytes, frame) : empty), `${what}: ${want} (${r.status}, ${r.bytes.length} bytes)`);
  }
  r = await call('GET', plainPath, { headers: { 'if-none-match': etag } });
  t.ok(h(r, 'etag') === etag && h(r, 'cache-control') === REVALIDATE && h(r, 'access-control-allow-origin') === APP, 'a 304 says what a 200 would of validity and access');
  r = await span(plainPath, 'bytes=0-9', { 'if-range': etag });
  t.ok(r.status === 206 && r.bytes.length === 10, `If-Range with the current ETag: the span (${r.status})`);
  r = await span(plainPath, 'bytes=0-9', { 'if-range': modified });
  t.ok(r.status === 206 && r.bytes.length === 10, `with its Last-Modified date: the span (${r.status})`);
  for (const [what, ifRange] of [
    ['another ETag', '"other"'],
    ['a weak one', `W/${etag}`],
    ['another date', 'Mon, 01 Jan 2001 00:00:00 GMT'],
  ]) {
    r = await span(plainPath, 'bytes=0-9', { 'if-range': ifRange });
    t.ok(r.status === 200 && same(r.bytes, frame), `If-Range with ${what}: the whole file anew (${r.status})`);
  }
  // The same, answered from the cache, at the current version.
  r = await untilHit(framePath);
  t.ok(h(r, 'cf-cache-status') === 'HIT' && same(r.bytes, frame), `the current version is answered from the cache (${h(r, 'cf-cache-status')})`);
  r = await span(framePath, 'bytes=0-99');
  t.ok(r.status === 206 && h(r, 'content-range') === 'bytes 0-99/6000' && same(r.bytes, frame.slice(0, 100)) && h(r, 'cf-cache-status') === 'HIT', `which serves spans (${r.status} ${h(r, 'content-range')} ${h(r, 'cf-cache-status')})`);
  r = await span(framePath, 'bytes=6000-');
  t.ok(r.status === 416 && h(r, 'content-range') === 'bytes */6000', `refuses one past the end as R2 does (${r.status} ${h(r, 'content-range')})`);
  r = await call('GET', framePath, { headers: { 'if-none-match': etag } });
  t.ok(r.status === 304 && r.bytes.length === 0 && h(r, 'cache-control') === IMMUTABLE && h(r, 'access-control-allow-origin') === APP, `and revalidates (${r.status} ${h(r, 'cf-cache-status')})`);
  r = await call('GET', framePath, { headers: { 'if-match': '"other"' } });
  t.eq(r.status, 412, 'what it cannot judge goes to R2: If-Match');
  t.report();

  // --- the Cache API, behind the row ---------------------------------------------------
  t = checks('functions: the cache answers only for a listed template, at its current version');
  const first = pattern(4000, 71);
  const second = pattern(4000, 72);
  await owner('POST', '/admin/api/projects', { json: { id: 'tm-cache' } });
  await owner('POST', '/admin/api/projects/tm-cache/frames?index=0', { bytes: first });
  const c1 = (await owner('PUT', '/admin/api/projects/tm-cache', { json: { frames: [{ index: 0, tris: 1 }] } })).json?.updated_at;
  const cached = `/m/tm-cache/frames/sd/0000.glb?v=${c1}`;
  r = await call('GET', cached);
  t.ok(r.status === 200 && same(r.bytes, first) && h(r, 'cf-cache-status') !== 'HIT', `the first read is R2's (${r.status} ${h(r, 'cf-cache-status')})`);
  r = await untilHit(cached);
  t.ok(h(r, 'cf-cache-status') === 'HIT' && same(r.bytes, first), `and then the cache's (${h(r, 'cf-cache-status')})`);
  // A frame re-sent without a save keeps its version (the editor saves after),
  // which shows whose answer is whose.
  await owner('POST', '/admin/api/projects/tm-cache/frames?index=0', { bytes: second });
  r = await call('GET', cached);
  t.ok(h(r, 'cf-cache-status') === 'HIT' && same(r.bytes, first), 'the cache keeps answering for that version');
  r = await call('GET', '/m/tm-cache/frames/sd/0000.glb');
  t.ok(same(r.bytes, second) && h(r, 'cf-cache-status') !== 'HIT', 'while a read at no version is never the cache\'s');
  r = await owner('PUT', '/admin/api/projects/tm-cache', { json: { visibility: 'private' } });
  const gone = await call('GET', cached);
  t.ok(r.status === 200 && shape(gone) === shape(missing), `made private, it is the 404 at once, cached or not (${r.status}, then ${gone.status})`);
  const c3 = (await owner('PUT', '/admin/api/projects/tm-cache', { json: { visibility: 'public' } })).json?.updated_at;
  r = await call('GET', cached);
  t.ok(r.status === 200 && same(r.bytes, second) && h(r, 'cf-cache-status') !== 'HIT' && h(r, 'cache-control') === REVALIDATE, `public again, the old entry is never answered from: that version is past (${r.status} ${h(r, 'cache-control')})`);
  r = await call('GET', `/m/tm-cache/frames/sd/0000.glb?v=${c3}`);
  t.ok(r.status === 200 && same(r.bytes, second) && h(r, 'cache-control') === IMMUTABLE, `the current version serves what is stored now (${r.status})`);
  await untilHit(`/m/tm-cache/frames/sd/0000.glb?v=${c3}`);
  r = await owner('POST', '/admin/api/projects/tm-cache/template', { json: { template: false } });
  const off404 = await call('GET', `/m/tm-cache/frames/sd/0000.glb?v=${c3}`);
  t.ok(r.status === 200 && shape(off404) === shape(missing), `switched off as a template, the same (${r.status}, then ${off404.status})`);
  t.report();

  // --- the Template switch, over HTTP ------------------------------------------------
  t = checks('functions: the Template switch');
  const sw = (id, body, headers = asOwner, extra = {}) => call('POST', `/admin/api/projects/${id}/template`, { headers, json: body, ...extra });
  const audited = async (id) => (await call('GET', `/api/dev/audit?subject=${encodeURIComponent(id)}`)).json?.rows ?? [];
  await owner('POST', '/admin/api/projects', { json: { id: 'tm-sw', visibility: 'private' } });
  await owner('POST', '/admin/api/projects/tm-sw/thumb', { bytes: jpeg(81) });
  const at = 1_800_000_000_123;
  r = await sw('tm-sw', { template: true }, { ...asOwner, 'x-test-now': String(at) });
  t.ok(r.status === 200 && r.json?.template === true && r.json?.visibility === 'private', `on: a template, still private, so not yet listed (${r.status} ${r.json?.template} ${r.json?.visibility})`);
  t.ok(r.json?.media === '/admin/api/media/tm-sw' && Object.keys(r.json ?? {}).sort().join(',') === 'created_at,data,fps,id,media,mode,template,title,updated_at,visibility', `answered as PUT answers, with where its files are (${r.json?.media})`);
  let rows = await audited('tm-sw');
  t.ok(rows.length === 1 && rows[0].actor === OWNER && rows[0].action === 'project.template' && rows[0].at === at, `audited: the Access identity as the actor, at the request's time (${JSON.stringify(rows[0])})`);
  t.eq(JSON.stringify(rows[0]?.detail), JSON.stringify({ template: true, from: null, to: null, bytes: 0 }), 'the detail is ids and counts: whose it was, whose it is, its bytes');
  r = await call('GET', '/m/tm-sw/thumb.jpg');
  t.ok(r.status === 404 && !ids((await call('GET', '/api/projects')).json).includes('tm-sw'), `privatised, it is neither served nor listed (${r.status})`);
  r = await owner('PUT', '/admin/api/projects/tm-sw', { json: { visibility: 'public' } });
  const listedSw = ((await call('GET', '/api/projects')).json ?? []).find((p) => p.id === 'tm-sw');
  t.ok(r.json?.template === true && listedSw?.media === `http://${FILES_HOST}/m/tm-sw`, `on a template, Public lists it (${listedSw?.media})`);
  r = await call('GET', `/m/tm-sw/thumb.jpg?v=${listedSw?.updated_at}`);
  t.ok(r.status === 200 && same(r.bytes, jpeg(81)), `and serves its files (${r.status})`);
  r = await sw('tm-sw', { template: true });
  t.ok(r.status === 200 && r.json?.template === true && (await audited('tm-sw')).length === 1, 'on again changes nothing, and records nothing');
  r = await sw('tm-sw', { template: false });
  t.ok(r.status === 200 && r.json?.template === false && r.json?.visibility === 'private' && r.json?.media === '/admin/api/media/tm-sw', `off: the owner's again, private (${r.json?.template} ${r.json?.visibility})`);
  const back = await Promise.all([call('GET', '/m/tm-sw/thumb.jpg'), call('GET', '/api/projects/tm-sw'), call('GET', '/api/projects')]);
  t.ok(back[0].status === 404 && back[1].status === 404 && !ids(back[2].json).includes('tm-sw'), `and off the gallery at once: files, manifest and list (${back[0].status}, ${back[1].status})`);
  r = await owner('GET', '/admin/api/projects');
  const mine = (r.json ?? []).find((p) => p.id === 'tm-sw');
  t.ok(mine?.template === false && mine?.media === '/admin/api/media/tm-sw', 'owner tools still reach it, with no owner account to hand it to');
  rows = await audited('tm-sw');
  t.ok(rows.length === 2 && JSON.stringify(rows[1].detail) === JSON.stringify({ template: false, from: null, to: null, bytes: 0 }), `off is audited too (${JSON.stringify(rows[1]?.detail)})`);
  r = await sw('tm-sw', { template: false });
  t.ok(r.status === 200 && (await audited('tm-sw')).length === 2, 'and off again is nothing');
  await owner('POST', '/admin/api/projects', { json: { id: 'tm-sw-put', visibility: 'private' } });
  r = await owner('PUT', '/admin/api/projects/tm-sw-put', { json: { visibility: 'public' } });
  rows = await audited('tm-sw-put');
  t.ok(r.json?.template === true && rows.length === 1 && rows[0].action === 'project.template' && rows[0].detail?.template === true, `made public by PUT, a project becomes a template the same way, audited (${rows.length} row)`);
  const refused = [
    ['no identity', () => sw('tm-own', { template: true }, {}), 403],
    ['an identity ADMIN_EMAILS does not name', () => sw('tm-own', { template: true }, asStranger), 403],
    ['template as a string', () => sw('tm-own', { template: 'true' }), 400],
    ['no template at all', () => sw('tm-own', {}), 400],
    ['a body that is not JSON', () => call('POST', '/admin/api/projects/tm-own/template', { headers: asOwner, body: 'template=true', type: 'text/plain' }), 415],
    ["a member's project", () => sw('tm-member-private', { template: true }), 404],
    ["a member's project marked public", () => sw('tm-member', { template: true }), 404],
    ['a project that is not there', () => sw('tm-not-there', { template: true }), 404],
    ['another site', () => sw('tm-own', { template: true }, { ...asOwner, origin: 'https://evil.example' }), 403],
  ];
  for (const [what, ask, want] of refused) {
    r = await ask();
    t.eq(r.status, want, `${what}: ${want}`);
  }
  r = await owner('GET', '/admin/api/projects/tm-own');
  const untouched = (await audited('tm-own')).length + (await audited('tm-member')).length + (await audited('tm-member-private')).length;
  t.ok(r.json?.template === false && untouched === 0, `none of them changed or recorded anything (${r.json?.template}, ${untouched} rows)`);
  r = await callHost(DEPLOYED_HOST, 'GET', '/api/dev/audit?subject=tm-sw');
  t.ok(r.status === 404 && r.json?.code === 'not_found', `the audit hook is not there off loopback (${r.status})`);
  t.report();

  // --- directly, with an owner account -----------------------------------------------
  t = checks('functions: the Template switch, directly, with an owner account');
  const db = await migratedDatabase(repo);
  if (!db) {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the switch with an owner account was not checked');
  } else {
    const load = await compileShared();
    const projects = await load('projects');
    const audit = await load('auth/audit');
    const U = 'u-owner00000000000000000000';
    const M = 'u-member0000000000000000000';
    const user = (id, handle, role, used) =>
      db
        .prepare("INSERT INTO users (id, handle, email, webauthn_user_id, role, bytes_used, terms_version, terms_accepted_at, age_confirmed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '2026-10', 0, 0, 0, 0)")
        .run(id, handle, `${handle}@example.com`, `wa-${handle}`, role, used);
    const project = (id, ownerId, template, visibility, bytes) =>
      db
        .prepare('INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, bytes, created_at, updated_at) VALUES (?, ?, ?, 4, ?, ?, ?, ?, ?, ?, 1, 1)')
        .run(id, id, 'timelapse', DATA, visibility, template, ownerId, ownerId ? `users/${ownerId}/projects/${id}/` : null, bytes);
    user(U, 'owner', 'owner', 5000);
    user(M, 'member', 'member', 700);
    project('d-own', U, 0, 'private', 1200);
    project('d-tpl', null, 1, 'public', 300);
    project('d-big', U, 0, 'private', 99999);
    project('d-put', U, 0, 'private', 400);
    project('d-race', U, 0, 'private', 10);
    project('d-member', M, 0, 'private', 700);
    let raced = false;
    const env = {
      DB: d1(db, {
        beforeBatch: () => {
          if (raced) db.prepare("UPDATE projects SET bytes = bytes + 1 WHERE id = 'd-race'").run();
        },
      }),
    };
    const used = (id) => db.prepare('SELECT bytes_used AS n FROM users WHERE id = ?').get(id).n;
    const proj = (id) => ({ ...db.prepare('SELECT owner_id, template, visibility, updated_at FROM projects WHERE id = ?').get(id) });
    const rowsAbout = (id) => db.prepare('SELECT at, actor, action, detail FROM audit_log WHERE subject = ? ORDER BY id').all(id).map((x) => ({ ...x, detail: JSON.parse(x.detail) }));
    const by = { actor: OWNER, at: 42 };
    const scopeU = { owner: U };
    const attempt = async (fn) => {
      try {
        return await fn();
      } catch (err) {
        return `${err.status} ${err.message}`;
      }
    };

    let res = await projects.setTemplate(env, 'd-own', true, scopeU, by);
    t.ok(res.template === 1 && res.owner_id === null && res.visibility === 'private' && res.updated_at > 1, `on: nobody's, still private, a new version (${JSON.stringify(proj('d-own'))})`);
    t.eq(used(U), 3800, "its 1,200 bytes leave the owner's usage");
    let about = rowsAbout('d-own');
    t.ok(about.length === 1 && about[0].actor === OWNER && about[0].at === 42 && JSON.stringify(about[0].detail) === JSON.stringify({ template: true, from: U, to: null, bytes: 1200 }), `one audit row, naming the account by its id alone (${JSON.stringify(about[0])})`);
    res = await projects.setTemplate(env, 'd-own', false, scopeU, by);
    t.ok(res.template === 0 && res.owner_id === U && res.visibility === 'private', `off: the owner account's again, private (${JSON.stringify(proj('d-own'))})`);
    t.eq(used(U), 5000, 'and its bytes are back on their usage');
    about = rowsAbout('d-own');
    t.ok(about.length === 2 && JSON.stringify(about[1].detail) === JSON.stringify({ template: false, from: null, to: U, bytes: 1200 }), `audited (${JSON.stringify(about[1]?.detail)})`);
    res = await projects.setTemplate(env, 'd-own', false, scopeU, by);
    t.ok(rowsAbout('d-own').length === 2 && used(U) === 5000, 'off again: nothing moves, nothing is recorded');
    res = await projects.setTemplate(env, 'd-tpl', false, { owner: null }, by);
    t.ok(res.owner_id === U && res.visibility === 'private' && used(U) === 5300, `a template switched off while owner tools act as no account still goes to the owner's account (${res.owner_id}, ${used(U)})`);
    res = await projects.setTemplate(env, 'd-big', true, scopeU, by);
    t.eq(used(U), 0, 'usage is never taken below nothing, whatever the count says');
    res = await attempt(() => projects.setTemplate(env, 'd-member', true, scopeU, by));
    t.ok(res === '404 Not found' && used(M) === 700 && proj('d-member').owner_id === M && rowsAbout('d-member').length === 0, `a member's project is not found, and untouched (${res})`);
    db.prepare('UPDATE users SET bytes_used = 5000 WHERE id = ?').run(U);
    res = await projects.updateProject(env, 'd-put', { visibility: 'public' }, scopeU, by);
    t.ok(res.template === 1 && res.owner_id === null && used(U) === 4600 && rowsAbout('d-put')[0]?.detail?.bytes === 400, `made public by an update, the same hand-over: its 400 bytes leave, audited (${used(U)})`);
    raced = true;
    res = await attempt(() => projects.setTemplate(env, 'd-race', true, scopeU, by));
    raced = false;
    t.ok(String(res).startsWith('409') && used(U) === 4600 && proj('d-race').template === 0 && rowsAbout('d-race').length === 0, `a row changed between the read and the write: 409, and nothing moved or was recorded (${res})`);
    db.prepare("UPDATE users SET role = 'member' WHERE id = ?").run(U);
    project('d-tpl2', null, 1, 'public', 50);
    res = await projects.setTemplate(env, 'd-tpl2', false, { owner: null }, by);
    t.ok(res.owner_id === null && res.template === 0 && res.visibility === 'private' && used(U) === 4600, `with no owner account, off leaves it nobody's, as the owner's projects are until the bootstrap (${res.owner_id})`);

    await audit.audit(env, { actor: OWNER, action: 'test.detail', subject: 'd-detail', detail: { note: 'sent by owner@example.com', n: 1 } });
    about = rowsAbout('d-detail');
    t.ok(about[0]?.at > 0 && !JSON.stringify(about[0]?.detail).includes('@') && about[0]?.detail?.n === 1, `an address that strays into a detail is not written down (${JSON.stringify(about[0]?.detail)})`);
    db.close();
  }
  t.report();

  // --- the media base, directly -----------------------------------------------------
  t = checks('functions: the media base, with and without MEDIA_ORIGIN');
  {
    const load = await compileShared();
    const projects = await load('projects');
    const { error } = console;
    console.error = () => {}; // a misconfiguration is logged once; these make one on purpose
    try {
      const listedRow = { id: 'x-1', title: 'x', mode: 'timelapse', fps: 4, data: DATA_ONE_FRAME, visibility: 'public', template: 1, updated_at: 7 };
      const privateRow = { ...listedRow, visibility: 'private' };
      const both = { MEDIA_ORIGIN: 'https://files.example/', APP_ORIGIN: 'https://app.example' };
      t.eq(projects.mediaBase(listedRow, {}), '/media/x-1', "no MEDIA_ORIGIN: this origin's /media/, which installed 0.5 desktop apps can reach");
      t.eq(projects.toManifest(listedRow, {}).frames[0].sd, '/media/x-1/frames/sd/0000.glb?v=7', 'and the frames under it');
      t.eq(projects.toManifest({ ...listedRow, mode: 'scene', data: JSON.stringify({ ...JSON.parse(DATA), scene: { objects: 1, tris: 2, bytes: 3 } }) }, {}).scene.file, '/media/x-1/scene.bozz?v=7', 'and a scene\'s file');
      t.eq(projects.mediaBase(listedRow, both), 'https://files.example/m/x-1', 'with it (and APP_ORIGIN): the files host, as an origin');
      t.eq(projects.toManifest(listedRow, both).frames[0].sd, 'https://files.example/m/x-1/frames/sd/0000.glb?v=7', 'and the frames there');
      t.eq(projects.mediaBase(listedRow, { MEDIA_ORIGIN: 'https://files.example' }), '/media/x-1', 'MEDIA_ORIGIN without APP_ORIGIN stays here: the files host could not answer the app');
      t.eq(projects.mediaBase(listedRow, { ...both, MEDIA_ORIGIN: 'files.example' }), '/media/x-1', 'nor does a MEDIA_ORIGIN that is no origin move anything');
      t.eq(projects.mediaBase(privateRow, both), '/admin/api/media/x-1', 'a privatised template is on the gated route whatever is set');
      t.eq(projects.mediaBase({ ...listedRow, template: 0 }, both), '/admin/api/media/x-1', 'and so is a row that is no template');
    } finally {
      console.error = error;
    }
  }
  t.report();
}
