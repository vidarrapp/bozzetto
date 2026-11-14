// Where Sculpt's zoom heads (owner request, 2026-11-01): toward the last
// edit, the point the orbit pivots on, once a stroke has set it; before
// that (a fresh scene, or after a frame) toward the surface under the
// pointer, or under the middle of a pinch; off the model, toward the
// target as it always did. A zoom toward a point keeps that point where it
// is on the screen and brings the camera closer to it.
//
// zoomFocus:
// - fresh scene, the mouse over an off-centre point of the sphere: a wheel
//   notch keeps that surface point fixed on screen (under 2 px) and moves
//   the camera toward it;
// - the mouse off the model: the wheel zooms toward the target (the target
//   stays, the camera moves along the view axis), as before;
// - after a stroke at an off-centre point: a wheel zoom with the mouse
//   somewhere else keeps the last edit fixed (not the hovered point) and
//   moves the camera toward it; zoomed in all the way it stops at the
//   floor (2% of the radius), the edit still in place;
// - after Frame: the hovered point again;
// - a two-finger pinch (CDP touch) keeps the surface point under the
//   pinch's middle fixed and zooms in.
import { camera, devices, emptySpot, line, openForInput, probe, settle } from './smoke.mjs';

// A world point on the page, in client px.
const onScreen = (page, p) =>
  page.evaluate((w) => {
    const { session, viewer } = window.__sculpt;
    viewer.camera.updateMatrixWorld();
    const [x, y] = session.getCamera().project(w);
    const r = viewer.captureCanvas.getBoundingClientRect();
    const pr = session.getPixelRatio();
    return [r.left + x / pr, r.top + y / pr];
  }, p);

// The surface point under a page point, or null off the model.
const surfaceAt = (page, [x, y]) =>
  page.evaluate(
    ([px, py]) => {
      const { session, viewer } = window.__sculpt;
      viewer.camera.updateMatrixWorld();
      const r = viewer.captureCanvas.getBoundingClientRect();
      const pr = session.getPixelRatio();
      return session.surfacePointAt((px - r.left) * pr, (py - r.top) * pr);
    },
    [x, y],
  );

// The sphere's middle and radius on the page, and its radius in the world.
const sphere = (page) =>
  page.evaluate(() => {
    const { session, viewer } = window.__sculpt;
    viewer.camera.updateMatrixWorld();
    const b = session.getMesh().computeWorldBound();
    const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
    const radius = (b[3] - b[0]) / 2;
    const e = viewer.camera.matrixWorld.elements;
    const edge = c.map((v, i) => v + e[i] * radius);
    const r = viewer.captureCanvas.getBoundingClientRect();
    const pr = session.getPixelRatio();
    const toPage = (p) => {
      const [x, y] = session.getCamera().project(p);
      return [r.left + x / pr, r.top + y / pr];
    };
    const mid = toPage(c);
    const rim = toPage(edge);
    return { mid, px: Math.hypot(rim[0] - mid[0], rim[1] - mid[1]), r: Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 };
  });

const frames = (page) => page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const at = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

/** A wheel notch in (or out, dy > 0) where the mouse is, then the frames it takes. */
async function wheel(page, dy = -200) {
  await page.mouse.wheel(0, dy);
  await frames(page);
  await settle(page);
}

