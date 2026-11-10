// Three owner items, and the clay brush's mechanics:
//
// clayLayer: the clay brush's defaults (spacing 0.1, the Plateau profile
//   curve - the old 0.8 plateau - and since 2026-10-31 a strength of 1.5
//   cm, with no Strip layer slider; the tine rake keeps its own spacing
//   0.06), and one dab's maths: the plane a tenth of the radius over the
//   surface, the rate from the strength and following pen pressure (half
//   the press moves half as far, a mouse is a full press), and Strength 0
//   moving nothing. A stored scene from before the new spacing does not
//   shadow it.
// clayFollow (owner report, 2026-11-10: the brush pushed at Strength 0,
//   ignored pressure and stamped flat planes): strokes across the default
//   sphere and down a head's philtrum. Strength 0 at full pressure moves no
//   vertex; a lighter press builds in proportion; one stroke at the
//   defaults builds about the Strength, and a strength past the rate's cap
//   about 0.65 of the radius, evenly; and what moves, moves along the
//   surface's own normals within a tolerance, concave anatomy included.
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
 * symmetry off, and one clay dab at `strength` cm on the vertex nearest its
 * centre through the live tool. `pen` and `pressure` are what InputShell
 * would have fed the Tablet. Returns how far the centre vertex rose, the
 * farthest any vertex moved, the plane offset and the rate the dab used,
 * the rate its strength asks for, and the local radius.
 */
function clayDab({ pen, pressure, strength = 0.3 }) {
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
  tool._intensity = strength;
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
    let moved = 0;
    for (let i = 0; i < n; i++) moved = Math.max(moved, Math.abs(v[i * 3 + 2]));
    // The rate the strength asks for: 1.5 x strength / (the curve's line
    // integral x radius) at the default spacing, held to 0.5 (tools.ts).
    const want = Math.min(0.5, (1.5 * strength) / plane.getScale() / (tool.curve.lineIntegral() * r));
    return { hitPlane, rise: Math.abs(v[ind + 2]), moved, off: tool.lastLayerOffset, rate: tool.lastRate, want, r, strength: tool._intensity, factor: tablet.getPressureLayer() };
  } finally {
    tablet.pressure = 0.5;
    tablet.pen = false;
    tool._intensity = intensity;
    manager._symmetry = symmetry;
  }
}

/**
 * In the page: one clay stroke through the live tool on `window.__clayMesh`
 * (the first object without one), symmetry off, between the local points
 * `from` and `to`, projected - or, with neither, through the object's
 * middle on the canvas along `dir`, moved `offset` brush radii across the
 * canvas - with a dab every spacing x radius px as a real stroke lays them.
 * `pen` and `pressure` are what InputShell would feed the Tablet;
 * `strength` (cm), `radius` (cm, the px radius found by a probe press: the
 * view's scale may change between strokes) and `lenRadii` (the stroke as
 * that many brush radii either side of its middle) override the tool's.
 * The mesh is put back as it was. Returns,
 * against the positions and normals from before the stroke: how many
 * vertices moved and the farthest; the rise along the normal of the
 * vertices on the stroke's centre line (within 0.12 radius of it, half a
 * radius either side of its middle: least, mean, most); and the angle
 * between each move and its vertex's normal (the mean weighted by the
 * move, and the 90th percentile among moves over a quarter of the
 * farthest).
 */
