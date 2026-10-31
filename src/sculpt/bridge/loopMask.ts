/**
 * The edge-loop mask (owner call, 2026-10-31): with any sculpting brush,
 * Ctrl + Shift and a drag across the mesh masks the side of an edge loop
 * the drag moves toward; Ctrl + Shift + Alt unmasks it. InputShell owns
 * the gesture; this module finds the cut and writes the mask.
 *
 * Finding the cut, on the level on screen (a Multimesh's facade is its
 * selected level, so every array read here is the displayed topology):
 *
 * - The face under the drag's midpoint is ray-picked (searching outward
 *   along the drag when the midpoint is off the model), and the drag's
 *   screen line is intersected with that face's projected edges: the edge
 *   crossed nearest the midpoint is the one the drag crosses.
 * - Between two quads, the cut is that edge's loop: walked both ways
 *   through regular vertices (four quads around, not on a border), at each
 *   one going on along the edge opposite the one it came in by, and
 *   stopping at a pole (any other valence), a border, or where it closes.
 * - Anywhere else (triangles: a dynamic-topology surface, a decimated or
 *   imported one), the cut is a geodesic ring: the plane through the picked
 *   point that holds the surface normal there and stands across the drag
 *   (its normal is the drag's direction laid on the surface), traced across
 *   the faces it cuts, face to face, until it closes or meets a border.
 *
 * Which side: the faces on the drag's end side of the loop, flooded from
 * the face the drag enters past the crossing without crossing the loop,
 * all their vertices (the loop's own included, so the faces up to the loop
 * are masked whole). For a ring, the vertices on the plane's far side
 * (along the drag) flooded from the picked face without crossing the
 * ring's edges. When the cut does not separate the surface (a loop that
 * runs from pole to pole, a ring that runs out at a border, a torus), the
 * flood reaches the near side too: a loop falls back to the ring, and a
 * ring to the plane's side of the whole connected part of the surface
 * reached from there. The overlay says which it came to.
 *
 * With symmetry on, the side is mirrored across the object's symmetry
 * plane as a mask stroke is, vertex for vertex by position, except when
 * the cut is the symmetry plane itself (the mirror would mask both
 * halves, which nobody means).
 */
import { mat3, mat4, vec3 } from 'gl-matrix';
import Utils from '@sculpt-vendor/misc/Utils';
import Enums from '@sculpt-vendor/misc/Enums';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { SculptSession } from './SculptSession';

const TRI = Utils.TRI_INDEX;
/** How light the preview tint is: the share of the way to the final mask value it goes. */
const PREVIEW_SHARE = 0.45;

/** The topology of one level, built once and kept until the surface changes. */
export interface LoopTopology {
  nv: number;
  nf: number;
  fAr: Uint32Array | Int32Array;
  /** 3 or 4 per face. */
  corners: Uint8Array;
  /** Per face slot k (the edge from corner k to corner k + 1): the face across, as face * 4 + its slot, or -1 on a border. */
  adj: Int32Array;
  /** The faces around each vertex (CSR). */
  vfStart: Uint32Array;
  vfList: Uint32Array;
  /** 1 for a vertex a loop passes straight through: four quads around it, none of its edges on a border. */
  regular: Uint8Array;
  /** 1 for a vertex on a border. */
  border: Uint8Array;
  triangles: number;
  /** Scratch, sized to the level. */
  faceMark: Int32Array;
  vertMark: Int32Array;
  stamp: number;
  barrier: Uint8Array;
  queue: Int32Array;
  /** A spatial hash for the symmetry mirror, built on first use and again when the history moves (strokes move the vertices). */
  grid: VertexGrid | null;
  gridKey: unknown[];
  /** Milliseconds the build took. */
  buildMs: number;
}

interface VertexGrid {
  cell: number;
  head: Int32Array;
  next: Int32Array;
  mask: number;
}

/** What a drag cuts, and the side it masks. */
export interface LoopCut {
  mesh: SculptMesh;
  /** 'loop': a true edge loop; 'ring': the plane's ring; 'plane': the plane's side of the connected surface. */
  kind: 'loop' | 'ring' | 'plane';
  /** What was tried first: an edge loop between quads, or a ring. */
  first: 'loop' | 'ring';
  /** How the line drawn ends: closed, or open at a pole or a border. */
  ends: 'closed' | 'pole' | 'border';
  /** For a loop: its vertices in order, and the valence (faces around) at its two ends. */
  loop: Uint32Array | null;
  endValence: [number, number] | null;
  /** The line to draw, world space, xyz per point, and whether each point faces the camera. */
  points: Float32Array;
  front: Uint8Array;
  closed: boolean;
  /** The vertices on the end side (before any mirror), and with the mirror. */
  side: Uint32Array;
  verts: Uint32Array;
  mirrored: boolean;
  /** A note for the overlay when it fell back, else ''. */
  note: string;
  /** Timings, ms. */
  ms: { topology: number; find: number; walk: number; flood: number; mirror: number; total: number };
}

