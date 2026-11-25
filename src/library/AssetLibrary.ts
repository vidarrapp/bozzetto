import './library.css';
import '../ui/icons';
import { deviceStore } from '../ui/deviceStorage';

/**
 * The Asset library window (step 3 of docs/plans/asset-library.md).
 *
 * One floating window over the view that stays open while you work: no
 * backdrop, the view under it stays live, and only presses that start on
 * the window are its own. It is dragged by its title row, resized from the
 * lower right corner, kept inside the view, and it keeps its place, size and
 * last tab on this device. The Studio shell owns the one of a page, so every
 * workspace can open it.
 *
 * Five tabs, always there. What a tab shows is a view registered for it
 * (`register`): the window draws the frame (the tabs, where from, search,
 * the foot) and the tab's body is the view's, built on first need. A tab
 * with no view says, quietly, that it comes in a later version.
 */

export type LibraryTabId = 'tools' | 'models' | 'materials' | 'lighting' | 'hdris';
/** Where an asset comes from. The Community comes with a later step. */
export type LibraryWhere = 'bozzetto' | 'mine';

/** What the window tells a view, and lets it say in the foot. */
export interface LibraryContext {
  where(): LibraryWhere;
  /** What the Search field holds, trimmed and in lower case. */
  query(): string;
  /** A line in the window's foot (a status), gone by itself after a few seconds. */
  say(text: string): void;
}

/** What a tab's contents are made of. A later package adds a tab by registering one of these, not by editing the window. */
export interface LibraryView {
  /** Build the tab's body once, when the tab is first shown. */
  mount(body: HTMLElement, ctx: LibraryContext): void;
  /** The tab is showing, or what it shows changed (where from, the search, the workspace, the work). */
  refresh(): void;
  dispose(): void;
}

const TABS: ReadonlyArray<{ id: LibraryTabId; label: string; later: string }> = [
  { id: 'tools', label: 'Tools', later: 'Tools come to the library in a later version.' },
  { id: 'models', label: 'Models', later: 'Models come to the library in a later version.' },
  { id: 'materials', label: 'Materials', later: 'Materials come to the library in a later version.' },
  { id: 'lighting', label: 'Lighting', later: 'Light rigs come to the library in a later version.' },
  { id: 'hdris', label: 'HDRIs', later: 'HDRIs come to the library in a later version.' },
];

const WHERES: ReadonlyArray<{ id: LibraryWhere; label: string }> = [
  { id: 'bozzetto', label: 'Library' },
  { id: 'mine', label: 'Mine' },
];

/** localStorage, through deviceStore: `{ v: 1, x, y, w, h, tab }`. */
export const LIBRARY_KEY = 'bozzetto-library';
const DEFAULT_W = 420;
const DEFAULT_H = 480;
const MIN_W = 340;
const MIN_H = 300;
/** The foot's line goes by itself after this long. */
const SAY_MS = 6000;
/** Kept this far from the edges of the view when it is placed or the page is resized. */
const MARGIN = 8;

interface Place {
  x: number;
  y: number;
  w: number;
  h: number;
}

const tabIds = new Set<string>(TABS.map((t) => t.id));

export class AssetLibrary {
  readonly el: HTMLDivElement;
  private readonly tabBtns = new Map<LibraryTabId, HTMLButtonElement>();
  private readonly whereBtns = new Map<LibraryWhere, HTMLButtonElement>();
  private readonly from: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly bodies = new Map<LibraryTabId, HTMLDivElement>();
  private readonly later = new Map<LibraryTabId, HTMLDivElement>();
  private readonly views = new Map<LibraryTabId, LibraryView>();
  private readonly mounted = new Set<LibraryTabId>();
  private readonly foot: HTMLDivElement;
  private footTimer = 0;
  private tab: LibraryTabId = 'tools';
  private whereNow: LibraryWhere = 'bozzetto';
  private place: Place;
  private opened = false;
  private readonly listeners = new Set<(open: boolean) => void>();
  private disposed = false;
  private readonly ctx: LibraryContext = {
    where: () => this.whereNow,
    query: () => this.search.value.trim().toLowerCase(),
    say: (text) => this.say(text),
  };

