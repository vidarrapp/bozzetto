// The Material tab: the left edge's third tab after Scene and Model, holding
// the active object's Surface (Albedo, Roughness, Metalness) and the Display
// (Mode and its matcap, Smooth shading, Wireframe, Wire opacity), both moved
// out of the Model and Render panels. In Armature it follows the Armature tab;
// in the Present workspace it follows Frames and Project; the public viewer
// keeps the section in its Render panel. Each gets (page, base, t).
import { openArmature, openSculpt } from './lib.mjs';

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'block' };

const tab = (page, cls) => page.evaluate((c) => document.querySelector(`.${c} .panel__handle`).click(), cls);
const isOpen = (page, cls) => page.evaluate((c) => !document.querySelector(`.${c}`).classList.contains('panel--collapsed'), cls);
const settle = (page, ms = 300) => page.waitForTimeout(ms);

/** The panel's section headings, and what each section holds, by label. */
const sectionsOf = (page, cls) =>
  page.evaluate((c) => {
    const out = {};
    for (const s of document.querySelectorAll(`.${c} .section`)) {
      if (s.hidden) continue;
      out[s.querySelector('h3').textContent] = [...s.querySelectorAll('label > span:first-child, .label-row > span:first-child, .checkbox > span')].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
    }
    return out;
  }, cls);

/** Every folder tab on the page: its name, its edges, and the side it is on. */
const tabs = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.panel > .panel__handle')]
      .filter((e) => e.getClientRects().length > 0)
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { name: e.querySelector('.handle__label').textContent.trim(), left: r.left, right: r.right, top: r.top, height: r.height, side: e.closest('.panel--left') ? 'left' : 'right' };
      })
      .sort((a, b) => a.left - b.left),
  );

/** Tabs in one row: inside the screen, 1px apart on a side, and the sides clear of each other. */
function fitChecks(t, row, vw, where) {
  const left = row.filter((x) => x.side === 'left');
  const right = row.filter((x) => x.side === 'right');
  t.ok(row.every((x) => x.left >= -0.5 && x.right <= vw + 0.5), `${where}: every tab is on the screen (${row.map((x) => `${x.name} ${Math.round(x.left)}-${Math.round(x.right)}`).join(', ')} of ${vw})`);
  const gaps = (side) => side.slice(1).map((x, i) => x.left - side[i].right);
  t.ok([...gaps(left), ...gaps(right)].every((g) => Math.abs(g - 1) < 0.5), `${where}: tabs on a side stand 1px apart (${[...gaps(left), ...gaps(right)].join(', ')})`);
  t.ok(left.length > 0 && right.length > 0 && left.at(-1).right < right[0].left, `${where}: the left tabs end before the right ones begin (${Math.round(left.at(-1)?.right)} against ${Math.round(right[0]?.left)})`);
  t.ok(row.every((x) => x.height === 28 && x.top === row[0].top), `${where}: all on one row, 28px tall`);
}

/** An in-page phone: its own context, closed after. Returns the page errors. */
async function onPhone(page, fn) {
  const ctx = await page.context().browser().newContext(PHONE);
  await ctx.addInitScript(() => {
    window.__bozzettoAdaptiveOff = true;
  });
  try {
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await fn(p);
    return errors;
  } finally {
    await ctx.close();
  }
}

