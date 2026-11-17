import type { Viewer } from '../viewer/Viewer';
import { deviceStore } from '../ui/deviceStorage';
import { onTap } from '../ui/dom';
import { panelTop } from '../sculpt/ui/shellLayout';
import type { ReferenceBoard, RefItem } from './board';
import { drawLook } from './image';

/**
 * What the board's picture does on screen: the Beside window, and the
 * picture Over the view (behind the model, as the viewer's backdrop, or in
 * front of it as a film at an opacity). It listens to the board and draws
 * whichever is asked for; the board holds the state.
 *
 * The input rule, which everything here is built around: the pen and the
 * touches on the model always go to the model. The picture over the view
 * is a DOM layer with pointer-events none (or no layer at all, behind),
 * so it can neither start, end nor swallow a stroke; the Beside window
 * takes input only on its own frame, and the model around it is as it was.
 */

const OVER_KEY = 'bz.reference.over';

/** The processed picture (mirrored, in greys), as every way of showing it draws it. */
class Pictures {
  private key = '';
  private canvas: HTMLCanvasElement | null = null;
  private token = 0;

  async get(item: RefItem): Promise<HTMLCanvasElement | null> {
    const key = `${item.id}|${item.mirror ? 1 : 0}|${item.grey ? 1 : 0}|${item.blob.size}`;
    if (key === this.key && this.canvas) return this.canvas;
    const token = ++this.token;
    const canvas = await drawLook(item.blob, item);
    if (token !== this.token) return null; // a newer ask took over while this one decoded
    this.key = key;
    this.canvas = canvas;
    return canvas;
  }

  reset(): void {
    this.token++;
    this.key = '';
    this.canvas = null;
  }
}

export class ReferenceView {
  private readonly pictures = new Pictures();
  private readonly beside: BesideWindow;
  private readonly over: HTMLDivElement;
  private overCanvas: HTMLCanvasElement | null = null;
  private overOn = readOver();
  private backdropActive = false;
  private presenting = false;
  private readonly offBoard: () => void;
  private readonly ro: ResizeObserver | null;
  private renderToken = 0;

  private readonly onPresent = (e: Event): void => {
    this.presenting = !!(e as CustomEvent<{ active?: boolean }>).detail?.active;
    void this.render();
  };

  constructor(
    private readonly board: ReferenceBoard,
    private readonly viewer: Viewer,
  ) {
    this.beside = new BesideWindow(board);
    const host = viewer.captureCanvas.parentElement ?? document.body;
    this.over = document.createElement('div');
    this.over.className = 'ref-over';
    // Never an input target, whatever sits under it.
    this.over.style.pointerEvents = 'none';
    this.over.setAttribute('aria-hidden', 'true');
    this.over.hidden = true;
    host.appendChild(this.over);
    this.offBoard = board.onChange(() => void this.render());
    window.addEventListener('bozzetto:present', this.onPresent);
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.viewer.refreshBackdrop()) : null;
    this.ro?.observe(viewer.captureCanvas);
    void this.render();
  }

  /** The View menu's "Reference over the view". */
  isOverEnabled(): boolean {
    return this.overOn;
  }

  setOverEnabled(on: boolean): void {
    if (on === this.overOn) return;
    this.overOn = on;
    try {
      deviceStore.set(OVER_KEY, on ? 'on' : 'off');
    } catch {
      // A per-viewer convenience: not remembered with storage off.
    }
    void this.render();
  }

  /** The state the tests read: what is drawn where. */
  describe(): { beside: boolean; front: boolean; behind: boolean; opacity: number } {
    return {
      beside: !this.beside.isHidden(),
      front: !this.over.hidden && this.over.dataset.layer === 'front',
      behind: this.backdropActive,
      opacity: Number(this.over.style.opacity || 0),
    };
  }

  private async render(): Promise<void> {
    const token = ++this.renderToken;
    const shown = this.board.shown();
    const view = this.board.getView();
    const wantBeside = !!shown && view.mode === 'beside' && !this.presenting;
    const wantOver = !!shown && view.mode === 'over' && this.overOn && !this.presenting;
    const picture = shown && (wantBeside || wantOver) ? await this.pictures.get(shown) : null;
    if (token !== this.renderToken) return;
    if (wantBeside && picture && shown) this.beside.show(shown, picture);
    else this.beside.hide();
    const front = wantOver && !!picture && view.front;
    const behind = wantOver && !!picture && !view.front;
    if (front && picture) {
      if (this.overCanvas !== picture) {
        this.over.replaceChildren(picture);
        this.overCanvas = picture;
        // Fitted to the view's height, centred; the canvas keeps the picture's own shape.
        picture.className = 'ref-over__picture';
        picture.style.cssText = '';
        picture.style.aspectRatio = `${picture.width} / ${picture.height}`;
      }
      this.over.dataset.layer = 'front';
      this.over.style.opacity = String(view.opacity);
      this.over.hidden = false;
    } else {
      this.over.hidden = true;
      this.over.dataset.layer = '';
      this.over.replaceChildren();
      this.overCanvas = null;
    }
    if (behind && picture) {
      this.viewer.setBackdrop(picture);
      this.backdropActive = true;
    } else if (this.backdropActive) {
      this.viewer.setBackdrop(null);
      this.backdropActive = false;
    }
  }

  dispose(): void {
    this.offBoard();
    window.removeEventListener('bozzetto:present', this.onPresent);
    this.ro?.disconnect();
    if (this.backdropActive) this.viewer.setBackdrop(null);
    this.over.remove();
    this.beside.dispose();
    this.pictures.reset();
  }
}