export function clayStroke(o) {
  const { session, tablet, input } = window.__sculpt;
  const manager = session.getSculptManager();
  const tool = manager.getTool(0);
  manager.setToolIndex(0);
  const mesh = window.__clayMesh ?? session.getMeshes()[0];
  session.setMesh(mesh);
  const v = mesh.getVertices();
  const n = mesh.getNbVertices();
  if (!mesh.__rest) {
    mesh.__rest = new Float32Array(v.subarray(0, n * 3));
    mesh.__restN = new Float32Array(mesh.getNormals().subarray(0, n * 3));
  }
  const rest = mesh.__rest;
  const restN = mesh.__restN;
  const reset = () => {
    v.set(rest);
    mesh.updateGeometry();
    mesh.updateBuffers?.();
  };
  reset();
  const m = mesh.getMatrix();
  const screen = (p) => session.getCamera().project([0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]));
  const scale = mesh.getScale();
  const symmetry = manager._symmetry;
  manager._symmetry = false;
  const d = input.dynamics.get(0);
  const dyn = { ...d };
  d.size = 0;
  d.strength = 1;
  d.strengthCurve = 'linear';
  const keep = { intensity: tool._intensity, radius: tool._radius };
  const picking = session.getPicking();
  // A press that moves nothing: where the ray lands and the radius there.
  const pickAt = (x, y) => {
    session._mouseX = x;
    session._mouseY = y;
    tablet.pressure = 0.5;
    tablet.pen = false;
    const s0 = tool._intensity;
    tool._intensity = 0;
    try {
      if (!manager.start(false) || picking.getMesh() !== mesh) return null;
      return { p: Array.from(picking.getIntersectionPoint()), r: Math.sqrt(picking.getLocalRadius2()) };
    } finally {
      manager.end();
      tool._intensity = s0;
      session.getStateManager().cleanNoop();
    }
  };
  try {
    if (o.strength !== undefined) tool._intensity = o.strength;
    const pr = session.getPixelRatio();
    const dir = o.dir ?? [1, 0];
    const middle = screen([0, 0, 0]);
    let [x0, y0] = o.from ? screen(o.from) : [middle[0] - dir[0], middle[1] - dir[1]];
    let [x1, y1] = o.to ? screen(o.to) : [middle[0] + dir[0], middle[1] + dir[1]];
    let xm = (x0 + x1) / 2;
    let ym = (y0 + y1) / 2;
    let mid = pickAt(xm, ym);
    // The px radius that is `radius` cm there, then (the offset moving the
    // middle) there again.
    for (let pass = 0; pass < 2 && mid; pass++) {
      if (o.radius) tool._radius = (tool._radius * o.radius) / (mid.r * scale);
      if (pass === 0 && o.offset) {
        const [ox, oy] = [o.offset[0] * tool._radius * pr, o.offset[1] * tool._radius * pr];
        [x0, y0, x1, y1, xm, ym] = [x0 + ox, y0 + oy, x1 + ox, y1 + oy, xm + ox, ym + oy];
      }
      mid = pickAt(xm, ym);
    }
    if (o.lenRadii) {
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const ux = ((x1 - x0) / len) * o.lenRadii * tool._radius * pr;
      const uy = ((y1 - y0) / len) * o.lenRadii * tool._radius * pr;
      [x0, y0, x1, y1] = [xm - ux, ym - uy, xm + ux, ym + uy];
    }
    const a = pickAt(x0, y0);
    const b = pickAt(x1, y1);
    if (!mid || !a || !b) return { miss: true };
    tablet.pressure = o.pressure ?? 1;
    tablet.pen = o.pen ?? true;
    session._mouseX = x0;
    session._mouseY = y0;
    if (!manager.start(false)) return { miss: true };
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (tool._spacing * tool._radius * pr));
    const rates = [];
    for (let s = 1; s <= steps; s++) {
      const x = x0 + ((x1 - x0) * s) / steps;
      const y = y0 + ((y1 - y0) * s) / steps;
      session._mouseX = x;
      session._mouseY = y;
      tool.makeStroke(x, y, picking, null);
      rates.push(tool.lastRate);
    }
    tool.updateRender();
    manager.end();
    session.getStateManager().cleanNoop();
    const r = mid.r;
    const way = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]];
    const dl = Math.hypot(...way) || 1;
    let moved = 0;
    let far = 0;
    let sum = 0;
    let sumAngle = 0;
    const moves = [];
    const line = [];
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      const dx = v[j] - rest[j];
      const dy = v[j + 1] - rest[j + 1];
      const dz = v[j + 2] - rest[j + 2];
      const len = Math.hypot(dx, dy, dz);
      const nl = Math.hypot(restN[j], restN[j + 1], restN[j + 2]) || 1;
      const rise = (dx * restN[j] + dy * restN[j + 1] + dz * restN[j + 2]) / nl;
      const px = rest[j] - mid.p[0];
      const py = rest[j + 1] - mid.p[1];
      const pz = rest[j + 2] - mid.p[2];
      const along = (px * way[0] + py * way[1] + pz * way[2]) / dl;
      const across = Math.sqrt(Math.max(0, px * px + py * py + pz * pz - along * along));
      if (Math.abs(along) < 0.5 * r && across < 0.12 * r) line.push(rise * scale);
      if (len === 0) continue;
      moved++;
      far = Math.max(far, len);
      const angle = (Math.acos(Math.max(-1, Math.min(1, rise / len))) * 180) / Math.PI;
      moves.push([angle, len]);
      sum += len;
      sumAngle += angle * len;
    }
    const big = moves.filter((q) => q[1] > 0.25 * far).map((q) => q[0]).sort((p, q) => p - q);
    line.sort((p, q) => p - q);
    return {
      r: r * scale,
      steps,
      moved,
      far: far * scale,
      lineN: line.length,
      lineMin: line[0] ?? 0,
      lineMean: line.reduce((t, x) => t + x, 0) / (line.length || 1),
      lineMax: line[line.length - 1] ?? 0,
      angle: sum ? sumAngle / sum : 0,
      angle90: big.length ? big[Math.min(big.length - 1, Math.floor(big.length * 0.9))] : 0,
      rate: rates[0] ?? 0,
    };
  } finally {
    Object.assign(d, dyn);
    tool._intensity = keep.intensity;
    tool._radius = keep.radius;
    tablet.pressure = 0.5;
    tablet.pen = false;
    manager._symmetry = symmetry;
    reset();
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

  // Firefox and Zen on Windows (owner's log, 2026-10-27): the capture is
  // taken back a few frames into a drag with the button still down, and
  // mouse moves with no buttons arrive among a pen's. Neither ends the drag.
  r = await run([
    ['pointerdown', X, Y, 1, 4],
    ['pointermove', X + 20, Y, -1, 4],
    ['lostpointercapture', X + 20, Y, -1, 4],
    ['pointermove', X + 25, Y, -1, 0, { pointerId: 2, pointerType: 'mouse', target: 'window' }],
    ['halt'],
    ['pointermove', X + 120, Y + 40, -1, 4],
    ['frames', 20],
  ]);
  t.ok(r[2].state === 2 && r[3].state === 2 && moved(r[6], r[4]) > 1e-6, `${where}: a lost capture with the button still down and a stray buttonless mouse move leave the pan going (state ${r[2].state}, ${r[3].state})`);
  await run([['pointerup', X + 120, Y + 40, 1, 0]]);

  // Cancel, lost capture and the window going away end it too.
  for (const [label, end] of [
    ['pointercancel', ['pointercancel', X + 30, Y, -1, 0]],
    ['a lost capture once the button is up', ['lostpointercapture', X + 30, Y, -1, 0]],
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
        return { spacing: tool._spacing, curve: tool.curve?.presetId, strength: tool._intensity, unit: tool.strengthUnit, layer: tool.layer, tines: tool.tines, pressure: tool.layerPressure?.() };
      };
      // Enums.Tools: BRUSH 0 (clay), RAKE 13.
      return { clay: pick(0), rake: pick(13), clayIndex: 0, current: window.__sculpt.input.currentToolIndex() };
    });
    t.ok(
      defaults.clay.spacing === 0.1 && defaults.clay.curve === 'plateau' && defaults.clay.strength === 1.5 && defaults.clay.unit === 'cm' && defaults.clay.layer === undefined,
      `clay installs spacing 0.1, the Plateau curve, a strength of 1.5 cm and no layer fraction (${JSON.stringify(defaults.clay)})`,
    );
    t.ok(defaults.rake.spacing === 0.06 && defaults.rake.curve === 'round' && defaults.rake.tines === 4 && defaults.rake.layer === undefined, `the tine rake keeps its own spacing 0.06, four Round tines and no clay layer (${JSON.stringify(defaults.rake)})`);
    t.eq(defaults.current, defaults.clayIndex, 'key 3 is the clay brush');

    // The Strip layer slider is gone (owner call, 2026-10-31: the layer is
    // the Strength, in cm), and no hint is left under the curve.
    await page.evaluate(() => {
      const p = document.querySelector('.panel--sculpt');
      if (p?.classList.contains('panel--collapsed')) p.querySelector('.panel__handle')?.click();
    });
    await page.waitForTimeout(300);
    const slider = await page.evaluate(() => {
      const layer = [...document.querySelectorAll('.panel--sculpt label')].some((l) => /Strip layer/.test(l.textContent));
      const row = [...document.querySelectorAll('.panel--sculpt label.compact')].find((l) => l.firstElementChild?.textContent === 'Strength');
      const input = row?.querySelector('input[type="range"]');
      const hint = [...document.querySelectorAll('.panel--sculpt .sculpt-panel__hint')].map((h) => h.textContent).join(' | ');
      return { layer, min: Number(input?.min), max: Number(input?.max), value: Number(input?.value), unit: input?.dataset.unit, hint };
    });
    t.ok(!slider.layer, 'the Strip layer slider is gone');
    t.ok(slider.min === 0 && slider.max === 5 && slider.value === 1.5 && slider.unit === ' cm', `the Strength row is the layer, in cm, at 1.5 of 0..5 (${JSON.stringify(slider)})`);
    t.ok(!/layer height|follows pen pressure/.test(slider.hint), `and no hint under it (owner call, 2026-10-24: "${slider.hint}")`);

    // One dab on the flat plane, at 0.3 cm: the plane is a tenth of the
    // radius over the surface (upstream's), and the centre vertex goes the
    // rate's share of the way to it. The rate is the strength's, times the
    // pressure term.
    const full = await page.evaluate(clayDab, { pen: true, pressure: 1 });
    const half = await page.evaluate(clayDab, { pen: true, pressure: 0.5 });
    const mouse = await page.evaluate(clayDab, { pen: false, pressure: 0.5 });
    const none = await page.evaluate(clayDab, { pen: true, pressure: 1, strength: 0 });
    const light = await page.evaluate(clayDab, { pen: true, pressure: 0, strength: 5 });
    t.ok(full.hitPlane && half.hitPlane && mouse.hitPlane && none.hitPlane && light.hitPlane, 'the dabs land on the plane');
    t.near(full.off, 0.1 * full.r, 1e-9, `a dab's plane is a tenth of the radius over the surface (${full.off.toFixed(4)} for a radius of ${full.r.toFixed(4)})`);
    t.ok(full.want > 0.01 && full.want < 0.5 && Math.abs(full.rate - full.want) < 1e-9, `a pen at full pressure dabs at the strength's rate (${full.rate.toFixed(4)}, 1.5 x 0.3 cm over the curve's integral and the radius: ${full.want.toFixed(4)})`);
    t.near(full.rise, full.rate * full.off, 1e-5, `and the centre vertex rises that share of the way to the plane (${full.rise.toExponential(3)} of ${full.off.toExponential(3)})`);
    t.ok(full.rise < 0.2 * full.off, `a small part of it: one dab at a low strength is a light touch (${(full.rise / full.off).toFixed(3)} of the way)`);
    // Dab against dab by rate x radius, which is the strength's alone: the
    // canvas's scale, and with it the brush's radius, may change between two.
    t.ok(Math.abs(half.rate * half.r - (full.rate * full.r) / 2) < 1e-9 && Math.abs(half.off - 0.1 * half.r) < 1e-9 && Math.abs(half.rise - half.rate * half.off) < 1e-5, `the half-pressure dab goes half as far, by the rate alone (rate ${half.rate.toFixed(4)} against ${full.rate.toFixed(4)}, rise ${half.rise.toExponential(3)} against ${full.rise.toExponential(3)})`);
    t.ok(mouse.factor === 1 && Math.abs(mouse.rate * mouse.r - full.rate * full.r) < 1e-9 && Math.abs(mouse.rise - mouse.rate * mouse.off) < 1e-5, `a mouse (Tablet's stand-in 0.5) is a full press (factor ${mouse.factor}, rate ${mouse.rate.toFixed(4)})`);
    t.ok(none.rate === 0 && none.moved === 0, `Strength 0 at full pressure moves nothing (rate ${none.rate}, farthest move ${none.moved})`);
    t.ok(light.rate === 0 && light.moved === 0, `and neither does a strength of 5 cm with no pressure (rate ${light.rate}, farthest move ${light.moved})`);

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
        seen.push({ pen: tablet.pen, rate: this.lastRate, strength: this._intensity, press: this.lastStrengthDab?.pressureTerm });
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
    t.ok(seen.length > 0 && seen.every((s) => s.pen === false && s.strength === 1.5 && s.press === 1 && s.rate > 0.05 && s.rate <= 0.5), `a real mouse stroke dabs at the 1.5 cm strength's full rate on every dab (${seen.length} dabs, ${JSON.stringify(seen.slice(0, 2))})`);

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

  async clayFollow(page, base, t) {
    await openForInput(page, base);
    await page.keyboard.press('3');
    // The default sphere, 25 cm, and the default brush, about 2.8 cm at
    // the default view: strokes through the middle of the sphere as the
    // view shows it, 2.5 radii either side. The first takes the brush as
    // it comes; the rest ask for its size in cm, since the canvas's scale
    // may change under a suite.
    await page.waitForTimeout(500);
    const stroke = (o) => page.evaluate(clayStroke, { lenRadii: 2.5, ...o });
    const full = await stroke({});
    t.ok(!full.miss && full.steps > 20 && full.lineN > 10 && full.moved > 500, `a stroke across the sphere at the defaults: ${full.steps} dabs of a ${full.r?.toFixed(2)} cm brush, ${full.moved} vertices moved`);

    // Strength 0 at full pressure, and no pressure at any strength.
    const radius = full.r;
    const zero = await stroke({ radius, strength: 0 });
    t.ok(!zero.miss && zero.moved === 0 && zero.far === 0, `Strength 0 at full pressure: the stroke moves no vertex (${zero.moved} moved, farthest ${zero.far})`);
    const unpressed = await stroke({ radius, strength: 5, pressure: 0 });
    t.ok(!unpressed.miss && unpressed.moved === 0, `and neither does 5 cm at no pressure (${unpressed.moved} moved)`);

    // One stroke at the defaults builds about the Strength.
    t.ok(Math.abs(full.lineMean / 1.5 - 1) < 0.2, `one full-pressure stroke raises its centre line ${full.lineMean.toFixed(3)} cm for a strength of 1.5 cm (rate ${full.rate.toFixed(3)})`);
    t.ok(full.lineMax - full.lineMin < 0.1 * full.lineMean, `evenly along it (${full.lineMin.toFixed(3)} to ${full.lineMax.toFixed(3)} cm)`);
    const big = await stroke({ radius: radius * 2, lenRadii: 1.5 });
    t.ok(!big.miss && Math.abs(big.lineMean / 1.5 - 1) < 0.25, `and about as much with a brush twice the size (${big.lineMean.toFixed(3)} cm, a ${big.r.toFixed(2)} cm brush)`);
    const low = await stroke({ radius, strength: 0.5 });
    t.ok(Math.abs(low.lineMean / 0.5 - 1) < 0.2, `a strength of 0.5 cm builds ${low.lineMean.toFixed(3)} cm`);
    // Past the rate's cap the build stops at about 0.65 of the radius,
    // and stays even: 1.5 cm asked of a brush half the size, and 5 cm.
    const small = await stroke({ radius: radius / 2 });
    const smallMore = await stroke({ radius: radius / 2, strength: 5 });
    t.ok(
      !small.miss && small.rate === 0.5 && small.lineMean > 0.5 * small.r && small.lineMean < 0.8 * small.r && small.lineMax - small.lineMin < 0.1 * small.lineMean,
      `a strength past the cap builds what the brush can lay, evenly: ${small.lineMean.toFixed(3)} cm (${small.lineMin.toFixed(3)} to ${small.lineMax.toFixed(3)}) with a ${small.r.toFixed(2)} cm brush, rate ${small.rate}`,
    );
    t.ok(Math.abs(smallMore.lineMean / small.lineMean - 1) < 0.02, `and no more at 5 cm (${smallMore.lineMean.toFixed(3)} cm)`);

    // The rate follows pressure: a lighter press builds in proportion.
    const again = await stroke({ radius });
    const half = await stroke({ radius, pressure: 0.5 });
    const quarter = await stroke({ radius, pressure: 0.25 });
    t.ok(Math.abs(again.lineMean / full.lineMean - 1) < 0.02, `the same stroke again builds the same (${again.lineMean.toFixed(3)} cm): nothing is left over from the strokes before`);
    t.ok(Math.abs(half.lineMean / full.lineMean - 0.5) < 0.05, `half the press builds half as much (${half.lineMean.toFixed(3)} against ${full.lineMean.toFixed(3)} cm)`);
    t.ok(Math.abs(quarter.lineMean / full.lineMean - 0.25) < 0.05, `and a quarter a quarter (${quarter.lineMean.toFixed(3)} cm)`);
    t.ok(Math.abs(half.rate / full.rate - 0.5) < 0.01 && Math.abs(quarter.rate / full.rate - 0.25) < 0.01, `by the dab's rate (${quarter.rate.toFixed(4)}, ${half.rate.toFixed(4)}, ${full.rate.toFixed(4)})`);
    const mouse = await stroke({ radius, pen: false, pressure: 0.5 });
    t.ok(Math.abs(mouse.lineMean / full.lineMean - 1) < 0.02 && Math.abs(mouse.rate / full.rate - 1) < 0.01, `a mouse is a full press (${mouse.lineMean.toFixed(3)} cm)`);

    // What moves, moves along the sphere's normals. A light build stays
    // within the angle the brush's own flat footprint makes with the
    // sphere; a full one leans a little more, forward onto its own build,
    // as upstream's does.
    t.ok(quarter.angle < 10 && quarter.angle90 < 14, `a light stroke moves the surface along its normals: ${quarter.angle.toFixed(1)} degrees off on average, ${quarter.angle90.toFixed(1)} at the 90th percentile`);
    t.ok(full.angle < 20 && full.angle90 < 25, `a full one within ${full.angle.toFixed(1)} degrees on average, ${full.angle90.toFixed(1)} at the 90th percentile`);
    // Off the middle of the view, where the sphere turns away from the eye.
    const side = await stroke({ radius, offset: [2, 0], dir: [1, 1], lenRadii: 1.5 });
    t.ok(!side.miss && side.angle < 20 && Math.abs(side.lineMean / 1.5 - 1) < 0.2, `the same where the surface turns from the view: ${side.angle?.toFixed(1)} degrees off, ${side.lineMean?.toFixed(3)} cm built`);

    // Concave anatomy: down a head's philtrum, from under the nose to the
    // lip, with a 1 cm brush (the nose's base in its reach at the start).
    const head = await page.evaluate(async () => {
      const { session } = window.__sculpt;
      const m = await session.addBaseMesh('head-realistic');
      window.__clayMesh = m;
      const oc = window.__bozzetto.controls.controls;
      const mm = m.getMatrix();
      oc.target.set(mm[12], mm[13] + 1.3, mm[14] + 11);
      oc.object.position.set(mm[12], mm[13] + 1.3, mm[14] + 56);
      oc.update();
      oc.object.updateMatrixWorld(true);
      return { n: m.getNbVertices(), scale: m.getScale() };
    });
    await page.waitForTimeout(800);
    const philtrum = { from: [0, 2.2, 10.9], to: [0, 0.5, 11.1], radius: 1 };
    const lip0 = await page.evaluate(clayStroke, { ...philtrum, strength: 0 });
    t.ok(!lip0.miss && lip0.moved === 0, `down the philtrum of a head (${head.n} vertices) at Strength 0: nothing moves (${lip0.moved} moved)`);
    const lip = await page.evaluate(clayStroke, { ...philtrum, strength: 0.3 });
    const lipLight = await page.evaluate(clayStroke, { ...philtrum, strength: 0.3, pressure: 0.3 });
    t.ok(!lip.miss && lip.moved > 200 && Math.abs(lip.r - 1) < 0.05 && lip.far < 0.7, `at 0.3 cm with a ${lip.r?.toFixed(2)} cm brush: ${lip.moved} vertices moved, none farther than ${lip.far?.toFixed(3)} cm`);
    t.ok(lip.angle < 35 && lip.angle90 < 50, `the build follows the surface there: ${lip.angle?.toFixed(1)} degrees off its normals on average, ${lip.angle90?.toFixed(1)} at the 90th percentile`);
    t.ok(lipLight.lineMean < 0.5 * lip.lineMean && lipLight.lineMean > 0.2 * lip.lineMean && lipLight.far < lip.far, `and a 0.3 press builds about that share (${lipLight.lineMean?.toFixed(3)} against ${lip.lineMean?.toFixed(3)} cm along the line, farthest ${lipLight.far?.toFixed(3)} against ${lip.far?.toFixed(3)})`);
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
