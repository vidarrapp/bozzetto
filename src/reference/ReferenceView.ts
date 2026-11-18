import type { Viewer } from '../viewer/Viewer';
import { deviceStore } from '../ui/deviceStorage';
import { BEHIND, DEFAULT_BLEND, type Placement, type ReferenceBoard, type RefItem, type StoredCamera } from './board';
import { blendModeById, blendSelect, CSS_BLEND_MODES } from '../ui/blendModes';
import { compactRange } from '../ui/Panel';
import { setSliderValue } from '../ui/sliderEntry';
import { Vector3 } from 'three';
import { drawLook } from './image';

/**
 * What the board's pictures do on screen. A picture in the view is one
 * kind of thing: a floating picture with a place, a size, an opacity, a
 * blend mode, mirror and greyscale. Small in a corner at Normal is a
 * picture to glance at; fitted across the view at Multiply 30% is a film
 * to trace on. Several may be in the view at once. Behind is the one blend
 * that is not an element: the viewer draws that picture behind the model.
 *
 * Two layers sit in the view's own box. The picture layer holds the
 * pictures and is never an input target (pointer-events none), locked or
 * not, so nothing in it can start, end or swallow a stroke or a gesture.
 * The chrome layer holds what arranging draws (an outline, corner marks
 * and a row of buttons per picture) and exists only while arranging; it
 * is the one thing that takes a pointer, and only on the pictures' own
 * frames, so the model around them is worked as always. Locking removes
 * it, and every picture is pass-through.
 */

const SHOW_KEY = 'bz.reference.show';
const BAR_BTN = 44;
/** The row under a picture: as wide as the picture, never narrower than this, and one finger tall. */
const UNDER_MIN_W = 240;
const UNDER_H = 44;
const EDGE = 4;
const MIN_W = 0.06;
const MAX_W = 6;

/** The names of the buttons in a picture's row, and what they do. */
export const FRAME_ACTIONS = [
  { id: 'lock', name: 'Lock', icon: 'fi-ss-lock' },
  { id: 'fit', name: 'Fit', icon: 'fi-ss-expand' },
  { id: 'flip', name: 'Flip', icon: 'fi-ss-reflect-horizontal' },
  { id: 'grey', name: 'Greyscale', icon: 'fi-ss-circle-half' },
  { id: 'remove', name: 'Remove from view', icon: 'fi-ss-cross-small' },
] as const;

/** A picture's box in the view, in the view's own pixels. */
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The processed picture (mirrored, in greys), as every way of showing it draws it. */
class Pictures {
  private readonly cache = new Map<string, { key: string; canvas: HTMLCanvasElement }>();
  private readonly tokens = new Map<string, number>();

  async get(item: RefItem): Promise<HTMLCanvasElement | null> {
    const key = `${item.mirror ? 1 : 0}|${item.grey ? 1 : 0}|${item.blob.size}`;
    const have = this.cache.get(item.id);
    if (have && have.key === key) return have.canvas;
    const token = (this.tokens.get(item.id) ?? 0) + 1;
    this.tokens.set(item.id, token);
    const canvas = await drawLook(item.blob, item);
    if (this.tokens.get(item.id) !== token) return null; // a newer ask took over while this one decoded
    this.cache.set(item.id, { key, canvas });
    return canvas;
  }

  /** Forget pictures that are gone (their canvases are released with them). */
  keep(ids: Set<string>): void {
    for (const id of [...this.cache.keys()]) {
      if (!ids.has(id)) {
        this.cache.delete(id);
        this.tokens.delete(id);
      }
    }
  }

  reset(): void {
    this.cache.clear();
    this.tokens.clear();
  }
}

interface FrameEls {
  el: HTMLDivElement;
  bar: HTMLDivElement;
  buttons: Map<string, HTMLButtonElement>;
  /** The row under the picture: the blend mode and Opacity. */
  under: HTMLDivElement;
  select: HTMLSelectElement;
  opacity: HTMLInputElement;
}

