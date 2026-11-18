// The details overlay (owner request, 2026-11-17): the object's numbers as
// plain text at the top left of the view in Sculpt and Armature, with a
// View > Details switch. The strip keeps only the scene's name and its state.
//
// detailsOverlay:
// - on by default; View > Details (and its key) hides and shows it; the
//   choice is remembered after a reload;
// - for a fresh sphere: name, Tris, Verts, Level, Size in cm; text only (no
//   box, no background), Familjen Grotesk for names and Martian Mono for
//   numbers, 11 to 13px; it takes no input;
// - it follows subdivide, a level change, the selection, the mask, symmetry
//   and a layer;
// - Tab hides it with the interface; Esc brings it back;
// - the pointer reaches the canvas through it, and a pen stroke through it
//   sculpts;
// - it stands clear of the tabs, the edge controls and an open left panel,
//   at 1180 wide (a phone is not a target; it only must not throw);
// - Armature: name, height, Tris, the selected joint, symmetry;
// - the strip shows only the name and state in Sculpt and in Armature.
import { openArmature, openSculpt } from './lib.mjs';
import { devices, line, meshSum, openForInput, settle } from './smoke.mjs';

const fact = (page, id) =>
  page.evaluate((i) => {
    const row = document.querySelector(`.bz-details [data-fact="${i}"]`);
    if (!row) return null;
    return (row.querySelector('.bz-details__val') ?? row.querySelector('.bz-details__name')).textContent;
  }, id);
const facts = (page) =>
  page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.bz-details [data-fact]')].map((r) => [r.dataset.fact, r.textContent])));
const seen = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.bz-details');
    if (!el) return false;
    const s = getComputedStyle(el);
    return !el.hidden && s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0;
  });
