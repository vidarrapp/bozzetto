// Cameras (src/sculpt/bridge/cameras.ts): named, kept views listed in the Scene panel, with a lock,
// tied to reference pictures, kept with the scene. Each gets (page, base, t).
//
// cameras: Create has a Camera choice that makes a camera from the view and looks through it (its row
//   marked in use, "Working view" first); a tap on Working view and back restores each view; an unlocked
//   camera goes with the person; no shader or pipeline is built on switching; rename, lock, make and
//   delete are undo steps and Delete takes the picked row; the Camera tab edits the camera in use and
//   greys for a locked one (each camera keeps its own lens and projection).
// camerasLock: through a locked camera mouse orbit, the wheel, a pinch, F, A, the Shift snap and the
//   turntable leave the view where it is and say why once; a stroke still lands; Working view frees it.
// camerasRefs: a picture tied to a camera shows only through it; Match view goes to that camera;
//   "Make a camera of this view" makes a locked camera of a saved view and the old saved view still works.
// camerasKept: the cameras, their lock, their tie and the one in use come back from a reload, a file
//   (with and without pictures) and a scene file written by hand; a scene from before cameras opens with none;
//   a new scene has none.
import { mkdirSync } from 'node:fs';
import { devices, emptySpot, line, openForInput, openPanel, settle, strokeCount } from './smoke.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/cameras';
mkdirSync(SHOTS, { recursive: true });

const HINT = 'This camera is locked. Tap Working view to look around.';

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

/** The view as the viewer has it. */
const view = (page) => page.evaluate(() => window.__sculpt.viewer.readView());
const gap = (a, b) => Math.max(...a.position.map((p, i) => Math.abs(p - b.position[i])), ...a.target.map((p, i) => Math.abs(p - b.target[i])));
const dist = (v) => Math.hypot(...v.position.map((p, i) => p - v.target[i]));
const same = (a, b) => gap(a, b) < dist(a) * 1e-6 && a.lens === b.lens && a.projection === b.projection;
const fmt = (v) => `${v.position.map((x) => x.toFixed(3)).join(',')} to ${v.target.map((x) => x.toFixed(3)).join(',')}`;

/** The Cameras group as it is on screen. */
const rows = (page) =>
  page.evaluate(() => {
    const group = document.querySelector('[data-role=cameras-group]');
    const working = document.querySelector('[data-role=camera-working]');
    return {
      hidden: !group || group.hidden,
      head: group?.querySelector('.outliner__group')?.textContent ?? null,
      working: working ? { active: working.classList.contains('outliner__row--active') } : null,
      cameras: [...document.querySelectorAll('[data-role=camera-row]')].map((r) => ({
        id: r.dataset.camera,
        name: r.querySelector('.outliner__name')?.textContent ?? r.querySelector('.outliner__rename')?.value,
        active: r.classList.contains('outliner__row--active'),
        picked: r.classList.contains('outliner__row--picked'),
        locked: !!r.querySelector('[data-role=camera-lock].outliner__icon--on'),
      })),
    };
  });
const names = async (page) => (await rows(page)).cameras.map((c) => c.name).join(', ');

/** Create, Camera: the way a person makes one. */
async function makeCamera(page) {
  await page.evaluate(() => document.querySelector('.panel--scene .outliner__btn--wide').click());
  await page.waitForFunction(() => document.querySelector('.outliner__menu--create:not([hidden]) [data-role=create-camera]'), null, { timeout: 5000 });
  await page.evaluate(() => document.querySelector('.outliner__menu--create [data-role=create-camera]').click());
  await frames(page);
}
const tapRow = async (page, sel) => {
  const box = await page.evaluate((s) => {
    const r = document.querySelector(s).querySelector('.outliner__name').getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, sel);
  await page.mouse.click(box[0], box[1]);
  await frames(page);
};
const tapCamera = (page, id) => tapRow(page, `[data-role=camera-row][data-camera="${id}"]`);
const tapWorking = (page) => tapRow(page, '[data-role=camera-working]');
const press = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
const counters = (page) => page.evaluate(() => window.__bozzetto.renderCounters());
const builds = (c) => `${c.nodeBuilds}/${c.programs}/${c.pipelines}`;
const undo = async (page) => {
  await page.evaluate(() => window.__sculpt.session.undo());
  await frames(page);
};
const redo = async (page) => {
  await page.evaluate(() => window.__sculpt.session.redo());
  await frames(page);
};

/** An orbit by the mouse from a bare spot: begins, moves `dx` across, lets go, and the coast is stopped. */
async function orbit(page, from, dx) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(from[0] + 4, from[1], { steps: 2 });
  await page.mouse.move(from[0] + dx, from[1] + dx * 0.2, { steps: 4 });
  await page.mouse.up();
  await frames(page, 2);
  await settle(page);
}

