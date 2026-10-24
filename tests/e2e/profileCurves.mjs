// Profile curves (owner call, October 2026): the brushes' falloffs as
// drawn curves, replacing the brush alphas and the plateau, profile and
// hardness sliders; cubic Bezier anchors with handles since the owner's
// feedback the day after (the sampled point lists had too many points).
//
// profileCurves:
// - the curve: for random anchor sets the Bezier never leaves [0, 1], is a
//   function of t (every handle within its segment, the drawn curve never
//   turning back in t, the solved weight on the drawn curve), and the
//   baked table holds it; bad stored curves are refused, odd ones mended;
// - the presets: 2 to 4 anchors each, close to their kernels; the defaults
//   are what the brushes did before: each default preset's per-vertex
//   weight is the old closed form, bit for bit (the parity fixtures check
//   whole strokes: scripts/parity-fixtures.mjs --verify --outputs);
// - the editor in the Tool panel: a click adds an anchor with smooth
//   handles (mouse and finger), a drag moves an anchor and its handles
//   (mouse and pen), a handle drag turns its twin on a smooth anchor and
//   not on a corner, a double click (and a double tap) toggles the corner,
//   the end anchors move up and down only, an anchor dragged out of the
//   box shows "will remove" and goes on release, an end anchor dragged out
//   stays, the arrow keys move a focused anchor and Delete removes it, and
//   the presets apply;
// - a curvesRev 1 point list converts: a preset's sampled points to that
//   preset, any other to at most six anchors that follow it;
// - a curve rides the scene file (curvesRev 2) and comes back; a scene
//   without curves (or one still carrying brush alphas) opens on the
//   default presets;
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

/** A tool's curve: its anchors (as stored) and preset. */
const curveOf = (page, tool) =>
  page.evaluate((idx) => {
    const c = window.__sculpt.input.toolCurve(idx);
    return c && { anchors: c.serialize().anchors, preset: c.presetId };
  }, tool);

/** The cross product of a smooth anchor's two handle directions (0 when aligned) and their lengths. */
const handleGeom = (a) => {
  const di = [a.in[0] - a.t, a.in[1] - a.v];
  const dout = [a.out[0] - a.t, a.out[1] - a.v];
  const li = Math.hypot(...di);
  const lo = Math.hypot(...dout);
  return { cross: li && lo ? (di[0] * dout[1] - di[1] * dout[0]) / (li * lo) : 0, dot: li && lo ? (di[0] * dout[0] + di[1] * dout[1]) / (li * lo) : -1, li, lo };
};
const near = (a, b, tol = 0.03) => Math.abs(a - b) < tol;

