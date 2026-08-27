import { mat4, vec3 } from 'gl-matrix';
import type { PerspectiveCamera } from 'three';

/**
 * The two-method camera surface the vendored editing core consumes (plan 6.2):
 * math3d/Picking.js calls getCamera().unproject / .project only. Both mirror
 * upstream Camera.js exactly: screen space is device pixels with y measured
 * from the top (flipped against GL's bottom-left origin), and z runs 0..1
 * through a viewport matrix mapping NDC to [0..w, 0..h, 0..1].
 *
 * Matrices come from the live three camera each call (the render loop keeps
 * matrixWorldInverse current); three and gl-matrix share column-major layout,
 * so elements pass through fromValues-free.
 */
export class CameraAdapter {
  private readonly worldToScreen = mat4.create();
  private readonly screenToWorld = mat4.create();
  private readonly viewport = mat4.create();
  private readonly tmp = mat4.create();

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  private compute(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    // Upstream: viewport = scale(I, [w/2, h/2, 0.5]) then translate by [1,1,1],
    // i.e. p -> [(x+1)w/2, (y+1)h/2, (z+1)/2].
    const vp = this.viewport;
    mat4.identity(vp);
    mat4.scale(vp, vp, [0.5 * w, 0.5 * h, 0.5]);
    mat4.translate(vp, vp, [1.0, 1.0, 1.0]);

    const proj = this.camera.projectionMatrix.elements as unknown as Float32Array;
    const view = this.camera.matrixWorldInverse.elements as unknown as Float32Array;
    mat4.multiply(this.tmp, proj, view);
    mat4.multiply(this.worldToScreen, vp, this.tmp);
    mat4.invert(this.screenToWorld, this.worldToScreen);
  }

  /** Screen (device px, y-down) + depth z in [0..1] to a world-space point. */
  unproject(mouseX: number, mouseY: number, z: number): vec3 {
    this.compute();
    const out = vec3.fromValues(mouseX, this.canvas.height - mouseY, z);
    return vec3.transformMat4(out, out, this.screenToWorld);
  }

  /** World-space point to screen (device px, y-down, z in [0..1]). */
  project(vector: vec3 | number[]): number[] {
    this.compute();
    const out = [0.0, 0.0, 0.0] as unknown as vec3;
    vec3.transformMat4(out, vector as vec3, this.worldToScreen);
    out[1] = this.canvas.height - out[1];
    return out as unknown as number[];
  }
}
