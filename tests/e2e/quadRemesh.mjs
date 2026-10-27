// Quad remesh (QuadriFlow in a worker, owner request): the Model panel's
// Quad remesh section under Remesh, its target and three options; on the
// default sphere a mesh of quads near the target count and on the
// original surface, applied as one undo step that puts the sphere back
// exactly; the stages in order with the bar; the options as qf_run gets
// them; Cancel, a surface that is not manifold and an object that
// changes while it runs each leave the object as it was; an imported
// OBJ's numbering goes stale; Subdivide works after it; and QuadriFlow's
// two files are kept by the service worker once used, so it runs offline.
import { resolve } from 'node:path';
import { openSculpt } from './lib.mjs';
import { clearNotices, failedNotice, openForInput, openPanel, sliderRow, typeValue, workerActivated, workerRoutes } from './smoke.mjs';

/** The order QuadriFlow reports its stages in (qf_wasm.cpp), slope only with adaptive sizing. */
const QF_ORDER = ['load', 'initialize', 'orientations', 'scale', 'positions', 'index map', 'write'];

/** The Quad remesh section's controls: its slider, checkboxes and buttons. */
const section = (page) =>
  page.evaluate(() => {
    const sec = document.querySelector('.panel--model [data-role="quad-remesh"]');
    if (!sec) return null;
    return {
      heading: sec.querySelector('h3')?.textContent,
      checks: [...sec.querySelectorAll('label.checkbox')].map((l) => ({ label: l.textContent, on: l.querySelector('input').checked })),
      // The buttons that can be pressed: shown and enabled.
      buttons: [...sec.querySelectorAll('button')].filter((b) => !b.closest('[hidden]') && !b.disabled).map((b) => b.textContent),
      running: !sec.querySelector('.sculpt-panel__quad-progress').hidden,
      stage: sec.querySelector('[data-role="quad-stage"]').textContent,
      bar: Number(sec.querySelector('progress').value),
    };
  });

/** Press a button of the Quad remesh section. */
const press = (page, label) =>
  page.evaluate((l) => {
    const sec = document.querySelector('.panel--model [data-role="quad-remesh"]');
    [...sec.querySelectorAll('button')].find((b) => b.textContent === l).click();
  }, label);

/** Until the run ends; how long it took, in ms. */
async function finished(page, timeout = 180_000) {
  const t0 = Date.now();
  await page.waitForFunction(() => !window.__sculpt.modelPanel.isQuadRunning(), null, { timeout, polling: 100 });
  return Date.now() - t0;
}

/** The active object's surface, its faces' kinds and the level stack. */
const shape = (page) =>
  page.evaluate(() => {
    const { session } = window.__sculpt;
    const m = session.getMesh();
    const f = m.getFaces();
    let quads = 0;
    for (let i = 0; i < m.getNbFaces(); i++) if (f[i * 4 + 3] !== 4294967295) quads++;
    // Signed volume: positive when the faces face outward.
    const v = m.getVertices();
    let vol = 0;
    const tri = (a, b, c) => {
      vol += (v[a * 3] * (v[b * 3 + 1] * v[c * 3 + 2] - v[b * 3 + 2] * v[c * 3 + 1]) - v[a * 3 + 1] * (v[b * 3] * v[c * 3 + 2] - v[b * 3 + 2] * v[c * 3]) + v[a * 3 + 2] * (v[b * 3] * v[c * 3 + 1] - v[b * 3 + 1] * v[c * 3])) / 6;
    };
    for (let i = 0; i < m.getNbFaces(); i++) {
      tri(f[i * 4], f[i * 4 + 1], f[i * 4 + 2]);
      if (f[i * 4 + 3] !== 4294967295) tri(f[i * 4], f[i * 4 + 2], f[i * 4 + 3]);
    }
    return {
      faces: m.getNbFaces(),
      verts: m.getNbVertices(),
      quads,
      levels: m._meshes ? m._meshes.length : 0,
      name: session.getMeshName(m),
      id: m.getID(),
      volume: vol,
      matrix: Array.from(m.getMatrix()),
      locked: session.isLocked(m),
      padlock: session.isPadlocked(m),
    };
  });

