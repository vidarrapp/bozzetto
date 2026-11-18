// The dock (step 2 of docs/plans/asset-library.md): the tool bar is arranged
// by hand. A long press on a tool lifts it (Pencil, finger; a mouse also by
// pressing and moving 4px), it moves along the bar with the others making
// room, and the keys 1 to 0 follow the order.
//
// dockLift: what lifts and what does not, by mouse, Pencil and finger; the
//   ghost, the gap, every digit showing; a tap still picks; the fixed tools;
//   nothing lifts mid-stroke.
// dockMove: place 2 to place 6 by mouse, Pencil and finger: the order, the
//   digits, the keys 1 to 9, the badges, tips, hotkey guide and Preferences.
// dockCancel: a drop off the bar, Esc, a cancelled pointer, the window losing
//   focus and a second pointer all put the tool back.
// dockKeep: kept on the device and per workspace, a stored order repaired,
//   with saving off it holds for the visit and says so once, Reset tool bar
//   and its Undo.
// dockNoBuild: no build or allocation in the view while dragging.
//
// Real input where it matters: the mouse through the page, the Pencil and the
// finger through the browser's own pen and touch events (CDP). Nothing here
// is a real Apple Pencil or a real iPad.
import { openForInput } from './smoke.mjs';

const SCULPT_BAR = ['bz.crease', 'bz.move', 'bz.clay', 'bz.inflate', 'bz.pinch', 'bz.flatten', 'bz.rake', 'bz.drag', 'bz.polish'];
const PAINT_BAR = ['bz.paint', 'bz.erase', 'bz.blur', 'bz.fill', 'bz.pick', 'bz.project'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
/** Place 2 (Move) put in place 6: the others make room. */
const MOVED = ['bz.crease', 'bz.clay', 'bz.inflate', 'bz.pinch', 'bz.flatten', 'bz.move', 'bz.rake', 'bz.drag', 'bz.polish'];
const STORE = 'bozzetto-toolbar';

const wait = (page, ms) => page.waitForTimeout(ms);

/** A pointer of one kind: down, move, up, cancel. `second` puts a second finger down. */
async function pointer(page, kind) {
  if (kind === 'mouse') {
    return {
      down: async (x, y) => {
        await page.mouse.move(x, y);
        await page.mouse.down();
      },
      move: (x, y) => page.mouse.move(x, y),
      up: () => page.mouse.up(),
      cancel: () => page.mouse.up(),
      second: async () => {},
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
      cancel: () => pen('mouseReleased', at[0], at[1], 0),
      second: async () => {},
    };
  }
  let at = [0, 0];
  const pt = (x, y, id = 1) => ({ x, y, id });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  return {
    down: async (x, y) => {
      at = [x, y];
      await touch('touchStart', [pt(x, y)]);
    },
    move: async (x, y) => {
      at = [x, y];
      await touch('touchMove', [pt(x, y)]);
    },
    up: () => touch('touchEnd', []),
    cancel: () => touch('touchCancel', []),
    second: () => touch('touchStart', [pt(at[0], at[1]), pt(at[0] + 200, at[1] - 200, 2)]),
  };
}

/** Points along a line, a few of them: software frames are slow, so moves come a frame at a time. */
const along = ([x0, y0], [x1, y1], n = 6) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * (i + 1)) / n, y0 + ((y1 - y0) * (i + 1)) / n]);

/** The centre of a tool's tile on screen. */
const centre = (page, id) =>
  page.evaluate((i) => {
    const r = document.querySelector(`.sculpt-toolbar__btn[data-tool="${i}"]:not([hidden])`).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, id);

/** The bar as it shows: tool, place, badge and tip key of the tiles on screen, in the order they stand. */
const bar = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.sculpt-toolbar__brushes .sculpt-toolbar__btn')]
      .filter((b) => !b.hidden)
      .map((b) => ({
        id: b.dataset.tool,
        place: b.dataset.place ?? '',
        badge: b.querySelector('.sculpt-toolbar__key')?.textContent ?? '',
        badgeShown: !!b.querySelector('.sculpt-toolbar__key') && getComputedStyle(b.querySelector('.sculpt-toolbar__key')).display !== 'none',
        tip: b.querySelector('.bz-tip__key')?.textContent ?? '',
        name: b.querySelector('.bz-tip__name')?.textContent ?? '',
      })),
  );

