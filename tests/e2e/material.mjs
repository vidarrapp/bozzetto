// The Material tab: on the right edge, after Tool, holding
// the active object's Surface (Albedo, Roughness, Metalness) and the Display
// (Mode and its matcap, Smooth shading, Wireframe, Wire opacity), both moved
// out of the Model and Render panels. In Armature it is the right edge's first
// tab; in the Present workspace it stands before Output, and in the public
// viewer before Lighting.
// Each gets (page, base, t).
import { openArmature, openSculpt } from './lib.mjs';

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

export const suites = {
  // Sculpt: the tab, its two sections, what Model no longer has,
  // the albedo, the mode and the wireframe working from it.
  async material(page, base, t) {
    await openSculpt(page, base);
    await page.addStyleTag({ content: '.panel, .panel * { transition: none !important; }' });

    // The tabs: Scene, Model, Layers at the left; Tool, Material, Reference at the right.
    const row = await tabs(page);
    t.eq(row.filter((x) => x.side === 'left').map((x) => x.name).join(','), 'Scene,Model,Layers', 'the left edge has Scene, Model, Layers, in that order');
    t.eq(row.filter((x) => x.side === 'right').map((x) => x.name).join(','), 'Tool,Material,Reference', 'and the right edge Tool, Material, Reference');
    fitChecks(t, row, 1280, 'Sculpt at 1280');

    // At most one panel a side.
    await tab(page, 'panel--scene');
    await tab(page, 'panel--material');
    t.ok((await isOpen(page, 'panel--material')) && (await isOpen(page, 'panel--scene')), 'Material is on the right: opening it leaves Scene open at the left');
    await tab(page, 'panel--reference');
    t.ok((await isOpen(page, 'panel--reference')) && !(await isOpen(page, 'panel--material')), 'opening Reference closes Material (one panel a side)');
    await tab(page, 'panel--sculpt');
    t.ok((await isOpen(page, 'panel--sculpt')) && !(await isOpen(page, 'panel--reference')), 'and Tool closes Reference');
    await tab(page, 'panel--material');
    t.ok(!(await isOpen(page, 'panel--sculpt')), 'and Material closes Tool');
    await tab(page, 'panel--scene');
    t.eq(await page.evaluate(() => document.querySelector('.panel--material .panel__title').textContent), 'Material', 'the panel is headed Material');
    t.eq(await page.evaluate(() => localStorage.getItem('bz.panels.sculpt')), '["material"]', 'and the panel memory keeps it');

    // Its sections.
    const mat = await sectionsOf(page, 'panel--material');
    t.eq(Object.keys(mat).join(','), 'Surface,Display', 'Material has two sections, Surface and Display');
    t.eq(mat.Surface.join(','), 'Material,Albedo,Roughness,Metalness', 'Surface: the assigned Material, Albedo, Roughness, Metalness');
    t.eq(mat.Display.join(','), 'Mode,Smooth shading,Wireframe,Wire opacity,Cavity,Strength,Radius', `Display: Mode, Smooth shading, Wireframe, Wire opacity, Cavity with its Strength and Radius (${mat.Display.join(',')})`);

    // Gone from Model: a control is shown once.
    await tab(page, 'panel--model');
    const model = await sectionsOf(page, 'panel--model');
    t.eq(Object.keys(model)[0], 'Topology', `the Model panel starts at Topology (${Object.keys(model).join(', ')})`);
    t.ok(!Object.keys(model).includes('Material') && !Object.values(model).flat().some((l) => /Albedo|Roughness|Metalness/.test(l)), 'with no Material section and no Albedo, Roughness or Metalness');
    await tab(page, 'panel--model');

    // The Albedo: the active object's, changed from here.
    if (!(await isOpen(page, 'panel--material'))) await tab(page, 'panel--material');
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

  // Armature: the Material tab beside the Armature tab; no Render tab, and no Cavity.
  async materialArmature(page, base, t) {
    await openArmature(page, base);
    await page.addStyleTag({ content: '.panel, .panel * { transition: none !important; }' });
    const row = await tabs(page);
    t.eq(row.filter((x) => x.side === 'left').map((x) => x.name).join(','), 'Armature', 'Armature has its own tab on the left');
    t.eq(row.filter((x) => x.side === 'right').map((x) => x.name).join(','), 'Material,Reference', 'and Material, Reference on the right');
    fitChecks(t, row, 1280, 'Armature');
    await tab(page, 'panel--material');
    t.ok(await isOpen(page, 'panel--material'), 'the Material tab opens its panel');
    const mat = await sectionsOf(page, 'panel--material');
    t.eq(Object.keys(mat).join(','), 'Display', 'with the Display section alone: a figure has no Surface');
    t.eq(mat.Display.join(','), 'Mode,Smooth shading,Wireframe,Wire opacity', 'Mode, Smooth shading, Wireframe, Wire opacity');
    await tab(page, 'panel--armature');
    t.ok((await isOpen(page, 'panel--armature')) && (await isOpen(page, 'panel--material')), 'Armature is on the other side: Material stays open');
    await tab(page, 'panel--reference');
    t.ok(!(await isOpen(page, 'panel--material')), 'and Reference, on the same side, closes Material');
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

  // Present's workspace: the Material tab after Frames and Project; the look tabs
  // have no Material section. And the public viewer keeps Mode in its Material tab.
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
    t.eq(row.filter((x) => x.side === 'left').map((x) => x.name).join(','), 'Lighting,Camera,Render', 'Present has Lighting, Camera, Render on the left');
    t.eq(row.filter((x) => x.side === 'right').map((x) => x.name).join(','), 'Frames,Project,Material,Output', 'and Frames, Project, Material and Output on the right');
    await tab(page, 'panel--material');
    t.ok(await isOpen(page, 'panel--material'), 'the Material tab opens');
    t.ok(!(await isOpen(page, 'panel--output')), 'and closes Output, on its side');
    const mat = await sectionsOf(page, 'panel--material');
    t.eq(Object.keys(mat).join(','), 'Display', 'its one section is Display (the model has no active object)');
    t.eq(mat.Display.slice(0, 1).join(), 'Mode', 'with Mode first');
    t.ok(['Smooth shading', 'Wireframe', 'Wire opacity'].every((l) => mat.Display.includes(l)), `and Smooth shading, Wireframe and Wire opacity (${mat.Display.join(', ')})`);
    // The published model's own Albedo, Roughness and Metalness, over Lit.
    t.ok(['Albedo', 'Roughness', 'Metalness'].every((l) => mat.Display.includes(l)), `with the model's own Albedo, Roughness and Metalness, as the old Render panel had them (${mat.Display.join(', ')})`);
    for (const cls of ['panel--lighting', 'panel--camera', 'panel--render']) {
      await tab(page, cls);
      const look = await sectionsOf(page, cls);
      const strays = Object.values(look).flat().filter((l) => /^(Mode$|Albedo|Roughness|Metalness|Smooth shading|Wire)/.test(l));
      t.ok(!Object.keys(look).includes('Material') && !strays.length, `${cls} holds no Material controls (${strays.join(', ')})`);
      await tab(page, cls);
    }
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
    t.eq(again.map((x) => `${x.side}:${x.name}`).join(','), 'left:Lighting,left:Camera,left:Render,right:Frames,right:Project,right:Material,right:Output', 'after the view is rebuilt for a new frame the seven tabs are still there');
    t.eq(await page.evaluate(() => document.querySelectorAll('.panel--material').length), 1, 'once');
    t.ok(!errors.length, `no page errors (${errors.join(' | ')})`);

    // The public viewer: Material and Lighting at the right, nothing at the left, and Mode in Material.
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await settle(page, 300);
    const viewerTabs = await tabs(page);
    t.eq(viewerTabs.map((x) => `${x.side}:${x.name}`).join(','), 'right:Material,right:Lighting', 'the viewer has the Material and Lighting tabs at the right and none at the left');
    await tab(page, 'panel--lighting');
    const vr = await sectionsOf(page, 'panel--lighting');
    t.ok(!Object.keys(vr).includes('Material') && Object.keys(vr)[0] === 'Rig', `its Lighting panel holds no Material and starts at Rig (${Object.keys(vr)})`);
    await tab(page, 'panel--material');
    const vm = await sectionsOf(page, 'panel--material');
    t.ok(Object.keys(vm).join() === 'Display' && vm.Display.includes('Mode') && vm.Display.some((l) => /Wireframe/.test(l)) && vm.Display.includes('Smooth shading'), `the Material panel has the Display section: Mode, Smooth shading, Wireframe (${JSON.stringify(vm)})`);
    await page.selectOption('.panel--material select', 'matcap');
    await settle(page);
    t.eq(await page.evaluate(() => window.__bozzetto.getMaterial()), 'matcap', 'and Mode works there');
    t.ok(!errors.length, 'no page errors');
  },
};
