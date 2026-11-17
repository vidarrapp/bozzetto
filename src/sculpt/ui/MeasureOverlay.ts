import type { Viewer } from '../../viewer/Viewer';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { SculptSession } from '../bridge/SculptSession';
import type { MeasureTool } from '../bridge/measureTool';
import { lengthText, toWorld, type Measure, type Vec3 } from '../bridge/measure';
import { onTap } from '../../ui/dom';

/** One measurement's line, as drawn: its end points on the page and its label. */
interface Drawn {
  a: [number, number];
  b: [number, number];
}

const LINE = '#f2f2f2';
const PINNED = '#b8b8b8';
const HALO = 'rgba(20, 20, 20, 0.85)';

/**
 * The calipers' measurements drawn over the view: for each, a line between
 * its two end points with a dot at each, and its length in a small label at
 * the middle. The line and the dots are the measurement's world points
 * through the camera, on a 2D canvas over the view as the brush ring and
 * the voxel grid are (so no render pass draws them and a saved image never
 * holds them); the label is a DOM box at the line's middle, screen-sized,
 * kept inside the view. A dark halo under the light line keeps it readable
 * over the pale clay and over the dark ground alike.
 *
 * Pinned measurements show while their object does; the one being made
 * shows with a Pin button on its label. All of it is interface: Tab and
 * Present hide it (style.css), as they hide the panels.
 */
export class MeasureOverlay {
  private readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly labels = new Map<string, HTMLDivElement>();
  private seen = '';

  constructor(
    private readonly viewer: Viewer,
    private readonly session: SculptSession,
    private readonly tool: MeasureTool,
    /** Whether the Calipers tool is the one in hand (its measurement is shown with its Pin). */
    private readonly inHand: () => boolean,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'measure-overlay';
    this.canvas = document.createElement('canvas');
    this.root.appendChild(this.canvas);
    document.body.appendChild(this.root);
  }

  dispose(): void {
    this.root.remove();
  }

  /** The measurements now to draw, each with its object, in order (pinned first). */
  private items(): Array<{ mesh: SculptMesh; m: Measure; working: boolean }> {
    const store = this.session.measure;
    const out: Array<{ mesh: SculptMesh; m: Measure; working: boolean }> = [];
    for (const { mesh, measure } of store.all()) {
      if (measure.visible && mesh.isVisible()) out.push({ mesh, m: measure, working: false });
    }
    const w = store.working;
    if (w && w.mesh.isVisible() && this.session.getMeshes().includes(w.mesh)) out.push({ mesh: w.mesh, m: w.m, working: true });
    return out;
  }

  /**
   * Draw again when something it depends on moved: a measurement changed,
   * the camera, an object's matrix, the size of the view. Called every
   * frame; a frame where none of those changed costs the comparison.
   */
  tick(): void {
    const items = this.items();
    if (!items.length) {
      if (this.seen !== '') this.clear();
      return;
    }
    const cam = this.viewer.camera;
    cam.updateMatrixWorld();
    const parts: Array<number | string> = [
      this.session.measure.version,
      window.innerWidth,
      window.innerHeight,
      this.tool.dragging() ?? '',
      this.inHand() ? 1 : 0,
      ...cam.matrixWorld.elements,
      ...cam.projectionMatrix.elements,
    ];
    for (const { mesh } of items) parts.push(...mesh.getMatrix());
    const sig = parts.join(',');
    if (sig === this.seen) return;
    this.seen = sig;
    this.draw(items);
  }

