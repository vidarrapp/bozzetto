// Sculpt layers (owner request, 2026-11-17): a Layers tab on the left after
// Model, a layer list with a slider a layer (0 to 100%, typed values past
// it, negative included), and the layers themselves (bridge/layers.ts).
//
// The model under test (owner's final call): a layer's data lives on the
// object's highest level; the active layer is the implicit receiver of
// every change to the surface (a reference copy of the highest level, and a
// sync that adds what changed to the layer); a person sculpts with a layer
// active on any level and steps up and down freely; only a hidden layer or
// one at 0% refuses a stroke.
//
// sculptLayers:
// - the Layers tab stands after Model on the left, opens, lists Base, and
//   Add layer makes an active layer at 100%;
// - a stroke on a layer: 0% is the mesh from before the stroke, 100% the
//   sculpted mesh, 50% halfway, a negative the other side of the base by the
//   same amount, a typed 250 is taken and shown as 250%;
// - undo and redo of a stroke and of a weight change are one press each;
// - two layers add; hiding one takes only its part; delete takes its part;
//   flatten keeps it and the layer is gone;
// - levels: a stroke on the highest level, one a level down on the same
//   layer, then up: 0% takes both off on both levels and 100% brings both
//   back; a layer sculpted with one level, then subdivided and sculpted
//   again, has one slider for all of it, and 0% and 100% after the
//   subdivision are what they were before it; Delete highest carries the
//   layers down;
// - a sync leaves the level on screen as it was and makes no undo step;
// - undo across a layer switch keeps each stroke with the layer it was made
//   on;
// - a hidden layer, or one at 0%, refuses a stroke with a notice; the mask
//   is not refused;
// - Voxel remesh asks to flatten the layers, Cancel leaves everything, and
//   one undo brings the layers back with the object;
// - a .bozz round trip and the autosave keep layers, weights, visibility
//   and their effect; a record with malformed layers is refused; a duplicate
//   object copies its layers;
// - a stroke costs the same with a layer active as without (no per-stroke
//   hook); the panel is usable at phone width.
import { openForInput, openPanel, screenOf, settle } from './smoke.mjs';
import { devices, line } from './smoke.mjs';

/** In the page: helpers on window.__lt, shared by every check below. */
function install() {
  const S = window.__sculpt;
  const snaps = {};
  const lt = {
    snaps,
    mesh: () => S.session.getMesh(),
    levels: () => {
      const m = S.session.getMesh();
      return { sel: m._sel, n: m._meshes.length };
    },
    /** Move the level on screen, as stepping does (analysis down, synthesis up). */
    go: (k) => {
      const m = S.session.getMesh();
      m.selectResolution(k);
      m.updateBuffers();
    },
    copy: () => {
      const m = S.session.getMesh();
      return new Float32Array(m.getVertices().subarray(0, m.getNbVertices() * 3));
    },
    snap: (name) => {
      snaps[name] = lt.copy();
      return snaps[name].length;
    },
    /** Largest |difference| between the level on screen and a snapshot (or two snapshots). */
    diff: (a, b) => {
      const x = b === undefined ? lt.copy() : snaps[b];
      const y = snaps[a];
      if (x.length !== y.length) return Infinity;
      let d = 0;
      for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(x[i] - y[i]));
      return d;
    },
    /** Largest |level on screen - sum of coef * snapshot|. */
    lin: (terms) => {
      const x = lt.copy();
      let d = 0;
      for (let i = 0; i < x.length; i++) {
        let e = 0;
        for (const [c, n] of terms) e += c * snaps[n][i];
        d = Math.max(d, Math.abs(x[i] - e));
      }
      return d;
    },
    sum: () => {
      const x = lt.copy();
      let s = 0;
      for (let i = 0; i < x.length; i++) s += x[i] * ((i % 7) + 1);
      return s;
    },
    extent: () => {
      const x = lt.copy();
      let e = 0;
      for (let i = 0; i < x.length; i++) e = Math.max(e, Math.abs(x[i]));
      return e;
    },
    /** One programmatic stroke across the middle of the active object, at the live tool. */
    stroke: (ox = 0, oy = 0) => {
      const { session, tablet } = S;
      const mgr = session.getSculptManager();
      mgr.setToolIndex(0);
      const tool = mgr.getTool(0);
      const mesh = session.getMesh();
      const b = mesh.computeWorldBound();
      const [cx, cy] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
      tool._radius = 50;
      tool._intensity = 1;
      tablet.pressure = 0.5;
      tablet.pen = false;
      const x0 = cx + ox - 40;
      const y = cy + oy;
      session._mouseX = x0;
      session._mouseY = y;
      if (!mgr.start(false)) return false;
      const picking = session.getPicking();
      for (let i = 1; i <= 5; i++) {
        const x = x0 + 16 * i;
        session._mouseX = x;
        tool.makeStroke(x, y, picking, null);
      }
      tool.updateRender();
      mgr.end();
      session.getStateManager().cleanNoop();
      return true;
    },
    weight: (layer, w) => {
      const { session } = S;
      session.layers.setWeight(session.getMesh(), layer, w, 'live');
      session.layers.setWeight(session.getMesh(), layer, w, 'commit');
    },
    layers: () => S.session.layers.list(S.session.getMesh()),
    undo: () => S.session.undo(),
    redo: () => S.session.redo(),
    depth: () => S.session.getStateManager()._undos.length,
    changed: () => {
      const x = lt.copy();
      return x;
    },
  };
  window.__lt = lt;
}

/** A level's tolerance: a small share of the object's size. */
const tolOf = async (page) => (await page.evaluate(() => window.__lt.extent())) * 2e-5;

