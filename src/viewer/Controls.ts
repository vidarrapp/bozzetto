import {
  Box3,
  MOUSE,
  PerspectiveCamera,
  Sphere,
  Vector3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
    const vFov = (this.camera.fov * Math.PI) / 180;
    // Fit the bounding sphere into the vertical FOV, then account for aspect so
    // wide-but-short subjects still fit horizontally, with a small margin.
    const fitHeight = r / Math.sin(vFov / 2);
    const fitWidth = fitHeight / Math.min(1, this.camera.aspect);
    const distance = Math.max(fitHeight, fitWidth) * 1.15;

    this.camera.near = Math.max(r / 100, 1e-3);
    this.camera.far = r * 100;
    this.camera.updateProjectionMatrix();

    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, distance);

    this.controls.minDistance = r * 0.4;
    this.controls.maxDistance = r * 10;
    this.controls.update();
  }

  update(): void {
    this.controls.update();
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
    this.camera.near = Math.max(newDist / 100, 1e-3);
    this.camera.far = newDist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = newDist * 0.1;
    this.controls.maxDistance = newDist * 10;
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
    const dist = Math.max(this.camera.position.distanceTo(this.controls.target), 1e-3);
    this.camera.near = Math.max(dist / 100, 1e-3);
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = dist * 0.1;
    this.controls.maxDistance = dist * 10;
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
