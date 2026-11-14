// The document never scrolls (Safari 26 on iPad blurs the top edge once it does).
// On the pages (gallery, My projects with many cards, Community) the content
// scrolls inside its own container under the strip; in Sculpt, Armature,
// Present and the viewer nothing scrolls at all. At 1180x820 and 390x844,
// after the content is scrolled as far as it goes: the document's scrollTop
// is 0 and its scrollHeight no more than its clientHeight (and no wider than
// the screen), while the page's container did scroll.
import { resolve } from 'node:path';
import { openArmature, openSculpt, startAccountsServer } from './lib.mjs';
import { DATA_ONE_FRAME, seedSession, seedUser, seededToken } from '../functions/lib.mjs';

const DAY = 24 * 60 * 60 * 1000;
const SIZES = [
  { width: 1180, height: 820 },
  { width: 390, height: 844 },
];

function seed(now) {
  const rows = [
    seedUser({ id: 'u-ada', handle: 'ada', email: 'ada@example.com', role: 'member', at: now - DAY }),
    seedSession({ name: 'ada', id: 's-ada', user: 'u-ada', created: now - 60_000 }),
  ];
  for (let i = 0; i < 30; i++) {
    const id = `p-ada${String(i).padStart(21, '0')}`;
    rows.push(
      `INSERT INTO projects (id, title, mode, fps, data, visibility, template, owner_id, storage_prefix, created_at, updated_at, shared, shared_at)
       VALUES ('${id}', 'Ada piece ${i}', 'model', 4, '${DATA_ONE_FRAME}', 'private', 0, 'u-ada', 'users/u-ada/projects/${id}/', ${now - DAY}, ${now - DAY}, 'public', ${now - DAY + i});`,
    );
  }
  return rows.join('\n');
}

/** What the document and the page's container say after the container is scrolled to its end. */
async function measure(page, scroller) {
  return page.evaluate(async (sel) => {
    const box = sel ? document.querySelector(sel) : null;
    const before = box ? box.scrollTop : 0;
    if (box) box.scrollTop = box.scrollHeight;
    window.scrollTo(0, 99999);
    document.body.scrollTop = 99999;
    document.documentElement.scrollTop = 99999;
    await new Promise((r) => setTimeout(r, 150));
    const doc = document.scrollingElement;
    return {
      docTop: doc.scrollTop,
      docOver: doc.scrollHeight - doc.clientHeight,
      wide: doc.scrollWidth - doc.clientWidth,
      bodyTop: document.body.scrollTop,
      boxMax: box ? box.scrollHeight - box.clientHeight : 0,
      boxMoved: box ? box.scrollTop - before : 0,
    };
  }, scroller);
}

export const suites = {
  async docScroll(page, base, t) {
    const ok = (where, m, scrolls) => {
      const quiet = m.docTop === 0 && m.docOver <= 0 && m.wide <= 0 && m.bodyTop === 0;
      t.ok(quiet, `${where}: the document does not scroll (${JSON.stringify(m)})`);
      if (scrolls) t.ok(m.boxMax > 0 && m.boxMoved > 0, `${where}: the page's own container did (${JSON.stringify(m)})`);
    };
    const browser = page.context().browser();

    // The pages, against the real Functions: a member with many projects.
    let server = null;
    try {
      server = await startAccountsServer({ dist: resolve('dist'), seed: seed(Date.now()) });
    } catch (err) {
      t.ok(false, `the Functions did not start: ${err?.message ?? err}`);
    }
    if (server) {
      try {
        for (const size of SIZES) {
          const at = `${size.width}x${size.height}`;
          const ctx = await browser.newContext({ viewport: size, serviceWorkers: 'block' });
          await ctx.addCookies([{ name: '__Host-bz_session', value: seededToken('ada'), domain: 'localhost', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
          await ctx.route(
            (url) => url.origin === server.base && /^\/(api|admin\/api)\//.test(url.pathname),
            async (route) => route.continue({ headers: { ...(await route.request().allHeaders()), 'cf-connecting-ip': '203.0.113.62' } }),
          );
          const p = await ctx.newPage();
          p.on('dialog', (d) => void d.dismiss());
          try {
            await p.goto(`${server.base}/`, { waitUntil: 'domcontentloaded' });
            await p.waitForSelector('#landing-grid .card--new', { timeout: 30_000 });
            await p.waitForTimeout(500);
            ok(`Gallery at ${at}`, await measure(p, '.page-scroll'), false);

            await p.goto(`${server.base}/?me`, { waitUntil: 'domcontentloaded' });
            await p.waitForSelector('.card--mine', { timeout: 30_000 });
            await p.waitForTimeout(500);
            ok(`My projects at ${at}`, await measure(p, '.page-scroll'), true);

            await p.goto(`${server.base}/?community`, { waitUntil: 'domcontentloaded' });
            await p.waitForSelector('.card--community, .community__empty', { timeout: 30_000 });
            await p.waitForTimeout(500);
            ok(`Community at ${at}`, await measure(p, '.page-scroll'), true);

            // Anchors and focus still bring things into view inside the container.
            if (size.width > 600) {
              await p.keyboard.press('Tab');
              await p.evaluate(() => document.querySelector('.page-scroll')?.scrollTo(0, 0));
            }
          } finally {
            await ctx.close().catch(() => {});
          }
        }
      } finally {
        await server.close();
      }
    }

    // The workspaces and the viewer, on the static server.
    for (const size of SIZES) {
      const at = `${size.width}x${size.height}`;
      await page.setViewportSize(size);
      await openSculpt(page, base);
      ok(`Sculpt at ${at}`, await measure(page, null), false);
      await page.keyboard.press('Shift+P');
      await page.waitForFunction(() => document.querySelector('.bz-ws__step--on')?.textContent?.includes('Present'), null, { timeout: 8000 }).catch(() => {});
      ok(`Present at ${at}`, await measure(page, null), false);
      await openArmature(page, base);
      ok(`Armature at ${at}`, await measure(page, null), false);
      await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.bz-strip', { timeout: 60_000 });
      await page.waitForTimeout(1500);
      ok(`the viewer at ${at}`, await measure(page, null), false);
    }
  },
};
