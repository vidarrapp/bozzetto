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
//
// touchHold: two fingers hold the model (owner report: panning by touch
// felt unresponsive). The surface point under the fingers' middle stays
// under it, to within 2 px, at every move (before the fingers lift) and
// after they lift (no coast), for a pan, a pinch and both at once; one
// finger still orbits about the target and the pen still never pans.
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

  async touchHold(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    await page.keyboard.press('3');
    await page.keyboard.press('f');
    await settle(page);
    const s0 = await sphere(page);
    const mid = [Math.round(s0.mid[0] - s0.px * 0.2), Math.round(s0.mid[1] - s0.px * 0.15)];
    const R = await surfaceAt(page, mid);
    t.ok(!!R, 'the fingers start over the sphere');
    const half = 30;
    const fingers = ([x, y], w = half) => [[x - w, y], [x + w, y]];
    const heldAt = async (where, label, tol = 2) => {
      await frames(page);
      const p = await onScreen(page, R);
      t.ok(gap(p, where) < tol, `${label}: the held point is ${gap(p, where).toFixed(2)} px from the fingers' middle`);
    };

    // 1. A pan of N px, checked at each move and after the lift.
    const N = [90, 40];
    await dev.touch('touchStart', fingers(mid));
    let before = await camera(page);
    for (let i = 1; i <= 6; i++) {
      const m = [mid[0] + (N[0] * i) / 6, mid[1] + (N[1] * i) / 6];
      await dev.touch('touchMove', fingers(m));
      if (i === 1 || i === 3 || i === 6) await heldAt(m, `pan, move ${i} of 6, fingers down`);
    }
    const panned = await camera(page);
    t.ok(Math.abs(panned.distance - before.distance) < before.distance * 1e-3, 'a pan keeps the distance');
    const end = [mid[0] + N[0], mid[1] + N[1]];
    await dev.touch('touchEnd', []);
    await heldAt(end, 'pan, after the lift');
    await settle(page);
    await heldAt(end, 'pan, once settled (no coast)');

    // 2. A pinch about the middle, the fingers' middle fixed.
    const R0 = await onScreen(page, R);
    const mid2 = [Math.round(R0[0]), Math.round(R0[1])];
    before = await camera(page);
    await dev.touch('touchStart', fingers(mid2, 20));
    let after;
    for (const w of [30, 45, 60, 80]) {
      await dev.touch('touchMove', fingers(mid2, w));
    }
    await heldAt(mid2, 'pinch out, fingers down');
    after = await camera(page);
    t.ok(after.distance < before.distance * 0.5, `the spread zooms in (${before.distance.toFixed(4)} to ${after.distance.toFixed(4)})`);
    await dev.touch('touchEnd', []);
    await heldAt(mid2, 'pinch out, after the lift');

    // 3. Both at once: spread and slide, then pinch in.
    const R1 = await onScreen(page, R);
    const m1 = [Math.round(R1[0]), Math.round(R1[1])];
    await dev.touch('touchStart', fingers(m1, 40));
    const path = [[m1[0] - 25, m1[1] + 10, 50], [m1[0] - 50, m1[1] + 20, 35], [m1[0] - 70, m1[1] + 30, 25]];
    for (const [x, y, w] of path) {
      await dev.touch('touchMove', fingers([x, y], w));
      await heldAt([x, y], 'pan and pinch together');
    }
    await dev.touch('touchEnd', []);
    await settle(page);
    await heldAt([m1[0] - 70, m1[1] + 30], 'pan and pinch, settled');

    // 4. Off the model the orbit target's depth is held: a pan follows the
    // fingers by the same rule (the target's plane moves 1:1).
    await page.keyboard.press('f');
    await settle(page);
    const empty = await emptySpot(page);
    t.ok(!!empty, 'a bare spot for the fingers');
    const e0 = [Math.round(empty[0]), Math.round(empty[1])];
    const T = await page.evaluate(() => window.__sculpt.viewer.getCameraState().target);
    const T0 = await onScreen(page, T);
    await dev.touch('touchStart', fingers(e0));
    await dev.touch('touchMove', fingers([e0[0] + 40, e0[1] + 20]));
    await dev.touch('touchMove', fingers([e0[0] + 80, e0[1] + 40]));
    await frames(page);
    const T1 = await onScreen(page, T);
    t.ok(Math.abs(T1[0] - T0[0] - 80) < 3 && Math.abs(T1[1] - T0[1] - 40) < 3, `off the model the target's plane follows the fingers (${(T1[0] - T0[0]).toFixed(1)}, ${(T1[1] - T0[1]).toFixed(1)} for 80, 40)`);
    await dev.touch('touchEnd', []);
    await settle(page);

    // 5. One finger still orbits (the target stays, the direction turns); the pen never pans.
    await page.keyboard.press('f');
    await settle(page);
    const s5 = await sphere(page);
    const o0 = await camera(page);
    const from = [Math.round(s5.mid[0] + s5.px * 1.5), Math.round(s5.mid[1])];
    await dev.finger(line(from, [from[0] - 120, from[1] + 20], 6));
    await settle(page);
    const o1 = await camera(page);
    const dir = (c) => c.position.map((p, i) => p - c.target[i]);
    t.ok(dist3(o1.target, o0.target) < o0.distance * 1e-4, 'one finger leaves the target');
    t.ok(dist3(dir(o1), dir(o0)) > o0.distance * 0.05, 'and turns the view');

    await page.keyboard.press('f');
    await settle(page);
    const s6 = await sphere(page);
    const p0 = await camera(page);
    const pa = [Math.round(s6.mid[0] - s6.px * 0.3), Math.round(s6.mid[1])];
    await dev.penDrag(line(pa, [pa[0] + 60, pa[1] + 10], 4));
    await settle(page);
    const p1 = await camera(page);
    t.ok(dist3(p1.position, p0.position) < p0.distance * 1e-6 && dist3(p1.target, p0.target) < p0.distance * 1e-6, 'a pen stroke never moves the camera');
  },

  // A big scene seen from far back with the orbit target well in front of
  // the surface (what a zoom, a fit or a frame of something else leaves):
  // OrbitControls scaled every pan by the distance to the target, so the
  // model crept across the screen at a fraction of the fingers' speed.
  async panDepth(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    await page.keyboard.press('3');
    await page.keyboard.press('f');
    await settle(page);
    const s0 = await sphere(page);
    // Camera 4 radii out, target 0.4 radii in front of it: ten times nearer than the surface.
    await page.evaluate(() => {
      const { session, viewer } = window.__sculpt;
      const b = session.getMesh().computeWorldBound();
      const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      const r = (b[3] - b[0]) / 2;
      const d = [0.3, 0.2, 1];
      const n = Math.hypot(...d);
      const pos = c.map((v, i) => v + (d[i] / n) * r * 4);
      const tgt = pos.map((v, i) => v - (d[i] / n) * r * 0.4);
      const V = viewer.camera.position.constructor;
      viewer.setCameraState(new V(...pos), new V(...tgt));
    });
    await settle(page);
    const s1 = await sphere(page);
    const mid = [Math.round(s1.mid[0] - s1.px * 0.2), Math.round(s1.mid[1] - s1.px * 0.1)];
    const R = await surfaceAt(page, mid);
    t.ok(!!R, `the sphere is under the fingers (it is ${(s1.px / s0.px).toFixed(2)} of its framed size on screen)`);
    const cam = await camera(page);
    const toSurface = dist3(cam.position, R);
    t.ok(cam.distance < toSurface * 0.3, `the orbit target is much nearer than the surface (${cam.distance.toFixed(3)} vs ${toSurface.toFixed(3)})`);
    const N = [60, 30];
    const end = [mid[0] + N[0], mid[1] + N[1]];

    // Two fingers.
    await dev.touch('touchStart', [[mid[0] - 25, mid[1]], [mid[0] + 25, mid[1]]]);
    for (let i = 1; i <= 4; i++) {
      await dev.touch('touchMove', [[mid[0] - 25 + (N[0] * i) / 4, mid[1] + (N[1] * i) / 4], [mid[0] + 25 + (N[0] * i) / 4, mid[1] + (N[1] * i) / 4]]);
    }
    await frames(page);
    let p = await onScreen(page, R);
    t.ok(gap(p, end) < 2, `two fingers: the point under them moved with them (${gap(p, end).toFixed(2)} px off)`);
    await dev.touch('touchEnd', []);
    await settle(page);
    p = await onScreen(page, R);
    t.ok(gap(p, end) < 2, `and stays after the lift (${gap(p, end).toFixed(2)} px off)`);

    // A middle-button drag (the pen barrel takes the same route), a press on the surface.
    const R2 = await surfaceAt(page, end);
    t.ok(!!R2, 'the mouse press is on the sphere');
    await page.mouse.move(...end);
    await page.mouse.down({ button: 'middle' });
    const step = [-50, -20];
    for (let i = 1; i <= 5; i++) await page.mouse.move(end[0] + (step[0] * i) / 5, end[1] + (step[1] * i) / 5);
    await settle(page);
    await page.mouse.up({ button: 'middle' });
    await settle(page);
    p = await onScreen(page, R2);
    const want = [end[0] + step[0], end[1] + step[1]];
    t.ok(gap(p, want) < 3, `middle drag: the point under the press followed the mouse (${gap(p, want).toFixed(2)} px off)`);
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

