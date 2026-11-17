import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import { BYTE_TO_LINEAR, blend, composite, decodeSrgb, dissolveThreshold, encodeSrgb, type BlendId } from '../../paint/blend';
import { MAX_PAINT_LAYERS, MAX_PAINT_NAME, PAINT_LAYERS_V, type SavedPaintLayers } from './paintLayersRecord';

export { MAX_PAINT_LAYERS, MAX_PAINT_NAME };

/**
 * Paint layers (owner request, 2026-11-17): vertex colour in layers, each
 * with a blend mode (Photoshop's list, src/paint/blend.ts), an opacity, an
 * eye and an order, over a fixed Base.
 *
 * Where the data lives (owner call, as sculpt layers have it): on the
 * object's HIGHEST level only. A layer is four bytes a vertex of that level
 * (the colour sRGB-encoded, so the modes work on the values Photoshop's do,
 * and straight alpha), allocated on the layer's first stroke; Base is the
 * colour the object had when layers were first used, linear floats as the
 * mesh keeps them. The mesh's own colour array is the COMPOSITE, bottom to
 * top: `blend(mode, below, layer.rgb)` mixed in by `layer.alpha * opacity`,
 * a vertex no layer has colour on keeping its Base exactly. Publishing,
 * export and every other reader of the mesh's colours see the composite.
 *
 * How a stroke reaches a layer. The paint tools (paintTools.ts) do not write
 * the mesh's colours when the object has layers: they hand each dab to the
 * stroke (`PaintStroke`), which changes the active layer's bytes (or Base),
 * and the vertices the dab touched are composited again at once, so a stroke
 * costs the dab's vertices times the layers they have colour on, nothing
 * more, and nothing at all is done per stroke on an object without layers.
 * The stroke is its own undo step, with the bytes it replaced.
 *
 * Levels. The person may paint on any level. A dab on a lower level changes
 * the layer where that level's vertices stand on the highest one (`lineage`),
 * and when the stroke ends the change is carried to the vertices in between
 * by the vendor's own subdivision of colours, as sculpt layers carry
 * strokes up. After any step between levels (and an undo or redo across
 * one) the level on screen is composited again from the layers, so what is
 * shown is always the layers'.
 *
 * Layer operations are undo steps made by snapshots of the list (which
 * layer, its settings and the reference to its bytes; an operation that
 * changes bytes puts new ones in place of the old, so the old stay for undo).
 *
 * Memory. A layer is 4 bytes a vertex of the highest level, so ten layers on
 * a million vertices are 40 MB, once each has been painted on (an empty one
 * costs nothing), and Base is another 12 MB. A stroke holds, until it ends,
 * the bytes it replaced. Records on disk are sparse.
 */

export interface PaintLayer {
  /** Unique within the session. */
  id: number;
  name: string;
  mode: BlendId;
  /** 0 to 1. */
  opacity: number;
  visible: boolean;
  /** sRGB colour and straight alpha, four bytes a vertex of the highest level; null until the layer takes a stroke. */
  rgba: Uint8Array | null;
}

/** What a stroke asks, before it starts. */
export interface PaintRefusal {
  kind: 'hidden';
  name: string;
}

interface Snapshot {
  list: PaintLayer[];
  active: PaintLayer | null;
  props: Array<{ l: PaintLayer; name: string; mode: BlendId; opacity: number; visible: boolean; rgba: Uint8Array | null }>;
  base: Float32Array;
}

interface PerMesh {
  /** Oldest (bottom) first. */
  list: PaintLayer[];
  /** The layer strokes go to; null is Base. */
  active: PaintLayer | null;
  /** Base: linear colour, three floats a vertex of the highest level. */
  base: Float32Array;
  /** The highest level's vertex count. */
  n: number;
  /** The level on screen's map to the highest level (null on the highest level itself). */
  lin: { key: string; map: Uint32Array | null } | null;
}

/** The vendored stack, as far as paint layers need it. */
interface Stack extends SculptMesh {
  _meshes: Array<
    SculptMesh & {
      getEvenMapping(): boolean;
      getVerticesMapping(): Uint32Array | null;
      computePartialSubdivision(v: Float32Array, c: Float32Array, m: Float32Array, nbUp: number): void;
    }
  >;
  _sel: number;
  selectResolution(sel: number): void;
  higherLevel(): SculptMesh;
  setSelection(sel: number): void;
  updateResolution(): void;
}

interface Manager {
  pushState(state: unknown): void;
  pushStateCustom(undocb: () => void, redocb?: () => void, squash?: boolean): void;
  getCurrentState(): unknown;
}

/** What the layers need of the session that owns them. */
export interface PaintHost {
  getStateManager(): Manager;
  getMeshes(): SculptMesh[];
  getMesh(): SculptMesh | null;
  setMesh(mesh: SculptMesh | null): unknown;
  render(): void;
}


/** The colour arrays of a level's mesh data, which a subdivision of other numbers swaps in for a moment. */
interface ColourData {
  _colorsRGB: Float32Array;
  _materialsPBR: Float32Array;
}

/**
 * The vendor's subdivision of colours applied to numbers of our own: `rgb`
 * (three a vertex of `lower`) rides as its colours and `al` as its first
 * material channel, and what the level above gets of them comes back. Linear,
 * so a change subdivides to the change the level above would have.
 */
function subdivideColours(lower: unknown, rgb: Float32Array, al: Float32Array, nUp: number): [Float32Array, Float32Array] {
  const level = lower as { getMeshData(): ColourData; computePartialSubdivision(v: Float32Array, c: Float32Array, m: Float32Array, nbUp: number): void };
  const md = level.getMeshData();
  const ownC = md._colorsRGB;
  const ownM = md._materialsPBR;
  md._colorsRGB = rgb;
  md._materialsPBR = al;
  const outV = new Float32Array(nUp * 3);
  const outC = new Float32Array(nUp * 3);
  const outM = new Float32Array(nUp * 3);
  try {
    level.computePartialSubdivision(outV, outC, outM, nUp);
  } finally {
    md._colorsRGB = ownC;
    md._materialsPBR = ownM;
  }
  return [outC, outM];
}

const stackOf = (mesh: SculptMesh): Stack | null => (mesh._meshes ? (mesh as unknown as Stack) : null);

let nextId = 1;

const clampByte = (v: number): number => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));

