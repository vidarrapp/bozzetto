// Passkeys (docs/accounts.md §3), with the software authenticator: adding
// one (/api/me/passkeys/options, then POST /api/me/passkeys) and signing in
// with it (/api/auth/passkey/options, then verify), and every way either
// is refused - no user verification, the wrong origin or RP ID, a
// cross-origin frame, a challenge replayed, expired or carried in another
// browser's ceremony cookie, the wrong user handle, a passkey nobody has,
// a suspended account - always the same 400. A counter that does not go up
// is accepted, noted and audited. Re-authentication guards adding and
// removing, and offers only the account's passkeys. An account holds at
// most 10. Renaming, and removing down to none. Options naming a handle:
// that account's passkeys, or decoys no answer can use, alike in shape and
// the same for a handle every time; 20 per 10 minutes per handle.
import { randomBytes } from 'node:crypto';
import { Authenticator } from '../authenticator.mjs';
import { Browser, seedCredential, seedSession, seedUser, seededToken, setCookies } from '../lib.mjs';

export const needs = ['on'];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const T = 2_000_000_000_000;
const handleBytes = () => randomBytes(32).toString('base64url');

const ALICE = 'u-pkalice00000000000000000';
const BOB = 'u-pkbob0000000000000000000';
const SUSPENDED = 'u-pksuspended0000000000000';
const COUNTER = 'u-pkcounter000000000000000';
const NONE = 'u-pknone000000000000000000';
const LIMIT = 'u-pklimit00000000000000000';
const WA = { alice: handleBytes(), bob: handleBytes(), suspended: handleBytes(), counter: handleBytes(), none: handleBytes(), limit: handleBytes() };

const key = new Authenticator();
const bobKey = key.seed({ userHandle: WA.bob });
const suspendedKey = key.seed({ userHandle: WA.suspended });
const counterKey = key.seed({ userHandle: WA.counter });
const limitKeys = Array.from({ length: 9 }, () => key.seed({ userHandle: WA.limit }));

export const seed = {
  sql: [
    seedUser({ id: ALICE, handle: 'pkalice', webauthn: WA.alice }),
    seedUser({ id: BOB, handle: 'pkbob', webauthn: WA.bob }),
    seedUser({ id: SUSPENDED, handle: 'pksuspended', webauthn: WA.suspended, status: 'suspended' }),
    seedUser({ id: COUNTER, handle: 'pkcounter', webauthn: WA.counter }),
    seedUser({ id: NONE, handle: 'pknone', webauthn: WA.none }),
    seedUser({ id: LIMIT, handle: 'pklimit', webauthn: WA.limit }),
    seedCredential({ credential: bobKey, user: BOB, name: 'Bob key' }),
    seedCredential({ credential: suspendedKey, user: SUSPENDED }),
    seedCredential({ credential: counterKey, user: COUNTER }),
    ...limitKeys.map((credential, i) => seedCredential({ credential, user: LIMIT, name: `Key ${i + 1}`, at: i })),
    seedSession({ name: 'pk-alice', id: 's-pkalice', user: ALICE, created: T }),
    seedSession({ name: 'pk-bob', id: 's-pkbob', user: BOB, created: T }),
    seedSession({ name: 'pk-none', id: 's-pknone', user: NONE, created: T }),
    seedSession({ name: 'pk-limit', id: 's-pklimit', user: LIMIT, created: T + 20 * HOUR }),
  ].join('\n'),
};

