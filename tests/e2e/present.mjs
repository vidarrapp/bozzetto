// Present mode in Sculpt (sculpt/ui/Present.ts): in and out by the hotkey,
// the chip and Esc with the interface put back as it was; the brushes, the
// gizmo and the keys that edit locked while orbit still turns the view;
// the Render panel reachable, and Tab's interplay with it; the turntable,
// stopped by a press or a touch and never recorded; Save image's PNG, at
// twice the window with nothing of the interface in it; a publish and a
// Save to library from Present storing the camera and the look, the viewer
// opening the published model at them, and the thumbnail of the presented
// view; and the iPad's portrait screen, fingers navigating.
import { readFileSync } from 'node:fs';
import {
  camMoved,
  camera,
  chooseFile,
  devices,
  fakeProjects,
  line,
  meshSum,
  openForInput,
  savedToast,
  screenOf,
  settle,
  strokeCount,
} from './smoke.mjs';

/** What is up on screen and in the shell, for before-and-after comparisons. */
const ui = (page) =>
  page.evaluate(() => {
    const shown = (sel) => {
      const el = document.querySelector(sel);
      if (!el || el.closest('[hidden]')) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
    };
    const { scenePanel, modelPanel, sculptPanel, input, gizmo, present } = window.__sculpt;
    const render = document.querySelector('.panel--render');
    return {
      presenting: document.body.classList.contains('presenting') && present.isActive(),
      chrome: document.body.classList.contains('chrome-hidden'),
      open: {
        scene: !scenePanel.isCollapsed(),
        model: !modelPanel.isCollapsed(),
        tool: !sculptPanel.isCollapsed(),
        render: !render.classList.contains('panel--collapsed'),
      },
      shown: {
        toolbar: shown('.sculpt-toolbar__brushes'),
        rail: shown('.sculpt-sliders'),
        stats: shown('.sculpt-stats'),
        scene: shown('.panel--scene .panel__handle'),
        model: shown('.panel--model .panel__handle'),
        tool: shown('.panel--sculpt .panel__handle'),
        render: shown('.panel--render .panel__handle') || shown('.panel--render .panel__header'),
        bar: shown('.present-bar'),
        chip: shown('.present__chip'),
      },
      tool: input.currentToolIndex(),
      selecting: input.isSelecting(),
      gizmo: gizmo.isActive() ? gizmo.getMode() : null,
      maskTint: window.__sculpt.viewer.materials.getSculptMaskTint(),
    };
  });

const show = (o) => JSON.stringify(o);
const same = (a, b) => show(a) === show(b);

/** The PNG's own size, from its IHDR. */
const pngSize = (bytes) => ({ w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) });

/**
 * Pixels of an image (PNG or JPEG bytes) at fractions of its size, as
 * [r, g, b] - decoded in the page, which has the codecs.
 */
const pixelsOf = (page, bytes, at) =>
  page.evaluate(
    async ([b64, points]) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([raw]));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      return points.map(([fx, fy]) => {
        const x = Math.min(bmp.width - 1, Math.max(0, Math.round(fx * (bmp.width - 1))));
        const y = Math.min(bmp.height - 1, Math.max(0, Math.round(fy * (bmp.height - 1))));
        return [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
      });
    },
    [bytes.toString('base64'), at],
  );

/** Mean absolute difference of two images (0..255), both scaled to 64 wide. */
const imageDiff = (page, a, b) =>
  page.evaluate(
    async ([x, y]) => {
      const load = async (b64) => createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
      const [ia, ib] = [await load(x), await load(y)];
      const w = 64;
      const h = Math.max(1, Math.round((ia.height / ia.width) * w));
      const px = (img) => {
        const c = new OffscreenCanvas(w, h);
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const [pa, pb] = [px(ia), px(ib)];
      let sum = 0;
      for (let i = 0; i < pa.length; i += 4) for (let k = 0; k < 3; k++) sum += Math.abs(pa[i + k] - pb[i + k]);
      return sum / ((pa.length / 4) * 3);
    },
    [a.toString('base64'), b.toString('base64')],
  );

/** An image's own size, decoded in the page. */
const imageSize = (page, bytes) =>
  page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));
    return { w: bmp.width, h: bmp.height };
  }, bytes.toString('base64'));

