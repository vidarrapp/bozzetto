import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { mat4 } from 'gl-matrix';
import Enums from '@sculpt-vendor/misc/Enums';
import { LAYERS_V, MAX_LAYERS, MAX_LAYER_NAME, WEIGHT_LIMIT } from './layersRecord';

export { MAX_LAYERS, MAX_LAYER_NAME, WEIGHT_LIMIT };

/**
 * Sculpt layers (owner request, 2026-11-17). A layer holds what was sculpted
 * on it as a displacement of the surface, shown at a weight of its own: 100%
 * by default, free to go past it or below zero by typing.
 *
 * Where the data lives (owner call): on the object's HIGHEST level only, one
 * object-space delta a vertex of that level (dense in memory, allocated on
 * the layer's first change; sparse in a record). The person sculpts with a
 * layer active on any level, and steps up and down freely, so nothing is
 * refused for the level; the only refusal is a hidden layer or one at 0%.
 *
 * How a stroke reaches the layer (no hook per stroke): the active layer is
 * the implicit receiver of every change to the surface. The object keeps a
 * reference copy of its highest level's positions (`ref`), taken when the
 * layer became active or was last synced. A SYNC reads the highest level as
 * it is now (work done on a lower level reaches it by the vendor's own
 * synthesis, `viewTop`), adds `(now - ref) / weight` to the active layer's
 * delta and takes `now` as the new reference. Nothing is done per dab or at
 * a stroke's end, so a stroke costs what it always did, and an undo or redo
 * of strokes needs no hook either: the next sync reads whatever the
 * geometry has become.
 *
 * Syncs happen before anything that needs true layer data or could muddle
 * which layer a change belongs to: changing the active layer, a weight or
 * visibility change, delete, duplicate, flatten, save, subdivide, delete
 * highest, and the questions before a remesh. Switching the active layer and
 * changing a weight are undo steps of their own which sync first, so
 * undoing back past a switch puts the earlier active layer back before the
 * strokes it took are undone.
 *
 * Moving between levels. A read of the highest level from a lower one is
 * synthesis only (higherLevel, then the selection pointer put back): the
 * level on screen is not touched, no analysis runs, no undo state is made.
 * A weight change is the one thing that carries down: `v += (new - applied)
 * * delta` on the highest level, then the vendor's analysis down to the
 * level on screen, as a person stepping down would.
 *
 * What the mesh holds. Its highest level is the base plus every layer's
 * `applied * delta` (applied is the weight, or 0 while hidden); the levels
 * under it follow by the vendor's moves.
 *
 * Memory. A delta is 12 bytes a vertex of the highest level and the
 * reference copy is another 12 while a layer is active: ten layers on a
 * million vertices are 120 MB, +12 MB. Records on disk are sparse.
 */

/** A weight closer to zero than this is 0%: there is nothing to attribute a change to. */
const WEIGHT_EPS = 1e-3;
/** A change smaller than this share of the object's extent is arithmetic noise, not sculpting. */
const NOISE = 2e-7;

export interface SculptLayer {
  /** Unique within the session. */
  id: number;
  name: string;
  /** 1 is 100%. May be negative or past 1. */
  weight: number;
  visible: boolean;
  /** Object-space displacement a vertex of the highest level, at weight 1; null until the layer takes a change. */
  delta: Float32Array | null;
  /** What the mesh holds of this layer now: `weight` while shown, else 0. */
  applied: number;
}

/** A layer as a scene record keeps it (SavedMesh.layers). */
export interface SavedLayer {
  name: string;
  weight: number;
  visible: boolean;
  /** The highest-level vertices the layer moved, and by how much each (three a vertex, at weight 1). Absent for an empty layer. */
  ids?: Uint32Array;
  vals?: Float32Array;
}

export interface SavedLayers {
  v: 1;
  /** Index into `items` of the active layer, or -1 for Base. */
  active: number;
  /** Oldest first. */
  items: SavedLayer[];
}

/** What a layer-aware stroke asks, before it starts. */
export interface LayerRefusal {
  kind: 'hidden';
  name: string;
}

/** The vendored stack, as far as layers need it. */
interface Stack extends SculptMesh {
  _meshes: Array<SculptMesh & { _detailsXYZ?: Float32Array | null }>;
  _sel: number;
  selectResolution(sel: number): void;
  higherLevel(): SculptMesh;
  setSelection(sel: number): void;
  updateResolution(): void;
}

