// The channel box (sculpt/ui/ChannelBox.ts): the Tool panel's Translate,
// Rotate and Scale rows while the Select tool or a gizmo is up. A fresh
// sphere's values; values following a matrix set as a gizmo drag would
// (live, without a refresh call); a typed value setting the matrix as one
// undo step, Tab moving on, Escape cancelling, a zero scale refused and the
// arrow keys nudging; several objects selected, a shared value showing and
// a differing one blank, a typed value set on them all; the box only for
// the Select tool and the gizmo; hidden with the chrome and in Present.
import { openSculpt } from './lib.mjs';
import { openPanel } from './smoke.mjs';

const frames = (page, n = 2) =>
  page.evaluate(
    (count) =>
      new Promise((ok) => {
        let left = count;
        const step = () => (--left <= 0 ? ok() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    n,
  );

/** The fields as the page shows them (no refresh forced): tx ty tz rx ry rz sx sy sz. */
const shown = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('.panel--sculpt .channel-box');
    return box ? [...box.querySelectorAll('.channel-box__value')].map((i) => i.value) : null;
  });

const field = (ch) => `.panel--sculpt .channel-box__row[data-channel="${ch}"] .channel-box__value`;

/** The active object's matrix, rounded for comparisons. */
const matrixOf = (page, name) =>
  page.evaluate((n) => {
    const { session } = window.__sculpt;
    const m = n ? session.getMeshes().find((x) => session.getMeshName(x) === n) : session.getMesh();
    return [...m.getMatrix()].map((v) => Math.round(v * 1e5) / 1e5);
  }, name);

const undoDepth = (page) =>
  page.evaluate(() => {
    const sm = window.__sculpt.session.getStateManager();
    return sm._curUndoIndex;
  });

/**
 * A column-major TRS matrix: t in centimetres, a rotation of `deg` about Z, and
 * scale s, as the gizmo leaves one.
 */
const trsZ = (t, deg, s) => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const n = Math.sin(r);
  return [c * s[0], n * s[0], 0, 0, -n * s[1], c * s[1], 0, 0, 0, 0, s[2], 0, t[0], t[1], t[2], 1];
};

const setMatrix = (page, name, m) =>
  page.evaluate(
    ([n, mat]) => {
      const { session } = window.__sculpt;
      const mesh = session.getMeshes().find((x) => session.getMeshName(x) === n);
      mesh.getMatrix().set(mat);
      session.onActiveMeshChange?.();
    },
    [name, m],
  );

const type = async (page, ch, text, key = 'Enter') => {
  await page.click(field(ch));
  await page.keyboard.press('Control+a');
  await page.keyboard.type(text);
  await page.keyboard.press(key);
  await frames(page);
};

