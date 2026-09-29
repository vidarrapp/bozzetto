// Shared plumbing for the browser smoke tests: a static server over dist/,
// a headless Chromium, and the little assertion collector the suites use.
//
// Playwright is not a dependency of the app. The runner takes whichever is
// reachable: a local playwright / playwright-core, else the global npm
// install (npm i -g playwright). The browser is E2E_BROWSER if set, else the
// managed Chromium at /opt/pw-browsers/chromium when that exists, else
// whatever the Playwright package can find itself.
import { execSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve } from 'node:path';

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

/** Serve a folder on a free localhost port. */
export function serve(root, port = 0) {
  const base = resolve(root);
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = normalize(join(base, decodeURIComponent(url.pathname)));
    if (!file.startsWith(base)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
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

function playwright() {
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

/** Boot armature mode (allowed to everyone in the test build). */
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