export class ReferenceView {
  private readonly pictures = new Pictures();
  private readonly layer: HTMLDivElement;
  private readonly chrome: HTMLDivElement;
  private readonly pics = new Map<string, HTMLDivElement>();
  private readonly frames = new Map<string, FrameEls>();
  private showAll = readShow();
  private backdropActive = false;
  private presenting = false;
  private readonly offBoard: () => void;
  private readonly offPlace: () => void;
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
    const host = viewer.captureCanvas.parentElement ?? document.body;
    this.layer = document.createElement('div');
    this.layer.className = 'ref-layer';
    // Never an input target, whatever sits under it.
    this.layer.style.pointerEvents = 'none';
    this.layer.setAttribute('aria-hidden', 'true');
    this.chrome = document.createElement('div');
    this.chrome.className = 'ref-chrome';
    this.chrome.hidden = true;
    host.append(this.layer);
    // The chrome stands outside the viewer's own container, whose pointer handling would take a press first; it is kept over the view's box.
    document.body.appendChild(this.chrome);
    board.bindCamera(
      () => this.cameraNow(),
      (c) => this.cameraSet(c),
    );
    this.offBoard = board.onChange(() => void this.render());
    this.offPlace = board.onPlace(() => this.layout());
    window.addEventListener('bozzetto:present', this.onPresent);
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.layout()) : null;
    this.ro?.observe(viewer.captureCanvas);
    void this.render();
  }

  // --- what the menus and tests ask --------------------------------------

  /** The View menu's "References": the pictures in the view shown or hidden, all at once. */
  isShown(): boolean {
    return this.showAll;
  }

  setShown(on: boolean): void {
    if (on === this.showAll) return;
    this.showAll = on;
    try {
      deviceStore.set(SHOW_KEY, on ? 'on' : 'off');
    } catch {
      // A per-viewer convenience: not remembered with storage off.
    }
    void this.render();
  }

  /** The state the tests read: what is drawn where. */
  describe(): {
    shown: boolean;
    arranging: boolean;
    pictures: { id: string; name: string; blend: string; opacity: number; element: boolean }[];
    behind: boolean;
  } {
    return {
      shown: this.showAll,
      arranging: this.board.isArranging(),
      behind: this.backdropActive,
      pictures: this.visibleItems().map((i) => ({ id: i.id, name: i.name, blend: i.blend, opacity: i.opacity, element: this.pics.has(i.id) })),
    };
  }

  // --- geometry -----------------------------------------------------------

  private viewRect(): { w: number; h: number; u: number } {
    const w = this.layer.clientWidth || this.viewer.captureCanvas.clientWidth || 1;
    const h = this.layer.clientHeight || this.viewer.captureCanvas.clientHeight || 1;
    return { w, h, u: Math.min(w, h) };
  }

  private boxOf(item: RefItem, place: Placement): Box {
    const v = this.viewRect();
    const width = place.w * v.u;
    const height = width * (item.height / item.width);
    return { left: v.w / 2 + place.x * v.u - width / 2, top: v.h / 2 + place.y * v.u - height / 2, width, height };
  }

  /** Where a picture goes when it is first put in the view: small, in the top left corner. */
  defaultPlace(item: RefItem): Placement {
    const v = this.viewRect();
    const wpx = Math.min(v.u * 0.42, v.w * 0.6);
    const hpx = wpx * (item.height / item.width);
    return { x: (-v.w / 2 + 16 + wpx / 2) / v.u, y: (-v.h / 2 + 60 + hpx / 2) / v.u, w: wpx / v.u };
  }

  /** The picture filling the view, its aspect kept (Fit). */
  fitPlace(item: RefItem): Placement {
    const v = this.viewRect();
    const wpx = Math.min(v.w, v.h * (item.width / item.height));
    return { x: 0, y: 0, w: wpx / v.u };
  }

  private placeOf(item: RefItem): Placement {
    return item.place ?? this.defaultPlace(item);
  }

  /** The pictures in the view, lowest first, if the view shows them at all. */
  private visibleItems(): RefItem[] {
    return this.showAll && !this.presenting ? this.board.inView() : [];
  }

  /**
   * The pictures in the view with where each stands on the page (client
   * pixels), the one drawn lowest first. What a projection tool starts from.
   */
  picturesInView(): { item: RefItem; left: number; top: number; width: number; height: number }[] {
    const r = this.layer.getBoundingClientRect();
    return this.visibleItems().map((item) => {
      const b = this.boxOf(item, this.placeOf(item));
      return { item, left: r.left + b.left, top: r.top + b.top, width: b.width, height: b.height };
    });
  }

  /**
   * The picture drawn topmost at a screen point (client coordinates), and
   * the pixel of its stored image under it: x and y in image pixels
   * (un-mirrored, as stored), u and v from 0 to 1 across it, v down. Null
   * when no picture in the view covers the point.
   */
  imageAt(clientX: number, clientY: number): { item: RefItem; x: number; y: number; u: number; v: number } | null {
    const all = this.picturesInView();
    for (let n = all.length - 1; n >= 0; n--) {
      const p = all[n];
      let u = (clientX - p.left) / p.width;
      const v = (clientY - p.top) / p.height;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      if (p.item.mirror) u = 1 - u;
      const { item } = p;
      return { item, u, v, x: Math.min(item.width - 1, Math.floor(u * item.width)), y: Math.min(item.height - 1, Math.floor(v * item.height)) };
    }
    return null;
  }

  /** Whether a screen point is over the view itself (not over a panel or a menu). */
  isOverView(clientX: number, clientY: number): boolean {
    const r = this.viewer.captureCanvas.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
    // Not over an open panel, even where its box has no element (a gap between its rows).
    for (const panel of document.querySelectorAll('.panel:not(.panel--collapsed)')) {
      // A panel's root may be no box of its own: its tab and body are what cover the view.
      for (const part of [panel, ...Array.from(panel.children)]) {
        const pr = part.getBoundingClientRect();
        if (clientX >= pr.left && clientX <= pr.right && clientY >= pr.top && clientY <= pr.bottom) return false;
      }
    }
    const e = document.elementFromPoint(clientX, clientY);
    return !e || !e.closest('.panel, .file-menu, .float-window, .sculpt-toolbar, .bz-edge, .bz-strip');
  }

  /** Put a board picture in the view with its centre at a screen point (a drop), at the default size. */
  placeAt(id: string, clientX: number, clientY: number): boolean {
    const item = this.board.get(id);
    if (!item || !this.isOverView(clientX, clientY)) return false;
    const r = this.layer.getBoundingClientRect();
    const v = this.viewRect();
    const def = this.defaultPlace(item);
    this.showAll = true;
    this.board.putInView(id, { x: (clientX - r.left - v.w / 2) / v.u, y: (clientY - r.top - v.h / 2) / v.u, w: def.w });
    return true;
  }

  // --- camera ---------------------------------------------------------------

  private cameraNow(): StoredCamera {
    const c = this.viewer.getCameraState();
    const p = c.position;
    const t = c.target;
    return { position: [p[0], p[1], p[2]], target: [t[0], t[1], t[2]], focalLength: c.focalLength };
  }

  private cameraSet(c: StoredCamera): void {
    this.viewer.setFocalLength(c.focalLength);
    this.viewer.setCameraState(new Vector3(...c.position), new Vector3(...c.target));
  }

  // --- drawing ------------------------------------------------------------

  private async render(): Promise<void> {
    const token = ++this.renderToken;
    const items = this.visibleItems();
    // Pictures that never had a place get their first one (a corner), once.
    for (const i of items) if (!i.place) this.board.setPlace(i.id, this.defaultPlace(i));
    const canvases = new Map<string, HTMLCanvasElement>();
    for (const i of items) {
      const c = await this.pictures.get(i);
      if (token !== this.renderToken) return;
      if (c) canvases.set(i.id, c);
    }
    this.pictures.keep(new Set(this.board.list().map((i) => i.id)));

    // The pictures: an element each, blended with what is under it (the view's canvas, and the pictures below).
    const ids = new Set<string>();
    let behind: RefItem | null = null;
    const fresh = new Set(items.map((i) => i.id));
    for (const item of this.board.inView().filter((i) => fresh.has(i.id))) {
      const canvas = canvases.get(item.id);
      if (!canvas) continue;
      if (item.blend === BEHIND) {
        behind = item; // the topmost Behind is the one drawn behind the model
        continue;
      }
      ids.add(item.id);
      let pic = this.pics.get(item.id);
      if (!pic) {
        pic = document.createElement('div');
        pic.className = 'ref-pic';
        pic.style.pointerEvents = 'none';
        this.pics.set(item.id, pic);
      }
      if (pic.firstChild !== canvas) pic.replaceChildren(canvas);
      canvas.className = 'ref-pic__canvas';
      pic.dataset.id = item.id;
      pic.dataset.blend = item.blend;
      pic.style.mixBlendMode = blendModeById(item.blend)?.css ?? DEFAULT_BLEND;
      pic.style.opacity = String(item.opacity);
      this.layer.appendChild(pic); // in order: the later is above
    }
    for (const [id, pic] of [...this.pics]) {
      if (!ids.has(id)) {
        pic.remove();
        this.pics.delete(id);
      }
    }

    if (behind) {
      this.backdropActive = true;
      this.behindCanvas = canvases.get(behind.id) ?? null;
      this.viewer.setBackdrop(this.behindCanvas, behind.opacity, this.backdropRect(behind));
    } else if (this.backdropActive) {
      this.viewer.setBackdrop(null);
      this.backdropActive = false;
      this.behindCanvas = null;
    }

    this.syncFrames(items);
    this.layout();
  }

  private behindCanvas: HTMLCanvasElement | null = null;

  private backdropRect(item: RefItem): { x: number; y: number; w: number; h: number } {
    const v = this.viewRect();
    const b = this.boxOf(item, this.placeOf(item));
    return { x: b.left / v.w, y: b.top / v.h, w: b.width / v.w, h: b.height / v.h };
  }

  /** Positions only (a drag, a resize of the view): no decoding, no rebuilding. */
  private layout(): void {
    const cr = this.viewer.captureCanvas.getBoundingClientRect();
    Object.assign(this.chrome.style, { left: `${cr.left}px`, top: `${cr.top}px`, width: `${cr.width}px`, height: `${cr.height}px` });
    const items = this.visibleItems();
    const v = this.viewRect();
    for (const item of items) {
      const b = this.boxOf(item, this.placeOf(item));
      const pic = this.pics.get(item.id);
      if (pic) {
        pic.style.left = `${b.left}px`;
        pic.style.top = `${b.top}px`;
        pic.style.width = `${b.width}px`;
        pic.style.height = `${b.height}px`;
      }
      const f = this.frames.get(item.id);
      if (!f) continue;
      f.el.style.left = `${b.left}px`;
      f.el.style.top = `${b.top}px`;
      f.el.style.width = `${b.width}px`;
      f.el.style.height = `${b.height}px`;
      // The row sits above the top edge, or inside it when there is no room above.
      const barW = FRAME_ACTIONS.length * BAR_BTN;
      const absLeft = Math.min(Math.max(b.left, 4), Math.max(4, v.w - barW - 4));
      // Nor over the tabs at the top, which stand over the view and would take a press first.
      const clear = this.tabsBottom(cr, absLeft, absLeft + barW);
      const above = b.top >= BAR_BTN + 4 + clear;
      f.bar.style.top = above ? `${-BAR_BTN - 4}px` : '4px';
      f.bar.style.left = `${absLeft - b.left}px`;
      f.bar.dataset.inside = above ? 'false' : 'true';
      // The row under the picture: centred, as wide as the picture but not narrower than it needs, kept inside the view.
      const underW = Math.max(UNDER_MIN_W, b.width);
      const wantLeft = b.left + (b.width - underW) / 2;
      const underLeft = Math.min(Math.max(wantLeft, EDGE), Math.max(EDGE, v.w - underW - EDGE));
      const room = b.top + b.height + EDGE + UNDER_H <= v.h - EDGE;
      // At the bottom edge it sits over the picture's lower edge, inside the view.
      const underTop = room ? b.top + b.height + EDGE : Math.max(EDGE, v.h - EDGE - UNDER_H);
      // The frame's own border (1px) is outside the box its children are placed in.
      f.under.style.width = `${underW}px`;
      f.under.style.left = `${underLeft - b.left - 1}px`;
      f.under.style.top = `${underTop - b.top - 1}px`;
      f.under.dataset.inside = room ? 'false' : 'true';
    }
    if (this.backdropActive && this.behindCanvas) {
      const behind = [...items].reverse().find((i) => i.blend === BEHIND);
      if (behind) this.viewer.setBackdrop(this.behindCanvas, behind.opacity, this.backdropRect(behind));
    }
  }

  /** How far down, in the view's pixels, the panel tabs reach over the view between two x positions (0 where none do). */
  private tabsBottom(view: DOMRect, x0: number, x1: number): number {
    let low = 0;
    for (const h of document.querySelectorAll<HTMLElement>('.panel > .panel__handle')) {
      const r = h.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right - view.left > x0 && r.left - view.left < x1) low = Math.max(low, r.bottom - view.top);
    }
    return Math.max(0, low);
  }

  // --- arranging ----------------------------------------------------------

  private syncFrames(items: RefItem[]): void {
    const arranging = this.board.isArranging() && this.showAll && !this.presenting;
    this.chrome.hidden = !arranging;
    const wanted = arranging ? new Set(items.map((i) => i.id)) : new Set<string>();
    for (const [id, f] of [...this.frames]) {
      if (!wanted.has(id)) {
        f.el.remove();
        this.frames.delete(id);
      }
    }
    for (const item of items) {
      if (!wanted.has(item.id)) continue;
      let f = this.frames.get(item.id);
      if (!f) {
        f = this.buildFrame(item.id);
        this.frames.set(item.id, f);
      }
      this.chrome.appendChild(f.el); // in order, so the topmost picture's frame is on top
      this.showValues(f, item);
    }
  }

  /** The picture's own values on its buttons and its lower row. */
  private showValues(f: FrameEls, item: RefItem): void {
    f.buttons.get('flip')?.setAttribute('aria-pressed', String(item.mirror));
    f.buttons.get('grey')?.setAttribute('aria-pressed', String(item.grey));
    if (f.select.value !== item.blend) f.select.value = item.blend;
    const want = Math.round(item.opacity * 100);
    // Not while a drag or a typed value is on it: that is the value being set.
    if (Number(f.opacity.value) !== want && document.activeElement !== f.opacity) setSliderValue(f.opacity, want);
  }

  private buildFrame(id: string): FrameEls {
    const el = document.createElement('div');
    el.className = 'ref-frame';
    el.dataset.id = id;
    for (const c of ['nw', 'ne', 'sw', 'se']) {
      const k = document.createElement('div');
      k.className = `ref-frame__corner ref-frame__corner--${c}`;
      k.dataset.corner = c;
      el.appendChild(k);
    }
    const bar = document.createElement('div');
    bar.className = 'ref-frame__bar';
    const buttons = new Map<string, HTMLButtonElement>();
    for (const a of FRAME_ACTIONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `ref-frame__btn ref-frame__btn--${a.id}`;
      b.dataset.tip = a.name;
      b.title = a.name;
      b.setAttribute('aria-label', a.name);
      b.innerHTML = `<i class="fi ${a.icon}" aria-hidden="true"></i>`;
      holdName(b);
      b.addEventListener('click', () => this.act(a.id, id));
      buttons.set(a.id, b);
      bar.appendChild(b);
    }
    el.appendChild(bar);

    // Under the picture: the blend mode and Opacity.
    const under = document.createElement('div');
    under.className = 'ref-frame__under';
    const select = blendSelect(CSS_BLEND_MODES, DEFAULT_BLEND, [[BEHIND, 'Behind the model']]);
    select.className = 'ref-frame__blend';
    select.setAttribute('aria-label', 'Blend mode');
    select.addEventListener('change', () => this.board.setLook(id, { blend: select.value }));
    const slider = compactRange('Opacity', 0, 100, 1, 100, (v) => this.board.setLook(id, { opacity: v / 100 }), { unit: ' %', limits: { min: 0, max: 100 } });
    slider.classList.add('ref-frame__opacity');
    const opacity = slider.querySelector('input[type=range]') as HTMLInputElement;
    under.append(select, slider);
    el.appendChild(under);
    bindFrame(el, id, this);
    return { el, bar, buttons, under, select, opacity };
  }

  private act(action: (typeof FRAME_ACTIONS)[number]['id'], id: string): void {
    const item = this.board.get(id);
    if (!item) return;
    switch (action) {
      case 'lock':
        this.board.setArranging(false);
        break;
      case 'fit':
        this.board.setPlace(id, this.fitPlace(item));
        break;
      case 'flip':
        this.board.setLook(id, { mirror: !item.mirror });
        break;
      case 'grey':
        this.board.setLook(id, { grey: !item.grey });
        break;
      case 'remove':
        this.board.takeOut(id);
        break;
    }
  }

  // --- what a frame's drags ask for -----------------------------------------

  /** @internal Used by the frame's pointer handling. */
  frameState(id: string): { item: RefItem; place: Placement; box: Box; view: { w: number; h: number; u: number } } | null {
    const item = this.board.get(id);
    if (!item) return null;
    const place = this.placeOf(item);
    return { item, place, box: this.boxOf(item, place), view: this.viewRect() };
  }

  /** @internal Move or size, kept within the view. */
  setPlace(id: string, place: Placement): void {
    const v = this.viewRect();
    const w = Math.min(MAX_W, Math.max(MIN_W, place.w));
    const x = Math.min(v.w / 2 / v.u, Math.max(-v.w / 2 / v.u, place.x));
    const y = Math.min(v.h / 2 / v.u, Math.max(-v.h / 2 / v.u, place.y));
    this.board.setPlace(id, { x, y, w });
  }

  dispose(): void {
    this.offBoard();
    this.offPlace();
    window.removeEventListener('bozzetto:present', this.onPresent);
    this.ro?.disconnect();
    if (this.backdropActive) this.viewer.setBackdrop(null);
    this.layer.remove();
    this.chrome.remove();
    this.pictures.reset();
  }
}

