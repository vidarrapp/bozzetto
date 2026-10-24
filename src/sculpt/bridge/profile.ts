/**
 * Profile curves: the shape of a brush's falloff, drawn rather than dialled
 * (owner call, October 2026, replacing the brush alphas and the plateau,
 * profile and hardness sliders; Bezier anchors and handles since the
 * owner's feedback the day after, which found the sampled point lists too
 * many points to edit).
 *
 * A profile maps t, the distance from the dab centre as a fraction of the
 * radius (0 the centre, 1 the edge), to a weight in [0, 1]. It is held as
 * 2 to 8 anchors {t, v}, sorted by t, the first at t = 0 and the last at
 * t = 1 (their v is free), each with an in and an out handle (the first
 * anchor has only its out handle, the last only its in handle). Between
 * two anchors the curve is the cubic Bezier from one anchor through its
 * out handle and the next one's in handle to the next anchor.
 *
 * The curve stays a function of t: every handle's t is kept within its
 * segment (between the two anchors' t), which keeps x(s) monotone on each
 * segment, and a weight is read by solving x(s) = t (Newton, with
 * bisection when a step leaves the bracket) and clamping y(s) to [0, 1].
 * A handle's v may leave [0, 1] (HANDLE_V_MIN..HANDLE_V_MAX); the weight
 * never does.
 *
 * An anchor is smooth by default: its two handles are aligned (on one line
 * through the anchor, opposite ways), and moving one turns the other with
 * it, keeping that one's length. A corner anchor's handles are free.
 *
 * The brush loops never evaluate the Bezier. Each change bakes a 256-entry
 * table (LUT_SIZE) and a loop reads it with ProfileCurve.sample. A preset
 * may also carry an exact kernel: the closed form a brush used before the
 * curves (clay's plateau, crease's quartic^12, the paint's hardness). The
 * kernel is the truth and the preset's anchors are how it is drawn and
 * where an edit starts: while a curve's anchors are exactly that preset's,
 * sample() calls the kernel, so a brush on its default preset does what it
 * did before to the last bit (the parity fixtures prove it); the first
 * edit makes it a plain curve, read from the table.
 */

/** A point on the plot: t across the radius, v the weight there. */
export interface ProfilePoint {
  t: number;
  v: number;
}

/**
 * One anchor of the curve and its handles, as absolute plot points. `in`
 * is null on the first anchor and `out` on the last (the outer side of an
 * end has no handle). `corner` frees the two handles from each other.
 */
export interface ProfileAnchor {
  t: number;
  v: number;
  in: ProfilePoint | null;
  out: ProfilePoint | null;
  corner: boolean;
}

/** A closed-form falloff, t in [0, 1] to a weight in [0, 1]. */
export type ProfileKernel = (t: number) => number;

/** A named starting shape. */
export interface ProfilePreset {
  id: string;
  label: string;
  anchors: readonly ProfileAnchor[];
  /** The exact shape the anchors draw, used while the curve is unedited. */
  kernel?: ProfileKernel;
  /** The preset's points in the curvesRev 1 form, to recognise an old record of it. */
  legacy?: readonly ProfilePoint[];
}

/** One anchor in the stored form (curvesRev 2); see StoredCurve. */
export interface StoredAnchor {
  t: number;
  v: number;
  in?: [number, number];
  out?: [number, number];
  corner?: true;
}

/** The stored form (curvesRev 2): `{ anchors: [{ t, v, in: [t, v], out: [t, v], corner }] }`. */
export interface StoredCurve {
  anchors: StoredAnchor[];
}

/** The baked table's length: t = i / (LUT_SIZE - 1). */
export const LUT_SIZE = 256;
export const MIN_ANCHORS = 2;
export const MAX_ANCHORS = 8;
/** The closest two neighbouring anchors may sit, in t. */
export const MIN_GAP = 0.01;
/** How far a handle's v may go past the plot (the weight is clamped, the handle is not). */
export const HANDLE_V_MIN = -0.5;
export const HANDLE_V_MAX = 1.5;
/** The serialized form's version (SculptSettings.curvesRev): 1 the point lists, 2 the Bezier anchors. */
export const PROFILE_REV = 2;
/** A curvesRev 1 point list converts to at most this many anchors. */
export const V1_MAX_ANCHORS = 6;
/** The curvesRev 1 limits. */
const V1_MAX_POINTS = 16;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

// --- the Bezier ----------------------------------------------------------------

/**
 * A handle kept where it may be: its t within [lo, hi] (its segment) and
 * its v within the handle range, by shortening it toward its anchor `a`,
 * so its direction (and with it a smooth anchor's alignment) is kept. A
 * handle pointing out of its segment's side is first made vertical. One
 * already in place comes back as it was, to the bit.
 */
