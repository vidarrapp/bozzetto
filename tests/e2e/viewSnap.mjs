// Shift snaps the view while it is being rotated, and P switches the view
// between perspective and orthographic (package viewsnap). Each gets
// (page, base, t).
//
// viewSnap: a mouse orbit with Shift held ends exactly on a straight view
// (the camera's direction is one axis, to 1e-4), passing halfway moves to
// the next, Shift let go mid-drag turns freely again from where the view is
// (no jump), all six views are reachable, distance, target and lens do not
// change, a finger orbit with a hardware Shift held snaps the same way, a
// Shift press on the model still smooths and rotates nothing, the Smooth
// button armed does not snap, and the label shows and goes.
//
// orthographic: P and the Camera tab's switch agree both ways, the subject
// keeps its size across the switch, a stroke and the brush ring land under
// the pointer, F frames, zoom changes the size, a capture is orthographic
// (parallel edges of a cube stay parallel in the picture), the look saves
// and restores it, an old look is perspective, Shift+P shows the frame
// meter and P does not, and each workspace's guide lists P.
import { mkdirSync } from 'node:fs';
import { devices, emptySpot, openForInput, settle, strokeCount } from './smoke.mjs';
import { tapTab } from './lookTabs.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/viewsnap';
mkdirSync(SHOTS, { recursive: true });

