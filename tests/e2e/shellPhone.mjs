// The title strip on a phone (390x844, a finger for a pointer) and the rest
// of the shell that hangs from it. The strip is 24px on a desktop and an
// iPad and 32px on a phone, and every item in it is exactly as tall as it
// and inside it (the global button rule's 28px minimum had stood the menu
// names and the workspace step taller than the 24px bar, over the folder
// tabs). The open menu hangs from its lower edge, the tab row stands under
// it, the panels under that, and the upright brush fields stop short of the
// tab row. Each gets (page, base, t).
import { openArmature, openSculpt } from './lib.mjs';

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'block' };
const IPAD = { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'block' };

/** A page in its own context, as a phone or an iPad does it; `fn(page)` then the context is closed. */
async function inContext(page, options, fn) {
  const ctx = await page.context().browser().newContext(options);
  await ctx.addInitScript(() => {
    window.__bozzettoAdaptiveOff = true;
  });
  try {
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await fn(p);
    return errors;
  } finally {
    await ctx.close();
  }
}

/** The strip, each of its visible items and the tab row, in CSS px. */
const stripState = (page) =>
  page.evaluate(() => {
    const strip = document.querySelector('.bz-strip');
    const sr = strip.getBoundingClientRect();
    const visible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const items = [...strip.querySelectorAll('button, a, .bz-menuname, .bz-ws__step')].filter(visible).map((e) => {
      const r = e.getBoundingClientRect();
      return { name: (e.textContent || e.title || e.className).trim().slice(0, 14), top: r.top, bottom: r.bottom, height: r.height };
    });
    const tabs = [...document.querySelectorAll('.panel > .panel__handle')].filter(visible).map((e) => {
      const r = e.getBoundingClientRect();
      return { name: e.textContent.trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right, border: getComputedStyle(e).borderLeftWidth + getComputedStyle(e).borderRightWidth, fill: getComputedStyle(e).backgroundColor, shadow: getComputedStyle(e).boxShadow };
    });
    const panel = document.querySelector('.panel');
    return {
      strip: { top: sr.top, bottom: sr.bottom, height: sr.height },
      items,
      tabs,
      panelTop: panel ? parseFloat(getComputedStyle(panel).top) : null,
      cssStrip: getComputedStyle(document.body).getPropertyValue('--bz-strip-h').trim(),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

const itemsFit = (s) => s.items.length > 0 && s.items.every((i) => Math.abs(i.height - s.strip.height) < 0.5 && i.top >= s.strip.top - 0.5 && i.bottom <= s.strip.bottom + 0.5);
const showItems = (s) => s.items.map((i) => `${i.name} ${i.height}`).join(', ');

/** The tab row: starts the shell's 4px under the strip, 28px tall, the tabs 1px apart with no line drawn between them. */
function tabRowChecks(t, s, where) {
  const row = s.tabs;
  t.ok(row.length > 0 && row.every((x) => Math.abs(x.top - (s.strip.bottom + 4)) < 0.5 && Math.abs(x.bottom - x.top - 28) < 0.5), `${where}: the tab row stands 4px under the strip, 28px tall (${row.map((x) => `${x.name} ${x.top}-${x.bottom}`).join(', ')}; strip ends ${s.strip.bottom})`);
  const byLeft = [...row].sort((a, b) => a.left - b.left);
  const gaps = byLeft.slice(1).map((x, i) => x.left - byLeft[i].right).filter((g) => g < 40);
  t.ok(gaps.every((g) => Math.abs(g - 1) < 0.5), `${where}: tabs on a side stand 1px apart (${gaps.join(', ')})`);
  t.ok(row.every((x) => x.border === '0px0px'), `${where}: no tab has a border (${row.map((x) => x.border).join(', ')})`);
  // The 1px between two tabs shows the view; each tab paints its own colour into it, so it reads as no line.
  t.ok(row.every((x) => x.shadow.split('), ').length >= 1 && x.shadow !== 'none' && x.shadow.includes(x.fill)), `${where}: each tab fills the 1px beside it with its own colour (${row[0]?.shadow})`);
  t.ok(Math.abs(s.panelTop - (s.strip.bottom + 32)) < 0.5, `${where}: the panels start under the tab row (${s.panelTop}, strip ends ${s.strip.bottom})`);
}

/** The open menu: top at the strip's lower edge. */
async function menuChecks(page, t, where, name) {
  await page.evaluate((n) => [...document.querySelectorAll('.bz-menuname')].find((b) => b.textContent === n)?.click(), name);
  await page.waitForFunction(() => document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
  const m = await page.evaluate(() => {
    const pop = [...document.querySelectorAll('.file-menu')].find((p) => !p.hidden);
    const pr = pop.getBoundingClientRect();
    const sr = document.querySelector('.bz-strip').getBoundingClientRect();
    const nr = document.querySelector('.bz-menuname.is-open').getBoundingClientRect();
    return { top: pr.top, stripBottom: sr.bottom, nameBottom: nr.bottom, left: pr.left, nameLeft: nr.left, right: pr.right, vw: innerWidth };
  });
  t.ok(Math.abs(m.top - m.stripBottom) <= 1 && Math.abs(m.nameBottom - m.stripBottom) <= 0.5, `${where}: the open ${name} menu hangs from the strip's lower edge (menu ${m.top}, name ${m.nameBottom}, strip ${m.stripBottom})`);
  t.ok(m.left >= 0 && m.right <= m.vw + 0.5, `${where}: and lies inside the screen (${Math.round(m.left)}-${Math.round(m.right)} of ${m.vw})`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
}

export const suites = {
  // Sculpt on a phone: the strip, its menu, the tab row, a panel, the brush fields.
  async shellPhone(page, base, t) {
    const errors = await inContext(page, PHONE, async (p) => {
      await openSculpt(p, base);
      const s = await stripState(p);
      t.ok(s.strip.top === 0 && s.strip.height === 32 && s.cssStrip === '32px', `Sculpt: the strip is 32px tall on a phone (${JSON.stringify(s.strip)}, --bz-strip-h ${s.cssStrip})`);
      t.ok(itemsFit(s), `Sculpt: every item in it is the strip's height and inside it (${showItems(s)})`);
      t.eq(s.items.map((i) => i.name).filter((n) => /^(File|Edit|View|Help)$/.test(n)).join(','), 'File,Edit,View,Help', 'Sculpt: with the four menus');
      t.ok(s.items.some((i) => i.name === 'Sculpt'), 'and the step you are in');
      tabRowChecks(t, s, 'Sculpt');
      t.ok(s.pageOverflow <= 0, `Sculpt: nothing scrolls sideways (${s.pageOverflow})`);
      await menuChecks(p, t, 'Sculpt', 'View');

      // A panel open: it starts under the tab row and the tab row keeps its place.
      await p.evaluate(() => document.querySelector('.panel--render .panel__handle').click());
      await p.waitForTimeout(250);
      const open = await p.evaluate(() => {
        const r = document.querySelector('.panel--render').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      });
      const s2 = await stripState(p);
      t.ok(Math.abs(open.top - (s2.strip.bottom + 32)) < 0.5 && open.bottom <= 844, `Sculpt: an open panel starts under the tab row (${open.top}, strip ends ${s2.strip.bottom}) and ends on the screen (${open.bottom})`);
      await p.evaluate(() => document.querySelector('.panel--render .panel__handle').click());
      await p.waitForTimeout(150);

      // The upright brush fields: the value above the size field is not under a tab, and the column is clear of the row.
      const fields = () =>
        p.evaluate(() => {
          const val = document.querySelector('.bz-edge .sculpt-slider__val');
          const r = val.getBoundingClientRect();
          const tabs = [...document.querySelectorAll('.panel > .panel__handle')].filter((e) => e.getClientRects().length > 0).map((e) => e.getBoundingClientRect());
          const rowBottom = Math.max(...tabs.map((x) => x.bottom));
          const under = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2).find((e) => e.closest('.panel > .panel__handle'));
          const edge = document.querySelector('.bz-edge').getBoundingClientRect();
          return { valTop: r.top, valBottom: r.bottom, text: val.textContent, rowBottom, covered: !!under, edgeTop: edge.top };
        });
      let f = await fields();
      t.ok(f.valTop >= f.rowBottom && !f.covered, `Sculpt: the size field's value (${f.text}) is below the tab row and no tab covers it (value ${f.valTop}-${f.valBottom}, row ends ${f.rowBottom})`);
      // A short screen, as Safari's own bars leave one: the fields shorten rather than run under the row.
      await p.setViewportSize({ width: 390, height: 600 });
      await p.waitForTimeout(250);
      f = await fields();
      t.ok(f.valTop >= f.rowBottom && !f.covered, `Sculpt: at 390x600 the fields shorten and the value still clears the row (value ${f.valTop}, row ends ${f.rowBottom})`);
      await p.setViewportSize({ width: 390, height: 844 });
      await p.waitForTimeout(250);
      f = await fields();
      const h = await p.evaluate(() => document.querySelector('.bz-edge .sculpt-slider').getBoundingClientRect().height);
      t.eq(h, 160, 'Sculpt: and on a tall screen they are their 160px');

      // Present, from Sculpt: the same strip.
      await p.keyboard.press('Shift+P');
      await p.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 10_000 });
      await p.waitForTimeout(500);
      const sp = await stripState(p);
      t.ok(sp.strip.height === 32 && itemsFit(sp), `Present: the strip is 32px and its items fit (${showItems(sp)})`);
      tabRowChecks(t, sp, 'Present');
      await menuChecks(p, t, 'Present', 'File');
    });
    t.ok(!errors.length, `no page errors on the phone${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  // Armature and the public viewer, which share the strip.
  async shellPhoneModes(page, base, t) {
    const errors = await inContext(page, PHONE, async (p) => {
      await openArmature(p, base);
      let s = await stripState(p);
      t.ok(s.strip.height === 32 && itemsFit(s), `Armature: the strip is 32px and its items fit (${showItems(s)})`);
      tabRowChecks(t, s, 'Armature');
      await menuChecks(p, t, 'Armature', 'View');

      await p.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay') && !!document.querySelector('.bz-strip'), null, { timeout: 90_000 });
      await p.waitForTimeout(300);
      s = await stripState(p);
      t.ok(s.strip.height === 32 && itemsFit(s), `the public viewer: the strip is 32px and its items fit (${showItems(s)})`);
      tabRowChecks(t, s, 'the public viewer');
      const bar = await p.evaluate(() => {
        const r = document.querySelector('.transport--shell')?.getBoundingClientRect();
        return r ? { top: r.top, bottom: r.bottom } : null;
      });
      t.ok(!bar || (bar.top > s.strip.bottom + 32 && bar.bottom <= 844), `the public viewer: the transport stands clear of the strip and tabs (${JSON.stringify(bar)})`);
      await menuChecks(p, t, 'the public viewer', 'Help');
    });
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  // The strip stays 24px on a desktop and an iPad, its items exactly as tall.
  async shellStripSizes(page, base, t) {
    await openSculpt(page, base);
    let s = await stripState(page);
    t.ok(s.strip.height === 24 && s.cssStrip === '24px' && itemsFit(s) && s.panelTop === 56, `desktop: the strip is 24px, its items fit, the panels start at 56 (${showItems(s)}; panels ${s.panelTop})`);
    const errors = await inContext(page, IPAD, async (p) => {
      await openSculpt(p, base);
      s = await stripState(p);
      t.ok(s.strip.height === 24 && s.cssStrip === '24px' && itemsFit(s) && s.panelTop === 56, `an iPad (820 wide, touch): the strip stays 24px, its items fit, the panels start at 56 (${showItems(s)}; panels ${s.panelTop})`);
    });
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },
};
