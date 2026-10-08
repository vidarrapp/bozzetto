// Armature projects, the fourth mode (docs/accounts.md §4, §5): a posed
// figure saved from Armature mode as one file, armature.json - gzip or
// plain JSON of {v: 1, figure, state, look, ...} (shared/armature.ts) -
// beside its thumbnail. Made on /api/me, held to the quota, checked before
// R2 sees a byte (415 bad_type, 422 bad_armature {reason}, 413 past 4 MiB),
// served on the private route; made through the owner tools, it can be a
// template, served off /m/ and /media/ to anyone. Like a scene it stays
// what it was made as.
import { gzipSync } from 'node:zlib';
import { Browser, FILES_HOST, MiB, asOwner, concat, jpeg, pattern, same, seedSession, seedUser, seededToken } from '../lib.mjs';

export const needs = ['off', 'on'];

const T = 3_000_000_000_000;
const ALICE = 'u-armalice000000000000000000';
const BOB = 'u-armbob00000000000000000000';
const QUOTA = 64 * 1024;

export const seed = {
  sql: [
    seedUser({ id: ALICE, handle: 'armalice' }),
    seedUser({ id: BOB, handle: 'armbob', quota: QUOTA }),
    seedSession({ name: 'arm-alice', id: 's-armalice', user: ALICE, created: T }),
    seedSession({ name: 'arm-bob', id: 's-armbob', user: BOB, created: T }),
  ].join('\n'),
};

/** A figure as Armature mode saves one. */
const figure = (extra = {}) => ({
  kind: 'bozzetto-armature-project',
  v: 1,
  figure: 'mannequin-male-realistic',
  name: 'Contrapposto',
  state: {
    root: { position: [0, 1.5, 0], quaternion: [0, 0, 0, 1] },
    pose: { 'upperarm.L': [10, 0, -35], 'thigh.R': [-12, 0, 4] },
    proportions: { 'head': { size: 1.1, length: 1 } },
    pins: { 'foot.L': [4, 0, 1], 'foot.R': [-4, 0, 1] },
    aims: { 'hand.L': 15 },
    plant: true,
  },
  symmetry: false,
  look: { materialMode: 'lit' },
  savedAt: T,
  ...extra,
});
const text = (o) => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o));
const gz = (o) => new Uint8Array(gzipSync(text(o)));

