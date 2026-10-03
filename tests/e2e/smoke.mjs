// The smoke suites: boot, the Create menu's primitives and base meshes,
// the scene-file round trip, Armature mode from the gallery's Create tile
// on, and Sculpt's input under fingers, the pen, the zoom and the Negative
// button. Each gets (page, base, t) - a fresh page, the server's origin,
// and the check collector.
import { openArmature, openSculpt } from './lib.mjs';

const count = (page) => page.evaluate(() => window.__sculpt.session.getMeshes().length);
const names = (page) => page.evaluate(() => window.__sculpt.session.getMeshes().map((m) => window.__sculpt.session.getMeshName(m)));

// The signed volume of each of the last `n` objects, over its top level's
// triangles: positive where the faces wind outward, negative for a part
// baked inside out. Keyed by name without the number a repeated name gets.
const lastVolumes = (page, n) =>
  page.evaluate((k) => {
    const s = window.__sculpt.session;
    const out = {};
    for (const m of s.getMeshes().slice(-k)) {
      const v = m.getVertices();
      const tri = m.getTriangles();
      let vol = 0;
      for (let i = 0; i < m.getNbTriangles() * 3; i += 3) {
        const a = tri[i] * 3;
        const b = tri[i + 1] * 3;
        const c = tri[i + 2] * 3;
        vol +=
          v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) +
          v[a + 1] * (v[b + 2] * v[c] - v[b] * v[c + 2]) +
          v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c]);
      }
      out[s.getMeshName(m).replace(/ \d+$/, '')] = vol / 6;
    }
    return out;
  }, n);

// The armature's figure part by part, in bind space (a mannequin's lumps
// are rigid): which bone each vertex follows (its heaviest joint), and per
// bone how many vertices, how high they reach (y, lowest and highest) and
// the signed volume of the triangles whose three corners follow it. With
// the figure's own floor and top, and the rest height of the joints the
// hip checks need, all in the same units.
const boneParts = (page) =>
  page.evaluate(() => {
    const arm = window.__armature.armature;
    const geo = arm.mesh.geometry;
    const pos = geo.getAttribute('position');
    const skin = geo.getAttribute('skinIndex');
    const weight = geo.getAttribute('skinWeight');
    const index = geo.getIndex();
    const owner = [];
    const verts = {};
    const span = {};
    let floor = Infinity;
    let top = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      let best = skin.getX(i);
      let most = weight.getX(i);
      for (const k of ['Y', 'Z', 'W']) {
        if (weight[`get${k}`](i) > most) {
          most = weight[`get${k}`](i);
          best = skin[`get${k}`](i);
        }
      }
      const bone = arm.boneOfSkinIndex(best);
      owner.push(bone);
      const y = pos.getY(i);
      verts[bone] = (verts[bone] ?? 0) + 1;
      span[bone] = [Math.min(span[bone]?.[0] ?? y, y), Math.max(span[bone]?.[1] ?? y, y)];
      floor = Math.min(floor, y);
      top = Math.max(top, y);
    }
    const volume = {};
    for (let i = 0; i < index.count; i += 3) {
      const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const bone = owner[a];
      if (!bone || owner[b] !== bone || owner[c] !== bone) continue;
      const [ax, ay, az] = [pos.getX(a), pos.getY(a), pos.getZ(a)];
      const [bx, by, bz] = [pos.getX(b), pos.getY(b), pos.getZ(b)];
      const [cx, cy, cz] = [pos.getX(c), pos.getY(c), pos.getZ(c)];
      volume[bone] = (volume[bone] ?? 0) + (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    }
    const restY = {};
    for (const name of ['thigh.L', 'thigh.R', 'spine']) restY[name] = arm.def(name).head[1] * arm.scale;
    return { verts, span, volume, floor, top, restY };
  });

// Reach each foot straight up from rest by 35% of the leg, and each hand
// up and forward by 30% of the arm, and see which way the hinge went: how
// far the knee ends up in front of the hip-to-ankle line at the knee's
// height, and the elbow in front of the shoulder-to-wrist line at its own
// (scene units, forward positive). Pins and symmetry are off meanwhile,
// so each limb answers to its own joint limits and nothing else; how far
// the handle ended from its mark says whether the reach got there at all.
const limbFolds = (page) =>
  page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const joint = (name) => arm.jointWorld(name).toArray();
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const ahead = (p, from, to) => p[2] - (from[2] + ((p[1] - from[1]) / (to[1] - from[1])) * (to[2] - from[2]));
    const rest = () => {
      arm.resetPose();
      for (const c of arm.chains()) arm.setPinned(c.id, false);
    };
    const reach = (id, to) => {
      a.reach(id, ...to);
      return dist(a.handlePosition(id), to);
    };
    const symmetry = arm.symmetry;
    arm.symmetry = false;
    const out = {};
    for (const s of ['L', 'R']) {
      rest();
      const foot = a.handlePosition(`foot.${s}`);
      const leg = dist(joint(`thigh.${s}`), foot);
      const footMiss = reach(`foot.${s}`, [foot[0], foot[1] + 0.35 * leg, foot[2]]);
      out[`knee.${s}`] = { ahead: ahead(a.hingePosition(`foot.${s}`), joint(`thigh.${s}`), joint(`foot.${s}`)), miss: footMiss, limb: leg };
      rest();
      const hand = a.handlePosition(`hand.${s}`);
      const reachOut = dist(joint(`upperarm.${s}`), hand);
      const step = (0.3 * reachOut) / Math.SQRT2;
      const handMiss = reach(`hand.${s}`, [hand[0], hand[1] + step, hand[2] + step]);
      out[`elbow.${s}`] = { ahead: ahead(a.hingePosition(`hand.${s}`), joint(`upperarm.${s}`), joint(`hand.${s}`)), miss: handMiss, limb: reachOut };
    }
    rest();
    arm.symmetry = symmetry;
    a.commit();
    return out;
  });

// The hips open wide and cross a little, and the shoulders lift further
// than they drop (owner report: the hips did the reverse, their side
// limits the wrong way round, and the clavicles' with them). The left foot
// swings 22 units out to the side, then 22 across towards the other foot,
// each time to a point on the arc its own leg sweeps about the hip: the
// ball keeps its distance from the hip and its height follows, since a leg
// cannot carry its foot sideways along the ground while the pelvis stays
// put. Either way asks the hip for 30 to 35 degrees. The foot's pin is let
// go meanwhile and put back after, and symmetry is off, so the other leg
// stays where it stands. The shoulder is turned by its Side slider as far
// as it goes each way, and how far the clavicle then points up or down is
// measured, whichever sign does which.
const hipsAndShoulders = (page) =>
  page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const symmetry = arm.symmetry;
    const pinned = arm.isPinned('foot.L');
    arm.symmetry = false;
    arm.resetPose();
    arm.setPinned('foot.L', false);
    const hip = arm.jointWorld('thigh.L').toArray();
    const ball = a.handlePosition('foot.L');
    const other = a.handlePosition('foot.R');
    const r = dist(hip, ball);
    const swing = (dx) => {
      arm.resetPose();
      const x = ball[0] + dx;
      const to = [x, hip[1] - Math.sqrt(r * r - (x - hip[0]) ** 2 - (ball[2] - hip[2]) ** 2), ball[2]];
      a.reach('foot.L', ...to);
      return {
        miss: dist(a.handlePosition('foot.L'), to),
        side: arm.getPoseEuler('thigh.L')[2],
        limits: arm.limitsOf('thigh.L').z,
        other: dist(a.handlePosition('foot.R'), other),
      };
    };
    const out = swing(22);
    const across = swing(-22);
    const pitch = () => {
      const head = arm.jointWorld('clavicle.L');
      return (Math.asin(arm.jointWorld('upperarm.L').sub(head).normalize().y) * 180) / Math.PI;
    };
    arm.resetPose();
    const rest = pitch();
    const shoulder = [-90, 90].map((z) => {
      a.turn('clavicle.L', 0, 0, z);
      const turned = pitch() - rest;
      arm.resetPose();
      return turned;
    });
    arm.setPinned('foot.L', pinned);
    arm.symmetry = symmetry;
    a.commit();
    return { out, across, lift: Math.max(...shoulder), drop: -Math.min(...shoulder) };
  });

// Pinned feet under a moving pelvis (owner report: they snapped round).
// Each scenario poses the figure, pins both feet where they stand and drags
// the pelvis as its move gizmo does - thirty small steps, each through the
// gizmo's own change handler - by (10, -15, 0), then by (12, 0, 0) more.
// Per foot and move: how far the foot ends from its pin; how far a clean
// solve gets, the same leg reset to rest under the moved pelvis and solved
// for the pin at length, which says whether the pin is within the leg's
// reach at all, joint limits included; the most the foot turned in any one
// step, which is what a snap is; and whether it was pinned standing on the
// ground - read from the pin, at the height the handle rests at, not from
// where the foot ended up, which is the thing under test.
const pinnedDrags = (page) =>
  page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const Q = arm.root.quaternion.constructor;
    const V = arm.root.position.constructor;
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const turn = (p, q) => (360 / Math.PI) * Math.acos(Math.min(1, Math.abs(p.dot(q))));
    const footQ = (s) => arm.bones.get(`foot.${s}`).getWorldQuaternion(new Q());
    const clean = (s) => {
      const saved = JSON.stringify(a.state());
      for (const b of [`thigh.${s}`, `shin.${s}`, `foot.${s}`]) arm.setPoseEuler(b, 0, 0, 0, false);
      const pin = a.state().pins[`foot.${s}`];
      arm.reach(`foot.${s}`, new V(...pin), 60, false);
      const miss = dist(a.handlePosition(`foot.${s}`), pin);
      arm.restore(JSON.parse(saved));
      return miss;
    };
    const scenarios = {
      'knee bent by a reach': () => {
        const p = a.handlePosition('foot.L');
        a.reach('foot.L', p[0], p[1] + 10, p[2] + 8);
      },
      'thigh turned by hand': () => a.turn('thigh.L', -30, 0, 10),
    };
    const home = arm.root.position.clone();
    arm.resetPose();
    const floor = { L: a.handlePosition('foot.L')[1], R: a.handlePosition('foot.R')[1] };
    const out = {};
    for (const [name, pose] of Object.entries(scenarios)) {
      arm.root.position.copy(home);
      arm.resetPose();
      for (const c of arm.chains()) arm.setPinned(c.id, false);
      pose();
      arm.setPinned('foot.L', true);
      arm.setPinned('foot.R', true);
      a.commit();
      const pins = { L: a.state().pins['foot.L'], R: a.state().pins['foot.R'] };
      out[name] = [];
      for (const [k, by] of [[10, -15, 0], [12, 0, 0]].entries()) {
        const worst = { L: 0, R: 0 };
        const last = { L: footQ('L'), R: footQ('R') };
        for (let i = 0; i < 30; i++) {
          a.moveRoot(by[0] / 30, by[1] / 30, by[2] / 30);
          for (const s of ['L', 'R']) {
            const q = footQ(s);
            worst[s] = Math.max(worst[s], turn(q, last[s]));
            last[s] = q;
          }
        }
        for (const s of ['L', 'R']) {
          out[name].push({
            by,
            then: k > 0,
            side: s,
            miss: dist(a.handlePosition(`foot.${s}`), pins[s]),
            clean: clean(s),
            worst: worst[s],
            grounded: Math.abs(pins[s][1] - floor[s]) <= 0.015 * arm.scale,
            thighSide: arm.getPoseEuler(`thigh.${s}`)[2],
            sideLimits: arm.limitsOf(`thigh.${s}`).z,
          });
        }
      }
    }
    arm.root.position.copy(home);
    arm.resetPose();
    a.commit();
    return out;
  });

// Planting, on the left foot of a standing figure. Its tilt is how far its
// rest up, carried through its world rotation, leans from world up; its
// pose is the foot's own joint angles, untouched while it only follows its
// shin. Kicked 30 units forward (further than the leg reaches), put back
// down where it stood, lifted 25; then down again with Plant feet off, and
// the box back on.
const plantingRun = (page) =>
  page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const Q = arm.root.quaternion.constructor;
    const V = arm.root.position.constructor;
    arm.resetPose();
    const rest = arm.bones.get('foot.L').getWorldQuaternion(new Q());
    const upInFoot = new V(0, 1, 0).applyQuaternion(rest.clone().invert());
    const tilt = () =>
      (180 / Math.PI) * Math.acos(Math.min(1, upInFoot.clone().applyQuaternion(arm.bones.get('foot.L').getWorldQuaternion(new Q())).y));
    const pose = () => arm.getPoseEuler('foot.L').join(',');
    const off = (to) => Math.hypot(...a.handlePosition('foot.L').map((v, i) => v - to[i]));
    const lifted = () => arm.jointWorld('foot.L').y - arm.def('foot.L').head[1] * arm.scale;
    const box = [...document.querySelectorAll('.panel--armature label.checkbox')]
      .find((l) => l.textContent.trim() === 'Plant feet')
      .querySelector('input');
    const start = a.handlePosition('foot.L');
    const out = {};
    let before = pose();
    a.reach('foot.L', start[0], start[1], start[2] + 30);
    out.kick = { tilt: tilt(), kept: pose() === before, lifted: lifted() };
    a.reach('foot.L', ...start);
    out.down = { tilt: tilt(), off: off(start) };
    before = pose();
    a.reach('foot.L', start[0], start[1] + 25, start[2]);
    out.lift = { tilt: tilt(), kept: pose() === before };
    box.click();
    out.boxOff = { plant: arm.plantFeet, saved: a.state().plant };
    before = pose();
    a.reach('foot.L', ...start);
    out.offDown = { tilt: tilt(), kept: pose() === before, off: off(start) };
    box.click();
    out.boxOn = { plant: arm.plantFeet, tilt: tilt() };
    arm.resetPose();
    a.commit();
    return out;
  });

// The root's ball against the pelvis it sits in: the ball on the page, the
// page rectangle of every vertex that follows the pelvis as posed, and how
// far the ball is in the world from the middle of the pelvis bone.
const rootBall = (page) =>
  page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const geo = arm.mesh.geometry;
    const skin = geo.getAttribute('skinIndex');
    const weight = geo.getAttribute('skinWeight');
    const { positions } = arm.bakeWorld();
    const rect = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < skin.count; i++) {
      let best = skin.getX(i);
      let most = weight.getX(i);
      for (const k of ['Y', 'Z', 'W']) {
        if (weight[`get${k}`](i) > most) {
          most = weight[`get${k}`](i);
          best = skin[`get${k}`](i);
        }
      }
      if (arm.boneOfSkinIndex(best) !== 'pelvis') continue;
      const at = a.onScreen(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
      if (!at) continue;
      rect[0] = Math.min(rect[0], at[0]);
      rect[1] = Math.min(rect[1], at[1]);
      rect[2] = Math.max(rect[2], at[0]);
      rect[3] = Math.max(rect[3], at[1]);
    }
    const mid = arm.jointWorld('pelvis').add(arm.effectorWorld('pelvis', new V(), 1)).multiplyScalar(0.5);
    const ball = a.ballOnScreen('root');
    const world = a.handlePosition('root');
    return {
      ball,
      rect,
      inside: !!ball && ball[0] > rect[0] && ball[0] < rect[2] && ball[1] > rect[1] && ball[1] < rect[3],
      offMid: Math.hypot(world[0] - mid.x, world[1] - mid.y, world[2] - mid.z),
    };
  });
