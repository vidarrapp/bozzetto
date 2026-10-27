// The viewer's and the owner editor's tools (owner report, editing an old
// published model): the hotkey guide opens on H and from a Hotkeys button
// in the Render panel, in the viewer and in the editor's preview; holding
// L and dragging moves the key light there as it does in Sculpt and
// Armature, and orbits nothing; and a project published before real units
// is offered Set scale in the editor, which plays every frame by one
// factor (presentation.scale, lifted onto the floor at 0), marks the
// project `units: 'cm'` and saves both, so the viewer plays it at that
// height for everyone. Tab closes the panels, hides the interface and
// brings it back, and Esc brings it back, in both as in Sculpt. Each gets
// (page, base, t).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromeChecks } from './lib.mjs';

/** The guide is up, and what its head and rows say. */
const guideOf = (page) =>
  page.evaluate(() => {
    const g = document.querySelector('.help-guide');
    return {
      shown: !!g && !g.hidden,
      head: g?.querySelector('.help-guide__head')?.textContent ?? '',
      rows: [...(g?.querySelectorAll('.help-row') ?? [])].map((r) => r.textContent),
    };
  });

/** The key light's angles and the camera, as the viewer holds them. */
const lightAndCamera = (page) =>
  page.evaluate(() => {
    const v = window.__bozzetto;
    const key = v.lighting.state().find((l) => l.id === 'key');
    const cam = v.getCameraState();
    return { az: key.azimuth, el: key.elevation, camera: [...cam.position, ...cam.target].map((x) => x.toFixed(3)).join(',') };
  });

/** Wait for the camera to stop settling after boot. */
async function cameraAtRest(page) {
  let camera = '';
  for (let i = 0; i < 20; i++) {
    const now = (await lightAndCamera(page)).camera;
    if (now === camera) return;
    camera = now;
    await page.waitForTimeout(300);
  }
}

/** A point on bare canvas, in whole pixels. */
const onCanvas = (page, fx = 0.5, fy = 0.55) =>
  page.evaluate(
    ([x, y]) => {
      const c = window.__bozzetto.captureCanvas;
      const r = c.getBoundingClientRect();
      const at = [Math.round(r.left + r.width * x), Math.round(r.top + r.height * y)];
      return { at, canvas: document.elementFromPoint(...at) === c };
    },
    [fx, fy],
  );

/** Press at `from`, drag by [dx, dy], with L held through it or not. */
async function drag(page, from, [dx, dy], withL) {
  await page.mouse.move(...from);
  if (withL) await page.keyboard.down('l');
  await page.mouse.down();
  await page.mouse.move(from[0] + dx, from[1] + dy, { steps: 4 });
  await page.mouse.up();
  if (withL) await page.keyboard.up('l');
}

/** H, the guide's own click, and the Render panel's Hotkeys button, in a booted viewer or editor. */
async function guideChecks(page, t, where) {
  await page.evaluate(() => document.activeElement?.blur?.());
  let g = await guideOf(page);
  t.ok(!g.shown, `${where}: the guide starts closed`);
  await page.keyboard.press('h');
  g = await guideOf(page);
  t.ok(g.shown && /Hotkeys/.test(g.head), `${where}: H opens the hotkey guide ("${g.head}")`);
  t.ok(
    g.rows.some((r) => r.includes('Move the key light')) && g.rows.some((r) => r.includes('Orbit')),
    `${where}: it lists the view's keys and gestures, the light drag among them (${g.rows.length} rows)`,
  );
  await page.keyboard.press('h');
  t.ok(!(await guideOf(page)).shown, `${where}: H again closes it`);
  // The button: the panel opened if it is tucked away, then Hotkeys.
  await page.evaluate(() => {
    const p = document.querySelector('.panel--render');
    if (p?.classList.contains('panel--collapsed')) p.querySelector('.panel__handle')?.click();
  });
  await page.waitForTimeout(200);
  const button = await page.evaluate(() => {
    const b = document.querySelector('.panel--render .panel__hotkeys');
    if (!b) return null;
    b.scrollIntoView();
    return { text: b.textContent, title: b.title, section: b.closest('.section')?.querySelector('h3')?.textContent ?? '' };
  });
  t.ok(button?.text === 'Hotkeys' && button.section === 'Interface' && /\(H\)/.test(button.title), `${where}: the Render panel has a Hotkeys button, under Interface (${JSON.stringify(button)})`);
  await page.click('.panel--render .panel__hotkeys');
  t.ok((await guideOf(page)).shown, `${where}: the button opens the guide`);
  await page.click('.help-guide');
  t.ok(!(await guideOf(page)).shown, `${where}: a click on the guide closes it`);
}