export const suites = {
  async channelBox(page, base, t) {
    await openSculpt(page, base);
    await page.waitForFunction(() => !document.getElementById('overlay'), null, { timeout: 30_000 });
    await page.evaluate(() => document.querySelector('.panel--sculpt')?.offsetHeight);
    await openPanel(page, 'Tool');

    // Brushes: no box. The Select tool and every gizmo: the box.
    const which = async () =>
      page.evaluate(() => ({ mode: window.__sculpt.input.uiMode(), box: !!document.querySelector('.panel--sculpt .channel-box') }));
    const brush = await which();
    t.ok(brush.mode === 'brush' && !brush.box, `a brush shows no channel box (${JSON.stringify(brush)})`);
    const seen = [];
    // T toggles the unified gizmo, so it goes in from a brush, not from R.
    for (const key of ['q', 'w', 'e', 'r', '1', 't']) {
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.keyboard.press(key);
      await frames(page);
      const w = await which();
      if (key !== '1') seen.push(`${key}:${w.mode}:${w.box}`);
    }
    t.eq(seen.join(' '), 'q:select:true w:transform:true e:transform:true r:transform:true t:transform:true', 'Q, W, E, R and T all show it');
    await page.evaluate(() => window.__sculpt.input.selectBrush(window.__sculpt.input.currentToolIndex()));
    await frames(page);
    const back = await which();
    t.ok(back.mode === 'brush' && !back.box, `back on a brush it goes (${JSON.stringify(back)})`);

    // The fresh sphere, through the Select tool.
    await page.evaluate(() => window.__sculpt.input.enterSelect());
    await frames(page);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.panel--sculpt .channel-box__row')].map(
        (r) => `${r.querySelector('.channel-box__label').textContent}|${r.querySelector('.channel-box__unit').textContent}`,
      ),
    );
    t.eq(
      rows.join(', '),
      'Translate X|cm, Translate Y|cm, Translate Z|cm, Rotate X|°, Rotate Y|°, Rotate Z|°, Scale X|, Scale Y|, Scale Z|',
      'nine rows, Translate, Rotate, Scale, in cm and degrees on real units',
    );
    // A fresh sphere (owner decisions): built at its real 25 cm in its
    // vertices, so its matrix is the lift alone: centred on X and Z, its
    // origin its centre, half its 25 cm up, unturned, at scale 1.
    const fresh = await shown(page);
    t.eq(fresh?.join(' '), '0 12.5 0 0 0 0 1 1 1', 'a fresh sphere reads Translate 0 12.5 0, Rotate 0 0 0, Scale 1 1 1');

    // As a gizmo drag leaves a matrix: moved, turned about Z, scaled
    // unevenly. The fields follow on their own within a frame or two.
    await setMatrix(page, 'Sphere', trsZ([10, 20, -5], 30, [2, 1, 0.5]));
    await frames(page, 3);
    t.eq((await shown(page))?.join(' '), '10 20 -5 0 0 30 2 1 0.5', 'a move, a turn and an uneven scale show live');

    // A typed value: the matrix takes it, the other channels stay, one undo
    // step reverts it and redo brings it back.
    const before = await matrixOf(page);
    const depth = await undoDepth(page);
    await type(page, 'tx', '12.5');
    const typed = await matrixOf(page);
    t.ok(Math.abs(typed[12] - 12.5) < 1e-5, `Translate X 12.5 sets the matrix to 12.5 units, a unit a centimetre (${typed[12]})`);
    t.ok(typed.every((v, i) => i === 12 || Math.abs(v - before[i]) < 1e-4), 'and nothing else in it');
    t.eq(await undoDepth(page), depth + 1, 'one undo step');
    t.eq(await page.evaluate(() => document.activeElement?.classList.contains('channel-box__value')), false, 'Enter commits and lets go of the field');
    await page.evaluate(() => window.__sculpt.session.undo());
    await frames(page, 3);
    const undone = await matrixOf(page);
    t.ok(undone.every((v, i) => Math.abs(v - before[i]) < 1e-5), 'undo puts the matrix back in one step');
    t.eq((await shown(page))?.[0], '10', 'and the field follows');
    await page.evaluate(() => window.__sculpt.session.redo());
    await frames(page, 3);
    t.eq((await shown(page))?.[0], '12.5', 'redo brings it back');

    // Rotate and scale typed, in degrees and as a factor.
    await type(page, 'rx', '45');
    await type(page, 'sy', '3');
    t.eq((await shown(page))?.join(' '), '12.5 20 -5 45 0 30 2 3 0.5', 'Rotate X 45 and Scale Y 3 land, the rest kept');
    // Zero is refused, as is anything that is not a number.
    const d0 = await undoDepth(page);
    await type(page, 'sz', '0');
    await type(page, 'sx', 'abc');
    t.ok((await shown(page))?.slice(6).join(' ') === '2 3 0.5' && (await undoDepth(page)) === d0, 'a zero scale and a non-number are refused, nothing recorded');

    // Tab commits and moves to the next field; Escape cancels.
    await page.click(field('tx'));
    await page.keyboard.press('Control+a');
    await page.keyboard.type('1');
    await page.keyboard.press('Tab');
    await frames(page);
    const tabbed = await page.evaluate(() => document.activeElement?.closest('.channel-box__row')?.dataset.channel ?? null);
    const chromeAfterTab = await page.evaluate(() => document.body.classList.contains('chrome-hidden'));
    t.ok(tabbed === 'ty' && !chromeAfterTab, `Tab commits and moves to Translate Y, the interface stays (${tabbed})`);
    t.eq((await shown(page))?.[0], '1', 'the value Tab left behind was set');
    const d1 = await undoDepth(page);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('99');
    await page.keyboard.press('Escape');
    await frames(page);
    t.ok((await shown(page))?.[1] === '20' && (await undoDepth(page)) === d1, 'Escape cancels a typed value');

    // Arrows nudge, Shift by ten, a step each.
    await page.click(field('tz'));
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Escape');
    await frames(page);
    t.ok((await shown(page))?.[2] === '6' && (await undoDepth(page)) === d1 + 2, `ArrowUp nudges a centimetre, Shift ten, an undo step each (${(await shown(page))?.[2]})`);

    // Several objects: a value they share shows, one that differs is blank;
    // a typed value is set on all, each keeping its own other channels.
    await page.evaluate(() => window.__sculpt.session.addPrimitive('cube'));
    await setMatrix(page, 'Sphere', trsZ([10, 5, 0], 0, [1, 1, 1]));
    await setMatrix(page, 'Cube', trsZ([-20, 5, 30], 0, [1, 1, 1]));
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.selectSet(['Sphere', 'Cube'].map((n) => session.getMeshes().find((m) => session.getMeshName(m) === n)));
    });
    await frames(page, 3);
    const multi = await shown(page);
    const ph = await page.evaluate((sel) => document.querySelector(sel).placeholder, field('tx'));
    t.ok(multi?.[0] === '' && multi[1] === '5' && multi[2] === '' && ph === 'mixed', `differing X and Z blank ("${ph}"), a shared Y of 5 shows (${multi?.join(' ')})`);
    const dm = await undoDepth(page);
    await type(page, 'tx', '7');
    const [sph, cube] = [await matrixOf(page, 'Sphere'), await matrixOf(page, 'Cube')];
    t.ok(Math.abs(sph[12] - 7) < 1e-5 && Math.abs(cube[12] - 7) < 1e-5, 'Translate X 7 lands on both');
    t.ok(Math.abs(sph[14]) < 1e-5 && Math.abs(cube[14] - 30) < 1e-5, 'each keeps its own Z');
    t.eq(await undoDepth(page), dm + 1, 'one undo step for both');
    await page.evaluate(() => window.__sculpt.session.undo());
    const [sph2, cube2] = [await matrixOf(page, 'Sphere'), await matrixOf(page, 'Cube')];
    t.ok(Math.abs(sph2[12] - 10) < 1e-5 && Math.abs(cube2[12] + 20) < 1e-5, 'which undo takes back from both');

    // Hidden with the chrome (Tab's), and in Present mode, like the panel.
    const visible = () =>
      page.evaluate(() => {
        const box = document.querySelector('.panel--sculpt .channel-box');
        return !!box && getComputedStyle(box).visibility === 'visible';
      });
    t.ok(await visible(), 'the box shows in the open Tool panel');
    await page.evaluate(() => window.__sculpt.chrome.set(true));
    await frames(page);
    const chromeHidden = await visible();
    await page.evaluate(() => window.__sculpt.chrome.set(false));
    await frames(page);
    t.ok(!chromeHidden && (await visible()), 'hidden with the chrome, back with it');
    await page.evaluate(() => window.__sculpt.present.toggle());
    await frames(page, 3);
    const presenting = await visible();
    await page.evaluate(() => window.__sculpt.present.toggle());
    await frames(page, 3);
    t.ok(!presenting, 'hidden in Present mode');
    t.ok(await page.evaluate(() => window.__sculpt.input.uiMode() === 'select'), 'and the Select tool, box and all, back after');

    // Set scale folds the scale into the vertices: the box reads Scale 1
    // and the object's real centimetres after it.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const sphere = session.getMeshes().find((m) => session.getMeshName(m) === 'Sphere');
      session.setUnits(null); // a scene from before real units
      session.setMesh(sphere);
      window.__sculpt.setScale(sphere, 40);
    });
    await frames(page, 3);
    const afterSet = await shown(page);
    t.ok(afterSet?.slice(6).join(' ') === '1 1 1' && afterSet.slice(3, 6).join(' ') === '0 0 0', `after Set scale the sphere reads Scale 1 1 1, its turn kept (${afterSet?.join(' ')})`);

    // A scene saved in metres opens converted, every scale folded in.
    const bytes = await page.evaluate(async () => {
      const { session, file, fileActions } = window.__sculpt;
      await fileActions.newScene();
      const rec = await file.unpack(await file.pack());
      for (const m of rec.meshes) for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) m.matrix[c * 4 + r] /= 100;
      rec.units = 'm';
      void session;
      return Array.from(new Uint8Array(await file.packRecord(rec)));
    });
    await page.evaluate(async (b) => {
      await window.__sculpt.file.open(new Uint8Array(b).buffer);
      window.__sculpt.input.enterSelect();
    }, bytes);
    await frames(page, 3);
    t.eq((await shown(page))?.join(' '), '0 12.5 0 0 0 0 1 1 1', 'a sphere saved in metres opens reading 0 12.5 0, 0 0 0, 1 1 1');
  },
};
