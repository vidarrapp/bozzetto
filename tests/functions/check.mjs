// The Pages Functions, checked against the real local runtime: `wrangler
// pages dev` over workerd, with D1 and R2 simulated on disk.
//
//   node tests/functions/check.mjs               every suite (npm run check:functions)
//   node tests/functions/check.mjs csrf media    only those
//
// This file is the runner and the harness; the checks are in suites/, a
// file each. A suite says which servers it needs - `off` (ACCOUNTS_ENABLED
// unset, the site as 0.5.5 with templates), `on`, both or neither (checks
// run in Node alone) - and what it needs in the database beforehand, and
// only the servers the chosen suites need are started. PASS/FAIL per
// group of checks, as the browser suites print it, then a count per
// suite; exits non-zero on any failure, and with 2 when the runtime cannot
// be started at all.
//
// Each server is a throwaway project directory - copies of the repo's
// functions/ and migrations/, a small static site with the repo's
// public/_routes.json, node_modules linked in so wrangler resolves what the
// Functions import, and a wrangler.toml of its own, so a local wrangler.toml
// with DEV_ADMIN or real bindings never leaks in. The migrations are
// applied in two steps, with the rows 0.5.5 would have left between them,
// as production's database meets 0003_accounts.sql. Its variables are the
// ones docs/accounts.md §10 names: APP_ORIGIN, RP_ID=localhost, AUTH_SECRET,
// DEV_TEST_HOOKS=true (the X-Test-Now clock, /api/dev/*), TURNSTILE_SECRET
// and MEDIA_ORIGIN, with ACCOUNTS_ENABLED=true on `on` alone. There is no
// RESEND_API_KEY, so mail goes to dev_outbox (GET /api/dev/outbox), and
// TURNSTILE_VERIFY_URL names a fake siteverify on node:http
// (turnstile-fake.mjs), which the suites get as `turnstile`.
//
// Cloudflare Access is not there locally, so the suites play its part: an
// admin request carries the Cf-Access-Authenticated-User-Email header that
// Access injects on the routes it fronts, and ADMIN_EMAILS names the one
// identity let through. The gate takes that header alone only on a
// loopback host, which is how the servers are asked; asked under any other
// Host (node:http sends the one it is given, fetch does not) it wants the
// Access token too, and with no team configured answers 503.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checks } from '../e2e/lib.mjs';
import { FILES_HOST, OWNER } from './lib.mjs';
import { TURNSTILE_SECRET, startTurnstileFake } from './turnstile-fake.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const suitesDir = fileURLToPath(new URL('./suites/', import.meta.url));
const wrangler = join(repo, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

/** The servers a suite can ask for, by what differs between them. */
const SERVERS = {
  off: {},
  on: {
    ACCOUNTS_ENABLED: 'true',
    // Cloudflare's always-passing test key, so /api/config has one to send.
    TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  },
};

/** Where the migrations divide: rows seeded as `legacy` go in before this one. */
const ACCOUNTS_MIGRATION = '0003_accounts.sql';

const all = readdirSync(suitesDir)
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => f.slice(0, -4))
  .sort();
const asked = process.argv.slice(2);
const unknown = asked.filter((n) => !all.includes(n));
if (unknown.length > 0) {
  console.error(`no such suite: ${unknown.join(', ')} (there are: ${all.join(', ')})`);
  process.exit(2);
}
const suites = [];
for (const name of asked.length > 0 ? all.filter((n) => asked.includes(n)) : all) {
  const mod = await import(pathToFileURL(join(suitesDir, `${name}.mjs`)).href);
  suites.push({ name, needs: mod.needs ?? ['off'], seed: mod.seed ?? {}, run: mod.run });
}
const needed = Object.keys(SERVERS).filter((s) => suites.some((suite) => suite.needs.includes(s)));
if (needed.length > 0 && !existsSync(wrangler)) {
  console.error('wrangler is not installed (npm install), so there is no local runtime to check against');
  process.exit(2);
}