/** The last cut applied, for the tests. */
export interface LoopReport {
  kind: LoopCut['kind'];
  first: LoopCut['first'];
  ends: LoopCut['ends'];
  closed: boolean;
  loopLength: number;
  endValence: [number, number] | null;
  side: number;
  verts: number;
  changed: number;
  mirrored: boolean;
  unmask: boolean;
  note: string;
  faces: number;
  ms: LoopCut['ms'] & { apply: number };
}

// --- topology ---------------------------------------------------------------

export function buildTopology(mesh: SculptMesh): LoopTopology {
  const t0 = performance.now();
  const nf = mesh.getNbFaces();
  const nv = mesh.getNbVertices();
  const fAr = mesh.getFaces();
  const corners = new Uint8Array(nf);
  const vfStart = new Uint32Array(nv + 1);
  let triangles = 0;
  for (let f = 0; f < nf; f++) {
    const o = f * 4;
    const n = fAr[o + 3] === TRI ? 3 : 4;
    corners[f] = n;
    if (n === 3) triangles++;
    for (let k = 0; k < n; k++) vfStart[fAr[o + k] + 1]++;
  }
  for (let v = 0; v < nv; v++) vfStart[v + 1] += vfStart[v];
  const vfList = new Uint32Array(vfStart[nv]);
  const fill = vfStart.slice(0, nv);
  for (let f = 0; f < nf; f++) {
    const o = f * 4;
    for (let k = 0, n = corners[f]; k < n; k++) vfList[fill[fAr[o + k]]++] = f;
  }
  const adj = new Int32Array(nf * 4).fill(-1);
  // A static level numbers its edges already (the slots match: edge k runs
  // from corner k to corner k + 1), which pairs the faces in one pass. A
  // dynamic-topology surface does not keep that numbering up to date.
  const fe: Uint32Array | null = mesh.isDynamic ? null : (mesh.getFaceEdges?.() ?? null);
  const ne = fe ? mesh.getNbEdges() : 0;
  if (fe && fe.length >= nf * 4 && ne > 0) {
    const first = new Int32Array(ne).fill(-1);
    for (let f = 0; f < nf; f++) {
      const o = f * 4;
      for (let k = 0, n = corners[f]; k < n; k++) {
        const e: number = fe[o + k];
        if (e >= ne) continue;
        const other = first[e];
        if (other < 0) first[e] = o + k;
        else {
          adj[o + k] = other;
          if (adj[other] === -1) adj[other] = o + k;
        }
      }
    }
  }
  for (let f = 0; f < nf && !(fe && ne > 0); f++) {
    const o = f * 4;
    const n = corners[f];
    for (let k = 0; k < n; k++) {
      if (adj[o + k] !== -1) continue;
      const a = fAr[o + k];
      const b = fAr[o + ((k + 1) % n)];
      for (let i = vfStart[a], e = vfStart[a + 1]; i < e; i++) {
        const g = vfList[i];
        if (g === f) continue;
        const og = g * 4;
        const m = corners[g];
        let j = 0;
        while (j < m && fAr[og + j] !== a) j++;
        if (j === m) continue;
        let slot = -1;
        if (fAr[og + ((j + 1) % m)] === b) slot = j;
        else if (fAr[og + ((j + m - 1) % m)] === b) slot = (j + m - 1) % m;
        if (slot < 0) continue;
        adj[o + k] = og + slot;
        if (adj[og + slot] === -1) adj[og + slot] = o + k;
        break;
      }
    }
  }
  const regular = new Uint8Array(nv);
  const border = new Uint8Array(nv);
  for (let v = 0; v < nv; v++) {
    const s = vfStart[v];
    const e = vfStart[v + 1];
    if (e - s !== 4) continue;
    let quads = true;
    for (let i = s; i < e; i++) if (corners[vfList[i]] !== 4) quads = false;
    if (quads) regular[v] = 1;
  }
  for (let f = 0; f < nf; f++) {
    const o = f * 4;
    const n = corners[f];
    for (let k = 0; k < n; k++) {
      if (adj[o + k] !== -1) continue;
      const a = fAr[o + k];
      const b = fAr[o + ((k + 1) % n)];
      border[a] = border[b] = 1;
      regular[a] = regular[b] = 0;
    }
  }
  return {
    nv,
    nf,
    fAr,
    corners,
    adj,
    vfStart,
    vfList,
    regular,
    border,
    triangles,
    faceMark: new Int32Array(nf),
    vertMark: new Int32Array(nv),
    stamp: 0,
    barrier: new Uint8Array(nf * 4),
    queue: new Int32Array(Math.max(nf, nv)),
    grid: null,
    gridKey: [],
    buildMs: performance.now() - t0,
  };
}

/** The edge slot of face f at vertex v other than `slot` (both meet at v). */
function otherSlotAt(t: LoopTopology, f: number, slot: number, v: number): number {
  const n = t.corners[f];
  return t.fAr[f * 4 + ((slot + 1) % n)] === v ? (slot + 1) % n : (slot + n - 1) % n;
}

/** Bar an edge (both of its slots) from the floods; `marked` remembers it for the reset. */
function bar(t: LoopTopology, enc: number, marked: number[]): void {
  t.barrier[enc] = 1;
  marked.push(enc);
  const twin = t.adj[enc];
  if (twin >= 0) {
    t.barrier[twin] = 1;
    marked.push(twin);
  }
}

