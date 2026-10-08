// Browser smoke tests over the test build: smoke.mjs's suites,
// armatureProjects.mjs's, latency.mjs's, hardening.mjs's, tweaks.mjs's,
// passkeyCheck.mjs's and accounts.mjs's (which starts the real Functions
// of its own, with wrangler, beside the static server the rest use).
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
import { suites as accounts } from './accounts.mjs';
import { suites as armatureProjects } from './armatureProjects.mjs';
import { suites as hardening } from './hardening.mjs';
import { suites as latency } from './latency.mjs';
import { suites as passkeyCheck } from './passkeyCheck.mjs';
import { suites as smoke } from './smoke.mjs';
import { suites as tweaks } from './tweaks.mjs';

const suites = { ...smoke, ...armatureProjects, ...latency, ...hardening, ...tweaks, ...passkeyCheck, ...accounts };

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
// Adaptive quality off in every page, contexts the suites make themselves
// included: software frames here miss every refresh, and the ladder would
// lighten frames under suites that compare them. The latency suites turn
// it back on where they test it.
const newContext = browser.newContext.bind(browser);
browser.newContext = async (options) => {
  const ctx = await newContext(options);
  await ctx.addInitScript(() => {
    window.__bozzettoAdaptiveOff = true;
  });
  return ctx;
};
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
