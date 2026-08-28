import Enums from '@sculpt-vendor/misc/Enums';
import Mesh from '@sculpt-vendor/mesh/Mesh';
import MeshStatic from '@sculpt-vendor/mesh/meshStatic/MeshStatic';
import MeshDynamic from '@sculpt-vendor/mesh/dynamic/MeshDynamic';
import Multimesh from '@sculpt-vendor/mesh/multiresolution/Multimesh';
import Subdivision from '@sculpt-vendor/editing/Subdivision';
import SculptManager from '@sculpt-vendor/editing/SculptManager';
import StateManager from '@sculpt-vendor/states/StateManager';
import StateMultiresolution from '@sculpt-vendor/states/StateMultiresolution';
import Picking from '@sculpt-vendor/math3d/Picking';
import { mat3, mat4, vec3 } from 'gl-matrix';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { CameraAdapter } from './CameraAdapter';
import type { SavedLevel, SavedScene } from './ScenePersist';

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

  private readonly meshes: SculptMesh[] = [];
  private readonly selectMeshes: SculptMesh[] = [];
  private mesh: SculptMesh | null = null;

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

  // --- sculpt commands (hotkey surface) -----------------------------------

  undo(): void {
    this.stateManager.undo();
    this.render();
  }

  redo(): void {
    this.stateManager.redo();
    this.render();
  }

  /** Mirror-sculpting toggle (x). Returns the new state. */
  toggleSymmetry(): boolean {
    this.sculptManager._symmetry = !this.sculptManager._symmetry;
    return this.sculptManager._symmetry;
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
    return true;
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

  /** Triangle count of the top multires level (the autosave payload driver). */
  topLevelTriangles(): number {
    const mul = this.asMultimesh();
    if (mul) return mul._meshes[mul._meshes.length - 1].getNbTriangles();
    return this.mesh ? this.mesh.getNbTriangles() : 0;
  }

  /**
   * Snapshot the active mesh for autosave: every multires level's live
   * arrays plus its detail vectors (byte-faithful, including a stale top
   * when sculpting happened below it), the base topology (higher levels
   * re-derive by subdivision), transform, selection and symmetry. Bounded
   * copies; runs in idle time only, never during a stroke. A dynamic-
   * topology mesh saves as a single level, static (upstream .sgl parity).
   */
  serializeScene(): SavedScene | null {
    const mesh = this.mesh;
    if (!mesh) return null;
    const mul = this.asMultimesh();
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
      v: 2,
      savedAt: Date.now(),
      nbBaseFaces,
      baseFaces: new Uint32Array(base.getFaces().subarray(0, nbBaseFaces * 4)),
      levels,
      sel: mul ? mul._sel : 0,
      matrix: new Float32Array(mesh.getMatrix()),
      symmetry: this.sculptManager._symmetry,
    };
  }

  /**
   * Rebuild a saved scene as the session subject (the reload path). The base
   * level uses the proven convertToStaticMesh construction (no normalize:
   * the saved matrix carries the scale); each higher level re-derives its
   * topology through addLevel, then every array is overwritten with the
   * saved bytes. setSelection is a plain pointer swap (no analysis or
   * synthesis recompute), so the restored stack, its detail vectors, and a
   * stale top all come back exactly as saved. Throws on any shape mismatch;
   * the caller falls back to a fresh sphere.
   */
  addRestoredMesh(saved: SavedScene): Multimesh {
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
    this.sculptManager._symmetry = saved.symmetry;
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

    const mesh = new Multimesh(base);
    mesh.normalizeSize();
    this.subdivideClamp(mesh);
    this.addNewMesh(mesh);
    return mesh;
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
