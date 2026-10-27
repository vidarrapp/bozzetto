import { vec3 } from 'gl-matrix';
import Move from '@sculpt-vendor/editing/tools/Move';
import Brush from '@sculpt-vendor/editing/tools/Brush';
import Flatten from '@sculpt-vendor/editing/tools/Flatten';
import Smooth from '@sculpt-vendor/editing/tools/Smooth';
import Crease from '@sculpt-vendor/editing/tools/Crease';
import Paint from '@sculpt-vendor/editing/tools/Paint';
import Tablet from '@sculpt-vendor/misc/Tablet';
import type Picking from '@sculpt-vendor/math3d/Picking';
import {
  CLAY_PROFILES,
  CREASE_PROFILES,
  PAINT_PROFILES,
  POLISH_PROFILES,
  ProfileCurve,
  TINE_PROFILES,
  quartic,
} from './profile';
import type { SculptSession } from './SculptSession';
import { SURFACE_RELAX, SurfaceSmoother, type SurfaceDabStats } from './surfaceSmooth';

/** The Smooth brush's modes (StableSmooth.smoothMode). */
export type SmoothMode = 'average' | 'surface';
export const SMOOTH_MODES: readonly (readonly [SmoothMode, string])[] = [
  ['average', 'Average'],
  ['surface', 'Surface'],
];

/**
 * Bridge tool subclasses (WS2f behavior pass). Vendor code stays untouched;
 * these swap into SculptManager's registry from SculptSession. Where a
 * vendor method body had to be adapted (falloff shape, layer height), the
 * loop is a tagged copy of the upstream original with the changed lines
 * called out.
 */

/**
 * Move falloff (quartic pow). 1 is the plain bell, the softest, most
 * gradual edge the slider offers; lower powers flatten the middle and
 * drop it sharply at the rim. Owner call: start soft.
 */
const MOVE_FALLOFF_POW = 1.0;

/**
 * Clay strips (owner call): the strip layer height as a fraction of the
 * radius at full pen pressure (upstream 0.1; the layer follows pressure,
 * and a mouse lays all of it), and the dab spacing. The falloff is the
 * clay profile curve, whose default "Plateau" preset is the old plateau:
 * full strength to 0.8 of the radius, the quartic after (profile.ts).
 */
const CLAY_LAYER = 0.1;
const CLAY_SPACING = 0.1;

/**
 * The tine rake's dab spacing: tight, so each tine's dabs blend into one
 * continuous groove at a normal stroke speed.
 */
const RAKE_SPACING = 0.06;
/** The rake's strength by default: one stroke at it cuts the whole Depth (RakeBrush). */
const RAKE_STRENGTH = 0.6;
/** The rake's tine count limits. */
export const RAKE_TINES_MIN = 2;
export const RAKE_TINES_MAX = 12;

/**
 * Crease defaults (owner-tuned): the sharpest crest ("Sharp", pow(quartic,
 * 12), the crease curve's default preset) and a light pinch, where upstream
 * shipped pow(falloff, 5) and a full pinch.
 */
const CREASE_PINCH = 0.625; // a quarter of the slider's 0-2.5 (owner call)
/** Crease dab spacing: close, so a cut reads as one line (owner call). */
const CREASE_SPACING = 0.05;

/**
 * Polish (hPolish-inspired, replaces Twist on 9):
 * - Flat-top falloff so the footprint planarizes rather than domes.
 * - Clip: a vertex farther off the working plane than this fraction of the
 *   brush radius belongs to some OTHER feature - an adjacent face, an edge,
 *   a corner - and is left alone entirely, in the plane FIT as well as in
 *   the move.
 * - Stickiness: how much of the held normal survives each dab. With dabs
 *   at 0.15 radius apart the held normal converges on the local fit in
 *   about 1/(1-stick) dabs, so this is a lag: 0.85 trailed a gently
 *   curved surface by ~11 degrees and planarized the curve away (owner
 *   report); 0.6 follows it within ~4 degrees while still ironing out
 *   fit noise. Edge-stopping does NOT ride on this - the band and the
 *   normal-agreement gate reject a neighbouring face at any stickiness.
 * - Gain: a strong pull toward the plane, capped so a vertex lands ON the
 *   plane and never overshoots through it.
 * - Grip floor: a dab whose band catches almost nothing (the stroke has
 *   left its plane) does nothing at all rather than acting on garbage.
 */
/**
 * Polish gain. The falloff is the polish curve, whose "Default" preset is
 * the old plateau of 0.35 of the radius (the dab moves vertices all the
 * way onto the plane there; past it the quartic tail takes over): lower
 * than the clay brush's, and with a gentler gain (owner feedback: the
 * polish built up in steps within one stroke, a plateau effect, where a
 * smoother approach was wanted).
 */
const POLISH_CLIP = 0.25;
/** Plane lock off by default (owner call): the stroke follows the surface. */
const POLISH_STICK = 0;
const POLISH_GAIN = 0.8;
const POLISH_MIN_GRIP = 8;
/**
 * Normal agreement (v2 edge-test finding): the clip band is a spatial
 * slab, and the strip of an ADJACENT face nearest the edge lies inside
 * that slab - distance alone cannot tell it from polishable chatter, and
 * it was dragged onto the plane, i.e. the edge still rounded. A vertex
 * now also has to FACE roughly the way the plane does (dot > this, ~60°)
 * to be fit or moved; a 90° face fails at any distance, moderate chatter
 * walls pass, and gentle curvature is nowhere near the line.
 */
const POLISH_NORMAL_COS = 0.5;

/**
 * Move, ZBrush-flavored:
 *
 * - Starts on the surface, like every other brush (owner call). It used to
 *   grab from just outside the outline too, when the pick ray passed
 *   within the brush radius of the silhouette; that start is gone, and a
 *   press off the model falls through to whatever a press there does
 *   with any brush.
 * - Softer falloff: the upstream quartic raised to MOVE_FALLOFF_POW, so
 *   more of the ball rides along (upstream felt sharp in review). The
 *   ball is still a ball - each vertex weighed by its straight-line
 *   distance from the grabbed point - over upstream's pick: the vertices
 *   inside the brush radius that connect to the press across the surface.
 */
export class VolumetricMove extends Move {
  /** Falloff (quartic pow): 1 the soft plain bell, lower a flat top with a sharp rim. */
  falloffPow = MOVE_FALLOFF_POW;

  constructor(session: SculptSession) {
    super(session);
    this._intensity = 0.25; // owner call: a gentle move by default
  }

  /**
   * BOZZETTO EDIT of upstream Move.move (vendor Move.js): identical loop,
   * with the quartic falloff raised to MOVE_FALLOFF_POW for a broader bell.
   */
  override move(
    iVerts: Uint32Array,
    center: number[],
    radiusSquared: number,
    moveData: unknown,
    picking: Picking,
  ): void {
    const mesh = this.getMesh();
    const vAr = mesh.getVertices();
    const mAr = mesh.getMaterials();
    const radius = Math.sqrt(radiusSquared);
    const vProxy = (moveData as { vProxy: Float32Array }).vProxy;
    const cx = center[0];
    const cy = center[1];
    const cz = center[2];
    const dir = (moveData as { dir: number[] }).dir;
    const dirx = dir[0];
    const diry = dir[1];
    const dirz = dir[2];
    for (let i = 0, l = iVerts.length; i < l; ++i) {
      const ind = iVerts[i] * 3;
      const j = i * 3;
      const vx = vProxy[j];
      const vy = vProxy[j + 1];
      const vz = vProxy[j + 2];
      const dx = vx - cx;
      const dy = vy - cy;
      const dz = vz - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      let fallOff = dist * dist;
      fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;
      fallOff = Math.pow(Math.max(fallOff, 0), this.falloffPow); // CHANGED
      fallOff *= mAr[ind + 2] * picking.getAlpha(vx, vy, vz);
      vAr[ind] += dirx * fallOff;
      vAr[ind + 1] += diry * fallOff;
      vAr[ind + 2] += dirz * fallOff;
    }
  }
}