export function fitHandle(a: ProfilePoint, h: ProfilePoint, lo: number, hi: number): ProfilePoint {
  let dt = h.t - a.t;
  let dv = h.v - a.v;
  if (!Number.isFinite(dt) || !Number.isFinite(dv)) return { t: a.t, v: a.v };
  if ((dt < 0 && a.t + dt < lo && lo >= a.t) || (dt > 0 && a.t + dt > hi && hi <= a.t)) dt = 0;
  let k = 1;
  if (a.t + dt > hi) k = Math.min(k, (hi - a.t) / dt);
  if (a.t + dt < lo) k = Math.min(k, (lo - a.t) / dt);
  if (a.v + dv > HANDLE_V_MAX) k = Math.min(k, (HANDLE_V_MAX - a.v) / dv);
  if (a.v + dv < HANDLE_V_MIN) k = Math.min(k, (HANDLE_V_MIN - a.v) / dv);
  if (k >= 1 && dt === h.t - a.t) return { t: h.t, v: h.v };
  k = Math.max(0, k);
  dt *= k;
  dv *= k;
  return { t: clamp(a.t + dt, lo, hi), v: clamp(a.v + dv, HANDLE_V_MIN, HANDLE_V_MAX) };
}

/** Handles for anchor i of `a` from a slope, each a third of its segment long. */
function smoothHandles(a: ProfileAnchor[], i: number, slope: number): void {
  const p = a[i];
  if (i > 0) {
    const dt = (p.t - a[i - 1].t) / 3;
    p.in = { t: p.t - dt, v: p.v - slope * dt };
  }
  if (i < a.length - 1) {
    const dt = (a[i + 1].t - p.t) / 3;
    p.out = { t: p.t + dt, v: p.v + slope * dt };
  }
}

/** The slope through anchor i's neighbours (an end: toward its one neighbour). */
function neighbourSlope(a: readonly ProfileAnchor[], i: number): number {
  const l = a[Math.max(0, i - 1)];
  const r = a[Math.min(a.length - 1, i + 1)];
  return r.t > l.t ? (r.v - l.v) / (r.t - l.t) : 0;
}

/**
 * Anchors made valid: finite, t and v clamped to [0, 1], sorted, the ends
 * pinned to t = 0 and t = 1, neighbours at least MIN_GAP apart (a closer
 * one is dropped), at most MAX_ANCHORS (interior ones dropped from the
 * edge end), every handle within its segment (fitHandle) and the outer
 * sides of the ends without one. A missing interior handle is made smooth
 * from the neighbours. Null when fewer than two anchors survive.
 */
export function normalizeAnchors(input: readonly Partial<ProfileAnchor>[], maxAnchors = MAX_ANCHORS): ProfileAnchor[] | null {
  const okPt = (p: unknown): p is ProfilePoint =>
    !!p && typeof p === 'object' && Number.isFinite((p as ProfilePoint).t) && Number.isFinite((p as ProfilePoint).v);
  const a: ProfileAnchor[] = input
    .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v))
    .map((p) => ({
      t: clamp01(p.t as number),
      v: clamp01(p.v as number),
      in: okPt(p.in) ? { t: p.in.t, v: p.in.v } : null,
      out: okPt(p.out) ? { t: p.out.t, v: p.out.v } : null,
      corner: p.corner === true,
    }))
    .sort((x, y) => x.t - y.t);
  if (a.length < MIN_ANCHORS) return null;
  a[0].t = 0;
  a[a.length - 1].t = 1;
  const out: ProfileAnchor[] = [a[0]];
  for (let i = 1; i < a.length - 1; i++) {
    if (a[i].t - out[out.length - 1].t >= MIN_GAP && 1 - a[i].t >= MIN_GAP) out.push(a[i]);
  }
  out.push(a[a.length - 1]);
  while (out.length > maxAnchors) out.splice(out.length - 2, 1);
  const n = out.length;
  out[0].in = null;
  out[0].corner = false;
  out[n - 1].out = null;
  out[n - 1].corner = false;
  for (let i = 0; i < n; i++) {
    const p = out[i];
    if ((i > 0 && !p.in) || (i < n - 1 && !p.out)) {
      const keepIn = p.in;
      const keepOut = p.out;
      smoothHandles(out, i, neighbourSlope(out, i));
      if (keepIn) p.in = keepIn;
      if (keepOut) p.out = keepOut;
    }
    if (p.in) p.in = fitHandle(p, p.in, out[i - 1].t, p.t);
    if (p.out) p.out = fitHandle(p, p.out, p.t, out[i + 1].t);
  }
  return out;
}

