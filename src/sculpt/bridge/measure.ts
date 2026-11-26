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
 * A caliper can instead sit on the armature's mannequin (owner null): each
 * end is tied to the part it was placed on and kept in that part's frame, so
 * it follows the pose. An end whose figure is replaced or turned into a
 * figure stays where it last was in the world, untied.
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
  /** On the mannequin: the part each end is tied to; that end's point is then in the part's frame, otherwise in the world. */
  ties?: { a?: BoneTie; b?: BoneTie };
  /** Which figure the ties are to (adopted by the first one that fits, after a reload). */
  token?: object;
  /** Where the ends last were in the world, for a tied end while its figure is not there to say. */
  world?: { a: Vec3; b: Vec3 };
}

/** A part of the mannequin: the bone's name, and the rig it is of. */
export interface BoneTie {
  bone: string;
  rig: string;
}

/** The mannequin's parts as the calipers ask of them. */
export interface BoneFrames {
  /** The figure itself: another figure is another token. */
  token: object;
  rig: string;
  hasBone(bone: string): boolean;
  /** A point in a part's frame, in the world as the figure is posed now. */
  toWorld(bone: string, p: Vec3): Vec3;
}

/** Where the mannequin is: its frames, 'gone' once a figure was made from it, null while it has not been loaded. */
export type FramesState = BoneFrames | 'gone' | null;

