import { Color } from 'three';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { SculptSession } from './SculptSession';
import type { SavedScene } from './ScenePersist';

/**
 * Per-object materials.
 *
 * Sculpt mode reads roughness and metalness from `materialsPBR.x/.y` and
 * shows the object's albedo times the paint in its `color` attribute, so a
 * "material" needs no three.js material of its own: it is a named set of
 * values. Roughness and metalness are written across an object's vertices;
 * the albedo is given to the object's display mesh (mode.ts syncAlbedos),
 * where the shader multiplies the paint by it. The paint is exactly what was
 * picked (white until painted) and nothing stored is altered by the albedo, so
 * a change of material, or of its albedo, costs nothing and keeps the paint.
 */

export interface SculptMaterial {
  id: string;
  name: string;
  /** sRGB hex, as the picker and the Render panel speak it. */
  albedo: string;
  roughness: number;
  metalness: number;
}

/** What a material id looks like: `m` and its sequence number. */
export const MATERIAL_ID = /^m\d{1,9}$/;

/** SculptGL's own starting values, so an untouched object matches upstream. */
export const DEFAULT_MATERIAL: Omit<SculptMaterial, 'id' | 'name'> = {
  albedo: '#fed9a8',
  roughness: 0.5,
  metalness: 0,
};

export class MaterialLibrary {
  private readonly materials: SculptMaterial[] = [];
  private readonly assigned = new Map<number, string>();
  /** Meshes whose vertex colours are paint (a stroke, a fill or a layer): never written over with white. */
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

  /** Point an object at a material and write its roughness and metalness across the mesh. Its paint stays; its albedo is the new material's. */
  assign(mesh: SculptMesh, id: string): void {
    if (!this.get(id)) return;
    this.assigned.set(mesh.getID(), id);
    this.applyTo(mesh);
    this.onChange?.();
  }

  /**
   * A duplicate of `source`: the same material, and the same claim on its
   * colours. The copy already carries the source's vertex colours; the
   * point is that a painted source's copy counts as painted too, or the
   * next fill would paint over them with the material's albedo.
   */
  adoptCopy(copy: SculptMesh, source: SculptMesh): void {
    this.assigned.set(copy.getID(), this.materialFor(source).id);
    if (this.painted.has(source.getID())) this.painted.add(copy.getID());
    this.applyTo(copy);
    this.onChange?.();
  }

  /** Note that a paint stroke has taken ownership of a mesh's colours. */
  markPainted(mesh: SculptMesh): void {
    this.painted.add(mesh.getID());
  }

  isPainted(mesh: SculptMesh): boolean {
    return this.painted.has(mesh.getID());
  }

  /** An object's albedo as linear colour: what its paint is multiplied by (publishing bakes it in). */
  albedoLinear(mesh: SculptMesh): [number, number, number] {
    const c = new Color(this.materialFor(mesh).albedo); // hex is sRGB; Color stores it linear
    return [c.r, c.g, c.b];
  }

  /**
   * Change a material. Roughness and metalness are written across every
   * object using it; the albedo needs nothing written (the shader reads it),
   * so editing it costs the same on any mesh and never touches the paint.
   */
  update(id: string, patch: Partial<Omit<SculptMaterial, 'id'>>): void {
    const mat = this.get(id);
    if (!mat) return;
    Object.assign(mat, patch);
    if ('roughness' in patch || 'metalness' in patch) {
      for (const mesh of this.session.getMeshes()) {
        if (this.materialFor(mesh).id === id) this.session.fillMaterials(mesh, mat.roughness, mat.metalness);
      }
    }
    this.onChange?.();
  }

