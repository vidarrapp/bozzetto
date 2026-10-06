// The Pages Functions, checked against the real local runtime: `wrangler
// pages dev` over workerd, with D1 and R2 simulated on disk.
//
//   node tests/functions/check.mjs        (or: npm run check:functions)
//
// It builds a throwaway project directory - copies of the repo's functions/
// and migrations/, a one-page static site and a wrangler.toml of its own,
// so a local wrangler.toml with DEV_ADMIN or real bindings never leaks in -
// applies every migration to a fresh local D1, starts the server on a free
// port, and exercises the API: create and list, visibility, the media
// route's gating, cross-site writes, malformed requests, the headers sent,
// and a scene's upload in parts. PASS/FAIL per check, as the browser
// suites print it; exits non-zero on any failure, and with 2 when the
// runtime cannot be started at all.
//
// Cloudflare Access is not there locally, so the check plays its part: an
// admin request carries the Cf-Access-Authenticated-User-Email header that
// Access injects on the routes it fronts, and ADMIN_EMAILS names the one
// identity let through. The gate takes that header alone only on a
// loopback host, which is how the server is asked here; asked under any
// other Host (node:http sends the one it is given, fetch does not) it
// wants the Access token too, and with no team configured answers 503.
// Sending the header to /media, which Access does NOT front, is how the
// check shows a forged identity gets nowhere there. The token check itself
// is run directly, against http.ts compiled on its own, with a key pair
// made up for the run in place of the team's.
import { spawn, spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checks } from '../e2e/lib.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const wrangler = join(repo, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
if (!existsSync(wrangler)) {
  console.error('wrangler is not installed (npm install), so there is no local runtime to check against');
  process.exit(2);
}

const OWNER = 'owner@example.com';
const asOwner = { 'cf-access-authenticated-user-email': OWNER };
const asStranger = { 'cf-access-authenticated-user-email': 'someone@example.com' };
const MiB = 1024 * 1024;

/** A free localhost port, for the server to take. */
function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

/** Bytes nobody would mistake for others: a counter pattern from a seed. */
function pattern(length, seed) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + seed) & 255;
  return out;
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/**
 * The Access gate, asked directly: http.ts compiled on its own (it imports
 * only types) and handed Requests, with a key pair made up for the run as
 * the team's and fetch standing in for its key server. This is the path
 * every deployed admin request takes - a token checked on each - which the
 * local runtime cannot reach, since no Access is there to sign one.
 */
async function accessGateChecks(dir) {
  const { default: ts } = await import('typescript');
  const source = readFileSync(join(repo, 'functions', '_shared', 'http.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
  });
  writeFileSync(join(dir, 'http-under-test.mjs'), outputText);
  globalThis.crypto ??= webcrypto; // Node 18 has none of its own
  const gate = await import(pathToFileURL(join(dir, 'http-under-test.mjs')).href);

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
  return t.report();
}

const dir = mkdtempSync(join(tmpdir(), 'bozzetto-functions-'));
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };
let server = null;
let log = '';

function stopServer() {
  if (!server || server.exitCode !== null) return Promise.resolve();
  const kill = (signal) => {
    try {
      // The whole group: wrangler runs workerd as a child of its own.
      process.kill(-server.pid, signal);
    } catch {
      try {
        server.kill(signal); // no process groups (Windows): wrangler alone
      } catch {
        /* already gone */
      }
    }
  };
  return new Promise((ok) => {
    const done = setTimeout(() => {
      kill('SIGKILL');
      ok();
    }, 5000);
    server.once('exit', () => {
      clearTimeout(done);
      ok();
    });
    kill('SIGTERM');
  });
}

