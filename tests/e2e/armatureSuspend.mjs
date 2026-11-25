// Suspending Armature mode (docs/plans/armature-workspace.md, step B): the
// preparation for Armature as a workspace of the Sculpt page. Nothing a person
// sees changes; this is about what Armature does when it is told to stand aside.
//
// armatureSuspend:
// - suspended, nothing of Armature's is on screen (handles, plant rings,
//   gizmos, the highlight, panels, the strip, the edge buttons, the details),
//   a press and a drag on the view move no joint and select nothing, a panel
//   event opens none of its panels, a picture dropped on the window is not
//   taken, and each of its keys does nothing and is not claimed;
// - suspend({ figure: 'show' }) leaves the mannequin drawn, 'hide' takes it out;
// - the viewer is as it was before Armature took it over, and back as
//   Armature has it on resume;
// - resumed: the pose, the selection, the gizmo mode, the open panels and the
//   undo history are as they were, a drag moves a joint again, Undo works, and
//   nothing was fetched in between;
// - twenty suspends and resumes leave as many listeners, timers, scene
//   children and page elements as one;
// - mount, dispose, mount on one page works.
// Armature is a workspace of the Sculpt page now (step C): the shell is the page's, so what Armature
// owns on the page is its own tab and scene things; the viewer "as it was" is Sculpt's working view,
// and what Armature asks of it on top is the fixed floor, the ground shown and the pose probe.
import { mkdirSync, writeFileSync } from 'node:fs';
import { openArmature } from './lib.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/armature-suspend';

/** Count what the page has listening and running, from now on (installed once per page). */
const installLedgers = (page) =>
  page.evaluate(() => {
    if (window.__ledger) return;
    const live = new Map(); // target -> Map(type|capture -> Set(fn))
    let adds = 0;
    const key = (type, opts) => `${type}|${typeof opts === 'boolean' ? opts : !!opts?.capture}`;
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      adds++;
      if (fn) {
        if (!live.has(this)) live.set(this, new Map());
        const m = live.get(this);
        const k = key(type, opts);
        if (!m.has(k)) m.set(k, new Set());
        m.get(k).add(fn);
      }
      return add.call(this, type, fn, opts);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, opts) {
      live.get(this)?.get(key(type, opts))?.delete(fn);
      return remove.call(this, type, fn, opts);
    };
    const intervals = new Set();
    const setI = window.setInterval;
    const clearI = window.clearInterval;
    window.setInterval = (...a) => {
      const id = setI(...a);
      intervals.add(id);
      return id;
    };
    window.clearInterval = (id) => {
      intervals.delete(id);
      return clearI(id);
    };
    window.__ledger = {
      listeners: () => {
        let n = 0;
        for (const m of live.values()) for (const set of m.values()) n += set.size;
        return n;
      },
      adds: () => adds,
      intervals: () => intervals.size,
    };
  });

/** Everything about the viewer that Armature sets, read back (the same fields before and after). */
const viewerState = (page) =>
  page.evaluate(() => {
    const v = window.__bozzetto;
    const light = (id) => v.lighting.state().find((l) => l.id === id)?.castShadow;
    const box = v.subjectBox;
    return {
      tapToFocus: v.tapToFocus,
      fastFrames: v.fastFrames,
      probe: v.interactionProbe ? 'set' : null,
      keyOnlyShadows: v.lighting.keyOnlyShadows,
      lockedFloor: v.lockedFloor(),
      ground: v.getGround(),
      floorOffset: v.getFloorOffset(),
      sculptVisible: v.display.visible,
      antialias: v.getAntialias(),
      fillCasts: light('fill'),
      rimCasts: light('rim'),
    };
  });

