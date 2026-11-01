import Picking from '@sculpt-vendor/math3d/Picking';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import { GROUPS_V, MAX_GROUPS, MAX_NAME } from '../../../shared/bozz';
import { PointGrid } from './quadMesh';

/**
 * Poly groups (owner decisions, 2026-10-31; stored on level 0 since
 * 2026-11-01). The model matches Bozzetto Studio's core, so a .bozz
 * round-trips between the two.
 *
 * The model. Every face of an object's LEVEL 0 (the base mesh) is in one
 * group: a u32 a face, and a names array indexed by group number (group 0
 * is "Group 1" until renamed), with a hidden flag a group. Only level 0 is
 * stored. Every higher level's faces take their level-0 ancestor's group
 * exactly; nothing is derived by vote.
 *
 * Ancestors. SculptGL's full subdivision (vendor editing/Subdivision.js,
 * applyOddSmooth) writes face f's children at 4f..4f+3 of the level above,
 * triangles and quads alike, so a level-k face's level-0 ancestor is
 * floor(f / 4^k). A level rebuilt under level 0 (Rebuild, the vendor's
 * reversion) numbers its faces in its own order, and the level above it
 * keeps its order: that one step has a parent map of its own (`parents`,
 * read off Reversion.js's centres), and every level above it is
 * floor(f / 4) of the one below again. A saved scene re-subdivides its
 * stack from the base faces, so after a reload every step is floor(f / 4).
 *
 * The one derivation. Rebuild adds a new level 0 under the old one: each
 * new face takes the group most of its children (old level-0 faces) have,
 * and on a tie the group of the earliest child (lowest index) among the
 * tied ones. Subdividing and deleting the highest level change nothing.
 *
 * Assigning at a higher level (Ctrl+W from a mask drawn there, the loop
 * mask then Ctrl+W): the group is set per level-0 face. The faces on
 * screen that qualify are rounded down by share (roundDown): a level-0
 * face joins when more than half of its faces on screen qualify, exactly
 * half staying out (since 2026-11-01; level by level before, see
 * roundDown). By angle works on level 0's faces themselves.
 *
 * Where it lives. Per object: the names, the hidden flags, and a version
 * that moves with every change. Level 0's faces are kept per LEVEL-0
 * INSTANCE (a WeakMap): an undo that takes a rebuilt level away brings the
 * old level 0 back with its own array. A dynamic-topology mesh has one
 * level, its faces level 0's, and keeps their groups in the vendor's own
 * array (MeshDynamic._facesGroups), which follows the faces through
 * splits, collapses and undo.
 *
 * Hidden groups are not drawn (GeometrySync draws an index of the visible
 * triangles), not picked and not sculpted (the Picking hooks below). Every
 * edit here is one undo step.
 */

const TRI = 4294967295;

import { defaultGroupName, type SavedGroups } from './groupsRecord';

export { defaultGroupName, sanitizeGroups, type SavedGroups } from './groupsRecord';

interface GroupRecord {
  names: string[];
  hidden: Uint8Array;
  version: number;
  /** Level 0's groups by level-0 instance. */
  byBase: WeakMap<object, Uint32Array>;
}

/** The level instances of an object, base first (a dynamic mesh is its own one level). */
const levelsOf = (mesh: SculptMesh): SculptMesh[] => mesh._meshes ?? [mesh];
const selOf = (mesh: SculptMesh): number => (mesh._meshes ? (mesh as unknown as { _sel: number })._sel : 0);

/**
 * Each parent's group by the majority of its children's, the earliest
 * child (lowest index) winning a tie among the tied groups: `parentOf`
 * one a child (null: child c's parent is c >> 2), `nbParents` parents.
 */
export function majorityDown(children: Uint32Array, parentOf: Uint32Array | null, nbParents: number): Uint32Array {
  const out = new Uint32Array(nbParents);
  // Children by parent, in index order (CSR).
  const start = new Uint32Array(nbParents + 1);
  for (let c = 0; c < children.length; c++) {
    const p = parentOf ? parentOf[c] : c >> 2;
    if (p < nbParents) start[p + 1]++;
  }
  for (let p = 0; p < nbParents; p++) start[p + 1] += start[p];
  const fill = start.slice(0, nbParents);
  const list = new Uint32Array(start[nbParents]);
  for (let c = 0; c < children.length; c++) {
    const p = parentOf ? parentOf[c] : c >> 2;
    if (p < nbParents) list[fill[p]++] = c;
  }
  for (let p = 0; p < nbParents; p++) {
    let best = 0;
    let bestN = 0;
    for (let i = start[p]; i < start[p + 1]; i++) {
      const g = children[list[i]];
      let n = 0;
      for (let j = start[p]; j < start[p + 1]; j++) if (children[list[j]] === g) n++;
      if (n > bestN) {
        bestN = n;
        best = g;
      }
    }
    out[p] = best;
  }
  return out;
}

/**
 * A stable colour a group: hues a golden ratio apart, so neighbouring
 * numbers never look alike, at one saturation and value. Linear 0..1 RGB.
 */
export function groupColor(g: number, out: Float32Array | number[] = [0, 0, 0], at = 0): Float32Array | number[] {
  const h = (0.08 + g * 0.618033988749895) % 1;
  const s = 0.55;
  const v = 0.92;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const rgb = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][i % 6];
  out[at] = rgb[0];
  out[at + 1] = rgb[1];
  out[at + 2] = rgb[2];
  return out;
}

/**
 * Each face's neighbour across each of its edges: four slots a face (slot
 * k is the edge from corner k to the next), -1 for an open edge or a
 * triangle's fourth slot. Built by bucketing the edges by their lower
 * vertex, so it is linear in the faces.
 */
export function faceNeighbours(faces: Uint32Array | Int32Array, nbFaces: number, nbVertices: number): Int32Array {
  const nb = new Int32Array(nbFaces * 4).fill(-1);
  const start = new Uint32Array(nbVertices + 1);
  const corners = (f: number): number => (faces[f * 4 + 3] === TRI ? 3 : 4);
  for (let f = 0; f < nbFaces; f++) {
    const n = corners(f);
    for (let k = 0; k < n; k++) {
      const a = faces[f * 4 + k];
      const b = faces[f * 4 + ((k + 1) % n)];
      start[Math.min(a, b) + 1]++;
    }
  }
  for (let v = 0; v < nbVertices; v++) start[v + 1] += start[v];
  const fill = start.slice(0, nbVertices);
  const other = new Uint32Array(start[nbVertices]);
  const slot = new Uint32Array(start[nbVertices]);
  for (let f = 0; f < nbFaces; f++) {
    const n = corners(f);
    for (let k = 0; k < n; k++) {
      const a = faces[f * 4 + k];
      const b = faces[f * 4 + ((k + 1) % n)];
      const lo = Math.min(a, b);
      const at = fill[lo]++;
      other[at] = Math.max(a, b);
      slot[at] = f * 4 + k;
    }
  }
  for (let v = 0; v < nbVertices; v++) {
    for (let i = start[v]; i < start[v + 1]; i++) {
      for (let j = i + 1; j < start[v + 1]; j++) {
        if (other[i] !== other[j]) continue;
        const si = slot[i];
        const sj = slot[j];
        if (nb[si] < 0) nb[si] = sj >> 2;
        if (nb[sj] < 0) nb[sj] = si >> 2;
      }
    }
  }
  return nb;
}