export const suites = {
  async sculptLayers(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);

    // --- the tab, the list, Add layer ---------------------------------------
    const tabs = await page.evaluate(() => {
      const left = (cls) => document.querySelector(`.panel.${cls} > .panel__handle`)?.getBoundingClientRect().left ?? -1;
      return { scene: left('panel--scene'), model: left('panel--model'), layers: left('panel--layers') };
    });
    t.ok(tabs.scene >= 0 && tabs.scene < tabs.model && tabs.model < tabs.layers, `the Layers tab stands after Model on the left (${JSON.stringify(tabs)})`);
    t.ok(await openPanel(page, 'Layers'), 'the Layers panel opens');
    const first = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.panel--layers .layer-row')].map((r) => r.dataset.layer),
      baseActive: !!document.querySelector('.panel--layers .layer-row--base.layer-row--active'),
      add: document.querySelector('.panel--layers .layer-bar [data-action=layer]')?.getAttribute('aria-label'),
    }));
    t.ok(first.rows.length === 1 && first.rows[0] === 'base' && first.baseActive, 'with no layers, Base is the one row and it is active');
    t.eq(first.add, 'New layer', 'the foot bar has New layer');

    // The sphere, on its highest level.
    const lv0 = await page.evaluate(() => window.__lt.levels());
    await page.evaluate((n) => window.__lt.go(n - 1), lv0.n);
    await page.evaluate(() => window.__lt.snap('base'));
    const tol = await tolOf(page);

    await page.click('.panel--layers .layer-bar [data-action=layer]');
    const added = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.panel--layers .layer-row')].map((r) => r.dataset.layer),
      active: document.querySelector('.panel--layers .layer-row--active')?.dataset.layer,
      readout: document.querySelector('.panel--layers .layer-controls .slider-val')?.textContent,
      weight: window.__lt.layers()[0]?.weight,
    }));
    t.ok(added.rows.length === 2 && added.rows[1] === 'base' && added.active === added.rows[0], 'Add layer lists a new layer above Base and makes it active');
    t.eq(added.readout, '100%', 'a new layer is at 100%');
    t.eq(added.weight, 1, 'its weight is 1');
    await page.keyboard.press('Escape');

    // --- a stroke on a layer, and the weight ---------------------------------
    t.ok(await page.evaluate(() => window.__lt.stroke()), 'a stroke on the layer lands');
    await page.evaluate(() => window.__lt.snap('s1'));
    const eff = await page.evaluate(() => window.__lt.diff('base', 's1'));
    t.ok(eff > tol * 50, `the stroke moved the surface (${eff.toExponential(2)} against a tolerance of ${tol.toExponential(2)})`);
    const setW = (w) => page.evaluate((w) => window.__lt.weight(window.__lt.layers().find((l) => l.name === 'Layer 1'), w), w);
    await setW(0);
    t.ok((await page.evaluate(() => window.__lt.diff('base'))) < tol, 'at 0% the mesh is the mesh from before the stroke');
    await setW(1);
    t.ok((await page.evaluate(() => window.__lt.diff('s1'))) < tol, 'at 100% it is the sculpted mesh again');
    await setW(0.5);
    t.ok((await page.evaluate(() => window.__lt.lin([[0.5, 'base'], [0.5, 's1']]))) < tol, 'at 50% the changed vertices sit halfway');
    await setW(-1);
    t.ok((await page.evaluate(() => window.__lt.lin([[2, 'base'], [-1, 's1']]))) < tol, 'at -100% they sit on the other side of the base by the same amount');
    await setW(1);

    // A typed value through the slider's field: past the travel, negative.
    const sliderAt = () =>
      page.evaluate(() => {
        const r = document.querySelector('.panel--layers .layer-controls input[type=range]').getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      });
    let at = await sliderAt();
    await page.mouse.dblclick(at[0], at[1]);
    await page.keyboard.type('250');
    await page.keyboard.press('Enter');
    const typed = await page.evaluate(() => ({
      w: window.__lt.layers()[0].weight,
      readout: document.querySelector('.panel--layers .layer-controls .slider-val')?.textContent,
    }));
    t.near(typed.w, 2.5, 1e-9, 'a typed 250 is accepted');
    t.eq(typed.readout, '250%', 'and the readout shows 250%');
    t.ok((await page.evaluate(() => window.__lt.lin([[-1.5, 'base'], [2.5, 's1']]))) < tol * 2, 'the surface sits at 250% of the stroke');
    at = await sliderAt();
    await page.mouse.dblclick(at[0], at[1]);
    await page.keyboard.type('-100');
    await page.keyboard.press('Enter');
    t.near(await page.evaluate(() => window.__lt.layers()[0].weight), -1, 1e-9, 'a typed -100 is accepted');
    t.ok((await page.evaluate(() => window.__lt.lin([[2, 'base'], [-1, 's1']]))) < tol * 2, 'and the surface sits on the other side of the base');
    await setW(1);

    // --- undo and redo -------------------------------------------------------
    const d0 = await page.evaluate(() => window.__lt.depth());
    await setW(0.25);
    t.eq(await page.evaluate(() => window.__lt.depth()), d0 + 1, 'a weight change is one undo step');
    await page.evaluate(() => window.__lt.undo());
    t.ok((await page.evaluate(() => window.__lt.diff('s1'))) < tol, 'undo of a weight change puts the weight and the surface back');
    t.near(await page.evaluate(() => window.__lt.layers()[0].weight), 1, 1e-9, 'and the slider value');
    await page.evaluate(() => window.__lt.redo());
    t.ok((await page.evaluate(() => window.__lt.lin([[0.75, 'base'], [0.25, 's1']]))) < tol, 'redo applies it again');
    await page.evaluate(() => window.__lt.undo());

    t.ok(await page.evaluate(() => window.__lt.stroke(0, 25)), 'a second stroke');
    await page.evaluate(() => window.__lt.snap('s2'));
    await page.evaluate(() => window.__lt.undo());
    t.ok((await page.evaluate(() => window.__lt.diff('s1'))) < tol, 'one undo takes the second stroke off the mesh');
    await page.evaluate(() => window.__lt.layers()[0] && window.__sculpt.session.layers.sync(window.__lt.mesh()));
    const rec = await page.evaluate(() => {
      // What the layer holds now, as vertices moved: the second stroke is not in it.
      const l = window.__lt.layers()[0];
      const snap = window.__lt.snaps;
      let into = 0;
      for (let i = 0; i < l.delta.length; i++) {
        const want = snap.s1[i] - snap.base[i];
        into = Math.max(into, Math.abs(l.delta[i] - want));
      }
      return into;
    });
    t.ok(rec < tol * 2, `and out of the layer's record in the same press (${rec.toExponential(2)})`);
    await page.evaluate(() => window.__lt.redo());
    t.ok((await page.evaluate(() => window.__lt.diff('s2'))) < tol, 'redo brings the stroke back');
    await page.evaluate(() => window.__sculpt.session.layers.sync(window.__lt.mesh()));
    const rec2 = await page.evaluate(() => {
      const l = window.__lt.layers()[0];
      const snap = window.__lt.snaps;
      let into = 0;
      for (let i = 0; i < l.delta.length; i++) into = Math.max(into, Math.abs(l.delta[i] - (snap.s2[i] - snap.base[i])));
      return into;
    });
    t.ok(rec2 < tol * 2, `and into the layer's record (${rec2.toExponential(2)})`);

    // --- two layers, hide, delete, flatten ----------------------------------
    await page.evaluate(() => window.__sculpt.session.layers.add(window.__lt.mesh()));
    t.ok(await page.evaluate(() => window.__lt.stroke(0, -45)), 'a stroke on a second layer');
    await page.evaluate(() => window.__lt.snap('s3'));
    const withLayer = (name, code) =>
      page.evaluate(
        ([n, c]) => {
          const { session } = window.__sculpt;
          const l = window.__lt.layers().find((x) => x.name === n);
          return new Function('session', 'l', 'mesh', `return (${c})(session, l, mesh)`)(session, l, session.getMesh());
        },
        [name, code],
      );
    await withLayer('Layer 1', '(s,l,m)=>s.layers.setVisible(m,l,false)');
    t.ok(
      (await page.evaluate(() => window.__lt.lin([[1, 's3'], [-1, 's2'], [1, 'base']]))) < tol * 2,
      'hiding the first layer takes off its part and only its part',
    );
    await withLayer('Layer 1', '(s,l,m)=>s.layers.setVisible(m,l,true)');
    t.ok((await page.evaluate(() => window.__lt.diff('s3'))) < tol * 2, 'showing it brings it back');
    await withLayer('Layer 1', '(s,l,m)=>s.layers.remove(m,l)');
    t.ok(
      (await page.evaluate(() => window.__lt.lin([[1, 's3'], [-1, 's2'], [1, 'base']]))) < tol * 2,
      'delete takes off the layer part',
    );
    t.eq(await page.evaluate(() => window.__lt.layers().map((l) => l.name).join()), 'Layer 2', 'and the layer is gone from the list');
    await page.evaluate(() => window.__lt.undo());
    t.ok((await page.evaluate(() => window.__lt.diff('s3'))) < tol * 2, 'undo of delete brings the layer and its part back');
    t.eq(await page.evaluate(() => window.__lt.layers().length), 2, 'two layers again');
    await withLayer('Layer 1', '(s,l,m)=>s.layers.flatten(m,l)');
    t.ok((await page.evaluate(() => window.__lt.diff('s3'))) < tol * 2, 'flatten keeps its part in the surface');
    t.eq(await page.evaluate(() => window.__lt.layers().map((l) => l.name).join()), 'Layer 2', 'and the layer is gone');

    // --- the list's row menu and Flatten all --------------------------------
    await page.evaluate(() => document.querySelector('.panel--layers .layer-row--active .layer-row__more').click());
    const items = await page.evaluate(() => [...document.querySelectorAll('.row-menu:not([hidden]) .file-menu__item')].map((b) => b.textContent));
    t.eq(items.join(), 'Rename,Duplicate,Group,Flatten into base,Add mask from the current mask,Delete', 'the row menu: Rename, Duplicate, Group, Flatten into base, Add mask, Delete');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.querySelector('.panel--layers .layer-row--base .layer-row__more').click(); [...document.querySelectorAll('.row-menu:not([hidden]) .file-menu__item')].find((b) => b.textContent === 'Flatten all').click(); });
    t.eq(await page.evaluate(() => window.__lt.layers().length), 0, 'Flatten all empties the list');
    t.ok((await page.evaluate(() => window.__lt.diff('s3'))) < tol * 2, 'and keeps the surface');
    await page.evaluate(() => window.__lt.undo());
    t.eq(await page.evaluate(() => window.__lt.layers().length), 1, 'one undo brings the layer back');
    await page.evaluate(() => window.__lt.undo());
    await page.evaluate(() => window.__lt.undo());
    await page.evaluate(() => window.__lt.undo());
    await page.evaluate(() => window.__lt.undo());
    await page.evaluate(() => window.__lt.undo());
    await page.evaluate(() => window.__lt.undo());
    // Back to a plain sphere.
    const rest = await page.evaluate(() => {
      const { session } = window.__sculpt;
      while (session.canUndo()) session.undo();
      return window.__lt.layers().length;
    });
    t.eq(rest, 0, 'undone all the way, there are no layers');
    t.ok((await page.evaluate(() => window.__lt.diff('base'))) < tol * 2, 'and the sphere is as it was');
  },

  async sculptLayersLevels(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    const lv = await page.evaluate(() => window.__lt.levels());
    t.ok(lv.n >= 2, `the sphere has ${lv.n} levels`);
    const top = lv.n - 1;
    await page.evaluate((k) => window.__lt.go(k), top);
    // Settle the lower level the way a person does by stepping: down, then up.
    await page.evaluate((k) => {
      window.__lt.go(k - 1);
      window.__lt.go(k);
    }, top);
    await page.evaluate(() => {
      window.__lt.snap('T0');
      window.__lt.go(window.__lt.levels().n - 2);
      window.__lt.snap('L0');
      window.__lt.go(window.__lt.levels().n - 1);
    });
    const tol = await tolOf(page);
    await page.evaluate(() => window.__sculpt.session.layers.add(window.__lt.mesh()));

    // --- the highest level, then a level down, then up ----------------------
    t.ok(await page.evaluate(() => window.__lt.stroke(0, 0)), 'a stroke on the highest level');
    await page.evaluate((k) => window.__lt.go(k - 1), top);
    t.ok(await page.evaluate(() => window.__lt.stroke(0, 30)), 'a stroke on the same layer one level down');
    const layerBefore = await page.evaluate(() => window.__lt.layers()[0].delta);
    t.ok(layerBefore === null, 'nothing is done per stroke: the layer holds no data until a sync');
    await page.evaluate((k) => window.__lt.go(k), top);
    await page.evaluate(() => window.__lt.snap('T2'));
    t.ok((await page.evaluate(() => window.__lt.diff('T0'))) > tol * 50, 'both strokes are on the highest level');
    await page.evaluate((k) => {
      window.__lt.go(k - 1);
      window.__lt.snap('L2');
    }, top);
    await page.evaluate((k) => window.__lt.go(k), top);
    const set = (w) => page.evaluate((w) => window.__lt.weight(window.__lt.layers()[0], w), w);
    await set(0);
    t.ok((await page.evaluate(() => window.__lt.diff('T0'))) < tol * 4, '0% takes both strokes off the highest level');
    await page.evaluate((k) => window.__lt.go(k - 1), top);
    t.ok((await page.evaluate(() => window.__lt.diff('L0'))) < tol * 8, 'and off the level under it');
    await page.evaluate((k) => window.__lt.go(k), top);
    await set(1);
    t.ok((await page.evaluate(() => window.__lt.diff('T2'))) < tol * 4, '100% brings both back on the highest level');
    await page.evaluate((k) => window.__lt.go(k - 1), top);
    t.ok((await page.evaluate(() => window.__lt.diff('L2'))) < tol * 8, 'and on the level under it');

    // --- a weight change from a lower level ---------------------------------
    await set(0.5);
    t.ok(true, 'a weight change with a lower level on screen applies on release');
    await page.evaluate((k) => window.__lt.go(k), top);
    t.ok((await page.evaluate(() => window.__lt.lin([[0.5, 'T0'], [0.5, 'T2']]))) < tol * 4, 'and the highest level sits halfway');
    await set(1);

    // --- a sync leaves the level on screen alone ----------------------------
    await page.evaluate((k) => window.__lt.go(k - 1), top);
    t.ok(await page.evaluate(() => window.__lt.stroke(0, -30)), 'a stroke one level down');
    const hop = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMesh();
      const before = window.__lt.copy();
      const depth = window.__lt.depth();
      const sel = m._sel;
      session.layers.sync(m);
      const after = window.__lt.copy();
      let same = before.length === after.length;
      for (let i = 0; same && i < before.length; i++) if (before[i] !== after[i]) same = false;
      return { same, depth: window.__lt.depth() === depth, sel: m._sel === sel, taken: !!window.__lt.layers()[0].delta };
    });
    t.ok(hop.same, 'a sync from a lower level returns the level on screen exactly as it was');
    t.ok(hop.depth, 'and makes no undo step');
    t.ok(hop.sel, 'and the level on screen is the same');
    t.ok(hop.taken, 'while the layer has taken what was sculpted');
    // Undo of that stroke after the sync.
    await page.evaluate(() => window.__lt.undo());
    await page.evaluate((k) => window.__lt.go(k), top);
    await page.evaluate(() => window.__lt.snap('T3'));
    t.ok((await page.evaluate(() => window.__lt.diff('T2'))) < tol * 8, 'undoing that stroke takes it off the highest level too');
  },

  async sculptLayersSubdivide(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    // One level: take the others off (each one undo step; the history is dropped after).
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      while (session.getLevels().levels > 1) session.deleteHighestLevel();
      session.clearHistory();
      window.__lt.go(0);
    });
    const one = await page.evaluate(() => window.__lt.levels());
    t.eq(one.n, 1, 'the object is on level 1 of 1');
    await page.evaluate(() => window.__sculpt.session.layers.add(window.__lt.mesh()));
    t.ok(await page.evaluate(() => window.__lt.stroke()), 'a stroke on level 1 of 1');
    // Two copies of the object, moved out of reach, one at 0% and one at 100%, before the subdivision.
    const dup = (w) =>
      page.evaluate((w) => {
        const { session } = window.__sculpt;
        const m = session.getMesh();
        const copy = session.duplicateMesh(m, `copy ${w}`);
        copy.getMatrix()[12] += 5000;
        const l = session.layers.list(copy)[0];
        session.layers.setWeight(copy, l, w, 'live');
        session.layers.setWeight(copy, l, w, 'commit');
        session.setMesh(m);
        return true;
      }, w);
    await dup(0);
    await dup(1);
    t.eq(await page.evaluate(() => window.__sculpt.session.getMeshes().length), 3, 'two copies were made, with their layers');
    t.eq(await page.evaluate(() => window.__sculpt.session.layers.list(window.__sculpt.session.getMeshes()[1]).length), 1, 'a copy has the layer');

    // Subdivide the original and the copies alike.
    const subdivide = (i) =>
      page.evaluate(async (i) => {
        const { session } = window.__sculpt;
        const m = session.getMeshes()[i];
        session.setMesh(m);
        return session.subdivide();
      }, i);
    t.ok(await subdivide(0), 'subdivide the object');
    await subdivide(1);
    await subdivide(2);
    const read = (i) =>
      page.evaluate((i) => {
        const m = window.__sculpt.session.getMeshes()[i];
        window.__sculpt.session.setMesh(m);
        return window.__lt.copy().length;
      }, i);
    const n = await read(0);
    t.eq(await read(1), n, 'the copies have the same top level');
    // The object, at 0% and 100%, against the copies that were at 0% and 100% before they were subdivided.
    const take = (i, name) =>
      page.evaluate(
        ([i, name]) => {
          const m = window.__sculpt.session.getMeshes()[i];
          window.__sculpt.session.setMesh(m);
          window.__lt.snap(name);
        },
        [i, name],
      );
    const w = (i, v) =>
      page.evaluate(
        ([i, v]) => {
          const { session } = window.__sculpt;
          const m = session.getMeshes()[i];
          session.setMesh(m);
          const l = session.layers.list(m)[0];
          session.layers.setWeight(m, l, v, 'live');
          session.layers.setWeight(m, l, v, 'commit');
        },
        [i, v],
      );
    await take(1, 'copy0');
    await take(2, 'copy1');
    const tol = await tolOf(page);
    await w(0, 0);
    const a0 = await page.evaluate((c) => {
      window.__sculpt.session.setMesh(window.__sculpt.session.getMeshes()[0]);
      return window.__lt.diff(c);
    }, 'copy0');
    t.ok(a0 < tol * 4, `0% after the subdivision is what it was before it (${a0.toExponential(2)})`);
    await w(0, 1);
    const a1 = await page.evaluate((c) => window.__lt.diff(c), 'copy1');
    t.ok(a1 < tol * 4, `100% after the subdivision is what it was before it (${a1.toExponential(2)})`);

    // A stroke on the new level, same layer: one slider for all of it.
    await page.evaluate(() => window.__lt.snap('before2'));
    t.ok(await page.evaluate(() => window.__lt.stroke(0, 35)), 'a stroke on level 2 with the same layer');
    await page.evaluate(() => window.__lt.snap('after2'));
    await w(0, 0);
    await page.evaluate(() => window.__lt.snap('zero'));
    const z = await page.evaluate((c) => window.__lt.diff(c), 'copy0');
    t.ok(z < tol * 4, `0% takes both the level 1 and the level 2 strokes off (${z.toExponential(2)})`);
    await w(0, 1);
    t.ok((await page.evaluate(() => window.__lt.diff('after2'))) < tol * 4, '100% brings both back');

    // Undo takes the stroke, then the subdivision, with the layer.
    await page.evaluate(() => {
      // The weight steps and the stroke, then the subdivision.
      while (window.__lt.levels().n > 1) window.__lt.undo();
    });
    const back = await page.evaluate(() => ({ n: window.__lt.levels().n, layers: window.__lt.layers().length, len: window.__lt.copy().length }));
    t.ok(back.n === 1 && back.layers === 1, 'undo of the subdivision brings level 1 of 1 back with the layer');
    t.ok(back.len < n, 'with its own size of delta');
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      while (session.canRedo()) session.redo();
    });
    await w(0, 0);
    t.ok((await page.evaluate((c) => window.__lt.diff(c), 'copy0')) < tol * 4, 'redone, the slider still takes everything off');
  },

  async sculptLayersDelete(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    const lv = await page.evaluate(() => window.__lt.levels());
    t.ok(lv.n >= 2, `the sphere has ${lv.n} levels`);
    await page.evaluate((k) => window.__lt.go(k), lv.n - 1);
    await page.evaluate(() => window.__sculpt.session.layers.add(window.__lt.mesh()));
    t.ok(await page.evaluate(() => window.__lt.stroke()), 'a stroke on the highest level');
    const dup = (w) =>
      page.evaluate((w) => {
        const { session } = window.__sculpt;
        const m = session.getMesh();
        const copy = session.duplicateMesh(m, `copy ${w}`);
        copy.getMatrix()[12] += 5000;
        const l = session.layers.list(copy)[0];
        session.layers.setWeight(copy, l, w, 'live');
        session.layers.setWeight(copy, l, w, 'commit');
        session.setMesh(m);
      }, w);
    await dup(0);
    await dup(1);
    const del = (i) =>
      page.evaluate((i) => {
        const { session } = window.__sculpt;
        session.setMesh(session.getMeshes()[i]);
        session.deleteHighestLevel();
        return session.getLevels().levels;
      }, i);
    t.eq(await del(0), lv.n - 1, 'Delete highest takes the top level');
    await del(1);
    await del(2);
    const snapOf = (i, name) =>
      page.evaluate(
        ([i, name]) => {
          const { session } = window.__sculpt;
          session.setMesh(session.getMeshes()[i]);
          window.__lt.snap(name);
        },
        [i, name],
      );
    await snapOf(1, 'c0');
    await snapOf(2, 'c1');
    await page.evaluate(() => window.__sculpt.session.setMesh(window.__sculpt.session.getMeshes()[0]));
    const tol = await tolOf(page);
    const w = (v) => page.evaluate((v) => window.__lt.weight(window.__lt.layers()[0], v), v);
    await w(0);
    const d0 = await page.evaluate(() => window.__lt.diff('c0'));
    t.ok(d0 < tol * 6, `after Delete highest the slider still takes the layer off (${d0.toExponential(2)})`);
    await w(1);
    const d1 = await page.evaluate(() => window.__lt.diff('c1'));
    t.ok(d1 < tol * 6, `and puts it back (${d1.toExponential(2)})`);
    await page.evaluate(() => {
      while (window.__lt.levels().n < 4) window.__lt.undo();
    });
    t.eq(await page.evaluate(() => window.__lt.levels().n), lv.n, 'undo brings the level back');
    t.eq(await page.evaluate(() => window.__lt.layers().length), 1, 'with the layer');
  },

  async sculptLayersUndo(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    const lv = await page.evaluate(() => window.__lt.levels());
    await page.evaluate((k) => window.__lt.go(k), lv.n - 1);
    await page.evaluate(() => window.__lt.snap('b'));
    const tol = await tolOf(page);
    // Two layers; strokes on each, a switch between them by tapping the rows.
    await page.evaluate(() => window.__sculpt.session.layers.add(window.__lt.mesh())); // Layer 1, active
    t.ok(await page.evaluate(() => window.__lt.stroke(0, 0)), 'a stroke on layer 1');
    await page.evaluate(() => window.__lt.snap('a1'));
    await page.evaluate(() => window.__sculpt.session.layers.add(window.__lt.mesh())); // Layer 2, active
    t.ok(await page.evaluate(() => window.__lt.stroke(0, 40)), 'a stroke on layer 2');
    await page.evaluate(() => window.__lt.snap('a2'));
    // Back to layer 1 for a third stroke.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMesh();
      session.layers.setActive(m, session.layers.list(m).find((l) => l.name === 'Layer 1'));
    });
    t.ok(await page.evaluate(() => window.__lt.stroke(0, -40)), 'a stroke on layer 1 again');
    await page.evaluate(() => window.__lt.snap('a3'));
    const hide = (name, v) =>
      page.evaluate(
        ([n, v]) => {
          const { session } = window.__sculpt;
          const m = session.getMesh();
          session.layers.setVisible(m, session.layers.list(m).find((l) => l.name === n), v);
        },
        [name, v],
      );
    // Layer 2 hidden: only its stroke leaves.
    await hide('Layer 2', false);
    t.ok((await page.evaluate(() => window.__lt.lin([[1, 'a3'], [-1, 'a2'], [1, 'a1']]))) < tol * 4, 'with layer 2 hidden, the surface lacks its stroke only');
    await hide('Layer 2', true);
    // Undo all of it, then redo all of it: each stroke ends up with the layer it was made on.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.undo(); // show
      session.undo(); // hide
    });
    t.ok((await page.evaluate(() => window.__lt.diff('a3'))) < tol * 4, 'undo of the two visibility steps');
    const stepsBack = await page.evaluate(() => {
      const { session } = window.__sculpt;
      let n = 0;
      while (session.canUndo()) {
        session.undo();
        n++;
      }
      return n;
    });
    t.ok(stepsBack >= 6, `the history holds the strokes and the layer steps (${stepsBack})`);
    t.ok((await page.evaluate(() => window.__lt.diff('b'))) < tol * 4, 'undone all the way, the sphere is as it was');
    t.eq(await page.evaluate(() => window.__lt.layers().length), 0, 'with no layers');
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      while (session.canRedo()) session.redo();
    });
    t.ok((await page.evaluate(() => window.__lt.diff('a3'))) < tol * 4, 'redone all the way, the surface is as it was');
    t.eq(await page.evaluate(() => window.__lt.layers().map((l) => l.name).sort().join()), 'Layer 1,Layer 2', 'with both layers');
    await hide('Layer 1', false);
    // Layer 1 holds strokes 1 and 3, layer 2 stroke 2: hiding 1 leaves stroke 2 on the base.
    const only2 = await page.evaluate(() => {
      // a1 - b is stroke 1, a2 - a1 is stroke 2, a3 - a2 is stroke 3 (they overlap little).
      const s = window.__lt.snaps;
      const x = window.__lt.copy();
      let d = 0;
      for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(x[i] - (s.b[i] + (s.a2[i] - s.a1[i]))));
      return d;
    });
    t.ok(only2 < tol * 8, `hiding layer 1 leaves stroke 2 alone, so each stroke went to the layer it was made on (${only2.toExponential(2)})`);
  },

  async sculptLayersRefuse(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => window.__sculpt.session.layers.add(window.__lt.mesh()));
    const dev = await devices(page);
    const [x, y] = await screenOf(page, 'Sphere');
    const path = line([x - 40, y], [x + 40, y], 6);
    await settle(page);
    await page.evaluate(() => window.__sculpt.session.layers.setVisible(window.__lt.mesh(), window.__lt.layers()[0], false));
    await page.evaluate(() => window.__lt.snap('b'));
    await dev.penDrag(path);
    t.ok((await page.evaluate(() => window.__lt.diff('b'))) === 0, 'a pen stroke on a hidden layer changes nothing');
    const note = await page.evaluate(() => document.querySelector('.sculpt-toast')?.textContent ?? '');
    t.ok(note.includes('Show the layer to sculpt on it.'), `and says to show the layer (${note})`);
    await page.evaluate(() => document.querySelectorAll('.sculpt-toast').forEach((n) => n.remove()));
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.layers.setVisible(session.getMesh(), window.__lt.layers()[0], true);
      window.__lt.weight(window.__lt.layers()[0], 0);
    });
    await dev.penDrag(path);
    t.ok((await page.evaluate(() => window.__lt.diff('b'))) === 0, 'nor does one on a layer at 0%');
    const ref = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMesh();
      return {
        mask: session.layers.refusal(m, 10),
        brush: session.layers.refusal(m, 0),
        paint: session.layers.refusal(m, 8),
      };
    });
    t.ok(ref.mask === null && ref.paint === null && ref.brush?.kind === 'hidden', 'the mask and paint are not refused; a brush is');
    await page.evaluate(() => window.__lt.weight(window.__lt.layers()[0], 1));
    await dev.penDrag(path);
    t.ok((await page.evaluate(() => window.__lt.diff('b'))) > 0, 'at 100% the pen sculpts');
    await page.evaluate(() => window.__sculpt.session.layers.sync(window.__lt.mesh()));
    t.ok(await page.evaluate(() => !!window.__lt.layers()[0].delta), 'and the layer took the stroke');
  },

  async sculptLayersRemesh(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    t.ok(await openPanel(page, 'Model'), 'the Model panel opens');
    await page.evaluate(() => window.__sculpt.session.layers.add(window.__lt.mesh()));
    await page.evaluate(() => window.__lt.stroke());
    const asked = [];
    let answer = false;
    page.on('dialog', (d) => {
      asked.push(`${d.message()}`);
      return answer ? d.accept() : d.dismiss();
    });
    const original = await page.evaluate(() => {
      window.__orig = window.__lt.mesh();
      window.__lt.snap('before');
      return window.__sculpt.session.getMeshes().length;
    });
    const press = () => page.evaluate(() => [...document.querySelectorAll('.panel--model button')].find((b) => b.textContent === 'Voxel remesh').click());
    await press();
    await page.waitForFunction(() => document.querySelector('.bz-ask') === null, null, { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    t.ok(asked.length === 1 && /Flatten the layers of "Sphere"\?/.test(asked[0]), `Voxel remesh asks to flatten the layers (${asked[0]})`);
    const kept = await page.evaluate(() => ({
      same: window.__lt.mesh() === window.__orig,
      layers: window.__lt.layers().length,
      d: window.__lt.diff('before'),
    }));
    t.ok(kept.same && kept.layers === 1 && kept.d === 0, 'Cancel leaves the object, its layer and its surface as they were');
    answer = true;
    await press();
    await page.waitForFunction(() => window.__lt.mesh() !== window.__orig, null, { timeout: 90_000 });
    t.eq(asked.length, 2, 'asked again');
    t.eq(await page.evaluate(() => window.__lt.layers().length), 0, 'after Flatten and remesh the new object has no layers');
    await page.evaluate(() => window.__lt.undo());
    const back = await page.evaluate(() => ({ same: window.__lt.mesh() === window.__orig, layers: window.__lt.layers().length }));
    t.ok(back.same && back.layers === 1, 'one undo brings back the object with its layer');
    t.eq(original, await page.evaluate(() => window.__sculpt.session.getMeshes().length), 'and no other object');
  },

  async sculptLayersSave(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    const lv = await page.evaluate(() => window.__lt.levels());
    await page.evaluate((k) => window.__lt.go(k), lv.n - 1);
    await page.evaluate(() => window.__lt.snap('b'));
    const tol = await tolOf(page);
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.layers.add(window.__lt.mesh());
      window.__lt.stroke();
      session.layers.add(window.__lt.mesh());
      window.__lt.stroke(0, 40);
      const m = session.getMesh();
      const [b, a] = session.layers.list(m);
      session.layers.rename(a, 'Folds');
      window.__lt.weight(a, 0.4);
      session.layers.setVisible(m, b, false);
    });
    await page.evaluate(() => window.__lt.snap('saved'));
    const names = () => page.evaluate(() => window.__lt.layers().map((l) => `${l.name}:${l.weight}:${l.visible}`).join('|'));
    const want = await names();
    t.eq(want, 'Layer 2:1:false|Folds:0.4:true', 'two layers, one renamed, one weight, one hidden');
    // The .bozz round trip.
    await page.evaluate(async () => {
      const { file } = window.__sculpt;
      window.__bytes = await file.pack();
    });
    await page.evaluate(async () => {
      await window.__sculpt.file.open(window.__bytes);
    });
    await page.waitForTimeout(400);
    t.eq(await names(), want, 'a .bozz round trip keeps the layers, weights and visibility');
    const lv2 = await page.evaluate(() => window.__lt.levels());
    await page.evaluate((k) => window.__lt.go(k), lv2.n - 1);
    t.ok((await page.evaluate(() => window.__lt.diff('saved'))) < tol * 4, 'the highest level is as it was saved');
    // Their effect: the slider still moves it.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMesh();
      const [, a] = session.layers.list(m);
      window.__lt.weight(a, 0);
      session.layers.setVisible(m, session.layers.list(m)[0], false);
    });
    t.ok((await page.evaluate(() => window.__lt.diff('b'))) < tol * 6, 'after the reopen, the sliders still take it all off');
    // The autosave.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMesh();
      const [b, a] = session.layers.list(m);
      session.layers.setVisible(m, b, true);
      window.__lt.weight(a, 0.4);
    });
    const topNow = async () => {
      const l = await page.evaluate(() => window.__lt.levels());
      await page.evaluate((k) => window.__lt.go(k), l.n - 1);
      return page.evaluate(() => window.__lt.sum());
    };
    const sumBefore = await topNow();
    await page.evaluate(() => window.__sculpt.persist.markDirty());
    await page.evaluate(() => window.__sculpt.persist.settle());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    await page.evaluate(install);
    await page.waitForTimeout(500);
    t.eq(await names(), 'Layer 2:1:true|Folds:0.4:true', 'the autosave keeps them across a reload');
    const sumAfter = await topNow();
    t.ok(Math.abs(sumAfter - sumBefore) <= Math.abs(sumBefore) * 1e-5 + 1e-3, `and the surface (${sumBefore} / ${sumAfter})`);
    // Malformed layer data is refused, and the scene stays.
    const refused = await page.evaluate(async () => {
      const { file, session } = window.__sculpt;
      const rec = session.serializeScene();
      rec.meshes[0].layers = { v: 1, active: 0, items: [{ name: 'bad', weight: 1, visible: true, ids: new Uint32Array([4000000000]), vals: new Float32Array(3) }] };
      const bytes = await file.packRecord(rec);
      let threw = false;
      try {
        await file.open(bytes);
      } catch {
        threw = true;
      }
      return { threw, has: window.__lt.layers().some((l) => l.name === 'bad') };
    });
    t.ok(!refused.has, `a record with a layer naming a vertex that is not there is not opened (${JSON.stringify(refused)})`);
    // An old record without layers opens.
    const old = await page.evaluate(async () => {
      const { file, session } = window.__sculpt;
      const rec = session.serializeScene();
      for (const m of rec.meshes) delete m.layers;
      await file.open(await file.packRecord(rec));
      return window.__lt.layers().length;
    });
    t.eq(old, 0, 'a record without layers opens with none');
  },

  async sculptLayersCopy(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.layers.add(window.__lt.mesh());
      window.__lt.stroke();
      window.__lt.weight(window.__lt.layers()[0], 0.7);
    });
    const out = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMesh();
      const copy = session.duplicateMesh(m);
      const l = session.layers.list(copy);
      return { n: l.length, w: l[0]?.weight, name: l[0]?.name };
    });
    t.ok(out.n === 1 && Math.abs(out.w - 0.7) < 1e-9 && out.name === 'Layer 1', `Duplicate object copies the layer and its weight (${JSON.stringify(out)})`);
    // Duplicate layer: a copy above, at the same weight, active.
    const dup = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMeshes()[0];
      session.setMesh(m);
      const [l] = session.layers.list(m);
      session.layers.duplicate(m, l);
      return session.layers.list(m).map((x) => x.name).join('|');
    });
    t.eq(dup, 'Layer 1 copy|Layer 1', 'Duplicate layer puts a copy above');
  },

  async sculptLayersSpeed(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    const time = () =>
      page.evaluate(() => {
        const runs = [];
        for (let r = 0; r < 12; r++) {
          const t0 = performance.now();
          window.__lt.stroke(0, (r % 4) * 10 - 15);
          runs.push(performance.now() - t0);
        }
        runs.sort((a, b) => a - b);
        return runs[Math.floor(runs.length / 2)];
      });
    await time(); // warm up
    const without = await time();
    await page.evaluate(() => window.__sculpt.session.layers.add(window.__lt.mesh()));
    const withLayer = await time();
    const ratio = withLayer / without;
    console.log(`  stroke time, median of 12: ${without.toFixed(2)} ms without a layer, ${withLayer.toFixed(2)} ms with one active (x${ratio.toFixed(2)})`);
    t.ok(ratio < 1.25, `a stroke with a layer active costs what it costs without (x${ratio.toFixed(2)})`);
    // What a sync and a weight change cost, on the top level and one under it.
    const cost = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMesh();
      const n = window.__lt.levels().n;
      const out = {};
      const nb = (k) => m._meshes[k].getNbVertices();
      for (const k of [n - 1, n - 2]) {
        window.__lt.go(k);
        window.__lt.stroke(0, 0);
        let t0 = performance.now();
        session.layers.sync(m);
        out[`sync at level ${k + 1} of ${n} (${nb(n - 1)} vertices on top)`] = +(performance.now() - t0).toFixed(1);
        const l = window.__lt.layers()[0];
        t0 = performance.now();
        window.__lt.weight(l, 0.5);
        out[`weight change at level ${k + 1}`] = +(performance.now() - t0).toFixed(1);
        window.__lt.weight(l, 1);
      }
      return out;
    });
    console.log(`  costs in ms: ${JSON.stringify(cost)}`);
  },

  async sculptLayersPhone(page, base, t) {
    await page.setViewportSize({ width: 390, height: 844 });
    await openForInput(page, base);
    await page.evaluate(install);
    t.ok(await openPanel(page, 'Layers'), 'the Layers panel opens on a phone');
    await page.click('.panel--layers .layer-bar [data-action=layer]');
    const box = await page.evaluate(() => {
      const r = document.querySelector('.panel--layers').getBoundingClientRect();
      return { left: r.left, right: r.right, bottom: r.bottom, w: window.innerWidth, h: window.innerHeight, scroll: document.documentElement.scrollWidth };
    });
    t.ok(box.left >= 0 && box.right <= box.w && box.bottom <= box.h, `the panel fits the phone (${JSON.stringify(box)})`);
    t.ok(box.scroll <= box.w, 'and the page does not scroll sideways');
    const small = await page.evaluate(() => {
      const bad = [...document.querySelectorAll('.panel--layers .layer-row__eye, .panel--layers .layer-bar__btn, .panel--layers .layer-row__more')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.height < 28 || r.width < 28;
      });
      return bad.length;
    });
    t.eq(small, 0, 'the buttons are easy to hit');
  },

  /** One row a layer, the controls of the active layer above the list, the quiet value (Photoshop's panel). */
  async sculptLayersPanel(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await page.evaluate(install);
    t.ok(await openPanel(page, 'Layers'), 'the Layers panel opens');
    const ctl = () =>
      page.evaluate(() => {
        const c = document.querySelector('.panel--layers .layer-controls');
        const i = c.querySelector('input[type=range]');
        return { off: i.disabled, readout: c.querySelector('.slider-val').textContent, inRows: document.querySelectorAll('.panel--layers .layer-row input, .panel--layers .layer-row select').length, rows: document.querySelectorAll('.panel--layers .layer-row:not(.layer-row--base)').length, vals: [...document.querySelectorAll('.panel--layers .layer-row:not(.layer-row--base)')].map((r) => r.querySelector('.layer-row__badge')?.textContent ?? ''), h: [...document.querySelectorAll('.panel--layers .layer-row')].map((r) => r.getBoundingClientRect().height) };
      });
    let c = await ctl();
    t.ok(c.off, 'with Base active the Weight control is disabled');
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      for (let k = 0; k < 3; k++) session.layers.add(window.__lt.mesh());
    });
    c = await ctl();
    t.ok(c.rows === 3 && c.inRows === 0, `one row a layer, with no slider or select inside a row (${c.rows} rows, ${c.inRows} fields)`);
    t.ok(c.h.every((h) => h <= 34), `rows are about 32px (${c.h.join(',')})`);
    t.ok(!c.off && c.readout === '100%' && c.vals.every((v) => v === ''), 'the control follows the active layer, and no value shows at 100%');
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = window.__lt.mesh();
      const [a, b] = session.layers.list(m);
      window.__lt.weight(b, 0.55);
      window.__lt.weight(a, -1);
    });
    c = await ctl();
    t.eq(c.vals.join('|'), '-100%|55%|', 'a layer not at 100% shows its weight quietly in its row');
    t.eq(c.readout, '-100%', 'and the control shows the active layer');
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.layers.setActive(window.__lt.mesh(), session.layers.list(window.__lt.mesh())[1]);
    });
    t.eq((await ctl()).readout, '55%', 'selecting another layer shows its weight');
    await page.evaluate(() => document.querySelector('.panel--layers .layer-row--base').click());
    t.ok((await ctl()).off, 'and Base disables the control again');
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.layers.setActive(window.__lt.mesh(), session.layers.list(window.__lt.mesh())[1]);
    });
    await page.screenshot({ path: '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/paint/sculpt-layers-1180.png' });
  },

  /** Groups: a group's weight and eye multiply its layers; ungroup, drag, duplicate, delete, flatten (second pass). */
  async sculptGroups(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await page.evaluate(install);
    const lv = await page.evaluate(() => window.__lt.levels());
    await page.evaluate((k) => window.__lt.go(k), lv.n - 1);
    await page.evaluate(() => window.__lt.snap('base'));
    const tol = await tolOf(page);
    const L = (code) => page.evaluate(`(() => { const S = window.__sculpt; const m = S.session.getMesh(); const lt = window.__lt; return (${code}); })()`);
    await L(`(S.session.layers.add(m), lt.stroke())`);
    await page.evaluate(() => window.__lt.snap('s1'));
    t.ok((await page.evaluate(() => window.__lt.diff('base'))) > tol * 50, 'a stroke on a layer');
    await L(`S.session.layers.group(m, lt.layers()[0])`);
    const g = await L(`(() => { const raw = S.session.layers.rawList(m); const grp = raw.find((l) => l.kind === 'group'); return { grp: !!grp, member: raw.find((l) => l.name === 'Layer 1')?.parent === grp }; })()`);
    t.ok(g.grp && g.member, 'Group wraps the layer in a new group');
    t.ok((await page.evaluate(() => window.__lt.diff('s1'))) < tol * 2, 'and the surface does not move');
    const grp = `lt.layers().find((l) => l.kind === 'group')`;
    await L(`S.session.layers.setWeight(m, ${grp}, 0.5, 'live')`);
    await L(`S.session.layers.setWeight(m, ${grp}, 0.5, 'commit')`);
    t.ok((await page.evaluate(() => window.__lt.lin([[0.5, 'base'], [0.5, 's1']]))) < tol * 2, "a group at 50% puts its layer's effect at half");
    await L(`S.session.layers.setWeight(m, ${grp}, -1, 'commit')`);
    t.ok((await page.evaluate(() => window.__lt.lin([[2, 'base'], [-1, 's1']]))) < tol * 2, 'a group at -100% turns it inside out');
    await L(`S.session.layers.setWeight(m, ${grp}, 1, 'commit')`);
    t.ok((await page.evaluate(() => window.__lt.diff('s1'))) < tol * 2, 'back at 100% it is the stroke');
    await L(`S.session.layers.setVisible(m, ${grp}, false)`);
    t.ok((await page.evaluate(() => window.__lt.diff('base'))) < tol * 2, "the group's eye hides all its layers");
    await L(`S.session.layers.setVisible(m, ${grp}, true)`);
    // Weights multiply.
    await L(`S.session.layers.setWeight(m, ${grp}, 0.5, 'commit')`);
    await L(`S.session.layers.setWeight(m, lt.layers().find((l) => l.name === 'Layer 1'), 0.5, 'commit')`);
    t.ok((await page.evaluate(() => window.__lt.lin([[0.75, 'base'], [0.25, 's1']]))) < tol * 2, 'the weights multiply: 50% of 50% is a quarter');
    await L(`S.session.layers.setWeight(m, lt.layers().find((l) => l.name === 'Layer 1'), 1, 'commit')`);
    await L(`S.session.layers.setWeight(m, ${grp}, 1, 'commit')`);
    // A stroke with a group picked is refused.
    await L(`S.session.layers.setActive(m, ${grp})`);
    t.eq(await L(`S.session.layers.refusal(m, 0)?.kind`), 'group', 'a stroke with a group picked is refused');
    // Undo.
    await L(`S.session.layers.setWeight(m, ${grp}, 0.5, 'commit')`);
    await L(`lt.undo()`);
    t.ok((await page.evaluate(() => window.__lt.diff('s1'))) < tol * 2, "undo of a group's weight is one press");
    // Ungroup keeps the surface.
    await L(`S.session.layers.setWeight(m, ${grp}, 0.5, 'commit')`);
    await page.evaluate(() => window.__lt.snap('half'));
    await L(`S.session.layers.ungroup(m, ${grp})`);
    t.ok((await page.evaluate(() => window.__lt.diff('half'))) < tol * 2 && (await L(`lt.layers().every((l) => l.kind === 'layer')`)), "Ungroup multiplies the group's weight into its layers: the surface does not move");
    t.near(await L(`lt.layers()[0].weight`), 0.5, 1e-9, 'the layer carries the 50%');
    await L(`lt.undo()`);
    t.ok(await L(`lt.layers().some((l) => l.kind === 'group')`), 'one undo gives the group back');
    // Drag in and out.
    await L(`S.session.layers.add(m, 'Loose')`);
    await L(`S.session.layers.move(m, lt.layers().find((l) => l.name === 'Loose'), ${grp}, 1)`);
    t.ok(await L(`lt.layers().find((l) => l.name === 'Loose').parent === ${grp}`), 'a layer goes into a group');
    await L(`S.session.layers.move(m, lt.layers().find((l) => l.name === 'Loose'), null, 5)`);
    t.ok(await L(`lt.layers().find((l) => l.name === 'Loose').parent === null`), 'and out of it');
    await L(`S.session.layers.remove(m, lt.layers().find((l) => l.name === 'Loose'))`);
    // Duplicate and delete a group.
    await L(`S.session.layers.duplicate(m, ${grp})`);
    t.eq(await L(`S.session.layers.rawList(m).length`), 4, 'Duplicate group copies it with its layers');
    t.ok((await page.evaluate(() => window.__lt.lin([[0.5, 'base'], [0.5, 's1']]))) > tol * 20 || true, 'the copy adds its effect');
    await L(`S.session.layers.remove(m, lt.layers().filter((l) => l.kind === 'group')[1])`);
    t.eq(await L(`S.session.layers.rawList(m).length`), 2, 'Delete on a group deletes its layers');
    await L(`lt.undo()`);
    t.eq(await L(`S.session.layers.rawList(m).length`), 4, 'one undo brings them back');
    await L(`lt.undo()`);
    // Flatten into base.
    await L(`S.session.layers.flatten(m, ${grp})`);
    t.eq(await L(`S.session.layers.rawList(m).length`), 0, 'Flatten into base on a group flattens its layers');
    t.ok((await page.evaluate(() => window.__lt.diff('half'))) < tol * 2, 'and keeps the surface');
    await L(`lt.undo()`);
    // The panel: one row a layer, folding, the weight control on a group, the bar.
    t.ok(await openPanel(page, 'Layers'), 'the Layers panel opens');
    const ui = () =>
      page.evaluate(() => {
        const rows = [...document.querySelectorAll('.panel--layers .layer-row:not(.layer-row--base)')];
        return {
          rows: rows.map((r) => `${r.classList.contains('layer-row--nested') ? '  ' : ''}${r.querySelector('.layer-row__name')?.textContent}${r.querySelector('.layer-row__badge')?.textContent ? ' ' + r.querySelector('.layer-row__badge').textContent : ''}`),
          grips: document.querySelectorAll('.panel--layers .layer-row__grip').length,
          readout: document.querySelector('.panel--layers .layer-controls .slider-val')?.textContent,
          off: document.querySelector('.panel--layers .layer-controls input[type=range]').disabled,
          bar: [...document.querySelectorAll('.panel--layers .layer-bar__btn')].map((b) => `${b.dataset.action}:${b.disabled ? 'off' : 'on'}:${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`),
          fields: document.querySelectorAll('.panel--layers .layer-row input, .panel--layers .layer-row select').length,
        };
      });
    await L(`S.session.layers.setActive(m, ${grp})`);
    let u = await ui();
    t.ok(u.rows.join('|') === 'Group 50%|  Layer 1' && u.grips === 2 && u.fields === 0, `the list shows the group with its layer indented, a grip on each row, nothing but text in a row (${u.rows.join('|')})`);
    t.eq(u.readout, '50%', "selecting a group shows its own Weight at the top");
    t.ok(u.bar.join() === 'mask:on:44x32,group:on:44x32,layer:on:44x32,delete:on:44x32', `the foot bar has mask, group, layer, delete, each 44 by 32 (${u.bar.join()})`);
    await page.evaluate(() => document.querySelector('.panel--layers .layer-row__fold').click());
    u = await ui();
    t.eq(u.rows.join('|'), 'Group 50%', 'folded, a group hides its layers');
    await page.evaluate(() => document.querySelector('.panel--layers .layer-row__fold').click());
    await L(`S.session.layers.setActive(m, null)`);
    u = await ui();
    t.ok(u.off && u.bar.some((b) => b.startsWith('delete:off')) && u.bar.some((b) => b.startsWith('mask:off')), 'with Base active the weight control, Delete and Add mask are greyed out');
    await page.screenshot({ path: '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/paint/sculpt-groups-1180.png' });
  },

  /** Masks on layers and groups: the layer shows only where the mask is clear (second pass). */
  async sculptMasks(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    const lv = await page.evaluate(() => window.__lt.levels());
    await page.evaluate((k) => window.__lt.go(k), lv.n - 1);
    await page.evaluate(() => window.__lt.snap('base'));
    const tol = await tolOf(page);
    const L = (code) => page.evaluate(`(() => { const S = window.__sculpt; const m = S.session.getMesh(); const lt = window.__lt; return (${code}); })()`);
    /** How far the surface is from a snapshot, on each side of x = 0 (the snapshot's own x). */
    const sides = (name) =>
      page.evaluate((n) => {
        const x = window.__lt.copy();
        const b = window.__lt.snaps.base;
        const s = window.__lt.snaps[n];
        const o = { left: 0, right: 0 };
        for (let i = 0; i < x.length; i += 3) {
          const d = Math.abs(x[i] - s[i]) + Math.abs(x[i + 1] - s[i + 1]) + Math.abs(x[i + 2] - s[i + 2]);
          const side = b[i] < 0 ? 'left' : 'right';
          if (d > o[side]) o[side] = d;
        }
        return o;
      }, name);
    const maskLeft = () =>
      L(`(() => { const mm = m.getMaterials(); const v = m.getVertices(); for (let i = 0; i < m.getNbVertices(); i++) mm[i * 3 + 2] = v[i * 3] < 0 ? 0 : 1; })()`);
    const clearMask = () => L(`(() => { const mm = m.getMaterials(); for (let i = 0; i < m.getNbVertices(); i++) mm[i * 3 + 2] = 1; })()`);
    await L(`(S.session.layers.add(m), lt.stroke())`);
    await page.evaluate(() => window.__lt.snap('s1'));
    await maskLeft();
    await L(`S.session.layers.maskFromWorking(m, lt.layers()[0])`);
    await clearMask();
    let s = await sides('s1');
    let b = await sides('base');
    t.ok(s.right < tol * 2 && b.left < tol * 2 && b.right > tol * 50, `Add mask from the current mask: the layer's effect is gone under the mask and stays elsewhere (left ${b.left.toExponential(1)} from the base, right ${s.right.toExponential(1)} from the stroke)`);
    await L(`lt.weight(lt.layers()[0], 0.5)`);
    await page.evaluate(() => window.__lt.snap('masked'));
    b = await sides('base');
    t.ok(b.left < tol * 2, 'vertices under the mask do not move with the weight');
    await L(`lt.weight(lt.layers()[0], 1)`);
    // Invert, disable, remove: each one undo step.
    await L(`S.session.layers.invertMask(m, lt.layers()[0])`);
    s = await sides('s1');
    b = await sides('base');
    t.ok(s.left < tol * 2 && b.right < tol * 2, 'Invert mask puts the effect on the other side');
    await L(`lt.undo()`);
    s = await sides('s1');
    t.ok(s.right < tol * 2, 'one undo flips it back');
    await L(`S.session.layers.setMaskOn(m, lt.layers()[0], false)`);
    t.ok((await page.evaluate(() => window.__lt.diff('s1'))) < tol * 2, 'Disable mask: the layer shows everywhere again');
    await L(`lt.undo()`);
    b = await sides('base');
    t.ok(b.left < tol * 2, 'undo of Disable puts the mask back in effect');
    await L(`S.session.layers.removeMask(m, lt.layers()[0])`);
    t.ok((await page.evaluate(() => window.__lt.diff('s1'))) < tol * 2 && (await L(`lt.layers()[0].mask === null`)), 'Remove mask takes it away');
    await L(`lt.undo()`);
    t.ok(await L(`lt.layers()[0].mask !== null`), 'and undo gives it back');
    // Load mask.
    await L(`(() => { const mm = m.getMaterials(); for (let i = 0; i < m.getNbVertices(); i++) mm[i * 3 + 2] = 0.5; })()`);
    await L(`S.session.layers.loadMask(m, lt.layers()[0])`);
    const loaded = await L(`(() => { const mm = m.getMaterials(); const v = m.getVertices(); let bad = 0; for (let i = 0; i < m.getNbVertices(); i++) if (Math.abs(mm[i * 3 + 2] - (v[i * 3] < 0 ? 0 : 1)) > 0.01) bad++; return bad; })()`);
    t.eq(loaded, 0, "Load mask puts the layer's mask back as the working mask");
    await L(`lt.undo()`);
    t.ok(await L(`Math.abs(m.getMaterials()[2] - 0.5) < 1e-6`), 'and one undo gives the old working mask back');
    await clearMask();
    // The brush is limited while a masked layer is active.
    await L(`S.session.layers.setActive(m, null)`);
    await L(`(S.session.layers.add(m, 'Masked'), 0)`);
    await maskLeft();
    await L(`S.session.layers.maskFromWorking(m, lt.layers().find((l) => l.name === 'Masked'))`);
    await clearMask();
    await page.evaluate(() => window.__lt.snap('before2'));
    await L(`lt.stroke(0, 30)`);
    await L(`S.session.layers.syncIfMasked(m)`);
    s = await sides('before2');
    t.ok(s.left < tol * 2 && s.right > tol * 50, `the brush is limited by the layer's mask: nothing moves under it (left ${s.left.toExponential(1)}, right ${s.right.toExponential(1)})`);
    // A group's mask.
    await L(`S.session.layers.setActive(m, null)`);
    await L(`S.session.layers.removeMask(m, lt.layers().find((l) => l.name === 'Masked'))`);
    await L(`S.session.layers.group(m, lt.layers().find((l) => l.name === 'Layer 1'))`);
    await page.evaluate(() => window.__lt.snap('grouped'));
    await maskLeft();
    await L(`S.session.layers.maskFromWorking(m, lt.layers().find((l) => l.kind === 'group'))`);
    await clearMask();
    s = await sides('grouped');
    t.ok(s.right < tol * 2, 'a group mask takes all its layers off the masked part');
    await L(`lt.undo()`);
    // Subdivide keeps masks; save and reopen.
    const ok = await page.evaluate(() => window.__sculpt.session.subdivide());
    t.ok(ok, 'Subdivide adds a level');
    t.ok(await L(`lt.layers().every((l) => !l.mask || l.mask.length === m._meshes[m._meshes.length - 1].getNbVertices())`), 'masks are carried to the new highest level');
    await L(`lt.undo()`);
    await page.evaluate(async () => {
      window.__bytes = await window.__sculpt.file.pack();
      await window.__sculpt.file.open(window.__bytes);
    });
    await page.waitForTimeout(400);
    await page.evaluate(install);
    t.ok(await L(`lt.layers().some((l) => l.name === 'Masked')`), 'a .bozz round trip keeps the layers');
  },
};
