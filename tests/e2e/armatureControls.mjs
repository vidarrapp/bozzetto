// Armature mode's controls: drawn as outlines, the way animation programs
// draw them (handleViews.ts), with the head as a look-at controller.
//
//   armatureControls   what the handles are and show - shape, colour at rest,
//                      hover, selected and dragged, the pinned dot, the pole
//                      targets with their dashed lines and what a drag of one
//                      does (against the pose the old aim drag gave), the
//                      44 px pick shapes - and the screens they are read on
//   armatureLook       the head's look-at: the target in front of the face,
//                      what a drag turns (head, neck, a little of the back,
//                      never the hips), the limits, undo, symmetry, pins and
//                      how an old file with a head pin opens
//
// What a handle is drawn as is read back from the scene (the console's
// handleLook), not from the page's pixels.

import { openArmature } from './lib.mjs';

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const deg = (rad) => (rad * 180) / Math.PI;

/**
 * The knee and elbow positions the aim drag gave before the pole targets
 * (recorded on the build before this change): a fresh figure, the knee
 * (or elbow) turned toward the point `off` from where it started, for each
 * of four offsets. The positions are in scene units (centimetres).
 */
const BEFORE = {
  'foot.L#0': { off: [40, 0, 0], hinge: [13.76344, 47.74265, -0.01683], eff: [17.20106, 9.77993, 5.21006] },
  'foot.L#1': { off: [0, 0, 40], hinge: [13.10695, 47.69672, -2.31613], eff: [17.20018, 9.78131, 5.2105] },
  'foot.L#2': { off: [-30, 10, -30], hinge: [13.10695, 47.69672, -2.31613], eff: [17.20018, 9.78131, 5.2105] },
  'foot.L#3': { off: [0, -40, 20], hinge: [13.10695, 47.69672, -2.31613], eff: [17.20018, 9.78131, 5.2105] },
  'hand.R#0': { off: [40, 0, 0], hinge: [-29.29191, 109.73275, 1.69788], eff: [-52.73392, 81.69716, 9.87898] },
  'hand.R#1': { off: [0, 0, 40], hinge: [-29.29191, 109.73275, 1.69788], eff: [-52.73392, 81.69716, 9.87898] },
  'hand.R#2': { off: [-30, 10, -30], hinge: [-35.03487, 113.1704, -0.05234], eff: [-52.73392, 81.69716, 9.87898] },
  'hand.R#3': { off: [0, -40, 20], hinge: [-29.29171, 109.73274, 1.69843], eff: [-52.73392, 81.69716, 9.87898] },
};

const POLES = ['hand.L', 'hand.R', 'foot.L', 'foot.R'];
const RINGS = ['ik:hand.L', 'ik:hand.R', 'ik:foot.L', 'ik:foot.R'];