/** One segment's control points, x and y. */
interface Segment {
  x0: number;
  x1: number;
  x2: number;
  x3: number;
  y0: number;
  y1: number;
  y2: number;
  y3: number;
}

const segmentOf = (a: ProfileAnchor, b: ProfileAnchor): Segment => ({
  x0: a.t,
  x1: (a.out ?? a).t,
  x2: (b.in ?? b).t,
  x3: b.t,
  y0: a.v,
  y1: (a.out ?? a).v,
  y2: (b.in ?? b).v,
  y3: b.v,
});

const bez = (p0: number, p1: number, p2: number, p3: number, s: number): number => {
  const u = 1 - s;
  return u * u * u * p0 + 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s * p3;
};
const bezD = (p0: number, p1: number, p2: number, p3: number, s: number): number => {
  const u = 1 - s;
  return 3 * (u * u * (p1 - p0) + 2 * u * s * (p2 - p1) + s * s * (p3 - p2));
};

/** The segment's parameter s where x(s) = t: Newton, bisection when a step leaves the bracket. */
function solveS(g: Segment, t: number): number {
  const w = g.x3 - g.x0;
  if (!(w > 0)) return 0;
  let lo = 0;
  let hi = 1;
  let s = clamp01((t - g.x0) / w);
  for (let it = 0; it < 60; it++) {
    const f = bez(g.x0, g.x1, g.x2, g.x3, s) - t;
    if (Math.abs(f) < 1e-14) break;
    if (f > 0) hi = s;
    else lo = s;
    if (hi - lo < 1e-15) break;
    const d = bezD(g.x0, g.x1, g.x2, g.x3, s);
    let next = d > 0 ? s - f / d : NaN;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    s = next;
  }
  return s;
}

/** The Bezier at t, unclamped (anchors as normalizeAnchors leaves them). */
function bezierRaw(a: readonly ProfileAnchor[], t: number): number {
  const n = a.length;
  if (t <= 0) return a[0].v;
  if (t >= 1) return a[n - 1].v;
  let k = 0;
  while (k < n - 2 && t > a[k + 1].t) k++;
  const g = segmentOf(a[k], a[k + 1]);
  return bez(g.y0, g.y1, g.y2, g.y3, solveS(g, t));
}

/** The Bezier at t, clamped to [0, 1]: the weight the curve gives there. */
export function evaluateBezier(a: readonly ProfileAnchor[], t: number): number {
  return clamp01(bezierRaw(a, clamp01(t)));
}

/** The curve's slope at t, from the Bezier itself (unclamped). */
function slopeAt(a: readonly ProfileAnchor[], t: number): number {
  const e = 1e-4;
  const l = Math.max(0, t - e);
  const r = Math.min(1, t + e);
  return (bezierRaw(a, r) - bezierRaw(a, l)) / (r - l);
}

/**
 * Points along the drawn curve, segment by segment in s (so a steep part
 * is drawn as finely as a flat one), v clamped as the weight is.
 */
export function bezierPolyline(a: readonly ProfileAnchor[], perSegment = 24): ProfilePoint[] {
  const out: ProfilePoint[] = [{ t: a[0].t, v: clamp01(a[0].v) }];
  for (let k = 0; k < a.length - 1; k++) {
    const g = segmentOf(a[k], a[k + 1]);
    for (let i = 1; i <= perSegment; i++) {
      const s = i / perSegment;
      out.push({ t: bez(g.x0, g.x1, g.x2, g.x3, s), v: clamp01(bez(g.y0, g.y1, g.y2, g.y3, s)) });
    }
  }
  return out;
}

// --- edits (the editor's, pure: each returns new anchors or null) --------------

const copyAnchors = (a: readonly ProfileAnchor[]): ProfileAnchor[] =>
  a.map((p) => ({ t: p.t, v: p.v, in: p.in && { ...p.in }, out: p.out && { ...p.out }, corner: p.corner }));

/**
 * Anchor i moved toward `want`: an end up and down only, an interior one
 * between its neighbours; its handles go with it, and every handle is then
 * kept within its segment.
 */
export function moveAnchor(anchors: readonly ProfileAnchor[], i: number, want: ProfilePoint): ProfileAnchor[] | null {
  const a = copyAnchors(anchors);
  const n = a.length;
  const p = a[i];
  if (!p) return null;
  const v = clamp01(want.v);
  const t = i === 0 ? 0 : i === n - 1 ? 1 : clamp(want.t, a[i - 1].t + MIN_GAP, a[i + 1].t - MIN_GAP);
  const dt = t - p.t;
  const dv = v - p.v;
  p.t = t;
  p.v = v;
  if (p.in) p.in = { t: p.in.t + dt, v: p.in.v + dv };
  if (p.out) p.out = { t: p.out.t + dt, v: p.out.v + dv };
  return normalizeAnchors(a);
}