/** Install a spy on what the page posts to its workers (the run messages, without their arrays). */
const spy = (page) =>
  page.evaluate(() => {
    if (window.__qfPosts) return;
    window.__qfPosts = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (msg, ...rest) {
      if (msg && msg.type === 'run') {
        const { positions, faces, ...opts } = msg;
        window.__qfPosts.push({ ...opts, nbVertices: positions.length / 3, nbFaces: faces.length / 4 });
      }
      return post.call(this, msg, ...rest);
    };
  });

/** Keep the active object's surface (current level) and the instance, to compare with later. */
const keep = (page) =>
  page.evaluate(() => {
    const m = window.__sculpt.session.getMesh();
    window.__qfKept = { mesh: m, v: new Float32Array(m.getVertices().subarray(0, m.getNbVertices() * 3)), f: new Uint32Array(m.getFaces().subarray(0, m.getNbFaces() * 4)) };
  });

/** Whether the active object is the one kept, with the very same arrays' contents. */
const unchanged = (page) =>
  page.evaluate(() => {
    const k = window.__qfKept;
    const m = window.__sculpt.session.getMesh();
    if (m !== k.mesh) return false;
    const v = m.getVertices();
    const f = m.getFaces();
    if (m.getNbVertices() * 3 !== k.v.length || m.getNbFaces() * 4 !== k.f.length) return false;
    for (let i = 0; i < k.v.length; i++) if (v[i] !== k.v[i]) return false;
    for (let i = 0; i < k.f.length; i++) if (f[i] !== k.f[i]) return false;
    return true;
  });

/** Set the Target faces slider by typing into it. */
async function setTarget(page, value) {
  const row = await sliderRow(page, 'Model', 'Target faces');
  await page.mouse.dblclick(...row.at);
  await typeValue(page, String(value));
  return sliderRow(page, 'Model', 'Target faces');
}

/** Tick or untick one of the section's checkboxes by its label. */
const tick = (page, label, on) =>
  page.evaluate(
    ([l, want]) => {
      const sec = document.querySelector('.panel--model [data-role="quad-remesh"]');
      const input = [...sec.querySelectorAll('label.checkbox')].find((x) => x.textContent === l).querySelector('input');
      if (input.checked !== want) input.click();
    },
    [label, on],
  );

/** A UV sphere as OBJ text: quads, triangle fans at the poles. */
function ballObj(nu = 24, nv = 12, r = 10) {
  const v = ['v 0 ' + r + ' 0'];
  for (let j = 1; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const th = (Math.PI * j) / nv;
      const ph = (2 * Math.PI * i) / nu;
      v.push(`v ${(r * Math.sin(th) * Math.cos(ph)).toFixed(5)} ${(r * Math.cos(th)).toFixed(5)} ${(r * Math.sin(th) * Math.sin(ph)).toFixed(5)}`);
    }
  }
  v.push(`v 0 ${-r} 0`);
  const id = (j, i) => 2 + (j - 1) * nu + (((i % nu) + nu) % nu);
  const f = [];
  for (let i = 0; i < nu; i++) f.push(`f 1 ${id(1, i + 1)} ${id(1, i)}`);
  for (let j = 1; j < nv - 1; j++) for (let i = 0; i < nu; i++) f.push(`f ${id(j, i)} ${id(j, i + 1)} ${id(j + 1, i + 1)} ${id(j + 1, i)}`);
  const s = v.length;
  for (let i = 0; i < nu; i++) f.push(`f ${s} ${id(nv - 1, i)} ${id(nv - 1, i + 1)}`);
  return `${v.join('\n')}\n${f.join('\n')}\n`;
}

/**
 * Not manifold: a closed box and a fin, one more triangle on one of its
 * edges, so that edge has three faces, which no pairing of sheets can
 * undo. OBJ text.
 */
function finObj() {
  const v = ['v 0 0 0', 'v 10 0 0', 'v 10 10 0', 'v 0 10 0', 'v 0 0 10', 'v 10 0 10', 'v 10 10 10', 'v 0 10 10', 'v 5 -8 5'];
  const f = ['f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5', 'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8', 'f 1 2 9'];
  return `${v.join('\n')}\n${f.join('\n')}\n`;
}

