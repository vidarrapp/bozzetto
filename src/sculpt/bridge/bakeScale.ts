import { mat4 } from 'gl-matrix';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';

/**
 * Folding an object's scale into its vertices (owner decision, with the
 * centimetre unit): Maya-like, a transform shows its scale until it is
 * frozen, and the places that make or convert objects - a primitive, an
 * OBJ import, Set scale, opening a scene saved in metres - freeze it, so
 * the channel box reads Scale 1 and real centimetres for what is there.
 * The gizmo and the channel box still scale by the matrix; nothing bakes
 * on their edits.
 *
 * The world result is kept exactly: the matrix loses its scale (rotation
 * and translation stay), and every multires level's vertices take it.
 *
 * - A uniform scale `s` (the usual case: a fit, a Set scale, metres to
 *   centimetres) multiplies every level's positions by s, the detail
 *   vectors with them (they are lengths in a frame made of the surface's
 *   unit normal and tangent, which a uniform scale leaves as they were),
 *   and the vertex normals by s squared (the engine's are area-weighted
 *   sums, never unit), so a level stepped to later synthesises exactly
 *   what it would have. The level on screen is refreshed (face normals,
 *   octree, buffers).
 * - A per-axis scale first synthesises every level above the one on
 *   screen, so each level holds its true positions, then maps them all
 *   and derives each level's normals and detail vectors again from the
 *   level below, the way the engine's own analysis does, and goes back to
 *   the level that was on screen without touching it.
 * - A matrix with shear (columns not at right angles) cannot keep its
 *   rotation apart from its scale: its whole 3x3 is baked and the matrix
 *   keeps its translation alone. Nothing in the app makes one; a hand-made
 *   file might.
 *
 * A dynamic-topology object (one level) has its positions mapped and its
 * normals derived again.
 */

/** Below this, a scale is 1 and a column is at right angles to another. */
const EPS = 1e-7;

/** What a MeshResolution level offers beside the facade (vendored MeshResolution.js). */
interface Level extends SculptMesh {
  computePartialSubdivision(v: Float32Array, c: Float32Array, m: Float32Array, nbUp: number): void;
  computeDetails(v: Float32Array, c: Float32Array, m: Float32Array, nbUp: number): void;
}

/** What a Multimesh offers beside the facade (vendored Multimesh.js). */
interface Stack extends SculptMesh {
  _meshes: Level[];
  _sel: number;
  setSelection(sel: number): void;
  selectResolution(sel: number): void;
}

/**
 * Fold `mesh`'s matrix scale into its vertices (see the file comment).
 * Returns the map that took the old local space to the new one (a
 * column-major 4x4, v' = A v), for whoever keeps a record in local space
 * (an OBJ's numbering, objSource.ts), or null when there was no scale to
 * fold. The caller refreshes the display (the matrix and the vertices
 * changed under it).
 */
export function bakeScale(mesh: SculptMesh): mat4 | null {
  const m = mesh.getMatrix();
  const col = (c: number): [number, number, number] => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
  const cols = [col(0), col(1), col(2)];
  const len = cols.map((c) => Math.hypot(c[0], c[1], c[2]));
  if (!len.every((l) => l > 0 && Number.isFinite(l))) return null;
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const square =
    Math.abs(dot(cols[0], cols[1])) <= EPS * len[0] * len[1] &&
    Math.abs(dot(cols[1], cols[2])) <= EPS * len[1] * len[2] &&
    Math.abs(dot(cols[0], cols[2])) <= EPS * len[0] * len[2];
  const a = mat4.create();
  if (square) {
    if (len.every((l) => Math.abs(l - 1) <= EPS)) return null;
    mat4.fromScaling(a, len as [number, number, number]);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] = cols[c][r] / len[c];
  } else {
    // Shear: the whole linear part goes into the vertices.
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) a[c * 4 + r] = cols[c][r];
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] = c === r ? 1 : 0;
  }
  transformLocal(mesh, a);
  return a;
}

/**
 * Map every level of `mesh` by the affine `a` in its own local space
 * (v' = A v), keeping its multires stack consistent (see the file
 * comment). The matrix is left alone: the caller decides what it becomes.
 */
export function transformLocal(mesh: SculptMesh, a: mat4): void {
  const stack = mesh._meshes ? (mesh as unknown as Stack) : null;
  if (!stack || stack._meshes.length < 2) {
    mapPositions(mesh, a);
    mesh.updateGeometry();
    mesh.updateCenter();
    mesh.updateBuffers();
    return;
  }
  const s = uniformScale(a);
  if (s !== null) {
    const s2 = s * s;
    for (const level of stack._meshes) {
      mapPositions(level, a);
      if (s !== 1) {
        const n = level.getNormals();
        for (let i = 0, k = level.getNbVertices() * 3; i < k; i++) n[i] *= s2;
        const d = level._detailsXYZ;
        if (d) for (let i = 0; i < d.length; i++) d[i] *= s;
      }
    }
    // The level on screen: its faces and octree from the new positions.
    // Its vertex normals were scaled above, as a recompute would make them.
    mesh.updateFacesAabbAndNormal();
    mesh.updateOctree();
    mesh.updateCenter();
    mesh.updateBuffers();
    return;
  }
  // Per axis: every level's true positions first, mapped, then each
  // level's normals and detail vectors from the one below.
  const sel = stack._sel;
  const top = stack._meshes.length - 1;
  stack.selectResolution(top);
  for (const level of stack._meshes) mapPositions(level, a);
  for (let k = 0; k <= top; k++) {
    stack.setSelection(k);
    stack.updateGeometry();
  }
  for (let k = 1; k <= top; k++) {
    const up = stack._meshes[k];
    const nb = up.getNbVertices();
    const v = new Float32Array(nb * 3);
    const c = new Float32Array(nb * 3);
    const mt = new Float32Array(nb * 3);
    stack._meshes[k - 1].computePartialSubdivision(v, c, mt, nb);
    up.computeDetails(v, c, mt, nb);
  }
  stack.setSelection(sel);
  stack.updateGeometry();
  stack.updateCenter();
  stack.updateBuffers();
}

/** `a`'s uniform scale when its linear part is one (translation allowed), else null. */
function uniformScale(a: mat4): number | null {
  const s = a[0];
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      const want = c === r ? s : 0;
      if (Math.abs(a[c * 4 + r] - want) > EPS * Math.abs(s)) return null;
    }
  }
  return s > 0 ? s : null;
}

/** A level's live positions through `a`. */
function mapPositions(level: SculptMesh, a: mat4): void {
  const v = level.getVertices();
  for (let i = 0, n = level.getNbVertices() * 3; i < n; i += 3) {
    const x = v[i];
    const y = v[i + 1];
    const z = v[i + 2];
    v[i] = a[0] * x + a[4] * y + a[8] * z + a[12];
    v[i + 1] = a[1] * x + a[5] * y + a[9] * z + a[13];
    v[i + 2] = a[2] * x + a[6] * y + a[10] * z + a[14];
  }
}

/** Positions (three a vertex) through `a`, in place: an OBJ record's level 0 (objSource.ts). */
export function mapPoints(p: Float32Array | number[], a: mat4): void {
  for (let i = 0; i + 2 < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    p[i] = a[0] * x + a[4] * y + a[8] * z + a[12];
    p[i + 1] = a[1] * x + a[5] * y + a[9] * z + a[13];
    p[i + 2] = a[2] * x + a[6] * y + a[10] * z + a[14];
  }
}
