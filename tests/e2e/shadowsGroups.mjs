// Shadows after poly groups, and the shadow fit at centimetre scale
// (owner report, 2026-11-01: after making poly groups the model went dark
// and stayed dark until shadows were toggled off and on).
//
// The cause: three's shadow pass draws each object with the light's own
// shadow material, built per object with the source material's colorNode
// folded in, and only looks at that build again when the SHADOW
// material's version moves. Shift+F's group colours rebuild the sculpt
// material (colorNode reading `groupColor`) and add or remove the
// `groupColor` attribute, but left the shadow pass's build alone: built
// while the colours showed, it kept reading `groupColor` after they were
// turned off and the attribute was gone. Under WebGPU every shadow draw of
// the model then failed validation and the key's map stopped updating
// while the light (which follows the view in Sculpt) moved on; WebGL draws
// a missing attribute as zeros and showed nothing. Viewer.refreshShadowPasses
// now has the shadow passes rebuild what changed.
//
// shadowsGroups:
// - the shadow fit at cm scale: the 25 cm sphere and a 180 cm library
//   figure, each framed whole: the key's frustum covers the subject's box
//   as the light sees it and hugs it (its width at most 1.3 times the box's
//   light-space extent), its texel and normal bias in millimetres, its
//   depth range a few subject radii; a turned key refits and still hugs;
// - groups with the colours shown and hidden (Shift+F on, a shadow toggle
//   so the shadow pass is built while they show, Shift+F off), By angle,
//   Ctrl+G from a mask, the view turned and back: no shadow-pass build
//   reads an attribute its geometry lacks (the WebGL-visible form of the
//   WebGPU failure), and the model's lit brightness matches before;
// - the VSM blur's samples grow with its radius (owner call, 2026-11-01:
//   banded soft shadows): across the softness range, framed whole and in
//   the face close-up (some 19 texels of blur), the samples stay about two
//   texels apart within the tier's cap, a blur the tier's count covers
//   takes no more, and adaptive quality's economy still halves them.
import { openSculpt } from './lib.mjs';

/**
 * n frames drawn by the viewer from here on (not refreshes: the viewer
 * keeps one frame in flight, and a refresh while the GPU is busy draws
 * nothing).
 */
const frames = (page, n = 2) => page.evaluate((k) => window.__bozzetto.whenFramesDrawn(k), n);

const still = async (page) => {
  await page.waitForFunction(() => window.__bozzetto.frameMode().kind === null, null, { timeout: 20_000 });
  await frames(page, 12);
};

const r3 = (x) => +Number(x).toPrecision(3);

/**
 * The key light's fit against the live subject box: its frustum, the box
 * as the key's shadow camera sees it (light space), whether the frustum
 * holds every corner, and the bias in world terms.
 */
const keyFit = (page) =>
  page.evaluate(() => {
    const v = window.__bozzetto;
    const L = v.lighting;
    const light = L.lights.key;
    const cam = light.shadow.camera;
    const b = v.liveShadowBox();
    // As three places the camera at the map's next draw.
    const p = light.position.clone().setFromMatrixPosition(light.matrixWorld);
    const t = p.clone().setFromMatrixPosition(light.target.matrixWorld);
    cam.position.copy(p);
    cam.lookAt(t);
    cam.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    let over = 0;
    for (let i = 0; i < 8; i++) {
      const q = p.clone().set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(cam.matrixWorldInverse);
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
      over = Math.max(over, cam.left - q.x, q.x - cam.right, cam.bottom - q.y, q.y - cam.top, cam.near + q.z, -q.z - cam.far);
    }
    const f = L.fitInfo();
    const width = cam.right - cam.left;
    const size = b.getSize(p.clone());
    return {
      size: size.toArray(),
      R: f.subjectRadius,
      width,
      extent: Math.max(x1 - x0, y1 - y0),
      covers: over <= 1e-6 * width,
      texel: f.lights.key.texel,
      depth: cam.far - cam.near,
      normalBias: light.shadow.normalBias,
      refits: f.refits,
      closeUp: f.closeUp,
    };
  });

