// Writes tests/e2e/fixtures/tool-panel.json: the Tool panel's rows for every
// tool, read from a test build (dist/) of the code BEFORE the tool registry,
// so the toolNames suite can hold the registry-built panel to it.
//
//   node tests/e2e/recordToolPanel.mjs <dist dir> [out file]
//
// Not a suite: it is run once, by hand, on a build of the old code, and the
// result is committed. Run it twice into two files and compare them to see
// that the reading is steady.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, openSculpt, serve } from './lib.mjs';
import { snapshotToolPanels } from './toolPanelSnapshot.mjs';

const dist = resolve(process.argv[2] ?? 'dist');
const out = resolve(process.argv[3] ?? new URL('./fixtures/tool-panel.json', import.meta.url).pathname);
const server = await serve(dist);
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(() => {
    window.__bozzettoAdaptiveOff = true;
    try {
      localStorage.setItem('bozzetto-device-choice', 'keep');
    } catch {
      /* no storage */
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error', String(e)));
  await openSculpt(page, server.base, '&q=low');
  await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
  const snap = await snapshotToolPanels(page);
  writeFileSync(out, `${JSON.stringify(snap, null, 1)}\n`);
  console.log(`wrote ${out}: ${Object.keys(snap).length} tools, ${Object.values(snap).reduce((n, l) => n + l.length, 0)} lines`);
} finally {
  await browser.close();
  server.close();
}
