// Accounts off (docs/accounts.md §3): with ACCOUNTS_ENABLED unset, every
// route Batches 3 and 4 bring is not there - 404 accounts_off, kept by no
// cache, with no cookie set, nothing stored and nothing mailed - whoever
// asks, a session cookie and the Access identity included. The site is
// 0.5.5 with templates.
import { asOwner } from '../lib.mjs';

export const needs = ['off'];

/** Every route of Batches 3 and 4, as [method, path]. */
const ROUTES = [
  ['POST', '/api/auth/passkey/options'],
  ['POST', '/api/auth/passkey/verify'],
  ['POST', '/api/auth/signout'],
  ['GET', '/api/auth/handle?h=someone'],
  ['GET', '/api/me'],
  ['GET', '/api/me/account'],
  ['GET', '/api/me/passkeys'],
  ['POST', '/api/me/passkeys'],
  ['POST', '/api/me/passkeys/options'],
  ['PATCH', '/api/me/passkeys/some-credential'],
  ['DELETE', '/api/me/passkeys/some-credential'],
  ['DELETE', '/api/me/sessions/s-some-session'],
  ['POST', '/api/me/sessions/revoke-all'],
  ['POST', '/admin/api/owner/bootstrap'],
  ['POST', '/api/auth/invite/check'],
  ['POST', '/api/auth/register/start'],
  ['POST', '/api/auth/register/verify'],
  ['POST', '/api/auth/email/start'],
  ['POST', '/api/auth/email/resend'],
  ['POST', '/api/auth/email/verify'],
  ['POST', '/api/auth/email/link'],
  ['PATCH', '/api/me'],
  ['POST', '/api/me/email/start'],
  ['POST', '/api/me/email/verify'],
  // And the ones still to come, which answer the same.
  ['GET', '/api/me/projects'],
];

export async function run({ checks, off }) {
  const t = checks('functions: accounts off, every new route');
  const cookie = '__Host-bz_session=bz1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; __Host-bz_wa=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  for (const [method, path] of ROUTES) {
    const body =
      method === 'GET'
        ? {}
        : {
            json: {
              handle: 'someone',
              email: 'someone@example.com',
              acceptTerms: true,
              ageConfirmed: true,
              keepCurrent: false,
              turnstile: 'pass:email-code',
              code: '123456',
            },
          };
    const r = await off.call(method, path, { headers: { ...asOwner, cookie }, ...body });
    const ok =
      r.status === 404 &&
      r.json?.code === 'accounts_off' &&
      typeof r.json?.error === 'string' &&
      r.headers.get('cache-control') === 'no-store' &&
      r.headers.get('set-cookie') === null;
    t.ok(ok, `${method} ${path} is 404 accounts_off, uncached, setting no cookie (${r.status} ${r.json?.code} ${r.headers.get('cache-control')} ${r.headers.get('set-cookie') ?? ''})`);
  }
  t.eq((await off.call('GET', '/api/dev/outbox?to=someone%40example.com')).json?.rows?.length, 0, 'and nothing was mailed');
  const p = (await off.call('GET', '/api/dev/principal', { headers: { cookie } })).json;
  t.eq(p?.principal?.kind, 'guest', 'a session cookie makes nobody anybody with accounts off');
  const w = await off.call('GET', '/admin/api/whoami', { headers: { ...asOwner, cookie } });
  t.ok(w.status === 200 && w.json?.owner === null, `/admin/ is Access alone, with no owner account behind it (${w.status} ${JSON.stringify(w.json)})`);
  const h = await off.call('GET', '/api/config');
  t.eq(h.json?.accounts, false, '/api/config says accounts are off');
  t.report();
}
