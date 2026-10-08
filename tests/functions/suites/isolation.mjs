// Every /api/me route reaches the asking account's own projects and
// nothing else (docs/accounts.md §1, §4, §10): another account's project,
// a template and the owner's own rows are 404 not_found on every route,
// the same answer as a project that is not there, and nothing of theirs
// changes for having been asked. An upload's id is bound to its account
// and project.
import { Browser, bozz, glb, ids, jpeg, same, seedSession, seedUser, seededToken } from '../lib.mjs';

export const needs = ['on'];

const T = 2_900_000_000_000;
const A = 'u-isalice0000000000000000000';
const B = 'u-isbob000000000000000000000';
const TEMPLATE_THUMB = jpeg(71);
const LEGACY_THUMB = jpeg(72);
const DATA = '{"defaults":{},"camera":{},"stages":[],"frames":[{"index":0,"tris":1}]}';

export const seed = {
  sql: [
    seedUser({ id: A, handle: 'isalice' }),
    seedUser({ id: B, handle: 'isbob' }),
    seedSession({ name: 'is-alice', id: 's-isalice', user: A, created: T }),
    seedSession({ name: 'is-bob', id: 's-isbob', user: B, created: T }),
    // A listed template, a privatised one, and the owner's own from before
    // the bootstrap (no account owns it): none of them anyone's on /api/me.
    `INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at) VALUES
      ('is-tpl', 'Template', 'timelapse', 4, '${DATA}', 'public', 1, NULL, NULL, ${T}, ${T}),
      ('is-tpl-private', 'Privatised', 'timelapse', 4, '${DATA}', 'private', 1, NULL, NULL, ${T}, ${T}),
      ('is-legacy', 'Owner own', 'timelapse', 4, '${DATA}', 'private', 0, NULL, NULL, ${T}, ${T});`,
  ].join('\n'),
  r2: [
    { key: 'projects/is-tpl/thumb.jpg', bytes: TEMPLATE_THUMB, type: 'image/jpeg' },
    { key: 'projects/is-legacy/thumb.jpg', bytes: LEGACY_THUMB, type: 'image/jpeg' },
  ],
};

