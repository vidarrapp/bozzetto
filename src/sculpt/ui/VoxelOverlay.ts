import { Vector3 } from 'three';
import type { Viewer } from '../../viewer/Viewer';
import { sliderValue } from '../../ui/sliderEntry';
import {
  formatBytes,
  maxRemeshResolution,
  remeshBudget,
  remeshBytes,
  voxelGrid,
  type Box6,
} from '../bridge/remeshBudget';

/** How long the grid stays after a key moves the slider, with no press to end it. */
const KEY_LINGER_MS = 900;

const _a = new Vector3();
const _b = new Vector3();
const _eye = new Vector3();

/**
 * The voxel grid a remesh would build, drawn over the view while its
 * resolution slider is held (owner request), in Sculpt's Remesh section
 * and Armature's Send to Sculpt alike. The remesher's own cells
 * (remeshBudget.voxelGrid), on the three faces of the grid's box nearest
 * the camera, projected: a voxel reads at its true size against the model
 * wherever the model sits in the view. On a 2D canvas over the view, as
 * the brush ring is (BrushCursor): no render pass draws it, so no
 * thumbnail or capture can catch it, and a line is a CSS pixel on every
 * backend. Dense grids fade rather than turn solid, and a caption gives
 * the voxel's size in pixels where the lines are too fine to count, and
 * the memory the remesh would take - or that this device cannot spare it.
 */
export class VoxelOverlay {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly caption: HTMLDivElement;
  private box: Box6 | null = null;
  private resolution = 0;

  constructor(private readonly viewer: Viewer) {
    this.root = document.createElement('div');
    this.root.className = 'voxel-overlay';
    this.root.hidden = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.caption = document.createElement('div');
    this.caption.className = 'voxel-overlay__caption';
    this.root.append(this.canvas, this.caption);
    (viewer.renderer.domElement.parentElement ?? document.body).appendChild(this.root);
  }

  isShown(): boolean {
    return !this.root.hidden;
  }

  /** Show the grid for `box` (world space, as the remesher takes it) at `resolution`. */
  show(box: Box6, resolution: number): void {
    this.box = box;
    this.resolution = resolution;
    this.root.hidden = false;
    this.draw();
  }

  /** The slider moved: the same box, another resolution. */
  update(resolution: number): void {
    if (!this.box || this.root.hidden) return;
    this.resolution = resolution;
    this.draw();
  }

  hide(): void {
    this.root.hidden = true;
    this.box = null;
  }

  dispose(): void {
    this.root.remove();
  }

  private draw(): void {
    const host = this.root.parentElement;
    const box = this.box;
    const grid = box && voxelGrid(box, this.resolution);
    if (!host || !box || !grid) return;
    const w = host.clientWidth;
    const h = host.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cam = this.viewer.camera;
    cam.updateMatrixWorld();
    const view = cam.matrixWorldInverse;
    const proj = cam.projectionMatrix;
    const near = cam.near;
    cam.getWorldPosition(_eye);
    const { step, min: lo, dims } = grid;
    const hi = [lo[0] + dims[0] * step, lo[1] + dims[1] * step, lo[2] + dims[2] * step];

    // One line of the grid, clipped at the near plane (a camera inside the
    // box sees the lines that pass beside it), then projected.
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let lines = 0;
    ctx.beginPath();
    const line = (p: number[], q: number[]): void => {
      _a.fromArray(p).applyMatrix4(view);
      _b.fromArray(q).applyMatrix4(view);
      const da = -_a.z;
      const db = -_b.z;
      if (da < near && db < near) return;
      if (da < near) _a.lerp(_b, (near - da) / (db - da));
      else if (db < near) _b.lerp(_a, (near - db) / (da - db));
      _a.applyMatrix4(proj);
      _b.applyMatrix4(proj);
      const ax = (_a.x + 1) * 0.5 * w;
      const ay = (1 - _a.y) * 0.5 * h;
      const bx = (_b.x + 1) * 0.5 * w;
      const by = (1 - _b.y) * 0.5 * h;
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      left = Math.min(left, ax, bx);
      right = Math.max(right, ax, bx);
      top = Math.min(top, ay, by);
      lines++;
    };
    // The face on the camera's side, across each axis: the three faces
    // that stand between the camera and the model, ruled at every cell.
    const p = [0, 0, 0];
    const q = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      const plane = _eye.getComponent(axis) < (lo[axis] + hi[axis]) / 2 ? lo[axis] : hi[axis];
      for (const [u, v] of [
        [(axis + 1) % 3, (axis + 2) % 3],
        [(axis + 2) % 3, (axis + 1) % 3],
      ]) {
        for (let i = 0; i <= dims[u]; i++) {
          p[axis] = q[axis] = plane;
          p[u] = q[u] = lo[u] + i * step;
          p[v] = lo[v];
          q[v] = hi[v];
          line(p, q);
        }
      }
    }