/** Every card picture frame on the gallery page: its box's width over height, and its image's own size. */
const cardShapes = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('#landing-grid .card__thumb')].map((th) => {
      const r = th.getBoundingClientRect();
      const img = th.querySelector('.card__img');
      return {
        project: th.closest('.card')?.dataset.project ?? th.closest('.card')?.className ?? '',
        ratio: r.width / r.height,
        img: img && img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight, fit: getComputedStyle(img).objectFit } : null,
      };
    }),
  );

const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const close3 = (a, b, eps = 1e-4) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= eps * Math.max(1, Math.abs(b[i])));

/** The Render panel's handle or close, as a tap on it would. */
const setRender = (page, open) =>
  page.evaluate((o) => {
    const render = document.querySelector('.panel--render');
    if (render.classList.contains('panel--collapsed') === o) render.querySelector(o ? '.panel__handle' : '.panel__close').click();
  }, open);

const press = async (page, key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(60);
};

/**
 * A stand-in for the publish and the viewer, over the library fake: the
 * frames a publish uploads and the look its update sends are kept, and
 * the public manifest of a published model, with its frame, is served
 * from them as the server would (toManifest), so the viewer can open it.
 */
function publishFake() {
  const fake = fakeProjects();
  const frames = new Map();
  const data = new Map();
  const handle = async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const method = req.method();
    let m;
    if ((m = u.pathname.match(/^\/admin\/api\/projects\/([^/]+)\/frames$/)) && method === 'POST') {
      frames.set(decodeURIComponent(m[1]), req.postDataBuffer());
    } else if ((m = u.pathname.match(/^\/admin\/api\/projects\/([^/]+)$/)) && method === 'PUT') {
      const id = decodeURIComponent(m[1]);
      const patch = JSON.parse(req.postData() ?? '{}');
      const was = data.get(id) ?? { defaults: { frame: 0, playing: true, material: 'lit', lightingPreset: 'three_point' }, camera: { autoFrame: true } };
      data.set(id, {
        ...was,
        ...patch,
        defaults: { ...was.defaults, ...(patch.defaults ?? {}) },
        camera: { ...was.camera, ...(patch.camera ?? {}) },
      });
    } else if ((m = u.pathname.match(/^\/api\/projects\/([^/]+)$/)) && frames.has(decodeURIComponent(m[1]))) {
      const id = decodeURIComponent(m[1]);
      const p = fake.projects.get(id);
      const d = data.get(id) ?? {};
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id,
          title: p?.title ?? id,
          mode: 'model',
          visibility: 'public',
          template: true,
          media: `/media/${id}`,
          updated_at: 1,
          config: { frameCount: 1, fps: 4, ext: 'glb', tiers: ['sd'], frameStartIndex: 0 },
          defaults: d.defaults,
          camera: d.camera,
          lighting: d.lighting ?? null,
          material: d.material ?? null,
          environment: d.environment ?? null,
          ao: d.ao ?? null,
          presentation: d.presentation ?? null,
          frames: [{ index: 0, sd: `/media/${id}/frames/sd/0000.glb?v=1`, hd: null, tris: 0 }],
          stages: [],
        }),
      });
    } else if ((m = u.pathname.match(/^\/media\/([^/]+)\/frames\/sd\/0000\.glb$/)) && frames.has(decodeURIComponent(m[1]))) {
      return route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: frames.get(decodeURIComponent(m[1])) });
    }
    return fake.handle(route);
  };
  return { fake, frames, data, handle };
}