/**
 * Smooth with the interpolation factor clamped to 1 (explosion bug).
 *
 * The vendor's smooth is `v = v·(1−k) + average·k`, which is only stable
 * for k ≤ 1: at k = 1 a vertex lands exactly on its neighbours' average,
 * and past it the move OVERSHOOTS the average, amplifying the very
 * roughness it should remove - dab after dab that divergence turns a
 * sphere into shrapnel. Upstream never sees this because it ships with
 * pen pressure driving radius only (intensityFactor 0); Bozzetto's
 * per-brush dynamics map full pen pressure to a 2x intensity multiplier,
 * so Smooth at its 0.75 default reached k = 1.5. Pressure below the cap
 * still softens the smoothing; the cap just makes "harder than full" mean
 * full instead of chaos. The tangent and along-normal variants get the
 * same ceiling - their overshoot merely oscillates, but it is still
 * meaningless.
 */
export class StableSmooth extends Smooth {
  /**
   * Average (the vendor umbrella average, the default) or Surface (owner
   * call, 2026-10-24: an option): a local surface fitted by distance and
   * the vertex projected onto it, then a light tangential relax
   * (surfaceSmooth.ts). Shift's smoothing from any brush is this tool, so
   * it smooths in whichever mode is set here.
   */
  smoothMode: SmoothMode = 'average';
  /** Surface mode's tangential relax, 0 to 1, a fraction of the smoothing weight. */
  relax = SURFACE_RELAX;
  /**
   * Vendor Smooth reads the current positions, and so does Surface mode
   * by default; with this false (as Brush's switch) its fit reads the
   * stroke-start proxy instead. The Average mode never reads it.
   */
  _accumulate = true;
  private readonly surface = new SurfaceSmoother();

  constructor(session: SculptSession) {
    super(session);
  }

  /** The last Surface dab's counts and time (tests, measurements). */
  get lastSurfaceDab(): SurfaceDabStats | null {
    return this.surface.last;
  }

  /** Mode and relax, as the scene record keeps them. */
  smoothSettings(): { mode: SmoothMode; relax: number } {
    return { mode: this.smoothMode, relax: this.relax };
  }

  /** Set either, each checked; anything else is ignored. */
  setSmooth(s: { mode?: unknown; relax?: unknown }): void {
    if (s.mode === 'average' || s.mode === 'surface') this.smoothMode = s.mode;
    if (typeof s.relax === 'number' && Number.isFinite(s.relax)) this.relax = Math.min(1, Math.max(0, s.relax));
  }

  /**
   * Average: the vendor stroke, untouched. Surface: BOZZETTO EDIT of
   * upstream Smooth.stroke (vendor Smooth.js), the same flow (undo push,
   * culling, alpha) with the smoother's pass in place of the average.
   */
  override stroke(picking: Picking): void {
    if (this.smoothMode !== 'surface') {
      super.stroke(picking);
      return;
    }
    let iVertsInRadius = picking.getPickedVertices();
    const intensity = this._intensity * Tablet.getPressureIntensity();
    const useProxy = this._accumulate === false && !this._lockPosition;
    // Before the undo push, which flags the vertices as this stroke's.
    if (useProxy) this.updateProxy(iVertsInRadius);
    (this._main as SculptSession).getStateManager().pushVertices(iVertsInRadius);
    if (this._culling) iVertsInRadius = this.getFrontVertices(iVertsInRadius, picking.getEyeDirection());
    picking.updateAlpha(this._lockPosition);
    picking.setIdAlpha(this._idAlpha);
    const mesh = this.getMesh();
    this.surface.run(
      mesh,
      iVertsInRadius,
      intensity,
      picking.getIntersectionPoint(),
      Math.sqrt(picking.getLocalRadius2()),
      (x, y, z) => picking.getAlpha(x, y, z),
      useProxy,
      this.relax,
    );
    mesh.updateGeometry(mesh.getFacesFromVertices(iVertsInRadius), iVertsInRadius);
  }

  override smooth(iVerts: Uint32Array, intensity: number, picking?: Picking): void {
    super.smooth(iVerts, Math.min(1, intensity), picking);
  }

  override smoothTangent(iVerts: Uint32Array, intensity: number, picking?: Picking): void {
    super.smoothTangent(iVerts, Math.min(1, intensity), picking);
  }

  override smoothAlongNormals(iVerts: Uint32Array, intensity: number, picking?: Picking): void {
    super.smoothAlongNormals(iVerts, Math.min(1, intensity), picking);
  }
}

/**
 * Flatten with its per-dab step capped at the plane (overshoot bug, the
 * StableSmooth class). Each vertex moves `distToPlane * intensity` toward
 * the area plane, so at intensity 1 it lands exactly on it; Bozzetto's
 * pressure dynamics double the slider at a full press, and the default
 * 0.75 reached 1.5 - a vertex near the centre crossed to the far side of
 * the plane, where later dabs skip it (`distToPlane * comp > 0`), and the
 * stroke left dents. Everything else - negative, falloff, proxy - is the
 * upstream loop.
 */
export class FlattenBrush extends Flatten {
  constructor(session: SculptSession) {
    super(session);
  }

  /**
   * BOZZETTO EDIT of upstream Flatten.flatten (vendor Flatten.js):
   * identical loop with the intensity capped at 1 (exactly-on-plane).
   */
  override flatten(
    iVertsInRadius: Uint32Array,
    aNormal: number[],
    aCenter: number[],
    center: number[],
    radiusSquared: number,
    intensity: number,
    picking: Picking,
  ): void {
    const mesh = this.getMesh();
    const vAr = mesh.getVertices();
    const mAr = mesh.getMaterials();
    const radius = Math.sqrt(radiusSquared);
    const vProxy =
      this._accumulate === false && this._lockPosition === false ? mesh.getVerticesProxy() : vAr;
    const cx = center[0];
    const cy = center[1];
    const cz = center[2];
    const ax = aCenter[0];
    const ay = aCenter[1];
    const az = aCenter[2];
    const anx = aNormal[0];
    const any = aNormal[1];
    const anz = aNormal[2];
    const comp = this._negative ? -1.0 : 1.0;
    // CHANGED: past 1 the step overshoots the plane (upstream uses intensity as is).
    const k = Math.min(1, intensity);
    for (let i = 0, l = iVertsInRadius.length; i < l; ++i) {
      const ind = iVertsInRadius[i] * 3;
      const vx = vAr[ind];
      const vy = vAr[ind + 1];
      const vz = vAr[ind + 2];
      const distToPlane = (vx - ax) * anx + (vy - ay) * any + (vz - az) * anz;
      if (distToPlane * comp > 0.0) continue;
      const dx = vProxy[ind] - cx;
      const dy = vProxy[ind + 1] - cy;
      const dz = vProxy[ind + 2] - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      if (dist >= 1.0) continue;
      let fallOff = dist * dist;
      fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;
      fallOff *= distToPlane * k * mAr[ind + 2] * picking.getAlpha(vx, vy, vz);
      vAr[ind] -= anx * fallOff;
      vAr[ind + 1] -= any * fallOff;
      vAr[ind + 2] -= anz * fallOff;
    }
  }
}

/**
 * Polish, modelled on ZBrush's hPolish (owner request, replacing Twist).
 *
 * v2, after iPad testing read as "flatten/carve that runs edges over":
 * the plane is now a per-STROKE working plane, not a per-dab average.
 * The first dab grips it with an outlier-rejected fit - seed with the
 * area average, then refit centre and normal from only the vertices
 * within the clip band, using their vertex normals, so a brush landing
 * near an edge grips the MAJORITY face instead of a blend of both. Later
 * dabs keep POLISH_STICK of the held normal and re-anchor the centre on
 * the band's inliers, so the plane rides the face it started on; the
 * adjacent face never pulls it over, its vertices sit outside the band,
 * and the edge between them sharpens instead of rounding.
 *
 * The move is TWO-SIDED inside the band - bumps shave down and dents
 * fill up onto the plane, which is what makes it a polish rather than a
 * carve - and nothing beyond the band moves at all. Alt (or the Negative
 * toggle) switches to trim: shave-only, dents left alone.
 */