export async function run({ checks, on }) {
  const clock = { now: T + 60_000 };
  const as = (name, ip) => {
    const b = new Browser(on, { ip, clock });
    b.jar.set('__Host-bz_session', seededToken(name));
    return b;
  };
  const alice = as('is-alice', '198.51.100.70');
  const bob = as('is-bob', '198.51.100.71');

  // --- Bob's projects, and an upload of his under way ------------------------------------------
  let t = checks('functions: isolation, set up');
  const made = [];
  const call = async (b, method, path, opts) => {
    const r = await b.call(method, path, opts);
    made.push(r.status);
    return r;
  };
  const bobScene = (await call(bob, 'POST', '/api/me/projects', { json: { title: "Bob's scene", mode: 'scene' } })).json?.id;
  const bobReel = (await call(bob, 'POST', '/api/me/projects', { json: { title: "Bob's reel", mode: 'timelapse' } })).json?.id;
  const sceneFile = bozz({ vertices: 40, seed: 31 });
  let up = (await call(bob, 'POST', `/api/me/projects/${bobScene}/scene`, { json: { size: sceneFile.length } })).json;
  const p1 = await call(bob, 'PUT', `/api/me/projects/${bobScene}/scene?upload=${up.uploadId}&part=1`, { bytes: sceneFile });
  await call(bob, 'POST', `/api/me/projects/${bobScene}/scene?upload=${up.uploadId}`, { json: { parts: [p1.json], objects: 1, tris: 1 } });
  const frame = glb({ seed: 32 });
  const thumb = jpeg(33);
  await call(bob, 'POST', `/api/me/projects/${bobReel}/frames?index=0`, { bytes: frame });
  await call(bob, 'PUT', `/api/me/projects/${bobReel}`, { json: { frames: [{ index: 0, tris: 1 }] } });
  await call(bob, 'POST', `/api/me/projects/${bobReel}/thumb`, { bytes: thumb });
  const pending = (await call(bob, 'POST', `/api/me/projects/${bobScene}/scene`, { json: { size: sceneFile.length } })).json;
  const aliceScene = (await call(alice, 'POST', '/api/me/projects', { json: { title: "Alice's scene", mode: 'scene' } })).json?.id;
  const aliceUp = (await call(alice, 'POST', `/api/me/projects/${aliceScene}/scene`, { json: { size: sceneFile.length } })).json;
  t.ok(made.every((s) => s === 200 || s === 201), `both accounts have projects, Bob an upload under way (${made.join(' ')})`);
  const before = (await bob.call('GET', '/api/me/projects')).json;
  t.report();

  // --- every route, with Bob's ids -------------------------------------------------------------
  t = checks("functions: isolation, another account's project is not found");
  /** Every route an account has for a project, with what it would send. */
  const routes = (id, upload) => [
    ['GET', `/api/me/projects/${id}`, {}],
    ['PUT', `/api/me/projects/${id}`, { json: { title: 'Taken over' } }],
    ['PUT', `/api/me/projects/${id}`, { json: { frames: [] } }],
    ['POST', `/api/me/projects/${id}/scene`, { json: { size: 100 } }],
    ['PUT', `/api/me/projects/${id}/scene?upload=${upload}&part=1`, { bytes: sceneFile }],
    ['POST', `/api/me/projects/${id}/scene?upload=${upload}`, { json: { parts: [{ part: 1, etag: 'x' }], objects: 1, tris: 1 } }],
    ['DELETE', `/api/me/projects/${id}/scene?upload=${upload}`, {}],
    ['POST', `/api/me/projects/${id}/frames?index=0`, { bytes: glb({ seed: 34 }) }],
    ['POST', `/api/me/projects/${id}/thumb`, { bytes: jpeg(35) }],
    ['GET', `/api/me/media/${id}/scene.bozz`, {}],
    ['GET', `/api/me/media/${id}/thumb.jpg`, {}],
    ['GET', `/api/me/media/${id}/frames/sd/0000.glb`, {}],
    ['GET', `/api/me/media/${id}/scene.bozz?download=1`, {}],
    ['DELETE', `/api/me/projects/${id}`, {}],
  ];
  const tryAll = async (b, id, upload) => {
    const out = [];
    for (const [method, path, opts] of routes(id, upload)) {
      const r = await b.call(method, path, opts);
      const media = path.startsWith('/api/me/media/');
      // The media route answers as every file route does: a bare 404.
      const notFound = r.status === 404 && (media ? r.json === null : r.json?.code === 'not_found');
      if (!notFound) out.push(`${method} ${path} -> ${r.status} ${r.json?.code ?? ''}`);
    }
    return out;
  };
  for (const [id, what] of [
    [bobScene, "Bob's scene"],
    [bobReel, "Bob's reel"],
  ]) {
    const missed = await tryAll(alice, id, pending.uploadId);
    t.ok(missed.length === 0, `${what}, asked by Alice: 404 on every route (${missed.join('; ') || `${routes(id, 'u').length} routes`})`);
  }
  const missing = await tryAll(alice, 'p-00000000000000000000000000', 'nope');
  t.ok(missing.length === 0, `as for a project that is not there (${missing.join('; ') || 'the same'})`);
  let r = await alice.call('PUT', `/api/me/projects/${aliceScene}/scene?upload=${encodeURIComponent(pending.uploadId)}&part=1`, { bytes: sceneFile });
  t.ok(r.status === 404 && r.json?.code === 'not_found', `Bob's upload id on Alice's own project: 404 (${r.status})`);
  r = await bob.call('PUT', `/api/me/projects/${bobScene}/scene?upload=${encodeURIComponent(aliceUp.uploadId)}&part=1`, { bytes: sceneFile });
  t.ok(r.status === 404, `and Alice's on Bob's (${r.status})`);
  const after = (await bob.call('GET', '/api/me/projects')).json;
  t.eq(JSON.stringify(after), JSON.stringify(before), "Bob's projects are as they were, titles, frames and sizes");
  r = await bob.call('GET', `/api/me/media/${bobScene}/scene.bozz`);
  const f = await bob.call('GET', `/api/me/media/${bobReel}/frames/sd/0000.glb`);
  const th = await bob.call('GET', `/api/me/media/${bobReel}/thumb.jpg`);
  t.ok(same(r.bytes, sceneFile) && same(f.bytes, frame) && same(th.bytes, thumb), 'and so are his files');
  r = await bob.call('PUT', `/api/me/projects/${bobScene}/scene?upload=${encodeURIComponent(pending.uploadId)}&part=1`, { bytes: sceneFile });
  t.eq(r.status, 201, 'his upload under way still takes its parts');
  r = await alice.call('GET', '/api/me/projects');
  t.eq(ids(r.json).join(','), aliceScene, "Alice's list is Alice's alone");
  t.report();

  // --- templates and the owner's rows ---------------------------------------------------------
  t = checks("functions: isolation, templates and the owner's rows");
  for (const id of ['is-tpl', 'is-tpl-private', 'is-legacy']) {
    const missed = await tryAll(alice, id, 'nope');
    t.ok(missed.length === 0, `${id}: 404 on every /api/me route (${missed.join('; ') || 'all'})`);
  }
  r = await on.call('GET', '/m/is-tpl/thumb.jpg');
  t.ok(r.status === 200 && same(r.bytes, TEMPLATE_THUMB), `the listed template is still everyone's on /m/, untouched (${r.status})`);
  r = await on.call('GET', '/api/projects/is-legacy');
  t.eq(r.status, 404, "and the owner's own is no one else's anywhere");
  t.report();

  // --- private, and checked as owner tools check -------------------------------------------------
  t = checks("functions: isolation, an account's projects stay private");
  r = await alice.call('POST', '/api/me/projects', { json: { title: 'Public?', mode: 'model', visibility: 'public' } });
  t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.reason === 'public', `made public: 400, reason public (${r.status} ${JSON.stringify(r.json)})`);
  r = await alice.call('POST', '/api/me/projects', { json: { title: 'Sneaky', mode: 'model', visibility: 'private', template: true, id: 'is-chosen' } });
  const sneaky = r.json;
  t.ok(r.status === 201 && sneaky?.visibility === 'private' && sneaky?.template === false && sneaky?.id !== 'is-chosen' && /^p-/.test(sneaky?.id ?? ''), `private is taken; an id or template flag asked for is not (${r.status} ${sneaky?.id} ${sneaky?.template})`);
  r = await alice.call('POST', '/api/me/projects', { json: { title: 'Odd', mode: 'sketch' } });
  t.ok(r.status === 400 && r.json?.code === 'bad_request', `a mode there is not: 400 (${r.status})`);
  r = await alice.call('PUT', `/api/me/projects/${sneaky?.id}`, { json: { visibility: 'public' } });
  t.ok(r.status === 400 && r.json?.reason === 'public', `nor can an update make one public (${r.status} ${r.json?.reason})`);
  r = await alice.call('PUT', `/api/me/projects/${sneaky?.id}`, { json: { frames: [{ index: 10000, tris: 1 }] } });
  t.ok(r.status === 400 && r.json?.code === 'bad_request', `a frame list past 9999: 400, as on owner tools (${r.status} ${r.json?.error})`);
  r = await alice.call('PUT', `/api/me/projects/${sneaky?.id}`, { json: { lighting: { note: '€'.repeat(600_000) } } });
  t.ok(r.status === 413, `data over 1.5 MB, counted in bytes: 413 (${r.status})`);
  r = await alice.call('PUT', `/api/me/projects/${sneaky?.id}`, { json: { title: '  Renamed  ', mode: 'scene', fps: 12, stages: [{ name: 'One', frame: 0 }] } });
  t.ok(r.status === 200 && r.json?.title === 'Renamed' && r.json?.mode === 'model' && r.json?.fps === 12 && r.json?.visibility === 'private' && JSON.parse(r.json?.data ?? '{}').stages?.[0]?.name === 'One', `an update as owner tools make one: trimmed title, no becoming a scene (${r.status} ${r.json?.title} ${r.json?.mode})`);
  r = await on.call('GET', `/api/projects/${sneaky?.id}`);
  t.eq(r.status, 404, 'and the public API never has it');
  t.report();

  // --- no session ----------------------------------------------------------------------------
  t = checks('functions: isolation, signed out');
  const guest = new Browser(on, { ip: '198.51.100.72', clock });
  r = await guest.call('GET', '/api/me/projects');
  t.ok(r.status === 401 && r.json?.code === 'signin', `the list: 401 signin (${r.status} ${r.json?.code})`);
  r = await guest.call('POST', '/api/me/projects', { json: { title: 'x' } });
  t.ok(r.status === 401 && r.json?.code === 'signin', `a create: 401 signin (${r.status})`);
  r = await guest.call('GET', `/api/me/media/${bobReel}/thumb.jpg`);
  t.ok(r.status === 404 && r.headers.get('cache-control') === 'no-store', `a file: the same 404 as not yours (${r.status})`);
  t.report();
}
