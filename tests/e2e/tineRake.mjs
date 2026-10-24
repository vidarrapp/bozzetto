// The tine rake (owner call, October 2026, replacing the stencil rake):
// N tines across the brush, perpendicular to the stroke, each cutting a
// groove. Since 2026-10-24 a standard brush (owner call): each dab
// displaces along the normal and the dabs add up, so one stroke cuts the
// Depth, a second cuts deeper, and Invert raises ridges on any form.
// Scrape (replacing Plateau) planes the footprint before the tines cut;
// Taper fades the outer tines; pressure scales the depth.
//
// tineRake, with strokes driven through the live tool, on the plane
// primitive at its finest level (flat or rippled), along its x axis, and
// on a sphere primitive, across its front:
// - a stroke with N tines leaves N grooves (local minima across it), for
//   two tine counts on the plane and on the sphere;
// - one stroke at the default spacing and full pressure cuts about depth
//   x radius, and a second pass cuts deeper;
// - depth follows pen pressure (half the press, half the groove);
// - Invert raises N ridges on the plane and on the sphere: a convex form,
//   where the old clay-style rake raised nothing;
// - Scrape 0 leaves the sphere's curvature between the grooves and Scrape
//   1 planes it flat; on a rippled plane, Scrape 0 leaves the ripples and
//   1 levels them, the grooves cut into the flat;
// - Taper makes the outer grooves shallower than the inner ones;
// - the Tool panel: the presets set the knobs (Scrape among them) and the
//   tine profile, a knob moved after unlights the preset, the rake's
//   settings ride the scene file, and a record from before Scrape, with
//   a `plateau`, opens with it as the scrape.
import { openForInput, openPanel } from './smoke.mjs';

const RAKE = 13; // Enums.Tools.RAKE

/**
 * In the page: rake strokes through the live tool, at local radius
 * `radius` (cm, or for the sphere, as a fraction of its radius), on
 * - the plane primitive (alone in reach, flat or rippled first), from x =
 *   -span to +span along y = 0, or
 * - a sphere primitive (`sphere: true`), across its front from x = -span
 *   to +span of its radius through its middle.
 * `passes` strokes the same path that many times; `setup` only adds the
 * form, for the view to settle on before the strokes. Returns the column of
 * vertices across the stroke at x = 0 as [y, z, h]: z the height (the
 * plane's z, the sphere's coordinate toward the camera), h the move along
 * the form's normal (the plane's z, the sphere's radial), the dab record
 * and the radius used.
 */
