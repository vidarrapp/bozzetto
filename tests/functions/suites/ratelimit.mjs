// Rate limits (docs/accounts.md §3): fixed windows in rate_limits, keyed
// by an HMAC of the IP. Over HTTP, passkey options and handle checks (60
// per 10 minutes per IP each): the window, Retry-After, other addresses
// and the next window. Directly, what a bucket holds (no IP), and the
// sweep of rows past 48 hours.
import { createHmac } from 'node:crypto';
import { Browser, d1, migratedDatabase } from '../lib.mjs';

export const needs = ['on'];

const WINDOW = 10 * 60 * 1000;
/** The start of a window (a multiple of 10 minutes), and seven minutes into it. */
const START = 1_960_000_200_000;
const NOW = START + 7 * 60 * 1000;

export async function run({ checks, on, compileShared, repo }) {
  let t = checks('functions: rate limits over HTTP');
  const clock = { now: NOW };
  const a = new Browser(on, { ip: '198.51.100.81', clock });
  const b = new Browser(on, { ip: '198.51.100.82', clock });
  const options = (browser) => browser.call('POST', '/api/auth/passkey/options', { json: {} });
  const statuses = [];
  for (let i = 0; i < 60; i++) statuses.push((await options(a)).status);
  t.ok(statuses.every((s) => s === 200), `60 passkey options from one address in 10 minutes are answered (${[...new Set(statuses)].join(', ')})`);
  let r = await options(a);
  t.ok(r.status === 429 && r.json?.code === 'rate_limited' && r.json?.retryAfter === 180, `the 61st is 429 rate_limited (${r.status} ${r.json?.code} ${r.json?.retryAfter})`);
  t.eq(r.headers.get('retry-after'), '180', 'Retry-After says the seconds until the window ends (three minutes)');
  t.ok(r.headers.get('set-cookie') === null && r.headers.get('cache-control') === 'no-store', 'and no ceremony was begun for it');
  r = await options(a);
  t.eq(r.status, 429, 'asking again within the window is refused again');
  r = await a.call('POST', '/api/auth/passkey/options', { json: { handle: 'someone' } });
  t.eq(r.status, 429, 'and naming a handle is no way round it');
  r = await options(b);
  t.eq(r.status, 200, 'another address has its own count');
  r = await a.call('GET', '/api/auth/handle?h=still-free');
  t.eq(r.status, 200, 'and handle checks are counted apart from options');
  clock.now = START + WINDOW;
  r = await options(a);
  t.eq(r.status, 200, 'the next window starts afresh');

  clock.now = NOW + 2 * WINDOW;
  const checksSeen = [];
  for (let i = 0; i < 60; i++) checksSeen.push((await a.call('GET', `/api/auth/handle?h=name${i}x`)).status);
  t.ok(checksSeen.every((s) => s === 200), `60 handle checks in 10 minutes are answered (${[...new Set(checksSeen)].join(', ')})`);
  r = await a.call('GET', '/api/auth/handle?h=one-more');
  t.ok(r.status === 429 && r.json?.code === 'rate_limited' && r.headers.get('retry-after') === '180', `the 61st is 429 with Retry-After (${r.status} ${r.headers.get('retry-after')})`);
  t.report();

  // --- directly -------------------------------------------------------------------
  t = checks('functions: rate limits, directly');
  const db = await migratedDatabase(repo);
  if (!db) {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the direct checks did not run');
  } else {
    const limits = await (await compileShared())('auth/ratelimit');
    const secret = 'a secret for the rate-limit checks';
    const env = { DB: d1(db), AUTH_SECRET: secret };
    const tiny = { name: 'tiny', max: 2, windowMs: WINDOW };
    const ip = '192.0.2.44';
    const answers = [];
    for (let i = 0; i < 3; i++) answers.push(await limits.rateLimit(env, tiny, ip, NOW));
    t.ok(answers[0] === null && answers[1] === null && answers[2]?.status === 429, `a limit of 2: two pass, the third is refused (${answers.map((x) => x?.status ?? 'ok').join(', ')})`);
    const rows = db.prepare("SELECT bucket, win, count FROM rate_limits WHERE bucket LIKE 'tiny:%'").all();
    const hash = createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
    t.ok(rows.length === 1 && rows[0].bucket === `tiny:${hash}` && rows[0].win === START && rows[0].count === 3, `one row: the limit's name and HMAC(AUTH_SECRET, IP) cut to 128 bits, the window's start, the count (${JSON.stringify(rows)})`);
    t.ok(!JSON.stringify(db.prepare('SELECT * FROM rate_limits').all()).includes(ip), 'the IP itself is stored nowhere');
    let threw = null;
    const { error } = console;
    console.error = () => {}; // the missing secret is logged; asked on purpose here
    try {
      await limits.rateLimit({ DB: d1(db) }, tiny, ip, NOW);
    } catch (err) {
      threw = `${err.status} ${err.code}`;
    } finally {
      console.error = error;
    }
    t.eq(threw, '503 not_configured', 'without AUTH_SECRET nothing is counted in the clear: 503 not_configured');
    // The sweep runs for a share of new windows; made certain here.
    db.prepare("INSERT INTO rate_limits (bucket, win, count) VALUES ('old:x', ?, 5), ('recent:x', ?, 5)").run(NOW - 49 * 60 * 60 * 1000, NOW - 47 * 60 * 60 * 1000);
    const random = Math.random;
    const pending = [];
    Math.random = () => 0;
    try {
      await limits.rateLimit(env, { name: 'fresh', max: 5, windowMs: WINDOW }, ip, NOW, (p) => pending.push(p));
    } finally {
      Math.random = random;
    }
    await Promise.all(pending);
    const left = db.prepare("SELECT bucket FROM rate_limits WHERE bucket IN ('old:x', 'recent:x')").all().map((x) => x.bucket);
    t.eq(left.join(','), 'recent:x', 'a new window may sweep rows past 48 hours, after the answer, and keeps the rest');
    db.close();
  }
  t.report();
}
