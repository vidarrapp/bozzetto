// The rate limits of docs/accounts.md §3 that come with email and invites,
// over HTTP on the X-Test-Now clock: mail per IP (10 an hour) and per
// address (3 per 15 minutes, 10 a day), code checks per IP (30 per 10
// minutes; the 5 per code are the codes suite's), registrations per IP (5
// an hour), invite checks per IP (20 an hour), each a 429 rate_limited
// with Retry-After and `retryAfter` until its window ends; and all mail,
// 90 per UTC day, then 503 mail_paused until midnight UTC, for an address
// with no account as for one with. Passkey options and handle checks (60
// per 10 minutes each) are the ratelimit suite's.
import { Browser, inviteToken, outbox, seedInvite, seedUser } from '../lib.mjs';
import { pass } from '../turnstile-fake.mjs';

export const needs = ['on'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Midnight UTC of the suite's first day; the cap is checked on the next, which nothing else mails on. */
const DAY0 = Math.floor(2_400_000_000_000 / DAY) * DAY;
const DAY1 = DAY0 + DAY;
const CAPPED = 31;

const capUser = (i) => `lmcap${String(i).padStart(2, '0')}`;

export const seed = {
  sql: [
    seedUser({ id: 'u-lmaddress000000000000000000', handle: 'lmaddress' }),
    ...Array.from({ length: CAPPED }, (_, i) => seedUser({ id: `u-${capUser(i)}00000000000000000000`, handle: capUser(i) })),
    seedInvite({ id: 'i-lmopen', name: 'lm-open', maxUses: 100, expires: DAY0 + 30 * DAY }),
  ].join('\n'),
};

/** The status, code and Retry-After of an answer, as one line. */
const said = (r) => `${r.status} ${r.json?.code ?? ''} ${r.headers.get('retry-after') ?? ''}`.trim();

export async function run({ checks, on }) {
  const clock = { now: DAY0 };
  let ips = 0;
  /** A browser from an address no other check uses. */
  const fresh = () => new Browser(on, { ip: `192.0.2.${100 + (ips++ % 100)}`, clock });
  const start = (b, email) => b.call('POST', '/api/auth/email/start', { json: { email, turnstile: pass('email-code') } });

  // --- mail per IP ----------------------------------------------------------------------
  let t = checks('functions: mail per IP, 10 an hour');
  clock.now = DAY0 + HOUR + 20 * MINUTE;
  const one = fresh();
  const answers = [];
  for (let i = 0; i < 10; i++) answers.push((await start(one, `lm-ip-${i}@example.com`)).status);
  t.ok(answers.every((s) => s === 202), `ten mails asked for from one IP in an hour: answered (${[...new Set(answers)].join(', ')})`);
  let r = await start(one, 'lm-ip-10@example.com');
  t.ok(r.status === 429 && r.json?.code === 'rate_limited' && r.json?.retryAfter === 2400 && r.headers.get('retry-after') === '2400', `the eleventh: 429 rate_limited, Retry-After until the hour ends (${said(r)} ${r.json?.retryAfter})`);
  t.eq((await start(fresh(), 'lm-ip-10@example.com')).status, 202, 'another IP is not held to it');
  clock.now = DAY0 + 2 * HOUR;
  t.eq((await start(one, 'lm-ip-11@example.com')).status, 202, 'and the next hour starts afresh');
  t.report();

  // --- mail per address ------------------------------------------------------------------
  t = checks('functions: mail per address, 3 per 15 minutes and 10 a day');
  const address = 'lmaddress@example.com';
  clock.now = DAY0 + 3 * HOUR + 5 * MINUTE;
  const sent = [];
  for (let i = 0; i < 3; i++) sent.push((await start(fresh(), address)).status);
  r = await start(fresh(), address);
  t.ok(sent.every((s) => s === 202) && r.status === 429 && r.json?.retryAfter === 600 && r.headers.get('retry-after') === '600', `three to one address in 15 minutes, from three IPs; the fourth: 429, Retry-After until the window ends (${sent.join(', ')}; ${said(r)})`);
  t.eq((await outbox(on, address)).length, 3, 'three codes mailed, no fourth');
  r = await start(fresh(), 'LMAddress@Example.com');
  t.eq(r.status, 429, 'the address in other capitals is the same address');
  const later = [];
  for (const [offset, count] of [
    [20, 3],
    [35, 3],
    [50, 1],
  ]) {
    clock.now = DAY0 + 3 * HOUR + offset * MINUTE;
    for (let i = 0; i < count; i++) later.push((await start(fresh(), address)).status);
  }
  t.ok(later.every((s) => s === 202), `three more in each of the next two windows and one in the third: ten in the day (${later.join(', ')})`);
  r = await start(fresh(), address);
  t.ok(r.status === 429 && r.json?.retryAfter === (DAY - 3 * HOUR - 50 * MINUTE) / 1000, `the eleventh in the day: 429, Retry-After until midnight UTC (${said(r)})`);
  t.eq((await outbox(on, address)).length, 10, 'ten mails in all');
  const unknown = [];
  clock.now = DAY0 + 4 * HOUR;
  for (let i = 0; i < 4; i++) unknown.push(said(await start(fresh(), 'lm-nobody@example.com')));
  t.eq(unknown.join(' | '), '202 | 202 | 202 | 429 rate_limited 900', 'an address with no account is held to the same count, so a 429 tells nobody it has one');
  t.report();

  // --- code checks ------------------------------------------------------------------------
  t = checks('functions: code checks per IP, 30 per 10 minutes');
  clock.now = DAY0 + 5 * HOUR + 3 * MINUTE;
  const checker = fresh();
  const checked = [];
  for (let i = 0; i < 30; i++) checked.push((await checker.call('POST', '/api/auth/email/verify', { json: { code: '123456' } })).status);
  t.ok(checked.every((s) => s === 410), `thirty checks from one IP in 10 minutes are answered (${[...new Set(checked)].join(', ')})`);
  for (const [path, body] of [
    ['/api/auth/email/verify', { code: '123456' }],
    ['/api/auth/register/verify', { code: '123456' }],
    ['/api/auth/email/link', { token: 'A'.repeat(43) }],
  ]) {
    r = await checker.call('POST', path, { json: body });
    t.ok(r.status === 429 && r.json?.code === 'rate_limited' && r.headers.get('retry-after') === '420', `then ${path}: 429, Retry-After until the window ends (${said(r)})`);
  }
  r = await fresh().call('POST', '/api/auth/email/verify', { json: { code: '123456' } });
  t.eq(r.status, 410, 'another IP is not held to it');
  t.report();

  // --- registrations -----------------------------------------------------------------------
  t = checks('functions: registrations per IP, 5 an hour');
  clock.now = DAY0 + 6 * HOUR + 30 * MINUTE;
  const joiner = fresh();
  const join = (b, i, invite = inviteToken('lm-gone')) =>
    b.call('POST', '/api/auth/register/start', {
      json: { invite, handle: `lmjoin${i}`, email: `lmjoin${i}@example.com`, acceptTerms: true, ageConfirmed: true, turnstile: pass('register') },
    });
  const joined = [];
  for (let i = 0; i < 5; i++) joined.push(said(await join(joiner, i)));
  t.ok(joined.every((s) => s === '410 invite_invalid'), `five Joins from one IP in an hour are answered, a dead invite and all (${[...new Set(joined)].join(', ')})`);
  r = await join(joiner, 5, inviteToken('lm-open'));
  t.ok(r.status === 429 && r.json?.code === 'rate_limited' && r.headers.get('retry-after') === '1800', `the sixth, with a good invite: 429, Retry-After until the hour ends (${said(r)})`);
  r = await join(joiner, 6, 'x');
  t.ok(r.status === 429, `still refused (${said(r)})`);
  t.eq((await join(fresh(), 7, inviteToken('lm-open'))).status, 202, 'another IP is not held to it');
  t.report();

  // --- invite checks -------------------------------------------------------------------------
  t = checks('functions: invite checks per IP, 20 an hour');
  clock.now = DAY0 + 7 * HOUR + 45 * MINUTE;
  const prober = fresh();
  const probes = [];
  for (let i = 0; i < 20; i++) probes.push((await prober.call('POST', '/api/auth/invite/check', { json: { invite: inviteToken(`lm-guess-${i}`) } })).status);
  t.ok(probes.every((s) => s === 410), `twenty checks from one IP in an hour are answered (${[...new Set(probes)].join(', ')})`);
  r = await prober.call('POST', '/api/auth/invite/check', { json: { invite: inviteToken('lm-open') } });
  t.ok(r.status === 429 && r.json?.code === 'rate_limited' && r.json?.retryAfter === 900 && r.headers.get('retry-after') === '900', `the twenty-first, even for a good invite: 429, Retry-After until the hour ends (${said(r)})`);
  t.eq((await fresh().call('POST', '/api/auth/invite/check', { json: { invite: inviteToken('lm-open') } })).status, 200, 'another IP is not held to it');
  t.report();

  // --- all mail -------------------------------------------------------------------------------
  t = checks('functions: all mail, 90 per UTC day');
  clock.now = DAY1 + 10 * HOUR;
  const statuses = [];
  // 30 accounts, 3 mails each, 10 from each of 9 IPs: within every other limit.
  const senders = Array.from({ length: 9 }, () => fresh());
  for (let i = 0; i < 90; i++) statuses.push((await start(senders[Math.floor(i / 10)], `${capUser(i % 30)}@example.com`)).status);
  t.ok(statuses.every((s) => s === 202), `ninety mails in one day are sent (${[...new Set(statuses)].join(', ')})`);
  t.eq((await outbox(on, `${capUser(0)}@example.com`)).length, 3, 'three of them to each account');
  r = await start(fresh(), `${capUser(30)}@example.com`);
  t.ok(r.status === 503 && r.json?.code === 'mail_paused' && r.json?.retryAfter === 14 * 3600 && r.headers.get('retry-after') === String(14 * 3600), `the ninety-first: 503 mail_paused, Retry-After until midnight UTC (${said(r)})`);
  t.eq((await outbox(on, `${capUser(30)}@example.com`)).length, 0, 'and it is not sent');
  r = await start(fresh(), 'lm-no-account@example.com');
  t.ok(r.status === 503 && r.json?.code === 'mail_paused', `an address with no account is answered the same, though nothing would go to it (${said(r)})`);
  r = await join(fresh(), 8, inviteToken('lm-open'));
  t.ok(r.status === 503 && r.json?.code === 'mail_paused', `and Join waits as well (${said(r)})`);
  clock.now = DAY1 + DAY + HOUR;
  r = await start(fresh(), `${capUser(30)}@example.com`);
  t.ok(r.status === 202 && (await outbox(on, `${capUser(30)}@example.com`)).length === 1, `the next UTC day, mail goes again (${said(r)})`);
  t.report();
}
