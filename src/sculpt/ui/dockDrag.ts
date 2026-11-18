/**
 * The dock: lift a tool off the tool bar and put it somewhere else on it.
 *
 * A press on a tool's tile is one of four things. A tap picks the tool (the
 * tile's own onTap). A long press (Pencil or finger: LONG_PRESS_MS, the
 * mouse too) lifts it. A mouse that moves 4px lifts it at once. A press
 * that moves more than 8px before the long press, with a finger or the
 * Pencil, is a slip: neither a tap nor a lift.
 *
 * The lifted tile is a ghost that follows the pointer, a little larger than
 * the tile, with the tool's name above it; its place stays as a gap. Moving
 * along the bar opens the gap at the insertion point and the other tiles
 * slide aside, their badges showing the digits they will have. Letting go
 * on the bar puts the tool there; letting go anywhere else, Esc, a cancelled
 * pointer, the window losing focus and a second pointer going down put the
 * ghost back and change nothing.
 *
 * The mechanics are the Negative button's (SculptToolbar): the events' own
 * timestamps decide what a press was, touchstart is cancelled by the tile's
 * onTap so iOS shows no callout, and nothing captures the pointer (Safari
 * cancels a captured touch when a second one lands). While moving nothing
 * is built, and no layout is read: the tile centres are read once at the
 * lift, the ghost moves by transform once a frame, and a tile shifts by
 * transform only when the insertion point changes.
 */
import { eventTime, LONG_PRESS_MS } from '../../ui/dom';
import { toolBars } from '../tools/bars';
import type { Workspace } from '../tools/registry';

/** A mouse lifts after this much movement. */
const MOUSE_LIFT_PX = 4;
/** A finger or the Pencil that moves this much before the long press has slipped. */
const SLIP_PX = 8;
/** The ghost rides this far above a finger, so the finger does not cover it. */
const FINGER_LIFT_PX = 48;
/** The bar's zone for a drop reaches this far above the bar and past its ends. */
const ZONE_ABOVE_PX = 56;
const ZONE_SIDE_PX = 24;
/** A neighbouring slot must be this much nearer to take the gap, so it does not flicker on the line between two. */
const HYSTERESIS_PX = 8;
/** The slide of the others, the ghost's flight home, in ms. */
const MOVE_MS = 140;

/** What the dock needs of the tool bar it sits on. */
export interface DockHost {
  /** The bar's own box, whose rectangle is the drop zone. */
  bar(): HTMLElement;
  workspace(): Workspace;
  /** The button of a tool on the bar. */
  tile(id: string): HTMLButtonElement | undefined;
  /** A stroke is under way: nothing lifts. */
  isStroking(): boolean;
  /** The name shown above a lifted tile. */
  nameOf(id: string): string;
  /** Badges and tips as if the bar were in this order; null puts the real ones back. */
  previewOrder(ids: readonly string[] | null): void;
}

/** What letting go means. A third outcome, taking the tool off the bar, comes with the library. */
export type DropOutcome = { kind: 'move'; index: number } | { kind: 'back' };

interface Press {
  pointerId: number;
  type: string;
  id: string;
  startX: number;
  startY: number;
  downAt: number;
  timer: number;
}