    // A voxel's size on screen at the box's centre, where the model is.
    _a.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2).applyMatrix4(view);
    const cellPx = ((step * proj.elements[5]) / Math.max(near, -_a.z)) * (h / 2);
    // White, which the canvas's difference blend (style.css) turns into
    // the inverse of whatever each line crosses. Faint where the cells are
    // a few pixels: a dense grid reads as a fine texture over the model
    // instead of covering it.
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = Math.min(0.55, Math.max(0.1, cellPx / 12));
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;

    const bytes = remeshBytes(box, this.resolution);
    const budget = remeshBudget();
    const over = bytes > budget;
    const size = cellPx >= 10 ? String(Math.round(cellPx)) : cellPx.toFixed(1);
    this.caption.textContent = over
      ? `${this.resolution}: about ${formatBytes(bytes)}, more than this device can spare. ${maxRemeshResolution(box, budget)} at most here.`
      : `${this.resolution} voxels across · one is ${size} px here · about ${formatBytes(bytes)}`;
    this.caption.classList.toggle('voxel-overlay__caption--over', over);
    // Above the grid, kept on the view.
    const cx = lines ? (left + right) / 2 : w / 2;
    const half = this.caption.offsetWidth / 2;
    this.caption.style.left = `${Math.round(Math.min(w - half - 8, Math.max(half + 8, cx)))}px`;
    this.caption.style.top = `${Math.round(Math.max(this.caption.offsetHeight + 8, Math.min(h - 8, lines ? top - 8 : h / 2)))}px`;
    // For the tests: what is up, as the brush ring mirrors its mode.
    Object.assign(this.root.dataset, {
      resolution: String(this.resolution),
      lines: String(lines),
      cellPx: cellPx.toFixed(2),
      over: over ? '1' : '0',
    });
  }
}

/**
 * Hold the overlay up while `input`, a remesh resolution slider, is held:
 * it follows the slider and goes on release. A key that moves the slider
 * shows it for a moment. `box` is asked when the overlay comes up - the
 * object cannot change while the slider is in hand - and null shows none.
 */
export function showWhileHeld(input: HTMLInputElement, overlay: VoxelOverlay, box: () => Box6 | null): void {
  let held = false;
  let linger = 0;
  const up = (): void => {
    held = false;
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    overlay.hide();
  };
  input.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const b = box();
    if (!b) return;
    held = true;
    clearTimeout(linger);
    overlay.show(b, sliderValue(input));
    // On the window: a release off the slider still ends the hold.
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  });
  input.addEventListener('input', () => {
    if (held) {
      overlay.update(sliderValue(input));
      return;
    }
    if (overlay.isShown()) overlay.update(sliderValue(input));
    else {
      const b = box();
      if (!b) return;
      overlay.show(b, sliderValue(input));
    }
    clearTimeout(linger);
    linger = window.setTimeout(() => {
      if (!held) overlay.hide();
    }, KEY_LINGER_MS);
  });
}
