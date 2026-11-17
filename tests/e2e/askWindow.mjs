// The app's own question window (src/ui/askWindow.ts), in place of the
// browser's confirm(), alert() and prompt(): what it says, the red button for
// what loses work, Cancel, Esc, a tap beside the window, the keyboard, a
// finger at 390 wide. And that no native question is left in src.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openSculpt } from './lib.mjs';

/** What the open window looks like, as a person sees it. */
const look = (page) =>
  page.evaluate(() => {
    const win = document.querySelector('.bz-ask');
    if (!win) return null;
    const yes = win.querySelector('.bz-ask-yes');
    const cancel = win.querySelector('.bz-ask-cancel');
    const swatch = (value) => {
      const probe = document.createElement('i');
      probe.style.background = value;
      document.body.appendChild(probe);
      const c = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return c;
    };
    const css = getComputedStyle(yes);
    const card = win.querySelector('.bz-ask__card').getBoundingClientRect();
    const rows = (b) => b.getBoundingClientRect();
    return {
      title: win.querySelector('h2')?.textContent ?? '',
      text: win.querySelector('p')?.textContent ?? '',
      yes: yes.textContent,
      cancel: cancel?.textContent ?? null,
      danger: yes.classList.contains('btn--danger'),
      bg: css.backgroundColor,
      red: swatch('var(--bz-red)'),
      orange: swatch('var(--bz-orange)'),
      color: css.color,
      focus: document.activeElement?.className ?? '',
      card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom },
      yesH: rows(yes).height,
      cancelH: cancel ? rows(cancel).height : 0,
      view: { w: window.innerWidth, h: window.innerHeight },
      scrollX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

const gone = (page) => page.waitForFunction(() => !document.querySelector('.bz-ask'), null, { timeout: 5000 }).then(() => true, () => false);
const shown = (page) => page.waitForSelector('.bz-ask', { timeout: 8000 }).then(() => true, () => false);
const names = (page) => page.evaluate(() => window.__sculpt.session.getMeshes().map((m) => window.__sculpt.session.getMeshName(m)));
const blur = (page) => page.evaluate(() => document.activeElement?.blur?.());

const srcFiles = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'vendor') srcFiles(p, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
};

export const suites = {
  /** No confirm(, alert( or prompt( is left in src; the one native prompt is the browser's own, at beforeunload. */
  async noNativeDialogs(_page, _base, t) {
    const root = resolve('src');
    const hits = [];
    const beforeUnload = [];
    for (const file of srcFiles(root)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
        if (/\b(confirm|alert|prompt)\(/.test(code)) hits.push(`${file.slice(root.length + 1)}:${i + 1}: ${code.slice(0, 90)}`);
        if (/['"]beforeunload['"]/.test(code)) beforeUnload.push(file.slice(root.length + 1));
      });
    }
    t.ok(hits.length === 0, `src asks nothing with confirm(, alert( or prompt( (${hits.join(' | ') || 'none'})`);
    t.eq(beforeUnload.join(','), 'present/workspace.ts', 'beforeunload is the one native question left, in Present: browsers allow nothing else there');
  },

  async askWindow(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base, '&q=low');
    await page.evaluate(() => window.__sculpt.session.addPrimitive('capsule'));
    const before = await names(page);
    t.ok(before.length >= 2, `a scene with work in it (${before.join(', ')})`);
    const active = await page.evaluate(() => window.__sculpt.session.getMeshName(window.__sculpt.session.getMesh()));

    // --- Delete object: the Delete key -----------------------------------------------------------
    const ask = async () => {
      await blur(page);
      await page.keyboard.press('Delete');
      return shown(page);
    };
    t.ok(await ask(), 'Delete asks in the app\'s own window');
    let w = await look(page);
    t.eq(w.title, `Delete ${active}?`, 'the question names the thing');
    t.eq(w.yes, 'Delete', 'the verb is on the button');
    t.eq(w.cancel, 'Cancel', 'Cancel is there');
    t.ok(w.danger && w.bg === w.red && w.bg !== w.orange, `the button is red (${w.bg}, red is ${w.red})`);
    const light = (c) => (c.match(/\d+/g) ?? []).slice(0, 3).every((n) => Number(n) >= 245);
    t.ok(light(w.color), `with a white label (${w.color})`);
    t.ok(/bz-ask-cancel/.test(w.focus), `the focus is on Cancel (${w.focus})`);
    await page.keyboard.press('Enter');
    t.ok((await gone(page)) && (await names(page)).length === before.length, 'Enter on a red ask does not delete: it presses Cancel, and the work stays');

    await ask();
    await page.keyboard.press('Escape');
    t.ok((await gone(page)) && (await names(page)).length === before.length, 'Esc cancels, and the work stays');

    await ask();
    await page.mouse.click(8, 8);
    t.ok((await gone(page)) && (await names(page)).length === before.length, 'a press beside the window cancels, and the work stays');

    await ask();
    await page.click('.bz-ask-cancel');
    t.ok((await gone(page)) && (await names(page)).length === before.length, 'Cancel keeps the work');

    await ask();
    await page.click('.bz-ask-yes');
    t.ok(await gone(page), 'Delete closes the window');
    t.eq((await names(page)).length, before.length - 1, 'and deletes the object');
    await page.evaluate(() => window.__sculpt.session.undo());
    t.eq((await names(page)).length, before.length, 'which an undo brings back');

    // --- the trash in the Scene panel -------------------------------------------------------------
    await page.evaluate(() => {
      const row = document.querySelector('.panel--scene .outliner__row--active');
      [...(row?.querySelectorAll('.outliner__icon') ?? [])].find((b) => /Delete/.test(b.title))?.click();
    });
    t.ok(await shown(page), 'the trash asks the same way');
    await page.keyboard.press('Escape');
    await gone(page);

    // --- New sculpt over work --------------------------------------------------------------------------
    const menu = async (menuName, item) => {
      await page.evaluate((n) => [...document.querySelectorAll('.bz-strip__menus .bz-menuname')].find((b) => b.textContent === n)?.click(), menuName);
      await page.waitForFunction(() => document.querySelector('.bz-menuname.is-open'), null, { timeout: 5000 });
      await page.evaluate((l) => {
        const row = [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].find((b) => (b.querySelector('.file-menu__label')?.textContent ?? b.textContent.trim()) === l);
        row?.click();
      }, item);
    };
    await menu('File', 'New sculpt');
    t.ok(await shown(page), 'File > New sculpt asks when there is work');
    w = await look(page);
    t.ok(w.title === 'Start a new sculpt?' && w.yes === 'Start new' && w.danger && w.bg === w.red, `with its own words and a red button (${w.title} / ${w.yes})`);
    await page.click('.bz-ask-cancel');
    await gone(page);
    t.eq((await names(page)).length, before.length, 'Cancel keeps the work');
    await menu('File', 'New sculpt');
    await shown(page);
    await page.keyboard.press('Escape');
    await gone(page);
    t.eq((await names(page)).length, before.length, 'Esc keeps the work');
    await menu('File', 'New sculpt');
    await shown(page);
    await page.click('.bz-ask-yes');
    await page.waitForFunction((n) => window.__sculpt.session.getMeshes().length !== n, before.length, { timeout: 10_000 }).catch(() => {});
    t.ok((await names(page)).length !== before.length, `Start new replaces the scene (${(await names(page)).join(', ')})`);

    // --- the Model panel's Dynamic topology (a loss of subdivision levels) ---------------------------------
    await page.evaluate(() => window.__sculpt.modelPanel.setCollapsed(false));
    const box = page.locator('label:has-text("Dynamic topology") input[type="checkbox"]').first();
    await box.click();
    t.ok(await shown(page), 'Dynamic topology asks before flattening the levels');
    w = await look(page);
    t.ok(w.yes === 'Turn on' && w.danger, `with a verb on a red button (${w.yes})`);
    await page.click('.bz-ask-cancel');
    await gone(page);
    t.ok(!(await box.isChecked()) && !(await page.evaluate(() => window.__sculpt.session.isDynamicTopology())), 'Cancel leaves it off');
    await box.click();
    await shown(page);
    await page.click('.bz-ask-yes');
    await gone(page);
    t.ok(await page.evaluate(() => window.__sculpt.session.isDynamicTopology()), 'Turn on turns it on');
    await page.evaluate(() => window.__sculpt.session.toggleDynamicTopology());

    // --- a phone: 390 wide, a finger -------------------------------------------------------------------
    const ctx = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const phone = await ctx.newPage();
    try {
      await openSculpt(phone, base, '&q=low');
      await phone.evaluate(() => window.__sculpt.session.addPrimitive('capsule'));
      const n = (await names(phone)).length;
      await blur(phone);
      await phone.keyboard.press('Delete');
      t.ok(await shown(phone), 'at 390 wide the ask opens');
      const p = await look(phone);
      t.ok(p.card.left >= 0 && p.card.right <= p.view.w && p.card.bottom <= p.view.h && p.scrollX <= 0, `inside the screen, nothing scrolls sideways (${JSON.stringify(p.card)})`);
      t.ok(p.yesH >= 36 && p.cancelH >= 36, `with buttons a finger can hit (${p.yesH}, ${p.cancelH})`);
      await phone.screenshot({ path: process.env.ASK_SHOTS ? join(process.env.ASK_SHOTS, 'ask-390x844.png') : undefined }).catch(() => {});
      const cancel = await phone.locator('.bz-ask-cancel').boundingBox();
      await phone.touchscreen.tap(cancel.x + cancel.width / 2, cancel.y + cancel.height / 2);
      t.ok((await gone(phone)) && (await names(phone)).length === n, 'a tap on Cancel keeps the work');
      await blur(phone);
      await phone.keyboard.press('Delete');
      await shown(phone);
      await phone.touchscreen.tap(6, 6);
      t.ok((await gone(phone)) && (await names(phone)).length === n, 'a tap beside the window cancels');
      await blur(phone);
      await phone.keyboard.press('Delete');
      await shown(phone);
      const yes = await phone.locator('.bz-ask-yes').boundingBox();
      await phone.touchscreen.tap(yes.x + yes.width / 2, yes.y + yes.height / 2);
      await gone(phone);
      t.eq((await names(phone)).length, n - 1, 'a tap on Delete deletes');
    } finally {
      await ctx.close();
    }
    if (process.env.ASK_SHOTS) {
      await page.setViewportSize({ width: 1180, height: 820 });
      await blur(page);
      await page.keyboard.press('Delete');
      await shown(page);
      await page.screenshot({ path: join(process.env.ASK_SHOTS, 'ask-1180x820.png') });
      await page.keyboard.press('Escape');
    }
  },
};
