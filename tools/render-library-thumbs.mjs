// Renders the Asset library's light-rig and environment thumbnails from the app itself.
//
//   npm run build:test && node tools/render-library-thumbs.mjs [--dist dist] [--rigs public/assets/rigs] [--envs public/assets/env/thumbs]
//
// A rig's picture is a neutral grey ball under that rig (no environment light). An environment's is a chrome
// ball lit by it alone (the lights off), which shows what the picture holds at tile size. Both are the app's own
// sphere in its own Lit view, three-quarter on, the interface away. The ball is framed once and cut out of the
// flat background with one circle for all of them, so the pictures line up, and written as 96 x 96 PNGs with a
// transparent surround, the size and format the armature thumbnails (tools/render-armature-thumbs.mjs) have.
//
// It uses the browser plumbing of the end-to-end tests (tests/e2e/lib.mjs), so it runs where they do.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, serve } from '../tests/e2e/lib.mjs';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : fallback;
};
const dist = resolve(arg('dist', 'dist'));
const rigsOut = resolve(arg('rigs', 'public/assets/rigs'));
const envsOut = resolve(arg('envs', 'public/assets/env/thumbs'));
const SIZE = 96;
const SHOT = 480;

mkdirSync(rigsOut, { recursive: true });
mkdirSync(envsOut, { recursive: true });
const { base, close } = await serve(dist);
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: SHOT, height: SHOT }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => {
    window.__bozzettoAdaptiveOff = true;
    try {
      localStorage.setItem('bozzetto-device-choice', 'keep');
    } catch {
      // none
    }
  });
  const page = await ctx.newPage();
  // Only the picture of the ball: every other element of the page out of sight.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'body * { visibility: hidden !important; } body canvas { visibility: visible !important; }';
      document.head.appendChild(style);
    });
  });
  await page.goto(`${base}/?sculpt=1&start=sphere`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__sculpt, null, { timeout: 90_000 });
  const work = await ctx.newPage();
  await work.goto('about:blank');

  const settle = async () => {
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__sculpt.viewer.invalidate());
    await page.waitForTimeout(1500);
  };
  const shoot = async () => {
    await settle();
    return (await page.screenshot()).toString('base64');
  };

  // The ball: Lit, grey, no stage, no selection tint, no environment light.
  await page.evaluate(() => {
    const v = window.__sculpt.viewer;
    v.setGround('off');
    v.setMaterial('lit');
    v.materials.setAlbedo('#a0a0a0');
    v.materials.setRoughness(0.6);
    v.materials.setMetalness(0);
    v.environment.setBackgroundMode('color');
    v.environment.setBackgroundColor('#333333');
  });

  // Frame it once, on a bright rig, and find the ball against the flat background.
  await page.evaluate(() => window.__sculpt.viewer.lighting.applyPreset('three_point'));
  const first = await shoot();
  const circle = await work.evaluate(async ({ data }) => {
    const im = await new Promise((ok) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.src = `data:image/png;base64,${data}`;
    });
    const w = im.naturalWidth;
    const h = im.naturalHeight;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0);
    const px = g.getImageData(0, 0, w, h).data;
    const bg = [px[0], px[1], px[2]];
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let p = 0; p < w * h; p++) {
      const d = Math.max(Math.abs(px[p * 4] - bg[0]), Math.abs(px[p * 4 + 1] - bg[1]), Math.abs(px[p * 4 + 2] - bg[2]));
      if (d > 24) {
        const x = p % w;
        const y = (p / w) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    return { cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2, r: Math.max(x1 - x0 + 1, y1 - y0 + 1) / 2 };
  }, { data: first });
  console.log(`ball at ${circle.cx},${circle.cy} radius ${circle.r}`);

  const cut = (data) =>
    work.evaluate(
      async ({ data, circle, size }) => {
        const im = await new Promise((ok) => {
          const i = new Image();
          i.onload = () => ok(i);
          i.src = `data:image/png;base64,${data}`;
        });
        const out = document.createElement('canvas');
        out.width = size;
        out.height = size;
        const o = out.getContext('2d');
        o.imageSmoothingQuality = 'high';
        // A little margin round the ball, then the circle of the ball itself (a hair inside its edge).
        const side = circle.r * 2 * 1.06;
        o.save();
        o.beginPath();
        o.arc(size / 2, size / 2, ((circle.r - 0.5) / side) * size, 0, Math.PI * 2);
        o.clip();
        o.drawImage(im, circle.cx - side / 2, circle.cy - side / 2, side, side, 0, 0, size, size);
        o.restore();
        return out.toDataURL('image/png').split(',')[1];
      },
      { data, circle, size: SIZE },
    );

  const ids = await page.evaluate(() => window.__sculpt.viewer.lighting.presets().map((p) => p.id));
  for (const id of ids) {
    await page.evaluate((i) => window.__sculpt.viewer.lighting.applyPreset(i), id);
    writeFileSync(`${rigsOut}/${id}.png`, Buffer.from(await cut(await shoot()), 'base64'));
    console.log(`rig ${id} -> ${rigsOut}/${id}.png`);
  }

  // The chrome ball: no lights, the environment alone and bright.
  await page.evaluate(() => {
    const v = window.__sculpt.viewer;
    v.materials.setAlbedo('#ffffff');
    v.materials.setRoughness(0.08);
    v.materials.setMetalness(1);
    const none = { intensity: 0, color: '#ffffff', azimuth: 0, elevation: 0, castShadow: false, softness: 1, type: 'directional', enabled: false };
    v.lighting.applyRig({ lights: ['key', 'fill', 'rim'].map((id) => ({ ...none, id })), ambient: { intensity: 0, sky: '#ffffff', ground: '#ffffff' } });
    v.environment.setIntensity(5);
  });
  const envIds = await page.evaluate(() => window.__sculpt.viewer.environment.list().map((e) => e.id));
  for (const id of envIds) {
    const res = await page.evaluate((i) => window.__sculpt.viewer.environment.useEnvironment(i), id);
    if (res !== 'done') throw new Error(`environment ${id}: ${res}`);
    writeFileSync(`${envsOut}/${id}.png`, Buffer.from(await cut(await shoot()), 'base64'));
    console.log(`environment ${id} -> ${envsOut}/${id}.png`);
  }
} finally {
  await browser.close();
  close();
}
