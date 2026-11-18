// Sculpt, Paint and Present as tabs of one mode (owner, 2026-11-18).
//
// workspaceTabs: each workspace remembers its own panels (through a round trip
//   and a reload; Present reopens Lighting when that was open; first visits),
//   Paint comes back to its last tool; every pair of the three by key and by
//   the path; Shift+B and Shift+P are gone, and Esc does not leave Present
//   (it still shows a hidden interface); camera, selection, undo and symmetry kept; no question on any
//   switch; a switch mid-stroke is refused; leaving Present stops the
//   turntable; the second round of switches builds nothing.
// workspaceKeys: Shift+1 to 4 as a US and a Swedish keyboard send them (the
//   key's character differs, its physical code does not), shown in the View
//   menu and the hotkey guide, kept out of a text field, a rebind of the old
//   Present key carried over to the new action.
import { mkdirSync } from 'node:fs';
import { camMoved, camera, openForInput, settle } from './smoke.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/workspace-tabs';

/** Ids of the panels open now, as their class names say, in a stable order. */
const openIds = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.panel:not(.panel--collapsed)')]
      .map((el) => [...el.classList].find((c) => /^panel--(?!left|collapsed)/.test(c))?.slice(7))
      .filter(Boolean)
      .sort()
      .join(','),
  );

/** The workspace the path lights. */
const where = (page) => page.evaluate(() => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent ?? null);

const setPanel = (page, id, open) => page.evaluate(([i, o]) => window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id: i, open: o } })), [id, open]);

const KEYS = { Sculpt: 'Shift+2', Paint: 'Shift+3', Present: 'Shift+4' };

/** Go to a workspace by key and wait for the path to say so. */
async function go(page, name) {
  await page.keyboard.press(KEYS[name]);
  await page.waitForFunction((n) => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === n, name, { timeout: 10_000 });
  await settle(page);
}

const byPath = async (page, name) => {
  await page.evaluate((n) => [...document.querySelectorAll('.bz-ws__step')].find((b) => b.textContent === n)?.click(), name);
  await page.waitForFunction((n) => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === n, name, { timeout: 10_000 });
  await settle(page);
};

const asking = (page) => page.evaluate(() => !!document.querySelector('.bz-ask') || document.body.classList.contains('has-modal'));
const counters = (page) => page.evaluate(() => window.__bozzetto.renderCounters());
const grew = (a, b) => Object.fromEntries(Object.keys(a).filter((k) => b[k] !== a[k]).map((k) => [k, b[k] - a[k]]));
const show = (o) => JSON.stringify(o);

/** A key as a keyboard sends it: the character and the physical code both. */
const send = (page, init) =>
  page.evaluate((i) => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...i });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }, init);

