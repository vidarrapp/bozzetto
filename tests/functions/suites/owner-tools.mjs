// The owner tools (docs/accounts.md §8, §10): invites, accounts and the
// audit log under /admin/api, behind both locks.
//
// Invites: made with a link shown once, whose token Join takes until the
// invite is used up, past its date or withdrawn; listed with their state;
// refused when asked for what the table's CHECKs refuse. Accounts: the
// list, paged newest first, with what each holds; suspending one (its
// sessions and uploads gone, its holder mailed, its cookies 403
// suspended) and lifting it; signing one out everywhere; its quota; a
// recount after R2 changed under it; finishing a deletion it began; and
// never acting on the owner's own where that would lock the owner out.
// The log: paged newest first, filtered, nothing in it personal, and kept
// to twelve months by the looks at it (X-Test-Now). Every route refused
// without both locks, and from another site; accounts off.
//
// The suite signs in as the `on` server's owner: by an email code when
// the locks suite made one, else by the bootstrap, when it runs alone.
import {
  Browser,
  OWNER,
  asOwner,
  asStranger,
  auditRows,
  bozz,
  codeIn,
  d1,
  glb,
  jpeg,
  migratedDatabase,
  outbox,
  seedCredential,
  seedInvite,
  seedSession,
  seedUser,
  seededToken,
  storedUser,
} from '../lib.mjs';
import { pass } from '../turnstile-fake.mjs';

