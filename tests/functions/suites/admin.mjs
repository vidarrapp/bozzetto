// The owner's routes: who gets in, on this machine and off it, and the way
// back in after an Access session expires.
import { DEPLOYED_HOST, OWNER, asOwner, asStranger, ids } from '../lib.mjs';

export const needs = ['off'];

export async function run({ checks, off }) {
  const { base, call, callHost } = off;

  // --- who is the owner ---------------------------------------------------
  let t = checks('functions: access');
  let r = await call('GET', '/admin/api/whoami', { headers: asOwner });
  t.ok(r.status === 200 && r.json?.email === OWNER, `whoami answers the owner (${r.status} ${r.json?.email})`);
  r = await call('GET', '/admin/api/whoami');
  t.eq(r.status, 403, 'whoami refuses a request with no Access identity');
  r = await call('GET', '/admin/api/whoami', { headers: asStranger });
  t.eq(r.status, 403, 'and an identity ADMIN_EMAILS does not name');
  r = await call('GET', '/admin/api/projects');
  t.eq(r.status, 403, 'the owner list refuses without an identity');
  r = await call('POST', '/admin/api/projects', { headers: asStranger, json: { id: 'nope', title: 'Nope' } });
  t.eq(r.status, 403, 'a stranger cannot create a project');
  t.report();

  // --- off this machine ---------------------------------------------------
  // Asked as a deployed hostname is. This run sets neither Access variable,
  // so there is no token the gate could check, and it refuses every admin
  // request outright rather than trust a header anyone can send.
  t = checks('functions: access off this machine');
  r = await callHost(DEPLOYED_HOST, 'GET', '/admin/api/whoami', { headers: asOwner });
  t.ok(r.status === 503 && r.json?.error === 'Access verification is not configured', `a forged identity header is a 503 that names no setting (${r.status} ${r.json?.error})`);
  r = await callHost(DEPLOYED_HOST, 'POST', '/admin/api/projects', { headers: asOwner, json: { id: 'forged', title: 'Forged' } });
  t.eq(r.status, 503, 'a write with it too');
  r = await callHost(DEPLOYED_HOST, 'GET', '/admin/api/media/any/thumb.jpg', { headers: asOwner });
  t.eq(r.status, 503, 'and the gated media route');
  r = await callHost(DEPLOYED_HOST, 'GET', '/api/projects');
  t.eq(r.status, 200, 'the public API answers as before');
  r = await callHost(DEPLOYED_HOST, 'GET', '/admin/login?next=%2F%3Fsculpt%3D1', { headers: asOwner });
  t.ok(r.status === 302 && r.headers.get('location') === `http://${DEPLOYED_HOST}/?sculpt=1`, `the way back in asks nothing of Access, so it still sends the browser home (${r.status} ${r.headers.get('location')})`);
  r = await call('GET', '/admin/api/projects', { headers: asOwner });
  t.ok(r.status === 200 && !ids(r.json).includes('forged'), `nothing was created (${ids(r.json).length} projects)`);
  r = await call('GET', '/ADMIN/api/whoami', { headers: asOwner });
  t.ok(r.json?.email !== OWNER, `/admin in other capitals never yields the owner, even on loopback (${r.status})`);
  t.report();

  // --- signing in again ---------------------------------------------------
  // /admin/login sits behind Access like the rest of /admin, so reaching it
  // means the login has run; it only sends the browser back to `next`. The
  // redirect is read, not followed, as the browser would follow it. It is
  // always an absolute URL on this origin, never a bare path.
  t = checks('functions: sign in again');
  const login = async (query) => {
    const res = await call('GET', `/admin/login${query}`, { redirect: 'manual' });
    return { status: res.status, location: res.headers.get('location'), cache: res.headers.get('cache-control') };
  };
  const next = (path) => `?next=${encodeURIComponent(path)}`;
  let l = await login(next('/?sculpt=1&q=low'));
  t.ok(l.status === 302 && l.location === `${base}/?sculpt=1&q=low`, `back to the page it was sent from, query and all (${l.status} ${l.location})`);
  t.eq(l.cache, 'no-store', 'and the redirect is never kept, so Access runs every time');
  l = await login(next('/?armature=1#figure'));
  t.eq(l.location, `${base}/?armature=1#figure`, 'another page of the app, with its fragment');
  l = await login(next('/foo?a=1#b'));
  t.eq(l.location, `${base}/foo?a=1#b`, 'any path on the site, query and fragment kept');
  l = await login('');
  t.ok(l.status === 302 && l.location === `${base}/`, `no next: the gallery (${l.status} ${l.location})`);
  // Resolved, this is the path //evil.example/x on this origin, which as a
  // bare Location the browser reads as a link to evil.example.
  l = await login(next('/.//evil.example/x'));
  t.ok(l.status === 302 && l.location === `${base}//evil.example/x`, `a dot segment before a double slash stays on this origin (${l.location})`);
  for (const [what, bad] of [
    ['an absolute URL', 'https://evil.example/steal'],
    ['a protocol-relative one', '//evil.example/steal'],
    ['a backslash the browser reads as a slash', '/\\evil.example/steal'],
    ['a tab the URL parser drops', '/\t/evil.example/steal'],
    ['a script URL', 'javascript:alert(1)'],
    ['a relative path', 'steal'],
  ]) {
    l = await login(next(bad));
    t.ok(l.status === 302 && l.location === `${base}/`, `${what} is refused, and goes to / instead (${JSON.stringify(bad)} -> ${l.location})`);
  }
  t.report();
}
