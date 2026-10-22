// Three owner items, one suite each:
//
// clayLayer: the clay brush's new defaults (spacing 0.1, plateau 0.8,
//   layer 0.1, the rake keeping its own 0.06 / 0.8 / 0.01), and the layer
//   height following pen pressure: a pen dab at half pressure raises the
//   plane half as far as one at full pressure, and a mouse dab lays the
//   whole layer. A stored scene from before the new spacing does not
//   shadow it.
// tabAfterCreate: Tab after creating an object in the Scene panel closes
//   the panels (a clicked button no longer keeps Tab), and Shift+Tab still
//   moves the focus.
// penBarrelPan: a pen's barrel button pans, and the pan ends when the
//   button goes up, with or without a pointerup; a mouse middle-drag still
//   pans and ends on its release. The viewer and Armature run the same
//   controls.
import { openArmature, openSculpt } from './lib.mjs';

async function openForInput(page, base) {
  await openSculpt(page, base, '&q=low');
  await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
}

/**
 * In the page: the plane primitive at level 0 alone in reach, flat,
 * symmetry off, and one clay dab on the vertex nearest its centre through
 * the live tool. `pen` and `pressure` are what InputShell would have fed
 * the Tablet. Returns how far the centre vertex rose, the layer offset the
 * dab used and the local radius.
 */
function clayDab({ pen, pressure }) {
  const { session, tablet, input } = window.__sculpt;
  const manager = session.getSculptManager();
  const tool = manager.getTool(input.currentToolIndex());
  let plane = session.getMeshes().find((m) => m.__clayPlane);
  if (!plane) {
    plane = session.addPrimitive('plane');
    while (session.deleteHighestLevel());
    plane.__clayPlane = true;
    for (const m of session.getMeshes()) if (m !== plane) m.getMatrix()[12] += 50;
  }
  session.setMesh(plane);
  const v = plane.getVertices();
  const n = plane.getNbVertices();
  let centre = 0;
  for (let i = 0, best = Infinity; i < n; i++) {
    const d = v[i * 3] ** 2 + v[i * 3 + 1] ** 2;
    if (d < best) [best, centre] = [d, i];
  }
  const ind = centre * 3;
  for (let i = 0; i < n; i++) v[i * 3 + 2] = 0;
  plane.updateGeometry();
  plane.updateBuffers?.();
  const m = plane.getMatrix();
  const p = [v[ind], v[ind + 1], v[ind + 2]];
  const w = [0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]);
  const [x, y] = session.getCamera().project(w);
  const symmetry = manager._symmetry;
  const intensity = tool._intensity;
  manager._symmetry = false;
  // Strength 1: half pressure is factor 1 and full pressure 2, both capped
  // at 1 in the flatten, so the strength term is the same for every dab
  // here and only the layer term differs.
  tool._intensity = 1;
  const d = input.dynamics.get(input.currentToolIndex());
  d.strength = 1;
  d.strengthCurve = 'linear';
  tablet.pressure = pressure;
  tablet.pen = pen;
  let r = null;
  try {
    session._mouseX = x;
    session._mouseY = y;
    const hit = manager.start(false);
    const picking = session.getPicking();
    const hitPlane = hit && picking.getMesh() === plane;
    tool.makeStroke(x, y, picking, null);
    r = Math.sqrt(picking.getLocalRadius2());
    tool.updateRender();
    manager.end();
    session.getStateManager().cleanNoop();
    return { hitPlane, rise: Math.abs(v[ind + 2]), off: tool.lastLayerOffset, r, layer: tool.layer, factor: tablet.getPressureLayer() };
  } finally {
    tablet.pressure = 0.5;
    tablet.pen = false;
    tool._intensity = intensity;
    manager._symmetry = symmetry;
  }
}

/** The camera as numbers, and OrbitControls' state. */
const cam = (page) =>
  page.evaluate(() => {
    const v = window.__bozzetto;
    const oc = v.controls.controls;
    return { p: oc.object.position.toArray(), t: oc.target.toArray(), state: oc.state, dragging: v.controls.isDragging() };
  });