function unbar(t: LoopTopology, marked: number[]): void {
  for (const enc of marked) t.barrier[enc] = 0;
  marked.length = 0;
}

/**
 * Walk an edge loop from edge (f, slot) on through its end `v`: the edges
 * passed are barred and their far ends pushed onto `out`. Returns how the
 * walk stopped.
 */
function walkLoop(
  t: LoopTopology,
  f: number,
  slot: number,
  v: number,
  start: [number, number],
  out: number[],
  marked: number[],
): 'closed' | 'pole' | 'border' {
  const fAr = t.fAr;
  for (let steps = 0; steps <= t.nf; steps++) {
    if (!t.regular[v]) return t.border[v] ? 'border' : 'pole';
    const s1 = otherSlotAt(t, f, slot, v);
    const enc = t.adj[f * 4 + s1];
    if (enc < 0) return 'border';
    const h = enc >> 2;
    const s2 = otherSlotAt(t, h, enc & 3, v);
    const a = fAr[h * 4 + s2];
    const w = a === v ? fAr[h * 4 + ((s2 + 1) % t.corners[h])] : a;
    if ((v === start[0] && w === start[1]) || (v === start[1] && w === start[0])) return 'closed';
    bar(t, h * 4 + s2, marked);
    out.push(w);
    f = h;
    slot = s2;
    v = w;
  }
  return 'pole';
}

/** Faces reached from `seed` without crossing a barred edge; returns the count (in t.queue) and whether `avoid` was reached. */
function floodFaces(t: LoopTopology, seed: number, avoid: number): { count: number; leaked: boolean } {
  const stamp = ++t.stamp;
  const q = t.queue;
  const mark = t.faceMark;
  let head = 0;
  let tail = 0;
  q[tail++] = seed;
  mark[seed] = stamp;
  let leaked = false;
  while (head < tail) {
    const f = q[head++];
    if (f === avoid) leaked = true;
    const o = f * 4;
    for (let k = 0, n = t.corners[f]; k < n; k++) {
      if (t.barrier[o + k]) continue;
      const enc = t.adj[o + k];
      if (enc < 0) continue;
      const g = enc >> 2;
      if (mark[g] === stamp) continue;
      mark[g] = stamp;
      q[tail++] = g;
    }
  }
  return { count: tail, leaked };
}

/** Every vertex of the first `count` faces in t.queue, once each. */
function verticesOfFaces(t: LoopTopology, count: number): Uint32Array {
  const stamp = ++t.stamp;
  const mark = t.vertMark;
  const out = new Uint32Array(t.nv);
  let n = 0;
  for (let i = 0; i < count; i++) {
    const o = t.queue[i] * 4;
    for (let k = 0, c = t.corners[t.queue[i]]; k < c; k++) {
      const v = t.fAr[o + k];
      if (mark[v] === stamp) continue;
      mark[v] = stamp;
      out[n++] = v;
    }
  }
  return out.slice(0, n);
}

/**
 * Vertices reached from `seeds` along edges, the barred ones excepted when
 * `barred`; marks them with the returned stamp, and returns them.
 */
function floodVertices(t: LoopTopology, seeds: number[], barred: boolean): { verts: Int32Array; count: number; stamp: number } {
  const stamp = ++t.stamp;
  const q = t.queue;
  const mark = t.vertMark;
  const fAr = t.fAr;
  let head = 0;
  let tail = 0;
  for (const s of seeds) {
    if (mark[s] === stamp) continue;
    mark[s] = stamp;
    q[tail++] = s;
  }
  while (head < tail) {
    const v = q[head++];
    for (let i = t.vfStart[v], e = t.vfStart[v + 1]; i < e; i++) {
      const f = t.vfList[i];
      const o = f * 4;
      const n = t.corners[f];
      let j = 0;
      while (j < n && fAr[o + j] !== v) j++;
      if (j === n) continue;
      const prev = (j + n - 1) % n;
      // The edge v -> next is slot j; prev -> v is slot prev.
      if (!barred || !t.barrier[o + j]) {
        const w = fAr[o + ((j + 1) % n)];
        if (mark[w] !== stamp) {
          mark[w] = stamp;
          q[tail++] = w;
        }
      }
      if (!barred || !t.barrier[o + prev]) {
        const w = fAr[o + prev];
        if (mark[w] !== stamp) {
          mark[w] = stamp;
          q[tail++] = w;
        }
      }
    }
  }
  return { verts: q, count: tail, stamp };
}

// --- the plane's ring -------------------------------------------------------

interface Ring {
  /** Local xyz per point, and the local normal there. */
  pts: number[];
  nrm: number[];
  closed: boolean;
}

/** The slots of face f the plane crosses (signs from d), into `out`; returns how many. */
function crossings(t: LoopTopology, d: Float32Array, f: number, out: number[]): number {
  const o = f * 4;
  const n = t.corners[f];
  let c = 0;
  for (let k = 0; k < n; k++) {
    const a = t.fAr[o + k];
    const b = t.fAr[o + ((k + 1) % n)];
    if (d[a] >= 0 !== d[b] >= 0) out[c++] = k;
  }
  return c;
}

