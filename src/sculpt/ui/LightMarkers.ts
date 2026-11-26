import { Vector3 } from 'three';
import type { Viewer } from '../../viewer/Viewer';
import type { AnyLightId } from '../../viewer/Lighting';

/** How long the markers stay after a light is picked. */
export const MARKERS_AFTER_PICK_MS = 1500;

/** Where a marker sits from the subject's centre, in the subject's radii. */
const REACH = 1.3;
const DISC = 9;
const RAY = 30;
/** The markers never leave this margin of the view, so a light behind the subject still shows. */
const MARGIN = 20;
const QUIET = '#a3a3a3';
const HALO = 'rgba(0, 0, 0, 0.35)';

/**
 * The lights of the rig drawn around the subject while Present moves one
 * (L held or armed) and for a moment after one is picked: one marker for
 * each light that is on, in the direction the light comes from, a small
 * disc with a short line toward the subject, the picked one orange and the
 * others the interface's quiet grey. On a 2D canvas over the view, as the
 * calipers' lines are (MeasureOverlay), so no render pass draws them: they
 * are the same size on screen at any zoom, cast nothing, cannot be picked,
 * build no shader or pipeline, and a saved image, a published look, a
 * turntable or a thumbnail never holds them.
 */
export class LightMarkers {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private shownUntil = 0;
  private timer = 0;
  private seen = '';
  private readonly dir = new Vector3();
  private readonly centre = new Vector3();
  private readonly at = new Vector3();

  constructor(
    private readonly viewer: Viewer,
    private readonly hooks: {
      /** Present is up: nothing is drawn otherwise. */
      presenting(): boolean;
      /** L is held or armed. */
      moving(): boolean;
      /** The light a drag moves. */
      picked(): AnyLightId;
    },
  ) {
    this.root = document.createElement('div');
    this.root.className = 'light-markers';
    this.canvas = document.createElement('canvas');
    this.root.appendChild(this.canvas);
    document.body.appendChild(this.root);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.root.remove();
  }

  /** A light was picked: the markers show for a moment, then go unless L is held. */
  flash(): void {
    this.shownUntil = performance.now() + MARKERS_AFTER_PICK_MS;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.tick(), MARKERS_AFTER_PICK_MS + 30);
    this.tick();
  }

  private shown(): boolean {
    return this.hooks.presenting() && (this.hooks.moving() || performance.now() < this.shownUntil);
  }

  /** Once a frame, after the view's camera and the light rig have moved for it. */
  tick(): void {
    if (!this.shown()) {
      if (this.seen !== '') this.clear();
      return;
    }
    const cam = this.viewer.camera;
    cam.updateMatrixWorld();
    const lights = this.viewer.lighting.state();
    const picked = this.hooks.picked();
    const r = this.viewer.captureCanvas.getBoundingClientRect();
    const parts: Array<number | string> = [picked, r.left, r.top, r.width, r.height, window.devicePixelRatio, ...cam.matrixWorld.elements, ...cam.projectionMatrix.elements];
    for (const l of lights) {
      parts.push(l.enabled ? 1 : 0, l.azimuth, l.elevation);
    }
    const radius = this.viewer.lighting.subjectSphere(this.centre);
    parts.push(radius, this.centre.x, this.centre.y, this.centre.z);
    // The rig turns with the view in Sculpt: its world direction is part of what is drawn.
    for (const l of lights) {
      this.viewer.lighting.directionOf(l.id, this.dir);
      parts.push(this.dir.x, this.dir.y, this.dir.z);
    }
    const sig = parts.join(',');
    if (sig === this.seen) return;
    this.seen = sig;
    this.draw(r, lights, picked, radius);
  }

  private clear(): void {
    this.seen = '';
    this.root.dataset.shown = '';
    this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private project(world: Vector3, r: DOMRect): [number, number] | null {
    const p = this.at.copy(world).project(this.viewer.camera);
    if (!(p.z >= -1 && p.z <= 1)) return null;
    return [r.left + (p.x * 0.5 + 0.5) * r.width, r.top + (-p.y * 0.5 + 0.5) * r.height];
  }

  private draw(r: DOMRect, lights: ReturnType<Viewer['lighting']['state']>, picked: AnyLightId, radius: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
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
    const orange = getComputedStyle(this.root).getPropertyValue('--bz-orange').trim() || '#ff5a1f';
    const quiet = getComputedStyle(this.root).getPropertyValue('--bz-text-hint').trim() || QUIET;
    const middle = this.project(this.centre, r);
    const drawn: string[] = [];
    // The picked one last, so it lies over the others.
    const order = [...lights].sort((a, b) => Number(a.id === picked) - Number(b.id === picked));
    for (const l of order) {
      if (!l.enabled) continue;
      this.viewer.lighting.directionOf(l.id, this.dir);
      const world = this.dir.multiplyScalar(radius * REACH).add(this.centre);
      const raw = this.project(world, r);
      if (!raw || !middle) continue;
      const x = Math.min(r.left + r.width - MARGIN, Math.max(r.left + MARGIN, raw[0]));
      const y = Math.min(r.top + r.height - MARGIN, Math.max(r.top + MARGIN, raw[1]));
      const colour = l.id === picked ? orange : quiet;
      // The short line toward the subject.
      const dx = middle[0] - x;
      const dy = middle[1] - y;
      const len = Math.hypot(dx, dy);
      if (len > DISC * 2) {
        const ux = dx / len;
        const uy = dy / len;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x + ux * (DISC + 3), y + uy * (DISC + 3));
        ctx.lineTo(x + ux * (DISC + 3 + Math.min(RAY, len - DISC * 2)), y + uy * (DISC + 3 + Math.min(RAY, len - DISC * 2)));
        ctx.strokeStyle = HALO;
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, DISC, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = HALO;
      ctx.stroke();
      drawn.push(l.id);
    }
    // For the tests: what is drawn, the picked one marked.
    this.root.dataset.shown = lights
      .filter((l) => drawn.includes(l.id))
      .map((l) => (l.id === picked ? `${l.id}*` : l.id))
      .join(',');
  }
}