export const suites = {
  async present(page, base, t) {
    await openForInput(page, base);
    await page.addStyleTag({ content: '.panel { transition: none !important; }' });

    // --- in and out, the interface as it was ------------------------------
    // A brush picked, the Scene and Tool panels open, then the Select tool.
    await press(page, '4');
    await page.evaluate(() => {
      window.__sculpt.scenePanel.setCollapsed(false);
      window.__sculpt.sculptPanel.setCollapsed(false);
    });
    await press(page, 'q');
    const before = await ui(page);
    t.ok(before.open.scene && before.open.tool && before.selecting && !before.presenting && before.shown.chip, `set up: Scene and Tool open, the Select tool up, the Present chip in the top row (${show(before)})`);
    const chipNextToCapture = await page.evaluate(() => {
      const chips = [...document.querySelectorAll('.topbar--left .topchip')];
      const i = chips.findIndex((c) => c.classList.contains('present__chip'));
      return { order: chips.map((c) => c.textContent).join(','), after: chips[i - 1]?.classList.contains('capture-window__chip') ?? false };
    });
    t.ok(chipNextToCapture.after, `the Present chip sits beside Capture (${chipNextToCapture.order})`);
    const title = await page.evaluate(() => document.querySelector('.present__chip').title);
    t.ok(/Shift \+ P/.test(title), `its title names the hotkey ("${title}")`);

    await press(page, 'Shift+P');
    let now = await ui(page);
    t.ok(now.presenting && now.shown.bar && now.shown.render && now.shown.chip, `Shift+P presents: the bar and the Render panel's tab up (${show(now.shown)})`);
    t.ok(
      !now.shown.toolbar && !now.shown.rail && !now.shown.stats && !now.shown.scene && !now.shown.model && !now.shown.tool,
      `the toolbar, the brush rail, the stats and the Scene, Model and Tool panels are hidden (${show(now.shown)})`,
    );
    t.ok(!now.selecting && now.gizmo === null && !now.open.scene && !now.open.tool, `the Select tool and the side panels are put away (${show(now)})`);
    const highlighted = await page.evaluate(() => window.__sculpt.viewer.isSculptHighlighted('primary'));
    t.ok(!highlighted, 'and no selection outline is drawn');
    await press(page, 'Shift+P');
    let after = await ui(page);
    t.ok(same(after, before), `Shift+P again puts everything back as it was (${show(after)})`);

    // The chip in, Esc out; then the gizmo, in its mode, comes back too.
    await press(page, 'q');
    await press(page, 'e'); // the rotate gizmo
    const gizmoBefore = await ui(page);
    await page.click('.present__chip');
    now = await ui(page);
    t.ok(now.presenting && now.gizmo === null, `the chip presents too, the gizmo put away (${show(now)})`);
    await press(page, 'Escape');
    after = await ui(page);
    t.ok(same(after, gizmoBefore) && after.gizmo === 'rotate', `Esc leaves, the rotate gizmo back (${show(after)})`);
    await press(page, '3'); // a brush again: Standard clay

    // --- locked: brushes, gizmo and edits; orbit still turns ----------------
    await press(page, 'f');
    await settle(page);
    const [cx, cy] = await screenOf(page, 'Sphere');
    const path = line([cx - 90, cy - 20], [cx + 90, cy + 20]);
    await press(page, 'Shift+P');
    const tool = (await ui(page)).tool;
    let sum = await meshSum(page);
    let strokes = await strokeCount(page);
    let home = await camera(page);
    await page.mouse.move(...path[0]);
    await page.mouse.down();
    for (const p of path.slice(1)) await page.mouse.move(...p, { steps: 2 });
    await page.mouse.up();
    await settle(page);
    t.eq(await meshSum(page), sum, 'presenting, a drag across the model leaves every vertex where it was');
    t.eq(await strokeCount(page), strokes, 'and starts no stroke');
    t.ok(camMoved(home, await camera(page)) > 0.05, `while it orbits the view (moved ${camMoved(home, await camera(page)).toFixed(3)})`);
    for (const k of ['2', 't', 'w', 'q', 'x', 'Control+z', 'Control+d', 'Delete', 'ArrowDown']) await press(page, k);
    now = await ui(page);
    t.ok(now.tool === tool && now.gizmo === null && !now.selecting && now.presenting, `the brush, gizmo, select and edit keys do nothing (${show(now)})`);
    t.eq(await meshSum(page), sum, 'nor does undo, subdivide or delete touch the scene');
    t.eq(await page.evaluate(() => window.__sculpt.session.getMeshes().length), 1, 'the object is still there');
    const zoomFrom = await camera(page);
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(300);
    await settle(page);
    t.ok((await camera(page)).distance < zoomFrom.distance, 'the wheel still zooms');

    // --- the Render panel, and Tab -----------------------------------------
    await setRender(page, true);
    now = await ui(page);
    t.ok(now.open.render && now.shown.render, 'the Render panel opens in Present');
    const plain = await page.evaluate(async () => {
      const mats = window.__sculpt.viewer.materials;
      const sel = [...document.querySelectorAll('.panel--render select')].find((x) => [...x.options].some((o) => o.textContent === 'Plain colour'));
      if (!sel) return null;
      sel.value = 'plain';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const set = mats.getMaterialState().vertexColors;
      sel.value = 'sculpt';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return { set, back: mats.getMaterialState().vertexColors };
    });
    t.ok(plain?.set === false && plain.back === true, `with the material's Sculpt colours / Plain colour switch, which the look takes (${show(plain)})`);
    await press(page, 'Tab');
    now = await ui(page);
    t.ok(!now.open.render && !now.chrome && now.presenting, `Tab first closes the Render panel (${show(now)})`);
    await press(page, 'Tab');
    now = await ui(page);
    t.ok(now.chrome && !now.shown.render && now.shown.bar && now.presenting, `Tab again hides it with the interface, the bar staying (${show(now)})`);
    const chromeBtn = await page.evaluate(() => document.querySelector('.present-bar__chrome').textContent);
    t.eq(chromeBtn, 'Show panels', "the bar's switch offers the panels back");
    await page.click('.present-bar__chrome');
    now = await ui(page);
    t.ok(!now.chrome && now.shown.render && now.presenting, `and brings them back, still presenting (${show(now)})`);
    await press(page, 'Tab');
    await press(page, 'Tab');
    await press(page, 'Escape');
    now = await ui(page);
    t.ok(!now.presenting && !now.chrome && now.shown.toolbar && now.shown.rail, `Esc with the interface hidden leaves Present with the interface as it was (${show(now)})`);
    // Hidden before Present, hidden after.
    await press(page, 'Tab');
    await press(page, 'Tab');
    const hiddenBefore = await ui(page);
    await press(page, 'Shift+P');
    await press(page, 'Shift+P');
    after = await ui(page);
    t.ok(hiddenBefore.chrome && after.chrome && !after.presenting, 'Tab-hidden going in, Tab-hidden coming out');
    await press(page, 'Tab');

    // --- the turntable -----------------------------------------------------
    await press(page, 'Shift+P');
    const frames0 = await page.evaluate(async () => {
      const r = window.__sculpt.recorder;
      r.setAllowed(true);
      r.setEnabled(true);
      // Turning recording on captures the scene as it stands, once its idle
      // slot and the encode come round: wait for that frame, and a moment.
      for (let i = 0; i < 60 && r.frameCount() === 0; i++) await new Promise((ok) => setTimeout(ok, 500));
      await new Promise((ok) => setTimeout(ok, 1500));
      return r.frameCount();
    });
    home = await camera(page);
    await page.click('.present-bar__play');
    t.ok(await page.evaluate(() => window.__sculpt.present.isTurning()), 'the play button starts the turntable');
    await page.waitForTimeout(1500);
    const turned = await camera(page);
    const yOf = (c) => c.position[1] - c.target[1];
    t.ok(camMoved(home, turned) > 0.02 && Math.abs(turned.distance - home.distance) < 1e-3 * home.distance && Math.abs(yOf(turned) - yOf(home)) < 1e-3, `it turns the view about the vertical axis, at the same distance and height (moved ${camMoved(home, turned).toFixed(3)})`);
    await page.evaluate(() => window.__sculpt.present.setSpeed(40));
    t.eq(await page.evaluate(() => document.querySelector('.present-bar__val').textContent), '40°/s', 'the speed slider reads in degrees a second');
    await page.mouse.click(cx + 200, cy + 150);
    t.ok(!(await page.evaluate(() => window.__sculpt.present.isTurning())), 'a press on the view stops it');
    await page.click('.present-bar__play');
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);
    t.ok(!(await page.evaluate(() => window.__sculpt.present.isTurning())), 'and so does the wheel');
    const frames1 = await page.evaluate(async () => {
      await new Promise((ok) => setTimeout(ok, 800));
      return window.__sculpt.recorder.frameCount();
    });
    t.eq(frames1, frames0, 'the turntable records nothing into the timelapse');
    await page.evaluate(() => window.__sculpt.recorder.setEnabled(false));

    // --- Save image ----------------------------------------------------------
    await page.evaluate(() => window.__sculpt.present.setSpeed(12));
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), page.click('.present-bar__save')]);
    const saved = await page.waitForFunction(() => [...document.querySelectorAll('.file-menu__progress')].some((n) => n.dataset.state === 'done' && /^Saved Sculpt\.png$/.test(n.textContent)), null, { timeout: 10_000 }).then(() => true).catch(() => false);
    t.ok(saved, 'Save image says it saved the file');
    const name = download.suggestedFilename();
    const png = readFileSync(await download.path());
    const size = pngSize(png);
    const view = await page.evaluate(() => window.__sculpt.viewer.viewportSize());
    t.eq(name, 'Sculpt.png', 'Save image downloads <title>.png');
    t.ok(png.subarray(1, 4).toString() === 'PNG' && size.w === view.w * 2 && size.h === view.h * 2, `a PNG at twice the window (${size.w}x${size.h} for ${view.w}x${view.h})`);
    const corners = [
      [0.002, 0.002],
      [0.998, 0.002],
      [0.002, 0.998],
      [0.998, 0.998],
    ];
    // Where the top row's chips sit over the view: the first on the left,
    // the last on the right, as fractions of the canvas.
    const chipsAt = await page.evaluate(() => {
      const r = window.__sculpt.viewer.captureCanvas.getBoundingClientRect();
      const at = (el) => {
        const b = el.getBoundingClientRect();
        return [(b.left + b.width / 2 - r.left) / r.width, (b.top + b.height / 2 - r.top) / r.height];
      };
      const shown = [...document.querySelectorAll('.topbar .topchip')].filter((c) => c.getBoundingClientRect().width > 0);
      const left = shown.filter((c) => c.closest('.topbar--left'));
      const right = shown.filter((c) => c.closest('.topbar--right'));
      return [at(left[0]), at(right[right.length - 1] ?? left[left.length - 1])];
    });
    const got = await pixelsOf(page, png, [...corners, [0.5, 0.5], ...chipsAt]);
    const bg = got[0];
    const clean = [...got.slice(0, 4), ...got.slice(5)].every((p) => near(p, bg, 4));
    t.ok(clean, `its corners and the places under the top row's chips are all the backdrop, no interface in them (${show(got)})`);
    t.ok(!near(got[4], got[0], 12), `and the model is in the middle (${show(got[4])})`);
    const live = await page.evaluate(() => ({ w: window.__sculpt.viewer.captureCanvas.width, ratio: window.devicePixelRatio }));
    t.eq(live.w, Math.round(view.w * Math.min(live.ratio, 2)), 'the screen goes back to its own resolution afterwards');
    await press(page, 'Escape');

    // --- publishing from Present -------------------------------------------
    await publishChecks(page, base, t);

    // --- the iPad, upright --------------------------------------------------
    await ipadChecks(page, base, t);
  },
};

