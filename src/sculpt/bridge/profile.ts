/**
 * Profile curves: the shape of a brush's falloff, drawn rather than dialled
 * (owner call, October 2026, replacing the brush alphas and the plateau,
 * profile and hardness sliders).
 *
 * A profile maps t, the distance from the dab centre as a fraction of the
 * radius (0 the centre, 1 the edge), to a weight in [0, 1]. It is held as
 * 2 to 16 control points {t, v}, sorted by t, the first at t = 0 and the
 * last at t = 1 (their v is free), and read through a monotone cubic
 * (Fritsch-Carlson): between two points the curve never rises above the
 * higher or dips below the lower, so it never leaves [0, 1].
 *
 * The brush loops never evaluate the spline. Each change bakes a 256-entry
 * table (LUT_SIZE) and a loop reads it with ProfileCurve.sample. A preset
 * may also carry an exact kernel: the closed form a brush used before the
 * curves (clay's plateau, crease's quartic^12, the paint's hardness). While
 * a curve's points are exactly that preset's, sample() calls the kernel, so
 * a brush on its default preset does what it did before to the last bit
 * (the parity fixtures prove it); the first edit makes it a plain curve.
 */

/** One control point: t across the radius, v the weight there. */
export interface ProfilePoint {
  t: number;
  v: number;
}

/** A closed-form falloff, t in [0, 1] to a weight in [0, 1]. */
export type ProfileKernel = (t: number) => number;

/** A named starting shape. */
export interface ProfilePreset {
  id: string;
  label: string;
  points: readonly ProfilePoint[];
  /** The exact shape the points sample, used while the curve is unedited. */
  kernel?: ProfileKernel;
}

/** The baked table's length: t = i / (LUT_SIZE - 1). */
export const LUT_SIZE = 256;
export const MIN_POINTS = 2;
export const MAX_POINTS = 16;
/** The closest two neighbouring points may sit, in t. */
export const MIN_GAP = 0.01;
/** The serialized form's version (SculptSettings.curvesRev). */
export const PROFILE_REV = 1;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Monotone cubic tangents (Fritsch-Carlson) for sorted points with strictly
 * increasing t.
 */
function tangents(p: readonly ProfilePoint[]): number[] {
  const n = p.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1].v - p[i].v) / (p[i + 1].t - p[i].t));
  const m: number[] = new Array(n).fill(0);
  if (n === 2) {
    m[0] = m[1] = d[0];
    return m;
  }
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    // A tangent against the secant's sign would overshoot: flatten it.
    if (a < 0) m[i] = 0;
    if (b < 0) m[i + 1] = 0;
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * d[i];
      m[i + 1] = tau * b * d[i];
    }
  }
  return m;
}

/** The monotone cubic through `points` at t (points as normalizePoints leaves them). */
export function evaluateProfile(points: readonly ProfilePoint[], t: number, m = tangents(points)): number {
  const n = points.length;
  if (t <= points[0].t) return clamp01(points[0].v);
  if (t >= points[n - 1].t) return clamp01(points[n - 1].v);
  let k = 0;
  while (k < n - 2 && t > points[k + 1].t) k++;
  const a = points[k];
  const b = points[k + 1];
  const h = b.t - a.t;
  const s = (t - a.t) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  const v = (2 * s3 - 3 * s2 + 1) * a.v + (s3 - 2 * s2 + s) * h * m[k] + (-2 * s3 + 3 * s2) * b.v + (s3 - s2) * h * m[k + 1];
  return clamp01(v);
}

/**
 * Points made valid: finite, clamped to [0, 1], sorted, the ends pinned to
 * t = 0 and t = 1, neighbours at least MIN_GAP apart (a closer one is
 * dropped), at most MAX_POINTS. Null when fewer than two survive.
 */
export function normalizePoints(input: readonly ProfilePoint[]): ProfilePoint[] | null {
  const pts = input
    .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v))
    .map((p) => ({ t: clamp01(p.t), v: clamp01(p.v) }))
    .sort((a, b) => a.t - b.t);
  if (pts.length < MIN_POINTS) return null;
  pts[0].t = 0;
  pts[pts.length - 1].t = 1;
  const out: ProfilePoint[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    if (pts[i].t - out[out.length - 1].t >= MIN_GAP && 1 - pts[i].t >= MIN_GAP) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  while (out.length > MAX_POINTS) out.splice(out.length - 2, 1);
  return out;
}

/** The stored form: [[t, v], ...]. */
export function serializeProfile(points: readonly ProfilePoint[]): [number, number][] {
  return points.map((p) => [p.t, p.v]);
}

