// The smoke suites: boot, the Create menu's primitives and base meshes,
// the scene-file round trip, Armature mode from the gallery's Create tile
// on, Sculpt's input under fingers, the pen, the zoom and the Negative
// button, the arrow keys in the Scene list, each brush's own size and the
// World-scale box after an open, capture's default, the autosave's cadence,
// the two diagnostic overlays, Save to library signed out and signed in
// (scenes in Projects, visibility), and the sliders: typed values in the
// Render, Tool and Armature panels and on the brush rail, the Render
// panel's ranges and defaults, and ambient occlusion's. Then the Capture
// window and where recording is allowed, the panels' sides on the iPad's
// screens, Mask and Extract in the Model panel, Delete highest level,
// ambient occlusion outside sculpt mode, the environment's rescale and its
// plate, and the key light on L in Armature mode. Each gets (page, base,
// t) - a fresh page, the server's origin, and the check collector.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// A foot pinned past its reach (owner report: the reach "pretty spazzy"
// beyond the joint limits). The left thigh is turned by hand, both feet
// pinned, and the pelvis dragged as pinnedDrags drags it, until the left
// pin wants more crossing than the hip allows. How far the foot ends from
// its pin, against the nearest a coarse grid over the leg's joint angles
// gets within their limits - every axis of the hip and the knee in steps
// of about 15 degrees, the pelvis where it is and the foot's own turn as
// it is. Then the same pin solved again, as the next move of the pelvis
// would, and the most any joint turns between the two solves: a target
// past reach should settle, not flicker from one answer to another.
const pastReach = (page) =>
  page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const symmetry = arm.symmetry;
    const home = arm.root.position.clone();
    arm.symmetry = false;
    arm.resetPose();
    for (const c of arm.chains()) arm.setPinned(c.id, false);
    a.turn('thigh.L', -30, 0, 10);
    arm.setPinned('foot.L', true);
    arm.setPinned('foot.R', true);
    a.commit();
    const pin = a.state().pins['foot.L'];
    a.moveRoot(10, -15, 0, 30);
    a.moveRoot(12, 0, 0, 30);
    const miss = dist(a.handlePosition('foot.L'), pin);
    const names = arm.boneNames();
    const was = names.map((n) => arm.bones.get(n).quaternion.clone());
    a.moveRoot(0, 0, 0);
    let moved = 0;
    let movedBone = '';
    names.forEach((n, i) => {
      const d = (360 / Math.PI) * Math.acos(Math.min(1, Math.abs(was[i].dot(arm.bones.get(n).quaternion))));
      if (d > moved) {
        moved = d;
        movedBone = n;
      }
    });
    const again = dist(a.handlePosition('foot.L'), pin);
    // The grid: the handle as a point on the foot bone, followed through
    // the leg's own matrices for every setting of the hip and the knee.
    const saved = JSON.stringify(a.state());
    const c = arm.chain('foot.L');
    const foot = arm.bones.get(c.effector);
    const top = arm.bones.get(c.links[c.links.length - 1]);
    arm.root.updateMatrixWorld(true);
    const local = foot.worldToLocal(new V(...a.handlePosition('foot.L')));
    const to = new V(...pin);
    const at = new V();
    const joints = [...c.links].reverse().map((n) => {
      const l = arm.limitsOf(n);
      const values = ['x', 'y', 'z'].map((k) => {
        const [lo, hi] = l[k];
        const steps = Math.ceil((hi - lo) / 15);
        return steps ? Array.from({ length: steps + 1 }, (_, i) => lo + ((hi - lo) * i) / steps) : [lo];
      });
      return { n, values };
    });
    let grid = Infinity;
    const search = (j) => {
      if (j === joints.length) {
        top.updateMatrixWorld(true);
        grid = Math.min(grid, at.copy(local).applyMatrix4(foot.matrixWorld).distanceTo(to));
        return;
      }
      const [xs, ys, zs] = joints[j].values;
      for (const x of xs) for (const y of ys) for (const z of zs) {
        arm.setPoseEuler(joints[j].n, x, y, z, false);
        search(j + 1);
      }
    };
    search(0);
    arm.restore(JSON.parse(saved));
    arm.root.position.copy(home);
    arm.resetPose();
    arm.symmetry = symmetry;
    a.commit();
    return { miss, again, grid, moved, movedBone };
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
async function openForInput(page, base, extra = '') {
  await openSculpt(page, base, `&q=low${extra}`);
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
// --- sliders: typed values, ranges and defaults ----------------------------

/**
 * A panel by its title, opened if it was tucked away, once it has slid all
 * the way in: at two or three frames a second the slide takes seconds, and
 * a press aimed at a slider before it ends lands off the screen.
 */
const openPanel = async (page, title) => {
  const found = await page.evaluate((name) => {
    const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === name);
    if (p?.classList.contains('panel--collapsed')) p.querySelector('.panel__handle').click();
    return !!p;
  }, title);
  if (!found) return false;
  await page.waitForFunction(
    (name) => {
      const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === name);
      return getComputedStyle(p).transform === 'none';
    },
    title,
    { timeout: 20_000 },
  );
  return true;
};

/**
 * A slider row by its panel's title and its caption (the nth of that
 * caption), scrolled into view: where its track, or the field standing in
 * for it, sits on the page; what the thumb and the row's readout say; and
 * the field, while one is up.
 */
const sliderRow = (page, panel, label, nth = 0) =>
  page.evaluate(
    ([name, caption, k]) => {
      const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === name);
      const row = p && [...p.querySelectorAll('label.compact')].filter((r) => r.firstElementChild?.textContent === caption)[k];
      if (!row) return null;
      row.scrollIntoView({ block: 'center' });
      const input = row.querySelector('input[type=range]');
      const field = row.querySelector('.slider-field');
      const r = (field ?? input).getBoundingClientRect();
      const val = row.querySelector('.slider-val, .sculpt-panel__val');
      return {
        at: [r.left + r.width / 2, r.top + r.height / 2],
        // Where the thumb sits at either end of the travel.
        maxEnd: [r.right - 8, r.top + r.height / 2],
        thumb: Number(input.value),
        min: Number(input.min),
        max: Number(input.max),
        step: Number(input.step),
        shown: !input.hidden,
        readout: val && !val.hidden ? val.textContent : null,
        field: field && {
          value: field.value,
          focused: document.activeElement === field,
          selected: field.selectionStart === 0 && field.selectionEnd === field.value.length,
          inputMode: field.inputMode,
        },
      };
    },
    [panel, label, nth],
  );

/** Type into whatever field has focus, replacing its selection, and finish with a key. */
const typeValue = async (page, text, finish = 'Enter') => {
  await page.keyboard.type(text);
  if (finish) await page.keyboard.press(finish);
};

/** A double-tap with a finger, stamped as a platform would stamp it (see carve). */
const doubleTap = async (dev, at) => {
  const t0 = Date.now() / 1000;
  await dev.touch('touchStart', [at], t0);
  await dev.touch('touchEnd', [], t0 + 0.05);
  await dev.touch('touchStart', [at], t0 + 0.15);
  await dev.touch('touchEnd', [], t0 + 0.2);
};

/** The defaults the ranges suite and the AO suite expect (Viewer's DEFAULT_AO / DEFAULT_CAVITY, Environment's). */
const AO_DEFAULT = { intensity: 1, radius: 0.3 };
const CAVITY_DEFAULT = { strength: 0.9, radius: 8, strengthMax: 2, radiusMin: 2, radiusMax: 12 };
/** The environment's intensity is in slider units: 1 is ENV_SCALE to the renderer (Environment). */
const HDRI_DEFAULT = 1;
const ENV_SCALE = 0.2;

/** The key light as the rig holds it. */
const keyLight = (page) => page.evaluate(() => window.__bozzetto.lighting.state().find((l) => l.id === 'key'));

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

// --- the library: a file signed out, Projects signed in -------------------

const DEVICE_NOTE = 'On this device only. A reinstall or clearing the browser loses it.';

/** The File menu's items, each as its label and the hint under it. */
const fileItems = (page) =>
  page.evaluate(() => {
    window.__sculpt.fileMenu.open();
    const out = [...document.querySelectorAll('.file-menu--file .file-menu__item')].map((b) => ({
      label: b.querySelector('.file-menu__label')?.textContent ?? b.textContent,
      hint: b.querySelector('.file-menu__hint')?.textContent ?? '',
    }));
    window.__sculpt.fileMenu.close();
    return out;
  });

/** Choose a File menu item by its label, the way a tap on it would. */
const chooseFile = (page, label) =>
  page.evaluate((l) => {
    window.__sculpt.fileMenu.open();
    const item = [...document.querySelectorAll('.file-menu--file .file-menu__item')].find(
      (b) => (b.querySelector('.file-menu__label')?.textContent ?? b.textContent) === l,
    );
    if (!item) throw new Error(`no File menu item "${l}"`);
    item.click();
  }, label);

/** The device shelf as IndexedDB holds it: each record's key, name, project and object count. */
const shelf = (page) =>
  page.evaluate(
    () =>
      new Promise((ok, fail) => {
        const req = indexedDB.open('bozzetto-sculpt');
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('library');
          const keys = tx.objectStore('library').getAllKeys();
          const rows = tx.objectStore('library').getAll();
          tx.oncomplete = () => {
            db.close();
            ok(keys.result.map((key, i) => ({ key, name: rows.result[i].name, projectId: rows.result[i].projectId ?? null, objects: rows.result[i].objects })));
          };
        };
      }),
  );

/** .bozz bytes, unpacked in the page: how many objects, and whether the header text mentions `needle`. */
const readBozz = (page, bytes, needle = '') =>
  page.evaluate(
    async ([b64, n]) => {
      const u8 = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const scene = await window.__sculpt.file.unpack(u8.buffer.slice(0));
      const raw = u8[0] === 0x1f && u8[1] === 0x8b ? new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : u8;
      const header = new TextDecoder().decode(raw.subarray(8, 8 + new DataView(raw.buffer).getUint32(4, true)));
      return { objects: scene.meshes.length, mentions: !!n && header.includes(n) };
    },
    [Buffer.from(bytes).toString('base64'), needle],
  );

/** The last progress toast once it has finished: its state and words. */
const savedToast = (page) =>
  page
    .waitForFunction(
      () => {
        const el = [...document.querySelectorAll('.file-menu__progress')].pop();
        return el && el.dataset.state !== 'running' ? { state: el.dataset.state, text: el.textContent } : null;
      },
      null,
      { timeout: 60_000 },
    )
    .then((h) => h.jsonValue())
    .catch(() => ({ state: 'none', text: '' }));

/** How many captured frames IndexedDB holds. */
const storedFrames = (page) =>
  page.evaluate(
    () =>
      new Promise((ok, fail) => {
        const req = indexedDB.open('bozzetto-sculpt');
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('frameMeta');
          const n = tx.objectStore('frameMeta').count();
          tx.oncomplete = () => {
            db.close();
            ok(n.result);
          };
        };
      }),
  );

// --- capture: the window, and where recording is allowed -------------------

/** The sign-in probe answering as the owner, for every page of a context. */
const signInContext = (ctx) =>
  ctx.route('**/admin/api/whoami', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'owner@example.com' }) }),
  );

/**
 * The desktop app's bridge, stood in for before the page's own scripts
 * run. isDesktop() asks only whether window.bozzettoDesktop is there, and
 * this answers every call the way an app with no server configured, no
 * recovery file and nothing picked in a dialog would.
 */
function desktopBridgeStub() {
  const none = () => () => {};
  const answers = {
    version: 'test',
    platform: 'linux',
    getServer: async () => ({ url: null, signedIn: false }),
    setServer: async () => ({ url: null, signedIn: false }),
    api: async () => ({ ok: false, status: 0, error: 'No server' }),
    recentFiles: async () => [],
    readRecovery: async () => null,
    writeRecovery: async () => true,
    clearRecovery: async () => true,
    confirm: async () => true,
    ask: async () => 0,
    message: async () => true,
    setDocument: () => {},
    saveDone: () => {},
    onCommand: none,
    onOpenPath: none,
  };
  window.bozzettoDesktop = new Proxy(answers, {
    get: (o, k) => (k in o ? o[k] : k === 'then' ? undefined : async () => null),
  });
}

/** The Capture window and its chip, as the page shows them. */
const captureState = (page) =>
  page.evaluate(() => {
    const w = window.__sculpt.captureWindow;
    const r = w.root.getBoundingClientRect();
    const c = w.chip.getBoundingClientRect();
    return {
      open: w.isOpen(),
      shown: getComputedStyle(w.root).display !== 'none',
      visibility: getComputedStyle(w.root).visibility,
      rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) },
      chip: {
        shown: !w.chip.hidden && getComputedStyle(w.chip).display !== 'none',
        l: Math.round(c.left),
        b: Math.round(c.bottom),
        expanded: w.chip.getAttribute('aria-expanded'),
        lit: w.chip.classList.contains('topchip--open'),
      },
      focused: w.root.contains(document.activeElement),
      stored: sessionStorage.getItem('bozzetto-capture-window'),
    };
  });
const showRect = (r) => `${r.l},${r.t} to ${r.r},${r.b}`;

