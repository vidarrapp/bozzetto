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

declare module '@sculpt-vendor/mesh/Mesh' {
  /**
   * The vendored mesh facade surface the bridge touches. Backing arrays are
   * over-allocated for dynamic growth; always bound reads by getNbVertices /
   * getNbTriangles (verified in WS0).
   */
  export interface SculptMesh {
    setVertices(v: Float32Array): void;
    setFaces(f: Uint32Array): void;
    init(): void;
    initRender(): void;
    getID(): number;
    getVertices(): Float32Array;
    getNormals(): Float32Array;
    getTriangles(): Uint32Array;
    getNbVertices(): number;
    getNbTriangles(): number;
    getNbFaces(): number;
    getMatrix(): Float32Array;
    normalizeSize(): void;
    updateGeometry(iFaces?: Uint32Array, iVerts?: Uint32Array): void;
    updateGeometryBuffers(): void;
    updateBuffers(): void;
    balanceOctree(): void;
    isVisible(): boolean;
    /** Bridge hook installed by GeometrySync (see the Mesh.js seam edit). */
    _bridgeSync?: {
      onGeometryBuffers(mesh: SculptMesh): void;
      onAllBuffers(mesh: SculptMesh): void;
    } | null;
  }
  const Mesh: { new (): SculptMesh; ID: number };
  export default Mesh;
}

declare module '@sculpt-vendor/mesh/multiresolution/Multimesh' {
  import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
  class Multimesh {
    constructor(mesh: unknown);
    _meshes: unknown[];
    _sel: number;
    addLevel(): unknown;
    getCurrentMesh(): SculptMesh;
  }
  interface Multimesh extends SculptMesh {}
  export default Multimesh;
}

declare module '@sculpt-vendor/editing/Subdivision' {
  const Subdivision: { LINEAR: boolean };
  export default Subdivision;
}

declare module '@sculpt-vendor/editing/SculptManager' {
  class SculptManager {
    constructor(main: unknown);
    setToolIndex(id: number): void;
    getToolIndex(): number;
    getCurrentTool(): { getScreenRadius(): number };
    getSymmetry(): boolean;
    start(ctrl: boolean): boolean;
    end(): void;
    preUpdate(): void;
    update(): void;
  }
  export default SculptManager;
}

declare module '@sculpt-vendor/states/StateManager' {
  class StateManager {
    constructor(main: unknown);
    pushStateAdd(mesh: unknown): void;
    undo(): void;
    redo(): void;
    cleanNoop(): void;
  }
  export default StateManager;
}

declare module '@sculpt-vendor/math3d/Picking' {
  class Picking {
    constructor(main: unknown, xSym?: boolean);
    intersectionMouseMeshes(): boolean;
    getMesh(): unknown;
  }
  export default Picking;
}
