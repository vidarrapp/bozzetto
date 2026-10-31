// Strength in centimetres (owner call, 2026-10-31). For the brushes that
// push the surface - Clay, Inflate, Crease and the Rake - Strength is how
// far one full-pressure stroke at the default spacing moves the surface at
// the brush centre, whatever the brush's size: 0 to 5 cm on the sliders,
// up to 50 cm typed. The capped brushes (Smooth, Flatten, Polish, Pinch,
// Paint, Mask) and Move keep 0 to 1; Drag has none.
//
// strengthCm:
// - the Strength row and the rail per brush: 0..5 cm in hundredths for
//   the four, 0..1 in hundredths for the rest, none for Drag; the rail's
//   top is 5 cm and its bubble says cm, or percent for a capped brush; the
//   ; and ' keys step 0.05 cm, or 0.03 of 1;
// - a full-pressure pen stroke on the plane at the default spacing moves
//   the centre by the strength within 15% for Clay, Inflate, Crease (its
//   crest) and the Rake (its deepest groove), at a 3 cm and a 6 cm brush,
//   and half the press about half as far; a mouse is a full press;
// - the Rake has no Depth row and its presets set the strength; Clay has
//   no Strip layer row;
// - the capped brushes keep their 0..1 defaults and their cap;
// - strengths ride the scene; a table saved without strengthRev holds
//   0..1 fractions and converts to cm at the default size, held to the
//   travel, never absurd; a later revision is left alone;
// - the strength indicator, in the brush cursor: hidden while hovering,
//   up while the strength is adjusted (the ' key, s held, the rail
//   dragged) and gone a moment after; on the surface a line along the
//   normal as long as the stroke pushes at the current pressure (a pen at
//   half pressure: half), with the value beside it; a capped brush shows
//   its percentage alone, no line.
import { openForInput, openPanel, sliderRow } from './smoke.mjs';

const CLAY = 0;
const INFLATE = 1;
const CREASE = 6;
const RAKE = 13;

/**
 * In the page: one stroke with tool `tool` through the live tool, on the
 * plane primitive at its finest level (alone in reach, flat), along its x
 * axis from -span to +span brush radii through y = 0, at local radius
 * `radius` cm (the plane is at scale 1), dabs at the brush's own spacing.
 * `pen` and `pressure` are what InputShell would feed the Tablet. Returns
 * the column across the stroke at x = 0: the highest rise and the deepest
 * cut within half a radius of the line, and the dab radius used.
 */
function cmStroke({ tool: idx, radius = 3, span = 3, pen = false, pressure = 0.5, setup = false }) {
  const { session, tablet, input } = window.__sculpt;
  const manager = session.getSculptManager();
  const tool = manager.getTool(idx);
  manager.setToolIndex(idx);
  let mesh = session.getMeshes().find((m) => m.__cmPlane);
  if (!mesh) {
    mesh = session.addPrimitive('plane');
    mesh.__cmPlane = true;
    for (const m of session.getMeshes()) if (m !== mesh) m.getMatrix()[12] += 80;
    mesh.__rest = new Float32Array(mesh.getVertices().subarray(0, mesh.getNbVertices() * 3));
  }
  if (setup) return { setup: true };
  session.setMesh(mesh);
  const v = mesh.getVertices();
  const n = mesh.getNbVertices();
  const rest = mesh.__rest;
  const reset = () => {
    v.set(rest);
    mesh.updateGeometry();
    mesh.updateBuffers?.();
  };
  reset();
  const m = mesh.getMatrix();
  const screen = (p) => session.getCamera().project([0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]));
  const local = radius / mesh.getScale();
  const symmetry = manager._symmetry;
  manager._symmetry = false;
  const d = input.dynamics.get(idx);
  const dyn = { ...d };
  // Pressure on the strength alone (Crease's size follows it too by
  // default): the brush is the size asked at every press.
  d.size = 0;
  d.strength = 1;
  d.strengthCurve = 'linear';
  try {
    const [x0, y0] = screen([-span * local, 0, 0]);
    const [x1, y1] = screen([span * local, 0, 0]);
    // The pixel radius that gives `local` on the plane: probe once.
    session._mouseX = x0;
    session._mouseY = y0;
    tool._radius = 60;
    tablet.pressure = 0.5;
    tablet.pen = false;
    if (!manager.start(false)) return { miss: true };
    const picking = session.getPicking();
    tool.makeStroke(x0 + 1, y0, picking, null);
    const probe = Math.sqrt(picking.getLocalRadius2());
    manager.end();
    session.getStateManager().cleanNoop();
    reset();
    tool._radius = (60 * local) / probe;
    tablet.pressure = pressure;
    tablet.pen = pen;
    session._mouseX = x0;
    session._mouseY = y0;
    if (!manager.start(false)) return { miss: true };
    const hit = picking.getMesh() === mesh;
    // As sculptStroke does: a dab every spacing x radius px.
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (tool._spacing * tool._radius * session.getPixelRatio()));
    const rs = [];
    for (let s = 1; s <= steps; s++) {
      const x = x0 + ((x1 - x0) * s) / steps;
      const y = y0 + ((y1 - y0) * s) / steps;
      session._mouseX = x;
      session._mouseY = y;
      tool.makeStroke(x, y, picking, null);
      rs.push(Math.sqrt(picking.getLocalRadius2()));
    }
    tool.updateRender();
    manager.end();
    session.getStateManager().cleanNoop();
    const r = rs[Math.floor(rs.length / 2)];
    let rise = 0;
    let cut = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(rest[i * 3]) >= 0.1 * r || Math.abs(rest[i * 3 + 1]) >= 0.5 * r) continue;
      const h = v[i * 3 + 2] - rest[i * 3 + 2];
      rise = Math.max(rise, h);
      cut = Math.min(cut, h);
    }
    const scale = mesh.getScale();
    return { hit, r: r * scale, rise: rise * scale, cut: -cut * scale, strength: tool._intensity, steps };
  } finally {
    Object.assign(d, dyn);
    tablet.pressure = 0.5;
    tablet.pen = false;
    manager._symmetry = symmetry;
    reset();
  }
}

