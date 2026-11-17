/**
 * Photoshop's layer blend modes (CS6 list), as pure functions over RGB in
 * 0..1, with no knowledge of meshes, layers or the page. One module so the
 * Paint workspace, its tests and anything later that composites colours all
 * read the same arithmetic.
 *
 * Each function takes the colour BELOW (the backdrop, `b`) and the layer's
 * own colour (the source, `s`) and returns the blended colour before the
 * layer's alpha and opacity mix it in: `blend(mode, b, s)`. The mix is
 * `composite`: `result = below + (blend - below) * alpha * opacity`.
 *
 * The formulas are Adobe's (the PDF reference's separable and non-separable
 * modes, plus the ones Photoshop adds: Linear Burn, Darker/Lighter Color,
 * Vivid, Linear and Pin Light, Hard Mix, Subtract, Divide). They work on
 * the stored values as they stand (Photoshop's default, no gamma change),
 * which is why paint layers keep their colours sRGB-encoded.
 */

export type RGB = readonly [number, number, number];

/** Mode ids, as `src/ui/blendModes.ts` names them. */
export type BlendId =
  | 'normal'
  | 'dissolve'
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'linear-burn'
  | 'darker-color'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'linear-dodge'
  | 'lighter-color'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'hard-mix'
  | 'difference'
  | 'exclusion'
  | 'subtract'
  | 'divide'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// --- separable modes: one channel of backdrop `b` and source `s` ------------

type Channel = (b: number, s: number) => number;

const multiply: Channel = (b, s) => b * s;
const screen: Channel = (b, s) => b + s - b * s;
const hardLight: Channel = (b, s) => (s <= 0.5 ? multiply(b, 2 * s) : screen(b, 2 * s - 1));

const colorBurn: Channel = (b, s) => {
  if (b >= 1) return 1;
  if (s <= 0) return 0;
  return 1 - Math.min(1, (1 - b) / s);
};

const colorDodge: Channel = (b, s) => {
  if (b <= 0) return 0;
  if (s >= 1) return 1;
  return Math.min(1, b / (1 - s));
};

/** Photoshop's Soft Light: the PDF reference's, with its D(b) curve. */
const softLight: Channel = (b, s) => {
  if (s <= 0.5) return b - (1 - 2 * s) * b * (1 - b);
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  return b + (2 * s - 1) * (d - b);
};

const CHANNEL: Partial<Record<BlendId, Channel>> = {
  multiply,
  screen,
  darken: (b, s) => Math.min(b, s),
  lighten: (b, s) => Math.max(b, s),
  'color-burn': colorBurn,
  'color-dodge': colorDodge,
  'linear-burn': (b, s) => clamp01(b + s - 1),
  'linear-dodge': (b, s) => clamp01(b + s),
  overlay: (b, s) => hardLight(s, b),
  'hard-light': hardLight,
  'soft-light': softLight,
  'vivid-light': (b, s) => (s <= 0.5 ? colorBurn(b, 2 * s) : colorDodge(b, 2 * (s - 0.5))),
  'linear-light': (b, s) => clamp01(b + 2 * s - 1),
  'pin-light': (b, s) => (s < 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * (s - 0.5))),
  // Hard Mix: Vivid Light pushed to a threshold, which for a whole
  // layer reduces to b + s against 1 (what Photoshop's fill at 100% gives).
  'hard-mix': (b, s) => (b + s < 1 ? 0 : 1),
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
  subtract: (b, s) => clamp01(b - s),
  divide: (b, s) => (s <= 0 ? 1 : clamp01(b / s)),
};

// --- non-separable modes: the PDF reference's Lum, Sat, SetLum, SetSat ------

/** Luminosity, with Photoshop's weights. */
export const lum = (r: number, g: number, b: number): number => 0.3 * r + 0.59 * g + 0.11 * b;

const sat = (r: number, g: number, b: number): number => Math.max(r, g, b) - Math.min(r, g, b);

function clipColor(c: [number, number, number]): [number, number, number] {
  const l = lum(c[0], c[1], c[2]);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  if (n < 0) {
    const k = l - n;
    for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * l) / k;
  }
  if (x > 1) {
    const k = x - l;
    for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * (1 - l)) / k;
  }
  return c;
}

function setLum(r: number, g: number, b: number, l: number): [number, number, number] {
  const d = l - lum(r, g, b);
  return clipColor([r + d, g + d, b + d]);
}

