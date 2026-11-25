// Renders the Create choices' armature thumbnails from the app itself.
//
//   npm run build:test && node tools/render-armature-thumbs.mjs [--dist dist] [--out public/assets/armature/thumbs]
//
// Each mannequin and placeholder rig the Armature tab's Preset select offers is loaded in Armature in its
// rest pose and drawn three-quarter front (Armature's own view), under the app's own neutral lighting, with
// the floor, the handles and the interface away. The page's flat background is keyed out to transparency,
// the picture is cropped to the figure and set in a square with a small margin, as the base meshes'
// thumbnails are, and written as a 96 x 96 PNG.
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
const out = resolve(arg('out', 'public/assets/armature/thumbs'));
const SIZE = 96;
const SHOT = 480;
/** The same ids and order as the Preset select (src/armature/presets.ts, figures.ts). */
const IDS = [
  'placeholder-male',
  'placeholder-female',
  'mannequin-male-realistic',
  'mannequin-female-realistic',
  'mannequin-male-stylized',
  'mannequin-female-stylized',
];

mkdirSync(out, { recursive: true });
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
  // Only the picture of the figure: every other element of the page out of sight.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'body * { visibility: hidden !important; } body canvas { visibility: visible !important; }';
      document.head.appendChild(style);
    });
  });
  await page.goto(`${base}/?armature=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__armature && !!window.__sculpt, null, { timeout: 90_000 });
  const work = await ctx.newPage();
  await work.goto('about:blank');
  await page.evaluate(() => {
    for (const name of ['IK handles', 'Plant feet']) {
      const box = [...document.querySelectorAll('label')].find((l) => l.textContent.includes(name))?.querySelector('input');
      if (box?.checked) box.click();
    }
  });

  for (const id of IDS) {
    await page.evaluate((i) => window.__armature.figure(i), id);
    // Armature's own view is three-quarter front: framed, the floor and the IK handles off.
    await page.evaluate(() => {
      window.__sculpt.viewer.setGround('off');
      window.__armature.frame();
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__sculpt.viewer.invalidate());
    await page.waitForTimeout(1500);
    const shot = (await page.screenshot()).toString('base64');
    const png = await work.evaluate(
      async ({ data, size, margin }) => {
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
        const img = g.getImageData(0, 0, w, h);
        const px = img.data;
        // The background is the page's flat fill: read off the corner, keyed out with a short soft edge.
        const bg = [px[0], px[1], px[2]];
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let p = 0; p < w * h; p++) {
          const d = Math.max(Math.abs(px[p * 4] - bg[0]), Math.abs(px[p * 4 + 1] - bg[1]), Math.abs(px[p * 4 + 2] - bg[2]));
          const alpha = Math.min(1, Math.max(0, (d - 4) / 28));
          px[p * 4 + 3] = alpha * 255;
          if (alpha > 0.5) {
            const x = p % w;
            const y = (p / w) | 0;
            x0 = Math.min(x0, x); x1 = Math.max(x1, x);
            y0 = Math.min(y0, y); y1 = Math.max(y1, y);
          }
        }
        g.putImageData(img, 0, 0);
        const side = Math.max(x1 - x0 + 1, y1 - y0 + 1) * (1 + margin * 2);
        const cx = (x0 + x1 + 1) / 2;
        const cy = (y0 + y1 + 1) / 2;
        const out = document.createElement('canvas');
        out.width = size;
        out.height = size;
        const o = out.getContext('2d');
        o.imageSmoothingQuality = 'high';
        o.drawImage(c, cx - side / 2, cy - side / 2, side, side, 0, 0, size, size);
        return { data: out.toDataURL('image/png').split(',')[1], box: [x0, y0, x1, y1] };
      },
      { data: shot, size: SIZE, margin: 0.04 },
    );
    writeFileSync(`${out}/${id}.png`, Buffer.from(png.data, 'base64'));
    console.log(`${id}: figure at ${png.box.join(',')} -> ${out}/${id}.png`);
  }
} finally {
  await browser.close();
  close();
}