export async function run({ checks, on }) {
  const clock = { now: T + MINUTE };
  let ips = 0;
  /** A browser at the suite's time, its own address, holding a seeded session if named. */
  const browser = (session) => {
    const b = new Browser(on, { ip: `198.51.100.${110 + (ips++ % 100)}`, clock });
    if (session) b.jar.set('__Host-bz_session', seededToken(session));
    return b;
  };
  const audit = async (subject) => (await on.call('GET', `/api/dev/audit?subject=${subject}`)).json?.rows ?? [];
  const list = async (b) => (await b.call('GET', '/api/me/passkeys')).json?.passkeys ?? [];
  /** Options, a passkey made from them by `make`, and the save: both answers. */
  const add = async (b, make = (o) => create(o, { origin: b.origin }), body = {}) => {
    const options = await b.call('POST', '/api/me/passkeys/options', { json: {} });
    if (options.status !== 200) return { options, saved: null };
    const made = make(options.json);
    const saved = await b.call('POST', '/api/me/passkeys', { json: { response: made.response, ...body } });
    return { options, saved, made };
  };
  /** Sign-in options, an assertion made from them by `make`, and the verify: both answers. */
  const signIn = async (b, make, body = {}) => {
    const options = await b.call('POST', '/api/auth/passkey/options', { json: body.reauth ? { reauth: true } : {} });
    if (options.status !== 200) return { options, verified: null };
    const verified = await b.call('POST', '/api/auth/passkey/verify', { json: { response: make(options.json), ...body } });
    return { options, verified };
  };
  // The one authenticator holds every passkey of these accounts, so it would
  // refuse a second for the same account, as a real one does; what the
  // options exclude is checked on its own, and the server refuses a
  // duplicate regardless.
  const create = (opts, extra) => key.makeCredential(opts, { ignoreExclude: true, ...extra });
  const failures = [];
  const refused = (r) => {
    failures.push(JSON.stringify(r?.json));
    return r?.status === 400 && r.json?.code === 'bad_request';
  };

  // --- adding a passkey ----------------------------------------------------------
  let t = checks('functions: adding a passkey');
  const alice = browser('pk-alice');
  let { options, saved } = await add(alice);
  const o = options.json ?? {};
  t.ok(options.status === 200 && o.rp?.name === 'Bozzetto' && o.rp?.id === 'localhost', `options: RP 'Bozzetto' at RP_ID (${options.status} ${JSON.stringify(o.rp)})`);
  t.ok(o.user?.id === WA.alice && o.user?.name === 'pkalice', `the account's user handle and handle (${JSON.stringify(o.user)})`);
  t.ok(o.attestation === 'none' && o.timeout === 300000 && Array.isArray(o.excludeCredentials) && o.excludeCredentials.length === 0, `attestation none, 300 s, nothing to exclude yet (${o.attestation} ${o.timeout})`);
  t.eq(JSON.stringify(o.authenticatorSelection), JSON.stringify({ residentKey: 'required', userVerification: 'required', requireResidentKey: true }), 'a discoverable credential with user verification, and no authenticator attachment forced');
  t.ok(Array.isArray(o.hints) && o.hints.length === 0 && o.pubKeyCredParams?.some((p) => p.alg === -7) && /^[A-Za-z0-9_-]{43}$/.test(o.challenge), 'no hints (no preferredAuthenticatorType), ES256 among the algorithms, a 32-byte challenge');
  t.ok(setCookies(options).some((c) => c.name === '__Host-bz_wa' && c.attrs.samesite === 'Strict' && c.attrs['max-age'] === '300'), 'and the challenge is bound to this browser by __Host-bz_wa');
  const first = saved?.json?.passkey;
  t.ok(saved?.status === 201 && first?.name === 'Safari on Mac' && first?.deviceType === 'singleDevice' && first?.backedUp === false && first?.createdAt === clock.now && first?.lastUsedAt === null, `saved: 201 {passkey}, named after the user agent (${saved?.status} ${JSON.stringify(first)})`);
  t.ok(setCookies(saved).some((c) => c.name === '__Host-bz_wa' && c.attrs['max-age'] === '0'), 'the ceremony cookie is cleared');
  t.eq((await list(alice)).map((p) => p.id).join(','), first?.id, 'GET /api/me/passkeys lists it');
  t.ok((await audit(ALICE)).some((x) => x.action === 'passkey.add' && x.detail.credential === first?.id), 'the addition is audited');
  ({ options, saved } = await add(alice, undefined, { name: '  Work \n  key  ' }));
  t.ok(options.json?.excludeCredentials?.some((c) => c.id === first?.id && c.type === 'public-key'), 'the next options exclude the passkey already saved');
  t.eq(saved?.json?.passkey?.name, 'Work key', 'a name given is trimmed, its spaces and line breaks made one');
  ({ saved } = await add(alice, undefined, { name: 'n'.repeat(100) }));
  t.eq(saved?.json?.passkey?.name, 'n'.repeat(64), 'and cut to 64 characters');
  t.report();

  t = checks('functions: adding a passkey, refused');
  const before = (await list(alice)).length;
  let r = (await add(alice, (opts) => create(opts, { origin: alice.origin, uv: false }))).saved;
  t.ok(refused(r), `without user verification: 400 (${r?.status} ${r?.json?.code})`);
  r = (await add(alice, (opts) => create(opts, { origin: 'http://evil.example' }))).saved;
  t.ok(refused(r), `made at another origin: 400 (${r?.status})`);
  r = (await add(alice, (opts) => create(opts, { origin: alice.origin, rpId: 'evil.example' }))).saved;
  t.ok(refused(r), `for another RP ID: 400 (${r?.status})`);
  r = (await add(alice, (opts) => create(opts, { origin: alice.origin, crossOrigin: true }))).saved;
  t.ok(refused(r), `in a cross-origin frame: 400 (${r?.status})`);
  r = (await add(alice, (opts) => create(opts, { origin: alice.origin, type: 'webauthn.get' }))).saved;
  t.ok(refused(r), `an assertion offered as a registration: 400 (${r?.status})`);
  let made;
  ({ saved: r, made } = await add(alice, (opts) => create(opts, { origin: alice.origin, challenge: 'A'.repeat(43) })));
  t.ok(refused(r), `for another challenge: 400 (${r?.status})`);
  // Replayed: the same answer again, with the ceremony cookie it came with.
  options = await alice.call('POST', '/api/me/passkeys/options', { json: {} });
  const waValue = alice.cookie('__Host-bz_wa');
  made = create(options.json, { origin: alice.origin });
  r = await alice.call('POST', '/api/me/passkeys', { json: { response: made.response } });
  t.eq(r.status, 201, 'a good answer is saved');
  alice.jar.set('__Host-bz_wa', waValue);
  r = await alice.call('POST', '/api/me/passkeys', { json: { response: made.response } });
  t.ok(refused(r), `the same answer again, with its ceremony cookie: 400, the challenge was used (${r.status})`);
  r = await alice.call('POST', '/api/me/passkeys', { json: { response: create(options.json, { origin: alice.origin }).response } });
  t.ok(refused(r), `with no ceremony cookie at all: 400 (${r.status})`);
  // A ceremony begun by one account, answered under another's session.
  options = await alice.call('POST', '/api/me/passkeys/options', { json: {} });
  const bobHere = browser('pk-bob');
  bobHere.jar.set('__Host-bz_wa', alice.cookie('__Host-bz_wa'));
  r = await bobHere.call('POST', '/api/me/passkeys', { json: { response: create(options.json, { origin: alice.origin }).response } });
  t.ok(refused(r), `another account's ceremony: 400 (${r.status})`);
  t.eq((await list(alice)).length, before + 1, 'of all of these, only the good answer was saved');
  r = await browser().call('POST', '/api/me/passkeys/options', { json: {} });
  t.ok(r.status === 401 && r.json?.code === 'signin', `signed out: 401 signin (${r.status} ${r.json?.code})`);
  t.report();

  // --- signing in ---------------------------------------------------------------------
  t = checks('functions: signing in with a passkey');
  clock.now = T + HOUR;
  const guest = browser();
  const aliceCredential = key.credentials.find((c) => c.id === first?.id);
  let s = await signIn(guest, (opts) => key.getAssertion(opts, { origin: guest.origin, credential: aliceCredential }));
  const so = s.options.json ?? {};
  t.eq(Object.keys(so).sort().join(','), 'allowCredentials,challenge,rpId,timeout,userVerification', 'options: {rpId, challenge, allowCredentials, timeout, userVerification}');
  t.ok(so.rpId === 'localhost' && so.allowCredentials?.length === 0 && so.userVerification === 'required' && so.timeout === 300000 && /^[A-Za-z0-9_-]{43}$/.test(so.challenge), `RP_ID, no credentials named, verification required, 300 s, a 32-byte challenge (${JSON.stringify(so)})`);
  t.ok(s.verified.status === 200 && s.verified.json?.user?.id === ALICE && guest.cookie('__Host-bz_session'), `a good assertion signs in: 200 {user} and a session (${s.verified.status})`);
  const used = (await list(guest)).find((p) => p.id === first?.id);
  t.eq(used?.lastUsedAt, T + HOUR, 'the passkey records when it was last used');
  t.ok((await audit(ALICE)).some((x) => x.action === 'session.signin' && x.detail.method === 'passkey'), 'the sign-in is audited');
  t.report();

  t = checks('functions: signing in, refused');
  const tries = [
    ['without user verification', (b) => (opts) => key.getAssertion(opts, { origin: b.origin, credential: aliceCredential, uv: false })],
    ['without user presence', (b) => (opts) => key.getAssertion(opts, { origin: b.origin, credential: aliceCredential, up: false, uv: false })],
    ['made at another origin', () => (opts) => key.getAssertion(opts, { origin: 'http://evil.example', credential: aliceCredential })],
    ['for another RP ID', (b) => (opts) => key.getAssertion(opts, { origin: b.origin, credential: aliceCredential, rpId: 'evil.example' })],
    ['in a cross-origin frame that names no top origin', (b) => (opts) => key.getAssertion(opts, { origin: b.origin, credential: aliceCredential, crossOrigin: true })],
    ['in a cross-origin frame under another site', (b) => (opts) => key.getAssertion(opts, { origin: b.origin, credential: aliceCredential, crossOrigin: true, topOrigin: 'https://evil.example' })],
    ['for another challenge', (b) => (opts) => key.getAssertion(opts, { origin: b.origin, credential: aliceCredential, challenge: 'A'.repeat(43) })],
    ['a registration offered as an assertion', (b) => (opts) => key.getAssertion(opts, { origin: b.origin, credential: aliceCredential, type: 'webauthn.create' })],
    ["with another account's user handle", (b) => (opts) => key.getAssertion(opts, { origin: b.origin, credential: aliceCredential, userHandle: WA.bob })],
    ['with no user handle', (b) => (opts) => key.getAssertion(opts, { origin: b.origin, credential: aliceCredential, userHandle: null })],
    ['with a passkey no account has', (b) => (opts) => new Authenticator().getAssertion(opts, { origin: b.origin, credential: new Authenticator().seed({ userHandle: WA.alice }) })],
    ['as a suspended account', (b) => (opts) => key.getAssertion(opts, { origin: b.origin, credential: suspendedKey })],
  ];
  for (const [what, make] of tries) {
    const b = browser();
    s = await signIn(b, make(b));
    const cleared = setCookies(s.verified).some((c) => c.name === '__Host-bz_wa' && c.attrs['max-age'] === '0');
    t.ok(refused(s.verified) && !b.cookie('__Host-bz_session') && cleared, `${what}: 400, no session, the ceremony over (${s.verified?.status} ${s.verified?.json?.code})`);
  }
  // A good assertion, then the same one again with the cookie it came with.
  let b = browser();
  options = await b.call('POST', '/api/auth/passkey/options', { json: {} });
  const replayCookie = b.cookie('__Host-bz_wa');
  const assertion = key.getAssertion(options.json, { origin: b.origin, credential: aliceCredential });
  r = await b.call('POST', '/api/auth/passkey/verify', { json: { response: assertion } });
  t.eq(r.status, 200, 'a good assertion signs in');
  const replayer = browser();
  replayer.jar.set('__Host-bz_wa', replayCookie);
  r = await replayer.call('POST', '/api/auth/passkey/verify', { json: { response: assertion } });
  t.ok(refused(r) && !replayer.cookie('__Host-bz_session'), `replayed, with its ceremony cookie: 400 (${r.status})`);
  // Expired: five minutes is the challenge's life.
  b = browser();
  options = await b.call('POST', '/api/auth/passkey/options', { json: {} });
  clock.now += 5 * MINUTE - 1000;
  r = await b.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(options.json, { origin: b.origin, credential: aliceCredential }) } });
  t.eq(r.status, 200, 'answered a second short of five minutes: good');
  b = browser();
  options = await b.call('POST', '/api/auth/passkey/options', { json: {} });
  clock.now += 5 * MINUTE + 1000;
  r = await b.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(options.json, { origin: b.origin, credential: aliceCredential }) } });
  t.ok(refused(r), `answered a second past five minutes: 400 (${r.status})`);
  // Another browser's ceremony cookie.
  const x = browser();
  const y = browser();
  const ox = await x.call('POST', '/api/auth/passkey/options', { json: {} });
  await y.call('POST', '/api/auth/passkey/options', { json: {} });
  const own = x.cookie('__Host-bz_wa');
  const forX = key.getAssertion(ox.json, { origin: x.origin, credential: aliceCredential });
  x.jar.set('__Host-bz_wa', y.cookie('__Host-bz_wa'));
  r = await x.call('POST', '/api/auth/passkey/verify', { json: { response: forX } });
  t.ok(refused(r), `an answer sent with another browser's ceremony cookie: 400 (${r.status})`);
  x.jar.set('__Host-bz_wa', own);
  r = await x.call('POST', '/api/auth/passkey/verify', { json: { response: forX } });
  t.eq(r.status, 200, 'the same answer with its own cookie is good: the binding is what failed');
  r = await browser().call('POST', '/api/auth/passkey/verify', { json: { response: forX } });
  t.ok(refused(r), `with no ceremony cookie: 400 (${r.status})`);
  // A re-authentication ceremony is not a sign-in.
  b = browser('pk-bob');
  options = await b.call('POST', '/api/auth/passkey/options', { json: { reauth: true } });
  r = await b.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(options.json, { origin: b.origin, credential: bobKey }) } });
  t.ok(refused(r), `a re-authentication's challenge answered as a sign-in: 400 (${r.status})`);
  r = await browser().call('POST', '/api/auth/passkey/verify', { json: { response: 'not an assertion' } });
  t.ok(refused(r), `nonsense: 400 (${r.status})`);
  t.eq(new Set(failures).size, 1, `every refusal is the same answer (${[...new Set(failures)].join(' | ')})`);
  t.report();

  // --- the counter ------------------------------------------------------------------------
  t = checks('functions: the signature counter');
  const counted = async (counter) => {
    const c = browser();
    const res = await signIn(c, (opts) => key.getAssertion(opts, { origin: c.origin, credential: counterKey, counter }));
    return { status: res.verified?.status, passkey: (await list(c)).find((p) => p.id === counterKey.id) };
  };
  let k = await counted(5);
  t.ok(k.status === 200 && k.passkey?.counterWarningAt === null, `a counter going up from 0: signed in, nothing noted (${k.status})`);
  clock.now += MINUTE;
  k = await counted(5);
  t.ok(k.status === 200 && k.passkey?.counterWarningAt === clock.now, `the same counter again: still signed in, but noted on the passkey (${k.status} ${k.passkey?.counterWarningAt})`);
  clock.now += MINUTE;
  k = await counted(3);
  t.ok(k.status === 200 && k.passkey?.counterWarningAt === clock.now, `a counter gone backwards: the same (${k.status})`);
  k = await counted(6);
  t.ok(k.status === 200 && k.passkey?.counterWarningAt === clock.now, 'the stored counter stayed at its highest, so 6 is no warning, and the old note stays');
  const warned = (await audit(COUNTER)).filter((x) => x.action === 'passkey.counter');
  t.ok(warned.length === 2 && warned[0].detail.stored === 5 && warned[0].detail.received === 5 && warned[1].detail.received === 3, `each is audited with what was stored and what came (${warned.map((w) => JSON.stringify(w.detail)).join(' ')})`);
  const zero = browser();
  r = (await signIn(zero, (opts) => key.getAssertion(opts, { origin: zero.origin, credential: bobKey, counter: 0 }))).verified;
  const bobs = (await list(zero)).find((p) => p.id === bobKey.id);
  t.ok(r.status === 200 && bobs?.counterWarningAt === null, `a synced passkey's counter, 0 every time: nothing noted (${r.status})`);
  r = (await signIn(zero, (opts) => key.getAssertion(opts, { origin: zero.origin, credential: bobKey, counter: 0 }))).verified;
  t.ok(r.status === 200 && (await list(zero)).find((p) => p.id === bobKey.id)?.counterWarningAt === null, 'nor the second time');
  t.report();

  // --- re-authentication -------------------------------------------------------------------
  t = checks('functions: re-authentication');
  clock.now = T + 3 * HOUR;
  const stale = browser('pk-alice'); // signed in at T: not recent now
  const credentialIds = (await list(stale)).map((p) => p.id);
  r = await stale.call('POST', '/api/me/passkeys/options', { json: {} });
  t.ok(r.status === 401 && r.json?.code === 'reauth', `adding a passkey needs recent authentication: 401 reauth (${r.status} ${r.json?.code})`);
  r = await stale.call('DELETE', `/api/me/passkeys/${encodeURIComponent(credentialIds[0])}`);
  t.ok(r.status === 401 && r.json?.code === 'reauth', `and so does removing one (${r.status} ${r.json?.code})`);
  r = await browser().call('POST', '/api/auth/passkey/options', { json: { reauth: true } });
  t.ok(r.status === 401 && r.json?.code === 'signin', `re-authenticating needs a session: 401 signin (${r.status})`);
  options = await stale.call('POST', '/api/auth/passkey/options', { json: { reauth: true } });
  const offered = (options.json?.allowCredentials ?? []).map((c) => c.id).sort();
  t.eq(offered.join(','), [...credentialIds].sort().join(','), "it offers the account's own passkeys and no others");
  t.eq(options.json?.userVerification, 'required', 'with verification required');
  r = await stale.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(options.json, { origin: stale.origin, credential: bobKey }), reauth: true } });
  t.ok(refused(r), `answered with another account's passkey: 400 (${r.status})`);
  options = await stale.call('POST', '/api/auth/passkey/options', { json: { reauth: true } });
  r = await stale.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(options.json, { origin: stale.origin, credential: aliceCredential, userHandle: null }), reauth: true } });
  const recent = (await stale.call('GET', '/api/dev/principal')).json?.principal;
  t.ok(r.status === 204 && setCookies(r).every((c) => c.name !== '__Host-bz_session') && recent?.recentAuth === true, `answered with its own (no user handle needed, the account being known): 204, the same session, now recent (${r.status} ${recent?.recentAuth})`);
  r = await stale.call('POST', '/api/me/passkeys/options', { json: {} });
  t.eq(r.status, 200, 'and adding a passkey is let through');
  const signedOut = browser('pk-bob');
  options = await signedOut.call('POST', '/api/auth/passkey/options', { json: { reauth: true } });
  signedOut.jar.delete('__Host-bz_session');
  r = await signedOut.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(options.json, { origin: signedOut.origin, credential: bobKey }), reauth: true } });
  t.ok(r.status === 401 && r.json?.code === 'signin', `answered without the session it began with: 401 signin (${r.status})`);
  r = await browser('pk-none').call('POST', '/api/auth/passkey/options', { json: { reauth: true } });
  t.ok(r.status === 400 && r.json?.code === 'bad_request', `an account with no passkey cannot re-authenticate by one: 400 (${r.status})`);
  t.report();

  // --- the limit ----------------------------------------------------------------------------
  t = checks('functions: at most 10 passkeys');
  clock.now = T + 20 * HOUR + MINUTE; // pk-limit signed in at T + 20 h, nine passkeys seeded
  const one = browser('pk-limit');
  const two = browser('pk-limit');
  const o1 = await one.call('POST', '/api/me/passkeys/options', { json: {} });
  const o2 = await two.call('POST', '/api/me/passkeys/options', { json: {} });
  t.ok(o1.status === 200 && o2.status === 200 && o1.json?.excludeCredentials?.length === 9, `with nine, two browsers may each begin a tenth (${o1.status} ${o2.status} ${o1.json?.excludeCredentials?.length})`);
  r = await one.call('POST', '/api/me/passkeys', { json: { response: create(o1.json, { origin: one.origin }).response } });
  t.eq(r.status, 201, 'the first to finish is saved');
  r = await two.call('POST', '/api/me/passkeys', { json: { response: create(o2.json, { origin: two.origin }).response } });
  t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.json?.limit === 10, `the second is refused: at most 10 (${r.status} ${JSON.stringify(r.json)})`);
  r = await one.call('POST', '/api/me/passkeys/options', { json: {} });
  t.ok(r.status === 400 && r.json?.limit === 10 && r.headers.get('set-cookie') === null, `and with ten, no eleventh is begun (${r.status})`);
  t.eq((await list(one)).length, 10, 'ten it is');
  t.report();

  // --- renaming and removing -----------------------------------------------------------------
  t = checks('functions: renaming and removing passkeys');
  clock.now = T + 21 * HOUR;
  const owner = browser('pk-alice'); // not recent: renaming does not need it
  const mine = await list(owner);
  const target = encodeURIComponent(mine[0].id);
  r = await owner.call('PATCH', `/api/me/passkeys/${target}`, { json: { name: '  iPad   key ' } });
  t.ok(r.status === 200 && r.json?.passkey?.name === 'iPad key' && r.json?.passkey?.id === mine[0].id, `renamed: {passkey} with the new name (${r.status} ${r.json?.passkey?.name})`);
  for (const [what, body] of [
    ['an empty name', { name: '   ' }],
    ['a name that is no string', { name: 42 }],
    ['no name', {}],
  ]) {
    r = await owner.call('PATCH', `/api/me/passkeys/${target}`, { json: body });
    t.ok(r.status === 400 && r.json?.code === 'bad_request', `${what}: 400 (${r.status})`);
  }
  r = await owner.call('PATCH', `/api/me/passkeys/${encodeURIComponent(bobKey.id)}`, { json: { name: 'Mine now' } });
  t.ok(r.status === 404 && r.json?.code === 'not_found', `another account's passkey: 404 (${r.status})`);
  t.eq((await list(browser('pk-bob'))).find((p) => p.id === bobKey.id)?.name, 'Bob key', 'and its name is untouched');
  r = await owner.call('PATCH', '/api/me/passkeys/no-such-passkey', { json: { name: 'x' } });
  t.eq(r.status, 404, 'one that does not exist: 404');
  // Removing, with recent authentication.
  options = await owner.call('POST', '/api/auth/passkey/options', { json: { reauth: true } });
  await owner.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(options.json, { origin: owner.origin, credential: aliceCredential }), reauth: true } });
  r = await owner.call('DELETE', `/api/me/passkeys/${encodeURIComponent(bobKey.id)}`);
  t.ok(r.status === 404 && r.json?.code === 'not_found', `removing another account's: 404 (${r.status})`);
  const removed = [];
  for (const p of mine) removed.push((await owner.call('DELETE', `/api/me/passkeys/${encodeURIComponent(p.id)}`)).status);
  t.ok(removed.every((st) => st === 204), `each of its own is removed, the last one too: 204 (${removed.join(', ')})`);
  t.eq((await list(owner)).length, 0, 'none left');
  r = await owner.call('DELETE', `/api/me/passkeys/${target}`);
  t.eq(r.status, 404, 'removing one again: 404');
  const gone = (await audit(ALICE)).filter((x) => x.action === 'passkey.remove');
  t.eq(gone.length, mine.length, 'each removal is audited, once');
  b = browser();
  s = await signIn(b, (opts) => key.getAssertion(opts, { origin: b.origin, credential: aliceCredential }));
  t.ok(s.verified.status === 400, `a removed passkey signs nobody in (${s.verified.status})`);
  t.report();

  // --- options naming a handle -----------------------------------------------------------------
  t = checks('functions: options naming a handle');
  clock.now = T + 22 * HOUR;
  const named = (handle, b = browser()) => b.call('POST', '/api/auth/passkey/options', { json: { handle } });
  const idsOf = (r) => (r?.json?.allowCredentials ?? []).map((c) => c.id);
  const shapeOf = (r) => JSON.stringify([Object.keys(r?.json ?? {}).sort(), (r?.json?.allowCredentials ?? []).map((c) => Object.keys(c).sort())[0]]);
  b = browser();
  r = await named('pkbob', b);
  const listed = r.json?.allowCredentials ?? [];
  t.ok(
    r.status === 200 && listed.length === 1 && listed[0].id === bobKey.id && listed[0].type === 'public-key' && JSON.stringify(listed[0].transports) === '["internal"]',
    `a handle's options name its passkeys, id and transports (${r.status} ${JSON.stringify(listed)})`,
  );
  t.ok(r.json?.userVerification === 'required' && setCookies(r).some((c) => c.name === '__Host-bz_wa' && c.attrs['max-age'] === '300'), 'verification required, and the challenge bound to this browser as ever');
  r = await b.call('POST', '/api/auth/passkey/verify', { json: { response: key.getAssertion(r.json, { origin: b.origin, credential: bobKey }) } });
  t.ok(r.status === 200 && r.json?.user?.id === BOB, `and the passkey named signs in (${r.status})`);
  t.eq(idsOf(await named('  PkBob ')).join(','), bobKey.id, 'the handle is read as stored: trimmed, in any capitals');
  const ten = await named('pklimit');
  t.eq(idsOf(ten).length, 10, 'every passkey of the account, all ten');
  t.eq(idsOf(await named('pksuspended')).join(','), suspendedKey.id, "a suspended account's too (verify refuses them)");

  // Handles with none: decoys.
  const real = new Set(key.credentials.map((c) => c.id));
  const ghost = await named('nobody-here');
  const decoys = ghost.json?.allowCredentials ?? [];
  t.ok(ghost.status === 200 && decoys.length >= 1 && decoys.length <= 2, `a handle no account has gets one or two passkeys all the same (${ghost.status} ${decoys.length})`);
  t.ok(
    decoys.every((c) => c.type === 'public-key' && JSON.stringify(c.transports) === '["internal","hybrid"]' && /^[A-Za-z0-9_-]+$/.test(c.id) && [16, 20, 32].includes(Buffer.from(c.id, 'base64url').length)),
    `each like a real one: an id of 16, 20 or 32 bytes in base64url, on this device or a phone (${JSON.stringify(decoys)})`,
  );
  t.eq(shapeOf(ghost), shapeOf(ten), 'the answer has the shape of a real one');
  t.ok(setCookies(ghost).some((c) => c.name === '__Host-bz_wa'), 'and a ceremony is begun for it, as for any');
  t.eq(idsOf(await named('nobody-here')).join(','), idsOf(ghost).join(','), 'the same handle gets the same ones every time');
  t.eq(idsOf(await named(' NOBODY-here')).join(','), idsOf(ghost).join(','), 'in any capitals');
  const handles = ['pknone', 'pkalice', 'x', 'Not a handle!', ...Array.from({ length: 30 }, (_, i) => `ghost-${i}`)];
  const lists = [];
  for (const h of handles) lists.push(idsOf(await named(h)));
  const every = [...idsOf(ghost), ...lists.flat()];
  t.ok(lists.every((l) => l.length >= 1 && l.length <= 2) && lists.some((l) => l.length === 1) && lists.some((l) => l.length === 2), `with no passkey, or no such account, or no handle's shape: one or two, some of each (${lists.map((l) => l.length).join('')})`);
  t.eq(new Set(every).size, every.length, `a handle's are its own: ${every.length} ids, none the same`);
  t.ok(every.every((id) => !real.has(id)), 'and none is a real passkey\'s');
  t.eq(new Set(every.map((id) => Buffer.from(id, 'base64url').length)).size, 3, 'of every length, 16, 20 and 32 bytes');
  b = browser();
  r = await named('nobody-here', b);
  const fake = new Authenticator().seed({ userHandle: WA.none });
  fake.id = idsOf(r)[0];
  r = await b.call('POST', '/api/auth/passkey/verify', { json: { response: new Authenticator().getAssertion(r.json, { origin: b.origin, credential: fake }) } });
  t.ok(refused(r) && !b.cookie('__Host-bz_session'), `an answer from a decoy is refused: 400, no session (${r.status} ${r.json?.code})`);
  t.eq(new Set(failures).size, 1, 'the same answer as every other refusal');
  r = await named(42);
  t.ok(r.status === 400 && r.json?.code === 'bad_request' && r.headers.get('set-cookie') === null, `a handle that is not a string: 400 (${r.status})`);
  r = await browser('pk-bob').call('POST', '/api/auth/passkey/options', { json: { reauth: true, handle: 'pklimit' } });
  t.eq(idsOf(r).join(','), bobKey.id, "re-authenticating, a handle is not looked at: the account's own passkeys");

  // 20 per 10 minutes per handle, whoever asks.
  clock.now = T + 23 * HOUR;
  const busy = [];
  for (let i = 0; i < 20; i++) busy.push((await named(i % 2 ? 'pk-busy' : ' PK-Busy')).status);
  t.ok(busy.every((st) => st === 200), `20 options naming one handle in 10 minutes, from 20 addresses and in any capitals, are answered (${[...new Set(busy)].join(', ')})`);
  r = await named('pk-busy');
  const wait = String(Math.ceil((10 * MINUTE - (clock.now % (10 * MINUTE))) / 1000));
  t.ok(r.status === 429 && r.json?.code === 'rate_limited' && r.headers.get('retry-after') === wait && r.headers.get('set-cookie') === null, `the 21st is 429 rate_limited, Retry-After the rest of the window, no ceremony begun (${r.status} ${r.headers.get('retry-after')})`);
  t.eq((await named('pk-quiet')).status, 200, 'another handle has its own count');
  t.eq((await browser().call('POST', '/api/auth/passkey/options', { json: {} })).status, 200, 'and options naming none are not held back');
  clock.now += 10 * MINUTE;
  t.eq((await named('pk-busy')).status, 200, 'the next window starts afresh');
  t.report();
}
