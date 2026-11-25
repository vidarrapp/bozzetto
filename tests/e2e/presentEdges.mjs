// What was left over from the design critique of 2026-11-14 (package
// present-edges): Present's readout says what a saved image is, Save image
// has one home (Publish stays the one orange action), the viewer's transport
// keeps clear of an open panel, no grey bands beside Sculpt's tool bar, a
// greyed step of the path says why (on hover, and on a long press for a
// finger), and nothing but the splash shows while Sculpt loads. Strength
// reads in cm for the four brushes that move the surface by a depth, in
// percent for the rest.
//
// presentEdges:      Present's readout and Save image; the bands; the cm/percent split.
// presentEdgesPath:  the path in Armature (a workspace of Sculpt's page): every step goes, a long press shows no reason.
// presentEdgesViewer: the viewer's transport with a panel open.
// presentEdgesSplash: the loading splash with nothing over it.
import { openArmature, openSculpt } from './lib.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/edges';

const ready = (page) => page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });

export const suites = {
  async presentEdges(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openSculpt(page, base, '&nosplash=1');
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });

    // --- the bands: nothing grey beside the tool bar, the view runs to the foot ------------
    const foot = await page.evaluate(() => {
      const bar = document.querySelector('.sculpt-toolbar__brushes').getBoundingClientRect();
      const at = (x, y) => {
        const e = document.elementFromPoint(x, y);
        return e ? `${e.tagName}.${e.className}` : null;
      };
      const h = innerHeight;
      return {
        bar: { l: Math.round(bar.left), r: Math.round(bar.right), b: Math.round(bar.bottom) },
        left: at(bar.left - 40, h - 6),
        right: at(bar.right + 40, h - 6),
        leftEdge: at(bar.left - 8, h - 6),
      };
    });
    t.ok(foot.left?.startsWith('CANVAS') && foot.right?.startsWith('CANVAS') && foot.leftEdge?.startsWith('CANVAS'), `left and right of the tool bar at the foot is the view, no band (${JSON.stringify(foot)})`);
    await page.screenshot({ path: `${SHOTS}/sculpt-toolbar.png` });

    // --- Strength: cm for the four brushes that move the surface by a depth ------------------
    const specs = await page.evaluate(() => {
      const { input } = window.__sculpt;
      const names = { 0: 'Clay', 1: 'Inflate', 2: 'Polish', 3: 'Smooth', 4: 'Flatten', 5: 'Pinch', 6: 'Crease', 9: 'Move', 8: 'Paint', 10: 'Mask', 13: 'Rake' };
      return Object.fromEntries(Object.entries(names).map(([idx, n]) => [n, input.strengthSpec(Number(idx)).cm]));
    });
    const cm = Object.entries(specs).filter(([, v]) => v).map(([n]) => n).sort().join();
    t.eq(cm, 'Clay,Crease,Inflate,Rake', `Strength is a length for Clay, Inflate, Crease and the Rake, and a percent for the rest (${JSON.stringify(specs)})`);

    // --- Present's readout: the image Save image writes, and the lens ----------------------
    await page.evaluate(() => window.__sculpt.present.enter());
    await page.waitForFunction(() => /Image/.test(document.querySelector('.bz-readout')?.textContent ?? ''), null, { timeout: 5000 });
    const ro = await page.evaluate(() => {
      const keys = [...document.querySelectorAll('.bz-readout__item:not([hidden]) .bz-readout__key')].map((k) => k.textContent);
      const val = (c) => document.querySelector(`.bz-readout__${c}`);
      const lens = val('lens');
      return {
        keys,
        image: val('frame')?.textContent,
        lens: lens?.textContent,
        lensFont: lens ? getComputedStyle(lens).fontFamily : '',
        view: window.__sculpt.viewer.viewportSize(),
        mm: window.__sculpt.viewer.getFocalLength(),
        dpr: devicePixelRatio,
      };
    });
    const [iw, ih] = (ro.image ?? '').split(' × ').map(Number);
    t.eq(ro.keys.join(), 'Image,Lens', `the readout says Image and Lens, not Frame (${ro.keys})`);
    t.ok(iw >= ro.view.w && ih >= ro.view.h && Math.abs(iw / ih - ro.view.w / ro.view.h) < 0.01, `Image is the size of the picture, the window at its saving ratio (${ro.image} from ${ro.view.w} × ${ro.view.h})`);
    t.eq(ro.lens, `${Math.round(ro.mm)} mm`, 'Lens is the camera lens in mm');
    await page.evaluate(() => window.__sculpt.viewer.setFocalLength(85));
    await page.waitForFunction(() => document.querySelector('.bz-readout__lens')?.textContent === '85 mm', null, { timeout: 4000 }).catch(() => {});
    t.eq(await page.evaluate(() => document.querySelector('.bz-readout__lens')?.textContent), '85 mm', 'and follows the Camera tab\'s lens live');
    await page.evaluate(() => window.__sculpt.viewer.setFocalLength(50));

    // --- One home for Save image; Publish stays the one orange action --------------------------
    const act = await page.evaluate(() => {
      const shown = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
      const saves = [...document.querySelectorAll('button')].filter((b) => shown(b) && b.textContent.trim() === 'Save image');
      const orange = [...document.querySelectorAll('button, a, .btn')]
        .filter((b) => shown(b) && getComputedStyle(b).backgroundColor === 'rgb(255, 90, 31)')
        .map((b) => `${b.textContent.trim()}|${b.className}`);
      const chip = document.querySelector('.publish-window__chip');
      return {
        saves: saves.length,
        home: saves[0]?.closest('.panel--output') ? 'output' : saves[0]?.className,
        orange,
        inBar: !!document.querySelector('.present-bar .present-bar__save, .present-bar [class*="save"]'),
        publishBg: chip ? getComputedStyle(chip).backgroundColor : null,
      };
    });
    t.ok(act.saves === 1 && act.home === 'output' && !act.inBar, `one Save image, in the Output panel, none in the bar (${JSON.stringify(act)})`);
    // Publish, in the strip, is Present's one orange action where it is offered; Save image is a plain button.
    t.ok(act.orange.every((o) => o.startsWith('Publish')) && act.orange.length <= 1, `nothing but Publish is orange in Present, and Save image is a plain button (${act.orange})`);
    await page.screenshot({ path: `${SHOTS}/present-output.png` });
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), page.click('.panel--output .present-out__save', { timeout: 240_000 })]);
    t.eq(download.suggestedFilename(), 'Sculpt.png', 'Save image still saves the picture');
  },

  async presentEdgesPath(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openArmature(page, base);
    const steps = await page.evaluate(() =>
      [...document.querySelectorAll('.bz-ws__step')].map((b) => ({ id: b.dataset.workspace, dim: b.getAttribute('aria-disabled') === 'true', title: b.title })),
    );
    const by = Object.fromEntries(steps.map((s) => [s.id, s]));
    // Armature is a workspace of the same page as Sculpt: every step is on, and the titles say where each goes.
    t.ok(steps.every((s) => !s.dim), `from Armature all four steps are enabled (${JSON.stringify(steps)})`);
    t.ok(by.present?.title === 'Go to Present' && by.paint?.title === 'Go to Paint', `and Present and Paint say where they go (${JSON.stringify([by.present, by.paint])})`);
    const at = () => page.evaluate(() => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent ?? null);
    // A long press, as a finger or the Pencil holds it: a step that goes shows no reason box.
    const box = await page.evaluate(() => document.querySelector('.bz-ws__step[data-workspace="present"]').getBoundingClientRect().toJSON());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    const why = await page.evaluate(() => !!document.querySelector('.bz-ws__why'));
    t.ok(!why, 'a long press on Present shows no reason box: the step goes');
    await page.screenshot({ path: `${SHOTS}/armature-path-tip.png` });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === 'Present', null, { timeout: 10_000 }).catch(() => {});
    t.eq(await at(), 'Present', 'and the press on it goes to Present');
    await page.keyboard.press('Shift+1');
    await page.waitForFunction(() => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === 'Armature', null, { timeout: 10_000 });
    t.eq(await at(), 'Armature', 'Shift+1 comes back to Armature');
    // A click on the Paint step goes to Paint; Shift+1 comes back.
    await page.evaluate(() => [...document.querySelectorAll('.bz-ws__step')].find((b) => b.dataset.workspace === 'paint')?.click());
    await page.waitForFunction(() => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === 'Paint', null, { timeout: 10_000 });
    t.eq(await at(), 'Paint', 'a click on the Paint step goes to Paint');
    await page.keyboard.press('Shift+1');
    await page.waitForFunction(() => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === 'Armature', null, { timeout: 10_000 });
    t.eq(await at(), 'Armature', 'and Shift+1 comes back to Armature from Paint');
    // A short tap goes to Present and shows no box.
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    t.ok(await page.evaluate(() => !document.querySelector('.bz-ws__why')), 'a tap shows no box');
  },

  async presentEdgesViewer(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await ready(page);
    await page.waitForTimeout(400);
    const box = () =>
      page.evaluate(() => {
        const bar = document.querySelector('.transport--shell').getBoundingClientRect();
        const open = [...document.querySelectorAll('.panel:not(.panel--collapsed)')].filter((p) => p.getClientRects().length > 0);
        const sides = open.map((p) => {
          const r = p.getBoundingClientRect();
          return { name: p.dataset.panel, l: Math.round(r.left), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width) };
        });
        return { bar: { l: Math.round(bar.left), r: Math.round(bar.right), t: Math.round(bar.top), w: Math.round(bar.width) }, sides };
      });
    let s = await box();
    t.ok(s.sides.length === 0 && s.bar.w >= 700, `shut panels: the transport keeps its width (${JSON.stringify(s)})`);
    await page.click('.panel--lighting > .panel__handle');
    await page.waitForTimeout(400);
    s = await box();
    const panel = s.sides[0];
    t.ok(panel && panel.w === 304, `Lighting is open at 304px (${JSON.stringify(s)})`);
    t.ok(panel && s.bar.r <= panel.l && s.bar.l >= 0 && s.bar.w >= 240, `the transport stands clear of the open panel at 1180 (${JSON.stringify(s)})`);
    await page.screenshot({ path: `${SHOTS}/viewer-transport-panel.png` });
    await page.click('.panel--lighting > .panel__handle');
    await page.waitForTimeout(300);
    s = await box();
    t.ok(s.bar.w >= 700, `shut again: the transport has its width back (${s.bar.w})`);
  },

  async presentEdgesSplash(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    // Hold the splash: the clip never plays and its 4 second cap is a minute, so the
    // overlay stays up for as long as the shell takes to build, and a tap on it ends it.
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = () => new Promise(() => {});
      // Nor does a clip that cannot be decoded here end it: ended and error are not heard.
      const listen = HTMLMediaElement.prototype.addEventListener;
      HTMLMediaElement.prototype.addEventListener = function (type, ...rest) {
        if (type === 'ended' || type === 'error') return undefined;
        return listen.call(this, type, ...rest);
      };
      const set = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...rest) => set(fn, ms === 4000 ? 60000 : ms, ...rest);
    });
    await page.goto(`${base}/?sculpt=1&start=sphere`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt && !!document.querySelector('.bz-strip') && !!document.querySelector('.sculpt-toolbar__brushes'), null, { timeout: 90_000 });
    await page.waitForTimeout(600);
    const over = await page.evaluate(() => {
      const overlay = document.getElementById('overlay');
      if (!overlay) return { overlay: false };
      const covered = [];
      const open = [];
      // Every piece of the interface that has a box: what is on top at its centre must be the overlay.
      for (const e of document.querySelectorAll('.bz-strip, .bz-strip *, .panel > .panel__handle, .bz-edge, .sculpt-toolbar__brushes, .topbar *, .help-toggle, .viewer-back')) {
        const r = e.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || getComputedStyle(e).visibility === 'hidden') continue;
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        if (top && !overlay.contains(top)) open.push(`${e.tagName}.${e.className}`.slice(0, 60));
        else covered.push(1);
      }
      return { overlay: true, splash: overlay.classList.contains('overlay--splash'), seen: open.slice(0, 8), covered: covered.length };
    });
    t.ok(over.overlay && over.splash, `the splash is up while the shell is built (${JSON.stringify(over)})`);
    t.ok(over.overlay && over.covered > 5 && over.seen.length === 0, `nothing of the interface shows over it: no Gallery, no ?, no Render tab (${JSON.stringify(over)})`);
    await page.screenshot({ path: `${SHOTS}/splash-mid-load.png` });
    // A tap skips it, and the shell is there.
    await page.mouse.click(600, 400);
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 15_000 });
    t.ok(await page.evaluate(() => !!document.querySelector('.bz-strip') && document.body.classList.contains('bz-shell')), 'after it, the interface is there');
  },
};
