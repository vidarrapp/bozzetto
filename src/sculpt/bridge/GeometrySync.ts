import { BufferAttribute, BufferGeometry } from 'three';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';

/**
 * Replaces SculptGL's RenderData: one THREE.BufferGeometry wrapping the
 * vendored mesh's typed arrays (plan 6.1). The vendor's arrays are
 * over-allocated for dynamic growth, so attributes cover the full backing
 * array and setDrawRange limits drawing to the live region.
 *
 * WS1 upload path: Mesh.updateGeometry feeds the per-step dirty vertex ids
 * through onDirtyGeometry (a tagged vendor seam); the next commit turns them
 * into coalesced attribute update ranges. Both r184 backends apply
 * updateRanges as per-range GPU writes and clear them after upload
 * (WebGPUAttributeUtils.js:226, webgl-fallback WebGLAttributeUtils.js:221,
 * verified), so ranges accumulate safely across several stroke steps between
 * renders and GeometrySync never clears them itself. A commit with no dirty
 * feed (topology ops, undo restores, resolution switches) falls back to a
 * full-array upload, and any backing-array swap (growth, dyntopo, multires)
 * rebuilds the attributes outright.
 */

/** Merge dirty spans closer than this many array elements (plan: 4096). */
const RANGE_MERGE_GAP = 4096;
/** Beyond this many ranges per commit, fall back to a full upload. */
const RANGE_CAP = 64;

/** Upload accounting for the WS1 acceptance ("logged and bounded"). */
export interface SyncStats {
  /** Elements (floats) uploaded by the last commit (position + normal). */
  lastCommitElements: number;
  /** Ranged commits since bind. */
  rangedCommits: number;
  /** Full-array commits since bind. */
  fullCommits: number;
  /** Attribute rebuilds (array swaps: growth, dyntopo, multires). */
  rebuilds: number;
}

export class GeometrySync {
  readonly geometry = new BufferGeometry();
  readonly stats: SyncStats = {
    lastCommitElements: 0,
    rangedCommits: 0,
    fullCommits: 0,
    rebuilds: 0,
  };

  private mesh: SculptMesh | null = null;
  /** Sorted-later dirty vertex ids accumulated since the last commit. */
  private dirty: number[] = [];
  private dirtyIsFull = false;

  /** Wrap `mesh` and install the buffer-update hooks on it. */
  bind(mesh: SculptMesh): void {
    // Multi-mesh: another sync may already own our old mesh's hook, so only
    // clear a hook that is actually ours.
    if (this.mesh && this.mesh._bridgeSync === this) this.mesh._bridgeSync = null;
    this.mesh = mesh;
    mesh._bridgeSync = this;
    this.dirty.length = 0;
    this.dirtyIsFull = false;
    this.rebuild();
  }

  /** Full attribute rebuild: needed at bind and whenever arrays are swapped. */
  private rebuild(): void {
    const mesh = this.mesh;
    if (!mesh) return;
    this.geometry.setAttribute('position', new BufferAttribute(mesh.getVertices(), 3));
    this.geometry.setAttribute('normal', new BufferAttribute(mesh.getNormals(), 3));
    this.geometry.setAttribute('color', new BufferAttribute(mesh.getColors(), 3));
    // roughness / metallic / masking per vertex; the mask tint reads z (WS3).
    this.geometry.setAttribute('materialsPBR', new BufferAttribute(mesh.getMaterials(), 3));
    this.geometry.setIndex(new BufferAttribute(mesh.getTriangles(), 1));
    this.geometry.setDrawRange(0, mesh.getNbTriangles() * 3);
    this.stats.rebuilds++;
  }

  /** True when any backing array was swapped out from under an attribute. */
  private arraysChanged(mesh: SculptMesh): boolean {
    const pos = this.geometry.getAttribute('position') as BufferAttribute | undefined;
    const nrm = this.geometry.getAttribute('normal') as BufferAttribute | undefined;
    const col = this.geometry.getAttribute('color') as BufferAttribute | undefined;
    const mat = this.geometry.getAttribute('materialsPBR') as BufferAttribute | undefined;
    const idx = this.geometry.getIndex();
    return (
      !pos ||
      pos.array !== mesh.getVertices() ||
      !nrm ||
      nrm.array !== mesh.getNormals() ||
      !col ||
      col.array !== mesh.getColors() ||
      !mat ||
      mat.array !== mesh.getMaterials() ||
      !idx ||
      idx.array !== mesh.getTriangles()
    );
  }

  /** Vendor seam feed: the vertex ids touched by one updateGeometry call. */
  onDirtyGeometry(mesh: SculptMesh, iVerts?: Uint32Array): void {
    if (mesh !== this.mesh || this.dirtyIsFull) return;
    if (!iVerts) {
      this.dirtyIsFull = true; // a full recompute (topology op, undo, level switch)
      return;
    }
    for (let i = 0; i < iVerts.length; i++) this.dirty.push(iVerts[i]);
  }