// Enums.Tools.
const CLAY = 0;
const TWIST = 2;
const CREASE = 6;
const PAINT = 8;
const RAKE = 13;

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
      let outside = 0;
      let handlesOut = 0;
      let backwards = 0;
      let offCurve = 0;
      let lutGap = 0;
      let sets = 0;
      for (let set = 0; set < 200; set++) {
        const c = new Curve(proto.presets, proto.defaultPreset);
        const n = 2 + Math.floor(rnd() * 7);
        const a = [];
        for (let i = 0; i < n; i++) {
          const tt = i === 0 ? 0 : i === n - 1 ? 1 : 0.02 + rnd() * 0.96;
          const vv = rnd();
          // Handles anywhere, wild ones included: the curve has to make them valid.
          a.push({ t: tt, v: vv, in: { t: tt - rnd() * 0.6, v: vv + (rnd() - 0.5) * 2.5 }, out: { t: tt + rnd() * 0.6, v: vv + (rnd() - 0.5) * 2.5 }, corner: rnd() < 0.3 });
        }
        if (!c.setAnchors(a)) continue;
        sets++;
        const A = c.anchors;
        for (let k = 0; k < A.length; k++) {
          if (A[k].in && !(A[k].in.t >= A[k - 1].t && A[k].in.t <= A[k].t)) handlesOut++;
          if (A[k].out && !(A[k].out.t >= A[k].t && A[k].out.t <= A[k + 1].t)) handlesOut++;
        }
        for (let i = 0; i <= 1000; i++) {
          const y = c.evaluate(i / 1000);
          if (!(y >= 0 && y <= 1)) outside++;
        }
        // The drawn curve runs left to right only, and the weight read at
        // each of its t is its own v there (the solve finds the one s).
        const line = c.polyline(32);
        for (let i = 1; i < line.length; i++) if (line[i].t < line[i - 1].t - 1e-12) backwards++;
        for (const p of line) if (Math.abs(c.evaluate(p.t) - p.v) > 1e-7) offCurve++;
        // The table holds the curve at its nodes; between them a loop reads it linearly.
        for (let i = 0; i < 256; i++) lutGap = Math.max(lutGap, Math.abs(c.lut[i] - c.evaluate(i / 255)), Math.abs(c.sample(i / 255) - c.lut[i]));
      }
      // Validation: what a stored curve may be.
      const c = new Curve(proto.presets, proto.defaultPreset);
      const A2 = (n) => ({ anchors: Array.from({ length: n }, (_, i) => ({ t: i / (n - 1), v: 1 })) });
      const bad = [
        c.load('x'),
        c.load({ anchors: [{ t: 0, v: 1 }] }),
        c.load({ anchors: [{ t: 0, v: 1 }, { t: 1, v: NaN }] }),
        c.load(A2(9)),
        c.load({ anchors: [{ t: 0, v: 1, out: [0.3, 'a'] }, { t: 1, v: 0 }] }),
        c.load({ anchors: [{ t: 0, v: 1 }, 'no'] }),
        c.load([[0, 1], [1, NaN]]),
        c.load(Array.from({ length: 17 }, (_, i) => [i / 16, 1])),
      ];
      const ok8 = c.load(A2(8)) && c.anchors.length === 8;
      const clamped =
        c.load({ anchors: [{ t: 1, v: -2, in: [0.2, 0.5] }, { t: 0.5, v: 0.5, in: [0.9, 0.5], out: [0.1, 0.5] }, { t: 0, v: 7, out: [3, 1], in: [-1, 0] }] }) && c.serialize();
      return { sets, outside, handlesOut, backwards, offCurve, lutGap, bad, ok8, clamped };
    });
    t.ok(maths.sets === 200 && maths.outside === 0, `200 random Bezier curves never leave [0, 1] (${maths.outside} samples out)`);
    t.ok(maths.handlesOut === 0, `every handle is kept within its segment (${maths.handlesOut} out)`);
    t.ok(maths.backwards === 0 && maths.offCurve === 0, `each is a function of t: the drawn curve never turns back (${maths.backwards}) and the weight read at its t is its own (${maths.offCurve} off)`);
    t.ok(maths.lutGap < 1e-12, `the baked table the brushes read holds the curve at its 256 nodes (max gap ${maths.lutGap.toExponential(2)})`);
    t.ok(maths.bad.every((b) => b === false) && maths.ok8, `a stored curve that is not 2-8 anchors of finite numbers is refused, 8 read (${maths.bad.join(', ')})`);
    const cl = maths.clamped && maths.clamped.anchors;
    t.ok(
      cl &&
        cl.length === 3 &&
        cl[0].t === 0 && cl[0].v === 1 && !cl[0].in && cl[0].out[0] <= 0.5 &&
        cl[1].in[0] >= 0 && cl[1].in[0] <= 0.5 && cl[1].out[0] >= 0.5 && cl[1].out[0] <= 1 &&
        cl[2].t === 1 && cl[2].v === 0 && !cl[2].out && cl[2].in[0] >= 0.5,
      `one with values out of range is clamped and sorted, its ends pinned, its handles put back in their segments (${JSON.stringify(maths.clamped)})`,
    );

    // --- the presets ----------------------------------------------------------
    const presets = await page.evaluate(([clay, crease, twist, paint, rake]) => {
      const input = window.__sculpt.input;
      const out = [];
      for (const idx of [clay, crease, twist, paint, rake]) {
        const c = input.toolCurve(idx);
        for (const p of c.presets) {
          let err = 0;
          const probe = new c.constructor(c.presets, p.id);
          for (let i = 0; i <= 20000; i++) {
            const x = i / 20000;
            if (x > 0.999) break;
            err = Math.max(err, Math.abs(probe.bezier(x) - p.kernel(x)));
          }
          out.push({ tool: idx, id: p.id, anchors: p.anchors.length, err, exact: probe.exactKernel && probe.presetId === p.id });
        }
      }
      return out;
    }, [CLAY, CREASE, TWIST, PAINT, RAKE]);
    t.ok(presets.length === 18 && presets.every((p) => p.anchors >= 2 && p.anchors <= 4), `every preset is 2 to 4 anchors (${presets.map((p) => `${p.id} ${p.anchors}`).join(', ')})`);
    t.ok(presets.every((p) => p.exact), 'and on its preset each curve reads its exact kernel');
    t.ok(
      presets.every((p) => p.err < (p.tool === PAINT && p.id === 'hard' ? 0.01 : 0.002)),
      `and its Bezier draws the kernel to within 0.002 (Paint's Hard, a cliff at the edge, 0.01 to t = 0.999): ${presets.map((p) => `${p.id} ${p.err.toExponential(1)}`).join(', ')}`,
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
        let lut = 0;
        for (let i = 0; i < 256; i++) lut = Math.max(lut, Math.abs(c.lut[i] - f(i / 255)));
        out[idx] = { preset: c.presetId, isDefault: c.isDefault(), exact: c.exactKernel, diff, lut };
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
      t.ok(d.preset === preset && d.isDefault && d.exact && d.diff === 0 && d.lut === 0, `${name} starts on ${preset}, the old falloff to the bit (${JSON.stringify(d)})`);
    }
    t.ok(defaults.blurShares, "Paint's blur reads Paint's own curve");

    // --- curvesRev 1 point lists convert -----------------------------------------
    const v1 = await page.evaluate(([clay, crease, twist, paint, rake]) => {
      const input = window.__sculpt.input;
      const mapped = [];
      for (const idx of [clay, crease, twist, paint, rake]) {
        const c = input.toolCurve(idx);
        for (const p of c.presets) {
          const probe = new c.constructor(c.presets, c.presets.find((x) => x.id !== p.id).id);
          const ok = probe.load(p.legacy.map((q) => [q.t, q.v]));
          mapped.push({ id: p.id, ok, to: probe.presetId, exact: probe.exactKernel });
        }
      }
      const c = input.toolCurve(clay);
      const probe = new c.constructor(c.presets, c.defaultPreset);
      // A few points: one anchor each, through every point.
      const few = [[0, 1], [0.3, 0.9], [0.7, 0.2], [1, 0]];
      probe.load(few);
      const fewOut = { n: probe.anchors.length, preset: probe.presetId, miss: Math.max(...few.map(([x, y]) => Math.abs(probe.evaluate(x) - y))) };
      // Many points (12, as an edited curve could have): six anchors that follow them.
      const many = Array.from({ length: 12 }, (_, i) => [i / 11, Math.round((0.5 + 0.5 * Math.cos(Math.PI * Math.pow(i / 11, 1.3))) * 1e4) / 1e4]);
      probe.load(many);
      const manyOut = { n: probe.anchors.length, miss: Math.max(...many.map(([x, y]) => Math.abs(probe.evaluate(x) - y))) };
      return { mapped, fewOut, manyOut };
    }, [CLAY, CREASE, TWIST, PAINT, RAKE]);
    t.ok(v1.mapped.length === 18 && v1.mapped.every((m) => m.ok && m.to === m.id && m.exact), `a curvesRev 1 list that is a preset's sampled points comes back as that preset, on its kernel (${v1.mapped.filter((m) => m.to !== m.id).map((m) => m.id).join(', ') || 'all 18'})`);
    t.ok(v1.fewOut.n === 4 && v1.fewOut.preset === null && v1.fewOut.miss < 1e-9, `one of four other points becomes four anchors through them (${JSON.stringify(v1.fewOut)})`);
    t.ok(v1.manyOut.n === 6 && v1.manyOut.miss < 0.03, `one of twelve becomes six anchors that follow it (${JSON.stringify(v1.manyOut)})`);

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
        plateauRow: captions.includes('Strip plateau'),
        layerRow: captions.includes('Strip layer'),
        alphaRow: [...p.querySelectorAll('.label-row > span')].some((s) => s.textContent === 'Alpha') || !!p.querySelector('.matcap-grid--alpha'),
        anchors: p.querySelectorAll('.curve-editor__point').length,
        handles: p.querySelectorAll('.curve-editor__handle').length,
      };
    });
    t.ok(ui.editors === 1 && ui.presets.join() === 'Plateau,Soft,Flat,Round' && ui.on === 'Plateau', `clay shows one curve with its presets, Plateau lit (${JSON.stringify(ui.presets)}, on ${ui.on})`);
    t.ok(ui.anchors === 4 && ui.handles === 6, `Plateau is drawn as 4 anchors and their 6 handles (${ui.anchors}, ${ui.handles})`);
    t.ok(!ui.plateauRow && ui.layerRow && !ui.alphaRow, `the Strip plateau slider and the Alpha row are gone, Strip layer stays (${JSON.stringify(ui)})`);
    t.ok(ui.touchAction === 'none', `the plot takes its touches (touch-action ${ui.touchAction})`);

    // A preset applies.
    await page.click('.panel--sculpt .curve-editor__preset[data-preset="soft"]');
    let c = await curveOf(page, CLAY);
    t.ok(c.preset === 'soft' && c.anchors.length === 3, `the Soft preset sets the curve (${c.preset}, ${c.anchors.length} anchors)`);
    await page.click('.panel--sculpt .curve-editor__preset[data-preset="flat"]');
    c = await curveOf(page, CLAY);
    t.ok(c.preset === 'flat' && c.anchors.length === 2 && c.anchors.every((a) => a.v === 1), `Flat is a hard edge, two anchors (${JSON.stringify(c.anchors)})`);

    // A click on empty plot adds an anchor there, smooth, on the curve's slope.
    let r = await plotAt(page);
    await page.mouse.click(...at(r, 0.5, 0.4));
    c = await curveOf(page, CLAY);
    let added = c.anchors[1];
    let g = added && added.in && added.out && handleGeom(added);
    t.ok(
      c.anchors.length === 3 && near(added.t, 0.5) && near(added.v, 0.4) && c.preset === null && !added.corner && g && Math.abs(g.cross) < 1e-9 && g.dot < -0.999 && near(g.li, 0.5 / 3, 0.01) && near(g.lo, 0.5 / 3, 0.01),
      `a click adds an anchor where it lands, its handles aligned on the curve's slope, a third of each segment (${JSON.stringify(added)})`,
    );

    // A drag moves it, its handles with it.
    r = await plotAt(page);
    await page.mouse.move(...at(r, added.t, added.v));
    await page.mouse.down();
    await page.mouse.move(...at(r, 0.6, 0.7), { steps: 5 });
    await page.mouse.up();
    c = await curveOf(page, CLAY);
    let moved = c.anchors[1];
    t.ok(
      c.anchors.length === 3 && near(moved.t, 0.6) && near(moved.v, 0.7) && near(moved.out[0] - moved.t, added.out[0] - added.t, 0.01) && near(moved.in[1] - moved.v, added.in[1] - added.v, 0.01),
      `a drag moves it, and its handles go with it (${JSON.stringify(moved)})`,
    );

    // A handle drag: the twin turns to stay opposite, keeping its length.
    const before = handleGeom(moved);
    await page.mouse.move(...at(r, moved.out[0], moved.out[1]));
    await page.mouse.down();
    await page.mouse.move(...at(r, moved.t + 0.15, moved.v - 0.2), { steps: 5 });
    await page.mouse.up();
    c = await curveOf(page, CLAY);
    let h = c.anchors[1];
    g = handleGeom(h);
    t.ok(
      near(h.out[0], moved.t + 0.15) && near(h.out[1], moved.v - 0.2) && Math.abs(g.cross) < 1e-6 && g.dot < -0.999 && near(g.li, before.li, 1e-6),
      `dragging a handle moves it, and on a smooth anchor turns its twin opposite, the twin's length kept (${JSON.stringify(h)}; ${JSON.stringify(g)})`,
    );

    // A double click makes it a corner: a handle then moves alone.
    await page.mouse.dblclick(...at(r, h.t, h.v));
    c = await curveOf(page, CLAY);
    t.ok(c.anchors.length === 3 && c.anchors[1].corner === true, `a double click makes the anchor a corner (${JSON.stringify(c.anchors[1])})`);
    const cornerAt = await page.evaluate(() => document.querySelectorAll('.panel--sculpt .curve-editor__point--corner').length);
    t.eq(cornerAt, 1, 'drawn as a corner');
    h = c.anchors[1];
    await page.mouse.move(...at(r, h.out[0], h.out[1]));
    await page.mouse.down();
    await page.mouse.move(...at(r, h.t + 0.1, h.v + 0.1), { steps: 5 });
    await page.mouse.up();
    c = await curveOf(page, CLAY);
    t.ok(
      near(c.anchors[1].out[1], h.v + 0.1) && c.anchors[1].in[0] === h.in[0] && c.anchors[1].in[1] === h.in[1],
      `on a corner a handle moves alone (${JSON.stringify(c.anchors[1])})`,
    );
    // And another makes it smooth again, its handles aligned.
    h = c.anchors[1];
    await page.mouse.dblclick(...at(r, h.t, h.v));
    c = await curveOf(page, CLAY);
    g = handleGeom(c.anchors[1]);
    t.ok(!c.anchors[1].corner && Math.abs(g.cross) < 1e-6 && g.dot < -0.999, `a second double click makes it smooth, its handles lined up (${JSON.stringify(c.anchors[1])})`);

    // The centre end anchor moves up and down only.
    await page.mouse.move(...at(r, 0, 1));
    await page.mouse.down();
    await page.mouse.move(...at(r, 0.3, 0.8), { steps: 5 });
    await page.mouse.up();
    c = await curveOf(page, CLAY);
    t.ok(c.anchors[0].t === 0 && near(c.anchors[0].v, 0.8) && c.anchors.length === 3 && !c.anchors[0].in, `the centre anchor stays at the centre and moves down (${JSON.stringify(c.anchors[0])})`);
    // Dragged out of the box, an end anchor stays.
    await page.mouse.move(...at(r, 1, 1));
    await page.mouse.down();
    await page.mouse.move(r.left + r.width + 60, r.top + r.height / 2, { steps: 5 });
    await page.mouse.up();
    c = await curveOf(page, CLAY);
    t.ok(c.anchors.length === 3 && c.anchors[2].t === 1, `an edge anchor dragged out of the box is not removed (${JSON.stringify(c.anchors[2])})`);

    // An interior anchor dragged out shows "will remove", and goes on release.
    const p1 = c.anchors[1];
    await page.mouse.move(...at(r, p1.t, p1.v));
    await page.mouse.down();
    await page.mouse.move(r.left + r.width / 2, r.top - 60, { steps: 6 });
    const outside = await page.evaluate(() => ({
      marked: document.querySelectorAll('.panel--sculpt .curve-editor__point--remove').length,
      root: document.querySelector('.panel--sculpt .curve-editor').classList.contains('curve-editor--removing'),
      live: window.__sculpt.input.toolCurve(0).anchors.length,
    }));
    t.ok(outside.marked === 1 && outside.root && outside.live === 2, `outside the box it shows as "will remove", the curve drawn without it (${JSON.stringify(outside)})`);
    await page.mouse.up();
    c = await curveOf(page, CLAY);
    t.ok(c.anchors.length === 2, `and it goes on release (${c.anchors.length} anchors)`);
    // Two anchors left: an end anchor dragged out still stays.
    await page.mouse.move(...at(r, 1, c.anchors[1].v));
    await page.mouse.down();
    await page.mouse.move(r.left + r.width / 2, r.top + r.height + 60, { steps: 5 });
    await page.mouse.up();
    c = await curveOf(page, CLAY);
    t.ok(c.anchors.length === 2, `a curve keeps its two end anchors (${c.anchors.length})`);

    // The keyboard: a focused anchor moves with the arrows, Delete removes it.
    await page.click('.panel--sculpt .curve-editor__preset[data-preset="flat"]');
    await page.mouse.click(...at(r, 0.4, 0.5));
    const kb0 = (await curveOf(page, CLAY)).anchors;
    const kIndex = kb0.findIndex((p) => near(p.t, 0.4));
    const focused = await page.evaluate(() => document.activeElement?.classList.contains('curve-editor__point'));
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowRight');
    const kb1 = (await curveOf(page, CLAY)).anchors;
    t.ok(
      kIndex === 1 && focused && Math.abs(kb1[kIndex].v - (kb0[kIndex].v + 0.01)) < 1e-9 && Math.abs(kb1[kIndex].t - (kb0[kIndex].t + 0.01)) < 1e-9,
      `the added anchor has the focus and the arrows move it by a hundredth (${JSON.stringify(kb0[kIndex])} to ${JSON.stringify(kb1[kIndex])})`,
    );
    const toolStill = await page.evaluate(() => window.__sculpt.input.currentToolIndex());
    t.eq(toolStill, CLAY, 'and the keys stayed with the editor (still on clay)');
    await page.keyboard.press('Delete');
    let kb2 = (await curveOf(page, CLAY)).anchors;
    t.ok(kb2.length === 2, `Delete removes the focused anchor (${kb2.length} left)`);
    await page.keyboard.press('Delete');
    kb2 = (await curveOf(page, CLAY)).anchors;
    t.ok(kb2.length === 2, `but never an end anchor (${kb2.length} left)`);

    // A pen drags an anchor, a finger tap adds one, a finger double tap makes a corner.
    const dev = await devices(page);
    r = await plotAt(page);
    await page.mouse.click(...at(r, 0.4, 0.5));
    let pk = (await curveOf(page, CLAY)).anchors[1];
    await dev.penDrag([at(r, pk.t, pk.v), at(r, pk.t, 0.6), at(r, pk.t, 0.25)]);
    c = await curveOf(page, CLAY);
    t.ok(near(c.anchors[1].v, 0.25), `a pen drags an anchor (${JSON.stringify(c.anchors[1])})`);
    const n0 = c.anchors.length;
    await dev.tap(at(r, 0.75, 0.9));
    c = await curveOf(page, CLAY);
    const tapped = c.anchors.findIndex((p) => near(p.t, 0.75));
    t.ok(c.anchors.length === n0 + 1 && tapped > 0, `a finger tap adds an anchor (${c.anchors.length} anchors)`);
    pk = c.anchors[tapped];
    // Stamped as a quick double tap would be (the test renderer is slow to
    // hand the events over, so arrival times would be far apart).
    const ts = Date.now() / 1000;
    const tapAt = at(r, pk.t, pk.v);
    await dev.touch('touchStart', [tapAt], ts);
    await dev.touch('touchEnd', [], ts + 0.06);
    await dev.touch('touchStart', [tapAt], ts + 0.2);
    await dev.touch('touchEnd', [], ts + 0.26);
    c = await curveOf(page, CLAY);
    t.ok(c.anchors[tapped].corner === true && c.anchors.length === n0 + 1, `a finger double tap makes it a corner (${JSON.stringify(c.anchors[tapped])})`);

    // --- persistence ---------------------------------------------------------
    const edited = { anchors: c.anchors };
    const back = await page.evaluate(async () => {
      const { file, input } = window.__sculpt;
      const bytes = await file.pack();
      const rec = await file.unpack(bytes.slice(0));
      input.toolCurve(0).reset();
      input.toolCurve(6).applyPreset('soft');
      await file.open(bytes);
      return { saved: rec.settings?.curves?.[0], rev: rec.settings?.curvesRev, clay: input.toolCurve(0).serialize(), crease: input.toolCurve(6).presetId };
    });
    t.ok(JSON.stringify(back.saved) === JSON.stringify(edited) && back.rev === 2, `the scene file records the curve's anchors, curvesRev 2 (${JSON.stringify(back.saved)?.slice(0, 100)})`);
    t.ok(JSON.stringify(back.clay) === JSON.stringify(edited), `and opening it brings the edited curve back, its corner included (${back.clay.anchors.length} anchors)`);
    t.eq(back.crease, 'sharp', 'and the crease its saved default');

    // A scene saved by the curvesRev 1 build: its point lists convert.
    const old = await page.evaluate(async () => {
      const { file, input } = window.__sculpt;
      const rec = await file.unpack(await file.pack());
      const medium = input.toolCurve(6).presets.find((p) => p.id === 'medium').legacy.map((q) => [q.t, q.v]);
      rec.settings.curves = { 0: [[0, 1], [0.3, 0.9], [0.7, 0.2], [1, 0]], 6: medium };
      rec.settings.curvesRev = 1;
      await file.open(await file.packRecord(rec));
      const clay = input.toolCurve(0);
      return { clay: clay.anchors.length, clayPreset: clay.presetId, through: Math.abs(clay.evaluate(0.3) - 0.9) + Math.abs(clay.evaluate(0.7) - 0.2), crease: input.toolCurve(6).presetId, polish: input.toolCurve(2).isDefault() };
    });
    t.ok(old.clay === 4 && old.clayPreset === null && old.through < 1e-9 && old.crease === 'medium' && old.polish, `a curvesRev 1 scene opens: an edited list as anchors through its points, a preset's list as that preset, the rest on defaults (${JSON.stringify(old)})`);

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
