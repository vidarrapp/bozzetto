/**
 * Generate the web-app icons from the Flaticon "sculpture" glyph
 * (scripts/icons/sculpture.svg), in the house palette:
 *
 *   node scripts/generate-icons.mjs           # write the icons
 *   node scripts/generate-icons.mjs --sheet   # every treatment side by side
 *
 * Writes public/icons/icon-512.png, icon-192.png, apple-touch-icon.png and
 * icon.svg. Change VARIANT below to pick a different treatment.
 *
 * Pure Node, no dependencies: a small SVG path reader, a scanline filler and
 * a hand-rolled PNG writer. The glyph is the single source for both the
 * rasters and the SVG, so they cannot drift.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Which treatment ships. See VARIANTS below for the others. */
const VARIANT = 'tile';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'icons');
const GLYPH = join(__dirname, 'icons', 'sculpture.svg');

// --- SVG path -> polygons -------------------------------------------------

/**
 * Flatten one path's `d` into closed polygons (one per subpath), in the
 * path's own user units. Arcs are not supported; no uicons glyph uses them.
 */
function parsePath(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const subpaths = [];
  let pts = null;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  // Last cubic/quadratic control point, for the smooth (S/T) reflections.
  let cx2 = 0;
  let cy2 = 0;
  let i = 0;
  const num = () => Number(tokens[i++]);
  const close = () => {
    if (pts && pts.length > 2) subpaths.push(pts);
    pts = null;
  };
  const move = (nx, ny) => {
    close();
    pts = [[nx, ny]];
    x = sx = nx;
    y = sy = ny;
  };
  const line = (nx, ny) => {
    pts?.push([nx, ny]);
    x = nx;
    y = ny;
  };
  const cubic = (x1, y1, x2, y2, nx, ny, steps = 24) => {
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      pts?.push([
        u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * nx,
        u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ny,
      ]);
    }
    cx2 = x2;
    cy2 = y2;
    x = nx;
    y = ny;
  };

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    // A repeated coordinate set continues the last command; after M/m it
    // continues as a line, which is what the SVG spec says.
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        move(ox + num(), oy + num());
        break;
      case 'L':
        line(ox + num(), oy + num());
        break;
      case 'H':
        line(ox + num(), y);
        break;
      case 'V':
        line(x, oy + num());
        break;
      case 'C': {
        const x1 = ox + num();
        const y1 = oy + num();
        const x2 = ox + num();
        const y2 = oy + num();
        cubic(x1, y1, x2, y2, ox + num(), oy + num());
        break;
      }
      case 'S': {
        // Reflect the previous control point through the current point.
        const x1 = 2 * x - cx2;
        const y1 = 2 * y - cy2;
        const x2 = ox + num();
        const y2 = oy + num();
        cubic(x1, y1, x2, y2, ox + num(), oy + num());
        break;
      }
      case 'Q': {
        const qx = ox + num();
        const qy = oy + num();
        const nx = ox + num();
        const ny = oy + num();
        // Quadratic as a cubic, so one curve routine serves both.
        cubic(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny);
        cx2 = qx;
        cy2 = qy;
        break;
      }
      case 'T': {
        const qx = 2 * x - cx2;
        const qy = 2 * y - cy2;
        const nx = ox + num();
        const ny = oy + num();
        cubic(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), nx + (2 / 3) * (qx - nx), ny + (2 / 3) * (qy - ny), nx, ny);
        cx2 = qx;
        cy2 = qy;
        break;
      }
      case 'Z':
        close();
        x = sx;
        y = sy;
        break;
      case 'A':
        throw new Error('elliptical arcs are not supported in the icon glyph');
      default:
        throw new Error(`unknown path command "${cmd}"`);
    }
  }
  close();
  return subpaths;
}

