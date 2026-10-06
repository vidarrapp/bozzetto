// The owner's tweaks batch. A published sculpt shows its own colours or,
// picked in the Render panel, one plain colour that the albedo sets, and
// the choice rides the look, a project's manifest and the single-file
// export, while Sculpt mode always shows its paint. The background's and
// every light's swatch picks a colour off the view when dragged onto it,
// as the paint brush's does, in Sculpt, Armature and the editors' preview:
// live while dragged, cancelled by a release off the view. The colour
// picker is twice the size, opens beside its panel on an upright iPad,
// and has no H row; its S and V rows take typed values. The remesh
// resolution's voxel grid is drawn over the view while its slider is held,
// in Sculpt and Armature, up to 512, and a remesh this device cannot
// spare the memory for is refused with the reason (navigator.deviceMemory,
// overridden here) instead of ending the tab.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openArmature, openSculpt } from './lib.mjs';
import { keyLight, openForInput, openPanel, sliderRow, typeValue } from './smoke.mjs';

/**
 * A minimal .glb: float positions, an optional COLOR_0 (linear floats; the
 * app's own exports pack it into normalised bytes, which the loader hands
 * back the same way) and 16-bit indices.
 */
function glb(positions, indices, colors) {
  const pad = (b, fill = 0) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const p = pad(Buffer.from(new Float32Array(positions).buffer));
  const c = colors ? pad(Buffer.from(new Float32Array(colors).buffer)) : Buffer.alloc(0);
  const i = pad(Buffer.from(new Uint16Array(indices).buffer));
  const count = positions.length / 3;
  const axis = (k) => positions.filter((_, j) => j % 3 === k);
  const views = [{ buffer: 0, byteOffset: 0, byteLength: p.length, target: 34962 }];
  const accessors = [
    {
      bufferView: 0,
      componentType: 5126,
      count,
      type: 'VEC3',
      min: [0, 1, 2].map((k) => Math.min(...axis(k))),
      max: [0, 1, 2].map((k) => Math.max(...axis(k))),
    },
  ];
  const attributes = { POSITION: 0 };
  if (colors) {
    views.push({ buffer: 0, byteOffset: p.length, byteLength: c.length, target: 34962 });
    accessors.push({ bufferView: 1, componentType: 5126, count, type: 'VEC3' });
    attributes.COLOR_0 = 1;
  }
  views.push({ buffer: 0, byteOffset: p.length + c.length, byteLength: indices.length * 2, target: 34963 });
  accessors.push({ bufferView: views.length - 1, componentType: 5123, count: indices.length, type: 'SCALAR' });
  const bin = Buffer.concat([p, c, i]);
  const json = pad(
    Buffer.from(
      JSON.stringify({
        asset: { version: '2.0' },
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes, indices: accessors.length - 1, mode: 4 }] }],
        accessors,
        bufferViews: views,
        buffers: [{ byteLength: bin.length }],
      }),
    ),
    0x20,
  );
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const chunk = (len, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(len, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  return Buffer.concat([head, chunk(json.length, 0x4e4f534a), json, chunk(bin.length, 0x004e4942), bin]);
}

/** A unit cube, four corners a face so each face shades flat; painted `rgb` (linear) when given. */
function cube(rgb) {
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const pos = [];
  const col = [];
  const idx = [];
  for (const [n, u, v] of faces) {
    const at = pos.length / 3;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) pos.push(0.5 * (n[k] + su * u[k] + sv * v[k]));
      if (rgb) col.push(...rgb);
    }
    idx.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  return glb(pos, idx, rgb ? col : undefined);
}

/** The viewer at ?tl=demo, its manifest replaced by a one-frame model project of `frame`, with `material` saved. */
async function viewModel(page, base, frame, material) {
  await page.unroute('**/timelapses/demo/manifest.json');
  await page.unroute(/painted\.glb/);
  await page.route('**/timelapses/demo/manifest.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'demo',
        title: 'Painted',
        mode: 'model',
        config: { frameCount: 1, fps: 4, ext: 'glb', tiers: ['sd'], frameStartIndex: 0 },
        defaults: { frame: 0, playing: false, material: 'lit', lightingPreset: 'three_point' },
        camera: { autoFrame: true },
        frames: [{ index: 0, sd: 'frames/sd/painted.glb', hd: null, tris: 12 }],
        ...(material ? { material } : {}),
      }),
    }),
  );
  await page.route(/painted\.glb/, (route) => route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: frame }));
  await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
  await page.waitForTimeout(250);
}

