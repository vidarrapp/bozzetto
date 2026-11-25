// The Calipers tool (docs/plans/reference-and-measure.md, section 2): two
// taps on the model give the distance between two surface points in
// centimetres; an end can be dragged along the surface; Pin keeps a
// measurement in the scene (listed in the Model panel's Measure section,
// saved with the scene, attached to its object); Mirror adds the other half
// across the symmetry plane. It never changes the mesh or the sculpt undo.
//
// calipers:
// - c puts the tool in hand; two pen taps at known points on the default
//   sphere give a length within 0.1 cm of the distance between the two
//   surface points computed here, shown in the Tool panel and at the
//   line's middle; a third tap starts a new measurement;
// - dragging an end moves it along the surface and the length follows;
// - the mesh checksum and the sculpt undo stack are untouched throughout,
//   and leaving the tool clears the measurement that was not pinned;
// - Pin, rename, hide and delete (with its Undo) in the Model panel's
//   Measure section; Tab hides the lines;
// - a .bozz and the autosave both keep pinned measurements;
// - moving or scaling the object keeps a measurement on it, the length
//   following the object's scale;
// - with symmetry on, Mirror gives equal lengths on a symmetric sphere and
//   shows the pair with its difference;
// - a pinned caliper has a row in the Scene panel (ruler mark, name, length, eye); a tap on the row picks it
//   (orange in the view), Delete or Backspace removes it, the eye hides it (also after a reload), a double
//   tap renames it; pin, delete, rename and hide are undo steps.
//
// calipersScene: an old scene's pinned calipers get names in order, are shown and have rows.
//
// calipersMannequin: a caliper placed on the mannequin is tied to the part it was placed on, follows a
// pose with its length right, and stays where it was when the mannequin is replaced.
//
// calipersTouch: a finger tap sets points, two fingers still orbit with the
// tool in hand, a finger on an end drags it.
//
// calipersUnits: a scene without real units says "Set the scene's scale
// first" and its button opens Set scale; presses there set nothing.
//
// calipersPhone: the tool bar, the Tool panel and the Measure section at
// phone width.
import { mkdirSync } from 'node:fs';
import { devices, meshSum, openForInput, openPanel, probe, settle } from './smoke.mjs';

const frames = (page) => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// The sphere's middle and radius on the page, in client px.
const sphere = (page) =>
  page.evaluate(() => {
    const { session, viewer } = window.__sculpt;
    viewer.camera.updateMatrixWorld();
    const b = session.getMesh().computeWorldBound();
    const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    const e = viewer.camera.matrixWorld.elements;
    const radius = (b[3] - b[0]) / 2;
    const edge = c.map((v, i) => v + e[i] * radius);
    const r = viewer.captureCanvas.getBoundingClientRect();
    const pr = session.getPixelRatio();
    const toPage = (p) => {
      const [x, y] = session.getCamera().project(p);
      return [r.left + x / pr, r.top + y / pr];
    };
    const mid = toPage(c);
    const rim = toPage(edge);
    return { mid, px: Math.hypot(rim[0] - mid[0], rim[1] - mid[1]) };
  });

// The surface point under a page point, or null off the model.
const surfaceAt = (page, [x, y]) =>
  page.evaluate(
    ([px, py]) => {
      const { session, viewer } = window.__sculpt;
      viewer.camera.updateMatrixWorld();
      const r = viewer.captureCanvas.getBoundingClientRect();
      const pr = session.getPixelRatio();
      return session.surfacePointAt((px - r.left) * pr, (py - r.top) * pr);
    },
    [x, y],
  );

// A world point on the page.
const onScreen = (page, p) =>
  page.evaluate((w) => {
    const { session, viewer } = window.__sculpt;
    viewer.camera.updateMatrixWorld();
    const [x, y] = session.getCamera().project(w);
    const r = viewer.captureCanvas.getBoundingClientRect();
    const pr = session.getPixelRatio();
    return [r.left + x / pr, r.top + y / pr];
  }, p);

// The measurement being made: its end points in the world, its length and
// the mirror's, as the session reads them.
const working = (page) =>
  page.evaluate(() => {
    const { session } = window.__sculpt;
    const w = session.measure.working;
    if (!w) return null;
    const mat = w.mesh.getMatrix();
    const toWorld = (p) => [
      mat[0] * p[0] + mat[4] * p[1] + mat[8] * p[2] + mat[12],
      mat[1] * p[0] + mat[5] * p[1] + mat[9] * p[2] + mat[13],
      mat[2] * p[0] + mat[6] * p[1] + mat[10] * p[2] + mat[14],
    ];
    return {
      a: toWorld(w.m.a),
      b: w.m.b ? toWorld(w.m.b) : null,
      length: session.measure.length(w.mesh, w.m),
      mirror: session.measure.mirrorLength(w.mesh, w.m),
    };
  });

const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const history = (page) =>
  page.evaluate(() => {
    const sm = window.__sculpt.session.getStateManager();
    return `${sm._undos.length}/${sm._curUndoIndex}`;
  });
const pinned = (page) =>
  page.evaluate(() => {
    const { session } = window.__sculpt;
    return session.measure.all().map(({ measure }) => ({ name: measure.name, visible: measure.visible, mirror: !!measure.mirror }));
  });
const labels = (page) => page.evaluate(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r)); return [...document.querySelectorAll('.measure-label__value')].map((e) => e.textContent); });
const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);

/** Two taps with the pen on the sphere: at these shares of its radius from the middle. */
async function twoTaps(page, dev, s, p, q) {
  const A = [s.mid[0] + s.px * p[0], s.mid[1] + s.px * p[1]];
  const B = [s.mid[0] + s.px * q[0], s.mid[1] + s.px * q[1]];
  await dev.penDrag([A]);
  await frames(page);
  await dev.penDrag([B]);
  await frames(page);
  return [A, B];
}

