import Picking from '@sculpt-vendor/math3d/Picking';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import { GROUPS_V, MAX_GROUPS, MAX_NAME } from '../../../shared/bozz';
import { PointGrid } from './quadMesh';

/**
 * Poly groups (owner decisions, 2026-10-31; the model matches Bozzetto
 * Studio's core, so a .bozz round-trips between the two).
 *
 * The model. Every face of an object's TOP subdivision level is in one
 * group: a u32 a face, and a names array indexed by group number (group 0
 * is "Group 1" until renamed). Only the top level is stored. A lower
 * level's groups are derived, never stored: a face takes the group most of
 * its four children have, and on a tie the group of the earliest child
 * among the tied ones, level by level down from the top.
 *
 * Children. SculptGL's full subdivision (vendor editing/Subdivision.js,
 * applyOddSmooth) writes face f's children at 4f..4f+3 of the level above,
 * for triangles and quads alike, and keeps the faces' order:
 *
 * - a quad (v1 v2 v3 v4) gives 4f+k = the quad at corner v(k+1): 4f the
 *   one at v1 (v1 m1 c m4), 4f+1 at v2 (m1 v2 m2 c), 4f+2 at v3 (c m2 v3
 *   m3), 4f+3 at v4 (m4 c m3 v4), m the edge midpoints, c the centre;
 * - a triangle (v1 v2 v3) gives 4f = the middle triangle (m1 m2 m3),
 *   4f+1 the one at v1 (v1 m1 m3), 4f+2 at v2 (m1 v2 m2), 4f+3 at v3
 *   (m3 m2 v3). The middle one is first, so it wins a triangle's ties.
 *
 * So a face's descendants k levels up are the contiguous range
 * f*4^k..(f+1)*4^k-1 of that level, and assigning a group at a lower
 * level assigns every top-level face under it. Subdividing gives each new
 * face its parent's group. Deleting the top level makes the level below
 * the top, its derived groups now its stored ones.
 *
 * Where it lives. Per object: the names, a hidden flag a group, and a
 * version that moves with every change. The faces are kept per LEVEL
 * INSTANCE (a WeakMap), only the top's read: an undo that brings back a
 * deleted top level brings back its own array with it, and a level added
 * since takes its groups from the highest level below it that has some.
 * A dynamic-topology mesh keeps its faces' groups in the vendor's own
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
  /** Faces' groups by level instance; the top's is the one that counts. */
  byLevel: WeakMap<object, Uint32Array>;
}

/** The level instances of an object, base first (a dynamic mesh is its own one level). */
const levelsOf = (mesh: SculptMesh): SculptMesh[] => mesh._meshes ?? [mesh];
const selOf = (mesh: SculptMesh): number => (mesh._meshes ? (mesh as unknown as { _sel: number })._sel : 0);

/** The group most of a face's four children have; on a tie the earliest child's. */
function majority(c: Uint32Array, i: number): number {
  const a = c[i];
  const b = c[i + 1];
  const d = c[i + 2];
  const e = c[i + 3];
  let best = a;
  let bestN = 1 + (b === a ? 1 : 0) + (d === a ? 1 : 0) + (e === a ? 1 : 0);
  if (bestN >= 3) return a;
  const nb = 1 + (a === b ? 1 : 0) + (d === b ? 1 : 0) + (e === b ? 1 : 0);
  if (nb > bestN) {
    best = b;
    bestN = nb;
  }
  const nd = 1 + (a === d ? 1 : 0) + (b === d ? 1 : 0) + (e === d ? 1 : 0);
  if (nd > bestN) {
    best = d;
    bestN = nd;
  }
  const ne = 1 + (a === e ? 1 : 0) + (b === e ? 1 : 0) + (d === e ? 1 : 0);
  if (ne > bestN) best = e;
  return best;
}

/** The level below's groups from a level's (`nbBelow` faces). */
export function deriveDown(above: Uint32Array, nbBelow: number): Uint32Array {
  const out = new Uint32Array(nbBelow);
  for (let p = 0; p < nbBelow; p++) out[p] = majority(above, p * 4);
  return out;
}