function setSat(r: number, g: number, b: number, s: number): [number, number, number] {
  const c = [r, g, b];
  // Indices of the min, mid and max channel.
  let max = 0;
  let min = 0;
  for (let i = 1; i < 3; i++) {
    if (c[i] > c[max]) max = i;
    if (c[i] < c[min]) min = i;
  }
  if (max === min) return [0, 0, 0];
  const mid = 3 - max - min;
  const out: [number, number, number] = [0, 0, 0];
  if (c[max] > c[min]) {
    out[mid] = ((c[mid] - c[min]) * s) / (c[max] - c[min]);
    out[max] = s;
  }
  out[min] = 0;
  return out;
}

function nonSeparable(id: BlendId, b: RGB, s: RGB): [number, number, number] {
  switch (id) {
    case 'hue': {
      const t = setSat(s[0], s[1], s[2], sat(b[0], b[1], b[2]));
      return setLum(t[0], t[1], t[2], lum(b[0], b[1], b[2]));
    }
    case 'saturation': {
      const t = setSat(b[0], b[1], b[2], sat(s[0], s[1], s[2]));
      return setLum(t[0], t[1], t[2], lum(b[0], b[1], b[2]));
    }
    case 'color':
      return setLum(s[0], s[1], s[2], lum(b[0], b[1], b[2]));
    default:
      // luminosity
      return setLum(b[0], b[1], b[2], lum(s[0], s[1], s[2]));
  }
}

/**
 * The mode's blend of source `s` over backdrop `b`, before alpha. Darker and
 * Lighter Color pick the whole colour with the smaller or larger channel sum
 * (Photoshop compares "the total of all channel values"). Dissolve has no
 * colour arithmetic of its own: it shows the source (see `composite`), so it
 * returns it. An unknown id is Normal.
 */
export function blend(id: string, b: RGB, s: RGB): [number, number, number] {
  const f = CHANNEL[id as BlendId];
  if (f) return [f(b[0], s[0]), f(b[1], s[1]), f(b[2], s[2])];
  switch (id) {
    case 'darker-color':
      return b[0] + b[1] + b[2] <= s[0] + s[1] + s[2] ? [b[0], b[1], b[2]] : [s[0], s[1], s[2]];
    case 'lighter-color':
      return b[0] + b[1] + b[2] >= s[0] + s[1] + s[2] ? [b[0], b[1], b[2]] : [s[0], s[1], s[2]];
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      return nonSeparable(id, b, s);
    default:
      return [s[0], s[1], s[2]];
  }
}

/**
 * A fixed pseudo-random number in [0, 1) for a vertex, so Dissolve picks the
 * same vertices on every redraw (a hash of the index, not a random call).
 */
export function dissolveThreshold(index: number): number {
  let h = (index | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * One layer over the colour below it: the mode's blend mixed in by the
 * layer's alpha times its opacity. Dissolve shows the layer's own colour
 * where `threshold` is under that coverage and the colour below elsewhere,
 * so a half-covered area is half scattered dots, not half grey.
 */
export function composite(
  id: string,
  below: RGB,
  rgb: RGB,
  alpha: number,
  opacity: number,
  threshold = 0,
  out: [number, number, number] = [0, 0, 0],
): [number, number, number] {
  const k = clamp01(alpha * opacity);
  if (k <= 0) {
    out[0] = below[0];
    out[1] = below[1];
    out[2] = below[2];
    return out;
  }
  if (id === 'dissolve') {
    const on = threshold < k;
    const c = on ? rgb : below;
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
    return out;
  }
  const m = blend(id, below, rgb);
  out[0] = below[0] + (m[0] - below[0]) * k;
  out[1] = below[1] + (m[1] - below[1]) * k;
  out[2] = below[2] + (m[2] - below[2]) * k;
  return out;
}

// --- sRGB encoding -----------------------------------------------------------

/** Linear light to the sRGB encoding the layers keep their colours in. */
export function encodeSrgb(v: number): number {
  const c = clamp01(v);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** The sRGB encoding back to linear light, the mesh's own colour space. */
export function decodeSrgb(v: number): number {
  const c = clamp01(v);
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** A byte's linear value, tabulated (a layer's bytes are sRGB). */
export const BYTE_TO_LINEAR: Float32Array = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = decodeSrgb(i / 255);
  return t;
})();

/** The id of every mode, in Photoshop's order (the same list as ui/blendModes.ts, which carries the labels). */
export const BLEND_IDS: readonly BlendId[] = [
  'normal',
  'dissolve',
  'darken',
  'multiply',
  'color-burn',
  'linear-burn',
  'darker-color',
  'lighten',
  'screen',
  'color-dodge',
  'linear-dodge',
  'lighter-color',
  'overlay',
  'soft-light',
  'hard-light',
  'vivid-light',
  'linear-light',
  'pin-light',
  'hard-mix',
  'difference',
  'exclusion',
  'subtract',
  'divide',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

export const isBlendId = (v: unknown): v is BlendId => typeof v === 'string' && (BLEND_IDS as readonly string[]).includes(v);