/** The fit checks for one subject, framed whole. */
const fitChecks = (t, what, k, maxTexel) => {
  t.ok(k.covers && !k.closeUp, `${what}: the key's frustum covers the subject's box (${r3(k.width)} cm wide)`);
  t.ok(
    k.width <= 1.3 * k.extent,
    `${what}: and hugs it: ${r3(k.width)} cm across for a box ${r3(k.extent)} cm across as the light sees it (${r3(k.width / k.extent)}x)`,
  );
  t.ok(k.texel <= maxTexel, `${what}: a texel of ${r3(k.texel * 10)} mm on the 2048 key map (at most ${r3(maxTexel * 10)} mm)`);
  t.ok(k.depth <= 4 * k.R, `${what}: a depth range of ${r3(k.depth)} cm, ${r3(k.depth / k.R)} subject radii (no floor to reach)`);
  t.ok(
    k.normalBias >= 0.5 * k.texel && k.normalBias <= 4 * k.texel,
    `${what}: a normal bias of ${r3(k.normalBias * 10)} mm, ${r3(k.normalBias / k.texel)} texels`,
  );
};

/** Every shadow-pass build drawn in the next frames, and the attributes it reads that its geometry lacks. */
const shadowBuilds = (page) =>
  page.evaluate(async () => {
    const v = window.__bozzetto;
    const objects = v.renderer._objects;
    const seen = new Set();
    const get = objects.get;
    objects.get = function (object, material, ...rest) {
      const ro = get.call(this, object, material, ...rest);
      if (material?.isShadowPassMaterial) seen.add(ro);
      return ro;
    };
    try {
      for (const id of ['key', 'fill', 'rim']) v.lighting.lights[id].shadow.needsUpdate = true;
      v.invalidate();
      await v.whenFramesDrawn(3);
    } finally {
      objects.get = get;
    }
    return [...seen].map((ro) => {
      const names = (ro.getNodeBuilderState().nodeAttributes ?? []).map((a) => a.name);
      return { reads: names, missing: names.filter((n) => !ro.object.geometry.getAttribute(n)) };
    });
  });

/** Mean luminance of the model's pixels in a kept frame (those that differ from the background in `ref`). */
const keep = (page, key) =>
  page.evaluate(async (k) => {
    // The next frame drawn, read as soon as it is.
    await window.__bozzetto.whenFramesDrawn(1);
    const src = window.__bozzetto.captureCanvas;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, 0, 0);
    (window.__shots ??= {})[k] = { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
  }, key);

const modelLum = (page, ref, key) =>
  page.evaluate(
    ([r, k]) => {
      const a = window.__shots[r];
      const b = window.__shots[k];
      const lum = (d, j) => 0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2];
      // The background where the view's middle row starts.
      const bg = lum(a.d, Math.floor(a.h / 2) * a.w * 4);
      let n = 0, sa = 0, sb = 0, off = 0;
      for (let j = 0; j < a.d.length; j += 4) {
        const la = lum(a.d, j);
        if (Math.abs(la - bg) < 8) continue;
        const lb = lum(b.d, j);
        n++;
        sa += la;
        sb += lb;
        if (Math.abs(la - lb) > 10) off++;
      }
      return { n, before: sa / n, after: sb / n, changed: off / n };
    },
    [ref, key],
  );

