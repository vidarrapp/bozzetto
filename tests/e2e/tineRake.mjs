// The tine rake (owner call, October 2026, replacing the stencil rake):
// N tines across the brush, perpendicular to the stroke, each carving a
// groove to a depth; Plateau levels what the tines leave; Taper
// fades the outer tines; Invert raises ridges; pressure scales the depth.
//
// tineRake, on the plane primitive at its finest level, flat (or rippled),
// with strokes driven through the live tool along the plane's x axis:
// - a stroke with N tines leaves N grooves (local minima across it), for
//   two tine counts;
// - depth follows pen pressure (half the press, half the groove), and a
//   mouse carves the full depth;
// - Invert raises ridges instead;
// - Plateau 1 levels a rippled surface between the tines onto the
//   plane, where 0 leaves the ripples;
// - Taper makes the outer grooves shallower than the inner ones;
// - the Tool panel: the presets set the knobs and the tine profile, a knob
//   moved after unlights the preset, and the rake's settings ride the
//   scene file.
import { openForInput, openPanel } from './smoke.mjs';

const RAKE = 13; // Enums.Tools.RAKE

/**
 * In the page: one rake stroke across the plane primitive (alone in reach,
 * flat or rippled first), through the live tool, at local radius `radius`
 * (cm), from x = -span to +span along y = 0. Returns the heights of the
 * column of vertices across the stroke at x = 0, the dab record and the
 * radius used.
 */
function rakeStroke({ preset, knobs = {}, pen = false, pressure = 0.5, ripple = 0, radius = 6, span = 9 }) {
  const { session, tablet, input } = window.__sculpt;
  const manager = session.getSculptManager();
  const tool = manager.getTool(13);
  manager.setToolIndex(13);
  let plane = session.getMeshes().find((m) => m.__rakePlane);
  if (!plane) {
    plane = session.addPrimitive('plane');
    plane.__rakePlane = true;
    for (const m of session.getMeshes()) if (m !== plane) m.getMatrix()[12] += 80;
  }
  session.setMesh(plane);
  const v = plane.getVertices();
  const n = plane.getNbVertices();
  for (let i = 0; i < n; i++) v[i * 3 + 2] = ripple ? ripple * Math.cos((2 * Math.PI * v[i * 3 + 1]) / 1.3) : 0;
  plane.updateGeometry();
  plane.updateBuffers?.();
  if (preset) tool.applyPreset(preset);
  tool.set(knobs);
  const m = plane.getMatrix();
  const screen = (p) => {
    const w = [0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]);
    return session.getCamera().project(w);
  };
  const symmetry = manager._symmetry;
  manager._symmetry = false;
  const d = input.dynamics.get(13);
  const dyn = { ...d };
  d.strength = 1;
  d.strengthCurve = 'linear';
  tablet.pressure = pressure;
  tablet.pen = pen;
  try {
    // The pixel radius that gives `radius` cm on the plane: probe once.
    const [x0, y0] = screen([-span, 0, 0]);
    const [x1, y1] = screen([span, 0, 0]);
    session._mouseX = x0;
    session._mouseY = y0;
    tool._radius = 60;
    if (!manager.start(false)) return { miss: true };
    const picking = session.getPicking();
    tool.makeStroke(x0 + 1, y0, picking, null);
    const probe = Math.sqrt(picking.getLocalRadius2());
    manager.end();
    session.getStateManager().cleanNoop();
    for (let i = 0; i < n; i++) v[i * 3 + 2] = ripple ? ripple * Math.cos((2 * Math.PI * v[i * 3 + 1]) / 1.3) : 0;
    plane.updateGeometry();
    tool._radius = (60 * radius) / probe;
    // The stroke: dabs at the brush's own spacing along the path.
    session._mouseX = x0;
    session._mouseY = y0;
    if (!manager.start(false)) return { miss: true };
    const hitPlane = picking.getMesh() === plane;
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (tool._spacing * tool._radius * session.getPixelRatio()));
    const dabs = [];
    for (let s = 1; s <= steps; s++) {
      const x = x0 + ((x1 - x0) * s) / steps;
      const y = y0 + ((y1 - y0) * s) / steps;
      session._mouseX = x;
      session._mouseY = y;
      tool.makeStroke(x, y, picking, null);
      if (tool.lastDab) dabs.push({ ...tool.lastDab, x: picking.getIntersectionPoint()[0], r: Math.sqrt(picking.getLocalRadius2()) });
    }
    const r = Math.sqrt(picking.getLocalRadius2());
    tool.updateRender();
    manager.end();
    session.getStateManager().cleanNoop();
    // The column at x = 0 (the plane's grid is axis-aligned).
    const col = [];
    for (let i = 0; i < n; i++) {
      if (Math.abs(v[i * 3]) < 0.14 && Math.abs(v[i * 3 + 1]) < r) col.push([v[i * 3 + 1], v[i * 3 + 2]]);
    }
    col.sort((a, b) => a[0] - b[0]);
    const mid = dabs[Math.floor(dabs.length / 2)];
    // The deepest groove any dab over the column aimed for (the radius,
    // and with it the depth, changes along the stroke with the view).
    const reach = Math.max(...dabs.filter((q) => Math.abs(q.x) < q.r).map((q) => q.depthLocal));
    return { hitPlane, r, col, dab: mid, first: dabs[0], count: dabs.length, reach };
  } finally {
    Object.assign(d, dyn);
    tablet.pressure = 0.5;
    tablet.pen = false;
    manager._symmetry = symmetry;
  }
}