const dist = (a, b) => Math.hypot(...a.p.map((x, i) => x - b.p[i])) + Math.hypot(...a.t.map((x, i) => x - b.t[i]));

/**
 * Synthetic pen (or mouse) pointer events on the canvas, as the Windows
 * Ink stack sends them, then frames run so the damping applies what they
 * did. Pointer id 1, the one Chromium keeps active, so the capture
 * OrbitControls takes on the press holds. `steps` is a list of
 * [type, x, y, button, buttons, opts?] from the canvas's top left.
 */
function sendPointers({ steps, pointerType }) {
  const v = window.__bozzetto;
  const c = v.controls;
  const canvas = c.controls.domElement;
  const rect = canvas.getBoundingClientRect();
  const out = [];
  for (const [type, x, y, button, buttons, opts = {}] of steps) {
    if (type === 'blur') {
      window.dispatchEvent(new Event('blur'));
    } else if (type === 'frames') {
      for (let i = 0; i < x; i++) c.update(1 / 60);
    } else if (type === 'halt') {
      for (let i = 0; i < 120; i++) c.update(1 / 60);
      c.halt();
      c.update(1 / 60);
    } else {
      (opts.target === 'window' ? window : canvas).dispatchEvent(
        new PointerEvent(type, {
          pointerId: opts.pointerId ?? 1,
          pointerType: opts.pointerType ?? pointerType,
          isPrimary: true,
          clientX: rect.left + x,
          clientY: rect.top + y,
          button,
          buttons,
          pressure: buttons ? 0.5 : 0,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
      for (let i = 0; i < 3; i++) c.update(1 / 60);
    }
    const oc = c.controls;
    out.push({ type, state: oc.state, dragging: c.isDragging(), p: oc.object.position.toArray(), t: oc.target.toArray() });
  }
  return out;
}

/** The pen barrel checks, in sculpt or in the viewer. */
async function penChecks(page, t, where) {
  const run = (steps, pointerType = 'pen') => page.evaluate(sendPointers, { steps, pointerType });
  const moved = (a, b) => Math.hypot(...a.p.map((x, i) => x - b.p[i])) + Math.hypot(...a.t.map((x, i) => x - b.t[i]));
  // Well off the subject: a corner of the view.
  const X = 90;
  const Y = 120;

  // Barrel as middle (button 1, buttons 4), then NO pointerup: the hover's
  // pointermove reports buttons 0.
  let r = await run([
    ['pointerdown', X, Y, 1, 4],
    ['pointermove', X + 30, Y + 10, -1, 4],
    ['pointermove', X + 60, Y + 20, -1, 4],
    ['pointermove', X + 70, Y + 25, -1, 0],
    ['halt'],
  ]);
  t.ok(r[0].state === 2 && r[0].dragging, `${where}: the pen's barrel (button 1, buttons 4) pans (state ${r[0].state})`);
  t.ok(moved(r[2], r[0]) > 0, `${where}: and the view follows the pen while it is held`);
  t.ok(r[3].state === -1 && !r[3].dragging, `${where}: a hover move with buttons 0 and no pointerup ends the pan (state ${r[3].state}, dragging ${r[3].dragging})`);
  let before = r[4];
  r = await run([
    ['pointermove', X + 120, Y + 60, -1, 0],
    ['pointermove', X + 200, Y + 90, -1, 0],
    ['pointermove', X + 260, Y + 40, -1, 0],
    ['frames', 30],
  ]);
  t.ok(r.every((s) => s.state === -1) && moved(r[3], before) < 1e-9, `${where}: further hover moves neither orbit nor pan (moved ${moved(r[3], before).toExponential(2)})`);

  // The same with a proper pointerup.
  r = await run([
    ['pointerdown', X, Y, 1, 4],
    ['pointermove', X + 40, Y + 10, -1, 4],
    ['pointerup', X + 40, Y + 10, 1, 0],
    ['halt'],
    ['pointermove', X + 140, Y + 70, -1, 0],
    ['pointermove', X + 220, Y + 20, -1, 0],
    ['frames', 30],
  ]);
  t.ok(r[0].state === 2 && r[2].state === -1 && !r[2].dragging, `${where}: with its pointerup, the barrel pan ends there (state ${r[0].state} then ${r[2].state})`);
  t.ok(moved(r[6], r[3]) < 1e-9, `${where}: and hover moves after it leave the view alone`);

  // Barrel reported as right (button 2, buttons 2): pans too, not dolly.
  r = await run([
    ['pointerdown', X, Y, 2, 2],
    ['pointermove', X + 30, Y, -1, 2],
    ['pointermove', X + 40, Y, -1, 0],
    ['halt'],
  ]);
  t.ok(r[0].state === 2 && r[2].state === -1, `${where}: a barrel reported as button 2 pans as well, and ends the same way (state ${r[0].state} then ${r[2].state})`);
  const mapped = await page.evaluate(() => window.__bozzetto.controls.controls.mouseButtons);
  t.ok(mapped.LEFT === 0 && mapped.MIDDLE === 2 && mapped.RIGHT === 1, `${where}: the button map is the mouse's again after it (${JSON.stringify(mapped)})`);

  // The tip joins mid-pan (buttons 5), then the barrel lets go (buttons 1):
  // the pan ends there and nothing turns into an orbit.
  r = await run([
    ['pointerdown', X, Y, 1, 4],
    ['pointermove', X + 20, Y, 0, 5],
    ['pointermove', X + 40, Y, -1, 5],
    ['pointermove', X + 50, Y, 1, 1],
    ['halt'],
    ['pointermove', X + 150, Y + 50, -1, 1],
    ['frames', 30],
  ]);
  t.ok(r[1].state === 2 && r[2].state === 2, `${where}: the tip touching mid-pan keeps it a pan (state ${r[1].state}, ${r[2].state})`);
  t.ok(r[3].state === -1 && moved(r[6], r[4]) < 1e-9, `${where}: the barrel letting go with the tip still down ends it, and the tip's moves do not orbit (state ${r[3].state})`);
  await run([['pointerup', X + 150, Y + 50, 0, 0]]);

  // The release reported under another pointer id: no fallback to a
  // one-finger rotate on the pointer OrbitControls still held.
  r = await run([
    ['pointerdown', X, Y, 1, 4],
    ['pointermove', X + 30, Y, -1, 4],
    ['pointerup', X + 30, Y, 1, 0, { pointerId: 2, pointerType: 'mouse', target: 'window' }],
    ['halt'],
    ['pointermove', X + 160, Y + 60, -1, 0],
    ['frames', 30],
  ]);
  t.ok(r[2].state === -1 && moved(r[5], r[3]) < 1e-9, `${where}: an up under another id ends the pan rather than rotating (state ${r[2].state})`);

  // Cancel, lost capture and the window going away end it too.
  for (const [label, end] of [
    ['pointercancel', ['pointercancel', X + 30, Y, -1, 0]],
    ['lostpointercapture', ['lostpointercapture', X + 30, Y, -1, 4]],
    ['a window blur', ['blur']],
  ]) {
    r = await run([['pointerdown', X, Y, 1, 4], ['pointermove', X + 20, Y, -1, 4], end, ['halt'], ['pointermove', X + 120, Y + 40, -1, 4], ['frames', 20]]);
    t.ok(r[0].state === 2 && r[2].state === -1 && moved(r[5], r[3]) < 1e-9, `${where}: ${label} ends the pan, and later moves do nothing (state ${r[2].state})`);
    await run([['pointerup', X + 120, Y + 40, 1, 0]]);
  }
}

export const suites = {
  async clayLayer(page, base, t) {
    await openForInput(page, base);
    await page.keyboard.press('3'); // Standard clay
    const defaults = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getSculptManager();
      const pick = (i) => {
        const tool = m.getTool(i);
        return { spacing: tool._spacing, plateau: tool.plateau, layer: tool.layer, pressure: tool.layerPressure?.() };
      };
      // Enums.Tools: BRUSH 0 (clay), RAKE 13.
      return { clay: pick(0), rake: pick(13), clayIndex: 0, current: window.__sculpt.input.currentToolIndex() };
    });
    t.ok(defaults.clay.spacing === 0.1 && defaults.clay.plateau === 0.8 && defaults.clay.layer === 0.1, `clay installs spacing 0.1, plateau 0.8, layer 0.1 (${JSON.stringify(defaults.clay)})`);
    t.ok(defaults.rake.spacing === 0.06 && defaults.rake.plateau === 0.8 && defaults.rake.layer === 0.01, `the rake keeps its own 0.06, 0.8, 0.01 (${JSON.stringify(defaults.rake)})`);
    t.eq(defaults.current, defaults.clayIndex, 'key 3 is the clay brush');

    // The panel's layer slider reaches past 0.1 and says it follows pressure.
    await page.evaluate(() => {
      const p = document.querySelector('.panel--sculpt');
      if (p?.classList.contains('panel--collapsed')) p.querySelector('.panel__handle')?.click();
    });
    await page.waitForTimeout(300);
    const slider = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.panel--sculpt label')].find((l) => /Strip layer/.test(l.textContent));
      const input = row?.querySelector('input[type="range"]');
      const hint = [...document.querySelectorAll('.panel--sculpt .sculpt-panel__hint')].map((h) => h.textContent).join(' | ');
      return { min: Number(input?.min), max: Number(input?.max), value: Number(input?.value), hint };
    });
    t.ok(slider.min <= 0.01 && slider.max >= 0.3 && Math.abs(slider.value - 0.1) < 1e-9, `the Strip layer slider sits at 0.1 well inside its range (${JSON.stringify(slider)})`);
    t.ok(/follows pen pressure/.test(slider.hint) && /mouse/.test(slider.hint), `and its hint says the layer follows pressure, a mouse laying all of it ("${slider.hint}")`);

    const full = await page.evaluate(clayDab, { pen: true, pressure: 1 });
    const half = await page.evaluate(clayDab, { pen: true, pressure: 0.5 });
    const mouse = await page.evaluate(clayDab, { pen: false, pressure: 0.5 });
    t.ok(full.hitPlane && half.hitPlane && mouse.hitPlane, 'the dabs land on the plane');
    t.near(full.off / full.r, 0.1, 1e-9, `a pen at full pressure raises the plane 0.1 of the radius (${(full.off / full.r).toFixed(4)})`);
    t.near(half.off / half.r, 0.05, 1e-9, `at half pressure 0.05 (${(half.off / half.r).toFixed(4)})`);
    t.near(full.rise, full.off, 1e-5, `and the plateau's vertex rises to the plane (${full.rise.toExponential(3)} for ${full.off.toExponential(3)})`);
    t.ok(half.rise < full.rise * 0.6 && Math.abs(half.rise - full.rise / 2) < 1e-5, `the half-pressure dab raises half as far, by the layer term alone (${half.rise.toExponential(3)} against ${full.rise.toExponential(3)})`);
    t.ok(mouse.factor === 1 && Math.abs(mouse.off / mouse.r - 0.1) < 1e-9 && Math.abs(mouse.rise - full.rise) < 1e-5, `a mouse (Tablet's stand-in 0.5) lays the full layer (factor ${mouse.factor}, ${(mouse.off / mouse.r).toFixed(4)})`);

    // A real mouse press through InputShell: the Tablet knows it is no pen.
    const real = await page.evaluate(() => {
      const { session, tablet } = window.__sculpt;
      const tool = session.getSculptManager().getTool(0);
      const plane = session.getMeshes().find((m) => m.__clayPlane);
      const v = plane.getVertices();
      const m = plane.getMatrix();
      const w = [m[12], m[13], m[14]];
      const [x, y] = session.getCamera().project(w);
      const pr = session.getPixelRatio();
      const r = session.getCanvas().getBoundingClientRect();
      const seen = [];
      const own = tool.stroke;
      tool.stroke = function (picking, sym) {
        const out = own.call(this, picking, sym);
        seen.push({ pen: tablet.pen, ratio: this.lastLayerOffset / Math.sqrt(picking.getLocalRadius2()) });
        return out;
      };
      window.__claySeen = { seen, restore: () => (tool.stroke = own) };
      return { x: r.left + x / pr, y: r.top + y / pr, n: v.length };
    });
    await page.mouse.move(real.x, real.y);
    await page.mouse.down();
    await page.mouse.move(real.x + 30, real.y + 4, { steps: 6 });
    await page.mouse.up();
    const seen = await page.evaluate(() => {
      const s = window.__claySeen;
      s.restore();
      return s.seen;
    });
    t.ok(seen.length > 0 && seen.every((s) => s.pen === false && Math.abs(s.ratio - 0.1) < 1e-9), `a real mouse stroke lays the full 0.1 layer on every dab (${seen.length} dabs, ${JSON.stringify(seen.slice(0, 2))})`);

    // A scene saved before the new spacing (no spacingRev) carries clay's
    // old default 0.15 for every tool; it does not shadow the new 0.1. A
    // spacing the sculptor set, or a current record's 0.15, comes back.
    const loads = await page.evaluate(() => {
      const { input, session } = window.__sculpt;
      const tool = session.getSculptManager().getTool(0);
      const out = {};
      input.loadSpacing({ 0: 0.15 });
      out.legacyDefault = tool._spacing;
      input.loadSpacing({ 0: 0.3 });
      out.legacyChosen = tool._spacing;
      input.loadSpacing({ 0: 0.15 }, 1);
      out.currentRecord = tool._spacing;
      tool._spacing = 0.1;
      return out;
    });
    t.ok(loads.legacyDefault === 0.1 && loads.legacyChosen === 0.3 && loads.currentRecord === 0.15, `stored spacing: an old record's 0.15 default is passed over, a chosen value and a current record's are kept (${JSON.stringify(loads)})`);
  },

  async tabAfterCreate(page, base, t) {
    await openForInput(page, base);
    const focus = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        return a === document.body || !a ? 'body' : `${a.tagName.toLowerCase()}.${[...a.classList].join('.')}`;
      });
    const open = () =>
      page.evaluate(() => [...document.querySelectorAll('.panel--scene, .panel--sculpt')].map((p) => !p.classList.contains('panel--collapsed')));
    const openPanels = async () => {
      await page.evaluate(() => {
        for (const s of ['.panel--scene', '.panel--sculpt']) {
          const p = document.querySelector(s);
          if (p?.classList.contains('panel--collapsed')) p.querySelector('.panel__handle')?.click();
        }
      });
      await page.waitForTimeout(400);
    };
    const settleClosed = () =>
      page
        .waitForFunction(() => document.querySelector('.panel--scene')?.classList.contains('panel--collapsed'), null, { timeout: 3000 })
        .catch(() => {})
        .then(() => page.waitForTimeout(200));

    await openPanels();
    const meshes = await page.evaluate(() => window.__sculpt.session.getMeshes().length);
    await page.click('.panel--scene .outliner__btn--wide');
    const onCreate = await focus();
    await page.click('.outliner__menu--create .outliner__menu-item[data-kind="cube"]');
    await page.waitForFunction((n) => window.__sculpt.session.getMeshes().length === n + 1, meshes, { timeout: 10_000 });
    await page.waitForTimeout(300);
    const afterCreate = await focus();
    t.ok(/outliner__btn/.test(onCreate), `the Create button takes the focus when clicked (${onCreate}); after the cube, focus is on ${afterCreate}`);
    t.ok((await open()).every(Boolean), 'the panels are open after the create');
    await page.keyboard.press('Tab');
    await settleClosed();
    let o = await open();
    t.ok(o.every((x) => !x), `Tab after creating an object closes the panels (open ${o})`);
    t.ok(!(await page.evaluate(() => document.body.classList.contains('chrome-hidden'))), 'and leaves the interface up');

    // The Create button keeping the focus (its menu opened and closed
    // again): still the chrome's Tab, and the focus is let go of.
    await openPanels();
    await page.click('.panel--scene .outliner__btn--wide');
    await page.click('.panel--scene .outliner__btn--wide');
    const kept = await focus();
    await page.keyboard.press('Tab');
    await settleClosed();
    o = await open();
    const after = await focus();
    t.ok(/outliner__btn/.test(kept) && o.every((x) => !x) && after === 'body', `Tab with the Create button focused closes the panels and drops the focus (${kept} -> ${after}, open ${o})`);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);
    const hidden = await page.evaluate(() => document.body.classList.contains('chrome-hidden'));
    t.ok(hidden, 'and the next Tab hides the interface, as from nowhere');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(300);

    // Shift+Tab is still focus navigation from a focused button.
    await openPanels();
    await page.click('.panel--scene .outliner__btn--wide');
    await page.click('.panel--scene .outliner__btn--wide');
    const from = await focus();
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(200);
    const to = await focus();
    o = await open();
    t.ok(from !== to && to !== 'body' && o.every(Boolean), `Shift+Tab from the Create button moves the focus and closes nothing (${from} -> ${to})`);

    // A rename field keeps Tab: it is a field you type into.
    const renamed = await page.evaluate(() => {
      const name = document.querySelector('.panel--scene .outliner__row--active .outliner__name');
      name?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const f = document.querySelector('.outliner__rename');
      return !!f && document.activeElement === f;
    });
    if (renamed) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      o = await open();
      t.ok(o.every(Boolean) && !(await page.evaluate(() => document.body.classList.contains('chrome-hidden'))), `Tab in the rename field is the field's, not the chrome's (open ${o})`);
    } else {
      t.ok(true, 'no rename field to check here (the row names a different element)');
    }
  },

  async penBarrelPan(page, base, t) {
    await openForInput(page, base);
    await penChecks(page, t, 'Sculpt');

    // A pen tip that missed the mesh orbits through InputShell; a hover
    // move with buttons 0 ends that orbit too.
    const tip = await page.evaluate(sendPointers, {
      pointerType: 'pen',
      steps: [
        ['pointerdown', 90, 120, 0, 1],
        ['pointermove', 120, 130, -1, 1],
        ['pointermove', 130, 130, -1, 0],
        ['halt'],
        ['pointermove', 260, 200, -1, 0],
        ['frames', 20],
      ],
    });
    t.ok(tip[0].state === 0 && tip[2].state === -1 && dist({ p: tip[5].p, t: tip[5].t }, { p: tip[3].p, t: tip[3].t }) < 1e-9, `Sculpt: a pen tip orbit off the model ends on a buttons-0 move too (state ${tip[0].state} then ${tip[2].state})`);
    await page.evaluate(sendPointers, { pointerType: 'pen', steps: [['pointerup', 260, 200, 0, 0]] });

    // Mouse middle-drag regression, with real input: pans, ends on release.
    const rect = await page.evaluate(() => {
      const r = window.__bozzetto.controls.controls.domElement.getBoundingClientRect();
      return { x: r.left + 90, y: r.top + 120 };
    });
    const before = await cam(page);
    await page.mouse.move(rect.x, rect.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(rect.x + 40, rect.y + 20, { steps: 5 });
    const during = await cam(page);
    await page.mouse.up({ button: 'middle' });
    const after = await cam(page);
    await page.evaluate(() => {
      const c = window.__bozzetto.controls;
      for (let i = 0; i < 120; i++) c.update(1 / 60);
      c.halt();
    });
    const settled = await cam(page);
    await page.mouse.move(rect.x + 200, rect.y + 120, { steps: 5 });
    await page.evaluate(() => {
      const c = window.__bozzetto.controls;
      for (let i = 0; i < 20; i++) c.update(1 / 60);
    });
    const later = await cam(page);
    t.ok(during.state === 2 && during.dragging, `a mouse middle-drag pans (state ${during.state})`);
    t.ok(after.state === -1 && !after.dragging && dist(settled, before) > 0, `and ends on its release, having moved the view (state ${after.state})`);
    t.ok(dist(later, settled) < 1e-9, 'and plain mouse moves after it leave the view alone');

    // The public viewer runs the same controls.
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await page.evaluate(() => window.__bozzetto.pause());
    await penChecks(page, t, 'the viewer');

    // And Armature, over the same viewer.
    await openArmature(page, base);
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 }).catch(() => {});
    await penChecks(page, t, 'Armature');
  },
};