interface Manager {
  pushStateCustom(undocb: () => void, redocb?: () => void, squash?: boolean): void;
  getCurrentState(): unknown;
}

/** What the layers need of the session that owns them. */
export interface LayerHost {
  getStateManager(): Manager;
  getMeshes(): SculptMesh[];
  getMesh(): SculptMesh | null;
  setMesh(mesh: SculptMesh | null): unknown;
  render(): void;
}

interface PerMesh {
  /** Oldest first. */
  list: SculptLayer[];
  /** The layer changes are attributed to; null is Base. */
  active: SculptLayer | null;
  /** The highest level's positions as of the last sync, while a layer is active. */
  ref: Float32Array | null;
}

const stackOf = (mesh: SculptMesh): Stack | null => (mesh._meshes ? (mesh as unknown as Stack) : null);

let nextId = 1;

export class SculptLayers {
  private readonly per = new WeakMap<SculptMesh, PerMesh>();
  /** A weight drag in progress: where it began, so the release is one undo step. */
  private drag: { mesh: SculptMesh; layer: SculptLayer; weight: number; visible: boolean } | null = null;

  /** Anything about the layers changed (list, active, weight, an undo): the panel and the autosave follow. */
  onChange: (() => void) | null = null;
  /** A stroke was refused (before it started): the shell says why. */
  onRefuse: ((mesh: SculptMesh, why: LayerRefusal) => void) | null = null;

  constructor(private readonly host: LayerHost) {}

  private get sm(): Manager {
    return this.host.getStateManager();
  }

  private changed(): void {
    this.onChange?.();
  }

  // --- reading -------------------------------------------------------------

  /** The object's layers, newest first (the list's order). */
  list(mesh: SculptMesh | null): SculptLayer[] {
    const p = mesh ? this.per.get(mesh) : undefined;
    return p ? [...p.list].reverse() : [];
  }

  count(mesh: SculptMesh | null): number {
    return (mesh ? this.per.get(mesh)?.list.length : 0) ?? 0;
  }

  has(mesh: SculptMesh | null): boolean {
    return this.count(mesh) > 0;
  }

  active(mesh: SculptMesh | null): SculptLayer | null {
    return (mesh ? this.per.get(mesh)?.active : null) ?? null;
  }

  /** Whether layers can be made on this object (dynamic topology has none). */
  allowed(mesh: SculptMesh | null): boolean {
    return !!mesh && !mesh.isDynamic;
  }

  private ensure(mesh: SculptMesh): PerMesh {
    let p = this.per.get(mesh);
    if (!p) this.per.set(mesh, (p = { list: [], active: null, ref: null }));
    return p;
  }

  private uniqueName(p: PerMesh, base: string): string {
    const taken = new Set(p.list.map((l) => l.name));
    if (!taken.has(base)) return base;
    for (let k = 2; ; k++) if (!taken.has(`${base} ${k}`)) return `${base} ${k}`;
  }

  // --- the highest level ---------------------------------------------------

  /**
   * Run `fn` with the highest level's live positions, WITHOUT disturbing the
   * level on screen: from a lower level the vendor's synthesis carries it up
   * (higherLevel), and the selection pointer is put back after, with no
   * analysis, so the level on screen keeps exactly what it had. False when
   * a level above has no detail yet (it was never stepped from), where there
   * is nothing to read.
   */
  private viewTop(mesh: SculptMesh, fn: (v: Float32Array, n: number) => void): boolean {
    const st = stackOf(mesh);
    if (!st) {
      fn(mesh.getVertices(), mesh.getNbVertices());
      return true;
    }
    const cur = st._sel;
    const top = st._meshes.length - 1;
    if (cur === top) {
      fn(mesh.getVertices(), mesh.getNbVertices());
      return true;
    }
    for (let k = cur + 1; k <= top; k++) if (!st._meshes[k]._detailsXYZ) return false;
    // Synthesis applies the details in the frame of the upper level's normals as they stood at its
    // last visit, and a visit refreshes them: put them back, so a read leaves the next step up as
    // it would have been had nobody looked.
    const normals = st._meshes.slice(cur + 1).map((m) => new Float32Array(m.getNormals()));
    try {
      for (let k = cur; k < top; k++) st.higherLevel();
      fn(mesh.getVertices(), mesh.getNbVertices());
    } finally {
      st.setSelection(cur);
      st.updateResolution();
      st._meshes.slice(cur + 1).forEach((m, i) => m.getNormals().set(normals[i]));
    }
    return true;
  }

