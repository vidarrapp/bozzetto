import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';

/**
 * Calipers (docs/plans/reference-and-measure.md, section 2): distances
 * between two points on an object's surface, in the scene's centimetres.
 * Nothing here touches a mesh or the sculpt history.
 *
 * A point is stored in its OBJECT's local space, so moving, turning or
 * scaling the object keeps the measurement on it, and its length is read
 * through the object's matrix each time it is asked. Each measurement
 * belongs to one object (both points on it), and is saved with that object
 * (SavedMesh.measures).
 *
 * Two kinds: the one being made (`working`, one at a time, never saved, gone
 * when the Calipers tool is left) and the pinned ones (kept, listed in the
 * Model panel's Measure section, saved with the scene).
 */

export type Vec3 = [number, number, number];

export interface Measure {
  id: number;
  name: string;
  /** Local space of the object. */
  a: Vec3;
  /** Null while the second point is still to be set (the working measurement only). */
  b: Vec3 | null;
  /** The mirror across the object's symmetry plane, when asked for. */
  mirror: { a: Vec3; b: Vec3 } | null;
  /** Pinned measurements can be hidden from the view. */
  visible: boolean;
  pinned: boolean;
}

/** What a scene file keeps of a pinned measurement. */
export interface SavedMeasure {
  name: string;
  a: number[];
  b: number[];
  mirror?: { a: number[]; b: number[] };
  visible?: boolean;
}

/** A column-major 4x4, as the meshes keep theirs. */
type Mat4 = ArrayLike<number>;