/** What is on the page that is Armature's, and whether each is showing. */
const onPage = (page) =>
  page.evaluate(() => {
    const shown = (sel) =>
      [...document.querySelectorAll(sel)].some((el) => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0);
    const visibleDeep = (o) => {
      for (let p = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    };
    const scene = window.__bozzetto.scene;
    const helpers = scene.children.filter((c) => c.isTransformControlsRoot);
    const wash = [];
    scene.traverse((o) => {
      if (o.isMesh && o.parent?.isBone && o.material?.opacity === 0.32 && o.material?.transparent) wash.push(o);
    });
    const figure = window.__armature.armature.mesh;
    return {
      panels: {
        armature: shown('.panel--armature'),
        material: shown('.panel--material'),
        reference: shown('.panel--reference'),
      },
      strip: shown('.bz-strip'),
      menus: shown('.bz-menuname'),
      edge: shown('.bz-edge'),
      history: shown('.sculpt-hist'),
      details: shown('.bz-details'),
      handles: visibleDeep(scene.getObjectByName('ik-handles')),
      plants: visibleDeep(scene.getObjectByName('plant-marks')),
      gizmos: helpers.some(visibleDeep),
      highlight: wash.some(visibleDeep),
      figure: visibleDeep(figure),
    };
  });

const sceneCount = (page) => page.evaluate(() => window.__bozzetto.scene.children.length);
const pageCount = (page) => page.evaluate(() => document.getElementsByTagName('*').length);
const poseOf = (page) => page.evaluate(() => JSON.stringify(window.__armature.state()));
const panelsOpen = (page) =>
  page.evaluate(() =>
    ['armature', 'material', 'reference'].map((id) => {
      const el = document.querySelector(`.panel--${id}`);
      return !!el && !el.classList.contains('panel--collapsed');
    }),
  );

/**
 * A key on the page; what a listener of the test's own on the window (bubble phase) saw of it. Armature's key
 * handler claims a key it owns on the way down (prevented and stopped), so a claimed key is one the listener
 * never saw, or saw prevented; an unclaimed one reaches it un-prevented.
 */
const claimed = (seen) => seen.length === 0 || seen.some(Boolean);
const pressSeen = async (page, key, opts = {}) => {
  await page.evaluate(() => {
    window.__seen = [];
    window.__seenOn ??= (() => {
      window.addEventListener('keydown', (e) => window.__seen.push(e.defaultPrevented));
      return true;
    })();
  });
  const mods = [];
  if (opts.shift) mods.push('Shift');
  if (opts.ctrl) mods.push('Control');
  for (const m of mods) await page.keyboard.down(m);
  await page.keyboard.press(key);
  for (const m of mods.reverse()) await page.keyboard.up(m);
  return page.evaluate(() => window.__seen.slice());
};

/** A press and a drag at a page point. */
const drag = async (page, from, to) => {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(to[0], to[1], { steps: 4 });
  await page.mouse.up();
};

async function armatureSuspend(page, base, t) {
  mkdirSync(SHOTS, { recursive: true });
  await page.setViewportSize({ width: 1180, height: 820 });
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await openArmature(page, base, '&start=sphere');
  await page.waitForTimeout(600);
  await installLedgers(page);

  // The viewer as it was before Armature took it over: dispose it, read it, mount it again.
  await page.evaluate(() => window.__armature.dispose());
  t.ok(await page.evaluate(() => !window.__armature && !document.querySelector('.panel--armature')), "disposed, Armature leaves nothing of its own on the page (the shell is the page's)");
  const before = await viewerState(page);
  const sceneBefore = await sceneCount(page);
  const pageBefore = await pageCount(page);
  t.ok(before.ground === 'off' && before.lockedFloor === 0 && before.probe === 'set' && before.keyOnlyShadows === false && before.sculptVisible === true, `the viewer is Sculpt's again after dispose (${JSON.stringify(before)})`);
  await page.evaluate(() => window.__armatureMount(window.__bozzetto, window.__sculpt.armatureHost));
  await page.waitForFunction(() => !!window.__armature, null, { timeout: 60_000 });
  await page.waitForTimeout(600);
  t.ok((await sceneCount(page)) > sceneBefore, 'mounted again on the same page: its handles and gizmos are in the scene');
  t.eq(await page.evaluate(() => document.querySelectorAll('.panel--armature, .bz-strip, .bz-details').length), 3, "and one of each Armature tab, strip and details, not two");
  const mounted = await viewerState(page);
  const changed = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(mounted[k]));
  t.ok(mounted.ground === 'floor' && mounted.lockedFloor === 0 && mounted.probe === 'set' && changed.join() === 'ground', `mounted, Armature asks the viewer for the floor and nothing else changes (${JSON.stringify(mounted)}; changed: ${changed.join()})`);
  // The second mount draws and works: a joint turned and undone.
  await page.evaluate(() => {
    window.__armature.turn('upperarm.L', 0, 0, 30);
  });
  t.eq(await page.evaluate(() => window.__armature.history().undo), 1, 'the second mount takes steps in its own history');
  await page.evaluate(() => window.__armature.undo());
  await page.waitForTimeout(100);

  // A pose with a selection, a gizmo mode, panels open and a step to undo.
  const a = await page.evaluate(() => {
    const m = window.__armature;
    m.reach('hand.L', -30, 90, 30);
    m.select('upperarm.R');
    // A handle with nothing over it (the panels stand at the sides, the figure in the middle).
    const free = ['ik:hand.L', 'ik:hand.R', 'ik:foot.L', 'ik:foot.R'].find((n) => {
      const at = m.ballOnScreen(n);
      return at && document.elementFromPoint(at[0], at[1])?.tagName === 'CANVAS';
    });
    return { free, ring: m.ballOnScreen(free), onScreen: m.onScreen(...m.handlePosition('root')) };
  });
  t.ok(a.free && a.ring, `a handle to press: ${a.free}`);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id: 'armature', open: true } }));
    window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id: 'material', open: true } }));
  });
  await page.keyboard.press('e');
  // Running, the same keys are Armature's: X is claimed (the test's own listener sees it prevented), and twice is a wash.
  t.ok(claimed(await pressSeen(page, 'x')), 'running, X is claimed (the test\'s own listener does not see it, or sees it prevented)');
  await page.keyboard.press('x');
  await page.waitForTimeout(300);
  const pose = await poseOf(page);
  const gizmo = await page.evaluate(() => JSON.stringify(window.__armature.gizmo()));
  const history = await page.evaluate(() => JSON.stringify(window.__armature.history()));
  const selected = await page.evaluate(() => window.__armature.selected());
  const open = await panelsOpen(page);
  t.ok(selected === 'upperarm.R' && open[0] && open[1] && JSON.parse(history).undo >= 1, `a pose to come back to: ${selected} selected, panels ${open}, ${history}`);
  const showing = await onPage(page);
  t.ok(showing.panels.armature && showing.panels.material && showing.strip && showing.menus && showing.edge && showing.history && showing.details && showing.handles && showing.plants && showing.gizmos && showing.highlight && showing.figure, `running, all of it is on screen (${JSON.stringify(showing)})`);
  const poseNow = pose;
  await page.screenshot({ path: `${SHOTS}/1-running.png` });

  // ---- suspended, figure hidden ----------------------------------------------------------
  const net = requests.length;
  const listeners = await page.evaluate(() => window.__ledger.listeners());
  const intervals = await page.evaluate(() => window.__ledger.intervals());
  await page.evaluate(() => window.__armature.suspend());
  t.ok(await page.evaluate(() => window.__armature.isSuspended()), 'suspend() says it is suspended');
  await page.waitForTimeout(300);
  const gone = await onPage(page);
  t.ok(Object.values(gone.panels).every((v) => !v) && !gone.strip && !gone.menus && !gone.edge && !gone.history && !gone.details, `suspended, no panel, strip, menu, edge button or details is on screen (${JSON.stringify(gone)})`);
  t.ok(!gone.handles && !gone.plants && !gone.gizmos && !gone.highlight, `no handle, plant ring, gizmo or highlight is drawn (${JSON.stringify(gone)})`);
  t.ok(!gone.figure, 'with the default the mannequin is hidden too');
  t.ok((await page.evaluate(() => window.__ledger.listeners())) < listeners, `its listeners are off (${listeners} before, ${await page.evaluate(() => window.__ledger.listeners())} now)`);
  t.ok((await page.evaluate(() => window.__ledger.intervals())) <= intervals, 'and no timer of its runs (the shell, built with the page, is asleep and clears its own)');
  await page.screenshot({ path: `${SHOTS}/2-suspended-hidden.png` });

  // The viewer is back as it was before Armature.
  t.eq(JSON.stringify(await viewerState(page)), JSON.stringify(before), "the viewer is as it was before Armature (floor, ground, shadows, tap to focus, fast frames, probe, subject, visibility): Sculpt's");

  // ---- figure shown ---------------------------------------------------------------------
  await page.evaluate(() => window.__armature.suspend({ figure: 'show' }));
  await page.waitForTimeout(250);
  const shownFigure = await onPage(page);
  t.ok(shownFigure.figure && !shownFigure.handles && !shownFigure.gizmos && !shownFigure.panels.armature, 'with figure show the mannequin is drawn and nothing else of Armature');
  await page.screenshot({ path: `${SHOTS}/3-suspended-figure-shown.png` });
  const shotShown = await page.screenshot({ clip: { x: 300, y: 100, width: 600, height: 650 } });
  await page.evaluate(() => window.__armature.suspend({ figure: 'hide' }));
  await page.waitForTimeout(250);
  const shotHidden = await page.screenshot({ clip: { x: 300, y: 100, width: 600, height: 650 } });
  t.ok(!shotShown.equals(shotHidden), 'and the picture of the view differs from the one with it hidden');
  t.ok(!(await onPage(page)).figure, 'suspend again with hide takes the figure out');

  // A press and a drag on the view, on the hand's ring and on the figure, move and select nothing.
  const sel0 = await page.evaluate(() => [window.__armature.selected(), window.__armature.selectedHandle(), window.__armature.picked()]);
  await drag(page, [a.ring[0], a.ring[1]], [a.ring[0] + 60, a.ring[1] + 40]);
  await page.mouse.click(a.onScreen[0], a.onScreen[1]);
  await page.waitForTimeout(150);
  t.eq(await poseOf(page), poseNow, 'a drag from where the hand ring was moves no joint');
  t.eq(JSON.stringify(await page.evaluate(() => [window.__armature.selected(), window.__armature.selectedHandle(), window.__armature.picked()])), JSON.stringify(sel0), 'and a tap on the figure selects nothing');
  // A panel event opens none of its panels, and none announces itself to the others.
  await page.evaluate(() => {
    window.__announced = 0;
    window.addEventListener('bozzetto:panel-open', () => window.__announced++);
    window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id: 'reference', open: true } }));
    window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id: 'material', open: false } }));
    window.dispatchEvent(new CustomEvent('bozzetto:panel-open', { detail: { id: 'sculpt', side: 'right' } }));
  });
  // (The test's own panel-open above is one; any other is Armature's.)
  t.eq(await page.evaluate(() => window.__announced), 1, 'no panel of Armature answers or announces itself');
  t.eq(JSON.stringify(await panelsOpen(page)), JSON.stringify(open), 'its panels keep the state they had (open or collapsed) whatever the other panels say');
  // A picture dropped on the window is not Armature's.
  const dropped = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' }));
    const e = new DragEvent('dragover', { dataTransfer: dt, cancelable: true, bubbles: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  t.ok(!dropped, 'a picture dragged over the window is not claimed');
  // Each key does nothing and is not claimed.
  const keys = [
    ['x', {}],
    ['w', {}],
    ['e', {}],
    ['r', {}],
    ['t', {}],
    ['r', { shift: true }],
    ['z', { ctrl: true }],
    ['Enter', { ctrl: true }],
  ];
  const taken = [];
  for (const [k, o] of keys) {
    if (claimed(await pressSeen(page, k, o))) taken.push(`${o.ctrl ? 'Ctrl+' : ''}${o.shift ? 'Shift+' : ''}${k}`);
  }
  t.ok(taken.length === 0, `no key is claimed (${taken.join(', ') || 'none'}): each reaches a listener of the test's own un-prevented`);
  t.eq(await poseOf(page), poseNow, 'and none of them moved or reset anything');
  t.eq(JSON.stringify(await page.evaluate(() => [window.__armature.selected(), window.__armature.gizmo().mode, window.__armature.history()])), JSON.stringify([selected, JSON.parse(gizmo).mode, JSON.parse(history)]), 'nor changed the selection, the gizmo or the history');
  t.eq(await page.evaluate(() => window.__armature.history().undo), JSON.parse(history).undo, 'the history did not grow');

  // ---- resume ---------------------------------------------------------------------------
  const settingsSuspended = await viewerState(page);
  await page.evaluate(() => window.__armature.resume());
  await page.waitForTimeout(400);
  t.ok(!(await page.evaluate(() => window.__armature.isSuspended())), 'resume() says it is not suspended');
  t.eq(requests.slice(net).filter((u) => !u.startsWith('data:')).length, 0, `nothing was fetched from suspend to resume (${requests.slice(net).join(', ')})`);
  t.eq(await poseOf(page), poseNow, 'resumed: the same pose');
  t.eq(JSON.stringify(await page.evaluate(() => [window.__armature.selected(), window.__armature.gizmo().mode, window.__armature.history()])), JSON.stringify([selected, JSON.parse(gizmo).mode, JSON.parse(history)]), 'the same selection, gizmo mode and history');
  t.eq(JSON.stringify(await panelsOpen(page)), JSON.stringify(open), 'the same panels open');
  const back = await onPage(page);
  t.ok(JSON.stringify(back) === JSON.stringify(showing), `all of it is on screen again, as it was (${JSON.stringify(back)})`);
  t.eq(JSON.stringify(await viewerState(page)), JSON.stringify(mounted), 'and the viewer is as Armature has it');
  t.ok(settingsSuspended.ground === 'off', "(it was Sculpt's own in between)");
  // It works: a drag from the ring moves the hand, and Undo puts it back.
  // The tap on the figure while suspended was the viewer's own (tap to focus is its again), and moved the
  // camera in; frame the figure again.
  await page.evaluate(() => window.__armature.frame());
  await page.waitForTimeout(300);
  // The camera came to the figure as posed, and the stage with it: what the twenty cycles must keep.
  const framed = await viewerState(page);
  await page.screenshot({ path: `${SHOTS}/4-resumed.png` });
  const chain = a.free.replace('ik:', '');
  const ring = await page.evaluate((n) => window.__armature.ballOnScreen(n), a.free);
  const diag = await page.evaluate((n) => {
    const m = window.__armature;
    return { look: m.handleLook(n), pos: m.handlePosition(n.replace('ik:', '')), screen: m.onScreen(...m.handlePosition(n.replace('ik:', ''))), cam: window.__bozzetto.camera.position.toArray() };
  }, a.free);
  t.ok(ring && (await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', ring)), `the ${a.free} ring is on the view after resume, at ${ring} (${JSON.stringify(diag)})`);
  const handBefore = await page.evaluate((c) => window.__armature.handlePosition(c), chain);
  await drag(page, [ring[0], ring[1]], [ring[0] - 50, ring[1] - 50]);
  const handAfter = await page.evaluate((c) => window.__armature.handlePosition(c), chain);
  t.ok(Math.hypot(...handAfter.map((v, i) => v - handBefore[i])) > 5, 'a drag on a handle moves a joint again');
  const undoBefore = await page.evaluate(() => window.__armature.history().undo);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  t.eq(await page.evaluate(() => window.__armature.history().undo), undoBefore - 1, 'Ctrl+Z undoes it');
  t.ok(claimed(await pressSeen(page, 'x')), 'and X is claimed again');
  await page.keyboard.press('x');

  // ---- twenty times is as one -----------------------------------------------------------
  await page.evaluate(() => window.__armature.suspend());
  await page.evaluate(() => window.__armature.resume());
  await page.waitForTimeout(200);
  const one = {
    listeners: await page.evaluate(() => window.__ledger.listeners()),
    intervals: await page.evaluate(() => window.__ledger.intervals()),
    scene: await sceneCount(page),
    nodes: await pageCount(page),
  };
  const addsPerCycle = await page.evaluate(() => {
    const n = window.__ledger.adds();
    window.__armature.suspend();
    window.__armature.resume();
    return window.__ledger.adds() - n;
  });
  const addsBefore = await page.evaluate(() => window.__ledger.adds());
  const poseTwenty = await poseOf(page);
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) {
      window.__armature.suspend(i % 2 ? { figure: 'show' } : undefined);
      window.__armature.resume();
    }
  });
  await page.waitForTimeout(200);
  const twenty = {
    listeners: await page.evaluate(() => window.__ledger.listeners()),
    intervals: await page.evaluate(() => window.__ledger.intervals()),
    scene: await sceneCount(page),
    nodes: await pageCount(page),
  };
  t.eq(JSON.stringify(twenty), JSON.stringify(one), 'twenty suspends and resumes leave the listeners, timers, scene children and page elements as one');
  t.eq((await page.evaluate(() => window.__ledger.adds())) - addsBefore, addsPerCycle * 20, `and each cycle adds the same ${addsPerCycle} listeners, none more`);
  t.eq(await poseOf(page), poseTwenty, 'the pose came through all twenty');
  t.eq(JSON.stringify(await viewerState(page)), JSON.stringify(framed), 'and so did the viewer');
  await page.evaluate(() => window.__armature.suspend({ figure: 'show' }));
  await page.evaluate(() => window.__armature.suspend()); // twice in a row is the same as once
  t.ok(!(await onPage(page)).figure, 'suspend while suspended only changes the figure');
  await page.evaluate(() => window.__armature.resume());
  await page.evaluate(() => window.__armature.resume()); // and so is resume
  t.ok((await page.evaluate(() => !window.__armature.isSuspended())), 'resume while running does nothing');

  // ---- dispose twice over -----------------------------------------------------------------
  await page.evaluate(() => window.__armature.dispose());
  t.eq(await sceneCount(page), sceneBefore, 'dispose takes everything of Armature out of the scene');
  t.eq(await pageCount(page), pageBefore, 'and off the page');
  t.eq(JSON.stringify(await viewerState(page)), JSON.stringify(before), 'and the viewer is its own');
  await page.evaluate(() => window.__armatureMount(window.__bozzetto, window.__sculpt.armatureHost));
  await page.waitForFunction(() => !!window.__armature, null, { timeout: 60_000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__armature.suspend());
  t.eq(JSON.stringify(await viewerState(page)), JSON.stringify(before), 'mounted a third time and suspended at once, the viewer is its own');
  await page.evaluate(() => window.__armature.dispose());
  t.eq(await sceneCount(page), sceneBefore, 'disposed while suspended, nothing is left in the scene');
  t.eq(await pageCount(page), pageBefore, 'or on the page');
  t.eq(JSON.stringify(await viewerState(page)), JSON.stringify(before), 'and the viewer is as it was');
  writeFileSync(`${SHOTS}/NOTES.txt`, 'armatureSuspend screenshots: 1 running, 2 suspended with the figure hidden, 3 suspended with it shown, 4 resumed.\n');
}

export const suites = { armatureSuspend };
