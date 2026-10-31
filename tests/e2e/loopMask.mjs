// The edge-loop mask (owner call, 2026-10-31): with any sculpting brush,
// Ctrl + Shift and a drag across the mesh masks the side of an edge loop
// the drag moves toward; + Alt unmasks. True edge loops on quads, a
// geodesic ring (the plane across the drag, traced over the faces) on
// triangles.
//
// loopMask:
// - on the default sphere at its quad level, seen from the front, a pen
//   drag down across the equator's row of edges masks exactly the lower
//   half, the loop's own vertices included (every vertex at y <= 0), the
//   loop closed round the sphere in 256 edges, drawn while dragging with
//   the side lightly tinted; one undo takes it all off;
// - Ctrl + Shift + Alt unmasks that side of a whole mask; the mask adds to
//   one already there; a mouse drag up masks the upper half;
// - a Ctrl + Shift click, or a drag under 6 px, masks nothing, starts no
//   stroke and leaves no undo step (the click is poly groups', polyGroups.mjs);
// - with symmetry on, the side is mirrored across the symmetry plane;
// - on the cube, a drag across one of its edges finds that edge's loop
//   running from corner pole to corner pole (valence 3 at both ends), which
//   cuts nothing in two, and falls back to the plane's ring, closed round
//   the cube, masking the side the drag went to;
// - on a voxel-remeshed sphere under dynamic topology (triangles) a drag
//   finds a closed ring and masks about half the vertices (within 10%);
// - the Select tool's Ctrl + Shift marquee still adds to the selection and
//   masks nothing;
// - timings at 98k and 393k faces: the walk and the flood well under 100 ms.
import { devices, openForInput, settle } from './smoke.mjs';

const CTRL = 2;
const SHIFT = 8;
const ALT = 1;

/** The page's frames: two, so a preview scheduled on a move has drawn. */
export const frames = (page) => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));

/** The active object's mask: how many vertices are masked (value under 0.5), and how many part-way. */
const maskCount = (page) =>
  page.evaluate(() => {
    const { session } = window.__sculpt;
    const m = session.getMesh();
    const mat = m.getMaterials();
    let masked = 0;
    let partial = 0;
    for (let i = 0; i < m.getNbVertices(); i++) {
      const v = mat[i * 3 + 2];
      if (v < 0.5) masked++;
      if (v > 0.01 && v < 0.99) partial++;
    }
    return { masked, partial, n: m.getNbVertices(), undo: session.getStateManager()._curUndoIndex };
  });

/** A mouse drag through CDP, with modifier keys held (1 Alt, 2 Ctrl, 4 Meta, 8 Shift). */
export async function mouseDrag(page, path, modifiers) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, [x, y], buttons) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1, modifiers });
  await send('mouseMoved', path[0], 0);
  await send('mousePressed', path[0], 1);
  for (let i = 1; i < path.length; i++) await send('mouseMoved', path[i], 1);
  await send('mouseReleased', path[path.length - 1], 0);
  await cdp.detach();
}

export const along = ([x0, y0], [x1, y1], n = 6) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

/**
 * In the page: a drag across the grid at vertex `c` (the local point
 * nearest `at`), from the side of its neighbour toward `from` to the far
 * side, crossing the edge from c to its neighbour toward `side` (the edge
 * nearest the drag's midpoint, a third of a face from it). Returns the
 * drag's ends in client px and c's local position.
 */
