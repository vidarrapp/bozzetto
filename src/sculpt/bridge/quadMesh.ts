/**
 * The mesh side of Quad remesh, with nothing of the page or the engine in
 * it, so the worker (quadRemesh.worker.ts) and the session can both use
 * it: the input cleanup QuadriFlow needs, the OBJ it reads and writes, and
 * a nearest-point grid for carrying colours and orientation across.
 *
 * Faces come and go as SculptGL keeps them: four indices a face, the
 * fourth TRI_INDEX for a triangle.
 */

/** SculptGL's "no fourth corner" (Utils.TRI_INDEX). */
export const TRI = 4294967295;

/** What the cleanup did, and what it found it could not fix. */
export interface CleanupReport {
  /** Vertices merged into another at the same place. */
  welded: number;
  /** Triangles with no area (a repeated corner, or all three in a line). */
  degenerate: number;
  /** Triangles on the same three corners as one before them. */
  duplicate: number;
  /** Pieces dropped for being under 1% of the faces, and their triangles. */
  islands: number;
  islandFaces: number;
  /** Edges of more than two triangles cut into sheets, and the vertices split for it (fans that touch at a point included). */
  splitEdges: number;
  splitVertices: number;
  /** Edges shared by more than two triangles that could not be cut into sheets. */
  nonManifoldEdges: number;
  /** Edges whose two triangles run the same way along them (one is wound backwards). */
  flippedEdges: number;
  /** Edges with one triangle: open borders. */
  borderEdges: number;
  /** Triangles going in, and left. */
  trianglesIn: number;
  trianglesOut: number;
}

export interface CleanMesh {
  positions: Float64Array;
  triangles: Uint32Array;
  report: CleanupReport;
}

/** A piece under this share of the faces is a crumb, dropped. */
export const ISLAND_SHARE = 0.01;

/**
 * Weld, triangulate, drop degenerate and duplicate triangles and tiny
 * pieces, and count what is left that is not manifold. Positions three a
 * vertex, faces four a face (TRI for a triangle's fourth).
 */