async function armatureControls(page, base, t) {
  await openArmature(page, base);
  await page.waitForTimeout(500);
  const look = (name) => page.evaluate((n) => window.__armature.handleLook(n), name);
  const names = await page.evaluate(() => window.__armature.handleNames());
  const palette = await page.evaluate(() => window.__armature.handlePalette());
  const drawn = names.filter((n) => !n.startsWith('dash:'));
  t.ok(
    ['root', ...RINGS, ...POLES.map((c) => `aim:${c}`), 'look:head'].every((n) => names.includes(n)) && !names.includes('ik:head'),
    `the handles are a ring each at the hands and feet, an arrowhead at each knee and elbow, one for the head's look and the root's box, and the head has no reach ring (${names.join(', ')})`,
  );
  t.ok(palette.rest !== palette.hot && palette.hover !== palette.hot, `orange (#${palette.hot}) is not the rest (#${palette.rest}) or the hover (#${palette.hover}) colour`);

  t.ok(palette.shade > 0.25 && palette.shade < 0.45 && palette.edge === '000000', `a handle's edge is a soft shade of black at ${palette.shade} (--bz-view-shade-line), not a dark border`);
  // At rest: every handle neutral, in the shape it is for.
  const shapeOf = (n) => (n === 'root' ? 'box' : n.startsWith('ik:') ? 'ring' : n.startsWith('dash:') ? 'dash' : 'arrow');
  const rest = await page.evaluate(() => Object.fromEntries(window.__armature.handleNames().map((n) => [n, window.__armature.handleLook(n)])));
  t.ok(
    Object.entries(rest).every(([n, l]) => l.shape === shapeOf(n) && l.colour === palette.rest && l.state === 'rest'),
    `all neutral (#${palette.rest}) at rest, each in its shape: ${JSON.stringify(Object.fromEntries(Object.entries(rest).map(([n, l]) => [n, `${l.shape}`])))}`,
  );
  const plants = await page.evaluate(() => window.__armature.plantLooks());
  t.ok(
    plants.length === 2 && plants.every((p) => p.shape === 'floor' && p.colour === palette.rest && p.visible),
    `the planted feet's rings on the floor stay rings, neutral (${plants.map((p) => `${p.foot} ${p.shape} #${p.colour}`).join(', ')})`,
  );
  t.ok(
    Object.values(rest).every((l) => l.colour.toLowerCase() !== palette.hot.toLowerCase()),
    'and none is orange',
  );

  // Pinned: the same ring with a dot. A fresh figure has its feet pinned.
  t.ok(
    rest['ik:foot.L'].dot && rest['ik:foot.R'].dot && !rest['ik:hand.L'].dot && !rest['ik:hand.R'].dot,
    `a pinned handle shows its dot: the feet (pinned at the start) have one, the hands do not`,
  );
  await page.evaluate(() => {
    const a = window.__armature;
    a.armature.setPinned('hand.L', true);
    a.armature.setPinned('foot.R', false);
    a.select(null);
    a.selectHandle(null);
    a.hover(null);
  });
  const pins = await page.evaluate(() => Object.fromEntries(['ik:hand.L', 'ik:foot.R', 'ik:foot.L'].map((n) => [n, window.__armature.handleLook(n).dot])));
  t.ok(pins['ik:hand.L'] === true && pins['ik:foot.R'] === false && pins['ik:foot.L'] === true, `pinning a hand gives it the dot and letting a foot go takes its dot away (${JSON.stringify(pins)})`);
  await page.evaluate(() => {
    window.__armature.armature.setPinned('hand.L', false);
    window.__armature.armature.setPinned('foot.R', true);
    window.__armature.selectHandle(null);
  });

  // Hover brightens, never orange; selected is orange and thicker; neutral again after.
  await page.evaluate(() => window.__armature.hover('ik:hand.L'));
  const hover = await look('ik:hand.L');
  t.ok(hover.state === 'hover' && hover.colour === palette.hover && hover.colour !== palette.hot, `under the pointer a handle goes white (#${hover.colour}), not orange`);
  await page.evaluate(() => window.__armature.hover(null));
  await page.evaluate(() => window.__armature.selectHandle('hand.R'));
  const sel = await page.evaluate(() => Object.fromEntries(window.__armature.handleNames().map((n) => [n, window.__armature.handleLook(n)])));
  const hot = Object.entries(sel).filter(([, l]) => l.state === 'hot').map(([n]) => n);
  t.ok(hot.join(',') === 'ik:hand.R' && sel['ik:hand.R'].colour === palette.hot, `selecting the right hand's ring makes it, and only it, orange (${hot.join(',')})`);
  t.ok(sel['ik:hand.R'].thick > rest['ik:hand.R'].thick, `and slightly thicker (${rest['ik:hand.R'].thick} to ${sel['ik:hand.R'].thick} px)`);
  await page.evaluate(() => window.__armature.selectHandle(null));
  const after = await page.evaluate(() => Object.values(Object.fromEntries(window.__armature.handleNames().map((n) => [n, window.__armature.handleLook(n)]))));
  t.ok(after.every((l) => l.colour === palette.rest && l.state === 'rest'), 'after deselecting every handle is neutral again');
  await page.evaluate(() => window.__armature.selectHandle('head'));
  const lookSel = await page.evaluate(() => ({ arrow: window.__armature.handleLook('look:head'), dash: window.__armature.handleLook('dash:head') }));
  t.ok(lookSel.arrow.colour === palette.hot && lookSel.dash.colour === palette.hot, `the look-at target is orange when selected too, with its line (#${lookSel.arrow.colour})`);
  await page.evaluate(() => window.__armature.selectHandle(null));

  // A real drag: orange while in hand, neutral when let go.
  const drag = await page.evaluate(() => ({ at: window.__armature.ballOnScreen('ik:hand.R'), hand: window.__armature.handlePosition('hand.R') }));
  await page.mouse.move(drag.at[0], drag.at[1]);
  await page.mouse.down();
  await page.mouse.move(drag.at[0] + 20, drag.at[1] - 15, { steps: 5 });
  const during = await look('ik:hand.R');
  await page.mouse.move(drag.at[0] + 40, drag.at[1] - 30, { steps: 5 });
  await page.mouse.up();
  const lifted = await look('ik:hand.R');
  const moved = await page.evaluate((h) => Math.hypot(...window.__armature.handlePosition('hand.R').map((v, i) => v - h[i])), drag.hand);
  t.ok(during.state === 'hot' && during.colour === palette.hot, `a ring being dragged is orange (${during.state})`);
  t.ok(lifted.state === 'rest' && lifted.colour === palette.rest && moved > 1, `and neutral once let go, the hand having moved ${moved.toFixed(1)} cm`);
  await page.evaluate(() => window.__armature.undo());

  // Pole handles: each sits out from its joint along the way the joint points,
  // half a limb segment away, joined to it by a dashed line, pointing at it.
  const poles = await page.evaluate((chains) => {
    const a = window.__armature;
    const arm = a.armature;
    arm.resetPose();
    a.commit();
    return chains.map((c) => {
      const arrow = a.handleLook(`aim:${c}`);
      const dash = a.handleLook(`dash:${c}`);
      const joint = a.hingePosition(c);
      const chain = arm.chain(c);
      const hingeBone = chain.links.find((n) => arm.def(n).kind === 'hinge');
      const base = arm.jointWorld(chain.links[chain.links.indexOf(hingeBone) + 1]).toArray();
      return { c, arrow, dash, joint, base };
    });
  }, POLES);
  for (const p of poles) {
    const off = p.arrow.position.map((v, i) => v - p.joint[i]);
    const len = Math.hypot(...off);
    const segment = dist(p.joint, p.base);
    const knee = p.c.startsWith('foot');
    t.ok(
      Math.abs(len - segment * 0.5) < segment * 0.05,
      `${p.c}: the pole target sits ${len.toFixed(1)} cm from its joint, half the ${segment.toFixed(1)} cm segment above it`,
    );
    t.ok(knee ? off[2] > 0 : off[2] < 0, `${p.c}: out ${knee ? 'in front of the knee' : 'behind the elbow'} (z offset ${off[2].toFixed(1)})`);
    t.ok(
      p.arrow.shape === 'arrow' && dist(p.arrow.toward, p.joint) < 1e-6 && dist(p.dash.from, p.joint) < 1e-6 && dist(p.dash.toward, p.arrow.position) < 1e-6 && p.dash.shape === 'dash',
      `${p.c}: an arrowhead out from the joint it aims, pointing away from it, on a dashed line from the joint`,
    );
  }

  // A pole drag turns the joint as the old aim drag did, for the same points.
  const same = await page.evaluate((before) => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const out = {};
    for (const id of ['foot.L', 'hand.R']) {
      arm.resetPose();
      a.commit();
      const hinge = arm.hingeWorld(id, new V());
      [0, 1, 2, 3].forEach((i) => {
        const key = `${id}#${i}`;
        const off = before[key].off;
        a.pole(id, hinge.x + off[0], hinge.y + off[1], hinge.z + off[2]);
        const now = arm.hingeWorld(id, new V()).toArray();
        const eff = arm.effectorWorld(arm.chain(id).effector, new V()).toArray();
        out[key] = { hinge: now, eff };
      });
    }
    arm.resetPose();
    a.commit();
    return out;
  }, BEFORE);
  const worst = Math.max(...Object.entries(BEFORE).map(([k, v]) => Math.max(dist(same[k].hinge, v.hinge), dist(same[k].eff, v.eff))));
  t.ok(worst < 2e-4, `a pole drag to the same points leaves every knee, elbow and hand where the aim drag put them (worst ${worst.toExponential(1)} cm)`);

  // And by the pointer: press on the left knee's target, drag it round the limb.
  const knee0 = await page.evaluate(() => ({ at: window.__armature.ballOnScreen('aim:foot.L'), joint: window.__armature.hingePosition('foot.L'), foot: window.__armature.handlePosition('foot.L'), aim: window.__armature.armature.getAim('foot.L') }));
  await page.mouse.move(knee0.at[0], knee0.at[1]);
  await page.mouse.down();
  await page.mouse.move(knee0.at[0] - 25, knee0.at[1] - 30, { steps: 6 });
  const mid = await look('aim:foot.L');
  await page.mouse.move(knee0.at[0] - 50, knee0.at[1] - 60, { steps: 6 });
  await page.mouse.up();
  const knee1 = await page.evaluate(() => ({ joint: window.__armature.hingePosition('foot.L'), foot: window.__armature.handlePosition('foot.L'), aim: window.__armature.armature.getAim('foot.L'), picked: window.__armature.picked(), target: window.__armature.handleLook('aim:foot.L').position }));
  t.ok(knee1.picked === 'aim:foot.L' && mid.state === 'hot', `dragging the pole target takes it and lights it (${knee1.picked}, ${mid.state})`);
  t.ok(Math.abs(knee1.aim - knee0.aim) > 5 && dist(knee1.joint, knee0.joint) > 1, `the knee turned (aim ${knee0.aim.toFixed(0)} to ${knee1.aim.toFixed(0)} degrees)`);
  t.ok(dist(knee1.foot, knee0.foot) < 1, `and the foot stayed where it was, within a centimetre (${dist(knee1.foot, knee0.foot).toFixed(3)} cm)`);
  await page.evaluate(() => window.__armature.undo());

  // Pick shapes: at least 44 px across for a finger, round the centre, and a press takes the nearest.
  const picks = await page.evaluate(() => window.__armature.handleNames().filter((n) => !n.startsWith('dash:')).map((n) => [n, window.__armature.handleLook(n).pick]));
  t.ok(picks.every(([, px]) => px >= 44), `every handle's pick shape is at least 44 px across (${picks.map(([n, px]) => `${n} ${px}`).join(', ')})`);
  const presses = await page.evaluate(() => {
    const a = window.__armature;
    a.select(null);
    return ['ik:hand.R', 'ik:foot.R', 'aim:hand.L', 'look:head'].map((n) => ({ n, at: a.ballOnScreen(n) }));
  });
  for (const { n, at } of presses) {
    // 20 px off the centre, away from the others, is still inside 22 px.
    await page.mouse.move(at[0], at[1] + 20);
    await page.mouse.down();
    await page.mouse.up();
    const picked = await page.evaluate(() => window.__armature.picked());
    await page.evaluate(() => window.__armature.undo());
    t.eq(picked, n, `a press 20 px from the centre of ${n} takes it`);
  }
  await page.evaluate(() => window.__armature.selectHandle(null));

  // The screen: every handle is on the page at the iPad's 1180 wide, and the reach rings are about 15 px in radius.
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.waitForFunction(() => Math.abs(window.__bozzetto.renderer.domElement.getBoundingClientRect().width - 1180) < 2, null, { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(800);
  const seen = await page.evaluate(() => {
    const a = window.__armature;
    return a
      .handleNames()
      .filter((n) => !n.startsWith('dash:'))
      .map((n) => [n, a.ballOnScreen(n), a.handleLook(n).visible])
      .map(([n, at, vis]) => [n, !!at && vis && at[0] > 0 && at[0] < 1180 && at[1] > 0 && at[1] < 820, at?.[2]]);
  });
  t.ok(seen.every(([, ok]) => ok), `at 1180 wide every handle is on the page (${seen.filter(([, ok]) => !ok).map(([n]) => n).join(', ') || 'all'})`);
  const ringR = seen.find(([n]) => n === 'ik:hand.L')[2];
  t.ok(ringR >= 21 && ringR <= 23, `a reach ring is 22 px in radius (${ringR})`);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(500);

  // The root's box: twelve edges round the pelvis part, in its own frame, picked on any edge.
  const box = await page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const part = arm.partBones.get('pelvis');
    const g = arm.partGeometry.get('pelvis');
    g.boundingBox ?? g.computeBoundingBox();
    const b = a.rootBox();
    const local = part.worldToLocal(new V(...b.centre));
    const bb = g.boundingBox;
    const inside = ['x', 'y', 'z'].every((k) => local[k] >= bb.min[k] - 1e-3 && local[k] <= bb.max[k] + 1e-3);
    const l = arm.jointWorld('thigh.L');
    const r = arm.jointWorld('thigh.R');
    return {
      look: a.handleLook('root'),
      inside,
      centre: b.centre,
      hipsMidX: (l.x + r.x) / 2,
      spineY: arm.jointWorld('spine').y,
      hipY: l.y,
      chestY: arm.jointWorld('chest').y,
      gizmo: null,
    };
  });
  t.ok(box.look.shape === 'box' && box.look.edges === 12, `the root's handle is a box of ${box.look.edges} edges`);
  t.ok(box.inside, "its middle is inside the pelvis part's bounds");
  t.ok(box.centre[1] < box.spineY && Math.abs(box.centre[0] - box.hipsMidX) < 1, `and sits on the hips, below the spine's joint (y ${box.centre[1].toFixed(1)} against ${box.spineY.toFixed(1)}), between the hip joints (x ${box.centre[0].toFixed(1)})`);
  // It turns with the hips.
  const turned = await page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const Q = arm.root.quaternion.constructor;
    const x0 = a.rootBox().x;
    arm.root.quaternion.premultiply(new Q().setFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 4));
    a.moveRoot(0, 0, 0);
    const x1 = a.rootBox().x;
    a.undo();
    return (Math.acos(Math.min(1, x0[0] * x1[0] + x0[1] * x1[1] + x0[2] * x1[2])) * 180) / Math.PI;
  });
  t.ok(Math.abs(turned - 45) < 2, `the box turns with the hips (${turned.toFixed(1)} degrees for a 45 degree turn)`);
  // Selecting the pelvis: orange, the move gizmo in the box's middle.
  await page.evaluate(() => window.__armature.select('pelvis'));
  const picked = await page.evaluate(() => ({ look: window.__armature.handleLook('root'), gizmo: window.__armature.gizmo(), centre: window.__armature.rootBox().centre }));
  t.ok(picked.look.state === 'hot' && picked.look.colour === palette.hot, 'the box is orange while the pelvis is selected');
  t.ok(picked.gizmo.moveAt && dist(picked.gizmo.moveAt, picked.centre) < 0.01, "and the pelvis's move gizmo sits in the middle of the box");
  await page.evaluate(() => window.__armature.select(null));
  // A press on an edge, and 20 px outside it, takes the root; a drag from there moves the figure and lights the box.
  const edge = await page.evaluate(() => {
    const a = window.__armature;
    const b = a.rootBox();
    const pts = b.corners.map((c) => a.onScreen(...c));
    const others = a.handleNames().filter((n) => !n.startsWith('dash:') && n !== 'root').map((n) => a.ballOnScreen(n));
    const centre = a.onScreen(...b.centre);
    let best = null;
    for (let i = 0; i < 8; i++) {
      for (const bit of [1, 2, 4]) {
        if (i & bit) continue;
        const [p, q] = [pts[i], pts[i | bit]];
        const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const away = Math.hypot(mid[0] - centre[0], mid[1] - centre[1]) || 1;
        const out = [mid[0] + ((mid[0] - centre[0]) / away) * 18, mid[1] + ((mid[1] - centre[1]) / away) * 18];
        const nearest = Math.min(...others.map((o) => Math.hypot(o[0] - out[0], o[1] - out[1])));
        if (len > 30 && nearest > 40 && (!best || nearest > best.nearest)) best = { mid, out, nearest };
      }
    }
    return { best, root: a.state().root.position, centre, cam: window.__bozzetto.camera.position.toArray(), rq: a.state().root.quaternion };
  });
  t.ok(!!edge.best, 'an edge of the box stands clear of the other handles');
  for (const [label, at] of [['on an edge', edge.best.mid], ['18 px outside an edge', edge.best.out]]) {
    await page.mouse.move(at[0], at[1]);
    await page.mouse.down();
    await page.mouse.up();
    const p = await page.evaluate(() => window.__armature.picked());
    t.eq(p, 'root', `a press ${label} of the box takes the root`);
  }
  await page.mouse.move(edge.best.mid[0], edge.best.mid[1]);
  await page.mouse.down();
  await page.mouse.move(edge.best.mid[0] + 30, edge.best.mid[1] - 40, { steps: 6 });
  const held = await page.evaluate(() => window.__armature.handleLook('root'));
  await page.mouse.up();
  const dropped = await page.evaluate(() => ({ cam: window.__bozzetto.camera.position.toArray(), rq: window.__armature.state().root.quaternion, root: window.__armature.state().root.position, look: window.__armature.handleLook('root'), at: window.__armature.onScreen(...window.__armature.rootBox().centre) }));
  t.ok(held.state === 'hot' && held.colour === palette.hot, 'the box is orange while it is dragged');
  t.ok(dist(dropped.root, edge.root) > 5 && dropped.look.state === 'rest', `a drag from an edge moves the figure (${dist(dropped.root, edge.root).toFixed(1)} cm) and the box is neutral after`);
  const lag = Math.hypot(dropped.at[0] - edge.centre[0] - 30, dropped.at[1] - edge.centre[1] + 40);
  t.ok(lag < 8, `the box follows the pointer, as a drag of the old handle did (${lag.toFixed(1)} px off, from ${edge.centre.map((v) => v.toFixed(0))} to ${dropped.at.map((v) => v.toFixed(0))}; camera moved ${dist(edge.cam, dropped.cam).toFixed(2)}, root turned ${dist(edge.rq, dropped.rq).toFixed(3)})`);
  await page.evaluate(() => window.__armature.undo());
}