/** Hold L and drag over the view: the key light turns, half a degree a pixel, and the camera stays. */
async function lightChecks(page, t, where) {
  await cameraAtRest(page);
  const spot = await onCanvas(page);
  t.ok(spot.canvas, `${where}: the drags start on bare canvas ${spot.at}`);
  await page.evaluate(() => document.activeElement?.blur?.());
  const start = await lightAndCamera(page);
  const steps = [
    [60, -20],
    [-20, 10],
  ];
  for (const by of steps) await drag(page, spot.at, by, true);
  const held = await lightAndCamera(page);
  const across = steps.reduce((n, [dx]) => n + dx, 0);
  const up = -steps.reduce((n, [, dy]) => n + dy, 0);
  t.ok(
    Math.abs(held.az - (start.az + across * 0.5)) < 1e-6 && Math.abs(held.el - (start.el + up * 0.5)) < 1e-6,
    `${where}: with L held the drags turn the key light by half a degree a pixel (azimuth ${start.az} to ${held.az}, elevation ${start.el} to ${held.el})`,
  );
  t.eq(held.camera, start.camera, `${where}: and none of them orbits`);
  // L let go: the same drag orbits again, and the light stays put.
  await drag(page, spot.at, [60, 0], false);
  await page.waitForTimeout(600);
  const after = await lightAndCamera(page);
  t.ok(after.camera !== held.camera && after.az === held.az && after.el === held.el, `${where}: without L, the drag orbits and leaves the light where it was`);
  return held;
}

/** The demo timelapse's manifest, its frames named root-absolute as an owner manifest names them. */
function demoManifest(id, extra = {}) {
  const raw = JSON.parse(readFileSync(resolve('dist/timelapses/demo/manifest.json'), 'utf8'));
  return {
    ...raw,
    id,
    title: 'Old bust',
    mode: 'timelapse',
    visibility: 'public',
    units: null,
    presentation: null,
    frames: raw.frames.map((f) => ({ ...f, sd: `/timelapses/demo/${f.sd}` })),
    ...extra,
  };
}

/** The subject as played: the world box's height and foot, and the floor. */
const played = (page) =>
  page.evaluate(() => {
    const v = window.__bozzetto;
    const b = v.subjectBox;
    return {
      height: b.max.y - b.min.y,
      foot: b.min.y,
      local: (() => {
        const l = v.frameLocalBounds();
        return l.max.y - l.min.y;
      })(),
      scale: v.getSubjectTransform().scale,
      locked: v.lockedFloor(),
      floor: v.floorHeight(),
      units: v.manifest.units,
    };
  });

