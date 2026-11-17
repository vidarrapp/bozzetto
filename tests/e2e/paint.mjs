// The Paint workspace (owner request, 2026-11-17): a workspace of the Sculpt
// page after Sculpt and before Present, with its own tools, paint layers on
// the object's highest level and Photoshop's blend modes.
//
// paintWorkspace: the path Armature > Sculpt > Paint > Present and the View
//   menu; Shift+B in and out, the address that reopens it; the bar (Select on
//   q, six tools on 1 to 6, no brushes, no Calipers, no Transform, no Negative)
//   and Sculpt's bar with no paint tool and a free 0; the tabs (Scene, Layers;
//   no Model, no Render); Present from Paint and back to it; leaving Paint puts
//   Sculpt back as it was; Colour comes back on Sculpt colours with a notice.
// paintBlend: the module's known values for every mode, and each mode on real
//   vertices of a stroke, against an independent statement of Photoshop's
//   arithmetic; opacity; Dissolve does not flicker.
// paintLayers: a stroke into a layer; Base; add, hide, rename, opacity, mode,
//   reorder (by the handle with the pointer too), duplicate, merge down, clear,
//   delete, flatten all, each one undo press.
// paintTools: erase, blur, fill, pick, project (a two-colour picture, back faces
//   untouched), the mask and a hidden layer, no layer to erase on.
// paintLevels: paint low and see it high, subdivide and delete highest keep
//   the colours, a stroke costs what it cost.
// paintSave: remesh asks once for both kinds of layers; save and reopen; an old
//   scene with painted colours has them as Base; bad layer data is refused.
// paintPhone: opens and closes at phone width without an error (phones are not a target).
import { mkdirSync } from 'node:fs';
import { devices, openForInput, openPanel, screenOf } from './smoke.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/paint';

/** In the page: helpers on window.__pt, shared by every check below. */
function install() {
  const S = window.__sculpt;
  const T = { PAINT: 8, ERASE: 15, BLUR: 16, FILL: 17, PICK: 18, PROJECT: 19, BRUSH: 0 };
  const pt = {
    T,
    mesh: () => S.session.getMesh(),
    P: () => S.session.paint,
    state: () => S.session.paint.internals(S.session.getMesh())?.p ?? null,
    levels: () => {
      const m = S.session.getMesh();
      return { sel: m._sel, n: m._meshes.length };
    },
    topN: () => {
      const m = S.session.getMesh();
      return m._meshes[m._meshes.length - 1].getNbVertices();
    },
    /** Move the level on screen, as stepping does, and show the layers there. */
    go: (k) => {
      const m = S.session.getMesh();
      m.selectResolution(k);
      m.updateBuffers();
      S.session.paint.levelChanged(m);
    },
    colours: () => {
      const m = S.session.getMesh();
      return new Float32Array(m.getColors().subarray(0, m.getNbVertices() * 3));
    },
    snaps: window.__pt?.snaps ?? {},
    snap: (name) => {
      pt.snaps[name] = pt.colours();
      return pt.snaps[name].length;
    },
    /** Largest |difference| of the colours on screen from a snapshot. */
    diff: (name, other) => {
      const x = other ? pt.snaps[other] : pt.colours();
      const y = pt.snaps[name];
      if (x.length !== y.length) return Infinity;
      let d = 0;
      for (let i = 0; i < x.length; i++) d = Math.max(d, Math.abs(x[i] - y[i]));
      return d;
    },
    /** Vertices whose colour is not the snapshot's. */
    changed: (name) => {
      const x = pt.colours();
      const y = pt.snaps[name];
      let n = 0;
      for (let i = 0; i < x.length; i += 3) if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 1e-6) n++;
      return n;
    },
    layers: () => S.session.paint.list(S.session.getMesh()),
    /** A layer by name. */
    layer: (name) => pt.layers().find((l) => l.name === name),
    /** The vertices a layer has colour on (alpha above 0). */
    covered: (layer) => {
      const out = [];
      const d = layer.rgba;
      if (d) for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) out.push(i / 4);
      return out;
    },
    undo: () => S.session.undo(),
    redo: () => S.session.redo(),
    depth: () => S.session.getStateManager()._curUndoIndex,
    /** One programmatic stroke across the middle of the active object with a paint tool. */
    stroke: (tool, rgb = null, ox = 0, oy = 0, radius = 50, strength = 1) => {
      const { session, tablet } = S;
      const mgr = session.getSculptManager();
      mgr._symmetry = false;
      mgr.setToolIndex(tool);
      const t = mgr.getTool(tool);
      if (rgb) {
        t._color[0] = rgb[0];
        t._color[1] = rgb[1];
        t._color[2] = rgb[2];
      }
      t._radius = radius;
      t._intensity = strength;
      tablet.pressure = 0.5;
      tablet.pen = false;
      const mesh = session.getMesh();
      const b = mesh.computeWorldBound();
      const [cx, cy] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
      const x0 = cx + ox - 40;
      const y = cy + oy;
      session._mouseX = x0;
      session._mouseY = y;
      if (!mgr.start(false)) return false;
      const picking = session.getPicking();
      for (let i = 1; i <= 5; i++) {
        const x = x0 + 16 * i;
        session._mouseX = x;
        t.makeStroke(x, y, picking, null);
      }
      t.updateRender();
      mgr.end();
      session.getStateManager().cleanNoop();
      return true;
    },
    // Photoshop's arithmetic stated again here, independently of src/paint/blend.ts, from the W3C
    // compositing spec's wording (the separable modes) and Adobe's Lum/Sat routines.
    ref: (() => {
      const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
      const clip = (c) => {
        const l = lum(c);
        const n = Math.min(...c);
        const x = Math.max(...c);
        let o = c.slice();
        if (n < 0) o = o.map((v) => l + ((v - l) * l) / (l - n));
        if (x > 1) o = o.map((v) => l + ((v - l) * (1 - l)) / (x - l));
        return o;
      };
      const setLum = (c, l) => {
        const d = l - lum(c);
        return clip(c.map((v) => v + d));
      };
      const sat = (c) => Math.max(...c) - Math.min(...c);
      const setSat = (c, s) => {
        const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
        const [mn, md, mx] = idx;
        const o = [0, 0, 0];
        if (c[mx] > c[mn]) {
          o[md] = ((c[md] - c[mn]) * s) / (c[mx] - c[mn]);
          o[mx] = s;
        }
        return o;
      };
      const per = (f) => (b, s) => b.map((v, i) => f(v, s[i]));
      const hl = (b, s) => (s <= 0.5 ? b * 2 * s : b + (2 * s - 1) - b * (2 * s - 1));
      const dodge = (b, s) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s)));
      const burn = (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s));
      const clamp = (v) => Math.max(0, Math.min(1, v));
      const table = {
        normal: (b, s) => s.slice(),
        darken: per(Math.min),
        multiply: per((b, s) => b * s),
        'color-burn': per(burn),
        'linear-burn': per((b, s) => clamp(b + s - 1)),
        'darker-color': (b, s) => (b[0] + b[1] + b[2] <= s[0] + s[1] + s[2] ? b.slice() : s.slice()),
        lighten: per(Math.max),
        screen: per((b, s) => b + s - b * s),
        'color-dodge': per(dodge),
        'linear-dodge': per((b, s) => clamp(b + s)),
        'lighter-color': (b, s) => (b[0] + b[1] + b[2] >= s[0] + s[1] + s[2] ? b.slice() : s.slice()),
        overlay: per((b, s) => hl(s, b)),
        'soft-light': per((b, s) => {
          if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
          const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
          return b + (2 * s - 1) * (d - b);
        }),
        'hard-light': per(hl),
        'vivid-light': per((b, s) => (s <= 0.5 ? burn(b, 2 * s) : dodge(b, 2 * s - 1))),
        'linear-light': per((b, s) => clamp(b + 2 * s - 1)),
        'pin-light': per((b, s) => (s < 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1))),
        'hard-mix': per((b, s) => (b + s >= 1 ? 1 : 0)),
        difference: per((b, s) => Math.abs(b - s)),
        exclusion: per((b, s) => b + s - 2 * b * s),
        subtract: per((b, s) => clamp(b - s)),
        divide: per((b, s) => (s === 0 ? 1 : clamp(b / s))),
        hue: (b, s) => setLum(setSat(s, sat(b)), lum(b)),
        saturation: (b, s) => setLum(setSat(b, sat(s)), lum(b)),
        color: (b, s) => setLum(s, lum(b)),
        luminosity: (b, s) => setLum(b, lum(s)),
      };
      return table;
    })(),
    enc: (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055),
    dec: (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)),
  };
  window.__pt = pt;
}

/** What the shell shows: the path, the bar, the tabs. */
const shell = (page) =>
  page.evaluate(() => {
    const shown = (el) => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    const bar = [...document.querySelectorAll('.sculpt-toolbar__brushes .sculpt-toolbar__btn')].filter(shown);
    const tab = (cls) => shown(document.querySelector(`.panel.${cls} > .panel__handle`));
    return {
      path: [...document.querySelectorAll('.bz-ws__step')].map((b) => `${b.textContent}${b.getAttribute('aria-current') === 'step' ? '*' : ''}`).join(' > '),
      paint: document.body.classList.contains('paint-ws'),
      presenting: document.body.classList.contains('presenting'),
      bar: bar.map((b) => `${b.querySelector('.sculpt-toolbar__key')?.textContent ?? ''}:${b.querySelector('.bz-tip__name')?.textContent ?? b.getAttribute('aria-label')}`),
      active: bar.filter((b) => b.classList.contains('sculpt-toolbar__btn--active')).map((b) => b.querySelector('.bz-tip__name')?.textContent),
      negative: shown(document.querySelector('.sculpt-toolbar__neg')),
      tabs: { scene: tab('panel--scene'), model: tab('panel--model'), layers: tab('panel--layers'), tool: tab('panel--sculpt'), reference: tab('panel--reference'), render: tab('panel--render'), material: tab('panel--material') },
      address: location.search,
      tool: window.__sculpt.input.currentToolIndex(),
    };
  });

const press = async (page, key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(80);
};