/** What the poly groups need of the session. */
export interface GroupsHost {
  getStateManager(): {
    pushStateCustom(undo: () => void, redo?: () => void, squash?: boolean): void;
    pushVertices(iVerts: Uint32Array): void;
    pushStateColorAndMaterial(mesh: unknown): void;
  };
  render(): void;
}

/** Thrown when a change would make more groups than an object may have. */
export class TooManyGroups extends Error {}

export class PolyGroups {
  private readonly records = new WeakMap<SculptMesh, GroupRecord>();
  /**
   * A level whose faces are not 4f..4f+3 of the one below (the old level 0
   * under a Rebuild): its parent map, valid while `below` is the level
   * under it.
   */
  private readonly parents = new WeakMap<object, { below: object; parent: Uint32Array }>();
  /** Higher levels' groups, by level instance: valid for one level-0 array at one version. */
  private readonly inherited = new WeakMap<object, { base: Uint32Array; version: number; faces: Uint32Array }>();
  /** The hidden flags of the level on screen, by level instance, as `inherited` is kept. */
  private readonly hiddenCache = new WeakMap<object, { base: Uint32Array | null; version: number; tick: number; faces: Uint8Array; verts: Uint8Array | null }>();
  /** Dynamic meshes' topology steps (GeometrySync reports each), so their caches know to go. */
  private readonly ticks = new WeakMap<object, number>();
  /** Whether the display shows the group colours (Shift+F). */
  private showing = false;

  /**
   * Something about an object's groups changed (an edit, its undo, a
   * transfer): the display, the Groups list and the autosave follow.
   */
  onChange: ((mesh: SculptMesh) => void) | null = null;

  constructor(private readonly host: GroupsHost) {
    Picking.hiddenFaces = (mesh) => this.hiddenFaces(mesh);
    Picking.hiddenVertices = (mesh) => this.hiddenVertices(mesh);
  }

  dispose(): void {
    Picking.hiddenFaces = null;
    Picking.hiddenVertices = null;
    this.onChange = null;
  }

  // --- the record -----------------------------------------------------------

  private rec(mesh: SculptMesh): GroupRecord {
    let r = this.records.get(mesh);
    if (!r) {
      r = { names: [defaultGroupName(0)], hidden: new Uint8Array(1), version: 0, byBase: new WeakMap() };
      this.records.set(mesh, r);
    }
    return r;
  }

  /** Whether the object has groups worth keeping: more than one, or one renamed, or anything hidden. */
  hasGroups(mesh: SculptMesh): boolean {
    const r = this.records.get(mesh);
    if (!r) return false;
    return r.names.length > 1 || r.names[0] !== defaultGroupName(0) || r.hidden.some((h) => h !== 0);
  }

  names(mesh: SculptMesh): string[] {
    return [...this.rec(mesh).names];
  }

  hiddenGroups(mesh: SculptMesh): boolean[] {
    return [...this.rec(mesh).hidden].map((h) => h !== 0);
  }

  /** The record's version: moves with every change to it (the tests and the list read it). */
  version(mesh: SculptMesh): number {
    return this.records.get(mesh)?.version ?? 0;
  }

  private changed(mesh: SculptMesh): void {
    this.rec(mesh).version++;
    this.onChange?.(mesh);
  }

  // --- faces, by level ------------------------------------------------------

  /** Level `k`'s parent map, or null when its faces are 4f..4f+3 of the level below. */
  private parentMap(levels: SculptMesh[], k: number): Uint32Array | null {
    const e = this.parents.get(levels[k]);
    return e && e.below === levels[k - 1] && e.parent.length === levels[k].getNbFaces() ? e.parent : null;
  }

  /**
   * Level 0's groups, one a face: the array itself, which edits write
   * into. A level 0 with none yet (one a Rebuild put under the old one)
   * takes them from the lowest level above it that has some, each face
   * the majority of its children's; an object with none at all starts in
   * group 0.
   */
  baseFaces(mesh: SculptMesh): Uint32Array {
    if (mesh.isDynamic) {
      const n = mesh.getNbFaces();
      if (!mesh._facesGroups || mesh._facesGroups.length < n) {
        const grown = new Uint32Array(Math.max(n, 1));
        if (mesh._facesGroups) grown.set(mesh._facesGroups.subarray(0, Math.min(n, mesh._facesGroups.length)));
        mesh._facesGroups = grown;
      }
      return mesh._facesGroups.subarray(0, n);
    }
    const r = this.rec(mesh);
    const levels = levelsOf(mesh);
    const own = r.byBase.get(levels[0]);
    if (own && own.length === levels[0].getNbFaces()) return own;
    let faces: Uint32Array | null = null;
    for (let i = 1; i < levels.length && !faces; i++) {
      const a = r.byBase.get(levels[i]);
      if (!a || a.length !== levels[i].getNbFaces()) continue;
      faces = a;
      for (let k = i; k >= 1 && faces; k--) {
        const map = this.parentMap(levels, k);
        const nbBelow = levels[k - 1].getNbFaces();
        faces = map || faces.length === nbBelow * 4 ? majorityDown(faces, map, nbBelow) : null;
      }
    }
    const out = faces ?? new Uint32Array(levels[0].getNbFaces());
    r.byBase.set(levels[0], out);
    return out;
  }

  /** The groups of level `k` of the object (level 0's own array at 0; each face its level-0 ancestor's above). */
  levelFaces(mesh: SculptMesh, k = selOf(mesh)): Uint32Array {
    const base = this.baseFaces(mesh);
    if (mesh.isDynamic || k <= 0) return base;
    const levels = levelsOf(mesh);
    const version = this.rec(mesh).version;
    let faces = base;
    for (let j = 1; j <= Math.min(k, levels.length - 1); j++) {
      const lv = levels[j];
      const n = lv.getNbFaces();
      const hit = this.inherited.get(lv);
      if (hit && hit.base === base && hit.version === version && hit.faces.length === n) {
        faces = hit.faces;
        continue;
      }
      const map = this.parentMap(levels, j);
      const out = new Uint32Array(n);
      const below = faces;
      if (map) for (let f = 0; f < n; f++) out[f] = below[map[f]] ?? 0;
      else if (n === below.length * 4) for (let f = 0; f < n; f++) out[f] = below[f >> 2];
      faces = out;
      this.inherited.set(lv, { base, version, faces });
    }
    return faces;
  }

