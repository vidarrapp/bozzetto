// Shared plumbing for the browser smoke tests: a static server over dist/,
// a headless Chromium, and the little assertion collector the suites use.
//
// Playwright is not a dependency of the app. The runner takes whichever is
// reachable: a local playwright / playwright-core, else the global npm
// install (npm i -g playwright). The browser is E2E_BROWSER if set, else the
// managed Chromium at /opt/pw-browsers/chromium when that exists, else
// whatever the Playwright package can find itself.
import { execSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serve a folder on a free localhost port.
 *
 * `root` may be a function, asked on every request, so a suite can switch
 * the site to another build under the same origin - a deploy, as an
 * installed app meets one. `gone(pathname)` answers 404 for a file that is
 * there, and `delay(pathname)` holds an answer back that many milliseconds.
 */
export function serve(root, port = 0, { gone, delay } = {}) {
  const server = createServer(async (req, res) => {
    const base = resolve(typeof root === 'function' ? root() : root);
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = normalize(join(base, decodeURIComponent(url.pathname)));
    if (!file.startsWith(base)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    const wait = delay?.(url.pathname) ?? 0;
    if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
    if (!existsSync(file) || gone?.(url.pathname)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => {
    server.listen(port, '127.0.0.1', () => {
      ok({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
    });
  });
}

export function playwright() {
  const require = createRequire(import.meta.url);
  const names = ['playwright', 'playwright-core'];
  for (const name of names) {
    try {
      return require(name);
    } catch {
      /* not here */
    }
  }
  let root = process.env.NPM_GLOBAL_ROOT;
  if (!root) {
    try {
      root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    } catch {
      /* no npm on the path */
    }
  }
  for (const name of names) {
    try {
      if (root) return require(join(root, name));
    } catch {
      /* not there either */
    }
  }
  throw new Error('Playwright not found: npm i -D playwright-core, or npm i -g playwright');
}

/** Headless Chromium with software GL, which is what a CI box has. */
export async function launch() {
  const pw = playwright();
  const managed = '/opt/pw-browsers/chromium';
  const executablePath = process.env.E2E_BROWSER ?? (existsSync(managed) ? managed : undefined);
  return pw.chromium.launch({
    headless: true,
    executablePath,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

/** Boot sculpt mode on a fresh page and wait for its console handle. */
export async function openSculpt(page, base, query = '') {
  await page.goto(`${base}/?sculpt=1${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
  await page.waitForTimeout(250);
}

/** Boot armature mode on a fresh page and wait for its console handle. */
export async function openArmature(page, base) {
  await page.goto(`${base}/?armature=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__armature, null, { timeout: 90_000 });
  await page.waitForTimeout(250);
}

/** A suite's checks; report() prints them and returns the failure count. */
export function checks(name) {
  const lines = [];
  let failed = 0;
  const api = {
    ok(cond, msg) {
      lines.push(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
      if (!cond) failed++;
    },
    eq(actual, expected, msg) {
      api.ok(actual === expected, `${msg} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
    },
    near(actual, expected, tol, msg) {
      api.ok(Math.abs(actual - expected) <= tol, `${msg} (got ${actual}, want ${expected} ±${tol})`);
    },
    report() {
      console.log(`${failed ? 'FAIL' : 'PASS'} ${name}`);
      for (const l of lines) console.log(l);
      return failed;
    },
  };
  return api;
}

// --- the real Functions, for the accounts suite -------------------------------------

/** The repository this file is in. */
const repo = fileURLToPath(new URL('../..', import.meta.url));

/** A free localhost port. Another harness may be starting servers at the same time, so none is fixed. */
export function freePort() {
  return new Promise((ok, fail) => {
    const s = createNetServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

const wranglerEnv = () => ({ ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' });

/**
 * `wrangler pages dev` over the built site, with the real Functions and a
 * local D1 (docs/accounts.md §10): what the accounts suite signs in to.
 * WebAuthn takes `localhost` as an RP ID but not an IP address, so the
 * suite's pages are at `base` (http://localhost:<port>), and the same
 * server answers at `ipBase` (127.0.0.1), where passkeys do not work.
 *
 * Its project directory is a throwaway, as the Functions check's is
 * (tests/functions/check.mjs): copies of functions/, shared/ (when there
 * is one) and migrations/, node_modules linked in, and a wrangler.toml of
 * its own with the variables that harness sets - accounts on, APP_ORIGIN,
 * RP_ID=localhost, a random AUTH_SECRET, the test hooks (the dev outbox,
 * where codes are read), ADMIN_EMAILS naming the owner Access would vouch
 * for - and Turnstile's secret and verify URL, at the fake `turnstileUrl`
 * names. No RESEND_API_KEY, so mail goes to the outbox. The migrations are
 * applied and `seed` (SQL) run before the server starts; the ports are
 * free ones.
 *
 * Resolves to {port, base, ipBase, call(method, path, {json, headers}),
 * outbox(to), log(), close()}.
 */
export async function startAccountsServer({ dist, seed = '', vars = {} } = {}) {
  const wrangler = join(repo, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (!existsSync(wrangler)) throw new Error('wrangler is not installed (npm install)');
  const dir = mkdtempSync(join(tmpdir(), 'bozzetto-e2e-accounts-'));
  const run = (args, what) => {
    const r = spawnSync(process.execPath, [wrangler, ...args], { cwd: dir, env: wranglerEnv(), encoding: 'utf8', timeout: 120_000 });
    if (r.status !== 0) throw new Error(`could not ${what}:\n${r.stdout}\n${r.stderr}`);
  };
  const cleanup = () => {
    try {
      // The link first, so removing the directory cannot reach through it.
      unlinkSync(join(dir, 'node_modules'));
    } catch {
      /* never made */
    }
    rmSync(dir, { recursive: true, force: true });
  };
  let child = null;
  let log = '';
  try {
    cpSync(join(repo, 'functions'), join(dir, 'functions'), { recursive: true });
    if (existsSync(join(repo, 'shared'))) cpSync(join(repo, 'shared'), join(dir, 'shared'), { recursive: true });
    cpSync(join(repo, 'migrations'), join(dir, 'migrations'), { recursive: true });
    symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'), 'junction');
    const port = await freePort();
    const all = {
      ACCOUNTS_ENABLED: 'true',
      APP_ORIGIN: `http://localhost:${port}`,
      RP_ID: 'localhost',
      AUTH_SECRET: randomBytes(32).toString('base64'),
      DEV_TEST_HOOKS: 'true',
      ADMIN_EMAILS: 'owner@example.com',
      ...vars,
    };
    const toml = [
      'name = "bozzetto-e2e"',
      'compatibility_date = "2024-11-01"',
      `pages_build_output_dir = ${JSON.stringify(resolve(dist))}`,
      '[[d1_databases]]',
      'binding = "DB"',
      'database_name = "bozzetto"',
      'database_id = "00000000-0000-0000-0000-000000000000"',
      '[[r2_buckets]]',
      'binding = "BUCKET"',
      'bucket_name = "bozzetto-assets"',
      '[vars]',
      ...Object.entries(all).map(([k, v]) => `${k} = ${JSON.stringify(v)}`),
      '',
    ].join('\n');
    writeFileSync(join(dir, 'wrangler.toml'), toml);
    run(['d1', 'migrations', 'apply', 'bozzetto', '--local'], 'apply the migrations');
    if (seed) {
      writeFileSync(join(dir, 'seed.sql'), seed);
      run(['d1', 'execute', 'bozzetto', '--local', '--file', 'seed.sql'], 'seed the database');
    }
    const inspector = String(await freePort());
    child = spawn(
      process.execPath,
      [wrangler, 'pages', 'dev', resolve(dist), '--port', String(port), '--ip', '127.0.0.1', '--inspector-port', inspector],
      { cwd: dir, env: wranglerEnv(), detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.on('data', (d) => (log += d));
    child.stderr.on('data', (d) => (log += d));
    const ipBase = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 90_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`wrangler pages dev exited (${child.exitCode}) before it served:\n${log}`);
      if (Date.now() > deadline) throw new Error(`wrangler pages dev did not answer within 90 s:\n${log}`);
      try {
        if ((await fetch(`${ipBase}/api/config`)).ok) break;
      } catch {
        /* not listening yet */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const proc = child;
    /** A request from Node, as the harness's own: JSON both ways, through the loopback host. */
    const call = async (method, path, { json, headers = {} } = {}) => {
      const res = await fetch(`${ipBase}${path}`, {
        method,
        headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
        body: json !== undefined ? JSON.stringify(json) : undefined,
      });
      const text = await res.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return { status: res.status, body, headers: res.headers };
    };
    return {
      port,
      base: `http://localhost:${port}`,
      ipBase,
      call,
      /** What the stub mailer wrote for an address, oldest first: {id, at, to, subject, body} each. */
      outbox: async (to) => (await call('GET', `/api/dev/outbox?to=${encodeURIComponent(to)}`)).body?.rows ?? [],
      log: () => log,
      close: () =>
        new Promise((ok) => {
          const done = () => {
            cleanup();
            ok();
          };
          if (proc.exitCode !== null) return done();
          const kill = (signal) => {
            try {
              // The whole group: wrangler runs workerd as a child of its own.
              process.kill(-proc.pid, signal);
            } catch {
              try {
                proc.kill(signal);
              } catch {
                /* gone */
              }
            }
          };
          const timer = setTimeout(() => {
            kill('SIGKILL');
            done();
          }, 5000);
          proc.once('exit', () => {
            clearTimeout(timer);
            done();
          });
          kill('SIGTERM');
        }),
    };
  } catch (err) {
    if (child && child.exitCode === null) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    }
    cleanup();
    throw err;
  }
}