export class PolishBrush extends Flatten {
  /**
   * Plane lock (WS4-style palette slider): the stickiness of the held
   * normal. High locks the stroke to its first plane (flattens chatter
   * hardest, planarizes curves); low follows the surface (curves survive,
   * chatter flattens more slowly). Owner-tuned by feel.
   */
  planeLock = POLISH_STICK;
  /** The falloff across the dab (the Tool panel's curve; "Default" is the old 0.35 plateau). */
  readonly curve = new ProfileCurve(POLISH_PROFILES, 'default');
  /** How much of the way to the plane one dab travels at full strength (slider). */
  gain = POLISH_GAIN;

  /**
   * Held plane normals, one per symmetry side: the vendor runs the same
   * stroke() once with the primary picking and once with the mirrored
   * one, and a single held normal handed the pen side's plane to the
   * mirror (owner report) - whose own geometry then failed the normal
   * gate against a backwards plane.
   */
  private readonly held: {
    main: [number, number, number] | null;
    sym: [number, number, number] | null;
  } = { main: null, sym: null };

  constructor(session: SculptSession) {
    super(session);
    this._intensity = 0.9; // a strong polish is the point
    this._negative = false; // default is polish (two-sided); alt trims
    this._idAlpha = null; // no stencils (alphas retired, October 2026)
  }

  private clearHeld(): void {
    this.held.main = null;
    this.held.sym = null;
  }

  override start(ctrl: boolean): boolean {
    // Fresh grip per stroke even if a mid-stroke tool swap ate the end().
    this.clearHeld();
    return super.start(ctrl);
  }

  override end(): void {
    this.clearHeld();
    super.end();
  }

  /**
   * BOZZETTO EDIT of upstream Flatten.stroke (vendor Flatten.js): the
   * same flow, with the area fit replaced by the held robust fit and the
   * flatten displacement by the banded two-sided polish.
   */
  override stroke(picking: Picking): void {
    let iVertsInRadius = picking.getPickedVertices();
    const intensity = this._intensity * Tablet.getPressureIntensity();

    (this._main as SculptSession).getStateManager().pushVertices(iVertsInRadius);
    iVertsInRadius = this.dynamicTopology(picking);

    const iVertsFront = this.getFrontVertices(iVertsInRadius, picking.getEyeDirection());
    if (this._culling) iVertsInRadius = iVertsFront;

    const radius = Math.sqrt(picking.getLocalRadius2());
    const side =
      picking === (this._main as SculptSession).getPickingSymmetry() ? ('sym' as const) : ('main' as const);
    const plane = this.gripPlane(iVertsFront, radius * POLISH_CLIP, side);
    if (!plane) return; // the stroke has left its plane: do nothing

    picking.setIdAlpha(null);
    this.polish(
      iVertsInRadius,
      plane.normal,
      plane.center,
      picking.getIntersectionPoint(),
      picking.getLocalRadius2(),
      intensity,
      picking,
    );

    const mesh = this.getMesh();
    mesh.updateGeometry(mesh.getFacesFromVertices(iVertsInRadius), iVertsInRadius);
  }

  /**
   * The working plane for this dab. Seeded by the vendor area fit (first
   * dab) or the held normal; the centre and normal are then REFIT from
   * only the vertices inside the clip band, weighted by vertex normals -
   * the outlier rejection that keeps an adjacent face from tilting the
   * plane. Returns null when the band grips too little to mean anything.
   */
  private gripPlane(
    iVertsFront: Uint32Array,
    clip: number,
    side: 'main' | 'sym',
  ): { normal: [number, number, number]; center: number[] } | null {
    const mesh = this.getMesh();
    const vAr = mesh.getVertices();
    const nAr = mesh.getNormals();

    let seed = this.held[side];
    if (!seed) {
      const a = this.areaNormal(iVertsFront);
      if (!a) return null;
      seed = [a[0], a[1], a[2]];
    }
    const seedC = this.areaCenter(iVertsFront);

    let cx = 0;
    let cy = 0;
    let cz = 0;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let count = 0;
    for (let i = 0, l = iVertsFront.length; i < l; ++i) {
      const ind = iVertsFront[i] * 3;
      const d =
        (vAr[ind] - seedC[0]) * seed[0] +
        (vAr[ind + 1] - seedC[1]) * seed[1] +
        (vAr[ind + 2] - seedC[2]) * seed[2];
      if (Math.abs(d) > clip) continue;
      // Inliers must also FACE the plane's way: an adjacent face's strip
      // sits inside the slab but points elsewhere.
      const vnx = nAr[ind];
      const vny = nAr[ind + 1];
      const vnz = nAr[ind + 2];
      const nlen = Math.hypot(vnx, vny, vnz);
      if (nlen < 1e-10) continue;
      if ((vnx * seed[0] + vny * seed[1] + vnz * seed[2]) / nlen < POLISH_NORMAL_COS) continue;
      cx += vAr[ind];
      cy += vAr[ind + 1];
      cz += vAr[ind + 2];
      nx += vnx;
      ny += vny;
      nz += vnz;
      count++;
    }
    if (count < POLISH_MIN_GRIP) return null;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-10) return null;
    nx /= len;
    ny /= len;
    nz /= len;
    const h = this.held[side];
    if (h) {
      const s = Math.min(0.95, Math.max(0, this.planeLock));
      nx = h[0] * s + nx * (1 - s);
      ny = h[1] * s + ny * (1 - s);
      nz = h[2] * s + nz * (1 - s);
      const bl = Math.hypot(nx, ny, nz);
      if (bl < 1e-10) return null;
      nx /= bl;
      ny /= bl;
      nz /= bl;
    }
    this.held[side] = [nx, ny, nz];
    return { normal: [nx, ny, nz], center: [cx / count, cy / count, cz / count] };
  }

  /**
   * BOZZETTO EDIT of upstream Flatten.flatten (vendor Flatten.js): the
   * same projection loop, banded (nothing beyond the clip moves),
   * two-sided by default (trim-only under alt/Negative), the profile
   * curve's falloff, and the pull capped at landing exactly on the plane.
   */
  private polish(
    iVertsInRadius: Uint32Array,
    aNormal: [number, number, number],
    aCenter: number[],
    center: number[],
    radiusSquared: number,
    intensity: number,
    picking: Picking,
  ): void {
    const mesh = this.getMesh();
    const vAr = mesh.getVertices();
    const nAr = mesh.getNormals();
    const mAr = mesh.getMaterials();
    const radius = Math.sqrt(radiusSquared);
    const vProxy =
      this._accumulate === false && this._lockPosition === false ? mesh.getVerticesProxy() : vAr;
    const cx = center[0];
    const cy = center[1];
    const cz = center[2];
    const ax = aCenter[0];
    const ay = aCenter[1];
    const az = aCenter[2];
    const anx = aNormal[0];
    const any = aNormal[1];
    const anz = aNormal[2];
    const shaveOnly = this._negative;
    const clip = radius * POLISH_CLIP;
    const curve = this.curve;
    for (let i = 0, l = iVertsInRadius.length; i < l; ++i) {
      const ind = iVertsInRadius[i] * 3;
      const vx = vAr[ind];
      const vy = vAr[ind + 1];
      const vz = vAr[ind + 2];
      const distToPlane = (vx - ax) * anx + (vy - ay) * any + (vz - az) * anz;
      if (Math.abs(distToPlane) > clip) continue; // other features stay
      if (shaveOnly && distToPlane < 0.0) continue; // trim leaves the dents
      // The slab is not enough at an edge: the neighbouring face's first
      // strip lies inside it. Only vertices FACING the plane's way polish.
      const vnx = nAr[ind];
      const vny = nAr[ind + 1];
      const vnz = nAr[ind + 2];
      const nlen = Math.hypot(vnx, vny, vnz);
      if (nlen < 1e-10) continue;
      if ((vnx * anx + vny * any + vnz * anz) / nlen < POLISH_NORMAL_COS) continue;
      const dx = vProxy[ind] - cx;
      const dy = vProxy[ind + 1] - cy;
      const dz = vProxy[ind + 2] - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      if (dist >= 1.0) continue;
      // CHANGED: the profile curve (was the plateau falloff, which its
      // Default preset is, exactly).
      const fallOff = curve.sample(dist);
      const frac = Math.min(1.0, this.gain * intensity * fallOff * mAr[ind + 2]);
      vAr[ind] -= anx * distToPlane * frac;
      vAr[ind + 1] -= any * distToPlane * frac;
      vAr[ind + 2] -= anz * distToPlane * frac;
    }
  }
}