/** In the page: the plane back at rest, its middle on the page and its normal. */
function planeMiddle() {
  const { session } = window.__sculpt;
  const mesh = session.getMeshes().find((m) => m.__cmPlane);
  mesh.getVertices().set(mesh.__rest);
  mesh.updateGeometry();
  mesh.updateBuffers?.();
  session.setMesh(mesh);
  const m = mesh.getMatrix();
  const [x, y] = session.getCamera().project([m[12], m[13], m[14]]);
  const rect = session.getCanvas().getBoundingClientRect();
  const pr = session.getPixelRatio();
  // The plane's normal in world space (its local z through the matrix).
  const nw = [m[8], m[9], m[10]];
  const l = Math.hypot(...nw);
  return { at: [rect.left + x / pr, rect.top + y / pr], normal: nw.map((c) => c / l) };
}

/** In the page: what the strength indicator shows, with the projection of its line's ends checked. */
function indicator() {
  const { cursor, input } = window.__sculpt;
  const p = cursor.strengthProbe;
  const root = document.querySelector('.sculpt-cursor');
  const line = root.querySelector('.sculpt-cursor__strength');
  const label = root.querySelector('.sculpt-cursor__strength-label');
  const out = {
    shown: p.shown,
    length: p.length,
    label: p.label,
    lineShown: line.style.display !== 'none' && root.style.display !== 'none',
    labelShown: label.style.display !== 'none' && root.style.display !== 'none',
    labelText: label.textContent,
    mode: root.dataset.mode,
    strength: input.getBrushIntensity(),
    normal: p.normal,
  };
  if (p.point && p.normal && p.length !== null && p.from && p.to) {
    // The line's ends against the projection of the point and of the
    // point plus the normal times the length (container px).
    const tip = p.point.map((c, k) => c + p.normal[k] * p.length);
    const a = cursor.projector(p.point);
    const b = cursor.projector(tip);
    out.endError = Math.max(Math.hypot(a[0] - p.from[0], a[1] - p.from[1]), Math.hypot(b[0] - p.to[0], b[1] - p.to[1]));
    out.attrError = Math.max(Math.abs(Number(line.getAttribute('x2')) - p.to[0]), Math.abs(Number(line.getAttribute('y2')) - p.to[1]));
    out.px = Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1]);
  }
  return out;
}

