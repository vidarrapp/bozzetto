// Makes the old-scene fixtures of the tint suite. Run it against a test build
// of the code BEFORE the tint change (v0.7.0), never against a newer one:
//
//   node tests/e2e/fixtures/tint/make-old-fixtures.mjs <dist of that build> <out dir>
//
// It writes old-scene.bozz (three spheres: A painted with the vendor's own
// strokes and no layers, B painted into a paint layer over its Base, C
// unpainted, A and C sharing one material) and old-scene.json, what that code
// showed: the top level's colours at some vertices of each object and the
// rendered pixels near each object's centre. The suite opens the .bozz with
// the current code and compares.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch, serve } from '../../lib.mjs';
import { openForInput } from '../../smoke.mjs';

const [dist, out] = process.argv.slice(2);
if (!dist || !out) throw new Error('usage: make-old-fixtures.mjs <dist> <out dir>');
mkdirSync(out, { recursive: true });
const server = await serve(resolve(dist));
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    window.__bozzettoAdaptiveOff = true;
    try {
      localStorage.setItem('bozzetto-device-choice', 'keep');
    } catch {
      /* none */
    }
  });
  const page = await ctx.newPage();
  await openForInput(page, server.base);
  await page.evaluate(() => {
    const S = window.__sculpt;
    const { session, library } = S;
    const strokeAt = (mesh, rgb, dx, dy) => {
      // A vendor paint stroke straight across the object's middle, as the paint workspace's tests make one.
      const mgr = session.getSculptManager();
      mgr._symmetry = false;
      mgr.setToolIndex(8);
      const t = mgr.getTool(8);
      t._color[0] = rgb[0];
      t._color[1] = rgb[1];
      t._color[2] = rgb[2];
      t._radius = 60;
      t._intensity = 1;
      S.tablet.pressure = 0.5;
      S.tablet.pen = false;
      const b = mesh.computeWorldBound();
      const [cx, cy] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
      const x0 = cx + dx - 40;
      const y = cy + dy;
      session._mouseX = x0;
      session._mouseY = y;
      if (!mgr.start(false)) return false;
      const picking = session.getPicking();
      for (let i = 1; i <= 5; i++) {
        const x = x0 + 16 * i;
        session._mouseX = x;
        t.makeStroke(x, y, picking, null);
      }
      t.updateRender();
      mgr.end();
      session.getStateManager().cleanNoop();
      return true;
    };
    window.__make = { strokeAt };
    // Material 1 (Clay) in an orange; a second material in a blue.
    const m1 = library.list()[0];
    library.update(m1.id, { albedo: '#c46a3a' });
    const m2 = library.create('Blue');
    library.update(m2.id, { albedo: '#3a6fd5' });
    const A = session.getMesh();
    const b = A.computeWorldBound();
    const w = b[3] - b[0];
    const B = session.addSphere();
    B.getMatrix()[12] += w * 1.4;
    const C = session.addSphere();
    C.getMatrix()[12] -= w * 1.4;
    library.assign(B, m2.id);
    window.__make.objs = { A, B, C };
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__sculpt.input.hooks.frameAll());
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const { session, library } = window.__sculpt;
    const { A, B } = window.__make.objs;
    const m = window.__make;
    // A: painted, no layers.
    session.setMesh(A);
    m.strokeAt(A, [0.1, 0.35, 0.9], 0, 0);
    library.markPainted(A);
    // B: a paint layer over its Base.
    session.setMesh(B);
    session.paint.add(B);
    m.strokeAt(B, [0.9, 0.15, 0.1], 0, 0);
    library.markPainted(B);
  });
  // The frame eases in for several seconds after a change: the pixels are read once it has settled.
  await page.waitForTimeout(6000);
  const record = await page.evaluate(async () => {
    const { session, file } = window.__sculpt;
    const meshes = session.getMeshes();
    const colours = meshes.map((mesh) => {
      const top = mesh._meshes ? mesh._meshes[mesh._meshes.length - 1] : mesh;
      const n = top.getNbVertices();
      const c = top.getColors();
      const ids = [];
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 150))) ids.push(i);
      return { n, ids, rgb: ids.map((i) => [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]]) };
    });
    const bytes = new Uint8Array(await file.pack());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const lib = window.__sculpt.library;
    return { colours, bozz: btoa(bin), materials: lib.list(), painted: meshes.map((m) => lib.isPainted(m)) };
  });
  // What that code shows when it opens the file, as a person opens it (the look the file carries
  // is applied): a fresh page, the same steps the suite takes, read once the frame has settled.
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx2.addInitScript(() => {
    window.__bozzettoAdaptiveOff = true;
    try {
      localStorage.setItem('bozzetto-device-choice', 'keep');
    } catch {
      /* none */
    }
  });
  const page2 = await ctx2.newPage();
  await openForInput(page2, server.base);
  await page2.evaluate(async (b64) => {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    await window.__sculpt.file.open(u.buffer);
  }, record.bozz);
  await page2.waitForTimeout(500);
  await page2.evaluate(() => window.__sculpt.input.hooks.frameAll());
  await page2.waitForTimeout(5000);
  record.pixels = await page2.evaluate(async () => {
    const { session, viewer } = window.__sculpt;
    const sample = async () => {
      const out = [];
      for (const mesh of session.getMeshes()) {
        const b = mesh.computeWorldBound();
        const [cx, cy] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
        const row = [];
        for (const dx of [-24, 0, 24]) {
          const x = Math.round(cx + dx);
          const y = Math.round(cy);
          row.push({ x, y, hex: await viewer.samplePixel(x, y) });
        }
        out.push(row);
      }
      return out;
    };
    let a = await sample();
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const b = await sample();
      const same = a.every((row, k) => row.every((p, j) => p.hex === b[k][j].hex));
      a = b;
      if (same) break;
    }
    return a;
  });
  const { bozz, ...json } = record;
  writeFileSync(join(out, 'old-scene.bozz'), Buffer.from(bozz, 'base64'));
  writeFileSync(join(out, 'old-scene.json'), JSON.stringify(json));
  console.log('wrote', out, JSON.stringify(json.painted), JSON.stringify(json.pixels));
} finally {
  await browser.close();
  server.close();
}
