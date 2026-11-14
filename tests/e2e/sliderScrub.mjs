// Sliders as a whole-row touch target (ui/sliderScrub): a press anywhere on a
// slider's row and a drag sideways scrubs its value, relatively, from where
// it is; a tap changes nothing; a vertical swipe scrolls the panel. And the
// Render panel's Camera section holds the depth of field rows. Each gets
// (page, base, t).
import { openSculpt } from './lib.mjs';

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'block' };

/** Finger events over CDP, as a real touch screen sends them. */
async function finger(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
  return {
    async tap(x, y) {
      await send('touchStart', x, y);
      await page.waitForTimeout(40);
      await send('touchEnd', x, y);
    },
    async swipe(x0, y0, x1, y1, steps = 10) {
      await send('touchStart', x0, y0);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
        await page.waitForTimeout(16);
      }
      await send('touchEnd', x1, y1);
      await page.waitForTimeout(80);
    },
  };
}

/** The Render panel's slider row by its name: its value and travel, the input's box and the name's box, in CSS px. */
const rowOf = (page, name) =>
  page.evaluate((n) => {
    const row = [...document.querySelectorAll('.panel--render label.compact')].find((l) => l.firstElementChild?.textContent === n);
    if (!row) return null;
    const input = row.querySelector('input[type=range]');
    const box = (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return { value: Number(input.value), min: Number(input.min), max: Number(input.max), input: box(input), name: box(row.firstElementChild) };
  }, name);

/** Put a slider at a value the way a hotkey would, and count the events that follow. */
const prime = (page, name, v) =>
  page.evaluate(
    ([n, val]) => {
      const row = [...document.querySelectorAll('.panel--render label.compact')].find((l) => l.firstElementChild?.textContent === n);
      const input = row.querySelector('input[type=range]');
      row.scrollIntoView({ block: 'center' });
      input.value = String(val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      window.__events = { input: 0, change: 0 };
      if (!input.__counted) {
        input.__counted = true;
        input.addEventListener('input', () => window.__events.input++);
        input.addEventListener('change', () => window.__events.change++);
      }
    },
    [name, v],
  );
const events = (page) => page.evaluate(() => window.__events);

export const suites = {
  async sliderScrub(page, base, t) {
    // --- the desktop keeps the native slider under a mouse ------------------
    await openSculpt(page, base);
    await page.click('.panel--render > .panel__handle');
    await page.waitForTimeout(400);
    const desk = await page.evaluate(() => getComputedStyle(document.querySelector('.panel--render label.compact input[type=range]')).pointerEvents);
    t.eq(desk, 'auto', 'with a mouse the line itself still takes the press (click to jump, drag the thumb)');

    // --- Depth of field sits under Camera ------------------------------------
    const heads = await page.evaluate(() => {
      const secs = [...document.querySelectorAll('.panel--render .section')];
      const camera = secs.find((s) => s.querySelector(':scope > h3')?.textContent === 'Camera');
      return {
        headings: secs.map((s) => s.querySelector(':scope > h3')?.textContent),
        cameraRows: camera ? [...camera.querySelectorAll('label > span:first-child, .checkbox > span')].map((e) => e.textContent.trim()) : [],
        folded: !!camera?.querySelector(':scope > .dof-rows'),
        shown: !!camera && !camera.hidden,
      };
    });
    t.ok(!heads.headings.includes('Depth of field'), `no separate Depth of field section (${heads.headings})`);
    t.ok(heads.shown && ['Lens', 'Tone mapping', 'Depth of field'].every((r) => heads.cameraRows.includes(r)), `Camera holds its own rows then the Depth of field switch (${heads.cameraRows})`);
    t.ok(heads.folded, 'the Aperture and Focus rows fold under it, in the Camera section');
    await page.evaluate(() => document.querySelector('.panel--render .dof-rows').closest('.section').querySelector('.checkbox input').click());
    await page.waitForTimeout(150);
    const open = await page.evaluate(() => {
      const rows = document.querySelector('.panel--render .dof-rows');
      return { hidden: rows.hidden, labels: [...rows.querySelectorAll('label > span:first-child')].map((e) => e.textContent) };
    });
    t.ok(!open.hidden && open.labels.join() === 'Aperture,Focus', `switching it on shows Aperture and Focus (${open.labels})`);

    // --- a finger on a phone ----------------------------------------------------
    const ctx = await page.context().browser().newContext(PHONE);
    await ctx.addInitScript(() => {
      window.__bozzettoAdaptiveOff = true;
    });
    try {
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(String(e)));
      await openSculpt(p, base);
      await p.click('.panel--render > .panel__handle');
      await p.waitForTimeout(500);
      await p.evaluate(() => {
        const box = document.querySelector('.panel--render .dof-rows').closest('.section').querySelector('.checkbox input');
        if (!box.checked) box.click();
      });
      await p.waitForTimeout(200);
      const pe = await p.evaluate(() => getComputedStyle(document.querySelector('.panel--render label.compact input[type=range]')).pointerEvents);
      t.eq(pe, 'none', 'on a touch screen the line ignores presses, so the row takes them');
      const f = await finger(p);

      // From the name, at 0: up.
      await prime(p, 'Focus', 0);
      let r = await rowOf(p, 'Focus');
      await f.swipe(r.name.x + 8, r.name.y + 8, r.name.x + 8 + r.input.w / 2, r.name.y + 8);
      let after = await rowOf(p, 'Focus');
      let ev = await events(p);
      t.ok(Math.abs(after.value - 0.5) < 0.08, `a drag across half the row, from its name, moves a slider at 0 up by half its travel (${r.value} to ${after.value})`);
      t.ok(ev.input > 2 && ev.change === 1, `with input events as it goes and one change at the end (${JSON.stringify(ev)})`);

      // From the line, at full: down.
      await prime(p, 'Focus', 1);
      r = await rowOf(p, 'Focus');
      await f.swipe(r.input.x + r.input.w - 4, r.input.y + r.input.h - 6, r.input.x + r.input.w / 2, r.input.y + r.input.h - 6);
      after = await rowOf(p, 'Focus');
      t.ok(Math.abs(after.value - 0.5) < 0.08, `a slider at full drags down from the end of its line (${r.value} to ${after.value})`);

      // Relative: a tenth of the row is a tenth of the travel, wherever it starts.
      await prime(p, 'Focus', 0.2);
      r = await rowOf(p, 'Focus');
      await f.swipe(r.input.x + r.input.w * 0.8, r.input.y + 12, r.input.x + r.input.w * 0.9, r.input.y + 12);
      after = await rowOf(p, 'Focus');
      t.ok(Math.abs(after.value - 0.3) < 0.06, `a drag is relative: a tenth of the row is a tenth of the travel (${after.value})`);

      // A tap alone does nothing.
      await prime(p, 'Focus', 0.4);
      r = await rowOf(p, 'Focus');
      await f.tap(r.input.x + r.input.w * 0.9, r.input.y + 12);
      await p.waitForTimeout(450);
      after = await rowOf(p, 'Focus');
      ev = await events(p);
      t.ok(after.value === 0.4 && ev.input === 0 && ev.change === 0, `a tap on the row changes nothing, with no jump (${after.value}, ${JSON.stringify(ev)})`);

      // A double tap still opens the number field.
      // Two touch taps in quick succession, sent from the page: a slow software frame stretches real ones past the double-tap window.
      await p.evaluate(([x, y]) => {
        const row = document.elementFromPoint(x, y);
        const opts = { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, clientX: x, clientY: y };
        for (let i = 0; i < 2; i++) {
          row.dispatchEvent(new PointerEvent('pointerdown', { ...opts, buttons: 1 }));
          row.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
        }
      }, [r.input.x + r.input.w * 0.5, r.input.y + 12]);
      await p.waitForTimeout(200);
      const field = await p.evaluate(() => !!document.querySelector('.panel--render .slider-field'));
      t.ok(field, 'a double tap on the row opens the number field');
      await p.keyboard.press('Escape');
      await p.waitForTimeout(100);

      // A vertical swipe scrolls the panel and leaves the value.
      await prime(p, 'Focus', 0.4);
      const scroller = () =>
        p.evaluate(() => {
          let e = document.querySelector('.panel--render .dof-rows');
          while (e && e.scrollHeight <= e.clientHeight + 1) e = e.parentElement;
          return e ? e.scrollTop : -1;
        });
      await p.evaluate(() => document.querySelector('.panel--render .dof-rows label.compact').scrollIntoView({ block: 'end' }));
      await p.waitForTimeout(100);
      r = await rowOf(p, 'Focus');
      const top0 = await scroller();
      await f.swipe(r.input.x + r.input.w * 0.5 + 6, r.input.y + 12, r.input.x + r.input.w * 0.5 + 12, r.input.y - 90);
      const top1 = await scroller();
      after = await rowOf(p, 'Focus');
      t.ok(top1 > top0, `a swipe up from a row scrolls the panel (${top0} to ${top1})`);
      t.ok(after.value === 0.4, `and leaves the slider where it was (${after.value})`);
      t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    } finally {
      await ctx.close();
    }
  },
};