  /** Run `fn` on the highest level and carry what it did down to the level on screen (analysis, as stepping down does). */
  private atTop(mesh: SculptMesh, fn: (v: Float32Array, n: number) => void): void {
    const st = stackOf(mesh);
    const cur = st?._sel ?? 0;
    const top = st ? st._meshes.length - 1 : 0;
    if (st && cur !== top) st.selectResolution(top);
    try {
      fn(mesh.getVertices(), mesh.getNbVertices());
    } finally {
      if (st && st._sel !== cur) st.selectResolution(cur);
    }
  }

  /** Take the reference copy, for a layer that has just become active (or after anything that moved the surface for its own reasons). */
  arm(mesh: SculptMesh): void {
    const p = this.per.get(mesh);
    if (!p) return;
    if (!p.active) {
      p.ref = null;
      return;
    }
    this.viewTop(mesh, (v, n) => {
      p.ref = new Float32Array(v.subarray(0, n * 3));
    });
  }

  /**
   * Give the active layer what changed on the surface since the last sync.
   * One pass over the highest level; nothing is done when the layer is
   * hidden or at 0% (such a change belongs to the base), and the reference
   * is refreshed either way.
   */
  sync(mesh: SculptMesh | null): void {
    const p = mesh ? this.per.get(mesh) : undefined;
    if (!mesh || !p || !p.active) return;
    if (!p.ref) {
      this.arm(mesh);
      return;
    }
    this.viewTop(mesh, (v, n) => this.attribute(p, v, n));
  }

  private attribute(p: PerMesh, v: Float32Array, n: number): void {
    const layer = p.active;
    const ref = p.ref;
    if (!layer || !ref) return;
    if (ref.length !== n * 3 || (layer.delta && layer.delta.length !== n * 3)) {
      // The surface was rebuilt under it (a level added or taken away by history): start over from here.
      p.ref = new Float32Array(v.subarray(0, n * 3));
      return;
    }
    const w = layer.applied;
    if (Math.abs(w) >= WEIGHT_EPS) {
      let extent = 0;
      for (let i = 0; i < n * 3; i++) {
        const a = Math.abs(ref[i]);
        if (a > extent) extent = a;
      }
      const tol = Math.max(extent, 1e-3) * NOISE;
      const inv = 1 / w;
      let d: Float32Array | null = layer.delta;
      for (let i = 0; i < n * 3; i += 3) {
        const dx = v[i] - ref[i];
        const dy = v[i + 1] - ref[i + 1];
        const dz = v[i + 2] - ref[i + 2];
        if (Math.abs(dx) <= tol && Math.abs(dy) <= tol && Math.abs(dz) <= tol) continue;
        if (!d) d = layer.delta = new Float32Array(n * 3);
        d[i] += dx * inv;
        d[i + 1] += dy * inv;
        d[i + 2] += dz * inv;
      }
    }
    ref.set(v.subarray(0, n * 3));
  }

  // --- the stroke ----------------------------------------------------------

  /**
   * Whether a stroke on `mesh` with `tool` must not start, and why: the
   * active layer is hidden or at 0%. (Never the level: a layer takes a
   * stroke on whichever level is on screen.) Tools that move no vertices
   * (mask, paint) are never refused. Also where a layer that has no
   * reference yet (a scene just opened) takes its one, before the stroke.
   */
  refusal(mesh: SculptMesh | null, tool: number): LayerRefusal | null {
    if (!mesh || mesh.isDynamic) return null;
    const t = Enums.Tools;
    if (tool === t.MASKING || tool === t.PAINT || tool === t.PAINT_BLUR || tool === t.TRANSFORM) return null;
    const layer = this.active(mesh);
    if (!layer) return null;
    if (!layer.visible || Math.abs(layer.applied) < WEIGHT_EPS) return { kind: 'hidden', name: layer.name };
    if (!this.per.get(mesh)!.ref) this.arm(mesh);
    return null;
  }

  /** Says the refusal aloud (the shell shows it) and returns true when there is one. */
  refuse(mesh: SculptMesh | null, tool: number): boolean {
    const why = this.refusal(mesh, tool);
    if (!why || !mesh) return false;
    this.onRefuse?.(mesh, why);
    return true;
  }

  // --- moving the surface --------------------------------------------------

