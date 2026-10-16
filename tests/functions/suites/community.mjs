// The community gallery (docs/accounts.md §13): members share their own
// models and timelapses, a reviewer approves them, and anyone may then see
// them, view only, from the member's own folder.
//
// On a fresh SQLite: migrations/0004_community.sql a statement at a time
// after 0003 and rows, and what it then holds, refuses and cascades. Over
// HTTP: the open routes' predicate (files host and app host), the public
// list and its cursor, author pages, the public manifest; sharing (modes,
// templates, someone else's, the daily limit, withdrawal); every member
// write sending a listed project back for review; reports (one per member,
// never one's own, two hide it, the daily limit); the reviewers' routes
// (who may, the queue, reports, history, the manifest and files, every
// action and the states that refuse it, never one's own); the owner's role
// route; the template switch; the cascade of a project's and an account's
// deletion; and audit rows with nothing personal in them. Accounts off:
// none of it is there, and nothing shared is served.
//
// The owner reviews too, but the servers' database has no owner account
// until the locks suite bootstraps one (it runs after this), so the
// owner's side of requireModerator and of a review is checked directly:
// functions/_shared on a fresh SQLite. The role route runs on Access alone,
// as it does before the bootstrap.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Browser,
  DATA,
  FILES_HOST,
  asOwner,
  auditRows,
  d1,
  glb,
  ids,
  jpeg,
  migratedDatabase,
  same,
  seedSession,
  seedUser,
  seededToken,
  storedUser,
} from '../lib.mjs';

export const needs = ['on', 'off'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The suite's own day, for every daily limit. */
const T = 3_150_000_000_000;

const ALICE = 'u-cmalice00000000000000000';
const BOB = 'u-cmbob0000000000000000000';
const CAROL = 'u-cmcarol00000000000000000';
const MOD = 'u-cmmod0000000000000000000';
const DAVE = 'u-cmdave000000000000000000';
const LISTER = 'u-cmlister0000000000000000';
const SUS = 'u-cmsus0000000000000000000';
const RATE = 'u-cmrate000000000000000000';
const REP = 'u-cmrep0000000000000000000';
const GONE = 'u-cmgone000000000000000000';

const COLUMNS = 'id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at, shared, shared_at, review_reason';
const prefix = (owner, id) => `users/${owner}/projects/${id}/`;
const row = (id, owner, shared, sharedAt, { mode = 'model', reason = null, template = 0, visibility = 'private' } = {}) =>
  `('${id}', 'Title ${id}', '${mode}', 4, '${DATA}', '${visibility}', ${template}, ${owner ? `'${owner}'` : 'NULL'}, ${owner ? `'${prefix(owner, id)}'` : 'NULL'}, ${T - 2 * DAY}, ${T - DAY}, '${shared}', ${sharedAt ?? 'NULL'}, ${reason ? `'${reason}'` : 'NULL'})`;

/** The lister's eleven approved projects: cm-l05 and cm-l06 approved at the same moment, so the id breaks the tie. */
const LISTED = Array.from({ length: 11 }, (_, i) => `cm-l${String(i + 1).padStart(2, '0')}`);
const listedAt = (id) => {
  const i = Number(id.slice(4));
  return T - (12 - (i === 6 ? 5 : i)) * HOUR;
};
/** Newest first, as the list orders them: shared_at, then id, both descending. */
const LISTED_ORDER = [...LISTED].sort((a, b) => listedAt(b) - listedAt(a) || (a < b ? 1 : -1));
/** The whole community list at the start: the lister's, then the oldest, by the account the suite deletes. */
const START = [...LISTED_ORDER, 'cm-gone'];

const THUMBS = Object.fromEntries(['cm-l01', 'cm-pend', 'cm-hid', 'cm-rej', 'cm-sus', 'cm-tpl', 'cm-gone'].map((id, i) => [id, jpeg(90 + i)]));

export const seed = {
  sql: [
    seedUser({ id: ALICE, handle: 'cmalice' }),
    seedUser({ id: BOB, handle: 'cmbob' }),
    seedUser({ id: CAROL, handle: 'cmcarol' }),
    seedUser({ id: MOD, handle: 'cmmod', role: 'moderator' }),
    seedUser({ id: DAVE, handle: 'cmdave' }),
    seedUser({ id: LISTER, handle: 'cmlister' }),
    seedUser({ id: SUS, handle: 'cmsus', status: 'suspended' }),
    seedUser({ id: RATE, handle: 'cmrate' }),
    seedUser({ id: REP, handle: 'cmrep' }),
    seedUser({ id: GONE, handle: 'cmgone' }),
    seedSession({ name: 'cm-alice', id: 's-cmalice', user: ALICE, created: T }),
    seedSession({ name: 'cm-bob', id: 's-cmbob', user: BOB, created: T }),
    seedSession({ name: 'cm-carol', id: 's-cmcarol', user: CAROL, created: T }),
    seedSession({ name: 'cm-mod', id: 's-cmmod', user: MOD, created: T }),
    seedSession({ name: 'cm-dave', id: 's-cmdave', user: DAVE, created: T }),
    seedSession({ name: 'cm-lister', id: 's-cmlister', user: LISTER, created: T }),
    seedSession({ name: 'cm-rate', id: 's-cmrate', user: RATE, created: T }),
    seedSession({ name: 'cm-rep', id: 's-cmrep', user: REP, created: T }),
    // Recently authenticated for as long as the suite runs: its deletion needs it.
    seedSession({ name: 'cm-gone', id: 's-cmgone', user: GONE, created: T, reauth: T + DAY }),
    `INSERT INTO projects (${COLUMNS}) VALUES
      ${LISTED.map((id) => row(id, LISTER, 'public', listedAt(id), { mode: id === 'cm-l02' ? 'timelapse' : 'model' })).join(',\n      ')},
      ${row('cm-pend', LISTER, 'pending', T - 3 * HOUR)},
      ${row('cm-hid', LISTER, 'hidden', T - 30 * HOUR, { reason: 'Hidden for a reason' })},
      ${row('cm-rej', LISTER, 'rejected', T - 40 * HOUR, { reason: 'Blurry' })},
      ${row('cm-none', LISTER, 'none', null)},
      ${row('cm-scene', LISTER, 'none', null, { mode: 'scene' })},
      ${row('cm-sus', SUS, 'public', T - 2 * HOUR)},
      ${row('cm-gone', GONE, 'public', T - 50 * HOUR)},
      ${row('cm-owned', null, 'pending', T - 4 * HOUR)},
      ${row('cm-tpl', null, 'none', null, { template: 1, visibility: 'public' })};`,
  ].join('\n'),
  r2: Object.entries(THUMBS).map(([id, bytes]) => ({
    key: id === 'cm-tpl' ? 'projects/cm-tpl/thumb.jpg' : `${prefix(id === 'cm-sus' ? SUS : id === 'cm-gone' ? GONE : LISTER, id)}thumb.jpg`,
    bytes,
    type: 'image/jpeg',
  })),
};

/** The fields of a community card, in order. */
const CARD_KEYS = 'id,title,mode,fps,shared_at,author,thumb,media';

export async function run({ checks, on, off, repo, compileShared }) {
  await migrationChecks(checks, repo);
  await offChecks(checks, off);
  await onChecks(checks, on);
  await directChecks(checks, repo, compileShared);
}

// --- 0004 on a fresh SQLite ----------------------------------------------------------------

async function migrationChecks(checks, repo) {
  const t = checks('functions: community, 0004 on a fresh SQLite');
  let sqlite = null;
  try {
    sqlite = await import('node:sqlite');
  } catch {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the SQL-level checks did not run');
  }
  if (!sqlite) return t.report();
  const file = (name) => readFileSync(join(repo, 'migrations', name), 'utf8');
  const sql = file('0004_community.sql');
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of ['0001_init.sql', '0002_visibility.sql', '0003_accounts.sql']) db.exec(file(name));
  db.exec(seedUser({ id: 'u-a', handle: 'mig-a' }) + seedUser({ id: 'u-b', handle: 'mig-b' }));
  db.exec(`INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, created_at, updated_at) VALUES
    ('m-tpl', 'T', 'model', 4, '${DATA}', 'public', 1, NULL, 1, 1), ('m-own', 'O', 'model', 4, '${DATA}', 'private', 0, 'u-a', 1, 1);`);
  const parts = sql.split(';').map((s) => s.replace(/--[^\n]*/g, '').trim()).filter(Boolean);
  const kinds = parts.map((s) => s.split(/\s+/).slice(0, 2).join(' ').toUpperCase());
  t.ok(kinds.every((k) => /^(ALTER TABLE|CREATE TABLE|CREATE INDEX)$/.test(k)), `nothing but additions: ${[...new Set(kinds)].join(', ')}`);
  const comments = sql.split('\n').filter((l) => l.includes('--')).map((l) => l.slice(l.indexOf('--')));
  t.ok(comments.length > 0 && comments.every((c) => !c.includes(';')), 'no comment holds a semicolon, so splitting at each one splits where SQLite does');
  const failed = [];
  for (const stmt of parts) {
    try {
      db.exec(stmt);
    } catch (err) {
      failed.push(`${stmt.slice(0, 40)}: ${err.message}`);
    }
  }
  t.ok(failed.length === 0, `each of its ${parts.length} statements runs alone after 0003 and rows (${failed.join('; ') || 'all ran'})`);
  const one = (q, ...a) => db.prepare(q).get(...a);
  t.eq(one("SELECT COUNT(*) AS n FROM projects WHERE shared = 'none' AND shared_at IS NULL AND reviewed_at IS NULL AND reviewed_by IS NULL AND review_reason IS NULL").n, 2, 'every row starts unshared, nothing reviewed');
  const refuses = (q) => {
    try {
      db.exec(q);
      return false;
    } catch {
      return true;
    }
  };
  t.ok(refuses("UPDATE projects SET shared = 'listed' WHERE id = 'm-own'"), 'shared takes only none, pending, public, rejected or hidden');
  t.ok(!refuses("UPDATE projects SET shared = 'public' WHERE id = 'm-own'"), 'and takes those');
  const report = (id, project, reporter, reason = 'spam') =>
    `INSERT INTO reports (id, project_id, reporter_id, reason, created_at) VALUES ('${id}', '${project}', '${reporter}', '${reason}', 5)`;
  t.ok(refuses(report('r0', 'm-own', 'u-b', 'ugly')), 'a report takes only the listed reasons');
  t.ok(!refuses(report('r1', 'm-own', 'u-b')), 'a report of a project by a member');
  t.ok(refuses(report('r2', 'm-own', 'u-b')), 'once per member and project (UNIQUE)');
  t.ok(refuses(report('r3', 'm-nothing', 'u-b')) && refuses(report('r4', 'm-own', 'u-nobody')), 'of a project and by a member that are there (foreign keys)');
  t.ok(refuses("UPDATE reports SET outcome = 'ignored' WHERE id = 'r1'"), 'an outcome is dismissed, hidden or removed');
  t.eq(one("SELECT note FROM reports WHERE id = 'r1'").note, '', 'a note defaults to empty');
  db.exec(report('r5', 'm-own', 'u-a'));
  db.exec("DELETE FROM users WHERE id = 'u-b'");
  t.eq(one('SELECT COUNT(*) AS n FROM reports').n, 1, "an account's deletion takes the reports it made");
  db.exec("DELETE FROM projects WHERE id = 'm-own'");
  t.eq(one('SELECT COUNT(*) AS n FROM reports').n, 0, "a project's deletion takes the reports of it");
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_projects_shared', 'idx_reports_open')").all();
  t.eq(indexes.length, 2, 'with the indexes the lists read');
  const again = [];
  for (const stmt of parts.filter((s) => /^CREATE/i.test(s))) {
    try {
      db.exec(stmt);
    } catch (err) {
      again.push(err.message);
    }
  }
  t.ok(again.length === 0, `its CREATE statements run again harmlessly (IF NOT EXISTS) (${again.join('; ') || 'all'})`);
  t.report();
}