/**
 * Anchor i's `side` handle moved toward `want`. On a smooth anchor the
 * other handle turns to stay opposite it, keeping its own length.
 */
export function moveHandle(anchors: readonly ProfileAnchor[], i: number, side: 'in' | 'out', want: ProfilePoint): ProfileAnchor[] | null {
  const a = copyAnchors(anchors);
  const n = a.length;
  const p = a[i];
  if (!p || (side === 'in' ? i === 0 : i === n - 1)) return null;
  const lo = side === 'in' ? a[i - 1].t : p.t;
  const hi = side === 'in' ? p.t : a[i + 1].t;
  // The handle stays on its own side of the anchor.
  const h = fitHandle(p, { t: side === 'in' ? Math.min(want.t, p.t) : Math.max(want.t, p.t), v: want.v }, lo, hi);
  p[side] = h;
  const other = side === 'in' ? 'out' : 'in';
  const twin = p[other];
  if (!p.corner && twin) {
    const dx = h.t - p.t;
    const dy = h.v - p.v;
    const len = Math.hypot(dx, dy);
    if (len > 1e-9) {
      const tl = Math.hypot(twin.t - p.t, twin.v - p.v);
      const olo = other === 'in' ? a[i - 1].t : p.t;
      const ohi = other === 'in' ? p.t : a[i + 1].t;
      p[other] = fitHandle(p, { t: p.t - (dx / len) * tl, v: p.v - (dy / len) * tl }, olo, ohi);
    }
  }
  return normalizeAnchors(a);
}

/**
 * A new anchor at (t, v), smooth: its tangent the curve's slope there, each
 * handle a third of its segment. Null when it would crowd a neighbour or
 * the curve is full.
 */
export function insertAnchor(anchors: readonly ProfileAnchor[], at: ProfilePoint): ProfileAnchor[] | null {
  if (anchors.length >= MAX_ANCHORS) return null;
  const t = clamp01(at.t);
  if (anchors.some((p) => Math.abs(p.t - t) < MIN_GAP)) return null;
  const a = copyAnchors(anchors);
  const slope = slopeAt(anchors, t);
  const k = a.findIndex((p) => p.t > t);
  const p: ProfileAnchor = { t, v: clamp01(at.v), in: null, out: null, corner: false };
  a.splice(k, 0, p);
  smoothHandles(a, k, slope);
  return normalizeAnchors(a);
}

/** Anchor i removed (never an end, never below two anchors). */
export function removeAnchor(anchors: readonly ProfileAnchor[], i: number): ProfileAnchor[] | null {
  if (i <= 0 || i >= anchors.length - 1 || anchors.length <= MIN_ANCHORS) return null;
  return normalizeAnchors(copyAnchors(anchors).filter((_, k) => k !== i));
}

/**
 * Anchor i between corner and smooth. Made smooth, its handles align on
 * the mean of their two directions, each keeping its length (on the
 * neighbours' slope, a third of each segment, when they have none to
 * share). An end has one handle and no corner.
 */
export function toggleCorner(anchors: readonly ProfileAnchor[], i: number): ProfileAnchor[] | null {
  if (i <= 0 || i >= anchors.length - 1) return null;
  const a = copyAnchors(anchors);
  const p = a[i];
  if (!p.corner) {
    p.corner = true;
    return normalizeAnchors(a);
  }
  p.corner = false;
  const hi = p.in!;
  const ho = p.out!;
  const li = Math.hypot(hi.t - p.t, hi.v - p.v);
  const lo = Math.hypot(ho.t - p.t, ho.v - p.v);
  let dx = 0;
  let dy = 0;
  if (li > 1e-9 && lo > 1e-9) {
    dx = (ho.t - p.t) / lo - (hi.t - p.t) / li;
    dy = (ho.v - p.v) / lo - (hi.v - p.v) / li;
  }
  const dl = Math.hypot(dx, dy);
  if (dl < 1e-9) {
    smoothHandles(a, i, neighbourSlope(a, i));
  } else {
    p.in = { t: p.t - (dx / dl) * li, v: p.v - (dy / dl) * li };
    p.out = { t: p.t + (dx / dl) * lo, v: p.v + (dy / dl) * lo };
  }
  return normalizeAnchors(a);
}

// --- the stored forms ------------------------------------------------------------