export const suites = {
  async strengthCm(page, base, t) {
    await openForInput(page, base);
    const near = (x, y) => Math.abs(x - y) < 1e-9;

    // --- the controls, per brush -------------------------------------------------
    t.ok(await openPanel(page, 'Tool'), 'the Tool panel opens');
    const brushes = [
      ['1', 'Crease', true],
      ['2', 'Move', false],
      ['3', 'Clay', true],
      ['4', 'Inflate', true],
      ['5', 'Pinch', false],
      ['6', 'Flatten', false],
      ['7', 'Rake', true],
      ['9', 'Polish', false],
      ['0', 'Paint', false],
    ];
    for (const [key, name, cm] of brushes) {
      await page.keyboard.press(key);
      const row = await sliderRow(page, 'Tool', 'Strength');
      const unit = await page.evaluate(() => {
        const r = [...document.querySelectorAll('.panel--sculpt label.compact')].find((l) => l.firstElementChild?.textContent === 'Strength');
        return { unit: r?.querySelector('input')?.dataset.unit ?? '', kind: r?.dataset.strength, spec: window.__sculpt.input.strengthSpec() };
      });
      if (cm) {
        t.ok(
          row && row.min === 0 && row.max === 5 && row.step === 0.01 && unit.unit === ' cm' && unit.kind === 'cm' && unit.spec.limit === 50 && unit.spec.keyStep === 0.05,
          `${name}: Strength runs 0 to 5 cm in hundredths (the keys 0.05 cm), 50 typed (${row?.min}..${row?.max} by ${row?.step}${unit.unit}, limit ${unit.spec.limit})`,
        );
      } else {
        t.ok(row && row.min === 0 && row.max === 1 && row.step === 0.01 && unit.unit === '' && unit.kind === 'fraction', `${name}: Strength stays 0 to 1 (${row?.min}..${row?.max} by ${row?.step})`);
      }
    }
    await page.keyboard.press('8');
    t.ok(!(await sliderRow(page, 'Tool', 'Strength')) || (await page.evaluate(() => !window.__sculpt.input.hasBrushIntensity())), 'Drag has no Strength row');

    // The rail: its top is 5 cm, the bubble says cm; a capped brush's, 100%.
    const railTop = async (key) => {
      await page.keyboard.press(key);
      const r = await page.evaluate(() => {
        const el = document.querySelector('.sculpt-slider[data-kind="strength"]');
        const b = el.getBoundingClientRect();
        return [b.left + b.width / 2, b.top - 10, b.top + b.height / 2];
      });
      const before = await page.evaluate(() => window.__sculpt.input.getBrushIntensity());
      await page.mouse.move(r[0], r[2]);
      await page.mouse.down();
      // The press sets the strength where it lands, and puts the indicator up.
      const shown = await page.evaluate(() => window.__sculpt.cursor.strengthProbe.shown);
      await page.mouse.move(r[0], r[1], { steps: 3 });
      const got = await page.evaluate(() => ({
        v: window.__sculpt.input.getBrushIntensity(),
        bubble: document.querySelector('.slider-bubble')?.textContent,
        nub: parseFloat(document.querySelector('.sculpt-slider[data-kind="strength"] .sculpt-slider__nub').style.bottom),
      }));
      got.shown = shown;
      await page.mouse.up();
      await page.evaluate((b) => window.__sculpt.input.setBrushIntensity(b), before);
      return got;
    };
    const clayRail = await railTop('3');
    t.ok(clayRail.v === 5 && clayRail.bubble === '5.00 cm' && clayRail.nub > 98, `Clay's rail runs to 5 cm and its bubble says cm (${clayRail.v}, "${clayRail.bubble}", nub ${clayRail.nub}%)`);
    t.ok(clayRail.shown, 'and dragging it puts up the strength indicator');
    const flatRail = await railTop('6');
    t.ok(flatRail.v === 1 && flatRail.bubble === '100%', `Flatten's runs to 1, its bubble in percent (${flatRail.v}, "${flatRail.bubble}")`);

    // The keys: 0.05 cm a press, 0.03 of 1 for a capped brush.
    const keyStep = async (key, press) => {
      await page.keyboard.press(key);
      const a = await page.evaluate(() => window.__sculpt.input.getBrushIntensity());
      await page.keyboard.press(press);
      const b = await page.evaluate(() => window.__sculpt.input.getBrushIntensity());
      await page.keyboard.press(press === "'" ? ';' : "'");
      return [a, b];
    };
    let [a, b] = await keyStep('3', "'");
    t.ok(a === 1.5 && Math.abs(b - 1.55) < 1e-9, `' steps Clay up 0.05 cm (${a} -> ${b})`);
    [a, b] = await keyStep('4', ';');
    t.ok(a === 0.5 && Math.abs(b - 0.45) < 1e-9, `; steps Inflate down 0.05 cm (${a} -> ${b})`);
    [a, b] = await keyStep('6', "'");
    t.ok(a === 0.75 && Math.abs(b - 0.78) < 1e-9, `' steps Flatten up 0.03 (${a} -> ${b})`);

    // --- one stroke moves the centre by the strength, at any size ----------------
    await page.evaluate(cmStroke, { tool: CLAY, setup: true });
    await page.waitForTimeout(800);
    const defaults = await page.evaluate(([c, i, k, r]) => [c, i, k, r].map((x) => window.__sculpt.session.getSculptManager().getTool(x)._intensity), [CLAY, INFLATE, CREASE, RAKE]);
    t.ok(defaults.join() === '1.5,0.5,0.75,0.3', `the defaults: Clay 1.5, Inflate 0.5, Crease 0.75, the Rake 0.3 cm (${defaults.join(', ')})`);
    for (const [name, tool, key] of [
      ['Clay', CLAY, 'rise'],
      ['Inflate', INFLATE, 'rise'],
      ['Crease', CREASE, 'rise'],
      ['Rake', RAKE, 'cut'],
    ]) {
      const got = [];
      for (const radius of [3, 6]) {
        const s = await page.evaluate(cmStroke, { tool, radius, pen: true, pressure: 1 });
        got.push(s);
        t.ok(s.hit && s.steps > 20 && Math.abs(s[key] / s.strength - 1) < 0.15, `${name}, ${s.r.toFixed(2)} cm brush: a full-pressure stroke moves the centre ${s[key].toFixed(3)} cm for a strength of ${s.strength} cm`);
      }
      t.ok(Math.abs(got[1][key] / got[0][key] - 1) < 0.15, `${name}: the same at twice the size (${got[0][key].toFixed(3)}, ${got[1][key].toFixed(3)})`);
      const half = await page.evaluate(cmStroke, { tool, radius: 3, pen: true, pressure: 0.5 });
      t.ok(Math.abs(half[key] / got[0][key] - 0.5) < 0.08, `${name}: half the press about half as far (${half[key].toFixed(3)} against ${got[0][key].toFixed(3)})`);
      const mouse = await page.evaluate(cmStroke, { tool, radius: 3 });
      t.ok(Math.abs(mouse[key] / got[0][key] - 1) < 0.05, `${name}: a mouse is a full press (${mouse[key].toFixed(3)} against ${got[0][key].toFixed(3)})`);
    }
    // A stronger strength, a deeper stroke.
    await page.evaluate(() => (window.__sculpt.session.getSculptManager().getTool(1)._intensity = 1.2));
    const inflate12 = await page.evaluate(cmStroke, { tool: INFLATE, radius: 4, pen: true, pressure: 1 });
    t.ok(Math.abs(inflate12.rise / 1.2 - 1) < 0.15, `Inflate at 1.2 cm pushes ${inflate12.rise.toFixed(3)} cm`);
    await page.evaluate(() => (window.__sculpt.session.getSculptManager().getTool(1)._intensity = 0.5));

    // --- the rows that went --------------------------------------------------------
    await page.keyboard.press('3');
    const clayRows = await page.evaluate(() => [...document.querySelectorAll('.panel--sculpt label.compact')].map((r) => r.firstElementChild?.textContent));
    t.ok(!clayRows.includes('Strip layer') && clayRows.includes('Strength'), `Clay has no Strip layer row, its Strength is the layer (${clayRows.join(', ')})`);
    await page.keyboard.press('7');
    const rake = await page.evaluate(() => {
      const captions = [...document.querySelectorAll('.panel--sculpt label.compact')].map((r) => r.firstElementChild?.textContent);
      const tool = window.__sculpt.session.getSculptManager().getTool(13);
      tool.applyPreset('fine');
      const fine = tool._intensity;
      tool.applyPreset('chisel');
      const chisel = tool._intensity;
      tool.applyPreset('coarse');
      return { captions, fine, chisel, coarse: tool._intensity, settings: tool.settings() };
    });
    t.ok(!rake.captions.includes('Depth') && rake.captions.includes('Strength'), `the Rake has no Depth row (${rake.captions.join(', ')})`);
    t.ok(rake.fine === 0.15 && rake.chisel === 0.25 && rake.coarse === 0.3 && !('depth' in rake.settings), `its presets set the strength in cm: Fine 0.15, Chisel 0.25, Coarse 0.3 (${rake.fine}, ${rake.chisel}, ${rake.coarse})`);

    // --- the capped brushes ----------------------------------------------------------
    const capped = await page.evaluate(() => {
      const { session, input } = window.__sculpt;
      const m = session.getSculptManager();
      const out = {};
      for (const [name, i] of [['smooth', 3], ['flatten', 4], ['pinch', 5], ['polish', 2], ['paint', 8], ['move', 9], ['mask', 10]]) {
        out[name] = { v: m.getTool(i)._intensity, cm: !!m.getTool(i).strengthUnit, spec: input.strengthSpec(i).max };
      }
      // The cap still holds: a strength past 1 is held to 1.
      m.setToolIndex(4);
      input.setBrushIntensity(1.7);
      out.held = input.getBrushIntensity();
      input.setBrushIntensity(0.75);
      return out;
    });
    t.ok(
      capped.smooth.v === 0.75 && capped.flatten.v === 0.75 && capped.pinch.v === 0.75 && capped.polish.v === 0.9 && capped.paint.v === 0.75 && capped.move.v === 0.25 && Object.values(capped).every((c) => typeof c !== 'object' || (!c.cm && c.spec === 1)),
      `the capped brushes and Move keep their 0..1 strengths and defaults (${JSON.stringify(capped)})`,
    );
    t.eq(capped.held, 1, 'and a capped strength is still held to 1');

    // --- the strength indicator --------------------------------------------------------
    await page.keyboard.press('3');
    const mid = await page.evaluate(planeMiddle, {});
    const hover = async () => {
      await page.mouse.move(mid.at[0] - 40, mid.at[1]);
      await page.mouse.move(mid.at[0], mid.at[1], { steps: 4 });
      await page.waitForTimeout(100);
    };
    await page.waitForTimeout(1200);
    await hover();
    let ind = await page.evaluate(indicator);
    t.ok(ind.mode === 'surface' && !ind.shown && !ind.lineShown && !ind.labelShown, `hovering the plane with Clay shows no strength indicator (mode ${ind.mode}, shown ${ind.shown})`);
    await page.keyboard.press("'");
    ind = await page.evaluate(indicator);
    t.ok(ind.shown && ind.lineShown && ind.labelShown && near(ind.length, 1.55) && ind.labelText === '1.55 cm', `the ' key puts it up: a line ${ind.length} cm tall, "${ind.labelText}" beside it`);
    t.ok(ind.endError < 0.6 && ind.attrError < 0.06 && ind.px > 5, `the line stands on the brush centre, its tip the strength along the normal, projected (ends off by ${ind.endError?.toFixed(3)} px, ${ind.px?.toFixed(1)} px long)`);
    t.ok(Math.abs(Math.abs(ind.normal[0] * mid.normal[0] + ind.normal[1] * mid.normal[1] + ind.normal[2] * mid.normal[2]) - 1) < 0.01, `along the surface's normal (${ind.normal.map((x) => x.toFixed(3)).join(', ')})`);
    await page.waitForTimeout(1200);
    ind = await page.evaluate(indicator);
    t.ok(!ind.shown && !ind.lineShown && !ind.labelShown, 'and it goes a moment after');

    // A pen at half pressure: half the line.
    ind = await page.evaluate(() => {
      const { tablet, input } = window.__sculpt;
      tablet.pen = true;
      tablet.pressure = 0.5;
      input.setBrushIntensity(1.5);
      input.refreshBrushCursor();
      const p = window.__sculpt.cursor.strengthProbe.length;
      tablet.pen = false;
      tablet.pressure = 0.5;
      input.refreshBrushCursor();
      return { half: p, full: window.__sculpt.cursor.strengthProbe.length };
    });
    t.ok(near(ind.half, 0.75) && near(ind.full, 1.5), `a pen pressed at half draws half the push (${ind.half} cm), a mouse the whole (${ind.full} cm)`);
    await page.waitForTimeout(1200);

    // s held: up while held, and a moment after.
    await hover();
    await page.keyboard.down('s');
    await page.waitForTimeout(1200);
    ind = await page.evaluate(indicator);
    t.ok(ind.shown && ind.lineShown && ind.labelText === '1.50 cm', `holding s keeps it up (${ind.labelText}, after 1.2 s)`);
    await page.keyboard.up('s');
    ind = await page.evaluate(indicator);
    const up = ind.shown;
    await page.waitForTimeout(1200);
    ind = await page.evaluate(indicator);
    t.ok(up && !ind.shown, `letting go of s leaves it a moment, then it goes (${up}, then ${ind.shown})`);

    // A capped brush: the percentage alone.
    await page.keyboard.press('6');
    await hover();
    await page.keyboard.press("'");
    ind = await page.evaluate(indicator);
    t.ok(ind.shown && !ind.lineShown && ind.labelShown && ind.length === null && ind.labelText === '78%', `a capped brush (Flatten) shows its percentage, no line ("${ind.labelText}", line ${ind.lineShown})`);
    await page.keyboard.press(';');
    await page.waitForTimeout(1200);
    // Drag: no strength, no indicator.
    await page.keyboard.press('8');
    await page.keyboard.press("'");
    ind = await page.evaluate(indicator);
    t.ok(!ind.shown && !ind.lineShown && !ind.labelShown, 'Drag, with no strength, shows none');

    // --- the scene record --------------------------------------------------------------
    const saved = await page.evaluate(async () => {
      const { file, session } = window.__sculpt;
      const m = session.getSculptManager();
      m.getTool(0)._intensity = 2.25;
      m.getTool(6)._intensity = 12;
      m.getTool(4)._intensity = 0.6;
      const bytes = await file.pack();
      const rec = await file.unpack(bytes);
      m.getTool(0)._intensity = 1.5;
      m.getTool(6)._intensity = 0.75;
      m.getTool(4)._intensity = 0.75;
      await file.open(bytes);
      return { rev: rec.settings.strengthRev, table: rec.settings.strength, clay: m.getTool(0)._intensity, crease: m.getTool(6)._intensity, flatten: m.getTool(4)._intensity };
    });
    t.ok(saved.rev === 1 && saved.table[0] === 2.25 && saved.table[6] === 12 && saved.table[4] === 0.6, `strengths are saved, in cm for the four and 0..1 for the rest, strengthRev 1 (${JSON.stringify(saved.table)})`);
    t.ok(saved.clay === 2.25 && saved.crease === 12 && saved.flatten === 0.6, `and come back with the scene (${saved.clay}, ${saved.crease}, ${saved.flatten})`);
    const legacy = await page.evaluate(async () => {
      const { file, session, input } = window.__sculpt;
      const m = session.getSculptManager();
      const open = async (strength, rev) => {
        const rec = await file.unpack(await file.pack());
        rec.settings.strength = strength;
        if (rev === undefined) delete rec.settings.strengthRev;
        else rec.settings.strengthRev = rev;
        await file.open(await file.packRecord(rec));
        return [0, 1, 6, 13, 4].map((i) => m.getTool(i)._intensity);
      };
      const fractions = await open({ 0: 0.25, 1: 0.3, 6: 1, 13: 0.6, 4: 0.5 });
      const absurd = await open({ 0: 40, 1: -3, 6: 0.0001 });
      const cm = await open({ 0: 70, 1: 0.8 }, 1);
      const later = await open({ 0: 0.1, 1: 0.1 }, 2);
      input.loadStrength({ 0: 1.5, 1: 0.5, 6: 0.75, 13: 0.3, 4: 0.75 }, 1);
      return { fractions, absurd, cm, later };
    });
    t.ok(
      near(legacy.fractions[0], 0.75) && near(legacy.fractions[1], 0.5) && near(legacy.fractions[2], 1.5) && near(legacy.fractions[3], 0.3) && near(legacy.fractions[4], 0.5),
      `a table without strengthRev holds fractions: Clay 0.25 -> 0.75 cm, Inflate 0.3 -> 0.5, Crease 1 -> 1.5, the Rake 0.6 -> 0.3, Flatten 0.5 stays (${legacy.fractions.join(', ')})`,
    );
    t.ok(legacy.absurd[0] <= 5 && legacy.absurd[0] > 0 && legacy.absurd[1] === 0 && legacy.absurd[2] < 0.01, `an old value out of range never comes back absurd: 40 -> ${legacy.absurd[0]} cm, -3 -> ${legacy.absurd[1]}, 0.0001 -> ${legacy.absurd[2]}`);
    t.ok(legacy.cm[0] === 50 && legacy.cm[1] === 0.8, `a strengthRev 1 table is cm, held to 50 (${legacy.cm.slice(0, 2).join(', ')})`);
    t.ok(legacy.later[0] === legacy.cm[0] && legacy.later[1] === legacy.cm[1], `a later revision is left alone (${legacy.later.slice(0, 2).join(', ')})`);
  },
};
