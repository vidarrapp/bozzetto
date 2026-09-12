import { CylinderGeometry, Matrix4, Object3D, OctahedronGeometry, Quaternion, Vector3, type BufferGeometry, type Mesh, type PerspectiveCamera, type Scene } from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { SculptSession } from './SculptSession';

/** The gizmo/picker groups inside a TransformControls (stable r184 shape). */
type GizmoInternals = {
  gizmo: Record<string, Object3D>;
  picker: Record<string, Object3D>;
};

export type GizmoMode = 'all' | 'translate' | 'rotate' | 'scale';

/** Which handles the gizmo shows (the Tool panel's Transform settings). */
export interface GizmoParts {
  arrows: boolean;
  planes: boolean;
  rotate: boolean;
  scale: boolean;
  /** The unified gizmo's centre: move on the screen plane (owner default). */
  screen: boolean;
  /** The uniform-scale cube, which the single scale mode (R) keeps. */
  uniform: boolean;
}

export const ALL_PARTS: GizmoParts = {
  arrows: true,
  planes: true,
  rotate: true,
  scale: true,
  screen: true,
  uniform: true,
};

/** Drag distance, as a fraction of the camera distance, that scales by e. */
const UNIFORM_SCALE_TRAVEL = 0.35;
/**
 * Scale never reaches zero and never turns negative (owner call: a
 * negative scale is a mirrored object with inverted normals and a trail
 * of trouble behind it). A drag that would cross the centre stops at this
 * fraction of where it started, so pulling a handle through the middle
 * squashes the object rather than flipping it.
 */
