// The Smooth brush's Surface mode (owner call, 2026-10-24: an option,
// Average stays the default). On a voxel-remeshed mesh the umbrella
// average reads the connectivity: uneven edges and poles of valence 3 and
// 5 to 8 pull a vertex sideways and in or out, and a smoothed patch keeps
// bumps and dents at the poles. Surface fits the form by distance (a PCA
// plane and a quadratic height field over it) and projects each vertex
// onto it, then evens the triangles with a light tangential Relax.
//
// surfaceSmooth, with strokes driven through the live tool:
// - per-dab time on the default sphere at its top level and on a
//   voxel-remeshed sphere of about 200k vertices, at the app's own brush
//   size and two larger ones, Average beside Surface (reported; Surface
//   at the app's size held well under a frame);
// - quality: the sphere made round (the default sphere is a subdivided
//   cube, a little square, so its best-fit sphere would read its form as
//   error), voxel-remeshed at the same resolution, given radial noise of
//   0.1 of its mean edge, then the same strokes with Average and with
//   Surface. Surface leaves a lower deviation from the best-fit sphere,
//   a lower spread of mean curvature (cotangent Laplacian) at the poles
//   (valence other than 4) and a smaller gap between the poles' mean
//   curvature and the other vertices', and loses no more volume;
//   the clean remesh smoothed: Average adds deviation, Surface removes it;
// - the stroke-start proxy (accumulate off), mirror symmetry and dynamic
//   topology in Surface mode: strokes run, nothing goes NaN, the mirror
//   side moves too;
// - the defaults: Average, Relax 0.25; the Tool panel on Smooth: a Mode
//   select (Average, Surface) and a Relax slider shown only in Surface;
// - Shift's smoothing from another brush uses the Smooth tool's mode;
// - mode and relax ride the scene file; a scene without them opens on
//   Average, and a record of a later revision is left alone.
// Average itself is unchanged, bit for bit: scripts/parity-fixtures.mjs
// --verify --outputs --tol=0 against a recording from before the mode
// (docs/parity-fixtures.md).
import { openForInput, openPanel, screenOf } from './smoke.mjs';

const SMOOTH = 3; // Enums.Tools.SMOOTH
const CLAY = 0; // Enums.Tools.BRUSH

/** The Smooth tool's mode and relax, and the active mesh's vertex count. */
const smoothState = (page) =>
  page.evaluate((idx) => {
    const tool = window.__sculpt.session.getSculptManager().getTool(idx);
    return { mode: tool.smoothMode, relax: tool.relax, n: window.__sculpt.session.getMesh().getNbVertices() };
  }, SMOOTH);

/**
 * In the page: the active mesh (a fresh default sphere with `fresh`), made
 * round (`round`), voxel-remeshed at `res`, and given radial noise of `noise` mean edges
 * (deterministic). Keeps the clean and the noisy positions on the mesh.
 */
