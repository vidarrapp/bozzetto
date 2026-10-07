// An account's own files, on GET /api/me/media/<id>/<file> (docs/accounts.md
// §4): to the row's owner alone, typed by name, nosniff, sandboxed,
// `private, no-store`, CORP same-origin and no CORS; a scene a download
// named after its project, any file one with ?download=1; Range and
// conditional requests as on /m/; and the same 404 for a file that is
// missing, not yours, or asked for signed out. The manifest and list name
// this route.
import { Browser, bozz, glb, jpeg, same, seedSession, seedUser, seededToken } from '../lib.mjs';

export const needs = ['on'];

const T = 3_000_000_000_000;
const OWNER = 'u-mpowner0000000000000000000';
const OTHER = 'u-mpother0000000000000000000';

export const seed = {
  sql: [
    seedUser({ id: OWNER, handle: 'mpowner' }),
    seedUser({ id: OTHER, handle: 'mpother' }),
    seedSession({ name: 'mp-owner', id: 's-mpowner', user: OWNER, created: T }),
    seedSession({ name: 'mp-other', id: 's-mpother', user: OTHER, created: T }),
  ].join('\n'),
};

export async function run({ checks, on }) {
  const clock = { now: T + 60_000 };
  const as = (name, ip) => {
    const b = new Browser(on, { ip, clock });
    b.jar.set('__Host-bz_session', seededToken(name));
    return b;
  };
  const me = as('mp-owner', '198.51.100.80');
  const other = as('mp-other', '198.51.100.81');

  let t = checks('functions: private media, set up');
  const sc = (await me.call('POST', '/api/me/projects', { json: { title: 'Bust "study" / é', mode: 'scene' } })).json?.id;
  const reel = (await me.call('POST', '/api/me/projects', { json: { title: 'Reel', mode: 'timelapse' } })).json?.id;
  const sceneFile = bozz({ vertices: 120, seed: 41 });
  const up = (await me.call('POST', `/api/me/projects/${sc}/scene`, { json: { size: sceneFile.length } })).json;
  const p1 = await me.call('PUT', `/api/me/projects/${sc}/scene?upload=${up.uploadId}&part=1`, { bytes: sceneFile });
  const done = await me.call('POST', `/api/me/projects/${sc}/scene?upload=${up.uploadId}`, { json: { parts: [p1.json], objects: 2, tris: 3 } });
  const frame = glb({ seed: 42, bin: 3000 });
  const thumb = jpeg(43, 2000);
  const f = await me.call('POST', `/api/me/projects/${reel}/frames?index=7`, { bytes: frame });
  const put = await me.call('PUT', `/api/me/projects/${reel}`, { json: { frames: [{ index: 7, tris: 5 }] } });
  const th = await me.call('POST', `/api/me/projects/${reel}/thumb`, { bytes: thumb });
  t.ok([p1, f, th].every((x) => x.status === 201) && done.status === 200 && put.status === 200, `a scene, a frame and a thumbnail stored (${[p1, done, f, put, th].map((x) => x.status).join(' ')})`);
  t.report();

  // --- where the manifests point ---------------------------------------------------------------
  t = checks('functions: private media, named by the manifests');
  const base = `/api/me/media/${reel}`;
  let r = await me.call('GET', `/api/me/projects/${reel}`);
  t.ok(r.status === 200 && r.json?.media === base && r.json?.visibility === 'private' && r.json?.template === false, `a manifest's base is the private route (${r.json?.media})`);
  t.ok(r.json?.frames?.[0]?.sd === `${base}/frames/sd/0007.glb?v=${r.json?.updated_at}` && r.json?.frames?.[0]?.tris === 5, `its frames are under it (${r.json?.frames?.[0]?.sd})`);
  t.eq(done.json?.scene?.file, `/api/me/media/${sc}/scene.bozz?v=${done.json?.updated_at}`, "and a scene's file");
  r = await me.call('GET', '/api/me/projects');
  const card = (r.json ?? []).find((p) => p.id === reel);
  t.ok(card?.media === base && card?.bytes === frame.length + thumb.length && card?.frameCount === 1, `the list names the same base, with what the project weighs (${JSON.stringify(card && { media: card.media, bytes: card.bytes })})`);
  t.report();

  // --- the headers of §4 -----------------------------------------------------------------------
  t = checks('functions: private media, the headers of §4');
  const h = (res, name) => res.headers.get(name);
  const common = (res) =>
    h(res, 'cache-control') === 'private, no-store' &&
    h(res, 'cross-origin-resource-policy') === 'same-origin' &&
    h(res, 'x-content-type-options') === 'nosniff' &&
    h(res, 'content-security-policy') === "default-src 'none'; sandbox" &&
    h(res, 'access-control-allow-origin') === null;
  r = await me.call('GET', `${base}/thumb.jpg`);
  t.ok(r.status === 200 && same(r.bytes, thumb) && h(r, 'content-type') === 'image/jpeg' && h(r, 'content-disposition') === 'inline', `a thumbnail: image/jpeg, inline (${r.status} ${h(r, 'content-type')} ${h(r, 'content-disposition')})`);
  t.ok(common(r), `kept nowhere, this origin's alone, nosniff, sandboxed, no CORS (${h(r, 'cache-control')} | ${h(r, 'cross-origin-resource-policy')})`);
  r = await me.call('GET', `${base}/frames/sd/0007.glb?v=1`);
  t.ok(r.status === 200 && same(r.bytes, frame) && h(r, 'content-type') === 'model/gltf-binary' && h(r, 'content-disposition') === null && common(r), `a frame: model/gltf-binary, no disposition, the same headers (${r.status} ${h(r, 'content-type')})`);
  r = await me.call('GET', `/api/me/media/${sc}/scene.bozz`);
  t.ok(r.status === 200 && same(r.bytes, sceneFile) && h(r, 'content-type') === 'application/x-bozzetto' && common(r), `a scene: application/x-bozzetto (${r.status} ${h(r, 'content-type')})`);
  t.eq(h(r, 'content-disposition'), `attachment; filename="Bust _study_ _ _.bozz"; filename*=UTF-8''Bust%20_study_%20_%20%C3%A9.bozz`, 'a download named after its project, the whole title in filename*');
  r = await me.call('GET', `${base}/thumb.jpg?download=1`);
  t.ok(r.status === 200 && h(r, 'content-disposition') === 'attachment; filename="Reel.jpg"', `?download=1 makes a thumbnail a download (${h(r, 'content-disposition')})`);
  r = await me.call('GET', `${base}/frames/sd/0007.glb?download=1`);
  t.eq(h(r, 'content-disposition'), 'attachment; filename="Reel-0007.glb"', 'and a frame, by its number');
  t.report();

  // --- ranges and conditions ------------------------------------------------------------------
  t = checks('functions: private media, ranges and conditional requests');
  const path = `/api/me/media/${sc}/scene.bozz`;
  r = await me.call('GET', path, { headers: { range: 'bytes=0-9' } });
  t.ok(r.status === 206 && same(r.bytes, sceneFile.slice(0, 10)) && h(r, 'content-range') === `bytes 0-9/${sceneFile.length}` && common(r), `a span: 206 with Content-Range, the same headers (${r.status} ${h(r, 'content-range')})`);
  r = await me.call('GET', path, { headers: { range: 'bytes=-5' } });
  t.ok(r.status === 206 && same(r.bytes, sceneFile.slice(-5)), `the last five bytes (${r.status} ${h(r, 'content-range')})`);
  r = await me.call('GET', path, { headers: { range: `bytes=${sceneFile.length + 10}-` } });
  t.ok(r.status === 416 && h(r, 'content-range') === `bytes */${sceneFile.length}`, `a span past the end: 416 (${r.status} ${h(r, 'content-range')})`);
  const etag = h(await me.call('GET', path), 'etag');
  r = await me.call('GET', path, { headers: { 'if-none-match': etag } });
  t.ok(r.status === 304 && r.bytes.length === 0 && h(r, 'cache-control') === 'private, no-store', `If-None-Match with its etag: 304, still kept nowhere (${r.status} ${h(r, 'cache-control')})`);
  r = await me.call('GET', path, { headers: { 'if-match': '"not-it"' } });
  t.eq(r.status, 412, 'If-Match with another etag: 412');
  r = await me.call('GET', path, { headers: { range: 'bytes=0-3', 'if-range': etag } });
  t.ok(r.status === 206 && r.bytes.length === 4, `If-Range with its etag: the span (${r.status})`);
  r = await me.call('GET', path, { headers: { range: 'bytes=0-3', 'if-range': '"another"' } });
  t.ok(r.status === 200 && same(r.bytes, sceneFile), `with another: the whole file (${r.status})`);
  t.report();

  // --- not yours, not there ------------------------------------------------------------------------
  t = checks('functions: private media, the one 404');
  const refusals = [];
  const guest = new Browser(on, { ip: '198.51.100.82', clock });
  for (const [who, p, why] of [
    [other, `${base}/thumb.jpg`, 'another account'],
    [guest, `${base}/thumb.jpg`, 'signed out'],
    [me, `${base}/frames/sd/0001.glb`, 'a frame that is not there'],
    [me, `${base}/scene.bozz`, 'a scene a timelapse does not have'],
    [me, `${base}/notes.txt`, 'a file name outside the set'],
    // fetch resolves a bare `..` before sending; encoded, it arrives.
    [me, `${base}/..%2f..%2f${sc}%2fscene.bozz`, 'a path that climbs'],
    [me, '/api/me/media/p-00000000000000000000000000/thumb.jpg', 'a project that is not there'],
  ]) {
    const res = await who.call('GET', p);
    refusals.push(res);
    t.ok(res.status === 404 && h(res, 'cache-control') === 'no-store' && h(res, 'x-content-type-options') === 'nosniff', `${why}: 404 (${res.status})`);
  }
  const bodies = new Set(refusals.map((x) => new TextDecoder().decode(x.bytes)));
  t.eq(bodies.size, 1, 'every one of them the same answer');
  t.report();
}
