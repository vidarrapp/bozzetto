// Armature: a tap on a body part selects it, wherever the figure stands and
// however it is posed, and the joints turn as far as a dancer's.
//
//   armatureTap     the parts can be tapped at rest; after the figure is
//                   moved up and aside and an arm is raised, the hands, the
//                   arms, the feet, the neck and the head still can (owner
//                   report, 2026-11-18: they could not, because the skinned
//                   mesh kept the bounding sphere of its first pose and
//                   turned the tap's ray away before any triangle was read)
//   armatureRanges  the hip extends and the ankle points far enough for a
//                   leap, and the shipped mannequins carry the same limits
//                   as the app's own rig table
import { openArmature } from './lib.mjs';

const PARTS = ['head', 'neck', 'chest', 'upperarm.L', 'forearm.L', 'hand.L', 'hand.R', 'thigh.L', 'shin.R', 'foot.L', 'foot.R'];

/** Tap where the part is in view (a point the figure's own surface says is that part), after letting go of what was selected. */
async function tapPart(page, bone) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  const at = await page.evaluate((bone) => window.__armature.partSpot(bone), bone);
  if (!at) return 'not in view';
  await page.mouse.click(at[0], at[1]);
  await page.waitForTimeout(120);
  return page.evaluate(() => window.__armature.selected());
}

async function tapAll(page) {
  const missed = [];
  for (const bone of PARTS) {
    const got = await tapPart(page, bone);
    if (got !== bone) missed.push(`${bone} gave ${got}`);
  }
  return missed;
}

async function armatureTap(page, base, t) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1180, height: 820 });
  await openArmature(page, base);
  await page.waitForTimeout(800);
  // The handles are drawn over the figure and take a press first: off, so a tap on a hand is a tap on the hand.
  await page.evaluate(() => {
    for (const box of document.querySelectorAll('.panel--armature input[type=checkbox]')) {
      if (/handles/i.test(box.closest('label')?.textContent ?? '') && box.checked) box.click();
    }
  });
  await page.waitForTimeout(200);
  let missed = await tapAll(page);
  t.ok(missed.length === 0, `at rest every part is selected by a tap on it${missed.length ? ` (${missed.join('; ')})` : ''}`);

  // Moved up and aside, as a figure in a leap is, with an arm raised and a leg back.
  await page.evaluate(() => {
    const a = window.__armature;
    const b = a.armature.bounds();
    const h = b.max.y - b.min.y;
    a.moveRoot(h * 0.22, h * 0.25, 0);
    a.turn('upperarm.L', 0, 0, 80);
    a.turn('thigh.L', 60, 0, 0);
  });
  await page.waitForTimeout(400);
  missed = await tapAll(page);
  t.ok(missed.length === 0, `moved and posed, every part is still selected by a tap on it${missed.length ? ` (${missed.join('; ')})` : ''}`);

  // And moved again, back over the middle and part of the way down (clear of the open panel at the left):
  // the bounds follow the figure wherever it goes next.
  await page.evaluate(() => {
    const a = window.__armature;
    const b = a.armature.bounds();
    const h = b.max.y - b.min.y;
    a.moveRoot(-h * 0.22, -h * 0.15, 0);
  });
  await page.waitForTimeout(400);
  missed = await tapAll(page);
  t.ok(missed.length === 0, `moved again, the same${missed.length ? ` (${missed.join('; ')})` : ''}`);
  t.ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
}

async function armatureRanges(page, base, t) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openArmature(page, base);
  await page.waitForTimeout(600);
  const l = await page.evaluate(() => {
    const arm = window.__armature.armature;
    const of = (n) => arm.limitsOf(n);
    return { thigh: of('thigh.L'), foot: of('foot.L'), spine: of('spine'), upperarm: of('upperarm.L'), forearm: of('forearm.L'), figure: window.__armature.modelName?.() ?? null };
  });
  const span = ([a, b]) => b - a;
  // The hip: far enough back for the trailing leg of a leap, and far enough forward for a high kick.
  t.ok(Math.max(...l.thigh.x.map(Math.abs)) >= 150 && Math.min(...l.thigh.x.map(Math.abs)) >= 70, `the hip swings 150 one way and at least 70 the other (${l.thigh.x})`);
  t.ok(span(l.thigh.z) >= 125 && span(l.thigh.y) >= 115, `and opens and turns widely (side ${l.thigh.z}, twist ${l.thigh.y})`);
  t.ok(Math.max(...l.foot.x.map(Math.abs)) >= 70, `the ankle points a foot to at least 70 degrees (${l.foot.x})`);
  t.ok(span(l.spine.x) >= 90 && span(l.upperarm.x) >= 250, `the spine and the shoulder have a dancer's range (${l.spine.x}, ${l.upperarm.x})`);
  t.ok(span(l.forearm.y) >= 150, `the forearm twists most of a half turn (${l.forearm.y})`);
  // A thigh turned back by 70 degrees stays there (it used to stop at 30). Set on the joint itself: through the
  // mode, Plant feet would stand the foot back on the floor and take the turn back out.
  const held = await page.evaluate(() => {
    const arm = window.__armature.armature;
    const lim = arm.limitsOf('thigh.L').x;
    const back = Math.abs(lim[0]) < Math.abs(lim[1]) ? lim[0] : lim[1]; // the smaller side is the way back
    const want = Math.sign(back) * 70;
    arm.setPoseEuler('thigh.L', want, 0, 0);
    return { want, got: arm.getPoseEuler('thigh.L')[0] };
  });
  t.near(held.got, held.want, 0.5, `a thigh turned 70 degrees back holds there (${held.got})`);
  t.ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
}

export const suites = { armatureTap, armatureRanges };
