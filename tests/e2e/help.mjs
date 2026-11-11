// The Help window (src/help): opened from Sculpt's and Armature's Help
// menu only (the viewer and the gallery have none); its topics
// all drawn with text, the filter narrowing them by title and by body, the
// About topic naming every heading of THIRD_PARTY_NOTICES.md (read from
// the file here), Escape and the keyboard, the phone-width layout, every
// Sculpt toolbar button named by some topic with the hotkey it shows, and
// the Help menu in Armature.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openArmature, openSculpt } from './lib.mjs';

/** The window's state, as the page shows it. */
const win = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('.help-win');
    const article = root?.querySelector('.help-win__topic');
    return {
      open: !!root && !root.hidden,
      modal: document.body.classList.contains('has-modal'),
      topic: article?.dataset.topic ?? null,
      title: article?.querySelector('.help-win__title')?.textContent ?? null,
      text: article?.textContent ?? '',
      shown: [...(root?.querySelectorAll('.help-win__item') ?? [])].filter((b) => !b.hidden).map((b) => b.dataset.topic),
      all: [...(root?.querySelectorAll('.help-win__item') ?? [])].map((b) => b.dataset.topic),
      status: root?.querySelector('.help-win__status')?.textContent ?? '',
      none: !!root?.querySelector('.help-win__none'),
    };
  });

/** Sculpt's Help menu: open it and press the item. */
async function menuItem(page, label) {
  await page.click('.bz-strip__menus .file-menu__chip:has-text("Help")');
  await page.waitForSelector('.file-menu--help:not([hidden])');
  await page.click(`.file-menu--help .file-menu__item:has-text("${label}")`);
}

