// Import model: .obj, .glb, .stl and .ply (and a self-contained .gltf)
// import from File > Import model… and from the gallery's Create > Import
// model, each a cube here (importModelFixtures.mjs): one connected object
// of the cube's 8 vertices after welding, at the size the OBJ gives, the
// GLB's node transform applied; a file that cannot be read is refused with
// its reason and the scene stays as it was; the loaders come only when a
// file needs them; the gallery's Create choices read New scene, New
// armature, Import model (and Create timelapse for the owner alone).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSculpt } from './lib.mjs';
import { chooseFile, fakeProjects } from './smoke.mjs';
import { CORNERS, writeFixtures } from './importModelFixtures.mjs';

/** The level 0 of the newest object: its counts, and the box of its vertices. */
const level0 = (page) =>
  page.evaluate(() => {
    const s = window.__sculpt.session;
    const ms = s.getMeshes();
    const m = ms[ms.length - 1];
    const l0 = m._meshes[0];
    const v = l0.getVertices();
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < l0.getNbVertices(); i++) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], v[i * 3 + k]);
        max[k] = Math.max(max[k], v[i * 3 + k]);
      }
    }
    const f = l0.getFaces();
    let quads = 0;
    for (let i = 0; i < l0.getNbFaces(); i++) if (f[i * 4 + 3] !== 4294967295) quads++;
    return {
      objects: ms.length,
      names: ms.map((x) => s.getMeshName(x)),
      verts: l0.getNbVertices(),
      faces: l0.getNbFaces(),
      quads,
      min: min.map((x) => Math.round(x * 1e4) / 1e4),
      max: max.map((x) => Math.round(x * 1e4) / 1e4),
    };
  });

/** A cube's level 0: 8 vertices, joined (a closed surface), as 12 triangles or 6 quads. */
const isCube = (c) => c.verts === 8 && ((c.faces === 12 && c.quads === 0) || (c.faces === 6 && c.quads === 6));

const LOADERS = /STLLoader|PLYLoader/;