/** Read the glyph: every path in the file, normalised to a 0..1 square. */
function readGlyph(file) {
  const svg = readFileSync(file, 'utf8');
  const box = /viewBox\s*=\s*"([^"]+)"/.exec(svg);
  const [, , vw, vh] = box ? box[1].trim().split(/[\s,]+/).map(Number) : [0, 0, 24, 24];
  const span = Math.max(vw, vh);
  const polys = [];
  for (const m of svg.matchAll(/<path[^>]*\sd\s*=\s*"([^"]+)"/g)) {
    for (const sub of parsePath(m[1])) polys.push(sub.map(([x, y]) => [x / span, y / span]));
  }
  if (polys.length === 0) throw new Error(`no <path d="..."> in ${file}`);
  return { polys, span };
}

// --- geometry helpers -----------------------------------------------------

const TAU = Math.PI * 2;

function bounds(polys) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of polys)
    for (const [x, y] of p) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return { x0, y0, x1, y1 };
}

/** Scale a shape to `h` of the unit square, centred on (cx, cy). */
function fit(polys, h, cx = 0.5, cy = 0.5) {
  const b = bounds(polys);
  const s = h / (b.y1 - b.y0);
  const mx = (b.x0 + b.x1) / 2;
  const my = (b.y0 + b.y1) / 2;
  return polys.map((p) => p.map(([x, y]) => [cx + (x - mx) * s, cy + (y - my) * s]));
}

function circle(cx, cy, r, k = 192) {
  const p = [];
  for (let i = 0; i < k; i++) p.push([cx + r * Math.cos((i / k) * TAU), cy + r * Math.sin((i / k) * TAU)]);
  return [p];
}

/** An elliptical ring: outer loop out, inner loop back, so nonzero hollows it. */
function ring(cx, cy, rx, ry, w, k = 128) {
  const outer = [];
  const inner = [];
  for (let i = 0; i <= k; i++) {
    const a = (i / k) * TAU;
    outer.push([cx + (rx + w / 2) * Math.cos(a), cy + (ry + w / 2) * Math.sin(a)]);
    inner.unshift([cx + (rx - w / 2) * Math.cos(a), cy + (ry - w / 2) * Math.sin(a)]);
  }
  return [outer, inner];
}

// --- rasteriser: nonzero winding, 4 sub-rows per pixel --------------------

function signedArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function addSpan(cov, row, xa, xb, amt, size) {
  const a = Math.max(0, xa);
  const b = Math.min(size, xb);
  if (b <= a) return;
  const i0 = Math.floor(a);
  const i1 = Math.min(Math.floor(b), size - 1);
  if (i0 === i1) {
    cov[row + i0] += (b - a) * amt;
    return;
  }
  cov[row + i0] += (i0 + 1 - a) * amt;
  for (let i = i0 + 1; i < i1; i++) cov[row + i] += amt;
  cov[row + i1] += (b - i1) * amt;
}

/**
 * Coverage mask for a list of shapes, each a list of subpath polygons.
 * Nonzero winding unions overlapping shapes only when they wind the same
 * way, so each shape is flipped as a unit to a positive total area - as a
 * unit, or a glyph's holes would fill in.
 */
function coverage(shapes, size, SS = 4) {
  const cov = new Float32Array(size * size);
  const edges = [];
  for (const shape of shapes) {
    const flip = shape.reduce((a, p) => a + signedArea(p), 0) < 0;
    for (const raw of shape) {
      const p = flip ? [...raw].reverse() : raw;
      for (let i = 0; i < p.length; i++) {
        const [x0, y0] = p[i];
        const [x1, y1] = p[(i + 1) % p.length];
        if (y0 !== y1) edges.push([x0 * size, y0 * size, x1 * size, y1 * size]);
      }
    }
  }
  const xs = [];
  for (let py = 0; py < size; py++) {
    for (let s = 0; s < SS; s++) {
      const y = py + (s + 0.5) / SS;
      xs.length = 0;
      for (const [x0, y0, x1, y1] of edges) {
        if ((y >= y0 && y < y1) || (y >= y1 && y < y0)) {
          xs.push([x0 + ((x1 - x0) * (y - y0)) / (y1 - y0), y1 > y0 ? 1 : -1]);
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let w = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        w += xs[i][1];
        if (w !== 0) addSpan(cov, py * size, xs[i][0], xs[i + 1][0], 1 / SS, size);
      }
    }
  }
  for (let i = 0; i < cov.length; i++) cov[i] = Math.min(1, cov[i]);
  return cov;
}

// --- palette (style.css) --------------------------------------------------

const INK = [0x1c, 0x18, 0x14];
const PAPER = [0xf1, 0xeb, 0xe1];
const CLAY_HI = [0xd8, 0x8a, 0x64];
const CLAY_LO = [0x76, 0x37, 0x1d];
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** Clay lit from the upper left, the way the viewer's key light sits. */
const clayAt = (u, v) => mix(CLAY_HI, CLAY_LO, Math.max(0, Math.min(1, u * 0.4 + v * 0.6)));

function canvas(size, bg) {
  const px = new Float32Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    const c = typeof bg === 'function' ? bg((i % size) / size, Math.floor(i / size) / size) : bg;
    px[i * 3] = c[0];
    px[i * 3 + 1] = c[1];
    px[i * 3 + 2] = c[2];
  }
  return px;
}

