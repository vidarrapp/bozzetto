import { BoxGeometry, Matrix4, Object3D, type BufferGeometry, type Mesh, type PerspectiveCamera, type Scene } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { SculptSession } from './SculptSession';

/** The gizmo/picker groups inside a TransformControls (stable r184 shape). */
type GizmoInternals = {
  gizmo: Record<string, Object3D>;
  picker: Record<string, Object3D>;
};

export type GizmoMode = 'all' | 'translate' | 'rotate' | 'scale';

/**
 * Object transforms (owner design).
 *
 * The vendored Transform tool cannot be used: it draws through SculptGL's
 * own Gizmo, which lived in the GL pipeline Bozzetto cut. This is three's
 * TransformControls instead, driving a proxy Object3D whose matrix is
 * written straight into the vendor mesh - the same mat4 the autosave
 * serialises, so a moved object persists with no extra plumbing.
 *
 * The toolbar shows the UNIFIED gizmo: all three controls stacked on one
 * proxy, which is how the Maya-style view-plane handles come for free (the
 * rotate gizmo's outer screen ring, the translate centre square). E/R/T
 * expose a single mode; Q returns to sculpting. Only one control may drag
 * at a time: whichever wins the pointer disables the others until release,
 * relying on listener order (translate registered first) so overlapping
 * handles never fight over one drag.
 *
 * Each completed drag is one undo entry - the vendor's StateCustom, holding
 * the matrix before and after.
 */
export class TransformGizmo {
  private readonly proxy = new Object3D();
  private readonly stack: TransformControls[];
  private mesh: SculptMesh | null = null;
  private mode: GizmoMode = 'all';
  private active = false;
  private dragging = false;
  private readonly before = new Matrix4();

  /** The display side moved (live during a drag); update its matrices. */
  onTransform: ((mesh: SculptMesh) => void) | null = null;
  /** A drag began or ended (mode.ts parks OrbitControls while true). */
  onDragState: ((dragging: boolean) => void) | null = null;
  /** A drag committed: one undo entry pushed, autosave should learn. */
  onCommit: (() => void) | null = null;

  constructor(
    private readonly session: SculptSession,
    camera: PerspectiveCamera,
    dom: HTMLElement,
    private readonly scene: Scene,
  ) {
    this.scene.add(this.proxy);
    this.stack = (['translate', 'rotate', 'scale'] as const).map((mode) => {
      const tc = new TransformControls(camera, dom);
      tc.mode = mode;
      // Distinct radii keep the stacked handles apart: scale boxes inside,
      // arrows mid, rotate rings outside - close to Maya's silhouette.
      tc.setSize(mode === 'scale' ? 0.6 : mode === 'translate' ? 0.85 : 1.05);
      tc.addEventListener('dragging-changed', (e) => {
        const on = !!(e as unknown as { value: boolean }).value;
        if (on) this.beginDrag(tc);
        else this.endDrag();
      });
      tc.addEventListener('objectChange', () => this.writeBack());
      const helper = tc.getHelper();
      helper.visible = false;
      this.scene.add(helper);
      tc.enabled = false;
      return tc;
    });
  }

  isActive(): boolean {
    return this.active;
  }

  isDragging(): boolean {
    return this.dragging;
  }

  /**
   * Re-run the gizmo's own hover hit test for a pointer event. Touch sends
   * no hover moves, so without this the handles' `axis` is stale (null) at
   * pointerdown and the shell cannot tell a handle press from a body press.
   */
  hoverAt(e: PointerEvent): void {
    for (const tc of this.stack) {
      if (!tc.enabled) continue;
      const t = tc as unknown as {
        _getPointer(ev: PointerEvent): { x: number; y: number; button: number };
        pointerHover(p: { x: number; y: number; button: number }): void;
      };
      t.pointerHover(t._getPointer(e));
    }
  }

  /** Whether the pointer is over any handle (InputShell yields to it). */
  handleHovered(): boolean {
    return this.stack.some((tc) => tc.enabled && (tc as unknown as { axis: unknown }).axis);
  }

  getMode(): GizmoMode {
    return this.mode;
  }

  enter(mode: GizmoMode, mesh: SculptMesh | null): void {
    this.mode = mode;
    this.active = true;
    this.attach(mesh);
    this.applyMode();
  }

  setMode(mode: GizmoMode): void {
    this.mode = mode;
    if (this.active) this.applyMode();
  }

  exit(): void {
    this.active = false;
    for (const tc of this.stack) {
      tc.enabled = false;
      tc.getHelper().visible = false;
      tc.detach();
    }
    this.mesh = null;
  }

  /** Point the gizmo at an object (selection changes, entry). */
  attach(mesh: SculptMesh | null): void {
    this.mesh = mesh;
    if (!mesh) {
      for (const tc of this.stack) tc.detach();
      return;
    }
    this.proxy.matrix.fromArray(mesh.getMatrix());
    this.proxy.matrix.decompose(this.proxy.position, this.proxy.quaternion, this.proxy.scale);
    if (this.active) {
      for (const tc of this.stack) tc.attach(this.proxy);
      this.applyMode();
    }
  }

  dispose(): void {
    this.exit();
    // Hand the stock handles back before the controls dispose themselves,
    // then drop the geometries the trim created.
    this.applyUnifiedTrim(false);
    this.centreBig?.gizmo.dispose();
    this.centreBig?.picker.dispose();
    for (const tc of this.stack) {
      this.scene.remove(tc.getHelper());
      tc.dispose();
    }
    this.scene.remove(this.proxy);
  }

