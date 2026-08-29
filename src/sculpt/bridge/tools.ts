import { mat4, vec3 } from 'gl-matrix';
import Move from '@sculpt-vendor/editing/tools/Move';
import Brush from '@sculpt-vendor/editing/tools/Brush';
import Geometry from '@sculpt-vendor/math3d/Geometry';
import Tablet from '@sculpt-vendor/misc/Tablet';
import type Picking from '@sculpt-vendor/math3d/Picking';
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

/** Clay strips: plateau fraction of the radius at full strength... */
const STRIPS_PLATEAU = 0.45;
/** ...and the strip layer height as a fraction of the radius (upstream 0.1). */
const STRIPS_LAYER = 0.25;

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

  constructor(private readonly session: SculptSession) {
    super(session);
  }

  override start(ctrl: boolean): boolean {
    if (super.start(ctrl)) return true;
    return this.startVolumetric(ctrl);
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
      fallOff *= distToPlane * intensity * mAr[ind + 2] * picking.getAlpha(vx, vy, vz);
      vAr[ind] -= anx * fallOff;
      vAr[ind + 1] -= any * fallOff;
      vAr[ind + 2] -= anz * fallOff;
    }
  }
}