export class PaintLayers {
  private readonly per = new WeakMap<SculptMesh, PerMesh>();
  private readonly srcScratch: [number, number, number] = [0, 0, 0];
  private readonly tmpScratch: [number, number, number] = [0, 0, 0];
  /** An opacity drag in progress: where it began, so the release is one undo step. */
  private drag: { mesh: SculptMesh; layer: PaintLayer; from: Snapshot } | null = null;

  /** Anything about the layers changed (list, active, an opacity, an undo): the panel and the autosave follow. */
  onChange: (() => void) | null = null;
  /** The first layer on an object: its colours are its own from here on (the material must not recolour them). */
  onFirstUse: ((mesh: SculptMesh) => void) | null = null;

  constructor(private readonly host: PaintHost) {}

  private get sm(): Manager {
    return this.host.getStateManager();
  }

  private changed(): void {
    this.onChange?.();
  }

  // --- reading -------------------------------------------------------------

  /** The object's layers, newest first (the list's order). */
  list(mesh: SculptMesh | null): PaintLayer[] {
    const p = mesh ? this.per.get(mesh) : undefined;
    return p ? [...p.list].reverse() : [];
  }

  count(mesh: SculptMesh | null): number {
    return (mesh ? this.per.get(mesh)?.list.length : 0) ?? 0;
  }

  has(mesh: SculptMesh | null): boolean {
    return this.count(mesh) > 0;
  }

  /** The layer strokes go to, or null for Base. */
  active(mesh: SculptMesh | null): PaintLayer | null {
    return (mesh ? this.per.get(mesh)?.active : null) ?? null;
  }

  /** Whether layers can be made on this object (dynamic topology has none). */
  allowed(mesh: SculptMesh | null): boolean {
    return !!mesh && !mesh.isDynamic;
  }

  /** The objects among `meshes` that have layers. */
  withLayers(meshes: SculptMesh[]): SculptMesh[] {
    return meshes.filter((m) => this.has(m));
  }

