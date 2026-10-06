// The Access gate, asked directly: http.ts compiled on its own and handed
// Requests, with a key pair made up for the run as the team's and fetch
// standing in for its key server. This is the path every deployed admin
// request takes - a token checked on each - which the local runtime cannot
// reach, since no Access is there to sign one.
import { webcrypto } from 'node:crypto';
import { OWNER } from '../lib.mjs';

export const needs = [];

export async function run({ checks, compileShared }) {
  globalThis.crypto ??= webcrypto; // Node 18 has none of its own
  const gate = await (await compileShared())('http');

  const { subtle } = globalThis.crypto;
  const rsa = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const team = 'team.example.cloudflareaccess.com';
  const aud = 'audience-tag-of-the-check';
  const keys = await subtle.generateKey(rsa, true, ['sign', 'verify']);
  const impostor = await subtle.generateKey(rsa, true, ['sign', 'verify']);
  const jwk = { ...(await subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' };
  const now = Math.floor(Date.now() / 1000);
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = async (claims = {}, { key = keys.privateKey, kid = 'k1' } = {}) => {
    const body = { aud: [aud], iss: `https://${team}`, iat: now, exp: now + 600, email: OWNER, ...claims };
    const signed = `${part({ alg: 'RS256', kid, typ: 'JWT' })}.${part(body)}`;
    const sig = await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signed));
    return `${signed}.${Buffer.from(sig).toString('base64url')}`;
  };

  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  const realError = console.error;
  const logged = [];
  let keyFetches = 0;
  let keySignal = null;
  // The team's key server answers; any other is down.
  globalThis.fetch = async (url, init) => {
    if (String(url) !== `https://${team}/cdn-cgi/access/certs`) throw new TypeError('fetch failed');
    keyFetches++;
    keySignal = init?.signal ?? null;
    return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } });
  };
  console.warn = console.error = (...args) => logged.push(args.join(' '));
  const t = checks('functions: the Access gate, directly');
  try {
    const configured = { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud };
    const deployed = 'https://bozzetto.example/admin/api/whoami';
    const local = 'http://127.0.0.1:8788/admin/api/whoami';
    /** What adminEmail makes of a request: an email, null, or the status it threw. */
    const ask = async (env, { url = deployed, email = OWNER, jwt } = {}) => {
      const headers = {};
      if (email) headers['cf-access-authenticated-user-email'] = email;
      if (jwt) headers['cf-access-jwt-assertion'] = jwt;
      try {
        return await gate.adminEmail(new Request(url, { headers }), env);
      } catch (err) {
        return err instanceof gate.HttpError ? `${err.status} ${err.message}` : `threw ${err}`;
      }
    };
    const unconfigured = '503 Access verification is not configured';
    t.eq(await ask({}, { url: local }), OWNER, 'on loopback the header alone is the identity');
    t.eq(await ask({}), unconfigured, 'anywhere else, with neither variable set, a 503');
    t.eq(await ask({ ACCESS_TEAM_DOMAIN: team }), unconfigured, 'with only the team domain, too');
    t.eq(await ask({ ACCESS_AUD: aud }), unconfigured, 'and with only the audience');
    t.eq(await ask(configured, { jwt: await token() }), OWNER, 'configured: a token signed for this application, naming the same email, is the owner');
    t.ok(keySignal instanceof AbortSignal, 'the team keys are fetched with a time limit');
    t.eq(await ask(configured), null, 'the header without a token is nobody');
    t.eq(await ask(configured, { email: 'someone@example.com', jwt: await token() }), null, 'nor is a header naming someone the token does not');
    t.eq(await ask(configured, { jwt: await token({ aud: ['another-application'] }) }), null, 'a token for another application is refused');
    t.eq(await ask(configured, { jwt: await token({ iss: 'https://other.cloudflareaccess.com' }) }), null, 'and one from another team');
    t.eq(await ask(configured, { jwt: await token({ exp: now - 60 }) }), null, 'and an expired one');
    t.eq(await ask(configured, { jwt: await token({}, { key: impostor.privateKey }) }), null, 'and one signed with any other key');
    t.eq(await ask(configured, { jwt: await token({}, { kid: 'k-unknown' }) }), null, 'and one naming a key the team does not have');
    t.eq(keyFetches, 1, 'the keys were fetched once for all of that');
    const someone = await token({ email: 'someone@example.com' });
    t.eq(await ask(configured, { email: 'someone@example.com', jwt: someone }), 'someone@example.com', 'without ADMIN_EMAILS, anyone Access let in is the owner');
    t.eq(await ask({ ...configured, ADMIN_EMAILS: OWNER }, { email: 'someone@example.com', jwt: someone }), null, 'with it, only the identities it names');
    t.eq(await ask(configured, { url: 'https://bozzetto.example/media/x/thumb.jpg', jwt: await token() }), null, 'no identity outside /admin/, token or not');
    t.eq(await ask(configured, { url: 'https://bozzetto.example/ADMIN/api/whoami', jwt: await token() }), null, 'nor under /admin/ in other capitals');
    t.eq(await ask({ DEV_ADMIN: 'true' }, { url: local, email: null }), 'dev@localhost', 'DEV_ADMIN stands in for Access on loopback');
    t.eq(await ask({ ...configured, DEV_ADMIN: 'true' }, { email: null }), null, 'and is ignored anywhere else');
    await ask({ ...configured, DEV_ADMIN: 'true' }, { email: null });
    t.eq(logged.filter((l) => l.includes('DEV_ADMIN')).length, 1, 'which is logged once, not on every request');
    t.eq(await ask({ ACCESS_TEAM_DOMAIN: 'down.example.cloudflareaccess.com', ACCESS_AUD: aud }, { jwt: await token() }), '503 Access keys unavailable', 'a key server that cannot be reached is a 503, not a refusal');
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
    console.error = realError;
  }
  t.report();
}
