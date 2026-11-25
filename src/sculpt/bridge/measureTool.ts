import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { SculptSession } from './SculptSession';
import type { BoneTie, Measure, Vec3 } from './measure';

/** How near a press must land to an end of the measurement to take it, in CSS px. */
const GRAB_PX = 22;
const GRAB_TOUCH_PX = 34;

/** A press on the mannequin: the point, the part under it, the point in that part's frame, and how far from the eye. */
export interface MannequinHit {
  world: Vec3;
  tie: BoneTie;
  local: Vec3;
  distance: number;
}

/** A tap this near a pinned caliper's line picks it, in CSS px. */
const PICK_PX = 10;
const PICK_TOUCH_PX = 20;

/** The distance of a point from a segment, in px. */
function segmentDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

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
  /** The mannequin standing in the scene and shown: what a press on it lands on (set by the page). */
  mannequin: { hit(x: number, y: number): MannequinHit | null; eyeAt(): Vec3 } | null = null;

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
    let best: 'a' | 'b' | null = null;
    let bestD = touch ? GRAB_TOUCH_PX : GRAB_PX;
    for (const which of ['a', 'b'] as const) {
      const s = this.screenOf(this.session.measure.pointWorld(w.mesh, w.m, which));
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
    const w = store.working;
    // A pinned caliper's line, with no point waiting for its partner: the tap picks it.
    if (!(w && !w.m.b)) {
      const picked = this.pinnedAt(x, y, touch);
      if (picked) {
        store.select(picked);
        return 'drag';
      }
    }
    const [dx, dy] = this.device(x, y);
    const found = this.session.surfaceHitAt(dx, dy);
    let hit: { mesh: SculptMesh | null; local: Vec3; tie?: BoneTie } | null = found;
    // The mannequin counts as a surface: where it is nearer the eye than the object behind it.
    const man = this.mannequin?.hit(x, y) ?? null;
    if (man && !(found && this.fromEye(found.world) <= man.distance)) hit = { mesh: null, local: man.local, tie: man.tie };
    if (!hit) return 'miss';
    if (w && !w.m.b && w.mesh === hit.mesh) {
      // The second point.
      store.finish(hit.local, hit.tie);
      this.drag = 'b';
    } else {
      // The first point, of a new measurement (a third press, or another object).
      store.begin(hit.mesh, hit.local, hit.tie);
      this.drag = 'a';
    }
    return 'drag';
  }

  private fromEye(p: Vec3): number {
    const eye = this.mannequin?.eyeAt();
    return eye ? Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) : 0;
  }

  /** The visible pinned caliper whose line a client point is on, or null. */
  private pinnedAt(x: number, y: number, touch: boolean): Measure | null {
    const store = this.session.measure;
    let best: Measure | null = null;
    let bestD = touch ? PICK_TOUCH_PX : PICK_PX;
    for (const { mesh, measure } of store.all()) {
      if (!measure.visible || (mesh && !mesh.isVisible()) || !measure.b) continue;
      const a = this.screenOf(store.pointWorld(mesh, measure, 'a'));
      const b = this.screenOf(store.pointWorld(mesh, measure, 'b'));
      if (!a || !b) continue;
      const d = segmentDistance([x, y], a, b);
      if (d <= bestD) {
        bestD = d;
        best = measure;
      }
    }
    return best;
  }

  /** The pointer moved with a point in hand: it follows the surface under it. */
  move(x: number, y: number): void {
    const which = this.drag;
    const w = this.session.measure.working;
    if (!which || !w) return;
    if (!w.mesh) {
      // On the mannequin: along its surface, the end tied to the part it is over now.
      const man = this.mannequin?.hit(x, y);
      if (man) this.session.measure.moveEnd(which, man.local, man.tie);
      return;
    }
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