  /** What the layer has painted on it, as the highest level's vertex ids (the vertices its recomposite must visit). */
  private touched(l: PaintLayer): number[] {
    const out: number[] = [];
    const d = l.rgba;
    if (d) for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) out.push((i - 3) >> 2);
    return out;
  }

  private uniqueName(p: PerMesh, base: string): string {
    const taken = new Set(p.list.map((l) => l.name));
    if (!taken.has(base)) return base;
    for (let k = 2; ; k++) if (!taken.has(`${base} ${k}`)) return `${base} ${k}`;
  }

  // --- the highest level ---------------------------------------------------

  /**
   * Run `fn` with the highest level's colours WITHOUT disturbing the level on
   * screen (synthesis up and the selection put back, as sculpt layers read
   * the highest level). False when a level above has no detail yet.
   */
  private viewTop(mesh: SculptMesh, fn: (c: Float32Array, n: number) => void): boolean {
    const st = stackOf(mesh);
    if (!st) {
      fn(mesh.getColors(), mesh.getNbVertices());
      return true;
    }
    const cur = st._sel;
    const top = st._meshes.length - 1;
    if (cur === top) {
      fn(mesh.getColors(), mesh.getNbVertices());
      return true;
    }
    for (let k = cur + 1; k <= top; k++) if (!(st._meshes[k] as unknown as { _detailsXYZ?: unknown })._detailsXYZ) return false;
    // Synthesis applies the details in the frame of the upper level's normals as they stood at its last visit.
    const normals = st._meshes.slice(cur + 1).map((m) => new Float32Array(m.getNormals()));
    try {
      for (let k = cur; k < top; k++) st.higherLevel();
      fn(mesh.getColors(), mesh.getNbVertices());
    } finally {
      st.setSelection(cur);
      st.updateResolution();
      st._meshes.slice(cur + 1).forEach((m, i) => m.getNormals().set(normals[i]));
    }
    return true;
  }

  /** The level on screen's vertices, by their place on the highest level; null when it is the highest. */
  private lineage(mesh: SculptMesh, p: PerMesh): Uint32Array | null {
    const st = stackOf(mesh);
    if (!st) return null;
    const cur = st._sel;
    const top = st._meshes.length - 1;
    if (cur === top) return null;
    const key = `${cur}:${top}:${st._meshes[cur].getNbVertices()}:${p.n}`;
    if (p.lin && p.lin.key === key) return p.lin.map;
    const n = st._meshes[cur].getNbVertices();
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    for (let k = cur; k < top; k++) {
      const m = st._meshes[k];
      if (!m.getEvenMapping()) continue;
      const map = m.getVerticesMapping();
      if (map) for (let i = 0; i < n; i++) idx[i] = map[idx[i]];
    }
    p.lin = { key, map: idx };
    return idx;
  }

  // --- the composite -------------------------------------------------------

  /** The composite colour (linear) of highest-level vertex `i`, into `out` at `o`. */
  private colourAt(p: PerMesh, i: number, out: Float32Array, o: number): void {
    const b = p.base;
    const bi = i * 3;
    let below: [number, number, number] | null = null;
    const src = this.srcScratch;
    const tmp = this.tmpScratch;
    for (const l of p.list) {
      const d = l.rgba;
      if (!l.visible || !d) continue;
      const a = d[i * 4 + 3];
      if (a === 0 || l.opacity <= 0) continue;
      if (!below) below = [encodeSrgb(b[bi]), encodeSrgb(b[bi + 1]), encodeSrgb(b[bi + 2])];
      src[0] = d[i * 4] / 255;
      src[1] = d[i * 4 + 1] / 255;
      src[2] = d[i * 4 + 2] / 255;
      composite(l.mode, below, src, a / 255, l.opacity, dissolveThreshold(i), tmp);
      below[0] = tmp[0];
      below[1] = tmp[1];
      below[2] = tmp[2];
    }
    if (!below) {
      out[o] = b[bi];
      out[o + 1] = b[bi + 1];
      out[o + 2] = b[bi + 2];
    } else {
      out[o] = decodeSrgb(below[0]);
      out[o + 1] = decodeSrgb(below[1]);
      out[o + 2] = decodeSrgb(below[2]);
    }
  }

  /** The composite colour of a highest-level vertex, linear: what the mesh shows there. For tests and the pick. */
  compositeAt(mesh: SculptMesh, i: number): [number, number, number] | null {
    const p = this.per.get(mesh);
    if (!p || i < 0 || i >= p.n) return null;
    const out = new Float32Array(3);
    this.colourAt(p, i, out, 0);
    return [out[0], out[1], out[2]];
  }

  /**
   * Composite again the vertices `ids` of the level on screen (all of them
   * when null) into the mesh's colours, and push them to the screen.
   */
  recomposite(mesh: SculptMesh, ids: ArrayLike<number> | null, push = true): void {
    const p = this.per.get(mesh);
    if (!p) return;
    const cols = mesh.getColors();
    const map = this.lineage(mesh, p);
    const n = mesh.getNbVertices();
    if (ids) {
      for (let k = 0; k < ids.length; k++) {
        const j = ids[k];
        this.colourAt(p, map ? map[j] : j, cols, j * 3);
      }
    } else {
      for (let j = 0; j < n; j++) this.colourAt(p, map ? map[j] : j, cols, j * 3);
    }
    this.refreshGl(mesh, ids, push);
  }

  private refreshGl(mesh: SculptMesh, ids: ArrayLike<number> | null, push: boolean): void {
    if (ids) {
      const u = ids instanceof Uint32Array ? ids : Uint32Array.from(ids as ArrayLike<number>);
      mesh.updateDuplicateColorsAndMaterials(u);
      if (mesh.isUsingDrawArrays()) mesh.updateDrawArrays(mesh.getFacesFromVertices(u));
    } else {
      mesh.updateDuplicateColorsAndMaterials();
      mesh.updateDrawArrays();
    }
    if (push) mesh.updateColorBuffer();
  }

  /** Composite what the layers in `ls` cover (or all, when the level on screen is not the highest). */
  private recompositeLayers(mesh: SculptMesh, ls: PaintLayer[]): void {
    const p = this.per.get(mesh);
    if (!p) return;
    if (this.lineage(mesh, p)) {
      this.recomposite(mesh, null);
      return;
    }
    const hit = new Set<number>();
    for (const l of ls) for (const i of this.touched(l)) hit.add(i);
    this.recomposite(mesh, Uint32Array.from(hit));
  }

  /** After a step between levels (or an undo across one): the level on screen shows the layers' composite. */
  levelChanged(mesh: SculptMesh | null): void {
    if (!mesh || !this.has(mesh)) return;
    this.recomposite(mesh, null);
    this.host.render();
  }

  // --- snapshots (the layer operations' undo) --------------------------------

  private snap(p: PerMesh): Snapshot {
    return {
      list: [...p.list],
      active: p.active,
      props: p.list.map((l) => ({ l, name: l.name, mode: l.mode, opacity: l.opacity, visible: l.visible, rgba: l.rgba })),
      base: p.base,
    };
  }

  private unsnap(p: PerMesh, s: Snapshot): void {
    p.list = [...s.list];
    p.active = s.active;
    p.base = s.base;
    for (const x of s.props) {
      x.l.name = x.name;
      x.l.mode = x.mode;
      x.l.opacity = x.opacity;
      x.l.visible = x.visible;
      x.l.rgba = x.rgba;
    }
  }

  /** Make an operation an undo step: `before` and `after` are snapshots; both ways composite the whole level on screen. */
  private pushSnap(mesh: SculptMesh, p: PerMesh, before: Snapshot, after: Snapshot, squash = false): void {
    const set = (s: Snapshot): void => {
      this.unsnap(p, s);
      if (p.list.length) this.per.set(mesh, p);
      else this.per.delete(mesh);
      if (this.per.get(mesh) === p) this.recomposite(mesh, null);
      this.host.setMesh(mesh);
      this.changed();
    };
    this.sm.pushStateCustom(
      () => set(before),
      () => set(after),
      squash,
    );
  }

  // --- making layers --------------------------------------------------------

  private ensure(mesh: SculptMesh): PerMesh | null {
    let p = this.per.get(mesh);
    if (p) return p;
    let base: Float32Array | null = null;
    let n = 0;
    this.viewTop(mesh, (c, count) => {
      n = count;
      base = new Float32Array(c.subarray(0, count * 3));
    });
    if (!base) return null;
    p = { list: [], active: null, base, n, lin: null };
    this.per.set(mesh, p);
    return p;
  }

  /** A new empty layer at 100%, Normal, above the active one; it becomes the active layer. Null when none can be made. */
  add(mesh: SculptMesh, name?: string): PaintLayer | null {
    if (!this.allowed(mesh)) return null;
    const fresh = !this.per.has(mesh);
    const p = this.ensure(mesh);
    if (!p || p.list.length >= MAX_PAINT_LAYERS) {
      if (p && fresh && !p.list.length) this.per.delete(mesh);
      return null;
    }
    const before = this.snap(p);
    const layer: PaintLayer = {
      id: nextId++,
      name: this.uniqueName(p, (name ?? `Layer ${p.list.length + 1}`).slice(0, MAX_PAINT_NAME)),
      mode: 'normal',
      opacity: 1,
      visible: true,
      rgba: null,
    };
    const at = p.active ? p.list.indexOf(p.active) + 1 : p.list.length;
    p.list.splice(at, 0, layer);
    p.active = layer;
    const after = this.snap(p);
    // The undo of the first layer takes the object back to having none; a redo gives it back.
    if (fresh) this.onFirstUse?.(mesh);
    this.pushSnap(mesh, p, before, after);
    this.changed();
    return layer;
  }

  /** The layer strokes go to (null: Base). Not an undo step: each stroke knows what it was painted on. */
  setActive(mesh: SculptMesh, layer: PaintLayer | null): void {
    const p = this.per.get(mesh);
    if (!p) return;
    const want = layer && p.list.includes(layer) ? layer : null;
    if (p.active === want) return;
    p.active = want;
    this.changed();
  }

  rename(layer: PaintLayer, name: string): void {
    const text = name.trim().slice(0, MAX_PAINT_NAME);
    if (!text || text === layer.name) return;
    layer.name = text;
    this.changed();
  }

  /** One property of a layer, as an undo step (visibility, mode). */
  private setProp(mesh: SculptMesh, layer: PaintLayer, apply: () => void): void {
    const p = this.per.get(mesh);
    if (!p || !p.list.includes(layer)) return;
    const before = this.snap(p);
    apply();
    const after = this.snap(p);
    this.recompositeLayers(mesh, [layer]);
    this.pushSnap(mesh, p, before, after);
    this.host.render();
    this.changed();
  }

  setVisible(mesh: SculptMesh, layer: PaintLayer, visible: boolean): void {
    if (layer.visible === visible) return;
    this.setProp(mesh, layer, () => (layer.visible = visible));
  }

  setMode(mesh: SculptMesh, layer: PaintLayer, mode: BlendId): void {
    if (layer.mode === mode) return;
    this.setProp(mesh, layer, () => (layer.mode = mode));
  }

  /** Set a layer's opacity (0 to 1). `live` while a slider is dragged, `commit` at its release, which is one undo step for the drag. */
  setOpacity(mesh: SculptMesh, layer: PaintLayer, opacity: number, phase: 'live' | 'commit'): void {
    const p = this.per.get(mesh);
    if (!p || !p.list.includes(layer) || !Number.isFinite(opacity)) return;
    if (!this.drag || this.drag.layer !== layer) this.drag = { mesh, layer, from: this.snap(p) };
    layer.opacity = Math.max(0, Math.min(1, opacity));
    this.recompositeLayers(mesh, [layer]);
    this.host.render();
    if (phase === 'live') return;
    const from = this.drag.from;
    this.drag = null;
    const after = this.snap(p);
    if (from.props.find((x) => x.l === layer)?.opacity === layer.opacity) return;
    this.pushSnap(mesh, p, from, after);
    this.changed();
  }

  /** Move a layer to a place in the list (0 is the bottom, just above Base). Order matters here. */
  reorder(mesh: SculptMesh, layer: PaintLayer, to: number): void {
    const p = this.per.get(mesh);
    if (!p) return;
    const at = p.list.indexOf(layer);
    const dest = Math.max(0, Math.min(p.list.length - 1, Math.round(to)));
    if (at < 0 || at === dest) return;
    const before = this.snap(p);
    p.list.splice(at, 1);
    p.list.splice(dest, 0, layer);
    const after = this.snap(p);
    this.recompositeLayers(mesh, [layer, ...p.list.slice(Math.min(at, dest), Math.max(at, dest) + 1)]);
    this.pushSnap(mesh, p, before, after);
    this.host.render();
    this.changed();
  }

  /** A copy of a layer, above it. */
  duplicate(mesh: SculptMesh, layer: PaintLayer): PaintLayer | null {
    const p = this.per.get(mesh);
    if (!p || p.list.length >= MAX_PAINT_LAYERS) return null;
    const at = p.list.indexOf(layer);
    if (at < 0) return null;
    const before = this.snap(p);
    const copy: PaintLayer = {
      ...layer,
      id: nextId++,
      name: this.uniqueName(p, `${layer.name} copy`.slice(0, MAX_PAINT_NAME)),
      rgba: layer.rgba ? new Uint8Array(layer.rgba) : null,
    };
    p.list.splice(at + 1, 0, copy);
    p.active = copy;
    const after = this.snap(p);
    this.recompositeLayers(mesh, [copy]);
    this.pushSnap(mesh, p, before, after);
    this.host.render();
    this.changed();
    return copy;
  }

  /** Remove the colour a layer has, keeping the layer. */
  clear(mesh: SculptMesh, layer: PaintLayer): void {
    const p = this.per.get(mesh);
    if (!p || !layer.rgba) return;
    const before = this.snap(p);
    const was = this.touched(layer);
    layer.rgba = null;
    const after = this.snap(p);
    if (this.lineage(mesh, p)) this.recomposite(mesh, null);
    else this.recomposite(mesh, Uint32Array.from(was));
    this.pushSnap(mesh, p, before, after);
    this.host.render();
    this.changed();
  }

  /** Delete takes the layer's colour off the object with it. */
  remove(mesh: SculptMesh, layer: PaintLayer): void {
    const p = this.per.get(mesh);
    if (!p) return;
    const at = p.list.indexOf(layer);
    if (at < 0) return;
    const before = this.snap(p);
    const was = this.touched(layer);
    p.list.splice(at, 1);
    if (p.active === layer) p.active = p.list[Math.min(at, p.list.length - 1)] ?? null;
    const after = this.snap(p);
    if (this.lineage(mesh, p)) this.recomposite(mesh, null);
    else this.recomposite(mesh, Uint32Array.from(was));
    if (!p.list.length) this.per.delete(mesh);
    this.pushSnap(mesh, p, before, after);
    this.host.render();
    this.changed();
  }

  /**
   * Join a layer into the one below it, or into Base when it is the lowest.
   * Into Base the result is exact. Into a layer, the lower layer keeps its
   * own blend mode and opacity and takes the upper one's colour by the
   * layer-over-layer arithmetic (exact when the lower is Normal at 100%).
   */
  mergeDown(mesh: SculptMesh, layer: PaintLayer): void {
    const p = this.per.get(mesh);
    if (!p) return;
    const at = p.list.indexOf(layer);
    if (at < 0) return;
    const before = this.snap(p);
    const was = this.touched(layer);
    const src: [number, number, number] = [0, 0, 0];
    const tmp: [number, number, number] = [0, 0, 0];
    if (at === 0) {
      const base = new Float32Array(p.base);
      const d = layer.rgba;
      if (d && layer.visible) {
        for (const i of was) {
          const bi = i * 3;
          const below: [number, number, number] = [encodeSrgb(base[bi]), encodeSrgb(base[bi + 1]), encodeSrgb(base[bi + 2])];
          src[0] = d[i * 4] / 255;
          src[1] = d[i * 4 + 1] / 255;
          src[2] = d[i * 4 + 2] / 255;
          composite(layer.mode, below, src, d[i * 4 + 3] / 255, layer.opacity, dissolveThreshold(i), tmp);
          base[bi] = decodeSrgb(tmp[0]);
          base[bi + 1] = decodeSrgb(tmp[1]);
          base[bi + 2] = decodeSrgb(tmp[2]);
        }
      }
      p.base = base;
    } else {
      const lower = p.list[at - 1];
      const out = lower.rgba ? new Uint8Array(lower.rgba) : new Uint8Array(p.n * 4);
      const d = layer.rgba;
      if (d && layer.visible) {
        for (const i of was) {
          const ab = out[i * 4 + 3] / 255;
          const as = (d[i * 4 + 3] / 255) * layer.opacity;
          const ar = ab + as * (1 - ab);
          if (ar <= 0) continue;
          const cb: [number, number, number] = [out[i * 4] / 255, out[i * 4 + 1] / 255, out[i * 4 + 2] / 255];
          const cs: [number, number, number] = [d[i * 4] / 255, d[i * 4 + 1] / 255, d[i * 4 + 2] / 255];
          const bl = ab > 0 && layer.mode !== 'dissolve' ? blend(layer.mode, cb, cs) : cs;
          const k = as / ar;
          for (let c = 0; c < 3; c++) out[i * 4 + c] = clampByte(255 * ((1 - k) * cb[c] + k * ((1 - ab) * cs[c] + ab * bl[c])));
          out[i * 4 + 3] = clampByte(255 * ar);
        }
      }
      lower.rgba = out;
    }
    p.list.splice(at, 1);
    p.active = at > 0 ? p.list[at - 1] : (p.list[0] ?? null);
    const after = this.snap(p);
    this.recomposite(mesh, null);
    if (!p.list.length) {
      // No layer left: Base alone is the object's colour; the object is plain again.
      this.per.delete(mesh);
    }
    this.pushSnap(mesh, p, before, after);
    this.host.render();
    this.changed();
  }

  /**
   * Every layer becomes part of the object's colour, in one undo step.
   * `squash` joins the step to the one before it. Returns the state it
   * pushed, or null.
   */
  flattenAll(mesh: SculptMesh, squash = false): unknown {
    const p = this.per.get(mesh);
    if (!p || !p.list.length) return null;
    const before = this.snap(p);
    // The mesh's colours already are the composite: the layers just go.
    const gone = p;
    this.per.delete(mesh);
    const set = (on: boolean): void => {
      if (on) {
        this.unsnap(gone, before);
        this.per.set(mesh, gone);
        this.recomposite(mesh, null);
      } else {
        this.per.delete(mesh);
      }
      this.host.setMesh(mesh);
      this.changed();
    };
    this.sm.pushStateCustom(
      () => set(true),
      () => set(false),
      squash,
    );
    this.changed();
    return this.sm.getCurrentState();
  }

  /** The operation pushed its state: it and the flatten before it are one undo step. */
  join(flatState: unknown): void {
    if (!flatState) return;
    const cur = this.sm.getCurrentState() as { squash?: boolean } | undefined;
    if (cur && cur !== flatState) cur.squash = true;
  }

  /** An operation that rebuilds the surface cannot keep per-vertex layers: they are flattened first, in a step the operation's own then joins. */
  flattenForOp(meshes: SculptMesh[], squash = false): unknown {
    let last: unknown = null;
    for (const m of this.withLayers(meshes)) last = this.flattenAll(m, squash || last !== null) ?? last;
    return last;
  }

  /** The material filled an object that has layers with its colour: that is Base now. */
  baseFilled(mesh: SculptMesh, rgb: [number, number, number]): void {
    const p = this.per.get(mesh);
    if (!p) return;
    for (let i = 0; i < p.n; i++) {
      p.base[i * 3] = rgb[0];
      p.base[i * 3 + 1] = rgb[1];
      p.base[i * 3 + 2] = rgb[2];
    }
    this.recomposite(mesh, null);
  }

  // --- strokes ---------------------------------------------------------------

  /** Whether a stroke on `mesh` must not start, and why: the active layer is hidden or at 0%. */
  refusal(mesh: SculptMesh | null): PaintRefusal | null {
    if (!mesh) return null;
    const layer = this.active(mesh);
    if (!layer) return null;
    if (!layer.visible || layer.opacity <= 0) return { kind: 'hidden', name: layer.name };
    return null;
  }

  /**
   * What the person is told when a stroke with `tool` cannot start: the
   * active layer is hidden or at 0%, or the tool needs a layer and none is
   * picked (Erase). Null when it can. `tool` is a vendor tool index.
   */
  refusalText(mesh: SculptMesh | null, tool: number): string | null {
    if (!mesh) return null;
    const hidden = this.refusal(mesh);
    if (hidden) return `The layer "${hidden.name}" is hidden or at 0%. Show it to paint on it.`;
    // Erase (the vendor's index 15) takes alpha off a layer: Base has none.
    if (tool === 15 && !(this.has(mesh) && this.active(mesh))) return 'Erase works on a layer. Add a layer, or tap one, first.';
    return null;
  }

  /** The stroke a dab belongs to, or null when the object has no layers (the vendor's own paint is then what runs). */
  beginStroke(mesh: SculptMesh): PaintStroke | null {
    const p = this.per.get(mesh);
    if (!p || !p.list.length) return null;
    return new PaintStroke(this, mesh, p, p.active);
  }

  /** @internal The stroke's reach into the model. */
  internals(mesh: SculptMesh): { p: PerMesh; map: Uint32Array | null } | null {
    const p = this.per.get(mesh);
    return p ? { p, map: this.lineage(mesh, p) } : null;
  }

  /** @internal */
  finishStroke(mesh: SculptMesh, p: PerMesh, s: PaintStroke): void {
    this.carryUp(mesh, p, s);
    this.changed();
  }

  /** A stroke on `mesh` as the undo step it is, pushed; null when the object has no layers (the vendor's own paint is then what runs). */
  startStroke(mesh: SculptMesh): PaintStroke | null {
    const s = this.beginStroke(mesh);
    if (s) this.sm.pushState(s);
    return s;
  }

  /** Composite the vertices a dab touched; the tool's own render pushes them to the screen (`push` false). */
  dabDone(mesh: SculptMesh, screenIds: ArrayLike<number>, push = true): void {
    this.recomposite(mesh, screenIds, push);
  }

  /** @internal Apply a stroke's bytes, before or after, and show them. */
  applyStroke(mesh: SculptMesh, p: PerMesh, s: PaintStroke, useAfter: boolean): void {
    const cur = this.per.get(mesh);
    if (cur !== p) return;
    s.write(useAfter);
    const map = this.lineage(mesh, p);
    if (map) this.recomposite(mesh, null);
    else this.recomposite(mesh, s.ids);
    this.host.setMesh(mesh);
    this.changed();
  }

  /**
   * A stroke on a level below the highest changed the layer where that
   * level's vertices stand; the vertices between them get their share by
   * the vendor's subdivision of colours (linear, so the change in premultiplied
   * colour and alpha subdivides to what the level above would have had).
   */
  private carryUp(mesh: SculptMesh, p: PerMesh, s: PaintStroke): void {
    const st = stackOf(mesh);
    if (!st) return;
    const cur = st._sel;
    const top = st._meshes.length - 1;
    if (cur === top || !s.ids.length) return;
    const nCur = st._meshes[cur].getNbVertices();
    const map = this.lineage(mesh, p)!;
    // The change at the level's vertices: premultiplied colour and alpha, before to after.
    let rgb: Float32Array = new Float32Array(nCur * 3);
    let al: Float32Array = new Float32Array(nCur * 3);
    const inv = new Map<number, number>();
    for (let j = 0; j < nCur; j++) inv.set(map[j], j);
    const target = s.layer;
    const first = s.ids.length;
    for (let k = 0; k < first; k++) {
      const j = inv.get(s.ids[k]);
      if (j === undefined) continue;
      const d = s.delta(k);
      rgb[j * 3] = d[0];
      rgb[j * 3 + 1] = d[1];
      rgb[j * 3 + 2] = d[2];
      al[j * 3] = d[3];
    }
    for (let k = cur; k < top; k++) {
      [rgb, al] = subdivideColours(st._meshes[k], rgb, al, st._meshes[k + 1].getNbVertices());
    }
    // Add what reached the vertices in between to the layer, remembering what it was.
    const seen = new Set<number>(s.ids);
    for (let i = 0; i < p.n; i++) {
      if (seen.has(i)) continue;
      const dr = rgb[i * 3];
      const dg = rgb[i * 3 + 1];
      const db = rgb[i * 3 + 2];
      const da = al[i * 3];
      if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) + Math.abs(da) < 1e-4) continue;
      s.carry(i, target ? [dr, dg, db, da] : [dr, dg, db, 0]);
    }
  }

  // --- a level added or taken away -----------------------------------------

  /**
   * A level was added on top (Subdivide): every layer and Base are carried to
   * it by the vendor's subdivision of colours, and the level on screen shows
   * the composite. Undoable with the subdivision.
   */
  topAdded(mesh: SculptMesh): void {
    const p = this.per.get(mesh);
    const st = stackOf(mesh);
    if (!p || !st) return;
    const before = this.snap(p);
    const lower = st._meshes[st._meshes.length - 2];
    const n = mesh.getNbVertices();
    const sub = (rgb: Float32Array, al: Float32Array): [Float32Array, Float32Array] => subdivideColours(lower, rgb, al, n);
    const old = p.n;
    const zero = new Float32Array(old * 3);
    p.base = sub(p.base, zero)[0];
    for (const l of p.list) {
      const d = l.rgba;
      if (!d) continue;
      const rgb = new Float32Array(old * 3);
      const al = new Float32Array(old * 3);
      for (let i = 0; i < old; i++) {
        const a = d[i * 4 + 3] / 255;
        rgb[i * 3] = (d[i * 4] / 255) * a;
        rgb[i * 3 + 1] = (d[i * 4 + 1] / 255) * a;
        rgb[i * 3 + 2] = (d[i * 4 + 2] / 255) * a;
        al[i * 3] = a;
      }
      const [oc, oa] = sub(rgb, al);
      const out = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        const a = oa[i * 3];
        if (a <= 1 / 510) continue;
        out[i * 4] = clampByte((255 * oc[i * 3]) / a);
        out[i * 4 + 1] = clampByte((255 * oc[i * 3 + 1]) / a);
        out[i * 4 + 2] = clampByte((255 * oc[i * 3 + 2]) / a);
        out[i * 4 + 3] = clampByte(255 * a);
      }
      l.rgba = out;
    }
    p.n = n;
    p.lin = null;
    const after = this.snap(p);
    const afterN = n;
    const beforeN = old;
    // The undo and redo of the level itself belong to the vendor's state; this one joins it.
    const set = (s: Snapshot, count: number): void => {
      this.unsnap(p, s);
      p.n = count;
      p.lin = null;
    };
    this.recomposite(mesh, null);
    this.sm.pushStateCustom(
      () => set(before, beforeN),
      () => set(after, afterN),
      true,
    );
    this.changed();
  }

  /**
   * The highest level was deleted (the selection is on the new highest one):
   * each layer and Base are carried down to it by the map that copies a
   * level's vertices down; the colour only the deleted level had goes with
   * it. Undoable with the deletion.
   */
  topDeleted(mesh: SculptMesh): void {
    const p = this.per.get(mesh);
    const st = stackOf(mesh);
    if (!p || !st) return;
    const before = this.snap(p);
    const down = st._meshes[st._meshes.length - 1];
    const n = mesh.getNbVertices();
    const map = down.getEvenMapping() ? down.getVerticesMapping() : null;
    const pick = (i: number): number => (map ? map[i] : i);
    const base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const j = pick(i) * 3;
      base[i * 3] = p.base[j];
      base[i * 3 + 1] = p.base[j + 1];
      base[i * 3 + 2] = p.base[j + 2];
    }
    p.base = base;
    for (const l of p.list) {
      const d = l.rgba;
      if (!d) continue;
      const out = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        const j = pick(i) * 4;
        out[i * 4] = d[j];
        out[i * 4 + 1] = d[j + 1];
        out[i * 4 + 2] = d[j + 2];
        out[i * 4 + 3] = d[j + 3];
      }
      l.rgba = out;
    }
    const oldN = p.n;
    p.n = n;
    p.lin = null;
    const after = this.snap(p);
    this.recomposite(mesh, null);
    const set = (s: Snapshot, count: number): void => {
      this.unsnap(p, s);
      p.n = count;
      p.lin = null;
    };
    this.sm.pushStateCustom(
      () => set(before, oldN),
      () => set(after, n),
      true,
    );
    this.changed();
  }

  // --- records -------------------------------------------------------------

  serialize(mesh: SculptMesh): SavedPaintLayers | undefined {
    const p = this.per.get(mesh);
    if (!p || !p.list.length) return undefined;
    const b = p.base;
    const uni: [number, number, number] = [b[0], b[1], b[2]];
    const ids: number[] = [];
    for (let i = 0; i < p.n; i++) if (b[i * 3] !== uni[0] || b[i * 3 + 1] !== uni[1] || b[i * 3 + 2] !== uni[2]) ids.push(i);
    const items = p.list.map((l) => {
      const out: SavedPaintLayers['items'][number] = { name: l.name, mode: l.mode, opacity: l.opacity, visible: l.visible };
      const hit = this.touched(l);
      if (hit.length && l.rgba) {
        const a = Uint32Array.from(hit);
        const c = new Uint8Array(hit.length * 4);
        for (let k = 0; k < hit.length; k++) c.set(l.rgba.subarray(hit[k] * 4, hit[k] * 4 + 4), k * 4);
        out.ids = a;
        out.rgba = c;
      }
      return out;
    });
    const rec: SavedPaintLayers = { v: PAINT_LAYERS_V, active: p.active ? p.list.indexOf(p.active) : -1, base: uni, items };
    if (ids.length) {
      rec.baseIds = Uint32Array.from(ids);
      const vals = new Float32Array(ids.length * 3);
      ids.forEach((i, k) => vals.set(b.subarray(i * 3, i * 3 + 3), k * 3));
      rec.baseVals = vals;
    }
    return rec;
  }

  /** Bring a (sanitized) record's layers back on `mesh`, whose colours already are their composite. `topVertices`: the highest level's count. */
  restore(mesh: SculptMesh, saved: SavedPaintLayers, topVertices: number): void {
    const n = topVertices;
    const base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) base.set(saved.base, i * 3);
    if (saved.baseIds && saved.baseVals) {
      for (let k = 0; k < saved.baseIds.length; k++) base.set(saved.baseVals.subarray(k * 3, k * 3 + 3), saved.baseIds[k] * 3);
    }
    const list: PaintLayer[] = saved.items.map((s) => {
      let rgba: Uint8Array | null = null;
      if (s.ids && s.rgba && s.ids.length) {
        rgba = new Uint8Array(n * 4);
        for (let k = 0; k < s.ids.length; k++) rgba.set(s.rgba.subarray(k * 4, k * 4 + 4), s.ids[k] * 4);
      }
      return { id: nextId++, name: s.name, mode: s.mode, opacity: s.opacity, visible: s.visible, rgba };
    });
    if (!list.length) return;
    this.per.set(mesh, { list, active: list[saved.active] ?? null, base, n, lin: null });
    this.changed();
  }
}

