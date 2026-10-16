// Views and stars in the community gallery (docs/accounts.md §13), and the
// public lists' sorts and search.
//
// On a fresh SQLite: migrations/0005_community_stats.sql a statement at a
// time after 0001-0004 and rows, what it then holds, refuses and cascades,
// and that no statement line carries a comment. Over HTTP: a view counts
// once a day per visitor (account, or address and browser), never the
// author's or a reviewer's, only public work, 204 whatever happened, and
// nothing past 300 an hour from one address; stars (idempotent, never
// one's own, only public work, the counter in step, the Starred list,
// hidden work dropping out, the cascades of a project's and an account's
// deletion, 200 changes a day); the four sorts and their cursors, search
// (title or handle, @handle, title alone on an author page); `starred` on a
// signed-in member's answers alone, with the cache headers that go with
// it; the counts on My projects and the Gallery tab, never on the public
// lists. Directly on functions/_shared: the marks' pruning and that a mark
// holds no address.
//
// The suite makes its works at run time, so the community suite's lists,
// which run first, never see them; its searches keep to its own handles.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Browser, DATA, auditRows, d1, migratedDatabase, seedSession, seedUser, seededToken } from '../lib.mjs';

export const needs = ['on', 'off'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The suite's own day, apart from the community suite's. */
const T = 3_160_000_000_000;

const AUTHOR = 'u-csauthor0000000000000000';
const BEE = 'u-csbee00000000000000000000';
const CEE = 'u-cscee00000000000000000000';
const DEE = 'u-csdee00000000000000000000';
const MOD = 'u-csmod00000000000000000000';
const GONE = 'u-csgone0000000000000000000';
const RATE = 'u-csrate0000000000000000000';

export const seed = {
  sql: [
    seedUser({ id: AUTHOR, handle: 'csauthor' }),
    seedUser({ id: BEE, handle: 'csbee' }),
    seedUser({ id: CEE, handle: 'cscee' }),
    seedUser({ id: DEE, handle: 'csdee' }),
    seedUser({ id: MOD, handle: 'csmod', role: 'moderator' }),
    seedUser({ id: GONE, handle: 'csgone' }),
    seedUser({ id: RATE, handle: 'csrate' }),
    seedSession({ name: 'cs-author', id: 's-csauthor', user: AUTHOR, created: T }),
    seedSession({ name: 'cs-bee', id: 's-csbee', user: BEE, created: T }),
    seedSession({ name: 'cs-cee', id: 's-cscee', user: CEE, created: T }),
    seedSession({ name: 'cs-dee', id: 's-csdee', user: DEE, created: T }),
    seedSession({ name: 'cs-mod', id: 's-csmod', user: MOD, created: T }),
    // Recently authenticated for as long as the suite runs: its deletion needs it.
    seedSession({ name: 'cs-gone', id: 's-csgone', user: GONE, created: T, reauth: T + 3 * DAY }),
    seedSession({ name: 'cs-rate', id: 's-csrate', user: RATE, created: T }),
  ].join('\n'),
};

/** The fields of a public community card, in order: no counts, ever. */
const CARD_KEYS = 'id,title,mode,fps,shared_at,author,thumb,media';

export async function run({ checks, on, off, repo, compileShared }) {
  await migrationChecks(checks, repo);
  await offChecks(checks, off);
  await onChecks(checks, on);
  await directChecks(checks, repo, compileShared);
}

// --- 0005 on a fresh SQLite ----------------------------------------------------------------

async function migrationChecks(checks, repo) {
  const t = checks('functions: community stats, 0005 on a fresh SQLite');
  let sqlite = null;
  try {
    sqlite = await import('node:sqlite');
  } catch {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the SQL-level checks did not run');
  }
  if (!sqlite) return t.report();
  const file = (name) => readFileSync(join(repo, 'migrations', name), 'utf8');
  const sql = file('0005_community_stats.sql');
  const lines = sql.split('\n');
  const commented = lines.filter((l) => l.includes('--') && !l.trimStart().startsWith('--'));
  t.ok(commented.length === 0, `no statement line carries a comment: the D1 console stops at one (${commented.join(' | ') || 'none'})`);
  const firstStatement = lines.findIndex((l) => l.trim() && !l.trimStart().startsWith('--'));
  t.ok(lines.slice(firstStatement).every((l) => !l.trimStart().startsWith('--')), 'the comments are the header alone');
  t.ok(/INSERT INTO d1_migrations \(name\) VALUES \('0005_community_stats\.sql'\)/.test(sql) && /check/i.test(sql), 'the header says to check it after a console run, and to record it');
  const db = new sqlite.DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of ['0001_init.sql', '0002_visibility.sql', '0003_accounts.sql', '0004_community.sql']) db.exec(file(name));
  db.exec(seedUser({ id: 'u-a', handle: 'mig-a' }) + seedUser({ id: 'u-b', handle: 'mig-b' }));
  db.exec(`INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, created_at, updated_at, shared, shared_at) VALUES
    ('m-pub', 'P', 'model', 4, '${DATA}', 'private', 0, 'u-a', 1, 1, 'public', 1), ('m-two', 'Q', 'model', 4, '${DATA}', 'private', 0, 'u-a', 1, 1, 'public', 2);`);
  const parts = sql
    .split(';')
    .map((s) => s.replace(/--[^\n]*/g, '').trim())
    .filter(Boolean);
  const kinds = parts.map((s) => s.split(/\s+/).slice(0, 2).join(' ').toUpperCase());
  t.ok(kinds.every((k) => /^(ALTER TABLE|CREATE TABLE|CREATE INDEX)$/.test(k)), `nothing but additions: ${[...new Set(kinds)].join(', ')}`);
  const failed = [];
  for (const stmt of parts) {
    try {
      db.exec(stmt);
    } catch (err) {
      failed.push(`${stmt.slice(0, 40)}: ${err.message}`);
    }
  }
  t.ok(failed.length === 0, `each of its ${parts.length} statements runs alone after 0004 and rows (${failed.join('; ') || 'all ran'})`);
  const one = (q, ...a) => db.prepare(q).get(...a);
  t.eq(one('SELECT COUNT(*) AS n FROM projects WHERE views = 0 AND stars = 0').n, 2, 'every row starts at no views and no stars');
  const refuses = (q) => {
    try {
      db.exec(q);
      return false;
    } catch {
      return true;
    }
  };
  t.ok(refuses("UPDATE projects SET views = NULL WHERE id = 'm-pub'") && refuses("UPDATE projects SET stars = NULL WHERE id = 'm-pub'"), 'both counters NOT NULL');
  const star = (user, project) => `INSERT INTO stars (user_id, project_id, created_at) VALUES ('${user}', '${project}', 5)`;
  t.ok(!refuses(star('u-b', 'm-pub')), 'a star of a project by a member');
  t.ok(refuses(star('u-b', 'm-pub')), 'once per member and project (PRIMARY KEY)');
  t.ok(refuses(star('u-b', 'm-nothing')) && refuses(star('u-nobody', 'm-pub')), 'of a project and by a member that are there (foreign keys)');
  db.exec(star('u-b', 'm-two'));
  db.exec(star('u-a', 'm-two'));
  db.exec("DELETE FROM projects WHERE id = 'm-pub'");
  t.eq(one("SELECT COUNT(*) AS n FROM stars WHERE project_id = 'm-pub'").n, 0, "a project's deletion takes its stars");
  db.exec("DELETE FROM users WHERE id = 'u-b'");
  t.eq(one('SELECT COUNT(*) AS n FROM stars').n, 1, "an account's deletion takes the stars it gave");
  t.ok(!refuses("INSERT INTO view_marks (key, day) VALUES ('k1', 3)") && refuses("INSERT INTO view_marks (key, day) VALUES ('k1', 4)") && refuses("INSERT INTO view_marks (key, day) VALUES ('k2', NULL)"), 'a view mark: one per key, its day required');
  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_projects_shared_views', 'idx_projects_shared_stars', 'idx_stars_project', 'idx_stars_user', 'idx_view_marks_day')",
    )
    .all();
  t.eq(indexes.length, 5, 'with the indexes the sorts, the Starred list, the cascade and the pruning read');
  const plan = db
    .prepare("EXPLAIN QUERY PLAN SELECT id FROM projects WHERE shared = 'public' ORDER BY views DESC, shared_at DESC LIMIT 5")
    .all()
    .map((r) => r.detail)
    .join(' | ');
  t.ok(/idx_projects_shared_views/.test(plan), `Most viewed reads its index (${plan})`);
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