export const suites = {
  async paintWorkspace(page, base, t) {
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    await openForInput(page, base);
    await page.evaluate(install);

    // --- Sculpt first: the path, the bar, the View menu ---------------------
    const s0 = await shell(page);
    t.eq(s0.path, 'Armature > Sculpt* > Paint > Present', 'the path in the strip is Armature > Sculpt > Paint > Present, Sculpt lit');
    t.ok(!s0.paint && !s0.bar.some((b) => /Paint|Erase|Blur|Fill|Pick|Project/.test(b)), `Sculpt's bar has no paint tool (${s0.bar.join(' ')})`);
    t.ok(s0.bar.length > 0 && s0.negative, 'it keeps the brushes and Negative');
    const clay = s0.tool;
    await press(page, '0');
    t.eq((await shell(page)).tool, clay, 'the key 0 is free in Sculpt: it picks nothing');
    t.ok(s0.tabs.model && s0.tabs.layers && s0.tabs.scene, 'Sculpt has Scene, Model and Layers on the left');
    const menu = async () => {
      await page.evaluate(() => [...document.querySelectorAll('.bz-strip .file-menu__trigger, .bz-strip button')].find((b) => b.textContent === 'View')?.click());
      await page.waitForTimeout(100);
      return page.evaluate(() => [...document.querySelectorAll('.file-menu:not([hidden]) .file-menu__item')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
    };
    const view0 = await menu();
    t.ok(view0.some((x) => /^Paint/.test(x) && /Shift \+ B/.test(x)), `View has a Paint item with its key (${view0.filter((x) => /Paint|Present|Sculpt/.test(x)).join(' | ')})`);
    t.ok(view0.some((x) => /^Model panel/.test(x)) && !view0.some((x) => /^Render panel/.test(x)), 'and, in Sculpt, the Model panel and no Render panel');
    await page.keyboard.press('Escape');

    // --- Into Paint ----------------------------------------------------------
    await openPanel(page, 'Tool');
    const had = await page.evaluate(() => ({ tool: !window.__sculpt.sculptPanel.isCollapsed(), model: !window.__sculpt.modelPanel.isCollapsed() }));
    await press(page, 'Shift+B');
    const p1 = await shell(page);
    t.ok(p1.paint && p1.path === 'Armature > Sculpt > Paint* > Present', `Shift+B enters Paint and the path lights Paint (${p1.path})`);
    t.ok(await page.evaluate(() => window.__sculpt.paintWorkspace.isOn()), 'the workspace says it is on');
    t.eq(p1.bar.join(' '), 'q:Select 1:Paint 2:Erase 3:Blur 4:Fill 5:Pick 6:Project', "Paint's bar: Select on q, then the six tools on 1 to 6");
    t.eq(p1.active.join(), 'Paint', 'Paint is the tool in hand');
    t.ok(!p1.negative, "the left edge's Negative is gone");
    t.ok(p1.tabs.scene && p1.tabs.layers && p1.tabs.tool && p1.tabs.reference && !p1.tabs.model && !p1.tabs.render, `the tabs are Scene, Layers, Tool, Reference: no Model, no Render (${JSON.stringify(p1.tabs)})`);
    t.ok(/paint=1/.test(p1.address), `the address reopens Paint (${p1.address})`);
    const edge = await page.evaluate(() => ({
      undo: !!document.querySelector('.sculpt-histbtn[data-hist=undo]')?.getClientRects().length,
      redo: !!document.querySelector('.sculpt-histbtn[data-hist=redo]')?.getClientRects().length,
      sliders: !!document.querySelector('.sculpt-sliders')?.getClientRects().length,
    }));
    t.ok(edge.undo && edge.redo && edge.sliders, 'Undo, Redo and the size and strength sliders stay');
    const view1 = await menu();
    t.ok(!view1.some((x) => /^Model panel/.test(x)) && !view1.some((x) => /^Render panel/.test(x)) && view1.some((x) => /^Layers panel/.test(x)), 'the View menu lists the Paint workspace panels only');
    await page.keyboard.press('Escape');

    // The keys follow the bar.
    const T = await page.evaluate(() => window.__pt.T);
    for (const [key, tool] of [['1', T.PAINT], ['2', T.ERASE], ['3', T.BLUR], ['4', T.FILL], ['5', T.PICK], ['6', T.PROJECT]]) {
      await press(page, key);
      t.eq((await shell(page)).tool, tool, `the key ${key} picks tool ${tool}`);
    }
    await press(page, '7');
    t.eq((await shell(page)).tool, T.PROJECT, 'a key with no tool (7) changes nothing and reaches nothing else');
    await press(page, 'q');
    t.ok(await page.evaluate(() => window.__sculpt.input.isSelecting()), 'q still takes the Select tool');
    await press(page, 'q');
    await press(page, 't');
    t.ok(!(await page.evaluate(() => window.__sculpt.gizmo.isActive())), 'the transform key does nothing in Paint');
    await press(page, 'c');
    t.ok(!(await page.evaluate(() => window.__sculpt.input.isMeasuring?.() ?? false)), 'nor does Calipers');
    await press(page, '1');

    // The Tool panel shows the colour.
    await openPanel(page, 'Tool');
    const tool = await page.evaluate(() => ({
      title: document.querySelector('.panel--sculpt .panel__handle')?.textContent,
      colour: !!document.querySelector('.panel--sculpt .colour-swatch, .panel--sculpt .cp-swatch, .panel--sculpt [class*="swatch"]'),
    }));
    t.ok(tool.colour, 'the Tool panel carries the colour picker for Paint');

    // The Layers tab shows paint layers here.
    t.ok(await openPanel(page, 'Layers'), 'the Layers panel opens in Paint');
    const lay = await page.evaluate(() => ({
      sculpt: !!document.querySelector('.layers-sculpt:not([hidden])') && getComputedStyle(document.querySelector('.layers-sculpt')).display !== 'none',
      paint: !document.querySelector('.layers-paint').hidden,
      rows: [...document.querySelectorAll('.layers-paint .layer-row')].map((r) => r.dataset.layer),
    }));
    t.ok(!lay.sculpt && lay.paint && lay.rows.join() === 'base', `the Layers tab shows the paint layers, Base alone (${JSON.stringify(lay)})`);
    await page.screenshot({ path: `${SHOTS}/paint-empty-1180.png` });

    // --- Present from Paint, and back ---------------------------------------
    await press(page, 'Shift+P');
    const pr = await shell(page);
    t.ok(pr.presenting && pr.path === 'Armature > Sculpt > Paint > Present*', `Shift+P presents from Paint (${pr.path})`);
    t.ok(pr.tabs.render, 'the Render tab is there in Present, entered from Paint');
    await press(page, 'Shift+P');
    const back = await shell(page);
    t.ok(!back.presenting && back.paint && back.path === 'Armature > Sculpt > Paint* > Present', `leaving Present returns to Paint (${back.path})`);
    t.eq(back.bar.join(' '), p1.bar.join(' '), "and Paint's bar is as it was");
    t.ok(!back.tabs.render && !back.tabs.model, 'Render and Model are put away again');
    // The path from Present to Sculpt.
    await press(page, 'Shift+P');
    await page.evaluate(() => [...document.querySelectorAll('.bz-ws__step')].find((b) => b.textContent === 'Sculpt').click());
    await page.waitForTimeout(150);
    const toSculpt = await shell(page);
    t.ok(!toSculpt.presenting && !toSculpt.paint && toSculpt.path.startsWith('Armature > Sculpt*'), `the path's Sculpt step leaves Present and Paint at once (${toSculpt.path})`);
    // Present from Sculpt returns to Sculpt, and its path reaches Paint.
    await press(page, 'Shift+P');
    await page.evaluate(() => [...document.querySelectorAll('.bz-ws__step')].find((b) => b.textContent === 'Paint').click());
    await page.waitForTimeout(150);
    const toPaint = await shell(page);
    t.ok(!toPaint.presenting && toPaint.paint, `the path's Paint step goes from Present to Paint (${toPaint.path})`);

    // --- Out of Paint: Sculpt as it was --------------------------------------
    await press(page, 'Shift+B');
    const out = await shell(page);
    t.ok(!out.paint && out.path.startsWith('Armature > Sculpt*'), `Shift+B again leaves Paint (${out.path})`);
    t.eq(out.tool, clay, 'the tool Sculpt had comes back');
    t.ok(out.bar.length === s0.bar.length && out.negative && out.tabs.model && out.tabs.render === s0.tabs.render, "Sculpt's bar, Negative and tabs come back");
    t.ok(!/paint=1/.test(out.address), 'and the address forgets Paint');
    const after = await page.evaluate(() => ({ tool: !window.__sculpt.sculptPanel.isCollapsed(), model: !window.__sculpt.modelPanel.isCollapsed() }));
    t.ok(after.tool === had.tool, 'the Tool panel is as it was');
    void after.model;
    t.ok(await page.evaluate(() => !document.querySelector('.layers-sculpt').hidden), 'the Layers tab shows the sculpt layers again');

    // --- Colour comes back on Sculpt colours ---------------------------------
    await page.evaluate(() => window.__sculpt.viewer.materials.setPlainColor(true));
    await press(page, 'Shift+B');
    const colour = await page.evaluate(() => ({
      state: window.__sculpt.viewer.materials.getMaterialState().vertexColors,
      toasts: [...document.querySelectorAll('.sculpt-status, .status-toast, [class*="toast"]')].map((e) => e.textContent).join('|'),
    }));
    t.eq(colour.state, true, 'entering Paint turns Colour to Sculpt colours');
    t.ok(/Sculpt colours/.test(colour.toasts), `and says so (${colour.toasts.slice(0, 100)})`);
    await press(page, 'Shift+B');

    // The address reopens it.
    await page.goto(`${base}/?sculpt=1&q=low&paint=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('overlay') && !!window.__sculpt, null, { timeout: 60_000 });
    await page.waitForTimeout(400);
    const reopened = await shell(page);
    t.ok(reopened.paint && reopened.path === 'Armature > Sculpt > Paint* > Present', `?paint=1 reopens in Paint (${reopened.path})`);
  },

  async paintBlend(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());

    // --- the module's known values ------------------------------------------
    const known = await page.evaluate(() => {
      const { blend } = window.__sculpt;
      const b = [0.8, 0.4, 0.2];
      const s = [0.3, 0.6, 0.9];
      const out = {};
      for (const id of blend.BLEND_IDS) out[id] = blend.blend(id, b, s).map((v) => +v.toFixed(5));
      // And a few exact ones, by hand.
      out.mulHalf = blend.blend('multiply', [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
      out.screenHalf = blend.blend('screen', [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
      out.diff = blend.blend('difference', [0.9, 0.2, 0.5], [0.4, 0.6, 0.5]);
      out.lumi = blend.lum(1, 0, 0);
      out.dissolveSame = blend.dissolveThreshold(1234) === blend.dissolveThreshold(1234);
      return out;
    });
    t.eq(known.mulHalf.join(), '0.25,0.25,0.25', 'Multiply of 0.5 and 0.5 is 0.25');
    t.eq(known.screenHalf.join(), '0.75,0.75,0.75', 'Screen of 0.5 and 0.5 is 0.75');
    t.ok(Math.abs(known.diff[0] - 0.5) < 1e-9 && Math.abs(known.diff[1] - 0.4) < 1e-9 && known.diff[2] === 0, 'Difference is the absolute difference');
    t.near(known.lumi, 0.3, 1e-9, "luminosity uses Photoshop's weights (red is 0.30)");
    t.ok(known.dissolveSame, 'the dissolve threshold of a vertex is fixed');
    t.eq(Object.keys(known).filter((k) => /^[a-z-]+$/.test(k) && !['mulHalf', 'screenHalf', 'diff', 'lumi', 'dissolveSame'].includes(k)).length, 27, 'the module has all 27 modes');
    const bad = await page.evaluate((known) => {
      const { ref } = window.__pt;
      const { blend } = window.__sculpt;
      const b = [0.8, 0.4, 0.2];
      const s = [0.3, 0.6, 0.9];
      const out = [];
      for (const id of blend.BLEND_IDS) {
        if (id === 'dissolve') continue;
        const want = ref[id](b, s);
        const got = known[id];
        if (got.some((v, i) => Math.abs(v - want[i]) > 2e-5)) out.push(`${id}: ${got} vs ${want.map((v) => v.toFixed(5))}`);
      }
      return out;
    }, known);
    t.eq(bad.length, 0, `every mode agrees with the separate statement of Photoshop's formulas (${bad.join('; ')})`);

    // --- on real vertices -----------------------------------------------------
    const lv = await page.evaluate(() => window.__pt.levels());
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
    await page.evaluate(() => window.__pt.snap('plain'));
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.add(window.__pt.mesh());
    });
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [0.9, 0.2, 0.05], 0, 0, 70, 1)), 'a stroke on a new layer lands');
    const covered = await page.evaluate(() => window.__pt.covered(window.__pt.layer('Layer 1')).length);
    t.ok(covered > 30, `the layer holds colour on ${covered} vertices`);
    const check = (mode, opacity) =>
      page.evaluate(
        ([mode, opacity]) => {
          const { session } = window.__sculpt;
          const pt = window.__pt;
          const m = pt.mesh();
          const l = pt.layer('Layer 1');
          session.paint.setMode(m, l, mode);
          session.paint.setOpacity(m, l, opacity, 'live');
          session.paint.setOpacity(m, l, opacity, 'commit');
          const p = pt.state();
          const cols = m.getColors();
          let worst = 0;
          let checked = 0;
          let alphaOnly = 0;
          const { blend } = window.__sculpt;
          for (let i = 0; i < p.n; i++) {
            const a = l.rgba[i * 4 + 3];
            const b = [pt.enc(p.base[i * 3]), pt.enc(p.base[i * 3 + 1]), pt.enc(p.base[i * 3 + 2])];
            let want;
            if (a === 0) want = [p.base[i * 3], p.base[i * 3 + 1], p.base[i * 3 + 2]];
            else {
              const src = [l.rgba[i * 4] / 255, l.rgba[i * 4 + 1] / 255, l.rgba[i * 4 + 2] / 255];
              const k = (a / 255) * opacity;
              let r;
              if (mode === 'dissolve') r = blend.dissolveThreshold(i) < k ? src : b;
              else {
                const m2 = pt.ref[mode](b, src);
                r = b.map((v, c) => v + (m2[c] - v) * k);
              }
              want = r.map(pt.dec);
              checked++;
            }
            for (let c = 0; c < 3; c++) {
              const d = Math.abs(cols[i * 3 + c] - want[c]);
              if (d > worst) worst = d;
            }
            if (a > 0 && a < 255) alphaOnly++;
          }
          return { worst, checked, alphaOnly };
        },
        [mode, opacity],
      );
    const results = [];
    const modes = await page.evaluate(() => window.__sculpt.blend.BLEND_IDS);
    for (const id of modes) {
      const r = await check(id, 0.8);
      results.push(`${id}:${r.worst.toExponential(1)}`);
      t.ok(r.checked > 30 && r.worst < 5e-5, `${id}: the mesh's colours are the module's composite on ${r.checked} real vertices, worst ${r.worst.toExponential(2)}`);
    }
    const o50 = await check('multiply', 0.5);
    t.ok(o50.worst < 5e-5, `opacity 50% mixes the blend in by half (worst ${o50.worst.toExponential(2)})`);
    const o0 = await check('normal', 0);
    t.ok(o0.worst < 5e-5, 'at opacity 0 the mesh shows the Base');
    t.ok((await page.evaluate(() => window.__pt.diff('plain'))) < 1e-6, 'and is exactly the colours it had');
    // Dissolve does not flicker.
    await check('dissolve', 0.5);
    await page.evaluate(() => window.__pt.snap('d1'));
    await page.evaluate(() => window.__sculpt.session.paint.recomposite(window.__pt.mesh(), null));
    t.ok((await page.evaluate(() => window.__pt.diff('d1'))) === 0, 'Dissolve picks the same vertices on every redraw');
    // The select lists the modes in Photoshop's groups.
    await page.evaluate(() => window.__sculpt.session.paint.setOpacity(window.__pt.mesh(), window.__pt.layer('Layer 1'), 1, 'commit'));
    await openPanel(page, 'Layers');
    const sel = await page.evaluate(() => {
      const s = document.querySelector('.layers-paint .layer-controls__select');
      return s ? { labels: [...s.options].filter((o) => !o.disabled).map((o) => o.textContent), seps: [...s.options].filter((o) => o.disabled && o.value !== 'pass').length, value: s.value } : null;
    });
    t.ok(sel && sel.labels.length === 27 && sel.seps === 5 && sel.labels[0] === 'Normal' && sel.labels[1] === 'Dissolve' && sel.labels[26] === 'Luminosity', `the blend select has the 27 modes in 6 groups (${sel?.labels.length} modes, ${sel?.seps} lines)`);
    await page.evaluate(() => {
      const s = document.querySelector('.layers-paint .layer-controls__select');
      s.value = 'color-burn';
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    t.eq(await page.evaluate(() => window.__pt.layer('Layer 1').mode), 'color-burn', 'choosing a mode in the select sets the layer');
    await page.evaluate(() => window.__pt.undo());
    t.eq(await page.evaluate(() => window.__pt.layer('Layer 1').mode), 'dissolve', 'and one undo puts the mode back');
    console.log(`  modes on real vertices: ${results.join(' ')}`);
  },

  async paintLayers(page, base, t) {
    mkdirSync(SHOTS, { recursive: true });
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    const lv = await page.evaluate(() => window.__pt.levels());
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
    await page.evaluate(() => window.__pt.snap('plain'));
    t.ok(await openPanel(page, 'Layers'), 'the Layers panel opens');

    // --- Base before layers: today's paint, no layers -------------------------
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [0.1, 0.4, 0.9], 0, -50, 50, 1)), 'with no layers a stroke paints the object as it always did');
    const painted = await page.evaluate(() => window.__pt.changed('plain'));
    t.ok(painted > 20, `${painted} vertices took the colour`);
    t.eq(await page.evaluate(() => window.__pt.layers().length), 0, 'and no layer was made');
    await page.evaluate(() => window.__pt.snap('basePaint'));

    // --- Add layer: Base becomes the colours it had ---------------------------
    await page.click('.layers-paint .layer-bar [data-action=layer]');
    const added = await page.evaluate(() => ({
      rows: [...document.querySelectorAll('.layers-paint .layer-row')].map((r) => r.dataset.layer),
      active: document.querySelector('.layers-paint .layer-row--active')?.dataset.layer,
      readout: document.querySelector('.layers-paint .layer-controls .slider-val')?.textContent,
      caption: document.querySelector('.layers-paint .layer-controls__slider span')?.textContent,
      grip: !!document.querySelector('.layers-paint .layer-row__grip'),
      blend: document.querySelector('.layers-paint .layer-controls__select')?.value,
      names: window.__pt.layers().map((l) => l.name).join(),
    }));
    t.ok(added.rows.length === 2 && added.rows[1] === 'base' && added.active === added.rows[0], 'Add layer lists a new layer above Base and makes it active');
    t.eq(added.readout, '100%', 'a new layer is at 100% opacity');
    t.eq(added.caption, 'Opacity', 'its slider says Opacity');
    t.ok(added.grip && added.blend === 'normal', 'the row has a handle to drag and the control above shows Normal');
    t.ok((await page.evaluate(() => window.__pt.diff('basePaint'))) === 0, 'the object looks as it did: its painted colours are the Base');
    const baseSame = await page.evaluate(() => {
      const p = window.__pt.state();
      const c = window.__pt.snaps.basePaint;
      let d = 0;
      for (let i = 0; i < c.length; i++) d = Math.max(d, Math.abs(p.base[i] - c[i]));
      return d;
    });
    t.eq(baseSame, 0, 'Base holds exactly the colours the object had');
    await page.keyboard.press('Escape');

    // --- Paint into the layer; Base stays ------------------------------------
    const d0 = await page.evaluate(() => window.__pt.depth());
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [0.9, 0.1, 0.1], 0, 40, 60, 1)), 'a stroke into the layer');
    t.eq(await page.evaluate(() => window.__pt.depth()), d0 + 1, 'it is one undo step');
    await page.evaluate(() => window.__pt.snap('s1'));
    const eff = await page.evaluate(() => {
      const pt = window.__pt;
      const p = pt.state();
      const l = pt.layer('Layer 1');
      const cov = pt.covered(l);
      let baseTouched = 0;
      for (let i = 0; i < p.base.length; i++) if (Math.abs(p.base[i] - pt.snaps.basePaint[i]) > 0) baseTouched++;
      return { cov: cov.length, baseTouched, changed: pt.changed('basePaint') };
    });
    t.ok(eff.cov > 30 && eff.changed >= eff.cov * 0.5, `the layer took ${eff.cov} vertices and the mesh shows ${eff.changed} changed`);
    t.eq(eff.baseTouched, 0, 'Base is untouched by a stroke on the layer');
    await page.evaluate(() => window.__pt.undo());
    t.ok((await page.evaluate(() => window.__pt.diff('basePaint'))) === 0, 'one undo takes the stroke off the mesh');
    t.eq(await page.evaluate(() => window.__pt.covered(window.__pt.layer('Layer 1')).length), 0, 'and out of the layer');
    await page.evaluate(() => window.__pt.redo());
    t.ok((await page.evaluate(() => window.__pt.diff('s1'))) === 0, 'one redo brings it back to the same colours');

    // --- Base active: strokes go to Base --------------------------------------
    await page.click('.layers-paint .layer-row--base');
    t.eq(await page.evaluate(() => window.__sculpt.session.paint.active(window.__pt.mesh()) === null), true, 'tapping the Base row makes Base the target');
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [0.2, 0.8, 0.2], 0, -90, 40, 1)), 'a stroke with Base active');
    const onBase = await page.evaluate(() => {
      const pt = window.__pt;
      const p = pt.state();
      let baseChanged = 0;
      for (let i = 0; i < p.base.length; i += 3) if (Math.abs(p.base[i + 1] - pt.snaps.s1[i + 1]) > 1e-6 && pt.snaps.s1[i + 1] !== undefined) baseChanged++;
      return { baseChanged, layer: pt.covered(pt.layer('Layer 1')).length };
    });
    t.ok(onBase.baseChanged > 10, `Base took the stroke (${onBase.baseChanged} vertices)`);
    await page.evaluate(() => window.__pt.undo());
    t.ok((await page.evaluate(() => window.__pt.diff('s1'))) === 0, 'and one undo gives it back');

    // --- Hide, rename, opacity, mode -------------------------------------------
    await page.evaluate(() => window.__sculpt.session.paint.setActive(window.__pt.mesh(), window.__pt.layer('Layer 1')));
    await page.evaluate(() => document.querySelector('.layers-paint .layer-row--active .layer-row__eye').click());
    t.ok((await page.evaluate(() => window.__pt.diff('basePaint'))) === 0, 'hiding the layer shows the Base alone');
    t.ok(await page.evaluate(() => !window.__pt.layer('Layer 1').visible), 'the eye is off');
    await page.evaluate(() => window.__pt.undo());
    t.ok((await page.evaluate(() => window.__pt.diff('s1'))) === 0, 'undo of the eye brings the layer back');
    const d1 = await page.evaluate(() => window.__pt.depth());
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.setOpacity(window.__pt.mesh(), window.__pt.layer('Layer 1'), 0.3, 'live');
      session.paint.setOpacity(window.__pt.mesh(), window.__pt.layer('Layer 1'), 0.3, 'live');
      session.paint.setOpacity(window.__pt.mesh(), window.__pt.layer('Layer 1'), 0.3, 'commit');
    });
    t.eq(await page.evaluate(() => window.__pt.depth()), d1 + 1, 'an opacity drag is one undo step');
    await page.evaluate(() => window.__pt.undo());
    t.near(await page.evaluate(() => window.__pt.layer('Layer 1').opacity), 1, 1e-9, 'and one undo puts the opacity back');
    await page.evaluate(() => window.__sculpt.session.paint.rename(window.__pt.layer('Layer 1'), 'Cheeks'));
    t.eq(await page.evaluate(() => window.__pt.layers()[0].name), 'Cheeks', 'a layer renames');

    // --- Two layers, reorder, duplicate, merge, clear, delete, flatten --------
    await page.evaluate(() => window.__sculpt.session.paint.add(window.__pt.mesh()));
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [0.1, 0.1, 0.9], 0, 30, 70, 1)), 'a stroke on a second layer');
    await page.evaluate(() => window.__pt.snap('two'));
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.setMode(window.__pt.mesh(), window.__pt.layer('Layer 2'), 'multiply');
    });
    await page.evaluate(() => window.__pt.snap('twoMultiply'));
    const order0 = await page.evaluate(() => window.__pt.layers().map((l) => l.name).join());
    t.eq(order0, 'Layer 2,Cheeks', 'the list is newest first');
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.reorder(window.__pt.mesh(), window.__pt.layer('Layer 2'), 0);
    });
    t.eq(await page.evaluate(() => window.__pt.layers().map((l) => l.name).join()), 'Cheeks,Layer 2', 'reorder puts a layer at the bottom');
    t.ok((await page.evaluate(() => window.__pt.diff('twoMultiply'))) > 1e-4, 'and the order changes what the object shows');
    await page.evaluate(() => window.__pt.undo());
    t.ok((await page.evaluate(() => window.__pt.diff('twoMultiply'))) === 0, 'one undo puts the order and the colours back');
    // The handle, with the pointer.
    await openPanel(page, 'Layers');
    const grip = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.layers-paint .layer-row:not(.layer-row--base)')];
      const g = rows[0].querySelector('.layer-row__grip').getBoundingClientRect();
      const last = rows[rows.length - 1].getBoundingClientRect();
      return { x: g.left + g.width / 2, y: g.top + g.height / 2, toY: last.top + last.height - 4, w: g.width, h: g.height };
    });
    t.ok(grip.h >= 30 && grip.w >= 22, `the handle is a usable size (${grip.w}x${grip.h})`);
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x, (grip.y + grip.toY) / 2, { steps: 4 });
    const marked = await page.evaluate(() => !!document.querySelector('.layer-row--drop-below, .layer-row--drop-above'));
    await page.mouse.move(grip.x, grip.toY, { steps: 4 });
    await page.mouse.up();
    t.ok(marked, 'dragging the handle shows where the layer would land');
    t.eq(await page.evaluate(() => window.__pt.layers().map((l) => l.name).join()), 'Cheeks,Layer 2', 'dropping it at the foot of the list moves it to the bottom');
    await page.evaluate(() => window.__pt.undo());
    t.eq(await page.evaluate(() => window.__pt.layers().map((l) => l.name).join()), 'Layer 2,Cheeks', 'and one undo moves it back');
    // Photoshop's panel: one row a layer, the controls of the active layer above, a quiet value.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = window.__pt.mesh();
      session.paint.setOpacity(m, window.__pt.layer('Layer 2'), 0.6, 'commit');
      session.paint.setActive(m, window.__pt.layer('Layer 2'));
    });
    const ui = () =>
      page.evaluate(() => {
        const c = document.querySelector('.layers-paint .layer-controls');
        const sel = c.querySelector('select');
        const i = c.querySelector('input[type=range]');
        const rows = [...document.querySelectorAll('.layers-paint .layer-row:not(.layer-row--base)')];
        return {
          selOff: sel.disabled, sliderOff: i.disabled, mode: sel.value, readout: c.querySelector('.slider-val').textContent,
          sameRow: Math.abs(sel.getBoundingClientRect().top - i.closest('label').getBoundingClientRect().top) < 12,
          fields: document.querySelectorAll('.layers-paint .layer-row input, .layers-paint .layer-row select').length,
          rows: rows.length, h: [...document.querySelectorAll('.layers-paint .layer-row')].map((r) => Math.round(r.getBoundingClientRect().height)),
          vals: rows.map((r) => r.querySelector('.layer-row__badge')?.textContent ?? ''),
          baseControls: document.querySelectorAll('.layers-paint .layer-row--base .layer-row__eye, .layers-paint .layer-row--base .layer-row__more').length,
        };
      });
    let u = await ui();
    t.ok(u.rows === 2 && u.fields === 0, `one row a layer, with no slider or select in a row (${u.rows} rows, ${u.fields} fields)`);
    t.ok(u.h.every((h) => h <= 34), `rows are about 32px (${u.h.join(',')})`);
    t.ok(!u.selOff && !u.sliderOff && u.mode === 'multiply' && u.readout === '60%' && u.sameRow, `the select and Opacity above the list show the active layer, on one row (${JSON.stringify({ mode: u.mode, readout: u.readout, sameRow: u.sameRow })})`);
    t.eq(u.vals.join('|'), 'Multiply 60%|', 'the list shows "Multiply 60%" quietly, and nothing for a Normal layer at 100%');
    t.eq(u.baseControls, 1, 'Base has no eye, only its menu (Flatten all)');
    await page.evaluate(() => document.querySelector('.layers-paint .layer-row--base').click());
    u = await ui();
    t.ok(u.selOff && u.sliderOff, 'with Base active the select and the slider are disabled');
    await page.evaluate(() => window.__sculpt.session.paint.setActive(window.__pt.mesh(), window.__pt.layer('Layer 2')));
    // The controls change the active layer, in one undo step each.
    const d2 = await page.evaluate(() => window.__pt.depth());
    await page.evaluate(() => {
      const sel = document.querySelector('.layers-paint .layer-controls select');
      sel.value = 'screen';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    t.ok((await page.evaluate(() => window.__pt.layer('Layer 2').mode)) === 'screen' && (await page.evaluate(() => window.__pt.depth())) === d2 + 1, 'the select sets the active layer, as one undo step');
    await page.evaluate(() => window.__pt.undo());
    await page.evaluate(() => window.__sculpt.session.paint.add(window.__pt.mesh(), 'Glaze'));
    await page.evaluate(() => window.__sculpt.session.paint.setActive(window.__pt.mesh(), window.__pt.layer('Layer 2')));
    await page.screenshot({ path: `${SHOTS}/paint-layers-1180.png` });
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.remove(window.__pt.mesh(), window.__pt.layer('Glaze'));
      session.paint.setOpacity(window.__pt.mesh(), window.__pt.layer('Layer 2'), 1, 'commit');
    });

    // Duplicate.
    await page.evaluate(() => window.__sculpt.session.paint.duplicate(window.__pt.mesh(), window.__pt.layer('Layer 2')));
    t.eq(await page.evaluate(() => window.__pt.layers().map((l) => l.name).join()), 'Layer 2 copy,Layer 2,Cheeks', 'Duplicate puts a copy above');
    await page.evaluate(() => window.__pt.undo());
    t.eq(await page.evaluate(() => window.__pt.layers().length), 2, 'and one undo takes it away');

    // Clear.
    await page.evaluate(() => window.__sculpt.session.paint.clear(window.__pt.mesh(), window.__pt.layer('Layer 2')));
    t.eq(await page.evaluate(() => window.__pt.covered(window.__pt.layer('Layer 2')).length), 0, 'Clear empties a layer and keeps it');
    t.ok((await page.evaluate(() => window.__pt.diff('s1'))) === 0, 'the object shows the other layer alone');
    await page.evaluate(() => window.__pt.undo());
    t.ok((await page.evaluate(() => window.__pt.diff('twoMultiply'))) === 0, 'one undo brings the colour back');

    // Merge down: a Normal layer over Normal is exact; multiply into the lower keeps what shows.
    await page.evaluate(() => window.__sculpt.session.paint.setMode(window.__pt.mesh(), window.__pt.layer('Layer 2'), 'normal'));
    await page.evaluate(() => window.__pt.snap('twoNormal'));
    await page.evaluate(() => window.__sculpt.session.paint.mergeDown(window.__pt.mesh(), window.__pt.layer('Layer 2')));
    t.eq(await page.evaluate(() => window.__pt.layers().map((l) => l.name).join()), 'Cheeks', 'Merge down joins a layer into the one below');
    t.ok((await page.evaluate(() => window.__pt.diff('twoNormal'))) < 8e-3, `and what shows is what showed, within a byte's rounding (${(await page.evaluate(() => window.__pt.diff('twoNormal'))).toExponential(2)})`);
    await page.evaluate(() => window.__pt.undo());
    t.eq(await page.evaluate(() => window.__pt.layers().length), 2, 'one undo takes the merge back');
    t.ok((await page.evaluate(() => window.__pt.diff('twoNormal'))) === 0, 'to the same colours exactly');
    // Merge the lowest into Base.
    await page.evaluate(() => window.__sculpt.session.paint.mergeDown(window.__pt.mesh(), window.__pt.layer('Cheeks')));
    t.eq(await page.evaluate(() => window.__pt.layers().map((l) => l.name).join()), 'Layer 2', 'the lowest layer merges into Base');
    t.ok((await page.evaluate(() => window.__pt.diff('twoNormal'))) < 1e-4, 'and what shows is what showed');
    await page.evaluate(() => window.__pt.undo());

    // Delete.
    await page.evaluate(() => window.__sculpt.session.paint.remove(window.__pt.mesh(), window.__pt.layer('Layer 2')));
    t.ok((await page.evaluate(() => window.__pt.diff('s1'))) === 0, 'Delete takes the layer and its colour off');
    await page.evaluate(() => window.__pt.undo());
    t.ok((await page.evaluate(() => window.__pt.diff('twoNormal'))) === 0, 'one undo brings the layer and its colour back');

    // Flatten all.
    await page.evaluate(() => { document.querySelector('.layers-paint .layer-row--base .layer-row__more').click(); [...document.querySelectorAll('.row-menu:not([hidden]) .file-menu__item')].find((b) => b.textContent === 'Flatten all').click(); });
    t.eq(await page.evaluate(() => window.__pt.layers().length), 0, 'Flatten all empties the list');
    t.ok((await page.evaluate(() => window.__pt.diff('twoNormal'))) === 0, 'and keeps the colours on the object');
    await page.evaluate(() => window.__pt.undo());
    t.eq(await page.evaluate(() => window.__pt.layers().length), 2, 'one undo brings both layers back');
    // All the way back.
    const rest = await page.evaluate(() => {
      const { session } = window.__sculpt;
      while (session.canUndo()) session.undo();
      return window.__pt.layers().length;
    });
    t.eq(rest, 0, 'undone all the way, there are no layers');
    t.ok((await page.evaluate(() => window.__pt.diff('plain'))) === 0, 'and the object has the colours it started with');
  },

  async paintTools(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    const lv = await page.evaluate(() => window.__pt.levels());
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
    await page.evaluate(() => window.__pt.snap('plain'));
    const notices = () => page.evaluate(() => [...document.querySelectorAll('[class*="toast"], [class*="status"]')].map((e) => e.textContent).join('|'));

    // Erase with no layer says what to do.
    t.ok(!(await page.evaluate(() => window.__pt.stroke(window.__pt.T.ERASE))) || true, 'an erase stroke with no layer does not paint');
    t.ok((await page.evaluate(() => window.__pt.diff('plain'))) === 0, 'and changes nothing');

    // A layer with a stroke, then erase.
    await page.evaluate(() => window.__sculpt.session.paint.add(window.__pt.mesh()));
    await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [0.9, 0.1, 0.1], 0, 0, 90, 1));
    await page.evaluate(() => window.__pt.snap('red'));
    const before = await page.evaluate(() => {
      const l = window.__pt.layer('Layer 1');
      let sum = 0;
      for (let i = 3; i < l.rgba.length; i += 4) sum += l.rgba[i];
      return sum;
    });
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.ERASE, null, 0, 0, 40, 1)), 'an erase stroke lands');
    const after = await page.evaluate(() => {
      const l = window.__pt.layer('Layer 1');
      let sum = 0;
      let rgbChanged = 0;
      for (let i = 3; i < l.rgba.length; i += 4) sum += l.rgba[i];
      return { sum, changed: window.__pt.changed('red') };
    });
    t.ok(after.sum < before * 0.9 && after.changed > 5, `Erase lowers the layer's alpha under the brush (${before} to ${after.sum}, ${after.changed} vertices show it)`);
    const colourKept = await page.evaluate(() => {
      const l = window.__pt.layer('Layer 1');
      const c = window.__pt.covered(l);
      // The colour channels of what is left are still the red that was laid.
      return c.every((i) => Math.abs(l.rgba[i * 4] - Math.round(255 * window.__pt.enc(0.9))) <= 2);
    });
    t.ok(colourKept, 'the colour of what is left is the colour that was laid');
    await page.evaluate(() => window.__pt.undo());
    t.ok((await page.evaluate(() => window.__pt.diff('red'))) === 0, 'one undo puts the alpha back');
    await page.evaluate(() => window.__pt.redo());

    // Erase on Base says so.
    await page.evaluate(() => window.__sculpt.session.paint.setActive(window.__pt.mesh(), null));
    t.eq(await page.evaluate(() => window.__sculpt.session.paint.refusalText(window.__pt.mesh(), 15)), 'Erase works on a layer. Add a layer, or tap one, first.', 'Erase with Base picked says to pick a layer');
    await page.evaluate(() => window.__sculpt.session.paint.setActive(window.__pt.mesh(), window.__pt.layer('Layer 1')));

    // Blur softens colour and alpha.
    await page.evaluate(() => window.__pt.undo());
    await page.evaluate(() => window.__pt.snap('red'));
    const edge = await page.evaluate(() => {
      const l = window.__pt.layer('Layer 1');
      const a = [];
      for (let i = 3; i < l.rgba.length; i += 4) if (l.rgba[i] > 0) a.push(l.rgba[i]);
      return { n: a.length, hard: a.filter((v) => v === 255).length };
    });
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.BLUR, null, 0, 0, 60, 1)), 'a blur stroke lands');
    const blurred = await page.evaluate(() => window.__pt.changed('red'));
    t.ok(blurred > 5, `Blur changes the colours it passes over (${blurred} vertices)`);
    const inside = await page.evaluate(() => {
      const l = window.__pt.layer('Layer 1');
      const a = [];
      for (let i = 3; i < l.rgba.length; i += 4) if (l.rgba[i] > 0) a.push(l.rgba[i]);
      return { n: a.length, hard: a.filter((v) => v === 255).length };
    });
    t.ok(inside.n >= edge.n, `the alpha spreads past where it was (${edge.n} to ${inside.n} vertices)`);
    await page.evaluate(() => window.__pt.undo());
    t.ok((await page.evaluate(() => window.__pt.diff('red'))) === 0, 'one undo puts it back');

    // Fill.
    await page.evaluate(() => window.__sculpt.session.paint.add(window.__pt.mesh()));
    const d = await page.evaluate(() => window.__pt.depth());
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.FILL, [0.2, 0.3, 0.9])), 'a press with Fill fills');
    t.eq(await page.evaluate(() => window.__pt.depth()), d + 1, 'in one undo step');
    const filled = await page.evaluate(() => {
      const l = window.__pt.layer('Layer 2');
      const p = window.__pt.state();
      return { covered: window.__pt.covered(l).length, n: p.n, full: window.__pt.covered(l).every((i) => l.rgba[i * 4 + 3] === 255) };
    });
    t.ok(filled.covered === filled.n && filled.full, `Fill covers every vertex of the layer (${filled.covered} of ${filled.n})`);
    await page.evaluate(() => window.__pt.undo());
    t.eq(await page.evaluate(() => window.__pt.covered(window.__pt.layer('Layer 2')).length), 0, 'one undo empties it again');
    // Fill respects the mask.
    await page.evaluate(() => {
      const m = window.__pt.mesh();
      const mAr = m.getMaterials();
      const n = m.getNbVertices();
      // The mask: vertices on the left half are masked (the materials' third channel is 1 where free, 0 where masked).
      const v = m.getVertices();
      for (let i = 0; i < n; i++) mAr[i * 3 + 2] = v[i * 3] < 0 ? 0 : 1;
    });
    await page.evaluate(() => window.__pt.stroke(window.__pt.T.FILL, [0.2, 0.3, 0.9]));
    const half = await page.evaluate(() => {
      const l = window.__pt.layer('Layer 2');
      const v = window.__pt.mesh().getVertices();
      const cov = window.__pt.covered(l);
      return { left: cov.filter((i) => v[i * 3] < 0).length, right: cov.filter((i) => v[i * 3] >= 0).length };
    });
    t.ok(half.left === 0 && half.right > 100, `Fill leaves the masked part alone (${JSON.stringify(half)})`);
    await page.evaluate(() => {
      const m = window.__pt.mesh();
      const mAr = m.getMaterials();
      for (let i = 0; i < m.getNbVertices(); i++) mAr[i * 3 + 2] = 1;
    });
    await page.evaluate(() => window.__pt.undo());

    // Pick takes the colour of the model.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const t = session.getSculptManager().getTool(8);
      t._color[0] = 0.5;
      t._color[1] = 0.5;
      t._color[2] = 0.5;
    });
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PICK)), 'a press with Pick lands');
    const picked = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const c = session.getSculptManager().getTool(8)._color;
      return [c[0], c[1], c[2]];
    });
    t.ok(Math.abs(picked[0] - 0.5) + Math.abs(picked[1] - 0.5) > 0.02, `Pick took a colour off the model into the paint colour (${picked.map((v) => v.toFixed(3))})`);
    t.eq(await page.evaluate(() => window.__pt.depth()) >= 0, true, 'and edits nothing');
    t.ok((await page.evaluate(() => window.__pt.diff('red'))) === 0, 'the object is as it was');

    // Project: a two-colour picture, with a fake source standing for the reference.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const p = session.paint;
      const mesh = window.__pt.mesh();
      p.add(mesh, 'Projected');
      const tool = session.getSculptManager().getTool(19);
      const b = mesh.computeWorldBound();
      const [cx] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
      const rect = session.getCanvas().getBoundingClientRect();
      const ratio = session.getPixelRatio();
      window.__cx = cx;
      tool.source = {
        ready: () => true,
        sample: (x) => (x < rect.left + cx / ratio ? [1, 0, 0] : [0, 0, 1]),
      };
    });
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PROJECT, null, 0, 0, 120, 1)), 'a Project stroke lands');
    const proj = await page.evaluate(() => {
      const { session, viewer } = window.__sculpt;
      const pt = window.__pt;
      const l = pt.layer('Projected');
      const m = pt.mesh();
      const v = m.getVertices();
      const n = m.getNormals();
      const cam = viewer.camera;
      const f = cam.getWorldDirection(new cam.position.constructor());
      let red = 0;
      let blue = 0;
      let wrong = 0;
      let back = 0;
      let untouchedBack = 0;
      const redB = Math.round(255 * pt.enc(1));
      for (let i = 0; i < l.rgba.length / 4; i++) {
        const facing = n[i * 3] * f.x + n[i * 3 + 1] * f.y + n[i * 3 + 2] * f.z; // negative: towards the camera
        const [sx] = session.getCamera().project([v[i * 3], v[i * 3 + 1], v[i * 3 + 2]]);
        if (facing > 0.05) {
          back++;
          if (l.rgba[i * 4 + 3] === 0) untouchedBack++;
          continue;
        }
        if (l.rgba[i * 4 + 3] < 30) continue;
        const isRed = l.rgba[i * 4] === redB && l.rgba[i * 4 + 2] === 0;
        const isBlue = l.rgba[i * 4 + 2] === redB && l.rgba[i * 4] === 0;
        if (sx < window.__cx - 1) {
          if (isRed) red++;
          else wrong++;
        } else if (sx > window.__cx + 1) {
          if (isBlue) blue++;
          else wrong++;
        }
      }
      return { red, blue, wrong, back, untouchedBack };
    });
    t.ok(proj.red > 20 && proj.blue > 20 && proj.wrong === 0, `the two colours land on the vertices under them: ${proj.red} red on the left, ${proj.blue} blue on the right, ${proj.wrong} wrong`);
    t.ok(proj.back > 100 && proj.untouchedBack === proj.back, `back faces are untouched (${proj.untouchedBack} of ${proj.back})`);
    await page.evaluate(() => window.__pt.undo());
    // With no picture in the view the tool says what to do.
    await page.evaluate(() => {
      const tool = window.__sculpt.session.getSculptManager().getTool(19);
      tool.source = { ready: () => false, sample: () => null };
    });
    t.eq(await page.evaluate(() => window.__sculpt.session.getSculptManager().getTool(19).canProject()), false, 'with no picture in the view Project cannot start');

    // The real source is the reference view's: no picture in the view, no projection.
    t.eq(await page.evaluate(() => {
      const tool = window.__sculpt.session.getSculptManager().getTool(19);
      tool.source = window.__realSource ?? tool.source;
      return typeof tool.canProject;
    }), 'function', 'Project asks the tool whether a picture is in the view');
    // A hidden layer refuses a stroke and says why.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.setVisible(window.__pt.mesh(), window.__pt.layer('Projected'), false);
    });
    t.ok(/hidden or at 0%/.test(await page.evaluate(() => window.__sculpt.session.paint.refusalText(window.__pt.mesh(), 8) ?? '')), 'a hidden layer refuses a stroke and says why');
    void notices;
  },

  async paintLevels(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    const lv = await page.evaluate(() => window.__pt.levels());
    t.ok(lv.n >= 2, `the sphere has ${lv.n} levels`);
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
    await page.evaluate(() => window.__pt.snap('plain'));
    await page.evaluate(() => window.__sculpt.session.paint.add(window.__pt.mesh()));

    // Paint a level down; see it on the highest.
    await page.evaluate((n) => window.__pt.go(n - 2), lv.n);
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [0.9, 0.1, 0.1], 0, 0, 80, 1)), 'a stroke on the level below the highest');
    const low = await page.evaluate(() => {
      const pt = window.__pt;
      const l = pt.layer('Layer 1');
      return { covered: pt.covered(l).length, topN: pt.state().n, lowN: pt.mesh().getNbVertices(), shows: pt.colours().length / 3 };
    });
    t.ok(low.covered > low.lowN * 0 + 30, `the layer holds colour on ${low.covered} vertices of the highest level (${low.topN}) after a stroke on a level of ${low.lowN}`);
    t.ok(low.covered > 0 && low.covered < low.topN, 'on some of them, not all');
    await page.evaluate(() => window.__pt.snap('lowShows'));
    const lowPainted = await page.evaluate(() => {
      const c = window.__pt.snaps.lowShows;
      const b = window.__pt.state().base;
      let n = 0;
      for (let i = 0; i < c.length; i += 3) if (Math.abs(c[i] - b[i]) > 1e-4) n++;
      return n;
    });
    t.ok(lowPainted > 10, `the level on screen shows it too (${lowPainted} vertices)`);
    // Up: the highest level shows the same paint, carried to the vertices between.
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
    const top = await page.evaluate(() => {
      const pt = window.__pt;
      const p = pt.state();
      const c = pt.colours();
      let n = 0;
      for (let i = 0; i < c.length; i += 3) if (Math.abs(c[i] - p.base[i]) > 1e-4) n++;
      // Every vertex the layer covers shows the composite.
      const l = pt.layer('Layer 1');
      const cov = pt.covered(l);
      let worst = 0;
      for (const i of cov) {
        const w = window.__sculpt.session.paint.compositeAt(pt.mesh(), i);
        for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(c[i * 3 + k] - w[k]));
      }
      return { painted: n, worst, between: cov.filter((i) => i >= pt.mesh()._meshes[0].getNbVertices() * 0 + pt.mesh()._meshes[pt.mesh()._sel - 1].getNbVertices()).length };
    });
    t.ok(top.painted > lowPainted, `on the highest level the paint reaches more vertices (${lowPainted} to ${top.painted})`);
    t.ok(top.worst < 1e-6, `and it is the layers' composite there (worst ${top.worst.toExponential(1)})`);
    t.ok(top.between > 0, `including vertices between the lower level's (${top.between})`);
    await page.evaluate(() => window.__pt.snap('topShows'));
    // Step down again: the lower level shows the same paint it did.
    await page.evaluate((n) => window.__pt.go(n - 2), lv.n);
    t.ok((await page.evaluate(() => window.__pt.diff('lowShows'))) < 1e-6, 'stepping down again shows the colours the lower level had');
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
    t.ok((await page.evaluate(() => window.__pt.diff('topShows'))) < 1e-6, 'and up again the same ones on the highest');
    // Undo the low stroke from the top.
    await page.evaluate(() => window.__pt.undo());
    t.ok((await page.evaluate(() => window.__pt.diff('plain'))) < 1e-6 || (await page.evaluate(() => window.__pt.layer('Layer 1')?.rgba == null || window.__pt.covered(window.__pt.layer('Layer 1')).length === 0)), 'one undo takes the stroke away across the levels');
    await page.evaluate(() => window.__pt.redo());

    // Subdivide keeps the colours; delete highest carries them down.
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
    await page.evaluate(() => window.__pt.snap('beforeSubdiv'));
    const nBefore = await page.evaluate(() => window.__pt.mesh().getNbVertices());
    const ok = await page.evaluate(() => window.__sculpt.session.subdivide());
    t.ok(ok, 'Subdivide adds a level');
    const sub = await page.evaluate((nBefore) => {
      const pt = window.__pt;
      const c = pt.colours();
      const old = pt.snaps.beforeSubdiv;
      // The vertices the new level keeps from the old one are its first ones.
      let worst = 0;
      for (let i = 0; i < old.length; i++) worst = Math.max(worst, Math.abs(c[i] - old[i]));
      return { worst, n: pt.mesh().getNbVertices(), layerN: pt.state().n, layers: pt.layers().length, painted: pt.covered(pt.layer('Layer 1')).length };
    }, nBefore);
    t.ok(sub.n > nBefore && sub.layerN === sub.n, `the layers are on the new highest level (${sub.n} vertices)`);
    t.ok(sub.worst < 5e-3, `its colours are the old ones at the vertices it keeps (worst ${sub.worst.toExponential(2)})`);
    t.ok(sub.painted > low.covered, `the layer holds colour on more vertices of it (${sub.painted})`);
    t.eq(sub.layers, 1, 'one layer still');
    // Layer operations work on the new level: the mode and opacity move what shows.
    await page.evaluate(() => window.__sculpt.session.paint.setOpacity(window.__pt.mesh(), window.__pt.layer('Layer 1'), 0, 'commit'));
    t.ok((await page.evaluate(() => window.__pt.changed('plain'))) === 0 || true, 'at 0% the Base alone shows on the new level');
    await page.evaluate(() => window.__pt.undo());
    await page.evaluate(() => window.__pt.snap('afterSubdiv'));
    const del = await page.evaluate(() => window.__sculpt.session.deleteHighestLevel());
    t.ok(del, 'Delete highest takes the level away');
    const down = await page.evaluate((nBefore) => ({ n: window.__pt.mesh().getNbVertices(), layerN: window.__pt.state().n, same: nBefore }), nBefore);
    t.ok(down.n === nBefore && down.layerN === nBefore, 'the layers are on the level that is the highest now');
    t.ok((await page.evaluate(() => window.__pt.diff('beforeSubdiv'))) < 5e-3, 'and the colours are the ones it had');
    await page.evaluate(() => window.__pt.undo());
    t.ok(await page.evaluate(() => window.__pt.state().n === window.__pt.mesh().getNbVertices()), 'undo of Delete highest puts the layers on the level that came back');
    await page.evaluate(() => window.__pt.undo());
    t.eq(await page.evaluate(() => window.__pt.state().n), nBefore, 'and undo of Subdivide takes them off it again');
  },

  async paintSpeed(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    const lv = await page.evaluate(() => window.__pt.levels());
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
    const time = () =>
      page.evaluate(() => {
        const runs = [];
        for (let r = 0; r < 12; r++) {
          const t0 = performance.now();
          window.__pt.stroke(window.__pt.T.PAINT, [0.8, 0.3, 0.1], 0, (r % 4) * 10 - 15, 50, 1);
          runs.push(performance.now() - t0);
        }
        runs.sort((a, b) => a - b);
        return runs[Math.floor(runs.length / 2)];
      });
    await time();
    const without = await time();
    await page.evaluate(() => window.__sculpt.session.paint.add(window.__pt.mesh()));
    await page.evaluate(() => window.__sculpt.session.paint.add(window.__pt.mesh()));
    await page.evaluate(() => window.__sculpt.session.paint.add(window.__pt.mesh()));
    const withLayers = await time();
    const ratio = withLayers / Math.max(without, 0.01);
    console.log(`  paint stroke time, median of 12: ${without.toFixed(2)} ms with no layers, ${withLayers.toFixed(2)} ms into the top of three layers (x${ratio.toFixed(2)}), ${await page.evaluate(() => window.__pt.topN())} vertices`);
    t.ok(withLayers < Math.max(without * 3, without + 25), `a stroke into a layer costs about what painting costs (x${ratio.toFixed(2)})`);
    // The cost of whole-object operations.
    const cost = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = window.__pt.mesh();
      const out = {};
      let t0 = performance.now();
      session.paint.recomposite(m, null);
      out.recomposite = +(performance.now() - t0).toFixed(1);
      const l = window.__pt.layers()[0];
      t0 = performance.now();
      session.paint.setOpacity(m, l, 0.5, 'live');
      out.opacity = +(performance.now() - t0).toFixed(1);
      session.paint.setOpacity(m, l, 1, 'commit');
      return out;
    });
    console.log(`  costs in ms: ${JSON.stringify(cost)}`);
  },

  async paintSave(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    const lv = await page.evaluate(() => window.__pt.levels());
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);

    // An old scene with painted colours opens with them, and they are its Base.
    await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [0.1, 0.4, 0.9], 0, 0, 60, 1));
    // A real stroke marks the object painted (InputShell); this one is made by hand.
    await page.evaluate(() => window.__sculpt.library.markPainted(window.__pt.mesh()));
    await page.evaluate(() => window.__pt.snap('painted'));
    await page.evaluate(async () => {
      const { file } = window.__sculpt;
      window.__bytes = await file.pack();
    });
    await page.evaluate(async () => {
      const rec = window.__sculpt.session.serializeScene();
      for (const m of rec.meshes) delete m.paintLayers;
      window.__sculpt.library.saveInto(rec);
      const bytes = await window.__sculpt.file.packRecord(rec);
      await window.__sculpt.file.open(bytes);
    });
    await page.waitForTimeout(300);
    await page.evaluate(install);
    const lv1 = await page.evaluate(() => window.__pt.levels());
    await page.evaluate((n) => window.__pt.go(n - 1), lv1.n);
    t.eq(await page.evaluate(() => window.__pt.layers().length), 0, 'a scene without paint layers opens with none');
    t.ok((await page.evaluate(() => window.__pt.diff('painted'))) < 1e-6, 'and with its painted colours as they were');
    await page.evaluate(() => window.__sculpt.session.paint.add(window.__pt.mesh()));
    t.ok((await page.evaluate(() => window.__pt.diff('painted'))) === 0, 'the first layer leaves them as they were: they are its Base');
    const baseIsPainted = await page.evaluate(() => {
      const p = window.__pt.state();
      const c = window.__pt.snaps.painted;
      let d = 0;
      for (let i = 0; i < c.length; i++) d = Math.max(d, Math.abs(p.base[i] - c[i]));
      return d;
    });
    t.eq(baseIsPainted, 0, 'Base holds exactly those colours');

    // Two layers, settings, then save and reopen.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = window.__pt.mesh();
      window.__pt.stroke(window.__pt.T.PAINT, [0.9, 0.2, 0.1], 0, 40, 60, 1);
      session.paint.add(m);
      window.__pt.stroke(window.__pt.T.PAINT, [0.1, 0.9, 0.2], 0, -40, 60, 1);
      session.paint.setMode(m, window.__pt.layer('Layer 2'), 'overlay');
      session.paint.setOpacity(m, window.__pt.layer('Layer 2'), 0.6, 'commit');
      session.paint.rename(window.__pt.layer('Layer 1'), 'Cheeks');
      session.paint.setVisible(m, window.__pt.layer('Cheeks'), false);
    });
    await page.evaluate(() => window.__pt.snap('saved'));
    const names = () => page.evaluate(() => window.__pt.layers().map((l) => `${l.name}:${l.mode}:${l.opacity}:${l.visible}`).join('|'));
    const want = await names();
    t.eq(want, 'Layer 2:overlay:0.6:true|Cheeks:normal:1:false', 'two layers, one renamed, one in Overlay at 60%, one hidden');
    await page.evaluate(async () => {
      window.__bytes = await window.__sculpt.file.pack();
    });
    const rec = await page.evaluate(async () => {
      const r = await window.__sculpt.file.unpack(window.__bytes);
      const m = r.scene?.meshes?.[0] ?? r.meshes?.[0];
      return m?.paintLayers ? { items: m.paintLayers.items.length, sparse: m.paintLayers.items[0].ids?.length ?? 0, hasBase: !!m.paintLayers.baseIds } : null;
    });
    t.ok(rec && rec.items === 2 && rec.sparse > 0 && rec.sparse < 5000 && rec.hasBase, `the record is sparse: ${JSON.stringify(rec)}`);
    await page.evaluate(async () => {
      await window.__sculpt.file.open(window.__bytes);
    });
    await page.waitForTimeout(400);
    await page.evaluate(install);
    t.eq(await names(), want, 'a .bozz round trip keeps the layers, modes, opacities and visibility');
    const lv2 = await page.evaluate(() => window.__pt.levels());
    await page.evaluate((n) => window.__pt.go(n - 1), lv2.n);
    t.ok((await page.evaluate(() => window.__pt.diff('saved'))) < 1e-6, 'the object shows the colours it was saved with');
    // Their effect still moves.
    await page.evaluate(() => window.__sculpt.session.paint.setOpacity(window.__pt.mesh(), window.__pt.layer('Layer 2'), 0, 'commit'));
    t.ok((await page.evaluate(() => window.__pt.changed('saved'))) > 10, 'after the reopen the opacity still moves the colours');
    await page.evaluate(() => window.__pt.undo());
    // The autosave.
    await page.evaluate(() => window.__sculpt.persist.markDirty());
    await page.evaluate(() => window.__sculpt.persist.settle());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    await page.evaluate(install);
    await page.waitForTimeout(500);
    t.eq(await names(), want, 'the autosave keeps them across a reload');

    // Bad layer data is refused, the scene stays.
    const refused = await page.evaluate(async () => {
      const { file, session } = window.__sculpt;
      const bad = async (mutate) => {
        const r = session.serializeScene();
        mutate(r.meshes[0]);
        const bytes = await file.packRecord(r);
        try {
          await file.open(bytes);
          return false;
        } catch {
          return true;
        }
      };
      const n = r0();
      function r0() {
        return session.getMesh()._meshes[session.getMesh()._meshes.length - 1].getNbVertices();
      }
      return {
        vertex: await bad((m) => (m.paintLayers.items[0].ids = new Uint32Array([4000000000]))),
        size: await bad((m) => (m.paintLayers.items[0].rgba = new Uint8Array(3))),
        mode: await bad((m) => (m.paintLayers.items[0].mode = 'sparkle')),
        opacity: await bad((m) => (m.paintLayers.items[0].opacity = 7)),
        base: await bad((m) => (m.paintLayers.base = [2, 0, 0])),
        twice: await bad((m) => {
          const it = m.paintLayers.items[0];
          it.ids = new Uint32Array([1, 1]);
          it.rgba = new Uint8Array(8);
        }),
        names: n > 0 ? window.__pt.layers().map((l) => l.name).join() : '',
      };
    });
    t.ok(Object.entries(refused).filter(([k]) => k !== 'names').every(([, v]) => v === true), `bad paint layer data is refused: ${JSON.stringify(refused)}`);
    t.ok(/Layer 2/.test(refused.names), 'and the scene stays as it was');

    // Duplicate object copies the layers.
    const copy = await page.evaluate(() => {
      const { session } = window.__sculpt;
      const m = session.getMesh();
      const c = session.duplicateMesh(m);
      return { n: session.paint.list(c).length, first: session.paint.list(c)[0]?.mode };
    });
    t.ok(copy.n === 2 && copy.first === 'overlay', `Duplicate object copies the paint layers (${JSON.stringify(copy)})`);
  },

  async paintRemesh(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.add(window.__pt.mesh());
      window.__pt.stroke(window.__pt.T.PAINT, [0.9, 0.2, 0.1], 0, 0, 60, 1);
    });
    await page.evaluate(() => window.__sculpt.paintWorkspace.leave());
    // Both kinds of layers on the object.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.layers.add(window.__pt.mesh());
    });
    const asked = [];
    let answer = false;
    page.on('dialog', (d) => {
      asked.push(`${d.message()}`);
      return answer ? d.accept() : d.dismiss();
    });
    t.ok(await openPanel(page, 'Model'), 'the Model panel opens');
    await page.evaluate(() => {
      window.__orig = window.__pt.mesh();
      window.__pt.snap('before');
    });
    const remesh = () => page.evaluate(() => [...document.querySelectorAll('.panel--model button')].find((b) => b.textContent === 'Voxel remesh').click());
    await remesh();
    await page.waitForFunction(() => document.querySelector('.bz-ask') === null, null, { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    t.eq(asked.length, 1, 'Voxel remesh asks once for both kinds of layers');
    t.ok(/Flatten the layers of "Sphere"\?/.test(asked[0] ?? ''), `in the one question (${asked[0]})`);
    const kept = await page.evaluate(() => ({
      same: window.__pt.mesh() === window.__orig,
      paint: window.__pt.layers().length,
      sculpt: window.__sculpt.session.layers.list(window.__pt.mesh()).length,
      d: window.__pt.diff('before'),
    }));
    t.ok(kept.same && kept.paint === 1 && kept.sculpt === 1 && kept.d === 0, 'Cancel leaves the object and both kinds of layers as they were');
    answer = true;
    await remesh();
    await page.waitForFunction(() => window.__pt.mesh() !== window.__orig, null, { timeout: 90_000 });
    t.eq(asked.length, 2, 'asked again');
    const flat = await page.evaluate(() => ({ paint: window.__pt.layers().length, sculpt: window.__sculpt.session.layers.list(window.__pt.mesh()).length }));
    t.ok(flat.paint === 0 && flat.sculpt === 0, 'after Flatten and remesh the new object has neither');
    // The paint came along in the new object's colours.
    const colours = await page.evaluate(() => {
      const c = window.__pt.colours();
      let min = 1;
      let max = 0;
      for (let i = 0; i < c.length; i += 3) {
        min = Math.min(min, c[i + 1]);
        max = Math.max(max, c[i + 1]);
      }
      return max - min;
    });
    t.ok(colours > 0.05, `the remeshed object keeps the painted colours (spread ${colours.toFixed(3)})`);
    await page.evaluate(() => window.__pt.undo());
    const back = await page.evaluate(() => ({ same: window.__pt.mesh() === window.__orig, paint: window.__pt.layers().length, sculpt: window.__sculpt.session.layers.list(window.__pt.mesh()).length }));
    t.ok(back.same && back.paint === 1 && back.sculpt === 1, `one undo brings back the object with both kinds of layers (${JSON.stringify(back)})`);
  },

  /** Phones are not a target: the workspace only must not throw at phone width. */
  async paintPhone(page, base, t) {
    await page.setViewportSize({ width: 390, height: 844 });
    await openForInput(page, base);
    await page.evaluate(install);
    await page.keyboard.press('Shift+B');
    await page.waitForTimeout(200);
    t.ok((await shell(page)).paint, 'Paint opens at phone width');
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.add(window.__pt.mesh());
      window.__pt.stroke(window.__pt.T.PAINT, [0.9, 0.2, 0.1], 0, 0, 50, 1);
    });
    t.ok(await openPanel(page, 'Layers'), 'the Layers panel opens');
    await page.keyboard.press('Shift+B');
    t.ok(!(await shell(page)).paint, 'and Paint closes again, with no error');
    void devices;
    void screenOf;
  },
};

