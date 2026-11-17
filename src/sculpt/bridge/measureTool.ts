import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { SculptSession } from './SculptSession';
import { toWorld, type Vec3 } from './measure';

/** How near a press must land to an end of the measurement to take it, in CSS px. */
const GRAB_PX = 22;
const GRAB_TOUCH_PX = 34;

/**
 * The Calipers tool's pointer logic (InputShell routes the presses here
 * while the tool is up). A press on the model sets a point, or, near an end
 * of the measurement being made, takes that end; dragging moves the point
 * along the surface. The first press starts a measurement, the second ends
 * it, a third starts another. Nothing here edits a mesh, so there is no
 * stroke and no undo step.
 */
export class MeasureTool {
  private drag: 'a' | 'b' | null = null;

  constructor(private readonly session: SculptSession) {}

  /** Calipers read centimetres: a scene without real units is asked for its scale first. */
  available(): boolean {
    return !!this.session.getUnits();
  }

  /** The end being dragged, for the overlay's highlight. */
  dragging(): 'a' | 'b' | null {
    return this.drag;
  }

  /** A client point to the canvas's device pixels. */
  private device(x: number, y: number): [number, number] {
    const r = this.session.getCanvas().getBoundingClientRect();
    const pr = this.session.getPixelRatio();
    return [(x - r.left) * pr, (y - r.top) * pr];
  }

  /** Where a world point is on the page, in client px, or null behind the camera. */
  screenOf(world: Vec3): [number, number] | null {
    const p = this.session.getCamera().project(world);
    if (!(p[2] >= 0 && p[2] <= 1)) return null;
    const r = this.session.getCanvas().getBoundingClientRect();
    const pr = this.session.getPixelRatio();
    return [r.left + p[0] / pr, r.top + p[1] / pr];
  }

  /** Which end of the measurement being made lies under a client point, or null. */
  endAt(x: number, y: number, touch: boolean): 'a' | 'b' | null {
    const w = this.session.measure.working;
    if (!w || !w.m.b) return null;
    const m = w.mesh.getMatrix();
    let best: 'a' | 'b' | null = null;
    let bestD = touch ? GRAB_TOUCH_PX : GRAB_PX;
    for (const which of ['a', 'b'] as const) {
      const s = this.screenOf(toWorld(m, w.m[which]!));
      if (!s) continue;
      const d = Math.hypot(s[0] - x, s[1] - y);
      if (d <= bestD) {
        bestD = d;
        best = which;
      }
    }
    return best;
  }

  /**
   * A press at a client point. 'drag': it took an end or set a point, and
   * the pointer now carries it. 'miss': nothing here (off the model, or no
   * real units), and the press is the camera's.
   */
  begin(x: number, y: number, touch: boolean): 'drag' | 'miss' {
    if (!this.available()) return 'miss';
    const store = this.session.measure;
    const end = this.endAt(x, y, touch);
    if (end) {
      this.drag = end;
      return 'drag';
    }
    const [dx, dy] = this.device(x, y);
    const hit = this.session.surfaceHitAt(dx, dy);
    if (!hit) return 'miss';
    const w = store.working;
    if (w && !w.m.b && w.mesh === hit.mesh) {
      // The second point.
      store.finish(hit.local);
      this.drag = 'b';
    } else {
      // The first point, of a new measurement (a third press, or another object).
      store.begin(hit.mesh as SculptMesh, hit.local);
      this.drag = 'a';
    }
    return 'drag';
  }

  /** The pointer moved with a point in hand: it follows the surface under it. */
  move(x: number, y: number): void {
    const which = this.drag;
    const w = this.session.measure.working;
    if (!which || !w) return;
    const [dx, dy] = this.device(x, y);
    const hit = this.session.surfaceHitAt(dx, dy);
    // Along the surface of its own object: off it, or over another, it stays where it was.
    if (!hit || hit.mesh !== w.mesh) return;
    this.session.measure.moveEnd(which, hit.local);
  }

  end(): void {
    this.drag = null;
    this.session.measure.notify();
  }
}
