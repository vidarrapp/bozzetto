// The albedo times the paint (owner decision, 2026-11-18, "Multiply always").
// The shown colour of an object is its material's albedo times its paint,
// per object. The paint is exactly what was picked (white until painted), so
// a change of Albedo rewrites nothing.
//
// tintRule: an unpainted object is white in its colours; a red stroke stores
//   pure red and renders red times the albedo (exactly red over white),
//   following a change of Albedo with the colour array untouched; two objects
//   with different materials each take their own; assigning a material asks
//   nothing and keeps the paint; Pick returns the paint colour; Clear on Base
//   (back to white, one undo step); the thumbnail follows the picture.
// tintOld: an old scene (made by the code before the change, fixtures/tint)
//   opens looking the same, a painted object on its own white-albedo copy of
//   a shared material and the unpainted one on the shared one untouched; a
//   record of a newer version is refused; new records are version 5.
// tintSave: save and reopen keeps albedo and paint apart; a publish and the
//   OBJ export carry what is seen.
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { install } from './paint.mjs';
import { openForInput, openPanel } from './smoke.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/tint';
const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tint');

/** Enter the Paint workspace on the highest level and put the helpers in the page. */
async function ready(page, base) {
  await openForInput(page, base);
  await page.evaluate(install);
  await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
  const lv = await page.evaluate(() => window.__pt.levels());
  await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
}

/** The albedo of the first material, as the Material tab sets it. */
const setAlbedo = (page, hex) =>
  page.evaluate((h) => {
    const { library, session } = window.__sculpt;
    library.update(library.list()[0].id, { albedo: h });
    session.render();
  }, hex);

