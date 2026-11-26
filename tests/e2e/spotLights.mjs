// Spot lights in a rig (package spotlights): up to two beside the key, fill
// and rim, added from the Lighting tab, with a position, an aim, a cone and
// a penumbra, a shadow through the same tiers and softness as the others
// (drawn only when something it sees changes), a lamp and its cone drawn in
// the scene in Present and in no picture, picked with 4 and 5 and moved by
// L or by a drag on the lamp, kept in a rig and in a look.
//
// spotLights: all of that.
import { openSculpt } from './lib.mjs';
import { tapTab } from './lookTabs.mjs';

const SHOTS = '/tmp/claude-0/-home-user-bozzetto/6fb1e4da-2bbc-5c1e-9aed-93e15a9835c4/scratchpad/app/spotlights';

const ready = (page) => page.waitForFunction(() => !document.getElementById('overlay') && !!window.__bozzetto?.pipeline, null, { timeout: 90_000 });
const frames = (page, n = 2) => page.evaluate((k) => window.__bozzetto.whenFramesDrawn(k), n);

/** The next frame drawn, kept in the page under `key`. */
const snapshot = async (page, key) => {
  await page.evaluate(async (k) => {
    await window.__bozzetto.whenFramesDrawn(2);
    const src = window.__bozzetto.captureCanvas;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    (window.__shots ??= {})[k] = { w: c.width, h: c.height, d: ctx.getImageData(0, 0, c.width, c.height).data };
  }, key);
};

/** Luminance (0..255) at world points in a kept frame: the mean of a small square around each. */
const lums = (page, key, points, half = 2) =>
  page.evaluate(
    ([k, pts, hf]) => {
      const v = window.__bozzetto;
      const shot = window.__shots[k];
      return pts.map((q) => {
        const p = v.camera.position.clone().set(q[0], q[1], q[2]).project(v.camera);
        const x = Math.round(((p.x + 1) / 2) * shot.w);
        const y = Math.round(((1 - p.y) / 2) * shot.h);
        let sum = 0;
        let n = 0;
        for (let dy = -hf; dy <= hf; dy++) {
          for (let dx = -hf; dx <= hf; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= shot.w || yy >= shot.h) continue;
            const j = (yy * shot.w + xx) * 4;
            sum += 0.2126 * shot.d[j] + 0.7152 * shot.d[j + 1] + 0.0722 * shot.d[j + 2];
            n++;
          }
        }
        return n ? sum / n : NaN;
      });
    },
    [key, points, half],
  );

/** The 10% to 90% rise of a profile that goes from dark to light, as a share of the segment. */
const riseWidth = (prof) => {
  const lo = Math.min(...prof.map(([, l]) => l));
  const hi = Math.max(...prof.map(([, l]) => l));
  const at = (f) => prof.find(([, l]) => l >= lo + (hi - lo) * f)?.[0] ?? NaN;
  return at(0.9) - at(0.1);
};

const profile = (page, key, a, b, n = 160) =>
  page.evaluate(
    ([k, A, B, N]) => {
      const v = window.__bozzetto;
      const shot = window.__shots[k];
      const out = [];
      const p = v.camera.position.clone();
      for (let i = 0; i <= N; i++) {
        const s = i / N;
        p.set(A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s, A[2] + (B[2] - A[2]) * s).project(v.camera);
        const x = Math.round(((p.x + 1) / 2) * shot.w);
        const y = Math.round(((1 - p.y) / 2) * shot.h);
        if (x < 0 || y < 0 || x >= shot.w || y >= shot.h) continue;
        const j = (y * shot.w + x) * 4;
        out.push([s, 0.2126 * shot.d[j] + 0.7152 * shot.d[j + 1] + 0.0722 * shot.d[j + 2]]);
      }
      return out;
    },
    [key, a, b, n],
  );

/** A change to the subject's geometry: the position attribute of the mesh that casts is marked as sent again (its version moves), as a stroke's commit does. */
const nudgeModel = (page) =>
  page.evaluate(() => {
    const v = window.__bozzetto;
    let moved = 0;
    v.scene.traverseVisible((o) => {
      if (moved || !o.isMesh || !o.castShadow || !o.visible || o.name.startsWith('spot-')) return;
      o.geometry.attributes.position.needsUpdate = true;
      moved++;
    });
    v.invalidate();
    return moved;
  });

