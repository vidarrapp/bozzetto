// A new scene starts empty, on Create, with the armatures in it (0.7.19).
//
// newScene:
// - a first visit is empty, with the Scene panel open on the Create choices (a line, then tiles);
// - each kind of choice (a primitive, a base mesh) adds its object, selects and frames it, and the
//   panel's list and Create button come back; deleting the last object brings the choices back;
//   undo of the first add brings them back and redo the object;
// - the Create menu and the empty state list the same choices, and every tile has a picture that loads;
// - File > New sculpt gives the empty scene (asking first when there is work), and it reloads empty;
// - an armature tile loads Armature, sets that mannequin and goes to the Armature workspace; a second
//   tile on a posed armature asks, Cancel keeps it and Replace changes it;
// - in an empty scene a stroke, Paint, Present, Save file, undo and the panels throw nothing;
// - ?start=sphere starts with the sphere, and an old kept scene opens as it was.
import { mkdirSync } from 'node:fs';
import { openSculpt } from './lib.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/newscene';
const ARMS = ['placeholder-male', 'placeholder-female', 'mannequin-male-realistic', 'mannequin-female-realistic', 'mannequin-male-stylized', 'mannequin-female-stylized'];

const names = (page) => page.evaluate(() => window.__sculpt.session.getMeshes().map((m) => window.__sculpt.session.getMeshName(m)));
const setPanel = (page, id, open) => page.evaluate(([i, o]) => window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id: i, open: o } })), [id, open]);
const waitHere = (page, name) =>
  page.waitForFunction((n) => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === n, name, { timeout: 30_000 });
const armatureUp = (page) =>
  page.waitForFunction(() => !!window.__armature && !window.__armature.isSuspended() && !document.querySelector('.sculpt-toast[data-state="running"]'), null, { timeout: 90_000 });
const menu = async (page, menuName, item) => {
  await page.evaluate((n) => [...document.querySelectorAll('.bz-strip__menus .bz-menuname')].find((b) => b.textContent === n)?.click(), menuName);
  await page.waitForFunction(() => document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
  await page.evaluate((l) => {
    const row = [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].find((b) => (b.querySelector('.file-menu__label')?.textContent ?? b.textContent.trim()) === l);
    row?.click();
  }, item);
};
/** What the Scene panel shows: the empty state, the list, the Create button, the panel open. */
const panelState = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('.panel--scene');
    const vis = (sel) => {
      const el = root?.querySelector(sel);
      return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
    };
    return {
      open: !!root && !root.classList.contains('panel--collapsed'),
      empty: vis('.outliner__empty'),
      line: root?.querySelector('.outliner__empty-line')?.textContent ?? null,
      list: vis('.outliner'),
      create: vis('.outliner__btn'),
      tiles: root?.querySelectorAll('.outliner__empty .outliner__tile').length ?? 0,
    };
  });
/** The choices of one container as a comparable list. */
const choicesOf = (page, sel) =>
  page.evaluate((s) => {
    const box = document.querySelector(s);
    return [...box.children].map((c) => {
      if (c.classList.contains('outliner__menu-grid')) return [...c.children].map((i) => i.dataset.kind ?? i.dataset.id ?? i.dataset.armature ?? '?').join(',');
      return c.textContent.trim();
    });
  }, sel);

