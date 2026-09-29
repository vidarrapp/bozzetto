// The smoke suites: boot, the Create menu's primitives and base meshes,
// the scene-file round trip, and the Armature boot. Each gets (page, base,
// t) - a fresh page, the server's origin, and the check collector.
import { openArmature, openSculpt } from './lib.mjs';

const count = (page) => page.evaluate(() => window.__sculpt.session.getMeshes().length);
const names = (page) => page.evaluate(() => window.__sculpt.session.getMeshes().map((m) => window.__sculpt.session.getMeshName(m)));

export const suites = {
  async boot(page, base, t) {
    await openSculpt(page, base);
    t.eq(await count(page), 1, 'a new sculpt has one object');
    t.eq((await names(page))[0], 'Sphere', 'and it is the sphere');
    const faces = await page.evaluate(() => window.__sculpt.session.getMesh().getNbFaces());
    t.ok(faces >= 20000, `the sphere is subdivided (${faces} faces)`);
    const tiles = await page.evaluate(() => document.querySelectorAll('.outliner__tile').length);
    const words = await page.evaluate(() => document.querySelectorAll('.outliner__menu-grid--words .outliner__menu-item').length);
    t.eq(tiles, 23, 'the Create menu lists every base mesh');
    t.eq(words, 7, 'and every primitive');
  },

  async primitives(page, base, t) {
    await openSculpt(page, base);
    const kinds = ['sphere', 'cube', 'cylinder', 'torus', 'cone', 'capsule', 'plane'];
    for (const kind of kinds) {
      const before = await count(page);
      const r = await page.evaluate((k) => {
        const s = window.__sculpt.session;
        const m = s.addPrimitive(k);
        const mat = m.getMatrix();
        return {
          faces: m.getNbFaces(),
          name: s.getMeshName(m),
          selected: s.getMesh() === m,
          radius: m.computeLocalRadius() * Math.hypot(mat[0], mat[1], mat[2]),
        };
      }, kind);
      t.eq(await count(page), before + 1, `${kind}: one more object`);
      t.ok(r.faces >= 20000, `${kind}: subdivided to ${r.faces} faces`);
      t.ok(r.selected, `${kind}: selected after adding`);
      // normalizeSize measures the base cage; smooth subdivision then pulls
      // a sphere or a cone's apex inward, so the finished object sits a
      // little under the canonical 50.
      t.ok(r.radius > 40 && r.radius < 50.5, `${kind}: at the canonical size (radius ${r.radius.toFixed(1)})`);
      t.ok(/^[A-Z]/.test(r.name), `${kind}: named "${r.name}"`);
    }
    const total = await count(page);
    await page.evaluate(() => window.__sculpt.session.undo());
    t.eq(await count(page), total - 1, 'undo removes the last primitive');
    await page.evaluate(() => window.__sculpt.session.redo());
    t.eq(await count(page), total, 'redo puts it back');
  },

  async basemeshes(page, base, t) {
    await openSculpt(page, base);
    // A single part: the stylized hand, 880 quads in the file.
    let before = await count(page);
    const hand = await page.evaluate(async () => {
      const s = window.__sculpt.session;
      const m = await s.addBaseMesh('hand-stylized');
      const mat = m.getMatrix();
      return {
        name: s.getMeshName(m),
        faces: m.getNbFaces(),
        levels: m.getNbMeshes ? m.getNbMeshes() : -1,
        selected: s.getMesh() === m,
        radius: m.computeLocalRadius() * Math.hypot(mat[0], mat[1], mat[2]),
        translation: [mat[12], mat[13], mat[14]],
      };
    });
    t.eq(await count(page), before + 1, 'hand: one object added');
    t.eq(hand.name, 'Hand', 'hand: named after the tile');
    t.ok(hand.faces >= 20000, `hand: subdivided to ${hand.faces} faces`);
    t.ok(hand.selected, 'hand: selected');
    t.near(hand.radius, 50, 0.5, 'hand: at the canonical size');
    t.near(Math.hypot(...hand.translation), 0, 1e-3, 'hand: centred');

    // Three parts: a head and its eyes, one undo step, eyes in front (+Z).
    before = await count(page);
    const head = await page.evaluate(async () => {
      const s = window.__sculpt.session;
      const m = await s.addBaseMesh('head-stylized');
      const all = s.getMeshes();
      const parts = all.slice(all.length - 3).map((p) => {
        const mat = p.getMatrix();
        return { name: s.getMeshName(p), faces: p.getNbFaces(), z: mat[14], y: mat[13], x: mat[12] };
      });
      return { selected: s.getMesh() === m, parts };
    });
    t.eq(await count(page), before + 3, 'head: three objects added');
    t.eq(head.parts.map((p) => p.name).join(','), 'Head,Eye L,Eye R', 'head: named parts');
    t.ok(head.selected, 'head: the head is selected, not an eye');
    t.ok(head.parts[1].z > 5 && head.parts[2].z > 5, `head: eyes sit in front (z ${head.parts[1].z.toFixed(1)})`);
    t.ok(head.parts[1].x > 0 && head.parts[2].x < 0, 'head: eye L on +X, eye R on -X');
    t.ok(head.parts[1].faces < 20000, `head: an eye stops early (${head.parts[1].faces} faces)`);
    await page.evaluate(() => window.__sculpt.session.undo());
    t.eq(await count(page), before, 'head: one undo removes all three');
    await page.evaluate(() => window.__sculpt.session.redo());
    t.eq(await count(page), before + 3, 'head: redo brings all three back');

    // Linear subdivision keeps the planar skull's facets: the base cage's
    // vertices come first in every level, so they stay where they were,
    // where smooth subdivision (the hand) moves them.
    const drift = await page.evaluate(async () => {
      const s = window.__sculpt.session;
      const driftOf = (m) => {
        const base = m._meshes[0].getVertices();
        const top = m.getVertices();
        let d = 0;
        for (let i = 0; i < 300; i++) d = Math.max(d, Math.abs(base[i] - top[i]));
        return d;
      };
      const planar = await s.addBaseMesh('skull-planar');
      const hand = s.getMeshes().find((m) => s.getMeshName(m) === 'Hand');
      return { planarFaces: planar.getNbFaces(), planar: driftOf(planar), hand: driftOf(hand) };
    });
    t.ok(drift.planarFaces >= 20000, `planar skull: subdivided to ${drift.planarFaces} faces`);
    t.ok(drift.planar < 1e-6, `planar skull: base vertices stay put (drift ${drift.planar})`);
    t.ok(drift.hand > 1e-3, `hand: smooth subdivision moves them (drift ${drift.hand.toFixed(4)})`);

    // A blockout: the one remeshed shell by default, or every lump as its
    // own object, hierarchy order, one undo step.
    before = await count(page);
    await page.evaluate(() => window.__sculpt.session.addBaseMesh('head-blockout'));
    t.eq(await count(page), before + 1, 'blockout head: one object by default');
    before = await count(page);
    const split = await page.evaluate(async () => {
      const s = window.__sculpt.session;
      const m = await s.addBaseMesh('head-blockout', { parts: true });
      const all = s.getMeshes();
      const mine = all.slice(all.length - 11);
      return {
        n: all.length,
        first: s.getMeshName(m),
        names: mine.map((x) => s.getMeshName(x)),
        faces: mine.map((x) => x.getNbFaces()),
      };
    });
    t.eq(split.n, before + 11, 'blockout head as parts: eleven objects');
    t.ok(/^Head( \d+)?$/.test(split.first), `the head part leads and is selected (${split.first})`);
    t.ok(split.names.includes('Nose') && split.names.includes('Ear L'), `parts named: ${split.names.join(', ')}`);
    t.ok(split.faces.every((f) => f >= 1000 && f < 20000), `parts subdivided modestly (${Math.min(...split.faces)}–${Math.max(...split.faces)} faces)`);
    await page.evaluate(() => window.__sculpt.session.undo());
    t.eq(await count(page), before, 'blockout parts: one undo removes them all');
    const pills = await page.evaluate(() => [...document.querySelectorAll('.outliner__menu-pill')].map((p) => `${p.textContent}:${p.getAttribute('aria-pressed')}`));
    t.eq(pills.join(' '), 'one object:true parts:false', 'the switch defaults to one object');

    // An unknown id rejects rather than adding.
    const unknown = await page.evaluate(() => window.__sculpt.session.addBaseMesh('no-such-mesh').then(() => 'added', (e) => String(e.message)));
    t.ok(/Unknown base mesh/.test(unknown), `unknown id rejects (${unknown})`);
  },

  async alphas(page, base, t) {
    await openSculpt(page, base);
    // Every stencil any tool offers: the picker's image and thumbnail are
    // served, and the loader registered it under its own id (a collision
    // would have renamed it rake061-style and broken the picker).
    const sets = await page.evaluate(() => {
      const input = window.__sculpt.input;
      const out = {};
      for (let tool = 0; tool < 24; tool++) {
        const set = input.alphaSetFor(tool);
        if (set) out[tool] = set.alphas.map((a) => a.id);
      }
      return out;
    });
    const ids = [...new Set(Object.values(sets).flat())];
    t.ok(ids.length >= 4, `stencils on offer: ${ids.join(', ')}`);
    t.ok(ids.includes('clay01') && ids.includes('clay02') && !ids.includes('rake05'), 'the clay set is the two clay stencils');
    for (const id of ids) {
      const status = await page.evaluate(async (i) => {
        const a = await fetch(`/assets/alphas/${i}.png`);
        const b = await fetch(`/assets/alphas/thumbs/${i}.png`);
        return `${a.status}/${b.status}`;
      }, id);
      t.eq(status, '200/200', `${id}: image and thumbnail served`);
    }
    await page.waitForFunction(
      (want) => {
        const all = window.__sculpt.session.getPicking().constructor.ALPHAS;
        return want.every((i) => !!all[i]);
      },
      ids,
      { timeout: 30_000 },
    );
    const sizes = await page.evaluate((want) => {
      const all = window.__sculpt.session.getPicking().constructor.ALPHAS;
      return Object.fromEntries(want.map((i) => [i, `${all[i]._width}x${all[i]._height}`]));
    }, ids);
    t.ok(Object.values(sizes).every((s) => /^[1-9]\d+x[1-9]\d+$/.test(s)), `every stencil registered with a size: ${JSON.stringify(sizes)}`);
    t.ok(sizes.clay01 === '512x512' && sizes.clay02 === '512x512', 'the clay stencils are 512 px');
  },

  async wireframe(page, base, t) {
    await openSculpt(page, base);
    // The overlay draws the mesh's own edges: a closed quad mesh has two
    // edges per face, where its triangles would have three.
    const r = await page.evaluate(async () => {
      const { viewer, sync, session } = window.__sculpt;
      viewer.setWireframe(true);
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const g = sync.wireGeometry();
      const lines = [];
      viewer.scene.traverse((o) => {
        if (o.isLineSegments && o.name === 'sculpt-wire') lines.push(o);
      });
      return {
        faces: session.getMesh().getNbFaces(),
        edges: g.index.count / 2,
        shared: g.getAttribute('position') === sync.geometry.getAttribute('position'),
        drawn: lines.filter((l) => l.visible && l.geometry === g).length,
        triWire: viewer.isWireframe() && lines.length > 0,
      };
    });
    t.eq(r.edges, 2 * r.faces, `the sphere's ${r.faces} quads give two edges each`);
    t.ok(r.shared, 'the lines share the surface positions');
    t.eq(r.drawn, 1, 'one visible line object carries them');

    // A second object gets its own lines; a topology change (undoing the add
    // swaps the active mesh back) leaves the counts right; off hides them.
    const r2 = await page.evaluate(async () => {
      const { viewer, session } = window.__sculpt;
      session.addPrimitive('cube');
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const visible = [];
      viewer.scene.traverse((o) => {
        if (o.isLineSegments && o.name === 'sculpt-wire' && o.visible) visible.push(o.geometry.index.count / 2);
      });
      const cube = session.getMesh().getNbFaces();
      viewer.setWireframe(false);
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      let shown = 0;
      viewer.scene.traverse((o) => {
        if (o.isLineSegments && o.name === 'sculpt-wire' && o.visible) shown++;
      });
      return { visible: visible.sort((a, b) => a - b), cube, shown };
    });
    t.eq(r2.visible.length, 2, 'two objects, two line sets');
    t.ok(r2.visible.includes(2 * r2.cube), `the cube's ${r2.cube} quads give ${2 * r2.cube} edges`);
    t.eq(r2.shown, 0, 'off hides every line set');
  },

  async roundtrip(page, base, t) {
    await openSculpt(page, base);
    await page.evaluate(async () => {
      const s = window.__sculpt.session;
      s.addPrimitive('capsule');
      await s.addBaseMesh('eye-realistic');
    });
    const before = await names(page);
    const after = await page.evaluate(async () => {
      const bytes = await window.__sculpt.file.pack();
      await window.__sculpt.file.open(bytes);
      const s = window.__sculpt.session;
      return s.getMeshes().map((m) => s.getMeshName(m));
    });
    t.eq(after.join(','), before.join(','), 'scene file keeps the objects');
  },

  async armature(page, base, t) {
    await openArmature(page, base);
    const ok = await page.evaluate(() => !!window.__armature.armature && typeof window.__armature.reach === 'function');
    t.ok(ok, 'armature mode boots with its handle');

    // The four mannequins: fetched, read as rigged models, posable.
    const ids = ['mannequin-male-realistic', 'mannequin-female-realistic', 'mannequin-male-stylized', 'mannequin-female-stylized'];
    for (const id of ids) {
      const r = await page.evaluate(async (fid) => {
        const a = window.__armature;
        await a.figure(fid);
        const arm = a.armature;
        const geo = arm.mesh.geometry;
        const before = a.handlePosition('hand.L');
        a.reach('hand.L', before[0] + 15, before[1] + 25, before[2] + 15);
        const after = a.handlePosition('hand.L');
        const top = a.handlePosition('head');
        const sole = a.handlePosition('foot.R');
        return {
          id: arm.rig.id,
          bones: arm.rig.bones.length,
          chains: arm.rig.ik.length,
          verts: geo.getAttribute('position').count,
          skinned: !!geo.getAttribute('skinIndex'),
          height: top[1] - sole[1],
          moved: Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]),
          preset: a.state().preset,
          option: document.querySelector(`.panel--armature select option[value="${fid}"]`)?.textContent ?? '',
        };
      }, id);
      t.eq(r.id, id, `${id}: is the figure`);
      t.eq(r.bones, 19, `${id}: nineteen bones`);
      t.eq(r.chains, 5, `${id}: five reach chains`);
      t.ok(r.skinned && r.verts > 10000, `${id}: a skinned mesh of ${r.verts} vertices`);
      t.ok(r.height > 60 && r.height < 100, `${id}: head handle ${r.height.toFixed(1)} scene units above the foot`);
      t.ok(r.moved > 5, `${id}: the left hand reaches (${r.moved.toFixed(1)})`);
      t.eq(r.preset, id, `${id}: the state names it`);
      t.ok(/mannequin/i.test(r.option), `${id}: listed in the Figure select as "${r.option}"`);
    }

    // The autosave brings a mannequin back on reload, fetched again.
    await page.evaluate(() => window.__armature.save());
    await openArmature(page, base);
    t.eq(await page.evaluate(() => window.__armature.armature.rig.id), ids[3], 'the mannequin survives a reload');
    await page.evaluate(() => window.__armature.figure('placeholder-male'));
    t.eq(await page.evaluate(() => window.__armature.armature.rig.id), 'placeholder-male', 'and the blocks come back on request');
  },
};
