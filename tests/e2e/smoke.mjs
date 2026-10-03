// The smoke suites: boot, the Create menu's primitives and base meshes,
// the scene-file round trip, and Armature mode from the gallery's Create
// tile on. Each gets (page, base, t) - a fresh page, the server's origin,
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
};