/**
 * Trace the plane's ring from face f0 across its faces, barring every edge
 * it crosses. One way first; if that ends at a border, the other way too.
 */
function traceRing(t: LoopTopology, vAr: Float32Array, nAr: Float32Array, d: Float32Array, f0: number, marked: number[]): Ring | null {
  const c0: number[] = [];
  if (crossings(t, d, f0, c0) < 2) return null;
  const stamp = ++t.stamp;
  t.faceMark[f0] = stamp;
  const scratch: number[] = [];
  const pointOn = (f: number, slot: number, pts: number[], nrm: number[]): void => {
    const o = f * 4;
    const a = t.fAr[o + slot];
    const b = t.fAr[o + ((slot + 1) % t.corners[f])];
    const s = d[a] / (d[a] - d[b]);
    for (let k = 0; k < 3; k++) {
      pts.push(vAr[a * 3 + k] + (vAr[b * 3 + k] - vAr[a * 3 + k]) * s);
      nrm.push(nAr[a * 3 + k] + (nAr[b * 3 + k] - nAr[a * 3 + k]) * s);
    }
  };
  const march = (slot: number, pts: number[], nrm: number[]): 'closed' | 'border' | 'stuck' => {
    let f = f0;
    for (let steps = 0; steps <= t.nf; steps++) {
      pointOn(f, slot, pts, nrm);
      const enc = f * 4 + slot;
      bar(t, enc, marked);
      const next = t.adj[enc];
      if (next < 0) return 'border';
      const g = next >> 2;
      if (g === f0) return 'closed';
      if (t.faceMark[g] === stamp) return 'stuck';
      t.faceMark[g] = stamp;
      const n = crossings(t, d, g, scratch);
      let exit = -1;
      for (let i = 0; i < n; i++) if (scratch[i] !== (next & 3)) exit = scratch[i];
      if (exit < 0) return 'stuck';
      f = g;
      slot = exit;
    }
    return 'stuck';
  };
  const pts: number[] = [];
  const nrm: number[] = [];
  const how = march(c0[0], pts, nrm);
  if (how === 'closed') return { pts, nrm, closed: true };
  const back: number[] = [];
  const backN: number[] = [];
  march(c0[1], back, backN);
  // The other way, reversed, then the first: one line from end to end.
  const allP: number[] = [];
  const allN: number[] = [];
  for (let i = back.length / 3 - 1; i >= 0; i--) {
    allP.push(back[i * 3], back[i * 3 + 1], back[i * 3 + 2]);
    allN.push(backN[i * 3], backN[i * 3 + 1], backN[i * 3 + 2]);
  }
  return { pts: allP.concat(pts), nrm: allN.concat(nrm), closed: false };
}

// --- the symmetry mirror ----------------------------------------------------

function buildGrid(t: LoopTopology, vAr: Float32Array, cell: number): VertexGrid {
  let size = 1;
  while (size < t.nv * 2) size <<= 1;
  const head = new Int32Array(size).fill(-1);
  const next = new Int32Array(t.nv);
  const mask = size - 1;
  for (let v = 0; v < t.nv; v++) {
    const h = hashCell(Math.floor(vAr[v * 3] / cell), Math.floor(vAr[v * 3 + 1] / cell), Math.floor(vAr[v * 3 + 2] / cell)) & mask;
    next[v] = head[h];
    head[h] = v;
  }
  return { cell, head, next, mask };
}

function hashCell(x: number, y: number, z: number): number {
  return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0;
}

/** The vertex nearest p within `tol`, or -1. */
function nearestVertex(g: VertexGrid, vAr: Float32Array, p: number[], tol: number): number {
  const cx = Math.floor(p[0] / g.cell);
  const cy = Math.floor(p[1] / g.cell);
  const cz = Math.floor(p[2] / g.cell);
  let best = -1;
  let bestD = tol * tol;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (let v = g.head[hashCell(cx + dx, cy + dy, cz + dz) & g.mask]; v !== -1; v = g.next[v]) {
          const ex = vAr[v * 3] - p[0];
          const ey = vAr[v * 3 + 1] - p[1];
          const ez = vAr[v * 3 + 2] - p[2];
          const dd = ex * ex + ey * ey + ez * ez;
          if (dd <= bestD) {
            bestD = dd;
            best = v;
          }
        }
      }
    }
  }
  return best;
}

/** A typical edge length of the level, from a sample of its faces. */
function typicalEdge(t: LoopTopology, vAr: Float32Array): number {
  let sum = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(t.nf / 2000));
  for (let f = 0; f < t.nf; f += step) {
    const a = t.fAr[f * 4];
    const b = t.fAr[f * 4 + 1];
    sum += Math.hypot(vAr[a * 3] - vAr[b * 3], vAr[a * 3 + 1] - vAr[b * 3 + 1], vAr[a * 3 + 2] - vAr[b * 3 + 2]);
    n++;
  }
  return n ? sum / n : 1;
}

// --- the masker -------------------------------------------------------------