  /**
   * Each face of level `k`'s level-0 ancestor: `map[f >> shift]`, or
   * `f >> shift` itself when `map` is null (every step up to `k` is
   * 4f..4f+3).
   */
  ancestry(mesh: SculptMesh, k: number): { map: Uint32Array | null; shift: number } {
    if (mesh.isDynamic || k <= 0) return { map: null, shift: 0 };
    const levels = levelsOf(mesh);
    let j = 0; // the highest level up to k with a parent map of its own
    for (let i = 1; i <= k; i++) if (this.parentMap(levels, i)) j = i;
    if (j === 0) return { map: null, shift: 2 * k };
    let anc: Uint32Array | null = null; // level i's ancestors, i walking up to j
    for (let i = 1; i <= j; i++) {
      const n = levels[i].getNbFaces();
      const map = this.parentMap(levels, i);
      const out = new Uint32Array(n);
      for (let f = 0; f < n; f++) {
        const p = map ? map[f] : f >> 2;
        out[f] = anc ? anc[p] : p;
      }
      anc = out;
    }
    return { map: anc, shift: 2 * (k - j) };
  }

  /** Whether every level of the object is numbered 4f..4f+3 of the one below (not so under a Rebuild's old level 0). */
  contiguous(mesh: SculptMesh): boolean {
    const levels = levelsOf(mesh);
    for (let k = 1; k < levels.length; k++) if (this.parentMap(levels, k)) return false;
    return true;
  }

  /** The group of a face of the level on screen. */
  groupOfFace(mesh: SculptMesh, face: number): number {
    const g = this.levelFaces(mesh);
    return face >= 0 && face < g.length ? g[face] : -1;
  }

  /** How many level-0 faces each group has. */
  counts(mesh: SculptMesh): number[] {
    const out = new Array<number>(this.rec(mesh).names.length).fill(0);
    const faces = this.baseFaces(mesh);
    for (let i = 0; i < faces.length; i++) if (faces[i] < out.length) out[faces[i]]++;
    return out;
  }

  /**
   * Rebuild put a new level 0 under the old one (SculptSession.reverse):
   * the old one, now level 1, keeps its face order, so its parent map is
   * read off the reversion (each coarse quad's centre vertex, each coarse
   * triangle's middle child and the three across its edges), and the new
   * level 0 takes its groups by majority of its children.
   */
  afterReverse(mesh: SculptMesh): void {
    const levels = levelsOf(mesh);
    if (mesh.isDynamic || levels.length < 2) return;
    const low = levels[0];
    const up = levels[1];
    const cen = low._reverseCentres;
    const nLow = low.getNbFaces();
    const nUp = up.getNbFaces();
    if (cen && cen.length >= nLow) {
      const parent = new Uint32Array(nUp).fill(TRI);
      const centreOf = new Int32Array(up.getNbVertices()).fill(-1);
      const fUp = up.getFaces();
      let nb: Int32Array | null = null;
      for (let p = 0; p < nLow; p++) {
        const c = cen[p];
        if (c < 0) {
          if (-c - 1 < centreOf.length) centreOf[-c - 1] = p;
          continue;
        }
        parent[c] = p;
        nb ??= faceNeighbours(fUp, nUp, up.getNbVertices());
        for (let k = 0; k < 3; k++) if (nb[c * 4 + k] >= 0) parent[nb[c * 4 + k]] = p;
      }
      let ok = true;
      for (let f = 0; f < nUp; f++) {
        if (parent[f] !== TRI) continue;
        const m = fUp[f * 4 + 3] === TRI ? 3 : 4;
        for (let k = 0; k < m; k++) {
          const p = centreOf[fUp[f * 4 + k]];
          if (p >= 0) {
            parent[f] = p;
            break;
          }
        }
        if (parent[f] === TRI) ok = false;
      }
      if (ok) this.parents.set(up, { below: low, parent });
    }
    if (!this.records.has(mesh)) return;
    this.baseFaces(mesh);
    this.changed(mesh);
  }

  // --- hidden faces -----------------------------------------------------------

  /** A dynamic mesh's faces moved under a stroke step or an undo (GeometrySync reports it). */
  topologyChanged(mesh: SculptMesh): void {
    if (mesh.isDynamic) this.ticks.set(mesh, (this.ticks.get(mesh) ?? 0) + 1);
  }

  private anyHidden(mesh: SculptMesh): boolean {
    const r = this.records.get(mesh);
    if (!r) return false;
    for (let i = 0; i < r.hidden.length; i++) if (r.hidden[i]) return true;
    return false;
  }

  private hiddenEntry(mesh: SculptMesh): { faces: Uint8Array; verts: Uint8Array | null } | null {
    if (!this.anyHidden(mesh)) return null;
    const r = this.rec(mesh);
    const level = mesh.isDynamic ? mesh : levelsOf(mesh)[selOf(mesh)];
    const tick = this.ticks.get(mesh) ?? 0;
    const base = mesh.isDynamic ? null : this.baseFaces(mesh);
    const n = mesh.getNbFaces();
    const hit = this.hiddenCache.get(level);
    if (hit && hit.base === base && hit.version === r.version && hit.tick === tick && hit.faces.length === n) return hit;
    const groups = this.levelFaces(mesh);
    const faces = new Uint8Array(n);
    for (let f = 0; f < n; f++) faces[f] = r.hidden[groups[f]] ?? 0;
    const entry = { base, version: r.version, tick, faces, verts: null as Uint8Array | null };
    this.hiddenCache.set(level, entry);
    return entry;
  }

  /** A flag a face of the level on screen (1 hidden), or null when nothing is hidden. */
  hiddenFaces(mesh: SculptMesh): Uint8Array | null {
    return this.hiddenEntry(mesh)?.faces ?? null;
  }

  /** A flag a vertex of the level on screen: 1 when a hidden face touches it; null when nothing is hidden. */
  hiddenVertices(mesh: SculptMesh): Uint8Array | null {
    const e = this.hiddenEntry(mesh);
    if (!e) return null;
    if (e.verts && e.verts.length === mesh.getNbVertices()) return e.verts;
    const verts = new Uint8Array(mesh.getNbVertices());
    const fAr = mesh.getFaces();
    for (let f = 0; f < e.faces.length; f++) {
      if (!e.faces[f]) continue;
      const i = f * 4;
      verts[fAr[i]] = verts[fAr[i + 1]] = verts[fAr[i + 2]] = 1;
      if (fAr[i + 3] !== TRI) verts[fAr[i + 3]] = 1;
    }
    e.verts = verts;
    return verts;
  }

