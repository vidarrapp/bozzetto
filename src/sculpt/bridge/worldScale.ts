import { vec3 } from 'gl-matrix';
import type { PerspectiveCamera } from 'three';
import type { SculptSession } from './SculptSession';

/**
 * World-scale brush size (review request).
 *
 * Upstream measures the brush in SCREEN pixels: `_radius` is a pixel count,
 * and `Picking.computeWorldRadius2` derives the footprint by offsetting the
 * projected hit point by that many pixels and unprojecting. So the same
 * brush covers less of the model up close and more far away - handy for
 * detailing, but a brush size is then not a measurement you can rely on.
 *
 * Switched to world scale, the slider owns a radius in WORLD units and
 * `_radius` becomes a derived value: each time the brush is used or drawn,
 * the world radius is converted back into the pixel count that produces it
 * at the depth under the cursor. Writing `_radius` rather than patching
 * `getScreenRadius` matters, because the vendor reads the raw field in
 * places the getter never sees - notably the dab spacing in
 * SculptBase.stroke, `0.15 * this._radius * pixelRatio`, which otherwise
 * kept screen-sized gaps around a world-sized brush and left strokes
 * visibly ragged as you zoomed out.
 *
 * The conversion is the perspective one: at distance d, one world unit
 * spans `(viewportHeight / 2) / (d * tan(fov / 2))` device pixels. Depth
 * comes from the point actually under the cursor, so the brush is the size
 * you asked for where it lands; with nothing picked it falls back to the
 * orbit distance.
 */

/** Slider travel, shared with screen-pixel mode so one control serves both. */
const SLIDER_MIN = 5;
const SLIDER_MAX = 500;

export class WorldScaleBrush {
  private on = false;
  /** The pinned radius, in world units. Authoritative while `on`. */
  private world = 1;
  private readonly tmp = vec3.create();

  constructor(
    private readonly session: SculptSession,
    private readonly camera: PerspectiveCamera,
    /** Distance to fall back on when nothing is under the cursor. */
    private readonly orbitDistance: () => number,
    /** Bounding radius of the subject, so the slider spans sensible sizes. */
    private readonly subjectRadius: () => number,
  ) {}

  isEnabled(): boolean {
    return this.on;
  }

  /**
   * Turn world scale on or off, keeping the brush the size it looks right
   * now: switching modes should never resize the brush under you.
   */
  setEnabled(on: boolean): void {
    if (on === this.on) return;
    const px = this.toolRadius();
    if (on) this.world = this.worldForPixels(px * this.session.getPixelRatio(), this.depth());
    this.on = on;
    // Back in screen scale, leave the pixel radius where the eye last saw
    // it rather than restoring a stale slider value.
    if (!on) this.setToolRadius(px);
    this.sync();
  }

  /**
   * Push the world radius into the tool as the pixel count that draws it at
   * the current depth. Called wherever the brush is about to be used or
   * shown, so every vendor consumer - stroke, spacing, picking - agrees.
   */
  sync(): void {
    if (!this.on) return;
    this.setToolRadius(this.pixelsForWorld(this.world, this.depth()) / this.session.getPixelRatio());
  }

  /**
   * The size control's value. In world mode the slider owns the WORLD
   * radius, so the same 5..500 travel is reused against the subject's size -
   * full travel is a brush as wide as the model. That keeps the existing
   * slider, the B-drag and the [ ] keys driving world size, with no second
   * widget to keep in step.
   */
  private unit(): number {
    return Math.max(1e-4, this.subjectRadius()) / SLIDER_MAX;
  }

  getSliderValue(): number {
    return Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, this.world / this.unit()));
  }

  setSliderValue(v: number): void {
    this.world = Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, v)) * this.unit();
    this.sync();
  }

  /** The brush's current on-screen radius in CSS px, for the cursor ring. */
  screenRadiusCss(): number {
    if (!this.on) return this.toolRadius();
    return this.pixelsForWorld(this.world, this.depth()) / this.session.getPixelRatio();
  }

  /** The pinned radius in world units (what the strength line is anchored to). */
  worldRadius(): number {
    return this.world;
  }

  // --- conversions --------------------------------------------------------

  /** Device pixels spanned by one world unit at distance `d`. */
  private pixelsPerWorld(d: number): number {
    const halfFov = (this.camera.fov * Math.PI) / 360;
    return this.session.getCanvasHeight() / 2 / Math.max(1e-6, d * Math.tan(halfFov));
  }

  private pixelsForWorld(w: number, d: number): number {
    return Math.max(1, w * this.pixelsPerWorld(d));
  }

  private worldForPixels(px: number, d: number): number {
    return Math.max(1e-5, px / this.pixelsPerWorld(d));
  }

  /**
   * Distance from the camera to whatever the cursor is over. The picking
   * keeps its intersection in mesh-local space, so it goes through the mesh
   * matrix first - the same transform computeWorldRadius2 does.
   */
  private depth(): number {
    const picking = this.session.getPicking() as unknown as {
      getMesh(): { getMatrix(): Float32Array } | null;
      getIntersectionPoint(): vec3;
    };
    const mesh = picking.getMesh();
    if (mesh) {
      vec3.transformMat4(this.tmp, picking.getIntersectionPoint(), mesh.getMatrix());
      const d = Math.hypot(
        this.tmp[0] - this.camera.position.x,
        this.tmp[1] - this.camera.position.y,
        this.tmp[2] - this.camera.position.z,
      );
      if (d > 1e-4) return d;
    }
    return Math.max(1e-4, this.orbitDistance());
  }

  private toolRadius(): number {
    const tool = this.session.getSculptManager().getCurrentTool() as { _radius?: number };
    return tool._radius ?? 50;
  }

  private setToolRadius(css: number): void {
    const tool = this.session.getSculptManager().getCurrentTool() as { _radius?: number };
    if (tool._radius !== undefined) tool._radius = Math.max(1, css);
  }
}