export const suites = {
  async quadRemesh(page, base, t) {
    await openForInput(page, base);
    t.ok(await openPanel(page, 'Model'), 'the Model panel opens');
    const heads = await page.evaluate(() => [...document.querySelectorAll('.panel--model .section h3')].map((h) => h.textContent));
    t.ok(heads.indexOf('Quad remesh') === heads.indexOf('Remesh') + 1, `Quad remesh is the section under Remesh (${heads.join(', ')})`);
    let sec = await section(page);
    t.eq(sec.checks.map((c) => `${c.label} ${c.on ? 'on' : 'off'}`).join(', '), 'Keep sharp edges off, Keep open borders off, Adaptive quad size off', 'its three options, all off');
    t.ok(sec.buttons.join(',') === 'Quad remesh' && !sec.running, `with the Quad remesh button, and no bar until it runs (${sec.buttons.join(', ')})`);
    const sphere = await shape(page);
    let row = await sliderRow(page, 'Model', 'Target faces');
    const want = Math.min(50000, Math.max(500, Math.round(sphere.faces / 4)));
    t.ok(row.min === 500 && row.max === 50000 && row.thumb === want, `Target faces runs 500..50000 and starts at a quarter of the sphere's ${sphere.faces} faces (${row.min}..${row.max}, ${row.thumb})`);
    row = await setTarget(page, 100);
    t.eq(row.thumb, 500, 'a typed 100 is held to 500');
    row = await setTarget(page, 2000);
    t.eq(row.thumb, 2000, 'and 2000 typed is 2000');

    // --- the run on the default sphere -----------------------------------
    await spy(page);
    await keep(page);
    const before = await page.evaluate(() => {
      const { session } = window.__sculpt;
      return { undo: session.getStateManager()._curUndoIndex, objects: session.getMeshes().length };
    });
    await clearNotices(page);
    await press(page, 'Quad remesh');
    await page.waitForFunction(() => window.__sculpt.modelPanel.quadStages.some((s) => s.stage >= 0), null, { timeout: 60_000, polling: 50 });
    const during = await section(page);
    const held = await shape(page);
    t.ok(during.running && /\.\.\. \d+%$/.test(during.stage) && !during.buttons.includes('Quad remesh') && during.buttons.includes('Cancel'), `while it runs, the stage and a bar with Cancel stand in for the button ("${during.stage}")`);
    t.ok(held.locked && !held.padlock, 'and the sphere is locked against edits, its padlock untouched');
    const stroke = await page.evaluate(() => {
      // The display draws a locked object as masked, and strokes refuse it (InputShell).
      const { session } = window.__sculpt;
      return session.isLocked(session.getMesh());
    });
    t.ok(stroke, 'the session refuses it to strokes and the gizmo (isLocked)');
    const ms = await finished(page);
    const after = await shape(page);
    const run = await page.evaluate(() => ({ stages: window.__sculpt.modelPanel.quadStages, last: window.__sculpt.modelPanel.lastQuad, posts: window.__qfPosts }));
    const done = await page.evaluate(() => [...document.querySelectorAll('.file-menu__progress')].map((n) => n.textContent).pop() ?? '');
    t.ok(after.id === sphere.id && after.faces !== sphere.faces && after.levels === 1, `Quad remesh replaces the sphere with a single-level object of its own (${after.faces} faces, ${ms} ms; "${done}")`);
    const share = after.quads / after.faces;
    t.ok(share > 0.95, `of quads, mostly (${after.quads} of ${after.faces}, ${(share * 100).toFixed(1)}%)`);
    t.ok(Math.abs(after.faces - 2000) <= 600, `near the target of 2000 (within 30%: ${after.faces})`);
    t.ok(after.volume > 0 && Math.abs(after.volume - sphere.volume) / sphere.volume < 0.05, `facing outward, its volume the sphere's (${after.volume.toFixed(1)} against ${sphere.volume.toFixed(1)})`);
    t.ok(after.name === sphere.name && after.matrix.every((x, i) => x === sphere.matrix[i]) && !after.locked, `with its name, transform and material, and unlocked again (${after.name})`);
    const dist = await page.evaluate(() => {
      // Each new vertex's distance to the nearest vertex of the sphere it
      // was made from (an upper bound on its distance to that surface),
      // against the sphere's size.
      const k = window.__qfKept.v;
      const m = window.__sculpt.session.getMesh();
      const v = m.getVertices();
      let lo = [Infinity, Infinity, Infinity];
      let hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < k.length; i += 3) for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], k[i + a]);
        hi[a] = Math.max(hi[a], k[i + a]);
      }
      const size = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      let worst = 0;
      for (let i = 0; i < m.getNbVertices() * 3; i += 3) {
        let best = Infinity;
        for (let j = 0; j < k.length; j += 3) {
          const d = (v[i] - k[j]) ** 2 + (v[i + 1] - k[j + 1]) ** 2 + (v[i + 2] - k[j + 2]) ** 2;
          if (d < best) best = d;
        }
        worst = Math.max(worst, Math.sqrt(best));
      }
      return { worst, size, rel: worst / size };
    });
    t.ok(dist.rel < 0.02, `on the sphere's surface: no vertex further than ${(dist.rel * 100).toFixed(2)}% of its size from it (${dist.worst.toFixed(3)} of ${dist.size.toFixed(2)})`);
    const qfStages = run.stages.filter((s) => s.stage >= 0 && s.name !== 'done').map((s) => s.name);
    const percents = run.stages.map((s) => s.percent);
    t.eq(qfStages.join(', '), QF_ORDER.join(', '), "QuadriFlow's stages arrive in order");
    t.ok(run.stages[0].name === 'module' && run.stages[1].name === 'cleanup' && run.stages[run.stages.length - 1].name === 'done' && percents.every((p, i) => i === 0 || p > percents[i - 1]) && percents[percents.length - 1] === 100, `after the module's load and the cleanup, and before done, the bar moving forward at each to 100 (${percents.join(' ')})`);
    const post = run.posts[run.posts.length - 1];
    t.ok(post && post.target === 2000 && post.sharp === false && post.boundary === false && post.adaptive === false && post.nbFaces === sphere.faces, `the worker is sent the sphere's ${post?.nbFaces} faces at 2000, every option off`);
    t.eq(run.last.args.join(','), '2000,0,0,0,0', 'and qf_run is called with them (faces, sharp, boundary, adaptive, seed)');
    const undo = await page.evaluate(() => {
      const { session } = window.__sculpt;
      return session.getStateManager()._curUndoIndex;
    });
    t.eq(undo - before.undo, 1, 'it is one undo step');
    await page.evaluate(() => window.__sculpt.session.undo());
    t.ok(await unchanged(page), 'and one undo puts the sphere back exactly, the same object with the same vertices and faces');
    t.ok((await shape(page)).levels === sphere.levels, `its levels with it (${sphere.levels})`);
    await page.evaluate(() => window.__sculpt.session.redo());
    const redone = await shape(page);
    t.eq(redone.faces, after.faces, 'redo brings the quads back');

    // Subdivide after it: quads into four quads each.
    const sub = await page.evaluate(async () => {
      const { session } = window.__sculpt;
      const m = session.getMesh();
      const faces = m.getNbFaces();
      await session.subdivide();
      const n = session.getMesh();
      return { before: faces, after: n.getNbFaces(), levels: session.getLevels() };
    });
    t.ok(sub.after === sub.before * 4 && sub.levels.levels === 2, `Subdivide works after it (${sub.before} faces to ${sub.after}, ${sub.levels.levels} levels)`);
    await page.evaluate(() => {
      window.__sculpt.session.undo();
      window.__sculpt.session.undo();
    });
    t.ok(await unchanged(page), 'and undoing both is the sphere again');

    // The options reach qf_run.
    await tick(page, 'Keep sharp edges', true);
    await tick(page, 'Keep open borders', true);
    await tick(page, 'Adaptive quad size', true);
    await setTarget(page, 800);
    await clearNotices(page);
    await press(page, 'Quad remesh');
    await finished(page);
    const opted = await page.evaluate(() => ({ stages: window.__sculpt.modelPanel.quadStages.filter((s) => s.stage >= 0 && s.name !== 'done').map((s) => s.name), last: window.__sculpt.modelPanel.lastQuad, post: window.__qfPosts[window.__qfPosts.length - 1] }));
    t.ok(opted.post.target === 800 && opted.post.sharp && opted.post.boundary && opted.post.adaptive, 'with every option ticked and 800 faces, the worker is sent them');
    t.eq(opted.last?.args.join(','), '800,1,1,1,0', 'and qf_run gets them');
    t.eq(opted.stages.join(', '), ['load', 'initialize', 'orientations', 'slope', 'scale', 'positions', 'index map', 'write'].join(', '), 'with adaptive sizing its slope stage comes in its place');
    await page.evaluate(() => window.__sculpt.session.undo());
    t.ok(await unchanged(page), 'one undo, and the sphere is back');
    await tick(page, 'Keep sharp edges', false);
    await tick(page, 'Keep open borders', false);
    await tick(page, 'Adaptive quad size', false);
    await setTarget(page, 2000);

    // Cancel leaves the sphere as it was.
    await clearNotices(page);
    await press(page, 'Quad remesh');
    await page.waitForFunction(() => window.__sculpt.modelPanel.quadStages.some((s) => s.name === 'orientations'), null, { timeout: 60_000, polling: 20 });
    await press(page, 'Cancel');
    await finished(page, 10_000);
    sec = await section(page);
    const cancelled = await page.evaluate(() => [...document.querySelectorAll('.file-menu__progress')].map((n) => n.textContent).pop() ?? '');
    t.ok((await unchanged(page)) && !(await shape(page)).locked && !sec.running && sec.buttons.includes('Quad remesh'), `Cancel stops it: the sphere is as it was and unlocked, the button back ("${cancelled}")`);
    t.eq(await page.evaluate(() => window.__sculpt.session.getStateManager()._curUndoIndex), before.undo, 'and nothing went on the undo stack');
    // A run after a cancel starts a fresh worker and still works.
    await press(page, 'Quad remesh');
    await finished(page);
    t.ok((await shape(page)).faces !== sphere.faces, 'a run after Cancel works');
    await page.evaluate(() => window.__sculpt.session.undo());

    // An object that changes while it runs: the result is refused.
    await clearNotices(page);
    await press(page, 'Quad remesh');
    await page.waitForFunction(() => window.__sculpt.modelPanel.quadStages.some((s) => s.stage >= 0), null, { timeout: 60_000, polling: 20 });
    await page.evaluate(() => {
      // As a stroke would, past the lock (an undo, a script): one vertex moved.
      const m = window.__sculpt.session.getMesh();
      m.getVertices()[0] += 0.5;
    });
    await finished(page);
    const refused = await failedNotice(page);
    const kept = await page.evaluate(() => window.__sculpt.session.getMesh() === window.__qfKept.mesh);
    t.ok(kept && /changed while Quad remesh ran/.test(refused?.text ?? ''), `a result for an object that changed meanwhile is refused (${refused?.text})`);
    await page.evaluate(() => {
      window.__sculpt.session.getMesh().getVertices()[0] -= 0.5;
    });

    // Not manifold: said, and the object left as it was.
    await page.evaluate((text) => window.__sculpt.session.importOBJ(text, false, 'Fin'), finObj());
    await keep(page);
    const finUndo = await page.evaluate(() => window.__sculpt.session.getStateManager()._curUndoIndex);
    await clearNotices(page);
    await press(page, 'Quad remesh');
    await finished(page);
    const bad = await failedNotice(page);
    t.ok(/not manifold/.test(bad?.text ?? '') && /Voxel remesh first/.test(bad?.text ?? ''), `a surface that is not manifold is refused, saying so ("${bad?.text}")`);
    t.ok((await unchanged(page)) && (await page.evaluate(() => window.__sculpt.session.getStateManager()._curUndoIndex)) === finUndo, 'and the object is left untouched, nothing on the undo stack');
    // Voxel remesh, then Quad remesh: what the notice says works.
    await page.evaluate(() => window.__sculpt.session.voxelRemesh(96));
    await setTarget(page, 1000);
    await press(page, 'Quad remesh');
    await finished(page);
    const fixed = await shape(page);
    const fixedRun = await page.evaluate(() => window.__sculpt.modelPanel.lastQuad);
    t.ok(fixedRun && fixed.quads / fixed.faces > 0.95, `after Voxel remesh it quad remeshes (${fixed.faces} faces; the cleanup cut ${fixedRun?.report.splitEdges} edges, split ${fixedRun?.report.splitVertices} vertices, dropped ${fixedRun?.report.islands} pieces)`);
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.undo();
      session.undo();
      session.undo();
    });

    // An imported OBJ's numbering goes stale, as after a voxel remesh.
    await page.evaluate((text) => window.__sculpt.session.importOBJ(text, false, 'Ball'), ballObj());
    const valid = await page.evaluate(() => window.__sculpt.session.originalNumbering());
    await setTarget(page, 1000);
    await press(page, 'Quad remesh');
    await finished(page);
    const stale = await page.evaluate(() => ({ status: window.__sculpt.session.originalNumbering(), name: window.__sculpt.session.activeName() }));
    t.ok(valid === 'valid' && stale.status === 'stale' && stale.name === 'Ball', `an imported OBJ's numbering is stale after it (${valid} to ${stale.status})`);
    await page.evaluate(() => window.__sculpt.session.undo());
    t.eq(await page.evaluate(() => window.__sculpt.session.originalNumbering()), 'valid', 'and valid again after an undo');

    // The worker's rule for QuadriFlow's two files.
    const sw = workerRoutes(resolve('dist'));
    const routes = ['/quadriflow/quadriflow.mjs?v=abc', '/quadriflow/quadriflow.wasm?v=abc'].map((u) => sw.routeFor(u));
    t.ok(routes.every((r) => r?.handler === 'CacheFirst' && r.cache === 'bozzetto-quadriflow'), `the built worker keeps QuadriFlow's script and wasm in their own runtime cache once fetched (${JSON.stringify(routes)})`);
    t.ok(sw.routeFor('/quadriflow/other.bin') === null, 'and nothing else under quadriflow/');

    // Offline after first use: an installed app that ran it once.
    const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(String(e)));
      await openSculpt(p, base, '&q=low');
      t.ok(await workerActivated(p), 'the service worker activates');
      // Controlled from the next load on.
      await openSculpt(p, base, '&q=low');
      const quick = async () => {
        await p.waitForFunction(() => !!window.__sculpt?.modelPanel, null, { timeout: 60_000 });
        return p.evaluate(async () => {
          const { modelPanel, session } = window.__sculpt;
          modelPanel.quadTarget = 600;
          const ok = await modelPanel.runQuadRemesh();
          return { ok, faces: session.getMesh().getNbFaces(), controlled: !!navigator.serviceWorker.controller };
        });
      };
      const online = await quick();
      const kept = await p.evaluate(async () => {
        const c = await caches.open('bozzetto-quadriflow');
        return (await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search);
      });
      t.ok(online.ok && online.controlled && kept.some((u) => /^\/quadriflow\/quadriflow\.mjs\?v=\w+$/.test(u)) && kept.some((u) => /^\/quadriflow\/quadriflow\.wasm\?v=\w+$/.test(u)), `run once online, QuadriFlow's two files are in the runtime cache (${kept.join(', ')})`);
      await ctx.setOffline(true);
      await p.reload({ waitUntil: 'domcontentloaded' });
      const offline = await quick();
      t.ok(offline.ok && offline.faces > 300, `offline, Quad remesh still runs (${offline.faces} faces)`);
      t.ok(!errors.length, `no page errors offline${errors.length ? `: ${errors.join(' | ')}` : ''}`);
      await ctx.setOffline(false);
    } finally {
      await ctx.close();
    }
  },
};