const waitFact = (page, id, test, arg = null, timeout = 4000) =>
  page
    .waitForFunction(
      ([i, src, a]) => {
        const row = document.querySelector(`.bz-details [data-fact="${i}"]`);
        const v = row ? (row.querySelector('.bz-details__val') ?? row.querySelector('.bz-details__name')).textContent : null;
        // eslint-disable-next-line no-new-func
        return new Function('v', 'a', `return ${src}`)(v, a);
      },
      [id, test, arg],
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
const checkedItem = (page, label) =>
  page.evaluate((l) => {
    const item = [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].find((b) => b.querySelector('.file-menu__label')?.textContent === l);
    return item ? item.getAttribute('aria-checked') === 'true' : null;
  }, label);
const openViewMenu = async (page) => {
  if (await page.evaluate(() => !!document.querySelector('.bz-menuname.is-open'))) return;
  await page.evaluate(() => [...document.querySelectorAll('.bz-menuname')].find((b) => b.textContent === 'View')?.click());
  await page.waitForFunction(() => document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
};
/** View > Details, as a person clicks it; the menu is put away after. */
const clickDetails = async (page) => {
  await openViewMenu(page);
  await page.evaluate(() => [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].find((b) => b.querySelector('.file-menu__label')?.textContent === 'Details').click());
  if (await page.evaluate(() => !!document.querySelector('.bz-menuname.is-open'))) await closeMenu(page);
  await page.waitForTimeout(200);
};
const closeMenu = async (page) => {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
};
const rect = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, sel);
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Every visible left tab, the edge column and any open panel: what the overlay must stand clear of. */
const neighbours = (page) =>
  page.evaluate(() => {
    const out = [];
    const take = (name, el) => {
      if (!el || el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      out.push({ name, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    };
    for (const h of document.querySelectorAll('.panel > .panel__handle')) take('tab', h);
    take('edge', document.querySelector('.bz-edge'));
    take('strip', document.querySelector('.bz-strip'));
    for (const p of document.querySelectorAll('.panel:not(.panel--collapsed)')) take(`panel ${p.className}`, p);
    take('toolbar', document.querySelector('.sculpt-toolbar__brushes'));
    return out;
  });

async function clearOfEverything(page, t, label) {
  const o = await rect(page, '.bz-details');
  const visible = await seen(page);
  if (!visible) {
    t.ok(true, `${label}: the overlay is away, so it is clear of everything`);
    return;
  }
  const clash = (await neighbours(page)).filter((n) => overlaps(o, n));
  t.ok(clash.length === 0, `${label}: clear of the strip, the tabs, the edge controls, any panel and the tool bar (${JSON.stringify(clash.map((c) => c.name))}; overlay ${JSON.stringify(o)})`);
}

export const suites = {
  async detailsOverlay(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base);
    t.ok(await seen(page), 'the details overlay is on by default');
    const f = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const mesh = session.getMesh();
      const b = mesh.computeWorldBound();
      const levels = session.getLevels();
      return {
        name: session.activeName(),
        tris: mesh.getNbTriangles().toLocaleString('en-US'),
        verts: mesh.getNbVertices().toLocaleString('en-US'),
        level: levels && levels.levels > 0 ? `${levels.sel + 1} of ${levels.levels}` : null,
        units: session.getUnits(),
        size: `${(b[4] - b[1]).toFixed(1)} × ${(b[3] - b[0]).toFixed(1)} × ${(b[5] - b[2]).toFixed(1)} cm`,
      };
    });
    const shown = await facts(page);
    t.eq(await fact(page, 'name'), f.name, `the active object's name (${f.name})`);
    t.eq(await fact(page, 'tris'), f.tris, `Tris (${f.tris})`);
    t.eq(await fact(page, 'verts'), f.verts, `Verts (${f.verts})`);
    t.eq(await fact(page, 'level'), f.level, `Level n of m (${f.level})`);
    t.eq(f.units, 'cm', 'a fresh scene is in real units');
    t.eq(await fact(page, 'size'), f.size, `Size height by width by depth in cm (${f.size})`);
    t.eq(await fact(page, 'objects'), '1', 'Objects 1, with no selected count while one is picked');
    t.ok(!('masked' in shown) && !('hidden' in shown) && !('layer' in shown), `only the facts that apply (${Object.keys(shown).join(', ')})`);

    // Plain text: no box, no background, no input; the two faces and the sizes.
    const style = await page.evaluate(() => {
      const el = document.querySelector('.bz-details');
      const cs = getComputedStyle(el);
      const name = getComputedStyle(el.querySelector('.bz-details__name'));
      const val = getComputedStyle(el.querySelector('.bz-details__val'));
      const key = getComputedStyle(el.querySelector('.bz-details__key'));
      const pre = (s) => s.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      return {
        bg: cs.backgroundColor,
        border: cs.borderTopWidth,
        events: cs.pointerEvents,
        pos: cs.position,
        name: [pre(name), name.fontSize],
        val: [pre(val), val.fontSize],
        key: [pre(key), key.fontSize],
        colour: cs.color,
        text: getComputedStyle(document.body).getPropertyValue('--bz-text').trim(),
        childEvents: [...el.querySelectorAll('*')].every((c) => getComputedStyle(c).pointerEvents === 'none'),
      };
    });
    t.ok(/rgba\(0, 0, 0, 0\)|transparent/.test(style.bg) && style.border === '0px', `no background and no box (${style.bg}, ${style.border})`);
    t.ok(style.events === 'none' && style.childEvents, 'it takes no input: pointer-events none on it and all it holds');
    t.ok(/Familjen/.test(style.name[0]) && /Familjen/.test(style.key[0]), `names and labels are Familjen Grotesk (${style.name[0]}, ${style.key[0]})`);
    t.ok(/Martian/.test(style.val[0]), `numbers are Martian Mono (${style.val[0]})`);
    t.ok([style.name[1], style.val[1], style.key[1]].every((s) => parseFloat(s) >= 11 && parseFloat(s) <= 13), `11 to 13px (${style.name[1]}, ${style.key[1]}, ${style.val[1]})`);

    // View > Details: a check item in the looks group, after Shadows.
    await openViewMenu(page);
    const labels = await page.evaluate(() => [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item .file-menu__label')].map((l) => l.textContent));
    t.ok(labels.indexOf('Details') === labels.indexOf('Shadows') + 1, `View has Details after Shadows (${labels.slice(0, 6).join('|')})`);
    t.eq(await checkedItem(page, 'Details'), true, 'and it is checked');
    await clickDetails(page);
    t.ok(!(await seen(page)), 'View > Details hides it');
    await openViewMenu(page);
    t.eq(await checkedItem(page, 'Details'), false, 'the check goes');
    await clickDetails(page);
    t.ok(await seen(page), 'and shows it again');
    t.eq(await fact(page, 'tris'), f.tris, 'with its numbers read afresh');

    // Its key.
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Shift+I');
    await page.waitForTimeout(200);
    t.ok(!(await seen(page)), 'Shift+I hides it');
    await page.keyboard.press('Shift+I');
    await page.waitForTimeout(200);
    t.ok(await seen(page), 'and shows it');
  },

  async detailsRemembered(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Shift+I');
    await page.waitForTimeout(200);
    t.ok(!(await seen(page)), 'switched off');
    await openSculpt(page, base);
    t.ok(!(await seen(page)), 'it stays off after a reload');
    await openViewMenu(page);
    t.eq(await checkedItem(page, 'Details'), false, 'and the View item is unchecked');
    await clickDetails(page);
    await openSculpt(page, base);
    t.ok(await seen(page), 'switched on again, it stays on after a reload');
  },

  async detailsFollows(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base);
    const before = { tris: await fact(page, 'tris'), verts: await fact(page, 'verts'), level: await fact(page, 'level') };
    // Subdivide (Ctrl+D's own command): more triangles, a higher level.
    await page.evaluate(() => window.__sculpt.session.subdivide());
    t.ok(await waitFact(page, 'tris', 'v !== a', before.tris), `Subdivide: Tris move (${before.tris} then ${await fact(page, 'tris')})`);
    const after = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const l = session.getLevels();
      return { level: `${l.sel + 1} of ${l.levels}`, tris: session.getMesh().getNbTriangles().toLocaleString('en-US'), verts: session.getMesh().getNbVertices().toLocaleString('en-US') };
    });
    t.eq(await fact(page, 'tris'), after.tris, 'to the new count');
    t.eq(await fact(page, 'verts'), after.verts, 'and Verts follow');
    t.eq(await fact(page, 'level'), after.level, `and Level (${after.level})`);

    // A level change.
    const low = await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.selectLevel(0);
      return session.getMesh().getNbTriangles().toLocaleString('en-US');
    });
    t.ok(await waitFact(page, 'level', 'v.startsWith("1 of")'), `a level change: Level says 1 of n (${await fact(page, 'level')})`);
    t.ok(await waitFact(page, 'tris', 'v === a', low), `and Tris are the lower level's (${low})`);

    // The selection: a second object, then both selected.
    await page.evaluate(() => window.__sculpt.session.addPrimitive('cube'));
    t.ok(await waitFact(page, 'name', 'v === "Cube"'), 'a new active object: its name');
    t.ok(await waitFact(page, 'objects', 'v === "2"'), 'Objects 2');
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.selectSet(session.getMeshes());
    });
    t.ok(await waitFact(page, 'objects', 'v === "2, 2 selected"'), `two selected says so (${await fact(page, 'objects')})`);
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.setMesh(session.getMeshes()[0]);
    });
    t.ok(await waitFact(page, 'name', 'v === "Sphere"'), 'back on the first: its name');

    // Quads: a cube has them.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.setMesh(session.getMeshes()[1]);
    });
    const quads = await page.evaluate(() => window.__sculpt.session.getMesh().getNbQuads());
    t.ok(quads > 0 ? await waitFact(page, 'quads', `v === "${quads.toLocaleString('en-US')}"`) : (await fact(page, 'quads')) === null, `Quads where the mesh has them (${quads})`);
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.setMesh(session.getMeshes()[0]);
    });

    // Symmetry, the mask, a layer.
    const sym = await page.evaluate(() => {
      const { session } = window.__sculpt;
      if (!session.getSymmetry()) session.toggleSymmetry();
      return session.getSymmetryAxis().toUpperCase();
    });
    t.ok(await waitFact(page, 'symmetry', `v === "${sym}"`), `Symmetry ${sym} while it is on`);
    await page.evaluate(() => window.__sculpt.session.toggleSymmetry());
    t.ok(await waitFact(page, 'symmetry', 'v === null'), 'and gone when it is off');
    t.eq(await fact(page, 'masked'), null, 'no Masked line while nothing is masked');
    await page.evaluate(() => {
      const mesh = window.__sculpt.session.getMesh();
      const mat = mesh.getMaterials();
      const n = mesh.getNbVertices();
      for (let i = 0; i < Math.floor(n / 4); i++) mat[i * 3 + 2] = 0;
    });
    t.ok(await waitFact(page, 'masked', '/^2[0-9]%$/.test(v)'), `Masked n% once a quarter is masked (${await fact(page, 'masked')})`);
    await page.evaluate(() => {
      const mesh = window.__sculpt.session.getMesh();
      mesh.getMaterials().fill(1);
      const mat = mesh.getMaterials();
      for (let i = 0; i < mesh.getNbVertices(); i++) mat[i * 3 + 2] = 1;
    });
    t.ok(await waitFact(page, 'masked', 'v === null'), 'the line goes with the mask');
    t.eq(await fact(page, 'layer'), null, 'no Layer line while there are no layers');
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.layers.add(session.getMesh(), 'Wrinkles');
    });
    t.ok(await waitFact(page, 'layer', 'v === "Wrinkles"'), `Layer names the active layer (${await fact(page, 'layer')})`);
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.layers.setActive(session.getMesh(), null);
    });
    t.ok(await waitFact(page, 'layer', 'v === "Base"'), 'and Base when the base is active');
    // In Paint the Layer line is the active paint layer (or group), not the sculpt layer.
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    await page.waitForFunction(() => window.__sculpt.paintWorkspace.isOn(), null, { timeout: 5000 });
    t.ok(await waitFact(page, 'layer', 'v === null'), 'in Paint there is no Layer line while the object has no paint layers (the sculpt layer is not shown there)');
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.add(session.getMesh(), 'Cheeks');
    });
    t.ok(await waitFact(page, 'layer', 'v === "Cheeks"'), `in Paint, Layer names the active paint layer (${await fact(page, 'layer')})`);
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.setActive(session.getMesh(), session.paint.addGroup(session.getMesh(), 'Skin'));
    });
    t.ok(await waitFact(page, 'layer', 'v === "Skin"'), 'and the group when a group is active');
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.setActive(session.getMesh(), null);
    });
    t.ok(await waitFact(page, 'layer', 'v === "Base"'), 'and Base when the base is active');
    await page.evaluate(() => window.__sculpt.paintWorkspace.leave());
    await page.waitForFunction(() => !window.__sculpt.paintWorkspace.isOn(), null, { timeout: 5000 });
    t.ok(await waitFact(page, 'layer', 'v === "Base"'), "back in Sculpt it is the sculpt layer's again");
  },

  async detailsTab(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Tab');
    await page.waitForFunction(() => document.body.classList.contains('chrome-hidden'), null, { timeout: 5000 });
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.bz-details')).visibility === 'hidden', null, { timeout: 4000 }).catch(() => {});
    t.ok(!(await seen(page)), 'Tab hides it with the interface');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.body.classList.contains('chrome-hidden'), null, { timeout: 5000 });
    await page.waitForTimeout(300);
    t.ok(await seen(page), 'and Esc brings it back');
  },

  async detailsThrough(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    // Zoom in until the sphere fills the view, so the overlay's text lies over the model.
    await page.evaluate(() => {
      const { session, viewer } = window.__sculpt;
      const b = session.getMesh().computeWorldBound();
      const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      const r = (b[3] - b[0]) / 2;
      viewer.controls.setState([c[0], c[1], c[2] + r * 1.25], c);
    });
    await settle(page);
    const at = await page.evaluate(() => {
      const row = document.querySelector('.bz-details__line');
      const r = row.getBoundingClientRect();
      const x = r.left + 12;
      const y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return { x, y, tag: top?.tagName, cls: top?.className ?? '', inOverlay: !!top?.closest?.('.bz-details') };
    });
    t.ok(at.tag === 'CANVAS' && !at.inOverlay, `over its text the element under the pointer is the canvas (${at.tag} ${at.cls})`);
    const d = await devices(page);
    const before = await meshSum(page);
    const strokes = await page.evaluate(() => window.__sculpt.input.strokeCount());
    await d.penDrag(line([at.x, at.y], [at.x + 160, at.y + 90], 6));
    await page.waitForTimeout(400);
    const after = await meshSum(page);
    t.ok((await page.evaluate(() => window.__sculpt.input.strokeCount())) > strokes && after !== before, 'a pen stroke begun on its text sculpts the model');
  },

  async detailsPlace(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base);
    await page.waitForTimeout(300);
    const o = await rect(page, '.bz-details');
    const tabs = (await neighbours(page)).filter((n) => n.name === 'tab');
    t.ok(tabs.length > 0 && o.top >= Math.max(...tabs.map((x) => x.bottom)), `it starts under the tab row (overlay top ${o.top}, tabs end ${Math.max(...tabs.map((x) => x.bottom))})`);
    await clearOfEverything(page, t, 'panels closed');
    for (const cls of ['panel--scene', 'panel--model']) {
      await page.evaluate((c) => document.querySelector(`.${c} .panel__handle`).click(), cls);
      await page.waitForTimeout(300);
      const open = await rect(page, `.${cls}`);
      const now = await rect(page, '.bz-details');
      t.ok(await seen(page), `with ${cls} open the overlay still shows`);
      t.ok(now.left >= open.right, `and stands right of it (overlay ${now.left}, panel ends ${open.right})`);
      await clearOfEverything(page, t, `${cls} open`);
      await page.evaluate((c) => document.querySelector(`.${c} .panel__handle`).click(), cls);
      await page.waitForTimeout(300);
    }
    // A right panel open too: still clear of both.
    await page.evaluate(() => {
      document.querySelector('.panel--scene .panel__handle').click();
      document.querySelector('.panel--sculpt .panel__handle').click();
    });
    await page.waitForTimeout(300);
    await clearOfEverything(page, t, 'a left and a right panel open');
    // A phone is not a target, but the page must not throw at its width.
    await page.setViewportSize({ width: 390, height: 844 });
    await openSculpt(page, base);
    t.ok(await page.evaluate(() => !!document.querySelector('.bz-details')), 'at 390 wide the overlay is made and nothing throws');
  },

  async detailsArmature(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openArmature(page, base);
    await page.waitForTimeout(800);
    t.ok(await seen(page), 'Armature: the overlay is on');
    const s = await facts(page);
    t.ok(/^\d+(\.\d)? cm$/.test((await fact(page, 'height')) ?? ''), `the figure's height in cm (${s.height})`);
    t.ok(/^[\d,]+$/.test((await fact(page, 'tris')) ?? ''), `Tris (${s.tris})`);
    t.ok(!!(await fact(page, 'name')), `the figure's name (${s.name})`);
    t.eq(await fact(page, 'selected'), null, 'no part selected, no Joint line');
    await page.evaluate(() => window.__armature.select('upperarm.L'));
    t.ok(await waitFact(page, 'selected', 'v === "Upper arm (left)"', null, 3000), 'the selected joint');
    const sym = await page.evaluate(() => window.__armature.armature.symmetry);
    await page.evaluate((on) => {
      window.__armature.armature.symmetry = !on;
    }, sym);
    t.ok(await waitFact(page, 'symmetry', sym ? 'v === null' : 'v === "on"', null, 3000), 'Symmetry shows while it is on');
    // View > Details and Tab here too.
    await openViewMenu(page);
    t.eq(await checkedItem(page, 'Details'), true, 'View has Details, checked');
    await clickDetails(page);
    t.ok(!(await seen(page)), 'View > Details hides it');
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Shift+I');
    await page.waitForTimeout(250);
    t.ok(await seen(page), 'and its key shows it');
    await clearOfEverything(page, t, 'Armature 1180');
  },

  async detailsStrip(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    const strip = () =>
      page.evaluate(() => ({
        items: [...document.querySelectorAll('.bz-readout__item')].filter((i) => !i.hidden && getComputedStyle(i).display !== 'none').map((i) => i.textContent),
        text: [...(document.querySelector('.bz-readout')?.children ?? [])].filter((c) => !c.hidden && getComputedStyle(c).display !== 'none').map((c) => c.textContent).join(' '),
        name: document.querySelector('.bz-readout__name')?.textContent ?? '',
        state: document.querySelector('.bz-readout__edited')?.hidden === false ? document.querySelector('.bz-readout__edited').textContent : '',
      }));
    await openSculpt(page, base);
    await page.waitForTimeout(600);
    let s = await strip();
    t.ok(s.items.length === 0 && !/Object|Tris|Level/.test(s.text), `Sculpt: the strip says no Object, Tris or Level (${JSON.stringify(s.text)})`);
    await openArmature(page, base);
    await page.waitForTimeout(800);
    s = await strip();
    t.ok(s.items.length === 0 && !/Tris/.test(s.text), `Armature: no selected part and no Tris in the strip (${JSON.stringify(s.text)})`);
    t.ok(!!s.name && /^(Saved|Edited|Kept on this device|Not saved)$/.test(s.state), `Armature: the strip has the name and the state word (${s.name}, ${s.state})`);
  },
};
