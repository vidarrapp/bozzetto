/**
 * Generate the web-app icons: a placeholder mark (the default sculpt sphere,
 * clay-rust on warm ink, matching the site palette) until a real icon is
 * supplied. Rerun after changing SIZES or the palette:
 *
 *   node scripts/generate-icons.mjs
 *
 * Writes public/icons/icon-512.png, icon-192.png and apple-touch-icon.png.
 * Pure Node, no dependencies (hand-rolled PNG writer over zlib).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'icons');

// House palette (style.css): warm ink background, clay-rust accent.
const BG = [0x1c, 0x18, 0x14];
const ACCENT = [0xbb, 0x5b, 0x33];
const ACCENT_HI = [0xd8, 0x8a, 0x64]; // lit side
const ACCENT_LO = [0x7e, 0x3c, 0x20]; // shade side

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Draw the mark: a shaded sphere centred on the ink field. */
function drawIcon(size) {
  const px = new Uint8Array(size * size * 3);
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34; // maskable-safe: well inside every platform crop
  // Light from the upper left, matching the viewer's key light.
  const lx = -0.55;
  const ly = -0.6;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - cx) / r;
      const dy = (y - cy) / r;
      const d = Math.hypot(dx, dy);
      let c = BG;
      if (d < 1.015) {
        // Sphere shading: diffuse-ish falloff toward the light direction.
        const t = Math.max(0, Math.min(1, 0.5 - (dx * lx + dy * ly) * 0.62));
        const body = [
          lerp(ACCENT_HI[0], ACCENT_LO[0], t),
          lerp(ACCENT_HI[1], ACCENT_LO[1], t),
          lerp(ACCENT_HI[2], ACCENT_LO[2], t),
        ];
        // Blend the raw accent in the midtones so the brand hue reads.
        const mid = 1 - Math.abs(t - 0.45) * 1.6;
        const shaded = body.map((v, i) => lerp(v, ACCENT[i], Math.max(0, mid) * 0.45));
        // Antialias the rim against the background.
        const cover = Math.max(0, Math.min(1, (1.015 - d) * r * 0.9));
        c = shaded.map((v, i) => lerp(BG[i], v, cover));
      }
      const o = (y * size + x) * 3;
      px[o] = c[0];
      px[o + 1] = c[1];
      px[o + 2] = c[2];
    }
  }
  return px;
}

// --- minimal PNG writer (truecolour, 8-bit) -------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, y * size * 3, size * 3).copy(raw, y * (size * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [size, name] of [
  [512, 'icon-512.png'],
  [192, 'icon-192.png'],
  [180, 'apple-touch-icon.png'],
]) {
  writeFileSync(join(OUT, name), png(size, drawIcon(size)));
  console.log(`  ${name} (${size}x${size})`);
}