  private clear(): void {
    this.seen = '';
    const ctx = this.canvas.getContext('2d');
    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const el of this.labels.values()) el.remove();
    this.labels.clear();
  }

  private draw(items: Array<{ mesh: SculptMesh; m: Measure; working: boolean }>): void {
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
    const store = this.session.measure;
    const dragging = this.tool.dragging();
    const live = new Set<string>();
    for (const { mesh, m, working } of items) {
      const mat = mesh.getMatrix();
      const place = (p: Vec3): [number, number] | null => this.tool.screenOf(toWorld(mat, p));
      const a = place(m.a);
      if (!a) continue;
      const b = m.b ? place(m.b) : null;
      const color = working ? LINE : PINNED;
      if (b) {
        this.line(ctx, { a, b }, color, false);
        this.label(`m${m.id}`, live, { a, b }, lengthText(store.length(mesh, m) ?? 0), working && this.inHand() ? m : null, w, h);
      }
      if (m.mirror) {
        const ma = place(m.mirror.a);
        const mb = place(m.mirror.b);
        if (ma && mb) {
          this.line(ctx, { a: ma, b: mb }, color, true);
          this.label(`k${m.id}`, live, { a: ma, b: mb }, lengthText(store.mirrorLength(mesh, m) ?? 0), null, w, h);
        }
      }
      this.dot(ctx, a, color, working && dragging === 'a');
      if (b) this.dot(ctx, b, color, working && dragging === 'b');
      if (m.mirror) {
        const ma = place(m.mirror.a);
        const mb = place(m.mirror.b);
        if (ma) this.dot(ctx, ma, color, false, true);
        if (mb) this.dot(ctx, mb, color, false, true);
      }
    }
    for (const [key, el] of this.labels) {
      if (!live.has(key)) {
        el.remove();
        this.labels.delete(key);
      }
    }
    // For the tests: what is drawn.
    this.root.dataset.lines = String(live.size);
  }

  private line(ctx: CanvasRenderingContext2D, d: Drawn, color: string, dashed: boolean): void {
    ctx.setLineDash(dashed ? [5, 5] : []);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(d.a[0], d.a[1]);
    ctx.lineTo(d.b[0], d.b[1]);
    ctx.strokeStyle = HALO;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private dot(ctx: CanvasRenderingContext2D, p: [number, number], color: string, held: boolean, faint = false): void {
    ctx.beginPath();
    ctx.arc(p[0], p[1], faint ? 3.5 : 5, 0, Math.PI * 2);
    ctx.fillStyle = faint ? 'rgba(0,0,0,0)' : color;
    ctx.fill();
    ctx.lineWidth = held ? 2.5 : 1.5;
    // Orange is the focus: the end under the finger or the Pencil.
    ctx.strokeStyle = held ? (getComputedStyle(this.root).getPropertyValue('--bz-orange').trim() || '#ff5a1f') : faint ? color : HALO;
    ctx.stroke();
  }

  /** The length's label at the middle of its line, kept inside the view; the working one carries Pin. */
  private label(
    key: string,
    live: Set<string>,
    d: Drawn,
    text: string,
    pin: Measure | null,
    w: number,
    h: number,
  ): void {
    live.add(key);
    let el = this.labels.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'measure-label';
      el.dataset.role = 'measure-label';
      const value = document.createElement('span');
      value.className = 'measure-label__value';
      el.appendChild(value);
      this.root.appendChild(el);
      this.labels.set(key, el);
    }
    const value = el.querySelector<HTMLElement>('.measure-label__value')!;
    value.textContent = text;
    let pinBtn = el.querySelector<HTMLButtonElement>('.measure-label__pin');
    if (pin && !pinBtn) {
      pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = 'measure-label__pin';
      pinBtn.dataset.role = 'measure-label-pin';
      pinBtn.textContent = 'Pin';
      pinBtn.title = 'Keep this measurement in the scene';
      onTap(pinBtn, () => this.session.measure.pinWorking());
      el.appendChild(pinBtn);
    } else if (!pin && pinBtn) {
      pinBtn.remove();
    }
    el.classList.toggle('measure-label--working', !!pin);
    const mx = (d.a[0] + d.b[0]) / 2;
    const my = (d.a[1] + d.b[1]) / 2;
    const half = el.offsetWidth / 2;
    const x = Math.min(w - half - 6, Math.max(half + 6, mx));
    const y = Math.min(h - 6, Math.max(el.offsetHeight + 6, my - 10));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  }
}
