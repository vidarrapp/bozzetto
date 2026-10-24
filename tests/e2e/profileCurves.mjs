// Profile curves (owner call, October 2026): the brushes' falloffs as
// drawn curves, replacing the brush alphas and the plateau, profile and
// hardness sliders.
//
// profileCurves:
// - the curve: a monotone cubic through its points that never leaves
//   [0, 1] or overshoots a point, for random point sets;
// - the defaults are what the brushes did before: each default preset's
//   table and per-vertex weight is the old closed form, bit for bit (the
//   parity fixtures check whole strokes: scripts/parity-fixtures.mjs
//   --verify --outputs);
// - the editor in the Tool panel: a tap adds a point (mouse and finger),
//   a drag moves one (mouse and pen), the end points move up and down
//   only, a point dragged out of the box shows "will remove" and goes on
//   release, an end point dragged out stays, the arrow keys move a focused
//   point, and the presets apply;
// - a curve rides the scene file and comes back; a scene without curves
//   (or one still carrying brush alphas) opens on the default presets;
// - the alphas are gone: no stencil served, none registered, no Alpha row.
import { devices, openForInput, openPanel } from './smoke.mjs';

/** The plot's geometry: client px for a (t, v) on the curve (CurveEditor: viewBox -7..107). */
const plotAt = (page, nth = 0) =>
  page.evaluate((k) => {
    const plot = document.querySelectorAll('.panel--sculpt .curve-editor__plot')[k];
    if (!plot) return null;
    plot.scrollIntoView({ block: 'center' });
    const r = plot.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }, nth);
const PAD = 7;
const SPAN = 114;
const at = (r, t, v) => [r.left + ((t * 100 + PAD) / SPAN) * r.width, r.top + ((100 - v * 100 + PAD) / SPAN) * r.height];

/** The active tool's curve: its points and preset. */
const curveOf = (page, tool) =>
  page.evaluate((idx) => {
    const c = window.__sculpt.input.toolCurve(idx);
    return c && { points: c.serialize(), preset: c.presetId };
  }, tool);

// Enums.Tools.
const CLAY = 0;
const TWIST = 2;
const CREASE = 6;
const PAINT = 8;

