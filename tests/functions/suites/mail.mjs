// Mail (docs/accounts.md §6). Over HTTP, the stub: what GET
// /api/dev/outbox gives back, the hook not there off loopback, and the
// notices a passkey added or removed sends. Asked directly of
// functions/_shared/auth/mail.ts and flows.ts on a fresh SQLite: the
// Resend request (its URL, headers, body, Idempotency-Key, made after the
// answer), one retry under the same key, failures logged without the
// address; the stub on loopback and 503 not_configured elsewhere; the
// day's cap of 90 and 503 mail_paused; a notice dropped, not thrown, when
// the cap is reached; each mail's words; and a flow's sends keyed
// `<flow id>:<send n>`, its link on APP_ORIGIN.
import { createHash, randomBytes } from 'node:crypto';
import { Authenticator } from '../authenticator.mjs';
import { Browser, DEPLOYED_HOST, d1, migratedDatabase, outbox, seedSession, seedUser, seededToken, workerLog } from '../lib.mjs';

export const needs = ['on'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The suite's own day, for the mail cap. */
const T = 2_500_000_000_000;
const ALICE = 'u-mlalice00000000000000000000';
const ALICE_HANDLE_BYTES = randomBytes(32).toString('base64url');

export const seed = {
  sql: [
    seedUser({ id: ALICE, handle: 'mlalice', webauthn: ALICE_HANDLE_BYTES }),
    seedSession({ name: 'ml-alice', id: 's-mlalice', user: ALICE, created: T }),
  ].join('\n'),
};

export async function run({ checks, on, compileShared, repo }) {
  // --- the stub, over HTTP ---------------------------------------------------------------
  let t = checks('functions: the stub mailer and GET /api/dev/outbox');
  const clock = { now: T + MINUTE };
  const alice = new Browser(on, { ip: '192.0.2.200', clock });
  alice.jar.set('__Host-bz_session', seededToken('ml-alice'));
  const key = new Authenticator();
  const options = await alice.call('POST', '/api/me/passkeys/options', { json: {} });
  const made = key.makeCredential(options.json, { origin: alice.origin });
  let r = await alice.call('POST', '/api/me/passkeys', { json: { response: made.response, name: 'Studio key' } });
  t.eq(r.status, 201, 'a passkey is added');
  let rows = await outbox(on, 'mlalice@example.com');
  t.ok(rows.length === 1 && Object.keys(rows[0]).join(',') === 'id,at,to,subject,body', `the outbox has one row for the address: {id, at, to, subject, body} (${rows.length} ${Object.keys(rows[0] ?? {}).join(',')})`);
  t.ok(rows[0]?.at === clock.now && rows[0]?.to === 'mlalice@example.com', `written at the request's time, to the account's address (${rows[0]?.at - T})`);
  t.eq(rows[0]?.subject, 'A passkey was added to your Bozzetto account', 'the holder is told a passkey was added');
  t.ok(rows[0]?.body.includes('"Studio key"') && rows[0]?.body.includes('@mlalice') && rows[0]?.body.includes(`${alice.origin}/?signin`), `naming the passkey and the account, with the way in (${JSON.stringify(rows[0]?.body)})`);
  clock.now += MINUTE;
  r = await alice.call('DELETE', `/api/me/passkeys/${encodeURIComponent(r.json?.passkey?.id ?? 'none')}`);
  rows = await outbox(on, 'mlalice@example.com');
  t.ok(r.status === 204 && rows.length === 2 && rows[1].subject === 'A passkey was removed from your Bozzetto account' && rows[1].body.includes('"Studio key"'), `and that it was removed, by name (${r.status} ${rows[1]?.subject})`);
  r = await on.call('GET', '/api/dev/outbox?to=MLALICE%40EXAMPLE.COM');
  t.eq(r.json?.rows?.length, 2, 'the address is matched in any capitals');
  r = await on.call('GET', '/api/dev/outbox');
  t.ok(r.status === 200 && Array.isArray(r.json?.rows) && r.json.rows.at(-1)?.id === rows[1].id, 'without `to`, the latest rows, oldest first');
  r = await on.callHost(DEPLOYED_HOST, 'GET', '/api/dev/outbox?to=mlalice%40example.com');
  t.ok(r.status === 404 && !JSON.stringify(r.json).includes('mlalice'), `under any host but a loopback one it is not there (${r.status})`);
  const log = workerLog(on);
  t.ok(log.includes('mail (stub): dev_outbox #') && !log.toLowerCase().includes('mlalice@'), 'the stub logs what it wrote, without the address');
  t.report();

  // --- directly ---------------------------------------------------------------------------
  t = checks('functions: mail, directly');
  const db = await migratedDatabase(repo);
  if (!db) {
    console.log('  skip  node:sqlite is not in this Node (22.13 or later has it): the direct checks did not run');
    t.report();
    return;
  }
  const load = await compileShared();
  const mail = await load('auth/mail');
  const flows = await load('auth/flows');
  const secret = 'a secret for the mail checks';
  const deployed = `https://${DEPLOYED_HOST}/api/auth/email/start`;
  const local = 'http://localhost:8788/api/auth/email/start';
  const resend = { DB: d1(db), AUTH_SECRET: secret, RESEND_API_KEY: 're_test_key', MAIL_FROM: 'Bozzetto <login@example.com>' };
  const pending = [];
  const ctxAt = (url, now) => ({ request: new Request(url, { method: 'POST' }), now, waitUntil: (p) => pending.push(p) });
  const settle = async () => {
    while (pending.length) await pending.shift();
  };
  const attempt = async (fn) => {
    try {
      await fn();
      return 'ok';
    } catch (err) {
      return `${err.status} ${err.code}${err.extra?.retryAfter ? ` ${err.extra.retryAfter}` : ''}`;
    }
  };
  const realFetch = globalThis.fetch;
  const { error, log: info } = console;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  console.log = (...args) => logged.push(args.join(' '));
  const calls = [];
  let answers = [];
  /** While set, Resend does not answer until it is resolved: a slow Resend. */
  let held = null;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method, headers: new Headers(init?.headers), body: String(init?.body ?? '') });
    if (held) await held.promise;
    if (String(url).endsWith('/siteverify')) {
      // What Cloudflare's test secret answers for its dummy token.
      return new Response('{"success":true,"hostname":"example.com","action":"test","error-codes":[]}', { headers: { 'content-type': 'application/json' } });
    }
    const next = answers.shift() ?? { status: 200, body: '{"id":"49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"}' };
    return new Response(next.body, { status: next.status, headers: { 'content-type': 'application/json' } });
  };
  try {
    const letter = { to: 'someone@example.com', subject: 'Hello', text: 'Plain words.', idempotencyKey: 'flow-id:1' };
    held = Promise.withResolvers();
    let done = false;
    await mail.sendMail(resend, ctxAt(deployed, T), letter).then(() => (done = true));
    t.ok(done && calls.length === 1, 'the request does not wait for Resend: sendMail is done while Resend has not answered, the call running on through waitUntil');
    held.resolve();
    held = null;
    await settle();
    const [call] = calls;
    t.ok(calls.length === 1 && call.url === 'https://api.resend.com/emails' && call.method === 'POST', `then one POST https://api.resend.com/emails (${calls.length} ${call?.method} ${call?.url})`);
    t.ok(call?.headers.get('authorization') === 'Bearer re_test_key' && call?.headers.get('content-type') === 'application/json' && call?.headers.get('idempotency-key') === 'flow-id:1', `Authorization: Bearer RESEND_API_KEY, JSON, Idempotency-Key (${call?.headers.get('idempotency-key')})`);
    t.eq(call?.body, JSON.stringify({ from: 'Bozzetto <login@example.com>', to: ['someone@example.com'], subject: 'Hello', text: 'Plain words.' }), '{from: MAIL_FROM, to, subject, text}, and no HTML: nothing to track opens or rewrite links in');
    calls.length = 0;
    await mail.sendMail(resend, ctxAt(deployed, T), { ...letter, html: '<p>Plain words.</p>', idempotencyKey: 'k:2' });
    await settle();
    t.eq(JSON.parse(calls[0]?.body ?? '{}').html, '<p>Plain words.</p>', 'HTML goes only when a mail has some');

    calls.length = 0;
    answers = [{ status: 500, body: '{"name":"internal_server_error"}' }, { status: 200, body: '{"id":"x"}' }];
    await mail.sendMail(resend, ctxAt(deployed, T), { ...letter, idempotencyKey: 'k:retry' });
    await settle();
    t.ok(calls.length === 2 && calls.every((c) => c.headers.get('idempotency-key') === 'k:retry'), `a 500 is tried once more, under the same key, so Resend sends it once (${calls.length})`);
    calls.length = 0;
    logged.length = 0;
    answers = [{ status: 422, body: '{"statusCode":422,"name":"validation_error","message":"Invalid `to` field: someone@example.com"}' }];
    await mail.sendMail(resend, ctxAt(deployed, T), { ...letter, idempotencyKey: 'k:422' });
    await settle();
    t.ok(calls.length === 1 && logged.some((l) => l.includes('Resend did not take a mail (422)')), `a 422 is not retried, and is logged (${calls.length})`);
    t.ok(logged.length > 0 && logged.every((l) => !l.includes('someone@example.com')) && logged.some((l) => l.includes('[address]')), `without the address, even when Resend's answer has it (${logged.join(' | ')})`);
    calls.length = 0;
    t.eq(await attempt(() => mail.sendMail({ ...resend, MAIL_FROM: undefined }, ctxAt(deployed, T), letter)), '503 not_configured', 'RESEND_API_KEY without MAIL_FROM: 503 not_configured');

    const stub = { DB: d1(db), AUTH_SECRET: secret };
    logged.length = 0;
    await mail.sendMail(stub, ctxAt(local, T + 5), { ...letter, to: 'stubbed@example.com', subject: '123456 is your Bozzetto code' });
    const written = db.prepare("SELECT at, to_addr, subject, body FROM dev_outbox WHERE to_addr = 'stubbed@example.com'").all();
    t.ok(written.length === 1 && written[0].at === T + 5 && written[0].subject === '123456 is your Bozzetto code' && written[0].body === 'Plain words.', `no RESEND_API_KEY on loopback: the mail is in dev_outbox at once (${written.length})`);
    t.ok(logged.some((l) => /^mail \(stub\): dev_outbox #\d+: 123456 is your Bozzetto code$/.test(l)) && logged.every((l) => !l.includes('stubbed@')), `and the log says so, without the address (${logged.join(' | ')})`);
    t.eq(await attempt(() => mail.sendMail(stub, ctxAt(deployed, T), { ...letter, to: 'nowhere@example.com' })), '503 not_configured', 'no RESEND_API_KEY anywhere else: 503 not_configured');
    t.eq(db.prepare("SELECT COUNT(*) AS n FROM dev_outbox WHERE to_addr = 'nowhere@example.com'").get().n, 0, 'and nothing is written');
    t.eq(calls.length, 0, 'nor sent');

    // The day's cap: a day of its own, 90 mails, then 503 mail_paused until midnight UTC.
    const day = Math.floor(T / DAY) * DAY + 3 * DAY;
    const noon = day + 12 * HOUR;
    const sent = [];
    for (let i = 0; i < 90; i++) sent.push(await attempt(() => mail.sendMail(stub, ctxAt(local, noon), { ...letter, to: `cap${i}@example.com`, idempotencyKey: `cap:${i}` })));
    t.ok(sent.every((s) => s === 'ok'), `ninety mails in a UTC day go (${[...new Set(sent)].join(', ')})`);
    t.eq(await attempt(() => mail.sendMail(stub, ctxAt(local, noon), { ...letter, to: 'cap90@example.com' })), `503 mail_paused ${12 * 3600}`, 'the ninety-first: 503 mail_paused, retryAfter until midnight UTC');
    t.eq(await attempt(() => mail.dailyCap(stub, ctxAt(local, noon), false)), `503 mail_paused ${12 * 3600}`, 'and only looking says so too, as an answer that sends nothing must');
    t.eq(db.prepare("SELECT COUNT(*) AS n FROM dev_outbox WHERE to_addr = 'cap90@example.com'").get().n, 0, 'nothing past the cap is written');
    logged.length = 0;
    await mail.notify(stub, ctxAt(local, noon), { id: 'u-capped', handle: 'capped', email: 'capped@example.com' }, { kind: 'passkey.added', name: 'Key' });
    t.ok(logged.some((l) => l.includes('notice passkey.added for u-capped not sent')) && logged.every((l) => !l.includes('capped@')), `a notice past the cap is dropped and logged by the account's id, never thrown (${logged.join(' | ')})`);
    t.eq(await attempt(() => mail.sendMail(stub, ctxAt(local, day + DAY), { ...letter, to: 'cap90@example.com' })), 'ok', 'the next UTC day, mail goes again');
    const buckets = db.prepare("SELECT bucket FROM rate_limits WHERE bucket LIKE 'mail-all:%'").all();
    t.ok(buckets.length >= 2 && buckets.every((b) => /^mail-all:[0-9a-f]{32}$/.test(b.bucket)), `counted in rate_limits, one row a day (${buckets.length})`);

    // A flow's sends, keyed <flow id>:<send n>, through Resend.
    db.exec(seedUser({ id: 'u-mlflow', handle: 'mlflow', email: 'mlflow@example.com' }));
    const env = {
      ...resend,
      APP_ORIGIN: `https://${DEPLOYED_HOST}`,
      // Cloudflare's test secret: its answer names no host or action, and success is all that is asked of it.
      TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    };
    calls.length = 0;
    answers = [];
    const flowCtx = (now, cookie) => ({
      request: new Request(deployed, { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.240', ...(cookie ? { cookie } : {}) } }),
      env,
      data: { now, principal: { kind: 'guest' } },
      waitUntil: (p) => pending.push(p),
    });
    const begun = await flows.startFlow(flowCtx(T), { purpose: 'sign_in', userId: 'u-mlflow', email: 'mlflow@example.com', link: true }, 'code');
    const cookie = begun.headers.get('set-cookie')?.split(';')[0] ?? '';
    const flowId = createHash('sha256').update(cookie.slice(cookie.indexOf('=') + 1)).digest('hex');
    await settle();
    let sentMail = calls.filter((c) => c.url === 'https://api.resend.com/emails');
    const body = JSON.parse(sentMail[0]?.body ?? '{}');
    t.ok(begun.status === 202 && sentMail.length === 1 && sentMail[0].headers.get('idempotency-key') === `${flowId}:1`, `a flow's first mail is keyed <flow id>:1 (${sentMail[0]?.headers.get('idempotency-key')?.slice(-2)})`);
    t.ok(/^\d{6} is your Bozzetto code$/.test(body.subject) && body.text.includes(`Or open https://${DEPLOYED_HOST}/?link=`), `its code, and the link on APP_ORIGIN (${body.subject})`);
    const again = await flows.resendFlow(flowCtx(T + MINUTE, cookie), { turnstile: 'XXXX.DUMMY.TOKEN.XXXX' });
    await settle();
    sentMail = calls.filter((c) => c.url === 'https://api.resend.com/emails');
    t.ok(again.status === 202 && sentMail.length === 2 && sentMail[1].headers.get('idempotency-key') === `${flowId}:2`, `a resend's is keyed <flow id>:2 (${again.status} ${sentMail[1]?.headers.get('idempotency-key')?.slice(-2)})`);
    t.ok(calls.some((c) => c.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify'), 'and asked Turnstile first');
    const nobody = await flows.startFlow(flowCtx(T + 2 * MINUTE), { purpose: 'sign_in', userId: null, email: 'mlnobody@example.com', link: false }, 'none');
    await settle();
    t.ok(nobody.status === 202 && calls.filter((c) => c.url === 'https://api.resend.com/emails').length === 2, `an address with no account: the same 202, and nothing handed to Resend (${nobody.status})`);
  } finally {
    globalThis.fetch = realFetch;
    console.error = error;
    console.log = info;
  }
  t.report();

  // --- what the mails say -------------------------------------------------------------------
  t = checks('functions: what the mails say');
  const user = { id: 'u-x', handle: 'sculptor', email: 'old@example.com' };
  const at = Date.UTC(2026, 9, 7, 14, 3);
  const say = (notice) => mail.noticeMail(notice, user, at, 'https://bozzetto.example');
  t.eq(mail.when(at), '7 October 2026 at 14:03 UTC', 'a moment, as a mail says it');
  let words = say({ kind: 'passkey.added', name: 'Safari on Mac' });
  t.ok(words.subject === 'A passkey was added to your Bozzetto account' && words.text.startsWith('A passkey, "Safari on Mac", was added to your Bozzetto account @sculptor on 7 October 2026 at 14:03 UTC.'), `a passkey added (${JSON.stringify(words.text.split('\n')[0])})`);
  words = say({ kind: 'passkey.removed', name: '' });
  t.ok(words.text.startsWith('A passkey was removed from your Bozzetto account @sculptor'), `a passkey removed, nameless (${JSON.stringify(words.text.split('\n')[0])})`);
  words = say({ kind: 'email.changed', to: 'new.address@example.org' });
  t.ok(words.subject === 'Your Bozzetto account has a new address' && words.text.includes('from this one to n…@example.org') && !words.text.includes('new.address@'), `the address changed, the new one masked (${JSON.stringify(words.text.split('\n')[0])})`);
  words = say({ kind: 'account.suspended', reason: 'Spam in titles' });
  t.ok(words.subject === 'Your Bozzetto account is suspended' && words.text.includes('The reason given: Spam in titles') && words.text.includes('object'), 'suspended, with the reason and a way to object');
  words = say({ kind: 'account.deleted' });
  t.ok(words.subject === 'Your Bozzetto account is being deleted' && words.text.includes('@sculptor'), 'being deleted');
  words = mail.registeredMail('https://bozzetto.example');
  t.ok(words.subject === 'You already have a Bozzetto account' && words.text.includes('https://bozzetto.example/?signin') && !/\d{6}/.test(words.text), 'an address that has an account: no code, the way to sign in');
  t.eq(mail.maskAddress('a@b.example'), 'a…@b.example', 'masking keeps the first character and the domain');
  for (const [input, want] of [
    ['  Someone@Example.COM ', 'someone@example.com'],
    ['a.b+tag@sub.example.co.uk', 'a.b+tag@sub.example.co.uk'],
    ['no-dot@localhost', null],
    ['"quoted"@example.com', null],
    ['x@-bad.example', null],
    [`${'a'.repeat(64)}@example.com`, `${'a'.repeat(64)}@example.com`],
    [`${'a'.repeat(65)}@example.com`, null],
    [`a@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.com`, `a@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.com`],
    [`a@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(60)}.${'f'.repeat(10)}.com`, null],
  ]) {
    t.eq(mail.normalizeEmail(input), want, `the address ${JSON.stringify(input.length > 40 ? `${input.slice(0, 20)}…` : input)}`);
  }
  t.report();
}