function prepare({ fresh = false, round = false, res = 0, noise = 0 }) {
  const { session } = window.__sculpt;
  // A fresh scene: the default sphere again, where the view still looks.
  if (fresh) session.newScene();
  let mesh = session.getMesh();
  const centreOf = (m) => {
    const v = m.getVertices();
    const n = m.getNbVertices();
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], v[i * 3 + k]);
        hi[k] = Math.max(hi[k], v[i * 3 + k]);
      }
    return { c: [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2), r: (hi[0] - lo[0]) / 2 };
  };
  if (round) {
    const { c, r } = centreOf(mesh);
    const v = mesh.getVertices();
    for (let i = 0, n = mesh.getNbVertices(); i < n; i++) {
      const d = [0, 1, 2].map((k) => v[i * 3 + k] - c[k]);
      const l = Math.hypot(...d);
      for (let k = 0; k < 3; k++) v[i * 3 + k] = c[k] + (d[k] / l) * r;
    }
    mesh.updateGeometry();
    mesh.updateBuffers?.();
  }
  let resolution = res;
  if (res) {
    // The remesher refuses a grid this device cannot spare the memory for.
    for (;;) {
      try {
        session.voxelRemesh(resolution);
        break;
      } catch (e) {
        if (resolution <= 120) throw e;
        resolution -= 20;
      }
    }
    mesh = session.getMesh();
  }
  const n = mesh.getNbVertices();
  const v = mesh.getVertices();
  const vrv = mesh.getVerticesRingVertStartCount();
  const ring = mesh.getVerticesRingVert();
  const valence = {};
  let lsum = 0;
  let lcount = 0;
  for (let i = 0; i < n; i++) {
    const c = vrv[i * 2 + 1];
    valence[c] = (valence[c] ?? 0) + 1;
    for (let k = vrv[i * 2]; k < vrv[i * 2] + c; k++) {
      const j = ring[k];
      lsum += Math.hypot(v[i * 3] - v[j * 3], v[i * 3 + 1] - v[j * 3 + 1], v[i * 3 + 2] - v[j * 3 + 2]);
      lcount++;
    }
  }
  const lmean = lsum / lcount;
  const { c, r } = centreOf(mesh);
  mesh.__clean = new Float32Array(v.subarray(0, n * 3));
  let seed = 20261024;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const d = [0, 1, 2].map((k) => v[i * 3 + k] - c[k]);
    const l = Math.hypot(...d);
    const a = rnd() * noise * lmean;
    for (let k = 0; k < 3; k++) v[i * 3 + k] += (d[k] / l) * a;
  }
  mesh.__noisy = new Float32Array(v.subarray(0, n * 3));
  mesh.updateGeometry();
  mesh.updateBuffers?.();
  return { n, faces: mesh.getNbFaces(), valence, lmean, R: r, resolution, name: session.getMeshName(mesh) };
}

/**
 * In the page: Smooth strokes in `mode` across the active mesh's front,
 * through its middle, from -span to +span of its radius, `passes` times,
 * at a local radius of `radius` x the mesh's radius (or the tool's own
 * pixel radius with `radius: 0`). `from` puts the positions back first
 * ('noisy', 'clean') or leaves them ('none'). Returns the per-dab times
 * and, with `measure`, the quality figures over the vertices within 0.6
 * of the radius of a dab centre.
 */
