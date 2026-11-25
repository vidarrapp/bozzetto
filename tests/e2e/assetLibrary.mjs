// The Asset library window and the Tools tab (step 3, first half, of
// docs/plans/asset-library.md), and the dock finished: tools leave the bar
// and come back from the window.
//
// libraryWindow: opens from the Tool panel and from View, closes by its
//   button, by Esc with the focus inside and by the menu; moves and resizes
//   (mouse, Pencil, finger); keeps its place, size and tab across a reload
//   and inside the view; hides with Tab; leaves a stroke on the model alone;
//   the four tabs, the two wheres and the search.
// libraryTools: the Tools tab: groups, tiles, the tool in hand, a tap, a
//   tool of the other workspace, the marks.
// libraryLift: a tile lifted from the window onto the bar inserts at the
//   place shown (mouse, finger, Pencil), a tool on the bar moves, a drop
//   elsewhere changes nothing; the digits, keys, guide and Preferences follow.
// libraryRemove: a bar tile dragged off the bar is removed with a notice and
//   Undo; kept across a reload; the stored order (v1, v2, a newer default);
//   the extra tile; the tile menus; Reset tool bar.
// libraryNoBuild: no build or allocation in the view while dragging from the window.
//
// Real input where the gesture matters: the mouse through the page, the
// Pencil and the finger through the browser's own pen and touch events (CDP).
// Nothing here is a real Apple Pencil or a real iPad.
import { openForInput } from './smoke.mjs';

const SCULPT_BAR = ['bz.crease', 'bz.move', 'bz.clay', 'bz.inflate', 'bz.pinch', 'bz.flatten', 'bz.rake', 'bz.drag', 'bz.polish'];
const PAINT_BAR = ['bz.paint', 'bz.erase', 'bz.blur', 'bz.fill', 'bz.pick', 'bz.project'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const BARS = 'bozzetto-toolbar';
const LIB = 'bozzetto-library';

const wait = (page, ms) => page.waitForTimeout(ms);

/** A pointer of one kind: down, move, up, cancel. */
async function pointer(page, kind) {
  if (kind === 'mouse') {
    return {
      down: async (x, y) => {
        await page.mouse.move(x, y);
        await page.mouse.down();
      },
      move: (x, y) => page.mouse.move(x, y),
      up: () => page.mouse.up(),
    };
  }
  const cdp = await page.context().newCDPSession(page);
  if (kind === 'pen') {
    let at = [0, 0];
    const pen = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'pen', force: 0.6 });
    return {
      down: async (x, y) => {
        at = [x, y];
        await pen('mouseMoved', x, y, 0);
        await pen('mousePressed', x, y, 1);
      },
      move: async (x, y) => {
        at = [x, y];
        await pen('mouseMoved', x, y, 1);
      },
      up: () => pen('mouseReleased', at[0], at[1], 0),
    };
  }
  const pt = (x, y) => ({ x, y, id: 1 });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  return {
    down: (x, y) => touch('touchStart', [pt(x, y)]),
    move: (x, y) => touch('touchMove', [pt(x, y)]),
    up: () => touch('touchEnd', []),
  };
}

/** Points along a line, a few of them: software frames are slow, so moves come a frame at a time. */
const along = ([x0, y0], [x1, y1], n = 6) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * (i + 1)) / n, y0 + ((y1 - y0) * (i + 1)) / n]);

/** The centre of a tool's tile on the bar, and in the window. */
const centre = (page, id) =>
  page.evaluate((i) => {
    const r = document.querySelector(`.sculpt-toolbar__btn[data-tool="${i}"]:not([hidden])`).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, id);
const tileC = (page, id) =>
  page.evaluate((i) => {
    const r = document.querySelector(`.lib-tile[data-tool="${i}"]`).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, id);

/** The bar as it shows: tool, place, badge of the tiles on screen, in the order they stand. */
const bar = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.sculpt-toolbar__brushes .sculpt-toolbar__btn')]
      .filter((b) => !b.hidden)
      .map((b) => ({
        id: b.dataset.tool,
        place: b.dataset.place ?? '',
        extra: b.classList.contains('sculpt-toolbar__btn--extra'),
        badge: b.querySelector('.sculpt-toolbar__key')?.textContent ?? '',
        badgeShown: !!b.querySelector('.sculpt-toolbar__key') && getComputedStyle(b.querySelector('.sculpt-toolbar__key')).display !== 'none',
        transform: b.style.transform,
      })),
  );
const order = (page, ws = 'sculpt') => page.evaluate((w) => [...window.__sculpt.tools.bars.order(w)], ws);
const standing = async (page) => (await bar(page)).filter((b) => b.place).map((b) => b.id);
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), BARS);
const inHand = (page) => page.evaluate(() => [...document.querySelectorAll('.sculpt-toolbar__btn--active')].filter((b) => b.dataset.tool && !b.hidden).map((b) => b.dataset.tool).join());
const ghosts = (page) => page.evaluate(() => document.querySelectorAll('.dock-ghost').length);
const notes = (page) => page.evaluate(() => [...document.querySelectorAll('[data-role="tool-bar-note"]')].map((n) => n.querySelector('.file-menu__words')?.textContent ?? ''));
const winRect = (page) =>
  page.evaluate(() => {
    const w = document.querySelector('.lib-window');
    if (!w || w.hidden) return null;
    const r = w.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
/** The area the strip above and the tool bar below leave, as the window centres in it. */
const freeArea = (page) =>
  page.evaluate(() => {
    const strip = document.querySelector('.bz-strip')?.getBoundingClientRect();
    const bar = document.querySelector('.sculpt-toolbar__brushes')?.getBoundingClientRect();
    const top = strip ? strip.bottom + 4 : 32;
    const bottom = bar && bar.width > 0 && bar.top > top ? bar.top : window.innerHeight;
    return { cx: window.innerWidth / 2, cy: (top + bottom) / 2 };
  });
const centred = async (page) => {
  const [r, a] = [await winRect(page), await freeArea(page)];
  return Math.abs(r.x + r.w / 2 - a.cx) <= 2 && Math.abs(r.y + r.h / 2 - a.cy) <= 2;
};
const isOpen = async (page) => (await winRect(page)) !== null;
const foot = (page) => page.evaluate(() => document.querySelector('.lib-foot')?.textContent ?? '');

/** Boot Sculpt with the bar record (and the window's) stored first, at the iPad's size. */
async function boot(page, base, bars = null, lib = null) {
  await page.setViewportSize({ width: 1180, height: 820 });
  await openForInput(page, base);
  await page.evaluate(
    ([b, l, kb, kl]) => {
      for (const [k, v] of [[kb, b], [kl, l]]) {
        if (v === null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      }
    },
    [bars, lib, BARS, LIB],
  );
  await openForInput(page, base);
}

/** A context of its own with a touchscreen; the caller closes it. */
async function touchPage(page, base, bars = null) {
  const ctx = await page.context().browser().newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await boot(p, base, bars);
  return { p, ctx, errors };
}

/** Open the window by the Tool panel's Library button, as a person does. */
async function openLib(page) {
  const collapsed = await page.evaluate(() => !!document.querySelector('.panel--sculpt.panel--collapsed'));
  if (collapsed) await page.click('.panel--sculpt > .panel__handle');
  await page.click('[data-role="library-open"]');
  await page.waitForSelector('.lib-window:not([hidden])');
  // The panel is in the way of nothing here, and the window is what the test wants.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id: 'sculpt', open: false } })));
  await wait(page, 100);
}

/** A View menu row, by its label: its state, or its press. */
async function viewItem(page, label, press = false) {
  await page.evaluate(() => [...document.querySelectorAll('.bz-strip__menus .bz-menuname')].find((b) => b.textContent === 'View')?.click());
  await page.waitForSelector('.bz-menuname.is-open');
  const state = await page.evaluate(
    ([l, go]) => {
      const b = [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].find((x) => (x.querySelector('.file-menu__label')?.textContent ?? x.textContent.trim()) === l);
      if (!b) return null;
      const s = { disabled: b.disabled, checked: b.getAttribute('aria-checked') === 'true' };
      if (go) b.click();
      return s;
    },
    [label, press],
  );
  if (await page.evaluate(() => !!document.querySelector('.bz-menuname.is-open'))) await page.keyboard.press('Escape');
  await wait(page, 150);
  return state;
}

/** Lift a tile from the window: a mouse drags, a Pencil or finger holds. */
async function liftFrom(page, ptr, kind, id, { hold = 750 } = {}) {
  const [x, y] = await tileC(page, id);
  await ptr.down(x, y);
  if (kind === 'mouse') await ptr.move(x + 8, y);
  else await wait(page, hold);
  await page.waitForSelector('.dock-ghost', { state: 'attached', timeout: 5000 });
  return [x, y];
}

/** Lift a tile from the bar. */
async function liftBar(page, ptr, kind, id, { hold = 750 } = {}) {
  const [x, y] = await centre(page, id);
  await ptr.down(x, y);
  if (kind === 'mouse') await ptr.move(x + 8, y);
  else await wait(page, hold);
  await page.waitForSelector('.dock-ghost', { state: 'attached', timeout: 5000 });
  return [x, y];
}

/** The point on the bar between two tiles (by their ids), at the bar's height. */
async function between(page, a, b) {
  const [ax, ay] = await centre(page, a);
  const [bx] = await centre(page, b);
  return [(ax + bx) / 2, ay];
}

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/libtabs';
const showTab = async (page, name) => {
  await page.click(`.lib-tab:text-is("${name}")`);
  await wait(page, 200);
};
const tabTiles = (page, tab) =>
  page.evaluate(
    (id) =>
      [...document.querySelectorAll(`.lib-body[data-tab="${id}"] .lib-tile`)]
        .filter((b) => !b.hidden)
        .map((b) => ({ id: b.dataset.asset, label: b.querySelector('.lib-tile__name').textContent, state: b.dataset.state || '', img: !!b.querySelector('img') })),
    tab,
  );
const tapAsset = (page, tab, id) => page.evaluate(([tb, i]) => document.querySelector(`.lib-body[data-tab="${tb}"] .lib-tile[data-asset="${i}"]`).click(), [tab, id]);
const waitMark = (page, tab, id, state) =>
  page.waitForFunction(([tb, i, s]) => document.querySelector(`.lib-body[data-tab="${tb}"] .lib-tile[data-asset="${i}"]`)?.dataset.state === s, [tab, id, state], { timeout: 20000 });
/** Scroll every picture of a tab into view and say which did not load. */
const thumbsLoad = (page, tab) =>
  page.evaluate(async (id) => {
    const body = document.querySelector(`.lib-body[data-tab="${id}"]`);
    const imgs = [...body.querySelectorAll('.lib-tile:not([hidden]) img')];
    for (const im of imgs) {
      im.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 80));
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && imgs.some((i) => !i.complete)) await new Promise((r) => setTimeout(r, 150));
    body.scrollTop = 0;
    return imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.src);
  }, tab);

const KINDS = ['mouse', 'pen', 'touch'];
const stripKey = (rec) => JSON.stringify(rec);