/**
 * The Standard brush as clay strips (review request): a flat-topped
 * falloff (the clay profile curve; its default "Plateau" preset is full
 * strength across 0.8 of the radius, the quartic tail after) and a build
 * plane raised by the layer, so strokes lay down ribbon-like layers instead
 * of soft mounds.
 */
export class ClayStripsBrush extends Brush {
  /** The falloff across the strip (the Tool panel's curve). */
  readonly curve = new ProfileCurve(CLAY_PROFILES, 'plateau');
  /** Strip layer height as a fraction of the radius, at full pressure (WS4 slider). */
  layer = CLAY_LAYER;
  /** The last clay dab's plane offset in local units (the parity recorder reads it). */
  lastLayerOffset = 0;

  constructor(session: SculptSession) {
    super(session);
    // No stencils (alphas retired): upstream leaves the NUMBER 0 here,
    // which behaves as none; null says so.
    this._idAlpha = null;
    // Closer than upstream's 0.15 (owner call): the strips read as one
    // ribbon rather than a row of stamps.
    this._spacing = CLAY_SPACING;
  }

  /**
   * The layer's pressure term p, 0..1 (owner call: the layer follows
   * pressure). The plane offset is layer x radius x p, p the pressure on
   * the strength curve's 0..1 scale (Tablet.getPressureLayer, 1 for a mouse
   * or a finger).
   */
  layerPressure(): number {
    return Tablet.getPressureLayer ? Tablet.getPressureLayer() : 1;
  }

  /**
   * BOZZETTO EDIT of upstream Brush.stroke (vendor Brush.js): identical
   * flow; the clay branch raises the layer plane to layer x radius x p
   * (upstream 0.1 x radius) and flattens with the profile curve below.
   */
  override stroke(picking: Picking): void {
    let iVertsInRadius = picking.getPickedVertices();
    const intensity = this._intensity * Tablet.getPressureIntensity();

    if (!this._accumulate && !this._lockPosition) this.updateProxy(iVertsInRadius);
    this.session().getStateManager().pushVertices(iVertsInRadius);
    if (!this._lockPosition) iVertsInRadius = this.dynamicTopology(picking);

    const iVertsFront = this.getFrontVertices(iVertsInRadius, picking.getEyeDirection());
    if (this._culling) iVertsInRadius = iVertsFront;

    const r2 = picking.getLocalRadius2();
    picking.setIdAlpha(null);

    if (!this._clay) {
      this.brush(
        iVertsInRadius,
        picking.getPickedNormal() as number[],
        picking.getIntersectionPoint(),
        r2,
        intensity,
        picking,
      );
    } else {
      const aNormal = this.areaNormal(iVertsFront);
      if (!aNormal) return;
      const aCenter = this._lockPosition
        ? picking.getIntersectionPoint().slice()
        : this.areaCenter(iVertsFront);
      // CHANGED (upstream 0.1 x radius, no pressure term).
      const off = Math.sqrt(r2) * this.layer * this.layerPressure();
      this.lastLayerOffset = off;
      vec3.scaleAndAdd(
        aCenter as unknown as vec3,
        aCenter as unknown as vec3,
        aNormal as unknown as vec3,
        this._negative ? -off : off,
      );
      this.flattenStrips(
        iVertsInRadius,
        aNormal,
        aCenter,
        picking.getIntersectionPoint(),
        r2,
        intensity,
      );
    }

    const mesh = this.getMesh();
    mesh.updateGeometry(mesh.getFacesFromVertices(iVertsInRadius), iVertsInRadius);
  }

  private session(): SculptSession {
    return this._main as SculptSession;
  }

  /** The non-clay path is untyped upstream; keep the inherited behavior. */
  private brush(
    iVerts: Uint32Array,
    aNormal: number[],
    center: number[],
    r2: number,
    intensity: number,
    picking: Picking,
  ): void {
    (
      Brush.prototype as unknown as {
        brush(
          iVerts: Uint32Array,
          aNormal: number[],
          center: number[],
          r2: number,
          intensity: number,
          picking: Picking,
        ): void;
      }
    ).brush.call(this, iVerts, aNormal, center, r2, intensity, picking);
  }

  /**
   * BOZZETTO EDIT of upstream Flatten.flatten (vendor Flatten.js):
   * identical projection loop with the profile curve for the falloff
   * (upstream applies the quartic from d=0).
   */
  private flattenStrips(
    iVertsInRadius: Uint32Array,
    aNormal: number[],
    aCenter: number[],
    center: number[],
    radiusSquared: number,
    intensity: number,
  ): void {
    const mesh = this.getMesh();
    const vAr = mesh.getVertices();
    const mAr = mesh.getMaterials();
    const radius = Math.sqrt(radiusSquared);
    const vProxy =
      this._accumulate === false && this._lockPosition === false ? mesh.getVerticesProxy() : vAr;
    const cx = center[0];
    const cy = center[1];
    const cz = center[2];
    const ax = aCenter[0];
    const ay = aCenter[1];
    const az = aCenter[2];
    const anx = aNormal[0];
    const any = aNormal[1];
    const anz = aNormal[2];
    const comp = this._negative ? -1.0 : 1.0;
    const curve = this.curve;
    for (let i = 0, l = iVertsInRadius.length; i < l; ++i) {
      const ind = iVertsInRadius[i] * 3;
      const vx = vAr[ind];
      const vy = vAr[ind + 1];
      const vz = vAr[ind + 2];
      const distToPlane = (vx - ax) * anx + (vy - ay) * any + (vz - az) * anz;
      if (distToPlane * comp > 0.0) continue;
      const dx = vProxy[ind] - cx;
      const dy = vProxy[ind + 1] - cy;
      const dz = vProxy[ind + 2] - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      if (dist >= 1.0) continue;
      // CHANGED: the profile curve (upstream applies the quartic from d=0).
      let fallOff = curve.sample(dist);
      // Past 1 the step overshoots the plane and flips dents into bumps that
      // later dabs skip - the Smooth-explosion class; pen pressure reaches
      // 1.75x here, so the flatten term is capped at exactly-on-plane.
      fallOff *= distToPlane * Math.min(1, intensity) * mAr[ind + 2];
      vAr[ind] -= anx * fallOff;
      vAr[ind + 1] -= any * fallOff;
      vAr[ind + 2] -= anz * fallOff;
    }
  }
}

/** The rake's knobs, as a preset sets them (and the scene record keeps them). */
export interface RakeSettings {
  /** How many tines across the brush, RAKE_TINES_MIN..RAKE_TINES_MAX. */
  tines: number;
  /** The fraction of each tine's slot the tine fills, 0.1..1. */
  width: number;
  /** Groove depth one stroke cuts, as a fraction of the radius, at full pressure. */
  depth: number;
  /**
   * Scrape (owner name, October 2026, replacing Plateau): how hard each dab
   * pulls the footprint toward its plane before the tines cut, 0 (the
   * tines follow the form) to 1 (scrapes flat, grooves cut into the flat).
   */
  scrape: number;
  /** How much the outer tines' depth fades toward the rake's edges, 0..1. */
  taper: number;
  /** Raise ridges instead of carving grooves. */
  invert: boolean;
}