/**
 * A stored curve read back: an array of 2 to 16 [t, v] pairs (or {t, v}
 * objects) of finite numbers. Anything else is null, and the caller keeps
 * its default; values are clamped and sorted by normalizePoints.
 */
export function parseProfile(data: unknown): ProfilePoint[] | null {
  if (!Array.isArray(data) || data.length < MIN_POINTS || data.length > MAX_POINTS) return null;
  const pts: ProfilePoint[] = [];
  for (const e of data) {
    let t: unknown;
    let v: unknown;
    if (Array.isArray(e) && e.length === 2) [t, v] = e;
    else if (e && typeof e === 'object') ({ t, v } = e as { t: unknown; v: unknown });
    if (typeof t !== 'number' || typeof v !== 'number' || !Number.isFinite(t) || !Number.isFinite(v)) return null;
    pts.push({ t, v });
  }
  return normalizePoints(pts);
}

const samePoints = (a: readonly ProfilePoint[], b: readonly ProfilePoint[]): boolean =>
  a.length === b.length && a.every((p, i) => p.t === b[i].t && p.v === b[i].v);

/**
 * One tool's profile: its points, the baked table, and the presets it
 * offers. Live edits go through setPoints; there is no undo (tool settings
 * are not in the scene's history, as with every other tool slider).
 */
export class ProfileCurve {
  private pts: ProfilePoint[];
  /** The baked table the brush loops read: LUT_SIZE weights from t = 0 to 1. */
  readonly lut = new Float64Array(LUT_SIZE);
  private kernel: ProfileKernel | null = null;
  /** The preset the points are exactly, or null once edited. */
  presetId: string | null = null;
  /** Bumps on every change (the editor redraws on it). */
  revision = 0;

  constructor(
    readonly presets: readonly ProfilePreset[],
    readonly defaultPreset: string,
  ) {
    const p = presets.find((x) => x.id === defaultPreset) ?? presets[0];
    this.pts = p.points.map((q) => ({ ...q }));
    this.bake();
  }

  get points(): readonly ProfilePoint[] {
    return this.pts;
  }

  /** Replace the points (normalized); false, and nothing changed, when they cannot make a curve. */
  setPoints(points: readonly ProfilePoint[]): boolean {
    const n = normalizePoints(points);
    if (!n) return false;
    this.pts = n;
    this.bake();
    return true;
  }

  applyPreset(id: string): boolean {
    const p = this.presets.find((x) => x.id === id);
    if (!p) return false;
    return this.setPoints(p.points);
  }

  reset(): void {
    this.applyPreset(this.defaultPreset);
  }

  isDefault(): boolean {
    return this.presetId === this.defaultPreset;
  }

  copyFrom(other: ProfileCurve): void {
    this.setPoints(other.points);
  }

  /** The curve itself at t: the preset's kernel while unedited, else the spline. */
  evaluate(t: number): number {
    const x = clamp01(t);
    return this.kernel ? this.kernel(x) : evaluateProfile(this.pts, x);
  }

  /**
   * What a brush loop reads per vertex: the exact kernel while the points
   * are a preset's that has one, else the baked table, interpolated.
   */
  sample(t: number): number {
    if (this.kernel) return this.kernel(t <= 0 ? 0 : t >= 1 ? 1 : t);
    const lut = this.lut;
    if (t <= 0) return lut[0];
    if (t >= 1) return lut[LUT_SIZE - 1];
    const x = t * (LUT_SIZE - 1);
    const i = x | 0;
    return lut[i] + (lut[i + 1] - lut[i]) * (x - i);
  }

  serialize(): [number, number][] {
    return serializeProfile(this.pts);
  }

  /** Restore a stored curve; false (the curve untouched) when it does not parse. */
  load(data: unknown): boolean {
    const pts = parseProfile(data);
    return pts ? this.setPoints(pts) : false;
  }

  private bake(): void {
    const preset = this.presets.find((p) => samePoints(p.points, this.pts));
    this.presetId = preset?.id ?? null;
    this.kernel = preset?.kernel ?? null;
    const m = tangents(this.pts);
    for (let i = 0; i < LUT_SIZE; i++) {
      const t = i / (LUT_SIZE - 1);
      this.lut[i] = this.kernel ? this.kernel(t) : evaluateProfile(this.pts, t, m);
    }
    this.revision++;
  }
}

// --- the shapes --------------------------------------------------------------