export async function run({ checks, on, off }) {
  const clock = { now: T + 60_000 };
  const as = (name, ip) => {
    const b = new Browser(on, { ip, clock });
    b.jar.set('__Host-bz_session', seededToken(name));
    return b;
  };
  const alice = as('arm-alice', '198.51.100.90');
  const bob = as('arm-bob', '198.51.100.91');
  const h = (r, name) => r.headers.get(name);

  // --- making one ------------------------------------------------------------------------
  let t = checks('functions: armature projects, made on /api/me');
  let r = await alice.call('POST', '/api/me/projects', { json: { title: 'Contrapposto', mode: 'armature' } });
  const id = r.json?.id;
  t.ok(r.status === 201 && /^p-/.test(id ?? '') && r.json?.mode === 'armature' && r.json?.visibility === 'private', `mode 'armature' is taken: a private project, the server's id (${r.status} ${id} ${r.json?.mode})`);
  r = await alice.call('POST', '/api/me/projects', { json: { title: 'Nope', mode: 'figure' } });
  t.ok(r.status === 400 && /'armature'/.test(r.json?.error ?? ''), `a mode outside the four is refused, naming them (${r.status} ${r.json?.error})`);
  const file = gz(figure());
  r = await alice.call('POST', `/api/me/projects/${id}/armature`, { bytes: file });
  const v = r.json?.updated_at;
  t.ok(r.status === 200 && r.json?.mode === 'armature' && r.json?.media === `/api/me/media/${id}`, `its file goes up, gzipped, and the manifest comes back (${r.status} ${r.json?.media})`);
  r = await alice.call('POST', `/api/me/projects/${id}/thumb`, { bytes: jpeg(71) });
  t.eq(r.status, 201, 'and its thumbnail, as any project\'s');
  r = await alice.call('GET', '/api/me/projects');
  const card = (r.json ?? []).find((p) => p.id === id);
  t.ok(card?.mode === 'armature' && card?.bytes === file.length + 512, `My projects lists it as an armature, weighing its file and thumbnail (${card?.mode}, ${card?.bytes})`);
  t.report();

  // --- serving --------------------------------------------------------------------------------
  t = checks('functions: armature projects, the private route');
  r = await alice.call('GET', `/api/me/media/${id}/armature.json?v=${v}`);
  t.ok(r.status === 200 && same(r.bytes, file), `armature.json comes back as stored (${r.status}, ${r.bytes.length} bytes)`);
  t.ok(
    h(r, 'content-type') === 'application/x-bozzetto-armature' && h(r, 'cache-control') === 'private, no-store' && h(r, 'x-content-type-options') === 'nosniff' && h(r, 'content-security-policy') === "default-src 'none'; sandbox",
    `typed by its name, kept nowhere, nosniff, sandboxed (${h(r, 'content-type')} | ${h(r, 'cache-control')})`,
  );
  r = await alice.call('GET', `/api/me/media/${id}/armature.json?download=1`);
  t.eq(h(r, 'content-disposition'), 'attachment; filename="Contrapposto.armature.json"', 'with ?download=1, a download named after its project');
  r = await bob.call('GET', `/api/me/media/${id}/armature.json`);
  t.eq(r.status, 404, "another account's is not there");
  r = await bob.call('POST', `/api/me/projects/${id}/armature`, { bytes: file });
  t.eq(r.status, 404, 'nor theirs to write');
  t.report();

  // --- what it must be ----------------------------------------------------------------------------
  t = checks('functions: armature projects, the content checks');
  const refused = async (bytes, why, status, code) => {
    const res = await alice.call('POST', `/api/me/projects/${id}/armature`, { bytes });
    t.ok(res.status === status && res.json?.code === code, `${why}: ${status} ${code} (${res.status} ${res.json?.code}: ${res.json?.reason ?? res.json?.error})`);
    return res;
  };
  await refused(concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), pattern(64, 2)), 'a PNG', 415, 'bad_type');
  await refused(text('[1, 2, 3]'), 'a JSON array', 415, 'bad_type');
  await refused(text('{"v": 1, "figure": '), 'JSON cut short', 422, 'bad_armature');
  await refused(text(figure({ v: 2 })), 'version 2', 422, 'bad_armature');
  let res = await refused(text(figure({ figure: 'imported' })), 'a figure the app does not have', 422, 'bad_armature');
  t.ok(/figure "imported"/.test(res.json?.reason ?? ''), `the reason names it (${res.json?.reason})`);
  await refused(text(figure({ figure: undefined })), 'no figure at all', 422, 'bad_armature');
  res = await refused(text('{"v": 1, "figure": "placeholder-male", "state": {"pose": {"__proto__": {"polluted": true}}}}'), 'a __proto__ key, however deep', 422, 'bad_armature');
  t.ok(/__proto__/.test(res.json?.reason ?? ''), `named as such (${res.json?.reason})`);
  let deep = '1';
  for (let i = 0; i < 40; i++) deep = `{"a": ${deep}}`;
  await refused(text(`{"v": 1, "figure": "placeholder-male", "x": ${deep}}`), 'nesting forty deep', 422, 'bad_armature');
  await refused(concat(text('{"v": 1, "figure": "'), new Uint8Array([0xff, 0xfe]), text('"}')), 'text that is not UTF-8', 422, 'bad_armature');
  await refused(gz(figure()).slice(0, 30), 'gzip cut short', 422, 'bad_armature');
  await refused(new Uint8Array(gzipSync(Buffer.alloc(4 * MiB + 10, 0x20))), 'gzip that unpacks past 4 MiB', 413, 'file_too_large');
  res = await alice.call('POST', `/api/me/projects/${id}/armature`, { bytes: concat(text('{"v":1,"figure":"placeholder-male","pad":"'), pattern(4 * MiB, 3).map((b) => 0x61 + (b % 26)), text('"}')) });
  t.ok(res.status === 413, `a file past 4 MiB as it is sent: 413 (${res.status} ${res.json?.code})`);
  r = await alice.call('GET', `/api/me/media/${id}/armature.json`);
  t.ok(r.status === 200 && same(r.bytes, file), 'and through all of it, the stored file is untouched');
  const plain = text(figure({ figure: 'placeholder-female', name: 'Plain' }));
  r = await alice.call('POST', `/api/me/projects/${id}/armature`, { bytes: concat(new Uint8Array([0xef, 0xbb, 0xbf]), text('\n  '), plain) });
  const stored = await alice.call('GET', `/api/me/media/${id}/armature.json`);
  t.ok(r.status === 200 && stored.bytes.length === plain.length + 6, `plain JSON is taken too, after a byte-order mark and white space (${r.status}, ${stored.bytes.length} bytes stored)`);
  r = await alice.call('GET', '/api/me/projects');
  t.eq((r.json ?? []).find((p) => p.id === id)?.bytes, plain.length + 6 + 512, 'and the project weighs what replaced the file, not both');
  t.report();

  // --- it stays an armature -------------------------------------------------------------------------
  t = checks('functions: armature projects keep their mode');
  r = await alice.call('PUT', `/api/me/projects/${id}`, { json: { mode: 'model', title: 'Renamed' } });
  t.ok(r.status === 200 && r.json?.mode === 'armature' && r.json?.title === 'Renamed', `a patch naming another mode renames it and leaves it an armature (${r.json?.mode}, ${r.json?.title})`);
  const tl = (await alice.call('POST', '/api/me/projects', { json: { title: 'Reel', mode: 'timelapse' } })).json?.id;
  r = await alice.call('PUT', `/api/me/projects/${tl}`, { json: { mode: 'armature' } });
  t.eq(r.json?.mode, 'timelapse', 'nor does anything become one');
  r = await alice.call('POST', `/api/me/projects/${tl}/armature`, { bytes: file });
  t.eq(r.status, 400, 'a timelapse takes no armature file');
  r = await alice.call('GET', `/api/me/media/${tl}/armature.json`);
  t.eq(r.status, 404, 'and has none to serve');
  t.report();

  // --- the quota -----------------------------------------------------------------------------------------
  t = checks('functions: armature projects, the quota');
  const small = (await bob.call('POST', '/api/me/projects', { json: { title: 'Small', mode: 'armature' } })).json?.id;
  const big = text(figure({ pad: 'x'.repeat(QUOTA) }));
  r = await bob.call('POST', `/api/me/projects/${small}/armature`, { bytes: big });
  t.ok(r.status === 413 && r.json?.code === 'quota_exceeded' && r.json?.quota === QUOTA, `a file past what is left is refused: 413 quota_exceeded (${r.status} ${r.json?.code})`);
  r = await bob.call('POST', `/api/me/projects/${small}/armature`, { bytes: file });
  t.eq(r.status, 200, 'one that fits is taken');
  r = await bob.call('DELETE', `/api/me/projects/${small}`);
  const after = (await bob.call('GET', '/api/me/projects')).json ?? [];
  t.ok(r.status === 200 && !after.some((p) => p.id === small), `deleting it takes it, file and all (${r.status})`);
  t.report();

  // --- owner tools and templates ----------------------------------------------------------------------
  t = checks('functions: armature projects, owner tools and templates');
  const owner = (method, path, opts = {}) => off.call(method, path, { headers: asOwner, ...opts });
  r = await owner('POST', '/admin/api/projects', { json: { mode: 'armature', title: 'Template figure' } });
  const tpl = r.json?.id;
  t.ok(r.status === 201 && /^armature-[a-z0-9-]+$/.test(tpl ?? '') && r.json?.visibility === 'private', `owner tools make one with no id given: the server picks it, private (${r.status} ${tpl})`);
  r = await owner('POST', `/admin/api/projects/${tpl}/armature`, { bytes: text('{"v":1,"figure":"nobody"}') });
  t.ok(r.status === 422 && r.json?.code === 'bad_armature', `the same checks on owner tools: a template reaches everyone (${r.status} ${r.json?.code})`);
  r = await owner('POST', `/admin/api/projects/${tpl}/armature`, { bytes: file });
  const thumbed = await owner('POST', `/admin/api/projects/${tpl}/thumb`, { bytes: jpeg(72) });
  t.ok(r.status === 200 && thumbed.status === 201, `its file and thumbnail go up (${r.status}, ${thumbed.status})`);
  r = await off.call('GET', `/media/${tpl}/armature.json`);
  t.eq(r.status, 404, 'private, it is on no open route');
  r = await owner('GET', `/admin/api/media/${tpl}/armature.json`);
  t.ok(r.status === 200 && same(r.bytes, file), `the owner reads it on the gated route (${r.status})`);
  r = await owner('POST', `/admin/api/projects/${tpl}/template`, { json: { template: true } });
  t.ok(r.status === 200 && r.json?.template === true && r.json?.mode === 'armature', `the Template switch takes it (${r.status} ${r.json?.template})`);
  r = await owner('PUT', `/admin/api/projects/${tpl}`, { json: { visibility: 'public' } });
  t.ok(r.status === 200 && r.json?.visibility === 'public' && r.json?.mode === 'armature', `made public, it is listed (${r.json?.visibility})`);
  const listed = ((await off.call('GET', '/api/projects')).json ?? []).find((p) => p.id === tpl);
  t.ok(listed?.mode === 'armature' && listed?.template === true && listed?.media === `http://${FILES_HOST}/m/${tpl}`, `the gallery's list has it, as an armature template on the files host (${JSON.stringify(listed && { mode: listed.mode, media: listed.media })})`);
  const manifest = (await off.call('GET', `/api/projects/${tpl}`)).json;
  t.ok(manifest?.mode === 'armature' && manifest?.frames?.length === 0, `its public manifest says what it is (${manifest?.mode})`);
  for (const path of [`/m/${tpl}/armature.json?v=${manifest?.updated_at}`, `/media/${tpl}/armature.json?v=${manifest?.updated_at}`]) {
    r = await off.call('GET', path);
    t.ok(
      r.status === 200 && same(r.bytes, file) && h(r, 'content-type') === 'application/x-bozzetto-armature' && h(r, 'cache-control') === 'public, no-cache',
      `${path.split('/')[1]}: served to anyone, re-saved in place so revalidated rather than kept (${r.status} ${h(r, 'cache-control')})`,
    );
  }
  r = await off.callHost(FILES_HOST, 'GET', `/m/${tpl}/armature.json`);
  t.ok(r.status === 200 && same(r.bytes, file), `and on the files host (${r.status})`);
  r = await owner('PUT', `/admin/api/projects/${tpl}`, { json: { visibility: 'private' } });
  r = await off.call('GET', `/m/${tpl}/armature.json`);
  t.eq(r.status, 404, 'privatised, it is off the open routes at once');
  t.report();
}