const showRoot = (r) =>
  `ball at (${r.ball ? r.ball.slice(0, 2).map((v) => v.toFixed(0)).join(', ') : 'none'}), the pelvis across ` +
  `(${r.rect[0].toFixed(0)}, ${r.rect[1].toFixed(0)})-(${r.rect[2].toFixed(0)}, ${r.rect[3].toFixed(0)}), ` +
  `${r.offMid.toExponential(1)} off the bone's middle`;

// A left part and its mirror image: both facing outward, and the same size
// to within a few percent. Only signs and ratios mean anything here; the
// positions are in whatever units the object keeps them.
const mirrored = (t, left, right, what) => {
  const show = (v) => (typeof v === 'number' ? v.toPrecision(4) : String(v));
  t.ok(
    left > 0 && right > 0 && Math.abs(left - right) <= 0.03 * Math.max(left, right),
    `${what} face outward and match (volumes ${show(left)} and ${show(right)})`,
  );
};

// Sculpt's objects by name as the solo suite sees them: the vendor flag
// (what picking and the brush obey), the eye the session keeps for a save,
// and what is drawn - every display in the viewer's scene over the object's
// own vertex array (the active object's primary display, or its extra
// handle), as "shown", "hidden", "none" or "mixed". The selection outlines
// and the viewer's own wireframe mesh, which sculpt keeps hidden, share
// that array too and are left out. With the Scene panel's solo sign, the
// record a save would write, and the undo stack's depth.
const soloState = (page) =>
  page.evaluate(() => {
    const { session, viewer } = window.__sculpt;
    const drawn = (m) => {
      const seen = [];
      viewer.scene.traverse((o) => {
        if (!o.isMesh || o.name.startsWith('sculpt-') || o.material?.wireframe) return;
        if (o.geometry?.getAttribute?.('position')?.array === m.getVertices()) seen.push(o.visible);
      });
      if (!seen.length) return 'none';
      return seen.every((v) => v) ? 'shown' : seen.every((v) => !v) ? 'hidden' : 'mixed';
    };
    const objects = {};
    for (const m of session.getMeshes()) {
      objects[session.getMeshName(m)] = { flag: m.isVisible(), eye: session.eyeVisible(m), drawn: drawn(m) };
    }
    const panel = document.querySelector('.panel--scene');
    const sm = session.getStateManager();
    return {
      solo: session.isSolo(),
      active: session.activeName(),
      objects,
      sign: panel.classList.contains('panel--solo'),
      chip: getComputedStyle(panel.querySelector('.outliner__solo')).display,
      tab: getComputedStyle(panel.querySelector('.handle__note')).display,
      saved: session.serializeScene().meshes.map((r) => `${r.name}:${r.visible}`).join(' '),
      history: `${sm._undos.length}/${sm._curUndoIndex}`,
    };
  });
// "Sphere:hidden Cube:shown ...": flag and display agreeing, else both.
const showSolo = (s) =>
  Object.entries(s.objects)
    .map(([n, o]) => `${n}:${o.flag === (o.drawn === 'shown') ? o.drawn : `flag ${o.flag}/${o.drawn}`}`)
    .join(' ');

// --- touch and pen ---------------------------------------------------------
// Real device input, as the browser delivers it from the protocol: CDP's
// touch events (with touch emulation on) arrive as pointerType 'touch'
// pointers, and its mouse events with pointerType 'pen' as pen pointers
// whose pressure is the force passed. Trusted events with live pointer ids,
// so pointer capture, OrbitControls and the gizmo all see what they would
// on a tablet - which dispatchEvent copies cannot give (setPointerCapture
// throws on a pointer the browser never saw).
async function devices(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // Fingers are numbered by their place in `points`, so a finger keeps its
  // id from start to end. `timestamp` (seconds since the epoch) stamps an
  // event as the platform would; left out, the browser stamps it on arrival.
  const touch = (type, points, timestamp) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1 })), timestamp });
  const mouse = (type, [x, y], timestamp) =>
    cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, timestamp });
  // `modifiers` is the protocol's bit set: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift.
  const pen = (type, [x, y], down, modifiers = 0) =>
    cdp.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: type === 'mouseMoved' && !down ? 'none' : 'left',
      buttons: down ? 1 : 0,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      pointerType: 'pen',
      force: down ? 0.6 : 0,
      modifiers,
    });
  const mid = (path) => Math.floor(path.length / 2);
  return {
    touch,
    pen,
    mouse,
    /** One finger along a path; `during` runs halfway and its answer is returned. */
    async finger(path, during) {
      let seen;
      await touch('touchStart', [path[0]]);
      for (let i = 1; i < path.length; i++) {
        await touch('touchMove', [path[i]]);
        if (during && i === mid(path)) seen = await during();
      }
      await touch('touchEnd', []);
      return seen;
    },
    /** Two fingers together, each along its own path: a pinch or a two-finger pan. */
    async pair(a, b) {
      await touch('touchStart', [a[0], b[0]]);
      for (let i = 1; i < a.length; i++) await touch('touchMove', [a[i], b[i]]);
      await touch('touchEnd', []);
    },
    async tap(at) {
      await touch('touchStart', [at]);
      await touch('touchEnd', []);
    },
    /** The pen down along a path, hovering in first as a Pencil does; modifier keys held throughout. */
    async penDrag(path, during, modifiers = 0) {
      let seen;
      await pen('mouseMoved', path[0], false, modifiers);
      await pen('mousePressed', path[0], true, modifiers);
      for (let i = 1; i < path.length; i++) {
        await pen('mouseMoved', path[i], true, modifiers);
        if (during && i === mid(path)) seen = await during();
      }
      await pen('mouseReleased', path[path.length - 1], false, modifiers);
      return seen;
    },
  };
}

/**
 * Sculpt mode for the input suites, at the low quality tier (frames are the
 * expensive part here) and with the boot splash gone: it lies over the
 * canvas until its animation ends, and a press would land on it.
 */
async function openForInput(page, base) {
  await openSculpt(page, base, '&q=low');
  await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
}

/**
 * n + 1 points from a to b. Few: here a software renderer draws two or
 * three frames a second, and the browser hands touch and pen moves over
 * one frame at a time.
 */
const line = ([x0, y0], [x1, y1], n = 4) =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

// The view, and stopping it: OrbitControls eases out of every drag, and at
// two or three frames a second the tail would take a minute to run out.
// Halted, the view keeps whatever the drag has turned it by so far.
const camera = (page) =>
  page.evaluate(() => {
    const { viewer } = window.__sculpt;
    const s = viewer.getCameraState();
    return { position: s.position, target: s.target, distance: Math.hypot(...s.position.map((p, i) => p - s.target[i])) };
  });
