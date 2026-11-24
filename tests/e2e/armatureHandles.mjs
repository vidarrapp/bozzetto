// Armature handles, the owner's second round on the iPad:
//
//   armatureHandlesLook   the head's look-at is a point in the world: dragged anywhere on
//                         the screen, kept in the record and in every undo step, the head
//                         facing it after anything that moves the figure, no drift, no jump,
//                         the limits and the dimmer drawing past them, a turn of the head
//                         by hand carrying it, Mirror pose and Reset pose
//   armatureHandlesPole   a pole target follows the pointer round a locked-out limb, and the
//                         aim it sets holds when the limb bends again
//   armatureHandlesHips   the hip handle is the box the selected hips show, a tap selects the
//                         hips with the move and the turn gizmo, a press that drags moves the
//                         figure and leaves the selection (mouse, finger, pen)
//   armatureHandlesPin    a double-click, double-tap or long press on a reach ring pins it
//
// Real mouse input; the finger and the Pencil go through the browser's own pointer events
// (Input.dispatch*), as the dock's tests send them.

import { openArmature } from './lib.mjs';

const DEG = 180 / Math.PI;
const wait = (page, ms) => page.waitForTimeout(ms);
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

async function boot(page, base) {
  await page.setViewportSize({ width: 1180, height: 820 });
  await openArmature(page, base);
  await wait(page, 600);
}

/** A pointer of a kind: down, move, up at page points. The finger needs a context with a touchscreen (touchPage). */
async function pointer(page, kind) {
  if (kind === 'mouse') {
    return {
      down: async (x, y) => {
        await page.mouse.move(x, y);
        await page.mouse.down();
      },
      move: (x, y) => page.mouse.move(x, y),
      up: () => page.mouse.up(),
      cancel: () => page.mouse.up(),
      second: async () => {},
    };
  }
  const cdp = await page.context().newCDPSession(page);
  if (kind === 'pen') {
    let at = [0, 0];
    const pen = (type, x, y, buttons) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'pen', force: 0.6 });
    return {
      down: async (x, y) => {
        at = [x, y];
        await pen('mouseMoved', x, y, 0);
        await pen('mousePressed', x, y, 1);
      },
      // Two taps with every command sent at once, in order: a slow software frame cannot stretch the gap between them.
      doubleTap: async (x, y, x2, y2) => {
        await Promise.all([pen('mouseMoved', x, y, 0), pen('mousePressed', x, y, 1), pen('mouseReleased', x, y, 0), pen('mouseMoved', x2, y2, 0), pen('mousePressed', x2, y2, 1), pen('mouseReleased', x2, y2, 0)]);
      },
      move: async (x, y) => {
        at = [x, y];
        await pen('mouseMoved', x, y, 1);
      },
      up: () => pen('mouseReleased', at[0], at[1], 0),
      cancel: () => pen('mouseReleased', at[0], at[1], 0),
      second: async () => {},
    };
  }
  let at = [0, 0];
  const pt = (x, y, id = 1) => ({ x, y, id });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  return {
    down: async (x, y) => {
      at = [x, y];
      await touch('touchStart', [pt(x, y)]);
    },
    move: async (x, y) => {
      at = [x, y];
      await touch('touchMove', [pt(x, y)]);
    },
    doubleTap: async (x, y, x2, y2) => {
      await Promise.all([touch('touchStart', [pt(x, y)]), touch('touchEnd', []), touch('touchStart', [pt(x2, y2)]), touch('touchEnd', [])]);
    },
    up: () => touch('touchEnd', []),
    cancel: () => touch('touchCancel', []),
    second: () => touch('touchStart', [pt(at[0], at[1]), pt(at[0] + 200, at[1] - 200, 2)]),
  };
}

/** A context of its own with a touchscreen, for the finger; the caller closes it. */
async function touchPage(page, base) {
  const ctx = await page.context().browser().newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await boot(p, base);
  return { p, ctx, errors };
}

const KINDS = ['mouse', 'pen', 'touch'];