// --- accounts off --------------------------------------------------------------------------

async function offChecks(checks, off) {
  const t = checks('functions: community, accounts off');
  for (const [method, path] of [
    ['GET', '/api/community'],
    ['GET', '/api/community/u/cmlister'],
    ['POST', '/api/community/cm-l01/report'],
    ['POST', '/api/me/projects/cm-none/share'],
    ['GET', '/api/mod/counts'],
    ['GET', '/api/mod/media/cm-pend/thumb.jpg'],
  ]) {
    const r = await off.call(method, path, method === 'POST' ? { json: {} } : {});
    t.ok(r.status === 404 && r.json?.code === 'accounts_off', `${method} ${path}: 404 accounts_off (${r.status} ${r.json?.code})`);
  }
  let r = await off.callHost(FILES_HOST, 'GET', '/m/cm-l01/thumb.jpg');
  t.eq(r.status, 404, 'an approved project is not served on the files host');
  r = await off.call('GET', '/api/projects/cm-l01');
  t.eq(r.status, 404, 'nor its manifest');
  r = await off.callHost(FILES_HOST, 'GET', '/m/cm-tpl/thumb.jpg');
  t.ok(r.status === 200 && same(r.bytes, THUMBS['cm-tpl']), `while a template is, as ever (${r.status})`);
  r = await off.call('GET', '/api/projects');
  t.ok(ids(r.json).includes('cm-tpl') && !ids(r.json).some((id) => id.startsWith('cm-l')), 'and the template list is templates');
  t.report();
}

// --- accounts on, over HTTP ------------------------------------------------------------------

