// Contrast of the faint and the red text (docs/ui-foundations.md, Text and
// lines): placeholders, the hotkeys in a menu and an error line are read, so
// each must reach 4.5:1 against the colour it is drawn on. The ratio is
// computed from the rendered colours: the colour the element is painted in
// (a placeholder's own ::placeholder colour) against its background with the
// ancestors' translucent fills composited down to the page.
//
// With E2E_SHOTS_DIR set, the suites also save the views as PNGs there (for
// a before/after look); no check depends on it.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openSculpt, startAccountsServer } from './lib.mjs';

const AA = 4.5;

/**
 * In the page: the contrast of the text of `sel` (or its `pseudo`, such as
 * ::placeholder) and what it sits on. Returns { ratio, fg, bg } or null.
 */
const contrastOf = (page, sel, pseudo = null) =>
  page.evaluate(
    ([s, ps]) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const parse = (c) => {
        const m = /rgba?\(([^)]+)\)/.exec(c);
        if (!m) return null;
        const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r, g, b, a };
      };
      const over = (top, under) => ({
        r: top.r * top.a + under.r * (1 - top.a),
        g: top.g * top.a + under.g * (1 - top.a),
        b: top.b * top.a + under.b * (1 - top.a),
        a: 1,
      });
      // The fills from the element up to the first opaque one, composited bottom to top.
      const chain = [];
      for (let n = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0) chain.push(c);
        if (c && c.a === 1) break;
      }
      let bg = { r: 27, g: 27, b: 27, a: 1 }; // the strip: the page ground
      for (const c of chain.reverse()) bg = over(c, bg);
      let fg = parse(getComputedStyle(el, ps).color);
      // Opacity on the element or its ancestors dims the text over what is behind.
      let alpha = 1;
      for (let n = el; n; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity);
      fg = over({ ...fg, a: fg.a * alpha }, bg);
      const lum = ({ r, g, b }) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      const round = (c) => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
      return { ratio: (hi + 0.05) / (lo + 0.05), fg: round(fg), bg: round(bg) };
    },
    [sel, pseudo],
  );

const fmt = (c) => (c ? `${c.ratio.toFixed(2)}:1, ${c.fg} on ${c.bg}` : 'not found');

const shotsDir = process.env.E2E_SHOTS_DIR ?? '';
async function shot(target, name) {
  if (!shotsDir || !target) return;
  mkdirSync(shotsDir, { recursive: true });
  await target.screenshot({ path: join(shotsDir, `${name}.png`) });
}

export const suites = {
  /**
   * The menus of Sculpt: the hotkey beside an item (Edit and View have them)
   * and the hint under an item (File has them) are read, so each passes; and
   * so does a hotkey on the row under the pointer, where the fill is lighter.
   */
  async contrastMenu(page, base, t) {
    await openSculpt(page, base);
    const open = async (name) => {
      await page.evaluate((n) => [...document.querySelectorAll('.bz-menuname')].find((b) => b.textContent === n)?.click(), name);
      await page.waitForSelector('.bz-menuname.is-open', { timeout: 5000 });
      await page.waitForTimeout(200);
    };
    const shut = async () => {
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
    };
    const KEY = '.file-menu:not([hidden]) .file-menu__item:not(:disabled) .file-menu__key';

    await open('File');
    const hint = await contrastOf(page, '.file-menu:not([hidden]) .file-menu__item:not(:disabled) .file-menu__hint');
    t.ok(hint && hint.ratio >= AA, `a hint line in the File menu reaches ${AA}:1 (${fmt(hint)})`);
    await shot(await page.$('.file-menu:not([hidden])'), 'file-menu');
    await shut();

    await open('View');
    const key = await contrastOf(page, KEY);
    t.ok(key && key.ratio >= AA, `a hotkey in the View menu reaches ${AA}:1 (${fmt(key)})`);
    await shot(await page.$('.file-menu:not([hidden])'), 'view-menu-hotkeys');
    // The same key on its hovered row.
    const at = await page.evaluate((sel) => {
      const r = document.querySelector(sel).closest('.file-menu__item').getBoundingClientRect();
      return { x: r.left + 20, y: r.top + r.height / 2 };
    }, KEY);
    await page.mouse.move(at.x, at.y);
    await page.waitForTimeout(100);
    const hot = await contrastOf(page, KEY);
    t.ok(hot && hot.ratio >= AA, `and on the row under the pointer (${fmt(hot)})`);
    await shot(await page.$('.file-menu:not([hidden])'), 'view-menu-hotkeys-hover');
    await shut();
  },

  /** The sign-in window, against the real Functions: the empty field's placeholder and the error line it gives. */
  async contrastSignIn(page, base, t) {
    const browser = page.context().browser();
    let server = null;
    try {
      server = await startAccountsServer({ dist: resolve('dist') });
    } catch (err) {
      t.ok(false, `the Functions did not start: ${err?.message ?? err}`);
      return;
    }
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    try {
      await ctx.route(
        (url) => url.origin === server.base && url.pathname.startsWith('/api/'),
        async (route) => route.continue({ headers: { ...(await route.request().allHeaders()), 'cf-connecting-ip': '203.0.113.70' } }),
      );
      const p = await ctx.newPage();
      await p.goto(`${server.base}/`, { waitUntil: 'domcontentloaded' });
      const chip = '.bz-strip .bz-strip__btn:text-is("Sign in")';
      await p.waitForSelector(chip, { timeout: 60_000 });
      await p.click(chip);
      await p.waitForSelector('.account-card input[name=email]', { timeout: 15_000 });
      await p.waitForTimeout(250);
      const ph = await contrastOf(p, '.account-card input[name=email]', '::placeholder');
      t.ok(ph && ph.ratio >= AA, `the placeholder of an empty field reaches ${AA}:1 (${fmt(ph)})`);
      await shot(await p.$('.account-card'), 'signin-placeholder');
      await p.click('.account-card .account-submit');
      await p.waitForSelector('.account-card .account-say[data-tone="error"]', { timeout: 10_000 });
      const err = await contrastOf(p, '.account-card .account-say[data-tone="error"]');
      t.ok(err && err.ratio >= AA, `an error line reaches ${AA}:1 (${fmt(err)})`);
      await shot(await p.$('.account-card'), 'signin-error');
    } finally {
      await ctx.close();
      await server.close();
    }
  },
};