/** What the hint has said: how many notices carry its words. */
const hints = (page) => page.evaluate((h) => [...document.querySelectorAll('.sculpt-toast')].filter((n) => n.textContent === h).length, HINT);
const clearToasts = (page) => page.evaluate(() => document.querySelectorAll('.sculpt-toast').forEach((n) => n.remove()));

/** A PNG as bytes, for the board. */
const png = async (page, color) =>
  Buffer.from(
    await page.evaluate((c) => {
      const cv = document.createElement('canvas');
      cv.width = 160;
      cv.height = 120;
      const x = cv.getContext('2d');
      x.fillStyle = c;
      x.fillRect(0, 0, 160, 120);
      x.fillStyle = '#fff';
      x.fillRect(70, 30, 20, 60);
      return cv.toDataURL('image/png').split(',')[1];
    }, color),
    'base64',
  );
const addPicture = async (page, color, name) => {
  const before = await page.evaluate(() => window.__sculpt.reference.board.list().length);
  await page.setInputFiles('.ref-file', [{ name, mimeType: 'image/png', buffer: await png(page, color) }]);
  await page.waitForFunction((n) => window.__sculpt.reference.board.list().length > n, before, { timeout: 15_000 });
  await page.waitForTimeout(150);
  return page.evaluate((nm) => window.__sculpt.reference.board.list().find((i) => i.name === nm.replace(/\.[a-z0-9]{2,5}$/i, ''))?.id, name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const suites = {
  async cameras(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await openPanel(page, 'Scene');
    await page.keyboard.press('f');
    await settle(page);
    const empty = await emptySpot(page);
    t.ok(!!empty, 'a spot of bare canvas to orbit from');
    await orbit(page, empty, 90);

    let r = await rows(page);
    t.ok(r.hidden && r.cameras.length === 0, 'a scene with no camera shows no Cameras group');

    // --- Create has a Camera choice; it keeps the view and looks through it ---
    const v0 = await view(page);
    await page.evaluate(() => document.querySelector('.panel--scene .outliner__btn--wide').click());
    await page.waitForFunction(() => document.querySelector('.outliner__menu--create:not([hidden]) [data-role=create-camera]'), null, { timeout: 5000 });
    const choices = await page.evaluate(() => {
      const menu = document.querySelector('.outliner__menu--create');
      const cam = menu.querySelector('[data-role=create-camera]');
      const first = menu.firstElementChild;
      return { text: cam.textContent.trim(), first: first === cam, head: menu.querySelector('.outliner__menu-head')?.textContent };
    });
    t.eq(choices.text, 'Camera', 'the Create choices have a Camera choice');
    t.ok(choices.first && choices.head === 'Primitives', 'a small row of its own above Primitives');
    await page.screenshot({ path: `${SHOTS}/create-choices.png` });
    await page.evaluate(() => document.querySelector('.outliner__menu--create [data-role=create-camera]').click());
    await frames(page);
    r = await rows(page);
    t.ok(!r.hidden && r.head === 'Cameras', 'the Cameras group shows, headed Cameras');
    t.eq(r.cameras.map((c) => c.name).join(), 'Camera 1', 'the new camera is named Camera 1');
    t.ok(r.cameras[0].active && r.working && !r.working.active, 'its row is the one in use, and Working view is not');
    const c1 = r.cameras[0].id;
    const at = await view(page);
    t.ok(same(at, v0), `the view did not move on making it (${fmt(v0)} and ${fmt(at)})`);
    const kept = await page.evaluate((id) => window.__sculpt.session.cameras.get(id), c1);
    t.ok(
      kept.position.every((p, i) => Math.abs(p - v0.position[i]) < 1e-6) && kept.lens === v0.lens && kept.projection === v0.projection && kept.locked === false,
      'the camera keeps the view as it was: place, target, lens and projection, unlocked',
    );
    const order = await page.evaluate(() => {
      const kids = [...document.querySelector('.outliner').children];
      const at = (sel) => kids.findIndex((k) => k.matches(sel) || k.querySelector(sel));
      return { objects: at('.outliner__row:not(.outliner__row--camera):not(.outliner__row--caliper)'), cameras: at('[data-role=cameras-group]'), calipers: at('[data-role=calipers-group]') };
    });
    t.ok(order.objects >= 0 && order.objects < order.cameras && order.cameras < order.calipers, `the group stands between the objects and the Calipers (${JSON.stringify(order)})`);
    const markColour = await page.evaluate(() => getComputedStyle(document.querySelector('[data-role=camera-row].outliner__row--active .outliner__mark')).color);
    const otherColour = await page.evaluate(() => getComputedStyle(document.querySelector('[data-role=camera-working] .outliner__mark')).color);
    t.ok(markColour !== otherColour, `only the row in use carries the orange (${markColour} against ${otherColour})`);

    // --- It goes with the person; Working view and back restore each view ---
    const before = await counters(page);
    await orbit(page, empty, 110);
    const v1 = await view(page);
    t.ok(!same(v1, v0), `looking through an unlocked camera, an orbit moves the view (${fmt(v0)} to ${fmt(v1)})`);
    await tapWorking(page);
    let now = await view(page);
    t.ok(same(now, v0), `Working view puts the view back exactly as it was before the camera (${fmt(v0)} and ${fmt(now)})`);
    r = await rows(page);
    t.ok(r.working.active && !r.cameras[0].active, 'and Working view is the row in use');
    await tapCamera(page, c1);
    now = await view(page);
    t.ok(same(now, v1), `a tap on the camera puts the view where it was left, where the person took it (${fmt(v1)} and ${fmt(now)})`);
    const camNow = await page.evaluate((id) => window.__sculpt.session.cameras.get(id), c1);
    t.ok(!camNow.locked, 'the camera moved with them and is still unlocked');
    await page.screenshot({ path: `${SHOTS}/scene-working-and-camera.png` });
    const after = await counters(page);
    t.eq(builds(after), builds(before), `switching builds no shader or pipeline (${builds(before)} and ${builds(after)})`);

    // --- Names, rename, lock, a second camera ---
    await makeCamera(page);
    t.eq(await names(page), 'Camera 1, Camera 2', 'a second camera is Camera 2');
    r = await rows(page);
    const c2 = r.cameras[1].id;
    t.ok(r.cameras[1].active && !r.cameras[0].active, 'and it is the one in use');
    await page.evaluate((id) => {
      const el = document.querySelector(`[data-camera="${id}"] [data-role=camera-name]`);
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    }, c2);
    await page.waitForSelector('[data-role=camera-rename]');
    await page.fill('[data-role=camera-rename]', 'Front view');
    await page.keyboard.press('Enter');
    await frames(page);
    t.eq(await names(page), 'Camera 1, Front view', 'a double tap renames it, as an object is');
    await undo(page);
    t.eq(await names(page), 'Camera 1, Camera 2', 'undo takes the name back');
    await redo(page);
    t.eq(await names(page), 'Camera 1, Front view', 'and redo gives it again');

    await press(page, `[data-camera="${c2}"] [data-role=camera-lock]`);
    await frames(page);
    r = await rows(page);
    t.ok(r.cameras[1].locked, 'the padlock locks it');
    t.ok(await page.evaluate(() => window.__sculpt.viewer.isViewLocked()), 'and the view is locked while it is in use');
    await undo(page);
    r = await rows(page);
    t.ok(!r.cameras[1].locked && !(await page.evaluate(() => window.__sculpt.viewer.isViewLocked())), 'undo unlocks it');
    await redo(page);
    await press(page, `[data-camera="${c2}"] [data-role=camera-lock]`);
    await frames(page);
    t.ok(!(await rows(page)).cameras[1].locked, 'a second tap on the padlock unlocks it');

    // --- The Camera tab edits the camera in use; each camera keeps its own lens and projection ---
    await page.evaluate(() => window.__sculpt.present.enter());
    await page.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 8000 });
    await openPanel(page, 'Camera');
    const tab = () =>
      page.evaluate(() => {
        const p = document.querySelector('.panel--camera');
        const sel = p.querySelector('select[aria-label=Projection]');
        const lens = p.querySelector('input[type=range]');
        return { projection: sel.value, selDisabled: sel.disabled, lensDisabled: lens.disabled, lens: window.__sculpt.viewer.getFocalLength() };
      });
    let tb = await tab();
    t.ok(!tb.selDisabled && !tb.lensDisabled, 'in an unlocked camera the Camera tab edits the lens and the projection');
    await page.selectOption('.panel--camera select[aria-label=Projection]', 'orthographic');
    await frames(page);
    t.ok(await page.evaluate(() => window.__sculpt.viewer.isOrthographic()), 'the tab switches the camera in use to orthographic');
    await page.evaluate(() => window.__sculpt.session.cameras.look(null));
    await frames(page);
    t.ok(!(await page.evaluate(() => window.__sculpt.viewer.isOrthographic())), 'the working view is still perspective: the projection was the camera’s own');
    await page.evaluate((id) => window.__sculpt.session.cameras.look(id), c2);
    await frames(page);
    t.ok(await page.evaluate(() => window.__sculpt.viewer.isOrthographic()), 'and the camera is still orthographic when looked through again');
    const kept2 = await page.evaluate((id) => window.__sculpt.session.cameras.get(id).projection, c2);
    t.eq(kept2, 'orthographic', 'its record says so');
    await page.evaluate((id) => window.__sculpt.session.cameras.setLocked(id, true), c2);
    await frames(page);
    await page.evaluate(() => window.dispatchEvent(new Event('bozzetto:controls-refresh')));
    await frames(page);
    tb = await tab();
    t.ok(tb.selDisabled && tb.lensDisabled, 'through a locked camera the projection and lens rows are greyed');
    await page.screenshot({ path: `${SHOTS}/camera-tab-locked.png` });
    await page.evaluate((id) => window.__sculpt.session.cameras.setLocked(id, false), c2);
    await page.evaluate(() => window.__sculpt.studio.go('sculpt'));
    await page.waitForFunction(() => !document.body.classList.contains('presenting'), null, { timeout: 15_000 });
    await page.evaluate(() => window.__sculpt.session.cameras.look(null));
    await openPanel(page, 'Scene');
    await frames(page);

    // --- Delete: the trash can, the Delete key on the row last tapped, and undo ---
    await tapCamera(page, c2);
    r = await rows(page);
    t.ok(r.cameras[1].picked || r.cameras[1].active, 'a tapped row is the picked one');
    const trash = await page.evaluate((id) => !!document.querySelector(`[data-camera="${id}"] [data-role=camera-delete]`), c2);
    t.ok(trash, 'with a trash can on it');
    await page.keyboard.press('Delete');
    await frames(page);
    t.eq(await names(page), 'Camera 1', 'Delete takes the row that was last tapped');
    r = await rows(page);
    t.ok(r.working.active, 'and the working view takes over, as the camera in use went');
    t.ok(await page.evaluate(() => window.__sculpt.session.getMeshes().length === 1), 'no object went with it');
    await undo(page);
    t.eq(await names(page), 'Camera 1, Front view', 'undo brings the camera back');
    r = await rows(page);
    t.ok(r.cameras[1].active, 'looked through again, as it was');
    await redo(page);
    t.eq(await names(page), 'Camera 1', 'redo deletes it again');
    await undo(page);
    await tapCamera(page, c1);
    await press(page, `[data-camera="${c1}"] [data-role=camera-delete]`);
    await frames(page);
    t.eq(await names(page), 'Front view', 'the trash can deletes a camera too');
    await undo(page);
    t.eq(await names(page), 'Camera 1, Front view', 'with undo');

    // --- Making one is an undo step, back to where the person was ---
    await tapWorking(page);
    const w = await view(page);
    await makeCamera(page);
    t.eq((await rows(page)).cameras.length, 3, 'a third camera');
    await undo(page);
    r = await rows(page);
    t.ok(r.cameras.length === 2 && r.working.active, 'undo takes it away and the working view is back');
    t.ok(same(await view(page), w), 'where it was');
    await redo(page);
    t.eq((await rows(page)).cameras.length, 3, 'redo makes it again');

    t.eq(errors.length, 0, `no page errors (${errors.join('; ')})`);
  },

  async camerasLock(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await openPanel(page, 'Scene');
    const dev = await devices(page);
    await page.keyboard.press('f');
    await settle(page);
    const empty = await emptySpot(page);
    await orbit(page, empty, 80);
    await makeCamera(page);
    const id = (await rows(page)).cameras[0].id;
    await press(page, `[data-camera="${id}"] [data-role=camera-lock]`);
    await frames(page);
    t.ok((await rows(page)).cameras[0].locked, 'the camera is locked');
    const locked = await view(page);
    const stays = async (what) => {
      await frames(page, 3);
      const v = await view(page);
      t.ok(gap(v, locked) < dist(locked) * 1e-6 && v.lens === locked.lens, `${what}: the view stays (${fmt(locked)}, now ${fmt(v)})`);
    };

    await clearToasts(page);
    await orbit(page, empty, 120);
    await stays('a mouse orbit');
    t.eq(await hints(page), 1, 'the first blocked try says the camera is locked, in the quiet status place');
    await page.mouse.move(...empty);
    await page.mouse.wheel(0, -400);
    await stays('the wheel');
    await page.mouse.wheel(0, 400);
    await stays('the wheel out');
    t.eq(await hints(page), 1, 'a second try a moment later does not say it again');
    // A right drag zooms and a middle drag pans.
    await page.mouse.move(...empty);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(empty[0], empty[1] - 80, { steps: 3 });
    await page.mouse.up({ button: 'right' });
    await stays('a right drag');
    await page.mouse.move(...empty);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(empty[0] + 60, empty[1], { steps: 3 });
    await page.mouse.up({ button: 'middle' });
    await stays('a middle drag');
    // A pinch.
    await dev.pair(line([empty[0] - 20, empty[1]], [empty[0] - 80, empty[1]], 3), line([empty[0] + 20, empty[1]], [empty[0] + 80, empty[1]], 3));
    await stays('a pinch');
    // A finger orbit.
    await dev.finger(line(empty, [empty[0] + 100, empty[1]], 4));
    await stays('a finger orbit');
    // F, A, P.
    await page.keyboard.press('f');
    await stays('F');
    await page.keyboard.press('a');
    await stays('A');
    await page.keyboard.press('p');
    await stays('P (the projection)');
    // The turntable keys.
    await page.keyboard.press('ArrowLeft');
    await stays('an arrow key turn');
    // The Shift snap.
    await page.mouse.move(...empty);
    await page.mouse.down();
    await page.mouse.move(empty[0] + 4, empty[1], { steps: 2 });
    await page.keyboard.down('Shift');
    await page.mouse.move(empty[0] + 90, empty[1], { steps: 4 });
    await frames(page, 3);
    t.ok(!(await page.evaluate(() => !!document.querySelector('.view-snap:not([hidden])'))), 'the Shift snap shows no label');
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await stays('the Shift snap');
    // Before the hint's gap is over, no second notice; after a wait, one more.
    t.eq(await hints(page), 1, 'all of it said so once');
    await sleep(4500);
    await clearToasts(page);
    await page.mouse.move(...empty);
    await page.mouse.wheel(0, -200);
    await frames(page, 2);
    t.eq(await hints(page), 1, 'and again once a few seconds have passed');

    // A stroke still lands through a locked camera.
    const s = await page.evaluate(() => {
      const { session, viewer } = window.__sculpt;
      viewer.camera.updateMatrixWorld();
      const b = session.getMesh().computeWorldBound();
      const c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      const r = viewer.captureCanvas.getBoundingClientRect();
      const pr = session.getPixelRatio();
      const [x, y] = session.getCamera().project(c);
      return [r.left + x / pr, r.top + y / pr];
    });
    const strokes = await strokeCount(page);
    await page.mouse.move(s[0] - 20, s[1]);
    await page.mouse.down();
    await page.mouse.move(s[0] + 20, s[1] + 8, { steps: 4 });
    await page.mouse.up();
    await frames(page, 2);
    t.ok((await strokeCount(page)) > strokes, 'a stroke on the model still lands');
    await stays('and the stroke');

    // Present's turntable is refused the same way.
    await page.evaluate(() => window.__sculpt.present.enter());
    await page.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 8000 });
    await clearToasts(page);
    await sleep(4200);
    await page.evaluate(() => window.__sculpt.present.setTurning(true));
    await frames(page, 3);
    t.ok(!(await page.evaluate(() => window.__sculpt.present.isTurning())), 'the turntable does not start while a locked camera is in use');
    t.eq(await hints(page), 1, 'and says why');
    await stays('the turntable');
    await page.evaluate(() => window.__sculpt.studio.go('sculpt'));
    await page.waitForFunction(() => !document.body.classList.contains('presenting'), null, { timeout: 15_000 });

    // Working view frees it.
    await page.screenshot({ path: `${SHOTS}/scene-locked-in-use.png` });
    await tapWorking(page);
    t.ok(!(await page.evaluate(() => window.__sculpt.viewer.isViewLocked())), 'Working view frees the view');
    const before = await view(page);
    await orbit(page, empty, 90);
    t.ok(!same(before, await view(page)), 'and an orbit moves it again');
    t.eq(errors.length, 0, `no page errors (${errors.join('; ')})`);
  },

  async camerasRefs(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await openPanel(page, 'Scene');
    await page.keyboard.press('f');
    await settle(page);
    const empty = await emptySpot(page);
    await openPanel(page, 'Reference');
    const ref = await addPicture(page, '#d02020', 'Front.png');
    await page.evaluate((id) => window.__sculpt.reference.board.putInView(id), ref);
    await page.evaluate(() => window.__sculpt.reference.board.setArranging(false));
    await frames(page, 3);
    const shown = () => page.evaluate(() => window.__sculpt.reference.view.describe().pictures.map((p) => p.name).join());
    t.eq(await shown(), 'Front', 'a picture in the view shows');
    await openPanel(page, 'Scene');
    await orbit(page, empty, 60);
    await makeCamera(page);
    const c1 = (await rows(page)).cameras[0].id;
    await tapWorking(page);
    await openPanel(page, 'Reference');
    const select = (id) => `.panel--reference .ref-card[data-id="${id}"] [data-role=ref-camera]`;
    const opts = await page.evaluate((s) => [...document.querySelector(s).options].map((o) => o.textContent), select(ref));
    t.eq(opts.join('|'), 'Camera: none|Camera: Camera 1', 'a card has a Camera select: none, or one of the cameras');
    await page.selectOption(select(ref), c1);
    await frames(page, 3);
    t.eq(await page.evaluate((id) => window.__sculpt.session.cameras.cameraOf(id), ref), c1, 'choosing a camera ties the picture to it');
    t.eq(await shown(), '', 'tied, the picture is not in the view while the working view is');
    await page.screenshot({ path: `${SHOTS}/reference-card-camera.png` });
    await tapCamera(page, c1).catch(async () => {
      await openPanel(page, 'Scene');
      await tapCamera(page, c1);
    });
    await frames(page, 3);
    t.eq(await shown(), 'Front', 'it shows while that camera is in use');
    await openPanel(page, 'Scene');
    await tapWorking(page);
    await frames(page, 3);
    t.eq(await shown(), '', 'and goes again with the working view');

    // One tap on Match view goes to that camera.
    await openPanel(page, 'Reference');
    await page.evaluate((id) => document.querySelector(`.panel--reference .ref-card[data-id="${id}"] .ref-act--match`).click(), ref);
    await frames(page, 3);
    t.eq(await page.evaluate(() => window.__sculpt.session.cameras.inUse()), c1, 'Match view on a tied card goes to its camera');
    t.eq(await shown(), 'Front', 'and the picture shows');
    // Undo of the tie, and None.
    await page.selectOption(select(ref), '');
    await frames(page, 3);
    t.eq(await page.evaluate((id) => window.__sculpt.session.cameras.cameraOf(id), ref), null, 'None unties it');
    await undo(page);
    t.eq(await page.evaluate((id) => window.__sculpt.session.cameras.cameraOf(id), ref), c1, 'undo ties it again');
    await page.selectOption(select(ref), '');
    await frames(page, 3);

    // A picture with a saved view: "Make a camera of this view".
    await openPanel(page, 'Scene');
    await tapWorking(page);
    await orbit(page, empty, -70);
    const saved = await view(page);
    await openPanel(page, 'Reference');
    await page.evaluate(() => {
      const b = window.__sculpt.reference.board;
      b.setArranging(true);
      b.setArranging(false); // locking keeps the view with each picture in the view
    });
    await frames(page, 2);
    const hasSaved = await page.evaluate((id) => !!window.__sculpt.reference.board.get(id).camera, ref);
    t.ok(hasSaved, 'locking the picture kept the view with it');
    await orbit(page, empty, 100);
    await page.evaluate((id) => document.querySelector(`.panel--reference .ref-card[data-id="${id}"] .ref-act--match`).click(), ref);
    await frames(page, 3);
    t.ok(same(await view(page), { ...saved, lens: saved.lens }) || gap(await view(page), saved) < dist(saved) * 1e-4, 'the old saved view still works: Match view goes there, as before');
    const make = await page.evaluate((id) => !!document.querySelector(`.panel--reference .ref-card[data-id="${id}"] [data-role=ref-make-camera]`), ref);
    t.ok(make, 'the card offers "Make a camera of this view"');
    await page.screenshot({ path: `${SHOTS}/reference-card-make.png` });
    const before = await page.evaluate(() => window.__sculpt.session.cameras.list().length);
    await page.evaluate((id) => document.querySelector(`.panel--reference .ref-card[data-id="${id}"] [data-role=ref-make-camera]`).click(), ref);
    await frames(page, 3);
    const made = await page.evaluate(() => {
      const c = window.__sculpt.session.cameras;
      const cam = c.current();
      return cam ? { locked: cam.locked, reference: cam.reference, position: cam.position, count: c.list().length } : null;
    });
    t.ok(made && made.count === before + 1 && made.locked && made.reference === ref, `it makes a locked camera tied to the picture (${JSON.stringify(made)})`);
    t.ok(made && made.position.every((p, i) => Math.abs(p - saved.position[i]) < dist(saved) * 1e-4), 'at the saved view');
    const kept = await page.evaluate((id) => {
      const i = window.__sculpt.reference.board.get(id);
      return !!i.camera && i.camera.position.length === 3;
    }, ref);
    t.ok(kept, 'and the picture still has its saved view, unchanged');
    t.ok(await page.evaluate((id) => !document.querySelector(`.panel--reference .ref-card[data-id="${id}"] [data-role=ref-make-camera]`), ref), 'the offer goes once it is tied');
    t.eq(errors.length, 0, `no page errors (${errors.join('; ')})`);
  },

  async camerasKept(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await openPanel(page, 'Scene');
    await page.keyboard.press('f');
    await settle(page);
    const empty = await emptySpot(page);
    await openPanel(page, 'Reference');
    const ref = await addPicture(page, '#2040d0', 'Side.png');
    await openPanel(page, 'Scene');
    await orbit(page, empty, 50);
    const w0 = await view(page);
    await makeCamera(page);
    const c1 = (await rows(page)).cameras[0].id;
    await orbit(page, empty, 90);
    await makeCamera(page);
    const c2 = (await rows(page)).cameras[1].id;
    await page.evaluate(([a, b, r]) => {
      const c = window.__sculpt.session.cameras;
      c.rename(b, 'Detail');
      c.setReference(b, r);
      c.setLocked(b, true);
      void a;
    }, [c1, c2, ref]);
    await frames(page);
    const state = () =>
      page.evaluate(() => {
        const c = window.__sculpt.session.cameras;
        return {
          use: c.list().find((x) => x.id === c.inUse())?.name ?? null,
          list: c.list().map((x) => `${x.name}:${x.locked ? 'locked' : 'free'}:${x.reference ? 'tied' : 'none'}:${x.projection}:${x.lens}`).join(' '),
          locked: window.__sculpt.viewer.isViewLocked(),
        };
      });
    const was = await state();
    t.eq(was.use, 'Detail', 'the second camera, renamed, locked and tied, is in use');
    const camView = await view(page);
    await page.screenshot({ path: `${SHOTS}/scene-two-cameras-locked-in-use.png` });

    // The record: version, the one in use, the working view kept with it.
    const rec = await page.evaluate(() => JSON.parse(JSON.stringify(window.__sculpt.session.serializeScene().cameras)));
    t.ok(rec.v === 1 && rec.active === c2 && rec.items.length === 2 && !!rec.working, `the scene's record: version 1, the one in use, the working view (${JSON.stringify(Object.keys(rec))})`);
    const item = rec.items[1];
    t.ok(
      item.id === c2 && item.name === 'Detail' && item.position.length === 3 && item.target.length === 3 && item.up.join() === '0,1,0' && typeof item.lens === 'number' && item.projection === 'perspective' && item.orthoSize > 0 && item.locked === true && item.reference === ref,
      `a camera in it has id, name, position, target, up, lens, projection, orthoSize, locked and the picture's id (${JSON.stringify(item)})`,
    );
    t.ok(!JSON.stringify(rec).includes('data:') && !('blob' in item), 'and nothing of the picture but its id');

    // A reload (the autosave).
    await page.evaluate(() => window.__sculpt.persist.markDirty());
    await page.evaluate(() => window.__sculpt.persist.flush());
    await page.goto(`${base}/?sculpt=1&q=low&start=sphere`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await openPanel(page, 'Scene');
    await frames(page, 3);
    let now = await state();
    t.eq(JSON.stringify(now), JSON.stringify(was), `a reload brings back the cameras, the lock, the tie and the one in use (${JSON.stringify(now)})`);
    t.ok(gap(await view(page), camView) < dist(camView) * 1e-4, 'and the view stands at the camera in use');
    t.eq(await names(page), 'Camera 1, Detail', 'with its rows');
    await tapWorking(page);
    t.ok(gap(await view(page), w0) < dist(w0) * 1e-4, `Working view still goes to where the person was before (${fmt(w0)}, now ${fmt(await view(page))})`);
    await tapCamera(page, (await rows(page)).cameras[1].id);

    // A .bozz file: without pictures, then with them.
    const bytes = await page.evaluate(async () => {
      const b = await window.__sculpt.file.pack();
      return Array.from(new Uint8Array(b));
    });
    await page.evaluate(() => window.__sculpt.session.cameras.reset());
    t.eq(await names(page), '', 'cleared');
    await page.evaluate(async (arr) => {
      await window.__sculpt.file.open(new Uint8Array(arr).buffer);
    }, bytes);
    await frames(page, 3);
    now = await state();
    t.eq(JSON.stringify(now), JSON.stringify(was), `Save file and open: the cameras, the lock, the tie and the one in use come back (${JSON.stringify(now)})`);
    const lockedBlocked = await page.evaluate(() => window.__sculpt.viewer.isViewLocked());
    t.ok(lockedBlocked, 'and the opened scene is locked through the camera in use');
    // With pictures: the tie finds its picture by id.
    const withPics = await page.evaluate(async () => {
      const b = await window.__sculpt.fileActions.packFile(true);
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    });
    await page.evaluate(() => window.__sculpt.reference.board.replace([]));
    await page.evaluate(async (arr) => {
      await window.__sculpt.fileActions.replaceWith(new Uint8Array(arr).buffer);
    }, withPics);
    await frames(page, 4);
    const tie = await page.evaluate(() => {
      const b = window.__sculpt.reference.board;
      const c = window.__sculpt.session.cameras;
      const pic = b.list()[0];
      return { pic: !!pic, tied: pic ? c.cameraOf(pic.id) === c.inUse() && c.inUse() !== null : false };
    });
    t.ok(tie.pic && tie.tied, `Save file with pictures: the picture comes back tied to its camera (${JSON.stringify(tie)})`);

    // A file from before cameras opens with none.
    const old = await page.evaluate(async () => {
      const s = window.__sculpt;
      const rec = s.session.serializeScene();
      delete rec.cameras;
      const bytes = await s.file.packRecord(rec);
      await s.file.open(bytes);
      return { count: s.session.cameras.list().length, locked: s.viewer.isViewLocked(), inUse: s.session.cameras.inUse() };
    });
    t.ok(old.count === 0 && !old.locked && old.inUse === null, `a scene with no cameras opens with none and a free view (${JSON.stringify(old)})`);
    t.ok((await rows(page)).hidden, 'and no Cameras group');

    // A record from outside, damaged: what is not a camera is left out, the scene still opens.
    const odd = await page.evaluate(async () => {
      const s = window.__sculpt;
      const rec = s.session.serializeScene();
      rec.cameras = { v: 1, active: 'nope', items: [{ id: 'a', name: 'Fine', position: [30, 20, 40], target: [0, 10, 0], up: [0, 1, 0], lens: 50, projection: 'perspective', orthoSize: 10, locked: false, reference: null }, { id: 'b', position: [1, 1], target: [0, 0, 0] }, 7] };
      await s.file.open(await s.file.packRecord(rec));
      return { names: s.session.cameras.list().map((c) => c.name), inUse: s.session.cameras.inUse() };
    });
    t.ok(odd.names.join() === 'Fine' && odd.inUse === null, `a damaged record opens with the cameras it can read (${JSON.stringify(odd)})`);

    // A new scene has none.
    await page.evaluate(() => window.__sculpt.session.cameras.make());
    await frames(page);
    t.eq((await rows(page)).cameras.length, 2, 'one more made');
    await page.evaluate(() => window.__sculpt.session.newScene({ sphere: true }));
    await frames(page, 3);
    t.ok((await rows(page)).hidden && !(await page.evaluate(() => window.__sculpt.viewer.isViewLocked())), 'a new scene has no cameras and a free view');
    t.eq(errors.length, 0, `no page errors (${errors.join('; ')})`);
  },
};
