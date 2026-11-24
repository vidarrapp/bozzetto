// Armature as a workspace of the Sculpt page (docs/plans/armature-workspace.md, step C, first half).
//
// armatureInPage:
// - Sculpt's start loads neither Armature's code nor a mannequin file (requests counted), and the
//   Model tab has no Figure section until the scene has an armature;
// - the four workspaces from each other by key and by the path, every pair: no question, no page
//   load, the path and the body say where it is;
// - pose, selection and panels kept through a round trip;
// - the posed mannequin drawn in Sculpt, Paint and Present before a figure and gone after it, with
//   its handles only in Armature; the Scene tab lists it as a row of its own, with none of an
//   object's controls;
// - a stroke on the mannequin asks once, Cancel leaves it as it was, nothing is sculpted;
// - Remesh to a figure from the question, from the Armature tab and from the Model tab: each makes
//   one figure in one undo step, undoing it brings the mannequin back, again adds "Figure 2";
// - the working view's settings are the same in Sculpt and Armature apart from the floor;
// - a switch builds nothing after the first round;
// - ?armature=1 with template= and project= opens that armature on the page, and a picture on
//   the old Armature board arrives on the page's board once.
import { mkdirSync } from 'node:fs';
import { openArmature, openSculpt } from './lib.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/armature-in-page';

const KEYS = { Armature: 'Shift+1', Sculpt: 'Shift+2', Paint: 'Shift+3', Present: 'Shift+4' };
const NAMES = Object.keys(KEYS);

const here = (page) => page.evaluate(() => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent ?? null);
const waitHere = (page, name) =>
  page.waitForFunction((n) => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === n, name, { timeout: 20_000 });
/** The armature has loaded (its handle exists) and is not put away. */
const armatureUp = (page) =>
  page.waitForFunction(() => !!window.__armature && !window.__armature.isSuspended() && !document.querySelector('.sculpt-toast[data-state="running"]'), null, { timeout: 60_000 });

async function goKey(page, name) {
  await page.keyboard.press(KEYS[name]);
  await waitHere(page, name);
  if (name === 'Armature') await armatureUp(page);
  await page.waitForTimeout(120);
}

async function goPath(page, name) {
  await page.evaluate((n) => [...document.querySelectorAll('.bz-ws__step')].find((b) => b.textContent === n)?.click(), name);
  await waitHere(page, name);
  if (name === 'Armature') await armatureUp(page);
  await page.waitForTimeout(120);
}

const asking = (page) => page.evaluate(() => !!document.querySelector('.bz-ask'));
const counters = (page) => page.evaluate(() => window.__bozzetto.renderCounters());
const grew = (a, b) => Object.fromEntries(Object.keys(a).filter((k) => b[k] !== a[k]).map((k) => [k, b[k] - a[k]]));
const show = (o) => JSON.stringify(o);
const names = (page) => page.evaluate(() => window.__sculpt.session.getMeshes().map((m) => window.__sculpt.session.getMeshName(m)));
const setPanel = (page, id, open) => page.evaluate(([i, o]) => window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id: i, open: o } })), [id, open]);
const panelOpen = (page, id) => page.evaluate((i) => { const p = document.querySelector(`.panel--${i}`); return !!p && !p.classList.contains('panel--collapsed'); }, id);