export const suites = {
  async shadowsGroups(page, base, t) {
    await openSculpt(page, base, '&q=high');
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 60_000 });
    await frames(page, 6);
    await still(page);

    // --- the fit at centimetre scale ------------------------------------------
    let k = await keyFit(page);
    t.ok(Math.abs(k.size[1] - 25) < 0.5, `the default sphere is 25 cm across (${r3(k.size[1])} cm): one unit is a centimetre`);
    fitChecks(t, 'the 25 cm sphere', k, 0.03);
    const refits = k.refits;
    await page.evaluate(() => window.__bozzetto.lighting.setAngles('key', 100, 12));
    await frames(page, 3);
    k = await keyFit(page);
    t.ok(k.refits > refits, `the key turned to a raking angle: the fit is redone (${k.refits - refits} refits)`);
    fitChecks(t, 'the sphere under a raking key', k, 0.03);
    await page.evaluate(() => window.__bozzetto.lighting.setAngles('key', 35, 38));

    await page.evaluate(async () => {
      const { session, input, viewer } = window.__sculpt;
      const keep = session.getMesh();
      const body = await session.addBaseMesh('body-female-stylized');
      session.deleteMesh(keep);
      session.setMesh(body);
      input.hooks.frameAll();
      viewer.haltOrbit();
    });
    await frames(page, 4);
    await still(page);
    k = await keyFit(page);
    t.ok(k.size[1] > 150 && k.size[1] < 200, `the library figure stands ${r3(k.size[1])} cm tall`);
    fitChecks(t, 'the figure', k, 0.12);

    // --- groups, with the colours shown and hidden --------------------------
    await keep(page, 'before');
    let builds = await shadowBuilds(page);
    t.ok(builds.length > 0 && builds.every((b) => !b.missing.length), `before any group edit the shadow pass draws the model (${builds.length} build(s), reading ${builds[0]?.reads.join(', ')})`);
    // Shift+F on, a shadow toggle while the colours show (the shadow pass
    // is built afresh, reading groupColor), Shift+F off.
    await page.evaluate(async () => {
      const { input } = window.__sculpt;
      const L = window.__bozzetto.lighting;
      input.hooks.toggleGroupColors();
      L.setShadowsMaster(false);
      await window.__bozzetto.whenFramesDrawn(2);
      L.setShadowsMaster(true);
      await window.__bozzetto.whenFramesDrawn(2);
    });
    await frames(page, 2);
    builds = await shadowBuilds(page);
    t.ok(builds.some((b) => b.reads.includes('groupColor')) && builds.every((b) => !b.missing.length), `with the group colours on, the shadow pass reads them (${builds.map((b) => b.reads.join(',')).join(' | ')})`);
    await page.evaluate(() => window.__sculpt.input.hooks.toggleGroupColors());
    await frames(page, 2);
    builds = await shadowBuilds(page);
    t.ok(
      builds.length > 0 && builds.every((b) => !b.missing.length && !b.reads.includes('groupColor')),
      `with them off again, no shadow-pass build reads an attribute its geometry lacks (${builds.map((b) => `${b.reads.join(',')}${b.missing.length ? ` missing ${b.missing.join(',')}` : ''}`).join(' | ')})`,
    );
    // Group by angle, then Ctrl+G from a mask (the lower half), the view
    // turned and back so the key light moves with it and returns.
    const made = await page.evaluate(() => {
      const { session, input } = window.__sculpt;
      const m = session.getMesh();
      const byAngle = session.groups.byAngle(m, 40);
      const mat = m.getMaterials();
      const v = m.getVertices();
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < m.getNbVertices(); i++) { lo = Math.min(lo, v[i * 3 + 1]); hi = Math.max(hi, v[i * 3 + 1]); }
      for (let i = 0; i < m.getNbVertices(); i++) mat[i * 3 + 2] = v[i * 3 + 1] < (lo + hi) / 2 ? 0 : 1;
      m.updateMaterialBuffer?.();
      input.hooks.groupFromMask();
      return { byAngle, groups: session.groups.names(m).length };
    });
    await frames(page, 2);
    await page.evaluate(() => window.__sculpt.input.hooks.orbitY(60));
    await frames(page, 3);
    await still(page);
    await page.evaluate(() => window.__sculpt.input.hooks.orbitY(-60));
    await frames(page, 3);
    await still(page);
    // The frame first: shadowBuilds redraws the maps, and the still frame
    // starts smoothing over from there.
    await keep(page, 'after');
    builds = await shadowBuilds(page);
    t.ok(builds.every((b) => !b.missing.length), `after By angle (${made.byAngle} groups) and Ctrl+G (${made.groups} now), the shadow pass still reads only what the geometry has`);
    const lum = await modelLum(page, 'before', 'after');
    t.ok(
      lum.n > 1000 && Math.abs(lum.after - lum.before) <= 1.5 && lum.changed < 0.01,
      `the model is as bright as before the groups: ${r3(lum.before)} then ${r3(lum.after)} over ${lum.n} px, ${r3(lum.changed * 100)}% of them changed by more than 10`,
    );

    // --- blur samples grow with the blur (owner call, 2026-11-01) ----------
    // The high tier: 12 samples at the least, 32 at the most. Spaced over
    // twice the radius, they stay about two texels apart wherever the cap
    // allows (radius + 1 samples), and a blur the tier's 12 cover takes 12.
    const BASE = 12;
    const MAX = 32;
    const blurOf = () =>
      page.evaluate(() => {
        const k = window.__bozzetto.lighting.fitInfo().lights.key;
        return { radius: k.radius, samples: k.samples, width: k.width, closeUp: window.__bozzetto.lighting.fitInfo().closeUp };
      });
    const spacing = (b) => (b.samples > 1 ? (2 * b.radius) / (b.samples - 1) : 0);
    const sweep = async (label) => {
      const rows = [];
      for (const soft of [0, 1, 3, 5, 8, 12, 16]) {
        await page.evaluate((v) => window.__bozzetto.lighting.setSoftness('key', v), soft);
        await frames(page, 2);
        rows.push({ soft, ...(await blurOf()) });
      }
      const bad = rows.filter((r) => (r.radius + 1 <= MAX ? spacing(r) > 2.05 : r.samples !== MAX) || r.samples < BASE || (r.radius + 1 <= BASE && r.samples !== BASE));
      t.ok(
        !bad.length,
        `${label}: the key's blur samples follow its radius, at most about 2 texels apart, never under the tier's ${BASE} nor over ${MAX} (${rows.map((r) => `softness ${r.soft}: ${r3(r.radius)} texels, ${r.samples} samples, ${r3(spacing(r))} apart`).join('; ')})`,
      );
      return rows;
    };
    await sweep('the figure framed whole');
    // The close-up measured on the owner's report: a soft key (5) over the
    // face, the fit held wide by the softness, some 19 texels of blur.
    await page.evaluate(async () => {
      const v = window.__bozzetto;
      const b = v.liveShadowBox();
      const H = b.max.y - b.min.y;
      const head = b.getCenter(b.min.clone());
      head.y = b.min.y + 0.9 * H;
      const dir = v.camera.position.clone().sub(head).normalize();
      v.setCameraState(head.clone().addScaledVector(dir, 0.25 * H), head.clone());
      v.haltOrbit();
    });
    await frames(page, 4);
    await page.evaluate(() => window.__bozzetto.lighting.setSoftness('key', 5));
    await frames(page, 3);
    const face = await blurOf();
    t.ok(
      face.closeUp && face.radius > 15 && face.samples >= Math.ceil(face.radius) + 1 && spacing(face) <= 2.05,
      `the face close-up at softness 5: ${r3(face.radius)} texels of blur over a ${r3(face.width)} cm fit take ${face.samples} samples, ${r3(spacing(face))} texels apart (the tier's ${BASE} were ${r3((2 * face.radius) / (BASE - 1))})`,
    );
    await sweep('the face close-up');
    // Adaptive quality's economy still halves them, and gives them back.
    await page.evaluate(() => window.__bozzetto.lighting.setSoftness('key', 5));
    await frames(page, 2);
    const full = await blurOf();
    await page.evaluate(() => window.__bozzetto.lighting.setShadowQuality(true, 1));
    await frames(page, 2);
    const eco = await blurOf();
    await page.evaluate(() => window.__bozzetto.lighting.setShadowQuality(false, 1));
    await frames(page, 2);
    const back = await blurOf();
    t.ok(
      eco.samples === Math.max(2, Math.round(Math.max(BASE, Math.min(MAX, Math.ceil(eco.radius) + 1)) / 2)) && back.samples === full.samples,
      `adaptive quality's economy halves them (${full.samples} at ${r3(full.radius)} texels; ${eco.samples} at ${r3(eco.radius)}, its fit refitted) and gives them back (${back.samples})`,
    );
  },
};
