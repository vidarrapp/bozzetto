// The units suite (owner decisions: one world unit is a centimetre, the
// interface speaks centimetres, and the floor is fixed at 0). A new scene
// carries the marker 'cm' and shows its sizes in centimetres, its objects
// at real size with scale 1; the floor stays at 0 whatever the scene does,
// its offset is saved with the look and the file and comes back; new
// objects stand on it. A scene saved while a unit was a metre - a .bozz,
// an autosave - is converted once and looks exactly as it did. A scene
// from before real units opens as it was, with the floor that follows it,
// and Set scale puts it on real units. A project without the marker plays
// in the viewer as it did, one with it on the fixed floor, an 'm' one in
// centimetres. The mannequins stand at their files' own heights, and Send
// to Sculpt keeps the figure's feet on the floor. Each gets (page, base, t).
import { openArmature, openSculpt } from './lib.mjs';

/** The active object's exact world box, {min, max} in centimetres. */
const activeBox = (page) => page.evaluate(() => window.__sculpt.worldBox(window.__sculpt.session.getMesh()));

/** Type a value into a compact slider row, as a double-click on it does. */
async function typeInto(page, selector, text) {
  const input = page.locator(selector);
  await input.dblclick();
  const field = page.locator('.slider-field');
  await field.waitFor({ timeout: 5000 });
  await field.fill(text);
  await field.press('Enter');
}

/** Slide the Scene panel out, where its rows can be pressed. */
const openScenePanel = (page) =>
  page.evaluate(() => {
    const panel = document.querySelector('.panel--scene');
    if (panel.classList.contains('panel--collapsed')) panel.querySelector('.panel__handle').click();
  });

/** The Scene panel's Floor offset slider. */
const SCENE_FLOOR = '.panel--scene .outliner__measure input[type="range"]';

/**
 * A legacy autosave: the live scene's record without its marker, every
 * object scaled by `k` about the origin as the old canonical scale had it,
 * written where the autosave keeps it. The autosave is stopped first, so
 * the reload's own flush does not write the marked scene back over it.
 */
const plantLegacyAutosave = (page, k) =>
  page.evaluate(async (scale) => {
    const { session, persist } = window.__sculpt;
    persist.disable();
    const rec = session.serializeScene();
    delete rec.units;
    for (const m of rec.meshes) for (let i = 0; i < 15; i++) if (i % 4 !== 3) m.matrix[i] *= scale;
    await new Promise((done, fail) => {
      const req = indexedDB.open('bozzetto-sculpt');
      req.onerror = () => fail(req.error);
      req.onsuccess = () => {
        const tx = req.result.transaction('scene', 'readwrite');
        tx.objectStore('scene').put(rec, 'current');
        tx.objectStore('scene').delete('currentLook');
        tx.oncomplete = () => {
          req.result.close();
          done();
        };
        tx.onerror = () => fail(tx.error);
      };
    });
  }, k);

/**
 * The live scene and look as a build of the metre weeks wrote them: every
 * matrix divided by 100 about the origin, the look's camera, focus lock
 * and Floor offset with it, marked 'm' (the look kept apart from the
 * scene had no marker then). For a page's own evaluate.
 */
const METRES = `
  window.__toMetres = (rec, look) => {
    for (const m of rec.meshes) for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) m.matrix[c * 4 + r] /= 100;
    const back = (l) => {
      if (!l) return l;
      const out = JSON.parse(JSON.stringify(l));
      if (out.camera) {
        out.camera.position = out.camera.position.map((v) => v / 100);
        out.camera.target = out.camera.target.map((v) => v / 100);
        if (out.camera.dof?.focusPoint) out.camera.dof.focusPoint = out.camera.dof.focusPoint.map((v) => v / 100);
      }
      if (out.presentation && typeof out.presentation.floorOffset === 'number') out.presentation.floorOffset /= 100;
      delete out.units;
      return out;
    };
    rec.look = back(rec.look);
    rec.units = 'm';
    return { rec, look: back(look) };
  };
`;