function rakeStroke({ preset, knobs = {}, pen = false, pressure = 0.5, ripple = 0, radius = 6, span = 9, sphere = false, passes = 1, setup = false }) {
  const { session, tablet, input } = window.__sculpt;
  const manager = session.getSculptManager();
  const tool = manager.getTool(13);
  manager.setToolIndex(13);
  const tag = sphere ? '__rakeSphere' : '__rakePlane';
  let mesh = session.getMeshes().find((m) => m[tag]);
  if (!mesh) {
    mesh = session.addPrimitive(sphere ? 'sphere' : 'plane');
    mesh[tag] = true;
    for (const m of session.getMeshes()) if (m !== mesh) m.getMatrix()[12] += 80;
    mesh.__rest = new Float32Array(mesh.getVertices().subarray(0, mesh.getNbVertices() * 3));
  }
  // Only add it (the view settles on it before the strokes).
  if (setup) return { setup: true };
  session.setMesh(mesh);
  const v = mesh.getVertices();
  const n = mesh.getNbVertices();
  const rest = mesh.__rest;
  // The sphere's centre and radius, from its rest positions.
  const ctr = [0, 0, 0];
  let R = 0;
  if (sphere) {
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) ctr[k] += rest[i * 3 + k] / n;
    for (let i = 0; i < n; i++) R = Math.max(R, Math.hypot(rest[i * 3] - ctr[0], rest[i * 3 + 1] - ctr[1], rest[i * 3 + 2] - ctr[2]));
  }
  const reset = () => {
    for (let i = 0; i < n; i++) {
      v[i * 3] = rest[i * 3];
      v[i * 3 + 1] = rest[i * 3 + 1];
      v[i * 3 + 2] = sphere ? rest[i * 3 + 2] : ripple ? ripple * Math.cos((2 * Math.PI * rest[i * 3 + 1]) / 1.3) : rest[i * 3 + 2];
    }
    mesh.updateGeometry();
    mesh.updateBuffers?.();
  };
  reset();
  // The heights before the stroke (the plane's ripples included).
  const before = new Float32Array(v.subarray(0, n * 3));
  if (preset) tool.applyPreset(preset);
  tool.set(knobs);
  const m = mesh.getMatrix();
  const screen = (p) => {
    const w = [0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]);
    return session.getCamera().project(w);
  };
  const local = sphere ? radius * R : radius;
  // The frame: a along the stroke, b across it, f out of the form toward
  // the view. The plane's axes; on the sphere, f through the point the
  // view faces and a the screen's x on the surface there.
  let a = [1, 0, 0];
  let b = [0, 1, 0];
  let f = [0, 0, 1];
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const unit = (p) => {
    const l = Math.hypot(...p);
    return p.map((x) => x / l);
  };
  if (sphere) {
    const pk = session.getPicking();
    const [sx, sy] = screen(ctr);
    pk.intersectionMouseMesh(mesh, sx, sy);
    const P = Array.from(pk.getIntersectionPoint().slice(0, 3));
    pk.intersectionMouseMesh(mesh, sx + 30, sy);
    const d1 = sub(Array.from(pk.getIntersectionPoint().slice(0, 3)), P);
    f = unit(sub(P, ctr));
    const k = dot(d1, f);
    a = unit([d1[0] - f[0] * k, d1[1] - f[1] * k, d1[2] - f[2] * k]);
    b = [f[1] * a[2] - f[2] * a[1], f[2] * a[0] - f[0] * a[2], f[0] * a[1] - f[1] * a[0]];
  }
  const ends = sphere
    ? [-span, span].map((x) => {
        const z = Math.sqrt(Math.max(0, 1 - x * x));
        return [0, 1, 2].map((k) => ctr[k] + (a[k] * x + f[k] * z) * R);
      })
    : [
        [-span, 0, 0],
        [span, 0, 0],
      ];
  const symmetry = manager._symmetry;
  manager._symmetry = false;
  const d = input.dynamics.get(13);
  const dyn = { ...d };
  d.strength = 1;
  d.strengthCurve = 'linear';
  tablet.pressure = pressure;
  tablet.pen = pen;
  try {
    // The pixel radius that gives `local` on the form: probe once.
    const [x0, y0] = screen(ends[0]);
    const [x1, y1] = screen(ends[1]);
    session._mouseX = x0;
    session._mouseY = y0;
    tool._radius = 60;
    if (!manager.start(false)) return { miss: true };
    const picking = session.getPicking();
    tool.makeStroke(x0 + 1, y0, picking, null);
    const probe = Math.sqrt(picking.getLocalRadius2());
    manager.end();
    session.getStateManager().cleanNoop();
    reset();
    tool._radius = (60 * local) / probe;
    let hit = true;
    const dabs = [];
    for (let pass = 0; pass < passes; pass++) {
      // The stroke: dabs at the brush's own spacing along the path.
      session._mouseX = x0;
      session._mouseY = y0;
      if (!manager.start(false)) return { miss: true };
      hit = hit && picking.getMesh() === mesh;
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (tool._spacing * tool._radius * session.getPixelRatio()));
      for (let s = 1; s <= steps; s++) {
        const x = x0 + ((x1 - x0) * s) / steps;
        const y = y0 + ((y1 - y0) * s) / steps;
        session._mouseX = x;
        session._mouseY = y;
        tool.makeStroke(x, y, picking, null);
        if (tool.lastDab && pass === 0) dabs.push({ ...tool.lastDab, x: dot(sub(Array.from(picking.getIntersectionPoint().slice(0, 3)), ctr), a), r: Math.sqrt(picking.getLocalRadius2()) });
      }
      tool.updateRender();
      manager.end();
      session.getStateManager().cleanNoop();
    }
    const r = dabs[Math.floor(dabs.length / 2)]?.r ?? local;
    // The column at x = 0 (the plane's grid is axis-aligned; the sphere's
    // vertices within a thin slab through the stroke's middle, on its front).
    const col = [];
    const slab = sphere ? 0.03 * R : 0.14;
    for (let i = 0; i < n; i++) {
      const p0 = sub([before[i * 3], before[i * 3 + 1], before[i * 3 + 2]], ctr);
      const p1 = sub([v[i * 3], v[i * 3 + 1], v[i * 3 + 2]], ctr);
      const y = dot(p0, b);
      if (Math.abs(dot(p0, a)) >= slab || Math.abs(y) >= r || (sphere && dot(p0, f) <= 0)) continue;
      // The move along the form's normal: the plane's z, the sphere's radial.
      const h = dot(sub(p1, p0), sphere ? unit(p0) : f);
      col.push([y, dot(p1, f), h]);
    }
    col.sort((a, b) => a[0] - b[0]);
    const mid = dabs[Math.floor(dabs.length / 2)];
    // The deepest cut any dab over the column aimed for (the radius, and
    // with it the depth, changes along the stroke with the view).
    const reach = Math.max(...dabs.filter((q) => Math.abs(q.x - ctr[0]) < q.r).map((q) => q.depthLocal));
    return { hitPlane: hit, r, R, col, dab: mid, first: dabs[0], count: dabs.length, reach };
  } finally {
    Object.assign(d, dyn);
    tablet.pressure = 0.5;
    tablet.pen = false;
    manager._symmetry = symmetry;
  }
}