/** The stored form (curvesRev 2). */
export function serializeAnchors(a: readonly ProfileAnchor[]): StoredCurve {
  return {
    anchors: a.map((p) => {
      const s: StoredAnchor = { t: p.t, v: p.v };
      if (p.in) s.in = [p.in.t, p.in.v];
      if (p.out) s.out = [p.out.t, p.out.v];
      if (p.corner) s.corner = true;
      return s;
    }),
  };
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const pair = (x: unknown): ProfilePoint | null | false => {
  if (x === undefined || x === null) return null;
  return Array.isArray(x) && x.length === 2 && finite(x[0]) && finite(x[1]) ? { t: x[0], v: x[1] } : false;
};

/**
 * A stored curvesRev 2 curve read back: `{ anchors }` with 2 to 8 anchors
 * of finite numbers, handles as [t, v] pairs. Anything else is null, and
 * the caller keeps its default; the values are made valid by
 * normalizeAnchors (clamped, sorted, handles within their segments).
 */
export function parseStoredCurve(data: unknown): ProfileAnchor[] | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const list = (data as { anchors?: unknown }).anchors;
  if (!Array.isArray(list) || list.length < MIN_ANCHORS || list.length > MAX_ANCHORS) return null;
  const a: Partial<ProfileAnchor>[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') return null;
    const r = e as Record<string, unknown>;
    if (!finite(r.t) || !finite(r.v)) return null;
    const hin = pair(r.in);
    const hout = pair(r.out);
    if (hin === false || hout === false) return null;
    a.push({ t: r.t, v: r.v, in: hin, out: hout, corner: r.corner === true });
  }
  return normalizeAnchors(a);
}

// --- curvesRev 1: the point lists of the first build ------------------------------

/**
 * Monotone cubic tangents (Fritsch-Carlson) for sorted points with strictly
 * increasing t: the curve curvesRev 1 drew through its points.
 */
