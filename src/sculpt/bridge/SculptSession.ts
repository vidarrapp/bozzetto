import { CylinderGeometry, TorusGeometry, type BufferGeometry } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import Enums from '@sculpt-vendor/misc/Enums';
import Utils from '@sculpt-vendor/misc/Utils';
import Mesh from '@sculpt-vendor/mesh/Mesh';
import MeshStatic from '@sculpt-vendor/mesh/meshStatic/MeshStatic';
import MeshDynamic from '@sculpt-vendor/mesh/dynamic/MeshDynamic';
import Multimesh from '@sculpt-vendor/mesh/multiresolution/Multimesh';
import Subdivision from '@sculpt-vendor/editing/Subdivision';
import Remesh from '@sculpt-vendor/editing/Remesh';
import SculptManager from '@sculpt-vendor/editing/SculptManager';
import StateManager from '@sculpt-vendor/states/StateManager';
import StateMultiresolution from '@sculpt-vendor/states/StateMultiresolution';
import Picking from '@sculpt-vendor/math3d/Picking';
import { mat3, mat4, vec3 } from 'gl-matrix';
import { ClayStripsBrush, VolumetricMove } from './tools';
import type { SculptTool } from '@sculpt-vendor/editing/tools/SculptBase';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { CameraAdapter } from './CameraAdapter';
import type { SavedLevel, SavedMesh, SavedScene } from './ScenePersist';

/**
 * Ctrl+d subdivision gates. Past the soft line the user confirms (upstream
 * GuiTopology had the same dialog; a 4070-class desktop holds 60 fps at 4M
 * so capable machines may go on); the hard ceiling guards browser memory,
 * since the vendored mesh structures cost several times the raw arrays.
 */
const SOFT_SUBDIVISION_TRIS = 4000000;
const MAX_SUBDIVISION_TRIS = 16000000;

/** Surface data under the cursor, for the brush ring (world space). */
export interface HoverSurface {
  point: [number, number, number];
  normal: [number, number, number];
  worldRadius: number;
}

/**
 * The "main" object the vendored editing core talks to, ported from the
 * non-GL parts of SculptGL's Scene.js / SculptGL.js (plan 6.4): mesh list
 * management, selection, primitives, and the shared pointer/action state the
 * tools read. The full surface consumed by the vendored code was enumerated
 * at the pinned commit (18 methods, 6 fields); everything else was GUI or
 * renderer glue and is intentionally absent.
 */
export class SculptSession {
  // Pointer/action state the vendored tools and picking read directly.
  _mouseX = 0;
  _mouseY = 0;
  _lastMouseX = 0;
  _lastMouseY = 0;
  _action: number = Enums.Action.NOTHING;
  /** Always null: meshes run render-less (see the vendored Mesh.js seams). */
  readonly _gl = null;

  /** Fired when the active mesh instance changes (select, dyntopo, undo). */
  onActiveMeshChange: (() => void) | null = null;
  /** Fired when the multires level moves (step, subdivide, undo/redo). */
  onLevelChange: ((sel: number, levels: number) => void) | null = null;
  /** Fired on symmetry toggles (the palette checkbox mirrors the X key). */
  onSymmetryChange: ((on: boolean) => void) | null = null;

  private readonly meshes: SculptMesh[] = [];
  private readonly selectMeshes: SculptMesh[] = [];
  private mesh: SculptMesh | null = null;
  /** Display names (feeds the stats corner; scene graph/outliner later). */
  private readonly meshNames = new WeakMap<SculptMesh, string>();

  private readonly stateManager = new StateManager(this);
  private readonly sculptManager: SculptManager;
  private readonly picking: Picking;
  private readonly pickingSym: Picking;

  constructor(
    private readonly camera: CameraAdapter,
    private readonly canvas: HTMLCanvasElement,
    /** Ask Bozzetto for a redraw (the viewer's rAF loop already repaints). */
    private readonly requestRender: () => void,
  ) {
    // Deeper than upstream's 15: the WS2 fuzz exercises 50-deep undo, and the
    // WS5 capture design consumes undo states as timelapse deltas, so history
    // is worth keeping (a stroke state holds only the touched vertices).
    StateManager.STACK_LENGTH = 64;
    this.sculptManager = new SculptManager(this);
    // WS2f review pass: ZBrush-flavored overrides ride the vendor registry
    // (volumetric silhouette-grab Move with a softer falloff; the Standard
    // slot becomes a clay-strips brush).
    this.sculptManager._tools[Enums.Tools.MOVE] = new VolumetricMove(this) as unknown as SculptTool;
    this.sculptManager._tools[Enums.Tools.BRUSH] = new ClayStripsBrush(
      this,
    ) as unknown as SculptTool;
    this.picking = new Picking(this);
    this.pickingSym = new Picking(this, true);
  }

