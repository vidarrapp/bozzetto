// The shadows suite (owner report: with softness off the shadow under the
// chin showed large jagged texels). Each light's shadow frustum is fitted
// to the subject's bounds as they are now, and in a close-up to the part
// of it in view (Lighting.updateShadowFit): the texel at the subject is a
// third of what the old fixed fit (three bounding radii either side) gave
// in a close framing; the fit follows an object moved or scaled; close-up
// engages and releases with room between; a refit builds and allocates
// nothing; the viewer and Sculpt fit the same subject under the same look
// alike; softness reads the same at two framings; and the rim light casts
// by default on every tier, its box still turning it off
// (owner: it lit the floor straight through the model).
import { openArmature, openSculpt } from './lib.mjs';

/** n frames of the page's own, after the viewer's. */
const frames = (page, n = 2) =>
  page.evaluate(
    (k) =>
      new Promise((ok) => {
        let i = 0;
        const f = () => (++i >= k ? ok() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

const fit = (page) => page.evaluate(() => window.__bozzetto.lighting.fitInfo());
const counters = (page) => page.evaluate(() => window.__bozzetto.renderCounters());
const grew = (a, b) => Object.fromEntries(Object.keys(a).filter((k) => b[k] !== a[k]).map((k) => [k, b[k] - a[k]]));
const show = (o) => JSON.stringify(o);
const r3 = (x) => +x.toPrecision(3);

/** The subject's live box (what the shadows fit), its centre and bounding radius. */
const subject = (page) =>
  page.evaluate(() => {
    const b = window.__bozzetto.liveShadowBox();
    const c = b.getCenter(b.min.clone());
    return { min: b.min.toArray(), max: b.max.toArray(), c: c.toArray(), r: b.getSize(c.clone()).length() / 2 };
  });

/** Put the camera at `pos` looking at `target` (world), stopped there. */
const place = async (page, pos, target) => {
  await page.evaluate(
    ([p, q]) => {
      const v = window.__bozzetto;
      v.haltOrbit();
      v.setCameraState(v.camera.position.clone().fromArray(p), v.camera.position.clone().fromArray(q));
    },
    [pos, target],
  );
  await frames(page, 3);
};

/**
 * Whether every corner of `box` lies inside a light's shadow frustum, as
 * its shadow camera stands: [inside, worst overshoot as a share of the width].
 */
const covers = (page, id, box) =>
  page.evaluate(
    ([lid, b]) => {
      const L = window.__bozzetto.lighting;
      const light = L.lights[lid];
      const cam = light.shadow.camera;
      // As three places it at the map's next draw.
      const p = light.position.clone().setFromMatrixPosition(light.matrixWorld);
      const t = p.clone().setFromMatrixPosition(light.target.matrixWorld);
      cam.position.copy(p);
      cam.lookAt(t);
      cam.updateMatrixWorld();
      let worst = 0;
      const w = cam.right - cam.left;
      for (let i = 0; i < 8; i++) {
        const q = p.clone().set(i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]).applyMatrix4(cam.matrixWorldInverse);
        worst = Math.max(worst, cam.left - q.x, q.x - cam.right, cam.bottom - q.y, q.y - cam.top, cam.near + q.z, -q.z - cam.far);
      }
      return [worst <= 1e-6 * w, worst / w];
    },
    [id, box],
  );

/** The canvas as last drawn, kept in the page under `key` (read after the viewer's frame). */
const snapshot = (page, key) =>
  page.evaluate(
    (k) =>
      new Promise((ok) =>
        requestAnimationFrame(() => {
          const src = window.__bozzetto.captureCanvas;
          const c = document.createElement('canvas');
          c.width = src.width;
          c.height = src.height;
          const ctx = c.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(src, 0, 0);
          (window.__shots ??= {})[k] = { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data };
          ok();
        }),
      ),
    key,
  );

/**
 * Luminance along a world segment, from a kept frame: n samples from a to b,
 * each projected through the camera onto the frame. Returns [s (0..1), lum].
 */
const profile = (page, key, a, b, n = 600) =>
  page.evaluate(
    ([k, A, B, N]) => {
      const v = window.__bozzetto;
      const shot = window.__shots[k];
      const out = [];
      const p = v.camera.position.clone();
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        p.set(A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s, A[2] + (B[2] - A[2]) * s).project(v.camera);
        const x = Math.round(((p.x + 1) / 2) * shot.w);
        const y = Math.round(((1 - p.y) / 2) * shot.h);
        if (x < 0 || y < 0 || x >= shot.w || y >= shot.h) continue;
        const j = (y * shot.w + x) * 4;
        out.push([s, 0.2126 * shot.d[j] + 0.7152 * shot.d[j + 1] + 0.0722 * shot.d[j + 2]]);
      }
      return out;
    },
    [key, a, b, n],
  );

/** The 10%-90% rise of a profile that goes from dark to light, as a share of the segment. */
const rise = (prof) => {
  const lums = prof.map(([, l]) => l);
  const lo = Math.min(...lums);
  const hi = Math.max(...lums);
  const at = (f) => prof.find(([, l]) => l >= lo + (hi - lo) * f)?.[0] ?? NaN;
  return { width: at(0.9) - at(0.1), lo, hi };
};

/** Let the still frame settle (its smoothing), the view as it is. */
const still = async (page) => {
  await page.waitForFunction(() => window.__bozzetto.frameMode().kind === null, null, { timeout: 20_000 });
  await frames(page, 12);
};

/** A sculpt session on the high tier, the sphere alone, the camera stopped. */
const sculpt = async (page, base) => {
  await openSculpt(page, base, '&q=high');
  await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 60_000 });
  await frames(page, 6);
};

