// The look panels (owner call, 2026-11-17: Sculpt had too many tabs). Render
// leaves Sculpt and Armature and lives in Present as three tabs, Lighting,
// Camera and Render; the public viewer has Lighting alone. Here: the tab set of
// every place the plain static server reaches, the three panels' rows, the
// rig library (built-in rigs, Save, Rename, Delete, Export, Import and a
// malformed file), the key light moved by L and by View > Move light (mouse
// and touch), the cavity on the Material tab, and the viewer. Each gets
// (page, base, t).
import { openArmature, openSculpt } from './lib.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/look-tabs';

/** The visible tabs by side, left to right: "left:Scene,left:Model,right:Tool...". */
export const tabRow = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.panel > .panel__handle')]
      .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none')
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { side: e.closest('.panel--left') ? 'left' : 'right', name: e.querySelector('.handle__label').textContent.trim(), l: r.left };
      })
      .sort((a, b) => a.l - b.l)
      .map((x) => `${x.side}:${x.name}`)
      .join(','),
  );

/** The open panel's visible section headings, in order. */
export const sectionsOf = (page, cls) =>
  page.evaluate((c) => {
    const shown = (el) => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
    return [...document.querySelectorAll(`.${c} .section > h3`)].filter(shown).map((h) => h.textContent);
  }, cls);

/** The visible row captions of one panel. */
export const rowsOf = (page, cls) =>
  page.evaluate((c) => {
    const shown = (el) => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
    return [...document.querySelectorAll(`.${c} .section > label > span:first-child, .${c} .section label.checkbox > span, .${c} .section label.compact > span:first-child, .${c} .section .label-row > span:first-child`)]
      .filter(shown)
      .map((s) => s.textContent);
  }, cls);

export const tapTab = (page, cls) => page.evaluate((c) => document.querySelector(`.${c} > .panel__handle`).click(), cls);
export const isOpen = (page, cls) => page.evaluate((c) => !!document.querySelector(`.${c}`) && !document.querySelector(`.${c}`).classList.contains('panel--collapsed'), cls);

/** Open a strip menu, pick an item by its label (the menu closes with it). */
export async function menuPick(page, menu, label) {
  await page.evaluate((n) => [...document.querySelectorAll('.bz-menuname')].find((b) => b.textContent === n)?.click(), menu);
  await page.waitForFunction(() => document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
  const ok = await page.evaluate((l) => {
    const item = [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].find(
      (b) => (b.querySelector('.file-menu__label')?.textContent ?? b.textContent.trim()) === l,
    );
    item?.click();
    return !!item;
  }, label);
  await page.waitForTimeout(150);
  if (await page.evaluate(() => !!document.querySelector('.bz-menuname.is-open'))) await page.keyboard.press('Escape');
  return ok;
}

/** The View menu's item labels. */
export async function viewLabels(page) {
  await page.evaluate(() => [...document.querySelectorAll('.bz-menuname')].find((b) => b.textContent === 'View')?.click());
  await page.waitForFunction(() => document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
  const items = await page.evaluate(() =>
    [...[...document.querySelectorAll('.file-menu')].find((p) => !p.hidden).querySelectorAll('.file-menu__item')].map(
      (b) => b.querySelector('.file-menu__label')?.textContent ?? b.textContent.trim(),
    ),
  );
  await page.keyboard.press('Escape');
  return items;
}

const keyLight = (page) => page.evaluate(() => window.__bozzetto.lighting.state().find((l) => l.id === 'key'));
const viewerReady = (page) => page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });

/** Into Sculpt's Present by its hotkey. */
async function present(page) {
  await page.evaluate(() => window.__sculpt.present.enter());
  await page.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 5000 });
}

const BUILT_IN = ['three_point', 'key_only', 'raking_key', 'rembrandt', 'butterfly', 'split', 'rim', 'top_light', 'under_light', 'soft_front'];

