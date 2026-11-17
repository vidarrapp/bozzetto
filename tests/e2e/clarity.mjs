// Fixes from a design critique: the Create window for everyone but the
// owner, the edge sliders' names only while in use, the edge buttons'
// names, Esc and the layout of the hotkey guide, Familjen Grotesk on
// buttons and badges, no hotkeys in panel labels, Help's plain Close and
// the Preset select telling the truth about the lights.
import { openArmature, openSculpt } from './lib.mjs';

const fam = (page, sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).fontFamily, sel);

export const suites = {
  async clarityCreate(page, base, t) {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.card--new');
    t.ok(!/Martian/i.test(await fam(page, '.card--new__label')), 'the Create tile label is not in Martian Mono');
    t.eq(await page.evaluate(() => getComputedStyle(document.querySelector('.card--new__label')).textTransform), 'none', 'and not in capitals');
    await page.click('.card--new');
    await page.waitForSelector('.create-choice');
    const titles = await page.evaluate(() => [...document.querySelectorAll('.create-choice__title')].map((e) => e.textContent));
    t.eq(titles.join(' | '), 'New Sculpt | New Armature | Import OBJ', 'a guest is offered New Sculpt, New Armature and Import OBJ, no timelapse');
    const rec = await page.evaluate(() => [...document.querySelectorAll('.create-choice')].map((b) => ({ rec: b.classList.contains('create-choice--recommended'), bg: getComputedStyle(b).backgroundColor })));
    t.ok(rec[0].rec && !rec[1].rec && !rec[2].rec, 'New Sculpt alone is the recommended choice');
    t.eq(rec[0].bg, 'rgb(198, 255, 0)', 'in lime');
    t.ok(!/Martian/i.test(await fam(page, '.create-choice__title')), 'the choices are in Familjen Grotesk');
    t.eq(await page.evaluate(() => getComputedStyle(document.querySelector('.create-choice__title')).textTransform), 'none', 'in sentence case');
    t.ok(!(await page.evaluate(() => document.querySelector('.create-overlay').textContent.toLowerCase().includes('timelapse'))), 'the window does not mention timelapses');
    // Badges and chips.
    const caps = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('.badge, .card__badge, .topchip, button, .btn')) {
        const cs = getComputedStyle(el);
        if (!el.textContent.trim()) continue;
        if (/Martian/i.test(cs.fontFamily) && cs.textTransform === 'uppercase') bad.push(`${el.className}:${el.textContent.trim()}`);
      }
      return bad;
    });
    t.eq(caps.join(', '), '', 'no button, chip or badge is in Martian Mono capitals');
  },

  async claritySculpt(page, base, t) {
    await openSculpt(page, base);
    await page.waitForSelector('.bz-edge .sculpt-slider');
    const vis = (sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).display !== 'none', sel);
    const size = '.bz-edge .sculpt-slider[data-kind="size"] .sculpt-slider__name';
    const strength = '.bz-edge .sculpt-slider[data-kind="strength"] .sculpt-slider__name';
    t.ok(!(await vis(size)) && !(await vis(strength)), 'the slider names are not on screen at rest');
    t.eq(await page.evaluate((s) => document.querySelector(s).textContent, size), 'Size', 'one is Size');
    t.eq(await page.evaluate((s) => document.querySelector(s).textContent, strength), 'Strength', 'the other Strength');
    const style = await page.evaluate((s) => {
      const cs = getComputedStyle(document.querySelector(s));
      return { f: cs.fontFamily, size: cs.fontSize, bg: cs.backgroundColor, border: cs.borderTopWidth };
    }, size);
    t.ok(/Familjen/i.test(style.f) && style.size === '11px' && style.bg === 'rgba(0, 0, 0, 0)' && style.border === '0px', `in Familjen Grotesk 11px with no box (${JSON.stringify(style)})`);
    // Hover.
    const box = await page.locator('.bz-edge .sculpt-slider[data-kind="size"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    t.ok(await vis(size), 'a mouse over the slider shows its name');
    await page.mouse.move(600, 300);
    t.ok(!(await vis(size)), 'and it is gone when the mouse leaves');
    // A press, as a finger or the Pencil makes it.
    const press = (kind, type, id) =>
      page.evaluate(
        ([k, ty, name, pid]) => {
          const el = document.querySelector(`.bz-edge .sculpt-slider[data-kind="${k}"]`);
          const r = el.getBoundingClientRect();
          el.dispatchEvent(new PointerEvent(name, { bubbles: true, pointerId: pid, pointerType: ty, isPrimary: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, buttons: name === 'pointerup' ? 0 : 1 }));
        },
        [kind, type, id.name, id.pid],
      );
    await press('strength', 'pen', { name: 'pointerdown', pid: 41 });
    t.ok(await vis(strength), 'while the Pencil presses the slider its name shows');
    t.ok(!(await vis(size)), 'and only that slider\'s');
    await press('strength', 'pen', { name: 'pointerup', pid: 41 });
    t.ok(!(await vis(strength)), 'lifted, the name goes');

    // The edge buttons name themselves.
    const tip = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s + ' > .bz-tip');
      return el ? { shown: getComputedStyle(el).display !== 'none', text: el.textContent } : null;
    }, sel);
    const solo = '.bz-edge .sculpt-solobtn';
    const names = {};
    for (const [k, sel] of [['Solo', solo], ['Undo', '.bz-edge [data-hist="undo"]'], ['Redo', '.bz-edge [data-hist="redo"]'], ['Negative', '.bz-edge .sculpt-toolbar__btn']]) {
      const tp = await tip(sel);
      names[k] = tp && tp.text.startsWith(k) && !tp.shown;
    }
    t.ok(Object.values(names).every(Boolean), `each edge button has its name, hidden at rest (${JSON.stringify(names)})`);
    await page.hover(solo, { force: true });
    t.ok((await tip(solo))?.shown, 'hovering Solo shows its name');
    await page.mouse.move(600, 300);
    t.ok(!(await tip(solo))?.shown, 'moving off hides it');
    await page.evaluate((s) => document.querySelector(s).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 42, pointerType: 'touch', isPrimary: true })), '.bz-edge .sculpt-toolbar__btn');
    await page.waitForTimeout(150);
    t.ok(!(await tip('.bz-edge .sculpt-toolbar__btn'))?.shown, 'a short touch on Negative does not show its name');
    await page.waitForTimeout(500);
    t.ok((await tip('.bz-edge .sculpt-toolbar__btn'))?.shown, 'a long press on Negative does');
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 42, pointerType: 'touch' })));
    await page.waitForTimeout(1500);
    t.ok(!(await tip('.bz-edge .sculpt-toolbar__btn'))?.shown, 'and it goes after the finger lifts');
  },

  async clarityGuide(page, base, t) {
    await openSculpt(page, base);
    await page.keyboard.press('h');
    t.ok(await page.evaluate(() => !document.querySelector('.help-guide').hidden), 'H opens the hotkey guide');
    await page.keyboard.press('Escape');
    t.ok(await page.evaluate(() => document.querySelector('.help-guide').hidden), 'Esc closes it');
    await page.keyboard.press('Escape');
    t.ok(await page.evaluate(() => document.querySelector('.help-guide').hidden), 'Esc with the guide shut leaves it shut');
    await page.keyboard.press('h');
    const g = await page.evaluate(() => {
      const guide = document.querySelector('.help-guide');
      const cs = getComputedStyle(guide);
      const gr = guide.getBoundingClientRect();
      const chips = [...guide.querySelectorAll('kbd, .help-key')];
      const close = guide.querySelector('.help-guide__close');
      const aligns = new Set([...guide.querySelectorAll('.help-row > span:last-child')].map((s) => getComputedStyle(s).textAlign));
      const wraps = chips.filter((c) => c.getClientRects().length > 1 || c.getBoundingClientRect().height > 24).length;
      return {
        overflowY: cs.overflowY,
        fits: gr.bottom <= innerHeight && gr.right <= innerWidth,
        nowrap: new Set(chips.map((c) => getComputedStyle(c).whiteSpace)).size === 1 && getComputedStyle(chips[0]).whiteSpace === 'nowrap',
        wraps,
        closeH: close.getBoundingClientRect().height,
        closeText: close.textContent,
        closeFont: getComputedStyle(close).fontFamily,
        aligns: [...aligns].join(','),
        text: guide.textContent,
      };
    });
    t.eq(g.overflowY, 'auto', 'the guide scrolls inside itself');
    t.ok(g.fits, 'and stays on the screen');
    t.ok(g.nowrap && g.wraps === 0, `key chips do not wrap (${g.wraps} wrapped)`);
    t.ok(g.closeH <= 20, `the close hint is on one line (${g.closeH}px, "${g.closeText}")`);
    t.ok(/Esc/.test(g.closeText), 'and it names Esc');
    t.ok(!/Martian/i.test(g.closeFont), 'in Familjen Grotesk');
    t.eq(g.aligns, 'left', 'the descriptions all align left');
    t.ok(/Pencil/.test(g.text) && /tap/i.test(g.text), 'the gestures cover the Pencil and touch');
    await page.keyboard.press('Escape');

    // Esc still leaves Present, and one press with the guide open is spent on the guide.
    await page.setViewportSize({ width: 600, height: 400 });
    await page.keyboard.press('h');
    const sc = await page.evaluate(() => {
      const guide = document.querySelector('.help-guide');
      return { client: guide.clientHeight, scroll: guide.scrollHeight, bottom: guide.getBoundingClientRect().bottom };
    });
    t.ok(sc.scroll > sc.client && sc.bottom <= 400, `in a short window the guide scrolls (${sc.scroll} in ${sc.client}) and is not cut off`);
    await page.keyboard.press('Escape');
  },

  async clarityLabels(page, base, t) {
    await openSculpt(page, base);
    const labels = await page.evaluate(() => [...document.querySelectorAll('label.checkbox')].map((l) => l.textContent.trim()));
    t.ok(labels.includes('Wireframe'), `the Render panel says Wireframe (${labels.join(', ')})`);
    t.ok(!labels.some((l) => /\(.*(Shift|Ctrl|Alt|[A-Z])\)\s*$/.test(l) && /Wireframe|Mirror/.test(l)), 'no hotkey stands in a panel label');
    t.ok(await page.evaluate(() => [...document.querySelectorAll('label.checkbox')].some((l) => /Wireframe \(Shift \+ W\)/.test(l.title))), 'the hotkey is in its tooltip');

    // Help's Close.
    await page.click('.bz-strip__menus .file-menu__chip:has-text("Help")');
    await page.click('.file-menu--help .file-menu__item:has-text("Help topics")');
    await page.waitForSelector('.help-win__close');
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.help-win__close')).backgroundColor);
    const orange = await page.evaluate(() => {
      const d = document.createElement('i');
      d.style.color = getComputedStyle(document.documentElement).getPropertyValue('--bz-orange');
      document.body.appendChild(d);
      const c = getComputedStyle(d).color;
      d.remove();
      return c;
    });
    t.ok(bg !== orange, `Help's Close is not orange (${bg})`);
    const start = await page.evaluate(() => document.querySelector('.help-win__topic')?.textContent ?? '');
    t.ok(!/timelapse/i.test(start), 'the first Help topic does not mention timelapses');
    t.ok(/Armature/.test(start.slice(0, 220)) && /Sculpt/.test(start.slice(0, 260)) && /Present/.test(start.slice(0, 300)), 'it leads with Armature, Sculpt and Present');
  },

  async clarityLight(page, base, t) {
    const sel = () =>
      page.evaluate(() => {
        const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'built:three_point'));
        return s ? { value: s.value, text: s.selectedOptions[0]?.textContent } : null;
      });
    await openSculpt(page, base);
    const rig = await page.evaluate(() => window.__bozzetto.lighting.state().map((l) => `${l.id}:${l.enabled}`).join(','));
    t.eq(rig, 'key:true,fill:false,rim:false', 'Sculpt opens with the key light alone');
    // The rig select is the Lighting tab's, in Present.
    await page.evaluate(() => window.__sculpt.present.enter());
    await page.evaluate(() => document.querySelector('.panel--lighting > .panel__handle').click());
    let s = await sel();
    t.eq(s?.text, 'Key only', 'and the Rig says so');
    await page.evaluate(() => window.__bozzetto.lighting.setEnabled('fill', true));
    await page.evaluate(() => window.__bozzetto.lighting.setEnabled('rim', true));
    t.eq(await page.evaluate(() => window.__bozzetto.lighting.activePreset()), 'three_point', 'with the fill and the rim on it is Three-point');
    await page.evaluate(() => window.__bozzetto.lighting.setIntensity('key', 1.7));
    t.eq(await page.evaluate(() => window.__bozzetto.lighting.activePreset()), null, 'a changed light matches no preset');
    await page.evaluate(() => window.dispatchEvent(new Event('bozzetto:controls-refresh')));
    t.eq((await sel())?.text, 'Custom', 'and the Rig reads Custom');
    await openArmature(page, base);
    t.eq(await page.evaluate(() => window.__bozzetto.lighting.activePreset()), 'three_point', 'Armature opens with all three lights, which is Three-point');
  },
};
