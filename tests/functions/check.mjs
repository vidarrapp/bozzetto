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
// route's gating, and a scene's upload in parts. PASS/FAIL per check, as
// the browser suites print it; exits non-zero on any failure, and with 2
// when the runtime cannot be started at all.
//
// Cloudflare Access is not there locally, so the check plays its part: an
// admin request carries the Cf-Access-Authenticated-User-Email header that
// Access injects on the routes it fronts, and ADMIN_EMAILS names the one
// identity let through. Sending that header to /media, which Access does
// NOT front, is how the check shows a forged identity gets nowhere there.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  /** One request; the body comes back as bytes and, when it parses, JSON. */
  const call = async (method, path, { headers = {}, json, bytes } = {}) => {
    const init = { method, headers: { ...headers } };
    if (json !== undefined) {
      init.body = JSON.stringify(json);
      init.headers['content-type'] = 'application/json';
    }
    if (bytes !== undefined) {
      init.body = bytes;
      init.headers['content-type'] = 'application/octet-stream';
    }
    const res = await fetch(base + path, init);
    const body = new Uint8Array(await res.arrayBuffer());
    let data = null;
    try {
      data = JSON.parse(new TextDecoder().decode(body));
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, bytes: body, json: data };
  };
  const ids = (list) => (Array.isArray(list) ? list.map((p) => p.id) : []);

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
  const thumb = pattern(512, 99);
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
  // redirect is read, not followed, as the browser would follow it.
  t = checks('functions: sign in again');
  const login = async (query) => {
    const res = await fetch(`${base}/admin/login${query}`, { redirect: 'manual' });
    await res.arrayBuffer();
    return { status: res.status, location: res.headers.get('location'), cache: res.headers.get('cache-control') };
  };
  const next = (path) => `?next=${encodeURIComponent(path)}`;
  let l = await login(next('/?sculpt=1&q=low'));
  t.ok(l.status === 302 && l.location === '/?sculpt=1&q=low', `back to the page it was sent from, query and all (${l.status} ${l.location})`);
  t.eq(l.cache, 'no-store', 'and the redirect is never kept, so Access runs every time');
  l = await login(next('/?armature=1#figure'));
  t.eq(l.location, '/?armature=1#figure', 'another page of the app, with its fragment');
  l = await login('');
  t.ok(l.status === 302 && l.location === '/', `no next: the gallery (${l.status} ${l.location})`);
  for (const [what, bad] of [
    ['an absolute URL', 'https://evil.example/steal'],
    ['a protocol-relative one', '//evil.example/steal'],
    ['a backslash the browser reads as a slash', '/\\evil.example/steal'],
    ['a tab the URL parser drops', '/\t/evil.example/steal'],
    ['a script URL', 'javascript:alert(1)'],
    ['a relative path', 'steal'],
  ]) {
    l = await login(next(bad));
    t.ok(l.status === 302 && l.location === '/', `${what} is refused, and goes to / instead (${JSON.stringify(bad)} -> ${l.location})`);
  }
  failed += t.report();
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