let failed = 0;
try {
  cpSync(join(repo, 'functions'), join(dir, 'functions'), { recursive: true });
  cpSync(join(repo, 'migrations'), join(dir, 'migrations'), { recursive: true });
  mkdirSync(join(dir, 'public'));
  writeFileSync(join(dir, 'public', 'index.html'), '<!doctype html><title>check</title>');
  writeFileSync(
    join(dir, 'wrangler.toml'),
    [
      'name = "bozzetto-check"',
      'compatibility_date = "2024-11-01"',
      'pages_build_output_dir = "public"',
      '[[d1_databases]]',
      'binding = "DB"',
      'database_name = "bozzetto"',
      'database_id = "00000000-0000-0000-0000-000000000000"',
      '[[r2_buckets]]',
      'binding = "BUCKET"',
      'bucket_name = "bozzetto-assets"',
      '[vars]',
      `ADMIN_EMAILS = "${OWNER}"`,
      '',
    ].join('\n'),
  );

  const migrate = spawnSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'bozzetto', '--local'], {
    cwd: dir,
    env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (migrate.status !== 0) {
    console.error(`could not apply the migrations locally:\n${migrate.stdout}\n${migrate.stderr}`);
    process.exit(2);
  }

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [wrangler, 'pages', 'dev', 'public', '--port', String(port), '--ip', '127.0.0.1'], {
    cwd: dir,
    env,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (server.exitCode !== null) {
      console.error(`wrangler pages dev exited (${server.exitCode}) before it served:\n${log}`);
      process.exit(2);
    }
    if (Date.now() > deadline) {
      console.error(`wrangler pages dev did not answer within 90 s:\n${log}`);
      process.exit(2);
    }
    try {
      if ((await fetch(`${base}/`)).ok) break;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  /**
   * One request; the body comes back as bytes and, when it parses, JSON.
   * `body` goes as given, typed only by `type`: a Uint8Array without one
   * is sent with no content-type at all.
   */
  const call = async (method, path, { headers = {}, json, bytes, body, type } = {}) => {
    const init = { method, headers: { ...headers } };
    if (json !== undefined) {
      init.body = JSON.stringify(json);
      init.headers['content-type'] = 'application/json';
    }
    if (bytes !== undefined) {
      init.body = bytes;
      init.headers['content-type'] = 'application/octet-stream';
    }
    if (body !== undefined) {
      init.body = body;
      if (type) init.headers['content-type'] = type;
    }
    const res = await fetch(base + path, init);
    const received = new Uint8Array(await res.arrayBuffer());
    let data = null;
    try {
      data = JSON.parse(new TextDecoder().decode(received));
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, bytes: received, json: data };
  };
  const ids = (list) => (Array.isArray(list) ? list.map((p) => p.id) : []);
  /**
   * The same, asked as `host` would be: through node:http, since fetch
   * sends the URL's own host whatever Host header it is handed.
   */
  const callHost = (host, method, path, { headers = {}, json } = {}) =>
    new Promise((ok, fail) => {
      const body = json === undefined ? undefined : JSON.stringify(json);
      const typed = body === undefined ? {} : { 'content-type': 'application/json' };
      const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...headers, ...typed, host } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let data = null;
          try {
            data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            /* not JSON */
          }
          ok({ status: res.statusCode, json: data });
        });
      });
      req.on('error', fail);
      req.end(body);
    });

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
  failed += t.report();

  // --- off this machine ---------------------------------------------------
  // Asked as a deployed hostname is. This run sets neither Access variable,
  // so there is no token the gate could check, and it refuses every admin
  // request outright rather than trust a header anyone can send.
  t = checks('functions: access off this machine');
  const deployed = 'bozzetto.example';
  r = await callHost(deployed, 'GET', '/admin/api/whoami', { headers: asOwner });
  t.ok(r.status === 503 && r.json?.error === 'Access verification is not configured', `a forged identity header is a 503 that names no setting (${r.status} ${r.json?.error})`);
  r = await callHost(deployed, 'POST', '/admin/api/projects', { headers: asOwner, json: { id: 'forged', title: 'Forged' } });
  t.eq(r.status, 503, 'a write with it too');
  r = await callHost(deployed, 'GET', '/admin/api/media/any/thumb.jpg', { headers: asOwner });
  t.eq(r.status, 503, 'and the gated media route');
  r = await callHost(deployed, 'GET', '/api/projects');
  t.eq(r.status, 200, 'the public API answers as before');
  r = await call('GET', '/admin/api/projects', { headers: asOwner });
  t.ok(r.status === 200 && !ids(r.json).includes('forged'), `nothing was created (${ids(r.json).join(', ') || 'no projects'})`);
  r = await call('GET', '/ADMIN/api/whoami', { headers: asOwner });
  t.ok(r.json?.email !== OWNER, `/admin in other capitals never yields the owner, even on loopback (${r.status})`);
  failed += t.report();

  // --- visibility -------------------------------------------------------
  t = checks('functions: visibility');
  r = await call('POST', '/admin/api/projects', { headers: asOwner, json: { id: 'pub-tl', title: 'Public reel' } });
  t.ok(r.status === 201 && r.json?.visibility === 'public', `a project is public unless asked otherwise (${r.status} ${r.json?.visibility})`);
  r = await call('POST', '/admin/api/projects', {
    headers: asOwner,
    json: { id: 'priv-tl', title: 'Private reel', visibility: 'private' },
  });
  t.ok(r.status === 201 && r.json?.visibility === 'private', `and private when asked (${r.status} ${r.json?.visibility})`);
  r = await call('POST', '/admin/api/projects', { headers: asOwner, json: { id: 'odd', visibility: 'secret' } });
  t.eq(r.status, 400, 'a visibility that is neither is refused');
  const frame = pattern(4096, 7);
  // A thumbnail must open like a JPEG (FF D8 FF); what follows is not checked.
  const thumb = concat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), pattern(508, 99));
  for (const id of ['pub-tl', 'priv-tl']) {
    const f = await call('POST', `/admin/api/projects/${id}/frames?index=0`, { headers: asOwner, bytes: frame });
    const p = await call('PUT', `/admin/api/projects/${id}`, { headers: asOwner, json: { frames: [{ index: 0, tris: 12 }] } });
    const th = await call('POST', `/admin/api/projects/${id}/thumb`, { headers: asOwner, bytes: thumb });
    t.ok(f.status === 201 && p.status === 200 && th.status === 201, `${id}: a frame, the frame list and a thumbnail upload (${f.status}, ${p.status}, ${th.status})`);
  }
  r = await call('GET', '/api/projects');
  t.ok(r.status === 200 && ids(r.json).includes('pub-tl') && !ids(r.json).includes('priv-tl'), `the public list has the public project and not the private one (${ids(r.json).join(', ')})`);
  t.ok(Array.isArray(r.json) && r.json.every((p) => p.visibility === 'public'), 'and says each is public');
  r = await call('GET', '/admin/api/projects', { headers: asOwner });
  const owned = Object.fromEntries((r.json ?? []).map((p) => [p.id, p.visibility]));
  t.ok(r.status === 200 && owned['pub-tl'] === 'public' && owned['priv-tl'] === 'private', `the owner list has both, with their visibility (${JSON.stringify(owned)})`);
  r = await call('GET', '/api/projects/pub-tl');
  t.ok(r.status === 200 && r.json?.frames?.[0]?.sd?.startsWith('/media/pub-tl/'), `the public manifest points its frames at /media (${r.json?.frames?.[0]?.sd})`);
  r = await call('GET', '/api/projects/priv-tl');
  t.eq(r.status, 404, 'a private manifest is not found publicly');
  r = await call('GET', '/admin/api/projects/priv-tl', { headers: asOwner });
  t.ok(r.status === 200 && r.json?.frames?.[0]?.sd?.startsWith('/admin/api/media/priv-tl/'), `the owner gets it, frames on the Access-gated media route (${r.json?.frames?.[0]?.sd})`);
  r = await call('PUT', '/admin/api/projects/pub-tl', { headers: asOwner, json: { visibility: 'hidden' } });
  t.eq(r.status, 400, 'an update with an unknown visibility is refused');
  failed += t.report();

  // --- the media route ----------------------------------------------------
  t = checks('functions: media gating');
  r = await call('GET', '/media/pub-tl/frames/sd/0000.glb');
  t.ok(r.status === 200 && same(r.bytes, frame), `a public frame streams (${r.status}, ${r.bytes.length} bytes)`);
  t.eq(r.headers.get('cache-control'), 'public, max-age=31536000, immutable', 'and may be cached for good');
  r = await call('GET', '/media/pub-tl/thumb.jpg');
  t.ok(r.status === 200 && same(r.bytes, thumb), `so does its thumbnail (${r.status})`);
  r = await call('GET', '/media/priv-tl/frames/sd/0000.glb');
  t.eq(r.status, 404, 'a private frame is not found on /media');
  r = await call('GET', '/media/priv-tl/thumb.jpg');
  t.eq(r.status, 404, 'nor its thumbnail');
  r = await call('GET', '/media/priv-tl/frames/sd/0000.glb', { headers: asOwner });
  t.eq(r.status, 404, 'not even with the owner identity header, which Access does not vouch for there');
  r = await call('GET', '/admin/api/media/priv-tl/frames/sd/0000.glb', { headers: asOwner });
  t.ok(r.status === 200 && same(r.bytes, frame), `the owner reads it through /admin/api/media (${r.status})`);
  t.eq(r.headers.get('cache-control'), 'private, no-store', 'and nothing may keep it');
  r = await call('GET', '/admin/api/media/priv-tl/thumb.jpg', { headers: asOwner });
  t.ok(r.status === 200 && same(r.bytes, thumb), `the private thumbnail too (${r.status})`);
  r = await call('GET', '/admin/api/media/priv-tl/frames/sd/0000.glb');
  t.eq(r.status, 404, 'the gated route refuses with a 404 when there is no identity');
  r = await call('GET', '/admin/api/media/priv-tl/frames/sd/0000.glb', { headers: asStranger });
  t.eq(r.status, 404, 'and for an identity that is not the owner');
  r = await call('GET', '/media/no-such-project/frames/sd/0000.glb');
  t.eq(r.status, 404, 'an unknown project is a 404 as well');
  r = await call('PUT', '/admin/api/projects/priv-tl', { headers: asOwner, json: { visibility: 'public' } });
  t.ok(r.status === 200 && r.json?.visibility === 'public', `making it public (${r.status} ${r.json?.visibility})`);
  r = await call('GET', '/media/priv-tl/frames/sd/0000.glb');
  t.ok(r.status === 200 && same(r.bytes, frame), `opens /media to it (${r.status})`);
  r = await call('GET', '/api/projects');
  t.ok(ids(r.json).includes('priv-tl'), 'and puts it on the public list');
  r = await call('PUT', '/admin/api/projects/priv-tl', { headers: asOwner, json: { visibility: 'private' } });
  const back = await call('GET', '/media/priv-tl/frames/sd/0000.glb');
  t.ok(r.status === 200 && back.status === 404, `making it private again closes it (${r.status}, then ${back.status})`);
  failed += t.report();

  // --- cross-site writes --------------------------------------------------
  // The Access cookie rides along with a request another site's page makes
  // the browser send, so a write is refused when the browser says it came
  // from anywhere but this origin, whoever the identity is.
  t = checks('functions: cross-site writes');
  const make = (id, headers) => call('POST', '/admin/api/projects', { headers: { ...asOwner, ...headers }, json: { id } });
  r = await make('xs-origin', { origin: 'https://evil.example' });
  t.eq(r.status, 403, 'a write with another Origin is refused');
  r = await make('xs-null', { origin: 'null' });
  t.eq(r.status, 403, 'and one from an opaque origin (Origin: null)');
  r = await make('xs-site', { 'sec-fetch-site': 'cross-site' });
  t.eq(r.status, 403, 'and one marked Sec-Fetch-Site: cross-site');
  r = await make('xs-sibling', { 'sec-fetch-site': 'same-site' });
  t.eq(r.status, 403, 'or same-site, a sibling subdomain');
  r = await call('DELETE', '/admin/api/projects/pub-tl', { headers: { ...asOwner, origin: 'https://evil.example' } });
  t.eq(r.status, 403, 'a cross-site delete too');
  r = await call('GET', '/admin/api/projects', { headers: asOwner });
  t.ok(ids(r.json).includes('pub-tl') && !ids(r.json).some((id) => id.startsWith('xs-')), `none of them changed anything (${ids(r.json).join(', ')})`);
  r = await make('ok-same', { origin: base, 'sec-fetch-site': 'same-origin' });
  t.eq(r.status, 201, "this site's own page is let through");
  r = await make('ok-none', { 'sec-fetch-site': 'none' });
  t.eq(r.status, 201, 'and a request the user made directly (Sec-Fetch-Site: none)');
  r = await make('ok-bare', {});
  t.eq(r.status, 201, "and one with neither header, as the desktop app's main process and curl send");
  r = await call('GET', '/admin/api/projects', { headers: { ...asOwner, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
  t.eq(r.status, 200, 'a read is not refused: without CORS headers no other site can read the answer');
  failed += t.report();

  // --- request bodies -----------------------------------------------------
  t = checks('functions: request bodies');
  const post = (body, type) => call('POST', '/admin/api/projects', { headers: asOwner, body, type });
  r = await post(new TextEncoder().encode('{"id":"untyped"}'));
  t.eq(r.status, 415, 'a JSON body with no content-type is refused');
  r = await post('{"id":"plain"}', 'text/plain');
  t.eq(r.status, 415, 'and one sent as text/plain, which a page on another site can send unasked');
  r = await post('{"id":"with-charset"}', 'application/json; charset=utf-8');
  t.eq(r.status, 201, 'application/json with a charset is taken');
  r = await post('{"id": "broken"', 'application/json');
  t.ok(r.status === 400 && typeof r.json?.error === 'string', `malformed JSON is a 400, not a 500 (${r.status} ${r.json?.error})`);
  r = await post('["an", "array"]', 'application/json');
  t.eq(r.status, 400, 'so is JSON that is not an object');
  r = await post('null', 'application/json');
  t.eq(r.status, 400, 'null included');
  r = await call('PUT', '/admin/api/projects/pub-tl', { headers: asOwner, body: '{"title":', type: 'application/json' });
  t.eq(r.status, 400, 'a malformed update is a 400 too');
  r = await call('PUT', '/admin/api/projects/pub-tl', { headers: asOwner, json: { lighting: { note: '\u20ac'.repeat(600_000) } } });
  t.eq(r.status, 413, 'project data is measured in bytes: 600,000 three-byte characters are over the 1.5 MB limit');
  const stray = pattern(2048, 5);
  for (const q of ['', '?index=', '?index=abc', '?index=-1', '?index=1.5', '?index=1e3', '?index=10000']) {
    r = await call('POST', `/admin/api/projects/pub-tl/frames${q}`, { headers: asOwner, bytes: stray });
    t.eq(r.status, 400, `a frame upload with ${q ? JSON.stringify(q) : 'no index'} is refused`);
  }
  r = await call('GET', '/media/pub-tl/frames/sd/0000.glb');
  t.ok(r.status === 200 && same(r.bytes, frame), 'and frame 0 is untouched: a missing index used to be read as 0');
  r = await call('POST', '/admin/api/projects/pub-tl/frames?index=9999', { headers: asOwner, bytes: stray });
  t.eq(r.status, 201, 'the highest index there can be is taken');
  r = await call('PUT', '/admin/api/projects/pub-tl', { headers: asOwner, json: { frames: [{ index: 10000, tris: 1 }] } });
  t.eq(r.status, 400, 'and a frame list naming an index past it is refused');
  r = await call('POST', '/admin/api/projects/pub-tl/thumb', { headers: asOwner, bytes: pattern(512, 99) });
  t.eq(r.status, 415, 'a thumbnail that is not a JPEG is refused');
  r = await call('POST', '/admin/api/projects/pub-tl/thumb', { headers: asOwner, bytes: concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), pattern(64, 1)) });
  t.eq(r.status, 415, 'a PNG included: it would be served as image/jpeg');
  r = await call('GET', '/media/pub-tl/thumb.jpg');
  t.ok(r.status === 200 && same(r.bytes, thumb), 'and the stored thumbnail is untouched');
  failed += t.report();

  // --- response headers ---------------------------------------------------
  // public/_headers reaches the static files only: these come from code.
  t = checks('functions: response headers');
  r = await call('GET', '/admin/api/projects', { headers: asOwner });
  t.eq(r.headers.get('cache-control'), 'no-store', 'the owner list is kept by no cache');
  t.eq(r.headers.get('x-content-type-options'), 'nosniff', 'and never sniffed');
  r = await call('GET', '/admin/api/whoami');
  t.ok(r.status === 403 && r.headers.get('cache-control') === 'no-store', `nor is a refusal kept (${r.status} ${r.headers.get('cache-control')})`);
  r = await call('GET', '/api/projects');
  t.eq(r.headers.get('x-content-type-options'), 'nosniff', 'the public list is not sniffed either');
  r = await call('GET', '/media/pub-tl/frames/sd/0000.glb');
  t.eq(r.headers.get('x-content-type-options'), 'nosniff', 'a media file keeps the type it was stored with');
  t.eq(r.headers.get('content-security-policy'), "default-src 'none'; sandbox", 'opened on its own it is sandboxed');
  t.eq(r.headers.get('cross-origin-resource-policy'), 'same-origin', 'and no other site may embed it');
  r = await call('GET', '/media/pub-tl/thumb.jpg');
  t.eq(r.headers.get('content-type'), 'image/jpeg', 'a thumbnail is served as the JPEG it was checked to be');
  r = await call('GET', '/admin/api/media/priv-tl/frames/sd/0000.glb', { headers: asOwner });
  const sent = ['cache-control', 'content-security-policy', 'cross-origin-resource-policy'].map((h) => r.headers.get(h));
  t.eq(sent.join(' | '), "private, no-store | default-src 'none'; sandbox | same-origin", 'the gated media route sends the same, kept nowhere');
  r = await call('GET', '/media/no-such-project/thumb.jpg');
  t.ok(r.status === 404 && r.headers.get('x-content-type-options') === 'nosniff', `and so does its 404 (${r.status})`);
  failed += t.report();

  // --- scenes -------------------------------------------------------------
  t = checks('functions: scenes');
  r = await call('POST', '/admin/api/projects', { headers: asOwner, json: { mode: 'scene', title: 'Clay study' } });
  const scene = r.json?.id;
  t.ok(r.status === 201 && /^scene-[a-z0-9-]+$/.test(scene ?? ''), `a scene needs no id; the server picks one (${r.status} ${scene})`);
  t.ok(r.json?.mode === 'scene' && r.json?.visibility === 'private', `and it starts private (${r.json?.mode}, ${r.json?.visibility})`);
  r = await call('GET', `/admin/api/projects/${scene}`, { headers: asOwner });
  t.ok(r.status === 200 && r.json?.scene === null, `before an upload completes it has no file (${JSON.stringify(r.json?.scene)})`);

  const start = await call('POST', `/admin/api/projects/${scene}/scene`, { headers: asOwner });
  const upload = start.json?.uploadId;
  t.ok(start.status === 201 && typeof upload === 'string' && start.json?.partSize === 8 * MiB, `an upload starts, asking for 8 MiB parts (${start.status}, ${start.json?.partSize})`);
  const first = pattern(8 * MiB, 1);
  const last = pattern(300_000, 2);
  const u = encodeURIComponent(upload ?? '');
  const p1 = await call('PUT', `/admin/api/projects/${scene}/scene?upload=${u}&part=1`, { headers: asOwner, bytes: first });
  const p2 = await call('PUT', `/admin/api/projects/${scene}/scene?upload=${u}&part=2`, { headers: asOwner, bytes: last });
  t.ok(p1.status === 201 && p2.status === 201 && p1.json?.part === 1 && !!p1.json?.etag && p2.json?.part === 2, `two parts land, each with its etag (${p1.status}, ${p2.status})`);
  r = await call('PUT', `/admin/api/projects/${scene}/scene?upload=${u}&part=3`, { headers: asStranger, bytes: last });
  t.eq(r.status, 403, 'a part from a stranger is refused');
  r = await call('POST', `/admin/api/projects/${scene}/scene?upload=${u}`, { headers: asOwner, body: '{"parts": [', type: 'application/json' });
  t.eq(r.status, 400, 'a malformed part list is a 400, and leaves the upload open');
  r = await call('POST', `/admin/api/projects/${scene}/scene?upload=${u}`, {
    headers: asOwner,
    json: { parts: [p1.json, p2.json], objects: 3, tris: 12345 },
  });
  const whole = concat(first, last);
  t.ok(r.status === 200 && r.json?.scene?.objects === 3 && r.json?.scene?.tris === 12345, `completing records the counts (${r.status} ${JSON.stringify(r.json?.scene)})`);
  t.eq(r.json?.scene?.bytes, whole.length, 'and the size R2 measured');
  const fileUrl = r.json?.scene?.file ?? '';
  t.ok(fileUrl.startsWith(`/admin/api/media/${scene}/scene.bozz?v=`), `the file is on the gated route while private (${fileUrl})`);
  const firstVersion = r.json?.updated_at;
  r = await call('GET', fileUrl, { headers: asOwner });
  t.ok(r.status === 200 && same(r.bytes, whole), `the owner reads back exactly what was sent (${r.status}, ${r.bytes.length} bytes)`);
  t.eq(r.headers.get('content-type'), 'application/x-bozzetto', 'typed as a Bozzetto scene');
  r = await call('GET', `/media/${scene}/scene.bozz`);
  t.eq(r.status, 404, 'nobody else can fetch a private scene by guessing its id');
  r = await call('GET', '/api/projects');
  t.ok(!ids(r.json).includes(scene), 'and the public list leaves it out');
  r = await call('GET', '/admin/api/projects', { headers: asOwner });
  const listed = (r.json ?? []).find((p) => p.id === scene);
  t.ok(listed?.mode === 'scene' && listed?.visibility === 'private' && listed?.scene?.objects === 3 && listed?.scene?.bytes === whole.length, `the owner list has it with its counts and size (${JSON.stringify(listed?.scene)})`);

  r = await call('PUT', `/admin/api/projects/${scene}`, { headers: asOwner, json: { visibility: 'public' } });
  t.ok(r.status === 200 && r.json?.visibility === 'public', `a scene can be made public (${r.status})`);
  r = await call('GET', `/media/${scene}/scene.bozz`);
  t.ok(r.status === 200 && same(r.bytes, whole), `then /media serves it (${r.status})`);
  t.eq(r.headers.get('cache-control'), 'public, no-cache', 'revalidated on every read, since a re-save replaces it in place');
  r = await call('GET', `/api/projects/${scene}`);
  t.ok(r.status === 200 && r.json?.scene?.file?.startsWith(`/media/${scene}/scene.bozz?v=`), `and its public manifest points there (${r.json?.scene?.file})`);
  r = await call('GET', '/api/projects');
  t.ok(ids(r.json).includes(scene), 'and the public list has it');

  // Re-save in place: a new upload replaces the file and moves ?v= on.
  const again = await call('POST', `/admin/api/projects/${scene}/scene`, { headers: asOwner });
  const u2 = encodeURIComponent(again.json?.uploadId ?? '');
  const small = pattern(1000, 3);
  const q1 = await call('PUT', `/admin/api/projects/${scene}/scene?upload=${u2}&part=1`, { headers: asOwner, bytes: small });
  r = await call('POST', `/admin/api/projects/${scene}/scene?upload=${u2}`, {
    headers: asOwner,
    json: { parts: [q1.json], objects: 1, tris: 50 },
  });
  t.ok(r.status === 200 && r.json?.scene?.objects === 1 && r.json?.scene?.bytes === small.length, `a re-save replaces the file in place (${r.status} ${JSON.stringify(r.json?.scene)})`);
  t.ok(r.json?.updated_at > firstVersion, 'and moves the version on');
  r = await call('GET', `/media/${scene}/scene.bozz`);
  t.ok(r.status === 200 && same(r.bytes, small), `the new bytes are what is served (${r.bytes.length} bytes)`);

  r = await call('PUT', `/admin/api/projects/${scene}`, { headers: asOwner, json: { title: 'Renamed study', mode: 'timelapse' } });
  t.ok(r.status === 200 && r.json?.title === 'Renamed study', `renaming works (${r.json?.title})`);
  t.eq(r.json?.mode, 'scene', 'and a scene cannot be switched to another mode');
  r = await call('PUT', `/admin/api/projects/${scene}/scene?upload=not-an-upload&part=1`, { headers: asOwner, bytes: small });
  t.eq(r.status, 404, 'a part for an upload that does not exist is a 404');
  // Local R2 answers this one with a generic internal error (10001) where
  // the real one names the upload (10024), so the status is not pinned:
  // what matters is that it fails and leaves the stored file alone.
  r = await call('POST', `/admin/api/projects/${scene}/scene?upload=not-an-upload`, {
    headers: asOwner,
    json: { parts: [{ part: 1, etag: 'x' }], objects: 1, tris: 1 },
  });
  const kept = await call('GET', `/media/${scene}/scene.bozz`);
  t.ok(r.status >= 400 && same(kept.bytes, small), `completing an upload that does not exist fails (${r.status}) and leaves the file alone`);
  const dropped = await call('POST', `/admin/api/projects/${scene}/scene`, { headers: asOwner });
  const u3 = encodeURIComponent(dropped.json?.uploadId ?? '');
  await call('PUT', `/admin/api/projects/${scene}/scene?upload=${u3}&part=1`, { headers: asOwner, bytes: small });
  r = await call('DELETE', `/admin/api/projects/${scene}/scene?upload=${u3}`, { headers: asOwner });
  t.ok(r.status === 200 && r.json?.aborted === true, `an upload can be abandoned (${r.status})`);
  r = await call('GET', `/media/${scene}/scene.bozz`);
  t.ok(r.status === 200 && same(r.bytes, small), 'which leaves the stored file as it was');
  r = await call('POST', '/admin/api/projects/pub-tl/scene', { headers: asOwner });
  t.eq(r.status, 400, 'a timelapse takes no scene upload');
  r = await call('POST', '/admin/api/projects', { headers: asOwner, json: { id: 'tl-2', mode: 'timelapse' } });
  const tl2 = await call('PUT', '/admin/api/projects/tl-2', { headers: asOwner, json: { mode: 'scene' } });
  t.eq(tl2.json?.mode, 'timelapse', 'and nothing else becomes a scene by an update');

  r = await call('DELETE', `/admin/api/projects/${scene}`, { headers: asOwner });
  t.ok(r.status === 200 && r.json?.deleted === true, `deleting the scene (${r.status})`);
  r = await call('GET', `/admin/api/media/${scene}/scene.bozz`, { headers: asOwner });
  t.eq(r.status, 404, 'takes its file with it');
  r = await call('GET', '/admin/api/projects', { headers: asOwner });
  t.ok(!ids(r.json).includes(scene), 'and it leaves the owner list');
  failed += t.report();

  // --- signing in again ---------------------------------------------------
  // /admin/login sits behind Access like the rest of /admin, so reaching it
  // means the login has run; it only sends the browser back to `next`. The
  // redirect is read, not followed, as the browser would follow it. It is
  // always an absolute URL on this origin, never a bare path.
  t = checks('functions: sign in again');
  const login = async (query) => {
    const res = await fetch(`${base}/admin/login${query}`, { redirect: 'manual' });
    await res.arrayBuffer();
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
  failed += t.report();

  failed += await accessGateChecks(dir);
} finally {
  await stopServer();
  // What the server said is most of a diagnosis when something failed.
  if (failed) console.log(`--- wrangler pages dev (last 60 lines) ---\n${log.split('\n').slice(-60).join('\n')}`);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* a temp dir left behind is not a failure */
  }
}
console.log(failed ? `${failed} check(s) failed` : 'all function checks passed');
process.exit(failed ? 1 : 0);