function readOver(): boolean {
  try {
    return deviceStore.get(OVER_KEY) !== 'off';
  } catch {
    return true;
  }
}

// --- the Beside window ------------------------------------------------------

const EDGE = 8;
const WIDTH = 300;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 10;

/** Where the window was left, for as long as the page lives. */
let remembered: { x: number; y: number } | null = null;

/**
 * A float window (the Publish window's look and its title-bar drag) with
 * the picture in it: pinch to zoom and two fingers to pan inside it, the
 * wheel to zoom and a mouse or pen drag to pan, a double tap to fit it
 * again. It hides with the interface (Tab), as every float window does.
 */
class BesideWindow {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLSpanElement;
  private readonly frame: HTMLDivElement;
  private canvas: HTMLCanvasElement | null = null;
  private itemId = '';
  private zoom = 1;
  private tx = 0;
  private ty = 0;
  private drag: { id: number; dx: number; dy: number } | null = null;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private gesture: { dist: number; zoom: number; fx: number; fy: number } | null = null;
  private lastTap = 0;

  constructor(private readonly board: ReferenceBoard) {
    this.root = document.createElement('div');
    this.root.className = 'float-window ref-beside';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'false');
    this.root.setAttribute('aria-label', 'Reference picture');

    const bar = document.createElement('div');
    bar.className = 'float-window__bar';
    this.title = document.createElement('span');
    this.title.className = 'float-window__title ref-beside__title';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'float-window__close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close the reference picture');
    onTap(close, () => this.board.hide());
    bar.append(this.title, close);
    this.root.appendChild(bar);

    this.frame = document.createElement('div');
    this.frame.className = 'ref-beside__frame';
    this.root.appendChild(this.frame);
    document.body.appendChild(this.root);

    // A held title bar must give iOS nothing to start a callout or a lift from (see the Publish window).
    bar.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    bar.addEventListener('pointerdown', (e) => this.onBarDown(e, bar));
    bar.addEventListener('pointermove', this.onBarMove);
    bar.addEventListener('pointerup', (e) => this.onBarUp(e, bar));
    bar.addEventListener('pointercancel', (e) => this.onBarUp(e, bar));

    this.frame.addEventListener('pointerdown', this.onDown);
    this.frame.addEventListener('pointermove', this.onMove);
    this.frame.addEventListener('pointerup', this.onUp);
    this.frame.addEventListener('pointercancel', this.onUp);
    this.frame.addEventListener('wheel', this.onWheel, { passive: false });
    this.frame.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    window.addEventListener('resize', this.onResize);
  }

  isHidden(): boolean {
    return this.root.hidden === true;
  }

  show(item: RefItem, picture: HTMLCanvasElement): void {
    const fresh = this.root.hidden || this.itemId !== item.id;
    this.title.textContent = item.name;
    // A mirror or a greyscale redraws the picture and keeps the view of it.
    if (this.canvas !== picture || picture.parentElement !== this.frame) {
      if (this.canvas !== picture) this.canvas?.remove();
      this.canvas = picture;
      picture.className = 'ref-beside__picture';
      picture.style.cssText = '';
      this.frame.appendChild(picture);
    }
    const wasHidden = this.root.hidden;
    this.root.hidden = false;
    if (wasHidden) this.place();
    this.layout(item);
    if (fresh) this.fit();
    this.itemId = item.id;
    this.applyTransform();
  }

  hide(): void {
    this.root.hidden = true;
    this.pointers.clear();
    this.gesture = null;
  }

  /** The frame's size follows the picture's shape, within the screen; the picture is fitted inside it. */
  private layout(item: RefItem): void {
    const w = Math.min(WIDTH, window.innerWidth - 2 * EDGE);
    const maxH = Math.max(120, Math.round(window.innerHeight * 0.55));
    const h = Math.max(100, Math.min(maxH, Math.round((w * item.height) / item.width)));
    this.root.style.width = `${w}px`;
    this.frame.style.height = `${h}px`;
    this.fitSize();
  }

  private fitW = 0;
  private fitH = 0;

  private fitSize(): void {
    const c = this.canvas;
    if (!c) return;
    const w = this.frame.clientWidth || WIDTH;
    const h = parseFloat(this.frame.style.height) || 200;
    const s = Math.min(w / c.width, h / c.height);
    this.fitW = c.width * s;
    this.fitH = c.height * s;
    c.style.width = `${this.fitW}px`;
    c.style.height = `${this.fitH}px`;
  }

  private fit(): void {
    const w = this.frame.clientWidth || WIDTH;
    const h = parseFloat(this.frame.style.height) || 200;
    this.zoom = 1;
    this.tx = (w - this.fitW) / 2;
    this.ty = (h - this.fitH) / 2;
  }

  private clampPan(): void {
    const w = this.frame.clientWidth || WIDTH;
    const h = parseFloat(this.frame.style.height) || 200;
    const keep = 40;
    const pw = this.fitW * this.zoom;
    const ph = this.fitH * this.zoom;
    this.tx = Math.min(w - keep, Math.max(keep - pw, this.tx));
    this.ty = Math.min(h - keep, Math.max(keep - ph, this.ty));
  }

  private applyTransform(): void {
    if (!this.canvas) return;
    this.clampPan();
    this.canvas.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.zoom})`;
    this.root.dataset.zoom = this.zoom.toFixed(3);
  }

  /** Zoom about a point of the frame, so what is under it stays under it. */
  private zoomAt(next: number, fx: number, fy: number): void {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    const px = (fx - this.tx) / this.zoom;
    const py = (fy - this.ty) / this.zoom;
    this.zoom = z;
    this.tx = fx - px * z;
    this.ty = fy - py * z;
    this.applyTransform();
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.frame.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    // A trackpad pinch comes as a wheel with ctrl held and small deltas.
    const k = e.ctrlKey ? 0.01 : 0.0015;
    this.zoomAt(this.zoom * Math.exp(-e.deltaY * k), p.x, p.y);
  };

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      this.frame.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer has nothing to capture.
    }
    this.pointers.set(e.pointerId, this.local(e));
    if (e.detail === 2 || (e.pointerType === 'touch' && performance.now() - this.lastTap < 300 && this.pointers.size === 1)) {
      this.fit();
      this.applyTransform();
    }
    if (e.pointerType === 'touch' && this.pointers.size === 1) this.lastTap = performance.now();
    this.startGesture();
  };

  private startGesture(): void {
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.gesture = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: this.zoom, fx: (mx - this.tx) / this.zoom, fy: (my - this.ty) / this.zoom };
    } else {
      this.gesture = null;
    }
  }

  private readonly onMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    e.preventDefault();
    const now = this.local(e);
    this.pointers.set(e.pointerId, now);
    if (this.pointers.size === 2 && this.gesture) {
      // Two fingers: the spread zooms and the midpoint pans, the picture point first under it kept there.
      const [a, b] = [...this.pointers.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (this.gesture.zoom * (Math.hypot(a.x - b.x, a.y - b.y) || 1)) / this.gesture.dist));
      this.zoom = z;
      this.tx = mx - this.gesture.fx * z;
      this.ty = my - this.gesture.fy * z;
      this.applyTransform();
    } else if (this.pointers.size === 1 && e.pointerType !== 'touch') {
      // A mouse or the pen pans with one; one finger does nothing (two pan).
      this.tx += now.x - prev.x;
      this.ty += now.y - prev.y;
      this.applyTransform();
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.frame.hasPointerCapture(e.pointerId)) this.frame.releasePointerCapture(e.pointerId);
    this.startGesture();
  };

  // --- moving the window by its title bar ----------------------------------

  private place(): void {
    const w = this.root.offsetWidth || WIDTH;
    const at = remembered ?? { x: EDGE + 8, y: panelTop() + 8 };
    this.moveTo(at.x, at.y, w);
  }

  private moveTo(x: number, y: number, w = this.root.offsetWidth): void {
    const h = this.root.offsetHeight;
    const maxX = Math.max(EDGE, window.innerWidth - w - EDGE);
    const maxY = Math.max(EDGE, window.innerHeight - h - EDGE);
    this.root.style.left = `${Math.round(Math.min(maxX, Math.max(EDGE, x)))}px`;
    this.root.style.top = `${Math.round(Math.min(maxY, Math.max(EDGE, y)))}px`;
  }

  private onBarDown(e: PointerEvent, bar: HTMLElement): void {
    if (e.button !== 0 || (e.target as Element).closest('.float-window__close')) return;
    e.preventDefault();
    const r = this.root.getBoundingClientRect();
    this.drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {
      // Nothing to capture on a synthetic pointer.
    }
    this.root.classList.add('float-window--dragging');
  }

  private readonly onBarMove = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    e.preventDefault();
    this.moveTo(e.clientX - this.drag.dx, e.clientY - this.drag.dy);
  };

  private onBarUp(e: PointerEvent, bar: HTMLElement): void {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId);
    this.drag = null;
    this.root.classList.remove('float-window--dragging');
    const r = this.root.getBoundingClientRect();
    remembered = { x: r.left, y: r.top };
  }

  private readonly onResize = (): void => {
    if (this.root.hidden) return;
    const r = this.root.getBoundingClientRect();
    const item = this.board.shown();
    if (item) this.layout(item);
    this.moveTo(r.left, r.top);
    this.applyTransform();
  };

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }
}
