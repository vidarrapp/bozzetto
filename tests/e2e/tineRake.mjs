// The tine rake (owner call, October 2026, replacing the stencil rake):
// N tines across the brush, perpendicular to the stroke, each cutting a
// groove. Since 2026-10-24 a standard brush (owner call): each dab
// displaces along the normal and the dabs add up, so one stroke cuts the
// Strength (in cm since 2026-10-31, where it was a Depth, a fraction of the
// radius), and Invert raises ridges on any form. With Stop at depth off a
// second stroke cuts deeper; with it on (the default; owner call,
// 2026-11-10, to try) the tines stop at a floor, the Strength under the
// surface around them (tineRakeLevel, at the foot).
// Scrape (replacing Plateau) planes the footprint before the tines cut;
// Taper fades the outer tines; pressure scales the depth.
//
// tineRake, with strokes driven through the live tool, on the plane
// primitive at its finest level (flat or rippled), along its x axis, and
// on a sphere primitive, across its front:
// - a stroke with N tines leaves N grooves (local minima across it), for
//   two tine counts on the plane and on the sphere;
// - one stroke at the default spacing and full pressure cuts about the
//   strength, 0.3 cm on Coarse, and a second pass cuts deeper;
// - depth follows pen pressure (half the press, half the groove);
// - Invert raises N ridges on the plane and on the sphere: a convex form,
//   where the old clay-style rake raised nothing;
// - Scrape 0 leaves the sphere's curvature between the grooves and Scrape
//   1 planes it flat; on a rippled plane, Scrape 0 leaves the ripples and
//   1 levels them, the grooves cut into the flat;
// - Taper makes the outer grooves shallower than the inner ones;
// - the Tool panel: no Depth row; the presets set the knobs (Scrape and the
//   strength in cm among them) and the tine profile, a knob moved after
//   unlights the preset, the rake's settings ride the scene file, a record
//   from before Scrape, with a `plateau`, opens with it as the scrape, and
//   one from before the strength in cm, with a `depth`, opens with that
//   fraction of 3 cm as the strength;
// - Stop at depth, in the panel (a checkbox, on, with its hint) and in the
//   scene file (kept when off; a record without it opens with it on);
// - the brush cursor: with the Rake in hand, hovering the plane draws one
//   circle per tine (4 for Coarse, 12 for Comb) inside a faint ring, at
//   the tines' spacing and half-width, laid across the hover motion (a
//   jitter barely turns them) and across the drag mid-stroke, on the
//   stroke's own axis; Taper fades the outer circles; other brushes draw
//   the single ring;
// - the size being set (owner request): held b and dragged over the
//   plane, the tine circles grow with the surface ring; off the mesh, from
//   the ] key and from the size slider, the screen-space ring has the same
//   circles to its own scale (count, spacing, half-width, taper), in a row
//   along the across axis as the surface last showed it, or level when it
//   never has; another brush's screen ring has none.
import { emptySpot, openForInput, openPanel } from './smoke.mjs';

const RAKE = 13; // Enums.Tools.RAKE

/**
 * In the page: rake strokes through the live tool, at local radius
 * `radius` (cm, or for the sphere, as a fraction of its radius), on
 * - the plane primitive (alone in reach, flat or rippled first), from x =
 *   -span to +span along y = 0, or
 * - a sphere primitive (`sphere: true`), across its front from x = -span
 *   to +span of its radius through its middle.
 * `passes` strokes the same path that many times, with `cross` every
 * second one a quarter turn round, through the same middle; `bump` raises
 * a round bump on the form first ({ height, sigma, y, x }, cm or the
 * sphere's radius; a negative height a hollow); `setup` only adds the
 * form, for the view to settle on before the strokes. `perPass` is, after
 * each pass, the deepest cut and the highest rise within half the radius
 * of the middle, and `row` the column's like along the stroke. Returns the column of
 * vertices across the stroke at x = 0 as [y, z, h]: z the height (the
 * plane's z, the sphere's coordinate toward the camera), h the move along
 * the form's normal (the plane's z, the sphere's radial), the dab record
 * and the radius used.
 */