function smoothStrokes({ mode, relax = 0.25, radius = 0.25, span = 0.45, passes = 1, from = 'none', measure = false, restore = false, accumulate = true, symmetry = false }) {
  const { session, tablet, input } = window.__sculpt;
  const manager = session.getSculptManager();
  const tool = manager.getTool(3);
  const mesh = session.getMesh();
  const n = mesh.getNbVertices();
  const v = mesh.getVertices();
  const before = new Float32Array(v.subarray(0, n * 3));
  if (from !== 'none') {
    v.set(from === 'clean' ? mesh.__clean : mesh.__noisy);
    mesh.updateGeometry();
    mesh.updateBuffers?.();
  }
  const start = new Float32Array(v.subarray(0, n * 3));
  manager.setToolIndex(3);
  const keep = { mode: tool.smoothMode, relax: tool.relax, accumulate: tool._accumulate, symmetry: manager._symmetry, radius: tool._radius };
  tool.setSmooth({ mode, relax });
  tool._accumulate = accumulate;
  manager._symmetry = symmetry;
  const d = input.dynamics.get(3);
  const dyn = { ...d };
  tablet.pressure = 0.5;
  tablet.pen = false;
  // The centre and radius of the form, and the frame toward the view.
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], start[i * 3 + k]);
      hi[k] = Math.max(hi[k], start[i * 3 + k]);
    }
  const ctr = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
  const R = (hi[0] - lo[0]) / 2;
  const m = mesh.getMatrix();
  const screen = (p) => session.getCamera().project([0, 1, 2].map((k) => m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k]));
  const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const unit = (p) => {
    const l = Math.hypot(...p);
    return p.map((x) => x / l);
  };
  const picking = session.getPicking();
  const [sx, sy] = screen(ctr);
  picking.intersectionMouseMesh(mesh, sx, sy);
  const P = Array.from(picking.getIntersectionPoint().slice(0, 3));
  picking.intersectionMouseMesh(mesh, sx + 30, sy);
  const d1 = sub(Array.from(picking.getIntersectionPoint().slice(0, 3)), P);
  const f = unit(sub(P, ctr));
  const kk = dot(d1, f);
  const a = unit([d1[0] - f[0] * kk, d1[1] - f[1] * kk, d1[2] - f[2] * kk]);
  const ends = [-span, span].map((x) => {
    const z = Math.sqrt(Math.max(0, 1 - x * x));
    return [0, 1, 2].map((k) => ctr[k] + (a[k] * x + f[k] * z) * R);
  });
  const [x0, y0] = screen(ends[0]);
  const [x1, y1] = screen(ends[1]);
  const times = [];
  const runs = [];
  let local = 0;
  try {
    if (radius > 0) {
      // The pixel radius that gives radius x R on the form: probe once.
      session._mouseX = x0;
      session._mouseY = y0;
      tool._radius = 60;
      if (!manager.start(false)) return { miss: true };
      tool.makeStroke(x0 + 1, y0, picking, null);
      const probe = Math.sqrt(picking.getLocalRadius2());
      manager.end();
      session.getStateManager().cleanNoop();
      v.set(start);
      mesh.updateGeometry();
      tool._radius = (60 * radius * R) / probe;
    }
    for (let pass = 0; pass < passes; pass++) {
      session._mouseX = x0;
      session._mouseY = y0;
      if (!manager.start(false)) return { miss: true };
      const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (tool._spacing * tool._radius * session.getPixelRatio()));
      for (let s = 1; s <= steps; s++) {
        const x = x0 + ((x1 - x0) * s) / steps;
        const y = y0 + ((y1 - y0) * s) / steps;
        session._mouseX = x;
        session._mouseY = y;
        tool.surface.last = null;
        const t0 = performance.now();
        tool.makeStroke(x, y, picking, symmetry ? session.getPickingSymmetry() : null);
        times.push(performance.now() - t0);
        if (tool.lastSurfaceDab) runs.push(tool.lastSurfaceDab);
        local = Math.sqrt(picking.getLocalRadius2());
      }
      tool.updateRender();
      manager.end();
      session.getStateManager().cleanNoop();
    }
  } finally {
    Object.assign(d, dyn);
    tool.setSmooth(keep);
    tool._accumulate = keep.accumulate;
    tool._radius = keep.radius;
    manager._symmetry = keep.symmetry;
  }
  const after = new Float32Array(v.subarray(0, n * 3));
  const med = (xs) => {
    const s = [...xs].sort((p, q) => p - q);
    return s.length ? s[Math.floor(s.length / 2)] : NaN;
  };
  const out = {
    dabs: times.length,
    radius: local / R,
    picked: picking.getPickedVertices().length,
    medianMs: med(times),
    maxMs: Math.max(...times),
    runMs: runs.length ? med(runs.map((r) => r.ms)) : null,
    neighbours: runs.length ? runs[runs.length >> 1].meanNeighbours : null,
    quadric: runs.reduce((s, r) => s + r.quadric, 0),
    plane: runs.reduce((s, r) => s + r.plane, 0),
    finite: after.every((x) => Number.isFinite(x)),
    moved: (() => {
      let mx = 0;
      for (let i = 0; i < n * 3; i++) mx = Math.max(mx, Math.abs(after[i] - start[i]));
      return mx;
    })(),
  };
  if (symmetry) {
    // The mirror side: vertices that moved with x of the other sign from
    // the stroke (the mirror plane is the object's x = its centre).
    let left = 0;
    let right = 0;
    for (let i = 0; i < n; i++) {
      const dd = Math.abs(after[i * 3] - start[i * 3]) + Math.abs(after[i * 3 + 1] - start[i * 3 + 1]) + Math.abs(after[i * 3 + 2] - start[i * 3 + 2]);
      if (dd > 1e-6) {
        if (start[i * 3] < ctr[0]) left++;
        else right++;
      }
    }
    out.sides = [left, right];
  }
  if (measure) {
    const F = mesh.getFaces();
    const nf = mesh.getNbFaces();
    const vrv = mesh.getVerticesRingVertStartCount();
    // The measured band: the same vertices for every run, those within
    // 0.6 of the radius of the stroke's arc (across it) and within its
    // ends less that (along it), by their positions before the stroke.
    const region = [];
    const b = [f[1] * a[2] - f[2] * a[1], f[2] * a[0] - f[0] * a[2], f[0] * a[1] - f[1] * a[0]];
    const r6 = 0.6 * radius * R;
    for (let i = 0; i < n; i++) {
      const p = sub([start[i * 3], start[i * 3 + 1], start[i * 3 + 2]], ctr);
      if (dot(p, f) <= 0) continue;
      if (Math.abs(dot(p, b)) < r6 && Math.abs(dot(p, a)) < span * R - r6) region.push(i);
    }
    const fitSphere = (pos) => {
      const M = Array.from({ length: 4 }, () => new Float64Array(4));
      const b = new Float64Array(4);
      for (const i of region) {
        const row = [2 * pos[i * 3], 2 * pos[i * 3 + 1], 2 * pos[i * 3 + 2], 1];
        const rr = pos[i * 3] ** 2 + pos[i * 3 + 1] ** 2 + pos[i * 3 + 2] ** 2;
        for (let p = 0; p < 4; p++) {
          b[p] += row[p] * rr;
          for (let q = 0; q < 4; q++) M[p][q] += row[p] * row[q];
        }
      }
      for (let k = 0; k < 4; k++) {
        for (let i = k + 1; i < 4; i++) {
          const g = M[i][k] / M[k][k];
          for (let j = k; j < 4; j++) M[i][j] -= g * M[k][j];
          b[i] -= g * b[k];
        }
      }
      const x = new Float64Array(4);
      for (let i = 3; i >= 0; i--) {
        let s = b[i];
        for (let j = i + 1; j < 4; j++) s -= M[i][j] * x[j];
        x[i] = s / M[i][i];
      }
      const c = [x[0], x[1], x[2]];
      const rad = Math.sqrt(x[3] + dot(c, c));
      let dev = 0;
      for (const i of region) dev += (Math.hypot(pos[i * 3] - c[0], pos[i * 3 + 1] - c[1], pos[i * 3 + 2] - c[2]) - rad) ** 2;
      return { c, rad, dev: Math.sqrt(dev / region.length) };
    };
    const volume = (pos) => {
      let V = 0;
      const tri = (p, q, r) => {
        V +=
          (pos[p * 3] * (pos[q * 3 + 1] * pos[r * 3 + 2] - pos[q * 3 + 2] * pos[r * 3 + 1]) -
            pos[p * 3 + 1] * (pos[q * 3] * pos[r * 3 + 2] - pos[q * 3 + 2] * pos[r * 3]) +
            pos[p * 3 + 2] * (pos[q * 3] * pos[r * 3 + 1] - pos[q * 3 + 1] * pos[r * 3])) /
          6;
      };
      for (let k = 0; k < nf; k++) {
        tri(F[k * 4], F[k * 4 + 1], F[k * 4 + 2]);
        if (F[k * 4 + 3] !== 4294967295) tri(F[k * 4], F[k * 4 + 2], F[k * 4 + 3]);
      }
      return V;
    };
    // Mean curvature by the cotangent Laplacian (each quad as two
    // triangles), signed along the outward radial: a measure of the form
    // that does not read the connectivity's valence.
    const curvature = (pos, c) => {
      const L = new Float64Array(n * 3);
      const A = new Float64Array(n);
      const tri = (p, q, r) => {
        const P3 = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
        const pa = P3(p);
        const pb = P3(q);
        const pc = P3(r);
        const cr = (x, y) => [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
        const area = Math.hypot(...cr(sub(pb, pa), sub(pc, pa))) / 2;
        if (!(area > 0)) return;
        const cot = (o, s, t) => {
          const u = sub(s, o);
          const w = sub(t, o);
          return dot(u, w) / Math.hypot(...cr(u, w));
        };
        const add = (i, j, w, pi, pj) => {
          for (let k = 0; k < 3; k++) L[i * 3 + k] += w * (pj[k] - pi[k]);
        };
        const ca = cot(pa, pb, pc);
        const cb = cot(pb, pc, pa);
        const cc = cot(pc, pa, pb);
        add(q, r, ca, pb, pc);
        add(r, q, ca, pc, pb);
        add(r, p, cb, pc, pa);
        add(p, r, cb, pa, pc);
        add(p, q, cc, pa, pb);
        add(q, p, cc, pb, pa);
        A[p] += area / 3;
        A[q] += area / 3;
        A[r] += area / 3;
      };
      for (let k = 0; k < nf; k++) {
        tri(F[k * 4], F[k * 4 + 1], F[k * 4 + 2]);
        if (F[k * 4 + 3] !== 4294967295) tri(F[k * 4], F[k * 4 + 2], F[k * 4 + 3]);
      }
      const stat = (ids) => {
        const hs = ids.map((i) => {
          const rr = [pos[i * 3] - c[0], pos[i * 3 + 1] - c[1], pos[i * 3 + 2] - c[2]];
          return -dot([L[i * 3], L[i * 3 + 1], L[i * 3 + 2]], rr) / Math.hypot(...rr) / (4 * A[i]);
        });
        const mean = hs.reduce((s, h) => s + h, 0) / hs.length;
        return { mean, variance: hs.reduce((s, h) => s + (h - mean) ** 2, 0) / hs.length, count: hs.length };
      };
      return { poles: stat(region.filter((i) => vrv[i * 2 + 1] !== 4)), regular: stat(region.filter((i) => vrv[i * 2 + 1] === 4)) };
    };
    const fitAfter = fitSphere(after);
    const fitStart = fitSphere(start);
    const H = curvature(after, fitAfter.c);
    // Triangle evenness: the spread of the region's edge lengths over their mean.
    const ring = mesh.getVerticesRingVert();
    let es = 0;
    let es2 = 0;
    let ec = 0;
    for (const i of region) {
      for (let k = vrv[i * 2]; k < vrv[i * 2] + vrv[i * 2 + 1]; k++) {
        const j = ring[k];
        const l = Math.hypot(after[i * 3] - after[j * 3], after[i * 3 + 1] - after[j * 3 + 1], after[i * 3 + 2] - after[j * 3 + 2]);
        es += l;
        es2 += l * l;
        ec++;
      }
    }
    const em = es / ec;
    out.quality = {
      region: region.length,
      devBefore: fitStart.dev,
      dev: fitAfter.dev,
      volumeLoss: (volume(start) - volume(after)) / volume(start),
      poles: H.poles,
      regular: H.regular,
      poleGap: Math.abs(H.poles.mean - H.regular.mean),
      edgeSpread: Math.sqrt(Math.max(0, es2 / ec - em * em)) / em,
    };
  }
  if (restore) {
    v.set(before);
    mesh.updateGeometry();
    mesh.updateBuffers?.();
  }
  return out;
}