  /**
   * Move the mesh so the layer's part of it is `target` (times its delta)
   * instead of what it was, on the highest level, carried down to the level
   * on screen. The caller has synced. The reference follows the move.
   */
  private shift(mesh: SculptMesh, layer: SculptLayer, target: number): void {
    const f = target - layer.applied;
    layer.applied = target;
    const d = layer.delta;
    if (f === 0 || !d) return;
    const p = this.per.get(mesh);
    this.atTop(mesh, (v, n) => {
      const ref = p?.active && p.ref && p.ref.length === n * 3 ? p.ref : null;
      const m = Math.min(n, d.length / 3);
      const ids: number[] = [];
      for (let i = 0; i < m; i++) {
        const j = i * 3;
        const x = d[j];
        const y = d[j + 1];
        const z = d[j + 2];
        if (x === 0 && y === 0 && z === 0) continue;
        v[j] += f * x;
        v[j + 1] += f * y;
        v[j + 2] += f * z;
        if (ref) {
          ref[j] = v[j];
          ref[j + 1] = v[j + 1];
          ref[j + 2] = v[j + 2];
        }
        ids.push(i);
      }
      if (!ids.length) return;
      if (ids.length > n * 0.3) {
        mesh.updateGeometry();
      } else {
        const touched = Uint32Array.from(ids);
        mesh.updateGeometry(mesh.getFacesFromVertices(touched), touched);
      }
      mesh.updateGeometryBuffers();
    });
    this.host.render();
  }

  // --- commands ------------------------------------------------------------

  private push(undo: () => void, redo: () => void, squash = false): void {
    this.sm.pushStateCustom(
      () => {
        undo();
        this.changed();
      },
      () => {
        redo();
        this.changed();
      },
      squash,
    );
  }

  /**
   * The layer the person works on: null for Base. An undo step of its own,
   * which syncs first, so undoing back past a switch restores the earlier
   * active layer before the strokes it took are undone.
   */
  setActive(mesh: SculptMesh, layer: SculptLayer | null): void {
    const p = this.per.get(mesh);
    if (!p) return;
    const want = layer && p.list.includes(layer) ? layer : null;
    if (p.active === want) return;
    const prior = p.active;
    const set = (to: SculptLayer | null): void => {
      this.sync(mesh);
      p.active = to && p.list.includes(to) ? to : null;
      this.arm(mesh);
    };
    set(want);
    this.push(
      () => set(prior),
      () => set(want),
    );
    this.changed();
  }

  /** A new empty layer at 100%, which becomes the active one. Null when none can be made. */
  add(mesh: SculptMesh, name?: string): SculptLayer | null {
    if (!this.allowed(mesh)) return null;
    const p = this.ensure(mesh);
    if (p.list.length >= MAX_LAYERS) return null;
    this.sync(mesh);
    const layer: SculptLayer = {
      id: nextId++,
      name: this.uniqueName(p, (name ?? `Layer ${p.list.length + 1}`).slice(0, MAX_LAYER_NAME)),
      weight: 1,
      visible: true,
      delta: null,
      applied: 1,
    };
    const prior = p.active;
    p.list.push(layer);
    p.active = layer;
    this.arm(mesh);
    this.push(
      () => {
        this.sync(mesh);
        p.list.splice(p.list.indexOf(layer), 1);
        p.active = prior && p.list.includes(prior) ? prior : null;
        this.arm(mesh);
      },
      () => {
        this.sync(mesh);
        p.list.push(layer);
        p.active = layer;
        this.arm(mesh);
      },
    );
    this.changed();
    return layer;
  }

  /** Renaming is not an edit of the surface and keeps no undo entry (as renaming an object does not). */
  rename(layer: SculptLayer, name: string): void {
    const text = name.trim().slice(0, MAX_LAYER_NAME);
    if (!text || text === layer.name) return;
    layer.name = text;
    this.changed();
  }

