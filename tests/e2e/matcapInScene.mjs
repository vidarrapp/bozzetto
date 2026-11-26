// The Scene panel's Material row shows a matcap in use.
//
// matcapInScene:
// - in Matcap the Material select's chosen option is "Matcap: <label>", first, and follows a change of
//   matcap made in the Material panel's picker;
// - choosing one of the scene's materials there assigns it and the view goes back to Lit, and the
//   "Matcap:" option is gone;
// - back in Lit by the Material panel, the Matcap option goes too.
import { openSculpt } from './lib.mjs';

const SEL = '.outliner__material select';
const chosen = (page) => page.evaluate((s) => document.querySelector(s).selectedOptions[0]?.textContent ?? '', SEL);
const options = (page) => page.evaluate((s) => [...document.querySelector(s).options].map((o) => o.textContent), SEL);

export const suites = {
  async matcapInScene(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base);
    // The Material panel is where the view's mode is chosen: open it as the panel's own event does.
    await page.evaluate(() => {
      for (const id of ['scene', 'material']) window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id, open: true } }));
    });
    await page.waitForFunction(() => document.querySelector('.outliner__material select')?.offsetParent !== null, null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector('.panel--material select')?.offsetParent !== null, null, { timeout: 10000 });
    await page.selectOption('.panel--material select', 'matcap');
    await page.waitForFunction(() => document.querySelector('.outliner__material select')?.selectedOptions[0]?.textContent.startsWith('Matcap: '), null, { timeout: 5000 });
    const first = await chosen(page);
    t.eq(first, 'Matcap: VR01', `in Matcap the select says the matcap in use (${first})`);
    t.eq((await options(page))[0], first, 'and that option comes first');

    // The Material panel's picker: a different matcap is followed at once.
    // The picker lists the scene's own matcaps: VR08 comes into the scene, VR01 is back in use.
    await page.evaluate(() => { const m = window.__sculpt.viewer.materials; m.setMatcapIndex(7); m.setMatcapIndex(0); });
    await page.evaluate(() => document.querySelector('.mcpick__trigger').click());
    await page.waitForFunction(() => document.querySelector('.matcap-grid--pop .matcap-swatch'), null, { timeout: 5000 });
    await page.evaluate(() => document.querySelectorAll('.matcap-grid--pop .matcap-swatch')[1].click());
    await page.waitForFunction(() => document.querySelector('.outliner__material select')?.selectedOptions[0]?.textContent === 'Matcap: VR08', null, { timeout: 5000 });
    t.eq(await chosen(page), 'Matcap: VR08', 'a matcap picked in the Material panel is followed');

    // Choosing a scene material assigns it and returns the view to Lit.
    const ids = await page.evaluate((s) => [...document.querySelector(s).options].map((o) => o.value).filter((v) => v !== '__matcap__' && v !== '__new__' && v !== '__browse__'), SEL);
    t.ok(ids.length >= 1, `the scene's materials stay listed under it (${ids.join(', ')})`);
    await page.selectOption(SEL, ids[0]);
    await page.waitForFunction(() => window.__sculpt.viewer.getMaterial() === 'lit', null, { timeout: 5000 });
    t.eq(await page.evaluate(() => window.__sculpt.viewer.getMaterial()), 'lit', 'choosing a scene material puts the view in Lit');
    t.eq(await page.evaluate((s) => document.querySelector(s).value, SEL), ids[0], 'and the select shows that material');
    t.ok(!(await options(page)).some((n) => n.startsWith('Matcap:')), 'back in Lit the Matcap option is gone');

    // Back in Lit by the Material panel: the Matcap option goes.
    await page.selectOption('.panel--material select', 'matcap');
    await page.waitForFunction(() => document.querySelector('.outliner__material select')?.selectedOptions[0]?.textContent.startsWith('Matcap: '), null, { timeout: 5000 });
    await page.selectOption('.panel--material select', 'lit');
    await page.waitForFunction(() => !document.querySelector('.outliner__material select')?.selectedOptions[0]?.textContent.startsWith('Matcap: '), null, { timeout: 5000 });
    t.ok(!(await options(page)).some((n) => n.startsWith('Matcap:')), 'back in Lit by the Material panel, the Matcap option goes');

    t.eq(errors.length, 0, `no page errors (${errors.join(' | ')})`);
  },
};