/** Settings as a scene may carry them: a record from before Scrape has `plateau`. */
export type RakeSettingsIn = Partial<RakeSettings> & { plateau?: number };

export interface RakePreset extends RakeSettings {
  id: string;
  label: string;
  /** The tine profile preset (TINE_PROFILES) it picks. */
  profile: string;
}

/** The rake presets (owner call): picking one sets every knob and the tine profile. */
export const RAKE_PRESETS: readonly RakePreset[] = [
  { id: 'fine', label: 'Fine', tines: 8, width: 0.45, depth: 0.05, scrape: 0.15, taper: 0, invert: false, profile: 'v' },
  { id: 'comb', label: 'Comb', tines: 12, width: 0.5, depth: 0.04, scrape: 0.1, taper: 0, invert: false, profile: 'round' },
  { id: 'coarse', label: 'Coarse', tines: 4, width: 0.7, depth: 0.1, scrape: 0.25, taper: 0, invert: false, profile: 'round' },
  { id: 'chisel', label: 'Chisel', tines: 3, width: 0.75, depth: 0.08, scrape: 0.5, taper: 0, invert: false, profile: 'flat' },
  { id: 'scraper', label: 'Scraper', tines: 5, width: 0.8, depth: 0.05, scrape: 1, taper: 0, invert: false, profile: 'flat' },
];
export const DEFAULT_RAKE_PRESET = 'coarse';

/**
 * One stroke's cut, summed over its dabs, at the default strength: the
 * along falloff (the quartic over the chord, w / chord) summed over dabs
 * `step` apart is about chord x radius / step x the quartic's integral
 * over [-1, 1], which is 2 x 0.6 = 1.2. So a dab cuts its share times
 * step / (1.2 x chord x radius), and the dabs of one stroke add up to the
 * whole depth, whatever the spacing and on every tine.
 */
const RAKE_ALONG_INTEGRAL = 1.2;
/** The chord the spacing factor divides by, at least this (the disc's rim). */
const RAKE_MIN_CHORD = 0.2;

/** What the last rake dab used, per its picking side (the parity recorder and the tests read it). */
export interface RakeDab {
  tines: number;
  width: number;
  depth: number;
  scrape: number;
  taper: number;
  invert: boolean;
  /** The cut one stroke adds up to, local units: depth x radius x pressure term (x strength / default). */
  depthLocal: number;
  pressureTerm: number;
  /** The strength term: min(1, strength) / RAKE_STRENGTH, 1 at the default. */
  strengthTerm: number;
  /** The distance from the previous dab (or the press), local units, held to the radius. */
  stepLocal: number;
  /** step / (RAKE_ALONG_INTEGRAL x radius): the dab's share of a stroke, before the chord. */
  spacingFactor: number;
  /** The unit axis the tines are laid across (surface tangent, perpendicular to the stroke). */
  across: [number, number, number];
  /** The unit stroke direction in the tangent plane. */
  along: [number, number, number];
  /** Where the direction came from: the last dab, the press, or the previous stroke's axis. */
  directionFrom: 'previous-dab' | 'press' | 'previous-stroke' | 'fallback';
  /** The plane the dab scrapes toward and cuts along: fitted to the form (see the class comment). */
  areaNormal: [number, number, number];
  areaCenter: [number, number, number];
}

type Vec3 = [number, number, number];
const norm3 = (v: Vec3): Vec3 | null => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-12 ? [v[0] / l, v[1] / l, v[2] / l] : null;
};
const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** v with its component along the unit n removed. */
const tangent = (v: Vec3, n: Vec3): Vec3 => {
  const d = dot3(v, n);
  return [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d];
};

/**
 * The tine rake (owner call, October 2026, replacing the stencil rake): N
 * tines laid across the brush, perpendicular to the stroke, each carving
 * its own groove. Since 2026-10-24 (owner call) a standard brush, not a
 * clay one: each dab displaces, it does not aim for a target, so Invert
 * raises ridges on any form and a second pass cuts deeper.
 *
 * The frame, per dab: the stroke direction - from the previous dab's
 * intersection to this one, in the surface tangent plane, as the stencil
 * frame upstream builds in Picking.updateAlpha. The first dab of a stroke
 * takes it from the press point, which is the drag direction on the
 * surface; when that is too short to point anywhere it keeps the previous
 * stroke's across axis (and, on a brush's very first stroke, any tangent).
 * The across axis is the normal crossed with the direction. The mirrored
 * side keeps its own frame (the mirrored picking's points give the
 * mirrored direction).
 *
 * The normal: the area normal of the front vertices (not the picked one,
 * which is a single face's and on a groove just cut tilts with its flank),
 * refined by a least-squares plane through the FORM: the positions with
 * this stroke's own cuts taken back out (below). On a curved form that is
 * the form's normal at the dab, so the tines cut straight in, and the
 * grooves already cut do not tilt it. The plane goes through the
 * mask-weighted centre of the same positions.
 *
 * Per vertex, in one pass over the vertices in the radius:
 *
 * 1. Scrape: the form pulled toward the plane by min(1, scrape x quartic
 *    x strength) (clay strips' flatten, from both sides, capped so it
 *    lands on the plane and never passes it). The cut this stroke already
 *    made rides along, so the scrape planes the form under the grooves and
 *    never fills them back in.
 * 2. Cut: its across coordinate u in [-1, 1] of the radius, its nearest
 *    tine k (centre at (k + 0.5) / N x 2 - 1), and t = |u - centre| /
 *    (width / N), the distance from the tine's middle over its half-width.
 *    The tine profile curve gives the weight at t (0 past the tine). Along
 *    the stroke the quartic applies over the vertex's distance along the
 *    stroke as a fraction of the chord of the disc at u. The vertex moves
 *    along the normal by depth x radius x profile(t) x taper x along
 *    falloff x pressure term x strength term x step / (1.2 x chord x
 *    radius): inward, outward with Invert (or the stroke's Ctrl), and
 *    every dab adds to the last, as the Standard brush does.
 *
 * The last factor is the spacing compensation (RAKE_ALONG_INTEGRAL): one
 * stroke at the default strength and full pressure cuts depth x radius,
 * whatever the spacing or the stroke speed, so Depth means one pass.
 * Pressure scales it once, through the clay layer's term (Tablet's layer
 * term: a mouse or a finger is full); the strength slider scales it as a
 * multiple of its default, capped at 1.
 *
 * Positions follow the Standard brush (vendor Brush.brush): distances are
 * measured on the stroke-start positions (the proxy) when _accumulate is
 * off and on the current ones when it is on (the default), and the moves
 * add to the current positions.
 */
export class RakeBrush extends Brush {
  tines = 4;
  tineWidth = 0.7;
  depth = 0.1;
  scrape = 0.25;
  taper = 0;
  invert = false;
  /** The tine cross-section (the Tool panel's curve). */
  readonly curve = new ProfileCurve(TINE_PROFILES, 'round');
  /** The rake preset the knobs are exactly, or null once one moved. */
  presetId: string | null = null;
  /** The last dab, per side (the parity recorder and the tests read it). */
  lastDab: RakeDab | null = null;

  private readonly prev: { main: Vec3 | null; sym: Vec3 | null } = { main: null, sym: null };
  private readonly prevAcross: { main: Vec3 | null; sym: Vec3 | null } = { main: null, sym: null };
  private readonly fromPress = { main: false, sym: false };

