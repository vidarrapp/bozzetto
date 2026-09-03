import { mat4, vec3 } from 'gl-matrix';
import Move from '@sculpt-vendor/editing/tools/Move';
import Brush from '@sculpt-vendor/editing/tools/Brush';
import Flatten from '@sculpt-vendor/editing/tools/Flatten';
import Smooth from '@sculpt-vendor/editing/tools/Smooth';
import Crease from '@sculpt-vendor/editing/tools/Crease';
import Geometry from '@sculpt-vendor/math3d/Geometry';
import Tablet from '@sculpt-vendor/misc/Tablet';
import type Picking from '@sculpt-vendor/math3d/Picking';
import { DEFAULT_RAKE_ALPHA } from './alphas';
import type { SculptSession } from './SculptSession';

/**
 * Bridge tool subclasses (WS2f behavior pass). Vendor code stays untouched;
 * these swap into SculptManager's registry from SculptSession. Where a
 * vendor method body had to be adapted (falloff shape, layer height), the
 * loop is a tagged copy of the upstream original with the changed lines
 * called out.
 */

/** Softer Move falloff: hold strength longer toward the rim (ZBrush feel). */
const MOVE_FALLOFF_POW = 0.55;
/** Volumetric grab reach: how far past the silhouette a press still grabs. */
const MOVE_GRAB_FACTOR = 1.0;

/**
 * Clay strips: plateau fraction of the radius at full strength, and the
 * strip layer height as a fraction of the radius (upstream 0.1). Both sit
 * at their slider extremes by review call - the widest flat top and the
 * thinnest layer, which is the flattest, most ribbon-like default.
 */
/** A rake's default dab spacing: close enough for the tines to comb. */
const RAKE_SPACING = 0.06;

/**
 * Crease defaults, matching upstream so the brush feels unchanged until a
 * slider is touched: the vendored crease raised the crest by
 * pow(falloff, 5) and pulled sideways at the plain falloff.
 */
const CREASE_PROFILE = 5;
const CREASE_PINCH = 1;

const STRIPS_PLATEAU = 0.8;
const STRIPS_LAYER = 0.05;

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
const POLISH_PLATEAU = 0.7;
const POLISH_CLIP = 0.25;
const POLISH_STICK = 0.6;
const POLISH_GAIN = 1.5;
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
 * - Volumetric start: a press that misses the mesh still grabs when the
 *   pick ray passes within the brush radius of the surface. The grab
 *   sphere centers on the ray at the depth of the nearest vertex, so
 *   pulling a silhouette from just outside the outline works, symmetry
 *   included (the sphere is mirrored through the symmetry plane).
 * - Softer falloff: the upstream quartic raised to MOVE_FALLOFF_POW, so
 *   more of the ball rides along (upstream felt sharp in review).
 */
export class VolumetricMove extends Move {
  /** Falloff softness (quartic pow): lower = broader bell (WS4 slider). */
  falloffPow = MOVE_FALLOFF_POW;
  /**
   * True when the last start() grabbed from OUTSIDE the silhouette. The
   * cursor reads it: the grabbed point is on the mesh, but the pointer is
   * not, and drawing the ring on the mesh leaves the pen with no cursor
   * at all - which is what "the circle only shows on the model" meant.
   */
  grabbedFromOutside = false;

  constructor(private readonly session: SculptSession) {
    super(session);
  }

  override start(ctrl: boolean): boolean {
    if (super.start(ctrl)) {
      this.grabbedFromOutside = false;
      return true;
    }
    this.grabbedFromOutside = this.startVolumetric(ctrl);
    return this.grabbedFromOutside;
  }

