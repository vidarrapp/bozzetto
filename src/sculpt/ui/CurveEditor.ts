import { onTap } from '../../ui/dom';
import { MAX_POINTS, MIN_GAP, type ProfileCurve, type ProfilePoint } from '../bridge/profile';

/**
 * The profile curve editor in the Tool panel: a row of preset buttons over
 * a small square plot of the curve, the dab centre on the left and its edge
 * on the right, weight up the side.
 *
 * - Drag a point to move it. The two end points stay at the centre and the
 *   edge and move up and down only.
 * - A tap (or click) on empty plot adds a point there.
 * - Drag a point out of the plot and let go to remove it; while it is out
 *   it shows as "will remove" and the curve is drawn without it. The end
 *   points never go, and a curve keeps at least two points.
 * - With a point focused, the arrow keys move it (Shift for larger steps),
 *   Delete or Backspace removes it.
 *
 * Pen, mouse and finger all drive it through pointer events, captured on
 * the plot; touch-action is none there and the touchstart default is
 * cancelled, so a held finger neither scrolls the panel nor arms the iPad
 * long-press callout. Edits are live and undo-less, like every other tool
 * slider: the brush reads the curve on its next dab. `onCommit` runs when
 * an edit lands (a release, a key, a preset), for the autosave.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
/** viewBox padding around the 0..100 plot, so the end points can be grabbed. */
const PAD = 7;
const SPAN = 100 + 2 * PAD;
/** How close (CSS px) a press has to land to a point to take it, by pointer kind. */
const HIT_PX = { mouse: 9, pen: 10, touch: 16 } as const;
/** A press that moved less than this (CSS px) before its release is a tap. */
const TAP_SLOP = 6;
/** How far outside the plot (CSS px) a dragged point has to go to be removed. */
const OUTSIDE_PX = 6;
const KEY_STEP = 0.01;
const KEY_STEP_BIG = 0.1;

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export interface CurveEditorOptions {
  /** The editor's accessible name, e.g. "Clay profile". */
  label: string;
  /** An edit landed (the autosave listens). */
  onCommit?: () => void;
}

export class CurveEditor {
  readonly root: HTMLDivElement;
  private readonly plot: SVGSVGElement;
  private readonly path: SVGPathElement;
  private readonly dots: SVGGElement;
  private readonly presetButtons = new Map<string, HTMLButtonElement>();
  private circles: SVGCircleElement[] = [];
  /** The point under the pointer: its index, and the points as they were at the press. */
  private drag: {
    id: number;
    index: number;
    before: ProfilePoint[];
    x0: number;
    y0: number;
    moved: boolean;
    outside: boolean;
  } | null = null;
  /** A press on empty plot, a tap to come. */
  private press: { id: number; x: number; y: number; moved: boolean } | null = null;
  private focusIndex = -1;

  constructor(
    private readonly curve: ProfileCurve,
    private readonly opts: CurveEditorOptions,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'curve-editor';

    const presets = document.createElement('div');
    presets.className = 'curve-editor__presets';
    for (const p of curve.presets) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sculpt-panel__btn curve-editor__preset';
      b.textContent = p.label;
      b.dataset.preset = p.id;
      b.setAttribute('aria-label', `${opts.label}: ${p.label}`);
      onTap(b, () => {
        this.curve.applyPreset(p.id);
        this.render();
        this.opts.onCommit?.();
      });
      this.presetButtons.set(p.id, b);
      presets.appendChild(b);
    }

    this.plot = svg('svg', { viewBox: `${-PAD} ${-PAD} ${SPAN} ${SPAN}`, class: 'curve-editor__plot', role: 'group' });
    this.plot.setAttribute('aria-label', opts.label);
    const frame = svg('rect', { x: 0, y: 0, width: 100, height: 100, class: 'curve-editor__frame' });
    const grid = svg('path', {
      class: 'curve-editor__grid',
      d: [25, 50, 75].map((g) => `M${g} 0V100M0 ${g}H100`).join(''),
    });
    this.path = svg('path', { class: 'curve-editor__curve' });
    this.dots = svg('g');
    this.plot.append(frame, grid, this.path, this.dots);

    const axis = document.createElement('div');
    axis.className = 'curve-editor__axis muted';
    const l = document.createElement('span');
    l.textContent = 'centre';
    const r = document.createElement('span');
    r.textContent = 'edge';
    axis.append(l, r);

