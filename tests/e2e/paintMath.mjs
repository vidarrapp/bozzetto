// Paint: Merge down keeps to the math, and Project paints only what the camera sees.
//
// paintMergeMath: merging a layer into the one below composes the upper layer
//   (its blend mode, opacity and mask) onto the lower layer's own stored colours
//   and the lower keeps its mode, opacity and mask, which count once: merging A
//   into B while B is Overlay gives the same bytes and the same picture as
//   merging into B while B is Normal and then switching B to Overlay. At 50%
//   opacity, with a mask on each, into Base, a fill below or above, a hidden
//   upper layer, inside a group, Dissolve above, a Pass through group; one undo
//   step each.
// paintProjectOwn, paintProjectObjects, paintProjectLevel, paintProjectDynamic:
//   a vertex takes projected colour only where the camera sees the surface. Own:
//   a spike hides part of the sphere behind it (the hidden vertices keep their
//   colour, the visible ones take the picture's), back faces stay as they were,
//   symmetry on, and the same stroke without the depth test paints the hidden
//   ones. Objects: another visible object in front blocks, a hidden one does not,
//   symmetry with it in front and with it hidden. Level: a lower level of the
//   stack. Dynamic: dynamic topology on. Every claim is checked against a
//   brute-force ray test written here over every triangle of every visible object.
// paintProjectSpeed: a Project stroke's time per dab with the depth test off
//   and on, at about 100k and about 1M vertices (the figures go to the output).
import { mkdirSync } from 'node:fs';
import { openForInput, openPanel } from './smoke.mjs';
import { install } from './paint.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/pmath';

/** In the page: layer builders for the merge checks, on window.__pm. */
function installMerge() {
  const S = window.__sculpt;
  const pt = window.__pt;
  const hash = (i, s) => {
    let h = Math.imul(i + 1, 2654435761) ^ Math.imul(s + 7, 40503);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h ^= h >>> 13;
    return h >>> 0;
  };
  const pm = {
    hash,
    reset() {
      const m = pt.mesh();
      for (const l of [...S.session.paint.rawList(m)].reverse()) S.session.paint.remove(m, l);
    },
    /** A layer with deterministic colours and alpha (some vertices empty), a mask on request. */
    make(name, seed, o = {}) {
      const P = S.session.paint;
      const m = pt.mesh();
      let l;
      if (o.fill) l = P.addFill(m, o.fill, name);
      else {
        l = P.add(m, name);
        const n = pt.state().n;
        const d = new Uint8Array(n * 4);
        for (let i = 0; i < n; i++) {
          const h = hash(i, seed);
          const a = h % 7 === 0 ? 0 : h % 3 === 0 ? 255 : 40 + ((h >>> 8) % 200);
          d[i * 4] = (h >>> 3) & 255;
          d[i * 4 + 1] = (h >>> 11) & 255;
          d[i * 4 + 2] = (h >>> 19) & 255;
          d[i * 4 + 3] = a;
        }
        l.rgba = d;
      }
      if (o.mask) {
        const n = pt.state().n;
        const k = new Uint8Array(n);
        for (let i = 0; i < n; i++) k[i] = o.mask === 'half' ? 128 : hash(i, seed + 50) % 4 === 0 ? 0 : 60 + (hash(i, seed + 90) % 196);
        l.mask = k;
        l.maskOn = true;
      }
      P.setMode(m, l, o.mode ?? 'normal');
      P.setOpacity(m, l, o.opacity ?? 1, 'commit');
      if (o.hidden) P.setVisible(m, l, false);
      P.recomposite(m, null);
      return l;
    },
    /** The two layers (and a group when asked), in the state a scenario starts from. */
    build(cfg, lowerMode) {
      pm.reset();
      const P = S.session.paint;
      const m = pt.mesh();
      const B = pm.make('B', 1, { fill: cfg.lowerFill, mode: lowerMode, opacity: cfg.lowerOpacity ?? 1, mask: cfg.lowerMask });
      let G = null;
      if (cfg.group) {
        G = P.group(m, B);
        if (cfg.groupMode) P.setMode(m, G, cfg.groupMode);
        if (cfg.groupOpacity != null) P.setOpacity(m, G, cfg.groupOpacity, 'commit');
      }
      const A = pm.make('A', 2, { fill: cfg.upperFill, mode: cfg.upperMode ?? 'normal', opacity: cfg.upperOpacity ?? 1, mask: cfg.upperMask, hidden: cfg.upperHidden });
      if (G) P.move(m, A, G, 1);
      return { A, B, G };
    },
    grab(l) {
      return { rgba: l.rgba ? Array.from(l.rgba) : null, mask: l.mask ? Array.from(l.mask) : null, mode: l.mode, opacity: l.opacity, kind: l.kind, fill: l.fill };
    },
    /** Merge A into B, then say what B is. */
    merged(cfg, lowerMode, thenMode) {
      const { A, B, G } = pm.build(cfg, lowerMode);
      const m = pt.mesh();
      const P = S.session.paint;
      const depth = pt.depth();
      const bBefore = pm.grab(B);
      P.mergeDown(m, A);
      const steps = pt.depth() - depth;
      const after = pm.grab(B);
      const gone = !P.rawList(m).includes(A);
      if (thenMode) P.setMode(m, B, thenMode);
      const out = { after, colours: Array.from(pt.colours()), steps, gone, groupKept: !!G && P.rawList(m).includes(G), group: G ? { mode: G.mode, opacity: G.opacity } : null, bBefore };
      return out;
    },
    /** The same merge, lower in the mode asked against lower Normal then switched: how many bytes and colours differ. */
    equal(cfg, mode) {
      const a = pm.merged(cfg, mode, null);
      const b = pm.merged(cfg, 'normal', mode);
      let bytes = 0;
      const ra = a.after.rgba;
      const rb = b.after.rgba;
      for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) bytes++;
      let col = 0;
      for (let i = 0; i < a.colours.length; i++) col = Math.max(col, Math.abs(a.colours[i] - b.colours[i]));
      const mk = (x, y) => (x === y) || (x && y && x.length === y.length && x.every((v, i) => v === y[i]));
      return {
        bytes,
        col,
        modeKept: a.after.mode === mode && b.after.mode === 'normal',
        opacityKept: a.after.opacity === (cfg.lowerOpacity ?? 1),
        maskKept: mk(a.after.mask, a.bBefore.mask),
        steps: a.steps,
        gone: a.gone && b.gone,
        groupKept: a.groupKept,
        group: a.group,
        kind: a.after.kind,
        covered: ra.filter((_, i) => i % 4 === 3 && ra[i] > 0).length,
      };
    },
  };
  window.__pm = pm;
}

