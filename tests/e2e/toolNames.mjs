// Tools by name (step 1 of docs/plans/asset-library.md): the tools have word
// ids (bz.clay) in one table instead of the engine's numbers, the Tool panel
// is built from each tool's list of settings, the number keys follow the
// bar's places, and the scene's brush settings also ride a table by tool id.
// Nothing a person sees or presses changes, bar four settings that now
// survive a reload, a rebound tool key that now shows on the button, and
// Help saying a tool's key is its place on the bar.
//
// toolNames: every tool has an entry with the engine number it always had
//   and the bars' default order is today's; the buttons carry data-tool and
//   data-place; the table's claims (which rows a tool has, strength in cm or
//   a fraction, the starting values of the tools' own knobs) are held to the
//   live engine; and the Tool panel's rows for every tool, built from the
//   table, equal fixtures/tool-panel.json, which was read from the app
//   before the table existed (tests/e2e/recordToolPanel.mjs).
// toolPlaces: the ten number keys pick the tool in that place, in Sculpt and
//   in Paint; a rebind saved under the old per-tool ids carries to the place
//   that tool held and shows on its badge and tip; a rebind made in
//   Preferences shows at once; the hotkey guide and Preferences name the
//   tool in each place.
// toolSettings: a scene saved now carries the numbered tables as before and
//   the table by tool id; an older scene (numbered tables only) opens with
//   its settings, a scene with only the new table opens too; the four
//   settings that were lost on reload survive one; bad keys and values in
//   the new table are dropped.
import { readFileSync } from 'node:fs';
import { openForInput, openPanel } from './smoke.mjs';
import { snapshotToolPanels, SNAPSHOT_TOOLS } from './toolPanelSnapshot.mjs';

const FIXTURE = new URL('./fixtures/tool-panel.json', import.meta.url);

/** The engine numbers the tools have always had, by id (the vendored Enums.Tools). */
const ENGINE = {
  'bz.clay': 0,
  'bz.inflate': 1,
  'bz.polish': 2,
  'bz.smooth': 3,
  'bz.flatten': 4,
  'bz.pinch': 5,
  'bz.crease': 6,
  'bz.drag': 7,
  'bz.paint': 8,
  'bz.move': 9,
  'bz.mask': 10,
  'bz.local-scale': 11,
  'bz.rake': 13,
  'bz.erase': 15,
  'bz.blur': 16,
  'bz.fill': 17,
  'bz.pick': 18,
  'bz.project': 19,
};
const SCULPT_BAR = ['bz.crease', 'bz.move', 'bz.clay', 'bz.inflate', 'bz.pinch', 'bz.flatten', 'bz.rake', 'bz.drag', 'bz.polish'];
const PAINT_BAR = ['bz.paint', 'bz.erase', 'bz.blur', 'bz.fill', 'bz.pick', 'bz.project'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const press = async (page, key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(80);
};

/** The tool in hand, by engine number and by the button that is lit. */
const inHand = (page) =>
  page.evaluate(() => ({
    engine: window.__sculpt.input.currentToolIndex(),
    lit: [...document.querySelectorAll('.sculpt-toolbar__btn--active')].filter((b) => b.dataset.tool && b.offsetParent).map((b) => b.dataset.tool),
  }));

/** The bar as it shows: tool id, place, badge and tip key, for the buttons on screen. */
const bar = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.sculpt-toolbar__brushes .sculpt-toolbar__btn')]
      .filter((b) => b.offsetParent && !b.closest('[hidden]'))
      .map((b) => ({ id: b.dataset.tool, place: b.dataset.place ?? '', badge: b.querySelector('.sculpt-toolbar__key')?.textContent ?? '', tip: b.querySelector('.bz-tip__key')?.textContent ?? '', name: b.querySelector('.bz-tip__name')?.textContent ?? '' })),
  );

