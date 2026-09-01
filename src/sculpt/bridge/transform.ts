import { Matrix4, Object3D, type PerspectiveCamera, type Scene } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { SculptSession } from './SculptSession';

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
    for (const tc of this.stack) {
      this.scene.remove(tc.getHelper());
      tc.dispose();
    }
    this.scene.remove(this.proxy);
  }

  // --- internals ----------------------------------------------------------

  private applyMode(): void {
    for (const tc of this.stack) {
      const on = this.mode === 'all' || tc.mode === this.mode;
      tc.enabled = on && !!this.mesh;
      tc.getHelper().visible = on && !!this.mesh;
      if (on && this.mesh) tc.attach(this.proxy);
      else tc.detach();
    }
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
      this.proxy.matrix.fromArray(mesh.getMatrix());
      this.proxy.matrix.decompose(this.proxy.position, this.proxy.quaternion, this.proxy.scale);
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