export function cleanForQuadriFlow(positions: ArrayLike<number>, faces: ArrayLike<number>, nbFaces = faces.length / 4): CleanMesh {
  const nbIn = Math.floor(positions.length / 3);
  // The box, for the tolerances.
  let lo0 = Infinity, lo1 = Infinity, lo2 = Infinity, hi0 = -Infinity, hi1 = -Infinity, hi2 = -Infinity;
  for (let i = 0; i < nbIn; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < lo0) lo0 = x;
    if (y < lo1) lo1 = y;
    if (z < lo2) lo2 = z;
    if (x > hi0) hi0 = x;
    if (y > hi1) hi1 = y;
    if (z > hi2) hi2 = z;
  }
  const diag = Math.hypot(hi0 - lo0, hi1 - lo1, hi2 - lo2) || 1;
  // 1. Weld: one vertex for each place, at a millionth of the size.
  const tol = diag * 1e-6;
  const remap = new Uint32Array(nbIn);
  const keyed = new Map<string, number>();
  const kept: number[] = [];
  for (let i = 0; i < nbIn; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const key = `${Math.round((x - lo0) / tol)},${Math.round((y - lo1) / tol)},${Math.round((z - lo2) / tol)}`;
    const at = keyed.get(key);
    if (at !== undefined) {
      remap[i] = at;
      continue;
    }
    const id = kept.length / 3;
    keyed.set(key, id);
    remap[i] = id;
    kept.push(x, y, z);
  }
  const welded = nbIn - kept.length / 3;

  // 2. Triangles (a quad split along a-c), through the weld, with the
  // degenerate and the duplicates dropped.
  const tris: number[] = [];
  let degenerate = 0;
  let duplicate = 0;
  let trianglesIn = 0;
  const seen = new Set<string>();
  const minArea2 = (diag * 1e-9) ** 2;
  const add = (a: number, b: number, c: number): void => {
    trianglesIn++;
    if (a === b || b === c || a === c) {
      degenerate++;
      return;
    }
    const ux = kept[b * 3] - kept[a * 3], uy = kept[b * 3 + 1] - kept[a * 3 + 1], uz = kept[b * 3 + 2] - kept[a * 3 + 2];
    const vx = kept[c * 3] - kept[a * 3], vy = kept[c * 3 + 1] - kept[a * 3 + 1], vz = kept[c * 3 + 2] - kept[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz <= minArea2) {
      degenerate++;
      return;
    }
    const s = [a, b, c].sort((p, q) => p - q);
    const key = `${s[0]},${s[1]},${s[2]}`;
    if (seen.has(key)) {
      duplicate++;
      return;
    }
    seen.add(key);
    tris.push(a, b, c);
  };
  for (let f = 0; f < nbFaces; f++) {
    const a = faces[f * 4], b = faces[f * 4 + 1], c = faces[f * 4 + 2], d = faces[f * 4 + 3];
    if (a >= nbIn || b >= nbIn || c >= nbIn) continue;
    add(remap[a], remap[b], remap[c]);
    if (d !== TRI && d < nbIn) add(remap[a], remap[c], remap[d]);
  }

  // 3. Edges with more than two triangles (voxel remeshes have them where
  // two parts of the surface touch along a voxel edge) are cut apart into
  // sheets, and the vertices where they touch split, one a fan.
  const split = splitNonManifold(kept, Uint32Array.from(tris));

  // 4. Pieces, after the cut (it can free a crumb that only touched the
  // rest): those under 1% of the triangles go, the largest always stays,
  // and only the vertices the triangles left use are kept.
  const pieces = dropIslands(split.positions, split.triangles);

    // 5. What is still not manifold: edges with three triangles or more, and
  // edges walked the same way by both of theirs.
  const finalPos = pieces.positions;
  const finalTris = pieces.triangles;
  const edges = new Map<number, number[]>();
  const nbV = finalPos.length / 3;
  const edgeKey = (a: number, b: number): number => (a < b ? a * nbV + b : b * nbV + a);
  for (let t = 0; t < finalTris.length / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const a = finalTris[t * 3 + k];
      const b = finalTris[t * 3 + ((k + 1) % 3)];
      const key = edgeKey(a, b);
      const list = edges.get(key);
      // +1 walked low to high, -1 high to low.
      const dir = a < b ? 1 : -1;
      if (list) list.push(dir);
      else edges.set(key, [dir]);
    }
  }
  let nonManifoldEdges = 0;
  let flippedEdges = 0;
  let borderEdges = 0;
  for (const list of edges.values()) {
    if (list.length === 1) borderEdges++;
    else if (list.length > 2) nonManifoldEdges++;
    else if (list[0] === list[1]) flippedEdges++;
  }
  return {
    positions: Float64Array.from(finalPos),
    triangles: finalTris,
    report: {
      welded,
      splitEdges: split.edges,
      splitVertices: split.vertices,
      degenerate,
      duplicate,
      islands: pieces.islands,
      islandFaces: pieces.faces,
      nonManifoldEdges: nonManifoldEdges + split.unpaired,
      flippedEdges: flippedEdges + split.flipped,
      borderEdges,
      trianglesIn,
      trianglesOut: finalTris.length / 3,
    },
  };
}

/**
 * Drop the pieces (triangles joined through shared corners) under
 * ISLAND_SHARE of the triangles, the largest always kept, and the
 * vertices no triangle left uses.
 */