interface Hit {
  mesh: SculptMesh;
  face: number;
  point: number[];
  /** Where along the drag (0..1) it was picked. */
  t: number;
}

export class LoopMasker {
  private topo: LoopTopology | null = null;
  private topoKey: unknown[] = [];
  /** The vertices tinted by the preview, and what their mask was. */
  private tinted: { mesh: SculptMesh; verts: Uint32Array; orig: Float32Array } | null = null;
  /** The last cut found, kept while the drag stays on the same loop and side. */
  private cached: { key: string; region: Uint8Array; cut: LoopCut } | null = null;
  /** The last cut applied (the tests read it). */
  last: LoopReport | null = null;

  constructor(private readonly session: SculptSession) {}

  /**
   * The level's topology, rebuilt when the level or its faces change: a
   * level stack shares nothing between levels, a remesh makes a new mesh,
   * and a dynamic-topology surface changes with its history.
   */
  topology(mesh: SculptMesh): LoopTopology {
    const sm = this.session.getStateManager();
    const dyn = !!mesh.isDynamic;
    const key = [mesh.getMeshData(), mesh.getFaces(), mesh.getNbFaces(), mesh.getNbVertices(), dyn ? sm.getCurrentState() : null, dyn ? sm._curUndoIndex : null];
    if (!this.topo || key.some((k, i) => k !== this.topoKey[i])) {
      this.topo = buildTopology(mesh);
      this.topoKey = key;
      this.cached = null;
    }
    return this.topo;
  }

  /** The visible object under canvas px (x, y), unlocked, with the face and the local point hit. */
  private hitAt(x: number, y: number, at: number): Hit | null {
    const s = this.session;
    const picking = s.getPicking();
    if (!picking.intersectionMouseMeshes(s.getMeshes(), x, y)) return null;
    const mesh = picking.getMesh();
    if (!mesh || s.isLocked(mesh)) return null;
    const p = picking.getIntersectionPoint();
    return { mesh, face: picking.getPickedFace(), point: [p[0], p[1], p[2]], t: at };
  }