/** Boot Sculpt on a fresh page with the keymap (and anything else) stored first. */
async function bootWith(page, base, store = {}) {
  await openForInput(page, base);
  await page.evaluate((st) => {
    for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v);
  }, store);
  await openForInput(page, base);
}

export const suites = {
  async toolNames(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    const reg = await page.evaluate(() => ({
      tools: window.__sculpt.tools.registry.map((d) => ({ id: d.id, engine: d.engine, workspace: d.workspace, kind: d.kind, name: d.name, icon: d.icon, description: d.description, help: d.help, n: d.settings.length })),
      sculpt: [...window.__sculpt.tools.bars.order('sculpt')],
      paint: [...window.__sculpt.tools.bars.order('paint')],
    }));

    // --- one entry per tool, the engine numbers they always had ---
    const ids = new Set(reg.tools.map((d) => d.id));
    const want = [...Object.keys(ENGINE), 'bz.twist', 'bz.select', 'bz.transform', 'bz.calipers'];
    t.ok(want.every((id) => ids.has(id)) && ids.size === want.length, `the table has an entry for each tool the app has, and no other (${[...ids].join(' ')})`);
    t.ok(Object.entries(ENGINE).every(([id, n]) => reg.tools.find((d) => d.id === id)?.engine === n), 'each tool keeps the engine number it always had');
    t.ok(reg.tools.every((d) => d.description.length <= 30), `every one-line description fits 30 characters (${reg.tools.filter((d) => d.description.length > 30).map((d) => d.id).join(' ')})`);
    t.ok(reg.tools.filter((d) => d.kind === 'brush' && d.icon).every((d) => d.workspace), 'a tool with a button belongs to a workspace');
    t.eq(reg.sculpt.join(' '), SCULPT_BAR.join(' '), "Sculpt's bar is today's order");
    t.eq(reg.paint.join(' '), PAINT_BAR.join(' '), "Paint's bar is today's order");

    // --- the table's claims, held to the live engine ---
    const claims = await page.evaluate(() => {
      const S = window.__sculpt;
      const m = S.session.getSculptManager();
      const out = [];
      for (const d of S.tools.registry) {
        if (d.engine === null || d.kind !== 'brush') continue;
        const tool = m.getTool(d.engine);
        const has = (role) => d.settings.some((s) => s.role === role);
        const row = { id: d.id, size: has('size') === (typeof tool._radius === 'number'), strength: has('strength') === (typeof tool._intensity === 'number') };
        // Fill and Pick are a tap: the engine has a radius for them and the panel shows none.
        if (d.id === 'bz.fill' || d.id === 'bz.pick') row.size = row.strength = true;
        S.input.selectBrush(d.engine);
        row.spacing = d.id === 'bz.fill' || d.id === 'bz.pick' ? true : has('spacing') === S.input.hasBrushSpacing();
        const spec = d.settings.find((s) => s.role === 'strength');
        if (spec) {
          const live = S.input.strengthSpec();
          row.cm = (spec.unit === 'cm') === live.cm && spec.max === live.max && spec.limits.max === live.limit && spec.step === live.step;
        }
        row.own = d.settings.filter((s) => s.default !== undefined).every((s) => tool[s.prop] === s.default);
        row.ownWhich = d.settings.filter((s) => s.default !== undefined && tool[s.prop] !== s.default).map((s) => `${s.key}=${tool[s.prop]}`).join();
        out.push(row);
      }
      return out;
    });
    t.ok(claims.every((c) => c.size), `which tools have a size agrees with the engine (${claims.filter((c) => !c.size).map((c) => c.id).join(' ')})`);
    t.ok(claims.every((c) => c.strength), `which tools have a strength agrees with the engine (${claims.filter((c) => !c.strength).map((c) => c.id).join(' ')})`);
    t.ok(claims.every((c) => c.spacing), `which tools have spacing agrees with the engine (${claims.filter((c) => !c.spacing).map((c) => c.id).join(' ')})`);
    t.ok(claims.every((c) => c.cm !== false), `strength in cm or as a fraction, and its travel, agree with the engine (${claims.filter((c) => c.cm === false).map((c) => c.id).join(' ')})`);
    t.ok(claims.every((c) => c.own), `the starting values of the tools' own knobs are the engine's (${claims.map((c) => c.ownWhich).filter(Boolean).join(' ')})`);

    // --- the buttons ---
    await page.evaluate(() => window.__sculpt.input.selectBrush(0));
    const b0 = await bar(page);
    t.eq(b0.map((b) => b.id).join(' '), ['bz.select', ...SCULPT_BAR, 'bz.transform', 'bz.calipers'].join(' '), 'the bar: Select, the brushes in order, Transform, Calipers, each with data-tool');
    t.eq(b0.map((b) => b.place).join(' '), ` ${SCULPT_BAR.map((_, i) => i + 1).join(' ')}  `, 'the brushes carry their place in data-place, and Select, Transform and Calipers none');
    t.eq(b0.map((b) => b.badge).join(' '), `q ${KEYS.slice(0, 9).join(' ')} t c`, 'the badges are the keys the bar always had');
    t.eq(b0.find((b) => b.id === 'bz.clay').name, 'Standard clay', "the tip names Standard clay as it did");

    // --- the panel, from the table, equal to what the app showed before it ---
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const now = await snapshotToolPanels(page);
    const missing = Object.keys(fixture).filter((id) => !now[id]);
    t.ok(!missing.length, `every tool the fixture has is read now${missing.length ? `: missing ${missing.join(' ')}` : ''}`);
    const bad = [];
    for (const [id, lines] of Object.entries(fixture)) {
      const got = now[id] ?? [];
      const n = Math.max(lines.length, got.length);
      for (let i = 0; i < n; i++) {
        if (lines[i] !== got[i]) {
          bad.push(`${id} line ${i}: was ${JSON.stringify(lines[i])}, now ${JSON.stringify(got[i])}`);
          break;
        }
      }
    }
    t.ok(!bad.length, `the Tool panel's rows, labels, ranges and units are the fixture's for all ${Object.keys(fixture).length} tools${bad.length ? `:\n  ${bad.join('\n  ')}` : ''}`);
    t.ok(SNAPSHOT_TOOLS.every(([id]) => fixture[id]), 'and the fixture covers every tool of the table that has a panel');
  },

  async toolPlaces(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await page.evaluate(() => localStorage.removeItem('bozzetto-keymap'));
    await openForInput(page, base);

    // --- Sculpt: the keys follow the places ---
    for (let i = 0; i < SCULPT_BAR.length; i++) {
      await press(page, KEYS[i]);
      const h = await inHand(page);
      t.ok(h.engine === ENGINE[SCULPT_BAR[i]] && h.lit.join() === SCULPT_BAR[i], `in Sculpt ${KEYS[i]} picks place ${i + 1}: ${SCULPT_BAR[i]} (${h.engine}, lit ${h.lit.join()})`);
    }
    const before = (await inHand(page)).engine;
    await press(page, '0');
    t.eq((await inHand(page)).engine, before, 'in Sculpt 0 has no tool in its place and picks nothing');

    // --- Paint: the same keys, the other bar ---
    await press(page, 'Shift+3');
    for (let i = 0; i < PAINT_BAR.length; i++) {
      await press(page, KEYS[i]);
      const h = await inHand(page);
      t.ok(h.engine === ENGINE[PAINT_BAR[i]] && h.lit.join() === PAINT_BAR[i], `in Paint ${KEYS[i]} picks place ${i + 1}: ${PAINT_BAR[i]} (${h.engine}, lit ${h.lit.join()})`);
    }
    const inPaint = (await inHand(page)).engine;
    for (const k of ['7', '8', '9', '0']) await press(page, k);
    t.eq((await inHand(page)).engine, inPaint, 'in Paint the places past the sixth pick nothing');
    t.ok(await page.evaluate(() => window.__sculpt.paintWorkspace.isOn()), 'and Paint is still up');
    const pb = await bar(page);
    t.eq(pb.map((b) => `${b.id}:${b.place}:${b.badge}`).join(' '), ['bz.select::q', ...PAINT_BAR.map((id, i) => `${id}:${i + 1}:${i + 1}`)].join(' '), "Paint's bar shows its six tools in their places");
    await press(page, 'Shift+2');

    // --- the guide and Preferences name the tool in each place ---
    await press(page, 'h');
    const guide = await page.evaluate(() => document.querySelector('.help-guide')?.textContent ?? '');
    t.ok(/Tool bar, place 1: Crease/.test(guide) && /Tool bar, place 9: Polish/.test(guide), 'the hotkey guide says which tool is in each place');
    t.ok(!/place 10/.test(guide), 'and leaves out the place with no tool in it');
    t.ok(!/Standard \(clay\)/.test(guide), 'and no longer lists a key per tool');
    await press(page, 'h');
    await press(page, 'Control+Comma');
    const rows = await page.evaluate(() => [...document.querySelectorAll('.prefs__row .prefs__label')].map((l) => l.textContent).filter((x) => /^Tool bar/.test(x)));
    t.ok(rows.length === 10 && rows[0] === 'Tool bar, place 1: Crease' && rows[9] === 'Tool bar, place 10: empty', `Preferences lists the ten places with the tool in each (${rows[0]} ... ${rows[9]})`);

    // --- a rebind made in Preferences shows on the button at once ---
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.prefs__row')].find((r) => r.querySelector('.prefs__label')?.textContent === 'Tool bar, place 4: Inflate');
      row.querySelector('.prefs__key').click();
    });
    await page.keyboard.press('v');
    await page.waitForTimeout(100);
    await page.evaluate(() => [...document.querySelectorAll('.prefs button')].find((b) => b.textContent === 'Close')?.click());
    await page.waitForTimeout(100);
    const live = (await bar(page)).find((b) => b.id === 'bz.inflate');
    t.ok(live.badge === 'v' && live.tip === 'v', `Inflate's badge and tip show the key rebound in Preferences (${live.badge}, ${live.tip})`);
    await press(page, 'v');
    t.eq((await inHand(page)).lit.join(), 'bz.inflate', 'and that key picks it');
    await press(page, '1');
    await press(page, '4');
    t.eq((await inHand(page)).lit.join(), 'bz.crease', 'while the digit it had no longer does: 4 picks nothing now');

    // --- a rebind saved under the old per-tool ids carries to the place ---
    await bootWith(page, base, { 'bozzetto-keymap': JSON.stringify({ 'tool.crease': 'z', 'tool.rake': 'shift+7', 'paint.erase': 'y' }) });
    const rb = await bar(page);
    const crease = rb.find((b) => b.id === 'bz.crease');
    const rake = rb.find((b) => b.id === 'bz.rake');
    t.ok(crease.badge === 'z' && crease.tip === 'z', `a key saved for Crease before places (tool.crease) is its place's key and shows on its badge and tip (${crease.badge}, ${crease.tip})`);
    t.ok(rake.badge === '' && rake.tip === 'Shift + 7', `a key with a modifier has no badge, and the tip spells it out (${rake.badge}|${rake.tip})`);
    await press(page, 'z');
    t.eq((await inHand(page)).lit.join(), 'bz.crease', 'the saved key picks the tool');
    await press(page, 'Shift+7');
    t.eq((await inHand(page)).lit.join(), 'bz.rake', 'and so does the one with a modifier');
    await press(page, '1');
    t.ok((await inHand(page)).lit.join() !== 'bz.crease', 'the digit Crease had is not its key now');
    const keymap = await page.evaluate(() => JSON.parse(localStorage.getItem('bozzetto-keymap') ?? 'null'));
    t.ok(keymap && keymap['tool.crease'] === 'z', 'the old entry is still stored, so an older build opened on this device reads it');
    await press(page, 'Shift+3');
    // paint.erase was rebound to y, and Erase held place 2, which tool.move (default) shares: place 2 answers to y in both bars.
    await press(page, 'y');
    t.eq((await inHand(page)).lit.join(), 'bz.erase', "in Paint the rebind of Erase's old key picks Erase, place 2");
    await page.evaluate(() => localStorage.removeItem('bozzetto-keymap'));
  },

  async toolSettings(page, base, t) {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);

    // --- a scene saved now carries both tables ---
    await page.evaluate(() => {
      const S = window.__sculpt;
      // Screen sizes, so a size set on the tool is the number the scene holds (in world scale it is in world units).
      S.worldScale.setEnabled(false);
      const m = S.session.getSculptManager();
      S.input.selectBrush(0);
      m.getTool(0)._radius = 123;
      m.getTool(0)._intensity = 1.75;
      m.getTool(0)._spacing = 0.27;
      m.getTool(9).falloffPow = 0.55;
      m.getTool(6).pinch = 1.4;
      m.getTool(2).planeLock = 0.5;
      m.getTool(2).gain = 1.1;
      S.input.onBrushSettingsChange?.();
    });
    const saved = await page.evaluate(async () => {
      const S = window.__sculpt;
      const rec = await S.file.unpack(await S.file.pack());
      return rec.settings;
    });
    t.ok(saved.radius && saved.strength && saved.spacing && saved.dynamics && saved.curves && saved.symmetry && saved.rake && saved.smooth, 'the numbered tables are written as before (radius, strength, spacing, dynamics, curves, symmetry, rake, smooth)');
    t.ok(Object.keys(saved.radius).every((k) => /^\d+$/.test(k)) && saved.radius[0] === 123 && saved.strength[0] === 1.75 && saved.spacing[0] === 0.27, 'and are keyed by the engine number, with the values set');
    t.ok(saved.tools && saved.toolsRev === 1, 'the table by tool id is written beside them, with its revision');
    const clay = saved.tools['bz.clay'];
    t.ok(clay && clay.size === 123 && clay.strength === 1.75 && clay.spacing === 0.27 && clay.dynamics && clay.curve && clay.symmetry, `its entry for Standard clay holds size, strength, spacing, pressure, curve and symmetry (${Object.keys(clay ?? {}).join(' ')})`);
    t.ok(saved.tools['bz.rake']?.own?.tines >= 2 && saved.tools['bz.rake'].strength === saved.strength[13], "the Rake's own rows and strength are in its entry");
    t.ok(saved.tools['bz.smooth']?.own?.mode === 'average' && saved.tools['bz.smooth'].strength === saved.smooth.strength, "Smooth's mode, relax and strength are in its entry");
    t.ok(saved.tools['bz.move'].own.falloff === 0.55 && saved.tools['bz.crease'].own.pinch === 1.4 && saved.tools['bz.polish'].own.planeLock === 0.5 && saved.tools['bz.polish'].own.gain === 1.1, "Move's Falloff, Crease's Pinch and Polish's Plane lock and Build-up are saved, in the table only");
    t.ok(!JSON.stringify(saved).includes('"falloffPow"') && !('pinch' in saved) && !('planeLock' in saved), 'and no numbered table was widened for them');

    // --- the four survive a reload ---
    await page.evaluate(() => window.__sculpt.persist.markDirty());
    await page.evaluate(() => window.__sculpt.persist.flush());
    await openForInput(page, base);
    const back = await page.evaluate(() => {
      const m = window.__sculpt.session.getSculptManager();
      return { falloff: m.getTool(9).falloffPow, pinch: m.getTool(6).pinch, lock: m.getTool(2).planeLock, gain: m.getTool(2).gain, size: m.getTool(0)._radius, strength: m.getTool(0)._intensity };
    });
    t.ok(back.falloff === 0.55 && back.pinch === 1.4 && back.lock === 0.5 && back.gain === 1.1, `Falloff, Pinch, Plane lock and Build-up come back after a reload (${JSON.stringify(back)})`);
    t.ok(back.size === 123 && back.strength === 1.75, 'and so do the size and strength they were saved beside');
    await page.evaluate(() => window.__sculpt.input.selectBrush(9));
    await openPanel(page, 'Tool');
    await page.waitForTimeout(150);
    const row = await page.evaluate(() => [...document.querySelectorAll('.panel--sculpt .sculpt-panel__extras input[type=range]')].map((i) => i.value));
    t.eq(row.join(), '0.55', "Move's Falloff row shows the saved value");

    // --- an older scene, numbered tables only ---
    const opened = (edit, read) =>
      page.evaluate(
        async ([edit, read]) => {
          const S = window.__sculpt;
          const rec = await S.file.unpack(await S.file.pack());
          // eslint-disable-next-line no-new-func
          new Function('rec', edit)(rec);
          await S.file.open(await S.file.packRecord(rec));
          // eslint-disable-next-line no-new-func
          return new Function('S', `const m = S.session.getSculptManager(); ${read}`)(S);
        },
        [edit, read],
      );
    const old = await opened(
      `delete rec.settings.tools; delete rec.settings.toolsRev; rec.settings.radius[0] = 66; rec.settings.strength[0] = 1.5; rec.settings.spacing[0] = 0.33;
       rec.settings.symmetry[0] = { on: false, axis: 'z' }; rec.settings.rake.tines = 9;`,
      `return { r: m.getTool(0)._radius, s: m.getTool(0)._intensity, sp: m.getTool(0)._spacing, sym: S.session.symmetry.get(0), tines: m.getTool(13).tines, falloff: m.getTool(9).falloffPow, pinch: m.getTool(6).pinch, lock: m.getTool(2).planeLock, gain: m.getTool(2).gain };`,
    );
    t.ok(old.r === 66 && old.s === 1.5 && old.sp === 0.33 && old.sym.on === false && old.sym.axis === 'z' && old.tines === 9, `an older scene (numbered tables only) opens with its size, strength, spacing, symmetry and Rake rows (${JSON.stringify(old)})`);
    t.ok(old.falloff === 1 && old.pinch === 0.625 && old.lock === 0 && old.gain === 0.8, 'and the four that older scenes never held start from their defaults');

    // --- a scene with only the new table ---
    const only = await opened(
      `for (const k of ['radius','dynamics','spacing','curves','strength','symmetry','rake','smooth','spacingRev','strengthRev','curvesRev','smoothRev']) delete rec.settings[k];
       rec.settings.tools = {
         'bz.clay': { size: 91, strength: 2.5, spacing: 0.31, dynamics: { size: 0.4 }, symmetry: { on: false, axis: 'y' } },
         'bz.move': { own: { falloff: 0.45 } },
         'bz.rake': { strength: 0.4, own: { tines: 7 } },
         'bz.smooth': { strength: 0.5, own: { mode: 'surface', relax: 0.6 } },
         'bz.polish': { own: { planeLock: 0.7, gain: 1.5 } },
       };`,
      `const sm = m.getTool(3); return { r: m.getTool(0)._radius, s: m.getTool(0)._intensity, sp: m.getTool(0)._spacing, dyn: S.input.dynamics.get(0).size, sym: S.session.symmetry.get(0), falloff: m.getTool(9).falloffPow, tines: m.getTool(13).tines, rakeS: m.getTool(13)._intensity, mode: sm.smoothMode, relax: sm.relax, smS: sm._intensity, lock: m.getTool(2).planeLock, gain: m.getTool(2).gain };`,
    );
    t.ok(only.r === 91 && only.s === 2.5 && only.sp === 0.31 && only.dyn === 0.4 && only.sym.on === false && only.sym.axis === 'y', `a scene with only the table by tool id opens with its settings (${JSON.stringify(only)})`);
    t.ok(only.falloff === 0.45 && only.tines === 7 && only.rakeS === 0.4 && only.mode === 'surface' && only.relax === 0.6 && only.smS === 0.5 && only.lock === 0.7 && only.gain === 1.5, "and its own knobs: Move's Falloff, the Rake, Smooth, Polish");

    // --- the table wins where both are there, the numbered tables fill the rest ---
    const both = await opened(
      `rec.settings.radius[0] = 55; rec.settings.radius[1] = 44; rec.settings.tools = { 'bz.clay': { size: 99 } };`,
      `return { clay: m.getTool(0)._radius, inflate: m.getTool(1)._radius };`,
    );
    t.ok(both.clay === 99 && both.inflate === 44, `where both tables have a tool the table by id is read, and where it has none the numbered one (${JSON.stringify(both)})`);

    // --- bad keys and values are dropped ---
    const sane = await page.evaluate(async () => {
      const S = window.__sculpt;
      const rec = await S.file.unpack(await S.file.pack());
      rec.settings.tools = JSON.parse(`{
        "bz.clay": { "size": -5, "strength": "strong", "spacing": 0, "dynamics": { "size": 7, "sizeCurve": "wild" }, "symmetry": { "on": "yes", "axis": "w" }, "own": { "bogus": 1 }, "extra": 1 },
        "bz.move": { "own": { "falloff": -3, "other": 2 } },
        "bz.crease": { "own": { "pinch": "lots" } },
        "bz.smooth": { "own": { "mode": "wavy", "relax": 4 } },
        "bz.nonexistent": { "size": 10 },
        "bz.select": { "size": 10 },
        "__proto__": { "polluted": true },
        "constructor": { "size": 10 },
        "0": { "size": 10 }
      }`);
      rec.settings.toolsRev = 1;
      const out = await S.file.unpack(await S.file.packRecord(rec));
      return { tools: out.settings.tools, polluted: ({}).polluted === true, keys: Object.keys(out.settings.tools) };
    });
    t.ok(!sane.polluted, 'a __proto__ key in the table pollutes nothing');
    t.eq([...sane.keys].sort().join(), 'bz.clay,bz.move,bz.smooth', 'ids that are not tools the engine runs are dropped (bz.nonexistent, bz.select, constructor, 0), and entries left with nothing are too');
    const c = sane.tools['bz.clay'];
    t.ok(!('size' in c) && !('strength' in c) && !('spacing' in c) && !('symmetry' in c) && !('own' in c) && !('extra' in c), `a size below zero, a strength that is not a number, a spacing of zero, a symmetry that is not one, and unknown knobs are dropped (${JSON.stringify(c)})`);
    t.ok(c.dynamics.size === 1 && !('sizeCurve' in c.dynamics), 'a pressure amount is held to 0..1 and a curve that is not one is dropped');
    t.eq(sane.tools['bz.move'].own.falloff, 0.05, "a knob is held to its limits (Move's Falloff, at least 0.05) and unknown ones are dropped");
    t.ok(!('mode' in sane.tools['bz.smooth'].own) && sane.tools['bz.smooth'].own.relax === 1, "Smooth's mode must be one of its choices, and its relax is held to 0..1");

    // --- a table of a later revision is left alone ---
    const later = await opened(
      `rec.settings.toolsRev = 99; rec.settings.radius[0] = 70; rec.settings.tools = { 'bz.clay': { size: 99 } };`,
      `return { clay: m.getTool(0)._radius };`,
    );
    t.eq(later.clay, 70, 'a table from a later revision than this build reads is not read; the numbered ones are');
  },
};
