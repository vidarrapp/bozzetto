// Handles (docs/accounts.md §3): the shape, the route names nobody may
// take and the protected names only the owner may, taken in any capitals,
// and retired - asked directly of functions/_shared/auth/handles.ts on a
// fresh SQLite, and over HTTP through GET /api/auth/handle, a rename and
// Join.
import { Browser, d1, migratedDatabase, seedSession, seedUser, seededToken } from '../lib.mjs';

export const needs = ['on'];

const NOW = 1_950_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const RETIRED = `INSERT INTO retired_handles (handle, until) VALUES ('hdretired', ${NOW + 30 * DAY}), ('hdlapsed', ${NOW - DAY});`;

export const seed = {
  sql: [
    seedUser({ id: 'u-hdtaken00000000000000000000', handle: 'HdTaken' }),
    RETIRED,
    seedSession({ name: 'hd-member', id: 's-hdmember', user: 'u-hdtaken00000000000000000000', created: NOW }),
  ].join('\n'),
};

export async function run({ checks, on, compileShared, repo }) {
  // --- directly ---------------------------------------------------------------
  let t = checks('functions: handles, directly');
  const db = await migratedDatabase(repo);
  if (!db) {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the direct checks did not run');
  } else {
    const handles = await (await compileShared())('auth/handles');
    db.exec(seedUser({ id: 'u-hdtaken00000000000000000000', handle: 'HdTaken' }));
    db.exec(RETIRED);
    const env = { DB: d1(db) };
    const ask = (h) => handles.handleProblem(env, h, NOW);
    for (const [h, want, why] of [
      ['abc', null, 'three characters'],
      ['a'.repeat(30), null, 'thirty'],
      ['a'.repeat(31), 'format', 'thirty-one is too many'],
      ['ab', 'format', 'two is too few'],
      ['abc_', null, 'an underscore after the first'],
      ['a-b', null, 'a hyphen after the first'],
      ['0clay', null, 'a digit first'],
      ['_abc', 'format', 'an underscore first'],
      ['-abc', 'format', 'a hyphen first'],
      ['a.b.c', 'format', 'a dot'],
      ['a bc', 'format', 'a space inside'],
      ['élan', 'format', 'a letter outside a-z'],
      ['', 'format', 'nothing'],
      [null, 'format', 'null'],
      [12345, 'format', 'a number'],
      ['Sculptor', null, 'capitals, lower-cased before the check'],
      ['  sculptor ', null, 'spaces around it, trimmed'],
    ]) {
      t.eq(await ask(h), want, `${JSON.stringify(h)}: ${why}`);
    }
    const routes = [...handles.ROUTE_NAMES];
    const kept = [...handles.PROTECTED_NAMES];
    const named = [...routes, ...kept];
    const shaped = (names) => names.filter((h) => handles.HANDLE.test(h));
    const asOwner = (h) => handles.handleProblem(env, h, NOW, { owner: true });
    const odd = (names, answers, want) => names.filter((_, i) => answers[i] !== want).join(', ') || 'all';
    let asked = await Promise.all(shaped(named).map((h) => ask(h.toUpperCase())));
    t.ok(asked.every((r) => r === 'reserved'), `every route or protected name a handle could be is reserved, in capitals too (${shaped(named).length} of ${named.length}; ${odd(shaped(named), asked, 'reserved')})`);
    asked = await Promise.all(shaped(routes).map((h) => asOwner(h.toUpperCase())));
    t.ok(asked.every((r) => r === 'reserved'), `for the owner too, every route name (${shaped(routes).length} of ${routes.length}; ${odd(shaped(routes), asked, 'reserved')})`);
    asked = await Promise.all(kept.map((h) => asOwner(h.toUpperCase())));
    t.ok(asked.every((r) => r === null), `while the owner may take every protected name (${kept.length}; ${odd(kept, asked, null)})`);
    t.ok(!routes.some((h) => handles.PROTECTED_NAMES.has(h)), 'no name is on both lists');
    t.ok(['admin', 'www', 'mail', 'm', 'dev', 'auth'].every((h) => handles.ROUTE_NAMES.has(h)) && ['owner', 'bozzetto', 'vidarrapp', 'support', 'abuse'].every((h) => handles.PROTECTED_NAMES.has(h)), 'the lists have the names the design starts them with');
    for (const [h, owner, want, why] of [
      ['VidarRapp', false, 'reserved', "the owner's name, for anyone else"],
      ['bozzetto', false, 'reserved', "the site's, for anyone else"],
      ['VidarRapp', true, null, "the owner's name, for the owner"],
      ['bozzetto', true, null, "the site's, for the owner"],
      ['Admin', true, 'reserved', 'a route name, not even for the owner'],
      ['hdtaken', true, 'taken', 'the owner is held to taken handles all the same'],
      ['hdretired', true, 'retired', 'and to retired ones'],
      ['ab', true, 'format', 'and to the shape'],
    ]) {
      t.eq(await handles.handleProblem(env, h, NOW, { owner }), want, `${JSON.stringify(h)}${owner ? ', as the owner' : ''}: ${why}`);
    }
    t.eq(await ask('hdtaken'), 'taken', "an account's handle is taken");
    t.eq(await ask('HDTAKEN'), 'taken', 'in any capitals');
    t.eq(await ask('hdretired'), 'retired', 'a handle held after its account let it go is retired');
    t.eq(await ask('HdRetired'), 'retired', 'in any capitals too');
    t.eq(await ask('hdlapsed'), null, 'and free again once the hold has run out');
    db.close();
  }
  t.report();

  // --- over HTTP ---------------------------------------------------------------
  t = checks('functions: GET /api/auth/handle');
  const browser = new Browser(on, { ip: '198.51.100.71', clock: { now: NOW } });
  const check = async (h) => {
    const r = await browser.call('GET', `/api/auth/handle${h === undefined ? '' : `?h=${encodeURIComponent(h)}`}`);
    return { status: r.status, body: r.json, cache: r.headers.get('cache-control') };
  };
  let r = await check('fresh_name');
  t.ok(r.status === 200 && JSON.stringify(r.body) === '{"available":true}' && r.cache === 'no-store', `a free handle: {available: true}, uncached (${r.status} ${JSON.stringify(r.body)} ${r.cache})`);
  r = await check('Fresh_Name');
  t.eq(JSON.stringify(r.body), '{"available":true}', 'typed in capitals, it is the same handle');
  for (const [h, reason] of [
    ['hdtaken', 'taken'],
    ['HDTAKEN', 'taken'],
    ['hdretired', 'retired'],
    ['admin', 'reserved'],
    ['auth', 'reserved'],
    ['VidarRapp', 'reserved'],
    ['bozzetto', 'reserved'],
    ['ab', 'format'],
    ['no spaces', 'format'],
    [undefined, 'format'],
  ]) {
    r = await check(h);
    t.ok(r.status === 200 && r.body?.available === false && r.body?.reason === reason, `${h === undefined ? 'no h at all' : JSON.stringify(h)}: {available: false, reason: '${reason}'} (${JSON.stringify(r.body)})`);
  }
  r = await check('hdlapsed');
  t.eq(r.body?.available, true, 'a hold that has run out leaves the handle free');
  t.report();

  // --- the protected names, for a member ----------------------------------------------
  t = checks("functions: the owner's names, refused a member");
  const member = new Browser(on, { ip: '198.51.100.71', clock: { now: NOW } });
  member.jar.set('__Host-bz_session', seededToken('hd-member'));
  r = await member.call('GET', '/api/me');
  t.ok(r.status === 200 && r.json?.role === 'member', `signed in as a member (${r.status} ${r.json?.role})`);
  for (const h of ['VidarRapp', 'bozzetto']) {
    for (const [what, b, method, path, json] of [
      ['a rename', member, 'PATCH', '/api/me', { handle: h }],
      ['Join', browser, 'POST', '/api/auth/register/start', { handle: h, email: 'hdjoiner@example.com', acceptTerms: true, ageConfirmed: true }],
      ["Join's code with it", browser, 'POST', '/api/auth/register/verify', { code: '123456', handle: h }],
    ]) {
      r = await b.call(method, path, { json });
      t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.reason === 'reserved', `${what}, ${JSON.stringify(h)}: 400, reason reserved (${r.status} ${r.json?.code} ${r.json?.reason})`);
    }
  }
  t.report();
}