  /**
   * What a drag from (x0, y0) to (x1, y1), canvas device px, cuts, and the
   * side it masks; null when it crosses no object.
   */
  pick(x0: number, y0: number, x1: number, y1: number): LoopCut | null {
    const tStart = performance.now();
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (!(len > 0)) return null;
    // The face under the midpoint, or the nearest one along the drag.
    let hit: Hit | null = null;
    const step = Math.max(2 / len, 0.005);
    for (let i = 0; !hit && i * step <= 0.5; i++) {
      for (const at of i ? [0.5 - i * step, 0.5 + i * step] : [0.5]) {
        hit = this.hitAt(x0 + (x1 - x0) * at, y0 + (y1 - y0) * at, at);
        if (hit) break;
      }
    }
    if (!hit) return null;
    const mesh = hit.mesh;
    const topoWas = this.topo;
    const t = this.topology(mesh);
    const topologyMs = this.topo !== topoWas ? t.buildMs : 0;
    const vAr = mesh.getVertices();
    const nAr = mesh.getNormals();
    const cam = this.session.getCamera();
    const M = mesh.getMatrix();
    const toScreen = (v: number): number[] => {
      const w = vec3.transformMat4(vec3.create(), [vAr[v * 3], vAr[v * 3 + 1], vAr[v * 3 + 2]] as unknown as vec3, M as unknown as mat4);
      return cam.project(w);
    };

    // The edge of the picked face the drag's line crosses nearest the midpoint.
    const f = hit.face;
    const n = t.corners[f];
    const scr: number[][] = [];
    for (let k = 0; k < n; k++) scr.push(toScreen(t.fAr[f * 4 + k]));
    const dx = x1 - x0;
    const dy = y1 - y0;
    let best = -1;
    let bestT = 0;
    let bestScore = Infinity;
    for (let k = 0; k < n; k++) {
      const A = scr[k];
      const B = scr[(k + 1) % n];
      const ex = B[0] - A[0];
      const ey = B[1] - A[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const wx = A[0] - x0;
      const wy = A[1] - y0;
      const tt = (wx * ey - wy * ex) / den;
      const u = (wx * dy - wy * dx) / den;
      if (u < 0 || u > 1) continue;
      // Prefer an edge with a face across (a border edge ends the surface).
      const score = Math.abs(tt - 0.5) + (t.adj[f * 4 + k] < 0 ? 1e6 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = k;
        bestT = tt;
      }
    }

    // The plane across the drag: through the picked point, holding the
    // surface normal there, its own normal the drag's direction laid on
    // the surface (local space).
    // The picked face's own normal (its diagonals' cross product), not
    // the smoothed vertex normals: beside a hard edge those lean over it,
    // and the plane would lean with them.
    const P = hit.point;
    const N = vec3.create();
    {
      const o = f * 4;
      const p0 = t.fAr[o] * 3;
      const p1 = t.fAr[o + 1] * 3;
      const p2 = t.fAr[o + 2] * 3;
      const p3 = n === 4 ? t.fAr[o + 3] * 3 : p0;
      const ax = vAr[p2] - vAr[p0];
      const ay = vAr[p2 + 1] - vAr[p0 + 1];
      const az = vAr[p2 + 2] - vAr[p0 + 2];
      const bx = n === 4 ? vAr[p3] - vAr[p1] : vAr[p1] - vAr[p0];
      const by = n === 4 ? vAr[p3 + 1] - vAr[p1 + 1] : vAr[p1 + 1] - vAr[p0 + 1];
      const bz = n === 4 ? vAr[p3 + 2] - vAr[p1 + 2] : vAr[p1 + 2] - vAr[p0 + 2];
      vec3.set(N, ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
      vec3.normalize(N, N);
    }
    const Pw = vec3.transformMat4(vec3.create(), P as unknown as vec3, M as unknown as mat4);
    const sP = cam.project(Pw);
    const ux = dx / len;
    const uy = dy / len;
    const inv = mat4.invert(mat4.create(), M as unknown as mat4) ?? mat4.create();
    // The drag laid on the surface: the eye ray a few pixels on along the
    // drag, met with the tangent plane at P (local space). Seen edge-on,
    // where the ray grazes the plane, the drag at P's depth instead.
    const local = (x: number, y: number, z: number): vec3 => vec3.transformMat4(vec3.create(), cam.unproject(x, y, z), inv);
    const near = local(sP[0] + ux * 10, sP[1] + uy * 10, 0);
    const ray = vec3.sub(vec3.create(), local(sP[0] + ux * 10, sP[1] + uy * 10, 1), near);
    const den = vec3.dot(ray, N);
    const D = vec3.create();
    if (Math.abs(den) > 1e-6 * vec3.length(ray)) {
      const tt = vec3.dot(vec3.sub(vec3.create(), P as unknown as vec3, near), N) / den;
      vec3.sub(D, vec3.scaleAndAdd(vec3.create(), near, ray, tt), P as unknown as vec3);
    } else {
      vec3.sub(D, local(sP[0] + ux * 10, sP[1] + uy * 10, sP[2]), local(sP[0], sP[1], sP[2]));
    }
    const along = vec3.dot(D, N);
    const plane = vec3.scaleAndAdd(vec3.create(), D, N, -along);
    if (vec3.length(plane) < 1e-9 * Math.max(1e-30, vec3.length(D))) vec3.copy(plane, D);
    vec3.normalize(plane, plane);
    const tFind = performance.now();

    const marked: number[] = [];
    let kind: LoopCut['kind'] = 'ring';
    let first: LoopCut['first'] = 'ring';
    let ends: LoopCut['ends'] = 'closed';
    let loop: Uint32Array | null = null;
    let endValence: [number, number] | null = null;
    let side: Uint32Array | null = null;
    let line: { pts: number[]; nrm: number[]; closed: boolean } | null = null;
    let note = '';
    let floodMs = 0;
    let walkMs = 0;
    let cacheKey = '';

    const g = best >= 0 ? t.adj[f * 4 + best] >> 2 : -1;
    const quadEdge = best >= 0 && g >= 0 && n === 4 && t.corners[g] === 4;
    if (quadEdge) {
      first = 'loop';
      const a = t.fAr[f * 4 + best];
      const b = t.fAr[f * 4 + ((best + 1) % 4)];
      // The face the drag goes on into past the crossing, and the one it left.
      const endFace = bestT > hit.t ? g : f;
      const startFace = endFace === f ? g : f;
      bar(t, f * 4 + best, marked);
      const fwd: number[] = [];
      const how = walkLoop(t, f, best, b, [a, b], fwd, marked);
      const back: number[] = [];
      let howBack: typeof how = how;
      // A closed walk comes back round to a: it is the first vertex already.
      if (how === 'closed' && fwd[fwd.length - 1] === a) fwd.pop();
      if (how !== 'closed') howBack = walkLoop(t, f, best, a, [a, b], back, marked);
      const order = back.reverse().concat([a, b], fwd);
      loop = Uint32Array.from(order);
      const val = (v: number): number => t.vfStart[v + 1] - t.vfStart[v];
      endValence = how === 'closed' ? [4, 4] : [val(order[0]), val(order[order.length - 1])];
      walkMs = performance.now() - tFind;
      const closed = how === 'closed';
      ends = closed ? 'closed' : how === 'border' && howBack === 'border' ? 'border' : how === 'pole' || howBack === 'pole' ? 'pole' : 'border';
      // The same loop and side as last time: keep what it found.
      let mn = order[0];
      for (const v of order) if (v < mn) mn = v;
      cacheKey = `loop:${mn}:${order.length}:${closed}`;
      if (this.cached && this.cached.key === cacheKey && this.cached.cut.mesh === mesh && this.cached.region[endFace]) {
        unbar(t, marked);
        const ms = { topology: topologyMs, find: tFind - tStart - topologyMs, walk: walkMs, flood: 0, mirror: 0, total: performance.now() - tStart };
        return { ...this.cached.cut, ms };
      }
      const tFlood = performance.now();
      const flood = floodFaces(t, endFace, startFace);
      if (!flood.leaked) {
        kind = 'loop';
        side = verticesOfFaces(t, flood.count);
        const pts: number[] = [];
        const nrm: number[] = [];
        for (const v of order) {
          pts.push(vAr[v * 3], vAr[v * 3 + 1], vAr[v * 3 + 2]);
          nrm.push(nAr[v * 3], nAr[v * 3 + 1], nAr[v * 3 + 2]);
        }
        line = { pts, nrm, closed };
        this.remember(cacheKey, t, flood.count, null);
      } else {
        note = ends === 'pole' ? 'loop ends at a pole: cut by a ring' : 'loop ends at a border: cut by a ring';
      }
      floodMs = performance.now() - tFlood;
      unbar(t, marked);
    }

    if (!side) {
      // The ring: signed distances to the plane, then the trace.
      const tRing = performance.now();
      const d = new Float32Array(t.nv);
      for (let v = 0; v < t.nv; v++) {
        d[v] = (vAr[v * 3] - P[0]) * plane[0] + (vAr[v * 3 + 1] - P[1]) * plane[1] + (vAr[v * 3 + 2] - P[2]) * plane[2];
      }
      let ring = traceRing(t, vAr, nAr, d, f, marked);
      if (!ring) {
        // The plane missed the face's edges (it runs through a corner):
        // nudge it a hair along the drag.
        const eps = 1e-4 * typicalEdge(t, vAr);
        for (let v = 0; v < t.nv; v++) d[v] -= eps;
        ring = traceRing(t, vAr, nAr, d, f, marked);
      }
      walkMs += performance.now() - tRing;
      const tFlood = performance.now();
      const o = f * 4;
      const seeds: number[] = [];
      const far: number[] = [];
      for (let k = 0; k < n; k++) (d[t.fAr[o + k]] >= 0 ? seeds : far).push(t.fAr[o + k]);
      if (ring && seeds.length) {
        const flood = floodVertices(t, seeds, true);
        const leaked = far.some((v) => t.vertMark[v] === flood.stamp);
        line = ring;
        // A loop that fell back keeps saying how the loop ended.
        if (first === 'ring') ends = ring.closed ? 'closed' : 'border';
        if (!leaked) {
          kind = 'ring';
          side = Uint32Array.from(flood.verts.subarray(0, flood.count));
        } else {
          note = ring.closed ? "the ring does not cut it in two: masked by the plane's side" : "the ring meets a border: masked by the plane's side";
        }
      } else if (!note) {
        note = "masked by the plane's side";
      }
      if (!side) {
        // The plane's side of the connected surface reached from here.
        kind = 'plane';
        const start = seeds.length ? seeds : [t.fAr[o]];
        const flood = floodVertices(t, start, false);
        const keep: number[] = [];
        for (let i = 0; i < flood.count; i++) if (d[flood.verts[i]] >= 0) keep.push(flood.verts[i]);
        side = Uint32Array.from(keep);
      }
      unbar(t, marked);
      floodMs += performance.now() - tFlood;
      this.cached = null;
    }

    // The mirror, as a mask stroke's.
    const tMirror = performance.now();
    let verts = side;
    let mirrored = false;
    if (this.session.getSymmetry()) {
      const org = mesh.getSymmetryOrigin();
      const sn = mesh.getSymmetryNormal();
      const edge = typicalEdge(t, vAr);
      const off = (P[0] - org[0]) * sn[0] + (P[1] - org[1]) * sn[1] + (P[2] - org[2]) * sn[2];
      const onPlane = Math.abs(off) < 2 * edge && Math.abs(vec3.dot(plane, sn as unknown as vec3)) > 0.9;
      if (!onPlane) {
        const sm = this.session.getStateManager();
        const gridKey = [sm.getCurrentState(), sm._curUndoIndex];
        if (!t.grid || gridKey.some((k, i) => k !== t.gridKey[i])) {
          t.grid = buildGrid(t, vAr, edge);
          t.gridKey = gridKey;
        }
        const stamp = ++t.stamp;
        const mark = t.vertMark;
        const all: number[] = [];
        for (const v of side) {
          mark[v] = stamp;
          all.push(v);
        }
        const q = [0, 0, 0];
        for (const v of side) {
          q[0] = vAr[v * 3];
          q[1] = vAr[v * 3 + 1];
          q[2] = vAr[v * 3 + 2];
          const dd = 2 * ((q[0] - org[0]) * sn[0] + (q[1] - org[1]) * sn[1] + (q[2] - org[2]) * sn[2]);
          q[0] -= dd * sn[0];
          q[1] -= dd * sn[1];
          q[2] -= dd * sn[2];
          const w = nearestVertex(t.grid, vAr, q, 0.75 * edge);
          if (w >= 0 && mark[w] !== stamp) {
            mark[w] = stamp;
            all.push(w);
          }
        }
        verts = Uint32Array.from(all);
        mirrored = true;
      }
    }
    const mirrorMs = performance.now() - tMirror;

    // The line in world space, and which of its points face the camera.
    const pts = line ? line.pts : [];
    const nrm = line ? line.nrm : [];
    const count = pts.length / 3;
    const points = new Float32Array(pts.length);
    const front = new Uint8Array(count);
    const nm = mat3.normalFromMat4(mat3.create(), M as unknown as mat4);
    const w = vec3.create();
    const wn = vec3.create();
    for (let i = 0; i < count; i++) {
      vec3.transformMat4(w, [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]] as unknown as vec3, M as unknown as mat4);
      vec3.transformMat3(wn, [nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]] as unknown as vec3, nm);
      points[i * 3] = w[0];
      points[i * 3 + 1] = w[1];
      points[i * 3 + 2] = w[2];
      const s = cam.project(w);
      const near = cam.unproject(s[0], s[1], 0);
      front[i] = (w[0] - near[0]) * wn[0] + (w[1] - near[1]) * wn[1] + (w[2] - near[2]) * wn[2] < 0 ? 1 : 0;
    }

    const cut: LoopCut = {
      mesh,
      kind,
      first,
      ends,
      loop,
      endValence,
      points,
      front,
      closed: !!line?.closed,
      side,
      verts,
      mirrored,
      note,
      ms: {
        topology: topologyMs,
        find: tFind - tStart - topologyMs,
        walk: walkMs,
        flood: floodMs,
        mirror: mirrorMs,
        total: performance.now() - tStart,
      },
    };
    if (kind === 'loop' && this.cached?.key === cacheKey) this.cached.cut = cut;
    return cut;
  }

