/**
 * Ambient declarations for the vendored SculptGL modules the bridge imports.
 * The vendor stays plain JS outside typecheck (allowJs off); these shims are
 * the typed contract and cover only the seam surface the bridge actually
 * uses (plan section 5). Keep them minimal and honest: if the bridge starts
 * using a new vendor member, declare it here, do not widen to any.
 */

declare module '@sculpt-vendor/misc/Enums' {
  const Enums: {
    Action: {
      NOTHING: number;
      MASK_EDIT: number;
      SCULPT_EDIT: number;
      CAMERA_ZOOM: number;
      CAMERA_ROTATE: number;
      CAMERA_PAN: number;
      CAMERA_PAN_ZOOM_ALT: number;
    };
    Tools: {
      BRUSH: number;
      INFLATE: number;
      TWIST: number;
      SMOOTH: number;
      FLATTEN: number;
      PINCH: number;
      CREASE: number;
      DRAG: number;
      PAINT: number;
      MOVE: number;
      MASKING: number;
      LOCALSCALE: number;
      TRANSFORM: number;
    };
  };
  export default Enums;
}

declare module '@sculpt-vendor/misc/Tablet' {
  /**
   * Pressure state the stroke tools and picking read: pressure 0..1 with 0.5
   * neutral; the factors scale how much pressure sways radius/intensity.
   */
  const Tablet: {
    radiusFactor: number;
    intensityFactor: number;
    pressure: number;
    getPressureIntensity(): number;
    getPressureRadius(): number;
  };
  export default Tablet;
}

declare module '@sculpt-vendor/misc/Utils' {
  const Utils: {
    SCALE: number;
    /** Sentinel for the 4th index of triangle faces in the 4-stride arrays. */
    TRI_INDEX: number;
  };
  export default Utils;
}

declare module '@sculpt-vendor/mesh/meshStatic/MeshStatic' {
  import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
  class MeshStatic {
    constructor(gl: null);
  }
  interface MeshStatic extends SculptMesh {}
  export default MeshStatic;
}

declare module '@sculpt-vendor/mesh/dynamic/MeshDynamic' {
  import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
  /** Dynamic-topology mesh; wraps an existing mesh's data at construction. */
  class MeshDynamic {
    /** Stroke-time refinement/decimation aggressiveness (0..100, WS4 UI). */
    static SUBDIVISION_FACTOR: number;
    static DECIMATION_FACTOR: number;
    constructor(mesh: SculptMesh);
  }
  interface MeshDynamic extends SculptMesh {}
  export default MeshDynamic;
}