const reload = async (page, base, keepAddress = false) => {
  if (keepAddress) await page.reload({ waitUntil: 'domcontentloaded' });
  else await page.goto(`${base}/?sculpt=1&q=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('overlay') && !!window.__sculpt, null, { timeout: 60_000 });
};

export const suites = {
  async workspaceTabs(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await page.addStyleTag({ content: '.panel { transition: none !important; }' });
    await page.evaluate(() => {
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith('bz.panels.') || k === 'bz.paintTool') localStorage.removeItem(k);
      } catch {
        // none
      }
    });
    await page.keyboard.press('Escape');

    // --- Sculpt's own panels, then Present for the first time -------------------
    await setPanel(page, 'scene', true);
    await setPanel(page, 'sculpt', true);
    t.eq(await openIds(page), 'scene,sculpt', 'Sculpt: Scene at the left and Tool at the right');
    const cam0 = await camera(page);
    const mesh0 = await page.evaluate(() => window.__sculpt.session.getMesh()?.id ?? null);
    const asks = [];
    let c0 = await counters(page);
    let t0 = Date.now();
    await go(page, 'Present');
    const firstPresentMs = Date.now() - t0;
    const firstPresent = grew(c0, await counters(page));
    t.eq(await openIds(page), 'output', 'Present, the first time: Output at the right and nothing at the left');
    await page.screenshot({ path: `${SHOTS}/present-first.png` });
    asks.push(await asking(page));

    // Lighting is opened here; Sculpt comes back as it was; Present reopens Lighting.
    await setPanel(page, 'lighting', true);
    t.eq(await openIds(page), 'lighting,output', 'Present: Lighting opened, Output still at the right');
    await page.screenshot({ path: `${SHOTS}/present-lighting.png` });
    await go(page, 'Sculpt');
    t.eq(await openIds(page), 'scene,sculpt', 'back in Sculpt with its own panels (Lighting is put away)');
    asks.push(await asking(page));
    await go(page, 'Present');
    t.eq(await openIds(page), 'lighting,output', 'Present reopens Lighting (and Output) as it was left');
    await setPanel(page, 'camera', true);
    await setPanel(page, 'material', true);
    t.eq(await openIds(page), 'camera,material', 'Camera and Material took their sides over');
    const inPresent = await openIds(page);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    t.ok((await where(page)) === 'Present' && (await openIds(page)) === inPresent, 'Esc in Present, with nothing open, changes nothing');
    await go(page, 'Sculpt');
    t.eq(await openIds(page), 'scene,sculpt', 'Shift+2 leaves Present to Sculpt with its panels');

    // --- Paint: first visit, its panels and its tool -------------------------------
    await go(page, 'Paint');
    t.eq(await openIds(page), 'layers,sculpt', 'Paint, the first time: Layers at the left and Tool at the right');
    await page.screenshot({ path: `${SHOTS}/paint-first.png` });
    await page.keyboard.press('2'); // Erase
    t.eq(await page.evaluate(() => window.__sculpt.input.currentToolIndex()), 15, 'Erase picked in Paint');
    await setPanel(page, 'layers', false);
    await setPanel(page, 'reference', true);
    t.eq(await openIds(page), 'reference', 'Paint: the Layers tab shut and Reference opened');
    await go(page, 'Sculpt');
    t.eq(await openIds(page), 'scene,sculpt', 'Sculpt is as it was after Paint');
    await go(page, 'Paint');
    t.eq(await openIds(page), 'reference', "Paint comes back to its own panels");
    t.eq(await page.evaluate(() => window.__sculpt.input.currentToolIndex()), 15, 'and to Erase, the paint tool it last had');

    // --- through a reload ---------------------------------------------------------
    await reload(page, base, true);
    t.eq(await where(page), 'Paint', 'the address reopens Paint');
    t.eq(await openIds(page), 'reference', "after a reload Paint has its panels");
    t.eq(await page.evaluate(() => window.__sculpt.input.currentToolIndex()), 15, 'and its tool');
    await go(page, 'Present');
    t.eq(await openIds(page), 'camera,material', 'Present has its panels after a reload');
    await go(page, 'Sculpt');
    t.eq(await openIds(page), 'scene,sculpt', 'and Sculpt its own');

    // --- every pair, by key and by the path; Shift+B and Shift+P are gone ------------
    const names = ['Sculpt', 'Paint', 'Present'];
    const camBefore = await camera(page);
    await page.evaluate(() => {
      window.__sculpt.session.getSculptManager()._symmetry = true;
    });
    const undoBefore = await page.evaluate(() => window.__sculpt.session.canUndo());
    for (const from of names) {
      for (const to of names) {
        if (from === to) continue;
        await go(page, from);
        await go(page, to);
        t.eq(await where(page), to, `by key: ${from} to ${to}`);
        t.ok(!(await page.evaluate(() => window.__sculpt.present.isTurning())), `${from} to ${to}: no turntable left running`);
        t.ok(!(await asking(page)), `${from} to ${to}: nothing was asked`);
        await go(page, from);
        await byPath(page, to);
        t.eq(await where(page), to, `by the path: ${from} to ${to}`);
        t.ok(!(await asking(page)), `${from} to ${to} by the path: nothing was asked`);
      }
    }
    for (const to of names) {
      await go(page, to);
      const again = await send(page, { key: '@', code: 'Digit' + { Sculpt: 2, Paint: 3, Present: 4 }[to], shiftKey: true });
      t.ok(again && (await where(page)) === to, `${to}: its own key again does nothing (and is taken from the browser)`);
    }
    await go(page, 'Sculpt');
    await send(page, { key: 'B', code: 'KeyB', shiftKey: true });
    await send(page, { key: 'P', code: 'KeyP', shiftKey: true });
    await page.waitForTimeout(150);
    t.eq(await where(page), 'Sculpt', 'Shift+B and Shift+P do nothing now');
    await go(page, 'Paint');
    await send(page, { key: 'B', code: 'KeyB', shiftKey: true });
    t.eq(await where(page), 'Paint', 'nor does Shift+B in Paint');

    // Present entered from Paint: Esc shows a hidden interface and leaves nothing; Shift+3 goes to Paint.
    await go(page, 'Present');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    t.ok(await page.evaluate(() => !document.body.classList.contains('chrome-hidden') && document.body.classList.contains('presenting')), 'Esc brings back a hidden interface and stays in Present');
    await go(page, 'Paint');
    t.eq(await where(page), 'Paint', 'Shift+3 leaves Present for Paint');

    // --- kept across all that ------------------------------------------------------------
    await go(page, 'Sculpt');
    const camAfter = await camera(page);
    t.ok(camMoved(camBefore, camAfter) < 1e-6, 'the camera is where it was');
    t.eq(await page.evaluate(() => window.__sculpt.session.getMesh()?.id ?? null), mesh0, 'the active object is the same');
    t.eq(await page.evaluate(() => window.__sculpt.session.canUndo()), undoBefore, 'the undo history is as it was');
    t.ok(await page.evaluate(() => window.__sculpt.session.getSculptManager()._symmetry === true), 'symmetry is still on');
    t.ok(cam0 && !asks.some(Boolean), 'no question on the first switches either');

    // --- the turntable stops when Present is left by a key ---------------------------------
    await go(page, 'Present');
    await page.click('.present-bar__play');
    t.ok(await page.evaluate(() => window.__sculpt.present.isTurning()), 'the turntable runs in Present');
    await go(page, 'Paint');
    t.ok(!(await page.evaluate(() => window.__sculpt.present.isTurning())) && !(await page.evaluate(() => window.__sculpt.present.isActive())), 'Present to Paint by key: left properly, the turntable stopped');
    await go(page, 'Sculpt');

    // --- refused mid-stroke only -----------------------------------------------------------
    const refused = await page.evaluate(() => {
      const { input } = window.__sculpt;
      const real = input.isStroking;
      input.isStroking = () => true;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '$', code: 'Digit4', shiftKey: true, bubbles: true, cancelable: true }));
      const stayed = !window.__sculpt.present.isActive();
      input.isStroking = real;
      return stayed;
    });
    t.ok(refused, 'a switch is refused while a stroke is under way, and says nothing');

    // --- what a switch builds, and how long it takes -------------------------------------------
    // The first entries may build; the second round and the ones after must not.
    await go(page, 'Paint');
    await go(page, 'Sculpt');
    await go(page, 'Present');
    await go(page, 'Paint');
    await go(page, 'Sculpt');
    const times = {};
    const builds = {};
    for (const round of [1, 2]) {
      for (const to of ['Present', 'Sculpt', 'Paint', 'Present', 'Paint', 'Sculpt']) {
        const before = await counters(page);
        const ms = await page.evaluate(async (k) => {
          const t1 = performance.now();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: k.key, code: k.code, shiftKey: true, bubbles: true, cancelable: true }));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return performance.now() - t1;
        }, { Present: { key: '$', code: 'Digit4' }, Sculpt: { key: '@', code: 'Digit2' }, Paint: { key: '#', code: 'Digit3' } }[to]);
        await page.waitForTimeout(100);
        const g = grew(before, await counters(page));
        const k = `${round}:${to}`;
        (times[k] ??= []).push(Math.round(ms));
        if (Object.keys(g).length) builds[`${k}#${times[k].length}`] = g;
      }
    }
    console.log(`  wstabs: first entry into Present took ${firstPresentMs} ms with builds ${show(firstPresent)}`);
    console.log(`  wstabs: key to second rAF in ms by round and target: ${show(times)}`);
    console.log(`  wstabs: builds on switches after the warm-up: ${show(builds)}`);
    const second = Object.entries(builds).filter(([k]) => k.startsWith('2:'));
    t.eq(show(second), '[]', 'in the second round no switch builds a node graph, shader, pipeline or texture');
    t.ok(!(await asking(page)), 'and nothing was asked in all of them');
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  async workspaceKeys(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await page.keyboard.press('Escape');

    // A US and a Swedish keyboard send different characters for the same physical keys.
    const layouts = {
      US: { 2: '@', 3: '#', 4: '$' },
      Swedish: { 2: '"', 3: '#', 4: '¤' },
    };
    for (const [layout, chars] of Object.entries(layouts)) {
      for (const [n, name] of [[3, 'Paint'], [4, 'Present'], [2, 'Sculpt']]) {
        const prevented = await send(page, { key: chars[n], code: `Digit${n}`, shiftKey: true });
        await page.waitForFunction((w) => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === w, name, { timeout: 8000 });
        t.ok(prevented, `${layout} keyboard: Shift+${n} (${chars[n]}) goes to ${name}, and the browser does not get it`);
        await settle(page);
      }
    }
    // The iPad's keyboard and a controller macro send no character we rely on: the physical key still counts.
    await send(page, { key: 'Dead', code: 'Digit3', shiftKey: true });
    await page.waitForFunction(() => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === 'Paint', null, { timeout: 8000 });
    t.ok(true, 'a key sent with an odd character but the right physical key still goes to Paint');
    await send(page, { key: '"', code: 'Digit2', shiftKey: true });
    await page.waitForFunction(() => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === 'Sculpt', null, { timeout: 8000 });

    // Plain digits are still the tools, and Shift+digit is not a tool.
    const tool0 = await page.evaluate(() => window.__sculpt.input.currentToolIndex());
    await page.keyboard.press('2');
    const tool1 = await page.evaluate(() => window.__sculpt.input.currentToolIndex());
    t.ok(tool1 !== tool0 && (await where(page)) === 'Sculpt', 'the plain digit 2 is still a brush');

    // Shift+1 asks about Armature (that page begins a new figure), as the path's step does.
    await send(page, { key: '!', code: 'Digit1', shiftKey: true });
    await page.waitForSelector('.bz-ask', { timeout: 8000 });
    t.ok(true, 'Shift+1 asks "Make a new armature for this scene?" as the path does');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.bz-ask'), null, { timeout: 5000 });

    // Not in a text field.
    await page.evaluate(() => {
      const i = document.createElement('input');
      i.type = 'text';
      i.id = 'wstabs-text';
      document.body.appendChild(i);
      i.focus();
    });
    const inField = await page.evaluate(() => {
      const e = new KeyboardEvent('keydown', { key: '$', code: 'Digit4', shiftKey: true, bubbles: true, cancelable: true });
      document.getElementById('wstabs-text').dispatchEvent(e);
      return e.defaultPrevented;
    });
    t.ok(!inField && (await where(page)) === 'Sculpt', 'in a text field Shift+4 types and does not switch');
    await page.evaluate(() => document.getElementById('wstabs-text').remove());

    // After touching a slider the keys still work (a slider keeps only its own keys).
    await page.evaluate(() => {
      const r = document.createElement('input');
      r.type = 'range';
      r.id = 'wstabs-range';
      document.body.appendChild(r);
      r.focus();
    });
    await send(page, { key: '$', code: 'Digit4', shiftKey: true });
    await page.waitForFunction(() => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === 'Present', null, { timeout: 8000 });
    t.ok(true, 'with a slider focused, Shift+4 still goes to Present');
    await page.evaluate(() => document.getElementById('wstabs-range')?.remove());
    await go(page, 'Sculpt');

    // The View menu and the hotkey guide show them.
    await page.evaluate(() => [...document.querySelectorAll('.bz-menuname')].find((b) => b.textContent === 'View')?.click());
    const keys = await page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('.file-menu--view .file-menu__item')]
          .map((b) => [b.querySelector('.file-menu__label')?.textContent, b.querySelector('.file-menu__key')?.textContent?.replace(/\s/g, '')])
          .filter(([l]) => ['Armature', 'Sculpt', 'Paint', 'Present'].includes(l)),
      ),
    );
    t.eq(show(keys), show({ Armature: 'Shift+1', Sculpt: 'Shift+2', Paint: 'Shift+3', Present: 'Shift+4' }), 'the View menu shows Shift+1 to 4 beside the workspaces');
    await page.keyboard.press('Escape');
    await page.keyboard.press('h');
    await page.waitForSelector('.help-guide .help-row', { timeout: 5000 });
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.help-guide .help-row')]
        .filter((r) => /^Go to /.test(r.lastElementChild?.textContent ?? ''))
        .map((r) => `${r.lastElementChild.textContent}=${[...r.querySelectorAll('kbd')].map((k) => k.textContent).join('+')}`),
    );
    t.eq(rows.join('|'), 'Go to Armature=Shift+1|Go to Sculpt=Shift+2|Go to Paint=Shift+3|Go to Present=Shift+4', 'the hotkey guide has the four rows');
    t.ok(!(await page.evaluate(() => /Shift \+ [PB]\b/.test(document.querySelector('.help-guide')?.textContent ?? ''))), 'and no row for the old Shift+B and Shift+P');
    await go(page, 'Sculpt');

    // Someone who had bound the old Present key keeps a working key.
    await page.evaluate(() => {
      localStorage.setItem('bozzetto-keymap', JSON.stringify({ 'ui.present': 'shift+u', 'ui.paint': null }));
    });
    await reload(page, base);
    await send(page, { key: 'U', code: 'KeyU', shiftKey: true });
    await page.waitForFunction(() => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === 'Present', null, { timeout: 8000 });
    t.ok(true, 'an old rebind of the Present key (Shift+U) now runs Go to Present');
    await go(page, 'Sculpt');
    await send(page, { key: '$', code: 'Digit4', shiftKey: true });
    await page.waitForTimeout(200);
    t.eq(await where(page), 'Sculpt', "and the carried-over action has only the user's key (Shift+4 is not a second one)");
    await send(page, { key: '#', code: 'Digit3', shiftKey: true });
    await page.waitForTimeout(200);
    t.eq(await where(page), 'Sculpt', 'an unbound Paint key (the old one set to none) stays unbound');
    await page.evaluate(() => localStorage.removeItem('bozzetto-keymap'));
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },
};