export function dropIslands(pos: number[], tris: Uint32Array): { positions: number[]; triangles: Uint32Array; islands: number; faces: number } {
  const nbT = tris.length / 3;
  const parent = new Int32Array(pos.length / 3);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let t = 0; t < nbT; t++) {
    const a = find(tris[t * 3]);
    for (let k = 1; k < 3; k++) {
      const b = find(tris[t * 3 + k]);
      if (a !== b) parent[b] = a;
    }
  }
  const sizes = new Map<number, number>();
  for (let t = 0; t < nbT; t++) {
    const r = find(tris[t * 3]);
    sizes.set(r, (sizes.get(r) ?? 0) + 1);
  }
  let largest = -1;
  let largestSize = 0;
  for (const [r, n] of sizes) if (n > largestSize) [largest, largestSize] = [r, n];
  const minPiece = nbT * ISLAND_SHARE;
  const gone = (r: number): boolean => r !== largest && (sizes.get(r) ?? 0) < minPiece;
  let islands = 0;
  let faces = 0;
  for (const [r, n] of sizes) {
    if (gone(r)) {
      islands++;
      faces += n;
    }
  }
  const used = new Int32Array(pos.length / 3).fill(-1);
  const outTris = new Uint32Array((nbT - faces) * 3);
  const outPos: number[] = [];
  let w = 0;
  for (let t = 0; t < nbT; t++) {
    if (gone(find(tris[t * 3]))) continue;
    for (let k = 0; k < 3; k++) {
      const v = tris[t * 3 + k];
      if (used[v] < 0) {
        used[v] = outPos.length / 3;
        outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      }
      outTris[w++] = used[v];
    }
  }
  return { positions: outPos, triangles: outTris, islands, faces };
}

/**
 * Make a triangle mesh manifold where it can be without moving anything.
 * Around an edge of more than two triangles they are sorted by angle and
 * paired across the solid's inside, the two that bound each wedge of it,
 * so each part of a surface that touches another along the edge keeps its
 * own (a pairing that does not come out leaves those triangles open
 * there). Then every vertex gets one copy a fan of triangles around it,
 * so parts that touch at a point, or along an edge now cut, share no
 * vertex. Half-edge h runs from corner h (tris[h]) to the next corner of
 * its triangle.
 */
