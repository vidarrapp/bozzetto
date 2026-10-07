// The Access gate, asked directly: http.ts compiled on its own and handed
// Requests, with a key pair made up for the run as the team's and fetch
// standing in for its key server. This is the path every deployed admin
// request takes - a token checked on each - which the local runtime cannot
// reach, since no Access is there to sign one. The token comes in Access's
// header or, since the zone in front may keep that from the Functions, in
// its CF_Authorization cookie; each refusal logs its reason and nothing
// more. Last, the root middleware itself is asked, as Pages runs it, about
// writes that carry the cookie alone.
import { webcrypto } from 'node:crypto';
import { OWNER } from '../lib.mjs';

export const needs = [];

export async function run({ checks, compileShared }) {
  globalThis.crypto ??= webcrypto; // Node 18 has none of its own
  const load = await compileShared();
  const gate = await load('http');
  const middleware = await load('../_middleware');

  const { subtle } = globalThis.crypto;
  const rsa = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const team = 'team.example.cloudflareaccess.com';
  const aud = 'audience-tag-of-the-check';
  const keys = await subtle.generateKey(rsa, true, ['sign', 'verify']);
  const impostor = await subtle.generateKey(rsa, true, ['sign', 'verify']);
  const jwk = { ...(await subtle.exportKey('jwk', keys.publicKey)), kid: 'k1' };
  const now = Math.floor(Date.now() / 1000);
  const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const claimsOf = (claims) => ({ aud: [aud], iss: `https://${team}`, iat: now, exp: now + 600, email: OWNER, ...claims });
  const token = async (claims = {}, { key = keys.privateKey, kid = 'k1', alg = 'RS256' } = {}) => {
    const signed = `${part({ alg, kid, typ: 'JWT' })}.${part(claimsOf(claims))}`;
    const sig = await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signed));
    return `${signed}.${Buffer.from(sig).toString('base64url')}`;
  };
  /** Someone else's token with its claims rewritten to name the owner, the signature kept. */
  const rewritten = async () => {
    const [head, , sig] = (await token({ email: 'someone@example.com' })).split('.');
    return `${head}.${part(claimsOf({}))}.${sig}`;
  };
  /** A browser's Cookie header, the Access cookie among others. */
  const jar = (jwt) => `theme=dark; CF_Authorization=${jwt}; lang=sv`;

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
  let t = checks('functions: the Access gate, directly');
  try {
    const configured = { ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: aud };
    const deployed = 'https://bozzetto.example/admin/api/whoami';
    const local = 'http://127.0.0.1:8788/admin/api/whoami';
    /** What adminEmail makes of a request: an email, null, or the status it threw. */
    const ask = async (env, { url = deployed, email = OWNER, jwt, cookie } = {}) => {
      const headers = {};
      if (email) headers['cf-access-authenticated-user-email'] = email;
      if (jwt) headers['cf-access-jwt-assertion'] = jwt;
      if (cookie) headers.cookie = cookie;
      try {
        return await gate.adminEmail(new Request(url, { headers }), env);
      } catch (err) {
        return err instanceof gate.HttpError ? `${err.status} ${err.message}` : `threw ${err}`;
      }
    };
    /** What adminEmail makes of a request, and the lines it logged meanwhile. */
    const heard = async (env, opts) => {
      const from = logged.length;
      const got = await ask(env, opts);
      return { got, said: logged.slice(from) };
    };
    /**
     * A refusal's reason, as the one line logged for it gives it (`access
     * gate refused: <reason>`). Anything else - someone let in, a throw, no
     * line or more than one, a line with more in it - comes back as itself,
     * and fails the check.
     */
    const refusal = async (env, opts) => {
      const { got, said } = await heard(env, opts);
      if (got !== null) return `not refused: ${got}`;
      const line = said.length === 1 ? /^access gate refused: ([a-z_]+)$/.exec(said[0]) : null;
      return line ? line[1] : `logged ${JSON.stringify(said)}`;
    };
    const unconfigured = '503 Access verification is not configured';
    t.eq(await ask({}, { url: local }), OWNER, 'on loopback the header alone is the identity');
    t.eq(await ask({}), unconfigured, 'anywhere else, with neither variable set, a 503');
    t.eq(await ask({ ACCESS_TEAM_DOMAIN: team }), unconfigured, 'with only the team domain, too');
    t.eq(await ask({ ACCESS_AUD: aud }), unconfigured, 'and with only the audience');
    t.eq(await ask({}, { email: null, cookie: jar(await token()) }), unconfigured, 'and with a token in the Access cookie instead: the cookie is no way around them');

    // The token in Access's header, as before.
    t.eq(await ask(configured, { jwt: await token() }), OWNER, 'configured: a token signed for this application, naming the same email, is the owner');
    t.ok(keySignal instanceof AbortSignal, 'the team keys are fetched with a time limit');
    t.eq(await ask(configured, { email: null, jwt: await token() }), OWNER, "and without the email header beside it: the identity is the token's own claim");
    t.eq(await refusal(configured), 'no_identity', 'the email header without a token is nobody, and the log says why in a word');
    t.eq(await refusal(configured, { email: 'someone@example.com', jwt: await token() }), 'email_mismatch', 'nor is a header naming someone the token does not');
    t.eq(await refusal(configured, { jwt: await token({ aud: ['another-application'] }) }), 'aud', 'a token for another application is refused');
    t.eq(await refusal(configured, { jwt: await token({ iss: 'https://other.cloudflareaccess.com' }) }), 'iss', 'and one from another team');
    t.eq(await refusal(configured, { jwt: await token({ exp: now - 60 }) }), 'expired', 'and an expired one');
    t.eq(await refusal(configured, { jwt: await token({ nbf: now + 600 }) }), 'not_yet_valid', 'and one not valid yet');
    t.eq(await refusal(configured, { jwt: await token({}, { key: impostor.privateKey }) }), 'bad_signature', 'and one signed with any other key');
    t.eq(await refusal(configured, { jwt: await token({}, { kid: 'k-unknown' }) }), 'unknown_kid', 'and one naming a key the team does not have');
    t.eq(await refusal(configured, { jwt: await token({}, { alg: 'none' }) }), 'bad_token', 'and one that says it is signed some other way than RS256');
    t.eq(await refusal(configured, { jwt: 'header.payload.signature' }), 'bad_token', 'and one that is no token at all');

    // The same token in the CF_Authorization cookie: where the zone in front
    // keeps Access's headers from the Functions, the browser still sends it.
    const byCookie = await heard(configured, { email: null, cookie: jar(await token()) });
    t.ok(byCookie.got === OWNER && byCookie.said.length === 0, `a token in the CF_Authorization cookie, with neither header, is the owner, and nothing is logged (${byCookie.got} ${JSON.stringify(byCookie.said)})`);
    t.eq(await ask(configured, { email: OWNER.toUpperCase(), cookie: jar(await token()) }), OWNER, "with an email header naming the same identity in other capitals as well: the identity is the token's");
    t.eq(await refusal(configured, { email: 'someone@example.com', cookie: jar(await token()) }), 'email_mismatch', "but an email header naming someone the cookie's token does not is refused");
    t.eq(await refusal(configured, { email: null, cookie: jar(await rewritten()) }), 'bad_signature', 'as is a cookie whose token was rewritten to name the owner after it was signed');
    t.eq(await refusal(configured, { email: null, cookie: jar(await token({ aud: ['another-application'] })) }), 'aud', 'and one holding a token for another application');
    t.eq(await refusal(configured, { email: null, cookie: jar(await token({ exp: now - 60 })) }), 'expired', 'and one holding an expired token');
    t.eq(await refusal(configured, { email: null, cookie: 'CF_Authorization=' }), 'no_identity', 'an empty Access cookie is nobody');
    t.eq(await ask(configured, { email: null, jwt: await token(), cookie: jar('not-a-token') }), OWNER, "with both, the header's token is the one checked: a bad cookie does not spoil a good one");
    t.eq(await refusal(configured, { email: null, jwt: await token({ exp: now - 60 }), cookie: jar(await token()) }), 'expired', 'nor does a good cookie rescue a bad one');
    t.eq(await refusal(configured, { url: local, email: null, cookie: jar(await token()) }), 'no_identity', 'on loopback only the email header counts, cookie or not');
    t.eq(keyFetches, 1, 'the keys were fetched once for all of that');

    const someone = await token({ email: 'someone@example.com' });
    t.eq(await ask(configured, { email: 'someone@example.com', jwt: someone }), 'someone@example.com', 'without ADMIN_EMAILS, anyone Access let in is the owner');
    t.eq(await refusal({ ...configured, ADMIN_EMAILS: OWNER }, { email: 'someone@example.com', jwt: someone }), 'not_allowed', 'with it, only the identities it names');
    t.eq(await refusal({ ...configured, ADMIN_EMAILS: OWNER }, { email: null, cookie: jar(someone) }), 'not_allowed', "the cookie's identity as much as the header's");
    t.eq(await refusal({ ADMIN_EMAILS: OWNER }, { url: local, email: 'someone@example.com' }), 'not_allowed', 'and on loopback too');
    t.eq(await ask(configured, { url: 'https://bozzetto.example/media/x/thumb.jpg', jwt: await token() }), null, 'no identity outside /admin/, token or not');
    t.eq(await ask(configured, { url: 'https://bozzetto.example/ADMIN/api/whoami', jwt: await token() }), null, 'nor under /admin/ in other capitals');
    t.eq(await ask({ DEV_ADMIN: 'true' }, { url: local, email: null }), 'dev@localhost', 'DEV_ADMIN stands in for Access on loopback');
    t.eq(await ask({ ...configured, DEV_ADMIN: 'true' }, { email: null }), null, 'and is ignored anywhere else');
    await ask({ ...configured, DEV_ADMIN: 'true' }, { email: null });
    t.eq(logged.filter((l) => l.includes('DEV_ADMIN')).length, 1, 'which is logged once, not on every request');
    const down = { ACCESS_TEAM_DOMAIN: 'down.example.cloudflareaccess.com', ACCESS_AUD: aud };
    t.eq(await ask(down, { jwt: await token() }), '503 Access keys unavailable', 'a key server that cannot be reached is a 503, not a refusal');
    t.eq(await ask(down, { email: null, cookie: jar(await token()) }), '503 Access keys unavailable', 'with the token in the cookie too');
    const leaked = logged.filter((l) => l.includes('@') || l.includes('eyJ') || l.includes('CF_Authorization'));
    t.ok(logged.length > 0 && leaked.length === 0, `of the ${logged.length} lines logged, none names an address, holds a token or quotes the cookie (${JSON.stringify(leaked)})`);
    t.report();

    // The root middleware, as Pages runs it before every Function. The gate
    // takes the Access cookie alone as the owner now, and a page on another
    // site can make a signed-in browser send that cookie with a write: such
    // a write is refused before anyone is asked who it is.
    t = checks('functions: a write with the Access cookie alone');
    const write = async (marks) => {
      const ctx = {
        request: new Request('https://bozzetto.example/admin/api/projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: jar(await token()), ...marks },
          body: JSON.stringify({ id: 'cookie-only' }),
        }),
        env: configured,
        data: {},
        waitUntil: () => {},
        next: async () => new Response(null, { status: 204 }),
      };
      const res = await middleware.onRequest(ctx);
      const body = res.status === 204 ? null : await res.json().catch(() => null);
      return { status: res.status, code: body?.code, principal: ctx.data.principal };
    };
    const shown = (w) => `${w.status} ${w.code ?? ''} ${JSON.stringify(w.principal ?? null)}`;
    const refused = (w) => w.status === 403 && w.code === 'cross_site' && w.principal === undefined;
    let w = await write({ origin: 'https://evil.example' });
    t.ok(refused(w), `a write with only the cookie and another site's Origin: 403 cross_site, the route never reached and nobody asked who it is (${shown(w)})`);
    const missed = [];
    for (const marks of [{ origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site', origin: 'https://files.example' }]) {
      w = await write(marks);
      if (!refused(w)) missed.push(`${JSON.stringify(marks)} -> ${shown(w)}`);
    }
    t.ok(missed.length === 0, `and so is every other way a browser marks another site's write (${missed.join('; ') || 'Origin: null, Sec-Fetch-Site: cross-site, same-site'})`);
    w = await write({ origin: 'https://bozzetto.example', 'sec-fetch-site': 'same-origin' });
    t.ok(w.status === 204 && w.principal?.kind === 'admin' && w.principal?.email === OWNER, `while the same write from the site's own page reaches the route, as the owner by the cookie alone (${shown(w)})`);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
    console.error = realError;
  }
  t.report();
}