export const suites = {
  async importModel(page, base, t) {
    const dir = mkdtempSync(join(tmpdir(), 'bozzetto-model-'));
    const files = writeFixtures(dir);
    const asked = [];
    page.on('dialog', (d) => {
      asked.push(d.message());
      void d.accept();
    });
    const requested = [];
    page.on('request', (r) => requested.push(r.url()));
    const loadersSeen = () => requested.filter((u) => LOADERS.test(u)).map((u) => (/STLLoader/.test(u) ? 'stl' : 'ply'));
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // --- File > Import model… ------------------------------------------------------------
    await openSculpt(page, base);
    t.ok((await page.evaluate(() => window.__sculpt.fileMenu.items().some((i) => i.label === 'Import model…'))), 'File has Import model…');
    t.ok(!(await page.evaluate(() => window.__sculpt.fileMenu.items().some((i) => /^(New sculpt|Import OBJ)/.test(i.label)))), 'and no longer New sculpt or Import OBJ');
    t.ok(await page.evaluate(() => window.__sculpt.fileMenu.items().some((i) => i.label === 'New scene')), 'and New scene');
    t.eq(loadersSeen().length, 0, 'the STL and PLY loaders are not fetched by opening Sculpt');

    const fromMenu = async (name) => {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 30_000 }), chooseFile(page, 'Import model…')]);
      const before = (await level0(page)).objects;
      await chooser.setFiles(files[name]);
      await page.waitForFunction((n) => window.__sculpt.session.getMeshes().length > n, before, { timeout: 60_000 });
      return level0(page);
    };
    const bounds = {};
    for (const [name, label] of [
      ['cube.obj', 'OBJ'],
      ['cube.stl', 'binary STL'],
      ['cube ascii.stl', 'ASCII STL'],
      ['cube.ply', 'binary PLY'],
      ['cube ascii.ply', 'ASCII PLY'],
      ['cube.glb', 'GLB'],
    ]) {
      if (name === 'cube.stl') t.eq(loadersSeen().join(','), '', 'before the first STL, no STL or PLY loader has been fetched');
      if (name === 'cube.ply') t.eq(loadersSeen().join(','), 'stl', 'after an STL, only the STL loader is fetched, the PLY one waits for a PLY');
      const c = await fromMenu(name);
      bounds[name] = c;
      t.ok(isCube(c), `File > Import model reads a ${label} cube as one connected object of 8 vertices (${JSON.stringify(c)})`);
      t.ok(c.names[c.names.length - 1].startsWith(name.replace(/\.\w+$/, '')), `${label}: the object is named after the file (${c.names[c.names.length - 1]})`);
    }
    t.eq(loadersSeen().join(','), 'stl,ply', 'each loader came when its format was first used');
    const ref = bounds['cube.obj'];
    t.eq(JSON.stringify([ref.min, ref.max]), JSON.stringify([[-1, -1, -1], [1, 1, 1]]), 'the OBJ cube keeps its own size');
    for (const name of ['cube.stl', 'cube ascii.stl', 'cube.ply', 'cube ascii.ply']) {
      t.eq(JSON.stringify([bounds[name].min, bounds[name].max]), JSON.stringify([ref.min, ref.max]), `${name} is the size the OBJ is`);
    }
    t.eq(
      JSON.stringify([bounds['cube.glb'].min, bounds['cube.glb'].max]),
      JSON.stringify([[9, -1, -1], [11, 1, 1]]),
      "the GLB's node transform is applied (moved 10 along x, scaled by 2)",
    );

    // A broken file of each kind says why and leaves the scene as it was.
    const reasons = {
      'broken.obj': /No geometry found in that OBJ file/,
      'broken.glb': /\.glb file is not readable/,
      'broken.stl': /\.stl file is not readable\. It is damaged/,
      'broken.ply': /\.ply file/,
      'outside.gltf': /needs other files beside it/,
    };
    for (const [name, reason] of Object.entries(reasons)) {
      const before = await level0(page);
      asked.length = 0;
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 30_000 }), chooseFile(page, 'Import model…')]);
      await chooser.setFiles(files[name]);
      await page.waitForFunction(() => !!document.querySelector('.bz-ask'), null, { timeout: 30_000 }).catch(() => {});
      for (let i = 0; i < 40 && !asked.length; i++) await page.waitForTimeout(250);
      const after = await level0(page);
      t.ok(
        asked.length === 1 && asked[0].startsWith('That file did not import') && reason.test(asked[0]),
        `${name} is refused with its reason (${asked.join(' | ')})`,
      );
      t.eq(JSON.stringify(after), JSON.stringify(before), `${name}: the scene is as it was`);
    }
    t.eq(errors.length, 0, `no page errors (${errors.join(' | ')})`);

    // --- the gallery's Create > Import model ---------------------------------------------
    const pick = async (name) => {
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#landing-grid .card--new', { timeout: 30_000 });
      await page.click('#landing-grid .card--new');
      await page.setInputFiles('.create-overlay .create-obj-input', files[name]);
    };
    // The autosave is written a moment after the import: wait for it, or the next import has nothing to replace.
    const kept = async (since) => {
      const savedAt = () =>
        page.evaluate(
          () =>
            new Promise((done) => {
              const req = indexedDB.open('bozzetto-sculpt');
              req.onerror = () => done(0);
              req.onsuccess = () => {
                const get = req.result.transaction('scene').objectStore('scene').get('current');
                get.onsuccess = () => done(get.result?.savedAt ?? 0);
                get.onerror = () => done(0);
              };
            }),
        );
      const end = Date.now() + 90_000;
      while ((await savedAt()) < since) {
        if (Date.now() > end) throw new Error('the scene was never kept on this device');
        await page.waitForTimeout(500);
      }
    };
    const booted = () => page.waitForFunction(() => !!window.__sculpt && !document.getElementById('overlay'), null, { timeout: 90_000 });
    const galleryBounds = {};
    for (const [name, label] of [
      ['cube.obj', 'OBJ'],
      ['cube.stl', 'binary STL'],
      ['cube ascii.stl', 'ASCII STL'],
      ['cube.ply', 'binary PLY'],
      ['cube ascii.ply', 'ASCII PLY'],
      ['cube.glb', 'GLB'],
    ]) {
      const since = Date.now();
      await pick(name);
      await page.waitForURL((u) => u.searchParams.get('sculpt') === '1', { timeout: 30_000 });
      await booted();
      const c = await level0(page);
      await kept(since);
      galleryBounds[name] = c;
      t.ok(c.objects === 1 && isCube(c), `Create > Import model reads a ${label} cube as the scene's one object of 8 vertices (${JSON.stringify(c)})`);
    }
    for (const name of ['cube.stl', 'cube ascii.stl', 'cube.ply', 'cube ascii.ply']) {
      t.eq(JSON.stringify([galleryBounds[name].min, galleryBounds[name].max]), JSON.stringify([galleryBounds['cube.obj'].min, galleryBounds['cube.obj'].max]), `from the gallery ${name} is the size the OBJ is`);
    }
    t.eq(JSON.stringify([galleryBounds['cube.glb'].min, galleryBounds['cube.glb'].max]), JSON.stringify([[9, -1, -1], [11, 1, 1]]), "from the gallery the GLB's transform is applied");

    // A file that cannot be read: the gallery goes to Sculpt, which says why and keeps the work there was (the GLB cube).
    for (const [name, reason] of [
      ['broken.glb', /\.glb file is not readable/],
      ['broken.ply', /\.ply file/],
      ['broken.stl', /\.stl file/],
    ]) {
      await pick(name);
      await page.waitForURL((u) => u.searchParams.get('sculpt') === '1', { timeout: 30_000 });
      await booted();
      await page.waitForSelector('.file-menu__progress[data-state="failed"]', { state: 'attached', timeout: 30_000 });
      const say = await page.evaluate(() => [...document.querySelectorAll('.file-menu__progress[data-state="failed"]')].map((e) => e.textContent).join(' | '));
      await page.waitForFunction(() => window.__sculpt.session.getMeshes().length > 0, null, { timeout: 30_000 });
      const c = await level0(page);
      t.ok(reason.test(say) && say.startsWith('Could not import'), `${name} from the gallery says why (${say})`);
      t.eq(JSON.stringify([c.objects, c.min, c.max]), JSON.stringify([1, [9, -1, -1], [11, 1, 1]]), `${name}: the work on the device is as it was`);
    }

    // --- the gallery's Create choices --------------------------------------------------------
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#landing-grid .card--new', { timeout: 30_000 });
    await page.click('#landing-grid .card--new');
    const guest = await page.evaluate(() => ({
      titles: [...document.querySelectorAll('.create-overlay .create-choice__title')].map((e) => e.textContent).join(', '),
      hint: document.querySelector('.create-overlay [data-kind="obj"] .create-choice__hint')?.textContent ?? '',
      accept: document.querySelector('.create-overlay .create-obj-input')?.accept ?? '',
    }));
    t.eq(guest.titles, 'New scene, New armature, Import model', 'a guest is offered New scene, New armature and Import model');
    t.ok(/\.obj/.test(guest.hint) && /\.glb/.test(guest.hint) && /\.stl/.test(guest.hint) && /\.ply/.test(guest.hint), `Import model's hint names the formats (${guest.hint})`);
    t.ok(guest.accept.split(',').sort().join(',') === '.glb,.gltf,.obj,.ply,.stl', `and the picker offers them (${guest.accept})`);
    t.eq(errors.length, 0, `no page errors on the way (${errors.join(' | ')})`);
  },

  // The owner sees a fourth choice, Create timelapse; nobody else does.
  async importModelOwner(page, base, t) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    try {
      const p = await ctx.newPage();
      const fake = fakeProjects();
      await ctx.route(fake.serves, fake.handle);
      await p.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('#landing-grid .card--new', { timeout: 30_000 });
      await p.click('#landing-grid .card--new');
      const titles = await p.evaluate(() => [...document.querySelectorAll('.create-overlay .create-choice__title')].map((e) => e.textContent).join(', '));
      t.eq(titles, 'New scene, New armature, Import model, Create timelapse', 'the owner is offered Create timelapse as a fourth choice');
    } finally {
      await ctx.close();
    }
  },
};