// --- accounts off ---------------------------------------------------------------------------

async function offChecks(checks, off) {
  const t = checks('functions: community stats, accounts off');
  for (const [method, path] of [
    ['POST', '/api/community/p-x/view'],
    ['GET', '/api/me/stars'],
    ['PUT', '/api/me/stars/p-x'],
    ['DELETE', '/api/me/stars/p-x'],
    ['GET', '/api/community?sort=views'],
  ]) {
    const r = await off.call(method, path);
    t.ok(r.status === 404 && r.json?.code === 'accounts_off', `${method} ${path}: 404 accounts_off (${r.status} ${r.json?.code})`);
  }
  t.report();
}

// --- accounts on, over HTTP ------------------------------------------------------------------

/** A cursor's JSON, or null where it is not base64url JSON. */
function cursorJson(next) {
  try {
    return JSON.parse(Buffer.from(next, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

async function onChecks(checks, on) {
  const clock = { now: T + MINUTE };
  const tick = (ms = 1000) => (clock.now += ms);
  let ips = 0;
  const as = (name, opts = {}) => {
    const b = new Browser(on, { ip: opts.ip ?? `198.51.100.${10 + (ips++ % 100)}`, ua: opts.ua, clock });
    if (name) b.jar.set('__Host-bz_session', seededToken(name));
    return b;
  };
  const author = as('cs-author');
  const bee = as('cs-bee');
  const cee = as('cs-cee');
  const dee = as('cs-dee');
  const mod = as('cs-mod');
  const guest = as(null);
  const made = async (b, title) => (await b.call('POST', '/api/me/projects', { json: { title, mode: 'model' } })).json?.id;
  const publish = async (b, title) => {
    const id = await made(b, title);
    tick();
    await b.call('POST', `/api/me/projects/${id}/share`, { json: { shared: true } });
    tick();
    await mod.call('POST', `/api/mod/projects/${id}/review`, { json: { action: 'approve' } });
    return id;
  };
  const mine = async (b, id) => ((await b.call('GET', '/api/me/projects')).json ?? []).find((p) => p.id === id);
  const counts = async (id) => {
    const p = await mine(author, id);
    return `${p?.views}/${p?.stars}`;
  };
  const view = (b, id) => b.call('POST', `/api/community/${id}/view`);
  const star = (b, id, on = true) => {
    tick();
    return b.call(on ? 'PUT' : 'DELETE', `/api/me/stars/${id}`);
  };
  const starred = async (b, id) => (await b.call('GET', `/api/me/stars/${id}`)).json?.starred;
  const idsOf = (r) => (r.json?.items ?? []).map((x) => x.id);

  // Four of the author's, approved in this order, and one of Bee's.
  const apple = await publish(author, 'Stat Apple');
  const banana = await publish(author, 'Stat Banana');
  const cherry = await publish(author, 'Stat Cherry');
  const date = await publish(author, 'Stat Date');
  const beeWork = await publish(bee, 'Bee work');
  const pending = await made(author, 'Stat Pending');
  tick();
  await author.call('POST', `/api/me/projects/${pending}/share`, { json: { shared: true } });
  const unshared = await made(author, 'Stat Unshared');

  // --- views -------------------------------------------------------------------------------------
  let t = checks('functions: community stats, views');
  t.eq(await counts(apple), '0/0', 'a shared work starts at no views and no stars, on its author\'s My projects');
  const g1 = as(null, { ip: '203.0.113.71', ua: 'Browser One' });
  let r = await view(g1, apple);
  t.ok(r.status === 204 && r.bytes.length === 0 && r.headers.get('cache-control') === 'no-store', `a guest's view: 204, nothing said, not kept (${r.status} ${r.headers.get('cache-control')})`);
  t.eq(await counts(apple), '1/0', 'counted');
  r = await view(g1, apple);
  t.ok(r.status === 204 && (await counts(apple)) === '1/0', 'the same visitor again that day: 204, not counted again');
  tick(5 * HOUR);
  await view(g1, apple);
  t.eq(await counts(apple), '1/0', 'hours later the same day: still once');
  await view(as(null, { ip: '203.0.113.71', ua: 'Browser Two' }), apple);
  t.eq(await counts(apple), '2/0', 'the same address with another browser is another visitor');
  await view(as(null, { ip: '203.0.113.72', ua: 'Browser One' }), apple);
  t.eq(await counts(apple), '3/0', 'and another address');
  await view(bee, apple);
  await view(as('cs-bee', { ip: '203.0.113.73', ua: 'Elsewhere' }), apple);
  t.eq(await counts(apple), '4/0', 'a member counts once a day as the account, wherever they are');
  r = await view(author, apple);
  t.ok(r.status === 204 && (await counts(apple)) === '4/0', "the author's own opens never count, and are answered alike");
  r = await view(mod, apple);
  t.ok(r.status === 204 && (await counts(apple)) === '4/0', "nor a reviewer's");
  r = await view(g1, pending);
  const p = await mine(author, pending);
  t.ok(r.status === 204 && p?.views === 0, `a pending work: 204, nothing counted (${p?.views})`);
  r = await view(g1, unshared);
  t.ok(r.status === 204 && (await mine(author, unshared))?.views === undefined, 'an unshared one: 204, and My projects shows it no counts');
  r = await view(g1, 'p-nothing-here');
  t.eq(r.status, 204, 'a project that is not there: 204 all the same');
  r = await g1.call('GET', `/api/community/${apple}/view`);
  t.eq(r.status, 404, 'GET is not a view: 404');
  r = await g1.call('POST', `/api/community/${apple}/view`, { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
  t.ok(r.status === 403 && (await counts(apple)) === '4/0', `another site's page cannot count one (${r.status})`);
  tick(DAY);
  await view(g1, apple);
  await view(bee, apple);
  t.eq(await counts(apple), '6/0', 'the next day each visitor counts once again');
  // 300 an hour from one address, then nothing more is counted, and nothing said.
  const busy = '203.0.113.80';
  const codes = new Set();
  for (let i = 0; i < 300; i++) codes.add((await view(as(null, { ip: busy, ua: `Crawler ${i}` }), 'p-nothing-here')).status);
  r = await view(as(null, { ip: busy, ua: 'One more' }), banana);
  t.ok([...codes].join() === '204' && r.status === 204 && (await mine(author, banana))?.views === 0, `past 300 an hour from one address: still 204, not counted (${[...codes]} ${r.status})`);
  tick(HOUR);
  await view(as(null, { ip: busy, ua: 'One more' }), banana);
  t.eq((await mine(author, banana))?.views, 1, 'counted again the next hour');
  await view(as(null, { ip: '203.0.113.81' }), banana);
  await view(as(null, { ip: '203.0.113.82' }), cherry);
  // apple 6, banana 2, cherry 1, date 0.
  t.ok(!(await auditRows(on, apple)).some((x) => /(^|\.)(view|star)/.test(x.action)), 'a view writes nothing to the audit log');
  t.report();

  // --- stars ------------------------------------------------------------------------------------
  t = checks('functions: community stats, stars');
  r = await star(bee, apple);
  t.ok(r.status === 204 && r.headers.get('cache-control') === 'no-store', `a member stars a public work: 204 (${r.status})`);
  t.ok((await starred(bee, apple)) === true && (await counts(apple)) === '6/1', 'starred, and the count moves with it');
  r = await star(bee, apple);
  t.ok(r.status === 204 && (await counts(apple)) === '6/1', 'starring it again changes nothing (idempotent)');
  await star(cee, apple);
  t.eq(await counts(apple), '6/2', "another member's star");
  r = await star(bee, apple, false);
  t.ok(r.status === 204 && (await starred(bee, apple)) === false && (await counts(apple)) === '6/1', 'unstarred: 204, and the count follows');
  r = await star(bee, apple, false);
  t.ok(r.status === 204 && (await counts(apple)) === '6/1', 'unstarring again changes nothing');
  r = await star(author, apple);
  t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.reason === 'own', `one's own work: 400 reason own (${r.status} ${r.json?.reason})`);
  r = await star(author, apple, false);
  t.ok(r.status === 400 && r.json?.reason === 'own', `unstarring one's own: the same (${r.status})`);
  r = await star(bee, pending);
  t.ok(r.status === 404 && r.json?.code === 'not_found', `a pending work: 404 (${r.status})`);
  r = await star(bee, unshared);
  t.eq(r.status, 404, 'an unshared one: 404');
  r = await star(bee, 'p-nothing-here');
  t.eq(r.status, 404, 'one that is not there: 404');
  r = await star(guest, apple);
  t.ok(r.status === 401 && r.json?.code === 'signin', `signed out: 401 signin (${r.status})`);
  r = await guest.call('GET', '/api/me/stars');
  t.eq(r.status, 401, 'and no Starred list');
  r = await bee.call('PUT', `/api/me/stars/${apple}`, { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
  t.ok(r.status === 403 && (await starred(bee, apple)) === false, `another site's page cannot star for a member (${r.status})`);
  // Bee's stars, in this order: apple, banana, cherry, Dee's none.
  await star(bee, apple);
  await star(bee, banana);
  await star(bee, cherry);
  await star(dee, apple);
  await star(cee, banana);
  // apple: cee, bee, dee = 3; banana: bee, cee = 2; cherry: bee = 1; date: 0.
  t.eq([await counts(apple), await counts(banana), await counts(cherry), await counts(date)].join(' '), '6/3 2/2 1/1 0/0', 'every count in step with the stars given');
  r = await bee.call('GET', '/api/me/stars');
  t.ok(r.status === 200 && r.headers.get('cache-control') === 'no-store', `the Starred list, never kept (${r.status} ${r.headers.get('cache-control')})`);
  t.eq(idsOf(r).join(','), [cherry, banana, apple].join(','), 'the latest starred first');
  const card = r.json?.items?.[0];
  t.ok(card?.starred === true && card?.author?.handle === 'csauthor' && card?.title === 'Stat Cherry' && card?.views === undefined && card?.stars === undefined, `each a community card, starred, with no counts (${JSON.stringify(card)})`);
  const walked = [];
  let next = null;
  for (let i = 0; i < 10; i++) {
    r = await bee.call('GET', `/api/me/stars?limit=1${next ? `&after=${encodeURIComponent(next)}` : ''}`);
    walked.push(...idsOf(r));
    next = r.json?.next ?? null;
    if (!next) break;
  }
  t.eq(walked.join(','), [cherry, banana, apple].join(','), 'one to a page, the cursor walks it without a gap or a repeat');
  r = await bee.call('GET', '/api/me/stars?after=nonsense');
  t.ok(r.status === 400 && r.json?.reason === 'after', `a cursor it never gave: 400 reason after (${r.status})`);
  tick();
  await mod.call('POST', `/api/mod/projects/${cherry}/review`, { json: { action: 'hide', reason: 'Checking the stars' } });
  r = await bee.call('GET', '/api/me/stars');
  t.ok(idsOf(r).join(',') === [banana, apple].join(',') && (await starred(bee, cherry)) === true, 'hidden: it drops out of the list, the star kept');
  r = await star(dee, cherry);
  t.eq(r.status, 404, 'nobody stars it while it is hidden');
  tick();
  await mod.call('POST', `/api/mod/projects/${cherry}/review`, { json: { action: 'unhide' } });
  r = await bee.call('GET', '/api/me/stars');
  t.eq(idsOf(r).join(','), [cherry, banana, apple].join(','), 'unhidden: back in its place');
  // Withdrawn: the star stays, and can be taken back.
  tick();
  await author.call('POST', `/api/me/projects/${date}/share`, { json: { shared: false } });
  r = await star(cee, date);
  t.eq(r.status, 404, 'a withdrawn work cannot be starred');
  tick();
  await author.call('POST', `/api/me/projects/${date}/share`, { json: { shared: true } });
  tick();
  await mod.call('POST', `/api/mod/projects/${date}/review`, { json: { action: 'approve' } });
  await star(cee, date);
  tick();
  await author.call('POST', `/api/me/projects/${date}/share`, { json: { shared: false } });
  r = await star(cee, date, false);
  t.ok(r.status === 204 && (await starred(cee, date)) === false && (await mine(author, date))?.views === undefined, 'a star on work withdrawn since is taken back all the same');
  tick();
  await author.call('POST', `/api/me/projects/${date}/share`, { json: { shared: true } });
  tick();
  await mod.call('POST', `/api/mod/projects/${date}/review`, { json: { action: 'approve' } });
  t.eq(await counts(date), '0/0', 'and the count with it');
  t.report();

  // --- the public lists: starred, cache, no counts ---------------------------------------------------
  t = checks('functions: community stats, who sees what');
  r = await guest.call('GET', '/api/community?q=@csauthor');
  t.ok(r.status === 200 && r.headers.get('cache-control') === 'public, max-age=60' && /cookie/i.test(r.headers.get('vary') ?? ''), `a guest's list: kept a minute, varying by cookie (${r.headers.get('cache-control')} ${r.headers.get('vary')})`);
  t.ok((r.json?.items ?? []).every((x) => Object.keys(x).join(',') === CARD_KEYS), `no starred and no counts on a guest's cards (${Object.keys(r.json?.items?.[0] ?? {}).join(',')})`);
  r = await bee.call('GET', '/api/community?q=@csauthor');
  const flags = Object.fromEntries((r.json?.items ?? []).map((x) => [x.id, x.starred]));
  t.ok(r.headers.get('cache-control') === 'private, no-store', `a member's list: private, no-store (${r.headers.get('cache-control')})`);
  t.ok(flags[apple] === true && flags[banana] === true && flags[cherry] === true && flags[date] === false, `starred on each card, for this member (${JSON.stringify(flags)})`);
  t.ok((r.json?.items ?? []).every((x) => x.views === undefined && x.stars === undefined), 'and still no counts');
  r = await dee.call('GET', '/api/community?q=@csauthor');
  const deeFlags = Object.fromEntries((r.json?.items ?? []).map((x) => [x.id, x.starred]));
  t.ok(deeFlags[apple] === true && deeFlags[banana] === false && deeFlags[cherry] === false, `another member's answer says theirs alone (${JSON.stringify(deeFlags)})`);
  r = await bee.call('GET', '/api/community/u/csauthor');
  t.ok(r.headers.get('cache-control') === 'private, no-store' && (r.json?.items ?? []).find((x) => x.id === banana)?.starred === true, 'an author page the same');
  r = await guest.call('GET', '/api/community/u/csauthor');
  t.ok(r.headers.get('cache-control') === 'public, max-age=60' && (r.json?.items ?? []).every((x) => x.starred === undefined), "and a guest's author page is anyone's");
  const stale = new Browser(on, { ip: '198.51.100.250', clock });
  stale.jar.set('__Host-bz_session', 'bz1_not-a-session-anyone-has');
  r = await stale.call('GET', '/api/community?q=@csauthor');
  t.ok(r.status === 200 && r.headers.get('cache-control') === 'private, no-store' && (r.json?.items ?? []).every((x) => x.starred === undefined), `a session cookie that is nobody's: no stars, and kept by nothing (${r.headers.get('cache-control')})`);
  const row = await mine(author, apple);
  t.ok(row?.views === 6 && row?.stars === 3, `the author sees the counts on My projects (${row?.views} ${row?.stars})`);
  r = await mod.call('GET', '/api/mod/shared?q=@csauthor');
  const gal = Object.fromEntries((r.json?.items ?? []).map((x) => [x.id, `${x.views}/${x.stars}`]));
  t.ok(gal[apple] === '6/3' && gal[banana] === '2/2' && gal[cherry] === '1/1', `reviewers see them on the Gallery tab (${JSON.stringify(gal)})`);
  r = await guest.call('GET', `/api/projects/${apple}`);
  t.ok(r.status === 200 && r.json?.views === undefined && r.json?.stars === undefined, 'the public manifest carries none');
  t.report();

  // --- sorts and cursors ---------------------------------------------------------------------------
  t = checks('functions: community stats, sorts and cursors');
  // Approved in order apple, banana, cherry, date (date approved again last).
  const list = (query) => guest.call('GET', `/api/community?q=@csauthor${query}`);
  const walk = async (sort) => {
    const out = [];
    let after = null;
    for (let i = 0; i < 10; i++) {
      const res = await list(`&sort=${sort}&limit=1${after ? `&after=${encodeURIComponent(after)}` : ''}`);
      out.push(...idsOf(res));
      after = res.json?.next ?? null;
      if (!after) break;
    }
    return out;
  };
  const expected = {
    new: [date, cherry, banana, apple],
    old: [apple, banana, cherry, date],
    views: [apple, banana, cherry, date],
    stars: [apple, banana, cherry, date],
  };
  for (const [sort, order] of Object.entries(expected)) {
    r = await list(`&sort=${sort}`);
    t.eq(idsOf(r).join(','), order.join(','), `sort=${sort}`);
    t.eq((await walk(sort)).join(','), order.join(','), `sort=${sort}, one to a page: the cursor walks the same order`);
  }
  r = await list('');
  t.eq(idsOf(r).join(','), expected.new.join(','), 'no sort is newest first');
  // A tie on views: banana and cherry both at 2, the newer approval first.
  await view(as(null, { ip: '203.0.113.90' }), cherry);
  r = await list('&sort=views');
  t.eq(idsOf(r).join(','), [apple, cherry, banana, date].join(','), 'a tie in views: the newest approval first');
  t.eq((await walk('views')).join(','), [apple, cherry, banana, date].join(','), 'and the cursor keeps the tie apart');
  await star(dee, date);
  await star(cee, date);
  r = await list('&sort=stars');
  t.eq(idsOf(r).join(','), [apple, date, banana, cherry].join(','), 'a tie in stars (date and banana at 2): the newest approval first');
  t.eq((await walk('stars')).join(','), [apple, date, banana, cherry].join(','), 'walked the same');
  r = await list('&sort=stars&limit=1');
  const c = cursorJson(r.json?.next);
  t.ok(c && c.s === 'stars' && c.n === 3 && c.i === apple && typeof c.t === 'number', `the cursor: base64url JSON of the sort, the count, the time and the id (${JSON.stringify(c)})`);
  r = await list('&sort=new&limit=1');
  const cn = cursorJson(r.json?.next);
  t.ok(cn && cn.s === 'new' && cn.n === undefined && cn.i === date, `newest's carries no count (${JSON.stringify(cn)})`);
  r = await list('&sort=popular');
  t.ok(r.status === 400 && r.json?.reason === 'sort', `a sort that is not one: 400 reason sort (${r.status} ${r.json?.reason})`);
  const bad = [
    ['nonsense', 'not base64url JSON'],
    [b64({ s: 'new', t: 1, i: apple }), 'another sort\'s'],
    [b64({ s: 'stars', t: 1, i: apple }), 'without its count'],
    [b64({ s: 'stars', n: -1, t: 1, i: apple }), 'a negative count'],
    [b64({ s: 'stars', n: 1.5, t: 1, i: apple }), 'a count that is not whole'],
    [b64({ s: 'stars', n: 1, t: '1', i: apple }), 'a time that is text'],
    [b64({ s: 'stars', n: 1, t: 1, i: '../x' }), 'an id that is not one'],
    [b64({ s: 'stars', n: 1, t: 1, i: apple, x: 1 }), 'a key too many'],
    [b64([1, 2]), 'an array'],
    [`${T}.${apple}`, 'the old <shared_at>.<id>'],
  ];
  for (const [after, what] of bad) {
    r = await list(`&sort=stars&after=${encodeURIComponent(after)}`);
    t.ok(r.status === 400 && r.json?.reason === 'after' && r.headers.get('cache-control') === 'no-store', `${what}: 400 reason after, kept by nothing (${r.status} ${r.json?.reason})`);
  }
  r = await guest.call('GET', `/api/community/u/csauthor?sort=views&limit=2`);
  const firstTwo = idsOf(r);
  const rest = await guest.call('GET', `/api/community/u/csauthor?sort=views&after=${encodeURIComponent(r.json?.next ?? '')}`);
  t.eq([...firstTwo, ...idsOf(rest)].join(','), [apple, cherry, banana, date].join(','), 'an author page sorts and pages as the Community does');
  r = await guest.call('GET', '/api/community/u/csauthor?sort=nope');
  t.ok(r.status === 400 && r.json?.reason === 'sort', `and refuses the same (${r.status})`);
  t.report();

  // --- search ----------------------------------------------------------------------------------------
  t = checks('functions: community stats, search');
  const search = async (path, q) => idsOf(await guest.call('GET', `${path}${path.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}`)).filter((id) => [apple, banana, cherry, date, beeWork].includes(id));
  t.eq((await search('/api/community', 'stat ch')).join(','), cherry, 'a title, any capitals, anywhere in it');
  t.eq((await search('/api/community', '  Stat Cherry  ')).join(','), cherry, 'trimmed');
  t.eq((await search('/api/community', 'csbee')).join(','), beeWork, 'a handle matches too');
  t.eq((await search('/api/community', '@csbee')).join(','), beeWork, '@handle: that author');
  t.eq((await search('/api/community', '@stat')).length, 0, '@ matches the handle alone, never a title');
  t.eq((await search('/api/community?sort=old', 'Stat')).join(','), [apple, banana, cherry, date].join(','), 'with a sort');
  r = await guest.call('GET', `/api/community?q=${'x'.repeat(150)}`);
  t.ok(r.status === 200 && idsOf(r).length === 0, `past 100 characters it is cut, not refused (${r.status})`);
  r = await guest.call('GET', `/api/community?q=${encodeURIComponent('%')}`);
  t.ok(r.status === 200 && idsOf(r).length === 0, 'a % is a %, not any run of characters');
  t.eq((await search('/api/community/u/csauthor', 'banana')).join(','), banana, "an author page: the author's titles");
  t.eq((await search('/api/community/u/csauthor', 'csauthor')).length, 0, 'never the handle, which every card there shares');
  t.eq((await search('/api/community/u/csauthor', '@csauthor')).length, 0, 'not even with @');
  t.report();

  // --- the cascades --------------------------------------------------------------------------------
  t = checks('functions: community stats, deletions');
  r = await author.call('DELETE', `/api/me/projects/${date}`);
  t.eq(r.status, 200, 'a starred work deleted by its author');
  t.ok((await starred(dee, date)) === false && (await starred(cee, date)) === false, 'its stars go with it');
  const gone = as('cs-gone');
  await star(gone, apple);
  await star(gone, banana);
  t.eq([await counts(apple), await counts(banana)].join(' '), '6/4 2/3', 'an account that starred two works');
  let done = false;
  for (let i = 0; i < 10 && !done; i++) {
    tick();
    r = await gone.call('POST', '/api/me/delete', { json: { handle: 'csgone' } });
    done = r.json?.done === true;
  }
  t.ok(done, `the account deleted (${r.status} ${JSON.stringify(r.json)})`);
  t.eq([await counts(apple), await counts(banana)].join(' '), '6/3 2/2', 'its stars go, and the counts with them');
  t.report();

  // --- 200 star changes a day ------------------------------------------------------------------------
  t = checks('functions: community stats, 200 star changes a day');
  const rate = as('cs-rate');
  const before = await counts(cherry);
  const changes = new Set();
  for (let i = 0; i < 200; i++) changes.add((await star(rate, cherry, i % 2 === 0)).status);
  t.ok([...changes].join() === '204', `two hundred changes: each 204 (${[...changes]})`);
  r = await star(rate, cherry, false);
  t.ok(r.status === 204, 'unstarring what is not starred changes and counts nothing');
  r = await star(rate, cherry, true);
  t.ok(r.status === 429 && r.json?.code === 'rate_limited' && Number(r.headers.get('retry-after')) > 0, `the 201st change: 429 with Retry-After (${r.status})`);
  t.ok((await starred(rate, cherry)) === false && (await counts(cherry)) === before, `nothing changed by it, the count as before (${before})`);
  t.report();
}

// --- functions/_shared directly: the marks ------------------------------------------------------------

async function directChecks(checks, repo, compileShared) {
  const t = checks('functions: community stats, view marks (directly)');
  const db = await migratedDatabase(repo);
  if (!db) {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the direct checks did not run');
    return t.report();
  }
  const stats = await (await compileShared())('stats');
  const env = { DB: d1(db), AUTH_SECRET: 'stats-direct-secret' };
  db.exec(seedUser({ id: 'u-own', handle: 'dsowner' }) + seedUser({ id: 'u-vis', handle: 'dsvisitor' }));
  db.exec(`INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, created_at, updated_at, shared, shared_at)
    VALUES ('d-pub', 'P', 'model', 4, '${DATA}', 'private', 0, 'u-own', 1, 1, 'public', 1)`);
  const now = 100 * 24 * 60 * 60 * 1000 + 5000;
  const today = stats.dayOf(now);
  db.exec(`INSERT INTO view_marks (key, day) VALUES ('old3', ${today - 3}), ('old2', ${today - 2}), ('yday', ${today - 1}), ('tday', ${today})`);
  await stats.pruneViewMarks(env, now);
  const left = db.prepare('SELECT key FROM view_marks ORDER BY day').all().map((r) => r.key);
  t.eq(left.join(','), 'yday,tday', "pruning keeps today's and yesterday's marks, and nothing older");
  const guest = { kind: 'guest' };
  const req = new Request('http://localhost/api/community/d-pub/view', { method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.44', 'user-agent': 'Direct Browser/1.0' } });
  db.exec(`INSERT INTO view_marks (key, day) VALUES ('older', ${today - 5})`);
  t.eq(await stats.countView(env, guest, req, 'd-pub', now, undefined, true), true, 'a guest view counts');
  t.ok(db.prepare("SELECT COUNT(*) AS n FROM view_marks WHERE key = 'older'").get().n === 0, 'and the share that prunes takes the old marks as it goes');
  t.eq(await stats.countView(env, guest, req, 'd-pub', now, undefined, false), false, 'the same visitor the same day does not');
  const marks = db.prepare("SELECT key, day FROM view_marks WHERE key NOT IN ('yday', 'tday')").all();
  t.ok(marks.length === 1 && /^[0-9a-f]{32}$/.test(marks[0].key) && marks[0].day === today, `a mark is a 128-bit keyed code and the day (${JSON.stringify(marks)})`);
  const everything = JSON.stringify(db.prepare('SELECT * FROM view_marks').all()) + JSON.stringify(db.prepare('SELECT * FROM rate_limits').all());
  t.ok(!everything.includes('192.0.2.44') && !everything.includes('Direct Browser'), 'neither the address nor the browser is kept, in the marks or the limits');
  t.eq(db.prepare("SELECT views FROM projects WHERE id = 'd-pub'").get().views, 1, 'the count moved once');
  const member = { kind: 'user', user: { id: 'u-vis', role: 'member' } };
  const owner = { kind: 'user', user: { id: 'u-own', role: 'member' } };
  const moderator = { kind: 'user', user: { id: 'u-mod', role: 'moderator' } };
  t.eq(await stats.countView(env, member, req, 'd-pub', now, undefined, false), true, 'a member counts as an account');
  t.eq(await stats.countView(env, owner, req, 'd-pub', now, undefined, false), false, 'the author never');
  t.eq(await stats.countView(env, moderator, req, 'd-pub', now, undefined, false), false, 'a reviewer never');
  t.eq(await stats.countView(env, guest, req, 'd-pub', now + 24 * 60 * 60 * 1000, undefined, false), true, 'the next day the guest again');
  t.report();
}