const spots = (page) => page.evaluate(() => window.__bozzetto.lighting.spotState());
const counters = (page) => page.evaluate(() => window.__bozzetto.renderCounters());
const grew = (a, b) => Object.fromEntries(Object.keys(a).filter((k) => b[k] !== a[k]).map((k) => [k, b[k] - a[k]]));
const spotPasses = (page, id = 'spot1') => page.evaluate((i) => window.__bozzetto.passCounts().shadows[i], id);

/** The subject's bounds as the page has them: the sphere on the floor. */
const subject = (page) =>
  page.evaluate(() => {
    const v = window.__bozzetto;
    const b = v.subjectBoundsNow();
    return { min: b.min.toArray(), max: b.max.toArray(), c: b.getCenter(b.min.clone()).toArray(), R: (b.max.x - b.min.x) / 2, y: v.ground.position.y };
  });

async function intoPresent(page, base, query = '') {
  await openSculpt(page, base, `&nosplash=1${query}`);
  await ready(page);
  await page.evaluate(() => window.__sculpt.present.enter());
  await page.waitForFunction(() => document.body.classList.contains('presenting'), null, { timeout: 8000 });
  await page.evaluate(() => {
    const v = window.__bozzetto;
    v.setAntialias('always');
    v.setGround('floor');
    const L = v.lighting;
    const rig = L.rigValues();
    rig.lights = rig.lights.map((l) => ({ ...l, enabled: false }));
    rig.ambient = { ...rig.ambient, intensity: 0.05 };
    L.applyRig(rig);
  });
  await frames(page, 3);
}