interface Lift {
  pointerId: number;
  type: string;
  id: string;
  downAt: number;
  /** The lift came from the press timing out, not from a mouse's drag: a lift that ends before the time was a tap. */
  byTime: boolean;
  moved: boolean;
  ids: string[];
  tiles: HTMLButtonElement[];
  /** The centre of each place, read once at the lift. */
  centres: number[];
  midY: number;
  zone: { left: number; right: number; top: number };
  from: number;
  target: number;
  x: number;
  y: number;
  ghost: HTMLElement;
  raf: number;
}

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export class Dock {
  /** The last press was a lift or a slip: its lift and its click are not taps. Cleared by the next press. */
  swallowing = false;
  private press: Press | null = null;
  private lift: Lift | null = null;

  constructor(private readonly host: DockHost) {
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp, true);
    window.addEventListener('pointercancel', this.onCancel, true);
    window.addEventListener('pointerdown', this.onOtherDown, true);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('keydown', this.onKey, true);
  }

  /** Whether a tool is in hand of the dock (lifted). */
  get lifted(): boolean {
    return this.lift !== null;
  }

  /** The pointerdown on a tile that may be lifted. */
  begin(e: PointerEvent, id: string): void {
    if (e.button !== 0 || !e.isPrimary) return;
    this.swallowing = false;
    if (this.press || this.lift) return;
    if (this.host.isStroking()) return;
    this.press = { pointerId: e.pointerId, type: e.pointerType, id, startX: e.clientX, startY: e.clientY, downAt: eventTime(e), timer: window.setTimeout(this.onHeld, LONG_PRESS_MS) };
  }

  /** The timer ran out with the press still down: the long press lifts. */
  private readonly onHeld = (): void => {
    const p = this.press;
    if (!p) return;
    p.timer = 0;
    this.press = null;
    this.raise(p, p.startX, p.startY, true);
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.press;
    if (p && e.pointerId === p.pointerId) {
      const d = Math.hypot(e.clientX - p.startX, e.clientY - p.startY);
      if (p.type === 'mouse') {
        if (d >= MOUSE_LIFT_PX) {
          clearTimeout(p.timer);
          this.press = null;
          this.raise(p, e.clientX, e.clientY, false);
        }
      } else if (d > SLIP_PX) {
        // A slip: neither a tap nor a lift.
        clearTimeout(p.timer);
        this.press = null;
        this.swallowing = true;
      }
      return;
    }
    const l = this.lift;
    if (!l || e.pointerId !== l.pointerId) return;
    l.moved = true;
    this.track(l, e.clientX, e.clientY);
  };

  private readonly onUp = (e: PointerEvent): void => {
    const p = this.press;
    if (p && e.pointerId === p.pointerId) {
      // Let go before the time: a tap, for the tile to take.
      clearTimeout(p.timer);
      this.press = null;
      return;
    }
    const l = this.lift;
    if (!l || e.pointerId !== l.pointerId) return;
    // The timer got there first on a busy page, but by the events' own times this was a tap all along.
    if (l.byTime && !l.moved && eventTime(e) - l.downAt < LONG_PRESS_MS) {
      this.settle(l, false);
      this.swallowing = false;
      return;
    }
    this.swallowing = true;
    this.track(l, e.clientX, e.clientY);
    const outcome = this.resolve(l);
    if (outcome.kind === 'move' && outcome.index !== l.from) this.drop(l);
    else this.settle(l, true);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    const p = this.press;
    if (p && e.pointerId === p.pointerId) {
      // As Negative counts it: the OS ending a press early does not make it a lift.
      clearTimeout(p.timer);
      this.press = null;
      return;
    }
    const l = this.lift;
    if (l && e.pointerId === l.pointerId) {
      this.swallowing = true;
      this.settle(l, true);
    }
  };

  /** A second pointer going down (a finger beside the Pencil) cancels what is held or lifted. */
  private readonly onOtherDown = (e: PointerEvent): void => {
    if (this.press && e.pointerId !== this.press.pointerId) {
      clearTimeout(this.press.timer);
      this.press = null;
      this.swallowing = true;
    }
    if (this.lift && e.pointerId !== this.lift.pointerId) {
      this.swallowing = true;
      this.settle(this.lift, true);
    }
  };

  private readonly onBlur = (): void => {
    if (this.press) {
      clearTimeout(this.press.timer);
      this.press = null;
    }
    if (this.lift) this.settle(this.lift, true);
  };

  /** While a tool is lifted the keys are the dock's: Esc puts it back, the rest wait. */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.lift) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.key === 'Escape') this.settle(this.lift, true);
  };

  /** What letting go here would do. */
  private resolve(l: Lift): DropOutcome {
    return this.inZone(l) ? { kind: 'move', index: l.target } : { kind: 'back' };
  }

  private inZone(l: Lift): boolean {
    return l.x >= l.zone.left && l.x <= l.zone.right && l.y >= l.zone.top;
  }

  /** Take the tile in hand: the ghost, the gap, every digit showing. */
  private raise(p: Press, x: number, y: number, byTime: boolean): void {
    if (this.host.isStroking()) return;
    const ws = this.host.workspace();
    const ids = [...toolBars.order(ws)];
    const tiles: HTMLButtonElement[] = [];
    for (const id of ids) {
      const t = this.host.tile(id);
      if (!t) return;
      tiles.push(t);
    }
    const from = ids.indexOf(p.id);
    if (from < 0) return;
    // The one read of the layout: where each place is.
    const rects = tiles.map((t) => t.getBoundingClientRect());
    const bar = this.host.bar().getBoundingClientRect();
    const ghost = this.makeGhost(tiles[from], this.host.nameOf(p.id));
    const l: Lift = {
      pointerId: p.pointerId,
      type: p.type,
      id: p.id,
      downAt: p.downAt,
      byTime,
      moved: false,
      ids,
      tiles,
      centres: rects.map((r) => r.left + r.width / 2),
      midY: rects[from].top + rects[from].height / 2,
      zone: { left: bar.left - ZONE_SIDE_PX, right: bar.right + ZONE_SIDE_PX, top: bar.top - ZONE_ABOVE_PX },
      from,
      target: from,
      x,
      y,
      ghost,
      raf: 0,
    };
    this.lift = l;
    this.swallowing = true;
    toolBars.lifted = true;
    document.body.classList.add('bz-dock-lifted');
    this.host.bar().classList.add('dock-active');
    tiles[from].classList.add('dock-gap');
    document.body.appendChild(ghost);
    this.place(l);
    // The ghost grows to its size on the next frame, so the growth is seen.
    requestAnimationFrame(() => ghost.classList.add('dock-ghost--up'));
    this.host.previewOrder(ids);
  }

  /** The ghost: the tile's icon at a larger size, the tool's name above it. */
  private makeGhost(tile: HTMLElement, name: string): HTMLElement {
    const g = document.createElement('div');
    g.className = 'dock-ghost';
    g.setAttribute('aria-hidden', 'true');
    if (tile.classList.contains('sculpt-toolbar__btn--active')) g.classList.add('dock-ghost--on');
    const nameEl = document.createElement('div');
    nameEl.className = 'dock-ghost__name';
    nameEl.textContent = name;
    const face = document.createElement('div');
    face.className = 'dock-ghost__tile';
    const icon = tile.querySelector('.fi, .sculpt-toolbar__svg');
    if (icon) face.appendChild(icon.cloneNode(true));
    g.append(nameEl, face);
    return g;
  }

  /** The pointer moved: the ghost follows on the next frame, and the gap moves if the insertion point did. */
  private track(l: Lift, x: number, y: number): void {
    l.x = x;
    l.y = y;
    if (!l.raf) {
      l.raf = requestAnimationFrame(() => {
        l.raf = 0;
        if (this.lift === l) this.place(l);
      });
    }
    const target = this.targetFor(l);
    if (target !== l.target) {
      l.target = target;
      this.shift(l);
    }
  }

  private place(l: Lift): void {
    const lift = l.type === 'touch' ? FINGER_LIFT_PX : 0;
    l.ghost.style.transform = `translate3d(${l.x}px, ${l.y - lift}px, 0)`;
  }

  /**
   * The place the gap is at: the one whose centre is nearest the pointer,
   * and a different one only once it is HYSTERESIS_PX nearer than the one it
   * has. Off the bar, the gap goes back to where the tool came from.
   */
  private targetFor(l: Lift): number {
    if (!this.inZone(l)) return l.from;
    let best = l.target;
    let bestD = Math.abs(l.x - l.centres[best]);
    for (let i = 0; i < l.centres.length; i++) {
      const d = Math.abs(l.x - l.centres[i]);
      if (d + HYSTERESIS_PX < bestD) {
        best = i;
        bestD = d;
      }
    }
    return best;
  }

  /** The order the bar would have if the tool were put at the gap. */
  private previewIds(l: Lift): string[] {
    const out = l.ids.filter((id) => id !== l.id);
    out.splice(l.target, 0, l.id);
    return out;
  }

  /** Slide the others aside, by transform, and show the digits they will have. */
  private shift(l: Lift): void {
    const order = this.previewIds(l);
    for (let i = 0; i < l.ids.length; i++) {
      if (i === l.from) continue;
      const slot = order.indexOf(l.ids[i]);
      const dx = l.centres[slot] - l.centres[i];
      l.tiles[i].style.transform = dx ? `translate3d(${dx}px, 0, 0)` : '';
    }
    this.host.previewOrder(order);
  }

  /** Letting go on the bar: the tool goes to the gap. */
  private drop(l: Lift): void {
    const order = this.previewIds(l);
    // The ghost flies into the gap, then the order is put in place: the tool stays in hand, no notice.
    this.fly(l, l.centres[l.target], l.midY, () => {
      this.clear(l, true);
      toolBars.set(this.host.workspace(), order);
    });
  }

  /**
   * Put the ghost back and change nothing (`flyBack`), or, for a lift that
   * was a tap, drop it where it is.
   */
  private settle(l: Lift, flyBack: boolean): void {
    if (this.lift !== l) return;
    if (!flyBack) {
      this.clear(l, false);
      return;
    }
    // The others return to their places as the ghost flies back to its own.
    l.target = l.from;
    this.shift(l);
    this.fly(l, l.centres[l.from], l.midY, () => this.clear(l, false));
  }

  private fly(l: Lift, x: number, y: number, done: () => void): void {
    // From here the lift is over: nothing follows the pointer, the keys are free again.
    cancelAnimationFrame(l.raf);
    l.raf = 0;
    toolBars.lifted = false;
    l.ghost.classList.add('dock-ghost--home');
    l.ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    this.landing = l;
    window.setTimeout(() => {
      done();
      this.landing = null;
    }, reducedMotion() ? 0 : MOVE_MS + 10);
    this.lift = null;
  }

  /** The lift that is flying to its place, so a fast new press waits for it. */
  private landing: Lift | null = null;

  /** Everything the lift put on the page comes off. `keepOrder`: the caller sets the new order right after. */
  private clear(l: Lift, keepOrder: boolean): void {
    l.ghost.remove();
    for (const t of l.tiles) {
      t.style.transform = '';
      t.classList.remove('dock-gap');
    }
    this.host.bar().classList.remove('dock-active');
    document.body.classList.remove('bz-dock-lifted');
    toolBars.lifted = false;
    if (this.lift === l) this.lift = null;
    if (!keepOrder) this.host.previewOrder(null);
  }

  dispose(): void {
    clearTimeout(this.press?.timer);
    const l = this.lift ?? this.landing;
    if (l) this.clear(l, false);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp, true);
    window.removeEventListener('pointercancel', this.onCancel, true);
    window.removeEventListener('pointerdown', this.onOtherDown, true);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('keydown', this.onKey, true);
  }
}