export const suites = {
  /** The tab set of each place, and what Sculpt and Armature no longer have. */
  async lookTabs(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base);
    t.eq(await tabRow(page), 'left:Scene,left:Model,left:Layers,right:Tool,right:Material,right:Reference', 'Sculpt: Scene, Model, Layers at the left; Tool, Material, Reference at the right');
    t.ok(!(await page.evaluate(() => [...document.querySelectorAll('.panel > .panel__handle')].some((h) => h.getClientRects().length > 0 && /Render|Lighting|Camera/.test(h.textContent)))), 'Sculpt has no Render, Lighting or Camera tab');
    const view = await viewLabels(page);
    t.ok(!view.includes('Render panel') && !view.includes('Lighting panel') && view.includes('Move light'), `the View menu has no Render panel, and has Move light (${view.join('|')})`);

    // Sculpt's default rig is Key only, and Three-point is in the list.
    t.eq(await page.evaluate(() => window.__bozzetto.lighting.activePreset()), 'key_only', "Sculpt's default rig is Key only");
    const ids = await page.evaluate(() => window.__bozzetto.lighting.presets().map((p) => p.id));
    t.ok(BUILT_IN.every((id) => ids.includes(id)), `the rig list has all the built-in rigs (${ids.join(',')})`);

    // Present from Sculpt: Lighting, Camera, Render at the left; Material, Output at the right.
    await present(page);
    t.eq(await tabRow(page), 'left:Lighting,left:Camera,left:Render,right:Material,right:Output', 'Present from Sculpt: Lighting, Camera, Render at the left; Material, Output at the right');
    const pv = await viewLabels(page);
    const want = ['Lighting panel', 'Camera panel', 'Render panel', 'Material panel', 'Output panel'];
    t.ok(want.every((w) => pv.includes(w)), `its View menu lists the five panels (${pv.join('|')})`);

    await tapTab(page, 'panel--lighting');
    t.eq((await sectionsOf(page, 'panel--lighting')).join(), 'Rig,Lights,Environment light', 'Lighting: Rig, Lights, Environment light');
    const light = await rowsOf(page, 'panel--lighting');
    t.ok(['Rig', 'Shadows', 'Key', 'Intensity', 'Azimuth', 'Elevation', 'Colour', 'Casts shadow', 'Softness', 'Rotate rig', 'HDRI'].every((r) => light.includes(r)), `Lighting has the rig, shadows, the lights and Rotate rig (${light.join(', ')})`);
    t.ok(await page.evaluate(() => ['Save rig…', 'Import rig…', 'Manage'].every((n) => [...document.querySelectorAll('.panel--lighting button')].some((b) => b.textContent === n))), 'Lighting has Save rig…, Import rig… and Manage');
    await page.mouse.move(640, 500);
    await page.screenshot({ path: `${SHOTS}/sculpt-present-lighting.png` });

    await tapTab(page, 'panel--camera');
    t.ok((await isOpen(page, 'panel--camera')) && !(await isOpen(page, 'panel--lighting')), 'Camera opens and Lighting closes (one panel a side)');
    t.eq((await rowsOf(page, 'panel--camera')).join(), 'Projection,Lens,Depth of field', 'Camera: Projection, Lens and Depth of field');
    await page.evaluate(() => document.querySelector('.panel--camera .dof-rows').closest('.section').querySelector('.checkbox input').click());
    t.eq((await rowsOf(page, 'panel--camera')).join(), 'Projection,Lens,Depth of field,Aperture,Focus', 'with Depth of field on, Aperture and Focus follow');
    await page.screenshot({ path: `${SHOTS}/sculpt-present-camera.png` });

    await tapTab(page, 'panel--render');
    t.eq((await sectionsOf(page, 'panel--render')).join(), 'Tone,Ambient occlusion,Background and ground', 'Render: Tone, Ambient occlusion, Background and ground');
    const render = await rowsOf(page, 'panel--render');
    t.ok(['Tone mapping', 'Model', 'Background', 'Ground'].every((r) => render.includes(r)), `Render has its rows (${render.join(', ')})`);
    t.ok(await page.evaluate(() => {
      const foot = document.querySelector('.panel--render .panel__body').lastElementChild;
      return !!foot && !!foot.querySelector('button') && foot.querySelector('button').textContent === 'Reset look';
    }), 'Reset look is at the foot of Render');
    await page.screenshot({ path: `${SHOTS}/sculpt-present-render.png` });

    // Leaving Present puts the tabs away again.
    await page.evaluate(() => window.__sculpt.present.leave());
    t.eq(await tabRow(page), 'left:Scene,left:Model,left:Layers,right:Tool,right:Material,right:Reference', 'leaving Present brings Sculpt\'s tabs back and puts Lighting, Camera, Render away');

    // Armature: left Armature; right Material, Reference.
    await openArmature(page, base);
    t.eq(await tabRow(page), 'left:Armature,right:Material,right:Reference', 'Armature: Armature at the left; Material, Reference at the right');
    const av = await viewLabels(page);
    t.ok(!av.includes('Render panel') && av.includes('Move light'), `Armature's View menu has no Render panel and has Move light (${av.join('|')})`);

    // A phone's width: the page loads and stays up, no more asked of it.
    const ctx = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    try {
      const p = await ctx.newPage();
      const perrs = [];
      p.on('pageerror', (e) => perrs.push(e.message));
      await openSculpt(p, base);
      t.eq(perrs.length, 0, `Sculpt loads at 390px without errors (${perrs.join('; ')})`);
    } finally {
      await ctx.close();
    }
    t.eq(errors.length, 0, `no page errors (${errors.join('; ')})`);
  },

  /** Every built-in rig applies its values, and the select names it. */
  async lookRigs(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base);
    await present(page);
    await tapTab(page, 'panel--lighting');
    const groups = await page.evaluate(() => [...document.querySelectorAll('.panel--lighting select optgroup')].map((g) => `${g.label}:${g.children.length}`));
    t.ok(groups[0] === `Built in:${BUILT_IN.length}`, `the Rig select has a Built in group (${groups.join(', ')})`);
    for (const id of BUILT_IN) {
      await page.selectOption('.panel--lighting select', `built:${id}`);
      await page.waitForTimeout(80);
      const r = await page.evaluate((i) => {
        const v = window.__bozzetto;
        const want = window.__bozzetto.lighting.presets().find((p) => p.id === i);
        return { active: v.lighting.activePreset(), label: want?.label, shown: document.querySelector('.panel--lighting select').selectedOptions[0].textContent, lights: v.lighting.state().map((l) => `${l.id}:${l.enabled}:${l.intensity}:${l.azimuth}:${l.elevation}`).join(' ') };
      }, id);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${SHOTS}/rig-${id}.png`, clip: { x: 390, y: 150, width: 400, height: 520 } });
      t.ok(r.active === id && r.shown === r.label, `${id}: applies and the select reads ${r.label} (${r.lights})`);
    }
    // Three-point has Key, Fill and Rim on.
    await page.selectOption('.panel--lighting select', 'built:three_point');
    t.eq(await page.evaluate(() => window.__bozzetto.lighting.state().filter((l) => l.enabled).length), 3, 'Three-point has Key, Fill and Rim on');
    // A light changed by hand reads Custom.
    await page.evaluate(() => window.__bozzetto.lighting.setIntensity('key', 1.23));
    await page.evaluate(() => window.dispatchEvent(new Event('bozzetto:controls-refresh')));
    t.eq(await page.evaluate(() => document.querySelector('.panel--lighting select').selectedOptions[0].textContent), 'Custom', 'lights that match no rig read Custom');
  },

  /** Save, rename, delete, export and import a rig; a malformed file is refused. */
  async lookRigLibrary(page, base, t) {
    await openSculpt(page, base);
    await present(page);
    await tapTab(page, 'panel--lighting');
    const btn = (name) => page.evaluate((n) => [...document.querySelectorAll('.panel--lighting button')].find((b) => b.textContent === n)?.click(), name);

    // Save: the current lights under a name, in My rigs.
    await page.selectOption('.panel--lighting select', 'built:rembrandt');
    await page.evaluate(() => window.__bozzetto.lighting.setAngles('key', 77, 33));
    page.once('dialog', (d) => d.accept('Mine one'));
    await btn('Save rig…');
    await page.waitForFunction(() => [...document.querySelectorAll('.panel--lighting select optgroup')].some((g) => g.label === 'My rigs'), null, { timeout: 5000 });
    t.eq(await page.evaluate(() => document.querySelector('.panel--lighting select').selectedOptions[0].textContent), 'Mine one', 'Save rig keeps the lights under the name, and the select shows it');
    // Pick another, then mine again: the values come back.
    await page.selectOption('.panel--lighting select', 'built:top_light');
    await page.selectOption('.panel--lighting select', { label: 'Mine one' });
    const key = await keyLight(page);
    t.ok(key.azimuth === 77 && key.elevation === 33, `picking My rig applies its lights (${key.azimuth}, ${key.elevation})`);
    t.ok(await page.evaluate(() => (localStorage.getItem('bz.rigs') ?? '').includes('Mine one')), 'and it is kept on this device');

    // Rename.
    await btn('Manage');
    page.once('dialog', (d) => d.accept('Mine two'));
    await page.evaluate(() => document.querySelector('.rig-manage__row [data-role=rig-rename]').click());
    await page.waitForFunction(() => [...document.querySelectorAll('.panel--lighting select option')].some((o) => o.textContent === 'Mine two'), null, { timeout: 5000 });
    t.ok(await page.evaluate(() => ![...document.querySelectorAll('.panel--lighting select option')].some((o) => o.textContent === 'Mine one')), 'Rename changes the name');

    // Export: a .bozzrig download whose lights are the rig's (the list stays open after a rename).
    const dl = page.waitForEvent('download', { timeout: 8000 });
    await page.evaluate(() => document.querySelector('.rig-manage__row [data-role=rig-export]').click());
    const file = await dl;
    t.eq(file.suggestedFilename(), 'mine-two.bozzrig', 'Export downloads a .bozzrig file');
    const text = await (async () => {
      const stream = await file.createReadStream();
      let s = '';
      for await (const c of stream) s += c;
      return s;
    })();
    const json = JSON.parse(text);
    t.ok(json.format === 'bozzrig' && json.name === 'Mine two' && json.lights.length === 3 && json.lights[0].type === 'directional' && json.lights[0].azimuth === 77, 'the file is the rig: a format, a name, a list of typed lights');

    // Delete (a danger question), answered no, then yes.
    await page.evaluate(() => document.querySelector('.rig-manage__row [data-role=rig-delete]').click());
    await page.waitForSelector('.bz-ask');
    t.ok(true, 'Delete asks first');
    await page.click('.bz-ask-cancel');
    t.ok(await page.evaluate(() => [...document.querySelectorAll('.panel--lighting select option')].some((o) => o.textContent === 'Mine two')), 'Cancel keeps the rig');
    page.once('dialog', (d) => d.accept());
    await page.evaluate(() => document.querySelector('.rig-manage__row [data-role=rig-delete]').click());
    await page.waitForFunction(() => ![...document.querySelectorAll('.panel--lighting select option')].some((o) => o.textContent === 'Mine two'), null, { timeout: 5000 });
    t.ok(true, 'Delete removes it');

    // Import: the exported file comes back as a rig, applied.
    await page.selectOption('.panel--lighting select', 'built:split');
    await page.setInputFiles('.panel--lighting .rig-file', { name: 'mine-two.bozzrig', mimeType: 'application/json', buffer: Buffer.from(text) });
    await page.waitForFunction(() => [...document.querySelectorAll('.panel--lighting select option')].some((o) => o.textContent === 'Mine two'), null, { timeout: 5000 });
    const back = await keyLight(page);
    t.ok(back.azimuth === 77 && back.elevation === 33, 'Import reads the file, keeps it under its name and applies it');

    // Out-of-range numbers are held to the sliders' limits.
    const wild = JSON.parse(text);
    wild.name = 'Wild';
    wild.lights[0].intensity = 99;
    wild.lights[0].elevation = 500;
    wild.lights[0].azimuth = -900;
    await page.setInputFiles('.panel--lighting .rig-file', { name: 'wild.bozzrig', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wild)) });
    await page.waitForFunction(() => [...document.querySelectorAll('.panel--lighting select option')].some((o) => o.textContent === 'Wild'), null, { timeout: 5000 });
    const w = await keyLight(page);
    t.ok(w.intensity === 5 && w.elevation === 90 && w.azimuth === -180, `numbers are clamped to the sliders' limits (${w.intensity}, ${w.elevation}, ${w.azimuth})`);

    // Malformed files are refused with a plain notice; the lights stay.
    const before = await page.evaluate(() => JSON.stringify(window.__bozzetto.lighting.serialize()));
    const bad = {
      'not json': 'hello',
      'wrong format': JSON.stringify({ format: 'other', version: 1, lights: [] }),
      'a string for a number': JSON.stringify({ ...JSON.parse(text), lights: [{ ...json.lights[0], intensity: 'bright' }] }),
      'a colour that is not one': JSON.stringify({ ...JSON.parse(text), lights: [{ ...json.lights[0], color: 'url(https://example.com/p)' }] }),
      'no lights': JSON.stringify({ format: 'bozzrig', version: 1, name: 'x', lights: [] }),
      'a newer version': JSON.stringify({ ...JSON.parse(text), version: 9 }),
    };
    for (const [why, body] of Object.entries(bad)) {
      await page.setInputFiles('.panel--lighting .rig-file', { name: 'bad.bozzrig', mimeType: 'application/json', buffer: Buffer.from(body) });
      await page.waitForSelector('.bz-ask', { timeout: 5000 });
      const said = await page.evaluate(() => document.querySelector('.bz-ask h2')?.textContent);
      await page.click('.bz-ask-yes');
      await page.waitForFunction(() => !document.querySelector('.bz-ask'), null, { timeout: 5000 });
      t.eq(said, 'This rig cannot be imported', `a file with ${why} is refused`);
    }
    t.eq(await page.evaluate(() => JSON.stringify(window.__bozzetto.lighting.serialize())), before, 'and none of them changed the lights');
    await page.screenshot({ path: `${SHOTS}/rig-library.png` });
  },

  /** L and View > Move light move the key light, by mouse and by touch; Cavity from the Material tab. */
  async lookMoveLight(page, base, t) {
    await openSculpt(page, base);
    const centre = { x: 640, y: 420 };
    await page.mouse.move(centre.x, centre.y);
    const drag = async (dx, dy) => {
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down();
      await page.mouse.move(centre.x + dx / 2, centre.y + dy / 2, { steps: 4 });
      await page.mouse.move(centre.x + dx, centre.y + dy, { steps: 4 });
      await page.mouse.up();
    };

    // L, held, and a drag: across and up.
    const a0 = await keyLight(page);
    await page.keyboard.down('l');
    await drag(40, -20);
    await page.keyboard.up('l');
    const a1 = await keyLight(page);
    t.ok(a1.azimuth > a0.azimuth + 10 && a1.elevation > a0.elevation + 5, `L and a drag move the key light (${a0.azimuth}, ${a0.elevation}) to (${a1.azimuth}, ${a1.elevation})`);

    // View > Move light, by mouse: one drag, then it lets go.
    t.ok(await menuPick(page, 'View', 'Move light'), 'View has Move light');
    const checked = await page.evaluate(async () => {
      const b = [...document.querySelectorAll('.bz-menuname')].find((x) => x.textContent === 'View');
      b.click();
      await new Promise((r) => setTimeout(r, 100));
      const item = [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].find((i) => i.textContent.includes('Move light'));
      const on = item?.getAttribute('aria-checked') === 'true' || item?.classList.contains('is-checked') || item?.querySelector('.file-menu__check:not([hidden])') !== null;
      return on;
    });
    await page.keyboard.press('Escape');
    const b0 = await keyLight(page);
    await drag(-40, 20);
    const b1 = await keyLight(page);
    t.ok(b1.azimuth < b0.azimuth - 10 && b1.elevation < b0.elevation - 5, `an armed drag moves the key light (${b0.azimuth}, ${b0.elevation}) to (${b1.azimuth}, ${b1.elevation})`);
    const c0 = await keyLight(page);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.move(centre.x + 30, centre.y + 30, { steps: 4 });
    t.eq((await keyLight(page)).azimuth, c0.azimuth, 'and a hover afterwards moves nothing');

    // Esc cancels an armed Move light.
    await menuPick(page, 'View', 'Move light');
    await page.keyboard.press('Escape');
    const d0 = await keyLight(page);
    await drag(50, 0);
    t.eq((await keyLight(page)).azimuth, d0.azimuth, 'Esc cancels it: the next drag is not the light\'s');

    // By touch.
    const cdp = await page.context().newCDPSession(page);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await menuPick(page, 'View', 'Move light');
    const e0 = await keyLight(page);
    await touch('touchStart', centre.x, centre.y);
    for (let i = 1; i <= 8; i++) await touch('touchMove', centre.x + i * 6, centre.y - i * 3);
    await touch('touchEnd');
    await page.waitForTimeout(100);
    const e1 = await keyLight(page);
    t.ok(e1.azimuth > e0.azimuth + 10 && e1.elevation > e0.elevation + 5, `a finger's drag moves the key light after Move light (${e0.azimuth}, ${e0.elevation}) to (${e1.azimuth}, ${e1.elevation})`);

    // Relative: a finger that lands far from the last pointer position, and moves 10 px, turns the
    // light by 10 px worth (5 degrees), not by the distance between the two places.
    const near = (a, b, why) => t.ok(Math.abs(Math.abs(a) - 5) < 1.5 && Math.abs(b) < 1.5, `${why}: 10 px right turned it ${a.toFixed(2)} degrees (want about 5) and 0 px up ${b.toFixed(2)}`);
    await page.mouse.move(100, 100);
    await menuPick(page, 'View', 'Move light');
    const r0 = await keyLight(page);
    await touch('touchStart', 980, 300);
    await touch('touchMove', 985, 300);
    await touch('touchMove', 990, 300);
    await touch('touchEnd');
    await page.waitForTimeout(100);
    const r1 = await keyLight(page);
    near(r1.azimuth - r0.azimuth, r1.elevation - r0.elevation, 'a finger far from the last pointer, Move light');
    await page.mouse.move(100, 100);
    await page.keyboard.down('l');
    const r2 = await keyLight(page);
    await touch('touchStart', 300, 600);
    await touch('touchMove', 305, 600);
    await touch('touchMove', 310, 600);
    await touch('touchEnd');
    await page.waitForTimeout(100);
    const r3 = await keyLight(page);
    near(r3.azimuth - r2.azimuth, r3.elevation - r2.elevation, 'a finger far from the last pointer, L held');
    const pen = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'pen', force: 0.6 });
    await pen('mouseMoved', 150, 150, 0);
    await pen('mouseMoved', 800, 700, 0);
    const r4 = await keyLight(page);
    await pen('mousePressed', 800, 700, 1);
    await pen('mouseMoved', 805, 700, 1);
    await pen('mouseMoved', 810, 700, 1);
    await pen('mouseReleased', 810, 700, 0);
    await page.waitForTimeout(100);
    const r5 = await keyLight(page);
    near(r5.azimuth - r4.azimuth, r5.elevation - r4.elevation, 'a pen that lands far from where it hovered, L held');
    // A hovering mouse: L goes down, the next move sets the reference, the ones after turn it.
    await page.keyboard.up('l');
    await page.mouse.move(100, 100);
    await page.keyboard.down('l');
    const r6 = await keyLight(page);
    await page.mouse.move(700, 500);
    await page.mouse.move(710, 500);
    const r7 = await keyLight(page);
    near(r7.azimuth - r6.azimuth, r7.elevation - r6.elevation, 'a hovering mouse');
    t.ok(r7.azimuth > r6.azimuth, 'and right still swings it the way it did');
    await page.keyboard.up('l');

    // Cavity: a switch with Strength and Radius under it, on the Material tab.
    await tapTab(page, 'panel--material');
    const cav = await page.evaluate(() => ({
      on: window.__bozzetto.getSculptAO().strength > 0,
      rows: [...document.querySelectorAll('.panel--material .cavity-rows label.checkbox > span, .panel--material .cavity-rows label.compact > span:first-child')].map((s) => s.textContent),
    }));
    t.ok(cav.on && cav.rows.join() === 'Cavity,Strength,Radius', `the Material tab has Cavity on with Strength and Radius (${cav.rows})`);
    await page.evaluate(() => document.querySelector('.panel--material [data-role=cavity] input').click());
    t.eq(await page.evaluate(() => window.__bozzetto.getSculptAO().strength), 0, 'Cavity off sets no cavity');
    t.eq(await page.evaluate(() => [...document.querySelectorAll('.panel--material .cavity-rows label.checkbox > span, .panel--material .cavity-rows label.compact > span:first-child')].map((s) => s.textContent).join()), 'Cavity', 'and folds its Strength and Radius away');
    await page.evaluate(() => document.querySelector('.panel--material [data-role=cavity] input').click());
    t.ok((await page.evaluate(() => window.__bozzetto.getSculptAO().strength)) > 0, 'Cavity on again brings it back');
    await page.screenshot({ path: `${SHOTS}/sculpt-material-cavity.png` });

    // Armature: the same Move light.
    await openArmature(page, base);
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      window.__probe = [];
      for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
        window.addEventListener(type, (e) => window.__probe.push(`${type}:${e.target.tagName}.${(e.target.className || '').toString().slice(0, 30)}:${e.pointerId}`), true);
      }
    });
    // Holding L still works (the existing way), as the control for what follows.
    const g0 = await keyLight(page);
    await page.mouse.move(centre.x, centre.y);
    await page.keyboard.down('l');
    await page.mouse.move(centre.x + 40, centre.y - 20, { steps: 6 });
    await page.keyboard.up('l');
    const g1 = await keyLight(page);
    t.ok(g1.azimuth > g0.azimuth + 10, `Armature: L and a drag turn the key (${g0.azimuth}) to (${g1.azimuth})`);
    const f0 = await keyLight(page);
    t.ok(await menuPick(page, 'View', 'Move light'), 'Armature: View has Move light');
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 40, centre.y - 20, { steps: 6 });
    await page.mouse.up();
    const f1 = await keyLight(page);
    const probe = await page.evaluate(() => window.__probe.filter((x) => !x.startsWith('pointermove')).join(' | '));
    t.ok(f1.azimuth > f0.azimuth + 10, `Armature: Move light turns the key (${f0.azimuth}) to (${f1.azimuth}) [${probe}]`);
    // Relative here too: a finger that lands far from the last pointer, 10 px, turns it 5 degrees.
    await page.mouse.move(100, 100);
    await page.keyboard.down('l');
    const h0 = await keyLight(page);
    await touch('touchStart', 900, 600);
    await touch('touchMove', 905, 600);
    await touch('touchMove', 910, 600);
    await touch('touchEnd');
    await page.waitForTimeout(100);
    await page.keyboard.up('l');
    const h1 = await keyLight(page);
    near(h1.azimuth - h0.azimuth, h1.elevation - h0.elevation, 'Armature: a finger far from the last pointer, L held');
  },

  /** The public viewer: Material and Lighting at the right, the rig select alone. */
  async lookViewer(page, base, t) {
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await viewerReady(page);
    await page.waitForTimeout(300);
    t.eq(await tabRow(page), 'right:Material,right:Lighting', 'the viewer has Material and Lighting at the right, nothing at the left');
    const view = await viewLabels(page);
    t.ok(view.includes('Lighting panel') && !view.includes('Camera panel') && !view.includes('Render panel'), `its View menu has Lighting and no Camera or Render (${view.join('|')})`);
    await tapTab(page, 'panel--lighting');
    t.eq((await sectionsOf(page, 'panel--lighting')).join(), 'Rig,Lights,Environment light', 'Lighting has Rig, Lights and Environment light');
    t.ok(await page.evaluate(() => !!document.querySelector('.panel--lighting select') && !document.querySelector('.panel--lighting .rig-actions')), 'the visitor has the rig select and no Save, Import or Manage');
    const before = await page.evaluate(() => window.__bozzetto.lighting.activePreset());
    await page.selectOption('.panel--lighting select', 'built:rembrandt');
    t.eq(await page.evaluate(() => window.__bozzetto.lighting.activePreset()), 'rembrandt', `a visitor picks a built-in rig (it was ${before})`);
    t.ok(await page.evaluate(() => !(localStorage.getItem('bz.rigs') ?? '').length), 'and nothing is kept');
    await page.screenshot({ path: `${SHOTS}/viewer-lighting.png` });
  },
};
