// smoothMask: the Smooth and Mask buttons on the left edge, beside Carve.
// A tap arms the next stroke only, a long press keeps it on until a tap, and
// a stroke then goes as if Shift (Smooth) or Ctrl (Mask) were held when the
// press began. Real input: the mouse through the page, the Pencil and the
// finger through the browser's own pen and touch events (CDP). Nothing here
// is a real Apple Pencil or a real iPad.
import { mkdirSync } from 'node:fs';
import { camMoved, camera, devices, line, meshSum, openForInput, restoreCamera, screenOf, settle, strokeCount } from './smoke.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/smoothmask';
const CTRL = 2;
const SHIFT = 8;

export const suites = {
  async smoothMask(page, base, t) {
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    const dev = await devices(page);
    await page.keyboard.press('3'); // Standard clay
    await page.keyboard.press('f');
    await settle(page);
    const home = await camera(page);
    const [cx, cy] = await screenOf(page, 'Sphere');
    const path = line([cx - 90, cy - 20], [cx + 90, cy + 20]);

    const btn = (which) =>
      page.evaluate((w) => {
        const b = document.querySelector(w === 'carve' ? '.bz-edge .sculpt-toolbar__neg' : `.bz-edge [data-arm="${w}"]`);
        if (!b || b.hidden || getComputedStyle(b).display === 'none') return null;
        const r = b.getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      }, which);
    const look = (which) =>
      page.evaluate((w) => {
        const b = document.querySelector(w === 'carve' ? '.bz-edge .sculpt-toolbar__neg' : `.bz-edge [data-arm="${w}"]`);
        return b.classList.contains('sculpt-toolbar__btn--active') ? 'latched' : b.classList.contains('sculpt-toolbar__btn--armed') ? 'armed' : 'off';
      }, which);
    const looks = async () => `${await look('smooth')}/${await look('mask')}/${await look('carve')}`;
    const now = () => Date.now() / 1000;
    const tap = async (which) => {
      const at = await btn(which);
      const t0 = now();
      await dev.touch('touchStart', [at], t0);
      await dev.touch('touchEnd', [], t0 + 0.05);
    };
    const longPress = async (which) => {
      const at = await btn(which);
      const t0 = now();
      await dev.touch('touchStart', [at], t0);
      await page.waitForFunction((w) => document.querySelector(`.bz-edge [data-arm="${w}"]`)?.classList.contains('sculpt-toolbar__btn--active'), which, { timeout: 10_000, polling: 50 });
      await dev.touch('touchEnd', [], Math.max(now(), t0 + 0.7));
    };
    const toolNow = () => page.evaluate(() => window.__sculpt.input.currentToolIndex());
    /** One pen stroke along the path; the tool in hand halfway through it. */
    const stroke = async (modifiers = 0) => {
      const before = await strokeCount(page);
      const mid = await dev.penDrag(path, toolNow, modifiers);
      await settle(page);
      return { mid, began: (await strokeCount(page)) - before };
    };
    const verts = () =>
      page.evaluate(() => {
        const m = window.__sculpt.session.getMesh();
        return Array.from(m.getVertices().slice(0, m.getNbVertices() * 3));
      });
    const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
    const masked = () =>
      page.evaluate(() => {
        const m = window.__sculpt.session.getMesh();
        const mat = m.getMaterials();
        const n = m.getNbVertices();
        let sum = 0;
        for (let i = 0; i < n; i++) sum += 1 - mat[i * 3 + 2];
        return sum / n;
      });
    const undo = async () => {
      await page.evaluate(() => window.__sculpt.session.undo());
      await settle(page);
    };

    // The tool each key swaps in, read halfway through a keyed stroke.
    const clayIdx = await toolNow();
    const smoothIdx = (await stroke(SHIFT)).mid;
    const maskIdx = (await stroke(CTRL)).mid;
    t.ok(smoothIdx !== clayIdx && maskIdx !== clayIdx && smoothIdx !== maskIdx, `Shift and Ctrl each swap a tool in (${clayIdx}, ${smoothIdx}, ${maskIdx})`);
    await undo(); // the mask stroke
    await page.evaluate(() => window.__sculpt.input.setStrokeKey('mask', 'armed', false));

    // --- the buttons: names, order, rest ---
    const info = await page.evaluate(() => {
      const names = (w) => {
        const b = document.querySelector(`.bz-edge [data-arm="${w}"]`);
        return { name: b.querySelector('.bz-tip__name')?.textContent, label: b.getAttribute('aria-label'), top: b.getBoundingClientRect().top, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height };
      };
      return { smooth: names('smooth'), mask: names('mask'), carve: document.querySelector('.bz-edge .sculpt-toolbar__neg').getBoundingClientRect().top };
    });
    t.eq(info.smooth.name, 'Smooth (hold Shift)', 'Smooth is named Smooth (hold Shift)');
    t.eq(info.mask.name, 'Mask (hold Ctrl)', 'Mask is named Mask (hold Ctrl)');
    t.ok(info.mask.top < info.smooth.top && info.smooth.top < info.carve, 'bottom up: Carve, Smooth, Mask');
    t.ok(info.smooth.w >= 40 && info.smooth.h >= 40, `a button is 40px or more (${info.smooth.w} x ${info.smooth.h})`);
    t.eq(await looks(), 'off/off/off', 'all three start off');
    await page.screenshot({ path: `${SHOTS}/rest.png` });

    // --- Smooth: a tap arms one stroke, which smooths like Shift ---
    await stroke(); // a bump to smooth
    const bumped = await verts();
    await stroke(SHIFT);
    const byKey = await verts();
    await undo();
    t.ok(maxDiff(await verts(), bumped) < 1e-6, 'undo puts the surface back');
    await tap('smooth');
    t.eq(await looks(), 'armed/off/off', 'a tap on Smooth arms it');
    await page.screenshot({ path: `${SHOTS}/smooth-armed.png` });
    let r = await stroke();
    const byButton = await verts();
    t.eq(r.mid, smoothIdx, 'the armed stroke runs with the Smooth tool');
    const moveKey = maxDiff(byKey, bumped);
    t.ok(moveKey > 0 && maxDiff(byButton, byKey) <= 0.1 * moveKey, `it smooths as Shift does (${maxDiff(byButton, byKey).toExponential(2)} apart; the stroke moved ${moveKey.toExponential(2)})`);
    t.eq(await looks(), 'off/off/off', 'and the button is off after the stroke');
    t.eq(await toolNow(), clayIdx, 'the brush in hand is back');
    r = await stroke();
    t.eq(r.mid, clayIdx, 'the next stroke is a plain one');

    // --- a long press latches: two strokes in a row smooth; a tap lets go ---
    await longPress('smooth');
    t.eq(await looks(), 'latched/off/off', 'a long press latches Smooth');
    const a = await stroke();
    const b = await stroke();
    t.ok(a.mid === smoothIdx && b.mid === smoothIdx, 'two strokes in a row smooth');
    t.eq(await looks(), 'latched/off/off', 'and it stays latched');
    await tap('smooth');
    t.eq(await looks(), 'off/off/off', 'a tap lets it go');
    r = await stroke();
    t.eq(r.mid, clayIdx, 'and the next stroke is plain');

    // --- Mask: grows where stroked; with Carve it shrinks ---
    t.ok((await masked()) < 1e-6, 'nothing is masked yet');
    await tap('mask');
    t.eq(await looks(), 'off/armed/off', 'a tap on Mask arms it');
    r = await stroke();
    const grown = await masked();
    t.eq(r.mid, maskIdx, 'the armed stroke runs with the Mask tool');
    t.ok(grown > 0.001, `the mask grew where it was stroked (${grown.toFixed(4)})`);
    t.eq(await looks(), 'off/off/off', 'and the button is off after the stroke');
    await longPress('mask');
    await tap('carve');
    t.eq(await looks(), 'off/latched/armed', 'Mask latched, Carve armed');
    await page.screenshot({ path: `${SHOTS}/mask-latched-carve-armed.png` });
    r = await stroke();
    const shrunk = await masked();
    t.ok(r.mid === maskIdx && shrunk < grown, `with Carve on too, the stroke unmasks (${grown.toFixed(4)} to ${shrunk.toFixed(4)})`);
    t.eq(await looks(), 'off/latched/off', 'it spends Carve and leaves Mask latched');
    await tap('mask');

    // --- they exclude each other ---
    await tap('smooth');
    await tap('mask');
    t.eq(await looks(), 'off/armed/off', 'arming Mask lets go of Smooth');
    await longPress('smooth');
    t.eq(await looks(), 'latched/off/off', 'latching Smooth lets go of Mask');
    await longPress('mask');
    t.eq(await looks(), 'off/latched/off', 'latching Mask lets go of Smooth');
    await tap('mask');

    // --- a held key still works, and leaves the buttons as they were ---
    await tap('mask');
    r = await stroke(SHIFT);
    t.eq(r.mid, smoothIdx, 'Shift held, with Mask armed, still smooths');
    t.eq(await looks(), 'off/armed/off', 'and Mask is still armed');
    await tap('mask');
    await tap('smooth');
    r = await stroke(CTRL);
    t.eq(r.mid, maskIdx, 'Ctrl held, with Smooth armed, still masks');
    t.eq(await looks(), 'armed/off/off', 'and Smooth is still armed');
    await tap('smooth');
    await undo();
    await undo();

    // --- a press on a button moves nothing, whoever presses ---
    await restoreCamera(page, home);
    const sum = await meshSum(page);
    const strokes = await strokeCount(page);
    const cam = await camera(page);
    const [sx, sy] = await btn('smooth');
    await page.mouse.click(sx, sy);
    t.eq(await look('smooth'), 'armed', 'a mouse click arms it');
    await dev.pen('mouseMoved', [sx, sy], false);
    await dev.pen('mousePressed', [sx, sy], true);
    await dev.pen('mouseReleased', [sx, sy], false);
    t.eq(await look('smooth'), 'off', 'a Pencil tap lets it go');
    await tap('smooth');
    await tap('smooth');
    await settle(page);
    t.ok(camMoved(cam, await camera(page)) < 1e-6, 'the view did not move');
    t.eq(await meshSum(page), sum, 'no vertex moved');
    t.eq(await strokeCount(page), strokes, 'and no stroke began');

    // --- no build or allocation in the view by arming or latching ---
    const counters = () => page.evaluate(() => window.__bozzetto.renderCounters());
    const grew = (x, y) => Object.fromEntries(Object.keys(x).filter((k) => y[k] !== x[k]).map((k) => [k, y[k] - x[k]]));
    await page.waitForTimeout(1500);
    const c0 = await counters();
    await tap('smooth');
    await tap('mask');
    await longPress('smooth');
    await longPress('mask');
    await tap('mask');
    await page.waitForTimeout(500);
    t.eq(JSON.stringify(grew(c0, await counters())), '{}', 'no build, compile or allocation in the view');

    // --- the Paint workspace: Smooth is Blur, over the Paint tool ---
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    await page.waitForTimeout(300);
    const paint = await page.evaluate(() => {
      const s = document.querySelector('.bz-edge [data-arm="smooth"]');
      const shown = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
      return {
        smooth: shown(s),
        mask: shown(document.querySelector('.bz-edge [data-arm="mask"]')),
        carve: shown(document.querySelector('.bz-edge .sculpt-toolbar__neg')),
        name: s.querySelector('.bz-tip__name')?.textContent,
        tool: window.__sculpt.input.currentToolIndex(),
      };
    });
    t.ok(paint.smooth && paint.mask && !paint.carve, `in Paint: Smooth and Mask show, Carve does not (${JSON.stringify(paint)})`);
    t.eq(paint.name, 'Blur (hold Shift)', 'Smooth is named Blur there');
    const blurIdx = (await stroke(SHIFT)).mid;
    t.ok(blurIdx !== paint.tool, 'Shift over the Paint tool swaps the blur in');
    await tap('smooth');
    r = await stroke();
    t.eq(r.mid, blurIdx, 'the armed stroke blurs the paint');
    t.eq(await look('smooth'), 'off', 'and the button is off after it');
    await page.screenshot({ path: `${SHOTS}/paint-edge.png` });
    await page.keyboard.press('2'); // Erase: Shift does nothing here
    await page.waitForTimeout(150);
    t.eq(await btn('smooth'), null, 'with another Paint tool in hand Smooth is not shown');
    await page.keyboard.press('1');
    await page.waitForTimeout(150);
    t.ok(!!(await btn('smooth')), 'and it is back with the Paint tool');

    // --- Present: neither shows ---
    await page.keyboard.press('Shift+4');
    await page.waitForTimeout(300);
    const present = await page.evaluate(() => {
      const hid = (el) => getComputedStyle(el).visibility === 'hidden' || !!el.closest('.bz-edge') && getComputedStyle(el.closest('.bz-edge')).visibility === 'hidden';
      return { presenting: document.body.classList.contains('presenting'), smooth: hid(document.querySelector('[data-arm="smooth"]')), mask: hid(document.querySelector('[data-arm="mask"]')) };
    });
    t.ok(present.presenting && present.smooth && present.mask, `in Present neither shows (${JSON.stringify(present)})`);
  },
};
