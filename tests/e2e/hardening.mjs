// The hardening suite: what a crafted file, a crafted link or a look made
// to fetch something can no longer do, and the ways out the app gives its
// owner. Scene files that inflate past what a scene can be, or name their
// arrays twice, are refused with a reason, and Sculpt carries on; files
// whose materials, curves and colours are not what they say open mended,
// and so does the autosave, whose bad record can no longer brick a boot.
// No colour from a look, a file or a manifest reaches a style as anything
// but #rrggbb, and no glTF fetches a buffer or an image from elsewhere. A
// link that opens a scene asks before it replaces the work here, unless
// the card that sent it asked. The service worker keeps no private
// thumbnail, forgets the owner's lists when the sign-in goes, answers only
// the app's own pages offline, and ?nosw asks. ?tl= takes ids only. A
// single-file export carries a Content-Security-Policy and still plays.
// Sign out clears what the device kept and goes through Access's logout.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openSculpt } from './lib.mjs';
import { bootState, fakeProjects, signInContext, storedFrames, workerActivated } from './smoke.mjs';

/** Somewhere no page of the app should ever ask. */
const ELSEWHERE = 'https://attacker.example';
const VIEWPORT = { width: 1280, height: 800 };

const count = (page) => page.evaluate(() => window.__sculpt.session.getMeshes().length);

/** Sculpt booted, its boot curtain gone, so a press lands on the canvas. */
async function openForInput(page, base, extra = '') {
  await openSculpt(page, base, `&q=low${extra}`);
  await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
}

/**
 * In-page tools for .bozz bytes, installed before the app's own scripts:
 * inflate and deflate, a container split into its header and blob region
 * and joined again, a rewrite of a file's header, and an open through the
 * path the File menu's Open takes (FileActions.replaceWith), answering
 * with the refusal's words (or null) and how long it took.
 */
function bozzTools() {
  const inflate = async (u8) =>
    u8[0] === 0x1f && u8[1] === 0x8b
      ? new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
      : u8;
  const deflate = async (u8) =>
    new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  const pad4 = (n) => Math.ceil(n / 4) * 4;
  const split = (raw) => {
    const len = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(4, true);
    return { header: JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + len))), blob: raw.subarray(8 + pad4(len)) };
  };
  const join = (header, blob) => {
    const h = new TextEncoder().encode(JSON.stringify(header));
    const out = new Uint8Array(8 + pad4(h.length) + blob.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x315a4f42, true); // "BOZ1"
    dv.setUint32(4, h.length, true);
    out.set(h, 8);
    out.set(blob, 8 + pad4(h.length));
    return out;
  };
  window.__bozz = {
    inflate,
    deflate,
    split,
    join,
    /** A packed scene with its header edited; `edit` may hand back a longer blob region. */
    async rewrite(bytes, edit) {
      const { header, blob } = split(await inflate(new Uint8Array(bytes)));
      return deflate(join(header, edit(header, blob) ?? blob));
    },
    async open(u8) {
      const t0 = performance.now();
      try {
        await window.__sculpt.file.open(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
        return { said: null, ms: performance.now() - t0 };
      } catch (e) {
        return { said: e instanceof Error ? e.message : String(e), ms: performance.now() - t0 };
      }
    },
  };
}

// Every vertex of every object, weighed by position, so any edit changes it.
const meshSum = (page) =>
  page.evaluate(() => {
    let sum = 0;
    for (const m of window.__sculpt.session.getMeshes()) {
      const v = m.getVertices();
      for (let i = 0; i < v.length; i++) sum += v[i] * ((i % 7) + 1);
    }
    return sum;
  });