  /**
   * This stroke's cut per vertex (what the tines moved it by), with the
   * position it left the vertex at and the stroke it belongs to. An entry
   * counts only for this stroke and while the vertex is still where the
   * rake left it: dynamic topology renumbers and moves vertices, and an
   * entry that no longer matches is a vertex the rake has not cut.
   */
  private cutVec = new Float32Array(0);
  private cutPos = new Float32Array(0);
  private cutStroke = new Uint32Array(0);
  private strokeId = 0;

  constructor(session: SculptSession) {
    super(session);
    this._idAlpha = null;
    this._clay = false;
    this._spacing = RAKE_SPACING;
    this._intensity = RAKE_STRENGTH;
    this.applyPreset(DEFAULT_RAKE_PRESET);
  }

  /** Set every knob and the tine profile from a preset; false for an unknown id. */
  applyPreset(id: string): boolean {
    const p = RAKE_PRESETS.find((x) => x.id === id);
    if (!p) return false;
    this.set(p);
    this.curve.applyPreset(p.profile);
    this.presetId = p.id;
    return true;
  }

  settings(): RakeSettings {
    return { tines: this.tines, width: this.tineWidth, depth: this.depth, scrape: this.scrape, taper: this.taper, invert: this.invert };
  }

  /**
   * Set knobs (each held to its range); a preset id no longer describes
   * them unless they match it. A `plateau` (a record from before Scrape)
   * sets the scrape, at the same value, when no `scrape` comes with it.
   */
  set(s: RakeSettingsIn): void {
    const num = (v: unknown, lo: number, hi: number, cur: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : cur;
    this.tines = Math.round(num(s.tines, RAKE_TINES_MIN, RAKE_TINES_MAX, this.tines));
    this.tineWidth = num(s.width, 0.1, 1, this.tineWidth);
    this.depth = num(s.depth, 0, 1, this.depth);
    this.scrape = num(s.scrape, 0, 1, num(s.plateau, 0, 1, this.scrape));
    this.taper = num(s.taper, 0, 1, this.taper);
    if (typeof s.invert === 'boolean') this.invert = s.invert;
    const p = RAKE_PRESETS.find((x) => x.id === this.presetId);
    const same = p && p.tines === this.tines && p.width === this.tineWidth && p.depth === this.depth && p.scrape === this.scrape && p.taper === this.taper && p.invert === this.invert;
    if (!same) this.presetId = null;
  }

  /** The depth's pressure term, 0..1: the clay layer's (a mouse or a finger is full). */
  pressureTerm(): number {
    return Tablet.getPressureLayer ? Tablet.getPressureLayer() : 1;
  }

  override start(ctrl: boolean): boolean {
    this.prev.main = null;
    this.prev.sym = null;
    // A new stroke: every cut entry from before is the form now.
    this.strokeId = (this.strokeId + 1) >>> 0 || 1;
    const ok = super.start(ctrl);
    if (!ok) return ok;
    // The press is where the first dab's direction comes from.
    const session = this._main as SculptSession;
    this.prev.main = session.getPicking().getIntersectionPoint().slice(0, 3) as Vec3;
    this.fromPress.main = true;
    if (session.getSculptManager().getSymmetry()) {
      this.prev.sym = session.getPickingSymmetry().getIntersectionPoint().slice(0, 3) as Vec3;
      this.fromPress.sym = true;
    }
    return ok;
  }

  /** BOZZETTO EDIT of upstream Brush.stroke (vendor Brush.js): the same flow, the rake's frame and loop. */
  override stroke(picking: Picking): void {
    const session = this._main as SculptSession;
    let iVertsInRadius = picking.getPickedVertices();
    const intensity = this._intensity * Tablet.getPressureIntensity();

    if (!this._accumulate && !this._lockPosition) this.updateProxy(iVertsInRadius);
    session.getStateManager().pushVertices(iVertsInRadius);
    if (!this._lockPosition) iVertsInRadius = this.dynamicTopology(picking);

    const iVertsFront = this.getFrontVertices(iVertsInRadius, picking.getEyeDirection());
    if (this._culling) iVertsInRadius = iVertsFront;
    picking.setIdAlpha(null);

    const an = this.areaNormal(iVertsFront);
    const n = an ? norm3([an[0], an[1], an[2]]) : null;
    if (!n) return;
    const side = picking === session.getPickingSymmetry() ? ('sym' as const) : ('main' as const);
    const c = picking.getIntersectionPoint().slice(0, 3) as Vec3;

    // The stroke direction, in the tangent plane, and the step it took.
    let along: Vec3 | null = null;
    let from: RakeDab['directionFrom'] = 'fallback';
    const prev = this.prev[side];
    const radius = Math.sqrt(picking.getLocalRadius2());
    let step = 0;
    if (prev) {
      const d: Vec3 = [c[0] - prev[0], c[1] - prev[1], c[2] - prev[2]];
      step = Math.min(radius, Math.hypot(d[0], d[1], d[2]));
      if (step > radius * 1e-4) {
        along = norm3(tangent(d, n));
        if (along) from = this.fromPress[side] ? 'press' : 'previous-dab';
      }
    }
    let across: Vec3 | null = along ? norm3(cross3(n, along)) : null;
    if (!across) {
      const keep = this.prevAcross[side];
      across = keep ? norm3(tangent(keep, n)) : null;
      if (across) from = 'previous-stroke';
      else {
        // Any tangent: the axis least aligned with the normal, made tangent.
        const ax: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        across = norm3(tangent(ax, n)) as Vec3;
      }
      along = norm3(cross3(across, n)) as Vec3;
    }
    this.prev[side] = c;
    this.fromPress[side] = false;
    this.prevAcross[side] = across;

    this.rake(iVertsInRadius, iVertsFront, n, c, across, along as Vec3, radius, step, intensity, from);

    const mesh = this.getMesh();
    mesh.updateGeometry(mesh.getFacesFromVertices(iVertsInRadius), iVertsInRadius);
  }

  /** The cut tables, at least `nb` vertices long (kept across strokes, grown with slack). */
  private cutTables(nb: number): void {
    if (this.cutStroke.length >= nb) return;
    const len = Math.ceil(nb * 1.25) + 64;
    const vec = new Float32Array(len * 3);
    vec.set(this.cutVec);
    const pos = new Float32Array(len * 3);
    pos.set(this.cutPos);
    const id = new Uint32Array(len);
    id.set(this.cutStroke);
    this.cutVec = vec;
    this.cutPos = pos;
    this.cutStroke = id;
  }

  /** Whether vertex `ind / 3` carries a cut from this stroke and still sits where the rake left it. */
  private hasCut(ind: number, vAr: Float32Array): boolean {
    const p = this.cutPos;
    return this.cutStroke[ind / 3] === this.strokeId && p[ind] === vAr[ind] && p[ind + 1] === vAr[ind + 1] && p[ind + 2] === vAr[ind + 2];
  }

  /** The one pass over the vertices in the radius (see the class comment). */
  private rake(
    iVerts: Uint32Array,
    iFront: Uint32Array,
    n0: Vec3,
    c: Vec3,
    across0: Vec3,
    along0: Vec3,
    radius: number,
    step: number,
    intensity: number,
    from: RakeDab['directionFrom'],
  ): void {
    const mesh = this.getMesh();
    const vAr = mesh.getVertices();
    const mAr = mesh.getMaterials();
    // As vendor Brush.brush: distances on the stroke-start positions
    // unless the brush accumulates.
    const vProxy = this._accumulate || this._lockPosition ? vAr : mesh.getVerticesProxy();
    this.cutTables(mesh.getNbVertices());
    const cut = this.cutVec;

    // The form: the front vertices' positions with this stroke's cut taken out.
    const nf = iFront.length;
    const fp = new Float64Array(nf * 3);
    for (let i = 0; i < nf; ++i) {
      const ind = iFront[i] * 3;
      const had = this.hasCut(ind, vAr);
      fp[i * 3] = had ? vAr[ind] - cut[ind] : vAr[ind];
      fp[i * 3 + 1] = had ? vAr[ind + 1] - cut[ind + 1] : vAr[ind + 1];
      fp[i * 3 + 2] = had ? vAr[ind + 2] - cut[ind + 2] : vAr[ind + 2];
    }

    // The plane's centre: the mask-weighted mean of the form.
    let ax = 0;
    let ay = 0;
    let az = 0;
    let acc = 0;
    for (let i = 0; i < nf; ++i) {
      const f = mAr[iFront[i] * 3 + 2];
      ax += fp[i * 3] * f;
      ay += fp[i * 3 + 1] * f;
      az += fp[i * 3 + 2] * f;
      acc += f;
    }
    if (acc <= 0) return;
    ax /= acc;
    ay /= acc;
    az /= acc;
    // Its normal: the area normal, refined by a least-squares fit to the
    // same positions (as a height over the area normal's tangent plane).
    let sxx = 0;
    let sxy = 0;
    let syy = 0;
    let sxz = 0;
    let syz = 0;
    for (let i = 0; i < nf; ++i) {
      const f = mAr[iFront[i] * 3 + 2];
      const d: Vec3 = [fp[i * 3] - ax, fp[i * 3 + 1] - ay, fp[i * 3 + 2] - az];
      const x = dot3(d, across0);
      const y = dot3(d, along0);
      const z = dot3(d, n0);
      sxx += f * x * x;
      sxy += f * x * y;
      syy += f * y * y;
      sxz += f * x * z;
      syz += f * y * z;
    }
    const det = sxx * syy - sxy * sxy;
    let n = n0;
    if (det > 1e-9 * (sxx + syy) * (sxx + syy)) {
      const sa = (sxz * syy - syz * sxy) / det;
      const sb = (syz * sxx - sxz * sxy) / det;
      n = norm3([n0[0] - sa * across0[0] - sb * along0[0], n0[1] - sa * across0[1] - sb * along0[1], n0[2] - sa * across0[2] - sb * along0[2]]) ?? n0;
    }
    const across = norm3(tangent(across0, n)) ?? across0;
    const along = cross3(across, n);

    const N = this.tines;
    const halfWidth = this.tineWidth / N;
    const pressure = this.pressureTerm();
    const strengthTerm = Math.min(1, this._intensity) / RAKE_STRENGTH;
    const depth = this.depth * radius * pressure * strengthTerm;
    const spacingFactor = step / (RAKE_ALONG_INTEGRAL * radius);
    // Inward (down the normal) unless inverted; the stroke's Ctrl flips it too.
    const comp = this.invert !== this._negative ? -1.0 : 1.0;
    const scrape = this.scrape;
    const taper = this.taper;
    const curve = this.curve;
    const [nx, ny, nz] = n;
    const [ux, uy, uz] = across;
    const [wx, wy, wz] = along;
    const [cx, cy, cz] = c;
    const inv = 1 / radius;
    this.lastDab = {
      tines: N,
      width: this.tineWidth,
      depth: this.depth,
      scrape,
      taper,
      invert: comp < 0,
      depthLocal: depth,
      pressureTerm: pressure,
      strengthTerm,
      stepLocal: step,
      spacingFactor,
      across,
      along,
      directionFrom: from,
      areaNormal: n,
      areaCenter: [ax, ay, az],
    };
    const stamp = this.cutStroke;
    const pos = this.cutPos;
    const id = this.strokeId;
    for (let i = 0, l = iVerts.length; i < l; ++i) {
      const ind = iVerts[i] * 3;
      const px = vProxy[ind] - cx;
      const py = vProxy[ind + 1] - cy;
      const pz = vProxy[ind + 2] - cz;
      const dist = Math.sqrt(px * px + py * py + pz * pz) * inv;
      if (dist >= 1.0) continue;
      const mask = mAr[ind + 2];
      if (mask <= 0) continue;
      const had = this.hasCut(ind, vAr);
      let kx = had ? cut[ind] : 0;
      let ky = had ? cut[ind + 1] : 0;
      let kz = had ? cut[ind + 2] : 0;
      let vx = vAr[ind];
      let vy = vAr[ind + 1];
      let vz = vAr[ind + 2];
      // 1. Scrape the form toward the plane, the cut riding along.
      if (scrape > 0) {
        const rate = Math.min(1, scrape * quartic(dist) * intensity * mask);
        const h = (vx - kx - ax) * nx + (vy - ky - ay) * ny + (vz - kz - az) * nz;
        vx -= nx * h * rate;
        vy -= ny * h * rate;
        vz -= nz * h * rate;
      }
      // 2. Cut: the nearest tine and how far across it the vertex sits.
      const u = (px * ux + py * uy + pz * uz) * inv;
      const w = (px * wx + py * wy + pz * wz) * inv;
      let slot = Math.floor(((u + 1) * N) / 2);
      if (slot < 0) slot = 0;
      else if (slot > N - 1) slot = N - 1;
      const centre = ((slot + 0.5) / N) * 2 - 1;
      const t = Math.abs(u - centre) / halfWidth;
      const prof = t < 1 ? curve.sample(t) : 0;
      // Along the stroke: the quartic over the chord of the disc at u.
      const chord = Math.sqrt(Math.max(0, 1 - u * u));
      const aw = Math.abs(w) / Math.max(1e-6, chord);
      const alongFall = aw >= 1 ? 0 : quartic(aw);
      const amount = prof * alongFall > 0 ? -comp * depth * prof * (1 - taper * Math.abs(centre)) * alongFall * mask * (spacingFactor / Math.max(RAKE_MIN_CHORD, chord)) : 0;
      if (amount !== 0) {
        vx += nx * amount;
        vy += ny * amount;
        vz += nz * amount;
        kx += nx * amount;
        ky += ny * amount;
        kz += nz * amount;
      }
      vAr[ind] = vx;
      vAr[ind + 1] = vy;
      vAr[ind + 2] = vz;
      if (amount !== 0 || had) {
        // Read back: the entry holds the position exactly as stored.
        cut[ind] = kx;
        cut[ind + 1] = ky;
        cut[ind + 2] = kz;
        pos[ind] = vAr[ind];
        pos[ind + 1] = vAr[ind + 1];
        pos[ind + 2] = vAr[ind + 2];
        stamp[ind / 3] = id;
      }
    }
  }
}

/**
 * Crease with its two defining knobs exposed.
 *
 * Upstream's crease does two things at once and hardcodes the balance:
 * it pulls vertices sideways TOWARD the stroke (the pinch, which is what
 * gathers a ridge into an edge) and pushes them along the normal by
 * pow(falloff, 5) (the crest, whose shape is what makes the cut narrow
 * rather than a dent). Both are the brush's character, and both are worth
 * having a hand on:
 *
 *   Profile - the crest's curve. "Soft" is the plain brush falloff, a
 *     round trough; "Medium" is upstream's crease, pow(falloff, 5); the
 *     default "Sharp", pow(falloff, 12), narrows the cut toward a knife
 *     line that leaves its shoulders alone.
 *   Pinch - how hard the sideways gather pulls. 0 carves without gathering
 *     (a groove, not a crease); 1 is upstream; above that the surface
 *     draws into the cut and the edge sharpens as it deepens.
 */
export class CreaseBrush extends Crease {
  /** The crest's falloff (the Tool panel's curve): low a broad trough, sharp a knife line. */
  readonly curve = new ProfileCurve(CREASE_PROFILES, 'sharp');
  /** Sideways gather toward the stroke; 0 carves without pinching. */
  pinch = CREASE_PINCH;

