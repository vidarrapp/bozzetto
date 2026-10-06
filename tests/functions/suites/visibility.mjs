// Public and private as owner tools set them, and what each list and
// manifest then says. Public is a template now (docs/accounts.md §1), which
// templates-list.mjs checks; this is what 0.5 already promised.
import { asOwner, ids, jpeg, pattern } from '../lib.mjs';

export const needs = ['off'];

export async function run({ checks, off }) {
  const { call } = off;
  const t = checks('functions: visibility');
  let r = await call('POST', '/admin/api/projects', { headers: asOwner, json: { id: 'vis-pub', title: 'Public reel' } });
  t.ok(r.status === 201 && r.json?.visibility === 'public', `a project is public unless asked otherwise (${r.status} ${r.json?.visibility})`);
  r = await call('POST', '/admin/api/projects', {
    headers: asOwner,
    json: { id: 'vis-priv', title: 'Private reel', visibility: 'private' },
  });
  t.ok(r.status === 201 && r.json?.visibility === 'private', `and private when asked (${r.status} ${r.json?.visibility})`);
  r = await call('POST', '/admin/api/projects', { headers: asOwner, json: { id: 'vis-odd', visibility: 'secret' } });
  t.eq(r.status, 400, 'a visibility that is neither is refused');
  for (const id of ['vis-pub', 'vis-priv']) {
    const f = await call('POST', `/admin/api/projects/${id}/frames?index=0`, { headers: asOwner, bytes: pattern(4096, 7) });
    const p = await call('PUT', `/admin/api/projects/${id}`, { headers: asOwner, json: { frames: [{ index: 0, tris: 12 }] } });
    const th = await call('POST', `/admin/api/projects/${id}/thumb`, { headers: asOwner, bytes: jpeg(99) });
    t.ok(f.status === 201 && p.status === 200 && th.status === 201, `${id}: a frame, the frame list and a thumbnail upload (${f.status}, ${p.status}, ${th.status})`);
  }
  r = await call('GET', '/api/projects');
  t.ok(r.status === 200 && ids(r.json).includes('vis-pub') && !ids(r.json).includes('vis-priv'), `the public list has the public project and not the private one (${ids(r.json).join(', ')})`);
  t.ok(Array.isArray(r.json) && r.json.every((p) => p.visibility === 'public'), 'and says each is public');
  r = await call('GET', '/admin/api/projects', { headers: asOwner });
  const owned = Object.fromEntries((r.json ?? []).map((p) => [p.id, p.visibility]));
  t.ok(r.status === 200 && owned['vis-pub'] === 'public' && owned['vis-priv'] === 'private', `the owner list has both, with their visibility (${owned['vis-pub']}, ${owned['vis-priv']})`);
  r = await call('GET', '/api/projects/vis-pub');
  t.ok(r.status === 200 && r.json?.frames?.[0]?.sd?.startsWith('/media/vis-pub/'), `the public manifest points its frames at /media (${r.json?.frames?.[0]?.sd})`);
  r = await call('GET', '/api/projects/vis-priv');
  t.eq(r.status, 404, 'a private manifest is not found publicly');
  r = await call('GET', '/admin/api/projects/vis-priv', { headers: asOwner });
  t.ok(r.status === 200 && r.json?.frames?.[0]?.sd?.startsWith('/admin/api/media/vis-priv/'), `the owner gets it, frames on the Access-gated media route (${r.json?.frames?.[0]?.sd})`);
  r = await call('PUT', '/admin/api/projects/vis-pub', { headers: asOwner, json: { visibility: 'hidden' } });
  t.eq(r.status, 400, 'an update with an unknown visibility is refused');
  t.report();
}
