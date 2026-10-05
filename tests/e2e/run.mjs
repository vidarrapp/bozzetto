// Browser smoke tests over the test build: smoke.mjs's suites and
// latency.mjs's.
//
//   npm run build:test && node tests/e2e/run.mjs [suite ...]
//
// Serves dist/ on a free port, boots headless Chromium, runs every suite
// (or the named ones) on its own page, prints PASS/FAIL per check and exits
// non-zero on any failure. Page errors (uncaught exceptions in the app)
// fail the suite they happened in.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checks, launch, serve } from './lib.mjs';
import { suites as latency } from './latency.mjs';
import { suites as smoke } from './smoke.mjs';

const suites = { ...smoke, ...latency };

const dist = resolve('dist');
if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html missing - run `npm run build:test` first');
  process.exit(2);
}
const wanted = process.argv.slice(2);
const chosen = Object.entries(suites).filter(([name]) => !wanted.length || wanted.includes(name));
if (!chosen.length) {
  console.error(`no such suite; have: ${Object.keys(suites).join(', ')}`);
  process.exit(2);
}

const server = await serve(dist);
const browser = await launch();
let failed = 0;
try {
  for (const [name, fn] of chosen) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const t = checks(name);
    try {
      await fn(page, server.base, t);
    } catch (e) {
      t.ok(false, `threw: ${e?.stack ?? e}`);
    }
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    failed += t.report();
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all suites passed');
process.exit(failed ? 1 : 0);