async function onChecks(checks, on) {
  const clock = { now: T + MINUTE };
  const tick = (ms = 1000) => (clock.now += ms);
  let ips = 0;
  const as = (name) => {
    const b = new Browser(on, { ip: `198.51.100.${120 + (ips++ % 100)}`, clock });
    if (name) b.jar.set('__Host-bz_session', seededToken(name));
    return b;
  };
  const alice = as('cm-alice');
  const bob = as('cm-bob');
  const carol = as('cm-carol');
  const mod = as('cm-mod');
  const dave = as('cm-dave');
  const lister = as('cm-lister');
  const guest = as(null);
  const files = (path) => on.callHost(FILES_HOST, 'GET', path);
  const audited = async (subject, action) => (await auditRows(on, subject)).filter((x) => !action || x.action === action);
  const mine = async (b, id) => ((await b.call('GET', '/api/me/projects')).json ?? []).find((p) => p.id === id);
  /** Every id the community list holds now, following its cursor. */
  const listed = async (path = '/api/community', limit = 5) => {
    const out = [];
    let next = null;
    for (let i = 0; i < 20; i++) {
      const r = await guest.call('GET', `${path}?limit=${limit}${next ? `&after=${encodeURIComponent(next)}` : ''}`);
      out.push(...(r.json?.items ?? []).map((x) => x.id));
      next = r.json?.next ?? null;
      if (!next) break;
    }
    return out;
  };
  const review = (b, id, json) => {
    tick();
    return b.call('POST', `/api/mod/projects/${id}/review`, { json });
  };
  const share = (b, id, shared) => {
    tick();
    return b.call('POST', `/api/me/projects/${id}/share`, { json: { shared } });
  };
  const report = (b, id, json) => {
    tick();
    return b.call('POST', `/api/community/${id}/report`, { json });
  };

  // --- the public list ---------------------------------------------------------------------
  let t = checks('functions: community, the public list');
  let r = await guest.call('GET', '/api/community');
  t.ok(r.status === 200 && r.headers.get('cache-control') === 'public, max-age=60', `anyone may read it, kept a minute (${r.status} ${r.headers.get('cache-control')})`);
  t.eq(ids(r.json?.items).join(','), START.join(','), 'the approved projects of active accounts, newest approval first, ties by id: no pending, hidden, rejected, unshared, template or suspended author');
  t.eq(r.json?.next, null, 'all on one page of 24');
  const first = r.json?.items?.find((x) => x.id === 'cm-l01');
  t.eq(Object.keys(first ?? {}).join(','), CARD_KEYS, `a card: {${CARD_KEYS}}`);
  t.ok(first?.author?.handle === 'cmlister' && first?.title === 'Title cm-l01' && first?.mode === 'model' && first?.shared_at === listedAt('cm-l01'), `with the author's handle, title, mode and approval time (${JSON.stringify(first)})`);
  t.ok(first?.media === `http://${FILES_HOST}/m/cm-l01` && first?.thumb === `http://${FILES_HOST}/m/cm-l01/thumb.jpg?v=${T - DAY}`, `its files on the files host, as a template's; the thumbnail at its version (${first?.media} ${first?.thumb})`);
  t.eq((await listed('/api/community', 2)).join(','), START.join(','), 'two to a page, the cursor walks the same order without a gap or a repeat');
  r = await guest.call('GET', '/api/community?limit=2');
  const nextOf = (() => {
    try {
      return JSON.parse(Buffer.from(r.json?.next ?? '', 'base64url').toString('utf8'));
    } catch {
      return null;
    }
  })();
  t.ok(r.json?.items?.length === 2 && JSON.stringify(nextOf) === JSON.stringify({ s: 'new', t: listedAt(LISTED_ORDER[1]), i: LISTED_ORDER[1] }), `next is the sort, shared_at and id of the page's last, as base64url JSON (${JSON.stringify(nextOf)})`);
  r = await guest.call('GET', '/api/community?after=nonsense');
  t.ok(r.status === 400 && r.json?.reason === 'after' && r.headers.get('cache-control') === 'no-store', `a cursor it never gave: 400 reason after, not kept (${r.status} ${r.json?.reason})`);
  r = await guest.call('GET', '/api/community?limit=49');
  t.ok(r.status === 400 && r.json?.reason === 'limit', `a limit past 48: 400 reason limit (${r.status})`);
  r = await guest.call('GET', '/api/community/nothing/here');
  t.ok(r.status === 404 && r.json?.code === 'not_found', `a path it does not have: 404 not_found (${r.status})`);
  r = await guest.call('POST', '/api/community', { json: {} });
  t.eq(r.status, 404, 'nor a method');
  r = await guest.call('GET', '/api/projects');
  t.ok(ids(r.json).includes('cm-tpl') && !ids(r.json).some((id) => id.startsWith('cm-l')), 'the landing\'s list stays templates alone');
  t.report();

  t = checks('functions: community, author pages');
  r = await guest.call('GET', '/api/community/u/CMLister');
  t.ok(r.status === 200 && r.json?.handle === 'cmlister' && r.headers.get('cache-control') === 'public, max-age=60', `by handle in any capitals, the handle as the account spells it (${r.status} ${r.json?.handle})`);
  t.eq(ids(r.json?.items).join(','), LISTED_ORDER.join(','), 'the member\'s approved work alone');
  t.eq((await listed('/api/community/u/cmlister', 3)).join(','), LISTED_ORDER.join(','), 'paged as the gallery is');
  r = await guest.call('GET', '/api/community/u/cmalice');
  t.ok(r.status === 200 && r.json?.items?.length === 0 && r.json?.next === null, `a member with nothing shared: an empty page (${r.status})`);
  r = await guest.call('GET', '/api/community/u/cmsus');
  t.ok(r.status === 404 && r.json?.code === 'not_found', `a suspended account: 404, its work with it (${r.status})`);
  r = await guest.call('GET', '/api/community/u/nobody-here');
  t.eq(r.status, 404, 'no such account: 404');
  t.report();

  t = checks('functions: community, what the open routes serve');
  r = await files('/m/cm-l01/thumb.jpg');
  t.ok(r.status === 200 && same(r.bytes, THUMBS['cm-l01']) && r.headers.get('access-control-allow-origin') === on.base.replace('127.0.0.1', 'localhost'), `an approved project's thumbnail on the files host, from the member's folder (${r.status} ${r.headers.get('access-control-allow-origin')})`);
  r = await files(`/m/cm-l01/thumb.jpg?v=${T - DAY}`);
  t.eq(r.headers.get('cache-control'), 'public, max-age=31536000, immutable', 'kept for good at its version, as a template\'s');
  r = await on.call('GET', '/media/cm-l01/thumb.jpg');
  t.ok(r.status === 200 && same(r.bytes, THUMBS['cm-l01']), `and on the app's own /media/ (${r.status})`);
  for (const id of ['cm-pend', 'cm-hid', 'cm-rej', 'cm-sus']) {
    const res = await files(`/m/${id}/thumb.jpg`);
    const app = await on.call('GET', `/m/${id}/thumb.jpg`);
    t.ok(res.status === 404 && app.status === 404, `${id}: 404 on both hosts, as a project that is not there (${res.status} ${app.status})`);
  }
  r = await guest.call('GET', '/api/projects/cm-l01');
  t.ok(r.status === 200 && r.json?.community === true && r.json?.author?.handle === 'cmlister' && r.json?.template === false && r.json?.media === `http://${FILES_HOST}/m/cm-l01`, `its manifest: community, by its author, files on the files host (${r.status} ${JSON.stringify(r.json?.author)} ${r.json?.media})`);
  r = await guest.call('GET', '/api/projects/cm-tpl');
  t.ok(r.status === 200 && r.json?.community === undefined && r.json?.author === undefined, `a template's says neither (${r.status})`);
  for (const id of ['cm-pend', 'cm-hid', 'cm-rej', 'cm-none', 'cm-sus']) {
    r = await guest.call('GET', `/api/projects/${id}`);
    t.eq(r.status, 404, `${id}: no public manifest`);
  }
  t.report();

  // --- sharing ---------------------------------------------------------------------------------
  t = checks('functions: community, sharing');
  const made = async (b, title, mode) => (await b.call('POST', '/api/me/projects', { json: { title, mode } })).json?.id;
  const p1 = await made(alice, 'Alice one', 'model');
  const thumb1 = jpeg(110);
  await alice.call('POST', `/api/me/projects/${p1}/thumb`, { bytes: thumb1 });
  await alice.call('POST', `/api/me/projects/${p1}/frames?index=0`, { bytes: glb({ seed: 111 }) });
  await alice.call('PUT', `/api/me/projects/${p1}`, { json: { frames: [{ index: 0, tris: 12 }] } });
  let p = await mine(alice, p1);
  t.ok(p?.shared === 'none' && p?.shared_at === null && p?.review_reason === null, `a new project is not shared: My projects says so (${JSON.stringify([p?.shared, p?.shared_at, p?.review_reason])})`);
  r = await share(alice, p1, true);
  const sharedAt = clock.now;
  t.ok(r.status === 200 && r.json?.shared === 'pending' && r.json?.shared_at === sharedAt && r.json?.id === p1 && r.headers.get('cache-control') === 'no-store', `shared: 200, pending review, submitted now (${r.status} ${JSON.stringify(r.json)})`);
  t.eq(Object.keys(r.json ?? {}).join(','), 'id,shared,shared_at,review_reason', 'the answer: {id, shared, shared_at, review_reason}');
  p = await mine(alice, p1);
  t.ok(p?.shared === 'pending' && p?.shared_at === sharedAt && p?.visibility === 'private', `My projects shows it pending, still private (${p?.shared} ${p?.visibility})`);
  r = await alice.call('GET', `/api/me/projects/${p1}`);
  t.eq(r.json?.shared, 'pending', 'and so does its manifest on /api/me');
  r = await share(alice, p1, true);
  t.ok(r.status === 200 && r.json?.shared === 'pending' && r.json?.shared_at === sharedAt, `sharing it again changes nothing (${r.status} ${r.json?.shared_at})`);
  t.eq((await audited(p1, 'project.share')).length, 1, 'and records nothing more');
  r = await guest.call('GET', '/api/community');
  t.ok(!ids(r.json?.items).includes(p1), 'pending is not listed');
  r = await files(`/m/${p1}/thumb.jpg`);
  t.eq(r.status, 404, 'nor are its files served');
  const sc = await made(alice, 'A scene', 'scene');
  r = await share(alice, sc, true);
  t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.reason === 'mode', `a scene: 400 reason mode (${r.status} ${r.json?.reason})`);
  const arm = await made(alice, 'A figure', 'armature');
  r = await share(alice, arm, true);
  t.ok(r.status === 400 && r.json?.reason === 'mode', `an armature: the same (${r.status})`);
  const reel = await made(alice, 'A reel', 'timelapse');
  r = await share(alice, reel, true);
  t.ok(r.status === 200 && r.json?.shared === 'pending', `a timelapse may (${r.status})`);
  r = await share(bob, p1, true);
  t.ok(r.status === 404 && r.json?.code === 'not_found', `another member's project: 404, as everywhere on /api/me (${r.status})`);
  r = await share(alice, 'cm-tpl', true);
  t.eq(r.status, 404, 'a template is no one\'s to share: 404');
  r = await alice.call('POST', `/api/me/projects/${p1}/share`, { json: { shared: 'yes' } });
  t.ok(r.status === 400 && r.json?.reason === 'shared', `shared must be true or false (${r.status} ${r.json?.reason})`);
  r = await guest.call('POST', `/api/me/projects/${p1}/share`, { json: { shared: true } });
  t.ok(r.status === 401 && r.json?.code === 'signin', `signed out: 401 signin (${r.status})`);
  const shareRows = await audited(p1, 'project.share');
  t.ok(shareRows.length === 1 && shareRows[0].actor === ALICE && JSON.stringify(shareRows[0].detail) === '{"from":"none"}', `audited project.share by the member, without the title (${JSON.stringify(shareRows)})`);
  t.report();

  t = checks('functions: community, 20 shares a day');
  const rate = as('cm-rate');
  const rp = await made(rate, 'Shared often', 'model');
  const codes = [];
  for (let i = 0; i < 20; i++) {
    codes.push((await share(rate, rp, true)).status);
    codes.push((await share(rate, rp, false)).status);
  }
  t.ok(codes.every((c) => c === 200), `twenty shares, each withdrawn: all 200 (${[...new Set(codes)].join(' ')})`);
  r = await share(rate, rp, true);
  t.ok(r.status === 429 && r.json?.code === 'rate_limited' && Number(r.headers.get('retry-after')) > 0, `the 21st that day: 429 with Retry-After (${r.status} ${r.headers.get('retry-after')})`);
  t.eq((await mine(rate, rp))?.shared, 'none', 'and it stays unshared');
  r = await share(rate, rp, false);
  t.eq(r.status, 200, 'withdrawing is never limited (nothing to withdraw: 200, unchanged)');
  t.report();

  // --- the reviewers ------------------------------------------------------------------------------
  t = checks('functions: community, who may review');
  for (const path of ['/api/mod/counts', '/api/mod/queue', '/api/mod/shared', '/api/mod/reports', '/api/mod/history', `/api/mod/projects/${p1}`]) {
    const asMember = await bob.call('GET', path);
    const asGuest = await guest.call('GET', path);
    t.ok(asMember.status === 403 && asMember.json?.code === 'forbidden' && asGuest.status === 401 && asGuest.json?.code === 'signin', `${path}: a member 403 forbidden, signed out 401 signin (${asMember.status} ${asGuest.status})`);
  }
  r = await review(bob, p1, { action: 'approve' });
  t.ok(r.status === 403 && r.json?.code === 'forbidden', `a member's review: 403 (${r.status})`);
  r = await bob.call('GET', `/api/mod/media/${p1}/thumb.jpg`);
  const gm = await guest.call('GET', `/api/mod/media/${p1}/thumb.jpg`);
  t.ok(r.status === 404 && gm.status === 404 && r.json === null, `the reviewers' files: the same bare 404 to a member and a guest (${r.status} ${gm.status})`);
  r = await mod.call('GET', '/api/mod/counts');
  t.ok(r.status === 200 && r.json?.pending >= 3 && r.json?.reports === 0 && r.headers.get('cache-control') === 'no-store', `a moderator: the counts, never kept (${r.status} ${JSON.stringify(r.json)})`);
  const pendingBefore = r.json?.pending;
  r = await mod.call('GET', '/api/mod/nothing');
  t.ok(r.status === 404 && r.json?.code === 'not_found', `a path the reviewers do not have: 404 not_found (${r.status})`);
  r = await mod.call('POST', '/api/mod/counts', { json: {} });
  t.eq(r.status, 404, 'nor a method');
  t.report();

  t = checks('functions: community, the queue and a project under review');
  r = await mod.call('GET', '/api/mod/queue');
  const queue = ids(r.json?.items);
  t.ok(r.status === 200 && queue.includes('cm-pend') && queue.includes(p1) && queue.includes(reel) && !queue.includes('cm-hid'), `pending projects alone (${r.status} ${queue.join(',')})`);
  t.ok(queue.indexOf('cm-pend') < queue.indexOf(p1) && queue.indexOf(p1) < queue.indexOf(reel), 'oldest first');
  const item = r.json?.items?.find((x) => x.id === p1);
  t.ok(item?.author?.handle === 'cmalice' && item?.media === `/api/mod/media/${p1}` && item?.thumb?.startsWith(`/api/mod/media/${p1}/thumb.jpg?v=`) && item?.reports === 0 && item?.shared === 'pending', `each with its author, its files on the reviewers' route, open reports (${JSON.stringify(item)})`);
  r = await mod.call('GET', '/api/mod/queue?limit=1');
  const q2 = await mod.call('GET', `/api/mod/queue?limit=1&after=${encodeURIComponent(r.json?.next ?? '')}`);
  t.ok(r.json?.items?.length === 1 && q2.json?.items?.[0]?.id === queue[1], `paged with a cursor (${r.json?.next})`);
  r = await mod.call('GET', `/api/mod/projects/${p1}`);
  t.ok(r.status === 200 && r.json?.shared === 'pending' && r.json?.author?.handle === 'cmalice' && r.json?.frames?.[0]?.sd?.startsWith(`/api/mod/media/${p1}/frames/sd/0000.glb?v=`), `its manifest, files on the reviewers' route (${r.status} ${r.json?.frames?.[0]?.sd})`);
  r = await mod.call('GET', `/api/mod/media/${p1}/thumb.jpg`);
  t.ok(r.status === 200 && same(r.bytes, thumb1) && r.headers.get('cache-control') === 'private, no-store' && r.headers.get('cross-origin-resource-policy') === 'same-origin', `its files for a reviewer: private, no-store, same-origin (${r.status} ${r.headers.get('cache-control')})`);
  r = await mod.call('GET', `/api/mod/media/${p1}/frames/sd/0000.glb?download=1`);
  t.ok(r.status === 200 && !r.headers.get('content-disposition'), `never a download, whatever is asked (${r.status} ${r.headers.get('content-disposition')})`);
  for (const id of ['cm-none', 'cm-tpl', 'p-00000000000000000000000000']) {
    const m = await mod.call('GET', `/api/mod/projects/${id}`);
    const f = await mod.call('GET', `/api/mod/media/${id}/thumb.jpg`);
    t.ok(m.status === 404 && f.status === 404, `${id}: not shared, so 404 to a reviewer too (${m.status} ${f.status})`);
  }
  r = await mod.call('GET', '/api/mod/projects/cm-rej');
  t.ok(r.status === 200 && r.json?.shared === 'rejected' && r.json?.review_reason === 'Blurry', `a rejected one, with its reason (${r.status})`);
  t.report();

  t = checks('functions: community, approve');
  r = await review(mod, p1, { action: 'hide', reason: 'x' });
  t.ok(r.status === 409 && r.json?.code === 'wrong_state' && r.json?.shared === 'pending', `hiding a pending project: 409 wrong_state {shared} (${r.status} ${JSON.stringify(r.json)})`);
  r = await review(mod, p1, { action: 'unhide' });
  t.ok(r.status === 409 && r.json?.shared === 'pending', `unhiding it: 409 (${r.status})`);
  r = await review(mod, p1, { action: 'publish' });
  t.ok(r.status === 400 && r.json?.reason === 'action', `an action there is not: 400 reason action (${r.status})`);
  r = await review(mod, p1, { action: 'reject' });
  t.ok(r.status === 400 && r.json?.reason === 'reason', `rejecting without a reason: 400 reason reason (${r.status})`);
  r = await review(mod, p1, { action: 'reject', reason: 'x'.repeat(501) });
  t.ok(r.status === 400 && r.json?.reason === 'reason', `nor with one past 500 characters (${r.status})`);
  r = await review(mod, p1, { action: 'dismiss' });
  t.ok(r.status === 409 && r.json?.code === 'wrong_state' && r.json?.reports === 0, `dismissing reports there are none of: 409 (${r.status})`);
  r = await review(mod, p1, { action: 'approve' });
  const approvedAt = clock.now;
  t.ok(r.status === 200 && r.json?.shared === 'public' && r.json?.shared_at === approvedAt && r.json?.reviewed_at === approvedAt && r.json?.review_reason === null, `approve: public, listed from now (${r.status} ${JSON.stringify(r.json)})`);
  r = await review(mod, p1, { action: 'approve' });
  t.ok(r.status === 409 && r.json?.shared === 'public', `approving it again: 409 wrong_state (${r.status})`);
  r = await guest.call('GET', '/api/community');
  t.eq(ids(r.json?.items)[0], p1, 'it leads the community list');
  r = await files(`/m/${p1}/thumb.jpg`);
  t.ok(r.status === 200 && same(r.bytes, thumb1), `its files on the files host, from the member's own folder (${r.status})`);
  r = await guest.call('GET', `/api/projects/${p1}`);
  t.ok(r.status === 200 && r.json?.author?.handle === 'cmalice' && r.json?.frames?.[0]?.sd?.startsWith(`http://${FILES_HOST}/m/${p1}/frames/sd/0000.glb?v=`), `its public manifest names the files host (${r.status})`);
  r = await guest.call('GET', '/api/community/u/cmalice');
  t.eq(ids(r.json?.items).join(','), p1, "Alice's page shows it");
  t.eq((await mine(alice, p1))?.shared, 'public', 'My projects says public');
  let rows = await audited(p1, 'project.review');
  t.ok(rows.length === 1 && rows[0].actor === MOD && JSON.stringify(rows[0].detail) === '{"action":"approve","from":"pending","to":"public"}', `audited project.review by the moderator (${JSON.stringify(rows)})`);
  r = await mod.call('GET', '/api/mod/counts');
  t.eq(r.json?.pending, pendingBefore - 1, 'the queue is one shorter');
  t.report();

  t = checks('functions: community, a member\'s write sends it back for review');
  const backToPending = async (what, write) => {
    await review(mod, p1, { action: 'approve' });
    const before = await mine(alice, p1);
    tick();
    const w = await write();
    const after = await mine(alice, p1);
    const listedNow = ids((await guest.call('GET', '/api/community')).json?.items).includes(p1);
    const served = (await files(`/m/${p1}/thumb.jpg`)).status;
    t.ok(before?.shared === 'public' && (w.status === 200 || w.status === 201) && after?.shared === 'pending' && after?.shared_at === before?.shared_at && after?.updated_at > before?.updated_at && !listedNow && served === 404, `${what}: pending at once, off the list and its files, shared_at kept, updated_at moved (${w.status} ${before?.shared} -> ${after?.shared}, listed ${listedNow}, files ${served})`);
  };
  await backToPending('a new title', () => alice.call('PUT', `/api/me/projects/${p1}`, { json: { title: 'Alice one, renamed' } }));
  await backToPending('a new look', () => alice.call('PUT', `/api/me/projects/${p1}`, { json: { lighting: { preset: 'studio' } } }));
  await backToPending('a new thumbnail', () => alice.call('POST', `/api/me/projects/${p1}/thumb`, { bytes: jpeg(112) }));
  await backToPending('a frame uploaded', () => alice.call('POST', `/api/me/projects/${p1}/frames?index=1`, { bytes: glb({ seed: 113 }) }));
  await backToPending('a frame list', () => alice.call('PUT', `/api/me/projects/${p1}`, { json: { frames: [{ index: 0, tris: 12 }] } }));
  r = await review(mod, p1, { action: 'approve' });
  t.eq(r.json?.shared, 'public', 'approved again, it is back');
  tick();
  r = await alice.call('POST', `/api/me/projects/${reel}/thumb`, { bytes: jpeg(114) });
  t.eq((await mine(alice, reel))?.shared, 'pending', 'a write to a pending project leaves it pending');
  t.report();

  // --- reports ----------------------------------------------------------------------------------
  t = checks('functions: community, reports');
  r = await report(guest, p1, { reason: 'spam' });
  t.ok(r.status === 401 && r.json?.code === 'signin', `signed out: 401 signin (${r.status})`);
  r = await report(alice, p1, { reason: 'spam' });
  t.ok(r.status === 400 && r.json?.reason === 'own', `one's own: 400 reason own (${r.status} ${r.json?.reason})`);
  r = await report(bob, p1, { reason: 'ugly' });
  t.ok(r.status === 400 && r.json?.reason === 'reason', `a reason not on the list: 400 reason reason (${r.status})`);
  r = await report(bob, p1, { reason: 'spam', note: 'n'.repeat(501) });
  t.ok(r.status === 400 && r.json?.reason === 'note', `a note past 500 characters: 400 reason note (${r.status})`);
  for (const id of ['cm-pend', 'cm-hid', 'cm-rej', 'cm-none', 'cm-sus', 'cm-tpl', 'p-00000000000000000000000000']) {
    r = await report(bob, id, { reason: 'spam' });
    t.ok(r.status === 404 && r.json?.code === 'not_found', `${id}: only what anyone can see is reported, 404 (${r.status})`);
  }
  const NOTE = 'Copied from someone@example.org, see their page';
  r = await report(bob, p1, { reason: 'stolen', note: NOTE });
  t.ok(r.status === 204 && r.headers.get('cache-control') === 'no-store', `a report: 204 (${r.status})`);
  r = await report(bob, p1, { reason: 'spam' });
  t.ok(r.status === 200 && r.json?.reported === true, `again by the same member: 200 {reported: true}, nothing more (${r.status} ${JSON.stringify(r.json)})`);
  t.eq((await on.call('GET', `/api/dev/rows?user=${BOB}`)).json?.reports, 1, 'one report stored');
  t.eq((await mine(alice, p1))?.shared, 'public', 'one report leaves it listed');
  rows = await audited(p1, 'project.report');
  t.ok(rows.length === 1 && rows[0].actor === BOB && JSON.stringify(rows[0].detail) === '{"reason":"stolen"}', `audited project.report with the reason, never the note (${JSON.stringify(rows)})`);
  r = await mod.call('GET', '/api/mod/counts');
  t.eq(r.json?.reports, 1, 'the chip counts a project with open reports');
  r = await mod.call('GET', '/api/mod/reports');
  const entry = r.json?.items?.find((x) => x.project?.id === p1);
  t.ok(r.status === 200 && entry?.project?.shared === 'public' && entry?.project?.reports === 1 && entry?.reports?.length === 1 && entry.reports[0].reason === 'stolen' && entry.reports[0].note === NOTE && entry.reports[0].reporter?.handle === 'cmbob', `the Reports tab: the project, the reason, the note, the reporter's handle (${JSON.stringify(entry)})`);
  r = await review(mod, p1, { action: 'dismiss' });
  t.ok(r.status === 200 && r.json?.shared === 'public', `dismissed: still public (${r.status} ${r.json?.shared})`);
  r = await mod.call('GET', '/api/mod/counts');
  t.eq(r.json?.reports, 0, 'and no open reports');
  r = await report(bob, p1, { reason: 'spam' });
  t.eq(r.status, 200, 'a member who reported it once does not report it again, dismissed or not');
  t.report();

  t = checks('functions: community, two members\' reports hide it');
  const p2 = await made(alice, 'Alice two', 'model');
  await alice.call('POST', `/api/me/projects/${p2}/thumb`, { bytes: jpeg(115) });
  await share(alice, p2, true);
  await review(mod, p2, { action: 'approve' });
  r = await report(bob, p2, { reason: 'nudity' });
  t.eq(r.status, 204, 'the first report');
  r = await report(carol, p2, { reason: 'other', note: 'Not art' });
  const hiddenAt = clock.now;
  t.eq(r.status, 204, 'the second, by another member');
  p = await mine(alice, p2);
  t.ok(p?.shared === 'hidden' && p?.review_reason === 'Reported by members, awaiting review' && p?.updated_at === hiddenAt, `hidden at once; its author is told why (${p?.shared} ${p?.review_reason})`);
  t.ok(!ids((await guest.call('GET', '/api/community')).json?.items).includes(p2) && (await files(`/m/${p2}/thumb.jpg`)).status === 404 && (await guest.call('GET', `/api/projects/${p2}`)).status === 404, 'off the list, its files and its manifest');
  r = await report(dave, p2, { reason: 'spam' });
  t.eq(r.status, 404, 'a hidden project is not reported again');
  rows = await audited(p2, 'project.review');
  const auto = rows.find((x) => x.actor === 'system:reports');
  t.ok(auto && auto.detail?.action === 'hide' && auto.detail?.reason === 'reports', `audited as a hide the reports made (${JSON.stringify(auto)})`);
  r = await share(alice, p2, true);
  t.ok(r.status === 409 && r.json?.code === 'wrong_state' && r.json?.shared === 'hidden', `sharing a hidden project again: 409 wrong_state, under review (${r.status})`);
  r = await mod.call('GET', '/api/mod/reports');
  const both = r.json?.items?.find((x) => x.project?.id === p2);
  t.ok(both?.project?.shared === 'hidden' && both?.reports?.map((x) => x.reporter.handle).join(',') === 'cmbob,cmcarol', `both reports listed, oldest first (${JSON.stringify(both?.reports?.map((x) => x.reporter.handle))})`);
  r = await review(mod, p2, { action: 'dismiss' });
  t.ok(r.status === 409 && r.json?.shared === 'hidden', `dismiss is not for a hidden project: unhide is (${r.status})`);
  r = await review(mod, p2, { action: 'unhide' });
  t.ok(r.status === 200 && r.json?.shared === 'public' && r.json?.review_reason === null, `unhide: public again (${r.status} ${JSON.stringify(r.json)})`);
  t.ok(ids((await guest.call('GET', '/api/community')).json?.items).includes(p2), 'listed again, in its place');
  r = await mod.call('GET', '/api/mod/counts');
  t.eq(r.json?.reports, 0, 'its reports dismissed');
  t.report();

  t = checks('functions: community, 10 reports a day');
  const rep = as('cm-rep');
  const repCodes = [];
  for (const id of LISTED.slice(0, 10)) repCodes.push((await report(rep, id, { reason: 'spam' })).status);
  t.ok(repCodes.every((c) => c === 204), `ten projects reported: 204 each (${[...new Set(repCodes)].join(' ')})`);
  r = await report(rep, LISTED[10], { reason: 'spam' });
  t.ok(r.status === 429 && r.json?.code === 'rate_limited' && Number(r.headers.get('retry-after')) > 0, `the 11th that day: 429 with Retry-After (${r.status})`);
  r = await report(rep, LISTED[0], { reason: 'spam' });
  t.eq(r.status, 200, 'one already made still answers as made');
  t.eq((await on.call('GET', `/api/dev/rows?user=${REP}`)).json?.reports, 10, 'ten stored');
  for (const id of LISTED.slice(0, 10)) await review(mod, id, { action: 'dismiss' });
  t.eq((await mod.call('GET', '/api/mod/counts')).json?.reports, 0, 'each dismissed');
  t.report();

  // --- hide, reject, withdraw ---------------------------------------------------------------------
  t = checks('functions: community, hide and reject');
  r = await review(mod, p2, { action: 'hide' });
  t.ok(r.status === 400 && r.json?.reason === 'reason', `hiding without a reason: 400 (${r.status})`);
  r = await review(mod, p2, { action: 'hide', reason: '  Not   what\nit says  ' });
  t.ok(r.status === 200 && r.json?.shared === 'hidden' && r.json?.review_reason === 'Not what it says', `hide: hidden, the reason tidied (${r.status} ${JSON.stringify(r.json?.review_reason)})`);
  p = await mine(alice, p2);
  t.ok(p?.shared === 'hidden' && p?.review_reason === 'Not what it says', 'its author sees it hidden, and why');
  r = await review(mod, p2, { action: 'approve' });
  t.ok(r.status === 409 && r.json?.shared === 'hidden', `approve is not for a hidden project (${r.status})`);
  r = await review(mod, reel, { action: 'reject', reason: 'Too dark to see' });
  t.ok(r.status === 200 && r.json?.shared === 'rejected', `reject: rejected (${r.status})`);
  p = await mine(alice, reel);
  t.ok(p?.shared === 'rejected' && p?.review_reason === 'Too dark to see', `its author sees why (${p?.review_reason})`);
  r = await share(alice, reel, true);
  t.ok(r.status === 200 && r.json?.shared === 'pending' && r.json?.review_reason === null, `shared again after a change: pending, the reason gone (${r.status} ${JSON.stringify(r.json)})`);
  r = await review(mod, 'cm-pend', { action: 'reject', reason: 'Not finished' });
  t.eq(r.json?.shared, 'rejected', 'the seeded pending one rejected too');
  t.report();

  t = checks('functions: community, withdraw');
  r = await report(bob, 'cm-l11', { reason: 'other' });
  t.eq(r.status, 204, 'a report of a listed project');
  r = await share(lister, 'cm-l11', false);
  t.ok(r.status === 200 && r.json?.shared === 'none' && r.json?.shared_at === null, `withdrawn: not shared, at once (${r.status} ${JSON.stringify(r.json)})`);
  t.ok(!ids((await guest.call('GET', '/api/community')).json?.items).includes('cm-l11') && (await guest.call('GET', '/api/projects/cm-l11')).status === 404, 'off the list and its manifest');
  t.eq((await mod.call('GET', '/api/mod/counts')).json?.reports, 0, 'its open report closed (removed)');
  t.eq((await mod.call('GET', '/api/mod/projects/cm-l11')).status, 404, 'and no longer the reviewers\' to see');
  rows = await audited('cm-l11', 'project.withdraw');
  t.ok(rows.length === 1 && rows[0].actor === LISTER && JSON.stringify(rows[0].detail) === '{"from":"public"}', `audited project.withdraw (${JSON.stringify(rows)})`);
  r = await share(alice, p2, false);
  t.eq(r.json?.shared, 'none', 'a hidden one may be withdrawn too');
  r = await share(lister, 'cm-rej', false);
  t.eq(r.json?.shared, 'none', 'and a rejected one');
  r = await share(lister, 'cm-l11', false);
  t.ok(r.status === 200 && (await audited('cm-l11', 'project.withdraw')).length === 1, 'withdrawing what is not shared changes and records nothing');
  t.report();

  t = checks('functions: community, the history');
  r = await mod.call('GET', '/api/mod/history');
  const history = r.json?.items ?? [];
  const find = (subject, action) => history.find((x) => x.subject === subject && x.action === action);
  t.ok(r.status === 200 && history.length > 0 && history.every((x, i) => i === 0 || history[i - 1].at >= x.at), `newest first (${r.status} ${history.length})`);
  const rej = find(reel, 'reject');
  t.ok(rej?.actor?.handle === 'cmmod' && rej?.project?.title === 'A reel' && rej?.project?.author?.handle === 'cmalice' && rej?.project?.shared === 'pending' && rej?.reason === null, `a rejection: by whom, the project as it is now; its reason gone once it was shared again (${JSON.stringify(rej)})`);
  const rejPend = find('cm-pend', 'reject');
  t.eq(rejPend?.reason, 'Not finished', 'a rejection still standing shows its reason');
  t.ok(find(p1, 'approve')?.actor?.handle === 'cmmod' && find(p2, 'unhide') && find(p1, 'dismiss'), 'approvals, unhides and dismissals');
  const hid = find(p2, 'hide');
  t.ok(hid?.actor?.handle === 'cmmod' && hid?.reason === 'Not what it says' && hid?.project?.shared === 'none', `a hide, its reason kept for the reviewers after the member withdrew it (${JSON.stringify(hid)})`);
  const autoHide = history.find((x) => x.subject === p2 && x.auto);
  t.ok(autoHide?.action === 'hide' && autoHide?.actor === null && autoHide?.reason === 'Reported by members, awaiting review', `the hide the reports made, by no one (${JSON.stringify(autoHide)})`);
  const wd = find('cm-l11', 'withdraw');
  t.ok(wd?.actor?.handle === 'cmlister' && wd?.project?.shared === 'none', `withdrawals, by the member (${JSON.stringify(wd)})`);
  t.report();

  t = checks("functions: community, a reviewer's own project");
  const own = await made(mod, 'The moderator\'s own', 'model');
  await share(mod, own, true);
  t.eq((await mine(mod, own))?.shared, 'pending', "a moderator's share goes to the queue, as a member's does");
  r = await review(mod, own, { action: 'approve' });
  t.ok(r.status === 400 && r.json?.reason === 'own', `approving one's own: 400 reason own (${r.status} ${r.json?.reason})`);
  r = await review(mod, own, { action: 'reject', reason: 'Mine' });
  t.ok(r.status === 400 && r.json?.reason === 'own', `nor any other action on it (${r.status} ${r.json?.reason})`);
  t.eq((await mine(mod, own))?.shared, 'pending', 'it waits for another reviewer');
  t.report();

  await galleryChecks(checks, { bob, mod, guest, made, share, review });

  // --- roles ------------------------------------------------------------------------------------
  t = checks('functions: community, roles');
  const role = (id, json, headers = asOwner) => on.call('POST', `/admin/api/users/${id}/role`, { headers, json });
  r = await role(DAVE, { role: 'moderator' });
  t.ok(r.status === 200 && r.json?.role === 'moderator' && r.json?.id === DAVE, `the owner makes a member a moderator: the account as the Users tab shows it (${r.status} ${r.json?.role})`);
  t.eq((await storedUser(on, { id: DAVE }))?.role, 'moderator', 'stored');
  r = await dave.call('GET', '/api/me');
  t.eq(r.json?.role, 'moderator', '/api/me says so, for the Review chip');
  r = await dave.call('GET', '/api/mod/counts');
  t.eq(r.status, 200, 'and the reviewers\' routes open to them on their next request');
  r = await review(dave, own, { action: 'approve' });
  t.ok(r.status === 200 && r.json?.shared === 'public', `another reviewer approves the moderator's own (${r.status})`);
  r = await role(DAVE, { role: 'moderator' });
  t.ok(r.status === 200 && (await audited(DAVE, 'user.role')).length === 1, 'asking for what is changes and records nothing');
  rows = await audited(DAVE, 'user.role');
  t.ok(JSON.stringify(rows[0]?.detail) === '{"from":"member","to":"moderator"}', `audited user.role {from, to} (${JSON.stringify(rows[0]?.detail)})`);
  r = await role(DAVE, { role: 'owner' });
  t.ok(r.status === 400 && r.json?.reason === 'role', `never the owner's role: 400 reason role (${r.status})`);
  r = await role(DAVE, {});
  t.ok(r.status === 400 && r.json?.reason === 'role', `nor none (${r.status})`);
  r = await role(SUS, { role: 'moderator' });
  t.ok(r.status === 409 && r.json?.code === 'wrong_status' && r.json?.status === 'suspended', `a suspended account is not made a moderator: 409 wrong_status (${r.status})`);
  r = await role('u-nobody', { role: 'moderator' });
  t.eq(r.status, 404, 'no such account: 404');
  r = await role(DAVE, { role: 'member' }, {});
  t.eq(r.status, 403, 'without Access: 403');
  r = await role(DAVE, { role: 'member' });
  t.ok(r.status === 200 && r.json?.role === 'member', `made a member again (${r.status})`);
  r = await dave.call('GET', '/api/mod/counts');
  t.ok(r.status === 403 && r.json?.code === 'forbidden', `and the reviewers' routes close (${r.status})`);
  r = await on.call('GET', `/admin/api/users/${MOD}`, { headers: asOwner });
  t.eq(r.json?.role, 'moderator', "the Users tab shows each account's role");
  t.report();

  // --- the template switch ------------------------------------------------------------------------------
  t = checks('functions: community, a template is never shared');
  // Owner tools reach the rows no account owns before the bootstrap, as
  // they reach the owner's own after it: cm-owned, seeded as one waiting
  // for review, is what an owner's shared project would be.
  r = await mod.call('GET', '/api/mod/projects/cm-owned');
  t.eq(r.status, 200, "the owner's own project, shared, is the reviewers' to see");
  const pendingNow = (await mod.call('GET', '/api/mod/counts')).json?.pending;
  r = await on.call('POST', '/admin/api/projects/cm-owned/template', { headers: asOwner, json: { template: true } });
  t.ok(r.status === 200 && r.json?.template === true, `the Template switch turned on (${r.status})`);
  r = await mod.call('GET', '/api/mod/projects/cm-owned');
  t.eq(r.status, 404, 'leaves the community gallery: never in the reviewers\' reach');
  t.eq((await mod.call('GET', '/api/mod/counts')).json?.pending, pendingNow - 1, 'and out of the queue');
  r = await on.call('POST', '/admin/api/projects/cm-owned/template', { headers: asOwner, json: { template: false } });
  t.ok(r.status === 200 && r.json?.template === false && (await mod.call('GET', '/api/mod/projects/cm-owned')).status === 404, `switched off, it starts unshared (${r.status})`);
  t.report();

  // --- the cascade ---------------------------------------------------------------------------------
  t = checks('functions: community, deletions cascade');
  const p3 = await made(alice, 'Alice three', 'model');
  await share(alice, p3, true);
  await review(mod, p3, { action: 'approve' });
  await report(carol, p3, { reason: 'spam' });
  const carolReports = (await on.call('GET', `/api/dev/rows?user=${CAROL}`)).json?.reports;
  r = await alice.call('DELETE', `/api/me/projects/${p3}`);
  t.eq(r.status, 200, 'a listed, reported project deleted by its member');
  t.ok((await on.call('GET', `/api/dev/rows?user=${CAROL}`)).json?.reports === carolReports - 1 && !ids((await guest.call('GET', '/api/community')).json?.items).includes(p3), 'its reports go with it, and the list simply loses it');
  const gone = as('cm-gone');
  await report(gone, 'cm-l01', { reason: 'spam' });
  t.eq((await on.call('GET', `/api/dev/rows?user=${GONE}`)).json?.reports, 1, 'an account with a listed project and a report of its own');
  t.ok(ids((await guest.call('GET', '/api/community')).json?.items).includes('cm-gone'), 'its project listed');
  let done = false;
  for (let i = 0; i < 10 && !done; i++) {
    tick();
    r = await gone.call('POST', '/api/me/delete', { json: { handle: 'cmgone' } });
    done = r.json?.done === true;
  }
  t.ok(done, `the account deleted (${r.status} ${JSON.stringify(r.json)})`);
  const left = (await on.call('GET', `/api/dev/rows?user=${GONE}`)).json;
  t.ok(left?.users === 0 && left?.projects === 0 && left?.reports === 0, `with its projects and its reports (${JSON.stringify(left)})`);
  t.ok(!ids((await guest.call('GET', '/api/community')).json?.items).includes('cm-gone') && (await files('/m/cm-gone/thumb.jpg')).status === 404, 'its work gone from the list and the files host');
  t.report();

  // --- nothing personal in the log ------------------------------------------------------------------
  t = checks('functions: community, the audit rows');
  const subjects = [p1, p2, reel, own, 'cm-l11', 'cm-pend', DAVE, ...LISTED];
  const all = [];
  for (const s of subjects) all.push(...(await auditRows(on, s)));
  const mine3 = all.filter((x) => /^(project\.(share|withdraw|report|review)|user\.role)$/.test(x.action));
  const text = JSON.stringify(mine3.map((x) => x.detail));
  t.ok(mine3.length > 10, `the rows this suite made (${mine3.length})`);
  t.ok(!text.includes('@') && !text.includes('Copied from') && !text.includes('Not art') && !text.includes('Too dark') && !text.includes('Not what it says') && !/Title |Alice one/.test(text), `no address, note, review reason or title in any detail (${text.slice(0, 200)})`);
  t.ok(mine3.filter((x) => x.action !== 'user.role').every((x) => /^(u-|system:reports$)/.test(x.actor)), 'each by an account\'s bare id, or the reports');
  t.report();
}