  constructor(session: SculptSession) {
    super(session);
    this._idAlpha = null; // as above: upstream leaves a numeric 0 here
    this._intensity = 0.5;
    this._spacing = CREASE_SPACING;
  }

  /**
   * BOZZETTO EDIT of upstream Crease.crease (vendor Crease.js): the same
   * loop, with the hardcoded pow(fallOff, 5) replaced by the profile curve
   * and the implicit pinch weight of 1 by the field above.
   */
  override crease(
    iVertsInRadius: Uint32Array,
    aNormal: number[],
    center: number[],
    radiusSquared: number,
    intensity: number,
    picking: Picking,
  ): void {
    const mesh = this.getMesh();
    const vAr = mesh.getVertices();
    const mAr = mesh.getMaterials();
    const vProxy = mesh.getVerticesProxy();
    const radius = Math.sqrt(radiusSquared);
    const cx = center[0];
    const cy = center[1];
    const cz = center[2];
    const anx = aNormal[0];
    const any = aNormal[1];
    const anz = aNormal[2];
    const deformIntensity = intensity * 0.07;
    let brushFactor = deformIntensity * radius;
    if (this._negative) brushFactor = -brushFactor;
    const pinch = deformIntensity * this.pinch; // CHANGED (upstream: deformIntensity)
    const curve = this.curve;
    picking.setIdAlpha(null);
    for (let i = 0, l = iVertsInRadius.length; i < l; ++i) {
      const ind = iVertsInRadius[i] * 3;
      const dx = cx - vProxy[ind];
      const dy = cy - vProxy[ind + 1];
      const dz = cz - vProxy[ind + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      if (dist >= 1.0) continue;
      const vx = vAr[ind];
      const vy = vAr[ind + 1];
      const vz = vAr[ind + 2];
      let fallOff = quartic(dist);
      fallOff *= mAr[ind + 2];
      // CHANGED (upstream: Math.pow(fallOff, 5)): the curve, masked.
      const brushModifier = curve.sample(dist) * mAr[ind + 2] * brushFactor;
      const gather = fallOff * pinch;
      vAr[ind] = vx + dx * gather + anx * brushModifier;
      vAr[ind + 1] = vy + dy * gather + any * brushModifier;
      vAr[ind + 2] = vz + dz * gather + anz * brushModifier;
    }
  }
}

/**
 * Paint with its blend weight capped at 1 (overshoot bug, the
 * StableSmooth class). Each dab lerps a vertex's colour (and, when
 * written, roughness/metalness) toward the brush's by
 * `profile(d) * intensity * mask`; with the pressure dynamics a full press
 * doubled the 0.75 default to 1.5, the complement went negative and the
 * lerp EXTRAPOLATED past the target colour. The other factors are each in
 * [0, 1] (the profile curve never leaves it, the mask is 0..1), so capping
 * the intensity caps the weight. The falloff is the paint profile curve,
 * whose "Default" preset is the vendored hardness 0.75, pow(1 - d, 0.5),
 * exactly; it replaced the hardness slider. Everything else - the
 * eyedropper, the fill, the write flags mode.ts sets - is upstream's.
 */
export class PaintBrush extends Paint {
  /** The dab's falloff (the Tool panel's curve; the blur shares it). */
  readonly curve = new ProfileCurve(PAINT_PROFILES, 'default');