export function splitNonManifold(pos: number[], tris: Uint32Array): { positions: number[]; triangles: Uint32Array; edges: number; vertices: number; flipped: number; unpaired: number } {
  const nbT = tris.length / 3;
  const nbV = pos.length / 3;
  const next = (h: number): number => h - (h % 3) + ((h % 3) + 1) % 3;
  const prev = (h: number): number => h - (h % 3) + ((h % 3) + 2) % 3;
  const byEdge = new Map<number, number[]>();
  for (let h = 0; h < nbT * 3; h++) {
    const a = tris[h];
    const b = tris[next(h)];
    const key = a < b ? a * nbV + b : b * nbV + a;
    const list = byEdge.get(key);
    if (list) list.push(h);
    else byEdge.set(key, [h]);
  }
  const opp = new Int32Array(nbT * 3).fill(-1);
  let edgesCut = 0;
  let flipped = 0;
  let unpaired = 0;
  /** The edges of more than two triangles: their half-edges by angle, and the pairings to try. */
  const cuts: Array<{ order: number[]; ways: number[]; at: number }> = [];
  const p = (v: number, k: number): number => pos[v * 3 + k];
  for (const hs of byEdge.values()) {
    if (hs.length === 2) {
      const [h0, h1] = hs;
      if (tris[h0] === tris[next(h1)]) {
        opp[h0] = h1;
        opp[h1] = h0;
      } else flipped++;
      continue;
    }
    if (hs.length < 3) continue;
    // A frame about the edge, from its lower vertex a to b.
    const a = Math.min(tris[hs[0]], tris[next(hs[0])]);
    const b = Math.max(tris[hs[0]], tris[next(hs[0])]);
    const ax = [p(b, 0) - p(a, 0), p(b, 1) - p(a, 1), p(b, 2) - p(a, 2)];
    const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    for (let k = 0; k < 3; k++) ax[k] /= al;
    const seed = Math.abs(ax[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const e1 = [ax[1] * seed[2] - ax[2] * seed[1], ax[2] * seed[0] - ax[0] * seed[2], ax[0] * seed[1] - ax[1] * seed[0]];
    const l1 = Math.hypot(e1[0], e1[1], e1[2]) || 1;
    for (let k = 0; k < 3; k++) e1[k] /= l1;
    const e2 = [ax[1] * e1[2] - ax[2] * e1[1], ax[2] * e1[0] - ax[0] * e1[2], ax[0] * e1[1] - ax[1] * e1[0]];
    const around = hs.map((h) => {
      const c = tris[prev(h)];
      const w = [p(c, 0) - p(a, 0), p(c, 1) - p(a, 1), p(c, 2) - p(a, 2)];
      const t = h - (h % 3);
      const q0 = tris[t], q1 = tris[t + 1], q2 = tris[t + 2];
      const u = [p(q1, 0) - p(q0, 0), p(q1, 1) - p(q0, 1), p(q1, 2) - p(q0, 2)];
      const v = [p(q2, 0) - p(q0, 0), p(q2, 1) - p(q0, 1), p(q2, 2) - p(q0, 2)];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      return {
        h,
        angle: Math.atan2(w[0] * e2[0] + w[1] * e2[1] + w[2] * e2[2], w[0] * e1[0] + w[1] * e1[1] + w[2] * e1[2]),
        up: tris[h] === a,
        n,
      };
    });
    around.sort((x, y) => x.angle - y.angle);
    const k = around.length;
    // How much the wedge from i to i + 1 looks like the solid's inside:
    // both normals pointing away from it (positive), or toward it. Null
    // when the two run the same way along the edge, which no pairing may
    // join.
    const insideness = (i: number): number | null => {
      const f = around[i];
      const g = around[(i + 1) % k];
      if (f.up === g.up) return null;
      let d = g.angle - f.angle;
      if (d <= 0) d += Math.PI * 2;
      const m = f.angle + d / 2;
      const bx = Math.cos(m) * e1[0] + Math.sin(m) * e2[0];
      const by = Math.cos(m) * e1[1] + Math.sin(m) * e2[1];
      const bz = Math.cos(m) * e1[2] + Math.sin(m) * e2[2];
      const unit = (n: number[]): number => Math.hypot(n[0], n[1], n[2]) || 1;
      return -(f.n[0] * bx + f.n[1] * by + f.n[2] * bz) / unit(f.n) - (g.n[0] * bx + g.n[1] * by + g.n[2] * bz) / unit(g.n);
    };
    // Of the two ways to pair neighbours, the one whose wedges are most the
    // inside (a smoothed voxel surface is not always clear-cut about it)
    // first; the other is tried if that one leaves the edge joined.
    const ways: Array<{ s: number; score: number }> = [];
    for (let s = 0; s < 2 && k % 2 === 0; s++) {
      let score = 0;
      for (let i = s; i < k + s && score > -Infinity; i += 2) {
        const w = insideness(i % k);
        score = w === null ? -Infinity : score + w;
      }
      if (score > -Infinity) ways.push({ s, score });
    }
    ways.sort((x, y) => y.score - x.score);
    if (!ways.length) {
      unpaired++;
      continue;
    }
    cuts.push({ order: around.map((x) => x.h), ways: ways.map((w) => w.s), at: 0 });
  }
  const pair = (cut: { order: number[]; ways: number[]; at: number }): void => {
    const k = cut.order.length;
    for (const h of cut.order) opp[h] = -1;
    const s = cut.ways[cut.at];
    for (let i = s; i < k + s; i += 2) {
      const h0 = cut.order[i % k];
      const h1 = cut.order[(i + 1) % k];
      opp[h0] = h1;
      opp[h1] = h0;
    }
  };
  for (const cut of cuts) pair(cut);
  // Fans: corners around a vertex joined through paired edges.
  const corner = new Int32Array(nbT * 3);
  let out: number[] = [];
  let extra = 0;
  const fans = (): void => {
    corner.fill(-1);
    const taken = new Uint8Array(nbV);
    out = pos.slice();
    extra = 0;
    const stack: number[] = [];
    for (let h0 = 0; h0 < nbT * 3; h0++) {
      if (corner[h0] >= 0) continue;
      const v = tris[h0];
      let id = v;
      if (taken[v]) {
        id = out.length / 3;
        out.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        extra++;
      }
      taken[v] = 1;
      corner[h0] = id;
      stack.push(h0);
      while (stack.length) {
        const h = stack.pop()!;
        // Across the edge coming in to v, and the edge going out of it.
        const o1 = opp[prev(h)];
        const o2 = opp[h];
        for (const c of [o1, o2 >= 0 ? next(o2) : -1]) {
          if (c >= 0 && corner[c] < 0 && tris[c] === v) {
            corner[c] = id;
            stack.push(c);
          }
        }
      }
    }
  };
  // A cut whose two ends are still one fan each has joined what it cut:
  // the other pairing is tried there, and the fans found again.
  const joined = (cut: { order: number[] }): boolean => {
    const seen = new Map<number, number>();
    for (const h of cut.order) {
      const a = corner[h];
      const b = corner[next(h)];
      const key = a < b ? a * (nbV * 4) + b : b * (nbV * 4) + a;
      const n = (seen.get(key) ?? 0) + 1;
      if (n > 2) return true;
      seen.set(key, n);
    }
    return false;
  };
  fans();
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const cut of cuts) {
      if (cut.at + 1 < cut.ways.length && joined(cut)) {
        cut.at++;
        pair(cut);
        changed = true;
      }
    }
    if (!changed) break;
    fans();
  }
  for (const cut of cuts) if (joined(cut)) unpaired++;
  edgesCut = cuts.length;
  const outTris = new Uint32Array(nbT * 3);
  for (let h = 0; h < nbT * 3; h++) outTris[h] = corner[h];
  return { positions: out, triangles: outTris, edges: edgesCut, vertices: extra, flipped, unpaired };
}

