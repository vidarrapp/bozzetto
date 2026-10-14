// The units suite (owner decision: one world unit is a metre, the
// interface speaks centimetres, and the floor is fixed at 0). A new scene
// carries the marker and shows its sizes in centimetres; the floor stays
// at 0 whatever the scene does, its offset is saved with the look and the
// file and comes back; new objects stand on it. A scene from before real
// units - an autosave, a .bozz file - opens as it was, with the floor that
// follows it, and Set scale puts it on real units. A project without the
// marker plays in the viewer as it did, one with it on the fixed floor.
// The mannequins stand at their files' own heights, and Send to Sculpt
// keeps the figure's feet on the floor. Each gets (page, base, t).
import { openArmature, openSculpt } from './lib.mjs';

/** The active object's exact world box, {min, max} in metres. */
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
    t.eq(fresh.units, 'm', 'a new scene is on real units');
    t.eq(fresh.record, 'm', 'and its record carries the marker');
    let box = await activeBox(page);
    t.near(box.max[1] - box.min[1], 0.25, 5e-4, 'the default sphere is 25 cm tall');
    t.near(box.min[1], 0, 1e-5, 'and stands on the floor');
    const sizeLine = await page.evaluate(() => document.querySelector('.panel--scene .outliner__size')?.textContent ?? '');
    t.eq(sizeLine, 'Size 25 × 25 × 25 cm', 'the Scene panel gives its size in centimetres');
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
    t.ok(Math.abs(f.groundY) < 1e-4, `the ground is drawn at 0 (${f.groundY})`);
    t.ok(f.span * 0.36 >= 3 - 1e-6, `its disc reaches several metres (${(f.span * 0.36).toFixed(2)} m radius)`);
    // A tall object far from the origin, framed, moves nothing.
    await page.evaluate(() => {
      const { session, viewer } = window.__sculpt;
      const m = session.addPrimitive('cylinder');
      const mat = m.getMatrix();
      mat[12] = 3;
      mat[13] = 2;
      for (const i of [0, 5, 10]) mat[i] *= 8;
      session.onActiveMeshChange?.();
      const b = m.computeWorldBound();
      const v = (x, y, z) => viewer.camera.position.clone().set(x, y, z);
      viewer.frameBounds(viewer.subjectBox.clone().set(v(b[0], b[1], b[2]), v(b[3], b[4], b[5])));
    });
    f = await floorState(page);
    t.ok(f.locked === 0 && Math.abs(f.groundY) < 1e-4, `nor does framing a tall object off to one side (ground at ${f.groundY})`);
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
    t.ok(wide.span > f.span && Math.abs(wide.y) < 1e-4 && wide.x === 0, `dollied out, the floor's fade reaches further (${(wide.span * 0.36).toFixed(1)} m) and the floor stays put`);
    await page.evaluate(() => window.__sculpt.session.undo());

    // --- the Floor offset: in the Scene panel, saved with the look -------------
    await openScenePanel(page);
    await typeInto(page, SCENE_FLOOR, '10');
    f = await floorState(page);
    t.near(f.offset, 0.1, 1e-9, 'typing 10 cm into Floor offset raises the floor by 10 cm');
    t.ok(Math.abs(f.groundY - 0.1) < 1e-4, `and the ground with it (${f.groundY})`);
    const placed = await page.evaluate(() => window.__sculpt.worldBox(window.__sculpt.session.addPrimitive('cube')));
    t.near(placed.min[1], 0.1, 1e-5, 'a new object stands on the raised floor');
    t.near(placed.max[1] - placed.min[1], 0.25, 5e-4, 'at its real size (25 cm cube)');
    const filed = await page.evaluate(async () => {
      const bytes = await window.__sculpt.file.pack();
      const rec = await window.__sculpt.file.unpack(bytes);
      return { units: rec.units, offset: rec.look?.presentation?.floorOffset };
    });
    t.eq(filed.units, 'm', 'a saved .bozz carries the marker');
    t.near(filed.offset ?? NaN, 0.1, 1e-9, 'and the floor offset with its look');
    // The look is stored a moment after a panel change; then a reload.
    await page.waitForTimeout(900);
    await page.evaluate(() => window.__sculpt.persist.flush());
    await openSculpt(page, base);
    f = await floorState(page);
    t.near(f.offset, 0.1, 1e-9, 'the floor offset comes back with the session');
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
    t.near(brush.unit, 0.0002, 1e-12, 'its slider steps a fifth of a millimetre on real units');
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
    await plantLegacyAutosave(page, 200);
    await openSculpt(page, base);
    const legacy = await page.evaluate(() => ({
      units: window.__sculpt.session.getUnits(),
      banner: !document.querySelector('.scale-banner')?.hidden,
      locked: window.__sculpt.viewer.lockedFloor(),
      size: document.querySelector('.panel--scene .outliner__size')?.textContent ?? '',
    }));
    box = await activeBox(page);
    t.eq(legacy.units, null, 'an autosave without the marker opens as a scene from before real units');
    t.near(box.max[1] - box.min[1], 50, 0.1, 'exactly as it was (the sphere 50 units tall)');
    t.eq(legacy.locked, null, 'with the floor that follows its subject');
    t.ok(legacy.banner, 'and the Set scale banner');
    t.ok(/units$/.test(legacy.size), `its sizes in its own units (${legacy.size})`);
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
    t.eq(scaled.units, 'm', 'Set scale puts it on real units');
    t.near(box.max[1] - box.min[1], 0.25, 1e-4, 'the sphere is the 25 cm typed');
    t.near(box.min[1], 0, 1e-5, 'standing on the floor');
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
    t.eq(kept, 'm', 'the autosave is marked from then on');

    // Dismissed, the offer does not come back for that scene.
    await plantLegacyAutosave(page, 200);
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
    t.near(cubeTall.max[1] - cubeTall.min[1], 0.4, 1e-4, 'Set scale on the cube makes it the 40 cm asked for');
    const sphereNow = await page.evaluate(() => {
      const { session } = window.__sculpt;
      return window.__sculpt.worldBox(session.getMeshes().find((m) => session.getMeshName(m) === 'Sphere'));
    });
    t.near(sphereNow.max[1] - sphereNow.min[1], 0.4, 1e-3, 'and the sphere in the same proportion');
    t.near(Math.min(sphereNow.min[1], cubeTall.min[1]), 0, 1e-5, 'the scene set on the floor');
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
    await open({ units: 'm', presentation: { ground: 'floor', floorOffset: 0.05 } });
    f = await floorState(page);
    t.eq(f.locked, 0, 'one marked in metres stands on the fixed floor');
    t.near(f.height, 0.05, 1e-9, 'raised by its presentation\'s offset');
    t.ok(Math.abs(f.groundY - 0.05) < 1e-4, `where the ground is drawn (${f.groundY})`);
    const look = await page.evaluate(() => window.__bozzetto.getLook().presentation.floorOffset);
    t.near(look, 0.05, 1e-9, 'and its look keeps the offset to save');
    // Set scale's record (the editor's, for a project from before): every frame played by one factor, lifted.
    await open({ units: 'm', presentation: { ground: 'floor', floorOffset: 0, scale: 0.25, lift: 0.1 } });
    const played = await page.evaluate(() => {
      const v = window.__bozzetto;
      const l = v.frameLocalBounds();
      return { local: [l.min.y, l.max.y], world: [v.subjectBox.min.y, v.subjectBox.max.y], kept: v.getLook().presentation };
    });
    t.ok(
      Math.abs(played.world[0] - (played.local[0] * 0.25 + 0.1)) < 1e-6 && Math.abs(played.world[1] - (played.local[1] * 0.25 + 0.1)) < 1e-6,
      `presentation.scale and lift play the frames at that size and height (${played.local.map((x) => x.toFixed(3))} -> ${played.world.map((x) => x.toFixed(3))})`,
    );
    t.ok(played.kept.scale === 0.25 && played.kept.lift === 0.1, 'and the look keeps them to save');
    await open({ units: 'm', presentation: { scale: 1e9, lift: 'x' } });
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
          height: a.figureHeight() * 100,
          soles: a.bounds().min.y,
          floor: window.__bozzetto.lockedFloor(),
          text: document.querySelector('.armature-panel__height')?.textContent ?? '',
        };
      });
      t.near(got.height, cm, 1, `${id}: ${cm} cm tall, within a centimetre`);
      t.ok(Math.abs(got.soles) < 0.01 && Math.abs(got.floor) < 0.01, `${id}: soles on the floor at 0 (${got.soles.toFixed(4)} m)`);
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
    await page.evaluate(() => window.__bozzetto.setFloorOffset(0.02));
    const file = await page.evaluate(() => window.__armature.file());
    t.eq(file.units, 'm', 'the armature record carries the marker');
    t.near(file.look.presentation.floorOffset, 0.02, 1e-9, 'and the offset with its look');
    await page.evaluate(() => window.__bozzetto.setFloorOffset(0));

    // A record from before real units: on the old 50 units a metre, read
    // through, so the figure stands where it stood.
    const legacy = await page.evaluate(async () => {
      const a = window.__armature;
      const rec = JSON.parse(await a.pack());
      delete rec.units;
      rec.state.root.position = rec.state.root.position.map((v) => v * 50);
      if (rec.state.pins) for (const k of Object.keys(rec.state.pins)) rec.state.pins[k] = rec.state.pins[k].map((v) => v * 50);
      const was = a.armature.serialize().root.position;
      await a.open(new File([JSON.stringify(rec)], 'old.armature'));
      return { was, now: a.armature.serialize().root.position };
    });
    t.ok(legacy.now.every((v, i) => Math.abs(v - legacy.was[i]) < 1e-4), `an .armature from before real units opens where it was (root ${legacy.now.map((v) => v.toFixed(3)).join(', ')})`);

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
    t.eq(sent.units, 'm', 'the figure arrives in a scene on real units');
    t.near(sent.box.max[1] - sent.box.min[1], 1.694, 0.04, `at its own height (${(sent.box.max[1] - sent.box.min[1]).toFixed(3)} m)`);
    t.ok(Math.abs(sent.box.min[1] - sent.floor) < 0.03, `with its feet on the floor (soles at ${sent.box.min[1].toFixed(3)} m, floor at ${sent.floor})`);
  },
};
