// Present's lights (package presentkeys): in Present 1, 2 and 3 pick which light
// hold-L (and View > Move light) moves, the picked light is named on the
// status line, and the lights show in the view while L is held and for a
// moment after a pick: one marker for each light that is on, the picked one
// orange, the others grey, drawn over the view and in no saved picture.
// Sculpt keeps 1, 2 and 3 for its tools and L for the key light, with no
// markers.
//
// presentLights: all of that.
import { openSculpt } from './lib.mjs';
import { tapTab } from './lookTabs.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/presentkeys';

const angles = (page) => page.evaluate(() => Object.fromEntries(window.__bozzetto.lighting.state().map((l) => [l.id, [l.azimuth, l.elevation]])));
const shown = (page) => page.evaluate(() => document.querySelector('.light-markers')?.dataset.shown ?? '');
const toast = (page) => page.evaluate(() => [...document.querySelectorAll('.sculpt-toast')].map((e) => e.textContent).join('|'));

export const suites = {
  async presentLights(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base, '&nosplash=1');
    await page.waitForFunction(() => !document.getElementById('overlay') && !!window.__bozzetto?.pipeline, null, { timeout: 60_000 });
    await page.evaluate(() => {
      const l = window.__bozzetto.lighting;
      l.setEnabled('fill', true);
      l.setEnabled('rim', true);
    });
    const counters = () => page.evaluate(() => window.__bozzetto.renderCounters());
    const grew = (a, b) => Object.fromEntries(Object.keys(a).filter((k) => b[k] !== a[k]).map((k) => [k, b[k] - a[k]]));
    // A hold of L with the mouse: the first move sets the reference, the second turns the light 10 degrees.
    const holdAndDrag = async (keep = false) => {
      await page.mouse.move(300, 300);
      await page.keyboard.down('l');
      await page.mouse.move(310, 300);
      await page.mouse.move(330, 300);
      if (!keep) await page.keyboard.up('l');
    };
    const changed = (a, b) => Object.keys(a).filter((id) => a[id][0] !== b[id][0] || a[id][1] !== b[id][1]).join();

    // --- Sculpt: the digits pick tools, L moves the key, no markers --------------------------
    const tool0 = await page.evaluate(() => window.__sculpt.input.currentToolIndex());
    await page.keyboard.press('2');
    t.ok((await page.evaluate(() => window.__sculpt.input.currentToolIndex())) !== tool0, 'in Sculpt the digit 2 still picks a tool');
    const s0 = await angles(page);
    await holdAndDrag(true);
    t.eq(changed(s0, await angles(page)), 'key', 'in Sculpt L moves the key light and no other');
    await page.waitForTimeout(400);
    t.eq(await shown(page), '', 'and no light markers show in Sculpt while it is held');
    await page.keyboard.up('l');

    // --- into Present: Key is the pick ------------------------------------------------------
    await page.evaluate(() => window.__sculpt.present.enter());
    await page.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 5000 });
    await tapTab(page, 'panel--lighting');
    const c0 = await counters();
    const p0 = await angles(page);
    await holdAndDrag();
    t.eq(changed(p0, await angles(page)), 'key', 'in Present, with nothing picked, L moves the key light');

    // --- 1, 2 and 3 --------------------------------------------------------------------------
    for (const [digit, id, word] of [['2', 'fill', 'Fill light'], ['3', 'rim', 'Rim light'], ['1', 'key', 'Key light']]) {
      await page.keyboard.press(digit);
      await page.waitForFunction((w) => [...document.querySelectorAll('.sculpt-toast')].some((e) => e.textContent === w), word, { timeout: 5000 });
      t.ok(true, `${digit} says "${word}" on the status line`);
      const before = await angles(page);
      await holdAndDrag();
      const after = await angles(page);
      t.eq(changed(before, after), id, `after ${digit}, L moves the ${id} light and no other (${JSON.stringify(before[id])} to ${JSON.stringify(after[id])})`);
      t.ok(Math.abs(after[id][0] - before[id][0]) > 8 && Math.abs(after[id][0] - before[id][0]) < 12, `by the drag's 20 pixels, a turn of ${after[id][0] - before[id][0]} degrees`);
    }
    // The Lighting tab follows.
    await page.keyboard.press('2');
    await holdAndDrag();
    const fillAz = (await angles(page)).fill[0];
    await page.waitForFunction((az) => {
      const box = document.querySelector('.panel--lighting .light[data-light="fill"]');
      return !!box && [...box.querySelectorAll('input')].some((i) => Number(i.value) === az);
    }, fillAz, { timeout: 5000 });
    t.ok(true, `the Lighting tab's Fill azimuth follows to ${fillAz}`);

    // --- an off light still turns, and the line says so -------------------------------------
    await page.evaluate(() => window.__bozzetto.lighting.setEnabled('rim', false));
    await page.keyboard.press('3');
    await page.waitForFunction(() => [...document.querySelectorAll('.sculpt-toast')].some((e) => e.textContent === 'Rim is off'), null, { timeout: 5000 });
    t.ok(true, 'picking a light that is off says "Rim is off"');
    const o0 = await angles(page);
    await holdAndDrag();
    t.eq(changed(o0, await angles(page)), 'rim', 'and moving it still turns it');
    t.eq(await page.evaluate(() => window.__bozzetto.lighting.state().find((l) => l.id === 'rim').enabled), false, 'without switching it on');
    await page.evaluate(() => window.__bozzetto.lighting.setEnabled('rim', true));

    // --- the markers --------------------------------------------------------------------------
    await page.keyboard.press('2');
    await page.waitForFunction(() => (document.querySelector('.light-markers')?.dataset.shown ?? '') === 'key,fill*,rim', null, { timeout: 5000 });
    t.ok(true, 'a pick shows one marker for each light that is on, the picked one marked');
    const ink = () =>
      page.evaluate(() => {
        const c = document.querySelector('.light-markers canvas');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let orange = 0;
        let grey = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 250) continue;
          if (Math.abs(d[i] - 255) < 6 && Math.abs(d[i + 1] - 90) < 6 && Math.abs(d[i + 2] - 31) < 6) orange++;
          else if (d[i] === 163 && d[i + 1] === 163 && d[i + 2] === 163) grey++;
        }
        return { orange, grey };
      });
    const ink1 = await ink();
    t.ok(ink1.orange > 100 && ink1.grey > 100, `the picked marker is orange and the others grey (${JSON.stringify(ink1)})`);
    await page.waitForFunction(() => (document.querySelector('.light-markers')?.dataset.shown ?? '') === '', null, { timeout: 6000 });
    t.ok(true, 'they go again after a moment');
    await page.evaluate(() => window.__bozzetto.lighting.setEnabled('rim', false));
    await page.mouse.move(300, 300);
    await page.keyboard.down('l');
    await page.waitForFunction(() => (document.querySelector('.light-markers')?.dataset.shown ?? '') === 'key,fill*', null, { timeout: 5000 });
    t.ok(true, 'L held shows them, and not the light that is off');
    await page.waitForTimeout(2200);
    t.eq(await shown(page), 'key,fill*', 'for as long as it is held');
    await page.keyboard.up('l');
    await page.waitForFunction(() => (document.querySelector('.light-markers')?.dataset.shown ?? '') === '', null, { timeout: 6000 });
    t.ok(true, 'and they go when it is let go');
    await page.evaluate(() => window.__bozzetto.lighting.setEnabled('rim', true));

    // Nothing in a saved picture: the same picture with and without L held.
    const still = () =>
      page.evaluate(async () => {
        const blob = await window.__sculpt.viewer.captureStill(1);
        const sum = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return [...new Uint8Array(sum)].map((b) => b.toString(16).padStart(2, '0')).join('');
      });
    const plain = await still();
    await page.mouse.move(300, 300);
    await page.keyboard.down('l');
    await page.waitForFunction(() => (document.querySelector('.light-markers')?.dataset.shown ?? '') !== '', null, { timeout: 5000 });
    const marked = await still();
    await page.keyboard.up('l');
    t.eq(marked, plain, 'a saved image with the markers up is the same picture as one without');

    // The second showing builds nothing.
    await page.keyboard.press('3');
    await page.waitForFunction(() => (document.querySelector('.light-markers')?.dataset.shown ?? '') !== '', null, { timeout: 5000 });
    await page.waitForTimeout(2500);
    const c1 = await counters();
    await page.keyboard.press('1');
    await page.waitForFunction(() => (document.querySelector('.light-markers')?.dataset.shown ?? '').includes('key*'), null, { timeout: 5000 });
    await holdAndDrag(true);
    await page.waitForTimeout(1500);
    await page.keyboard.up('l');
    t.eq(JSON.stringify(grew(c1, await counters())), '{}', 'a second showing, with a light dragged, builds no shader or pipeline and allocates nothing');
    console.log(`  presentLights: from before the first showing to after the second: ${JSON.stringify(grew(c0, await counters()))}`);

    // --- leaving and coming back picks Key again -------------------------------------------
    await page.keyboard.press('3');
    await page.evaluate(() => window.__sculpt.present.leave());
    await page.waitForFunction(() => !document.body.classList.contains('presenting'), null, { timeout: 5000 });
    await page.evaluate(() => window.__sculpt.present.enter());
    await page.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 5000 });
    const k0 = await angles(page);
    await holdAndDrag();
    t.eq(changed(k0, await angles(page)), 'key', 'entering Present again picks the key light');

    // --- the shot ----------------------------------------------------------------------------
    await page.keyboard.press('2');
    await page.waitForFunction(() => (document.querySelector('.light-markers')?.dataset.shown ?? '').includes('fill*'), null, { timeout: 5000 });
    await page.mouse.move(300, 300);
    await page.keyboard.down('l');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${SHOTS}/present-lights.png` });
    await page.keyboard.up('l');

    // --- leaving Present to Sculpt: the digits are tools again --------------------------------
    await page.evaluate(() => window.__sculpt.present.leave());
    await page.waitForFunction(() => !document.body.classList.contains('presenting'), null, { timeout: 5000 });
    const tool2 = await page.evaluate(() => window.__sculpt.input.currentToolIndex());
    await page.keyboard.press('3');
    t.ok((await page.evaluate(() => window.__sculpt.input.currentToolIndex())) !== tool2, 'back in Sculpt the digit 3 picks a tool');
    await page.waitForFunction(() => (document.querySelector('.light-markers')?.dataset.shown ?? '') === '', null, { timeout: 6000 }).catch(() => {});
    t.eq(await shown(page), '', 'and no markers show');
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },
};
