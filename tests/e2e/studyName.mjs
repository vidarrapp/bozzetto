// A scene's name and where its work is kept, in the title strip (Sculpt and
// Armature): the name always there, "Study 14 Nov" for a new one, tapped to
// rename or File > Rename…, and a quiet word after it: Saved, Edited, Kept
// on this device, or the strip's one "Not saved" while saving is off.
import { chooseFile, fakeProjects, fileItems, savedToast } from './smoke.mjs';
import { openArmature, openSculpt } from './lib.mjs';

const nameText = (page) => page.evaluate(() => document.querySelector('.bz-readout__name')?.textContent ?? null);
const wordText = (page) =>
  page.evaluate(() => {
    const e = document.querySelector('.bz-readout__edited');
    return e && !e.hidden ? e.textContent : null;
  });
/** Poll until `read` gives `want`; the readout is written twice a second. */
const settles = async (page, read, want, ms = 15_000) => {
  const end = Date.now() + ms;
  let got = await read(page);
  while (got !== want && Date.now() < end) {
    await page.waitForTimeout(150);
    got = await read(page);
  }
  return got;
};
/** Today's study name, as the page itself would write it. */
const studyToday = (page) =>
  page.evaluate(() => `Study ${new Date().getDate()} ${new Date().toLocaleString(undefined, { month: 'short' })}`);
/** Tap the name, type a new one, and end it with `how`. */
async function typeName(page, text, how = 'Enter') {
  await page.click('.bz-readout__name');
  const input = page.locator('.bz-readout__rename');
  await input.waitFor({ timeout: 5000 });
  await input.fill(text);
  await page.keyboard.press(how);
}
/** The File menu's labels, once `ok` says they are the ones wanted (the probe answers late). */
async function settlesItems(page, ok, ms = 15_000) {
  const end = Date.now() + ms;
  let labels = (await fileItems(page)).map((i) => i.label);
  while (!ok(labels) && Date.now() < end) {
    await page.waitForTimeout(200);
    labels = (await fileItems(page)).map((i) => i.label);
  }
  return labels;
}
const cardTitle =(page, armature = false) =>
  page.evaluate((a) => document.querySelector(a ? '.card--armature .card__title' : '.card--sculpt:not(.card--armature) .card__title')?.textContent ?? null, armature);
const notSaved = (page) =>
  page.evaluate(() => [...document.querySelectorAll('.bz-strip *')].filter((n) => n.children.length === 0 && n.textContent === 'Not saved' && n.getBoundingClientRect().width > 0 && !n.hidden).length);

