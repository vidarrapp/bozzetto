// Who is asking (docs/accounts.md §2), with accounts off as Batch 1 leaves
// them, and the root middleware's other two jobs: the files host split
// and the test clock. /api/dev/principal reports what the middleware
// decided; it exists only with DEV_TEST_HOOKS on a loopback host.
import { DEPLOYED_HOST, FILES_HOST, OWNER, asOwner, asStranger } from '../lib.mjs';

export const needs = ['off', 'on'];

/** Every Access-shaped thing a client could send, none of which counts outside /admin/. */
const ACCESS_LOOKALIKE = {
  ...asOwner,
  'cf-access-jwt-assertion': 'header.payload.signature',
  cookie: 'CF_Authorization=header.payload.signature; __Host-bz_session=bz1_not-a-session',
};

/**
 * Whether `line` is among what `server` logged after `from` (an offset into
 * its log), waiting up to two seconds: the runtime's output reaches the
 * harness a little after the answer does.
 */
async function logs(server, from, line) {
  const until = Date.now() + 2000;
  while (!server.log.slice(from).includes(line)) {
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

export async function run({ checks, off, on, compileShared }) {
  const whoIs = async (server, headers = {}) => (await server.call('GET', '/api/dev/principal', { headers })).json;

  // --- the two locks, with accounts off -------------------------------------
  let t = checks('functions: principal, accounts off');
  let p = await whoIs(off);
  t.eq(p?.principal?.kind, 'guest', 'no cookie and no Access headers: a guest');
  p = await whoIs(off, ACCESS_LOOKALIKE);
  t.eq(p?.principal?.kind, 'guest', 'the Access headers, its cookie and a session cookie are ignored on /api: still a guest');
  let r = await off.call('GET', '/admin/api/whoami', { headers: asOwner });
  t.ok(r.status === 200 && r.json?.email === OWNER, `on /admin/ the Access identity alone is the owner, lock 1 with no owner account behind it (${r.status} ${r.json?.email})`);
  let from = off.log.length;
  r = await off.call('GET', '/admin/api/whoami', { headers: { cookie: '__Host-bz_session=bz1_not-a-session' } });
  t.eq(r.status, 403, 'a session cookie is no way into /admin/ without Access');
  t.ok(await logs(off, from, 'access gate refused: no_identity'), "and the server's log says why, in a word: access gate refused: no_identity");
  from = off.log.length;
  r = await off.call('GET', '/admin/api/whoami', { headers: asStranger });
  t.eq(r.status, 403, 'and an identity ADMIN_EMAILS does not name is nobody there either');
  t.ok((await logs(off, from, 'access gate refused: not_allowed')) && !off.log.slice(from).includes('someone@'), 'logged as not_allowed, and without the address');
  const stubs = [
    ['GET', '/api/auth/session'],
    ['POST', '/api/auth/passkey/options'],
    ['POST', '/api/auth/email/start'],
    ['GET', '/api/me'],
    ['GET', '/api/me/account'],
    ['GET', '/api/me/projects'],
    ['DELETE', '/api/me/sessions/s-1'],
  ];
  for (const [method, path] of stubs) {
    r = await off.call(method, path, method === 'GET' ? {} : { json: {} });
    t.ok(r.status === 404 && r.json?.code === 'accounts_off' && r.headers.get('cache-control') === 'no-store', `${method} ${path} is 404 accounts_off, kept by no cache (${r.status} ${r.json?.code})`);
  }
  t.report();

  // Lock 2, and who a session cookie makes the asker, are the locks and
  // sessions suites'; the locks suite makes this server's owner.
  t = checks('functions: principal, accounts on');
  r = await on.call('GET', '/api/me/no-such-route');
  t.ok(r.status === 404 && r.json?.code === 'not_found' && r.headers.get('cache-control') === 'no-store', `every /api/me/* route is there, so any other path is 404 not_found (${r.status} ${r.json?.code})`);
  r = await on.call('GET', '/api/me/projects');
  t.ok(r.status === 401 && r.json?.code === 'signin', `and one that is there asks a guest to sign in (${r.status} ${r.json?.code})`);
  r = await on.call('POST', '/api/auth/no-such-route', { json: {} });
  t.ok(r.status === 404 && r.json?.code === 'not_found' && r.headers.get('cache-control') === 'no-store', `every /api/auth/* route is there, so any other path is 404 not_found (${r.status} ${r.json?.code})`);
  r = await on.call('GET', '/api/auth/email/start');
  t.ok(r.status === 404 && r.json?.code === 'not_found', `and so is a route asked with a method it does not answer (${r.status} ${r.json?.code})`);
  r = await on.call('GET', '/api/me');
  t.ok(r.status === 401 && r.json?.code === 'signin', `a route that is there asks a guest to sign in (${r.status} ${r.json?.code})`);
  p = await whoIs(on, ACCESS_LOOKALIKE);
  t.eq(p?.principal?.kind, 'guest', 'a cookie no session stands behind is a guest');
  t.report();

  // --- the files host -------------------------------------------------------
  t = checks('functions: the files host');
  for (const [method, path] of [
    ['GET', '/api/projects'],
    ['GET', '/api/config'],
    ['GET', '/api/dev/principal'],
    ['GET', '/admin/api/whoami'],
    ['POST', '/admin/api/projects'],
    ['GET', '/admin/login'],
    ['GET', '/media/med-pub/thumb.jpg'],
    ['GET', '/m'],
    ['PUT', '/m/any/thumb.jpg'],
    ['HEAD', '/m/any/thumb.jpg'],
  ]) {
    r = await off.callHost(FILES_HOST, method, path, { headers: asOwner });
    t.ok(r.status === 404 && r.headers.get('cache-control') === 'no-store', `${method} ${path} on the files host is not found (${r.status})`);
  }
  // GET /m/* passes the split, to the files route: its 404, for a project
  // that is not there, says what every answer there says of who may read
  // it, which the middleware's does not.
  r = await off.callHost(FILES_HOST, 'GET', '/m/any/thumb.jpg');
  t.ok(r.status === 404 && r.headers.get('access-control-allow-origin') !== null && r.headers.get('strict-transport-security') !== null, `GET /m/* gets past it, to the files route (${r.status})`);
  t.report();

  // --- the test clock -------------------------------------------------------
  t = checks('functions: X-Test-Now');
  p = await whoIs(off, { 'x-test-now': '1700000000000' });
  t.eq(p?.now, 1700000000000, 'with the test hooks on, on loopback, X-Test-Now is the time');
  p = await whoIs(off);
  t.ok(typeof p?.now === 'number' && Math.abs(p.now - Date.now()) < 60_000, `without it, the clock (${p?.now})`);
  p = await whoIs(off, { 'x-test-now': 'yesterday' });
  t.ok(Math.abs(p?.now - Date.now()) < 60_000, 'and a value that is not a time is ignored');
  r = await off.callHost(DEPLOYED_HOST, 'GET', '/api/dev/principal', { headers: { 'x-test-now': '1' } });
  t.ok(r.status === 404 && r.json?.code === 'not_found', `off loopback the hooks are not there at all (${r.status})`);
  t.report();

  // --- the same rules, asked directly -----------------------------------------
  t = checks('functions: principal, directly');
  const load = await compileShared();
  const env = await load('env');
  const principal = await load('principal');
  // The helpers log a misconfiguration once; these ask on purpose.
  const { warn, error } = console;
  console.warn = console.error = () => {};
  try {
    for (const [value, want] of [
      [undefined, false],
      ['true', true],
      [true, true],
      ['1', false],
      ['TRUE', false],
      ['false', false],
    ]) {
      t.eq(env.accountsOn({ ACCOUNTS_ENABLED: value }), want, `ACCOUNTS_ENABLED ${JSON.stringify(value)} is accounts ${want ? 'on' : 'off'}`);
    }
    const req = (url, headers = {}) => new Request(url, { headers });
    const hooks = { DEV_TEST_HOOKS: 'true' };
    t.eq(env.requestTime(req('http://127.0.0.1:1/x', { 'x-test-now': '5' }), hooks), 5, 'requestTime takes X-Test-Now with the hooks on, on loopback');
    t.ok(env.requestTime(req('http://127.0.0.1:1/x', { 'x-test-now': '5' }), {}) > 5, 'not with them off');
    t.ok(env.requestTime(req('https://bozzetto.example/x', { 'x-test-now': '5' }), hooks) > 5, 'nor off loopback');
    const media = { MEDIA_ORIGIN: 'https://files.example' };
    t.ok(env.onMediaHost(new URL('https://files.example/m/x'), media) && !env.onMediaHost(new URL('https://bozzetto.example/m/x'), media), 'the files host is told from the app by host name');
    t.eq(env.mediaOrigin({ MEDIA_ORIGIN: 'not a url' }), null, 'a MEDIA_ORIGIN that is no URL is taken as unset, refusing nothing');
    t.eq(env.mediaOrigin({ MEDIA_ORIGIN: 'https://Files.Example/m/' }), 'https://files.example', 'and one with a path is its origin');
    const admin = req('http://127.0.0.1:1/admin/api/whoami', asOwner);
    const resolved = await principal.resolvePrincipal(admin, { ADMIN_EMAILS: OWNER }, new URL(admin.url));
    t.ok(resolved.kind === 'admin' && resolved.email === OWNER && resolved.owner === null, `under /admin/, Access is lock 1 and the owner account none yet (${JSON.stringify(resolved)})`);
    const viaFiles = req('http://files.example/admin/api/whoami', asOwner);
    t.eq((await principal.resolvePrincipal(viaFiles, { ...media, MEDIA_ORIGIN: 'http://files.example' }, new URL(viaFiles.url))).kind, 'guest', 'on the files host nobody is anybody, /admin/ or not');
    let threw = null;
    try {
      principal.ownerScope({ kind: 'guest' });
    } catch (err) {
      threw = err.status;
    }
    t.eq(threw, 403, "owner tools' scope is refused to anyone but the owner, rather than handed the rows with no owner");
  } finally {
    Object.assign(console, { warn, error });
  }
  t.report();
}