/** The tools of one bar, in the order the data holds them. */
const order = (page, ws = 'sculpt') => page.evaluate((w) => [...window.__sculpt.tools.bars.order(w)], ws);
/** The order the tiles stand in on screen (brushes only). */
const standing = async (page) => (await bar(page)).filter((b) => b.place).map((b) => b.id);
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), STORE);
const inHand = (page) => page.evaluate(() => [...document.querySelectorAll('.sculpt-toolbar__btn--active')].filter((b) => b.dataset.tool && !b.hidden).map((b) => b.dataset.tool).join());
const ghosts = (page) => page.evaluate(() => document.querySelectorAll('.dock-ghost').length);
const lifted = (page) => page.evaluate(() => window.__sculpt.tools.bars.lifted);

/** Boot Sculpt with the order stored (or not) first, and at the iPad's size. */
async function boot(page, base, store = null) {
  await page.setViewportSize({ width: 1180, height: 820 });
  await openForInput(page, base);
  await page.evaluate(
    ([k, v]) => {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    },
    [STORE, store],
  );
  await openForInput(page, base);
}

/** A context of its own with a touchscreen, for the finger; the caller closes it. */
async function touchPage(page, base, store = null) {
  const ctx = await page.context().browser().newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await boot(p, base, store);
  return { p, ctx, errors };
}

/** Lift a tool with a long press, or by the mouse's drag, and wait for the ghost. */
async function lift(page, ptr, kind, id, { hold = 750 } = {}) {
  const [x, y] = await centre(page, id);
  await ptr.down(x, y);
  if (kind === 'mouse') await ptr.move(x + 8, y);
  else await wait(page, hold);
  await page.waitForSelector('.dock-ghost', { state: 'attached', timeout: 5000 });
  return [x, y];
}