function monotoneTangents(p: readonly ProfilePoint[]): number[] {
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

/** The curvesRev 1 curve at t. */
function evaluateMonotone(points: readonly ProfilePoint[], t: number, m = monotoneTangents(points)): number {
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
 * A curvesRev 1 point list read back: 2 to 16 [t, v] pairs (or {t, v}
 * objects) of finite numbers, clamped, sorted, the ends pinned and points
 * closer than MIN_GAP dropped, as that build read it. Null otherwise.
 */
export function parseV1Points(data: unknown): ProfilePoint[] | null {
  if (!Array.isArray(data) || data.length < MIN_ANCHORS || data.length > V1_MAX_POINTS) return null;
  const pts: ProfilePoint[] = [];
  for (const e of data) {
    let t: unknown;
    let v: unknown;
    if (Array.isArray(e) && e.length === 2) [t, v] = e;
    else if (e && typeof e === 'object') ({ t, v } = e as { t: unknown; v: unknown });
    if (!finite(t) || !finite(v)) return null;
    pts.push({ t: clamp01(t), v: clamp01(v) });
  }
  pts.sort((a, b) => a.t - b.t);
  pts[0].t = 0;
  pts[pts.length - 1].t = 1;
  const out: ProfilePoint[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    if (pts[i].t - out[out.length - 1].t >= MIN_GAP && 1 - pts[i].t >= MIN_GAP) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * A curvesRev 1 curve as anchors. The points are thinned to at most
 * V1_MAX_ANCHORS, one at a time dropping the point whose removal changes
 * the old curve least, and each kept point becomes a smooth anchor on the
 * old curve's tangent there, with handles a third of each segment (which
 * is the old curve exactly where no point was dropped).
 */
export function anchorsFromV1(points: readonly ProfilePoint[]): ProfileAnchor[] | null {
  if (points.length < MIN_ANCHORS) return null;
  const m = monotoneTangents(points);
  const N = 100;
  const base = Array.from({ length: N + 1 }, (_, i) => evaluateMonotone(points, i / N, m));
  let kept = points.map((_, i) => i);
  while (kept.length > V1_MAX_ANCHORS) {
    let best = -1;
    let bestErr = Infinity;
    for (let j = 1; j < kept.length - 1; j++) {
      const sub = kept.filter((_, k) => k !== j).map((i) => points[i]);
      const mm = monotoneTangents(sub);
      let err = 0;
      for (let i = 0; i <= N; i++) err = Math.max(err, Math.abs(evaluateMonotone(sub, i / N, mm) - base[i]));
      if (err < bestErr) [best, bestErr] = [j, err];
    }
    kept = kept.filter((_, k) => k !== best);
  }
  const a: ProfileAnchor[] = kept.map((i) => ({ t: points[i].t, v: points[i].v, in: null, out: null, corner: false }));
  kept.forEach((pi, k) => smoothHandles(a, k, m[pi]));
  return normalizeAnchors(a);
}

const samePoints = (a: readonly ProfilePoint[], b: readonly ProfilePoint[]): boolean =>
  a.length === b.length && a.every((p, i) => p.t === b[i].t && p.v === b[i].v);

const samePt = (a: ProfilePoint | null, b: ProfilePoint | null): boolean => (a === null ? b === null : b !== null && a.t === b.t && a.v === b.v);

const sameAnchors = (a: readonly ProfileAnchor[], b: readonly ProfileAnchor[]): boolean =>
  a.length === b.length && a.every((p, i) => p.t === b[i].t && p.v === b[i].v && p.corner === b[i].corner && samePt(p.in, b[i].in) && samePt(p.out, b[i].out));

// --- the curve a tool holds ---------------------------------------------------------

/**
 * One tool's profile: its anchors, the baked table, and the presets it
 * offers. Live edits go through setAnchors; there is no undo (tool settings
 * are not in the scene's history, as with every other tool slider).
 */
export class ProfileCurve {
  private a: ProfileAnchor[];
  /** The baked table the brush loops read: LUT_SIZE weights from t = 0 to 1. */
  readonly lut = new Float64Array(LUT_SIZE);
  private kernel: ProfileKernel | null = null;
  /** The preset the anchors are exactly, or null once edited. */
  presetId: string | null = null;
  /** Bumps on every change (the editor redraws on it). */
  revision = 0;

  constructor(
    readonly presets: readonly ProfilePreset[],
    readonly defaultPreset: string,
  ) {
    const p = presets.find((x) => x.id === defaultPreset) ?? presets[0];
    this.a = copyAnchors(p.anchors);
    this.bake();
  }

  get anchors(): readonly ProfileAnchor[] {
    return this.a;
  }

  /** Replace the anchors (normalized); false, and nothing changed, when they cannot make a curve. */
  setAnchors(anchors: readonly Partial<ProfileAnchor>[] | null): boolean {
    const n = anchors && normalizeAnchors(anchors);
    if (!n) return false;
    this.a = n;
    this.bake();
    return true;
  }

  applyPreset(id: string): boolean {
    const p = this.presets.find((x) => x.id === id);
    if (!p) return false;
    return this.setAnchors(p.anchors);
  }

  reset(): void {
    this.applyPreset(this.defaultPreset);
  }

  isDefault(): boolean {
    return this.presetId === this.defaultPreset;
  }

  copyFrom(other: ProfileCurve): void {
    this.setAnchors(other.anchors);
  }

  /** The curve at t: the preset's kernel while unedited, else the Bezier. */
  evaluate(t: number): number {
    const x = clamp01(t);
    return this.kernel ? this.kernel(x) : evaluateBezier(this.a, x);
  }

  /** The Bezier at t, whatever the preset: the curve as the editor draws it. */
  bezier(t: number): number {
    return evaluateBezier(this.a, t);
  }

  /** Points along the drawn Bezier (bezierPolyline), segment by segment. */
  polyline(perSegment = 24): ProfilePoint[] {
    return bezierPolyline(this.a, perSegment);
  }

  /**
   * What a brush loop reads per vertex: the exact kernel while the anchors
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

  /** Whether the brush reads the preset's closed form rather than the table. */
  get exactKernel(): boolean {
    return this.kernel !== null;
  }

  serialize(): StoredCurve {
    return serializeAnchors(this.a);
  }

  /**
   * Restore a stored curve; false (the curve untouched) when it does not
   * parse. Either form: a curvesRev 2 `{ anchors }`, or a curvesRev 1
   * point list, which is this tool's preset when it is that preset's
   * points exactly and is otherwise fitted (anchorsFromV1).
   */
  load(data: unknown): boolean {
    const a = parseStoredCurve(data);
    if (a) return this.setAnchors(a);
    const pts = parseV1Points(data);
    if (!pts) return false;
    const preset = this.presets.find((p) => p.legacy && samePoints(p.legacy, pts));
    if (preset) return this.applyPreset(preset.id);
    return this.setAnchors(anchorsFromV1(pts));
  }

  private bake(): void {
    const preset = this.presets.find((p) => sameAnchors(p.anchors, this.a));
    this.presetId = preset?.id ?? null;
    this.kernel = preset?.kernel ?? null;
    for (let i = 0; i < LUT_SIZE; i++) {
      const t = i / (LUT_SIZE - 1);
      this.lut[i] = this.kernel ? this.kernel(t) : evaluateBezier(this.a, t);
    }
    this.revision++;
  }
}

// --- the shapes ------------------------------------------------------------------------

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

const dome: ProfileKernel = (d) => Math.sqrt(Math.max(0, 1 - d * d));

/**
 * Anchors from rows: the first `[0, v, outT, outV]`, each interior one
 * `[t, v, inT, inV, outT, outV]` (a seventh entry 1 makes it a corner),
 * the last `[1, v, inT, inV]`. Handles are absolute plot points.
 */
function rows(...r: readonly (readonly number[])[]): ProfileAnchor[] {
  const n = r.length;
  return r.map((x, i) => {
    if (i === 0) return { t: x[0], v: x[1], in: null, out: { t: x[2], v: x[3] }, corner: false };
    if (i === n - 1) return { t: x[0], v: x[1], in: { t: x[2], v: x[3] }, out: null, corner: false };
    return { t: x[0], v: x[1], in: { t: x[2], v: x[3] }, out: { t: x[4], v: x[5] }, corner: x[6] === 1 };
  });
}

// curvesRev 1's sampled presets, kept to recognise a stored one (ProfileCurve.load).
const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;
const sampledV1 = (ts: readonly number[], kernel: ProfileKernel): ProfilePoint[] => ts.map((t) => ({ t, v: round4(clamp01(kernel(t))) }));
const uniformV1 = (n: number): number[] => Array.from({ length: n }, (_, i) => round4(i / (n - 1)));
const plateauV1 = (p: number): number[] => [0, p, ...Array.from({ length: 6 }, (_, k) => round4(p + ((1 - p) * (k + 1)) / 6))];
const DOME_V1 = [0, 0.2, 0.4, 0.55, 0.7, 0.8, 0.88, 0.94, 0.98, 1];
const SHARP_V1 = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.8, 1];

const preset = (
  id: string,
  label: string,
  anchors: ProfileAnchor[],
  kernel: ProfileKernel | undefined,
  legacy: readonly ProfilePoint[] | undefined,
): ProfilePreset => ({ id, label, anchors, kernel, legacy });

// The anchors below are fitted to the kernels (minimum max error over t,
// handles rounded to four places; the errors are in docs/parity-fixtures.md).
// The kernel is what the brush uses while a curve is its preset.

const plateau08 = plateau(0.8);
const plateau035 = plateau(0.35);
const plateau065 = plateau(0.65);
const plateau07 = plateau(0.7);
const crease12: ProfileKernel = (d) => Math.pow(quartic(d), 12);
const crease5: ProfileKernel = (d) => Math.pow(quartic(d), 5);
const quartic2: ProfileKernel = (d) => quartic(d) * quartic(d);
const cube1: ProfileKernel = (d) => Math.pow(1 - d, 3);
const hard095 = hardness(0.95);
const hard075 = hardness(0.75);
const hard05 = hardness(0.5);

const FIT: Record<string, ProfileAnchor[]> = {
  plateau08: rows([0, 1, 0.2667, 1], [0.8, 1, 0.5333, 1, 0.8294, 1], [0.8951, 0.7234, 0.8569, 0.996, 0.9356, 0.4348], [1, 0, 0.9686, 0.001]),
  quartic: rows([0, 1, 0.1472, 1], [0.4755, 0.7234, 0.2844, 0.996, 0.6778, 0.4348], [1, 0, 0.843, 0.001]),
  dome: rows([0, 1, 0.5658, 0.9978], [1, 0, 0.9999, 0.5408]),
  crease12: rows([0, 1, 0.1197, 1], [0.2745, 0.4438, 0.1516, 0.9117, 0.3885, 0.0098], [0.6445, 0, 0.4408, 0, 0.7332, 0], [1, 0, 1, 0.0009]),
  crease5: rows([0, 1, 0.1174, 1], [0.3242, 0.5802, 0.1832, 0.9755, 0.4451, 0.2414], [0.6766, 0.0093, 0.5194, 0.0346, 0.7282, 0.001], [1, 0, 0.6766, 0.0006]),
  plateau035: rows([0, 1, 0.1167, 1], [0.35, 1, 0.2333, 1, 0.4457, 1], [0.6591, 0.7234, 0.5349, 0.996, 0.7906, 0.4348], [1, 0, 0.898, 0.001]),
  plateau065: rows([0, 1, 0.2167, 1], [0.65, 1, 0.4333, 1, 0.7015, 1], [0.8164, 0.7234, 0.7495, 0.996, 0.8872, 0.4348], [1, 0, 0.9451, 0.001]),
  quartic2: rows([0, 1, 0.1955, 1], [0.5078, 0.4568, 0.2765, 0.9459, 0.7225, 0.0027], [1, 0, 0.8083, 0.0004]),
  hard095: rows([0, 1, 0.9348, 0.951], [0.98, 0.6848, 0.9799, 0.6858, 1, 0.5308], [1, 0, 1, 0.7288]),
  hard075: rows([0, 1, 0.6723, 0.6639], [1, 0, 1, 0.3305]),
  hard05: rows([0, 1, 0.3333, 0.6667], [1, 0, 0.6667, 0.3333]),
  cube1: rows([0, 1, 0.3333, 0], [1, 0, 0.6667, 0]),
  plateau07: rows([0, 1, 0.2333, 1], [0.7, 1, 0.4667, 1, 0.7442, 1], [0.8427, 0.7234, 0.7853, 0.996, 0.9033, 0.4348], [1, 0, 0.9529, 0.001]),
};

/** The kernels the presets are fitted to, by key (for the fitting script and the tests). */
export const PRESET_KERNELS: Readonly<Record<string, ProfileKernel>> = {
  plateau08,
  quartic,
  dome,
  crease12,
  crease5,
  plateau035,
  plateau065,
  quartic2,
  hard095,
  hard075,
  hard05,
  cube1,
  plateau07,
};

const fit = (key: string): ProfileAnchor[] => FIT[key];

/** Clay strips. Plateau is the clay brush from before the curves (CLAY_PLATEAU 0.8). */
export const CLAY_PROFILES: readonly ProfilePreset[] = [
  preset('plateau', 'Plateau', fit('plateau08'), plateau08, sampledV1(plateauV1(0.8), plateau08)),
  preset('soft', 'Soft', fit('quartic'), quartic, sampledV1(uniformV1(11), quartic)),
  preset('flat', 'Flat', rows([0, 1, 1 / 3, 1], [1, 1, 2 / 3, 1]), () => 1.0, [{ t: 0, v: 1 }, { t: 1, v: 1 }]),
  preset('round', 'Round', fit('dome'), dome, sampledV1(DOME_V1, dome)),
];

/** Crease's crest. Sharp is pow(quartic, 12), the crease from before (CREASE_PROFILE 12). */
export const CREASE_PROFILES: readonly ProfilePreset[] = [
  preset('sharp', 'Sharp', fit('crease12'), crease12, sampledV1(SHARP_V1, crease12)),
  preset('medium', 'Medium', fit('crease5'), crease5, sampledV1(SHARP_V1, crease5)),
  preset('soft', 'Soft', fit('quartic'), quartic, sampledV1(uniformV1(11), quartic)),
];

/** Polish. Default is the polish from before (POLISH_PLATEAU 0.35). */
export const POLISH_PROFILES: readonly ProfilePreset[] = [
  preset('default', 'Default', fit('plateau035'), plateau035, sampledV1(plateauV1(0.35), plateau035)),
  preset('wide', 'Wide', fit('plateau065'), plateau065, sampledV1(plateauV1(0.65), plateau065)),
  preset('narrow', 'Narrow', fit('quartic2'), quartic2, sampledV1(uniformV1(11), quartic2)),
];

/** Paint (and its blur). Default is the vendored hardness 0.75. */
export const PAINT_PROFILES: readonly ProfilePreset[] = [
  preset('hard', 'Hard', fit('hard095'), hard095, sampledV1([0, 0.3, 0.6, 0.8, 0.9, 0.95, 0.98, 1], hard095)),
  preset('default', 'Default', fit('hard075'), hard075, sampledV1([0, 0.2, 0.4, 0.6, 0.75, 0.85, 0.92, 0.97, 1], hard075)),
  preset('soft', 'Soft', fit('hard05'), hard05, sampledV1([0, 1], hard05)),
  preset('airbrush', 'Airbrush', fit('cube1'), cube1, sampledV1(uniformV1(11), cube1)),
];

/** A rake tine's cross-section, t across the tine from its middle (0) to its side (1). */
export const TINE_PROFILES: readonly ProfilePreset[] = [
  preset('round', 'Round', fit('dome'), dome, sampledV1(DOME_V1, dome)),
  preset('v', 'V', rows([0, 1, 1 / 3, 2 / 3], [1, 0, 2 / 3, 1 / 3]), (d) => 1 - d, [{ t: 0, v: 1 }, { t: 1, v: 0 }]),
  preset('flat', 'Flat', fit('plateau07'), plateau07, sampledV1(plateauV1(0.7), plateau07)),
  preset('soft', 'Soft', fit('quartic'), quartic, sampledV1(uniformV1(11), quartic)),
];
