// Level 0 of an object imported from OBJ keeps the file's numbering
// (owner decision), and File > Export OBJ, with that object selected,
// writes it back in that numbering: every v line in the file's order, loose ones
// included, the vt lines as they were, the faces whole (quads, the
// pentagon), and the o/g/usemtl/s/mtllib lines where they stood. Through
// both ways in (the gallery's Create > Import OBJ and File > Import OBJ),
// with Z-up on, after edits at level 0 and above, Set scale, a .bozz save
// and the autosave; refused once a remesh or a merge has rebuilt the
// topology, where Export OBJ writes the triangles with a note saying why.
// Any other object exports its triangles as before.
import { gunzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSculpt } from './lib.mjs';

const STALE = "This object's topology has changed since it was imported, so its original numbering is gone. Use Export OBJ instead.";

/**
 * A pentagonal prism in a Z-up file's own units, its vertices out of
 * order: a bottom and a top pentagon, five side quads, one corner of the
 * top written twice (a seam: the last side quad uses the copy, which the
 * import welds to the first), two vertices no face uses, vt lines in
 * their own spelling, normals the export leaves out, and the lines that
 * name things.
 */
export function prism() {
  const named = {};
  for (let i = 0; i < 5; i++) {
    const a = (Math.PI * 2 * i) / 5;
    const x = (50 + 10 * Math.cos(a)).toFixed(4);
    const y = (20 + 10 * Math.sin(a)).toFixed(4);
    named[`B${i}`] = `${x} ${y} 0.0000`;
    named[`T${i}`] = `${x} ${y} 30.0000`;
  }
  named.S = named.T0; // the seam's copy of T0
  named.L1 = '7.2500 -3.5000 12.0000';
  named.L2 = '61.0000 44.1250 -8.7500';
  const order = ['T3', 'L1', 'B0', 'S', 'B4', 'T1', 'B2', 'T0', 'L2', 'B3', 'T4', 'B1', 'T2'];
  const id = (n) => order.indexOf(n) + 1;
  const vt = ['vt 0 0', 'vt 0.25 0', 'vt 0.5000 0', 'vt 0.75 0.0', 'vt 1 0', 'vt 0 1', 'vt 0.25 1', 'vt 0.5 1', 'vt 0.75 1', 'vt 1 1', 'vt 0.1 0.2 0', 'vt 0.9 0.8 0'];
  const faces = [
    // caps: v/vt/vn
    `f ${[0, 4, 3, 2, 1].map((i) => `${id(`B${i}`)}/11/1`).join(' ')}`,
    `f ${[0, 1, 2, 3, 4].map((i) => `${id(`T${i}`)}/12/2`).join(' ')}`,
  ];
  const sides = [];
  for (let i = 0; i < 5; i++) {
    const j = (i + 1) % 5;
    const tj = j === 0 ? 'S' : `T${j}`;
    // One side without texture coordinates (v//vn), the rest v/vt.
    sides.push(i === 2 ? `f ${id(`B${i}`)}//3 ${id(`B${j}`)}//3 ${id(tj)}//3 ${id(`T${i}`)}//3` : `f ${id(`B${i}`)}/${i + 1} ${id(`B${j}`)}/${i + 2} ${id(tj)}/${i + 7} ${id(`T${i}`)}/${i + 6}`);
  }
  const lines = [
    '# a prism',
    'mtllib prism.mtl',
    'o Prism',
    ...order.map((n) => `v ${named[n]}`),
    ...vt,
    'vn 0 0 -1',
    'vn 0 0 1',
    'vn 1 0 0',
    'g caps',
    'usemtl clay',
    ...faces,
    'g sides',
    's 1',
    ...sides,
    '',
  ];
  return { text: lines.join('\n'), order, id, named };
}

/** The lines of an OBJ by kind: v as numbers, vt as written, and the rest (faces without their normals) in order. */
function read(text) {
  const v = [];
  const vt = [];
  const rest = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('v ')) v.push(line.split(/\s+/).slice(1).map(Number));
    else if (line.startsWith('vt ')) vt.push(line);
    else if (line.startsWith('vn ')) continue;
    else if (line.startsWith('f ')) {
      // v/vt/vn -> v/vt, v//vn -> v: the export writes no normals.
      rest.push(
        `f ${line
          .split(/\s+/)
          .slice(1)
          .map((tok) => {
            const [a, b] = tok.split('/');
            return b ? `${a}/${b}` : a;
          })
          .join(' ')}`,
      );
    } else rest.push(line);
  }
  return { v, vt, rest };
}