  /**
   * Set a layer's weight (1 is 100%). `live` while a slider is dragged: shown
   * at once where the highest level is on screen, else on the release. The
   * release (`commit`) is one undo step for the whole drag.
   */
  setWeight(mesh: SculptMesh, layer: SculptLayer, weight: number, phase: 'live' | 'commit'): void {
    if (!Number.isFinite(weight)) return;
    const w = Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, weight));
    if (!this.drag || this.drag.layer !== layer) {
      this.sync(mesh); // what was sculpted so far is the active layer's, at the weight it had
      this.drag = { mesh, layer, weight: layer.weight, visible: layer.visible };
    }
    layer.weight = w;
    const target = layer.visible ? w : 0;
    const st = stackOf(mesh);
    if (phase === 'live' && st && st._sel !== st._meshes.length - 1) return;
    this.shift(mesh, layer, target);
    if (phase === 'live') return;
    const from = this.drag;
    this.drag = null;
    if (from.weight === w && from.visible === layer.visible) return;
    this.pushWeightState(mesh, layer, { weight: from.weight, visible: from.visible }, { weight: w, visible: layer.visible });
    this.changed();
  }

  /** Show or hide a layer: its weight is kept, its effect leaves the surface or comes back. */
  setVisible(mesh: SculptMesh, layer: SculptLayer, visible: boolean): void {
    if (layer.visible === visible) return;
    this.sync(mesh);
    const from = { weight: layer.weight, visible: layer.visible };
    layer.visible = visible;
    this.shift(mesh, layer, visible ? layer.weight : 0);
    this.pushWeightState(mesh, layer, from, { weight: layer.weight, visible });
    this.changed();
  }

  private pushWeightState(
    mesh: SculptMesh,
    layer: SculptLayer,
    from: { weight: number; visible: boolean },
    to: { weight: number; visible: boolean },
  ): void {
    const set = (s: { weight: number; visible: boolean }): void => {
      this.sync(mesh);
      layer.weight = s.weight;
      layer.visible = s.visible;
      this.shift(mesh, layer, s.visible ? s.weight : 0);
      this.host.setMesh(mesh);
    };
    this.push(
      () => set(from),
      () => set(to),
    );
  }

  /** A copy of a layer, above it, at the same weight, so its effect adds to the original's. */
  duplicate(mesh: SculptMesh, layer: SculptLayer): SculptLayer | null {
    const p = this.per.get(mesh);
    if (!p || p.list.length >= MAX_LAYERS) return null;
    const at = p.list.indexOf(layer);
    if (at < 0) return null;
    this.sync(mesh);
    const copy: SculptLayer = {
      ...layer,
      id: nextId++,
      name: this.uniqueName(p, `${layer.name} copy`.slice(0, MAX_LAYER_NAME)),
      delta: layer.delta ? new Float32Array(layer.delta) : null,
      applied: 0,
    };
    const prior = p.active;
    p.list.splice(at + 1, 0, copy);
    p.active = copy;
    this.arm(mesh);
    this.shift(mesh, copy, copy.visible ? copy.weight : 0);
    this.push(
      () => {
        this.sync(mesh);
        this.shift(mesh, copy, 0);
        p.list.splice(p.list.indexOf(copy), 1);
        p.active = prior && p.list.includes(prior) ? prior : null;
        this.arm(mesh);
        this.host.setMesh(mesh);
      },
      () => {
        this.sync(mesh);
        p.list.splice(Math.min(at + 1, p.list.length), 0, copy);
        p.active = copy;
        this.arm(mesh);
        this.shift(mesh, copy, copy.visible ? copy.weight : 0);
        this.host.setMesh(mesh);
      },
    );
    this.changed();
    return copy;
  }

  /** The layer becomes part of the surface and goes from the list. */
  flatten(mesh: SculptMesh, layer: SculptLayer): void {
    const p = this.per.get(mesh);
    if (!p) return;
    const at = p.list.indexOf(layer);
    if (at < 0) return;
    this.sync(mesh);
    const prior = p.active;
    p.list.splice(at, 1);
    if (p.active === layer) p.active = null;
    this.arm(mesh);
    this.push(
      () => {
        this.sync(mesh);
        p.list.splice(Math.min(at, p.list.length), 0, layer);
        p.active = prior && p.list.includes(prior) ? prior : null;
        this.arm(mesh);
      },
      () => {
        this.sync(mesh);
        p.list.splice(p.list.indexOf(layer), 1);
        if (p.active === layer) p.active = null;
        this.arm(mesh);
      },
    );
    this.changed();
  }

  /** Delete takes the layer's effect off the surface with it. */
  remove(mesh: SculptMesh, layer: SculptLayer): void {
    const p = this.per.get(mesh);
    if (!p) return;
    const at = p.list.indexOf(layer);
    if (at < 0) return;
    this.sync(mesh);
    const prior = p.active;
    const a = layer.applied;
    this.shift(mesh, layer, 0);
    p.list.splice(at, 1);
    if (p.active === layer) p.active = null;
    this.arm(mesh);
    this.push(
      () => {
        this.sync(mesh);
        p.list.splice(Math.min(at, p.list.length), 0, layer);
        p.active = prior && p.list.includes(prior) ? prior : null;
        this.arm(mesh);
        this.shift(mesh, layer, a);
        this.host.setMesh(mesh);
      },
      () => {
        this.sync(mesh);
        this.shift(mesh, layer, 0);
        p.list.splice(p.list.indexOf(layer), 1);
        if (p.active === layer) p.active = null;
        this.arm(mesh);
        this.host.setMesh(mesh);
      },
    );
    this.changed();
  }

  /**
   * Every layer of the object becomes part of the surface, in one undo
   * step. `squash` joins the step to the one before it. Returns the undo
   * state it pushed, or null.
   */
  flattenAll(mesh: SculptMesh, squash = false): unknown {
    const p = this.per.get(mesh);
    if (!p || !p.list.length) return null;
    this.sync(mesh);
    const list = [...p.list];
    const prior = p.active;
    p.list = [];
    p.active = null;
    p.ref = null;
    this.push(
      () => {
        this.sync(mesh);
        p.list = [...list];
        p.active = prior;
        this.arm(mesh);
      },
      () => {
        this.sync(mesh);
        p.list = [];
        p.active = null;
        p.ref = null;
      },
      squash,
    );
    this.changed();
    return this.sm.getCurrentState();
  }

  /** The objects among `meshes` that have layers. */
  withLayers(meshes: SculptMesh[]): SculptMesh[] {
    return meshes.filter((m) => this.has(m));
  }

  /**
   * An operation that rebuilds the surface (remesh, merge, split, dynamic
   * topology) cannot keep per-vertex layers: they are flattened first, in
   * an undo step the operation's own then joins (`join`).
   */
  flattenForOp(meshes: SculptMesh[]): unknown {
    let last: unknown = null;
    for (const m of this.withLayers(meshes)) last = this.flattenAll(m) ?? last;
    return last;
  }

  /** The operation pushed its state: it and the flatten before it are one undo step. */
  join(flatState: unknown): void {
    if (!flatState) return;
    const cur = this.sm.getCurrentState() as { squash?: boolean } | undefined;
    if (cur && cur !== flatState) cur.squash = true;
  }

  // --- a level added or taken away ----------------------------------------

  /** Every delta of the object, with a way to put them back. */
  private deltas(p: PerMesh): Array<[SculptLayer, Float32Array | null]> {
    return p.list.map((l) => [l, l.delta]);
  }

  /**
   * A level was added on top (Subdivide; the caller synced before). Each
   * layer's delta is rebuilt for it: subdivision is linear in the
   * positions, so the new delta is the subdivision of the old delta field
   * (what the new level has with the layer, less what it has without), and
   * the slider keeps working exactly. Undoable with the subdivision.
   */
  topAdded(mesh: SculptMesh): void {
    const p = this.per.get(mesh);
    const st = stackOf(mesh);
    if (!p || !st) return;
    const before = this.deltas(p);
    const lower = st._meshes[st._meshes.length - 2] as unknown as {
      getMeshData(): { _verticesXYZ: Float32Array };
      computePartialSubdivision(v: Float32Array, c: Float32Array, m: Float32Array, nbUp: number): void;
    };
    const n = mesh.getNbVertices();
    const after: Array<[SculptLayer, Float32Array | null]> = before.map(([l, d]) => {
      if (!d) return [l, null];
      const out = new Float32Array(n * 3);
      const md = lower.getMeshData();
      const own = md._verticesXYZ;
      md._verticesXYZ = d;
      try {
        lower.computePartialSubdivision(out, new Float32Array(n * 3), new Float32Array(n * 3), n);
      } finally {
        md._verticesXYZ = own;
      }
      return [l, out];
    });
    for (const [l, d] of after) l.delta = d;
    p.ref = null;
    this.arm(mesh);
    this.push(
      () => {
        for (const [l, d] of before) l.delta = d;
        p.ref = null;
      },
      () => {
        for (const [l, d] of after) l.delta = d;
        p.ref = null;
      },
      true,
    );
    this.changed();
  }

  /**
   * The highest level was deleted (the caller synced before it, and the
   * selection is on the new highest one): each delta is carried down to it
   * by the same map that copies a level's vertices down, so its slider
   * still moves what the level kept; the detail only the deleted level had
   * goes with it. Undoable with the deletion.
   */
  topDeleted(mesh: SculptMesh): void {
    const p = this.per.get(mesh);
    const st = stackOf(mesh);
    if (!p || !st) return;
    const before = this.deltas(p);
    const down = st._meshes[st._meshes.length - 1] as unknown as {
      getEvenMapping(): boolean;
      getVerticesMapping(): Uint32Array | null;
    };
    const n = mesh.getNbVertices();
    const map = down.getEvenMapping() ? down.getVerticesMapping() : null;
    const after: Array<[SculptLayer, Float32Array | null]> = before.map(([l, d]) => {
      if (!d) return [l, null];
      const out = new Float32Array(n * 3);
      if (!map) {
        out.set(d.subarray(0, n * 3));
      } else {
        for (let i = 0; i < n; i++) {
          const j = map[i] * 3;
          out[i * 3] = d[j];
          out[i * 3 + 1] = d[j + 1];
          out[i * 3 + 2] = d[j + 2];
        }
      }
      return [l, out];
    });
    for (const [l, d] of after) l.delta = d;
    p.ref = null;
    this.arm(mesh);
    this.push(
      () => {
        for (const [l, d] of before) l.delta = d;
        p.ref = null;
      },
      () => {
        for (const [l, d] of after) l.delta = d;
        p.ref = null;
      },
      true,
    );
    this.changed();
  }

  /** An affine map of the object's local space (Set scale): the deltas go through its linear part; the reference is taken again. */
  mapLinear(mesh: SculptMesh, a: mat4): void {
    const p = this.per.get(mesh);
    if (!p) return;
    for (const l of p.list) {
      const d = l.delta;
      if (!d) continue;
      for (let i = 0; i < d.length; i += 3) {
        const x = d[i];
        const y = d[i + 1];
        const z = d[i + 2];
        d[i] = a[0] * x + a[4] * y + a[8] * z;
        d[i + 1] = a[1] * x + a[5] * y + a[9] * z;
        d[i + 2] = a[2] * x + a[6] * y + a[10] * z;
      }
    }
    p.ref = null;
  }

  // --- records -------------------------------------------------------------

  serialize(mesh: SculptMesh): SavedLayers | undefined {
    const p = this.per.get(mesh);
    if (!p || !p.list.length) return undefined;
    this.sync(mesh);
    const items = p.list.map((l): SavedLayer => {
      const out: SavedLayer = { name: l.name, weight: l.weight, visible: l.visible };
      const d = l.delta;
      if (d) {
        let n = 0;
        for (let i = 0; i < d.length; i += 3) if (d[i] !== 0 || d[i + 1] !== 0 || d[i + 2] !== 0) n++;
        if (n) {
          const ids = new Uint32Array(n);
          const vals = new Float32Array(n * 3);
          let k = 0;
          for (let i = 0; i < d.length; i += 3) {
            if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) continue;
            ids[k] = i / 3;
            vals[k * 3] = d[i];
            vals[k * 3 + 1] = d[i + 1];
            vals[k * 3 + 2] = d[i + 2];
            k++;
          }
          out.ids = ids;
          out.vals = vals;
        }
      }
      return out;
    });
    return { v: LAYERS_V, active: p.active ? p.list.indexOf(p.active) : -1, items };
  }

  /** Bring a (sanitized) record's layers back on `mesh`, whose vertices already carry their effect. `topVertices`: the highest level's count. */
  restore(mesh: SculptMesh, saved: SavedLayers, topVertices: number): void {
    const list: SculptLayer[] = saved.items.map((s) => {
      let delta: Float32Array | null = null;
      if (s.ids && s.vals && s.ids.length) {
        delta = new Float32Array(topVertices * 3);
        for (let i = 0; i < s.ids.length; i++) {
          const j = s.ids[i] * 3;
          const k = i * 3;
          delta[j] = s.vals[k];
          delta[j + 1] = s.vals[k + 1];
          delta[j + 2] = s.vals[k + 2];
        }
      }
      return { id: nextId++, name: s.name, weight: s.weight, visible: s.visible, delta, applied: s.visible ? s.weight : 0 };
    });
    this.per.set(mesh, { list, active: list[saved.active] ?? null, ref: null });
    this.changed();
  }
}
