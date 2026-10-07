// Where a project's files are in R2 (docs/accounts.md §4): its row's
// storage_prefix, or projects/<id>/ for a row without one, and never a
// path from the URL. R2 cannot be listed from outside, so the rows seeded
// here share prefixes on purpose: a file written through one row and read
// through another shows where it really went.
//
//   keys-custom   users/u-keys/projects/keys-custom/   its own prefix
//   keys-peek     the same prefix: reads what keys-custom wrote
//   keys-shadow   projects/keys-custom/: where keys-custom's files would be
//                 had its key come from its id
//   keys-scene    users/u-keys/projects/keys-scene/, private, read back
//                 through keys-scene-peek
import { DATA, FILES_HOST, MiB, asOwner, jpeg, pattern, same } from '../lib.mjs';

export const needs = ['off'];

const row = (id, mode, visibility, template, prefix, at) =>
  `('${id}', '${id}', '${mode}', 4, '${DATA}', '${visibility}', ${template}, NULL, '${prefix}', ${at}, ${at})`;

export const seed = {
  sql: `
INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at) VALUES
  ${row('keys-custom', 'timelapse', 'public', 1, 'users/u-keys/projects/keys-custom/', 4000)},
  ${row('keys-peek', 'timelapse', 'public', 1, 'users/u-keys/projects/keys-custom/', 4001)},
  ${row('keys-shadow', 'timelapse', 'public', 1, 'projects/keys-custom/', 4002)},
  ${row('keys-scene', 'scene', 'private', 0, 'users/u-keys/projects/keys-scene/', 4003)},
  ${row('keys-scene-peek', 'scene', 'public', 1, 'users/u-keys/projects/keys-scene/', 4004)};
`,
};

export async function run({ checks, off }) {
  const { call } = off;
  const t = checks('functions: R2 keys come from the row');
  const a = jpeg(21);
  const b = jpeg(22);
  let r = await call('POST', '/admin/api/projects/keys-custom/thumb', { headers: asOwner, bytes: a });
  const viaOwn = await call('GET', '/media/keys-custom/thumb.jpg');
  t.ok(r.status === 201 && viaOwn.status === 200 && same(viaOwn.bytes, a), `a thumbnail goes in and comes back out (${r.status}, ${viaOwn.status})`);
  r = await call('GET', '/media/keys-peek/thumb.jpg');
  t.ok(r.status === 200 && same(r.bytes, a), `it is under the row's prefix: another row with that prefix reads it (${r.status})`);
  r = await call('GET', '/media/keys-shadow/thumb.jpg');
  t.eq(r.status, 404, 'and nothing went where its id alone would have put it');
  r = await call('POST', '/admin/api/projects/keys-shadow/thumb', { headers: asOwner, bytes: b });
  const still = await call('GET', '/media/keys-custom/thumb.jpg');
  t.ok(r.status === 201 && same(still.bytes, a), 'with a file at that id-derived key, the row with its own prefix still serves its own');

  const frame = pattern(2048, 23);
  const f = await call('POST', '/admin/api/projects/keys-custom/frames?index=3', { headers: asOwner, bytes: frame });
  const listed = await call('PUT', '/admin/api/projects/keys-custom', { headers: asOwner, json: { frames: [{ index: 3, tris: 1 }] } });
  r = await call('GET', '/media/keys-peek/frames/sd/0003.glb');
  t.ok(f.status === 201 && listed.status === 200 && same(r.bytes, frame), `a frame lands under the prefix too (${f.status}, ${listed.status}, ${r.status})`);
  r = await call('GET', '/api/projects/keys-custom');
  t.eq(r.json?.frames?.[0]?.sd?.split('?')[0], `http://${FILES_HOST}/m/keys-custom/frames/sd/0003.glb`, 'while its manifest names the route, by id, never the key');
  await call('PUT', '/admin/api/projects/keys-custom', { headers: asOwner, json: { frames: [] } });
  r = await call('GET', '/media/keys-peek/frames/sd/0003.glb');
  t.eq(r.status, 404, 'a frame dropped from the list is deleted from where it was');

  const s = await call('POST', '/admin/api/projects/keys-scene/scene', { headers: asOwner });
  const u = encodeURIComponent(s.json?.uploadId ?? '');
  const body = pattern(MiB / 2, 24);
  const part = await call('PUT', `/admin/api/projects/keys-scene/scene?upload=${u}&part=1`, { headers: asOwner, bytes: body });
  const done = await call('POST', `/admin/api/projects/keys-scene/scene?upload=${u}`, { headers: asOwner, json: { parts: [part.json], objects: 1, tris: 2 } });
  r = await call('GET', '/media/keys-scene-peek/scene.bozz');
  t.ok(done.status === 200 && r.status === 200 && same(r.bytes, body), `a scene uploaded in parts is assembled under the prefix (${s.status}, ${part.status}, ${done.status}, ${r.status})`);
  r = await call('GET', done.json?.scene?.file ?? '/none', { headers: asOwner });
  t.ok(r.status === 200 && same(r.bytes, body), `and the owner reads it where its manifest says (${done.json?.scene?.file})`);

  r = await call('DELETE', '/admin/api/projects/keys-custom', { headers: asOwner });
  const swept = await call('GET', '/media/keys-peek/thumb.jpg');
  const kept = await call('GET', '/media/keys-shadow/thumb.jpg');
  t.ok(r.status === 200 && swept.status === 404, `deleting a project clears its prefix (${r.status}, then ${swept.status})`);
  t.ok(kept.status === 200 && same(kept.bytes, b), 'and only its prefix: the id-derived one is untouched');
  t.report();
}
