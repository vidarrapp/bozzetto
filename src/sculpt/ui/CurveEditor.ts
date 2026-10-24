import { onTap } from '../../ui/dom';
import {
  HANDLE_V_MAX,
  HANDLE_V_MIN,
  insertAnchor,
  moveAnchor,
  moveHandle,
  removeAnchor,
  toggleCorner,
  type ProfileAnchor,
  type ProfileCurve,
  type ProfilePoint,
} from '../bridge/profile';

/**
 * The profile curve editor in the Tool panel: a row of preset buttons over
 * a small square plot of the curve, the dab centre on the left and its edge
 * on the right, weight up the side. The curve is a cubic Bezier through a
 * few anchors (profile.ts), drawn as the anchors and handles make it.
 *
 * - Drag an anchor to move it; its handles go with it. The two end anchors
 *   stay at the centre and the edge and move up and down only.
 * - Drag a handle (a small hollow dot on a thin line) to bend the curve.
 *   On a smooth anchor the other handle turns with it; on a corner it
 *   stays. Handles show for every anchor while there are up to
 *   ALL_HANDLES of them, else for the selected anchor and its neighbours.
 * - Double-tap (or double-click) an anchor to make it a corner, or smooth
 *   again (its handles line up).
 * - A tap (or click) on the curve or on empty plot adds an anchor there
 *   (on the curve when the tap is close to it), with smooth handles along
 *   the curve's slope.
 * - Drag an anchor out of the plot and let go to remove it; while it is
 *   out it shows as "will remove" and the curve is drawn without it. The
 *   end anchors never go, and a curve keeps at least two.
 * - With an anchor focused, the arrow keys move it (Shift for larger
 *   steps), Delete or Backspace removes it.
 *
 * Pen, mouse and finger all drive it through pointer events, captured on
 * the plot; touch-action is none there and the touchstart default is
 * cancelled, so a held finger neither scrolls the panel nor arms the iPad
 * long-press callout. Edits are live and undo-less, like every other tool
 * slider: the brush reads the curve on its next dab. `onCommit` runs when
 * an edit lands (a release, a key, a preset), for the autosave.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
/** viewBox padding around the 0..100 plot, so the end anchors can be grabbed. */
const PAD = 7;
const SPAN = 100 + 2 * PAD;
/** How close (CSS px) a press has to land to an anchor or handle to take it, by pointer kind. */
const HIT_PX = { mouse: 9, pen: 10, touch: 16 } as const;
/** A press that moved less than this (CSS px) before its release is a tap. */
const TAP_SLOP = 6;
/** A second tap on an anchor pressed within this (ms) of the first one's release is a double tap. */
const DOUBLE_TAP_MS = 500;
/** How far outside the plot (CSS px) a dragged anchor has to go to be removed. */
const OUTSIDE_PX = 6;
/** Up to this many anchors, every anchor's handles show. */
const ALL_HANDLES = 4;
const KEY_STEP = 0.01;
const KEY_STEP_BIG = 0.1;
/** Where a dragged handle may go on the plot (inside the padding, so it stays in view). */
const HANDLE_VIEW_LO = Math.max(HANDLE_V_MIN, -PAD / 100);
const HANDLE_VIEW_HI = Math.min(HANDLE_V_MAX, 1 + PAD / 100);

const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const X = (t: number): string => (t * 100).toFixed(2);
const Y = (v: number): string => (100 - v * 100).toFixed(2);

export interface CurveEditorOptions {
  /** The editor's accessible name, e.g. "Clay profile". */
  label: string;
  /** An edit landed (the autosave listens). */
  onCommit?: () => void;
}

type Grab = { kind: 'anchor'; index: number } | { kind: 'handle'; index: number; side: 'in' | 'out' };