const eqText = (r) => `${r.bytes} bytes and ${r.col.toExponential(1)} colour apart`;

async function enterPaint(page, base) {
  await openForInput(page, base);
  await page.evaluate(install);
  await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
  const lv = await page.evaluate(() => window.__pt.levels());
  await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
  await page.evaluate(installMerge);
}

/** In the page: what Project's checks share, on window.__pd. */
function installDepth() {
  const S = window.__sculpt;
  const pt = window.__pt;
  const pd = {
    D: new Set(),
    R: [0.9, 0.1, 0.1],
    cx: 0,
    /** The camera's right, up and towards-it directions and its place, from its own matrix. */
    cam() {
      const e = S.viewer.camera.matrixWorld.elements;
      return { right: [e[0], e[1], e[2]], up: [e[4], e[5], e[6]], back: [e[8], e[9], e[10]], eye: [e[12], e[13], e[14]] };
    },
    unit: (v) => {
      const l = Math.hypot(...v);
      return v.map((x) => x / l);
    },
    world(mesh) {
      const m = mesh.getMatrix();
      const v = mesh.getVertices();
      const n = mesh.getNbVertices();
      const w = new Float64Array(n * 3);
      for (let i = 0; i < n; i++) {
        const x = v[i * 3];
        const y = v[i * 3 + 1];
        const z = v[i * 3 + 2];
        w[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        w[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        w[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      return w;
    },
    /** The sphere's world centre and radius, before anything changes it. */
    shape() {
      const b = pt.mesh().computeWorldBound();
      return { c: [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2], R: (b[4] - b[1]) / 2 };
    },
    /** A tall spike on the sphere, 60 degrees off the view axis towards the right: it hides the surface behind it. */
    spike() {
      const mesh = pt.mesh();
      const { c, R } = pd.shape();
      const cam = pd.cam();
      const th = Math.PI / 3;
      const u = pd.unit(cam.back.map((x, k) => Math.cos(th) * x + Math.sin(th) * cam.right[k]));
      const m = mesh.getMatrix();
      // the world direction in the object's own space (the matrices here are a scale and a move, perhaps a turn)
      const inv3 = [
        u[0] * m[0] + u[1] * m[1] + u[2] * m[2],
        u[0] * m[4] + u[1] * m[5] + u[2] * m[6],
        u[0] * m[8] + u[1] * m[9] + u[2] * m[10],
      ];
      const ul = pd.unit(inv3);
      const v = mesh.getVertices();
      const n = mesh.getNbVertices();
      let lc = [0, 0, 0];
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) lc[k] += v[i * 3 + k] / n;
      for (let i = 0; i < n; i++) {
        const d = [v[i * 3] - lc[0], v[i * 3 + 1] - lc[1], v[i * 3 + 2] - lc[2]];
        const len = Math.hypot(...d);
        const a = Math.acos(Math.max(-1, Math.min(1, (d[0] * ul[0] + d[1] * ul[1] + d[2] * ul[2]) / len)));
        if (a < 0.3) {
          const f = 1 + 1.6 * (1 - a / 0.3);
          for (let k = 0; k < 3; k++) v[i * 3 + k] = lc[k] + d[k] * f;
        }
      }
      mesh.updateGeometry();
      mesh.updateDuplicateColorsAndMaterials?.();
      mesh.updateBuffers?.();
      // where the pointer goes: on the spike, a third of the way up
      const at = c.map((x, k) => x + u[k] * R * 1.5);
      return { u, at, R, c };
    },
    screen(p) {
      return S.session.getCamera().project(p);
    },
    /** Orbit the camera about the view's up axis through the sphere's centre (for a picture from another side); `0` puts it back. */
    orbit(deg) {
      if (!pd.home) pd.home = S.viewer.controls.getState();
      const p = pd.home.position;
      const c = pd.home.target;
      if (deg === 0) {
        S.viewer.controls.setState(p, c);
        pd.home = null;
        return;
      }
      const u = pd.cam().up;
      const th = (deg * Math.PI) / 180;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      const v = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
      const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const q = [0, 1, 2].map((k) => c[k] + v[k] * cs + cr[k] * sn + u[k] * d * (1 - cs));
      S.viewer.controls.setState(q, c);
    },
    /** A small cube in front of the sphere, left of the view's centre; the pointer goes on the sphere right of it, and the dab reaches behind the cube. */
    blockerScene() {
      const { session } = S;
      const sphere = session.getMesh();
      const s = pd.shape();
      const cam = pd.cam();
      const cube = session.addPrimitive('cube');
      const m = cube.getMatrix();
      for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) m[k] *= 0.3;
      const b = cube.computeWorldBound();
      const cc = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      const want = [0, 1, 2].map((k) => s.c[k] + cam.back[k] * 1.6 * s.R - cam.right[k] * 0.3 * s.R);
      for (let k = 0; k < 3; k++) m[12 + k] += want[k] - cc[k];
      session.setMesh(sphere);
      window.__cube = cube;
      pd.sphere = sphere;
      const [x, y] = pd.screen([0, 1, 2].map((k) => s.c[k] + cam.right[k] * 0.35 * s.R));
      return { x, y, R: s.R };
    },
    /** One Project dab-stroke at a device pixel, with symmetry or not; the dab's vertices are kept in pd.D. */
    dab(x, y, radius, sym, n = 3) {
      const { session, tablet } = S;
      const mgr = session.getSculptManager();
      mgr._symmetry = !!sym;
      mgr.setToolIndex(19);
      const t = mgr.getTool(19);
      if (!t.__wrapped) {
        const orig = t.colours;
        t.colours = function (iv, p) {
          for (let i = 0; i < iv.length; i++) pd.D.add(iv[i]);
          return orig.call(this, iv, p);
        };
        t.__wrapped = true;
      }
      const rect = session.getCanvas().getBoundingClientRect();
      const ratio = session.getPixelRatio();
      pd.cx = x;
      t.source = { ready: () => true, sample: (cx) => ((cx - rect.left) * ratio < x ? [1, 0, 0] : [0, 0, 1]) };
      t._radius = radius;
      t._intensity = 1;
      tablet.pressure = 0.5;
      tablet.pen = false;
      session._mouseX = x;
      session._mouseY = y;
      if (!mgr.start(false)) return false;
      // the pointer must be on the sphere, not on an object in front of it
      if (pd.sphere && session.getMesh() !== pd.sphere) return false;
      const picking = session.getPicking();
      const pickingSym = sym ? session.getPickingSymmetry() : null;
      for (let i = 0; i < n; i++) t.makeStroke(x + i * 0.01, y, picking, pickingSym);
      t.updateRender();
      mgr.end();
      session.getStateManager().cleanNoop();
      return true;
    },
    /**
     * For every vertex the dab handed over: hidden for sure (a ray to the eye, lifted 1% of the radius off the
     * surface, still hits a visible object's triangle) or visible for sure (none at no lift), by testing every
     * triangle of every visible object. Hidden poly groups are not in these scenes.
     */
    classify(ids, R) {
      const own = pt.mesh();
      const cam = pd.cam();
      const meshes = [own, ...S.session.getMeshes().filter((m) => m !== own && m.isVisible())];
      const tris = meshes.map((mesh) => {
        const w = pd.world(mesh);
        const f = mesh.getFaces();
        const nv = mesh.getNbVertices();
        const list = [];
        const nf = mesh.getNbFaces();
        for (let i = 0; i < nf; i++) {
          const a = f[i * 4];
          const b = f[i * 4 + 1];
          const c = f[i * 4 + 2];
          const q = f[i * 4 + 3];
          list.push([a, b, c]);
          if (q < nv) list.push([a, c, q]);
        }
        return { mesh, w, list };
      });
      const m = own.getMatrix();
      const nrm = own.getNormals();
      const ow = tris[0].w;
      const hit = (id, lift) => {
        const nx = nrm[id * 3];
        const ny = nrm[id * 3 + 1];
        const nz = nrm[id * 3 + 2];
        const wn = pd.unit([m[0] * nx + m[4] * ny + m[8] * nz, m[1] * nx + m[5] * ny + m[9] * nz, m[2] * nx + m[6] * ny + m[10] * nz]);
        const o = [ow[id * 3] + wn[0] * lift, ow[id * 3 + 1] + wn[1] * lift, ow[id * 3 + 2] + wn[2] * lift];
        const d = [cam.eye[0] - o[0], cam.eye[1] - o[1], cam.eye[2] - o[2]];
        const len = Math.hypot(...d);
        d[0] /= len;
        d[1] /= len;
        d[2] /= len;
        for (let mi = 0; mi < tris.length; mi++) {
          const { w, list } = tris[mi];
          for (const [a, b, c] of list) {
            if (mi === 0 && (a === id || b === id || c === id)) continue;
            const ax = w[a * 3];
            const ay = w[a * 3 + 1];
            const az = w[a * 3 + 2];
            const e1x = w[b * 3] - ax;
            const e1y = w[b * 3 + 1] - ay;
            const e1z = w[b * 3 + 2] - az;
            const e2x = w[c * 3] - ax;
            const e2y = w[c * 3 + 1] - ay;
            const e2z = w[c * 3 + 2] - az;
            const px = d[1] * e2z - d[2] * e2y;
            const py = d[2] * e2x - d[0] * e2z;
            const pz = d[0] * e2y - d[1] * e2x;
            const det = e1x * px + e1y * py + e1z * pz;
            if (Math.abs(det) < 1e-18) continue;
            const tx = o[0] - ax;
            const ty = o[1] - ay;
            const tz = o[2] - az;
            const u = (tx * px + ty * py + tz * pz) / det;
            if (u < 0 || u > 1) continue;
            const qx = ty * e1z - tz * e1y;
            const qy = tz * e1x - tx * e1z;
            const qz = tx * e1y - ty * e1x;
            const v = (d[0] * qx + d[1] * qy + d[2] * qz) / det;
            if (v < 0 || u + v > 1) continue;
            const tt = (e2x * qx + e2y * qy + e2z * qz) / det;
            if (tt > 0 && tt < len) return true;
          }
        }
        return false;
      };
      const hidden = [];
      const visible = [];
      for (const id of ids) {
        if (hit(id, 0.01 * R)) hidden.push(id);
        else if (!hit(id, 0)) visible.push(id);
      }
      return { hidden, visible };
    },
    /** What each vertex did: 0 untouched, 1 painted red-ward, 2 painted blue-ward, 3 painted something else. */
    fate(name, ids) {
      const x = pt.colours();
      const y = pt.snaps[name];
      const out = new Map();
      for (const i of ids) {
        const d = [x[i * 3] - y[i * 3], x[i * 3 + 1] - y[i * 3 + 1], x[i * 3 + 2] - y[i * 3 + 2]];
        const mag = Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]);
        let f = 0;
        if (mag > 0.02) f = d[0] >= -1e-6 && d[1] <= 1e-6 && d[2] <= 1e-6 ? 1 : d[2] >= -1e-6 && d[0] <= 1e-6 && d[1] <= 1e-6 ? 2 : 3;
        else if (mag > 1e-6) f = 4;
        out.set(i, f);
      }
      return out;
    },
    /** One scenario's verdict: counts the test asserts on. */
    verdict(name, R) {
      const ids = [...pd.D];
      const cls = pd.classify(ids, R);
      const fate = pd.fate(name, ids);
      const w = pd.world(pt.mesh());
      const side = (i) => (S.session.getCamera().project([w[i * 3], w[i * 3 + 1], w[i * 3 + 2]])[0] < pd.cx ? 1 : 2);
      let hiddenTouched = 0;
      let hiddenAll = cls.hidden.length;
      for (const i of cls.hidden) if (fate.get(i) !== 0) hiddenTouched++;
      let right = 0;
      let wrong = 0;
      let paintedVisible = 0;
      for (const i of cls.visible) {
        const f = fate.get(i);
        if (f === 0 || f === 4) continue;
        paintedVisible++;
        if (f === side(i)) right++;
        else wrong++;
      }
      // everything painted at all must be a vertex that is not hidden for sure
      let paintedHidden = 0;
      const hs = new Set(cls.hidden);
      for (const [i, f] of fate) if (f !== 0 && hs.has(i)) paintedHidden++;
      return { dab: ids.length, hiddenAll, hiddenTouched, paintedHidden, paintedVisible, right, wrong, visible: cls.visible.length };
    },
  };
  window.__pd = pd;
}