  // --- display --------------------------------------------------------------

  isShowing(): boolean {
    return this.showing;
  }

  setShowing(on: boolean): void {
    this.showing = on;
  }

  /**
   * The group colours for the display (Shift+F), crisp at the borders.
   * The colour is a flat varying (Materials): each triangle takes the
   * colour of one of its corners, the provoking one (`provoking` 0, the
   * first, on WebGPU; 2, the last, on WebGL 2). So every vertex gets one
   * group's colour, and each triangle of `index` (`nTris` of them, the
   * face of each in `triFace`) is turned, its winding kept, so that its
   * provoking corner has its face's group. A vertex inside one group has
   * that group's; a vertex on a border is claimed by the first triangle
   * that has no corner of its own group yet. Owner report, 2026-11-01:
   * coloured by vertex and blended, a loop-masked group's border looked
   * ragged, the faces along it half one colour and half the other in
   * face order, though the faces were split exactly.
   */
  fillColors(mesh: SculptMesh, colors: Float32Array, index: Uint32Array, triFace: Uint32Array, nTris: number, provoking: 0 | 2): void {
    const groups = this.levelFaces(mesh);
    const fAr = mesh.getFaces();
    const nbV = Math.min(mesh.getNbVertices(), Math.floor(colors.length / 3));
    const n = Math.min(groups.length, mesh.getNbFaces());
    // Each vertex's group: one when all its faces agree, -1 (free) on a border.
    const owner = new Int32Array(nbV).fill(-2);
    for (let f = 0; f < n; f++) {
      const g = groups[f];
      const i = f * 4;
      const m = fAr[i + 3] === TRI ? 3 : 4;
      for (let k = 0; k < m; k++) {
        const v = fAr[i + k];
        if (v >= nbV) continue;
        if (owner[v] === -2) owner[v] = g;
        else if (owner[v] !== g) owner[v] = -1;
      }
    }
    // A triangle without a corner of its own group claims a free one.
    for (let t = 0; t < nTris; t++) {
      const g = groups[triFace[t]] ?? 0;
      const a = index[t * 3];
      const b = index[t * 3 + 1];
      const c = index[t * 3 + 2];
      if (owner[a] === g || owner[b] === g || owner[c] === g) continue;
      if (owner[a] === -1) owner[a] = g;
      else if (owner[b] === -1) owner[b] = g;
      else if (owner[c] === -1) owner[c] = g;
    }
    // Every triangle turned so a corner of its group provokes.
    for (let t = 0; t < nTris; t++) {
      const g = groups[triFace[t]] ?? 0;
      const o = t * 3;
      let at = -1;
      for (let k = 0; k < 3 && at < 0; k++) if (owner[index[o + k]] === g) at = k;
      if (at < 0 || at === provoking) continue;
      const a = index[o];
      const b = index[o + 1];
      const c = index[o + 2];
      // Turning by r puts corner r first; the provoking slot wants corner `at`.
      const r = (at - provoking + 3) % 3;
      index[o] = r === 0 ? a : r === 1 ? b : c;
      index[o + 1] = r === 0 ? b : r === 1 ? c : a;
      index[o + 2] = r === 0 ? c : r === 1 ? a : b;
    }
    const rgb = new Float32Array(3);
    let last = -1;
    for (let v = 0; v < nbV; v++) {
      const g = owner[v] < 0 ? 0 : owner[v];
      if (g !== last) {
        groupColor(g, rgb);
        last = g;
      }
      colors[v * 3] = rgb[0];
      colors[v * 3 + 1] = rgb[1];
      colors[v * 3 + 2] = rgb[2];
    }
  }

  // --- edits ----------------------------------------------------------------

  /**
   * One undoable change to an object's groups: `change` edits level 0's
   * array, the names and hidden flags in place and says whether it did.
   * The undo state keeps only the faces that changed, and the names and
   * flags whole (a few kilobytes at most), and writes back into the array
   * it changed (that level-0 instance's).
   */
  private edit(
    mesh: SculptMesh,
    change: (base: Uint32Array, r: GroupRecord) => boolean,
    extra?: { undo(): void; redo(): void },
  ): boolean {
    const r = this.rec(mesh);
    const base = this.baseFaces(mesh);
    const before = base.slice();
    const namesBefore = [...r.names];
    const hiddenBefore = r.hidden.slice();
    if (!change(base, r)) return false;
    let n = 0;
    for (let i = 0; i < base.length; i++) if (base[i] !== before[i]) n++;
    const at = new Uint32Array(n);
    const was = new Uint32Array(n);
    const now = new Uint32Array(n);
    n = 0;
    for (let i = 0; i < base.length; i++) {
      if (base[i] === before[i]) continue;
      at[n] = i;
      was[n] = before[i];
      now[n++] = base[i];
    }
    const namesAfter = [...r.names];
    const hiddenAfter = r.hidden.slice();
    const level0 = levelsOf(mesh)[0];
    const apply = (vals: Uint32Array, names: string[], hidden: Uint8Array): void => {
      const faces = mesh.isDynamic ? this.baseFaces(mesh) : r.byBase.get(level0);
      if (faces) for (let i = 0; i < at.length; i++) if (at[i] < faces.length) faces[at[i]] = vals[i];
      r.names = [...names];
      r.hidden = hidden.slice();
      this.changed(mesh);
      this.host.render();
    };
    this.host.getStateManager().pushStateCustom(
      () => {
        extra?.undo();
        apply(was, namesBefore, hiddenBefore);
      },
      () => {
        extra?.redo();
        apply(now, namesAfter, hiddenAfter);
      },
    );
    extra?.redo();
    this.changed(mesh);
    this.host.render();
    return true;
  }