const ms = (x) => (x == null ? '-' : x.toFixed(2));

export const suites = {
  async surfaceSmooth(page, base, t) {
    await openForInput(page, base);

    // --- the defaults ---------------------------------------------------------
    const def = await smoothState(page);
    t.ok(def.mode === 'average' && def.relax === 0.25, `Smooth starts on Average with Relax 0.25 (${JSON.stringify(def)})`);

    // --- per-dab time: the default sphere at its top level --------------------
    const perf = async (label, sizes) => {
      const lines = [];
      for (const [name, radius] of sizes) {
        const avg = await page.evaluate(smoothStrokes, { mode: 'average', radius, restore: true });
        const sur = await page.evaluate(smoothStrokes, { mode: 'surface', radius, restore: true });
        // Once more, warm.
        const sur2 = await page.evaluate(smoothStrokes, { mode: 'surface', radius, restore: true });
        lines.push({ name, avg, sur: sur2.dabs ? sur2 : sur });
      }
      for (const { name, avg, sur } of lines) {
        t.ok(
          avg.dabs > 3 && sur.dabs > 3 && sur.finite,
          `${label}, ${name} (radius ${sur.radius.toFixed(3)} of the sphere's, ${sur.picked} vertices in the dab, ${sur.neighbours?.toFixed(1)} neighbours each): per dab Average ${ms(avg.medianMs)} ms (max ${ms(avg.maxMs)}), Surface ${ms(sur.medianMs)} ms (max ${ms(sur.maxMs)}, the fit ${ms(sur.runMs)})`,
        );
      }
      return lines;
    };
    const top = await smoothState(page);
    const sizes = [
      ["the app's brush size", 0],
      ['radius 0.1', 0.1],
      ['radius 0.2', 0.2],
    ];
    const p1 = await perf(`the default sphere at its top level (${top.n} vertices)`, sizes);
    t.ok(p1[0].sur.medianMs < 4, `Surface at the app's size stays well under a frame there (${ms(p1[0].sur.medianMs)} ms a dab)`);

    // --- the remeshed sphere, about 200k vertices ------------------------------
    const big = await page.evaluate(prepare, { res: 200 });
    t.ok(big.n > 150000 && big.n < 260000, `the voxel remesh at ${big.resolution}: ${big.n} vertices, valences ${JSON.stringify(big.valence)}`);
    const p2 = await perf(`the remeshed sphere (${big.n} vertices)`, sizes);
    t.ok(p2[1].sur.medianMs < 4, `Surface at radius 0.1 stays well under a frame there (${ms(p2[1].sur.medianMs)} ms a dab)`);
    t.ok(p2[0].sur.medianMs < 1000 / 60, `and at the app's size, ${p2[0].sur.picked} vertices a dab, under one (${ms(p2[0].sur.medianMs)} ms a dab)`);

    // --- quality: round, remeshed, noisy ---------------------------------------
    // A fresh default sphere, made round, remeshed, noise added.
    const prep = await page.evaluate(prepare, { fresh: true, round: true, res: 200, noise: 0.1 });
    t.ok(prep.n > 150000 && (prep.valence[3] ?? 0) + (prep.valence[5] ?? 0) > 1000, `the round sphere remeshed at ${prep.resolution}: ${prep.n} vertices, poles of valence 3, 5 and up among them (${JSON.stringify(prep.valence)}), noise 0.1 of the mean edge (${prep.lmean.toFixed(4)} cm)`);
    const strokes = { radius: 0.25, passes: 8, from: 'noisy', measure: true };
    const avg = await page.evaluate(smoothStrokes, { ...strokes, mode: 'average' });
    const sur = await page.evaluate(smoothStrokes, { ...strokes, mode: 'surface' });
    const qa = avg.quality;
    const qs = sur.quality;
    const L = prep.lmean;
    t.ok(avg.dabs === sur.dabs && avg.dabs > 50 && qa.region === qs.region && qa.region > 2000, `the same strokes for both (${avg.dabs} dabs, ${qa.region} vertices measured)`);
    t.ok(
      qs.dev < qa.dev,
      `Surface leaves a lower deviation from the best-fit sphere: ${(qs.dev / L).toFixed(4)} of the mean edge, Average ${(qa.dev / L).toFixed(4)} (noisy ${(qa.devBefore / L).toFixed(4)})`,
    );
    t.ok(
      qs.poles.variance < qa.poles.variance,
      `less pole artefact: the mean curvature's variance at the poles (${qs.poles.count} vertices of valence other than 4) is ${qs.poles.variance.toExponential(2)} with Surface, ${qa.poles.variance.toExponential(2)} with Average (the others: ${qs.regular.variance.toExponential(2)} and ${qa.regular.variance.toExponential(2)})`,
    );
    t.ok(
      qs.poleGap < qa.poleGap,
      `and the poles' mean curvature sits closer to the others': ${qs.poles.mean.toFixed(5)} against ${qs.regular.mean.toFixed(5)} with Surface, ${qa.poles.mean.toFixed(5)} against ${qa.regular.mean.toFixed(5)} with Average (1/R ${(1 / prep.R).toFixed(5)})`,
    );
    t.ok(qs.volumeLoss <= qa.volumeLoss, `Surface loses no more volume (${(qs.volumeLoss * 100).toFixed(4)}%, Average ${(qa.volumeLoss * 100).toFixed(4)}%)`);
    const q0 = (await page.evaluate(smoothStrokes, { ...strokes, mode: 'surface', relax: 0 })).quality;
    t.ok(
      qs.edgeSpread < q0.edgeSpread && qs.dev < qa.dev,
      `Relax evens the edges: their spread is ${qs.edgeSpread.toFixed(3)} of the mean with Relax 0.25, ${q0.edgeSpread.toFixed(3)} with 0 (Average ${qa.edgeSpread.toFixed(3)}; deviation with Relax 0 ${(q0.dev / L).toFixed(4)})`,
    );
    t.ok(sur.plane === 0 || sur.plane < 0.01 * sur.quadric, `the quadratic fit holds almost everywhere on the sphere (${sur.quadric} quadratic, ${sur.plane} plane fallbacks)`);

    // The clean remesh, smoothed: Average makes it uneven, Surface does not.
    const cleanStrokes = { radius: 0.25, passes: 4, from: 'clean', measure: true };
    const ca = (await page.evaluate(smoothStrokes, { ...cleanStrokes, mode: 'average' })).quality;
    const cs = (await page.evaluate(smoothStrokes, { ...cleanStrokes, mode: 'surface' })).quality;
    t.ok(
      cs.dev <= ca.devBefore * 1.05 && ca.dev > cs.dev,
      `on the clean remesh Average adds deviation (${(ca.devBefore / L).toFixed(4)} to ${(ca.dev / L).toFixed(4)} of the mean edge) and Surface does not (${(cs.dev / L).toFixed(4)})`,
    );

    // --- proxy, symmetry, dynamic topology --------------------------------------
    const proxy = await page.evaluate(smoothStrokes, { mode: 'surface', radius: 0.15, passes: 2, from: 'noisy', accumulate: false });
    t.ok(proxy.finite && proxy.moved > 0, `with accumulate off the fit reads the stroke-start positions: the strokes run (moved up to ${proxy.moved.toExponential(2)})`);
    const sym = await page.evaluate(smoothStrokes, { mode: 'surface', radius: 0.15, span: 0.3, from: 'noisy', symmetry: true });
    t.ok(sym.finite && sym.sides[0] > 100 && sym.sides[1] > 100, `with mirror symmetry both sides are smoothed (${sym.sides.join(' and ')} vertices moved)`);
    const dyn = await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.newScene(); // the default sphere: dynamic topology on a smaller mesh
      return session.toggleDynamicTopology();
    });
    const dynRun = await page.evaluate(smoothStrokes, { mode: 'surface', radius: 0.15, passes: 2 });
    t.ok(dyn && dynRun.finite && dynRun.dabs > 3 && dynRun.moved > 0, `with dynamic topology Surface runs on its rings (${dynRun.dabs} dabs, moved up to ${dynRun.moved.toExponential(2)})`);
    await page.evaluate(() => window.__sculpt.session.toggleDynamicTopology());

    // --- the Tool panel ----------------------------------------------------------
    await page.evaluate((idx) => window.__sculpt.input.selectBrush(idx), SMOOTH);
    t.ok(await openPanel(page, 'Tool'), 'the Tool panel opens on Smooth');
    const panel = () =>
      page.evaluate(() => {
        const p = document.querySelector('.panel--sculpt');
        const sel = p.querySelector('select[aria-label="Smooth mode"]');
        const relax = [...p.querySelectorAll('label.compact')].find((r) => r.firstElementChild?.textContent === 'Relax');
        return {
          heading: p.querySelector('h3')?.textContent,
          options: sel ? [...sel.options].map((o) => o.textContent) : null,
          value: sel?.value,
          relaxShown: !!relax && !relax.hidden,
          relaxValue: relax ? Number(relax.querySelector('input').value) : null,
        };
      });
    const p0 = await panel();
    t.ok(p0.heading === 'Smooth' && p0.options?.join() === 'Average,Surface' && p0.value === 'average' && !p0.relaxShown, `Smooth's rows: Mode (${p0.options?.join(', ')}) on ${p0.value}, no Relax on Average (${JSON.stringify(p0)})`);
    await page.evaluate(() => {
      const sel = document.querySelector('.panel--sculpt select[aria-label="Smooth mode"]');
      sel.value = 'surface';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const pS = await panel();
    const sS = await smoothState(page);
    t.ok(pS.relaxShown && pS.relaxValue === 0.25 && sS.mode === 'surface', `Surface shows Relax at 0.25 and sets the tool (${JSON.stringify(pS)}, ${JSON.stringify(sS)})`);
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.panel--sculpt label.compact')].find((r) => r.firstElementChild?.textContent === 'Relax');
      const input = row.querySelector('input[type=range]');
      input.value = '0.6';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    t.eq((await smoothState(page)).relax, 0.6, 'the Relax slider sets the relax');

    // --- Shift from another brush smooths in the Smooth tool's mode -------------
    await page.evaluate((idx) => window.__sculpt.input.selectBrush(idx), CLAY);
    const shiftStroke = async () => {
      await page.evaluate((idx) => {
        window.__sculpt.session.getSculptManager().getTool(idx).surface.last = null;
      }, SMOOTH);
      const name = await page.evaluate(() => window.__sculpt.session.getMeshName(window.__sculpt.session.getMesh()));
      const [x, y] = await screenOf(page, name);
      await page.keyboard.down('Shift');
      await page.mouse.move(x - 40, y);
      await page.mouse.down();
      for (let k = 1; k <= 6; k++) await page.mouse.move(x - 40 + k * 14, y + k * 3);
      await page.mouse.up();
      await page.keyboard.up('Shift');
      return page.evaluate((idx) => {
        const { session } = window.__sculpt;
        return { surfaceDab: !!session.getSculptManager().getTool(idx).lastSurfaceDab, tool: session.getSculptManager().getToolIndex() };
      }, SMOOTH);
    };
    const shiftS = await shiftStroke();
    t.ok(shiftS.surfaceDab && shiftS.tool === CLAY, `Shift over clay smooths in Surface while Smooth is set to it, and gives clay back (${JSON.stringify(shiftS)})`);
    await page.evaluate((idx) => window.__sculpt.session.getSculptManager().getTool(idx).setSmooth({ mode: 'average' }), SMOOTH);
    const shiftA = await shiftStroke();
    t.ok(!shiftA.surfaceDab && shiftA.tool === CLAY, `and in Average while it is set to that (${JSON.stringify(shiftA)})`);

    // --- the scene file -----------------------------------------------------------
    const saved = await page.evaluate(async (idx) => {
      const { file, session } = window.__sculpt;
      const tool = session.getSculptManager().getTool(idx);
      tool.setSmooth({ mode: 'surface', relax: 0.6 });
      const bytes = await file.pack();
      const rec = await file.unpack(bytes);
      tool.setSmooth({ mode: 'average', relax: 0.25 });
      await file.open(bytes);
      const back = tool.smoothSettings();
      // A scene from before the mode: Average and the default relax.
      tool.setSmooth({ mode: 'surface', relax: 0.9 });
      const old = structuredClone(rec);
      delete old.settings.smooth;
      delete old.settings.smoothRev;
      await file.open(await file.packRecord(old));
      const legacy = tool.smoothSettings();
      // A later revision than this build reads: left alone.
      tool.setSmooth({ mode: 'surface', relax: 0.4 });
      const later = structuredClone(rec);
      later.settings.smoothRev = 99;
      later.settings.smooth = { mode: 'average', relax: 0.1 };
      await file.open(await file.packRecord(later));
      const kept = tool.smoothSettings();
      // A bad value sanitizes away.
      const bad = structuredClone(rec);
      bad.settings.smooth = { mode: 'sideways', relax: 7 };
      await file.open(await file.packRecord(bad));
      const mended = tool.smoothSettings();
      return { stored: rec.settings.smooth, rev: rec.settings.smoothRev, back, legacy, kept, mended };
    }, SMOOTH);
    t.ok(saved.stored?.mode === 'surface' && saved.stored?.relax === 0.6 && saved.rev === 1, `the scene record holds the mode and relax, revision 1 (${JSON.stringify(saved.stored)}, ${saved.rev})`);
    t.ok(saved.back.mode === 'surface' && saved.back.relax === 0.6, `and they come back with the scene (${JSON.stringify(saved.back)})`);
    t.ok(saved.legacy.mode === 'average' && saved.legacy.relax === 0.25, `a scene from before them opens on Average, Relax 0.25 (${JSON.stringify(saved.legacy)})`);
    t.ok(saved.kept.mode === 'surface' && saved.kept.relax === 0.4, `a record of a later revision is left alone (${JSON.stringify(saved.kept)})`);
    t.ok(saved.mended.mode === 'average' && saved.mended.relax === 1, `an unknown mode is dropped and the relax held to 0..1 (${JSON.stringify(saved.mended)})`);
  },
};