  constructor() {
    this.place = this.initialPlace();
    const root = document.createElement('div');
    root.className = 'lib-window';
    root.dataset.role = 'asset-library';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Asset library');
    root.tabIndex = -1;
    root.hidden = true;
    this.el = root;

    // The title row: the window's handle, and its close button.
    const title = document.createElement('div');
    title.className = 'lib-title';
    title.dataset.role = 'asset-library-title';
    const name = document.createElement('span');
    name.className = 'lib-title__name';
    name.textContent = 'Asset library';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'lib-close';
    close.dataset.role = 'asset-library-close';
    close.setAttribute('aria-label', 'Close');
    const x = document.createElement('i');
    x.className = 'fi fi-ss-cross-small';
    x.setAttribute('aria-hidden', 'true');
    close.appendChild(x);
    close.addEventListener('click', () => this.close());
    title.append(name, close);

    // The tabs.
    const tabs = document.createElement('div');
    tabs.className = 'lib-tabs';
    tabs.setAttribute('role', 'tablist');
    for (const t of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lib-tab';
      b.dataset.tab = t.id;
      b.setAttribute('role', 'tab');
      b.textContent = t.label;
      b.addEventListener('click', () => this.show(t.id));
      tabs.appendChild(b);
      this.tabBtns.set(t.id, b);
    }

    // Where from, and the search; the Community's button will stand after Mine.
    const from = document.createElement('div');
    from.className = 'lib-from';
    const wheres = document.createElement('div');
    wheres.className = 'lib-wheres';
    wheres.setAttribute('role', 'group');
    wheres.setAttribute('aria-label', 'Where from');
    for (const w of WHERES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lib-where';
      b.dataset.where = w.id;
      b.textContent = this.whereLabel(w.id);
      b.addEventListener('click', () => this.setWhere(w.id));
      wheres.appendChild(b);
      this.whereBtns.set(w.id, b);
    }
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'lib-search';
    search.placeholder = 'Search';
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.setAttribute('aria-label', 'Search the library');
    search.addEventListener('input', () => this.refreshView());
    from.append(wheres, search);
    this.from = from;
    this.search = search;

    // The body of each tab, and the line a tab with no view says.
    const bodies = document.createElement('div');
    bodies.className = 'lib-bodies';
    for (const t of TABS) {
      const body = document.createElement('div');
      body.className = 'lib-body';
      body.dataset.tab = t.id;
      body.setAttribute('role', 'tabpanel');
      body.hidden = true;
      const later = document.createElement('p');
      later.className = 'lib-later';
      later.textContent = t.later;
      body.appendChild(later);
      bodies.appendChild(body);
      this.bodies.set(t.id, body);
      this.later.set(t.id, later);
    }

    const foot = document.createElement('div');
    foot.className = 'lib-foot';
    foot.setAttribute('role', 'status');
    foot.setAttribute('aria-live', 'polite');
    this.foot = foot;

    const grip = document.createElement('div');
    grip.className = 'lib-grip';
    grip.dataset.role = 'asset-library-grip';
    grip.setAttribute('aria-hidden', 'true');

    root.append(title, tabs, from, bodies, foot, grip);
    this.readPlace();
    this.applyPlace();
    this.paintTab();

    title.addEventListener('pointerdown', (e) => this.beginDrag(e, 'move'));
    grip.addEventListener('pointerdown', (e) => this.beginDrag(e, 'size'));
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey, true);
  }

  // --- views ---------------------------------------------------------------------------------

  /** Give a tab its contents. The tab shows them from its next showing; a view that is already up is let go. */
  register(tab: LibraryTabId, view: LibraryView): void {
    this.views.get(tab)?.dispose();
    this.views.set(tab, view);
    this.mounted.delete(tab);
    this.paintTab();
    if (this.opened && tab === this.tab) this.mountView(tab);
  }

  private mountView(tab: LibraryTabId): void {
    const view = this.views.get(tab);
    const body = this.bodies.get(tab);
    if (!view || !body || this.mounted.has(tab)) return;
    this.mounted.add(tab);
    this.later.get(tab)?.remove();
    view.mount(body, this.ctx);
  }

  // --- opening and closing ---------------------------------------------------------------------

  isOpen(): boolean {
    return this.opened;
  }

  /** Hear the window open and close. */
  onOpenChange(fn: (open: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Show the window, on a tab if one is asked for (else the last one), with the focus inside it. */
  open(tab?: LibraryTabId): void {
    if (this.disposed) return;
    if (!this.el.isConnected) document.body.appendChild(this.el);
    if (tab) this.tab = tab;
    const was = this.opened;
    this.opened = true;
    this.el.hidden = false;
    // Where the window was left may not fit a view that has been resized since.
    this.fit();
    this.paintTab();
    this.mountView(this.tab);
    this.refreshView();
    if (!was) {
      this.el.focus({ preventScroll: true });
      for (const fn of [...this.listeners]) fn(true);
    }
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.endDrag();
    const hadFocus = this.el.contains(document.activeElement);
    this.el.hidden = true;
    if (hadFocus && document.activeElement instanceof HTMLElement) document.activeElement.blur();
    for (const fn of [...this.listeners]) fn(false);
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.open();
  }

  /** The workspace or the work changed: what the tab in front shows is read again. */
  refresh(): void {
    if (this.opened) this.refreshView();
  }

  currentTab(): LibraryTabId {
    return this.tab;
  }

  /** Esc closes the window when the focus is inside it (a menu open from it takes the Esc first). */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.opened || e.key !== 'Escape' || e.defaultPrevented) return;
    // A lifted tool takes the Esc first (it goes back).
    if (document.body.classList.contains('bz-dock-lifted')) return;
    if (!this.el.contains(document.activeElement)) return;
    if (document.querySelector('[data-role="tile-menu"]')) return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  // --- tabs, where from, search -----------------------------------------------------------------

  private show(tab: LibraryTabId): void {
    if (tab === this.tab && this.mounted.has(tab)) return;
    this.tab = tab;
    this.paintTab();
    this.mountView(tab);
    this.refreshView();
    this.keepPlace();
  }

  private setWhere(where: LibraryWhere): void {
    if (where === this.whereNow) return;
    this.whereNow = where;
    this.paintTab();
    this.refreshView();
  }

  /** The second button is Scene on the Materials tab (the scene's own materials), Mine elsewhere. */
  private whereLabel(id: LibraryWhere): string {
    if (id === 'bozzetto') return 'Library';
    return this.tab === 'materials' ? 'Scene' : 'Mine';
  }

  private paintTab(): void {
    for (const [id, b] of this.tabBtns) {
      const on = id === this.tab;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const [id, body] of this.bodies) body.hidden = id !== this.tab;
    for (const [id, b] of this.whereBtns) {
      b.textContent = this.whereLabel(id);
      b.classList.toggle('is-on', id === this.whereNow);
      b.setAttribute('aria-pressed', String(id === this.whereNow));
    }
    // Where from and the search stand where there is something to choose from.
    this.from.hidden = !this.views.has(this.tab);
    this.el.dataset.tab = this.tab;
  }

  private refreshView(): void {
    this.views.get(this.tab)?.refresh();
  }

  private say(text: string): void {
    window.clearTimeout(this.footTimer);
    this.foot.textContent = text;
    if (text) this.footTimer = window.setTimeout(() => (this.foot.textContent = ''), SAY_MS);
  }

  // --- place and size ---------------------------------------------------------------------------

  /** About 420 by 480 and right of centre, under the strip and clear of the tool bar and the edge column. */
  private initialPlace(): Place {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(DEFAULT_W, Math.max(MIN_W, vw - 2 * MARGIN));
    const h = Math.min(DEFAULT_H, Math.max(MIN_H, vh - 2 * MARGIN));
    return { x: Math.round(vw / 2 + 24), y: 64, w, h };
  }

  private readPlace(): void {
    try {
      const raw = deviceStore.get(LIBRARY_KEY);
      if (!raw) return;
      const rec = JSON.parse(raw) as Record<string, unknown>;
      if (!rec || typeof rec !== 'object' || rec.v !== 1) return;
      const n = (k: string): number | null => (typeof rec[k] === 'number' && Number.isFinite(rec[k]) ? (rec[k] as number) : null);
      const x = n('x');
      const y = n('y');
      const w = n('w');
      const h = n('h');
      if (x !== null && y !== null && w !== null && h !== null) this.place = { x, y, w, h };
      if (typeof rec.tab === 'string' && tabIds.has(rec.tab)) this.tab = rec.tab as LibraryTabId;
    } catch {
      // A corrupt or blocked store: the default place stands.
    }
    this.place = this.clamp(this.place);
  }

  private keepPlace(): void {
    try {
      deviceStore.set(LIBRARY_KEY, JSON.stringify({ v: 1, x: Math.round(this.place.x), y: Math.round(this.place.y), w: Math.round(this.place.w), h: Math.round(this.place.h), tab: this.tab }));
    } catch {
      // Saving is off: the place holds for this visit.
    }
  }

  /** The top the window may have: under the title strip. */
  private minTop(): number {
    const strip = document.querySelector<HTMLElement>('.bz-strip');
    return Math.max(MARGIN, strip ? Math.round(strip.getBoundingClientRect().bottom) + 4 : 32);
  }

  /** A place made to fit the view: no smaller than the least, no larger than the view, wholly inside it. */
  private clamp(p: Place, top = this.minTop()): Place {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.round(Math.min(Math.max(p.w, MIN_W), Math.max(MIN_W, vw - 2 * MARGIN)));
    const h = Math.round(Math.min(Math.max(p.h, MIN_H), Math.max(MIN_H, vh - top - MARGIN)));
    const x = Math.round(Math.min(Math.max(p.x, MARGIN), Math.max(MARGIN, vw - w - MARGIN)));
    const y = Math.round(Math.min(Math.max(p.y, top), Math.max(top, vh - h - MARGIN)));
    return { x, y, w, h };
  }

  private applyPlace(): void {
    const s = this.el.style;
    s.left = `${this.place.x}px`;
    s.top = `${this.place.y}px`;
    s.width = `${this.place.w}px`;
    s.height = `${this.place.h}px`;
  }

  /** Put the window back inside the view (the page was resized, or the window opened after it was). */
  private fit(): void {
    const next = this.clamp(this.place);
    if (next.x === this.place.x && next.y === this.place.y && next.w === this.place.w && next.h === this.place.h) return;
    this.place = next;
    this.applyPlace();
  }

  private readonly onResize = (): void => {
    if (this.opened) this.fit();
  };

  // --- dragging and resizing --------------------------------------------------------------------

  private drag: { pointerId: number; mode: 'move' | 'size'; dx: number; dy: number; top: number; stop: () => void } | null = null;

  /**
   * A press on the title row moves the window, one on the corner resizes it:
   * mouse, finger and Pencil alike. The pointer is followed on the page, not
   * captured (Safari cancels a captured touch when a second one lands), and
   * the window is written once a frame.
   */
  private beginDrag(e: PointerEvent, mode: 'move' | 'size'): void {
    if (e.button !== 0 || !e.isPrimary || this.drag) return;
    if (mode === 'move' && (e.target as HTMLElement).closest('.lib-close')) return;
    e.preventDefault();
    const top = this.minTop();
    const pointerId = e.pointerId;
    // Where the press is inside the window (move), or inside the corner (size).
    const dx = mode === 'move' ? e.clientX - this.place.x : this.place.x + this.place.w - e.clientX;
    const dy = mode === 'move' ? e.clientY - this.place.y : this.place.y + this.place.h - e.clientY;
    let raf = 0;
    let lastX = e.clientX;
    let lastY = e.clientY;
    const apply = (): void => {
      raf = 0;
      const p = { ...this.place };
      if (mode === 'move') {
        p.x = lastX - dx;
        p.y = lastY - dy;
      } else {
        p.w = lastX + dx - p.x;
        p.h = lastY + dy - p.y;
      }
      this.place = this.clamp(p, top);
      this.applyPlace();
    };
    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onEnd = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return;
      if (ev.type === 'pointerup') {
        lastX = ev.clientX;
        lastY = ev.clientY;
      }
      this.endDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd, true);
    window.addEventListener('pointercancel', onEnd, true);
    this.el.classList.add('is-dragging');
    this.drag = {
      pointerId,
      mode,
      dx,
      dy,
      top,
      stop: () => {
        if (raf) {
          cancelAnimationFrame(raf);
          apply();
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd, true);
        window.removeEventListener('pointercancel', onEnd, true);
      },
    };
  }

  private endDrag(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.stop();
    this.el.classList.remove('is-dragging');
    this.keepPlace();
  }

  dispose(): void {
    if (this.disposed) return;
    this.endDrag();
    this.disposed = true;
    window.clearTimeout(this.footTimer);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey, true);
    for (const v of this.views.values()) v.dispose();
    this.views.clear();
    this.el.remove();
    this.listeners.clear();
  }
}