export const suites = {
  // A guest with no accounts: the study name, the state, renaming, the File items, the gallery card.
  async studyName(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base, '&q=low');
    const today = await studyToday(page);
    t.eq(await settles(page, nameText, today), today, `a fresh scene is named as a dated study ("${today}")`);
    t.eq(await settles(page, wordText, 'Kept on this device'), 'Kept on this device', 'and says it is kept on this device');
    await page.evaluate(() => window.__sculpt.session.addPrimitive('capsule'));
    await page.waitForTimeout(700);
    t.ok((await nameText(page)) === today && (await wordText(page)) === 'Kept on this device', 'a stroke or an added object keeps the name and the state');

    // The guest's File: Save file, Rename…, and no second item that only downloads.
    await page.waitForFunction(() => [...document.querySelectorAll('.gallery-form')].some((f) => !f.hidden), null, { timeout: 30_000 });
    const labels = (await fileItems(page)).map((i) => i.label);
    t.ok(labels.includes('Save file') && labels.includes('Rename…') && !labels.some((l) => /library/i.test(l)), `a guest with no accounts has Save file and Rename…, no library item (${labels.join(', ')})`);

    // Esc keeps the name; Enter renames.
    await typeName(page, 'Nope', 'Escape');
    t.eq(await nameText(page), today, 'Esc in the name field keeps the name');
    t.eq(await page.locator('.bz-readout__rename').count(), 0, 'and puts the field away');
    await typeName(page, 'Hand study');
    t.eq(await nameText(page), 'Hand study', 'tapping the name and pressing Enter renames the scene');
    t.eq(await page.evaluate(() => window.__sculpt.fileActions.sceneName), 'Hand study', 'the scene has the name');
    // Leaving the field renames too.
    await page.click('.bz-readout__name');
    await page.locator('.bz-readout__rename').fill('Hand study 2');
    await page.locator('.bz-strip').click({ position: { x: 1175, y: 12 }, force: true });
    t.eq(await settles(page, nameText, 'Hand study 2'), 'Hand study 2', 'leaving the field renames as well');

    // Kept through a reload (the autosave record carries it).
    await page.evaluate(() => window.__sculpt.persist.flush());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    t.eq(await settles(page, nameText, 'Hand study 2'), 'Hand study 2', 'the name is still there after a reload');

    // File > Rename….
    page.once('dialog', (d) => void d.accept('Torso'));
    await chooseFile(page, 'Rename…');
    t.eq(await settles(page, nameText, 'Torso'), 'Torso', 'File > Rename… renames the scene');
    await page.evaluate(() => window.__sculpt.persist.flush());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    t.eq(await settles(page, nameText, 'Torso'), 'Torso', 'and that name is kept through a reload too');

    // The gallery's in-progress card shows the same name.
    await page.evaluate(() => window.__sculpt.persist.flush());
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.card--sculpt:not(.card--armature)', { timeout: 30_000 });
    t.eq(await cardTitle(page), 'Torso', 'the In progress card carries the scene\'s name');

    // A second study the same day is numbered among this device's scenes.
    await openSculpt(page, base, '&q=low');
    page.on('dialog', (d) => void d.accept());
    await page.evaluate((n) => window.__sculpt.fileActions.rename(n), today);
    await chooseFile(page, 'Keep on this device');
    await page.waitForFunction(() => [...document.querySelectorAll('.file-menu__note')].some((n) => n.textContent === 'Kept on this device'), null, { timeout: 30_000 });
    await chooseFile(page, 'New sculpt');
    t.eq(await settles(page, nameText, `${today} 2`), `${today} 2`, `a new scene on a day that has a study is "${today} 2"`);
  },

  // Signed in as the owner (faked): saving to the library flips the word to Saved, a stroke to Edited, a rename is kept with the project.
  async studyNameSaved(page, base, t) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'block' });
    const fake = fakeProjects();
    try {
      await ctx.addInitScript(() => localStorage.setItem('bozzetto-device-choice', 'keep'));
      await ctx.route(fake.serves, fake.handle);
      const owner = await ctx.newPage();
      owner.on('dialog', (d) => void d.accept());
      await openSculpt(owner, base, '&q=low');
      await owner.waitForFunction(() => [...document.querySelectorAll('.gallery-form__fields')].some((f) => !f.hidden), null, { timeout: 30_000 });
      const today = await studyToday(owner);
      t.eq(await settles(owner, wordText, 'Kept on this device'), 'Kept on this device', 'signed in, an unsaved scene is "Kept on this device"');
      const labels = (await fileItems(owner)).map((i) => i.label);
      t.ok(labels.includes('Save to library') && labels.includes('Save file'), `and File has Save file and Save to library (${labels.join(', ')})`);

      await chooseFile(owner, 'Save to library');
      const end = await savedToast(owner);
      t.ok(end.state === 'done' && end.text === `Saved to Projects: ${today}`, `Save to library names the project for the study ("${end.text}")`);
      t.eq(await settles(owner, wordText, 'Saved'), 'Saved', 'and the word is Saved');
      t.eq(await nameText(owner), today, 'under the same name');

      await owner.evaluate(() => window.__sculpt.session.addPrimitive('torus'));
      t.eq(await settles(owner, wordText, 'Edited'), 'Edited', 'a change after the save makes it Edited');
      await chooseFile(owner, 'Save to library');
      await savedToast(owner);
      t.eq(await settles(owner, wordText, 'Saved'), 'Saved', 'saving again makes it Saved');

      // Renamed, it is Edited until saved, and the project takes the name.
      await typeName(owner, 'Hand study');
      t.eq(await settles(owner, wordText, 'Edited'), 'Edited', 'a rename is a change the library does not have yet');
      await chooseFile(owner, 'Save to library');
      await savedToast(owner);
      t.eq(await settles(owner, wordText, 'Saved'), 'Saved', 'saved again, it is Saved');
      const titles = [...fake.projects.values()].map((p) => p.title);
      t.ok(titles.includes('Hand study') && titles.length === 1, `and the library project has the new name (${titles.join(', ')})`);

      // Saved stays saved through a reload.
      await owner.evaluate(() => window.__sculpt.persist.settle());
      await owner.reload({ waitUntil: 'domcontentloaded' });
      await owner.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
      t.eq(await settles(owner, nameText, 'Hand study'), 'Hand study', 'the name is kept through a reload');
      t.eq(await settles(owner, wordText, 'Saved'), 'Saved', 'and so is Saved');
    } finally {
      await ctx.close();
    }
  },

  // Saving off: one "Not saved", no state word beside the name.
  async studyNameOff(page, base, t) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1180, height: 820 }, askAboutDevice: true });
    try {
      const p = await ctx.newPage();
      await p.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('.bz-device', { timeout: 30_000 });
      await p.click('.bz-device-decline');
      await p.click('.bz-device-off');
      await p.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
      await p.waitForTimeout(800);
      const today = await studyToday(p);
      t.eq(await nameText(p), today, 'with saving off the scene still has its name');
      t.eq(await notSaved(p), 1, 'and "Not saved" shows once in the strip');
      t.eq(await wordText(p), null, 'with no state word beside the name');
    } finally {
      await ctx.close();
    }
  },

  // Accounts on, nobody signed in: File has Save file and a way in to the library, which opens the sign-in window.
  async studyNameGuest(page, base, t) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'block' });
    try {
      await ctx.addInitScript(() => localStorage.setItem('bozzetto-device-choice', 'keep'));
      await ctx.route('**/api/config', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accounts: true }) }));
      await ctx.route('**/api/me', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"signed_out"}' }));
      const p = await ctx.newPage();
      await openSculpt(p, base, '&q=low');
      const labels = await settlesItems(p, (l) => l.includes('Sign in to save to library'));
      t.ok(
        labels.includes('Save file') && labels.includes('Sign in to save to library') && !labels.includes('Save to library'),
        `signed out with accounts on, File has Save file and Sign in to save to library (${labels.join(', ')})`,
      );
      await chooseFile(p, 'Sign in to save to library');
      t.ok(await p.waitForSelector('.account-card', { timeout: 15_000 }).then(() => true, () => false), 'and it opens the sign-in window');
    } finally {
      await ctx.close();
    }
  },

  // A record from before names still opens, with a dated name, in the strip and on the gallery card.
  async studyNameOld(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base, '&q=low');
    await page.evaluate(() => window.__sculpt.session.addPrimitive('capsule'));
    await page.evaluate(() => window.__sculpt.persist.flush());
    const then = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open('bozzetto-sculpt');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const at = new Date(2025, 2, 9, 12).getTime();
      await new Promise((res, rej) => {
        const tx = db.transaction('scene', 'readwrite');
        const st = tx.objectStore('scene');
        for (const key of ['current', 'currentStatus']) {
          const g = st.get(key);
          g.onsuccess = () => {
            if (!g.result) return;
            const rec = g.result;
            delete rec.name;
            rec.savedAt = at;
            st.put(rec, key);
          };
        }
        tx.oncomplete = () => res(null);
        tx.onerror = () => rej(tx.error);
      });
      db.close();
      return at;
    });
    const want = await page.evaluate((at) => `Study ${new Date(at).getDate()} ${new Date(at).toLocaleString(undefined, { month: 'short' })}`, then);
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.card--sculpt:not(.card--armature)', { timeout: 30_000 });
    t.eq(await cardTitle(page), want, `the card of a record without a name is dated from its save ("${want}")`);
    await openSculpt(page, base, '&q=low');
    t.eq(await settles(page, nameText, want), want, 'and the old record opens under that name');
  },

  // Armature: the same name and state, renamed in the strip, and the gallery card.
  async studyNameArmature(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openArmature(page, base);
    const today = await studyToday(page);
    t.eq(await settles(page, nameText, today), today, `a fresh armature is named as a dated study ("${today}")`);
    t.eq(await settles(page, wordText, 'Kept on this device'), 'Kept on this device', 'and says it is kept on this device');
    await page.waitForTimeout(1500);
    const labels = (await page.evaluate(() => {
      document.querySelector('.file-menu--file__chip')?.click();
      const out = [...document.querySelectorAll('.file-menu--file .file-menu__item')].map((b) => b.querySelector('.file-menu__label')?.textContent ?? b.textContent);
      document.querySelector('.file-menu--file__chip')?.click();
      return out;
    }));
    t.ok(labels.includes('Rename…') && labels.includes('Save file') && !labels.some((l) => /library/i.test(l)), `Armature's File has Rename… and Save file for a guest (${labels.join(', ')})`);
    await typeName(page, 'Walker');
    t.eq(await nameText(page), 'Walker', 'tapping the name renames the armature');
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__armature, null, { timeout: 90_000 });
    t.eq(await settles(page, nameText, 'Walker'), 'Walker', 'the name is kept through a reload');
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.card--armature', { timeout: 30_000 });
    t.eq(await cardTitle(page, true), 'Walker', 'the armature\'s In progress card carries its name');
  },
};
