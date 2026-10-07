// Handles (docs/accounts.md §3): the shape, the reserved list, taken in
// any capitals, and retired - asked directly of functions/_shared/auth/
// handles.ts on a fresh SQLite, and over HTTP through GET /api/auth/handle.
import { Browser, d1, migratedDatabase, seedUser } from '../lib.mjs';

export const needs = ['on'];

const NOW = 1_950_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const RETIRED = `INSERT INTO retired_handles (handle, until) VALUES ('hdretired', ${NOW + 30 * DAY}), ('hdlapsed', ${NOW - DAY});`;

export const seed = {
  sql: `${seedUser({ id: 'u-hdtaken00000000000000000000', handle: 'HdTaken' })}\n${RETIRED}`,
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
    const reserved = [...handles.RESERVED];
    const shaped = reserved.filter((h) => handles.HANDLE.test(h));
    const asked = await Promise.all(shaped.map((h) => ask(h.toUpperCase())));
    t.ok(asked.every((r) => r === 'reserved'), `every reserved word a handle could be is reserved, in capitals too (${shaped.length} of ${reserved.length}; ${shaped.filter((_, i) => asked[i] !== 'reserved').join(', ') || 'all'})`);
    t.ok(['admin', 'owner', 'bozzetto', 'support', 'abuse', 'www', 'mail'].every((h) => handles.RESERVED.has(h)), 'the list has the names the design starts it with');
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
}