/** Every object's world box, its matrix's column lengths (its scale), and the view. */
const sceneFacts = (page) =>
  page.evaluate(() => {
    const { session, viewer } = window.__sculpt;
    return {
      units: session.getUnits(),
      objects: session.getMeshes().map((m) => {
        const x = m.getMatrix();
        return {
          name: session.getMeshName(m),
          box: window.__sculpt.worldBox(m),
          scale: [0, 1, 2].map((c) => Math.hypot(x[c * 4], x[c * 4 + 1], x[c * 4 + 2])),
        };
      }),
      camera: viewer.getCameraState(),
      offset: viewer.getFloorOffset(),
    };
  });

/** Two sets of facts describe the same world: boxes, view and floor alike, within `tol` cm. */
function sameWorld(t, a, b, what) {
  const close = (x, y, tol) => Math.abs(x - y) <= tol;
  const boxes = a.objects.length === b.objects.length && a.objects.every((o, i) => [0, 1, 2].every((k) => close(o.box.min[k], b.objects[i].box.min[k], 2e-3) && close(o.box.max[k], b.objects[i].box.max[k], 2e-3)));
  t.ok(boxes, `${what}: every object's world box is as it was, in centimetres (${JSON.stringify(b.objects.map((o) => o.box.max.map((v) => +v.toFixed(3))))})`);
  t.ok(b.objects.every((o) => o.scale.every((s) => close(s, 1, 1e-5))), `${what}: every object's scale is folded into its vertices (${JSON.stringify(b.objects.map((o) => o.scale.map((v) => +v.toFixed(4))))})`);
  const view = [0, 1, 2].every((k) => close(a.camera.position[k], b.camera.position[k], 1e-2) && close(a.camera.target[k], b.camera.target[k], 1e-2));
  t.ok(view, `${what}: the camera frames it as it did (${b.camera.position.map((v) => v.toFixed(2))})`);
  t.near(b.offset, a.offset, 1e-6, `${what}: the Floor offset is the same, in centimetres`);
}

/** The scene's floor, as the viewer holds it, and what the ground is doing. */
const floorState = (page) =>
  page.evaluate(() => {
    const v = window.__sculpt?.viewer ?? window.__bozzetto;
    return {
      locked: v.lockedFloor(),
      height: v.floorHeight(),
      offset: v.getFloorOffset(),
      groundY: v.ground.position.y,
      span: v.ground.scale.x,
    };
  });

