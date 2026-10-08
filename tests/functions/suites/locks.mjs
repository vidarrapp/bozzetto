// The two locks on /admin/* and the owner's bootstrap (docs/accounts.md
// §2, §8). Lock 1 is Cloudflare Access (here, its identity header on
// loopback); lock 2, once an owner account exists, is that account's own
// session. Before the bootstrap, Access alone opens /admin/; the bootstrap
// takes Access alone, makes the owner (once), claims the owner's
// projects, and signs them in; after it, Access alone is 403
// owner_session, as is Access with anyone else's session, and a session
// without Access is no way in either. Outside /admin/ the Access headers
// count for nothing.
//
// This suite makes the `on` server's owner: suites after it there meet an
// owner account (none of them uses /admin/). `off` never has one.
import { Authenticator } from '../authenticator.mjs';
import {
  Browser,
  DATA,
  OWNER,
  glb,
  jpeg,
  asOwner,
  d1,
  ids,
  migratedDatabase,
  seedSession,
  seedUser,
  seededToken,
  setCookies,
} from '../lib.mjs';

export const needs = ['on', 'off'];

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const T = 2_100_000_000_000;
const GiB = 1024 * 1024 * 1024;
const MEMBER = 'u-lkmember0000000000000000';

// The owner's files from before accounts, where 0.5 put them: their rows say
// nothing (lk-own a stale 1234), so the bootstrap counts them from R2.
const OWN_THUMB = jpeg(41, 900);
const OWN_FRAME = glb({ seed: 42, bin: 2000, raw: true });
const OWN2_FRAME = glb({ seed: 43, bin: 700, raw: true });
const TEMPLATE_THUMB = jpeg(44, 1500);

const project = (id, template, owner, bytes, visibility = 'private') =>
  `('${id}', '${id}', 'timelapse', 4, '${DATA}', '${visibility}', ${template}, ${owner ? `'${owner}'` : 'NULL'}, NULL, ${bytes}, 7000, 7000)`;

export const seed = {
  sql: [
    seedUser({ id: MEMBER, handle: 'lkmember' }),
    seedUser({ id: 'u-lktaken00000000000000000', handle: 'LkTaken' }),
    `INSERT INTO retired_handles (handle, until) VALUES ('lkretired', ${T + 30 * DAY});`,
    seedSession({ name: 'lk-member', id: 's-lkmember', user: MEMBER, created: T }),
    `INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, bytes, created_at, updated_at) VALUES
      ${project('lk-own', 0, null, 1234)},
      ${project('lk-own2', 0, null, 0)},
      ${project('lk-template', 1, null, 0, 'public')},
      ${project('lk-member-proj', 0, MEMBER, 0)};`,
  ].join('\n'),
  r2: [
    { key: 'projects/lk-own/thumb.jpg', bytes: OWN_THUMB, type: 'image/jpeg' },
    { key: 'projects/lk-own/frames/sd/0000.glb', bytes: OWN_FRAME, type: 'model/gltf-binary' },
    { key: 'projects/lk-own2/frames/sd/0000.glb', bytes: OWN2_FRAME, type: 'model/gltf-binary' },
    { key: 'projects/lk-template/thumb.jpg', bytes: TEMPLATE_THUMB, type: 'image/jpeg' },
  ],
};

