// The wireframe and ambient occlusion (owner report, an iPhone: with
// Wireframe on and GTAO the wire drew dark smudges and broken, thickened
// strokes along its lines). The wire overlay shares the surface's geometry;
// it went through the scene pass like the surface did, so its pixels wrote
// the view-space normal GTAO reads (a line has no normal of its own) and
// then went through the AO's multiply with the surface under it. It now
// writes nothing to the AO's inputs and is composited over the occluded
// surface, so turning AO on may not change a wire pixel by more than the
// surface under it changes (the wire's own look is unchanged).
//
// Four frames on the same view: wire off/on x AO off/on. A wire pixel is one
// the wire changes with AO off; there, AO on may move the pixel by no more
// than it moves it with no wire (the surface beneath, blended at the wire's
// opacity, can only move less). The check can see AO: with the wire off,
// AO moves a crease of the surface (the floor's contact) by a clear amount.
// GTAO is the model that failed; the cavity (SSAO), which reads depth
// only, is the guard.
import { openForInput } from './smoke.mjs';

const frames = (page, n = 1) => page.evaluate((k) => window.__bozzetto.whenFramesDrawn(k), n);

/** The next frame the viewer draws, kept in the page under `key`. */
const snapshot = (page, key) =>
  page.evaluate(async (k) => {
    await window.__bozzetto.whenFramesDrawn(2);
    const src = window.__bozzetto.captureCanvas;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    (window.__shots ??= {})[k] = ctx.getImageData(0, 0, c.width, c.height).data;
  }, key);

/** The four frames against each other (see the header). */
const measure = (page) =>
  page.evaluate(() => {
    const { aoOff: A, aoOn: B, wireOff: C, wireOn: D } = window.__shots;
    // A: no wire, no AO. B: no wire, AO. C: wire, no AO. D: wire and AO.
    let wirePx = 0;
    let wireExcess = 0;
    let wireBad = 0;
    let creasePx = 0;
    let creaseMax = 0;
    let wireTotal = 0;
    for (let i = 0; i < A.length; i += 4) {
      const chan = (X, Y) => Math.max(Math.abs(X[i] - Y[i]), Math.abs(X[i + 1] - Y[i + 1]), Math.abs(X[i + 2] - Y[i + 2]));
      const wire = chan(C, A) > 12;
      const ao = chan(B, A);
      if (wire) {
        wirePx++;
        const extra = chan(D, C) - ao;
        if (extra > wireExcess) wireExcess = extra;
        if (extra > 6) wireBad++;
        wireTotal += chan(D, C);
      }
      // Where the surface alone is changed by AO, wire or none (frames A and B have no wire).
      if (ao > 4) {
        creasePx++;
        if (ao > creaseMax) creaseMax = ao;
      }
    }
    return { wirePx, wireExcess, wireBad, creasePx, creaseMax, wireMean: wireTotal / Math.max(1, wirePx) };
  });

/** Preferences > anti-aliasing: Off, so frames are plain and repeatable. */
const antialiasOff = async (page) => {
  await page.keyboard.press('Control+Comma');
  await page.locator('[data-setting="antialias"] .prefs__choice', { hasText: 'Off' }).click();
  await page.keyboard.press('Escape');
};

/** Take the four frames with AO set by `ao(on)`, and measure. */
async function fourFrames(page, setAO) {
  const take = async (key, wire, ao) => {
    await page.evaluate(([w]) => window.__bozzetto.setWireframe(w), [wire]);
    await page.evaluate(setAO, ao);
    await frames(page, 2);
    await snapshot(page, key);
  };
  await take('aoOff', false, false);
  await take('aoOn', false, true);
  await take('wireOff', true, false);
  await take('wireOn', true, true);
  return measure(page);
}

const CHECK = (t, m, where) => {
  t.ok(m.wirePx > 300, `${where}: the wire has pixels to look at (${m.wirePx})`);
  t.ok(m.creasePx > 200 && m.creaseMax > 8, `${where}: and AO moves the surface at its crease, with no wire in the frame (${m.creasePx} pixels, up to ${m.creaseMax} levels)`);
  t.ok(m.wireExcess <= 6 && m.wireBad <= Math.max(2, m.wirePx * 0.002), `${where}: turning AO on moves a wire pixel by no more than it moves the surface there (worst excess ${m.wireExcess} levels, ${m.wireBad} of ${m.wirePx} pixels over 6)`);
};

export const suites = {
  // Sculpt's wire (the mesh's own edges as lines) over GTAO, and over the cavity.
  async wireAoSculpt(page, base, t) {
    await openForInput(page, base);
    await antialiasOff(page);
    await page.keyboard.press('f');
    await page.evaluate(() => {
      const v = window.__bozzetto;
      v.setGround('floor');
      v.setWireframeOpacity(1);
      // No mirrored copy, no selection halo: the view is the sphere on the floor.
      window.__sculpt.session.getSculptManager()._symmetry = false;
    });
    await frames(page, 3);
    const models = {
      gtao: (on) => {
        const v = window.__bozzetto;
        v.setSculptAO({ strength: 0 });
        v.setAO({ enabled: on, intensity: 2, radiusCm: 6 });
      },
      cavity: (on) => {
        const v = window.__bozzetto;
        v.setAO({ enabled: false });
        v.setSculptAO({ strength: on ? 1 : 0 });
      },
    };
    for (const [model, set] of Object.entries(models)) {
      const m = await fourFrames(page, set);
      CHECK(t, m, `Sculpt, ${model}`);
    }
  },

  // The public viewer's wire (the triangle wireframe) over GTAO.
  async wireAoViewer(page, base, t) {
    await page.goto(`${base}/?tl=demo`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__bozzetto?.pipeline && !document.getElementById('overlay'), null, { timeout: 90_000 });
    await page.evaluate(() => {
      const v = window.__bozzetto;
      v.pause();
      v.setWireframeOpacity(1);
      v.setAO({ intensity: 2 });
    });
    await page.waitForTimeout(300);
    const m = await fourFrames(page, (on) => window.__bozzetto.setAO({ enabled: on, intensity: 2 }));
    CHECK(t, m, 'the public viewer, GTAO');
  },
};
