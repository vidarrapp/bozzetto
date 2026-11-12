// The first-visit question: keep work on this device, or not (src/ui/deviceChoice.ts,
// src/ui/deviceStorage.ts). Every other suite starts with the choice already
// stored as "keep" (run.mjs seeds it); this one opts out and starts from nothing.
//
// Until a choice is made nothing is written: no localStorage, no IndexedDB, no
// service worker. The window comes on the gallery and Sculpt and not on the
// public viewer. Keep stores the choice, never shows again, and the autosave
// works after a reload. Do not keep needs a second question; Go back returns,
// Turn saving off leaves the device empty after a stroke and a reload (the
// same tab does not ask again, a new context does). The "Not saved" note
// shows in Sculpt and fits at 390px, and Preferences has the switch.
// Each gets (page, base, t).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openSculpt } from './lib.mjs';

const LIME = 'rgb(198, 255, 0)';
const RED = 'rgb(255, 64, 96)';
const BLACK = 'rgb(0, 0, 0)';
/** Set E2E_SHOTS to a folder to keep the screenshots the window and the note are checked by. */
const SHOTS = process.env.E2E_SHOTS ?? '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

const DESKTOP = { viewport: { width: 1440, height: 900 }, askAboutDevice: true };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, askAboutDevice: true };

/** A page in its own context, with the question left to be asked; the page's errors are checked at the end. */
async function inContext(page, options, t, fn) {
  const ctx = await page.context().browser().newContext(options);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  try {
    await fn(p, ctx);
  } finally {
    await ctx.close();
  }
  t.ok(errors.length === 0, `no page errors in the context${errors.length ? `: ${errors.join(' | ')}` : ''}`);
}

/** What the device holds: localStorage keys, IndexedDB databases, service workers, caches. */
const device = (page) =>
  page.evaluate(async () => ({
    local: Object.keys(localStorage),
    dbs: (await indexedDB.databases()).map((d) => d.name),
    workers: (await navigator.serviceWorker.getRegistrations()).length,
    caches: await caches.keys(),
    declined: sessionStorage.getItem('bozzetto-device-declined'),
  }));

const windowState = (page) =>
  page.evaluate(() => {
    const w = document.querySelector('.bz-device');
    if (!w) return null;
    const card = w.querySelector('.bz-device__card');
    const r = card.getBoundingClientRect();
    const btn = (sel) => {
      const b = w.querySelector(sel);
      if (!b) return null;
      const cs = getComputedStyle(b);
      const br = b.getBoundingClientRect();
      return { text: b.textContent, bg: cs.backgroundColor, color: cs.color, h: br.height, w: br.width, font: `${cs.fontSize} ${cs.fontFamily.split(',')[0]}`, radius: cs.borderRadius };
    };
    return {
      title: card.querySelector('h2')?.textContent,
      text: card.textContent,
      link: card.querySelector('a')?.getAttribute('href') ?? null,
      focus: document.activeElement?.textContent ?? null,
      inside: card.contains(document.activeElement),
      fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
      keep: btn('.bz-device-keep'),
      decline: btn('.bz-device-decline'),
      off: btn('.bz-device-off'),
      back: btn('.bz-device-back'),
      orange: [...w.querySelectorAll('button')].filter((b) => getComputedStyle(b).backgroundColor === 'rgb(255, 90, 31)').length,
    };
  });

const meshSum = (page) =>
  page.evaluate(() => {
    let sum = 0;
    for (const m of window.__sculpt.session.getMeshes()) for (const v of m.getVertices()) sum += v;
    return sum;
  });

/** A mouse stroke across the middle of the active object. */
async function stroke(page) {
  const before = await meshSum(page);
  const [x, y] = await page.evaluate(() => {
    const { session, viewer } = window.__sculpt;
    const b = session.getMesh().computeWorldBound();
    const [px, py] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
    const r = viewer.captureCanvas.getBoundingClientRect();
    const pr = session.getPixelRatio();
    return [r.left + px / pr, r.top + py / pr];
  });
  await page.mouse.move(x - 30, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y + 10, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  return (await meshSum(page)) !== before;
}

const autosaveCount = (page) =>
  page.evaluate(
    () =>
      new Promise((ok) => {
        const r = indexedDB.open('bozzetto-sculpt');
        r.onerror = () => ok(-1);
        r.onsuccess = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('scene')) return ok(0);
          const c = db.transaction('scene').objectStore('scene').count('current');
          c.onsuccess = () => ok(c.result);
        };
      }),
  );