export const suites = {
  async zoomFocus(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    await page.keyboard.press('3'); // Standard clay
    const s0 = await sphere(page);

    // 1. A fresh scene: the wheel zooms into the spot under the mouse.
    const hoverAt = [s0.mid[0] + s0.px * 0.45, s0.mid[1] - s0.px * 0.3];
    const hp = await probe(page, hoverAt);
    t.ok(hp.canvas && hp.hit, `the hover point (${at(hoverAt)}) is bare canvas over the sphere`);
    await page.mouse.move(...hoverAt);
    await frames(page);
    const P = await surfaceAt(page, hoverAt);
    t.ok(!!P, 'a surface point under the mouse');
    let before = await camera(page);
    let screen0 = await onScreen(page, P);
    await wheel(page);
    let after = await camera(page);
    let screen1 = await onScreen(page, P);
    t.ok(gap(screen0, screen1) < 2, `fresh scene: the hovered point stays put on screen (moved ${gap(screen0, screen1).toFixed(2)} px)`);
    t.ok(dist3(after.position, P) < dist3(before.position, P) * 0.97, `and the camera moves toward it (${dist3(before.position, P).toFixed(4)} to ${dist3(after.position, P).toFixed(4)})`);
    t.ok(dist3(after.target, before.target) > 1e-6, 'the target moves toward the point with it');

    // 2. Off the model: toward the target, as before.
    const empty = await emptySpot(page);
    t.ok(!!empty, 'a spot of bare canvas off the model');
    await page.mouse.move(...empty);
    await frames(page);
    before = await camera(page);
    await wheel(page);
    after = await camera(page);
    t.ok(dist3(after.target, before.target) < before.distance * 1e-6, `off the model the target stays (moved ${dist3(after.target, before.target).toExponential(2)})`);
    const dir0 = before.position.map((p, i) => (p - before.target[i]) / before.distance);
    const dir1 = after.position.map((p, i) => (p - after.target[i]) / after.distance);
    t.ok(dist3(dir0, dir1) < 1e-6 && after.distance < before.distance * 0.97, `and the camera comes in along the view axis (${before.distance.toFixed(4)} to ${after.distance.toFixed(4)})`);

    // 3. A stroke off-centre: the zoom heads for the last edit, wherever the mouse is.
    await page.keyboard.press('f');
    await settle(page);
    const s1 = await sphere(page);
    const strokeFrom = [s1.mid[0] - s1.px * 0.5, s1.mid[1] + s1.px * 0.15];
    const strokeTo = [s1.mid[0] - s1.px * 0.4, s1.mid[1] + s1.px * 0.3];
    await page.mouse.move(...strokeFrom);
    await page.mouse.down();
    for (const p of line(strokeFrom, strokeTo, 6).slice(1)) await page.mouse.move(...p);
    await page.mouse.up();
    const E = await page.evaluate(() => window.__sculpt.session.lastEditWorldPoint());
    t.ok(!!E, `the stroke left an edit point (${E?.map((v) => v.toFixed(3)).join(', ')})`);
    await settle(page);
    const elsewhere = [s1.mid[0] + s1.px * 0.4, s1.mid[1] - s1.px * 0.35];
    await page.mouse.move(...elsewhere);
    await frames(page);
    const H = await surfaceAt(page, elsewhere);
    t.ok(!!H, 'the mouse then hovers another point of the sphere');
    before = await camera(page);
    screen0 = await onScreen(page, E);
    const hover0 = await onScreen(page, H);
    await wheel(page);
    after = await camera(page);
    screen1 = await onScreen(page, E);
    const hover1 = await onScreen(page, H);
    t.ok(gap(screen0, screen1) < 2, `after a stroke the last edit stays put on screen (moved ${gap(screen0, screen1).toFixed(2)} px)`);
    t.ok(dist3(after.position, E) < dist3(before.position, E) * 0.97, `and the camera moves toward it (${dist3(before.position, E).toFixed(4)} to ${dist3(after.position, E).toFixed(4)})`);
    t.ok(gap(hover0, hover1) > 4, `the hovered point is not where it heads (it moved ${gap(hover0, hover1).toFixed(1)} px)`);

    // The floor still holds, toward the edit.
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -2000);
    await frames(page);
    await settle(page);
    const floor = await page.evaluate(() => {
      const { viewer } = window.__sculpt;
      const c = viewer.controls.controls;
      const s = viewer.getCameraState();
      return { dist: Math.hypot(...s.position.map((p, i) => p - s.target[i])), min: c.minDistance, near: viewer.camera.near };
    });
    t.near(floor.dist / s1.r, 0.02, 1e-4, `zoomed all the way in, the camera stops at the floor (${(floor.dist / s1.r).toFixed(4)} r)`);
    t.ok(floor.near < floor.dist / 10, 'with the near plane following it in');
    const screenFloor = await onScreen(page, E);
    t.ok(gap(screen0, screenFloor) < 2, `with the last edit still where it was on screen (${gap(screen0, screenFloor).toFixed(2)} px)`);

    // 4. Frame resets it: the hovered point again.
    await page.keyboard.press('f');
    await settle(page);
    const s2 = await sphere(page);
    const hoverAgain = [s2.mid[0] + s2.px * 0.35, s2.mid[1] + s2.px * 0.4];
    await page.mouse.move(...hoverAgain);
    await frames(page);
    const Q = await surfaceAt(page, hoverAgain);
    t.ok(!!Q, 'after Frame the mouse is over the sphere');
    before = await camera(page);
    screen0 = await onScreen(page, Q);
    const edit0 = await onScreen(page, E);
    await wheel(page);
    after = await camera(page);
    screen1 = await onScreen(page, Q);
    const edit1 = await onScreen(page, E);
    t.ok(gap(screen0, screen1) < 2, `after Frame the zoom keeps the hovered point put again (moved ${gap(screen0, screen1).toFixed(2)} px)`);
    t.ok(gap(edit0, edit1) > 4, `not the old edit (it moved ${gap(edit0, edit1).toFixed(1)} px)`);
    t.ok(dist3(after.position, Q) < dist3(before.position, Q) * 0.97, 'and the camera moves toward the hovered point');

    // 5. A pinch: the surface point under the fingers' middle stays put.
    await page.keyboard.press('f');
    await settle(page);
    const s3 = await sphere(page);
    // Whole pixels: touch points arrive rounded, and an offset of half a
    // pixel between the fingers' middle and the point measured would grow
    // with the zoom.
    const mid = [Math.round(s3.mid[0] - s3.px * 0.35), Math.round(s3.mid[1] - s3.px * 0.3)];
    const R = await surfaceAt(page, mid);
    t.ok(!!R, 'the pinch centre is over the sphere');
    before = await camera(page);
    screen0 = await onScreen(page, R);
    await dev.pair(line([mid[0] - 20, mid[1]], [mid[0] - 80, mid[1]], 3), line([mid[0] + 20, mid[1]], [mid[0] + 80, mid[1]], 3));
    await frames(page);
    await settle(page);
    after = await camera(page);
    screen1 = await onScreen(page, R);
    t.ok(after.distance < before.distance * 0.8, `the pinch zooms in (${before.distance.toFixed(4)} to ${after.distance.toFixed(4)})`);
    t.ok(gap(screen0, screen1) < 2, `and keeps the surface point under its middle put (moved ${gap(screen0, screen1).toFixed(2)} px)`);
    t.ok(dist3(after.position, R) < dist3(before.position, R) * 0.8, 'the camera moving toward it');
  },

  // File > New sculpt frames its sphere, wherever the last scene left the view.
  async newSculptFrames(page, base, t) {
    await openForInput(page, base);
    // The view somewhere else: far off and to the side, as a large scene leaves it.
    await page.evaluate(() => {
      const { viewer } = window.__sculpt;
      viewer.camera.position.set(viewer.camera.position.x + 3, viewer.camera.position.y + 2, viewer.camera.position.z * 8);
      viewer.camera.updateMatrixWorld();
    });
    await frames(page);
    await page.evaluate(() => window.__sculpt.fileActions.newScene());
    await frames(page);
    await settle(page);
    const s = await sphere(page);
    const box = await page.evaluate(() => {
      const r = window.__sculpt.viewer.captureCanvas.getBoundingClientRect();
      return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, h: r.height };
    });
    t.ok(gap(s.mid, [box.cx, box.cy]) < box.h * 0.1, `the new sphere sits in the middle of the view (${at(s.mid)} against ${at([box.cx, box.cy])})`);
    t.ok(s.px > box.h * 0.15, `and fills it, not a dot in the distance (radius ${s.px.toFixed(0)} px of ${box.h.toFixed(0)})`);
  },
};
