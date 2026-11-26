// The page's one shell (src/studio/Studio.ts, step A of docs/plans/armature-workspace.md).
// Nothing a person sees changed when the Sculpt page and Armature's page moved onto it, so
// this suite is about what is now true of the structure:
// - the page has exactly one title strip, one edge column, one Material panel, one Reference
//   panel, one details overlay and one set of four menus, in Armature as in Sculpt (step C: Armature
//   is a workspace of the Sculpt page, loaded on first use);
// - the menus' items come from the workspace in front: Sculpt, Paint and Present are
//   switched through the shell and File, Edit and View are read each time;
// - the path and the readout follow the one in front;
// - only the workspace in front claims its keys (Armature's chords are nobody's on the Sculpt
//   page; Armature's are its own running and nobody's put away);
// - a switch builds nothing: the scene, the objects and the page's pieces stay as they were;
// - the shell is disposed with the page's mode and builds again.
import { openArmature, openSculpt } from './lib.mjs';
import { SCULPT_FILE, SCULPT_VIEW, checkShape, readMenus } from './menuShape.mjs';

const SHELL_PIECES = ['.bz-strip', '.bz-edge', '.panel--material', '.panel--reference', '.bz-details', '.ref-layer'];

/** How many of each piece of the shell the page has. */
const piecesOf = (page) =>
  page.evaluate(
    (sels) => Object.fromEntries([...sels, '.bz-menuname', '.sculpt-hist'].map((s) => [s, document.querySelectorAll(s).length])),
    SHELL_PIECES,
  );

/** What a switch must leave alone: the scene's contents and the objects. */
const buildOf = (page) =>
  page.evaluate(() => {
    const s = window.__sculpt;
    return {
      scene: window.__bozzetto.scene.children.length,
      objects: s.session.getMeshes().length,
      tris: s.session.getMesh().getNbTriangles(),
      verts: s.session.getMeshes().map((m) => m.getNbVertices()).join(','),
    };
  });

const claimed = (seen) => seen.length === 0 || seen.some(Boolean);
/** A key on the page; what a listener of the test's own on the window (bubble phase) saw of it. */
const pressSeen = async (page, key, opts = {}) => {
  await page.evaluate(() => {
    window.__seen = [];
    window.__seenOn ??= (() => {
      window.addEventListener('keydown', (e) => window.__seen.push(e.defaultPrevented));
      return true;
    })();
  });
  const mods = [];
  if (opts.shift) mods.push('Shift');
  if (opts.ctrl) mods.push('Control');
  for (const m of mods) await page.keyboard.down(m);
  await page.keyboard.press(key);
  for (const m of mods.reverse()) await page.keyboard.up(m);
  return page.evaluate(() => window.__seen.slice());
};

const labels = (rows) => rows.filter((r) => !r.sep).map((r) => r.label).join('|');
const stepOn = (page) => page.evaluate(() => document.querySelector('.bz-ws__step--on')?.dataset.workspace ?? null);

