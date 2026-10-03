import { vec3 } from 'gl-matrix';
import type { PerspectiveCamera } from 'three';
import Enums from '@sculpt-vendor/misc/Enums';
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
 *
 * Every brush keeps its own size (owner request), in either scale: in
 * screen scale that is the vendor's own per-tool `_radius`, and in world
 * scale the per-brush table here. Switching brushes recalls the size, and
 * a change applies to the brush in hand alone.
 */

/** Slider travel, shared with screen-pixel mode so one control serves both. */
const SLIDER_MIN = 5;
const SLIDER_MAX = 500;

/**
 * The tools a modifier swaps in for a single stroke (InputShell): Smooth
 * under Shift, Mask under Ctrl, the paint blur under Shift over Paint.
 * Nobody picks one, so none keeps a size of its own. In world scale each
 * draws at the size of the brush in hand, as it did when every brush
 * shared one radius; in screen scale each keeps the vendor's pixel radius,
 * as before.
 */
const STAND_INS: ReadonlySet<number> = new Set([
  Enums.Tools.SMOOTH,
  Enums.Tools.MASKING,
  Enums.Tools.PAINT_BLUR,
]);

export class WorldScaleBrush {
  private on = false;
  /** Fired on user-driven changes, so the autosave learns about them. */
  onChange: (() => void) | null = null;
  /**
   * Each brush's pinned radius in world units, by vendor tool index, and
   * authoritative while `on`. A brush without an entry is on `shared`.
   */
  private readonly worlds = new Map<number, number>();
  /**
   * The radius every brush starts at, until it is given its own: the one
   * radius all of them shared before sizes went per tool, so nothing about
   * a session changes until a brush is sized.
   */
  private shared = 1;
  private readonly tmp = vec3.create();

  constructor(
    private readonly session: SculptSession,
    private readonly camera: PerspectiveCamera,
    /** Distance to fall back on when nothing is under the cursor. */
    private readonly orbitDistance: () => number,
    /** Bounding radius of the subject, so the slider spans sensible sizes. */
    private readonly subjectRadius: () => number,
    /**
     * Whose size is in play: the brush in hand, which is not the tool
     * stroking while a modifier has swapped a stand-in in for it.
     */
    private readonly inHand: () => number,
  ) {}

  isEnabled(): boolean {
    return this.on;
  }

  /**
   * On at mount, every brush on one radius: the starting brush's pixel
   * size at the entry distance. Not setEnabled, which would carry each
   * vendor tool's own starting pixel size over, and those differ (Crease
   * starts at half the others, Move and Drag at three times) where world
   * scale has always started them equal.
   */
  begin(): void {
    const px = this.toolRadius(this.inHand());
    this.shared = this.worldForPixels(px * this.session.getPixelRatio(), this.depth());
    this.worlds.clear();
    this.on = true;
    this.sync();
  }

  /**
   * Turn world scale on or off, keeping every brush the size it looks
   * right now: switching modes should never resize a brush under you.
   */
  setEnabled(on: boolean): void {
    if (on === this.on) return;
    const ratio = this.session.getPixelRatio();
    const depth = this.depth();
    const inHand = this.inHand();
    for (const i of this.brushes()) {
      if (on) this.worlds.set(i, this.worldForPixels(this.toolRadius(i) * ratio, depth));
      // Back in screen scale the brush in hand keeps the pixel radius the
      // eye last saw (its last sync) rather than a stale slider value; the
      // others take what their world radius draws at from here.
      else if (i !== inHand) this.setToolRadius(i, this.pixelsForWorld(this.worldOf(i), depth) / ratio);
    }
    this.on = on;
    this.sync();
    this.onChange?.();
  }

  /**
   * Push the brush in hand's world radius into the tool stroking as the
   * pixel count that draws it at the current depth. Called wherever the
   * brush is about to be used or shown, so every vendor consumer - stroke,
   * spacing, picking - agrees.
   */
  sync(): void {
    if (!this.on) return;
    const px = this.pixelsForWorld(this.worldOf(this.inHand()), this.depth());
    this.setToolRadius(this.session.getSculptManager().getToolIndex(), px / this.session.getPixelRatio());
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
    return Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, this.worldOf(this.inHand()) / this.unit()));
  }

  setSliderValue(v: number): void {
    this.worlds.set(this.inHand(), Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, v)) * this.unit());
    this.sync();
    this.onChange?.();
  }

  /** The brush's current on-screen radius in CSS px, for the cursor ring. */
  screenRadiusCss(): number {
    if (!this.on) return this.toolRadius(this.session.getSculptManager().getToolIndex());
    return this.pixelsForWorld(this.worldOf(this.inHand()), this.depth()) / this.session.getPixelRatio();
  }

  /** The brush in hand's pinned radius in world units (what the strength line is anchored to). */
  worldRadius(): number {
    return this.worldOf(this.inHand());
  }

  /**
   * Restore a persisted state directly: setEnabled derives the world radii
   * from the current pixel sizes, which is right for a live toggle and
   * wrong for a reload, where the saved radius IS the truth. `world` is the
   * one radius a scene from before per-brush sizes carries, and every
   * brush takes it; a newer scene's own sizes follow in loadSizes.
   */
  restore(on: boolean, world?: number): void {
    this.on = on;
    if (on && world && world > 0) {
      this.shared = world;
      this.worlds.clear();
    }
    this.sync();
  }

  /**
   * Every brush's size, for the scene record, in the scale it is set in:
   * world units while world scale is on, screen pixels otherwise. Every
   * brush, sized or not, so the record stands on its own.
   */
  serializeSizes(): Record<number, number> {
    const out: Record<number, number> = {};
    for (const i of this.brushes()) out[i] = this.on ? this.worldOf(i) : this.toolRadius(i);
    return out;
  }

  /**
   * Put a record's sizes back, in the scale restore() just set. Silently,
   * like the other per-brush tables: reading a scene back is not a change
   * to it, and announcing it would schedule an autosave of what was just
   * read. A size for a tool that keeps none (a stand-in, or one retired
   * since) is passed over.
   */
  loadSizes(table: Record<number, number> | undefined): void {
    if (!table) return;
    const brushes = new Set(this.brushes());
    for (const [key, value] of Object.entries(table)) {
      const i = Number(key);
      if (!brushes.has(i) || !(Number.isFinite(value) && value > 0)) continue;
      if (this.on) this.worlds.set(i, value);
      else this.setToolRadius(i, value);
    }
    this.sync();
  }

  /** The tools that keep a size of their own: every one with a radius, bar the stand-ins. */
  private brushes(): number[] {
    const tools = this.session.getSculptManager()._tools;
    const out: number[] = [];
    for (let i = 0; i < tools.length; i++) {
      if (!STAND_INS.has(i) && typeof tools[i]?._radius === 'number') out.push(i);
    }
    return out;
  }

  /** A brush's pinned radius, in world units. */
  private worldOf(tool: number): number {
    return this.worlds.get(tool) ?? this.shared;
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

  private toolRadius(index: number): number {
    const tool = this.session.getSculptManager().getTool(index) as { _radius?: number } | undefined;
    return tool?._radius ?? 50;
  }

  private setToolRadius(index: number, css: number): void {
    const tool = this.session.getSculptManager().getTool(index) as { _radius?: number } | undefined;
    if (tool && tool._radius !== undefined) tool._radius = Math.max(1, css);
  }
}