export class CurveEditor {
  readonly root: HTMLDivElement;
  private readonly plot: SVGSVGElement;
  private readonly path: SVGPathElement;
  private readonly handleLayer: SVGGElement;
  private readonly dots: SVGGElement;
  private readonly presetButtons = new Map<string, HTMLButtonElement>();
  private anchorEls: SVGRectElement[] = [];
  /** The anchor or handle under the pointer, and the anchors as they were at the press. */
  private drag: {
    id: number;
    grab: Grab;
    before: ProfileAnchor[];
    x0: number;
    y0: number;
    /** When the press came (its event's timeStamp), for the double tap. */
    at: number;
    moved: boolean;
    outside: boolean;
  } | null = null;
  /** Where the dragged anchor is drawn while it is out of the box. */
  private pointerPoint: ProfilePoint | null = null;
  /** A press on empty plot, a tap to come. */
  private press: { id: number; x: number; y: number; moved: boolean } | null = null;
  /** The last tap on an anchor and when it was released, for the double tap. */
  private lastTap: { index: number; time: number } | null = null;
  /** The anchor last pressed or focused (its handles show), -1 for none. */
  private selected = -1;

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
        this.selected = -1;
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
    this.handleLayer = svg('g');
    this.dots = svg('g');
    this.plot.append(frame, grid, this.path, this.handleLayer, this.dots);

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

  /** The anchors as drawn: the curve's, or, while one is out, the drag's with it at the pointer. */
  private shownAnchors(): ProfileAnchor[] {
    const d = this.drag;
    if (d?.outside && d.grab.kind === 'anchor' && this.pointerPoint) {
      const i = d.grab.index;
      return d.before.map((p, k) => (k === i ? { ...p, t: this.pointerPoint!.t, v: this.pointerPoint!.v, in: null, out: null } : p));
    }
    return [...this.curve.anchors];
  }

  /** Which anchors' handles show. */
  private handlesShown(n: number): (i: number) => boolean {
    if (n <= ALL_HANDLES) return () => true;
    const s = this.selected;
    return (i) => s >= 0 && Math.abs(i - s) <= 1;
  }

  /** Redraw from the curve (it may have changed elsewhere: a scene opened, a rake preset). */
  render(): void {
    const anchors = this.curve.anchors;
    const d = this.drag;
    const removing = d?.outside && d.grab.kind === 'anchor' ? d.grab.index : -1;
    // The curve as its anchors draw it (a preset's kernel is what the brush
    // reads; the Bezier is how it is drawn).
    this.path.setAttribute('d', this.curve.polyline().map((p, i) => `${i ? 'L' : 'M'}${X(p.t)} ${Y(p.v)}`).join(''));
    if (this.selected >= anchors.length) this.selected = anchors.length - 1;
    // Handles: a thin line from the anchor and a small hollow dot.
    const shown = this.shownAnchors();
    const show = this.handlesShown(anchors.length);
    this.handleLayer.replaceChildren();
    anchors.forEach((p, i) => {
      if (removing >= 0 || !show(i)) return;
      for (const side of ['in', 'out'] as const) {
        const h = p[side];
        if (!h || (h.t === p.t && h.v === p.v)) continue;
        const line = svg('line', { x1: X(p.t), y1: Y(p.v), x2: X(h.t), y2: Y(h.v), class: 'curve-editor__handle-line' });
        const dot = svg('circle', { cx: X(h.t), cy: Y(h.v), r: 2.2, class: 'curve-editor__handle' });
        dot.dataset.anchor = String(i);
        dot.dataset.side = side;
        this.handleLayer.append(line, dot);
      }
    });
    // Anchors: filled, a round dot for a smooth one and a square for a corner.
    if (this.anchorEls.length !== shown.length) {
      const hadFocus = this.anchorEls.indexOf(document.activeElement as SVGRectElement);
      this.dots.replaceChildren();
      this.anchorEls = shown.map((_, i) => {
        const c = svg('rect', { width: 6.8, height: 6.8, class: 'curve-editor__point', tabindex: 0, role: 'slider' });
        c.addEventListener('focus', () => {
          this.selected = i;
          this.render();
        });
        c.addEventListener('keydown', (e) => this.onKey(e, i));
        this.dots.appendChild(c);
        return c;
      });
      if (hadFocus >= 0) this.anchorEls[Math.min(hadFocus, this.anchorEls.length - 1)]?.focus();
    }
    shown.forEach((p, i) => {
      const c = this.anchorEls[i];
      const corner = p.corner;
      const size = corner ? 6 : 6.8;
      c.setAttribute('x', (p.t * 100 - size / 2).toFixed(2));
      c.setAttribute('y', (100 - p.v * 100 - size / 2).toFixed(2));
      c.setAttribute('width', String(size));
      c.setAttribute('height', String(size));
      c.setAttribute('rx', corner ? '0.6' : String(size / 2));
      const end = i === 0 || i === shown.length - 1;
      c.classList.toggle('curve-editor__point--end', end);
      c.classList.toggle('curve-editor__point--corner', corner);
      c.classList.toggle('curve-editor__point--remove', i === removing);
      c.dataset.index = String(i);
      c.setAttribute(
        'aria-label',
        `${end ? (i === 0 ? 'Centre' : 'Edge') : `Anchor ${i}${corner ? ', corner' : ''}`}: at ${Math.round(p.t * 100)}% out, weight ${Math.round(p.v * 100)}%`,
      );
      c.setAttribute('aria-valuenow', p.v.toFixed(2));
      c.setAttribute('aria-valuemin', '0');
      c.setAttribute('aria-valuemax', '1');
    });
    this.root.classList.toggle('curve-editor--removing', removing >= 0);
    for (const [id, b] of this.presetButtons) b.classList.toggle('sculpt-panel__btn--on', id === this.curve.presetId);
  }

