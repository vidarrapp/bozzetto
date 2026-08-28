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
    getVertices(): Float32Array;
    getNormals(): Float32Array;
    getColors(): Float32Array;
    getMaterials(): Float32Array;
    getTriangles(): Uint32Array;
    getFaces(): Uint32Array | Int32Array;
    getNbVertices(): number;
    getNbTriangles(): number;
    getNbFaces(): number;
    getMatrix(): Float32Array;
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
    getCurrentMesh(): SculptMesh;
    setSelection(sel: number): void;
  }
  interface Multimesh extends SculptMesh {}
  export default Multimesh;
}

declare module '@sculpt-vendor/editing/Subdivision' {
  const Subdivision: { LINEAR: boolean };
  export default Subdivision;
}

declare module '@sculpt-vendor/editing/SculptManager' {
  import type { SculptTool } from '@sculpt-vendor/editing/tools/SculptBase';
  class SculptManager {
    _symmetry: boolean;
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
    /** Masking tool only: whole-mask operations (ctrl gestures). */
    invert?(): void;
    clear?(): void;
  }
}

declare module '@sculpt-vendor/states/StateManager' {
  class StateManager {
    /** Undo stack depth cap (upstream default 15; the bridge raises it). */
    static STACK_LENGTH: number;
    constructor(main: unknown);
    /** Every undoable edit funnels through here (autosave hooks it). */
    pushState(state: unknown): void;
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
  const StateMultiresolution: {
    SUBDIVISION: number;
    REVERSION: number;
    SELECTION: number;
  };
  export default StateMultiresolution;
}

declare module '@sculpt-vendor/math3d/Picking' {
  import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
  class Picking {
    constructor(main: unknown, xSym?: boolean);
    intersectionMouseMeshes(): boolean;
    intersectionMouseMesh(mesh?: SculptMesh, mouseX?: number, mouseY?: number): boolean;
    getMesh(): SculptMesh | null;
    /** Intersection point in the picked mesh's local space. */
    getIntersectionPoint(): number[];
    getPickedFace(): number;
    updateLocalAndWorldRadius2(): void;
    getWorldRadius(): number;
  }
  export default Picking;
}
