// GET /api/config (docs/accounts.md §3): what the client learns of the
// deployment before it knows who is using it, with accounts off and on.
import { FILES_HOST } from '../lib.mjs';

export const needs = ['off', 'on'];

export async function run({ checks, off, on }) {
  const t = checks('functions: /api/config');
  let r = await off.call('GET', '/api/config');
  const c = r.json ?? {};
  t.ok(r.status === 200 && c.accounts === false, `with ACCOUNTS_ENABLED unset, accounts are off (${r.status} ${c.accounts})`);
  t.eq(Object.keys(c).sort().join(','), 'accounts,limits,mediaOrigin,rpId,termsVersion,turnstileSiteKey', 'it says what the design lists, and nothing else');
  t.ok(c.rpId === 'localhost' && c.mediaOrigin === `http://${FILES_HOST}` && c.termsVersion === '2026-10', `the RP ID, the files origin and the terms in force (${c.rpId}, ${c.mediaOrigin}, ${c.termsVersion})`);
  t.eq(c.turnstileSiteKey, null, 'no Turnstile site key is sent while none is set');
  const limits = c.limits ?? {};
  t.ok(limits.quotaBytes === 250 * 1024 * 1024 && limits.sceneBytes === 100 * 1024 * 1024 && limits.passkeys === 10 && Object.values(limits).every((v) => Number.isInteger(v) && v > 0), `and the member limits, as whole numbers (${JSON.stringify(limits)})`);
  t.ok(r.headers.get('cache-control') === 'public, max-age=60' && r.headers.get('x-content-type-options') === 'nosniff', `the same for everyone, so cacheable for a minute (${r.headers.get('cache-control')})`);
  r = await on.call('GET', '/api/config');
  t.ok(r.json?.accounts === true && r.json?.turnstileSiteKey === '1x00000000000000000000AA', `with ACCOUNTS_ENABLED=true, accounts are on, and the site key set beside the secret is sent (${r.json?.accounts}, ${r.json?.turnstileSiteKey})`);
  r = await off.callHost(FILES_HOST, 'GET', '/api/config');
  t.eq(r.status, 404, 'the files host does not answer it');
  t.report();
}