/** The head's turn from rest, in degrees, and the other bones', for a look at `point`. */
const experiment = (page, point) =>
  page.evaluate((pt) => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const Q = arm.root.quaternion.constructor;
    const turnOf = (name) => arm.bones.get(name).getWorldQuaternion(new Q()).multiply(arm.restWorld.get(name).q.clone().invert());
    const angle = (p, q) => (2 * Math.acos(Math.min(1, Math.abs(p.dot(q)))) * 180) / Math.PI;
    const names = ['spine', 'chest', 'neck', 'head'];
    const before = Object.fromEntries(names.map((n) => [n, turnOf(n)]));
    const hips = { pelvis: arm.jointWorld('pelvis').toArray(), thighL: arm.jointWorld('thigh.L').toArray(), thighR: arm.jointWorld('thigh.R').toArray(), root: arm.root.quaternion.toArray(), rootAt: arm.root.position.toArray() };
    const from0 = arm.lookFromWorld(new V());
    const at = new V(from0.x + pt[0], from0.y + pt[1], from0.z + pt[2]);
    const frame = turnOf('chest').clone().invert();
    a.look(at.x, at.y, at.z);
    const turns = Object.fromEntries(names.map((n) => [n, angle(before[n], turnOf(n))]));
    const forward = arm.lookForward(new V());
    const wanted = at.clone().sub(arm.lookFromWorld(new V())).normalize();
    // The wanted facing against the chest as it began: its turn to the side and its tilt.
    const local = wanted.clone().applyQuaternion(frame);
    const yaw = (Math.atan2(local.x, local.z) * 180) / Math.PI;
    const tilt = (Math.atan2(local.y, Math.hypot(local.x, local.z)) * 180) / Math.PI;
    const hipsNow = { pelvis: arm.jointWorld('pelvis').toArray(), thighL: arm.jointWorld('thigh.L').toArray(), thighR: arm.jointWorld('thigh.R').toArray(), root: arm.root.quaternion.toArray(), rootAt: arm.root.position.toArray() };
    const d = (p, q) => Math.hypot(...p.map((v, i) => v - q[i]));
    return {
      turns,
      toTarget: (Math.acos(Math.min(1, forward.dot(wanted))) * 180) / Math.PI,
      yaw,
      tilt,
      hips: Math.max(d(hips.pelvis, hipsNow.pelvis), d(hips.thighL, hipsNow.thighL), d(hips.thighR, hipsNow.thighR), d(hips.root, hipsNow.root), d(hips.rootAt, hipsNow.rootAt)),
      pose: Object.fromEntries(names.map((n) => [n, arm.getPoseEuler(n)])),
    };
  }, point);