  private startVolumetric(ctrl: boolean): boolean {
    const session = this.session;
    const mesh = session.getMesh();
    if (!mesh) return false;
    const picking = session.getPicking();

    // Pick ray in the mesh's local space.
    const vNear = picking.unproject(session._mouseX, session._mouseY, 0.0) as unknown as vec3;
    const vFar = picking.unproject(session._mouseX, session._mouseY, 0.1) as unknown as vec3;
    const inv = mat4.create();
    mat4.invert(inv, mesh.getMatrix() as unknown as mat4);
    vec3.transformMat4(vNear, vNear, inv);
    vec3.transformMat4(vFar, vFar, inv);
    const dir = vec3.create();
    vec3.sub(dir, vFar, vNear);
    vec3.normalize(dir, dir);

    // Nearest live vertex to the ray (in front of the near plane).
    const vAr = mesh.getVertices();
    const nbV = mesh.getNbVertices();
    let bestPerp2 = Infinity;
    let bestT = 0;
    for (let i = 0; i < nbV; i++) {
      const j = i * 3;
      const wx = vAr[j] - vNear[0];
      const wy = vAr[j + 1] - vNear[1];
      const wz = vAr[j + 2] - vNear[2];
      const t = wx * dir[0] + wy * dir[1] + wz * dir[2];
      if (t <= 0) continue;
      const perp2 = wx * wx + wy * wy + wz * wz - t * t;
      if (perp2 < bestPerp2) {
        bestPerp2 = perp2;
        bestT = t;
      }
    }
    if (!Number.isFinite(bestPerp2)) return false;

    // Grab sphere on the ray at silhouette depth; reject when the ray
    // passes farther from the surface than the brush radius.
    const center = vec3.create();
    vec3.scaleAndAdd(center, vNear, dir, bestT);
    const prevMesh = picking._mesh;
    picking._mesh = mesh;
    picking.setIntersectionPoint([center[0], center[1], center[2]]);
    picking.updateLocalAndWorldRadius2();
    const r2 = picking.getLocalRadius2();
    if (bestPerp2 > r2 * MOVE_GRAB_FACTOR * MOVE_GRAB_FACTOR) {
      picking._mesh = prevMesh;
      return false;
    }

    session.setOrUnsetMesh(mesh, ctrl);
    picking.initAlpha();
    this.pushState();
    this._lastMouseX = session._mouseX;
    this._lastMouseY = session._mouseY;

    // Volumetric sphere pick: plain radius query, no topology walk (there
    // is no seed face off-surface).
    const prevTopo = this._topoCheck;
    this._topoCheck = false;
    this.initMoveData(picking, this._moveData);

    const manager = session.getSculptManager();
    if (manager.getSymmetry()) {
      const pickingSym = session.getPickingSymmetry();
      const centerSym = [center[0], center[1], center[2]];
      Geometry.mirrorPoint(centerSym, mesh.getSymmetryOrigin(), mesh.getSymmetryNormal());
      pickingSym._mesh = mesh;
      pickingSym.setIntersectionPoint(centerSym);
      pickingSym.setLocalRadius2(r2);
      pickingSym.initAlpha();
      this.initMoveData(pickingSym, this._moveDataSym);
    }
    this._topoCheck = prevTopo;
    return true;
  }

  /**
   * Upstream's Negative Move slides along the picked face normal; a
   * volumetric grab has no picked face (the ray missed the surface), and
   * computePickedNormal() came back empty - a TypeError on every pointer
   * move, the stroke doing nothing (review finding). Off the silhouette,
   * Negative means a plain move.
   */
  override updateMoveDir(picking: Picking, mouseX: number, mouseY: number, useSymmetry?: boolean): void {
    if (!this.grabbedFromOutside || !this._negative) {
      super.updateMoveDir(picking, mouseX, mouseY, useSymmetry);
      return;
    }
    this._negative = false;
    try {
      super.updateMoveDir(picking, mouseX, mouseY, useSymmetry);
    } finally {
      this._negative = true;
    }
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
  constructor(session: SculptSession) {
    super(session);
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

    picking.updateAlpha(this._lockPosition);
    picking.setIdAlpha(this._idAlpha);
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
   * two-sided by default (trim-only under alt/Negative), plateau falloff,
   * and the pull capped at landing exactly on the plane.
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
      let fallOff: number;
      if (dist <= POLISH_PLATEAU) {
        fallOff = 1.0;
      } else {
        const t = (dist - POLISH_PLATEAU) / (1.0 - POLISH_PLATEAU);
        fallOff = t * t;
        fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * t + 1.0;
      }
      const frac = Math.min(
        1.0,
        POLISH_GAIN * intensity * fallOff * mAr[ind + 2] * picking.getAlpha(vx, vy, vz),
      );
      vAr[ind] -= anx * distToPlane * frac;
      vAr[ind + 1] -= any * distToPlane * frac;
      vAr[ind + 2] -= anz * distToPlane * frac;
    }
  }
}

/**
 * The Standard brush as clay strips (review request): flat-topped falloff
 * (full strength across STRIPS_PLATEAU of the radius, quartic tail after)
 * and a thicker build plane, so strokes lay down ribbon-like layers
 * instead of soft mounds.
 */
export class ClayStripsBrush extends Brush {
  /** Flat-top fraction of the radius at full strength (WS4 slider). */
  plateau = STRIPS_PLATEAU;
  /** Strip layer height as a fraction of the radius (WS4 slider). */
  layer = STRIPS_LAYER;

  constructor(session: SculptSession) {
    super(session);
    // No stencil until one is picked. Upstream leaves the NUMBER 0 here,
    // which behaves as none but is not none - see InputShell.getToolAlpha.
    this._idAlpha = null;
  }

