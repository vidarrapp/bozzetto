// What owner tools take in: request bodies of every kind, refused before
// they can do harm, and a scene's file uploaded in parts.
import { FILES_HOST, MiB, asOwner, asStranger, bozz, bozzOf, concat, ids, jpeg, parts, pattern, same } from '../lib.mjs';

export const needs = ['off'];

export async function run({ checks, off }) {
  const { call } = off;
  const frame = pattern(4096, 7);
  const thumb = jpeg(99);

  // --- request bodies -----------------------------------------------------
  let t = checks('functions: request bodies');
  const made = await call('POST', '/admin/api/projects', { headers: asOwner, json: { id: 'up-tl', title: 'Upload target' } });
  const f0 = await call('POST', '/admin/api/projects/up-tl/frames?index=0', { headers: asOwner, bytes: frame });
  const th0 = await call('POST', '/admin/api/projects/up-tl/thumb', { headers: asOwner, bytes: thumb });
  t.ok(made.status === 201 && f0.status === 201 && th0.status === 201, `a timelapse with a frame and a thumbnail to aim at (${made.status}, ${f0.status}, ${th0.status})`);
  const post = (body, type) => call('POST', '/admin/api/projects', { headers: asOwner, body, type });
  let r = await post(new TextEncoder().encode('{"id":"up-untyped"}'));
  t.eq(r.status, 415, 'a JSON body with no content-type is refused');
  r = await post('{"id":"up-plain"}', 'text/plain');
  t.eq(r.status, 415, 'and one sent as text/plain, which a page on another site can send unasked');
  r = await post('{"id":"up-with-charset"}', 'application/json; charset=utf-8');
  t.eq(r.status, 201, 'application/json with a charset is taken');
  r = await post('{"id": "broken"', 'application/json');
  t.ok(r.status === 400 && typeof r.json?.error === 'string', `malformed JSON is a 400, not a 500 (${r.status} ${r.json?.error})`);
  r = await post('["an", "array"]', 'application/json');
  t.eq(r.status, 400, 'so is JSON that is not an object');
  r = await post('null', 'application/json');
  t.eq(r.status, 400, 'null included');
  r = await call('PUT', '/admin/api/projects/up-tl', { headers: asOwner, body: '{"title":', type: 'application/json' });
  t.eq(r.status, 400, 'a malformed update is a 400 too');
  r = await call('PUT', '/admin/api/projects/up-tl', { headers: asOwner, json: { lighting: { note: '€'.repeat(600_000) } } });
  t.eq(r.status, 413, 'project data is measured in bytes: 600,000 three-byte characters are over the 1.5 MB limit');
  const stray = pattern(2048, 5);
  for (const q of ['', '?index=', '?index=abc', '?index=-1', '?index=1.5', '?index=1e3', '?index=10000']) {
    r = await call('POST', `/admin/api/projects/up-tl/frames${q}`, { headers: asOwner, bytes: stray });
    t.eq(r.status, 400, `a frame upload with ${q ? JSON.stringify(q) : 'no index'} is refused`);
  }
  r = await call('GET', '/media/up-tl/frames/sd/0000.glb');
  t.ok(r.status === 200 && same(r.bytes, frame), 'and frame 0 is untouched: a missing index used to be read as 0');
  r = await call('POST', '/admin/api/projects/up-tl/frames?index=9999', { headers: asOwner, bytes: stray });
  t.eq(r.status, 201, 'the highest index there can be is taken');
  r = await call('PUT', '/admin/api/projects/up-tl', { headers: asOwner, json: { frames: [{ index: 10000, tris: 1 }] } });
  t.eq(r.status, 400, 'and a frame list naming an index past it is refused');
  r = await call('POST', '/admin/api/projects/up-tl/thumb', { headers: asOwner, bytes: pattern(512, 99) });
  t.eq(r.status, 415, 'a thumbnail that is not a JPEG is refused');
  r = await call('POST', '/admin/api/projects/up-tl/thumb', { headers: asOwner, bytes: concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), pattern(64, 1)) });
  t.eq(r.status, 415, 'a PNG included: it would be served as image/jpeg');
  r = await call('GET', '/media/up-tl/thumb.jpg');
  t.ok(r.status === 200 && same(r.bytes, thumb), 'and the stored thumbnail is untouched');
  t.report();

  // --- scenes -------------------------------------------------------------
  t = checks('functions: scenes');
  r = await call('POST', '/admin/api/projects', { headers: asOwner, json: { mode: 'scene', title: 'Clay study' } });
  const scene = r.json?.id;
  t.ok(r.status === 201 && /^scene-[a-z0-9-]+$/.test(scene ?? ''), `a scene needs no id; the server picks one (${r.status} ${scene})`);
  t.ok(r.json?.mode === 'scene' && r.json?.visibility === 'private', `and it starts private (${r.json?.mode}, ${r.json?.visibility})`);
  r = await call('GET', `/admin/api/projects/${scene}`, { headers: asOwner });
  t.ok(r.status === 200 && r.json?.scene === null, `before an upload completes it has no file (${JSON.stringify(r.json?.scene)})`);

  const start = await call('POST', `/admin/api/projects/${scene}/scene`, { headers: asOwner });
  const upload = start.json?.uploadId;
  t.ok(start.status === 201 && typeof upload === 'string' && start.json?.partSize === 8 * MiB, `an upload starts, asking for 8 MiB parts (${start.status}, ${start.json?.partSize})`);
  // A scene file as the app writes one, gzipped, a little over one part.
  const [first, last] = parts(bozzOf(8 * MiB + 300_000, 1), 8 * MiB);
  const u = encodeURIComponent(upload ?? '');
  const p1 = await call('PUT', `/admin/api/projects/${scene}/scene?upload=${u}&part=1`, { headers: asOwner, bytes: first });
  const p2 = await call('PUT', `/admin/api/projects/${scene}/scene?upload=${u}&part=2`, { headers: asOwner, bytes: last });
  t.ok(p1.status === 201 && p2.status === 201 && p1.json?.part === 1 && !!p1.json?.etag && p2.json?.part === 2, `two parts land, each with its etag (${p1.status}, ${p2.status})`);
  r = await call('PUT', `/admin/api/projects/${scene}/scene?upload=${u}&part=3`, { headers: asStranger, bytes: last });
  t.eq(r.status, 403, 'a part from a stranger is refused');
  r = await call('POST', `/admin/api/projects/${scene}/scene?upload=${u}`, { headers: asOwner, body: '{"parts": [', type: 'application/json' });
  t.eq(r.status, 400, 'a malformed part list is a 400, and leaves the upload open');
  r = await call('POST', `/admin/api/projects/${scene}/scene?upload=${u}`, {
    headers: asOwner,
    json: { parts: [p1.json, p2.json], objects: 3, tris: 12345 },
  });
  const whole = concat(first, last);
  t.ok(r.status === 200 && r.json?.scene?.objects === 3 && r.json?.scene?.tris === 12345, `completing records the counts (${r.status} ${JSON.stringify(r.json?.scene)})`);
  t.eq(r.json?.scene?.bytes, whole.length, 'and the size R2 measured');
  const fileUrl = r.json?.scene?.file ?? '';
  t.ok(fileUrl.startsWith(`/admin/api/media/${scene}/scene.bozz?v=`), `the file is on the gated route while private (${fileUrl})`);
  const firstVersion = r.json?.updated_at;
  r = await call('GET', fileUrl, { headers: asOwner });
  t.ok(r.status === 200 && same(r.bytes, whole), `the owner reads back exactly what was sent (${r.status}, ${r.bytes.length} bytes)`);
  t.eq(r.headers.get('content-type'), 'application/x-bozzetto', 'typed as a Bozzetto scene');
  r = await call('GET', `/media/${scene}/scene.bozz`);
  t.eq(r.status, 404, 'nobody else can fetch a private scene by guessing its id');
  r = await call('GET', '/api/projects');
  t.ok(!ids(r.json).includes(scene), 'and the public list leaves it out');
  r = await call('GET', '/admin/api/projects', { headers: asOwner });
  const listed = (r.json ?? []).find((p) => p.id === scene);
  t.ok(listed?.mode === 'scene' && listed?.visibility === 'private' && listed?.scene?.objects === 3 && listed?.scene?.bytes === whole.length, `the owner list has it with its counts and size (${JSON.stringify(listed?.scene)})`);

  r = await call('PUT', `/admin/api/projects/${scene}`, { headers: asOwner, json: { visibility: 'public' } });
  t.ok(r.status === 200 && r.json?.visibility === 'public', `a scene can be made public (${r.status})`);
  r = await call('GET', `/media/${scene}/scene.bozz`);
  t.ok(r.status === 200 && same(r.bytes, whole), `then /media serves it (${r.status})`);
  t.eq(r.headers.get('cache-control'), 'public, no-cache', 'revalidated on every read, since a re-save replaces it in place');
  r = await call('GET', `/api/projects/${scene}`);
  t.ok(r.status === 200 && r.json?.scene?.file?.startsWith(`http://${FILES_HOST}/m/${scene}/scene.bozz?v=`), `and its public manifest points at /m/ on the files host (${r.json?.scene?.file})`);
  r = await call('GET', '/api/projects');
  t.ok(ids(r.json).includes(scene), 'and the public list has it');

  // Re-save in place: a new upload replaces the file and moves ?v= on.
  const again = await call('POST', `/admin/api/projects/${scene}/scene`, { headers: asOwner });
  const u2 = encodeURIComponent(again.json?.uploadId ?? '');
  const small = bozz({ vertices: 20, seed: 3 });
  const q1 = await call('PUT', `/admin/api/projects/${scene}/scene?upload=${u2}&part=1`, { headers: asOwner, bytes: small });
  r = await call('POST', `/admin/api/projects/${scene}/scene?upload=${u2}`, {
    headers: asOwner,
    json: { parts: [q1.json], objects: 1, tris: 50 },
  });
  t.ok(r.status === 200 && r.json?.scene?.objects === 1 && r.json?.scene?.bytes === small.length, `a re-save replaces the file in place (${r.status} ${JSON.stringify(r.json?.scene)})`);
  t.ok(r.json?.updated_at > firstVersion, 'and moves the version on');
  r = await call('GET', `/media/${scene}/scene.bozz`);
  t.ok(r.status === 200 && same(r.bytes, small), `the new bytes are what is served (${r.bytes.length} bytes)`);

  r = await call('PUT', `/admin/api/projects/${scene}`, { headers: asOwner, json: { title: 'Renamed study', mode: 'timelapse' } });
  t.ok(r.status === 200 && r.json?.title === 'Renamed study', `renaming works (${r.json?.title})`);
  t.eq(r.json?.mode, 'scene', 'and a scene cannot be switched to another mode');
  r = await call('PUT', `/admin/api/projects/${scene}/scene?upload=not-an-upload&part=1`, { headers: asOwner, bytes: small });
  t.eq(r.status, 404, 'a part for an upload that does not exist is a 404');
  // Local R2 answers this one with a generic internal error (10001) where
  // the real one names the upload (10024), so the status is not pinned:
  // what matters is that it fails and leaves the stored file alone.
  r = await call('POST', `/admin/api/projects/${scene}/scene?upload=not-an-upload`, {
    headers: asOwner,
    json: { parts: [{ part: 1, etag: 'x' }], objects: 1, tris: 1 },
  });
  const kept = await call('GET', `/media/${scene}/scene.bozz`);
  t.ok(r.status >= 400 && same(kept.bytes, small), `completing an upload that does not exist fails (${r.status}) and leaves the file alone`);
  const dropped = await call('POST', `/admin/api/projects/${scene}/scene`, { headers: asOwner });
  const u3 = encodeURIComponent(dropped.json?.uploadId ?? '');
  await call('PUT', `/admin/api/projects/${scene}/scene?upload=${u3}&part=1`, { headers: asOwner, bytes: small });
  r = await call('DELETE', `/admin/api/projects/${scene}/scene?upload=${u3}`, { headers: asOwner });
  t.ok(r.status === 200 && r.json?.aborted === true, `an upload can be abandoned (${r.status})`);
  r = await call('GET', `/media/${scene}/scene.bozz`);
  t.ok(r.status === 200 && same(r.bytes, small), 'which leaves the stored file as it was');
  r = await call('POST', '/admin/api/projects/up-tl/scene', { headers: asOwner });
  t.eq(r.status, 400, 'a timelapse takes no scene upload');
  r = await call('POST', '/admin/api/projects', { headers: asOwner, json: { id: 'up-tl-2', mode: 'timelapse' } });
  const tl2 = await call('PUT', '/admin/api/projects/up-tl-2', { headers: asOwner, json: { mode: 'scene' } });
  t.eq(tl2.json?.mode, 'timelapse', 'and nothing else becomes a scene by an update');

  r = await call('DELETE', `/admin/api/projects/${scene}`, { headers: asOwner });
  t.ok(r.status === 200 && r.json?.deleted === true, `deleting the scene (${r.status})`);
  r = await call('GET', `/admin/api/media/${scene}/scene.bozz`, { headers: asOwner });
  t.eq(r.status, 404, 'takes its file with it');
  r = await call('GET', '/admin/api/projects', { headers: asOwner });
  t.ok(!ids(r.json).includes(scene), 'and it leaves the owner list');
  t.report();
}