  /**
   * Flags one a face of the level on screen (1: the face qualifies)
   * rounded to level 0 by share: a level-0 face joins when MORE than half
   * of its faces on screen qualify; exactly half stays out. Level 0's own
   * flags are returned as they are.
   *
   * Owner report, 2026-11-01: the rounding used to go level by level, a
   * face taking what most of its four children had and its earliest child
   * on a two-two tie. Which child is earliest turns with each base face's
   * corner order, so a loop drawn across the middle of a row of base
   * faces split that row unevenly (24 of 32 faces in on the default
   * sphere, 8 out, wherever the loop ran within the row). By share, a
   * level-0 face's decision does not depend on its corner order: the
   * group snaps to the base-face loop nearest the drawn one, the whole row
   * alike, and a loop along base-face edges is followed exactly.
   */
  roundDown(mesh: SculptMesh, values: Uint32Array): Uint32Array {
    const nBase = this.baseFaces(mesh).length;
    if (mesh.isDynamic || selOf(mesh) === 0) return values.subarray(0, nBase);
    const { map, shift } = this.ancestry(mesh, selOf(mesh));
    const total = new Uint32Array(nBase);
    const hit = new Uint32Array(nBase);
    for (let f = 0; f < values.length; f++) {
      const a = map ? map[f >> shift] : f >> shift;
      if (a >= nBase) continue;
      total[a]++;
      if (values[f]) hit[a]++;
    }
    const out = new Uint32Array(nBase);
    for (let a = 0; a < nBase; a++) out[a] = 2 * hit[a] > total[a] ? 1 : 0;
    return out;
  }

  /**
   * Group numbers one a face of the level on screen, rounded to level 0
   * level by level (each face the group most of its children have, the
   * earliest child on a tie; By angle's 'vote').
   */
  private majorityLevels(mesh: SculptMesh, values: Uint32Array): Uint32Array {
    const nBase = this.baseFaces(mesh).length;
    if (mesh.isDynamic) return values.subarray(0, nBase);
    const levels = levelsOf(mesh);
    let cur = values;
    for (let k = Math.min(selOf(mesh), levels.length - 1); k >= 1; k--) {
      cur = majorityDown(cur, this.parentMap(levels, k), levels[k - 1].getNbFaces());
    }
    return cur;
  }

  private newName(r: GroupRecord): string {
    let k = r.names.length;
    const taken = new Set(r.names);
    while (taken.has(defaultGroupName(k))) k++;
    return defaultGroupName(k);
  }

  /** Whether the last fromMask's group differs from the mask on screen (rounded to base faces). */
  lastSnapped = false;

  /**
   * Ctrl+W: the masked faces into a new group. A face of the level on
   * screen is masked when every one of its corners is (mask under 0.5);
   * hidden faces stay where they are. Groups are level 0's, so the
   * masked faces are rounded down to level 0 by share (roundDown). The
   * mask is cleared in the same undo step (owner call, 2026-11-01: mask
   * from the group afterwards, Ctrl+click). Returns the new group, -1
   * when no face is masked, -2 when none is left at level 0.
   */
  fromMask(mesh: SculptMesh): number {
    const r = this.rec(mesh);
    const mat = mesh.getMaterials();
    const fAr = mesh.getFaces();
    const n = mesh.getNbFaces();
    const hidden = this.hiddenFaces(mesh);
    const flags = new Uint32Array(n);
    let any = false;
    for (let f = 0; f < n; f++) {
      if (hidden && hidden[f]) continue;
      const i = f * 4;
      const m = fAr[i + 3] === TRI ? 3 : 4;
      let all = true;
      for (let k = 0; k < m && all; k++) if (!(mat[fAr[i + k] * 3 + 2] < 0.5)) all = false;
      if (all) {
        flags[f] = 1;
        any = true;
      }
    }
    if (!any) return -1;
    const joins = this.roundDown(mesh, flags);
    if (!joins.some((x) => x !== 0)) return -2;
    if (r.names.length >= MAX_GROUPS) throw new TooManyGroups(`An object can have at most ${MAX_GROUPS} poly groups.`);
    // Does the group follow the mask exactly, face for face on screen?
    const { map, shift } = this.ancestry(mesh, selOf(mesh));
    this.lastSnapped = false;
    for (let f = 0; f < n && !this.lastSnapped; f++) {
      if (hidden && hidden[f]) continue;
      const a = map ? map[f >> shift] : f >> shift;
      if ((joins[a] ?? 0) !== flags[f]) this.lastSnapped = true;
    }
    const g = r.names.length;
    this.edit(
      mesh,
      (base, rr) => {
        rr.names.push(this.newName(rr));
        const hid = new Uint8Array(rr.names.length);
        hid.set(rr.hidden);
        rr.hidden = hid;
        for (let a = 0; a < joins.length; a++) if (joins[a]) base[a] = g;
        return true;
      },
      this.maskClearing(mesh),
    );
    return g;
  }

  /** Clearing the mask of the level on screen, and putting it back: an edit's extra. */
  private maskClearing(mesh: SculptMesh): { undo(): void; redo(): void } {
    const mat = mesh.getMaterials();
    const nbV = mesh.getNbVertices();
    const at: number[] = [];
    const was: number[] = [];
    for (let v = 0; v < nbV; v++) {
      if (mat[v * 3 + 2] !== 1) {
        at.push(v);
        was.push(mat[v * 3 + 2]);
      }
    }
    const write = (vals: number[] | null): void => {
      const m = mesh.getMaterials();
      for (let i = 0; i < at.length; i++) if (at[i] * 3 + 2 < m.length) m[at[i] * 3 + 2] = vals ? vals[i] : 1;
      mesh.updateDuplicateColorsAndMaterials();
      if (mesh.isUsingDrawArrays?.()) mesh.updateDrawArrays();
      if (mesh.isDynamic) mesh.updateBuffers();
      else mesh.updateMaterialBuffer();
    };
    return { undo: () => write(was), redo: () => write(null) };
  }

  /**
   * Replace every group with a numbered set: `perFace` one a level-0
   * face, numbered from 0, `names` theirs. Shows everything.
   */
  private replaceAll(mesh: SculptMesh, perFace: Uint32Array, names: string[]): boolean {
    if (names.length > MAX_GROUPS) {
      throw new TooManyGroups(`That makes ${names.length} groups, and an object can have at most ${MAX_GROUPS}.`);
    }
    return this.edit(mesh, (base, r) => {
      r.names = names.map((n) => n.slice(0, MAX_NAME));
      r.hidden = new Uint8Array(names.length);
      base.set(perFace.subarray(0, base.length));
      return true;
    });
  }