  /** Client px to plot coordinates (t, v), unclamped. */
  private toPlot(x: number, y: number): ProfilePoint {
    const r = this.plot.getBoundingClientRect();
    const px = -PAD + ((x - r.left) / r.width) * SPAN;
    const py = -PAD + ((y - r.top) / r.height) * SPAN;
    return { t: px / 100, v: 1 - py / 100 };
  }

  /** Plot coordinates to client px. */
  private toClient(p: ProfilePoint): [number, number] {
    const r = this.plot.getBoundingClientRect();
    const scale = r.width / SPAN;
    return [r.left + (p.t * 100 + PAD) * scale, r.top + (100 - p.v * 100 + PAD) * scale];
  }

  /** Whether client px lie outside the plot's box (by more than the margin). */
  private isOutside(x: number, y: number): boolean {
    const r = this.plot.getBoundingClientRect();
    return x < r.left - OUTSIDE_PX || x > r.right + OUTSIDE_PX || y < r.top - OUTSIDE_PX || y > r.bottom + OUTSIDE_PX;
  }

  /** The anchor, else the shown handle, nearest client px within the hit radius for this pointer kind. */
  private hit(x: number, y: number, kind: string): Grab | null {
    const reach = HIT_PX[kind as keyof typeof HIT_PX] ?? HIT_PX.mouse;
    const anchors = this.curve.anchors;
    let best: Grab | null = null;
    let bestD: number = reach;
    anchors.forEach((p, i) => {
      const [cx, cy] = this.toClient(p);
      const d = Math.hypot(cx - x, cy - y);
      if (d <= bestD) [best, bestD] = [{ kind: 'anchor', index: i }, d];
    });
    if (best) return best;
    const show = this.handlesShown(anchors.length);
    anchors.forEach((p, i) => {
      if (!show(i)) return;
      for (const side of ['in', 'out'] as const) {
        const h = p[side];
        if (!h || (h.t === p.t && h.v === p.v)) continue;
        const [cx, cy] = this.toClient(h);
        const d = Math.hypot(cx - x, cy - y);
        if (d <= bestD) [best, bestD] = [{ kind: 'handle', index: i, side }, d];
      }
    });
    return best;
  }

