// Deleting an account (docs/accounts.md §3, §10): the first call needs
// recent authentication and the handle, marks the account `deleting`,
// signs out its other sessions, audits and mails; every call carries the
// deletion on within its subrequests - uploads, each project's files and
// row, the rest of the account's folder but what templates still read,
// then its passkeys, flows, invites, sessions and the account, its handle
// held 90 days - answering {done: false, remaining} until {done: true}. An
// account being deleted reaches that route alone. Over HTTP for the
// cascade, and directly for what each call spends.
import {
  Browser,
  auditRows,
  bozz,
  d1,
  glb,
  jpeg,
  migratedDatabase,
  outbox,
  same,
  seedCredential,
  seedSession,
  seedUser,
  seededToken,
  setCookies,
  storedUser,
} from '../lib.mjs';

export const needs = ['on'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The suite's own day, for the mail cap. */
const T = 3_200_000_000_000;

const A = 'u-dlalice0000000000000000000';
const B = 'u-dlbob000000000000000000000';
const C = 'u-dlcarol0000000000000000000';
const TEMPLATE_THUMB = jpeg(81);
const MANY = 30;
const DATA = '{"defaults":{},"camera":{},"stages":[],"frames":[]}';

export const seed = {
  sql: [
    seedUser({ id: A, handle: 'dlalice' }),
    seedUser({ id: B, handle: 'dlbob' }),
    seedUser({ id: C, handle: 'dlcarol', status: 'deleting' }),
    seedCredential({ credential: { id: 'dl-credential', cose: new Uint8Array([165, 1, 2]) }, user: A }),
    seedSession({ name: 'dl-a-main', id: 's-dlamain', user: A, created: T }),
    seedSession({ name: 'dl-a-stale', id: 's-dlastale', user: A, created: T - HOUR }),
    seedSession({ name: 'dl-a-other', id: 's-dlaother', user: A, created: T, client: 'desktop' }),
    seedSession({ name: 'dl-b-main', id: 's-dlbmain', user: B, created: T }),
    seedSession({ name: 'dl-c-main', id: 's-dlcmain', user: C, created: T - HOUR }),
    `INSERT INTO invites (id, token_hash, label, max_uses, uses, created_by, created_at, expires_at)
       VALUES ('dl-invite', 'dl-invite-hash', 'Made by Alice', 5, 0, '${A}', ${T}, ${T + 14 * DAY});`,
    `INSERT INTO pending_auth (id, kind, purpose, user_id, secret, created_at, expires_at)
       VALUES ('dl-flow', 'webauthn', 'add_passkey', '${A}', 'challenge', ${T}, ${T + 5 * MINUTE});`,
    // A template made from one of Alice's projects keeps its prefix in her
    // folder (§4): its files must outlive her.
    `INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at)
       VALUES ('dl-tpl', 'Her template', 'timelapse', 4, '${DATA}', 'public', 1, NULL, 'users/${A}/projects/dl-tpl/', ${T}, ${T});`,
    // Bob has many projects; Carol, already being deleted, one.
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${MANY})
     INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at)
     SELECT 'p-dlbob' || i, 'Bob ' || i, 'model', 4, '${DATA}', 'private', 0, '${B}', 'users/${B}/projects/p-dlbob' || i || '/', ${T} + i, ${T} FROM n;`,
    `INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at)
       VALUES ('p-dlcarol', 'Carol', 'model', 4, '${DATA}', 'private', 0, '${C}', 'users/${C}/projects/p-dlcarol/', ${T}, ${T});`,
  ].join('\n'),
  r2: [
    { key: `users/${A}/projects/dl-tpl/thumb.jpg`, bytes: TEMPLATE_THUMB, type: 'image/jpeg' },
    { key: `users/${A}/stray.bin`, bytes: new Uint8Array([1, 2, 3]), type: 'application/octet-stream' },
  ],
};

export async function run({ checks, on, compileShared, repo }) {
  const clock = { now: T + MINUTE };
  let ips = 0;
  const as = (name) => {
    const b = new Browser(on, { ip: `192.0.2.${150 + (ips++ % 40)}`, clock });
    b.jar.set('__Host-bz_session', seededToken(name));
    return b;
  };
  const objects = async (prefix) => ((await on.call('GET', `/api/dev/r2?prefix=${encodeURIComponent(prefix)}`)).json?.objects ?? []).map((o) => o.key);
  const rows = async (user) => (await on.call('GET', `/api/dev/rows?user=${user}`)).json ?? {};
  const del = (b, body) => b.call('POST', '/api/me/delete', body === undefined ? {} : { json: body });

  // --- Alice's account, as she has it -----------------------------------------------------------
  let t = checks('functions: deletion, set up');
  const alice = as('dl-a-main');
  const made = [];
  const call = async (method, path, opts) => {
    const r = await alice.call(method, path, opts);
    made.push(r.status);
    return r;
  };
  const sc = (await call('POST', '/api/me/projects', { json: { title: 'Head', mode: 'scene' } })).json?.id;
  const reel = (await call('POST', '/api/me/projects', { json: { title: 'Reel', mode: 'timelapse' } })).json?.id;
  const file = bozz({ vertices: 30, seed: 82 });
  let up = (await call('POST', `/api/me/projects/${sc}/scene`, { json: { size: file.length } })).json;
  const p1 = await call('PUT', `/api/me/projects/${sc}/scene?upload=${up.uploadId}&part=1`, { bytes: file });
  await call('POST', `/api/me/projects/${sc}/scene?upload=${up.uploadId}`, { json: { parts: [p1.json], objects: 1, tris: 1 } });
  await call('POST', `/api/me/projects/${reel}/frames?index=0`, { bytes: glb({ seed: 83 }) });
  await call('POST', `/api/me/projects/${reel}/frames?index=1`, { bytes: glb({ seed: 84 }) });
  await call('POST', `/api/me/projects/${reel}/thumb`, { bytes: jpeg(85) });
  up = (await call('POST', `/api/me/projects/${sc}/scene`, { json: { size: file.length } })).json;
  await call('PUT', `/api/me/projects/${sc}/scene?upload=${up.uploadId}&part=1`, { bytes: file });
  const keys = await objects(`users/${A}/`);
  const before = await rows(A);
  t.ok(made.every((s) => s === 200 || s === 201), `two projects with files, and an upload under way (${made.join(' ')})`);
  // The scene, the reel's two frames and thumbnail, the template's file and a stray.
  t.ok(keys.length === 6 && before.projects === 2 && before.credentials === 1 && before.sessions === 3 && before.invites === 1 && before.pendingAuth === 1 && before.pendingUploads === 1 && before.uploadParts === 1, `in R2 and D1 (${keys.length} objects, ${JSON.stringify(before)})`);
  t.report();

  // --- the first call ---------------------------------------------------------------------------
  t = checks('functions: deletion, the first call');
  let r = await del(as('dl-a-stale'), { handle: 'dlalice' });
  t.ok(r.status === 401 && r.json?.code === 'reauth', `without recent authentication: 401 reauth (${r.status} ${r.json?.code})`);
  r = await del(alice, { handle: 'dlbob' });
  t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.reason === 'handle', `with another handle: 400, reason handle (${r.status} ${JSON.stringify(r.json)})`);
  r = await del(alice, {});
  t.ok(r.status === 400 && r.json?.reason === 'handle', `with none: the same (${r.status})`);
  t.eq((await storedUser(on, { id: A }))?.status, 'active', 'and the account is as it was');
  r = await del(alice, { handle: 'DLAlice' });
  t.ok(r.status === 200 && r.json?.done === true && r.json?.remaining === 0, `with its handle, in any capitals: a small account goes in one call (${r.status} ${JSON.stringify(r.json)})`);
  const cleared = setCookies(r).find((c) => c.name === '__Host-bz_session');
  t.ok(cleared?.attrs['max-age'] === '0' && r.headers.get('cache-control') === 'no-store', 'done, the session cookie is cleared');
  const mail = (await outbox(on, 'dlalice@example.com')).at(-1);
  t.ok(mail?.subject === 'Your Bozzetto account is being deleted' && /@dlalice is being deleted/.test(mail?.body ?? ''), `the holder is told, at the first call (${mail?.subject})`);
  t.report();

  // --- what is left of Alice -----------------------------------------------------------------------
  t = checks('functions: deletion, the cascade');
  t.eq(await storedUser(on, { id: A }), null, 'the account is gone');
  const after = await rows(A);
  t.ok(after.users === 0 && after.projects === 0 && after.credentials === 0 && after.sessions === 0 && after.pendingAuth === 0 && after.invites === 0 && after.pendingUploads === 0 && after.uploadParts === 0, `and every row naming it: projects, passkeys, sessions, flows, invites, uploads (${JSON.stringify(after)})`);
  const left = await objects(`users/${A}/`);
  t.eq(left.join(','), `users/${A}/projects/dl-tpl/thumb.jpg`, "its folder is empty but for what a template still reads, the stray file swept");
  r = await on.call('GET', '/m/dl-tpl/thumb.jpg');
  t.ok(r.status === 200 && same(r.bytes, TEMPLATE_THUMB), `and the template still serves it (${r.status})`);
  r = await on.call('GET', '/api/auth/handle?h=dlalice');
  t.ok(r.json?.available === false && r.json?.reason === 'retired', `its handle is held from anyone else (${JSON.stringify(r.json)})`);
  const audit = await auditRows(on, A);
  const actions = audit.map((row) => row.action);
  t.ok(actions.includes('account.delete') && actions.includes('account.deleted'), `the audit rows stay, the start and the end among them (${actions.join(', ')})`);
  const text = JSON.stringify(audit);
  t.ok(audit.every((row) => row.subject === A) && !text.includes('"dlalice"') && !text.includes('@'), `naming the account by its bare id: no handle, no address (${text})`);
  r = await as('dl-a-other').call('GET', '/api/me');
  t.ok(r.status === 401, `its other session is gone with it (${r.status})`);
  r = await del(as('dl-a-main'), { handle: 'dlalice' });
  t.ok(r.status === 401 && r.json?.code === 'signin', `and its own: asking again is 401 signin (${r.status} ${r.json?.code})`);
  t.report();

  // --- across calls ---------------------------------------------------------------------------------
  t = checks('functions: deletion, across calls');
  const bob = as('dl-b-main');
  const thumbs = [];
  for (let i = 1; i <= MANY; i++) thumbs.push((await bob.call('POST', `/api/me/projects/p-dlbob${i}/thumb`, { bytes: jpeg(90 + i) })).status);
  t.ok(thumbs.every((s) => s === 201), `Bob's ${MANY} projects each have a file (${[...new Set(thumbs)].join(', ')})`);
  const answers = [];
  r = await del(bob, { handle: 'dlbob' });
  answers.push(r.json);
  t.ok(r.status === 200 && r.json?.done === false && r.json?.remaining > 0 && r.json?.remaining < MANY, `the first call goes as far as its subrequests allow (${JSON.stringify(r.json)})`);
  t.eq((await storedUser(on, { id: B }))?.status, 'deleting', 'the account is being deleted');
  r = await bob.call('GET', '/api/me');
  t.ok(r.status === 401 && r.json?.code === 'signin', `meanwhile its session reaches nothing else: GET /api/me is 401 (${r.status})`);
  r = await bob.call('GET', '/api/me/projects');
  t.eq(r.status, 401, 'nor its projects');
  r = await bob.call('POST', '/api/me/projects', { json: { title: 'One more' } });
  t.eq(r.status, 401, 'nor can it make one');
  for (let i = 0; i < 5 && !answers.at(-1)?.done; i++) {
    r = await del(bob);
    answers.push(r.json);
  }
  const remaining = answers.map((x) => x?.remaining);
  t.ok(answers.at(-1)?.done === true && answers.length >= 2 && remaining.every((n, i) => i === 0 || n <= remaining[i - 1]), `later calls, no body and no recent authentication, carry it to done (${JSON.stringify(answers)})`);
  t.ok((await objects(`users/${B}/`)).length === 0 && (await rows(B)).projects === 0 && (await storedUser(on, { id: B })) === null, 'every file, project and the account gone');
  t.report();

  // --- an account already being deleted ----------------------------------------------------------------
  t = checks('functions: deletion, the status gate');
  const carol = as('dl-c-main');
  r = await carol.call('GET', '/api/me');
  t.ok(r.status === 401, `an account being deleted is nobody on GET /api/me (${r.status})`);
  r = await carol.call('GET', '/api/me/export');
  t.eq(r.status, 401, 'nor on its export');
  r = await del(carol);
  t.ok(r.status === 200 && r.json?.done === true, `but POST /api/me/delete carries its deletion on, without recent authentication (${r.status} ${JSON.stringify(r.json)})`);
  t.eq(await storedUser(on, { id: C }), null, 'to the end');
  t.report();

  // --- directly: what one call spends ---------------------------------------------------------------
  t = checks('functions: deletion, directly');
  const db = await migratedDatabase(repo);
  if (!db) {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the direct checks did not run');
  } else {
    const load = await compileShared();
    const deletion = await load('deletion');
    const user = 'u-dldirect000000000000000000';
    db.exec(seedUser({ id: user, handle: 'dldirect' }));
    db.exec(seedSession({ name: 'dl-direct', id: 's-dldirect', user, created: T }));
    const store = new Map();
    const projectCount = 45;
    for (let i = 0; i < projectCount; i++) {
      db.exec(`INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at)
        VALUES ('p-dd${i}', 'P', 'model', 4, '${DATA}', 'private', 0, '${user}', 'users/${user}/projects/p-dd${i}/', ${i}, 0)`);
      for (const f of ['thumb.jpg', 'frames/sd/0000.glb', 'frames/sd/0001.glb']) store.set(`users/${user}/projects/p-dd${i}/${f}`, 10);
    }
    db.exec(`INSERT INTO pending_uploads (id, r2_upload_id, project_id, user_id, file, declared_bytes, created_at)
      VALUES ('dd-up', 'r2-dd-up', 'p-dd0', '${user}', 'scene.bozz', 100, 0)`);
    db.exec(`INSERT INTO upload_parts (upload_id, part, user_id, bytes) VALUES ('dd-up', 1, '${user}', 100)`);
    db.exec(`INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at)
      VALUES ('dd-tpl', 'T', 'model', 4, '${DATA}', 'public', 1, NULL, 'users/${user}/projects/dd-tpl/', 0, 0)`);
    store.set(`users/${user}/projects/dd-tpl/thumb.jpg`, 10);
    let calls = 0;
    const aborted = [];
    const BUCKET = {
      // Two keys a page, so listings page; a cursor goes on after the
      // last key it gave, as R2's does, whatever was deleted since.
      list: async ({ prefix, cursor }) => {
        calls++;
        const all = [...store.keys()].filter((k) => k.startsWith(prefix) && (!cursor || k > cursor)).sort();
        const page = all.slice(0, 2);
        const truncated = all.length > 2;
        return { objects: page.map((key) => ({ key, size: store.get(key) })), truncated, cursor: truncated ? page.at(-1) : undefined };
      },
      delete: async (keys) => {
        calls++;
        [].concat(keys).forEach((k) => store.delete(k));
      },
      resumeMultipartUpload: (key, id) => ({
        abort: async () => {
          calls++;
          aborted.push(`${key} ${id}`);
        },
      }),
    };
    const counted = d1(db);
    const DB = { prepare: (q) => counted.prepare(q), batch: (s) => (calls++, counted.batch(s)) };
    const wrap = (stmt) => ({ ...stmt, bind: (...v) => wrap(stmt.bind(...v)), first: (...a) => (calls++, stmt.first(...a)), all: () => (calls++, stmt.all()), run: () => (calls++, stmt.run()) });
    DB.prepare = (q) => wrap(counted.prepare(q));
    const env = { DB, BUCKET };
    const spent = [];
    const progress = [];
    for (let i = 0; i < 20; i++) {
      calls = 0;
      const p = await deletion.continueDeletion(env, { id: user, handle: 'dldirect' }, T, user, new deletion.Budget(deletion.DELETION_BUDGET));
      spent.push(calls);
      progress.push(p);
      if (p.done) break;
    }
    t.ok(progress.at(-1)?.done === true && progress.length > 2, `${projectCount} projects of three files each, listed two at a time, take ${progress.length} calls (${progress.map((p) => p.remaining).join(' ')})`);
    t.ok(spent.every((n) => n <= 40), `none spends more than 40 subrequests, D1's and R2's together (${spent.join(' ')})`);
    t.ok(aborted.length === 1 && aborted[0] === `users/${user}/projects/p-dd0/scene.bozz r2-dd-up`, `its upload is given up in R2 first (${aborted.join(', ')})`);
    const rest = [...store.keys()];
    t.eq(rest.join(','), `users/${user}/projects/dd-tpl/thumb.jpg`, "every file goes but the template's");
    const count = (sql) => db.prepare(sql).get().n;
    t.ok(count(`SELECT COUNT(*) AS n FROM users WHERE id = '${user}'`) === 0 && count(`SELECT COUNT(*) AS n FROM projects WHERE owner_id = '${user}'`) === 0 && count("SELECT COUNT(*) AS n FROM projects WHERE id = 'dd-tpl'") === 1 && count(`SELECT COUNT(*) AS n FROM upload_parts WHERE user_id = '${user}'`) === 0, 'and every row, but the template');
    const held = db.prepare("SELECT until FROM retired_handles WHERE handle = 'dldirect'").get();
    t.eq(held?.until, T + 90 * DAY, 'its handle held for 90 days');
    db.close();
  }
  t.report();
}