  /** Set an object up: white colours where it has no paint (its albedo tints them), and its material's roughness and metalness. */
  applyTo(mesh: SculptMesh): void {
    this.initialised.add(mesh.getID());
    const mat = this.materialFor(mesh);
    if (!this.painted.has(mesh.getID())) this.session.fillColors(mesh, [1, 1, 1]);
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
    // While a scene is being rebuilt from a file, the meshes arrive one by
    // one - each firing the selection callback that lands here - before
    // loadFrom has learned which of them are painted. Filling then wiped
    // painted colours on every Open (review finding); loadFrom does the
    // one correct pass itself.
    if (this.restoring) return;
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
   * Back to a new scene's library: the one material, nothing assigned or
   * painted. For a record set aside at boot, whose objects are gone with it.
   */
  reset(): void {
    this.restoring = false;
    this.materials.length = 0;
    this.seq = 0;
    this.assigned.clear();
    this.painted.clear();
    this.initialised.clear();
    this.create('Clay');
  }

  /**
   * Rebuild from a scene record, after the meshes exist. A v3 record has no
   * materials, so the library keeps its default and every object points at
   * it - which is what those scenes already looked like.
   */
  /** Call before session.replaceScene/restoreScene; loadFrom ends it. */
  beginRestore(): void {
    this.restoring = true;
  }
  /**
   * The restore threw before loadFrom could run (a corrupt file that the
   * session rolled back). Without this the hold outlived the failure, and
   * every object created afterwards went without its material fill.
   */
  endRestore(): void {
    this.restoring = false;
  }
  private restoring = false;

  /**
   * The version step (scene version 5). Before it an object's colours held
   * its albedo already: an unpainted object was filled with it (loadFrom
   * fills white over that now, and its material tints it, the same picture),
   * and a painted object's colours are the paint with the albedo baked in.
   * Those objects keep their colours and get a white albedo, so albedo times
   * paint is what it was. A material several objects use is not whitened for
   * the unpainted ones: the painted objects get a copy of it, named "<name>
   * (painted)", with the albedo white, and the unpainted keep the shared one.
   */
  private whitenOldPaint(meshes: SculptMesh[]): void {
    const users = new Map<string, { painted: SculptMesh[]; others: number }>();
    for (const mesh of meshes) {
      const id = this.materialFor(mesh).id;
      const u = users.get(id) ?? { painted: [], others: 0 };
      if (this.painted.has(mesh.getID())) u.painted.push(mesh);
      else u.others++;
      users.set(id, u);
    }
    for (const [id, u] of users) {
      if (!u.painted.length) continue;
      const mat = this.get(id);
      if (!mat) continue;
      if (u.others === 0) {
        mat.albedo = '#ffffff';
        continue;
      }
      this.seq += 1;
      const copy: SculptMaterial = { ...mat, id: `m${this.seq}`, name: `${mat.name} (painted)`.slice(0, 80), albedo: '#ffffff' };
      this.materials.push(copy);
      for (const mesh of u.painted) this.assigned.set(mesh.getID(), copy.id);
    }
  }

  loadFrom(scene: SavedScene): void {
    this.restoring = false;
    // sanitizeScene has already made every material well formed; the ids
    // are checked again here because a bad one used to throw below, after
    // the scene had been swapped in, and the autosave then wrote the same
    // list back for every later boot to throw on.
    const restored = Array.isArray(scene.materials)
      ? scene.materials.filter((m) => typeof m?.id === 'string' && MATERIAL_ID.test(m.id))
      : [];
    if (restored.length) {
      this.materials.length = 0;
      for (const m of restored) this.materials.push({ ...m });
      // Keep new ids clear of restored ones.
      this.seq = this.materials.reduce((max, m) => Math.max(max, Number(m.id.slice(1))), 0);
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
    // A scene from before the albedo multiplied the paint (version 4 and
    // older) holds the albedo in its colours: an unpainted object's fill
    // below, a painted object's own. See whitenOldPaint.
    if ((scene.v ?? 3) < 5) this.whitenOldPaint(meshes);
    // Restored vertex colours are already correct; only the objects with no
    // painting of their own need white written over them (an older scene's
    // fill was its albedo, which tints them now).
    // Painted objects keep their colours but get their PBR channels
    // re-stamped from the material: the paint brush used to smear the
    // vendor's own roughness/metalness (0.3/0.95 - the shiny-paint bug)
    // into every stroke, and saves from before the fix carry those values.
    // Paint never writes PBR any more, so this heals old scenes and is a
    // no-op for new ones.
    for (const mesh of meshes) {
      if (!this.painted.has(mesh.getID())) {
        this.applyTo(mesh);
      } else {
        const mat = this.materialFor(mesh);
        this.session.fillMaterials(mesh, mat.roughness, mat.metalness);
      }
    }
    this.onChange?.();
  }
}