export const suites = {
  async viewerKeys(page, base, t) {
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await page.evaluate(() => window.__bozzetto.pause());
    await guideChecks(page, t, 'the viewer');
    // The panel tucked away again, so the drags land on the canvas.
    await page.evaluate(() => {
      const p = document.querySelector('.panel--render');
      if (p && !p.classList.contains('panel--collapsed')) p.querySelector('.panel__close')?.click();
    });
    await page.waitForTimeout(300);
    await lightChecks(page, t, 'the viewer');
    // A window that loses focus with L down lets go of it: no keyup comes.
    const spot = await onCanvas(page);
    await page.mouse.move(...spot.at);
    await page.keyboard.down('l');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const before = await lightAndCamera(page);
    await page.mouse.move(spot.at[0] + 40, spot.at[1], { steps: 4 });
    await page.keyboard.up('l');
    const after = await lightAndCamera(page);
    t.ok(after.az === before.az, `losing the window ends the hold: a move after it turns no light (${before.az} -> ${after.az})`);
    // Tab as in Sculpt (owner decision): close, hide, back, and Esc back;
    // the transport stays.
    await chromeChecks(page, t, 'the viewer', { panels: ['.panel--render'], transport: true });
  },

  async editorTools(page, base, t) {
    const id = 'old-bust';
    let stored = demoManifest(id);
    const puts = [];
    let refuse = false;
    await page.route(
      (url) => url.pathname.startsWith('/admin/api/') || url.pathname === '/api/config',
      async (route) => {
        const req = route.request();
        const path = new URL(req.url()).pathname;
        const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (path === '/api/config') return json(200, { accounts: false });
        if (path === '/admin/api/whoami') return json(200, { email: 'owner@example.com' });
        if (path === `/admin/api/projects/${id}`) {
          if (req.method() === 'GET') return json(200, stored);
          const patch = JSON.parse(req.postData() ?? '{}');
          puts.push(patch);
          if (refuse) return json(500, { error: 'The save failed' });
          stored = { ...stored, ...patch, defaults: { ...stored.defaults, ...(patch.defaults ?? {}) }, camera: { ...stored.camera, ...(patch.camera ?? {}) } };
          return json(200, { id, title: stored.title, mode: stored.mode });
        }
        return json(404, { error: 'Not found' });
      },
    );
    const dialogs = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.accept();
    });
    const openEditor = async () => {
      await page.goto(`${base}/admin/?p=${id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!document.querySelector('.panel--editor') && !!document.querySelector('#reel-mount')?.firstElementChild, null, { timeout: 90_000 });
      // Held on the first frame, which Set scale measures and boot shows.
      await page.evaluate(() => {
        window.__bozzetto.pause();
        window.__bozzetto.jumpTo(0);
      });
      await page.waitForTimeout(500);
    };
    await openEditor();
    const exposed = await page.evaluate(() => !!window.__bozzetto);
    t.ok(exposed, 'the editor preview is reachable as __bozzetto (debug handle)');
    if (!exposed) return;
    await page.evaluate(() => window.__bozzetto.pause());
    await guideChecks(page, t, 'the editor');
    await lightChecks(page, t, 'the editor');
    // Tab as everywhere, over the preview only: the editor's own top row and
    // its sidebar of project settings stay.
    await chromeChecks(page, t, 'the editor', { panels: ['.panel--editor'], keep: ['.editor .topbar', '.editor__sidebar'] });

    // --- Set scale --------------------------------------------------------
    const banner = () =>
      page.evaluate(() => {
        const b = document.querySelector('.scale-banner');
        return { shown: !!b && !b.hidden, words: b?.querySelector('.scale-banner__words')?.textContent ?? '', note: b?.querySelector('.scale-banner__note')?.textContent ?? '' };
      });
    let b = await banner();
    t.ok(b.shown && /project has no real-world scale/.test(b.words), `an unmarked project is offered Set scale in the editor ("${b.words}")`);
    const before = await played(page);
    t.ok(before.locked === null && before.scale === 1 && before.units === null, `it plays on its old scale with the floor following it (${JSON.stringify(before)})`);

    // Not now: hidden for the session, nothing sent.
    const putsBefore = puts.length;
    await page.click('.scale-banner__dismiss');
    t.ok(!(await banner()).shown && puts.length === putsBefore, 'Not now hides the offer and stores nothing on the server');
    await openEditor();
    t.ok(!(await banner()).shown, 'and it stays away for the rest of the session');
    await page.evaluate((pid) => sessionStorage.removeItem(`bz.scale.notnow.${pid}`), id);
    await openEditor();
    b = await banner();
    t.ok(b.shown, 'a new session offers it again');

    // A refusal puts the preview back as it was.
    await page.click('.scale-banner__open');
    b = await banner();
    t.ok(/^Now .+ units tall\.$/.test(b.note), `the form says how tall the model is now, in its own units ("${b.note}")`);
    refuse = true;
    dialogs.length = 0;
    await page.fill('.scale-banner__height', '30');
    await page.click('.scale-banner__apply');
    for (let i = 0; i < 40 && !dialogs.length; i++) await page.waitForTimeout(100);
    let now = await played(page);
    t.ok(
      dialogs[0] === 'Set scale failed: The save failed' && now.scale === 1 && now.units === null && now.locked === null && (await banner()).shown,
      `a refused save says so and puts the preview back (${dialogs.join(' | ')}; ${JSON.stringify(now)})`,
    );
    refuse = false;
    puts.length = 0;
    await page.click('.scale-banner__open');
    await page.fill('.scale-banner__height', '30');
    await page.click('.scale-banner__apply');
    for (let i = 0; i < 40 && !puts.length; i++) await page.waitForTimeout(100);
    await page.waitForTimeout(300);
    now = await played(page);
    const sent = puts[0] ?? {};
    const factor = 30 / before.local;
    t.ok(
      sent.units === 'cm' && Math.abs(sent.presentation?.scale - factor) < 1e-9 && Number.isFinite(sent.presentation?.lift) && sent.presentation?.floorOffset === 0 && !!sent.lighting && !!sent.camera,
      `Apply saves the look with presentation.scale ${factor.toFixed(5)}, its lift, floor offset 0, and units 'cm', in one write (${JSON.stringify({ units: sent.units, presentation: sent.presentation })})`,
    );
    t.ok(Math.abs(now.height - 30) < 1e-4 && Math.abs(now.foot) < 1e-4, `the preview plays it 30 cm tall, standing on 0 (${now.height.toFixed(4)} cm, foot ${now.foot})`);
    t.ok(now.locked === 0 && now.floor === 0 && now.units === 'cm', `on the fixed floor at 0 (${JSON.stringify(now)})`);
    t.ok(!(await banner()).shown, 'and the offer goes');
    // Save look after keeps the scale.
    puts.length = 0;
    await page.click('.panel__actions .btn--primary');
    for (let i = 0; i < 40 && !puts.length; i++) await page.waitForTimeout(100);
    t.ok(Math.abs((puts[0]?.presentation?.scale ?? 0) - factor) < 1e-9, `Save look after it keeps the scale (${puts[0]?.presentation?.scale})`);
    // Reopened: the scale and the marker come back from the project, every frame alike.
    await openEditor();
    now = await played(page);
    t.ok(Math.abs(now.height - 30) < 1e-4 && now.units === 'cm' && now.locked === 0 && !(await banner()).shown, `reopened, the editor plays it at the new size, marked, offering nothing (${JSON.stringify(now)})`);
    await page.evaluate(() => window.__bozzetto.jumpTo(10));
    await page.waitForTimeout(800);
    const later = await page.evaluate(() => {
      const v = window.__bozzetto;
      return { scale: v.getSubjectTransform().scale, frame: v.timeline.frameIndex() };
    });
    t.ok(Math.abs(later.scale - factor) < 1e-12 && later.frame === 10, `another frame plays on the same scale (frame ${later.frame})`);

    // The public viewer: the project's manifest as stored plays at the new height for everyone.
    await page.route('**/timelapses/demo/manifest.json', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), units: stored.units, presentation: stored.presentation, camera: stored.camera } });
    });
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await page.waitForTimeout(250);
    const viewer = await played(page);
    t.ok(
      Math.abs(viewer.height - 30) < 1e-4 && Math.abs(viewer.foot) < 1e-4 && viewer.locked === 0 && viewer.floor === 0,
      `the viewer plays it 30 cm tall on the floor at 0 (${JSON.stringify(viewer)})`,
    );
    await page.unroute('**/timelapses/demo/manifest.json');
  },
};