async function armatureLook(page, base, t) {
  await openArmature(page, base);
  await page.waitForTimeout(500);
  const palette = await page.evaluate(() => window.__armature.handlePalette());

  // The target: in front of the face, along where the head faces, a head and a half away.
  const front = await page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const from = arm.lookFromWorld(new V());
    const arrow = a.handleLook('look:head');
    const dash = a.handleLook('dash:head');
    const head = arm.jointWorld('head');
    const tip = arm.effectorWorld('head', new V(), 1);
    return { from: from.toArray(), arrow, dash, forward: arm.lookForward(new V()).toArray(), headHeight: head.distanceTo(tip), hasChain: arm.chains().some((c) => c.id === 'head') };
  });
  const off = front.arrow.position.map((v, i) => v - front.from[i]);
  t.ok(!front.hasChain, "the head has no reach chain any more: its handle is the look-at target");
  t.ok(
    Math.abs(Math.hypot(...off) / front.headHeight - 1.5) < 0.1 && off[2] > 0.95 * Math.hypot(...off),
    `the look-at target sits ${(Math.hypot(...off) / front.headHeight).toFixed(2)} head heights in front of the face, along where the head faces`,
  );
  t.ok(
    front.arrow.shape === 'arrow' && dist(front.arrow.toward, front.from) < 1e-6 && front.dash.shape === 'dash' && dist(front.dash.from, front.from) < 1e-6 && dist(front.dash.toward, front.arrow.position) < 1e-6,
    'drawn as an arrowhead pointing away from the head, on a dashed line from the head',
  );
  t.ok(front.arrow.colour === palette.rest && front.arrow.pick >= 44, `neutral at rest, with a pick shape ${front.arrow.pick} px across`);

  // Dragged 40 degrees to one side: the head faces it, the neck half as far, the back a little, the hips stay.
  const side = [Math.sin((40 * Math.PI) / 180), 0, Math.cos((40 * Math.PI) / 180)].map((v) => v * 30);
  const e40 = await experiment(page, side);
  t.ok(e40.toTarget < 1, `the head's forward points at the target within a degree (${e40.toTarget.toFixed(3)})`);
  const head = e40.turns.head;
  t.ok(Math.abs(head - 40) < 4, `the head turned ${head.toFixed(1)} degrees for a target 40 degrees aside`);
  t.ok(e40.turns.neck / head > 0.4 && e40.turns.neck / head < 0.6, `the neck turned ${e40.turns.neck.toFixed(1)}, ${((100 * e40.turns.neck) / head).toFixed(0)} percent of the head's`);
  t.ok(e40.turns.chest / head > 0.05 && e40.turns.chest / head < 0.2, `the chest turned ${e40.turns.chest.toFixed(1)}, ${((100 * e40.turns.chest) / head).toFixed(0)} percent of the head's`);
  t.ok(e40.turns.spine < e40.turns.chest && e40.turns.spine > 0, `the spine under it a little less (${e40.turns.spine.toFixed(1)})`);
  t.ok(e40.hips < 1e-6, `the hips and the root did not move (${e40.hips.toExponential(1)})`);
  // The neck's own twist is its share, not the head's: its local turn about the vertical is the neck's, not the head's whole.
  t.ok(Math.abs(e40.pose.neck[1]) < 0.55 * Math.abs(e40.turns.head) && Math.abs(e40.pose.neck[1]) > 0.25 * Math.abs(e40.turns.head), `the neck's own twist is ${e40.pose.neck[1].toFixed(1)} degrees against the head's ${e40.pose.head[1].toFixed(1)}`);
  await page.evaluate(() => window.__armature.undo());

  // Up and down, and the same from where it is: the share holds.
  const up = await experiment(page, [0, 30 * Math.tan((35 * Math.PI) / 180), 30]);
  t.ok(up.toTarget < 1 && up.turns.neck / up.turns.head > 0.4 && up.turns.neck / up.turns.head < 0.6, `looking 35 degrees up: faces it within ${up.toTarget.toFixed(2)} degrees, the neck ${((100 * up.turns.neck) / up.turns.head).toFixed(0)} percent of the head`);
  await page.evaluate(() => window.__armature.undo());

  // Behind the figure: the head holds at its limit, and the neck is nowhere near its own.
  const behind = await experiment(page, [8, 5, -30]);
  t.ok(Math.abs(behind.yaw) > 80, `the target is past the limit (${behind.yaw.toFixed(0)} degrees to the side of the chest)`);
  const faced = await page.evaluate(() => {
    const arm = window.__armature.armature;
    const V = arm.root.position.constructor;
    const f = arm.lookForward(new V());
    return (Math.atan2(f.x, f.z) * 180) / Math.PI;
  });
  t.ok(behind.turns.head > 75 && behind.turns.head < 92 && Math.abs(faced) > 75 && Math.abs(faced) <= 91, `the head holds at the limit: turned ${behind.turns.head.toFixed(1)} degrees, facing ${faced.toFixed(1)} from the front`);
  const limits = await page.evaluate(() => {
    const arm = window.__armature.armature;
    return ['spine', 'chest', 'neck', 'head'].every((n) => {
      const e = arm.getPoseEuler(n);
      const l = arm.limitsOf(n);
      return [0, 1, 2].every((i) => e[i] >= l[['x', 'y', 'z'][i]][0] - 1e-3 && e[i] <= l[['x', 'y', 'z'][i]][1] + 1e-3);
    });
  });
  t.ok(limits && behind.hips < 1e-6, 'every joint stays inside its own limits and the hips stay put');
  await page.evaluate(() => window.__armature.undo());
  const tilted = await experiment(page, [0, 40, 5]);
  t.ok(tilted.tilt > 60 && tilted.turns.head < 63, `a target nearly overhead holds at the tilt limit (${tilted.tilt.toFixed(0)} wanted, the head turned ${tilted.turns.head.toFixed(1)})`);
  await page.evaluate(() => window.__armature.undo());

  // No snapping: sweeping the target from 70 degrees one way to 70 the other moves the neck smoothly.
  const sweep = await page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const from = arm.lookFromWorld(new V());
    const out = [];
    for (let d = -70; d <= 70; d += 5) {
      const r = (d * Math.PI) / 180;
      arm.beginLook();
      arm.lookAt(new V(from.x + 30 * Math.sin(r), from.y, from.z + 30 * Math.cos(r)));
      arm.endLook();
      out.push({ d, neck: arm.getPoseEuler('neck'), head: arm.getPoseEuler('head'), neckAt: arm.jointWorld('neck').toArray(), headAt: arm.jointWorld('head').toArray() });
    }
    arm.resetPose();
    a.commit();
    return out;
  });
  let step = 0;
  let jump = 0;
  for (let i = 1; i < sweep.length; i++) {
    for (let k = 0; k < 3; k++) step = Math.max(step, Math.abs(sweep[i].neck[k] - sweep[i - 1].neck[k]));
    jump = Math.max(jump, dist(sweep[i].headAt, sweep[i - 1].headAt));
  }
  t.ok(step < 4 && jump < 4, `sweeping the target 140 degrees in 5 degree steps moves the neck by at most ${step.toFixed(1)} degrees and the head's joint ${jump.toFixed(1)} cm a step: no snapping`);
  const joined = sweep.every((s) => {
    const neckLen = dist(s.neckAt, s.headAt);
    return neckLen > 0.5 * dist(sweep[0].neckAt, sweep[0].headAt) && neckLen < 2 * dist(sweep[0].neckAt, sweep[0].headAt);
  });
  t.ok(joined, 'and the neck joins the back to the head all the way (its length is the same as it turns)');

  // By the pointer: drag the target aside; the head turns and the ring of the target is orange while held.
  const grab = await page.evaluate(() => ({ at: window.__armature.ballOnScreen('look:head'), poseBefore: JSON.stringify(window.__armature.state().pose) }));
  await page.mouse.move(grab.at[0], grab.at[1]);
  await page.mouse.down();
  await page.mouse.move(grab.at[0] + 25, grab.at[1] - 4, { steps: 6 });
  const held = await page.evaluate(() => window.__armature.handleLook('look:head'));
  await page.mouse.move(grab.at[0] + 55, grab.at[1] - 8, { steps: 6 });
  await page.mouse.up();
  const dragged = await page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const f = arm.lookForward(new V());
    return { picked: a.picked(), yaw: (Math.atan2(f.x, f.z) * 180) / Math.PI, state: a.handleLook('look:head').state, selected: a.selectedHandle(), steps: a.history().undo };
  });
  t.ok(held.state === 'hot' && held.colour === palette.hot, `held, the look-at target is orange (${held.state})`);
  t.ok(dragged.picked === 'look:head' && Math.abs(dragged.yaw) > 10 && dragged.state === 'rest' && dragged.selected === null, `a drag by the pointer turns the head (${dragged.yaw.toFixed(0)} degrees), and the target is neutral after`);
  const afterDrag = await page.evaluate(() => JSON.stringify(window.__armature.state().pose));
  await page.evaluate(() => window.__armature.undo());
  const undone = await page.evaluate(() => JSON.stringify(window.__armature.state().pose));
  await page.evaluate(() => window.__armature.redo());
  const redone = await page.evaluate(() => JSON.stringify(window.__armature.state().pose));
  t.ok(undone === grab.poseBefore && redone === afterDrag && afterDrag !== grab.poseBefore, 'a drag is one undo step: undone, the pose is as it was; redone, as the drag left it');
  await page.evaluate(() => window.__armature.undo());

  // A tap selects it, with no gizmo (it is moved by dragging it); Move (W) puts the move gizmo on it.
  const tap = await page.evaluate(() => window.__armature.ballOnScreen('look:head'));
  await page.mouse.move(tap[0], tap[1]);
  await page.mouse.down();
  await page.mouse.up();
  const tapped = await page.evaluate(() => ({ sel: window.__armature.selectedHandle(), gizmo: window.__armature.gizmo().attached.join(','), look: window.__armature.handleLook('look:head').state }));
  t.ok(tapped.sel === 'head' && tapped.gizmo === '' && tapped.look === 'hot', `a tap on the target selects it, orange, with no gizmo (${JSON.stringify(tapped)})`);
  await page.keyboard.press('w');
  const moved = await page.evaluate(() => ({ sel: window.__armature.selectedHandle(), gizmo: window.__armature.gizmo().attached.join(',') }));
  t.ok(moved.sel === 'head' && moved.gizmo === 'translate', `W on the selected target brings its move gizmo (${JSON.stringify(moved)})`);
  await page.evaluate(() => window.__armature.selectHandle(null));

  // Pins and symmetry: a pinned hand holds still through a look; mirrored limbs stay mirrored.
  const held2 = await page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    arm.setPinned('hand.L', true);
    arm.setPinned('hand.R', true);
    const hands = () => ['hand.L', 'hand.R'].map((c) => a.handlePosition(c));
    const was = hands();
    arm.symmetry = true;
    const V = arm.root.position.constructor;
    const from = arm.lookFromWorld(new V());
    a.look(from.x + 20, from.y + 2, from.z + 25);
    const now = hands();
    const pose = (n) => arm.getPoseEuler(n);
    arm.symmetry = false;
    arm.setPinned('hand.L', false);
    arm.setPinned('hand.R', false);
    return { hand: Math.max(...was.map((p, i) => Math.hypot(...p.map((v, k) => v - now[i][k])))), shoulders: ['clavicle', 'upperarm'].map((n) => [pose(`${n}.L`), pose(`${n}.R`)]) };
  });
  t.ok(held2.hand < 0.3, `a pinned hand holds its place through a look, with symmetry on (${held2.hand.toFixed(3)} cm)`);
  await page.evaluate(() => {
    const a = window.__armature;
    a.armature.resetPose();
    a.commit();
  });

  // An old file: a head pin and a turned neck, chest and spine open as they were; the pin is let go.
  page.on('dialog', (d) => d.accept());
  const old = await page.evaluate(async () => {
    const a = window.__armature;
    const rec = JSON.parse(await a.pack());
    rec.state.pose = { ...rec.state.pose, spine: [4, -6, 1], chest: [-3, 9, 2], neck: [2, 22, -1], head: [-5, 14, 3] };
    rec.state.pins = { ...rec.state.pins, head: [0, 168, 6] };
    delete rec.state.aims?.head;
    await a.open(new File([JSON.stringify(rec)], 'old.armature'));
    const st = a.state();
    return { want: rec.state.pose, got: st.pose, pins: Object.keys(st.pins ?? {}), chains: a.armature.chains().map((c) => c.id) };
  });
  const gap = Math.max(...['spine', 'chest', 'neck', 'head'].map((n) => Math.max(...old.want[n].map((v, i) => Math.abs(v - (old.got[n]?.[i] ?? 0))))));
  t.ok(gap < 0.01, `an old file's neck, chest, spine and head rotations open as they were (worst ${gap.toFixed(4)} degrees)`);
  t.ok(!old.pins.includes('head') && !old.chains.includes('head'), `its head pin is dropped, since the head is a look-at now (pins: ${old.pins.join(', ')})`);
}

export const suites = { armatureControls, armatureLook };