async function publishChecks(page, base, t) {
  const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  const { fake, data, frames, handle } = publishFake();
  try {
    await ctx.route(fake.serves, handle);
    const owner = await ctx.newPage();
    const errors = [];
    owner.on('pageerror', (e) => errors.push(String(e)));
    owner.on('dialog', (d) => void d.dismiss());
    await openForInput(owner, base);
    await owner.waitForFunction(() => [...document.querySelectorAll('.gallery-form__fields')].some((f) => !f.hidden), null, { timeout: 30_000 });

    // Outside Present a Save to library is as it was: the file, no look blocks.
    await chooseFile(owner, 'Save to library');
    let end = await savedToast(owner);
    const sceneId = 'scene-test1';
    const plainPut = fake.calls.filter((c) => c.method === 'PUT' && c.path === `/admin/api/projects/${sceneId}`);
    t.ok(end.state === 'done' && plainPut.length === 0, `outside Present, Save to library writes no look blocks (${end.text}; ${plainPut.length} updates)`);

    // Present, a view of its own and a look: the lens, the grade, the backdrop.
    await owner.keyboard.press('Shift+P');
    await owner.evaluate(() => {
      const v = window.__sculpt.viewer;
      v.setFocalLength(85);
      v.setToneMapping('agx');
      v.environment.setBackgroundColor('#224466');
    });
    const [cx, cy] = await screenOf(owner, 'Sphere');
    await owner.mouse.move(cx + 220, cy);
    await owner.mouse.down();
    for (const p of line([cx + 220, cy], [cx + 120, cy - 60]).slice(1)) await owner.mouse.move(...p, { steps: 2 });
    await owner.mouse.up();
    await settle(owner);
    const look = await owner.evaluate(() => window.__sculpt.viewer.getLook());

    // Save to library from Present: the file, then the blocks beside it.
    let mark = fake.calls.length;
    await chooseFile(owner, 'Save to library');
    end = await savedToast(owner);
    const put = fake.calls.slice(mark).find((c) => c.method === 'PUT' && c.path === `/admin/api/projects/${sceneId}`);
    const sent = put ? fake.body(put.body) : null;
    t.ok(
      end.state === 'done' && !!sent && close3(sent.camera?.position ?? [], look.camera.position) && close3(sent.camera?.target ?? [], look.camera.target) && sent.camera.focalLength === 85,
      `from Present, Save to library stores the camera: position, target and lens (${show(sent?.camera)})`,
    );
    t.ok(
      !!sent && sent.defaults?.toneMapping === 'agx' && sent.defaults.material === look.materialMode && same(sent.lighting, look.lighting) && same(sent.environment, look.environment) && same(sent.material, look.material) && same(sent.presentation, look.presentation) && !!sent.ao,
      `and the whole look: lighting, material, environment, AO, stage, mode and grade (${show(sent?.defaults)})`,
    );
    t.eq(sent?.environment?.bgColor ?? sent?.environment?.backgroundColor ?? null, look.environment.bgColor ?? look.environment.backgroundColor ?? null, 'the backdrop among it');

    // Publish model from Present: the camera and the look, and the picture of this view.
    mark = fake.calls.length;
    await owner.evaluate(() => {
      const form = document.querySelector('.sculpt-panel__slot[data-slot="model"] .gallery-form');
      form.querySelector('.gallery-form__input[placeholder="project-id"]').value = 'present-model';
      [...form.querySelectorAll('button')].find((b) => b.textContent === 'Publish model').click();
    });
    await owner
      .waitForFunction(() => /^Saved/.test(document.querySelector('.sculpt-panel__slot[data-slot="model"] .gallery-form__status')?.textContent ?? ''), null, { timeout: 120_000 })
      .catch(() => {});
    const stored = data.get('present-model');
    t.ok(!!frames.get('present-model') && !!stored, 'Publish model from Present uploads the model and its look');
    t.ok(
      !!stored && close3(stored.camera.position, look.camera.position) && close3(stored.camera.target, look.camera.target) && stored.camera.focalLength === 85 && stored.defaults.toneMapping === 'agx',
      `its manifest holds the presented camera and grade (${show(stored?.camera)}; ${stored?.defaults?.toneMapping})`,
    );
    const thumbCall = fake.calls.slice(mark).find((c) => c.method === 'POST' && c.path === '/admin/api/projects/present-model/thumb');
    t.ok(thumbCall?.type === 'image/jpeg' && thumbCall.body.length > 0, `a thumbnail goes up (${thumbCall?.body.length ?? 0} bytes)`);
    if (thumbCall) {
      const dims = await imageSize(owner, thumbCall.body);
      t.ok(dims.w === 800 && dims.h === 1000, `the thumbnail is the gallery's 4:5 portrait, 800x1000 (${dims.w}x${dims.h})`);
    }
    const sceneThumb = [...fake.calls].reverse().find((c) => c.method === 'POST' && c.path === `/admin/api/projects/${sceneId}/thumb`);
    if (sceneThumb) {
      const dims = await imageSize(owner, sceneThumb.body);
      t.ok(dims.w === 800 && dims.h === 1000, `so is Save to library's (${dims.w}x${dims.h})`);
    } else t.ok(false, 'Save to library sends a thumbnail');
    if (thumbCall) {
      const presentedThumb = Buffer.from(await owner.evaluate(async () => {
        const b = await window.__sculpt.viewer.captureThumbnail();
        return [...new Uint8Array(await b.arrayBuffer())];
      }));
      const elsewhere = Buffer.from(await owner.evaluate(async () => {
        const v = window.__sculpt.viewer;
        const s = v.getCameraState();
        const back = s.position.map((p, i) => 2 * s.target[i] - p);
        v.controls.setState([back[0], s.position[1], back[2]], s.target);
        const b = await v.captureThumbnail();
        v.controls.setState(s.position, s.target);
        return [...new Uint8Array(await b.arrayBuffer())];
      }));
      const dSame = await imageDiff(owner, thumbCall.body, presentedThumb);
      const dOther = await imageDiff(owner, thumbCall.body, elsewhere);
      t.ok(dSame < 4 && dOther > dSame * 2, `the thumbnail is of the presented view (differs by ${dSame.toFixed(2)} from it, ${dOther.toFixed(2)} from the other side)`);
    }

    // The viewer opens the published model at the camera and the look.
    const viewer = await ctx.newPage();
    viewer.on('pageerror', (e) => errors.push(`viewer: ${e}`));
    await viewer.goto(`${base}/?tl=present-model`, { waitUntil: 'domcontentloaded' });
    await viewer.waitForFunction(() => !!window.__bozzetto && !document.getElementById('overlay'), null, { timeout: 90_000 });
    const opened = await viewer.evaluate(() => {
      const v = window.__bozzetto;
      return { cam: v.getCameraState(), tone: v.getToneMapping(), env: v.environment.getState(), lighting: v.lighting.serialize() };
    });
    t.ok(
      close3(opened.cam.position, look.camera.position, 1e-3) && close3(opened.cam.target, look.camera.target, 1e-3) && opened.cam.focalLength === 85,
      `the viewer opens at the presented camera (${show(opened.cam.position)} vs ${show(look.camera.position)}, ${opened.cam.focalLength} mm)`,
    );
    t.ok(opened.tone === 'agx' && same(opened.env, look.environment), `under its grade and environment (${opened.tone})`);
    await owner.keyboard.press('Escape');

    // The gallery: every card's picture frame is 4:5, and the pictures fill it.
    await owner.evaluate(() => window.__sculpt.persist.flush());
    await owner.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await owner.waitForSelector('.card[data-project="present-model"] .card__img', { timeout: 30_000 }).catch(() => {});
    await owner.waitForFunction(() => document.querySelector('.card[data-project="present-model"] .card__img')?.naturalWidth > 0, null, { timeout: 15_000 }).catch(() => {});
    const cards = await cardShapes(owner);
    const published = cards.find((c) => c.project === 'present-model');
    t.ok(cards.length > 1 && cards.every((c) => Math.abs(c.ratio - 0.8) < 0.01), `on the desktop every gallery card's picture is 4:5 (${cards.map((c) => c.ratio.toFixed(3)).join(', ')})`);
    t.ok(published?.img?.w === 800 && published.img.h === 1000, `and the presented model's card shows its 800x1000 picture (${show(published?.img)})`);
    t.ok(!errors.length, `no page errors publishing${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await ctx.close();
  }
}

async function ipadChecks(page, base, t) {
  const ctx = await page.context().browser().newContext({ viewport: { width: 744, height: 1133 }, hasTouch: true, serviceWorkers: 'block' });
  try {
    const ipad = await ctx.newPage();
    const errors = [];
    ipad.on('pageerror', (e) => errors.push(String(e)));
    await openForInput(ipad, base);
    await ipad.addStyleTag({ content: '.panel { transition: none !important; }' });
    const dev = await devices(ipad);
    const centre = (sel) =>
      ipad.evaluate((s) => {
        const r = document.querySelector(s).getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      }, sel);
    await dev.tap(await centre('.present__chip'));
    await ipad.waitForTimeout(100);
    t.ok((await ui(ipad)).presenting, 'on an upright iPad a tap on the chip presents');
    await setRender(ipad, true);
    const layout = await ipad.evaluate(() => {
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom };
      };
      return {
        bar: box(document.querySelector('.present-bar')),
        render: box(document.querySelector('.panel--render')),
        chips: [...document.querySelectorAll('.topbar .topchip')].filter((c) => !c.hidden && getComputedStyle(c).display !== 'none').map(box),
        w: innerWidth,
        h: innerHeight,
      };
    });
    const meets = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const inside = (a) => a.l >= 0 && a.t >= 0 && a.r <= layout.w && a.b <= layout.h;
    t.ok(inside(layout.bar) && inside(layout.render), `the bar and the open Render panel fit the 744x1133 screen (${show(layout.bar)})`);
    t.ok(!meets(layout.bar, layout.render) && !layout.chips.some((c) => meets(c, layout.bar) || meets(c, layout.render)), 'and overlap neither each other nor the top row');
    await setRender(ipad, false);

    await ipad.keyboard.press('3');
    const [cx, cy] = await screenOf(ipad, 'Sphere');
    const path = line([cx - 90, cy - 20], [cx + 90, cy + 20]);
    const sum = await meshSum(ipad);
    const strokes = await strokeCount(ipad);
    let home = await camera(ipad);
    await dev.finger(path);
    await settle(ipad);
    t.ok(camMoved(home, await camera(ipad)) > 0.05 && (await meshSum(ipad)) === sum, 'a finger across the model orbits and edits nothing');
    home = await camera(ipad);
    await dev.penDrag(path);
    await settle(ipad);
    t.ok(camMoved(home, await camera(ipad)) > 0.05 && (await meshSum(ipad)) === sum && (await strokeCount(ipad)) === strokes, 'and so does the pen: no stroke in Present');
    home = await camera(ipad);
    await dev.pair(line([cx - 30, cy + 60], [cx - 150, cy + 60], 3), line([cx + 30, cy + 60], [cx + 150, cy + 60], 3));
    await settle(ipad);
    t.ok((await camera(ipad)).distance < home.distance, 'two fingers still zoom');
    await dev.tap(await centre('.present-bar__play'));
    t.ok(await ipad.evaluate(() => window.__sculpt.present.isTurning()), 'a tap on play turns the model');
    await dev.tap([cx + 150, cy + 250]);
    t.ok(!(await ipad.evaluate(() => window.__sculpt.present.isTurning())), 'and a touch on the view stops it');
    await dev.tap(await centre('.present-bar__done'));
    await ipad.waitForTimeout(100);
    const back = await ui(ipad);
    t.ok(!back.presenting && back.shown.toolbar, 'Done leaves Present, the toolbar back');

    // The gallery on the iPad: the In progress card's picture, 4:5 too.
    // Some work to come back to, so the gallery has an In progress card.
    await ipad.evaluate(async () => {
      window.__sculpt.session.addPrimitive('cube');
      window.__sculpt.persist.markDirty();
      await window.__sculpt.persist.flush();
    });
    await ipad.locator('.viewer-back').click();
    await ipad.waitForURL((u) => u.pathname === '/' && !u.search.includes('sculpt'), { timeout: 30_000 }).catch(() => {});
    const found = await ipad.waitForSelector('#landing-grid .card__thumb .card__img', { timeout: 30_000 }).then(() => true).catch(() => false);
    if (!found) {
      const grid = await ipad.evaluate(() => `${location.href}: ${[...document.querySelectorAll('#landing-grid > *')].map((c) => c.className).join(' | ')}`);
      t.ok(false, `the gallery shows the In progress card (${grid})`);
    }
    await ipad.waitForTimeout(500);
    const cards = await cardShapes(ipad);
    const progress = cards.find((c) => c.img);
    t.ok(cards.length > 0 && cards.every((c) => Math.abs(c.ratio - 0.8) < 0.01), `on the iPad every gallery card's picture is 4:5 (${cards.map((c) => c.ratio.toFixed(3)).join(', ')})`);
    t.ok(!!progress && progress.img.w === 800 && progress.img.h === 1000, `and the In progress card's snapshot is the 800x1000 portrait (${show(progress?.img)})`);
    t.ok(!errors.length, `no page errors on the iPad${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await ctx.close();
  }
}