export const needs = ['on', 'off'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MiB = 1024 * 1024;
/** The suite's own day, for the mail cap and every rate limit; later than any other suite's. */
const T = 3_300_000_000_000;
/** When the bulk accounts were made: after every other account, so they lead the list. */
const FUTURE = 9_000_000_000_000;

/** Twelve months back by the calendar, as the server counts them. */
const cutoff = (now) => {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.getTime();
};
const CUTOFF = cutoff(T + MINUTE);

const MEMBER = 'u-otmember00000000000000000';
const REVOKEE = 'u-otrevokee0000000000000000';
const FIELDS = 'u-otfields00000000000000000';
const RECOUNT = 'u-otrecount0000000000000000';
const DELETING = 'u-otdeleting000000000000000';
const DELNEW = 'u-otdelnew00000000000000000';
const SUSPENDED = 'u-otsuspended00000000000000';
const BULK = 55;
const bulk = (i) => `u-otbulk${String(i).padStart(2, '0')}`;
const STRAY_FRAME = glb({ seed: 71, bin: 900, raw: true });
const DATA = '{"defaults":{},"camera":{},"stages":[],"frames":[]}';
const project = (id, owner, mode = 'model') =>
  `('${id}', '${id}', '${mode}', 4, '${DATA}', 'private', 0, '${owner}', 'users/${owner}/projects/${id}/', ${T - DAY}, ${T - DAY})`;
const PROJECT_COLUMNS = 'id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at';

export const seed = {
  sql: [
    seedUser({ id: MEMBER, handle: 'otmember', at: T - 30 * DAY }),
    seedSession({ name: 'ot-m-main', id: 's-otmmain', user: MEMBER, created: T }),
    seedSession({ name: 'ot-m-other', id: 's-otmother', user: MEMBER, created: T - HOUR, client: 'desktop' }),
    seedUser({ id: REVOKEE, handle: 'otrevokee', at: T - 30 * DAY }),
    seedSession({ name: 'ot-r-1', id: 's-otr1', user: REVOKEE, created: T - HOUR }),
    seedSession({ name: 'ot-r-2', id: 's-otr2', user: REVOKEE, created: T - 2 * HOUR }),
    seedSession({ name: 'ot-r-gone', id: 's-otrgone', user: REVOKEE, created: T - 3 * HOUR, revoked: T - 2 * HOUR }),
    seedSession({ name: 'ot-r-idle', id: 's-otridle', user: REVOKEE, created: T - 40 * DAY }),
    seedUser({ id: FIELDS, handle: 'otfields', quota: 300 * MiB, used: 5000, at: T - 10 * DAY }),
    seedSession({ name: 'ot-f-1', id: 's-otf1', user: FIELDS, created: T - 5 * DAY, lastSeen: T - 2 * HOUR }),
    seedSession({ name: 'ot-f-2', id: 's-otf2', user: FIELDS, created: T - 3 * DAY, lastSeen: T - HOUR, revoked: T - 30 * MINUTE }),
    seedSession({ name: 'ot-f-idle', id: 's-otfidle', user: FIELDS, created: T - 40 * DAY }),
    seedCredential({ credential: { id: 'ot-f-key1', cose: new Uint8Array([165, 1, 2]) }, user: FIELDS }),
    seedCredential({ credential: { id: 'ot-f-key2', cose: new Uint8Array([165, 1, 3]) }, user: FIELDS }),
    `INSERT INTO projects (${PROJECT_COLUMNS}) VALUES ${project('p-otf1', FIELDS, 'scene')}, ${project('p-otf2', FIELDS)};`,
    `INSERT INTO pending_uploads (id, r2_upload_id, project_id, user_id, file, declared_bytes, created_at)
       VALUES ('ot-f-up', 'r2-ot-f-up', 'p-otf1', '${FIELDS}', 'scene.bozz', 4000, ${T - HOUR});`,
    `INSERT INTO upload_parts (upload_id, part, user_id, bytes) VALUES ('ot-f-up', 1, '${FIELDS}', 1234), ('ot-f-up', 2, '${FIELDS}', 766);`,
    seedUser({ id: RECOUNT, handle: 'otrecount', at: T - 20 * DAY }),
    seedSession({ name: 'ot-rc', id: 's-otrc', user: RECOUNT, created: T }),
    `INSERT INTO projects (${PROJECT_COLUMNS}) VALUES ${project('p-otrc1', RECOUNT, 'timelapse')};`,
    // A deletion begun two days ago and left, of 45 projects; another begun an hour ago.
    seedUser({ id: DELETING, handle: 'otdeleting', status: 'deleting', at: T - 5 * DAY }),
    seedSession({ name: 'ot-d', id: 's-otd', user: DELETING, created: T - 3 * DAY }),
    `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 45)
     INSERT INTO projects (${PROJECT_COLUMNS})
     SELECT 'p-otdl' || i, 'P', 'model', 4, '${DATA}', 'private', 0, '${DELETING}', 'users/${DELETING}/projects/p-otdl' || i || '/', ${T} + i, ${T} FROM n;`,
    seedUser({ id: DELNEW, handle: 'otdelnew', status: 'deleting', at: T - HOUR }),
    seedUser({ id: SUSPENDED, handle: 'otsuspended', status: 'suspended', at: T - 50 * DAY }),
    `UPDATE users SET suspended_reason = 'Seeded reason' WHERE id = '${SUSPENDED}';`,
    // Accounts made after every other suite's, three at a time, so the
    // list's first page is theirs and ties are ordered by id.
    ...Array.from({ length: BULK }, (_, i) => seedUser({ id: bulk(i), handle: `otbulk${String(i).padStart(2, '0')}`, at: FUTURE + Math.floor(i / 3) })),
    seedInvite({ id: 'i-otseeded', name: 'ot-seeded', maxUses: 3, created: T - DAY, expires: T + 10 * DAY, label: 'Seeded' }),
    `INSERT INTO audit_log (at, actor, action, subject, detail) VALUES
      (${T - 2 * DAY}, '${DELETING}', 'account.delete', '${DELETING}', '{}'),
      (${T - HOUR}, '${DELNEW}', 'account.delete', '${DELNEW}', '{}'),
      (1000000000000, 'u-x', 'ot.ancient', 'ot-ancient', '{}'),
      (1000000000001, 'u-x', 'ot.ancient', 'ot-ancient', '{}'),
      (1000000000002, 'u-x', 'ot.ancient', 'ot-ancient', '{}'),
      (${T - 300 * DAY}, 'u-x', 'ot.recent', 'ot-recent', '{}'),
      (${CUTOFF - 1}, 'u-x', 'ot.edge', 'ot-edge-old', '{}'),
      (${CUTOFF}, 'u-x', 'ot.edge', 'ot-edge-new', '{}');`,
    // Sixty rows about one subject, four to a millisecond, alternating two actions.
    `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 59)
     INSERT INTO audit_log (at, actor, action, subject, detail)
     SELECT ${T - 1000} + i / 4, 'u-x', CASE WHEN i % 2 = 0 THEN 'ot.alpha' ELSE 'ot.beta' END, 'ot-paged', '{"n":' || i || '}' FROM n;`,
  ].join('\n'),
  r2: [
    { key: `users/${RECOUNT}/projects/p-otrc1/frames/sd/0000.glb`, bytes: STRAY_FRAME, type: 'model/gltf-binary' },
    { key: `users/${DELETING}/projects/p-otdl1/thumb.jpg`, bytes: jpeg(74), type: 'image/jpeg' },
  ],
};

/** The fields of an account in the list, in order. */
const VIEW_KEYS = 'id,handle,email,role,status,createdAt,lastSeenAt,bytesUsed,reserved,quotaBytes,projects,deletingSince,suspendedReason';

export async function run({ checks, on, off, compileShared, repo }) {
  const clock = { now: T + MINUTE };
  let ips = 0;
  const browser = (session) => {
    const b = new Browser(on, { ip: `203.0.113.${100 + (ips++ % 100)}`, clock });
    if (session) b.jar.set('__Host-bz_session', seededToken(session));
    return b;
  };
  /** Every secret the suite is handed or sends: none may ever be in the log. */
  const secrets = new Set();
  const codes = new Set();
  /** Sign in by an email code, as anyone can: the code from the outbox. */
  const signInByCode = async (b, email) => {
    await b.call('POST', '/api/auth/email/start', { json: { email, turnstile: pass('email-code') } });
    const code = codeIn((await outbox(on, email)).at(-1));
    if (code) codes.add(code);
    const r = await b.call('POST', '/api/auth/email/verify', { json: { code } });
    const cookie = b.cookie('__Host-bz_session');
    if (cookie) secrets.add(cookie);
    return r;
  };
  /** The owner, signed in: by the bootstrap when there is no owner yet, else by a code to the owner's address. */
  const ownerSignIn = async () => {
    const b = browser();
    const who = await b.call('GET', '/admin/api/whoami', { headers: asOwner });
    if (who.status === 200 && who.json?.owner === null) {
      const r = await b.call('POST', '/admin/api/owner/bootstrap', {
        headers: asOwner,
        json: { handle: 'theowner', acceptTerms: true, ageConfirmed: true },
      });
      secrets.add(b.cookie('__Host-bz_session'));
      return { b, id: r.json?.user?.id };
    }
    const r = await signInByCode(b, OWNER);
    return { b, id: r.json?.user?.id };
  };
  let owner = await ownerSignIn();
  const admin = (method, path, opts = {}) => owner.b.call(method, path, { ...opts, headers: { ...asOwner, ...opts.headers } });
  const detail = async (id) => (await admin('GET', `/admin/api/users/${id}`)).json;
  const rows = async (user) => (await on.call('GET', `/api/dev/rows?user=${user}`)).json ?? {};
  const objects = async (prefix) => ((await on.call('GET', `/api/dev/r2?prefix=${encodeURIComponent(prefix)}`)).json?.objects ?? []).map((o) => o.key);
  const audited = async (subject, action) => (await auditRows(on, subject)).filter((x) => !action || x.action === action);

  let t = checks('functions: owner tools, signed in as the owner');
  let r = await admin('GET', '/admin/api/whoami');
  t.ok(r.status === 200 && r.json?.owner?.id === owner.id && /^u-/.test(owner.id ?? ''), `Access and the owner's session open /admin/ (${r.status} ${JSON.stringify(r.json)})`);
  t.report();

  // --- the log keeps itself to twelve months --------------------------------------------------
  // First, before anything else looks at the log: the rows seeded long
  // ago are the oldest there, so this look's sweep takes them first.
  t = checks('functions: owner tools, the audit log past twelve months');
  r = await admin('GET', '/admin/api/audit?subject=ot-ancient');
  t.ok(r.status === 200 && Array.isArray(r.json?.rows) && r.json.rows.length === 0, `rows past twelve months are not listed, even before they are swept (${r.status} ${r.json?.rows?.length})`);
  r = await admin('GET', '/admin/api/audit?subject=ot-edge-old');
  const edgeOld = r.json?.rows?.length;
  r = await admin('GET', '/admin/api/audit?subject=ot-edge-new');
  t.ok(edgeOld === 0 && r.json?.rows?.length === 1, `twelve calendar months to the millisecond: a row a millisecond older is not listed, one at the line is (${edgeOld} ${r.json?.rows?.length})`);
  let ancient = [];
  for (let i = 0; i < 40; i++) {
    ancient = await audited('ot-ancient');
    if (ancient.length === 0) break;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  t.eq(ancient.length, 0, 'and after the answer, the look deletes them');
  t.eq((await audited('ot-recent')).length, 1, 'while a row from ten months ago stays');
  t.report();

  // --- both locks, and this site only ---------------------------------------------------------
  t = checks('functions: owner tools, refused without both locks');
  const ROUTES = [
    ['GET', '/admin/api/invites'],
    ['POST', '/admin/api/invites', { json: { label: 'refused' } }],
    ['POST', '/admin/api/invites/i-otseeded/revoke'],
    ['GET', '/admin/api/users'],
    ['GET', `/admin/api/users/${MEMBER}`],
    ['POST', `/admin/api/users/${MEMBER}/suspend`, { json: { reason: 'refused' } }],
    ['POST', `/admin/api/users/${SUSPENDED}/unsuspend`],
    ['POST', `/admin/api/users/${MEMBER}/revoke-sessions`],
    ['PUT', `/admin/api/users/${MEMBER}/quota`, { json: { quotaMiB: 1 } }],
    ['POST', `/admin/api/users/${RECOUNT}/recount`],
    ['POST', `/admin/api/users/${DELETING}/finish-deletion`],
    ['GET', '/admin/api/audit'],
  ];
  const invitesBefore = (await admin('GET', '/admin/api/invites')).json?.invites?.length;
  const ownerToken = owner.b.cookie('__Host-bz_session');
  const memberCookie = `__Host-bz_session=${seededToken('ot-m-main')}`;
  const ownerCookie = `__Host-bz_session=${ownerToken}`;
  const ways = [
    ['with nothing', {}, (x) => x.status === 403],
    ['with Access alone', asOwner, (x) => x.status === 403 && x.json?.code === 'owner_session'],
    ["with Access and a member's session", { ...asOwner, cookie: memberCookie }, (x) => x.status === 403 && x.json?.code === 'owner_session'],
    ["with the owner's session and no Access", { cookie: ownerCookie }, (x) => x.status === 403],
    ["with another identity at Access and the owner's session", { ...asStranger, cookie: ownerCookie }, (x) => x.status === 403],
  ];
  for (const [what, headers, refused] of ways) {
    const missed = [];
    for (const [method, path, opts = {}] of ROUTES) {
      const x = await on.call(method, path, { ...opts, headers: { 'x-test-now': String(clock.now), ...headers } });
      if (!refused(x) || x.headers.get('cache-control') !== 'no-store') missed.push(`${method} ${path} -> ${x.status} ${x.json?.code ?? ''}`);
    }
    t.ok(missed.length === 0, `${what}: every route is 403${missed.length ? ` (not: ${missed.join('; ')})` : ''}`);
  }
  const crossSite = [];
  for (const [method, path, opts = {}] of ROUTES.filter(([m]) => m !== 'GET')) {
    for (const foreign of [{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
      const x = await admin(method, path, { ...opts, headers: foreign });
      if (!(x.status === 403 && x.json?.code === 'cross_site')) crossSite.push(`${method} ${path} ${JSON.stringify(foreign)} -> ${x.status}`);
    }
  }
  t.ok(crossSite.length === 0, `every write from another site is 403 cross_site, the owner's session and Access notwithstanding${crossSite.length ? ` (not: ${crossSite.join('; ')})` : ''}`);
  let m = await detail(MEMBER);
  t.ok(m?.status === 'active' && m?.quotaBytes === 262144000 && m?.sessions === 2, `the member is as it was: active, its quota, its two sessions (${JSON.stringify(m)})`);
  t.ok((await detail(SUSPENDED))?.status === 'suspended' && (await detail(DELETING))?.status === 'deleting' && (await detail(RECOUNT))?.bytesUsed === 0, 'and so is every other target');
  r = await admin('GET', '/admin/api/invites');
  t.ok(r.json?.invites?.length === invitesBefore && r.json?.invites?.find((i) => i.id === 'i-otseeded')?.state === 'live', `no invite was made, and none withdrawn (${invitesBefore} ${r.json?.invites?.length})`);
  t.eq((await auditRows(on, MEMBER)).length, 0, 'and nothing was recorded');
  t.report();

  // --- accounts off -----------------------------------------------------------------------------
  t = checks('functions: owner tools, accounts off');
  const offMissed = [];
  for (const [method, path, opts = {}] of ROUTES.filter(([, p]) => !p.startsWith('/admin/api/audit'))) {
    const x = await off.call(method, path, { ...opts, headers: asOwner });
    if (!(x.status === 404 && x.json?.code === 'accounts_off' && x.headers.get('cache-control') === 'no-store')) offMissed.push(`${method} ${path} -> ${x.status} ${x.json?.code}`);
  }
  t.ok(offMissed.length === 0, `with Access alone, every invite and account route is 404 accounts_off${offMissed.length ? ` (not: ${offMissed.join('; ')})` : ''}`);
  r = await off.call('GET', '/admin/api/audit', { headers: asOwner });
  t.ok(r.status === 200 && Array.isArray(r.json?.rows) && Array.isArray(r.json?.actions), `the audit log answers, as owner tools write to it with accounts off too (${r.status})`);
  r = await off.call('GET', '/admin/api/audit');
  t.eq(r.status, 403, 'to Access only');
  t.report();

  // --- invites ------------------------------------------------------------------------------------
  t = checks('functions: owner tools, making invites');
  const invite = (json) => admin('POST', '/admin/api/invites', json === undefined ? {} : { json });
  const tokenOf = (link) => /\/\?invite=([A-Za-z0-9_-]{22})$/.exec(link ?? '')?.[1] ?? null;
  r = await invite();
  const a = r.json?.invite;
  const aToken = tokenOf(r.json?.link);
  secrets.add(aToken);
  t.ok(r.status === 201 && r.headers.get('cache-control') === 'no-store', `no body at all: 201, uncached (${r.status})`);
  t.ok(r.json?.link === `${owner.b.origin}/?invite=${aToken}` && aToken !== null, `{link}: APP_ORIGIN/?invite= and a 16-byte token (${r.json?.link})`);
  t.eq(JSON.stringify(a), JSON.stringify({ id: a?.id, label: '', maxUses: 1, uses: 0, createdAt: clock.now, expiresAt: clock.now + 14 * DAY, revokedAt: null, state: 'live' }), '{invite}: one use, 14 days, no label, live');
  t.ok(/^i-[0-9a-hjkmnp-tv-z]{26}$/.test(a?.id ?? ''), `an invite id is i- and 128 random bits (${a?.id})`);
  r = await invite({ label: '  Workshop\n\tgroup  ', maxUses: 2, expiresInDays: 30 });
  const b2 = r.json?.invite;
  const bToken = tokenOf(r.json?.link);
  secrets.add(bToken);
  t.ok(r.status === 201 && b2?.label === 'Workshop group' && b2?.maxUses === 2 && b2?.expiresAt === clock.now + 30 * DAY, `a label, made one line; two uses; 30 days (${JSON.stringify(b2)})`);
  r = await invite({ expiresInDays: 1, maxUses: null, label: null });
  const c = r.json?.invite;
  const cToken = tokenOf(r.json?.link);
  secrets.add(cToken);
  t.ok(r.status === 201 && c?.maxUses === 1 && c?.label === '' && c?.expiresAt === clock.now + DAY, `null is the default too (${JSON.stringify(c)})`);
  r = await invite({ label: 'To withdraw', maxUses: 5 });
  const d = r.json?.invite;
  const dToken = tokenOf(r.json?.link);
  secrets.add(dToken);
  for (const [json, why] of [
    [{ maxUses: 500, expiresInDays: 90, label: 'y'.repeat(100) }, 'the most of each'],
    [{ maxUses: 1, expiresInDays: 1 }, 'the least of each'],
  ]) {
    r = await invite(json);
    secrets.add(tokenOf(r.json?.link));
    t.ok(r.status === 201 && r.json?.invite?.maxUses === json.maxUses, `${why}: 201 (${r.status} ${JSON.stringify(r.json?.invite)})`);
  }
  const counted = (await admin('GET', '/admin/api/invites')).json?.invites?.length;
  for (const [json, reason] of [
    [{ maxUses: 0 }, 'maxUses'],
    [{ maxUses: 501 }, 'maxUses'],
    [{ maxUses: 1.5 }, 'maxUses'],
    [{ maxUses: '3' }, 'maxUses'],
    [{ maxUses: -1 }, 'maxUses'],
    [{ expiresInDays: 0 }, 'expiresInDays'],
    [{ expiresInDays: 91 }, 'expiresInDays'],
    [{ expiresInDays: 2.5 }, 'expiresInDays'],
    [{ expiresInDays: true }, 'expiresInDays'],
    [{ label: 7 }, 'label'],
    [{ label: 'x'.repeat(101) }, 'label'],
  ]) {
    r = await invite(json);
    t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.reason === reason, `${JSON.stringify(json).slice(0, 40)}: 400 bad_request {reason: ${reason}} (${r.status} ${r.json?.code} ${r.json?.reason})`);
  }
  r = await admin('POST', '/admin/api/invites', { body: JSON.stringify({}), type: 'text/plain' });
  t.ok(r.status === 415 && r.json?.code === 'bad_type', `a body that is not application/json: 415 bad_type (${r.status} ${r.json?.code})`);
  t.eq((await admin('GET', '/admin/api/invites')).json?.invites?.length, counted, 'and none of those made an invite');
  r = await admin('GET', '/admin/api/invites');
  const listed = r.json?.invites ?? [];
  t.ok(r.status === 200 && listed[0]?.createdAt >= listed.at(-1)?.createdAt && [a?.id, b2?.id, c?.id, d?.id].every((id) => listed.some((i) => i.id === id)), `the list has them, newest first (${listed.length})`);
  t.eq(Object.keys(listed[0] ?? {}).join(','), 'id,label,maxUses,uses,createdAt,expiresAt,revokedAt,state', 'each {id, label, maxUses, uses, createdAt, expiresAt, revokedAt, state}');
  const listText = JSON.stringify(r.json);
  t.ok(![aToken, bToken, cToken, dToken].some((tok) => listText.includes(tok)), 'and no token is ever in it');
  const made = await audited(a?.id, 'invite.create');
  t.ok(made.length === 1 && made[0].actor === owner.id && JSON.stringify(made[0].detail) === JSON.stringify({ maxUses: 1, expiresInDays: 14 }), `audited as the owner, with its terms (${JSON.stringify(made[0])})`);
  t.ok(!JSON.stringify(await audited(b2?.id)).includes('Workshop'), 'and never its label');
  t.report();

  // --- an invite's link, through Join ------------------------------------------------------------
  t = checks("functions: owner tools, an invite's link through Join");
  const check = (tok) => browser().call('POST', '/api/auth/invite/check', { json: { invite: tok } });
  let joined = 0;
  /** Join with an invite token, as the app does with the link's: the start, then the code from the outbox. */
  const join = async (tok) => {
    const b = browser();
    const handle = `otjoiner${++joined}`;
    const email = `${handle}@example.com`;
    const start = await b.call('POST', '/api/auth/register/start', {
      json: { invite: tok, handle, email, acceptTerms: true, ageConfirmed: true, turnstile: pass('register') },
    });
    if (start.status !== 202) return start;
    const code = codeIn((await outbox(on, email)).at(-1));
    codes.add(code);
    const done = await b.call('POST', '/api/auth/register/verify', { json: { code } });
    secrets.add(b.cookie('__Host-bz_session'));
    return done;
  };
  r = await check(aToken);
  t.ok(r.status === 200 && r.json?.expiresAt === a?.expiresAt, `the link's token is a live invite (${r.status} ${JSON.stringify(r.json)})`);
  r = await join(aToken);
  const joiner = r.json?.user;
  t.ok(r.status === 201 && joiner?.role === 'member', `and makes an account (${r.status} ${JSON.stringify(joiner)})`);
  t.eq((await storedUser(on, { id: joiner?.id }))?.invite_id, a?.id, 'which names the invite');
  r = await admin('GET', '/admin/api/invites');
  let item = r.json?.invites?.find((i) => i.id === a?.id);
  t.ok(item?.uses === 1 && item?.state === 'used', `used once of once: state used (${JSON.stringify(item)})`);
  r = await check(aToken);
  t.ok(r.status === 410 && r.json?.code === 'invite_invalid', `and its token admits nobody more (${r.status} ${r.json?.code})`);
  r = await join(aToken);
  t.ok(r.status === 410 && r.json?.code === 'invite_invalid', `Join refuses it (${r.status} ${r.json?.code})`);
  r = await join(bToken);
  const second = await join(bToken);
  const third = await join(bToken);
  item = (await admin('GET', '/admin/api/invites')).json?.invites?.find((i) => i.id === b2?.id);
  t.ok(r.status === 201 && second.status === 201 && third.status === 410 && item?.uses === 2 && item?.state === 'used', `two uses take two accounts, and the third is refused (${r.status} ${second.status} ${third.status} ${JSON.stringify(item)})`);
  t.report();

  t = checks('functions: owner tools, withdrawing an invite');
  r = await admin('POST', `/admin/api/invites/${d?.id}/revoke`);
  const revoked = r.json;
  t.ok(r.status === 200 && revoked?.state === 'revoked' && revoked?.revokedAt === clock.now && revoked?.id === d?.id && revoked?.uses === 0, `200, the invite withdrawn now (${r.status} ${JSON.stringify(revoked)})`);
  r = await check(dToken);
  t.ok(r.status === 410 && r.json?.code === 'invite_invalid', `its token admits nobody (${r.status})`);
  r = await join(dToken);
  t.ok(r.status === 410 && r.json?.code === 'invite_invalid', `Join refuses it (${r.status})`);
  clock.now += MINUTE;
  r = await admin('POST', `/admin/api/invites/${d?.id}/revoke`);
  t.ok(r.status === 200 && r.json?.revokedAt === revoked?.revokedAt && r.json?.state === 'revoked', `withdrawing it again changes nothing (${r.status} ${r.json?.revokedAt})`);
  const withdrawn = await audited(d?.id, 'invite.revoke');
  t.ok(withdrawn.length === 1 && withdrawn[0].actor === owner.id, `and is recorded once (${withdrawn.length})`);
  r = await admin('POST', '/admin/api/invites/i-nosuchinvite/revoke');
  t.ok(r.status === 404 && r.json?.code === 'not_found', `an invite that is not there: 404 not_found (${r.status} ${r.json?.code})`);
  r = await check(cToken);
  t.eq(r.status, 200, 'a one-day invite admits someone within its day');
  t.report();

  // --- the accounts list ---------------------------------------------------------------------------
  t = checks('functions: owner tools, the accounts list');
  const expectedBulk = Array.from({ length: BULK }, (_, i) => ({ id: bulk(i), at: FUTURE + Math.floor(i / 3) })).sort((x, y) => y.at - x.at || (x.id < y.id ? 1 : -1));
  r = await admin('GET', '/admin/api/users');
  const first = r.json;
  t.ok(r.status === 200 && r.headers.get('cache-control') === 'no-store' && Array.isArray(first?.users) && typeof first?.pendingDeletions === 'number', `200 {users, next, pendingDeletions}, uncached (${r.status} ${Object.keys(first ?? {}).join(',')})`);
  t.ok(first?.users?.length === 50 && typeof first?.next === 'string', `50 a page, with a cursor for the next (${first?.users?.length} ${first?.next})`);
  t.eq(first?.users?.map((u) => u.id).join(','), expectedBulk.slice(0, 50).map((u) => u.id).join(','), 'newest first, and by id among accounts made at the same moment');
  t.eq(Object.keys(first?.users?.[0] ?? {}).join(','), VIEW_KEYS, `each {${VIEW_KEYS}}`);
  r = await admin('GET', `/admin/api/users?cursor=${encodeURIComponent(first?.next)}`);
  t.eq(r.json?.users?.slice(0, 5).map((u) => u.id).join(','), expectedBulk.slice(50).map((u) => u.id).join(','), 'the next page goes on where the first ended');
  const walk = async (limit) => {
    const all = [];
    const sizes = [];
    let cursor = null;
    for (let i = 0; i < 200; i++) {
      const page = (await admin('GET', `/admin/api/users?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)).json;
      all.push(...(page?.users ?? []));
      sizes.push(page?.users?.length);
      cursor = page?.next;
      if (!cursor) break;
    }
    return { all, sizes };
  };
  const bySeven = await walk(7);
  const byFifty = await walk(50);
  const ordered = bySeven.all.every((u, i, list) => i === 0 || list[i - 1].createdAt > u.createdAt || (list[i - 1].createdAt === u.createdAt && list[i - 1].id > u.id));
  t.ok(ordered && new Set(bySeven.all.map((u) => u.id)).size === bySeven.all.length, `seven at a time: in order, none twice (${bySeven.all.length} in ${bySeven.sizes.length} pages)`);
  t.ok(bySeven.all.map((u) => u.id).join() === byFifty.all.map((u) => u.id).join() && bySeven.sizes.slice(0, -1).every((n) => n === 7), `the same accounts as fifty at a time, every page full but the last (${byFifty.all.length})`);
  t.ok([MEMBER, FIELDS, RECOUNT, DELETING, owner.id].every((id) => bySeven.all.some((u) => u.id === id)), 'the owner among them');
  const listedFields = bySeven.all.find((u) => u.id === FIELDS);
  const fieldsView = {
    id: FIELDS,
    handle: 'otfields',
    email: 'otfields@example.com',
    role: 'member',
    status: 'active',
    createdAt: T - 10 * DAY,
    lastSeenAt: T - HOUR,
    bytesUsed: 5000,
    reserved: 2000,
    quotaBytes: 300 * MiB,
    projects: 2,
    deletingSince: null,
    suspendedReason: null,
  };
  t.eq(JSON.stringify(listedFields), JSON.stringify(fieldsView), 'an account: its address, when last seen by any session, stored and reserved bytes, quota, projects');
  r = await admin('GET', `/admin/api/users/${FIELDS}`);
  t.ok(r.status === 200 && JSON.stringify(r.json) === JSON.stringify({ ...fieldsView, passkeys: 2, sessions: 1 }), `one account adds its passkeys and its good sessions (${JSON.stringify(r.json)})`);
  t.ok((await detail(DELETING))?.deletingSince === T - 2 * DAY && (await detail(DELNEW))?.deletingSince === T - HOUR, 'a deletion under way says when it began');
  const sus = await detail(SUSPENDED);
  t.ok(sus?.status === 'suspended' && sus?.suspendedReason === 'Seeded reason', `a suspension, its reason (${JSON.stringify(sus)})`);
  r = await admin('GET', '/admin/api/users/u-nosuchaccount');
  t.ok(r.status === 404 && r.json?.code === 'not_found', `an account that is not there: 404 not_found (${r.status} ${r.json?.code})`);
  for (const [query, reason] of [
    ['cursor=nonsense', 'cursor'],
    ['cursor=12.', 'cursor'],
    ['cursor=.u-x', 'cursor'],
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['limit=ten', 'limit'],
  ]) {
    r = await admin('GET', `/admin/api/users?${query}`);
    t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.reason === reason, `?${query}: 400 bad_request {reason: ${reason}} (${r.status} ${r.json?.reason})`);
  }
  t.report();

  // --- suspending -----------------------------------------------------------------------------------
  t = checks('functions: owner tools, suspending an account');
  const member = browser('ot-m-main');
  const other = browser('ot-m-other');
  const scene = (await member.call('POST', '/api/me/projects', { json: { title: 'Head', mode: 'scene' } })).json?.id;
  const file = bozz({ vertices: 30, seed: 72 });
  const up = (await member.call('POST', `/api/me/projects/${scene}/scene`, { json: { size: file.length } })).json;
  r = await member.call('PUT', `/api/me/projects/${scene}/scene?upload=${up?.uploadId}&part=1`, { bytes: file });
  m = await detail(MEMBER);
  t.ok(r.status === 201 && m?.reserved === file.length && m?.sessions === 2, `the member has an upload under way and two sessions (${r.status} ${m?.reserved} ${m?.sessions})`);
  const suspend = (id, json) => admin('POST', `/admin/api/users/${id}/suspend`, { json });
  for (const [json, why] of [
    [{}, 'no reason'],
    [{ reason: '  \n ' }, 'a blank one'],
    [{ reason: 5 }, 'a number'],
    [{ reason: 'x'.repeat(501) }, 'one over 500 characters'],
  ]) {
    r = await suspend(MEMBER, json);
    t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.reason === 'reason', `${why}: 400 bad_request {reason: reason} (${r.status} ${r.json?.reason})`);
  }
  r = await suspend(owner.id, { reason: 'Myself' });
  t.ok(r.status === 409 && r.json?.code === 'owner', `the owner's own account: 409 owner (${r.status} ${r.json?.code})`);
  r = await suspend(DELNEW, { reason: 'Too late' });
  t.ok(r.status === 409 && r.json?.code === 'wrong_status' && r.json?.status === 'deleting', `one being deleted: 409 wrong_status {status} (${r.status} ${JSON.stringify(r.json)})`);
  r = await suspend('u-nosuchaccount', { reason: 'Nobody' });
  t.eq(r.status, 404, 'one that is not there: 404');
  t.eq((await detail(MEMBER))?.status, 'active', 'and the member is still active');
  r = await suspend(MEMBER, { reason: '  Spam in\ttitles ' });
  const suspended = r.json;
  t.ok(r.status === 200 && suspended?.status === 'suspended' && suspended?.suspendedReason === 'Spam in titles' && suspended?.sessions === 0 && suspended?.reserved === 0, `200, the account as it is now: suspended, its reason, no session, nothing reserved (${r.status} ${JSON.stringify(suspended)})`);
  r = await member.call('GET', '/api/me');
  const otherMe = await other.call('GET', '/api/me');
  t.ok(r.status === 403 && r.json?.code === 'suspended' && otherMe.status === 403 && otherMe.json?.code === 'suspended', `its sessions' next requests: 403 suspended (${r.status} ${r.json?.code}, ${otherMe.status} ${otherMe.json?.code})`);
  r = await member.call('GET', '/api/me/projects');
  t.ok(r.status === 403 && r.json?.code === 'suspended', `on every route that wants the account (${r.status} ${r.json?.code})`);
  r = await member.call('PUT', `/api/me/projects/${scene}/scene?upload=${up?.uploadId}&part=1`, { bytes: file });
  t.eq(r.status, 403, 'its upload goes no further');
  const left = await rows(MEMBER);
  t.ok(left.pendingUploads === 0 && left.uploadParts === 0 && left.projects === 1 && left.users === 1, `its uploads are given up, its work kept (${JSON.stringify(left)})`);
  const told = (await outbox(on, 'otmember@example.com')).at(-1);
  t.ok(told?.subject === 'Your Bozzetto account is suspended' && told?.body?.includes('The reason given: Spam in titles'), `its holder is mailed the reason (${told?.subject})`);
  const susRows = await audited(MEMBER, 'account.suspend');
  t.ok(susRows.length === 1 && susRows[0].actor === owner.id && !JSON.stringify(susRows).includes('Spam'), `audited as the owner, without the reason (${JSON.stringify(susRows)})`);
  r = await suspend(MEMBER, { reason: 'Again' });
  t.ok(r.status === 409 && r.json?.code === 'wrong_status' && r.json?.status === 'suspended', `suspending it again: 409 wrong_status (${r.status} ${r.json?.status})`);
  r = await browser().call('POST', '/api/auth/email/start', { json: { email: 'otmember@example.com', turnstile: pass('email-code') } });
  t.ok(r.status === 202 && (await outbox(on, 'otmember@example.com')).at(-1)?.id === told?.id, `asking for a code: the same 202, and no code (${r.status})`);
  t.report();

  t = checks('functions: owner tools, lifting a suspension');
  r = await admin('POST', `/admin/api/users/${MEMBER}/unsuspend`);
  t.ok(r.status === 200 && r.json?.status === 'active' && r.json?.suspendedReason === null && r.json?.sessions === 0, `200, active again, the reason cleared, still signed out (${r.status} ${JSON.stringify(r.json)})`);
  r = await member.call('GET', '/api/me');
  t.ok(r.status === 401 && r.json?.code === 'signin', `its old cookie asks to sign in again (${r.status} ${r.json?.code})`);
  const back = browser();
  r = await signInByCode(back, 'otmember@example.com');
  const meAgain = await back.call('GET', '/api/me');
  t.ok(r.status === 200 && meAgain.status === 200 && meAgain.json?.id === MEMBER, `which it can (${r.status} ${meAgain.status})`);
  r = await admin('POST', `/admin/api/users/${MEMBER}/unsuspend`);
  t.ok(r.status === 409 && r.json?.code === 'wrong_status' && r.json?.status === 'active', `lifting it again: 409 wrong_status (${r.status} ${r.json?.status})`);
  r = await admin('POST', `/admin/api/users/${SUSPENDED}/unsuspend`);
  t.ok(r.status === 200 && r.json?.status === 'active', `a seeded suspension lifts too (${r.status})`);
  t.eq((await audited(MEMBER, 'account.unsuspend')).length, 1, 'audited once');
  t.report();

  // --- signing out everywhere ------------------------------------------------------------------------
  t = checks('functions: owner tools, signing an account out everywhere');
  r = await admin('POST', `/admin/api/users/${REVOKEE}/revoke-sessions`);
  t.ok(r.status === 200 && JSON.stringify(r.json) === JSON.stringify({ revoked: 2 }), `{revoked: 2}: its two good sessions, not the revoked or the idle one (${r.status} ${JSON.stringify(r.json)})`);
  r = await browser('ot-r-1').call('GET', '/api/me');
  t.ok(r.status === 401 && r.json?.code === 'signin', `they ask to sign in again (${r.status} ${r.json?.code})`);
  t.eq((await detail(REVOKEE))?.sessions, 0, 'and none is good');
  r = await admin('POST', `/admin/api/users/${REVOKEE}/revoke-sessions`);
  t.eq(r.json?.revoked, 0, 'again: none to revoke');
  t.ok((await audited(REVOKEE, 'account.revoke_sessions')).every((x) => x.actor === owner.id), 'audited as the owner');
  r = await admin('POST', `/admin/api/users/${owner.id}/revoke-sessions`);
  t.ok(r.status === 409 && r.json?.code === 'owner', `the owner's own: 409 owner (${r.status} ${r.json?.code})`);
  r = await admin('GET', '/admin/api/whoami');
  t.eq(r.status, 200, 'and the owner is still signed in');
  r = await admin('POST', '/admin/api/users/u-nosuchaccount/revoke-sessions');
  t.eq(r.status, 404, 'an account that is not there: 404');
  t.report();

  // --- the quota ----------------------------------------------------------------------------------------
  t = checks("functions: owner tools, an account's quota");
  const quota = (id, json) => admin('PUT', `/admin/api/users/${id}/quota`, { json });
  r = await quota(MEMBER, { quotaMiB: 500 });
  t.ok(r.status === 200 && r.json?.quotaBytes === 500 * MiB && r.json?.id === MEMBER, `500 MiB: 200, the account with its new quota (${r.status} ${r.json?.quotaBytes})`);
  r = await back.call('GET', '/api/me');
  t.eq(r.json?.usage?.quota, 500 * MiB, 'which the account sees');
  let qRows = await audited(MEMBER, 'account.quota');
  t.ok(qRows.length === 1 && qRows[0].actor === owner.id && JSON.stringify(qRows[0].detail) === JSON.stringify({ from: 262144000, to: 500 * MiB }), `audited from the old to the new, in bytes (${JSON.stringify(qRows[0]?.detail)})`);
  r = await quota(MEMBER, { quotaMiB: 500 });
  qRows = await audited(MEMBER, 'account.quota');
  t.ok(r.status === 200 && qRows.length === 1, `the same again: 200, and nothing recorded (${qRows.length})`);
  for (const value of [0, 102401, 1.5, '500', -5, null, true]) {
    r = await quota(MEMBER, { quotaMiB: value });
    t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.reason === 'quotaMiB', `${JSON.stringify(value)}: 400 bad_request {reason: quotaMiB} (${r.status} ${r.json?.reason})`);
  }
  r = await quota(MEMBER, {});
  t.ok(r.status === 400 && r.json?.reason === 'quotaMiB', `none: the same (${r.status})`);
  r = await admin('PUT', `/admin/api/users/${MEMBER}/quota`, { body: '{"quotaMiB": 9}', type: 'text/plain' });
  t.ok(r.status === 415 && r.json?.code === 'bad_type', `not application/json: 415 (${r.status})`);
  const lo = await quota(MEMBER, { quotaMiB: 1 });
  const hi = await quota(MEMBER, { quotaMiB: 102400 });
  t.ok(lo.json?.quotaBytes === MiB && hi.json?.quotaBytes === 102400 * MiB, `1 MiB and 100 GiB are the bounds (${lo.json?.quotaBytes} ${hi.json?.quotaBytes})`);
  await quota(MEMBER, { quotaMiB: 250 });
  t.eq((await detail(MEMBER))?.quotaBytes, 262144000, 'and back to 250 MiB');
  const ownQuota = (await detail(owner.id))?.quotaBytes;
  r = await quota(owner.id, { quotaMiB: ownQuota / MiB });
  t.ok(r.status === 200 && r.json?.quotaBytes === ownQuota, `the owner's own quota may be set (${r.status} ${r.json?.quotaBytes})`);
  r = await quota('u-nosuchaccount', { quotaMiB: 10 });
  t.eq(r.status, 404, 'an account that is not there: 404');
  t.report();

  // --- a recount ------------------------------------------------------------------------------------------
  t = checks("functions: owner tools, recounting an account's storage");
  const thumb = jpeg(73, 1200);
  r = await browser('ot-rc').call('POST', '/api/me/projects/p-otrc1/thumb', { bytes: thumb });
  const counted0 = (await detail(RECOUNT))?.bytesUsed;
  t.ok(r.status === 201 && counted0 === thumb.length, `a thumbnail through the API is counted; the frame put into R2 directly is not (${r.status} ${counted0})`);
  r = await admin('POST', `/admin/api/users/${RECOUNT}/recount`);
  t.ok(r.status === 200 && JSON.stringify(r.json) === JSON.stringify({ bytesUsed: thumb.length + STRAY_FRAME.length, before: thumb.length }), `{bytesUsed, before}: R2's count now, and the old one (${r.status} ${JSON.stringify(r.json)})`);
  t.eq((await detail(RECOUNT))?.bytesUsed, thumb.length + STRAY_FRAME.length, 'the account holds it');
  r = await browser('ot-rc').call('GET', '/api/me/projects');
  t.eq(r.json?.find?.((p) => p.id === 'p-otrc1')?.bytes, thumb.length + STRAY_FRAME.length, 'and so does the project');
  const rc = await audited(RECOUNT, 'account.recount');
  t.ok(rc.length === 1 && rc[0].actor === owner.id && JSON.stringify(rc[0].detail) === JSON.stringify({ before: thumb.length, after: thumb.length + STRAY_FRAME.length }), `audited with both (${JSON.stringify(rc[0]?.detail)})`);
  r = await admin('POST', '/admin/api/users/u-nosuchaccount/recount');
  t.eq(r.status, 404, 'an account that is not there: 404');
  t.report();

  // --- finishing a deletion --------------------------------------------------------------------------------
  t = checks('functions: owner tools, finishing a deletion');
  const pending0 = (await admin('GET', '/admin/api/users')).json?.pendingDeletions;
  t.ok(pending0 >= 1, `the deletion begun two days ago is flagged (${pending0})`);
  const finish = (id) => admin('POST', `/admin/api/users/${id}/finish-deletion`);
  r = await finish(MEMBER);
  t.ok(r.status === 409 && r.json?.code === 'wrong_status' && r.json?.status === 'active', `an active account: 409 wrong_status (${r.status} ${JSON.stringify(r.json)})`);
  r = await finish(owner.id);
  t.ok(r.status === 409 && r.json?.code === 'owner', `the owner's own: 409 owner (${r.status} ${r.json?.code})`);
  r = await finish('u-nosuchaccount');
  t.eq(r.status, 404, 'one that is not there: 404');
  t.eq((await objects(`users/${DELETING}/`)).length, 1, 'the account left behind 45 projects and a file');
  const answers = [];
  for (let i = 0; i < 6; i++) {
    r = await finish(DELETING);
    answers.push(r.json);
    if (r.json?.done) break;
  }
  t.ok(answers[0]?.done === false && answers[0]?.remaining > 0 && answers.at(-1)?.done === true && answers.at(-1)?.remaining === 0, `{done: false, remaining} until {done: true} (${JSON.stringify(answers)})`);
  t.ok((await storedUser(on, { id: DELETING })) === null && (await objects(`users/${DELETING}/`)).length === 0, 'the account and its files are gone');
  const gone = await rows(DELETING);
  t.ok(gone.users === 0 && gone.projects === 0 && gone.sessions === 0, `with every row of it (${JSON.stringify(gone)})`);
  const dl = await audited(DELETING);
  const steps = dl.filter((x) => x.action === 'account.finish_deletion');
  t.ok(steps.length === answers.length && steps.every((x, i) => x.actor === owner.id && x.detail.done === answers[i].done && x.detail.remaining === answers[i].remaining), `each call audited as the owner, with where it got to (${steps.length})`);
  t.ok(dl.some((x) => x.action === 'account.deleted' && x.actor === owner.id), "and the end names the owner as who finished it");
  r = await finish(DELETING);
  t.ok(r.status === 404 && r.json?.code === 'not_found', `once done: 404 (${r.status})`);
  r = await on.call('GET', '/api/auth/handle?h=otdeleting');
  t.eq(r.json?.reason, 'retired', 'its handle is held');
  const pending1 = (await admin('GET', '/admin/api/users')).json?.pendingDeletions;
  t.eq(pending1, pending0 - 1, 'one deletion fewer is flagged');
  t.report();

  // --- the audit log ------------------------------------------------------------------------------------------
  t = checks('functions: owner tools, the audit log');
  const log = (query = '') => admin('GET', `/admin/api/audit${query ? `?${query}` : ''}`);
  r = await log('subject=ot-paged');
  const p1 = r.json;
  t.ok(r.status === 200 && r.headers.get('cache-control') === 'no-store' && p1?.rows?.length === 50 && typeof p1?.next === 'string', `50 a page, with a cursor for the next (${r.status} ${p1?.rows?.length} ${p1?.next})`);
  t.eq(Object.keys(p1?.rows?.[0] ?? {}).join(','), 'id,at,actor,action,subject,detail', 'each {id, at, actor, action, subject, detail}');
  t.ok(typeof p1?.rows?.[0]?.detail === 'object' && p1.rows[0].detail.n === 59, `detail as the object it was written as, the newest first (${JSON.stringify(p1?.rows?.[0])})`);
  r = await log(`subject=ot-paged&before=${encodeURIComponent(p1?.next)}`);
  const p2 = r.json;
  const both = [...(p1?.rows ?? []), ...(p2?.rows ?? [])];
  const inOrder = both.every((x, i) => i === 0 || both[i - 1].at > x.at || (both[i - 1].at === x.at && both[i - 1].id > x.id));
  t.ok(p2?.rows?.length === 10 && p2?.next === null && inOrder && new Set(both.map((x) => x.id)).size === 60, `the next page has the other 10, newest first and by id within a millisecond, none twice, and no cursor after (${p2?.rows?.length} ${p2?.next})`);
  t.eq(both.map((x) => x.detail.n).join(','), Array.from({ length: 60 }, (_, i) => 59 - i).join(','), 'which is the order they were written in, backwards');
  const seven = [];
  let before = null;
  for (let i = 0; i < 20; i++) {
    const page = (await log(`subject=ot-paged&limit=7${before ? `&before=${encodeURIComponent(before)}` : ''}`)).json;
    seven.push(...(page?.rows ?? []));
    before = page?.next;
    if (!before) break;
  }
  t.eq(seven.map((x) => x.id).join(), both.map((x) => x.id).join(), 'seven at a time: the same rows');
  r = await log('subject=ot-paged&action=ot.alpha');
  t.ok(r.json?.rows?.length === 30 && r.json.rows.every((x) => x.action === 'ot.alpha' && x.subject === 'ot-paged'), `filtered by action and subject (${r.json?.rows?.length})`);
  r = await log('action=account.suspend');
  t.ok(r.json?.rows?.length >= 1 && r.json.rows.every((x) => x.action === 'account.suspend') && r.json.rows.some((x) => x.subject === MEMBER && x.actor === owner.id), `by action alone (${r.json?.rows?.length})`);
  const actions = r.json?.actions ?? [];
  t.ok(['account.suspend', 'invite.create', 'ot.alpha', 'ot.beta'].every((x) => actions.includes(x)) && actions.every((x, i) => i === 0 || actions[i - 1] < x) && !actions.includes('ot.ancient'), `{actions}: every action the log holds, once each, in order, none past twelve months (${actions.length})`);
  r = await log('subject=nothing-at-all');
  t.ok(r.status === 200 && r.json?.rows?.length === 0 && r.json?.next === null, 'a subject with no rows: none');
  for (const [query, reason] of [
    ['before=nonsense', 'before'],
    ['before=12.u-x', 'before'],
    ['limit=0', 'limit'],
    ['limit=500', 'limit'],
    [`action=${'a'.repeat(200)}`, 'action'],
    [`subject=${'s'.repeat(200)}`, 'subject'],
  ]) {
    r = await log(query);
    t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.reason === reason, `?${query.slice(0, 24)}: 400 bad_request {reason: ${reason}} (${r.status} ${r.json?.reason})`);
  }
  t.report();

  // --- later: an invite's day, and a deletion left a day -----------------------------------------------------
  t = checks('functions: owner tools, a day later');
  clock.now = T + DAY + 2 * MINUTE;
  r = await check(cToken);
  t.ok(r.status === 410 && r.json?.code === 'invite_invalid', `a one-day invite admits nobody after its day (${r.status})`);
  r = await join(cToken);
  t.eq(r.status, 410, 'Join refuses it');
  item = (await admin('GET', '/admin/api/invites')).json?.invites?.find((i) => i.id === c?.id);
  t.eq(item?.state, 'expired', 'and the list says it expired');
  t.eq((await admin('GET', '/admin/api/users')).json?.pendingDeletions, pending1 + 1, 'the deletion begun an hour before is flagged once it is a day old');
  t.report();

  // --- nothing personal in the log ------------------------------------------------------------------------------
  t = checks('functions: owner tools, nothing personal in the log');
  const written = [];
  before = null;
  for (let i = 0; i < 500; i++) {
    const page = (await log(`limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`)).json;
    written.push(...(page?.rows ?? []).filter((x) => x.at >= T));
    before = page?.next;
    if (!before) break;
  }
  const kinds = new Set(written.map((x) => x.action));
  const expected = ['invite.create', 'invite.revoke', 'user.register', 'session.signin', 'account.suspend', 'account.unsuspend', 'account.revoke_sessions', 'account.quota', 'account.recount', 'account.finish_deletion', 'account.deleted'];
  t.ok(expected.every((x) => kinds.has(x)), `the rows this suite wrote: ${written.length}, of every kind (${[...kinds].join(', ')})`);
  const text = JSON.stringify(written);
  t.ok(!text.includes('@'), 'no address anywhere in them');
  t.ok(!/bz1_|Spam in titles|Workshop|To withdraw|Seeded reason/.test(text), 'no session token, suspension reason or invite label');
  const values = written.flatMap((x) => [x.actor, x.subject, ...Object.values(x.detail)]);
  const tokenish = values.filter(
    (v) =>
      (typeof v === 'string' && ([...secrets].some((s) => s && v.includes(s)) || [...codes].some((s) => s && v.includes(s)) || /^[A-Za-z0-9_-]{22}$|[A-Za-z0-9_-]{40,}|[0-9a-f]{64}|^\d{6}$/.test(v))) ||
      (typeof v === 'number' && codes.has(String(v).padStart(6, '0')) && v < 1e6),
  );
  t.ok(tokenish.length === 0 && secrets.size >= 8 && codes.size >= 4, `nothing shaped like a token, a code or a hash, and none of the ${secrets.size} secrets and ${codes.size} codes the suite saw (${JSON.stringify(tokenish)})`);
  t.report();

  // --- twelve months on ----------------------------------------------------------------------------------------------
  t = checks('functions: owner tools, the log twelve months on');
  clock.now = T + 70 * DAY;
  owner = await ownerSignIn();
  let recent = [];
  for (let i = 0; i < 40; i++) {
    r = await log('subject=ot-recent');
    recent = await audited('ot-recent');
    if (recent.length === 0) break;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  t.ok(r.status === 200 && r.json?.rows?.length === 0 && recent.length === 0, `seventy days on, the row from ten months before is past twelve months: not listed, and deleted (${r.status} ${recent.length})`);
  t.ok((await audited(MEMBER, 'account.suspend')).length === 1, "while this suite's own rows stay");
  t.report();

  // --- directly: the sweep ---------------------------------------------------------------------------------------------
  t = checks('functions: owner tools, the sweep directly');
  const db = await migratedDatabase(repo);
  if (!db) {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the direct checks did not run');
  } else {
    const auditMod = await (await compileShared())('auth/audit');
    const now = Date.UTC(2031, 6, 15, 12);
    const line = auditMod.auditCutoff(now);
    t.ok(line === Date.UTC(2030, 6, 15, 12) && auditMod.auditCutoff(Date.UTC(2028, 1, 29)) === Date.UTC(2027, 2, 1), 'twelve months back by the calendar, a leap day landing on the 1st of March');
    // 600 rows past it, written newest first, so ids and times run opposite ways.
    const insert = db.prepare("INSERT INTO audit_log (at, actor, action, subject, detail) VALUES (?, 'u-x', 'old', 'x', '{}')");
    for (let i = 600; i >= 1; i--) insert.run(line - i);
    insert.run(line);
    insert.run(now);
    const env = { DB: d1(db) };
    const left = () => db.prepare('SELECT COUNT(*) AS n, MIN(at) AS oldest FROM audit_log WHERE at < ?').get(line);
    const n1 = await auditMod.sweepAudit(env, now);
    const after1 = left();
    t.ok(n1 === 500 && after1.n === 100 && after1.oldest === line - 100, `a look deletes 500, the oldest by time (${n1}, ${after1.n} left from ${line - after1.oldest} ms before the line)`);
    const n2 = await auditMod.sweepAudit(env, now);
    const n3 = await auditMod.sweepAudit(env, now);
    t.ok(n2 === 100 && n3 === 0 && left().n === 0, `the next the rest, then none (${n2} ${n3})`);
    t.eq(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n, 2, 'the row on the line and the new one stay');
    db.close();
  }
  t.report();
}