export const suites = {
  async profileCurves(page, base, t) {
    await openForInput(page, base);

    // --- the curve itself -------------------------------------------------
    const maths = await page.evaluate(() => {
      const proto = window.__sculpt.input.toolCurve(0);
      const Curve = proto.constructor;
      // A seeded generator: the same sets every run.
      let seed = 12345;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      let worst = 0;
      let overshoot = 0;
      let nonMonotone = 0;
      let lutGap = 0;
      for (let set = 0; set < 200; set++) {
        const c = new Curve(proto.presets, proto.defaultPreset);
        const n = 2 + Math.floor(rnd() * 8);
        const pts = [{ t: 0, v: rnd() }, { t: 1, v: rnd() }];
        for (let i = 2; i < n; i++) pts.push({ t: 0.02 + rnd() * 0.96, v: rnd() });
        // Every third set monotone falling, as a falloff usually is.
        if (set % 3 === 0) {
          pts.sort((a, b) => a.t - b.t);
          const vs = pts.map((p) => p.v).sort((a, b) => b - a);
          pts.forEach((p, i) => (p.v = vs[i]));
        }
        c.setPoints(pts);
        const P = c.points;
        for (let k = 0; k < P.length - 1; k++) {
          const lo = Math.min(P[k].v, P[k + 1].v);
          const hi = Math.max(P[k].v, P[k + 1].v);
          let prev = null;
          const falling = P[k + 1].v <= P[k].v;
          for (let s = 0; s <= 50; s++) {
            const x = P[k].t + ((P[k + 1].t - P[k].t) * s) / 50;
            const y = c.evaluate(x);
            if (y < -1e-12 || y > 1 + 1e-12) worst = Math.max(worst, Math.abs(y - Math.min(1, Math.max(0, y))));
            if (y < lo - 1e-9 || y > hi + 1e-9) overshoot++;
            if (prev !== null && (falling ? y > prev + 1e-12 : y < prev - 1e-12)) nonMonotone++;
            prev = y;
          }
        }
        // The table holds the curve at its nodes; between them a loop reads it linearly.
        for (let i = 0; i < 256; i++) lutGap = Math.max(lutGap, Math.abs(c.lut[i] - c.evaluate(i / 255)), Math.abs(c.sample(i / 255) - c.lut[i]));
      }
      // Validation: what a stored curve may be.
      const c = new Curve(proto.presets, proto.defaultPreset);
      const bad = [
        c.load('x'),
        c.load([[0, 1]]),
        c.load([[0, 1], [1, NaN]]),
        c.load(Array.from({ length: 17 }, (_, i) => [i / 16, 1])),
        c.load([[0, 1], 'no']),
      ];
      const clamped = c.load([[1, -2], [0.5, 0.5], [0.2, 7], [0, 1]]) && c.serialize();
      return { worst, overshoot, nonMonotone, lutGap, bad, clamped };
    });
    t.ok(maths.worst === 0, `200 random curves never leave [0, 1] (worst ${maths.worst})`);
    t.ok(maths.overshoot === 0, `and never overshoot between two points (${maths.overshoot} samples out of their segment's range)`);
    t.ok(maths.nonMonotone === 0, `each segment runs one way, as its two points do (${maths.nonMonotone} reversals)`);
    t.ok(maths.lutGap < 1e-12, `the baked table the brushes read holds the curve at its 256 nodes (max gap ${maths.lutGap.toExponential(2)})`);
    t.ok(maths.bad.every((b) => b === false), `a stored curve that is not 2-16 finite [t, v] pairs is refused (${maths.bad.join(', ')})`);
    t.ok(
      JSON.stringify(maths.clamped) === JSON.stringify([[0, 1], [0.2, 1], [0.5, 0.5], [1, 0]]),
      `one with values out of range is clamped and sorted, its ends pinned to 0 and 1 (${JSON.stringify(maths.clamped)})`,
    );

    // --- the defaults are the old falloffs, exactly ------------------------
    const defaults = await page.evaluate(([clay, crease, twist, paint]) => {
      const input = window.__sculpt.input;
      const q = (d) => {
        let f = d * d;
        f = 3.0 * f * f - 4.0 * f * d + 1.0;
        return f;
      };
      const plateau = (p) => (d) => (d <= p ? 1.0 : q((d - p) / (1.0 - p)));
      const old = {
        [clay]: plateau(0.8),
        [crease]: (d) => Math.pow(q(d), 12),
        [twist]: plateau(0.35),
        [paint]: (d) => Math.pow(1 - d, 2 * (1 - 0.75)),
      };
      const out = {};
      for (const [idx, f] of Object.entries(old)) {
        const c = input.toolCurve(Number(idx));
        let diff = 0;
        for (let i = 0; i <= 1000; i++) diff = Math.max(diff, Math.abs(c.sample(i / 1000) - f(i / 1000)));
        out[idx] = { preset: c.presetId, isDefault: c.isDefault(), diff };
      }
      // Enums.Tools.PAINT_BLUR 14: shift's blur reads Paint's own curve.
      out.blurShares = window.__sculpt.session.getSculptManager().getTool(14)?.curve === input.toolCurve(paint);
      return out;
    }, [CLAY, CREASE, TWIST, PAINT]);
    for (const [idx, name, preset] of [
      [CLAY, 'clay', 'plateau'],
      [CREASE, 'crease', 'sharp'],
      [TWIST, 'polish', 'default'],
      [PAINT, 'paint', 'default'],
    ]) {
      const d = defaults[idx];
      t.ok(d.preset === preset && d.isDefault && d.diff === 0, `${name} starts on ${preset}, the old falloff to the bit (${JSON.stringify(d)})`);
    }
    t.ok(defaults.blurShares, "Paint's blur reads Paint's own curve");

    // --- the editor ----------------------------------------------------------
    await page.keyboard.press('3'); // clay
    t.ok(await openPanel(page, 'Tool'), 'the Tool panel opens');
    const ui = await page.evaluate(() => {
      const p = document.querySelector('.panel--sculpt');
      const captions = [...p.querySelectorAll('label.compact')].map((r) => r.firstElementChild?.textContent);
      const plot = p.querySelector('.curve-editor__plot');
      return {
        editors: p.querySelectorAll('.curve-editor').length,
        presets: [...p.querySelectorAll('.curve-editor__preset')].map((b) => b.textContent),
        on: p.querySelector('.curve-editor__preset.sculpt-panel__btn--on')?.textContent,
        touchAction: plot && getComputedStyle(plot).touchAction,
        callout: plot && getComputedStyle(plot).webkitTouchCallout,
        plateauRow: captions.includes('Strip plateau'),
        layerRow: captions.includes('Strip layer'),
        alphaRow: [...p.querySelectorAll('.label-row > span')].some((s) => s.textContent === 'Alpha') || !!p.querySelector('.matcap-grid--alpha'),
        points: p.querySelectorAll('.curve-editor__point').length,
      };
    });
    t.ok(ui.editors === 1 && ui.presets.join() === 'Plateau,Soft,Flat,Round' && ui.on === 'Plateau', `clay shows one curve with its presets, Plateau lit (${JSON.stringify(ui.presets)}, on ${ui.on})`);
    t.ok(!ui.plateauRow && ui.layerRow && !ui.alphaRow, `the Strip plateau slider and the Alpha row are gone, Strip layer stays (${JSON.stringify(ui)})`);
    t.ok(ui.touchAction === 'none', `the plot takes its touches (touch-action ${ui.touchAction})`);

    // A preset applies.
    await page.click('.panel--sculpt .curve-editor__preset[data-preset="soft"]');
    let c = await curveOf(page, CLAY);
    t.ok(c.preset === 'soft' && c.points.length === 11, `the Soft preset sets the curve (${c.preset}, ${c.points.length} points)`);
    await page.click('.panel--sculpt .curve-editor__preset[data-preset="flat"]');
    c = await curveOf(page, CLAY);
    t.ok(c.preset === 'flat' && JSON.stringify(c.points) === '[[0,1],[1,1]]', `Flat is a hard edge, two points (${JSON.stringify(c.points)})`);

    // A click on empty plot adds a point there.
    let r = await plotAt(page);
    await page.mouse.click(...at(r, 0.5, 0.4));
    c = await curveOf(page, CLAY);
    const added = c.points.find((p) => Math.abs(p[0] - 0.5) < 0.03);
    t.ok(c.points.length === 3 && added && Math.abs(added[1] - 0.4) < 0.03 && c.preset === null, `a click adds a point where it lands (${JSON.stringify(c.points)})`);

    // A drag moves it.
    r = await plotAt(page);
    await page.mouse.move(...at(r, added[0], added[1]));
    await page.mouse.down();
    await page.mouse.move(...at(r, 0.6, 0.7), { steps: 5 });
    await page.mouse.up();
    c = await curveOf(page, CLAY);
    const moved = c.points[1];
    t.ok(c.points.length === 3 && Math.abs(moved[0] - 0.6) < 0.03 && Math.abs(moved[1] - 0.7) < 0.03, `a drag moves it (${JSON.stringify(moved)})`);

    // The centre end point moves up and down only.
    await page.mouse.move(...at(r, 0, 1));
    await page.mouse.down();
    await page.mouse.move(...at(r, 0.3, 0.8), { steps: 5 });
    await page.mouse.up();
    c = await curveOf(page, CLAY);
    t.ok(c.points[0][0] === 0 && Math.abs(c.points[0][1] - 0.8) < 0.03 && c.points.length === 3, `the centre point stays at the centre and moves down (${JSON.stringify(c.points[0])})`);
    // Dragged out of the box, an end point stays.
    await page.mouse.move(...at(r, 1, 1));
    await page.mouse.down();
    await page.mouse.move(r.left + r.width + 60, r.top + r.height / 2, { steps: 5 });
    await page.mouse.up();
    c = await curveOf(page, CLAY);
    t.ok(c.points.length === 3 && c.points[2][0] === 1, `an edge point dragged out of the box is not removed (${JSON.stringify(c.points)})`);

    // An interior point dragged out shows "will remove", and goes on release.
    const p1 = c.points[1];
    await page.mouse.move(...at(r, p1[0], p1[1]));
    await page.mouse.down();
    await page.mouse.move(r.left + r.width / 2, r.top - 60, { steps: 6 });
    const outside = await page.evaluate(() => ({
      marked: document.querySelectorAll('.panel--sculpt .curve-editor__point--remove').length,
      root: document.querySelector('.panel--sculpt .curve-editor').classList.contains('curve-editor--removing'),
      live: window.__sculpt.input.toolCurve(0).points.length,
    }));
    t.ok(outside.marked === 1 && outside.root && outside.live === 2, `outside the box it shows as "will remove", the curve drawn without it (${JSON.stringify(outside)})`);
    await page.mouse.up();
    c = await curveOf(page, CLAY);
    t.ok(c.points.length === 2, `and it goes on release (${JSON.stringify(c.points)})`);
    // Two points left: an end point dragged out still stays.
    await page.mouse.move(...at(r, 1, c.points[1][1]));
    await page.mouse.down();
    await page.mouse.move(r.left + r.width / 2, r.top + r.height + 60, { steps: 5 });
    await page.mouse.up();
    c = await curveOf(page, CLAY);
    t.ok(c.points.length === 2, `a curve keeps its two end points (${JSON.stringify(c.points)})`);

    // The keyboard: a focused point moves with the arrows.
    await page.mouse.click(...at(r, 0.4, 0.5));
    const before = (await curveOf(page, CLAY)).points;
    const kIndex = before.findIndex((p) => Math.abs(p[0] - 0.4) < 0.03);
    const focused = await page.evaluate(() => document.activeElement?.classList.contains('curve-editor__point'));
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowRight');
    const after = (await curveOf(page, CLAY)).points;
    t.ok(
      focused && Math.abs(after[kIndex][1] - (before[kIndex][1] + 0.01)) < 1e-9 && Math.abs(after[kIndex][0] - (before[kIndex][0] + 0.01)) < 1e-9,
      `the added point has the focus and the arrows move it by a hundredth (${JSON.stringify(before[kIndex])} to ${JSON.stringify(after[kIndex])})`,
    );
    const toolStill = await page.evaluate(() => window.__sculpt.input.currentToolIndex());
    t.eq(toolStill, CLAY, 'and the keys stayed with the editor (still on clay)');

    // A pen drag moves a point, a finger tap adds one.
    const dev = await devices(page);
    r = await plotAt(page);
    const pk = after[kIndex];
    await dev.penDrag([at(r, pk[0], pk[1]), at(r, pk[0], 0.6), at(r, pk[0], 0.25)]);
    c = await curveOf(page, CLAY);
    t.ok(Math.abs(c.points[kIndex][1] - 0.25) < 0.03, `a pen drags a point (${JSON.stringify(c.points[kIndex])})`);
    const n0 = c.points.length;
    await dev.tap(at(r, 0.75, 0.6));
    c = await curveOf(page, CLAY);
    t.ok(c.points.length === n0 + 1 && c.points.some((p) => Math.abs(p[0] - 0.75) < 0.03), `a finger tap adds a point (${c.points.length} points)`);

    // --- persistence ---------------------------------------------------------
    const edited = c.points;
    const back = await page.evaluate(async () => {
      const { file, input } = window.__sculpt;
      const bytes = await file.pack();
      const rec = await file.unpack(bytes.slice(0));
      input.toolCurve(0).reset();
      input.toolCurve(6).applyPreset('soft');
      await file.open(bytes);
      return { saved: rec.settings?.curves?.[0], rev: rec.settings?.curvesRev, clay: input.toolCurve(0).serialize(), crease: input.toolCurve(6).presetId };
    });
    t.ok(JSON.stringify(back.saved) === JSON.stringify(edited) && back.rev === 1, `the scene file records the curve (${JSON.stringify(back.saved)?.slice(0, 80)})`);
    t.ok(JSON.stringify(back.clay) === JSON.stringify(edited), `and opening it brings the edited curve back (${back.clay.length} points)`);
    t.eq(back.crease, 'sharp', 'and the crease its saved default');

    // A scene from before the curves, still carrying brush alphas: it opens,
    // every curve on its default.
    const legacy = await page.evaluate(async () => {
      const { file, input } = window.__sculpt;
      const rec = await file.unpack(await file.pack());
      delete rec.settings.curves;
      delete rec.settings.curvesRev;
      rec.settings.alphas = { 0: 'clay01', 13: 'rake06' };
      rec.settings.rakeAlpha = 'rake06';
      await file.open(await file.packRecord(rec));
      return [0, 6, 2, 8, 13].map((i) => input.toolCurve(i).isDefault());
    });
    t.ok(legacy.every(Boolean), `a scene with no curves and old alpha ids opens with every brush on its default curve (${legacy.join(', ')})`);

    // --- the alphas are gone ---------------------------------------------------
    const gone = await page.evaluate(async () => {
      const a = await fetch('/assets/alphas/rake06.png');
      const ctype = a.headers.get('content-type') || '';
      const Picking = window.__sculpt.session.getPicking().constructor;
      return { status: a.status, image: /image/.test(ctype), registered: Object.values(Picking.ALPHAS || {}).filter(Boolean).length, setter: typeof window.__sculpt.input.setToolAlpha };
    });
    t.ok(!gone.image && gone.registered === 0 && gone.setter === 'undefined', `no stencil is served or registered, and the alpha setter is gone (${JSON.stringify(gone)})`);
  },
};
