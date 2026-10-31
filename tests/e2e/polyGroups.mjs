// Poly groups (owner decisions, 2026-10-31; stored on level 0 since
// 2026-11-01; polyGroups.ts). One group a face of an object's level 0 (the
// base mesh), names by group number; every higher level's face takes its
// level-0 ancestor's group exactly.
//
// polyGroups:
// - the multires numbering: face f's children are 4f..4f+3 of the level
//   above, a quad's child k at its corner k (checked on every face of the
//   cube's levels);
// - storage: one group a level-0 face (the array, the .bozz record), and
//   at every level face f in its level-0 ancestor's (f >> 2k) group;
// - Ctrl+W after a loop-mask drag across the sphere's equator makes "Group
//   2" of the level-0 faces the masked top faces round down to, level by
//   level (a face of the level below joins when most of its four children
//   do, the earliest child deciding a tie), one undo step; Ctrl+W with
//   nothing masked makes none; the rounding rule itself on chosen
//   patterns, including one where level by level and a flat vote differ;
// - subdividing and deleting the highest level leave level 0's groups as
//   they were; Rebuild puts a new level 0 under the old one, each face the
//   majority of its children (found by the reversion's parent map, checked
//   on the geometry), and an undo brings the old one back;
// - Group by angle on the cube: 6 groups, one a side; on a library figure
//   and a quad-remeshed one, level 0's own split against a vote from the
//   level on screen (the coarseness of level 0 reported);
// - Shift+F: the group colours on every object, and off;
// - Ctrl+Shift+click on a side shows it alone, again hides it and shows
//   the rest, on empty space shows all; hidden faces are not picked, and a
//   stroke across them leaves every vertex they touch where it was;
// - Ctrl+click on a side masks its vertices, Ctrl+Alt+click unmasks them,
//   each one undo step;
// - dynamic topology carries the groups to its triangles and back; a
//   mirror copy keeps them on the mirrored faces; a voxel remesh moves them
//   to the new faces by the nearest face;
// - an OBJ's g lines import as groups, export back unchanged while the
//   groups are the file's, and as new g lines once they change, which
//   import again as the same groups; the triangle export writes g lines;
// - By UV islands on an OBJ with two islands: two groups, the button off
//   for an object without UVs;
// - a .bozz and the autosave keep the faces (version 2, level 0's), names
//   and hidden flags; a version 1 record (top level's) opens rounded down
//   level by level; a scene with malformed groups is refused; an older
//   scene opens in group 0;
// - the Groups list: a row a group, a tap renames, the eye hides, the
//   trash merges the faces into the group they border most;
// - timings on a 393k-face sphere.
import { devices, emptySpot, openForInput, openPanel, settle } from './smoke.mjs';
import { along, frames, gridDrag, mouseDrag, view } from './loopMask.mjs';

const CTRL = 2;
const SHIFT = 8;
const ALT = 1;

/** The active object's groups: names, level-0 counts, hidden flags, and the undo index. */
const groupsOf = (page) =>
  page.evaluate(() => {
    const { session } = window.__sculpt;
    const m = session.getMesh();
    const g = session.groups;
    return {
      names: g.names(m),
      counts: g.counts(m),
      hidden: g.hiddenGroups(m),
      base: g.baseFaces(m).length,
      level0: m._meshes ? m._meshes[0].getNbFaces() : m.getNbFaces(),
      undo: session.getStateManager()._curUndoIndex,
    };
  });

/** A world point on screen, in client px. */
const screenOf = (page, p) =>
  page.evaluate((w) => {
    const { session } = window.__sculpt;
    const rect = session.getCanvas().getBoundingClientRect();
    const pr = session.getPixelRatio();
    const s = session.getCamera().project(w);
    return [rect.left + s[0] / pr, rect.top + s[1] / pr];
  }, p);

/** In the page: the active object's group of the face nearest a local point, on the level on screen. */
function groupNear(p) {
  const { session } = window.__sculpt;
  const m = session.getMesh();
  const c = m.getFaceCenters();
  let best = -1;
  let bd = Infinity;
  for (let f = 0; f < m.getNbFaces(); f++) {
    const d = Math.hypot(c[f * 3] - p[0], c[f * 3 + 1] - p[1], c[f * 3 + 2] - p[2]);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return session.groups.groupOfFace(m, best);
}

/** Two quads side by side in two UV islands, and one more on the second; g lines naming them. */
const uvObj = [
  'o Strip',
  'v 0 0 0',
  'v 1 0 0',
  'v 2 0 0',
  'v 3 0 0',
  'v 0 1 0',
  'v 1 1 0',
  'v 2 1 0',
  'v 3 1 0',
  'vt 0 0',
  'vt 0.4 0',
  'vt 0 1',
  'vt 0.4 1',
  'vt 0.6 0',
  'vt 0.8 0',
  'vt 1 0',
  'vt 0.6 1',
  'vt 0.8 1',
  'vt 1 1',
  'g left',
  'f 1/1 2/2 6/4 5/3',
  'g right',
  'f 2/5 3/6 7/9 6/8',
  'f 3/6 4/7 8/10 7/9',
  '',
].join('\n');

/** The g lines of an OBJ, with how many faces come before each. */
const gLines = (text) => {
  const out = [];
  let faces = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('f ')) faces++;
    else if (/^g(\s|$)/.test(line)) out.push(`${faces}:${line}`);
  }
  return out;
};

/**
 * In the page or here: values one a face of level `k` (faces 4f..4f+3 a
 * face's children) rounded to level 0 level by level: a face takes what
 * most of its four children have, the earliest child on a tie.
 */
function roundLevels(values, k) {
  let cur = Array.from(values);
  for (let j = k; j >= 1; j--) {
    const out = [];
    for (let p = 0; p * 4 < cur.length; p++) {
      const c = cur.slice(p * 4, p * 4 + 4);
      let best = c[0];
      let bestN = 0;
      for (const g of c) {
        const n = c.filter((x) => x === g).length;
        if (n > bestN) {
          bestN = n;
          best = g;
        }
      }
      out.push(best);
    }
    cur = out;
  }
  return cur;
}