export const suites = {
  // Sculpt: the tab, its two sections, what Model and Render no longer have,
  // the albedo, the mode and the wireframe working from it, and the phone.
  async material(page, base, t) {
    await openSculpt(page, base);
    await page.addStyleTag({ content: '.panel, .panel * { transition: none !important; }' });

    // The tabs: Scene, Model, Material along the left edge.
    const row = await tabs(page);
    t.eq(row.filter((x) => x.side === 'left').map((x) => x.name).join(','), 'Scene,Model,Material', 'the left edge has Scene, Model, Material, in that order');
    t.eq(row.filter((x) => x.side === 'right').map((x) => x.name).join(','), 'Tool,Render', 'and the right edge Tool and Render, as before');
    fitChecks(t, row, 1280, 'Sculpt at 1280');

    // At most one panel a side.
    await tab(page, 'panel--scene');
    await tab(page, 'panel--material');
    t.ok((await isOpen(page, 'panel--material')) && !(await isOpen(page, 'panel--scene')), 'opening Material closes Scene');
    await tab(page, 'panel--model');
    t.ok((await isOpen(page, 'panel--model')) && !(await isOpen(page, 'panel--material')), 'and Model closes Material');
    await tab(page, 'panel--material');
    t.ok(!(await isOpen(page, 'panel--model')), 'and Material closes Model');
    t.eq(await page.evaluate(() => document.querySelector('.panel--material .panel__title').textContent), 'Material', 'the panel is headed Material');
    t.eq(await page.evaluate(() => localStorage.getItem('bz.panels.sculpt')), '["material"]', 'and the panel memory keeps it');

    // Its sections.
    const mat = await sectionsOf(page, 'panel--material');
    t.eq(Object.keys(mat).join(','), 'Surface,Display', 'Material has two sections, Surface and Display');
    t.eq(mat.Surface.join(','), 'Material,Albedo,Roughness,Metalness', 'Surface: the assigned Material, Albedo, Roughness, Metalness');
    t.eq(mat.Display.join(','), 'Mode,Smooth shading,Wireframe (Shift + W),Wire opacity', `Display: Mode, Smooth shading, Wireframe with its hotkey, Wire opacity (${mat.Display.join(',')})`);

    // Gone from Model and Render: a control is shown once.
    await tab(page, 'panel--model');
    const model = await sectionsOf(page, 'panel--model');
    t.eq(Object.keys(model)[0], 'Topology', `the Model panel starts at Topology (${Object.keys(model).join(', ')})`);
    t.ok(!Object.keys(model).includes('Material') && !Object.values(model).flat().some((l) => /Albedo|Roughness|Metalness/.test(l)), 'with no Material section and no Albedo, Roughness or Metalness');
    await tab(page, 'panel--model');
    await tab(page, 'panel--render');
    const render = await sectionsOf(page, 'panel--render');
    t.eq(Object.keys(render)[0], 'Lighting', `the Render panel starts at Lighting (${Object.keys(render).join(', ')})`);
    const strays = Object.values(render).flat().filter((l) => /^(Mode$|Smooth shading|Wireframe|Wire opacity|Matcap)/.test(l));
    t.ok(!Object.keys(render).includes('Material') && !strays.length, `with no Mode, Smooth shading, Wireframe or Wire opacity (${strays.join(', ')})`);
    await tab(page, 'panel--render');

    // The Albedo: the active object's, changed from here.
    await tab(page, 'panel--material');
    const surface = () =>
      page.evaluate(() => {
        const { session, library } = window.__sculpt;
        const m = library.materialFor(session.getMesh());
        const colors = session.getMesh().getColors();
        return { albedo: m.albedo, rough: m.roughness, metal: m.metalness, c0: [...colors.subarray(0, 3)].map((v) => Math.round(v * 255)) };
      });
    const before = await surface();
    await page.click('.panel--material .cpick__swatch');
    const field = await page.evaluate(() => {
      const r = document.querySelector('.cpick__pop:not([hidden]) .cpick__field')?.getBoundingClientRect();
      return r ? { x: r.left + r.width * 0.9, y: r.top + r.height * 0.15 } : null;
    });
    t.ok(!!field, 'the Albedo swatch opens the colour picker');
    await page.mouse.move(field.x, field.y);
    await page.mouse.down();
    await page.mouse.up();
    await settle(page, 400);
    const after = await surface();
    t.ok(after.albedo !== before.albedo, `a pick in it changes the object's albedo (${before.albedo} to ${after.albedo})`);
    t.ok(after.c0.join() !== before.c0.join(), `and the object's surface follows (${before.c0.join()} to ${after.c0.join()})`);
    // The assigned material's name, plain, and following the object and the Scene panel.
    const nameRow = () => page.evaluate(() => {
      const r = document.querySelector('.panel--material [data-role="material-name"]');
      return { label: r.children[0].textContent, value: r.children[1].textContent, editable: !!r.querySelector('select, input') };
    });
    t.eq(JSON.stringify(await nameRow()), '{"label":"Material","value":"Clay","editable":false}', 'Surface opens with a plain Material row naming the assigned material');
    await page.evaluate(() => {
      const { library, session } = window.__sculpt;
      const m = library.create('Bronze');
      library.assign(session.getMesh(), m.id);
      session.render();
    });
    await settle(page, 200);
    t.eq((await nameRow()).value, 'Bronze', 'an assignment (as the Scene panel makes it) updates the name');
    await page.evaluate(() => {
      const { library, session } = window.__sculpt;
      library.update(library.materialFor(session.getMesh()).id, { name: 'Brass' });
    });
    await settle(page, 200);
    t.eq((await nameRow()).value, 'Brass', 'a rename updates it');
    await page.evaluate(() => {
      const { library, session } = window.__sculpt;
      library.assign(session.getMesh(), library.list()[0].id);
    });
    await settle(page, 200);
    // Roughness from its slider.
    const rough = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.panel--material label.compact')].find((l) => l.firstElementChild?.textContent === 'Roughness');
      const input = row.querySelector('input[type=range]');
      input.value = '0.8';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return window.__sculpt.library.materialFor(window.__sculpt.session.getMesh()).roughness;
    });
    t.near(rough, 0.8, 1e-6, 'the Roughness slider changes the active object\'s roughness');
    // The material the Scene panel and the file keep is the same one.
    const kept = await page.evaluate(() => {
      const { library } = window.__sculpt;
      return library.list().map((m) => ({ albedo: m.albedo, roughness: m.roughness }));
    });
    t.ok(kept.some((m) => m.albedo === after.albedo && m.roughness === 0.8), `which is what the scene's material holds (${JSON.stringify(kept)})`);
    // Undo, as it was before the move.
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Control+z');
    await settle(page, 400);
    const undone = await surface();
    t.eq(JSON.stringify([undone.albedo, undone.rough]), JSON.stringify([after.albedo, 0.8]), 'Ctrl+Z leaves the material values as the brush history never held them: material edits are not strokes');

    // Mode.
    const modeSel = '.panel--material select';
    t.eq(await page.evaluate(() => window.__sculpt.viewer.getMaterial()), 'lit', 'the mode starts on Lit (PBR)');
    await page.selectOption(modeSel, 'matcap');
    await settle(page);
    t.eq(await page.evaluate(() => window.__sculpt.viewer.getMaterial()), 'matcap', 'Mode: Matcap changes the viewer');
    t.ok(await page.evaluate(() => !!document.querySelector('.panel--material .mat-options .matcap-trigger, .panel--material .mat-options .label-row')), 'and the matcap gallery appears under it');
    await page.selectOption(modeSel, 'lit');
    await settle(page);
    t.eq(await page.evaluate(() => window.__sculpt.viewer.getMaterial()), 'lit', 'and back to Lit');

    // Wireframe: the switch and Shift+W.
    const wire = () =>
      page.evaluate(() => ({
        on: window.__sculpt.viewer.isWireframe(),
        box: [...document.querySelectorAll('.panel--material .checkbox')].find((c) => c.textContent.startsWith('Wireframe')).querySelector('input').checked,
      }));
    t.eq(JSON.stringify(await wire()), '{"on":false,"box":false}', 'Wireframe starts off');
    await page.click('.panel--material .checkbox:has-text("Wireframe")');
    t.eq(JSON.stringify(await wire()), '{"on":true,"box":true}', 'its switch turns the wireframe on');
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Shift+W');
    await settle(page);
    t.eq(JSON.stringify(await wire()), '{"on":false,"box":false}', 'Shift+W turns it off and the switch follows');
    await page.keyboard.press('Shift+W');
    await settle(page);
    t.eq(JSON.stringify(await wire()), '{"on":true,"box":true}', 'and on again');
    await page.keyboard.press('Shift+W');
    await settle(page);
    // Smooth shading and Wire opacity.
    const flat = () => page.evaluate(() => window.__sculpt.viewer.materials.getMaterialState().flatShading);
    const was = await flat();
    await page.click('.panel--material .checkbox:has-text("Smooth shading")');
    await settle(page, 200);
    t.eq(await flat(), !was, 'Smooth shading flips the shading (Sculpt starts on flat facets)');
    await page.click('.panel--material .checkbox:has-text("Smooth shading")');
    await settle(page, 200);
    t.eq(await flat(), was, 'and back');
    const opacity = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.panel--material label.compact')].find((l) => l.firstElementChild?.textContent === 'Wire opacity');
      const input = row.querySelector('input[type=range]');
      input.value = '0.4';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return window.__sculpt.viewer.getWireframeOpacity();
    });
    t.near(opacity, 0.4, 1e-6, 'Wire opacity moves the wireframe\'s');
    // The look saves with the scene: Display is part of the viewer's look.
    t.ok(await page.evaluate(() => 'wireframe' in (window.__sculpt.viewer.getLook().material ?? {}) || !!window.__sculpt.viewer.getLook().material), 'and the look the scene saves carries the material');

    // The View menu's switch moves it too.
    await page.evaluate(() => [...document.querySelectorAll('.bz-menuname')].find((b) => b.textContent === 'View').click());
    await page.evaluate(() => [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].find((b) => b.querySelector('.file-menu__label')?.textContent === 'Wireframe').click());
    await settle(page);
    t.eq(JSON.stringify(await wire()), '{"on":true,"box":true}', 'View, Wireframe turns it on and the open switch follows');
    await page.keyboard.press('Escape');

    // Selection: the Surface follows the active object, and with none says so.
    const none = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const surface = [...document.querySelectorAll('.panel--material .section')].find((s) => s.querySelector('h3').textContent === 'Surface');
      const hasRows = () => !surface.querySelector('label.label-row').closest('[hidden]');
      return { withObject: hasRows(), note: surface.querySelector('.muted')?.hidden };
    });
    t.ok(none.withObject && none.note === true, 'with an object active the Surface shows its rows and no note');

    // Two objects: the name follows the active one, and says Several over a mixed selection.
    await page.evaluate(() => [...document.querySelectorAll('.bz-menuname')].find((b) => b.textContent === 'Edit').click());
    await page.waitForFunction(() => !!document.querySelector('.bz-menuname.is-open') && document.querySelector('.bz-menuname.is-open').textContent === 'Edit', null, { timeout: 5000 });
    await page.evaluate(() => [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].find((b) => b.textContent === 'Duplicate').click());
    await page.waitForFunction(() => window.__sculpt.session.getMeshes().length === 2, null, { timeout: 10_000 });
    await settle(page, 300);
    const two = await page.evaluate(() => {
      const { session, library } = window.__sculpt;
      const [a, b] = session.getMeshes();
      const gold = library.create('Gold');
      library.assign(b, gold.id);
      const names = {};
      session.selectSet([a]);
      names.a = document.querySelector('.panel--material [data-role="material-name"]').children[1].textContent;
      session.selectSet([b]);
      names.b = document.querySelector('.panel--material [data-role="material-name"]').children[1].textContent;
      session.selectSet([a, b]);
      names.both = document.querySelector('.panel--material [data-role="material-name"]').children[1].textContent;
      return { a: library.materialFor(a).name, names };
    });
    t.ok(two.names.a === two.a && two.names.b === 'Gold' && two.names.both === 'Several', `the Material row follows the active object and says Several over a mixed selection (${JSON.stringify(two)})`);

    // Phone: three left tabs and two right tabs on 390px.
    const errors = await onPhone(page, async (p) => {
      await openSculpt(p, base);
      const r = await tabs(p);
      t.eq(r.map((x) => x.name).join(','), 'Scene,Model,Material,Tool,Render', 'on a phone the five tabs are Scene, Model, Material, Tool, Render');
      fitChecks(t, r, 390, 'Sculpt at 390');
      await tab(p, 'panel--material');
      await settle(p, 300);
      const open = await p.evaluate(() => {
        const r = document.querySelector('.panel--material').getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, scroll: document.documentElement.scrollWidth - innerWidth };
      });
      t.ok(open.left >= 0 && open.right <= 390 && open.bottom <= 844 && open.scroll <= 0, `the open Material panel fits the phone (${JSON.stringify(open)})`);
      const sections = await sectionsOf(p, 'panel--material');
      t.eq(Object.keys(sections).join(','), 'Surface,Display', 'with both sections');
    });
    t.ok(!errors.length, `no page errors on the phone${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  // With no object the Surface says so, in one quiet line.
  async materialNoObject(page, base, t) {
    await openSculpt(page, base);
    await tab(page, 'panel--material');
    const deleted = await page.evaluate(() => {
      const { session } = window.__sculpt;
      for (const m of [...session.getMeshes()]) session.deleteMesh?.(m);
      return session.getMeshes().length;
    });
    if (deleted !== 0) {
      // No direct way in this build: the Scene panel's trash, as a person would.
      await tab(page, 'panel--scene');
      await page.evaluate(() => document.querySelector('.panel--scene [aria-label="Delete object"], .panel--scene [title="Delete object"]')?.click());
      await tab(page, 'panel--material');
    }
    await settle(page, 500);
    const state = await page.evaluate(() => {
      const surface = [...document.querySelectorAll('.panel--material .section')].find((s) => s.querySelector('h3').textContent === 'Surface');
      const note = surface.querySelector('.muted');
      return { objects: window.__sculpt.session.getMeshes().length, note: note && !note.hidden ? note.textContent : null, rows: !!surface.querySelector('label.label-row:not([hidden] *)') };
    });
    t.ok(state.objects === 0 && state.note === 'No object is selected.' && !state.rows, `with no object, the Surface says so and has no rows (${JSON.stringify(state)})`);
  },

  // Armature: the Material tab beside the Armature tab; Render keeps no Mode.
  async materialArmature(page, base, t) {
    await openArmature(page, base);
    await page.addStyleTag({ content: '.panel, .panel * { transition: none !important; }' });
    const row = await tabs(page);
    t.eq(row.filter((x) => x.side === 'left').map((x) => x.name).join(','), 'Armature,Material', 'Armature has the Armature and Material tabs on the left');
    fitChecks(t, row, 1280, 'Armature');
    await tab(page, 'panel--material');
    t.ok(await isOpen(page, 'panel--material'), 'the Material tab opens its panel');
    const mat = await sectionsOf(page, 'panel--material');
    t.eq(Object.keys(mat).join(','), 'Display', 'with the Display section alone: a figure has no Surface');
    t.eq(mat.Display.join(','), 'Mode,Smooth shading,Wireframe (Shift + W),Wire opacity', 'Mode, Smooth shading, Wireframe, Wire opacity');
    await tab(page, 'panel--armature');
    t.ok((await isOpen(page, 'panel--armature')) && !(await isOpen(page, 'panel--material')), 'one panel on the left: Armature closes it');
    await tab(page, 'panel--render');
    const render = await sectionsOf(page, 'panel--render');
    t.ok(!Object.keys(render).includes('Material') && Object.keys(render)[0] === 'Lighting', `Render starts at Lighting (${Object.keys(render).join(', ')})`);
    await tab(page, 'panel--render');
    await page.evaluate(() => document.activeElement?.blur?.());
    await tab(page, 'panel--material');
    await page.keyboard.press('Shift+W');
    await settle(page);
    t.eq(
      JSON.stringify(await page.evaluate(() => ({ on: window.__bozzetto.isWireframe(), box: [...document.querySelectorAll('.panel--material .checkbox')].find((c) => c.textContent.startsWith('Wireframe')).querySelector('input').checked }))),
      '{"on":true,"box":true}',
      'Shift+W turns the wireframe on and the switch follows',
    );
  },

  // Present's workspace: the Material tab after Frames and Project; Render has
  // no Material section. And the public viewer keeps Mode in its Render panel.
  async materialPresent(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}/create/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.panel--frames input[type="file"]', { state: 'attached', timeout: 30_000 });
    const { resolve } = await import('node:path');
    const dir = resolve('dist/timelapses/demo/frames/sd');
    await page.setInputFiles('.panel--frames input[type="file"]', [0, 1, 2].map((i) => resolve(dir, `${String(i).padStart(4, '0')}.glb`)));
    await page.waitForFunction(() => document.querySelector('.panel--frames .bz-rowline .bz-val')?.textContent === '3' && !!window.__bozzetto?.pipeline, null, { timeout: 90_000 });
    await settle(page, 400);
    const row = await tabs(page);
    t.eq(row.filter((x) => x.side === 'left').map((x) => x.name).join(','), 'Frames,Project,Material', 'Present has Frames, Project, Material on the left');
    t.eq(row.filter((x) => x.side === 'right').map((x) => x.name).join(','), 'Render,Output', 'and Render and Output on the right');
    await tab(page, 'panel--material');
    t.ok(await isOpen(page, 'panel--material'), 'the Material tab opens');
    t.ok(!(await isOpen(page, 'panel--frames')), 'and closes Frames');
    const mat = await sectionsOf(page, 'panel--material');
    t.eq(Object.keys(mat).join(','), 'Display', 'its one section is Display (the model has no active object)');
    t.eq(mat.Display.slice(0, 1).join(), 'Mode', 'with Mode first');
    t.ok(['Smooth shading', 'Wireframe (Shift + W)', 'Wire opacity'].every((l) => mat.Display.includes(l)), `and Smooth shading, Wireframe and Wire opacity (${mat.Display.join(', ')})`);
    // The published model's own Albedo, Roughness and Metalness, over Lit.
    t.ok(['Albedo', 'Roughness', 'Metalness'].every((l) => mat.Display.includes(l)), `with the model's own Albedo, Roughness and Metalness, as Render had them (${mat.Display.join(', ')})`);
    await tab(page, 'panel--render');
    const render = await sectionsOf(page, 'panel--render');
    t.ok(!Object.keys(render).includes('Material') && Object.keys(render)[0] === 'Lighting', `Render has no Material section and starts at Lighting (${Object.keys(render).join(', ')})`);
    const strays = Object.values(render).flat().filter((l) => /^(Mode$|Albedo|Roughness|Metalness|Smooth shading|Wire)/.test(l));
    t.ok(!strays.length, `none of its controls are in Render (${strays.join(', ')})`);
    // The same controls work: Mode, Wireframe, Shift+W.
    await page.selectOption('.panel--material select', 'matcap');
    await settle(page);
    t.eq(await page.evaluate(() => window.__bozzetto.getMaterial()), 'matcap', 'Mode: Matcap changes the view');
    await page.selectOption('.panel--material select', 'lit');
    await page.click('.panel--material .checkbox:has-text("Wireframe")');
    t.eq(await page.evaluate(() => window.__bozzetto.isWireframe()), true, 'the Wireframe switch turns it on');
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Shift+W');
    await settle(page);
    t.eq(
      JSON.stringify(await page.evaluate(() => ({ on: window.__bozzetto.isWireframe(), box: [...document.querySelectorAll('.panel--material .checkbox')].find((c) => c.textContent.startsWith('Wireframe')).querySelector('input').checked }))),
      '{"on":false,"box":false}',
      'Shift+W turns it off and the switch follows',
    );
    // A rebuilt view (a frame added) keeps the tab, and the tab keeps its place.
    const dir2 = resolve('dist/timelapses/demo/frames/sd');
    await tab(page, 'panel--frames');
    await page.setInputFiles('.panel--frames input[type="file"]', [resolve(dir2, '0003.glb')]);
    await page.waitForFunction(() => document.querySelector('.panel--frames .bz-rowline .bz-val')?.textContent === '4' && !!window.__bozzetto?.pipeline, null, { timeout: 90_000 });
    await settle(page, 400);
    const again = await tabs(page);
    t.eq(again.filter((x) => x.side === 'left').map((x) => x.name).join(','), 'Frames,Project,Material', 'after the view is rebuilt for a new frame the three tabs are still there');
    t.eq(await page.evaluate(() => document.querySelectorAll('.panel--material').length), 1, 'once');
    // The phone: five tabs on 390px.
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, 500);
    const r = await tabs(page);
    fitChecks(t, r, 390, 'Present at 390');
    await page.setViewportSize({ width: 1280, height: 800 });
    t.ok(!errors.length, `no page errors (${errors.join(' | ')})`);

    // The public viewer: Render alone, with its Mode.
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await settle(page, 300);
    const viewerTabs = await tabs(page);
    t.eq(viewerTabs.map((x) => x.name).join(','), 'Render', 'the viewer has the one Render tab');
    t.ok(!(await page.$('.panel--material')), 'and no Material panel');
    await tab(page, 'panel--render');
    const vr = await sectionsOf(page, 'panel--render');
    t.ok(Object.keys(vr)[0] === 'Material' && vr.Material.includes('Mode') && vr.Material.some((l) => /Wireframe/.test(l)) && vr.Material.includes('Smooth shading'), `its Render panel still opens with Material: Mode, Smooth shading, Wireframe (${JSON.stringify(vr.Material)})`);
    await page.selectOption('.panel--render select', 'matcap');
    await settle(page);
    t.eq(await page.evaluate(() => window.__bozzetto.getMaterial()), 'matcap', 'and Mode works there');
    t.ok(!errors.length, 'no page errors');
  },
};