/** The Render panel's material choices: the Colour switch, if offered, and whether an Albedo row is. */
const materialRows = (page) =>
  page.evaluate(() => {
    const opts = document.querySelector('.panel .mat-options');
    const row = (name) => [...(opts?.querySelectorAll('label.label-row') ?? [])].find((l) => l.firstElementChild?.textContent === name);
    const sel = row('Colour')?.querySelector('select');
    return {
      colour: sel ? sel.value : null,
      options: sel ? [...sel.options].map((o) => o.textContent).join(' / ') : null,
      albedo: !!row('Albedo'),
    };
  });

const pickColour = (page, value) =>
  page.evaluate((v) => {
    const opts = document.querySelector('.panel .mat-options');
    const sel = [...opts.querySelectorAll('label.label-row')].find((l) => l.firstElementChild?.textContent === 'Colour').querySelector('select');
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);

/** The colour at the middle of the view, as the frame shows it: [r, g, b]. */
const middle = (page) =>
  page.evaluate(async () => {
    const v = window.__bozzetto;
    const r = v.renderer.domElement.getBoundingClientRect();
    const hex = await v.samplePixel(r.left + r.width / 2, r.top + r.height / 2);
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });

const reddish = ([r, g, b]) => r > 60 && r > g * 2 && r > b * 2;
const bluish = ([r, g, b]) => b > 60 && b > r * 1.5 && b > g;

/** A colour row in a panel by its caption (inside `within`, a selector, when given): its swatch's centre, scrolled into view. */
const swatchOf = (page, panel, caption, within = null) =>
  page.evaluate(
    ([name, cap, box]) => {
      const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === name);
      const scope = box ? p.querySelector(box) : p;
      const row = [...scope.querySelectorAll('label.label-row')].find((l) => l.firstElementChild?.textContent === cap);
      const s = row?.querySelector('.cpick__swatch');
      if (!s) return null;
      s.scrollIntoView({ block: 'center' });
      const r = s.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    },
    [panel, caption, within],
  );

/**
 * The middle of the view, and the colour the frame settles on there. For a
 * second or so after any change the picture is still easing in (the first
 * frames read darker, as the still frame and the AO come back), and a pick
 * made a moment later reads the settled frame: so three reads half a
 * second apart must agree before one is taken as what a pick should get.
 */
const viewMiddle = async (page) => {
  const read = () =>
    page.evaluate(async () => {
      const v = window.__bozzetto;
      const r = v.renderer.domElement.getBoundingClientRect();
      const at = [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
      return { at, hex: await v.samplePixel(at[0], at[1]) };
    });
  const seen = [];
  for (let i = 0; i < 16; i++) {
    seen.push(await read());
    const last = seen.slice(-3);
    if (last.length === 3 && last.every((s) => near(s.hex, last[0].hex, 2))) break;
    await page.waitForTimeout(500);
  }
  return seen[seen.length - 1];
};

const near = (a, b, tol = 8) => {
  if (!a || !b) return false;
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  return [16, 8, 0].every((s) => Math.abs(((x >> s) & 255) - ((y >> s) & 255)) <= tol);
};

/**
 * Press a swatch, drag it out onto `to` and wait there until `live(arg)`
 * answers (the frame the pick reads arrives a frame or two after the drag
 * starts); then go on to `release`, if given, and let go there. What
 * `live` answered comes back, with whether the pick had begun.
 */
async function pickDrag(page, from, to, live, arg = null, release = to) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(from[0] - 24, from[1] + 6, { steps: 2 });
  const sampling = await page
    .waitForFunction(() => document.body.classList.contains('is-sampling') && !!document.querySelector('.swatch-pick'), null, { timeout: 10_000 })
    .then(() => true, () => false);
  await page.mouse.move(...to, { steps: 5 });
  const seen = await page.waitForFunction(live, arg, { timeout: 30_000 }).then((h) => h.jsonValue(), () => null);
  if (release !== to) {
    await page.mouse.move(...release, { steps: 5 });
    await page.waitForTimeout(300);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  return { sampling, seen };
}

/** The key light's colour once it is not `was`. */
const keyColourNot = (was) => {
  const c = window.__bozzetto.lighting.state().find((l) => l.id === 'key').color;
  return c !== was ? c : null;
};
/** The background's colour once it is not `was`. */
const bgColourNot = (was) => {
  const c = window.__bozzetto.environment.getState().bgColor;
  return c !== was ? c : null;
};

/** The colour pickers' popovers that are up. */
const openPops = (page) => page.evaluate(() => [...document.querySelectorAll('.cpick__pop')].filter((p) => !p.hidden).length);

/** The last failure notice's words, or null when none comes. */
const failedNotice = (page, timeout = 20_000) =>
  page
    .waitForFunction(() => [...document.querySelectorAll('.file-menu__progress[data-state="failed"]')].pop()?.textContent ?? null, null, { timeout })
    .then((h) => h.jsonValue())
    .catch(() => null);
const clearNotices = (page) => page.evaluate(() => document.querySelectorAll('.file-menu__progress').forEach((n) => n.remove()));

/**
 * navigator.deviceMemory as the pages of this tab see it, from the next
 * navigation on: what setDeviceMemory left in sessionStorage, so that it
 * holds across a page change ('none' being Safari's and Firefox's answer),
 * and the browser's own until then.
 */
const fakeDeviceMemory = (page) =>
  page.context().addInitScript(() => {
    const own = Object.getOwnPropertyDescriptor(Navigator.prototype, 'deviceMemory');
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      configurable: true,
      get() {
        const set = sessionStorage.getItem('test:deviceMemory');
        if (set === null) return own?.get?.call(this);
        return set === 'none' ? undefined : Number(set);
      },
    });
  });
