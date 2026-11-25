// The armature as a thing in the scene: its name, an eye, a material (the Sculpt page, 0.7.17).
//
// armatureScene:
// - the Scene row is named for the mannequin (the label the Armature tab's Preset select shows),
//   not the scene, and follows a change of preset;
// - the eye on the row hides the mannequin in Sculpt, Paint and Present (the viewer's pixels where
//   it stood), a press there asks nothing, it casts no shadow, and showing it brings it back; in
//   Armature it always shows;
// - the Material tab's Surface section edits the mannequin's Albedo, Roughness and Metalness in
//   Armature (the pixels change), in Sculpt with no object selected and after a tap on the row,
//   and leaves an object's values alone;
// - Remesh to a figure gives the figure the mannequin's material;
// - the eye and the material come back after a reload, and a record from before has neither.
import { mkdirSync } from 'node:fs';
import { openSculpt } from './lib.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/armscene';
const KEYS = { Armature: 'Shift+1', Sculpt: 'Shift+2', Paint: 'Shift+3', Present: 'Shift+4' };

const waitHere = (page, name) =>
  page.waitForFunction((n) => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === n, name, { timeout: 20_000 });
const armatureUp = (page) =>
  page.waitForFunction(() => !!window.__armature && !window.__armature.isSuspended() && !document.querySelector('.sculpt-toast[data-state="running"]'), null, { timeout: 60_000 });
async function goKey(page, name) {
  await page.keyboard.press(KEYS[name]);
  await waitHere(page, name);
  if (name === 'Armature') await armatureUp(page);
  await page.waitForTimeout(150);
}
const setPanel = (page, id, open) => page.evaluate(([i, o]) => window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id: i, open: o } })), [id, open]);
const asking = (page) => page.evaluate(() => !!document.querySelector('.bz-ask'));
const show = (o) => JSON.stringify(o);
const row = (page) =>
  page.evaluate(() => {
    const r = document.querySelector('.panel--scene [data-role="armature-row"]');
    if (!r) return null;
    const eye = r.querySelector('[data-role="armature-eye"]');
    return {
      name: r.querySelector('.outliner__name')?.textContent,
      bone: !!r.querySelector('i.fi-ss-bone'),
      eye: eye?.querySelector('i')?.className.includes('fi-ss-eye-crossed') ? 'off' : eye ? 'on' : null,
      size: eye ? [eye.getBoundingClientRect().width, eye.getBoundingClientRect().height] : null,
      marked: r.classList.contains('outliner__row--active'),
      objectsMarked: document.querySelectorAll('.panel--scene .outliner__row--active:not([data-role="armature-row"]), .panel--scene .outliner__row--selected').length,
    };
  });

/** A screen point on the mannequin's torso, above anything the scene holds low on the floor. */
const torso = (page) =>
  page.evaluate(() => {
    const { session, worldBox } = window.__sculpt;
    let top = 0;
    for (const m of session.getMeshes()) top = Math.max(top, worldBox(m).max[1]);
    const y = Math.min(150, Math.max(115, top + 25));
    return window.__armature.onScreen(0, y, 0);
  });
/** The mean colour of the viewer's pixels in a small square at a page point, from the next frame drawn. */
const patch = (page, at) =>
  page.evaluate(async ([x, y]) => {
    await window.__bozzetto.whenFramesDrawn(2);
    const src = window.__bozzetto.captureCanvas;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    const r = src.getBoundingClientRect();
    const k = src.width / r.width;
    const px = Math.round((x - r.left) * k);
    const py = Math.round((y - r.top) * k);
    const d = ctx.getImageData(px - 5, py - 5, 11, 11).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) sum[j] += d[i + j];
    return sum.map((v) => Math.round(v / (d.length / 4)));
  }, at);