const camMoved = (a, b) => Math.hypot(...a.position.map((p, i) => p - b.position[i]));
const settle = (page) =>
  page.evaluate(() => {
    window.__sculpt.viewer.haltOrbit();
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
// Put the view back exactly: a frame first, which ends the orbit's settling
// tail (it would read the jump as one more step of the drag), then the
// recorded camera.
const restoreCamera = async (page, cam) => {
  await page.evaluate((c) => {
    const { input, viewer } = window.__sculpt;
    input.hooks.frameAll();
    viewer.controls.setState(c.position, c.target);
  }, cam);
  await settle(page);
};
// Every vertex of every object, weighed by position in the array, so any
// edit anywhere changes it.
const meshSum = (page) =>
  page.evaluate(() => {
    let sum = 0;
    for (const m of window.__sculpt.session.getMeshes()) {
      const v = m.getVertices();
      for (let i = 0; i < v.length; i++) sum += v[i] * ((i % 7) + 1);
    }
    return sum;
  });
const strokeCount = (page) => page.evaluate(() => window.__sculpt.input.strokeCount());
const selected = (page) =>
  page.evaluate(() => {
    const s = window.__sculpt.session;
    return s.getSelectedMeshes().map((m) => s.getMeshName(m)).sort().join(',');
  });
// An object's middle on the page, in client px.
const screenOf = (page, name) =>
  page.evaluate((n) => {
    const { session, viewer } = window.__sculpt;
    const m = session.getMeshes().find((x) => session.getMeshName(x) === n);
    const b = m.computeWorldBound();
    const [x, y] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
    const r = viewer.captureCanvas.getBoundingClientRect();
    const pr = session.getPixelRatio();
    return [r.left + x / pr, r.top + y / pr];
  }, name);
// Whether a point is bare canvas (no panel or button over it), and whether
// a press there would land on an object.
const probe = (page, [x, y]) =>
  page.evaluate(
    ([px, py]) => {
      const { session, viewer } = window.__sculpt;
      const canvas = viewer.captureCanvas;
      const r = canvas.getBoundingClientRect();
      const pr = session.getPixelRatio();
      session._mouseX = (px - r.left) * pr;
      session._mouseY = (py - r.top) * pr;
      return { canvas: document.elementFromPoint(px, py) === canvas, hit: session.getPicking().intersectionMouseMeshes() };
    },
    [x, y],
  );
// A point of bare canvas with nothing under it.
const emptySpot = (page) =>
  page.evaluate(() => {
    const { session, viewer } = window.__sculpt;
    const canvas = viewer.captureCanvas;
    const r = canvas.getBoundingClientRect();
    const pr = session.getPixelRatio();
    for (let y = r.top + r.height * 0.3; y < r.bottom - 140; y += 23) {
      for (let x = r.left + r.width * 0.3; x < r.right - r.width * 0.3; x += 29) {
        if (document.elementFromPoint(x, y) !== canvas) continue;
        session._mouseX = (x - r.left) * pr;
        session._mouseY = (y - r.top) * pr;
        if (!session.getPicking().intersectionMouseMeshes()) return [x, y];
      }
    }
    return null;
  });
// The Preferences window's finger choice, set the way a user sets it.
const setFingers = async (page, label) => {
  await page.keyboard.press('Control+Comma');
  await page.locator('.prefs__choice', { hasText: label }).click();
  const checked = await page.evaluate(() =>
    [...document.querySelectorAll('.prefs__choice')]
      .filter((c) => c.querySelector('input').checked)
      .map((c) => c.querySelector('.prefs__choice-title').textContent)
      .join(','),
  );
  await page.keyboard.press('Escape');
  return { checked, stored: await page.evaluate(() => localStorage.getItem('bozzetto-settings')) };
};

export const suites = {
  async boot(page, base, t) {
    await openSculpt(page, base);
    t.eq(await count(page), 1, 'a new sculpt has one object');
    t.eq((await names(page))[0], 'Sphere', 'and it is the sphere');
    const faces = await page.evaluate(() => window.__sculpt.session.getMesh().getNbFaces());
    t.ok(faces >= 20000, `the sphere is subdivided (${faces} faces)`);
    const tiles = await page.evaluate(() => document.querySelectorAll('.outliner__tile').length);
    const words = await page.evaluate(() => document.querySelectorAll('.outliner__menu-grid--words .outliner__menu-item').length);
    t.eq(tiles, 23, 'the Create menu lists every base mesh');
    t.eq(words, 7, 'and every primitive');
  },

  async primitives(page, base, t) {
    await openSculpt(page, base);
    const kinds = ['sphere', 'cube', 'cylinder', 'torus', 'cone', 'capsule', 'plane'];
    for (const kind of kinds) {
      const before = await count(page);
      const r = await page.evaluate((k) => {
        const s = window.__sculpt.session;
        const m = s.addPrimitive(k);
        const mat = m.getMatrix();
        return {
          faces: m.getNbFaces(),
          name: s.getMeshName(m),
          selected: s.getMesh() === m,
          radius: m.computeLocalRadius() * Math.hypot(mat[0], mat[1], mat[2]),
        };
      }, kind);
      t.eq(await count(page), before + 1, `${kind}: one more object`);
      t.ok(r.faces >= 20000, `${kind}: subdivided to ${r.faces} faces`);
      t.ok(r.selected, `${kind}: selected after adding`);
      // normalizeSize measures the base cage; smooth subdivision then pulls
      // a sphere or a cone's apex inward, so the finished object sits a
      // little under the canonical 50.
      t.ok(r.radius > 40 && r.radius < 50.5, `${kind}: at the canonical size (radius ${r.radius.toFixed(1)})`);
      t.ok(/^[A-Z]/.test(r.name), `${kind}: named "${r.name}"`);
    }
    const total = await count(page);
    await page.evaluate(() => window.__sculpt.session.undo());
    t.eq(await count(page), total - 1, 'undo removes the last primitive');
    await page.evaluate(() => window.__sculpt.session.redo());
    t.eq(await count(page), total, 'redo puts it back');
  },

  async basemeshes(page, base, t) {
    await openSculpt(page, base);
    // A single part: the stylized hand, 880 quads in the file.
    let before = await count(page);
    const hand = await page.evaluate(async () => {
      const s = window.__sculpt.session;
      const m = await s.addBaseMesh('hand-stylized');
      const mat = m.getMatrix();
      return {
        name: s.getMeshName(m),
        faces: m.getNbFaces(),
        levels: m.getNbMeshes ? m.getNbMeshes() : -1,
        selected: s.getMesh() === m,
        radius: m.computeLocalRadius() * Math.hypot(mat[0], mat[1], mat[2]),
        translation: [mat[12], mat[13], mat[14]],
      };
    });
    t.eq(await count(page), before + 1, 'hand: one object added');
    t.eq(hand.name, 'Hand', 'hand: named after the tile');
    t.ok(hand.faces >= 20000, `hand: subdivided to ${hand.faces} faces`);
    t.ok(hand.selected, 'hand: selected');
    t.near(hand.radius, 50, 0.5, 'hand: at the canonical size');
    t.near(Math.hypot(...hand.translation), 0, 1e-3, 'hand: centred');

    // Three parts: a head and its eyes, one undo step, eyes in front (+Z).
    before = await count(page);
    const head = await page.evaluate(async () => {
      const s = window.__sculpt.session;
      const m = await s.addBaseMesh('head-stylized');
      const all = s.getMeshes();
      const parts = all.slice(all.length - 3).map((p) => {
        const mat = p.getMatrix();
        return { name: s.getMeshName(p), faces: p.getNbFaces(), z: mat[14], y: mat[13], x: mat[12] };
      });
      return { selected: s.getMesh() === m, parts };
    });
    t.eq(await count(page), before + 3, 'head: three objects added');
    t.eq(head.parts.map((p) => p.name).join(','), 'Head,Eye L,Eye R', 'head: named parts');
    t.ok(head.selected, 'head: the head is selected, not an eye');
    t.ok(head.parts[1].z > 5 && head.parts[2].z > 5, `head: eyes sit in front (z ${head.parts[1].z.toFixed(1)})`);
    t.ok(head.parts[1].x > 0 && head.parts[2].x < 0, 'head: eye L on +X, eye R on -X');
    t.ok(head.parts[1].faces < 20000, `head: an eye stops early (${head.parts[1].faces} faces)`);
    const eyes = await lastVolumes(page, 3);
    mirrored(t, eyes['Eye L'], eyes['Eye R'], 'head: the eyes');
    await page.evaluate(() => window.__sculpt.session.undo());
    t.eq(await count(page), before, 'head: one undo removes all three');
    await page.evaluate(() => window.__sculpt.session.redo());
    t.eq(await count(page), before + 3, 'head: redo brings all three back');

    // Linear subdivision keeps the planar skull's facets: the base cage's
    // vertices come first in every level, so they stay where they were,
    // where smooth subdivision (the hand) moves them.
    const drift = await page.evaluate(async () => {
      const s = window.__sculpt.session;
      const driftOf = (m) => {
        const base = m._meshes[0].getVertices();
        const top = m.getVertices();
        let d = 0;
        for (let i = 0; i < 300; i++) d = Math.max(d, Math.abs(base[i] - top[i]));
        return d;
      };
      const planar = await s.addBaseMesh('skull-planar');
      const hand = s.getMeshes().find((m) => s.getMeshName(m) === 'Hand');
      return { planarFaces: planar.getNbFaces(), planar: driftOf(planar), hand: driftOf(hand) };
    });
    t.ok(drift.planarFaces >= 20000, `planar skull: subdivided to ${drift.planarFaces} faces`);
    t.ok(drift.planar < 1e-6, `planar skull: base vertices stay put (drift ${drift.planar})`);
    t.ok(drift.hand > 1e-3, `hand: smooth subdivision moves them (drift ${drift.hand.toFixed(4)})`);

    // A blockout: the one remeshed shell by default, or every lump as its
    // own object, hierarchy order, one undo step.
    before = await count(page);
    await page.evaluate(() => window.__sculpt.session.addBaseMesh('head-blockout'));
    t.eq(await count(page), before + 1, 'blockout head: one object by default');
    before = await count(page);
    const split = await page.evaluate(async () => {
      const s = window.__sculpt.session;
      const m = await s.addBaseMesh('head-blockout', { parts: true });
      const all = s.getMeshes();
      const mine = all.slice(all.length - 11);
      return {
        n: all.length,
        first: s.getMeshName(m),
        names: mine.map((x) => s.getMeshName(x)),
        faces: mine.map((x) => x.getNbFaces()),
      };
    });
    t.eq(split.n, before + 11, 'blockout head as parts: eleven objects');
    t.ok(/^Head( \d+)?$/.test(split.first), `the head part leads and is selected (${split.first})`);
    t.ok(split.names.includes('Nose') && split.names.includes('Ear L'), `parts named: ${split.names.join(', ')}`);
    t.ok(split.faces.every((f) => f >= 1000 && f < 20000), `parts subdivided modestly (${Math.min(...split.faces)}–${Math.max(...split.faces)} faces)`);
    await page.evaluate(() => window.__sculpt.session.undo());
    t.eq(await count(page), before, 'blockout parts: one undo removes them all');
    const pills = await page.evaluate(() => [...document.querySelectorAll('.outliner__menu-pill')].map((p) => `${p.textContent}:${p.getAttribute('aria-pressed')}`));
    t.eq(pills.join(' '), 'one object:true parts:false', 'the switch defaults to one object');

    // A figure's right-hand lumps are its left ones mirrored in the bundle,
    // a negative scale that turns their faces inward unless the exporter
    // reverses them.
    before = await count(page);
    await page.evaluate(() => window.__sculpt.session.addBaseMesh('blockout-male-realistic', { parts: true }));
    const lumps = await lastVolumes(page, (await count(page)) - before);
    mirrored(t, lumps['Thigh L'], lumps['Thigh R'], 'blockout body as parts: the thighs');
    mirrored(t, lumps['Eye L'], lumps['Eye R'], 'blockout body as parts: the eyes');
    mirrored(t, lumps['Ear L'], lumps['Ear R'], 'blockout body as parts: the ears');
    await page.evaluate(() => window.__sculpt.session.undo());
    t.eq(await count(page), before, 'blockout body parts: one undo removes them all');

    // An unknown id rejects rather than adding.
    const unknown = await page.evaluate(() => window.__sculpt.session.addBaseMesh('no-such-mesh').then(() => 'added', (e) => String(e.message)));
    t.ok(/Unknown base mesh/.test(unknown), `unknown id rejects (${unknown})`);
  },

  async alphas(page, base, t) {
    await openSculpt(page, base);
    // Every stencil any tool offers: the picker's image and thumbnail are
    // served, and the loader registered it under its own id (a collision
    // would have renamed it rake061-style and broken the picker).
    const sets = await page.evaluate(() => {
      const input = window.__sculpt.input;
      const out = {};
      for (let tool = 0; tool < 24; tool++) {
        const set = input.alphaSetFor(tool);
        if (set) out[tool] = set.alphas.map((a) => a.id);
      }
      return out;
    });
    const ids = [...new Set(Object.values(sets).flat())];
    t.ok(ids.length >= 4, `stencils on offer: ${ids.join(', ')}`);
    t.ok(ids.includes('clay01') && ids.includes('clay02') && !ids.includes('rake05'), 'the clay set is the two clay stencils');
    for (const id of ids) {
      const status = await page.evaluate(async (i) => {
        const a = await fetch(`/assets/alphas/${i}.png`);
        const b = await fetch(`/assets/alphas/thumbs/${i}.png`);
        return `${a.status}/${b.status}`;
      }, id);
      t.eq(status, '200/200', `${id}: image and thumbnail served`);
    }
    await page.waitForFunction(
      (want) => {
        const all = window.__sculpt.session.getPicking().constructor.ALPHAS;
        return want.every((i) => !!all[i]);
      },
      ids,
      { timeout: 30_000 },
    );
    const sizes = await page.evaluate((want) => {
      const all = window.__sculpt.session.getPicking().constructor.ALPHAS;
      return Object.fromEntries(want.map((i) => [i, `${all[i]._width}x${all[i]._height}`]));
    }, ids);
    t.ok(Object.values(sizes).every((s) => /^[1-9]\d+x[1-9]\d+$/.test(s)), `every stencil registered with a size: ${JSON.stringify(sizes)}`);
    t.ok(sizes.clay01 === '512x512' && sizes.clay02 === '512x512', 'the clay stencils are 512 px');
  },

  async wireframe(page, base, t) {
    await openSculpt(page, base);
    // The overlay draws the mesh's own edges: a closed quad mesh has two
    // edges per face, where its triangles would have three.
    const r = await page.evaluate(async () => {
      const { viewer, sync, session } = window.__sculpt;
      viewer.setWireframe(true);
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const g = sync.wireGeometry();
      const lines = [];
      viewer.scene.traverse((o) => {
        if (o.isLineSegments && o.name === 'sculpt-wire') lines.push(o);
      });
      return {
        faces: session.getMesh().getNbFaces(),
        edges: g.index.count / 2,
        shared: g.getAttribute('position') === sync.geometry.getAttribute('position'),
        drawn: lines.filter((l) => l.visible && l.geometry === g).length,
        triWire: viewer.isWireframe() && lines.length > 0,
      };
    });
    t.eq(r.edges, 2 * r.faces, `the sphere's ${r.faces} quads give two edges each`);
    t.ok(r.shared, 'the lines share the surface positions');
    t.eq(r.drawn, 1, 'one visible line object carries them');

    // A second object gets its own lines; a topology change (undoing the add
    // swaps the active mesh back) leaves the counts right; off hides them.
    const r2 = await page.evaluate(async () => {
      const { viewer, session } = window.__sculpt;
      session.addPrimitive('cube');
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      const visible = [];
      viewer.scene.traverse((o) => {
        if (o.isLineSegments && o.name === 'sculpt-wire' && o.visible) visible.push(o.geometry.index.count / 2);
      });
      const cube = session.getMesh().getNbFaces();
      viewer.setWireframe(false);
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      let shown = 0;
      viewer.scene.traverse((o) => {
        if (o.isLineSegments && o.name === 'sculpt-wire' && o.visible) shown++;
      });
      return { visible: visible.sort((a, b) => a - b), cube, shown };
    });
    t.eq(r2.visible.length, 2, 'two objects, two line sets');
    t.ok(r2.visible.includes(2 * r2.cube), `the cube's ${r2.cube} quads give ${2 * r2.cube} edges`);
    t.eq(r2.shown, 0, 'off hides every line set');
  },

  async roundtrip(page, base, t) {
    await openSculpt(page, base);
    await page.evaluate(async () => {
      const s = window.__sculpt.session;
      s.addPrimitive('capsule');
      await s.addBaseMesh('eye-realistic');
    });
    const before = await names(page);
    const after = await page.evaluate(async () => {
      const bytes = await window.__sculpt.file.pack();
      await window.__sculpt.file.open(bytes);
      const s = window.__sculpt.session;
      return s.getMeshes().map((m) => s.getMeshName(m));
    });
    t.eq(after.join(','), before.join(','), 'scene file keeps the objects');
  },

  async solo(page, base, t) {
    await openSculpt(page, base);
    // Three objects: the boot sphere, a cube set off to one side so a press
    // can aim at it alone, and a torus, active as the last one added. The
    // sphere is hidden with its eye in the Scene panel, as a user would.
    await page.evaluate(async () => {
      const { session, input } = window.__sculpt;
      session.addPrimitive('cube').getMatrix()[12] = 110;
      session.addPrimitive('torus');
      const row = [...document.querySelectorAll('.panel--scene .outliner__row')].find(
        (r) => r.querySelector('.outliner__name')?.textContent === 'Sphere',
      );
      row.querySelector('.outliner__icon').click();
      input.hooks.frameAll();
      await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
    });
    const altQ = () => page.keyboard.press('Alt+q');
    // A press over the cube's middle, as picking and the brush ring see it.
    const aimAtCube = () =>
      page.evaluate(() => {
        const { session } = window.__sculpt;
        const cube = session.getMeshes().find((m) => session.getMeshName(m) === 'Cube');
        const b = cube.computeWorldBound();
        const [x, y] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
        session._mouseX = x;
        session._mouseY = y;
        const picking = session.getPicking();
        const hit = picking.intersectionMouseMeshes() ? session.getMeshName(picking.getMesh()) : null;
        return { hit, ring: !!session.hoverSurface() };
      });
    const activate = (name) =>
      page.evaluate((n) => {
        const { session } = window.__sculpt;
        session.setMesh(session.getMeshes().find((m) => session.getMeshName(m) === n));
      }, name);
    // The Scene panel's eye on an object's row: its title, then a click.
    const eye = (name) =>
      page.evaluate((n) => {
        const row = [...document.querySelectorAll('.panel--scene .outliner__row')].find(
          (r) => r.querySelector('.outliner__name')?.textContent === n,
        );
        const btn = row.querySelector('.outliner__icon');
        const title = btn.title;
        btn.click();
        return title;
      }, name);

    const before = await soloState(page);
    t.eq(showSolo(before), 'Sphere:hidden Cube:shown Torus:shown', 'the eye hides the sphere; the cube and the torus show');
    t.ok(!before.solo && !before.sign && before.tab === 'none', `solo starts off, with no sign of it on the Scene panel (tab ${before.tab})`);
    const aimed = await aimAtCube();
    t.ok(aimed.hit === 'Cube' && aimed.ring, `a press over the cube picks it and rings it (${aimed.hit})`);

    // Alt+Q: the active torus alone, for the display, picking and the brush
    // alike, and the docked panel says so on its tab.
    await altQ();
    const on = await soloState(page);
    t.ok(on.solo, 'Alt+Q turns solo on');
    t.eq(showSolo(on), 'Sphere:hidden Cube:hidden Torus:shown', 'only the active torus shows; the others are hidden, flag and display');
    t.ok(on.sign && on.tab === 'block' && on.chip !== 'none', `the Scene panel says Solo, docked on its tab (tab ${on.tab}, chip ${on.chip})`);
    const missed = await aimAtCube();
    t.ok(missed.hit === null && !missed.ring, `the same press finds nothing to pick or ring (${missed.hit})`);
    t.eq(on.saved, 'Sphere:false Cube:true Torus:true', 'a save writes the eyes, not solo');
    t.eq(on.history, before.history, 'and solo put nothing on the undo stack');
    // Where the chip sits in the title bar, measured against its neighbours
    // rather than the screen: the panel's slide-in is a CSS transition,
    // which a headless browser may never run.
    const chip = await page.evaluate(() => {
      const panel = document.querySelector('.panel--scene');
      const box = (sel) => panel.querySelector(sel).getBoundingClientRect();
      const [c, title, close] = ['.outliner__solo', '.panel__title', '.panel__close'].map(box);
      const el = panel.querySelector('.outliner__solo');
      return { text: el.textContent, tip: el.title, placed: c.width > 0 && c.left > title.right && c.right < close.left };
    });
    t.ok(chip.text === 'Solo' && chip.placed, `and in the title bar, a Solo chip after the name ("${chip.tip}")`);
    const guide = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.help-guide .help-row')].find((r) => r.textContent.includes('Solo'));
      return row ? [...row.querySelectorAll('kbd')].map((k) => k.textContent).join('+') : null;
    });
    t.eq(guide, 'Alt+Q', 'the hotkey guide lists it');

    // The solo follows the active object, to the eye-hidden sphere too.
    await activate('Cube');
    t.eq(showSolo(await soloState(page)), 'Sphere:hidden Cube:shown Torus:hidden', 'a new active object takes the solo: the cube');
    await activate('Sphere');
    const sphere = await soloState(page);
    t.eq(showSolo(sphere), 'Sphere:shown Cube:hidden Torus:hidden', 'and the sphere, whose eye is shut');
    t.ok(!sphere.objects.Sphere.eye && sphere.saved === 'Sphere:false Cube:true Torus:true', 'whose eye stays shut underneath');
    // An add takes the solo; undoing it hands it back.
    await page.evaluate(() => window.__sculpt.session.addPrimitive('cone'));
    t.eq(showSolo(await soloState(page)), 'Sphere:hidden Cube:hidden Torus:hidden Cone:shown', 'an added cone takes the solo');
    await page.evaluate(() => window.__sculpt.session.undo());
    const undone = await soloState(page);
    t.ok(undone.active === 'Sphere' && showSolo(undone) === 'Sphere:shown Cube:hidden Torus:hidden', `undo swaps the sphere back in, alone (${showSolo(undone)})`);

    // Alt+Q again: everything as it was, the eye-hidden sphere included.
    await altQ();
    const off = await soloState(page);
    t.ok(!off.solo, 'Alt+Q again ends solo');
    t.eq(showSolo(off), 'Sphere:hidden Cube:shown Torus:shown', 'the sphere stays hidden, the cube and the torus are back');
    t.ok(!off.sign && off.tab === 'none' && off.chip === 'none', 'and the sign is gone');

    // An add undone while another object is active leaves nothing drawn (it
    // left its display behind once), and under solo a redo that brings it
    // back without moving the active object finds it hidden.
    const leftover = await page.evaluate(() => {
      const { session, viewer } = window.__sculpt;
      const cube = session.getMeshes().find((m) => session.getMeshName(m) === 'Cube');
      session.setMesh(cube);
      const cone = session.addPrimitive('cone');
      session.setMesh(cube);
      session.undo();
      let displays = 0;
      viewer.scene.traverse((o) => {
        if (o.isMesh && !o.name.startsWith('sculpt-') && o.geometry?.getAttribute?.('position')?.array === cone.getVertices()) displays++;
      });
      return { gone: !session.getMeshes().includes(cone), displays, active: session.activeName() };
    });
    t.ok(leftover.gone && leftover.active === 'Cube' && leftover.displays === 0, `undoing an add under another active object leaves no display (${leftover.displays})`);
    await altQ();
    await page.evaluate(() => window.__sculpt.session.redo());
    const redone = await soloState(page);
    t.eq(showSolo(redone), 'Sphere:hidden Cube:shown Torus:hidden Cone:hidden', 'under solo, a redo brings the cone back hidden');
    t.eq(redone.saved, 'Sphere:false Cube:true Torus:true Cone:true', 'with its own eye open for the save');
    await page.evaluate(() => window.__sculpt.session.undo());

    // The chip ends solo; so does an eye, then does what it says.
    await page.evaluate(() => document.querySelector('.panel--scene .outliner__solo').click());
    const chipped = await soloState(page);
    t.ok(!chipped.solo && showSolo(chipped) === 'Sphere:hidden Cube:shown Torus:shown', `the Solo chip ends it (${showSolo(chipped)})`);
    await altQ();
    const showTitle = await eye('Torus');
    const shown = await soloState(page);
    t.eq(showTitle, 'Show (ends solo)', 'under solo the eye says it ends solo');
    t.ok(!shown.solo && showSolo(shown) === 'Sphere:hidden Cube:shown Torus:shown', `an eye on a solo-hidden object ends solo and shows it (${showSolo(shown)})`);
    await altQ();
    const hideTitle = await eye('Cube');
    const hidden = await soloState(page);
    t.ok(
      hideTitle === 'Hide (ends solo)' && !hidden.solo && showSolo(hidden) === 'Sphere:hidden Cube:hidden Torus:shown',
      `an eye on the solo object ends solo and hides it (${showSolo(hidden)})`,
    );
    t.eq(hidden.saved, 'Sphere:false Cube:false Torus:true', 'and that eye is what a save keeps');

    // The Scene panel's Solo button, the way in without a keyboard: it
    // toggles, stays pressed while solo is on, names the key, and greys out
    // with nothing active. The active cube's eye is shut, so solo shows it.
    const soloButton = (click) =>
      page.evaluate((press) => {
        const b = [...document.querySelectorAll('.panel--scene .outliner__actions .outliner__btn')].find((x) => x.textContent === 'Solo');
        if (press) b.click();
        return { pressed: b.getAttribute('aria-pressed'), disabled: b.disabled, title: b.title };
      }, click);
    const idle = await soloButton(false);
    t.ok(
      idle.pressed === 'false' && !idle.disabled && idle.title.includes('Alt + Q'),
      `the Scene panel has a Solo button, not pressed, naming its key ("${idle.title}")`,
    );
    const pressed = await soloButton(true);
    const viaButton = await soloState(page);
    t.ok(
      viaButton.solo && pressed.pressed === 'true' && showSolo(viaButton) === 'Sphere:hidden Cube:shown Torus:hidden',
      `clicked, it turns solo on and stays pressed (${showSolo(viaButton)}, "${pressed.title}")`,
    );
    const released = await soloButton(true);
    const viaButtonOff = await soloState(page);
    t.ok(
      !viaButtonOff.solo && released.pressed === 'false' && !viaButtonOff.sign && showSolo(viaButtonOff) === 'Sphere:hidden Cube:hidden Torus:shown',
      `clicked again, it turns solo off and lets go (${showSolo(viaButtonOff)})`,
    );
    const greyed = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const cube = session.getMesh();
      session.setMesh(null);
      const b = [...document.querySelectorAll('.panel--scene .outliner__actions .outliner__btn')].find((x) => x.textContent === 'Solo');
      const disabled = b.disabled;
      session.setMesh(cube);
      return { disabled, back: !b.disabled };
    });
    t.ok(greyed.disabled && greyed.back, 'with nothing active the button is disabled, and enabled again after');
  },

  async armature(page, base, t) {
    // Armature mode is everyone's (owner call), so the way in is the one a
    // visitor takes: a plain visit to the gallery, signed out - the test
    // server has no whoami to answer - gets the Create tile, and its New
    // armature boots the mode where a guest used to be sent back to /.
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#landing-grid .card', { timeout: 30_000 });
    const gallery = await page.evaluate(() => ({
      chips: [...document.querySelectorAll('.topbar--right .topchip')].map((c) => c.textContent.trim()),
      first: document.querySelector('#landing-grid .card')?.classList.contains('card--new') ?? false,
      label: document.querySelector('#landing-grid .card--new .card--new__label')?.textContent ?? '',
    }));
    t.ok(gallery.chips.includes('Log in') && !gallery.chips.includes('Projects'), `the visit is a guest's (the top row: ${gallery.chips.join(', ')})`);
    t.ok(gallery.first && gallery.label === 'Create', `the gallery leads with the Create tile (${gallery.label || 'none'})`);
    await page.click('#landing-grid .card--new');
    const choices = await page.evaluate(() => [...document.querySelectorAll('.create-overlay .create-choice__title')].map((c) => c.textContent));
    t.eq(choices.join(', '), 'New sculpt, New armature', 'which offers a new sculpt or a new armature');
    await Promise.all([
      page.waitForURL((u) => u.searchParams.get('armature') === '1', { timeout: 30_000 }),
      page.click('.create-overlay [data-kind="armature"]'),
    ]);
    await page.waitForFunction(() => !!window.__armature, null, { timeout: 90_000 });
    await page.waitForTimeout(250);
    const at = new URL(page.url());
    t.eq(`${at.pathname}${at.search}`, '/?armature=1', 'New armature boots /?armature=1 and stays there');
    const ok = await page.evaluate(() => !!window.__armature.armature && typeof window.__armature.reach === 'function');
    t.ok(ok, 'armature mode boots with its handle');
    // Nothing saved yet: a new armature starts on the realistic male
    // mannequin, and the Figure list says so.
    const fresh = await page.evaluate(() => ({
      id: window.__armature.armature.rig.id,
      listed: document.querySelector('.panel--armature select')?.value ?? '',
    }));
    t.eq(fresh.id, 'mannequin-male-realistic', 'a new armature starts on the realistic male mannequin');
    t.eq(fresh.listed, 'mannequin-male-realistic', 'and the Figure list shows it');

    // And with symmetry off, both feet pinned where they stand - held by the
    // middle of the foot, where the reach takes hold - and planting on, its
    // box in the Reach section. The balls sit on their handles from the
    // start (they used to wait at the origin for the first interaction).
    const boot = await page.evaluate(() => {
      const a = window.__armature;
      const arm = a.armature;
      const V = arm.root.position.constructor;
      const panel = document.querySelector('.panel--armature');
      const reach = [...panel.querySelectorAll('.section')].find((s) => s.querySelector('h3')?.textContent === 'Reach');
      const box = (root, text) => [...root.querySelectorAll('label.checkbox')].find((l) => l.textContent.trim().startsWith(text))?.querySelector('input');
      const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      const midFoot = (s) => arm.jointWorld(`foot.${s}`).add(arm.effectorWorld(`foot.${s}`, new V(), 1)).multiplyScalar(0.5).toArray();
      let ball = null;
      arm.mesh.parent.traverse((o) => {
        if (o.name === 'ik:foot.L') ball = o.position.toArray();
      });
      return {
        symmetry: arm.symmetry,
        symmetryBox: box(panel, 'Symmetry')?.checked,
        pins: Object.keys(a.state().pins).sort().join(','),
        pinBoxes: [...panel.querySelectorAll('label.checkbox')].filter((l) => /^Pin /.test(l.textContent.trim()) && l.querySelector('input').checked).map((l) => l.textContent.trim()).join(', '),
        plant: arm.plantFeet,
        savedPlant: a.state().plant,
        plantBox: box(reach ?? panel, 'Plant feet')?.checked ?? null,
        pinOffMid: Math.max(dist(a.state().pins['foot.L'], midFoot('L')), dist(a.state().pins['foot.R'], midFoot('R'))),
        handOffTail: dist(a.handlePosition('hand.L'), arm.effectorWorld('hand.L', new V(), 1).toArray()),
        ballOff: ball ? dist(ball, a.handlePosition('foot.L')) : null,
      };
    });
    t.ok(boot.symmetry === false && boot.symmetryBox === false, `symmetry starts off (the figure ${boot.symmetry}, the box ${boot.symmetryBox})`);
    t.eq(boot.pins, 'foot.L,foot.R', 'both feet start pinned, and nothing else');
    t.eq(boot.pinBoxes, 'Pin left foot, Pin right foot', 'and the Reach section ticks their boxes');
    t.ok(boot.plant === true && boot.savedPlant === true, 'planting starts on, and the state says so');
    t.eq(boot.plantBox, true, 'the Reach section shows the Plant feet box, ticked');
    t.ok(boot.pinOffMid < 1e-3, `the feet are held by their middles, halfway from ankle to toe (${boot.pinOffMid.toExponential(1)} off)`);
    t.ok(boot.handOffTail < 1e-6, 'a hand is still held by its tip');
    t.ok(boot.ballOff !== null && boot.ballOff < 1e-6, `the balls sit on their handles from the start (the left foot's ${boot.ballOff})`);

    // The balls take the press over the parts they sit on (owner call): a
    // press within 18 px of a ball's centre takes it, even off the ball's
    // own disc, where only the leg is under the pointer - as the same press
    // shows with the balls hidden.
    const spot = await page.evaluate(() => {
      const a = window.__armature;
      a.select(null);
      const [kx, ky, r] = a.ballOnScreen('aim:foot.L');
      const [fx, fy] = a.ballOnScreen('ik:foot.L');
      const along = Math.hypot(fx - kx, fy - ky);
      const step = Math.min(17, r + 3);
      return { knee: [kx, ky], near: [kx + ((fx - kx) / along) * step, ky + ((fy - ky) / along) * step], r, step };
    });
    const press = async ([x, y]) => {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.up();
      return page.evaluate(() => window.__armature.picked());
    };
    const handlesBox = (on) =>
      page.evaluate((want) => {
        const box = [...document.querySelectorAll('.panel--armature label.checkbox')].find((l) => l.textContent.trim() === 'IK handles').querySelector('input');
        if (box.checked !== want) box.click();
      }, on);
    const clicks = { r: spot.r, step: spot.step };
    clicks.centre = await press(spot.knee);
    clicks.near = await press(spot.near);
    await handlesBox(false);
    clicks.hidden = await press(spot.near);
    await handlesBox(true);
    await page.evaluate(() => window.__armature.select(null));
    t.eq(clicks.centre, 'aim:foot.L', "a press on the left knee's ball takes the ball");
    t.ok(
      clicks.near === 'aim:foot.L' && clicks.step > clicks.r,
      `a press ${clicks.step.toFixed(1)} px from its centre, off its ${clicks.r.toFixed(1)} px disc, takes it too (${clicks.near})`,
    );
    t.ok(/^(shin|thigh)\.L$/.test(clicks.hidden ?? ''), `with the balls hidden the same press lands on the leg (${clicks.hidden})`);

    // A ball in the hips for the root (owner call): the size of a reach
    // ball in a colour of its own, taking a press like the others but
    // bringing up no gizmo, and hidden with them.
    const hips = await rootBall(page);
    const look = await page.evaluate(() => {
      const find = (name) => {
        let hit = null;
        window.__armature.armature.mesh.parent.traverse((o) => {
          if (o.name === name) hit = o;
        });
        return hit;
      };
      const [root, reach, aim] = ['root', 'ik:hand.L', 'aim:hand.L'].map(find);
      return {
        size: root?.scale.x,
        reachSize: reach.scale.x,
        colour: root?.material.color.getHexString(),
        others: [reach.material.color.getHexString(), aim.material.color.getHexString()],
      };
    });
    t.ok(hips.inside && hips.offMid < 1e-6, `the root's ball sits in the hips: ${showRoot(hips)}`);
    t.ok(look.size === look.reachSize && !look.others.includes(look.colour), `it is a reach ball's size (${look.size}) in a colour of its own (#${look.colour})`);
    const rootPress = { picked: await press(hips.ball) };
    rootPress.gizmo = await page.evaluate(() => ({ selected: window.__armature.selected(), attached: window.__armature.gizmo().attached.length }));
    await handlesBox(false);
    rootPress.hiddenBall = await page.evaluate(() => window.__armature.ballOnScreen('root'));
    rootPress.hidden = await press(hips.ball);
    await handlesBox(true);
    await page.evaluate(() => window.__armature.select(null));
    t.eq(rootPress.picked, 'root', "a press on the root's ball takes it");
    t.ok(
      rootPress.gizmo.selected === null && rootPress.gizmo.attached === 0,
      `and selects nothing, so no gizmo comes up (selected ${rootPress.gizmo.selected}, ${rootPress.gizmo.attached} controls attached)`,
    );
    t.ok(
      rootPress.hiddenBall === null && !!rootPress.hidden && rootPress.hidden !== 'root',
      `with the balls hidden it is off the page, and the same press lands on the figure (${rootPress.hidden})`,
    );

    // Dragged, it moves the root in the plane facing the camera, as the
    // pelvis gizmo's centre does, so the ball stays under the pointer: up
    // the screen the figure rises, down it crouches with both pinned feet
    // on their marks. Each drag is one undo step.
    const dragRoot = async (dy) => {
      const before = await page.evaluate(() => {
        const a = window.__armature;
        a.commit();
        return { state: a.state(), ball: a.ballOnScreen('root') };
      });
      const [x, y] = before.ball;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + dy, { steps: 12 });
      await page.mouse.up();
      return page.evaluate(
        ([was, end]) => {
          const a = window.__armature;
          const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
          const feet = () => ['foot.L', 'foot.R'].map((id) => dist(a.handlePosition(id), was.pins[id]));
          const after = a.state();
          const ball = a.ballOnScreen('root');
          const out = {
            picked: a.picked(),
            rise: after.root.position[1] - was.root.position[1],
            moved: dist(after.root.position, was.root.position),
            underPointer: Math.hypot(ball[0] - end[0], ball[1] - end[1]),
            feet: feet(),
            pinsKept: ['foot.L', 'foot.R'].every((id) => dist(after.pins[id], was.pins[id]) < 1e-9),
          };
          a.undo();
          out.undone = dist(a.state().root.position, was.root.position);
          out.feetBack = feet();
          return out;
        },
        [before.state, [x, y + dy]],
      );
    };
    const rise = await dragRoot(-40);
    const crouch = await dragRoot(60);
    t.ok(
      rise.picked === 'root' && rise.rise > 2 && rise.rise > 0.8 * rise.moved && rise.underPointer < 1.5,
      `dragged 40 px up the screen the figure rises ${rise.rise.toFixed(2)} (of ${rise.moved.toFixed(2)} moved), the ball ${rise.underPointer.toFixed(2)} px from the pointer`,
    );
    t.ok(
      crouch.rise < -2 && -crouch.rise > 0.8 * crouch.moved && crouch.underPointer < 1.5,
      `dragged 60 px down it drops ${(-crouch.rise).toFixed(2)} (of ${crouch.moved.toFixed(2)} moved), the ball ${crouch.underPointer.toFixed(2)} px from the pointer`,
    );
    t.ok(
      Math.max(...crouch.feet) <= 1 && crouch.pinsKept,
      `and both pinned feet stay on their pins (${crouch.feet.map((v) => v.toFixed(2)).join(' and ')} off)`,
    );
    t.ok(
      rise.undone < 1e-6 && crouch.undone < 1e-6 && Math.max(...rise.feetBack, ...crouch.feetBack) < 0.01,
      `one undo after each drag puts the root back (${rise.undone.toExponential(1)}, ${crouch.undone.toExponential(1)} off), and the feet on their pins`,
    );

    // Pinned feet hold their ground as the pelvis is dragged, with no snap.
    // A foot on the ground stays on its pin and never turns more than a few
    // degrees in a step of the drag; one pinned in the air stays on its pin
    // and follows its shin, which can turn fast where a leg held straight
    // has to bend at once to come nearer its pin. A pin the leg cannot reach
    // - a clean solve gets no nearer - is said so, and the drag must leave
    // the foot no further off than that.
    const drags = await pinnedDrags(page);
    for (const [name, rows] of Object.entries(drags)) {
      for (const r of rows) {
        const foot = `${r.side === 'L' ? 'left' : 'right'} foot`;
        const head = `${name}, pelvis ${r.then ? 'then moved' : 'moved'} by (${r.by.join(', ')})`;
        const deg = `${r.worst.toFixed(1)}°`;
        if (r.clean <= 1 && r.grounded) {
          t.ok(r.miss <= 1 && r.worst < 5, `${head}: the ${foot} stands on its pin (${r.miss.toFixed(2)} off) and turns at most ${deg} in a step`);
        } else if (r.clean <= 1) {
          t.ok(r.miss <= 1, `${head}: the ${foot}, pinned in the air, stays on its pin (${r.miss.toFixed(2)} off), turning with its shin up to ${deg} in a step`);
        } else {
          const atSide = r.sideLimits.some((l) => Math.abs(l - r.thighSide) < 0.5);
          t.ok(
            r.miss <= r.clean + 1,
            `${head}: the ${foot}'s pin is out of the leg's reach - a clean solve ends ${r.clean.toFixed(2)} off it` +
              `${atSide ? `, the hip at its side limit (${r.thighSide.toFixed(0)}° of [${r.sideLimits.join(', ')}])` : ''}` +
              ` - and the drag leaves it ${r.miss.toFixed(2)} off, turning up to ${deg} in a step`,
          );
        }
      }
    }

    // Feet on the ground stand flat (owner call), and only those.
    const plant = await plantingRun(page);
    t.ok(plant.kick.tilt > 10 && plant.kick.kept && plant.kick.lifted > 0.75, `kicked 30 forward the left foot leaves the ground (ankle ${plant.kick.lifted.toFixed(1)} up) and turns with its shin (${plant.kick.tilt.toFixed(1)}°), its own pose untouched`);
    t.ok(plant.down.tilt < 3 && plant.down.off < 1, `put back down it stands flat (${plant.down.tilt.toFixed(1)}° off world up, ${plant.down.off.toFixed(2)} off its mark)`);
    t.ok(plant.lift.tilt > 10 && plant.lift.kept, `lifted 25 it is no longer held flat: it follows its shin (${plant.lift.tilt.toFixed(1)}°), its pose untouched`);
    t.ok(plant.boxOff.plant === false && plant.boxOff.saved === false, 'the Plant feet box turns planting off, and the state says so');
    t.ok(plant.offDown.kept && plant.offDown.tilt > 3 && plant.offDown.off < 1, `with it off, put back down the foot is left as its shin holds it (${plant.offDown.tilt.toFixed(1)}°, its pose untouched)`);
    t.ok(plant.boxOn.plant === true && plant.boxOn.tilt < 3, `ticked again, it takes hold at once (${plant.boxOn.tilt.toFixed(1)}°)`);

    // Files saved before this: one from before pins were saved at all opens
    // as a new figure would, feet pinned; one with a foot pin at the toe and
    // no word of planting has the pin moved to the middle of the foot, and
    // plants.
    const older = await page.evaluate(async () => {
      const a = window.__armature;
      const arm = a.armature;
      const V = arm.root.position.constructor;
      const open = (state) => a.open(new File([JSON.stringify({ kind: 'bozzetto-armature', v: 1, name: 'Older', state })], 'older.armature'));
      const { pins: _pins, plant: _plant, ...unpinned } = a.state();
      await open(unpinned);
      const first = { pins: Object.keys(a.state().pins).sort().join(','), plant: a.state().plant };
      const toe = arm.effectorWorld('foot.L', new V(), 1).toArray();
      await open({ ...unpinned, pins: { 'foot.L': toe } });
      const mid = a.handlePosition('foot.L');
      const pin = a.state().pins['foot.L'];
      const gap = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      return { first, pins: Object.keys(a.state().pins).join(','), pinOff: gap(pin, mid), toeGap: gap(toe, mid), plant: a.state().plant };
    });
    t.ok(older.first.pins === 'foot.L,foot.R' && older.first.plant === true, `a save with no pins opens with both feet pinned, planting on (${older.first.pins})`);
    t.ok(
      older.pins === 'foot.L' && older.pinOff < 1e-3 && older.toeGap > 1 && older.plant === true,
      `a toe-held foot pin moves ${older.toeGap.toFixed(1)} to the middle of the foot (${older.pinOff.toExponential(1)} off it), planting on`,
    );

    // The four mannequins: fetched, read as rigged models, posable.
    const ids = ['mannequin-male-realistic', 'mannequin-female-realistic', 'mannequin-male-stylized', 'mannequin-female-stylized'];
    for (const id of ids) {
      const r = await page.evaluate(async (fid) => {
        const a = window.__armature;
        await a.figure(fid);
        const arm = a.armature;
        const geo = arm.mesh.geometry;
        const before = a.handlePosition('hand.L');
        a.reach('hand.L', before[0] + 15, before[1] + 25, before[2] + 15);
        const after = a.handlePosition('hand.L');
        const top = a.handlePosition('head');
        const sole = a.handlePosition('foot.R');
        return {
          id: arm.rig.id,
          bones: arm.rig.bones.length,
          chains: arm.rig.ik.length,
          verts: geo.getAttribute('position').count,
          skinned: !!geo.getAttribute('skinIndex'),
          height: top[1] - sole[1],
          moved: Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]),
          preset: a.state().preset,
          option: document.querySelector(`.panel--armature select option[value="${fid}"]`)?.textContent ?? '',
        };
      }, id);
      t.eq(r.id, id, `${id}: is the figure`);
      t.eq(r.bones, 19, `${id}: nineteen bones`);
      t.eq(r.chains, 5, `${id}: five reach chains`);
      t.ok(r.skinned && r.verts > 10000, `${id}: a skinned mesh of ${r.verts} vertices`);
      t.ok(r.height > 60 && r.height < 100, `${id}: head handle ${r.height.toFixed(1)} scene units above the foot`);
      t.ok(r.moved > 5, `${id}: the left hand reaches (${r.moved.toFixed(1)})`);
      t.eq(r.preset, id, `${id}: the state names it`);
      t.ok(/mannequin/i.test(r.option), `${id}: listed in the Figure select as "${r.option}"`);
      // The right-hand lumps are the left ones mirrored in the bundle, a
      // negative scale that turns their faces inward unless the builder
      // reverses them.
      const parts = await boneParts(page);
      mirrored(t, parts.volume['upperarm.L'], parts.volume['upperarm.R'], `${id}: the upper arms`);
      mirrored(t, parts.volume['hand.L'], parts.volume['hand.R'], `${id}: the hands`);
      const hip = await rootBall(page);
      t.ok(hip.inside && hip.offMid < 1e-6, `${id}: the root's ball sits in the hips: ${showRoot(hip)}`);

      // The deltoid rides on the upper arm, so it moves when the arm is
      // raised (owner report): the clavicles carry no vertices, and an
      // upper arm with its shoulder cap outweighs the forearm below it.
      for (const s of ['L', 'R']) {
        const [clavicle, upper, fore] = [`clavicle.${s}`, `upperarm.${s}`, `forearm.${s}`].map((n) => parts.verts[n] ?? 0);
        t.ok(clavicle === 0 && upper > fore, `${id}: the ${s} deltoid is on the upper arm (clavicle ${clavicle}, upper arm ${upper}, forearm ${fore} vertices)`);
      }

      // The hips sit in the middle of each half of the pelvis (owner
      // report: they were too high): about half the figure's height up,
      // under the spine, and in the middle third of the pelvis's own
      // height, where the tip of the thigh lump had them near its top.
      const height = parts.top - parts.floor;
      const [pelvisLow, pelvisHigh] = parts.span.pelvis;
      for (const s of ['L', 'R']) {
        const hip = parts.restY[`thigh.${s}`];
        const up = (hip - parts.floor) / height;
        const inPelvis = (hip - pelvisLow) / (pelvisHigh - pelvisLow);
        t.ok(up > 0.5 && up < 0.57 && hip < parts.restY.spine, `${id}: hip ${s} ${(100 * up).toFixed(1)}% of the height up, under the spine`);
        t.ok(Math.abs(inPelvis - 0.5) < 1 / 6, `${id}: hip ${s} in the middle third of the pelvis (${(100 * inPelvis).toFixed(0)}% of its height)`);
      }

      // And they open wide and cross a little, on the figure a new
      // armature starts on and on a stylized one; the shoulders lift
      // further than they drop.
      if (id === ids[0] || id === ids[3]) {
        const { out, across, lift, drop } = await hipsAndShoulders(page);
        const deg = (v) => `${Math.abs(v).toFixed(0)}°`;
        const wide = out.limits[out.side < 0 ? 0 : 1];
        const narrow = across.limits.reduce((p, q) => (Math.abs(p) < Math.abs(q) ? p : q));
        t.ok(
          out.miss <= 1.5 && out.other < 1e-3,
          `${id}: swung 22 out to the side the left foot gets there (${out.miss.toFixed(2)} off), the hip open ${deg(out.side)} of its ${deg(wide)}, the right foot where it stood`,
        );
        t.ok(
          across.miss >= 3 && Math.abs(across.side - narrow) < 0.5 && across.other < 1e-3,
          `${id}: swung 22 across it stops ${across.miss.toFixed(1)} short, the hip at the end of its ${deg(narrow)} across (${deg(across.side)}), the right foot where it stood`,
        );
        t.ok(lift > drop + 5, `${id}: the left shoulder lifts ${lift.toFixed(0)}° and drops ${drop.toFixed(0)}°`);
      }

      // Knees fold forward and elbows back, on every figure: the stylized
      // male's knees used to fold backwards, the app having guessed their
      // direction from knees that rested a fraction of a degree past
      // straight. Clear of the line by a tenth of the limb, not just on
      // the right side of it: the aim swings an elbow that folds the wrong
      // way round until it sits a hair behind its line all the same, where
      // one that folds the right way ends a fifth of the arm behind.
      const folds = await limbFolds(page);
      for (const s of ['L', 'R']) {
        const knee = folds[`knee.${s}`];
        const elbow = folds[`elbow.${s}`];
        const pct = (v, of) => `${((100 * v) / of).toFixed(0)}%`;
        t.ok(
          knee.ahead > 0.1 * knee.limb && knee.miss < 0.01 * knee.limb,
          `${id}: knee ${s} folds forward (${knee.ahead.toFixed(1)}, ${pct(knee.ahead, knee.limb)} of the leg, in front of the hip-to-ankle line; the foot ${knee.miss.toFixed(2)} off its mark)`,
        );
        t.ok(
          elbow.ahead < -0.1 * elbow.limb && elbow.miss < 0.01 * elbow.limb,
          `${id}: elbow ${s} folds back (${(-elbow.ahead).toFixed(1)}, ${pct(-elbow.ahead, elbow.limb)} of the arm, behind the shoulder-to-wrist line; the hand ${elbow.miss.toFixed(2)} off its mark)`,
        );
      }

      // The head reaches through the whole back, and the feet from their
      // middle, as rig.ts declares and the file carries.
      const ik = await page.evaluate(() => window.__armature.armature.rig.ik.map((c) => ({ id: c.id, links: c.links.join(','), at: c.effectorAt })));
      const chain = (cid) => ik.find((c) => c.id === cid) ?? {};
      t.eq(chain('head').links, 'neck,chest,spine', `${id}: the head chain bends the neck, chest and spine`);
      t.ok(chain('foot.L').at === 0.5 && chain('foot.R').at === 0.5, `${id}: the feet reach from mid-foot (effectorAt ${chain('foot.L').at}, ${chain('foot.R').at})`);
    }

    // The autosave brings a mannequin back on reload, fetched again.
    await page.evaluate(() => window.__armature.save());
    await openArmature(page, base);
    t.eq(await page.evaluate(() => window.__armature.armature.rig.id), ids[3], 'the mannequin survives a reload');
    await page.evaluate(() => window.__armature.figure('placeholder-male'));
    t.eq(await page.evaluate(() => window.__armature.armature.rig.id), 'placeholder-male', 'and the blocks come back on request');
    const blockHips = await rootBall(page);
    t.ok(blockHips.inside && blockHips.offMid < 1e-6, `the blocks' root ball sits in their pelvis: ${showRoot(blockHips)}`);

    // The gallery card shows the figure (owner report: no thumbnail). The
    // picture taken on the way out rides in the autosave record; the
    // .armature file leaves it out, as it does a loaded model.
    const packed = await page.evaluate(async () => {
      await window.__armature.snapshot();
      return window.__armature.pack();
    });
    t.ok(!/"thumb"/.test(packed) && /"bozzetto-armature"/.test(packed), 'the .armature file carries no picture');
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.card--armature', { timeout: 30_000 });
    const card = await page.evaluate(async () => {
      const img = document.querySelector('.card--armature .card__img');
      const blur = document.querySelector('.card--armature .card__img-blur');
      if (!img) return null;
      await img.decode().catch(() => {});
      const blob = await (await fetch(img.src)).blob();
      // A picture of something, not an empty frame: its pixels vary.
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 32, 32);
      const px = ctx.getImageData(0, 0, 32, 32).data;
      let lo = 255;
      let hi = 0;
      for (let i = 0; i < px.length; i += 4) {
        const l = (px[i] + px[i + 1] + px[i + 2]) / 3;
        lo = Math.min(lo, l);
        hi = Math.max(hi, l);
      }
      return { src: img.getAttribute('src'), blur: blur?.getAttribute('src') ?? null, type: blob.type, width: img.naturalWidth, spread: hi - lo };
    });
    t.ok(!!card && /^blob:/.test(card.src) && card.blur === card.src, `the armature card shows its picture, sharp and blurred (${card?.src ?? 'none'})`);
    t.ok(!!card && card.type === 'image/jpeg' && card.width > 0 && card.width <= 320 && card.spread > 10, `a JPEG of the figure, ${card?.width} px wide, not an empty frame (spread ${card?.spread?.toFixed(0)})`);

    // Offline with no mannequin kept, a new armature falls back to the
    // blocks, which are code: a fresh browser whose figure fetches fail.
    // Last, with the first page on the gallery: while that page still drew
    // its figure every frame, this boot shared the software renderer with it
    // and took 70 to 130 seconds, against openArmature's 90.
    const offline = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    try {
      const cut = await offline.newPage();
      const errors = [];
      cut.on('pageerror', (e) => errors.push(String(e)));
      await cut.route(/\/assets\/armature\/[^?]*\.glb(\?|$)/, (r) => r.abort());
      await openArmature(cut, base);
      t.eq(await cut.evaluate(() => window.__armature.armature.rig.id), 'placeholder-male', 'offline, a new armature falls back to the blocks');
      t.ok(!errors.length, `and boots without page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    } finally {
      await offline.close();
    }
  },
  // Fingers navigate, the pen and the mouse sculpt (owner call), with the
  // Preferences switch back to fingers that sculpt. Touch and pen input
  // come from the devices() helper: protocol-level touch and pen pointers.
  async fingers(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    await page.keyboard.press('3'); // Standard clay
    await page.keyboard.press('f');
    await settle(page);
    const home = await camera(page);
    const [cx, cy] = await screenOf(page, 'Sphere');
    const path = line([cx - 90, cy - 20], [cx + 90, cy + 20]);
    const ends = [await probe(page, path[0]), await probe(page, path[path.length - 1])];
    t.ok(ends.every((p) => p.canvas && p.hit), 'the test stroke runs across bare canvas over the sphere');
    const stored = await page.evaluate(() => localStorage.getItem('bozzetto-settings'));
    t.eq(stored, null, 'nothing is stored for the finger choice until it is changed');

    // A finger on the model: the view turns, the clay stays.
    let sum = await meshSum(page);
    let strokes = await strokeCount(page);
    await dev.finger(path);
    await settle(page);
    const turned = await camera(page);
    t.ok(camMoved(home, turned) > 20, `a finger drag across the model orbits (the camera moved ${camMoved(home, turned).toFixed(1)})`);
    t.eq(await meshSum(page), sum, 'and leaves every vertex where it was');
    t.eq(await strokeCount(page), strokes, 'no stroke began');

    // The pen along the same path, from the same view: a stroke, no orbit.
    await restoreCamera(page, home);
    await dev.penDrag(path);
    await settle(page);
    t.ok((await meshSum(page)) !== sum && (await strokeCount(page)) === strokes + 1, 'the pen along the same path sculpts');
    t.ok(camMoved(home, await camera(page)) < 1e-3, 'and the view stays put');

    // Two fingers still pan and zoom: spread apart, they dolly in.
    await restoreCamera(page, home);
    await dev.pair(line([cx - 30, cy + 60], [cx - 150, cy + 60], 3), line([cx + 30, cy + 60], [cx + 150, cy + 60], 3));
    await settle(page);
    const pinched = await camera(page);
    t.ok(pinched.distance < home.distance * 0.5, `two fingers spread apart zoom in (distance ${home.distance.toFixed(1)} to ${pinched.distance.toFixed(1)})`);

    // A resting hand, where a pen and a finger arrive together (Chrome here,
    // as on a Surface or Android; iPadOS hides the Pencil while a fingertip
    // is down): a finger turning the view when the pen lands gives the pen
    // the stroke and stops turning the view, and its moves after that do
    // nothing until it lifts. A finger that lands during a pen stroke does
    // nothing at all.
    await restoreCamera(page, home);
    sum = await meshSum(page);
    strokes = await strokeCount(page);
    const rest = [cx - 260, cy + 170];
    t.ok((await probe(page, rest)).canvas, 'the resting finger lands on bare canvas');
    await dev.touch('touchStart', [rest]);
    for (let i = 1; i <= 2; i++) await dev.touch('touchMove', [[rest[0] + i * 30, rest[1]]]);
    await dev.pen('mouseMoved', path[0], false);
    await dev.pen('mousePressed', path[0], true);
    const atPen = await camera(page);
    for (let i = 1; i < path.length; i++) {
      await dev.pen('mouseMoved', path[i], true);
      await dev.touch('touchMove', [[rest[0] + 60 + i * 30, rest[1] - i * 10]]);
    }
    await dev.pen('mouseReleased', path[path.length - 1], false);
    await dev.touch('touchEnd', []);
    await settle(page);
    t.ok((await strokeCount(page)) === strokes + 1 && (await meshSum(page)) !== sum, 'a pen landing while a finger orbits takes the stroke');
    t.ok(camMoved(atPen, await camera(page)) < 1e-3, `and from then on the finger cannot turn the view (moved ${camMoved(atPen, await camera(page)).toExponential(1)})`);
    await restoreCamera(page, home);
    strokes = await strokeCount(page);
    await dev.pen('mouseMoved', path[0], false);
    await dev.pen('mousePressed', path[0], true);
    for (let i = 1; i < path.length; i++) {
      await dev.pen('mouseMoved', path[i], true);
      if (i === 1) await dev.touch('touchStart', [rest]);
      if (i > 1) await dev.touch('touchMove', [[rest[0] + (i - 1) * 40, rest[1]]]);
    }
    await dev.pen('mouseReleased', path[path.length - 1], false);
    await dev.touch('touchEnd', []);
    await settle(page);
    t.ok((await strokeCount(page)) === strokes + 1, 'a finger landing mid-stroke neither ends nor restarts it');
    t.ok(camMoved(home, await camera(page)) < 1e-3, 'nor turns the view under the pen');

    // Edit > Preferences: "Fingers sculpt too" brings the old routing back,
    // live; "Fingers: navigate only" takes it away again.
    const sculptToo = await setFingers(page, 'Fingers sculpt too');
    t.eq(sculptToo.checked, 'Fingers sculpt too', 'Preferences offers the choice and takes it');
    t.eq(sculptToo.stored, '{"fingers":"sculpt"}', 'stored in this browser, as the hotkeys are');
    await restoreCamera(page, home);
    sum = await meshSum(page);
    strokes = await strokeCount(page);
    await dev.finger(path);
    await settle(page);
    t.ok((await strokeCount(page)) === strokes + 1 && (await meshSum(page)) !== sum, 'with fingers sculpting, the finger drag sculpts');
    t.ok(camMoved(home, await camera(page)) < 1e-3, 'and does not orbit');
    const navigate = await setFingers(page, 'Fingers: navigate only');
    t.ok(navigate.checked === 'Fingers: navigate only' && navigate.stored === null, `back to navigate only, the stored choice is cleared (${navigate.stored})`);
    await restoreCamera(page, home);
    sum = await meshSum(page);
    await dev.finger(path);
    await settle(page);
    t.ok((await meshSum(page)) === sum && camMoved(home, await camera(page)) > 20, 'and the finger orbits again');
  },

  // The Select tool and the gizmo under fingers: a finger drag orbits where
  // the pen draws a marquee or drags a handle, and a finger tap picks as a
  // click does.
  async fingerSelect(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    await page.evaluate(async () => {
      const { session, input } = window.__sculpt;
      session.addPrimitive('cube').getMatrix()[12] = 110;
      input.hooks.frameAll();
    });
    await settle(page);
    const home = await camera(page);
    await page.keyboard.press('q');
    t.ok(await page.evaluate(() => window.__sculpt.input.isSelecting()), 'q takes up the Select tool');
    const sphere = await screenOf(page, 'Sphere');
    const cube = await screenOf(page, 'Cube');
    const from = [Math.min(sphere[0], cube[0]) - 130, Math.min(sphere[1], cube[1]) - 110];
    const to = [Math.max(sphere[0], cube[0]) + 130, Math.max(sphere[1], cube[1]) + 110];
    const sweep = line(from, to);
    t.ok((await probe(page, from)).canvas && (await probe(page, to)).canvas, 'the marquee sweep runs over bare canvas');
    const marquee = () => page.evaluate(() => !!document.querySelector('.select-marquee'));
    const before = await selected(page);
    t.eq(before, 'Cube', 'the cube, added last, is the selection');

    const fingerMarquee = await dev.finger(sweep, marquee);
    await settle(page);
    t.eq(fingerMarquee, false, 'a finger dragged across both objects draws no marquee');
    t.eq(await selected(page), before, 'and selects nothing new');
    t.ok(camMoved(home, await camera(page)) > 20, 'it orbits instead');

    await restoreCamera(page, home);
    const penMarquee = await dev.penDrag(sweep, marquee);
    await settle(page);
    t.eq(penMarquee, true, 'the pen along the same sweep draws the marquee');
    t.eq(await selected(page), 'Cube,Sphere', 'and selects both objects');
    t.ok(camMoved(home, await camera(page)) < 1e-3, 'without moving the view');

    const empty = await emptySpot(page);
    t.ok(!!empty, `there is bare canvas to tap (${empty})`);
    await dev.tap(empty);
    await settle(page);
    t.eq(await selected(page), '', 'a finger tap on nothing clears the selection, as a click does');
    t.ok(camMoved(home, await camera(page)) < 1e-3, 'and a tap does not nudge the view');
    await dev.tap(await screenOf(page, 'Sphere'));
    await settle(page);
    t.eq(await selected(page), 'Sphere', 'a finger tap on the sphere selects it');

    // The gizmo, on the sphere: a finger on its centre handle orbits; the
    // pen on the same handle moves the object.
    await page.keyboard.press('q');
    await page.keyboard.press('t');
    const gizmo = () =>
      page.evaluate(() => {
        const { session, gizmo: g, viewer } = window.__sculpt;
        const m = session.getMesh().getMatrix();
        const [x, y] = session.getCamera().project([m[12], m[13], m[14]]);
        const r = viewer.captureCanvas.getBoundingClientRect();
        const pr = session.getPixelRatio();
        return { active: g.isActive(), at: [r.left + x / pr, r.top + y / pr], origin: [m[12], m[13], m[14]], name: session.activeName() };
      });
    const g0 = await gizmo();
    t.ok(g0.active && g0.name === 'Sphere', `t brings up the gizmo on the sphere (${g0.name})`);
    const handle = line(g0.at, [g0.at[0] + 160, g0.at[1]]);
    await dev.finger(handle);
    await settle(page);
    const g1 = await gizmo();
    t.ok(Math.hypot(...g1.origin.map((v, i) => v - g0.origin[i])) < 1e-6, 'a finger dragged from the gizmo centre leaves the object where it was');
    t.ok(camMoved(home, await camera(page)) > 20, 'and orbits');
    await restoreCamera(page, home);
    const g2 = await gizmo();
    await dev.penDrag(line(g2.at, [g2.at[0] + 160, g2.at[1]]));
    await settle(page);
    const g3 = await gizmo();
    t.ok(Math.hypot(...g3.origin.map((v, i) => v - g2.origin[i])) > 5, `the pen on the same handle moves the object (by ${Math.hypot(...g3.origin.map((v, i) => v - g2.origin[i])).toFixed(1)})`);
    t.ok(camMoved(home, await camera(page)) < 1e-3, 'without moving the view');
    await dev.tap(await screenOf(page, 'Cube'));
    await settle(page);
    const g4 = await gizmo();
    t.ok(g4.name === 'Cube' && (await selected(page)) === 'Cube', `a finger tap on the cube under the gizmo selects it, gizmo and all (${g4.name})`);
  },

  // The zoom floor (owner report: zoom stuck near the model). Every route -
  // dollyBy, the wheel, a pinch - comes down to 2% of the subject's radius
  // and back out to the same ceiling, the near plane following.
  async zoomFloor(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    await page.keyboard.press('f');
    await settle(page);
    const fit = await camera(page);
    const info = () =>
      page.evaluate(() => {
        const { viewer, session } = window.__sculpt;
        const b = session.getMesh().computeWorldBound();
        const r = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2;
        const c = viewer.controls.controls;
        const s = viewer.getCameraState();
        const dist = Math.hypot(...s.position.map((p, i) => p - s.target[i]));
        return { r, dist, min: c.minDistance, max: c.maxDistance, near: viewer.camera.near, far: viewer.camera.far };
      });
    const i0 = await info();
    t.near(i0.min / i0.r, 0.02, 1e-6, 'the floor is 2% of the subject radius');
    t.ok(i0.max >= 10 * i0.r - 1e-6, `the ceiling is at least ten radii (${(i0.max / i0.r).toFixed(1)} r)`);
    t.near(i0.near / i0.r, 0.01, 1e-6, 'at the framing distance the near plane is a hundredth of the radius, as it was');

    // dollyBy (the Pencil's ctrl-drag zoom) towards a point on the surface,
    // where a pinch about the last stroke heads: in to the floor a step at
    // a time, the near plane following, the surface still drawn in front.
    await page.evaluate(() => {
      const { viewer, session } = window.__sculpt;
      const b = session.getMesh().computeWorldBound();
      const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      const s = viewer.getCameraState();
      const d = s.position.map((p, i) => p - c[i]);
      const len = Math.hypot(...d);
      viewer.controls.setState(s.position, c.map((v, i) => v + (d[i] / len) * ((b[3] - b[0]) / 2)));
    });
    const pixel = () =>
      page.evaluate(async () => {
        const { viewer } = window.__sculpt;
        const r = viewer.captureCanvas.getBoundingClientRect();
        const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        return {
          middle: rgb(await viewer.samplePixel(r.left + r.width / 2, r.top + r.height / 2)),
          corner: rgb(await viewer.samplePixel(r.left + 4, r.top + 4)),
        };
      });
    const far = await pixel();
    const steps = [];
    for (let i = 0; i < 40; i++) {
      steps.push((await info()).dist);
      await page.evaluate(() => window.__sculpt.viewer.dolly(0.8));
    }
    const floor = await info();
    t.near(floor.dist / floor.r, 0.02, 1e-4, `dolly in comes down to the floor (${(floor.dist / floor.r).toFixed(4)} r, from ${(steps[0] / floor.r).toFixed(2)} r)`);
    t.ok(floor.near < floor.dist / 10, `with the near plane well inside the distance (near ${floor.near.toExponential(2)}, distance ${floor.dist.toExponential(2)})`);
    const big = steps.filter((d) => d > floor.min * 1.25);
    t.ok(big.slice(1).every((d, i) => Math.abs(d / big[i] - 0.8) < 1e-6), `each step is the same 20% of the distance all the way down (${big.length} steps)`);
    const near = await pixel();
    const gap = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
    t.ok(
      gap(near.middle, far.middle) < gap(near.middle, far.corner),
      `the surface still fills the middle of the frame at the floor (${near.middle} against clay ${far.middle} and background ${far.corner})`,
    );

    // Back out: from the floor every step out works, up to the ceiling.
    for (let i = 0; i < 40; i++) await page.evaluate(() => window.__sculpt.viewer.dolly(1.25));
    const out = await info();
    t.near(out.dist, out.max, out.max * 1e-6, `dolly out goes all the way back to the ceiling (${(out.dist / out.r).toFixed(1)} r)`);

    // The wheel: same floor, a proportional step that never shrinks to
    // nothing, and out again.
    await page.keyboard.press('f');
    await settle(page);
    const [cx, cy] = await screenOf(page, 'Sphere');
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -2000);
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    const wheelIn = await info();
    t.near(wheelIn.dist / wheelIn.r, 0.02, 1e-4, `the wheel comes down to the same floor (${(wheelIn.dist / wheelIn.r).toFixed(4)} r)`);
    await page.mouse.wheel(0, 100);
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(ok)));
    const notch = await info();
    t.ok(notch.dist / wheelIn.dist > 1.03, `one notch out from the floor moves the camera ${(100 * (notch.dist / wheelIn.dist - 1)).toFixed(1)}% of the distance`);
    for (let i = 0; i < 9; i++) await page.mouse.wheel(0, 2000);
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(ok)));
    const wheelOut = await info();
    t.near(wheelOut.dist, wheelOut.max, wheelOut.max * 1e-6, 'and the wheel goes back out to the same ceiling');

    // A pinch: spread fingers, a gesture at a time, to the same floor.
    await page.keyboard.press('f');
    await settle(page);
    for (let g = 0; g < 4; g++) {
      await dev.pair(line([cx - 20, cy], [cx - 220, cy], 3), line([cx + 20, cy], [cx + 220, cy], 3));
      await settle(page);
    }
    const pinchIn = await info();
    t.near(pinchIn.dist / pinchIn.r, 0.02, 1e-4, `a pinch comes down to the same floor (${(pinchIn.dist / pinchIn.r).toFixed(4)} r)`);
    t.ok(pinchIn.near < pinchIn.dist / 10, 'with the near plane following it in');
    await dev.pair(line([cx - 220, cy], [cx - 20, cy], 3), line([cx + 220, cy], [cx + 20, cy], 3));
    await settle(page);
    const pinchOut = await info();
    t.ok(pinchOut.dist > pinchIn.dist * 5, `and pinching back out leaves it (${(pinchOut.dist / pinchOut.r).toFixed(3)} r)`);

    // F frames again from wherever the zoom left off.
    await page.keyboard.press('f');
    await settle(page);
    const reframed = await info();
    t.near(reframed.dist, fit.distance, fit.distance * 1e-3, 'F puts the camera back at the framing distance');
    t.ok(reframed.near === i0.near && reframed.min === i0.min, 'with the near plane and the floor where they started');

    // A long lens frames from beyond ten radii: the ceiling makes room, so
    // F frames the subject instead of being clamped short of it.
    await page.evaluate(() => window.__sculpt.viewer.setFocalLength(135));
    await page.keyboard.press('f');
    await settle(page);
    const tele = await page.evaluate(() => {
      const { viewer, session } = window.__sculpt;
      const cam = viewer.camera;
      const b = session.getMesh().computeWorldBound();
      const r = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2;
      const fit = (r / Math.sin((cam.fov * Math.PI) / 360) / Math.min(1, cam.aspect)) * 1.15;
      const s = viewer.getCameraState();
      return { r, fit, dist: Math.hypot(...s.position.map((p, i) => p - s.target[i])) };
    });
    await page.evaluate(() => window.__sculpt.viewer.setFocalLength(50));
    t.ok(tele.fit > 10 * tele.r && Math.abs(tele.dist - tele.fit) < tele.fit * 1e-3, `at 135mm F frames from ${(tele.dist / tele.r).toFixed(1)} r, past the old ten-radius ceiling (fit ${(tele.fit / tele.r).toFixed(1)} r)`);

    // A camera restored from close in (a saved look) keeps the subject's
    // limits rather than ones made from that distance: it used to come back
    // unable to zoom out past ten times it.
    await page.evaluate((r) => {
      const { viewer } = window.__sculpt;
      const s = viewer.getCameraState();
      const dir = s.position.map((p, i) => p - s.target[i]);
      const len = Math.hypot(...dir);
      viewer.controls.setState(s.target.map((v, i) => v + (dir[i] / len) * 0.05 * r), s.target);
    }, reframed.r);
    const restored = await info();
    t.near(restored.dist / restored.r, 0.05, 1e-4, 'a camera restored at 0.05 r stays there');
    for (let i = 0; i < 40; i++) await page.evaluate(() => window.__sculpt.viewer.dolly(1.25));
    const restoredOut = await info();
    t.near(restoredOut.dist, restoredOut.max, restoredOut.max * 1e-6, `and zooms out to the subject's ceiling (${(restoredOut.dist / restoredOut.r).toFixed(1)} r)`);
  },

  // Move starts on the model only (owner call): a press just outside the
  // outline, where it used to grab the silhouette, now does what a press off
  // the model does with any brush.
  async moveOnModel(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    await page.keyboard.press('2'); // Move
    await page.keyboard.press('f');
    await settle(page);
    const home = await camera(page);
    const geo = await page.evaluate(() => {
      const { session, viewer, input } = window.__sculpt;
      const b = session.getMesh().computeWorldBound();
      const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      const radius = (b[3] - b[0]) / 2;
      // The silhouette's edge, to the right of the middle on screen.
      const right = [viewer.camera.matrixWorld.elements[0], viewer.camera.matrixWorld.elements[1], viewer.camera.matrixWorld.elements[2]];
      const edge = c.map((v, i) => v + right[i] * radius);
      const pr = session.getPixelRatio();
      const r = viewer.captureCanvas.getBoundingClientRect();
      const toPage = (p) => {
        const [x, y] = session.getCamera().project(p);
        return [r.left + x / pr, r.top + y / pr];
      };
      return { mid: toPage(c), edge: toPage(edge), brush: session.getSculptManager().getCurrentTool()._radius, tool: input.currentToolIndex() };
    });
    // A few pixels outside the outline: well within the brush's reach,
    // which is where the old grab began.
    const off = [geo.edge[0] + 14, geo.edge[1]];
    const offProbe = await probe(page, off);
    t.ok(offProbe.canvas && !offProbe.hit, `the press point is bare canvas just outside the sphere (${(off[0] - geo.edge[0]).toFixed(0)} px out, brush ${geo.brush.toFixed(0)} px)`);
    t.ok(geo.brush > 14, 'within the brush radius of the outline, where Move used to grab');

    const sum = await meshSum(page);
    const strokes = await strokeCount(page);
    const undo = await page.evaluate(() => window.__sculpt.session.getStateManager().getCurrentState());
    await dev.penDrag(line(off, [off[0] + 60, off[1] - 20]));
    await settle(page);
    t.eq(await meshSum(page), sum, 'a pen drag with Move from just outside the outline moves no vertex');
    t.eq(await strokeCount(page), strokes, 'and starts no stroke');
    t.ok(await page.evaluate((u) => window.__sculpt.session.getStateManager().getCurrentState() === u, undo), 'nor leaves an undo step');
    t.ok(camMoved(home, await camera(page)) > 1, 'it orbits instead, as a pen off the model does with any brush');

    await restoreCamera(page, home);
    await page.mouse.move(off[0], off[1]);
    await page.mouse.down();
    await page.mouse.move(off[0] + 60, off[1] - 20, { steps: 4 });
    await page.mouse.up();
    await settle(page);
    t.ok((await meshSum(page)) === sum && (await strokeCount(page)) === strokes, 'the mouse from there leaves the mesh alone too');
    await restoreCamera(page, home);
    await page.mouse.move(off[0], off[1]);
    await page.mouse.move(off[0] + 2, off[1]);
    const ring = await page.evaluate(() => document.querySelector('.sculpt-cursor')?.dataset.mode ?? null);
    t.eq(ring, 'hidden', 'hovering there shows no brush ring, as for any brush off the model');

    // On the surface Move still grabs.
    await dev.penDrag(line(geo.mid, [geo.mid[0] + 50, geo.mid[1] - 30]));
    await settle(page);
    t.ok((await meshSum(page)) !== sum && (await strokeCount(page)) === strokes + 1, 'a pen drag with Move on the sphere moves it');
  },
  // Nothing from the OS (owner report: Siri dictation, Safari's long press).
  // Safari's own gestures cannot run in this browser, so the suite checks
  // what keeps them out: the touch defaults the app cancels, the context
  // menu, page zoom and image drags it refuses, the styles it sets, and the
  // text field it lets go of when a press lands elsewhere - and that the
  // buttons it moved from click to tap still work every way.
  async osGuards(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    // A real touch's default, as the window sees it once every listener on
    // the way down has run.
    await page.evaluate(() => {
      window.__touchDefaults = [];
      window.addEventListener('touchstart', (e) => window.__touchDefaults.push(e.defaultPrevented));
    });
    const touchDefault = async (at) => {
      await page.evaluate(() => (window.__touchDefaults.length = 0));
      await dev.tap(at);
      return page.evaluate(() => window.__touchDefaults[0] ?? null);
    };
    const centre = (sel) =>
      page.evaluate((q) => {
        const r = document.querySelector(q).getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      }, sel);
    const empty = await emptySpot(page);
    t.eq(await touchDefault(empty), true, 'a touch on the canvas cannot arm a long press (its touchstart default is cancelled)');
    // A stroke first, so the undo button is live.
    const [cx, cy] = await screenOf(page, 'Sphere');
    await dev.penDrag(line([cx - 40, cy], [cx + 40, cy], 2));
    const canUndo = await page.evaluate(() => window.__sculpt.session.canUndo());
    t.ok(canUndo, 'a pen stroke leaves something to undo');
    const undoBtn = await centre('.sculpt-histbtn:last-child');
    t.eq(await touchDefault(undoBtn), true, 'nor can a touch held on the undo button, which repeats while held');
    t.ok(!(await page.evaluate(() => window.__sculpt.session.canUndo())), 'and the touch still undid the stroke');
    t.eq(await touchDefault(await centre('.sculpt-slider')), true, 'nor one on a brush slider');

    // The toolbar and the panels' edge tabs act on a tap now; a tap, a
    // click and the keyboard each act once.
    const tool = () => page.evaluate(() => window.__sculpt.input.currentToolIndex());
    const moveBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.sculpt-toolbar__btn')].find((x) => x.querySelector('.sculpt-toolbar__key')?.textContent === '2');
      const r = b.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    });
    t.eq(await touchDefault(moveBtn), true, 'a touch on a toolbar button cannot arm a long press either');
    t.eq(await tool(), 9, 'and the tap still picks the brush (Move)');
    const selectBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.sculpt-toolbar__btn')].find((x) => x.querySelector('.sculpt-toolbar__key')?.textContent === 'q');
      const r = b.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    });
    await page.mouse.click(...selectBtn);
    const selecting = await page.evaluate(() => window.__sculpt.input.isSelecting());
    await page.mouse.click(...selectBtn);
    const after = await page.evaluate(() => window.__sculpt.input.isSelecting());
    t.ok(selecting && !after, 'a mouse click on the Select toggle switches it once, on and then off');
    const focusLeft = await page.evaluate(() => document.activeElement?.className ?? '');
    t.ok(!/sculpt-toolbar/.test(focusLeft), `and leaves no focus on the button for Tab or Space (${focusLeft || 'body'})`);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.sculpt-toolbar__btn')].find((x) => x.querySelector('.sculpt-toolbar__key')?.textContent === '3');
      b.focus();
    });
    await page.keyboard.press('Enter');
    t.eq(await tool(), 0, 'Enter on a focused toolbar button still picks its brush (Standard clay)');
    const tab = await centre('.panel--scene .panel__handle');
    const collapsed = () => page.evaluate(() => document.querySelector('.panel--scene').classList.contains('panel--collapsed'));
    const wasCollapsed = await collapsed();
    t.eq(await touchDefault(tab), true, "a touch on a panel's edge tab cannot arm a long press");
    t.eq(await collapsed(), !wasCollapsed, 'and the tap still opens the panel');
    await page.evaluate(() => document.querySelector('.panel--scene .panel__handle').click());
    t.eq(await collapsed(), wasCollapsed, 'a click closes it again');

    // The context menu: nowhere but text fields and links.
    const menu = (sel) =>
      page.evaluate((q) => !document.querySelector(q).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })), sel);
    t.ok(await menu('#viewport canvas'), 'no context menu on the canvas');
    t.ok(await menu('.sculpt-toolbar__btn'), 'nor on a toolbar button');
    t.ok(await menu('.panel--scene .panel__title'), 'nor on a panel label');
    t.ok(await menu('img'), 'nor on an image');
    t.ok(!(await menu('a[href]')), 'a link keeps its menu');
    t.ok(await page.evaluate(() => !document.dispatchEvent(new Event('gesturestart', { cancelable: true }))), "Safari's page pinch (gesturestart) is cancelled");
    t.ok(
      await page.evaluate(() => !document.querySelector('img').dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }))),
      'an image cannot be dragged out of the app',
    );
    const styles = await page.evaluate(() => {
      const css = (el) => getComputedStyle(el);
      const img = document.querySelector('img');
      return {
        root: css(document.documentElement).touchAction,
        canvas: css(window.__sculpt.viewer.captureCanvas).touchAction,
        select: css(document.body).userSelect,
        overscroll: css(document.documentElement).overscrollBehaviorY,
        drag: css(img).getPropertyValue('-webkit-user-drag'),
        meta: document.querySelector('meta[name=viewport]').content,
      };
    });
    t.eq(styles.root, 'pan-x pan-y', 'the page pans but never pinch- or double-tap-zooms');
    t.eq(styles.canvas, 'none', 'the canvas takes no browser gesture at all');
    t.eq(styles.select, 'none', 'labels never start a text selection');
    t.eq(styles.overscroll, 'none', 'and the page never rubber-bands');
    t.eq(styles.drag, 'none', 'images are not draggable');
    t.ok(/user-scalable=no/.test(styles.meta), 'the viewport meta still asks for no zoom');

    // A text field left focused keeps the keyboard, and its dictation key,
    // up: a press anywhere else lets go of it, the pen's or a finger's.
    const rename = () =>
      page.evaluate(() => {
        document.querySelector('.panel--scene .outliner__name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        const input = document.querySelector('.panel--scene .outliner__rename');
        return { focused: document.activeElement === input, select: getComputedStyle(input).userSelect };
      });
    const field = await rename();
    t.ok(field.focused && field.select === 'text', 'renaming an object focuses a real text field, which keeps text selection');
    t.ok(!(await menu('.panel--scene .outliner__rename')), 'and its own context menu');
    await dev.penDrag([empty, empty]);
    t.ok(await page.evaluate(() => !document.querySelector('.outliner__rename') && document.activeElement === document.body), 'a pen press on the canvas blurs it (and the rename commits)');
    await rename();
    await dev.tap(empty);
    t.ok(await page.evaluate(() => !document.querySelector('.outliner__rename') && document.activeElement === document.body), 'so does a finger tap');
  },

  // The Negative button (owner request): a tap carves the next stroke and
  // no more, a long press carves every stroke until a tap, and Alt does the
  // opposite of whatever the button says. Judged on the clay itself: which
  // way the vertices a pen stroke moved went along their own normals, in
  // (carved) or out (raised). The clay brush only ever moves vertices from
  // one side of its plane, so the sign is clean.
  //
  // The presses on the button carry the platform's timestamps, as a real
  // finger's do: the button times a press by its events' own clocks, and
  // software GL here can spend most of a second on a frame, which without
  // them would stretch a tap into a long press.
  async carve(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    await page.keyboard.press('3'); // Standard clay
    await page.keyboard.press('f');
    await settle(page);
    const home = await camera(page);
    const [cx, cy] = await screenOf(page, 'Sphere');
    const path = line([cx - 90, cy - 20], [cx + 90, cy + 20]);
    const ends = [await probe(page, path[0]), await probe(page, path[path.length - 1])];
    t.ok(ends.every((p) => p.canvas && p.hit), 'the test stroke runs across bare canvas over the sphere');
    const ALT = 1;
    const SHIFT = 8;
    const button = await page.evaluate(() => {
      const r = document.querySelector('.sculpt-toolbar__left .sculpt-toolbar__btn').getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    });
    // What the shell will do with the next stroke, and what the button shows.
    const state = () =>
      page.evaluate(() => {
        const { input } = window.__sculpt;
        const b = document.querySelector('.sculpt-toolbar__left .sculpt-toolbar__btn');
        const look = b.classList.contains('sculpt-toolbar__btn--active')
          ? 'latched'
          : b.classList.contains('sculpt-toolbar__btn--armed')
            ? 'armed'
            : 'off';
        return { armed: input.getNegativeArmed(), latched: input.getNegativeBase(), look };
      });
    const show = (s) => `${s.look}; armed ${s.armed}, latched ${s.latched}`;
    const isOff = (s) => !s.armed && !s.latched && s.look === 'off';
    const isArmed = (s) => s.armed && !s.latched && s.look === 'armed';
    const isLatched = (s) => s.latched && !s.armed && s.look === 'latched';
    const now = () => Date.now() / 1000;
    const tap = async () => {
      const t0 = now();
      await dev.touch('touchStart', [button], t0);
      await dev.touch('touchEnd', [], t0 + 0.05);
    };
    // A finger held on the button until the latch shows while it is still
    // down, then lifted at least 700 ms after it landed.
    const longPress = async () => {
      const t0 = now();
      await dev.touch('touchStart', [button], t0);
      await page.waitForFunction(() => window.__sculpt.input.getNegativeBase(), null, { timeout: 10_000, polling: 50 });
      const held = await state();
      await dev.touch('touchEnd', [], Math.max(now(), t0 + 0.7));
      return held;
    };
    // One pen stroke along the path: how many vertices it moved, and their
    // mean travel along the normals they had before it (negative = in).
    const stroke = async (modifiers = 0) => {
      const before = await strokeCount(page);
      await page.evaluate(() => {
        const m = window.__sculpt.session.getMesh();
        const n = m.getNbVertices() * 3;
        window.__carveFrom = { v: m.getVertices().slice(0, n), n: m.getNormals().slice(0, n) };
      });
      await dev.penDrag(path, undefined, modifiers);
      await settle(page);
      const r = await page.evaluate(() => {
        const m = window.__sculpt.session.getMesh();
        const v = m.getVertices();
        const { v: v0, n } = window.__carveFrom;
        if (m.getNbVertices() * 3 !== v0.length) return { moved: -1, along: 0 };
        let moved = 0;
        let along = 0;
        for (let i = 0; i < v0.length; i += 3) {
          const dx = v[i] - v0[i];
          const dy = v[i + 1] - v0[i + 1];
          const dz = v[i + 2] - v0[i + 2];
          if (dx * dx + dy * dy + dz * dz < 1e-14) continue;
          moved++;
          along += dx * n[i] + dy * n[i + 1] + dz * n[i + 2];
        }
        return { moved, along: moved ? along / moved : 0 };
      });
      return { ...r, began: (await strokeCount(page)) - before };
    };
    const showStroke = (r) => `${r.moved} vertices moved, ${r.along.toExponential(2)} along the normal`;
    const carved = (r) => r.began === 1 && r.moved > 0 && r.along < 0;
    const raised = (r) => r.began === 1 && r.moved > 0 && r.along > 0;

    let s = await state();
    t.ok(isOff(s), `Negative starts off (${show(s)})`);
    let r = await stroke();
    t.ok(raised(r), `a plain pen stroke raises the clay (${showStroke(r)})`);

    // (1) A tap arms one stroke: that stroke carves, spends the arm, and
    // the next one raises again.
    await tap();
    s = await state();
    t.ok(isArmed(s), `a tap on Negative arms it, with the lighter look (${show(s)})`);
    r = await stroke();
    t.ok(carved(r), `the next pen stroke carves (${showStroke(r)})`);
    s = await state();
    t.ok(isOff(s), `and spends the arm as it ends (${show(s)})`);
    r = await stroke();
    t.ok(raised(r), `so the stroke after it raises (${showStroke(r)})`);

    // (2) A second tap disarms.
    await tap();
    await tap();
    s = await state();
    t.ok(isOff(s), `a tap then a second tap leaves nothing armed (${show(s)})`);
    r = await stroke();
    t.ok(raised(r), `and the next stroke raises (${showStroke(r)})`);

    // The arm waits: no timeout, a pen orbit off the model does not spend
    // it, nor does a stroke that cannot carve (Shift smooths).
    await tap();
    const empty = await emptySpot(page);
    t.ok(!!empty, 'there is bare canvas off the sphere to orbit from');
    const strokes = await strokeCount(page);
    await dev.penDrag(line(empty, [empty[0] + 60, empty[1] + 20], 2));
    await settle(page);
    t.ok(camMoved(home, await camera(page)) > 1 && (await strokeCount(page)) === strokes, 'a pen drag off the model orbits, with no stroke');
    s = await state();
    t.ok(isArmed(s), `and leaves the arm set (${show(s)})`);
    await restoreCamera(page, home);
    r = await stroke(SHIFT);
    s = await state();
    t.ok(r.began === 1 && isArmed(s), `a Shift (smooth) stroke leaves it armed too (${show(s)})`);
    r = await stroke();
    s = await state();
    t.ok(carved(r) && isOff(s), `the next clay stroke carves and spends it (${showStroke(r)}; ${show(s)})`);

    // Alt with the arm set inverts the inverted stroke, as it does a
    // latched one, and the stroke still spends the arm.
    await tap();
    r = await stroke(ALT);
    s = await state();
    t.ok(raised(r), `armed, an Alt stroke raises (${showStroke(r)})`);
    t.ok(isOff(s), `and spends the arm (${show(s)})`);

    // (3) A long press latches: every stroke carves until a tap. Nothing
    // is decided at the press itself (read in the event's own task, after
    // the button's handler).
    await page.evaluate(() =>
      window.addEventListener(
        'pointerdown',
        () => {
          const { input } = window.__sculpt;
          window.__atDown = { armed: input.getNegativeArmed(), latched: input.getNegativeBase() };
        },
        { once: true },
      ),
    );
    const held = await longPress();
    const atDown = await page.evaluate(() => window.__atDown);
    s = await state();
    t.ok(!!atDown && !atDown.armed && !atDown.latched, `a press decides nothing as it lands (${JSON.stringify(atDown)})`);
    t.ok(isLatched(held), `held, it latches while still down, with the filled look (${show(held)})`);
    t.ok(isLatched(s), `and the lift, 700 ms after the press, changes nothing (${show(s)})`);
    r = await stroke();
    const second = await stroke();
    t.ok(carved(r) && carved(second), `latched, two strokes in a row both carve (${showStroke(r)}; ${showStroke(second)})`);
    s = await state();
    t.ok(isLatched(s), `and it is still latched after them (${show(s)})`);

    // (4) Alt with the latch inverts as before.
    r = await stroke(ALT);
    t.ok(raised(r), `latched, an Alt stroke raises (${showStroke(r)})`);
    s = await state();
    t.ok(isLatched(s), `and leaves the latch on (${show(s)})`);
    await tap();
    s = await state();
    t.ok(isOff(s), `a tap lets go of the latch (${show(s)})`);
    r = await stroke();
    t.ok(raised(r), `and strokes raise again (${showStroke(r)})`);

    // A long press over an arm latches and drops the arm, which would
    // otherwise turn the first latched stroke back over.
    await tap();
    s = await longPress();
    t.ok(isLatched(s), `a long press while armed latches, arm dropped (${show(s)})`);
    await tap();
    t.ok(isOff(await state()), 'and a tap clears it');

    // A busy page: the lift, stamped 50 ms after its press as the platform
    // stamps it, only gets through after the timer has shown the latch.
    // It is still a tap.
    let t0 = now();
    await dev.touch('touchStart', [button], t0);
    await page.waitForFunction(() => window.__sculpt.input.getNegativeBase(), null, { timeout: 10_000, polling: 50 });
    await dev.touch('touchEnd', [], t0 + 0.05);
    s = await state();
    t.ok(isArmed(s), `a tap whose lift reaches a busy page after the timer ran is still a tap (${show(s)})`);
    await tap();

    // The press itself: the mouse, the keyboard, a slid-off finger, a
    // cancelled touch and a lost window.
    const click = async (ms) => {
      const t1 = now();
      await dev.mouse('mousePressed', button, t1);
      if (ms > 100) await page.waitForFunction(() => window.__sculpt.input.getNegativeBase(), null, { timeout: 10_000, polling: 50 });
      await dev.mouse('mouseReleased', button, Math.max(now(), t1 + ms / 1000));
    };
    await click(50);
    s = await state();
    t.ok(isArmed(s), `a mouse click arms it once, its click event not counted again (${show(s)})`);
    await click(50);
    t.ok(isOff(await state()), 'a second click disarms it');
    await click(700);
    s = await state();
    t.ok(isLatched(s), `a mouse held 700 ms latches, and the click after the lift does not undo it (${show(s)})`);
    const focusLeft = await page.evaluate(() => document.activeElement?.className ?? '');
    t.ok(!/sculpt-toolbar/.test(focusLeft), `the press leaves no focus on the button (${focusLeft || 'body'})`);
    await click(50);
    t.ok(isOff(await state()), 'a mouse click lets go of the latch');
    await page.evaluate(() => document.querySelector('.sculpt-toolbar__left .sculpt-toolbar__btn').focus());
    await page.keyboard.press('Enter');
    s = await state();
    t.ok(isArmed(s), `Enter on the focused button arms it, as a tap does (${show(s)})`);
    await page.keyboard.press('Enter');
    t.ok(isOff(await state()), 'and Enter again disarms it');
    await page.evaluate(() => document.activeElement?.blur());
    t0 = now();
    await dev.touch('touchStart', [button], t0);
    await dev.touch('touchMove', [[button[0] + 120, button[1] - 90]], t0 + 0.04);
    await dev.touch('touchEnd', [], t0 + 0.08);
    s = await state();
    t.ok(isOff(s), `a finger slid off the button before lifting changes nothing, as on any toolbar button (${show(s)})`);
    t0 = now();
    await dev.touch('touchStart', [button], t0);
    await dev.touch('touchCancel', [], t0 + 0.05);
    s = await state();
    t.ok(isArmed(s), `a touch cancelled before the long press counts as the tap (${show(s)})`);
    await tap();
    await page.evaluate(() => window.addEventListener('pointerdown', () => window.dispatchEvent(new Event('blur')), { once: true }));
    t0 = now();
    await dev.touch('touchStart', [button], t0);
    await page.waitForTimeout(800);
    const blurred = await state();
    await dev.touch('touchEnd', [], Math.max(now(), t0 + 0.8));
    s = await state();
    t.ok(isOff(blurred) && isOff(s), `a press the window loses focus during is neither a long press nor a tap (${show(blurred)}, then ${show(s)})`);
    t.ok(
      await page.evaluate(
        () => !document.querySelector('.sculpt-toolbar__left .sculpt-toolbar__btn').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
      ),
      'and the button still refuses the context menu',
    );

    // The hotkey guide says the button too.
    const guide = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.help-guide .help-row')].find((x) => /^Negative/.test(x.lastElementChild?.textContent ?? ''));
      return row ? row.textContent : null;
    });
    t.ok(!!guide && /Alt \+ drag/.test(guide) && /button/.test(guide), `the hotkey guide's Negative row names Alt and the button (${guide})`);
  },
};