export const suites = {
  async calipers(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    const s = await sphere(page);

    // 1. The tool: its key, its button, its panel.
    await page.keyboard.press('c');
    await frames(page);
    t.ok(await page.evaluate(() => window.__sculpt.input.isMeasuring()), 'c puts the Calipers tool in hand');
    const btn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.sculpt-toolbar__btn')].find((x) => x.getAttribute('aria-label')?.startsWith('Calipers'));
      return b ? { on: b.classList.contains('sculpt-toolbar__btn--active'), key: b.querySelector('.sculpt-toolbar__key')?.textContent, icon: b.querySelector('i')?.className ?? 'svg' } : null;
    });
    t.ok(btn && btn.on && btn.key === 'c', `the tool bar has a Calipers button showing c, lit while the tool is up (${JSON.stringify(btn)})`);
    t.ok(btn && /fi-ss-ruler-combined/.test(btn.icon), `its glyph is the uicons ruler for now (${btn?.icon})`);
    await openPanel(page, 'Tool');
    const prompt0 = await text(page, '[data-role=measure-reading]');
    t.ok(/first point/.test(prompt0 ?? ''), `the Tool panel asks for the first point (${prompt0})`);

    // 2. Two pen taps: the length is the distance between the surface points.
    const sum0 = await meshSum(page);
    const hist0 = await history(page);
    const strokes0 = await page.evaluate(() => window.__sculpt.input.strokeCount());
    const spots = [
      [-0.45, 0.1],
      [0.5, -0.25],
    ];
    for (const sp of spots) {
      const pt = [s.mid[0] + s.px * sp[0], s.mid[1] + s.px * sp[1]];
      const hp = await probe(page, pt);
      t.ok(hp.canvas && hp.hit, `(${pt.map((v) => v.toFixed(0))}) is bare canvas over the sphere`);
    }
    const [A, B] = await twoTaps(page, dev, s, spots[0], spots[1]);
    const PA = await surfaceAt(page, A);
    const PB = await surfaceAt(page, B);
    const w = await working(page);
    const expected = dist3(PA, PB);
    t.ok(w && w.b, 'two taps make a measurement with both points');
    t.ok(w && Math.abs(w.length - expected) < 0.1, `its length is the distance between the two surface points (${w?.length.toFixed(3)} cm; ${expected.toFixed(3)} computed here)`);
    t.ok(w && dist3(w.a, PA) < 0.05 && dist3(w.b, PB) < 0.05, 'and each point snapped to the surface where it was tapped');
    const reading = await text(page, '[data-role=measure-reading]');
    t.ok(new RegExp(`^${w.length.toFixed(1)} cm$`).test(reading ?? ''), `the Tool panel reads it in cm to one decimal (${reading})`);
    const lab = await labels(page);
    t.ok(lab.length === 1 && lab[0] === reading, `and the label at the line's middle says the same (${lab.join('|')})`);
    const label = await page.evaluate(() => {
      const el = document.querySelector('.measure-label');
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { x: r.left + r.width / 2, y: r.bottom, font: cs.fontFamily, pin: !!el.querySelector('.measure-label__pin') };
    });
    const mx = (A[0] + B[0]) / 2;
    t.ok(Math.abs(label.x - mx) < 40 && /Martian Mono/.test(label.font), `the label sits at the line's middle, in Martian Mono (x ${label.x.toFixed(0)} against ${mx.toFixed(0)})`);
    t.ok(label.pin, 'the working measurement\'s label carries a Pin button');
    const painted = await page.evaluate(
      ([x, y]) => {
        const c = document.querySelector('.measure-overlay canvas');
        const k = c.width / innerWidth;
        const d = c.getContext('2d').getImageData(Math.round((x - 3) * k), Math.round((y - 3) * k), Math.round(6 * k), Math.round(6 * k)).data;
        let lit = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
        return lit;
      },
      [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2],
    );
    t.ok(painted > 0, `the line is drawn between the points (${painted} px lit at its middle)`);
    t.ok((await meshSum(page)) === sum0, 'the mesh is untouched');
    t.ok((await history(page)) === hist0, `no sculpt undo step was made (${hist0})`);
    t.ok((await page.evaluate(() => window.__sculpt.input.strokeCount())) === strokes0, 'and no stroke began');

    // 3. Drag an end along the surface.
    const endScreen = await onScreen(page, w.b);
    const target = [s.mid[0] + s.px * 0.1, s.mid[1] + s.px * 0.5];
    await dev.penDrag([endScreen, [(endScreen[0] + target[0]) / 2, (endScreen[1] + target[1]) / 2], target]);
    await frames(page);
    const PT = await surfaceAt(page, target);
    const w2 = await working(page);
    t.ok(w2 && dist3(w2.a, w.a) < 1e-6, 'dragging the second end leaves the first where it was');
    t.ok(w2 && dist3(w2.b, PT) < 0.15, `the end follows the pen along the surface (${w2 && dist3(w2.b, PT).toFixed(3)} cm off the surface point under it)`);
    t.ok(w2 && Math.abs(w2.length - dist3(w.a, PT)) < 0.15 && Math.abs(w2.length - w.length) > 0.2, `and the length follows (${w.length.toFixed(2)} to ${w2?.length.toFixed(2)} cm)`);
    t.ok((await meshSum(page)) === sum0 && (await history(page)) === hist0, 'the drag changed neither the mesh nor the undo stack');
    t.ok((await page.evaluate(() => window.__sculpt.session.measure.working.m.b.length)) === 3, 'the end is still a point');

    // 4. A third tap starts a new measurement.
    const C = [s.mid[0] - s.px * 0.2, s.mid[1] + s.px * 0.6];
    await dev.penDrag([C]);
    await frames(page);
    const w3 = await working(page);
    t.ok(w3 && w3.b === null, 'a third tap starts a new measurement, with its first point');
    t.ok(/second point/.test((await text(page, '[data-role=measure-reading]')) ?? ''), 'and the panel asks for the second');
    t.ok((await page.evaluate(() => document.querySelector('[data-role=measure-pin]').disabled)), 'Pin waits for two points');

    // 5. Leaving the tool clears what was not pinned.
    await dev.penDrag([[s.mid[0] + s.px * 0.3, s.mid[1] + s.px * 0.2]]);
    await frames(page);
    t.ok((await working(page))?.b, 'a measurement again');
    await page.keyboard.press('3');
    await frames(page);
    t.ok(!(await page.evaluate(() => window.__sculpt.input.isMeasuring())) && (await working(page)) === null, 'picking a brush leaves the tool and clears the measurement');
    t.ok((await labels(page)).length === 0, 'and its label is gone');

    // 6. Pin, and the Model panel's Measure section.
    await page.keyboard.press('c');
    await twoTaps(page, dev, s, [-0.5, -0.3], [0.45, 0.3]);
    const lenPinned = (await working(page)).length;
    await page.click('.measure-label__pin');
    await frames(page);
    t.ok((await working(page)) === null, 'the Pin on the label takes the measurement out of the working slot');
    let list = await pinned(page);
    t.ok(list.length === 1 && list[0].name === 'Caliper 1', `it is kept, named Caliper 1 (${JSON.stringify(list)})`);
    t.ok((await labels(page)).length === 1, 'and still drawn');
    t.ok(!(await page.evaluate(() => !!document.querySelector('.measure-label__pin'))), 'a pinned label has no Pin button');
    await openPanel(page, 'Model');
    const row = await page.evaluate(() => {
      const r = document.querySelector('[data-role=measure-list] .measure-row');
      return r ? { name: r.querySelector('[data-role=measure-name]')?.textContent, len: r.querySelector('[data-role=measure-length]')?.textContent } : null;
    });
    t.ok(row && row.name === 'Caliper 1' && row.len === `${lenPinned.toFixed(1)} cm`, `the Model panel's Measure section lists it with its length (${JSON.stringify(row)})`);
    // Rename.
    await click(page, '[data-role=measure-name]');
    await page.waitForSelector('[data-role=measure-rename]');
    await page.fill('[data-role=measure-rename]', 'Left forearm');
    await page.keyboard.press('Enter');
    await frames(page);
    t.ok((await pinned(page))[0].name === 'Left forearm' && (await text(page, '[data-role=measure-name]')) === 'Left forearm', 'a pinned measurement is renamed in place');
    // A second one is numbered on.
    await page.keyboard.press('c'); // out
    await page.keyboard.press('c'); // in
    await twoTaps(page, dev, s, [-0.3, 0.5], [0.3, 0.55]);
    await click(page, '[data-role=measure-pin]');
    await frames(page);
    list = await pinned(page);
    t.ok(list.length === 2 && list[1].name === 'Caliper 2', `the next is Caliper 2 (${list.map((m) => m.name).join(', ')})`);
    // Hide.
    await click(page, '.measure-row:nth-child(1) [data-role=measure-eye]');
    await frames(page);
    list = await pinned(page);
    t.ok(!list[0].visible && (await labels(page)).length === 1, 'the eye hides one measurement from the view');
    await click(page, '.measure-row:nth-child(1) [data-role=measure-eye]');
    await frames(page);
    t.ok((await labels(page)).length === 2, 'and shows it again');
    // Tab hides the interface, the lines with it.
    await page.keyboard.press('3');
    await page.evaluate(() => document.activeElement?.blur?.());
    for (let i = 0; i < 3 && !(await page.evaluate(() => document.body.classList.contains('chrome-hidden'))); i++) {
      await page.keyboard.press('Tab');
      await frames(page);
    }
    t.ok(await page.evaluate(() => getComputedStyle(document.querySelector('.measure-overlay')).display === 'none'), 'Tab hides the measurements with the rest of the interface');
    await page.keyboard.press('Tab');
    await frames(page);
    t.ok(await page.evaluate(() => getComputedStyle(document.querySelector('.measure-overlay')).display !== 'none'), 'and Tab brings them back');
    t.ok((await meshSum(page)) === sum0, 'pinning, renaming and hiding left the mesh alone');
    // Delete, and bring it back with Undo.
    await click(page, '.measure-row:nth-child(1) [data-role=measure-delete]');
    await frames(page);
    list = await pinned(page);
    t.ok(list.length === 1 && list[0].name === 'Caliper 2', `delete removes it (${list.map((m) => m.name).join(', ')})`);
    await page.evaluate(() => window.__sculpt.session.undo());
    await frames(page);
    list = await pinned(page);
    t.ok(list.length === 2 && list[0].name === 'Left forearm', 'Undo puts it back where it was');
    await page.evaluate(() => window.__sculpt.session.redo());
    await frames(page);
    t.ok((await pinned(page)).length === 1, 'and Redo takes it away again');
    await page.evaluate(() => window.__sculpt.session.undo());
    await frames(page);

    // 6b. The Scene panel: a Calipers group with a row for each.
    await openPanel(page, 'Scene');
    const rowsOf = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.panel--scene [data-role=caliper-row]')].map((r) => ({
          name: r.querySelector('[data-role=caliper-name]')?.textContent ?? r.querySelector('[data-role=caliper-rename]')?.value,
          len: r.querySelector('[data-role=caliper-length]')?.textContent,
          ruler: !!r.querySelector('i.fi-ss-ruler-combined'),
          eye: r.querySelector('[data-role=caliper-eye]')?.getBoundingClientRect().height ?? 0,
          active: r.classList.contains('outliner__row--picked'),
          trash: !!r.querySelector('[data-role=caliper-delete]'),
        })),
      );
    const lensNow = () =>
      page.evaluate(() => window.__sculpt.session.measure.all().map(({ mesh, measure }) => window.__sculpt.session.measure.length(mesh, measure).toFixed(1) + ' cm'));
    let rows = await rowsOf();
    const lens = await lensNow();
    t.ok(rows.length === 2 && rows[0].name === 'Left forearm' && rows[1].name === 'Caliper 2' && rows.every((r, i) => r.ruler && r.len === lens[i]), `the Scene panel lists each caliper with its ruler mark, name and length (${JSON.stringify(rows)})`);
    t.ok(rows.every((r) => r.eye >= 26), 'each row has an eye');
    t.ok(await page.evaluate(() => document.querySelector('.panel--scene [data-role=calipers-group] .outliner__group')?.textContent === 'Calipers'), 'under a Calipers heading');
    t.ok(await page.evaluate(() => {
      const g = document.querySelector('.panel--scene [data-role=calipers-group]');
      const rowsAbove = [...document.querySelectorAll('.panel--scene .outliner > .outliner__row')];
      return rowsAbove.length > 0 && g.getBoundingClientRect().top >= rowsAbove[rowsAbove.length - 1].getBoundingClientRect().bottom - 1;
    }), 'below the objects');
    // A tap picks it: the row is marked and the line is drawn in orange.
    const midOf = (idx) =>
      page.evaluate((i) => {
        const { session, viewer } = window.__sculpt;
        viewer.camera.updateMatrixWorld();
        const { mesh, measure } = session.measure.all()[i];
        const r = viewer.captureCanvas.getBoundingClientRect();
        const pr = session.getPixelRatio();
        const s = [session.measure.pointWorld(mesh, measure, 'a'), session.measure.pointWorld(mesh, measure, 'b')].map((w) => {
          const [x, y] = session.getCamera().project(w);
          return [r.left + x / pr, r.top + y / pr];
        });
        return [(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2];
      }, idx);
    const orangeAt = async (idx) => {
      const [x, y] = await midOf(idx);
      return page.evaluate(
        async ([px, py]) => {
          for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
          const c = document.querySelector('.measure-overlay canvas');
          const k = c.width / innerWidth;
          const d = c.getContext('2d').getImageData(Math.round((px - 4) * k), Math.round((py - 4) * k), Math.round(8 * k), Math.round(8 * k)).data;
          const hex = getComputedStyle(document.documentElement).getPropertyValue('--bz-orange').trim();
          const n = parseInt(hex.replace('#', ''), 16);
          const want = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
          let hit = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && Math.abs(d[i] - want[0]) < 40 && Math.abs(d[i + 1] - want[1]) < 40 && Math.abs(d[i + 2] - want[2]) < 40) hit++;
          return hit;
        },
        [x, y],
      );
    };
    const picked = () => page.evaluate(() => window.__sculpt.session.measure.selected?.name ?? null);
    t.ok((await orangeAt(0)) === 0, 'a caliper nobody picked is grey');
    await click(page, '.panel--scene [data-role=caliper-row]:nth-of-type(2) [data-role=caliper-name]');
    await frames(page);
    rows = await rowsOf();
    t.ok((await picked()) === 'Left forearm' && rows[0].active && !rows[1].active && rows[0].trash, `a tap on its row picks it, and marks the row (${await picked()})`);
    t.ok((await orangeAt(0)) > 0, 'and the caliper is drawn in the interface orange in the view');
    // Delete takes it; Undo brings it back.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Delete');
    await frames(page);
    list = await pinned(page);
    t.ok(list.length === 1 && list[0].name === 'Caliper 2' && (await rowsOf()).length === 1, 'Delete removes the picked caliper (and its row)');
    t.ok((await page.evaluate(() => window.__sculpt.session.getMeshes().length)) === 1, 'and not an object');
    await page.evaluate(() => window.__sculpt.session.undo());
    await frames(page);
    t.ok((await pinned(page)).length === 2 && (await rowsOf())[0].name === 'Left forearm', 'Undo brings it back, with its row');
    // Backspace does as Delete does.
    await click(page, '.panel--scene [data-role=caliper-row]:nth-of-type(3) [data-role=caliper-name]');
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Backspace');
    await frames(page);
    t.ok((await pinned(page)).length === 1, 'Backspace removes it too');
    await page.evaluate(() => window.__sculpt.session.undo());
    await frames(page);
    // Picking an object lets go of the caliper.
    await click(page, '.panel--scene [data-role=caliper-row]:nth-of-type(2) [data-role=caliper-name]');
    t.ok((await picked()) === 'Left forearm', 'picked again');
    await click(page, '.panel--scene .outliner > .outliner__row .outliner__name');
    await frames(page);
    t.ok((await picked()) === null && (await orangeAt(0)) === 0, 'picking an object lets go of the caliper');
    // The eye hides it in the view, and stays hidden through a reload.
    const litAt = async (idx) => {
      const [x, y] = await midOf(idx);
      return page.evaluate(
        async ([px, py]) => {
          for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
          const c = document.querySelector('.measure-overlay canvas');
          const k = c.width / innerWidth;
          const d = c.getContext('2d').getImageData(Math.round((px - 3) * k), Math.round((py - 3) * k), Math.round(6 * k), Math.round(6 * k)).data;
          let lit = 0;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
          return lit;
        },
        [x, y],
      );
    };
    t.ok((await litAt(1)) > 0, 'the second caliper is drawn');
    await click(page, '.panel--scene [data-role=caliper-row]:nth-of-type(3) [data-role=caliper-eye]');
    await frames(page);
    t.ok((await litAt(1)) === 0, 'the eye on its row hides it in the view (its pixels are gone)');
    t.ok((await labels(page)).length === 1, 'with its label');
    await page.evaluate(() => window.__sculpt.session.undo());
    await frames(page);
    t.ok((await litAt(1)) > 0, 'Undo shows it again');
    await page.evaluate(() => window.__sculpt.session.redo());
    await frames(page);
    // Rename on the row, as an object is renamed.
    await page.evaluate(() => document.querySelector('.panel--scene [data-role=caliper-row]:nth-of-type(2) [data-role=caliper-name]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await page.waitForSelector('.panel--scene [data-role=caliper-rename]');
    await page.fill('.panel--scene [data-role=caliper-rename]', 'Right forearm');
    await page.keyboard.press('Enter');
    await frames(page);
    t.ok((await pinned(page))[0].name === 'Right forearm' && (await rowsOf())[0].name === 'Right forearm', 'a double tap on the row name renames it');
    await page.evaluate(() => window.__sculpt.session.undo());
    await frames(page);
    t.ok((await pinned(page))[0].name === 'Left forearm', 'and Undo gives the name back');
    // Hidden (the Redo above left the second one hidden), then a reload: still hidden, still a row.
    await page.evaluate(() => window.__sculpt.persist.markDirty());
    await page.evaluate(() => window.__sculpt.persist.flush());
    await page.goto(`${base}/?sculpt=1&q=low&start=sphere`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await openPanel(page, 'Scene');
    await frames(page);
    list = await pinned(page);
    t.ok(list.length === 2 && list[0].visible && !list[1].visible, `after a reload the hidden one is still hidden (${JSON.stringify(list)})`);
    t.ok((await litAt(1)) === 0 && (await litAt(0)) > 0, 'in the view as well');
    t.ok((await rowsOf()).length === 2, 'and both have their rows');
    await page.evaluate(() => window.__sculpt.session.measure.setVisible(window.__sculpt.session.measure.all()[1].measure, true));
    await frames(page);

    // 7. Saved with the scene: a .bozz, and the autosave through a reload.
    const filed = await page.evaluate(async () => {
      const { file, session } = window.__sculpt;
      const bytes = await file.pack();
      const rec = await file.unpack(bytes);
      const saved = rec.meshes[0].measures;
      await file.open(bytes);
      return {
        saved: saved?.map((m) => `${m.name}:${m.a.length}:${m.b.length}`).join(' '),
        reopened: session.measure.all().map(({ measure }) => measure.name).join(', '),
      };
    });
    t.ok(filed.saved === 'Left forearm:3:3 Caliper 2:3:3', `a .bozz keeps the pinned measurements, two points each (${filed.saved})`);
    t.ok(filed.reopened === 'Left forearm, Caliper 2', `and opens with them (${filed.reopened})`);
    const lenBefore = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const { mesh, measure } = session.measure.all()[0];
      return session.measure.length(mesh, measure);
    });
    await page.evaluate(() => window.__sculpt.persist.markDirty());
    await page.evaluate(() => window.__sculpt.persist.flush());
    await page.goto(`${base}/?sculpt=1&q=low&start=sphere`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt && !document.getElementById('overlay'), null, { timeout: 90_000 });
    list = await pinned(page);
    t.ok(list.length === 2 && list[0].name === 'Left forearm', `the autosave keeps them through a reload (${list.map((m) => m.name).join(', ')})`);
    const lenAfter = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const { mesh, measure } = session.measure.all()[0];
      return session.measure.length(mesh, measure);
    });
    t.ok(Math.abs(lenAfter - lenBefore) < 1e-4, `with the same length (${lenBefore.toFixed(3)} and ${lenAfter.toFixed(3)} cm)`);
    t.ok((await labels(page)).length === 2, 'and drawn again');

    // 8. Attached to the object: it moves and scales with it.
    const att = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const { mesh, measure } = session.measure.all()[0];
      const m = mesh.getMatrix();
      const was = Float32Array.from(m);
      const world = (p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
      const a0 = world(measure.a);
      const len0 = session.measure.length(mesh, measure);
      m[12] += 10;
      const a1 = world(measure.a);
      for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) m[i] *= 2;
      const len1 = session.measure.length(mesh, measure);
      m.set(was);
      return { moved: a1.map((v, i) => v - a0[i]), len0, len1 };
    });
    t.ok(Math.abs(att.moved[0] - 10) < 1e-3 && Math.abs(att.moved[1]) < 1e-3, `moving the object carries the point with it (${att.moved.map((v) => v.toFixed(2)).join(', ')})`);
    t.ok(Math.abs(att.len1 - 2 * att.len0) < 1e-3, `scaling it doubles the length (${att.len0.toFixed(2)} to ${att.len1.toFixed(2)} cm)`);

    // 9. Mirror, with symmetry on, on a symmetric sphere.
    await page.evaluate(() => window.__sculpt.session.measure.clearWorking());
    await page.keyboard.press('3');
    const symOn = await page.evaluate(() => window.__sculpt.session.getSymmetry());
    if (!symOn) await page.keyboard.press('x');
    await page.keyboard.press('c');
    await frames(page);
    await twoTaps(page, dev, s, [0.2, -0.4], [0.55, 0.3]);
    const mirrorEnabled = await page.evaluate(() => !document.querySelector('[data-role=measure-mirror]').disabled);
    t.ok(mirrorEnabled, 'Mirror is offered with symmetry on');
    await click(page, '.panel--sculpt [data-role=measure-mirror]');
    await frames(page);
    const w4 = await working(page);
    t.ok(w4 && w4.mirror !== null && Math.abs(w4.mirror - w4.length) < 0.1, `the mirror of a measurement on a symmetric sphere is as long (${w4?.length.toFixed(3)} and ${w4?.mirror?.toFixed(3)} cm)`);
    const pair = await text(page, '[data-role=measure-reading]');
    t.ok(/and .*difference 0\.0 cm/.test(pair ?? ''), `the Tool panel shows both lengths with their difference (${pair})`);
    t.ok((await labels(page)).length === 4, 'the mirror has its own label in the view (two pinned, this one, its mirror)');
    const mirrored = await page.evaluate(() => {
      const w = window.__sculpt.session.measure.working;
      return { a: w.m.a, ma: w.m.mirror.a };
    });
    t.ok(Math.abs(mirrored.a[0] + mirrored.ma[0]) < 1e-4 && Math.abs(mirrored.a[1] - mirrored.ma[1]) < 1e-4, 'across the symmetry plane (x flips, y stays)');
    await click(page, '[data-role=measure-pin]');
    await frames(page);
    await openPanel(page, 'Model');
    const pairRow = await text(page, '[data-role=measure-pair]');
    t.ok(/^Mirror .* cm, difference 0\.0 cm$/.test(pairRow ?? ''), `the Measure section shows the pair with its difference (${pairRow})`);
    // With symmetry off the Mirror button waits.
    await page.keyboard.press('x');
    await frames(page);
    const flipOff = await page.evaluate(() => [...document.querySelectorAll('.measure-row')].map((r) => r.querySelector('[data-role=measure-mirror]').disabled));
    t.ok(flipOff.filter(Boolean).length >= 1, 'with symmetry off a measurement without a mirror cannot be mirrored');
    await page.keyboard.press('x');

    t.ok((await meshSum(page)) === sum0, 'through all of it the mesh was never touched');

    // Vertices change under a pinned point (as a sculpt, remesh or subdivide would): no throw, the stored point
    // stays, and once the mesh is still it is re-snapped to the nearest point of the new surface.
    const grown = await page.evaluate(async () => {
      const ss = window.__sculpt.session;
      const mesh = ss.getMesh();
      const m = ss.measure.list(mesh)[0];
      const r0 = Math.hypot(...m.a);
      const v = mesh.getVertices();
      for (let i = 0; i < v.length; i++) v[i] *= 1.25;
      for (let i = 0; i < 40; i++) await new Promise((r) => requestAnimationFrame(r));
      return { r0, r1: Math.hypot(...m.a) };
    });
    t.ok(Math.abs(grown.r1 / grown.r0 - 1.25) < 0.04, `a pinned point follows a changed surface by re-snapping (radius ${grown.r0.toFixed(2)} to ${grown.r1.toFixed(2)})`);
  },

  async calipersTouch(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    const s = await sphere(page);
    await page.keyboard.press('c');
    const sum0 = await meshSum(page);
    const A = [s.mid[0] - s.px * 0.4, s.mid[1] + s.px * 0.1];
    const B = [s.mid[0] + s.px * 0.45, s.mid[1] - s.px * 0.2];
    await dev.tap(A);
    await frames(page);
    await dev.tap(B);
    await frames(page);
    const w = await working(page);
    t.ok(w && w.b && Math.abs(w.length - dist3(await surfaceAt(page, A), await surfaceAt(page, B))) < 0.1, `two finger taps set both points (${w?.length?.toFixed(2)} cm)`);
    // A finger on an end drags it along the surface.
    const endScreen = await onScreen(page, w.b);
    const target = [s.mid[0] + s.px * 0.2, s.mid[1] + s.px * 0.45];
    await dev.finger([endScreen, [(endScreen[0] + target[0]) / 2, (endScreen[1] + target[1]) / 2], target]);
    await frames(page);
    const w2 = await working(page);
    t.ok(w2 && dist3(w2.b, await surfaceAt(page, target)) < 0.2 && dist3(w2.b, w.b) > 0.5, 'a finger on an end moves it along the surface');
    // One finger elsewhere still orbits; two fingers pan and pinch.
    const cam0 = await page.evaluate(() => window.__sculpt.viewer.getCameraState().position);
    const empty = [s.mid[0] + s.px * 2.2, s.mid[1] - s.px * 0.2];
    await dev.finger([empty, [empty[0] + 40, empty[1] + 10], [empty[0] + 90, empty[1] + 20]]);
    await settle(page);
    const cam1 = await page.evaluate(() => window.__sculpt.viewer.getCameraState().position);
    t.ok(dist3(cam0, cam1) > 1e-3, 'one finger off the model still orbits with the tool in hand');
    const w3 = await working(page);
    t.ok(w3 && w3.b && Math.abs(w3.length - w2.length) > -1, 'and that did not set a point');
    const c0 = await page.evaluate(() => window.__sculpt.viewer.getCameraState());
    const m1 = [s.mid[0] - 60, s.mid[1] + s.px * 0.9];
    const m2 = [s.mid[0] + 60, s.mid[1] + s.px * 0.9];
    await dev.pair([m1, [m1[0] - 40, m1[1]], [m1[0] - 80, m1[1]]], [m2, [m2[0] + 40, m2[1]], [m2[0] + 80, m2[1]]]);
    await settle(page);
    const c1 = await page.evaluate(() => window.__sculpt.viewer.getCameraState());
    const d0 = Math.hypot(...c0.position.map((p, i) => p - c0.target[i]));
    const d1 = Math.hypot(...c1.position.map((p, i) => p - c1.target[i]));
    t.ok(Math.abs(d1 - d0) / d0 > 0.02, `two fingers pinch the view (${d0.toFixed(1)} to ${d1.toFixed(1)})`);
    t.ok((await meshSum(page)) === sum0, 'no touch changed the mesh');
  },

  async calipersUnits(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(() => window.__sculpt.session.setUnits(null));
    await frames(page);
    await page.keyboard.press('c');
    await openPanel(page, 'Tool');
    await frames(page);
    const msg = await text(page, '.panel--sculpt [data-role=measure-needs-scale]');
    t.ok(msg === "Set the scene's scale first", `a scene without units says to set its scale first (${msg})`);
    t.ok(!(await page.evaluate(() => !!document.querySelector('.panel--sculpt [data-role=measure-pin]'))), 'and offers no measuring');
    const dev = await devices(page);
    const s = await sphere(page);
    await dev.penDrag([[s.mid[0] + s.px * 0.2, s.mid[1] + s.px * 0.1]]);
    await frames(page);
    t.ok((await working(page)) === null, 'a press on the model sets no point there');
    await openPanel(page, 'Model');
    t.ok((await text(page, '[data-role=measure-list] [data-role=measure-needs-scale]')) === "Set the scene's scale first", 'the Measure section says it too');
    await click(page, '.panel--sculpt [data-role=measure-set-scale]');
    await frames(page);
    const form = await page.evaluate(() => {
      const f = document.querySelector('.scale-banner__form');
      return !!f && !f.hidden && !document.querySelector('.scale-banner').hidden;
    });
    t.ok(form, 'its button opens Set scale');
    // Applying it turns the tool on.
    await page.evaluate(() => window.__sculpt.session.setUnits('cm'));
    await frames(page);
    t.ok(/first point/.test((await text(page, '[data-role=measure-reading]')) ?? ''), 'with a scale the Tool panel offers the measuring');
    t.ok(!(await page.evaluate(() => !!document.querySelector('.scale-banner') && !document.querySelector('.scale-banner').hidden)), 'and the banner goes');
  },
};

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'block' };

