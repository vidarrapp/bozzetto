// What an upload must be before R2 sees it (docs/accounts.md §4): a
// scene's first part gzip or the bare container, its header read and held
// to what the app opens, one thing wrong at a time (422 bad_scene with the
// reason; 415 bad_type for what is no scene at all); the last part's gzip
// trailer held to the header; thumbnails JPEGs, polyglots served inert;
// frames glTF 2.0, raw or gzipped. Owner tools' scene uploads are checked
// the same, since templates reach every visitor. And shared/bozz.ts, the
// one reader both sides use.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  Browser,
  MiB,
  asOwner,
  bozz,
  bozzOf,
  concat,
  container,
  glb,
  jpeg,
  parts,
  same,
  sceneHeader,
  seedSession,
  seedUser,
  seededToken,
} from '../lib.mjs';

export const needs = ['on', 'off'];

const T = 2_800_000_000_000;
const MEMBER = 'u-cnmember000000000000000000';

export const seed = {
  sql: [seedUser({ id: MEMBER, handle: 'cnmember' }), seedSession({ name: 'cn-member', id: 's-cnmember', user: MEMBER, created: T })].join('\n'),
};

const text = (s) => new TextEncoder().encode(s);

export async function run({ checks, on, off, compileShared, repo }) {
  const member = new Browser(on, { ip: '198.51.100.60', clock: { now: T + 60_000 } });
  member.jar.set('__Host-bz_session', seededToken('cn-member'));
  const create = async (mode, title) => (await member.call('POST', '/api/me/projects', { json: { title, mode } })).json?.id;
  const sc = await create('scene', 'Checked scene');
  const tl = await create('timelapse', 'Checked frames');
  const scene = `/api/me/projects/${sc}/scene`;
  /** A whole file sent as one upload's part 1, its size declared as `size`: the answer to the part. */
  const send = async (file, size = file.length) => {
    const up = (await member.call('POST', scene, { json: { size } })).json;
    return { up, r: await member.call('PUT', `${scene}?upload=${encodeURIComponent(up?.uploadId)}&part=1`, { bytes: file }) };
  };

  // --- not a scene at all ----------------------------------------------------------------------
  let t = checks('functions: content, not a scene');
  for (const [bytes, what] of [
    [concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), new Uint8Array(64)), 'a PNG'],
    [text('<!doctype html><script>alert(1)</script>'), 'an HTML page'],
    [concat(text('PK'), new Uint8Array([3, 4]), new Uint8Array(60)), 'a zip'],
    [new Uint8Array([0x1f, 0x8b]), 'two bytes of gzip magic and nothing after'],
  ]) {
    const { r } = await send(bytes);
    t.ok(r.status === 415 && r.json?.code === 'bad_type', `${what} as a scene: 415 bad_type (${r.status} ${r.json?.code})`);
  }
  const { r: plain } = await send(new Uint8Array(gzipSync(text('hello, not a scene at all, just some words'))));
  t.ok(plain.status === 422 && plain.json?.code === 'bad_scene' && plain.json?.reason === 'This file is not a Bozzetto scene', `gzip of something else: 422 bad_scene, with the reason (${plain.status} ${JSON.stringify(plain.json)})`);
  t.report();

  // --- the header, one thing at a time -----------------------------------------------------------------
  t = checks('functions: content, a bad header');
  const deep = (h) => {
    let o = (h.scene.look = {});
    for (let i = 0; i < 40; i++) o = o.a = {};
  };
  const cases = [
    [container('', 0), /not a Bozzetto scene/, 'a header of no length'],
    [container('{"scene": ', 0), /not a Bozzetto scene/, 'a header that is not JSON'],
    [container(JSON.stringify({ scene: sceneHeader().scene }), 0), /not a Bozzetto scene/, 'no buffers table'],
    [bozz({ edit: (h) => (h.buffers[0].t = 'f64') }), /a bad buffer entry/, 'a buffer of a kind there is not'],
    [bozz({ edit: (h) => h.buffers.push({ ...h.buffers[1] }) }), /arrays that overlap/, 'two arrays in one place'],
    [container(JSON.stringify({ ...sceneHeader(), buffers: [{ t: 'f32', off: 0, len: 300_000_000 }] }), 0), /too large to open/, 'over 1 GiB unpacked'],
    [bozz({ edit: (h) => (h.scene.look = { pad: 'x'.repeat(MiB + 10) }) }), /over the 1 MiB/, 'a header over the 1 MiB the server reads'],
    [bozz({ raw: true }).subarray(0, 40), /cut short/, 'a header cut short'],
    [bozz({ edit: (h) => (h.scene.v = 5) }), /version/, 'a version the app does not read'],
    [bozz({ edit: (h) => (h.scene.meshes = []) }), /no objects/, 'no objects'],
    [bozz({ edit: (h) => (h.scene.active = 1) }), /no object is selected/, 'a selected object past the last'],
    [bozz({ edit: (h) => (h.buffers[0].t = 'f32') }), /faces of the wrong kind or size/, 'faces that are floats'],
    [bozz({ edit: (h) => (h.scene.meshes[0].nbBaseFaces = 2) }), /faces of the wrong kind or size/, 'fewer faces than it says'],
    [bozz({ edit: (h) => (h.scene.meshes[0].baseFaces = { __buf: 99 }) }), /a missing array/, 'a reference past the table'],
    [bozz({ edit: (h) => (h.scene.meshes[0].baseFaces = { __buf: 0.5 }) }), /a bad array reference/, 'a reference that is not a whole number'],
    [bozz({ edit: (h) => (h.scene.meshes[0].levels[0].colors = { __buf: 1 }) }), /an array used twice/, 'one array used twice'],
    [bozz({ edit: (h) => (h.scene.meshes[0].levels = []) }), /no levels/, 'an object with no levels'],
    [bozz({ edit: (h) => (h.scene.meshes[0].sel = 1) }), /selects no level/, 'a selected level past the last'],
    [bozz({ edit: (h) => (h.scene.meshes[0].levels[0].nbVertices = 0) }), /no vertices/, 'a level with no vertices'],
    [bozz({ edit: (h) => (h.buffers[2].t = 'u32') }), /arrays of the wrong kind or size/, 'colours that are not floats'],
    [bozz({ edit: (h) => (h.buffers[1].len = 8) }), /arrays of the wrong kind or size/, 'positions short of three a vertex'],
    [bozz({ edit: (h) => delete h.scene.meshes[0].levels[0].normals }), /arrays of the wrong kind or size/, 'normals neither there nor null'],
    [bozz({ edit: (h) => (h.buffers[4].len = 15) }), /no matrix/, 'a matrix of 15'],
    [bozz({ edit: deep }), /nests too deeply/, 'nesting 40 deep'],
    [bozz({ edit: (h) => (h.scene.look = JSON.parse('{"__proto__": {"polluted": true}}')) }), /__proto__/, 'a field called __proto__'],
    [bozz({ edit: (h) => (h.scene.meshes[0].name = 'n'.repeat(201)) }), /object 1 has a name over 200/, 'an object named in 201 characters'],
    [bozz({ edit: (h) => (h.scene.materials[0].name = 'm'.repeat(201)) }), /a material has a name over 200/, 'a material named in 201 characters'],
    [bozz({ edit: (h) => (h.scene.materials = Array.from({ length: 1025 }, (_, i) => ({ id: `m${i}`, name: 'M' }))) }), /more than 1024 materials/, '1,025 materials'],
  ];
  for (const [file, reason, what] of cases) {
    const { r } = await send(file);
    t.ok(r.status === 422 && r.json?.code === 'bad_scene' && reason.test(r.json?.reason ?? ''), `${what}: 422 bad_scene (${r.status} ${r.json?.reason})`);
  }
  const ok200 = bozz({ edit: (h) => (h.scene.meshes[0].name = 'n'.repeat(200)) });
  const { r: fine } = await send(ok200);
  t.ok(fine.status === 201, `a name of exactly 200 characters is taken (${fine.status} ${fine.json?.reason ?? ''})`);
  t.report();

  // --- the file as a whole ------------------------------------------------------------------------
  t = checks('functions: content, the whole file');
  const good = bozz({ vertices: 100, seed: 11 });
  let { up, r } = await send(good);
  let done = await member.call('POST', `${scene}?upload=${encodeURIComponent(up.uploadId)}`, { json: { parts: [r.json], objects: 1, tris: 1 } });
  let back = await member.call('GET', `/api/me/media/${sc}/scene.bozz`);
  t.ok(r.status === 201 && done.status === 200 && same(back.bytes, good), `a gzipped scene as the app writes one goes in whole (${r.status}, ${done.status}, ${back.status})`);
  const bare = bozz({ vertices: 100, seed: 12, raw: true });
  ({ up, r } = await send(bare));
  done = await member.call('POST', `${scene}?upload=${encodeURIComponent(up.uploadId)}`, { json: { parts: [r.json], objects: 1, tris: 1 } });
  back = await member.call('GET', `/api/me/media/${sc}/scene.bozz`);
  t.ok(r.status === 201 && done.status === 200 && same(back.bytes, bare), `so does a bare one, from a browser without CompressionStream (${r.status}, ${done.status})`);
  ({ r } = await send(concat(bare, new Uint8Array(4)), bare.length + 4));
  t.ok(r.status === 422 && /size is not what its header says/.test(r.json?.reason ?? ''), `a bare one longer than its header says: 422 (${r.status} ${r.json?.reason})`);
  // Whole in part 1, the trailer is the inflater's to refuse as well, and
  // which of the two speaks first depends on where its buffers fall.
  ({ r } = await send(bozz({ trailer: 7 })));
  t.ok(r.status === 422 && /does not end where its header says|does not decompress/.test(r.json?.reason ?? ''), `a gzip trailer that says another size: 422 (${r.status} ${r.json?.reason})`);
  const longer = new Uint8Array(gzipSync(concat(bozz({ raw: true }), new Uint8Array(400))));
  ({ r } = await send(longer));
  t.ok(r.status === 422 && /does not end where its header says/.test(r.json?.reason ?? ''), `a file that inflates past what its header says: 422 (${r.status} ${r.json?.reason})`);
  const big = bozzOf(9 * MiB, 13);
  new DataView(big.buffer, big.byteOffset).setUint32(big.length - 4, 12345, true);
  const [b1, b2] = parts(big, 8 * MiB);
  const bigUp = (await member.call('POST', scene, { json: { size: big.length } })).json;
  const q1 = await member.call('PUT', `${scene}?upload=${encodeURIComponent(bigUp.uploadId)}&part=1`, { bytes: b1 });
  const q2 = await member.call('PUT', `${scene}?upload=${encodeURIComponent(bigUp.uploadId)}&part=2`, { bytes: b2 });
  t.ok(q1.status === 201 && q2.status === 422 && /does not end/.test(q2.json?.reason ?? ''), `in parts, the last one is held to part 1's header (${q1.status}, ${q2.status} ${q2.json?.reason})`);
  const usage = (await member.call('GET', '/api/me')).json?.usage;
  t.eq(usage?.reserved, b1.length, 'and what was refused is not reserved');
  back = await member.call('GET', `/api/me/media/${sc}/scene.bozz`);
  t.ok(same(back.bytes, bare), 'none of the refused files reached the stored one');
  t.report();

  // --- thumbnails and frames -------------------------------------------------------------------
  t = checks('functions: content, thumbnails and frames');
  for (const [bytes, what] of [
    [text('GIF89a<script>alert(1)</script>'), 'a GIF with a script in it'],
    [text('<!doctype html><title>x</title>'), 'an HTML page'],
    [concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), new Uint8Array(64)), 'a PNG'],
  ]) {
    r = await member.call('POST', `/api/me/projects/${tl}/thumb`, { bytes });
    t.ok(r.status === 415 && r.json?.code === 'bad_type', `${what} as a thumbnail: 415 bad_type (${r.status} ${r.json?.code})`);
  }
  const polyglot = concat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), text('<html><script>alert(document.cookie)</script></html>'));
  r = await member.call('POST', `/api/me/projects/${tl}/thumb`, { bytes: polyglot });
  back = await member.call('GET', `/api/me/media/${tl}/thumb.jpg`);
  const h = (name) => back.headers.get(name);
  t.ok(r.status === 201 && back.status === 200 && same(back.bytes, polyglot), `a JPEG start with a page after it is taken, as a JPEG may be anything after (${r.status})`);
  t.ok(h('content-type') === 'image/jpeg' && h('x-content-type-options') === 'nosniff' && h('content-security-policy') === "default-src 'none'; sandbox" && h('content-disposition') === 'inline', `and served as an image no browser runs: image/jpeg, nosniff, sandboxed (${h('content-type')} ${h('content-security-policy')})`);
  for (const [bytes, what] of [
    [new Uint8Array(200).fill(7), 'bytes that are nothing'],
    [glb({ raw: true, version: 1 }), 'glTF 1'],
    [glb({ raw: true, length: 99 }), 'a GLB whose header gives another length'],
    [glb({ version: 1 }), 'glTF 1, gzipped'],
    [glb({ length: 99 }), 'a gzipped GLB whose header gives another length'],
    [new Uint8Array(gzipSync(text('not a model, only words, gzipped'))), 'gzip of something else'],
    [text('glTF'), 'the magic alone'],
  ]) {
    r = await member.call('POST', `/api/me/projects/${tl}/frames?index=0`, { bytes });
    t.ok(r.status === 415 && r.json?.code === 'bad_type', `${what} as a frame: 415 bad_type (${r.status} ${r.json?.code})`);
  }
  const rawFrame = glb({ raw: true, seed: 3 });
  const gzFrame = glb({ seed: 4 });
  const f1 = await member.call('POST', `/api/me/projects/${tl}/frames?index=0`, { bytes: rawFrame });
  const f2 = await member.call('POST', `/api/me/projects/${tl}/frames?index=1`, { bytes: gzFrame });
  back = await member.call('GET', `/api/me/media/${tl}/frames/sd/0001.glb`);
  t.ok(f1.status === 201 && f2.status === 201 && same(back.bytes, gzFrame), `glTF 2.0, raw and gzipped, is taken (${f1.status}, ${f2.status})`);
  t.report();

  // --- owner tools' scenes ------------------------------------------------------------------
  t = checks("functions: content, owner tools' scenes are checked too");
  const owner = (method, path, opts = {}) => off.call(method, path, { headers: asOwner, ...opts });
  const made = await owner('POST', '/admin/api/projects', { json: { mode: 'scene', title: 'Template scene' } });
  const os = `/admin/api/projects/${made.json?.id}/scene`;
  /** Owner tools' upload as the 0.5 client starts it: no size declared. */
  const ownerSend = async (file, size) => {
    const u = (await owner('POST', os, size === undefined ? {} : { json: { size } })).json?.uploadId;
    return { u, r: await owner('PUT', `${os}?upload=${encodeURIComponent(u)}&part=1`, { bytes: file }) };
  };
  let o = await ownerSend(concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), new Uint8Array(32)));
  t.ok(o.r.status === 415 && o.r.json?.code === 'bad_type', `a PNG as a template's scene: 415 bad_type (${o.r.status})`);
  o = await ownerSend(bozz({ edit: (hd) => (hd.scene.v = 9) }));
  t.ok(o.r.status === 422 && o.r.json?.code === 'bad_scene' && /version/.test(o.r.json?.reason ?? ''), `a bad header: 422 bad_scene (${o.r.status} ${o.r.json?.reason})`);
  o = await ownerSend(longer, undefined);
  const noSize = o.r.status;
  o = await ownerSend(longer, longer.length);
  t.ok(noSize === 201 && o.r.status === 422 && /does not end where its header says/.test(o.r.json?.reason ?? ''), `a file longer than its header says passes without a size declared, as the 0.5 client sends none, and not with one (${noSize}, ${o.r.status} ${o.r.json?.reason})`);
  const tpl = bozz({ vertices: 64, seed: 21 });
  const big2 = bozzOf(9 * MiB, 22);
  const [c1, c2] = parts(big2, 8 * MiB);
  let u2 = (await owner('POST', os)).json?.uploadId;
  r = await owner('PUT', `${os}?upload=${encodeURIComponent(u2)}&part=2`, { bytes: c2 });
  t.ok(r.status === 400, `part 2 before part 1: 400 (${r.status} ${r.json?.error})`);
  const c1r = await owner('PUT', `${os}?upload=${encodeURIComponent(u2)}&part=1`, { bytes: c1 });
  const c2r = await owner('PUT', `${os}?upload=${encodeURIComponent(u2)}&part=2`, { bytes: c2 });
  r = await owner('POST', `${os}?upload=${encodeURIComponent(u2)}`, { json: { parts: [c2r.json], objects: 1, tris: 1 } });
  t.ok(c1r.status === 201 && c2r.status === 201 && r.status === 400, `finishing must name every part from 1, so no unchecked part can stand alone (${r.status} ${r.json?.error})`);
  r = await owner('POST', `${os}?upload=${encodeURIComponent(u2)}`, { json: { parts: [c1r.json, c2r.json], objects: 1, tris: 1 } });
  t.ok(r.status === 200 && r.json?.scene?.bytes === big2.length, `with every part it completes (${r.status} ${JSON.stringify(r.json?.scene)})`);
  o = await ownerSend(tpl);
  r = await owner('POST', `${os}?upload=${encodeURIComponent(o.u)}`, { json: { parts: [o.r.json], objects: 1, tris: 1 } });
  back = await owner('GET', `/admin/api/media/${made.json?.id}/scene.bozz`);
  t.ok(o.r.status === 201 && r.status === 200 && same(back.bytes, tpl), `a good one goes in as before (${o.r.status}, ${r.status})`);
  t.report();

  // --- the one reader ---------------------------------------------------------------------------
  t = checks('functions: content, shared/bozz.ts');
  const load = await compileShared();
  const bozzTs = await load('../../shared/bozz');
  const content = await load('content');
  const head = bozz({ raw: true });
  t.eq(bozzTs.readLayout(head.subarray(0, 8)), 8 + new DataView(head.buffer).getUint32(4, true), 'readLayout from the first 8 bytes says how many it takes');
  const layout = bozzTs.readLayout(head);
  t.ok(layout.size === head.length && layout.blobBase % 4 === 0 && layout.buffers.length === 5, `and from those, the layout (${layout.size}, ${layout.blobBase})`);
  let threw = null;
  try {
    bozzTs.checkHeader({ ...layout, scene: { ...layout.scene, v: 2 } });
  } catch (err) {
    threw = err;
  }
  t.ok(threw instanceof bozzTs.SceneFileError && /version/.test(threw.message), `checkHeader throws the app's own error (${threw?.message})`);
  t.eq(content.MAX_SERVER_HEADER, MiB, 'the server reads at most 1 MiB of header');
  const source = readFileSync(join(repo, 'src', 'sculpt', 'bridge', 'SceneFile.ts'), 'utf8');
  t.ok(/from '\.\.\/\.\.\/\.\.\/shared\/bozz'/.test(source) && !/function readLayout/.test(source) && !/class SceneFileError/.test(source), "the app's SceneFile.ts reads with shared/bozz.ts's readLayout and defines none of its own");
  t.report();
}