export const suites = {
  async studioShell(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    // ---- the Sculpt page --------------------------------------------------------------------
    await openSculpt(page, base);
    const first = await piecesOf(page);
    t.ok(
      SHELL_PIECES.every((s) => first[s] === 1) && first['.bz-menuname'] === 4 && first['.sculpt-hist'] === 1,
      `Sculpt: one strip, one edge column, one Material panel, one Reference panel, one details overlay, one reference view, four menus, one pair of history buttons (${JSON.stringify(first)})`,
    );
    t.eq(
      await page.evaluate(() => [window.__sculpt.studio.now(), window.__sculpt.studio.hosted().join(',')].join(' ')),
      'sculpt armature,sculpt,paint,present',
      'Sculpt: the shell hosts the four workspaces, with Sculpt in front',
    );
    t.ok(
      await page.evaluate(() => window.__sculpt.studio.edge.el.classList.contains('sculpt-sliders') && window.__sculpt.studio.edge.el === document.querySelector('.bz-edge')),
      "Sculpt: the brush rail stands in the shell's edge column",
    );
    t.ok(
      await page.evaluate(() => window.__sculpt.reference.board === window.__sculpt.studio.reference.board && window.__sculpt.materialPanel === window.__sculpt.studio.material),
      "Sculpt: the reference board and the Material panel are the shell's",
    );

    // The menus' items come from the workspace in front.
    const before = await buildOf(page);
    const files = [];
    const edits = [];
    for (const [id, key] of [
      ['sculpt', null],
      ['paint', 'Shift+3'],
      ['present', 'Shift+4'],
      ['sculpt', 'Shift+2'],
    ]) {
      if (key) {
        await page.keyboard.press(key);
        await page.waitForFunction((want) => window.__sculpt.studio.now() === want, id, { timeout: 8000 });
      }
      t.eq(await stepOn(page), id, `Sculpt: ${id} is lit in the path`);
      const menus = await readMenus(page);
      files.push(labels(menus.File));
      edits.push(labels(menus.Edit));
      checkShape(t, `Sculpt page, ${id}`, menus, { names: 'File,Edit,View,Help', file: SCULPT_FILE, view: SCULPT_VIEW[id] });
      const readout = await page.evaluate(() => document.querySelector('.bz-readout__name')?.textContent ?? '');
      t.ok(readout.length > 0, `Sculpt page, ${id}: the readout shows the scene's name (${readout})`);
    }
    t.ok(new Set(files).size === 1 && new Set(edits).size === 1, 'File and Edit are the same in the three workspaces of the Sculpt page');
    t.eq(JSON.stringify(await piecesOf(page)), JSON.stringify(first), 'after the switches there is still one of each piece and the same four menus');
    t.eq(JSON.stringify(await buildOf(page)), JSON.stringify(before), 'a switch builds nothing: the scene, the objects and their size are as they were');

    // Every step is the shell's own `go`: it hosts all four.
    const way = await page.evaluate(() => {
      const w = window.__sculpt.studio.way();
      return { current: w.current, steps: Object.fromEntries(Object.entries(w.steps).map(([k, v]) => [k, 'action' in v])) };
    });
    t.eq(JSON.stringify(way), JSON.stringify({ current: 'sculpt', steps: { armature: true, paint: true, present: true } }), 'the path from Sculpt has a step to every other workspace');
    t.ok(!(await page.evaluate(() => window.__sculpt.studio.go('sculpt'))), 'asking for the workspace in front changes nothing');

    // The controller moving by itself (the console's calls) is followed by the shell.
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    t.eq(await page.evaluate(() => window.__sculpt.studio.now()), 'paint', 'the shell follows Paint entered by the console');
    await page.evaluate(() => window.__sculpt.present.enter());
    t.eq(await page.evaluate(() => [window.__sculpt.studio.now(), document.querySelector('.bz-ws__step--on')?.dataset.workspace].join(' ')), 'present present', 'and Present entered from Paint');
    await page.evaluate(() => window.__sculpt.present.leave());
    t.eq(await page.evaluate(() => window.__sculpt.studio.now()), 'paint', 'Present left lands on Paint, where it began');
    await page.evaluate(() => window.__sculpt.paintWorkspace.leave());
    t.eq(await page.evaluate(() => window.__sculpt.studio.now()), 'sculpt', 'and Paint left on Sculpt');

    // Only the workspace in front claims its keys: Armature's are nobody's here.
    const resetPose = await pressSeen(page, 'r', { shift: true });
    const send = await pressSeen(page, 'Enter', { ctrl: true });
    t.ok(!claimed(resetPose) && !claimed(send), "on the Sculpt page Armature's keys (Shift+R, Ctrl+Enter) are not claimed");
    t.eq(await page.evaluate(() => location.search.includes('armature')), false, 'and Ctrl+Enter did not send anything');

    // ---- Armature, on the same page -----------------------------------------------------------
    await openArmature(page, base);
    await page.waitForTimeout(500);
    const arm = await piecesOf(page);
    t.ok(
      SHELL_PIECES.every((s) => arm[s] === 1) && arm['.bz-menuname'] === 4 && arm['.sculpt-hist'] === 1,
      `Armature: still one strip, one edge column, one Material panel, one Reference panel, one details overlay, one reference view, four menus (${JSON.stringify(arm)})`,
    );
    t.eq(await page.evaluate(() => [window.__armature.studio.now(), window.__armature.studio.hosted().join(',')].join(' ')), 'armature armature,sculpt,paint,present', 'Armature: the shell hosts the four, with Armature in front');
    t.ok(await page.evaluate(() => window.__armature.reference.board === window.__armature.studio.reference.board && window.__armature.studio === window.__sculpt.studio), "Armature: the shell and the reference board are the page's");
    const armMenus = await readMenus(page);
    checkShape(t, 'Armature', armMenus, {
      names: 'File,Edit,View,Help',
      file: 'New armature|Open…|Open recent|Rename…|Save file|Load model…|Remesh to a figure|Close',
      view: 'Frame all|Wireframe|Shadows|Details|Move light|Proportion guide|References|Arrange references|Armature panel|Material panel|Reference panel|Hide interface|Armature|Sculpt|Paint|Present',
      edit: 'Undo|Redo|Paste picture|Preferences…',
    });
    t.eq(await stepOn(page), 'armature', 'Armature: Armature is lit in the path');
    const armWay = await page.evaluate(() => {
      const w = window.__armature.studio.way();
      return Object.fromEntries(Object.entries(w.steps).map(([k, v]) => [k, 'action' in v ? 'action' : v.unavailable]));
    });
    t.eq(JSON.stringify(armWay), JSON.stringify({ sculpt: 'action', paint: 'action', present: 'action' }), "Armature's path: a step to every other workspace, none refused");

    // Its keys are its own running, and nobody's while it is away.
    t.ok(claimed(await pressSeen(page, 'x')), "running, X is Armature's (claimed)");
    await page.keyboard.press('x'); // twice is a wash
    await page.keyboard.press('Shift+2');
    await page.waitForFunction(() => window.__sculpt.studio.now() === 'sculpt', null, { timeout: 8000 });
    t.ok(!claimed(await pressSeen(page, 'r', { shift: true })) && !claimed(await pressSeen(page, 'Enter', { ctrl: true })), "in Sculpt, Armature's keys (Shift+R, Ctrl+Enter) are nobody's again");
    t.eq(JSON.stringify(await piecesOf(page)), JSON.stringify(arm), 'switching Armature away leaves the pieces one of each (put away, not built again)');
    await page.keyboard.press('Shift+1');
    await page.waitForFunction(() => window.__sculpt.studio.now() === 'armature' && !window.__armature.isSuspended(), null, { timeout: 8000 });
    t.ok(claimed(await pressSeen(page, 'x')), "back in Armature, X is Armature's again");
    await page.keyboard.press('x');
    // The tests' hook puts the whole shell to sleep, as step B built it.
    await page.evaluate(() => window.__armature.suspend());
    t.ok(await page.evaluate(() => window.__armature.studio.isAsleep()), 'suspend() puts the shell to sleep with it');
    await page.evaluate(() => window.__armature.resume());
    t.eq(await page.evaluate(() => window.__armature.studio.isAsleep()), false, 'and resume() wakes it');

    // Armature disposed, the page's shell stays; mounted again, one of each.
    await page.evaluate(() => window.__armature.dispose());
    const none = await piecesOf(page);
    t.eq(JSON.stringify(none), JSON.stringify(arm), "Armature disposed, the page's shell is all still there");
    await page.evaluate(() => window.__armatureMount(window.__bozzetto, window.__sculpt.armatureHost));
    await page.waitForFunction(() => !!window.__armature, null, { timeout: 60_000 });
    await page.waitForTimeout(500);
    const again = await piecesOf(page);
    t.eq(JSON.stringify(again), JSON.stringify(arm), 'mounted again on the same page: one of each, as before');
  },
};