/** Local minima below `floor` along a column of [y, z]. */
function grooves(col, floor) {
  const out = [];
  for (let i = 1; i < col.length - 1; i++) {
    const z = col[i][1];
    if (z < floor && z < col[i - 1][1] && z <= col[i + 1][1]) out.push(col[i]);
  }
  return out;
}

/** The deepest point of the column within `w` of y = `at`. */
const depthNear = (col, at, w) => Math.min(...col.filter(([y]) => Math.abs(y - at) <= w).map(([, z]) => z));

export const suites = {
  async tineRake(page, base, t) {
    await openForInput(page, base);

    // N tines, N grooves.
    for (const [tines, width] of [
      [4, 0.7],
      [6, 0.6],
    ]) {
      const s = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { tines, width, plateau: 0.5, taper: 0, invert: false } });
      t.ok(s.hitPlane && s.count > 20, `the ${tines}-tine stroke lands on the plane (${s.count} dabs, radius ${s.r?.toFixed(2)} cm)`);
      const g = grooves(s.col, -0.3 * s.dab.depthLocal);
      const want = Array.from({ length: tines }, (_, k) => ((k + 0.5) / tines) * 2 - 1);
      t.eq(g.length, tines, `${tines} tines leave ${tines} grooves across the stroke (at ${g.map(([y]) => (y / s.r).toFixed(2)).join(', ')} of the radius)`);
      t.ok(
        g.length === tines && g.every(([y], k) => Math.abs(Math.abs(y / s.r) - Math.abs(want[k])) < 0.12),
        `each where its tine is, (k + 0.5) / N * 2 - 1 across (${want.map((w) => w.toFixed(2)).join(', ')})`,
      );
      t.ok(
        Math.abs(Math.abs(s.dab.across[1]) - 1) < 0.05 && Math.abs(s.dab.along[0]) > 0.95 && s.first.directionFrom === 'press' && s.dab.directionFrom === 'previous-dab',
        `the tines lie across the stroke (across ${s.dab.across.map((x) => x.toFixed(2))}, the first dab aimed from the press)`,
      );
      if (tines === 4) {
        const deepest = Math.min(...s.col.map(([, z]) => z));
        t.ok(Math.abs(deepest + s.reach) < 0.05 * s.reach, `a mouse cuts the full depth, depth x radius (${deepest.toFixed(3)} for ${s.reach.toFixed(3)})`);
        t.ok(Math.max(...s.col.map(([, z]) => z)) < 1e-4, 'and raises nothing');
      }
    }

    // Depth follows pressure.
    const full = await page.evaluate(rakeStroke, { preset: 'coarse', pen: true, pressure: 1 });
    const half = await page.evaluate(rakeStroke, { preset: 'coarse', pen: true, pressure: 0.5 });
    const dFull = -Math.min(...full.col.map(([, z]) => z));
    const dHalf = -Math.min(...half.col.map(([, z]) => z));
    t.ok(full.dab.pressureTerm === 1 && half.dab.pressureTerm === 0.5, `the pen's pressure is the depth's term (${full.dab.pressureTerm}, ${half.dab.pressureTerm})`);
    t.ok(Math.abs(dHalf / dFull - 0.5) < 0.08, `half the press cuts half as deep (${dHalf.toFixed(3)} against ${dFull.toFixed(3)})`);

    // Invert raises ridges.
    const inv = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { invert: true } });
    const top = Math.max(...inv.col.map(([, z]) => z));
    const low = Math.min(...inv.col.map(([, z]) => z));
    t.ok(top > 0.8 * inv.dab.depthLocal && low > -1e-4, `Invert raises ridges instead (up to ${top.toFixed(3)}, nothing below ${low.toExponential(1)})`);
    const ridges = grooves(inv.col.map(([y, z]) => [y, -z]), -0.3 * inv.dab.depthLocal);
    t.eq(ridges.length, 4, 'four of them');

    // Plateau: a rippled surface, levelled between the tines or not.
    const between = (s) => {
      const tines = s.dab.tines;
      const half = (s.dab.width / tines) * s.r;
      const centres = Array.from({ length: tines }, (_, k) => (((k + 0.5) / tines) * 2 - 1) * s.r);
      const pts = s.col.filter(([y]) => Math.abs(y) < 0.85 * s.r && centres.every((c) => Math.abs(y - c) > half + 0.2));
      return { n: pts.length, max: Math.max(...pts.map(([, z]) => z)) };
    };
    const lvl0 = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { width: 0.4, plateau: 0 }, ripple: 0.15 });
    const lvl1 = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { width: 0.4, plateau: 1 }, ripple: 0.15 });
    const b0 = between(lvl0);
    const b1 = between(lvl1);
    t.ok(b0.n > 4 && b0.max > 0.1, `Plateau 0 leaves the ripples between the tines (${b0.n} vertices, up to ${b0.max.toFixed(3)})`);
    t.ok(b1.max < 0.25 * b0.max, `Plateau 1 levels them toward the plane (up to ${b1.max.toFixed(3)} against ${b0.max.toFixed(3)})`);
    // (The ripples' own troughs, below the plane, are not levelled: only
    // what stands proud is. The grooves go well below them.)
    t.eq(grooves(lvl1.col, -0.6 * lvl1.dab.depthLocal).length, 4, 'and the grooves are still cut');

    // Taper: the outer grooves shallower than the inner.
    const flat = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { taper: 0 } });
    const taper = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { taper: 1 } });
    const ratio = (s) => {
      const r = s.r;
      const inner = (depthNear(s.col, -0.25 * r, 0.3) + depthNear(s.col, 0.25 * r, 0.3)) / 2;
      const outer = (depthNear(s.col, -0.75 * r, 0.3) + depthNear(s.col, 0.75 * r, 0.3)) / 2;
      return outer / inner;
    };
    t.ok(ratio(flat) > 0.85, `without taper the outer grooves are as deep as the inner (${ratio(flat).toFixed(2)})`);
    t.ok(ratio(taper) < 0.5, `with Taper 1 they are much shallower (${ratio(taper).toFixed(2)} of the inner ones)`);

    // --- the Tool panel --------------------------------------------------------
    await page.keyboard.press('7');
    t.ok(await openPanel(page, 'Tool'), 'the Tool panel opens on the rake');
    const rows = await page.evaluate(() => {
      const p = document.querySelector('.panel--sculpt');
      return {
        captions: [...p.querySelectorAll('label.compact')].map((r) => r.firstElementChild?.textContent),
        presets: [...p.querySelectorAll('.sculpt-panel__presets button')].map((b) => b.textContent),
        on: p.querySelector('.sculpt-panel__presets .sculpt-panel__btn--on')?.textContent,
        invert: [...p.querySelectorAll('label.checkbox span')].some((s) => /Invert/.test(s.textContent)),
        curves: [...p.querySelectorAll('.sculpt-panel__curve-label')].map((l) => l.textContent),
        tinePresets: [...p.querySelectorAll('.curve-editor__preset')].map((b) => b.textContent),
      };
    });
    t.ok(
      ['Tines', 'Tine width', 'Depth', 'Plateau', 'Taper'].every((c) => rows.captions.includes(c)) && rows.invert && rows.curves.join() === 'Tine profile',
      `the rake's rows: ${rows.captions.join(', ')}, Invert, ${rows.curves.join()}`,
    );
    t.ok(rows.presets.join() === 'Fine,Comb,Coarse,Chisel,Scraper' && rows.tinePresets.join() === 'Round,V,Flat,Soft', `its presets (${rows.presets.join(', ')}) and the tine profiles (${rows.tinePresets.join(', ')})`);
    const pick = async (label) => {
      await page.evaluate((l) => [...document.querySelectorAll('.panel--sculpt .sculpt-panel__presets button')].find((b) => b.textContent === l).scrollIntoView({ block: 'center' }), label);
      const box = await page.evaluate((l) => {
        const r = [...document.querySelectorAll('.panel--sculpt .sculpt-panel__presets button')].find((b) => b.textContent === l).getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      }, label);
      await page.mouse.click(...box);
      return page.evaluate(() => {
        const tool = window.__sculpt.session.getSculptManager().getTool(13);
        const tines = [...document.querySelectorAll('.panel--sculpt label.compact')].find((r) => r.firstElementChild?.textContent === 'Tines')?.querySelector('input');
        return { ...tool.settings(), curve: tool.curve.presetId, preset: tool.presetId, slider: Number(tines?.value), lit: document.querySelector('.panel--sculpt .sculpt-panel__presets .sculpt-panel__btn--on')?.textContent };
      });
    };
    const fine = await pick('Fine');
    t.ok(fine.tines === 8 && fine.curve === 'v' && fine.preset === 'fine' && fine.slider === 8 && fine.lit === 'Fine', `Fine: 8 thin V tines, the slider and the lit button with it (${JSON.stringify(fine)})`);
    const scraper = await pick('Scraper');
    t.ok(scraper.tines === 5 && scraper.curve === 'flat' && scraper.plateau === 1, `Scraper: 5 flat tines, Plateau 1 (${JSON.stringify(scraper)})`);
    const chisel = await pick('Chisel');
    t.ok(chisel.tines === 3 && chisel.curve === 'flat', `Chisel: 3 flat tines (${JSON.stringify(chisel)})`);
    // A knob moved after: the preset unlights, the value holds.
    const moved = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.panel--sculpt label.compact')].find((r) => r.firstElementChild?.textContent === 'Taper');
      const input = row.querySelector('input[type=range]');
      input.value = '0.4';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const tool = window.__sculpt.session.getSculptManager().getTool(13);
      return { taper: tool.taper, preset: tool.presetId, lit: document.querySelectorAll('.panel--sculpt .sculpt-panel__presets .sculpt-panel__btn--on').length };
    });
    t.ok(moved.taper === 0.4 && moved.preset === null && moved.lit === 0, `a knob moved after a preset keeps its value and unlights the preset (${JSON.stringify(moved)})`);

    // The rake's settings ride the scene file.
    const back = await page.evaluate(async () => {
      const { file } = window.__sculpt;
      const tool = window.__sculpt.session.getSculptManager().getTool(13);
      tool.curve.applyPreset('soft');
      const bytes = await file.pack();
      tool.applyPreset('comb');
      await file.open(bytes);
      return { ...tool.settings(), curve: tool.curve.presetId, preset: tool.presetId };
    });
    t.ok(back.tines === 3 && back.taper === 0.4 && back.curve === 'soft' && back.preset === null, `the knobs and the tine profile come back with the scene (${JSON.stringify(back)})`);
  },
};