export const suites = {
  async units(page, base, t) {
    // --- a new scene: real units from the start --------------------------------
    await openSculpt(page, base);
    const fresh = await page.evaluate(() => ({
      units: window.__sculpt.session.getUnits(),
      record: window.__sculpt.session.serializeScene().units,
    }));
    t.eq(fresh.units, 'cm', 'a new scene is on real units, in centimetres');
    t.eq(fresh.record, 'cm', 'and its record carries the marker');
    let box = await activeBox(page);
    t.near(box.max[1] - box.min[1], 25, 0.05, 'the default sphere is 25 cm tall');
    t.near(box.min[1], 0, 1e-3, 'and stands on the floor');
    const sphereMatrix = await page.evaluate(() => Array.from(window.__sculpt.session.getMesh().getMatrix()));
    t.ok(
      [0, 5, 10, 15].every((i) => sphereMatrix[i] === 1) && [1, 2, 4, 6, 8, 9].every((i) => sphereMatrix[i] === 0),
      `its size is in its vertices: the matrix is a translation alone (${sphereMatrix.map((v) => +v.toFixed(3)).join(' ')})`,
    );
    t.ok(Math.abs(sphereMatrix[12]) < 1e-6 && Math.abs(sphereMatrix[13] - 12.5) < 1e-3 && Math.abs(sphereMatrix[14]) < 1e-6, `and its pivot is its centre, 12.5 cm up (${sphereMatrix.slice(12, 15).join(', ')})`);
    // The size line is gone from the Scene panel (owner call); the channel
    // box shows the transform.
    const sizeLine = await page.evaluate(() => !!document.querySelector('.panel--scene .outliner__size'));
    t.ok(!sizeLine, 'the Scene panel has no size line');
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('.outliner__menu-grid--words .outliner__menu-item')].map((b) => `${b.dataset.kind}:${b.querySelector('.outliner__menu-size')?.textContent ?? ''}`),
    );
    t.eq(
      labels.join(' '),
      'sphere:25 cm cube:25 cm cylinder:25 cm torus:25 cm cone:25 cm capsule:25 cm plane:50 cm',
      'the Create menu says each primitive\'s size',
    );

    // --- the floor: fixed at 0, whatever the scene does -------------------------
    await page.evaluate(() => window.__sculpt.viewer.setGround('floor'));
    let f = await floorState(page);
    t.eq(f.locked, 0, 'the floor is fixed at 0');
    t.ok(Math.abs(f.groundY) < 1e-2, `the ground is drawn at 0 (${f.groundY})`);
    t.ok(f.span * 0.36 >= 300 - 1e-4, `its disc reaches several metres (${(f.span * 0.36).toFixed(0)} cm radius)`);
    // A tall object far from the origin, framed, moves nothing.
    await page.evaluate(() => {
      const { session, viewer } = window.__sculpt;
      const m = session.addPrimitive('cylinder');
      const mat = m.getMatrix();
      mat[12] = 300;
      mat[13] = 200;
      for (const i of [0, 5, 10]) mat[i] *= 8;
      session.onActiveMeshChange?.();
      const b = m.computeWorldBound();
      const v = (x, y, z) => viewer.camera.position.clone().set(x, y, z);
      viewer.frameBounds(viewer.subjectBox.clone().set(v(b[0], b[1], b[2]), v(b[3], b[4], b[5])));
    });
    f = await floorState(page);
    t.ok(f.locked === 0 && Math.abs(f.groundY) < 1e-2, `nor does framing a tall object off to one side (ground at ${f.groundY})`);
    // Standing back far enough widens the fade, from the same place.
    const wide = await page.evaluate(async () => {
      const { viewer } = window.__sculpt;
      const st = viewer.getCameraState();
      const far = st.position.map((p, i) => st.target[i] + (p - st.target[i]) * 20);
      viewer.setCameraState(new viewer.camera.position.constructor(...far), new viewer.camera.position.constructor(...st.target));
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const out = { span: viewer.ground.scale.x, y: viewer.ground.position.y, x: viewer.ground.position.x };
      viewer.setCameraState(new viewer.camera.position.constructor(...st.position), new viewer.camera.position.constructor(...st.target));
      return out;
    });
    t.ok(wide.span > f.span && Math.abs(wide.y) < 1e-2 && wide.x === 0, `dollied out, the floor's fade reaches further (${(wide.span * 0.36).toFixed(0)} cm) and the floor stays put`);
    await page.evaluate(() => window.__sculpt.session.undo());

    // --- the Floor offset: in the Scene panel, saved with the look -------------
    await openScenePanel(page);
    await typeInto(page, SCENE_FLOOR, '10');
    f = await floorState(page);
    t.near(f.offset, 10, 1e-9, 'typing 10 cm into Floor offset raises the floor by 10 cm');
    t.ok(Math.abs(f.groundY - 10) < 1e-2, `and the ground with it (${f.groundY})`);
    const placed = await page.evaluate(() => window.__sculpt.worldBox(window.__sculpt.session.addPrimitive('cube')));
    t.near(placed.min[1], 10, 1e-3, 'a new object stands on the raised floor');
    t.near(placed.max[1] - placed.min[1], 25, 0.05, 'at its real size (25 cm cube)');
    const filed = await page.evaluate(async () => {
      const bytes = await window.__sculpt.file.pack();
      const rec = await window.__sculpt.file.unpack(bytes);
      return { units: rec.units, offset: rec.look?.presentation?.floorOffset };
    });
    t.eq(filed.units, 'cm', 'a saved .bozz carries the marker');
    t.near(filed.offset ?? NaN, 10, 1e-9, 'and the floor offset with its look');
    // The look is stored a moment after a panel change; then a reload.
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__sculpt.persist.flush());
    await openSculpt(page, base);
    f = await floorState(page);
    t.near(f.offset, 10, 1e-9, 'the floor offset comes back with the session');
    t.eq(f.locked, 0, 'on the fixed floor');
    const offsetText = await page.evaluate((sel) => document.querySelector(sel)?.value, SCENE_FLOOR);
    t.eq(offsetText, '10', 'and the Scene panel shows it');
    await openScenePanel(page);
    await typeInto(page, SCENE_FLOOR, '0');
    t.eq((await floorState(page)).offset, 0, 'and typing 0 puts the floor back at 0');

    // --- sizes in centimetres: the brush and the remesh ------------------------
    const brush = await page.evaluate(() => {
      const { input, worldScale } = window.__sculpt;
      const size = document.querySelector('.panel--tool input[data-unit]') ?? document.querySelector('input[data-unit=" cm"]');
      return {
        world: worldScale.isEnabled(),
        unit: worldScale.unit(),
        display: input.brushSizeDisplay(),
        panelUnit: size?.dataset.unit ?? null,
      };
    });
    t.ok(brush.world, 'world-scale size is on');
    t.near(brush.unit, 0.02, 1e-12, 'its slider steps a fifth of a millimetre on real units (0.02 units)');
    t.eq(brush.display.unit, ' cm', 'the brush size reads in centimetres');
    t.eq(brush.panelUnit, ' cm', 'in the Tool panel too');
    const rail = page.locator('.sculpt-slider[data-kind="size"]');
    const r = await rail.boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height * 0.5);
    await page.mouse.down();
    const bubble = await page.evaluate(() => document.querySelector('.slider-bubble')?.textContent ?? '');
    await page.mouse.up();
    t.ok(/^\d+(\.\d+)? cm$/.test(bubble), `the rail's bubble says the brush's radius in centimetres (${bubble})`);
    const voxel = await page.evaluate(() => {
      const line = document.querySelector('[data-role="voxel-size"]')?.textContent ?? '';
      const { modelPanel, session } = window.__sculpt;
      modelPanel.voxelOverlay.show(session.remeshBox(), 150);
      const caption = document.querySelector('.voxel-overlay__caption')?.textContent ?? '';
      modelPanel.voxelOverlay.hide();
      return { line, caption };
    });
    t.eq(voxel.line, 'One voxel: 1.7 mm', 'the Model panel gives the voxel size (25 cm at 150)');
    t.ok(/one is 1\.7 mm,/.test(voxel.caption), `and so does the remesh overlay (${voxel.caption})`);

    // --- a legacy autosave: as it was, then Set scale --------------------------
    await page.evaluate(() => window.__sculpt.fileActions.newScene());
    await plantLegacyAutosave(page, 2);
    await openSculpt(page, base);
    const legacy = await page.evaluate(() => ({
      units: window.__sculpt.session.getUnits(),
      banner: !document.querySelector('.scale-banner')?.hidden,
      locked: window.__sculpt.viewer.lockedFloor(),
    }));
    box = await activeBox(page);
    t.eq(legacy.units, null, 'an autosave without the marker opens as a scene from before real units');
    t.near(box.max[1] - box.min[1], 50, 0.1, 'exactly as it was (the sphere 50 units tall)');
    t.eq(legacy.locked, null, 'with the floor that follows its subject');
    t.ok(legacy.banner, 'and the Set scale banner');
    await page.click('.scale-banner__open');
    const picked = await page.evaluate(() => document.querySelector('.scale-banner__object')?.selectedOptions[0]?.textContent);
    t.eq(picked, 'Sphere', 'Set scale picks the largest object');
    await page.fill('.scale-banner__height', '25');
    await page.click('.scale-banner__apply');
    const scaled = await page.evaluate(() => ({
      units: window.__sculpt.session.getUnits(),
      banner: !document.querySelector('.scale-banner')?.hidden,
      locked: window.__sculpt.viewer.lockedFloor(),
    }));
    box = await activeBox(page);
    t.eq(scaled.units, 'cm', 'Set scale puts it on real units');
    t.near(box.max[1] - box.min[1], 25, 1e-2, 'the sphere is the 25 cm typed');
    t.near(box.min[1], 0, 1e-3, 'standing on the floor');
    const scaledMatrix = await page.evaluate(() => Array.from(window.__sculpt.session.getMesh().getMatrix()));
    t.ok([0, 1, 2].every((c) => Math.abs(Math.hypot(scaledMatrix[c * 4], scaledMatrix[c * 4 + 1], scaledMatrix[c * 4 + 2]) - 1) < 1e-5), 'and its scale is folded into its vertices (scale 1)');
    t.ok(!scaled.banner, 'the banner is gone');
    t.eq(scaled.locked, 0, 'and the floor is fixed at 0');
    await page.evaluate(() => window.__sculpt.persist.flush());
    const kept = await page.evaluate(async () => {
      const rec = await new Promise((done) => {
        const req = indexedDB.open('bozzetto-sculpt');
        req.onsuccess = () => {
          const get = req.result.transaction('scene').objectStore('scene').get('current');
          get.onsuccess = () => done(get.result);
        };
      });
      return rec?.units;
    });
    t.eq(kept, 'cm', 'the autosave is marked from then on');

    // Set scale is filled with the object's height read as centimetres (a
    // unit is one now), and Apply as it stands keeps the scene that size.
    await plantLegacyAutosave(page, 2);
    await openSculpt(page, base);
    await page.click('.scale-banner__open');
    const offered = await page.evaluate(() => document.querySelector('.scale-banner__height')?.value);
    const asWas = await activeBox(page);
    await page.click('.scale-banner__apply');
    box = await activeBox(page);
    t.eq(offered, '50', 'Set scale is filled with the sphere\'s 50 units as 50 cm');
    t.ok(
      Math.abs(box.max[1] - box.min[1] - (asWas.max[1] - asWas.min[1])) < 1e-4 && (await page.evaluate(() => window.__sculpt.session.getUnits())) === 'cm',
      `and Apply as it stands keeps it that size, marked (${(box.max[1] - box.min[1]).toFixed(4)} cm)`,
    );

    // Dismissed, the offer does not come back for that scene.
    await plantLegacyAutosave(page, 2);
    await openSculpt(page, base);
    await page.click('.scale-banner__dismiss');
    await page.evaluate(() => window.__sculpt.persist.flush());
    await page.evaluate(() => window.__sculpt.persist.disable());
    await openSculpt(page, base);
    const dismissed = await page.evaluate(() => ({
      units: window.__sculpt.session.getUnits(),
      banner: !document.querySelector('.scale-banner')?.hidden,
    }));
    t.ok(dismissed.units === null && !dismissed.banner, 'Not now keeps the scene as it is, and the banner stays away');

    // --- a legacy .bozz: opened as it was, Set scale from there ----------------
    const bytes = await page.evaluate(async () => {
      const { session, file } = window.__sculpt;
      await window.__sculpt.fileActions.newScene();
      session.addPrimitive('cube');
      session.setUnits(null); // written as a scene from before real units writes itself
      return Array.from(new Uint8Array(await file.pack()));
    });
    await page.evaluate(() => window.__sculpt.fileActions.newScene());
    const opened = await page.evaluate(async (b) => {
      const { session, file } = window.__sculpt;
      await file.open(new Uint8Array(b).buffer);
      return {
        units: session.getUnits(),
        banner: !document.querySelector('.scale-banner')?.hidden,
        locked: window.__sculpt.viewer.lockedFloor(),
        objects: session.getMeshes().length,
      };
    }, bytes);
    t.ok(opened.units === null && opened.banner && opened.locked === null && opened.objects === 2, 'a .bozz without the marker opens unmarked, with the banner and the following floor');
    const cubeTall = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.getMeshes().find((m) => session.getMeshName(m) === 'Cube');
      window.__sculpt.setScale(cube, 40);
      return window.__sculpt.worldBox(cube);
    });
    t.near(cubeTall.max[1] - cubeTall.min[1], 40, 1e-2, 'Set scale on the cube makes it the 40 cm asked for');
    const sphereNow = await page.evaluate(() => {
      const { session } = window.__sculpt;
      return window.__sculpt.worldBox(session.getMeshes().find((m) => session.getMeshName(m) === 'Sphere'));
    });
    t.near(sphereNow.max[1] - sphereNow.min[1], 40, 0.1, 'and the sphere in the same proportion');
    t.near(Math.min(sphereNow.min[1], cubeTall.min[1]), 0, 1e-3, 'the scene set on the floor');

    // --- a scene saved in metres: converted once, the world as it was -----------
    await page.evaluate(METRES);
    const before = await page.evaluate(async () => {
      const { session, file, viewer, fileActions } = window.__sculpt;
      await fileActions.newScene();
      const cube = session.addPrimitive('cube');
      cube.getMatrix()[12] = 40;
      // A per-axis scale, as the gizmo leaves one: folded in too.
      cube.getMatrix()[0] *= 1.5;
      session.onActiveMeshChange?.();
      viewer.setFloorOffset(5);
      const rec = await file.unpack(await file.pack());
      return Array.from(new Uint8Array(await file.packRecord(window.__toMetres(rec).rec)));
    });
    const was = await sceneFacts(page);
    await page.evaluate(async (b) => {
      const { file, fileActions, viewer } = window.__sculpt;
      await fileActions.newScene();
      viewer.setFloorOffset(0);
      await file.open(new Uint8Array(b).buffer);
    }, before);
    const now = await sceneFacts(page);
    t.eq(now.units, 'cm', 'a .bozz saved in metres opens on centimetres');
    sameWorld(t, was, now, 'the metre .bozz');
    const metreRecord = await page.evaluate(() => window.__sculpt.session.serializeScene().units);
    t.eq(metreRecord, 'cm', 'and is marked cm from then on');
    t.ok(await page.evaluate(() => document.querySelector('.scale-banner')?.hidden !== false), 'with no Set scale offer');

    // The same through the autosave, its look kept apart without a marker.
    await page.evaluate(async () => {
      const { session, persist, viewer } = window.__sculpt;
      persist.disable();
      const { rec, look } = window.__toMetres(session.serializeScene(), viewer.getLook());
      await new Promise((done, fail) => {
        const req = indexedDB.open('bozzetto-sculpt');
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction('scene', 'readwrite');
          tx.objectStore('scene').put(rec, 'current');
          tx.objectStore('scene').put(look, 'currentLook');
          tx.oncomplete = () => {
            req.result.close();
            done();
          };
          tx.onerror = () => fail(tx.error);
        };
      });
    });
    const saved = await sceneFacts(page);
    await openSculpt(page, base);
    const restored = await sceneFacts(page);
    t.eq(restored.units, 'cm', 'an autosave in metres comes back on centimetres');
    sameWorld(t, saved, restored, 'the metre autosave');
  },

  async unitsViewer(page, base, t) {
    // A project without the marker plays as it did: the floor follows it.
    const open = async (patch) => {
      await page.unroute('**/timelapses/demo/manifest.json');
      if (patch) {
        await page.route('**/timelapses/demo/manifest.json', async (route) => {
          const res = await route.fetch();
          await route.fulfill({ response: res, json: { ...(await res.json()), ...patch } });
        });
      }
      await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
      await page.waitForTimeout(250);
    };
    await open(null);
    let f = await floorState(page);
    t.eq(f.locked, null, 'an unmarked project plays on the floor that follows its subject');
    await open({ units: 'cm', presentation: { ground: 'floor', floorOffset: 5 } });
    f = await floorState(page);
    t.eq(f.locked, 0, 'one marked in centimetres stands on the fixed floor');
    t.near(f.height, 5, 1e-9, 'raised by its presentation\'s offset');
    t.ok(Math.abs(f.groundY - 5) < 1e-2, `where the ground is drawn (${f.groundY})`);
    const look = await page.evaluate(() => ({ offset: window.__bozzetto.getLook().presentation.floorOffset, units: window.__bozzetto.manifest.units }));
    t.near(look.offset, 5, 1e-9, 'and its look keeps the offset to save');
    // Set scale's record (the editor's, for a project from before): every frame played by one factor, lifted.
    await open({ units: 'cm', presentation: { ground: 'floor', floorOffset: 0, scale: 0.25, lift: 10 } });
    const played = await page.evaluate(() => {
      const v = window.__bozzetto;
      const l = v.frameLocalBounds();
      return { local: [l.min.y, l.max.y], world: [v.subjectBox.min.y, v.subjectBox.max.y], kept: v.getLook().presentation };
    });
    t.ok(
      Math.abs(played.world[0] - (played.local[0] * 0.25 + 10)) < 1e-4 && Math.abs(played.world[1] - (played.local[1] * 0.25 + 10)) < 1e-4,
      `presentation.scale and lift play the frames at that size and height (${played.local.map((x) => x.toFixed(3))} -> ${played.world.map((x) => x.toFixed(3))})`,
    );
    t.ok(played.kept.scale === 0.25 && played.kept.lift === 10, 'and the look keeps them to save');
    // A project stored in metres plays in centimetres: every world number
    // times 100 as it is read, the same picture.
    const camera = { autoFrame: false, position: [0.6, 0.4, 1.2], target: [0, 0.2, 0], focalLength: 50 };
    await open({ units: 'm', camera, presentation: { ground: 'floor', floorOffset: 0.05, scale: 0.25, lift: 0.1 } });
    const metres = await page.evaluate(() => {
      const v = window.__bozzetto;
      const l = v.frameLocalBounds();
      return {
        units: v.manifest.units,
        local: [l.min.y, l.max.y],
        world: [v.subjectBox.min.y, v.subjectBox.max.y],
        played: v.getSubjectTransform(),
        floor: v.floorHeight(),
        camera: v.getCameraState(),
      };
    });
    t.eq(metres.units, 'cm', 'a project marked in metres plays marked in centimetres');
    t.ok(Math.abs(metres.played.scale - 25) < 1e-9 && Math.abs(metres.played.lift - 10) < 1e-9, `its played scale and lift times 100 (${JSON.stringify(metres.played)})`);
    t.ok(Math.abs(metres.world[0] - (metres.local[0] * 25 + 10)) < 1e-3, `its frames 100 times the size they were (${metres.world.map((x) => x.toFixed(2))})`);
    t.near(metres.floor, 5, 1e-9, 'its floor offset times 100');
    t.ok([60, 40, 120].every((v, i) => Math.abs(metres.camera.position[i] - v) < 1e-3) && [0, 20, 0].every((v, i) => Math.abs(metres.camera.target[i] - v) < 1e-3), `and its camera where it was, in centimetres (${metres.camera.position.map((v) => v.toFixed(1))})`);
    await open({ units: 'cm', presentation: { scale: 1e9, lift: 'x' } });
    const clamped = await page.evaluate(() => window.__bozzetto.getSubjectTransform());
    t.ok(clamped.scale === 1e4 && clamped.lift === 0, `a scale past the limit is clamped, and a lift that is no number is none (${JSON.stringify(clamped)})`);
    await page.unroute('**/timelapses/demo/manifest.json');
  },

  async unitsArmature(page, base, t) {
    await openArmature(page, base);
    // The mannequins at their files' own heights, soles on the floor at 0.
    const heights = {
      'mannequin-male-realistic': 169,
      'mannequin-male-stylized': 178,
      'mannequin-female-realistic': 164,
      'mannequin-female-stylized': 162,
    };
    for (const [id, cm] of Object.entries(heights)) {
      await page.evaluate((f) => window.__armature.figure(f), id);
      const got = await page.evaluate(() => {
        const a = window.__armature.armature;
        return {
          height: a.figureHeight(),
          soles: a.bounds().min.y,
          floor: window.__bozzetto.lockedFloor(),
          text: document.querySelector('.armature-panel__height')?.textContent ?? '',
        };
      });
      t.near(got.height, cm, 1, `${id}: ${cm} cm tall, within a centimetre`);
      t.ok(Math.abs(got.soles) < 1 && Math.abs(got.floor) < 1, `${id}: soles on the floor at 0 (${got.soles.toFixed(2)} cm)`);
      t.ok(/^Height \d+(\.\d)? cm$/.test(got.text), `${id}: the Armature panel says so (${got.text})`);
    }
    await page.evaluate(() => window.__armature.figure('mannequin-male-realistic'));
    // The Floor offset, in the Armature panel, saved with the armature.
    await page.evaluate(() => {
      const panel = document.querySelector('.panel--armature');
      if (panel.classList.contains('panel--collapsed')) panel.querySelector('.panel__handle').click();
    });
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.panel--armature label.compact')].map((l) => l.firstElementChild?.textContent),
    );
    t.ok(rows.includes('Floor offset'), 'the Armature panel has a Floor offset');
    await page.evaluate(() => window.__bozzetto.setFloorOffset(2));
    const file = await page.evaluate(() => window.__armature.file());
    t.eq(file.units, 'cm', 'the armature record carries the marker');
    t.near(file.look.presentation.floorOffset, 2, 1e-9, 'and the offset with its look');
    await page.evaluate(() => window.__bozzetto.setFloorOffset(0));

    // A record from before real units: on the old 50 units a metre (2 cm
    // a unit), read through, so the figure stands where it stood; and one
    // from when a unit was a metre, times 100.
    for (const [what, k, units] of [
      ['from before real units', 0.5, undefined],
      ['in metres', 0.01, 'm'],
    ]) {
      const old = await page.evaluate(
        async ({ k, units }) => {
          const a = window.__armature;
          const rec = JSON.parse(await a.pack());
          if (units) rec.units = units;
          else delete rec.units;
          rec.state.root.position = rec.state.root.position.map((v) => v * k);
          if (rec.state.pins) for (const p of Object.keys(rec.state.pins)) rec.state.pins[p] = rec.state.pins[p].map((v) => v * k);
          const was = a.armature.serialize().root.position;
          await a.open(new File([JSON.stringify(rec)], 'old.armature'));
          return { was, now: a.armature.serialize().root.position, units: a.file().units };
        },
        { k, units },
      );
      t.ok(old.now.every((v, i) => Math.abs(v - old.was[i]) < 1e-2) && old.units === 'cm', `an .armature ${what} opens where it was, in centimetres (root ${old.now.map((v) => v.toFixed(2)).join(', ')}, ${old.units})`);
    }

    // Send to Sculpt keeps the feet on the floor.
    await page.evaluate(() => window.__armature.save());
    await Promise.all([
      page.waitForURL(/handoff=1|sculpt=1/, { timeout: 60_000 }),
      page.evaluate(() => window.__armature.send(64)),
    ]);
    await page.waitForFunction(() => !!window.__sculpt && window.__sculpt.session.getMeshes().some((m) => window.__sculpt.session.getMeshName(m) === 'Figure'), null, { timeout: 120_000 });
    const sent = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const fig = session.getMeshes().find((m) => session.getMeshName(m) === 'Figure');
      return { box: window.__sculpt.worldBox(fig), units: session.getUnits(), floor: window.__sculpt.viewer.floorHeight() };
    });
    t.eq(sent.units, 'cm', 'the figure arrives in a scene on real units');
    t.near(sent.box.max[1] - sent.box.min[1], 169.4, 4, `at its own height (${(sent.box.max[1] - sent.box.min[1]).toFixed(1)} cm)`);
    t.ok(Math.abs(sent.box.min[1] - sent.floor) < 3, `with its feet on the floor (soles at ${sent.box.min[1].toFixed(2)} cm, floor at ${sent.floor})`);
  },
};