export function gridDrag({ name, at, from, side, reach = 60 }) {
  const { session, input } = window.__sculpt;
  const mesh = session.getMeshes().find((m) => session.getMeshName(m) === name);
  const v = mesh.getVertices();
  const n = mesh.getNbVertices();
  let c = -1;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(v[i * 3] - at[0], v[i * 3 + 1] - at[1], v[i * 3 + 2] - at[2]);
    if (d < best) {
      best = d;
      c = i;
    }
  }
  const t = input.loopMask.topology(mesh);
  const nb = new Set();
  for (let i = t.vfStart[c]; i < t.vfStart[c + 1]; i++) {
    const f = t.vfList[i];
    const k = Array.from(t.fAr.subarray(f * 4, f * 4 + 4)).indexOf(c);
    const m = t.corners[f];
    nb.add(t.fAr[f * 4 + ((k + 1) % m)]);
    nb.add(t.fAr[f * 4 + ((k + m - 1) % m)]);
  }
  // The neighbour farthest along a local direction.
  const toward = (dir) => {
    let w = -1;
    let bestDot = -Infinity;
    for (const j of nb) {
      const dot = (v[j * 3] - v[c * 3]) * dir[0] + (v[j * 3 + 1] - v[c * 3 + 1]) * dir[1] + (v[j * 3 + 2] - v[c * 3 + 2]) * dir[2];
      if (dot > bestDot) {
        bestDot = dot;
        w = j;
      }
    }
    return w;
  };
  const u = toward(from);
  const s = toward(side);
  const M = mesh.getMatrix();
  const rect = session.getCanvas().getBoundingClientRect();
  const pr = session.getPixelRatio();
  const scr = (i) => {
    const p = session.getCamera().project([0, 1, 2].map((k) => M[k] * v[i * 3] + M[4 + k] * v[i * 3 + 1] + M[8 + k] * v[i * 3 + 2] + M[12 + k]));
    return [rect.left + p[0] / pr, rect.top + p[1] / pr];
  };
  const [C, U, S] = [scr(c), scr(u), scr(s)];
  const mid = [0, 1].map((k) => C[k] + 0.35 * (U[k] - C[k]) + 0.5 * (S[k] - C[k]));
  const len = Math.hypot(C[0] - U[0], C[1] - U[1]);
  const dir = [(C[0] - U[0]) / len, (C[1] - U[1]) / len];
  return {
    a: [mid[0] - dir[0] * reach, mid[1] - dir[1] * reach],
    b: [mid[0] + dir[0] * reach, mid[1] + dir[1] * reach],
    c: [v[c * 3], v[c * 3 + 1], v[c * 3 + 2]],
    facePx: len,
  };
}

/** In the page: how many vertices of the active object satisfy a test on the local position. */
function countWhere({ axis, op, value }) {
  const m = window.__sculpt.session.getMesh();
  const v = m.getVertices();
  let c = 0;
  for (let i = 0; i < m.getNbVertices(); i++) {
    const x = v[i * 3 + axis];
    if (op === '<=' ? x <= value : x >= value) c++;
  }
  return c;
}

/** In the page: the masked vertices are exactly those that satisfy the test. */
function maskedMatches({ axis, op, value }) {
  const m = window.__sculpt.session.getMesh();
  const v = m.getVertices();
  const mat = m.getMaterials();
  let wrong = 0;
  for (let i = 0; i < m.getNbVertices(); i++) {
    const x = v[i * 3 + axis];
    const want = op === '<=' ? x <= value : x >= value;
    if (want !== mat[i * 3 + 2] < 0.5) wrong++;
  }
  return wrong;
}

const setMask = (page, fn) =>
  page.evaluate((src) => {
    const { session } = window.__sculpt;
    const m = session.getMesh();
    const v = m.getVertices();
    const mat = m.getMaterials();
    const f = new Function('x', 'y', 'z', `return (${src})`);
    for (let i = 0; i < m.getNbVertices(); i++) mat[i * 3 + 2] = f(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]) ? 0 : 1;
    m.updateDuplicateColorsAndMaterials();
    m.updateMaterialBuffer();
    session.render();
  }, fn);

export const view = (page, position, target) =>
  page.evaluate(
    ([p, tg]) => {
      window.__sculpt.viewer.controls.setState(p, tg);
    },
    [position, target],
  );