/**
 * A page of its own, in a context of its own (nothing saved by the last
 * part comes back in the next), its errors failing the suite.
 */
const fresh = async (page, t, spare) => {
  const browser = page.context().browser();
  // One page drawing at a time: a software renderer shares the machine.
  if (spare.length) await spare.pop().close();
  else await page.goto('about:blank');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  spare.push(ctx);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => t.ok(false, `no page errors: ${e}`));
  return p;
};

export const suites = {
  async shadows(page, base, t) {
    const spare = [];
    try {
      await shadowParts(page, base, t, spare);
    } finally {
      for (const ctx of spare) await ctx.close();
    }
  },
};

async function shadowParts(page, base, t, spare) {
  await sculpt(page, base);
  // The owner's case: the key light's softness off.
  await page.evaluate(() => window.__bozzetto.lighting.setSoftness('key', 0));
  await frames(page, 3);
  const sphere = await subject(page);
  const R = sphere.r;
  let f = await fit(page);
  const old = (6 * R) / 2048; // the old fit: three radii either side, a 2048 key map
  t.ok(Math.abs(f.subjectRadius - R) < R * 0.01, `the shadows fit the sphere's live bounds (radius ${r3(f.subjectRadius)}, box ${r3(R)})`);
  const framed = f.lights.key.texel;
  t.ok(
    framed < old * 0.5 && !f.closeUp,
    `framed whole, the key's texel at the subject is ${r3(framed)} against the old fit's ${r3(old)} (${r3(framed / old)}x; frustum ${r3(f.lights.key.width)} for a ${r3(2 * R)} sphere)`,
  );

  // Close: the camera half a radius off the sphere's front (its radius
  // the box's half-width; R above is the box's bounding radius).
  const C = sphere.c;
  const a = (sphere.max[0] - sphere.min[0]) / 2;
  const close = { pos: [C[0], C[1] + 0.2 * a, C[2] + 1.5 * a], target: [C[0], C[1] + 0.2 * a, C[2] + a] };
  await place(page, close.pos, close.target);
  f = await fit(page);
  const near = f.lights.key.texel;
  t.ok(f.closeUp, `a close framing engages the close-up fit (frustum ${r3(f.lights.key.width)})`);
  t.ok(near <= old / 3, `there the key's texel is ${r3(near)} against the old fit's ${r3(old)}: ${r3(old / near)}x finer (at most a third)`);
  // Everything in view is covered: the frustum holds what the camera
  // sees of the sphere (the visible cap's corners).
  const cap = await page.evaluate(([c, rad]) => {
    // Camera rays near the view's corners and centre, against the sphere
    // (its radius the box's half-width).
    const v = window.__bozzetto;
    const cam = v.camera;
    const o = cam.position;
    const hits = [];
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
      const d = o.clone().set(x * 0.98, y * 0.98, 0.5).unproject(cam).sub(o).normalize();
      const oc = o.clone().set(o.x - c[0], o.y - c[1], o.z - c[2]);
      const bq = oc.dot(d);
      const disc = bq * bq - (oc.lengthSq() - rad * rad);
      if (disc < 0) continue;
      hits.push(o.clone().addScaledVector(d, -bq - Math.sqrt(disc)).toArray());
    }
    return hits;
  }, [C, a]);
  if (cap?.length) {
    const box = { min: [0, 1, 2].map((i) => Math.min(...cap.map((p) => p[i]))), max: [0, 1, 2].map((i) => Math.max(...cap.map((p) => p[i]))) };
    const [ok, over] = await covers(page, 'key', box);
    t.ok(ok, `and covers the part of the sphere in view (${cap.length} rays, overshoot ${r3(over)})`);
  }

  // Hysteresis: still, no refit from frame to frame; out again in small
  // steps, close-up releases further out than it engaged coming in.
  const before = (await fit(page)).refits;
  await frames(page, 10);
  t.eq((await fit(page)).refits, before, 'held still, the fit is not redone frame after frame');
  const dist = (d) => [C[0], C[1] + 0.2 * a, C[2] + a + d * a];
  const tgt = [C[0], C[1] + 0.2 * a, C[2] + a];
  const sweep = [];
  for (const d of [0.5, 0.8, 1.2, 1.6, 2, 2.5, 3, 3.5, 4, 5]) {
    await place(page, dist(d), tgt);
    sweep.push([d, (await fit(page)).closeUp]);
  }
  for (const d of [4, 3.5, 3, 2.5, 2, 1.6, 1.2, 0.8, 0.5]) {
    await place(page, dist(d), tgt);
    sweep.push([-d, (await fit(page)).closeUp]);
  }
  const released = sweep.find(([d, on]) => d > 0 && !on)?.[0];
  const engaged = sweep.find(([d, on]) => d < 0 && on)?.[0];
  t.ok(
    released !== undefined && engaged !== undefined && released > -engaged,
    `close-up releases going out at ${released} radii off the surface and engages coming back at ${engaged === undefined ? '-' : -engaged}: room between (${sweep.map(([d, on]) => `${d}${on ? '+' : '-'}`).join(' ')})`,
  );

  // A refit builds and allocates nothing: counters across close-up
  // engaging, releasing, and an object moved and scaled.
  await place(page, dist(5), tgt);
  await still(page);
  const c0 = await counters(page);
  const r0 = (await fit(page)).refits;
  await place(page, close.pos, close.target);
  await still(page);
  await place(page, dist(5), tgt);
  await still(page);
  const c1 = await counters(page);
  const r1 = (await fit(page)).refits;
  t.ok(r1 > r0, `the close-up and back refit the shadows (${r1 - r0} refits)`);
  t.eq(show(grew(c0, c1)), '{}', 'and not one build, compile or allocation came of it');

  // An object added and moved: the frustum follows it; scaled, it grows.
  // The matrix as the gizmo leaves it: the vendor's, and the display's.
  const setMatrix = (fn) =>
    page.evaluate((src) => {
      const { session, viewer } = window.__sculpt;
      const m = session.getMesh().getMatrix();
      new Function('m', src)(m);
      viewer.setSculptMatrix(viewer.camera.matrix.clone().fromArray(m));
      // Framed whole, as shift+f does: the close-up fit is off.
      window.__sculpt.input.hooks.frameAll();
      viewer.haltOrbit();
    }, fn);
  await page.evaluate(() => window.__sculpt.session.addPrimitive('cube'));
  await frames(page, 4);
  const c2 = await counters(page);
  await setMatrix(`m[12] = ${2.6 * R};`);
  await frames(page, 4);
  const both = await subject(page);
  let [ok, over] = await covers(page, 'key', both);
  f = await fit(page);
  t.ok(ok && !f.closeUp && both.max[0] > sphere.max[0] + R, `a cube added and moved aside, both framed: the key's frustum covers both (${r3(f.lights.key.width)} wide, overshoot ${r3(over)})`);
  const wide1 = f.lights.key.width;
  await setMatrix('for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) m[i] *= 2;');
  await frames(page, 4);
  const scaled = await subject(page);
  [ok, over] = await covers(page, 'key', scaled);
  f = await fit(page);
  t.ok(ok && f.lights.key.width > wide1 * 1.05, `scaled twice its size: covered still, the frustum grown from ${r3(wide1)} to ${r3(f.lights.key.width)}`);
  t.eq(show(grew(c2, await counters(page))), '{}', 'moving and scaling it refit the shadows without a build or an allocation');
  // ...and back where it was, the frustum tightens again.
  await page.evaluate(() => {
    const s = window.__sculpt.session;
    s.deleteMesh(s.getMesh());
  });
  await frames(page, 4);
  f = await fit(page);
  t.ok(f.lights.key.width < wide1 * 0.8, `the cube deleted, the frustum tightens back to the sphere (${r3(f.lights.key.width)})`);

  // Softness reads the same at two framings: the edge of the sphere's
  // ground shadow, a soft key on it, seen from far and from close (the
  // close-up fit several times tighter), measured in world units along
  // the shadow's long axis.
  page = await fresh(page, t, spare);
  await sculpt(page, base);
  await page.evaluate(() => {
    const v = window.__bozzetto;
    v.lighting.setSoftness('key', 3);
    v.setGround('shadow');
  });
  await frames(page, 4);
  const geo = await page.evaluate(() => {
    const v = window.__bozzetto;
    const b = v.liveShadowBox();
    const c = b.getCenter(b.min.clone());
    const light = v.lighting.lights.key;
    const d = light.position.clone().setFromMatrixPosition(light.matrixWorld).sub(c.clone().setFromMatrixPosition(light.target.matrixWorld)).normalize();
    return { c: c.toArray(), a: (b.max.x - b.min.x) / 2, d: d.toArray(), y: v.ground.position.y };
  });
  // The shadow's centre on the ground, its long axis, and the far tip.
  const [dx, dy, dz] = geo.d;
  const drop = (geo.c[1] - geo.y) / dy;
  const cg = [geo.c[0] - dx * drop, geo.y, geo.c[2] - dz * drop];
  const hl = Math.hypot(dx, dz);
  const h = [-dx / hl, 0, -dz / hl];
  const semi = geo.a / dy; // a over the sine of the elevation
  const along = (k) => [cg[0] + h[0] * semi * k, geo.y, cg[2] + h[2] * semi * k];
  const tip = along(1);
  const seg = [along(0.7), along(1.3)];
  const segLen = semi * 0.6;
  const edgeAt = async (height, label) => {
    // From above the tip, a little to one side so the view has an up.
    await place(page, [tip[0] + 0.3 * height, geo.y + height, tip[2] + 0.4 * height], tip);
    // The rig follows the view in Sculpt; held world-fixed here, so both
    // framings are lit alike.
    await page.evaluate(() => window.__bozzetto.lighting.setRigFollow(null));
    await frames(page, 3);
    await still(page);
    await snapshot(page, label);
    const prof = await profile(page, label, seg[0], seg[1]);
    return { ...rise(prof), fit: await fit(page), n: prof.length };
  };
  const far = await edgeAt(geo.a * 7, 'far');
  const nearEdge = await edgeAt(geo.a * 1.6, 'near');
  const wFar = far.width * segLen;
  const wNear = nearEdge.width * segLen;
  t.ok(
    nearEdge.fit.lights.key.width < far.fit.lights.key.width / 1.5,
    `the two framings fit the key differently (${r3(far.fit.lights.key.width)} wide from far, ${r3(nearEdge.fit.lights.key.width)} close${nearEdge.fit.closeUp ? ', close-up' : ''})`,
  );
  t.ok(
    far.hi - far.lo > 8 && nearEdge.hi - nearEdge.lo > 8 && Math.abs(wNear - wFar) <= 0.3 * Math.max(wNear, wFar),
    `and the shadow's edge is as soft in the scene at both: ${r3(wFar)} from far, ${r3(wNear)} close (blur ${r3(far.fit.lights.key.radius)} and ${r3(nearEdge.fit.lights.key.radius)} texels; contrast ${r3(far.hi - far.lo)}, ${r3(nearEdge.hi - nearEdge.lo)})`,
  );

  // The rim casts (owner: "otherwise it goes through the model"): lit by
  // the rim alone, the floor in the sphere's rim shadow stays dark beside
  // floor as far from the sphere on the lit side.
  page = await fresh(page, t, spare);
  await sculpt(page, base);
  await page.evaluate(() => {
    const L = window.__bozzetto.lighting;
    L.setEnabled('key', false);
    L.setEnabled('fill', false);
    L.setEnabled('rim', true);
    L.setIntensity('rim', 4);
    L.applyState({ ambient: { intensity: 0.05, sky: '#ffffff', ground: '#ffffff' } });
    window.__bozzetto.setGround('floor');
  });
  await frames(page, 4);
  const rim = await page.evaluate(() => {
    const v = window.__bozzetto;
    const b = v.liveShadowBox();
    const c = b.getCenter(b.min.clone());
    const light = v.lighting.lights.rim;
    const d = light.position.clone().setFromMatrixPosition(light.matrixWorld).sub(c.clone().setFromMatrixPosition(light.target.matrixWorld)).normalize();
    return { c: c.toArray(), a: (b.max.x - b.min.x) / 2, d: d.toArray(), y: v.ground.position.y, casts: v.lighting.casts('rim'), passes: v.passCounts().shadows.rim };
  });
  {
    const [rx, ry, rz] = rim.d;
    const drop2 = (rim.c[1] - rim.y) / ry;
    const hl2 = Math.hypot(rx, rz);
    const hh = [-rx / hl2, -rz / hl2];
    const off = Math.hypot(rx * drop2, rz * drop2) + 0.9 * (rim.a / ry);
    const shade = [rim.c[0] + hh[0] * off, rim.y, rim.c[2] + hh[1] * off];
    const lit = [rim.c[0] - hh[0] * off, rim.y, rim.c[2] - hh[1] * off];
    await place(page, [rim.c[0] + 0.5 * rim.a, rim.y + 12 * rim.a, rim.c[2] + 1.5 * rim.a], [rim.c[0], rim.y, rim.c[2]]);
    await page.evaluate(() => window.__bozzetto.lighting.setRigFollow(null));
    await frames(page, 3);
    await still(page);
    await snapshot(page, 'rim');
    const at = async (p) => (await profile(page, 'rim', p, p, 1))[0]?.[1] ?? NaN;
    const dark = await at(shade);
    const bright = await at(lit);
    const passes = (await page.evaluate(() => window.__bozzetto.passCounts().shadows.rim)) - rim.passes;
    t.ok(rim.casts && passes > 0, `the rim light casts on the high tier (${passes} rim shadow passes since it came on)`);
    t.ok(
      bright - dark > 25 && dark < bright * 0.75,
      `the floor the sphere hides from the rim stays unlit by it: ${r3(dark)} in its shadow against ${r3(bright)} as far out on the lit side`,
    );
    // Its Casts shadow box still works: off, the rim casts nothing and
    // lights that floor again.
    await page.evaluate(() => window.__bozzetto.lighting.setShadow('rim', false));
    await frames(page, 3);
    await still(page);
    await snapshot(page, 'rimOff');
    const through = (await profile(page, 'rimOff', shade, shade, 1))[0]?.[1] ?? NaN;
    const unticked = await page.evaluate(() => {
      const L = window.__bozzetto.lighting;
      return { casts: L.casts('rim'), box: L.state().find((l) => l.id === 'rim').castShadow };
    });
    t.ok(!unticked.casts && !unticked.box && through > dark + 25, `with its Casts shadow box off the rim casts nothing, and the floor behind the sphere is lit (${r3(through)}, ${r3(dark)} with it on)`);
  }

  // Looks saved before the rim cast by default have its box unticked only
  // because that was the default: read without the lighting record's
  // version mark, the rim casts; a record with it is taken as saved. A
  // look, a .bozz file (through the sanitiser the autosave shares) and a
  // project's manifest.
  {
    const rimOf = () =>
      page.evaluate(() => {
        const L = window.__bozzetto.lighting;
        return { box: L.state().find((l) => l.id === 'rim').castShadow, casts: L.casts('rim'), v: L.serialize().v };
      });
    const viaLook = (strip) =>
      page.evaluate(async (old) => {
        const v = window.__bozzetto;
        const look = v.getLook();
        look.lighting.rim = { ...look.lighting.rim, enabled: true, castShadow: false };
        if (old) delete look.lighting.v;
        v.lighting.setShadow('rim', true);
        await v.applyLook(look);
      }, strip);
    await viaLook(true);
    let r = await rimOf();
    t.ok(r.box && r.casts && r.v === 2, `a look saved before the version mark, rim unticked, comes back with the rim casting, and is saved again as version ${r.v}`);
    await viaLook(false);
    r = await rimOf();
    t.ok(!r.box && !r.casts, 'one saved since with the box unticked comes back unticked');
    const file = await page.evaluate(async () => {
      const { file } = window.__sculpt;
      const bytes = await file.pack();
      window.__bozzetto.lighting.setShadow('rim', true);
      await file.open(bytes);
    });
    r = await rimOf();
    t.ok(file === undefined && !r.box && !r.casts, 'and so does a .bozz file saved with it unticked: the mark survives the sanitiser');
    const viaManifest = async (lighting) => {
      await page.unroute('**/timelapses/demo/manifest.json');
      await page.route('**/timelapses/demo/manifest.json', async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, json: { ...(await res.json()), lighting } });
      });
      // A minute: on SwiftShader, leaving a page still drawing takes a while.
      await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
      return rimOf();
    };
    const rimOff = { enabled: true, intensity: 2.4, color: '#ffffff', azimuth: 160, elevation: 50, castShadow: false, softness: 6 };
    r = await viaManifest({ rim: rimOff });
    t.ok(r.box && r.casts, 'a project published before the mark, rim unticked, opens in the viewer with the rim casting');
    r = await viaManifest({ v: 2, rim: rimOff });
    t.ok(!r.box && !r.casts, 'and one published since with it unticked opens unticked');
    await page.unroute('**/timelapses/demo/manifest.json');
  }

  // The low tier (phones and tablets) gives the rim a map of its own, and
  // it casts by default there too.
  page = await fresh(page, t, spare);
  await openSculpt(page, base, '&q=low');
  await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 60_000 });
  const low = await page.evaluate(() => {
    const L = window.__bozzetto.lighting;
    L.setEnabled('rim', true);
    const rimState = L.state().find((l) => l.id === 'rim');
    return { casts: L.casts('rim'), box: rimState.castShadow, can: rimState.canShadow, map: L.lights.rim.shadow.mapSize.x };
  });
  t.ok(low.casts && low.box && low.can && low.map === 512, `on the low tier the rim casts by default, from a ${low.map} map`);

  // The viewer and Sculpt fit one subject under one look alike: the
  // published model's bounds and look, and in Sculpt a cube scaled to
  // exactly those bounds under the same look and camera.
  page = await fresh(page, t, spare);
  await page.goto(`${base}/?tl=demo&q=high`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
  await frames(page, 6);
  // Each fitted afresh (a light's setting touched), so neither carries the
  // room an earlier fit left.
  const afresh = (p) =>
    p.evaluate(async () => {
      const L = window.__bozzetto.lighting;
      L.setIntensity('key', L.state()[0].intensity);
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    });
  await afresh(page);
  const pub = await page.evaluate(() => {
    const v = window.__bozzetto;
    const b = v.liveShadowBox();
    return { box: { min: b.min.toArray(), max: b.max.toArray() }, look: v.getLook(), fit: v.lighting.fitInfo(), aspect: v.camera.aspect, ground: v.getGround() };
  });
  page = await fresh(page, t, spare);
  await sculpt(page, base);
  await page.evaluate(async ([box, look]) => {
    const { session, viewer, input } = window.__sculpt;
    const cube = session.addPrimitive('cube');
    for (const other of [...session.getMeshes()]) if (other !== cube) session.deleteMesh(other);
    // The cube's own bound mapped onto the published box: scale and move.
    const m = cube.getMatrix();
    m.fill(0);
    m[15] = 1;
    m[0] = m[5] = m[10] = 1;
    const l = cube.getLocalBound();
    for (let i = 0; i < 3; i++) {
      const k = (box.max[i] - box.min[i]) / (l[i + 3] - l[i]);
      m[i * 5] = k;
      m[12 + i] = box.min[i] - k * l[i];
    }
    viewer.setSculptMatrix(viewer.camera.matrix.clone().fromArray(m));
    input.hooks.frameAll();
    await viewer.applyLook(look);
    viewer.haltOrbit();
  }, [pub.box, pub.look]);
  await frames(page, 4);
  await page.evaluate(() => window.__bozzetto.lighting.setRigFollow(null));
  await frames(page, 4);
  await afresh(page);
  const mine = await page.evaluate(() => {
    const v = window.__bozzetto;
    const b = v.liveShadowBox();
    return { box: { min: b.min.toArray(), max: b.max.toArray() }, fit: v.lighting.fitInfo(), aspect: v.camera.aspect, ground: v.getGround() };
  });
  const boxOff = Math.max(...[0, 1, 2].flatMap((i) => [Math.abs(mine.box.min[i] - pub.box.min[i]), Math.abs(mine.box.max[i] - pub.box.max[i])]));
  t.ok(boxOff < pub.fit.subjectRadius * 1e-3 && mine.ground === pub.ground, `Sculpt holds the published subject's bounds (off by ${r3(boxOff)}) on the same ground (${mine.ground})`);
  const agree = ['key', 'fill', 'rim'].map((id) => {
    const a = pub.fit.lights[id];
    const b = mine.fit.lights[id];
    // The depth range, not where it starts: the lights stand off by a
    // distance of their own, which changes nothing in the picture.
    const depth = (x) => x.far - x.near;
    const off = Math.max(Math.abs(a.width - b.width) / a.width, Math.abs(depth(a) - depth(b)) / depth(a), Math.abs(a.radius - b.radius) / Math.max(a.radius, 1e-6));
    return [id, off, a.casts === b.casts];
  });
  t.ok(
    mine.fit.closeUp === pub.fit.closeUp && agree.every(([, off, c]) => off < 0.02 && c),
    `and fits each light as the viewer does: ${agree.map(([id, off]) => `${id} ${r3(off * 100)}%`).join(', ')} apart (key ${r3(pub.fit.lights.key.width)} wide in the viewer, ${r3(mine.fit.lights.key.width)} in Sculpt; aspect ${r3(pub.aspect)} and ${r3(mine.aspect)})`,
  );

  // A tall figure framed from the waist up (the owner's case), in
  // Armature mode: the frustum fits the posed figure, and close up only
  // the part of it in view.
  page = await fresh(page, t, spare);
  await openArmature(page, base);
  await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
  await page.evaluate(() => window.__bozzetto.lighting.setSoftness('key', 0));
  await frames(page, 4);
  const fig = await page.evaluate(() => {
    const v = window.__bozzetto;
    const b = window.__armature.armature.bounds();
    const st = v.getCameraState();
    return { min: b.min.toArray(), max: b.max.toArray(), r: v.subjectRadius, cam: st, fov: v.camera.fov, fit: v.lighting.fitInfo() };
  });
  const figOld = (6 * fig.r) / 2048;
  const H = fig.max[1] - fig.min[1];
  t.ok(
    fig.fit.lights.key.texel < figOld * 0.6 && !fig.fit.closeUp,
    `the figure framed whole: the key's texel ${r3(fig.fit.lights.key.texel)} against the old fit's ${r3(figOld)} (frustum ${r3(fig.fit.lights.key.width)} for a figure ${r3(H)} tall)`,
  );
  const chest = [(fig.min[0] + fig.max[0]) / 2, fig.min[1] + 0.75 * H, (fig.min[2] + fig.max[2]) / 2];
  const back = fig.cam.position.map((p, i) => p - fig.cam.target[i]);
  const bl = Math.hypot(...back);
  const reachOut = (0.28 * H) / Math.tan(((fig.fov / 2) * Math.PI) / 180);
  await place(page, chest.map((c, i) => c + (back[i] / bl) * reachOut), chest);
  const waist = await fit(page);
  t.ok(
    waist.closeUp && waist.lights.key.texel <= figOld / 3,
    `from the waist up the close-up fit engages: texel ${r3(waist.lights.key.texel)}, ${r3(figOld / waist.lights.key.texel)}x finer than the old fit (frustum ${r3(waist.lights.key.width)})`,
  );
}