function readShow(): boolean {
  try {
    return deviceStore.get(SHOW_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** A long press on a button shows its name (hover does, with a mouse). */
function holdName(btn: HTMLButtonElement): void {
  let timer = 0;
  const clear = (): void => {
    window.clearTimeout(timer);
    btn.classList.remove('ref-frame__btn--tip');
  };
  btn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    timer = window.setTimeout(() => btn.classList.add('ref-frame__btn--tip'), 450);
  });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(t, () => window.setTimeout(clear, t === 'pointerup' ? 900 : 0));
}

/**
 * Move (one pointer: a finger, the mouse or the Pencil), scale (two
 * pointers, or the wheel) and resize (a corner) one picture while
 * arranging. The frame is the only thing here that takes a pointer.
 */
function bindFrame(el: HTMLElement, id: string, view: ReferenceView): void {
  const pointers = new Map<number, { x: number; y: number }>();
  let move: { id: number; dx: number; dy: number } | null = null;
  let resize: { id: number; corner: string; ax: number; ay: number } | null = null;
  let pinch: { dist: number; w: number; fx: number; fy: number } | null = null;
  const root = (): { left: number; top: number } => {
    const r = (el.parentElement as HTMLElement).getBoundingClientRect();
    return { left: r.left, top: r.top };
  };
  const startPinch = (): void => {
    const st = view.frameState(id);
    if (pointers.size === 2 && st) {
      const [a, b] = [...pointers.values()];
      const o = root();
      const mx = (a.x + b.x) / 2 - o.left;
      const my = (a.y + b.y) / 2 - o.top;
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, w: st.box.width, fx: (mx - st.box.left) / st.box.width, fy: (my - st.box.top) / st.box.width };
      move = null;
      resize = null;
    } else {
      pinch = null;
    }
  };
  const put = (left: number, top: number, width: number): void => {
    const st = view.frameState(id);
    if (!st) return;
    const height = width * (st.item.height / st.item.width);
    const v = st.view;
    view.setPlace(id, { x: (left + width / 2 - v.w / 2) / v.u, y: (top + height / 2 - v.h / 2) / v.u, w: width / v.u });
  };
  // No callout, scroll or zoom from a finger on the picture. Not on its row
  // of buttons or the row under it, which sit inside the frame: a cancelled
  // touchstart there means no click follows, and the buttons did nothing
  // under a finger or the Pencil.
  el.addEventListener(
    'touchstart',
    (e) => {
      if ((e.target as Element).closest('.ref-frame__bar, .ref-frame__under')) return;
      e.preventDefault();
    },
    { passive: false },
  );
  el.addEventListener('pointerdown', (e) => {
    const target = e.target as Element;
    if (target.closest('.ref-frame__bar, .ref-frame__under')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer has nothing to capture.
    }
    const o = root();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const st = view.frameState(id);
    if (!st) return;
    const corner = (target.closest('.ref-frame__corner') as HTMLElement | null)?.dataset.corner;
    if (pointers.size === 1 && corner) {
      // The opposite corner stays where it is.
      const b = st.box;
      resize = { id: e.pointerId, corner, ax: corner.includes('w') ? b.left + b.width : b.left, ay: corner.includes('n') ? b.top + b.height : b.top };
      move = null;
    } else if (pointers.size === 1) {
      move = { id: e.pointerId, dx: e.clientX - o.left - st.box.left, dy: e.clientY - o.top - st.box.top };
    }
    startPinch();
  });
  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const o = root();
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const w = (pinch.w * (Math.hypot(a.x - b.x, a.y - b.y) || 1)) / pinch.dist;
      const mx = (a.x + b.x) / 2 - o.left;
      const my = (a.y + b.y) / 2 - o.top;
      put(mx - pinch.fx * w, my - pinch.fy * w, w);
    } else if (resize && e.pointerId === resize.id) {
      const st = view.frameState(id);
      if (!st) return;
      const px = e.clientX - o.left;
      const w = Math.max(24, Math.abs(px - resize.ax));
      const h = w * (st.item.height / st.item.width);
      put(resize.corner.includes('w') ? resize.ax - w : resize.ax, resize.corner.includes('n') ? resize.ay - h : resize.ay, w);
    } else if (move && e.pointerId === move.id) {
      const st = view.frameState(id);
      if (!st) return;
      put(e.clientX - o.left - move.dx, e.clientY - o.top - move.dy, st.box.width);
    }
  });
  const up = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (move?.id === e.pointerId) move = null;
    if (resize?.id === e.pointerId) resize = null;
    startPinch();
    // One finger left of a pinch carries on as a drag from where it is.
    if (pointers.size === 1 && !move && !resize) {
      const st = view.frameState(id);
      const [[pid, p]] = [...pointers.entries()];
      const o = root();
      if (st) move = { id: pid, dx: p.x - o.left - st.box.left, dy: p.y - o.top - st.box.top };
    }
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener(
    'wheel',
    (e) => {
      if ((e.target as Element).closest('.ref-frame__under')) return;
      e.preventDefault();
      const st = view.frameState(id);
      if (!st) return;
      const o = root();
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      const px = e.clientX - o.left;
      const py = e.clientY - o.top;
      put(px - (px - st.box.left) * k, py - (py - st.box.top) * k, st.box.width * k);
    },
    { passive: false },
  );
}