  /**
   * BOZZETTO EDIT of upstream Brush.stroke (vendor Brush.js): identical
   * flow; the clay branch raises the layer plane to STRIPS_LAYER x radius
   * (upstream 0.1) and flattens with the plateau falloff below.
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
    picking.updateAlpha(this._lockPosition);
    picking.setIdAlpha(this._idAlpha);

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
      const off = Math.sqrt(r2) * this.layer; // CHANGED (upstream 0.1)
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
        picking,
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
   * identical projection loop with a plateau falloff - full strength out
   * to STRIPS_PLATEAU of the radius, the upstream quartic beyond it.
   */
  private flattenStrips(
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
      // CHANGED: plateau falloff (upstream applies the quartic from d=0).
      let fallOff: number;
      const plateau = this.plateau;
      if (dist <= plateau) {
        fallOff = 1.0;
      } else {
        const t = (dist - plateau) / (1.0 - plateau);
        fallOff = t * t;
        fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * t + 1.0;
      }
      // Past 1 the step overshoots the plane and flips dents into bumps that
      // later dabs skip - the Smooth-explosion class; pen pressure reaches
      // 1.75x here, so the flatten term is capped at exactly-on-plane.
      fallOff *= distToPlane * Math.min(1, intensity) * mAr[ind + 2] * picking.getAlpha(vx, vy, vz);
      vAr[ind] -= anx * fallOff;
      vAr[ind + 1] -= any * fallOff;
      vAr[ind + 2] -= anz * fallOff;
    }
  }
}

/**
 * Rake: the clay brush stamping through a stroke-aligned alpha.
 *
 * The alpha does all the work and the vendored core already knew how -
 * Picking builds a lookAt from the stroke's own direction each step, so
 * the stencil turns with the stroke, and Brush.stroke already multiplies
 * its falloff by picking.getAlpha(). This subclass exists to own the
 * choice of stencil (and its own dab spacing, since a rake reads as a
 * rake only when the dabs sit close enough to comb).
 */
export class RakeBrush extends ClayStripsBrush {
  constructor(session: SculptSession) {
    super(session);
    this._idAlpha = DEFAULT_RAKE_ALPHA;
    // Tighter than the 0.15 default: at wider spacing the tines break into
    // separate stamps instead of drawing continuous grooves.
    this._spacing = RAKE_SPACING;
    // Full strength by default, where clay sits lower. Measured on a
    // stroke across the default sphere: these stencils are 2-8% white, so
    // 98% of the alpha samples in a dab come back 0 and a rake moves a
    // fraction of the clay it would otherwise - at clay's default strength
    // the grooves are there but barely legible. The slider still runs the
    // whole range; this is only where it starts.
    this._intensity = 1;
  }

  /** Which stencil this rake stamps through (the Tool panel picks it). */
  get alphaId(): string {
    return this._idAlpha ?? DEFAULT_RAKE_ALPHA;
  }

  set alphaId(id: string) {
    this._idAlpha = id;
  }
}


/**
 * Crease with its two defining knobs exposed.
 *
 * Upstream's crease does two things at once and hardcodes the balance:
 * it pulls vertices sideways TOWARD the stroke (the pinch, which is what
 * gathers a ridge into an edge) and pushes them along the normal by
 * pow(falloff, 5) (the crest, whose exponent is what makes the cut narrow
 * rather than a dent). Both numbers are the brush's character, and both
 * are worth having a hand on:
 *
 *   Profile - the crest exponent. 1 is the plain brush falloff, a soft
 *     round trough; 5 is upstream's crease; higher narrows the cut toward
 *     a knife line that leaves its shoulders alone.
 *   Pinch - how hard the sideways gather pulls. 0 carves without gathering
 *     (a groove, not a crease); 1 is upstream; above that the surface
 *     draws into the cut and the edge sharpens as it deepens.
 */
export class CreaseBrush extends Crease {
  /** Crest exponent: low is a broad trough, high is a knife line. */
  profile = CREASE_PROFILE;
  /** Sideways gather toward the stroke; 0 carves without pinching. */
  pinch = CREASE_PINCH;

  constructor(session: SculptSession) {
    super(session);
    this._idAlpha = null; // as above: upstream leaves a numeric 0 here
  }

  /**
   * BOZZETTO EDIT of upstream Crease.crease (vendor Crease.js): the same
   * loop, with the hardcoded pow(fallOff, 5) and the implicit pinch weight
   * of 1 replaced by the two fields above.
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
      let fallOff = dist * dist;
      fallOff = 3.0 * fallOff * fallOff - 4.0 * fallOff * dist + 1.0;
      fallOff *= mAr[ind + 2] * picking.getAlpha(vx, vy, vz);
      // CHANGED (upstream: Math.pow(fallOff, 5))
      const brushModifier = Math.pow(fallOff, this.profile) * brushFactor;
      const gather = fallOff * pinch;
      vAr[ind] = vx + dx * gather + anx * brushModifier;
      vAr[ind + 1] = vy + dy * gather + any * brushModifier;
      vAr[ind + 2] = vz + dz * gather + anz * brushModifier;
    }
  }
}