/** A mouse stroke across the middle of the active object; whether it changed the mesh. */
async function strokeWorks(page) {
  const before = await meshSum(page);
  const [x, y] = await page.evaluate(() => {
    const { session, viewer } = window.__sculpt;
    const b = session.getMesh().computeWorldBound();
    const [px, py] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
    const r = viewer.captureCanvas.getBoundingClientRect();
    const pr = session.getPixelRatio();
    return [r.left + px / pr, r.top + py / pr];
  });
  await page.mouse.move(x - 30, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y + 10, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  return (await meshSum(page)) !== before;
}

/** The sculpt store's autosave record, read or edited in place. */
const editAutosave = (page, edit) =>
  page.evaluate(async (src) => {
    const db = await new Promise((ok, fail) => {
      const r = indexedDB.open('bozzetto-sculpt');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
    const rec = await new Promise((ok) => {
      const g = db.transaction('scene').objectStore('scene').get('current');
      g.onsuccess = () => ok(g.result);
    });
    // The edit arrives as source: a function cannot cross into the page.
    const out = new Function('rec', src)(rec);
    await new Promise((ok, fail) => {
      const tx = db.transaction('scene', 'readwrite');
      if (out === undefined) tx.objectStore('scene').delete('current');
      else tx.objectStore('scene').put(out, 'current');
      tx.oncomplete = ok;
      tx.onerror = () => fail(tx.error);
    });
    db.close();
  }, edit);

/** Whether the autosave holds a record. */
const autosaved = (page) =>
  page.evaluate(
    () =>
      new Promise((ok) => {
        const r = indexedDB.open('bozzetto-sculpt');
        r.onsuccess = () => {
          const db = r.result;
          const c = db.transaction('scene').objectStore('scene').count('current');
          c.onsuccess = () => {
            db.close();
            ok(c.result > 0);
          };
        };
      }),
  );

/** Requests to ELSEWHERE from a page or a context: answered with nothing, and counted. */
async function countElsewhere(target) {
  const asked = [];
  await target.route(`${ELSEWHERE}/**`, (route) => {
    asked.push(route.request().url());
    return route.abort();
  });
  return asked;
}

// --- scene files --------------------------------------------------------

/**
 * Files made to hurt: a gzip bomb, a header claiming a gigabyte, one array
 * named a thousand times, a stream running on past its header, a stack of
 * levels whose counts are lies. Each is refused with words for it, quickly,
 * and Sculpt goes on as it was. Then files that are only wrong - a material
 * id that is a number, a curve called "__proto__", colours that are
 * addresses - which open mended, and boot again mended.
 */
async function sceneFiles(page, base, t) {
  await openForInput(page, base);
  const objects = await count(page);
  const bombs = await page.evaluate(async () => {
    const { deflate, inflate, join, open } = window.__bozz;
    const out = {};
    // 16 MB of zeros: 16 KB of gzip, and no scene at all.
    const zeros = await deflate(new Uint8Array(16 << 20));
    out.zeros = { bytes: zeros.length, ...(await open(zeros)) };
    // A header claiming one array of a gigabyte, over 16 MB of zeros.
    const huge = await deflate(join({ scene: {}, buffers: [{ t: 'f32', off: 0, len: 2 ** 28 }] }, new Uint8Array(16 << 20)));
    out.huge = { bytes: huge.length, ...(await open(huge)) };
    // One 4 MB array named by a thousand references: the old reader copied it for each.
    const meshes = Array.from({ length: 1000 }, () => ({ levels: [{ vertices: { __buf: 0 } }] }));
    const refs = await deflate(join({ scene: { v: 4, meshes }, buffers: [{ t: 'f32', off: 0, len: 1 << 20 }] }, new Uint8Array(4 << 20)));
    out.refs = { bytes: refs.length, ...(await open(refs)) };
    // A real scene, with 16 MB of zeros running on after it.
    const real = await inflate(new Uint8Array(await window.__sculpt.file.pack()));
    const longer = new Uint8Array(real.length + (16 << 20));
    longer.set(real);
    const trailing = await deflate(longer);
    out.trailing = { bytes: trailing.length, ...(await open(trailing)) };
    // Twenty more levels of one vertex each on the first object: subdivided
    // before their counts were checked, these took the tab down.
    const levels = await window.__bozz.rewrite(await window.__sculpt.file.pack(), (h, blob) => {
      const mesh = h.scene.meshes[0];
      const at = blob.length;
      for (let k = 0; k < 20; k++) {
        const ref = (j) => {
          h.buffers.push({ t: 'f32', off: at + (k * 3 + j) * 12, len: 3 });
          return { __buf: h.buffers.length - 1 };
        };
        mesh.levels.push({ nbVertices: 1, vertices: ref(0), normals: null, colors: ref(1), materials: ref(2), detailsXYZ: null, detailsRGB: null, detailsPBR: null });
      }
      const grown = new Uint8Array(at + 20 * 3 * 12);
      grown.set(blob);
      return grown;
    });
    out.levels = { bytes: levels.length, ...(await open(levels)) };
    return out;
  });
  const show = (b) => `${(b.bytes / 1024).toFixed(0)} KB, refused in ${Math.round(b.ms)} ms: "${b.said}"`;
  t.ok(bombs.zeros.bytes < 20 * 1024 && bombs.zeros.said === 'This file is not a Bozzetto scene' && bombs.zeros.ms < 5000, `a 16 KB gzip bomb is not a scene (${show(bombs.zeros)})`);
  t.ok(bombs.huge.said === 'This scene is too large to open' && bombs.huge.ms < 5000, `a header claiming a gigabyte is too large to open, before any of it is held (${show(bombs.huge)})`);
  t.ok(bombs.refs.said === 'This scene file is damaged (an array used twice)' && bombs.refs.ms < 5000, `one array named a thousand times is refused, not copied a thousand times (${show(bombs.refs)})`);
  t.ok(bombs.trailing.said === 'This file is not a Bozzetto scene' && bombs.trailing.ms < 5000, `a stream that runs on past its header is stopped there (${show(bombs.trailing)})`);
  t.ok(/^sculpt restore: level \d+ shape mismatch$/.test(bombs.levels.said ?? '') && bombs.levels.ms < 5000, `levels whose counts are lies are refused before they are subdivided (${show(bombs.levels)})`);
  t.eq(await count(page), objects, 'and after all of them the scene is the one that was there');
  t.ok(await strokeWorks(page), 'and a stroke still sculpts it');

  // Wrong, not hostile: mended on the way in.
  const asked = await countElsewhere(page);
  const mended = await page.evaluate(async () => {
    const { input, library, session, tablet } = window.__sculpt;
    const tool = input.currentToolIndex();
    const bytes = await window.__bozz.rewrite(await window.__sculpt.file.pack(), (h) => {
      const s = h.scene;
      s.materials = [{ id: 7, name: 'Seven', albedo: 'url(https://attacker.example/albedo.png)', roughness: 'rough', metalness: 0 }, ...(s.materials ?? [])];
      s.meshes[0].materialId = 7;
      s.settings = s.settings ?? { worldScale: false };
      s.settings.dynamics = { ...(s.settings.dynamics ?? {}), [tool]: { size: 1, strength: 1, sizeCurve: '__proto__', strengthCurve: 'toString' } };
      s.settings.paintColor = 'url(https://attacker.example/paint.png)';
      s.look.environment.background = 'color';
      s.look.environment.bgColor = 'url(https://attacker.example/bg.png)';
      s.look.lighting.key.color = 'url(https://attacker.example/key.png)';
      s.look.presentation.ground = 'floor';
      s.look.presentation.color = 'url(https://attacker.example/stage.png)';
      s.look.toneMapping = '__proto__';
      s.unknown = { kept: 'no' };
    });
    const { said } = await window.__bozz.open(bytes);
    const d = input.dynamics.get(tool);
    let pressure;
    try {
      pressure = tablet.getPressureRadius();
    } catch (e) {
      pressure = String(e);
    }
    const v = window.__sculpt.viewer;
    return {
      said,
      ids: library.list().map((m) => m.id),
      albedos: library.list().map((m) => m.albedo),
      curves: `${d.sizeCurve},${d.strengthCurve}`,
      pressure,
      colors: [v.environment.getState().bgColor, v.lighting.state()[0].color, v.getStageState().color],
      tone: v.getToneMapping(),
      objects: session.getMeshes().length,
    };
  });
  t.eq(mended.said, null, 'a .bozz with a numeric material id and a "__proto__" curve opens without throwing');
  t.ok(mended.ids.length > 0 && mended.ids.every((id) => /^m\d+$/.test(id)) && mended.albedos.every((a) => /^#[0-9a-f]{6}$/.test(a)), `its materials are all ids and colours (${mended.ids.join(', ')})`);
  t.ok(mended.curves === 'linear,linear' && typeof mended.pressure === 'number', `the curves fall back to linear, and the pressure reads (${mended.curves}; ${mended.pressure})`);
  t.ok(mended.colors.every((c) => /^#[0-9a-f]{6}$/.test(c)) && mended.tone !== '__proto__', `the look's colours are colours (${mended.colors.join(', ')}; ${mended.tone})`);
  t.ok(await strokeWorks(page), 'and a stroke with the mended brush sculpts');
  await page.evaluate(async () => {
    window.__sculpt.persist.markDirty();
    await window.__sculpt.persist.flush();
  });
  await openForInput(page, base);
  const again = await page.evaluate(() => ({
    objects: window.__sculpt.session.getMeshes().length,
    ids: window.__sculpt.library.list().map((m) => m.id),
  }));
  t.ok(again.objects === mended.objects && again.ids.every((id) => /^m\d+$/.test(id)), `the next boot is fine: the same ${again.objects} objects, materials ${again.ids.join(', ')}`);
  t.eq(asked.length, 0, `nothing was fetched from elsewhere${asked.length ? `: ${asked.join(', ')}` : ''}`);

  // The autosave's own record, made bad in place: the boot mends it.
  await page.evaluate(() => window.__sculpt.persist.disable());
  await editAutosave(
    page,
    `rec.materials = 'not a list';
     rec.meshes[0].materialId = 12345;
     rec.settings = { worldScale: 'yes', worldRadius: 'big', dynamics: { 3: null, 4: { sizeCurve: '__proto__' } }, spacing: 'wide', alphas: 5, symmetry: { 1: 'x' }, paintColor: { r: 1 } };
     return rec;`,
  );
  await openForInput(page, base);
  t.eq(await count(page), again.objects, 'an autosave with a material list that is a string, a null brush and a "__proto__" curve boots, mended');
  t.ok(await strokeWorks(page), 'and sculpts');

  // And one that cannot be mended: set aside, said so, a clean start.
  await page.evaluate(() => window.__sculpt.persist.disable());
  await editAutosave(page, 'rec.meshes[0].levels = []; return rec;');
  await openForInput(page, base);
  const fresh = await page.evaluate(() => ({
    objects: window.__sculpt.session.getMeshes().length,
    said: [...document.querySelectorAll('.file-menu__progress[data-state="failed"]')].map((e) => e.textContent),
  }));
  t.ok(fresh.objects === 1 && fresh.said.includes('Your last sculpt could not be restored, so Sculpt started a new one'), `an autosave that cannot be read starts a new sculpt and says so (${fresh.said.join(' | ')})`);
  // The clear is not waited on at boot: give it a moment.
  for (let i = 0; i < 20 && (await autosaved(page)); i++) await page.waitForTimeout(250);
  t.eq(await autosaved(page), false, 'and the record is gone, so the next boot does not meet it again');
}

// --- looks and models that name addresses ------------------------------

/** A .glb in the container's own layout: the JSON chunk, then the binary one. */
function glb(json, bin) {
  const pad = (b, fill) => {
    const n = Math.ceil(b.length / 4) * 4;
    return n === b.length ? b : Buffer.concat([b, Buffer.alloc(n - b.length, fill)]);
  };
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const b = pad(bin, 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); // "glTF"
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const chunk = (data, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([head, chunk(j, 0x4e4f534a), chunk(b, 0x004e4942)]);
}

/** One triangle in its own buffer; `edit` adds what is to be asked for from elsewhere. */
function triangle(edit) {
  const bin = Buffer.concat([Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer), Buffer.from(new Uint16Array([0, 1, 2, 0]).buffer)]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
  edit(json);
  return glb(json, bin);
}

/**
 * A published project's look, as its manifest carries it (and a single-file
 * export's registry): colours that are CSS url()s reach no style, and the
 * frames' glTF asks for nothing from elsewhere - a texture there is left
 * out, a buffer there fails that frame, and the viewer plays on.
 */
async function looksAndModels(page, base, t) {
  const asked = await countElsewhere(page);
  const failed = [];
  page.on('console', (m) => {
    // The first line: the frame, and the refusal's own words.
    if (m.type() === 'error' && /failed to load/.test(m.text())) failed.push(m.text().split('\n')[0]);
  });
  await page.route('**/timelapses/demo/manifest.json', async (route) => {
    const res = await route.fetch();
    const m = await res.json();
    await route.fulfill({
      response: res,
      json: {
        ...m,
        lighting: { key: { color: `url(${ELSEWHERE}/key.png)` }, ambient: { sky: `url(${ELSEWHERE}/sky.png)` } },
        material: { albedo: `url(${ELSEWHERE}/albedo.png)` },
        environment: { id: null, background: 'color', bgColor: `url(${ELSEWHERE}/bg.png)` },
        presentation: { ground: 'floor', color: `url(${ELSEWHERE}/stage.png)` },
      },
    });
  });
  // Frame 0 wears a texture from elsewhere; frame 1 keeps its normals there.
  const textured = triangle((j) => {
    j.images = [{ uri: `${ELSEWHERE}/texture.png` }];
    j.textures = [{ source: 0 }];
    j.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
    j.meshes[0].primitives[0].material = 0;
  });
  const remote = triangle((j) => {
    j.buffers.push({ uri: `${ELSEWHERE}/normals.bin`, byteLength: 36 });
    j.bufferViews.push({ buffer: 1, byteOffset: 0, byteLength: 36 });
    j.accessors.push({ bufferView: 2, componentType: 5126, count: 3, type: 'VEC3' });
    j.meshes[0].primitives[0].attributes.NORMAL = 2;
  });
  await page.route('**/timelapses/demo/frames/sd/0000.glb', (r) => r.fulfill({ status: 200, contentType: 'model/gltf-binary', body: textured }));
  await page.route('**/timelapses/demo/frames/sd/0001.glb', (r) => r.fulfill({ status: 200, contentType: 'model/gltf-binary', body: remote }));
  await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
  // The near window loads frame 1 behind frame 0; give it the time.
  for (let i = 0; i < 40 && !failed.some((f) => /Frame 1/.test(f)); i++) await page.waitForTimeout(250);
  const seen = await page.evaluate(() => {
    const v = window.__bozzetto;
    return {
      colors: [v.environment.getState().bgColor, v.lighting.state()[0].color, v.getStageState().color, v.materials.getMaterialState().albedo],
      swatches: [...document.querySelectorAll('.cpick__swatch')].map((s) => s.getAttribute('style') ?? ''),
      frame: v.timeline.frameIndex(),
    };
  });
  t.ok(seen.colors.every((c) => /^#[0-9a-f]{6}$/.test(c)), `a manifest's colours that are url()s come in as colours (${seen.colors.join(', ')})`);
  t.ok(seen.swatches.length >= 3 && seen.swatches.every((s) => !/url\(/.test(s)), `no swatch's style names an address (${seen.swatches.length} swatches)`);
  const frame1 = failed.find((f) => /Frame 1 failed to load/.test(f));
  t.ok(!!frame1 && failed.every((f) => /Frame 1 /.test(f)) && /is not loaded: models carry their own data/.test(frame1), `a frame whose buffer lives elsewhere fails to load, alone (${frame1 ?? 'no failure logged'})`);
  t.eq(asked.length, 0, `and nothing at all was fetched from elsewhere${asked.length ? `: ${asked.join(', ')}` : ''}`);
  await page.unroute('**/timelapses/demo/manifest.json');
  await page.unroute('**/timelapses/demo/frames/sd/0000.glb');
  await page.unroute('**/timelapses/demo/frames/sd/0001.glb');

  // ?tl= takes an id and nothing else: no path made of it is asked for.
  const paths = [];
  const onRequest = (r) => paths.push(new URL(r.url()).pathname);
  page.on('request', onRequest);
  for (const tl of ['../x', '..%2Fmedia%2Fx%2Ff.json%23']) {
    paths.length = 0;
    await page.goto(`${base}/?tl=${tl}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('.overlay--error'), null, { timeout: 30_000 }).catch(() => {});
    const said = await page.evaluate(() => document.querySelector('.overlay__msg')?.textContent ?? '');
    const probed = paths.filter((p) => /manifest\.json$|^\/api\/projects|^\/admin\/api\/projects|^\/x|^\/media/.test(p));
    t.ok(said === 'Could not load project: That is not a project link' && !probed.length, `?tl=${tl} is refused ("${said}"), and nothing is asked for (${probed.join(', ') || 'nothing'})`);
  }
  page.off('request', onRequest);

  // The hotkey guide's foot credits the icons, as their licence asks.
  const credit = await page.evaluate(() => {
    const a = document.querySelector('.help-guide__credit a');
    return a && { text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') };
  });
  if (!credit) {
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!document.querySelector('.help-guide__credit a'), null, { timeout: 60_000 }).catch(() => {});
  }
  const shown = credit ?? (await page.evaluate(() => {
    const a = document.querySelector('.help-guide__credit a');
    return a && { text: a.textContent, href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') };
  }));
  t.ok(
    shown?.text === 'Icons by Flaticon (UIcons)' && shown.href === 'https://www.flaticon.com/uicons' && shown.target === '_blank' && shown.rel === 'noopener',
    `the hotkey guide's foot credits the icons (${JSON.stringify(shown)})`,
  );
}

// --- opening by address -------------------------------------------------

/**
 * `?sculpt=1&lib=<id>` replaces the work on this device - the autosave
 * within seconds, and the reel - and any page can send it. Followed from
 * elsewhere it asks: No boots the work that was here and keeps the reel,
 * Yes opens the scene and the reel goes with the old work. From the
 * gallery's card, which asks itself, Sculpt does not ask again. A lib=
 * that is no id opens nothing.
 */
async function openByAddress(browser, base, t) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
  try {
    // Signed in (the probe faked), so recording is allowed and there is a reel to lose.
    await signInContext(ctx);
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    const dialogs = [];
    let answer = false;
    p.on('dialog', (d) => {
      dialogs.push(d.message());
      void (answer ? d.accept() : d.dismiss());
    });
    await openSculpt(p, base, '&q=low');
    await p.waitForFunction(() => window.__sculpt.recorder.isAllowed(), null, { timeout: 30_000 });
    // A scene on the shelf (two objects), and different work in progress (three).
    const entry = await p.evaluate(async () => {
      const s = window.__sculpt;
      s.session.addPrimitive('capsule');
      const e = await s.fileActions.keepOnDevice();
      s.session.addPrimitive('torus');
      await s.persist.flush();
      return { id: e.id, name: e.name };
    });
    await p.evaluate(() => window.__sculpt.recorder.setEnabled(true));
    await p.waitForFunction(() => window.__sculpt.recorder.frameCount() > 0, null, { timeout: 60_000 }).catch(() => {});
    await p.evaluate(() => window.__sculpt.recorder.setEnabled(false));
    const reel = await storedFrames(p);
    t.ok(reel > 0, `there is a reel on this device (${reel} frames)`);

    const question = `Open "${entry.name}"? The work in progress on this device will be replaced.`;
    dialogs.length = 0;
    await openSculpt(p, base, `&q=low&lib=${entry.id}`);
    let st = await bootState(p);
    t.eq(dialogs.join(' | '), question, 'followed by its address, a link to a shelf scene asks first');
    t.ok(st.objects === 3 && !/lib=/.test(st.search), `No: the work in progress boots instead, and the link leaves the address (${st.objects} objects, "${st.search}")`);
    t.eq(await storedFrames(p), reel, 'and the reel stays');
    // Past the autosave's grace, the work is still what the autosave holds.
    await p.waitForTimeout(6500);
    dialogs.length = 0;
    await openSculpt(p, base, '&q=low');
    t.ok((await count(p)) === 3 && !dialogs.length, 'after the grace and a reload, the work in progress is still there');

    answer = true;
    dialogs.length = 0;
    await openSculpt(p, base, `&q=low&lib=${entry.id}`);
    st = await bootState(p);
    t.ok(dialogs.length === 1 && st.objects === 2, `Yes: the scene opens (${st.objects} objects)`);
    t.eq(await storedFrames(p), 0, 'and the reel of the work it replaced is gone with it');

    // From its card: the card asks, Sculpt does not ask again.
    await p.evaluate(() => window.__sculpt.persist.flush());
    await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.card--library .card__thumb', { timeout: 30_000 });
    dialogs.length = 0;
    await p.click('.card--library .card__thumb');
    await p.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    t.ok(dialogs.length === 1 && /^Open ".+"\? Your work in progress will be replaced\.$/.test(dialogs[0]), `opened from its card, the card asks and Sculpt does not ask again (${dialogs.join(' | ')})`);

    // An address with no id in it.
    dialogs.length = 0;
    await openSculpt(p, base, '&q=low&lib=..%2Fx');
    st = await bootState(p);
    t.ok(!dialogs.length && !/lib=/.test(st.search) && st.objects === 2, `lib=../x opens nothing, asks nothing, and leaves the address (${st.objects} objects)`);
    t.ok(!errors.length, `no page errors opening by address${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await ctx.close();
  }
}

// --- the service worker, the sign-in and signing out -------------------

/** A JPEG's first bytes: enough for a response the worker keeps. */
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

/** Poll `fn` in the page until it answers truthy; a navigation in between is no answer. */
async function until(page, fn, arg, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const v = await page.evaluate(fn, arg);
      if (v) return v;
    } catch {
      /* between documents */
    }
    await page.waitForTimeout(150);
  }
  return null;
}

/** What the page's caches hold: which exist, and the paths each keeps. */
const cacheState = (page) =>
  page.evaluate(async () => {
    const out = {};
    for (const name of await caches.keys()) {
      if (name.startsWith('workbox-precache')) continue;
      out[name] = (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname);
    }
    return out;
  });

/**
 * The installed app, with the owner's routes faked as Access and the
 * Functions answer them. The thumbnail rule keeps the public route's
 * pictures and not the gated one's; a sign-in check that finds the
 * session gone drops the owner's cached answers; the server's refusals
 * read as what they are; Sign out forgets the sign-in, drops the caches
 * and goes through Access's logout, after which the gallery is a guest's.
 * Offline, the worker answers the app's own pages and nothing else; and
 * ?nosw asks before it takes the worker out.
 */
async function workerAndSignOut(browser, base, t) {
  // The worker's own fetches reach the context's routes only with this,
  // read whenever Playwright attaches to a worker (they restart).
  const flag = 'PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS';
  const flagWas = process.env[flag];
  process.env[flag] = '1';
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const fake = fakeProjects();
  try {
    fake.add({ id: 'pub-reel', title: 'Public reel', mode: 'timelapse', visibility: 'public', frameCount: 3, thumb: JPEG });
    fake.add({ id: 'priv-reel', title: 'Private reel', mode: 'timelapse', visibility: 'private', frameCount: 2, thumb: JPEG });
    // A refusal to answer the next write with, as the Functions word theirs.
    let refusal = null;
    await ctx.route(fake.serves, (route) => {
      const req = route.request();
      if (refusal && req.method() !== 'GET') {
        const { status, error } = refusal;
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error }) });
      }
      return fake.handle(route);
    });
    // Access's logout, behind which the session ends: back to returnTo.
    const logouts = [];
    await ctx.route('**/cdn-cgi/access/logout*', (route) => {
      const u = new URL(route.request().url());
      logouts.push(u.pathname + u.search);
      fake.opts.expired = true;
      return route.fulfill({ status: 302, headers: { location: u.searchParams.get('returnTo') ?? '/' } });
    });
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    const dialogs = [];
    let answer = false;
    p.on('dialog', (d) => {
      dialogs.push(d.message());
      void (answer ? d.accept() : d.dismiss());
    });
    const chips = () => p.evaluate(() => [...document.querySelectorAll('.landing-chip')].map((c) => c.textContent).join(', '));
    const hasChip = (c) => [...document.querySelectorAll('.landing-chip')].some((el) => el.textContent === c);
    const gallery = async (chip) => {
      await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await until(p, hasChip, chip);
    };
    // The worker writes its caches after it has answered: wait for what is expected.
    const cachesUntil = async (ok) => {
      for (let i = 0; i < 40; i++) {
        const c = await cacheState(p).catch(() => ({}));
        if (ok(c)) return c;
        await p.waitForTimeout(250);
      }
      return cacheState(p);
    };

    await p.goto(`${base}/`, { waitUntil: 'load' });
    t.ok(await workerActivated(p), 'the worker installs');
    await gallery('Sign out');
    t.ok(/Projects, Sign out/.test(await chips()), `signed in, the top row has Projects and Sign out (${await chips()})`);
    await p.waitForFunction(() => document.querySelectorAll('.card__img').length >= 2 && [...document.querySelectorAll('.card__img')].every((i) => i.complete), null, { timeout: 30_000 }).catch(() => {});
    let caches = await cachesUntil((c) => (c['bozzetto-thumbs'] ?? []).length > 0 && (c['bozzetto-owner-projects'] ?? []).length > 0 && (c['bozzetto-whoami'] ?? []).length > 0);
    const thumbs = caches['bozzetto-thumbs'] ?? [];
    t.ok(thumbs.includes('/media/pub-reel/thumb.jpg') && !thumbs.some((x) => x.startsWith('/admin/')), `the worker keeps the public thumbnail and not the private one (${thumbs.join(', ')})`);
    t.ok((caches['bozzetto-owner-projects'] ?? []).includes('/admin/api/projects') && (caches['bozzetto-whoami'] ?? []).length === 1, 'and keeps the owner\'s list and sign-in for offline');
    const remembered = await p.evaluate(() => localStorage.getItem('bozzetto-signed-in'));
    t.ok(!!remembered && Object.keys(JSON.parse(remembered)).join() === 'at', `the device remembers when it was signed in, and not who (${remembered})`);

    // The server's refusals, in their own words.
    answer = true;
    const refusals = [
      [403, 'Cross-site request refused', 'The request was refused as coming from another site'],
      [415, 'expected a JSON body (content-type: application/json)', 'expected a JSON body (content-type: application/json)'],
      [503, 'Access verification is not configured', 'Access verification is not configured'],
    ];
    for (const [status, error, said] of refusals) {
      refusal = { status, error };
      dialogs.length = 0;
      await p.click('.card--owned[data-project="pub-reel"] .card__vis input');
      for (let i = 0; i < 40 && !dialogs.length; i++) await p.waitForTimeout(100);
      t.eq(dialogs[0] ?? '', `Could not change who sees "Public reel": ${said}`, `a ${status} says what the server said`);
    }
    refusal = null;

    // An old install kept a private thumbnail under the public rule: the next lapse of the sign-in drops it.
    await p.evaluate(() => caches.open('bozzetto-thumbs').then((c) => c.put('/admin/api/media/priv-reel/thumb.jpg?v=1', new Response('x', { headers: { 'content-type': 'image/jpeg' } }))));
    fake.opts.expired = true;
    await gallery('Log in');
    caches = await cacheState(p);
    t.ok(/Log in/.test(await chips()) && !('bozzetto-whoami' in caches) && !('bozzetto-owner-projects' in caches), `the sign-in expired, the owner's cached list and sign-in are gone (${Object.keys(caches).join(', ')})`);
    t.ok((caches['bozzetto-thumbs'] ?? []).includes('/media/pub-reel/thumb.jpg') && !(caches['bozzetto-thumbs'] ?? []).some((x) => x.startsWith('/admin/')), `and so is any private thumbnail, the public ones kept (${(caches['bozzetto-thumbs'] ?? []).join(', ')})`);
    t.ok(!!(await p.evaluate(() => document.querySelector('.landing__notice'))), 'and the gallery says the sign-in expired');

    // Sign out.
    fake.opts.expired = false;
    await gallery('Sign out');
    await p.waitForSelector('.card--owned', { timeout: 30_000 }).catch(() => {});
    t.ok('bozzetto-owner-projects' in (await cachesUntil((c) => 'bozzetto-owner-projects' in c)), 'signed in again, the list is kept again');
    dialogs.length = 0;
    await p.click('.landing-chip:text-is("Sign out")');
    for (let i = 0; i < 100 && !logouts.length; i++) await p.waitForTimeout(100);
    await p.waitForTimeout(500);
    await until(p, hasChip, 'Log in');
    caches = await cacheState(p);
    t.eq(logouts.join(', '), `/cdn-cgi/access/logout?returnTo=${encodeURIComponent(`${base}/`)}`, 'Sign out goes through Access\'s logout on this site, to come back to the gallery');
    t.ok(!('bozzetto-whoami' in caches) && !('bozzetto-owner-projects' in caches), `and the owner's cached answers are gone (${Object.keys(caches).join(', ')})`);
    const after = await p.evaluate(() => ({
      remembered: localStorage.getItem('bozzetto-signed-in'),
      notice: !!document.querySelector('.landing__notice'),
      owned: document.querySelectorAll('.card--owned, [data-project="priv-reel"]').length,
    }));
    t.ok(after.remembered === null && !after.notice, 'the sign-in is forgotten: no "expired" afterwards, the gallery is a guest\'s');
    t.ok(/Log in/.test(await chips()) && !/Sign out/.test(await chips()) && after.owned === 0, `with Log in, no Sign out and no private cards (${await chips()})`);
    t.eq(dialogs.join(' | '), '', 'and nothing was asked on the way');

    // The Projects page has it too.
    fake.opts.expired = false;
    await p.goto(`${base}/admin/`, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.admin-row', { timeout: 30_000 }).catch(() => {});
    t.ok(await p.evaluate(() => [...document.querySelectorAll('.topbar--right .topchip')].some((c) => c.textContent === 'Sign out')), 'the Projects page offers Sign out too');

    // Offline: the app's own pages, and nothing else.
    await gallery('Sign out');
    await ctx.setOffline(true);
    fake.opts.offline = true;
    const offline = async (path, ready) => {
      try {
        await p.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        return await p.waitForFunction(ready, null, { timeout: 90_000 }).then(() => true, () => false);
      } catch {
        return false;
      }
    };
    t.ok(await offline('/?sculpt=1&q=low', () => !!window.__sculpt), 'offline, the installed app boots Sculpt');
    t.ok(await offline('/create/', () => !!document.querySelector('#create .editor')), 'and the uploader');
    t.ok(!(await offline('/admin/', () => !!document.getElementById('admin'))), 'but the editor is not answered from the shell');
    t.ok(!(await offline('//elsewhere.example/', () => !!document.getElementById('app'))), 'nor is a path that is no page of the app');
    await ctx.setOffline(false);
    fake.opts.offline = false;

    // ?nosw asks; No keeps the worker, Yes takes it out.
    const registered = () => p.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    answer = false;
    dialogs.length = 0;
    await p.goto(`${base}/?nosw`, { waitUntil: 'load' });
    await p.waitForTimeout(500);
    const kept = { workers: await registered(), search: await p.evaluate(() => location.search), optOut: await p.evaluate(() => localStorage.getItem('bozzetto-no-sw')) };
    t.ok(/^Switch off offline use on this device\?/.test(dialogs[0] ?? '') && kept.workers === 1 && !kept.search && !kept.optOut, `?nosw asks first, and No leaves the worker (${dialogs[0]}; ${JSON.stringify(kept)})`);
    answer = true;
    await p.goto(`${base}/?nosw`, { waitUntil: 'load' }).catch(() => {});
    await until(p, () => location.search === '' && document.readyState === 'complete');
    await p.waitForTimeout(1000);
    t.ok((await registered()) === 0 && (await p.evaluate(() => localStorage.getItem('bozzetto-no-sw'))) === '1', 'Yes takes it out, and it stays out');
    await p.goto(`${base}/?sw`, { waitUntil: 'load' });
    t.ok(!errors.length, `no page errors in the installed app${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await ctx.close();
    if (flagWas === undefined) delete process.env[flag];
    else process.env[flag] = flagWas;
  }
}

// --- the single-file export ---------------------------------------------

/** The viewer bundle a single-file export inlines, built as `npm run build` builds it, into `outDir`. */
function buildEmbed(outDir) {
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const vite = join(repo, 'node_modules', 'vite', 'bin', 'vite.js');
  const args = [vite, 'build', '--config', 'vite.embed.config.ts', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'];
  return new Promise((ok, fail) => {
    const p = spawn(process.execPath, args, { cwd: repo, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', fail);
    p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`the embed build failed (${code}): ${err.slice(-1500)}`))));
  });
}

const POLICY =
  "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src blob: data:; " +
  "connect-src blob: data:; worker-src blob:; media-src blob:; base-uri 'none'; form-action 'none'";

/**
 * The uploader's export with the real viewer inlined: it carries the
 * policy, and opened from disk it plays - every frame, matcap and the
 * viewer's WebAssembly from inside the file - with nothing refused that
 * the file carries and no request leaving it.
 */
async function singleFile(browser, base, t) {
  const dir = mkdtempSync(join(tmpdir(), 'bozzetto-export-'));
  const ctx = await browser.newContext({ viewport: VIEWPORT, serviceWorkers: 'block' });
  try {
    await buildEmbed(join(dir, 'embed'));
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.route('**/embed/viewer.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: readFileSync(join(dir, 'embed', 'viewer.js')) }));
    await p.route('**/embed/embed.css', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: readFileSync(join(dir, 'embed', 'embed.css')) }));
    await p.goto(`${base}/create/`, { waitUntil: 'domcontentloaded' });
    const frames = [0, 1, 2, 3].map((i) => resolve(`dist/timelapses/demo/frames/sd/000${i}.glb`));
    await p.setInputFiles('#files', frames);
    await p.waitForFunction(() => !document.querySelector('#export-html').disabled, null, { timeout: 120_000 });
    const [download] = await Promise.all([p.waitForEvent('download', { timeout: 60_000 }), p.click('#export-html')]);
    const html = readFileSync(await download.path(), 'utf8');
    const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)" \/>/)?.[1] ?? null;
    t.eq(meta, POLICY, 'the export carries its Content-Security-Policy');
    t.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'ahead of every script in the file');

    const file = join(dir, 'export.html');
    writeFileSync(file, html);
    // The uploader's preview renders on: closed, it leaves the export the machine.
    await p.close();
    const view = await ctx.newPage();
    const viewErrors = [];
    view.on('pageerror', (e) => viewErrors.push(String(e)));
    const requests = [];
    view.on('request', (r) => {
      if (!/^(file|blob|data):/.test(r.url())) requests.push(r.url());
    });
    await view.addInitScript(() => {
      window.__violations = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.effectiveDirective} ${e.blockedURI}`));
    });
    await view.goto(pathToFileURL(file).href, { waitUntil: 'commit' });
    await view.waitForFunction(() => !!window.__bozzetto?.timeline && !document.getElementById('overlay'), null, { timeout: 180_000 });
    const first = await view.evaluate(() => window.__bozzetto.timeline.frameIndex());
    const seen = new Set([first]);
    for (let i = 0; i < 40 && seen.size < 3; i++) {
      await view.waitForTimeout(250);
      seen.add(await view.evaluate(() => window.__bozzetto.timeline.frameIndex()));
    }
    const played = await view.evaluate(() => ({
      playing: window.__bozzetto.timeline.playing,
      frames: window.__bozzetto.manifest.config.frameCount,
      violations: window.__violations,
    }));
    t.ok(played.playing && played.frames === 4 && seen.size >= 2, `opened from disk, it plays: frames ${[...seen].join(', ')} of ${played.frames}`);
    // What the file does not carry (its fonts, the matcap picker's
    // thumbnails) is refused where it would only have failed to load.
    const refused = played.violations.filter((v) => !/ file(:|$)/.test(v));
    t.ok(!refused.length, `the policy refuses nothing the file carries${refused.length ? `: ${refused.join(', ')}` : ` (${played.violations.length} refusals of files it does not carry)`}`);
    t.ok(!requests.length, `and nothing leaves the file${requests.length ? `: ${requests.join(', ')}` : ''}`);
    t.ok(!errors.length && !viewErrors.length, `no page errors exporting or playing${[...errors, ...viewErrors].length ? `: ${[...errors, ...viewErrors].join(' | ')}` : ''}`);
  } finally {
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- the suite ----------------------------------------------------------

export const suites = {
  async hardening(page, base, t) {
    const browser = page.context().browser();
    await page.addInitScript(bozzTools);
    // Each part on its own, so one that throws is reported and the rest
    // still run; and with this page blank between them, so nothing left
    // rendering here (a timelapse playing on a software renderer) slows
    // the pages the next part opens.
    const part = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        t.ok(false, `${name} threw: ${e?.stack ?? e}`);
      }
      await page.goto('about:blank').catch(() => {});
    };
    await part('scene files', () => sceneFiles(page, base, t));
    await part('looks and models', () => looksAndModels(page, base, t));
    await part('opening by address', () => openByAddress(browser, base, t));
    await part('the worker and signing out', () => workerAndSignOut(browser, base, t));
    await part('the single-file export', () => singleFile(browser, base, t));
  },
};