declare module '@sculpt-vendor/mesh/Mesh' {
  /**
   * The vendored mesh facade surface the bridge touches. Backing arrays are
   * over-allocated for dynamic growth; always bound reads by getNbVertices /
   * getNbTriangles (verified in WS0).
   */
  export interface SculptMesh {
    setVertices(v: Float32Array): void;
    setFaces(f: Uint32Array): void;
    setColors(c: Float32Array): void;
    setMaterials(m: Float32Array): void;
    setID(id: number): void;
    setTransformData(t: unknown): void;
    getTransformData(): unknown;
    init(): void;
    initRender(): void;
    getID(): number;
    isVisible(): boolean;
    setVisible(visible: boolean): void;
    getVertices(): Float32Array;
    getNormals(): Float32Array;
    getColors(): Float32Array;
    getMaterials(): Float32Array;
    /** Re-fan colours/materials into the duplicated render vertices. */
    updateDuplicateColorsAndMaterials(iVerts?: Uint32Array): void;
    /** Re-upload the vertex colour buffer after a bulk write (paint fill). */
    updateColorBuffer(): void;
    /** Re-upload the roughness/metalness/mask buffer after a bulk write. */
    updateMaterialBuffer(): void;
    getTriangles(): Uint32Array;
    getFaces(): Uint32Array | Int32Array;
    getNbVertices(): number;
    getNbTriangles(): number;
    getNbFaces(): number;
    getMatrix(): Float32Array;
    getSymmetryOrigin(): number[];
    getSymmetryNormal(): number[];
    getVerticesProxy(): Float32Array;
    getFacesFromVertices(iVerts: Uint32Array): Uint32Array;
    normalizeSize(): void;
    updateGeometry(iFaces?: Uint32Array, iVerts?: Uint32Array): void;
    updateFacesAabbAndNormal(iFaces?: Uint32Array): void;
    updateOctree(iFaces?: Uint32Array): void;
    updateGeometryBuffers(): void;
    updateBuffers(): void;
    balanceOctree(): void;
    isVisible(): boolean;
    /** Set on dynamic-topology meshes only. */
    isDynamic?: boolean;
    /** Set on multiresolution meshes only (the level stack). */
    _meshes?: SculptMesh[];
    /** MeshResolution levels only: detail vectors from the last analysis. */
    _detailsXYZ?: Float32Array | null;
    _detailsRGB?: Float32Array | null;
    _detailsPBR?: Float32Array | null;
    /** Bridge hooks installed by GeometrySync (see the Mesh.js seam edits). */
    _bridgeSync?: {
      onGeometryBuffers(mesh: SculptMesh): void;
      onAllBuffers(mesh: SculptMesh): void;
      onColorsMaterials(mesh: SculptMesh): void;
      onDirtyGeometry(mesh: SculptMesh, iVerts?: Uint32Array): void;
    } | null;
  }
  const Mesh: { new (): SculptMesh; ID: number; OPTIMIZE: boolean };
  export default Mesh;
}

declare module '@sculpt-vendor/mesh/multiresolution/Multimesh' {
  import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
  class Multimesh {
    constructor(mesh: unknown);
    _meshes: SculptMesh[];
    _sel: number;
    addLevel(): SculptMesh;
    higherLevel(): SculptMesh;
    lowerLevel(): SculptMesh;
    /** Rebuild a LOWER level from level 0 (reversion); undefined if impossible. */
    computeReverse(): SculptMesh | undefined;
    /** Walk the selection to `sel` one level at a time (the level slider). */
    selectResolution(sel: number): void;
    getCurrentMesh(): SculptMesh;
    setSelection(sel: number): void;
  }
  interface Multimesh extends SculptMesh {}
  export default Multimesh;
}

declare module '@sculpt-vendor/editing/Remesh' {
  import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
  const Remesh: {
    /** Voxel grid resolution along the longest bounds axis. */
    RESOLUTION: number;
    BLOCK: boolean;
    SMOOTHING: boolean;
    remesh(meshes: SculptMesh[], baseMesh: SculptMesh, manifold?: boolean): SculptMesh;
  };
  export default Remesh;
}

declare module '@sculpt-vendor/editing/Subdivision' {
  const Subdivision: { LINEAR: boolean };
  export default Subdivision;
}

declare module '@sculpt-vendor/editing/SculptManager' {
  import type { SculptTool } from '@sculpt-vendor/editing/tools/SculptBase';
  class SculptManager {
    _symmetry: boolean;
    /** Tool registry by Enums.Tools index (bridge swaps entries in). */
    _tools: SculptTool[];
    constructor(main: unknown);
    setToolIndex(id: number): void;
    getToolIndex(): number;
    getTool(id: number): SculptTool;
    getCurrentTool(): SculptTool;
    getSymmetry(): boolean;
    start(ctrl: boolean): boolean;
    end(): void;
    preUpdate(): void;
    update(): void;
  }
  export default SculptManager;
}

