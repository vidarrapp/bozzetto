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
    // Where the panels start under the tab row (a phone's panels are docked at the bottom, so a probe, not a panel).
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;width:0;height:0;top:var(--bz-panel-top)';
    strip.appendChild(probe);
    const panelTop = parseFloat(getComputedStyle(probe).top);
    probe.remove();
    return {
      strip: { top: sr.top, bottom: sr.bottom, height: sr.height },
      items,
      tabs,
      panelTop,
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
  t.ok(gaps.every((g) => Math.abs(g - 1) < 0.5), `${where}: tabs on a side stand 1px apart (${gaps.join(', ')}; ${byLeft.map((x) => `${x.name} ${x.left}-${x.right}`).join(', ')})`);
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

      // A panel open: it is a sheet at the bottom and the tab row keeps its place.
      await p.evaluate(() => document.querySelector('.panel--render .panel__handle').click());
      await p.waitForTimeout(250);
      const open = await p.evaluate(() => {
        const r = document.querySelector('.panel--render').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      });
      const s2 = await stripState(p);
      t.ok(open.top > s2.strip.bottom + 32 && open.bottom <= 844, `Sculpt: an open panel stands clear of the tab row (${open.top}, strip ends ${s2.strip.bottom}) and ends on the screen (${open.bottom})`);
      tabRowChecks(t, s2, 'Sculpt with a panel open');
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

      // Material on a phone: the brush fields step aside, so its sections show, not just its heading.
      const tab = (cls) => p.evaluate((c) => document.querySelector(`.panel--${c} .panel__handle`).click(), cls);
      const openNow = () =>
        p.evaluate(() => ['material', 'model', 'sculpt', 'render'].filter((c) => !document.querySelector(`.panel--${c}`).classList.contains('panel--collapsed')));
      await tab('material');
      await p.waitForTimeout(250);
      const mat = await p.evaluate(() => {
        const r = document.querySelector('.panel--material').getBoundingClientRect();
        const fields = document.querySelector('.bz-edge .sculpt-slider');
        return { h: Math.round(r.height), fields: !!fields && fields.getClientRects().length > 0 && !fields.closest('[hidden]') };
      });
      t.ok(mat.h > 300 && !mat.fields, `Sculpt: Material opens to its sections, the brush fields put away (${JSON.stringify(mat)})`);
      // One panel at a time: the two sides would cover each other here.
      await tab('sculpt');
      await p.waitForTimeout(250);
      t.eq((await openNow()).join(','), 'sculpt', 'Sculpt: opening Tool closes Material on a phone');
      await tab('model');
      await p.waitForTimeout(250);
      t.eq((await openNow()).join(','), 'model', 'and opening Model closes Tool');
      await tab('model');
      await p.waitForTimeout(150);

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

  // The panels as a bottom sheet, the tool bar's cue, the touch targets, the viewer's title and the path menu.
  async shellPhoneSheet(page, base, t) {
    const errors = await inContext(page, PHONE, async (p) => {
      await openSculpt(p, base);
      const tab = (cls) => p.evaluate((c) => document.querySelector(`.panel--${c} .panel__handle`).click(), cls);
      for (const cls of ['model', 'sculpt', 'render', 'material', 'scene']) {
        await tab(cls);
        await p.waitForTimeout(300);
        const m = await p.evaluate((c) => {
          const el = document.querySelector(`.panel--${c}`);
          const r = el.getBoundingClientRect();
          const bar = document.querySelector('.sculpt-toolbar__brushes').getBoundingClientRect();
          const hit = document.elementFromPoint(innerWidth / 2, innerHeight * 0.25);
          const body = el.querySelector('.panel__body');
          return {
            h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right, barTop: bar.top, vw: innerWidth, vh: innerHeight,
            hit: hit ? hit.tagName + '.' + hit.className : null, isCanvas: !!hit && hit.tagName === 'CANVAS',
            scrolls: getComputedStyle(body).overflowY,
          };
        }, cls);
        t.ok(m.h <= m.vh * 0.5 + 0.5, `${cls}: the sheet is at most half the window (${Math.round(m.h)} of ${m.vh})`);
        t.ok(m.bottom <= m.barTop + 0.5, `${cls}: and stands above the tool bar (ends ${Math.round(m.bottom)}, bar starts ${Math.round(m.barTop)})`);
        t.ok(Math.abs(m.left) < 0.5 && Math.abs(m.right - m.vw) < 0.5, `${cls}: across the full width (${m.left}-${m.right})`);
        t.ok(m.isCanvas, `${cls}: the model's upper half is clear, the canvas is under a finger at 25% height (${m.hit})`);
        t.ok(m.scrolls === 'auto', `${cls}: the sheet scrolls inside`);
        const row = await stripState(p);
        tabRowChecks(t, row, `${cls} open`);
        await tab(cls);
        await p.waitForTimeout(150);
      }

      // The tool bar says it scrolls where it overflows.
      const bar = await p.evaluate(() => {
        const b = document.querySelector('.sculpt-toolbar__brushes');
        const cs = getComputedStyle(b);
        return { over: b.scrollWidth > b.clientWidth + 1, cue: b.dataset.scrollCue, mask: cs.maskImage || cs.webkitMaskImage, snap: cs.scrollSnapType };
      });
      t.ok(bar.over, `the tool bar overflows at 390 wide (${JSON.stringify(bar)})`);
      t.ok(bar.cue === 'end' && bar.mask && bar.mask !== 'none', `and it fades at the cut edge (${bar.cue}, ${bar.mask})`);
      t.ok(/x/.test(bar.snap), `and snaps (${bar.snap})`);
      await p.evaluate(() => {
        const b = document.querySelector('.sculpt-toolbar__brushes');
        b.scrollLeft = b.scrollWidth;
      });
      await p.waitForFunction(() => /^(start|both)$/.test(document.querySelector('.sculpt-toolbar__brushes').dataset.scrollCue), null, { timeout: 5000 }).catch(() => {});
      const end = await p.evaluate(() => {
        const b = document.querySelector('.sculpt-toolbar__brushes');
        return `${b.dataset.scrollCue} at ${b.scrollLeft} of ${b.scrollWidth - b.clientWidth}`;
      });
      t.ok(/^(start|both)/.test(end), `scrolled to the end it fades on the other side (${end})`);

      // Touch targets: every item in the strip has a 44px hit area while the strip stays 32px.
      const targets = await p.evaluate(() => {
        const strip = document.querySelector('.bz-strip');
        const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
        return [...strip.querySelectorAll('.bz-menuname, .bz-strip__btn, .bz-strip__hide, .bz-ws__step')].filter(vis).map((e) => {
          const r = e.getBoundingClientRect();
          const a = getComputedStyle(e, '::after');
          const extra = Math.abs(parseFloat(a.top)) + Math.abs(parseFloat(a.bottom));
          const probe = document.elementFromPoint(r.left + r.width / 2, r.bottom + 3);
          return { name: (e.textContent || e.title || e.className).trim().slice(0, 12), h: r.height, hit: r.height + (a.position === 'absolute' ? extra : 0), below: !!probe && e.contains(probe) };
        });
      });
      t.ok(targets.length >= 5 && targets.every((x) => x.hit >= 44), `strip items are 44px touch targets (${targets.map((x) => `${x.name} ${x.hit}`).join(', ')})`);
      t.ok(targets.every((x) => x.h === 32 || x.h === 24), `while they stay the strip's look (${targets.map((x) => x.h).join(', ')})`);
      t.ok(targets.filter((x) => /^(File|Edit|View|Help)$/.test(x.name)).every((x) => x.below), 'and a press just under a menu name lands on it');

      // The path: the step you are in opens a list of the three.
      await p.evaluate(() => document.querySelector('.bz-ws__step[aria-current]').click());
      const menu = await p.waitForFunction(() => {
        const m = document.querySelector('.bz-ws-menu');
        return m ? [...m.querySelectorAll('.file-menu__item')].map((b) => `${b.textContent}${b.disabled ? '!' : ''}${b.getAttribute('aria-checked') === 'true' ? '*' : ''}`) : null;
      }, null, { timeout: 5000 }).then((h) => h.jsonValue());
      t.eq(menu.join(','), 'Armature,Sculpt*,Present', 'a phone: the step you are in opens a list of Armature, Sculpt and Present');
      await p.evaluate(() => [...document.querySelectorAll('.bz-ws-menu .file-menu__item')].find((b) => b.textContent === 'Present').click());
      await p.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 10_000 });
      t.ok(true, 'and Present is reached from it');
      await p.waitForTimeout(300);
      t.ok(!(await p.evaluate(() => !!document.querySelector('.bz-ws-menu'))), 'the list closes once a step is chosen');

      // The public viewer keeps its title and its sheet.
      await p.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay') && !!document.querySelector('.bz-strip'), null, { timeout: 90_000 });
      await p.waitForTimeout(300);
      const title = await p.evaluate(() => {
        const n = document.querySelector('.bz-readout__name');
        const r = n ? n.getBoundingClientRect() : null;
        const strip = document.querySelector('.bz-strip').getBoundingClientRect();
        return { text: n?.textContent ?? '', shown: !!r && r.width > 20 && r.height > 0, inside: !!r && r.left >= 0 && r.right <= innerWidth, h: strip.height, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      t.ok(title.text.length > 0 && title.shown && title.inside && title.h === 32 && title.over <= 0, `the public viewer on a phone shows the project title (${JSON.stringify(title)})`);
      await tab('render');
      await p.waitForTimeout(300);
      const vs = await p.evaluate(() => {
        const r = document.querySelector('.panel--render').getBoundingClientRect();
        const tr = document.querySelector('.transport--shell')?.getBoundingClientRect();
        return { h: r.height, bottom: r.bottom, trTop: tr ? tr.top : null, vh: innerHeight };
      });
      t.ok(vs.h <= vs.vh * 0.5 + 0.5 && (vs.trTop === null || vs.bottom <= vs.trTop + 0.5), `the viewer's Render sheet is at most half the window and above the transport (${JSON.stringify(vs)})`);
    });
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  // The seven tabs a phone may hold (three left, four right): the reserved Layers and Reference stood in as plain tabs.
  async shellPhoneTabs(page, base, t) {
    const errors = await inContext(page, PHONE, async (p) => {
      await openSculpt(p, base);
      await p.evaluate(() => {
        for (const [cls, name, left] of [['layers', 'Layers', true], ['reference', 'Reference', false]]) {
          const root = document.createElement('div');
          root.className = `panel ${left ? 'panel--left ' : ''}panel--${cls} panel--collapsed`;
          const b = document.createElement('button');
          b.className = 'panel__handle';
          b.innerHTML = `<span class="handle__label">${name}</span>`;
          root.appendChild(b);
          document.body.appendChild(root);
        }
      });
      await p.waitForTimeout(500);
      const row = await p.evaluate(() =>
        [...document.querySelectorAll('.panel > .panel__handle')]
          .filter((e) => e.getClientRects().length > 0)
          .map((e) => {
            const r = e.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { name: e.querySelector('.handle__label').textContent.trim(), left: r.left, right: r.right, side: e.closest('.panel--left') ? 'left' : 'right', reach: !!hit && e.contains(hit), tight: document.documentElement.hasAttribute('data-tabs-tight') };
          })
          .sort((a, b) => a.left - b.left),
      );
      t.eq(row.map((x) => `${x.side[0]}:${x.name}`).join(','), 'l:Scene,l:Model,l:Layers,r:Tool,r:Material,r:Reference,r:Render', 'the row holds Scene, Model, Layers at the left and Tool, Material, Reference, Render at the right, in that order');
      t.ok(row.every((x, i) => x.left >= 0 && x.right <= 390 && (i === 0 || x.left >= row[i - 1].right + 0.5)), `no tab overlaps another and all are on the screen (${row.map((x) => `${x.name} ${Math.round(x.left)}-${Math.round(x.right)}`).join(', ')})`);
      t.ok(row.every((x) => x.reach), `each tab is what a finger at its middle reaches (${row.filter((x) => !x.reach).map((x) => x.name).join(', ')})`);
      t.ok(row.every((x) => x.right - x.left >= 36), `and each is wide enough to press (${row.map((x) => Math.round(x.right - x.left)).join(', ')}; tight set ${row[0]?.tight})`);
    });
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  // The Pencil on the visible upper half of the model still sculpts with a sheet open.
  async shellPhonePen(page, base, t) {
    const errors = await inContext(page, PHONE, async (p) => {
      await openSculpt(p, base, '&q=low');
      await p.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
      await p.keyboard.press('f');
      await p.waitForTimeout(500);
      await p.evaluate(() => document.querySelector('.panel--model .panel__handle').click());
      await p.waitForTimeout(400);
      const geo = await p.evaluate(() => {
        const { session, viewer } = window.__sculpt;
        const b = session.getMesh().computeWorldBound();
        const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
        const pr = session.getPixelRatio();
        const r = viewer.captureCanvas.getBoundingClientRect();
        const [x, y] = session.getCamera().project(c);
        const sheet = document.querySelector('.panel--model').getBoundingClientRect();
        return { x: r.left + x / pr, y: r.top + y / pr, sheetTop: sheet.top };
      });
      // A point of the model above the sheet: its middle, or as low as the sheet's top allows.
      const at = [geo.x, Math.min(geo.y, geo.sheetTop - 30)];
      const probe = await p.evaluate(([px, py]) => {
        const { session, viewer } = window.__sculpt;
        const r = viewer.captureCanvas.getBoundingClientRect();
        const pr = session.getPixelRatio();
        session._mouseX = (px - r.left) * pr;
        session._mouseY = (py - r.top) * pr;
        return { canvas: document.elementFromPoint(px, py) === viewer.captureCanvas, hit: !!session.getPicking().intersectionMouseMeshes() };
      }, at);
      t.ok(probe.canvas && probe.hit, `a point of the model above the sheet is bare canvas (${JSON.stringify(probe)}, sheet from ${Math.round(geo.sheetTop)})`);
      const sum = () =>
        p.evaluate(() => {
          let s = 0;
          for (const m of window.__sculpt.session.getMeshes()) {
            const v = m.getVertices();
            for (let i = 0; i < v.length; i++) s += v[i] * ((i % 7) + 1);
          }
          return s;
        });
      const strokes = () => p.evaluate(() => window.__sculpt.input.strokeCount());
      const before = await sum();
      const n = await strokes();
      const cdp = await p.context().newCDPSession(p);
      const pen = (type, [x, y], down) =>
        cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !down ? 'none' : 'left', buttons: down ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'pen', force: down ? 0.6 : 0 });
      await pen('mouseMoved', at, false);
      await pen('mousePressed', at, true);
      for (let i = 1; i <= 4; i++) await pen('mouseMoved', [at[0] + i * 12, at[1] - i * 4], true);
      await pen('mouseReleased', [at[0] + 48, at[1] - 16], false);
      await p.waitForTimeout(400);
      const after = await strokes();
      t.ok(after === n + 1 && (await sum()) !== before, `a Pencil stroke on the visible model sculpts it with a sheet open (strokes ${n} to ${after})`);
    });
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },
};
