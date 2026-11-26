// The proportion guide (docs/plans/reference-and-measure.md, "Proportion guide"): a ruler in heads.
//
// proportionGuide:
// - on a 180 cm base-mesh figure with a 22.5 cm head it reads 180 cm and 8 heads, with 8 ticks;
// - typing the head height and picking it with two taps agree;
// - each canon's faint target line is at the head height times its count (Custom too);
// - the landmarks show their labels on a tap, the one tapped is picked;
// - the guide turns with the view and stays beside the subject;
// - Tab hides it, and it is in no capture;
// - a reload keeps it (on, head height, canon, landmarks);
// - a scene without real units shows the Set scale line and no guide;
// - the mannequin as subject: with its row selected or alone in the scene, in Sculpt and Armature,
//   From the head fills the head height, and a pose moves the guide's height.
import { mkdirSync } from 'node:fs';
import { devices, openForInput, openPanel } from './smoke.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/propguide';
const frames = (page) => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
const click = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const guideState = (page) => page.evaluate(() => ({ on: window.__sculpt.session.guide.on, head: window.__sculpt.session.guide.head, canon: window.__sculpt.session.guide.canon, landmarks: window.__sculpt.session.guide.landmarks, heads: window.__sculpt.session.guide.customHeads }));
/** The guide's labels as drawn, read after the view has drawn again. */
const drawn = async (page) => {
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r));
  });
  return page.evaluate(() => ({
    value: document.querySelector('[data-role=guide-value]')?.textContent ?? null,
    heads: document.querySelector('[data-role=guide-heads]')?.textContent ?? null,
    ticks: [...document.querySelectorAll('[data-role=guide-tick]')].map((e) => e.textContent),
    canon: document.querySelector('[data-role=guide-canon]')?.dataset.cm ?? null,
    canonText: document.querySelector('[data-role=guide-canon]')?.textContent ?? null,
    landmarks: [...document.querySelectorAll('[data-role=guide-landmark]')].map((e) => ({ id: e.dataset.id, cm: e.dataset.cm, on: e.classList.contains('guide-pick--on') })),
    at: document.querySelector('[data-role=guide-root]')?.dataset.at ?? null,
  }));
};
const setRange = (page, sel, v) =>
  page.evaluate(
    ([s, val]) => {
      const input = document.querySelector(s);
      input.value = String(val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [sel, v],
  );
const setSelect = (page, sel, v) =>
  page.evaluate(
    ([s, val]) => {
      const el = document.querySelector(s);
      el.value = val;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [sel, v],
  );
const worldBox = (page) =>
  page.evaluate(() => {
    const { session, worldBox: box } = window.__sculpt;
    return box(session.getMesh());
  });
/** The mean colour of the viewer's pixels in a square at a page point. */
const patch = (page, [x, y]) =>
  page.evaluate(
    async ([px, py]) => {
      await window.__bozzetto.whenFramesDrawn(2);
      const src = window.__bozzetto.captureCanvas;
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(src, 0, 0);
      const r = src.getBoundingClientRect();
      const k = src.width / r.width;
      const d = ctx.getImageData(Math.round((px - r.left) * k) - 12, Math.round((py - r.top) * k) - 40, 24, 80).data;
      const sum = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let j = 0; j < 3; j++) sum[j] += d[i + j];
      return sum.map((v) => Math.round(v / (d.length / 4)));
    },
    [x, y],
  );

export const suites = {
  async proportionGuide(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    const dev = await devices(page);

    // --- the figure: a base mesh at 180 cm --------------------------------------------------------
    await page.evaluate(async () => {
      const { session, setScale } = window.__sculpt;
      for (const m of [...session.getMeshes()]) session.deleteMesh(m);
      const body = await session.addBaseMesh('body-female-stylized');
      const figure = session.getMeshes().find((m) => /body/i.test(session.getMeshName(m))) ?? body;
      session.selectSet([figure]);
      setScale(figure, 180);
    });
    await page.waitForTimeout(500);
    const box = await worldBox(page);
    t.ok(Math.abs(box.max[1] - box.min[1] - 180) < 0.2, `the figure stands 180 cm tall (${(box.max[1] - box.min[1]).toFixed(2)})`);
    await openPanel(page, 'Model');
    t.ok(!(await page.evaluate(() => document.querySelector('[data-role=guide-value]'))), 'with the guide off nothing is drawn');
    const section = await page.evaluate(() => {
      const s = document.querySelector('.panel--model [data-role=measure]');
      return { has: !!s, switchOn: s?.querySelector('[data-role=guide-switch] input')?.checked, canon: [...(s?.querySelectorAll('[data-role=guide-canon-select] option') ?? [])].map((o) => o.textContent) };
    });
    t.ok(section.has && section.switchOn === false && section.canon.join('|') === '7½ heads|8 heads|8½ heads|Custom', `the Measure section has the guide's switch and the four canons (${JSON.stringify(section)})`);

    // --- on, a head height typed ------------------------------------------------------------------------
    await click(page, '[data-role=guide-switch] input');
    await setRange(page, '[data-role=guide-head] input[type=range]', 22.5);
    let d = await drawn(page);
    t.ok(d.value === '180 cm' && d.heads === '8 heads' && d.ticks.length === 8 && d.ticks.join() === '1,2,3,4,5,6,7,8', `it reads 180 cm and 8 heads with 8 ticks (${JSON.stringify([d.value, d.heads, d.ticks.length])})`);
    const typed = await guideState(page);
    t.ok(typed.on && typed.head === 22.5, `the typed head height is kept (${JSON.stringify(typed)})`);

    // --- picked with two taps agrees --------------------------------------------------------------------
    await page.evaluate(() => window.__sculpt.session.guide.setHead(0));
    d = await drawn(page);
    t.ok(d.ticks.length === 0 && d.heads === '', 'with no head height there are no ticks');
    await click(page, '[data-role=guide-pick]');
    await frames(page);
    const prompt1 = await text(page, '[data-role=measure-reading]');
    t.ok(await page.evaluate(() => window.__sculpt.input.isMeasuring() && !!window.__sculpt.session.guide.picking), `Pick head takes the pen for two taps (${prompt1})`);
    const headTop = await page.evaluate(([x, y, z]) => window.__armature?.onScreen?.(x, y, z) ?? null, [0, 0, 0]);
    void headTop;
    // Two taps on the head, one above the other.
    const spots = await page.evaluate(() => {
      const { session, viewer } = window.__sculpt;
      viewer.camera.updateMatrixWorld();
      const b = window.__sculpt.worldBox(session.getMesh());
      const cx = (b.min[0] + b.max[0]) / 2;
      const cz = (b.min[2] + b.max[2]) / 2;
      const r = viewer.captureCanvas.getBoundingClientRect();
      const pr = session.getPixelRatio();
      const at = (y) => {
        const [x, py] = session.getCamera().project([cx, y, cz]);
        return [r.left + x / pr, r.top + py / pr];
      };
      return [at(b.max[1] - 6), at(b.max[1] - 26)];
    });
    const surf = (p) =>
      page.evaluate(
        ([px, py]) => {
          const { session, viewer } = window.__sculpt;
          viewer.camera.updateMatrixWorld();
          const r = viewer.captureCanvas.getBoundingClientRect();
          const pr = session.getPixelRatio();
          return session.surfacePointAt((px - r.left) * pr, (py - r.top) * pr);
        },
        p,
      );
    const s0 = await surf(spots[0]);
    const s1 = await surf(spots[1]);
    await dev.penDrag([spots[0]]);
    await frames(page);
    const mid = await text(page, '[data-role=measure-reading]');
    await dev.penDrag([spots[1]]);
    await frames(page);
    const got = await guideState(page);
    const wanted = Math.abs(s0[1] - s1[1]);
    t.ok(/chin/i.test(mid ?? ''), `after the crown it asks for the chin (${mid})`);
    t.ok(s0 && s1 && Math.abs(got.head - wanted) < 0.1, `the picked head height is the height between the taps (${got.head} cm, ${wanted.toFixed(2)} between the surface points)`);
    t.ok(!(await page.evaluate(() => window.__sculpt.input.isMeasuring())), 'and the pen is the sculptor\'s again');
    // The same value typed and picked gives the same guide.
    await page.evaluate(() => window.__sculpt.session.guide.setHead(0));
    await page.evaluate(() => {
      const g = window.__sculpt.session.guide;
      g.beginPick();
      g.pickPoint([0, 150, 0]);
      g.pickPoint([0, 127.5, 0]);
    });
    const pickedState = await guideState(page);
    const pickedDrawn = await drawn(page);
    await setRange(page, '[data-role=guide-head] input[type=range]', 22.5);
    const typedDrawn = await drawn(page);
    t.ok(pickedState.head === 22.5 && pickedDrawn.heads === typedDrawn.heads && pickedDrawn.ticks.length === typedDrawn.ticks.length, 'a head height picked and the same one typed draw the same guide');

    // --- canons ------------------------------------------------------------------------------------------
    for (const [id, count] of [['7.5', 7.5], ['8', 8], ['8.5', 8.5]]) {
      await setSelect(page, '[data-role=guide-canon-select]', id);
      d = await drawn(page);
      t.ok(d.canon !== null && Math.abs(Number(d.canon) - 22.5 * count) < 0.01, `the ${count} head canon's target line is at the head height times ${count} (${d.canon} cm)`);
    }
    await setSelect(page, '[data-role=guide-canon-select]', 'custom');
    await setRange(page, '[data-role=guide-heads] input[type=range]', 9);
    d = await drawn(page);
    t.ok(d.canon !== null && Math.abs(Number(d.canon) - 202.5) < 0.01, `Custom with 9 heads puts it at 202.5 cm (${d.canon})`);
    await setSelect(page, '[data-role=guide-canon-select]', '8');

    // --- landmarks -----------------------------------------------------------------------------------------
    t.ok((await drawn(page)).landmarks.length === 0, 'the landmark ticks are off at first');
    await click(page, '[data-role=guide-landmarks] input');
    d = await drawn(page);
    t.ok(d.landmarks.map((l) => l.id).join() === 'chin,nipples,navel,crotch,knees', `the landmarks of the canon are chin, nipples, navel, crotch and knees (${d.landmarks.map((l) => l.id)})`);
    const navel = d.landmarks.find((l) => l.id === 'navel');
    t.ok(Math.abs(Number(navel.cm) - (180 - 3 * 22.5)) < 0.01, `the navel is three heads down from the top (${navel.cm} cm)`);
    const labelShown = () =>
      page.evaluate(() => [...document.querySelectorAll('[data-role=guide-landmark]')].map((b) => { const l = b.querySelector('.guide-landmark__label'); const cs = getComputedStyle(l); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.5 ? l.textContent : ''; }).filter(Boolean));
    t.ok((await labelShown()).length === 0, 'their labels are not shown until asked for');
    const hit = await page.evaluate(() => {
      const b = document.querySelector('[data-role=guide-landmark][data-id=navel]').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height };
    });
    t.ok(hit.w >= 44 && hit.h >= 44, `a landmark can be hit with a finger (${hit.w}x${hit.h})`);
    await dev.tap([hit.x, hit.y]);
    await frames(page);
    d = await drawn(page);
    t.ok((await labelShown()).join() === 'Navel' && d.landmarks.find((l) => l.id === 'navel').on, 'a tap on a landmark shows its label and picks it');
    await dev.tap([hit.x, hit.y]);
    await frames(page);
    t.ok((await labelShown()).length === 0, 'a second tap lets go');
    await page.mouse.move(hit.x, hit.y);
    await frames(page);
    t.ok((await labelShown()).join() === 'Navel', 'a mouse over a landmark shows its label');
    await page.mouse.move(hit.x + 160, hit.y + 40);
    await frames(page);
    t.ok((await labelShown()).length === 0, 'and moving off hides it again');
    await dev.tap([hit.x, hit.y]);
    await frames(page);
    await page.screenshot({ path: `${SHOTS}/figure-8-heads.png` });
    await page.evaluate(() => {
      const s = document.querySelector('.panel--model [data-role=measure]');
      let p = s.parentElement;
      while (p && !(p.scrollHeight > p.clientHeight && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
      if (p) p.scrollTop += s.getBoundingClientRect().top - p.getBoundingClientRect().top - 8;
    });
    await frames(page);
    await page.screenshot({ path: `${SHOTS}/measure-section.png` });
    await page.evaluate(() => window.__sculpt.session.guide.select(null));

    // --- turns with the view, beside the subject ----------------------------------------------------------
    const where = (s) => s.split(',').map(Number);
    const beside = async () => {
      const dd = await drawn(page);
      const [gx, gz] = where(dd.at);
      const b = await worldBox(page);
      const dx = Math.max(b.min[0] - gx, 0, gx - b.max[0]);
      const dz = Math.max(b.min[2] - gz, 0, gz - b.max[2]);
      return { at: dd.at, gx, gz, out: Math.hypot(dx, dz) };
    };
    const w0 = await beside();
    t.ok(w0.out > 3 && w0.out < 60, `the guide stands beside the figure, clear of its box (${w0.out.toFixed(1)} cm)`);
    const orbit = await page.evaluate(() => {
      const r = window.__sculpt.viewer.captureCanvas.getBoundingClientRect();
      return [r.left + r.width - 90, r.top + 260];
    });
    await page.mouse.move(orbit[0], orbit[1]);
    await page.mouse.down();
    await page.mouse.move(orbit[0] + 260, orbit[1] - 10, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    const w1 = await beside();
    t.ok(w1.at !== w0.at && w1.out > 3 && w1.out < 60, `turning the view moves the guide round the figure and it stays beside it (${w0.at} to ${w1.at}, ${w1.out.toFixed(1)} cm clear)`);

    // --- Tab, and no capture ------------------------------------------------------------------------------
    const lineAt = await page.evaluate(() => {
      const t = document.querySelector('[data-role=guide-tick][data-n="4"]').getBoundingClientRect();
      return [t.left + t.width + 6, t.top];
    });
    const withGuide = await patch(page, lineAt);
    await page.evaluate(() => window.__sculpt.session.guide.setOn(false));
    await frames(page);
    const without = await patch(page, lineAt);
    await page.evaluate(() => window.__sculpt.session.guide.setOn(true));
    await frames(page);
    t.ok(Math.abs(withGuide[0] - without[0]) + Math.abs(withGuide[1] - without[1]) + Math.abs(withGuide[2] - without[2]) < 4, `the viewer's own pixels hold nothing of the guide, as a capture reads them (${withGuide} and ${without})`);
    await page.evaluate(() => document.activeElement?.blur?.());
    for (let i = 0; i < 3 && !(await page.evaluate(() => document.body.classList.contains('chrome-hidden'))); i++) {
      await page.keyboard.press('Tab');
      await frames(page);
    }
    t.ok(await page.evaluate(() => getComputedStyle(document.querySelector('.measure-overlay')).display === 'none'), 'Tab hides the guide with the rest of the interface');
    await page.keyboard.press('Tab');
    await frames(page);
    t.ok(await page.evaluate(() => getComputedStyle(document.querySelector('.measure-overlay')).display !== 'none'), 'and Tab brings it back');

    // --- kept with the scene --------------------------------------------------------------------------------
    await setSelect(page, '[data-role=guide-canon-select]', '8.5');
    await page.evaluate(() => window.__sculpt.persist.markDirty());
    await page.evaluate(() => window.__sculpt.persist.flush());
    const filed = await page.evaluate(async () => {
      const { file } = window.__sculpt;
      const rec = await file.unpack(await file.pack());
      return rec.guide ?? null;
    });
    t.ok(filed && filed.on === true && filed.head === 22.5 && filed.canon === '8.5' && filed.landmarks === true, `a .bozz keeps it (${JSON.stringify(filed)})`);
    await page.goto(`${base}/?sculpt=1&q=low&start=sphere`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await page.waitForTimeout(500);
    const back = await guideState(page);
    t.ok(back.on && back.head === 22.5 && back.canon === '8.5' && back.landmarks, `a reload keeps it: on, head height, canon, landmarks (${JSON.stringify(back)})`);
    d = await drawn(page);
    t.ok(d.heads === '8 heads' && d.landmarks.length === 5, 'and draws it again');

    // --- a scene without real units ------------------------------------------------------------------------------
    await page.evaluate(() => window.__sculpt.session.setUnits(null));
    await openPanel(page, 'Model');
    await frames(page);
    t.ok((await text(page, '[data-role=measure-list] [data-role=measure-needs-scale]')) === "Set the scene's scale first", 'a scene without real units says to set its scale first');
    t.ok(!(await page.evaluate(() => !!document.querySelector('[data-role=guide-value]'))), 'and draws no guide');
    t.ok(await page.evaluate(() => !!document.querySelector('.panel--model [data-role=measure] [data-role=measure-set-scale]')), 'with a Set scale button');
    await page.evaluate(() => window.__sculpt.session.setUnits('cm'));
    await frames(page);

    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },

  async proportionGuideMannequin(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    const waitHere = (name) => page.waitForFunction((n) => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === n, name, { timeout: 20_000 });
    const goArmature = async () => {
      await page.keyboard.press('Shift+1');
      await waitHere('Armature');
      await page.waitForFunction(() => !!window.__armature && !window.__armature.isSuspended() && !document.querySelector('.sculpt-toast[data-state="running"]'), null, { timeout: 60_000 });
      await page.waitForTimeout(200);
    };
    const goSculpt = async () => {
      await page.keyboard.press('Shift+2');
      await waitHere('Sculpt');
      await page.waitForTimeout(200);
    };
    await goArmature();
    await page.waitForTimeout(400);
    await goSculpt();
    // The sphere and the mannequin: the subject is the active object.
    await openPanel(page, 'Model');
    await page.evaluate(() => window.__sculpt.session.guide.setOn(true));
    let d = await drawn(page);
    const sphereBox = await worldBox(page);
    t.ok(d.value === `${Math.round((sphereBox.max[1] - sphereBox.min[1]) * 10) / 10} cm`.replace('.0 cm', ' cm'), `with an object active the guide is beside it (${d.value})`);
    const fromHeadShown = () => page.evaluate(() => { const e = document.querySelector('[data-role=guide-from-head]'); return !!e && !e.hidden; });
    t.ok(!(await fromHeadShown()), 'From the head is the mannequin\'s alone');
    // Its row selected: the mannequin is the subject.
    await openPanel(page, 'Scene');
    await page.click('.panel--scene [data-role="armature-row"] .outliner__name');
    await page.waitForTimeout(300);
    await openPanel(page, 'Model');
    d = await drawn(page);
    const manHeight = await page.evaluate(() => {
      const b = window.__armature.armature.bounds();
      return b.max.y - b.min.y;
    });
    t.ok(d.value !== null && Math.abs(parseFloat(d.value) - manHeight) < 0.2, `with its row selected the guide is the mannequin's height (${d.value}; its box ${manHeight.toFixed(1)} cm)`);
    t.ok(await fromHeadShown(), 'and the section offers From the head');
    await click(page, '[data-role=guide-from-head]');
    d = await drawn(page);
    const head = (await guideState(page)).head;
    t.ok(head > 12 && head < 30, `From the head fills the head height from the mannequin's own head part (${head} cm)`);
    t.ok(d.heads !== '' && parseFloat(d.heads) > 6.5 && parseFloat(d.heads) < 9.5, `and it reads in heads (${d.heads})`);
    // Alone in the scene: the mannequin without its row being tapped.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      for (const m of [...session.getMeshes()]) session.deleteMesh(m);
    });
    await page.waitForTimeout(400);
    d = await drawn(page);
    t.ok(d.value !== null && Math.abs(parseFloat(d.value) - manHeight) < 0.2, `alone in the scene it is the subject too (${d.value})`);
    // A pose changes the height, and the guide follows.
    await goArmature();
    await page.evaluate(() => window.__armature.turn('spine', 35, 0, 0));
    await page.evaluate(() => window.__armature.turn('chest', 25, 0, 0));
    await page.waitForTimeout(500);
    d = await drawn(page);
    const posed = await page.evaluate(() => {
      const b = window.__armature.armature.bounds();
      return b.max.y - b.min.y;
    });
    t.ok(posed < manHeight - 1 && Math.abs(parseFloat(d.value) - posed) < 0.2, `in Armature the guide is drawn, and follows a pose (${manHeight.toFixed(1)} to ${posed.toFixed(1)} cm; reads ${d.value})`);
    await page.evaluate(() => window.__armature.turn('spine', 0, 0, 0));
    await page.evaluate(() => window.__armature.turn('chest', 0, 0, 0));
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOTS}/mannequin-armature.png` });
    await goSculpt();
    t.ok(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  },
};
