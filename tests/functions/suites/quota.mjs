// Storage and quota (docs/accounts.md §4): an account's scene uploads
// admitted part by part against its quota by one atomic statement -
// concurrent parts where only some fit, a part sent again replacing its
// own reservation, the size declared at the start held to, the caps -
// completion moving the bytes from reserved to stored (less what the file
// replaces), an abort and a stale upload giving them back, one upload per
// scene; frames and thumbnails reserved before the put and given back when
// it fails; a project's deletion and its orphaned frames refunded; and at
// most 500 projects an account.
import {
  Browser,
  MiB,
  bozz,
  bozzOf,
  d1,
  glb,
  jpeg,
  migratedDatabase,
  parts,
  seedSession,
  seedUser,
  seededToken,
} from '../lib.mjs';

export const needs = ['on'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const T = 2_700_000_000_000;

const U = {
  pair: 'u-qtpair00000000000000000000',
  files: 'u-qtfiles0000000000000000000',
  many: 'u-qtmany00000000000000000000',
  stale: 'u-qtstale0000000000000000000',
};

export const seed = {
  sql: [
    // Room for two parts of 8 MiB and one of the 5 MiB that follow them, not two.
    seedUser({ id: U.pair, handle: 'qtpair', quota: 24 * MiB }),
    seedUser({ id: U.files, handle: 'qtfiles', quota: 100_000 }),
    seedUser({ id: U.many, handle: 'qtmany' }),
    seedUser({ id: U.stale, handle: 'qtstale' }),
    ...Object.entries(U).map(([name, user]) => seedSession({ name: `qt-${name}`, id: `s-qt${name}`, user, created: T })),
    // 499 projects: the 500th is the last one an account may make.
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 499)
     INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at)
     SELECT 'p-qtmany' || i, 'Seeded ' || i, 'model', 4, '{"defaults":{},"camera":{},"stages":[],"frames":[]}', 'private', 0,
            '${U.many}', 'users/${U.many}/projects/p-qtmany' || i || '/', ${T}, ${T} FROM n;`,
  ].join('\n'),
};

export async function run({ checks, on, compileShared, repo }) {
  const clock = { now: T + MINUTE };
  let ips = 0;
  const as = (name) => {
    const b = new Browser(on, { ip: `198.51.100.${10 + (ips++ % 40)}`, clock });
    b.jar.set('__Host-bz_session', seededToken(`qt-${name}`));
    return b;
  };
  const usage = async (b) => (await b.call('GET', '/api/me')).json?.usage ?? {};
  const create = async (b, mode = 'scene', title = 'A scene') => (await b.call('POST', '/api/me/projects', { json: { title, mode } })).json?.id;
  const scene = (id) => `/api/me/projects/${id}/scene`;
  const start = (b, id, size) => b.call('POST', scene(id), { json: { size } });
  const put = (b, id, upload, part, bytes) =>
    b.call('PUT', `${scene(id)}?upload=${encodeURIComponent(upload)}&part=${part}`, { bytes });
  const complete = (b, id, upload, list, objects = 1, tris = 2) =>
    b.call('POST', `${scene(id)}?upload=${encodeURIComponent(upload)}`, { json: { parts: list, objects, tris } });
  const listed = async (b, id) => ((await b.call('GET', '/api/me/projects')).json ?? []).find((p) => p.id === id);

  // --- parts against the quota ------------------------------------------------------------------
  let t = checks('functions: quota, scene parts');
  const pair = as('pair');
  const [a, b] = [await create(pair, 'scene', 'First'), await create(pair, 'scene', 'Second')];
  t.ok(/^p-[0-9a-hjkmnp-tv-z]{26}$/.test(a ?? '') && /^p-/.test(b ?? ''), `two scene projects, server-made ids (${a}, ${b})`);
  const fileA = bozzOf(13 * MiB, 1);
  const fileB = bozzOf(13 * MiB, 2);
  const [a1, a2] = parts(fileA, 8 * MiB);
  const [b1, b2] = parts(fileB, 8 * MiB);
  let r = await start(pair, a, 25 * MiB);
  t.ok(r.status === 413 && r.json?.code === 'quota_exceeded' && r.json?.used === 0 && r.json?.quota === 24 * MiB, `a start declaring more than the quota: 413 quota_exceeded {used, quota} (${r.status} ${JSON.stringify(r.json)})`);
  const upA = (await start(pair, a, fileA.length)).json;
  const upB = (await start(pair, b, fileB.length)).json;
  t.ok(typeof upA?.uploadId === 'string' && upA?.partSize === 8 * MiB && typeof upB?.uploadId === 'string', `each starts, asked for 8 MiB parts (${JSON.stringify(upA)})`);
  const pa1 = await put(pair, a, upA.uploadId, 1, a1);
  const pb1 = await put(pair, b, upB.uploadId, 1, b1);
  t.ok(pa1.status === 201 && pb1.status === 201 && pa1.json?.part === 1 && !!pa1.json?.etag, `both first parts fit (${pa1.status}, ${pb1.status})`);
  t.eq((await usage(pair)).reserved, 16 * MiB, 'and are reserved, nothing stored yet');
  const againA = await put(pair, a, upA.uploadId, 1, a1);
  const againB = await put(pair, b, upB.uploadId, 1, b1);
  t.ok(againA.status === 201 && againB.status === 201 && (await usage(pair)).reserved === 16 * MiB, `part 1 sent again replaces its own reservation (${againA.status}, ${againB.status})`);
  const racing = await Promise.all([put(pair, a, upA.uploadId, 2, a2), put(pair, b, upB.uploadId, 2, b2)]);
  const statuses = racing.map((x) => x.status).sort().join(',');
  const refused = racing.find((x) => x.status === 413);
  t.eq(statuses, '201,413', 'two last parts at once, room for one: one is admitted, one is not');
  t.ok(refused?.json?.code === 'quota_exceeded' && refused?.json?.quota === 24 * MiB && refused?.json?.used > 20 * MiB, `the other: 413 quota_exceeded, saying how full it is (${JSON.stringify(refused?.json)})`);
  // Each part 1 was sent again: the etag of the second is the one R2 holds now.
  const won =
    racing[0].status === 201
      ? { id: a, up: upA, file: fileA, first: pa1, p1: againA, p2: racing[0] }
      : { id: b, up: upB, file: fileB, first: pb1, p1: againB, p2: racing[1] };
  const lost = won.id === a ? { id: b, up: upB, last: b2 } : { id: a, up: upA, last: a2 };
  let u = await usage(pair);
  t.ok(u.used === 0 && u.reserved === 16 * MiB + won.file.length - 8 * MiB, `reserved: both first parts and the one last part (${JSON.stringify(u)})`);
  r = await complete(pair, won.id, won.up.uploadId, [won.first.json, won.p2.json], 3, 300);
  t.ok(r.status === 200 || (r.status === 400 && r.json?.code === 'bad_request'), `naming part 1 by the etag it had before it was sent again: done, or a 400 when R2 gave it a new one (${r.status} ${r.json?.error ?? ''})`);
  if (r.status !== 200) r = await complete(pair, won.id, won.up.uploadId, [won.p1.json, won.p2.json], 3, 300);
  t.ok(r.status === 200 && r.json?.scene?.bytes === won.file.length && r.json?.scene?.objects === 3, `completing: the manifest, with the size R2 measured (${r.status} ${JSON.stringify(r.json?.scene)})`);
  u = await usage(pair);
  t.ok(u.used === won.file.length && u.reserved === 8 * MiB, `its bytes move from reserved to stored (${JSON.stringify(u)})`);
  t.eq((await listed(pair, won.id))?.bytes, won.file.length, 'and onto the project, as My projects lists it');
  r = await put(pair, lost.id, lost.up.uploadId, 2, lost.last);
  t.ok(r.status === 413 && r.json?.code === 'quota_exceeded', `the other's last part still does not fit (${r.status})`);
  r = await pair.call('DELETE', `${scene(lost.id)}?upload=${encodeURIComponent(lost.up.uploadId)}`);
  u = await usage(pair);
  t.ok(r.status === 200 && r.json?.aborted === true && u.reserved === 0 && u.used === won.file.length, `abandoning it gives its part back (${r.status} ${JSON.stringify(u)})`);
  r = await put(pair, lost.id, lost.up.uploadId, 1, won.file.subarray(0, 100));
  t.ok(r.status === 404 && r.json?.code === 'not_found', `and its id is gone (${r.status} ${r.json?.code})`);

  // A re-save is counted against what it replaces.
  const smaller = bozz({ vertices: 1000, seed: 9 });
  const re = (await start(pair, won.id, smaller.length)).json;
  const rp = await put(pair, won.id, re.uploadId, 1, smaller);
  r = await complete(pair, won.id, re.uploadId, [rp.json]);
  u = await usage(pair);
  t.ok(r.status === 200 && u.used === smaller.length && u.reserved === 0, `a re-save replaces the file's bytes rather than adding to them (${r.status} ${JSON.stringify(u)})`);
  t.eq((await listed(pair, won.id))?.bytes, smaller.length, 'the project weighs what it holds now');
  t.report();

  // --- what an upload declares, and the caps ------------------------------------------------------
  t = checks('functions: quota, declared sizes and caps');
  const caps = await create(pair, 'scene', 'Caps');
  r = await pair.call('POST', scene(caps), { json: {} });
  t.ok(r.status === 400 && r.json?.code === 'bad_request', `a start must say the file's size (${r.status} ${r.json?.code})`);
  r = await start(pair, caps, 100 * MiB + 1);
  t.ok(r.status === 413 && r.json?.code === 'file_too_large', `a scene over 100 MiB: 413 file_too_large (${r.status} ${r.json?.code})`);
  const one = bozz({ vertices: 50, seed: 4 });
  let up = (await start(pair, caps, one.length - 10)).json;
  r = await put(pair, caps, up.uploadId, 1, one);
  t.ok(r.status === 413 && r.json?.code === 'file_too_large', `a part past the size declared: 413 file_too_large (${r.status} ${r.json?.code})`);
  const nine = bozzOf(9 * MiB, 5);
  up = (await start(pair, caps, nine.length)).json;
  const [n1, n2] = parts(nine, 8 * MiB);
  r = await put(pair, caps, up.uploadId, 2, n2);
  t.ok(r.status === 400 && /part 1 first/i.test(r.json?.error ?? ''), `part 2 before part 1: 400 (${r.status} ${r.json?.error})`);
  r = await put(pair, caps, up.uploadId, 1, n1.subarray(0, 4 * MiB));
  t.ok(r.status === 400 && /at least/i.test(r.json?.error ?? ''), `a first part under R2's 5 MiB with more to come: 400 (${r.status} ${r.json?.error})`);
  const q1 = await put(pair, caps, up.uploadId, 1, n1);
  r = await put(pair, caps, up.uploadId, 2, n2.subarray(0, n2.length - 1));
  t.ok(q1.status === 201 && r.status === 400 && /should be/.test(r.json?.error ?? ''), `the last part must be the rest of the size declared (${q1.status}, ${r.status} ${r.json?.error})`);
  r = await put(pair, caps, up.uploadId, 3, n2);
  t.ok(r.status === 400 && /past/i.test(r.json?.error ?? ''), `and there is no part past it (${r.status} ${r.json?.error})`);
  r = await complete(pair, caps, up.uploadId, [q1.json]);
  t.ok(r.status === 400, `finishing without every part is refused (${r.status} ${r.json?.error})`);
  r = await put(pair, caps, up.uploadId, 1, new Uint8Array(32 * MiB + 1));
  t.ok(r.status === 413 && r.json?.code === 'file_too_large', `a part over 32 MiB: 413 file_too_large (${r.status} ${r.json?.code})`);
  r = await pair.call('DELETE', `${scene(caps)}?upload=${encodeURIComponent(up.uploadId)}`);
  t.eq((await usage(pair)).reserved, 0, 'abandoned, nothing stays reserved');
  const reel = await create(pair, 'timelapse', 'Reel');
  for (const [q, why] of [
    ['', 'no index'],
    ['?index=10000', 'an index past 9999'],
    ['?index=-1', 'a negative index'],
  ]) {
    r = await pair.call('POST', `/api/me/projects/${reel}/frames${q}`, { bytes: glb() });
    t.ok(r.status === 400 && r.json?.code === 'bad_request', `a frame with ${why}: 400 (${r.status})`);
  }
  r = await pair.call('POST', `/api/me/projects/${reel}/frames?index=0`, { bytes: new Uint8Array(32 * MiB + 1) });
  t.ok(r.status === 413 && r.json?.code === 'file_too_large', `a frame over 32 MiB: 413 file_too_large (${r.status} ${r.json?.code})`);
  r = await pair.call('POST', `/api/me/projects/${reel}/thumb`, { bytes: jpeg(1, MiB) });
  t.ok(r.status === 413 && r.json?.code === 'file_too_large', `a thumbnail over 1 MiB: 413 file_too_large (${r.status} ${r.json?.code})`);
  r = await pair.call('POST', scene(reel), { json: { size: 100 } });
  t.ok(r.status === 400 && r.json?.code === 'bad_request', `a timelapse takes no scene upload (${r.status})`);
  t.report();

  // --- one upload a scene, and uploads left behind ----------------------------------------------------
  t = checks('functions: quota, uploads left behind');
  const stale = as('stale');
  const [s1, s2] = [await create(stale), await create(stale)];
  const small = bozz({ vertices: 200, seed: 6 });
  const first = (await start(stale, s1, small.length)).json;
  await put(stale, s1, first.uploadId, 1, small);
  const second = (await start(stale, s1, small.length)).json;
  r = await put(stale, s1, first.uploadId, 1, small);
  t.ok(r.status === 404 && second?.uploadId !== first.uploadId, `a second start on a scene replaces the first upload, whose id is gone (${r.status})`);
  t.eq((await usage(stale)).reserved, 0, 'with what its part held');
  await put(stale, s1, second.uploadId, 1, small);
  t.eq((await usage(stale)).reserved, small.length, 'the new one holds its own');
  clock.now += 25 * HOUR;
  const other = (await start(stale, s2, small.length)).json;
  r = await put(stale, s1, second.uploadId, 1, small);
  t.ok(typeof other?.uploadId === 'string' && r.status === 404, `a start a day later gives up the account's upload left since (${r.status})`);
  t.eq((await usage(stale)).reserved, 0, 'and what it held');
  t.report();

  // --- frames and thumbnails ------------------------------------------------------------------
  t = checks('functions: quota, frames and thumbnails');
  const files = as('files');
  const tl = await create(files, 'timelapse', 'Frames');
  const f40 = glb({ bin: 40_000, seed: 1 });
  const f40b = glb({ bin: 40_000, seed: 2 });
  r = await files.call('POST', `/api/me/projects/${tl}/frames?index=0`, { bytes: f40 });
  u = await usage(files);
  t.ok(r.status === 201 && r.json?.index === 0 && r.json?.size === f40.length && u.used === f40.length, `a frame lands and is counted (${r.status} ${JSON.stringify(u)})`);
  await files.call('POST', `/api/me/projects/${tl}/frames?index=1`, { bytes: f40b });
  r = await files.call('POST', `/api/me/projects/${tl}/frames?index=2`, { bytes: glb({ bin: 40_000, seed: 3 }) });
  u = await usage(files);
  t.ok(r.status === 413 && r.json?.code === 'quota_exceeded' && r.json?.used === f40.length + f40b.length && r.json?.quota === 100_000, `a third does not fit: 413 quota_exceeded (${r.status} ${JSON.stringify(r.json)})`);
  t.eq(u.used, f40.length + f40b.length, 'and takes nothing');
  r = await files.call('GET', `/api/me/media/${tl}/frames/sd/0002.glb`);
  t.eq(r.status, 404, 'nor is it stored');
  const f10 = glb({ bin: 10_000, seed: 4 });
  r = await files.call('POST', `/api/me/projects/${tl}/frames?index=1`, { bytes: f10 });
  u = await usage(files);
  t.ok(r.status === 201 && u.used === f40.length + f10.length, `a frame replaced by a smaller one counts only the smaller (${JSON.stringify(u)})`);
  const thumb = jpeg(5, 20_000);
  r = await files.call('POST', `/api/me/projects/${tl}/thumb`, { bytes: thumb });
  u = await usage(files);
  t.ok(r.status === 201 && u.used === f40.length + f10.length + thumb.length, `a thumbnail is counted too (${JSON.stringify(u)})`);
  t.eq((await listed(files, tl))?.bytes, u.used, 'all of it the project\'s');
  r = await files.call('PUT', `/api/me/projects/${tl}`, { json: { frames: [{ index: 0, tris: 1 }, { index: 1, tris: 1 }] } });
  r = await files.call('PUT', `/api/me/projects/${tl}`, { json: { frames: [{ index: 0, tris: 1 }] } });
  u = await usage(files);
  t.ok(r.status === 200 && u.used === f40.length + thumb.length && r.json?.bytes === u.used, `a frame list without frame 1 deletes it and gives its bytes back (${r.status} ${JSON.stringify(u)})`);
  r = await files.call('GET', `/api/me/media/${tl}/frames/sd/0001.glb`);
  t.eq(r.status, 404, 'it is gone from R2');
  const sc = await create(files, 'scene', 'Scene to delete');
  const tiny = bozz({ vertices: 30, seed: 7 });
  let up2 = (await start(files, sc, tiny.length)).json;
  let p = await put(files, sc, up2.uploadId, 1, tiny);
  await complete(files, sc, up2.uploadId, [p.json]);
  up2 = (await start(files, sc, tiny.length)).json;
  await put(files, sc, up2.uploadId, 1, tiny);
  u = await usage(files);
  t.ok(u.used === f40.length + thumb.length + tiny.length && u.reserved === tiny.length, `a scene stored and another upload of it under way (${JSON.stringify(u)})`);
  r = await files.call('DELETE', `/api/me/projects/${sc}`);
  u = await usage(files);
  t.ok(r.status === 200 && r.json?.deleted === true && u.used === f40.length + thumb.length && u.reserved === 0, `deleting the project gives back its bytes and its upload's (${r.status} ${JSON.stringify(u)})`);
  r = await files.call('DELETE', `/api/me/projects/${tl}`);
  u = await usage(files);
  t.ok(r.status === 200 && u.used === 0, `and deleting the last one leaves the account at nothing (${JSON.stringify(u)})`);
  t.report();

  // --- 500 projects ------------------------------------------------------------------------
  t = checks('functions: quota, 500 projects');
  const many = as('many');
  r = await many.call('POST', '/api/me/projects', { json: { title: 'The 500th' } });
  t.ok(r.status === 201 && r.json?.visibility === 'private' && r.json?.mode === 'timelapse', `the 500th project is made (${r.status})`);
  r = await many.call('POST', '/api/me/projects', { json: { title: 'One too many' } });
  t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.limit === 500, `the 501st: 400 with limit 500 (${r.status} ${JSON.stringify(r.json)})`);
  t.eq(((await many.call('GET', '/api/me/projects')).json ?? []).length, 500, 'it still has 500');
  t.report();

  // --- directly: a put that fails gives back what it took ----------------------------------------
  t = checks('functions: quota, directly');
  const db = await migratedDatabase(repo);
  if (!db) {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the direct checks did not run');
  } else {
    const load = await compileShared();
    const uploads = await load('uploads');
    const quota = await load('quota');
    const user = 'u-qtdirect000000000000000000';
    db.exec(seedUser({ id: user, handle: 'qtdirect', quota: 50_000 }));
    db.exec(`INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at)
      VALUES ('p-qtdirect', 'Direct', 'timelapse', 4, '{"defaults":{},"camera":{},"stages":[],"frames":[]}', 'private', 0, '${user}', 'users/${user}/projects/p-qtdirect/', 0, 0)`);
    const stored = new Map();
    let failing = false;
    const BUCKET = {
      head: async (key) => (stored.has(key) ? { size: stored.get(key).length } : null),
      put: async (key, body) => {
        if (failing) throw new Error('R2 is down');
        stored.set(key, new Uint8Array(body));
        return { size: body.byteLength };
      },
      list: async ({ prefix }) => ({ objects: [...stored].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.length })), truncated: false }),
      delete: async (keys) => [].concat(keys).forEach((k) => stored.delete(k)),
    };
    const env = { DB: d1(db), BUCKET };
    const row = () => db.prepare('SELECT bytes_used FROM users WHERE id = ?').get(user).bytes_used;
    const frame = glb({ bin: 20_000 });
    const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(user);
    failing = true;
    let threw = null;
    try {
      await uploads.putMemberFrame(env, userRow, 'p-qtdirect', 0, frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
    } catch (err) {
      threw = err;
    }
    t.ok(threw?.message === 'R2 is down' && row() === 0, `a put that fails is given back what it reserved (${row()})`);
    failing = false;
    await uploads.putMemberFrame(env, userRow, 'p-qtdirect', 0, frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength));
    const projectBytes = db.prepare("SELECT bytes FROM projects WHERE id = 'p-qtdirect'").get().bytes;
    t.ok(row() === frame.length && projectBytes === frame.length, `one that lands keeps it, on the account and the project (${row()}, ${projectBytes})`);
    let refused = null;
    try {
      await quota.reserveBytes(env, user, 50_000);
    } catch (err) {
      refused = err;
    }
    t.ok(refused?.status === 413 && refused?.code === 'quota_exceeded' && refused?.extra?.used === frame.length && row() === frame.length, `a reservation that does not fit is refused, taking nothing (${refused?.status} ${JSON.stringify(refused?.extra)})`);
    db.exec(`UPDATE users SET bytes_used = 999 WHERE id = '${user}'`);
    const counted = await quota.recountUsage(env, user);
    t.ok(counted.used === frame.length && row() === frame.length && counted.projects['p-qtdirect'] === frame.length, `a recount puts a drifted count right from R2's listing (${JSON.stringify(counted)})`);
    db.close();
  }
  t.report();
}
