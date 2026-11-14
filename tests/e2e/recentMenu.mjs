// File > Open recent: a second list beside the menu, the projects opened or
// saved lately, newest first, one list for every mode (src/ui/recent.ts).
import { mkdirSync } from 'node:fs';
import { openArmature, openSculpt } from './lib.mjs';

const SHOTS = process.env.MENU_SHOTS || '';
const KEY = 'bozzetto-recent';

const menuName = (page, name) =>
  page.evaluate((n) => [...document.querySelectorAll('.bz-strip__menus .bz-menuname')].find((b) => b.textContent === n)?.click(), name);

/** Open File and read the Open recent row. */
const fileRow = async (page) => {
  await menuName(page, 'File');
  await page.waitForFunction(() => document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
  return page.evaluate(() => {
    const row = document.querySelector('.file-menu--file:not([hidden]) .file-menu__item--sub');
    return row ? { label: row.querySelector('.file-menu__label')?.textContent, disabled: row.disabled, hint: row.querySelector('.file-menu__hint')?.textContent ?? '', chevron: !!row.querySelector('.file-menu__chev') } : null;
  });
};

const subRows = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.file-menu--sub > *')].map((c) =>
      c.classList.contains('file-menu__sep') ? '---' : `${c.querySelector('.file-menu__label')?.textContent ?? c.textContent.trim()}${c.querySelector('.file-menu__hint') ? ` [${c.querySelector('.file-menu__hint').textContent}]` : ''}`,
    ),
  );

const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]'), KEY);
const focusedLabel = (page) => page.evaluate(() => document.activeElement?.querySelector?.('.file-menu__label')?.textContent ?? document.activeElement?.textContent ?? '');
const subOpen = (page) => page.evaluate(() => !!document.querySelector('.file-menu--sub'));