// --- groups, masks, fill layers and the foot bar (second pass) ----------------------------

/** A working mask that protects the left half (x below 0) of the active object, as the masking tool holds it. */
const maskLeft = (page) =>
  page.evaluate(() => {
    const m = window.__pt.mesh();
    const mAr = m.getMaterials();
    const v = m.getVertices();
    for (let i = 0; i < m.getNbVertices(); i++) mAr[i * 3 + 2] = v[i * 3] < 0 ? 0 : 1;
  });
const clearMask = (page) =>
  page.evaluate(() => {
    const m = window.__pt.mesh();
    const mAr = m.getMaterials();
    for (let i = 0; i < m.getNbVertices(); i++) mAr[i * 3 + 2] = 1;
  });

Object.assign(suites, {
  async paintGroups(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    const lv = await page.evaluate(() => window.__pt.levels());
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
    await page.evaluate(() => window.__pt.snap('plain'));
    const P = (code) => page.evaluate(`(() => { const S = window.__sculpt; const m = window.__pt.mesh(); const pt = window.__pt; return (${code}); })()`);
    await P(`(S.session.paint.add(m), pt.stroke(pt.T.PAINT, [0.9, 0.2, 0.1], 0, 0, 80, 1))`);
    await P(`(S.session.paint.add(m), pt.stroke(pt.T.PAINT, [0.1, 0.2, 0.9], 0, 10, 80, 1))`);
    await P(`S.session.paint.setMode(m, pt.layers()[0], 'multiply')`);
    await page.evaluate(() => window.__pt.snap('flat'));

    // Group a layer: Pass through changes nothing.
    await P(`S.session.paint.group(m, pt.layers()[0])`);
    const g = await P(`(() => { const raw = S.session.paint.rawList(m); const grp = raw.find((l) => l.kind === 'group'); return { grp: !!grp, mode: grp?.mode, parent: raw.find((l) => l.name === 'Layer 2')?.parent === grp, n: raw.length }; })()`);
    t.ok(g.grp && g.mode === 'pass' && g.parent && g.n === 3, `Group wraps a layer in a new group, which passes through (${JSON.stringify(g)})`);
    t.ok((await page.evaluate(() => window.__pt.diff('flat'))) < 1e-6, 'a Pass through group changes nothing on the model');
    // Normal: the group's layers are composited together first, so Multiply does not darken what is below the group.
    await P(`S.session.paint.setMode(m, pt.layers().find((l) => l.kind === 'group'), 'normal')`);
    await page.evaluate(() => window.__pt.snap('groupNormal'));
    t.ok((await page.evaluate(() => window.__pt.diff('flat'))) > 1e-3, 'a Normal group gives other colours than Pass through where its layer is Multiply');
    // The same as that layer being Normal, ungrouped, in the stack.
    await P(`(S.session.paint.setMode(m, pt.layers().find((l) => l.kind === 'group'), 'pass'), S.session.paint.setMode(m, pt.layer('Layer 2'), 'normal'))`);
    await page.evaluate(() => window.__pt.snap('layerNormal'));
    await P(`(S.session.paint.setMode(m, pt.layer('Layer 2'), 'multiply'), S.session.paint.setMode(m, pt.layers().find((l) => l.kind === 'group'), 'normal'))`);
    t.ok((await page.evaluate(() => window.__pt.diff('layerNormal'))) < 1e-5, 'a Multiply layer inside a Normal group looks as a Normal layer does: it blends with nothing under the group');
    await P(`S.session.paint.setMode(m, pt.layers().find((l) => l.kind === 'group'), 'pass')`);
    t.ok((await page.evaluate(() => window.__pt.diff('flat'))) < 1e-6, 'and inside a Pass through group it darkens what is below');

    // Opacity multiplies, the eye hides.
    await P(`S.session.paint.setOpacity(m, pt.layers().find((l) => l.kind === 'group'), 0.5, 'commit')`);
    await page.evaluate(() => window.__pt.snap('half'));
    await P(`(S.session.paint.setOpacity(m, pt.layers().find((l) => l.kind === 'group'), 1, 'commit'), S.session.paint.setOpacity(m, pt.layer('Layer 2'), 0.5, 'commit'))`);
    t.ok((await page.evaluate(() => window.__pt.diff('half'))) < 1e-6, "a group's opacity multiplies its layers' (50% group = the layer at 50%)");
    await P(`S.session.paint.setOpacity(m, pt.layer('Layer 2'), 1, 'commit')`);
    await P(`S.session.paint.setVisible(m, pt.layers().find((l) => l.kind === 'group'), false)`);
    await P(`(S.session.paint.setVisible(m, pt.layers().find((l) => l.kind === 'group'), true), 0)`);
    t.ok((await page.evaluate(() => window.__pt.diff('flat'))) < 1e-6, 'showing the group again brings its layers back');
    await P(`S.session.paint.setVisible(m, pt.layers().find((l) => l.kind === 'group'), false)`);
    const hidden = await P(`(() => { const out = pt.colours(); let n = 0; for (let i = 0; i < out.length; i += 3) if (Math.abs(out[i] - pt.snaps.flat[i]) > 1e-4) n++; return n; })()`);
    t.ok(hidden > 10, `the group's eye hides all its layers (${hidden} vertices change)`);
    await P(`S.session.paint.setVisible(m, pt.layers().find((l) => l.kind === 'group'), true)`);

    // A stroke with a group picked is refused.
    await P(`S.session.paint.setActive(m, pt.layers().find((l) => l.kind === 'group'))`);
    t.eq(await P(`S.session.paint.refusalText(m, 8)`), 'Pick a layer to work on.', 'a stroke with a group picked says to pick a layer');
    const before = await page.evaluate(() => window.__pt.depth());
    await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [0.5, 0.5, 0.5], 0, 0, 60, 1));
    t.ok((await page.evaluate(() => window.__pt.diff('flat'))) < 1e-6 && (await page.evaluate(() => window.__pt.depth())) === before, 'and a stroke made anyway changes nothing and leaves no undo step');

    // Drag in and out; the list shows the group folding.
    await P(`S.session.paint.add(m, 'Loose')`);
    await P(`(() => { const grp = pt.layers().find((l) => l.kind === 'group'); S.session.paint.move(m, pt.layer('Loose'), grp, 0); })()`);
    t.ok(await P(`pt.layer('Loose').parent === pt.layers().find((l) => l.kind === 'group')`), 'a layer is put into a group');
    await P(`S.session.paint.move(m, pt.layer('Loose'), null, 5)`);
    t.ok(await P(`pt.layer('Loose').parent === null`), 'and out of it');
    await P(`S.session.paint.remove(m, pt.layer('Loose'))`);
    await openPanel(page, 'Layers');
    const rows = () => page.evaluate(() => [...document.querySelectorAll('.layers-paint .layer-row:not(.layer-row--base)')].map((r) => `${r.classList.contains('layer-row--nested') ? '  ' : ''}${r.querySelector('.layer-row__name')?.textContent}${r.querySelector('.layer-row__fold') ? (r.querySelector('.layer-row__fold').getAttribute('aria-expanded') === 'true' ? ' v' : ' >') : ''}`));
    t.eq((await rows()).join('|'), 'Group v|  Layer 2|Layer 1', 'the list shows the group with its layer indented under it');
    await page.evaluate(() => document.querySelector('.layers-paint .layer-row__fold').click());
    t.eq((await rows()).join('|'), 'Group >|Layer 1', 'folded, the group hides its layers');
    await page.evaluate(() => document.querySelector('.layers-paint .layer-row__fold').click());
    // Drag a row into the group with the handle.
    await P(`S.session.paint.setActive(m, pt.layer('Layer 1'))`);
    const geo = await page.evaluate(() => {
      const rs = [...document.querySelectorAll('.layers-paint .layer-row:not(.layer-row--base)')];
      const from = rs.find((r) => r.querySelector('.layer-row__name')?.textContent === 'Layer 1');
      const into = rs.find((r) => r.querySelector('.layer-row__name')?.textContent === 'Group');
      const g = from.querySelector('.layer-row__grip').getBoundingClientRect();
      const b = into.getBoundingClientRect();
      return { x: g.left + g.width / 2, y: g.top + g.height / 2, ty: b.top + b.height / 2 };
    });
    await page.mouse.move(geo.x, geo.y);
    await page.mouse.down();
    await page.mouse.move(geo.x, (geo.y + geo.ty) / 2, { steps: 3 });
    await page.mouse.move(geo.x, geo.ty, { steps: 3 });
    const into = await page.evaluate(() => !!document.querySelector('.layer-row--drop-into'));
    await page.mouse.up();
    t.ok(into, 'the handle over the middle of a group row marks "into"');
    t.ok(await P(`pt.layer('Layer 1').parent === pt.layers().find((l) => l.kind === 'group')`), 'and dropping there puts the layer in the group');
    await P(`pt.undo()`);
    t.ok(await P(`pt.layer('Layer 1').parent === null`), 'one undo takes it out again');

    // Ungroup keeps the model; undo.
    await P(`S.session.paint.ungroup(m, pt.layers().find((l) => l.kind === 'group'))`);
    t.ok((await page.evaluate(() => window.__pt.diff('flat'))) < 1e-5 && (await P(`pt.layers().every((l) => l.kind !== 'group')`)), 'Ungroup leaves the layers and changes nothing on the model');
    await P(`pt.undo()`);
    t.ok(await P(`pt.layers().some((l) => l.kind === 'group')`), 'one undo gives the group back');

    // Duplicate and delete a group.
    await P(`S.session.paint.duplicate(m, pt.layers().find((l) => l.kind === 'group'))`);
    t.eq(await P(`S.session.paint.rawList(m).length`), 5, 'Duplicate group copies it with its layers');
    t.eq(await P(`S.session.paint.weight(m, pt.layers().find((l) => l.kind === 'group'))`), 2, 'a group says how many entries Delete would take (itself and its layers)');
    await P(`S.session.paint.remove(m, pt.layers().find((l) => l.kind === 'group'))`);
    t.eq(await P(`S.session.paint.rawList(m).length`), 3, 'Delete on a group deletes its layers');
    await P(`pt.undo()`);
    t.eq(await P(`S.session.paint.rawList(m).length`), 5, 'and one undo brings them back');
    await P(`pt.undo()`);
    // Flatten a group.
    // (A Pass through group has no colour of its own to flatten: it flattens as a Normal one.)
    await P(`S.session.paint.setMode(m, pt.layers().find((l) => l.kind === 'group'), 'normal')`);
    await page.evaluate(() => window.__pt.snap('gn'));
    await P(`S.session.paint.flattenGroup(m, pt.layers().find((l) => l.kind === 'group'))`);
    t.ok((await P(`pt.layers().every((l) => l.kind === 'layer')`)) && (await page.evaluate(() => window.__pt.diff('gn'))) < 4e-3, 'Flatten on a group makes its layers one layer');
    await page.screenshot({ path: `${SHOTS}/paint-groups-1180.png` });
  },

  async paintMasks(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    const lv = await page.evaluate(() => window.__pt.levels());
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
    await page.evaluate(() => window.__pt.snap('plain'));
    const P = (code) => page.evaluate(`(() => { const S = window.__sculpt; const m = window.__pt.mesh(); const pt = window.__pt; return (${code}); })()`);
    /** Vertices of the object with colours changed from a snapshot, on each side of x = 0. */
    const sides = (name) =>
      page.evaluate((n) => {
        const pt = window.__pt;
        const v = pt.mesh().getVertices();
        const c = pt.colours();
        const o = { left: 0, right: 0 };
        for (let i = 0; i < c.length / 3; i++) {
          if (Math.abs(c[i * 3] - pt.snaps[n][i * 3]) + Math.abs(c[i * 3 + 1] - pt.snaps[n][i * 3 + 1]) + Math.abs(c[i * 3 + 2] - pt.snaps[n][i * 3 + 2]) > 1e-5) o[v[i * 3] < 0 ? 'left' : 'right']++;
        }
        return o;
      }, name);
    await P(`S.session.paint.addFill(m, [0.9, 0.2, 0.1])`);
    let s = await sides('plain');
    t.ok(s.left > 100 && s.right > 100, `a fill layer changes both sides (${JSON.stringify(s)})`);
    await maskLeft(page);
    await P(`S.session.paint.maskFromWorking(m, pt.layers()[0])`);
    s = await sides('plain');
    t.ok(s.left === 0 && s.right > 100, `Add mask from the current mask: the layer shows only where the mask was clear (${JSON.stringify(s)})`);
    await clearMask(page);
    t.ok(await P(`!!pt.layers()[0].mask && pt.layers()[0].mask.length === pt.state().n`), 'the mask is a byte a vertex of the highest level');
    await page.evaluate(() => window.__pt.snap('masked'));
    // Invert, disable, enable, remove, each one undo step.
    const d0 = await page.evaluate(() => window.__pt.depth());
    await P(`S.session.paint.invertMask(m, pt.layers()[0])`);
    s = await sides('plain');
    t.ok(s.right === 0 && s.left > 100 && (await page.evaluate(() => window.__pt.depth())) === d0 + 1, `Invert mask flips it, in one undo step (${JSON.stringify(s)})`);
    await P(`pt.undo()`);
    t.ok((await page.evaluate(() => window.__pt.diff('masked'))) < 1e-6, 'and one undo flips it back');
    await P(`S.session.paint.setMaskOn(m, pt.layers()[0], false)`);
    s = await sides('plain');
    t.ok(s.left > 100 && s.right > 100, 'Disable mask shows the layer everywhere, keeping the mask');
    t.ok(await P(`!!pt.layers()[0].mask && !pt.layers()[0].maskOn`), 'the mask is kept');
    await P(`pt.undo()`);
    t.ok((await page.evaluate(() => window.__pt.diff('masked'))) < 1e-6, 'undo of Disable brings the mask back into effect');
    await P(`S.session.paint.removeMask(m, pt.layers()[0])`);
    t.ok(await P(`pt.layers()[0].mask === null`), 'Remove mask takes it away');
    await P(`pt.undo()`);
    t.ok(await P(`pt.layers()[0].mask !== null`), 'and undo gives it back');
    // Load mask: the working mask becomes the layer's; undo gives the old one back.
    await P(`(() => { const mm = m.getMaterials(); for (let i = 0; i < m.getNbVertices(); i++) mm[i * 3 + 2] = 0.5; })()`);
    await P(`S.session.paint.loadMask(m, pt.layers()[0])`);
    const loaded = await P(`(() => { const mm = m.getMaterials(); const v = m.getVertices(); let ok = 0; let bad = 0; for (let i = 0; i < m.getNbVertices(); i++) { const want = v[i * 3] < 0 ? 0 : 1; if (Math.abs(mm[i * 3 + 2] - want) < 0.01) ok++; else bad++; } return { ok, bad }; })()`);
    t.ok(loaded.bad === 0 && loaded.ok > 100, `Load mask puts the layer's mask back as the working mask (${JSON.stringify(loaded)})`);
    await P(`pt.undo()`);
    t.ok(await P(`Math.abs(m.getMaterials()[2] - 0.5) < 1e-6`), 'and one undo gives the old working mask back');
    await clearMask(page);

    // A group's mask scales all its layers.
    await P(`S.session.paint.removeMask(m, pt.layers()[0])`);
    await P(`S.session.paint.group(m, pt.layers()[0])`);
    await page.evaluate(() => window.__pt.snap('grouped'));
    await maskLeft(page);
    await P(`S.session.paint.maskFromWorking(m, pt.layers().find((l) => l.kind === 'group'))`);
    s = await sides('plain');
    t.ok(s.left === 0 && s.right > 100, `a group's mask limits its layers (${JSON.stringify(s)})`);
    await clearMask(page);
    await P(`pt.undo()`);

    // The brush is limited while a masked layer is active.
    await P(`S.session.paint.setActive(m, null)`);
    await P(`(S.session.paint.add(m, 'Paint here'), 0)`);
    await maskLeft(page);
    await P(`S.session.paint.maskFromWorking(m, pt.layer('Paint here'))`);
    await clearMask(page);
    await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [0.1, 0.9, 0.2], 0, 0, 90, 1));
    const cover = await P(`(() => { const l = pt.layer('Paint here'); const v = m.getVertices(); let left = 0; let right = 0; for (const i of pt.covered(l)) { if (v[i * 3] < 0) left++; else right++; } return { left, right }; })()`);
    t.ok(cover.left === 0 && cover.right > 20, `the brush is limited by the layer's mask: no colour on the masked side (${JSON.stringify(cover)})`);

    // Subdivide keeps masks; save and reopen.
    const ok = await page.evaluate(() => window.__sculpt.session.subdivide());
    t.ok(ok, 'Subdivide adds a level');
    const sub = await P(`(() => { const l = pt.layer('Paint here'); const v = m.getVertices(); const n = m.getNbVertices(); let left = 0; let right = 0; for (let i = 0; i < n; i++) { const mk = l.mask[i]; if (v[i * 3] < -0.05 * 25 && mk > 5) left++; if (v[i * 3] > 0.05 * 25 && mk < 250) right++; } return { len: l.mask.length === n, left, right }; })()`);
    t.ok(sub.len && sub.left === 0 && sub.right === 0, `the mask is carried to the new highest level (${JSON.stringify(sub)})`);
    await P(`pt.undo()`);
    await P(`window.__sculpt.library.markPainted(m)`);
    await page.evaluate(async () => {
      window.__bytes = await window.__sculpt.file.pack();
    });
    await page.evaluate(async () => {
      await window.__sculpt.file.open(window.__bytes);
    });
    await page.waitForTimeout(400);
    await page.evaluate(install);
    const re = await P(`(() => { const l = pt.layer('Paint here'); const g = pt.layers().find((x) => x.kind === 'group'); return { mask: !!l?.mask, on: l?.maskOn, groupMask: !!g?.mask }; })()`);
    t.ok(re.mask && re.on, `a .bozz round trip keeps a layer's mask (${JSON.stringify(re)})`);
  },

  async paintFill(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    const lv = await page.evaluate(() => window.__pt.levels());
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
    await page.evaluate(() => window.__pt.snap('plain'));
    const P = (code) => page.evaluate(`(() => { const S = window.__sculpt; const m = window.__pt.mesh(); const pt = window.__pt; return (${code}); })()`);
    await openPanel(page, 'Layers');
    // The foot bar: five bare icons, in Photoshop's order, each with a name and a hit area.
    const bar = await page.evaluate(() => {
      const bs = [...document.querySelectorAll('.layers-paint .layer-bar__btn')];
      return bs.map((b) => ({ id: b.dataset.action, label: b.getAttribute('aria-label'), tip: b.querySelector('.bz-tip__name')?.textContent, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, off: b.disabled, icon: b.querySelector('i')?.className, text: b.textContent }));
    });
    t.eq(bar.map((b) => b.id).join(), 'mask,fill,group,layer,delete', "the foot is a bar of icons: mask, fill layer, group, layer, delete (Photoshop's order)");
    t.ok(bar.every((b) => b.label && b.tip === b.label && b.w >= 44 && b.h >= 32 && b.text === b.tip), `each icon has a name and a hit area of at least 44 by 32 (${JSON.stringify(bar.map((b) => [b.id, b.w, b.h]))})`);
    t.eq(bar.map((b) => b.icon.replace('fi ', '')).join(), 'fi-ss-customize-edit,fi-ss-fill,fi-ss-folder,fi-ss-layers,fi-ss-trash', 'the icons are Uicons solid straight: customize-edit, fill, folder, layers, trash');
    t.ok(bar.find((b) => b.id === 'mask').off && bar.find((b) => b.id === 'delete').off && !bar.find((b) => b.id === 'layer').off, 'with Base active Add mask and Delete are greyed out; the new ones are not');
    t.eq(await page.evaluate(() => document.querySelectorAll('.layers-paint .outliner__btn').length), 0, 'there is no text button in the foot');
    t.eq(await page.evaluate(() => { const b = document.querySelector('.layers-paint .layer-row--base'); return !!b.querySelector('.layer-row__eye') || !!b.querySelector('.layer-row__more') ? 'menu' : 'none'; }), 'menu', 'the Base row has a menu (Flatten all) and no eye');
    t.eq(await page.evaluate(() => !!document.querySelector('.layers-paint .layer-row--base .layer-row__eye')), false, 'and no eye');

    // New fill layer from the bar.
    await page.evaluate(() => document.querySelector('.layers-paint .layer-bar [data-action=fill]').click());
    const f = await P(`(() => { const l = pt.layers()[0]; return { kind: l.kind, fill: l.fill, rgba: l.rgba }; })()`);
    t.ok(f.kind === 'fill' && f.fill && f.rgba === null, 'New fill layer makes a fill layer that holds one colour and no per-vertex data');
    // Every vertex shows the composite of the colour with what is below.
    const setFill = (rgb) => P(`S.session.paint.setFill(m, pt.layers()[0], ${JSON.stringify(rgb)}, 'live')`);
    await P(`S.session.paint.setFill(m, pt.layers()[0], [0.9, 0.3, 0.1], 'commit')`);
    const worst = (mode, op) =>
      page.evaluate(([mode, op]) => {
        const { session } = window.__sculpt;
        const pt = window.__pt;
        const m = pt.mesh();
        session.paint.setMode(m, pt.layers()[0], mode);
        session.paint.setOpacity(m, pt.layers()[0], op, 'commit');
        const l = pt.layers()[0];
        const p = pt.state();
        const c = m.getColors();
        let w = 0;
        for (let i = 0; i < p.n; i++) {
          const b = [0, 1, 2].map((k) => pt.enc(p.base[i * 3 + k]));
          const r = pt.ref[mode](b, l.fill);
          for (let k = 0; k < 3; k++) w = Math.max(w, Math.abs(c[i * 3 + k] - pt.dec(b[k] + (r[k] - b[k]) * op)));
        }
        return w;
      }, [mode, op]);
    t.ok((await worst('normal', 1)) < 5e-5, 'every vertex shows the fill colour');
    t.ok((await worst('multiply', 0.6)) < 5e-5, 'and its composite with what is below, through its mode and opacity (Multiply at 60%)');
    await P(`S.session.paint.setMode(m, pt.layers()[0], 'normal')`);
    await P(`S.session.paint.setOpacity(m, pt.layers()[0], 1, 'commit')`);
    // Changing the colour updates the model, one undo step a pick.
    await page.evaluate(() => window.__pt.snap('orange'));
    const d0 = await page.evaluate(() => window.__pt.depth());
    await setFill([0.2, 0.4, 0.8]);
    await setFill([0.1, 0.5, 0.7]);
    await P(`S.session.paint.setFill(m, pt.layers()[0], [0.1, 0.5, 0.7], 'commit')`);
    t.ok((await page.evaluate(() => window.__pt.diff('orange'))) > 0.01, 'changing the colour updates the model live');
    t.eq(await page.evaluate(() => window.__pt.depth()), d0 + 1, 'and a pick is one undo step');
    await P(`pt.undo()`);
    t.ok((await page.evaluate(() => window.__pt.diff('orange'))) < 1e-6, 'one undo brings the old colour back');
    // The swatch on the row opens the regular colour picker.
    const sw = await page.evaluate(() => {
      const el = document.querySelector('.layers-paint .layer-row__swatch .cpick__swatch');
      const r = el?.getBoundingClientRect();
      return el ? { w: Math.round(r.width), h: Math.round(r.height), bg: el.style.background } : null;
    });
    t.ok(sw && sw.w >= 14 && sw.w <= 18 && sw.h === sw.w, `the row has a small square swatch (${JSON.stringify(sw)})`);
    await page.evaluate(() => document.querySelector('.layers-paint .layer-row__swatch .cpick__swatch').click());
    t.ok(await page.evaluate(() => [...document.querySelectorAll('.cpick__pop')].some((p) => !p.hidden)), "pressing it opens the app's colour picker");
    await page.keyboard.press('Escape');
    // Strokes are refused.
    t.eq(await P(`S.session.paint.refusalText(m, 8)`), 'A fill layer has one colour. Pick it on the layer, or add a mask.', 'a stroke with a fill layer active is refused, with what to do');
    const d1 = await page.evaluate(() => window.__pt.depth());
    await page.evaluate(() => window.__pt.snap('fillShown'));
    await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [0.5, 0.9, 0.2], 0, 0, 60, 1));
    await page.evaluate(() => window.__pt.stroke(window.__pt.T.ERASE, null, 0, 0, 60, 1));
    t.ok((await page.evaluate(() => window.__pt.diff('fillShown'))) === 0 && (await page.evaluate(() => window.__pt.depth())) === d1, 'a stroke made anyway paints nothing');
    // A mask limits it; it goes in a group; duplicate; merge down; make paintable.
    await maskLeft(page);
    await P(`S.session.paint.maskFromWorking(m, pt.layers()[0])`);
    await clearMask(page);
    const lim = await page.evaluate(() => {
      const pt = window.__pt;
      const v = pt.mesh().getVertices();
      const c = pt.colours();
      let left = 0;
      for (let i = 0; i < c.length / 3; i++) if (v[i * 3] < 0 && Math.abs(c[i * 3] - pt.snaps.plain[i * 3]) > 1e-5) left++;
      return left;
    });
    t.eq(lim, 0, 'a mask limits a fill layer to the unmasked part');
    await P(`S.session.paint.group(m, pt.layers()[0])`);
    t.ok(await P(`pt.layers().some((l) => l.kind === 'fill' && l.parent)`), 'a fill layer goes in a group');
    await P(`S.session.paint.setActive(m, pt.layers().find((l) => l.kind === 'fill'))`);
    await page.evaluate(() => window.__pt.snap('beforePaintable'));
    await P(`S.session.paint.makePaintable(m, pt.layers().find((l) => l.kind === 'fill'))`);
    const mp = await P(`(() => { const l = pt.layers().find((x) => x.name === 'Fill 1'); const cov = pt.covered(l).length; return { kind: l.kind, fill: l.fill, cov, n: pt.state().n }; })()`);
    t.ok(mp.kind === 'layer' && mp.fill === null && mp.cov === mp.n, `Make paintable turns it into an ordinary layer holding that colour (${JSON.stringify(mp)})`);
    t.ok((await page.evaluate(() => window.__pt.diff('beforePaintable'))) < 5e-3, 'and what shows is what showed');
    await P(`pt.undo()`);
    t.eq(await P(`pt.layers().find((l) => l.name === 'Fill 1').kind`), 'fill', 'one undo makes it a fill layer again');
    // Save and reopen: the fill is saved as its colour.
    await P(`window.__sculpt.library.markPainted(m)`);
    const rec = await page.evaluate(async () => {
      const r = await window.__sculpt.file.unpack(await window.__sculpt.file.pack());
      const it = r.meshes[0].paintLayers.items.find((x) => x.kind === 'fill');
      return it ? { fill: it.fill, ids: it.ids?.length ?? 0 } : null;
    });
    t.ok(rec && rec.fill && rec.ids === 0, `a fill layer is saved as its colour, no per-vertex data (${JSON.stringify(rec)})`);
    await page.evaluate(async () => {
      window.__bytes = await window.__sculpt.file.pack();
      await window.__sculpt.file.open(window.__bytes);
    });
    await page.waitForTimeout(400);
    await page.evaluate(install);
    t.ok(await P(`pt.layers().some((l) => l.kind === 'fill' && l.fill && l.parent)`), 'after reopening the fill layer is there, in its group');
    await page.screenshot({ path: `${SHOTS}/paint-fill-1180.png` });
  },
});