export const suites = {
  async polyGroups(page, base, t) {
    page.on('dialog', (d) => void d.accept());
    await openForInput(page, base);
    const dev = await devices(page);
    await page.keyboard.press('3');
    await page.evaluate(() => {
      window.__sculpt.session.getSculptManager()._symmetry = false;
    });

    // --- the multires numbering, on the cube's levels ------------------------------------
    const numbering = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.addPrimitive('cube');
      const levels = cube._meshes;
      let checked = 0;
      let wrong = 0;
      let tris = 0;
      for (let l = 0; l + 1 < levels.length; l++) {
        const lo = levels[l].getFaces();
        const hi = levels[l + 1].getFaces();
        for (let f = 0; f < levels[l].getNbFaces(); f++) {
          if (lo[f * 4 + 3] === 4294967295) {
            tris++;
            continue;
          }
          for (let k = 0; k < 4; k++) {
            const child = Array.from(hi.subarray((4 * f + k) * 4, (4 * f + k) * 4 + 4));
            checked++;
            // The child at corner k keeps that corner's vertex number (even vertices keep theirs).
            if (child[k] !== lo[f * 4 + k]) wrong++;
          }
        }
      }
      return { checked, wrong, tris, levels: levels.length, top: cube.getNbFaces() };
    });
    t.ok(numbering.checked > 30000 && numbering.wrong === 0, `face f's children are 4f..4f+3 of the level above, child k at corner k (${numbering.checked} children over ${numbering.levels} levels, ${numbering.wrong} wrong)`);

    // --- Ctrl+W from a loop-masked half -----------------------------------------------
    await page.evaluate(() => {
      const s = window.__sculpt.session;
      s.deleteMesh(s.getMeshes().find((m) => s.getMeshName(m) === 'Cube'));
      s.setMesh(s.getMeshes()[0]);
    });
    await view(page, [0, 12.5, 45], [0, 12.5, 0]);
    await settle(page);
    const eq = await page.evaluate(gridDrag, { name: 'Sphere', at: [0, 0, 12.5], from: [0, 1, 0], side: [1, 0, 0] });
    await dev.penDrag(along(eq.a, eq.b), null, CTRL | SHIFT);
    await settle(page);
    const below = await page.evaluate((roundSrc) => {
      const roundLevels = new Function(`return ${roundSrc}`)();
      const m = window.__sculpt.session.getMesh();
      const f = m.getFaces();
      const mat = m.getMaterials();
      const flags = [];
      let n = 0;
      for (let i = 0; i < m.getNbFaces(); i++) {
        let all = true;
        for (let k = 0; k < 4; k++) if (!(mat[f[i * 4 + k] * 3 + 2] < 0.5)) all = false;
        flags.push(all ? 1 : 0);
        if (all) n++;
      }
      const base = roundLevels(flags, m._sel);
      return { n, faces: m.getNbFaces(), base: base.filter((x) => x).length, level0: m._meshes[0].getNbFaces(), sel: m._sel };
    }, roundLevels.toString());
    let before = await groupsOf(page);
    await page.keyboard.press('Control+w');
    let g = await groupsOf(page);
    t.ok(
      g.base === below.level0 && g.names.length === 2 && g.names[1] === 'Group 2' && g.counts[1] === below.base && below.base > 0 && g.counts[0] === below.level0 - below.base && g.undo === before.undo + 1,
      `Ctrl+W after a loop mask across the equator: "Group 2" of the ${below.base} of the sphere's ${below.level0} level-0 faces the ${below.n} masked faces of level ${below.sel} round down to, one undo step (${JSON.stringify({ names: g.names, counts: g.counts })})`,
    );
    const maskKept = await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      const mat = m.getMaterials();
      let n = 0;
      for (let i = 0; i < m.getNbVertices(); i++) if (mat[i * 3 + 2] < 0.5) n++;
      return n;
    });
    t.ok(maskKept > 0, `and the mask stays as it was (${maskKept} vertices still masked)`);
    await page.evaluate(() => window.__sculpt.session.undo());
    g = await groupsOf(page);
    t.ok(g.names.length === 1 && g.counts[0] === below.level0, `one undo takes the group off (${g.names.length} group)`);
    await page.evaluate(() => window.__sculpt.session.redo());
    g = await groupsOf(page);
    t.ok(g.names.length === 2 && g.counts[1] === below.base, 'and a redo puts it back');
    await page.keyboard.press('Control+c'); // clear the mask
    before = await groupsOf(page);
    await page.keyboard.press('Control+w');
    g = await groupsOf(page);
    t.ok(g.names.length === 2 && g.undo === before.undo, 'Ctrl+W with nothing masked makes no group');

    // --- storage on level 0, exact inheritance, the rounding -----------------------------
    const store = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.addPrimitive('cube');
      session.setMesh(cube);
      const groups = session.groups;
      groups.byAngle(cube, 40); // six names to number faces with
      const base = groups.baseFaces(cube);
      // A pattern with no structure to it, written as an edit would.
      for (let f = 0; f < base.length; f++) base[f] = (f * 7 + (f >> 3)) % 6;
      groups.touch(cube);
      const levels = cube._meshes.length;
      let wrong = 0;
      let checked = 0;
      for (let k = 0; k < levels; k++) {
        const at = groups.levelFaces(cube, k);
        if (at.length !== cube._meshes[k].getNbFaces()) wrong++;
        for (let f = 0; f < at.length; f++, checked++) if (at[f] !== base[f >> (2 * k)]) wrong++;
      }
      return { len: base.length, level0: cube._meshes[0].getNbFaces(), top: cube.getNbFaces(), levels, wrong, checked, saved: groups.serialize(cube).faces.length };
    });
    t.ok(store.len === store.level0 && store.saved === store.level0 && store.top === store.level0 * 4 ** (store.levels - 1), `groups are stored one a level-0 face: ${store.len} on the cube (its top level ${store.top}), and saved so`);
    t.ok(store.wrong === 0, `at each of the ${store.levels} levels face f takes its level-0 ancestor's (f >> 2k) group exactly (${store.checked} faces, ${store.wrong} wrong)`);
    // The rounding: patterns on the top level of base faces 0..5, by their
    // level-1 children (16 top faces each) and level-2 grandchildren (4).
    const rounding = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.getMesh();
      const levels = cube._meshes.length;
      const flags = new Uint32Array(cube.getNbFaces());
      const span = 4 ** (levels - 2); // a level-1 child's top faces
      const child = (p, c) => flags.fill(1, (4 * p + c) * span, (4 * p + c + 1) * span);
      const grand = (p, c, g) => flags.fill(1, ((4 * p + c) * 4 + g) * (span / 4), ((4 * p + c) * 4 + g + 1) * (span / 4));
      [0, 1, 2].forEach((c) => child(0, c)); // three of four: joins
      [0, 3].forEach((c) => child(1, c)); // two of four, the first among them: joins (tie)
      [1, 2].forEach((c) => child(2, c)); // two of four, not the first: stays (tie)
      child(3, 0); // one of four: stays
      // Children 0 and 1 three quarters each (24 of 64 top faces, under
      // half): level by level they qualify, and then the tie goes to child 0.
      for (const c of [0, 1]) for (const g of [0, 1, 2]) grand(5, c, g);
      const out = session.groups.roundDown(cube, flags);
      return Array.from(out.subarray(0, 6));
    });
    t.eq(rounding.join(','), '1,1,0,0,0,1', 'rounding a top-level selection to level 0, level by level: 3 of 4 children joins, a 2-2 tie goes to the first child, 1 of 4 stays, and 24 of 64 top faces joins when its first two children each have 3 of 4');
    // A group assigned at level 0 directly: just the masked faces.
    const assignLow = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.getMesh();
      session.selectLevel(0);
      const mat = cube.getMaterials();
      const f = cube.getFaces();
      for (let i = 0; i < cube.getNbVertices(); i++) mat[i * 3 + 2] = 1;
      for (let k = 0; k < 4; k++) mat[f[5 * 4 + k] * 3 + 2] = 0; // face 5's corners masked
      const g = session.groups.fromMask(cube);
      const base = session.groups.baseFaces(cube);
      const top = session.groups.levelFaces(cube, cube._meshes.length - 1);
      const span = 4 ** (cube._meshes.length - 1);
      session.selectLevel(cube._meshes.length - 1);
      return { g, at5: base[5], at4: base[4], at6: base[6], under: Array.from(new Set(top.subarray(5 * span, 6 * span))), next: top[6 * span] };
    });
    t.ok(assignLow.at5 === assignLow.g && assignLow.at4 !== assignLow.g && assignLow.at6 !== assignLow.g && assignLow.under.join() === String(assignLow.g) && assignLow.next !== assignLow.g, `From mask at level 0 puts the masked face in the new group, and every top face under it (${JSON.stringify(assignLow)})`);
    const sub = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.getMesh();
      const old = session.groups.baseFaces(cube).slice();
      session.subdivide();
      const base = session.groups.baseFaces(cube);
      const k = cube._meshes.length - 1;
      const now = session.groups.levelFaces(cube, k);
      let wrong = base.length !== old.length ? 1 : 0;
      for (let i = 0; !wrong && i < base.length; i++) if (base[i] !== old[i]) wrong++;
      for (let c = 0; c < now.length; c++) if (now[c] !== old[c >> (2 * k)]) wrong++;
      return { wrong, n: now.length, levels: cube._meshes.length };
    });
    t.ok(sub.wrong === 0 && sub.n === 4 * 24576, `subdividing leaves level 0 as it was and each of the ${sub.n} new faces takes its level-0 ancestor's group (${sub.wrong} wrong)`);
    const del = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.getMesh();
      const groups = session.groups;
      const before = groups.baseFaces(cube).slice();
      const same = (a) => a.length === before.length && a.every((x, i) => x === before[i]);
      session.deleteHighestLevel();
      const after = same(groups.baseFaces(cube));
      session.undo();
      const back = same(groups.baseFaces(cube));
      session.redo();
      return { after, back, levels: cube._meshes.length };
    });
    t.ok(del.after && del.back, `deleting the highest level leaves level 0's groups as they were, and so does its undo (${JSON.stringify(del)})`);

    // --- Rebuild: a new level 0 under the old one --------------------------------------
    const rebuild = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.getMesh();
      const groups = session.groups;
      session.selectLevel(0);
      const old0 = cube._meshes[0];
      const oldBase = groups.baseFaces(cube);
      // Three groups in a pattern that gives two-two ties (A A B B by fours)
      // and, every sixteenth face, majorities.
      for (let f = 0; f < oldBase.length; f++) oldBase[f] = (((f >> 1) + (f >> 3)) % 2) + (f % 16 === 0 ? 2 : 0);
      groups.touch(cube);
      const kept = oldBase.slice();
      const ok = session.reverse();
      const low = cube._meshes[0];
      const base = groups.baseFaces(cube);
      const parent = groups.parents.get(old0)?.parent;
      // The parent map against the geometry: each old face holds exactly
      // one corner of its parent (its corner child), each parent four.
      const vmap = low._vertMapping;
      const lf = low.getFaces();
      const of = old0.getFaces();
      let geomWrong = 0;
      const kids = new Map();
      for (let f = 0; f < old0.getNbFaces(); f++) {
        const p = parent[f];
        const corners = new Set(Array.from(lf.subarray(p * 4, p * 4 + 4)).map((v) => vmap[v]));
        let n = 0;
        for (let k = 0; k < 4; k++) if (corners.has(of[f * 4 + k])) n++;
        if (n !== 1) geomWrong++;
        if (!kids.has(p)) kids.set(p, []);
        kids.get(p).push(f);
      }
      for (const list of kids.values()) if (list.length !== 4) geomWrong++;
      let moved = 0;
      for (let f = 0; f < old0.getNbFaces(); f++) if (parent[f] !== f >> 2) moved++;
      // The new level 0, by majority of the children in index order (earliest on a tie).
      let majWrong = 0;
      let ties = 0;
      let majorities = 0;
      for (let p = 0; p < low.getNbFaces(); p++) {
        const c = (kids.get(p) ?? []).sort((a, b) => a - b).map((f) => kept[f]);
        let best = c[0];
        let bestN = 0;
        for (const g of c) {
          const n = c.filter((x) => x === g).length;
          if (n > bestN) {
            bestN = n;
            best = g;
          }
        }
        if (bestN === 2 && new Set(c).size === 2) ties++;
        else if (bestN >= 2) majorities++;
        if (base[p] !== best) majWrong++;
      }
      // Above it, each face takes its ancestor's exactly, the old level 0 through the map.
      const one = groups.levelFaces(cube, 1);
      let inherit = 0;
      for (let f = 0; f < one.length; f++) if (one[f] !== base[parent[f]]) inherit++;
      const top = groups.levelFaces(cube, cube._meshes.length - 1);
      const shift = 2 * (cube._meshes.length - 2);
      for (let f = 0; f < top.length; f++) if (top[f] !== base[parent[f >> shift]]) inherit++;
      const n = { low: low.getNbFaces(), old: old0.getNbFaces() };
      session.undo();
      const back = groups.baseFaces(cube);
      const restored = cube._meshes[0] === old0 && back.length === kept.length && back.every((x, i) => x === kept[i]);
      return { ok, n, geomWrong, moved, majWrong, ties, majorities, inherit, restored };
    });
    t.ok(rebuild.ok && rebuild.geomWrong === 0, `Rebuild puts a ${rebuild.n.low}-face level 0 under the ${rebuild.n.old}-face one, each old face holding exactly one corner of the parent its map names (${rebuild.geomWrong} wrong; ${rebuild.moved} of ${rebuild.n.old} faces not under face f >> 2)`);
    t.ok(rebuild.majWrong === 0 && rebuild.ties > 0 && rebuild.majorities > 0, `its groups are the majority of each face's children, the earliest child on a tie (${rebuild.majWrong} wrong; ${rebuild.ties} ties, ${rebuild.majorities} majorities)`);
    t.ok(rebuild.inherit === 0, `and every face above takes its new level-0 ancestor's group exactly (${rebuild.inherit} wrong)`);
    t.ok(rebuild.restored, 'an undo brings the old level 0 back with its own groups');

    // --- group by angle on the cube: six sides ------------------------------------------
    const angle = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.getMesh();
      session.selectLevel(cube._meshes.length - 1);
      const t0 = performance.now();
      const n = session.groups.byAngle(cube, 40);
      const ms = performance.now() - t0;
      const counts = session.groups.counts(cube);
      const vote = session.groups.byAngle(cube, 40, 'vote');
      const voteCounts = session.groups.counts(cube);
      session.undo();
      return { n, ms, base: session.groups.baseFaces(cube).length, faces: cube.getNbFaces(), counts, vote, voteCounts };
    });
    t.ok(angle.n === 6 && angle.counts.every((c) => c === angle.base / 6), `Group by angle (40 degrees) on the cube: 6 groups, one a side of its ${angle.base} level-0 faces (${angle.counts.join(', ')}; ${angle.ms.toFixed(0)} ms from ${angle.faces} faces on screen)`);
    t.ok(angle.vote === 6 && angle.voteCounts.every((c) => c === angle.base / 6), `and a vote from the level on screen agrees there (${angle.voteCounts.join(', ')})`);

    // --- by angle on figures, and how coarse level 0 is ---------------------------------
    const figure = await page.evaluate(async () => {
      const { session, modelPanel } = window.__sculpt;
      const keep = session.getMesh();
      const groups = session.groups;
      const nbOf = (m) => m.getNbFaces();
      /** Groups whose level-0 faces are not one connected piece, and groups of under 4 faces. */
      const quality = (m) => {
        const l0 = m._meshes ? m._meshes[0] : m;
        const base = groups.baseFaces(m);
        const f = l0.getFaces();
        const parent = new Int32Array(base.length).map((_, i) => i);
        const find = (a) => {
          while (parent[a] !== a) a = parent[a] = parent[parent[a]];
          return a;
        };
        const byEdge = new Map();
        for (let i = 0; i < base.length; i++) {
          const n = f[i * 4 + 3] === 4294967295 ? 3 : 4;
          for (let k = 0; k < n; k++) {
            const a = f[i * 4 + k];
            const b = f[i * 4 + ((k + 1) % n)];
            const key = a < b ? `${a}_${b}` : `${b}_${a}`;
            const o = byEdge.get(key);
            if (o === undefined) byEdge.set(key, i);
            else if (base[o] === base[i]) parent[find(o)] = find(i);
          }
        }
        const pieces = new Map();
        for (let i = 0; i < base.length; i++) {
          const g = base[i];
          if (!pieces.has(g)) pieces.set(g, new Set());
          pieces.get(g).add(find(i));
        }
        const counts = groups.counts(m);
        return { split: [...pieces.values()].filter((p) => p.size > 1).length, tiny: counts.filter((c) => c > 0 && c < 4).length };
      };
      const run = (m) => {
        const a = groups.byAngle(m, 40);
        const qa = quality(m);
        session.undo();
        const b = groups.byAngle(m, 40, 'vote');
        const qb = quality(m);
        session.undo();
        return { level0: a, level0Split: qa.split, level0Tiny: qa.tiny, vote: b, voteSplit: qb.split, voteTiny: qb.tiny };
      };
      const body = await session.addBaseMesh('body-female-stylized');
      const lib = { base: body._meshes[0].getNbFaces(), top: nbOf(body), levels: body._meshes.length, ...run(body) };
      modelPanel.quadTarget = Math.min(50000, Math.max(500, Math.round(nbOf(body) / 4)));
      const ok = await modelPanel.runQuadRemesh();
      const q = session.getMesh();
      const quad = { ok, target: modelPanel.quadTarget, base: q._meshes ? q._meshes[0].getNbFaces() : nbOf(q), levels: q._meshes?.length ?? 1, ...run(q) };
      session.deleteMesh(q);
      session.setMesh(keep);
      return { lib, quad, sphere: (session.getMeshes().find((m) => session.getMeshName(m) === 'Sphere'))._meshes[0].getNbFaces() };
    });
    t.ok(figure.lib.level0 > 1 && figure.lib.level0Split === 0, `by angle on a library figure (${figure.lib.base} level-0 faces, ${figure.lib.top} on screen over ${figure.lib.levels} levels): level 0's split makes ${figure.lib.level0} groups, every one a connected piece (${figure.lib.level0Tiny} under 4 faces); a vote from the level on screen makes ${figure.lib.vote}, ${figure.lib.voteSplit} of them in pieces and ${figure.lib.voteTiny} under 4 faces`);
    t.ok(figure.quad.ok && figure.quad.levels === 1 && figure.quad.level0 === figure.quad.vote, `quad-remeshed (target ${figure.quad.target}), the figure is one level of ${figure.quad.base} faces, all level 0, so both ways agree (${figure.quad.level0} groups)`);
    t.ok(true, `how coarse level 0 is: the default sphere ${figure.sphere} faces, the library figure ${figure.lib.base}, the quad-remeshed figure ${figure.quad.base}`);

    // --- Shift+F: the colours -------------------------------------------------------
    await page.keyboard.press('Shift+f');
    let colors = await page.evaluate(() => {
      const { viewer, sync, session } = window.__sculpt;
      const attr = sync.geometry.getAttribute('groupColor');
      return { on: viewer.materials.getSculptGroupColors(), showing: session.groups.isShowing(), attr: !!attr, len: attr?.array.length ?? 0, need: session.getMesh().getNbVertices() * 3, checkbox: document.querySelector('[data-role="groups"] input[type="checkbox"]')?.checked };
    });
    t.ok(colors.on && colors.showing && colors.attr && colors.len >= colors.need && colors.checkbox, `Shift+F shows the group colours: a colour a vertex on the display, the panel's switch on (${JSON.stringify(colors)})`);
    await page.keyboard.press('Shift+f');
    colors = await page.evaluate(() => ({ on: window.__sculpt.viewer.materials.getSculptGroupColors(), attr: !!window.__sculpt.sync.geometry.getAttribute('groupColor') }));
    t.ok(!colors.on && !colors.attr, 'and again hides them');

    // --- Ctrl+Shift+click: isolate, invert, show all ----------------------------------
    // The cube from its front, the sphere moved out of the way.
    const cubeBox = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const sphere = session.getMeshes().find((m) => session.getMeshName(m) === 'Sphere');
      sphere.getMatrix()[12] = 400;
      const b = session.getMesh().computeWorldBound().slice();
      return b;
    });
    const mid = [(cubeBox[0] + cubeBox[3]) / 2, (cubeBox[1] + cubeBox[4]) / 2, (cubeBox[2] + cubeBox[5]) / 2];
    await view(page, [mid[0], mid[1], mid[2] + 70], mid);
    await settle(page);
    const frontLocal = await page.evaluate((w) => {
      const m = window.__sculpt.session.getMesh().getMatrix();
      return [w[0] - m[12], w[1] - m[13], w[2] - m[14]].map((x, i) => x / Math.hypot(m[i * 4], m[i * 4 + 1], m[i * 4 + 2]));
    }, [mid[0], mid[1], cubeBox[5]]);
    const front = await page.evaluate(groupNear, frontLocal);
    const centre = await screenOf(page, [mid[0], mid[1], cubeBox[5]]);
    before = await groupsOf(page);
    await mouseDrag(page, [centre], CTRL | SHIFT);
    await settle(page);
    g = await groupsOf(page);
    let click = await page.evaluate(() => window.__sculpt.input.lastGroupClick);
    t.ok(
      click?.kind === 'isolated' && click.group === front && g.hidden.filter((h) => !h).length === 1 && !g.hidden[front] && g.undo === before.undo + 1,
      `Ctrl+Shift+click on the front side shows it alone (${JSON.stringify({ click: click && { kind: click.kind, group: click.group }, front, hidden: g.hidden })})`,
    );
    const drawn = await page.evaluate(() => {
      const { sync, session } = window.__sculpt;
      return { count: sync.geometry.drawRange.count, all: session.getMesh().getNbTriangles() * 3 };
    });
    t.ok(drawn.count === drawn.all / 6, `only its triangles are drawn (${drawn.count} of ${drawn.all} indices)`);
    await mouseDrag(page, [centre], CTRL | SHIFT);
    await settle(page);
    g = await groupsOf(page);
    click = await page.evaluate(() => window.__sculpt.input.lastGroupClick);
    t.ok(click?.kind === 'inverted' && g.hidden[front] && g.hidden.filter((h) => h).length === 1, `again: it hides and the rest show (${JSON.stringify(g.hidden)})`);

    // Hidden faces are not picked, and a stroke across them leaves them be.
    const pick = await page.evaluate(
      ([x, y, f]) => {
        const { session } = window.__sculpt;
        const r = session.getCanvas().getBoundingClientRect();
        const pr = session.getPixelRatio();
        const p = session.getPicking();
        const hit = p.intersectionMouseMeshes(undefined, (x - r.left) * pr, (y - r.top) * pr);
        return { hit, group: hit ? session.groups.groupOfFace(p.getMesh(), p.getPickedFace()) : -1, front: f };
      },
      [centre[0], centre[1], front],
    );
    t.ok(!pick.hit || pick.group !== front, `a ray through the hidden side does not pick it (hit group ${pick.group})`);
    const hiddenSum = () =>
      page.evaluate((fg) => {
        const { session } = window.__sculpt;
        const m = session.getMesh();
        const groups = session.groups.levelFaces(m);
        const f = m.getFaces();
        const v = m.getVertices();
        const seen = new Set();
        let sum = 0;
        for (let i = 0; i < m.getNbFaces(); i++) {
          if (groups[i] !== fg) continue;
          for (let k = 0; k < 4; k++) {
            const j = f[i * 4 + k];
            if (seen.has(j)) continue;
            seen.add(j);
            sum += v[j * 3] * 1.7 + v[j * 3 + 1] * 2.3 + v[j * 3 + 2] * 3.1;
          }
        }
        let all = 0;
        for (let i = 0; i < m.getNbVertices() * 3; i++) all += v[i] * ((i % 7) + 1);
        return { sum, n: seen.size, all };
      }, front);
    // Seen from the front and the right at once, a stroke from the
    // hidden front across onto the right side.
    await view(page, [mid[0] + 50, mid[1] + 10, mid[2] + 50], mid);
    await settle(page);
    const hs0 = await hiddenSum();
    const strokes0 = await page.evaluate(() => window.__sculpt.input.strokeCount());
    const fromFront = await screenOf(page, [mid[0] - 4, mid[1], cubeBox[5]]);
    const ontoRight = await screenOf(page, [cubeBox[3], mid[1], mid[2] - 4]);
    await page.mouse.move(fromFront[0], fromFront[1]);
    await page.mouse.down();
    await page.mouse.move(ontoRight[0], ontoRight[1], { steps: 12 });
    await page.mouse.up();
    await settle(page);
    const hs1 = await hiddenSum();
    const strokes1 = await page.evaluate(() => window.__sculpt.input.strokeCount());
    t.ok(hs1.sum === hs0.sum && hs1.n === hs0.n, `a stroke across the hidden side leaves every vertex of it where it was (${hs0.n} vertices)`);
    t.ok(strokes1 > strokes0 && hs1.all !== hs0.all, `while it sculpts the visible side it reaches (${strokes1 - strokes0} stroke)`);
    await page.evaluate(() => window.__sculpt.session.undo());
    await view(page, [mid[0], mid[1], mid[2] + 70], mid);
    await settle(page);

    // Empty space shows all.
    // From farther off, where there is room around the cube.
    await view(page, [mid[0], mid[1], mid[2] + 250], mid);
    await settle(page);
    const empty = await emptySpot(page);
    await mouseDrag(page, [empty], CTRL | SHIFT);
    await settle(page);
    g = await groupsOf(page);
    click = await page.evaluate(() => window.__sculpt.input.lastGroupClick);
    const full = await page.evaluate(() => ({ count: window.__sculpt.sync.geometry.drawRange.count, all: window.__sculpt.session.getMesh().getNbTriangles() * 3 }));
    t.ok(click?.kind === 'showAll' && g.hidden.every((h) => !h) && full.count === full.all, `Ctrl+Shift+click on empty space shows all (${click?.kind}, ${JSON.stringify(g.hidden)})`);
    await view(page, [mid[0], mid[1], mid[2] + 70], mid);
    await settle(page);

    // --- Ctrl+click masks a group, Ctrl+Alt+click unmasks it ----------------------------
    const masked = () =>
      page.evaluate(() => {
        const m = window.__sculpt.session.getMesh();
        const mat = m.getMaterials();
        let n = 0;
        for (let i = 0; i < m.getNbVertices(); i++) if (mat[i * 3 + 2] < 0.5) n++;
        return { n, undo: window.__sculpt.session.getStateManager()._curUndoIndex };
      });
    await page.keyboard.press('Control+c');
    const frontVerts = hs0.n;
    let mk0 = await masked();
    await mouseDrag(page, [centre], CTRL);
    await settle(page);
    let mk = await masked();
    click = await page.evaluate(() => window.__sculpt.input.lastGroupClick);
    t.ok(click?.kind === 'mask' && mk.n === frontVerts && mk.undo === mk0.undo + 1, `Ctrl+click on the front side masks its ${frontVerts} vertices, one undo step (${mk.n} masked)`);
    await mouseDrag(page, [centre], CTRL | ALT);
    await settle(page);
    mk = await masked();
    t.ok(mk.n === 0, `Ctrl+Alt+click unmasks them (${mk.n} masked)`);
    await page.evaluate(() => window.__sculpt.session.undo());
    mk = await masked();
    t.eq(mk.n, frontVerts, 'an undo masks them again');
    await page.keyboard.press('Control+c');

    // --- dynamic topology, a mirror copy, a voxel remesh ---------------------------------
    const dyn = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const before = session.getMesh();
      const groupsBefore = session.groups.levelFaces(before).slice();
      const quadsBefore = before.getNbQuads();
      session.toggleDynamicTopology();
      const d = session.getMesh();
      const tri = session.groups.baseFaces(d);
      // Each quad is two triangles, in face order.
      let wrong = 0;
      let t = 0;
      const f = before.getFaces();
      for (let i = 0; i < groupsBefore.length; i++) {
        const n = f[i * 4 + 3] === 4294967295 ? 1 : 2;
        for (let k = 0; k < n; k++) if (tri[t++] !== groupsBefore[i]) wrong++;
      }
      const names = session.groups.names(d).length;
      session.toggleDynamicTopology();
      const back = session.groups.baseFaces(session.getMesh());
      let wrongBack = back.length !== tri.length ? 1 : 0;
      for (let i = 0; !wrongBack && i < back.length; i++) if (back[i] !== tri[i]) wrongBack++;
      session.undo();
      session.undo();
      return { wrong, wrongBack, names, tris: tri.length, quads: quadsBefore, same: session.getMesh() === before };
    });
    t.ok(dyn.wrong === 0 && dyn.wrongBack === 0 && dyn.names === 6 && dyn.same, `dynamic topology carries the groups to its ${dyn.tris} triangles and back (${JSON.stringify(dyn)})`);
    const mirror = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.getMesh();
      const copy = session.mirrorMesh(cube, 'x');
      const centres = (m) => {
        const c = m.getFaceCenters();
        const M = m.getMatrix();
        const out = [];
        for (let f = 0; f < m.getNbFaces(); f += 97) {
          const [x, y, z] = [c[f * 3], c[f * 3 + 1], c[f * 3 + 2]];
          out.push([f, M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]);
        }
        return out;
      };
      const a = centres(cube);
      const bAll = (() => {
        const c = copy.getFaceCenters();
        const M = copy.getMatrix();
        const out = [];
        for (let f = 0; f < copy.getNbFaces(); f++) {
          const [x, y, z] = [c[f * 3], c[f * 3 + 1], c[f * 3 + 2]];
          out.push([f, M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]]);
        }
        return out;
      })();
      const ga = session.groups.levelFaces(cube);
      const gb = session.groups.levelFaces(copy);
      let wrong = 0;
      for (const [f, x, y, z] of a) {
        let best = -1;
        let bd = Infinity;
        for (const [h, X, Y, Z] of bAll) {
          const d = (X + x) ** 2 + (Y - y) ** 2 + (Z - z) ** 2;
          if (d < bd) {
            bd = d;
            best = h;
          }
        }
        if (gb[best] !== ga[f]) wrong++;
      }
      const names = session.groups.names(copy).join('|') === session.groups.names(cube).join('|');
      session.deleteMesh(copy);
      session.setMesh(cube);
      return { wrong, n: a.length, names };
    });
    t.ok(mirror.wrong === 0 && mirror.names, `a mirror copy keeps each face's group on its mirrored face (${mirror.n} sampled, ${mirror.wrong} wrong)`);
    const remesh = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.getMesh();
      // Each side's group, by its outward axis.
      const sideGroup = {};
      const c = cube.getFaceCenters();
      const unit = (a) => {
        const out = new Float32Array(a.length);
        for (let i = 0; i < a.length; i += 3) {
          const l = Math.hypot(a[i], a[i + 1], a[i + 2]) || 1;
          out[i] = a[i] / l;
          out[i + 1] = a[i + 1] / l;
          out[i + 2] = a[i + 2] / l;
        }
        return out;
      };
      const n = unit(cube.getFaceNormals());
      const g = session.groups.levelFaces(cube);
      for (let f = 0; f < cube.getNbFaces(); f++) {
        for (let k = 0; k < 3; k++) {
          if (Math.abs(n[f * 3 + k]) > 0.99) sideGroup[`${k}${n[f * 3 + k] > 0 ? '+' : '-'}`] = g[f];
        }
      }
      session.setRemeshResolution(60);
      const t0 = performance.now();
      session.voxelRemesh();
      const ms = performance.now() - t0;
      const m = session.getMesh();
      const mc = m.getFaceCenters();
      const mn = unit(m.getFaceNormals());
      const mg = session.groups.levelFaces(m);
      let flat = 0;
      let right = 0;
      for (let f = 0; f < m.getNbFaces(); f++) {
        for (let k = 0; k < 3; k++) {
          if (Math.abs(mn[f * 3 + k]) < 0.99) continue;
          flat++;
          if (mg[f] === sideGroup[`${k}${mn[f * 3 + k] > 0 ? '+' : '-'}`]) right++;
        }
      }
      void c;
      void mc;
      return { flat, right, names: session.groups.names(m).length, ms, faces: m.getNbFaces() };
    });
    t.ok(remesh.names === 6 && remesh.flat > 1000 && remesh.right / remesh.flat > 0.98, `a voxel remesh gives the new faces the group of the nearest old one (${remesh.right} of ${remesh.flat} flat faces on their side's group; ${remesh.ms.toFixed(0)} ms)`);
    await page.evaluate(() => window.__sculpt.session.undo());

    // --- persistence: a .bozz, a malformed one, an older one, the autosave --------------
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.getMesh();
      session.groups.rename(cube, 2, 'Top side');
      session.groups.setHidden(cube, 4, true);
    });
    const saved = await groupsOf(page);
    const roundTrip = await page.evaluate(async () => {
      const { file, session } = window.__sculpt;
      const bytes = await file.pack();
      const rec = await file.unpack(bytes);
      const cubeRec = rec.meshes.find((m) => m.name === 'Cube');
      const shape = cubeRec?.groups && {
        v: cubeRec.groups.v,
        faces: cubeRec.groups.faces.constructor.name,
        len: cubeRec.groups.faces.length,
        names: cubeRec.groups.names,
        hidden: cubeRec.groups.hidden && [cubeRec.groups.hidden.constructor.name, ...cubeRec.groups.hidden],
      };
      const sphereRec = rec.meshes.find((m) => m.name === 'Sphere');
      await file.open(bytes);
      const cube = session.getMeshes().find((m) => session.getMeshName(m) === 'Cube');
      session.setMesh(cube);
      return { shape, sphereGroups: sphereRec?.groups ? sphereRec.groups.names : null };
    });
    t.ok(
      roundTrip.shape && roundTrip.shape.v === 2 && roundTrip.shape.faces === 'Uint32Array' && roundTrip.shape.len === saved.base && saved.base === saved.level0 && roundTrip.shape.names.join('|') === saved.names.join('|') && roundTrip.shape.hidden?.[0] === 'Uint8Array' && roundTrip.shape.hidden[5] === 1,
      `a .bozz carries groups: { v: 2, faces: Uint32Array of level 0's ${saved.base}, names, hidden: Uint8Array a group } (${JSON.stringify(roundTrip.shape && { ...roundTrip.shape, names: roundTrip.shape.names.length })})`,
    );
    t.ok(roundTrip.sphereGroups && roundTrip.sphereGroups.length === 2, 'the sphere its own (from Ctrl+W)');
    g = await groupsOf(page);
    t.ok(g.names.join('|') === saved.names.join('|') && g.counts.join() === saved.counts.join() && g.hidden.join() === saved.hidden.join(), `and opened again, the same groups, names and hidden side (${g.names.join(', ')})`);
    const refused = await page.evaluate(async () => {
      const { file } = window.__sculpt;
      const out = {};
      const base = await file.unpack(await file.pack());
      const tries = {
        'a face in a group there is not': (r) => (r.meshes[0].groups.faces[0] = 99),
        'faces short of level 0': (r) => (r.meshes[0].groups.faces = r.meshes[0].groups.faces.slice(1)),
        'version 2 sized to the top level': (r) => (r.meshes[0].groups.faces = new Uint32Array(r.meshes[0].nbBaseFaces * 4 ** (r.meshes[0].levels.length - 1))),
        'hidden flags short of the names': (r) => (r.meshes[0].groups.hidden = new Uint8Array(1)),
        'a version there is not': (r) => (r.meshes[0].groups.v = 3),
        'version 1 sized to level 0': (r) => (r.meshes[0].groups.v = 1),
        'no names': (r) => (r.meshes[0].groups.names = []),
      };
      for (const [what, edit] of Object.entries(tries)) {
        const rec = structuredClone(base);
        const i = rec.meshes.findIndex((m) => m.groups);
        rec.meshes.unshift(rec.meshes.splice(i, 1)[0]);
        rec.active = 0;
        edit(rec);
        try {
          await file.unpack(await file.packRecord(rec));
          out[what] = 'opened';
        } catch (err) {
          out[what] = String(err.message);
        }
      }
      // An older scene: no groups field at all.
      const older = structuredClone(base);
      for (const m of older.meshes) delete m.groups;
      await file.open(await file.packRecord(older));
      const { session } = window.__sculpt;
      out.older = session.getMeshes().map((m) => session.groups.names(m).length + ':' + session.groups.counts(m)[0] + '/' + session.groups.baseFaces(m).length);
      await file.open(await file.packRecord(base));
      return out;
    });
    const refusals = Object.entries(refused).filter(([k]) => k !== 'older');
    t.ok(
      refusals.every(([, why]) => /poly groups/.test(why)),
      `a scene with malformed groups is refused, saying so (${refusals.map(([k, v]) => `${k}: ${v.replace(/.*poly groups[: (]*/, '')}`).join('; ')})`,
    );
    t.ok(refused.older.every((x) => /^1:(\d+)\/\1$/.test(x)), `an older scene opens with every face in group 0 (${refused.older.join(', ')})`);
    // A version 1 record (2026-10-31): one group a face of the top level.
    // Level 0 face 0's top faces are made so a flat vote and level by level
    // part ways: children 0 and 1 three quarters "Top side" (2), the rest
    // "Group 5" (4); level by level 2 wins the tie at child 0, flat 4 wins 40 to 24.
    const v1 = await page.evaluate(async (roundSrc) => {
      const roundLevels = new Function(`return ${roundSrc}`)();
      const { file, session } = window.__sculpt;
      const orig = await file.pack();
      const rec = await file.unpack(orig);
      const m = rec.meshes.find((x) => x.name === 'Cube');
      const cube = session.getMeshes().find((x) => session.getMeshName(x) === 'Cube');
      const k = m.levels.length - 1;
      const top = new Uint32Array(session.groups.levelFaces(cube, k));
      const span = 4 ** k;
      const g = span / 16; // a level-2 face's top faces
      top.fill(4, 0, span);
      for (const c of [0, 1]) for (const gc of [0, 1, 2]) top.fill(2, (c * 4 + gc) * g, (c * 4 + gc + 1) * g);
      const expect = roundLevels(top, k);
      m.groups = { ...m.groups, v: 1, faces: top };
      await file.open(await file.packRecord(rec));
      const now = session.getMeshes().find((x) => session.getMeshName(x) === 'Cube');
      const base = Array.from(session.groups.baseFaces(now));
      let wrong = base.length !== expect.length ? 1 : 0;
      for (let i = 0; i < base.length; i++) if (base[i] !== expect[i]) wrong++;
      const saved = session.groups.serialize(now);
      const flat = Array.from(top.subarray(0, span)).filter((x) => x === 4).length;
      await file.open(orig);
      return { wrong, n: base.length, face0: base[0], flat, v: saved.v, len: saved.faces.length };
    }, roundLevels.toString());
    t.ok(v1.wrong === 0 && v1.face0 === 2 && v1.flat === 40 && v1.v === 2 && v1.len === v1.n, `a version 1 record opens rounded down to level 0 level by level (${v1.n} faces, ${v1.wrong} off; face 0 in group ${v1.face0 + 1} though ${v1.flat} of its 64 top faces are in group 5), and saves again as version 2`);

    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.setMesh(session.getMeshes().find((m) => session.getMeshName(m) === 'Cube'));
    });
    await page.evaluate(() => window.__sculpt.persist.markDirty());
    await page.evaluate(() => window.__sculpt.persist.flush());
    await page.goto(`${base}/?sculpt=1&q=low`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.setMesh(session.getMeshes().find((m) => session.getMeshName(m) === 'Cube'));
    });
    g = await groupsOf(page);
    t.ok(g.names.join('|') === saved.names.join('|') && g.counts.join() === saved.counts.join() && g.hidden.join() === saved.hidden.join(), `the autosave keeps them through a reload (${g.names.length} groups, side ${saved.hidden.indexOf(true) + 1} hidden)`);
    const drawnAfter = await page.evaluate(() => ({ count: window.__sculpt.sync.geometry.drawRange.count, all: window.__sculpt.session.getMesh().getNbTriangles() * 3 }));
    const nHidden = saved.hidden.filter(Boolean).length;
    t.ok(nHidden > 0 && drawnAfter.count === (drawnAfter.all * (6 - nHidden)) / 6, `and the hidden sides are still not drawn (${drawnAfter.count} of ${drawnAfter.all}, ${nHidden} hidden)`);

    // --- the Groups list ------------------------------------------------------------
    t.ok(await openPanel(page, 'Model'), 'the Model panel opens');
    const rows = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-role="groups-list"] .groups-row')].map((r) => ({
          name: r.querySelector('.groups-row__name')?.textContent ?? r.querySelector('input')?.value,
          hidden: r.classList.contains('groups-row--hidden'),
          swatch: r.querySelector('.groups-row__swatch')?.style.background ?? '',
        })),
      );
    let list = await rows();
    t.ok(list.length === 6 && list[2].name === 'Top side' && list[4].hidden && new Set(list.map((r) => r.swatch)).size === 6, `the list has a row a group, each its own colour, the hidden one dimmed (${list.map((r) => r.name + (r.hidden ? ' (hidden)' : '')).join(', ')})`);
    const tapIn = async (sel) => {
      await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center', behavior: 'instant' }), sel);
      await frames(page);
      const box = await page.locator(sel).first().boundingBox();
      await dev.tap([box.x + box.width / 2, box.y + box.height / 2]);
    };
    await tapIn('[data-role="groups-list"] .groups-row[data-group="1"] .groups-row__name');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Left side');
    await page.keyboard.press('Enter');
    g = await groupsOf(page);
    list = await rows();
    t.ok(g.names[1] === 'Left side' && list[1].name === 'Left side', `a tap on a name renames the group (${g.names[1]})`);
    await tapIn('[data-role="groups-list"] .groups-row[data-group="0"] [data-role="group-eye"]');
    g = await groupsOf(page);
    t.ok(g.hidden[0] && g.hidden[4], `a tap on the eye hides the group (${JSON.stringify(g.hidden)})`);
    await tapIn('[data-role="groups-show-all"]');
    g = await groupsOf(page);
    t.ok(g.hidden.every((h) => !h), 'Show all shows them all');
    const counts0 = g.counts;
    await tapIn('[data-role="groups-list"] .groups-row[data-group="5"] [data-role="group-delete"]');
    g = await groupsOf(page);
    t.ok(
      g.names.length === 5 && g.counts.reduce((a, b) => a + b, 0) === saved.base && Math.max(...g.counts) === counts0[5] * 2 && !g.names.includes(saved.names[5]),
      `delete merges the group's faces into a group it borders, and the rows close up (${g.counts.join(', ')})`,
    );
    await page.evaluate(() => window.__sculpt.session.undo());
    g = await groupsOf(page);
    t.ok(g.names.length === 6 && g.counts.join() === counts0.join(), 'an undo brings the group back');

    // --- an OBJ's g lines, both exports, and UV islands ---------------------------------
    const imported = await page.evaluate(async (src) => {
      const { fileActions, session } = window.__sculpt;
      await fileActions.importObj(src, false, 'UV strip');
      const m = session.getMesh();
      const l0 = session.groups.levelFaces(m, 0);
      return { names: session.groups.names(m), l0: Array.from(l0), hasUV: session.hasUVIslands(m), uvButton: !document.querySelector('[data-role="groups-by-uv"]')?.disabled };
    }, uvObj);
    t.ok(imported.names.join('|') === 'left|right' && imported.l0.join(',') === '0,1,1', `an OBJ's g lines import as groups: faces 1 in "left", 2 and 3 in "right" (${JSON.stringify(imported)})`);
    let out = await page.evaluate(() => window.__sculpt.fileActions.originalObj().text);
    t.eq(gLines(out).join(' | '), gLines(uvObj).join(' | '), 'the numbered export writes the g lines back as they were while the groups are the file\'s');
    t.ok(/\ng left\n/.test(await page.evaluate(() => window.__sculpt.file.toOBJ())), 'and the triangle export writes g lines too');
    // Regroup: the third face into a group of its own, renamed.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMesh();
      session.selectLevel(0);
      const mat = m.getMaterials();
      const f = m.getFaces();
      for (let i = 0; i < m.getNbVertices(); i++) mat[i * 3 + 2] = 1;
      for (let k = 0; k < 4; k++) mat[f[2 * 4 + k] * 3 + 2] = 0;
      const g = session.groups.fromMask(m);
      session.groups.rename(m, g, 'end cap');
      session.selectLevel(m._meshes.length - 1);
    });
    out = await page.evaluate(() => window.__sculpt.fileActions.originalObj().text);
    t.eq(gLines(out).join(' | '), '0:g left | 1:g right | 2:g end cap', 'regrouped, the numbered export writes a g line where each group starts');
    const back = await page.evaluate(async (src) => {
      const { fileActions, session } = window.__sculpt;
      const before = session.getMesh();
      const was = { names: session.groups.names(before), l0: Array.from(session.groups.levelFaces(before, 0)) };
      await fileActions.importObj(src, false, 'UV strip again');
      const m = session.getMesh();
      const now = { names: session.groups.names(m), l0: Array.from(session.groups.levelFaces(m, 0)) };
      session.deleteMesh(m);
      session.setMesh(before);
      return { was, now };
    }, out);
    t.ok(back.now.names.join('|') === back.was.names.join('|') && back.now.l0.join() === back.was.l0.join(), `and that file imports again as the same groups, names and faces (${JSON.stringify(back.now)})`);
    t.ok(imported.hasUV && imported.uvButton, 'By UV islands is offered for an OBJ with texture coordinates');
    const uv = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMesh();
      const n = session.groupByUVIslands(m);
      return { n, names: session.groups.names(m), l0: Array.from(session.groups.levelFaces(m, 0)), top: session.groups.counts(m) };
    });
    t.ok(uv.n === 2 && uv.l0.join(',') === '0,1,1' && uv.names.join('|') === 'UV island 1|UV island 2', `By UV islands: two islands, the first face alone, the other two together (${JSON.stringify(uv)})`);
    const sphereUV = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const s = session.getMeshes().find((m) => session.getMeshName(m) === 'Sphere');
      session.setMesh(s);
      return { has: session.hasUVIslands(s), disabled: !!document.querySelector('[data-role="groups-by-uv"]')?.disabled };
    });
    t.ok(!sphereUV.has && sphereUV.disabled, 'and greyed out for the sphere, which has none');

    // --- timings at 393k faces ---------------------------------------------------------
    const timing = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const s = session.getMesh();
      while (s.getNbFaces() < 390000) session.subdivide();
      const groups = session.groups;
      const ms = {};
      let t0 = performance.now();
      const mat = s.getMaterials();
      const v = s.getVertices();
      for (let i = 0; i < s.getNbVertices(); i++) mat[i * 3 + 2] = v[i * 3 + 1] < 0 ? 0 : 1;
      t0 = performance.now();
      groups.fromMask(s);
      ms.fromMask = performance.now() - t0;
      t0 = performance.now();
      groups.byAngle(s, 40);
      ms.byAngle = performance.now() - t0;
      session.undo();
      t0 = performance.now();
      groups.isolate(s, 1);
      ms.isolateAndIndex = performance.now() - t0;
      t0 = performance.now();
      groups.hiddenVertices(s);
      ms.hiddenVertices = performance.now() - t0;
      t0 = performance.now();
      groups.showAll(s);
      ms.showAll = performance.now() - t0;
      t0 = performance.now();
      session.selectLevel(s._sel - 2);
      ms.inherit2Down = performance.now() - t0;
      session.selectLevel(s._meshes.length - 1);
      t0 = performance.now();
      const saved = groups.serialize(s);
      ms.serialize = performance.now() - t0;
      return { faces: s.getNbFaces(), ms, savedLen: saved?.faces.length };
    });
    const pretty = Object.entries(timing.ms)
      .map(([k, v]) => `${k} ${v.toFixed(0)} ms`)
      .join(', ');
    t.ok(timing.faces > 390000 && timing.ms.fromMask < 1000 && timing.ms.isolateAndIndex < 1000, `at ${timing.faces} faces: ${pretty}`);
    await frames(page);
  },
};