export const suites = {
  async loopMask(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    await page.keyboard.press('3'); // Standard clay: any brush will do
    // The sphere from straight in front, near enough that a face is a few
    // pixels across. Symmetry off until its own check.
    await view(page, [0, 12.5, 45], [0, 12.5, 0]);
    await page.evaluate(() => {
      window.__sculpt.session.getSculptManager()._symmetry = false;
    });
    await settle(page);
    const level = await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      return { faces: m.getNbFaces(), quads: m.getNbQuads(), n: m.getNbVertices() };
    });
    t.ok(level.faces === level.quads && level.faces > 20000, `the default sphere is quads at its level on screen (${level.faces} faces)`);

    // Down across the equator's row, from the row above it.
    const eq = await page.evaluate(gridDrag, { name: 'Sphere', at: [0, 0, 12.5], from: [0, 1, 0], side: [1, 0, 0] });
    t.ok(Math.abs(eq.c[1]) < 1e-4, `the drag crosses the equator's row (c at y ${eq.c[1].toExponential(1)}, a face ${eq.facePx.toFixed(1)} px)`);
    const lower = await page.evaluate(countWhere, { axis: 1, op: '<=', value: 1e-4 });
    let before = await maskCount(page);
    const strokes = await page.evaluate(() => window.__sculpt.input.strokeCount());
    const during = await dev.penDrag(along(eq.a, eq.b), async () => {
      await frames(page);
      return page.evaluate(() => {
        const { cursor, session } = window.__sculpt;
        const mat = session.getMesh().getMaterials();
        let tinted = 0;
        for (let i = 0; i < session.getMesh().getNbVertices(); i++) if (mat[i * 3 + 2] > 0.01 && mat[i * 3 + 2] < 0.99) tinted++;
        return { probe: { ...cursor.loopProbe }, tinted, cursorMode: document.querySelector('.sculpt-cursor:not(.sculpt-loop)')?.dataset.mode };
      });
    }, CTRL | SHIFT);
    await settle(page);
    let m = await maskCount(page);
    let r = await page.evaluate(() => window.__sculpt.input.loopMask.last);
    t.ok(during.probe.shown && during.probe.closed && during.probe.points === 256 && during.probe.front > 50 && during.probe.front < 256, `while dragging, the loop is drawn: closed, ${during.probe.points} points, ${during.probe.front} of them facing the camera`);
    t.ok(during.tinted > 0.3 * lower && during.tinted < level.n, `and the side it will mask (below the row the half-done drag crosses) is lightly tinted (${during.tinted} vertices part-way)`);
    t.eq(during.cursorMode, 'hidden', 'the brush ring is out of the way meanwhile');
    t.ok(r && r.kind === 'loop' && r.first === 'loop' && r.closed && r.loopLength === 256, `a true edge loop, closed round the sphere in 256 edges (${JSON.stringify(r && { kind: r.kind, closed: r.closed, length: r.loopLength })})`);
    t.eq(m.masked, lower, `the drag down masks exactly the lower half, the loop's vertices included (${lower} of ${m.n})`);
    t.eq(await page.evaluate(maskedMatches, { axis: 1, op: '<=', value: 1e-4 }), 0, 'and every masked vertex is at or below the loop');
    t.eq(m.partial, 0, 'with no tint left over');
    t.eq(m.undo, before.undo + 1, 'in one undo step');
    t.eq(await page.evaluate(() => window.__sculpt.input.strokeCount()), strokes, 'and no stroke');
    t.eq(await page.evaluate(() => window.__sculpt.cursor.loopProbe.shown), false, 'the overlay goes on release');
    await page.evaluate(() => window.__sculpt.session.undo());
    m = await maskCount(page);
    t.ok(m.masked === 0 && m.undo === before.undo, `one undo takes it off (${m.masked} masked)`);

    // + Alt unmasks that side of a whole mask.
    await page.keyboard.press('Control+a');
    before = await maskCount(page);
    await dev.penDrag(along(eq.a, eq.b), null, CTRL | SHIFT | ALT);
    await settle(page);
    m = await maskCount(page);
    r = await page.evaluate(() => window.__sculpt.input.loopMask.last);
    t.ok(r.unmask && m.masked === m.n - lower && m.undo === before.undo + 1, `Ctrl + Shift + Alt unmasks the lower half (${m.masked} still masked, want ${m.n - lower})`);
    t.eq(await page.evaluate(maskedMatches, { axis: 1, op: '>=', value: 1e-4 }), 0, 'leaving exactly the upper half masked');

    // It adds to a mask already there.
    await setMask(page, 'y > 8');
    const cap = await page.evaluate(countWhere, { axis: 1, op: '>=', value: 8.000001 });
    await dev.penDrag(along(eq.a, eq.b), null, CTRL | SHIFT);
    await settle(page);
    m = await maskCount(page);
    t.eq(m.masked, lower + cap, `the loop's side adds to a mask already there (${lower} below the loop + ${cap} in the cap)`);

    // A mouse drag up masks the upper half.
    await setMask(page, 'false');
    const upper = await page.evaluate(countWhere, { axis: 1, op: '>=', value: -1e-4 });
    await mouseDrag(page, along(eq.b, eq.a), CTRL | SHIFT);
    await settle(page);
    m = await maskCount(page);
    t.eq(m.masked, upper, `a mouse drag up masks the upper half (${upper})`);

    // A click, or a drag under 6 px, masks nothing.
    await setMask(page, 'false');
    before = await maskCount(page);
    const strokesBefore = await page.evaluate(() => window.__sculpt.input.strokeCount());
    const mid = [(eq.a[0] + eq.b[0]) / 2, (eq.a[1] + eq.b[1]) / 2];
    await dev.penDrag([mid, mid], null, CTRL | SHIFT);
    await dev.penDrag(along(mid, [mid[0], mid[1] + 4], 2), null, CTRL | SHIFT);
    await mouseDrag(page, [mid, [mid[0] + 3, mid[1] + 3]], CTRL | SHIFT);
    await settle(page);
    m = await maskCount(page);
    const strokesAfter = await page.evaluate(() => window.__sculpt.input.strokeCount());
    t.ok(m.masked === 0 && m.undo === before.undo && strokesAfter === strokesBefore, `a Ctrl + Shift click, or a drag under 6 px, does nothing: no mask, no undo step, no stroke (${m.masked} masked, undo ${before.undo} to ${m.undo})`);

    // Symmetry: a drag across a column left of the middle, outward, masks
    // the left cap and its mirror on the right.
    await page.evaluate(() => {
      window.__sculpt.session.getSculptManager()._symmetry = true;
    });
    const col = await page.evaluate(gridDrag, { name: 'Sphere', at: [-6, 0, 12.5], from: [1, 0, 0], side: [0, 1, 0] });
    await dev.penDrag(along(col.a, col.b), null, CTRL | SHIFT);
    await settle(page);
    r = await page.evaluate(() => window.__sculpt.input.loopMask.last);
    const sym = await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      const v = m.getVertices();
      const mat = m.getMaterials();
      const key = (x, y, z) => `${Math.round(x * 1000) + 0},${Math.round(y * 1000) + 0},${Math.round(z * 1000) + 0}`;
      const masked = new Set();
      let left = 0;
      let right = 0;
      for (let i = 0; i < m.getNbVertices(); i++) {
        if (mat[i * 3 + 2] >= 0.5) continue;
        masked.add(key(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]));
        if (v[i * 3] < 0) left++;
        else right++;
      }
      let unmirrored = 0;
      for (const k of masked) {
        const [x, y, z] = k.split(',').map(Number);
        if (!masked.has(`${-x + 0},${y},${z}`)) unmirrored++;
      }
      return { left, right, unmirrored, total: masked.size };
    });
    t.ok(r.kind === 'loop' && r.closed && r.mirrored && r.verts === 2 * r.side, `with symmetry on, the side is mirrored (${r.side} on the side, ${r.verts} with the mirror)`);
    t.ok(sym.left === sym.right && sym.left > 0 && sym.unmirrored === 0 && sym.total < 0.7 * level.n, `the left cap and its mirror on the right, vertex for vertex (${sym.left} left, ${sym.right} right, ${sym.unmirrored} without a mirror)`);
    await page.evaluate(() => {
      window.__sculpt.session.getSculptManager()._symmetry = false;
    });

    // The Select tool's Ctrl + Shift marquee still adds to the selection.
    await setMask(page, 'false');
    await page.keyboard.press('q');
    await page.evaluate(() => window.__sculpt.session.selectSet([]));
    before = await maskCount(page);
    const box = await page.evaluate(() => {
      const r = window.__sculpt.session.getCanvas().getBoundingClientRect();
      return [r.left + 40, r.top + 60, r.right - 340, r.bottom - 140];
    });
    let marquee = false;
    await dev.penDrag(along([box[0], box[1]], [box[2], box[3]]), async () => {
      marquee = await page.evaluate(() => !!document.querySelector('.select-marquee'));
    }, CTRL | SHIFT);
    await settle(page);
    const selected = await page.evaluate(() => window.__sculpt.session.getSelectedMeshes().map((x) => window.__sculpt.session.getMeshName(x)));
    m = await maskCount(page);
    t.ok(marquee && selected.includes('Sphere') && m.masked === 0 && m.undo === before.undo, `the Select tool's Ctrl + Shift marquee still adds to the selection (${selected.join(', ')}) and masks nothing`);
    await page.keyboard.press('3');

    // The cube: across the edge between its front and right faces, the
    // loop runs from corner to corner and cuts nothing in two.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      for (const x of session.getMeshes()) x.setVisible(false);
      const cube = session.addPrimitive('cube');
      cube.setVisible(true);
      session.getSculptManager()._symmetry = false;
    });
    const cubeInfo = await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      const v = m.getVertices();
      let hi = -Infinity;
      for (let i = 0; i < m.getNbVertices(); i++) hi = Math.max(hi, v[i * 3]);
      return { hi, n: m.getNbVertices(), M: Array.from(m.getMatrix()).slice(12, 15) };
    });
    const h = cubeInfo.hi;
    const cy = cubeInfo.M[1];
    await view(page, [cubeInfo.M[0] + 40, cy + 6, cubeInfo.M[2] + 40], [cubeInfo.M[0] + h, cy, cubeInfo.M[2] + h]);
    await settle(page);
    const edge = await page.evaluate(gridDrag, { name: await page.evaluate(() => window.__sculpt.session.activeName()), at: [h, 0, h], from: [-1, 0, 0], side: [0, 1, 0], reach: 50 });
    await dev.penDrag(along(edge.a, edge.b), null, CTRL | SHIFT);
    await settle(page);
    r = await page.evaluate(() => window.__sculpt.input.loopMask.last);
    m = await maskCount(page);
    const cubeSide = await page.evaluate(
      ([hh]) => {
        const mm = window.__sculpt.session.getMesh();
        const v = mm.getVertices();
        const mat = mm.getMaterials();
        let right = 0;
        let rightMasked = 0;
        let frontFar = 0;
        for (let i = 0; i < mm.getNbVertices(); i++) {
          const masked = mat[i * 3 + 2] < 0.5;
          if (v[i * 3] >= hh - 1e-4) {
            right++;
            if (masked) rightMasked++;
          }
          // The front face, left of a tenth of the way in from the edge.
          if (masked && v[i * 3 + 2] >= hh - 1e-4 && v[i * 3] < 0.8 * hh) frontFar++;
        }
        return { right, rightMasked, frontFar };
      },
      [h],
    );
    t.ok(r.first === 'loop' && r.ends === 'pole' && r.endValence?.[0] === 3 && r.endValence?.[1] === 3 && r.loopLength === 65, `across the cube's edge, the edge's loop runs from corner pole to corner pole (${r.loopLength} vertices, valence ${r.endValence?.join(' and ')} at its ends)`);
    t.ok(r.kind === 'ring' && r.closed && /pole/.test(r.note), `and, cutting nothing in two, it falls back to the plane's ring, closed round the cube ("${r.note}")`);
    t.ok(cubeSide.rightMasked === cubeSide.right && cubeSide.frontFar === 0 && m.masked < 0.35 * cubeInfo.n, `masking the side the drag went to: the whole right face, the front only near the edge (${m.masked} of ${cubeInfo.n}; the right face has ${cubeSide.right}, ${cubeSide.rightMasked} masked; ${cubeSide.frontFar} masked far into the front)`);

    // A voxel-remeshed sphere under dynamic topology: triangles, and a ring.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.getMesh();
      session.deleteMesh(cube);
      const sphere = session.getMeshes().find((x) => session.getMeshName(x) === 'Sphere');
      sphere.setVisible(true);
      session.setMesh(sphere);
      session.voxelRemesh(120);
      session.toggleDynamicTopology();
      session.getSculptManager()._symmetry = false;
    });
    await view(page, [0, 12.5, 45], [0, 12.5, 0]);
    await settle(page);
    const tri = await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      return { faces: m.getNbFaces(), tris: m.getNbTriangles(), dynamic: !!m.isDynamic, n: m.getNbVertices() };
    });
    const sc = await page.evaluate(() => {
      const r = window.__sculpt.session.getCanvas().getBoundingClientRect();
      const { session } = window.__sculpt;
      const m = session.getMesh();
      const M = m.getMatrix();
      const p = session.getCamera().project([M[12], M[13], M[14]]);
      return [r.left + p[0] / session.getPixelRatio(), r.top + p[1] / session.getPixelRatio()];
    });
    await setMask(page, 'false');
    await dev.penDrag(along([sc[0] + 7, sc[1] - 60], [sc[0] + 7, sc[1] + 60]), null, CTRL | SHIFT);
    await settle(page);
    r = await page.evaluate(() => window.__sculpt.input.loopMask.last);
    m = await maskCount(page);
    t.ok(tri.dynamic && tri.tris === tri.faces, `the voxel-remeshed sphere under dynamic topology is triangles (${tri.faces})`);
    t.ok(r.first === 'ring' && r.kind === 'ring' && r.closed, `a drag across it finds a closed geodesic ring (${r.kind}, ${r.loopLength} points)`);
    console.log(`  loopMask ring at ${tri.faces} triangles: topology ${r.ms.topology.toFixed(1)} ms once; find ${r.ms.find.toFixed(1)}, trace ${r.ms.walk.toFixed(1)}, flood ${r.ms.flood.toFixed(1)}, total ${r.ms.total.toFixed(1)} ms; apply ${r.ms.apply.toFixed(1)} ms`);
    t.ok(r.ms.walk + r.ms.flood < 100, `the ring's trace and flood take ${(r.ms.walk + r.ms.flood).toFixed(1)} ms`);
    t.near(m.masked / m.n, 0.5, 0.05, `and masks one side, about half the vertices (${m.masked} of ${m.n})`);
    const sides = await page.evaluate(() => {
      const mm = window.__sculpt.session.getMesh();
      const v = mm.getVertices();
      const mat = mm.getMaterials();
      const sum = [0, 0];
      const cnt = [0, 0];
      for (let i = 0; i < mm.getNbVertices(); i++) {
        const k = mat[i * 3 + 2] < 0.5 ? 0 : 1;
        sum[k] += v[i * 3 + 1];
        cnt[k]++;
      }
      return { masked: sum[0] / cnt[0], free: sum[1] / cnt[1] };
    });
    t.ok(sides.masked < sides.free, `the lower side, the way the drag went (mean height ${sides.masked.toFixed(2)} masked, ${sides.free.toFixed(2)} not)`);

    // Timings, on the sphere's quads at 98k and 393k faces (the ring's are
    // logged above, on the triangles).
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.toggleDynamicTopology();
      const sphere = session.addPrimitive('sphere');
      for (const x of [...session.getMeshes()]) if (x !== sphere) session.deleteMesh(x);
      session.getSculptManager()._symmetry = false;
    });
    const fmt = (x) => x.toFixed(1);
    for (let level = 0; level < 2; level++) {
      await page.evaluate(() => {
        const { session, viewer } = window.__sculpt;
        const sphere = session.getMesh();
        sphere.addLevel();
        sphere.setSelection(sphere._meshes.length - 1);
        session.setMesh(sphere);
        const M = sphere.getMatrix();
        viewer.controls.setState([M[12], M[13], M[14] + 45], [M[12], M[13], M[14]]);
      });
      await settle(page);
      const perf = await page.evaluate(() => {
        const { session, input } = window.__sculpt;
        const m = session.getMesh();
        const M = m.getMatrix();
        const p = session.getCamera().project([M[12], M[13], M[14]]);
        const runs = [];
        // Five different rows (no reuse between them), then the last again.
        for (let i = 0; i < 6; i++) {
          const dy = Math.min(i, 4) * 23;
          const cut = input.loopMask.pick(p[0] + 3, p[1] - 80 + dy, p[0] + 3, p[1] + 80 + dy + (i === 5 ? 2 : 0));
          runs.push({ ...cut.ms, kind: cut.kind, side: cut.side.length, loop: cut.loop?.length ?? 0 });
        }
        // The preview's tint, on and off, and the apply with its undo step.
        const cut = input.loopMask.pick(p[0] + 3, p[1] - 80, p[0] + 3, p[1] + 80);
        let t0 = performance.now();
        input.loopMask.preview(cut, false);
        const tint = performance.now() - t0;
        t0 = performance.now();
        input.loopMask.apply(cut, false);
        const apply = performance.now() - t0;
        session.undo();
        return { faces: m.getNbFaces(), runs, tint, apply };
      });
      const fresh = perf.runs.slice(1, 5);
      const worst = (k) => Math.max(...fresh.map((x) => x[k]));
      console.log(
        `  loopMask timings at ${perf.faces} faces: topology ${fmt(perf.runs[0].topology)} ms once; worst of four loops: find ${fmt(worst('find'))}, walk ${fmt(worst('walk'))}, flood ${fmt(worst('flood'))}, total ${fmt(worst('total'))} ms (${fresh.map((x) => `${x.loop} edges, ${x.side} vertices`).join('; ')}); the same loop again ${fmt(perf.runs[5].total)} ms; tint ${fmt(perf.tint)} ms; apply ${fmt(perf.apply)} ms`,
      );
      t.ok(fresh.every((x) => x.kind === 'loop' && x.walk + x.flood < 100), `at ${perf.faces} faces the loop walk and the flood take at most ${fmt(Math.max(...fresh.map((x) => x.walk + x.flood)))} ms, well under 100`);
      if (level === 1) t.ok(perf.faces > 380000 && perf.runs[5].total < 20, `and a drag over the same loop and side reuses what it found (${fmt(perf.runs[5].total)} ms)`);
    }
  },
};