export const suites = {
  async recentMenu(page, base, t) {
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base);

    // Nothing opened yet: the row is there, greyed out, and says so.
    let row = await fileRow(page);
    t.ok(row && row.label === 'Open recent' && row.disabled && row.hint === 'Nothing opened yet' && row.chevron, `Open recent is greyed out with "Nothing opened yet" (${JSON.stringify(row)})`);
    await page.keyboard.press('Escape');

    // A scene kept on this device has an identity of its own: it is the first entry.
    await menuName(page, 'File');
    await page.evaluate(() => [...document.querySelectorAll('.file-menu--file .file-menu__item')].find((b) => b.querySelector('.file-menu__label')?.textContent === 'Keep on this device')?.click());
    await page.waitForFunction((k) => JSON.parse(localStorage.getItem(k) ?? '[]').length === 1, KEY, { timeout: 10_000 });
    const kept = (await stored(page))[0];
    t.ok(kept.kind === 'lib' && kept.place === 'This device' && kept.id && kept.name, `Keep on this device puts the scene on the list (${JSON.stringify(kept)})`);
    // Two more, older: a project that is gone, and an armature.
    await page.evaluate((k) => {
      const list = JSON.parse(localStorage.getItem(k));
      list.push({ id: 'gone-1', kind: 'scene', name: 'Gone bust', place: 'My projects', at: Date.now() - 2 * 3600_000 });
      list.push({ id: 'arm-1', kind: 'armature', name: 'Old figure', place: 'Projects', at: Date.now() - 3 * 86_400_000 });
      localStorage.setItem(k, JSON.stringify(list));
    }, KEY);

    // The list, newest first, each with mode, place and when.
    await page.keyboard.press('Escape');
    row = await fileRow(page);
    t.ok(row && !row.disabled && row.hint === '', 'with entries the row is live');
    await page.click('.file-menu--file .file-menu__item--sub');
    await page.waitForSelector('.file-menu--sub');
    const rows = await subRows(page);
    t.eq(
      rows.join(' | '),
      `${kept.name} [Sculpt · This device · just now] | Gone bust [Sculpt · My projects · 2 hours ago] | Old figure [Armature · Projects · 3 days ago] | --- | Clear list`,
      'the submenu lists them newest first, with the right hints, then a line and Clear list',
    );
    const pos = await page.evaluate(() => {
      const a = document.querySelector('.file-menu--file').getBoundingClientRect();
      const b = document.querySelector('.file-menu--sub').getBoundingClientRect();
      return { aRight: a.right, bLeft: b.left, bRight: b.right, vw: innerWidth };
    });
    t.ok(pos.bLeft >= pos.aRight - 4 && pos.bRight <= pos.vw, `it opens beside the menu, to the right, on screen (${JSON.stringify(pos)})`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/recent-1180.png` });

    // The keyboard: Escape and Left close the second list only; Right opens it.
    t.eq(await focusedLabel(page), kept.name, 'opened, the first entry has the focus');
    await page.keyboard.press('ArrowDown');
    t.eq(await focusedLabel(page), 'Gone bust', 'Down walks the second list');
    await page.keyboard.press('ArrowLeft');
    t.ok(!(await subOpen(page)) && (await focusedLabel(page)) === 'Open recent', 'Left closes it and the focus goes back to its row');
    t.ok(await page.evaluate(() => !document.querySelector('.file-menu--file').hidden), 'with the menu still open');
    await page.keyboard.press('ArrowRight');
    t.ok((await subOpen(page)) && (await focusedLabel(page)) === kept.name, 'Right opens it again, on its first entry');
    await page.keyboard.press('Escape');
    t.ok(!(await subOpen(page)) && (await page.evaluate(() => !document.querySelector('.file-menu--file').hidden)), 'Escape closes the second list first, not the menu');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    t.ok(await page.evaluate(() => document.querySelector('.file-menu--file').hidden), 'and the next Escape closes the menu');

    // One that is gone says so and leaves the list.
    page.once('dialog', (d) => void d.accept());
    await fileRow(page);
    await page.click('.file-menu--file .file-menu__item--sub');
    await page.evaluate(() => [...document.querySelectorAll('.file-menu--sub .file-menu__item')].find((b) => b.querySelector('.file-menu__label')?.textContent === 'Gone bust')?.click());
    await page.waitForSelector('[role=status][data-state=failed]', { timeout: 15_000 });
    const notice = await page.evaluate(() => document.querySelector('[role=status][data-state=failed]').textContent);
    t.ok(/"Gone bust" can no longer be opened/.test(notice) && /off the recent list/.test(notice), `a missing project is said so (${notice})`);
    t.ok(!(await stored(page)).some((r) => r.id === 'gone-1') && (await stored(page)).length === 2, 'and dropped from the list');

    // An entry opens in its own mode: this one is Sculpt's, kept on the device.
    page.once('dialog', (d) => void d.accept());
    await fileRow(page);
    await page.click('.file-menu--file .file-menu__item--sub');
    await page.evaluate((n) => [...document.querySelectorAll('.file-menu--sub .file-menu__item')].find((b) => b.querySelector('.file-menu__label')?.textContent === n)?.click(), kept.name);
    await page.waitForFunction((id) => location.search.includes(`lib=${id}`), kept.id, { timeout: 30_000 });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    t.ok(true, 'choosing a Sculpt entry opens it in Sculpt');

    // Armature has the same list.
    await openArmature(page, base);
    row = await fileRow(page);
    t.ok(row && !row.disabled, 'Armature has Open recent, with the same list');
    await page.click('.file-menu--file .file-menu__item--sub');
    t.ok((await subRows(page)).join(' | ').includes('Old figure [Armature'), 'and the armature is on it');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // Clear list.
    await fileRow(page);
    await page.click('.file-menu--file .file-menu__item--sub');
    await page.evaluate(() => [...document.querySelectorAll('.file-menu--sub .file-menu__item')].find((b) => b.querySelector('.file-menu__label')?.textContent === 'Clear list')?.click());
    t.eq((await stored(page)).length, 0, 'Clear list empties it');
    row = await fileRow(page);
    t.ok(row.disabled && row.hint === 'Nothing opened yet', 'and the row is greyed out again');
    await page.keyboard.press('Escape');

    // A phone: the second list takes the menu's place, with Back on top.
    await page.evaluate((k) => localStorage.setItem(k, JSON.stringify([{ id: 'arm-1', kind: 'armature', name: 'Old figure', place: 'Projects', at: Date.now() - 60_000 * 5 }])), KEY);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await fileRow(page);
    await page.click('.file-menu--file .file-menu__item--sub');
    await page.waitForSelector('.file-menu--sub');
    const phone = await page.evaluate(() => {
      const s = document.querySelector('.file-menu--sub').getBoundingClientRect();
      return { l: s.left, r: s.right, t: s.top, b: s.bottom, vw: innerWidth, vh: innerHeight, first: document.querySelector('.file-menu--sub .file-menu__item').textContent, main: getComputedStyle(document.querySelector('.file-menu--file')).visibility, scroll: document.documentElement.scrollWidth };
    });
    t.ok(phone.l >= 0 && phone.r <= phone.vw && phone.b <= phone.vh && phone.scroll <= phone.vw, `at 390 wide the second list is on screen (${JSON.stringify(phone)})`);
    t.ok(/Back/.test(phone.first) && phone.main === 'hidden', 'it replaces the menu in place and starts with a Back row');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/recent-390.png` });
    await page.click('.file-menu--sub .file-menu__item--back');
    t.ok(!(await subOpen(page)) && (await page.evaluate(() => getComputedStyle(document.querySelector('.file-menu--file')).visibility)) === 'visible', 'Back returns to the menu');
  },
};
