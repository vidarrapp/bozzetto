import { vec3 } from 'gl-matrix';
import SculptBase from '@sculpt-vendor/editing/tools/SculptBase';
import type { PerspectiveCamera } from 'three';
import type { SculptSession } from './SculptSession';

/**
 * World-scale brush size (review request).
 *
 * Upstream measures the brush in SCREEN pixels: `getScreenRadius()` returns
 * the slider value times the pixel ratio, and `Picking.computeWorldRadius2`
 * derives the world footprint by offsetting the projected hit point by that
 * many pixels and unprojecting. So the same brush covers less of the model
 * the closer you are and more the further away - useful for detailing, but
 * it means a brush size is not a measurement you can rely on across a
 * session.
 *
 * Switched to world scale, the radius becomes a distance on the mesh and
 * stays that size however you zoom. Because every consumer - the stroke, the
 * picking, the symmetry pass and the cursor ring - goes through that one
 * getter, patching it moves the whole pipeline at once. The patch is applied
 * to the prototype (the same bridge-patch idiom dynamics.ts uses for the
 * Tablet getters) so the vendored source stays untouched.
 *
 * The conversion is the perspective one: at distance d from the camera, one
 * world unit spans `(viewportHeight / 2) / (d * tan(fov / 2))` device pixels.
 * Depth is taken from the point actually under the cursor, so the brush is
 * the size you asked for where it lands, not where the camera happens to be
 * aimed; with nothing picked it falls back to the orbit distance.
 */
export class WorldScaleBrush {
  private on = false;
  /** The pinned radius, in world units. Meaningless while `on` is false. */
  private world = 1;
  private restore: (() => void) | null = null;
  private readonly tmp = vec3.create();

  constructor(
    private readonly session: SculptSession,
    private readonly camera: PerspectiveCamera,
    /** Distance to fall back on when nothing is under the cursor. */
    private readonly orbitDistance: () => number,
  ) {}

  isEnabled(): boolean {
    return this.on;
  }

  /**
   * Turn world scale on or off, keeping the brush the size it looks right
   * now: switching modes should not resize the brush under you, so the
   * current on-screen radius is converted into the other mode's units.
   */
  setEnabled(on: boolean): void {
    if (on === this.on) return;
    const tool = this.session.getSculptManager().getCurrentTool() as { _radius?: number };
    const px = (tool._radius ?? 50) * this.session.getPixelRatio();
    if (on) this.world = this.worldForPixels(px, this.depth());
    this.on = on;
    if (!on) this.syncSliderTo(px);
  }

  /**
   * Re-pin the world radius from the slider. Dragging the size slider in
   * world mode still has to mean "bigger" and "smaller", so the pixel value
   * is read at the current depth and becomes the new world radius.
   */
  repin(): void {
    if (!this.on) return;
    const tool = this.session.getSculptManager().getCurrentTool() as { _radius?: number };
    const px = (tool._radius ?? 50) * this.session.getPixelRatio();
    this.world = this.worldForPixels(px, this.depth());
  }

  /** The brush's current on-screen radius in CSS px, for the cursor ring. */
  screenRadiusCss(): number {
    const tool = this.session.getSculptManager().getCurrentTool() as { _radius?: number };
    if (!this.on) return tool._radius ?? 50;
    return this.pixelsForWorld(this.world, this.depth()) / this.session.getPixelRatio();
  }

  /** The pinned radius in world units (the strength line's world anchor). */
  worldRadius(): number {
    return this.world;
  }

  install(): void {
    const proto = SculptBase.prototype;
    const orig = proto.getScreenRadius;
    // A plain function, not an arrow: when world scale is off this delegates
    // to upstream, which reads `this._main` off the TOOL. An arrow would
    // capture this class instead and take the pixel ratio off nothing.
    const self = this;
    proto.getScreenRadius = function screenRadius(this: typeof proto): number {
      return self.on ? self.pixelsForWorld(self.world, self.depth()) : orig.call(this);
    };
    this.restore = () => {
      proto.getScreenRadius = orig;
    };
  }

  dispose(): void {
    this.restore?.();
    this.restore = null;
  }

  // --- conversions --------------------------------------------------------

  /** Device pixels spanned by one world unit at distance `d`. */
  private pixelsPerWorld(d: number): number {
    const h = this.session.getCanvasHeight();
    const halfFov = (this.camera.fov * Math.PI) / 360;
    return h / 2 / Math.max(1e-6, d * Math.tan(halfFov));
  }

  private pixelsForWorld(w: number, d: number): number {
    return Math.max(1, w * this.pixelsPerWorld(d));
  }

  private worldForPixels(px: number, d: number): number {
    return Math.max(1e-5, px / this.pixelsPerWorld(d));
  }

  /**
   * Distance from the camera to whatever the cursor is over, in world units.
   * The picking keeps its intersection in mesh-local space, so it goes
   * through the mesh matrix first - the same transform computeWorldRadius2
   * does before it measures.
   */
  private depth(): number {
    const picking = this.session.getPicking() as {
      getMesh(): { getMatrix(): Float32Array } | null;
      getIntersectionPoint(): vec3;
    };
    const mesh = picking.getMesh();
    if (mesh) {
      vec3.transformMat4(this.tmp, picking.getIntersectionPoint(), mesh.getMatrix());
      const dx = this.tmp[0] - this.camera.position.x;
      const dy = this.tmp[1] - this.camera.position.y;
      const dz = this.tmp[2] - this.camera.position.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 1e-4) return d;
    }
    return Math.max(1e-4, this.orbitDistance());
  }

  /** Put a device-pixel radius back on the tool, for the mode swap. */
  private syncSliderTo(px: number): void {
    const tool = this.session.getSculptManager().getCurrentTool() as { _radius?: number };
    if (tool._radius !== undefined) tool._radius = px / this.session.getPixelRatio();
  }
}