export const suites = {
  async newScene(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    let answer = true;
    const asked = [];
    page.on('dialog', async (d) => {
      asked.push(d.message());
      if (answer) await d.accept();
      else await d.dismiss();
    });
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.addInitScript(() => {
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('bz.panels.')) localStorage.removeItem(k);
      } catch {
        // none
      }
    });

    // --- a first visit ---------------------------------------------------------------------------
    await openSculpt(page, base, '&start=new');
    t.eq((await names(page)).length, 0, 'a first visit has no object');
    let s = await panelState(page);
    t.ok(s.open && s.empty && !s.list && !s.create, `the Scene panel is open on the Create choices, in place of the list (${JSON.stringify(s)})`);
    t.eq(s.line, 'Add something to start.', 'with its one line');
    t.ok(s.tiles >= 12, `and tiles (${s.tiles})`);
    const armTiles = await page.evaluate(() => [...document.querySelectorAll('.panel--scene .outliner__empty [data-armature]')].map((b) => b.dataset.armature));
    t.eq(armTiles.join(','), ARMS.join(','), 'the Armatures group has a tile for each mannequin and rig the Preset select offers');
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('.panel--scene .outliner__empty .outliner__tile')].filter((b) => b.getBoundingClientRect().height < 43.5).length,
    );
    t.eq(small, 0, 'every choice is at least 44 px tall');
    // The Create choices: a primitive is its picture and its name, as tall as an armature tile; the
    // headings stand alone; the armatures carry the short names; with nothing stored, Blockouts are one object.
    const choiceShape = await page.evaluate(() => {
      const empty = document.querySelector('.panel--scene .outliner__empty');
      const prim = empty.querySelector('[data-kind="sphere"]');
      const arm = empty.querySelector('[data-armature]');
      const heads = [...empty.querySelectorAll('.outliner__menu-head')].map((h) => h.textContent.trim());
      return {
        primH: prim.getBoundingClientRect().height,
        armH: arm.getBoundingClientRect().height,
        sizes: [...empty.querySelectorAll('[data-kind]')].map((b) => `${b.querySelector('.outliner__tile-note') ? 'note' : 'none'}:${b.title}`).join(' | '),
        heads,
        armNames: [...empty.querySelectorAll('[data-armature] .outliner__tile-name')].map((n) => n.textContent),
        parts: [...empty.querySelectorAll('[data-parts]')].map((p) => `${p.textContent}:${p.getAttribute('aria-pressed')}`).join(' '),
      };
    });
    t.ok(Math.abs(choiceShape.primH - choiceShape.armH) <= 1, `a primitive tile is as tall as an armature tile (${choiceShape.primH} and ${choiceShape.armH} px)`);
    t.ok(choiceShape.sizes.split(' | ').every((x) => x.startsWith('none:') && !/\d+ cm/.test(x)), `a primitive tile shows no size, on the tile or in its tooltip (${choiceShape.sizes})`);
    t.ok(choiceShape.heads.includes('Primitives') && choiceShape.heads.includes('Armatures'), `the Primitives and Armatures headings are there (${choiceShape.heads.join(', ')})`);
    t.ok(!choiceShape.heads.some((h) => /real size|Posable/.test(h)), 'the Armatures heading has no aside, and the Primitives heading none either');
    t.eq(choiceShape.armNames.join(', '), 'Male, blocks, Female, blocks, Male, realistic, Female, realistic, Male, stylized, Female, stylized', 'the armature tiles are named Male, blocks and so on');
    t.eq(choiceShape.parts, 'one object:true parts:false', 'with nothing stored, Blockouts as is on one object');
    const scrolls = await page.evaluate(() => {
      const b = document.querySelector('.panel--scene .panel__body');
      return b.scrollHeight > b.clientHeight && getComputedStyle(b).overflowY !== 'visible';
    });
    t.ok(scrolls, 'the choices scroll inside the panel');
    await page.screenshot({ path: `${SHOTS}/1-first-visit.png` });
    await page.evaluate(() => document.querySelector('.panel--scene [data-armature]').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS}/2-armatures.png` });

    // Every picture loads.
    const pics = await page.evaluate(async () => {
      const urls = [...new Set([...document.querySelectorAll('.panel--scene .outliner__empty img')].map((i) => i.src))];
      const bad = [];
      await Promise.all(
        urls.map(
          (u) =>
            new Promise((ok) => {
              const im = new Image();
              im.onload = () => ok(im.naturalWidth > 0 || bad.push(u));
              im.onerror = () => ok(bad.push(u));
              im.src = u;
            }),
        ),
      );
      return { n: urls.length, bad };
    });
    const primPics = await page.evaluate(() =>
      [...document.querySelectorAll('.panel--scene .outliner__empty .outliner__tile--primitive')].map((b) => {
        const i = b.querySelector('img');
        return `${b.dataset.kind}:${!!i && i.src.includes('/assets/primitives/thumbs/') && i.alt === '' && i.loading === 'lazy' && !i.draggable}`;
      }),
    );
    t.eq(primPics.join(' '), 'sphere:true cube:true cylinder:true torus:true cone:true capsule:true plane:true', 'the seven primitives are picture tiles, their pictures lazy and not draggable');
    t.ok(pics.n >= 13 && pics.bad.length === 0, `every tile has a thumbnail that loads (${pics.n} pictures, bad: ${pics.bad.join(', ') || 'none'})`);

    // --- choosing: a primitive, then a base mesh ------------------------------------------------------
    await page.evaluate(() => document.querySelector('.panel--scene .outliner__empty [data-kind="cube"]').click());
    await page.waitForFunction(() => window.__sculpt.session.getMeshes().length === 1, null, { timeout: 15_000 });
    await page.waitForTimeout(400);
    t.eq((await names(page)).join(','), 'Cube', 'a primitive adds its object');
    s = await panelState(page);
    t.ok(s.open && !s.empty && s.list && s.create, `and the panel goes back to its list with the Create button (${JSON.stringify(s)})`);
    const framed = await page.evaluate(() => {
      const { viewer, session } = window.__sculpt;
      const m = session.getMesh();
      const b = m.computeWorldBound();
      const P = viewer.camera.position.constructor;
      const c = new P((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2).project(viewer.camera);
      const sel = session.getSelectedMeshes();
      return { x: c.x, y: c.y, selected: sel.length ? sel.includes(m) : session.getMesh() === m };
    });
    t.ok(Math.abs(framed.x) < 0.5 && Math.abs(framed.y) < 0.5 && framed.selected, `the object is selected and framed (${framed.x.toFixed(2)}, ${framed.y.toFixed(2)})`);

    // Deleting the last brings the choices back; undo and redo of the delete too.
    await page.evaluate(() => {
      const row = document.querySelector('.panel--scene .outliner__row--active');
      [...(row?.querySelectorAll('.outliner__icon') ?? [])].find((b) => /Delete/.test(b.title))?.click();
    });
    await page.waitForFunction(() => window.__sculpt.session.getMeshes().length === 0, null, { timeout: 10_000 });
    s = await panelState(page);
    t.ok(s.empty && !s.list && !s.create, 'deleting the last object brings the Create choices back');

    // A base mesh, from the tile: loading its file, then in the scene.
    const baseId = await page.evaluate(() => document.querySelector('.panel--scene .outliner__empty .outliner__tile[data-id]').dataset.id);
    await page.evaluate(() => document.querySelector('.panel--scene .outliner__empty .outliner__tile[data-id]').click());
    await page.waitForFunction(() => window.__sculpt.session.getMeshes().length >= 1, null, { timeout: 60_000 });
    await page.waitForTimeout(500);
    s = await panelState(page);
    t.ok(!s.empty && s.list && s.create, `a base mesh (${baseId}) adds its objects and the list returns`);
    await page.screenshot({ path: `${SHOTS}/4-after-base-mesh.png` });

    // Undo of the first add brings the empty state back, redo the object.
    await page.evaluate(() => {
      window.__sculpt.session.newScene();
      window.__sculpt.scenePanel.refresh();
    });
    await page.evaluate(() => document.querySelector('.panel--scene .outliner__empty [data-kind="sphere"]').click());
    await page.waitForFunction(() => window.__sculpt.session.getMeshes().length === 1, null, { timeout: 15_000 });
    await page.evaluate(() => window.__sculpt.session.undo());
    await page.waitForTimeout(300);
    t.eq((await names(page)).length, 0, 'undo of the first add leaves the scene empty');
    s = await panelState(page);
    t.ok(s.empty && !s.list, 'and the Create choices are back');
    await page.evaluate(() => window.__sculpt.session.redo());
    await page.waitForTimeout(300);
    t.eq((await names(page)).join(','), 'Sphere', 'redo brings the object back');
    s = await panelState(page);
    t.ok(!s.empty && s.list, 'and the list');

    // --- the menu lists what the empty state lists ----------------------------------------------------
    await page.evaluate(() => document.querySelector('.panel--scene .outliner__btn').click());
    await page.waitForFunction(() => !document.querySelector('.outliner__menu--create').hidden, null, { timeout: 5000 });
    const inMenu = await choicesOf(page, '.outliner__menu--create');
    const inPanel = await choicesOf(page, '.panel--scene .outliner__choices');
    t.ok(inMenu.length > 8 && JSON.stringify(inMenu) === JSON.stringify(inPanel), `the Create menu and the empty state list the same choices (${inMenu.length} entries)`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/3-create-menu.png` });
    await page.keyboard.press('Escape');
    await page.mouse.click(600, 700);

    // --- the empty scene holds up ---------------------------------------------------------------------
    errors.length = 0;
    await page.evaluate(() => window.__sculpt.session.newScene());
    await page.waitForTimeout(300);
    for (const id of ['sculpt', 'model', 'layers', 'material', 'tool']) await setPanel(page, id, true);
    await page.waitForTimeout(300);
    await page.mouse.move(500, 400);
    await page.mouse.down();
    await page.mouse.move(600, 420, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+Shift+z');
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__sculpt.paintWorkspace.leave());
    await page.keyboard.press('Shift+4');
    await page.waitForTimeout(500);
    await page.keyboard.press('Shift+2');
    await page.waitForTimeout(500);
    await menu(page, 'File', 'Save file');
    await menu(page, 'File', 'Rename…').catch(() => {});
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    t.eq((await names(page)).length, 0, 'a stroke on nothing adds nothing');
    t.eq(errors.length, 0, `an empty scene throws nothing: Paint, Present, Save file, undo, the panels and a stroke (${errors.join(' | ')})`);

    // --- File > New sculpt -----------------------------------------------------------------------------
    await page.evaluate(() => window.__sculpt.session.addPrimitive('cube'));
    await page.evaluate(() => window.__sculpt.persist.markDirty());
    await page.waitForTimeout(300);
    asked.length = 0;
    answer = false;
    await menu(page, 'File', 'New sculpt');
    await page.waitForTimeout(600);
    t.ok(asked.length === 1 && (await names(page)).length === 1, `File > New sculpt asks when there is work, and Cancel keeps it (${asked[0]})`);
    answer = true;
    await menu(page, 'File', 'New sculpt');
    await page.waitForFunction(() => window.__sculpt.session.getMeshes().length === 0, null, { timeout: 10_000 });
    // The panel stays as the person has it (the panels opened above closed it): opened, it shows the choices.
    s = await panelState(page);
    t.ok(!s.open, 'the panel does not reopen by itself');
    await setPanel(page, 'scene', true);
    await page.waitForTimeout(300);
    s = await panelState(page);
    t.ok(s.empty && s.open, 'Start new gives the empty scene with the Create choices');
    await page.waitForTimeout(600);
    asked.length = 0;
    await menu(page, 'File', 'New sculpt');
    await page.waitForTimeout(500);
    t.eq(asked.length, 0, 'and with nothing to lose it asks nothing');

    // An empty scene reloads empty, with the panel open.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    await page.waitForTimeout(500);
    s = await panelState(page);
    t.ok((await names(page)).length === 0 && s.open && s.empty, `an empty scene reloads empty, on the Create choices (${JSON.stringify(s)})`);

    // --- an armature tile ------------------------------------------------------------------------------
    await page.evaluate(() => document.querySelector('.panel--scene .outliner__empty [data-armature="mannequin-female-stylized"]').click());
    await waitHere(page, 'Armature');
    await armatureUp(page);
    await page.waitForFunction(() => window.__armature.armature.rig.id === 'mannequin-female-stylized', null, { timeout: 60_000 });
    t.ok(true, 'an armature tile loads Armature, sets that mannequin and goes to the Armature workspace');
    t.ok(!(await page.evaluate(() => window.__armature.armature.serialize().pose && Object.keys(window.__armature.armature.serialize().pose).length)), 'in its rest pose');
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/5-after-armature.png` });

    // Unposed: another tile just changes the mannequin, with no question.
    asked.length = 0;
    await setPanel(page, 'scene', true);
    await page.evaluate(() => document.querySelector('.panel--scene .outliner__btn').click());
    await page.evaluate(() => document.querySelector('.outliner__menu--create [data-armature="mannequin-male-stylized"]').click());
    await page.waitForFunction(() => window.__armature.armature.rig.id === 'mannequin-male-stylized', null, { timeout: 60_000 });
    t.eq(asked.length, 0, 'a second tile on an unposed armature changes the mannequin without asking');

    // Posed: asks; Cancel keeps it, Replace changes it.
    await page.evaluate(() => window.__armature.turn('head', 0, 15, 0));
    await page.waitForTimeout(300);
    const pick = async (id) => {
      await page.evaluate(() => document.querySelector('.panel--scene .outliner__btn').click());
      await page.evaluate((i) => document.querySelector(`.outliner__menu--create [data-armature="${i}"]`).click(), id);
      await page.waitForTimeout(1200);
    };
    answer = false;
    asked.length = 0;
    await pick('placeholder-female');
    t.ok(asked.length === 1 && /Replace the armature\?/.test(asked[0]) && /pose and proportions/.test(asked[0]), `a tile on a posed armature asks (${asked[0]})`);
    t.eq(await page.evaluate(() => window.__armature.armature.rig.id), 'mannequin-male-stylized', 'Cancel keeps it');
    t.ok(await page.evaluate(() => Object.keys(window.__armature.armature.serialize().pose).length > 0), 'and its pose');
    answer = true;
    await pick('placeholder-female');
    await page.waitForFunction(() => window.__armature.armature.rig.id === 'placeholder-female', null, { timeout: 30_000 });
    t.ok(await page.evaluate(() => Object.keys(window.__armature.armature.serialize().pose).length === 0), 'Replace changes the mannequin, in its rest pose');

    // --- the start option and an old scene -----------------------------------------------------------------
    await page.evaluate(() => {
      try {
        indexedDB.databases?.().then((dbs) => dbs.forEach((d) => indexedDB.deleteDatabase(d.name)));
      } catch {
        // none
      }
    });
    await openSculpt(page, base);
    t.eq((await names(page)).join(','), 'Sphere', '?start=sphere starts a new scene with the default sphere (what openSculpt asks for)');
    await page.evaluate(() => window.__sculpt.session.addPrimitive('cube'));
    await page.evaluate(() => window.__sculpt.persist.markDirty());
    await page.evaluate(() => window.__sculpt.persist.flush());
    await page.waitForTimeout(500);
    await page.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    await page.waitForTimeout(500);
    t.eq((await names(page)).join(','), 'Sphere,Cube', 'a kept scene opens as it was');
    s = await panelState(page);
    t.ok(!s.empty && s.list, 'on the list, not the Create choices');
    await page.goto(`${base}/?sculpt=1&start=sphere`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    await page.waitForTimeout(500);
    t.eq((await names(page)).join(','), 'Sphere,Cube', '?start=sphere does nothing to a kept scene');
  },
};
