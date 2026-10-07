// Sessions and their cookies (docs/accounts.md §2-3): GET /api/me and
// /api/me/account, the cookie a sign-in sets and the ones it clears, the
// token stored only as its hash, idle (30 days) and absolute (90 days)
// expiry on the X-Test-Now clock, last_seen_at written at most hourly
// after the answer, recent authentication, revoking one session or all,
// signing out (idempotent), and cross-site writes with a good session.
//
// The accounts and sessions are seeded with tokens the suite knows
// (seededToken), and a passkey from the software authenticator, so a
// sign-in can be made without registering one first.
import { randomBytes } from 'node:crypto';
import { Authenticator } from '../authenticator.mjs';
import {
  Browser,
  d1,
  migratedDatabase,
  seedCredential,
  seedSession,
  seedUser,
  seededToken,
  setCookies,
  sha256hex,
} from '../lib.mjs';

export const needs = ['on'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T = 1_970_000_000_000;

const ALICE = 'u-ssalice000000000000000000';
const BOB = 'u-ssbob00000000000000000000';
const SUSPENDED = 'u-sssuspended00000000000000';
const DELETING = 'u-ssdeleting000000000000000';
const ALICE_HANDLE_BYTES = randomBytes(32).toString('base64url');

const key = new Authenticator();
const aliceKey = key.seed({ rpId: 'localhost', userHandle: ALICE_HANDLE_BYTES });

/** The seeded sessions, by name: their ids, and their cookies' tokens are seededToken(name). */
const S = {
  main: 's-ssmain',
  other1: 's-ssother1',
  other2: 's-ssother2',
  idleOk: 's-ssidleok',
  idleGone: 's-ssidlegone',
  old: 's-ssold',
  revoked: 's-ssrevoked',
  cadence: 's-sscadence',
  bob: 's-ssbob',
  suspended: 's-sssuspended',
  deleting: 's-ssdeleting',
};

export const seed = {
  sql: [
    seedUser({ id: ALICE, handle: 'ssalice', webauthn: ALICE_HANDLE_BYTES, used: 5000, at: T - 100 * DAY }),
    seedUser({ id: BOB, handle: 'ssbob' }),
    seedUser({ id: SUSPENDED, handle: 'sssuspended', status: 'suspended' }),
    seedUser({ id: DELETING, handle: 'ssdeleting', status: 'deleting' }),
    seedCredential({ credential: aliceKey, user: ALICE, name: 'Alice key', at: T - 10 * DAY }),
    seedSession({ name: 'main', id: S.main, user: ALICE, created: T }),
    seedSession({ name: 'other1', id: S.other1, user: ALICE, created: T - DAY, ua: 'Other browser' }),
    seedSession({ name: 'other2', id: S.other2, user: ALICE, created: T - DAY, client: 'desktop' }),
    seedSession({ name: 'idleOk', id: S.idleOk, user: ALICE, created: T - 40 * DAY, lastSeen: T - 30 * DAY + HOUR }),
    seedSession({ name: 'idleGone', id: S.idleGone, user: ALICE, created: T - 40 * DAY, lastSeen: T - 30 * DAY }),
    seedSession({ name: 'old', id: S.old, user: ALICE, created: T - 90 * DAY + MINUTE, lastSeen: T - HOUR }),
    seedSession({ name: 'revoked', id: S.revoked, user: ALICE, created: T - DAY, revoked: T - 1 }),
    seedSession({ name: 'cadence', id: S.cadence, user: ALICE, created: T }),
    seedSession({ name: 'bob', id: S.bob, user: BOB, created: T }),
    seedSession({ name: 'suspended', id: S.suspended, user: SUSPENDED, created: T }),
    seedSession({ name: 'deleting', id: S.deleting, user: DELETING, created: T }),
    // An upload in progress, so GET /api/me has something reserved to report.
    `INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at)
       VALUES ('ss-proj', 'Alice scene', 'scene', 4, '{}', 'private', 0, '${ALICE}', 'users/${ALICE}/projects/ss-proj/', 0, 0);`,
    `INSERT INTO pending_uploads (id, r2_upload_id, project_id, user_id, file, declared_bytes, created_at)
       VALUES ('ss-up', 'r2-ss-up', 'ss-proj', '${ALICE}', 'scene.bozz', 10000, 0);`,
    `INSERT INTO upload_parts (upload_id, part, user_id, bytes) VALUES ('ss-up', 1, '${ALICE}', 1000), ('ss-up', 2, '${ALICE}', 2345);`,
  ].join('\n'),
};

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

export async function run({ checks, on, compileShared, repo }) {
  /** A browser holding one seeded session's cookie, at its own time. */
  const holding = (name, now = T, ip = '198.51.100.91') => {
    const b = new Browser(on, { ip, clock: { now } });
    b.jar.set('__Host-bz_session', seededToken(name));
    return b;
  };
  const me = (b) => b.call('GET', '/api/me');
  const account = async (b) => (await b.call('GET', '/api/me/account')).json;
  const audit = async (subject) => (await on.call('GET', `/api/dev/audit?subject=${subject}`)).json?.rows ?? [];

  // --- who is signed in ------------------------------------------------------------
  let t = checks('functions: GET /api/me and /api/me/account');
  const main = holding('main');
  let r = await me(main);
  t.ok(r.status === 200 && r.headers.get('cache-control') === 'no-store', `a good session: 200, uncached (${r.status} ${r.headers.get('cache-control')})`);
  t.eq(JSON.stringify(r.json), JSON.stringify({ id: ALICE, handle: 'ssalice', role: 'member', status: 'active', usage: { used: 5000, reserved: 3345, quota: 262144000 } }), '{id, handle, role, status, usage}, reserved being its uploads in progress');
  const acc = await account(main);
  t.eq(Object.keys(acc ?? {}).join(','), 'email,createdAt,termsVersion,passkeys,sessions', 'the account: {email, createdAt, termsVersion, passkeys, sessions}');
  t.ok(acc?.email === 'ssalice@example.com' && acc?.createdAt === T - 100 * DAY && acc?.termsVersion === '2026-10', `its address, when it was made, and the terms it accepted (${acc?.email} ${acc?.createdAt} ${acc?.termsVersion})`);
  const pk = acc?.passkeys?.[0];
  t.ok(acc?.passkeys?.length === 1 && pk.id === aliceKey.id && pk.name === 'Alice key' && pk.createdAt === T - 10 * DAY && pk.lastUsedAt === null && pk.deviceType === 'singleDevice' && pk.backedUp === false && pk.counterWarningAt === null, `its passkey: id, name, dates, type (${JSON.stringify(pk)})`);
  t.eq(Object.keys(pk ?? {}).sort().join(','), 'aaguid,backedUp,counterWarningAt,createdAt,deviceType,id,lastUsedAt,name', 'and nothing of its key or counter');
  const listed = Object.fromEntries((acc?.sessions ?? []).map((s) => [s.id, s]));
  t.ok(listed[S.main]?.current === true && listed[S.other1]?.current === false && listed[S.other2]?.client === 'desktop' && listed[S.other1]?.userAgent === 'Other browser', `its sessions, this one marked current (${Object.keys(listed).length} listed)`);
  t.ok(!listed[S.revoked] && !listed[S.idleGone] && !listed[S.bob], 'a revoked one, an idle one and anyone else\'s are not listed');
  t.eq(Object.keys(listed[S.main] ?? {}).join(','), 'id,client,userAgent,createdAt,lastSeenAt,expiresAt,method,current', 'each: {id, client, userAgent, createdAt, lastSeenAt, expiresAt, method, current}');
  t.ok(listed[S.main]?.expiresAt === T + 90 * DAY && listed[S.main]?.method === 'passkey', `expiring 90 days after its sign-in (${listed[S.main]?.expiresAt - T})`);
  const text = JSON.stringify(acc);
  t.ok(!text.includes(seededToken('main')) && !text.includes(sha256hex(seededToken('main'))), 'neither a token nor its hash is ever in it');
  r = await new Browser(on, { clock: { now: T } }).call('GET', '/api/me');
  t.ok(r.status === 401 && r.json?.code === 'signin' && r.headers.get('cache-control') === 'no-store', `no cookie: 401 signin (${r.status} ${r.json?.code})`);
  const forged = new Browser(on, { clock: { now: T } });
  forged.jar.set('__Host-bz_session', 'bz1_' + 'A'.repeat(43));
  t.eq((await me(forged)).status, 401, 'a token nobody was given: 401');
  forged.jar.set('__Host-bz_session', 'not-a-token');
  t.eq((await me(forged)).status, 401, 'nor anything else');
  r = await me(holding('suspended'));
  t.ok(r.status === 403 && r.json?.code === 'suspended' && r.headers.get('cache-control') === 'no-store', `a suspended account has no good session: 403 suspended, which signing in again would not mend (${r.status} ${r.json?.code})`);
  r = await holding('suspended').call('GET', '/api/dev/principal');
  t.ok(r.json?.principal?.kind === 'guest' && r.json?.principal?.refused === 'suspended', `it is a guest marked suspended, never the account (${JSON.stringify(r.json?.principal)})`);
  t.eq((await me(holding('deleting'))).status, 401, 'nor, for anything but finishing the deletion, one being deleted');
  t.eq((await me(holding('revoked'))).status, 401, 'nor a revoked session');
  t.report();

  // --- recent authentication ------------------------------------------------------
  t = checks('functions: recent authentication');
  const principalAt = async (name, now) => (await holding(name, now).call('GET', '/api/dev/principal')).json?.principal;
  let p = await principalAt('main', T + 9 * MINUTE);
  t.ok(p?.kind === 'user' && p.user === ALICE && p.session === S.main && p.recentAuth === true, `nine minutes after signing in, the session is recent (${JSON.stringify(p)})`);
  p = await principalAt('main', T + 10 * MINUTE);
  t.eq(p?.recentAuth, false, 'ten minutes after, it is not');
  t.report();

  // --- the cookie a sign-in sets --------------------------------------------------
  t = checks('functions: the session cookie');
  const b = new Browser(on, { ip: '198.51.100.92', clock: { now: T + HOUR } });
  b.jar.set('__Host-bz_flow', 'a-flow-in-progress');
  let o = await b.call('POST', '/api/auth/passkey/options', { json: {} });
  const wa = setCookies(o).find((c) => c.name === '__Host-bz_wa');
  t.ok(o.status === 200 && wa && /^[A-Za-z0-9_-]{43}$/.test(wa.value), `options set the ceremony cookie, 32 random bytes (${o.status} ${wa?.value?.length})`);
  t.ok(wa?.attrs.path === '/' && wa?.attrs.secure === true && wa?.attrs.httponly === true && wa?.attrs.samesite === 'Strict' && wa?.attrs['max-age'] === '300' && !('domain' in (wa?.attrs ?? {})), `__Host-bz_wa: Path=/, Secure, HttpOnly, SameSite=Strict, Max-Age=300, no Domain (${JSON.stringify(wa?.attrs)})`);
  r = await b.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(o.json, { origin: b.origin, credential: aliceKey }) } });
  const set = Object.fromEntries(setCookies(r).map((c) => [c.name, c]));
  const s = set['__Host-bz_session'];
  t.ok(r.status === 200 && r.json?.user?.id === ALICE && r.json?.user?.handle === 'ssalice', `a passkey sign-in answers the account (${r.status} ${JSON.stringify(r.json?.user)})`);
  t.ok(s && /^bz1_[A-Za-z0-9_-]{43}$/.test(s.value), `__Host-bz_session is bz1_ and 32 random bytes as base64url (${s?.value?.slice(0, 8)}…)`);
  t.ok(s?.attrs.path === '/' && s?.attrs.secure === true && s?.attrs.httponly === true && s?.attrs.samesite === 'Lax' && s?.attrs['max-age'] === String(90 * 24 * 3600) && !('domain' in (s?.attrs ?? {})), `Path=/, Secure, HttpOnly, SameSite=Lax, Max-Age=90 days, no Domain (${JSON.stringify(s?.attrs)})`);
  t.ok(set['__Host-bz_wa']?.attrs['max-age'] === '0' && set['__Host-bz_flow']?.attrs['max-age'] === '0', 'and the other auth cookies are cleared');
  const first = s?.value;
  const mine = await account(b);
  const fresh = (mine?.sessions ?? []).find((x) => x.current);
  t.ok(fresh?.method === 'passkey' && fresh?.client === 'web' && fresh?.userAgent === b.ua && fresh?.createdAt === T + HOUR && fresh?.expiresAt === T + HOUR + 90 * DAY, `it is listed: passkey, web, the user agent, 90 days (${JSON.stringify(fresh)})`);
  t.ok(!JSON.stringify(mine).includes(first) && !JSON.stringify(mine).includes(sha256hex(first)), 'its token appears nowhere but in the cookie');
  // Again, from the same browser, as the desktop app, with a long user agent.
  b.ua = `Electron/40 ${'x'.repeat(400)}`;
  o = await b.call('POST', '/api/auth/passkey/options', { json: {} });
  r = await b.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(o.json, { origin: b.origin, credential: aliceKey }), client: 'desktop' } });
  const second = b.cookie('__Host-bz_session');
  t.ok(r.status === 200 && second && second !== first, 'every sign-in mints a new token');
  const after = await account(b);
  const now2 = (after?.sessions ?? []).find((x) => x.current);
  t.ok(now2?.client === 'desktop' && now2?.userAgent?.length === 256, `client: 'desktop' is kept, and the user agent is cut to 256 characters (${now2?.client} ${now2?.userAgent?.length})`);
  t.ok(!(after?.sessions ?? []).some((x) => x.id === fresh?.id), 'and the session this browser held before is revoked');
  const stale = new Browser(on, { clock: { now: T + HOUR } });
  stale.jar.set('__Host-bz_session', first);
  t.eq((await me(stale)).status, 401, 'its old token signs nobody in');
  const rows = await audit(ALICE);
  t.ok(rows.filter((x) => x.action === 'session.signin' && x.detail.method === 'passkey').length >= 2 && rows.every((x) => !JSON.stringify(x).includes('@')), `each sign-in is audited, with no address (${rows.map((x) => x.action).join(', ')})`);
  t.report();

  // --- expiry -------------------------------------------------------------------------
  t = checks('functions: idle and absolute expiry');
  t.eq((await me(holding('idleOk'))).status, 200, 'unused for 30 days less an hour: still good');
  t.eq((await me(holding('idleGone'))).status, 401, 'unused for 30 days: gone');
  t.eq((await me(holding('old'))).status, 200, 'a minute short of 90 days, and in use: good');
  t.eq((await me(holding('old', T + MINUTE))).status, 401, 'at 90 days it ends however recently it was used');
  // A session used every 29 days lives until 90, and no longer.
  const kept = holding('other2', T);
  const lived = [];
  for (const day of [29, 58, 87]) {
    kept.clock.now = T - DAY + day * DAY;
    lived.push((await me(kept)).status);
    await wait(300); // last_seen_at is written after the answer
  }
  t.ok(lived.every((x) => x === 200), `used every 29 days, it stays good (${lived.join(', ')})`);
  kept.clock.now = T - DAY + 90 * DAY;
  t.eq((await me(kept)).status, 401, 'until 90 days after it began');
  t.report();

  // --- last_seen_at ------------------------------------------------------------------
  t = checks('functions: last_seen_at, at most hourly');
  const c = holding('cadence');
  const seen = async (now) => {
    c.clock.now = now;
    return ((await account(c))?.sessions ?? []).find((x) => x.id === S.cadence)?.lastSeenAt;
  };
  /** Ask until last_seen_at says `want` (it is written after the answer), or give up. */
  const seenBecomes = async (now, want) => {
    let got;
    for (let i = 0; i < 30; i++) {
      got = await seen(now);
      if (got === want) break;
      await wait(100);
    }
    return got;
  };
  t.eq(await seen(T + 30 * MINUTE), T, 'used half an hour after the last note: not written');
  await wait(300);
  t.eq(await seen(T + 59 * MINUTE), T, 'nor at 59 minutes');
  t.eq(await seenBecomes(T + 61 * MINUTE, T + 61 * MINUTE), T + 61 * MINUTE, 'at 61 minutes it is, after the answer');
  await wait(300);
  t.eq(await seen(T + 90 * MINUTE), T + 61 * MINUTE, 'and then not again within the hour');
  t.eq(await seenBecomes(T + 122 * MINUTE, T + 122 * MINUTE), T + 122 * MINUTE, 'but an hour after that');
  t.report();

  // --- revocation ---------------------------------------------------------------------
  t = checks('functions: revoking sessions');
  const m = holding('main', T + 2 * HOUR);
  r = await m.call('DELETE', `/api/me/sessions/${S.other1}`);
  t.ok(r.status === 204 && r.headers.get('set-cookie') === null, `another of its sessions is revoked: 204, its own cookie untouched (${r.status})`);
  t.eq((await me(holding('other1', T + 2 * HOUR))).status, 401, "that session's cookie signs nobody in now");
  t.eq((await me(m)).status, 200, 'and this one is still good');
  r = await m.call('DELETE', `/api/me/sessions/${S.other1}`);
  t.ok(r.status === 404 && r.json?.code === 'not_found', `again: 404 not_found (${r.status} ${r.json?.code})`);
  r = await m.call('DELETE', `/api/me/sessions/${S.bob}`);
  t.ok(r.status === 404 && r.json?.code === 'not_found', `someone else's: 404, as if it did not exist (${r.status})`);
  t.eq((await me(holding('bob', T + 2 * HOUR))).status, 200, 'and theirs is untouched');
  r = await new Browser(on, { clock: { now: T } }).call('DELETE', `/api/me/sessions/${S.bob}`);
  t.ok(r.status === 401 && r.json?.code === 'signin', `signed out: 401 signin (${r.status})`);
  t.ok((await audit(ALICE)).some((x) => x.action === 'session.revoke' && x.detail.session === S.other1), 'the revocation is audited');

  // Sign out everywhere but here.
  const here = new Browser(on, { ip: '198.51.100.93', clock: { now: T + 2 * HOUR } });
  o = await here.call('POST', '/api/auth/passkey/options', { json: {} });
  await here.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(o.json, { origin: here.origin, credential: aliceKey }) } });
  r = await here.call('POST', '/api/me/sessions/revoke-all', { json: { keepCurrent: 'yes' } });
  t.ok(r.status === 400 && r.json?.code === 'bad_request', `keepCurrent must be true or false (${r.status})`);
  r = await here.call('POST', '/api/me/sessions/revoke-all', { json: { keepCurrent: true } });
  t.ok(r.status === 200 && r.json?.revoked >= 3 && r.headers.get('set-cookie') === null, `keepCurrent: every other session is revoked ({revoked: ${r.json?.revoked}}), this one's cookie kept`);
  t.eq((await me(here)).status, 200, 'this one is still good');
  const others = await Promise.all(['main', 'other2', 'idleOk', 'cadence'].map(async (n) => (await me(holding(n, T + 2 * HOUR))).status));
  t.ok(others.every((x) => x === 401), `and none of the others is (${others.join(', ')})`);
  t.eq((await account(here))?.sessions?.length, 1, 'the list holds this one alone');
  const hereToken = here.cookie('__Host-bz_session');
  r = await here.call('POST', '/api/me/sessions/revoke-all', { json: {} });
  t.ok(r.status === 200 && r.json?.revoked === 1, `with keepCurrent left out, this one goes too (${JSON.stringify(r.json)})`);
  t.ok(setCookies(r).some((x) => x.name === '__Host-bz_session' && x.attrs['max-age'] === '0'), 'and its cookie is cleared');
  const kept2 = new Browser(on, { clock: { now: T + 2 * HOUR } });
  kept2.jar.set('__Host-bz_session', hereToken);
  t.eq((await me(kept2)).status, 401, 'signed out everywhere: its token is dead, not only dropped by the browser');
  const all = (await audit(ALICE)).filter((x) => x.action === 'session.revoke_all');
  t.ok(all.length === 2 && all[0].detail.keepCurrent === true && all[1].detail.keepCurrent === false, `both are audited (${all.map((x) => JSON.stringify(x.detail)).join(' ')})`);

  // Revoking this session by its id is signing out.
  const self = new Browser(on, { ip: '198.51.100.94', clock: { now: T + 3 * HOUR } });
  o = await self.call('POST', '/api/auth/passkey/options', { json: {} });
  await self.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(o.json, { origin: self.origin, credential: aliceKey }) } });
  const selfId = ((await account(self))?.sessions ?? []).find((x) => x.current)?.id;
  r = await self.call('DELETE', `/api/me/sessions/${selfId}`);
  t.ok(r.status === 204 && setCookies(r).some((x) => x.name === '__Host-bz_session' && x.attrs['max-age'] === '0'), `revoking this session by its id clears its cookie (${r.status})`);
  t.eq((await me(self)).status, 401, 'and signs this browser out');
  t.report();

  // --- signing out -----------------------------------------------------------------------
  t = checks('functions: POST /api/auth/signout');
  const out = new Browser(on, { ip: '198.51.100.95', clock: { now: T + 4 * HOUR } });
  o = await out.call('POST', '/api/auth/passkey/options', { json: {} });
  await out.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(o.json, { origin: out.origin, credential: aliceKey }) } });
  const token = out.cookie('__Host-bz_session');
  t.eq((await me(out)).status, 200, 'signed in');
  r = await out.call('POST', '/api/auth/signout');
  const cleared = Object.fromEntries(setCookies(r).map((x) => [x.name, x.attrs['max-age']]));
  t.ok(r.status === 204 && cleared['__Host-bz_session'] === '0' && cleared['__Host-bz_wa'] === '0' && cleared['__Host-bz_flow'] === '0', `204, every auth cookie cleared (${r.status} ${JSON.stringify(cleared)})`);
  const replay = new Browser(on, { clock: { now: T + 4 * HOUR } });
  replay.jar.set('__Host-bz_session', token);
  t.eq((await me(replay)).status, 401, 'the session is revoked, not only forgotten by the browser');
  r = await replay.call('POST', '/api/auth/signout', { json: {} });
  t.eq(r.status, 204, 'signing out again with the dead cookie: 204');
  r = await new Browser(on, { clock: { now: T } }).call('POST', '/api/auth/signout');
  t.eq(r.status, 204, 'and with none: 204');
  t.report();

  // --- cross-site writes with a good session ---------------------------------------------
  t = checks('functions: cross-site writes, signed in');
  const victim = holding('bob', T + 5 * HOUR, '198.51.100.96');
  for (const [method, path, json] of [
    ['POST', '/api/me/sessions/revoke-all', { keepCurrent: false }],
    ['DELETE', `/api/me/sessions/${S.bob}`, undefined],
    ['POST', '/api/auth/signout', undefined],
    ['POST', '/api/me/passkeys/options', {}],
  ]) {
    r = await victim.call(method, path, { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, ...(json ? { json } : {}) });
    t.ok(r.status === 403 && r.json?.code === 'cross_site' && r.headers.get('set-cookie') === null, `${method} ${path} from another site: 403 cross_site (${r.status} ${r.json?.code})`);
  }
  t.eq((await me(victim)).status, 200, 'and the session is still good');
  t.report();

  // --- directly ------------------------------------------------------------------------------
  t = checks('functions: sessions, directly');
  const db = await migratedDatabase(repo);
  if (!db) {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the direct checks did not run');
  } else {
    const load = await compileShared();
    const session = await load('auth/session');
    const principal = await load('principal');
    db.exec(seedUser({ id: ALICE, handle: 'ssalice', webauthn: ALICE_HANDLE_BYTES }));
    db.exec(seedUser({ id: DELETING, handle: 'ssdeleting', status: 'deleting' }));
    let queries = 0;
    const counted = d1(db);
    const DB = { ...counted, prepare: (q) => (queries++, counted.prepare(q)) };
    const env = { DB, ACCOUNTS_ENABLED: 'true' };
    const made = await session.newSession(env, { userId: ALICE, method: 'passkey', client: 'web', userAgent: 'UA', now: T });
    await made.insert.run();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(made.id);
    t.ok(/^bz1_[A-Za-z0-9_-]{43}$/.test(made.token) && /^s-[0-9a-hjkmnp-tv-z]{26}$/.test(made.id), `a new session: a bz1_ token and an s- id (${made.id})`);
    t.eq(row?.token_hash, sha256hex(made.token), 'the database keeps the SHA-256 of the token, as hex');
    t.ok(!JSON.stringify(row).includes(made.token.slice(4)), 'and nothing of the token itself');
    t.ok(row?.created_at === T && row?.last_seen_at === T && row?.reauth_at === T && row?.expires_at === T + 90 * DAY && row?.revoked_at === null, 'made now, seen now, authenticated now, ending in 90 days');
    const ask = async (url, method, token, now = T + 5 * MINUTE) => {
      const pending = [];
      const req = new Request(url, { method, headers: { cookie: `__Host-bz_session=${token}` } });
      const p2 = await principal.resolvePrincipal(req, env, new URL(req.url), now, (x) => pending.push(x));
      await Promise.all(pending);
      return { p: p2, touched: pending.length };
    };
    queries = 0;
    let got = await ask('http://localhost/api/me', 'GET', 'bz1_short');
    t.ok(got.p.kind === 'guest' && queries === 0, `a cookie no token could be costs no query (${queries})`);
    got = await ask('http://localhost/media/x/thumb.jpg', 'GET', made.token);
    t.ok(got.p.kind === 'guest' && queries === 0, 'nor does anything under /media/');
    got = await ask('http://localhost/api/me', 'GET', made.token);
    t.ok(got.p.kind === 'user' && got.p.user.id === ALICE && got.p.recentAuth === true && queries === 1 && got.touched === 0, `a good token: one read, the account and its session; not yet an hour, so nothing written (${queries} ${got.touched})`);
    got = await ask('http://localhost/api/me', 'GET', made.token, T + HOUR);
    t.ok(got.touched === 1 && db.prepare('SELECT last_seen_at FROM sessions WHERE id = ?').get(made.id).last_seen_at === T + HOUR, 'an hour on, last_seen_at is written, after the answer');
    const del = await session.newSession(env, { userId: DELETING, method: 'passkey', client: 'web', userAgent: null, now: T });
    await del.insert.run();
    got = await ask('http://localhost/api/me', 'GET', del.token);
    t.eq(got.p.kind, 'guest', 'an account being deleted is nobody on GET /api/me');
    got = await ask('http://localhost/api/me/delete', 'POST', del.token);
    t.ok(got.p.kind === 'user' && got.p.user.id === DELETING, 'but itself on POST /api/me/delete, to finish the deletion');
    const offEnv = { DB, ACCOUNTS_ENABLED: undefined };
    queries = 0;
    const offReq = new Request('http://localhost/api/me', { headers: { cookie: `__Host-bz_session=${made.token}` } });
    t.ok((await principal.resolvePrincipal(offReq, offEnv, new URL(offReq.url), T)).kind === 'guest' && queries === 0, 'with accounts off, a good cookie is nobody, and asks nothing');
    db.close();
  }
  t.report();
}