  /**
   * Group by angle, on level 0's faces (`method` 'level0', the default):
   * each level-0 face's normal is the sum of its faces' on the level on
   * screen (the vendor's face normals are area-weighted, so it is the
   * area-weighted mean of the surface as it is now, sculpted detail
   * included, whatever level 0's own vertices say), and level 0 is split
   * wherever two neighbouring faces' normals are more than `degrees`
   * apart, each connected piece a group, numbered by its first face.
   * 'vote' splits the level on screen instead and rounds the pieces down
   * to level 0 (majorityLevels), groups numbered by their first level-0 face
   * and a piece no level-0 face keeps dropped (kept for comparison: the
   * tests measure both).
   */
  byAngle(mesh: SculptMesh, degrees: number, method: 'level0' | 'vote' = 'level0'): number {
    const cos = Math.cos((Math.min(180, Math.max(0, degrees)) * Math.PI) / 180);
    const raw = mesh.getFaceNormals();
    const nScreen = mesh.getNbFaces();
    if (method === 'vote') {
      const normals = new Float32Array(nScreen * 3);
      for (let f = 0; f < nScreen * 3; f++) normals[f] = raw[f];
      unitise(normals, nScreen);
      const nb = faceNeighbours(mesh.getFaces(), nScreen, mesh.getNbVertices());
      const { perFace } = floodByAngle(nb, normals, nScreen, cos);
      const rounded = this.majorityLevels(mesh, perFace);
      const renumber = new Map<number, number>();
      const out = new Uint32Array(rounded.length);
      for (let a = 0; a < rounded.length; a++) {
        let g = renumber.get(rounded[a]);
        if (g === undefined) {
          g = renumber.size;
          renumber.set(rounded[a], g);
        }
        out[a] = g;
      }
      const names = Array.from({ length: renumber.size }, (_, i) => defaultGroupName(i));
      this.replaceAll(mesh, out, names);
      return renumber.size;
    }
    const level0 = mesh.isDynamic ? mesh : levelsOf(mesh)[0];
    const n = level0.getNbFaces();
    const nb = faceNeighbours(level0.getFaces(), n, level0.getNbVertices());
    const normals = new Float32Array(n * 3);
    const { map, shift } = this.ancestry(mesh, selOf(mesh));
    for (let f = 0; f < nScreen; f++) {
      const a = map ? map[f >> shift] : f >> shift;
      if (a >= n) continue;
      normals[a * 3] += raw[f * 3];
      normals[a * 3 + 1] += raw[f * 3 + 1];
      normals[a * 3 + 2] += raw[f * 3 + 2];
    }
    unitise(normals, n);
    const { perFace, groups } = floodByAngle(nb, normals, n, cos);
    const names = Array.from({ length: groups }, (_, i) => defaultGroupName(i));
    this.replaceAll(mesh, perFace, names);
    return groups;
  }

  /**
   * Groups given level 0's faces (an OBJ's g/o lines, its UV islands): one
   * a level-0 face, names theirs. Not undoable when `undoable` is false
   * (the import, which is its own undo step).
   */
  fromLevel0(mesh: SculptMesh, perFace: Uint32Array, names: string[], undoable = true): boolean {
    const levels = levelsOf(mesh);
    if (perFace.length !== levels[0].getNbFaces()) return false;
    if (!undoable) {
      const r = this.rec(mesh);
      r.names = names.slice(0, MAX_GROUPS).map((n) => n.slice(0, MAX_NAME));
      r.hidden = new Uint8Array(r.names.length);
      if (mesh.isDynamic) this.baseFaces(mesh).set(perFace);
      else r.byBase.set(levels[0], new Uint32Array(perFace));
      this.changed(mesh);
      return true;
    }
    return this.replaceAll(mesh, perFace, names);
  }

  /**
   * Visible: every face that shows becomes one new group; hidden faces
   * keep theirs. Groups left with no faces are dropped (the rest keep
   * their order). Returns the new group's number, or -1 when nothing
   * shows.
   */
  groupVisible(mesh: SculptMesh): number {
    const r = this.rec(mesh);
    const base = this.baseFaces(mesh);
    let any = false;
    for (let i = 0; i < base.length && !any; i++) if (!r.hidden[base[i]]) any = true;
    if (!any) return -1;
    if (r.names.length >= MAX_GROUPS) throw new TooManyGroups(`An object can have at most ${MAX_GROUPS} poly groups.`);
    let made = -1;
    this.edit(mesh, (b, rr) => {
      const name = this.newName(rr);
      const g = rr.names.length;
      rr.names.push(name);
      const hid = new Uint8Array(rr.names.length);
      hid.set(rr.hidden);
      rr.hidden = hid;
      for (let i = 0; i < b.length; i++) if (!rr.hidden[b[i]]) b[i] = g;
      made = compact(b, rr)[g];
      return true;
    });
    return made;
  }

  /**
   * Auto: each connected piece of level 0 (faces joined across shared
   * edges) its own group, numbered by its first face, everything shown.
   * Returns how many groups.
   */
  autoIslands(mesh: SculptMesh): number {
    const level0 = levelsOf(mesh)[0];
    const n = level0.getNbFaces();
    const nb = faceNeighbours(level0.getFaces(), n, level0.getNbVertices());
    const { perFace, groups } = floodByAngle(nb, new Float32Array(n * 3), n, -Infinity);
    this.replaceAll(mesh, perFace, Array.from({ length: groups }, (_, i) => defaultGroupName(i)));
    return groups;
  }

  /** Clear all: every face back in one group, "Group 1", nothing hidden. False when that is how it is already. */
  clearAll(mesh: SculptMesh): boolean {
    if (!this.hasGroups(mesh) && !this.baseFaces(mesh).some((g) => g !== 0)) return false;
    return this.replaceAll(mesh, new Uint32Array(this.baseFaces(mesh).length), [defaultGroupName(0)]);
  }

  /**
   * Remove unused: drop the groups no face is in any more (after Visible,
   * a delete or a split), keeping the rest in order with their names and
   * hidden flags. Returns how many went; 0 changes nothing.
   */
  removeUnused(mesh: SculptMesh): number {
    const used = this.used(mesh);
    let unused = 0;
    for (let g = 0; g < used.length; g++) if (!used[g]) unused++;
    if (unused === 0 || unused === used.length) return 0;
    this.edit(mesh, (b, r) => {
      compact(b, r);
      return true;
    });
    return unused;
  }

