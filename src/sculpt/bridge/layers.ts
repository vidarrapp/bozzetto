import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { mat4 } from 'gl-matrix';
import Enums from '@sculpt-vendor/misc/Enums';
import { LAYERS_V, MAX_LAYERS, MAX_LAYER_NAME, WEIGHT_LIMIT } from './layersRecord';
import { indexIn, membersOf, moveItem, topLevel, type TreeItem } from '../../ui/layerTree';

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

export interface SculptLayer extends TreeItem<SculptLayer> {
  /** Unique within the session. */
  id: number;
  name: string;
  /** A layer holds displacements; a group holds layers and has a weight and an eye of its own, which multiply theirs. */
  kind: 'layer' | 'group';
  /** The group it is in; null in the stack itself. */
  parent: SculptLayer | null;
  /** 1 is 100%. May be negative or past 1. */
  weight: number;
  visible: boolean;
  /** Object-space displacement a vertex of the highest level, at weight 1; null until the layer takes a change (always null for a group). */
  delta: Float32Array | null;
  /** What the mesh holds of this layer's weight now: its weight times its group's while both are shown, else 0. */
  applied: number;
  /** A mask, a byte a vertex of the highest level: 255 where the layer has its effect, 0 where the working mask protected. */
  mask: Uint8Array | null;
  maskOn: boolean;
  /** A group is open in the list. */
  open: boolean;
}

/** A layer as a scene record keeps it (SavedMesh.layers). */
export interface SavedLayer {
  name: string;
  /** Absent in a version 1 record: a layer. */
  kind?: 'layer' | 'group';
  /** Index into `items` of the group it is in, or -1. */
  parent?: number;
  /** A mask as runs over the highest level's vertices: a value, and how many in a row. */
  maskVals?: Uint8Array;
  maskLens?: Uint32Array;
  maskOn?: boolean;
  open?: boolean;
  weight: number;
  visible: boolean;
  /** The highest-level vertices the layer moved, and by how much each (three a vertex, at weight 1). Absent for an empty layer. */
  ids?: Uint32Array;
  vals?: Float32Array;
}

export interface SavedLayers {
  v: 1 | 2;
  /** Index into `items` of the active layer, or -1 for Base. */
  active: number;
  /** Oldest first. */
  items: SavedLayer[];
}