  /** Keep a loop's flooded faces, to know a later drag over the same loop and side. */
  private remember(key: string, t: LoopTopology, count: number, cut: LoopCut | null): void {
    const region = this.cached && this.cached.region.length === t.nf ? this.cached.region : new Uint8Array(t.nf);
    region.fill(0);
    for (let i = 0; i < count; i++) region[t.queue[i]] = 1;
    this.cached = { key, region, cut: cut as LoopCut };
  }

  /** The masked value a vertex takes: 0 masks, 1 unmasks (the vendor's convention). */
  private static target(unmask: boolean): number {
    return unmask ? 1 : 0;
  }

  /** Tint the side a release would mask, lightly, or take the tint off (null). */
  preview(cut: LoopCut | null, unmask: boolean): void {
    this.untint(false);
    if (!cut) {
      this.session.render();
      return;
    }
    const mesh = cut.mesh;
    const mAr = mesh.getMaterials();
    const verts = cut.verts;
    const orig = new Float32Array(verts.length);
    const goal = LoopMasker.target(unmask);
    for (let i = 0; i < verts.length; i++) {
      const j = verts[i] * 3 + 2;
      orig[i] = mAr[j];
      mAr[j] += (goal - mAr[j]) * PREVIEW_SHARE;
    }
    this.tinted = { mesh, verts, orig };
    this.refreshMask(mesh);
  }