function paint(px, cov, size, colour) {
  for (let i = 0; i < size * size; i++) {
    const a = cov[i];
    if (a <= 0) continue;
    const c = typeof colour === 'function' ? colour((i % size) / size, Math.floor(i / size) / size) : colour;
    for (let k = 0; k < 3; k++) px[i * 3 + k] = lerp(px[i * 3 + k], c[k], a);
  }
}

// --- treatments -----------------------------------------------------------

/**
 * Each entry says how big the glyph sits, what carries it and what it is
 * drawn in. `height` is the glyph's share of the icon: the full-bleed
 * treatments stay inside the 80% circle every maskable crop keeps.
 */
const VARIANTS = {
  /** 1. Clay glyph on the house ink. */
  relief: { height: 0.66, ground: INK, mark: clayAt },
  /** 2. Full-bleed clay, glyph knocked out. Loudest at 32px, safest masked. */
  tile: { height: 0.58, ground: clayAt, mark: INK },
  /** 3. The ink-on-cream half of the Ink/Paper toggle. */
  paper: { height: 0.66, ground: PAPER, mark: INK },
  /** 4. Today's clay sphere, with the glyph cut out of it. */
  sphere: { height: 0.42, ground: INK, mark: INK, disc: 0.375 },
  /** 5. The glyph on the turntable it is sculpted on. */
  studio: { height: 0.60, cy: 0.455, ground: INK, mark: clayAt, turntable: true },
};

function drawIcon(glyph, name, size) {
  const v = VARIANTS[name];
  if (!v) throw new Error(`unknown variant "${name}"`);
  const px = canvas(size, v.ground);
  if (v.disc) paint(px, coverage([circle(0.5, 0.5, v.disc)], size), size, clayAt);
  if (v.turntable) {
    // Drawn first, so the plinth covers the near half and it reads as depth.
    paint(px, coverage([ring(0.5, 0.775, 0.325, 0.085, 0.020)], size), size, mix(INK, PAPER, 0.3));
  }
  paint(px, coverage([fit(glyph.polys, v.height, 0.5, v.cy ?? 0.5)], size), size, v.mark);
  return px;
}

// --- SVG output -----------------------------------------------------------

const hex = (c) => '#' + c.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');