export const suites = {
  async dockLift(page, base, t) {
    await boot(page, base);
    const [x2, y2] = await centre(page, 'bz.move');

    // --- a tap still picks, by mouse and by Pencil ---
    await page.locator('.sculpt-toolbar__btn[data-tool="bz.rake"]:not([hidden])').click();
    t.eq(await inHand(page), 'bz.rake', 'a mouse click still picks a tool');
    const pen = await pointer(page, 'pen');
    await pen.down(x2, y2);
    await wait(page, 120);
    await pen.up();
    await wait(page, 150);
    t.eq(await inHand(page), 'bz.move', 'a short Pencil press picks it, as it always did');
    t.eq(await ghosts(page), 0, 'and lifted nothing');

    // --- a long press with the Pencil lifts; letting go without moving drops it back and picks nothing ---
    await page.locator('.sculpt-toolbar__btn[data-tool="bz.rake"]:not([hidden])').click();
    await page.evaluate(() => document.body.classList.add('bz-no-toolkeys'));
    const [cx, cy] = await centre(page, 'bz.clay');
    await pen.down(cx, cy);
    await wait(page, 450);
    t.eq(await ghosts(page), 0, 'a Pencil held for less than the long press has not lifted');
    await wait(page, 450);
    t.eq(await ghosts(page), 1, 'a Pencil held for the long press lifts the tool (the ghost)');
    t.ok(await lifted(page), 'and the bar says something is lifted');
    const during = await bar(page);
    t.ok(during.filter((b) => b.place).every((b) => b.badgeShown), 'every place shows its digit while a tool is lifted, with Hotkeys on tools off');
    t.eq(await page.evaluate(() => document.querySelector('.sculpt-toolbar__btn[data-tool="bz.clay"]').classList.contains('dock-gap')), true, "and the lifted tool's place is a gap");
    await wait(page, 250);
    const ghost = await page.evaluate(() => {
      const g = document.querySelector('.dock-ghost');
      const r = g.querySelector('.dock-ghost__tile').getBoundingClientRect();
      return { name: g.querySelector('.dock-ghost__name').textContent, w: Math.round(r.width), cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    t.eq(ghost.name, 'Standard clay', "the ghost carries the tool's name");
    t.ok(ghost.w >= 46 && Math.abs(ghost.cx - cx) < 3 && Math.abs(ghost.cy - cy) < 3, `a little larger than the tile, centred on the Pencil (${ghost.w}px at ${ghost.cx.toFixed(0)},${ghost.cy.toFixed(0)} for ${cx.toFixed(0)},${cy.toFixed(0)})`);
    await pen.up();
    await wait(page, 400);
    t.eq(await ghosts(page), 0, 'let go without moving, the ghost goes');
    t.eq((await order(page)).join(), SCULPT_BAR.join(), 'and the order is as it was');
    t.eq(await inHand(page), 'bz.rake', 'and the long press picked nothing (the tool in hand stays)');
    t.ok(!(await lifted(page)) && (await bar(page)).filter((b) => b.place).every((b) => !b.badgeShown), 'the digits are hidden again');
    await page.evaluate(() => document.body.classList.remove('bz-no-toolkeys'));

    // --- a slip: more than 8px before the long press is neither a tap nor a lift ---
    await pen.down(cx, cy);
    await pen.move(cx + 14, cy);
    await wait(page, 750);
    t.eq(await ghosts(page), 0, 'a Pencil that slides more than 8px before the long press does not lift');
    await pen.up();
    await wait(page, 200);
    t.eq(await inHand(page), 'bz.rake', 'and is not a tap either');

    // --- the mouse lifts by pressing and moving 4px, at once ---
    const mouse = await pointer(page, 'mouse');
    await mouse.down(cx, cy);
    await mouse.move(cx + 2, cy);
    t.eq(await ghosts(page), 0, 'a mouse that moves 2px has not lifted');
    await mouse.move(cx + 6, cy);
    await page.waitForSelector('.dock-ghost', { state: 'attached', timeout: 3000 });
    t.eq(await ghosts(page), 1, 'a mouse that moves 4px lifts at once');
    await mouse.up();
    await wait(page, 400);
    t.eq((await order(page)).join(), SCULPT_BAR.join(), 'dropped where it was, the order is as it was');
    t.eq(await inHand(page), 'bz.rake', 'and a drag is not a click');

    // --- the mouse also lifts by the long press ---
    await mouse.down(cx, cy);
    await wait(page, 750);
    t.eq(await ghosts(page), 1, 'a mouse held for the long press lifts too');
    await mouse.up();
    await wait(page, 400);

    // --- the fixed tools cannot be lifted ---
    for (const id of ['bz.select', 'bz.transform', 'bz.calipers']) {
      const [fx, fy] = await centre(page, id);
      await mouse.down(fx, fy);
      await mouse.move(fx + 4, fy);
      await mouse.move(fx + 20, fy);
      await wait(page, 100);
      t.eq(await ghosts(page), 0, `${id} cannot be lifted by a drag`);
      await mouse.up();
      await pen.down(fx, fy);
      await wait(page, 800);
      t.eq(await ghosts(page), 0, `nor by a long press`);
      await pen.up();
      await wait(page, 150);
      // Put the mode away again if the tap switched it on.
      if (id === 'bz.select' || id === 'bz.calipers' || id === 'bz.transform') {
        const on = await page.evaluate((i) => document.querySelector(`.sculpt-toolbar__btn[data-tool="${i}"]`).classList.contains('sculpt-toolbar__btn--active'), id);
        if (on) await page.locator(`.sculpt-toolbar__btn[data-tool="${id}"]`).click();
      }
    }
    t.eq((await order(page)).join(), SCULPT_BAR.join(), 'and the order never changed');

    // --- nothing lifts during a stroke ---
    await page.evaluate(() => {
      window.__sculpt.input.isStroking = () => true;
    });
    await mouse.down(cx, cy);
    await mouse.move(cx + 20, cy);
    await wait(page, 100);
    t.eq(await ghosts(page), 0, 'with a stroke under way, a mouse drag on a tile lifts nothing');
    await mouse.up();
    await pen.down(cx, cy);
    await wait(page, 800);
    t.eq(await ghosts(page), 0, 'and neither does a long press');
    await pen.up();
    await wait(page, 200);
  },

  async dockLiftTouch(page, base, t) {
    const { p, ctx, errors } = await touchPage(page, base);
    try {
      const finger = await pointer(p, 'touch');
      const [x, y] = await centre(p, 'bz.clay');
      await finger.down(x, y);
      await wait(p, 300);
      await finger.up();
      await wait(p, 200);
      t.eq(await inHand(p), 'bz.clay', 'a short touch picks a tool');
      t.eq(await ghosts(p), 0, 'and lifts nothing');
      const [rx, ry] = await centre(p, 'bz.rake');
      await finger.down(rx, ry);
      await wait(p, 450);
      t.eq(await ghosts(p), 0, 'a finger held for less than the long press has not lifted');
      await wait(p, 450);
      t.eq(await ghosts(p), 1, 'held for the long press, the tool lifts');
      const g = await p.evaluate(() => {
        const r = document.querySelector('.dock-ghost__tile').getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      });
      t.ok(Math.abs(g.cx - rx) < 3 && Math.abs(g.cy - (ry - 48)) < 3, `the ghost rides 48px above the finger (${g.cx.toFixed(0)},${g.cy.toFixed(0)} for a finger at ${rx.toFixed(0)},${ry.toFixed(0)})`);
      await finger.up();
      await wait(p, 400);
      t.eq(await inHand(p), 'bz.clay', 'let go without moving, nothing is picked');
      t.eq((await order(p)).join(), SCULPT_BAR.join(), 'and the order is as it was');

      await finger.down(rx, ry);
      await finger.move(rx + 14, ry);
      await wait(p, 750);
      t.eq(await ghosts(p), 0, 'a finger that slides more than 8px before the long press does not lift');
      await finger.up();
      await wait(p, 200);
      t.eq(await inHand(p), 'bz.clay', 'and is not a tap');

      // A stroke by the mouse (the model is under it) is under way: a finger's long press on a tile lifts nothing.
      const view = await p.evaluate(() => {
        const c = document.querySelector('canvas').getBoundingClientRect();
        return [c.left + c.width / 2, c.top + c.height / 2 - 60];
      });
      await p.mouse.move(view[0], view[1]);
      await p.mouse.down();
      for (const [mx, my] of along(view, [view[0] + 60, view[1]], 3)) await p.mouse.move(mx, my);
      const stroking = await p.evaluate(() => window.__sculpt.input.isStroking());
      await finger.down(rx, ry);
      await wait(p, 800);
      t.ok(stroking, 'a stroke is under way (the mouse on the model)');
      t.eq(await ghosts(p), 0, 'and a finger long press on a tile lifts nothing');
      await finger.up();
      await p.mouse.up();
    } finally {
      await ctx.close();
    }
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  async dockMove(page, base, t) {
    const check = async (p, kind) => {
      const ptr = await pointer(p, kind);
      const handBefore = await inHand(p);
      // Place 2 (Move) to place 6 (Flatten's place).
      const from = await lift(p, ptr, kind, 'bz.move');
      const to = await centre(p, 'bz.flatten');
      const way = along(from, to);
      for (const [x, y] of way.slice(0, 3)) await ptr.move(x, y);
      await wait(p, 250);
      // Midway: the others have made room, and their badges show the digits they will have.
      const mid = await bar(p);
      const digits = Object.fromEntries(mid.filter((b) => b.place).map((b) => [b.id, b.badge]));
      t.ok(mid.filter((b) => b.place).every((b) => b.badgeShown), `${kind}: every digit shows mid-move`);
      const shifted = await p.evaluate(() => ['bz.clay', 'bz.inflate', 'bz.pinch', 'bz.flatten', 'bz.rake'].map((id) => document.querySelector(`.sculpt-toolbar__btn[data-tool="${id}"]`).style.transform || 'none'));
      t.ok(/translate3d\(-/.test(shifted[0]), `${kind}: the tiles between slide aside by transform (${shifted.join(' | ')})`);
      for (const [x, y] of way.slice(3)) await ptr.move(x, y);
      await wait(p, 250);
      const near = await bar(p);
      const d2 = Object.fromEntries(near.filter((b) => b.place).map((b) => [b.id, b.badge]));
      t.eq(`${d2['bz.crease']}${d2['bz.clay']}${d2['bz.inflate']}${d2['bz.pinch']}${d2['bz.flatten']}${d2['bz.rake']}${d2['bz.drag']}${d2['bz.polish']}`, '12345789', `${kind}: at the end of the move the badges show the digits they will have (${JSON.stringify(digits)})`);
      t.eq((await order(p)).join(), SCULPT_BAR.join(), `${kind}: and nothing is changed until it is let go`);
      await ptr.up();
      await wait(p, 450);
      t.eq((await order(p)).join(), MOVED.join(), `${kind}: let go, the order has Move in place 6 and the others made room`);
      t.eq((await standing(p)).join(), MOVED.join(), `${kind}: and the tiles stand in that order`);
      t.eq(await ghosts(p), 0, `${kind}: the ghost is gone`);
      t.ok(await p.evaluate(() => [...document.querySelectorAll('.sculpt-toolbar__btn')].every((b) => !b.style.transform && !b.classList.contains('dock-gap'))), `${kind}: and no tile is left shifted or hidden`);
      const after = await bar(p);
      t.eq(after.filter((b) => b.place).map((b) => `${b.place}:${b.badge}:${b.tip}`).join(' '), MOVED.map((_, i) => `${i + 1}:${i + 1}:${i + 1}`).join(' '), `${kind}: badges, tips and places follow the order`);
      t.eq(await inHand(p), handBefore, `${kind}: the move picked nothing (the tool in hand stays in hand)`);
      t.eq(JSON.parse((await stored(p)) ?? 'null')?.sculpt?.join(), MOVED.join(), `${kind}: and the order is kept`);
      // The keys follow.
      for (let i = 0; i < MOVED.length; i++) {
        await p.keyboard.press(KEYS[i]);
        await wait(p, 60);
        const lit = await inHand(p);
        if (lit !== MOVED[i]) t.ok(false, `${kind}: key ${KEYS[i]} picked ${lit}, wanted ${MOVED[i]}`);
      }
      t.eq(await inHand(p), MOVED[8], `${kind}: the keys 1 to 9 pick the tools in their new places`);
      // The guide and Preferences read the order.
      const names = await p.evaluate((ids) => ids.map((id) => window.__sculpt.tools.registry.find((d) => d.id === id).name), MOVED);
      await p.keyboard.press('h');
      await wait(p, 200);
      const guide = await p.evaluate(() => document.querySelector('.help-guide')?.textContent ?? '');
      t.ok(names.every((n, i) => guide.includes(`Tool bar, place ${i + 1}: ${n}`)), `${kind}: the hotkey guide names the tool in each place (${[...guide.matchAll(/Tool bar, place \d+: [A-Za-z ]*?(?=Tool bar|[A-Z][a-z]+ctrl|$)/g)].map((m) => m[0]).slice(0, 3).join(' / ')}; wanted ${names.join(', ')})`);
      await p.keyboard.press('h');
      await p.keyboard.press('Control+Comma');
      await wait(p, 200);
      const rows = await p.evaluate(() => [...document.querySelectorAll('.prefs__row .prefs__label')].map((l) => l.textContent).filter((x) => /^Tool bar/.test(x)));
      t.ok(names.every((n, i) => rows[i] === `Tool bar, place ${i + 1}: ${n}`) && rows[9] === 'Tool bar, place 10: empty', `${kind}: and Preferences lists them in the new order (${rows[5]})`);
      await p.evaluate(() => [...document.querySelectorAll('.prefs button')].find((b) => b.textContent === 'Close')?.click());
      await wait(p, 100);
    };
    await boot(page, base);
    await check(page, 'mouse');
    await boot(page, base);
    await check(page, 'pen');
    const { p, ctx, errors } = await touchPage(page, base);
    try {
      await check(p, 'touch');
    } finally {
      await ctx.close();
    }
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  async dockCancel(page, base, t) {
    const same = async (p, what) => {
      await wait(p, 450);
      t.eq((await order(p)).join(), SCULPT_BAR.join(), `${what}: the order is as it was`);
      t.eq(await ghosts(p), 0, `${what}: the ghost is gone`);
      t.ok(!(await lifted(p)), `${what}: nothing is lifted`);
      t.eq(await stored(p), null, `${what}: nothing was stored`);
      t.ok(await p.evaluate(() => [...document.querySelectorAll('.sculpt-toolbar__btn')].every((b) => !b.style.transform && !b.classList.contains('dock-gap'))), `${what}: no tile is left shifted or hidden`);
      const badges = (await bar(p)).filter((b) => b.place).map((b) => b.badge).join('');
      t.eq(badges, '123456789', `${what}: the badges are the real ones`);
    };
    const overBar = async (p, ptr, kind) => {
      const from = await lift(p, ptr, kind, 'bz.move');
      const to = await centre(p, 'bz.flatten');
      for (const [x, y] of along(from, to, 4)) await ptr.move(x, y);
      await wait(p, 200);
    };

    await boot(page, base);
    const mouse = await pointer(page, 'mouse');

    // Let go anywhere else.
    await overBar(page, mouse, 'mouse');
    for (const [x, y] of along(await centre(page, 'bz.flatten'), [600, 260], 4)) await mouse.move(x, y);
    await wait(page, 200);
    const off = await page.evaluate(() => ['bz.clay', 'bz.inflate'].map((id) => document.querySelector(`.sculpt-toolbar__btn[data-tool="${id}"]`).style.transform));
    t.ok(off.every((s) => !s || /translate3d\(0px/.test(s) || s === ''), `off the bar the others close up again (${off.join(' | ')})`);
    await mouse.up();
    await same(page, 'let go off the bar');

    // Esc.
    await overBar(page, mouse, 'mouse');
    await page.keyboard.press('Escape');
    await wait(page, 100);
    t.ok(!(await lifted(page)), 'Esc ends the lift at once');
    await mouse.up();
    await same(page, 'Esc');

    // The window losing focus.
    await overBar(page, mouse, 'mouse');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await mouse.up();
    await same(page, 'the window losing focus');

    // The digits do not pick while a tool is lifted.
    const hand = await inHand(page);
    await overBar(page, mouse, 'mouse');
    await page.keyboard.press('5');
    await wait(page, 100);
    t.eq(await inHand(page), hand, 'the number keys wait while a tool is lifted');
    await mouse.up();
    await wait(page, 450);

    // The Pencil: cancelled by the pointer being let go off the bar, and by Esc.
    await boot(page, base);
    const pen = await pointer(page, 'pen');
    await overBar(page, pen, 'pen');
    await page.keyboard.press('Escape');
    await pen.up();
    await same(page, 'the Pencil and Esc');

    // The finger: a cancelled touch, and a second finger.
    const { p, ctx, errors } = await touchPage(page, base);
    try {
      const finger = await pointer(p, 'touch');
      await overBar(p, finger, 'touch');
      await finger.cancel();
      await same(p, 'a cancelled touch');
      await overBar(p, finger, 'touch');
      await finger.second();
      await wait(p, 100);
      t.ok(!(await lifted(p)), 'a second finger ends the lift at once');
      await finger.up();
      await same(p, 'a second finger');
    } finally {
      await ctx.close();
    }
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  async dockKeep(page, base, t) {
    await boot(page, base);
    const mouse = await pointer(page, 'mouse');
    const move = async (id, toId) => {
      const from = await lift(page, mouse, 'mouse', id);
      const to = await centre(page, toId);
      for (const [x, y] of along(from, to)) await mouse.move(x, y);
      await mouse.up();
      await wait(page, 450);
    };
    const defaults = await stored(page);
    t.eq(defaults, null, 'with the default order nothing is stored');
    await move('bz.move', 'bz.flatten');
    const rec = JSON.parse(await stored(page));
    t.ok(rec.v === 1 && rec.sculpt.join() === MOVED.join() && !('paint' in rec), `the order is stored for Sculpt only (${JSON.stringify(rec)})`);

    // Survives a reload.
    await openForInput(page, base);
    t.eq((await standing(page)).join(), MOVED.join(), 'the order survives a reload');
    await page.keyboard.press('6');
    t.eq(await inHand(page), 'bz.move', 'and so do the keys');

    // Paint has its own bar and its own order.
    await page.keyboard.press('Shift+3');
    await wait(page, 600);
    t.eq((await standing(page)).join(), PAINT_BAR.join(), "Paint's bar is its own, still in the default order");
    t.eq((await order(page, 'paint')).join(), PAINT_BAR.join(), 'in the data too');
    await move('bz.paint', 'bz.pick');
    const paintOrder = ['bz.erase', 'bz.blur', 'bz.fill', 'bz.pick', 'bz.paint', 'bz.project'];
    t.eq((await order(page, 'paint')).join(), paintOrder.join(), "moving Paint's tool changes Paint's bar");
    t.eq((await order(page, 'sculpt')).join(), MOVED.join(), "and not Sculpt's");
    const both = JSON.parse(await stored(page));
    t.ok(both.sculpt.join() === MOVED.join() && both.paint.join() === paintOrder.join(), 'both are stored');
    await page.keyboard.press('1');
    t.eq(await inHand(page), 'bz.erase', "in Paint the key 1 picks what is first on Paint's bar");
    await page.keyboard.press('Shift+2');
    await wait(page, 600);

    // Reset tool bar, and its Undo.
    const menuItem = async (label) => {
      await page.evaluate(() => [...document.querySelectorAll('.bz-strip__menus .bz-menuname')].find((b) => b.textContent === 'View')?.click());
      await page.waitForSelector('.bz-menuname.is-open');
      const state = await page.evaluate((l) => {
        const b = [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].find((x) => (x.querySelector('.file-menu__label')?.textContent ?? x.textContent.trim()) === l);
        return b ? { disabled: b.disabled } : null;
      }, label);
      return state;
    };
    const press = async (label) => {
      await page.evaluate((l) => {
        const b = [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].find((x) => (x.querySelector('.file-menu__label')?.textContent ?? x.textContent.trim()) === l);
        b.click();
      }, label);
      await wait(page, 200);
    };
    let item = await menuItem('Reset tool bar');
    t.ok(item && !item.disabled, 'View has Reset tool bar, available while the bar is not the default');
    await press('Reset tool bar');
    t.eq((await order(page)).join(), SCULPT_BAR.join(), 'Reset tool bar puts the default order back');
    t.eq((await order(page, 'paint')).join(), paintOrder.join(), "and leaves Paint's bar alone");
    const note = await page.evaluate(() => ({ text: document.querySelector('[data-role="tool-bar-note"]')?.textContent ?? '', undo: !!document.querySelector('[data-role="tool-bar-undo"]') }));
    t.ok(/default order/.test(note.text) && note.undo, `with a notice that has Undo (${note.text})`);
    t.eq(JSON.parse(await stored(page)).sculpt, undefined, 'a default order is no longer stored for Sculpt');
    item = await menuItem('Reset tool bar');
    t.ok(item?.disabled, 'Reset tool bar is greyed out while the bar is the default');
    await page.keyboard.press('Escape');
    await page.click('[data-role="tool-bar-undo"]');
    await wait(page, 200);
    t.eq((await order(page)).join(), MOVED.join(), 'Undo puts the order back');
    t.eq(JSON.parse(await stored(page)).sculpt.join(), MOVED.join(), 'and keeps it');
    t.eq(await page.evaluate(() => document.querySelectorAll('[data-role="tool-bar-note"]').length), 0, 'the notice goes with it');

    // Paint's own Reset, from Paint.
    await page.keyboard.press('Shift+3');
    await wait(page, 600);
    item = await menuItem('Reset tool bar');
    t.ok(item && !item.disabled, "in Paint, Reset tool bar is available while Paint's bar is not the default");
    await press('Reset tool bar');
    t.eq((await order(page, 'paint')).join(), PAINT_BAR.join(), "and puts Paint's default back");
    t.eq((await order(page, 'sculpt')).join(), MOVED.join(), "and leaves Sculpt's");
    t.eq(JSON.parse(await stored(page)).paint, undefined, "Paint's order is no longer stored");

    // A stored order is repaired: unknown ids and repeats dropped, missing tools appended in the default order.
    const bad = JSON.stringify({ v: 1, sculpt: ['bz.clay', 'bz.nope', 'bz.clay', 7, 'bz.move', 'bz.paint', null, 'bz.crease'], paint: 'junk' });
    await boot(page, base, bad);
    t.eq((await order(page)).join(), ['bz.clay', 'bz.move', 'bz.crease', 'bz.inflate', 'bz.pinch', 'bz.flatten', 'bz.rake', 'bz.drag', 'bz.polish'].join(), 'a stored order with an unknown id, a repeat and a tool of the other bar is repaired, the missing tools put last in the default order');
    t.eq((await order(page, 'paint')).join(), PAINT_BAR.join(), "and a record that is not a list leaves Paint's bar as it was");
    t.eq((await standing(page)).join(), (await order(page)).join(), 'the tiles stand as repaired');
    await boot(page, base, 'not json {');
    t.eq((await order(page)).join(), SCULPT_BAR.join(), 'a record that is not JSON leaves the default');
    await boot(page, base, JSON.stringify({ v: 1, sculpt: [...SCULPT_BAR] }));
    t.eq((await order(page)).join(), SCULPT_BAR.join(), 'a stored default is read as the default');
    await openForInput(page, base);
    t.eq(await stored(page), JSON.stringify({ v: 1, sculpt: SCULPT_BAR }), 'and is only written again when the order changes');
  },

  async dockSavingOff(page, base, t) {
    // Saving on this device is off: the order holds for the visit, and one notice says it will not be kept.
    const ctx = await page.context().browser().newContext({ viewport: { width: 1180, height: 820 }, askAboutDevice: true, serviceWorkers: 'block' });
    await ctx.addInitScript(() => sessionStorage.setItem('bozzetto-device-declined', '1'));
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    try {
      await openForInput(p, base);
      const mouse = await pointer(p, 'mouse');
      const move = async (id, toId) => {
        const from = await lift(p, mouse, 'mouse', id);
        const to = await centre(p, toId);
        for (const [x, y] of along(from, to)) await mouse.move(x, y);
        await mouse.up();
        await wait(p, 450);
      };
      const notes = () => p.evaluate(() => [...document.querySelectorAll('[data-role="tool-bar-note"]')].map((n) => n.textContent));
      t.eq((await notes()).length, 0, 'no notice before anything is changed');
      await move('bz.move', 'bz.flatten');
      t.eq((await order(p)).join(), MOVED.join(), 'with saving off the order still changes for the visit');
      let n = await notes();
      t.ok(n.length === 1 && /Saving on this device is off/.test(n[0]) && /default/.test(n[0]), `and one notice says it will not be kept (${n.join(' | ')})`);
      await p.evaluate(() => document.querySelectorAll('[data-role="tool-bar-note"]').forEach((e) => e.remove()));
      await move('bz.inflate', 'bz.crease');
      t.eq((await notes()).length, 0, 'the notice is not said again in the same visit');
      t.eq(await p.evaluate((k) => localStorage.getItem(k), STORE), null, 'and nothing is written to the device');
      await p.keyboard.press('1');
      t.eq(await inHand(p), 'bz.inflate', 'the keys follow the new order');
    } finally {
      await ctx.close();
    }
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  async dockNoBuild(page, base, t) {
    // Dragging a tool along the bar is the interface's business: the view builds, compiles and allocates nothing.
    await boot(page, base);
    await wait(page, 1500);
    const counters = () => page.evaluate(() => window.__bozzetto.renderCounters());
    const grew = (a, b) => Object.fromEntries(Object.keys(a).filter((k) => b[k] !== a[k]).map((k) => [k, b[k] - a[k]]));
    const before = await counters();
    const mouse = await pointer(page, 'mouse');
    const from = await lift(page, mouse, 'mouse', 'bz.move');
    const to = await centre(page, 'bz.polish');
    for (const [x, y] of along(from, to, 10)) await mouse.move(x, y);
    for (const [x, y] of along(to, from, 10)) await mouse.move(x, y);
    await mouse.up();
    await wait(page, 500);
    t.eq(JSON.stringify(grew(before, await counters())), '{}', 'no build, compile or allocation in the view from the lift to the drop');
  },
};