// --- the Gallery tab: GET /api/mod/shared ------------------------------------------------------------

async function galleryChecks(checks, { bob, mod, guest, made, share, review }) {
  const t = checks('functions: community, the Gallery tab (/api/mod/shared)');
  const shared = (query = '') => mod.call('GET', `/api/mod/shared${query}`);
  const idsOf = (r) => (r.json?.items ?? []).map((x) => x.id);
  // Four of Bob's, approved in this order, so newest first is the reverse;
  // the titles tell a % and an _ from any character.
  const titles = ['Bob 100% pure', 'Bob 100 pure', 'Bob snake_case', 'Bob snakeXcase'];
  const made4 = [];
  for (const title of titles) {
    const id = await made(bob, title, 'model');
    await share(bob, id, true);
    await review(mod, id, { action: 'approve' });
    made4.push(id);
  }
  const [pct, plain, snake, snakeX] = made4;
  const newest = [...made4].reverse();
  let r = await shared();
  t.ok(r.status === 200 && r.headers.get('cache-control') === 'private, no-store', `a reviewer may read it: private, no-store (${r.status} ${r.headers.get('cache-control')})`);
  const all = r.json?.items ?? [];
  t.ok(all.length > 0 && all.every((x) => x.shared === 'public' || x.shared === 'hidden'), `public and hidden alone, no pending, rejected or unshared (${[...new Set(all.map((x) => x.shared))].join(',')})`);
  t.ok(all.every((x, i) => i === 0 || all[i - 1].shared_at >= x.shared_at), 'newest first');
  t.ok(all.length <= 24, `24 a page (${all.length})`);
  const card = all.find((x) => x.id === pct);
  t.ok(card?.author?.handle === 'cmbob' && card?.media === `/api/mod/media/${pct}` && card?.reports === 0 && card?.title === 'Bob 100% pure', `each as the queue lists one (${JSON.stringify(card)})`);
  r = await shared('?q=@cmbob');
  t.eq(idsOf(r).join(','), newest.join(','), '@handle: the author\'s work, newest first');
  r = await shared('?q=CMBOB');
  t.eq(idsOf(r).join(','), newest.join(','), 'a plain search matches the handle too, any capitals');
  r = await shared('?q=@pure');
  t.eq(idsOf(r).length, 0, '@ matches the handle alone, never a title');
  r = await shared(`?q=${encodeURIComponent('bob 100')}`);
  t.eq(idsOf(r).join(','), [plain, pct].join(','), 'a title, any capitals, anywhere in it');
  r = await shared(`?q=${encodeURIComponent('100%')}`);
  t.eq(idsOf(r).join(','), pct, 'a % is a %, not any run of characters');
  r = await shared(`?q=${encodeURIComponent('snake_case')}`);
  t.eq(idsOf(r).join(','), snake, 'an _ is an _, not any one character');
  r = await shared(`?q=${encodeURIComponent('  snake_case  ')}`);
  t.eq(idsOf(r).join(','), snake, 'the search is trimmed');
  r = await shared(`?q=${'x'.repeat(150)}`);
  t.ok(r.status === 200 && idsOf(r).length === 0, `a search past 100 characters is cut, not refused (${r.status})`);
  r = await review(mod, snakeX, { action: 'hide', reason: 'Testing the filter' });
  t.eq(r.json?.shared, 'hidden', 'one of them hidden');
  r = await shared('?q=@cmbob');
  const hiddenCard = (r.json?.items ?? []).find((x) => x.id === snakeX);
  t.ok(hiddenCard?.shared === 'hidden' && hiddenCard?.review_reason === 'Testing the filter' && idsOf(r).length === 4, `a hidden one is listed, marked hidden, with its reason (${JSON.stringify(hiddenCard?.shared)})`);
  r = await shared('?q=@cmbob&state=hidden');
  t.eq(idsOf(r).join(','), snakeX, 'state=hidden: the hidden alone');
  r = await shared('?q=@cmbob&state=public');
  t.eq(idsOf(r).join(','), [snake, plain, pct].join(','), 'state=public: the public alone');
  r = await shared('?q=@cmbob&state=all');
  t.eq(idsOf(r).length, 4, 'state=all: both');
  r = await shared('?state=pending');
  t.ok(r.status === 400 && r.json?.reason === 'state', `any other state: 400 reason state (${r.status} ${r.json?.reason})`);
  const walked = [];
  let next = null;
  for (let i = 0; i < 10; i++) {
    r = await shared(`?q=@cmbob&limit=1${next ? `&after=${encodeURIComponent(next)}` : ''}`);
    walked.push(...idsOf(r));
    next = r.json?.next ?? null;
    if (!next) break;
  }
  t.eq(walked.join(','), newest.join(','), 'one to a page, the cursor walks the same order without a gap or a repeat');
  r = await shared('?after=nonsense');
  t.ok(r.status === 400 && r.json?.reason === 'after', `a cursor it never gave: 400 reason after (${r.status})`);
  r = await shared('?limit=49');
  t.ok(r.status === 400 && r.json?.reason === 'limit', `a limit past 48: 400 reason limit (${r.status})`);
  r = await bob.call('GET', '/api/mod/shared?q=@cmbob');
  const g = await guest.call('GET', '/api/mod/shared');
  t.ok(r.status === 403 && r.json?.code === 'forbidden' && g.status === 401 && g.json?.code === 'signin', `a member 403, signed out 401 (${r.status} ${g.status})`);
  await review(mod, snakeX, { action: 'unhide' });
  for (const id of made4) await share(bob, id, false);
  t.report();
}