declare module '@sculpt-vendor/editing/tools/SculptBase' {
  /** The per-tool surface the bridge reads/writes (radius etc. are screen px). */
  export interface SculptTool {
    _radius: number;
    _intensity: number;
    /** Present on tools that support inverted strokes (Brush, Crease, ...). */
    _negative?: boolean;
    /** Brush only: clay mode (flatten-toward-plane deformation). */
    _clay?: boolean;
    getScreenRadius(): number;
    /** Masking tool only: whole-mask operations (ctrl gestures + WS4 UI). */
    invert?(): void;
    clear?(): void;
    blur?(): void;
    sharpen?(): void;
    /** Masking tool only: shell extraction of the masked region (WS4). */
    _thickness?: number;
    extract?(): void;
    /** Paint tool only: the albedo it lays down, linear RGB 0..1. */
    _color?: Float32Array;
    /** Paint tool only: this stroke is an eyedropper, not a paint stroke. */
    _pickColor?: boolean;
    /** Paint tool only: edge falloff of the dab. */
    _hardness?: number;
    /** Paint tool only: called after an eyedropper pick with the sample. */
    setPickCallback?(cb: (color: Float32Array, roughness: number, metallic: number) => void): void;
  }

  /**
   * The tool base class. Only its prototype is of interest to the bridge:
   * world-scale sizing patches getScreenRadius there, so every tool picks
   * the change up without the vendor being edited (see worldScale.ts).
   */
  const SculptBase: { prototype: SculptTool };
  export default SculptBase;
}

declare module '@sculpt-vendor/states/StateManager' {
  class StateManager {
    /** One undo entry from a pair of callbacks (object transforms use it). */
    pushStateCustom(undocb: () => void, redocb?: () => void, squash?: boolean): void;
    /** Undo stack depth cap (upstream default 15; the bridge raises it). */
    static STACK_LENGTH: number;
    constructor(main: unknown);
    /** History internals (index-based: undo moves the cursor, not length). */
    _undos: unknown[];
    _redos: unknown[];
    _curUndoIndex: number;
    /** Every undoable edit funnels through here (autosave hooks it). */
    pushState(state: unknown): void;
    /** Record touched vertices on the current state (stroke tools). */
    pushVertices(iVerts: Uint32Array): void;
    pushStateAdd(mesh: unknown): void;
    pushStateAddRemove(addMesh: unknown, remMesh: unknown, squash?: boolean): void;
    pushStateMultiresolution(multimesh: unknown, type: number): void;
    undo(): void;
    redo(): void;
    cleanNoop(): void;
  }
  export default StateManager;
}

declare module '@sculpt-vendor/states/StateMultiresolution' {
  class StateMultiresolution {
    static SUBDIVISION: number;
    static REVERSION: number;
    static SELECTION: number;
    /**
     * Captures the current level's arrays up front, so it can be built
     * BEFORE a fallible operation (reversion) and pushed only on success -
     * the upstream GuiTopology order.
     */
    constructor(main: unknown, multimesh: unknown, type: number, isRedo?: boolean);
  }
  export default StateMultiresolution;
}

declare module '@sculpt-vendor/math3d/Picking' {
  import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
  class Picking {
    /** Written directly by the volumetric Move start (no raycast hit). */
    _mesh: SculptMesh | null;
    constructor(main: unknown, xSym?: boolean);
    intersectionMouseMeshes(): boolean;
    intersectionMouseMesh(mesh?: SculptMesh, mouseX?: number, mouseY?: number): boolean;
    getMesh(): SculptMesh | null;
    /** Intersection point in the picked mesh's local space. */
    getIntersectionPoint(): number[];
    setIntersectionPoint(inter: number[]): void;
    getPickedFace(): number;
    getPickedVertices(): Uint32Array;
    updateLocalAndWorldRadius2(): void;
    getWorldRadius(): number;
    getLocalRadius2(): number;
    setLocalRadius2(r2: number): void;
    /** World-space unprojection of device-px mouse coords at NDC depth z. */
    unproject(mouseX: number, mouseY: number, z: number): number[];
    initAlpha(): void;
    updateAlpha(keepOrigin: boolean): void;
    setIdAlpha(id: number): void;
    getAlpha(x: number, y: number, z: number): number;
    getEyeDirection(): number[];
    getPickedNormal(): number[] | null;
  }
  export default Picking;
}