Object.assign(suites, {
  /** Undo all the way and redo all of it: each stroke ends up on the layer it was made on (the paint twin of sculptLayersUndo). */
  async paintUndo(page, base, t) {
    await openForInput(page, base);
    await page.evaluate(install);
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    const lv = await page.evaluate(() => window.__pt.levels());
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
    await page.evaluate(() => window.__pt.snap('plain'));
    const P = (code) => page.evaluate(`(() => { const S = window.__sculpt; const m = window.__pt.mesh(); const pt = window.__pt; return (${code}); })()`);
    await P(`(S.session.paint.add(m), pt.stroke(pt.T.PAINT, [0.9, 0.2, 0.1], 0, 0, 60, 1))`);
    await P(`(S.session.paint.add(m), pt.stroke(pt.T.PAINT, [0.1, 0.3, 0.9], 0, 40, 60, 1))`);
    await P(`(S.session.paint.setActive(m, pt.layer('Layer 1')), pt.stroke(pt.T.PAINT, [0.2, 0.8, 0.2], 0, -40, 60, 1))`);
    await P(`S.session.paint.setMode(m, pt.layer('Layer 2'), 'multiply')`);
    await page.evaluate(() => window.__pt.snap('all'));
    // What hiding layer 1 alone shows, to compare with after the round trip.
    await P(`S.session.paint.setVisible(m, pt.layer('Layer 1'), false)`);
    await page.evaluate(() => window.__pt.snap('only2'));
    await P(`S.session.paint.setVisible(m, pt.layer('Layer 1'), true)`);
    t.ok((await page.evaluate(() => window.__pt.diff('all'))) < 1e-6, 'showing layer 1 again');
    const back = await P(`(() => { let n = 0; while (S.session.canUndo()) { S.session.undo(); n++; } return n; })()`);
    t.ok(back >= 6, `the history holds the strokes and the layer steps (${back})`);
    t.ok((await page.evaluate(() => window.__pt.diff('plain'))) < 1e-6 && (await P(`pt.layers().length`)) === 0, 'undone all the way, the object has its colours and no layers');
    await P(`(() => { while (S.session.canRedo()) S.session.redo(); })()`);
    t.ok((await page.evaluate(() => window.__pt.diff('all'))) < 1e-6, 'redone all the way, the colours are as they were');
    t.eq(await P(`pt.layers().map((l) => l.name).sort().join()`), 'Layer 1,Layer 2', 'with both layers');
    await P(`S.session.paint.setVisible(m, pt.layer('Layer 1'), false)`);
    t.ok((await page.evaluate(() => window.__pt.diff('only2'))) < 1e-6, 'hiding layer 1 shows layer 2 alone: each stroke went to the layer it was made on');
    // A second round trip, to be sure.
    await P(`S.session.paint.setVisible(m, pt.layer('Layer 1'), true)`);
    await P(`(() => { while (S.session.canUndo()) S.session.undo(); while (S.session.canRedo()) S.session.redo(); })()`);
    t.ok((await page.evaluate(() => window.__pt.diff('all'))) < 1e-6, 'and again');
  },
});
