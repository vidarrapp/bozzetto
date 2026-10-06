// The media routes: what /media serves to anyone and /admin/api/media to
// the owner, and the headers every answer carries. public/_headers reaches
// the static files only: these come from code.
import { asOwner, asStranger, ids, jpeg, pattern, same } from '../lib.mjs';

export const needs = ['off'];

export async function run({ checks, off }) {
  const { call } = off;
  const frame = pattern(4096, 7);
  const thumb = jpeg(99);

  // --- the media route ----------------------------------------------------
  let t = checks('functions: media gating');
  for (const [id, visibility] of [
    ['med-pub', 'public'],
    ['med-priv', 'private'],
  ]) {
    const c = await call('POST', '/admin/api/projects', { headers: asOwner, json: { id, visibility } });
    const f = await call('POST', `/admin/api/projects/${id}/frames?index=0`, { headers: asOwner, bytes: frame });
    const p = await call('PUT', `/admin/api/projects/${id}`, { headers: asOwner, json: { frames: [{ index: 0, tris: 12 }] } });
    const th = await call('POST', `/admin/api/projects/${id}/thumb`, { headers: asOwner, bytes: thumb });
    t.ok(c.status === 201 && f.status === 201 && p.status === 200 && th.status === 201, `${id}: made ${visibility}, with a frame, the frame list and a thumbnail (${c.status}, ${f.status}, ${p.status}, ${th.status})`);
  }
  let r = await call('GET', '/media/med-pub/frames/sd/0000.glb');
  t.ok(r.status === 200 && same(r.bytes, frame), `a public frame streams (${r.status}, ${r.bytes.length} bytes)`);
  t.eq(r.headers.get('cache-control'), 'public, max-age=31536000, immutable', 'and may be cached for good');
  r = await call('GET', '/media/med-pub/thumb.jpg');
  t.ok(r.status === 200 && same(r.bytes, thumb), `so does its thumbnail (${r.status})`);
  r = await call('GET', '/media/med-priv/frames/sd/0000.glb');
  t.eq(r.status, 404, 'a private frame is not found on /media');
  r = await call('GET', '/media/med-priv/thumb.jpg');
  t.eq(r.status, 404, 'nor its thumbnail');
  r = await call('GET', '/media/med-priv/frames/sd/0000.glb', { headers: asOwner });
  t.eq(r.status, 404, 'not even with the owner identity header, which Access does not vouch for there');
  r = await call('GET', '/admin/api/media/med-priv/frames/sd/0000.glb', { headers: asOwner });
  t.ok(r.status === 200 && same(r.bytes, frame), `the owner reads it through /admin/api/media (${r.status})`);
  t.eq(r.headers.get('cache-control'), 'private, no-store', 'and nothing may keep it');
  r = await call('GET', '/admin/api/media/med-priv/thumb.jpg', { headers: asOwner });
  t.ok(r.status === 200 && same(r.bytes, thumb), `the private thumbnail too (${r.status})`);
  r = await call('GET', '/admin/api/media/med-priv/frames/sd/0000.glb');
  t.eq(r.status, 404, 'the gated route refuses with a 404 when there is no identity');
  r = await call('GET', '/admin/api/media/med-priv/frames/sd/0000.glb', { headers: asStranger });
  t.eq(r.status, 404, 'and for an identity that is not the owner');
  r = await call('GET', '/media/no-such-project/frames/sd/0000.glb');
  t.eq(r.status, 404, 'an unknown project is a 404 as well');
  r = await call('PUT', '/admin/api/projects/med-priv', { headers: asOwner, json: { visibility: 'public' } });
  t.ok(r.status === 200 && r.json?.visibility === 'public', `making it public (${r.status} ${r.json?.visibility})`);
  r = await call('GET', '/media/med-priv/frames/sd/0000.glb');
  t.ok(r.status === 200 && same(r.bytes, frame), `opens /media to it (${r.status})`);
  r = await call('GET', '/api/projects');
  t.ok(ids(r.json).includes('med-priv'), 'and puts it on the public list');
  r = await call('PUT', '/admin/api/projects/med-priv', { headers: asOwner, json: { visibility: 'private' } });
  const back = await call('GET', '/media/med-priv/frames/sd/0000.glb');
  t.ok(r.status === 200 && back.status === 404, `making it private again closes it (${r.status}, then ${back.status})`);
  for (const file of ['frames/sd/1.glb', 'frames/sd/0000.glb/x', 'frames/hd/0000.glb', 'scene.bozz.tmp', 'data.json']) {
    r = await call('GET', `/media/med-pub/${file}`);
    t.eq(r.status, 404, `a file name outside the set a project has is not looked for (${file})`);
  }
  t.report();

  // --- response headers ---------------------------------------------------
  t = checks('functions: response headers');
  r = await call('GET', '/admin/api/projects', { headers: asOwner });
  t.eq(r.headers.get('cache-control'), 'no-store', 'the owner list is kept by no cache');
  t.eq(r.headers.get('x-content-type-options'), 'nosniff', 'and never sniffed');
  r = await call('GET', '/admin/api/whoami');
  t.ok(r.status === 403 && r.headers.get('cache-control') === 'no-store', `nor is a refusal kept (${r.status} ${r.headers.get('cache-control')})`);
  r = await call('GET', '/api/projects');
  t.eq(r.headers.get('x-content-type-options'), 'nosniff', 'the public list is not sniffed either');
  r = await call('GET', '/media/med-pub/frames/sd/0000.glb');
  t.eq(r.headers.get('x-content-type-options'), 'nosniff', 'a media file keeps the type it was stored with');
  t.eq(r.headers.get('content-security-policy'), "default-src 'none'; sandbox", 'opened on its own it is sandboxed');
  t.eq(r.headers.get('cross-origin-resource-policy'), 'same-origin', 'and no other site may embed it');
  r = await call('GET', '/media/med-pub/thumb.jpg');
  t.eq(r.headers.get('content-type'), 'image/jpeg', 'a thumbnail is served as the JPEG it was checked to be');
  r = await call('GET', '/admin/api/media/med-priv/frames/sd/0000.glb', { headers: asOwner });
  const sent = ['cache-control', 'content-security-policy', 'cross-origin-resource-policy'].map((h) => r.headers.get(h));
  t.eq(sent.join(' | '), "private, no-store | default-src 'none'; sandbox | same-origin", 'the gated media route sends the same, kept nowhere');
  r = await call('GET', '/media/no-such-project/thumb.jpg');
  t.ok(r.status === 404 && r.headers.get('x-content-type-options') === 'nosniff', `and so does its 404 (${r.status})`);
  t.report();
}