/** Poll the number of service worker registrations until `ok(n)`, up to twenty seconds. */
async function workers(page, ok) {
  for (let i = 0; i < 40; i++) {
    if (ok(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length))) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

const waitWindow = (page) => page.waitForSelector('.bz-device', { timeout: 30_000 });
const sculptReady = (page) => page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
const noteShown = (page) =>
  page.evaluate(() => {
    const n = document.querySelector('.bz-strip__off');
    if (!n || n.hidden) return null;
    const r = n.getBoundingClientRect();
    const strip = document.querySelector('.bz-strip').getBoundingClientRect();
    const hide = document.querySelector('.bz-strip__hide').getBoundingClientRect();
    const toolbar = document.querySelector('.sculpt-toolbar, .bz-toolbar, .toolbar')?.getBoundingClientRect() ?? null;
    return {
      text: n.textContent,
      title: n.title,
      visible: r.width > 0 && getComputedStyle(n).visibility === 'visible',
      inStrip: r.top >= strip.top && r.bottom <= strip.bottom + 0.5,
      inView: r.left >= 0 && r.right <= innerWidth,
      clearOfHide: r.right <= hide.left + 0.5,
      stripOverflow: document.querySelector('.bz-strip').scrollWidth - innerWidth,
      docOverflow: document.documentElement.scrollWidth - innerWidth,
      overToolbar: toolbar ? !(r.bottom <= toolbar.top || r.top >= toolbar.bottom || r.right <= toolbar.left || r.left >= toolbar.right) : false,
    };
  });

export const suites = {
  async deviceStorage(page, base, t) {
    // ---- the gallery: asked first, and nothing written until answered ----
    await inContext(page, DESKTOP, t, async (p) => {
      await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await waitWindow(p);
      await p.waitForTimeout(800);
      let w = await windowState(p);
      t.eq(w.title, 'Keep your work on this device?', 'the gallery asks first: the title');
      t.ok(
        /saves your work, your settings and an offline copy of the app in this browser/.test(w.text) &&
          /Nothing is uploaded unless you sign in and save/.test(w.text) &&
          /no ads and no tracking/.test(w.text),
        `the words (${w.text})`,
      );
      t.eq(w.link, '/legal/privacy.html', 'a Privacy notice link to the privacy page');
      t.ok(!/[–—]/.test(w.text), 'no dashes as punctuation');
      t.eq(w.keep?.text, 'Keep on this device', 'the recommended button');
      t.ok(w.keep.bg === LIME && w.keep.color === BLACK, `Keep on this device is lime with a black label (${w.keep.bg}, ${w.keep.color})`);
      t.ok(w.decline?.text === 'Do not keep' && w.decline.bg === 'rgb(58, 58, 58)', `Do not keep is the grey control (${w.decline?.bg})`);
      t.eq(w.orange, 0, 'no orange button in the window');
      t.ok(w.keep.h >= 28 && w.decline.h >= 28, `touch targets are at least 28px (${w.keep.h}, ${w.decline.h})`);
      t.ok(w.keep.font.startsWith('13px') && /Familjen/.test(w.keep.font) && w.keep.radius === '0px', `13px Familjen Grotesk, square corners (${w.keep.font}, ${w.keep.radius})`);
      t.eq(w.focus, 'Keep on this device', 'focus starts on the lime button');
      await shot(p, 'first-question-desktop');

      const held = await device(p);
      t.ok(
        held.local.length === 0 && held.dbs.length === 0 && held.workers === 0 && held.caches.length === 0 && held.declined === null,
        `before a choice nothing is on the device (${JSON.stringify(held)})`,
      );
      // Focus is trapped: Tab and Shift+Tab stay inside, and Esc does nothing here.
      for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab']) await p.keyboard.press(key);
      w = await windowState(p);
      t.ok(w.inside, 'Tab and Shift+Tab keep the focus in the window');
      await p.keyboard.press('Escape');
      t.ok((await windowState(p)) !== null, 'Esc does nothing on the first question');
      await p.mouse.click(5, 5);
      t.ok((await windowState(p)) !== null, 'a press beside the window does nothing either');
      t.eq((await windowState(p)).focus !== null && (await windowState(p)).inside, true, 'and focus is still inside');

      // Do not keep: the second question.
      await p.click('.bz-device-decline');
      w = await windowState(p);
      t.eq(w.title, 'Turn saving off?', 'Do not keep opens the second question in the same window');
      t.ok(
        /will not be saved while you sculpt/.test(w.text) && /gone when you close or reload/.test(w.text) && /not work offline/.test(w.text) && /settings will not be remembered/.test(w.text),
        `the second question's words (${w.text})`,
      );
      t.ok(w.off.bg === RED && w.off.color === BLACK, `Turn saving off is filled red with the design system's label (${w.off.bg}, ${w.off.color})`);
      t.ok(/btn--danger/.test(await p.getAttribute('.bz-device-off', 'class')), 'with btn--danger');
      t.ok(w.back.bg === 'rgb(58, 58, 58)', 'Go back is grey');
      await shot(p, 'second-question-desktop');
      await p.keyboard.press('Escape');
      w = await windowState(p);
      t.eq(w?.title, 'Keep your work on this device?', 'Esc on the second question is Go back');
      await p.click('.bz-device-decline');
      await p.click('.bz-device-back');
      w = await windowState(p);
      t.eq(w?.title, 'Keep your work on this device?', 'Go back returns to the first question');
      t.eq(w.focus, 'Keep on this device', 'with the focus on the lime button again');
      t.ok((await device(p)).local.length === 0, 'still nothing written');

      // Turn saving off: the page opens, nothing persistent is written.
      await p.click('.bz-device-decline');
      await p.click('.bz-device-off');
      await p.waitForSelector('.bz-device', { state: 'detached' });
      const off = await device(p);
      t.ok(off.local.length === 0 && off.dbs.length === 0 && off.workers === 0 && off.caches.length === 0, `declined: nothing persistent (${JSON.stringify(off)})`);
      t.eq(off.declined, '1', "the refusal is remembered for the tab session only (sessionStorage's one flag)");
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(1500);
      t.eq(await p.locator('.bz-device').count(), 0, 'a reload in the same tab session does not ask again');
    });

    // ---- the public viewer asks nothing and stores nothing ----
    await inContext(page, DESKTOP, t, async (p) => {
      await p.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
      await p.waitForTimeout(500);
      t.eq(await p.locator('.bz-device').count(), 0, 'the public viewer asks nothing');
      const held = await device(p);
      t.ok(held.local.length === 0 && held.dbs.length === 0 && held.workers === 0 && held.caches.length === 0, `and stores nothing with no choice (${JSON.stringify(held)})`);
      t.eq(await p.locator('.bz-strip__off').evaluate((n) => n.hidden).catch(() => true), true, 'and says nothing about saving');
      await p.goto(`${base}/legal/privacy.html`, { waitUntil: 'domcontentloaded' });
      t.eq(await p.locator('.bz-device').count(), 0, 'the legal pages ask nothing');
      const legal = await device(p);
      t.ok(legal.local.length === 0 && legal.dbs.length === 0, 'and store nothing');
    });

    // ---- Sculpt: asked; accepted, stored, never again, the autosave survives a reload ----
    await inContext(page, DESKTOP, t, async (p) => {
      await p.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
      await waitWindow(p);
      await p.waitForTimeout(500);
      t.eq((await windowState(p)).title, 'Keep your work on this device?', 'Sculpt asks on a first visit');
      const before = await device(p);
      t.ok(before.local.length === 0 && before.dbs.length === 0 && before.workers === 0, `and nothing is written while it waits (${JSON.stringify(before)})`);
      t.eq(await p.evaluate(() => !!window.__sculpt), false, 'Sculpt has not started under the question');
      await p.click('.bz-device-keep');
      await sculptReady(p);
      await p.waitForTimeout(500);
      t.eq(await p.evaluate(() => localStorage.getItem('bozzetto-device-choice')), 'keep', 'accepting stores the choice');
      t.eq(await p.locator('.bz-device').count(), 0, 'and the window is gone');
      t.eq(await p.evaluate(() => sessionStorage.getItem('bozzetto-device-declined')), null, 'with no refusal flag');
      t.eq(await p.locator('.bz-strip__off').evaluate((n) => n.hidden), true, 'no "Not saved" note');
      const worker = await workers(p, (n) => n > 0);
      t.ok(worker, 'the service worker registers once kept');
      t.ok(await stroke(p), 'a stroke changes the mesh');
      const sum = await meshSum(p);
      await p.evaluate(() => window.__sculpt.persist.flush());
      t.eq(await autosaveCount(p), 1, 'the autosave wrote the scene');
      await p.reload({ waitUntil: 'domcontentloaded' });
      await sculptReady(p);
      await p.waitForTimeout(800);
      t.eq(await p.locator('.bz-device').count(), 0, 'after a reload the window never shows again');
      t.near(await meshSum(p), sum, 1e-3, 'the autosave brings the stroke back after a reload');
      await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(800);
      t.eq(await p.locator('.bz-device').count(), 0, 'nor on the gallery');
    });

    // ---- Sculpt, declined: no writes, the note, a new context asks again ----
    await inContext(page, DESKTOP, t, async (p, ctx) => {
      await p.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
      await waitWindow(p);
      await p.click('.bz-device-decline');
      await p.click('.bz-device-off');
      await sculptReady(p);
      await p.waitForTimeout(800);
      t.ok(await stroke(p), 'declined: Sculpt works');
      await p.evaluate(() => window.__sculpt.persist.markDirty());
      await p.evaluate(() => window.__sculpt.persist.flush());
      await p.waitForTimeout(500);
      let held = await device(p);
      t.ok(held.local.length === 0 && held.dbs.length === 0 && held.workers === 0 && held.caches.length === 0, `after a stroke nothing is on the device (${JSON.stringify(held)})`);
      const note = await noteShown(p);
      t.ok(note && note.text === 'Not saved' && note.visible && note.inStrip && note.inView && note.clearOfHide && !note.overToolbar, `the "Not saved" note shows in the strip and covers nothing (${JSON.stringify(note)})`);
      t.ok(/Saving is off/.test(note?.title ?? ''), 'with a title that says why');
      await shot(p, 'not-saved-sculpt-desktop');
      // File > Keep on this device is off, with the reason.
      await p.evaluate(() => [...document.querySelectorAll('.bz-menuname')].find((b) => b.textContent === 'File')?.click());
      await p.waitForTimeout(250);
      const keep = await p.evaluate(() => {
        const item = [...document.querySelectorAll('.file-menu__item, .file-menu button')].find((b) => /Keep on this device/.test(b.textContent));
        return item ? { disabled: item.disabled || item.getAttribute('aria-disabled') === 'true', text: item.textContent } : null;
      });
      t.ok(keep && keep.disabled && /Saving is off/.test(keep.text), `File > Keep on this device is disabled and says saving is off (${JSON.stringify(keep)})`);
      await p.keyboard.press('Escape');
      await p.reload({ waitUntil: 'domcontentloaded' });
      await sculptReady(p);
      await p.waitForTimeout(800);
      t.eq(await p.locator('.bz-device').count(), 0, 'a reload in the same tab does not ask again');
      held = await device(p);
      t.ok(held.local.length === 0 && held.dbs.length === 0, `and after the reload localStorage and IndexedDB are still empty (${JSON.stringify(held)})`);
      // A new context is a new visit: it asks again.
      const fresh = await ctx.browser().newContext(DESKTOP);
      try {
        const q = await fresh.newPage();
        await q.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
        await waitWindow(q);
        t.eq((await windowState(q)).title, 'Keep your work on this device?', 'a new visit asks again');
      } finally {
        await fresh.close();
      }
    });

    // ---- Armature and the signed-in pages ask too ----
    await inContext(page, DESKTOP, t, async (p) => {
      await p.goto(`${base}/?armature=1`, { waitUntil: 'domcontentloaded' });
      await waitWindow(p);
      t.ok(true, 'Armature asks');
      await p.goto(`${base}/?me`, { waitUntil: 'domcontentloaded' });
      await waitWindow(p);
      t.ok(true, 'My projects asks');
      await p.goto(`${base}/?community`, { waitUntil: 'domcontentloaded' });
      await waitWindow(p);
      t.ok(true, 'the Community asks');
      await p.goto(`${base}/admin/`, { waitUntil: 'domcontentloaded' });
      await waitWindow(p);
      t.ok(true, 'the owner tools ask');
    });

    // ---- the phone: the window and the note fit at 390px ----
    await inContext(page, PHONE, t, async (p) => {
      await p.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
      await waitWindow(p);
      await p.waitForTimeout(500);
      let w = await windowState(p);
      t.ok(w.fits && (await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)), 'the first question fits at 390px');
      await shot(p, 'first-question-phone');
      await p.tap('.bz-device-decline');
      w = await windowState(p);
      t.ok(w.fits, 'and the second');
      await shot(p, 'second-question-phone');
      await p.tap('.bz-device-off');
      await sculptReady(p);
      await p.waitForTimeout(1000);
      const note = await noteShown(p);
      t.ok(note && note.visible && note.inStrip && note.inView && note.clearOfHide && note.stripOverflow <= 0 && note.docOverflow <= 0 && !note.overToolbar, `at 390px the note fits beside the strip's items (${JSON.stringify(note)})`);
      await shot(p, 'not-saved-sculpt-phone');
    });

    // ---- Preferences: the switch ----
    await inContext(page, DESKTOP, t, async (p) => {
      await p.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
      await waitWindow(p);
      await p.click('.bz-device-keep');
      await sculptReady(p);
      await p.waitForTimeout(800);
      await p.keyboard.press('Control+Comma');
      const sw = p.locator('[data-setting="keepOnDevice"] input');
      await sw.waitFor();
      t.ok(await sw.isChecked(), 'Preferences: "Keep work on this device" is on');
      t.ok(/Keep work on this device/.test(await p.locator('[data-setting="keepOnDevice"]').textContent()), 'with its label');
      await shot(p, 'preferences-switch-on');
      await sw.click();
      await p.waitForSelector('.bz-device');
      t.eq((await windowState(p)).title, 'Turn saving off?', 'turning it off asks the second question');
      t.ok(await sw.isChecked(), 'and the switch waits for the answer');
      await p.click('.bz-device-back');
      t.ok((await sw.isChecked()) && (await p.evaluate(() => localStorage.getItem('bozzetto-device-choice'))) === 'keep', 'Go back leaves it on');
      await sw.click();
      await p.waitForSelector('.bz-device');
      await p.keyboard.press('Escape');
      t.eq(await p.locator('.bz-device').count(), 0, 'Esc on the second question is Go back');
      t.eq(await p.locator('.dsettings').evaluate((n) => n.hidden), false, 'and does not close Preferences under it');
      t.ok(await sw.isChecked(), 'the switch is still on');
      await sw.click();
      await p.click('.bz-device-off');
      await p.waitForSelector('.bz-device', { state: 'detached' });
      t.ok(!(await sw.isChecked()), 'Turn saving off: the switch is off');
      t.eq(await p.evaluate(() => localStorage.getItem('bozzetto-device-choice')), null, 'the stored choice is gone');
      t.eq(await p.locator('.dsettings').evaluate((n) => n.hidden), false, 'Preferences is still up');
      t.ok((await noteShown(p))?.visible, 'the "Not saved" note shows at once');
      await shot(p, 'preferences-switch-off');
      const gone = await workers(p, (n) => n === 0);
      t.ok(gone, 'the offline copy is taken out');
      // On again: the choice is stored and the autosave starts at once.
      await sw.click();
      t.eq(await p.evaluate(() => localStorage.getItem('bozzetto-device-choice')), 'keep', 'turning it on stores the choice');
      t.ok((await noteShown(p)) === null, 'and the note goes');
      // The first write waits its grace (five seconds), nobody flushes it here.
      for (let i = 0; i < 40 && (await autosaveCount(p)) !== 1; i++) await p.waitForTimeout(500);
      t.eq(await autosaveCount(p), 1, 'autosave runs straight away once it is on');
      const workerBack = await workers(p, (n) => n > 0);
      t.ok(workerBack, 'and the service worker registers again');
    });

    // ---- a device with data from before the question is still asked, and keeps it ----
    await inContext(page, DESKTOP, t, async (p) => {
      // Make the earlier data under a context that had answered, then drop only the answer.
      await p.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
      await waitWindow(p);
      await p.click('.bz-device-keep');
      await sculptReady(p);
      await p.waitForTimeout(500);
      await stroke(p);
      const sum = await meshSum(p);
      await p.evaluate(() => window.__sculpt.persist.flush());
      t.eq(await autosaveCount(p), 1, 'earlier data on the device: an autosave');
      await p.evaluate(() => localStorage.removeItem('bozzetto-device-choice'));
      await p.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
      await waitWindow(p);
      t.eq(await p.evaluate(() => !!window.__sculpt), false, 'a visitor with data from before is still asked, and Sculpt waits');
      t.eq(await autosaveCount(p), 1, 'and what is there is untouched');
      await p.click('.bz-device-keep');
      await sculptReady(p);
      await p.waitForTimeout(800);
      t.near(await meshSum(p), sum, 1e-3, 'accepted, the earlier autosave is still there');
    });
  },
};