/** The same treatment as an SVG, for the favicon (and any crisp use). */
function drawSvg(glyph, name, file) {
  const v = VARIANTS[name];
  const S = 512;
  const b = bounds(glyph.polys);
  const k = (v.height * S) / (b.y1 - b.y0);
  const tx = 0.5 * S - k * ((b.x0 + b.x1) / 2);
  const ty = (v.cy ?? 0.5) * S - k * ((b.y0 + b.y1) / 2);
  const grad = `<linearGradient id="clay" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${hex(CLAY_HI)}"/><stop offset="1" stop-color="${hex(CLAY_LO)}"/>
  </linearGradient>`;
  const paintOf = (c) => (typeof c === 'function' ? 'url(#clay)' : hex(c));
  const d = readFileSync(file, 'utf8').match(/<path[^>]*\sd\s*=\s*"([^"]+)"/g) ?? [];
  const paths = d
    .map((tag) => /\sd\s*=\s*"([^"]+)"/.exec(tag)[1])
    .map((dd) => `<path d="${dd}" fill="${paintOf(v.mark)}"/>`)
    .join('');
  const disc = v.disc
    ? `<circle cx="${S / 2}" cy="${S / 2}" r="${v.disc * S}" fill="url(#clay)"/>`
    : '';
  const turntable = v.turntable
    ? `<ellipse cx="${S / 2}" cy="${0.775 * S}" rx="${0.325 * S}" ry="${0.085 * S}" fill="none"
        stroke="${hex(mix(INK, PAPER, 0.3))}" stroke-width="${0.02 * S}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
  <defs>${grad}</defs>
  <rect width="${S}" height="${S}" fill="${paintOf(v.ground)}"/>
  ${disc}${turntable}
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${(k / glyph.span).toFixed(5)})">${paths}</g>
</svg>
`;
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

function png(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1) + 1; // filter byte 0 = none
    for (let x = 0; x < w * 3; x++) {
      raw[o + x] = Math.max(0, Math.min(255, Math.round(px[y * w * 3 + x])));
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- main -----------------------------------------------------------------

const glyph = readGlyph(GLYPH);

if (process.argv.includes('--sheet')) {
  // Every treatment at three sizes, so the small read can be compared.
  const names = Object.keys(VARIANTS);
  const PAD = 26;
  const BIG = 300;
  const MID = 128;
  const SM = 48;
  const LBL = 34;
  const W = PAD + names.length * (BIG + PAD);
  const H = PAD + LBL + BIG + PAD + MID + PAD;
  const px = new Float32Array(W * H * 3).fill(0x26);
  const blit = (src, s, dx, dy) => {
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        const o = ((dy + y) * W + dx + x) * 3;
        const i = (y * s + x) * 3;
        px[o] = src[i];
        px[o + 1] = src[i + 1];
        px[o + 2] = src[i + 2];
      }
  };
  const DIGITS = {
    1: ['.#.', '##.', '.#.', '.#.', '###'],
    2: ['###', '..#', '###', '#..', '###'],
    3: ['###', '..#', '###', '..#', '###'],
    4: ['#.#', '#.#', '###', '..#', '..#'],
    5: ['###', '#..', '###', '..#', '###'],
  };
  const digit = (n, dx, dy, s = 5) =>
    DIGITS[n].forEach((row, ry) =>
      [...row].forEach((c, rx) => {
        if (c !== '#') return;
        for (let y = 0; y < s; y++)
          for (let x = 0; x < s; x++) {
            const o = ((dy + ry * s + y) * W + dx + rx * s + x) * 3;
            px[o] = px[o + 1] = px[o + 2] = 0xd8;
          }
      }),
    );
  names.forEach((name, k) => {
    const x = PAD + k * (BIG + PAD);
    digit(k + 1, x, PAD);
    blit(drawIcon(glyph, name, BIG), BIG, x, PAD + LBL);
    blit(drawIcon(glyph, name, MID), MID, x, PAD + LBL + BIG + PAD);
    blit(drawIcon(glyph, name, SM), SM, x + MID + 20, PAD + LBL + BIG + PAD + (MID - SM) / 2);
  });
  writeFileSync(join(OUT, 'sheet.png'), png(W, H, px));
  console.log(`  sheet.png  (${names.map((n, i) => `${i + 1}=${n}`).join('  ')})`);
} else {
  mkdirSync(OUT, { recursive: true });
  for (const [size, name] of [
    [512, 'icon-512.png'],
    [192, 'icon-192.png'],
    [180, 'apple-touch-icon.png'],
  ]) {
    writeFileSync(join(OUT, name), png(size, size, drawIcon(glyph, VARIANT, size)));
    console.log(`  ${name} (${size}x${size})`);
  }
  writeFileSync(join(OUT, 'icon.svg'), drawSvg(glyph, VARIANT, GLYPH));
  console.log('  icon.svg');
}