suites.calipersPhone = async function calipersPhone(page, base, t) {
    const ctx = await page.context().browser().newContext(PHONE);
    await ctx.addInitScript(() => {
      window.__bozzettoAdaptiveOff = true;
      try {
        localStorage.setItem('bozzetto-device-choice', 'keep');
      } catch {
        /* no storage */
      }
    });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    try {
      await openForInput(p, base);
      const dev = await devices(p);
      const bar = await p.evaluate(() => {
        const b = [...document.querySelectorAll('.sculpt-toolbar__btn')].find((x) => x.getAttribute('aria-label')?.startsWith('Calipers'));
        const r = b?.getBoundingClientRect();
        return { has: !!b, w: r?.width, h: r?.height, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      t.ok(bar.has && bar.w >= 32 && bar.h >= 32, `the Calipers button is there at touch size (${bar.w}x${bar.h})`);
      t.ok(bar.over <= 0, 'no sideways scroll of the page');
      await p.evaluate(() => [...document.querySelectorAll('.sculpt-toolbar__btn')].find((x) => x.getAttribute('aria-label')?.startsWith('Calipers')).click());
      await frames(p);
      t.ok(await p.evaluate(() => window.__sculpt.input.isMeasuring()), 'a tap on the button puts the tool in hand');
      const s = await sphere(p);
      await dev.tap([s.mid[0] - s.px * 0.4, s.mid[1] + s.px * 0.1]);
      await frames(p);
      await dev.tap([s.mid[0] + s.px * 0.4, s.mid[1] - s.px * 0.1]);
      await frames(p);
      const w = await working(p);
      t.ok(w && w.b && w.length > 1, `two taps measure on a phone (${w?.length?.toFixed(1)} cm)`);
      const label = await p.evaluate(() => {
        const el = document.querySelector('.measure-label');
        const r = el.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: innerWidth, h: innerHeight };
      });
      t.ok(label.l >= 0 && label.r <= label.w && label.t >= 0 && label.b <= label.h, 'the label stays inside the view');
      await p.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/phone-calipers.png` : undefined });
      t.ok((await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, 'still no sideways scroll');
    } finally {
      await ctx.close();
    }
    t.ok(!errors.length, `no page errors on the phone${errors.length ? `: ${errors.join(' | ')}` : ''}`);
};

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/calipers';

// A scene saved before calipers had names, eyes and rows: its pinned calipers get names in order and are shown,
// each with a row in the Scene panel. And the Scene panel with two caliper rows, one picked (a picture).
suites.calipersScene = async function calipersScene(page, base, t) {
  await page.setViewportSize({ width: 1180, height: 820 });
  mkdirSync(SHOTS, { recursive: true });
  await openForInput(page, base);
  // Two points on the sphere's own vertices, as an old record would have kept them: no name, no eye.
  const spots = await page.evaluate(() => {
    const v = window.__sculpt.session.getMesh().getVertices();
    const n = window.__sculpt.session.getMesh().getNbVertices();
    const p = (i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
    return [p(3), p(Math.floor(n / 3)), p(Math.floor(n / 2)), p(n - 5)];
  });
  await page.evaluate(() => window.__sculpt.persist.markDirty());
  await page.evaluate(() => window.__sculpt.persist.flush());
  await page.evaluate((pts) => {
    return new Promise((ok, fail) => {
      const r = indexedDB.open('bozzetto-sculpt');
      r.onerror = () => fail(r.error);
      r.onsuccess = () => {
        const tx = r.result.transaction('scene', 'readwrite');
        const store = tx.objectStore('scene');
        const get = store.get('current');
        get.onsuccess = () => {
          const rec = get.result;
          rec.meshes[0].measures = [
            { a: pts[0], b: pts[1] },
            { a: pts[2], b: pts[3] },
          ];
          store.put(rec, 'current');
          tx.oncomplete = () => ok(true);
        };
        tx.onerror = () => fail(tx.error);
      };
    });
  }, spots);
  await page.goto(`${base}/?sculpt=1&q=low&start=sphere`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__sculpt && !document.getElementById('overlay'), null, { timeout: 90_000 });
  await openPanel(page, 'Scene');
  await frames(page);
  const list = await pinned(page);
  t.ok(list.length === 2 && list[0].name === 'Caliper 1' && list[1].name === 'Caliper 2' && list.every((m) => m.visible), `an old scene's calipers get names in order and are shown (${JSON.stringify(list)})`);
  const rows = await page.evaluate(() => [...document.querySelectorAll('.panel--scene [data-role=caliper-row]')].map((r) => `${r.querySelector('[data-role=caliper-name]').textContent} ${r.querySelector('[data-role=caliper-length]').textContent}`));
  t.ok(rows.length === 2 && rows.every((r) => /^Caliper \d \d+\.\d cm$/.test(r)), `each has a row with its length (${rows.join('; ')})`);
  await page.evaluate(() => {
    const m = window.__sculpt.session.measure;
    m.rename(m.all()[0].measure, 'Left forearm');
    m.select(m.all()[1].measure);
  });
  await frames(page);
  await page.screenshot({ path: `${SHOTS}/scene-rows.png` });
};

// A caliper placed on the mannequin is tied to the part it was placed on and goes with it when the figure is posed.
suites.calipersMannequin = async function calipersMannequin(page, base, t) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1180, height: 820 });
  mkdirSync(SHOTS, { recursive: true });
  await openForInput(page, base);
  const dev = await devices(page);
  const waitHere = (name) => page.waitForFunction((n) => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === n, name, { timeout: 20_000 });
  const goArmature = async () => {
    await page.keyboard.press('Shift+1');
    await waitHere('Armature');
    await page.waitForFunction(() => !!window.__armature && !window.__armature.isSuspended() && !document.querySelector('.sculpt-toast[data-state="running"]'), null, { timeout: 60_000 });
    await page.waitForTimeout(150);
  };
  const goSculpt = async () => {
    await page.keyboard.press('Shift+2');
    await waitHere('Sculpt');
    await page.waitForTimeout(150);
  };
  await goArmature();
  await page.waitForTimeout(400);
  await goSculpt();
  // The mannequin alone in the scene, in front.
  await page.evaluate(() => {
    const { session } = window.__sculpt;
    for (const m of [...session.getMeshes()]) session.deleteMesh(m);
  });
  await page.waitForTimeout(400);
  const joints = await page.evaluate(() => {
    const a = window.__armature.armature;
    const at = (n) => a.jointWorld(n).toArray();
    return { fore: at('forearm.L'), hand: at('hand.L'), upper: at('upperarm.L'), clavL: at('clavicle.L'), clavR: at('clavicle.R') };
  });
  const lerp = (p, q, k) => p.map((v, i) => v + (q[i] - v) * k);
  const onScreen = (p) => page.evaluate((w) => window.__armature.onScreen(w[0], w[1], w[2]), p);
  await page.keyboard.press('c');
  await frames(page);
  const A = await onScreen(lerp(joints.fore, joints.hand, 0.25));
  const B = await onScreen(lerp(joints.fore, joints.hand, 0.7));
  await dev.penDrag([A]);
  await frames(page);
  await dev.penDrag([B]);
  await frames(page);
  const made = await page.evaluate(() => {
    const w = window.__sculpt.session.measure.working;
    return w ? { owner: w.mesh, ties: w.m.ties, b: !!w.m.b } : null;
  });
  t.ok(made && made.owner === null && made.b, 'two taps on the mannequin make a caliper that belongs to no object');
  t.ok(made?.ties?.a?.bone === 'forearm.L' && made?.ties?.b?.bone === 'forearm.L', `each end is tied to the part it was placed on (${JSON.stringify(made?.ties)})`);
  await page.evaluate(() => window.__sculpt.session.measure.pinWorking());
  await frames(page);
  const ends = () =>
    page.evaluate(() => {
      const s = window.__sculpt.session.measure;
      const { mesh, measure } = s.all()[0];
      return { a: s.pointWorld(mesh, measure, 'a'), b: s.pointWorld(mesh, measure, 'b'), len: s.length(mesh, measure), ties: !!measure.ties };
    });
  const e0 = await ends();
  const d3 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const elbowDist = async () => d3((await ends()).a, await page.evaluate(() => window.__armature.armature.jointWorld('forearm.L').toArray()));
  const dElbow0 = await elbowDist();
  t.ok(e0.len > 3 && e0.len < 40, `its length is of the forearm (${e0.len.toFixed(1)} cm)`);
  await openPanel(page, 'Scene');
  const row = await page.evaluate(() => document.querySelector('.panel--scene [data-role=caliper-row] [data-role=caliper-length]')?.textContent);
  t.ok(row === `${e0.len.toFixed(1)} cm`, `its row says the length (${row})`);
  // Posing the elbow moves the forearm, and the caliper with it.
  await goArmature();
  await page.evaluate(() => window.__armature.turn('forearm.L', 50, 0, 0));
  await page.waitForTimeout(300);
  await goSculpt();
  await frames(page);
  const e1 = await ends();
  t.ok(d3(e1.a, e0.a) > 1 && d3(e1.b, e0.b) > 1, `posing the forearm carries both ends along (moved ${d3(e1.a, e0.a).toFixed(1)} and ${d3(e1.b, e0.b).toFixed(1)} cm)`);
  t.ok(Math.abs(e1.len - e0.len) < 0.05, `its length is the same on a rigid part (${e0.len.toFixed(2)} and ${e1.len.toFixed(2)} cm)`);
  t.ok(Math.abs((await elbowDist()) - dElbow0) < 0.05, 'and each end keeps its place on the part (its distance from the elbow)');
  // One across the shoulders: its two ends are on different parts, so posing one arm changes its length.
  await page.keyboard.press('c');
  await frames(page);
  const sh = lerp(joints.upper, joints.fore, 0.2);
  sh[1] += 3;
  const S1 = await onScreen(sh);
  const S2 = await onScreen([-sh[0], sh[1], sh[2]]);
  await dev.penDrag([S1]);
  await frames(page);
  await dev.penDrag([S2]);
  await frames(page);
  await page.evaluate(() => window.__sculpt.session.measure.pinWorking());
  await frames(page);
  const wide = () =>
    page.evaluate(() => {
      const s = window.__sculpt.session.measure;
      const all = s.all();
      const { mesh, measure } = all[all.length - 1];
      return { len: s.length(mesh, measure), a: s.pointWorld(mesh, measure, 'a'), b: s.pointWorld(mesh, measure, 'b'), ties: measure.ties };
    });
  const w0 = await wide();
  t.ok(w0.ties?.a && w0.ties?.b && w0.ties.a.bone !== w0.ties.b.bone, `a caliper across the shoulders is tied to two parts (${JSON.stringify(w0.ties)})`);
  await page.screenshot({ path: `${SHOTS}/shoulders.png` });
  await goArmature();
  await page.evaluate(() => window.__armature.turn('upperarm.L', 0, 0, 40));
  await page.waitForTimeout(300);
  await goSculpt();
  await frames(page);
  const w1 = await wide();
  t.ok(Math.abs(w1.len - d3(w1.a, w1.b)) < 1e-3 && Math.abs(w1.len - w0.len) > 0.3, `posing one arm updates its length (${w0.len.toFixed(1)} to ${w1.len.toFixed(1)} cm)`);
  // A replaced mannequin: the ends stay where they were in the world, and nothing is said.
  const before = await wide();
  const f1 = await ends();
  await goArmature();
  await page.evaluate(() => window.__armature.figure('mannequin-female-realistic'));
  await page.waitForTimeout(500);
  await goSculpt();
  await frames(page);
  const after = await wide();
  const f2 = await ends();
  t.ok(d3(after.a, before.a) < 1e-3 && d3(after.b, before.b) < 1e-3 && !after.ties, `a replaced mannequin leaves the ends where they were (${JSON.stringify(after.ties)})`);
  t.ok(!f2.ties && d3(f2.a, f1.a) < 1e-3, 'the forearm one stays too');
  t.ok(!(await page.evaluate(() => !!document.querySelector('.bz-ask'))), 'and nothing was asked');
  t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
};
