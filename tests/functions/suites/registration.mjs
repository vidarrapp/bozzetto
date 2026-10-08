// Invites and registration (docs/accounts.md §3 steps 1-5, §6): checking
// an invite (live, used up, revoked, expired, unknown); Join's start and
// everything it refuses - the terms and age boxes, the handle's rules, the
// address, the invite, Turnstile failing or out of reach; the code and the
// account it makes (the cookie, the user row, the audit row, the invite's
// use); an address that has an account getting a notice instead of a
// code, under the same answer; a raced last use of an invite; an invite
// that expires before the code is typed; a handle taken meanwhile, kept
// flow and all; the link. Then Turnstile asked directly: no secret, the
// loopback-only verify URL, an outage, Cloudflare's test secrets.
import { createServer } from 'node:net';
import {
  Browser,
  auditRows,
  codeIn,
  inviteToken,
  linkIn,
  outbox,
  seedInvite,
  seedUser,
  setCookies,
  storedUser,
  workerLog,
} from '../lib.mjs';
import { pass, startTurnstileFake } from '../turnstile-fake.mjs';

export const needs = ['on'];

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The suite's own day, for the mail cap. */
const T = 2_200_000_000_000;

const INVITES = {
  open: { id: 'i-rgopen', name: 'rg-open', maxUses: 50, expires: T + 14 * DAY },
  two: { id: 'i-rgtwo', name: 'rg-two', maxUses: 2, expires: T + 14 * DAY },
  single: { id: 'i-rgsingle', name: 'rg-single', maxUses: 1, expires: T + 14 * DAY },
  usedUp: { id: 'i-rgusedup', name: 'rg-usedup', maxUses: 2, uses: 2, expires: T + 14 * DAY },
  revoked: { id: 'i-rgrevoked', name: 'rg-revoked', maxUses: 5, expires: T + 14 * DAY, revoked: T - DAY },
  expired: { id: 'i-rgexpired', name: 'rg-expired', maxUses: 5, expires: T - 1 },
  soon: { id: 'i-rgsoon', name: 'rg-soon', maxUses: 5, expires: T + 5 * HOUR + 5 * MINUTE },
};
const token = (key) => inviteToken(INVITES[key].name);

export const seed = {
  sql: [
    ...Object.values(INVITES).map((i) => seedInvite({ ...i, created: T - DAY })),
    seedUser({ id: 'u-rgtaken000000000000000000000', handle: 'rgtaken', email: 'rgtaken@example.com' }),
    `INSERT INTO retired_handles (handle, until) VALUES ('rgretired', ${T + 30 * DAY});`,
  ].join('\n'),
};

