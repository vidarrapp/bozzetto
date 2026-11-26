// Shift snaps the view while it is being rotated (package viewsnap). Each gets
// (page, base, t).
//
// viewSnap: a mouse orbit with Shift held ends exactly on a straight view
// (the camera's direction is one axis, to 1e-4), passing halfway moves to
// the next, Shift let go mid-drag turns freely again from where the view is
// (no jump), all six views are reachable, distance, target and lens do not
// change, a finger orbit with a hardware Shift held snaps the same way, a
// Shift press on the model still smooths and rotates nothing, the Smooth
// button armed does not snap, and the label shows and goes.
import { mkdirSync } from 'node:fs';
import { devices, emptySpot, openForInput, settle, strokeCount } from './smoke.mjs';

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
};
