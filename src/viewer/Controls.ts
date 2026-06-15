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

  /** Bounding sphere of the last framed subject, for reset. */
  private lastSphere = new Sphere(new Vector3(), 1);

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

  /**
   * Position the camera to frame `box` and set the orbit target to its centre.
   * Sensible near/far and min/max distance prevent dollying inside the mesh or
   * flying away.
   */
  frameSubject(box: Box3): void {
    const sphere = box.getBoundingSphere(new Sphere());
    this.lastSphere.copy(sphere);

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
    this.camera.position
      .copy(sphere.center)
      .addScaledVector(this.viewDir, distance);

    this.controls.minDistance = r * 0.4;
    this.controls.maxDistance = r * 10;
    this.controls.update();
  }

  /** Re-frame the last subject (Reset View). */
  reset(): void {
    const box = new Box3().setFromCenterAndSize(
      this.lastSphere.center,
      new Vector3().setScalar(this.lastSphere.radius * 2),
    );
    this.frameSubject(box);
  }

  update(): void {
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
