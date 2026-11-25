// Ctrl+S (owner request, 2026-11-18). Signed in it is Save to library (the
// accounts suite checks that, against the real Functions). Here, a guest's:
// the copy on this device is written at once instead of within the minute,
// a note says so, and the browser's own Save page never opens; the same in
// Paint, from a text field, and in Armature.
//
//   saveKey   Sculpt, Paint, a text field, Armature
import { openArmature, openSculpt } from './lib.mjs';

/** Record whether the page let a Ctrl+S reach the browser (its default not prevented). */
const watchDefault = (page) =>
  page.evaluate(() => {
    window.__saveKeys = [];
    // In the capture phase on the window, where the app's own key handlers listen: they were added first, so
    // they have run by the time this one does, and their stopPropagation does not keep it from running.
    window.addEventListener(
      'keydown',
      (e) => {
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') window.__saveKeys.push(e.defaultPrevented);
      },
      true,
    );
  });
const lastPrevented = (page) => page.evaluate(() => window.__saveKeys.at(-1) ?? null);
const notes = (page) => page.evaluate(() => [...document.querySelectorAll('.file-menu__note')].map((n) => n.textContent));
const clearNotes = (page) => page.evaluate(() => document.querySelectorAll('.file-menu__note').forEach((n) => n.remove()));

async function saveKey(page, base, t) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openSculpt(page, base, '&q=low');
  // The autosave's wait made long, so a write inside a second can only be the key's.
  await page.evaluate(async () => {
    const { persist } = window.__sculpt;
    Object.assign(persist.cadence, { grace: 120_000, interval: 120_000 });
    await persist.flush();
    window.__writes = [];
    persist.onWrote = (scene) => window.__writes.push({ t: performance.now(), sym: scene.symmetry });
  });
  await watchDefault(page);
  const writes = () => page.evaluate(() => window.__writes.length);
  const edit = () => page.evaluate(() => window.__sculpt.session.toggleSymmetry());

  await edit();
  await page.waitForTimeout(300);
  t.eq(await writes(), 0, 'an edit is not written straight away (the autosave waits)');
  await clearNotes(page);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 5000 }).catch(() => {});
  t.eq(await writes(), 1, 'Ctrl+S writes the copy on this device at once');
  t.ok((await notes(page)).includes('Kept on this device'), `and says so (${(await notes(page)).join(' | ')})`);
  t.eq(await lastPrevented(page), true, 'the browser does not open its own Save page');

  // In Paint, the same key.
  await page.keyboard.press('Shift+Digit3');
  await page.waitForTimeout(600);
  await edit();
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.__writes.length > 1, null, { timeout: 5000 }).catch(() => {});
  t.eq(await writes(), 2, 'in Paint too');
  await page.keyboard.press('Shift+Digit2');
  await page.waitForTimeout(400);

  // From a text field: the one key that works there, so the page is never saved instead.
  await page.evaluate(() => {
    const i = document.createElement('input');
    i.type = 'text';
    i.className = 'save-key-probe';
    document.body.appendChild(i);
    i.focus();
  });
  await edit();
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.__writes.length > 2, null, { timeout: 5000 }).catch(() => {});
  t.eq(await writes(), 3, 'with a text field focused, Ctrl+S still saves');
  t.eq(await lastPrevented(page), true, 'and the browser does not');
  await page.evaluate(() => document.querySelector('.save-key-probe')?.remove());

  t.ok(errors.length === 0, `no page errors in Sculpt${errors.length ? `: ${errors.join(' | ')}` : ''}`);

  // Armature: the key is its own (arm.save, the same chord), and a guest's copy is kept at once.
  await openArmature(page, base);
  await page.waitForTimeout(600);
  await watchDefault(page);
  await clearNotes(page);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(600);
  t.ok((await notes(page)).includes('Kept on this device'), `in Armature Ctrl+S keeps the figure on this device (${(await notes(page)).join(' | ')})`);
  t.eq(await lastPrevented(page), true, 'and the browser does not open its Save page');
  t.ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
}

export const suites = { saveKey };