/** Why a cleaned mesh cannot go to QuadriFlow, or null when it can. */
export function refusal(report: CleanupReport): string | null {
  if (report.trianglesOut < 4) return 'This object has no surface for Quad remesh to work on.';
  const bad: string[] = [];
  if (report.nonManifoldEdges) bad.push(`${report.nonManifoldEdges} ${report.nonManifoldEdges === 1 ? 'edge is' : 'edges are'} shared by more than two faces`);
  if (report.flippedEdges) bad.push(`${report.flippedEdges} ${report.flippedEdges === 1 ? 'edge joins faces' : 'edges join faces'} wound opposite ways`);
  if (!bad.length) return null;
  return `This surface is not manifold (${bad.join(', and ')}), and Quad remesh needs one that is. Run Voxel remesh first, then Quad remesh.`;
}

/** An OBJ of positions and triangles, as QuadriFlow's loader reads it. */
export function writeObj(positions: ArrayLike<number>, triangles: ArrayLike<number>): string {
  const parts: string[] = [];
  for (let i = 0; i + 2 < positions.length; i += 3) parts.push(`v ${positions[i]} ${positions[i + 1]} ${positions[i + 2]}`);
  for (let i = 0; i + 2 < triangles.length; i += 3) parts.push(`f ${triangles[i] + 1} ${triangles[i + 1] + 1} ${triangles[i + 2] + 1}`);
  parts.push('');
  return parts.join('\n');
}

export interface FaceMesh {
  positions: Float32Array;
  /** Four a face, TRI for a triangle's fourth. */
  faces: Uint32Array;
  quads: number;
  triangles: number;
}

/**
 * QuadriFlow's OBJ back as SculptGL faces: every face is written with
 * four corners, a triangle repeating one; a face left with fewer than
 * three different corners is dropped, and so is a vertex no face uses.
 */