const setDeviceMemory = (page, mem) =>
  page.evaluate((m) => sessionStorage.setItem('test:deviceMemory', m === null ? 'none' : String(m)), mem);

/** The voxel overlay's state: shown, and what it drew. */
const overlay = (page) =>
  page.evaluate(() => {
    const o = document.querySelector('.voxel-overlay');
    if (!o) return null;
    return { shown: !o.hidden, ...o.dataset, caption: o.querySelector('.voxel-overlay__caption')?.textContent ?? '' };
  });

export const suites = {
  // A published sculpt's own colours or one plain colour: offered only for
  // a model that has colours, changing the picture, kept by the look and
  // the manifest, carried by the export, and of no effect on Sculpt mode.
  async plainColour(page, base, t) {
    const painted = cube([1, 0.02, 0.02]);
    await viewModel(page, base, painted);
    let rows = await materialRows(page);
    t.ok(
      rows.colour === 'sculpt' && rows.options === 'Sculpt colours / Plain colour' && !rows.albedo,
      `a painted model's Render panel offers Sculpt colours / Plain colour, on Sculpt colours, with no Albedo row (${JSON.stringify(rows)})`,
    );
    const own = await middle(page);
    t.ok(reddish(own), `and it renders its own red paint (${own})`);
    await page.evaluate(() => window.__bozzetto.materials.setAlbedo('#2a5cff'));
    t.ok(reddish(await middle(page)), 'an albedo set under Sculpt colours changes nothing on it');
    await pickColour(page, 'plain');
    rows = await materialRows(page);
    t.ok(rows.colour === 'plain' && rows.albedo, `Plain colour brings the Albedo row (${JSON.stringify(rows)})`);
    const plain = await middle(page);
    t.ok(bluish(plain), `and the model renders in the albedo, blue, not its paint (${plain})`);
    const look = await page.evaluate(() => window.__bozzetto.getLook().material);
    t.ok(look.vertexColors === false && look.albedo === '#2a5cff', `the look says Plain colour and the albedo (${JSON.stringify(look)})`);
    await pickColour(page, 'sculpt');
    t.ok(reddish(await middle(page)) && (await page.evaluate(() => window.__bozzetto.getLook().material.vertexColors)) === true, 'Sculpt colours brings the paint back');

    // Saved with the project's look, it opens as saved; a look from before
    // the choice opens on the model's own colours.
    await viewModel(page, base, painted, { ...look });
    rows = await materialRows(page);
    t.ok(rows.colour === 'plain' && rows.albedo && bluish(await middle(page)), `a project saved on Plain colour opens on it, in its albedo (${rows.colour})`);
    const { vertexColors: _gone, ...older } = look;
    await viewModel(page, base, painted, older);
    t.ok((await materialRows(page)).colour === 'sculpt' && reddish(await middle(page)), 'one saved before the choice opens on its own colours');
    // Nothing to choose between without paint.
    await viewModel(page, base, cube(null));
    rows = await materialRows(page);
    t.ok(rows.colour === null && rows.albedo, `an unpainted model gets no switch, only its Albedo (${JSON.stringify(rows)})`);
    await page.unroute('**/timelapses/demo/manifest.json');
    await page.unroute(/painted\.glb/);

    // The editors' preview (the uploader's here; the admin editor builds
    // the same panel and export) and its single-file export.
    const dir = mkdtempSync(join(tmpdir(), 'bozzetto-painted-'));
    try {
      const file = join(dir, 'painted.glb');
      writeFileSync(file, painted);
      await page.goto(`${base}/create/`, { waitUntil: 'domcontentloaded' });
      await page.setInputFiles('#files', file);
      await page.waitForFunction(() => !document.querySelector('#export-html').disabled, null, { timeout: 90_000 });
      rows = await materialRows(page);
      t.ok(rows.colour === 'sculpt' && !rows.albedo, `the uploader's preview offers the switch for a painted model (${JSON.stringify(rows)})`);
      await pickColour(page, 'plain');
      await page.evaluate(() => window.__bozzetto.materials.setAlbedo('#2a5cff'));
      t.ok(bluish(await middle(page)), 'and renders Plain colour in its albedo');
      await page.route('**/embed/viewer.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* viewer */' }));
      await page.route('**/embed/embed.css', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '/* css */' }));
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.click('#export-html')]);
      const html = readFileSync(await download.path(), 'utf8');
      const registry = JSON.parse(html.match(/window\.__BOZZETTO__=(.*?);<\/script>/s)?.[1] ?? 'null');
      const exported = registry?.manifest?.material;
      t.ok(exported?.vertexColors === false && exported.albedo === '#2a5cff', `its single-file export carries Plain colour and the albedo (${JSON.stringify(exported)})`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    // Sculpt mode shows its paint whatever a look says.
    await openForInput(page, base);
    await page.keyboard.press('0'); // the Paint brush, whose colour the fill uses
    await page.evaluate(() => {
      const { input } = window.__sculpt;
      input.setPaintColor('#ff0000');
      input.fillPaint();
    });
    await page.waitForTimeout(300);
    t.ok(reddish(await middle(page)), 'in Sculpt, a sphere filled with red paint renders red');
    await page.evaluate(async () => {
      // The choice alone: an albedo in a look applied here would be
      // written onto the object's material (sculpt mode's own hooks).
      await window.__bozzetto.applyLook({ material: { vertexColors: false } });
      window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
    });
    await page.waitForTimeout(300);
    t.ok(reddish(await middle(page)), 'and still red under a look saying Plain colour');
    await openPanel(page, 'Render');
    t.eq((await materialRows(page)).colour, null, 'its Render panel offers no switch');
  },

  // The eyedropper drag on the background's and the lights' swatches, as
  // on the paint brush's: the colour under the pointer, read off the
  // frame, applied while dragging and kept on a release over the view; a
  // release off it puts the colour back; and the drag opens no popover.
  async swatchPick(page, base, t) {
    await openForInput(page, base);
    t.ok(await openPanel(page, 'Render'), 'Sculpt: the Render panel opens');
    const sphere = await viewMiddle(page);
    // The key light, picked off the sphere it lights.
    const keyAt = await swatchOf(page, 'Render', 'Colour', '.light');
    const keyBefore = (await keyLight(page)).color;
    let drag = await pickDrag(page, keyAt, sphere.at, keyColourNot, keyBefore);
    t.ok(drag.sampling, "dragging the key light's swatch out starts a pick, with its stand-in cursor");
    t.ok(near(drag.seen, sphere.hex), `over the sphere the key light already takes the colour the frame shows there (${drag.seen}, frame ${sphere.hex}, was ${keyBefore})`);
    const key = (await keyLight(page)).color;
    t.ok(near(key, sphere.hex) && /^#[0-9a-f]{6}$/.test(key), `and keeps it on the release, as #rrggbb (${key})`);
    const after = await page.evaluate(() => ({
      sampling: document.body.classList.contains('is-sampling') || !!document.querySelector('.swatch-pick'),
      swatch: document.querySelector('.panel .light .cpick__swatch').style.background,
    }));
    t.ok(!after.sampling && after.swatch !== '', `the pick ends with the release, the swatch showing the colour (${after.swatch})`);
    t.eq(await openPops(page), 0, 'and the drag opened no popover');
    await page.waitForTimeout(600); // past the release's own click
    await page.mouse.click(...keyAt);
    t.eq(await openPops(page), 1, 'a tap on the swatch still opens the picker');
    await page.keyboard.press('Escape');

    // Over the view, then let go over the panel: cancelled.
    const keyNow = (await keyLight(page)).color;
    const beside = [Math.round(sphere.at[0] - 330), sphere.at[1]];
    drag = await pickDrag(page, keyAt, beside, keyColourNot, keyNow, [keyAt[0], keyAt[1] + 40]);
    t.ok(drag.seen !== null, `over the background the key light follows the pointer (${drag.seen})`);
    t.eq((await keyLight(page)).color, keyNow, 'a release over the panel cancels: the key light is as it was');

    // The background, a solid colour, picked off the sphere.
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === 'Render');
      const sel = [...p.querySelectorAll('label.label-row')].find((l) => l.firstElementChild?.textContent === 'Background').querySelector('select');
      sel.value = 'color';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      window.__bozzetto.environment.setBackgroundColor('#203040');
    });
    await page.waitForTimeout(300);
    const lit = await viewMiddle(page);
    const bgAt = await swatchOf(page, 'Render', 'Bg colour');
    drag = await pickDrag(page, bgAt, lit.at, bgColourNot, '#203040');
    t.ok(near(drag.seen, lit.hex), `the background's swatch picks too: the backdrop takes the sphere's colour as it is dragged (${drag.seen}, frame ${lit.hex})`);
    const bg = await page.evaluate(() => window.__bozzetto.environment.getState().bgColor);
    t.ok(near(bg, lit.hex) && /^#[0-9a-f]{6}$/.test(bg), `and keeps it on the release (${bg})`);

    // The paint brush's swatch, on the same implementation.
    await page.keyboard.press('0');
    t.ok(await openPanel(page, 'Tool'), 'the Tool panel opens on the Paint brush');
    const paintAt = await swatchOf(page, 'Tool', 'Colour');
    const paintBefore = await page.evaluate(() => window.__sculpt.input.getPaintColor());
    const shown = await viewMiddle(page);
    drag = await pickDrag(
      page,
      paintAt,
      shown.at,
      (was) => {
        const c = window.__sculpt.input.getPaintColor();
        return c !== was ? c : null;
      },
      paintBefore,
    );
    const paint = await page.evaluate(() => window.__sculpt.input.getPaintColor());
    t.ok(near(paint, shown.hex), `the paint swatch picks the same way (${paint}, frame ${shown.hex})`);

    // Armature: the key light off the figure.
    await openArmature(page, base);
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
    t.ok(await openPanel(page, 'Render'), 'Armature: the Render panel opens');
    const fig = await viewMiddle(page);
    const armKeyAt = await swatchOf(page, 'Render', 'Colour', '.light');
    drag = await pickDrag(page, armKeyAt, fig.at, keyColourNot, (await keyLight(page)).color);
    const armKey = (await keyLight(page)).color;
    t.ok(drag.sampling && near(armKey, fig.hex), `the key light takes the colour under the pointer (${armKey}, frame ${fig.hex})`);

    // The editors' preview: the uploader's, whose Render panel is the admin editor's.
    await page.goto(`${base}/create/`, { waitUntil: 'domcontentloaded' });
    await page.setInputFiles('#files', resolve('dist/timelapses/demo/frames/sd/0000.glb'));
    await page.waitForFunction(() => !document.querySelector('#export-html').disabled, null, { timeout: 90_000 });
    await page.evaluate(() => {
      const p = document.querySelector('.panel--editor');
      const sel = [...p.querySelectorAll('label.label-row')].find((l) => l.firstElementChild?.textContent === 'Background').querySelector('select');
      sel.value = 'color';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      window.__bozzetto.environment.setBackgroundColor('#203040');
    });
    await page.waitForTimeout(300);
    const model = await viewMiddle(page);
    const edBgAt = await page.evaluate(() => {
      const p = document.querySelector('.panel--editor');
      const row = [...p.querySelectorAll('label.label-row')].find((l) => l.firstElementChild?.textContent === 'Bg colour');
      const s = row.querySelector('.cpick__swatch');
      s.scrollIntoView({ block: 'center' });
      const r = s.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    });
    drag = await pickDrag(page, edBgAt, model.at, bgColourNot, '#203040');
    const edBg = await page.evaluate(() => window.__bozzetto.environment.getState().bgColor);
    t.ok(drag.sampling && near(edBg, model.hex), `the editor preview's background picks off its model (${edBg}, frame ${model.hex})`);
  },

  // The colour picker at twice its size (owner call), beside its panel on
  // an upright iPad mini, with S and V rows only - the hue strip sets the
  // hue - and typed values in both.
  async pickerSize(page, base, t) {
    await page.setViewportSize({ width: 744, height: 1133 });
    await openForInput(page, base);
    t.ok(await openPanel(page, 'Render'), 'the Render panel opens on a 744 x 1133 view');
    const keyAt = await swatchOf(page, 'Render', 'Colour', '.light');
    await page.mouse.click(...keyAt);
    const m = await page.evaluate(() => {
      const pop = [...document.querySelectorAll('.cpick__pop')].find((p) => !p.hidden);
      const panel = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === 'Render');
      const r = (el) => el.getBoundingClientRect();
      return {
        pop: r(pop).toJSON(),
        field: r(pop.querySelector('.cpick__field')).toJSON(),
        hue: r(pop.querySelector('.cpick__hue')).toJSON(),
        panel: r(panel).toJSON(),
        labels: [...pop.querySelectorAll('.cpick__label')].map((l) => l.textContent),
        ranges: [...pop.querySelectorAll('input[type=range]')].map((i) => i.max),
      };
    });
    t.ok(m.field.height >= 216 && m.field.width >= 290, `the saturation/value field is twice its 110 px: ${Math.round(m.field.width)} x ${Math.round(m.field.height)}`);
    t.ok(m.hue.width >= 27 && Math.abs(m.hue.height - m.field.height) < 1, `the hue strip twice its 14 px, as tall as the field (${Math.round(m.hue.width)} x ${Math.round(m.hue.height)})`);
    t.ok(
      m.pop.left >= 0 && m.pop.right <= m.panel.left - 4 && m.pop.bottom <= 1133,
      `it opens beside the open panel, on the screen (${Math.round(m.pop.left)}..${Math.round(m.pop.right)}, panel from ${Math.round(m.panel.left)})`,
    );
    t.ok(m.labels.join(',') === 'S,V' && m.ranges.join(',') === '100,100', `no H row: S and V only (${m.labels}, ${m.ranges})`);

    const rowAt = (i) =>
      page.evaluate((k) => {
        const pop = [...document.querySelectorAll('.cpick__pop')].find((p) => !p.hidden);
        const input = pop.querySelectorAll('.cpick__row input[type=range]')[k];
        const b = input.getBoundingClientRect();
        return [b.left + b.width / 2, b.top + b.height / 2];
      }, i);
    const hsv = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
      const max = Math.max(r, g, b);
      return { s: max ? (max - Math.min(r, g, b)) / max : 0, v: max };
    };
    await page.mouse.dblclick(...(await rowAt(0)));
    const field = await page.evaluate(() => ({ cls: document.activeElement?.className, name: document.activeElement?.getAttribute('aria-label') }));
    t.ok(field.cls === 'slider-field' && field.name === 'S', `a double-click on S opens its number field (${JSON.stringify(field)})`);
    await typeValue(page, '40');
    let key = (await keyLight(page)).color;
    let readouts = await page.evaluate(() => [...[...document.querySelectorAll('.cpick__pop')].find((p) => !p.hidden).querySelectorAll('.cpick__value')].map((v) => v.textContent));
    t.ok(Math.abs(hsv(key).s - 0.4) < 0.02 && readouts[0] === '40', `typing 40 sets the key light's saturation to 40% (${key}, S reads ${readouts[0]})`);
    await page.mouse.dblclick(...(await rowAt(1)));
    await typeValue(page, '60');
    t.ok(Math.abs(hsv((await keyLight(page)).color).v - 0.6) < 0.02, 'V takes a typed 60 as well');
    await page.mouse.dblclick(...(await rowAt(1)));
    await typeValue(page, '250');
    key = (await keyLight(page)).color;
    readouts = await page.evaluate(() => [...[...document.querySelectorAll('.cpick__pop')].find((p) => !p.hidden).querySelectorAll('.cpick__value')].map((v) => v.textContent));
    t.ok(Math.abs(hsv(key).v - 1) < 0.01 && readouts[1] === '100', `250 in V is held to 100 (${key}, V reads ${readouts[1]})`);
    await page.mouse.dblclick(...(await rowAt(1)));
    await typeValue(page, '20', 'Escape');
    const kept = await page.evaluate(() => ({ open: [...document.querySelectorAll('.cpick__pop')].some((p) => !p.hidden), field: !!document.querySelector('.cpick__pop .slider-field') }));
    t.ok(kept.open && !kept.field && (await keyLight(page)).color === key, 'Esc in a row\'s field puts the value back and leaves the picker open');
    await page.keyboard.press('Escape');
    t.eq(await openPops(page), 0, 'a second Esc closes the picker');
  },

  // The remesh resolution's voxel grid over the view while its slider is
  // held, up to 512 in Sculpt and Armature, and a remesh past what the
  // device can spare refused with the reason. deviceMemory is overridden:
  // 8 (GB) is Chrome's top answer, undefined Safari's.
  async voxelGrid(page, base, t) {
    await fakeDeviceMemory(page);
    await openForInput(page, base);
    t.ok(await openPanel(page, 'Model'), 'Sculpt: the Model panel opens');
    let row = await sliderRow(page, 'Model', 'Resolution');
    t.ok(row.min === 16 && row.max === 512 && row.thumb === 150, `Resolution runs 16..512, from 150 (${row.min}..${row.max}, ${row.thumb})`);
    t.ok((await overlay(page))?.shown === false, 'no grid over the view until the slider is held');
    await page.mouse.move(...row.at);
    await page.mouse.down();
    await page.waitForTimeout(200);
    let o = await overlay(page);
    t.ok(o.shown && Number(o.lines) > 100 && Number(o.resolution) === (await sliderRow(page, 'Model', 'Resolution')).thumb, `held, the grid is drawn at the slider's resolution (${o.resolution}: ${o.lines} lines, a voxel ${o.cellPx} px)`);
    const firstCell = Number(o.cellPx);
    await page.mouse.move(row.at[0] - 200, row.at[1], { steps: 4 });
    await page.waitForTimeout(200);
    o = await overlay(page);
    t.ok(o.shown && Number(o.resolution) === 16 && Number(o.cellPx) > firstCell, `dragged down to 16 the voxels grow (${o.cellPx} px, from ${firstCell})`);
    await page.mouse.up();
    await page.waitForTimeout(200);
    t.ok((await overlay(page)).shown === false, 'and the grid goes when the slider is let go');

    // Typed: 600 is held to the hard 512.
    row = await sliderRow(page, 'Model', 'Resolution');
    await page.mouse.dblclick(...row.at);
    await typeValue(page, '600');
    row = await sliderRow(page, 'Model', 'Resolution');
    const res = await page.evaluate(() => window.__sculpt.session.getRemeshResolution());
    t.ok(row.thumb === 512 && res === 512, `600 typed is held to 512 (thumb ${row.thumb}, session ${res})`);

    // 512 on the sphere: a dense 516-cell cube, gigabytes. The grid says so
    // while held, and the remesh is refused with the reason, the sphere
    // left as it was.
    await setDeviceMemory(page, 8);
    await page.mouse.move(row.maxEnd[0] + 6, row.maxEnd[1]);
    await page.mouse.down();
    await page.waitForTimeout(200);
    const at8 = await overlay(page);
    await page.mouse.up();
    t.ok(at8.over === '1' && /more than this device can spare/.test(at8.caption), `held at 512 on the sphere, the grid's caption says it is too much here (${at8.caption})`);
    const before = await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      window.__beforeRemesh = m;
      return m.getNbVertices();
    });
    await clearNotices(page);
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === 'Model');
      [...p.querySelectorAll('button')].find((b) => b.textContent === 'Voxel remesh').click();
    });
    const said = await failedNotice(page);
    const unchanged = await page.evaluate(() => window.__sculpt.session.getMesh() === window.__beforeRemesh);
    t.ok(
      !!said && /A remesh at 512 would need about [\d.]+ GB, more than this device can spare \(about 2\.0 GB\)\. For this object, \d+ is the most it can take\./.test(said) && unchanged,
      `Voxel remesh at 512 is refused with the reason, the sphere untouched (${said}; ${before} vertices kept)`,
    );
    const most8 = Number(said?.match(/(\d+) is the most/)?.[1]);
    // Safari's answer is none: the fallback budget is smaller, so the most is less.
    await setDeviceMemory(page, null);
    await clearNotices(page);
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === 'Model');
      [...p.querySelectorAll('button')].find((b) => b.textContent === 'Voxel remesh').click();
    });
    const saidSafari = await failedNotice(page);
    const mostSafari = Number(saidSafari?.match(/(\d+) is the most/)?.[1]);
    t.ok(/about 1\.0 GB/.test(saidSafari ?? '') && mostSafari > 16 && mostSafari < most8, `with no deviceMemory (Safari) the budget is a conservative 1 GB: ${mostSafari} at most, against ${most8} at 8 GB`);

    // A thin object at 512 fits: the grid is 512 long but a few dozen cells
    // across. Accepted, and remeshed.
    await setDeviceMemory(page, 8);
    await clearNotices(page);
    const thin = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMesh().getMatrix();
      m[0] *= 0.05;
      m[10] *= 0.05;
      const box = session.remeshBox();
      const before = session.getMesh();
      const ok = session.voxelRemesh(512);
      return { ok, replaced: session.getMesh() !== before, verts: session.getMesh().getNbVertices(), box: box.map((v) => Number(v.toFixed(3))) };
    });
    t.ok(thin.ok && thin.replaced && thin.verts > 1000, `512 on a thin object is accepted and remeshed (${thin.verts} vertices, box ${thin.box})`);
    t.eq(await failedNotice(page, 1500), null, 'with no notice');

    // Armature: the same range and grid, and the same guard before it sends.
    await openArmature(page, base);
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
    t.ok(await openPanel(page, 'Armature'), 'Armature: its panel opens');
    row = await sliderRow(page, 'Armature', 'Resolution');
    t.ok(row.min === 16 && row.max === 512, `Send to Sculpt's Resolution runs 16..512 (${row.min}..${row.max})`);
    await page.mouse.move(...row.at);
    await page.mouse.down();
    await page.waitForTimeout(200);
    o = await overlay(page);
    t.ok(o?.shown && Number(o.lines) > 100, `held, the grid is drawn over the figure (${o?.resolution}: ${o?.lines} lines)`);
    await page.mouse.up();
    await page.waitForTimeout(200);
    t.ok((await overlay(page)).shown === false, 'and goes on release');
    await setDeviceMemory(page, 0.25);
    await clearNotices(page);
    const url = page.url();
    await page.evaluate(() => window.__armature.send(512));
    const sendSaid = await failedNotice(page);
    t.ok(
      /A remesh at 512 would need about .* more than this device can spare \(about 64 MB\)/.test(sendSaid ?? '') && page.url() === url,
      `Send to Sculpt at 512 on a 256 MB device is refused before it leaves (${sendSaid})`,
    );
    // Sent from a roomier device (priced as it left, then the memory
    // shrinks): Sculpt takes the figure at the most that fits, and says so.
    await page.evaluate(() => {
      sessionStorage.setItem('test:deviceMemory', '64');
      void window.__armature.send(512);
      sessionStorage.setItem('test:deviceMemory', '0.25');
    });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    const arrived = await failedNotice(page, 60_000);
    const figure = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMeshes().find((x) => /^Figure/.test(session.getMeshName(x)));
      return m ? m.getNbVertices() : 0;
    });
    t.ok(
      /^The figure was remeshed at \d+, the most this device can take: 512 would need about \d+ MB\.$/.test(arrived ?? '') && figure > 500,
      `and a figure sent at 512 to a device that cannot take it arrives at the most it can (${arrived}; ${figure} vertices)`,
    );
  },
};