/**
 * Upstream SculptGL's falloff, 3d^4 - 4d^3 + 1, written exactly as the
 * vendored loops write it (the order of operations is part of parity).
 */
export function quartic(d: number): number {
  let f = d * d;
  f = 3.0 * f * f - 4.0 * f * d + 1.0;
  return f;
}

/** Full weight out to `p` of the radius, the quartic over what is left (clay's and polish's old plateau). */
export function plateau(p: number): ProfileKernel {
  return (d) => {
    if (d <= p) return 1.0;
    const t = (d - p) / (1.0 - p);
    return quartic(t);
  };
}

/** The vendored paint hardness, pow(1 - d, 2 (1 - hardness)). */
export function hardness(h: number): ProfileKernel {
  const softness = 2 * (1 - h);
  return (d) => Math.pow(1 - d, softness);
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/** A preset whose points sample `kernel` at `ts` (0 and 1 included), to four places. */
function sampled(id: string, label: string, ts: readonly number[], kernel: ProfileKernel, exact = true): ProfilePreset {
  const points = ts.map((t) => ({ t, v: round4(clamp01(kernel(t))) }));
  return { id, label, points, kernel: exact ? kernel : undefined };
}

const uniform = (n: number): number[] => Array.from({ length: n }, (_, i) => round4(i / (n - 1)));
/** A plateau's points: its two ends of full weight, then the tail. */
const plateauTs = (p: number): number[] => [0, p, ...Array.from({ length: 6 }, (_, k) => round4(p + ((1 - p) * (k + 1)) / 6))];
/** Close together near the rim, where a dome turns down steeply. */
const DOME_TS = [0, 0.2, 0.4, 0.55, 0.7, 0.8, 0.88, 0.94, 0.98, 1];
/** Close together near the centre, where a sharp crest falls. */
const SHARP_TS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.8, 1];

const dome: ProfileKernel = (d) => Math.sqrt(Math.max(0, 1 - d * d));

/** Clay strips. Plateau is the clay brush from before the curves (CLAY_PLATEAU 0.8). */
export const CLAY_PROFILES: readonly ProfilePreset[] = [
  sampled('plateau', 'Plateau', plateauTs(0.8), plateau(0.8)),
  sampled('soft', 'Soft', uniform(11), quartic),
  { id: 'flat', label: 'Flat', points: [{ t: 0, v: 1 }, { t: 1, v: 1 }], kernel: () => 1.0 },
  sampled('round', 'Round', DOME_TS, dome),
];

/** Crease's crest. Sharp is pow(quartic, 12), the crease from before (CREASE_PROFILE 12). */
export const CREASE_PROFILES: readonly ProfilePreset[] = [
  sampled('sharp', 'Sharp', SHARP_TS, (d) => Math.pow(quartic(d), 12)),
  sampled('medium', 'Medium', SHARP_TS, (d) => Math.pow(quartic(d), 5)),
  sampled('soft', 'Soft', uniform(11), quartic),
];

/** Polish. Default is the polish from before (POLISH_PLATEAU 0.35). */
export const POLISH_PROFILES: readonly ProfilePreset[] = [
  sampled('default', 'Default', plateauTs(0.35), plateau(0.35)),
  sampled('wide', 'Wide', plateauTs(0.65), plateau(0.65)),
  sampled('narrow', 'Narrow', uniform(11), (d) => quartic(d) * quartic(d)),
];

/** Paint (and its blur). Default is the vendored hardness 0.75. */
export const PAINT_PROFILES: readonly ProfilePreset[] = [
  sampled('hard', 'Hard', [0, 0.3, 0.6, 0.8, 0.9, 0.95, 0.98, 1], hardness(0.95)),
  sampled('default', 'Default', [0, 0.2, 0.4, 0.6, 0.75, 0.85, 0.92, 0.97, 1], hardness(0.75)),
  sampled('soft', 'Soft', [0, 1], hardness(0.5)),
  sampled('airbrush', 'Airbrush', uniform(11), (d) => Math.pow(1 - d, 3)),
];

/** A rake tine's cross-section, t across the tine from its middle (0) to its side (1). */
export const TINE_PROFILES: readonly ProfilePreset[] = [
  sampled('round', 'Round', DOME_TS, dome),
  { id: 'v', label: 'V', points: [{ t: 0, v: 1 }, { t: 1, v: 0 }], kernel: (d) => 1 - d },
  sampled('flat', 'Flat', plateauTs(0.7), plateau(0.7)),
  sampled('soft', 'Soft', uniform(11), quartic),
];