  // --- the main-object surface consumed by the vendored core --------------

  getCamera(): CameraAdapter {
    return this.camera;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getCanvasWidth(): number {
    return this.canvas.width;
  }

  getCanvasHeight(): number {
    return this.canvas.height;
  }

  /** Device-pixel ratio of the canvas (mouse coords are device px). */
  getPixelRatio(): number {
    const cssWidth = this.canvas.clientWidth;
    return cssWidth > 0 ? this.canvas.width / cssWidth : 1;
  }

  setCanvasCursor(style: string): void {
    this.canvas.style.cursor = style;
  }

  getMesh(): SculptMesh | null {
    return this.mesh;
  }

  /**
   * Paint a mesh's vertex colours a single colour.
   *
   * Sculpt albedo comes from the `color` attribute, and SculptGL starts
   * those at white, so an object has to be filled with its material colour
   * to read as that material at all. It is also what "painting fills with
   * the material colour first" means: the fill happens once, when an object
   * is created or recoloured, and after that a paint stroke owns the
   * vertices it touches.
   */
  fillColors(mesh: SculptMesh, rgb: [number, number, number]): void {
    const colors = mesh.getColors();
    const n = mesh.getNbVertices() * 3;
    for (let i = 0; i < n; i += 3) {
      colors[i] = rgb[0];
      colors[i + 1] = rgb[1];
      colors[i + 2] = rgb[2];
    }
    mesh.updateDuplicateColorsAndMaterials();
    mesh.updateColorBuffer();
  }

  /**
   * Write roughness and metalness across a mesh, leaving the mask alone.
   * SculptGL packs all three into materialsPBR (x, y, z), and z is the mask
   * a stroke may have painted - overwriting it here would silently unmask.
   */
  fillMaterials(mesh: SculptMesh, roughness: number, metalness: number): void {
    const mats = mesh.getMaterials();
    const n = mesh.getNbVertices() * 3;
    for (let i = 0; i < n; i += 3) {
      mats[i] = roughness;
      mats[i + 1] = metalness;
    }
    mesh.updateDuplicateColorsAndMaterials();
    mesh.updateMaterialBuffer();
  }

  getMeshes(): SculptMesh[] {
    return this.meshes;
  }

  getSelectedMeshes(): SculptMesh[] {
    return this.selectMeshes;
  }

  getIndexMesh(mesh: SculptMesh): number {
    return this.meshes.indexOf(mesh);
  }

  getIndexSelectMesh(mesh: SculptMesh): number {
    return this.selectMeshes.indexOf(mesh);
  }

  setMesh(mesh: SculptMesh | null): SculptMesh | null {
    return this.setOrUnsetMesh(mesh);
  }

  /** Ported from Scene.setOrUnsetMesh, minus the GUI refresh. */
  setOrUnsetMesh(mesh: SculptMesh | null, multiSelect = false): SculptMesh | null {
    if (!mesh) {
      this.selectMeshes.length = 0;
    } else if (!multiSelect) {
      this.selectMeshes.length = 0;
      this.selectMeshes.push(mesh);
    } else {
      const id = this.getIndexSelectMesh(mesh);
      if (id >= 0) {
        if (this.selectMeshes.length > 1) {
          this.selectMeshes.splice(id, 1);
          mesh = this.selectMeshes[0];
        }
      } else {
        this.selectMeshes.push(mesh);
      }
    }
    const changed = this.mesh !== mesh;
    this.mesh = mesh;
    if (changed) this.onActiveMeshChange?.();
    this.render();
    return mesh;
  }

  /** Swap a mesh instance in place (dyntopo conversion, subdivision convert). */
  replaceMesh(mesh: SculptMesh, newMesh: SculptMesh): void {
    const index = this.getIndexMesh(mesh);
    if (index >= 0) this.meshes[index] = newMesh;
    if (this.mesh === mesh) this.setMesh(newMesh);
  }

  addNewMesh(mesh: SculptMesh): SculptMesh {
    this.meshes.push(mesh);
    this.stateManager.pushStateAdd(mesh);
    this.setMesh(mesh);
    return mesh;
  }

  getPicking(): Picking {
    return this.picking;
  }

  getPickingSymmetry(): Picking {
    return this.pickingSym;
  }

  getSculptManager(): SculptManager {
    return this.sculptManager;
  }

  getStateManager(): StateManager {
    return this.stateManager;
  }

  render(): void {
    this.requestRender();
  }

  /** Name of the active mesh (outliner-ready; defaults to Sphere). */
  activeName(): string {
    return (this.mesh && this.meshNames.get(this.mesh)) || 'Sphere';
  }

  getMeshName(mesh: SculptMesh): string {
    return this.meshNames.get(mesh) ?? 'Object';
  }

  setMeshName(mesh: SculptMesh, name: string): void {
    this.meshNames.set(mesh, name);
  }

  /** "Sphere", "Sphere 2", ... against the names already in the scene. */
  private uniqueMeshName(base: string): string {
    const taken = new Set(this.meshes.map((m) => this.meshNames.get(m)));
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  // --- sculpt commands (hotkey surface) -----------------------------------

  undo(): void {
    // Mid-action guard: on iPad a finger can tap the history buttons while
    // the pen is still drawing; undoing the state the stroke is writing into
    // would corrupt it. (The keyboard path gets the same protection.)
    if (this._action !== Enums.Action.NOTHING) return;
    const before = this.levelSignature();
    this.stateManager.undo();
    this.render();
    this.fireLevelChangeIfMoved(before);
  }

  redo(): void {
    if (this._action !== Enums.Action.NOTHING) return;
    const before = this.levelSignature();
    this.stateManager.redo();
    this.render();
    this.fireLevelChangeIfMoved(before);
  }

  /**
   * Forget all history. Mount calls this once the boot scene is assembled:
   * addNewMesh pushes an add-state per mesh (undoable object add is right
   * mid-session), but undoing PAST the boot state would delete the initial
   * sphere or restored objects one by one.
   */
  clearHistory(): void {
    this.stateManager._undos.length = 0;
    this.stateManager._redos.length = 0;
    this.stateManager._curUndoIndex = -1;
  }

  /** History availability (drives the left-rail undo/redo buttons). */
  canUndo(): boolean {
    return this.stateManager._curUndoIndex >= 0 && this.stateManager._undos.length > 0;
  }

  canRedo(): boolean {
    return this.stateManager._redos.length > 0;
  }

  /** [sel, levels] of the active multimesh, or null (dyntopo, no mesh). */
  private levelSignature(): [number, number] | null {
    const mul = this.asMultimesh();
    return mul ? [mul._sel, mul._meshes.length] : null;
  }

  private fireLevelChangeIfMoved(before: [number, number] | null): void {
    const after = this.levelSignature();
    if (before && after && (before[0] !== after[0] || before[1] !== after[1])) {
      this.onLevelChange?.(after[0], after[1]);
    }
  }

  /** Mirror-sculpting toggle (x). Returns the new state. */
  toggleSymmetry(): boolean {
    this.sculptManager._symmetry = !this.sculptManager._symmetry;
    this.onSymmetryChange?.(this.sculptManager._symmetry);
    return this.sculptManager._symmetry;
  }

  getSymmetry(): boolean {
    return this.sculptManager._symmetry;
  }

  /**
   * Mirror-plane axis of the ACTIVE mesh, read back as the dominant
   * component (the normal is always axis-aligned when set through here).
   */
  getSymmetryAxis(): 'x' | 'y' | 'z' {
    const n = this.mesh?.getSymmetryNormal();
    if (!n) return 'x';
    const ax = Math.abs(n[0]);
    const ay = Math.abs(n[1]);
    const az = Math.abs(n[2]);
    return ay > ax && ay >= az ? 'y' : az > ax ? 'z' : 'x';
  }

  /**
   * Point the active mesh's mirror plane down an axis (local space). One
   * in-place write covers everything: the Multimesh wrapper, every level,
   * and dyntopo conversions all share a single TransformData.
   */
  setSymmetryAxis(axis: 'x' | 'y' | 'z'): void {
    const n = this.mesh?.getSymmetryNormal();
    if (!n) return;
    n[0] = axis === 'x' ? 1 : 0;
    n[1] = axis === 'y' ? 1 : 0;
    n[2] = axis === 'z' ? 1 : 0;
    this.render();
  }

  /** The active mesh as a Multimesh, or null (e.g. while dyntopo is active). */
  private asMultimesh(): Multimesh | null {
    const mesh = this.mesh as unknown as Multimesh | null;
    return mesh && mesh._meshes ? mesh : null;
  }

  /**
   * ctrl+d: add a subdivision level (ported from GuiTopology.subdivide;
   * requires the top level). Results past the soft line ask first, matching
   * upstream's dialog; the hard ceiling refuses silently.
   */
  subdivide(): boolean {
    const mul = this.asMultimesh();
    if (!mul || mul._sel !== mul._meshes.length - 1) return false;
    const next = mul.getNbTriangles() * 4;
    if (next > MAX_SUBDIVISION_TRIS) return false;
    if (next > SOFT_SUBDIVISION_TRIS) {
      const ok = window.confirm(
        `Subdividing takes this mesh to about ${Math.round(next / 1e6)} million triangles, ` +
          'which can be slow or unstable on weaker devices. Continue?',
      );
      if (!ok) return false;
    }
    this.stateManager.pushStateMultiresolution(mul, StateMultiresolution.SUBDIVISION);
    mul.addLevel();
    this.setMesh(mul);
    this.onLevelChange?.(mul._sel, mul._meshes.length);
    return true;
  }

  /** d / shift+d: step the multiresolution selection up or down one level. */
  stepSubdivision(dir: 1 | -1): boolean {
    const mul = this.asMultimesh();
    if (!mul) return false;
    const target = mul._sel + dir;
    if (target < 0 || target >= mul._meshes.length) return false;
    this.stateManager.pushStateMultiresolution(mul, StateMultiresolution.SELECTION);
    if (dir > 0) mul.higherLevel();
    else mul.lowerLevel();
    this.render();
    this.onLevelChange?.(mul._sel, mul._meshes.length);
    return true;
  }

  // --- WS4 palette surface -------------------------------------------------

  /**
   * Extract the masked region as a new shelled mesh (upstream Masking
   * extract; thickness in world units, 0 = single-sided). The extraction
   * becomes a new scene object; the source mesh stays selected.
   */
  extractMasked(thickness: number): boolean {
    const masking = this.sculptManager.getTool(Enums.Tools.MASKING);
    if (!masking.extract) return false;
    masking._thickness = thickness;
    const before = this.meshes.length;
    masking.extract();
    const added = this.meshes.length > before;
    if (added) {
      this.meshNames.set(this.meshes[this.meshes.length - 1], this.uniqueMeshName('Extracted'));
      this.onActiveMeshChange?.(); // mesh list changed even if selection kept
    }
    return added;
  }

  /** Voxel remesh of the active mesh (upstream GuiTopology; new topology). */
  voxelRemesh(resolution: number): boolean {
    const mesh = this.mesh;
    if (!mesh) return false;
    Remesh.RESOLUTION = Math.min(400, Math.max(8, Math.round(resolution)));
    const newMesh = Remesh.remesh([mesh], mesh);
    const name = this.meshNames.get(mesh);
    if (name) this.meshNames.set(newMesh, name);
    this.stateManager.pushStateAddRemove(newMesh, mesh);
    this.replaceMesh(mesh, newMesh);
    return true;
  }

  /** Stroke-time dynamic-topology aggressiveness (0..100 each). */
  getDynTopoDetail(): { subdivision: number; decimation: number } {
    return {
      subdivision: MeshDynamic.SUBDIVISION_FACTOR,
      decimation: MeshDynamic.DECIMATION_FACTOR,
    };
  }

  setDynTopoDetail(detail: { subdivision?: number; decimation?: number }): void {
    if (typeof detail.subdivision === 'number') {
      MeshDynamic.SUBDIVISION_FACTOR = Math.min(100, Math.max(0, detail.subdivision));
    }
    if (typeof detail.decimation === 'number') {
      MeshDynamic.DECIMATION_FACTOR = Math.min(100, Math.max(0, detail.decimation));
    }
  }

  isDynamicTopology(): boolean {
    return !!this.mesh?.isDynamic;
  }

  /** Scene menu: add a primitive as a new object (WS4 outliner plus). */
  addPrimitive(kind: 'sphere' | 'cube' | 'cylinder' | 'torus'): Multimesh {
    if (kind === 'sphere') return this.addSphere();
    if (kind === 'cube') return this.addCubePrimitive();
    const geom =
      kind === 'cylinder'
        ? new CylinderGeometry(0.75, 0.75, 1.6, 32, 6)
        : new TorusGeometry(0.62, 0.26, 18, 36);
    const name = kind === 'cylinder' ? 'Cylinder' : 'Torus';
    return this.meshFromTriGeometry(geom, name);
  }

  /** The sphere's quad-cube base with LINEAR subdivision keeps cube corners. */
  private addCubePrimitive(): Multimesh {
    const base = this.buildQuadCubeBase();
    const mesh = new Multimesh(base);
    mesh.normalizeSize();
    this.subdivideClamp(mesh, true);
    this.meshNames.set(mesh, this.uniqueMeshName('Cube'));
    this.addNewMesh(mesh);
    return mesh;
  }

  /** Weld a three triangle geometry and adopt it as a sculptable object. */
  private meshFromTriGeometry(geom: BufferGeometry, name: string): Multimesh {
    // Position-only weld: uv/normal seams would otherwise crack under
    // sculpting (duplicate vertices along the seam).
    geom.deleteAttribute('normal');
    geom.deleteAttribute('uv');
    const welded = mergeVertices(geom);
    const pos = welded.getAttribute('position');
    const index = welded.getIndex();
    if (!index) throw new Error('primitive geometry must be indexed');
    const v = new Float32Array(pos.count * 3);
    v.set(pos.array as Float32Array);
    const nbTris = index.count / 3;
    const f = new Uint32Array(nbTris * 4);
    for (let i = 0; i < nbTris; i++) {
      f[i * 4] = index.getX(i * 3);
      f[i * 4 + 1] = index.getX(i * 3 + 1);
      f[i * 4 + 2] = index.getX(i * 3 + 2);
      f[i * 4 + 3] = Utils.TRI_INDEX;
    }
    geom.dispose();
    welded.dispose();

    const base = new MeshStatic(null);
    base.setVertices(v);
    base.setFaces(f);
    base.init();
    const mesh = new Multimesh(base);
    mesh.normalizeSize();
    this.subdivideClamp(mesh);
    this.meshNames.set(mesh, this.uniqueMeshName(name));
    this.addNewMesh(mesh);
    return mesh;
  }

  /**
   * Dynamic topology on/off (ported from GuiTopology.dynamicToggleActivate +
   * convertToStaticMesh). Off returns to a plain static mesh; the multires
   * stack does not survive the round trip, matching upstream.
   */
  toggleDynamicTopology(): boolean {
    const mesh = this.mesh;
    if (!mesh) return false;
    const newMesh = !mesh.isDynamic
      ? (new MeshDynamic(mesh) as unknown as SculptMesh)
      : this.convertToStaticMesh(mesh);
    const name = this.meshNames.get(mesh);
    if (name) this.meshNames.set(newMesh, name);
    this.stateManager.pushStateAddRemove(newMesh, mesh);
    this.replaceMesh(mesh, newMesh);
    return !!newMesh.isDynamic;
  }

  private convertToStaticMesh(mesh: SculptMesh): SculptMesh {
    if (!mesh.isDynamic) return mesh;
    const newMesh = new MeshStatic(null) as unknown as SculptMesh;
    newMesh.setID(mesh.getID());
    newMesh.setTransformData(mesh.getTransformData());
    newMesh.setVertices(mesh.getVertices().subarray(0, mesh.getNbVertices() * 3));
    newMesh.setColors(mesh.getColors().subarray(0, mesh.getNbVertices() * 3));
    newMesh.setMaterials(mesh.getMaterials().subarray(0, mesh.getNbVertices() * 3));
    newMesh.setFaces(mesh.getFaces().subarray(0, mesh.getNbFaces() * 4) as Uint32Array);
    Mesh.OPTIMIZE = false;
    newMesh.init();
    Mesh.OPTIMIZE = true;
    return newMesh;
  }

  /**
   * Surface under the current mouse position for the brush cursor: world
   * point, world unit normal (vertex-normal average of the picked face), and
   * the tool's world radius. `pick` false reuses the picking state a stroke
   * is already refreshing instead of raycasting again.
   */
  hoverSurface(pick = true): HoverSurface | null {
    if (!this.mesh) return null;
    if (pick && !this.picking.intersectionMouseMesh()) return null;
    const mesh = this.picking.getMesh();
    if (!mesh) return null;

    if (pick) this.picking.updateLocalAndWorldRadius2();
    const worldRadius = this.picking.getWorldRadius();
    if (!(worldRadius > 0)) return null;

    const point = vec3.create();
    vec3.transformMat4(point, this.picking.getIntersectionPoint() as unknown as vec3, mesh.getMatrix());

    const fid = this.picking.getPickedFace();
    const fAr = mesh.getFaces();
    const nAr = mesh.getNormals();
    const nbVertices = mesh.getNbVertices();
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = 0; k < 4; k++) {
      const vi = fAr[fid * 4 + k];
      if (!(vi >= 0) || vi >= nbVertices) continue; // quad sentinel or out of range
      nx += nAr[vi * 3];
      ny += nAr[vi * 3 + 1];
      nz += nAr[vi * 3 + 2];
    }
    const normal = vec3.fromValues(nx, ny, nz);
    vec3.transformMat3(normal, normal, mat3.fromMat4(mat3.create(), mesh.getMatrix()));
    if (vec3.length(normal) < 1e-8) return null;
    vec3.normalize(normal, normal);

    return {
      point: [point[0], point[1], point[2]],
      normal: [normal[0], normal[1], normal[2]],
      worldRadius,
    };
  }

  /**
   * World-space point of the last picking intersection (the last spot the
   * brush touched or hovered), or null before any pick. Drives f = frame at
   * the last tool position.
   */
  lastEditWorldPoint(): [number, number, number] | null {
    const mesh = this.picking.getMesh();
    if (!mesh) return null;
    const out = vec3.create();
    vec3.transformMat4(out, this.picking.getIntersectionPoint() as unknown as vec3, mesh.getMatrix());
    return [out[0], out[1], out[2]];
  }

  // --- reload persistence (bridge feature, see ScenePersist) --------------

  /** Summed top-level triangles across the scene (autosave payload driver). */
  topLevelTriangles(): number {
    let total = 0;
    for (const mesh of this.meshes) {
      const mul = mesh._meshes ? (mesh as unknown as Multimesh) : null;
      total += mul ? mul._meshes[mul._meshes.length - 1].getNbTriangles() : mesh.getNbTriangles();
    }
    return total;
  }

  /**
   * Snapshot the whole scene for autosave: for every object, each multires
   * level's live arrays plus its detail vectors (byte-faithful, including a
   * stale top when sculpting happened below it), the base topology (higher
   * levels re-derive by subdivision) and transform; plus selection and
   * symmetry. Bounded copies; runs in idle time only, never during a
   * stroke. Dynamic-topology meshes save as a single level, static.
   */
  serializeScene(): SavedScene | null {
    if (this.meshes.length === 0 || !this.mesh) return null;
    const savedMeshes: SavedMesh[] = [];
    for (const mesh of this.meshes) {
      const one = this.serializeMesh(mesh);
      if (!one) return null;
      savedMeshes.push(one);
    }
    return {
      v: 3,
      savedAt: Date.now(),
      meshes: savedMeshes,
      active: Math.max(0, this.meshes.indexOf(this.mesh)),
      symmetry: this.sculptManager._symmetry,
    };
  }

  private serializeMesh(mesh: SculptMesh): SavedMesh | null {
    const mul = mesh._meshes ? (mesh as unknown as Multimesh) : null;
    const levelMeshes: SculptMesh[] = mul ? mul._meshes : [mesh];
    const base = levelMeshes[0];
    const nbBaseFaces = base.getNbFaces();
    if (!(nbBaseFaces > 0)) return null;

    const levels: SavedLevel[] = [];
    for (const m of levelMeshes) {
      const nbV = m.getNbVertices();
      if (!(nbV > 0)) return null;
      levels.push({
        nbVertices: nbV,
        vertices: new Float32Array(m.getVertices().subarray(0, nbV * 3)),
        normals: new Float32Array(m.getNormals().subarray(0, nbV * 3)),
        colors: new Float32Array(m.getColors().subarray(0, nbV * 3)),
        materials: new Float32Array(m.getMaterials().subarray(0, nbV * 3)),
        detailsXYZ: m._detailsXYZ ? new Float32Array(m._detailsXYZ) : null,
        detailsRGB: m._detailsRGB ? new Float32Array(m._detailsRGB) : null,
        detailsPBR: m._detailsPBR ? new Float32Array(m._detailsPBR) : null,
      });
    }

    return {
      name: this.getMeshName(mesh),
      nbBaseFaces,
      baseFaces: new Uint32Array(base.getFaces().subarray(0, nbBaseFaces * 4)),
      levels,
      sel: mul ? mul._sel : 0,
      matrix: new Float32Array(mesh.getMatrix()),
      sym: [...mesh.getSymmetryNormal()],
    };
  }

  /**
   * Rebuild a saved scene (the reload path): every object, in order, then
   * the saved selection and symmetry. Returns the ACTIVE multimesh (the
   * mount adopts its geometry). Throws on any shape mismatch; the caller
   * falls back to a fresh sphere.
   */
  restoreScene(saved: SavedScene): Multimesh {
    const built: Multimesh[] = [];
    for (const savedMesh of saved.meshes) built.push(this.buildRestoredMesh(savedMesh));
    this.sculptManager._symmetry = saved.symmetry;
    const active = built[Math.min(saved.active, built.length - 1)];
    this.setMesh(active);
    return active;
  }

  /**
   * Remove one object from the scene (outliner minus). Refuses to empty the
   * scene - there would be nothing to sculpt and no way back except a
   * reload - and hands selection to a neighbour when the active object is
   * the one going.
   */
  deleteMesh(mesh: SculptMesh): boolean {
    if (this.meshes.length <= 1) return false;
    const index = this.meshes.indexOf(mesh);
    if (index < 0) return false;
    this.stateManager.pushStateAddRemove([], [mesh]);
    this.meshes.splice(index, 1);
    const sel = this.selectMeshes.indexOf(mesh);
    if (sel >= 0) this.selectMeshes.splice(sel, 1);
    if (this.mesh === mesh) {
      this.setMesh(this.meshes[Math.min(index, this.meshes.length - 1)]);
    } else {
      // Selection is unchanged, but the mesh LIST moved: the display pool
      // and the outliner both key off this callback.
      this.onActiveMeshChange?.();
    }
    this.render();
    return true;
  }

  /**
   * Start over: drop every object for a fresh sphere. The new scene is the
   * history floor, so undo cannot resurrect what was just discarded.
   */
  newScene(): Multimesh {
    this.meshes.length = 0;
    this.selectMeshes.length = 0;
    this.mesh = null;
    const mesh = this.addSphere();
    this.clearHistory();
    return mesh;
  }

  /**
   * Swap the whole scene for a loaded file (Open). The current objects are
   * dropped, the loaded ones become the new history floor, and the active
   * mesh change fans out through the usual callback (display reconcile,
   * outliner, stats).
   */
  replaceScene(saved: SavedScene): Multimesh {
    this.meshes.length = 0;
    this.selectMeshes.length = 0;
    this.mesh = null;
    const active = this.restoreScene(saved);
    this.clearHistory();
    return active;
  }

  /**
   * One saved object back to a live multimesh. The base level uses the
   * proven convertToStaticMesh construction (no normalize: the saved matrix
   * carries the scale); each higher level re-derives its topology through
   * addLevel, then every array is overwritten with the saved bytes.
   * setSelection is a plain pointer swap (no analysis or synthesis
   * recompute), so the restored stack, its detail vectors, and a stale top
   * all come back exactly as saved.
   */
  private buildRestoredMesh(saved: SavedMesh): Multimesh {
    const l0 = saved.levels[0];
    const base = new MeshStatic(null);
    base.setVertices(l0.vertices);
    base.setColors(l0.colors);
    base.setMaterials(l0.materials);
    base.setFaces(saved.baseFaces);
    Mesh.OPTIMIZE = false;
    base.init();
    Mesh.OPTIMIZE = true;
    if (base.getNbVertices() !== l0.nbVertices) {
      throw new Error('sculpt restore: base level shape mismatch');
    }

    const mesh = new Multimesh(base);
    for (let i = 1; i < saved.levels.length; i++) {
      const li = saved.levels[i];
      const m = mesh.addLevel();
      if (m.getNbVertices() !== li.nbVertices) {
        throw new Error(`sculpt restore: level ${i} shape mismatch`);
      }
      m.getVertices().set(li.vertices);
      m.getColors().set(li.colors);
      m.getMaterials().set(li.materials);
      m._detailsXYZ = li.detailsXYZ ? new Float32Array(li.detailsXYZ) : null;
      m._detailsRGB = li.detailsRGB ? new Float32Array(li.detailsRGB) : null;
      m._detailsPBR = li.detailsPBR ? new Float32Array(li.detailsPBR) : null;
      // Refresh the derived spatial data from the restored verts: face
      // aabbs/normals are pure per-face functions and the octree follows
      // them, so both rebuild deterministically.
      m.updateFacesAabbAndNormal();
      m.updateOctree();
    }
    // Vertex normals are NOT derived here: live normals accumulate through
    // incremental stroke updates in a different float order than a full
    // recompute, and synthesis reads them for its tangent frames, so the
    // saved values are restored verbatim (after every geometry pass above,
    // which would otherwise clobber them). v1 records carry none; the
    // init/addLevel recompute stands in for those.
    const levelMeshes = mesh._meshes;
    for (let i = 0; i < saved.levels.length; i++) {
      const normals = saved.levels[i].normals;
      if (normals) levelMeshes[i].getNormals().set(normals);
    }
    mesh.setSelection(saved.sel);
    mesh.updateBuffers();

    mat4.copy(mesh.getMatrix() as unknown as mat4, saved.matrix as unknown as mat4);
    if (Array.isArray(saved.sym) && saved.sym.length === 3) {
      const n = mesh.getSymmetryNormal();
      n[0] = saved.sym[0];
      n[1] = saved.sym[1];
      n[2] = saved.sym[2];
    }
    this.meshNames.set(mesh, typeof saved.name === 'string' ? saved.name : 'Sphere');
    this.addNewMesh(mesh);
    return mesh;
  }

  // --- primitives (ported from Scene.js + drawables/Primitives.js) --------

  /**
   * The default subject, as upstream addSphere builds it (a subdivided cube;
   * vertex positions and quad indices copied verbatim from
   * Primitives.createCubeArray, UVs dropped). Bozzetto clamps lower than
   * upstream: about 50k triangles (24,576 quads) instead of ~200k, per the
   * WS1 review defaults; ctrl+d subdivides further on demand.
   */
  addSphere(): Multimesh {
    const mesh = new Multimesh(this.buildQuadCubeBase());
    mesh.normalizeSize();
    this.subdivideClamp(mesh);
    this.meshNames.set(mesh, this.uniqueMeshName('Sphere'));
    this.addNewMesh(mesh);
    return mesh;
  }

  /** The 8-vertex quad cube both Sphere (smoothed) and Cube (linear) grow from. */
  private buildQuadCubeBase(): MeshStatic {
    const v = new Float32Array(24);
    v[1] = v[2] = v[4] = v[6] = v[7] = v[9] = v[10] = v[11] = v[14] = v[18] = v[21] = v[23] = -0.5;
    v[0] = v[3] = v[5] = v[8] = v[12] = v[13] = v[15] = v[16] = v[17] = v[19] = v[20] = v[22] = 0.5;

    const f = new Uint32Array(24);
    f[0] = f[8] = f[21] = 0;
    f[1] = f[11] = f[12] = 1;
    f[2] = f[15] = f[16] = 2;
    f[3] = f[19] = f[22] = 3;
    f[4] = f[9] = f[20] = 4;
    f[7] = f[10] = f[13] = 5;
    f[6] = f[14] = f[17] = 6;
    f[5] = f[18] = f[23] = 7;

    const base = new MeshStatic(null);
    base.setVertices(v);
    base.setFaces(f);
    base.init();
    return base;
  }

  /** Ported from Scene.subdivideClamp with a ~50k-tri clamp; keeps 4 levels. */
  private subdivideClamp(mesh: Multimesh, linear = false): void {
    Subdivision.LINEAR = !!linear;
    while (mesh.getNbFaces() < 20000) mesh.addLevel();
    mesh._meshes.splice(0, Math.min(mesh._meshes.length - 4, 4));
    mesh._sel = mesh._meshes.length - 1;
    Subdivision.LINEAR = false;
  }
}