/** Runs `body(page, kind, pointer)` for each kind of pointer, the finger on a page of its own. */
async function eachKind(page, base, t, body, kinds = KINDS) {
  for (const kind of kinds) {
    if (kind === 'touch') {
      const { p, ctx, errors } = await touchPage(page, base);
      try {
        await body(p, kind, await pointer(p, kind));
      } finally {
        await ctx.close();
      }
      t.ok(!errors.length, `no page errors on the finger's page${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    } else {
      await boot(page, base);
      await body(page, kind, await pointer(page, kind));
    }
  }
}

/** Degrees between where the head faces and the direction from the eyes to the target. */
const faceError = (page) =>
  page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const f = arm.lookForward(new V());
    const eye = arm.lookFromWorld(new V());
    const want = new V(...a.state().look).sub(eye).normalize();
    return (Math.acos(Math.min(1, f.dot(want))) * 180) / Math.PI;
  });

/** The look chain's pose, per bone, in degrees. */
const chainPose = (page) =>
  page.evaluate(() => {
    const arm = window.__armature.armature;
    return Object.fromEntries(['spine', 'chest', 'neck', 'head'].map((n) => [n, arm.getPoseEuler(n)]));
  });
const poseGap = (p, q, bones = ['neck', 'head']) => Math.max(...bones.flatMap((b) => p[b].map((v, i) => Math.abs(v - q[b][i]))));

const lookAtPoint = (page) => page.evaluate(() => window.__armature.state().look);

/** Drag the look-at target by `dx, dy` page pixels with the mouse; returns where the pointer ended. */
async function dragLook(page, dx, dy, { steps = 8 } = {}) {
  const from = await page.evaluate(() => window.__armature.ballOnScreen('look:head'));
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(from[0] + dx, from[1] + dy, { steps });
  const end = [from[0] + dx, from[1] + dy];
  return { from, end, up: () => page.mouse.up() };
}

async function armatureHandlesLook(page, base, t) {
  await boot(page, base);
  const state0 = await page.evaluate(() => window.__armature.state());
  t.ok(Array.isArray(state0.look) && state0.look.length === 3, `the record keeps the look-at target as a point in the world (${state0.look})`);
  const front = await page.evaluate(() => {
    const arm = window.__armature.armature;
    const V = arm.root.position.constructor;
    const eye = arm.lookFromWorld(new V());
    const f = arm.lookForward(new V());
    return eye.addScaledVector(f, arm.lookDistance()).toArray();
  });
  t.ok(dist(state0.look, front) < 0.05, `a new figure has it in front of the head, a head and a half out (${dist(state0.look, front).toFixed(3)} cm off)`);

  // Dragged far to one side by the mouse: the handle goes where the pointer goes, anywhere on the screen.
  const grab = await page.evaluate(() => window.__armature.ballOnScreen('look:head'));
  const before = await chainPose(page);
  const far = await dragLook(page, 40, -10);
  const held = await page.evaluate(() => ({ at: window.__armature.ballOnScreen('look:head'), look: window.__armature.handleLook('look:head') }));
  const gap = Math.hypot(held.at[0] - far.end[0], held.at[1] - far.end[1]);
  t.ok(gap < 6, `the target is under the pointer, 40 px aside (${gap.toFixed(1)} px off)`);
  const mid = await chainPose(page);
  await far.up();
  const after = await chainPose(page);
  t.ok(poseGap(mid, after, ['spine', 'chest', 'neck', 'head']) < 0.01, `no jump when the drag ends (the chain moved ${poseGap(mid, after, ['spine', 'chest', 'neck', 'head']).toExponential(1)} degrees)`);
  t.ok((await faceError(page)) < 0.5, `the head faces it (${(await faceError(page)).toFixed(2)} degrees off)`);
  const reached = await page.evaluate(() => window.__armature.armature.lookInRange());
  t.ok(reached && held.look.fade === 1, 'in range, it is drawn at full strength');
  const moved = await page.evaluate(() => ({ sel: window.__armature.selectedHandle(), undo: window.__armature.history().undo }));
  t.ok(moved.sel === null && moved.undo === 1, 'a drag is one undo step and selects nothing');
  t.ok(poseGap(before, after, ['neck', 'head']) > 5, `the neck and head turned (${poseGap(before, after).toFixed(0)} degrees)`);
  void grab;

  // The target is a point in the world: the hips moved, a hand reached, a foot pinned and the hips moved: it stays, and the head faces it each time.
  const target = await lookAtPoint(page);
  const first = await chainPose(page);
  const stays = [];
  await page.evaluate(() => window.__armature.moveRoot(3, -2, 2, 3));
  stays.push(['the hips moved', dist(await lookAtPoint(page), target), await faceError(page)]);
  const away = await chainPose(page);
  t.ok(poseGap(first, away) > 0.5, `moving the hips turned the neck and head to keep facing it (${poseGap(first, away).toFixed(1)} degrees)`);
  await page.evaluate(() => window.__armature.moveRoot(-3, 2, -2, 3));
  stays.push(['the hips moved back', dist(await lookAtPoint(page), target), await faceError(page)]);
  const back = await chainPose(page);
  t.ok(poseGap(first, back) < 0.05, `the hips away and back leave the head and neck exactly as they were (${poseGap(first, back).toFixed(4)} degrees)`);
  await page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const hand = arm.effectorWorld('hand.R', new V());
    a.reach('hand.R', hand.x - 10, hand.y + 15, hand.z + 25);
  });
  stays.push(['a hand reached', dist(await lookAtPoint(page), target), await faceError(page)]);
  await page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const foot = arm.effectorWorld('foot.L', new V());
    a.reach('foot.L', foot.x + 2, foot.y + 6, foot.z + 8);
    arm.setPinned('foot.L', true);
    a.moveRoot(-3, -3, 2, 2);
  });
  stays.push(['a foot lifted and pinned, the hips moved', dist(await lookAtPoint(page), target), await faceError(page)]);
  for (const [what, moved, face] of stays) t.ok(moved < 0.01 && face < 0.6, `${what}: the target stays at its world point (${moved.toFixed(4)} cm) and the head faces it (${face.toFixed(2)} degrees off)`);
  await page.evaluate(() => window.__armature.armature.resetPose());
  await page.evaluate(() => window.__armature.look(...window.__armature.state().look));

  // No drift: a hundred small hip moves one way and a hundred back leave no twist in the neck.
  await boot(page, base);
  await page.evaluate(() => window.__armature.look(...window.__armature.state().look.map((v, i) => v + [-40, 6, 10][i])));
  const start = await chainPose(page);
  await page.evaluate(() => window.__armature.moveRoot(18, 0, 6, 100));
  const far100 = await chainPose(page);
  await page.evaluate(() => window.__armature.moveRoot(-18, 0, -6, 100));
  const home = await chainPose(page);
  t.ok(poseGap(start, home, ['neck', 'head']) < 0.05, `a hundred small hip moves and a hundred back leave the neck and head as they were (${poseGap(start, home).toFixed(4)} degrees)`);
  await page.evaluate(() => window.__armature.undo());
  await page.evaluate(() => window.__armature.undo());
  await page.evaluate(() => window.__armature.moveRoot(18, 0, 6, 1));
  const oneStep = await chainPose(page);
  t.ok(poseGap(far100, oneStep, ['neck', 'head']) < 0.05, `the same place in one move gives the same neck and head as a hundred (${poseGap(far100, oneStep).toFixed(4)} degrees)`);

  // Past the limits: the head holds, the target stays where it was put, drawn dimmer.
  await boot(page, base);
  const behind = await page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const eye = arm.lookFromWorld(new V());
    a.look(eye.x + 8, eye.y + 5, eye.z - 30);
    const chest = arm.bones.get('chest').getWorldQuaternion(new arm.root.quaternion.constructor()).multiply(arm.restWorld.get('chest').q.clone().invert()).invert();
    const f = arm.lookForward(new V()).applyQuaternion(chest);
    return {
      inRange: arm.lookInRange(),
      yaw: Math.atan2(f.x, f.z) * (180 / Math.PI),
      target: a.state().look,
      put: [eye.x + 8, eye.y + 5, eye.z - 30],
      target2: a.handleLook('look:head'),
      dash: a.handleLook('dash:head'),
    };
  });
  t.ok(!behind.inRange && Math.abs(behind.yaw) > 75 && Math.abs(behind.yaw) < 82, `behind the figure the head holds at its limit (${behind.yaw.toFixed(1)} degrees) and the target is out of range`);
  t.ok(dist(behind.target, behind.put) < 0.01, 'and the target stays where it was put');
  t.ok(behind.target2.fade < 0.6 && behind.dash.fade < 0.6, `drawn dimmer, the target and its line (${behind.target2.fade}, ${behind.dash.fade})`);
  await page.evaluate(() => window.__armature.undo());
  const nearAgain = await page.evaluate(() => ({ inRange: window.__armature.armature.lookInRange(), fade: window.__armature.handleLook('look:head').fade }));
  t.ok(nearAgain.inRange && nearAgain.fade === 1, 'back in range it is at full strength again');

  // A turn of the head or the neck by hand carries the target; of the chest, it does not.
  await boot(page, base);
  const carried = await page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    a.look(...arm.lookTarget(new V()).add(new V(-4, 0, 0)).toArray());
    const eye0 = arm.lookFromWorld(new V());
    const t0 = new V(...a.state().look);
    const d0 = t0.distanceTo(eye0);
    a.turn('head', 0, 15, 0);
    const eye1 = arm.lookFromWorld(new V());
    const t1 = new V(...a.state().look);
    const f = arm.lookForward(new V());
    const faces = Math.acos(Math.min(1, f.dot(t1.clone().sub(eye1).normalize()))) * (180 / Math.PI);
    const afterHead = { moved: t1.distanceTo(t0), d: t1.distanceTo(eye1), faces };
    a.turn('chest', 0, -8, 0);
    const t2 = new V(...a.state().look);
    const eye2 = arm.lookFromWorld(new V());
    const f2 = arm.lookForward(new V());
    const faces2 = Math.acos(Math.min(1, f2.dot(t2.clone().sub(eye2).normalize()))) * (180 / Math.PI);
    return { d0, afterHead, chestMoved: t2.distanceTo(t1), faces2 };
  });
  t.ok(carried.afterHead.moved > 1 && Math.abs(carried.afterHead.d - carried.d0) < 0.5 && carried.afterHead.faces < 0.6, `the head turned by hand carries the target at its distance (${carried.afterHead.moved.toFixed(1)} cm moved, ${carried.afterHead.d.toFixed(1)} from ${carried.d0.toFixed(1)}), and faces it`);
  t.ok(carried.chestMoved < 0.01 && carried.faces2 < 1, `the chest turned by hand leaves the target (${carried.chestMoved.toFixed(4)} cm) and the head keeps facing it (${carried.faces2.toFixed(2)} degrees)`);

  // Undo and redo take the target with the pose.
  await boot(page, base);
  const history = await page.evaluate(() => {
    const a = window.__armature;
    const s0 = a.state().look;
    a.look(s0[0] - 35, s0[1] + 4, s0[2] + 5);
    const s1 = a.state().look;
    a.undo();
    const u = a.state().look;
    a.redo();
    const r = a.state().look;
    return { s0, s1, u, r };
  });
  t.ok(dist(history.u, history.s0) < 1e-3 && dist(history.r, history.s1) < 1e-3 && dist(history.s0, history.s1) > 10, 'undo puts the target back and redo puts it where it was');

  // Saved and reloaded, and through a project file.
  const kept = await page.evaluate(async () => {
    const a = window.__armature;
    const s = a.state().look;
    await a.save();
    const text = await a.projectText();
    return { s, text, pose: JSON.stringify(a.state().pose) };
  });
  t.ok(JSON.parse(kept.text).state.look?.length === 3, 'the project file carries the target');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__armature, null, { timeout: 90_000 });
  await wait(page, 500);
  const reloaded = await page.evaluate(() => ({ look: window.__armature.state().look, pose: JSON.stringify(window.__armature.state().pose) }));
  t.ok(dist(reloaded.look, kept.s) < 1e-3 && reloaded.pose === kept.pose, `saved and reloaded, the target and the pose are as they were (${dist(reloaded.look, kept.s).toExponential(1)} cm)`);
  await page.evaluate(() => window.__armature.look(0, 150, 60));
  const opened = await page.evaluate(async (text) => {
    const a = window.__armature;
    await a.open(new File([text], 'figure.json', { type: 'application/json' }));
    return { look: a.state().look, pose: JSON.stringify(a.state().pose) };
  }, kept.text);
  t.ok(dist(opened.look, kept.s) < 1e-3 && opened.pose === kept.pose, 'a project file opened gives the target back');

  // A record from before the target was kept: it goes in front of the head.
  const old = await page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const s = a.state();
    delete s.look;
    arm.restore(s);
    const eye = arm.lookFromWorld(new V());
    const f = arm.lookForward(new V());
    return { look: a.state().look, expect: eye.addScaledVector(f, arm.lookDistance()).toArray() };
  });
  t.ok(old.look && dist(old.look, old.expect) < 0.05, `an old record, with none, has it in front of the head as it faces (${old.look ? dist(old.look, old.expect).toFixed(3) : 'none'} cm off)`);

  // Mirror pose and Reset pose.
  await boot(page, base);
  const mirrored = await page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    const eye = arm.lookFromWorld(new V());
    a.look(eye.x + 25, eye.y + 2, eye.z + 30);
    a.turn('upperarm.L', 20, 0, 30);
    const before = new V(...a.state().look);
    const mid = arm.root.getWorldPosition(new V()).x;
    arm.mirrorPose('L');
    arm.applyPins();
    a.commit();
    const after = new V(...a.state().look);
    return { before: before.toArray(), after: after.toArray(), mid };
  });
  t.ok(Math.abs(mirrored.after[0] - (2 * mirrored.mid - mirrored.before[0])) < 0.05 && Math.abs(mirrored.after[1] - mirrored.before[1]) < 0.05 && Math.abs(mirrored.after[2] - mirrored.before[2]) < 0.05, `Mirror pose reflects the target across the hips' middle (x ${mirrored.before[0].toFixed(1)} to ${mirrored.after[0].toFixed(1)})`);
  t.ok((await faceError(page)) < 0.6, 'and the head faces it');
  const reset = await page.evaluate(() => {
    const a = window.__armature;
    const arm = a.armature;
    const V = arm.root.position.constructor;
    arm.resetPose();
    a.commit();
    const eye = arm.lookFromWorld(new V());
    const f = arm.lookForward(new V());
    return { look: a.state().look, expect: eye.addScaledVector(f, arm.lookDistance()).toArray() };
  });
  t.ok(dist(reset.look, reset.expect) < 0.05, `Reset pose puts the target back in front of the head (${dist(reset.look, reset.expect).toFixed(3)} cm off)`);
}

/** The knee's or elbow's angle round the limb, as the aim reads it, for a world point. */
const aimAt = (page, chain, p) => page.evaluate(([c, q]) => {
  const arm = window.__armature.armature;
  const V = arm.root.position.constructor;
  return arm.aimFromPoint(c, new V(...q));
}, [chain, p]);

async function armatureHandlesPole(page, base, t) {
  await boot(page, base);
  for (const [chain, label] of [['foot.L', 'leg'], ['hand.R', 'arm']]) {
    for (const how of ['locked out', 'nearly straight']) {
      await page.evaluate(() => {
        window.__armature.armature.resetPose();
        window.__armature.commit();
      });
      const setup = await page.evaluate(
        ([chain, how]) => {
          const a = window.__armature;
          const arm = a.armature;
          const V = arm.root.position.constructor;
          const c = arm.chain(chain);
          const hingeIndex = c.links.findIndex((n) => arm.def(n)?.kind === 'hinge');
          const baseName = c.links[hingeIndex + 1];
          const root = arm.jointWorld(baseName);
          const eff = arm.effectorWorld(c.effector, new V());
          const dir = eff.clone().sub(root).normalize();
          const len = eff.distanceTo(root);
          const goal = root.clone().addScaledVector(dir, how === 'locked out' ? len * 3 : len * 0.992);
          // A foot pulled off the ground is not planted: keep it off it.
          if (goal.y < 6) goal.y = 6;
          a.reach(chain, goal.x, goal.y, goal.z);
          const joint = arm.jointWorld(baseName);
          const end = arm.jointWorld(arm.bones.get(c.effector).name);
          const axis = end.clone().sub(joint).normalize();
          const h = arm.hingeWorld(chain, new V()).sub(joint);
          h.addScaledVector(axis, -h.dot(axis));
          return { bend: h.length() };
        },
        [chain, how],
      );
      // Round the limb with the pointer: the handle's own circle about the limb, a step at a time.
      const info = await page.evaluate(
        ([chain]) => {
          const a = window.__armature;
          const arm = a.armature;
          const V = arm.root.position.constructor;
          const c = arm.chain(chain);
          const hingeIndex = c.links.findIndex((n) => arm.def(n)?.kind === 'hinge');
          const baseName = c.links[hingeIndex + 1];
          const joint = arm.jointWorld(baseName);
          const end = arm.jointWorld(arm.bones.get(c.effector).name);
          const axis = end.clone().sub(joint).normalize();
          const handle = new V(...a.handleLook(`aim:${chain}`).position);
          const relative = handle.clone().sub(joint);
          const circle = [];
          const Q = arm.root.quaternion.constructor;
          for (let k = 1; k <= 4; k++) {
            const p = relative.clone().applyQuaternion(new Q().setFromAxisAngle(axis, (k * 8 * Math.PI) / 180)).add(joint);
            circle.push(a.onScreen(p.x, p.y, p.z));
          }
          return { start: a.ballOnScreen(`aim:${chain}`), circle };
        },
        [chain],
      );
      let ok = info.start && info.circle.every(Boolean);
      t.ok(ok, `${label} ${how} (bend ${setup.bend.toFixed(3)} cm): the pole target is on screen to be dragged`);
      if (!ok) continue;
      const aim0 = await page.evaluate((c) => window.__armature.armature.getAim(c), chain);
      await page.mouse.move(info.start[0], info.start[1]);
      await page.mouse.down();
      const rows = [];
      for (const p of info.circle) {
        await page.mouse.move(p[0], p[1], { steps: 3 });
        rows.push(
          await page.evaluate(
            ([chain, p]) => {
              const a = window.__armature;
              const arm = a.armature;
              const V = arm.root.position.constructor;
              const h = a.handleLook(`aim:${chain}`);
              const s = a.onScreen(...h.position);
              const read = arm.aimFromPoint(chain, new V(...h.position));
              return { aim: arm.getAim(chain), read, gap: Math.hypot(s[0] - p[0], s[1] - p[1]) };
            },
            [chain, p],
          ),
        );
      }
      await page.mouse.up();
      const turned = Math.abs(rows[rows.length - 1].aim - aim0);
      const worstGap = Math.max(...rows.map((r) => r.gap));
      const worstRead = Math.max(...rows.map((r) => Math.abs(((r.read - r.aim + 540) % 360) - 180)));
      t.ok(turned > 8, `${label} ${how}: dragging the pole target round turns the aim (${aim0.toFixed(0)} to ${rows[rows.length - 1].aim.toFixed(0)} degrees)`);
      t.ok(worstRead < 3, `${label} ${how}: the target is drawn where the aim says, all the way round (${worstRead.toFixed(1)} degrees off at worst)`);
      t.ok(worstGap < 30, `${label} ${how}: and it stays with the pointer (${worstGap.toFixed(0)} px off at worst)`);
      // The aim holds: bend the limb again and the knee or elbow points where the target was left.
      const bent = await page.evaluate(
        ([chain]) => {
          const a = window.__armature;
          const arm = a.armature;
          const V = arm.root.position.constructor;
          const aim = arm.getAim(chain);
          const c = arm.chain(chain);
          const hingeIndex = c.links.findIndex((n) => arm.def(n)?.kind === 'hinge');
          const baseName = c.links[hingeIndex + 1];
          const root = arm.jointWorld(baseName);
          const eff = arm.effectorWorld(c.effector, new V());
          const goal = root.clone().lerp(eff, 0.72);
          a.reach(chain, goal.x, goal.y, goal.z);
          const knee = arm.aimFromPoint(chain, arm.hingeWorld(chain, new V()));
          return { aim, knee, kept: arm.getAim(chain) };
        },
        [chain],
      );
      const miss = Math.abs(((bent.knee - bent.aim + 540) % 360) - 180);
      t.ok(miss < 8 && Math.abs(bent.kept - bent.aim) < 0.5, `${label} ${how}: bent again, the ${label === 'leg' ? 'knee' : 'elbow'} points where the target was left (${bent.knee.toFixed(0)} against ${bent.aim.toFixed(0)} degrees)`);
    }
  }
}

/** The corners of the box the selected hips show, in the world: the pelvis part's own box, the highlight's, as drawn. */
const shownBox = (page) =>
  page.evaluate(() => {
    const arm = window.__armature.armature;
    const V = arm.root.position.constructor;
    const part = arm.partBones.get(arm.root.name);
    const g = arm.partGeometry.get(arm.root.name);
    g.boundingBox ?? g.computeBoundingBox();
    const b = g.boundingBox;
    part.updateWorldMatrix(true, false);
    const m = 0.008 * arm.scale;
    const corners = [];
    for (let i = 0; i < 8; i++) {
      corners.push(new V(i & 1 ? b.max.x + m : b.min.x - m, i & 2 ? b.max.y + m : b.min.y - m, i & 4 ? b.max.z + m : b.min.z - m).applyMatrix4(part.matrixWorld).toArray());
    }
    return corners;
  });
const sameBox = (a, b) => a.every((p) => b.some((q) => dist(p, q) < 0.02));

async function armatureHandlesHips(page, base, t) {
  await boot(page, base);
  // The handle is that box, selected or not, and as the hips move and turn.
  const check = async (label) => {
    const handle = await page.evaluate(() => window.__armature.rootBox().corners);
    t.ok(sameBox(handle, await shownBox(page)), `${label}: the hip handle's box is the pelvis part's box, corner for corner`);
  };
  await check('at rest');
  await page.evaluate(() => {
    const a = window.__armature;
    a.moveRoot(8, -5, 4);
    a.armature.root.quaternion.premultiply(new a.armature.root.quaternion.constructor().setFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.6));
    a.moveRoot(0, 0, 0);
  });
  await check('the hips moved and turned');
  await page.evaluate(() => window.__armature.armature.setProportions('pelvis', { size: 1.4, length: 0.8 }, false));
  await page.evaluate(() => window.__armature.moveRoot(0, 0, 0));
  await check('the pelvis resized');
  await page.evaluate(() => window.__armature.select('pelvis'));
  await check('with the hips selected');
  const sel = await page.evaluate(() => ({ g: window.__armature.gizmo(), box: window.__armature.rootBox() }));
  t.ok(sel.g.attached.join(',') === 'rotate,translate', `selected, the move arrows and the turn rings are both up (${sel.g.attached})`);
  t.ok(dist(sel.g.moveAt, sel.box.centre) < 0.01 && dist(sel.g.rotateAt, sel.box.centre) < 0.01, "and both sit at the box's middle");
  await page.evaluate(() => {
    window.__armature.select(null);
    window.__armature.undo();
  });
  await wait(page, 300);

  await eachKind(page, base, t, async (p, kind, ptr) => {
    const tag = `by ${kind}`;
    await p.evaluate(() => window.__armature.select(null));
    const spot = () =>
      p.evaluate(() => {
        const a = window.__armature;
        const b = a.rootBox();
        const centre = a.onScreen(...b.centre);
        return { centre, root: a.state().root.position, sel: a.selected(), picked: a.picked() };
      });
    // A tap selects the hips with both gizmos.
    const s0 = await spot();
    await ptr.down(s0.centre[0], s0.centre[1]);
    await ptr.up();
    await wait(p, 150);
    const tapped = await p.evaluate(() => ({ sel: window.__armature.selected(), g: window.__armature.gizmo(), root: window.__armature.state().root.position, undo: window.__armature.history().undo, state: window.__armature.handleLook('root').state }));
    t.ok(tapped.sel === 'pelvis' && tapped.g.attached.join(',') === 'rotate,translate', `${tag}: a tap on the box selects the hips, with the move and the turn gizmo (${tapped.sel}, ${tapped.g.attached})`);
    t.ok(dist(tapped.root, s0.root) < 0.01 && tapped.undo === 0, `${tag}: and moves nothing, takes no undo step`);
    t.ok(tapped.state === 'hot', `${tag}: the box is orange, selected`);
    // A press that drags moves the figure and leaves the selection as it was.
    await p.evaluate(() => window.__armature.select(null));
    const s1 = await spot();
    const startAt = [s1.centre[0] - 40, s1.centre[1] + 30];
    await ptr.down(startAt[0], startAt[1]);
    for (let k = 1; k <= 6; k++) await ptr.move(startAt[0] + k * 8, startAt[1] - k * 6);
    await ptr.up();
    await wait(p, 150);
    const dragged = await p.evaluate(() => ({ sel: window.__armature.selected(), root: window.__armature.state().root.position, undo: window.__armature.history().undo }));
    t.ok(dist(dragged.root, s1.root) > 4 && dragged.sel === null && dragged.undo === 1, `${tag}: a press that drags moves the figure (${dist(dragged.root, s1.root).toFixed(1)} cm), selects nothing and is one undo step`);
    // With the hips selected, a drag leaves them selected.
    await p.evaluate(() => window.__armature.select('pelvis'));
    const s2 = await spot();
    const edge = await p.evaluate(() => {
      const a = window.__armature;
      const b = a.rootBox();
      const pts = b.corners.map((c) => a.onScreen(...c));
      const others = a.handleNames().filter((n) => !n.startsWith('dash:') && n !== 'root').map((n) => a.ballOnScreen(n)).filter(Boolean);
      // A point on an edge of the box that no gizmo handle and no other handle takes.
      for (let i = 0; i < 8; i++) {
        for (const bit of [1, 2, 4]) {
          if (i & bit) continue;
          for (const k of [0.5, 0.3, 0.7, 0.15, 0.85]) {
            const m = [pts[i][0] + (pts[i | bit][0] - pts[i][0]) * k, pts[i][1] + (pts[i | bit][1] - pts[i][1]) * k];
            if (a.gizmoHit(m[0], m[1])) continue;
            if (others.some((o) => Math.hypot(o[0] - m[0], o[1] - m[1]) < 60)) continue;
            return m;
          }
        }
      }
      return null;
    });
    t.ok(!!edge, `${tag}: an edge of the box stands clear of the gizmo`);
    if (!edge) return;
    await ptr.down(edge[0], edge[1]);
    for (let k = 1; k <= 6; k++) await ptr.move(edge[0] - k * 6, edge[1] + k * 4);
    await ptr.up();
    await wait(p, 150);
    const kept = await p.evaluate(() => ({ sel: window.__armature.selected(), root: window.__armature.state().root.position, g: window.__armature.gizmo() }));
    t.ok(dist(kept.root, s2.root) > 3 && kept.sel === 'pelvis' && kept.g.attached.join(',') === 'rotate,translate', `${tag}: a drag with the hips selected moves the figure and leaves them selected (${dist(kept.root, s2.root).toFixed(1)} cm)`);
    await p.evaluate(() => window.__armature.undo());
    await p.evaluate(() => window.__armature.undo());
    await p.evaluate(() => window.__armature.select(null));
  });

  // A turn ring turns the hips about the middle of the box, and the pinned feet hold.
  await boot(page, base);
  await page.evaluate(() => window.__armature.select('pelvis'));
  await wait(page, 200);
  const ring = await page.evaluate(() => {
    const a = window.__armature;
    const c = a.onScreen(...a.rootBox().centre);
    let best = null;
    for (let r = 20; r < 160; r += 4) {
      for (let k = 0; k < 72; k++) {
        const x = c[0] + r * Math.cos((k * 5 * Math.PI) / 180);
        const y = c[1] + r * Math.sin((k * 5 * Math.PI) / 180);
        const hit = a.gizmoHit(x, y);
        if (hit && hit.mode === 'rotate' && hit.axis === 'Y') {
          if (!best) best = { x, y, c };
        }
      }
    }
    return best;
  });
  t.ok(!!ring, 'the hips have a turn ring about the vertical to press');
  if (ring) {
    const before = await page.evaluate(() => {
      const a = window.__armature;
      const arm = a.armature;
      const V = arm.root.position.constructor;
      return { q: arm.root.getWorldQuaternion(new arm.root.quaternion.constructor()).toArray(), feet: ['foot.L', 'foot.R'].map((f) => arm.effectorWorld(f, new V()).toArray()), box: a.rootBox().centre };
    });
    // Along the ring: a quarter of the way round from the press.
    const rx = ring.x - ring.c[0];
    const ry = ring.y - ring.c[1];
    await page.mouse.move(ring.x, ring.y);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) {
      const a = (k * 6 * Math.PI) / 180;
      await page.mouse.move(ring.c[0] + rx * Math.cos(a) - ry * Math.sin(a), ring.c[1] + rx * Math.sin(a) + ry * Math.cos(a), { steps: 2 });
    }
    await page.mouse.up();
    await wait(page, 200);
    const after = await page.evaluate(() => {
      const a = window.__armature;
      const arm = a.armature;
      const V = arm.root.position.constructor;
      return { q: arm.root.getWorldQuaternion(new arm.root.quaternion.constructor()).toArray(), feet: ['foot.L', 'foot.R'].map((f) => arm.effectorWorld(f, new V()).toArray()), box: a.rootBox().centre, sel: a.selected(), undo: a.history().undo };
    });
    const dot = Math.abs(before.q.reduce((s, v, i) => s + v * after.q[i], 0));
    const turned = 2 * Math.acos(Math.min(1, dot)) * DEG;
    t.ok(turned > 8, `a turn ring turns the hips (${turned.toFixed(0)} degrees)`);
    t.ok(dist(before.box, after.box) < 0.5, `about the middle of the box (it moved ${dist(before.box, after.box).toFixed(2)} cm)`);
    t.ok(dist(before.feet[0], after.feet[0]) < 2.5 && dist(before.feet[1], after.feet[1]) < 2.5, `the pinned feet hold (${dist(before.feet[0], after.feet[0]).toFixed(2)} and ${dist(before.feet[1], after.feet[1]).toFixed(2)} cm off)`);
    t.ok(after.sel === 'pelvis' && after.undo === 1, 'the hips stay selected, and the turn is one undo step');
  }
}

/** A tap on a reach ring, a double-click, a long press: what pins it. */
async function armatureHandlesPin(page, base, t) {
  const pinned = (p, id) => p.evaluate((c) => ({ pinned: window.__armature.armature.isPinned(c), dot: window.__armature.handleLook(`ik:${c}`).dot, box: document.querySelector(`.panel--armature input[type=checkbox]`) ? [...document.querySelectorAll('.panel--armature label')].find((l) => new RegExp(`^Pin ${c === 'hand.R' ? 'right hand' : c === 'hand.L' ? 'left hand' : c === 'foot.R' ? 'right foot' : 'left foot'}$`, 'i').test(l.textContent.trim()))?.querySelector('input')?.checked ?? null : null, undo: window.__armature.history().undo, sel: window.__armature.selectedHandle(), pose: JSON.stringify(window.__armature.state().pose) }), id);
  const ringAt = (p, id) => p.evaluate((c) => window.__armature.ballOnScreen(`ik:${c}`), id);

  await boot(page, base);
  // A double-click pins it, a second frees it; the panel's box and the ring's dot follow; each is one undo step.
  const at = await ringAt(page, 'hand.R');
  const s0 = await pinned(page, 'hand.R');
  t.ok(!s0.pinned && !s0.dot, 'a hand starts free');
  await page.mouse.dblclick(at[0], at[1]);
  await wait(page, 150);
  const s1 = await pinned(page, 'hand.R');
  t.ok(s1.pinned && s1.dot && s1.undo === s0.undo + 1 && s1.pose === s0.pose, `a double-click pins the hand, the ring shows its dot, and the limb has not moved (one undo step)`);
  if (s1.box !== null) t.ok(s1.box === true, "and the panel's Pin box agrees");
  await page.mouse.dblclick(at[0], at[1]);
  await wait(page, 150);
  const s2 = await pinned(page, 'hand.R');
  t.ok(!s2.pinned && !s2.dot && s2.undo === s1.undo + 1, 'a second double-click frees it');
  if (s2.box !== null) t.ok(s2.box === false, "and the panel's box follows");
  await page.evaluate(() => window.__armature.undo());
  t.ok((await pinned(page, 'hand.R')).pinned, 'undo takes the free back to a pin');
  await page.evaluate(() => window.__armature.undo());
  t.ok(!(await pinned(page, 'hand.R')).pinned, 'and the pin away');

  // A single click only selects it.
  await page.mouse.click(at[0], at[1]);
  await wait(page, 600);
  const single = await pinned(page, 'hand.R');
  t.ok(!single.pinned && single.sel === 'hand.R', 'a single click selects the hand and pins nothing');

  // The pole targets, the look-at target and the hip box do not pin.
  for (const name of ['aim:hand.R', 'aim:foot.L', 'look:head']) {
    const p = await page.evaluate((n) => window.__armature.ballOnScreen(n), name);
    const before = await page.evaluate(() => JSON.stringify(window.__armature.armature.serialize().pins));
    await page.mouse.dblclick(p[0], p[1]);
    await wait(page, 150);
    await page.mouse.move(p[0], p[1]);
    await page.mouse.down();
    await wait(page, 750);
    await page.mouse.up();
    const after = await page.evaluate(() => JSON.stringify(window.__armature.armature.serialize().pins));
    t.eq(after, before, `a double-click or a long press on ${name} pins nothing`);
  }
  const hip = await page.evaluate(() => window.__armature.onScreen(...window.__armature.rootBox().centre));
  const pinsBefore = await page.evaluate(() => JSON.stringify(window.__armature.armature.serialize().pins));
  await page.mouse.dblclick(hip[0], hip[1]);
  await page.mouse.move(hip[0], hip[1]);
  await page.mouse.down();
  await wait(page, 750);
  await page.mouse.up();
  t.eq(await page.evaluate(() => JSON.stringify(window.__armature.armature.serialize().pins)), pinsBefore, 'and neither does the hip box');

  // Long press, held still, by the mouse, the Pencil and a finger: pins under the finger, the lift does nothing more.
  await eachKind(page, base, t, async (p, kind, ptr) => {
    const tag = `by ${kind}`;
    const r = await ringAt(p, 'hand.R');
    const s = await pinned(p, 'hand.R');
    await ptr.down(r[0], r[1]);
    await wait(p, 800);
    const during = await pinned(p, 'hand.R');
    t.ok(during.pinned && during.dot && during.undo === s.undo + 1, `${tag}: a long press pins the hand while the press is still down`);
    await ptr.up();
    await wait(p, 200);
    const lifted = await pinned(p, 'hand.R');
    t.ok(lifted.pinned && lifted.sel === null && lifted.undo === during.undo && lifted.pose === s.pose, `${tag}: the lift changes nothing: no selection, no move, no second step`);
    // Held again it frees it.
    await ptr.down(r[0], r[1]);
    await wait(p, 800);
    await ptr.up();
    await wait(p, 200);
    t.ok(!(await pinned(p, 'hand.R')).pinned, `${tag}: held again, it is freed`);
    // A press that travels before the time is a drag and never pins.
    await ptr.down(r[0], r[1]);
    for (let k = 1; k <= 5; k++) await ptr.move(r[0] + k * 9, r[1] - k * 5);
    await wait(p, 800);
    await ptr.up();
    await wait(p, 200);
    const dragged = await pinned(p, 'hand.R');
    t.ok(!dragged.pinned && dragged.pose !== s.pose, `${tag}: a press that travels first is a drag, and does not pin`);
    await p.evaluate(() => window.__armature.undo());
    // A tap does not pin.
    await ptr.down(r[0], r[1]);
    await wait(p, 100);
    await ptr.up();
    await wait(p, 600);
    const tap = await pinned(p, 'hand.R');
    t.ok(!tap.pinned && tap.sel === 'hand.R', `${tag}: a tap selects the hand and pins nothing`);
  });

  // Two taps, the double-tap, by the Pencil and the finger.
  await eachKind(
    page,
    base,
    t,
    async (p, kind, ptr) => {
      const r = await ringAt(p, 'hand.L');
      const s = await pinned(p, 'hand.L');
      // Sent without waiting between: a slow software frame must not stretch the gap between the taps.
      await ptr.doubleTap(r[0], r[1], r[0] + 3, r[1] + 2);
      await wait(p, 300);
      const d = await pinned(p, 'hand.L');
      t.ok(d.pinned && d.undo === s.undo + 1 && d.pose === s.pose, `by ${kind}: a double-tap pins the hand and moves no limb`);
    },
    ['pen', 'touch'],
  );

  // A second finger cancels a pending long press.
  const { p, ctx } = await touchPage(page, base);
  try {
    const ptr = await pointer(p, 'touch');
    const r = await ringAt(p, 'hand.R');
    await ptr.down(r[0], r[1]);
    await wait(p, 200);
    await ptr.second();
    await wait(p, 700);
    t.ok(!(await pinned(p, 'hand.R')).pinned, 'a second finger down cancels a pending long press');
    await ptr.cancel();
  } finally {
    await ctx.close();
  }
}

export const suites = { armatureHandlesLook, armatureHandlesPole, armatureHandlesHips, armatureHandlesPin };