export function parseObjFaces(text: string): FaceMesh {
  const pos: number[] = [];
  const raw: number[] = [];
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      pos.push(Number(p[1]), Number(p[2]), Number(p[3]));
    } else if (line.startsWith('f ')) {
      const p = line.split(/\s+/).slice(1).map((s) => parseInt(s, 10) - 1);
      const corners: number[] = [];
      for (const c of p) {
        if (!(c >= 0) || c >= pos.length / 3 + 1e9) continue;
        if (corners.length && corners[corners.length - 1] === c) continue;
        corners.push(c);
      }
      while (corners.length > 1 && corners[0] === corners[corners.length - 1]) corners.pop();
      if (new Set(corners).size !== corners.length || corners.length < 3 || corners.length > 4) continue;
      raw.push(corners[0], corners[1], corners[2], corners.length === 4 ? corners[3] : TRI);
    }
  }
  const nbV = pos.length / 3;
  const used = new Int32Array(nbV).fill(-1);
  const out: number[] = [];
  const faces: number[] = [];
  let quads = 0;
  let triangles = 0;
  for (let f = 0; f < raw.length; f += 4) {
    const n = raw[f + 3] === TRI ? 3 : 4;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const c = raw[f + k];
      if (c >= nbV || !Number.isFinite(pos[c * 3]) || !Number.isFinite(pos[c * 3 + 1]) || !Number.isFinite(pos[c * 3 + 2])) ok = false;
    }
    if (!ok) continue;
    for (let k = 0; k < 4; k++) {
      const c = raw[f + k];
      if (k === 3 && n === 3) {
        faces.push(TRI);
        continue;
      }
      if (used[c] < 0) {
        used[c] = out.length / 3;
        out.push(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
      }
      faces.push(used[c]);
    }
    if (n === 4) quads++;
    else triangles++;
  }
  return { positions: Float32Array.from(out), faces: Uint32Array.from(faces), quads, triangles };
}

/** Reverse every face's winding in place: [a b c d] to [a d c b], [a b c] to [a c b]. */
export function flipFaces(faces: Uint32Array): void {
  for (let j = 0; j + 3 < faces.length; j += 4) {
    if (faces[j + 3] === TRI) {
      const b = faces[j + 1];
      faces[j + 1] = faces[j + 2];
      faces[j + 2] = b;
    } else {
      const b = faces[j + 1];
      faces[j + 1] = faces[j + 3];
      faces[j + 3] = b;
    }
  }
}

/**
 * The nearest of a set of points, on a uniform grid of about two points
 * a cell. Built once, asked many times.
 */
export class PointGrid {
  private readonly lo: [number, number, number];
  private readonly cell: number;
  private readonly dims: [number, number, number];
  private readonly start: Uint32Array;
  private readonly items: Uint32Array;
  private readonly points: ArrayLike<number>;

