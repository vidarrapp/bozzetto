import { BufferAttribute, BufferGeometry } from 'three';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';

/**
 * Replaces SculptGL's RenderData: one THREE.BufferGeometry wrapping the
 * vendored mesh's typed arrays (plan 6.1). The vendor's arrays are
 * over-allocated for dynamic growth, so attributes cover the full backing
 * array and setDrawRange limits drawing to the live region.
 *
 * WS0 scope: position + normal + index with full-array uploads on every
 * commit, rebinding whenever the vendor swaps a backing array (growth or a
 * multiresolution level switch). WS1 adds updateRanges coalescing and the
 * color / materialsPBR attributes.
 *
 * The vendored Mesh.js routes its updateGeometryBuffers / updateBuffers
 * calls to the onGeometryBuffers / onAllBuffers hooks below (see the tagged
 * seam edits) whenever a mesh has no RenderData, which in Bozzetto is always.
 */
export class GeometrySync {
  readonly geometry = new BufferGeometry();
  private mesh: SculptMesh | null = null;

  /** Wrap `mesh` and install the buffer-update hook on it. */
  bind(mesh: SculptMesh): void {
    if (this.mesh) this.mesh._bridgeSync = null;
    this.mesh = mesh;
    mesh._bridgeSync = this;
    this.rebuild();
  }

  /** Full attribute rebuild: needed at bind and whenever arrays are swapped. */
  private rebuild(): void {
    const mesh = this.mesh;
    if (!mesh) return;
    this.geometry.setAttribute('position', new BufferAttribute(mesh.getVertices(), 3));
    this.geometry.setAttribute('normal', new BufferAttribute(mesh.getNormals(), 3));
    this.geometry.setIndex(new BufferAttribute(mesh.getTriangles(), 1));
    this.geometry.setDrawRange(0, mesh.getNbTriangles() * 3);
  }

  /** True when any backing array was swapped out from under an attribute. */
  private arraysChanged(mesh: SculptMesh): boolean {
    const pos = this.geometry.getAttribute('position') as BufferAttribute | undefined;
    const nrm = this.geometry.getAttribute('normal') as BufferAttribute | undefined;
    const idx = this.geometry.getIndex();
    return (
      !pos ||
      pos.array !== mesh.getVertices() ||
      !nrm ||
      nrm.array !== mesh.getNormals() ||
      !idx ||
      idx.array !== mesh.getTriangles()
    );
  }

  /** Vendor hook: positions + normals changed (the per-stroke path). */
  onGeometryBuffers(mesh: SculptMesh): void {
    if (mesh !== this.mesh) return;
    if (this.arraysChanged(mesh)) {
      this.rebuild();
      return;
    }
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('normal') as BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, mesh.getNbTriangles() * 3);
  }

  /** Vendor hook: everything changed (topology ops, resolution switches). */
  onAllBuffers(mesh: SculptMesh): void {
    if (mesh !== this.mesh) return;
    if (this.arraysChanged(mesh)) {
      this.rebuild();
      return;
    }
    this.onGeometryBuffers(mesh);
    const idx = this.geometry.getIndex();
    if (idx) idx.needsUpdate = true;
  }

  dispose(): void {
    if (this.mesh) this.mesh._bridgeSync = null;
    this.mesh = null;
    this.geometry.dispose();
  }
}