    this.root.append(presets, this.plot, axis);
    this.wire();
    this.render();
  }

  /** Redraw from the curve (it may have changed elsewhere: a scene opened, a rake preset). */
  render(): void {
    const pts = this.curve.points;
    const removing = this.drag?.outside ? this.drag.index : -1;
    // The curve as the brush reads it.
    const n = 64;
    let d = '';
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      d += `${i ? 'L' : 'M'}${(t * 100).toFixed(2)} ${(100 - this.curve.sample(t) * 100).toFixed(2)}`;
    }
    this.path.setAttribute('d', d);
    // While a point is out, the curve is drawn without it; the point itself
    // stays where the pointer is, marked.
    const shown: ProfilePoint[] = removing >= 0 ? this.dragPoints() : [...pts];
    if (this.circles.length !== shown.length) {
      const hadFocus = this.circles.indexOf(document.activeElement as SVGCircleElement);
      this.dots.replaceChildren();
      this.circles = shown.map((_, i) => {
        const c = svg('circle', { r: 3.4, class: 'curve-editor__point', tabindex: 0, role: 'slider' });
        c.addEventListener('focus', () => (this.focusIndex = i));
        c.addEventListener('keydown', (e) => this.onKey(e, i));
        this.dots.appendChild(c);
        return c;
      });
      if (hadFocus >= 0) this.circles[Math.min(hadFocus, this.circles.length - 1)]?.focus();
    }
    shown.forEach((p, i) => {
      const c = this.circles[i];
      c.setAttribute('cx', (p.t * 100).toFixed(2));
      c.setAttribute('cy', (100 - p.v * 100).toFixed(2));
      const end = i === 0 || i === shown.length - 1;
      c.classList.toggle('curve-editor__point--end', end);
      c.classList.toggle('curve-editor__point--remove', i === removing);
      c.setAttribute('aria-label', `${end ? (i === 0 ? 'Centre' : 'Edge') : `Point ${i}`}: at ${Math.round(p.t * 100)}% out, weight ${Math.round(p.v * 100)}%`);
      c.setAttribute('aria-valuenow', p.v.toFixed(2));
      c.setAttribute('aria-valuemin', '0');
      c.setAttribute('aria-valuemax', '1');
    });
    this.root.classList.toggle('curve-editor--removing', removing >= 0);
    for (const [id, b] of this.presetButtons) b.classList.toggle('sculpt-panel__btn--on', id === this.curve.presetId);
  }

  /** The points of the drag in progress, the dragged one included even while it is out. */
  private dragPoints(): ProfilePoint[] {
    return this.drag ? this.drag.before.map((p, i) => (i === this.drag!.index ? this.pointerPoint ?? p : p)) : [...this.curve.points];
  }

  private pointerPoint: ProfilePoint | null = null;

  /** Client px to plot coordinates (t, v), unclamped. */
  private toPlot(x: number, y: number): ProfilePoint {
    const r = this.plot.getBoundingClientRect();
    const px = -PAD + ((x - r.left) / r.width) * SPAN;
    const py = -PAD + ((y - r.top) / r.height) * SPAN;
    return { t: px / 100, v: 1 - py / 100 };
  }

  /** Whether client px lie outside the plot's box (by more than the margin). */
  private isOutside(x: number, y: number): boolean {
    const r = this.plot.getBoundingClientRect();
    return x < r.left - OUTSIDE_PX || x > r.right + OUTSIDE_PX || y < r.top - OUTSIDE_PX || y > r.bottom + OUTSIDE_PX;
  }

  /** The point nearest client px, within the hit radius for this pointer kind. */
  private hitPoint(x: number, y: number, kind: string): number {
    const r = this.plot.getBoundingClientRect();
    const scale = r.width / SPAN;
    const reach = HIT_PX[kind as keyof typeof HIT_PX] ?? HIT_PX.mouse;
    let best = -1;
    let bestD: number = reach;
    this.curve.points.forEach((p, i) => {
      const cx = r.left + (p.t * 100 + PAD) * scale;
      const cy = r.top + (100 - p.v * 100 + PAD) * scale;
      const d = Math.hypot(cx - x, cy - y);
      if (d <= bestD) [best, bestD] = [i, d];
    });
    return best;
  }

  /** Where point `i` of `pts` may go: ends up and down only, the rest between their neighbours. */
  private place(pts: readonly ProfilePoint[], i: number, want: ProfilePoint): ProfilePoint {
    const v = clamp(want.v, 0, 1);
    if (i === 0) return { t: 0, v };
    if (i === pts.length - 1) return { t: 1, v };
    return { t: clamp(want.t, pts[i - 1].t + MIN_GAP, pts[i + 1].t - MIN_GAP), v };
  }

  private wire(): void {
    const plot = this.plot;
    plot.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    plot.addEventListener('contextmenu', (e) => e.preventDefault());
    plot.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !e.isPrimary || this.drag || this.press) return;
      e.preventDefault();
      const i = this.hitPoint(e.clientX, e.clientY, e.pointerType);
      plot.setPointerCapture(e.pointerId);
      if (i >= 0) {
        this.drag = { id: e.pointerId, index: i, before: [...this.curve.points], x0: e.clientX, y0: e.clientY, moved: false, outside: false };
        this.pointerPoint = { ...this.curve.points[i] };
        this.circles[i]?.focus({ preventScroll: true });
      } else {
        this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      }
    });
    plot.addEventListener('pointermove', (e) => {
      if (this.press && e.pointerId === this.press.id) {
        if (Math.hypot(e.clientX - this.press.x, e.clientY - this.press.y) > TAP_SLOP) this.press.moved = true;
        return;
      }
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 2) return;
      d.moved = true;
      const interior = d.index > 0 && d.index < d.before.length - 1;
      d.outside = interior && d.before.length > 2 && this.isOutside(e.clientX, e.clientY);
      const at = this.toPlot(e.clientX, e.clientY);
      if (d.outside) {
        this.pointerPoint = { t: clamp(at.t, -0.1, 1.1), v: clamp(at.v, -0.1, 1.1) };
        this.curve.setPoints(d.before.filter((_, k) => k !== d.index));
      } else {
        const p = this.place(d.before, d.index, at);
        this.pointerPoint = p;
        this.curve.setPoints(d.before.map((q, k) => (k === d.index ? p : q)));
      }
      this.render();
    });
    const release = (e: PointerEvent): void => {
      if (plot.hasPointerCapture(e.pointerId)) plot.releasePointerCapture(e.pointerId);
      const cancelled = e.type !== 'pointerup';
      if (this.press && e.pointerId === this.press.id) {
        const p = this.press;
        this.press = null;
        if (!cancelled && !p.moved && !this.isOutside(e.clientX, e.clientY)) this.addAt(this.toPlot(e.clientX, e.clientY));
        return;
      }
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      this.pointerPoint = null;
      // A cancelled drag (the system took the touch) puts the curve back.
      if (cancelled) this.curve.setPoints(d.before);
      if (cancelled && d.outside) this.focusIndex = -1;
      this.render();
      if (d.moved && !cancelled) this.opts.onCommit?.();
    };
    plot.addEventListener('pointerup', release);
    plot.addEventListener('pointercancel', release);
    plot.addEventListener('lostpointercapture', release);
  }

  /** A tap on empty plot: a point there, on its t, at the tapped height. */
  private addAt(at: ProfilePoint): void {
    const pts = [...this.curve.points];
    if (pts.length >= MAX_POINTS) return;
    const t = clamp(at.t, 0, 1);
    if (pts.some((p) => Math.abs(p.t - t) < MIN_GAP)) return;
    pts.push({ t, v: clamp(at.v, 0, 1) });
    if (!this.curve.setPoints(pts)) return;
    this.render();
    const i = this.curve.points.findIndex((p) => p.t === t);
    if (i >= 0) this.circles[i]?.focus({ preventScroll: true });
    this.opts.onCommit?.();
  }

  private onKey(e: KeyboardEvent, i: number): void {
    const pts = [...this.curve.points];
    if (i >= pts.length) return;
    const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    let want: ProfilePoint | null = null;
    if (e.key === 'ArrowUp') want = { t: pts[i].t, v: pts[i].v + step };
    else if (e.key === 'ArrowDown') want = { t: pts[i].t, v: pts[i].v - step };
    else if (e.key === 'ArrowLeft') want = { t: pts[i].t - step, v: pts[i].v };
    else if (e.key === 'ArrowRight') want = { t: pts[i].t + step, v: pts[i].v };
    else if ((e.key === 'Delete' || e.key === 'Backspace') && i > 0 && i < pts.length - 1) {
      e.preventDefault();
      e.stopPropagation();
      pts.splice(i, 1);
      this.curve.setPoints(pts);
      this.render();
      this.circles[Math.min(i, this.circles.length - 1)]?.focus();
      this.opts.onCommit?.();
      return;
    }
    if (!want) return;
    // The keys are the editor's while a point has the focus, not the
    // sculpt hotkeys' (the arrows orbit the view there).
    e.preventDefault();
    e.stopPropagation();
    pts[i] = this.place(pts, i, want);
    this.curve.setPoints(pts);
    this.render();
    this.opts.onCommit?.();
  }

  /** Which point has the keyboard (for tests), -1 for none. */
  focusedPoint(): number {
    return this.circles.indexOf(document.activeElement as SVGCircleElement) >= 0 ? this.focusIndex : -1;
  }
}