/** The level above's groups from a level's: each child its parent's. */
export function inheritUp(below: Uint32Array): Uint32Array {
  const out = new Uint32Array(below.length * 4);
  for (let p = 0; p < below.length; p++) {
    const g = below[p];
    const i = p * 4;
    out[i] = out[i + 1] = out[i + 2] = out[i + 3] = g;
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
  /** Derived lower levels, by level instance: valid for one top array at one version. */
  private readonly derived = new WeakMap<object, { top: Uint32Array; version: number; faces: Uint32Array }>();
  /** The hidden flags of the level on screen, by level instance, as `derived` is kept. */
  private readonly hiddenCache = new WeakMap<object, { top: Uint32Array | null; version: number; tick: number; faces: Uint8Array; verts: Uint8Array | null }>();
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
      r = { names: [defaultGroupName(0)], hidden: new Uint8Array(1), version: 0, byLevel: new WeakMap() };
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

  /** The top level instance (the one whose faces are stored). */
  topLevel(mesh: SculptMesh): SculptMesh {
    const levels = levelsOf(mesh);
    return levels[levels.length - 1];
  }

  /**
   * The top level's groups, one a face: the array itself, which edits
   * write into. A top level with none yet takes them from the highest
   * level below it that has some, each face its parent's (a level added
   * since); an object with none at all starts in group 0.
   */
  topFaces(mesh: SculptMesh): Uint32Array {
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
    const top = levels.length - 1;
    const own = r.byLevel.get(levels[top]);
    if (own && own.length === levels[top].getNbFaces()) return own;
    let i = top - 1;
    let from: Uint32Array | null = null;
    for (; i >= 0; i--) {
      const a = r.byLevel.get(levels[i]);
      if (a && a.length === levels[i].getNbFaces()) {
        from = a;
        break;
      }
    }
    let faces: Uint32Array;
    if (!from) faces = new Uint32Array(levels[top].getNbFaces());
    else {
      faces = from;
      for (let k = i + 1; k <= top; k++) faces = inheritUp(faces);
      // A level that is not four faces a face below (never made by Sculpt) starts over.
      if (faces.length !== levels[top].getNbFaces()) faces = new Uint32Array(levels[top].getNbFaces());
    }
    r.byLevel.set(levels[top], faces);
    return faces;
  }

  /** The groups of level `k` of the object (the top's own array at the top; derived below). */
  levelFaces(mesh: SculptMesh, k = selOf(mesh)): Uint32Array {
    const top = this.topFaces(mesh);
    if (mesh.isDynamic) return top;
    const levels = levelsOf(mesh);
    const t = levels.length - 1;
    if (k >= t) return top;
    const version = this.rec(mesh).version;
    let faces = top;
    for (let j = t - 1; j >= k; j--) {
      const lv = levels[j];
      const hit = this.derived.get(lv);
      if (hit && hit.top === top && hit.version === version && hit.faces.length === lv.getNbFaces()) {
        faces = hit.faces;
        continue;
      }
      faces = deriveDown(faces, lv.getNbFaces());
      this.derived.set(lv, { top, version, faces });
    }
    return faces;
  }

  /** The group of a face of the level on screen. */
  groupOfFace(mesh: SculptMesh, face: number): number {
    const g = this.levelFaces(mesh);
    return face >= 0 && face < g.length ? g[face] : -1;
  }

  /** How many top-level faces each group has. */
  counts(mesh: SculptMesh): number[] {
    const out = new Array<number>(this.rec(mesh).names.length).fill(0);
    const faces = this.topFaces(mesh);
    for (let i = 0; i < faces.length; i++) if (faces[i] < out.length) out[faces[i]]++;
    return out;
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
    const top = mesh.isDynamic ? null : this.topFaces(mesh);
    const n = mesh.getNbFaces();
    const hit = this.hiddenCache.get(level);
    if (hit && hit.top === top && hit.version === r.version && hit.tick === tick && hit.faces.length === n) return hit;
    const groups = this.levelFaces(mesh);
    const faces = new Uint8Array(n);
    for (let f = 0; f < n; f++) faces[f] = r.hidden[groups[f]] ?? 0;
    const entry = { top, version: r.version, tick, faces, verts: null as Uint8Array | null };
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
   * Each vertex's group colour for the display (Shift+F): every face
   * writes its colour into its corners, in face order, so a vertex on a
   * border takes one of its groups' and the colour turns over one face.
   */
  fillColors(mesh: SculptMesh, out: Float32Array): void {
    const groups = this.levelFaces(mesh);
    const fAr = mesh.getFaces();
    const n = Math.min(groups.length, mesh.getNbFaces());
    const rgb = new Float32Array(3);
    let last = -1;
    for (let f = 0; f < n; f++) {
      const g = groups[f];
      if (g !== last) {
        groupColor(g, rgb);
        last = g;
      }
      const i = f * 4;
      const m = fAr[i + 3] === TRI ? 3 : 4;
      for (let k = 0; k < m; k++) {
        const v = fAr[i + k] * 3;
        if (v + 2 >= out.length) continue;
        out[v] = rgb[0];
        out[v + 1] = rgb[1];
        out[v + 2] = rgb[2];
      }
    }
  }

  // --- edits ----------------------------------------------------------------

  /**
   * One undoable change to an object's groups: `change` edits the top
   * array, names and hidden flags in place and says whether it did. The
   * undo state keeps only the faces that changed, and the names and flags
   * whole (a few kilobytes at most).
   */
  private edit(mesh: SculptMesh, change: (top: Uint32Array, r: GroupRecord) => boolean): boolean {
    const r = this.rec(mesh);
    const level = this.topLevel(mesh);
    const top = this.topFaces(mesh);
    const before = top.slice();
    const namesBefore = [...r.names];
    const hiddenBefore = r.hidden.slice();
    if (!change(top, r)) return false;
    let n = 0;
    for (let i = 0; i < top.length; i++) if (top[i] !== before[i]) n++;
    const at = new Uint32Array(n);
    const was = new Uint32Array(n);
    const now = new Uint32Array(n);
    n = 0;
    for (let i = 0; i < top.length; i++) {
      if (top[i] === before[i]) continue;
      at[n] = i;
      was[n] = before[i];
      now[n++] = top[i];
    }
    const namesAfter = [...r.names];
    const hiddenAfter = r.hidden.slice();
    const apply = (vals: Uint32Array, names: string[], hidden: Uint8Array): void => {
      const faces = mesh.isDynamic ? this.topFaces(mesh) : r.byLevel.get(level);
      if (faces) for (let i = 0; i < at.length; i++) if (at[i] < faces.length) faces[at[i]] = vals[i];
      r.names = [...names];
      r.hidden = hidden.slice();
      this.changed(mesh);
      this.host.render();
    };
    this.host.getStateManager().pushStateCustom(
      () => apply(was, namesBefore, hiddenBefore),
      () => apply(now, namesAfter, hiddenAfter),
    );
    this.changed(mesh);
    this.host.render();
    return true;
  }

  /** Every top-level face under the flagged faces of the level on screen, to group `g`. */
  private assignFromLevel(mesh: SculptMesh, top: Uint32Array, flags: Uint8Array, g: number): void {
    if (mesh.isDynamic) {
      for (let f = 0; f < flags.length; f++) if (flags[f]) top[f] = g;
      return;
    }
    const levels = levelsOf(mesh);
    const shift = 2 * (levels.length - 1 - selOf(mesh));
    for (let f = 0; f < flags.length; f++) {
      if (!flags[f]) continue;
      top.fill(g, f * 2 ** shift, (f + 1) * 2 ** shift);
    }
  }

  private newName(r: GroupRecord): string {
    let k = r.names.length;
    const taken = new Set(r.names);
    while (taken.has(defaultGroupName(k))) k++;
    return defaultGroupName(k);
  }

  /**
   * Ctrl+W: the masked faces of the level on screen into a new group. A
   * face is masked when every one of its corners is (mask under 0.5);
   * hidden faces stay where they are. Nothing else changes, the mask
   * included. Returns the new group, or -1 when no face is masked.
   */
  fromMask(mesh: SculptMesh): number {
    const r = this.rec(mesh);
    const mat = mesh.getMaterials();
    const fAr = mesh.getFaces();
    const n = mesh.getNbFaces();
    const hidden = this.hiddenFaces(mesh);
    const flags = new Uint8Array(n);
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
    if (r.names.length >= MAX_GROUPS) throw new TooManyGroups(`An object can have at most ${MAX_GROUPS} poly groups.`);
    const g = r.names.length;
    this.edit(mesh, (top, rr) => {
      rr.names.push(this.newName(rr));
      const hid = new Uint8Array(rr.names.length);
      hid.set(rr.hidden);
      rr.hidden = hid;
      this.assignFromLevel(mesh, top, flags, g);
      return true;
    });
    return g;
  }

  /**
   * Replace every group with a numbered set: `perFace` one a face of the
   * level on screen, numbered from 0, `names` theirs. Shows everything.
   */
  private replaceAll(mesh: SculptMesh, perFace: Uint32Array, names: string[]): boolean {
    if (names.length > MAX_GROUPS) {
      throw new TooManyGroups(`That makes ${names.length} groups, and an object can have at most ${MAX_GROUPS}.`);
    }
    return this.edit(mesh, (top, r) => {
      r.names = names.map((n) => n.slice(0, MAX_NAME));
      r.hidden = new Uint8Array(names.length);
      if (mesh.isDynamic) top.set(perFace.subarray(0, top.length));
      else {
        const levels = levelsOf(mesh);
        const shift = 2 * (levels.length - 1 - selOf(mesh));
        const span = 2 ** shift;
        for (let f = 0; f < perFace.length; f++) top.fill(perFace[f], f * span, (f + 1) * span);
      }
      return true;
    });
  }

  /**
   * Group by angle: the level on screen split wherever two faces meet at
   * more than `degrees` (their normals that far apart), each connected
   * piece a group, numbered by its first face.
   */
  byAngle(mesh: SculptMesh, degrees: number): number {
    const n = mesh.getNbFaces();
    const nb = faceNeighbours(mesh.getFaces(), n, mesh.getNbVertices());
    // The vendor's face normals are area-weighted: made unit here.
    const raw = mesh.getFaceNormals();
    const normals = new Float32Array(n * 3);
    for (let f = 0; f < n; f++) {
      const x = raw[f * 3];
      const y = raw[f * 3 + 1];
      const z = raw[f * 3 + 2];
      const len = Math.hypot(x, y, z) || 1;
      normals[f * 3] = x / len;
      normals[f * 3 + 1] = y / len;
      normals[f * 3 + 2] = z / len;
    }
    const cos = Math.cos((Math.min(180, Math.max(0, degrees)) * Math.PI) / 180);
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
    const names = Array.from({ length: groups }, (_, i) => defaultGroupName(i));
    this.replaceAll(mesh, perFace, names);
    return groups;
  }

  /**
   * Groups given level 0's faces (an OBJ's g/o lines, its UV islands): one
   * a level-0 face, names theirs; every face above takes its level-0
   * ancestor's. Not undoable when `undoable` is false (the import, which
   * is its own undo step).
   */
  fromLevel0(mesh: SculptMesh, perFace: Uint32Array, names: string[], undoable = true): boolean {
    const levels = levelsOf(mesh);
    if (perFace.length !== levels[0].getNbFaces()) return false;
    let top = perFace;
    for (let k = 1; k < levels.length; k++) top = inheritUp(top);
    if (!undoable) {
      const r = this.rec(mesh);
      r.names = names.slice(0, MAX_GROUPS).map((n) => n.slice(0, MAX_NAME));
      r.hidden = new Uint8Array(r.names.length);
      if (mesh.isDynamic) this.topFaces(mesh).set(top);
      else r.byLevel.set(this.topLevel(mesh), top);
      this.changed(mesh);
      return true;
    }
    if (names.length > MAX_GROUPS) throw new TooManyGroups(`That makes ${names.length} groups, and an object can have at most ${MAX_GROUPS}.`);
    return this.edit(mesh, (t, r) => {
      r.names = names.map((n) => n.slice(0, MAX_NAME));
      r.hidden = new Uint8Array(names.length);
      t.set(top);
      return true;
    });
  }

  rename(mesh: SculptMesh, g: number, name: string): boolean {
    const clean = name.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_NAME);
    const r = this.rec(mesh);
    if (!clean || g < 0 || g >= r.names.length || r.names[g] === clean) return false;
    return this.edit(mesh, (_t, rr) => {
      rr.names[g] = clean;
      return true;
    });
  }

  /** Hide or show one group (the list's eye). */
  setHidden(mesh: SculptMesh, g: number, hidden: boolean): boolean {
    const r = this.rec(mesh);
    if (g < 0 || g >= r.names.length || !!r.hidden[g] === hidden) return false;
    return this.edit(mesh, (_t, rr) => {
      rr.hidden[g] = hidden ? 1 : 0;
      return true;
    });
  }

  /** Show all: every group of the object visible again. */
  showAll(mesh: SculptMesh): boolean {
    if (!this.anyHidden(mesh)) return false;
    return this.edit(mesh, (_t, r) => {
      r.hidden.fill(0);
      return true;
    });
  }

  /** The groups the top level has faces in. */
  private used(mesh: SculptMesh): Uint8Array {
    const r = this.rec(mesh);
    const out = new Uint8Array(r.names.length);
    const top = this.topFaces(mesh);
    for (let i = 0; i < top.length; i++) if (top[i] < out.length) out[top[i]] = 1;
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
      this.edit(mesh, (_t, rr) => {
        for (let i = 0; i < rr.hidden.length; i++) rr.hidden[i] = i === g ? 0 : 1;
        return true;
      });
      return 'isolated';
    }
    if (!others) return null;
    this.edit(mesh, (_t, rr) => {
      for (let i = 0; i < rr.hidden.length; i++) rr.hidden[i] = i === g ? 1 : 0;
      return true;
    });
    return 'inverted';
  }

  /**
   * Delete a group: its faces join the group they border most (counted
   * over the top level's edges, the lowest-numbered on a tie), or group 0
   * when they border no other (a separate piece). The groups after it
   * move down one. The last group cannot go.
   */
  remove(mesh: SculptMesh, g: number): boolean {
    const r = this.rec(mesh);
    if (g < 0 || g >= r.names.length || r.names.length <= 1) return false;
    const level = this.topLevel(mesh);
    const top = this.topFaces(mesh);
    const border = new Float64Array(r.names.length);
    let has = false;
    for (let i = 0; i < top.length; i++) {
      if (top[i] === g) {
        has = true;
        break;
      }
    }
    if (has) {
      const nb = faceNeighbours(level.getFaces(), level.getNbFaces(), level.getNbVertices());
      for (let f = 0; f < top.length; f++) {
        if (top[f] !== g) continue;
        for (let k = 0; k < 4; k++) {
          const o = nb[f * 4 + k];
          if (o >= 0 && top[o] !== g) border[top[o]]++;
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
    return this.edit(mesh, (t, rr) => {
      for (let i = 0; i < t.length; i++) {
        const v = t[i];
        if (v === g) t[i] = target;
        else if (v > g) t[i] = v - 1;
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

  /** The groups record of an object for a scene file, or undefined when it has none worth keeping. */
  serialize(mesh: SculptMesh): SavedGroups | undefined {
    if (!this.hasGroups(mesh)) return undefined;
    const r = this.rec(mesh);
    const out: SavedGroups = { v: GROUPS_V as 1, faces: new Uint32Array(this.topFaces(mesh)), names: [...r.names] };
    if (r.hidden.some((h) => h !== 0)) out.hidden = r.hidden.slice();
    return out;
  }

  /** An object's groups from a scene record (sanitizeGroups checked it); false when it does not fit. */
  restore(mesh: SculptMesh, saved: SavedGroups | undefined): boolean {
    if (!saved) return false;
    const levels = levelsOf(mesh);
    const top = levels[levels.length - 1];
    if (saved.faces.length !== top.getNbFaces()) return false;
    const r = this.rec(mesh);
    r.names = [...saved.names];
    r.hidden = new Uint8Array(saved.names.length);
    if (saved.hidden) r.hidden.set(saved.hidden.subarray(0, r.names.length));
    if (mesh.isDynamic) this.topFaces(mesh).set(saved.faces);
    else r.byLevel.set(top, new Uint32Array(saved.faces));
    this.changed(mesh);
    return true;
  }

  /**
   * Dynamic topology on: the new mesh's triangles are the old level's
   * faces in order (a quad two), so each takes its face's group. Off: the
   * static mesh's faces are the dynamic ones in order. The names and the
   * hidden flags go along either way.
   */
  carryTopology(from: SculptMesh, to: SculptMesh): void {
    if (!this.records.has(from)) return;
    const src = this.levelFaces(from);
    const r = this.rec(from);
    const out = new Uint32Array(to.getNbFaces());
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
    if (to.isDynamic) this.topFaces(to).set(out);
    else dst.byLevel.set(this.topLevel(to), out);
    this.changed(to);
  }

  /**
   * Remesh, quad remesh, merge, extract: each face of `to`'s top level
   * takes the group of the nearest face centre among the sources' (world
   * space). A source is read at its top level when that is on screen, at
   * the level on screen otherwise (the top's positions are behind a
   * stroke made lower down). Names are united by name, in source order;
   * a group is hidden when it was in the first source that has it.
   * Nothing is done when no source has groups.
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
      const levels = levelsOf(src);
      const atTop = src.isDynamic || selOf(src) === levels.length - 1;
      const level = src.isDynamic ? src : atTop ? levels[levels.length - 1] : levels[selOf(src)];
      const groups = atTop ? this.topFaces(src) : this.levelFaces(src);
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
    const level = this.topLevel(to);
    const centres = worldCentres(level, to.getMatrix());
    const out = new Uint32Array(level.getNbFaces());
    for (let f = 0; f < out.length; f++) {
      const j = grid.nearest(centres[f * 3], centres[f * 3 + 1], centres[f * 3 + 2]);
      out[f] = j >= 0 ? allGroups[j] : 0;
    }
    const dst = this.rec(to);
    dst.names = names.slice(0, MAX_GROUPS);
    dst.hidden = Uint8Array.from(hidden.slice(0, MAX_GROUPS));
    if (to.isDynamic) this.topFaces(to).set(out);
    else dst.byLevel.set(level, out);
    this.changed(to);
  }

  /**
   * Deleting the top level: the level below becomes the top, its derived
   * groups now its stored ones. Called before the vendor drops it.
   */
  beforeDeleteTop(mesh: SculptMesh): void {
    const levels = levelsOf(mesh);
    if (levels.length < 2 || !this.records.has(mesh)) return;
    const below = this.levelFaces(mesh, levels.length - 2);
    this.rec(mesh).byLevel.set(levels[levels.length - 2], new Uint32Array(below));
  }

  /** A changed level or topology: tell the listeners (display, list), without an edit. */
  touch(mesh: SculptMesh): void {
    this.changed(mesh);
  }
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


/**
 * Which face of `to` each face of `from` is, when both are the same
 * surface numbered apart (a mirror copy's stack, rebuilt from its reversed
 * base): `vmap` takes `from`'s vertices to `to`'s, and a face is the one
 * with the same corners. -1 for a face with no match.
 */
export function matchFaces(
  from: Uint32Array | Int32Array,
  to: Uint32Array | Int32Array,
  nbFaces: number,
  nbVertices: number,
  vmap: Uint32Array,
): Int32Array {
  const corners = (a: Uint32Array | Int32Array, f: number, out: number[], map: Uint32Array | null): number[] => {
    out.length = 0;
    const n = a[f * 4 + 3] === TRI ? 3 : 4;
    for (let k = 0; k < n; k++) out.push(map ? map[a[f * 4 + k]] : a[f * 4 + k]);
    return out.sort((x, y) => x - y);
  };
  // `to`'s faces bucketed by their lowest corner.
  const start = new Uint32Array(nbVertices + 1);
  const tmp: number[] = [];
  const lowest = new Uint32Array(nbFaces);
  for (let f = 0; f < nbFaces; f++) {
    lowest[f] = corners(to, f, tmp, null)[0];
    start[lowest[f] + 1]++;
  }
  for (let v = 0; v < nbVertices; v++) start[v + 1] += start[v];
  const fill = start.slice(0, nbVertices);
  const items = new Uint32Array(nbFaces);
  for (let f = 0; f < nbFaces; f++) items[fill[lowest[f]]++] = f;
  const out = new Int32Array(nbFaces).fill(-1);
  const a: number[] = [];
  const b: number[] = [];
  for (let f = 0; f < nbFaces; f++) {
    corners(from, f, a, vmap);
    const lo = a[0];
    for (let i = start[lo]; i < start[lo + 1]; i++) {
      corners(to, items[i], b, null);
      if (a.length === b.length && a.every((x, k) => x === b[k])) {
        out[f] = items[i];
        break;
      }
    }
  }
  return out;
}