  constructor(points: ArrayLike<number>) {
    this.points = points;
    const n = Math.floor(points.length / 3);
    const lo: [number, number, number] = [Infinity, Infinity, Infinity];
    const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const x = points[i * 3 + k];
        if (x < lo[k]) lo[k] = x;
        if (x > hi[k]) hi[k] = x;
      }
    }
    if (!n) {
      lo[0] = lo[1] = lo[2] = 0;
      hi[0] = hi[1] = hi[2] = 0;
    }
    const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const vol = Math.max(ext[0], 1e-12) * Math.max(ext[1], 1e-12) * Math.max(ext[2], 1e-12);
    let cell = Math.cbrt((vol * 2) / Math.max(n, 1));
    cell = Math.max(cell, Math.max(ext[0], ext[1], ext[2]) / 256, 1e-9);
    const dims: [number, number, number] = [0, 1, 2].map((k) => Math.max(1, Math.ceil(ext[k] / cell) + 1)) as [number, number, number];
    this.lo = lo;
    this.cell = cell;
    this.dims = dims;
    const count = new Uint32Array(dims[0] * dims[1] * dims[2] + 1);
    const at = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      at[i] = this.index(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
      count[at[i] + 1]++;
    }
    for (let c = 1; c < count.length; c++) count[c] += count[c - 1];
    this.start = count.slice();
    const fill = count.slice();
    this.items = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.items[fill[at[i]]++] = i;
  }

  private coord(x: number, k: number): number {
    return Math.min(this.dims[k] - 1, Math.max(0, Math.floor((x - this.lo[k]) / this.cell)));
  }

  private index(x: number, y: number, z: number): number {
    return (this.coord(z, 2) * this.dims[1] + this.coord(y, 1)) * this.dims[0] + this.coord(x, 0);
  }

  /** The index of the point nearest (x, y, z), or -1 when there are none. */
  nearest(x: number, y: number, z: number): number {
    if (!this.items.length) return -1;
    const cx = this.coord(x, 0), cy = this.coord(y, 1), cz = this.coord(z, 2);
    let best = -1;
    let bestD = Infinity;
    const maxR = Math.max(this.dims[0], this.dims[1], this.dims[2]);
    for (let r = 0; r <= maxR; r++) {
      // Every cell on the shell of the cube r cells out.
      for (let k = cz - r; k <= cz + r; k++) {
        if (k < 0 || k >= this.dims[2]) continue;
        for (let j = cy - r; j <= cy + r; j++) {
          if (j < 0 || j >= this.dims[1]) continue;
          const onShell = k === cz - r || k === cz + r || j === cy - r || j === cy + r;
          for (let i = cx - r; i <= cx + r; i += onShell || r === 0 ? 1 : 2 * r) {
            if (i < 0 || i >= this.dims[0]) continue;
            const c = (k * this.dims[1] + j) * this.dims[0] + i;
            for (let s = this.start[c]; s < this.start[c + 1]; s++) {
              const p = this.items[s];
              const dx = this.points[p * 3] - x, dy = this.points[p * 3 + 1] - y, dz = this.points[p * 3 + 2] - z;
              const d = dx * dx + dy * dy + dz * dz;
              if (d < bestD) {
                bestD = d;
                best = p;
              }
            }
          }
        }
      }
      // Anything further out is at least r cells away.
      if (best >= 0 && bestD <= (r * this.cell) ** 2) break;
    }
    return best;
  }
}

/** Area-weighted vertex normals of a triangle mesh. */
export function vertexNormals(positions: ArrayLike<number>, triangles: ArrayLike<number>): Float64Array {
  const n = new Float64Array(positions.length);
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = triangles[t] * 3, b = triangles[t + 1] * 3, c = triangles[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      n[v] += nx;
      n[v + 1] += ny;
      n[v + 2] += nz;
    }
  }
  return n;
}

/**
 * Whether QuadriFlow's faces face the other way from the input's: the
 * faces vote, each against the input's normal at the vertex nearest its
 * centre, weighted by its area.
 */
export function facesInverted(out: FaceMesh, grid: PointGrid, inputNormals: Float64Array): boolean {
  const p = out.positions;
  const f = out.faces;
  let vote = 0;
  for (let j = 0; j + 3 < f.length; j += 4) {
    const n = f[j + 3] === TRI ? 3 : 4;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < n; k++) {
      cx += p[f[j + k] * 3];
      cy += p[f[j + k] * 3 + 1];
      cz += p[f[j + k] * 3 + 2];
    }
    cx /= n;
    cy /= n;
    cz /= n;
    // The face's normal: a, b, c (and a, c, d for a quad).
    let nx = 0, ny = 0, nz = 0;
    for (let k = 1; k + 1 < n; k++) {
      const a = f[j] * 3, b = f[j + k] * 3, c = f[j + k + 1] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      nx += uy * vz - uz * vy;
      ny += uz * vx - ux * vz;
      nz += ux * vy - uy * vx;
    }
    const near = grid.nearest(cx, cy, cz);
    if (near < 0) continue;
    vote += nx * inputNormals[near * 3] + ny * inputNormals[near * 3 + 1] + nz * inputNormals[near * 3 + 2] > 0 ? 1 : -1;
  }
  return vote < 0;
}