  rename(mesh: SculptMesh, g: number, name: string): boolean {
    const clean = name.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_NAME);
    const r = this.rec(mesh);
    if (!clean || g < 0 || g >= r.names.length || r.names[g] === clean) return false;
    return this.edit(mesh, (_b, rr) => {
      rr.names[g] = clean;
      return true;
    });
  }

  /** Hide or show one group (the list's eye). */
  setHidden(mesh: SculptMesh, g: number, hidden: boolean): boolean {
    const r = this.rec(mesh);
    if (g < 0 || g >= r.names.length || !!r.hidden[g] === hidden) return false;
    return this.edit(mesh, (_b, rr) => {
      rr.hidden[g] = hidden ? 1 : 0;
      return true;
    });
  }

  /** Show all: every group of the object visible again. */
  showAll(mesh: SculptMesh): boolean {
    if (!this.anyHidden(mesh)) return false;
    return this.edit(mesh, (_b, r) => {
      r.hidden.fill(0);
      return true;
    });
  }

  /** The groups level 0 has faces in. */
  private used(mesh: SculptMesh): Uint8Array {
    const r = this.rec(mesh);
    const out = new Uint8Array(r.names.length);
    const base = this.baseFaces(mesh);
    for (let i = 0; i < base.length; i++) if (base[i] < out.length) out[base[i]] = 1;
    return out;
  }

  /**
   * Ctrl+Shift+click on a group: show it alone; on the only group showing,
   * hide it and show the rest (nothing changes when there is no rest).
   */
  isolate(mesh: SculptMesh, g: number): 'isolated' | 'inverted' | null {
    const r = this.rec(mesh);
    if (g < 0 || g >= r.names.length) return null;
    const used = this.used(mesh);
    let othersShowing = false;
    let others = false;
    for (let i = 0; i < used.length; i++) {
      if (i === g || !used[i]) continue;
      others = true;
      if (!r.hidden[i]) othersShowing = true;
    }
    if (othersShowing || r.hidden[g]) {
      this.edit(mesh, (_b, rr) => {
        for (let i = 0; i < rr.hidden.length; i++) rr.hidden[i] = i === g ? 0 : 1;
        return true;
      });
      return 'isolated';
    }
    if (!others) return null;
    this.edit(mesh, (_b, rr) => {
      for (let i = 0; i < rr.hidden.length; i++) rr.hidden[i] = i === g ? 1 : 0;
      return true;
    });
    return 'inverted';
  }

  /**
   * Delete a group: its faces join the group they border most (counted
   * over level 0's edges, the lowest-numbered on a tie), or group 0 when
   * they border no other (a separate piece). The groups after it move
   * down one. The last group cannot go.
   */
  remove(mesh: SculptMesh, g: number): boolean {
    const r = this.rec(mesh);
    if (g < 0 || g >= r.names.length || r.names.length <= 1) return false;
    const level0 = levelsOf(mesh)[0];
    const base = this.baseFaces(mesh);
    const border = new Float64Array(r.names.length);
    if (base.includes(g)) {
      const nb = faceNeighbours(level0.getFaces(), level0.getNbFaces(), level0.getNbVertices());
      for (let f = 0; f < base.length; f++) {
        if (base[f] !== g) continue;
        for (let k = 0; k < 4; k++) {
          const o = nb[f * 4 + k];
          if (o >= 0 && base[o] !== g) border[base[o]]++;
        }
      }
    }
    let into = g === 0 ? 1 : 0;
    let most = 0;
    for (let i = 0; i < border.length; i++) {
      if (i !== g && border[i] > most) {
        most = border[i];
        into = i;
      }
    }
    const target = into > g ? into - 1 : into;
    return this.edit(mesh, (b, rr) => {
      for (let i = 0; i < b.length; i++) {
        const v = b[i];
        if (v === g) b[i] = target;
        else if (v > g) b[i] = v - 1;
      }
      rr.names.splice(g, 1);
      const hid = new Uint8Array(rr.names.length);
      for (let i = 0, j = 0; i < rr.hidden.length; i++) if (i !== g) hid[j++] = rr.hidden[i];
      rr.hidden = hid;
      return true;
    });
  }

  /**
   * Ctrl+click (+Alt) on a group: mask (unmask) every vertex of its faces
   * on the level on screen, into the undo state the caller has open (the
   * mask stroke the press began), or one of its own. Hidden faces are
   * left alone. Returns how many vertices it touched.
   */
  maskGroup(mesh: SculptMesh, face: number, unmask: boolean, ownState = false): number {
    const g = this.groupOfFace(mesh, face);
    if (g < 0) return 0;
    const groups = this.levelFaces(mesh);
    const hidden = this.hiddenFaces(mesh);
    const fAr = mesh.getFaces();
    const nbV = mesh.getNbVertices();
    const tag = new Uint8Array(nbV);
    const list: number[] = [];
    for (let f = 0; f < groups.length; f++) {
      if (groups[f] !== g || (hidden && hidden[f])) continue;
      const i = f * 4;
      const m = fAr[i + 3] === TRI ? 3 : 4;
      for (let k = 0; k < m; k++) {
        const v = fAr[i + k];
        if (!tag[v]) {
          tag[v] = 1;
          list.push(v);
        }
      }
    }
    if (!list.length) return 0;
    const iVerts = Uint32Array.from(list);
    const sm = this.host.getStateManager();
    if (ownState) sm.pushStateColorAndMaterial(mesh);
    sm.pushVertices(iVerts);
    const mat = mesh.getMaterials();
    const value = unmask ? 1 : 0;
    for (let i = 0; i < iVerts.length; i++) mat[iVerts[i] * 3 + 2] = value;
    mesh.updateDuplicateColorsAndMaterials();
    mesh.updateMaterialBuffer();
    this.host.render();
    return iVerts.length;
  }

  // --- carrying groups across -------------------------------------------------

  /** The groups record of an object for a scene file (version 2, level 0's), or undefined when it has none worth keeping. */
  serialize(mesh: SculptMesh): SavedGroups | undefined {
    if (!this.hasGroups(mesh)) return undefined;
    const r = this.rec(mesh);
    const out: SavedGroups = { v: GROUPS_V, faces: new Uint32Array(this.baseFaces(mesh)), names: [...r.names] };
    if (r.hidden.some((h) => h !== 0)) out.hidden = r.hidden.slice();
    return out;
  }

  /** An object's groups from a scene record (sanitizeGroups checked it, a version 1 one made level 0's); false when it does not fit. */
  restore(mesh: SculptMesh, saved: SavedGroups | undefined): boolean {
    if (!saved) return false;
    const level0 = levelsOf(mesh)[0];
    if (saved.faces.length !== level0.getNbFaces()) return false;
    const r = this.rec(mesh);
    r.names = [...saved.names];
    r.hidden = new Uint8Array(saved.names.length);
    if (saved.hidden) r.hidden.set(saved.hidden.subarray(0, r.names.length));
    if (mesh.isDynamic) this.baseFaces(mesh).set(saved.faces);
    else r.byBase.set(level0, new Uint32Array(saved.faces));
    this.changed(mesh);
    return true;
  }

  /**
   * Dynamic topology on: the new mesh (one level, so its faces are its
   * level 0) has the level on screen's faces in order as triangles (a
   * quad two), so each takes its face's group. Off: the static mesh's
   * faces (its level 0) are the dynamic ones in order. The names and the
   * hidden flags go along either way.
   */
  carryTopology(from: SculptMesh, to: SculptMesh): void {
    if (!this.records.has(from)) return;
    const src = this.levelFaces(from);
    const r = this.rec(from);
    const out = new Uint32Array(levelsOf(to)[0].getNbFaces());
    if (to.isDynamic && !from.isDynamic) {
      const fAr = from.getFaces();
      let t = 0;
      for (let f = 0; f < src.length && t < out.length; f++) {
        out[t++] = src[f];
        if (fAr[f * 4 + 3] !== TRI && t < out.length) out[t++] = src[f];
      }
    } else {
      out.set(src.subarray(0, Math.min(src.length, out.length)));
    }
    const dst = this.rec(to);
    dst.names = [...r.names];
    dst.hidden = r.hidden.slice();
    if (to.isDynamic) this.baseFaces(to).set(out);
    else dst.byBase.set(levelsOf(to)[0], out);
    this.changed(to);
  }

  /**
   * Remesh, quad remesh, merge, extract: each face of `to`'s level 0 (the
   * results have one level) takes the group of the nearest face centre
   * among the sources' on their level on screen (world space). Names are
   * united by name, in source order; a group is hidden when it was in the
   * first source that has it. Nothing is done when no source has groups.
   */
  transferNearest(sources: SculptMesh[], to: SculptMesh): void {
    const withGroups = sources.filter((m) => this.hasGroups(m));
    if (!withGroups.length) return;
    const names: string[] = [];
    const hidden: number[] = [];
    const ids = new Map<string, number>();
    let total = 0;
    const parts: { centres: Float32Array; groups: Uint32Array; map: Uint32Array }[] = [];
    for (const src of sources) {
      const r = this.rec(src);
      const map = new Uint32Array(r.names.length);
      r.names.forEach((n, i) => {
        let id = ids.get(n);
        if (id === undefined) {
          id = names.length;
          ids.set(n, id);
          names.push(n);
          hidden.push(r.hidden[i] ? 1 : 0);
        }
        map[i] = id;
      });
      const level = src.isDynamic ? src : levelsOf(src)[selOf(src)];
      const groups = this.levelFaces(src);
      const centres = worldCentres(level, src.getMatrix());
      parts.push({ centres, groups, map });
      total += groups.length;
    }
    const all = new Float32Array(total * 3);
    const allGroups = new Uint32Array(total);
    let at = 0;
    for (const p of parts) {
      all.set(p.centres, at * 3);
      for (let i = 0; i < p.groups.length; i++) allGroups[at + i] = p.map[p.groups[i]] ?? 0;
      at += p.groups.length;
    }
    const grid = new PointGrid(all);
    const level = levelsOf(to)[0];
    const centres = worldCentres(level, to.getMatrix());
    const out = new Uint32Array(level.getNbFaces());
    for (let f = 0; f < out.length; f++) {
      const j = grid.nearest(centres[f * 3], centres[f * 3 + 1], centres[f * 3 + 2]);
      out[f] = j >= 0 ? allGroups[j] : 0;
    }
    const dst = this.rec(to);
    dst.names = names.slice(0, MAX_GROUPS);
    dst.hidden = Uint8Array.from(hidden.slice(0, MAX_GROUPS));
    if (to.isDynamic) this.baseFaces(to).set(out);
    else dst.byBase.set(level, out);
    this.changed(to);
  }

  /** A changed level or topology: tell the listeners (display, list), without an edit. */
  touch(mesh: SculptMesh): void {
    this.changed(mesh);
  }
}