export const suites = {
  async libraryWindow(page, base, t) {
    await boot(page, base);
    t.ok(!(await isOpen(page)), 'the window is not up at the start');
    t.eq(await page.evaluate(() => document.querySelectorAll('.panel__libbtn').length), 1, 'the Tool panel has one Library button');
    t.eq(await page.evaluate(() => document.querySelector('.panel__libbtn').textContent), 'Library', 'and it says Library');
    t.eq(await page.evaluate(() => document.querySelector('.panel--sculpt .panel__header').contains(document.querySelector('.panel__libbtn'))), true, 'in the panel heading');

    // --- opening ---
    await page.click('.panel--sculpt > .panel__handle');
    await page.click('[data-role="library-open"]');
    await page.waitForSelector('.lib-window:not([hidden])');
    t.ok(await isOpen(page), 'the Tool panel button opens the window');
    t.eq(await page.evaluate(() => document.querySelector('.lib-window').getAttribute('aria-label')), 'Asset library', 'a window named Asset library');
    t.eq(await page.evaluate(() => document.querySelector('.lib-title__name').textContent), 'Asset library', 'with the name in its title row');
    const r = await winRect(page);
    t.ok(r.w === 560 && r.h === 520, `560 by 520 (${r.w} by ${r.h})`);
    t.ok(await centred(page), `centred in the free area (${JSON.stringify(await freeArea(page))} for ${JSON.stringify(r)})`);
    t.ok(r.x >= 0 && r.y >= 28 && r.x + r.w <= 1180 && r.y + r.h <= 820, 'inside the view');
    // The iPad turned: an unmoved window stays centred, the size as it was.
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.waitForFunction(() => Math.abs(document.querySelector('.lib-window').getBoundingClientRect().left + 280 - 410) <= 2);
    const pr = await winRect(page);
    t.ok(pr.w === 560 && pr.h === 520 && (await centred(page)), `centred at 820 by 1180 too (${JSON.stringify(pr)})`);
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.waitForFunction(() => Math.abs(document.querySelector('.lib-window').getBoundingClientRect().left - 310) <= 2);
    const clear = await page.evaluate(() => {
      const w = document.querySelector('.lib-window').getBoundingClientRect();
      const hit = (sel) => {
        const e = document.querySelector(sel)?.getBoundingClientRect();
        return !!e && w.left < e.right && w.right > e.left && w.top < e.bottom && w.bottom > e.top;
      };
      return { bar: hit('.sculpt-toolbar__brushes'), edge: hit('.bz-edge') };
    });
    t.ok(!clear.bar && !clear.edge, 'clear of the tool bar and the edge column');
    t.eq(await page.evaluate(() => document.activeElement === document.querySelector('.lib-window')), true, 'the focus is inside it');
    const stack = await page.evaluate(() => {
      const z = (s) => Number(getComputedStyle(document.querySelector(s)).zIndex);
      return { win: z('.lib-window'), panel: z('.panel--sculpt'), ask: 200 };
    });
    t.ok(stack.win > stack.panel && stack.win < stack.ask, `it stands above the panels and below every asking window (z ${stack.win}, panels ${stack.panel})`);
    t.eq((await viewItem(page, 'Asset library'))?.checked, true, 'View, Asset library is checked while it is up');

    // --- closing: the button, Esc with the focus inside, the menu ---
    await page.click('[data-role="asset-library-close"]');
    t.ok(!(await isOpen(page)), 'the close button closes it');
    t.eq(await page.evaluate(() => document.querySelector('[data-role="asset-library-close"]').getAttribute('aria-label')), 'Close', 'the × is a button with the label Close');
    await viewItem(page, 'Asset library', true);
    t.ok(await isOpen(page), 'View, Asset library opens it (a toggle)');
    t.eq((await viewItem(page, 'Asset library'))?.checked, true, 'and shows it checked');
    await page.focus('.lib-window');
    await page.keyboard.press('Escape');
    t.ok(!(await isOpen(page)), 'Esc closes it while the focus is inside it');
    await viewItem(page, 'Asset library', true);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    t.ok(await isOpen(page), 'Esc with the focus elsewhere leaves it up');
    await viewItem(page, 'Asset library', true);
    t.ok(!(await isOpen(page)), 'View, Asset library closes it too');

    // --- the other workspaces have the menu item ---
    await page.keyboard.press('Shift+3');
    await wait(page, 600);
    t.ok(await viewItem(page, 'Asset library'), 'Paint has View, Asset library');
    await page.keyboard.press('Shift+4');
    await wait(page, 800);
    t.ok(await viewItem(page, 'Asset library'), 'and Present has it');
    await page.keyboard.press('Shift+2');
    await wait(page, 800);

    // --- the tabs, the wheres, the search ---
    await openLib(page);
    t.eq(await page.evaluate(() => [...document.querySelectorAll('.lib-tab')].map((b) => b.textContent).join()), 'Tools,Models,Materials,Lighting,HDRIs', 'five tabs, always there');
    t.eq(await page.evaluate(() => document.querySelector('.lib-tab.is-on').textContent), 'Tools', 'the window opens on Tools');
    t.eq(await page.evaluate(() => [...document.querySelectorAll('.lib-where')].map((b) => b.textContent).join()), 'Library,Scene', 'Library and Scene under the tabs (the Community comes later, and is not shown)');
    for (const tab of ['Models', 'Materials', 'Lighting', 'HDRIs']) {
      await showTab(page, tab);
      t.eq(await page.evaluate(() => [...document.querySelectorAll('.lib-where')].map((b) => b.textContent).join()), 'Library,Scene', `${tab}: the second button reads Scene, and no tab says Mine`);
    }
    await showTab(page, 'Tools');
    t.eq(await page.evaluate(() => document.querySelector('.lib-where.is-on').textContent), 'Library', 'Library is the one showing');
    for (const tab of ['Models', 'Materials', 'Lighting', 'HDRIs']) {
      await page.click(`.lib-tab:text-is("${tab}")`);
      const n = await page.evaluate(() => document.querySelectorAll('.lib-body:not([hidden]) .lib-tile').length);
      t.ok(n > 0, `${tab} has its tiles (${n})`);
    }
    await page.click('.lib-tab:text-is("Tools")');
    t.eq(await page.evaluate(() => document.querySelectorAll('.lib-body:not([hidden]) .lib-tile:not([hidden])').length), 15, 'Tools shows the 15 tools of the two bars');
    await page.click('.lib-where:text-is("Scene")');
    t.eq(await page.evaluate(() => document.querySelector('.lib-body:not([hidden]) .lib-empty:not([hidden])')?.textContent ?? ''), 'Tools kept in a scene will show here.', 'Scene on Tools says what shows there');
    t.eq(await page.evaluate(() => document.querySelectorAll('.lib-body:not([hidden]) .lib-tile:not([hidden])').length), 0, 'and has no tiles yet');
    await page.click('.lib-where:text-is("Library")');
    await page.fill('.lib-search', 'cla');
    t.eq(await page.evaluate(() => [...document.querySelectorAll('.lib-body[data-tab="tools"] .lib-tile:not([hidden])')].map((b) => b.dataset.tool).join()), 'bz.clay', 'Search filters the tiles by name as you type');
    await page.fill('.lib-search', 'AK');
    t.eq(await page.evaluate(() => [...document.querySelectorAll('.lib-body[data-tab="tools"] .lib-tile:not([hidden])')].map((b) => b.dataset.tool).join()), 'bz.rake', 'in any case, anywhere in the name (Rake)');
    await page.fill('.lib-search', 'zzz');
    t.eq(await page.evaluate(() => document.querySelector('.lib-body:not([hidden]) .lib-empty:not([hidden])')?.textContent ?? ''), 'Nothing called that.', 'a search with no match says so');
    t.eq(await page.evaluate(() => document.querySelectorAll('.lib-body[data-tab="tools"] .lib-group:not([hidden])').length), 0, 'and shows no group heading');
    await page.fill('.lib-search', '');
    t.eq(await page.evaluate(() => document.querySelectorAll('.lib-body[data-tab="tools"] .lib-tile:not([hidden])').length), 15, 'clearing it brings them all back');
    // Typing in the field does not take a tool.
    const before = await inHand(page);
    await page.fill('.lib-search', '');
    await page.focus('.lib-search');
    await page.keyboard.type('2');
    t.eq(await inHand(page), before, 'a digit typed in the search is text, not a tool key');
    await page.fill('.lib-search', '');

    // --- a stroke on the model works with it open ---
    await page.evaluate(() => document.activeElement?.blur());
    const strokes = () => page.evaluate(() => window.__sculpt.input.strokeCount());
    const s0 = await strokes();
    // The window opens over the middle: put it to the right so the model is clear.
    const wr = await winRect(page);
    await page.mouse.move(wr.x + 120, wr.y + 22);
    await page.mouse.down();
    for (const [x, y] of along([wr.x + 120, wr.y + 22], [wr.x + 420, wr.y + 22], 4)) await page.mouse.move(x, y);
    await page.mouse.up();
    const model = [430, 380];
    await page.mouse.move(...model);
    await page.mouse.down();
    for (const [x, y] of along(model, [model[0] + 60, model[1]], 3)) await page.mouse.move(x, y);
    await page.mouse.up();
    t.ok((await strokes()) > s0, 'a mouse stroke on the model works with the window open');
    const pen = await pointer(page, 'pen');
    const s1 = await strokes();
    await pen.down(...model);
    for (const [x, y] of along(model, [model[0] + 60, model[1] + 20], 3)) await pen.move(x, y);
    await pen.up();
    t.ok((await strokes()) > s1, 'and a Pencil stroke');
    t.ok(await isOpen(page), 'the window stays up while you work');

    // --- Tab hides it with the rest ---
    for (let i = 0; i < 3 && !(await page.evaluate(() => document.body.classList.contains('chrome-hidden'))); i++) {
      await page.keyboard.press('Tab');
      await wait(page, 100);
    }
    await wait(page, 900);
    t.eq(await page.evaluate(() => getComputedStyle(document.querySelector('.lib-window')).visibility), 'hidden', 'Tab hides the window with the rest of the interface');
    await page.keyboard.press('Tab');
    await wait(page, 450);
    t.eq(await page.evaluate(() => getComputedStyle(document.querySelector('.lib-window')).visibility), 'visible', 'and it comes back with it');
  },

  async libraryMove(page, base, t) {
    // Moving, resizing and keeping, by mouse, Pencil and finger.
    const go = async (p, kind) => {
      const ptr = await pointer(p, kind);
      await openLib(p);
      const r0 = await winRect(p);
      const title = [r0.x + 120, r0.y + 22];
      await ptr.down(...title);
      for (const [x, y] of along(title, [title[0] - 160, title[1] + 70], 4)) await ptr.move(x, y);
      await ptr.up();
      await wait(p, 150);
      const r1 = await winRect(p);
      t.ok(Math.abs(r1.x - (r0.x - 160)) <= 2 && Math.abs(r1.y - (r0.y + 70)) <= 2 && r1.w === r0.w && r1.h === r0.h, `${kind}: dragging the title row moves the window (${r0.x},${r0.y} to ${r1.x},${r1.y})`);
      const grip = [r1.x + r1.w - 12, r1.y + r1.h - 12];
      await ptr.down(...grip);
      for (const [x, y] of along(grip, [grip[0] + 60, grip[1] + 40], 4)) await ptr.move(x, y);
      await ptr.up();
      await wait(p, 150);
      const r2 = await winRect(p);
      t.ok(Math.abs(r2.w - (r1.w + 60)) <= 2 && Math.abs(r2.h - (r1.h + 40)) <= 2 && r2.x === r1.x && r2.y === r1.y, `${kind}: dragging the lower right corner resizes it (${r1.w}x${r1.h} to ${r2.w}x${r2.h})`);
      // A press on the body does not move it.
      const body = [r2.x + r2.w / 2, r2.y + r2.h - 60];
      await ptr.down(...body);
      await ptr.move(body[0] + 50, body[1] + 30);
      await ptr.up();
      t.eq(JSON.stringify(await winRect(p)), JSON.stringify(r2), `${kind}: a press and drag on its body moves nothing`);
      // The edge keeps it inside.
      const t2 = [r2.x + 100, r2.y + 22];
      await ptr.down(...t2);
      for (const [x, y] of along(t2, [-400, -400], 3)) await ptr.move(x, y);
      await ptr.up();
      await wait(p, 150);
      const r3 = await winRect(p);
      t.ok(r3.x >= 0 && r3.y >= 24, `${kind}: dragged off the view it stops inside it (${r3.x},${r3.y})`);
      return r3;
    };
    await boot(page, base);
    await go(page, 'mouse');
    await boot(page, base);
    await go(page, 'pen');
    const tp = await touchPage(page, base);
    try {
      await go(tp.p, 'touch');
    } finally {
      await tp.ctx.close();
    }
    t.ok(!tp.errors.length, `no page errors${tp.errors.length ? `: ${tp.errors.join(' | ')}` : ''}`);

    // --- kept: place, size and last tab, across a reload ---
    await boot(page, base);
    await openLib(page);
    const mouse = await pointer(page, 'mouse');
    let r = await winRect(page);
    await mouse.down(r.x + 100, r.y + 22);
    for (const [x, y] of along([r.x + 100, r.y + 22], [r.x - 20, r.y + 52], 3)) await mouse.move(x, y);
    await mouse.up();
    r = await winRect(page);
    await mouse.down(r.x + r.w - 10, r.y + r.h - 10);
    for (const [x, y] of along([r.x + r.w - 10, r.y + r.h - 10], [r.x + r.w + 20, r.y + r.h + 10], 3)) await mouse.move(x, y);
    await mouse.up();
    await page.click('.lib-tab:text-is("Lighting")');
    const mine = await winRect(page);
    const rec = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), LIB));
    t.ok(rec.v === 1 && rec.x === mine.x && rec.y === mine.y && rec.w === mine.w && rec.h === mine.h && rec.tab === 'lighting', `kept through the device store (${JSON.stringify(rec)})`);
    await openForInput(page, base);
    t.ok(!(await isOpen(page)), 'it does not reopen by itself after a reload');
    await viewItem(page, 'Asset library', true);
    t.eq(JSON.stringify(await winRect(page)), JSON.stringify(mine), 'place and size survive a reload');
    t.eq(await page.evaluate(() => document.querySelector('.lib-tab.is-on').textContent), 'Lighting', 'and so does the last tab');
    // The old default in storage is no memory: the new centred default opens.
    await boot(page, base, null, JSON.stringify({ v: 1, x: 614, y: 64, w: 420, h: 480, tab: 'tools' }));
    await viewItem(page, 'Asset library', true);
    const olds = await winRect(page);
    t.ok(olds.w === 560 && olds.h === 520 && (await centred(page)), `the old default kept in storage gives the new default (${JSON.stringify(olds)})`);
    // A stored place that no longer fits the view is brought inside.
    await boot(page, base, null, JSON.stringify({ v: 1, x: 5000, y: 5000, w: 9000, h: 9000, tab: 'tools' }));
    await viewItem(page, 'Asset library', true);
    const far = await winRect(page);
    t.ok(far.x >= 0 && far.y >= 24 && far.x + far.w <= 1180 && far.y + far.h <= 820, `a stored place outside the view is brought inside (${JSON.stringify(far)})`);
    await boot(page, base, null, 'not json {');
    await viewItem(page, 'Asset library', true);
    t.ok(await isOpen(page), 'a record that is not JSON leaves the default place');
    // The view is resized: it keeps inside.
    const r4 = await winRect(page);
    await page.setViewportSize({ width: 800, height: 600 });
    await wait(page, 250);
    const small = await winRect(page);
    t.ok(small.x >= 0 && small.y >= 0 && small.x + small.w <= 800 && small.y + small.h <= 600, `a smaller view keeps it inside (${JSON.stringify(small)})`);
  },

  async libraryTools(page, base, t) {
    await boot(page, base);
    await openLib(page);
    const info = () =>
      page.evaluate(() => {
        const groups = [...document.querySelectorAll('.lib-body[data-tab="tools"] .lib-group:not([hidden])')].map((g) => ({ ws: g.dataset.group, head: g.querySelector('.lib-group__head').textContent, tools: [...g.querySelectorAll('.lib-tile')].map((b) => b.dataset.tool) }));
        return groups;
      });
    let g = await info();
    t.eq(g.map((x) => `${x.head}:${x.tools.length}`).join(' '), 'Sculpt:9 Paint:6', 'in Sculpt: two groups, Sculpt first (9 tools) and Paint (6)');
    t.eq(g[0].tools.join(), SCULPT_BAR.join(), "the Sculpt group is the default bar's order");
    t.eq(g[1].tools.join(), PAINT_BAR.join(), 'and the Paint group too');
    const sizes = await page.evaluate(() => [...document.querySelectorAll('.lib-tile')].map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height)));
    t.ok(sizes.every((s) => s >= 64), `every tile is at least 64px (least ${Math.min(...sizes)})`);
    const content = await page.evaluate(() => [...document.querySelectorAll('.lib-tile')].every((b) => (b.querySelector('.fi') || b.querySelector('.sculpt-toolbar__svg')) && b.querySelector('.lib-tile__name').textContent.length > 0));
    t.ok(content, "each tile has the tool's icon and its name");
    t.eq(await page.evaluate(() => document.querySelector('.lib-tile[data-tool="bz.clay"] .lib-tile__name').textContent), 'Standard clay', 'by the name the bar uses');
    const marks = await page.evaluate(() => [...document.querySelectorAll('.lib-tile')].map((b) => getComputedStyle(b.querySelector('.lib-tile__mark')).display !== 'none'));
    t.ok(marks.every(Boolean), 'every tool is on its bar, so every tile has the mark');

    // The tool in hand has the orange tile, as on the bar.
    await page.keyboard.press('3');
    await wait(page, 150);
    t.eq(await page.evaluate(() => [...document.querySelectorAll('.lib-tile.is-hand')].map((b) => b.dataset.tool).join()), 'bz.clay', 'the tool in hand has the orange tile in the window');
    const colour = await page.evaluate(() => [getComputedStyle(document.querySelector('.lib-tile.is-hand')).backgroundColor, getComputedStyle(document.querySelector('.sculpt-toolbar__btn--active')).backgroundColor]);
    t.eq(colour[0], colour[1], `in the same orange as the bar (${colour[0]})`);
    t.eq(await page.evaluate(() => document.querySelectorAll('.lib-tile[style*="orange"], .lib-tile.is-hand').length), 1, 'and only that one');

    // A tap takes a tool in hand.
    await page.click('.lib-tile[data-tool="bz.rake"]');
    await wait(page, 150);
    t.eq(await inHand(page), 'bz.rake', 'a tap on a tile takes the tool in hand, as picking it on the bar');
    t.eq(await page.evaluate(() => document.querySelector('.lib-tile.is-hand').dataset.tool), 'bz.rake', 'and the orange follows');
    const pen = await pointer(page, 'pen');
    const [px, py] = await tileC(page, 'bz.pinch');
    await pen.down(px, py);
    await wait(page, 100);
    await pen.up();
    await wait(page, 200);
    t.eq(await inHand(page), 'bz.pinch', 'also a tap with the Pencil');

    // A tool of the other workspace says where it is used, and does nothing else.
    const dim = await page.evaluate(() => getComputedStyle(document.querySelector('.lib-tile[data-tool="bz.paint"]')).color !== getComputedStyle(document.querySelector('.lib-tile[data-tool="bz.clay"]')).color);
    t.ok(dim, 'a Paint tool is dimmed in Sculpt');
    await page.click('.lib-tile[data-tool="bz.paint"]');
    await wait(page, 100);
    t.eq(await foot(page), 'This is a Paint tool. It is used in Paint.', "a tap on it says so in the window's foot");
    t.eq(await inHand(page), 'bz.pinch', 'and does nothing else');
    const paintMode = await page.evaluate(() => window.__sculpt.paintWorkspace.isOn());
    t.ok(!paintMode, 'it did not switch workspace');

    // In Paint the groups swap, and the Sculpt tools are the dim ones.
    await page.keyboard.press('Shift+3');
    await wait(page, 700);
    g = await info();
    t.eq(g.map((x) => x.head).join(), 'Paint,Sculpt', 'in Paint the Paint group comes first');
    await page.click('.lib-tile[data-tool="bz.clay"]');
    await wait(page, 100);
    t.eq(await foot(page), 'This is a Sculpt tool. It is used in Sculpt.', 'and a Sculpt tool says where it is used');
    await page.click('.lib-tile[data-tool="bz.blur"]');
    await wait(page, 150);
    t.eq(await inHand(page), 'bz.blur', 'a Paint tool is taken in hand in Paint');
    t.eq(await page.evaluate(() => document.querySelector('.lib-tile.is-hand').dataset.tool), 'bz.blur', 'with the orange tile');
    // Present has no tools to use.
    await page.keyboard.press('Shift+4');
    await wait(page, 900);
    await page.click('.lib-tile[data-tool="bz.fill"]');
    await wait(page, 100);
    t.eq(await foot(page), 'Tools are not used in Present.', 'in Present a tap says tools are not used there');
    await page.keyboard.press('Shift+3');
    await wait(page, 900);

    // The marks follow the bar.
    await page.evaluate(() => window.__sculpt.tools.bars.set('paint', ['bz.paint', 'bz.fill']));
    await wait(page, 150);
    const kept = await page.evaluate(() => [...document.querySelectorAll('.lib-tile.is-kept')].filter((b) => ['bz.paint', 'bz.erase', 'bz.blur', 'bz.fill', 'bz.pick', 'bz.project'].includes(b.dataset.tool)).map((b) => b.dataset.tool).join());
    t.eq(kept, 'bz.paint,bz.fill', 'a tool that is not on its bar has no mark');
  },

  async libraryLift(page, base, t) {
    // A tile lifted from the window onto the bar. Clay and Rake are off the bar to begin with.
    const OFF = ['bz.crease', 'bz.move', 'bz.inflate', 'bz.pinch', 'bz.flatten', 'bz.drag', 'bz.polish'];
    const rec = stripKey({ v: 2, sculpt: { ids: OFF, known: SCULPT_BAR } });
    const check = async (p, kind) => {
      const ptr = await pointer(p, kind);
      await openLib(p);
      // Another tool is in hand, so Clay is not the extra tile.
      await p.keyboard.press('1');
      await wait(p, 100);
      t.eq((await standing(p)).join(), OFF.join(), `${kind}: the bar starts without Clay and Rake`);
      const handBefore = await inHand(p);
      const from = await liftFrom(p, ptr, kind, 'bz.clay');
      t.eq(await ghosts(p), 1, `${kind}: lifting a tile in the window lifts a ghost`);
      t.eq(await p.evaluate(() => document.querySelector('.lib-tile[data-tool="bz.clay"]').classList.contains('dock-origin')), true, `${kind}: the tile stays and dims`);
      t.eq(await p.evaluate(() => document.querySelector('.dock-ghost__name').textContent), 'Standard clay', `${kind}: the ghost carries the name`);
      // Over the bar, between Move and Inflate: the gap opens there.
      const to = await between(p, 'bz.move', 'bz.inflate');
      for (const [x, y] of along(from, to, 6)) await ptr.move(x, y);
      await wait(p, 300);
      const mid = await bar(p);
      const tiles = mid.filter((b) => b.place);
      t.ok(tiles.every((b) => b.badgeShown), `${kind}: every digit shows`);
      const digits = tiles.map((b) => `${b.id.slice(3)}${b.badge}`).join(' ');
      t.eq(tiles.map((b) => b.badge).join(''), '1245678', `${kind}: the others show the digits they will have, 3 left for the new tile (${digits})`);
      const moved = Object.fromEntries(tiles.map((b) => [b.id, b.transform]));
      t.ok(/translate3d\(-/.test(moved['bz.crease']) && /translate3d\(-/.test(moved['bz.move']) && /translate3d\(\d/.test(moved['bz.inflate']) && /translate3d\(\d/.test(moved['bz.polish']), `${kind}: the tiles before slide left, the ones after slide right (${moved['bz.move']} | ${moved['bz.inflate']})`);
      t.eq(await p.evaluate(() => document.querySelector('.sculpt-toolbar__brushes').classList.contains('dock-room')), true, `${kind}: and the bar's box makes room`);
      t.eq((await order(p)).join(), OFF.join(), `${kind}: nothing is changed until it is let go`);
      await ptr.up();
      await wait(p, 500);
      const want = ['bz.crease', 'bz.move', 'bz.clay', 'bz.inflate', 'bz.pinch', 'bz.flatten', 'bz.drag', 'bz.polish'];
      t.eq((await order(p)).join(), want.join(), `${kind}: let go on the bar, Clay is in the place shown`);
      t.eq((await standing(p)).join(), want.join(), `${kind}: the tiles stand in that order`);
      t.eq(await ghosts(p), 0, `${kind}: the ghost is gone`);
      t.ok(await p.evaluate(() => [...document.querySelectorAll('.sculpt-toolbar__btn')].every((b) => !b.style.transform && !b.classList.contains('dock-gap')) && !document.querySelector('.sculpt-toolbar__brushes').classList.contains('dock-room')), `${kind}: nothing is left shifted, hidden or widened`);
      t.eq(await p.evaluate(() => document.querySelector('.lib-tile[data-tool="bz.clay"]').classList.contains('dock-origin')), false, `${kind}: the window's tile is back`);
      t.eq(await inHand(p), handBefore, `${kind}: nothing was picked`);
      t.eq(await notes(p).then((n) => n.length), 0, `${kind}: no notice (the bar shows the result)`);
      t.eq(JSON.parse(await stored(p)).sculpt.ids.join(), want.join(), `${kind}: and it is kept`);
      t.eq(await p.evaluate(() => document.querySelector('.lib-tile[data-tool="bz.clay"]').classList.contains('is-kept')), true, `${kind}: Clay's tile has its mark`);
      // The keys follow.
      for (let i = 0; i < want.length; i++) {
        await p.keyboard.press(KEYS[i]);
        await wait(p, 60);
        const lit = await inHand(p);
        if (lit !== want[i]) t.ok(false, `${kind}: key ${KEYS[i]} picked ${lit}, wanted ${want[i]}`);
      }
      await p.keyboard.press('3');
      t.eq(await inHand(p), 'bz.clay', `${kind}: key 3 picks Clay`);
      const names = await p.evaluate((ids) => ids.map((id) => window.__sculpt.tools.registry.find((d) => d.id === id).name), want);
      await p.keyboard.press('h');
      await wait(p, 200);
      const guide = await p.evaluate(() => document.querySelector('.help-guide')?.textContent ?? '');
      t.ok(names.every((n, i) => guide.includes(`Tool bar, place ${i + 1}: ${n}`)), `${kind}: the hotkey guide names the tool in each place`);
      await p.keyboard.press('h');
      await p.keyboard.press('Control+Comma');
      await wait(p, 200);
      const rows = await p.evaluate(() => [...document.querySelectorAll('.prefs__row .prefs__label')].map((l) => l.textContent).filter((x) => /^Tool bar/.test(x)));
      t.ok(names.every((n, i) => rows[i] === `Tool bar, place ${i + 1}: ${n}`) && rows[8] === 'Tool bar, place 9: empty', `${kind}: Preferences lists them (${rows[2]})`);
      await p.evaluate(() => [...document.querySelectorAll('.prefs button')].find((b) => b.textContent === 'Close')?.click());
      await wait(p, 100);
    };
    await boot(page, base, rec);
    await check(page, 'mouse');
    await boot(page, base, rec);
    await check(page, 'pen');
    const tp = await touchPage(page, base, rec);
    try {
      await check(tp.p, 'touch');
    } finally {
      await tp.ctx.close();
    }
    t.ok(!tp.errors.length, `no page errors${tp.errors.length ? `: ${tp.errors.join(' | ')}` : ''}`);

    // --- at either end, and into an empty bar ---
    await boot(page, base, rec);
    await openLib(page);
    const mouse = await pointer(page, 'mouse');
    let from = await liftFrom(page, mouse, 'mouse', 'bz.clay');
    const [lx, ly] = await centre(page, 'bz.crease');
    for (const [x, y] of along(from, [lx - 20, ly], 5)) await mouse.move(x, y);
    await mouse.up();
    await wait(page, 500);
    t.eq((await order(page)).join(), ['bz.clay', ...OFF].join(), 'dropped before the first tool, it takes the first place');
    await boot(page, base, rec);
    await openLib(page);
    from = await liftFrom(page, mouse, 'mouse', 'bz.rake');
    const [ex, ey] = await centre(page, 'bz.polish');
    for (const [x, y] of along(from, [ex + 20, ey], 5)) await mouse.move(x, y);
    await mouse.up();
    await wait(page, 500);
    t.eq((await order(page)).join(), [...OFF, 'bz.rake'].join(), 'dropped after the last tool, it takes the last place');
    await boot(page, base, stripKey({ v: 2, sculpt: { ids: [], known: SCULPT_BAR } }));
    await openLib(page);
    t.eq((await standing(page)).length, 0, 'an empty bar has no tool tiles');
    from = await liftFrom(page, mouse, 'mouse', 'bz.move');
    const [sx, sy] = await centre(page, 'bz.select');
    const [tx] = await centre(page, 'bz.transform');
    for (const [x, y] of along(from, [(sx + tx) / 2, sy], 5)) await mouse.move(x, y);
    await wait(page, 250);
    await mouse.up();
    await wait(page, 500);
    t.eq((await order(page)).join(), 'bz.move', 'a tool can be put on an empty bar');

    // --- a tool already on the bar moves to where it is dropped ---
    await boot(page, base);
    await openLib(page);
    from = await liftFrom(page, mouse, 'mouse', 'bz.polish');
    const to = await centre(page, 'bz.move');
    for (const [x, y] of along(from, to, 6)) await mouse.move(x, y);
    await wait(page, 300);
    const gapped = await page.evaluate(() => document.querySelector('.sculpt-toolbar__btn[data-tool="bz.polish"]').classList.contains('dock-gap'));
    t.ok(gapped, "over the bar its own tile is the gap");
    t.eq(await page.evaluate(() => document.querySelector('.sculpt-toolbar__brushes').classList.contains('dock-room')), false, 'and the bar does not widen');
    await mouse.up();
    await wait(page, 500);
    t.eq((await order(page)).join(), ['bz.crease', 'bz.polish', 'bz.move', 'bz.clay', 'bz.inflate', 'bz.pinch', 'bz.flatten', 'bz.rake', 'bz.drag'].join(), 'a tool already on the bar moves to the place it is dropped at');

    // --- letting go anywhere else changes nothing ---
    await boot(page, base, rec);
    await openLib(page);
    from = await liftFrom(page, mouse, 'mouse', 'bz.clay');
    for (const [x, y] of along(from, [300, 300], 4)) await mouse.move(x, y);
    await wait(page, 200);
    t.eq(await page.evaluate(() => document.querySelector('.sculpt-toolbar__brushes').classList.contains('dock-room')), false, 'away from the bar it does not open a place');
    await mouse.up();
    await wait(page, 500);
    t.eq((await order(page)).join(), OFF.join(), 'a drop elsewhere changes nothing');
    t.eq(await ghosts(page), 0, 'the ghost flew back');
    t.eq((await notes(page)).length, 0, 'with no notice');
    t.eq(await stored(page), rec, 'and nothing was stored');
    // Esc over the bar puts it back too.
    from = await liftFrom(page, mouse, 'mouse', 'bz.clay');
    for (const [x, y] of along(from, await between(page, 'bz.move', 'bz.inflate'), 4)) await mouse.move(x, y);
    await page.keyboard.press('Escape');
    await mouse.up();
    await wait(page, 500);
    t.eq((await order(page)).join(), OFF.join(), 'Esc over the bar changes nothing');
    t.ok(await page.evaluate(() => [...document.querySelectorAll('.sculpt-toolbar__btn')].every((b) => !b.style.transform) && !document.querySelector('.sculpt-toolbar__brushes').classList.contains('dock-room')), 'and nothing is left shifted or widened');
    t.ok(await isOpen(page), 'and the window is still up');

    // --- only a tool of the workspace you are in lifts ---
    await boot(page, base);
    await openLib(page);
    const [qx, qy] = await tileC(page, 'bz.paint');
    await mouse.down(qx, qy);
    await mouse.move(qx + 10, qy);
    await mouse.move(qx + 40, qy - 40);
    await wait(page, 100);
    t.eq(await ghosts(page), 0, "a Paint tool cannot be lifted in Sculpt");
    await mouse.up();
    // Nothing lifts mid-stroke.
    await page.evaluate(() => {
      window.__sculpt.input.isStroking = () => true;
    });
    const [rx, ry] = await tileC(page, 'bz.rake');
    await mouse.down(rx, ry);
    await mouse.move(rx + 20, ry);
    await wait(page, 100);
    t.eq(await ghosts(page), 0, 'and nothing lifts during a stroke');
    await mouse.up();
  },

  async libraryRemove(page, base, t) {
    // --- a bar tile dragged off the bar is taken off it ---
    const off = async (p, kind) => {
      const ptr = await pointer(p, kind);
      const from = await liftBar(p, ptr, kind, 'bz.move');
      for (const [x, y] of along(from, [from[0], from[1] - 120], 4)) await ptr.move(x, y);
      await wait(p, 300);
      t.eq(await p.evaluate(() => document.querySelector('.dock-ghost').classList.contains('dock-ghost--out')), true, `${kind}: out of the bar's zone the ghost dims`);
      const mid = await bar(p);
      const d = Object.fromEntries(mid.filter((b) => b.place).map((b) => [b.id, b]));
      t.ok(/translate3d\(-/.test(d['bz.clay'].transform) && /translate3d\(\d/.test(d['bz.crease'].transform), `${kind}: the others close the gap (${d['bz.clay'].transform} | ${d['bz.crease'].transform})`);
      t.eq(mid.filter((b) => b.place && b.id !== 'bz.move').map((b) => b.badge).join(''), '12345678', `${kind}: and show the digits they will have`);
      t.eq((await order(p)).join(), SCULPT_BAR.join(), `${kind}: nothing is changed until it is let go`);
      await ptr.up();
      await wait(p, 600);
      const want = SCULPT_BAR.filter((x) => x !== 'bz.move');
      t.eq((await order(p)).join(), want.join(), `${kind}: let go, the tool is off the bar`);
      t.eq((await standing(p)).join(), want.join(), `${kind}: its tile is gone and the others close up`);
      t.eq(await ghosts(p), 0, `${kind}: the ghost is gone`);
      t.eq((await notes(p)).join('|'), 'Move is off the tool bar. It is still in the library.', `${kind}: a notice says where it is`);
      t.ok(await p.evaluate(() => !!document.querySelector('[data-role="tool-bar-undo"]')), `${kind}: with Undo`);
      const rec = JSON.parse(await stored(p));
      t.ok(rec.v === 2 && rec.sculpt.ids.join() === want.join() && rec.sculpt.known.join() === SCULPT_BAR.join(), `${kind}: kept, with the tools the app knew (${JSON.stringify(rec)})`);
      await p.click('[data-role="tool-bar-undo"]');
      await wait(p, 200);
      t.eq((await order(p)).join(), SCULPT_BAR.join(), `${kind}: Undo puts it back where it was`);
      t.eq(await stored(p), null, `${kind}: and the default order is no longer stored`);
      t.eq((await notes(p)).length, 0, `${kind}: the notice goes`);
    };
    await boot(page, base);
    await off(page, 'mouse');
    await boot(page, base);
    await off(page, 'pen');
    const tp = await touchPage(page, base);
    try {
      await off(tp.p, 'touch');
    } finally {
      await tp.ctx.close();
    }
    t.ok(!tp.errors.length, `no page errors${tp.errors.length ? `: ${tp.errors.join(' | ')}` : ''}`);

    // --- Esc and the other cancels still put it back ---
    await boot(page, base);
    const mouse = await pointer(page, 'mouse');
    let from = await liftBar(page, mouse, 'mouse', 'bz.move');
    for (const [x, y] of along(from, [from[0], from[1] - 120], 4)) await mouse.move(x, y);
    await page.keyboard.press('Escape');
    await mouse.up();
    await wait(page, 500);
    t.eq((await order(page)).join(), SCULPT_BAR.join(), 'Esc out of the zone puts the tool back');
    from = await liftBar(page, mouse, 'mouse', 'bz.move');
    for (const [x, y] of along(from, [from[0], from[1] - 120], 4)) await mouse.move(x, y);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await mouse.up();
    await wait(page, 500);
    t.eq((await order(page)).join(), SCULPT_BAR.join(), 'the window losing focus puts it back');
    t.eq(await stored(page), null, 'and nothing was stored');

    // --- the removal survives a reload; the others keep the place they had ---
    from = await liftBar(page, mouse, 'mouse', 'bz.clay');
    for (const [x, y] of along(from, [from[0] + 400, from[1] - 200], 4)) await mouse.move(x, y);
    await mouse.up();
    await wait(page, 600);
    const without = SCULPT_BAR.filter((x) => x !== 'bz.clay');
    t.eq((await order(page)).join(), without.join(), 'a tool dragged off sideways and up is off the bar');
    await openForInput(page, base);
    t.eq((await standing(page)).join(), without.join(), 'the removal survives a reload (it does not come back)');
    await page.keyboard.press('3');
    t.eq(await inHand(page), 'bz.inflate', 'and the keys follow the shorter bar');

    // --- the bar may be emptied; Select, Transform and Calipers stay ---
    await page.evaluate(() => window.__sculpt.tools.bars.set('sculpt', []));
    await wait(page, 200);
    const empty = (await bar(page)).filter((b) => !b.extra).map((b) => b.id).join();
    t.eq(empty, 'bz.select,bz.transform,bz.calipers', `an empty bar keeps Select, Transform and Calipers (${empty})`);
    await openForInput(page, base);
    t.eq((await bar(page)).filter((b) => b.place).length, 0, 'an empty bar survives a reload');
    t.eq(JSON.parse(await stored(page)).sculpt.ids.length, 0, 'as a record with no tools');
    await page.keyboard.press('1');
    t.ok(true, 'a key for an empty place does not throw');

    // --- the stored order: v1 as before, v2 with what the app knew, a newer default ---
    await boot(page, base, stripKey({ v: 1, sculpt: OFFLIST() }));
    t.eq((await order(page)).join(), [...OFFLIST(), 'bz.clay', 'bz.rake'].join(), 'a v1 record is read as before: every missing tool is appended');
    await boot(page, base, stripKey({ v: 2, sculpt: { ids: ['bz.crease', 'bz.move'], known: SCULPT_BAR } }));
    t.eq((await order(page)).join(), 'bz.crease,bz.move', 'a v2 record keeps a removed tool off');
    const direct = await page.evaluate(
      ([bar, older]) => {
        const s = window.__sculpt.tools.sanitizeOrder;
        return {
          // The app now has Polish; a record written by a version that knew only the first eight tools gets it appended.
          newer: s('sculpt', ['bz.crease', 'bz.move', 'bz.clay'], older),
          kept: s('sculpt', ['bz.crease'], bar),
          v1: s('sculpt', ['bz.crease']),
          dirty: s('sculpt', ['bz.nope', 'bz.paint', 7, 'bz.clay', 'bz.clay', null], bar),
          paintDirty: s('paint', ['bz.clay', 'bz.paint', 'bz.pick'], ['bz.paint', 'bz.erase', 'bz.blur', 'bz.fill', 'bz.pick', 'bz.project']),
          notList: s('sculpt', 'junk', bar),
          badKnown: s('sculpt', ['bz.move'], 'junk'),
        };
      },
      [SCULPT_BAR, SCULPT_BAR.slice(0, 8)],
    );
    t.eq(direct.newer.join(), 'bz.crease,bz.move,bz.clay,bz.polish', 'a tool added to the defaults after the record was written is appended (Polish)');
    t.eq(direct.kept.join(), 'bz.crease', 'a tool the record knew and lacks stays off');
    t.eq(direct.v1.length, 9, 'with no list of what was known, everything missing is appended');
    t.eq(direct.dirty.join(), 'bz.clay', 'a tool in neither the registry nor the workspace, and a repeat, are dropped');
    t.eq(direct.paintDirty.join(), 'bz.paint,bz.pick', "a Sculpt tool is not kept on Paint's bar");
    t.eq(direct.notList.length, 0, 'a record that is not a list leaves the known tools off');
    t.eq(direct.badKnown.length, 9, 'and a list of what was known that is not a list reads as v1');
    const setBack = await page.evaluate(() => {
      window.__sculpt.tools.bars.set('sculpt', ['bz.paint', 'bz.clay', 'bz.erase']);
      return [...window.__sculpt.tools.bars.order('sculpt')];
    });
    t.eq(setBack.join(), 'bz.clay', 'the bars refuse a tool of the other workspace');

    // --- the tool in hand that is not on the bar: the extra tile ---
    await boot(page, base);
    await page.keyboard.press('7');
    t.eq(await inHand(page), 'bz.rake', 'Rake is in hand');
    from = await liftBar(page, mouse, 'mouse', 'bz.rake');
    for (const [x, y] of along(from, [from[0], from[1] - 140], 4)) await mouse.move(x, y);
    await wait(page, 200);
    const mid = await bar(page);
    t.ok(/translate3d\(-/.test(mid.find((b) => b.id === 'bz.drag').transform), 'the tool in hand leaves its place and the others close up');
    await mouse.up();
    await wait(page, 600);
    const afterBar = await bar(page);
    const extra = afterBar.find((b) => b.extra);
    t.ok(extra && extra.id === 'bz.rake', 'a tool in hand taken off the bar stands as the extra tile');
    t.eq(extra.place + extra.badge, '', 'with no digit');
    t.eq(afterBar.map((b) => b.id).join(), ['bz.select', ...SCULPT_BAR.filter((x) => x !== 'bz.rake'), 'bz.rake', 'bz.transform', 'bz.calipers'].join(), 'at the end of the tools, before Transform');
    t.eq(await inHand(page), 'bz.rake', 'and it is still in hand');
    const outline = await page.evaluate(() => getComputedStyle(document.querySelector('.sculpt-toolbar__btn--extra')).outlineStyle);
    t.ok(outline !== 'none', `with a faint outline that says it is not kept (${outline})`);
    t.eq(await page.evaluate(() => document.querySelector('.sculpt-toolbar__btn--extra').getAttribute('aria-label')), 'Rake, not on the tool bar', 'and a name that says so');
    // Picking another tool makes it go.
    await page.keyboard.press('1');
    await wait(page, 150);
    t.eq((await bar(page)).filter((b) => b.extra).length, 0, 'picking another tool makes the extra tile go');
    // The window can hand one over: a tool taken in hand from it that is not on the bar.
    await openLib(page);
    await page.click('.lib-tile[data-tool="bz.rake"]');
    await wait(page, 200);
    t.eq((await bar(page)).filter((b) => b.extra).map((b) => b.id).join(), 'bz.rake', 'a tool picked from the window that is not on the bar shows as the extra tile');
    // Lifting it and dropping it on the bar keeps it there.
    from = await liftBar(page, mouse, 'mouse', 'bz.rake');
    const spot = await between(page, 'bz.crease', 'bz.clay');
    for (const [x, y] of along(from, spot, 6)) await mouse.move(x, y);
    await wait(page, 300);
    const during = await bar(page);
    t.ok(/translate3d\(\d/.test(during.find((b) => b.id === 'bz.clay').transform), 'over the bar the tiles after the place move over');
    await mouse.up();
    await wait(page, 600);
    const kept = await bar(page);
    t.eq(await order(page).then((o) => o.join()), ['bz.crease', 'bz.move', 'bz.rake', 'bz.clay', 'bz.inflate', 'bz.pinch', 'bz.flatten', 'bz.drag', 'bz.polish'].join(), 'dropped on the bar it is kept in that place (between Move and Clay)');
    t.ok(kept.filter((b) => b.extra).length === 0 && kept.find((b) => b.id === 'bz.rake').place === '3', 'and is no longer an extra tile, with its digit');
    t.eq(await inHand(page), 'bz.rake', 'and stays in hand');
    // The window's own tool in hand that is not on the bar can be lifted from the window too.
    await page.evaluate(() => window.__sculpt.tools.bars.set('sculpt', ['bz.crease', 'bz.move']));
    await wait(page, 200);
    t.eq((await bar(page)).filter((b) => b.extra).length, 1, 'with Rake in hand and off the bar the extra tile is there');
    from = await liftFrom(page, mouse, 'mouse', 'bz.rake');
    for (const [x, y] of along(from, await between(page, 'bz.crease', 'bz.move'), 5)) await mouse.move(x, y);
    await mouse.up();
    await wait(page, 600);
    t.eq((await order(page)).join(), 'bz.crease,bz.rake,bz.move', 'lifting the extra tool from the window and dropping it keeps it too');
    t.eq((await bar(page)).filter((b) => b.extra).length, 0, 'with no extra tile left');
  },

  async libraryMenus(page, base, t) {
    await boot(page, base);
    const pen = await pointer(page, 'pen');
    const menu = (p) => p.evaluate(() => [...document.querySelectorAll('[data-role="tile-menu"] .file-menu__item')].map((b) => b.textContent));
    const press = async (p, label) => {
      await p.evaluate((l) => [...document.querySelectorAll('[data-role="tile-menu"] .file-menu__item')].find((b) => b.textContent === l)?.click(), label);
      await wait(p, 300);
    };

    // --- the menu of a bar tile: a long press that ends without moving ---
    let [x, y] = await centre(page, 'bz.pinch');
    await pen.down(x, y);
    await wait(page, 800);
    await pen.up();
    await wait(page, 200);
    t.eq((await menu(page)).join(), 'Tool settings,Remove from tool bar', 'a long press on a bar tile that ends without moving opens its menu');
    t.eq(await ghosts(page), 0, 'with no ghost');
    t.eq((await order(page)).join(), SCULPT_BAR.join(), 'and nothing changed');
    const mrect = await page.evaluate(() => {
      const m = document.querySelector('[data-role="tile-menu"]').getBoundingClientRect();
      const b = document.querySelector('.sculpt-toolbar__btn[data-tool="bz.pinch"]').getBoundingClientRect();
      return { overlaps: m.left < b.right && m.right > b.left && m.top < b.bottom && m.bottom > b.top, above: m.bottom <= b.top, near: Math.abs(m.left + m.width / 2 - (b.left + b.width / 2)) < 120 };
    });
    t.ok(mrect.above && mrect.near && !mrect.overlaps, `it stands at the tile, above it (${JSON.stringify(mrect)})`);
    // It closes on a tap outside.
    await page.mouse.click(300, 300);
    await wait(page, 150);
    t.eq((await menu(page)).length, 0, 'a tap outside closes it');
    // And on Esc.
    await pen.down(x, y);
    await wait(page, 800);
    await pen.up();
    await wait(page, 200);
    await page.keyboard.press('Escape');
    await wait(page, 100);
    t.eq((await menu(page)).length, 0, 'Esc closes it');
    // Tool settings: the tool in hand, the Tool panel open.
    await pen.down(x, y);
    await wait(page, 800);
    await pen.up();
    await wait(page, 200);
    await press(page, 'Tool settings');
    t.eq(await inHand(page), 'bz.pinch', 'Tool settings takes the tool in hand');
    t.eq(await page.evaluate(() => !document.querySelector('.panel--sculpt').classList.contains('panel--collapsed')), true, 'and opens the Tool panel');
    t.eq(await page.evaluate(() => document.querySelector('.panel--sculpt .panel__title').textContent), 'Pinch', 'on its settings');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id: 'sculpt', open: false } })));
    await wait(page, 100);
    // Remove from tool bar.
    [x, y] = await centre(page, 'bz.pinch');
    await pen.down(x, y);
    await wait(page, 800);
    await pen.up();
    await wait(page, 200);
    await press(page, 'Remove from tool bar');
    t.eq((await order(page)).join(), SCULPT_BAR.filter((i) => i !== 'bz.pinch').join(), 'Remove from tool bar takes it off');
    t.eq((await notes(page)).join('|'), 'Pinch is off the tool bar. It is still in the library.', 'with the same notice');
    t.eq((await bar(page)).filter((b) => b.extra).map((b) => b.id).join(), 'bz.pinch', 'a tool in hand that is removed stays as the extra tile');
    // The extra tile's own menu offers to keep it.
    [x, y] = await centre(page, 'bz.pinch');
    await pen.down(x, y);
    await wait(page, 800);
    await pen.up();
    await wait(page, 200);
    t.eq((await menu(page)).join(), 'Tool settings,Add to tool bar', "the extra tile's menu offers Add to tool bar");
    await press(page, 'Add to tool bar');
    t.eq((await order(page)).at(-1), 'bz.pinch', 'which puts it at the end of the bar');
    // A mouse long press opens it too.
    const mouse = await pointer(page, 'mouse');
    [x, y] = await centre(page, 'bz.drag');
    await mouse.down(x, y);
    await wait(page, 800);
    await mouse.up();
    await wait(page, 200);
    t.eq((await menu(page)).length, 2, 'a mouse held without moving opens it too');
    await page.keyboard.press('Escape');

    // --- the window's menu ---
    await openLib(page);
    [x, y] = await tileC(page, 'bz.polish');
    await pen.down(x, y);
    await wait(page, 800);
    await pen.up();
    await wait(page, 200);
    t.eq((await menu(page)).join(), 'Use,Remove from tool bar', 'in the window a long press on a tile that is on the bar opens Use and Remove from tool bar');
    const wm = await page.evaluate(() => {
      const m = document.querySelector('[data-role="tile-menu"]').getBoundingClientRect();
      const b = document.querySelector('.lib-tile[data-tool="bz.polish"]').getBoundingClientRect();
      return { under: m.top >= b.bottom - 1, z: getComputedStyle(document.querySelector('[data-role="tile-menu"]')).zIndex };
    });
    t.ok(wm.under && Number(wm.z) > 30, `at the tile, over the window (${JSON.stringify(wm)})`);
    await press(page, 'Use');
    t.eq(await inHand(page), 'bz.polish', 'Use takes the tool in hand');
    await pen.down(x, y);
    await wait(page, 800);
    await pen.up();
    await wait(page, 200);
    await press(page, 'Remove from tool bar');
    t.ok(!(await order(page)).includes('bz.polish'), 'Remove from tool bar takes it off');
    t.eq(await page.evaluate(() => document.querySelector('.lib-tile[data-tool="bz.polish"]').classList.contains('is-kept')), false, "and its tile loses the mark");
    await pen.down(x, y);
    await wait(page, 800);
    await pen.up();
    await wait(page, 200);
    t.eq((await menu(page)).join(), 'Use,Add to tool bar', 'a tool that is off the bar offers Add to tool bar');
    await press(page, 'Add to tool bar');
    t.eq((await order(page)).at(-1), 'bz.polish', 'which puts it at the end');
    t.eq(await page.evaluate(() => document.querySelector('.lib-tile[data-tool="bz.polish"]').classList.contains('is-kept')), true, 'and the mark comes back');
    await pen.down(x, y);
    await wait(page, 800);
    await pen.up();
    await wait(page, 200);
    await page.mouse.click(60, 700);
    await wait(page, 150);
    t.eq((await menu(page)).length, 0, 'a tap outside closes the window tile menu');

    // --- Reset tool bar brings back removed tools ---
    await page.evaluate(() => window.__sculpt.tools.bars.set('sculpt', ['bz.crease', 'bz.move']));
    await wait(page, 150);
    t.eq((await viewItem(page, 'Reset tool bar'))?.disabled, false, 'View, Reset tool bar is available while tools are off the bar');
    await viewItem(page, 'Reset tool bar', true);
    await wait(page, 200);
    t.eq((await order(page)).join(), SCULPT_BAR.join(), 'it brings back the removed tools, in the default order');
    t.eq(await stored(page), null, 'and nothing is stored');
    t.eq((await viewItem(page, 'Reset tool bar'))?.disabled, true, 'it is greyed out while the bar is the default');
    await page.click('[data-role="tool-bar-undo"]');
    await wait(page, 200);
    t.eq((await order(page)).join(), 'bz.crease,bz.move', 'and its Undo puts the shorter bar back');
  },

  async libraryNoBuild(page, base, t) {
    // Dragging from the window is the interface's business: the view builds, compiles and allocates nothing.
    const OFF = ['bz.crease', 'bz.move', 'bz.inflate', 'bz.pinch', 'bz.flatten', 'bz.drag', 'bz.polish'];
    await boot(page, base, stripKey({ v: 2, sculpt: { ids: OFF, known: SCULPT_BAR } }));
    await openLib(page);
    await wait(page, 1500);
    const counters = () => page.evaluate(() => window.__bozzetto.renderCounters());
    const grew = (a, b) => Object.fromEntries(Object.keys(a).filter((k) => b[k] !== a[k]).map((k) => [k, b[k] - a[k]]));
    const before = await counters();
    const mouse = await pointer(page, 'mouse');
    const from = await liftFrom(page, mouse, 'mouse', 'bz.clay');
    const to = await centre(page, 'bz.polish');
    for (const [x, y] of along(from, to, 10)) await mouse.move(x, y);
    for (const [x, y] of along(to, await centre(page, 'bz.crease'), 10)) await mouse.move(x, y);
    for (const [x, y] of along(await centre(page, 'bz.crease'), [300, 300], 6)) await mouse.move(x, y);
    await mouse.up();
    await wait(page, 500);
    // And a bar tile dragged off and back.
    const f2 = await liftBar(page, mouse, 'mouse', 'bz.move');
    for (const [x, y] of along(f2, [f2[0], f2[1] - 140], 6)) await mouse.move(x, y);
    for (const [x, y] of along([f2[0], f2[1] - 140], f2, 6)) await mouse.move(x, y);
    await mouse.up();
    await wait(page, 500);
    t.eq(JSON.stringify(grew(before, await counters())), '{}', 'no build, compile or allocation in the view while dragging from the window or off the bar');
  },

  // A bar holds ten tools, one for each key (owner, 2026-11-24). No workspace has ten tools to place yet, so
  // the limit is lowered here to make a bar full with the tools there are.
  async libraryFull(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const OFF = SCULPT_BAR.filter((id) => id !== 'bz.pinch');
    await boot(page, base, stripKey({ v: 2, sculpt: { ids: OFF, known: SCULPT_BAR } }));
    t.eq(await page.evaluate(() => window.__sculpt.tools.bars.limit), 10, 'a bar holds ten tools');
    t.eq(await page.evaluate(() => window.__sculpt.tools.bars.isFull('sculpt')), false, 'eight tools do not fill it');
    await page.evaluate(() => {
      window.__sculpt.tools.bars.limit = 8;
    });
    t.eq(await page.evaluate(() => window.__sculpt.tools.bars.isFull('sculpt')), true, 'with room for eight, eight fill it');
    await openLib(page);
    await page.keyboard.press('1');
    await wait(page, 100);
    // Lifting a ninth from the window: no ghost, the reason said, nothing changed and nothing taken in hand.
    const hand = await page.evaluate(() => document.querySelector('.sculpt-toolbar__btn--active')?.dataset.tool ?? null);
    const mouse = await pointer(page, 'mouse');
    const [px, py] = await tileC(page, 'bz.pinch');
    await mouse.down(px, py);
    await mouse.move(px + 8, py);
    await mouse.move(px + 30, py + 40);
    await wait(page, 300);
    t.eq(await ghosts(page), 0, 'a tool is not lifted towards a full bar');
    t.ok((await notes(page)).some((n) => n === 'The tool bar is full (8 tools). Take one off to add another.'), `and a notice says the bar is full (${(await notes(page)).join(' | ')})`);
    await mouse.up();
    await wait(page, 300);
    t.eq((await order(page)).join(), OFF.join(), 'the bar is as it was');
    t.eq(await page.evaluate(() => document.querySelector('.sculpt-toolbar__btn--active')?.dataset.tool ?? null), hand, 'and the press picked nothing');
    // A tool already on the bar still moves along it.
    const moved = await page.evaluate(() => {
      const b = window.__sculpt.tools.bars;
      const ids = [...b.order('sculpt')];
      b.set('sculpt', [ids[1], ids[0], ...ids.slice(2)]);
      return b.order('sculpt').slice(0, 2).join();
    });
    t.eq(moved, `${OFF[1]},${OFF[0]}`, 'a tool on a full bar can still change places');
    // The order itself never holds more than the limit, whatever asks.
    const capped = await page.evaluate((all) => {
      const b = window.__sculpt.tools.bars;
      b.set('sculpt', all);
      return { n: b.order('sculpt').length, clean: window.__sculpt.tools.sanitizeOrder('sculpt', all, all, 8).length, stored: window.__sculpt.tools.sanitizeOrder('sculpt', all, all).length };
    }, SCULPT_BAR);
    t.ok(capped.n === 8 && capped.clean === 8 && capped.stored === 9, `nine tools set on a bar of eight keep the first eight, and a stored order is held to the limit too (${JSON.stringify(capped)})`);
    t.ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },
  // The Models, Materials, Lighting and HDRIs tabs (docs/plans/asset-library.md): one list behind every picker.
  async libraryTabs(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await boot(page, base);
    await openLib(page);
    await wait(page, 600);

    // --- no build or allocation on opening or switching tabs ---
    const counters = () => page.evaluate(() => window.__bozzetto.renderCounters());
    const grew = (a, b) => Object.fromEntries(Object.keys(a).filter((k) => b[k] !== a[k]).map((k) => [k, b[k] - a[k]]));
    const before = await counters();
    for (const tab of ['Models', 'Materials', 'Lighting', 'HDRIs', 'Tools', 'Models']) await showTab(page, tab);
    await wait(page, 800);
    t.eq(JSON.stringify(grew(before, await counters())), '{}', 'no build, compile or allocation in the view on opening or switching tabs');

    // --- Models: the Create choices, same ids, labels, order and groups ---
    const create = await page.evaluate(() => {
      const m = document.querySelector('.outliner__menu--create');
      const out = [];
      for (const b of m.querySelectorAll('.outliner__tile')) {
        out.push({ id: b.dataset.kind ?? b.dataset.armature ?? b.dataset.id, label: b.querySelector('.outliner__tile-name').textContent });
      }
      return out;
    });
    const models = await tabTiles(page, 'models');
    t.ok(create.length > 20, `the Create menu lists its choices (${create.length})`);
    t.eq(JSON.stringify(models.map(({ id, label }) => ({ id, label }))), JSON.stringify(create), 'Models lists what Create lists: same ids, labels and order');
    t.eq(
      await page.evaluate(() => [...document.querySelectorAll('.lib-body[data-tab="models"] .lib-group__head')].map((h) => h.firstChild.textContent).join()),
      'Primitives,Armatures,Base meshes,Figures,Heads,Parts',
      'in the same groups',
    );
    t.ok(models.filter((m) => m.img).length === models.length, 'every tile has its picture, the primitives too');
    t.eq(JSON.stringify(await thumbsLoad(page, 'models')), '[]', 'every Models thumbnail loads');
    await page.screenshot({ path: `${SHOTS}/models.png` });

    // A tap does what Create does.
    const meshes = () => page.evaluate(() => window.__sculpt.session.getMeshes().length);
    const verts = () => page.evaluate(() => window.__sculpt.session.getMesh().getNbVertices());
    const n0 = await meshes();
    await tapAsset(page, 'models', 'cone');
    await wait(page, 500);
    t.eq(await meshes(), n0 + 1, 'a primitive tile adds the object');
    const viaWindow = await verts();
    await page.evaluate(() => document.querySelector('.outliner__tile[data-kind="cone"]').click());
    await wait(page, 500);
    t.eq(await verts(), viaWindow, 'the same object the Create choice adds');
    const n1 = await meshes();
    await tapAsset(page, 'models', 'head-generic');
    await page.waitForFunction((n) => window.__sculpt.session.getMeshes().length > n, n1, { timeout: 20000 });
    await wait(page, 300);
    const addedWin = (await meshes()) - n1;
    const n2 = await meshes();
    await page.evaluate(() => document.querySelector('.outliner__tile[data-id="head-generic"]').click());
    await page.waitForFunction((n) => window.__sculpt.session.getMeshes().length > n, n2, { timeout: 20000 });
    await wait(page, 300);
    t.eq((await meshes()) - n2, addedWin, `a base mesh tile adds what the Create tile adds (${addedWin} objects)`);

    // The search filters by name.
    await page.fill('.lib-search', 'head');
    t.ok((await tabTiles(page, 'models')).length > 0 && (await tabTiles(page, 'models')).every((m) => m.label.toLowerCase().includes('head')), 'the search filters Models by name');
    await page.fill('.lib-search', 'zzz');
    t.eq(await page.evaluate(() => document.querySelector('.lib-body[data-tab="models"] .lib-empty:not([hidden])')?.textContent ?? ''), 'Nothing called that.', 'and says so when nothing matches');
    await page.fill('.lib-search', '');
    await page.click('.lib-where:text-is("Scene")');
    const modelNames = await page.evaluate(() => [...document.querySelectorAll('.lib-body[data-tab="models"] .lib-tile:not([hidden])')].map((b) => b.querySelector('.lib-tile__name').textContent));
    const rowNames = await page.evaluate(() => [...document.querySelectorAll('.outliner__name')].map((n) => n.textContent));
    t.eq(modelNames.join('|'), rowNames.join('|'), `Scene on Models lists the scene's objects in the Scene panel's order, the armature too (${modelNames.join(', ')})`);
    const objTile = await page.evaluate(() => [...document.querySelectorAll('.lib-body[data-tab="models"] .lib-tile:not([hidden])')].map((b) => b.dataset.asset).filter((a) => a.startsWith('obj:')).pop());
    await tapAsset(page, 'models', objTile);
    await waitMark(page, 'models', objTile, 'use');
    t.eq(await page.evaluate(() => document.querySelector('.outliner__row--active .outliner__name')?.textContent ?? ''), await page.evaluate((id) => document.querySelector(`.lib-body[data-tab="models"] .lib-tile[data-asset="${id}"] .lib-tile__name`).textContent, objTile), 'a tap selects that object, as its row does, and the tile is marked');
    await page.click('.lib-where:text-is("Library")');

    // --- Materials: the matcaps, in step with the Material panel ---
    await showTab(page, 'Materials');
    await page.evaluate(() => {
      window.__sculpt.viewer.setMaterial('matcap');
      window.dispatchEvent(new Event('bozzetto:controls-refresh'));
    });
    await page.evaluate(() => document.querySelector('.panel--material > .panel__handle').click());
    await wait(page, 400);
    await page.evaluate(() => document.querySelector('.mcpick__trigger').click());
    await wait(page, 300);
    const panelCaps = await page.evaluate(() => [...document.querySelectorAll('.matcap-grid--pop .matcap-swatch')].map((b) => ({ id: /thumbs\/(\w+)\.png/.exec(b.querySelector('img').src)[1], label: b.title })));
    const caps = await tabTiles(page, 'materials');
    t.eq(caps.length, 10, 'Materials lists the ten matcaps');
    t.eq(JSON.stringify(caps.map(({ id, label }) => ({ id, label }))), JSON.stringify(panelCaps), "the same ids, labels and order as the Material panel's picker");
    t.eq(JSON.stringify(await thumbsLoad(page, 'materials')), '[]', 'every matcap tile shows its picture');
    t.eq(await page.evaluate(() => document.querySelector('.lib-body[data-tab="materials"] .lib-group__head').textContent), 'Matcaps', 'under the group Matcaps');
    t.eq(await page.evaluate(() => document.querySelector('.lib-body[data-tab="materials"] [data-role="library-tail"]').textContent), 'Lit shows the materials again (Material tab).', 'and the line about Lit');
    await page.evaluate(() => window.__sculpt.viewer.setMaterial('lit'));
    await tapAsset(page, 'materials', 'vr04');
    await wait(page, 300);
    const st = await page.evaluate(() => ({ mode: window.__sculpt.viewer.getMaterial(), i: window.__sculpt.viewer.materials.getMaterialState().matcapIndex, on: [...document.querySelectorAll('.matcap-swatch--on')].map((b) => b.title).join(), mode2: document.querySelector('.panel--material select')?.value }));
    t.ok(st.mode === 'matcap' && st.i === 3, `a matcap tile sets the view to Matcap with that one (${st.mode}, ${st.i})`);
    t.eq(st.on, 'VR04', "the Material panel's picker follows");
    t.eq(st.mode2, 'matcap', 'and its Mode');
    t.eq((await tabTiles(page, 'materials')).filter((c) => c.state === 'use').map((c) => c.id).join(), 'vr04', 'the tile in use is marked');
    // The Material panel's picker closed and the window moved aside, so both marks show.
    await page.evaluate(() => { const g = document.querySelector('.mcpick__pop'); if (g) g.hidden = true; });
    await page.mouse.move(700, 87);
    await page.mouse.down();
    await page.mouse.move(520, 90, { steps: 4 });
    await page.mouse.move(330, 90, { steps: 4 });
    await page.mouse.up();
    await wait(page, 800);
    await page.screenshot({ path: `${SHOTS}/materials-with-panel.png` });
    await page.evaluate(() => document.querySelector('.mcpick__trigger').click());
    await wait(page, 300);
    await page.evaluate(() => document.querySelectorAll('.matcap-grid--pop .matcap-swatch')[7].click());
    await page.waitForFunction(() => document.querySelector('.lib-body[data-tab="materials"] .lib-tile[data-asset="vr08"]')?.dataset.state === 'use', null, { timeout: 5000 });
    t.eq((await tabTiles(page, 'materials')).filter((c) => c.state === 'use').map((c) => c.id).join(), 'vr08', 'picking in the panel moves the mark in the window');
    await page.evaluate(() => window.__sculpt.viewer.setMaterial('lit'));
    await page.waitForFunction(() => !document.querySelector('.lib-body[data-tab="materials"] .lib-tile[data-state="use"]'), null, { timeout: 5000 });
    t.ok(true, 'Lit takes the mark away');
    // --- Materials: Scene lists the scene's materials; a tap assigns them to the active object ---
    await page.click('.lib-where:text-is("Scene")');
    const sceneList = await page.evaluate(() => [...document.querySelector('.outliner__material select').options].filter((o) => o.value !== '__new__' && o.value !== '__matcap__').map((o) => ({ id: o.value, name: o.textContent })));
    const shownList = await page.evaluate(() => [...document.querySelectorAll('.lib-body[data-tab="materials"] .lib-tile:not([hidden])')].map((b) => `${b.dataset.asset}:${b.querySelector('.lib-tile__name').textContent}`));
    t.eq(shownList.join(), sceneList.map((m) => `${m.id}:${m.name}`).join(), 'Scene lists the scene materials in the Scene panel select order');
    const target = sceneList[sceneList.length - 1].id;
    await page.evaluate(() => window.__sculpt.viewer.setMaterial('matcap'));
    await wait(page, 300);
    await tapAsset(page, 'materials', target);
    await wait(page, 300);
    const after = await page.evaluate(() => ({ mode: window.__sculpt.viewer.getMaterial(), sel: document.querySelector('.outliner__material select').value}));
    t.eq(after.sel, target, 'a tap assigns that material to the active object (the Scene panel select shows it)');
    t.eq(after.mode, 'lit', 'and puts the view back in Lit');
    t.eq(await page.evaluate((id) => document.querySelector(`.lib-body[data-tab="materials"] .lib-tile[data-asset="${id}"]`).dataset.state, target), 'use', 'the tile the object uses is marked');
    await page.click('.lib-where:text-is("Library")');
    await page.fill('.lib-search', 'vr0');
    t.eq((await tabTiles(page, 'materials')).length, 9, 'the search filters the matcaps (VR01 to VR09)');
    await page.fill('.lib-search', '');

    // --- Models: an armature tile, last (it goes to Armature) ---
    await showTab(page, 'Models');
    await tapAsset(page, 'models', 'placeholder-male');
    await page.waitForFunction(() => window.__sculpt.studio.now() === 'armature', null, { timeout: 60000 });
    t.ok(true, 'an armature tile sets the armature and goes to Armature, as the Create choice does');
    t.ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  // The Lighting and HDRIs tabs.
  async libraryLook(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const hdrs = [];
    page.on('request', (r) => {
      if (/\.hdr(\?|$)/.test(r.url())) hdrs.push(r.url().replace(/^.*\//, '').replace(/\?.*$/, ''));
    });
    await boot(page, base);
    await page.evaluate(() => window.__sculpt.present.enter());
    await page.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 5000 });
    await page.evaluate(() => document.querySelector('.panel--lighting > .panel__handle').click());
    await wait(page, 500);
    await page.evaluate(() => window.__sculpt.studio.library.open('lighting'));
    await page.waitForSelector('.lib-window:not([hidden])');
    await wait(page, 300);
    const ENV_SELECT = '.panel--lighting select:has(option[value="plaza"])';

    // --- Lighting: the Rig select's built-in rigs ---
    const select = (sel) => page.evaluate((s) => [...document.querySelector(s).options].map((o) => ({ value: o.value, label: o.textContent })), sel);
    const panelRigs = (await select('.panel--lighting select')).filter((o) => o.value.startsWith('built:')).map((o) => ({ id: o.value.slice(6), label: o.label }));
    const rigs = await tabTiles(page, 'lighting');
    t.eq(rigs.length, 10, 'Lighting lists the ten built-in rigs');
    t.eq(JSON.stringify(rigs.map(({ id, label }) => ({ id, label }))), JSON.stringify(panelRigs), "the same ids, labels and order as the Lighting tab's Rig select");
    t.eq(JSON.stringify(await thumbsLoad(page, 'lighting')), '[]', 'every rig tile shows its picture');
    await page.screenshot({ path: `${SHOTS}/lighting.png` });
    await tapAsset(page, 'lighting', 'rembrandt');
    await wait(page, 400);
    t.eq(await page.evaluate(() => window.__bozzetto.lighting.activePreset()), 'rembrandt', 'a rig tile applies the rig');
    t.eq(await page.evaluate(() => document.querySelector('.panel--lighting select').value), 'built:rembrandt', "and the Lighting tab's select follows");
    t.eq((await tabTiles(page, 'lighting')).filter((c) => c.state === 'use').map((c) => c.id).join(), 'rembrandt', 'the rig in use is marked');
    t.eq(await foot(page), '', 'in Present nothing is said about where it shows');
    await page.selectOption('.panel--lighting select', 'built:split');
    await page.waitForFunction(() => document.querySelector('.lib-body[data-tab="lighting"] .lib-tile[data-asset="split"]')?.dataset.state === 'use', null, { timeout: 5000 });
    t.ok(true, 'picking in the select moves the mark in the window');

    // --- Mine: a saved rig ---
    await page.click('.lib-where:text-is("Scene")');
    t.eq(await page.evaluate(() => document.querySelector('.lib-body[data-tab="lighting"] .lib-empty:not([hidden])')?.textContent ?? ''), 'Rigs you save in the Lighting tab show here.', 'Scene says where its rigs come from');
    await page.click('.lib-where:text-is("Library")');
    await page.selectOption('.panel--lighting select', 'built:rembrandt');
    await page.evaluate(() => window.__bozzetto.lighting.setAngles('key', 77, 33));
    page.once('dialog', (d) => d.accept('Mine one'));
    await page.evaluate(() => [...document.querySelectorAll('.panel--lighting button')].find((b) => b.textContent === 'Save rig…').click());
    await page.waitForFunction(() => [...document.querySelectorAll('.panel--lighting select optgroup')].some((g) => g.label === 'My rigs'), null, { timeout: 5000 });
    await page.click('.lib-where:text-is("Scene")');
    await wait(page, 700);
    t.eq((await tabTiles(page, 'lighting')).map((c) => c.label).join(), 'Mine one', 'a rig saved in the Lighting tab shows under Scene');
    t.eq((await tabTiles(page, 'lighting')).map((c) => c.state).join(), 'use', 'marked, as the lights are that rig');
    await page.screenshot({ path: `${SHOTS}/lighting-mine.png` });
    await page.selectOption('.panel--lighting select', 'built:top_light');
    await wait(page, 700);
    await page.evaluate(() => document.querySelector('.lib-body[data-tab="lighting"] [data-group="mine"] .lib-tile').click());
    await wait(page, 300);
    const key = await page.evaluate(() => window.__bozzetto.lighting.state().find((l) => l.id === 'key'));
    t.ok(key.azimuth === 77 && key.elevation === 33, `a Scene tile applies the saved rig (${key.azimuth}, ${key.elevation})`);
    t.eq(await page.evaluate(() => document.querySelector('.panel--lighting select').selectedOptions[0].textContent), 'Mine one', 'and the select reads it');
    await page.fill('.lib-search', 'zzz');
    t.eq(await page.evaluate(() => document.querySelector('.lib-body[data-tab="lighting"] .lib-empty:not([hidden])')?.textContent ?? ''), 'Nothing called that.', 'the search filters Scene too');
    await page.fill('.lib-search', '');
    await page.click('.lib-where:text-is("Library")');
    await page.fill('.lib-search', 'raking');
    t.eq((await tabTiles(page, 'lighting')).map((c) => c.id).join(), 'raking_key', 'the search filters the rigs by name');
    await page.fill('.lib-search', '');

    // --- HDRIs ---
    await showTab(page, 'HDRIs');
    const panelEnvs = await select(ENV_SELECT);
    const envs = await tabTiles(page, 'hdris');
    t.eq(JSON.stringify(envs.map(({ id, label }) => ({ id, label }))), JSON.stringify(panelEnvs.map((o) => ({ id: o.value, label: o.label }))), "HDRIs lists None and the six, as the Lighting tab's HDRI select does (same ids, labels, order)");
    t.eq(envs[0].label, 'None', 'None first');
    t.eq(JSON.stringify(await thumbsLoad(page, 'hdris')), '[]', 'every HDRI tile shows its picture');
    t.eq(hdrs.length, 0, `no .hdr file is fetched by looking (${hdrs.join()})`);
    t.eq(envs.find((e) => e.id === '').state, 'use', 'None is the one in use at first');
    await page.screenshot({ path: `${SHOTS}/hdris.png` });

    // A slow file: the tile reads loading, then in use; only that file is fetched.
    // Held in the page itself (a service worker answers a routed request): the file waits until the picture is taken.
    await page.evaluate(() => {
      const real = window.fetch.bind(window);
      window.__realFetch = window.fetch;
      const gate = new Promise((r) => (window.__release = r));
      window.fetch = (input, init) => (/studio-photo\.hdr/.test(String(input?.url ?? input)) ? gate.then(() => real(input, init)) : real(input, init));
    });
    await tapAsset(page, 'hdris', 'studio-photo');
    await waitMark(page, 'hdris', 'studio-photo', 'loading');
    t.ok(true, 'a tapped HDRI tile reads loading while its file comes');
    const rect = (id) => page.evaluate((i) => { const r = document.querySelector(`.lib-body[data-tab="hdris"] .lib-tile[data-asset="${i}"]`).getBoundingClientRect(); return [r.width, r.height]; }, id);
    const loadingBox = await rect('studio-photo');
    await page.screenshot({ path: `${SHOTS}/hdri-loading.png` });
    await page.evaluate(() => {
      window.__release();
      window.fetch = window.__realFetch;
    });
    await waitMark(page, 'hdris', 'studio-photo', 'use');
    t.eq(JSON.stringify(await rect('studio-photo')), JSON.stringify(loadingBox), 'with no change of size');
    t.eq(hdrs.join(), 'studio-photo.hdr', 'only the tapped file was fetched');
    t.eq(await page.evaluate(() => window.__bozzetto.environment.getState().id), 'studio-photo', "the scene's environment is set");
    await page.evaluate(() => window.dispatchEvent(new Event('bozzetto:controls-refresh')));
    t.eq(await page.evaluate((s) => document.querySelector(s).value, ENV_SELECT), 'studio-photo', "and the Lighting tab's select follows");
    await page.selectOption(ENV_SELECT, 'overcast');
    await page.waitForFunction(() => document.querySelector('.lib-body[data-tab="hdris"] .lib-tile[data-asset="overcast"]')?.dataset.state === 'use', null, { timeout: 15000 });
    t.ok(true, 'and the other way, the window follows the select');

    // A failed fetch leaves the environment as it was and says so.
    await page.evaluate(() => {
      const real = window.fetch.bind(window);
      window.__realFetch = window.fetch;
      window.fetch = (input, init) => (/garage\.hdr/.test(String(input?.url ?? input)) ? Promise.reject(new TypeError('offline')) : real(input, init));
    });
    await tapAsset(page, 'hdris', 'garage');
    await page.waitForFunction(() => /could not be loaded/.test(document.querySelector('.lib-foot')?.textContent ?? ''), null, { timeout: 15000 });
    t.eq(await foot(page), 'Garage could not be loaded. The environment is as it was.', 'a failed fetch says so in the foot');
    t.eq(await page.evaluate(() => window.__bozzetto.environment.getState().id), 'overcast', 'and leaves the environment as it was');
    await page.evaluate(() => (window.fetch = window.__realFetch));
    t.eq((await tabTiles(page, 'hdris')).filter((c) => c.state === 'use').map((c) => c.id).join(), 'overcast', 'with the mark where it was');
    await tapAsset(page, 'hdris', '');
    await wait(page, 500);
    t.eq(await page.evaluate(() => window.__bozzetto.environment.getState().id), null, 'None takes the environment off');
    // Scene holds the one environment in use: None (the state now) shows the line.
    await page.click('.lib-where:text-is("Scene")');
    await page.waitForFunction(() => document.querySelector('.lib-body[data-tab="hdris"] .lib-empty:not([hidden])')?.textContent === 'This scene has no environment light.', null, { timeout: 10000 });
    t.eq(await page.evaluate(() => document.querySelector('.lib-body[data-tab="hdris"] .lib-empty:not([hidden])')?.textContent ?? ''), 'This scene has no environment light.', 'Scene on HDRIs says so with None');
    await page.click('.lib-where:text-is("Library")');
    await tapAsset(page, 'hdris', 'overcast');
    await waitMark(page, 'hdris', 'overcast', 'use');
    await page.click('.lib-where:text-is("Scene")');
    await page.waitForFunction(() => document.querySelector('.lib-body[data-tab="hdris"] .lib-tile:not([hidden])')?.dataset.asset === 'overcast', null, { timeout: 10000 });
    t.eq((await tabTiles(page, 'hdris')).map((c) => c.id).join(), 'overcast', 'Scene on HDRIs holds the one environment in use');
    t.eq((await tabTiles(page, 'hdris'))[0]?.state, 'use', 'and marks it');
    await tapAsset(page, 'hdris', 'overcast');
    t.eq(await page.evaluate(() => window.__sculpt.viewer.environment.getState().id ?? ''), 'overcast', 'a tap on it does nothing');
    await page.click('.lib-where:text-is("Library")');
    await page.click('.lib-where:text-is("Library")');

    // --- Where it shows ---
    await page.evaluate(() => window.__sculpt.present.leave());
    await page.waitForFunction(() => !document.body.classList.contains('presenting'), null, { timeout: 5000 });
    await page.evaluate(() => window.__sculpt.studio.library.open('lighting'));
    await page.evaluate(() => window.__sculpt.viewer.setMaterial('lit'));
    await page.evaluate(() => (document.querySelector('.lib-foot').textContent = ''));
    await tapAsset(page, 'lighting', 'butterfly');
    await wait(page, 300);
    t.eq(await foot(page), '', 'a rig applied in Lit, where the lights show, says nothing');
    await page.evaluate(() => window.__sculpt.viewer.setMaterial('matcap'));
    await tapAsset(page, 'lighting', 'split');
    await wait(page, 300);
    t.eq(await foot(page), 'Shows in Present.', 'a rig applied under a matcap, where the lights are not seen, says Shows in Present.');
    await page.evaluate(() => (document.querySelector('.lib-foot').textContent = ''));
    await showTab(page, 'HDRIs');
    await tapAsset(page, 'hdris', 'plaza');
    await waitMark(page, 'hdris', 'plaza', 'use');
    t.eq(await foot(page), 'Shows in Present.', 'and so does an HDRI');
    await page.evaluate(() => window.__sculpt.viewer.setMaterial('lit'));
    await page.evaluate(() => (document.querySelector('.lib-foot').textContent = ''));
    await tapAsset(page, 'hdris', 'garage');
    await waitMark(page, 'hdris', 'garage', 'use');
    t.eq(await foot(page), '', 'an HDRI set in Lit says nothing');
    t.eq(await page.evaluate(() => !!window.__sculpt.viewer.scene.environment), true, 'and the working view has it as its light');
    t.ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  // A finger that drags on a tile of the picture tabs scrolls the window and uses nothing.
  async libraryScroll(page, base, t) {
    const { p, ctx, errors } = await touchPage(page, base);
    try {
      await openLib(p);
      await showTab(p, 'Models');
      const meshes = () => p.evaluate(() => window.__sculpt.session.getMeshes().length);
      const n0 = await meshes();
      const touch = await pointer(p, 'touch');
      const [x, y] = await p.evaluate(() => {
        const r = document.querySelector('.lib-body[data-tab="models"] .lib-tile[data-asset="cube"]').getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      });
      await touch.down(x, y);
      for (const [mx, my] of along([x, y], [x, y - 220], 8)) await touch.move(mx, my);
      await touch.up();
      await wait(p, 600);
      const top = await p.evaluate(() => document.querySelector('.lib-body[data-tab="models"]').scrollTop);
      t.ok(top > 60, `a finger drag on a tile scrolls the Models tab (${top}px)`);
      t.eq(await meshes(), n0, 'and adds nothing');
      const small = await p.evaluate(() => [...document.querySelectorAll('.lib-body[data-tab="models"] .lib-tile:not([hidden])')].filter((b) => { const r = b.getBoundingClientRect(); return r.width < 64 || r.height < 64; }).length);
      t.eq(small, 0, 'every tile is at least 64 px');
      await showTab(p, 'HDRIs');
      t.eq(await p.evaluate(() => getComputedStyle(document.querySelector('.lib-body[data-tab="hdris"] .lib-tile')).touchAction), 'pan-y', 'the HDRI tiles let a finger scroll too');
      t.ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    } finally {
      await ctx.close();
    }
  },
};

function OFFLIST() {
  return ['bz.crease', 'bz.move', 'bz.inflate', 'bz.pinch', 'bz.flatten', 'bz.drag', 'bz.polish'];
}
