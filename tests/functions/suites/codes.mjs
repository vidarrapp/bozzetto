// Email codes (docs/accounts.md §3, §6): signing in by a code mailed to
// an active account's address, through the stub mailer (dev_outbox) and
// the Turnstile fake. The code mail's text; 5 attempts to a code, a code
// that is not six digits costing none; expiry at 10 minutes on the
// X-Test-Now clock; single use; a code bound to the browser that asked (a
// wrong flow cookie, none at all); the sign-in link, which needs that
// browser's cookie too and consumes the code; resends, at most 3 sends 60
// s apart, each new code replacing the last; an unknown or suspended
// address answered exactly as a known one, with no mail; re-authenticating
// by a code. No address ever reaches the log.
import { Browser, auditRows, codeIn, linkIn, outbox, seedSession, seedUser, seededToken, setCookies, workerLog } from '../lib.mjs';
import { pass } from '../turnstile-fake.mjs';

export const needs = ['on'];

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** The suite's day: the mail cap is per UTC day, so no other suite's mail is counted with this one's. */
const T = 2_300_000_000_000;

const U = {
  alice: 'u-cdalice00000000000000000000',
  bob: 'u-cdbob0000000000000000000000',
  carol: 'u-cdcarol00000000000000000000',
  dave: 'u-cddave000000000000000000000',
  erin: 'u-cderin000000000000000000000',
  frank: 'u-cdfrank00000000000000000000',
  grace: 'u-cdgrace00000000000000000000',
  hank: 'u-cdhank000000000000000000000',
  ivy: 'u-cdivy0000000000000000000000',
  suspended: 'u-cdsuspended000000000000000',
};
const mail = (name) => `cd${name}@example.com`;

export const seed = {
  sql: [
    ...Object.entries(U).map(([name, id]) =>
      seedUser({ id, handle: `cd${name}`, status: name === 'suspended' ? 'suspended' : 'active', at: T - 30 * 24 * HOUR }),
    ),
    seedSession({ name: 'cd-grace', id: 's-cdgrace', user: U.grace, created: T - HOUR }),
    seedSession({ name: 'cd-hank', id: 's-cdhank', user: U.hank, created: T - HOUR }),
  ].join('\n'),
};

/** The code mail's text, as docs/accounts.md §6 has it. */
const codeText = (code, link) =>
  [
    `Your code is ${code.slice(0, 3)} ${code.slice(3)}. Type it where Bozzetto asked. It works once, for 10 minutes.`,
    ...(link ? ['', `Or open ${link} in the same browser.`] : []),
    '',
    'Did not ask? Ignore this mail: the code is useless without the device that asked.',
  ].join('\n');