/**
 * Drop the groups no face of `base` is in, in place: the rest keep their
 * order, names and hidden flags, and the faces are renumbered. Returns the
 * new number of each old group (-1 for one dropped). Group 0 stays when
 * nothing is left.
 */
function compact(base: Uint32Array, r: { names: string[]; hidden: Uint8Array }): Int32Array {
  const used = new Uint8Array(r.names.length);
  for (let i = 0; i < base.length; i++) if (base[i] < used.length) used[base[i]] = 1;
  if (!used.some((u) => u)) used[0] = 1;
  const to = new Int32Array(r.names.length).fill(-1);
  const names: string[] = [];
  const hidden: number[] = [];
  for (let g = 0; g < r.names.length; g++) {
    if (!used[g]) continue;
    to[g] = names.length;
    names.push(r.names[g]);
    hidden.push(r.hidden[g] ?? 0);
  }
  for (let i = 0; i < base.length; i++) base[i] = Math.max(0, to[base[i]] ?? 0);
  r.names = names;
  r.hidden = Uint8Array.from(hidden);
  return to;
}

/** Normals made unit, three a face, in place. */
function unitise(normals: Float32Array, n: number): void {
  for (let a = 0; a < n; a++) {
    const len = Math.hypot(normals[a * 3], normals[a * 3 + 1], normals[a * 3 + 2]) || 1;
    normals[a * 3] /= len;
    normals[a * 3 + 1] /= len;
    normals[a * 3 + 2] /= len;
  }
}

/**
 * Faces split wherever two neighbours' unit normals are further apart
 * than `cos`: each connected piece a group, numbered by its first face.
 */
function floodByAngle(nb: Int32Array, normals: Float32Array, n: number, cos: number): { perFace: Uint32Array; groups: number } {
  const perFace = new Uint32Array(n).fill(TRI);
  const stack = new Int32Array(n);
  let groups = 0;
  for (let seed = 0; seed < n; seed++) {
    if (perFace[seed] !== TRI) continue;
    const g = groups++;
    perFace[seed] = g;
    let sp = 0;
    stack[sp++] = seed;
    while (sp) {
      const f = stack[--sp];
      for (let k = 0; k < 4; k++) {
        const o = nb[f * 4 + k];
        if (o < 0 || perFace[o] !== TRI) continue;
        const dot = normals[f * 3] * normals[o * 3] + normals[f * 3 + 1] * normals[o * 3 + 1] + normals[f * 3 + 2] * normals[o * 3 + 2];
        if (dot < cos) continue;
        perFace[o] = g;
        stack[sp++] = o;
      }
    }
  }
  return { perFace, groups };
}

/** A level's face centres through a matrix (world space), three a face. */
function worldCentres(level: SculptMesh, m: Float32Array): Float32Array {
  const n = level.getNbFaces();
  const fAr = level.getFaces();
  const v = level.getVertices();
  const out = new Float32Array(n * 3);
  for (let f = 0; f < n; f++) {
    const i = f * 4;
    const k = fAr[i + 3] === TRI ? 3 : 4;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let c = 0; c < k; c++) {
      const j = fAr[i + c] * 3;
      x += v[j];
      y += v[j + 1];
      z += v[j + 2];
    }
    x /= k;
    y /= k;
    z /= k;
    out[f * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[f * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[f * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}