/** The rendered colour at the middle of the active object, once the frame has settled: [r, g, b]. */
const centre = async (page, dx = 0, dy = 0, which = null) => {
  let last = null;
  for (let i = 0; i < 12; i++) {
    const now = await page.evaluate(
      async ([dx, dy, which]) => {
        const { session, viewer } = window.__sculpt;
        const mesh = which === null ? session.getMesh() : session.getMeshes()[which];
        const b = mesh.computeWorldBound();
        const [cx, cy] = session.getCamera().project([(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2]);
        const hex = await viewer.samplePixel(Math.round(cx + dx), Math.round(cy + dy));
        const n = parseInt(hex.slice(1), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      },
      [dx, dy, which],
    );
    if (last && last.every((v, k) => Math.abs(v - now[k]) <= 1)) return now;
    last = now;
    await page.waitForTimeout(400);
  }
  return last;
};

/** The active object's colours on the level on screen. */
const colours = (page) => page.evaluate(() => Float32Array.from(window.__pt.colours()));

export const suites = {
  async tintRule(page, base, t) {
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    await ready(page, base);

    // An unpainted object is white in its colours; its material tints it.
    const white = await page.evaluate(() => {
      const c = window.__pt.colours();
      let off = 0;
      for (let i = 0; i < c.length; i++) if (c[i] !== 1) off++;
      return off;
    });
    t.eq(white, 0, 'an unpainted object holds white colours (its albedo is not in them)');
    await setAlbedo(page, '#c46a3a');
    const clayUnpainted = await centre(page);
    t.ok(clayUnpainted[0] > clayUnpainted[2] * 1.3, `and shows its clay albedo (${clayUnpainted})`);
    await setAlbedo(page, '#2a5cff');
    const blueUnpainted = await centre(page);
    t.ok(blueUnpainted[2] > blueUnpainted[0] * 1.5, `a change of Albedo recolours it (${blueUnpainted})`);
    await setAlbedo(page, '#c46a3a');

    // A red stroke stores pure red.
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [1, 0, 0], 0, 0, 90, 1)), 'a red stroke lands');
    const stored = await page.evaluate(() => {
      const c = window.__pt.colours();
      let red = 0;
      let altered = 0;
      for (let i = 0; i < c.length; i += 3) {
        if (c[i] > 0.99 && c[i + 1] < 0.01 && c[i + 2] < 0.01) red++;
        else if (c[i] !== 1 || c[i + 1] !== 1 || c[i + 2] !== 1) altered++;
      }
      return { red, altered };
    });
    t.ok(stored.red > 20, `it stores pure red (the picked colour, not times the albedo) on ${stored.red} vertices`);
    await page.evaluate(() => window.__sculpt.library.markPainted(window.__pt.mesh()));
    const shot = async (name, hex) => {
      await setAlbedo(page, hex);
      await openPanel(page, 'Material');
      await page.waitForTimeout(500);
      const px = await centre(page);
      await page.screenshot({ path: join(SHOTS, `${name}.png`) });
      return px;
    };
    const clay = await shot('clay', '#c46a3a');
    const arrayBefore = await colours(page);
    const whiteAlbedo = await shot('white', '#ffffff');
    const blue = await shot('blue', '#2a5cff');
    const arrayAfter = await colours(page);
    t.ok(arrayBefore.length === arrayAfter.length && arrayBefore.every((v, i) => v === arrayAfter[i]), 'changing Albedo twice left the colour array exactly as it was: nothing is recomposited');
    t.ok(whiteAlbedo[0] > 150 && whiteAlbedo[0] > whiteAlbedo[1] * 2 && whiteAlbedo[0] > whiteAlbedo[2] * 2, `under a white albedo the paint shows as picked: red (${whiteAlbedo})`);
    t.ok(clay[0] > 60 && clay[0] > clay[1] * 2, `under clay it is red times clay (${clay})`);
    t.ok(blue[0] < whiteAlbedo[0] * 0.5, `under blue the red is multiplied down (${blue} against ${whiteAlbedo})`);
    const rest = await centre(page, 0, 190);
    t.ok(rest[2] > rest[0], `the unpainted part follows the albedo, blue (${rest})`);

    // The thumbnail (the In progress card) is the rendered picture.
    await setAlbedo(page, '#ffffff');
    await centre(page);
    const thumb = await page.evaluate(async () => {
      const blob = await window.__sculpt.viewer.captureThumbnail();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(bmp.width >> 1, bmp.height >> 1, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    t.ok(thumb[0] > 150 && thumb[0] > thumb[1] * 2, `the thumbnail shows the red paint under a white albedo (${thumb})`);

    // Pick returns the paint, not the tinted colour.
    await setAlbedo(page, '#2a5cff');
    await page.evaluate(() => {
      const c = window.__sculpt.session.getSculptManager().getTool(8)._color;
      c[0] = c[1] = c[2] = 0.5;
    });
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PICK)), 'a press with Pick lands');
    const picked = await page.evaluate(() => [...window.__sculpt.session.getSculptManager().getTool(8)._color]);
    t.ok(picked[0] > 0.99 && picked[1] < 0.01 && picked[2] < 0.01, `Pick gives the paint colour, red, under a blue albedo (${picked.map((v) => v.toFixed(3))})`);

    // Assigning a material asks nothing and keeps the paint.
    const kept = await page.evaluate(() => {
      const { library, session } = window.__sculpt;
      const before = Float32Array.from(window.__pt.colours());
      const m2 = library.create('Moss');
      library.update(m2.id, { albedo: '#3a7b3a' });
      library.assign(session.getMesh(), m2.id);
      const after = window.__pt.colours();
      return { same: before.every((v, i) => v === after[i]), asked: !!document.querySelector('.bz-ask') };
    });
    t.ok(kept.same && !kept.asked, 'assigning another material changes no colour, and asks nothing');
    const moss = await centre(page, 0, 190);
    t.ok(moss[1] > moss[0] && moss[1] > moss[2], `the unpainted part is the new material's albedo (${moss})`);

    // Clear on Base: back to white, one undo step.
    await openPanel(page, 'Layers');
    const d0 = await page.evaluate(() => window.__pt.depth());
    await page.evaluate(() => {
      document.querySelector('.layers-paint .layer-row--base .layer-row__more').click();
      [...document.querySelectorAll('.row-menu:not([hidden]) .file-menu__item')].find((b) => b.textContent === 'Clear').click();
    });
    const cleared = await page.evaluate(() => {
      const c = window.__pt.colours();
      let off = 0;
      for (let i = 0; i < c.length; i++) if (c[i] !== 1) off++;
      return { off, depth: window.__pt.depth() };
    });
    t.eq(cleared.off, 0, 'Clear on Base turns the paint to white');
    t.eq(cleared.depth, d0 + 1, 'in one undo step');
    await page.evaluate(() => window.__pt.undo());
    t.ok(await page.evaluate(() => { const c = window.__pt.colours(); let n = 0; for (let i = 0; i < c.length; i += 3) if (c[i] > 0.99 && c[i + 1] < 0.01) n++; return n > 20; }), 'and one undo brings the paint back');

    // Clear with layers: the layers stay over the white.
    await page.evaluate(() => {
      const { session } = window.__sculpt;
      session.paint.add(window.__pt.mesh());
      window.__pt.stroke(window.__pt.T.PAINT, [0, 1, 0], 0, 60, 60, 1);
    });
    await page.evaluate(() => window.__sculpt.session.paint.clearBase(window.__pt.mesh()));
    const layered = await page.evaluate(() => {
      const c = window.__pt.colours();
      let green = 0;
      let red = 0;
      for (let i = 0; i < c.length; i += 3) {
        if (c[i + 1] === 1 && c[i] === 0 && c[i + 2] === 0) green++;
        if (c[i] === 1 && c[i + 1] === 0) red++;
      }
      return { green, red, layers: window.__pt.layers().length };
    });
    t.ok(layered.green > 10 && layered.red === 0 && layered.layers === 1, `with a layer, Clear whitens Base and leaves the layer (${JSON.stringify(layered)})`);
    await page.evaluate(() => window.__pt.undo());

    // Two objects, two materials.
    await page.evaluate(() => {
      const { session, library } = window.__sculpt;
      const first = session.getMesh();
      const b = first.computeWorldBound();
      const w = b[3] - b[0];
      const second = session.addSphere();
      second.getMatrix()[12] += w * 1.5;
      library.assign(second, library.list().find((m) => m.name === 'Moss').id);
      library.assign(first, library.list()[0].id);
      session.setMesh(first); // the second becomes a display of its own, at its matrix
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__sculpt.input.hooks.frameAll());
    await setAlbedo(page, '#2a5cff');
    await page.waitForTimeout(800);
    const first = await centre(page, 0, 0, 0);
    const second = await centre(page, 0, 0, 1);
    t.ok(second[1] > second[0] && second[1] > second[2], `the second object takes its own albedo, green (${second})`);
    t.ok(first[2] > first[1] || first[0] > 30, `and the first its own (${first})`);
  },

  // The Colour choice (owner, 2026-11-18): albedo and paint, albedo only, paint only. Which of the two
  // factors the shader uses; nothing is rewritten. In the Material tab, in Sculpt, Paint and Present.
  async tintColour(page, base, t) {
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    await ready(page, base);
    await setAlbedo(page, '#c46a3a');
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [1, 0, 0], 0, 0, 90, 1)), 'a red stroke over a clay albedo');
    await page.evaluate(() => window.__sculpt.library.markPainted(window.__pt.mesh()));
    await openPanel(page, 'Material');
    const where = () =>
      page.evaluate(() => {
        const has = (el) => !!el && [...el.querySelectorAll('select')].some((s) => [...s.options].some((o) => o.textContent === 'Paint only'));
        const panels = [...document.querySelectorAll('.panel')].filter((p) => has(p)).map((p) => p.dataset.panel);
        const sel = [...document.querySelectorAll('.panel--material select')].find((s) => [...s.options].some((o) => o.textContent === 'Paint only'));
        const order = sel ? [...sel.closest('.section').children].map((c) => c.firstElementChild?.textContent ?? c.querySelector('h3')?.textContent) : [];
        return { panels, options: sel ? [...sel.options].map((o) => o.textContent).join(' / ') : null, value: sel?.value ?? null, order: order.join() };
      });
    let w = await where();
    t.eq(JSON.stringify(w.panels), '["Material"]', 'the Colour choice is in the Material tab alone (Paint)');
    t.eq(w.options, 'Albedo and paint / Albedo only / Paint only', 'with three choices');
    t.eq(w.value, 'both', 'albedo and paint is the default');
    t.ok(/Mode,Colour/.test(w.order), `after Mode in the Display section (${w.order})`);
    const pick = (v) =>
      page.evaluate((v) => {
        const sel = [...document.querySelectorAll('.panel--material select')].find((s) => [...s.options].some((o) => o.textContent === 'Paint only'));
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, v);
    const before = await colours(page);
    const both = await centre(page);
    const bothOut = await centre(page, 0, 190);
    await pick('albedo');
    const albedo = await centre(page);
    const albedoOut = await centre(page, 0, 190);
    await pick('paint');
    const paint = await centre(page);
    const paintOut = await centre(page, 0, 190);
    await openPanel(page, 'Material');
    await page.screenshot({ path: join(SHOTS, 'paint-only.png') });
    const after = await colours(page);
    t.ok(before.length === after.length && before.every((v, i) => v === after[i]), 'switching the choice leaves the colour array exactly as it was');
    t.ok(both[0] > both[1] * 2 && bothOut[0] > bothOut[2], `Albedo and paint: red times clay over the stroke, clay beside it (${both}, ${bothOut})`);
    t.ok(!(albedo[0] > albedo[1] * 2.2) && albedo[0] > albedo[2] * 1.3 && albedoOut[0] > albedoOut[2] * 1.3, `Albedo only: clay everywhere, the stroke not shown (${albedo}, ${albedoOut})`);
    t.ok(paint[0] > 150 && paint[0] > paint[1] * 2 && paint[0] > paint[2] * 2, `Paint only: red as picked over the stroke (${paint})`);
    t.ok(Math.min(...paintOut) > 120 && Math.max(...paintOut) - Math.min(...paintOut) < 40, `and white where nothing was painted (${paintOut})`);
    t.eq(await page.evaluate(() => window.__sculpt.library.list()[0].albedo), '#c46a3a', 'the albedo is unchanged');
    const st = await page.evaluate(() => window.__sculpt.viewer.materials.getMaterialState());
    t.ok(st.colourSource === 'paint' && st.vertexColors === true, `stored as colourSource "paint" with vertexColors true, which a build before it reads as the paint (${st.colourSource}, ${st.vertexColors})`);
    await pick('albedo');
    t.ok((await page.evaluate(() => window.__sculpt.viewer.materials.getMaterialState())).vertexColors === false, 'Albedo only writes vertexColors false, as Plain colour did');

    // Pick returns the stored paint colour in every mode.
    await page.evaluate(() => {
      const c = window.__sculpt.session.getSculptManager().getTool(8)._color;
      c[0] = c[1] = c[2] = 0.5;
    });
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PICK)), 'a press with Pick lands under Albedo only');
    const picked = await page.evaluate(() => [...window.__sculpt.session.getSculptManager().getTool(8)._color]);
    t.ok(picked[0] > 0.99 && picked[1] < 0.01, `Pick returns the stored paint (${picked.map((v) => v.toFixed(3))})`);

    // An old look: the boolean alone.
    const looks = await page.evaluate(async () => {
      const m = window.__sculpt.viewer.materials;
      const out = [];
      for (const material of [{ vertexColors: false }, { vertexColors: true }, { colourSource: 'paint', vertexColors: true }, { colourSource: 'sparkle', vertexColors: false }]) {
        await window.__sculpt.viewer.applyLook({ material });
        out.push(m.getColourSource());
      }
      return out.join();
    });
    t.eq(looks, 'albedo,both,paint,albedo', 'an old look with the boolean opens right (false is albedo only, true albedo and paint), the new value wins, a bad one falls back to the boolean');

    // Publish writes what is seen.
    const pubOf = async (v) => {
      await pick(v);
      return page.evaluate(() => {
        const c = window.__sculpt.publishColours();
        const top = window.__pt.colours();
        for (let i = 0; i < top.length / 3; i++) if (top[i * 3] > 0.99 && top[i * 3 + 1] < 0.01 && top[i * 3 + 2] < 0.01) return [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]];
        return null;
      });
    };
    const k = [0.5521, 0.1441, 0.0423];
    const pBoth = await pubOf('both');
    const pAlb = await pubOf('albedo');
    const pPaint = await pubOf('paint');
    t.ok(pBoth && Math.abs(pBoth[0] - k[0]) < 0.01 && pBoth[1] < 0.01, `Albedo and paint publishes the product (${pBoth})`);
    t.ok(pAlb && Math.abs(pAlb[0] - k[0]) < 0.01, `Albedo only publishes the product too, and the look says Plain colour (${pAlb})`);
    t.ok(pPaint && pPaint[0] > 0.99 && pPaint[1] < 0.01, `Paint only publishes the paint alone (${pPaint})`);

    // Save and reopen keeps it; it is there in Sculpt and in Present, and not in the Render tab.
    await pick('paint');
    await page.evaluate(async () => {
      window.__bytes = await window.__sculpt.file.pack();
    });
    await page.evaluate(async () => {
      await window.__sculpt.file.open(window.__bytes);
    });
    await page.waitForTimeout(500);
    t.eq(await page.evaluate(() => window.__sculpt.viewer.materials.getColourSource()), 'paint', 'save and reopen keeps Paint only');
    await page.evaluate(() => window.__sculpt.paintWorkspace.leave());
    await openPanel(page, 'Material');
    w = await where();
    t.ok(JSON.stringify(w.panels) === '["Material"]' && w.value === 'paint', `in Sculpt it is in the Material tab, on Paint only (${JSON.stringify(w)})`);
    await page.evaluate(() => window.__sculpt.present.enter());
    await page.waitForTimeout(500);
    await openPanel(page, 'Material');
    w = await where();
    t.ok(JSON.stringify(w.panels) === '["Material"]' && w.value === 'paint', `and in Present (${JSON.stringify(w)})`);
  },

  // Objects with dynamic topology on: the tint rule holds on them (white colours, the albedo times the
  // paint, refinement under the brush making white or interpolated colours), they have no paint layers,
  // and in Paint a notice offers to turn it off (without ever holding the switch).
  async tintDynamic(page, base, t) {
    mkdirSync(SHOTS, { recursive: true });
    await page.setViewportSize({ width: 1180, height: 820 });
    const asked = [];
    page.on('dialog', (d) => {
      asked.push(d.message());
      void d.accept();
    });
    const notices = () => page.evaluate(() => [...document.querySelectorAll('.sculpt-toast')].map((e) => e.textContent).filter((s) => /dynamic topology off/.test(s)));
    const clearToasts = () => page.evaluate(() => document.querySelectorAll('.sculpt-toast').forEach((e) => e.remove()));
    await openForInput(page, base);
    await page.evaluate(install);

    // A static object: entering Paint says nothing.
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    await page.waitForTimeout(400);
    t.eq((await notices()).length, 0, 'entering Paint with a static object shows no notice');
    await page.evaluate(() => window.__sculpt.paintWorkspace.leave());

    // Dynamic topology on: white colours, the albedo shows.
    await page.evaluate(() => window.__sculpt.session.toggleDynamicTopology());
    t.ok(await page.evaluate(() => window.__sculpt.session.isDynamicTopology()), 'dynamic topology is on for the object');
    await setAlbedo(page, '#c46a3a');
    const white = await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      const c = m.getColors();
      let off = 0;
      for (let i = 0; i < m.getNbVertices() * 3; i++) if (c[i] !== 1) off++;
      return off;
    });
    t.eq(white, 0, 'an unpainted dynamic object holds white colours');
    const clay = await centre(page);
    t.ok(clay[0] > clay[2] * 1.3, `and shows its albedo (${clay})`);

    // Entering Paint: the workspace first, then the notice; the button is there.
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    const at = await page.evaluate(() => ({ paint: document.body.classList.contains('paint-ws'), on: window.__sculpt.paintWorkspace.isOn() }));
    t.ok(at.paint && at.on, 'the switch to Paint was not held up');
    await page.waitForTimeout(300);
    const first = await notices();
    t.eq(first.length, 1, 'a notice shows for the dynamic object');
    t.ok(first[0].startsWith('Paint layers need dynamic topology off for "Sphere".') && first[0].includes('Turn off'), `with its words and a Turn off button (${first[0]})`);
    t.eq(asked.length, 0, 'and no question window');
    await clearToasts();
    await page.evaluate(() => window.__sculpt.paintWorkspace.leave());
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    await page.waitForTimeout(300);
    t.eq((await notices()).length, 0, 'it is not shown twice for the same object');

    // The Layers panel's sentence and button.
    await openPanel(page, 'Layers');
    const panel = await page.evaluate(() => {
      const n = document.querySelector('.layers-paint .layers-note');
      return { shown: !!n && !n.hidden, text: n?.textContent ?? '' };
    });
    t.ok(panel.shown && /^Paint layers need dynamic topology off\./.test(panel.text) && /Turn off dynamic topology/.test(panel.text), `the Layers panel has the sentence and the button (${panel.text})`);

    // A red stroke: pure red stored, new vertices made of white and red, no albedo fill, render red times clay.
    await page.evaluate(() => {
      window.__nBefore = window.__sculpt.session.getMesh().getNbVertices();
    });
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [1, 0, 0], 0, 0, 90, 1)), 'a red stroke on the dynamic object');
    await page.evaluate(() => window.__sculpt.library.markPainted(window.__sculpt.session.getMesh()));
    const stored = await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      const c = m.getColors();
      const n = m.getNbVertices();
      let red = 0;
      let odd = 0;
      for (let i = 0; i < n; i++) {
        const r = c[i * 3];
        const g = c[i * 3 + 1];
        const b = c[i * 3 + 2];
        if (r > 0.99 && g < 0.01 && b < 0.01) red++;
        // Everything else is white, or white blended toward red: r stays 1 and g equals b.
        if (Math.abs(r - 1) > 1e-3 || Math.abs(g - b) > 1e-3) odd++;
      }
      return { red, odd, n, grew: n - window.__nBefore };
    });
    t.ok(stored.red > 10, `it stores pure red (${stored.red} vertices)`);
    t.eq(stored.odd, 0, `and every other vertex is white or white blended with red, new ones included: no albedo fill (${stored.n} vertices, ${stored.grew} new)`);
    const both = await centre(page);
    t.ok(both[0] > both[1] * 2, `it renders red times the albedo (${both})`);
    const arrBefore = await page.evaluate(() => Float32Array.from(window.__sculpt.session.getMesh().getColors()));
    await openPanel(page, 'Material');
    const pick = (v) =>
      page.evaluate((v) => {
        const sel = [...document.querySelectorAll('.panel--material select')].find((s) => [...s.options].some((o) => o.textContent === 'Paint only'));
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, v);
    await pick('paint');
    const paint = await centre(page);
    const paintOut = await centre(page, 0, 190);
    await pick('albedo');
    const albedo = await centre(page);
    await pick('both');
    t.ok(paint[0] > 150 && paint[0] > paint[1] * 2 && Math.min(...paintOut) > 120, `Paint only shows red as picked and white elsewhere (${paint}, ${paintOut})`);
    t.ok(albedo[0] > albedo[2] * 1.3 && !(albedo[0] > albedo[1] * 2.2), `Albedo only shows the clay (${albedo})`);
    const arrAfter = await page.evaluate(() => Float32Array.from(window.__sculpt.session.getMesh().getColors()));
    t.ok(arrBefore.length === arrAfter.length && arrBefore.every((v, i) => v === arrAfter[i]), 'switching the choice leaves the colours as they were');
    await page.evaluate(() => {
      const c = window.__sculpt.session.getSculptManager().getTool(8)._color;
      c[0] = c[1] = c[2] = 0.5;
    });
    await page.evaluate(() => window.__pt.stroke(window.__pt.T.PICK));
    const picked = await page.evaluate(() => [...window.__sculpt.session.getSculptManager().getTool(8)._color]);
    t.ok(picked[0] > 0.99 && picked[1] < 0.02, `Pick returns the paint (${picked.map((v) => v.toFixed(3))})`);

    // An old scene (version 4) with a painted dynamic object opens as the static object it saves as, looking the same.
    const old = await page.evaluate(async () => {
      const { session, library, file } = window.__sculpt;
      const mesh = session.getMesh();
      const c = mesh.getColors();
      const n = mesh.getNbVertices();
      const sum = (arr, k) => arr.reduce((a, v, i) => a + (i % 3 === k ? v : 0), 0);
      const before = Float32Array.from(c.subarray(0, n * 3));
      const rec = session.serializeScene();
      library.saveInto(rec);
      rec.v = 4;
      const bytes = await file.packRecord(rec);
      await file.open(bytes);
      const m2 = session.getMesh();
      const c2 = m2.getColors();
      let worst = 0;
      const n2 = m2.getNbVertices();
      for (let i = 0; i < Math.min(n, n2) * 3; i++) worst = Math.max(worst, Math.abs(c2[i] - before[i]));
      return { n, n2, worst, albedo: library.materialFor(m2).albedo, dyn: !!m2.isDynamic, sumR: sum(before, 0) };
    });
    t.ok(old.n === old.n2 && old.worst < 1e-6, `it opens with its colours as they were (${old.n} vertices, worst ${old.worst})`);
    t.eq(old.albedo, '#ffffff', 'on a white albedo, as old painted objects do (the colours have the clay in them)');
    t.ok(!old.dyn, 'as a static object, which is how dynamic objects are saved');

    // Turn it on again, paint, then use the notice's button: the colours stay, a layer can be made.
    await page.evaluate(() => window.__sculpt.paintWorkspace.leave());
    await clearToasts();
    await page.evaluate(() => window.__sculpt.session.toggleDynamicTopology());
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    await page.waitForTimeout(300);
    t.eq((await notices()).length, 1, 'a new dynamic object gets its own notice');
    await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      window.__keep = Float32Array.from(m.getColors().subarray(0, m.getNbVertices() * 3));
    });
    await page.evaluate(() => document.querySelector('[data-role="turn-off-dynamic"]').click());
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      return { dyn: !!m.isDynamic, notice: document.querySelectorAll('.sculpt-toast [data-role="turn-off-dynamic"]').length };
    });
    t.ok(!after.dyn && after.notice === 0, 'the notice\'s Turn off turns dynamic topology off and the notice goes');
    await page.evaluate(() => window.__pt.undo());
    t.ok(await page.evaluate(() => window.__sculpt.session.isDynamicTopology()), 'in one undo step');
    await page.evaluate(() => window.__sculpt.session.redo());
    const painted = await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      const c = m.getColors();
      let red = 0;
      for (let i = 0; i < m.getNbVertices(); i++) if (c[i * 3] > 0.99 && c[i * 3 + 1] < 0.01) red++;
      const layer = window.__sculpt.session.paint.add(m);
      return { red, made: !!layer, layers: window.__sculpt.session.paint.list(m).length };
    });
    t.ok(painted.red > 10 && painted.made, `the painted colours stay, and a layer can be made (${painted.red} red vertices)`);

    // The colours stayed through the switch off.
    t.ok(await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      const c = m.getColors();
      return m.getNbVertices() * 3 === window.__keep.length && window.__keep.every((v, i) => Math.abs(v - c[i]) < 1e-6);
    }), 'turning dynamic topology off kept the painted colours');

    // Turning it on again, with a layer present, from the Model panel: it asks as it does today, and the paint stays.
    await page.evaluate(() => window.__sculpt.paintWorkspace.leave());
    asked.length = 0;
    await openPanel(page, 'Model');
    await page.evaluate(() => {
      const box = [...document.querySelectorAll('label')].find((l) => /Dynamic topology/.test(l.textContent))?.querySelector('input');
      box.click();
    });
    await page.waitForTimeout(800);
    t.ok(asked.some((m) => /Turn on dynamic topology/.test(m)), `turning it on asks first (${asked.join(' | ')})`);
    t.ok(await page.evaluate(() => window.__sculpt.session.isDynamicTopology()), 'and does it');
    t.ok(await page.evaluate(() => {
      const m = window.__sculpt.session.getMesh();
      const c = m.getColors();
      let red = 0;
      for (let i = 0; i < m.getNbVertices(); i++) if (c[i * 3] > 0.99 && c[i * 3 + 1] < 0.01) red++;
      return red > 10 && window.__sculpt.session.paint.list(m).length === 0;
    }), 'with the paint kept as colours, the paint layer flattened into them');

    // The panel's button, in Paint and in Sculpt.
    await clearToasts();
    await page.evaluate(() => window.__sculpt.paintWorkspace.enter());
    await page.waitForTimeout(300);
    await openPanel(page, 'Layers');
    await page.evaluate(() => document.querySelector('.layers-paint .layers-note__btn').click());
    await page.waitForTimeout(300);
    t.ok(!(await page.evaluate(() => window.__sculpt.session.isDynamicTopology())), 'the Layers panel\'s button turns it off in Paint');
    await page.evaluate(() => window.__sculpt.paintWorkspace.leave());
    await clearToasts();
    await page.evaluate(() => window.__sculpt.session.toggleDynamicTopology());
    await openPanel(page, 'Layers');
    const sculptNote = await page.evaluate(() => {
      const n = document.querySelector('.layers-sculpt .layers-note');
      return { shown: !!n && !n.hidden, text: n?.textContent ?? '' };
    });
    t.ok(sculptNote.shown && /^Layers need dynamic topology off\./.test(sculptNote.text), `Sculpt's Layers panel has the sentence and the button (${sculptNote.text})`);
    await page.evaluate(() => document.querySelector('.layers-sculpt .layers-note__btn').click());
    await page.waitForTimeout(300);
    t.ok(!(await page.evaluate(() => window.__sculpt.session.isDynamicTopology())), 'its button turns it off in Sculpt');
    t.eq(await page.evaluate(() => (document.querySelector('.sculpt-toast [data-role="turn-off-dynamic"]') ? 1 : 0)), 0, 'and entering Sculpt asked nothing');
  },

  async tintOld(page, base, t) {
    const want = JSON.parse(readFileSync(join(FIX, 'old-scene.json'), 'utf8'));
    const bytes = [...readFileSync(join(FIX, 'old-scene.bozz'))];
    await openForInput(page, base);
    await page.evaluate(async (b) => {
      await window.__sculpt.file.open(new Uint8Array(b).buffer);
    }, bytes);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__sculpt.input.hooks.frameAll());
    await page.waitForTimeout(800);

    const state = await page.evaluate(() => {
      const { session, library } = window.__sculpt;
      return {
        materials: library.list().map((m) => [m.name, m.albedo]),
        of: session.getMeshes().map((m) => library.materialFor(m).name),
        painted: session.getMeshes().map((m) => library.isPainted(m)),
      };
    });
    t.eq(JSON.stringify(state.painted), '[true,true,false]', 'the painted objects are still painted, the third is not');
    const clay = state.materials.find((m) => m[0] === 'Clay');
    t.eq(clay?.[1], '#c46a3a', 'the shared material is untouched for the unpainted object');
    t.eq(state.of[2], 'Clay', 'which still uses it');
    const copy = state.materials.find((m) => m[0] === 'Clay (painted)');
    t.eq(copy?.[1], '#ffffff', 'the painted object has its own copy of it, named "Clay (painted)", with a white albedo');
    t.eq(state.of[0], 'Clay (painted)', 'on that copy');
    t.eq(state.materials.find((m) => m[0] === 'Blue')?.[1], '#ffffff', 'a material only painted objects use has its albedo white');

    // The colours: the painted ones as they were, the unpainted one white.
    const diff = await page.evaluate((want) => {
      const { session } = window.__sculpt;
      return session.getMeshes().map((mesh, k) => {
        const top = mesh._meshes ? mesh._meshes[mesh._meshes.length - 1] : mesh;
        const c = top.getColors();
        let worst = 0;
        want.colours[k].ids.forEach((id, j) => {
          const old = want.colours[k].rgb[j];
          for (let q = 0; q < 3; q++) worst = Math.max(worst, Math.abs(c[id * 3 + q] - (k === 2 ? 1 : old[q])));
        });
        return { n: top.getNbVertices() === want.colours[k].n, worst };
      });
    }, want);
    t.ok(diff[0].n && diff[0].worst < 1e-6 && diff[1].n && diff[1].worst < 1e-6, `the painted objects keep the colours they had (${diff.map((d) => d.worst.toExponential(1)).join(', ')})`);
    t.ok(diff[2].worst < 1e-6, 'and the unpainted one is white in its colours');

    // The picture: the same as the old code showed, within a small tolerance.
    // (The frame eases in for a second or so after a change: read until two reads agree.)
    const readAll = () =>
      page.evaluate(async (pixels) => {
        const out = [];
        for (const row of pixels) out.push(await Promise.all(row.map((p) => window.__sculpt.viewer.samplePixel(p.x, p.y))));
        return out;
      }, want.pixels);
    await page.waitForTimeout(5000);
    let seen = await readAll();
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(500);
      const next = await readAll();
      const same = next.every((row, k) => row.every((h, j) => h === seen[k][j]));
      seen = next;
      if (same) break;
    }
    // The software renderer's frame does not settle to the same pixels twice (its progressive
    // passes land differently from run to run: the fixture's own old-code pixels differ by up to
    // 40 of 255 between two fresh opens), so the picture is compared by its colour: each pixel
    // within a loose tolerance of the old code's, and with the same dominant channel. The colours
    // themselves, above, are exact.
    let worstPx = 0;
    let order = 0;
    const dominant = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255].indexOf(Math.max((n >> 16) & 255, (n >> 8) & 255, n & 255));
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < 3; j++) {
        const a = parseInt(seen[k][j].slice(1), 16);
        const b = parseInt(want.pixels[k][j].hex.slice(1), 16);
        for (const sh of [16, 8, 0]) worstPx = Math.max(worstPx, Math.abs(((a >> sh) & 255) - ((b >> sh) & 255)));
        if (dominant(a) !== dominant(b)) order++;
      }
    }
    t.ok(worstPx <= 56 && order === 0, `the old scene renders as the old code drew it: worst channel difference ${worstPx} of 255, ${order} pixels with another dominant channel (${JSON.stringify(seen)})`);

    // Saved again, it is a version 5 record, and it opens the same.
    const rec = await page.evaluate(async () => {
      const bytes = await window.__sculpt.file.pack();
      const r = await window.__sculpt.file.unpack(bytes);
      return { v: (r.scene ?? r).v };
    });
    t.eq(rec.v, 5, 'a record saved now is version 5');
    // A record from a newer version is refused, as before, and the scene stays.
    const refused = await page.evaluate(async () => {
      const { session, file } = window.__sculpt;
      const r = session.serializeScene();
      r.v = 6;
      const bytes = await file.packRecord(r);
      try {
        await file.open(bytes);
        return false;
      } catch {
        return true;
      }
    });
    t.ok(refused, 'a scene of a newer version is refused');
    t.eq(await page.evaluate(() => window.__sculpt.session.getMeshes().length), 3, 'and the scene stays as it was');
    // The autosave of the opened scene reloads the same.
    await page.evaluate(() => window.__sculpt.persist.markDirty());
    await page.evaluate(() => window.__sculpt.persist.settle());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
    await page.waitForTimeout(600);
    const again = await page.evaluate(() => {
      const { session, library } = window.__sculpt;
      return session.getMeshes().map((m) => library.materialFor(m).albedo).join();
    });
    t.eq(again, '#ffffff,#ffffff,#c46a3a', 'the autosave brings the same albedos back');
  },

  async tintSave(page, base, t) {
    await ready(page, base);
    await setAlbedo(page, '#2a5cff');
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [1, 0, 0], 0, 0, 80, 1)), 'a red stroke under a blue albedo');
    await page.evaluate(() => window.__sculpt.library.markPainted(window.__pt.mesh()));
    const before = await colours(page);
    const red = before.filter((v, i) => i % 3 === 0 && v > 0.99 && before[i + 1] < 0.01 && before[i + 2] < 0.01).length;

    // What a publish writes and the OBJ export: what is seen.
    const pub = await page.evaluate(async () => {
      const c = window.__sculpt.publishColours();
      const top = window.__pt.colours();
      const k = [0.0231, 0.1070, 1];
      let seenRed = 0;
      let seenAlbedo = 0;
      for (let i = 0; i < top.length / 3; i++) {
        const paint = [top[i * 3], top[i * 3 + 1], top[i * 3 + 2]];
        const ok = (a) => Math.abs(c[i * 3] - paint[0] * a[0]) + Math.abs(c[i * 3 + 1] - paint[1] * a[1]) + Math.abs(c[i * 3 + 2] - paint[2] * a[2]) < 2e-3;
        if (ok(k)) {
          if (paint[0] > 0.99 && paint[1] < 0.01) seenRed++;
          else if (paint[0] === 1 && paint[1] === 1) seenAlbedo++;
        }
      }
      return { n: c.length / 3, seenRed, seenAlbedo, obj: await window.__sculpt.file.toOBJ() };
    });
    t.ok(pub.seenRed > 20 && pub.seenAlbedo > 20, `a publish bakes the albedo times the paint into the vertex colours (${pub.seenRed} red ones, ${pub.seenAlbedo} unpainted)`);
    const obj = pub.obj;
    t.ok(String(obj).split('\n').filter((l) => l.startsWith('v ')).every((l) => l.split(' ').length === 4), 'OBJ export writes positions only, no colours');

    // Save and reopen: albedo and paint stay apart.
    await page.evaluate(async () => {
      window.__bytes = await window.__sculpt.file.pack();
    });
    await page.evaluate(async () => {
      await window.__sculpt.file.open(window.__bytes);
    });
    await page.waitForTimeout(500);
    await page.evaluate(install);
    const lv = await page.evaluate(() => window.__pt.levels());
    await page.evaluate((n) => window.__pt.go(n - 1), lv.n);
    const after = await colours(page);
    t.ok(after.length === before.length && after.every((v, i) => v === before[i]), 'the paint reopens exactly as picked');
    t.eq(await page.evaluate(() => window.__sculpt.library.list()[0].albedo), '#2a5cff', 'and the albedo is as it was');
    t.ok(after.filter((v, i) => i % 3 === 0 && v > 0.99 && after[i + 1] < 0.01 && after[i + 2] < 0.01).length === red, 'with the same pure red');
    await setAlbedo(page, '#ffffff');
    const px = await centre(page);
    t.ok(px[0] > 150 && px[0] > px[1] * 2, `a white albedo shows it as picked (${px})`);
  },

  async tintSpeed(page, base, t) {
    await ready(page, base);
    t.ok(await page.evaluate(() => window.__pt.stroke(window.__pt.T.PAINT, [1, 0, 0], 0, 0, 80, 1)), 'a painted object');
    const cost = await page.evaluate(() => {
      const { library, session } = window.__sculpt;
      const arr = session.getMesh().getColors();
      const t0 = performance.now();
      for (let i = 0; i < 50; i++) library.update(library.list()[0].id, { albedo: i % 2 ? '#2a5cff' : '#c46a3a' });
      return { ms: (performance.now() - t0) / 50, same: session.getMesh().getColors() === arr, n: session.getMesh().getNbVertices() };
    });
    console.log(`  an Albedo change on ${cost.n} vertices: ${cost.ms.toFixed(3)} ms`);
    t.ok(cost.ms < 5 && cost.same, `an Albedo change costs no more than a value (${cost.ms.toFixed(3)} ms on ${cost.n} vertices)`);
  },
};