  /** Vendor hook: positions + normals changed (the per-stroke path). */
  onGeometryBuffers(mesh: SculptMesh): void {
    if (mesh !== this.mesh) return;
    if (this.arraysChanged(mesh)) {
      this.rebuild();
      this.resetDirty();
      return;
    }
    const pos = this.geometry.getAttribute('position') as BufferAttribute;
    const nrm = this.geometry.getAttribute('normal') as BufferAttribute;
    this.commitGeometry(pos, nrm);
    this.geometry.setDrawRange(0, mesh.getNbTriangles() * 3);
  }

  /** Vendor hook: per-vertex colors/materials changed (mask and paint). */
  onColorsMaterials(mesh: SculptMesh): void {
    if (mesh !== this.mesh) return;
    if (this.arraysChanged(mesh)) {
      this.rebuild();
      this.resetDirty();
      return;
    }
    (this.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('materialsPBR') as BufferAttribute).needsUpdate = true;
  }

  /** Vendor hook: everything changed (topology ops, resolution switches). */
  onAllBuffers(mesh: SculptMesh): void {
    if (mesh !== this.mesh) return;
    if (this.arraysChanged(mesh)) {
      this.rebuild();
      this.resetDirty();
      return;
    }
    this.dirtyIsFull = true; // colors/materials/index have no dirty feed
    this.onGeometryBuffers(mesh);
    (this.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('materialsPBR') as BufferAttribute).needsUpdate = true;
    const idx = this.geometry.getIndex();
    if (idx) idx.needsUpdate = true;
  }

  /** Apply the accumulated dirty set to position + normal as update ranges. */
  private commitGeometry(pos: BufferAttribute, nrm: BufferAttribute): void {
    if (this.dirtyIsFull || this.dirty.length === 0) {
      // No usable dirty set: full upload. Ranges from an earlier commit in
      // the same frame would otherwise still be pending, and three uploads
      // ONLY those - the full upload silently never reached the GPU
      // (dyntopo: a ranged stroke step then a topology rebuild, every step).
      pos.clearUpdateRanges();
      nrm.clearUpdateRanges();
      pos.needsUpdate = true;
      nrm.needsUpdate = true;
      this.stats.fullCommits++;
      this.stats.lastCommitElements = pos.array.length * 2;
      this.resetDirty();
      return;
    }

    const ranges = coalesceVertexRanges(this.dirty);
    if (!ranges) {
      pos.clearUpdateRanges();
      nrm.clearUpdateRanges();
      pos.needsUpdate = true;
      nrm.needsUpdate = true;
      this.stats.fullCommits++;
      this.stats.lastCommitElements = pos.array.length * 2;
      this.resetDirty();
      return;
    }

    let elements = 0;
    for (const [start, count] of ranges) {
      pos.addUpdateRange(start, count);
      nrm.addUpdateRange(start, count);
      elements += count;
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
    this.stats.rangedCommits++;
    this.stats.lastCommitElements = elements * 2;
    this.resetDirty();
  }

  private resetDirty(): void {
    this.dirty.length = 0;
    this.dirtyIsFull = false;
  }

  dispose(): void {
    if (this.mesh && this.mesh._bridgeSync === this) this.mesh._bridgeSync = null;
    this.mesh = null;
    this.geometry.dispose();
  }
}

/**
 * Turn dirty vertex ids into merged [offsetElements, countElements] ranges
 * over an xyz-interleaved array. Ids are sorted, deduped implicitly by the
 * merge, and spans closer than RANGE_MERGE_GAP elements fuse. Returns null
 * when the spread defeats coalescing (more than RANGE_CAP ranges), which
 * callers treat as "do a full upload instead".
 */
function coalesceVertexRanges(dirty: number[]): Array<[number, number]> | null {
  // A typed-array sort (no comparator) is several times faster than
  // Array.sort with one, and this runs on every stroke step.
  const ids = Int32Array.from(dirty).sort();
  const ranges: Array<[number, number]> = [];
  let start = -1;
  let end = -1; // inclusive vertex ids
  for (const id of ids) {
    if (start < 0) {
      start = end = id;
      continue;
    }
    if (id * 3 - (end + 1) * 3 <= RANGE_MERGE_GAP) {
      if (id > end) end = id;
      continue;
    }
    ranges.push([start * 3, (end - start + 1) * 3]);
    if (ranges.length > RANGE_CAP) return null;
    start = end = id;
  }
  if (start >= 0) ranges.push([start * 3, (end - start + 1) * 3]);
  if (ranges.length > RANGE_CAP) return null;
  return ranges;
}