/**
 * One brush stroke on an object with layers: it changes the target's bytes
 * (the active layer's, or Base's), remembers what each vertex was before,
 * and is the undo step the stroke is. `PaintTools` (paintTools.ts) feeds it
 * dab by dab.
 */
export class PaintStroke {
  /** Highest-level vertices changed, in the order they were first touched. */
  readonly ids: number[] = [];
  private before: number[] = [];
  private afterBytes: number[] | null = null;
  private readonly stamp: Map<number, number> = new Map();
  readonly base: boolean;

  constructor(
    private readonly owner: PaintLayers,
    readonly mesh: SculptMesh,
    private readonly p: PerMesh,
    /** The layer painted on; null for Base. */
    readonly layer: PaintLayer | null,
  ) {
    this.base = layer === null;
  }

  /** @internal values a vertex holds: four bytes for a layer, three floats for Base. */
  private width(): number {
    return this.base ? 3 : 4;
  }

  private read(i: number): number[] {
    if (this.layer) {
      const d = this.layer.rgba;
      return d ? [d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]] : [0, 0, 0, 0];
    }
    return [this.p.base[i * 3], this.p.base[i * 3 + 1], this.p.base[i * 3 + 2]];
  }

  /** Make the layer's bytes exist, and note a vertex's first values. */
  private touch(i: number): void {
    if (this.stamp.has(i)) return;
    if (this.layer && !this.layer.rgba) this.layer.rgba = new Uint8Array(this.p.n * 4);
    this.stamp.set(i, this.ids.length);
    this.ids.push(i);
    this.before.push(...this.read(i));
  }

  private put(i: number, v: number[]): void {
    this.touch(i);
    if (this.layer) {
      const d = this.layer.rgba!;
      for (let c = 0; c < 4; c++) d[i * 4 + c] = v[c];
    } else {
      for (let c = 0; c < 3; c++) this.p.base[i * 3 + c] = v[c];
    }
  }

  /** @internal what the vertex was before the stroke, premultiplied for the carry (colour, alpha). */
  delta(k: number): [number, number, number, number] {
    const i = this.ids[k];
    const w = this.width();
    const now = this.read(i);
    const was = this.before.slice(k * w, k * w + w);
    if (this.layer) {
      const pa = was[3] / 255;
      const na = now[3] / 255;
      return [
        (now[0] / 255) * na - (was[0] / 255) * pa,
        (now[1] / 255) * na - (was[1] / 255) * pa,
        (now[2] / 255) * na - (was[2] / 255) * pa,
        na - pa,
      ];
    }
    return [now[0] - was[0], now[1] - was[1], now[2] - was[2], 0];
  }

  /** @internal add a carried change (premultiplied) to a vertex the dabs did not reach. */
  carry(i: number, d: [number, number, number, number]): void {
    if (this.layer) {
      const cur = this.read(i);
      const pa = cur[3] / 255;
      const a = Math.max(0, Math.min(1, pa + d[3]));
      if (a <= 1 / 510) {
        this.put(i, [0, 0, 0, 0]);
        return;
      }
      const pr = [(cur[0] / 255) * pa + d[0], (cur[1] / 255) * pa + d[1], (cur[2] / 255) * pa + d[2]];
      this.put(i, [clampByte((255 * pr[0]) / a), clampByte((255 * pr[1]) / a), clampByte((255 * pr[2]) / a), clampByte(255 * a)]);
    } else {
      const cur = this.read(i);
      this.put(i, [cur[0] + d[0], cur[1] + d[1], cur[2] + d[2]]);
    }
  }

  // --- the dab operations (screen vertices; `map` takes them to the highest level) ---

  private top(j: number, map: Uint32Array | null): number {
    return map ? map[j] : j;
  }

  /** Lay colour `rgb` (linear) over the vertices, each by its weight (0 to 1): paint. */
  over(screen: ArrayLike<number>, weights: ArrayLike<number>, rgb: ArrayLike<number>, perVertex = false): void {
    const m = this.owner.internals(this.mesh);
    if (!m) return;
    const map = m.map;
    for (let k = 0; k < screen.length; k++) {
      const w = Math.min(1, weights[k]);
      if (!(w > 0)) continue;
      const i = this.top(screen[k], map);
      const o = perVertex ? k * 3 : 0;
      if (this.layer) {
        const cur = this.read(i);
        const a0 = cur[3] / 255;
        const a1 = a0 + w * (1 - a0);
        if (a1 <= 0) continue;
        const next = [0, 0, 0, clampByte(255 * a1)];
        for (let c = 0; c < 3; c++) {
          const col = 255 * encodeSrgb(rgb[o + c]);
          next[c] = a0 <= 0 ? clampByte(col) : clampByte((cur[c] * a0 * (1 - w) + col * w) / a1);
        }
        if (next[0] === cur[0] && next[1] === cur[1] && next[2] === cur[2] && next[3] === cur[3]) continue;
        this.put(i, next);
      } else {
        const cur = this.read(i);
        this.put(i, [cur[0] + (rgb[o] - cur[0]) * w, cur[1] + (rgb[o + 1] - cur[1]) * w, cur[2] + (rgb[o + 2] - cur[2]) * w]);
      }
    }
  }

  /** Lower the alpha of the vertices by their weights: erase. Only a layer has an alpha. */
  erase(screen: ArrayLike<number>, weights: ArrayLike<number>): void {
    if (!this.layer || !this.layer.rgba) return;
    const m = this.owner.internals(this.mesh);
    if (!m) return;
    for (let k = 0; k < screen.length; k++) {
      const w = Math.min(1, weights[k]);
      if (!(w > 0)) continue;
      const i = this.top(screen[k], m.map);
      const cur = this.read(i);
      if (cur[3] === 0) continue;
      const a = clampByte(cur[3] * (1 - w));
      if (a === cur[3]) continue;
      this.put(i, a === 0 ? [0, 0, 0, 0] : [cur[0], cur[1], cur[2], a]);
    }
  }

  /**
   * Pull the vertices toward the average of their neighbours, by their
   * weights: blur. A layer's colour and alpha are averaged premultiplied, so
   * a soft edge blurs into the clear and not into grey.
   */
  blur(screen: ArrayLike<number>, weights: ArrayLike<number>): void {
    const m = this.owner.internals(this.mesh);
    if (!m) return;
    const mesh = this.mesh as unknown as { getVerticesRingVert(): Uint32Array; getVerticesRingVertStartCount(): Uint32Array };
    const ring = mesh.getVerticesRingVert();
    const rsc = mesh.getVerticesRingVertStartCount();
    const map = m.map;
    // First every average from the colours as they stand, then the change, so the order of the vertices does not matter.
    const w4 = this.width();
    const avg: number[][] = [];
    for (let k = 0; k < screen.length; k++) {
      const j = screen[k];
      const start = rsc[j * 2];
      const count = rsc[j * 2 + 1];
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let q = start; q < start + count; q++) {
        const v = this.read(this.top(ring[q], map));
        if (this.layer) {
          const a = v[3] / 255;
          acc[0] += (v[0] / 255) * a;
          acc[1] += (v[1] / 255) * a;
          acc[2] += (v[2] / 255) * a;
          acc[3] += a;
        } else {
          acc[0] += v[0];
          acc[1] += v[1];
          acc[2] += v[2];
        }
        n++;
      }
      avg.push(n >= 2 ? acc.map((x) => x / n) : []);
    }
    for (let k = 0; k < screen.length; k++) {
      const av = avg[k];
      const w = Math.min(1, weights[k]);
      if (!av.length || !(w > 0)) continue;
      const i = this.top(screen[k], map);
      const cur = this.read(i);
      if (this.layer) {
        const pa = cur[3] / 255;
        const na = pa + (av[3] - pa) * w;
        if (na <= 1 / 510) {
          if (cur[3] !== 0) this.put(i, [0, 0, 0, 0]);
          continue;
        }
        const pr = [0, 1, 2].map((c) => (cur[c] / 255) * pa + (av[c] - (cur[c] / 255) * pa) * w);
        const next = [clampByte((255 * pr[0]) / na), clampByte((255 * pr[1]) / na), clampByte((255 * pr[2]) / na), clampByte(255 * na)];
        if (next.every((x, c) => x === cur[c])) continue;
        this.put(i, next);
      } else {
        this.put(i, [0, 1, 2].map((c) => cur[c] + (av[c] - cur[c]) * w));
      }
    }
    void w4;
  }

  // --- the undo step ---------------------------------------------------------

  /** Whether the stroke changed nothing (it is then no undo step). */
  isNoop(): boolean {
    return this.ids.length === 0;
  }

  /** @internal Write the stroke's bytes: before (undo) or after (redo). */
  write(useAfter: boolean): void {
    const w = this.width();
    const src = useAfter ? this.afterBytes : this.before;
    if (!src) return;
    for (let k = 0; k < this.ids.length; k++) {
      const i = this.ids[k];
      if (this.layer) {
        if (!this.layer.rgba) this.layer.rgba = new Uint8Array(this.p.n * 4);
        for (let c = 0; c < 4; c++) this.layer.rgba[i * 4 + c] = src[k * w + c];
      } else {
        for (let c = 0; c < 3; c++) this.p.base[i * 3 + c] = src[k * w + c];
      }
    }
  }

  /** The stroke ended: carry its change to the vertices between levels, and freeze what it left. */
  end(): void {
    this.owner.finishStroke(this.mesh, this.p, this);
    const w = this.width();
    const after: number[] = [];
    for (const i of this.ids) after.push(...this.read(i));
    this.afterBytes = after;
    void w;
  }

  // The vendor's state interface (StateManager calls these).
  undo(): void {
    this.owner.applyStroke(this.mesh, this.p, this, false);
  }

  redo(): void {
    this.owner.applyStroke(this.mesh, this.p, this, true);
  }

  createRedo(): PaintStroke {
    return this;
  }

  pushVertices(): void {
    // The stroke records its own vertices.
  }
}

/** A byte's linear light, tabulated: what a layer's sRGB byte shows as (for tests and the pick). */
export const byteToLinear = (b: number): number => BYTE_TO_LINEAR[b & 255];