const show = (v) => JSON.stringify(v);

async function prepDepth(page, base) {
  await enterPaint(page, base);
  await page.evaluate(installDepth);
}

function asserts(t, name, v, minHidden = 10) {
  t.ok(v.hiddenAll >= minHidden, `${name}: ${v.hiddenAll} vertices of the dab are hidden from the camera (a scene where it matters)`);
  t.ok(v.hiddenTouched === 0 && v.paintedHidden === 0, `${name}: the hidden vertices keep their colour (${v.hiddenTouched} of ${v.hiddenAll} touched)`);
  t.ok(v.paintedVisible > 20 && v.wrong === 0, `${name}: the visible ones take the picture's colours: ${v.right} on the right side of the picture, ${v.wrong} wrong, of ${v.visible} visible`);
}

export const suites = {
  async paintMergeMath(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await enterPaint(page, base);
    const eq = (cfg, mode) => page.evaluate(([c, m]) => window.__pm.equal(c, m), [cfg, mode]);

    // The owner's example, as written: merge A into B while B is Overlay, against merge A into B while B is Normal, then B to Overlay.
    let r = await eq({ upperMode: 'multiply', upperOpacity: 0.8 }, 'overlay');
    t.ok(r.covered > 1000, `the layers have colour to merge (${r.covered} vertices on the lower one)`);
    t.ok(r.bytes === 0 && r.col === 0, `A into an Overlay B equals A into a Normal B then Overlay: the same bytes and the same picture (${eqText(r)})`);
    t.ok(r.modeKept && r.opacityKept && r.gone, `B keeps Overlay and its opacity, and A is gone (${show({ modeKept: r.modeKept, opacityKept: r.opacityKept })})`);

    // Other upper modes and a lower layer at 50%.
    for (const upperMode of ['normal', 'screen', 'color-dodge', 'hue', 'difference']) {
      r = await eq({ upperMode, upperOpacity: 0.7, lowerOpacity: 0.5 }, 'overlay');
      t.ok(r.bytes === 0 && r.col === 0, `the lower at 50%, the upper ${upperMode} at 70%: equal (${eqText(r)})`);
    }
    r = await eq({ upperMode: 'multiply', lowerOpacity: 0.5 }, 'soft-light');
    t.ok(r.bytes === 0 && r.col === 0 && r.opacityKept, `a lower Soft light at 50% keeps its 50% and equals (${eqText(r)})`);

    // A mask on each: the lower's keeps applying once, afterwards.
    r = await eq({ upperMode: 'multiply', upperMask: true, lowerMask: true }, 'overlay');
    t.ok(r.bytes === 0 && r.col === 0, `a mask on each: equal (${eqText(r)})`);
    t.ok(r.maskKept, "and the lower layer's mask is as it was, not baked in and not dropped");
    r = await eq({ upperMode: 'overlay', upperMask: true, lowerMask: true, lowerOpacity: 0.5, upperOpacity: 0.6 }, 'color-burn');
    t.ok(r.bytes === 0 && r.col === 0 && r.maskKept, `masks, 50% and 60%, a lower Colour burn: equal (${eqText(r)})`);

    // The mask counts once: the stored alpha is merged as it is.
    const once = await page.evaluate(() => {
      const pm = window.__pm;
      const pt = window.__pt;
      pm.reset();
      const P = window.__sculpt.session.paint;
      const m = pt.mesh();
      const n = pt.topN();
      const B = pm.make('B', 1, { mask: 'half' });
      const A = pm.make('A', 2);
      const bd = new Uint8Array(n * 4);
      const ad = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        bd[i * 4] = 200;
        bd[i * 4 + 1] = 40;
        bd[i * 4 + 2] = 40;
        bd[i * 4 + 3] = 128;
        ad[i * 4] = 20;
        ad[i * 4 + 1] = 220;
        ad[i * 4 + 2] = 90;
        ad[i * 4 + 3] = 128;
      }
      B.rgba = bd;
      A.rgba = ad;
      P.recomposite(m, null);
      P.mergeDown(m, A);
      const ab = 128 / 255;
      const as = 128 / 255;
      const ar = ab + as * (1 - ab);
      const k = as / ar;
      const want = [200, 40, 40].map((cb, c) => Math.round((1 - k) * cb + k * [20, 220, 90][c]));
      const o = B.rgba;
      let off = 0;
      for (let i = 0; i < n; i++) off = Math.max(off, Math.abs(o[i * 4 + 3] - 255 * ar), Math.abs(o[i * 4] - want[0]), Math.abs(o[i * 4 + 1] - want[1]), Math.abs(o[i * 4 + 2] - want[2]));
      return { off, alpha: o[3], want: Math.round(255 * ar), maskKept: !!B.mask && B.mask[0] === 128 };
    });
    t.ok(once.off <= 1 && once.maskKept, `the lower's mask is not multiplied into its alpha (stored alpha ${once.alpha}, expected ${once.want}; off by ${once.off}); the mask stays at 50%`);

    // Into Base: what shows is what showed; the picture is exact; one undo step; the lowest layer only.
    for (const cfg of [{ upperMode: 'multiply', upperOpacity: 0.7, upperMask: true }, { upperMode: 'overlay' }, { upperMode: 'dissolve', upperOpacity: 0.6 }, { upperFill: [0.3, 0.6, 0.9], upperMode: 'soft-light', upperOpacity: 0.8 }]) {
      const b = await page.evaluate((c) => {
        const pm = window.__pm;
        const pt = window.__pt;
        pm.reset();
        const P = window.__sculpt.session.paint;
        const m = pt.mesh();
        const A = pm.make('A', 2, { fill: c.upperFill, mode: c.upperMode, opacity: c.upperOpacity, mask: c.upperMask });
        pt.snap('beforeBase');
        const d0 = pt.depth();
        P.mergeDown(m, A);
        const diff = pt.diff('beforeBase');
        const steps = pt.depth() - d0;
        const left = P.rawList(m).length;
        pt.undo();
        return { diff, steps, left, back: pt.diff('beforeBase'), layers: P.rawList(m).length };
      }, cfg);
      t.ok(b.diff < 1e-6 && b.left === 0 && b.back === 0 && b.layers === 1, `into Base (${cfg.upperMode}${cfg.upperFill ? ', a fill' : ''}): the picture is as it was (${b.diff.toExponential(1)}), one undo brings the layer back (${show(b)})`);
    }

    // A fill layer below: it becomes an ordinary layer and keeps its mode; a fill above merges its colour everywhere.
    r = await eq({ lowerFill: [0.2, 0.5, 0.8], upperMode: 'screen', upperOpacity: 0.6 }, 'overlay');
    t.ok(r.bytes === 0 && r.col === 0 && r.kind === 'layer', `a fill layer below becomes an ordinary layer and equals (${eqText(r)}, ${r.kind})`);
    r = await eq({ upperFill: [0.9, 0.3, 0.2], upperMode: 'hard-light', upperOpacity: 0.5, lowerOpacity: 0.8 }, 'multiply');
    t.ok(r.bytes === 0 && r.col === 0, `a fill layer above merges as it is: equal (${eqText(r)})`);

    // A hidden upper layer adds nothing and is gone.
    const hid = await page.evaluate(() => {
      const pm = window.__pm;
      const { A, B } = pm.build({ upperMode: 'multiply', upperHidden: true }, 'overlay');
      const before = pm.grab(B);
      window.__sculpt.session.paint.mergeDown(window.__pt.mesh(), A);
      const after = pm.grab(B);
      return { same: before.rgba.every((v, i) => v === after.rgba[i]), gone: !window.__sculpt.session.paint.rawList(window.__pt.mesh()).includes(A) };
    });
    t.ok(hid.same && hid.gone, 'a hidden upper layer adds nothing to the lower and is removed');

    // Dissolve above.
    r = await eq({ upperMode: 'dissolve', upperOpacity: 0.6 }, 'overlay');
    t.ok(r.bytes === 0 && r.col === 0, `a Dissolve upper layer: equal (${eqText(r)})`);

    // Inside a group, and under a Pass through group at 60%: the group stays as it is.
    r = await eq({ group: true, upperMode: 'multiply', upperOpacity: 0.8 }, 'overlay');
    t.ok(r.bytes === 0 && r.col === 0 && r.groupKept, `two layers in a group: equal (${eqText(r)})`);
    r = await eq({ group: true, groupMode: 'pass', groupOpacity: 0.6, upperMode: 'screen', upperMask: true, lowerMask: true }, 'overlay');
    t.ok(r.bytes === 0 && r.col === 0 && r.groupKept && r.group.mode === 'pass' && r.group.opacity === 0.6, `inside a Pass through group at 60%: equal, the group keeps its mode and opacity (${eqText(r)}, ${show(r.group)})`);
    r = await eq({ group: true, groupMode: 'multiply', groupOpacity: 0.7, upperMode: 'overlay' }, 'soft-light');
    t.ok(r.bytes === 0 && r.col === 0 && r.groupKept && r.group.mode === 'multiply', `inside a Multiply group: equal, the group is untouched (${eqText(r)})`);

    // One undo step each: the merge undone gives both layers back with their bytes.
    const undo = await page.evaluate(() => {
      const pm = window.__pm;
      const pt = window.__pt;
      const { A, B } = pm.build({ upperMode: 'multiply', upperOpacity: 0.8, lowerMask: true, upperMask: true, lowerOpacity: 0.5 }, 'overlay');
      pt.snap('pre');
      const a0 = pm.grab(A);
      const b0 = pm.grab(B);
      const d = pt.depth();
      window.__sculpt.session.paint.mergeDown(pt.mesh(), A);
      pt.undo();
      const list = window.__sculpt.session.paint.rawList(pt.mesh());
      const A1 = list.find((l) => l.name === 'A');
      const B1 = list.find((l) => l.name === 'B');
      const same = (x, y) => x.rgba.every((v, i) => v === y.rgba[i]) && (x.mask === null ? y.mask === null : x.mask.every((v, i) => v === y.mask[i])) && x.mode === y.mode && x.opacity === y.opacity;
      return { back: !!A1 && !!B1 && same(a0, pm.grab(A1)) && same(b0, pm.grab(B1)), diff: pt.diff('pre') };
    });
    t.ok(undo.back && undo.diff === 0, `one undo step brings back both layers, their bytes, masks and the picture (${show(undo)})`);
  },

  async paintDynamicAsks(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.add(window.__pt.mesh());
      window.__pt.stroke(window.__pt.T.PAINT, [0.9, 0.2, 0.1], 0, 0, 60, 1);
    });
    await page.evaluate(() => window.__sculpt.paintWorkspace.leave());
    t.ok(await openPanel(page, 'Model'), 'the Model panel opens');
    const asked = [];
    let answer = false;
    page.on('dialog', (d) => {
      asked.push(d.message());
      return answer ? d.accept() : d.dismiss();
    });
    const state = () =>
      page.evaluate(() => {
        const { session } = window.__sculpt;
        const m = session.getMesh();
        return { dyn: session.isDynamicTopology(), paint: session.paint.rawList(m).length, sculpt: session.layers.list(m).length };
      });
    const flip = async () => {
      asked.length = 0;
      await page.evaluate(() => [...document.querySelectorAll('label')].find((l) => /Dynamic topology/.test(l.textContent))?.querySelector('input').click());
      await page.waitForFunction(() => document.querySelector('.bz-ask') === null, null, { timeout: 20_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
    };
    const round = async (name, words, expect) => {
      answer = false;
      await flip();
      t.eq(asked.length, 1, `${name}: turning dynamic topology on asks once`);
      t.ok(/flattened/.test(asked[0] ?? ''), `${name}: and the question says it flattens (${(asked[0] ?? '').replace(/\s+/g, ' ')})`);
      if (words) t.ok(asked[0].includes(words), `${name}: it names "${words}"`);
      let st = await state();
      t.ok(!st.dyn && st.paint === expect.paint && st.sculpt === expect.sculpt, `${name}: Cancel leaves the switch off and the layers as they were (${JSON.stringify(st)})`);
      answer = true;
      await flip();
      st = await state();
      t.eq(asked.length, 1, `${name}: still one question when answered yes`);
      t.ok(st.dyn && st.paint === 0 && st.sculpt === 0, `${name}: yes turns it on and flattens the layers (${JSON.stringify(st)})`);
      await page.evaluate(() => window.__sculpt.session.undo());
      await page.waitForTimeout(300);
      st = await state();
      t.ok(!st.dyn && st.paint === expect.paint && st.sculpt === expect.sculpt, `${name}: one undo brings back the static object and its layers (${JSON.stringify(st)})`);
    };
    await round('only paint layers', 'paint layers', { paint: 1, sculpt: 0 });
    // Only sculpt layers.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMesh();
      for (const l of [...session.paint.rawList(m)].reverse()) session.paint.remove(m, l);
      session.layers.add(m);
    });
    await round('only sculpt layers', 'sculpt layers', { paint: 0, sculpt: 1 });
    // Both.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.add(session.getMesh());
    });
    await round('both kinds', 'sculpt and paint layers', { paint: 1, sculpt: 1 });
  },

  async paintProjectOwn(page, base, t) {
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    await prepDepth(page, base);
    // A spike hides part of the sphere behind it. Project on it, a two-colour picture, with a layer.
    const sp = await page.evaluate(() => {
      const pd = window.__pd;
      const s = pd.spike();
      window.__sculpt.session.paint.add(window.__pt.mesh(), 'Projected');
      window.__pt.snap('pre');
      const [x, y] = pd.screen(s.at);
      window.__spike = s;
      return { x, y, R: s.R };
    });
    await page.screenshot({ path: `${SHOTS}/spike-1180.png` });
    t.ok(await page.evaluate(([x, y]) => window.__pd.dab(x, y, 220, false), [sp.x, sp.y]), 'a Project stroke lands on the spike');
    asserts(t, 'own surface (the spike)', await page.evaluate((R) => window.__pd.verdict('pre', R), sp.R));
    await page.screenshot({ path: `${SHOTS}/spike-projected-1180.png` });

    // Back faces are untouched.
    const back = await page.evaluate(() => {
      const pt = window.__pt;
      const m = pt.mesh();
      const n = m.getNormals();
      const f = window.__pd.cam().back;
      const mm = m.getMatrix();
      let away = 0;
      let touched = 0;
      const x = pt.colours();
      const y = pt.snaps.pre;
      for (let i = 0; i < m.getNbVertices(); i++) {
        const wx = mm[0] * n[i * 3] + mm[4] * n[i * 3 + 1] + mm[8] * n[i * 3 + 2];
        const wy = mm[1] * n[i * 3] + mm[5] * n[i * 3 + 1] + mm[9] * n[i * 3 + 2];
        const wz = mm[2] * n[i * 3] + mm[6] * n[i * 3 + 1] + mm[10] * n[i * 3 + 2];
        if (wx * f[0] + wy * f[1] + wz * f[2] < -0.05) {
          away++;
          if (Math.abs(x[i * 3] - y[i * 3]) + Math.abs(x[i * 3 + 1] - y[i * 3 + 1]) + Math.abs(x[i * 3 + 2] - y[i * 3 + 2]) > 1e-6) touched++;
        }
      }
      return { away, touched };
    });
    t.ok(back.away > 500 && back.touched === 0, `back faces are untouched (${back.touched} of ${back.away})`);

    // Symmetry on: the mirrored dab is tested against the same camera, so what the spike hides stays as it was.
    await page.evaluate(() => {
      window.__pt.undo();
      window.__pd.D.clear();
      window.__pt.snap('pre');
    });
    t.ok(await page.evaluate(([x, y]) => window.__pd.dab(x, y, 220, true), [sp.x, sp.y]), 'a Project stroke with symmetry on lands');
    asserts(t, 'own surface, symmetry on', await page.evaluate((R) => window.__pd.verdict('pre', R), sp.R));

    // For comparison, the same stroke without the depth test paints the hidden vertices too (what it did before).
    await page.evaluate(() => {
      window.__pt.undo();
      window.__pd.D.clear();
      window.__pt.snap('pre');
      window.__sculpt.session.getSculptManager().getTool(19).depthTest = false;
    });
    t.ok(await page.evaluate(([x, y]) => window.__pd.dab(x, y, 220, false), [sp.x, sp.y]), 'the same stroke without the depth test lands');
    const before = await page.evaluate((R) => window.__pd.verdict('pre', R), sp.R);
    t.ok(before.hiddenTouched > 20, `without the depth test it paints ${before.hiddenTouched} of the ${before.hiddenAll} hidden vertices (so the scene shows the difference)`);
    await page.screenshot({ path: `${SHOTS}/spike-projected-before-1180.png` });
    // Both strokes seen from the side (pictures only; nothing is asserted from here): before, then with the depth test.
    await page.evaluate(() => window.__pd.orbit(60));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/spike-seen-from-the-side-before-1180.png` });
    await page.evaluate(() => {
      window.__pd.orbit(0);
      window.__pt.undo();
      window.__sculpt.session.getSculptManager().getTool(19).depthTest = true;
      window.__pd.D.clear();
    });
    t.ok(
      await page.evaluate(() => {
        const [x, y] = window.__pd.screen(window.__spike.at);
        return window.__pd.dab(x, y, 220, false);
      }),
      'the stroke with the depth test lands again, for the picture from the side',
    );
    await page.evaluate(() => window.__pd.orbit(60));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/spike-seen-from-the-side-1180.png` });
  },

  async paintProjectObjects(page, base, t) {
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    await prepDepth(page, base);
    const bl = await page.evaluate(() => {
      const r = window.__pd.blockerScene();
      window.__sculpt.session.paint.add(window.__pt.mesh(), 'Projected');
      window.__pt.snap('pre');
      return r;
    });
    await page.screenshot({ path: `${SHOTS}/blocker-1180.png` });
    t.ok(await page.evaluate(([x, y]) => window.__pd.dab(x, y, 260, false), [bl.x, bl.y]), 'a Project stroke lands on the sphere beside the object in front');
    asserts(t, 'another visible object in front', await page.evaluate((R) => window.__pd.verdict('pre', R), bl.R));
    await page.screenshot({ path: `${SHOTS}/blocker-projected-1180.png` });
    const behind = await page.evaluate((R) => {
      const pd = window.__pd;
      window.__behind = pd.classify([...pd.D], R).hidden;
      return window.__behind.length;
    }, bl.R);

    // A hidden one does not block: the vertices it hid take the picture now.
    await page.evaluate(() => {
      window.__pt.undo();
      window.__cube.setVisible(false);
      window.__pd.D.clear();
      window.__pt.snap('pre');
    });
    t.ok(await page.evaluate(([x, y]) => window.__pd.dab(x, y, 260, false), [bl.x, bl.y]), 'the same stroke with that object hidden lands');
    const unhidden = await page.evaluate(() => {
      let painted = 0;
      for (const f of window.__pd.fate('pre', window.__behind).values()) if (f === 1 || f === 2) painted++;
      return painted;
    });
    t.ok(behind >= 10 && unhidden >= Math.floor(behind / 3), `a hidden object does not block: ${unhidden} of the ${behind} vertices it covered take colour now`);

    // Symmetry on, the object in front again: the mirrored dab is tested against the same camera.
    await page.evaluate(() => {
      window.__pt.undo();
      window.__cube.setVisible(true);
      window.__pd.D.clear();
      window.__pt.snap('pre');
    });
    t.ok(await page.evaluate(([x, y]) => window.__pd.dab(x, y, 260, true), [bl.x, bl.y]), 'a Project stroke with symmetry on lands');
    const sym = await page.evaluate((R) => {
      const v = window.__pd.verdict('pre', R);
      const pt = window.__pt;
      const s = window.__pd.shape();
      const cam = window.__pd.cam();
      const w = window.__pd.world(pt.mesh());
      const x = pt.colours();
      const y = pt.snaps.pre;
      let left = 0;
      let right = 0;
      for (let i = 0; i < pt.mesh().getNbVertices(); i++) {
        if (Math.abs(x[i * 3] - y[i * 3]) + Math.abs(x[i * 3 + 1] - y[i * 3 + 1]) + Math.abs(x[i * 3 + 2] - y[i * 3 + 2]) < 0.02) continue;
        const d = (w[i * 3] - s.c[0]) * cam.right[0] + (w[i * 3 + 1] - s.c[1]) * cam.right[1] + (w[i * 3 + 2] - s.c[2]) * cam.right[2];
        if (d > 0) right++;
        else left++;
      }
      return { v, left, right };
    }, bl.R);
    asserts(t, 'another visible object in front, symmetry on', sym.v);
    t.ok(sym.right > 20 && sym.left > 20, `both the dab and its mirror paint, round the object in front (${sym.left} on the mirrored side, ${sym.right} on the other)`);

    // With it hidden, both sides take colour, and only what faces the camera.
    await page.evaluate(() => {
      window.__pt.undo();
      window.__cube.setVisible(false);
      window.__pd.D.clear();
      window.__pt.snap('pre');
    });
    t.ok(await page.evaluate(([x, y]) => window.__pd.dab(x, y, 260, true), [bl.x, bl.y]), 'and with the object hidden it lands');
    const both = await page.evaluate(() => {
      const pt = window.__pt;
      const s = window.__pd.shape();
      const cam = window.__pd.cam();
      const w = window.__pd.world(pt.mesh());
      const x = pt.colours();
      const y = pt.snaps.pre;
      const nrm = pt.mesh().getNormals();
      const mm = pt.mesh().getMatrix();
      let left = 0;
      let right = 0;
      let away = 0;
      for (let i = 0; i < pt.mesh().getNbVertices(); i++) {
        if (Math.abs(x[i * 3] - y[i * 3]) + Math.abs(x[i * 3 + 1] - y[i * 3 + 1]) + Math.abs(x[i * 3 + 2] - y[i * 3 + 2]) < 0.02) continue;
        const d = (w[i * 3] - s.c[0]) * cam.right[0] + (w[i * 3 + 1] - s.c[1]) * cam.right[1] + (w[i * 3 + 2] - s.c[2]) * cam.right[2];
        if (d > 0) right++;
        else {
          left++;
          // the mirrored side: it must face the real camera
          const wx = mm[0] * nrm[i * 3] + mm[4] * nrm[i * 3 + 1] + mm[8] * nrm[i * 3 + 2];
          const wy = mm[1] * nrm[i * 3] + mm[5] * nrm[i * 3 + 1] + mm[9] * nrm[i * 3 + 2];
          const wz = mm[2] * nrm[i * 3] + mm[6] * nrm[i * 3 + 1] + mm[10] * nrm[i * 3 + 2];
          if (wx * (cam.eye[0] - w[i * 3]) + wy * (cam.eye[1] - w[i * 3 + 1]) + wz * (cam.eye[2] - w[i * 3 + 2]) <= 0) away++;
        }
      }
      return { left, right, away };
    });
    t.ok(both.left > 20 && both.right > 20 && both.away === 0, `symmetry paints both sides and the mirrored side faces the camera (${show(both)})`);
  },

  async paintProjectLevel(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await prepDepth(page, base);
    // A lower level of the stack, with an object in front.
    const lo = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const pt = window.__pt;
      const n = pt.levels().n;
      pt.go(Math.max(0, n - 2));
      const r = window.__pd.blockerScene();
      pt.go(Math.max(0, n - 2));
      session.paint.add(session.getMesh(), 'Projected');
      pt.snap('pre');
      return { ...r, verts: session.getMesh().getNbVertices(), level: pt.levels() };
    });
    t.ok(await page.evaluate(([x, y]) => window.__pd.dab(x, y, 260, false), [lo.x, lo.y]), `a Project stroke on level ${lo.level.sel + 1} of ${lo.level.n} (${lo.verts} vertices) lands`);
    asserts(t, 'a lower level', await page.evaluate((R) => window.__pd.verdict('pre', R), lo.R));
  },

  async paintProjectDynamic(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await prepDepth(page, base);
    // Dynamic topology on: no layers, the mesh's own colours.
    const dy = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const pt = window.__pt;
      const r = window.__pd.blockerScene();
      const on = session.toggleDynamicTopology();
      window.__pd.sphere = session.getMesh();
      pt.snap('pre');
      return { ...r, on, verts: session.getMesh().getNbVertices() };
    });
    t.ok(dy.on, `dynamic topology is on (${dy.verts} vertices)`);
    t.ok(await page.evaluate(([x, y]) => window.__pd.dab(x, y, 260, false), [dy.x, dy.y]), 'a Project stroke lands with dynamic topology on');
    asserts(t, 'dynamic topology on', await page.evaluate((R) => window.__pd.verdict('pre', R), dy.R));
  },

  async paintProjectSpeed(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await enterPaint(page, base);
    await page.evaluate(installDepth);
    const sizes = [];
    const measure = () =>
      page.evaluate(() => {
        const { session, tablet } = window.__sculpt;
        const pt = window.__pt;
        const mgr = session.getSculptManager();
        mgr._symmetry = false;
        mgr.setToolIndex(19);
        const tool = mgr.getTool(19);
        const rect = session.getCanvas().getBoundingClientRect();
        const ratio = session.getPixelRatio();
        const b = session.getMesh().computeWorldBound();
        const [cx, cy] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
        tool.source = { ready: () => true, sample: (x) => ((x - rect.left) * ratio < cx ? [1, 0, 0] : [0, 0, 1]) };
        tool._radius = 60;
        tool._intensity = 1;
        tablet.pressure = 0.5;
        tablet.pen = false;
        const run = (depth, dabs = 8, step = 14) => {
          tool.depthTest = depth;
          const per = [];
          for (let r = 0; r < 7; r++) {
            const y = cy + (r % 4) * 12 - 20;
            session._mouseX = cx - 60;
            session._mouseY = y;
            if (!mgr.start(false)) return null;
            const picking = session.getPicking();
            const t0 = performance.now();
            for (let i = 1; i <= dabs; i++) tool.makeStroke(cx - 60 + step * i, y, picking, null);
            const dt = performance.now() - t0;
            tool.updateRender();
            mgr.end();
            session.getStateManager().cleanNoop();
            per.push(dt / dabs);
          }
          per.sort((p, q) => p - q);
          return per[3];
        };
        run(false);
        run(true);
        const off = run(false);
        const on = run(true);
        // a longer stroke, the dabs closer (what drawing does): the depth test's tiles are made once for it
        const off24 = run(false, 24, 8);
        const on24 = run(true, 24, 8);
        tool.depthTest = true;
        // what one dab hands the colour step
        let dabVerts = 0;
        const orig = tool.colours;
        tool.colours = function (iv, p) {
          dabVerts = Math.max(dabVerts, iv.length);
          return orig.call(this, iv, p);
        };
        run(true);
        tool.colours = orig;
        return { off, on, off24, on24, verts: session.getMesh().getNbVertices(), dabVerts, layered: pt.layers().length > 0 };
      });
    const level = async (target) => {
      for (;;) {
        const n = await page.evaluate(() => window.__sculpt.session.getMesh().getNbVertices());
        if (n >= target) return n;
        const ok = await page.evaluate(() => window.__sculpt.session.subdivide());
        if (!ok) return n;
      }
    };
    for (const target of [100_000, 900_000]) {
      const n = await level(target);
      await page.evaluate(() => {
        const { session } = window.__sculpt;
        for (const l of [...session.paint.rawList(session.getMesh())]) session.paint.remove(session.getMesh(), l);
        session.paint.add(session.getMesh(), 'Projected');
      });
      const r = await measure();
      sizes.push(r);
      const ratio = r.on / Math.max(r.off, 0.001);
      console.log(`  Project, ${n} vertices, ${r.dabVerts} in a dab: ${r.off.toFixed(2)} ms a dab with the depth test off, ${r.on.toFixed(2)} ms on (x${ratio.toFixed(2)}); 24 closer dabs: ${r.off24.toFixed(2)} off, ${r.on24.toFixed(2)} on`);
      t.ok(r.on <= r.off * 2.5 + 0.05, `at ${n} vertices the depth test costs x${ratio.toFixed(2)} of a dab without it (a guard; the figure against the code before the test is in the report)`);
    }
  },
};