function rakeStroke({ preset, knobs = {}, pen = false, pressure = 0.5, ripple = 0, bump = null, radius = 6, span = 9, sphere = false, passes = 1, cross = false, setup = false }) {
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
  const reset = (shaped = true) => {
    for (let i = 0; i < n; i++) {
      v[i * 3] = rest[i * 3];
      v[i * 3 + 1] = rest[i * 3 + 1];
      v[i * 3 + 2] = sphere ? rest[i * 3 + 2] : ripple ? ripple * Math.cos((2 * Math.PI * rest[i * 3 + 1]) / 1.3) : rest[i * 3 + 2];
      if (bump && shaped) {
        // A round bump (a hollow, with a negative height) out of the form.
        const q = [0, 1, 2].map((k) => rest[i * 3 + k] - ctr[k]);
        const g = bump.height * Math.exp(-((dot(q, a) - (bump.x ?? 0) * unitLen) ** 2 + (dot(q, b) - bump.y * unitLen) ** 2) / (bump.sigma * unitLen) ** 2);
        const out = sphere ? unit(q) : f;
        if (!sphere || dot(q, f) > 0) for (let k = 0; k < 3; k++) v[i * 3 + k] += out[k] * g * unitLen;
      }
    }
    mesh.updateGeometry();
    mesh.updateBuffers?.();
  };
  reset(false);
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
  // A bump's lengths: cm on the plane, the sphere's radius on the sphere.
  const unitLen = sphere ? R : 1;
  reset();
  // The heights before the stroke (the plane's ripples and the bump included).
  const before = new Float32Array(v.subarray(0, n * 3));
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
    let [x0, y0] = screen(ends[0]);
    let [x1, y1] = screen(ends[1]);
    const lengthways = [x0, y0, x1, y1];
    // The crossing path: the same, turned a quarter (along b through the middle).
    const turned = (e) => ctr.map((o, k) => o + b[k] * dot(sub(e, ctr), a) + f[k] * dot(sub(e, ctr), f));
    const crossways = [...screen(turned(ends[0])).slice(0, 2), ...screen(turned(ends[1])).slice(0, 2)];
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
    // After each pass: the deepest and the highest move in the middle of
    // the strokes (within half the radius of it, both ways).
    const perPass = [];
    for (let pass = 0; pass < passes; pass++) {
      [x0, y0, x1, y1] = cross && pass % 2 === 1 ? crossways : lengthways;
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
      let lo = 0;
      let hi = 0;
      for (let i = 0; i < n; i++) {
        const p0 = sub([before[i * 3], before[i * 3 + 1], before[i * 3 + 2]], ctr);
        if (Math.abs(dot(p0, a)) > 0.5 * local || Math.abs(dot(p0, b)) > 0.5 * local || (sphere && dot(p0, f) <= 0)) continue;
        const h = dot(sub(sub([v[i * 3], v[i * 3 + 1], v[i * 3 + 2]], ctr), p0), sphere ? unit(p0) : f);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      perPass.push([-lo, hi]);
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
    // The same along the stroke through its middle: [x, z, h] (a crossing stroke's column).
    const row = [];
    for (let i = 0; i < n; i++) {
      const p0 = sub([before[i * 3], before[i * 3 + 1], before[i * 3 + 2]], ctr);
      const p1 = sub([v[i * 3], v[i * 3 + 1], v[i * 3 + 2]], ctr);
      const x = dot(p0, a);
      if (Math.abs(dot(p0, b)) >= slab || Math.abs(x) >= r || (sphere && dot(p0, f) <= 0)) continue;
      row.push([x, dot(p1, f), dot(sub(p1, p0), sphere ? unit(p0) : f)]);
    }
    row.sort((a, b) => a[0] - b[0]);
    const mid = dabs[Math.floor(dabs.length / 2)];
    // The deepest cut any dab over the column aimed for (the radius, and
    // with it the depth, changes along the stroke with the view).
    const reach = Math.max(...dabs.filter((q) => Math.abs(q.x - ctr[0]) < q.r).map((q) => q.depthLocal));
    return { hitPlane: hit, r, R, col, row, dab: mid, first: dabs[0], count: dabs.length, reach, perPass };
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

/**
 * In the page: the plane back to rest and alone in view's reach, the Rake's
 * preset and knobs set, and where the plane's middle is on the page.
 */
function cursorSetup({ preset, knobs = {} }) {
  const { session } = window.__sculpt;
  const mesh = session.getMeshes().find((m) => m.__rakePlane);
  const v = mesh.getVertices();
  v.set(mesh.__rest);
  mesh.updateGeometry();
  mesh.updateBuffers?.();
  session.setMesh(mesh);
  const tool = session.getSculptManager().getTool(13);
  if (preset) tool.applyPreset(preset);
  tool.set(knobs);
  const m = mesh.getMatrix();
  const [x, y] = session.getCamera().project([m[12], m[13], m[14]]);
  const rect = session.getCanvas().getBoundingClientRect();
  return [rect.left + x, rect.top + y];
}

/**
 * In the page: what the cursor draws. The ring's and the tine circles'
 * screen points, per closed loop, the probe, the classes, and the world
 * direction of a screen move `dir` (px) at `at` (page px) on the plane.
 */
function cursorRead({ at, dir }) {
  const { session, input } = window.__sculpt;
  const root = document.querySelector('.sculpt-cursor');
  const loops = (d) =>
    (d || '')
      .split('M')
      .filter((x) => x.trim())
      .map((x) =>
        x
          .replace('Z', '')
          .split('L')
          .map((p) => p.trim().split(/\s+/).map(Number)),
      );
  const ring = root.querySelector('.sculpt-cursor__ring--main');
  const tines = root.querySelector('.sculpt-cursor__tines');
  const probe = input.cursor.tineProbe;
  // The screen-space ring, where that is what shows: four points of it
  // stand in for the surface ring's loop, so the layout reads the same.
  const circle = root.querySelector('circle.sculpt-cursor__ring');
  const [sx, sy, sr] = ['cx', 'cy', 'r'].map((k) => Number(circle.getAttribute(k)));
  const onScreen = root.dataset.mode === 'screen';
  const out = {
    mode: root.dataset.mode,
    rake: root.classList.contains('is-rake'),
    ring: onScreen ? [[[sx - sr, sy], [sx, sy - sr], [sx + sr, sy], [sx, sy + sr]]] : loops(ring.getAttribute('d')),
    ringOpacity: Number(getComputedStyle(onScreen ? circle : ring).opacity),
    tinesShown: getComputedStyle(tines).display !== 'none',
    tines: loops(tines.getAttribute('d')),
    stops: [...root.querySelectorAll('.sculpt-cursor__tine-stop')].map((x) => Number(x.getAttribute('stop-opacity') ?? 1)),
    probe: probe && { ...probe, across: [...probe.across], screenAcross: [...probe.screenAcross] },
  };
  if (at && dir) {
    // The world points under the two screen points, through the picking
    // (the plane is alone in reach).
    const rect = session.getCanvas().getBoundingClientRect();
    const pk = session.getPicking();
    const mesh = session.getMeshes().find((m) => m.__rakePlane);
    const m = mesh.getMatrix();
    const world = (x, y) => {
      pk.intersectionMouseMesh(mesh, x - rect.left, y - rect.top);
      const p = pk.getIntersectionPoint();
      return [0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]);
    };
    const a = world(at[0] - dir[0], at[1] - dir[1]);
    const b = world(at[0] + dir[0], at[1] + dir[1]);
    const d = b.map((x, k) => x - a[k]);
    const l = Math.hypot(...d);
    out.motion = d.map((x) => x / l);
  }
  const tool = session.getSculptManager().getTool(13);
  // Off the mesh nothing is picked: the stroke's axis has no mesh to be read in.
  if (tool.strokeAcross && session.getPicking().getMesh()) {
    const m = session.getPicking().getMesh().getMatrix();
    const a = tool.strokeAcross;
    const w = [0, 1, 2].map((k) => m[k] * a[0] + m[4 + k] * a[1] + m[8 + k] * a[2]);
    const l = Math.hypot(...w);
    out.strokeAcross = w.map((x) => x / l);
  }
  return out;
}

/** A loop's centre (its points' mean) and its largest reach from it. */
function loopShape(pts) {
  const c = [0, 1].map((k) => pts.reduce((a, p) => a + p[k], 0) / pts.length);
  return { c, r: Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) };
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const frames = (page, n = 3) =>
  page.evaluate(
    (k) =>
      new Promise((done) => {
        const step = (i) => (i ? requestAnimationFrame(() => step(i - 1)) : done());
        step(k);
      }),
    n,
  );

/** The tine circles against the ring: their count, spacing and size as shares of the ring's reach. */
function tineLayout(c) {
  const ring = loopShape(c.ring[0] ?? [[0, 0]]);
  const shapes = c.tines.map(loopShape);
  // In order along the row: by their projection on the first-to-last line.
  const first = shapes[0]?.c ?? [0, 0];
  const last = shapes[shapes.length - 1]?.c ?? [0, 0];
  const gaps = [];
  for (let i = 1; i < shapes.length; i++) gaps.push(Math.hypot(shapes[i].c[0] - shapes[i - 1].c[0], shapes[i].c[1] - shapes[i - 1].c[1]) / ring.r);
  const mid = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
  return {
    n: shapes.length,
    gaps,
    sizes: shapes.map((s) => s.r / ring.r),
    centred: Math.hypot(mid[0] - ring.c[0], mid[1] - ring.c[1]) / ring.r,
  };
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
        t.ok(Math.abs(s.reach - 0.3) < 1e-9 && Math.abs(deepest(s) - s.reach) < 0.25 * s.reach, `one stroke at the default spacing cuts about the strength, 0.3 cm (${deepest(s).toFixed(3)} for ${s.reach.toFixed(3)})`);
        t.ok(Math.max(...s.col.map(([, , h]) => h)) < 1e-4, 'and raises nothing');
        t.ok(Math.abs(s.dab.spacingFactor * 1.2 - s.dab.stepLocal / s.r) < 1e-6 && Math.abs(s.dab.stepLocal / s.r - 0.06) < 0.02, `each dab cuts its share, step / (1.2 x radius) (step ${(s.dab.stepLocal / s.r).toFixed(3)} of the radius)`);
      }
    }

    // Stop at depth off: a second pass cuts deeper, as the Standard brush does.
    const one = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { scrape: 0, level: false } });
    const two = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { scrape: 0, level: false }, passes: 2 });
    t.ok(Math.abs(deepest(two) / deepest(one) - 2) < 0.2, `a second pass deepens the grooves (${deepest(two).toFixed(3)} after two, ${deepest(one).toFixed(3)} after one)`);
    const twoScraped = await page.evaluate(rakeStroke, { preset: 'coarse', knobs: { level: false }, passes: 2 });
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

    // --- the brush cursor: one circle per tine ------------------------------------
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('7');
    const mid = await page.evaluate(cursorSetup, { preset: 'coarse' });
    // Hover sideways onto the plane's middle.
    const hover = async (from, to, steps = 8) => {
      await page.mouse.move(...from);
      await page.mouse.move(...to, { steps });
      await frames(page);
    };
    await hover([mid[0] - 80, mid[1]], mid);
    let c = await page.evaluate(cursorRead, { at: mid, dir: [20, 0] });
    let lay = tineLayout(c);
    t.ok(c.mode === 'surface' && c.rake && c.probe?.count === 4 && c.probe.source === 'hover', `hovering the plane with the Rake (Coarse) draws its tines (mode ${c.mode}, ${JSON.stringify(c.probe)})`);
    t.eq(lay.n, 4, `four circles, one per tine (${lay.n})`);
    t.ok(lay.gaps.length === 3 && lay.gaps.every((g) => Math.abs(g / 0.5 - 1) < 0.15) && lay.centred < 0.05, `spaced a slot apart, 2 / 4 of the radius, around the middle (${lay.gaps.map((g) => g.toFixed(3)).join(', ')})`);
    t.ok(lay.sizes.every((r) => Math.abs(r / (0.7 / 4) - 1) < 0.15), `each the tine's half-width, 0.7 / 4 of the radius (${lay.sizes.map((r) => r.toFixed(3)).join(', ')})`);
    t.ok(c.ring.length === 1 && c.ringOpacity < 0.5, `inside the brush ring, drawn faint (opacity ${c.ringOpacity})`);
    t.ok(Math.abs(dot3(c.probe.across, c.motion)) < 0.1, `laid across the hover motion, on the surface (across . motion ${dot3(c.probe.across, c.motion).toFixed(3)})`);
    const sideways = c.probe.across;

    // A jitter barely turns them; a move down turns them across it.
    await page.mouse.move(mid[0], mid[1] + 1);
    await frames(page);
    c = await page.evaluate(cursorRead, {});
    const jitter = (Math.acos(Math.min(1, Math.abs(dot3(c.probe.across, sideways)))) * 180) / Math.PI;
    t.ok(jitter < 10, `a 1 px jitter down turns them ${jitter.toFixed(1)} degrees`);
    await hover([mid[0], mid[1] - 80], mid);
    c = await page.evaluate(cursorRead, { at: mid, dir: [0, 20] });
    const turn = (Math.acos(Math.min(1, Math.abs(dot3(c.probe.across, sideways)))) * 180) / Math.PI;
    t.ok(Math.abs(dot3(c.probe.across, c.motion)) < 0.15 && turn > 60, `hovering downward turns them across that (across . motion ${dot3(c.probe.across, c.motion).toFixed(3)}, turned ${turn.toFixed(0)} degrees)`);
    t.eq(tineLayout(c).n, 4, 'still four');

    // Mid-stroke: the stroke's own across axis, and the tines stay drawn.
    // The drag's direction on the plane, measured before it cuts (the
    // picking is the stroke's own once it starts). The drag cuts nothing
    // (Strength 0, Scrape 0): the rake aims each dab from the last one's
    // picked point, and grooves cut under the pointer would move those
    // points and turn its axis a little off the drag.
    await page.evaluate(cursorSetup, { preset: 'coarse', knobs: { strength: 0, scrape: 0 } });
    const { motion: diagonal } = await page.evaluate(cursorRead, { at: [mid[0] + 10, mid[1] + 10], dir: [10, 10] });
    await page.mouse.move(mid[0] - 30, mid[1] - 30);
    await page.mouse.down();
    await page.mouse.move(mid[0] + 30, mid[1] + 30, { steps: 10 });
    await page.waitForTimeout(300);
    await page.mouse.move(mid[0] + 34, mid[1] + 34, { steps: 2 });
    c = await page.evaluate(cursorRead, {});
    c.motion = diagonal;
    await page.mouse.up();
    await frames(page);
    t.ok(c.probe?.source === 'stroke' && c.strokeAcross && Math.abs(dot3(c.probe.across, c.strokeAcross)) > 0.97, `mid-stroke they lie on the rake's own across axis (${c.probe?.source}, across . stroke's ${c.strokeAcross ? dot3(c.probe.across, c.strokeAcross).toFixed(4) : 'none'})`);
    t.ok(Math.abs(dot3(c.probe.across, c.motion)) < 0.1 && tineLayout(c).n === 4, `across the diagonal drag (across . drag ${dot3(c.probe.across, c.motion).toFixed(3)}), all four still drawn under the stroke`);
    c = await page.evaluate(cursorRead, {});
    t.ok(c.probe?.source === 'hover', `after the stroke the hover motion lays them again (${c.probe?.source})`);

    // Comb: twelve. (The stroke may have turned the view's pivot: the
    // plane's middle is read again.)
    const mid2 = await page.evaluate(cursorSetup, { preset: 'comb' });
    mid[0] = mid2[0];
    mid[1] = mid2[1];
    await hover([mid[0] - 80, mid[1]], mid);
    c = await page.evaluate(cursorRead, {});
    lay = tineLayout(c);
    t.ok(lay.n === 12 && c.probe.count === 12, `Comb draws twelve circles (${lay.n})`);
    t.ok(lay.gaps.every((g) => Math.abs(g / (2 / 12) - 1) < 0.15) && lay.sizes.every((r) => Math.abs(r / (0.5 / 12) - 1) < 0.2), `2 / 12 of the radius apart, each 0.5 / 12 of it (gaps ${Math.min(...lay.gaps).toFixed(3)}..${Math.max(...lay.gaps).toFixed(3)}, sizes ${Math.min(...lay.sizes).toFixed(3)}..${Math.max(...lay.sizes).toFixed(3)})`);
    // Taper: the outer circles fade (opacity), their size kept.
    await page.evaluate(cursorSetup, { preset: 'coarse', knobs: { taper: 0.6 } });
    await page.mouse.move(mid[0] + 2, mid[1]);
    await frames(page);
    c = await page.evaluate(cursorRead, {});
    lay = tineLayout(c);
    t.ok(c.stops.join() === `${0.2 + 0.8 * 0.4},1,${0.2 + 0.8 * 0.4}` && lay.sizes.every((r) => Math.abs(r / (0.7 / 4) - 1) < 0.15), `Taper 0.6 fades the circles toward the rim (stop opacities ${c.stops.join(', ')}), the same size`);
    await page.evaluate(cursorSetup, { preset: 'coarse' });

    // The size being set. Over the plane, held b and dragged: the surface
    // ring grows and the tine circles with it.
    const size0 = await page.evaluate(() => window.__sculpt.input.getBrushRadius());
    await hover([mid[0] - 80, mid[1]], mid);
    const rest = await page.evaluate(cursorRead, {});
    const restRing = loopShape(rest.ring[0]).r;
    await page.keyboard.down('b');
    await page.mouse.down();
    await page.mouse.move(mid[0] + 60, mid[1], { steps: 6 });
    await frames(page);
    c = await page.evaluate(cursorRead, {});
    await page.mouse.up();
    await page.keyboard.up('b');
    lay = tineLayout(c);
    const grown = loopShape(c.ring[0]).r;
    t.ok(c.mode === 'surface' && grown > 1.1 * restRing, `held b and dragged over the plane, the surface ring grows (${restRing.toFixed(1)} to ${grown.toFixed(1)} px)`);
    t.ok(
      lay.n === 4 && lay.gaps.every((g) => Math.abs(g / 0.5 - 1) < 0.15) && lay.sizes.every((r) => Math.abs(r / (0.7 / 4) - 1) < 0.15) && lay.centred < 0.05,
      `and its four tine circles with it, the same shares of the ring (gaps ${lay.gaps.map((g) => g.toFixed(3)).join(', ')}, sizes ${lay.sizes.map((r) => r.toFixed(3)).join(', ')})`,
    );
    const surfaceAxis = c.probe.screenAcross;
    // The row those circles stand in on screen, as the probe says it.
    const rowOf = (cur) => {
      const shapes = cur.tines.map(loopShape);
      const a = shapes[0].c;
      const b = shapes[shapes.length - 1].c;
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    };
    const along = (u, v) => Math.abs(u[0] * v[0] + u[1] * v[1]);
    t.ok(along(rowOf(c), surfaceAxis) > 0.99, `the probe keeps the row's direction on screen (${surfaceAxis.map((x) => x.toFixed(2)).join(', ')})`);

    // Off the mesh: the screen-space ring, with the same circles to its scale.
    const off = (await emptySpot(page)) ?? [200, 500];
    await page.mouse.move(off[0] - 6, off[1]);
    await page.mouse.move(off[0], off[1], { steps: 2 });
    await frames(page);
    c = await page.evaluate(cursorRead, {});
    t.eq(c.mode, 'hidden', 'off the plane the cursor is hidden');
    const screenChecks = (cur, what, axis) => {
      const l = tineLayout(cur);
      t.ok(cur.mode === 'screen' && cur.rake && cur.tinesShown && cur.probe?.space === 'screen' && cur.probe.count === 4, `${what}: the screen ring shows, with the Rake's tines in it (mode ${cur.mode}, ${JSON.stringify(cur.probe)})`);
      t.ok(
        l.n === 4 && l.gaps.every((g) => Math.abs(g / 0.5 - 1) < 0.05) && l.sizes.every((r) => Math.abs(r / (0.7 / 4) - 1) < 0.05) && l.centred < 0.02,
        `${what}: four circles a slot apart (2 / 4 of the ring's radius), each 0.7 / 4 of it, around its middle (gaps ${l.gaps.map((g) => g.toFixed(3)).join(', ')}, sizes ${l.sizes.map((r) => r.toFixed(3)).join(', ')})`,
      );
      t.ok(along(rowOf(cur), axis) > 0.99 && along(cur.probe.screenAcross, axis) > 0.999, `${what}: in a row along ${axis.map((x) => x.toFixed(2)).join(', ')} on screen (${rowOf(cur).map((x) => x.toFixed(2)).join(', ')})`);
      return l;
    };
    // Held b off the mesh, then dragged.
    await page.keyboard.down('b');
    await frames(page);
    c = await page.evaluate(cursorRead, {});
    screenChecks(c, 'b held off the mesh', surfaceAxis);
    const ringB = loopShape(c.ring[0]);
    t.ok(Math.abs(ringB.c[0] - off[0]) < 1.5 && Math.abs(ringB.c[1] - off[1]) < 1.5 && c.ringOpacity > 0.8, `the ring at the pointer, as strong as ever (opacity ${c.ringOpacity})`);
    await page.mouse.down();
    await page.mouse.move(off[0] - 40, off[1], { steps: 5 });
    await frames(page);
    const shrunk = await page.evaluate(cursorRead, {});
    await page.mouse.up();
    await page.keyboard.up('b');
    screenChecks(shrunk, 'dragged smaller', surfaceAxis);
    const ringS = loopShape(shrunk.ring[0]).r;
    t.ok(ringS < 0.93 * ringB.r && Math.abs(shrunk.probe.radius - (ringS * 0.7) / 4) < 0.05, `the circles shrink with the ring (${ringB.r.toFixed(1)} to ${ringS.toFixed(1)} px, each ${shrunk.probe.radius.toFixed(2)} px)`);
    // The ] key: the ring flashes where the pointer is, tines in it.
    await page.waitForTimeout(600);
    await page.keyboard.press(']');
    c = await page.evaluate(cursorRead, {});
    screenChecks(c, 'the ] key', surfaceAxis);
    // The size slider: the ring flashes mid-view.
    await page.waitForTimeout(600);
    const view = await page.evaluate((px) => {
      const { input } = window.__sculpt;
      input.setBrushRadius(px);
      const r = input.container.getBoundingClientRect();
      return [r.width / 2, r.height / 2];
    }, size0);
    c = await page.evaluate(cursorRead, {});
    screenChecks(c, 'the size slider', surfaceAxis);
    const ringV = loopShape(c.ring[0]);
    t.ok(Math.abs(ringV.c[0] - view[0]) < 1.5 && Math.abs(ringV.c[1] - view[1]) < 1.5, `mid-view (${ringV.c.map((x) => x.toFixed(0)).join(', ')})`);
    // Taper fades the screen ring's circles as it does the surface's, and
    // a knob moved shows at once.
    c = await page.evaluate(() => {
      const { session, input } = window.__sculpt;
      session.getSculptManager().getTool(13).set({ tines: 6, width: 0.5, taper: 0.6 });
      input.refreshBrushCursor();
    }).then(() => page.evaluate(cursorRead, {}));
    lay = tineLayout(c);
    t.ok(
      c.mode === 'screen' && lay.n === 6 && lay.gaps.every((g) => Math.abs(g / (2 / 6) - 1) < 0.05) && lay.sizes.every((r) => Math.abs(r / (0.5 / 6) - 1) < 0.08) && c.stops.join() === `${0.2 + 0.8 * 0.4},1,${0.2 + 0.8 * 0.4}`,
      `six tapered tines set in the Tool panel show in the screen ring at once (${lay.n} circles, stop opacities ${c.stops.join(', ')})`,
    );
    // With no surface ring drawn yet, the row is level.
    await page.waitForTimeout(600);
    c = await page.evaluate(() => {
      const { input } = window.__sculpt;
      window.__keptAxis = input.cursor.lastAcrossScreen;
      input.cursor.lastAcrossScreen = null;
      input.setBrushRadius(input.getBrushRadius());
    }).then(() => page.evaluate(cursorRead, {}));
    t.ok(c.mode === 'screen' && along(rowOf(c), [1, 0]) > 0.999, `before any surface ring has shown them, the row is level (${rowOf(c).map((x) => x.toFixed(2)).join(', ')})`);
    await page.evaluate(() => {
      window.__sculpt.input.cursor.lastAcrossScreen = window.__keptAxis;
    });
    // Another brush: the screen ring alone.
    await page.waitForTimeout(600);
    await page.keyboard.press('3');
    const size3 = await page.evaluate(() => window.__sculpt.input.getBrushRadius());
    await page.keyboard.press(']');
    c = await page.evaluate(cursorRead, {});
    t.ok(c.mode === 'screen' && !c.rake && c.tines.length === 0 && c.probe === null, `another brush's screen ring has no tines (${c.tines.length} circles)`);
    await page.evaluate((px) => window.__sculpt.input.setBrushRadius(px), size3);
    await page.keyboard.press('7');
    await page.waitForTimeout(600);
    await page.evaluate(cursorSetup, { preset: 'coarse' });
    await page.evaluate((px) => window.__sculpt.input.setBrushRadius(px), size0);
    await page.waitForTimeout(600);

    // Other brushes: the single ring.
    for (const key of ['3', '1', '6']) {
      await page.keyboard.press(key);
      await page.mouse.move(mid[0] - 2, mid[1]);
      await page.mouse.move(mid[0], mid[1]);
      await frames(page);
      c = await page.evaluate(cursorRead, {});
      t.ok(c.mode === 'surface' && !c.rake && c.tines.length === 0 && c.probe === null && c.ring.length === 1 && c.ringOpacity > 0.8, `brush ${key} shows the single ring, no tines (${c.tines.length} circles, ring opacity ${c.ringOpacity})`);
    }
    await page.keyboard.press('7');

    // --- the sphere: a curved, convex form ----------------------------------------
    const onSphere = { sphere: true, radius: 0.5, span: 0.6 };
    await page.evaluate(rakeStroke, { ...onSphere, setup: true });
    await page.waitForTimeout(1000);
    for (const tines of [4, 3]) {
      const s = await page.evaluate(rakeStroke, { ...onSphere, preset: 'coarse', knobs: { tines, width: 0.7, scrape: 0 } });
      const g = dips(s.col, 0.5 * s.reach, s.r / tines);
      t.ok(s.hitPlane && s.count > 20 && s.col.length > 20, `the ${tines}-tine stroke lands on the sphere (${s.count} dabs, ${s.col.length} vertices in the column, radius ${(s.r / s.R).toFixed(2)} of the sphere's)`);
      t.eq(g.length, tines, `${tines} tines cut ${tines} grooves into the sphere (at ${g.map(([y, , h]) => `${(y / s.r).toFixed(2)}:${(h / s.reach).toFixed(2)}`).join(', ')})`);
      t.ok(Math.abs(deepest(s) - s.reach) < 0.25 * s.reach, `about the strength deep (${deepest(s).toFixed(4)} for ${s.reach.toFixed(4)})`);
    }
    // The regression: Invert on a convex form raises even ridges of the
    // depth asked (the old rake aimed each vertex at a height over a plane
    // fitted per dab, raising only what lay below it: on a sphere, a
    // ridge's height came from how far below the passing dabs' planes it
    // sat, the outer ones 2.5 times the depth here, the inner ones 1.1).
    // Stop at depth fits a quadric to the form; at the sphere's quarter
    // radius that is within a few percent, at a brush half the sphere's
    // radius (the brush larger than any sensible one for the curve) the
    // ridges come out up to a quarter low, the grooves up to 30% off, so
    // the large brush is checked to 30% below.
    const sInv = await page.evaluate(rakeStroke, { ...onSphere, radius: 0.25, preset: 'coarse', knobs: { strength: 0.25, scrape: 0, invert: true } });
    const ridges = dips(flip(sInv.col), 0.5 * sInv.reach, sInv.r / 4);
    const rise = Math.max(...sInv.col.map(([, , h]) => h));
    t.ok(
      ridges.length === 4 && ridges.every(([, , h]) => Math.abs(-h / sInv.reach - 1) < 0.25),
      `Invert raises 4 ridges on the sphere, each the strength above the surface, within a quarter (at ${ridges.map(([y, , h]) => `${(y / sInv.r).toFixed(2)}:${(-h / sInv.reach).toFixed(2)}`).join(', ')} of the radius and the depth)`,
    );
    t.ok(rise > 0.75 * sInv.reach && Math.min(...sInv.col.map(([, , h]) => h)) > -1e-3 * sInv.R, `standing about the strength proud of the surface (${rise.toFixed(4)} for ${sInv.reach.toFixed(4)})`);
    const sInvBig = await page.evaluate(rakeStroke, { ...onSphere, preset: 'coarse', knobs: { strength: 0.25, scrape: 0, invert: true } });
    const ridgesBig = dips(flip(sInvBig.col), 0.5 * sInvBig.reach, sInvBig.r / 4);
    t.ok(ridgesBig.length === 4 && ridgesBig.every(([, , h]) => Math.abs(-h / sInvBig.reach - 1) < 0.3), `and with a brush half the sphere's radius, within 30% (${ridgesBig.map(([y, , h]) => `${(y / sInvBig.r).toFixed(2)}:${(-h / sInvBig.reach).toFixed(2)}`).join(', ')})`);
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
        level: [...p.querySelectorAll('label.checkbox')].find((l) => l.textContent === 'Stop at depth')?.querySelector('input').checked,
        curves: [...p.querySelectorAll('.sculpt-panel__curve-label')].map((l) => l.textContent),
        tinePresets: [...p.querySelectorAll('.curve-editor__preset')].map((b) => b.textContent),
        hints: [...p.querySelectorAll('.panel--sculpt .sculpt-panel__extras .sculpt-panel__hint')].map((h) => h.textContent),
      };
    });
    t.ok(
      ['Strength', 'Tines', 'Tine width', 'Scrape', 'Taper'].every((c) => rows.captions.includes(c)) && !rows.captions.includes('Plateau') && !rows.captions.includes('Depth') && rows.invert && rows.curves.join() === 'Tine profile',
      `the rake's rows, with no Depth (the Strength is the groove, in cm): ${rows.captions.join(', ')}, Invert, ${rows.curves.join()}`,
    );
    t.ok(rows.level === true && rows.hints.some((h) => /stands proud/.test(h)), `and Stop at depth, ticked, with its one-line hint (${rows.level}, ${JSON.stringify(rows.hints)})`);
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
        return {
          ...tool.settings(),
          intensity: tool._intensity,
          curve: tool.curve.presetId,
          preset: tool.presetId,
          slider: slider('Tines'),
          scrapeSlider: slider('Scrape'),
          strengthSlider: slider('Strength'),
          rail: parseFloat(document.querySelector('.sculpt-slider[data-kind="strength"] .sculpt-slider__nub').style.bottom),
          lit: document.querySelector('.panel--sculpt .sculpt-panel__presets .sculpt-panel__btn--on')?.textContent,
        };
      });
    };
    const want = { Fine: [8, 'v', 0.15, 0.15], Comb: [12, 'round', 0.1, 0.12], Coarse: [4, 'round', 0.25, 0.3], Chisel: [3, 'flat', 0.5, 0.25], Scraper: [5, 'flat', 1, 0.15] };
    for (const [label, [tines, curve, scrape, cm]] of Object.entries(want)) {
      const got = await pick(label);
      t.ok(
        got.tines === tines && got.curve === curve && got.scrape === scrape && got.taper === 0 && got.preset === label.toLowerCase() && got.slider === tines && got.scrapeSlider === scrape && got.lit === label,
        `${label}: ${tines} ${curve} tines, Scrape ${scrape}, the sliders and the lit button with it (${JSON.stringify(got)})`,
      );
      t.ok(
        got.strength === cm && got.intensity === cm && got.strengthSlider === cm && Math.abs(got.rail - (cm / 5) * 100) < 0.11,
        `${label} sets the strength to ${cm} cm, the Tool panel's Strength and the rail's nub with it (${got.intensity}, slider ${got.strengthSlider}, nub ${got.rail}%)`,
      );
    }
    // Stop at depth: on in every preset; unticked, the rake has it off and the preset unlights.
    const lvl = await page.evaluate(() => {
      const tool = window.__sculpt.session.getSculptManager().getTool(13);
      const presets = ['fine', 'comb', 'coarse', 'chisel', 'scraper'].map((id) => tool.applyPreset(id) && tool.level);
      const box = [...document.querySelectorAll('.panel--sculpt label.checkbox')].find((l) => l.textContent === 'Stop at depth').querySelector('input');
      const was = box.checked;
      box.click();
      return { presets, was, level: tool.level, setting: tool.settings().level, preset: tool.presetId, lit: document.querySelectorAll('.panel--sculpt .sculpt-panel__presets .sculpt-panel__btn--on').length };
    });
    t.ok(lvl.presets.every((x) => x === true) && lvl.was === true, `every preset has Stop at depth on (${lvl.presets.join(', ')})`);
    t.ok(lvl.level === false && lvl.setting === false && lvl.preset === null && lvl.lit === 0, `unticking it turns it off on the rake and unlights the preset (${JSON.stringify(lvl)})`);
    // The strength moved from the rail unlights the preset, as a knob does.
    const strengthMoved = await page.evaluate(() => {
      const { input, session } = window.__sculpt;
      const tool = session.getSculptManager().getTool(13);
      input.setBrushIntensity(0.4);
      return { strength: tool._intensity, preset: tool.presetId, lit: document.querySelectorAll('.panel--sculpt .sculpt-panel__presets .sculpt-panel__btn--on').length };
    });
    t.ok(strengthMoved.strength === 0.4 && strengthMoved.preset === null && strengthMoved.lit === 0, `a strength moved off the preset's (the rail, 0.4 cm) unlights it (${JSON.stringify(strengthMoved)})`);
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
      tool.set({ level: false });
      const bytes = await file.pack();
      const saved = (await file.unpack(bytes)).settings.rake.level;
      tool.applyPreset('comb');
      await file.open(bytes);
      return { ...tool.settings(), curve: tool.curve.presetId, preset: tool.presetId, saved };
    });
    t.ok(back.saved === false && back.level === false, `Stop at depth, off, is saved with the scene and comes back off (saved ${back.saved}, back ${back.level})`);
    t.ok(back.tines === 3 && back.taper === 0.4 && back.scrape === 0.5 && back.curve === 'soft' && back.preset === null, `the knobs and the tine profile come back with the scene (${JSON.stringify(back)})`);

    // A record from before Scrape: its plateau is the scrape.
    const legacy = await page.evaluate(async () => {
      const { file } = window.__sculpt;
      const tool = window.__sculpt.session.getSculptManager().getTool(13);
      const rec = await file.unpack(await file.pack());
      rec.settings.rake = { tines: 6, width: 0.5, depth: 0.07, plateau: 0.35, taper: 0, invert: false, preset: null };
      delete rec.settings.strength;
      delete rec.settings.strengthRev;
      await file.open(await file.packRecord(rec));
      const mapped = { ...tool.settings(), preset: tool.presetId };
      tool.set({ plateau: 0.8 });
      return { mapped, direct: tool.scrape };
    });
    t.ok(legacy.mapped.scrape === 0.35 && legacy.mapped.tines === 6 && !('plateau' in legacy.mapped) && legacy.direct === 0.8, `a saved rake with a plateau opens with it as the scrape (${JSON.stringify(legacy)})`);
    t.ok(legacy.mapped.level === true, `a saved rake without Stop at depth opens with it on, though it was off when the scene opened (${legacy.mapped.level})`);
    t.ok(Math.abs(legacy.mapped.strength - 0.21) < 1e-9 && !('depth' in legacy.mapped), `and its depth 0.07 (of the radius) as the strength, 0.07 x 3 cm = 0.21 cm (${legacy.mapped.strength})`);
  },

  // Stop at depth (owner call, 2026-11-10, to try: "tines cut only where the
  // surface stands above the form and stop at a level"), with strokes as
  // tineRake drives them, Scrape 0 unless said:
  // - on the flat plane one Coarse stroke cuts the strength and the same
  //   stroke again, and three more, add under 15%; with it off each adds a
  //   strength;
  // - a crossing stroke cuts its own four grooves to the same floor, the
  //   crossings no deeper;
  // - a bump under a tine is cut by each pass until its groove is level
  //   with the others, moved further than the even surface; a hollow
  //   below the floor is not cut;
  // - Invert mirrors: ridges to a ceiling, a hollow raised to it, a bump
  //   above it left;
  // - with the default Scrape a second pass planes the lands lower (the
  //   scrape's work, as without Stop at depth), and the grooves stay the
  //   strength below their lands;
  // - on the sphere, at a quarter of its radius, four grooves about the
  //   strength deep and no deeper for more passes.
  async tineRakeLevel(page, base, t) {
    await openForInput(page, base);
    const pct = (x) => `${(100 * x).toFixed(1)}%`;
    const run = (o) => page.evaluate(rakeStroke, { preset: 'coarse', ...o, knobs: { scrape: 0, ...o.knobs } });
    const cuts = (s) => s.perPass.map(([lo]) => lo);
    const rises = (s) => s.perPass.map(([, hi]) => hi);
    const fmt = (a) => a.map((x) => x.toFixed(3)).join(', ');
    /** The column's vertex nearest y = `at`: [y, z, h]. */
    const at = (s, y) => s.col.reduce((best, p) => (Math.abs(p[0] - y) < Math.abs(best[0] - y) ? p : best));

    // --- an even surface: the strength, once -----------------------------------
    const flat = await run({ passes: 5 });
    const d = cuts(flat);
    t.ok(flat.dab.level === true && flat.dab.levelRef && Math.abs(flat.dab.levelRef.offset) < 0.02 * flat.reach, `the Coarse preset rakes with Stop at depth on (reference offset ${flat.dab.levelRef?.offset.toExponential(1)} on the flat)`);
    t.ok(Math.abs(d[0] - flat.reach) < 0.1 * flat.reach, `one stroke on the flat plane cuts the strength, 0.3 cm (${d[0].toFixed(3)})`);
    t.ok(d[1] / d[0] - 1 < 0.15, `the same stroke again adds ${pct(d[1] / d[0] - 1)} (under 15%)`);
    t.ok(d[4] / d[0] - 1 < 0.15 && d[4] - d[3] < 0.01 * d[0] && d[4] < 1.05 * flat.reach, `and five of them ${pct(d[4] / d[0] - 1)} in all: it stops (${fmt(d)})`);
    t.eq(grooves(flat.col, -0.3 * flat.dab.depthLocal).length, 4, 'still four grooves');
    const off = await run({ passes: 3, knobs: { level: false } });
    const dOff = cuts(off);
    t.ok(off.dab.level === false && off.dab.levelRef === null && Math.abs(dOff[1] / dOff[0] - 2) < 0.2 && Math.abs(dOff[2] / dOff[0] - 3) < 0.3, `with it off every stroke cuts a strength deeper, as before (${fmt(dOff)})`);
    // Each preset, as it is but for the Scrape.
    for (const preset of ['fine', 'comb', 'chisel', 'scraper']) {
      const s = await run({ preset, passes: 3 });
      const c = cuts(s);
      t.ok(Math.abs(c[0] - s.reach) < 0.25 * s.reach && c[2] < 1.1 * s.reach, `${preset}: ${c[0].toFixed(3)} for ${s.reach} cm, and two more strokes stop at the floor (${fmt(c)})`);
    }

    // --- cross-hatching ----------------------------------------------------------
    const hatch = await run({ passes: 2, cross: true });
    const hatch4 = await run({ passes: 4, cross: true });
    const h = cuts(hatch4);
    const own = grooves(hatch.row, -0.3 * hatch.dab.depthLocal);
    t.eq(own.length, 4, `a crossing stroke cuts its own four grooves (at ${own.map(([x]) => (x / hatch.r).toFixed(2)).join(', ')} of the radius along the first stroke)`);
    // (A little short of it: the pointer's picked points wander over the
    // first grooves, which turns the tines from dab to dab and spreads the cut.)
    t.ok(own.every(([, , z]) => -z < 1.05 * hatch.reach && -z > 0.75 * hatch.reach), `to the same floor, none past it (${own.map(([, , z]) => (-z).toFixed(3)).join(', ')} for ${hatch.reach})`);
    t.ok(h[1] / h[0] - 1 < 0.15, `and the crossings are no deeper than it: the deepest point after the cross is ${pct(h[1] / h[0] - 1)} lower`);
    // More crossing passes wear the lands between the grooves down (each
    // lands a little beside the last: the pointer picks its way over the
    // grooves), and the floor follows what is left of them.
    const hOff = cuts(await run({ passes: 4, cross: true, knobs: { level: false } }));
    t.ok(h[3] / h[0] - 1 < 0.4 && hOff[1] > 1.7 * hOff[0] && hOff[3] > 3 * h[3] / 1.4, `two more crossing strokes take the deepest point ${pct(h[3] / h[0] - 1)} down in all (${fmt(h)}); with it off the crossings are two strengths deep, then four (${fmt(hOff)})`);

    // --- a bump, a hollow --------------------------------------------------------
    // Under the tine at y = 1.5 cm (a quarter of the radius); the tine at
    // -1.5 runs over the even surface.
    const lump = { sigma: 0.6, y: 1.5 };
    const bump1 = await run({ passes: 1, bump: { ...lump, height: 0.5 } });
    const bump = await run({ passes: 4, bump: { ...lump, height: 0.5 } });
    const [b1, b4, even] = [at(bump1, 1.5), at(bump, 1.5), at(bump, -1.5)];
    t.ok(-b1[2] > 0.8 * bump1.reach && b1[1] > 0.1, `one stroke across a 0.5 cm bump cuts a strength off it and leaves it proud (moved ${b1[2].toFixed(3)}, now at ${b1[1].toFixed(3)})`);
    t.ok(-b4[2] > 2 * -even[2] && Math.abs(-even[2] - bump.reach) < 0.1 * bump.reach, `more strokes lower it further than the even surface (the bump's top moved ${b4[2].toFixed(3)}, the even groove ${even[2].toFixed(3)})`);
    t.ok(Math.abs(b4[1] - even[1]) < 0.1 * bump.reach, `down to the floor the other grooves are at, and there it stops (at ${b4[1].toFixed(3)} and ${even[1].toFixed(3)}; the deepest move per pass ${fmt(cuts(bump))})`);
    const hollow = await run({ passes: 2, bump: { ...lump, height: -0.6 } });
    const [pit, evenH] = [at(hollow, 1.5), at(hollow, -1.5)];
    t.ok(Math.abs(pit[2]) < 0.01 * hollow.reach && pit[1] < -0.5 && Math.abs(-evenH[2] - hollow.reach) < 0.1 * hollow.reach, `a hollow below the floor is not cut (moved ${pit[2].toFixed(4)} at ${pit[1].toFixed(3)}; the even groove ${evenH[2].toFixed(3)})`);
    const hollowOff = await run({ passes: 2, knobs: { level: false }, bump: { ...lump, height: -0.6 } });
    t.ok(-at(hollowOff, 1.5)[2] > 1.5 * hollowOff.reach, `(with it off it is, two strengths: ${at(hollowOff, 1.5)[2].toFixed(3)})`);

    // --- Invert mirrors ----------------------------------------------------------
    const inv = await run({ passes: 5, knobs: { invert: true } });
    const up = rises(inv);
    t.ok(Math.abs(up[0] - inv.reach) < 0.1 * inv.reach && up[4] / up[0] - 1 < 0.15 && Math.max(...cuts(inv)) < 1e-4, `Invert raises ridges a strength high and five strokes add ${pct(up[4] / up[0] - 1)} (${fmt(up)})`);
    t.ok(inv.dab.invert === true && Math.abs(inv.dab.levelRef.offset) < 0.02 * inv.reach, `(the reference on the lower side: offset ${inv.dab.levelRef.offset.toExponential(1)})`);
    const fill = await run({ passes: 4, knobs: { invert: true }, bump: { ...lump, height: -0.5 } });
    const [f4, evenF] = [at(fill, 1.5), at(fill, -1.5)];
    t.ok(f4[2] > 2 * evenF[2] && Math.abs(f4[1] - evenF[1]) < 0.1 * fill.reach, `a hollow is raised to the ridges' ceiling, further than the even surface (moved ${f4[2].toFixed(3)} to ${f4[1].toFixed(3)}; the even ridge ${evenF[2].toFixed(3)} to ${evenF[1].toFixed(3)})`);
    const knob = await run({ passes: 2, knobs: { invert: true }, bump: { ...lump, height: 0.6 } });
    t.ok(Math.abs(at(knob, 1.5)[2]) < 0.01 * knob.reach, `and a bump above the ceiling is not raised (moved ${at(knob, 1.5)[2].toFixed(4)})`);

    // --- the default Scrape ------------------------------------------------------
    // The scrape planes the lands toward the form's mean, old grooves
    // included, so the lands go down with every pass; the grooves stay a
    // strength below them.
    const relief = (s) => {
      const lands = between(s, 0.2).map(([, z]) => z).sort((p, q) => p - q);
      const land = lands[Math.floor(lands.length / 2)];
      const low = Math.min(...s.col.filter(([y]) => Math.abs(y) < 0.5 * s.r).map(([, z]) => z));
      return { land, low, groove: land - low };
    };
    const sc1 = relief(await run({ passes: 1, knobs: { scrape: 0.25 } }));
    const sc2 = relief(await run({ passes: 2, knobs: { scrape: 0.25 } }));
    const sc2off = relief(await run({ passes: 2, knobs: { scrape: 0.25, level: false } }));
    t.ok(Math.abs(sc1.groove - 0.3) < 0.03 && Math.abs(sc1.land) < 0.01, `Coarse as it is (Scrape 0.25): one stroke cuts ${sc1.groove.toFixed(3)} cm under lands at ${sc1.land.toFixed(3)}`);
    t.ok(Math.abs(sc2.groove / sc1.groove - 1) < 0.15 && sc2.land < -0.05, `a second planes the lands to ${sc2.land.toFixed(3)} and the grooves stay ${sc2.groove.toFixed(3)} under them (${pct(sc2.groove / sc1.groove - 1)})`);
    t.ok(sc2.low > sc2off.low && sc2.low < -1.2 * 0.3, `so with Scrape the same stroke again does go deeper, to ${(-sc2.low).toFixed(3)} cm under the first surface (with Stop at depth off, ${(-sc2off.low).toFixed(3)}, ${sc2off.groove.toFixed(3)} under lands at ${sc2off.land.toFixed(3)})`);

    // --- the sphere --------------------------------------------------------------
    const onSphere = { sphere: true, radius: 0.25, span: 0.6 };
    await page.evaluate(rakeStroke, { ...onSphere, setup: true });
    await page.waitForTimeout(1000);
    const ball1 = await run({ ...onSphere, passes: 1 });
    const ball = await run({ ...onSphere, passes: 5 });
    const g1 = dips(ball1.col, 0.5 * ball1.reach, ball1.r / 4);
    const g5 = dips(ball.col, 0.5 * ball.reach, ball.r / 4);
    const each = (g, s) => g.map(([y, , hh]) => `${(y / s.r).toFixed(2)}:${(-hh / s.reach).toFixed(2)}`).join(', ');
    t.ok(g1.length === 4 && g1.every(([, , hh]) => Math.abs(-hh / ball1.reach - 1) < 0.15), `on the sphere (radius ${ball1.r.toFixed(2)} cm on its ${ball1.R.toFixed(1)}) one stroke cuts four grooves a strength deep, the rim's as the middle's (${each(g1, ball1)} of the radius and the strength)`);
    t.ok(g5.length === 4 && g5.every(([, , hh]) => Math.abs(-hh / ball.reach - 1) < 0.15) && cuts(ball)[4] / cuts(ball)[0] - 1 < 0.15, `and five strokes leave them there (${each(g5, ball)}; the deepest per pass ${fmt(cuts(ball))}, ${pct(cuts(ball)[4] / cuts(ball)[0] - 1)} more)`);
    const curve = ball.dab.levelRef.coef;
    t.ok(curve[3] < -0.1 && curve[5] < -0.1, `the reference follows the sphere's curve (x^2 and y^2 terms ${curve[3].toFixed(3)}, ${curve[5].toFixed(3)} cm at the rim)`);
    const big = await run({ ...onSphere, radius: 0.5, passes: 3 });
    const gBig = dips(big.col, 0.5 * big.reach, big.r / 4);
    t.ok(gBig.length === 4 && gBig.every(([, , hh]) => Math.abs(-hh / big.reach - 1) < 0.3), `at half the sphere's radius, where a plane would stand ${(big.r * big.r / (2 * big.R)).toFixed(2)} cm off, the grooves are within 30% of the strength (${each(gBig, big)})`);
  },
};