export async function run({ checks, on }) {
  const clock = { now: T };
  let ips = 0;
  /** A browser at the suite's time, from an address of its own, holding a seeded session if named. */
  const browser = (session) => {
    const b = new Browser(on, { ip: `192.0.2.${50 + (ips++ % 40)}`, clock });
    if (session) b.jar.set('__Host-bz_session', seededToken(session));
    return b;
  };
  const start = (b, email, extra = {}) =>
    b.call('POST', '/api/auth/email/start', { json: { email, turnstile: pass('email-code'), ...extra } });
  const verify = (b, code, extra = {}) => b.call('POST', '/api/auth/email/verify', { json: { code, ...extra } });
  const resend = (b, turnstile = pass('email-code')) => b.call('POST', '/api/auth/email/resend', { json: { turnstile } });
  const link = (b, token) => b.call('POST', '/api/auth/email/link', { json: { token } });
  const mails = (name) => outbox(on, mail(name));
  const last = async (name) => (await mails(name)).at(-1);
  /** A code that is not `code`. */
  const wrong = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  const at = (offset) => {
    clock.now = T + offset;
  };

  // --- signing in by a code ---------------------------------------------------------
  let t = checks('functions: signing in by an email code');
  at(0);
  const a = browser();
  let r = await start(a, mail('alice'));
  const flow = setCookies(r).find((c) => c.name === '__Host-bz_flow');
  t.ok(r.status === 202 && JSON.stringify(r.json) === JSON.stringify({ expiresAt: T + 10 * MINUTE, resendAfter: 60, resendsLeft: 2 }), `202 {expiresAt: in 10 minutes, resendAfter: 60, resendsLeft: 2} (${r.status} ${JSON.stringify(r.json)})`);
  t.ok(flow && /^[A-Za-z0-9_-]{43}$/.test(flow.value), `__Host-bz_flow is 32 random bytes as base64url (${flow?.value?.length})`);
  t.ok(flow?.attrs.path === '/' && flow?.attrs.secure === true && flow?.attrs.httponly === true && flow?.attrs.samesite === 'Strict' && flow?.attrs['max-age'] === '900' && !('domain' in (flow?.attrs ?? {})), `Path=/, Secure, HttpOnly, SameSite=Strict, Max-Age=15 minutes, no Domain (${JSON.stringify(flow?.attrs)})`);
  t.eq(r.headers.get('cache-control'), 'no-store', 'and kept by no cache');
  let rows = await mails('alice');
  const code = codeIn(rows[0]);
  t.ok(rows.length === 1 && code !== null && rows[0].subject === `${code} is your Bozzetto code`, `one mail to the address, "123456 is your Bozzetto code" (${rows.length} ${rows[0]?.subject})`);
  t.eq(rows[0]?.body, codeText(code ?? '', null), 'its text is the design\'s, the code spaced, and no link unless one was asked for');
  r = await verify(a, `${code.slice(0, 3)} ${code.slice(3)}`);
  const set = Object.fromEntries(setCookies(r).map((c) => [c.name, c]));
  t.ok(r.status === 200 && r.json?.user?.id === U.alice && r.json?.user?.handle === 'cdalice' && r.json?.user?.role === 'member', `the code, typed as the mail spaces it, signs in: 200 {user} (${r.status} ${JSON.stringify(r.json?.user)})`);
  t.ok(/^bz1_/.test(set['__Host-bz_session']?.value ?? '') && set['__Host-bz_session']?.attrs.samesite === 'Lax' && set['__Host-bz_flow']?.attrs['max-age'] === '0', 'with a session cookie, and the flow cookie cleared');
  r = await a.call('GET', '/api/me/account');
  const current = (r.json?.sessions ?? []).find((s) => s.current);
  t.ok(r.status === 200 && current?.method === 'email' && current?.client === 'web', `the session is listed as signed in by 'email' (${r.status} ${JSON.stringify(current)})`);
  const audit = await auditRows(on, U.alice);
  t.ok(audit.some((x) => x.action === 'session.signin' && x.detail.method === 'email' && x.detail.session === current?.id) && !JSON.stringify(audit).includes('@') && !JSON.stringify(audit).includes(code), `the sign-in is audited, with no address or code in it (${audit.map((x) => x.action).join(', ')})`);
  a.jar.set('__Host-bz_flow', flow?.value);
  r = await verify(a, code);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `the same code again: 410 flow_expired, it works once (${r.status} ${r.json?.code})`);
  t.ok(setCookies(r).some((c) => c.name === '__Host-bz_flow' && c.attrs['max-age'] === '0'), 'and the dead flow\'s cookie is cleared');
  r = await start(a, 'CDAlice@Example.COM');
  rows = await mails('alice');
  t.ok(r.status === 202 && rows.length === 2, `an address typed in capitals is the same address (${r.status}, ${rows.length} mails)`);
  t.report();

  // --- five attempts -----------------------------------------------------------------
  t = checks('functions: five attempts to a code');
  at(HOUR);
  const b = browser();
  await start(b, mail('bob'));
  let bobCode = codeIn(await last('bob'));
  r = await verify(b, '12345');
  t.ok(r.status === 400 && r.json?.code === 'bad_request', `five digits: 400 bad_request (${r.status} ${r.json?.code})`);
  r = await verify(b, 'abcdef');
  t.ok(r.status === 400 && r.json?.code === 'bad_request', `letters: 400 bad_request (${r.status} ${r.json?.code})`);
  const left = [];
  for (let i = 0; i < 4; i++) {
    r = await verify(b, wrong(bobCode));
    left.push(`${r.status}/${r.json?.code}/${r.json?.attemptsLeft}`);
  }
  t.eq(left.join(' '), '400/code_invalid/4 400/code_invalid/3 400/code_invalid/2 400/code_invalid/1', 'a wrong code is 400 code_invalid with the attempts left, and what was not six digits cost none');
  r = await verify(b, bobCode);
  t.ok(r.status === 200 && r.json?.user?.id === U.bob, `the fifth attempt may still be the right one (${r.status})`);
  const b2 = browser();
  await start(b2, mail('bob'));
  bobCode = codeIn(await last('bob'));
  for (let i = 0; i < 4; i++) await verify(b2, wrong(bobCode));
  const kept = b2.cookie('__Host-bz_flow');
  r = await verify(b2, wrong(bobCode));
  t.ok(r.status === 400 && r.json?.attemptsLeft === 0 && setCookies(r).some((c) => c.name === '__Host-bz_flow' && c.attrs['max-age'] === '0'), `the fifth wrong one leaves none, and clears the cookie (${r.status} ${r.json?.attemptsLeft})`);
  b2.jar.set('__Host-bz_flow', kept);
  r = await verify(b2, bobCode);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `after five wrong ones even the right code is refused: 410 (${r.status} ${r.json?.code})`);
  r = await resend(b2);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `nor can a spent flow send another (${r.status} ${r.json?.code})`);
  t.report();

  // --- expiry -------------------------------------------------------------------------
  t = checks('functions: a code expires after 10 minutes');
  at(2 * HOUR);
  const c = browser();
  await start(c, mail('carol'));
  let carolCode = codeIn(await last('carol'));
  at(2 * HOUR + 10 * MINUTE);
  r = await verify(c, carolCode);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `ten minutes after it was sent: 410 flow_expired (${r.status} ${r.json?.code})`);
  at(2 * HOUR + 20 * MINUTE);
  await start(c, mail('carol'));
  carolCode = codeIn(await last('carol'));
  at(2 * HOUR + 30 * MINUTE - SECOND);
  r = await verify(c, carolCode);
  t.ok(r.status === 200 && r.json?.user?.id === U.carol, `a second short of ten minutes: it still works (${r.status})`);
  t.report();

  // --- bound to the browser that asked ---------------------------------------------
  t = checks('functions: a code works only in the browser that asked');
  at(3 * HOUR);
  const d1 = browser();
  const d2 = browser();
  await start(d1, mail('dave'));
  const code1 = codeIn(await last('dave'));
  await start(d2, mail('dave'));
  const code2 = codeIn(await last('dave'));
  t.ok(code1 && code2 && d1.cookie('__Host-bz_flow') !== d2.cookie('__Host-bz_flow'), 'two browsers asking for the same address each have a flow and a code of their own');
  r = await verify(d2, code1);
  t.ok(r.status === 400 && r.json?.code === 'code_invalid', `the first browser's code, sent with the second's cookie: 400 code_invalid (${r.status} ${r.json?.code})`);
  const none = browser();
  r = await verify(none, code1);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `with no flow cookie at all: 410 flow_expired (${r.status} ${r.json?.code})`);
  none.jar.set('__Host-bz_flow', 'A'.repeat(43));
  r = await verify(none, code1);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `with a cookie no flow stands behind: 410 (${r.status} ${r.json?.code})`);
  r = await verify(d1, code1);
  t.ok(r.status === 200 && r.json?.user?.id === U.dave, `the first browser, with its own code: signed in (${r.status})`);
  r = await verify(d2, code2);
  t.ok(r.status === 200 && r.json?.user?.id === U.dave, `and the second with its own (${r.status})`);
  t.report();

  // --- the link -----------------------------------------------------------------------
  t = checks('functions: the sign-in link');
  at(4 * HOUR);
  const e = browser();
  r = await start(e, mail('erin'), { link: true });
  const row = await last('erin');
  const token = linkIn(row);
  const erinCode = codeIn(row);
  const erinFlow = e.cookie('__Host-bz_flow');
  t.ok(r.status === 202 && token !== null, `link: true adds a link to the mail (${r.status} ${token?.length})`);
  t.eq(row?.body, codeText(erinCode ?? '', `${e.origin}/?link=${token}`), 'on its own line between the code and the warning, on APP_ORIGIN');
  const scanner = browser();
  r = await link(scanner, token);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `followed without the flow cookie, as a mail scanner would: 410, nothing gained (${r.status} ${r.json?.code})`);
  r = await link(e, 'B'.repeat(43));
  t.ok(r.status === 400 && r.json?.code === 'code_invalid' && r.json?.attemptsLeft === 4, `another token with the cookie: 400 code_invalid, an attempt spent (${r.status} ${r.json?.code} ${r.json?.attemptsLeft})`);
  r = await link(e, 'not a token');
  t.ok(r.status === 400 && r.json?.code === 'bad_request', `something that is no token: 400 bad_request (${r.status} ${r.json?.code})`);
  r = await link(e, token);
  t.ok(r.status === 200 && r.json?.user?.id === U.erin && /^bz1_/.test(e.cookie('__Host-bz_session') ?? ''), `the link with its browser's cookie, after a scanner tried it: signed in (${r.status})`);
  const viaLink = ((await e.call('GET', '/api/me/account')).json?.sessions ?? []).find((x) => x.current);
  t.eq(viaLink?.method, 'link', "the session is listed as signed in by 'link'");
  e.jar.set('__Host-bz_flow', erinFlow);
  r = await link(e, token);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `the link again, cookie and all: 410, it works once (${r.status} ${r.json?.code})`);
  e.jar.set('__Host-bz_flow', erinFlow);
  r = await verify(e, erinCode);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `and the code went with it (${r.status} ${r.json?.code})`);
  const e2 = browser();
  await start(e2, mail('erin'));
  r = await link(e2, token);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired' && !setCookies(r).some((x) => x.name === '__Host-bz_flow'), `a flow that mailed no link takes none: 410, the flow kept (${r.status} ${r.json?.code})`);
  r = await verify(e2, codeIn(await last('erin')));
  t.eq(r.status, 200, 'and its code still works, no attempt having been spent on it');
  r = await start(browser(), mail('erin'), { link: 'yes' });
  t.ok(r.status === 400 && r.json?.code === 'bad_request', `link must be true or false (${r.status})`);
  t.report();

  // --- resends -------------------------------------------------------------------------
  t = checks('functions: sending a code again');
  at(5 * HOUR);
  const f = browser();
  await start(f, mail('frank'));
  const firstCode = codeIn(await last('frank'));
  const flowValue = f.cookie('__Host-bz_flow');
  at(5 * HOUR + 59 * SECOND);
  r = await resend(f);
  t.ok(r.status === 429 && r.json?.code === 'rate_limited' && r.json?.retryAfter === 1 && r.json?.resendsLeft === 2 && r.headers.get('retry-after') === '1', `59 s after the first: 429 rate_limited, Retry-After 1, two left (${r.status} ${JSON.stringify(r.json)})`);
  at(5 * HOUR + 60 * SECOND);
  r = await resend(f);
  const again = setCookies(r).find((c) => c.name === '__Host-bz_flow');
  t.ok(r.status === 202 && JSON.stringify(r.json) === JSON.stringify({ expiresAt: clock.now + 10 * MINUTE, resendAfter: 60, resendsLeft: 1 }), `at 60 s: 202, a new 10 minutes, one left (${r.status} ${JSON.stringify(r.json)})`);
  t.ok(again?.value === flowValue && again?.attrs['max-age'] === '900', 'the same flow, its cookie set again for another 15 minutes');
  const secondCode = codeIn(await last('frank'));
  t.ok(secondCode !== null && (await mails('frank')).length === 2, 'and a second mail, with a new code');
  r = await verify(f, firstCode === secondCode ? wrong(secondCode) : firstCode);
  t.ok(r.status === 400 && r.json?.code === 'code_invalid' && r.json?.attemptsLeft === 4, `the first code no longer works (${r.status} ${r.json?.code} ${r.json?.attemptsLeft})`);
  at(5 * HOUR + 120 * SECOND);
  r = await resend(f, 'not-a-token');
  t.ok(r.status === 403 && r.json?.code === 'turnstile', `a resend wants Turnstile too: 403 turnstile (${r.status} ${r.json?.code})`);
  r = await resend(f, pass('register'));
  t.ok(r.status === 403 && r.json?.code === 'turnstile', `for the email-code action, not Join's (${r.status} ${r.json?.code})`);
  r = await resend(f);
  t.ok(r.status === 202 && r.json?.resendsLeft === 0, `the third send: 202, none left (${r.status} ${JSON.stringify(r.json)})`);
  t.ok(r.json?.expiresAt === clock.now + 10 * MINUTE, 'with its own 10 minutes');
  const thirdCode = codeIn(await last('frank'));
  at(5 * HOUR + 240 * SECOND);
  r = await resend(f);
  t.ok(r.status === 429 && r.json?.resendsLeft === 0 && r.json?.retryAfter > 0 && r.headers.get('retry-after') === String(r.json?.retryAfter), `a fourth: 429, none left, Retry-After until the last code expires (${r.status} ${JSON.stringify(r.json)})`);
  t.eq((await mails('frank')).length, 3, 'three mails in all');
  r = await verify(f, thirdCode);
  t.ok(r.status === 200 && r.json?.user?.id === U.frank, `the last code signs in, its attempts counted afresh (${r.status})`);
  r = await resend(browser());
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `a resend with no flow: 410 (${r.status} ${r.json?.code})`);
  t.report();

  // --- an address with no account ------------------------------------------------------
  t = checks('functions: an address with no active account');
  at(6 * HOUR);
  const known = browser();
  const knownAnswer = await start(known, mail('ivy'));
  const unknownBrowser = browser();
  r = await start(unknownBrowser, 'nobody-here@example.com');
  const unknownFlow = setCookies(r).find((c) => c.name === '__Host-bz_flow');
  t.ok(r.status === 202 && knownAnswer.status === 202 && JSON.stringify(r.json) === JSON.stringify(knownAnswer.json), `answered exactly as an account's address is (${r.status} ${JSON.stringify(r.json)})`);
  t.ok(unknownFlow?.attrs['max-age'] === '900' && /^[A-Za-z0-9_-]{43}$/.test(unknownFlow?.value ?? ''), 'with a flow cookie like any other');
  t.eq((await outbox(on, 'nobody-here@example.com')).length, 0, 'and no mail at all');
  r = await verify(unknownBrowser, '000000');
  t.ok(r.status === 400 && r.json?.code === 'code_invalid' && r.json?.attemptsLeft === 4, `a guessed code is wrong, as anywhere (${r.status} ${r.json?.code})`);
  at(6 * HOUR + MINUTE);
  r = await resend(unknownBrowser);
  t.ok(r.status === 202 && r.json?.resendsLeft === 1, `a resend is answered too (${r.status} ${JSON.stringify(r.json)})`);
  t.eq((await outbox(on, 'nobody-here@example.com')).length, 0, 'and sends nothing either');
  r = await start(browser(), mail('suspended'));
  t.ok(r.status === 202 && (await mails('suspended')).length === 0, `a suspended account's address: 202, and no code (${r.status})`);
  t.report();

  t = checks('functions: starting a sign-in, refused');
  for (const [email, why] of [
    ['not-an-address', 'no @'],
    ['a@b', 'no dot in the domain'],
    ['two@@example.com', 'two @'],
    ['Name <x@example.com>', 'a display name'],
    ['x@example.com, y@example.com', 'two addresses'],
    [`${'x'.repeat(65)}@example.com`, 'a local part over 64'],
    [12, 'a number'],
  ]) {
    r = await start(browser(), email);
    t.ok(r.status === 400 && r.json?.code === 'bad_request', `${JSON.stringify(email)} (${why}): 400 bad_request (${r.status})`);
  }
  for (const [token, status, code, why] of [
    [undefined, 403, 'turnstile', 'no token'],
    ['nope', 403, 'turnstile', 'a token siteverify refuses'],
    ['pass-other-action', 403, 'turnstile', 'a token for another action'],
    [pass('register'), 403, 'turnstile', "a token for Join's action"],
    ['pass-other-host:email-code', 403, 'turnstile', 'a token made on another host'],
    ['error:timeout-or-duplicate', 403, 'turnstile', 'a token already spent'],
    ['down', 503, 'turnstile_down', 'siteverify out of reach'],
    ['error:internal-error', 503, 'turnstile_down', 'siteverify failing on its side'],
  ]) {
    r = await start(browser(), mail('ivy'), { turnstile: token });
    t.ok(r.status === status && r.json?.code === code, `${why}: ${status} ${code} (${r.status} ${r.json?.code})`);
  }
  t.eq((await mails('ivy')).length, 1, 'and none of them mailed anything');
  t.report();

  // --- re-authentication -----------------------------------------------------------------
  t = checks('functions: re-authenticating by a code');
  at(7 * HOUR);
  const g = browser('cd-grace');
  r = await g.call('POST', '/api/me/passkeys/options', { json: {} });
  t.ok(r.status === 401 && r.json?.code === 'reauth', `a session an hour old must confirm first: 401 reauth (${r.status} ${r.json?.code})`);
  r = await browser().call('POST', '/api/auth/email/start', { json: { reauth: true, turnstile: pass('email-code') } });
  t.ok(r.status === 401 && r.json?.code === 'signin', `reauth: true without a session: 401 signin (${r.status} ${r.json?.code})`);
  r = await g.call('POST', '/api/auth/email/start', { json: { reauth: true, turnstile: pass('email-code'), email: 'elsewhere@example.com' } });
  t.ok(r.status === 202, `reauth: true with a session: 202 (${r.status})`);
  const graceCode = codeIn(await last('grace'));
  t.ok(graceCode !== null && (await outbox(on, 'elsewhere@example.com')).length === 0, 'the code goes to the account\'s own address, whatever else is sent');
  r = await verify(g, graceCode);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired' && !setCookies(r).some((x) => x.name === '__Host-bz_flow'), `checked as a sign-in, it is not one: 410, and the flow is kept for the check it is for (${r.status} ${r.json?.code})`);
  const h = browser('cd-hank');
  h.jar.set('__Host-bz_flow', g.cookie('__Host-bz_flow'));
  r = await verify(h, graceCode, { reauth: true });
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `another account's session with the flow: 410 (${r.status} ${r.json?.code})`);
  r = await verify(g, graceCode, { reauth: true });
  t.ok(r.status === 204 && setCookies(r).some((x) => x.name === '__Host-bz_flow' && x.attrs['max-age'] === '0'), `the account's own session, reauth: true: 204, the flow cookie cleared (${r.status})`);
  r = await g.call('POST', '/api/me/passkeys/options', { json: {} });
  t.eq(r.status, 200, 'and the session now counts as recent');
  const p = (await g.call('GET', '/api/dev/principal')).json?.principal;
  t.ok(p?.kind === 'user' && p.user === U.grace && p.session === 's-cdgrace' && p.recentAuth === true, `the same session, not a new one (${JSON.stringify(p)})`);
  t.report();

  // --- the log ---------------------------------------------------------------------------
  t = checks('functions: codes, no address in the log');
  const log = workerLog(on);
  const addresses = [...Object.keys(U).map(mail), 'nobody-here@example.com', 'elsewhere@example.com'];
  const seen = addresses.filter((x) => log.toLowerCase().includes(x));
  t.ok(log.includes('mail (stub)') && seen.length === 0, `the stub said what it wrote, and no address it wrote to is in the server's log (${seen.join(', ') || 'none'})`);
  t.report();
}