/** A failure to set the runtime up, as opposed to a check failing on it. */
class SetupError extends Error {}

/** A free localhost port, for a server to take. */
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

const childEnv = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };

function wranglerSync(cwd, args, what) {
  const r = spawnSync(process.execPath, [wrangler, ...args], { cwd, env: childEnv, encoding: 'utf8', timeout: 120_000 });
  if (r.status !== 0) throw new SetupError(`could not ${what}:\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

function wranglerToml(vars) {
  return [
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
    ...Object.entries(vars).map(([k, v]) => `${k} = ${JSON.stringify(v)}`),
    '',
  ].join('\n');
}

/**
 * One project directory with its database migrated and seeded: what every
 * server starts from. The other servers get copies of it, state and all,
 * so the migrations and seeds run once however many servers there are.
 */
function prepareProject(dir) {
  mkdirSync(dir);
  cpSync(join(repo, 'functions'), join(dir, 'functions'), { recursive: true });
  // So an import the Functions make resolves as it does in the repo.
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'), 'junction');
  const site = join(dir, 'public');
  mkdirSync(site);
  writeFileSync(join(site, 'index.html'), '<!doctype html><title>check</title>');
  writeFileSync(join(site, 'probe.txt'), 'a static file');
  cpSync(join(repo, 'public', '_routes.json'), join(site, '_routes.json'));
  writeFileSync(join(dir, 'wrangler.toml'), wranglerToml({}));

  const migrations = readdirSync(join(repo, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  mkdirSync(join(dir, 'migrations'));
  const copy = (names) => names.forEach((f) => cpSync(join(repo, 'migrations', f), join(dir, 'migrations', f)));
  const apply = () => wranglerSync(dir, ['d1', 'migrations', 'apply', 'bozzetto', '--local'], 'apply the migrations locally');
  const execute = (sql, name) => {
    writeFileSync(join(dir, name), sql);
    wranglerSync(dir, ['d1', 'execute', 'bozzetto', '--local', '--file', name], `seed the database (${name})`);
  };
  const legacy = suites.map((s) => s.seed.legacy).filter(Boolean);
  const current = suites.map((s) => s.seed.sql).filter(Boolean);
  const objects = suites.flatMap((s) => s.seed.r2 ?? []);
  if (legacy.length > 0) {
    copy(migrations.filter((f) => f < ACCOUNTS_MIGRATION));
    apply();
    execute(legacy.join('\n'), 'seed-legacy.sql');
  }
  copy(migrations);
  apply();
  if (current.length > 0) execute(current.join('\n'), 'seed.sql');
  objects.forEach((o, i) => {
    const file = join(dir, `object-${i}`);
    writeFileSync(file, o.bytes);
    wranglerSync(
      dir,
      ['r2', 'object', 'put', `bozzetto-assets/${o.key}`, '--local', '--file', file, '--content-type', o.type],
      `seed R2 (${o.key})`,
    );
  });
}

/**
 * One request; the body comes back as bytes and, when it parses, JSON.
 * `body` goes as given, typed only by `type`: a Uint8Array without one is
 * sent with no content-type at all. With `host`, it goes through node:http
 * under that Host header, since fetch sends the URL's own whatever it is
 * handed; without, through fetch.
 */
function caller(port) {
  const base = `http://127.0.0.1:${port}`;
  const shape = ({ headers = {}, json, bytes, body, type }) => {
    const h = { ...headers };
    let payload;
    if (json !== undefined) {
      payload = JSON.stringify(json);
      h['content-type'] = 'application/json';
    }
    if (bytes !== undefined) {
      payload = bytes;
      h['content-type'] = 'application/octet-stream';
    }
    if (body !== undefined) {
      payload = body;
      if (type) h['content-type'] = type;
    }
    return { h, payload };
  };
  const parse = (status, headers, received) => {
    let data = null;
    try {
      data = JSON.parse(new TextDecoder().decode(received));
    } catch {
      /* not JSON */
    }
    return { status, headers, bytes: received, json: data };
  };
  const call = async (method, path, opts = {}) => {
    const { h, payload } = shape(opts);
    const res = await fetch(base + path, { method, headers: h, body: payload, redirect: opts.redirect ?? 'follow' });
    return parse(res.status, res.headers, new Uint8Array(await res.arrayBuffer()));
  };
  const callHost = (host, method, path, opts = {}) =>
    new Promise((ok, fail) => {
      const { h, payload } = shape(opts);
      const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...h, host } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
          ok(parse(res.statusCode, headers, new Uint8Array(Buffer.concat(chunks))));
        });
      });
      req.on('error', fail);
      req.end(payload === undefined ? undefined : Buffer.from(payload));
    });
  return { base, call, callHost };
}

