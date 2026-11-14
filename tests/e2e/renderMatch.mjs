// The Render panel is the same everywhere (owner call: "consolidate the render
// panel so it matches everywhere"): Sculpt, Armature, the public viewer (here),
// review mode (viewerFrame's viewerReview) and the Present workspace
// (framePresent) all open it on Lighting, Camera, Environment, Ambient
// occlusion, in that order, with the full per-light rig, a Reset look button
// and no Material (that is the left tab's). Here: the three places the plain
// static server reaches, Reset look in the viewer, and the viewer's tab row
// at a phone's width.
import { openArmature, openSculpt } from './lib.mjs';

export const RENDER_SECTIONS = 'Lighting,Camera,Environment,Ambient occlusion';

/** What the open Render panel shows: its visible section headings in order, the rig, the reset button. */
export const renderShape = (page) =>
  page.evaluate(() => {
    const shown = (el) => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
    const panel = document.querySelector('.panel--render');
    return {
      open: !!panel && !panel.classList.contains('panel--collapsed'),
      sections: [...panel.querySelectorAll('.section > h3')].filter(shown).map((h) => h.textContent),
      rig: [...panel.querySelectorAll('.light-controls .light')].filter(shown).length,
      toggles: panel.querySelectorAll('.light-toggles').length,
      reset: [...panel.querySelectorAll('button')].filter(shown).some((b) => b.textContent === 'Reset look'),
      materialRows: [...panel.querySelectorAll('label > span:first-child')].filter(shown).map((e) => e.textContent).filter((l) => /^(Mode|Smooth shading|Wireframe|Wire opacity)$/.test(l)),
    };
  });

/** The same shape, as checks, for the place `where`. */
export function shapeChecks(t, shape, where) {
  t.ok(shape.open, `${where}: the Render panel is open`);
  t.eq(shape.sections.join(), RENDER_SECTIONS, `${where}: sections ${RENDER_SECTIONS}, in that order`);
  t.ok(shape.rig >= 3 && shape.toggles === 0, `${where}: the full per-light rig, not simple on/off boxes (${shape.rig} lights)`);
  t.ok(shape.reset, `${where}: a Reset look button`);
  t.eq(shape.materialRows.join(), '', `${where}: no Material rows (they are the Material tab's)`);
}

const open = async (page) => {
  await page.click('.panel--render > .panel__handle');
  await page.waitForTimeout(500);
};

export const suites = {
  async renderMatch(page, base, t) {
    await openSculpt(page, base);
    await open(page);
    shapeChecks(t, await renderShape(page), 'Sculpt');

    await openArmature(page, base);
    await open(page);
    shapeChecks(t, await renderShape(page), 'Armature');

    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await page.waitForTimeout(300);
    await open(page);
    shapeChecks(t, await renderShape(page), 'The viewer');

    // Reset look in the viewer: back to the published look, the view where it is.
    const before = await page.evaluate(() => JSON.stringify(window.__bozzetto.lighting.serialize()));
    const cam = await page.evaluate(() => window.__bozzetto.getCameraState().position.map((n) => +n.toFixed(3)).join());
    await page.evaluate(() => {
      const v = window.__bozzetto;
      v.lighting.setEnabled(v.lighting.state()[0].id, !v.lighting.state()[0].enabled);
      v.setFocalLength(85);
      v.setDoF({ enabled: true });
    });
    const changed = await page.evaluate(() => JSON.stringify(window.__bozzetto.lighting.serialize()));
    t.ok(changed !== before, 'the viewer: a visitor changes a light, the lens and depth of field');
    await page.evaluate(() => [...document.querySelectorAll('.panel--render button')].find((b) => b.textContent === 'Reset look').click());
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({
      lights: JSON.stringify(window.__bozzetto.lighting.serialize()),
      lens: window.__bozzetto.getFocalLength(),
      dof: window.__bozzetto.getDoFState().enabled,
      cam: window.__bozzetto.getCameraState().position.map((n) => +n.toFixed(3)).join(),
      box: document.querySelector('.panel--render .dof-rows')?.closest('.section')?.querySelector('.checkbox input')?.checked,
    }));
    t.eq(after.lights, before, 'the viewer: Reset look puts the lights back as published');
    t.ok(after.lens !== 85 && after.dof === false && after.box === false, `and the lens and depth of field (${after.lens}mm, depth of field ${after.dof})`);
    t.eq(after.cam, cam, 'and leaves the view where the visitor has it');

    // The viewer's tab row on a phone: Material at the left, Render at the right, both inside the screen and clear of each other.
    const ctx = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
    try {
      const p = await ctx.newPage();
      await p.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
      await p.waitForTimeout(500);
      const row = await p.evaluate(() =>
        [...document.querySelectorAll('.panel > .panel__handle')]
          .filter((e) => e.getClientRects().length > 0)
          .map((e) => {
            const r = e.getBoundingClientRect();
            return { name: e.querySelector('.handle__label').textContent.trim(), l: Math.round(r.left), r: Math.round(r.right) };
          })
          .sort((a, b) => a.l - b.l),
      );
      t.eq(row.map((x) => x.name).join(), 'Material,Render', `at 390px the tab row is Material, Render (${JSON.stringify(row)})`);
      t.ok(row.length === 2 && row[0].l >= 0 && row[1].r <= 390 && row[0].r < row[1].l, 'both tabs fit on the screen and do not touch');
    } finally {
      await ctx.close();
    }
  },
};