  /** Put the preview's vertices back as they were. */
  untint(render = true): void {
    const tint = this.tinted;
    if (!tint) return;
    this.tinted = null;
    const mAr = tint.mesh.getMaterials();
    for (let i = 0; i < tint.verts.length; i++) mAr[tint.verts[i] * 3 + 2] = tint.orig[i];
    if (render) this.refreshMask(tint.mesh);
  }

  private refreshMask(mesh: SculptMesh): void {
    mesh.updateDuplicateColorsAndMaterials();
    if (mesh.isUsingDrawArrays()) mesh.updateDrawArrays();
    if (mesh.isDynamic) mesh.updateBuffers();
    else mesh.updateMaterialBuffer();
    this.session.render();
  }

  /**
   * Mask (or unmask) the cut's side, as one undo step, the way a mask
   * stroke records itself. Returns the vertices whose mask changed.
   */
  apply(cut: LoopCut, unmask: boolean): number {
    const t0 = performance.now();
    this.untint(false);
    const s = this.session;
    const mesh = cut.mesh;
    const mAr = mesh.getMaterials();
    const goal = LoopMasker.target(unmask);
    const changed: number[] = [];
    for (const v of cut.verts) if (mAr[v * 3 + 2] !== goal) changed.push(v);
    if (changed.length) {
      if (s.getMesh() !== mesh) s.setMesh(mesh);
      const sm = s.getStateManager();
      sm.pushStateColorAndMaterial(mesh);
      const ids = Uint32Array.from(changed);
      sm.pushVertices(ids);
      for (const v of changed) mAr[v * 3 + 2] = goal;
      const masking = s.getSculptManager().getTool(Enums.Tools.MASKING);
      if (masking.updateAndRenderMask) masking.updateAndRenderMask();
      else this.refreshMask(mesh);
    } else {
      this.refreshMask(mesh);
    }
    this.cached = null;
    this.last = {
      kind: cut.kind,
      first: cut.first,
      ends: cut.ends,
      closed: cut.closed,
      loopLength: cut.loop ? cut.loop.length : cut.points.length / 3,
      endValence: cut.endValence,
      side: cut.side.length,
      verts: cut.verts.length,
      changed: changed.length,
      mirrored: cut.mirrored,
      unmask,
      note: cut.note,
      faces: mesh.getNbFaces(),
      ms: { ...cut.ms, apply: performance.now() - t0 },
    };
    return changed.length;
  }
}