/**
 * The dips along a column of [y, z, h], in h: points within `lim` of the
 * middle, lowest within `win` either side and at least `prom` below the
 * highest point there.
 */
function dips(col, prom, win, lim = Infinity) {
  const out = [];
  for (let i = 0; i < col.length; i++) {
    const [y, , h] = col[i];
    if (Math.abs(y) > lim) continue;
    const near = col.filter(([q]) => Math.abs(q - y) <= win);
    const lo = Math.min(...near.map((p) => p[2]));
    const hi = Math.max(...near.map((p) => p[2]));
    if (h === lo && hi - h >= prom && !out.some(([q]) => Math.abs(q - y) <= win)) out.push(col[i]);
  }
  return out;
}
const flip = (col) => col.map(([y, z, h]) => [y, -z, -h]);

/** Local minima of h below `floor` along a column. */
function grooves(col, floor) {
  const out = [];
  for (let i = 1; i < col.length - 1; i++) {
    const h = col[i][2];
    if (h < floor && h < col[i - 1][2] && h <= col[i + 1][2]) out.push(col[i]);
  }
  return out;
}

/** The deepest move of the column within `w` of y = `at`. */
const depthNear = (col, at, w) => Math.min(...col.filter(([y]) => Math.abs(y - at) <= w).map(([, , h]) => h));
const deepest = (s) => -Math.min(...s.col.map(([, , h]) => h));

/** The points of a column between the tines (clear of each by `margin`), within 0.85 of the radius. */
function between(s, margin) {
  const tines = s.dab.tines;
  const half = (s.dab.width / tines) * s.r;
  const centres = Array.from({ length: tines }, (_, k) => (((k + 0.5) / tines) * 2 - 1) * s.r);
  return s.col.filter(([y]) => Math.abs(y) < 0.85 * s.r && centres.every((c) => Math.abs(y - c) > half + margin));
}