const SCALE_FLOOR = 0.01;

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
 * rotate gizmo's outer screen ring, the centre's move-across-the-screen).
 * W/E/R
 * expose a single mode; T toggles the unified one. Only one control may
 * drag at a time: whichever wins the pointer disables the others until
 * release, relying on listener order (translate registered first) so
 * overlapping handles never fight over one drag.
 *
 * The gizmo sits on the ACTIVE object and carries the rest of the
 * selection with it: every other selected object receives the same
 * world-space change, so a group moves, turns and scales about the active
 * object's origin, the way a Maya selection does about its last pick.
 *
 * Each completed drag is one undo entry - the vendor's StateCustom, holding
 * every moved matrix before and after.
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
  /**
   * The objects that ride along with the active one: the rest of the
   * selection, minus anything hidden or locked. Read at the start of each
   * drag. mode.ts supplies it; without one the gizmo moves the active
   * object alone.
   */
  getCompanions: (() => SculptMesh[]) | null = null;

  /** The proxy's scale when the current drag began (uniform scale reads it). */
  private readonly scaleStart = new Vector3(1, 1, 1);
  /** The proxy's full matrix at the press, for the group delta. */
  private readonly proxyStart = new Matrix4();
  /** Companions of the current drag, with the matrices they started from. */
  private companions: Array<{ mesh: SculptMesh; start: Matrix4 }> = [];
  private parts: GizmoParts = { ...ALL_PARTS };

  /** Choose the handles (owner request): what is off is detached, not just hidden. */
  setParts(parts: Partial<GizmoParts>): void {
    this.parts = { ...this.parts, ...parts };
    if (this.active) this.applyMode();
  }

  getParts(): GizmoParts {
    return { ...this.parts };
  }

  constructor(
    private readonly session: SculptSession,
    private readonly camera: PerspectiveCamera,
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
      tc.addEventListener('objectChange', () => {
        this.tameUniformScale(tc);
        this.clampScale();
        this.writeBack();
      });
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
    for (const g of this.arrowHead.values()) g.dispose();
    this.arrowHead.clear();
    this.arrowStock.clear();
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
      // A control whose every part is switched off stays out entirely.
      const wanted =
        tc.mode === 'rotate'
          ? this.parts.rotate
          : tc.mode === 'scale'
            ? this.parts.scale || (this.mode === 'scale' && this.parts.uniform)
            : this.parts.arrows || this.parts.planes || this.parts.screen;
      const on = (this.mode === 'all' || tc.mode === this.mode) && wanted;
      tc.enabled = on && !!this.mesh;
      tc.getHelper().visible = on && !!this.mesh;
      if (on && this.mesh) {
        tc.attach(this.proxy);
        // Place the handles now rather than on the next frame: the first
        // hover after entry hit-tests the pickers, and stale matrices made
        // a press at the centre fall through to the object behind it.
        tc.getHelper().updateMatrixWorld(true);
      } else {
        tc.detach();
      }
    }
  }

  // --- unified-mode handle trim (owner feedback) --------------------------

  /** Handles detached in unified mode, restored for the single modes. */
  private trimmed: Array<{ parent: Object3D; child: Object3D }> = [];
  /** The centre move handle's stock geometry, and the bigger unified pair. */
  private centreStock: { gizmo: BufferGeometry; picker: BufferGeometry } | null = null;
  private centreBig: { gizmo: BufferGeometry; picker: BufferGeometry } | null = null;
  /** The translate arrows' stock pickers, and the head-only ones unified mode uses. */
  private readonly arrowStock = new Map<Mesh, BufferGeometry>();
  private readonly arrowHead = new Map<Mesh, BufferGeometry>();

  /**
   * A stock translate picker is a cone from the object's centre to the tip
   * of its arrow, so the three of them meet in the middle - and the
   * translate control, first in line for the pointer, claimed a press on
   * the centre cube as a drag along whichever cone the ray grazed (owner
   * report: the centre moved the object along Z). The head-only picker
   * covers just the arrow head, leaving the middle to uniform scale and the
   * inner axis run to the scale boxes.
   */
  private headPicker(stock: Mesh): BufferGeometry {
    const axis = stock.name === 'X' ? 0 : stock.name === 'Y' ? 1 : 2;
    stock.geometry.computeBoundingBox();
    const bb = stock.geometry.boundingBox!;
    const sign = bb.min.getComponent(axis) + bb.max.getComponent(axis) < 0 ? -1 : 1;
    // Fat at the tip end, like the stock cone, but only over the head:
    // 0.42 to 0.62 along the axis (the arrow itself spans 0 to 0.6).
    const g = new CylinderGeometry(0.22, 0.06, 0.2, 4);
    const dir = new Vector3().setComponent(axis, sign);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
    g.applyMatrix4(new Matrix4().compose(dir.clone().multiplyScalar(0.52), q, new Vector3(1, 1, 1)));
    return g;
  }

  private internalsOf(mode: 'translate' | 'rotate' | 'scale'): GizmoInternals {
    const tc = this.stack.find((c) => c.mode === mode)!;
    return (tc as unknown as { _gizmo: GizmoInternals })._gizmo;
  }

  /**
   * The stacked (unified) gizmo showed every handle of all three controls,
   * and several of them sit on top of each other in the middle: the
   * translate centre octahedron over the uniform-scale cube, the rotate
   * control's invisible free-rotate sphere over both, and the translate
   * planes over the scale planes. In unified mode the centre belongs to
   * uniform scale (owner call: a press there span the model, because the
   * free-rotate picker was the first to claim it), the two-axis planes go
   * entirely, and the uniform cube grows so it is an easy target. View-plane
   * translate and free rotate keep working in their single modes. Detaching
   * nodes rather than hiding them is deliberate: TransformControlsGizmo
   * rewrites every handle's `.visible` (and scale) each frame, so only
   * removal - and, for the centre cube, swapped geometry - survives. Single
   * modes get stock handles back.
   */
  private applyUnifiedTrim(unified: boolean): void {
    for (const { parent, child } of this.trimmed) parent.add(child);
    this.trimmed = [];

    const translate = this.internalsOf('translate');
    const rotate = this.internalsOf('rotate');
    const scale = this.internalsOf('scale');

    // The centre: in unified mode it is the translate control's view-plane
    // handle - a move across the screen (owner call) - and it grows so it
    // is an easy target. In the single modes it goes back to stock, where
    // R's own centre cube is uniform scale.
    const centre = (group: Object3D): Mesh | undefined =>
      group.children.find((c) => c.name === 'XYZ' && (c as Mesh).isMesh) as Mesh | undefined;
    const moveG = centre(translate.gizmo.translate);
    const moveP = centre(translate.picker.translate);
    if (moveG && moveP) {
      if (!this.centreStock) {
        this.centreStock = { gizmo: moveG.geometry, picker: moveP.geometry };
        this.centreBig = {
          gizmo: new OctahedronGeometry(0.17, 0),
          picker: new OctahedronGeometry(0.34, 0),
        };
      }
      const want = unified ? this.centreBig! : this.centreStock;
      moveG.geometry = want.gizmo;
      moveP.geometry = want.picker;
    }

    // Arrow pickers: head-only in unified mode, stock in the single modes.
    for (const child of translate.picker.translate.children) {
      const picker = child as Mesh;
      if (!picker.isMesh || !['X', 'Y', 'Z'].includes(picker.name)) continue;
      if (!this.arrowStock.has(picker)) {
        this.arrowStock.set(picker, picker.geometry);
        this.arrowHead.set(picker, this.headPicker(picker));
      }
      picker.geometry = unified ? this.arrowHead.get(picker)! : this.arrowStock.get(picker)!;
    }

    const p = this.parts;
    const detach = (group: Object3D, names: string[]): void => {
      for (const child of [...group.children]) {
        if (names.includes(child.name)) {
          this.trimmed.push({ parent: group, child });
          group.remove(child);
        }
      }
    };
    if (unified) {
      // The middle belongs to one handle. The rotate control's invisible
      // free-rotate sphere and the uniform-scale cube both sat on top of
      // the move handle there; they go, along with every two-axis plane
      // (the translate planes sat on the scale planes).
      detach(translate.gizmo.translate, ['XY', 'YZ', 'XZ']);
      detach(translate.picker.translate, ['XY', 'YZ', 'XZ']);
      detach(rotate.gizmo.rotate, ['XYZE']);
      detach(rotate.picker.rotate, ['XYZE']);
      detach(scale.gizmo.scale, ['XYZ', 'XY', 'YZ', 'XZ']);
      detach(scale.picker.scale, ['XYZ', 'XY', 'YZ', 'XZ']);
      if (!p.screen) {
        detach(translate.gizmo.translate, ['XYZ']);
        detach(translate.picker.translate, ['XYZ']);
      }
    }
    // The user's own trim (Tool panel > Transform): each part off is
    // detached the same way, in every mode.
    if (!p.arrows) {
      detach(translate.gizmo.translate, ['X', 'Y', 'Z']);
      detach(translate.picker.translate, ['X', 'Y', 'Z']);
    }
    if (!p.planes) {
      detach(translate.gizmo.translate, ['XY', 'YZ', 'XZ']);
      detach(translate.picker.translate, ['XY', 'YZ', 'XZ']);
    }
    if (!p.scale) {
      detach(scale.gizmo.scale, ['X', 'Y', 'Z', 'XY', 'YZ', 'XZ']);
      detach(scale.picker.scale, ['X', 'Y', 'Z', 'XY', 'YZ', 'XZ']);
    }
    if (!p.uniform) {
      detach(scale.gizmo.scale, ['XYZ']);
      detach(scale.picker.scale, ['XYZ']);
    }
  }

  private beginDrag(winner: TransformControls): void {
    this.dragging = true;
    this.scaleStart.copy(this.proxy.scale);
    this.proxy.updateMatrix();
    this.proxyStart.copy(this.proxy.matrix);
    this.before.fromArray(this.mesh ? this.mesh.getMatrix() : this.proxy.matrix.elements);
    // The rest of the selection comes along, each from where it stands.
    this.companions = (this.getCompanions?.() ?? [])
      .filter((m) => m !== this.mesh)
      .map((mesh) => ({ mesh, start: new Matrix4().fromArray(mesh.getMatrix()) }));
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
    const companions = this.companions;
    this.companions = [];
    if (!mesh) return;
    const moved: Array<{ mesh: SculptMesh; before: number[]; after: number[] }> = [
      { mesh, before: this.before.toArray(), after: [...mesh.getMatrix()] },
      ...companions.map((c) => ({ mesh: c.mesh, before: c.start.toArray(), after: [...c.mesh.getMatrix()] })),
    ];
    // No movement, no undo entry.
    if (moved.every((m) => m.before.every((v, i) => Math.abs(v - m.after[i]) < 1e-9))) return;
    const write = (which: 'before' | 'after'): void => {
      for (const m of moved) {
        m.mesh.getMatrix().set(m[which]);
        // The proxy mirrors whichever object the gizmo is attached to NOW;
        // an undo of another object's move must not load its transform in.
        if (this.mesh === m.mesh) {
          this.proxy.matrix.fromArray(m.mesh.getMatrix());
          this.proxy.matrix.decompose(this.proxy.position, this.proxy.quaternion, this.proxy.scale);
        }
        this.onTransform?.(m.mesh);
      }
    };
    this.session
      .getStateManager()
      .pushStateCustom(
        () => write('before'),
        () => write('after'),
        false,
      );
    this.onCommit?.();
  }

  /**
   * The uniform-scale handle sits AT the object's centre, and three's
   * TransformControls scales by the ratio of the pointer's distance from
   * that centre now to what it was at the press. A press on a handle a
   * few pixels wide makes that starting distance tiny, so the first few
   * pixels of drag were already a multiple (owner report: far too
   * sensitive), and a drag back through the centre grew the object again
   * instead of shrinking it further (owner report: unusable for scaling
   * down). Rewritten as a signed travel: how far the pointer has moved
   * right and up since the press, in units of the camera distance, through
   * an exponential - a third of the view's depth of drag doubles or halves,
   * a small nudge is a small change, and down or left keeps shrinking for
   * as long as you drag. It never reaches zero and never turns negative.
   */
  private tameUniformScale(tc: TransformControls): void {
    if (!this.dragging || tc.mode !== 'scale' || tc.axis !== 'XYZ') return;
    const t = tc as unknown as { pointStart: Vector3; pointEnd: Vector3 };
    // pointStart/pointEnd lie on the camera-facing drag plane through the
    // object, in world units; project the move onto the camera's right and
    // up so "right or up grows" holds whichever way the view is turned.
    const delta = new Vector3().subVectors(t.pointEnd, t.pointStart);
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    const travel = delta.dot(right) + delta.dot(up);
    const depth = Math.max(1e-6, this.camera.position.distanceTo(this.proxy.position));
    const factor = Math.exp(travel / (depth * UNIFORM_SCALE_TRAVEL));
    this.proxy.scale.copy(this.scaleStart).multiplyScalar(factor);
  }

  /**
   * Per-axis scale boxes scale by the ratio of the pointer's distance
   * along the axis now to what it was at the press, which goes negative
   * the moment the pointer crosses the centre. Stopped at a floor on the
   * side the drag started from: the object squashes, never flips.
   */
  private clampScale(): void {
    if (!this.dragging) return;
    const s = this.proxy.scale;
    const s0 = this.scaleStart;
    for (const k of ['x', 'y', 'z'] as const) {
      const sign = s0[k] < 0 ? -1 : 1;
      const floor = Math.max(1e-4, Math.abs(s0[k]) * SCALE_FLOOR);
      if (s[k] * sign < floor) s[k] = sign * floor;
    }
  }

  /** Live during a drag: proxy TRS -> matrix -> the vendor mesh (and the companions). */
  private writeBack(): void {
    if (!this.mesh) return;
    this.proxy.updateMatrix();
    this.mesh.getMatrix().set(this.proxy.matrix.elements);
    this.onTransform?.(this.mesh);
    if (this.companions.length === 0) return;
    // The same world-space change for everyone else: delta = now * start^-1,
    // applied on the left of each companion's starting matrix.
    const delta = new Matrix4().copy(this.proxyStart).invert().premultiply(this.proxy.matrix);
    const m = new Matrix4();
    for (const c of this.companions) {
      m.copy(c.start).premultiply(delta);
      c.mesh.getMatrix().set(m.elements);
      this.onTransform?.(c.mesh);
    }
  }
}