const frames = (page, n = 2) =>
  page.evaluate(
    (k) =>
      new Promise((ok) => {
        let left = k;
        const tick = () => (--left <= 0 ? ok() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );

/** Teach the page which straight view a direction is (null for any other). */
const defineAxis = (page) =>
  page.evaluate(() => {
    window.__dirNow = () => {
      const { viewer } = window.__sculpt;
      const s = viewer.getCameraState();
      const d = s.position.map((p, i) => p - s.target[i]);
      const L = Math.hypot(...d);
      return d.map((x) => x / L);
    };
    window.__axisName = () => {
      const d = window.__dirNow();
      const views = [
        ['Right', [1, 0, 0]],
        ['Left', [-1, 0, 0]],
        ['Top', [0, 1, 0]],
        ['Bottom', [0, -1, 0]],
        ['Front', [0, 0, 1]],
        ['Back', [0, 0, -1]],
      ];
      for (const [name, a] of views) if (Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]) < 1e-4) return name;
      return null;
    };
    window.__label = () => {
      const e = document.querySelector('.view-snap');
      return e && !e.hidden && e.getClientRects().length > 0 ? e.textContent : null;
    };
  });
const axisName = (page) => page.evaluate(() => window.__axisName());
const labelNow = (page) => page.evaluate(() => window.__label());
const waitAxis = (page, name) => page.waitForFunction((n) => window.__axisName() === n, name, { timeout: 40_000, polling: 200 });
const waitLabel = (page, name) => page.waitForFunction((n) => window.__label() === n, name, { timeout: 40_000, polling: 200 });
const waitNoLabel = (page) => page.waitForFunction(() => window.__label() === null, null, { timeout: 40_000, polling: 200 });

const view = (page) =>
  page.evaluate(() => {
    const { viewer } = window.__sculpt;
    const s = viewer.getCameraState();
    const d = s.position.map((p, i) => p - s.target[i]);
    const dist = Math.hypot(...d);
    return { dir: d.map((x) => x / dist), dist, target: s.target, fov: viewer.camera.fov, focal: viewer.getFocalLength() };
  });
const angleDeg = (a, b) => (Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** A view from a direction, at the distance it has, looking at the same target. */
const lookFrom = (page, dir) =>
  page.evaluate((d) => {
    const { viewer } = window.__sculpt;
    const s = viewer.getCameraState();
    const dist = Math.hypot(...s.position.map((p, i) => p - s.target[i]));
    const L = Math.hypot(...d);
    viewer.controls.setState(
      s.target.map((v, i) => v + (d[i] / L) * dist),
      s.target,
    );
    viewer.controls.halt();
    viewer.invalidate();
  }, dir);

// A known start, level enough to be near no boundary: azimuth 11 degrees, elevation 8.
const START = [0.19, 0.14, 0.97];

/** The sphere's middle and radius on the page (px), and its radius in the world. */
const sphere = (page) =>
  page.evaluate(() => {
    const { session, viewer } = window.__sculpt;
    viewer.camera.updateMatrixWorld();
    const b = session.getMesh().computeWorldBound();
    const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    const e = viewer.camera.matrixWorld.elements;
    const R = (b[3] - b[0]) / 2;
    const edge = c.map((v, i) => v + e[i] * R);
    const r = viewer.captureCanvas.getBoundingClientRect();
    const pr = session.getPixelRatio();
    const toPage = (p) => {
      const [x, y] = session.getCamera().project(p);
      return [r.left + x / pr, r.top + y / pr];
    };
    const mid = toPage(c);
    const rim = toPage(edge);
    return { mid, px: Math.hypot(rim[0] - mid[0], rim[1] - mid[1]), R, c };
  });

const canvasHeight = (page) => page.evaluate(() => window.__sculpt.viewer.captureCanvas.getBoundingClientRect().height);

/** Press at `from` and begin turning the view, Shift not yet down. */
async function beginOrbit(page, from) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(from[0] + 4, from[1], { steps: 2 });
}
const dragTo = (page, to) => page.mouse.move(to[0], to[1], { steps: 4 });

/** P in each workspace, and each workspace's guide listing it (called at the end of the orthographic suite). */
async function keysEverywhere(page, t) {
    const ortho = () => page.evaluate(() => window.__sculpt.viewer.isOrthographic());
    const waitOrtho = (on) => page.waitForFunction((o) => window.__sculpt.viewer.isOrthographic() === o, on, { timeout: 30_000, polling: 200 });
    const guide = () =>
      page.evaluate(() => ({
        rows: [...document.querySelectorAll('.help-guide .help-row')].map((r) => `${[...r.querySelectorAll('kbd, .help-key')].map((k) => k.textContent).join('+')}: ${r.lastElementChild.textContent}`),
      }));
    const go = async (to, name) => {
      await page.evaluate((w) => window.__sculpt.studio.go(w), to);
      await page.waitForFunction((n) => document.querySelector('.bz-ws__step[aria-current="step"]')?.textContent === n, name, { timeout: 90_000 });
      if (to === 'armature') await page.waitForFunction(() => !!window.__armature && !window.__armature.isSuspended(), null, { timeout: 90_000 });
      if (to === 'present') await page.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 8000 });
      await page.waitForTimeout(300);
    };
    await page.keyboard.press('h');
    for (const [to, name] of [['sculpt', 'Sculpt'], ['paint', 'Paint'], ['armature', 'Armature'], ['present', 'Present']]) {
      if (to !== 'sculpt') await go(to, name);
      const g = await guide();
      t.ok(g.rows.includes('P: Perspective / orthographic') && g.rows.includes('Shift+P: Frame meter'), `${name}'s guide lists P for the projection and Shift+P for the frame meter`);
      if (to === 'present') await page.screenshot({ path: `${SHOTS}/guide-present.png` });
      await page.keyboard.press('h'); // closed, so the key does not land in it
      await page.mouse.move(600, 420);
      await page.keyboard.press('p');
      await waitOrtho(true);
      t.ok(await ortho(), `P switches the projection in ${name}`);
      if (to === 'armature') await page.screenshot({ path: `${SHOTS}/armature-orthographic.png` });
      await page.keyboard.press('p');
      await waitOrtho(false);
      await page.keyboard.press('h');
    }
}