/** The curvature of z over y (z = a + b y^2, least squares): b. */
function bend(pts) {
  const n = pts.length;
  const xs = pts.map(([y]) => y * y);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const mz = pts.reduce((a, [, z]) => a + z, 0) / n;
  let sxz = 0;
  let sxx = 0;
  pts.forEach(([, z], i) => {
    sxz += (xs[i] - mx) * (z - mz);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  });
  return sxz / sxx;
}

export const suites = {
  async tineRake(page, base, t) {
    await openForInput(page, base);

    // --- the plane ---------------------------------------------------------------
    // N tines, N grooves.
    for (const [tines, width] of [
      [4, 0.7],
      [6, 0.6],
    ]) {
      const s = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { tines, width, taper: 0, invert: false } });
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
        t.ok(Math.abs(deepest(s) - s.reach) < 0.25 * s.reach, `one stroke at the default spacing cuts about depth x radius (${deepest(s).toFixed(3)} for ${s.reach.toFixed(3)})`);
        t.ok(Math.max(...s.col.map(([, , h]) => h)) < 1e-4, 'and raises nothing');
        t.ok(Math.abs(s.dab.spacingFactor * 1.2 - s.dab.stepLocal / s.r) < 1e-6 && Math.abs(s.dab.stepLocal / s.r - 0.06) < 0.02, `each dab cuts its share, step / (1.2 x radius) (step ${(s.dab.stepLocal / s.r).toFixed(3)} of the radius)`);
      }
    }

    // A second pass cuts deeper, as the Standard brush does.
    const one = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { scrape: 0 } });
    const two = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { scrape: 0 }, passes: 2 });
    t.ok(Math.abs(deepest(two) / deepest(one) - 2) < 0.2, `a second pass deepens the grooves (${deepest(two).toFixed(3)} after two, ${deepest(one).toFixed(3)} after one)`);
    const twoScraped = await page.evaluate(rakeStroke, { preset: 'coarse', passes: 2 });
    t.ok(deepest(twoScraped) > 1.2 * deepest(one), `with the default Scrape too (${deepest(twoScraped).toFixed(3)})`);

    // Depth follows pressure.
    const full = await page.evaluate(rakeStroke, { preset: 'coarse', pen: true, pressure: 1 });
    const half = await page.evaluate(rakeStroke, { preset: 'coarse', pen: true, pressure: 0.5 });
    const dFull = deepest(full);
    const dHalf = deepest(half);
    t.ok(full.dab.pressureTerm === 1 && half.dab.pressureTerm === 0.5, `the pen's pressure is the depth's term (${full.dab.pressureTerm}, ${half.dab.pressureTerm})`);
    t.ok(Math.abs(dHalf / dFull - 0.5) < 0.08, `half the press cuts half as deep (${dHalf.toFixed(3)} against ${dFull.toFixed(3)})`);

    // Invert raises ridges.
    const inv = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { invert: true } });
    const top = Math.max(...inv.col.map(([, , h]) => h));
    const low = Math.min(...inv.col.map(([, , h]) => h));
    t.ok(top > 0.75 * inv.reach && low > -1e-4, `Invert raises ridges instead (up to ${top.toFixed(3)} for ${inv.reach.toFixed(3)}, nothing below ${low.toExponential(1)})`);
    t.eq(grooves(flip(inv.col), -0.3 * inv.dab.depthLocal).length, 4, 'four of them');

    // Scrape on a rippled plane: the ripples between the tines kept or levelled.
    const lvl0 = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { width: 0.4, scrape: 0 }, ripple: 0.15 });
    const lvl1 = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { width: 0.4, scrape: 1 }, ripple: 0.15 });
    const amp = (s) => {
      const pts = between(s, 0.2);
      return { n: pts.length, max: Math.max(...pts.map(([, z]) => Math.abs(z))) };
    };
    const b0 = amp(lvl0);
    const b1 = amp(lvl1);
    t.ok(b0.n > 4 && b0.max > 0.1, `Scrape 0 leaves the ripples between the tines (${b0.n} vertices, up to ${b0.max.toFixed(3)})`);
    t.ok(b1.max < 0.25 * b0.max, `Scrape 1 levels them (up to ${b1.max.toFixed(3)} against ${b0.max.toFixed(3)})`);
    const cut1 = dips(lvl1.col.map(([y, z]) => [y, z, z]), 0.6 * lvl1.reach, lvl1.r / 4, 0.9 * lvl1.r);
    t.eq(cut1.length, 4, `and the grooves are cut into the flat (${cut1.map(([y, z]) => `${(y / lvl1.r).toFixed(2)}:${z.toFixed(3)}`).join(', ')})`);

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

    // --- the sphere: a curved, convex form ----------------------------------------
    const onSphere = { sphere: true, radius: 0.5, span: 0.6 };
    await page.evaluate(rakeStroke, { ...onSphere, setup: true });
    await page.waitForTimeout(1000);
    for (const tines of [4, 3]) {
      const s = await page.evaluate(rakeStroke, { ...onSphere, preset: 'coarse', knobs: { tines, width: 0.7, scrape: 0 } });
      const g = dips(s.col, 0.5 * s.reach, s.r / tines);
      t.ok(s.hitPlane && s.count > 20 && s.col.length > 20, `the ${tines}-tine stroke lands on the sphere (${s.count} dabs, ${s.col.length} vertices in the column, radius ${(s.r / s.R).toFixed(2)} of the sphere's)`);
      t.eq(g.length, tines, `${tines} tines cut ${tines} grooves into the sphere (at ${g.map(([y, , h]) => `${(y / s.r).toFixed(2)}:${(h / s.reach).toFixed(2)}`).join(', ')})`);
      t.ok(Math.abs(deepest(s) - s.reach) < 0.25 * s.reach, `about depth x radius deep (${deepest(s).toFixed(4)} for ${s.reach.toFixed(4)})`);
    }
    // The regression: Invert on a convex form raises even ridges of the
    // depth asked (the old rake aimed each vertex at a height over a plane
    // fitted per dab, raising only what lay below it: on a sphere, a
    // ridge's height came from how far below the passing dabs' planes it
    // sat, the outer ones 2.5 times the depth here, the inner ones 1.1).
    const sInv = await page.evaluate(rakeStroke, { ...onSphere, preset: 'coarse', knobs: { depth: 0.04, scrape: 0, invert: true } });
    const ridges = dips(flip(sInv.col), 0.5 * sInv.reach, sInv.r / 4);
    const rise = Math.max(...sInv.col.map(([, , h]) => h));
    t.ok(
      ridges.length === 4 && ridges.every(([, , h]) => Math.abs(-h / sInv.reach - 1) < 0.25),
      `Invert raises 4 ridges on the sphere, each depth x radius above the surface, within a quarter (at ${ridges.map(([y, , h]) => `${(y / sInv.r).toFixed(2)}:${(-h / sInv.reach).toFixed(2)}`).join(', ')} of the radius and the depth)`,
    );
    t.ok(rise > 0.75 * sInv.reach && Math.min(...sInv.col.map(([, , h]) => h)) > -1e-3 * sInv.R, `standing about depth x radius proud of the surface (${rise.toFixed(4)} for ${sInv.reach.toFixed(4)})`);
    // Scrape: the curvature between the grooves kept at 0, planed at 1.
    const s0 = await page.evaluate(rakeStroke, { ...onSphere, preset: 'coarse', knobs: { width: 0.4, scrape: 0 } });
    const s1 = await page.evaluate(rakeStroke, { ...onSphere, preset: 'coarse', knobs: { width: 0.4, scrape: 1 } });
    const k0 = bend(between(s0, 0.02 * s0.R));
    const k1 = bend(between(s1, 0.02 * s1.R));
    const ideal = -1 / (2 * s0.R);
    t.ok(Math.abs(k0 / ideal - 1) < 0.25, `Scrape 0 leaves the sphere's curve between the grooves (bend ${k0.toFixed(4)}, the sphere's ${ideal.toFixed(4)})`);
    t.ok(Math.abs(k1) < 0.25 * Math.abs(k0), `Scrape 1 planes it flat (bend ${k1.toFixed(4)})`);
    const flatCut = dips(s1.col.map(([y, z]) => [y, z, z]), 0.5 * s1.reach, s1.r / 4, 0.9 * s1.r);
    t.eq(flatCut.length, 4, `and cuts the grooves into the flat (${flatCut.map(([y]) => (y / s1.r).toFixed(2)).join(', ')})`);

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
        hints: [...p.querySelectorAll('.panel--sculpt .sculpt-panel__extras .sculpt-panel__hint')].map((h) => h.textContent),
      };
    });
    t.ok(
      ['Tines', 'Tine width', 'Depth', 'Scrape', 'Taper'].every((c) => rows.captions.includes(c)) && !rows.captions.includes('Plateau') && rows.invert && rows.curves.join() === 'Tine profile',
      `the rake's rows: ${rows.captions.join(', ')}, Invert, ${rows.curves.join()}`,
    );
    t.ok(!rows.hints.some((h) => /Depth follows|Plateau/.test(h)), `and no depth hint under them (owner call, 2026-10-24: ${JSON.stringify(rows.hints)})`);
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
        const slider = (c) => Number([...document.querySelectorAll('.panel--sculpt label.compact')].find((r) => r.firstElementChild?.textContent === c)?.querySelector('input')?.value);
        return { ...tool.settings(), curve: tool.curve.presetId, preset: tool.presetId, slider: slider('Tines'), scrapeSlider: slider('Scrape'), lit: document.querySelector('.panel--sculpt .sculpt-panel__presets .sculpt-panel__btn--on')?.textContent };
      });
    };
    const want = { Fine: [8, 'v', 0.15], Comb: [12, 'round', 0.1], Coarse: [4, 'round', 0.25], Chisel: [3, 'flat', 0.5], Scraper: [5, 'flat', 1] };
    for (const [label, [tines, curve, scrape]] of Object.entries(want)) {
      const got = await pick(label);
      t.ok(
        got.tines === tines && got.curve === curve && got.scrape === scrape && got.taper === 0 && got.preset === label.toLowerCase() && got.slider === tines && got.scrapeSlider === scrape && got.lit === label,
        `${label}: ${tines} ${curve} tines, Scrape ${scrape}, the sliders and the lit button with it (${JSON.stringify(got)})`,
      );
    }
    await pick('Chisel');
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
    t.ok(back.tines === 3 && back.taper === 0.4 && back.scrape === 0.5 && back.curve === 'soft' && back.preset === null, `the knobs and the tine profile come back with the scene (${JSON.stringify(back)})`);

    // A record from before Scrape: its plateau is the scrape.
    const legacy = await page.evaluate(async () => {
      const { file } = window.__sculpt;
      const tool = window.__sculpt.session.getSculptManager().getTool(13);
      const rec = await file.unpack(await file.pack());
      rec.settings.rake = { tines: 6, width: 0.5, depth: 0.07, plateau: 0.35, taper: 0, invert: false, preset: null };
      await file.open(await file.packRecord(rec));
      const mapped = { ...tool.settings(), preset: tool.presetId };
      tool.set({ plateau: 0.8 });
      return { mapped, direct: tool.scrape };
    });
    t.ok(legacy.mapped.scrape === 0.35 && legacy.mapped.tines === 6 && !('plateau' in legacy.mapped) && legacy.direct === 0.8, `a saved rake with a plateau opens with it as the scrape (${JSON.stringify(legacy)})`);
  },
};