/** What a scene file keeps of a pinned measurement. */
export interface SavedMeasure {
  name: string;
  a: number[];
  b: number[];
  mirror?: { a: number[]; b: number[] };
  visible?: boolean;
  /** A caliper on the mannequin: the ties of its ends, and where they last stood in the world. */
  ties?: { a?: BoneTie; b?: BoneTie };
  world?: { a: number[]; b: number[] };
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


const TRI_INDEX = 4294967295;

/** The point on triangle (a, b, c) nearest p (Ericson, Real-Time Collision Detection). */
function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const sub = (u: Vec3, v: Vec3): Vec3 => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: Vec3, v: Vec3): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const at = (o: Vec3, d: Vec3, t: number): Vec3 => [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return at(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const denom = 1 / (va + vb + vc);
  return at(at(a, ab, vb * denom), ac, vc * denom);
}

/** The nearest point on a mesh's surface (its local space) to a local point. Brute force: called once a change has settled. */
export function nearestOnSurface(mesh: SculptMesh, p: Vec3): Vec3 {
  const v = mesh.getVertices();
  const f = mesh.getFaces();
  const nf = mesh.getNbFaces();
  const P = (i: number): Vec3 => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
  let best = p;
  let bestD = Infinity;
  const tri = (i: number, j: number, k: number): void => {
    const q = closestOnTriangle(p, P(i), P(j), P(k));
    const d = distance(p, q);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  };
  for (let i = 0; i < nf; i++) {
    const a = f[i * 4];
    const b = f[i * 4 + 1];
    const c = f[i * 4 + 2];
    const d = f[i * 4 + 3];
    tri(a, b, c);
    if (d !== TRI_INDEX && d !== undefined) tri(a, c, d);
  }
  return best;
}

/** A cheap fingerprint of a mesh's vertices: its counts and a spread of sampled coordinates. */
function meshStamp(mesh: SculptMesh): string {
  const v = mesh.getVertices();
  const n = mesh.getNbVertices();
  let h = 0;
  const step = Math.max(1, Math.floor(n / 48));
  for (let i = 0; i < n; i += step) h += v[i * 3] * 1.3 + v[i * 3 + 1] * 2.9 + v[i * 3 + 2] * 5.3;
  return `${n}:${mesh.getNbFaces()}:${h.toFixed(5)}`;
}

const NAME = /^(?:Measure|Caliper) (\d+)$/;
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
  working: { mesh: SculptMesh | null; m: Measure } | null = null;
  /** The pinned calipers on the mannequin (they have no object). */
  private readonly armature: Measure[] = [];
  /** Where the mannequin is, set by the page. */
  frames: (() => FramesState) | null = null;
  /** The pinned caliper picked in the Scene panel or the view: Delete takes it, its row and its line are marked. */
  selected: Measure | null = null;
  /** The sculpt history, to put a pin, a delete, a rename or an eye in as one step (set by the session). */
  history: ((undo: () => void, redo: () => void) => void) | null = null;
  /** Bumped by every change, so the overlay knows to draw again. */
  version = 0;
  /** A pinned measurement changed: the scene has something new to save. */
  onPersist: (() => void) | null = null;
  /** The panels that show a change (pin, rename, delete, mirror, a point set). */
  private readonly listeners = new Set<() => void>();

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

  /** Every pinned measurement of a live object, with its object (null: on the mannequin). */
  all(): Array<{ mesh: SculptMesh | null; measure: Measure }> {
    const out: Array<{ mesh: SculptMesh | null; measure: Measure }> = [];
    for (const mesh of this.meshes()) for (const measure of this.list(mesh)) out.push({ mesh, measure });
    for (const measure of this.armature) out.push({ mesh: null, measure });
    return out;
  }

  private listOf(owner: SculptMesh | null): Measure[] {
    return owner ? (this.pinned.get(owner) ?? []) : this.armature;
  }

  /** The object a pinned measurement is on (null: the mannequin), or undefined when it is not pinned. */
  ownerOf(m: Measure): SculptMesh | null | undefined {
    return this.all().find((e) => e.measure === m)?.mesh;
  }

  /** One undo step for a change to the pinned calipers; each side repeats the change and tells the panels. */
  private step(undo: () => void, redo: () => void): void {
    const wrap = (f: () => void) => (): void => {
      f();
      this.changed();
      this.onPersist?.();
    };
    this.history?.(wrap(undo), wrap(redo));
  }

  private insert(owner: SculptMesh | null, m: Measure, index: number): void {
    if (owner && !this.meshes().includes(owner)) return;
    const list = this.listOf(owner);
    if (list.includes(m)) return;
    list.splice(Math.min(index, list.length), 0, m);
    if (owner) this.pinned.set(owner, list);
  }

  private take(owner: SculptMesh | null, m: Measure): number {
    const list = this.listOf(owner);
    const i = list.indexOf(m);
    if (i >= 0) list.splice(i, 1);
    if (this.selected === m) this.selected = null;
    return i;
  }

  /** Pick a pinned measurement (or none). */
  select(m: Measure | null): void {
    if (this.selected === m) return;
    this.selected = m;
    this.changed();
  }

  // --- the one being made ------------------------------------------------

  /** A first point: a new measurement on `mesh`, replacing the one before it. */
  begin(mesh: SculptMesh | null, a: Vec3, tie?: BoneTie): Measure {
    const m: Measure = { id: this.nextId++, name: '', a, b: null, mirror: null, visible: true, pinned: false };
    if (tie) m.ties = { a: tie };
    this.working = { mesh, m };
    this.selected = null;
    this.changed();
    return m;
  }

  /** The second point of the working measurement. */
  finish(b: Vec3, tie?: BoneTie): void {
    const w = this.working;
    if (!w) return;
    w.m.b = b;
    if (tie) w.m.ties = { ...w.m.ties, b: tie };
    if (w.m.mirror) w.m.mirror = this.mirrorOf(w.mesh, w.m);
    this.changed();
  }

  /** One end moved (a drag). */
  moveEnd(which: 'a' | 'b', p: Vec3, tie?: BoneTie): void {
    const w = this.working;
    if (!w) return;
    w.m[which] = p;
    if (tie && w.m.ties) w.m.ties[which] = tie;
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
    return `Caliper ${++this.named}`;
  }

  /** Keep the working measurement in the scene; it stays as it is on screen. */
  pinWorking(): Measure | null {
    const w = this.working;
    if (!w || !w.m.b) return null;
    const owner = w.mesh;
    const list = this.listOf(owner);
    if (list.length >= MAX_PER_OBJECT) return null;
    const m = w.m;
    m.name = this.nextName();
    m.pinned = true;
    this.cacheWorld(m);
    this.insert(owner, m, list.length);
    this.working = null;
    this.changed();
    this.onPersist?.();
    const at = this.listOf(owner).length - 1;
    this.step(
      () => void this.take(owner, m),
      () => this.insert(owner, m, at),
    );
    return m;
  }

  rename(measure: Measure, name: string): void {
    const trimmed = name.trim().slice(0, 200);
    const was = measure.name;
    if (!trimmed || trimmed === was) return;
    measure.name = trimmed;
    this.changed();
    this.onPersist?.();
    this.step(
      () => void (measure.name = was),
      () => void (measure.name = trimmed),
    );
  }

  setVisible(measure: Measure, visible: boolean): void {
    if (measure.visible === visible) return;
    measure.visible = visible;
    this.changed();
    this.onPersist?.();
    this.step(
      () => void (measure.visible = !visible),
      () => void (measure.visible = visible),
    );
  }

  /** Delete a pinned measurement: an undo step. */
  remove(owner: SculptMesh | null, measure: Measure): void {
    const i = this.take(owner, measure);
    if (i < 0) return;
    this.changed();
    this.onPersist?.();
    this.step(
      () => this.insert(owner, measure, i),
      () => void this.take(owner, measure),
    );
  }

  /** Delete the picked measurement (Delete or Backspace). False with none picked. */
  removeSelected(): boolean {
    const m = this.selected;
    const owner = m ? this.ownerOf(m) : undefined;
    if (!m || owner === undefined) return false;
    this.remove(owner, m);
    return true;
  }

  // --- the mirror --------------------------------------------------------

  private mirrorOf(mesh: SculptMesh | null, m: Measure): { a: Vec3; b: Vec3 } | null {
    const plane = mesh ? this.plane(mesh) : null;
    if (!plane || !m.b) return null;
    return { a: mirrorAcross(m.a, plane.origin, plane.normal), b: mirrorAcross(m.b, plane.origin, plane.normal) };
  }

  /** Add the mirror across the object's symmetry plane to a measurement (it must have both points). */
  addMirror(mesh: SculptMesh | null, m: Measure): boolean {
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


  // --- the mesh changed under a pinned point ---------------------------------

  private readonly stamps = new WeakMap<object, { seen: string; snapped: string; still: number }>();

  /**
   * Called every frame by the overlay. When an object's vertices change
   * (sculpting, remesh, subdivide) the pinned points keep their stored
   * local positions and are drawn there; once the mesh has been still for
   * a few frames they are re-snapped to the nearest point of the surface,
   * so a point never throws or vanishes and ends up on the new surface.
   */
  settle(mesh: SculptMesh): void {
    const list = this.pinned.get(mesh);
    const w = this.working?.mesh === mesh ? this.working.m : null;
    if (!list?.length && !w) return;
    const now = meshStamp(mesh);
    const st = this.stamps.get(mesh);
    if (!st) {
      this.stamps.set(mesh, { seen: now, snapped: now, still: 0 });
      return;
    }
    if (st.seen !== now) {
      st.seen = now;
      st.still = 0;
      return;
    }
    if (st.snapped === now || ++st.still < 8) return;
    st.snapped = now;
    const snap = (p: Vec3): Vec3 => nearestOnSurface(mesh, p);
    for (const m of [...(list ?? []), ...(w ? [w] : [])]) {
      m.a = snap(m.a);
      if (m.b) m.b = snap(m.b);
      if (m.mirror) m.mirror = { a: snap(m.mirror.a), b: snap(m.mirror.b) };
    }
    this.changed();
    if (list?.length) this.onPersist?.();
  }

  // --- lengths -----------------------------------------------------------

  /** An end in the world: through its object's matrix, or where its part of the mannequin has it now. */
  pointWorld(owner: SculptMesh | null, m: Measure, which: 'a' | 'b'): Vec3 {
    const p = m[which]!;
    if (owner) return toWorld(owner.getMatrix(), p);
    const tie = m.ties?.[which];
    if (!tie) return p;
    const f = this.frames?.();
    if (f && f !== 'gone' && this.fits(m, tie, f)) return f.toWorld(tie.bone, p);
    return m.world?.[which] ?? p;
  }

  private fits(m: Measure, tie: BoneTie, f: BoneFrames): boolean {
    return f.rig === tie.rig && f.hasBone(tie.bone) && (m.token === undefined || m.token === f.token);
  }

  private cacheWorld(m: Measure): void {
    if (!m.ties || !m.b) return;
    m.world = { a: this.pointWorld(null, m, 'a'), b: this.pointWorld(null, m, 'b') };
  }

  /**
   * Called every frame by the overlay. Keeps where the tied ends stand in the world, takes the
   * first figure that fits as the one a reloaded caliper was on, and lets go of the ties of a
   * figure that was replaced or made into an object: those ends stay where they were.
   */
  settleArmature(): void {
    const f = this.frames?.() ?? null;
    let froze = false;
    for (const m of [...this.armature, ...(this.working && !this.working.mesh ? [this.working.m] : [])]) {
      if (!m.ties) continue;
      for (const which of ['a', 'b'] as const) {
        const tie = m.ties[which];
        if (!tie || !m[which]) continue;
        if (f && f !== 'gone' && this.fits(m, tie, f)) {
          m.token ??= f.token;
          continue;
        }
        // A figure that is not loaded yet (a reload) may still come; anything else has gone.
        if (f === null) continue;
        m[which] = this.pointWorld(null, m, which);
        delete m.ties[which];
        froze = true;
      }
      if (m.ties && !m.ties.a && !m.ties.b) delete m.ties;
      if (m.ties && m.b) this.cacheWorld(m);
    }
    if (froze) {
      this.changed();
      this.onPersist?.();
    }
  }

  /** A measurement's length in the scene's units, the object's scale included. */
  length(owner: SculptMesh | null, m: Measure): number | null {
    return m.b ? distance(this.pointWorld(owner, m, 'a'), this.pointWorld(owner, m, 'b')) : null;
  }

  /** The mirror's length, or null with none. */
  mirrorLength(mesh: SculptMesh | null, m: Measure): number | null {
    return m.mirror && mesh ? lengthIn(mesh.getMatrix(), m.mirror.a, m.mirror.b) : null;
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

  /** The pinned calipers on the mannequin as a scene file keeps them, or undefined with none. */
  serializeArmature(): SavedMeasure[] | undefined {
    if (!this.armature.length) return undefined;
    return this.armature
      .filter((m) => m.b)
      .map((m) => ({
        name: m.name,
        a: [...m.a],
        b: [...m.b!],
        ...(m.visible ? {} : { visible: false }),
        ...(m.ties ? { ties: { ...m.ties } } : {}),
        ...(m.ties && m.world ? { world: { a: [...m.world.a], b: [...m.world.b] } } : {}),
      }));
  }

  private revive(s: SavedMeasure, withTies: boolean): Measure | null {
    const a = vec3(s.a);
    const b = vec3(s.b);
    if (!a || !b) return null;
    const mirror = s.mirror ? { a: vec3(s.mirror.a), b: vec3(s.mirror.b) } : null;
    const world = s.world ? { a: vec3(s.world.a), b: vec3(s.world.b) } : null;
    return {
      id: this.nextId++,
      name: s.name,
      a,
      b,
      mirror: mirror?.a && mirror.b ? { a: mirror.a, b: mirror.b } : null,
      visible: s.visible !== false,
      pinned: true,
      ...(withTies && s.ties && world?.a && world.b ? { ties: s.ties, world: { a: world.a, b: world.b } } : {}),
    };
  }

  /** Put an object's saved measurements back (null: the mannequin's), as pinned ones. */
  restore(mesh: SculptMesh | null, saved: SavedMeasure[] | undefined): void {
    if (!saved?.length) return;
    const list: Measure[] = [];
    for (const s of saved) {
      const m = this.revive(s, mesh === null);
      if (m) list.push(m);
    }
    if (mesh) this.pinned.set(mesh, list);
    else this.armature.splice(0, this.armature.length, ...list);
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
    this.selected = null;
    this.armature.length = 0;
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
    const ties = cleanTies(r.ties);
    const wr = r.world && typeof r.world === 'object' ? (r.world as Record<string, unknown>) : null;
    const wa = wr ? vec3(wr.a) : null;
    const wb = wr ? vec3(wr.b) : null;
    out.push({
      name: typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 200) : `Caliper ${out.length + 1}`,
      a,
      b,
      ...(ma && mb ? { mirror: { a: ma, b: mb } } : {}),
      ...(r.visible === false ? { visible: false } : {}),
      ...(ties && wa && wb ? { ties, world: { a: wa, b: wb } } : {}),
    });
  }
  return out.length ? out : undefined;
}

const cleanTie = (v: unknown): BoneTie | undefined => {
  const r = v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  return r && typeof r.bone === 'string' && typeof r.rig === 'string' && r.bone && r.rig
    ? { bone: r.bone.slice(0, 80), rig: r.rig.slice(0, 80) }
    : undefined;
};

function cleanTies(v: unknown): { a?: BoneTie; b?: BoneTie } | undefined {
  const r = v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  if (!r) return undefined;
  const a = cleanTie(r.a);
  const b = cleanTie(r.b);
  return a || b ? { ...(a ? { a } : {}), ...(b ? { b } : {}) } : undefined;
}