const apart = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
async function stroke(page, [x, y]) {
  await page.mouse.move(x - 4, y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 16, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}
const meshSum = (page) =>
  page.evaluate(() => {
    const m = window.__sculpt.session.getMesh();
    if (!m) return 0;
    const v = m.getVertices();
    let s = 0;
    for (let i = 0; i < m.getNbVertices() * 3; i++) s += v[i] * (1 + (i % 7));
    return Math.round(s * 1000) / 1000;
  });
/** The Surface section: its rows by label, and the Material row's value. */
const surfaceNow = (page) =>
  page.evaluate(() => {
    const s = [...document.querySelectorAll('.panel--material .section')].find((x) => x.querySelector('h3').textContent === 'Surface');
    if (!s || s.hidden) return null;
    return {
      note: [...s.querySelectorAll('.muted')].find((n) => !n.hidden)?.textContent ?? null,
      rowsShown: !!s.querySelector('.cpick__swatch')?.offsetParent,
      material: s.querySelector('[data-role="material-name"] .readout')?.textContent ?? null,
    };
  });
const sliderSet = (page, label, v) =>
  page.evaluate(([l, val]) => {
    const row = [...document.querySelectorAll('.panel--material label.compact')].find((x) => x.firstElementChild?.textContent === l);
    const input = row.querySelector('input[type=range]');
    input.value = String(val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [label, v]);
async function pickAlbedo(page, fx, fy) {
  await page.click('.panel--material .cpick__swatch');
  const field = await page.evaluate(([x, y]) => {
    const r = document.querySelector('.cpick__pop:not([hidden]) .cpick__field')?.getBoundingClientRect();
    return r ? { x: r.left + r.width * x, y: r.top + r.height * y } : null;
  }, [fx, fy]);
  await page.mouse.move(field.x, field.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.mouse.click(1030, 85); // the panel's heading: the picker closes
  await page.waitForTimeout(200);
}
const mannequin = (page) => page.evaluate(() => window.__sculpt.armature.surface());
const library = (page) => page.evaluate(() => window.__sculpt.library.list().map((m) => [m.albedo, m.roughness, m.metalness].join()).join('|'));
/** The kept armature record on the device, as read, and as written back. */
const record = (page, strip) =>
  page.evaluate(
    (drop) =>
      new Promise((ok, fail) => {
        const r = indexedDB.open('bozzetto-sculpt');
        r.onerror = () => fail(r.error);
        r.onsuccess = () => {
          const tx = r.result.transaction('scene', drop ? 'readwrite' : 'readonly');
          const store = tx.objectStore('scene');
          const get = store.get('currentArmature');
          get.onsuccess = () => {
            const rec = get.result;
            const had = rec?.mannequin ? JSON.stringify(rec.mannequin) : null;
            if (drop && rec) {
              delete rec.mannequin;
              store.put(rec, 'currentArmature');
            }
            tx.oncomplete = () => ok({ has: !!rec, mannequin: had });
          };
          tx.onerror = () => fail(tx.error);
        };
      }),
    !!strip,
  );

export const suites = {
  async armatureScene(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.addInitScript(() => {
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('bz.panels.')) localStorage.removeItem(k);
      } catch {
        // none
      }
    });
    await openSculpt(page, base);
    await goKey(page, 'Armature');
    await page.waitForTimeout(500);
    await goKey(page, 'Sculpt');
    await setPanel(page, 'scene', true);
    await page.waitForTimeout(300);

    // --- 1. the name ---------------------------------------------------------------------------
    const presetText = () => page.evaluate(() => document.querySelector('.panel--armature select').selectedOptions[0].textContent);
    let r = await row(page);
    const sceneName = await page.evaluate(() => window.__sculpt.armature.name());
    t.ok(r && r.name === (await presetText()) && r.name !== sceneName, `the row is named for the mannequin ("${r?.name}"), not the scene ("${sceneName}")`);
    await goKey(page, 'Armature');
    await page.evaluate(() => window.__armature.figure('mannequin-female-realistic'));
    await page.waitForTimeout(500);
    await goKey(page, 'Sculpt');
    r = await row(page);
    t.eq(r?.name, 'Female, realistic', 'and follows a change of preset');
    t.eq(r?.name, await presetText(), 'as the Preset select reads');
    t.ok(r.bone && r.eye === 'on' && r.size[0] >= 26 && r.size[1] >= 26, `the row has the bone mark and an eye as an object's (${show(r.size)})`);
    t.eq(await page.evaluate(() => document.querySelectorAll('.panel--scene [data-role="armature-row"] button').length), 1, 'with no lock, material or delete beside it');
    await page.screenshot({ path: `${SHOTS}/scene-row.png` });

    // --- 2. the eye ----------------------------------------------------------------------------
    const at = await torso(page);
    const shown = await patch(page, at);
    await page.click('.panel--scene [data-role="armature-eye"]');
    await page.waitForTimeout(300);
    r = await row(page);
    t.eq(r.eye, 'off', 'the eye shows hidden after a tap');
    const hidden = await patch(page, at);
    t.ok(apart(shown, hidden) > 40, `Sculpt: the mannequin is gone from the pixels where it stood (${shown} to ${hidden})`);
    t.eq(await page.evaluate(() => window.__sculpt.armature.shadowBox({})), false, 'it leaves the stage fit and the shadows');
    const sum = await meshSum(page);
    await stroke(page, at);
    t.ok(!(await asking(page)) && (await meshSum(page)) === sum, 'a press where it stood asks nothing');
    await page.screenshot({ path: `${SHOTS}/sculpt-hidden.png` });
    await goKey(page, 'Paint');
    t.ok(apart(await patch(page, at), hidden) < 25, 'Paint: still hidden');
    await goKey(page, 'Present');
    t.ok(apart(await patch(page, at), hidden) < 25, 'Present: still hidden');
    await goKey(page, 'Armature');
    t.ok(await page.evaluate(() => !!window.__bozzetto.scene.getObjectByName('armature')?.visible), 'Armature: the mannequin shows whatever the eye says');
    await goKey(page, 'Sculpt');
    await page.click('.panel--scene [data-role="armature-eye"]');
    await page.waitForTimeout(300);
    t.ok(apart(await patch(page, at), shown) < 25, 'the eye again brings it back');
    await stroke(page, at);
    t.ok(await asking(page), 'and a press on it asks about a remesh again');
    await page.click('.bz-ask-cancel');
    await page.waitForTimeout(200);

    // --- 3. the material: in Armature -------------------------------------------------------------
    await goKey(page, 'Armature');
    await setPanel(page, 'material', true);
    await page.waitForTimeout(400);
    const libBefore = await library(page);
    const objBefore = await page.evaluate(() => JSON.stringify(window.__sculpt.viewer.display.userData.albedo));
    const sec = await page.evaluate(() => {
      const s = [...document.querySelectorAll('.panel--material .section')].filter((x) => !x.hidden).map((x) => x.querySelector('h3').textContent);
      const surface = [...document.querySelectorAll('.panel--material .section')].find((x) => x.querySelector('h3').textContent === 'Surface');
      return { s, rows: [...surface.querySelectorAll('.label-row > span:first-child, label.compact > :first-child')].map((e) => e.textContent), who: surface.querySelector('[data-role="material-name"] .readout')?.textContent };
    });
    t.ok(sec.s[0] === 'Surface' && sec.rows.join() === 'Material,Albedo,Roughness,Metalness' && sec.who === 'Armature', `Armature: the Material tab has the Surface section, saying whose it is (${show(sec)})`);
    const armAt = await page.evaluate(() => window.__armature.onScreen(0, 130, 0));
    const p0 = await patch(page, armAt);
    const own0 = await mannequin(page);
    await pickAlbedo(page, 0.9, 0.15);
    const own1 = await mannequin(page);
    const p1 = await patch(page, armAt);
    t.ok(own1.albedo !== own0.albedo && apart(p0, p1) > 20, `Albedo: the mannequin's changes (${own0.albedo} to ${own1.albedo}), and its pixels (${p0} to ${p1})`);
    await sliderSet(page, 'Roughness', 0.05);
    await sliderSet(page, 'Metalness', 0.9);
    await page.waitForTimeout(200);
    const own2 = await mannequin(page);
    const p2 = await patch(page, armAt);
    t.ok(own2.roughness === 0.05 && own2.metalness === 0.9 && apart(p1, p2) > 3, `Roughness and Metalness change it too (${show(own2)}; pixels ${p1} to ${p2})`);
    t.ok((await library(page)) === libBefore && (await page.evaluate(() => JSON.stringify(window.__sculpt.viewer.display.userData.albedo))) === objBefore, "and an object's own values are untouched");
    await page.screenshot({ path: `${SHOTS}/armature-surface.png` });

    // --- 4. in Sculpt: the row, then no object ---------------------------------------------------------
    await goKey(page, 'Sculpt');
    await page.waitForTimeout(200);
    const objName = await page.evaluate(() => window.__sculpt.library.materialFor(window.__sculpt.session.getMesh()).name);
    let s = await surfaceNow(page);
    t.eq(s?.material, objName, `Sculpt with an object selected: the Surface is the object's (${objName})`);
    await page.click('.panel--scene [data-role="armature-row"] .outliner__name');
    await page.waitForTimeout(300);
    r = await row(page);
    s = await surfaceNow(page);
    t.ok(r.marked && r.objectsMarked === 0 && s?.material === 'Armature', `a tap on the row marks it, takes the mark off the object, and the Surface is the mannequin's (${show(r)} ${show(s)})`);
    await sliderSet(page, 'Roughness', 0.7);
    await page.waitForTimeout(200);
    t.ok((await mannequin(page)).roughness === 0.7 && (await library(page)) === libBefore, "Roughness there edits the mannequin and not the object's material");
    await page.screenshot({ path: `${SHOTS}/sculpt-row-surface.png` });
    await page.click('.panel--scene .outliner__row:not([data-role="armature-row"]) .outliner__name');
    await page.waitForTimeout(300);
    r = await row(page);
    s = await surfaceNow(page);
    t.ok(!r.marked && r.objectsMarked === 1 && s?.material === objName, "a tap on the object's row gives it back");

    // --- 5. Remesh to a figure takes the material --------------------------------------------------------
    await page.evaluate(() => (window.__sculpt.figure.settings().resolution = 48));
    await goKey(page, 'Armature');
    await setPanel(page, 'armature', true);
    await page.waitForTimeout(300);
    const before = await mannequin(page);
    await page.evaluate(() => document.querySelector('.panel--armature [data-role="remesh-figure"]').click());
    await page.waitForFunction(() => window.__sculpt.session.getMeshes().some((m) => window.__sculpt.session.getMeshName(m) === 'Figure'), null, { timeout: 120_000 });
    await page.waitForTimeout(300);
    const fig = await page.evaluate(() => {
      const { session, library: lib } = window.__sculpt;
      const m = lib.materialFor(session.getMeshes().find((x) => session.getMeshName(x) === 'Figure'));
      return { albedo: m.albedo, roughness: m.roughness, metalness: m.metalness };
    });
    t.eq(show(fig), show(before), `the new figure has the mannequin's material (${show(fig)})`);
    await goKey(page, 'Sculpt');
    await page.evaluate(() => window.__sculpt.session.undo());
    await page.waitForTimeout(400);
    t.ok(await page.evaluate(() => !!window.__bozzetto.scene.getObjectByName('armature')?.visible), 'undoing it brings the mannequin back');

    // --- no object: the mannequin's material -----------------------------------------------------
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      for (const m of [...session.getMeshes()]) session.deleteMesh(m);
    });
    await page.waitForTimeout(400);
    s = await surfaceNow(page);
    t.ok(s?.material === 'Armature' && s.rowsShown, `Sculpt with no object selected: the Surface is the mannequin's (${show(s)})`);
    const at2 = await torso(page);
    const q0 = await patch(page, at2);
    await setPanel(page, 'material', true);
    await page.waitForTimeout(300);
    await pickAlbedo(page, 0.1, 0.9);
    const q1 = await patch(page, at2);
    t.ok(apart(q0, q1) > 20, `its Albedo changes the pixels (${q0} to ${q1})`);
    await setPanel(page, 'material', true);
    await page.screenshot({ path: `${SHOTS}/sculpt-no-object-surface.png` });
    await page.evaluate(() => window.__sculpt.session.undo());
    await page.waitForTimeout(300);

    // --- 6. kept on the device, and an old record -------------------------------------------------------
    await goKey(page, 'Sculpt');
    await page.click('.panel--scene [data-role="armature-eye"]');
    await page.waitForTimeout(300);
    const kept = await mannequin(page);
    t.eq((await row(page))?.eye, 'off', 'the eye is turned off again before the reload');
    await page.waitForTimeout(1200);
    const rec = await record(page, false);
    t.ok(rec.has && !!rec.mannequin, `the record on the device holds the eye and the material (${rec.mannequin})`);
    await openSculpt(page, base);
    await goKey(page, 'Armature');
    await page.waitForTimeout(400);
    await goKey(page, 'Sculpt');
    await setPanel(page, 'scene', true);
    await page.waitForTimeout(300);
    const reloaded = { row: await row(page), own: await mannequin(page) };
    t.ok(reloaded.row?.eye === 'off' && show(reloaded.own) === show(kept), `after a reload the eye is off and the material is as it was left (${show(reloaded)}; was ${show(kept)})`);
    await record(page, true);
    await openSculpt(page, base);
    await goKey(page, 'Armature');
    await page.waitForTimeout(400);
    await goKey(page, 'Sculpt');
    await setPanel(page, 'scene', true);
    await page.waitForTimeout(300);
    const def = await page.evaluate(() => {
      const m = window.__sculpt.library.list()[0];
      return { albedo: m.albedo, roughness: m.roughness, metalness: m.metalness };
    });
    t.ok((await row(page))?.eye === 'on' && show(await mannequin(page)) === show(def), `an old record with neither loads shown, with the scene's default material (${show(def)})`);
    t.eq(errors.length, 0, `no page errors (${errors.join('; ')})`);
  },
};