export function toWorld(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** A length as the calipers say it: centimetres, to one decimal ("12.3 cm"). */
export const lengthText = (cm: number): string => (Number.isFinite(cm) ? `${cm.toFixed(1)} cm` : '–');

export const distance = (p: Vec3, q: Vec3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** The point reflected across the plane through `origin` with unit `normal`. */
export function mirrorAcross(p: Vec3, origin: ArrayLike<number>, normal: ArrayLike<number>): Vec3 {
  const d =
    (p[0] - origin[0]) * normal[0] + (p[1] - origin[1]) * normal[1] + (p[2] - origin[2]) * normal[2];
  return [p[0] - 2 * d * normal[0], p[1] - 2 * d * normal[1], p[2] - 2 * d * normal[2]];
}

/** A length in the object's world: the distance of two local points through its matrix. */
export function lengthIn(m: Mat4, a: Vec3, b: Vec3): number {
  return distance(toWorld(m, a), toWorld(m, b));
}

const NAME = /^Measure (\d+)$/;
/** More than anyone pins; a file's thousands are not measurements. */
const MAX_PER_OBJECT = 200;

const vec3 = (v: unknown): Vec3 | null =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
    ? [v[0], v[1], v[2]]
    : null;

export class Measurements {
  private readonly pinned = new WeakMap<object, Measure[]>();
  private nextId = 1;
  /** The measurement being made, and the object it is on. */
  working: { mesh: SculptMesh; m: Measure } | null = null;
  /** Bumped by every change, so the overlay knows to draw again. */
  version = 0;
  /** A pinned measurement changed: the scene has something new to save. */
  onPersist: (() => void) | null = null;
  /** The panels that show a change (pin, rename, delete, mirror, a point set). */
  private readonly listeners = new Set<() => void>();
  /** A pinned measurement was deleted: its restore, until the next change. */
  lastDeleted: { mesh: SculptMesh; measure: Measure; index: number } | null = null;

  constructor(
    private readonly meshes: () => readonly SculptMesh[],
    /** The symmetry plane of an object, in its local space. */
    private readonly plane: (mesh: SculptMesh) => { origin: ArrayLike<number>; normal: ArrayLike<number> } | null,
  ) {}

  /** Hear of every change; returns the way to stop. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  /** Tell the listeners (a drag ended, and its readout can settle). */
  notify(): void {
    for (const fn of [...this.listeners]) fn();
  }

  private changed(): void {
    this.version++;
    this.notify();
  }

  /** The pinned measurements of an object, in the order they were pinned. */
  list(mesh: SculptMesh | null): Measure[] {
    return mesh ? (this.pinned.get(mesh) ?? []) : [];
  }

  /** Every pinned measurement of a live object, with its object. */
  all(): Array<{ mesh: SculptMesh; measure: Measure }> {
    const out: Array<{ mesh: SculptMesh; measure: Measure }> = [];
    for (const mesh of this.meshes()) for (const measure of this.list(mesh)) out.push({ mesh, measure });
    return out;
  }

  // --- the one being made ------------------------------------------------

  /** A first point: a new measurement on `mesh`, replacing the one before it. */
  begin(mesh: SculptMesh, a: Vec3): Measure {
    const m: Measure = { id: this.nextId++, name: '', a, b: null, mirror: null, visible: true, pinned: false };
    this.working = { mesh, m };
    this.lastDeleted = null;
    this.changed();
    return m;
  }

  /** The second point of the working measurement. */
  finish(b: Vec3): void {
    const w = this.working;
    if (!w) return;
    w.m.b = b;
    if (w.m.mirror) w.m.mirror = this.mirrorOf(w.mesh, w.m);
    this.changed();
  }

  /** One end moved (a drag). */
  moveEnd(which: 'a' | 'b', p: Vec3): void {
    const w = this.working;
    if (!w) return;
    w.m[which] = p;
    if (w.m.mirror && w.m.b) w.m.mirror = this.mirrorOf(w.mesh, w.m);
    this.version++;
    this.notify();
  }

  /** The working measurement goes (the tool is left, a scene replaced). */
  clearWorking(): void {
    if (!this.working) return;
    this.working = null;
    this.changed();
  }

  // --- pinning -----------------------------------------------------------

  /** The highest "Measure N" number handed out, so a renamed or deleted one never has its number reused. */
  private named = 0;

  private nextName(): string {
    for (const { measure } of this.all()) {
      const hit = NAME.exec(measure.name);
      if (hit) this.named = Math.max(this.named, Number(hit[1]));
    }
    return `Measure ${++this.named}`;
  }

  /** Keep the working measurement in the scene; it stays as it is on screen. */
  pinWorking(): Measure | null {
    const w = this.working;
    if (!w || !w.m.b) return null;
    const list = this.pinned.get(w.mesh) ?? [];
    if (list.length >= MAX_PER_OBJECT) return null;
    const m = w.m;
    m.name = this.nextName();
    m.pinned = true;
    list.push(m);
    this.pinned.set(w.mesh, list);
    this.working = null;
    this.lastDeleted = null;
    this.changed();
    this.onPersist?.();
    return m;
  }

  rename(measure: Measure, name: string): void {
    const trimmed = name.trim().slice(0, 200);
    if (!trimmed || trimmed === measure.name) return;
    measure.name = trimmed;
    this.changed();
    this.onPersist?.();
  }

  setVisible(measure: Measure, visible: boolean): void {
    measure.visible = visible;
    this.changed();
    this.onPersist?.();
  }

  /** Delete a pinned measurement. Not part of the sculpt history: restoreDeleted brings the last one back. */
  remove(mesh: SculptMesh, measure: Measure): void {
    const list = this.pinned.get(mesh);
    const i = list ? list.indexOf(measure) : -1;
    if (!list || i < 0) return;
    list.splice(i, 1);
    this.lastDeleted = { mesh, measure, index: i };
    this.changed();
    this.onPersist?.();
  }

  /** The measurement deleted last, back where it was. False when it cannot be (its object is gone). */
  restoreDeleted(): boolean {
    const d = this.lastDeleted;
    if (!d) return false;
    this.lastDeleted = null;
    if (!this.meshes().includes(d.mesh)) {
      this.changed();
      return false;
    }
    const list = this.pinned.get(d.mesh) ?? [];
    list.splice(Math.min(d.index, list.length), 0, d.measure);
    this.pinned.set(d.mesh, list);
    this.changed();
    this.onPersist?.();
    return true;
  }

  // --- the mirror --------------------------------------------------------

  private mirrorOf(mesh: SculptMesh, m: Measure): { a: Vec3; b: Vec3 } | null {
    const plane = this.plane(mesh);
    if (!plane || !m.b) return null;
    return { a: mirrorAcross(m.a, plane.origin, plane.normal), b: mirrorAcross(m.b, plane.origin, plane.normal) };
  }

  /** Add the mirror across the object's symmetry plane to a measurement (it must have both points). */
  addMirror(mesh: SculptMesh, m: Measure): boolean {
    const mirror = this.mirrorOf(mesh, m);
    if (!mirror) return false;
    m.mirror = mirror;
    this.changed();
    if (m.pinned) this.onPersist?.();
    return true;
  }

  removeMirror(m: Measure): void {
    if (!m.mirror) return;
    m.mirror = null;
    this.changed();
    if (m.pinned) this.onPersist?.();
  }

  // --- lengths -----------------------------------------------------------

  /** A measurement's length in the scene's units, the object's scale included. */
  length(mesh: SculptMesh, m: Measure): number | null {
    return m.b ? lengthIn(mesh.getMatrix(), m.a, m.b) : null;
  }

  /** The mirror's length, or null with none. */
  mirrorLength(mesh: SculptMesh, m: Measure): number | null {
    return m.mirror ? lengthIn(mesh.getMatrix(), m.mirror.a, m.mirror.b) : null;
  }

  // --- the scene file ----------------------------------------------------

  /** An object's pinned measurements as a scene file keeps them, or undefined with none. */
  serialize(mesh: SculptMesh): SavedMeasure[] | undefined {
    const list = this.list(mesh);
    if (!list.length) return undefined;
    return list
      .filter((m) => m.b)
      .map((m) => ({
        name: m.name,
        a: [...m.a],
        b: [...m.b!],
        ...(m.mirror ? { mirror: { a: [...m.mirror.a], b: [...m.mirror.b] } } : {}),
        ...(m.visible ? {} : { visible: false }),
      }));
  }

  /** Put an object's saved measurements back, as pinned ones. */
  restore(mesh: SculptMesh, saved: SavedMeasure[] | undefined): void {
    if (!saved?.length) return;
    const list: Measure[] = [];
    for (const s of saved) {
      const a = vec3(s.a);
      const b = vec3(s.b);
      if (!a || !b) continue;
      const mirror = s.mirror ? { a: vec3(s.mirror.a), b: vec3(s.mirror.b) } : null;
      list.push({
        id: this.nextId++,
        name: s.name,
        a,
        b,
        mirror: mirror?.a && mirror.b ? { a: mirror.a, b: mirror.b } : null,
        visible: s.visible !== false,
        pinned: true,
      });
    }
    this.pinned.set(mesh, list);
    this.version++;
  }

  /** A replaced object (remesh, a level change that builds a new one) takes the old one's measurements. */
  transfer(from: SculptMesh, to: SculptMesh): void {
    // The list is shared, not moved: an undo puts the old object back, and
    // its measurements are still on it.
    const list = this.pinned.get(from);
    if (list) this.pinned.set(to, list);
    if (this.working?.mesh === from) this.working.mesh = to;
    this.version++;
  }

  /** The whole scene is replaced (New, Open, a restore): nothing carries over. */
  reset(): void {
    this.working = null;
    this.lastDeleted = null;
    this.named = 0;
    this.changed();
  }
}

/** Sanitise saved measurements from a file: only what is a name and finite numbers survives. */
export function sanitizeMeasures(v: unknown): SavedMeasure[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: SavedMeasure[] = [];
  for (const s of v.slice(0, MAX_PER_OBJECT)) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    const a = vec3(r.a);
    const b = vec3(r.b);
    if (!a || !b) continue;
    const m = r.mirror && typeof r.mirror === 'object' ? (r.mirror as Record<string, unknown>) : null;
    const ma = m ? vec3(m.a) : null;
    const mb = m ? vec3(m.b) : null;
    out.push({
      name: typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 200) : `Measure ${out.length + 1}`,
      a,
      b,
      ...(ma && mb ? { mirror: { a: ma, b: mb } } : {}),
      ...(r.visible === false ? { visible: false } : {}),
    });
  }
  return out.length ? out : undefined;
}
