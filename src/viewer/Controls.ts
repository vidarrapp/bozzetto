import {
  Box3,
  MOUSE,
  PerspectiveCamera,
  Sphere,
  Spherical,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * The closest the camera may come to its orbit target, in subject radii.
 * Low enough to work on an eyelid with the head as the subject: it was 0.4
 * after a frame, which stopped a pinch dead about a quarter of a head from
 * the last stroke (owner report), and 0.1 of whatever distance a restored
 * camera or a lens change happened to leave.
 */
const MIN_DISTANCE = 0.02;
/**
 * The farthest, in subject radii - or twice the framing distance, which a
 * long lens needs (at 135mm a frame alone sits beyond ten radii).
 */
const MAX_DISTANCE = 10;
const MAX_OF_FIT = 2;
/**
 * The near plane follows the camera in: never more than this fraction of
 * the target distance, so a surface the camera has come right up to is
 * not clipped away, and never more than NEAR_OF_RADIUS, which is what it
 * always was at framing distances, where depth precision wants it large.
 */
const NEAR_OF_DISTANCE = 1 / 50;
const NEAR_OF_RADIUS = 1 / 100;
const FAR_OF_RADIUS = 100;

/**
 * DCC-style camera navigation (design doc §7).
 *
 * OrbitControls with a remapped button scheme and damping. The fixed up-vector
 * (no roll) gives stable framing for a bust or figure. The target is kept
 * stable across frame swaps so changing geometry never jumps the camera.
 *
 *   Left   drag → orbit
 *   Middle drag → pan
 *   Right  drag → dolly (zoom)
 *   Wheel       → dolly (zoom)
 */
export class Controls {
  readonly controls: OrbitControls;

  /** Default viewing direction (camera offset from target), normalised. */
  private readonly viewDir = new Vector3(0.9, 0.55, 1).normalize();
  /**
   * The subject's radius, which the dolly limits and the clip planes scale
   * with; null until a subject is known, when the camera is left unbounded.
   */
  private radius: number | null = null;

  constructor(
    private readonly camera: PerspectiveCamera,
    domElement: HTMLElement,
  ) {
    const controls = new OrbitControls(camera, domElement);
    controls.mouseButtons = {
      LEFT: MOUSE.ROTATE,
      MIDDLE: MOUSE.PAN,
      RIGHT: MOUSE.DOLLY,
    };
    controls.enableZoom = true; // scroll wheel
    controls.enableDamping = true; // smooth, non-snapping feel
    controls.dampingFactor = 0.08;
    controls.zoomSpeed = 0.9;
    this.controls = controls;
  }

  /** Frame `box` from the default viewing direction (initial load). */
  frameSubject(box: Box3): void {
    this.place(box, this.viewDir);
  }

  /**
   * Frame `box` keeping the current view direction — a DCC-style "frame
   * selected" (hotkey "f"): pan + dolly so the subject fills the viewport
   * without changing the orbit angle.
   */
  focus(box: Box3): void {
    const dir = new Vector3().subVectors(this.camera.position, this.controls.target);
    if (dir.lengthSq() < 1e-8) dir.copy(this.viewDir);
    this.place(box, dir.normalize());
  }

  private place(box: Box3, dir: Vector3): void {
    const sphere = box.getBoundingSphere(new Sphere());

    const r = Math.max(sphere.radius, 1e-4);
    this.radius = r;
    // A frame is a reset: an orbit still coasting would carry the view
    // straight off the framing it was asked for.
    this.halt();
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, this.fitDistance(r));
    this.syncLimits();
    this.controls.update();
  }

  /**
   * How far back a sphere of radius r fits the view: into the vertical FOV,
   * then accounting for aspect so wide-but-short subjects still fit
   * horizontally, with a small margin.
   */
  private fitDistance(r: number): number {
    const vFov = (this.camera.fov * Math.PI) / 180;
    const fitHeight = r / Math.sin(vFov / 2);
    const fitWidth = fitHeight / Math.min(1, this.camera.aspect);
    return Math.max(fitHeight, fitWidth) * 1.15;
  }

  /**
   * The subject the limits scale with (every fit of the subject's bounds
   * sets it, framing or not). Set before a camera is restored, or the
   * restore is clamped to the old subject's limits.
   */
  setSubjectRadius(r: number): void {
    this.radius = Math.max(r, 1e-4);
    this.syncLimits();
  }

  /**
   * Re-derive the dolly limits from the subject and the lens, and the clip
   * planes from where the camera now is. Every route that moves the camera
   * (the wheel and the pinch inside OrbitControls, dollyBy, a fit, a
   * restore, a lens change) is clamped to the same floor and ceiling; the
   * viewer calls this once a frame, after everything has moved the camera
   * and before it renders, so the near plane always follows the distance.
   */
  syncLimits(): void {
    const r = this.radius;
    if (r === null) return;
    const c = this.controls;
    c.minDistance = r * MIN_DISTANCE;
    c.maxDistance = Math.max(r * MAX_DISTANCE, this.fitDistance(r) * MAX_OF_FIT);
    const dist = this.camera.position.distanceTo(c.target);
    const near = Math.max(Math.min(r * NEAR_OF_RADIUS, dist * NEAR_OF_DISTANCE), 1e-6);
    const far = Math.max(r * FAR_OF_RADIUS, c.maxDistance + 2 * r);
    if (near !== this.camera.near || far !== this.camera.far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }

  update(): void {
    this.controls.update();
  }

  /**
   * Drop whatever the damping still owes the view (the pen took over from
   * fingers mid-orbit): the camera stops where it is, rather than drifting
   * on under the first stroke.
   */
  halt(): void {
    const c = this.controls as unknown as { _sphericalDelta: Spherical; _panOffset: Vector3; _scale: number };
    c._sphericalDelta.set(0, 0, 0);
    c._panOffset.set(0, 0, 0);
    c._scale = 1;
  }

  /**
   * Turntable step: rotate the camera around the world Y axis about the
   * orbit target (sculpt wheel keys; positive = model appears to turn
   * right). Position-based, so OrbitControls just re-derives its spherical
   * on the next update.
   */
  rotateAzimuth(deg: number): void {
    const offset = new Vector3().subVectors(this.camera.position, this.controls.target);
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const x = offset.x * cos - offset.z * sin;
    const z = offset.x * sin + offset.z * cos;
    offset.x = x;
    offset.z = z;
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  /**
   * Place camera and target without running the controls. setState() ends in
   * controls.update(), which re-applies the frame's damped delta - fine when
   * called once, wrong from inside a post-update hook, where it applies the
   * same easing twice and skews the result.
   */
  placeCamera(position: Vector3, target: Vector3): void {
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.camera.lookAt(this.controls.target);
    this.camera.updateMatrixWorld();
  }

  /**
   * Turntable: rotate the camera AND the orbit target about a vertical axis
   * through `centre`. Rotating the target too keeps the view relationship
   * intact, so this stays a true turntable however far the stroke pivot has
   * wandered from the object's middle.
   */
  rotateAzimuthAbout(centre: Vector3, deg: number): void {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const spin = (p: Vector3): void => {
      const dx = p.x - centre.x;
      const dz = p.z - centre.z;
      p.x = centre.x + dx * cos + dz * sin;
      p.z = centre.z - dx * sin + dz * cos;
    };
    spin(this.camera.position);
    spin(this.controls.target);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  /**
   * Dolly by a multiplier along the view ray (>1 pulls back, <1 moves in),
   * clamped to the same min/max the wheel and the pinch obey. Drives the
   * sculpt ctrl-drag zoom, which exists so a Pencil can zoom without a pinch
   * gesture. A step is a proportion of the distance, as the wheel's is, so
   * it magnifies by the same amount at any distance; it does not shrink to
   * nothing near the floor, it stops at it.
   */
  dollyBy(factor: number): void {
    const offset = new Vector3().subVectors(this.camera.position, this.controls.target);
    const dist = offset.length();
    if (dist < 1e-6) return;
    const next = Math.min(
      this.controls.maxDistance,
      Math.max(this.controls.minDistance, dist * factor),
    );
    this.camera.position.copy(this.controls.target).addScaledVector(offset.normalize(), next);
    this.syncLimits();
    this.controls.update();
  }

  /** Distance from the camera to the orbit target (the depth-of-field focus). */
  targetDistance(): number {
    return this.camera.position.distanceTo(this.controls.target);
  }

  /**
   * Dolly along the view ray so the subject keeps its apparent size as the
   * vertical FOV changes: the lens-compression comparison at a fixed framing.
   * Moving back for a longer lens (and in for a wider one) is what a photographer
   * does to keep the subject filling the frame across focal lengths.
   */
  dollyForFov(oldFov: number, newFov: number): void {
    const offset = new Vector3().subVectors(this.camera.position, this.controls.target);
    const dist = offset.length();
    if (dist < 1e-6) return;
    const ratio = Math.tan((oldFov * Math.PI) / 360) / Math.tan((newFov * Math.PI) / 360);
    const newDist = dist * ratio;
    this.camera.position.copy(this.controls.target).addScaledVector(offset.normalize(), newDist);
    // The ceiling grows with the lens (twice its framing distance), so the
    // dolly that keeps the subject's size is not cut short at long lenses.
    this.syncLimits();
    this.controls.update();
  }

  getState(): { position: [number, number, number]; target: [number, number, number] } {
    const p = this.camera.position;
    const t = this.controls.target;
    return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  }

  setState(position: number[], target: number[]): void {
    this.camera.position.set(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
    this.controls.target.set(target[0] ?? 0, target[1] ?? 0, target[2] ?? 0);
    // The subject's limits, not ones made up from wherever this camera was
    // saved: a session left close in used to come back unable to zoom out
    // past ten times that distance.
    this.syncLimits();
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