export const suites = {
  async viewSnap(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await defineAxis(page);
    await page.keyboard.press('f');
    await settle(page);
    await lookFrom(page, START);
    await settle(page);
    const H = await canvasHeight(page);
    const empty = await emptySpot(page);
    t.ok(!!empty, 'a spot of bare canvas to orbit from');
    const v0 = await view(page);
    t.ok((await axisName(page)) === null, 'the start is not a straight view');

    // --- Shift goes down after the press: the view snaps, and moves on past halfway ---
    await beginOrbit(page, empty);
    await page.keyboard.down('Shift');
    await dragTo(page, [empty[0] + 0.1 * H, empty[1]]);
    await waitAxis(page, 'Front');
    t.eq(await labelNow(page), 'Front', 'a tenth of a turn from near Front is still Front, and the label says so');
    let v = await view(page);
    t.ok(angleDeg(v.dir, [0, 0, 1]) < 1e-2, `the direction is the one axis (${v.dir.map((x) => x.toFixed(5)).join(', ')})`);
    t.ok(Math.abs(v.dist - v0.dist) < v0.dist * 1e-6 && dist3(v.target, v0.target) < 1e-9 && v.fov === v0.fov && v.focal === v0.focal, `distance, target and lens are as they were (${v.dist.toFixed(5)} of ${v0.dist.toFixed(5)})`);
    await page.screenshot({ path: `${SHOTS}/snap-label-front-scene.png` });

    await dragTo(page, [empty[0] + 0.2 * H, empty[1]]);
    await waitAxis(page, 'Left');
    t.eq(await labelNow(page), 'Left', 'turned past halfway it moves to the next view, Left, and the label follows');
    v = await view(page);
    t.ok(Math.abs(v.dist - v0.dist) < v0.dist * 1e-6 && dist3(v.target, v0.target) < 1e-9 && v.fov === v0.fov, 'still the same distance, target and lens');

    // --- Shift let go mid-drag: free again from where the view is, no jump ---
    await page.keyboard.up('Shift');
    await waitNoLabel(page);
    await frames(page, 2);
    const atRelease = await view(page);
    t.ok(angleDeg(atRelease.dir, [-1, 0, 0]) < 0.06, `letting Shift go does not move the view (${angleDeg(atRelease.dir, [-1, 0, 0]).toExponential(2)} degrees)`);
    await dragTo(page, [empty[0] + 0.25 * H, empty[1]]);
    await frames(page, 3);
    const freed = await view(page);
    const turned = angleDeg(freed.dir, atRelease.dir);
    t.ok(turned > 6 && turned < 32 && (await axisName(page)) === null, `then the drag turns it freely from there (${turned.toFixed(1)} degrees, not a straight view)`);
    await page.mouse.up();
    await settle(page);

    // --- Shift held to the end: it stays on the view and does not coast ---
    await lookFrom(page, START);
    await settle(page);
    await beginOrbit(page, empty);
    await page.keyboard.down('Shift');
    await dragTo(page, [empty[0] + 0.2 * H, empty[1]]);
    await waitAxis(page, 'Left');
    await page.mouse.up();
    await frames(page, 3);
    t.eq(await axisName(page), 'Left', 'lifted with Shift still down, the view stays on Left, with no coast');
    await waitNoLabel(page);
    t.eq(await labelNow(page), null, 'the label is gone when the drag ends');
    await page.keyboard.up('Shift');
    await frames(page, 2);
    t.eq(await axisName(page), 'Left', 'and letting Shift go afterwards changes nothing');

    // --- All six views, by sideways and then up and down drags with Shift held ---
    await lookFrom(page, START);
    await settle(page);
    const seen = new Set();
    await beginOrbit(page, empty);
    await page.keyboard.down('Shift');
    for (const turns of [0.25, 0.5, 0.75, 1.0]) {
      await dragTo(page, [empty[0] + turns * H, empty[1]]);
      await page.waitForFunction(() => window.__label() !== null && window.__axisName() === window.__label(), null, { timeout: 40_000, polling: 200 });
      seen.add(await labelNow(page));
      await frames(page, 1);
    }
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await settle(page);
    await lookFrom(page, START);
    await settle(page);
    await beginOrbit(page, empty);
    await page.keyboard.down('Shift');
    await dragTo(page, [empty[0], empty[1] + 0.3 * H]);
    await waitAxis(page, 'Top');
    seen.add(await labelNow(page));
    const top = await view(page);
    t.ok(top.dir[1] > 0.9999 && Math.abs(top.dist - v0.dist) < v0.dist * 1e-6, 'Top looks straight down from the same distance');
    await dragTo(page, [empty[0], empty[1] - 0.3 * H]);
    await waitAxis(page, 'Bottom');
    seen.add(await labelNow(page));
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await settle(page);
    t.eq([...seen].sort().join(','), 'Back,Bottom,Front,Left,Right,Top', `all six views are reached (${[...seen].sort().join(',')})`);

    // --- The Smooth button armed is not Shift ---
    await lookFrom(page, START);
    await settle(page);
    await page.evaluate(() => window.__sculpt.input.setStrokeKey('smooth', 'armed', true));
    await beginOrbit(page, empty);
    await dragTo(page, [empty[0] + 0.08 * H, empty[1]]);
    await frames(page, 3);
    t.eq(await axisName(page), null, 'with Smooth armed an orbit stays free');
    t.eq(await labelNow(page), null, 'and shows no label');
    await page.mouse.up();
    await page.evaluate(() => window.__sculpt.input.setStrokeKey('smooth', 'armed', false));
    await settle(page);

    // --- Shift at the start of a press on the model is Smooth, and rotates nothing ---
    await lookFrom(page, START);
    await settle(page);
    const s = await sphere(page);
    const before = await view(page);
    const strokes0 = await strokeCount(page);
    await page.keyboard.down('Shift');
    await page.mouse.move(s.mid[0] - s.px * 0.2, s.mid[1]);
    await page.mouse.down();
    await page.mouse.move(s.mid[0] + s.px * 0.2, s.mid[1] + 6, { steps: 4 });
    await frames(page, 3);
    t.eq(await labelNow(page), null, 'a Shift press on the model shows no snap label');
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await frames(page, 2);
    const after = await view(page);
    t.ok((await strokeCount(page)) > strokes0, 'it began a stroke (Smooth)');
    t.ok(angleDeg(before.dir, after.dir) < 1e-6 && Math.abs(before.dist - after.dist) < 1e-9, 'and the view did not turn');

    // --- A finger orbit with a hardware Shift held ---
    await lookFrom(page, START);
    await settle(page);
    const dev = await devices(page);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, points, modifiers = 8) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1 })), modifiers });
    void dev;
    await touch('touchStart', [empty]);
    await touch('touchMove', [[empty[0] + 6, empty[1]]]);
    await touch('touchMove', [[empty[0] + 0.1 * H, empty[1]]]);
    await waitAxis(page, 'Front');
    t.eq(await labelNow(page), 'Front', 'a finger orbit with Shift held snaps to Front, with its label');
    await touch('touchMove', [[empty[0] + 0.2 * H, empty[1]]]);
    await waitAxis(page, 'Left');
    const tv = await view(page);
    // The earlier stroke set Sculpt's orbit pivot, which turns the view about the last edit and so moves the target along; distance and lens stay.
    t.ok(Math.abs(tv.dist - v0.dist) < v0.dist * 1e-6 && tv.fov === v0.fov, `with distance and lens unchanged (${tv.dist.toFixed(6)} of ${v0.dist.toFixed(6)})`);
    await touch('touchEnd', []);
    await frames(page, 3);
    t.eq(await axisName(page), 'Left', 'it stays on the view when the finger lifts');
    await waitNoLabel(page);

    // --- A cube snapped to Front, with its label (the picture) ---
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const sph = session.getMesh();
      session.addPrimitive('cube');
      session.deleteMesh(sph);
    });
    await page.keyboard.press('f');
    await settle(page);
    await lookFrom(page, START);
    await settle(page);
    const emptyCube = (await emptySpot(page)) ?? [60, 400];
    await beginOrbit(page, emptyCube);
    await page.keyboard.down('Shift');
    await dragTo(page, [emptyCube[0] + 0.1 * H, emptyCube[1]]);
    await waitLabel(page, 'Front');
    await frames(page, 3);
    await page.screenshot({ path: `${SHOTS}/cube-front-snapped.png` });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    t.ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  },

  async orthographic(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await defineAxis(page);
    const ortho = () => page.evaluate(() => window.__sculpt.viewer.isOrthographic());
    const waitOrtho = (on) => page.waitForFunction((o) => window.__sculpt.viewer.isOrthographic() === o, on, { timeout: 30_000, polling: 200 });
    const fovNow = () => page.evaluate(() => window.__sculpt.viewer.camera.fov);
    /** The subject's size on screen: its radius in px. */
    const size = async () => (await sphere(page)).px;
    await page.keyboard.press('f');
    await settle(page);
    await lookFrom(page, [0.6, 0.45, 0.8]);
    await settle(page);
    const persFov = await fovNow();
    const px0 = await size();
    t.ok(!(await ortho()), 'a scene starts perspective');

    // --- P switches, the subject keeps its size ---
    await page.keyboard.press('p');
    await waitOrtho(true);
    await settle(page);
    const orthoFov = await fovNow();
    const px1 = await size();
    t.ok(orthoFov < 1, `orthographic is a very long lens (${orthoFov} degrees, from ${persFov.toFixed(1)})`);
    t.ok(Math.abs(px1 / px0 - 1) < 0.02, `the subject keeps its size across the switch (${px0.toFixed(1)} px to ${px1.toFixed(1)} px)`);
    const dOrtho = (await view(page)).dist;
    await page.keyboard.press('p');
    await waitOrtho(false);
    await settle(page);
    const px2 = await size();
    t.ok(Math.abs(px2 / px0 - 1) < 0.02 && Math.abs((await fovNow()) - persFov) < 1e-9, `and back to perspective with the same lens and size (${px2.toFixed(1)} px)`);
    t.ok((await view(page)).dist < dOrtho / 10, 'the orthographic stand-in sat far away, and perspective is near again');

    // --- Shift+P is the frame meter, P is not ---
    const meter = () =>
      page.evaluate(() => {
        const m = document.querySelector('.fps-meter');
        return !!m && !m.hidden;
      });
    t.ok(!(await meter()), 'the frame meter starts off');
    await page.keyboard.press('p');
    await waitOrtho(true);
    t.ok(!(await meter()), 'P does not show the frame meter');
    await page.keyboard.press('p');
    await waitOrtho(false);
    await page.keyboard.press('Shift+P');
    await page.waitForFunction(() => {
      const m = document.querySelector('.fps-meter');
      return !!m && !m.hidden;
    }, null, { timeout: 10_000 });
    t.ok(!(await ortho()), 'Shift+P shows the frame meter and does not switch the projection');
    await page.keyboard.press('Shift+P');
    await page.waitForFunction(() => {
      const m = document.querySelector('.fps-meter');
      return !m || m.hidden;
    }, null, { timeout: 10_000 });

    // --- In orthographic: picking, a stroke, the ring, zoom, frame ---
    await page.keyboard.press('p');
    await waitOrtho(true);
    await settle(page);
    const s0 = await sphere(page);
    const at = [s0.mid[0] + s0.px * 0.3, s0.mid[1] - s0.px * 0.25];
    // Where the pointer's ray meets the sphere, by the page's own camera matrices.
    const analytic = (p) =>
      page.evaluate(
        ([x, y]) => {
          const { viewer, session } = window.__sculpt;
          const cam = viewer.camera;
          cam.updateMatrixWorld();
          const r = viewer.captureCanvas.getBoundingClientRect();
          const nx = ((x - r.left) / r.width) * 2 - 1;
          const ny = -((y - r.top) / r.height) * 2 + 1;
          const apply = (m, v) => {
            const e = m.elements;
            const w = e[3] * v[0] + e[7] * v[1] + e[11] * v[2] + e[15];
            return [
              (e[0] * v[0] + e[4] * v[1] + e[8] * v[2] + e[12]) / w,
              (e[1] * v[0] + e[5] * v[1] + e[9] * v[2] + e[13]) / w,
              (e[2] * v[0] + e[6] * v[1] + e[10] * v[2] + e[14]) / w,
            ];
          };
          const un = (z) => apply(cam.matrixWorld, apply(cam.projectionMatrixInverse, [nx, ny, z]));
          const a = un(0.3);
          const b = un(0.7);
          const d = b.map((v, i) => v - a[i]);
          const L = Math.hypot(...d);
          d.forEach((_, i) => (d[i] /= L));
          const bound = session.getMesh().computeWorldBound();
          const c = [(bound[0] + bound[3]) / 2, (bound[1] + bound[4]) / 2, (bound[2] + bound[5]) / 2];
          const R = (bound[3] - bound[0]) / 2;
          const oc = a.map((v, i) => v - c[i]);
          const bq = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2];
          const disc = bq * bq - (oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - R * R);
          if (disc < 0) return { hit: null, R, dir: d };
          const tt = -bq - Math.sqrt(disc);
          return { hit: a.map((v, i) => v + d[i] * tt), R, dir: d };
        },
        p,
      );
    const A = await analytic(at);
    t.ok(!!A.hit, 'the pointer is over the sphere');
    const picked = await page.evaluate(
      ([x, y]) => {
        const { viewer, session } = window.__sculpt;
        viewer.camera.updateMatrixWorld();
        const r = viewer.captureCanvas.getBoundingClientRect();
        const pr = session.getPixelRatio();
        return session.surfacePointAt((x - r.left) * pr, (y - r.top) * pr);
      },
      at,
    );
    t.ok(!!picked && dist3(picked, A.hit) < 0.05 * A.R, `the pick (the mesh is faceted) lands where the pointer's ray meets the sphere (${picked ? (dist3(picked, A.hit) / A.R).toFixed(4) : '-'} of the radius off)`);
    // Rays through two far-apart points run the same way: the view is orthographic to well under a degree.
    const A2 = await analytic([at[0] + 120, at[1] - 90]);
    const same = (Math.acos(Math.min(1, A.dir[0] * A2.dir[0] + A.dir[1] * A2.dir[1] + A.dir[2] * A2.dir[2])) * 180) / Math.PI;
    t.ok(same < 0.6, `rays through different points run the same way (${same.toFixed(3)} degrees apart)`);

    // The ring is under the pointer.
    await page.mouse.move(...at);
    await frames(page, 3);
    const ring = await page.evaluate(() => {
      const el = document.querySelector('.sculpt-cursor__ring:not(.sculpt-cursor__ghost)');
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, r: Math.max(b.width, b.height) / 2 };
    });
    t.ok(!!ring && Math.hypot(ring.x - at[0], ring.y - at[1]) < 0.2 * ring.r + 3, `the brush ring is under the pointer (${ring ? Math.hypot(ring.x - at[0], ring.y - at[1]).toFixed(1) : '-'} px off, ring ${ring ? ring.r.toFixed(0) : '-'} px)`);

    // A stroke lands there.
    await page.evaluate(() => {
      window.__before = Float32Array.from(window.__sculpt.session.getMesh().getVertices());
    });
    const strokes0 = await strokeCount(page);
    await page.mouse.down();
    for (const k of [1, 2, 3]) await page.mouse.move(at[0] + k * 4, at[1], { steps: 1 });
    await page.mouse.up();
    await settle(page);
    t.ok((await strokeCount(page)) > strokes0, 'a stroke began');
    await page
      .waitForFunction(() => {
        const v = window.__sculpt.session.getMesh().getVertices();
        const b = window.__before;
        for (let i = 0; i < b.length; i++) if (v[i] !== b[i]) return true;
        return false;
      }, null, { timeout: 40_000, polling: 500 })
      .catch(() => {});
    // Symmetry is on, so there is a mirrored dab on the other side of x = 0: the centre of what moved on the pointer's side is the one to read.
    const moved = await page.evaluate((hit) => {
      const mesh = window.__sculpt.session.getMesh();
      const v = mesh.getVertices();
      const b = window.__before;
      const m = mesh.getMatrix();
      // The vertices are in the object's own space, the pick in the world's.
      const world = (i) => [0, 1, 2].map((k) => m[k] * b[i] + m[4 + k] * b[i + 1] + m[8 + k] * b[i + 2] + m[12 + k]);
      let bd = 0;
      for (let i = 0; i < b.length; i += 3) bd = Math.max(bd, Math.hypot(v[i] - b[i], v[i + 1] - b[i + 1], v[i + 2] - b[i + 2]));
      if (bd <= 0) return null;
      const sum = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < b.length; i += 3) {
        if (Math.hypot(v[i] - b[i], v[i + 1] - b[i + 1], v[i + 2] - b[i + 2]) < bd * 0.4) continue;
        const w = world(i);
        if (w[0] * hit[0] <= 0) continue;
        sum[0] += w[0];
        sum[1] += w[1];
        sum[2] += w[2];
        n++;
      }
      if (!n) return null;
      return { near: Math.hypot(sum[0] / n - hit[0], sum[1] / n - hit[1], sum[2] / n - hit[2]), by: bd };
    }, A.hit);
    t.ok(!!moved && moved.near < 0.3 * A.R, `the stroke moved the surface under the pointer (${moved ? (moved.near / A.R).toFixed(3) : '-'} of the radius from the ray's hit)`);

    // F frames; zoom changes the size and keeps the lens and the limits.
    await page.mouse.move(...s0.mid);
    await page.keyboard.press('f');
    await settle(page);
    const framed = await sphere(page);
    const viewH = await canvasHeight(page);
    t.ok(framed.px * 2 < viewH && framed.px * 2 > viewH * 0.5, `F frames the subject inside the view (${(framed.px * 2).toFixed(0)} px of ${viewH.toFixed(0)})`);
    const fovFramed = await fovNow();
    await page.mouse.wheel(0, -400);
    await frames(page, 3);
    await settle(page);
    const zoomed = await sphere(page);
    t.ok(zoomed.px > framed.px * 1.1 && (await fovNow()) === fovFramed && (await ortho()), `zoom changes the size and keeps the lens (${framed.px.toFixed(0)} px to ${zoomed.px.toFixed(0)} px)`);
    // The closest zoom shows the same size in both: the dolly floor, as the visible height at the target.
    const floorSize = () =>
      page.evaluate(() => {
        const { viewer } = window.__sculpt;
        return viewer.controls.controls.minDistance * Math.tan((viewer.camera.fov * Math.PI) / 360);
      });
    const floorOrtho = await floorSize();
    await page.keyboard.press('p');
    await waitOrtho(false);
    const floorPers = await floorSize();
    t.ok(Math.abs(floorOrtho / floorPers - 1) < 0.03, `the closest zoom shows the same size in both (${floorOrtho.toExponential(3)} and ${floorPers.toExponential(3)} at the target)`);
    await page.keyboard.press('f');
    await settle(page);

    // --- A capture is orthographic: a cube's parallel edges stay parallel in the picture ---
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const sph = session.getMesh();
      session.addPrimitive('cube');
      session.deleteMesh(sph);
      window.__sculpt.viewer.setGround('off');
    });
    await page.keyboard.press('f');
    await settle(page);
    await lookFrom(page, [1, 0.62, 1]);
    await settle(page);
    const widths = async () => {
      const png = await page.evaluate(async () => {
        const { viewer } = window.__sculpt;
        viewer.invalidate();
        await new Promise((ok) => setTimeout(ok, 3000));
        const blob = await viewer.captureStill(1);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(bin);
      });
      return page.evaluate(async (a) => {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(a), (c) => c.charCodeAt(0))]));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
        const w = img.width;
        const h = img.height;
        // The background is flat: the cube is whatever differs from the corner.
        const bg = [img.data[0], img.data[1], img.data[2]];
        const inside = (x, y) => {
          const i = (y * w + x) * 4;
          return Math.abs(img.data[i] - bg[0]) + Math.abs(img.data[i + 1] - bg[1]) + Math.abs(img.data[i + 2] - bg[2]) > 36;
        };
        let top = h;
        let bottom = -1;
        const span = [];
        for (let y = 0; y < h; y++) {
          let lo = -1;
          let hi = -1;
          for (let x = 0; x < w; x++) {
            if (!inside(x, y)) continue;
            if (lo < 0) lo = x;
            hi = x;
          }
          span.push([lo, hi]);
          if (lo >= 0) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
        if (bottom < 0) return null;
        const out = [];
        for (let k = 0; k < 9; k++) {
          const y = Math.round(top + (bottom - top) * (0.35 + (0.3 * k) / 8));
          const [lo, hi] = span[y];
          out.push(hi - lo + 1);
        }
        return { widths: out, height: bottom - top + 1 };
      }, png);
    };
    const spread = (m) => (Math.max(...m.widths) - Math.min(...m.widths)) / (m.widths.reduce((a, b) => a + b, 0) / m.widths.length);
    const persWidths = await widths();
    await page.keyboard.press('p');
    await waitOrtho(true);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}/cube-orthographic.png` });
    const orthoWidths = await widths();
    t.ok(!!persWidths && !!orthoWidths, 'both captures show the cube');
    await page.keyboard.press('p');
    await waitOrtho(false);
    await page.keyboard.press('p');
    await waitOrtho(true);
    if (persWidths && orthoWidths) {
      t.ok(spread(orthoWidths) < 0.012, `in an orthographic capture the cube's two vertical edges stay the same distance apart (width varies ${(spread(orthoWidths) * 100).toFixed(2)}%: ${orthoWidths.widths.join(' ')})`);
      t.ok(spread(persWidths) > spread(orthoWidths) * 2 + 0.005, `where in perspective they do not (varies ${(spread(persWidths) * 100).toFixed(2)}%: ${persWidths.widths.join(' ')})`);
    }

    // --- The look saves it, an old look is perspective ---
    const look = await page.evaluate(() => JSON.parse(JSON.stringify(window.__sculpt.viewer.getLook())));
    t.eq(look.camera.projection, 'orthographic', 'the look says orthographic');
    await page.keyboard.press('p');
    await waitOrtho(false);
    t.eq(await page.evaluate(() => window.__sculpt.viewer.getLook().camera.projection ?? null), null, 'a perspective look says nothing of it');
    await page.evaluate((l) => window.__sculpt.viewer.applyLook(l), look);
    await waitOrtho(true);
    t.ok((await view(page)).fov < 1, 'applying it brings orthographic back');
    const old = JSON.parse(JSON.stringify(look));
    delete old.camera.projection;
    await page.evaluate((l) => window.__sculpt.viewer.applyLook(l), old);
    await waitOrtho(false);
    t.ok(Math.abs((await fovNow()) - persFov) < 1e-9, 'a look from before has no projection and loads perspective');

    // --- Present: the Camera tab's switch and the P key agree both ways ---
    await page.evaluate(() => window.__sculpt.present.enter());
    await page.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 8000 });
    await tapTab(page, 'panel--camera');
    await page.waitForSelector('.panel--camera select[aria-label="Projection"]', { timeout: 10_000 });
    const panel = () =>
      page.evaluate(() => {
        const sel = document.querySelector('.panel--camera select[aria-label="Projection"]');
        const lens = [...document.querySelectorAll('.panel--camera .section > label')].find((l) => l.textContent.startsWith('Lens'));
        const slider = lens?.querySelector('input');
        return {
          value: sel?.value,
          lensOff: !!slider?.disabled,
          lensDim: !!lens && Number(getComputedStyle(lens).opacity) < 1,
          readout: document.querySelector('.bz-readout__lens')?.textContent ?? null,
          options: sel ? [...sel.options].map((o) => o.textContent).join('/') : '',
        };
      });
    let ps = await panel();
    t.eq(ps.options, 'Perspective/Orthographic', 'the Camera tab has a Projection switch, Perspective or Orthographic');
    t.ok(ps.value === 'perspective' && !ps.lensOff && /^\d+ mm$/.test(ps.readout), `perspective: the lens is live and the strip reads ${ps.readout}`);
    await page.selectOption('.panel--camera select[aria-label="Projection"]', 'orthographic');
    await waitOrtho(true);
    await page.waitForFunction(() => document.querySelector('.bz-readout__lens')?.textContent === 'Orthographic', null, { timeout: 30_000, polling: 250 }).catch(() => {});
    ps = await panel();
    t.ok(ps.lensOff && ps.lensDim && ps.readout === 'Orthographic', `the tab's switch makes it orthographic: the lens row is greyed and the strip reads "${ps.readout}"`);
    await page.screenshot({ path: `${SHOTS}/present-camera-projection.png` });
    await page.mouse.move(640, 420);
    await page.keyboard.press('p');
    await waitOrtho(false);
    await page.waitForFunction(() => document.querySelector('.panel--camera select[aria-label="Projection"]')?.value === 'perspective', null, { timeout: 10_000 });
    await page.waitForFunction(() => /^\d+ mm$/.test(document.querySelector('.bz-readout__lens')?.textContent ?? ''), null, { timeout: 30_000, polling: 250 }).catch(() => {});
    ps = await panel();
    t.ok(!ps.lensOff && /^\d+ mm$/.test(ps.readout), `P switches back and the tab follows (${ps.value}, ${ps.readout})`);
    await page.keyboard.press('p');
    await waitOrtho(true);
    await page.waitForFunction(() => document.querySelector('.panel--camera select[aria-label="Projection"]')?.value === 'orthographic', null, { timeout: 10_000 });
    t.ok(true, 'and P to orthographic updates the tab');

    // --- The look is kept with the scene: a reload brings it back ---
    await page.selectOption('.panel--camera select[aria-label="Projection"]', 'perspective');
    await page.selectOption('.panel--camera select[aria-label="Projection"]', 'orthographic');
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__sculpt.present.leave());
    await page.reload();
    await page.waitForFunction(() => !!window.__sculpt?.viewer && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await page.waitForFunction(() => window.__sculpt.viewer.isOrthographic(), null, { timeout: 30_000, polling: 250 }).then(
      () => t.ok(true, 'a reload brings orthographic back with the scene'),
      () => t.ok(false, 'a reload brings orthographic back with the scene'),
    );
    await page.evaluate(() => window.__sculpt.viewer.setOrthographic(false));
    await keysEverywhere(page, t);
    t.ok(errors.length === 0, `no page errors (${errors.join(' | ')})`);
  },
};