/** What of the mannequin is drawn: the figure, its handles, and whether the page lists it. */
const drawn = (page) =>
  page.evaluate(() => {
    const deep = (o) => {
      for (let p = o; p; p = p.parent) if (!p.visible) return false;
      return !!o;
    };
    const scene = window.__bozzetto.scene;
    const mesh = scene.getObjectByName('armature');
    return { figure: !!mesh && deep(mesh), handles: deep(scene.getObjectByName('ik-handles')), gizmos: scene.children.filter((c) => c.isTransformControlsRoot).some(deep) };
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

/** A press, a drag and a release on the view at a page point. */
async function stroke(page, [x, y]) {
  await page.mouse.move(x - 4, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 16, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

const meshSum = (page) =>
  page.evaluate(() => {
    const m = window.__sculpt.session.getMesh();
    const v = m.getVertices();
    let s = 0;
    for (let i = 0; i < m.getNbVertices() * 3; i++) s += v[i] * (1 + (i % 7));
    return Math.round(s * 1000) / 1000;
  });

/** Everything the working view is made of, read back: the same in Sculpt and Armature but the floor (the camera is the person's, and the AO radius follows the stage's fit; AO is off). */
const viewSettings = (page) =>
  page.evaluate(() => {
    const v = window.__bozzetto;
    const bare = (o) => JSON.parse(JSON.stringify(o, (k, x) => (k === 'ground' || k === 'floorOffset' || k === 'camera' || k === 'radius' ? undefined : x)));
    return {
      lights: bare(v.lighting.serialize()),
      shadowsMaster: v.lighting.getShadowsMaster(),
      keyOnly: v.lighting.keyOnlyShadows,
      ao: bare(v.getAOState()),
      dof: bare(v.getDoFState()),
      env: v.scene.environment === null,
      material: bare(v.materials.getMaterialState()),
      sculptShading: v.sculptShading,
      antialias: v.getAntialias(),
      tapToFocus: v.tapToFocus,
      fast: v.fastFrames,
      look: bare(v.getLook()),
    };
  });

export const suites = {
  async armatureInPage(page, base, t) {
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
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    const scripts = () => requests.filter((u) => /\.js(\?|$)/.test(u)).length;
    const glbs = () => requests.filter((u) => /\/assets\/armature\/[^/]+\.glb/.test(u)).length;

    // --- Sculpt's start ----------------------------------------------------------------------
    await openSculpt(page, base);
    await page.evaluate(() => {
      window.__marker = 'same page';
    });
    const atStart = { scripts: scripts(), glbs: glbs() };
    const startState = await page.evaluate(() => ({ armature: !!window.__armature, mannequin: !!window.__bozzetto.scene.getObjectByName('armature'), figureSection: [...document.querySelectorAll('.panel--model .section h3')].map((h) => h.textContent).includes('Figure') && !document.querySelector('.panel--model [data-role="figure"]').hidden }));
    t.ok(atStart.glbs === 0 && !startState.armature && !startState.mannequin, `Sculpt's start fetches no mannequin file and has no armature (${atStart.glbs} files, ${atStart.scripts} scripts)`);
    t.ok(!startState.figureSection, "and the Model tab has no Figure section until the scene has an armature");
    t.eq(await page.evaluate(() => [...document.querySelectorAll('.bz-ws__step')].map((b) => b.textContent).join(' > ')), 'Armature > Sculpt > Paint > Present', 'the path is Armature, Sculpt, Paint, Present');

    // --- the first entry: loaded now, the switch not held up ------------------------------------
    await page.keyboard.press('Shift+1');
    await waitHere(page, 'Armature');
    t.ok(!(await asking(page)), 'Shift+1 asks nothing');
    await armatureUp(page);
    await page.waitForTimeout(400);
    const afterEntry = { scripts: scripts(), glbs: glbs() };
    t.ok(afterEntry.scripts > atStart.scripts && afterEntry.glbs >= 1, `the first entry loads Armature's code and a mannequin (${afterEntry.scripts - atStart.scripts} more scripts, ${afterEntry.glbs} mannequin files)`);
    t.eq(await page.evaluate(() => window.__marker), 'same page', 'and it did not change page');
    t.ok(await page.evaluate(() => document.body.classList.contains('armature-ws') && !!document.querySelector('.panel--armature')), 'Armature is in front: its tab is on the page');
    await setPanel(page, 'armature', true);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/armature-in-the-page.png` });
    t.eq(await page.evaluate(() => document.querySelector('.sculpt-toast[data-state="running"]')?.textContent ?? null), null, 'the "Loading Armature…" notice is gone');
    const visible = await page.evaluate(() => {
      const shown = (sel) => [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
      const tabs = [...document.querySelectorAll('.panel > .panel__handle')].filter((h) => h.getClientRects().length > 0 && getComputedStyle(h).visibility !== 'hidden' && getComputedStyle(h.parentElement).display !== 'none').map((h) => h.querySelector('.handle__label')?.textContent).join();
      return { bar: shown('.sculpt-toolbar__brushes'), fields: shown('.bz-edge__fields'), undo: shown('.sculpt-histbtn'), tabs };
    });
    t.ok(!visible.bar && !visible.fields && visible.undo, `Sculpt's tool bar and brush fields are put away, Undo and Redo stay (${show(visible)})`);
    t.ok(/Armature/.test(visible.tabs) && /Material/.test(visible.tabs) && /Reference/.test(visible.tabs) && !/Scene|Model|Layers|Tool/.test(visible.tabs), `the tabs are Armature, Material and Reference (${visible.tabs})`);
    let d = await drawn(page);
    t.ok(d.figure && d.handles, 'in Armature the mannequin is drawn with its handles');
    // The scene's objects stand around it and take no press.
    const around = await page.evaluate(() => ({ objects: window.__sculpt.session.getMeshes().length, shown: window.__sculpt.viewer.isSculptVisible() }));
    t.ok(around.objects >= 1 && around.shown, 'the scene\'s own objects are still drawn around it');

    // --- every pair, by key and by the path -------------------------------------------------------
    let pair = 0;
    const bodyOf = (page) => page.evaluate(() => ({ arm: document.body.classList.contains('armature-ws'), paint: document.body.classList.contains('paint-ws'), present: document.body.classList.contains('presenting') }));
    const bad = [];
    for (const from of NAMES) {
      for (const to of NAMES) {
        if (from === to) continue;
        await (pair % 2 ? goPath : goKey)(page, from);
        await (pair % 2 ? goKey : goPath)(page, to);
        pair++;
        const b = await bodyOf(page);
        const asked = await asking(page);
        const marker = await page.evaluate(() => window.__marker);
        const ok = (await here(page)) === to && !asked && marker === 'same page' && b.arm === (to === 'Armature') && b.paint === (to === 'Paint' || (from === 'Paint' && to === 'Present')) && b.present === (to === 'Present');
        if (!ok) bad.push(`${from}>${to} ${show(b)} ${asked ? 'asked' : ''}`);
      }
    }
    t.ok(bad.length === 0 && pair === 12, `all twelve pairs of the four workspaces, by key and by the path, ask nothing and load no page (${bad.join('; ') || 'ok'})`);

    // --- pose, selection and panels through a round trip ----------------------------------------
    await goKey(page, 'Armature');
    await page.evaluate(() => {
      const a = window.__armature;
      a.armature.symmetry = false;
      a.turn('upperarm.L', -50, 0, 10);
      a.select('upperarm.L');
    });
    await setPanel(page, 'armature', true);
    await page.waitForTimeout(300);
    const kept = await page.evaluate(() => ({ pose: JSON.stringify(window.__armature.state()), selected: window.__armature.selected(), gizmo: JSON.stringify(window.__armature.gizmo()), undo: window.__armature.history().undo }));
    await goKey(page, 'Sculpt');
    await goKey(page, 'Present');
    await goKey(page, 'Armature');
    await page.waitForTimeout(200);
    const back = await page.evaluate(() => ({ pose: JSON.stringify(window.__armature.state()), selected: window.__armature.selected(), gizmo: JSON.stringify(window.__armature.gizmo()), undo: window.__armature.history().undo }));
    t.ok(back.pose === kept.pose && back.selected === kept.selected && back.gizmo === kept.gizmo && back.undo === kept.undo, `pose, selection, gizmo and undo steps are as they were left (${back.selected}, ${back.undo} steps)`);
    t.ok(await panelOpen(page, 'armature'), 'and the Armature tab is open again');
    // Armature's own Undo, from the edge column's button, acts on Armature.
    await page.waitForSelector('.sculpt-hist [data-hist="undo"]:not([disabled])', { timeout: 5000 });
    await page.click('.sculpt-hist [data-hist="undo"]');
    await page.waitForTimeout(300);
    t.ok((await page.evaluate(() => window.__armature.history().undo)) === kept.undo - 1, "the edge column's Undo acts on the workspace in front (Armature's own steps)");
    await page.evaluate(() => window.__armature.redo());
    await page.waitForTimeout(200);

    // --- the mannequin in the other workspaces, before a figure --------------------------------------
    for (const name of ['Sculpt', 'Paint', 'Present']) {
      await goKey(page, name);
      d = await drawn(page);
      t.ok(d.figure && !d.handles && !d.gizmos, `${name}: the posed mannequin is drawn, with no handles`);
    }
    await goKey(page, 'Sculpt');
    await page.screenshot({ path: `${SHOTS}/sculpt-mannequin.png` });
    // The Scene tab lists it, as a row of its own.
    await setPanel(page, 'scene', true);
    await page.waitForTimeout(300);
    const row = await page.evaluate(() => {
      const r = document.querySelector('.panel--scene [data-role="armature-row"]');
      if (!r) return null;
      return { icon: !!r.querySelector('i.fi-ss-bone'), buttons: r.querySelectorAll('button, select, input').length, name: r.querySelector('.outliner__name')?.textContent, rows: document.querySelectorAll('.panel--scene .outliner__row').length };
    });
    t.ok(row && row.icon && row.buttons === 0 && row.name === (await page.evaluate(() => window.__sculpt.armature.name())), `the Scene tab lists the armature: its name, its mark, and no eye, lock, material or delete (${show(row)})`);
    await page.screenshot({ path: `${SHOTS}/sculpt-mannequin-scene-row.png` });
    await setPanel(page, 'model', true);
    await page.waitForTimeout(300);
    t.ok(await page.evaluate(() => { const s = document.querySelector('.panel--model [data-role="figure"]'); return !!s && !s.hidden; }), 'the Model tab now has the Figure section');
    await page.screenshot({ path: `${SHOTS}/model-figure-section.png` });
    await setPanel(page, 'model', false);
    await goKey(page, 'Paint');
    t.ok(await page.evaluate(() => !!document.querySelector('.panel--scene [data-role="armature-row"]')), 'Paint lists it too');
    await goKey(page, 'Present');
    await page.screenshot({ path: `${SHOTS}/present-mannequin.png` });
    await goKey(page, 'Sculpt');

    // --- the working view: the same in Sculpt and Armature but the floor ------------------------------
    const inSculpt = await viewSettings(page);
    const sculptGround = await page.evaluate(() => ({ ground: window.__bozzetto.getGround(), locked: window.__bozzetto.lockedFloor() }));
    await goKey(page, 'Armature');
    const inArmature = await viewSettings(page);
    const armGround = await page.evaluate(() => ({ ground: window.__bozzetto.getGround(), locked: window.__bozzetto.lockedFloor() }));
    const differ = Object.keys(inSculpt).filter((k) => show(inSculpt[k]) !== show(inArmature[k]));
    t.ok(differ.length === 0, `the working view is the same in Sculpt and Armature (differs: ${differ.join(', ') || 'nothing'})`);
    t.ok(armGround.ground === 'floor' && Math.abs(armGround.locked) < 1e-6, `apart from the floor: shown and fixed in Armature (${show(armGround)}, Sculpt ${show(sculptGround)})`);
    await goKey(page, 'Sculpt');
    const again = await page.evaluate(() => ({ ground: window.__bozzetto.getGround(), locked: window.__bozzetto.lockedFloor() }));
    t.eq(show(again), show(sculptGround), "and Sculpt's own floor is back on leaving");

    // --- builds on a switch --------------------------------------------------------------------------
    const rounds = [];
    for (const round of [1, 2, 3]) {
      for (const to of ['Armature', 'Present', 'Sculpt', 'Paint', 'Armature', 'Sculpt']) {
        const before = await counters(page);
        await page.keyboard.press(KEYS[to]);
        await waitHere(page, to);
        await page.waitForTimeout(160);
        const g = grew(before, await counters(page));
        if (round === 3 && Object.keys(g).length) rounds.push(`${to}: ${show(g)}`);
      }
    }
    t.ok(rounds.length === 0, `after two rounds of warming no switch builds a node graph, shader, pipeline or texture (${rounds.join('; ') || 'nothing'})`);

    // --- a stroke on the mannequin ---------------------------------------------------------------------
    await goKey(page, 'Sculpt');
    const sumBefore = await meshSum(page);
    const meshesBefore = await names(page);
    let at = await torso(page);
    await stroke(page, at);
    await page.waitForSelector('.bz-ask', { timeout: 5000 });
    const ask = await page.evaluate(() => ({
      title: document.querySelector('.bz-ask h2')?.textContent,
      text: document.querySelector('.bz-ask p')?.textContent,
      buttons: [...document.querySelectorAll('.bz-ask button')].map((b) => b.textContent),
      danger: !!document.querySelector('.bz-ask .btn--danger, .bz-ask .bz-ask-yes.btn--danger'),
    }));
    t.ok(
      ask.title === 'Remesh "Figure" to sculpt it?' &&
        ask.text === 'Sculpting needs a surface of its own. The armature keeps its pose, and you can make another figure from it later.' &&
        ask.buttons.join() === 'Remesh,Cancel' &&
        !ask.danger,
      `a stroke on the mannequin asks (${show(ask)})`,
    );
    await page.screenshot({ path: `${SHOTS}/the-question.png` });
    await page.click('.bz-ask-cancel');
    await page.waitForTimeout(300);
    t.ok(show(await names(page)) === show(meshesBefore) && (await meshSum(page)) === sumBefore && (await drawn(page)).figure, 'Cancel leaves the scene and the mannequin as they were');
    await stroke(page, at);
    await page.waitForTimeout(500);
    t.ok(!(await asking(page)) && (await meshSum(page)) === sumBefore, 'a second stroke on it asks nothing more this visit, and sculpts nothing');
    t.eq(await page.evaluate(() => window.__sculpt.armature.mannequin() !== null), true, 'the mannequin still takes no strokes');

    // --- Remesh to a figure: from the Armature tab --------------------------------------------------
    await goKey(page, 'Armature');
    await setPanel(page, 'armature', true);
    await page.waitForTimeout(300);
    t.ok(await page.evaluate(() => /No figure yet/.test(document.querySelector('.panel--armature [data-role="figure-state"]')?.textContent ?? '')), 'the Figure section of the Armature tab says "No figure yet."');
    const secTitles = await page.evaluate(() => [...document.querySelectorAll('.panel--armature .section h3')].map((h) => h.textContent).join());
    t.ok(/Figure/.test(secTitles) && !/Send to Sculpt/.test(secTitles), `its section is Figure, not Send to Sculpt (${secTitles})`);
    // At the default resolution (120): the time is the measure the report quotes.
    const t0 = Date.now();
    await page.evaluate(() => document.querySelector('.panel--armature [data-role="remesh-figure"]').click());
    await page.waitForFunction(() => window.__sculpt.session.getMeshes().some((m) => window.__sculpt.session.getMeshName(m) === 'Figure'), null, { timeout: 120_000 });
    console.log(`  armatureInPage: Remesh to a figure at the default ${await page.evaluate(() => window.__sculpt.figure.settings().resolution)} took ${Date.now() - t0} ms wall; the notice said "${await page.evaluate(() => [...document.querySelectorAll('.sculpt-toast')].map((e) => e.textContent).join(' | '))}"`);
    await page.waitForTimeout(300);
    t.eq(show(await names(page)), '["Figure"]', 'Remesh from the Armature tab makes one object, named Figure (the untouched sphere makes way)');
    t.ok(await page.evaluate(() => /has been made/.test(document.querySelector('.panel--armature [data-role="figure-state"]')?.textContent ?? '')), 'and the section says "A figure has been made from this armature."');
    d = await drawn(page);
    t.ok(d.figure && d.handles, 'in Armature the mannequin is still there to pose');
    await goKey(page, 'Sculpt');
    d = await drawn(page);
    t.ok(!d.figure, 'in Sculpt it is gone: the figure stands in its place');
    t.ok(await page.evaluate(() => !document.querySelector('.panel--scene [data-role="armature-row"]')), 'and its row is gone from the Scene tab');
    await page.screenshot({ path: `${SHOTS}/sculpt-after-remesh.png` });
    for (const name of ['Paint', 'Present']) {
      await goKey(page, name);
      t.ok(!(await drawn(page)).figure, `${name}: no mannequin either`);
    }
    await goKey(page, 'Sculpt');
    // One undo step: the sphere comes back and so does the mannequin.
    await page.evaluate(() => window.__sculpt.session.undo());
    await page.waitForTimeout(400);
    t.eq(show(await names(page)), '["Sphere"]', 'one undo undoes the whole remesh');
    t.ok((await drawn(page)).figure, 'and the mannequin is back in Sculpt');
    await page.evaluate(() => window.__sculpt.session.redo());
    await page.waitForTimeout(400);
    t.ok(show(await names(page)) === '["Figure"]' && !(await drawn(page)).figure, 'one redo makes the figure again and takes the mannequin away');
    await page.evaluate(() => window.__sculpt.session.undo());
    await page.waitForTimeout(300);

    // --- from the Model tab: with work in the scene it adds one, and a second press adds Figure 2 --------------
    await setPanel(page, 'model', true);
    await page.waitForTimeout(300);
    await page.evaluate(() => (window.__sculpt.figure.settings().resolution = 64));
    await page.evaluate(() => document.querySelector('.panel--model [data-role="remesh-figure"]').click());
    await page.waitForFunction(() => window.__sculpt.session.getMeshes().some((m) => window.__sculpt.session.getMeshName(m) === 'Figure'), null, { timeout: 120_000 });
    await page.waitForTimeout(300);
    t.eq(show(await names(page)), '["Figure"]', 'Remesh from the Model tab makes the figure too');
    await page.evaluate(() => window.__sculpt.session.undo());
    await page.waitForTimeout(300);
    t.eq(show(await names(page)), '["Sphere"]', 'in one undo step');
    // Work in the scene: the sphere is kept and the figure is added beside it.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.setMeshName?.(session.getMesh(), 'Ball');
    });
    await page.evaluate(() => window.__sculpt.session.addSphere());
    await page.waitForTimeout(200);
    const before2 = await names(page);
    await page.evaluate(() => document.querySelector('.panel--model [data-role="remesh-figure"]').click());
    await page.waitForFunction((n) => window.__sculpt.session.getMeshes().length === n + 1, before2.length, { timeout: 120_000 });
    await page.waitForTimeout(300);
    const after2 = await names(page);
    t.ok(after2.length === before2.length + 1 && after2.includes('Figure'), `a scene with work keeps its objects and gains the figure (${after2.join(', ')})`);
    await page.evaluate(() => document.querySelector('.panel--model [data-role="remesh-figure"]').click());
    await page.waitForFunction((n) => window.__sculpt.session.getMeshes().length === n + 2, before2.length, { timeout: 120_000 });
    await page.waitForTimeout(300);
    const after3 = await names(page);
    t.ok(after3.includes('Figure') && after3.includes('Figure 2'), `pressed again, it adds "Figure 2" (${after3.join(', ')})`);
    await page.evaluate(() => window.__sculpt.session.undo());
    await page.waitForTimeout(300);
    t.eq((await names(page)).length, after2.length, 'one undo step takes that one off');

    // --- from the question ----------------------------------------------------------------------------
    await page.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt && !document.getElementById('overlay'), null, { timeout: 90_000 });
    // A reload keeps the scene on this device; start from a sphere again.
    await page.evaluate(async () => {
      const s = window.__sculpt;
      for (const m of [...s.session.getMeshes()]) s.session.deleteMesh(m);
      s.session.addSphere();
      s.session.clearHistory();
    });
    await goKey(page, 'Armature');
    await goKey(page, 'Sculpt');
    await page.evaluate(() => (window.__sculpt.figure.settings().resolution = 64));
    at = await torso(page);
    await stroke(page, at);
    await page.waitForSelector('.bz-ask', { timeout: 5000 });
    await page.click('.bz-ask-yes');
    await page.waitForFunction(() => window.__sculpt.session.getMeshes().some((m) => window.__sculpt.session.getMeshName(m) === 'Figure'), null, { timeout: 120_000 });
    await page.waitForTimeout(300);
    const got = await names(page);
    t.ok(got.filter((n) => n === 'Figure').length === 1, `Remesh in the question makes the figure (${got.join(', ')})`);
    await page.evaluate(() => window.__sculpt.session.undo());
    await page.waitForTimeout(300);
    t.ok((await names(page)).every((n) => n !== 'Figure') && (await drawn(page)).figure, 'in one undo step, and the mannequin is back');
    await page.evaluate(() => window.__sculpt.session.redo());
    await page.waitForTimeout(300);
    // The next stroke lands on the figure.
    await page.evaluate(() => {
      const f = window.__sculpt.session.getMeshes().find((m) => window.__sculpt.session.getMeshName(m) === 'Figure');
      window.__sculpt.session.setMesh(f);
    });
    const figureSum = await meshSum(page);
    const box = await page.evaluate(() => {
      const f = window.__sculpt.session.getMesh();
      const b = window.__sculpt.worldBox(f);
      return window.__armature.onScreen((b.min[0] + b.max[0]) / 2, b.min[1] + (b.max[1] - b.min[1]) * 0.7, (b.min[2] + b.max[2]) / 2);
    });
    await stroke(page, box);
    t.ok((await page.evaluate(() => window.__sculpt.armature.mannequin() === null)) && !(await asking(page)), 'the mannequin no longer catches a stroke, and nothing is asked: the next stroke is the figure\'s'
    );

    // --- the address ---------------------------------------------------------------------------------
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  async armatureAddress(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    // An armature in progress is replaced by an opened project after a question: yes.
    page.on('dialog', (d) => void d.accept());
    // An armature project opened by its address, on the one page: a template (a copy) and a project.
    const armatureFile = (pose) =>
      JSON.stringify({ kind: 'bozzetto-armature-project', v: 1, figure: 'placeholder-female', name: 'Mock figure', state: { pose }, symmetry: false, savedAt: Date.now(), units: 'cm' });
    for (const kind of ['template', 'project']) {
      await page.route(`**/api/projects/mock-${kind}`, (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: `mock-${kind}`, mode: 'armature', title: `Mock ${kind}`, visibility: 'public', updated_at: 7, template: kind === 'template' }) }),
      );
      await page.route(`**/media/mock-${kind}/armature.json*`, (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: armatureFile({ 'upperarm.L': [-40, 0, 10] }) }),
      );
    }
    // A question about replacing the armature in progress is asked only where there is one: none here.
    for (const [kind, param] of [['template', 'template=mock-template'], ['project', 'project=mock-project']]) {
      await page.goto(`${base}/?armature=1&${param}&q=low`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.__armature || !!document.querySelector('.overlay--error'), null, { timeout: 90_000 });
      await page.waitForTimeout(500);
      const got = await page.evaluate(() => ({
        figure: window.__armature?.armature.rig.id,
        arm: JSON.stringify(window.__armature?.state().pose?.['upperarm.L'] ?? null),
        path: document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent,
        url: location.search,
        scene: !!window.__sculpt,
        sceneNames: window.__sculpt ? window.__sculpt.session.getMeshes().length : 0,
      }));
      t.ok(got.figure === 'placeholder-female' && got.arm === '[-40,0,10]' && got.path === 'Armature', `?armature=1&${param} opens that armature, on the page, in Armature (${show(got)})`);
      t.ok(!/project=|template=/.test(got.url) && got.scene && got.sceneNames >= 1, 'the address is cleaned, and the scene is the page\'s own (not opened from it)');
    }
    // ?sculpt=1 opens on Sculpt, ?armature=1 on Armature, and the address follows the workspace.
    await page.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt && !document.getElementById('overlay'), null, { timeout: 90_000 });
    t.eq(await here(page), 'Sculpt', '?sculpt=1 opens on Sculpt');
    await goKey(page, 'Armature');
    t.eq(new URL(page.url()).searchParams.get('armature'), '1', 'in Armature the address says armature=1');
    await goKey(page, 'Sculpt');
    t.ok(new URL(page.url()).searchParams.get('sculpt') === '1' && new URL(page.url()).searchParams.get('armature') === null, 'and sculpt=1 when it is back in Sculpt');

    // The old Armature board's pictures arrive on the page's board, once.
    await page.evaluate(
      () =>
        new Promise((ok, fail) => {
          const r = indexedDB.open('bozzetto-sculpt');
          r.onerror = () => fail(r.error);
          r.onsuccess = () => {
            const db = r.result;
            const tx = db.transaction('scene', 'readwrite');
            const item = (id) => ({ id, name: `${id}.png`, width: 8, height: 8, blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), mirror: false, grey: false, blend: 'normal', opacity: 1, inView: false, seq: 1, place: null, camera: null, added: Date.now() });
            tx.objectStore('scene').put({ v: 1, items: [item('oldA'), item('oldB')] }, 'refs:armature');
            tx.oncomplete = () => ok(true);
            tx.onerror = () => fail(tx.error);
          };
        }),
    );
    await page.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await page.waitForFunction(() => window.__sculpt.reference.board.list().length >= 2, null, { timeout: 10_000 }).catch(() => {});
    const board = await page.evaluate(async () => {
      await window.__sculpt.reference.board.flush();
      const ids = window.__sculpt.reference.board.list().map((i) => i.id);
      const left = await new Promise((ok) => {
        const r = indexedDB.open('bozzetto-sculpt');
        r.onsuccess = () => {
          const c = r.result.transaction('scene').objectStore('scene').count('refs:armature');
          c.onsuccess = () => ok(c.result);
        };
      });
      return { ids, left };
    });
    t.ok(board.ids.includes('oldA') && board.ids.includes('oldB') && board.left === 0, `the old Armature board's pictures are on the page's board, and the old record is let go (${show(board)})`);
    await page.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await page.waitForTimeout(600);
    const once = await page.evaluate(() => window.__sculpt.reference.board.list().filter((i) => i.id === 'oldA').length);
    t.eq(once, 1, 'and they are not added a second time');
  },
};

void openArmature;