declare module '@sculpt-vendor/math3d/Geometry' {
  const Geometry: {
    /** Mirrors `point` through the plane (in place) and returns it. */
    mirrorPoint(point: number[], ptPlane: number[], nPlane: number[]): number[];
  };
  export default Geometry;
}

declare module '@sculpt-vendor/editing/tools/Move' {
  import type Picking from '@sculpt-vendor/math3d/Picking';
  class Move {
    _main: unknown;
    _radius: number;
    _intensity: number;
    _topoCheck: boolean;
    _negative: boolean;
    _moveData: unknown;
    _moveDataSym: unknown;
    _lastMouseX: number;
    _lastMouseY: number;
    constructor(main: unknown);
    getMesh(): import('@sculpt-vendor/mesh/Mesh').SculptMesh;
    start(ctrl: boolean): boolean;
    pushState(): void;
    initMoveData(picking: Picking, moveData: unknown): void;
    move(
      iVerts: Uint32Array,
      center: number[],
      radiusSquared: number,
      moveData: unknown,
      picking: Picking,
    ): void;
  }
  export default Move;
}

declare module '@sculpt-vendor/editing/tools/Smooth' {
  import type Picking from '@sculpt-vendor/math3d/Picking';
  class Smooth {
    _main: unknown;
    _radius: number;
    _intensity: number;
    _culling: boolean;
    _tangent: boolean;
    constructor(main: unknown);
    stroke(picking: Picking): void;
    smooth(iVerts: Uint32Array, intensity: number, picking?: Picking): void;
    smoothTangent(iVerts: Uint32Array, intensity: number, picking?: Picking): void;
    smoothAlongNormals(iVerts: Uint32Array, intensity: number, picking?: Picking): void;
  }
  export default Smooth;
}

declare module '@sculpt-vendor/editing/tools/Flatten' {
  import type Picking from '@sculpt-vendor/math3d/Picking';
  import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
  class Flatten {
    _main: unknown;
    _radius: number;
    _intensity: number;
    _negative: boolean;
    _culling: boolean;
    _accumulate: boolean;
    _idAlpha: number;
    _lockPosition: boolean;
    constructor(main: unknown);
    getMesh(): SculptMesh;
    stroke(picking: Picking): void;
    start(ctrl: boolean): boolean;
    end(): void;
    dynamicTopology(picking: Picking): Uint32Array;
    getFrontVertices(iVerts: Uint32Array, eyeDir: number[]): Uint32Array;
    areaNormal(iVerts: Uint32Array): number[] | null;
    areaCenter(iVerts: Uint32Array): number[];
    flatten(
      iVertsInRadius: Uint32Array,
      aNormal: number[],
      aCenter: number[],
      center: number[],
      radiusSquared: number,
      intensity: number,
      picking: Picking,
    ): void;
  }
  export default Flatten;
}

declare module '@sculpt-vendor/editing/tools/Brush' {
  import type Picking from '@sculpt-vendor/math3d/Picking';
  import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
  class Brush {
    _main: unknown;
    _radius: number;
    _intensity: number;
    _negative: boolean;
    _clay: boolean;
    _culling: boolean;
    _accumulate: boolean;
    _idAlpha: number;
    _lockPosition: boolean;
    constructor(main: unknown);
    getMesh(): SculptMesh;
    stroke(picking: Picking): void;
    updateProxy(iVerts: Uint32Array): void;
    dynamicTopology(picking: Picking): Uint32Array;
    getFrontVertices(iVerts: Uint32Array, eyeDir: number[]): Uint32Array;
    areaNormal(iVerts: Uint32Array): number[] | null;
    areaCenter(iVerts: Uint32Array): number[];
  }
  export default Brush;
}