/** What a layer-aware stroke asks, before it starts. */
export interface LayerRefusal {
  kind: 'hidden' | 'group';
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

/**
 * What a layer does to the surface now: its weight times its group's (0 while
 * it or its group is hidden), and the masks that scale it by vertex.
 * Displacement at a vertex is `w * a[i] * b[i] * delta[i]`.
 */
interface Eff {
  w: number;
  a: Uint8Array | null;
  b: Uint8Array | null;
}

const ZERO: Eff = { w: 0, a: null, b: null };

function effOf(l: SculptLayer): Eff {
  const g = l.parent;
  const shown = l.visible && (!g || g.visible);
  return {
    w: shown ? l.weight * (g ? g.weight : 1) : 0,
    a: l.mask && l.maskOn ? l.mask : null,
    b: g && g.mask && g.maskOn ? g.mask : null,
  };
}

const coef = (e: Eff, i: number): number => e.w * (e.a ? e.a[i] / 255 : 1) * (e.b ? e.b[i] / 255 : 1);

/** The structure of the stack and what every layer does, at a moment: what an undo step puts back. */
interface Snap {
  list: SculptLayer[];
  active: SculptLayer | null;
  props: Array<{
    l: SculptLayer;
    name: string;
    weight: number;
    visible: boolean;
    kind: SculptLayer['kind'];
    parent: SculptLayer | null;
    mask: Uint8Array | null;
    maskOn: boolean;
    open: boolean;
  }>;
  eff: Map<SculptLayer, Eff>;
}

export class SculptLayers {
  private readonly per = new WeakMap<SculptMesh, PerMesh>();
  /** A weight drag in progress: where it began, so the release is one undo step. */
  private drag: { mesh: SculptMesh; layer: SculptLayer; before: Snap; shown: Map<SculptLayer, Eff> } | null = null;

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
  private viewTop(mesh: SculptMesh, fn: (v: Float32Array, n: number, m: Float32Array) => void): boolean {
    const st = stackOf(mesh);
    if (!st) {
      fn(mesh.getVertices(), mesh.getNbVertices(), mesh.getMaterials());
      return true;
    }
    const cur = st._sel;
    const top = st._meshes.length - 1;
    if (cur === top) {
      fn(mesh.getVertices(), mesh.getNbVertices(), mesh.getMaterials());
      return true;
    }
    for (let k = cur + 1; k <= top; k++) if (!st._meshes[k]._detailsXYZ) return false;
    // Synthesis applies the details in the frame of the upper level's normals as they stood at its
    // last visit, and a visit refreshes them: put them back, so a read leaves the next step up as
    // it would have been had nobody looked.
    const normals = st._meshes.slice(cur + 1).map((m) => new Float32Array(m.getNormals()));
    try {
      for (let k = cur; k < top; k++) st.higherLevel();
      fn(mesh.getVertices(), mesh.getNbVertices(), mesh.getMaterials());
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
    const st = stackOf(mesh);
    const onTop = !st || st._sel === st._meshes.length - 1;
    const reverted: number[] = [];
    this.viewTop(mesh, (v, n) => this.attribute(p, v, n, onTop ? reverted : null));
    if (reverted.length) {
      // Where the layer's mask says it has no effect, a stroke is put back: the work cannot show there.
      const ids = Uint32Array.from(reverted);
      mesh.updateGeometry(mesh.getFacesFromVertices(ids), ids);
      mesh.updateGeometryBuffers();
      this.host.render();
    }
  }

  /** Whether the active layer (or its group) has a mask on: its strokes are synced as they end, so the mask limits them at once. */
  activeMasked(mesh: SculptMesh | null): boolean {
    const l = this.active(mesh);
    return !!l && l.kind === 'layer' && ((!!l.mask && l.maskOn) || (!!l.parent?.mask && l.parent.maskOn));
  }

  private attribute(p: PerMesh, v: Float32Array, n: number, reverted: number[] | null): void {
    const layer = p.active;
    const ref = p.ref;
    if (!layer || !ref) return;
    if (ref.length !== n * 3 || (layer.delta && layer.delta.length !== n * 3)) {
      // The surface was rebuilt under it (a level added or taken away by history): start over from here.
      p.ref = new Float32Array(v.subarray(0, n * 3));
      return;
    }
    const e = effOf(layer);
    const w = layer.kind === 'layer' ? layer.applied : 0;
    if (Math.abs(w) >= WEIGHT_EPS) {
      let extent = 0;
      for (let i = 0; i < n * 3; i++) {
        const a = Math.abs(ref[i]);
        if (a > extent) extent = a;
      }
      const tol = Math.max(extent, 1e-3) * NOISE;
      let d: Float32Array | null = layer.delta;
      for (let i = 0; i < n * 3; i += 3) {
        const dx = v[i] - ref[i];
        const dy = v[i + 1] - ref[i + 1];
        const dz = v[i + 2] - ref[i + 2];
        if (Math.abs(dx) <= tol && Math.abs(dy) <= tol && Math.abs(dz) <= tol) continue;
        // What the masks let the layer show here: the change is divided by it, so that shown, it is the stroke.
        const f = (e.a ? e.a[i / 3] / 255 : 1) * (e.b ? e.b[i / 3] / 255 : 1);
        if (f <= 0) {
          if (reverted) {
            v[i] = ref[i];
            v[i + 1] = ref[i + 1];
            v[i + 2] = ref[i + 2];
            reverted.push(i / 3);
          }
          continue;
        }
        const inv = 1 / (w * f);
        if (!d) d = layer.delta = new Float32Array(n * 3);
        d[i] += dx * inv;
        d[i + 1] += dy * inv;
        d[i + 2] += dz * inv;
      }
    }
    ref.set(v.subarray(0, n * 3));
  }

  /** The active layer's strokes are brought into it at once, where a mask must limit them (called as a stroke ends). */
  syncIfMasked(mesh: SculptMesh | null): void {
    if (this.activeMasked(mesh)) this.sync(mesh);
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
    if (
      tool === t.MASKING || tool === t.PAINT || tool === t.PAINT_BLUR || tool === t.TRANSFORM ||
      tool === t.PAINT_ERASE || tool === t.BLUR || tool === t.FILL || tool === t.PICK || tool === t.PROJECT
    ) {
      return null;
    }
    const layer = this.active(mesh);
    if (!layer) return null;
    if (layer.kind === 'group') return { kind: 'group', name: layer.name };
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
   * Move the mesh so the layer's part of it is `to` instead of `from`: a
   * vertex goes by `(coef(to) - coef(from)) * delta`, on the highest level,
   * carried down to the level on screen. The caller has synced. The reference
   * follows the move.
   */
  private displace(mesh: SculptMesh, layer: SculptLayer, from: Eff, to: Eff): void {
    const d = layer.delta;
    if (!d || layer.kind !== 'layer') return;
    if (from.w === to.w && from.a === to.a && from.b === to.b) return;
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
        const f = coef(to, i) - coef(from, i);
        if (f === 0) continue;
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

  /** What every layer of the object does now. */
  private effs(p: PerMesh): Map<SculptLayer, Eff> {
    const out = new Map<SculptLayer, Eff>();
    for (const l of p.list) if (l.kind === 'layer') out.set(l, effOf(l));
    return out;
  }

  /** Take the surface from what the layers did to what they do: every layer moves by the difference. */
  private transition(mesh: SculptMesh, from: Map<SculptLayer, Eff>, to: Map<SculptLayer, Eff>): void {
    const all = new Set<SculptLayer>([...from.keys(), ...to.keys()]);
    for (const l of all) this.displace(mesh, l, from.get(l) ?? ZERO, to.get(l) ?? ZERO);
  }

  /** `applied` is each layer's effective weight, which sync divides a stroke by. */
  private settle(p: PerMesh): void {
    for (const l of p.list) l.applied = effOf(l).w;
  }

  // A layer's delta is NOT in a snapshot: sync adds to it in place as strokes arrive, so a reference taken
  // then and put back later would carry strokes that history has undone or not yet redone.
  private snapshot(p: PerMesh): Snap {
    return {
      list: [...p.list],
      active: p.active,
      props: p.list.map((l) => ({ l, name: l.name, weight: l.weight, visible: l.visible, kind: l.kind, parent: l.parent, mask: l.mask, maskOn: l.maskOn, open: l.open })),
      eff: this.effs(p),
    };
  }

  private unsnap(p: PerMesh, s: Snap): void {
    p.list = [...s.list];
    p.active = s.active;
    for (const x of s.props) {
      x.l.name = x.name;
      x.l.weight = x.weight;
      x.l.visible = x.visible;
      x.l.kind = x.kind;
      x.l.parent = x.parent;
      x.l.mask = x.mask;
      x.l.maskOn = x.maskOn;
      x.l.open = x.open;
    }
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

  /** An operation as an undo step: the surface goes from `before` to `after`, the structure with it; undo and redo do the same the other way. */
  private pushPair(mesh: SculptMesh, p: PerMesh, before: Snap, after: Snap): void {
    const go = (from: Snap, to: Snap): void => {
      this.sync(mesh);
      this.transition(mesh, from.eff, to.eff);
      this.unsnap(p, to);
      this.settle(p);
      this.arm(mesh);
      this.host.setMesh(mesh);
    };
    this.push(
      () => go(after, before),
      () => go(before, after),
    );
  }

  /**
   * Change the stack and the surface as one undo step: syncs first, takes a
   * snapshot, lets `mutate` change the structure, and moves the surface by
   * what each layer now does. `keep` are layers that leave the stack with
   * their effect staying on the surface (flatten).
   */
  private run(mesh: SculptMesh, mutate: (p: PerMesh) => void, keep: SculptLayer[] = []): boolean {
    const p = this.per.get(mesh);
    if (!p) return false;
    this.sync(mesh);
    const before = this.snapshot(p);
    mutate(p);
    const after = this.snapshot(p);
    for (const l of keep) {
      const e = before.eff.get(l);
      if (e) after.eff.set(l, e);
    }
    this.transition(mesh, before.eff, after.eff);
    this.settle(p);
    this.arm(mesh);
    this.pushPair(mesh, p, before, after);
    this.changed();
    return true;
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

  private fresh(p: PerMesh, kind: SculptLayer['kind'], base: string): SculptLayer {
    return {
      id: nextId++,
      name: this.uniqueName(p, base.slice(0, MAX_LAYER_NAME)),
      kind,
      parent: null,
      weight: 1,
      visible: true,
      delta: null,
      applied: 1,
      mask: null,
      maskOn: true,
      open: true,
    };
  }

  /** Put a new item above the active one: at the top of the group when one is picked, in the active layer's group, or in the stack. */
  private place(p: PerMesh, item: SculptLayer): void {
    const ref = p.active;
    let parent: SculptLayer | null = null;
    let index = topLevel(p.list).length;
    if (ref) {
      if (item.kind === 'group') {
        index = indexIn(p.list, ref.parent ?? ref) + 1;
      } else if (ref.kind === 'group') {
        parent = ref;
        index = membersOf(p.list, ref).length;
      } else {
        parent = ref.parent;
        index = indexIn(p.list, ref) + 1;
      }
    }
    p.list = moveItem(p.list, item, parent, index);
    p.active = item;
  }

  /** A new empty layer at 100%, which becomes the active one. Null when none can be made. */
  add(mesh: SculptMesh, name?: string): SculptLayer | null {
    return this.addKind(mesh, 'layer', name);
  }

  /** An empty group, which becomes the active entry. */
  addGroup(mesh: SculptMesh, name?: string): SculptLayer | null {
    return this.addKind(mesh, 'group', name);
  }

  private addKind(mesh: SculptMesh, kind: SculptLayer['kind'], name?: string): SculptLayer | null {
    if (!this.allowed(mesh)) return null;
    const p = this.ensure(mesh);
    if (p.list.length >= MAX_LAYERS) return null;
    const layer = this.fresh(p, kind, name ?? `${kind === 'group' ? 'Group' : 'Layer'} ${p.list.filter((l) => l.kind === kind).length + 1}`);
    this.run(mesh, (q) => this.place(q, layer));
    return layer;
  }

  /** Renaming is not an edit of the surface and keeps no undo entry (as renaming an object does not). */
  rename(layer: SculptLayer, name: string): void {
    const text = name.trim().slice(0, MAX_LAYER_NAME);
    if (!text || text === layer.name) return;
    layer.name = text;
    this.changed();
  }

  /** Fold or open a group in the list. Not an undo step. */
  setOpen(layer: SculptLayer, open: boolean): void {
    if (layer.open === open) return;
    layer.open = open;
    this.changed();
  }

  /**
   * Set a layer's or a group's weight (1 is 100%). `live` while a slider is
   * dragged: shown at once where the highest level is on screen, else on the
   * release. The release (`commit`) is one undo step for the whole drag. A
   * group's weight multiplies its layers'.
   */
  setWeight(mesh: SculptMesh, layer: SculptLayer, weight: number, phase: 'live' | 'commit'): void {
    if (!Number.isFinite(weight)) return;
    const p = this.per.get(mesh);
    if (!p || !p.list.includes(layer)) return;
    const w = Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, weight));
    if (!this.drag || this.drag.layer !== layer) {
      this.sync(mesh); // what was sculpted so far is the active layer's, at the weight it had
      const before = this.snapshot(p);
      this.drag = { mesh, layer, before, shown: before.eff };
    }
    layer.weight = w;
    const st = stackOf(mesh);
    if (phase === 'live' && st && st._sel !== st._meshes.length - 1) return;
    const now = this.effs(p);
    this.transition(mesh, this.drag.shown, now);
    this.drag.shown = now;
    this.settle(p);
    if (phase === 'live') return;
    const from = this.drag.before;
    this.drag = null;
    const was = from.props.find((x) => x.l === layer);
    if (was && was.weight === w) return;
    this.pushPair(mesh, p, from, this.snapshot(p));
    this.changed();
  }

  /** Show or hide a layer or a group: its weight is kept, its effect leaves the surface or comes back. */
  setVisible(mesh: SculptMesh, layer: SculptLayer, visible: boolean): void {
    if (layer.visible === visible) return;
    this.run(mesh, () => (layer.visible = visible));
  }

  /**
   * Put a layer (or a group) in a container (a group, or null for the stack)
   * at an index counted from the bottom of it. A group cannot go into a group.
   * Order does not change what the surface shows; grouping does through the
   * group's weight and mask.
   */
  move(mesh: SculptMesh, layer: SculptLayer, parent: SculptLayer | null, index: number): void {
    const p = this.per.get(mesh);
    if (!p || !p.list.includes(layer)) return;
    if (parent && (parent.kind !== 'group' || layer.kind === 'group' || !p.list.includes(parent))) return;
    this.run(mesh, (q) => {
      q.list = moveItem(q.list, layer, parent, index);
      if (parent) parent.open = true;
    });
  }

  /** The list as the model has it: oldest first, a group's layers after it. */
  rawList(mesh: SculptMesh | null): SculptLayer[] {
    return (mesh ? this.per.get(mesh)?.list : null) ?? [];
  }

  /** A group of its own around a layer, in the layer's place. */
  group(mesh: SculptMesh, layer: SculptLayer): SculptLayer | null {
    const p = this.per.get(mesh);
    if (!p || layer.kind === 'group' || layer.parent || p.list.length >= MAX_LAYERS) return null;
    const g = this.fresh(p, 'group', 'Group');
    this.run(mesh, (q) => {
      const at = indexIn(q.list, layer);
      q.list = moveItem(q.list, g, null, at + 1);
      q.list = moveItem(q.list, layer, g, 0);
      q.active = layer;
    });
    return g;
  }

  /**
   * Take the layers out of a group and delete the group. The group's weight,
   * eye and mask are multiplied into the layers', so the surface does not move.
   */
  ungroup(mesh: SculptMesh, group: SculptLayer): void {
    const p = this.per.get(mesh);
    if (!p || group.kind !== 'group') return;
    this.run(mesh, (q) => {
      const members = membersOf(q.list, group);
      let at = indexIn(q.list, group);
      for (const m of members) {
        m.weight *= group.weight;
        m.visible = m.visible && group.visible;
        if (group.mask && group.maskOn) {
          const out = new Uint8Array(group.mask.length);
          for (let i = 0; i < out.length; i++) out[i] = Math.round(((m.mask && m.maskOn ? m.mask[i] : 255) * group.mask[i]) / 255);
          m.mask = out;
          m.maskOn = true;
        }
        q.list = moveItem(q.list, m, null, ++at);
      }
      q.list = q.list.filter((x) => x !== group);
      if (q.active === group) q.active = members[members.length - 1] ?? null;
    });
  }

  /** A copy of a layer, above it, at the same weight, so its effect adds to the original's; a group copies with its layers. */
  duplicate(mesh: SculptMesh, layer: SculptLayer): SculptLayer | null {
    const p = this.per.get(mesh);
    if (!p || !p.list.includes(layer)) return null;
    if (p.list.length + 1 + (layer.kind === 'group' ? membersOf(p.list, layer).length : 0) > MAX_LAYERS) return null;
    const copyOf = (l: SculptLayer, parent: SculptLayer | null): SculptLayer => ({
      ...l,
      id: nextId++,
      name: this.uniqueName(p, `${l.name} copy`.slice(0, MAX_LAYER_NAME)),
      parent,
      delta: l.delta ? new Float32Array(l.delta) : null,
      mask: l.mask ? new Uint8Array(l.mask) : null,
      applied: 0,
    });
    const copy = copyOf(layer, null);
    this.run(mesh, (q) => {
      q.list = moveItem(q.list, copy, layer.parent, indexIn(q.list, layer) + 1);
      if (layer.kind === 'group') {
        let k = 0;
        for (const m of membersOf(q.list, layer)) q.list = moveItem(q.list, copyOf(m, copy), copy, k++);
      }
      q.active = copy;
    });
    return copy;
  }

  /** The layer becomes part of the surface and goes from the list; a group flattens all its layers. */
  flatten(mesh: SculptMesh, layer: SculptLayer): void {
    const p = this.per.get(mesh);
    if (!p || !p.list.includes(layer)) return;
    const gone = new Set<SculptLayer>([layer, ...(layer.kind === 'group' ? membersOf(p.list, layer) : [])]);
    this.run(
      mesh,
      (q) => {
        q.list = q.list.filter((x) => !gone.has(x));
        if (q.active && gone.has(q.active)) q.active = null;
      },
      [...gone],
    );
  }

  /** How many entries deleting this deletes (a group takes its layers with it). */
  weightOf(mesh: SculptMesh, layer: SculptLayer): number {
    const p = this.per.get(mesh);
    return p && layer.kind === 'group' ? 1 + membersOf(p.list, layer).length : 1;
  }

  /** Delete takes the layer's effect off the surface with it; a group takes its layers. */
  remove(mesh: SculptMesh, layer: SculptLayer): void {
    const p = this.per.get(mesh);
    if (!p || !p.list.includes(layer)) return;
    const gone = new Set<SculptLayer>([layer, ...(layer.kind === 'group' ? membersOf(p.list, layer) : [])]);
    this.run(mesh, (q) => {
      q.list = q.list.filter((x) => !gone.has(x));
      if (q.active && gone.has(q.active)) q.active = null;
    });
  }

  // --- masks -------------------------------------------------------------------

  /** The object's working mask as a byte a vertex of the highest level: 255 where it is clear, 0 where masked. */
  private workingMask(mesh: SculptMesh): Uint8Array | null {
    let out: Uint8Array | null = null;
    this.viewTop(mesh, (_v, n, m) => {
      const o = new Uint8Array(n);
      for (let i = 0; i < n; i++) o[i] = Math.max(0, Math.min(255, Math.round(m[i * 3 + 2] * 255)));
      out = o;
    });
    return out;
  }

  /** "Add mask from the current mask" (and Replace): the object's working mask is stored on the layer or group. */
  maskFromWorking(mesh: SculptMesh, layer: SculptLayer): void {
    const m = this.workingMask(mesh);
    if (!m || !this.per.get(mesh)?.list.includes(layer)) return;
    this.run(mesh, () => {
      layer.mask = m;
      layer.maskOn = true;
    });
  }

  invertMask(mesh: SculptMesh, layer: SculptLayer): void {
    const m = layer.mask;
    if (!m) return;
    this.run(mesh, () => (layer.mask = m.map((v) => 255 - v)));
  }

  setMaskOn(mesh: SculptMesh, layer: SculptLayer, on: boolean): void {
    if (!layer.mask || layer.maskOn === on) return;
    this.run(mesh, () => (layer.maskOn = on));
  }

  removeMask(mesh: SculptMesh, layer: SculptLayer): void {
    if (!layer.mask) return;
    this.run(mesh, () => {
      layer.mask = null;
      layer.maskOn = true;
    });
  }

  /** The level on screen's vertices by their place on the highest level; null when it is the highest. */
  private lineageMap(mesh: SculptMesh): Uint32Array | null {
    const st = stackOf(mesh);
    if (!st) return null;
    const cur = st._sel;
    const top = st._meshes.length - 1;
    if (cur === top) return null;
    const n = st._meshes[cur].getNbVertices();
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    for (let k = cur; k < top; k++) {
      const m = st._meshes[k] as unknown as { getEvenMapping(): boolean; getVerticesMapping(): Uint32Array | null };
      if (!m.getEvenMapping()) continue;
      const map = m.getVerticesMapping();
      if (map) for (let i = 0; i < n; i++) idx[i] = map[idx[i]];
    }
    return idx;
  }

  /** Told when the working mask was written, so the masking tool redraws it (set by the session). */
  afterMaskLoad: ((mesh: SculptMesh) => void) | null = null;

  /** "Load mask": the layer's mask becomes the object's working mask again (one undo step, which gives the old working mask back). */
  loadMask(mesh: SculptMesh, layer: SculptLayer): void {
    const src = layer.mask;
    if (!src) return;
    const n = mesh.getNbVertices();
    const map = this.lineageMap(mesh);
    const was = new Float32Array(n);
    const mats = mesh.getMaterials();
    for (let j = 0; j < n; j++) was[j] = mats[j * 3 + 2];
    const now = new Float32Array(n);
    for (let j = 0; j < n; j++) now[j] = src[map ? map[j] : j] / 255;
    const set = (v: Float32Array): void => {
      const m = mesh.getMaterials();
      for (let j = 0; j < n; j++) m[j * 3 + 2] = v[j];
      this.afterMaskLoad?.(mesh);
      this.host.setMesh(mesh);
    };
    set(now);
    this.push(
      () => set(was),
      () => set(now),
    );
    this.host.render();
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
    // Masks go up as a scalar field does: through the same subdivision, in the x of a position.
    const maskBefore = p.list.map((l): [SculptLayer, Uint8Array | null] => [l, l.mask]);
    const maskAfter = maskBefore.map(([l, m]): [SculptLayer, Uint8Array | null] => {
      if (!m) return [l, null];
      const field = new Float32Array(m.length * 3);
      for (let i = 0; i < m.length; i++) field[i * 3] = m[i] / 255;
      const up = new Float32Array(n * 3);
      const md = lower.getMeshData();
      const own = md._verticesXYZ;
      md._verticesXYZ = field;
      try {
        lower.computePartialSubdivision(up, new Float32Array(n * 3), new Float32Array(n * 3), n);
      } finally {
        md._verticesXYZ = own;
      }
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, Math.round(up[i * 3] * 255)));
      return [l, out];
    });
    for (const [l, d] of after) l.delta = d;
    for (const [l, m] of maskAfter) l.mask = m;
    p.ref = null;
    this.arm(mesh);
    this.push(
      () => {
        for (const [l, d] of before) l.delta = d;
        for (const [l, m] of maskBefore) l.mask = m;
        p.ref = null;
      },
      () => {
        for (const [l, d] of after) l.delta = d;
        for (const [l, m] of maskAfter) l.mask = m;
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
    const maskBefore = p.list.map((l): [SculptLayer, Uint8Array | null] => [l, l.mask]);
    const maskAfter = maskBefore.map(([l, m]): [SculptLayer, Uint8Array | null] => {
      if (!m) return [l, null];
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = m[map ? map[i] : i];
      return [l, out];
    });
    for (const [l, d] of after) l.delta = d;
    for (const [l, m] of maskAfter) l.mask = m;
    p.ref = null;
    this.arm(mesh);
    this.push(
      () => {
        for (const [l, d] of before) l.delta = d;
        for (const [l, m] of maskBefore) l.mask = m;
        p.ref = null;
      },
      () => {
        for (const [l, d] of after) l.delta = d;
        for (const [l, m] of maskAfter) l.mask = m;
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
      const out: SavedLayer = {
        name: l.name,
        weight: l.weight,
        visible: l.visible,
        kind: l.kind,
        parent: l.parent ? p.list.indexOf(l.parent) : -1,
        open: l.open,
      };
      if (l.mask) {
        // Run-length: a value and how many vertices in a row have it.
        const vals: number[] = [];
        const lens: number[] = [];
        for (let i = 0; i < l.mask.length; i++) {
          if (vals.length && vals[vals.length - 1] === l.mask[i]) lens[lens.length - 1]++;
          else {
            vals.push(l.mask[i]);
            lens.push(1);
          }
        }
        out.maskVals = Uint8Array.from(vals);
        out.maskLens = Uint32Array.from(lens);
        out.maskOn = l.maskOn;
      }
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
      let mask: Uint8Array | null = null;
      if (s.maskVals && s.maskLens) {
        mask = new Uint8Array(topVertices);
        let at = 0;
        for (let k = 0; k < s.maskVals.length; k++) {
          mask.fill(s.maskVals[k], at, at + s.maskLens[k]);
          at += s.maskLens[k];
        }
      }
      return {
        id: nextId++,
        name: s.name,
        kind: s.kind ?? 'layer',
        parent: null,
        weight: s.weight,
        visible: s.visible,
        delta,
        applied: s.visible ? s.weight : 0,
        mask,
        maskOn: s.maskOn !== false,
        open: s.open !== false,
      };
    });
    saved.items.forEach((s, k) => {
      if (s.parent !== undefined && s.parent >= 0) list[k].parent = list[s.parent];
    });
    for (const l of list) l.applied = effOf(l).w;
    this.per.set(mesh, { list, active: list[saved.active] ?? null, ref: null });
    this.changed();
  }
}