/** wrangler pages dev on its own project directory, answering on `port`. */
async function startServer(name, dir, port) {
  const server = { name, dir, port, log: '', process: null, ...caller(port) };
  // Its own inspector port too: two servers on workerd's default collide.
  const inspector = String(await freePort());
  const args = ['pages', 'dev', 'public', '--port', String(port), '--ip', '127.0.0.1', '--inspector-port', inspector];
  server.process = spawn(process.execPath, [wrangler, ...args], {
    cwd: dir,
    env: childEnv,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.process.stdout.on('data', (d) => (server.log += d));
  server.process.stderr.on('data', (d) => (server.log += d));
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (server.process.exitCode !== null) {
      throw new SetupError(`wrangler pages dev (${name}) exited (${server.process.exitCode}) before it served:\n${server.log}`);
    }
    if (Date.now() > deadline) throw new SetupError(`wrangler pages dev (${name}) did not answer within 90 s:\n${server.log}`);
    try {
      if ((await fetch(`${server.base}/`)).ok) return server;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

function stopServer(server) {
  const child = server?.process;
  if (!child || child.exitCode !== null) return Promise.resolve();
  const kill = (signal) => {
    try {
      // The whole group: wrangler runs workerd as a child of its own.
      process.kill(-child.pid, signal);
    } catch {
      try {
        child.kill(signal); // no process groups (Windows): wrangler alone
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
    child.once('exit', () => {
      clearTimeout(done);
      ok();
    });
    kill('SIGTERM');
  });
}

/**
 * functions/_shared compiled on its own into `dir`, for the suites that ask
 * it things directly: each file transpiled alone (they import each other,
 * types, and @simplewebauthn/server), subfolders and all, with its relative
 * imports pointed at the compiled copies and its package imports at the
 * repo's node_modules. A fresh directory per suite, so no module state
 * carries over. Modules are asked for by their path under _shared, without
 * the extension: 'env', 'auth/audit'.
 */
async function compileShared(dir) {
  const { default: ts } = await import('typescript');
  const compile = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        compile(join(from, entry.name), join(to, entry.name));
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const { outputText } = ts.transpileModule(readFileSync(join(from, entry.name), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
      });
      const linked = outputText
        .replace(/(from\s+['"])(\.\.?\/[^'"]+)(['"])/g, '$1$2.mjs$3')
        // A package (@simplewebauthn/server) as the repo resolves it: the
        // compiled copy is outside the repo, where no node_modules is.
        .replace(/(from\s+['"])((?:@[a-z0-9-]+\/)?[a-z][^'"]*)(['"])/g, (_, a, name, b) => `${a}${import.meta.resolve(name)}${b}`);
      writeFileSync(join(to, entry.name.replace(/\.ts$/, '.mjs')), linked);
    }
  };
  compile(join(repo, 'functions', '_shared'), dir);
  return (name) => import(pathToFileURL(join(dir, `${name}.mjs`)).href);
}

const base = mkdtempSync(join(tmpdir(), 'bozzetto-functions-'));
const servers = {};
const tally = [];
let setupFailed = false;
let turnstile = null;
try {
  turnstile = await startTurnstileFake();
  if (needed.length > 0) {
    const ports = Object.fromEntries(await Promise.all(needed.map(async (n) => [n, await freePort()])));
    const first = join(base, needed[0]);
    prepareProject(first);
    // A random secret per run: nothing may come to depend on its value.
    const secret = randomBytes(32).toString('base64');
    for (const name of needed) {
      const dir = join(base, name);
      if (dir !== first) cpSync(first, dir, { recursive: true, verbatimSymlinks: true });
      const vars = {
        ADMIN_EMAILS: OWNER,
        APP_ORIGIN: `http://localhost:${ports[name]}`,
        RP_ID: 'localhost',
        AUTH_SECRET: secret,
        DEV_TEST_HOOKS: 'true',
        TURNSTILE_SECRET,
        TURNSTILE_VERIFY_URL: turnstile.url,
        MEDIA_ORIGIN: `http://${FILES_HOST}`,
        ...SERVERS[name],
      };
      writeFileSync(join(dir, 'wrangler.toml'), wranglerToml(vars));
    }
    const started = await Promise.allSettled(needed.map((n) => startServer(n, join(base, n), ports[n])));
    started.forEach((s, i) => {
      if (s.status === 'fulfilled') servers[needed[i]] = s.value;
    });
    const refused = started.find((s) => s.status === 'rejected');
    if (refused) throw refused.reason;
  }

  for (const suite of suites) {
    const counts = { checks: 0, failed: 0 };
    const counted = (name) => {
      const t = checks(name);
      const ok = t.ok;
      // eq() and near() report through ok(), so this sees every check.
      t.ok = (cond, msg) => {
        counts.checks++;
        if (!cond) counts.failed++;
        ok(cond, msg);
      };
      return t;
    };
    const scratch = join(base, 'scratch', suite.name);
    try {
      await suite.run({
        checks: counted,
        ...servers,
        turnstile,
        repo,
        scratch,
        compileShared: () => compileShared(join(scratch, '_shared')),
      });
    } catch (err) {
      // A suite that throws has failed, whatever it had checked so far.
      counts.failed++;
      console.log(`FAIL ${suite.name}: threw ${err?.stack ?? err}`);
    }
    tally.push({ name: suite.name, ...counts });
  }
} catch (err) {
  if (!(err instanceof SetupError)) throw err;
  setupFailed = true;
  console.error(err.message);
} finally {
  await Promise.all(Object.values(servers).map(stopServer));
  await turnstile?.close();
  const failed = tally.reduce((n, s) => n + s.failed, 0);
  // What a server said is most of a diagnosis when something failed.
  if (failed) {
    for (const s of Object.values(servers)) {
      console.log(`--- wrangler pages dev, ${s.name} (last 60 lines) ---\n${s.log.split('\n').slice(-60).join('\n')}`);
    }
  }
  for (const name of needed) {
    // The link first, so removing the directory cannot reach through it.
    try {
      unlinkSync(join(base, name, 'node_modules'));
    } catch {
      /* never made */
    }
  }
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    /* a temp dir left behind is not a failure */
  }
}

if (setupFailed) process.exit(2);
const width = Math.max(5, ...tally.map((s) => s.name.length));
const row = (name, n, failed) => `  ${name.padEnd(width)}  ${String(n).padStart(6)}  ${String(failed).padStart(6)}`;
console.log(`\n${row('suite', 'checks', 'failed')}`);
for (const s of tally) console.log(row(s.name, s.checks, s.failed));
const total = tally.reduce((n, s) => n + s.checks, 0);
const failed = tally.reduce((n, s) => n + s.failed, 0);
console.log(failed ? `${failed} of ${total} check(s) failed` : `all ${total} function checks passed`);
process.exit(failed ? 1 : 0);