export async function run({ checks, on, off, compileShared, repo }) {
  const clock = { now: T };
  const browser = (session) => {
    const b = new Browser(on, { ip: '198.51.100.201', clock });
    if (session) b.jar.set('__Host-bz_session', seededToken(session));
    return b;
  };
  const access = browser();
  const admin = (b, method, path, opts = {}) => b.call(method, path, { ...opts, headers: { ...asOwner, ...opts.headers } });
  const bootstrap = (b, json, headers = asOwner) => b.call('POST', '/admin/api/owner/bootstrap', { json, headers });
  // The owner's own name, which only the owner's account may take (handles.ts).
  const good = { handle: 'VidarRapp', acceptTerms: true, ageConfirmed: true };

  // --- before there is an owner ------------------------------------------------------
  let t = checks('functions: lock 1 alone, before the bootstrap');
  let r = await admin(access, 'GET', '/admin/api/whoami');
  t.ok(r.status === 200 && r.json?.email === OWNER && r.json?.owner === null, `Access alone opens /admin/, with no owner account yet (${r.status} ${JSON.stringify(r.json)})`);
  r = await admin(access, 'GET', '/admin/api/projects');
  t.ok(r.status === 200 && ids(r.json).includes('lk-own') && ids(r.json).includes('lk-template') && !ids(r.json).includes('lk-member-proj'), `owner tools reach templates and the projects nobody owns, not a member's (${r.status})`);
  r = await access.call('GET', '/api/dev/principal', { headers: asOwner });
  t.eq(r.json?.principal?.kind, 'guest', 'outside /admin/ the Access identity is nobody');
  t.report();

  t = checks('functions: the bootstrap, refused');
  r = await off.call('POST', '/admin/api/owner/bootstrap', { headers: asOwner, json: good });
  t.ok(r.status === 404 && r.json?.code === 'accounts_off', `accounts off: 404 accounts_off (${r.status} ${r.json?.code})`);
  r = await bootstrap(access, good, {});
  t.eq(r.status, 403, 'without Access: 403');
  r = await bootstrap(browser('lk-member'), good, {});
  t.eq(r.status, 403, 'a member session is no Access');
  for (const [what, body, status, code, reason] of [
    ['terms not accepted', { ...good, acceptTerms: false }, 400, 'bad_request'],
    ['age not confirmed', { handle: 'VidarRapp', acceptTerms: true }, 400, 'bad_request'],
    ['a handle too short', { ...good, handle: 'ab' }, 400, 'bad_request', 'format'],
    ['a route name, which not even the owner may take', { ...good, handle: 'Admin' }, 400, 'bad_request', 'reserved'],
    ['a handle taken, in other capitals', { ...good, handle: 'LKTAKEN' }, 409, 'handle_taken', 'taken'],
    ['a retired handle', { ...good, handle: 'lkretired' }, 409, 'handle_taken', 'retired'],
  ]) {
    r = await bootstrap(access, body);
    t.ok(r.status === status && r.json?.code === code && r.json?.reason === reason && r.headers.get('set-cookie') === null, `${what}: ${status} ${code}${reason ? ` {reason: ${reason}}` : ''} (${r.status} ${JSON.stringify(r.json)})`);
  }
  r = await access.call('POST', '/admin/api/owner/bootstrap', { headers: asOwner, body: JSON.stringify(good), type: 'text/plain' });
  t.ok(r.status === 415 && r.json?.code === 'bad_type', `a body that is not application/json: 415 bad_type (${r.status} ${r.json?.code})`);
  r = await admin(access, 'GET', '/admin/api/whoami');
  t.eq(r.json?.owner, null, 'and still no owner');
  t.report();

  // --- the bootstrap ---------------------------------------------------------------------
  t = checks('functions: the bootstrap');
  const owner = browser();
  r = await bootstrap(owner, good);
  const made = r.json?.user;
  const cookie = setCookies(r).find((c) => c.name === '__Host-bz_session');
  t.ok(r.status === 201 && made?.handle === 'vidarrapp' && made?.role === 'owner' && made?.status === 'active' && /^u-[0-9a-hjkmnp-tv-z]{26}$/.test(made?.id), `201 {user}: the owner's account, under a protected name, lower-cased (${r.status} ${JSON.stringify(made)})`);
  const mine = (await owner.call('GET', '/api/me/projects')).json ?? [];
  const weighs = (id) => mine.find?.((p) => p.id === id)?.bytes;
  const sum = mine.reduce?.((n, p) => n + p.bytes, 0);
  t.ok(made?.usage?.quota === 10 * GiB && made?.usage?.used === sum && made?.usage?.used >= OWN_THUMB.length + OWN_FRAME.length + OWN2_FRAME.length && made?.usage?.reserved === 0 && !('recount' in (r.json ?? {})), `10 GiB, and the claimed projects' bytes, counted from R2, against it, all of them (${JSON.stringify(made?.usage)} ${r.json?.recount})`);
  t.ok(weighs('lk-own') === OWN_THUMB.length + OWN_FRAME.length && weighs('lk-own2') === OWN2_FRAME.length, `each claimed project weighs what R2 holds of it, where its row said 1234 and 0 (${weighs('lk-own')}, ${weighs('lk-own2')})`);
  t.ok(cookie?.attrs.samesite === 'Lax' && cookie?.attrs.httponly === true && cookie?.attrs.secure === true && /^bz1_/.test(cookie?.value), 'and signed in, with the session cookie');
  const acc = (await owner.call('GET', '/api/me/account')).json;
  t.ok(acc?.email === OWNER && acc?.termsVersion === '2026-10-08' && acc?.sessions?.[0]?.method === 'bootstrap', `under the Access identity's address, the terms accepted, signed in by 'bootstrap' (${acc?.email} ${acc?.sessions?.[0]?.method})`);
  r = await owner.call('GET', '/api/dev/principal');
  t.ok(r.json?.principal?.kind === 'user' && r.json?.principal?.recentAuth === true, 'the new session counts as recent authentication, so a passkey can be offered at once');
  const rows = (await on.call('GET', `/api/dev/audit?subject=${made?.id}`)).json?.rows ?? [];
  const boot = rows.find((x) => x.action === 'owner.bootstrap');
  t.ok(boot?.actor === made?.id && boot?.detail?.claimed >= 2 && !JSON.stringify(boot).includes('@'), `audited, as the new account, with no address (${JSON.stringify(boot)})`);
  r = await bootstrap(browser(), { ...good, handle: 'another' });
  t.ok(r.status === 409 && r.json?.code === 'owner_exists', `again, with Access alone: 409 owner_exists (${r.status} ${r.json?.code})`);
  r = await bootstrap(owner, { ...good, handle: 'another' });
  t.ok(r.status === 409 && r.json?.code === 'owner_exists', `and with the owner signed in too (${r.status})`);
  r = await access.call('GET', '/api/auth/handle?h=vidarrapp');
  t.ok(r.json?.available === false && r.json?.reason === 'reserved', `the live check still says reserved, not taken (${JSON.stringify(r.json)})`);
  r = await browser('lk-member').call('PATCH', '/api/me', { json: { handle: 'VidarRapp' } });
  t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.reason === 'reserved', `and a member renamed to it: 400 reserved, as before the owner had it (${r.status} ${r.json?.code} ${r.json?.reason})`);
  t.report();

  // --- lock 2 ------------------------------------------------------------------------------
  t = checks('functions: lock 2, once there is an owner');
  r = await admin(access, 'GET', '/admin/api/whoami');
  t.ok(r.status === 403 && r.json?.code === 'owner_session', `Access alone: 403 owner_session (${r.status} ${r.json?.code})`);
  r = await admin(access, 'GET', '/admin/api/projects');
  t.ok(r.status === 403 && r.json?.code === 'owner_session', `on every owner route (${r.status})`);
  r = await admin(access, 'POST', '/admin/api/projects', { json: { id: 'lk-forbidden' } });
  t.ok(r.status === 403 && r.json?.code === 'owner_session', `a write too (${r.status})`);
  r = await admin(access, 'GET', '/admin/api/media/lk-own/thumb.jpg');
  t.eq(r.status, 404, 'and the owner media route is not found');
  r = await admin(owner, 'GET', '/admin/api/whoami');
  t.ok(r.status === 200 && r.json?.email === OWNER && r.json?.owner?.id === made?.id && r.json?.owner?.handle === 'vidarrapp', `Access and the owner's session: in (${r.status} ${JSON.stringify(r.json)})`);
  r = await admin(owner, 'GET', '/admin/api/projects');
  const listed = ids(r.json);
  t.ok(r.status === 200 && listed.includes('lk-own') && listed.includes('lk-own2') && listed.includes('lk-template') && !listed.includes('lk-member-proj') && !listed.includes('lk-forbidden'), `the claimed projects are the owner's own now, the templates still reached, a member's not (${r.status})`);
  r = await owner.call('GET', '/admin/api/whoami');
  t.eq(r.status, 403, "the owner's session without Access: 403 (lock 1)");
  r = await admin(browser('lk-member'), 'GET', '/admin/api/whoami');
  t.ok(r.status === 403 && r.json?.code === 'owner_session', `Access with a member's session: 403 owner_session (${r.status} ${r.json?.code})`);
  const forged = browser();
  forged.jar.set('__Host-bz_session', 'bz1_' + 'B'.repeat(43));
  r = await admin(forged, 'GET', '/admin/api/whoami');
  t.eq(r.json?.code, 'owner_session', 'with a session nobody was given: the same');
  r = await access.call('GET', '/admin/login?next=%2F', { headers: asOwner, redirect: 'manual' });
  t.eq(r.status, 302, 'the way back in after an Access login asks no session');
  r = await owner.call('GET', '/api/dev/principal', { headers: asOwner });
  t.ok(r.json?.principal?.kind === 'user' && r.json?.principal?.user === made?.id, `on /api the Access headers are ignored: the owner is a user there, by the session alone (${JSON.stringify(r.json?.principal)})`);
  // Owner tools act as the owner's account now.
  r = await admin(owner, 'POST', '/admin/api/projects/lk-own2/template', { json: { template: true } });
  const switched = r.status;
  r = await admin(owner, 'POST', '/admin/api/projects/lk-own2/template', { json: { template: false } });
  const back = r.json;
  const trail = (await on.call('GET', '/api/dev/audit?subject=lk-own2')).json?.rows ?? [];
  t.ok(switched === 200 && back?.template === false && trail.length === 2 && trail.every((x) => x.actor === made?.id), `a Template switch there and back is audited as the owner's account (${trail.map((x) => x.actor).join(', ')})`);
  r = await admin(owner, 'GET', '/admin/api/projects/lk-own2');
  t.ok(r.status === 200 && r.json?.template === false, 'and the project came back to the owner, still within reach');
  const usedNow = async () => (await owner.call('GET', '/api/me')).json?.usage?.used;
  const used0 = await usedNow();
  t.eq(used0, sum, 'and the bytes it took away came back with it');
  // A template from before the counting (bytes 0, a thumbnail in R2), switched off: weighed first, so the owner takes what it holds.
  r = await admin(owner, 'POST', '/admin/api/projects/lk-template/template', { json: { template: false } });
  const tplTrail = (await on.call('GET', '/api/dev/audit?subject=lk-template')).json?.rows ?? [];
  const used1 = await usedNow();
  t.ok(r.status === 200 && used1 === used0 + TEMPLATE_THUMB.length && tplTrail.at(-1)?.detail?.bytes === TEMPLATE_THUMB.length, `a legacy template switched off moves what R2 holds of it onto the owner's usage (${used0} to ${used1}, ${JSON.stringify(tplTrail.at(-1)?.detail)})`);
  r = await admin(owner, 'POST', '/admin/api/projects/lk-template/template', { json: { template: true } });
  t.ok(r.status === 200 && (await usedNow()) === used0, `and switched on again, takes it away (${await usedNow()})`);
  r = await admin(owner, 'POST', `/admin/api/users/${made?.id}/recount`);
  t.ok(r.status === 200 && r.json?.bytesUsed === used0 && r.json?.before === used0 && r.json?.next === null, `the owner's Recount of their own account agrees, all counted (${JSON.stringify(r.json)})`);
  t.report();

  // --- the owner's passkey ---------------------------------------------------------------
  t = checks("functions: the owner's passkey");
  clock.now = T + MINUTE;
  const key = new Authenticator();
  const options = await owner.call('POST', '/api/me/passkeys/options', { json: {} });
  const { response, credential } = key.makeCredential(options.json, { origin: owner.origin });
  r = await owner.call('POST', '/api/me/passkeys', { json: { response } });
  t.eq(r.status, 201, 'the passkey offered after the bootstrap is saved without asking again');
  const bootToken = owner.cookie('__Host-bz_session');
  r = await owner.call('POST', '/api/auth/signout');
  t.eq(r.status, 204, 'signed out');
  const old = browser();
  old.jar.set('__Host-bz_session', bootToken);
  r = await admin(old, 'GET', '/admin/api/whoami');
  t.ok(r.status === 403 && r.json?.code === 'owner_session', `the revoked session no longer opens /admin/ (${r.status} ${r.json?.code})`);
  const again = await owner.call('POST', '/api/auth/passkey/options', { json: {} });
  r = await owner.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(again.json, { origin: owner.origin, credential }) } });
  t.ok(r.status === 200 && r.json?.user?.role === 'owner', `signed in again with the passkey (${r.status})`);
  r = await admin(owner, 'GET', '/admin/api/whoami');
  t.ok(r.status === 200 && r.json?.owner?.id === made?.id, `and with Access, /admin/ opens (${r.status})`);
  clock.now = T + 31 * DAY;
  r = await admin(owner, 'GET', '/admin/api/whoami');
  t.ok(r.status === 403 && r.json?.code === 'owner_session', `an owner's session unused for 30 days no longer does (${r.status})`);
  t.report();

  // --- directly ----------------------------------------------------------------------------
  t = checks('functions: the two locks, directly');
  const db = await migratedDatabase(repo);
  if (!db) {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the direct checks did not run');
  } else {
    const load = await compileShared();
    const principal = await load('principal');
    const session = await load('auth/session');
    db.exec(seedUser({ id: 'u-direct-owner', handle: 'directowner', email: OWNER, role: 'owner' }));
    let queries = 0;
    const counted = d1(db);
    const env = { DB: { ...counted, prepare: (q) => (queries++, counted.prepare(q)) }, ADMIN_EMAILS: OWNER };
    const made2 = await session.newSession(env, { userId: 'u-direct-owner', method: 'passkey', client: 'web', userAgent: null, now: T });
    await made2.insert.run();
    const ask = async (accounts, cookie) => {
      queries = 0;
      const req = new Request('http://127.0.0.1:8788/admin/api/whoami', { headers: { ...asOwner, ...(cookie ? { cookie: `__Host-bz_session=${cookie}` } : {}) } });
      const p = await principal.resolvePrincipal(req, { ...env, ACCOUNTS_ENABLED: accounts }, new URL(req.url), T + MINUTE);
      return { p, queries };
    };
    let got = await ask(undefined, made2.token);
    t.ok(got.p.kind === 'admin' && got.p.owner === null && got.queries === 0, `accounts off: Access alone is the owner, owner tools as no account, and no query (${got.p.kind} ${got.queries})`);
    got = await ask('true', made2.token);
    t.ok(got.p.kind === 'admin' && got.p.owner?.id === 'u-direct-owner' && got.queries === 1, `accounts on: both locks in one read (${got.p.kind} ${got.queries})`);
    got = await ask('true', null);
    t.ok(got.p.kind === 'guest' && got.p.refused === 'owner_session' && got.queries === 1, 'no session: a guest marked owner_session, never an admin');
    const denied = principal.requireAdmin({ principal: got.p, now: T });
    t.ok(denied?.status === 403 && (await denied.json()).code === 'owner_session', 'which requireAdmin answers 403 owner_session');
    t.eq(principal.ownerActor({ principal: { kind: 'admin', email: OWNER, owner: { id: 'u-direct-owner' } }, now: 5 }).actor, 'u-direct-owner', "owner tools act as the owner's account in the audit log");
    t.eq(principal.ownerActor({ principal: { kind: 'admin', email: OWNER, owner: null }, now: 5 }).actor, OWNER, 'and as the Access identity while there is none');
    db.close();
  }
  t.report();
}