/** Every heading in THIRD_PARTY_NOTICES.md below the title, as the About topic should name it. */
function noticeHeadings() {
  const text = readFileSync(resolve('THIRD_PARTY_NOTICES.md'), 'utf8');
  const out = [];
  for (const m of text.matchAll(/^#{2,4} (.+)$/gm)) {
    // The bracket after a name says where or how it ships; the name is what is credited.
    out.push(m[1].replace(/ \(.*\)$/, '').trim());
  }
  return out;
}

export const suites = {
  async help(page, base, t) {
    await openSculpt(page, base);

    // --- the Help menu beside File and Edit ---------------------------------
    const chips = await page.evaluate(() => [...document.querySelectorAll('.bz-strip__menus .file-menu__chip')].map((c) => c.textContent.trim()));
    t.ok(chips.indexOf('File') >= 0 && chips.indexOf('Edit') >= 0 && chips.indexOf('Help') === chips.indexOf('Edit') + 2, `a Help name follows Edit and View in the strip (${chips.join(', ')})`);
    await page.click('.bz-strip__menus .file-menu__chip:has-text("Help")');
    await page.waitForSelector('.file-menu--help:not([hidden])');
    const items = await page.evaluate(() => [...document.querySelectorAll('.file-menu--help .file-menu__item')].map((b) => (b.querySelector('.file-menu__label')?.textContent ?? b.textContent).trim()));
    t.eq(items.join(' | '), 'Help topics | Hotkeys | About and credits', 'the Help menu holds Help topics, Hotkeys and About and credits');
    await page.keyboard.press('Escape');
    t.ok(!(await win(page)).open, 'Escape on the menu closes the menu and opens nothing');

    // --- Hotkeys is the existing guide ---------------------------------------
    await menuItem(page, 'Hotkeys');
    t.ok(await page.evaluate(() => !document.querySelector('.help-guide').hidden), 'Hotkeys in the menu opens the hotkey guide');
    t.ok(await page.evaluate(() => /Sculpt hotkeys/.test(document.querySelector('.help-guide__head').textContent)), 'it is the Sculpt guide, drawn from the keymap');
    await page.keyboard.press('h');
    t.ok(await page.evaluate(() => document.querySelector('.help-guide').hidden), 'and H still closes it');

    // --- Help topics -------------------------------------------------------------
    await menuItem(page, 'Help topics');
    await page.waitForSelector('.help-win:not([hidden])');
    let s = await win(page);
    t.ok(s.open && s.modal, 'Help topics opens the Help window as a modal');
    t.ok(s.all.length >= 25, `it lists the topics (${s.all.length})`);
    t.eq(s.topic, 'getting-started', 'it opens on Getting started');
    t.ok(await page.evaluate(() => document.activeElement?.classList.contains('help-win__item')), 'the focus is on the list, so the keyboard is in it');

    // Every topic renders text of its own under its own title.
    const empty = [];
    const untitled = [];
    for (const id of s.all) {
      await page.click(`.help-win__item[data-topic="${id}"]`);
      const r = await win(page);
      const listed = await page.evaluate((i) => document.querySelector(`.help-win__item[data-topic="${i}"]`).textContent, id);
      if (r.topic !== id || r.text.length < 120) empty.push(`${id} (${r.text.length})`);
      if (r.title !== listed) untitled.push(id);
    }
    t.ok(!empty.length, `every topic renders text${empty.length ? `: ${empty.join(', ')}` : ''}`);
    t.ok(!untitled.length, `every topic shows its listed title${untitled.length ? `: ${untitled.join(', ')}` : ''}`);
    const dashes = await page.evaluate(() => [...document.querySelectorAll('.help-win__item')].length);
    t.ok(dashes === s.all.length, 'no topic is listed twice');

    // The topics asked for are all there.
    for (const id of ['getting-started', 'navigating', 'brush-settings', 'model-panel', 'scene-panel', 'render-panel', 'files', 'present', 'armature', 'preferences', 'hotkeys', 'about']) {
      t.ok(s.all.includes(id), `there is a "${id}" topic`);
    }

    // --- the filter -----------------------------------------------------------------
    await page.fill('.help-win__filter', 'gtao');
    s = await win(page);
    t.ok(s.shown.length >= 1 && s.shown.length < s.all.length, `the filter narrows the list (${s.shown.length} of ${s.all.length})`);
    t.ok(s.shown.includes('render-panel'), 'GTAO finds the Render panel, by its text');
    t.ok(s.shown.includes(s.topic), 'and the topic shown is one of them');
    t.eq(s.status, s.shown.length === 1 ? '1 topic' : `${s.shown.length} topics`, 'the filter says how many match');
    await page.fill('.help-win__filter', 'follow-flatten');
    s = await win(page);
    t.eq(s.shown.join(','), 'tool-polish', 'a phrase from one topic\'s body finds only that topic');
    await page.fill('.help-win__filter', 'CLAY');
    s = await win(page);
    t.ok(s.shown.includes('tool-clay'), 'the filter ignores case and reads titles');
    await page.fill('.help-win__filter', 'zzzqqq');
    s = await win(page);
    t.ok(s.shown.length === 0 && s.none, 'a filter nothing matches says so');
    await page.fill('.help-win__filter', '');
    s = await win(page);
    t.ok(s.shown.length === s.all.length && !s.none && s.text.length > 100, 'clearing it brings every topic back');

    // --- the keyboard ---------------------------------------------------------------
    await page.click('.help-win__item[data-topic="navigating"]');
    await page.keyboard.press('ArrowDown');
    t.eq((await win(page)).topic, 'tool-select', 'the Down arrow walks to the next topic in the list');
    await page.keyboard.press('ArrowUp');
    t.eq((await win(page)).topic, 'navigating', 'and the Up arrow back');
    // Tab never leaves the window.
    const seen = new Set();
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      seen.add(await page.evaluate(() => (document.querySelector('.help-win__card')?.contains(document.activeElement) ? 'in' : 'out')));
    }
    t.ok(seen.size === 1 && seen.has('in'), 'Tab keeps the focus inside the window');

    // --- the tools --------------------------------------------------------------------
    await page.keyboard.press('Escape');
    t.ok(!(await win(page)).open, 'Escape closes the window');
    t.ok(!(await win(page)).modal, 'and gives the keys back');
    const tools = await page.evaluate(() =>
      [...document.querySelectorAll('.sculpt-toolbar__btn')].map((b) => ({
        title: b.getAttribute('aria-label') ?? b.title,
        key: b.querySelector('.sculpt-toolbar__key')?.textContent ?? '',
      })),
    );
    t.ok(tools.length >= 13, `the toolbar has its buttons (${tools.length})`);
    await menuItem(page, 'Help topics');
    const map = await page.evaluate(() =>
      [...document.querySelectorAll('.help-win__item[data-tools]')].map((b) => ({ id: b.dataset.topic, tools: b.dataset.tools.split('|') })),
    );
    const unnamed = [];
    const noKey = [];
    for (const tool of tools) {
      const topic = map.find((m) => m.tools.some((n) => tool.title.startsWith(n)));
      if (!topic) {
        unnamed.push(tool.title);
        continue;
      }
      if (!tool.key) continue;
      await page.click(`.help-win__item[data-topic="${topic.id}"]`);
      const text = (await win(page)).text.toLowerCase();
      if (!text.includes(`default hotkey: ${tool.key.toLowerCase()}`)) noKey.push(`${tool.title} wants "Default hotkey: ${tool.key}"`);
    }
    t.ok(!unnamed.length, `every toolbar button has a topic${unnamed.length ? `: ${unnamed.join('; ')}` : ''}`);
    t.ok(!noKey.length, `each tool's topic states the hotkey its button shows${noKey.length ? `: ${noKey.join('; ')}` : ''}`);

    // --- About and credits ----------------------------------------------------------
    await page.keyboard.press('Escape');
    await menuItem(page, 'About and credits');
    await page.waitForSelector('.help-win:not([hidden])');
    s = await win(page);
    t.eq(s.topic, 'about', 'About and credits opens the About topic');
    const version = await page.evaluate(() => document.querySelector('.help-guide__ver')?.textContent.replace(/^Bozzetto /, '') ?? '');
    t.ok(version.length > 0 && s.text.includes(version), `it names the version (${version})`);
    t.ok(s.text.includes('Vidar Rapp'), 'it names who makes Bozzetto');
    t.ok(s.text.includes('Icons: Uicons by Flaticon'), 'it carries the Flaticon credit as its licence asks');
    t.ok(await page.evaluate(() => !!document.querySelector('.help-win__topic a[href="https://www.flaticon.com/uicons"]')), 'with a link to Flaticon');
    t.ok(s.text.includes('THIRD_PARTY_NOTICES.md') && /full legal text/.test(s.text), 'and says that THIRD_PARTY_NOTICES.md is the full legal text');
    const headings = noticeHeadings();
    t.ok(headings.length >= 20, `THIRD_PARTY_NOTICES.md has its headings (${headings.length})`);
    const missing = headings.filter((h) => !s.text.includes(h));
    t.ok(!missing.length, `About names every heading of THIRD_PARTY_NOTICES.md${missing.length ? `; missing: ${missing.join(', ')}` : ''}`);
    const bare = await page.evaluate(() =>
      [...document.querySelectorAll('.help-win__credit')]
        .filter((c) => !/Licence: \S/.test(c.textContent) || c.querySelector('p').textContent.length < 10)
        .map((c) => c.querySelector('h5').textContent),
    );
    t.ok(!bare.length, `every credit says what it is for and its licence${bare.length ? `: ${bare.join(', ')}` : ''}`);
    const links = await page.evaluate(() => [...document.querySelectorAll('.help-win__credit a')].every((a) => a.target === '_blank' && /noopener/.test(a.rel) && /^https:/.test(a.href)));
    t.ok(links, 'credit links open in a new tab, safely');
    await page.fill('.help-win__filter', 'mozilla public');
    s = await win(page);
    t.ok(s.shown.includes('about'), 'the filter reads the credits too');
    await page.keyboard.press('Escape');
    t.ok(!(await win(page)).open, 'Escape closes it again');
  },

  async helpPhone(page, base, t) {
    await page.setViewportSize({ width: 390, height: 780 });
    await openSculpt(page, base);
    await menuItem(page, 'Help topics');
    await page.waitForSelector('.help-win:not([hidden])');
    const lay = () =>
      page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const card = r('.help-win__card');
        const nav = r('.help-win__nav');
        const topic = r('.help-win__topic');
        return {
          card,
          nav: { t: nav.top, b: nav.bottom, w: nav.width },
          topic: { t: topic.top, b: topic.bottom, w: topic.width },
          overflow: document.querySelector('.help-win__card').scrollWidth - document.querySelector('.help-win__card').clientWidth,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          inside: card.left >= 0 && card.right <= innerWidth && card.top >= 0 && card.bottom <= innerHeight,
        };
      });
    const l = await lay();
    t.ok(l.nav.b <= l.topic.t + 1, `at phone width the list is above the topic (list ${Math.round(l.nav.t)}-${Math.round(l.nav.b)}, topic from ${Math.round(l.topic.t)})`);
    t.ok(l.topic.w >= 300 && l.nav.w >= 300, `both use the full width (${Math.round(l.nav.w)}, ${Math.round(l.topic.w)})`);
    t.ok(l.inside, 'the window fits the screen');
    t.ok(l.overflow <= 0 && l.pageOverflow <= 0, `nothing scrolls sideways (${l.overflow}, ${l.pageOverflow})`);
    t.ok(l.topic.b - l.topic.t >= 200, `the topic keeps room to read (${Math.round(l.topic.b - l.topic.t)}px)`);
    await page.click('.help-win__item[data-topic="render-panel"]');
    const l2 = await lay();
    t.ok(l2.overflow <= 0, 'a long topic does not push the window wider either');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(150);
    const wide = await lay();
    t.ok(wide.nav.w < 300 && Math.abs(wide.nav.t - wide.topic.t) < 4, 'back at desktop width the list sits beside the topic');
  },

  async helpArmature(page, base, t) {
    await openArmature(page, base);
    const chips = await page.evaluate(() => [...document.querySelectorAll('.bz-strip__menus .file-menu__chip')].map((c) => c.textContent.trim()));
    t.ok(chips.includes('Help'), `Armature has the Help menu (${chips.join(', ')})`);
    await page.click('.bz-strip__menus .file-menu__chip:has-text("Help")');
    await page.click('.file-menu--help .file-menu__item:has-text("Help topics")');
    await page.waitForSelector('.help-win:not([hidden])');
    await page.click('.help-win__item[data-topic="armature"]');
    const s = await win(page);
    t.ok(s.topic === 'armature' && s.text.includes('Plant feet'), 'it opens the Help window, with the Armature topic');
    await page.keyboard.press('Escape');
    t.ok(!(await win(page)).open, 'Escape closes it');
  },
};