  constructor(session: SculptSession) {
    super(session);
    this._idAlpha = null;
  }

  /**
   * BOZZETTO EDIT of upstream Paint.paint (vendor Paint.js): identical
   * loop with the intensity capped at 1, so the blend never extrapolates,
   * and the profile curve for pow(1 - d, softness) (the `hardness`
   * argument the vendored stroke passes is not read).
   */
  override paint(
    iVerts: Uint32Array,
    center: number[],
    radiusSquared: number,
    intensity: number,
    _hardness: number,
    _picking: Picking,
  ): void {
    const mesh = this.getMesh();
    const vAr = mesh.getVertices();
    const cAr = mesh.getColors();
    const mAr = mesh.getMaterials();
    const color = this._color;
    const roughness = this._material[0];
    const metallic = this._material[1];
    const radius = Math.sqrt(radiusSquared);
    const cr = color[0];
    const cg = color[1];
    const cb = color[2];
    const cx = center[0];
    const cy = center[1];
    const cz = center[2];
    const curve = this.curve;
    // CHANGED: past 1 the blend extrapolates past the target (upstream uses intensity as is).
    const k = Math.min(1, intensity);
    for (let i = 0, l = iVerts.length; i < l; ++i) {
      const ind = iVerts[i] * 3;
      const vx = vAr[ind];
      const vy = vAr[ind + 1];
      const vz = vAr[ind + 2];
      const dx = vx - cx;
      const dy = vy - cy;
      const dz = vz - cz;
      let dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      if (dist > 1) dist = 1.0;

      // CHANGED (upstream: Math.pow(1 - dist, softness)).
      let fallOff = curve.sample(dist);
      fallOff *= k * mAr[ind + 2];
      const fallOffCompl = 1.0 - fallOff;

      if (this._writeAlbedo) {
        cAr[ind] = cAr[ind] * fallOffCompl + cr * fallOff;
        cAr[ind + 1] = cAr[ind + 1] * fallOffCompl + cg * fallOff;
        cAr[ind + 2] = cAr[ind + 2] * fallOffCompl + cb * fallOff;
      }

      if (this._writeRoughness) {
        mAr[ind] = mAr[ind] * fallOffCompl + roughness * fallOff;
      }

      if (this._writeMetalness) {
        mAr[ind + 1] = mAr[ind + 1] * fallOffCompl + metallic * fallOff;
      }
    }
  }
}

/**
 * The paint brush's blur: what shift does over the paint brush, the way
 * it smooths over the sculpting brushes (owner call). Each dab pulls the
 * colours under it toward their ring average - the paint's own falloff
 * curve (SculptSession hands it Paint's), pressure and mask still shape
 * it - so a hard edge between two colours softens the more it is stroked.
 * Geometry is not touched.
 */
export class PaintBlurBrush extends Paint {
  /** The falloff: Paint's own curve object once SculptSession wires it, so the two always agree. */
  curve = new ProfileCurve(PAINT_PROFILES, 'default');

  constructor(session: SculptSession) {
    super(session);
    this._idAlpha = null;
  }

  /**
   * BOZZETTO EDIT of upstream Paint.stroke: the same flow, the paint loop
   * replaced by a blend toward the Laplacian of the colours.
   */
  override stroke(picking: Picking): void {
    let iVerts = picking.getPickedVertices();
    const intensity = this._intensity * Tablet.getPressureIntensity();
    (this._main as SculptSession).getStateManager().pushVertices(iVerts);
    iVerts = this.dynamicTopology(picking);
    if (this._culling) iVerts = this.getFrontVertices(iVerts, picking.getEyeDirection());
    picking.setIdAlpha(null);

    const mesh = this.getMesh();
    const vAr = mesh.getVertices();
    const cAr = mesh.getColors();
    const mAr = mesh.getMaterials();
    const smooth = new Float32Array(iVerts.length * 3);
    this.laplacianSmooth(iVerts, smooth, cAr);
    const center = picking.getIntersectionPoint();
    const radius = Math.sqrt(picking.getLocalRadius2());
    const curve = this.curve;
    for (let i = 0, l = iVerts.length; i < l; ++i) {
      const ind = iVerts[i] * 3;
      const vx = vAr[ind];
      const vy = vAr[ind + 1];
      const vz = vAr[ind + 2];
      const dx = vx - center[0];
      const dy = vy - center[1];
      const dz = vz - center[2];
      let dist = Math.sqrt(dx * dx + dy * dy + dz * dz) / radius;
      if (dist > 1) dist = 1;
      let f = curve.sample(dist) * intensity * mAr[ind + 2];
      if (f > 1) f = 1;
      const g = 1 - f;
      cAr[ind] = cAr[ind] * g + smooth[i * 3] * f;
      cAr[ind + 1] = cAr[ind + 1] * g + smooth[i * 3 + 1] * f;
      cAr[ind + 2] = cAr[ind + 2] * g + smooth[i * 3 + 2] * f;
    }
    mesh.updateDuplicateColorsAndMaterials(iVerts);
    if (mesh.isUsingDrawArrays()) mesh.updateDrawArrays(mesh.getFacesFromVertices(iVerts));
  }
}
