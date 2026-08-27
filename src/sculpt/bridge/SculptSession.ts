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
import { vec3 } from 'gl-matrix';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { CameraAdapter } from './CameraAdapter';

/** Hard ceiling for ctrl+d subdivision (protects the iPad tier). */
const MAX_SUBDIVISION_TRIS = 1600000;

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
   * ctrl+d: add a subdivision level (ported from GuiTopology.subdivide, minus
   * the dialogs: requires the top level, silently refuses past the tri cap).
   */
  subdivide(): boolean {
    const mul = this.asMultimesh();
    if (!mul || mul._sel !== mul._meshes.length - 1) return false;
    if (mul.getNbTriangles() * 4 > MAX_SUBDIVISION_TRIS) return false;
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
