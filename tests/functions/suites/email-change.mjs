// Changing an account's address and handle (docs/accounts.md §3). The
// address: recent authentication to begin; the code to the new address;
// the swap, the audit row without an address, the old address told with
// the new one masked; signing in by the new address afterwards; an address
// another account has (a notice instead of a code, the same answer); an
// address taken between the start and the code; another account's
// session with the flow; the code checked after recent authentication has
// lapsed. The handle: PATCH /api/me once per 30 days, its rules, and the
// old handle held for 90 days.
import { Browser, auditRows, codeIn, outbox, seedSession, seedUser, seededToken, setCookies, storedUser, workerLog } from '../lib.mjs';
import { pass } from '../turnstile-fake.mjs';

export const needs = ['on'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** The suite's own day, for the mail cap. */
const T = 2_600_000_000_000;

const U = {
  alice: 'u-ecalice00000000000000000000',
  bob: 'u-ecbob0000000000000000000000',
  carol: 'u-eccarol00000000000000000000',
  dave: 'u-ecdave000000000000000000000',
  erin: 'u-ecerin000000000000000000000',
};

export const seed = {
  sql: [
    ...Object.entries(U).map(([name, id]) => seedUser({ id, handle: `ec${name}` })),
    seedSession({ name: 'ec-alice', id: 's-ecalice', user: U.alice, created: T }),
    seedSession({ name: 'ec-bob', id: 's-ecbob', user: U.bob, created: T }),
    seedSession({ name: 'ec-carol', id: 's-eccarol', user: U.carol, created: T - HOUR }),
    seedSession({ name: 'ec-dave', id: 's-ecdave', user: U.dave, created: T }),
    seedSession({ name: 'ec-erin', id: 's-ecerin', user: U.erin, created: T }),
    // A session that begins later, for the checks a month on.
    seedSession({ name: 'ec-dave-later', id: 's-ecdavelater', user: U.dave, created: T + 29 * DAY }),
  ].join('\n'),
};

export async function run({ checks, on }) {
  const clock = { now: T + MINUTE };
  let ips = 0;
  const as = (session) => {
    const b = new Browser(on, { ip: `192.0.2.${220 + (ips++ % 30)}`, clock });
    if (session) b.jar.set('__Host-bz_session', seededToken(session));
    return b;
  };
  const begin = (b, email, turnstile = pass('email-code')) => b.call('POST', '/api/me/email/start', { json: { email, turnstile } });
  const finish = (b, code) => b.call('POST', '/api/me/email/verify', { json: { code } });
  const last = async (address) => (await outbox(on, address)).at(-1);
  const account = async (b) => (await b.call('GET', '/api/me/account')).json;

  // --- refused --------------------------------------------------------------------------
  let t = checks('functions: changing the address, refused');
  let r = await begin(as('ec-carol'), 'carol.new@example.com');
  t.ok(r.status === 401 && r.json?.code === 'reauth', `a session that has not authenticated in 10 minutes: 401 reauth (${r.status} ${r.json?.code})`);
  r = await begin(as(), 'carol.new@example.com');
  t.ok(r.status === 401 && r.json?.code === 'signin', `no session: 401 signin (${r.status} ${r.json?.code})`);
  const alice = as('ec-alice');
  for (const [email, turnstile, status, code, why] of [
    ['not an address', undefined, 400, 'bad_request', 'an address that is not one'],
    ['ECAlice@Example.com', undefined, 400, 'bad_request', 'the account\'s own, in other capitals'],
    ['alice.new@example.com', 'nope', 403, 'turnstile', 'Turnstile failing'],
    ['alice.new@example.com', pass('register'), 403, 'turnstile', "a token for Join's action"],
  ]) {
    r = await begin(alice, email, turnstile);
    t.ok(r.status === status && r.json?.code === code, `${why}: ${status} ${code} (${r.status} ${r.json?.code})`);
  }
  t.eq((await outbox(on, 'alice.new@example.com')).length, 0, 'and nothing was mailed');
  t.report();

  // --- the change ---------------------------------------------------------------------------
  t = checks('functions: changing the address');
  r = await begin(alice, 'Alice.New@Example.com');
  t.ok(r.status === 202 && JSON.stringify(r.json) === JSON.stringify({ expiresAt: clock.now + 10 * MINUTE, resendAfter: 60, resendsLeft: 2 }) && setCookies(r).some((c) => c.name === '__Host-bz_flow'), `202 {expiresAt, resendAfter, resendsLeft} with the flow cookie (${r.status} ${JSON.stringify(r.json)})`);
  const code = codeIn(await last('alice.new@example.com'));
  t.ok(code !== null && (await outbox(on, 'ecalice@example.com')).length === 0, 'the code goes to the new address, lower-cased; nothing to the old one yet');
  r = await finish(alice, String((Number(code) + 1) % 1e6).padStart(6, '0'));
  t.ok(r.status === 400 && r.json?.code === 'code_invalid' && r.json?.attemptsLeft === 4, `a wrong code: 400 code_invalid (${r.status} ${r.json?.code})`);
  r = await finish(as(), code);
  t.ok(r.status === 401 && r.json?.code === 'signin', `the code without the session: 401 signin (${r.status} ${r.json?.code})`);
  clock.now = T + 2 * MINUTE;
  r = await finish(alice, code);
  t.ok(r.status === 200 && JSON.stringify(r.json) === JSON.stringify({ email: 'alice.new@example.com' }) && setCookies(r).some((c) => c.name === '__Host-bz_flow' && c.attrs['max-age'] === '0'), `the code: 200 {email}, the flow cookie cleared (${r.status} ${JSON.stringify(r.json)})`);
  t.eq((await account(alice))?.email, 'alice.new@example.com', 'the account has the new address');
  const told = await outbox(on, 'ecalice@example.com');
  t.ok(told.length === 1 && told[0].subject === 'Your Bozzetto account has a new address' && told[0].body.includes('to a…@example.com') && told[0].body.includes('@ecalice') && !told[0].body.includes('alice.new@'), `the old address is told, the new one masked (${told[0]?.subject}: ${JSON.stringify(told[0]?.body.split('\n')[0])})`);
  const rows = await auditRows(on, U.alice);
  t.ok(rows.some((x) => x.action === 'account.email') && !JSON.stringify(rows).includes('@'), `audited as account.email, with no address in it (${rows.map((x) => x.action).join(', ')})`);
  const signIn = as();
  r = await signIn.call('POST', '/api/auth/email/start', { json: { email: 'alice.new@example.com', turnstile: pass('email-code') } });
  r = await signIn.call('POST', '/api/auth/email/verify', { json: { code: codeIn(await last('alice.new@example.com')) } });
  t.ok(r.status === 200 && r.json?.user?.id === U.alice, `the new address signs in (${r.status})`);
  r = await as().call('POST', '/api/auth/email/start', { json: { email: 'ecalice@example.com', turnstile: pass('email-code') } });
  t.ok(r.status === 202 && (await outbox(on, 'ecalice@example.com')).length === 1, `the old one no longer has an account to send a code for (${r.status})`);
  t.report();

  // --- an address another account has ---------------------------------------------------
  t = checks('functions: changing to an address another account has');
  clock.now = T + 3 * MINUTE;
  const dave = as('ec-dave');
  const free = await begin(dave, 'dave.free@example.com');
  r = await begin(dave, 'ECBob@example.com');
  t.ok(r.status === 202 && JSON.stringify(r.json) === JSON.stringify(free.json), `answered as any address is (${r.status} ${JSON.stringify(r.json)})`);
  const bobMail = await outbox(on, 'ecbob@example.com');
  t.ok(bobMail.length === 1 && bobMail[0].subject === 'You already have a Bozzetto account' && codeIn(bobMail[0]) === null, `no code goes there: the notice that it has an account (${bobMail.map((m) => m.subject).join('; ')})`);
  r = await finish(dave, '000000');
  t.ok(r.status === 400 && r.json?.code === 'code_invalid', `nothing typed completes it (${r.status} ${r.json?.code})`);
  t.eq((await account(as('ec-bob')))?.email, 'ecbob@example.com', "and the other account's address is its own still");
  t.report();

  // --- whose flow -------------------------------------------------------------------------------
  t = checks("functions: an address change is its own account's");
  clock.now = T + 4 * MINUTE;
  const erin = as('ec-erin');
  await begin(erin, 'erin.new@example.com');
  const erinCode = codeIn(await last('erin.new@example.com'));
  const bob = as('ec-bob');
  bob.jar.set('__Host-bz_flow', erin.cookie('__Host-bz_flow'));
  r = await finish(bob, erinCode);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired' && !setCookies(r).some((c) => c.name === '__Host-bz_flow'), `another account's session with the flow and the code: 410, and the flow is left alone (${r.status} ${r.json?.code})`);
  t.eq((await account(bob))?.email, 'ecbob@example.com', 'its address is untouched');
  r = await bob.call('POST', '/api/auth/email/resend', { json: { turnstile: pass('email-code') } });
  t.ok(r.status === 410 && (await outbox(on, 'erin.new@example.com')).length === 1, `nor can it have the code sent again (${r.status})`);
  // Ten minutes after the session authenticated, the code still finishes what the start began.
  clock.now = T + 12 * MINUTE;
  r = await finish(erin, erinCode);
  t.ok(r.status === 200 && r.json?.email === 'erin.new@example.com', `its own, after recent authentication has lapsed: 200 - the start asked for it, and the code proves the address (${r.status})`);
  t.report();

  // --- the address taken between the start and the code ----------------------------------
  t = checks('functions: an address taken between the start and the code');
  clock.now = T + 20 * MINUTE;
  const daveAgain = as('ec-dave');
  const aliceAgain = as('ec-alice');
  // Both sessions authenticated at T: no longer recent, so each re-authenticates by a code.
  r = await aliceAgain.call('POST', '/api/auth/email/start', { json: { reauth: true, turnstile: pass('email-code') } });
  r = await aliceAgain.call('POST', '/api/auth/email/verify', { json: { code: codeIn(await last('alice.new@example.com')), reauth: true } });
  t.eq(r.status, 204, 'one account re-authenticates');
  r = await daveAgain.call('POST', '/api/auth/email/start', { json: { reauth: true, turnstile: pass('email-code') } });
  r = await daveAgain.call('POST', '/api/auth/email/verify', { json: { code: codeIn(await last('ecdave@example.com')), reauth: true } });
  t.eq(r.status, 204, 'and so does another');
  await begin(aliceAgain, 'shared.new@example.com');
  const aliceShared = codeIn(await last('shared.new@example.com'));
  await begin(daveAgain, 'shared.new@example.com');
  const daveShared = codeIn(await last('shared.new@example.com'));
  r = await finish(daveAgain, daveShared);
  t.ok(r.status === 200, `both ask for the same free address; the first to finish has it (${r.status})`);
  r = await finish(aliceAgain, aliceShared);
  t.ok(r.status === 410 && r.json?.code === 'flow_expired', `the other: 410 flow_expired (${r.status} ${r.json?.code})`);
  t.eq((await account(aliceAgain))?.email, 'alice.new@example.com', 'and keeps the address it had');
  t.report();

  // --- the handle ----------------------------------------------------------------------------
  t = checks('functions: PATCH /api/me {handle}');
  clock.now = T + HOUR;
  const patch = (b, handle) => b.call('PATCH', '/api/me', { json: { handle } });
  const handleFree = async (h) => (await as().call('GET', `/api/auth/handle?h=${h}`)).json;
  const d = as('ec-dave');
  r = await patch(as(), 'whoever');
  t.ok(r.status === 401 && r.json?.code === 'signin', `no session: 401 signin (${r.status} ${r.json?.code})`);
  for (const [handle, status, code, reason] of [
    ['x', 400, 'bad_request', 'format'],
    ['Root', 400, 'bad_request', 'reserved'],
    ['ECBob', 409, 'handle_taken', 'taken'],
    ['ECDave', 400, 'bad_request', undefined],
  ]) {
    r = await patch(d, handle);
    t.ok(r.status === status && r.json?.code === code && r.json?.reason === reason, `${JSON.stringify(handle)}: ${status} ${code}${reason ? `, reason ${reason}` : ', its own already'} (${r.status} ${r.json?.code} ${r.json?.reason})`);
  }
  r = await patch(d, 'EcDaveTwo');
  t.ok(r.status === 200 && r.json?.id === U.dave && r.json?.handle === 'ecdavetwo' && r.json?.usage, `a free one: 200, the account as GET /api/me has it, lower-cased (${r.status} ${JSON.stringify(r.json)})`);
  t.eq((await d.call('GET', '/api/me')).json?.handle, 'ecdavetwo', 'GET /api/me says so');
  t.eq((await storedUser(on, { id: U.dave }))?.handle_changed_at, clock.now, 'the change is dated');
  t.eq(JSON.stringify(await handleFree('ecdave')), JSON.stringify({ available: false, reason: 'retired' }), 'the old handle is held: retired');
  t.ok((await auditRows(on, U.dave)).some((x) => x.action === 'account.handle'), 'audited');
  r = await patch(as('ec-erin'), 'ECDave');
  t.ok(r.status === 409 && r.json?.reason === 'retired', `nobody else may take it (${r.status} ${r.json?.reason})`);
  clock.now = T + HOUR + 29 * DAY;
  r = await patch(as('ec-dave-later'), 'ecdavethree');
  t.ok(r.status === 429 && r.json?.code === 'rate_limited' && r.json?.retryAfter === DAY / 1000 && r.headers.get('retry-after') === String(DAY / 1000), `again within 30 days: 429, Retry-After until they are up (${r.status} ${r.json?.code} ${r.json?.retryAfter})`);
  clock.now = T + HOUR + 30 * DAY;
  r = await patch(as('ec-dave-later'), 'ecdavethree');
  t.ok(r.status === 200 && r.json?.handle === 'ecdavethree', `30 days on: 200 (${r.status} ${r.json?.handle})`);
  t.eq((await handleFree('ecdavetwo'))?.reason, 'retired', 'the handle before it is held in turn');
  clock.now = T + HOUR + 90 * DAY;
  t.eq((await handleFree('ecdave'))?.available, true, 'and the first is free again 90 days after it was let go');
  t.report();

  // --- the log ------------------------------------------------------------------------------
  t = checks('functions: address changes, no address in the log');
  const log = workerLog(on).toLowerCase();
  const leaked = ['alice.new@', 'erin.new@', 'dave.free@', 'shared.new@', 'ecalice@', 'ecbob@', 'ecdave@'].filter((x) => log.includes(x));
  t.ok(leaked.length === 0, `no address is in the server's log (${leaked.join(', ') || 'none'})`);
  t.report();
}
