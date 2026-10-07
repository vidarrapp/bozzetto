// Cross-site writes (docs/accounts.md §2). The Access cookie, and later the
// session cookie, rides along with a request another site's page makes the
// browser send, so a write is refused when the browser says it came from
// anywhere but this origin, whoever the identity is. The root middleware
// refuses it before any route runs, so the check covers every route there
// is, the ones that take no writes and the stubs included.
import { FILES_HOST, asOwner, ids, jpeg, same } from '../lib.mjs';

export const needs = ['off', 'on'];

const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'];
/** How a browser marks a request another site's page started. */
const FOREIGN = [
  { origin: 'https://evil.example' },
  { origin: 'null' },
  { 'sec-fetch-site': 'cross-site' },
  // A sibling subdomain, the files host among them.
  { 'sec-fetch-site': 'same-site', origin: `http://${FILES_HOST}` },
];

/** Every path a Function answers, one or more per route file, and what is on them. */
const ROUTES = [
  '/api/projects',
  '/api/projects/csrf-target',
  '/api/config',
  '/api/auth/signout',
  '/api/auth/passkey/verify',
  '/api/auth/register/start',
  '/api/me',
  '/api/me/projects',
  '/api/me/sessions/revoke-all',
  '/api/dev/principal',
  '/api/dev/audit',
  '/admin/api/whoami',
  '/admin/api/projects',
  '/admin/api/projects/csrf-target',
  '/admin/api/projects/csrf-target/frames?index=1',
  '/admin/api/projects/csrf-target/thumb',
  '/admin/api/projects/csrf-target/scene',
  '/admin/api/projects/csrf-target/template',
  '/admin/api/media/csrf-target/thumb.jpg',
  '/admin/login',
  '/media/csrf-target/thumb.jpg',
  '/m/csrf-target/thumb.jpg',
];

export async function run({ checks, off, on }) {
  const { base, call } = off;
  const thumb = jpeg(41);

  let t = checks('functions: cross-site writes');
  const make = (id, headers) => call('POST', '/admin/api/projects', { headers: { ...asOwner, ...headers }, json: { id } });
  await make('csrf-target', {});
  await call('POST', '/admin/api/projects/csrf-target/thumb', { headers: asOwner, bytes: thumb });
  let r = await make('xs-origin', { origin: 'https://evil.example' });
  t.eq(r.status, 403, 'a write with another Origin is refused');
  r = await make('xs-null', { origin: 'null' });
  t.eq(r.status, 403, 'and one from an opaque origin (Origin: null)');
  r = await make('xs-site', { 'sec-fetch-site': 'cross-site' });
  t.eq(r.status, 403, 'and one marked Sec-Fetch-Site: cross-site');
  r = await make('xs-sibling', { 'sec-fetch-site': 'same-site' });
  t.eq(r.status, 403, 'or same-site, a sibling subdomain');
  r = await call('DELETE', '/admin/api/projects/csrf-target', { headers: { ...asOwner, origin: 'https://evil.example' } });
  t.eq(r.status, 403, 'a cross-site delete too');
  r = await call('GET', '/admin/api/projects', { headers: asOwner });
  t.ok(ids(r.json).includes('csrf-target') && !ids(r.json).some((id) => id.startsWith('xs-')), `none of them changed anything (${ids(r.json).filter((id) => /^(xs-|csrf-)/.test(id)).join(', ')})`);
  r = await make('csrf-ok-same', { origin: base, 'sec-fetch-site': 'same-origin' });
  t.eq(r.status, 201, "this site's own page is let through");
  r = await make('csrf-ok-none', { 'sec-fetch-site': 'none' });
  t.eq(r.status, 201, 'and a request the user made directly (Sec-Fetch-Site: none)');
  r = await make('csrf-ok-bare', {});
  t.eq(r.status, 201, "and one with neither header, as the desktop app's main process and curl send");
  r = await call('GET', '/admin/api/projects', { headers: { ...asOwner, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
  t.eq(r.status, 200, 'a read is not refused: without CORS headers no other site can read the answer');
  t.report();

  t = checks('functions: cross-site writes, every route');
  /** Each write method, marked each foreign way, on `path`: the ones not refused as cross_site. */
  const leaks = async (server, path) => {
    const missed = [];
    for (const method of WRITES) {
      for (const foreign of FOREIGN) {
        const res = await server.call(method, path, { headers: { ...asOwner, ...foreign }, json: {} });
        const refused = res.status === 403 && res.json?.code === 'cross_site' && res.headers.get('cache-control') === 'no-store';
        if (!refused) missed.push(`${method} ${JSON.stringify(foreign)} -> ${res.status} ${res.json?.code ?? ''}`);
      }
    }
    return missed;
  };
  for (const path of ROUTES) {
    const missed = await leaks(off, path);
    t.ok(missed.length === 0, `${path}: every write from another site is 403 cross_site${missed.length ? ` (not: ${missed.join('; ')})` : ''}`);
  }
  for (const path of ['/api/auth/signout', '/api/me', '/api/me/projects']) {
    const missed = await leaks(on, path);
    t.ok(missed.length === 0, `${path} with accounts on, where the route itself would answer 501: refused first${missed.length ? ` (not: ${missed.join('; ')})` : ''}`);
  }
  r = await call('GET', '/admin/api/projects/csrf-target', { headers: asOwner });
  const still = await call('GET', '/admin/api/media/csrf-target/thumb.jpg', { headers: asOwner });
  t.ok(r.status === 200 && r.json?.title === 'csrf-target' && same(still.bytes, thumb), `after all of them the target is as it was, title and thumbnail (${r.status}, ${r.json?.title})`);
  const reads = [];
  for (const path of ROUTES) {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      const res = await call(method, path, { headers: { ...asOwner, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
      if (res.status === 403 && (res.json?.code === 'cross_site' || method === 'HEAD')) reads.push(`${method} ${path}`);
    }
  }
  t.ok(reads.length === 0, `no read is refused as cross-site, on any route (${reads.join('; ') || 'none'})`);
  for (const [server, status, code] of [
    [off, 404, 'accounts_off'],
    [on, 501, 'not_implemented'],
  ]) {
    r = await server.call('POST', '/api/auth/signout', { headers: { origin: server.base, 'sec-fetch-site': 'same-origin' }, json: {} });
    t.ok(r.status === status && r.json?.code === code, `this site's own write reaches the stub, accounts ${server === off ? 'off' : 'on'} (${r.status} ${r.json?.code})`);
  }
  t.report();
}