export const suites = {
  async spotLights(page, base, t) {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width: 1180, height: 820 });
    await intoPresent(page, base);
    const s = await subject(page);
    const R = s.R;
    const floorAt = (x, z) => [s.c[0] + x, s.y, s.c[2] + z];
    t.ok(R > 3, `the sphere is real size (${R.toFixed(1)} cm radius)`);

    // --- an old look has none ------------------------------------------------------------------
    t.eq(await page.evaluate(() => window.__bozzetto.lighting.spotCount()), 0, 'a fresh scene has no spot light');
    t.ok(await page.evaluate(() => !('spots' in window.__bozzetto.lighting.serialize()) && !('spots' in window.__bozzetto.lighting.rigValues())), 'and its record and rig carry no spots key');
    t.eq(await page.evaluate(() => window.__bozzetto.lamps.shownIds().length), 0, 'and no lamp is drawn');

    // --- add: the build, the defaults ----------------------------------------------------------
    const c0 = await counters(page);
    const id = await page.evaluate(() => window.__bozzetto.lighting.addSpot());
    t.eq(id, 'spot1', 'adding a spot makes Spot 1');
    await frames(page, 3);
    const first = grew(c0, await counters(page));
    t.ok(true, `the first use builds: ${JSON.stringify(first)}`);
    const d = (await spots(page))[0];
    t.ok(d.enabled && d.angle === 30 && d.penumbra === 0.3 && d.castShadow && d.aim === null, `defaults: on, 30 degrees, penumbra 0.3, shadow on, aimed at the centre (${JSON.stringify([d.angle, d.penumbra, d.castShadow, d.aim])})`);
    const H = s.max[1] - s.min[1];
    t.ok(Math.abs(Math.hypot(d.position[0], d.position[1] - H / 2, d.position[2]) - 2 * H) < 0.5 && d.position[1] > H / 2 && d.position[2] > 0, `above and in front, twice the height away (${d.position.map((n) => n.toFixed(1))})`);

    // --- it lights the floor where it points ----------------------------------------------------
    // Straight down onto a spot of floor beside the sphere, a narrow cone.
    const aim = [2 * R, 0, 0];
    const place = (patch) => page.evaluate((p) => window.__bozzetto.lighting.setSpot('spot1', p), patch);
    await place({ position: [aim[0], 6 * R, 0.0001], aim, angle: 12, penumbra: 0, castShadow: false });
    await frames(page, 3);
    await snapshot(page, 'hard');
    const inside = floorAt(aim[0], aim[2]);
    const outside = floorAt(-2 * R, 0);
    const [lin, lout] = await lums(page, 'hard', [inside, outside]);
    t.ok(lin > lout + 20, `pixels inside the cone are brighter than outside (${lin.toFixed(0)} against ${lout.toFixed(0)})`);
    // 6 R up with 12 degrees: a footprint of 1.27 R. A point most of the way to the edge is fully lit by a hard cone and only partly by a soft one.
    const nearEdge = floorAt(aim[0], -1.08 * R);
    const [hardEdge, hardMid] = await lums(page, 'hard', [nearEdge, inside]);
    await place({ penumbra: 1 });
    await frames(page, 3);
    await snapshot(page, 'soft');
    const [softEdge, softMid] = await lums(page, 'soft', [nearEdge, inside]);
    t.ok(hardEdge > softEdge * 1.5 && hardEdge > hardMid * 0.8, `the penumbra softens the edge: near the edge a hard cone gives ${hardEdge.toFixed(0)}, a soft one ${softEdge.toFixed(0)}`);
    t.ok(softMid > hardMid * 0.5, `and the middle stays lit (${softMid.toFixed(0)} against ${hardMid.toFixed(0)})`);

    // --- cone angle -----------------------------------------------------------------------------
    await place({ penumbra: 0, angle: 12 });
    await frames(page, 3);
    await snapshot(page, 'narrow');
    const beyond = floorAt(aim[0], -1.6 * R);
    const [narrow] = await lums(page, 'narrow', [beyond]);
    await place({ angle: 40 });
    await frames(page, 3);
    await snapshot(page, 'wide');
    const [wide] = await lums(page, 'wide', [beyond]);
    t.ok(wide > narrow + 20, `a wider cone lights what a narrow one leaves dark (${narrow.toFixed(0)} to ${wide.toFixed(0)})`);
    await place({ angle: 500, penumbra: 9 });
    const held = (await spots(page))[0];
    t.ok(held.angle === 80 && held.penumbra === 1, `values are held to their limits (${held.angle}, ${held.penumbra})`);

    // --- no build for a slider move --------------------------------------------------------------
    await place({ angle: 30, penumbra: 0.3, castShadow: true, softness: 5 });
    await frames(page, 3);
    const c1 = await counters(page);
    for (const p of [{ intensity: 2 }, { angle: 25 }, { penumbra: 0.6 }, { softness: 9 }, { position: [R, 5 * R, 3 * R] }, { color: '#aabbff' }]) {
      await place(p);
      await frames(page, 2);
    }
    t.eq(JSON.stringify(grew(c1, await counters(page))), '{}', 'moving its sliders builds no shader, pipeline, texture or buffer');

    // --- the shadow -------------------------------------------------------------------------------
    // From above and to the side at the sphere: its shadow falls on the floor on the far side.
    await place({ position: [-4 * R, 4.5 * R, 0.0001], aim: [0, R, 0], angle: 40, penumbra: 0.2, softness: 2, castShadow: false, intensity: 4 });
    await frames(page, 3);
    await snapshot(page, 'unshadowed');
    const behind = floorAt(2.2 * R, 0);
    const [lit] = await lums(page, 'unshadowed', [behind]);
    await place({ castShadow: true });
    await frames(page, 3);
    await snapshot(page, 'shadowed');
    const [dark] = await lums(page, 'shadowed', [behind]);
    t.ok(lit > 20 && dark < lit * 0.6, `its shadow falls: the floor behind the sphere is ${dark.toFixed(0)} with the shadow, ${lit.toFixed(0)} without`);
    await page.screenshot({ path: `${SHOTS}/spotlights-test-shadow.png` });

    // --- the shadow map is drawn only when something it sees changes ---------------------------------
    const held0 = await spotPasses(page);
    await frames(page, 4);
    t.eq((await spotPasses(page)) - held0, 0, 'with nothing changing, its shadow map is not drawn again');
    await page.evaluate(() => {
      window.__bozzetto.orbitAzimuth(30);
    });
    await frames(page, 4);
    t.eq((await spotPasses(page)) - held0, 0, 'a turn of the view (the turntable) draws no spot shadow');
    await place({ softness: 6 });
    await frames(page, 3);
    t.ok((await spotPasses(page)) - held0 >= 1, 'a change to its softness draws it');
    const afterSoft = await spotPasses(page);
    await place({ intensity: 3 });
    await frames(page, 3);
    t.eq((await spotPasses(page)) - afterSoft, 0, 'its intensity does not (the map does not depend on it)');
    // the model changing: a transform
    t.eq(await nudgeModel(page), 1, 'one mesh casts here');
    await frames(page, 3);
    t.ok((await spotPasses(page)) - afterSoft >= 1, 'the model changing (its geometry sent again) draws it');

    // --- four picks it, L moves it, the tab follows -------------------------------------------------
    await tapTab(page, 'panel--lighting');
    await page.keyboard.press('4');
    await page.waitForFunction(() => [...document.querySelectorAll('.sculpt-toast')].some((e) => e.textContent === 'Spot 1 light'), null, { timeout: 5000 });
    t.ok(true, '4 says "Spot 1 light"');
    await page.keyboard.press('5');
    await page.waitForFunction(() => [...document.querySelectorAll('.sculpt-toast')].some((e) => /^No Spot 2 light/.test(e.textContent)), null, { timeout: 5000 });
    t.ok(true, '5 with no Spot 2 says so and picks nothing');
    await page.keyboard.press('4');
    const before = (await spots(page))[0];
    await page.mouse.move(300, 300);
    await page.keyboard.down('l');
    await page.mouse.move(310, 300);
    await page.mouse.move(330, 300);
    await page.keyboard.up('l');
    const after = (await spots(page))[0];
    const dist = (p, a) => Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
    const aimOf = (sp) => sp.aimNow;
    t.ok(Math.abs(dist(after.position, aimOf(after)) - dist(before.position, aimOf(before))) < 0.05, 'hold-L swings it around the subject at its distance');
    t.ok(dist(after.position, before.position) > 1, `and it moved (${before.position.map((n) => n.toFixed(1))} to ${after.position.map((n) => n.toFixed(1))})`);
    t.eq(JSON.stringify(after.aim), JSON.stringify(before.aim), 'its aim stays on its target');
    await page.waitForFunction(
      (x) => {
        const box = document.querySelector('.panel--lighting .light[data-light="spot1"]');
        return !!box && [...box.querySelectorAll('input')].some((i) => Math.abs(Number(i.value) - x) < 1.01);
      },
      after.position[0],
      { timeout: 6000 },
    );
    t.ok(true, `the Lighting tab's position row follows to ${after.position[0].toFixed(0)}`);

    // --- a drag on the lamp ---------------------------------------------------------------------------
    t.eq(await page.evaluate(() => window.__bozzetto.lamps.shownIds().join()), 'spot1', 'the lamp is drawn in Present');
    await page.evaluate(() => {
      // Above the sphere and a little toward the viewer: in view, clear of the panels, nothing in front of it.
      const v = window.__bozzetto;
      const b = v.subjectBoundsNow();
      const r = (b.max.x - b.min.x) / 2;
      const c = b.getCenter(b.min.clone());
      const toCam = v.camera.position.clone().sub(c).normalize();
      const up = v.camera.up.clone();
      const p = c.clone().addScaledVector(up, 1.2 * r).addScaledVector(toCam, 0.8 * r);
      const f = v.lighting.subjectFloorForTests();
      v.lighting.setSpot('spot1', { position: [p.x - f.x, p.y - f.y, p.z - f.z], aim: null });
    });
    await frames(page, 3);
    const lampAt = () =>
      page.evaluate(() => {
        const v = window.__bozzetto;
        const P = v.camera.position.clone();
        const A = P.clone();
        v.lighting.spotPlacement('spot1', P, A);
        const dir = A.sub(P).normalize();
        const mid = P.clone().addScaledVector(dir, -4.5).project(v.camera);
        const r = v.captureCanvas.getBoundingClientRect();
        return [r.left + (mid.x * 0.5 + 0.5) * r.width, r.top + (-mid.y * 0.5 + 0.5) * r.height];
      });
    const [lx, ly] = await lampAt();
    const found = await page.evaluate(([x, y]) => {
      const v = window.__bozzetto;
      return v.lamps.hit(x, y, v.camera, v.captureCanvas.getBoundingClientRect(), v.subjectBoundsNow(), v.lighting);
    }, [lx, ly]);
    t.eq(found, 'spot1', `the lamp is found under a press at ${lx.toFixed(0)}, ${ly.toFixed(0)}`);
    const posA = (await spots(page))[0].position;
    await page.evaluate(() => {
      window.__lampLog = [];
      window.addEventListener('pointerdown', (e) => window.__lampLog.push(`down on ${e.target.tagName}.${e.target.className} at ${e.clientX},${e.clientY} button ${e.button}`), true);
      window.__sculpt.input.verdict = (text) => window.__lampLog.push(`verdict ${text}`);
    });
    await page.mouse.move(lx, ly);
    await page.mouse.down();
    await page.mouse.move(lx + 20, ly + 10, { steps: 4 });
    await page.mouse.move(lx + 60, ly + 30, { steps: 4 });
    await page.mouse.up();
    const posB = (await spots(page))[0].position;
    const lampLog = await page.evaluate(() => window.__lampLog.join(' | '));
    t.ok(dist(posA, posB) > 1, `a drag on the drawn lamp moves the light (${posA.map((n) => n.toFixed(1))} to ${posB.map((n) => n.toFixed(1))}; ${lampLog})`);
    await page.screenshot({ path: `${SHOTS}/spotlights-test-lamp.png` });

    // --- the lamp: hidden behind the model, in no capture ----------------------------------------------
    const lampPixels = async (position) => {
      await page.evaluate((p) => window.__bozzetto.lighting.setSpot('spot1', { position: p, aim: null, penumbra: 0.3 }), position);
      await frames(page, 3);
      await page.evaluate(() => window.__bozzetto.lamps.setWanted(true));
      await snapshot(page, 'lamp-on');
      await page.evaluate(() => window.__bozzetto.lamps.setWanted(false));
      await snapshot(page, 'lamp-off');
      await page.evaluate(() => window.__bozzetto.lamps.setWanted(true));
      return page.evaluate(() => {
        const v = window.__bozzetto;
        const P = v.camera.position.clone();
        const A = P.clone();
        v.lighting.spotPlacement('spot1', P, A);
        const dir = A.sub(P).normalize();
        const mid = P.clone().addScaledVector(dir, -4.5).project(v.camera);
        const a = window.__shots['lamp-on'];
        const b = window.__shots['lamp-off'];
        const cx = Math.round(((mid.x + 1) / 2) * a.w);
        const cy = Math.round(((1 - mid.y) / 2) * a.h);
        let diff = 0;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const j = ((cy + dy) * a.w + (cx + dx)) * 4;
          diff += Math.abs(a.d[j] - b.d[j]) + Math.abs(a.d[j + 1] - b.d[j + 1]) + Math.abs(a.d[j + 2] - b.d[j + 2]);
        }
        return diff / 49;
      });
    };
    const inFront = await lampPixels([-2.2 * R, 1.5 * R, 0]);
    t.ok(inFront > 30, `the lamp is drawn where nothing is in front of it (${inFront.toFixed(0)} apart from the view without it)`);
    const rayBehind = await page.evaluate(() => {
      const v = window.__bozzetto;
      const b = v.subjectBoundsNow();
      const c = b.getCenter(b.min.clone());
      const f = v.lighting.subjectFloorForTests();
      const away = c.clone().sub(v.camera.position).normalize();
      const p = c.clone().addScaledVector(away, 2.4 * ((b.max.x - b.min.x) / 2));
      return [p.x - f.x, p.y - f.y, p.z - f.z];
    });
    const behindModel = await lampPixels(rayBehind);
    t.ok(behindModel < 6, `and is hidden where the model is in front of it (${behindModel.toFixed(1)} apart)`);

    const still = () =>
      page.evaluate(async () => {
        const blob = await window.__sculpt.viewer.captureStill(1);
        const sum = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return [...new Uint8Array(sum)].map((b) => b.toString(16).padStart(2, '0')).join('');
      });
    await page.evaluate((p) => window.__bozzetto.lighting.setSpot('spot1', { position: p }), [-2.2 * R, 1.5 * R, 0]);
    await frames(page, 3);
    const withLamps = await still();
    await page.evaluate(() => window.__bozzetto.lamps.setWanted(false));
    await frames(page, 2);
    const noLamps = await still();
    await page.evaluate(() => window.__bozzetto.lamps.setWanted(true));
    t.eq(withLamps, noLamps, 'a saved picture is the same with the lamps up and without: they are in no capture');

    // --- a rig with spots saves, reloads, exports, imports -----------------------------------------------
    await page.evaluate(() => {
      const L = window.__bozzetto.lighting;
      L.addSpot();
      L.setSpot('spot2', { position: [11, 22, 33], aim: [1, 2, 3], angle: 20, penumbra: 0.7, intensity: 2.5, color: '#88ccff', softness: 7 });
    });
    t.eq(await page.evaluate(() => window.__bozzetto.lighting.canAddSpot()), false, 'two spots are the most');
    await page.evaluate(() => window.__bozzetto.lighting.setEnabled('key', true));
    const btn = (name) => page.evaluate((n) => [...document.querySelectorAll('.panel--lighting button')].find((b) => b.textContent === n)?.click(), name);
    page.once('dialog', (dlg) => dlg.accept('Two spots'));
    await btn('Save rig…');
    await page.waitForFunction(() => (localStorage.getItem('bz.rigs') ?? '').includes('Two spots'), null, { timeout: 5000 });
    const kept = JSON.parse(await page.evaluate(() => localStorage.getItem('bz.rigs')));
    const mine = kept.find((r) => r.name === 'Two spots');
    t.ok(mine.rig.spots?.length === 2 && mine.rig.spots[1].id === 'spot2' && mine.rig.spots[1].aim[2] === 3, 'My rigs keeps both spots with their places and aims');
    // reload: another rig, then mine again
    await page.selectOption('.panel--lighting select', 'built:top_light');
    t.eq(await page.evaluate(() => window.__bozzetto.lighting.spotCount()), 0, 'a built-in rig has no spots, so picking one takes them out');
    await page.selectOption('.panel--lighting select', { label: 'Two spots' });
    const back = await spots(page);
    t.ok(back.length === 2 && back[1].angle === 20 && back[1].penumbra === 0.7 && back[1].position[2] === 33 && back[1].color === '#88ccff', 'picking it brings both spots back as they were');
    // export
    await btn('Manage');
    const dl = page.waitForEvent('download', { timeout: 8000 });
    await page.evaluate(() => document.querySelector('.rig-manage__row [data-role=rig-export]').click());
    const file = await dl;
    let text = '';
    for await (const c of await file.createReadStream()) text += c;
    const json = JSON.parse(text);
    t.ok(json.lights.length === 5 && json.lights.filter((l) => l.type === 'spot').map((l) => l.id).join() === 'spot1,spot2', 'the file lists the three directional lights and the two spots, each with a type');
    // import: after the spots are removed
    await page.evaluate(() => {
      window.__bozzetto.lighting.removeSpot('spot1');
      window.__bozzetto.lighting.removeSpot('spot2');
    });
    json.name = 'Imported spots';
    await page.setInputFiles('.panel--lighting .rig-file', { name: 'spots.bozzrig', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
    await page.waitForFunction(() => window.__bozzetto.lighting.spotCount() === 2, null, { timeout: 6000 });
    t.ok(true, 'importing the file applies its spots');
    // out of range numbers are held; a file without spots reads as before
    const wild = JSON.parse(text);
    wild.name = 'Wild spots';
    wild.lights[3].angle = 400;
    wild.lights[3].penumbra = -4;
    wild.lights[3].position = [1e9, 0, 0];
    await page.setInputFiles('.panel--lighting .rig-file', { name: 'wild.bozzrig', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wild)) });
    await page.waitForFunction(() => [...document.querySelectorAll('.panel--lighting select option')].some((o) => o.textContent === 'Wild spots'), null, { timeout: 5000 });
    const w = (await spots(page)).find((x) => x.id === 'spot1');
    t.ok(w.angle === 80 && w.penumbra === 0 && w.position[0] === 100000, `spot numbers are held to their limits (${w.angle}, ${w.penumbra}, ${w.position[0]})`);
    const plain = JSON.parse(text);
    plain.name = 'No spots';
    plain.lights = plain.lights.filter((l) => l.type === 'directional');
    await page.setInputFiles('.panel--lighting .rig-file', { name: 'plain.bozzrig', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plain)) });
    await page.waitForFunction(() => [...document.querySelectorAll('.panel--lighting select option')].some((o) => o.textContent === 'No spots'), null, { timeout: 5000 });
    t.eq(await page.evaluate(() => window.__bozzetto.lighting.spotCount()), 0, 'a rig file without spots reads as it always did: no spots');

    // --- a look keeps the spots; an old look has none ---------------------------------------------------------
    await page.evaluate(() => {
      const L = window.__bozzetto.lighting;
      L.addSpot();
      L.setSpot('spot1', { angle: 17, penumbra: 0.9 });
    });
    const record = await page.evaluate(() => JSON.parse(JSON.stringify(window.__bozzetto.lighting.serialize())));
    t.ok(record.spots?.spot1?.angle === 17, 'the look record carries the spot');
    await page.evaluate(() => window.__bozzetto.lighting.removeSpot('spot1'));
    await page.evaluate((r) => window.__bozzetto.lighting.applyState(r), record);
    t.eq((await spots(page)).map((x) => `${x.id}:${x.angle}:${x.penumbra}`).join(), 'spot1:17:0.9', 'applying the record brings the spot back');
    const old = { ...record };
    delete old.spots;
    await page.evaluate((r) => window.__bozzetto.lighting.applyState(r), old);
    t.eq(await page.evaluate(() => window.__bozzetto.lighting.spotCount()), 0, 'a record from before spots lights as it did: no spots');

    // --- removing a spot frees its shadow ---------------------------------------------------------------------
    await page.evaluate(() => {
      const L = window.__bozzetto.lighting;
      L.addSpot();
      L.setSpot('spot1', { castShadow: true });
    });
    await frames(page, 3);
    const live = await spotPasses(page);
    t.ok(live > 0, 'a spot draws its shadow map');
    await page.evaluate(() => window.__bozzetto.lighting.removeSpot('spot1'));
    await frames(page, 3);
    const gone = await spotPasses(page);
    await nudgeModel(page);
    await frames(page, 4);
    t.eq((await spotPasses(page)) - gone, 0, 'removed, no pass is drawn for it again');
    t.eq(await page.evaluate(() => window.__bozzetto.scene.children.filter((o) => o.isSpotLight).length), 0, 'and its light is out of the scene');
    t.eq(await page.evaluate(() => window.__bozzetto.lamps.shownIds().length), 0, 'and its lamp with it');

    // --- the Lighting tab ------------------------------------------------------------------------------------
    const addBtn = await page.evaluate(() => !![...document.querySelectorAll('.panel--lighting button')].find((b) => b.textContent === 'Add spot light'));
    t.ok(addBtn, 'the Lighting tab has "Add spot light"');
    await btn('Add spot light');
    await page.waitForSelector('.panel--lighting .light[data-light="spot1"]', { timeout: 5000 });
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.panel--lighting .light[data-light="spot1"] label span:first-child, .panel--lighting .light[data-light="spot1"] label.checkbox > span')].map((e) => e.textContent),
    );
    t.eq(rows.join('|'), 'Spot 1|Intensity|Colour|Position X|Position Y|Position Z|Aim X|Aim Y|Aim Z|Cone angle|Penumbra|Casts shadow|Softness', 'a spot section has its rows');
    await page.screenshot({ path: `${SHOTS}/spotlights-tab.png` });
    await btn('Add spot light');
    await page.waitForSelector('.panel--lighting .light[data-light="spot2"]', { timeout: 5000 });
    t.ok(await page.evaluate(() => ![...document.querySelectorAll('.panel--lighting button')].some((b) => b.textContent === 'Add spot light')), 'with two spots there is no Add button');
    await page.evaluate(() => document.querySelector('.panel--lighting .light[data-light="spot1"] [data-role=spot-remove]').click());
    await page.waitForFunction(() => !document.querySelector('.panel--lighting .light[data-light="spot1"]'), null, { timeout: 5000 });
    t.ok(await page.evaluate(() => window.__bozzetto.lighting.spotCount() === 1 && window.__bozzetto.lighting.hasSpot('spot2')), 'Remove takes that spot out and leaves the other');

    t.eq(errors.join('\n'), '', 'no page errors');
  },
};
