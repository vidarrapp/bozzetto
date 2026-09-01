import { Color } from 'three';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { SculptSession } from './SculptSession';
import type { SavedScene } from './ScenePersist';

/**
 * Per-object materials.
 *
 * Sculpt mode reads albedo from the `color` attribute and roughness and
 * metalness from `materialsPBR.x/.y`, so a "material" needs no three.js
 * material of its own: it is a named set of values, and assigning it to an
 * object writes those values across that object's vertices. One shader,
 * any number of materials, and painting is the same operation at a smaller
 * radius - which is why a paint stroke and a material assignment compose
 * instead of fighting.
 *
 * An object that has been painted owns its vertices. Editing its material
 * leaves it alone; re-assigning is an explicit act and the caller confirms
 * first, because the fill cannot be undone selectively.
 */

export interface SculptMaterial {
  id: string;
  name: string;
  /** sRGB hex, as the picker and the Render panel speak it. */
  albedo: string;
  roughness: number;
  metalness: number;
}

/** SculptGL's own starting values, so an untouched object matches upstream. */
export const DEFAULT_MATERIAL: Omit<SculptMaterial, 'id' | 'name'> = {
  albedo: '#fed9a8',
  roughness: 0.5,
  metalness: 0,
};

export class MaterialLibrary {
  private readonly materials: SculptMaterial[] = [];
  private readonly assigned = new Map<number, string>();
  /** Meshes whose vertex colours a paint stroke owns. */
  private readonly painted = new Set<number>();
  /** Meshes that have had a material written to them at least once. */
  private readonly initialised = new Set<number>();
  private seq = 0;
  /** Fired when the list or an assignment changes (panels re-read). */
  onChange: (() => void) | null = null;

  constructor(private readonly session: SculptSession) {
    this.create('Clay');
  }

  list(): SculptMaterial[] {
    return this.materials;
  }

  get(id: string): SculptMaterial | undefined {
    return this.materials.find((m) => m.id === id);
  }

  create(name?: string): SculptMaterial {
    this.seq += 1;
    const mat: SculptMaterial = {
      id: `m${this.seq}`,
      name: name ?? `Material ${this.seq}`,
      ...DEFAULT_MATERIAL,
    };
    this.materials.push(mat);
    this.onChange?.();
    return mat;
  }

  remove(id: string): void {
    if (this.materials.length <= 1) return; // never leave a scene material-less
    const i = this.materials.findIndex((m) => m.id === id);
    if (i < 0) return;
    this.materials.splice(i, 1);
    const fallback = this.materials[0].id;
    for (const [mesh, assigned] of this.assigned) {
      if (assigned === id) this.assigned.set(mesh, fallback);
    }
    this.onChange?.();
  }

  /** The material an object uses, defaulting to the first one. */
  materialFor(mesh: SculptMesh): SculptMaterial {
    const id = this.assigned.get(mesh.getID());
    return (id ? this.get(id) : undefined) ?? this.materials[0];
  }

  /** Point an object at a material and write its values across the mesh. */
  assign(mesh: SculptMesh, id: string): void {
    if (!this.get(id)) return;
    this.assigned.set(mesh.getID(), id);
    this.painted.delete(mesh.getID()); // a fresh assignment is a fresh base
    this.applyTo(mesh);
    this.onChange?.();
  }

  /** Note that a paint stroke has taken ownership of a mesh's colours. */
  markPainted(mesh: SculptMesh): void {
    this.painted.add(mesh.getID());
  }

  isPainted(mesh: SculptMesh): boolean {
    return this.painted.has(mesh.getID());
  }

  /**
   * Re-write every object using `id`. Painted objects keep their colours -
   * their strokes are work - but still take the roughness and metalness,
   * which no stroke has touched unless the paint brush was set to write
   * them.
   */
  update(id: string, patch: Partial<Omit<SculptMaterial, 'id'>>): void {
    const mat = this.get(id);
    if (!mat) return;
    Object.assign(mat, patch);
    for (const mesh of this.session.getMeshes()) {
      if (this.materialFor(mesh).id === id) this.applyTo(mesh);
    }
    this.onChange?.();
  }

  /** Write a material's values into a mesh's colour and PBR attributes. */
  applyTo(mesh: SculptMesh): void {
    this.initialised.add(mesh.getID());
    const mat = this.materialFor(mesh);
    if (!this.painted.has(mesh.getID())) {
      const c = new Color(mat.albedo); // hex is sRGB; Color stores it linear
      this.session.fillColors(mesh, [c.r, c.g, c.b]);
    }
    this.session.fillMaterials(mesh, mat.roughness, mat.metalness);
  }

  /**
   * Set up any object that has not been given its material yet - a newly
   * added shape, or an extraction. Deliberately not a re-apply of the whole
   * scene: this runs on every mesh-list and selection change, and writing
   * two full attribute arrays per object each time would cost real work on
   * a multi-million-vertex scene for no change at all.
   */
  applyNew(): void {
    for (const mesh of this.session.getMeshes()) {
      if (this.initialised.has(mesh.getID())) continue;
      this.applyTo(mesh);
    }
  }

  /**
   * Write the library into a scene record. Assignments ride on the meshes
   * themselves, index-aligned with `session.getMeshes()`, because a saved
   * mesh has no identity of its own - the vendor hands out fresh ids on
   * restore, so anything keyed by id would land on the wrong object.
   */
  saveInto(scene: SavedScene): void {
    scene.materials = this.materials.map((m) => ({ ...m }));
    const meshes = this.session.getMeshes();
    scene.meshes.forEach((saved, i) => {
      const mesh = meshes[i];
      if (!mesh) return;
      saved.materialId = this.materialFor(mesh).id;
      saved.painted = this.painted.has(mesh.getID());
    });
  }

  /**
   * Rebuild from a scene record, after the meshes exist. A v3 record has no
   * materials, so the library keeps its default and every object points at
   * it - which is what those scenes already looked like.
   */
  loadFrom(scene: SavedScene): void {
    if (scene.materials?.length) {
      this.materials.length = 0;
      for (const m of scene.materials) this.materials.push({ ...m });
      // Keep new ids clear of restored ones.
      this.seq = this.materials.reduce((max, m) => {
        const n = Number(m.id.replace(/^m/, ''));
        return Number.isFinite(n) ? Math.max(max, n) : max;
      }, 0);
    }
    this.assigned.clear();
    this.painted.clear();
    this.initialised.clear();
    const meshes = this.session.getMeshes();
    scene.meshes.forEach((saved, i) => {
      const mesh = meshes[i];
      if (!mesh) return;
      if (saved.materialId && this.get(saved.materialId)) {
        this.assigned.set(mesh.getID(), saved.materialId);
      }
      if (saved.painted) this.painted.add(mesh.getID());
    });
    // Restored vertex colours are already correct; only the objects with no
    // painting of their own need their material written back over them.
    for (const mesh of meshes) if (!this.painted.has(mesh.getID())) this.applyTo(mesh);
    this.onChange?.();
  }
}