/** The largest gap between two lists of positions, or Infinity when they differ in length. */
const gap = (a, b) =>
  a.length !== b.length ? Infinity : Math.max(0, ...a.map((p, i) => Math.max(...p.map((x, k) => Math.abs(x - b[i][k])))));

export const suites = {
  async objNumbering(page, base, t) {
    const { text, order, id, named } = prism();
    const file = read(text);
    const TOL = 2e-3; // file units; the prism is 30 tall
    const exportOriginal = (p = page) =>
      p.evaluate(() => {
        try {
          return { text: window.__sculpt.fileActions.originalObj().text };
        } catch (err) {
          return { error: String(err?.message ?? err) };
        }
      });
    const same = (out, what) => {
      if (out.error) {
        t.ok(false, `${what}: export threw (${out.error})`);
        return;
      }
      const got = read(out.text);
      t.ok(gap(got.v, file.v) < TOL, `${what}: the same ${file.v.length} v lines, in the file's order and units (largest gap ${gap(got.v, file.v)})`);
      t.eq(got.vt.join('|'), file.vt.join('|'), `${what}: the same vt lines, as written`);
      t.eq(got.rest.join('|'), file.rest.join('|'), `${what}: the same faces, whole, with the lines that name things where they stood`);
    };
    const booted = (p) => p.waitForFunction(() => !!window.__sculpt && !document.getElementById('overlay'), null, { timeout: 90_000 });
    page.on('dialog', (d) => void d.accept());

    // --- the File menu: one Export OBJ, the triangles on a sphere -------------------------
    await openSculpt(page, base);
    // Read with the menu open, as a person sees it: it paints on opening.
    const menuItem = () =>
      page.evaluate(() => {
        const menu = window.__sculpt.fileMenu;
        menu.open();
        const all = [...document.querySelectorAll('.file-menu--file .file-menu__item')];
        const exports = all.filter((x) => /Export OBJ/.test(x.textContent));
        const b = exports[0];
        const out = b ? { count: exports.length, label: b.querySelector('.file-menu__label')?.textContent ?? b.textContent, hint: b.querySelector('.file-menu__hint')?.textContent ?? '' } : null;
        menu.close();
        return out;
      });
    // File > Export OBJ clicked: the download's name and text, and any note it shows.
    const clickExport = async () => {
      await page.evaluate(() => document.querySelectorAll('.file-menu__note').forEach((n) => n.remove()));
      await page.evaluate(() => window.__sculpt.fileMenu.open());
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 10_000 }).catch(() => null),
        page.evaluate(() => [...document.querySelectorAll('.file-menu--file .file-menu__item')].find((x) => /Export OBJ/.test(x.textContent)).click()),
      ]);
      if (!dl) return null;
      const path = await dl.path();
      const note = await page.evaluate(() => document.querySelector('.file-menu__note')?.textContent ?? '');
      return { name: dl.suggestedFilename(), text: path ? readFileSync(path, 'utf8') : '', note };
    };
    const TRI = /^# Bozzetto sculpt export\n/;
    let item = await menuItem();
    t.ok(
      item && item.count === 1 && item.label === 'Export OBJ' && /triangles/.test(item.hint),
      `File has one Export OBJ, its hint saying the triangles for an object that was not imported (${JSON.stringify(item)})`,
    );
    const triBefore = await page.evaluate(() => window.__sculpt.file.toOBJ());
    let dl = await clickExport();
    t.ok(
      dl && dl.text === triBefore && /\.obj$/.test(dl.name) && !dl.note,
      `on a sphere it downloads the triangles under a stamped name, with no note (${dl?.name}, ${JSON.stringify(dl?.note)})`,
    );

    // --- File > Import OBJ, Z-up on, into a scene on real units ----------------------
    await page.evaluate(async (src) => window.__sculpt.fileActions.importObj(src, true, 'Prism file'), text);
    t.eq(await page.evaluate(() => window.__sculpt.fileActions.originalStatus()), 'valid', 'File > Import OBJ keeps a record of the file');
    const counts = await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      const l0 = m._meshes[0];
      let quads = 0;
      const f = l0.getFaces();
      for (let i = 0; i < l0.getNbFaces(); i++) if (f[i * 4 + 3] !== 4294967295) quads++;
      return { verts: l0.getNbVertices(), faces: l0.getNbFaces(), quads, levels: m._meshes.length, sel: m._sel };
    });
    // 13 file vertices: two loose, the seam welded, so 10 at level 0; the
    // five quads stay quads, and each pentagon is a quad and a triangle.
    t.ok(
      counts.verts === 10 && counts.quads === 7 && counts.faces === 9 && counts.sel === counts.levels - 1,
      `level 0 is the file's: 10 vertices (the seam welded, the loose ones kept aside), the quads as quads, every level kept (${JSON.stringify(counts)})`,
    );
    same(await exportOriginal(), 'File > Import OBJ then export');
    item = await menuItem();
    t.eq(item?.hint, 'Level 0 of "Prism file", numbered as the imported file', 'with the imported object selected, the hint says the numbered export');
    dl = await clickExport();
    t.eq(dl?.name, 'Prism file.obj', 'Export OBJ downloads <object>.obj');
    if (dl) same({ text: dl.text }, 'File > Export OBJ, clicked');
    t.ok(dl && !dl.note, 'with no note');

    // Every vertex moved by one map, written into the level on screen:
    // each v line is where its own vertex went, in the file's units with
    // Z-up undone; the welded pair both at the one place; the loose ones
    // where the file had them.
    await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      const v = m.getVertices();
      for (let i = 0; i < m.getNbVertices(); i++) {
        const [x, y, z] = [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
        // local = (fx, fz, -fy): shear x by local y, lift y, squash z
        v[i * 3] = x + 0.5 * y + 1.5;
        v[i * 3 + 1] = 1.25 * y - 2;
        v[i * 3 + 2] = 0.8 * z + 0.1 * x;
      }
      m.updateGeometry();
      m.updateBuffers();
    });
    let out = await exportOriginal();
    {
      // The same map in file space: local (X, Y, Z) = (fx, fz, -fy).
      const expect = file.v.map((p, i) => {
        if (order[i] === 'L1' || order[i] === 'L2') return p;
        const [X, Y, Z] = [p[0], p[2], -p[1]];
        const [x2, y2, z2] = [X + 0.5 * Y + 1.5, 1.25 * Y - 2, 0.8 * Z + 0.1 * X];
        return [x2, -z2, y2];
      });
      const got = read(out.text ?? '');
      t.ok(gap(got.v, expect) < TOL, `edited, each v line is its own vertex moved, in file units with Z-up undone (largest gap ${gap(got.v, expect)})`);
      const s = got.v[id('S') - 1];
      const t0 = got.v[id('T0') - 1];
      t.ok(s && t0 && gap([s], [t0]) < 1e-9, 'the welded pair exports twice, at the one moved place');
      t.ok(gap([got.v[id('L1') - 1], got.v[id('L2') - 1]], [file.v[id('L1') - 1], file.v[id('L2') - 1]]) < 1e-6, 'the loose vertices stay as the file had them');
      t.eq(got.rest.join('|'), file.rest.join('|'), 'and the faces are as they were');
    }
    await page.evaluate(() => window.__sculpt.session.deleteMesh(window.__sculpt.session.getMesh()));

    // --- the gallery's Create > Import OBJ, Z-up on (the handoff carries the switch) ----------
    const handoff = (p, src) =>
      p.evaluate(
        (s) =>
          new Promise((done, fail) => {
            const req = indexedDB.open('bozzetto-sculpt');
            req.onsuccess = () => {
              const tx = req.result.transaction('scene', 'readwrite');
              tx.objectStore('scene').put({ kind: 'bozzetto-obj', v: 1, id: 'prism0001', name: 'Prism', text: s, zUp: true, savedAt: Date.now() }, 'objHandoff');
              tx.oncomplete = () => done(true);
              tx.onerror = () => fail(tx.error);
            };
            req.onerror = () => fail(req.error);
          }),
        src,
      );
    await handoff(page, text);
    await page.goto(`${base}/?sculpt=1&obj=1`, { waitUntil: 'domcontentloaded' });
    await booted(page);
    t.ok(
      await page.evaluate(() => window.__sculpt.session.getMeshes().length === 1 && window.__sculpt.session.getUnits() === null),
      'the gallery path opens the file as an unmarked scene of its own',
    );
    same(await exportOriginal(), 'Create > Import OBJ then export');

    // A stroke at the top level: the vertices under it move, the rest stay.
    const stroke = async () => {
      const [x, y] = await page.evaluate(() => {
        const { session, viewer } = window.__sculpt;
        const b = session.getMesh().computeWorldBound();
        const [px, py] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
        const r = viewer.captureCanvas.getBoundingClientRect();
        const pr = session.getPixelRatio();
        return [r.left + px / pr, r.top + py / pr];
      });
      await page.mouse.move(x - 20, y);
      await page.mouse.down();
      await page.mouse.move(x + 20, y + 6, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    };
    const levelSum = () =>
      page.evaluate(() => {
        const m = window.__sculpt.session.getMesh();
        let s = 0;
        const v = m.getVertices();
        for (let i = 0; i < m.getNbVertices() * 3; i++) s += v[i] * ((i % 5) + 1);
        return { s, sel: m._sel, levels: m._meshes.length };
      });
    await stroke();
    out = await exportOriginal();
    let got = read(out.text ?? '');
    const shift = got.v.map((p, i) => Math.hypot(...p.map((x, k) => x - file.v[i][k])));
    {
      const loose = [id('L1') - 1, id('L2') - 1];
      const used = shift.filter((_, i) => !loose.includes(i));
      const most = Math.max(...used);
      t.ok(
        most > 0.03 && Math.min(...used) < most / 2 && loose.every((i) => shift[i] === 0),
        `a stroke at the top level moves the level-0 vertices under it, the nearest most, and not the loose ones (${shift.map((d) => d.toFixed(3)).join(' ')})`,
      );
    }
    t.ok(gap([got.v[id('S') - 1]], [got.v[id('T0') - 1]]) < 1e-9, 'the welded pair still exports at one place');
    t.eq(got.rest.join('|'), file.rest.join('|'), 'the faces as they were');

    // Exporting leaves the work as it was: the level, and every vertex on it.
    const before = await levelSum();
    await exportOriginal();
    const after = await levelSum();
    t.ok(before.s === after.s && before.sel === after.sel, `exporting changes nothing on screen (${JSON.stringify([before, after])})`);

    // One more level, sculpted there: level 0 shows it too.
    const atTwo = got.v;
    await page.evaluate(() => window.__sculpt.session.subdivide());
    await stroke();
    out = await exportOriginal();
    got = read(out.text ?? '');
    t.ok(gap(got.v, atTwo) > 0.01, `a stroke on a new higher level reaches level 0 (largest change ${gap(got.v, atTwo)})`);
    // Seen from level 0, the export is the same.
    const fromTop = got.v;
    await page.evaluate(() => window.__sculpt.session.selectLevel(0));
    out = await exportOriginal();
    got = read(out.text ?? '');
    t.ok(gap(got.v, fromTop) < TOL, `stepping down to level 0 exports the same (largest gap ${gap(got.v, fromTop)})`);
    // A vertex moved at level 0 itself, through its arrays.
    const T1 = id('T1') - 1;
    const pushed = await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      // Level 0 vertex 0 is the first used file vertex: T3 (local y is file z).
      const v = m.getVertices();
      v[1] += 4;
      m.updateGeometry();
      m.updateBuffers();
      return m._sel;
    });
    out = await exportOriginal();
    got = read(out.text ?? '');
    const T3 = id('T3') - 1;
    const dz = got.v[T3][2] - fromTop[T3][2];
    t.ok(pushed === 0 && Math.abs(dz - 4) < 0.6 && Math.abs(got.v[T1][2] - fromTop[T1][2]) < 0.6, `a vertex moved by 4 at level 0 exports moved by about 4 up the file's Z (${dz.toFixed(3)})`);
    await page.evaluate(() => window.__sculpt.session.undo());

    // --- Set scale: the file's units come back -------------------------------------
    await page.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
    await booted(page);
    await handoff(page, text);
    await page.goto(`${base}/?sculpt=1&obj=1`, { waitUntil: 'domcontentloaded' });
    await booted(page);
    const unscaled = await exportOriginal();
    await page.evaluate(() => window.__sculpt.setScale(window.__sculpt.session.getMesh(), 180));
    t.eq(await page.evaluate(() => window.__sculpt.session.getUnits()), 'cm', 'Set scale marks the scene');
    const folded = await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh().getMatrix();
      return Math.hypot(m[0], m[1], m[2]);
    });
    t.near(folded, 1, 1e-6, 'and folds the scale into the vertices (the matrix at scale 1)');
    same(await exportOriginal(), 'after Set scale');
    t.ok((await exportOriginal()).text === unscaled.text, 'the export after Set scale is the one before it, character for character');

    // --- a .bozz save and reopen, and the autosave ---------------------------------
    const bytes = await page.evaluate(async () => [...new Uint8Array(await window.__sculpt.file.pack())]);
    await page.evaluate(async (b) => window.__sculpt.file.open(new Uint8Array(b).buffer), bytes);
    t.eq(await page.evaluate(() => window.__sculpt.fileActions.originalStatus()), 'valid', 'a .bozz file keeps the record');
    same(await exportOriginal(), 'a .bozz file reopened');
    await page.evaluate(() => window.__sculpt.persist.flush());
    await page.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
    await booted(page);
    same(await exportOriginal(), 'the autosave reloaded');

    // A scene saved while a unit was a metre: its object's matrix scale
    // (as Set scale left it then) is folded into the vertices as it opens,
    // and the export is still the file's, character for character.
    await handoff(page, text);
    await page.goto(`${base}/?sculpt=1&obj=1`, { waitUntil: 'domcontentloaded' });
    await booted(page);
    const asImported = await exportOriginal();
    const metres = await page.evaluate(async () => {
      const { file, session } = window.__sculpt;
      const rec = await file.unpack(await file.pack());
      rec.units = 'm';
      for (const m of rec.meshes) for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) m.matrix[c * 4 + r] *= 0.0137;
      await file.open(await file.packRecord(rec));
      const mat = session.getMesh().getMatrix();
      return { units: session.getUnits(), scale: Math.hypot(mat[0], mat[1], mat[2]), status: window.__sculpt.fileActions.originalStatus() };
    });
    t.ok(metres.units === 'cm' && Math.abs(metres.scale - 1) < 1e-6 && metres.status === 'valid', `a .bozz in metres opens on centimetres, its scale folded in, the record kept (${JSON.stringify(metres)})`);
    t.ok((await exportOriginal()).text === asImported.text, 'and its export is the file, character for character');

    // An older file, written before the record: it opens as it always did.
    const older = (() => {
      const raw = gunzipSync(Buffer.from(bytes));
      const len = raw.readUInt32LE(4);
      const header = JSON.parse(raw.subarray(8, 8 + len).toString());
      for (const m of header.scene.meshes) delete m.source;
      const head = Buffer.from(JSON.stringify(header));
      const pad = (n) => Math.ceil(n / 4) * 4;
      const out = Buffer.alloc(8 + pad(head.length) + (raw.length - 8 - pad(len)));
      out.writeUInt32LE(raw.readUInt32LE(0), 0);
      out.writeUInt32LE(head.length, 4);
      head.copy(out, 8);
      raw.subarray(8 + pad(len)).copy(out, 8 + pad(head.length));
      return [...out];
    })();
    const opened = await page.evaluate(async (b) => {
      try {
        await window.__sculpt.file.open(new Uint8Array(b).buffer);
        return { n: window.__sculpt.session.getMeshes().length, status: window.__sculpt.fileActions.originalStatus() };
      } catch (err) {
        return { error: String(err) };
      }
    }, older);
    t.ok(opened.n === 1 && opened.status === 'none', `a .bozz without the record opens as before, with nothing to export in the file's numbering (${JSON.stringify(opened)})`);

    // --- remesh and merge rebuild the topology: refused, with the reason ----------------------
    await page.evaluate(async (b) => window.__sculpt.file.open(new Uint8Array(b).buffer), bytes);
    await page.evaluate(() => {
      const s = window.__sculpt.session;
      s.setRemeshResolution(40);
      s.voxelRemesh();
    });
    out = await exportOriginal();
    t.eq(out.error, STALE, 'after a voxel remesh the numbered export refuses, and says why');
    item = await menuItem();
    t.ok(item && /triangles/.test(item.hint) && /topology has changed/.test(item.hint), `the hint says the triangles, and why (${item?.hint})`);
    dl = await clickExport();
    {
      const tri = await page.evaluate(() => window.__sculpt.file.toOBJ());
      t.ok(dl && TRI.test(dl.text) && dl.text === tri && /\.obj$/.test(dl.name) && dl.name !== 'Prism.obj', `Export OBJ writes the triangles instead (${dl?.name})`);
    }
    t.eq(dl?.note, 'Exported without the original numbering: the topology has changed since the import.', 'and a note says why');
    await page.evaluate(() => window.__sculpt.session.undo());
    same(await exportOriginal(), 'the remesh undone');
    const merged = await page.evaluate(() => {
      const s = window.__sculpt.session;
      const obj = s.getMesh();
      const cube = s.addPrimitive('cube');
      s.setRemeshResolution(40);
      s.mergeMeshes([obj, cube], obj);
      return s.getMeshes().length;
    });
    out = await exportOriginal();
    t.ok(merged === 1 && out.error === STALE, `after a merge it refuses too (${out.error})`);
    // A copy keeps the numbering; a mirror copy does not.
    await page.evaluate(async (b) => window.__sculpt.file.open(new Uint8Array(b).buffer), bytes);
    const copies = await page.evaluate(() => {
      const s = window.__sculpt.session;
      const obj = s.getMesh();
      const dup = s.duplicateMesh(obj);
      const mir = s.mirrorMesh(obj, 'x');
      return { dup: s.originalNumbering(dup), mir: s.originalNumbering(mir), obj: s.originalNumbering(obj) };
    });
    t.ok(copies.dup === 'valid' && copies.mir === 'stale' && copies.obj === 'valid', `a duplicate keeps the record, a mirror copy's is stale (${JSON.stringify(copies)})`);
    // Another object selected in the same scene: the triangles of every object.
    const other = await page.evaluate(() => {
      const s = window.__sculpt.session;
      const cube = s.addPrimitive('cube');
      s.setMesh(cube);
      return { status: window.__sculpt.fileActions.originalStatus(), n: s.getMeshes().length };
    });
    item = await menuItem();
    dl = await clickExport();
    {
      const tri = await page.evaluate(() => window.__sculpt.file.toOBJ());
      const objects = (dl?.text.match(/^o /gm) ?? []).length;
      t.ok(
        other.status === 'none' && /triangles/.test(item?.hint ?? '') && dl && TRI.test(dl.text) && dl.text === tri && objects === other.n && !dl.note,
        `a cube that was not imported, selected: Export OBJ writes every object's triangles, no note (${JSON.stringify(other)}, ${objects} objects, ${item?.hint})`,
      );
    }

    // --- the gallery's file picker, as a person uses it (Z-up off there) -------------------
    const dir = mkdtempSync(join(tmpdir(), 'bozzetto-objnum-'));
    try {
      const yUp = join(dir, 'Prism Y.obj');
      writeFileSync(yUp, text);
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#landing-grid .card--new', { timeout: 30_000 });
      await page.click('#landing-grid .card--new');
      await page.setInputFiles('.create-overlay .create-obj-input', yUp);
      await page.waitForURL((u) => u.searchParams.get('sculpt') === '1', { timeout: 30_000 });
      await booted(page);
      same(await exportOriginal(), 'the gallery picker (Z-up off) then export');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    // --- the triangle Export OBJ is as it was --------------------------------------
    await page.goto(`${base}/?sculpt=1`, { waitUntil: 'domcontentloaded' });
    await booted(page);
    await page.evaluate(() => window.__sculpt.fileActions.newScene());
    const triAfter = await page.evaluate(() => window.__sculpt.file.toOBJ());
    t.ok(triAfter === triBefore && /^# Bozzetto sculpt export\no Sphere\nv /.test(triAfter), 'Export OBJ still writes the triangles of a fresh sphere as before');
    void named;
  },
};