  private wire(): void {
    const plot = this.plot;
    plot.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    plot.addEventListener('contextmenu', (e) => e.preventDefault());
    plot.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !e.isPrimary || this.drag || this.press) return;
      e.preventDefault();
      const grab = this.hit(e.clientX, e.clientY, e.pointerType);
      plot.setPointerCapture(e.pointerId);
      if (grab) {
        this.drag = { id: e.pointerId, grab, before: [...this.curve.anchors], x0: e.clientX, y0: e.clientY, at: e.timeStamp, moved: false, outside: false };
        if (grab.kind === 'anchor') {
          this.selected = grab.index;
          this.anchorEls[grab.index]?.focus({ preventScroll: true });
        }
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
      const at = this.toPlot(e.clientX, e.clientY);
      if (d.grab.kind === 'handle') {
        const want = { t: at.t, v: clamp(at.v, HANDLE_VIEW_LO, HANDLE_VIEW_HI) };
        this.curve.setAnchors(moveHandle(d.before, d.grab.index, d.grab.side, want));
      } else {
        const i = d.grab.index;
        const interior = i > 0 && i < d.before.length - 1;
        d.outside = interior && d.before.length > 2 && this.isOutside(e.clientX, e.clientY);
        if (d.outside) {
          this.pointerPoint = { t: clamp(at.t, -0.1, 1.1), v: clamp(at.v, -0.1, 1.1) };
          this.curve.setAnchors(removeAnchor(d.before, i));
        } else {
          this.pointerPoint = null;
          this.curve.setAnchors(moveAnchor(d.before, i, at));
        }
      }
      this.render();
    });
    const release = (e: PointerEvent): void => {
      if (plot.hasPointerCapture(e.pointerId)) plot.releasePointerCapture(e.pointerId);
      const cancelled = e.type !== 'pointerup';
      if (this.press && e.pointerId === this.press.id) {
        const p = this.press;
        this.press = null;
        this.lastTap = null;
        if (!cancelled && !p.moved && !this.isOutside(e.clientX, e.clientY)) this.addAt(e.clientX, e.clientY, e.pointerType);
        return;
      }
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      this.pointerPoint = null;
      // A cancelled drag (the system took the touch) puts the curve back.
      if (cancelled) this.curve.setAnchors(d.before);
      if (cancelled && d.outside) this.selected = -1;
      if (d.outside && !cancelled) {
        this.selected = -1;
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      // A tap on an anchor: a second one pressed within DOUBLE_TAP_MS of
      // this one's release toggles its corner.
      if (!cancelled && !d.moved && d.grab.kind === 'anchor') {
        const now = e.timeStamp;
        const i = d.grab.index;
        if (this.lastTap && this.lastTap.index === i && d.at - this.lastTap.time < DOUBLE_TAP_MS) {
          this.lastTap = null;
          if (this.curve.setAnchors(toggleCorner(this.curve.anchors, i))) {
            this.render();
            this.opts.onCommit?.();
            return;
          }
        } else {
          this.lastTap = { index: i, time: now };
        }
      } else {
        this.lastTap = null;
      }
      this.render();
      if (d.moved && !cancelled) this.opts.onCommit?.();
    };
    plot.addEventListener('pointerup', release);
    plot.addEventListener('pointercancel', release);
    plot.addEventListener('lostpointercapture', release);
  }

  /** A tap on the curve or empty plot: an anchor there, on the curve when the tap is close to it. */
  private addAt(x: number, y: number, kind: string): void {
    const at = this.toPlot(x, y);
    const t = clamp(at.t, 0, 1);
    let v = clamp(at.v, 0, 1);
    const on = { t, v: this.curve.bezier(t) };
    const [cx, cy] = this.toClient(on);
    if (Math.hypot(cx - x, cy - y) <= (HIT_PX[kind as keyof typeof HIT_PX] ?? HIT_PX.mouse)) v = on.v;
    if (!this.curve.setAnchors(insertAnchor(this.curve.anchors, { t, v }))) return;
    const i = this.curve.anchors.findIndex((p) => p.t === t);
    this.selected = i;
    this.render();
    if (i >= 0) this.anchorEls[i]?.focus({ preventScroll: true });
    this.opts.onCommit?.();
  }

  private onKey(e: KeyboardEvent, i: number): void {
    const a = this.curve.anchors;
    if (i >= a.length) return;
    const step = e.shiftKey ? KEY_STEP_BIG : KEY_STEP;
    const p = a[i];
    let want: ProfilePoint | null = null;
    if (e.key === 'ArrowUp') want = { t: p.t, v: p.v + step };
    else if (e.key === 'ArrowDown') want = { t: p.t, v: p.v - step };
    else if (e.key === 'ArrowLeft') want = { t: p.t - step, v: p.v };
    else if (e.key === 'ArrowRight') want = { t: p.t + step, v: p.v };
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      if (!this.curve.setAnchors(removeAnchor(a, i))) return;
      this.selected = Math.min(i, this.curve.anchors.length - 1);
      this.render();
      this.anchorEls[this.selected]?.focus();
      this.opts.onCommit?.();
      return;
    }
    if (!want) return;
    // The keys are the editor's while an anchor has the focus, not the
    // sculpt hotkeys' (the arrows orbit the view there).
    e.preventDefault();
    e.stopPropagation();
    this.curve.setAnchors(moveAnchor(a, i, want));
    this.render();
    this.opts.onCommit?.();
  }

  /** Which anchor has the keyboard (for tests), -1 for none. */
  focusedPoint(): number {
    return this.anchorEls.indexOf(document.activeElement as SVGRectElement);
  }
}