export async function run({ checks, on, turnstile, compileShared }) {
  const clock = { now: T };
  let ips = 0;
  const browser = () => new Browser(on, { ip: `192.0.2.${10 + (ips++ % 40)}`, clock });
  const at = (offset) => {
    clock.now = T + offset;
  };
  const check = (b, invite) => b.call('POST', '/api/auth/invite/check', { json: { invite } });
  let n = 0;
  /** Join's start, with everything right unless `over` says otherwise. */
  const join = (b, over = {}) =>
    b.call('POST', '/api/auth/register/start', {
      json: {
        invite: token('open'),
        handle: `rgperson${++n}`,
        email: `rgperson${n}@example.com`,
        acceptTerms: true,
        ageConfirmed: true,
        turnstile: pass('register'),
        ...over,
      },
    });
  const verify = (b, code, extra = {}) => b.call('POST', '/api/auth/register/verify', { json: { code, ...extra } });
  const last = async (address) => (await outbox(on, address)).at(-1);

  // --- invite checks ------------------------------------------------------------------
  let t = checks('functions: POST /api/auth/invite/check');
  let r = await check(browser(), token('open'));
  t.ok(r.status === 200 && JSON.stringify(r.json) === JSON.stringify({ expiresAt: INVITES.open.expires }) && r.headers.get('cache-control') === 'no-store', `a live invite: 200 {expiresAt}, uncached (${r.status} ${JSON.stringify(r.json)})`);
  for (const [invite, why] of [
    [token('usedUp'), 'used up'],
    [token('revoked'), 'revoked'],
    [token('expired'), 'expired'],
    [inviteToken('nobody made this one'), 'unknown'],
    ['short', 'not an invite token'],
    [undefined, 'missing'],
  ]) {
    r = await check(browser(), invite);
    t.ok(r.status === 410 && r.json?.code === 'invite_invalid', `${why}: 410 invite_invalid (${r.status} ${r.json?.code})`);
  }
  t.report();

  // --- Join, refused ---------------------------------------------------------------------
  t = checks('functions: Join refused');
  const refusedAddresses = [];
  const refusedJoin = (over) => {
    const r2 = join(browser(), over);
    refusedAddresses.push(over.email ?? `rgperson${n}@example.com`);
    return r2;
  };
  const seenBefore = turnstile.requests.length;
  for (const [over, why] of [
    [{ acceptTerms: undefined }, 'the terms not accepted'],
    [{ ageConfirmed: false }, 'the age box not ticked'],
    [{ acceptTerms: 'true', ageConfirmed: 'true' }, 'either one anything but true'],
  ]) {
    r = await refusedJoin(over);
    t.ok(r.status === 400 && r.json?.code === 'bad_request', `${why}: 400 bad_request (${r.status} ${r.json?.code})`);
  }
  for (const [handle, reason] of [
    ['ab', 'format'],
    ['no spaces', 'format'],
    ['-dash', 'format'],
    ['Admin', 'reserved'],
  ]) {
    r = await refusedJoin({ handle });
    t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.reason === reason, `the handle ${JSON.stringify(handle)}: 400, reason ${reason} (${r.status} ${r.json?.code} ${r.json?.reason})`);
  }
  r = await refusedJoin({ email: 'not an address' });
  t.ok(r.status === 400 && r.json?.code === 'bad_request', `an address that is not one: 400 (${r.status} ${r.json?.code})`);
  r = await refusedJoin({ link: 1 });
  t.ok(r.status === 400 && r.json?.code === 'bad_request', `link anything but true or false: 400 (${r.status} ${r.json?.code})`);
  t.eq(turnstile.requests.length - seenBefore, 0, 'what the body itself gets wrong is refused before Turnstile is asked, and spends no token');
  for (const [handle, reason] of [
    ['RGTaken', 'taken'],
    ['rgretired', 'retired'],
  ]) {
    r = await refusedJoin({ handle });
    t.ok(r.status === 409 && r.json?.code === 'handle_taken' && r.json?.reason === reason, `the handle ${JSON.stringify(handle)}: 409 handle_taken, reason ${reason} (${r.status} ${r.json?.code} ${r.json?.reason})`);
  }
  for (const [key, why] of [
    ['usedUp', 'used up'],
    ['revoked', 'revoked'],
    ['expired', 'expired'],
  ]) {
    r = await refusedJoin({ invite: token(key) });
    t.ok(r.status === 410 && r.json?.code === 'invite_invalid', `an invite ${why}: 410 invite_invalid (${r.status} ${r.json?.code})`);
  }
  r = await refusedJoin({ invite: 'nonsense' });
  t.ok(r.status === 410 && r.json?.code === 'invite_invalid', `no invite at all: 410 (${r.status} ${r.json?.code})`);
  for (const [turnstileToken, status, code, why] of [
    [undefined, 403, 'turnstile', 'no Turnstile token'],
    ['nope', 403, 'turnstile', 'a token siteverify refuses'],
    [pass('email-code'), 403, 'turnstile', 'a token for the email-code action'],
    ['pass-other-action', 403, 'turnstile', 'a token for another action'],
    ['pass-other-host:register', 403, 'turnstile', 'a token made on another host'],
    ['down', 503, 'turnstile_down', 'siteverify out of reach'],
  ]) {
    const before = turnstile.requests.length;
    r = await refusedJoin({ turnstile: turnstileToken });
    t.ok(r.status === status && r.json?.code === code, `${why}: ${status} ${code} (${r.status} ${r.json?.code})`);
    if (turnstileToken === 'down') {
      const tries = turnstile.requests.slice(before);
      t.ok(tries.length === 2 && tries[0].idempotency_key === tries[1].idempotency_key, `an outage is tried twice, under one idempotency key (${tries.length})`);
    }
  }
  const asked = turnstile.requests.filter((q) => q.response === pass('register')).at(-1);
  t.ok(asked?.secret === 'test' && asked?.type === 'application/x-www-form-urlencoded', `siteverify is sent TURNSTILE_SECRET, as a form (${asked?.type})`);
  t.ok(/^192\.0\.2\.\d+$/.test(asked?.remoteip ?? '') && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(asked?.idempotency_key ?? ''), `with the visitor's IP as remoteip, and a UUID as idempotency_key (${asked?.remoteip} ${asked?.idempotency_key})`);
  const mailed = (await Promise.all(refusedAddresses.map((x) => outbox(on, x)))).flat();
  t.eq(mailed.length, 0, `and none of the ${refusedAddresses.length} refused mailed anything`);
  t.report();

  // --- Join ---------------------------------------------------------------------------
  t = checks('functions: Join, the code and the account');
  at(HOUR);
  const a = browser();
  r = await join(a, { invite: token('two'), handle: 'RgNewbie', email: 'RgNewbie@Example.com' });
  const flow = setCookies(r).find((c) => c.name === '__Host-bz_flow');
  t.ok(r.status === 202 && JSON.stringify(r.json) === JSON.stringify({ expiresAt: clock.now + 10 * MINUTE, resendAfter: 60, resendsLeft: 2 }), `202 {expiresAt, resendAfter: 60, resendsLeft: 2} (${r.status} ${JSON.stringify(r.json)})`);
  t.ok(flow?.attrs.samesite === 'Strict' && flow?.attrs['max-age'] === '900' && flow?.attrs.httponly === true, 'with __Host-bz_flow');
  const row = await last('rgnewbie@example.com');
  const code = codeIn(row);
  t.ok(code !== null && !/link=/.test(row?.body ?? ''), `the code is mailed to the address, lower-cased (${row?.subject})`);
  r = await verify(a, String((Number(code) + 1) % 1e6).padStart(6, '0'));
  t.ok(r.status === 400 && r.json?.code === 'code_invalid' && r.json?.attemptsLeft === 4, `a wrong code: 400 code_invalid (${r.status} ${r.json?.code} ${r.json?.attemptsLeft})`);
  at(HOUR + 3 * MINUTE);
  r = await verify(a, code, { client: 'desktop' });
  const user = r.json?.user;
  const set = Object.fromEntries(setCookies(r).map((c) => [c.name, c]));
  t.ok(r.status === 201 && /^u-[0-9a-z]{26}$/.test(user?.id ?? '') && user?.handle === 'rgnewbie' && user?.role === 'member' && user?.status === 'active', `the right one: 201 {user}, a member, the handle lower-cased (${r.status} ${JSON.stringify(user)})`);
  t.eq(JSON.stringify(user?.usage), JSON.stringify({ used: 0, reserved: 0, quota: 262144000 }), 'with nothing stored and the member quota');
  t.ok(/^bz1_/.test(set['__Host-bz_session']?.value ?? '') && set['__Host-bz_session']?.attrs.samesite === 'Lax' && set['__Host-bz_flow']?.attrs['max-age'] === '0', 'signed in, the flow cookie cleared');
  r = await a.call('GET', '/api/me');
  t.ok(r.status === 200 && r.json?.id === user?.id, `GET /api/me knows the new account (${r.status})`);
  const acc = (await a.call('GET', '/api/me/account')).json;
  t.ok(acc?.email === 'rgnewbie@example.com' && acc?.termsVersion === '2026-10-08' && acc?.passkeys?.length === 0 && acc?.createdAt === clock.now, `the account: the address, the terms version in force, no passkey yet (${acc?.email} ${acc?.termsVersion})`);
  t.ok(acc?.sessions?.length === 1 && acc.sessions[0].method === 'email' && acc.sessions[0].client === 'desktop' && acc.sessions[0].current, `one session, signed in by 'email', the desktop's (${JSON.stringify(acc?.sessions?.[0])})`);
  const stored = await storedUser(on, { id: user?.id });
  t.ok(stored?.terms_version === '2026-10-08' && stored?.terms_accepted_at === clock.now && stored?.age_confirmed_at === clock.now && stored?.invite_id === INVITES.two.id, `the row: the terms and the age confirmed as the account was made, and the invite (${stored?.terms_accepted_at === clock.now} ${stored?.invite_id})`);
  t.ok(stored?.email === 'rgnewbie@example.com' && stored?.quota_bytes === 262144000 && stored?.bytes_used === 0 && stored?.handle_changed_at === null && /^[A-Za-z0-9_-]{43}$/.test(stored?.webauthn_user_id ?? ''), 'the address lower-cased, the member quota, and a user handle of 32 random bytes for its passkeys');
  const rows = await auditRows(on, user?.id);
  t.ok(rows.length === 1 && rows[0].action === 'user.register' && rows[0].detail.invite === INVITES.two.id && rows[0].detail.method === 'email' && rows[0].detail.client === 'desktop' && rows[0].detail.session === acc?.sessions?.[0]?.id, `audited as user.register (${JSON.stringify(rows[0]?.detail)})`);
  t.ok(!JSON.stringify(rows).includes('@') && !JSON.stringify(rows).includes(code), 'with no address and no code in it');
  r = await a.call('POST', '/api/me/passkeys/options', { json: {} });
  t.eq(r.status, 200, 'the new session counts as recent, so a passkey can be offered at once');
  a.jar.set('__Host-bz_flow', flow?.value);
  r = await verify(a, code);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `the code again: 410, it made one account (${r.status} ${r.json?.code})`);
  r = await check(browser(), token('two'));
  t.eq(r.status, 200, 'the invite was used once of twice: it still admits');
  const second = browser();
  await join(second, { invite: token('two'), handle: 'rgsecond', email: 'rgsecond@example.com' });
  r = await verify(second, codeIn(await last('rgsecond@example.com')));
  t.ok(r.status === 201 && r.json?.user?.handle === 'rgsecond', `a second registration with it (${r.status})`);
  r = await check(browser(), token('two'));
  t.ok(r.status === 410 && r.json?.code === 'invite_invalid', `and then it is used up (${r.status} ${r.json?.code})`);
  r = await join(browser(), { invite: token('two') });
  t.eq(r.status, 410, 'Join refuses it too');
  t.report();

  // --- an address that has an account ------------------------------------------------
  t = checks('functions: Join with an address that has an account');
  at(2 * HOUR);
  const fresh = browser();
  const answerFresh = await join(fresh, { handle: 'rgnotaken', email: 'rgnobody@example.com' });
  const taken = browser();
  r = await join(taken, { handle: 'rgalsofree', email: 'RGTaken@example.com' });
  t.ok(r.status === 202 && JSON.stringify(r.json) === JSON.stringify(answerFresh.json) && setCookies(r).some((c) => c.name === '__Host-bz_flow' && c.attrs['max-age'] === '900'), `the same 202 and flow cookie as any address (${r.status} ${JSON.stringify(r.json)})`);
  let mails = await outbox(on, 'rgtaken@example.com');
  t.ok(mails.length === 1 && mails[0].subject === 'You already have a Bozzetto account' && codeIn(mails[0]) === null && !/\d{3} \d{3}/.test(mails[0].body), `no code: the notice that the address has an account (${mails.map((m) => m.subject).join('; ')})`);
  t.ok(mails[0]?.body.includes(`${taken.origin}/?signin`), 'pointing at sign-in');
  r = await verify(taken, '000000');
  t.ok(r.status === 400 && r.json?.code === 'code_invalid', `no code typed can complete it (${r.status} ${r.json?.code})`);
  at(2 * HOUR + MINUTE);
  r = await taken.call('POST', '/api/auth/email/resend', { json: { turnstile: pass('email-code') } });
  mails = await outbox(on, 'rgtaken@example.com');
  t.ok(r.status === 202 && mails.length === 2 && mails.every((m) => codeIn(m) === null), `a resend sends the notice again, still no code (${r.status} ${mails.length})`);
  t.report();

  // --- a raced last use -------------------------------------------------------------------
  t = checks('functions: the last use of an invite, raced for');
  at(3 * HOUR);
  const racers = [browser(), browser()];
  const codes = [];
  for (const [i, b] of racers.entries()) {
    r = await join(b, { invite: token('single'), handle: `rgracer${i}`, email: `rgracer${i}@example.com` });
    t.eq(r.status, 202, `the ${i ? 'second' : 'first'} begins while the invite admits someone`);
    codes.push(codeIn(await last(`rgracer${i}@example.com`)));
  }
  const raced = await Promise.all(racers.map((b, i) => verify(b, codes[i])));
  const statuses = raced.map((x) => `${x.status} ${x.json?.code ?? ''}`.trim()).sort();
  t.eq(statuses.join(', '), '201, 410 invite_invalid', 'typed at the same moment: one account is made, the other is 410 invite_invalid');
  const made = await Promise.all([0, 1].map((i) => storedUser(on, { email: `rgracer${i}@example.com` })));
  t.eq(made.filter(Boolean).length, 1, 'and exactly one account exists');
  r = await check(browser(), token('single'));
  t.eq(r.status, 410, 'the invite is used up');
  const loser = racers[raced.findIndex((x) => x.status === 410)];
  t.ok(loser && setCookies(raced.find((x) => x.status === 410)).some((c) => c.name === '__Host-bz_flow' && c.attrs['max-age'] === '0'), 'the flow that lost is over, its cookie cleared');
  t.report();

  // --- an invite that runs out before the code is typed -------------------------------
  t = checks('functions: an invite expiring between the start and the code');
  at(5 * HOUR);
  const late = browser();
  r = await join(late, { invite: token('soon'), handle: 'rglate', email: 'rglate@example.com' });
  t.eq(r.status, 202, 'begun five minutes before the invite expires');
  const lateFlow = late.cookie('__Host-bz_flow');
  at(5 * HOUR + 6 * MINUTE);
  r = await verify(late, codeIn(await last('rglate@example.com')));
  t.ok(r.status === 410 && r.json?.code === 'invite_invalid', `the code typed after it expired: 410 invite_invalid (${r.status} ${r.json?.code})`);
  late.jar.set('__Host-bz_flow', lateFlow);
  r = await verify(late, codeIn(await last('rglate@example.com')));
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `and the flow is gone with it (${r.status} ${r.json?.code})`);
  t.ok((await storedUser(on, { email: 'rglate@example.com' })) === null, 'no account was made');
  t.report();

  // --- a handle taken meanwhile ----------------------------------------------------------
  t = checks('functions: a handle taken between the start and the code');
  at(6 * HOUR);
  const first = browser();
  const slow = browser();
  await join(first, { handle: 'rgsame', email: 'rgsame1@example.com' });
  r = await join(slow, { handle: 'rgsame', email: 'rgsame2@example.com' });
  t.eq(r.status, 202, 'two Joins may ask for the same free handle');
  r = await verify(first, codeIn(await last('rgsame1@example.com')));
  t.ok(r.status === 201 && r.json?.user?.handle === 'rgsame', `the first to type its code gets it (${r.status})`);
  const slowCode = codeIn(await last('rgsame2@example.com'));
  r = await verify(slow, slowCode);
  t.ok(r.status === 409 && r.json?.code === 'handle_taken' && r.json?.reason === 'taken', `the second: 409 handle_taken (${r.status} ${r.json?.code} ${r.json?.reason})`);
  t.ok(!setCookies(r).some((c) => c.name === '__Host-bz_flow'), 'and its flow is kept');
  r = await verify(slow, slowCode, { handle: 'mod' });
  t.ok(r.status === 400 && r.json?.reason === 'reserved', `another handle with the same code is checked too: reserved, 400 (${r.status} ${r.json?.reason})`);
  r = await verify(slow, slowCode, { handle: 'RgSame' });
  t.ok(r.status === 409 && r.json?.reason === 'taken', `in any capitals (${r.status} ${r.json?.reason})`);
  r = await verify(slow, slowCode, { handle: 'RgOther' });
  t.ok(r.status === 201 && r.json?.user?.handle === 'rgother', `a free one completes it with the same code (${r.status} ${r.json?.user?.handle})`);
  t.report();

  // --- the link ----------------------------------------------------------------------------
  t = checks('functions: Join by the link');
  at(7 * HOUR);
  const desk = browser();
  r = await join(desk, { handle: 'rglinked', email: 'rglinked@example.com', link: true });
  const linkMail = await last('rglinked@example.com');
  t.ok(r.status === 202 && linkIn(linkMail) !== null, `link: true mails a link beside the code (${r.status})`);
  r = await browser().call('POST', '/api/auth/email/link', { json: { token: linkIn(linkMail) } });
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `another browser gets nothing from it (${r.status} ${r.json?.code})`);
  r = await desk.call('POST', '/api/auth/email/link', { json: { token: linkIn(linkMail) } });
  t.ok(r.status === 201 && r.json?.user?.handle === 'rglinked', `in the browser that asked, it makes the account: 201 {user} (${r.status} ${JSON.stringify(r.json?.user)})`);
  const linked = (await desk.call('GET', '/api/me/account')).json?.sessions?.find((s) => s.current);
  t.eq(linked?.method, 'link', "signed in by 'link'");
  t.report();

  // --- the log ------------------------------------------------------------------------
  t = checks('functions: registration, no address in the log');
  const log = workerLog(on).toLowerCase();
  const leaked = ['rgnewbie@', 'rgsecond@', 'rgtaken@', 'rgracer0@', 'rgracer1@', 'rglate@', 'rgsame1@', 'rgsame2@', 'rglinked@', 'rgnobody@'].filter((x) => log.includes(x));
  t.ok(leaked.length === 0, `no address a registration used is in the server's log (${leaked.join(', ') || 'none'})`);
  t.report();

  // --- Turnstile, directly --------------------------------------------------------------
  t = checks('functions: Turnstile, directly');
  const { verifyTurnstile } = await (await compileShared())('auth/turnstile');
  const local = 'http://localhost:8788/api/auth/register/start';
  const deployed = 'https://bozzetto.example/api/auth/register/start';
  const request = (url, ip = '198.51.100.250') => new Request(url, { method: 'POST', headers: { 'cf-connecting-ip': ip } });
  const outcome = async (env, url, opts = {}) => {
    try {
      await verifyTurnstile(env, request(url), { token: 'pass:register', action: 'register', ...opts });
      return 'passed';
    } catch (err) {
      return `${err.status} ${err.code}`;
    }
  };
  const { error, warn } = console;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  console.warn = console.error;
  const realFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ success: true, hostname: 'bozzetto.example', action: 'register' }), { headers: { 'content-type': 'application/json' } });
    };
    t.eq(await outcome({}, local, { token: undefined }), 'passed', 'no TURNSTILE_SECRET on a loopback host: every check passes, token or not');
    t.eq(calls.length, 0, 'and siteverify is not asked');
    t.eq(await outcome({}, deployed), '503 not_configured', 'no TURNSTILE_SECRET anywhere else: 503 not_configured, never a quiet pass');
    const prod = { TURNSTILE_SECRET: 'real-secret', APP_ORIGIN: 'https://bozzetto.example', TURNSTILE_VERIFY_URL: 'http://127.0.0.1:9/fake' };
    t.eq(await outcome(prod, deployed), 'passed', 'a good token on a deployed host passes');
    t.ok(calls.at(-1)?.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify', `TURNSTILE_VERIFY_URL is ignored off loopback: Cloudflare's siteverify is asked (${calls.at(-1)?.url})`);
    const form = new URLSearchParams(calls.at(-1)?.body);
    t.ok(form.get('secret') === 'real-secret' && form.get('response') === 'pass:register' && form.get('remoteip') === '198.51.100.250' && /^[0-9a-f-]{36}$/.test(form.get('idempotency_key') ?? ''), `with secret, response, remoteip and idempotency_key (${[...form.keys()].join(', ')})`);
    t.eq(await outcome(prod, deployed, { action: 'email-code' }), '403 turnstile', 'the answer must name the action the route expects');
    t.eq(await outcome({ ...prod, APP_ORIGIN: 'https://other.example' }, deployed), '403 turnstile', 'and APP_ORIGIN\'s host');
    t.eq(await outcome({ TURNSTILE_SECRET: 'real-secret' }, deployed), '503 not_configured', 'without APP_ORIGIN there is no host to hold it to: 503 not_configured');
    t.eq(await outcome(prod, deployed, { token: 'x'.repeat(2049) }), '403 turnstile', 'a token longer than Turnstile makes is refused unasked');
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') });
      return new Response(JSON.stringify({ success: true, hostname: 'example.com', action: 'test' }), { headers: { 'content-type': 'application/json' } });
    };
    t.eq(await outcome({ ...prod, TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' }, deployed), 'passed', "Cloudflare's test secret: success alone is asked, since its dummy answer names neither host nor action (staging)");
    t.eq(await outcome(prod, deployed), '403 turnstile', 'which a real secret would refuse');
    t.ok(logged.some((l) => /test secrets/.test(l)), 'and a test secret off loopback is logged as keeping nobody out');
    globalThis.fetch = async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-secret'] }), { headers: { 'content-type': 'application/json' } });
    t.eq(await outcome(prod, deployed), '503 not_configured', 'a secret Cloudflare refuses is our misconfiguration: 503 not_configured');
    globalThis.fetch = realFetch;
    // A port nothing listens on: siteverify out of reach.
    const closed = await new Promise((ok) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const { port } = s.address();
        s.close(() => ok(port));
      });
    });
    t.eq(await outcome({ TURNSTILE_SECRET: 'test', APP_ORIGIN: 'http://localhost:8788', TURNSTILE_VERIFY_URL: `http://127.0.0.1:${closed}/siteverify` }, local), '503 turnstile_down', 'siteverify unreachable: 503 turnstile_down');
    const fake = await startTurnstileFake();
    try {
      const env = { TURNSTILE_SECRET: 'test', APP_ORIGIN: 'http://localhost:8788', TURNSTILE_VERIFY_URL: fake.url };
      t.eq(await outcome(env, local), 'passed', 'on loopback, TURNSTILE_VERIFY_URL is asked instead');
      t.eq(fake.requests.length, 1, 'once, for a good token');
      t.eq(await outcome(env, local, { token: 'down' }), '503 turnstile_down', 'an error status from it: 503 turnstile_down');
      t.ok(fake.requests.length === 3 && fake.requests[1].idempotency_key === fake.requests[2].idempotency_key, 'after one more try under the same idempotency key');
      t.eq(await outcome(env, local, { idempotencyKey: '7b0f6d0e-0c55-4b5e-9c34-0d5cfa8a9d1e' }), 'passed', 'a key the caller has is used');
      t.eq(fake.requests.at(-1)?.idempotency_key, '7b0f6d0e-0c55-4b5e-9c34-0d5cfa8a9d1e', 'as given');
    } finally {
      await fake.close();
    }
  } finally {
    globalThis.fetch = realFetch;
    console.error = error;
    console.warn = warn;
  }
  t.report();
}