/** The middle of the first element a selector finds, in client px. */
const centreOf = (page, sel) =>
  page.evaluate((q) => {
    const r = document.querySelector(q).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, sel);

/** Everything the File menu offers and the hotkey guide lists, as one text. */
const offeredText = async (page) => {
  const items = await fileItems(page);
  const guide = await page.evaluate(() => document.querySelector('.help-guide')?.textContent ?? '');
  return `${items.map((i) => `${i.label} ${i.hint}`).join(' | ')} || ${guide}`;
};

/** What the boot opened: object count, link, the address, and the toast's words. */
const bootState = (page) =>
  page.evaluate(() => ({
    objects: window.__sculpt.session.getMeshes().length,
    link: window.__sculpt.fileActions.link,
    search: location.search,
    toast: document.querySelector('.sculpt-toast:not(.file-menu__note) > span')?.textContent ?? '',
    failed: [...document.querySelectorAll('.file-menu__progress[data-state="failed"]')].map((e) => e.textContent),
  }));

/**
 * A stand-in for the Functions, enough for the owner's side of the library:
 * the lists and manifests, create, update, delete, a scene's upload in
 * parts, frames and thumbnails, and both media routes - the open one
 * refusing private projects, as the real one does. Every call is kept for
 * the checks; `offline` makes every one of them fail as a dropped network
 * would.
 */
function fakeProjects() {
  const projects = new Map();
  const uploads = new Map();
  const calls = [];
  const opts = { partSize: 256 * 1024, partDelay: 0, offline: false };
  let made = 0;
  let clock = 1_790_000_000_000;
  const tick = () => (clock += 1000);
  const summary = (p) => ({ id: p.id, title: p.title, mode: p.mode, fps: 4, updated_at: p.updated_at, frameCount: p.frameCount, visibility: p.visibility, scene: p.scene });
  const media = (p) => `${p.visibility === 'private' ? '/admin/api/media' : '/media'}/${p.id}`;
  const manifest = (p) => ({
    ...summary(p),
    ...(p.mode === 'scene' ? { scene: p.scene ? { ...p.scene, file: `${media(p)}/scene.bozz?v=${p.updated_at}` } : null } : {}),
  });
  const add = (p) => projects.set(p.id, { frameCount: 0, scene: null, file: null, thumb: null, updated_at: tick(), ...p });
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const body = (raw) => JSON.parse(raw.toString());

  async function handle(route) {
    const req = route.request();
    const u = new URL(req.url());
    const { pathname: path } = u;
    const method = req.method();
    const raw = req.postDataBuffer() ?? Buffer.alloc(0);
    calls.push({ method, path, search: u.search, type: req.headers()['content-type'] ?? '', body: raw });
    if (opts.offline) return route.abort('internetdisconnected');
    if (path === '/admin/api/whoami') return json(route, 200, { email: 'owner@example.com' });
    const project = (id) => projects.get(decodeURIComponent(id));
    let m;
    if (path === '/admin/api/projects') {
      if (method === 'GET') return json(route, 200, [...projects.values()].map(summary));
      const b = body(raw);
      const id = b.id || `scene-test${++made}`;
      add({ id, title: b.title || id, mode: b.mode ?? 'timelapse', visibility: b.visibility ?? (b.mode === 'scene' ? 'private' : 'public') });
      return json(route, 201, summary(projects.get(id)));
    }
    if ((m = path.match(/^\/admin\/api\/projects\/([^/]+)$/))) {
      const p = project(m[1]);
      if (!p) return json(route, 404, { error: 'Not found' });
      if (method === 'GET') return json(route, 200, manifest(p));
      if (method === 'DELETE') {
        projects.delete(p.id);
        return json(route, 200, { deleted: true });
      }
      const patch = body(raw);
      if (typeof patch.title === 'string') p.title = patch.title;
      if (patch.visibility) p.visibility = patch.visibility;
      if (Array.isArray(patch.frames)) p.frameCount = patch.frames.length;
      p.updated_at = tick();
      return json(route, 200, summary(p));
    }
    if ((m = path.match(/^\/admin\/api\/projects\/([^/]+)\/scene$/))) {
      const p = project(m[1]);
      if (!p) return json(route, 404, { error: 'Not found' });
      const id = u.searchParams.get('upload');
      if (method === 'POST' && !id) {
        const uploadId = `up-${calls.length}`;
        uploads.set(uploadId, new Map());
        return json(route, 201, { uploadId, partSize: opts.partSize });
      }
      const parts = uploads.get(id);
      if (!parts) return json(route, 404, { error: 'Unknown upload' });
      if (method === 'PUT') {
        if (opts.partDelay) await new Promise((r) => setTimeout(r, opts.partDelay));
        const part = Number(u.searchParams.get('part'));
        parts.set(part, raw);
        return json(route, 201, { part, etag: `etag-${part}` });
      }
      if (method === 'DELETE') {
        uploads.delete(id);
        return json(route, 200, { aborted: true });
      }
      const b = body(raw);
      p.file = Buffer.concat(b.parts.map((x) => parts.get(x.part)));
      p.scene = { objects: b.objects, tris: b.tris, bytes: p.file.length };
      p.updated_at = tick();
      uploads.delete(id);
      return json(route, 200, manifest(p));
    }
    if ((m = path.match(/^\/admin\/api\/projects\/([^/]+)\/(thumb|frames)$/))) {
      const p = project(m[1]);
      if (!p) return json(route, 404, { error: 'Not found' });
      if (m[2] === 'thumb') p.thumb = raw;
      p.updated_at = tick();
      return json(route, 201, m[2] === 'thumb' ? { ok: true } : { key: 'k', index: 0, size: raw.length });
    }
    if ((m = path.match(/^\/(admin\/api\/)?media\/([^/]+)\/(.+)$/))) {
      const p = project(m[2]);
      const file = m[3] === 'scene.bozz' ? p?.file : m[3] === 'thumb.jpg' ? p?.thumb : null;
      if (!p || !file || (!m[1] && p.visibility === 'private')) return route.fulfill({ status: 404, body: 'Not found' });
      return route.fulfill({ status: 200, contentType: m[3] === 'thumb.jpg' ? 'image/jpeg' : 'application/x-bozzetto', body: file });
    }
    if (path === '/api/projects') return json(route, 200, [...projects.values()].filter((p) => p.visibility === 'public').map(summary));
    if ((m = path.match(/^\/api\/projects\/([^/]+)$/))) {
      const p = project(m[1]);
      return p && p.visibility === 'public' ? json(route, 200, manifest(p)) : json(route, 404, { error: 'Not found' });
    }
    return json(route, 404, { error: 'Not found' });
  }
  const serves = (url) => /^\/(admin\/api\/|api\/projects|media\/)/.test(url.pathname);
  return { projects, calls, opts, add, handle, serves, body };
}

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

  async gallery(page, base, t) {
    // The uploader lives in the Create menu now, not the top row (owner call).
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#landing-grid .card--new', { timeout: 30_000 });
    t.eq(await page.textContent('.landing__tagline'), 'Pose, sculpt, render and timelapse', 'the tagline');
    const chips = await page.evaluate(() => [...document.querySelectorAll('.topbar--right .topchip')].map((c) => c.textContent.trim()));
    t.ok(!chips.some((c) => /upload/i.test(c)), `the top row has no upload chip (${chips.join(', ')})`);
    await page.click('#landing-grid .card--new');
    const wide = await page.evaluate(() => {
      const b = document.querySelector('.create-overlay [data-kind="timelapse"]');
      const grid = b?.parentElement?.getBoundingClientRect();
      const r = b?.getBoundingClientRect();
      return b ? { title: b.querySelector('.create-choice__title')?.textContent, spans: Math.abs(r.width - grid.width) < 2 } : null;
    });
    t.ok(wide?.title === 'Upload timelapse', `the Create menu offers Upload timelapse (${wide?.title})`);
    t.ok(wide?.spans, 'on a row of its own, across the menu');
    await Promise.all([
      page.waitForURL((u) => u.pathname === '/create/', { timeout: 30_000 }),
      page.click('.create-overlay [data-kind="timelapse"]'),
    ]);
    t.eq(new URL(page.url()).pathname, '/create/', 'and it opens the uploader');
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
    t.eq(choices.join(', '), 'New sculpt, New armature, Upload timelapse', 'which offers a new sculpt, a new armature or the timelapse uploader');
    t.ok(!gallery.chips.some((c) => /upload/i.test(c)), 'and the top row no longer carries the uploader');
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

        // Past the hip's reach the foot settles on the nearest pose the
        // limits allow, and stays there.
        const past = await pastReach(page);
        t.ok(
          past.miss <= 1.3 * past.grid,
          `${id}: a foot pinned past its reach, the hip turned by hand and the pelvis dragged across, ends ${past.miss.toFixed(2)} off its pin, the nearest a coarse grid over the leg's joint angles gets being ${past.grid.toFixed(2)}`,
        );
        t.ok(
          past.moved <= 1,
          `${id}: solved again, the same pin turns no joint more than a degree (at most ${past.moved.toFixed(3)}°${past.movedBone ? `, the ${past.movedBone}` : ''}; the foot then ${past.again.toFixed(2)} off)`,
        );
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

  async outliner(page, base, t) {
    await openSculpt(page, base);
    // Three objects, the torus active as the last one added, and the Scene
    // panel open, where the rows are.
    await page.evaluate(() => {
      const { session, scenePanel } = window.__sculpt;
      session.addPrimitive('cube');
      session.addPrimitive('torus');
      scenePanel.setCollapsed(false);
    });
    // The rows top to bottom, the active object and the selection, and the
    // row the panel marks active.
    const scene = () =>
      page.evaluate(() => {
        const { session } = window.__sculpt;
        const panel = document.querySelector('.panel--scene');
        return {
          rows: [...panel.querySelectorAll('.outliner__row')].map((r) => r.querySelector('.outliner__name')?.textContent ?? '(renaming)').join(','),
          active: session.activeName(),
          selected: session.getSelectedMeshes().map((m) => session.getMeshName(m)).sort().join(','),
          row: panel.querySelector('.outliner__row--active .outliner__name')?.textContent ?? null,
        };
      });
    const show = (s) => `${s.active}; selected ${s.selected || 'none'}; row ${s.row}`;
    // A key with focus nowhere in particular, where a press on the canvas
    // leaves it, and what is active after it.
    const press = async (key) => {
      await page.keyboard.press(key);
      return (await scene()).active;
    };
    const start = await scene();
    t.eq(start.rows, 'Sphere,Cube,Torus', 'the Scene list shows the three objects in scene order');
    await page.evaluate(() => document.activeElement?.blur?.());

    // Plain steps, round the ends both ways.
    const down = [];
    for (let i = 0; i < 3; i++) down.push(await press('ArrowDown'));
    t.eq(down.join(' '), 'Sphere Cube Torus', 'ArrowDown steps down the rows from the torus, round from the last to the first');
    const up = [];
    for (let i = 0; i < 3; i++) up.push(await press('ArrowUp'));
    t.eq(up.join(' '), 'Cube Sphere Torus', 'ArrowUp steps up them, round from the first to the last');
    let s = await scene();
    t.ok(s.selected === 'Torus' && s.row === 'Torus', `a step selects that object alone, and the panel marks its row (${show(s)})`);

    // Shift extends, the way a Shift+click on the row does.
    await page.keyboard.press('Shift+ArrowUp');
    const extended = await scene();
    t.ok(extended.active === 'Cube' && extended.selected === 'Cube,Torus', `Shift+ArrowUp extends the selection to the cube (${show(extended)})`);
    await page.keyboard.press('Shift+ArrowUp');
    s = await scene();
    t.ok(s.active === 'Sphere' && s.selected === 'Cube,Sphere,Torus', `and again to the sphere (${show(s)})`);
    const clicked = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const row = (n) => [...document.querySelectorAll('.panel--scene .outliner__row')].find((r) => r.querySelector('.outliner__name')?.textContent === n);
      row('Torus').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      row('Cube').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      return { active: session.activeName(), selected: session.getSelectedMeshes().map((m) => session.getMeshName(m)).sort().join(',') };
    });
    t.ok(clicked.active === extended.active && clicked.selected === extended.selected, `a click on the torus, then Shift+click on the cube, gives the same (${clicked.active}; ${clicked.selected})`);
    t.eq(await press('ArrowUp'), 'Sphere', 'a plain step from there goes on to the sphere');
    s = await scene();
    t.eq(s.selected, 'Sphere', 'and selects it alone again');
    await page.keyboard.press('Shift+ArrowUp');
    s = await scene();
    t.ok(s.active === 'Torus' && s.selected === 'Cube,Sphere,Torus', `a Shift step round the top is a Shift+click on the last row: the whole list (${show(s)})`);
    await press('ArrowDown');

    // The Select tool follows as it does a click: its highlights are the
    // selection, one object after a plain step and two after a Shift one.
    const lit = () => page.evaluate(() => {
      const { viewer } = window.__sculpt;
      return { count: viewer.sculptOutlines.size, active: viewer.sculptOutlines.has(viewer.display) };
    });
    await page.keyboard.press('q');
    t.eq(await press('ArrowDown'), 'Cube', 'in the Select tool, ArrowDown still steps');
    const one = await lit();
    await page.keyboard.press('Shift+ArrowDown');
    const two = await lit();
    const selecting = await page.evaluate(() => window.__sculpt.input.isSelecting());
    t.ok(selecting && one.count === 1 && one.active && two.count === 2 && two.active, `and the highlights follow: ${one.count} then ${two.count}, the active object's among them`);
    await page.keyboard.press('q');

    // Hidden and locked objects are rows like any other. With the gizmo up
    // a step moves it to the new object, or lets go of it for one it may
    // not move, as a click on the row does.
    await page.evaluate(() => {
      const row = (n) => [...document.querySelectorAll('.panel--scene .outliner__row')].find((r) => r.querySelector('.outliner__name')?.textContent === n);
      row('Sphere').querySelectorAll('.outliner__icon')[0].click(); // the eye
      row('Cube').querySelectorAll('.outliner__icon')[1].click(); // the padlock
    });
    await page.keyboard.press('w');
    const walk = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowDown');
      walk.push(
        await page.evaluate(() => {
          const { session, gizmo } = window.__sculpt;
          return `${session.activeName()}:${gizmo.isActive() ? (gizmo.mesh ? session.getMeshName(gizmo.mesh) : 'let go') : 'gizmo gone'}`;
        }),
      );
    }
    t.eq(walk.join(' '), 'Sphere:let go Cube:let go Torus:Torus', 'under the gizmo, steps land on the hidden sphere and the locked cube, and the gizmo takes the torus');
    await page.keyboard.press('t');

    // The hotkey guide lists the four keys.
    const guide = await page.evaluate(() =>
      [...document.querySelectorAll('.help-guide .help-row')]
        .filter((r) => /Scene list|Extend the selection/.test(r.textContent))
        .map((r) => [...r.querySelectorAll('kbd')].map((k) => k.textContent).join('+'))
        .join(' '),
    );
    t.eq(guide, '↑ ↓ Shift+↑ Shift+↓', 'the hotkey guide lists the keys');

    // A name being edited keeps the keys: nothing steps, and the field
    // stays open.
    const before = await scene();
    const editing = await page.evaluate(() => {
      document.querySelector('.panel--scene .outliner__row--active .outliner__name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return document.activeElement?.className;
    });
    t.eq(editing, 'outliner__rename', 'a double-click on the active row opens its name for editing');
    for (const key of ['ArrowDown', 'ArrowUp', 'Shift+ArrowDown']) await page.keyboard.press(key);
    const during = await scene();
    const field = await page.evaluate(() => ({ cls: document.activeElement?.className, value: document.activeElement?.value }));
    t.ok(
      during.active === before.active && during.selected === before.selected && field.cls === 'outliner__rename' && field.value === before.active,
      `the arrows while renaming change nothing, and the field stays (${show(during)}; "${field.value}")`,
    );
    await page.keyboard.press('Escape');
    t.eq((await scene()).rows, 'Sphere,Cube,Torus', 'Escape leaves the name as it was');

    // An open menu keeps its own arrows: the Edit menu walks its items.
    const menu = await page.evaluate(() => {
      window.__sculpt.editMenu.open();
      return document.activeElement?.textContent;
    });
    await page.keyboard.press('ArrowDown');
    const item = await page.evaluate(() => document.activeElement?.textContent);
    t.ok(menu === 'Undo' && item === 'Redo' && (await scene()).active === before.active, `in the open Edit menu ArrowDown moves from ${menu} to ${item}, and the active object stays`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.activeElement?.blur?.());

    // In view: a short window, so the panel's body scrolls; scrolled to its
    // foot, the rows are out of sight, and a step brings the active one in.
    await page.setViewportSize({ width: 1280, height: 600 });
    const where = () =>
      page.evaluate(() => {
        const body = document.querySelector('.panel--scene .panel__body');
        const view = body.getBoundingClientRect();
        const r = document.querySelector('.panel--scene .outliner__row--active').getBoundingClientRect();
        return {
          scrolls: body.scrollHeight > body.clientHeight + 1,
          inside: r.top >= view.top - 0.5 && r.bottom <= view.bottom + 0.5,
          scrollTop: Math.round(body.scrollTop),
        };
      });
    await page.evaluate(() => {
      const body = document.querySelector('.panel--scene .panel__body');
      body.scrollTop = body.scrollHeight;
    });
    const hidden = await where();
    t.ok(hidden.scrolls && !hidden.inside, `scrolled to its foot, the panel hides the active row (scrollTop ${hidden.scrollTop})`);
    const next = await press('ArrowDown');
    const shown = await where();
    t.ok(shown.inside && shown.scrollTop < hidden.scrollTop, `a step to the ${next} scrolls its row into view (scrollTop ${shown.scrollTop})`);
  },

  async brushSize(page, base, t) {
    await openForInput(page, base);
    // The brush in hand: its index, the size the shell holds for it, the
    // Tool panel's Size slider (null where there is none) and the rail's
    // nub height in percent.
    const size = () =>
      page.evaluate(() => {
        const { input } = window.__sculpt;
        const row = [...document.querySelectorAll('.panel--sculpt label.compact')].find((l) => l.firstElementChild?.textContent === 'Size');
        const nub = document.querySelector('.sculpt-slider[data-kind="size"] .sculpt-slider__nub');
        return {
          tool: input.currentToolIndex(),
          held: input.getBrushRadius(),
          slider: row ? Number(row.querySelector('input').value) : null,
          rail: parseFloat(nub.style.bottom),
        };
      });
    // The Size slider moved, as a drag moves it.
    const setSize = (px) =>
      page.evaluate((v) => {
        const row = [...document.querySelectorAll('.panel--sculpt label.compact')].find((l) => l.firstElementChild?.textContent === 'Size');
        const input = row.querySelector('input');
        input.value = String(v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, px);
    // Where the rail's nub sits for a size: log-mapped over 5..500.
    const railAt = (v) => (Math.log(v / 5) / Math.log(100)) * 100;
    const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    // Every brush's size, by its key.
    const every = async () => {
      const out = {};
      for (const k of keys) {
        await page.keyboard.press(k);
        out[k] = Math.round((await size()).held * 100) / 100;
      }
      return out;
    };
    await page.evaluate(() => document.activeElement?.blur?.());

    // Every brush starts at the one size they all shared.
    const start = await every();
    const first = start['1'];
    t.ok(Object.values(start).every((v) => v === first), `every brush starts at the same size (${JSON.stringify(start)})`);

    // Clay sized, then Inflate: each keeps its own.
    await page.keyboard.press('3');
    await setSize(120);
    await page.keyboard.press('4');
    let s = await size();
    t.ok(near(s.held, first) && s.slider === Math.round(first), `Inflate is still at the starting size after clay was sized (${s.held.toFixed(2)}, slider ${s.slider})`);
    await setSize(200);
    await page.keyboard.press('3');
    s = await size();
    t.ok(near(s.held, 120) && s.slider === 120 && near(s.rail, railAt(120), 0.1), `back on clay by its key, 120 comes back, on the slider and the rail (${s.held.toFixed(2)}, slider ${s.slider}, rail ${s.rail}%)`);
    await page.locator('.sculpt-toolbar__brushes .sculpt-toolbar__btn', { hasText: '4' }).click();
    s = await size();
    t.ok(s.tool === 1 && near(s.held, 200) && s.slider === 200 && near(s.rail, railAt(200), 0.1), `Inflate from the toolbar comes back at 200, on the slider and the rail (${s.held.toFixed(2)}, slider ${s.slider}, rail ${s.rail}%)`);
    // Paint keeps its own size like any brush; the others are untouched.
    await page.keyboard.press('0');
    await setSize(90);
    const sized = await every();
    t.ok(
      sized['3'] === 120 && sized['4'] === 200 && sized['0'] === 90 && keys.filter((k) => !'340'.includes(k)).every((k) => sized[k] === first),
      `clay, Inflate and Paint keep their sizes and the rest the starting one (${JSON.stringify(sized)})`,
    );

    // Select and the gizmo have no size: no Size row, and the rail keeps
    // the brush they go back to.
    await page.keyboard.press('3');
    await page.keyboard.press('q');
    const selecting = await size();
    await page.keyboard.press('q');
    await page.keyboard.press('t');
    const gizmo = await size();
    await page.keyboard.press('t');
    s = await size();
    t.ok(
      selecting.slider === null && gizmo.slider === null && near(selecting.held, 120) && near(gizmo.held, 120) && near(s.held, 120) && s.slider === 120,
      `Select and the gizmo show no Size and leave clay at 120 (${selecting.held.toFixed(2)}, ${gizmo.held.toFixed(2)}, back ${s.held.toFixed(2)})`,
    );

    // Saved with the scene: a size per brush, the stand-ins (Smooth 3,
    // Mask 10, the paint blur 14) left out.
    const record = await page.evaluate(async () => {
      const { file } = window.__sculpt;
      window.__bozz = await file.pack();
      return (await file.unpack(window.__bozz)).settings;
    });
    const table = record.radius ?? {};
    t.ok(
      record.worldScale === true && ['0', '1', '8'].every((k) => table[k] > 0) && !['3', '10', '14'].some((k) => k in table),
      `the record carries a size per brush (${Object.keys(table).join(',')})`,
    );
    t.ok(near(table[0] / table[1], 120 / 200, 1e-6) && near(table[8] / table[1], 90 / 200, 1e-6), 'in world units, clay, Paint and Inflate in the ratio they were set');
    // Changed after the save, so it is the open that brings them back, and
    // the open says nothing to the autosave on their behalf.
    await page.keyboard.press('3');
    await setSize(60);
    const told = await page.evaluate(async () => {
      const { file, input } = window.__sculpt;
      const ws = input.worldScale;
      const was = [ws.onChange, input.onBrushSettingsChange];
      let calls = 0;
      ws.onChange = () => {
        calls++;
        was[0]?.();
      };
      input.onBrushSettingsChange = () => {
        calls++;
        was[1]?.();
      };
      try {
        await file.open(window.__bozz);
      } finally {
        [ws.onChange, input.onBrushSettingsChange] = was;
      }
      return calls;
    });
    t.eq(told, 0, 'opening the file restores them silently');
    const opened = await every();
    t.ok(
      opened['3'] === 120 && opened['4'] === 200 && opened['0'] === 90 && opened['1'] === first,
      `and every brush comes back at its own size (${JSON.stringify(opened)})`,
    );

    // A scene from before: one radius and no table, written here by
    // leaving the table out. Inflate is in hand, so it carries 200, and
    // every brush takes that.
    await page.keyboard.press('4');
    const old = await page.evaluate(async () => {
      const { file, input } = window.__sculpt;
      const ws = input.worldScale;
      const sizes = ws.serializeSizes;
      ws.serializeSizes = () => undefined;
      try {
        window.__old = await file.pack();
      } finally {
        ws.serializeSizes = sizes;
      }
      const settings = (await file.unpack(window.__old)).settings;
      return { table: 'radius' in settings, worldRadius: settings.worldRadius };
    });
    t.ok(!old.table && old.worldRadius > 0, `an old-style record has one world radius and no table (${old.worldRadius})`);
    await page.keyboard.press('3');
    await setSize(60);
    await page.evaluate(() => window.__sculpt.file.open(window.__old));
    const legacy = await every();
    t.ok(Object.values(legacy).every((v) => v === 200), `opened, every brush is on the radius it carried (${JSON.stringify(legacy)})`);

    // Screen scale: switching keeps each brush the size it looks, and the
    // pixel sizes ride the file the same way.
    const worldScale = () =>
      page.evaluate(() => {
        const box = [...document.querySelectorAll('.panel--sculpt label.checkbox')].find((l) => l.textContent.includes('World-scale size')).querySelector('input');
        box.click();
        return box.checked;
      });
    await page.keyboard.press('3');
    await setSize(120);
    await page.keyboard.press('4');
    await setSize(40);
    t.eq(await worldScale(), false, 'the World-scale box turns world scale off');
    await page.keyboard.press('3');
    const clayPx = (await size()).held;
    await page.keyboard.press('4');
    const inflatePx = (await size()).held;
    t.ok(near(clayPx / inflatePx, 3, 0.01), `in screen scale clay and Inflate keep their sizes, as they look (${clayPx.toFixed(1)} and ${inflatePx.toFixed(1)} px)`);
    await page.keyboard.press('3');
    await setSize(80);
    await page.keyboard.press('4');
    await setSize(30);
    const screen = await page.evaluate(async () => {
      const { file } = window.__sculpt;
      window.__screen = await file.pack();
      return (await file.unpack(window.__screen)).settings;
    });
    t.ok(screen.worldScale === false && screen.radius?.[0] === 80 && screen.radius?.[1] === 30, `a screen-scale record carries pixels (${screen.radius?.[0]}, ${screen.radius?.[1]})`);
    await page.keyboard.press('3');
    await setSize(150);
    await page.evaluate(() => window.__sculpt.file.open(window.__screen));
    await page.keyboard.press('3');
    const clayBack = (await size()).held;
    await page.keyboard.press('4');
    const inflateBack = (await size()).held;
    t.ok(clayBack === 80 && inflateBack === 30, `opened, clay is 80 px again and Inflate 30 (${clayBack}, ${inflateBack})`);
    t.eq(await worldScale(), true, 'and world scale turns back on');
    await page.keyboard.press('3');
    const clayWorld = (await size()).held;
    await page.keyboard.press('4');
    const inflateWorld = (await size()).held;
    t.ok(near(clayWorld / inflateWorld, 80 / 30, 0.01), `with each brush still the size it looks (${clayWorld.toFixed(2)} and ${inflateWorld.toFixed(2)})`);
  },

  // The Tool panel's World-scale box follows the scene that was opened,
  // with a brush in hand or the Select tool up. It was read once, when the
  // panel was built, and went on showing the old state after an open had
  // turned world scale the other way.
  async worldScaleBox(page, base, t) {
    await openSculpt(page, base, '&q=low');
    const state = () =>
      page.evaluate(() => {
        const box = [...document.querySelectorAll('.panel--sculpt label.checkbox')].find((l) => l.textContent.includes('World-scale size')).querySelector('input');
        return { box: box.checked, on: window.__sculpt.input.worldScale.isEnabled() };
      });
    const show = (s) => `box ${s.box ? 'ticked' : 'clear'}, world scale ${s.on ? 'on' : 'off'}`;
    const click = () =>
      page.evaluate(() => {
        [...document.querySelectorAll('.panel--sculpt label.checkbox')].find((l) => l.textContent.includes('World-scale size')).querySelector('input').click();
        document.activeElement?.blur?.();
      });
    const pack = (name) =>
      page.evaluate(async (n) => {
        window[n] = await window.__sculpt.file.pack();
      }, name);
    const open = (name) => page.evaluate((n) => window.__sculpt.file.open(window[n]), name);

    let s = await state();
    t.ok(s.box && s.on, `world scale starts on, and ticked (${show(s)})`);
    await pack('__world');
    await click();
    s = await state();
    t.ok(!s.box && !s.on, `the box turns it off (${show(s)})`);
    await pack('__screen');
    await click();
    await open('__screen');
    s = await state();
    t.ok(!s.box && !s.on, `a scene saved in screen scale opens in it, and the box follows (${show(s)})`);
    await open('__world');
    s = await state();
    t.ok(s.box && s.on, `one saved in world scale ticks it again (${show(s)})`);
    // The Select tool shows no brush rows, and the box still has to follow.
    await page.keyboard.press('q');
    await open('__screen');
    s = await state();
    const selecting = await page.evaluate(() => window.__sculpt.input.isSelecting());
    t.ok(selecting && !s.box && !s.on, `with the Select tool up as well (${show(s)}, selecting ${selecting})`);
    await page.keyboard.press('q');
    // At entry the box is built from what the autosave restored.
    await page.evaluate(async () => {
      const { persist } = window.__sculpt;
      persist.markDirty();
      await persist.flush();
    });
    await openSculpt(page, base, '&q=low');
    s = await state();
    t.ok(!s.box && !s.on, `a reload brings screen scale back, and the box shows it (${show(s)})`);
  },

  // Timelapse capture starts off for everyone, the signed-in owner included
  // (owner call). The admin probe answers as the owner here - the test
  // server has no whoami of its own, so every other suite is a guest - in a
  // context without a service worker, so the answer reaches every load. A
  // choice made with the checkbox still stands across a reload, either way.
  async captureOff(page, base, t) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    try {
      const owner = await ctx.newPage();
      const errors = [];
      owner.on('pageerror', (e) => errors.push(String(e)));
      await ctx.route('**/admin/api/whoami', (r) =>
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'owner@example.com' }) }),
      );
      // Sculpt mode once the probe has answered (the publish forms show
      // their fields then), with time for the recorder's install - an
      // IndexedDB read - to finish and for any default to act.
      const boot = async () => {
        await openSculpt(owner, base, '&q=low');
        await owner.waitForFunction(() => [...document.querySelectorAll('.gallery-form__fields')].some((f) => !f.hidden), null, { timeout: 30_000 });
        await owner.waitForTimeout(1500);
      };
      const state = () =>
        owner.evaluate(() => {
          const { recorder } = window.__sculpt;
          const box = [...document.querySelectorAll('.capture-window label.checkbox')].find((l) => l.textContent.includes('Record timelapse')).querySelector('input');
          return { on: recorder.isEnabled(), box: box.checked, stored: localStorage.getItem('bozzetto-sculpt-record'), frames: recorder.frameCount() };
        });
      const show = (s) => `recording ${s.on ? 'on' : 'off'}, box ${s.box ? 'ticked' : 'clear'}, stored ${s.stored}, ${s.frames} frames`;
      const tick = () =>
        owner.evaluate(() => {
          [...document.querySelectorAll('.capture-window label.checkbox')].find((l) => l.textContent.includes('Record timelapse')).querySelector('input').click();
        });

      await boot();
      let s = await state();
      t.ok(!s.on && !s.box && s.stored === null && s.frames === 0, `signed in as the owner, capture starts off and records nothing (${show(s)})`);
      const defaulted = await owner.evaluate(() => {
        const { recorder } = window.__sculpt;
        recorder.setAllowed(true);
        return { allowed: recorder.isAllowed(), on: recorder.isEnabled() };
      });
      t.ok(defaulted.allowed && !defaulted.on, "recording is allowed for the owner, and that alone leaves it off");

      // Ticked, it records: the starting frame first, handed to the worker
      // and written, which the perf log times.
      await tick();
      await owner.waitForFunction(() => window.__sculpt.recorder.frameCount() > 0, null, { timeout: 60_000 });
      s = await state();
      t.ok(s.on && s.box && s.stored === 'on' && s.frames > 0, `the box turns it on, and it records (${show(s)})`);
      const timed = await owner.evaluate(() => window.__bozzettoPerf.recent().filter((e) => e.what.startsWith('capture')).map((e) => `${e.what} ${e.ms.toFixed(1)} ms${e.note ? ` (${e.note})` : ''}`));
      t.ok(timed.some((x) => x.startsWith('capture hand-off')) && timed.some((x) => x.startsWith('capture write')), `the hand-off and the write are in the perf log (${timed.join('; ')})`);

      await boot();
      s = await state();
      t.ok(s.on && s.box && s.stored === 'on' && s.frames > 0, `the choice survives a reload (${show(s)})`);
      await tick();
      await boot();
      s = await state();
      t.ok(!s.on && !s.box && s.stored === 'off', `and so does turning it off again, owner or not (${show(s)})`);
      t.ok(!errors.length, `no page errors in the owner's context${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    } finally {
      await ctx.close();
    }
  },

  // The autosave is a throttle: while anything is unsaved, one write a
  // minute at most. The first change after a quiet spell waits out a short
  // grace, later ones the interval since the last write, and an edit never
  // pushes a due write back; leaving the page still writes at once. The
  // real cadence is 5 s and 60 s; the suite runs it at 2 s and 6 s.
  async autosave(page, base, t) {
    await openSculpt(page, base, '&q=low');
    const real = await page.evaluate(() => ({ ...window.__sculpt.persist.cadence }));
    t.ok(real.grace === 5000 && real.interval === 60000, `the cadence is a ${real.grace / 1000} s grace and a ${real.interval / 1000} s interval`);
    const GRACE = 2000;
    const INTERVAL = 6000;
    // Every write, when it landed (page time) and what it carried: the
    // symmetry flag, which the edits below toggle.
    const flushed = await page.evaluate(
      async ([grace, interval]) => {
        const { persist } = window.__sculpt;
        Object.assign(persist.cadence, { grace, interval });
        window.__writes = [];
        persist.onWrote = (scene) => window.__writes.push({ t: performance.now(), sym: scene.symmetry });
        // Whatever the boot left unsaved goes now, so the test starts quiet.
        await persist.flush();
        return window.__writes.length;
      },
      [GRACE, INTERVAL],
    );
    if (flushed) await page.waitForTimeout(INTERVAL + 500);
    const edit = () =>
      page.evaluate(() => {
        window.__sculpt.session.toggleSymmetry();
        return { t: performance.now(), sym: window.__sculpt.session.getSymmetry() };
      });
    const writes = () => page.evaluate(() => window.__writes.slice());
    const until = async (pageTime) => {
      const now = await page.evaluate(() => performance.now());
      if (pageTime > now) await page.waitForTimeout(pageTime - now);
    };
    const waitWrites = (n, ms) =>
      page.waitForFunction((k) => window.__writes.length >= k, n, { timeout: ms }).catch(() => {});

    await page.evaluate(() => {
      window.__writes.length = 0;
    });
    const e1 = await edit();
    await page.waitForTimeout(1000);
    const e2 = await edit();
    const early = (await writes()).length;
    t.eq(early, 0, 'a second after the first change, nothing is written yet (the grace holds it)');
    await waitWrites(1, GRACE + 10_000);
    // The third change comes straight after that write.
    const e3 = await edit();
    let w = await writes();
    t.ok(
      w.length === 1 && w[0].t - e1.t >= GRACE && w[0].sym === e2.sym,
      `two changes a second apart make one write, after the grace, carrying both (${w.length} writes, ${w[0] ? `${Math.round(w[0].t - e1.t)} ms after the first change` : 'none'})`,
    );
    await until((w[0]?.t ?? e3.t) + INTERVAL - 1000);
    t.eq((await writes()).length, 1, 'a third change straight after it is not written within the interval');
    await waitWrites(2, INTERVAL + 10_000);
    w = await writes();
    t.ok(
      w.length === 2 && w[1].t - w[0].t >= INTERVAL - 50 && w[1].sym === e3.sym,
      `it is written once the interval is out (${w[1] ? `${Math.round(w[1].t - w[0].t)} ms after the first write` : 'never'})`,
    );

    // Leaving the page writes at once, whatever the throttle says, and
    // nothing armed for that change writes it a second time.
    const e4 = await edit();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await waitWrites(3, 5000);
    w = await writes();
    t.ok(w.length === 3 && w[2].t - e4.t < GRACE && w[2].sym === e4.sym, `a pagehide writes straight away (${w[2] ? `${Math.round(w[2].t - e4.t)} ms after the change` : 'not at all'})`);
    await page.waitForTimeout(GRACE + 3500);
    t.eq((await writes()).length, 3, 'and no write is left armed behind it');
    const logged = await page.evaluate(() => window.__bozzettoPerf.recent().filter((e) => e.what.startsWith('autosave')).map((e) => e.what));
    t.ok(logged.includes('autosave serialise') && logged.includes('autosave write'), `each write's serialise and write are in the perf log (${[...new Set(logged)].join(', ')})`);
  },

  // The perf log: the render loop's stalls and the heavy jobs, kept on
  // window for the console and drawn by ?perfdebug=1. A serialise made
  // deliberately slow has to show twice - as its own entry and as the stall
  // it caused, since no frame is drawn while the main thread is held - and
  // each of the other jobs leaves an entry when it runs. The input log is
  // up too: the two overlays share the screen.
  async perfLog(page, base, t) {
    await openSculpt(page, base, '&q=low&perfdebug=1&inputdebug=1');
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
    const boxes = await page.evaluate(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) };
      };
      return { perf: rect('.perf-debug'), input: rect('.input-debug') };
    });
    const { perf: a, input: b } = boxes;
    t.ok(!!a && !!b && (a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t), `both overlays are up, apart (${JSON.stringify(boxes)})`);

    // The ring: 64 entries, newest first, the oldest overwritten.
    const ring = await page.evaluate(() => {
      const log = window.__bozzettoPerf;
      log.clear();
      for (let i = 0; i < 100; i++) log.record(i % 2 ? 'odd' : 'even', i);
      const r = log.recent();
      log.clear();
      return { n: r.length, first: r[0].ms, last: r[r.length - 1].ms };
    });
    t.ok(ring.n === 64 && ring.first === 99 && ring.last === 36, `the log keeps the last 64, newest first (${ring.n}: ${ring.first} .. ${ring.last})`);
    // A run of one job folds into one entry, counted: a dynamic-topology
    // stroke queues a full upload every step.
    const folded = await page.evaluate(() => {
      const { sync, session } = window.__sculpt;
      const log = window.__bozzettoPerf;
      log.clear();
      for (let i = 0; i < 5; i++) sync.onAllBuffers(session.getMesh());
      const r = log.recent();
      return r.map((e) => `${e.what} x${e.n}`).join(', ');
    });
    t.eq(folded, 'topology upload x5', 'five full uploads in a row are one entry');

    // A serialise that holds the main thread for 1.2 s.
    const HOLD = 1200;
    const tris = await page.evaluate(async (hold) => {
      const { session, persist } = window.__sculpt;
      const serialize = session.serializeScene;
      session.serializeScene = function (...args) {
        const end = performance.now() + hold;
        while (performance.now() < end) {
          // held
        }
        return serialize.apply(this, args);
      };
      try {
        persist.markDirty();
        await persist.flush();
      } finally {
        session.serializeScene = serialize;
      }
      return session.getMesh().getNbTriangles();
    }, HOLD);
    // The stall is noted by the first frame after it.
    await page.waitForFunction((hold) => window.__bozzettoPerf.recent().some((e) => e.what === 'stall' && e.ms >= hold), HOLD, { timeout: 30_000 }).catch(() => {});
    const entries = await page.evaluate(() => window.__bozzettoPerf.recent());
    const serialise = entries.find((e) => e.what === 'autosave serialise');
    const write = entries.find((e) => e.what === 'autosave write');
    const stall = entries.find((e) => e.what === 'stall' && e.ms >= HOLD);
    t.ok(!!serialise && serialise.ms >= HOLD && serialise.tris === tris, `the slow serialise is logged with its time and the model's size (${serialise ? `${Math.round(serialise.ms)} ms, ${serialise.tris} tris` : 'missing'}; ${tris} tris)`);
    t.ok(!!write && /^put \d/.test(write.note), `the write after it, with the put's own share (${write ? `${write.ms.toFixed(1)} ms, ${write.note}` : 'missing'})`);
    t.ok(!!stall && stall.tris === tris && /^frame \d/.test(stall.note) && Math.abs(stall.at - Date.now()) < 120_000, `the render loop logged the stall it caused, with a time of day (${stall ? `${Math.round(stall.ms)} ms, ${stall.note}, at ${new Date(stall.at).toISOString()}` : 'missing'})`);
    t.ok(entries.every((e, i) => i === 0 || entries[i - 1].t >= e.t), 'the console list is newest first');
    // The overlay shows both within a redraw, in the words of the log.
    await page.waitForFunction(() => /autosave serialise/.test(document.querySelector('.perf-debug')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
    const text = await page.evaluate(() => document.querySelector('.perf-debug')?.textContent ?? '');
    const longest = (what) =>
      Math.max(0, ...[...text.matchAll(new RegExp(`${what}(?: ×\\d+)?\\s+([\\d.]+) (ms|s)\\b`, 'g'))].map((m) => Number(m[1]) * (m[2] === 's' ? 1000 : 1)));
    const lineOf = (what) => text.split('\n').find((l) => l.includes(what))?.trim() ?? 'missing';
    t.ok(longest('autosave serialise') >= HOLD - 10, `the overlay lists the serialise: "${lineOf('autosave serialise')}"`);
    t.ok(longest('stall') >= HOLD - 10, `and the stall: "${text.split('\n').find((l) => /stall/.test(l) && /\d s\b/.test(l))?.trim() ?? lineOf('stall')}"`);

    // Each of the other jobs leaves its entry: the wireframe's edges, a
    // level step (with the full upload it queues), a thumbnail and a voxel
    // remesh.
    const ran = await page.evaluate(async () => {
      const { viewer, session } = window.__sculpt;
      const frames = () => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
      window.__bozzettoPerf.clear();
      viewer.setWireframe(true);
      await frames();
      viewer.setWireframe(false);
      session.stepSubdivision(-1);
      session.stepSubdivision(1);
      await viewer.captureThumbnail(160);
      session.voxelRemesh(24);
      await frames();
      return window.__bozzettoPerf.recent();
    });
    for (const what of ['wire rebuild', 'subdivision', 'topology upload', 'thumbnail', 'voxel remesh']) {
      const e = ran.find((x) => x.what === what);
      t.ok(!!e && e.ms >= 0 && e.tris > 0, `${what} is logged (${e ? `${e.ms.toFixed(1)} ms, ${e.tris} tris${e.note ? `, ${e.note}` : ''}` : 'missing'})`);
    }
  },

  // ?inputdebug=1's status line: what the input shell believes between
  // events, read through its accessors. A pen drag reads as a stroke in
  // progress, with the pen, while it is down and as none once it lifts; a
  // finger on the glass counts as a touch down until it lifts.
  async inputStatus(page, base, t) {
    await openForInput(page, base, '&inputdebug=1');
    const dev = await devices(page);
    await page.keyboard.press('3'); // Standard clay
    await page.keyboard.press('f');
    await settle(page);
    const [cx, cy] = await screenOf(page, 'Sphere');
    const path = line([cx - 80, cy - 10], [cx + 80, cy + 10]);
    const ends = [await probe(page, path[0]), await probe(page, path[path.length - 1])];
    t.ok(ends.every((p) => p.canvas && p.hit), 'the test stroke runs across bare canvas over the sphere');
    const status = () => page.evaluate(() => document.querySelector('.input-debug__status')?.textContent ?? '');
    // The line redraws every frame, and frames are slow here: wait for it.
    const says = async (re) => {
      await page
        .waitForFunction((src) => new RegExp(src).test(document.querySelector('.input-debug__status')?.textContent ?? ''), re.source, { timeout: 10_000 })
        .catch(() => {});
      return status();
    };
    const shell = () =>
      page.evaluate(() => {
        const { input } = window.__sculpt;
        const at = input.lastPenEventAt();
        return { device: input.strokeDevice(), touches: input.touchCount(), penAge: at < 0 ? null : performance.now() - at };
      });

    const before = await says(/no stroke/);
    t.ok(/no stroke/.test(before) && /touches 0/.test(before) && /pen never/.test(before), `before any input: "${before}"`);
    const strokes = await strokeCount(page);
    const during = await dev.penDrag(path, async () => ({ text: await says(/stroke \(pen\)/), shell: await shell() }));
    t.eq(await strokeCount(page), strokes + 1, 'the drag is one stroke');
    t.ok(/stroke \(pen\)/.test(during.text) && /touches 0/.test(during.text), `mid-drag the status line reads a pen stroke: "${during.text}"`);
    t.ok(
      during.shell.device === 'pen' && during.shell.touches === 0 && during.shell.penAge !== null && during.shell.penAge < 10_000,
      `as do the shell's accessors (${JSON.stringify(during.shell)})`,
    );
    const after = await says(/no stroke/);
    t.ok(/no stroke/.test(after) && /pen \d+\.\ds ago/.test(after), `lifted, no stroke, and the pen's last word dated: "${after}"`);

    // A finger, which navigates: no stroke, one touch down while it is.
    const spot = (await emptySpot(page)) ?? [cx, cy];
    const finger = await dev.finger(line(spot, [spot[0] + 30, spot[1]], 2), async () => ({ text: await says(/touches 1/), shell: await shell() }));
    t.ok(/no stroke/.test(finger.text) && /touches 1/.test(finger.text) && finger.shell.touches === 1, `a finger down reads as one touch: "${finger.text}"`);
    const lifted = await says(/touches 0/);
    t.ok(/touches 0/.test(lifted), `and none once it lifts: "${lifted}"`);
  },

  // Signed out, Save to library is a .bozz download (owner call: browser
  // storage does not survive an iPad reinstall), and the menu says so; the
  // device shelf is still one item down. Every copy that lives only in this
  // browser - a kept scene, the work in progress - says what that means.
  // Nothing goes to the server: the probe found no session.
  async libraryGuest(page, base, t) {
    const sent = [];
    page.on('request', (r) => {
      const { pathname } = new URL(r.url());
      if (/^\/(admin\/api\/projects|admin\/api\/media)/.test(pathname) || (r.method() !== 'GET' && /^\/(admin|api)\//.test(pathname))) {
        sent.push(`${r.method()} ${pathname}`);
      }
    });
    await openSculpt(page, base, '&q=low');
    // The probe has answered once the publish forms show their sign-in line.
    await page.waitForFunction(() => [...document.querySelectorAll('.gallery-form')].some((f) => !f.hidden), null, { timeout: 30_000 });
    const items = await fileItems(page);
    const lib = items.find((i) => i.label === 'Save to library');
    const keep = items.find((i) => i.label === 'Keep on this device');
    t.ok(!!lib && /\.bozz file/.test(lib.hint), `signed out, Save to library says it downloads a .bozz file ("${lib?.hint}")`);
    t.ok(!!keep && keep.hint === DEVICE_NOTE, `and Keep on this device is still offered, saying what it risks ("${keep?.hint}")`);

    await page.evaluate(() => window.__sculpt.session.addPrimitive('capsule'));
    t.eq(await page.evaluate(() => window.__sculpt.fileActions.hasWork()), true, 'a capsule added is work that exists nowhere else');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), chooseFile(page, 'Save to library')]);
    const name = download.suggestedFilename();
    const file = readFileSync(await download.path());
    const read = await readBozz(page, file);
    t.ok(/^sculpt-\d{8}-\d{4}\.bozz$/.test(name) && read.objects === 2, `Save to library downloads the scene as ${name}, both objects in it`);
    t.eq(await page.evaluate(() => window.__sculpt.fileActions.hasWork()), false, 'and the downloaded scene counts as saved');

    await chooseFile(page, 'Keep on this device');
    await page.waitForFunction(() => [...document.querySelectorAll('.file-menu__note')].some((n) => n.textContent === 'Kept on this device'), null, { timeout: 30_000 });
    const kept = await shelf(page);
    t.ok(kept.length === 1 && kept[0].projectId === null && kept[0].objects === 2, `Keep on this device puts it on the device shelf (${JSON.stringify(kept)})`);

    await page.evaluate(() => window.__sculpt.persist.flush());
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#landing-grid .card--library', { timeout: 30_000 });
    const cards = await page.evaluate(() => ({
      progress: document.querySelector('.card--sculpt:not(.card--armature) .card__note')?.textContent ?? null,
      device: [...document.querySelectorAll('.card--library')].map((c) => ({ note: c.querySelector('.card__note')?.textContent ?? null, upload: !!c.querySelector('.card__upload'), badge: c.querySelector('.card__badge')?.textContent })),
      toggles: document.querySelectorAll('.card__vis').length,
    }));
    t.eq(cards.progress, DEVICE_NOTE, 'the In progress card says it is on this device only');
    t.ok(cards.device.length === 1 && cards.device[0].note === DEVICE_NOTE && cards.device[0].badge === 'Saved', `so does the kept scene's card (${JSON.stringify(cards.device)})`);
    t.ok(!cards.device[0]?.upload && cards.toggles === 0, 'a guest is offered no upload and no visibility switch');
    t.eq(sent.join(', '), '', 'and nothing was sent to the server');
  },

  // Signed in (the probe and the Functions faked, as captureOff fakes the
  // probe), Save to library uploads the scene as a private project in parts,
  // showing its progress, keeps a device copy under the project's id, and
  // remembers the project through a reload, so the next save updates it in
  // place. The gallery shows the project with its Private badge and switch,
  // offers Upload to Projects on a scene kept only on the device, and opens
  // ?project= from the server - or, offline, from the device copy. The
  // Projects page and the publish forms carry visibility too.
  async libraryOwner(page, base, t) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const fake = fakeProjects();
    try {
      fake.add({ id: 'pub-reel', title: 'Public reel', mode: 'timelapse', visibility: 'public', frameCount: 3 });
      fake.add({ id: 'priv-reel', title: 'Private reel', mode: 'timelapse', visibility: 'private', frameCount: 2 });
      await ctx.route(fake.serves, fake.handle);
      const owner = await ctx.newPage();
      const errors = [];
      owner.on('pageerror', (e) => errors.push(String(e)));
      const boot = async (query = '') => {
        await openSculpt(owner, base, `&q=low${query}`);
        if (!fake.opts.offline) {
          await owner.waitForFunction(() => [...document.querySelectorAll('.gallery-form__fields')].some((f) => !f.hidden), null, { timeout: 30_000 });
        }
      };
      await boot();
      let lib = (await fileItems(owner)).find((i) => i.label === 'Save to library');
      t.eq(lib?.hint, 'Uploads to Projects, as a private scene', 'signed in, Save to library says it uploads to Projects');

      await owner.evaluate(() => window.__sculpt.session.addPrimitive('capsule'));
      const tris = await owner.evaluate(() => window.__sculpt.session.getMeshes().reduce((n, m) => n + m.getNbTriangles(), 0));
      fake.opts.partDelay = 400;
      await chooseFile(owner, 'Save to library');
      const progress = await owner
        .waitForFunction(() => {
          const el = [...document.querySelectorAll('.file-menu__progress')].pop();
          return el && /^Uploading .* MB\.\.\.$/.test(el.textContent) ? el.textContent : null;
        }, null, { timeout: 30_000 })
        .then((h) => h.jsonValue())
        .catch(() => null);
      t.ok(!!progress, `while it uploads, the toast shows how far it has got ("${progress}")`);
      let end = await savedToast(owner);
      fake.opts.partDelay = 0;
      t.ok(end.state === 'done' && /^Saved to Projects: Sculpt /.test(end.text), `and then that it is saved ("${end.text}")`);

      const id = 'scene-test1';
      const creates = fake.calls.filter((c) => c.method === 'POST' && c.path === '/admin/api/projects').map((c) => fake.body(c.body));
      t.ok(
        creates.length === 1 && creates[0].mode === 'scene' && /^Sculpt /.test(creates[0].title) && !('id' in creates[0]) && !('visibility' in creates[0]),
        `it creates a scene project named like a shelf entry, leaving the id and the private default to the server (${JSON.stringify(creates)})`,
      );
      const parts = fake.calls.filter((c) => c.method === 'PUT' && c.path === `/admin/api/projects/${id}/scene`);
      const sizes = parts.map((c) => c.body.length);
      t.ok(
        parts.length >= 2 && parts.every((c) => c.type === 'application/octet-stream') && sizes.slice(0, -1).every((n) => n === fake.opts.partSize),
        `the file goes up in parts of the size the server asked for (${sizes.join(', ')} bytes)`,
      );
      const finish = fake.calls.find((c) => c.method === 'POST' && c.path === `/admin/api/projects/${id}/scene` && c.search.includes('upload='));
      const done = finish ? fake.body(finish.body) : null;
      t.ok(
        done?.objects === 2 && done.tris === tris && done.parts.length === parts.length && done.parts.every((p, i) => p.part === i + 1 && p.etag === `etag-${i + 1}`),
        `completing names every part with its etag, and the counts (${done?.objects} objects, ${done?.tris} tris)`,
      );
      const uploaded = await readBozz(owner, fake.projects.get(id).file, id);
      t.eq(uploaded.objects, 2, 'the parts put back together are the scene, both objects');
      t.ok(!uploaded.mentions, 'and the file carries no project link');
      const thumb = fake.calls.find((c) => c.method === 'POST' && c.path === `/admin/api/projects/${id}/thumb`);
      t.ok(thumb?.type === 'image/jpeg' && thumb.body.length > 0, `a thumbnail follows (${thumb?.body.length ?? 0} bytes)`);
      const link = await owner.evaluate(() => window.__sculpt.fileActions.link);
      t.ok(link?.id === id && link.title === fake.projects.get(id).title, `the scene now belongs to the project (${JSON.stringify(link)})`);
      let copies = await shelf(owner);
      t.ok(copies.length === 1 && copies[0].key === id && copies[0].projectId === id && copies[0].objects === 2, `a device copy is kept under the project's id (${JSON.stringify(copies)})`);
      t.eq(await owner.evaluate(() => window.__sculpt.fileActions.hasWork()), false, 'and the scene counts as saved');

      // Again, after an edit: the same project, updated in place.
      await owner.evaluate(() => window.__sculpt.session.addPrimitive('torus'));
      lib = (await fileItems(owner)).find((i) => i.label === 'Save to library');
      t.eq(lib?.hint, `Updates "${link?.title}" in Projects`, 'the menu now says which project a save updates');
      let mark = fake.calls.length;
      await chooseFile(owner, 'Save to library');
      end = await savedToast(owner);
      const again = fake.calls.slice(mark);
      const reFinish = again.find((c) => c.method === 'POST' && c.path === `/admin/api/projects/${id}/scene` && c.search.includes('upload='));
      t.ok(
        end.state === 'done' && !again.some((c) => c.method === 'POST' && c.path === '/admin/api/projects') && fake.body(reFinish?.body ?? Buffer.from('{}')).objects === 3,
        `saving again updates the same project in place, three objects now (${end.text})`,
      );
      t.eq(fake.projects.get(id).scene?.objects, 3, 'and the server has the new scene');

      // The link lives in the autosave record, not in any file.
      const named = await owner.evaluate(async (sid) => {
        const u8 = new Uint8Array(await window.__sculpt.file.pack());
        const raw = u8[0] === 0x1f && u8[1] === 0x8b ? new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : u8;
        return new TextDecoder().decode(raw.subarray(8, 8 + new DataView(raw.buffer).getUint32(4, true))).includes(sid);
      }, id);
      t.ok(!named, 'a .bozz file saved now names no project');
      await owner.evaluate(() => window.__sculpt.persist.flush());
      await boot();
      t.eq(await owner.evaluate(() => window.__sculpt.fileActions.link?.id ?? null), id, 'after a reload the scene still belongs to the project');

      await chooseFile(owner, 'Keep on this device');
      await owner.waitForFunction(() => [...document.querySelectorAll('.file-menu__note')].some((n) => n.textContent === 'Kept on this device'), null, { timeout: 30_000 });

      // The publish forms: public unless chosen otherwise.
      const published = await owner.evaluate(() => {
        const form = document.querySelector('.sculpt-panel__slot[data-slot="model"] .gallery-form');
        const pick = form.querySelector('.gallery-form__visibility');
        const was = pick.value;
        const options = [...pick.options].map((o) => o.value).join();
        form.querySelector('.gallery-form__input[placeholder="project-id"]').value = 'model-one';
        pick.value = 'private';
        [...form.querySelectorAll('button')].find((b) => b.textContent === 'Publish model').click();
        return { was, options };
      });
      await owner.waitForFunction(() => /^Saved/.test(document.querySelector('.sculpt-panel__slot[data-slot="model"] .gallery-form__status')?.textContent ?? ''), null, { timeout: 60_000 }).catch(() => {});
      const model = fake.calls.filter((c) => c.method === 'POST' && c.path === '/admin/api/projects').map((c) => fake.body(c.body)).find((b) => b.id === 'model-one');
      t.ok(published.was === 'public' && published.options === 'public,private', `the publish form offers public or private, public chosen (${published.options})`);
      t.ok(model?.mode === 'model' && model.visibility === 'private', `a model published as private is created private (${JSON.stringify(model)})`);

      // A reel recorded on this scene, kept with recording switched off
      // again: an opened scene must not inherit it (checked below).
      await owner.evaluate(() => window.__sculpt.recorder.setEnabled(true));
      await owner.waitForFunction(() => window.__sculpt.recorder.frameCount() > 0, null, { timeout: 60_000 }).catch(() => {});
      await owner.evaluate(() => window.__sculpt.recorder.setEnabled(false));
      const reel = await storedFrames(owner);
      t.ok(reel > 0, `a frame is recorded and kept with recording off again (${reel} stored)`);

      // The gallery, as the owner sees it.
      await owner.evaluate(() => window.__sculpt.persist.flush());
      await owner.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await owner.waitForSelector(`.card--scene[data-project="${id}"]`, { timeout: 30_000 });
      await owner.waitForFunction((sid) => document.querySelector(`.card--scene[data-project="${sid}"] .card__img`)?.complete, id, { timeout: 10_000 }).catch(() => {});
      const g = await owner.evaluate((sid) => {
        const scene = document.querySelector(`.card--scene[data-project="${sid}"]`);
        const badges = (el) => [...(el?.querySelectorAll('.card__badge') ?? [])].map((b) => b.textContent).join();
        const img = scene.querySelector('.card__img');
        return {
          badges: badges(scene),
          meta: scene.querySelector('.card__meta').textContent,
          href: scene.querySelector('.card__thumb').getAttribute('href'),
          img: img ? { src: img.getAttribute('src'), width: img.naturalWidth } : null,
          toggle: scene.querySelector('.card__vis input')?.checked ?? null,
          device: [...document.querySelectorAll('.card--library:not(.card--scene):not(.card--owned)')].map((c) => ({ note: c.querySelector('.card__note')?.textContent ?? null, upload: !!c.querySelector('.card__upload') })),
          progress: document.querySelector('.card--sculpt:not(.card--armature) .card__note')?.textContent ?? null,
          privReel: badges(document.querySelector('.card--owned[data-project="priv-reel"]')),
          pubReel: badges(document.querySelector('.card--owned[data-project="pub-reel"]')),
          model: !!document.querySelector('[data-project="model-one"]'),
        };
      }, id);
      t.ok(g.badges === 'Scene,Private' && /^3 objects · [\d,]+ tris · /.test(g.meta), `the scene shows in the gallery, badged Private (${g.badges}; ${g.meta})`);
      t.ok(g.href === `/?sculpt=1&project=${id}` && g.toggle === true, `it opens in Sculpt, and its switch says private (${g.href})`);
      t.ok(!!g.img && g.img.src.startsWith(`/admin/api/media/${id}/thumb.jpg?v=`) && g.img.width > 0, `its picture comes through the gated media route (${g.img?.src})`);
      t.ok(g.device.length === 1 && g.device[0].note === DEVICE_NOTE && g.device[0].upload, `the scene kept on the device alone is labelled, with Upload to Projects; the project's own copy has no card of its own (${JSON.stringify(g.device)})`);
      t.eq(g.progress, DEVICE_NOTE, 'the In progress card carries the label for the owner too');
      t.ok(g.privReel === 'Private' && g.pubReel === '' && g.model, `published work shows with its visibility: private "${g.privReel}", public "${g.pubReel}"`);

      mark = fake.calls.length;
      await owner.click(`.card--scene[data-project="${id}"] .card__vis input`);
      await owner.waitForFunction((sid) => document.querySelector(`.card--scene[data-project="${sid}"] .card__badges`)?.textContent === 'Scene', id, { timeout: 10_000 }).catch(() => {});
      const put = fake.calls.slice(mark).find((c) => c.method === 'PUT' && c.path === `/admin/api/projects/${id}`);
      t.ok(!!put && fake.body(put.body).visibility === 'public' && fake.projects.get(id).visibility === 'public', `the switch makes the scene public through the update route (${put ? put.body : 'no call'})`);
      t.eq(await owner.evaluate((sid) => document.querySelector(`.card--scene[data-project="${sid}"] .card__badges`).textContent, id), 'Scene', 'and the Private badge goes');

      mark = fake.calls.length;
      await owner.click('.card--library:not(.card--scene):not(.card--owned) .card__upload');
      await owner.waitForSelector('.card--library.card--uploaded', { timeout: 30_000 }).catch(() => {});
      const newId = [...fake.projects.keys()].find((k) => k.startsWith('scene-test') && k !== id);
      const card = await owner.evaluate(() => {
        const c = document.querySelector('.card--library.card--uploaded');
        return c && { badge: c.querySelector('.card__badge').textContent, note: !!c.querySelector('.card__note'), upload: !!c.querySelector('.card__upload'), href: c.querySelector('.card__thumb').getAttribute('href') };
      });
      t.ok(!!newId && fake.projects.get(newId).scene?.objects === 3, `Upload to Projects makes a project of the kept scene (${newId})`);
      t.ok(card?.badge === 'In Projects' && !card.note && !card.upload && card.href === `/?sculpt=1&project=${newId}`, `and the card is marked uploaded (${JSON.stringify(card)})`);
      copies = await shelf(owner);
      t.ok(copies.length === 2 && copies.every((c) => c.projectId === c.key) && copies.some((c) => c.key === newId), `the kept scene is now that project's device copy (${copies.map((c) => c.key).join(', ')})`);

      // The Projects page: who sees each, and scenes open in Sculpt.
      await owner.goto(`${base}/admin/`, { waitUntil: 'domcontentloaded' });
      await owner.waitForSelector(`.admin-row[data-project="${id}"]`, { timeout: 30_000 });
      const rows = await owner.evaluate(() =>
        Object.fromEntries([...document.querySelectorAll('.admin-row')].map((r) => [r.dataset.project, { open: r.querySelector('.admin-row__open')?.getAttribute('href') ?? null, edit: !!r.querySelector('.admin-row__edit'), priv: r.querySelector('.admin-row__vis input').checked }])),
      );
      t.ok(rows[id]?.open === `/?sculpt=1&project=${id}` && !rows[id].edit && rows['pub-reel']?.edit, 'the Projects page lists the scenes, opening in Sculpt, and the published work, opening in the editor');
      t.ok(rows['priv-reel']?.priv === true && rows['pub-reel']?.priv === false && rows[id]?.priv === false, `with each one's visibility (${JSON.stringify(rows)})`);
      mark = fake.calls.length;
      await owner.click('.admin-row[data-project="priv-reel"] .admin-row__vis input');
      await owner.waitForFunction(() => !document.querySelector('.admin-row[data-project="priv-reel"] .admin-row__vis input').disabled, null, { timeout: 10_000 }).catch(() => {});
      const rowPut = fake.calls.slice(mark).find((c) => c.method === 'PUT' && c.path === '/admin/api/projects/priv-reel');
      t.ok(!!rowPut && fake.body(rowPut.body).visibility === 'public' && fake.projects.get('priv-reel').visibility === 'public', 'a row\'s switch sets its visibility');

      // Opening by ?project=: fetched through the media route, linked.
      mark = fake.calls.length;
      await boot(`&project=${id}`);
      let opened = await bootState(owner);
      const got = fake.calls.slice(mark).filter((c) => c.method === 'GET' && c.path.endsWith('/scene.bozz')).map((c) => c.path);
      t.ok(opened.objects === 3 && opened.link?.id === id && !/project=/.test(opened.search), `?project= opens the scene, linked to its project, and leaves the address (${opened.objects} objects, ${opened.search})`);
      t.ok(got.length === 1 && got[0] === `/media/${id}/scene.bozz`, `the file came from the media route (${got.join(', ')})`);
      t.ok(/^Opened ".+" from Projects$/.test(opened.toast), `and says where it came from ("${opened.toast}")`);
      t.eq(await storedFrames(owner), 0, 'and starts a reel of its own, as File > Open does: the frames recorded before are gone');
      mark = fake.calls.length;
      await boot(`&project=${newId}`);
      opened = await bootState(owner);
      const gated = fake.calls.slice(mark).filter((c) => c.method === 'GET' && c.path.endsWith('/scene.bozz')).map((c) => c.path);
      t.ok(opened.objects === 3 && opened.link?.id === newId && gated[0] === `/admin/api/media/${newId}/scene.bozz`, `a private scene's file comes through the Access-gated media route (${gated.join(', ')})`);

      // Offline: the device copy stands in, still linked to the project.
      fake.opts.offline = true;
      await boot(`&project=${id}`);
      opened = await bootState(owner);
      t.ok(opened.objects === 3 && opened.link?.id === id, `offline, this device's copy opens instead, still the project's (${opened.objects} objects)`);
      t.ok(/^Opened this device's copy of ".+": the server could not be reached$/.test(opened.toast), `and says so, and why ("${opened.toast}")`);
      await boot('&project=no-such-scene');
      opened = await bootState(owner);
      t.ok(opened.failed.includes('Could not open that project: the server could not be reached') && !/project=/.test(opened.search), `with no copy to fall back on, it says it could not open it and carries on (${opened.failed.join(' | ')})`);
      fake.opts.offline = false;

      t.ok(!errors.length, `no page errors in the owner's context${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    } finally {
      await ctx.close();
    }
  },

  // Typed values on sliders (owner request, after Maya). A double-click
  // turns a slider into a number field where it stands, holding the value
  // and selected, with a numeric keyboard on an iPad; Enter or leaving it
  // commits, Esc keeps what was there. A value past the travel is applied
  // as typed: the thumb pins at that end, the row prints the value, and so
  // does the drag bubble; the next drag moves from the pinned thumb. The
  // quantity's own limits still hold. The DoF Focus slider lets go of a
  // tap-to-focus lock when it moves, which the first press of a double-click
  // did; the field puts the lock back, so Esc leaves it. And a typed look
  // rides the scene file.
  async typedValues(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    const empty = await emptySpot(page);
    t.ok(await openPanel(page, 'Render'), 'the Render panel opens');
    const intensity = () => sliderRow(page, 'Render', 'Intensity');
    let row = await intensity();
    t.ok(row && row.min === 0 && row.max === 5 && row.thumb === 3, `the key's Intensity runs 0..5 and sits at 3 (${row?.min}..${row?.max}, ${row?.thumb})`);

    await page.mouse.dblclick(...row.at);
    row = await intensity();
    t.ok(
      !row.shown && row.field?.focused && row.field.selected && row.field.value === '3' && row.field.inputMode === 'decimal',
      `a double-click puts a focused number field in its place, holding 3, selected, with a decimal keyboard (${JSON.stringify(row.field)})`,
    );
    t.eq((await keyLight(page)).intensity, 3, 'and the presses that opened it left the light as it was');
    t.ok(
      await page.evaluate(() => document.querySelector('.slider-field').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))),
      'the field keeps its own context menu (cut and paste)',
    );
    await typeValue(page, '7.5');
    row = await intensity();
    let key = await keyLight(page);
    t.ok(
      row.shown && !row.field && key.intensity === 7.5 && row.thumb === 5 && row.readout === '7.5',
      `Enter applies 7.5, past the travel: the thumb pins at 5 and the row says 7.5 (light ${key.intensity}, thumb ${row.thumb}, readout ${row.readout})`,
    );
    // Pressed at the pinned end, the bubble prints the value itself.
    const [ex, ey] = [row.maxEnd[0] + 6, row.maxEnd[1]];
    await page.mouse.move(ex, ey);
    await page.mouse.down();
    const bubble = await page.evaluate(() => document.querySelector('.slider-bubble')?.textContent ?? null);
    await page.mouse.up();
    t.ok(bubble === '7.5' && (await keyLight(page)).intensity === 7.5, `a press there shows 7.5 in the bubble and moves nothing (${bubble})`);
    // Two presses on one spot inside 350 ms are a double-click, so the
    // drag waits out the one before it.
    await page.waitForTimeout(450);
    await page.mouse.move(ex, ey);
    await page.mouse.down();
    await page.mouse.move(ex - 60, ey, { steps: 4 });
    await page.mouse.up();
    row = await intensity();
    key = await keyLight(page);
    t.ok(key.intensity < 5 && key.intensity === row.thumb && row.readout === null, `a drag from there moves within the travel again (${key.intensity}, readout ${row.readout})`);

    const before = key.intensity;
    await page.mouse.dblclick(...row.at);
    await typeValue(page, '1.2', 'Escape');
    row = await intensity();
    t.ok(!row.field && row.shown && (await keyLight(page)).intensity === before, `Esc closes the field and keeps ${before}`);
    await page.mouse.dblclick(...row.at);
    await typeValue(page, '-3');
    row = await intensity();
    t.ok((await keyLight(page)).intensity === 0 && row.thumb === 0 && row.readout === null, 'below zero is held at zero: an intensity has nothing less');
    await page.mouse.dblclick(...row.at);
    await typeValue(page, '0,25');
    t.eq((await keyLight(page)).intensity, 0.25, 'a comma reads as the decimal point');
    let az = await sliderRow(page, 'Render', 'Azimuth');
    await page.mouse.dblclick(...az.at);
    await typeValue(page, '200');
    az = await sliderRow(page, 'Render', 'Azimuth');
    key = await keyLight(page);
    t.ok(key.azimuth === -160 && az.thumb === -160, `an angle wraps: 200 degrees is -160 (${key.azimuth})`);

    // The keys typed are the field's, not hotkeys.
    const sym = () => page.evaluate(() => window.__sculpt.session.getSymmetry());
    const symBefore = await sym();
    await page.mouse.dblclick(...(await intensity()).at);
    await typeValue(page, 'x', 'Escape');
    t.eq(await sym(), symBefore, 'an x typed into the field leaves symmetry alone');
    // A press anywhere else blurs it (touchGuards), which commits.
    await page.mouse.dblclick(...(await intensity()).at);
    await page.keyboard.type('2.5');
    await dev.penDrag([empty, empty]);
    row = await intensity();
    t.ok(
      !row.field && (await keyLight(page)).intensity === 2.5 && (await page.evaluate(() => document.activeElement === document.body)),
      'a pen press on the canvas blurs the field, which commits it',
    );
    await doubleTap(dev, (await intensity()).at);
    row = await intensity();
    t.ok(row.field?.focused && row.field.value === '2.5', `a double-tap with a finger opens it too (${JSON.stringify(row.field)})`);
    await typeValue(page, '4');
    t.eq((await keyLight(page)).intensity, 4, 'and Enter applies what was typed');
    const viaKey = await page.evaluate(() => {
      const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === 'Render');
      const input = [...p.querySelectorAll('label.compact')].find((r) => r.firstElementChild?.textContent === 'Intensity').querySelector('input');
      input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      const f = document.querySelector('.slider-field');
      return f && document.activeElement === f ? f.value : null;
    });
    t.eq(viaKey, '4', 'Enter on a focused slider opens its field as well');
    await page.keyboard.press('Escape');

    // DoF focus and its lock.
    await page.evaluate(() => {
      const v = window.__bozzetto;
      v.setDoF({ enabled: true });
      v.setDoF({ focusPoint: [0, 0, 0] });
      v.onDofChange?.();
    });
    const dof = () => page.evaluate(() => window.__bozzetto.getDoFState());
    let focus = await sliderRow(page, 'Render', 'Focus');
    await page.mouse.dblclick(...focus.at);
    let d = await dof();
    t.ok(!!d.focusPoint, 'with the Focus field up, the tap-to-focus lock still holds');
    await page.keyboard.press('Escape');
    d = await dof();
    t.ok(!!d.focusPoint && d.focus === 0.35, `Esc leaves the lock and the focus as they were (${d.focus}, lock ${!!d.focusPoint})`);
    focus = await sliderRow(page, 'Render', 'Focus');
    await page.mouse.dblclick(...focus.at);
    await typeValue(page, '1.4');
    d = await dof();
    focus = await sliderRow(page, 'Render', 'Focus');
    t.ok(!d.focusPoint && d.focus === 1.4 && focus.readout === '1.40', `a typed focus lets go of the lock, and may sit behind the subject (${d.focus}, ${focus.readout})`);
    await page.evaluate(() => {
      window.__bozzetto.setDoF({ enabled: false });
      window.__bozzetto.onDofChange?.();
    });

    // Packed past the travel, changed, opened: back as it was typed.
    await page.mouse.dblclick(...(await intensity()).at);
    await typeValue(page, '6.5');
    await page.evaluate(async () => {
      window.__typed = await window.__sculpt.file.pack();
      window.__bozzetto.lighting.setIntensity('key', 1);
    });
    await page.evaluate(() => window.__sculpt.file.open(window.__typed));
    row = await intensity();
    key = await keyLight(page);
    t.ok(key.intensity === 6.5 && row.thumb === 5 && row.readout === '6.5', `a typed 6.5 survives a scene pack and open, pinned, with its readout (${key.intensity}, ${row.readout})`);
  },

  // A brush size typed past the travel (owner request) is the brush's own,
  // like any size: kept as typed, the Tool panel's Size row pinned at 500
  // and saying so and the rail's nub at the top, still there after a tool
  // switch, and in the scene file. A size is held to a pixel at least. The
  // rail's tracks take a double-tap the same way, and the step keys move
  // down from a typed size rather than snapping it back to 500.
  async typedBrush(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    await page.keyboard.press('3'); // Standard clay
    t.ok(await openPanel(page, 'Tool'), 'the Tool panel opens');
    const held = () => page.evaluate(() => window.__sculpt.input.getBrushRadius());
    const nub = () => page.evaluate(() => parseFloat(document.querySelector('.sculpt-slider[data-kind="size"] .sculpt-slider__nub').style.bottom));
    let row = await sliderRow(page, 'Tool', 'Size');
    const start = Math.round(await held());
    await page.mouse.dblclick(...row.at);
    row = await sliderRow(page, 'Tool', 'Size');
    t.ok(row.field?.focused && row.field.value === String(start), `a double-click on Size opens its field at the brush's size (${row.field?.value}, held ${start})`);
    await typeValue(page, '800');
    row = await sliderRow(page, 'Tool', 'Size');
    t.ok(
      Math.round(await held()) === 800 && row.thumb === 500 && row.readout === '800' && (await nub()) === 100,
      `800 is kept: the slider pins at 500 and says 800, the rail's nub sits at the top (${(await held()).toFixed(1)}, ${row.readout}, nub ${await nub()}%)`,
    );
    await page.keyboard.press('4'); // Inflate
    const inflate = Math.round(await held());
    await page.keyboard.press('3');
    row = await sliderRow(page, 'Tool', 'Size');
    t.ok(
      inflate === start && Math.round(await held()) === 800 && row.readout === '800' && row.thumb === 500,
      `Inflate keeps its own size (${inflate}), and back on clay the 800 is still there (${(await held()).toFixed(1)}, ${row.readout})`,
    );
    await page.evaluate(async () => {
      window.__sized = await window.__sculpt.file.pack();
      window.__sculpt.input.setBrushRadius(60);
    });
    await page.evaluate(() => window.__sculpt.file.open(window.__sized));
    await page.keyboard.press('3');
    row = await sliderRow(page, 'Tool', 'Size');
    t.ok(Math.round(await held()) === 800 && row.readout === '800', `it rides the scene file (${(await held()).toFixed(1)}, ${row.readout})`);
    await page.keyboard.press(']');
    t.eq(Math.round(await held()), 800, 'the larger-size key leaves a typed 800 alone');
    await page.keyboard.press('[');
    const stepped = await held();
    t.ok(stepped < 800 && stepped > 500, `the smaller-size key steps down from 800, not from 500 (${stepped.toFixed(1)})`);
    row = await sliderRow(page, 'Tool', 'Size');
    await page.mouse.dblclick(...row.at);
    await typeValue(page, '0');
    t.eq(Math.round(await held()), 1, 'a typed 0 is held to a pixel');

    const track = (kind) =>
      page.evaluate((k) => {
        const r = document.querySelector(`.sculpt-slider[data-kind="${k}"]`).getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      }, kind);
    const floating = () =>
      page.evaluate(() => {
        const f = document.querySelector('.slider-field--float');
        return f && { value: f.value, focused: document.activeElement === f, mode: f.inputMode };
      });
    await doubleTap(dev, await track('size'));
    let field = await floating();
    t.ok(field?.focused && field.value === '1' && field.mode === 'decimal', `a double-tap on the rail's size track opens a field beside it, at the brush's size (${JSON.stringify(field)})`);
    t.eq(Math.round(await held()), 1, 'and the taps themselves left the size alone');
    await typeValue(page, '120');
    t.ok(Math.round(await held()) === 120 && !(await floating()), 'what is typed there sizes the brush, and the field goes');
    await doubleTap(dev, await track('strength'));
    field = await floating();
    const strength = Math.round((await page.evaluate(() => window.__sculpt.input.getBrushIntensity())) * 100);
    t.ok(field?.focused && field.value === String(strength), `the strength track's field is in percent (${field?.value}, ${strength}%)`);
    await typeValue(page, '150');
    t.eq(await page.evaluate(() => window.__sculpt.input.getBrushIntensity()), 1, 'and a strength is held to 100%');
  },

  // The Armature panel's sliders take typed values as well. A part's size
  // typed past 200% is kept, pinned with its readout, and held to the
  // figure's own limit of 400%; it comes back with the saved armature, and
  // so does a light intensity typed in the Render panel, which used to
  // come back with the panel still showing the value from before the look.
  async typedArmature(page, base, t) {
    await openArmature(page, base);
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
    t.ok(await openPanel(page, 'Armature'), 'the Armature panel opens');
    await page.evaluate(() => window.__armature.select('upperarm.L'));
    const size = () => page.evaluate(() => window.__armature.armature.getProportions('upperarm.L').size);
    let row = await sliderRow(page, 'Armature', 'Size');
    t.ok(row && row.max === 2 && row.readout === '100%', `the upper arm's Size runs to 200% and reads 100% (${row?.max}, ${row?.readout})`);
    await page.mouse.dblclick(...row.at);
    row = await sliderRow(page, 'Armature', 'Size');
    t.eq(row.field?.value, '100', 'its field holds the percent the row shows');
    await typeValue(page, '300');
    row = await sliderRow(page, 'Armature', 'Size');
    t.ok((await size()) === 3 && row.thumb === 2 && row.readout === '300%', `300% is kept: the part is 3x, the thumb pinned, the row says 300% (${await size()}, ${row.readout})`);
    await page.mouse.dblclick(...row.at);
    await typeValue(page, '500');
    row = await sliderRow(page, 'Armature', 'Size');
    t.ok((await size()) === 4 && row.readout === '400%', `500% is held at the figure's 400% (${await size()}, ${row.readout})`);
    await openPanel(page, 'Render');
    let light = await sliderRow(page, 'Render', 'Intensity');
    await page.mouse.dblclick(...light.at);
    await typeValue(page, '6');
    t.eq((await keyLight(page)).intensity, 6, 'a light intensity typed in the Render panel here is applied');
    await page.evaluate(() => window.__armature.save());

    await openArmature(page, base);
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
    await openPanel(page, 'Armature');
    await page.evaluate(() => window.__armature.select('upperarm.L'));
    row = await sliderRow(page, 'Armature', 'Size');
    t.ok((await size()) === 4 && row.readout === '400%' && row.thumb === 2, `after a reload the part is still 400%, pinned (${await size()}, ${row.readout})`);
    await openPanel(page, 'Render');
    light = await sliderRow(page, 'Render', 'Intensity');
    t.ok((await keyLight(page)).intensity === 6 && light.readout === '6.0' && light.thumb === 5, `and the Render panel shows the light's 6, not what it had before the look (${light.readout}, thumb ${light.thumb})`);
  },

  // The Render panel's travel and defaults (owner call: most of the old
  // 0..8 light and 0..3 HDRI travel went unused at the top), and a look
  // saved with values past the new travel, which loads and renders as it
  // was: the light and the environment at their saved strengths, the
  // panel's thumbs pinned and its rows saying the values.
  async sliderRanges(page, base, t) {
    await openSculpt(page, base, '&q=low');
    t.ok(await openPanel(page, 'Render'), 'the Render panel opens');
    const light = await sliderRow(page, 'Render', 'Intensity');
    t.ok(light.min === 0 && light.max === 5 && light.step === 0.1, `a light's Intensity runs 0..5 (${light.min}..${light.max})`);
    const fresh = await page.evaluate(() => window.__bozzetto.environment.getState().intensity);
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === 'Render');
      const sel = [...p.querySelectorAll('label.label-row')].find((l) => l.firstElementChild?.textContent === 'HDRI').querySelector('select');
      sel.value = 'studio-neutral';
      sel.dispatchEvent(new Event('change'));
    });
    await page.waitForFunction(() => !!window.__bozzetto.scene.environment, null, { timeout: 30_000 });
    const hdri = await sliderRow(page, 'Render', 'Intensity', 1);
    t.ok(
      hdri.shown && hdri.min === 0 && hdri.max === 2 && hdri.step === 0.01 && hdri.thumb === fresh && fresh === HDRI_DEFAULT,
      `the HDRI's Intensity runs 0..2 in hundredths, and a new environment starts at ${HDRI_DEFAULT} (${hdri.min}..${hdri.max} by ${hdri.step}, at ${hdri.thumb})`,
    );
    const rot = await sliderRow(page, 'Render', 'Rotation');
    t.ok(rot.min === 0 && rot.max === 360, 'its Rotation runs a full turn');
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === 'Render');
      const sel = [...p.querySelectorAll('label.label-row')].find((l) => l.firstElementChild?.textContent === 'Model').querySelector('select');
      sel.value = 'gtao';
      sel.dispatchEvent(new Event('change'));
    });
    const aoStrength = await sliderRow(page, 'Render', 'Strength', 0);
    const aoRadius = await sliderRow(page, 'Render', 'Radius', 0);
    t.ok(
      aoStrength.min === 0 && aoStrength.max === 2 && aoStrength.thumb === AO_DEFAULT.intensity,
      `GTAO's Strength runs 0..2 and starts at ${AO_DEFAULT.intensity} (${aoStrength.min}..${aoStrength.max}, at ${aoStrength.thumb})`,
    );
    t.ok(
      aoRadius.min === 0.05 && aoRadius.max === 1 && aoRadius.step === 0.01 && aoRadius.thumb === AO_DEFAULT.radius,
      `its Radius runs 0.05..1 in hundredths and starts at ${AO_DEFAULT.radius} (${aoRadius.min}..${aoRadius.max}, at ${aoRadius.thumb})`,
    );
    const cavStrength = await sliderRow(page, 'Render', 'Strength', 1);
    const cavRadius = await sliderRow(page, 'Render', 'Radius', 1);
    t.ok(
      cavStrength.max === CAVITY_DEFAULT.strengthMax && cavStrength.thumb === CAVITY_DEFAULT.strength && cavRadius.min === CAVITY_DEFAULT.radiusMin && cavRadius.max === CAVITY_DEFAULT.radiusMax && cavRadius.thumb === CAVITY_DEFAULT.radius,
      `the cavity's Strength runs 0..${cavStrength.max} from ${cavStrength.thumb}, its Radius ${cavRadius.min}..${cavRadius.max} px from ${cavRadius.thumb}`,
    );

    // A look from before the ranges changed, with values past them.
    await page.evaluate(async () => {
      const v = window.__bozzetto;
      const look = v.getLook();
      look.lighting.key.intensity = 7;
      look.environment.intensity = 2.6;
      await v.applyLook(look);
      window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
    });
    const lit = await page.evaluate(() => ({ key: window.__bozzetto.lighting.state().find((l) => l.id === 'key').intensity, env: window.__bozzetto.scene.environmentIntensity }));
    const keyRow = await sliderRow(page, 'Render', 'Intensity', 0);
    const envRow = await sliderRow(page, 'Render', 'Intensity', 1);
    t.ok(
      lit.key === 7 && Math.abs(lit.env - 2.6 * ENV_SCALE) < 1e-12,
      `a saved look past the new travel renders as saved (key ${lit.key}, HDRI ${lit.env}, 2.6 on the slider's scale)`,
    );
    t.ok(
      keyRow.thumb === 5 && keyRow.readout === '7.0' && envRow.thumb === 2 && envRow.readout === '2.60',
      `and the panel pins both thumbs and says the values (${keyRow.readout}, ${envRow.readout})`,
    );
  },

  // Ambient occlusion (owner report: the radius felt large and cut off,
  // and over 0.5 the strength drew black outlines). GTAO's defaults are
  // what the panel starts on and what the pass gets; the radius follows the
  // subject, and so does the denoise's depth tolerance; GTAO and its
  // denoise are in the graph only while GTAO is the model; and the model
  // rides a scene file - a GTAO look used to come back as Cavity.
  async aoDefaults(page, base, t) {
    await openSculpt(page, base, '&q=low');
    const state = () =>
      page.evaluate(() => {
        const v = window.__bozzetto;
        const out = v.pipeline.outputNode;
        return {
          ao: v.getAOState(),
          cav: v.getSculptAO(),
          radius: v.aoNode.radius.value,
          subject: v.subjectRadius,
          phi: v.aoDenoise.depthPhi.value,
          out: out === v.composites.sculpt.ao ? 'gtao' : out === v.composites.sculpt.plain ? 'plain' : 'other',
        };
      });
    const model = (value) =>
      page.evaluate((m) => {
        const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === 'Render');
        const sel = [...p.querySelectorAll('label.label-row')].find((l) => l.firstElementChild?.textContent === 'Model').querySelector('select');
        if (m) {
          sel.value = m;
          sel.dispatchEvent(new Event('change'));
        }
        return sel.value;
      }, value);
    let s = await state();
    t.ok(
      !s.ao.enabled && s.cav.strength === CAVITY_DEFAULT.strength && s.cav.radius === CAVITY_DEFAULT.radius && (await model()) === 'cavity',
      `sculpt mode starts on the cavity at its defaults (${s.cav.strength}, ${s.cav.radius} px)`,
    );
    t.ok(s.ao.intensity === AO_DEFAULT.intensity && s.ao.radius === AO_DEFAULT.radius, `GTAO waits at strength ${s.ao.intensity}, radius ${s.ao.radius}`);
    t.eq(s.out, 'plain', 'with the cavity on, neither GTAO nor its denoise is in the graph');
    await model('gtao');
    s = await state();
    t.ok(s.ao.enabled && s.cav.strength === 0 && s.out === 'gtao', `choosing GTAO puts it in the graph and the cavity at zero (${s.out})`);
    t.ok(
      Math.abs(s.radius - AO_DEFAULT.radius * s.subject) < 1e-6 && Math.abs(s.phi - 0.25 * s.radius) < 1e-6,
      `its radius is ${AO_DEFAULT.radius} of the subject's (${s.radius.toFixed(2)} of ${s.subject.toFixed(2)}), the denoise's depth tolerance a quarter of that`,
    );
    await page.evaluate(async () => {
      window.__aoLook = await window.__sculpt.file.pack();
    });
    await model('cavity');
    s = await state();
    t.ok(!s.ao.enabled && s.cav.strength === CAVITY_DEFAULT.strength && s.out === 'plain', 'back on the cavity, GTAO leaves the graph and the cavity has its strength back');
    await page.evaluate(() => window.__sculpt.file.open(window.__aoLook));
    s = await state();
    t.ok(s.ao.enabled && s.out === 'gtao' && (await model()) === 'gtao', `a scene saved on GTAO opens on GTAO, and the panel says so (${await model()})`);
  },

  // The Capture window (owner request): a chip in the top row beside File
  // and Edit, styled like them, opens the capture controls in a window
  // that floats over the work and blocks none of it. The title bar drags
  // it, the close button, the chip and Esc (while it has the focus) put
  // it away, and a pen stroke on the model leaves it open. Where it was
  // left lasts the session and stays on screen as the window changes
  // size; it follows the theme, hides with the interface on Tab, and its
  // title bar keeps the long press and the browser's gestures out. Signed
  // in through the faked probe, as captureOff is, so the chip is offered.
  async captureWindow(page, base, t) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    try {
      const owner = await ctx.newPage();
      const errors = [];
      owner.on('pageerror', (e) => errors.push(String(e)));
      await signInContext(ctx);
      const boot = async () => {
        await openForInput(owner, base);
        await owner.waitForFunction(() => window.__sculpt.captureWindow.isAvailable(), null, { timeout: 30_000 });
      };
      await boot();

      const row = await owner.evaluate(() => {
        const chips = [...document.querySelectorAll('.topbar--left > *')].filter((c) => !c.hidden).map((c) => c.textContent.trim());
        const look = (el) => {
          const s = getComputedStyle(el);
          return [s.fontFamily, s.fontSize, s.letterSpacing, s.textTransform, s.paddingTop, s.paddingLeft, s.borderTopWidth, s.borderTopColor, s.borderRadius, s.backgroundColor, s.color].join('|');
        };
        const file = document.querySelector('.file-menu--file__chip');
        const edit = document.querySelector('.file-menu--edit__chip');
        const capture = window.__sculpt.captureWindow.chip;
        return { chips, like: look(capture) === look(file) && look(capture) === look(edit) };
      });
      t.eq(row.chips.join(', '), '← Gallery, File, Edit, Capture', 'signed in, the top row has a Capture chip beside File and Edit');
      t.ok(row.like, 'styled as they are');
      let s = await captureState(owner);
      t.ok(!s.open && !s.shown && s.chip.expanded === 'false' && !s.chip.lit, 'the window starts closed');

      // Opened from the chip: under it, the chip pressed, and everything the
      // Capture panel held inside.
      await owner.mouse.click(...(await centreOf(owner, '.capture-window__chip')));
      s = await captureState(owner);
      t.ok(s.open && s.shown && s.chip.expanded === 'true' && s.chip.lit, `the chip opens it and shows it is open (expanded ${s.chip.expanded})`);
      const column = await owner.evaluate(() => Math.max(...[...document.querySelectorAll('.panel--left')].map((p) => p.offsetLeft + p.offsetWidth)));
      t.ok(
        Math.abs(s.rect.t - (s.chip.b + 6)) <= 1 && s.rect.l >= s.chip.l && s.rect.l >= column && s.rect.l <= column + 10,
        `the first time, under the chip and clear of where the left panels open (${showRect(s.rect)}; chip at ${s.chip.l}, panels to ${column})`,
      );
      const holds = await owner.evaluate(() => {
        const root = window.__sculpt.captureWindow.root;
        const buttons = [...root.querySelectorAll('button')].filter((b) => b.checkVisibility()).map((b) => b.textContent);
        return {
          record: [...root.querySelectorAll('label.checkbox')].some((l) => l.textContent.includes('Record timelapse')),
          readout: root.querySelector('.capture__readout')?.textContent ?? '',
          clear: buttons.includes('Clear frames'),
          timelapse: !!root.querySelector('[data-slot="timelapse"] .gallery-form'),
          model: !!root.querySelector('[data-slot="model"] .gallery-form'),
          publish: buttons.filter((b) => /^Publish /.test(b)),
          modal: root.getAttribute('aria-modal'),
          docked: !!document.querySelector('.panel--capture'),
        };
      });
      t.ok(
        holds.record && holds.clear && /frames? - /.test(holds.readout) && holds.timelapse && holds.model && holds.publish.join(',') === 'Publish timelapse,Publish model',
        `it holds Record timelapse, the readout ("${holds.readout}"), Clear frames and both publish forms (${holds.publish.join(', ')})`,
      );
      t.ok(holds.modal === 'false' && !holds.docked, 'it is a non-modal window, and the docked Capture panel is gone');

      // The title bar drags it, by the mouse.
      const title = () => centreOf(owner, '.capture-window .float-window__title');
      let from = s.rect;
      let at = await title();
      await owner.mouse.move(...at);
      await owner.mouse.down();
      await owner.mouse.move(at[0] - 150, at[1] + 120, { steps: 5 });
      await owner.mouse.up();
      s = await captureState(owner);
      t.ok(s.open && s.rect.l === from.l - 150 && s.rect.t === from.t + 120, `dragged by its title bar, it moves with the pointer (${showRect(from)} to ${showRect(s.rect)})`);
      t.ok(s.focused, 'and has the focus');
      const placed = s.rect;
      t.eq(s.stored, JSON.stringify({ x: placed.l, y: placed.t }), 'where it was left is kept for the session');

      // The chip toggles it; it comes back where it was.
      await owner.mouse.click(...(await centreOf(owner, '.capture-window__chip')));
      s = await captureState(owner);
      t.ok(!s.open && !s.shown && s.chip.expanded === 'false' && !s.chip.lit && !s.focused, 'the chip closes it again, taking the focus with it');
      await owner.mouse.click(...(await centreOf(owner, '.capture-window__chip')));
      s = await captureState(owner);
      t.ok(s.open && s.rect.l === placed.l && s.rect.t === placed.t, `and opens it where it was left (${showRect(s.rect)})`);

      // Esc closes it while it has the focus, and only then.
      await owner.evaluate(() => document.activeElement?.blur?.());
      await owner.keyboard.press('Escape');
      t.ok((await captureState(owner)).open, 'Esc with the focus elsewhere leaves it open');
      await owner.mouse.click(...(await centreOf(owner, '.capture-window .section h3')));
      s = await captureState(owner);
      t.ok(s.focused, 'a press inside gives it the focus');
      await owner.keyboard.press('Escape');
      s = await captureState(owner);
      t.ok(!s.open && !s.shown && !s.focused, 'and Esc then closes it');
      await owner.mouse.click(...(await centreOf(owner, '.capture-window__chip')));
      await owner.mouse.click(...(await centreOf(owner, '.capture-window .float-window__close')));
      t.ok(!(await captureState(owner)).open, 'its close button closes it');

      // Non-modal: open, a pen stroke on the sphere sculpts, and it stays.
      await owner.mouse.click(...(await centreOf(owner, '.capture-window__chip')));
      const dev = await devices(owner);
      await owner.keyboard.press('3'); // Standard clay
      const [cx, cy] = await screenOf(owner, 'Sphere');
      const path = line([cx - 70, cy], [cx + 70, cy + 10]);
      const ends = [await probe(owner, path[0]), await probe(owner, path[path.length - 1])];
      t.ok(ends.every((p) => p.canvas && p.hit), 'the test stroke runs over the sphere, clear of the window');
      const sum = await meshSum(owner);
      const strokes = await strokeCount(owner);
      await dev.penDrag(path);
      await settle(owner);
      s = await captureState(owner);
      t.ok((await strokeCount(owner)) === strokes + 1 && (await meshSum(owner)) !== sum, 'with the window open, a pen stroke sculpts');
      t.ok(s.open && s.shown, 'and the window stays open');

      // Long press and gestures: the title bar cancels its touches' default
      // and takes no browser gesture, there is no context menu on it, and a
      // finger drags it as the mouse does.
      await owner.evaluate(() => {
        window.__touchDefaults = [];
        window.addEventListener('touchstart', (e) => window.__touchDefaults.push(e.defaultPrevented));
      });
      at = await title();
      await dev.tap(at);
      const guards = await owner.evaluate(() => {
        const bar = document.querySelector('.capture-window .float-window__bar');
        const css = getComputedStyle(bar);
        return {
          cancelled: window.__touchDefaults[0] ?? null,
          touchAction: css.touchAction,
          menu: !bar.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
          select: css.userSelect,
        };
      });
      t.ok(guards.cancelled === true && guards.touchAction === 'none' && guards.select === 'none', `a touch on the title bar cannot arm a long press or a gesture (${JSON.stringify(guards)})`);
      t.ok(guards.menu, 'nor bring up a context menu');
      t.ok((await captureState(owner)).open, 'and a tap on it leaves the window open');
      from = (await captureState(owner)).rect;
      at = await title();
      await dev.finger(line(at, [at[0] + 60, at[1] + 40], 4));
      s = await captureState(owner);
      t.ok(s.rect.l === from.l + 60 && s.rect.t === from.t + 40, `a finger drags it too (${showRect(from)} to ${showRect(s.rect)})`);
      const kept = s.rect;

      // On screen as the window changes size, and back in its place after.
      // The resize reaches the page with its next frame, which under a
      // software renderer can be seconds away.
      const fits = (w, h) =>
        owner
          .waitForFunction(
            ([ww, hh]) => {
              const r = window.__sculpt.captureWindow.root.getBoundingClientRect();
              return innerWidth === ww && innerHeight === hh && r.left >= 8 && r.top >= 8 && r.right <= ww - 8 && r.bottom <= hh - 8;
            },
            [w, h],
            { timeout: 30_000 },
          )
          .catch(() => {});
      await owner.setViewportSize({ width: 560, height: 420 });
      await fits(560, 420);
      s = await captureState(owner);
      t.ok(s.rect.l >= 8 && s.rect.t >= 8 && s.rect.r <= 552 && s.rect.b <= 412, `a smaller window keeps it on screen (${showRect(s.rect)} in 560x420)`);
      await owner.setViewportSize({ width: 1280, height: 800 });
      await owner
        .waitForFunction(([x, y]) => {
          const r = window.__sculpt.captureWindow.root.getBoundingClientRect();
          return Math.round(r.left) === x && Math.round(r.top) === y;
        }, [kept.l, kept.t], { timeout: 30_000 })
        .catch(() => {});
      s = await captureState(owner);
      t.ok(s.rect.l === kept.l && s.rect.t === kept.t, `back at full size it is where it was put (${showRect(s.rect)})`);

      // The theme, and Tab.
      const background = () => owner.evaluate(() => getComputedStyle(window.__sculpt.captureWindow.root).backgroundColor);
      const ink = await background();
      await owner.evaluate(() => document.querySelector('.theme-toggle').click());
      const paper = await background();
      await owner.evaluate(() => document.querySelector('.theme-toggle').click());
      t.ok(ink !== paper && (await background()) === ink, `it follows the theme (${ink} in ink, ${paper} in paper)`);
      await owner.evaluate(() => document.activeElement?.blur?.());
      await owner.keyboard.press('Tab');
      await owner.waitForFunction(() => getComputedStyle(window.__sculpt.captureWindow.root).visibility === 'hidden', null, { timeout: 5000 }).catch(() => {});
      s = await captureState(owner);
      const chromeHidden = await owner.evaluate(() => document.body.classList.contains('chrome-hidden'));
      t.ok(chromeHidden && s.visibility === 'hidden' && s.open, `Tab hides it with the rest of the interface (visibility ${s.visibility})`);
      await owner.keyboard.press('Tab');
      s = await captureState(owner);
      t.ok(s.visibility === 'visible' && s.open && s.rect.l === kept.l && s.rect.t === kept.t, 'and Tab again brings it back, open, where it was');

      // A reload: the place is the session's.
      await boot();
      await owner.mouse.click(...(await centreOf(owner, '.capture-window__chip')));
      s = await captureState(owner);
      t.ok(s.open && s.rect.l === kept.l && s.rect.t === kept.t, `after a reload it opens where it was left (${showRect(s.rect)})`);
      t.ok(!errors.length, `no page errors in the owner's context${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    } finally {
      await ctx.close();
    }
  },

  // Recording only where it can go somewhere (owner call). A guest on the
  // web gets no Capture chip, and nothing records whatever the stored
  // choice says - the choice and the frames recorded before are left as
  // they were, and New clears the frames as it always has; nothing about
  // recording is offered elsewhere either. Signed in later in the session
  // (the forms' re-check, or the page coming back to the front), the chip
  // appears and a stored "on" records. The desktop app records signed in
  // or not: its bridge is stood in for, since isDesktop() asks only
  // whether window.bozzettoDesktop exists.
  async captureGate(page, base, t) {
    const ctx = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    const desk = await page.context().browser().newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    try {
      const web = await ctx.newPage();
      const errors = [];
      web.on('pageerror', (e) => errors.push(String(e)));
      web.on('dialog', (d) => void d.accept());
      const recording = () =>
        web.evaluate(() => {
          const { recorder, captureWindow } = window.__sculpt;
          return {
            allowed: recorder.isAllowed(),
            on: recorder.isEnabled(),
            frames: recorder.frameCount(),
            stored: localStorage.getItem('bozzetto-sculpt-record'),
            chip: !captureWindow.chip.hidden && getComputedStyle(captureWindow.chip).display !== 'none',
          };
        });
      const show = (r) => `allowed ${r.allowed}, recording ${r.on}, ${r.frames} frames, stored ${r.stored}, chip ${r.chip ? 'shown' : 'hidden'}`;

      // Signed in first: a frame recorded, and the choice stored as "on".
      await signInContext(ctx);
      await openSculpt(web, base, '&q=low');
      await web.waitForFunction(() => window.__sculpt.recorder.isAllowed(), null, { timeout: 30_000 });
      await web.evaluate(() => window.__sculpt.recorder.setEnabled(true));
      await web.waitForFunction(() => window.__sculpt.recorder.frameCount() > 0, null, { timeout: 60_000 });
      let r = await recording();
      t.ok(r.allowed && r.on && r.chip && r.frames > 0 && r.stored === 'on', `signed in, the chip shows and a stored "on" records (${show(r)})`);
      const recorded = await storedFrames(web);

      // A guest from here on: the probe finds no session.
      await ctx.unroute('**/admin/api/whoami');
      await openSculpt(web, base, '&q=low');
      await web.waitForFunction(() => [...document.querySelectorAll('.gallery-form')].some((f) => !f.hidden), null, { timeout: 30_000 });
      await web.waitForTimeout(1500); // the recorder's install, and any frame it might wrongly seed
      r = await recording();
      t.ok(!r.allowed && !r.on && !r.chip, `a guest on the web gets no Capture chip, and nothing records (${show(r)})`);
      t.ok(r.stored === 'on' && r.frames === recorded && (await storedFrames(web)) === recorded, `the stored choice and the ${recorded} frame(s) recorded before are left as they were`);
      const opened = await web.evaluate(() => {
        const w = window.__sculpt.captureWindow;
        w.open();
        return { open: w.isOpen(), shown: getComputedStyle(w.root).display !== 'none' };
      });
      t.ok(!opened.open && !opened.shown, 'and the window cannot be opened');
      await web.evaluate(() => {
        const { session } = window.__sculpt;
        session.addPrimitive('cube');
        session.toggleSymmetry();
      });
      await web.waitForTimeout(2500);
      r = await recording();
      t.ok(r.frames === recorded && (await storedFrames(web)) === recorded, `edits as a guest record nothing, whatever the stored "on" says (${show(r)})`);
      const offered = await offeredText(web);
      t.ok(!/record|timelapse|capture/i.test(offered), 'nothing about recording is offered in the File menu or the hotkey guide');

      // New clears the old frames, as it always has.
      await chooseFile(web, 'New sculpt');
      await web.waitForFunction(() => window.__sculpt.recorder.frameCount() === 0, null, { timeout: 30_000 }).catch(() => {});
      t.eq(await storedFrames(web), 0, 'File > New clears the frames recorded before');

      // Signed in later in the session, through the forms' re-check: the
      // chip appears, and the stored "on" records.
      await signInContext(ctx);
      await web.evaluate(() => document.querySelector('.capture-window [data-slot="model"] .gallery-form__gate button').click());
      await web.waitForFunction(() => window.__sculpt.recorder.isAllowed(), null, { timeout: 30_000 }).catch(() => {});
      await web.waitForFunction(() => window.__sculpt.recorder.frameCount() > 0, null, { timeout: 60_000 }).catch(() => {});
      r = await recording();
      t.ok(r.allowed && r.on && r.chip && r.frames > 0, `signed in through the forms' re-check, the chip appears and recording starts (${show(r)})`);

      // Or by coming back to the page after signing in elsewhere.
      await ctx.unroute('**/admin/api/whoami');
      await openSculpt(web, base, '&q=low');
      await web.waitForFunction(() => [...document.querySelectorAll('.gallery-form')].some((f) => !f.hidden), null, { timeout: 30_000 });
      t.ok(!(await recording()).chip, 'signed out again, a reload has no chip');
      await signInContext(ctx);
      await web.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await web.waitForFunction(() => window.__sculpt.recorder.isAllowed(), null, { timeout: 30_000 }).catch(() => {});
      r = await recording();
      t.ok(r.allowed && r.chip, `back in front, signed in meanwhile, the page asks again and the chip appears (${show(r)})`);
      t.ok(!errors.length, `no page errors on the web${errors.length ? `: ${errors.join(' | ')}` : ''}`);

      // The desktop app: no sign-in, no server, and the chip from the start.
      await desk.addInitScript(desktopBridgeStub);
      const app = await desk.newPage();
      const appErrors = [];
      app.on('pageerror', (e) => appErrors.push(String(e)));
      await openSculpt(app, base, '&q=low');
      const desktop = await app.evaluate(() => {
        const { recorder, captureWindow, fileMenu } = window.__sculpt;
        return {
          desktop: !!window.bozzettoDesktop,
          allowed: recorder.isAllowed(),
          chip: !captureWindow.chip.hidden,
          row: [...document.querySelectorAll('.topbar--left > *')].filter((c) => !c.hidden).map((c) => c.textContent.trim()).join(', '),
          fileMenu: !!fileMenu,
        };
      });
      t.ok(desktop.desktop && desktop.allowed && desktop.chip && !desktop.fileMenu, `in the desktop app recording is allowed and the chip shows, with no sign-in (row: ${desktop.row})`);
      await app.evaluate(() => {
        const { captureWindow } = window.__sculpt;
        captureWindow.open();
        [...captureWindow.root.querySelectorAll('label.checkbox')].find((l) => l.textContent.includes('Record timelapse')).querySelector('input').click();
      });
      await app.waitForFunction(() => window.__sculpt.recorder.frameCount() > 0, null, { timeout: 60_000 }).catch(() => {});
      t.ok(await app.evaluate(() => window.__sculpt.recorder.isEnabled() && window.__sculpt.recorder.frameCount() > 0), 'and the box records there');
      t.ok(!appErrors.length, `no page errors in the desktop app${appErrors.length ? `: ${appErrors.join(' | ')}` : ''}`);
    } finally {
      await ctx.close();
      await desk.close();
    }
  },

  // The panels' sides (owner call): Scene then Model down the left edge,
  // Render then Tool down the right. One panel per edge is open at a time
  // and either edge's panel stays open when the other edge's opens. On the
  // iPad's screens, in either orientation and under Safari's toolbars, no
  // two tabs overlap or leave the screen or run into the brush rail, the
  // stats or the toolbar, an open left panel covers neither tab on its
  // edge, and an open Render ducks the Tool tab it covers, as it always has.
  async panelSides(page, base, t) {
    await openSculpt(page, base, '&q=low');
    // The panels slide; the geometry under test is where they end up.
    await page.addStyleTag({ content: '.panel { transition: none !important; }' });
    const layout = () =>
      page.evaluate(() => {
        const panels = {
          Scene: document.querySelector('.panel--scene'),
          Model: document.querySelector('.panel--model'),
          Render: [...document.querySelectorAll('.panel')].find((p) => p.querySelector('.panel__title')?.textContent === 'Render'),
          Tool: document.querySelector('.panel--sculpt'),
        };
        const box = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { l: r.left, t: r.top, r: r.right, b: r.bottom };
        };
        const out = {};
        for (const [name, p] of Object.entries(panels)) {
          const handle = p.querySelector('.panel__handle');
          const hs = getComputedStyle(handle);
          out[name] = {
            left: p.classList.contains('panel--left'),
            open: !p.classList.contains('panel--collapsed'),
            body: box(p),
            tab: hs.display === 'none' || hs.visibility === 'hidden' ? null : box(handle),
            ducked: p.classList.contains('panel--tab-hidden'),
          };
        }
        out.extra = {
          rail: box(document.querySelector('.sculpt-sliders')),
          stats: box(document.querySelector('.sculpt-stats')),
          toolbar: [...document.querySelectorAll('.sculpt-toolbar__corner, .sculpt-toolbar__group')].map(box),
          topbar: [...document.querySelectorAll('.topbar .topchip')].filter((c) => !c.hidden).map(box),
        };
        return out;
      });
    const meets = (a, b) => !!a && !!b && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
    const setOpen = (name, open) =>
      page.evaluate(
        ([n, o]) => {
          const { scenePanel, modelPanel, sculptPanel } = window.__sculpt;
          const render = [...document.querySelectorAll('.panel')].find((p) => p.querySelector('.panel__title')?.textContent === 'Render');
          if (n === 'Render') {
            if (render.classList.contains('panel--collapsed') === o) render.querySelector(o ? '.panel__handle' : '.panel__close').click();
            return;
          }
          ({ Scene: scenePanel, Model: modelPanel, Tool: sculptPanel })[n].setCollapsed(!o);
        },
        [name, open],
      );
    const closeAll = async () => {
      for (const n of ['Scene', 'Model', 'Render', 'Tool']) await setOpen(n, false);
    };

    let l = await layout();
    t.ok(l.Scene.left && l.Model.left && !l.Render.left && !l.Tool.left, 'Scene and Model dock left, Render and Tool right');
    // A docked tab tucks its outer border just past the screen's edge.
    const atEdge = (tab, x) => Math.abs(tab.l - x) <= 1 || Math.abs(tab.r - x) <= 1;
    t.ok(
      l.Scene.tab.t < l.Model.tab.t && atEdge(l.Scene.tab, 0) && atEdge(l.Model.tab, 0),
      `down the left edge, Scene then Model (tabs at ${Math.round(l.Scene.tab.t)} and ${Math.round(l.Model.tab.t)})`,
    );
    t.ok(l.Render.tab.t < l.Tool.tab.t, `down the right edge, Render then Tool (tabs at ${Math.round(l.Render.tab.t)} and ${Math.round(l.Tool.tab.t)})`);

    // One open per edge; the other edge keeps what it had.
    const opened = async () => {
      const x = await layout();
      return ['Scene', 'Model', 'Render', 'Tool'].filter((n) => x[n].open).join(',');
    };
    await setOpen('Scene', true);
    await setOpen('Tool', true);
    const a = await opened();
    await setOpen('Model', true);
    const b = await opened();
    await setOpen('Render', true);
    const c = await opened();
    await setOpen('Model', false);
    const d = await opened();
    t.ok(a === 'Scene,Tool' && b === 'Model,Tool' && c === 'Model,Render' && d === 'Render', `one panel open per edge, each edge on its own (${[a, b, c, d].join(' | ')})`);
    await closeAll();

    const sizes = [
      [1024, 768], [768, 1024], [1080, 810], [810, 1080], [1133, 744], [744, 1133],
      [1180, 820], [820, 1180], [1194, 834], [834, 1194], [1366, 1024], [1024, 1366],
      // In Safari rather than from the home screen: its toolbars take the top.
      [1133, 670], [1024, 690], [744, 1060],
    ];
    const problems = [];
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(60);
      await closeAll();
      l = await layout();
      const names = ['Scene', 'Model', 'Render', 'Tool'];
      const at = `${w}x${h}`;
      for (const n of names) {
        const tab = l[n].tab;
        if (!tab) problems.push(`${at}: ${n} has no tab`);
        else if (tab.t < 0 || tab.b > h || tab.l < -1 || tab.r > w + 1) problems.push(`${at}: ${n}'s tab leaves the screen`);
      }
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          if (meets(l[names[i]].tab, l[names[j]].tab)) problems.push(`${at}: the ${names[i]} and ${names[j]} tabs overlap`);
        }
        const tab = l[names[i]].tab;
        if (meets(tab, l.extra.rail)) problems.push(`${at}: ${names[i]}'s tab runs into the brush rail`);
        if (meets(tab, l.extra.stats)) problems.push(`${at}: ${names[i]}'s tab runs into the stats`);
        if (l.extra.toolbar.some((x) => meets(tab, x))) problems.push(`${at}: ${names[i]}'s tab runs into the toolbar`);
        if (l.extra.topbar.some((x) => meets(tab, x))) problems.push(`${at}: ${names[i]}'s tab runs into the top row`);
      }
      // An open left panel covers neither left tab; Render ducks Tool's.
      for (const [open, other] of [['Scene', 'Model'], ['Model', 'Scene']]) {
        await setOpen(open, true);
        const x = await layout();
        if (!x[other].tab) problems.push(`${at}: open ${open} hides ${other}'s tab`);
        else if (meets(x[open].body, x[other].tab)) problems.push(`${at}: open ${open} covers ${other}'s tab`);
        await setOpen(open, false);
      }
      await setOpen('Render', true);
      let x = await layout();
      if (meets(x.Render.body, l.Tool.tab) && !x.Tool.ducked) problems.push(`${at}: open Render covers Tool's tab without ducking it`);
      await setOpen('Tool', true);
      x = await layout();
      if (x.Render.tab && meets(x.Tool.body, x.Render.tab)) problems.push(`${at}: open Tool covers Render's tab`);
      await closeAll();
      x = await layout();
      if (!x.Tool.tab || x.Tool.ducked) problems.push(`${at}: Tool's tab does not come back when Render closes`);
    }
    t.ok(!problems.length, `on ${sizes.length} iPad screens, no tab overlaps or leaves the screen, and no open panel covers a tab it should not${problems.length ? `: ${problems.join('; ')}` : ''}`);
  },

  // Mask and Extract live in the Model panel now, as its own section, and
  // act on the active object as before; the Tool panel has no Mask section
  // left. The mask keys (Ctrl + A / I / C / E) and the Mask brush (Ctrl +
  // pen drag) are as they were, and Ctrl + E extracts at the Model panel's
  // thickness.
  async maskModel(page, base, t) {
    await openForInput(page, base);
    const dev = await devices(page);
    // Masked share of the active object: 0 for none, 1 for all, and how
    // many vertices sit part-way.
    const mask = () =>
      page.evaluate(() => {
        const m = window.__sculpt.session.getMesh();
        const mat = m.getMaterials();
        const n = m.getNbVertices();
        let masked = 0;
        let partial = 0;
        for (let i = 0; i < n; i++) {
          const v = mat[i * 3 + 2];
          masked += 1 - v;
          if (v > 0.01 && v < 0.99) partial++;
        }
        return { masked: masked / n, partial };
      });
    const sections = await page.evaluate(() => {
      const heads = (sel) => [...document.querySelectorAll(`${sel} .section h3`)].map((h) => h.textContent);
      const model = document.querySelector('.panel--model');
      const sec = [...model.querySelectorAll('.section')].find((s) => s.querySelector('h3')?.textContent === 'Mask');
      return {
        tool: heads('.panel--sculpt'),
        model: heads('.panel--model'),
        controls: sec ? [...sec.querySelectorAll('button, label.compact > span:first-child')].map((e) => e.textContent) : [],
      };
    });
    t.ok(!sections.tool.includes('Mask'), `the Tool panel has no Mask section (${sections.tool.join(', ')})`);
    t.ok(sections.model.includes('Mask'), `the Model panel has one (${sections.model.join(', ')})`);
    t.eq(sections.controls.join(', '), 'Darken, Blur, Sharpen, Invert, Clear, Extract thickness, Extract masked', 'with the darkening, the four operations and Extract');
    const press = (label) =>
      page.evaluate((l) => {
        const sec = [...document.querySelectorAll('.panel--model .section')].find((s) => s.querySelector('h3')?.textContent === 'Mask');
        [...sec.querySelectorAll('button')].find((b) => b.textContent === l).click();
      }, label);

    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Control+a');
    let m = await mask();
    t.near(m.masked, 1, 1e-6, 'Ctrl + A still masks the whole object');
    await press('Invert');
    m = await mask();
    t.near(m.masked, 0, 1e-6, "the Model panel's Invert unmasks it all");
    await page.keyboard.press('Control+i');
    t.near((await mask()).masked, 1, 1e-6, 'Ctrl + I inverts it back');
    await press('Clear');
    t.near((await mask()).masked, 0, 1e-6, 'and Clear clears it');

    // The Mask brush: Ctrl + a pen drag over the sphere paints a mask.
    await page.keyboard.press('3');
    const [cx, cy] = await screenOf(page, 'Sphere');
    await dev.penDrag(line([cx - 60, cy], [cx + 60, cy]), null, 2);
    await settle(page);
    m = await mask();
    t.ok(m.masked > 0.001 && m.masked < 0.9, `the Mask brush (Ctrl + pen drag) still paints a mask (${(m.masked * 100).toFixed(1)}% masked)`);
    const undoes = await page.evaluate(() => {
      const s = window.__sculpt.session;
      const before = s.getStateManager()._curUndoIndex;
      s.undo();
      return before - s.getStateManager()._curUndoIndex;
    });
    t.ok(undoes === 1 && (await mask()).masked < 1e-6, 'and one undo takes it off');

    // Half the sphere masked: Blur feathers the edge, Sharpen firms it.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const mesh = session.getMesh();
      const v = mesh.getVertices();
      const mat = mesh.getMaterials();
      for (let i = 0; i < mesh.getNbVertices(); i++) mat[i * 3 + 2] = v[i * 3] > 0 ? 0 : 1;
      const masking = session.getSculptManager()._tools.find((tool) => tool && typeof tool.extract === 'function');
      masking.updateAndRenderMask();
    });
    const half = await mask();
    await press('Blur');
    const blurred = await mask();
    await press('Sharpen');
    const sharpened = await mask();
    t.ok(half.partial === 0 && blurred.partial > 0, `Blur feathers a hard mask edge (${half.partial} part-way vertices, then ${blurred.partial})`);
    t.ok(sharpened.partial < blurred.partial, `and Sharpen firms it again (${sharpened.partial})`);

    // Extract, at the panel's thickness, by the button and by Ctrl + E.
    const extract = async (how, thickness) => {
      await page.evaluate((v) => {
        const row = [...document.querySelectorAll('.panel--model label.compact')].find((r) => r.firstElementChild?.textContent === 'Extract thickness');
        const input = row.querySelector('input');
        input.value = String(v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, thickness);
      const before = await count(page);
      if (how === 'button') await press('Extract masked');
      else {
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.keyboard.press('Control+e');
      }
      return page.evaluate(
        ([b]) => {
          const { session } = window.__sculpt;
          const masking = session.getSculptManager()._tools.find((tool) => tool && typeof tool.extract === 'function');
          const list = session.getMeshes();
          return { added: list.length - b, last: session.getMeshName(list[list.length - 1]), active: session.activeName(), thickness: masking._thickness };
        },
        [before],
      );
    };
    let e = await extract('button', 2);
    t.ok(e.added === 1 && /^Extracted/.test(e.last) && e.active === 'Sphere' && e.thickness === 2, `Extract masked in the Model panel makes an object of the masked half at its thickness (${e.last}, ${e.thickness}; ${e.active} stays active)`);
    e = await extract('key', 0.5);
    t.ok(e.added === 1 && e.thickness === 0.5, `Ctrl + E extracts at the Model panel's thickness (${e.thickness})`);
    const before = await count(page);
    await page.evaluate(() => window.__sculpt.session.undo());
    t.eq(await count(page), before - 1, 'and an undo takes the extraction back');
  },

  // Delete highest level (owner request): the Model panel's Topology drops
  // the top of the active object's stack. With the top selected the
  // selection moves to the new top; from lower down it stays where it is.
  // It is one undo step, which brings the level back with its detail, and
  // redo deletes it again; the level slider and the triangle count follow,
  // and with one level left the button is disabled.
  async deleteLevel(page, base, t) {
    page.on('dialog', (d) => void d.accept()); // a subdivision past the soft line asks first
    await openSculpt(page, base, '&q=low');
    await page.evaluate(() => window.__sculpt.modelPanel.setCollapsed(false));
    const topo = () =>
      page.evaluate(() => {
        const { session } = window.__sculpt;
        const panel = document.querySelector('.panel--model');
        const slider = [...panel.querySelectorAll('label.compact')].find((r) => r.firstElementChild?.textContent === 'Level');
        const btn = [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Delete highest level');
        const lv = session.getLevels();
        return {
          sel: lv.sel,
          levels: lv.levels,
          max: slider ? Number(slider.querySelector('input').max) : null,
          value: slider ? Number(slider.querySelector('input').value) : null,
          readout: slider?.querySelector('.sculpt-panel__val')?.textContent ?? null,
          tris: session.getMesh().getNbTriangles(),
          button: btn ? { disabled: btn.disabled } : null,
          history: session.getStateManager()._curUndoIndex,
        };
      });
    const show = (s) => `level ${s.sel + 1}/${s.levels}, slider ${s.value} of ${s.max} reading ${s.readout}, ${s.tris} tris`;
    const statsTris = (n) =>
      page
        .waitForFunction((k) => document.querySelector('.sculpt-stats__tris')?.textContent === `${k.toLocaleString('en-US')} tris`, n, { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
    const del = () =>
      page.evaluate(() => [...document.querySelectorAll('.panel--model button')].find((b) => b.textContent === 'Delete highest level').click());

    // Three levels at least, and detail on the top one that only it has.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      while (session.getLevels().levels < 3) {
        if (session.getLevels().sel !== session.getLevels().levels - 1) session.selectLevel(session.getLevels().levels - 1);
        session.subdivide();
      }
      session.selectLevel(session.getLevels().levels - 1);
      const m = session.getMesh();
      const v = m.getVertices();
      for (let i = 0; i < m.getNbVertices(); i++) v[i * 3 + 1] += 0.4 * Math.sin(i * 0.37);
      window.__topDetail = Float32Array.from(v.subarray(0, m.getNbVertices() * 3));
    });
    const sameDetail = () =>
      page.evaluate(() => {
        const m = window.__sculpt.session.getMesh();
        const v = m.getVertices();
        const want = window.__topDetail;
        if (m.getNbVertices() * 3 !== want.length) return Infinity;
        let worst = 0;
        for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(v[i] - want[i]));
        return worst;
      });

    let s = await topo();
    const start = s;
    t.ok(s.levels >= 3 && s.sel === s.levels - 1 && s.button && !s.button.disabled, `the button is there, enabled, with the top level selected (${show(s)})`);
    const lowerTris = await page.evaluate(() => {
      const mul = window.__sculpt.session.getMesh();
      return mul._meshes[mul._meshes.length - 2].getNbTriangles();
    });

    // From the top: the selection moves to the new top.
    await del();
    s = await topo();
    t.ok(s.levels === start.levels - 1 && s.sel === s.levels - 1, `with the top selected, the top level goes and the selection moves to the new top (${show(s)})`);
    t.ok(s.max === s.levels && s.value === s.levels && s.readout === `${s.levels}/${s.levels}`, 'the level slider follows');
    t.ok(s.tris === lowerTris && (await statsTris(s.tris)), `and the triangle count with it (${s.tris})`);
    t.eq(s.history - start.history, 2, 'two vendor states pushed (the selection, then the deletion)');

    await page.evaluate(() => document.activeElement?.blur?.());
    await page.keyboard.press('Control+z');
    s = await topo();
    let off = await sameDetail();
    t.ok(s.levels === start.levels && s.sel === start.sel && s.history === start.history, `one undo puts the level back, selected (${show(s)})`);
    t.ok(off < 1e-4, `with its detail (worst vertex off by ${off.toExponential(1)})`);
    t.ok(s.tris === start.tris && (await statsTris(s.tris)), 'and the triangle count back');
    await page.keyboard.press('Control+Shift+z');
    s = await topo();
    t.ok(s.levels === start.levels - 1 && s.sel === s.levels - 1, `redo deletes it again (${show(s)})`);
    await page.keyboard.press('Control+z');
    s = await topo();
    off = await sameDetail();
    t.ok(s.levels === start.levels && s.sel === start.sel && off < 1e-4, `and undo restores it again, detail and all (off by ${off.toExponential(1)})`);

    // From lower down: the selection stays where it is.
    await page.evaluate(() => window.__sculpt.session.selectLevel(0));
    const low = await topo();
    await del();
    s = await topo();
    t.ok(s.levels === start.levels - 1 && s.sel === 0 && s.tris === low.tris, `from level 1 the top goes and the selection stays on level 1 (${show(s)})`);
    t.ok(s.max === s.levels && s.readout === `1/${s.levels}`, 'the slider says so');
    await page.evaluate(() => window.__sculpt.session.undo());
    s = await topo();
    t.ok(s.levels === start.levels && s.sel === 0 && s.history === low.history, `one undo brings it back, the selection still on level 1 (${show(s)})`);
    await page.evaluate(() => window.__sculpt.session.redo());
    s = await topo();
    t.ok(s.levels === start.levels - 1 && s.sel === 0, `redo deletes it again from there (${show(s)})`);
    await page.evaluate(() => window.__sculpt.session.undo());
    // Stepping up is an edit of its own, so it comes after the redo.
    await page.evaluate(() => window.__sculpt.session.selectLevel(window.__sculpt.session.getLevels().levels - 1));
    off = await sameDetail();
    t.ok(off < 1e-4, `undone again and stepped up to, the top level has its detail (off by ${off.toExponential(1)})`);
    await page.evaluate(() => window.__sculpt.session.selectLevel(0));

    // Down to one level: nothing left to delete.
    for (let i = 0; i < 10 && (await topo()).levels > 1; i++) await del();
    s = await topo();
    const refused = await page.evaluate(() => window.__sculpt.session.deleteHighestLevel());
    t.ok(s.levels === 1 && s.button?.disabled && !refused, `with one level the button is disabled and the delete refuses (${show(s)})`);
  },

  // Ambient occlusion outside sculpt mode (a regression the last change
  // found): the Render panel used to apply its own starting model on every
  // build, and it started on the cavity, which only sculpt mode's composite
  // draws - so the viewer, the editors and Armature mode had no AO at all.
  // Now GTAO is on by default at its calibrated values, a saved GTAO or Off
  // comes back as saved, the panel offers GTAO and Off there (Cavity only
  // in sculpt mode), and the uploader's preview and its single-file export
  // keep it. An armature saved on the old forced cavity comes back on GTAO.
  async aoViewer(page, base, t) {
    const aoState = () =>
      page.evaluate(() => {
        const v = window.__bozzetto;
        const out = v.pipeline.outputNode;
        const sel = [...document.querySelectorAll('.panel label.label-row')].find((l) => l.firstElementChild?.textContent === 'Model' && l.closest('.section')?.querySelector('h3')?.textContent === 'Ambient occlusion')?.querySelector('select');
        return {
          ao: v.getAOState(),
          out: out === v.composites.viewer.ao ? 'gtao' : out === v.composites.viewer.plain ? 'plain' : 'other',
          options: sel ? [...sel.options].map((o) => o.value).join(',') : null,
          model: sel?.value ?? null,
        };
      });
    const pick = (value) =>
      page.evaluate((m) => {
        const sel = [...document.querySelectorAll('.panel label.label-row')].find((l) => l.firstElementChild?.textContent === 'Model' && l.closest('.section')?.querySelector('h3')?.textContent === 'Ambient occlusion').querySelector('select');
        sel.value = m;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    const viewer = async (ao) => {
      await page.unroute('**/timelapses/demo/manifest.json');
      if (ao) {
        await page.route('**/timelapses/demo/manifest.json', async (route) => {
          const res = await route.fetch();
          const manifest = await res.json();
          await route.fulfill({ response: res, json: { ...manifest, ao } });
        });
      }
      await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
      await page.waitForTimeout(250);
    };

    await viewer(null);
    let s = await aoState();
    t.ok(s.ao.enabled && s.out === 'gtao', `the viewer at ?tl=demo renders with GTAO (${s.out})`);
    t.ok(s.ao.intensity === AO_DEFAULT.intensity && s.ao.radius === AO_DEFAULT.radius, `at its calibrated defaults (strength ${s.ao.intensity}, radius ${s.ao.radius})`);
    t.ok(s.options === 'off,gtao' && s.model === 'gtao', `its Render panel offers GTAO and Off, not the cavity, and says GTAO (${s.options})`);
    await viewer({ enabled: false, intensity: 1, radius: 0.3 });
    s = await aoState();
    t.ok(!s.ao.enabled && s.out === 'plain' && s.model === 'off', `a project saved with AO off opens with it off (${s.out}, ${s.model})`);
    await viewer({ enabled: true, intensity: 1.5, radius: 0.45 });
    s = await aoState();
    t.ok(s.ao.enabled && s.out === 'gtao' && s.ao.intensity === 1.5 && s.ao.radius === 0.45, `one saved on GTAO opens on it, at its own values (${s.ao.intensity}, ${s.ao.radius})`);
    await page.unroute('**/timelapses/demo/manifest.json');

    // Armature mode: GTAO by default, a pick saved and restored.
    const armature = async () => {
      await openArmature(page, base);
      await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
    };
    await armature();
    s = await aoState();
    t.ok(s.ao.enabled && s.out === 'gtao' && s.options === 'off,gtao' && s.model === 'gtao', `Armature mode renders with GTAO by default, its panel offering GTAO and Off (${s.out}, ${s.options})`);
    await pick('off');
    await page.evaluate(() => window.__armature.save());
    await armature();
    s = await aoState();
    t.ok(!s.ao.enabled && s.out === 'plain' && s.model === 'off', `Off picked there comes back off (${s.model})`);
    await pick('gtao');
    await page.evaluate(() => window.__armature.save());
    await armature();
    s = await aoState();
    t.ok(s.ao.enabled && s.out === 'gtao' && s.model === 'gtao', `and GTAO comes back on (${s.model})`);
    await page.evaluate(async () => {
      const v = window.__bozzetto;
      v.setAO({ enabled: false });
      v.setSculptAO({ strength: 0.9 });
      await window.__armature.save();
    });
    await armature();
    s = await aoState();
    t.ok(s.ao.enabled && s.out === 'gtao' && s.model === 'gtao', `an armature saved on the cavity the panel used to force comes back on GTAO (${s.model})`);

    // The uploader's preview, and its single-file export.
    await page.goto(`${base}/create/`, { waitUntil: 'domcontentloaded' });
    await page.setInputFiles('#files', resolve('dist/timelapses/demo/frames/sd/0000.glb'));
    await page.waitForFunction(() => !document.querySelector('#export-html').disabled, null, { timeout: 90_000 });
    const preview = await page.evaluate(() => {
      const sel = [...document.querySelectorAll('.panel--editor label.label-row')].find((l) => l.firstElementChild?.textContent === 'Model' && l.closest('.section')?.querySelector('h3')?.textContent === 'Ambient occlusion')?.querySelector('select');
      return { options: sel ? [...sel.options].map((o) => o.value).join(',') : null, model: sel?.value ?? null };
    });
    t.ok(preview.options === 'off,gtao' && preview.model === 'gtao', `the uploader's preview is on GTAO, offering GTAO and Off (${preview.options}: ${preview.model})`);
    // The embedded viewer's own bundle comes from the full build; the test
    // build does not make it, and only the manifest matters here.
    await page.route('**/embed/viewer.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* viewer */' }));
    await page.route('**/embed/embed.css', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '/* css */' }));
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.click('#export-html')]);
    const html = readFileSync(await download.path(), 'utf8');
    const registry = JSON.parse(html.match(/window\.__BOZZETTO__=(.*?);<\/script>/s)?.[1] ?? 'null');
    const exported = registry?.manifest?.ao;
    t.ok(exported?.enabled === true && exported.intensity === AO_DEFAULT.intensity && exported.radius === AO_DEFAULT.radius, `and its single-file export carries GTAO on (${JSON.stringify(exported)})`);
  },

  // The environment's intensity on a usable scale (owner call: at the
  // renderer's 1 the default map overpowers the key light, and the owner
  // works at about 0.1). 1 on the slider is 0.2 to the renderer, the
  // slider's 0..2 its 0..0.4, and an environment starts at 1. The plate
  // shown as the background has a brightness of its own beside Bg blur,
  // so the light no longer dims or brightens it. A record from before the
  // rescale has no version mark and is read on the old scale - through a
  // look, the way every saved look, autosave, .bozz file and armature
  // comes back, and through a project's manifest, the way a published
  // project and a single-file export do - and renders the light and the
  // plate it rendered before; a new record round-trips.
  async envScale(page, base, t) {
    await openSculpt(page, base, '&q=low');
    const env = () =>
      page.evaluate(() => {
        const v = window.__bozzetto;
        return { state: v.environment.getState(), light: v.scene.environmentIntensity, plate: v.scene.backgroundIntensity };
      });
    const showEnv = (e) => `slider ${e.state.intensity}, plate ${e.state.bgBrightness}; renderer ${e.light}, plate ${e.plate}`;
    let e = await env();
    t.ok(
      e.state.v === 2 && e.state.intensity === HDRI_DEFAULT && e.state.bgBrightness === 1 && e.light === HDRI_DEFAULT * ENV_SCALE && e.plate === 1,
      `a new environment starts at 1 on the slider, ${ENV_SCALE} to the renderer, with the plate at 1, and its record says which scale it is on (${showEnv(e)})`,
    );

    // The panel: the slider's own travel, and the plate's row beside Bg blur.
    t.ok(await openPanel(page, 'Render'), 'the Render panel opens');
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === 'Render');
      const sel = [...p.querySelectorAll('label.label-row')].find((l) => l.firstElementChild?.textContent === 'HDRI').querySelector('select');
      sel.value = 'studio-neutral';
      sel.dispatchEvent(new Event('change'));
    });
    await page.waitForFunction(() => !!window.__bozzetto.scene.environment, null, { timeout: 30_000 });
    const intensity = await sliderRow(page, 'Render', 'Intensity', 1);
    const plate = await sliderRow(page, 'Render', 'Bg brightness');
    const order = await page.evaluate(() => {
      const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === 'Render');
      const row = [...p.querySelectorAll('label.compact')].find((r) => r.firstElementChild?.textContent === 'Bg brightness');
      return row?.previousElementSibling?.firstElementChild?.textContent ?? null;
    });
    t.ok(intensity.min === 0 && intensity.max === 2 && intensity.thumb === HDRI_DEFAULT, `the HDRI's Intensity still runs 0..2, at ${intensity.thumb}`);
    t.ok(plate?.shown && plate.min === 0 && plate.max === 2 && plate.thumb === 1 && order === 'Bg blur', `a Bg brightness row follows Bg blur, 0..2 from 1 (after ${order})`);
    const slide = (caption, nth, value) =>
      page.evaluate(
        ([c, k, v]) => {
          const p = [...document.querySelectorAll('.panel')].find((el) => el.querySelector('.panel__title')?.textContent === 'Render');
          const input = [...p.querySelectorAll('label.compact')].filter((r) => r.firstElementChild?.textContent === c)[k].querySelector('input');
          input.value = String(v);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        },
        [caption, nth, value],
      );
    await slide('Bg brightness', 0, 1.5);
    e = await env();
    t.ok(e.plate === 1.5 && e.light === HDRI_DEFAULT * ENV_SCALE, `the plate brightens on its own slider, the light as it was (${showEnv(e)})`);
    await slide('Intensity', 1, 0.5);
    e = await env();
    t.ok(e.light === 0.5 * ENV_SCALE && e.plate === 1.5, `and the light dims on Intensity, the plate as it was (${showEnv(e)})`);

    // A new record round-trips, as a look and through a scene file.
    const fresh = await page.evaluate(async () => {
      const v = window.__bozzetto;
      window.__newLook = v.getLook();
      window.__envFile = await window.__sculpt.file.pack();
      v.environment.setIntensity(1.8);
      v.environment.setBackgroundBrightness(0.3);
      await v.applyLook(window.__newLook);
      return window.__newLook.environment;
    });
    e = await env();
    t.ok(fresh.v === 2 && fresh.intensity === 0.5 && fresh.bgBrightness === 1.5, `the record written carries the scale's mark and both values (${JSON.stringify(fresh)})`);
    t.ok(e.state.intensity === 0.5 && e.state.bgBrightness === 1.5 && e.light === 0.5 * ENV_SCALE && e.plate === 1.5, `and comes back as it was written (${showEnv(e)})`);
    await page.evaluate(async () => {
      window.__bozzetto.environment.setIntensity(1.8);
      window.__bozzetto.environment.setBackgroundBrightness(0.3);
      await window.__sculpt.file.open(window.__envFile);
    });
    e = await env();
    t.ok(e.state.intensity === 0.5 && e.state.bgBrightness === 1.5 && e.light === 0.5 * ENV_SCALE && e.plate === 1.5, `so does a scene file saved with it (${showEnv(e)})`);

    // Old records, through a look: the default c7cf570 saved (0.25 on the
    // old scale), and another strength. Before, the renderer and the plate
    // both took the stored number as it was.
    const asOld = (intensity) =>
      page.evaluate(async (i) => {
        const v = window.__bozzetto;
        const old = { ...window.__newLook.environment, intensity: i };
        delete old.v;
        delete old.bgBrightness;
        await v.applyLook({ environment: old });
        window.dispatchEvent(new CustomEvent('bozzetto:look-restored'));
      }, intensity);
    // What each reads on the slider now: the old number over the scale,
    // tidied (0.6 / 0.2 is 2.9999999999999996 in floating point).
    for (const [old, slider] of [[0.25, 1.25], [0.6, 3], [1.7, 8.5]]) {
      await asOld(old);
      e = await env();
      t.ok(
        e.light === old && e.plate === old && e.state.v === 2 && e.state.intensity === slider && e.state.bgBrightness === old,
        `a look saved at ${old} before the rescale renders its light and its plate at ${old}, as before, and reads ${slider} on the slider now (${showEnv(e)})`,
      );
    }
    const shown = {
      intensity: await sliderRow(page, 'Render', 'Intensity', 1),
      plate: await sliderRow(page, 'Render', 'Bg brightness'),
    };
    t.ok(Math.abs(shown.intensity.thumb - 2) < 1e-9 && shown.intensity.readout === '8.50' && shown.plate.thumb === 1.7, `the panel shows the converted values (Intensity pinned at 2 reading ${shown.intensity.readout}, plate ${shown.plate.thumb})`);

    // Old and new records through a project's manifest: the same light and
    // the same plate for the same scene.
    const manifest = async (environment) => {
      await page.unroute('**/timelapses/demo/manifest.json');
      await page.route('**/timelapses/demo/manifest.json', async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, json: { ...(await res.json()), environment } });
      });
      await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.__bozzetto?.scene.environment && !document.getElementById('overlay'), null, { timeout: 90_000 });
      return page.evaluate(() => {
        const v = window.__bozzetto;
        return {
          state: v.environment.getState(),
          light: v.scene.environmentIntensity,
          plate: v.scene.backgroundIntensity,
          shown: !!v.scene.background?.isTexture,
        };
      });
    };
    const record = { id: 'studio-neutral', background: 'hdri', bgColor: '#1c1814', rotation: 30, blur: 0.2 };
    const before = await manifest({ ...record, intensity: 0.5 });
    t.ok(
      before.light === 0.5 && before.plate === 0.5 && before.shown && before.state.intensity === 2.5 && before.state.bgBrightness === 0.5,
      `a project published before the rescale opens at its old light and plate, 0.5 and 0.5 (${showEnv(before)})`,
    );
    const after = await manifest({ ...record, v: 2, intensity: 2.5, bgBrightness: 0.5 });
    t.ok(after.light === before.light && after.plate === before.plate && after.shown, `and one written on the new scale with the same values renders the same (${showEnv(after)})`);
    await page.unroute('**/timelapses/demo/manifest.json');
  },

  // Hold L in Armature mode (owner request, as in sculpt mode): the drag
  // moves the key light - across swings it round, up and down raises and
  // lowers it, half a degree a pixel - and does nothing else, wherever it
  // starts: off the figure it does not orbit, on a part it picks nothing,
  // on the selection's gizmo it turns no joint, on a ball it grabs none.
  // Let go of L and each of those presses does what it always did, the
  // light staying put. The key is in the hotkey guide and in Preferences,
  // where it can be rebound.
  async armatureLight(page, base, t) {
    await openArmature(page, base);
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
    await page.evaluate(() => window.__armature.select('upperarm.L'));
    const state = () =>
      page.evaluate(() => {
        const v = window.__bozzetto;
        const a = window.__armature;
        const key = v.lighting.state().find((l) => l.id === 'key');
        const cam = v.getCameraState();
        return {
          az: key.azimuth,
          el: key.elevation,
          camera: [...cam.position, ...cam.target].map((x) => x.toFixed(3)).join(','),
          pose: JSON.stringify(a.state()),
          selected: a.selected(),
        };
      });
    // The camera at rest: the framing at boot may still be settling.
    let camera = '';
    for (let i = 0; i < 20; i++) {
      const now = (await state()).camera;
      if (now === camera) break;
      camera = now;
      await page.waitForTimeout(300);
    }
    // Where each drag starts, in whole pixels so the light's steps are
    // exact: the selected upper arm's gizmo, the root's ball, the other
    // thigh (a part well clear of both) and bare canvas.
    const at = await page.evaluate(() => {
      const a = window.__armature;
      const arm = a.armature;
      const round = (p) => (p ? [Math.round(p[0]), Math.round(p[1])] : null);
      const canvas = window.__bozzetto.captureCanvas;
      const r = canvas.getBoundingClientRect();
      const thigh = arm.jointWorld('thigh.R').add(arm.jointWorld('shin.R')).multiplyScalar(0.5);
      const bare = [Math.round(r.left + r.width * 0.2), Math.round(r.top + r.height * 0.5)];
      return {
        gizmo: round(a.onScreen(...arm.jointWorld('upperarm.L').toArray())),
        ball: round(a.ballOnScreen('root')),
        part: round(a.onScreen(thigh.x, thigh.y, thigh.z)),
        bare,
        bareIsCanvas: document.elementFromPoint(...bare) === canvas,
      };
    });
    t.ok(!!at.gizmo && !!at.ball && !!at.part && at.bareIsCanvas, `the drags start on the selection's gizmo ${at.gizmo}, the root's ball ${at.ball}, the right thigh ${at.part} and bare canvas ${at.bare}`);
    const drag = async (from, [dx, dy], withL) => {
      await page.mouse.move(...from);
      if (withL) await page.keyboard.down('l');
      await page.mouse.down();
      await page.mouse.move(from[0] + dx, from[1] + dy, { steps: 4 });
      await page.mouse.up();
      if (withL) await page.keyboard.up('l');
    };
    await page.evaluate(() => document.activeElement?.blur?.());
    const start = await state();
    const steps = [
      [at.bare, [80, -20]],
      [at.gizmo, [40, 30]],
      [at.ball, [50, 20]],
      [at.part, [-30, -10]],
    ];
    for (const [from, by] of steps) await drag(from, by, true);
    const held = await state();
    const across = steps.reduce((n, [, [dx]]) => n + dx, 0);
    const up = -steps.reduce((n, [, [, dy]]) => n + dy, 0);
    t.ok(
      held.az === start.az + across * 0.5 && held.el === start.el + up * 0.5,
      `with L held, the drags turn the key light by half a degree a pixel (azimuth ${start.az} to ${held.az}, elevation ${start.el} to ${held.el})`,
    );
    t.eq(held.camera, start.camera, 'and none of them orbits');
    t.ok(held.pose === start.pose, 'the gizmo turns no joint and the ball moves nothing: the pose is as it was');
    t.eq(held.selected, 'upperarm.L', 'and the part pressed is not picked');

    // L let go: the same presses do what they always did, and the light
    // stays where the drags left it.
    await drag(at.gizmo, steps[1][1], false);
    let s = await state();
    t.ok(s.pose !== held.pose && s.az === held.az && s.el === held.el, 'without L, the same drag on the gizmo turns the joint');
    await page.mouse.click(...at.part);
    s = await state();
    t.ok(s.selected === 'thigh.R' && s.az === held.az, `a click on the thigh picks it (${s.selected})`);
    await page.evaluate(() => window.__armature.select(null));
    const turned = s.pose;
    await drag(at.ball, steps[2][1], false);
    s = await state();
    t.ok(s.pose !== turned && s.az === held.az && s.el === held.el, "the root's ball moves the figure");
    await drag(at.bare, steps[0][1], false);
    await page.waitForTimeout(300);
    s = await state();
    t.ok(s.camera !== held.camera && s.az === held.az && s.el === held.el, 'and the drag off the figure orbits');

    // The key, where keys are listed.
    const listed = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.help-guide .help-row')].find((r) => r.textContent.includes('Move the key light'));
      return row ? [...row.querySelectorAll('kbd')].map((k) => k.textContent).join('+') : null;
    });
    t.eq(listed, 'L', 'the hotkey guide lists L for the key light in Armature mode');
    await page.keyboard.press('Control+Comma');
    const pref = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.prefs__row')].find((r) => r.querySelector('.prefs__label')?.textContent.includes('Move the key light'));
      return row ? [...row.querySelectorAll('.prefs__key kbd')].map((k) => k.textContent).join('+') : null;
    });
    await page.keyboard.press('Escape');
    t.eq(pref, 'L', 'and Preferences has it, on L, to rebind');

    // Sculpt mode's own, through the same code: the same drag over the
    // sphere turns the light the same, and sculpts nothing.
    await openForInput(page, base);
    const [cx, cy] = await screenOf(page, 'Sphere');
    const from = [Math.round(cx), Math.round(cy)];
    const keyOf = () => page.evaluate(() => window.__bozzetto.lighting.state().find((l) => l.id === 'key'));
    const before = await keyOf();
    const sum = await meshSum(page);
    const strokes = await strokeCount(page);
    await page.evaluate(() => document.activeElement?.blur?.());
    await drag(from, [60, -20], true);
    const after = await keyOf();
    t.ok(
      after.azimuth === before.azimuth + 30 && after.elevation === before.elevation + 10 && (await meshSum(page)) === sum && (await strokeCount(page)) === strokes,
      `in sculpt mode the same drag turns it the same, sculpting nothing (azimuth ${before.azimuth} to ${after.azimuth}, elevation ${before.elevation} to ${after.elevation})`,
    );
  },
};