  // --- internals ----------------------------------------------------------

  private applyMode(): void {
    this.applyUnifiedTrim(this.mode === 'all');
    for (const tc of this.stack) {
      const on = this.mode === 'all' || tc.mode === this.mode;
      tc.enabled = on && !!this.mesh;
      tc.getHelper().visible = on && !!this.mesh;
      if (on && this.mesh) tc.attach(this.proxy);
      else tc.detach();
    }
  }

  // --- unified-mode handle trim (owner feedback) --------------------------

  /** Handles detached in unified mode, restored for the single modes. */
  private trimmed: Array<{ parent: Object3D; child: Object3D }> = [];
  private centreStock: { gizmo: BufferGeometry; picker: BufferGeometry } | null = null;
  private centreBig: { gizmo: BufferGeometry; picker: BufferGeometry } | null = null;

  private internalsOf(mode: 'translate' | 'scale'): GizmoInternals {
    const tc = this.stack.find((c) => c.mode === mode)!;
    return (tc as unknown as { _gizmo: GizmoInternals })._gizmo;
  }

  /**
   * The stacked (unified) gizmo showed every handle of all three controls,
   * and several of them sit on top of each other in the middle: the
   * translate centre octahedron over the uniform-scale cube, and the
   * translate planes over the scale planes. In unified mode the centre
   * belongs to uniform scale (view-plane translate keeps working in the
   * single move mode), the two-axis planes go entirely, and the uniform
   * cube grows so it is an easy target. Detaching nodes rather than hiding
   * them is deliberate: TransformControlsGizmo rewrites every handle's
   * `.visible` (and scale) each frame, so only removal - and, for the
   * centre cube, swapped geometry - survives. Single modes get stock
   * handles back.
   */
  private applyUnifiedTrim(unified: boolean): void {
    for (const { parent, child } of this.trimmed) parent.add(child);
    this.trimmed = [];

    const translate = this.internalsOf('translate');
    const scale = this.internalsOf('scale');

    // Centre cube geometry: stock in single modes, chunkier in unified.
    const centre = (group: Object3D): Mesh | undefined =>
      group.children.find((c) => c.name === 'XYZ' && (c as Mesh).isMesh) as Mesh | undefined;
    const cubeG = centre(scale.gizmo.scale);
    const cubeP = centre(scale.picker.scale);
    if (cubeG && cubeP) {
      if (!this.centreStock) {
        this.centreStock = { gizmo: cubeG.geometry, picker: cubeP.geometry };
        this.centreBig = {
          gizmo: new BoxGeometry(0.17, 0.17, 0.17),
          picker: new BoxGeometry(0.32, 0.32, 0.32),
        };
      }
      const want = unified ? this.centreBig! : this.centreStock;
      cubeG.geometry = want.gizmo;
      cubeP.geometry = want.picker;
    }

    if (!unified) return;
    const detach = (group: Object3D, names: string[]): void => {
      for (const child of [...group.children]) {
        if (names.includes(child.name)) {
          this.trimmed.push({ parent: group, child });
          group.remove(child);
        }
      }
    };
    detach(translate.gizmo.translate, ['XYZ', 'XY', 'YZ', 'XZ']);
    detach(translate.picker.translate, ['XYZ', 'XY', 'YZ', 'XZ']);
    detach(scale.gizmo.scale, ['XY', 'YZ', 'XZ']);
    detach(scale.picker.scale, ['XY', 'YZ', 'XZ']);
  }

  private beginDrag(winner: TransformControls): void {
    this.dragging = true;
    this.before.fromArray(this.mesh ? this.mesh.getMatrix() : this.proxy.matrix.elements);
    // One drag at a time: the winner keeps its input, the rest go quiet so
    // an overlapping handle cannot apply a second transform to the same
    // pointer. Listener order makes this deterministic.
    for (const tc of this.stack) if (tc !== winner) tc.enabled = false;
    this.onDragState?.(true);
  }

  private endDrag(): void {
    this.dragging = false;
    this.applyMode(); // restore whichever controls the mode wants enabled
    this.onDragState?.(false);
    const mesh = this.mesh;
    if (!mesh) return;
    const before = this.before.toArray();
    const after = [...mesh.getMatrix()];
    // No movement, no undo entry.
    if (before.every((v, i) => Math.abs(v - after[i]) < 1e-9)) return;
    const write = (values: number[] | Float32Array): void => {
      mesh.getMatrix().set(values as Float32Array | number[]);
      // The proxy mirrors whichever object the gizmo is attached to NOW;
      // an undo of another object's move must not load its transform in.
      if (this.mesh === mesh) {
        this.proxy.matrix.fromArray(mesh.getMatrix());
        this.proxy.matrix.decompose(this.proxy.position, this.proxy.quaternion, this.proxy.scale);
      }
      this.onTransform?.(mesh);
    };
    this.session
      .getStateManager()
      .pushStateCustom(
        () => write(before),
        () => write(after),
        false,
      );
    this.onCommit?.();
  }

  /** Live during a drag: proxy TRS -> matrix -> the vendor mesh. */
  private writeBack(): void {
    if (!this.mesh) return;
    this.proxy.updateMatrix();
    this.mesh.getMatrix().set(this.proxy.matrix.elements);
    this.onTransform?.(this.mesh);
  }
}