// --- functions/_shared on a fresh SQLite: the owner as a reviewer -----------------------------------

async function directChecks(checks, repo, compileShared) {
  const t = checks('functions: community, the owner reviews (directly)');
  const db = await migratedDatabase(repo);
  if (!db) {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the direct checks did not run');
    return t.report();
  }
  const load = await compileShared();
  const perms = await load('auth/permissions');
  const community = await load('community');
  const users = await load('users');
  const env = { DB: d1(db) };
  db.exec(
    seedUser({ id: 'u-own', handle: 'theowner', role: 'owner' }) +
      seedUser({ id: 'u-mod', handle: 'amod', role: 'moderator' }) +
      seedUser({ id: 'u-mem', handle: 'amember' }),
  );
  const principal = (id, role, status = 'active') => ({ kind: 'user', user: { id, role, status }, session: {}, recentAuth: false });
  const refusal = (fn) => {
    try {
      fn();
      return null;
    } catch (e) {
      return `${e.status} ${e.code}`;
    }
  };
  t.eq(refusal(() => perms.requireModerator(principal('u-own', 'owner'))), null, 'requireModerator admits the owner');
  t.eq(refusal(() => perms.requireModerator(principal('u-mod', 'moderator'))), null, 'and a moderator');
  t.eq(refusal(() => perms.requireModerator(principal('u-mem', 'member'))), '403 forbidden', 'not a member');
  t.eq(refusal(() => perms.requireModerator({ kind: 'guest' })), '401 signin', 'nor a guest: sign in');
  t.eq(refusal(() => perms.requireModerator({ kind: 'guest', refused: 'suspended' })), '403 suspended', 'a suspended account is told so');
  t.eq(refusal(() => perms.requireModerator({ kind: 'admin', email: 'x', owner: null })), '401 signin', 'the Access identity alone is no reviewer: reviewing is on the app session');
  const insert = (id, owner, shared) =>
    db.exec(`INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, created_at, updated_at, shared, shared_at)
      VALUES ('${id}', '${id}', 'model', 4, '${DATA}', 'private', 0, '${owner}', 1, 1, '${shared}', 1)`);
  insert('d-own', 'u-own', 'pending');
  insert('d-mem', 'u-mem', 'pending');
  const owner = db.prepare("SELECT * FROM users WHERE id = 'u-own'").get();
  const tryReview = async (id, body) => {
    try {
      const row = await community.reviewProject(env, owner, id, body, 1000);
      return row.shared;
    } catch (e) {
      return `${e.status} ${e.extra?.reason ?? e.code}`;
    }
  };
  t.eq(await tryReview('d-own', { action: 'approve' }), 'public', "the owner approves the owner's own: the owner reviews everything");
  t.eq(await tryReview('d-own', { action: 'hide', reason: 'Not yet' }), 'hidden', 'hides it');
  t.eq(await tryReview('d-own', { action: 'unhide' }), 'public', 'and unhides it');
  const ownRows = db.prepare("SELECT actor, detail FROM audit_log WHERE subject = 'd-own' ORDER BY id").all();
  t.ok(ownRows.length === 3 && ownRows.every((x) => x.actor === 'u-own') && JSON.parse(ownRows[1].detail).action === 'hide', `each audited as the owner's (${JSON.stringify(ownRows)})`);
  insert('d-modown', 'u-mod', 'pending');
  const moderator = db.prepare("SELECT * FROM users WHERE id = 'u-mod'").get();
  const modReview = async (id, body) => {
    try {
      return (await community.reviewProject(env, moderator, id, body, 1500)).shared;
    } catch (e) {
      return `${e.status} ${e.extra?.reason ?? e.code}`;
    }
  };
  t.eq(await modReview('d-modown', { action: 'approve' }), '400 own', "a moderator still never acts on their own");
  t.eq(await tryReview('d-mem', { action: 'approve' }), 'public', "the owner approves a member's");
  const a = db.prepare("SELECT actor, detail FROM audit_log WHERE subject = 'd-mem'").get();
  t.ok(a?.actor === 'u-own' && a?.detail === '{"action":"approve","from":"pending","to":"public"}', `audited as the owner's account (${JSON.stringify(a)})`);
  const DAYS = 24 * 60 * 60 * 1000;
  const kept = await community.reviewHistory(env, 1000 + 30 * DAYS);
  const past = await community.reviewHistory(env, 1001 + 30 * DAYS);
  t.ok(kept.length === 4 && kept.every((x) => x.at === 1000) && past.length === 0, `the history keeps 30 days to the millisecond (${kept.length} ${past.length})`);
  const by = { actor: 'owner@example.com', at: 2000 };
  const tryRole = async (id, role) => {
    try {
      return (await users.setRole(env, id, role, by)).role;
    } catch (e) {
      return `${e.status} ${e.code}`;
    }
  };
  t.eq(await tryRole('u-own', 'member'), '409 owner', "the role route never acts on the owner's own account");
  t.eq(await tryRole('u-mem', 'moderator'), 'moderator', 'and makes a member a moderator');

  // The owner's share is approved as it is made; a moderator's waits.
  const shareEnv = { DB: env.DB, AUTH_SECRET: 'community-direct-secret' };
  const projects = await load('projects');
  const owned = (id, owner, shared = 'none') => insert(id, owner, shared);
  owned('d-oshare', 'u-own');
  let after = await community.setShared(shareEnv, owner, 'd-oshare', true, 3000);
  t.ok(after.shared === 'public' && after.shared_at === 3000 && after.reviewed_by === 'u-own' && after.reviewed_at === 3000, `the owner's share goes public at once, reviewed by the owner (${after.shared} ${after.shared_at} ${after.reviewed_by})`);
  const shareRows = db.prepare("SELECT actor, action, detail FROM audit_log WHERE subject = 'd-oshare' ORDER BY id").all();
  t.ok(
    shareRows.length === 2 && shareRows[0].action === 'project.share' && shareRows[1].action === 'project.review' && shareRows[1].detail === '{"action":"approve","from":"none","to":"public"}' && shareRows.every((x) => x.actor === 'u-own'),
    `audited as project.share and project.review approve, both the owner's (${JSON.stringify(shareRows)})`,
  );
  t.ok((await community.listCommunity(shareEnv, { after: null, limit: 24 })).items.some((x) => x.id === 'd-oshare'), 'listed in the Community');
  after = await community.setShared(shareEnv, owner, 'd-oshare', true, 3100);
  t.ok(after.shared_at === 3000 && db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE subject = 'd-oshare'").get().n === 2, 'sharing it again changes and records nothing');
  owned('d-opend', 'u-own', 'pending');
  after = await community.setShared(shareEnv, owner, 'd-opend', true, 3200);
  t.eq(after.shared, 'public', "the owner's work left pending from before goes public on a share");
  const edit = async (id, who) => {
    const row = await projects.getProjectRow(shareEnv, id, { member: who });
    await projects.updateMemberProject(shareEnv, row, projects.patched(row, { title: `${id} renamed` }), 0, 4000);
    return projects.getProjectRow(shareEnv, id, { member: who });
  };
  after = await edit('d-oshare', 'u-own');
  t.ok(after.shared === 'public' && after.title === 'd-oshare renamed' && after.updated_at === 4000, `an edit of the owner's public work keeps it public (${after.shared} ${after.title})`);
  owned('d-mpub', 'u-mem', 'public');
  after = await edit('d-mpub', 'u-mem');
  t.eq(after.shared, 'pending', "while a member's goes back for review");
  owned('d-mshare', 'u-mod');
  after = await community.setShared(shareEnv, moderator, 'd-mshare', true, 3300);
  t.ok(after.shared === 'pending' && after.reviewed_by === null, `a moderator's share goes to the queue (${after.shared})`);
  t.report();
}
