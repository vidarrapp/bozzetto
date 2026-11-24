/**
 * The dock: lift a tool off the tool bar and put it somewhere else on it, or
 * off it, and lift a tool from the Asset library onto it.
 *
 * A press on a tool's tile is one of four things. A tap picks the tool (the
 * tile's own onTap). A long press (Pencil or finger: LONG_PRESS_MS, the
 * mouse too) lifts it. A mouse that moves 4px lifts it at once. A press
 * that moves more than 8px before the long press, with a finger or the
 * Pencil, is a slip: neither a tap nor a lift.
 *
 * The lifted tile is a ghost that follows the pointer, a little larger than
 * the tile, with the tool's name above it. From the bar its place stays as
 * a gap; from the window the tile stays where it is, dimmed. Moving along
 * the bar opens the gap at the insertion point and the other tiles slide
 * aside, their badges showing the digits they will have; a tool that is not
 * on the bar makes room for itself (the bar's box widens, and the tiles move
 * to where the layout will put them). Letting go on the bar puts the tool
 * there. Letting go off the bar's zone, with a tool lifted from the bar,
 * takes it off the bar (the ghost dims once it is out, the others close the
 * gap); with a tool lifted from the window it flies back. Esc, a cancelled
 * pointer, the window losing focus and a second pointer going down put the
 * ghost back and change nothing. A long press that ends without moving
 * opens the tile's menu.
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
import { tellRemoved } from './dockNotes';

/** A mouse lifts after this much movement. */
const MOUSE_LIFT_PX = 4;
/** A finger or the Pencil that moves this much before the long press has slipped; a lift that travels no more than this ends in the tile's menu. */
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
/** A removed tool's ghost shrinks and fades over this long. */
const GONE_MS = 170;
/** A tile is this wide, and the gap between two. */
const TILE_PX = 44;
const GAP_PX = 4;

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
  /** The tool is the one in hand (its ghost is orange). */
  inHand(id: string): boolean;
  /** The extra tile: the tool in hand that is not on the bar, or undefined. */
  extra(): HTMLButtonElement | undefined;
  /** The tiles of the bar that are not tools of its order, those on show: the ones before them (Select) and after them (the extra tile, Transform, Calipers). */
  fixed(): { lead: HTMLElement[]; trail: HTMLElement[] };
  /** A long press on a bar tile ended without moving: its menu. */
  menu(id: string, tile: HTMLElement): void;
}

/** What letting go means. */
export type DropOutcome = { kind: 'move'; index: number } | { kind: 'remove' } | { kind: 'back' };

/** Where a press came from: a tile on the bar, or a tile in the Asset library window (with what its long press without moving opens). */
interface Origin {
  window: boolean;
  tile: HTMLElement | null;
  menu: (() => void) | null;
}

interface Press {
  pointerId: number;
  type: string;
  id: string;
  origin: Origin;
  startX: number;
  startY: number;
  downAt: number;
  timer: number;
}

interface Lift {
  pointerId: number;
  type: string;
  id: string;
  origin: Origin;
  downAt: number;
  startX: number;
  startY: number;
  /** The lift came from the press timing out, not from a mouse's drag: a lift that ends before the time was a tap. */
  byTime: boolean;
  moved: boolean;
  /** Went further than SLIP_PX from where it was pressed: not a long press for the menu. */
  travelled: boolean;
  /** The tool is not on the bar: it is put in rather than moved. */
  inserting: boolean;
  /** The tile of the tool in hand that is not kept, when this is that tool. */
  extra: HTMLButtonElement | null;
  /** Letting go out of the zone takes it off the bar. */
  removable: boolean;
  /** The pointer is in the bar's zone. */
  open: boolean;
  ids: string[];
  tiles: HTMLButtonElement[];
  lead: HTMLElement[];
  trail: HTMLElement[];
  /** The centre of each place, read once at the lift, and the one after the last (where the next tile would stand). */
  centres: number[];
  slots: number[];
  pitch: number;
  midY: number;
  /** Where the ghost flies back to when it came from the window: the tile it came from. */
  home: { x: number; y: number };
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

  /** The pointerdown on a tile of the bar that may be lifted. */
  begin(e: PointerEvent, id: string): void {
    this.start(e, id, { window: false, tile: null, menu: null });
  }

  /** The pointerdown on a tile in the Asset library window; `menu` is what a long press without moving opens. */
  beginFromWindow(e: PointerEvent, id: string, tile: HTMLElement, menu: () => void): void {
    this.start(e, id, { window: true, tile, menu });
  }

  private start(e: PointerEvent, id: string, origin: Origin): void {
    // Any new press ends the last one's say over taps, whether or not the dock takes this one.
    this.swallowing = false;
    if (e.button !== 0 || !e.isPrimary) return;
    // A tile still flying to its place holds the others' transforms: the places cannot be read until it lands.
    if (this.press || this.lift || this.landing) return;
    if (this.host.isStroking()) return;
    this.press = { pointerId: e.pointerId, type: e.pointerType, id, origin, startX: e.clientX, startY: e.clientY, downAt: eventTime(e), timer: window.setTimeout(this.onHeld, LONG_PRESS_MS) };
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
    if (!l.travelled && Math.hypot(e.clientX - l.startX, e.clientY - l.startY) > SLIP_PX) l.travelled = true;
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
    // A long press that never went anywhere: the tile's menu, and nothing changes.
    if (l.byTime && !l.travelled) {
      this.settle(l, false);
      if (l.origin.window) l.origin.menu?.();
      else this.host.menu(l.id, this.host.tile(l.id) ?? this.host.extra() ?? this.host.bar());
      return;
    }
    this.track(l, e.clientX, e.clientY);
    const outcome = this.resolve(l);
    if (outcome.kind === 'move' && (l.inserting || outcome.index !== l.from)) this.drop(l);
    else if (outcome.kind === 'remove') this.vanish(l);
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
    if (l.open) return { kind: 'move', index: l.target };
    return l.removable ? { kind: 'remove' } : { kind: 'back' };
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
    const extraTile = this.host.extra();
    const extra = from < 0 && extraTile?.dataset.tool === p.id ? extraTile : null;
    // A tool that is on no bar of this workspace and is not the extra tile can only come from the window.
    if (from < 0 && !extra && !p.origin.window) return;
    const inserting = from < 0;
    const source = p.origin.tile ?? extra ?? tiles[from];
    if (!source) return;
    // The one read of the layout: where each place is, and where the tile came from.
    const rects = tiles.map((t) => t.getBoundingClientRect());
    const bar = this.host.bar().getBoundingClientRect();
    const { lead, trail } = this.host.fixed();
    const leadRect = lead[0]?.getBoundingClientRect();
    const srcRect = source.getBoundingClientRect();
    const centres = rects.map((r) => r.left + r.width / 2);
    const w = rects[0]?.width ?? leadRect?.width ?? TILE_PX;
    const pitch = centres.length > 1 ? centres[1] - centres[0] : w + GAP_PX;
    const last = centres.length ? centres[centres.length - 1] + pitch : leadRect ? leadRect.right + GAP_PX + w / 2 : bar.left + bar.width / 2;
    const ghost = this.makeGhost(source, this.host.nameOf(p.id), this.host.inHand(p.id));
    const l: Lift = {
      pointerId: p.pointerId,
      type: p.type,
      id: p.id,
      origin: p.origin,
      downAt: p.downAt,
      startX: p.startX,
      startY: p.startY,
      byTime,
      moved: false,
      travelled: false,
      inserting,
      extra,
      removable: !p.origin.window && !extra,
      open: false,
      ids,
      tiles,
      lead,
      trail: trail.filter((t) => t !== extra),
      centres,
      slots: [...centres, last],
      pitch,
      midY: leadRect ? leadRect.top + leadRect.height / 2 : rects[0] ? rects[0].top + rects[0].height / 2 : bar.top + bar.height / 2,
      home: { x: srcRect.left + srcRect.width / 2, y: srcRect.top + srcRect.height / 2 },
      zone: { left: bar.left - ZONE_SIDE_PX, right: bar.right + ZONE_SIDE_PX, top: bar.top - ZONE_ABOVE_PX },
      from,
      target: inserting ? ids.length : from,
      x,
      y,
      ghost,
      raf: 0,
    };
    l.open = this.inZone(l);
    this.lift = l;
    this.swallowing = true;
    toolBars.lifted = true;
    document.body.classList.add('bz-dock-lifted');
    this.host.bar().classList.add('dock-active');
    // From the bar the tile's place is the gap; from the window the tile stays and is dimmed.
    p.origin.tile?.classList.add('dock-origin');
    if (!p.origin.window) (extra ?? tiles[from])?.classList.add('dock-gap');
    document.body.appendChild(ghost);
    this.place(l);
    // The ghost grows to its size on the next frame, so the growth is seen.
    requestAnimationFrame(() => ghost.classList.add('dock-ghost--up'));
    this.host.previewOrder(ids);
    // A lift from the window that starts over the bar opens its place at once.
    if (l.open && p.origin.window) {
      l.target = this.targetFor(l);
      this.shift(l);
    }
  }

  /** The ghost: the tile's icon at a larger size, the tool's name above it. */
  private makeGhost(tile: HTMLElement, name: string, on: boolean): HTMLElement {
    const g = document.createElement('div');
    g.className = 'dock-ghost';
    g.setAttribute('aria-hidden', 'true');
    if (on) g.classList.add('dock-ghost--on');
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
    const open = this.inZone(l);
    const target = open ? this.targetFor(l) : l.inserting ? l.ids.length : l.from;
    if (open !== l.open || target !== l.target) {
      l.open = open;
      l.target = target;
      this.shift(l);
    }
  }

  private place(l: Lift): void {
    const lift = l.type === 'touch' ? FINGER_LIFT_PX : 0;
    l.ghost.style.transform = `translate3d(${l.x}px, ${l.y - lift}px, 0)`;
  }

  /**
   * The place the gap is at. A tool that is already on the bar: the place
   * whose centre is nearest the pointer, and a different one only once it is
   * HYSTERESIS_PX nearer than the one it has. A tool that is put in: the
   * number of tiles whose centre the pointer has passed, with the same
   * margin.
   */
  private targetFor(l: Lift): number {
    if (l.inserting) {
      let k = l.target;
      while (k < l.centres.length && l.x > l.centres[k] + HYSTERESIS_PX) k++;
      while (k > 0 && l.x < l.centres[k - 1] - HYSTERESIS_PX) k--;
      return k;
    }
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

  private static slide(el: HTMLElement, dx: number): void {
    el.style.transform = dx ? `translate3d(${dx}px, 0, 0)` : '';
  }

  /**
   * Slide the others aside, by transform, and show the digits they will have.
   * Where the bar will be laid out again about its middle (a tool put in or
   * taken off), the tiles go where that layout will have them, so nothing
   * jumps when the order is set.
   */
  private shift(l: Lift): void {
    const half = l.pitch / 2;
    const gap = l.inserting ? l.extra : l.tiles[l.from];
    // The gap shows where the tool will stand; from the window a tool that is on the bar keeps its tile until the pointer is on the bar.
    gap?.classList.toggle('dock-gap', !l.origin.window || l.open);
    this.host.bar().classList.toggle('dock-room', l.inserting && !l.extra && l.open);
    l.ghost.classList.toggle('dock-ghost--out', !l.open && l.removable);
    const rest = (): void => {
      for (const t of [...l.tiles, ...l.lead, ...l.trail]) Dock.slide(t, 0);
    };
    if (l.inserting) {
      if (!l.open) {
        rest();
        this.host.previewOrder(l.ids);
        return;
      }
      const k = l.target;
      // The extra tile makes the room itself; a new one widens the bar about its middle.
      const before = l.extra ? 0 : -half;
      const after = l.extra ? l.pitch : half;
      for (const t of l.lead) Dock.slide(t, before);
      l.tiles.forEach((t, i) => Dock.slide(t, i < k ? before : after));
      for (const t of l.trail) Dock.slide(t, l.extra ? 0 : half);
      const order = [...l.ids];
      order.splice(k, 0, l.id);
      this.host.previewOrder(order);
      return;
    }
    if (!l.open && l.origin.window) {
      rest();
      this.host.previewOrder(l.ids);
      return;
    }
    const removing = !l.open;
    const order = removing ? l.ids.filter((id) => id !== l.id) : this.previewIds(l);
    // A tool taken off the bar while it is in hand stays as the extra tile, which takes the room it had; any other leaves the bar narrower.
    const recentre = removing && !this.host.inHand(l.id) ? half : 0;
    for (let i = 0; i < l.ids.length; i++) {
      if (i === l.from) continue;
      const slot = order.indexOf(l.ids[i]);
      Dock.slide(l.tiles[i], l.centres[slot] - l.centres[i] + recentre);
    }
    for (const t of l.lead) Dock.slide(t, recentre);
    for (const t of l.trail) Dock.slide(t, -recentre);
    this.host.previewOrder(order);
  }

  /** Letting go on the bar: the tool goes to the gap. */
  private drop(l: Lift): void {
    const order = this.previewIds(l);
    // The ghost flies into the gap, then the order is put in place: the tool stays in hand, no notice.
    const x = l.inserting ? l.slots[l.target] - (l.extra ? 0 : l.pitch / 2) : l.centres[l.target];
    this.fly(l, x, l.midY, () => {
      this.clear(l, true);
      toolBars.set(this.host.workspace(), order);
    });
  }

  /** Letting go off the bar with a tool lifted from it: the ghost shrinks away, the tool is off the bar, and a notice says so with a way back. */
  private vanish(l: Lift): void {
    const ws = this.host.workspace();
    const was = [...toolBars.order(ws)];
    const name = this.host.nameOf(l.id);
    l.ghost.classList.add('dock-ghost--gone');
    this.end(
      l,
      () => {
        this.clear(l, true);
        toolBars.set(
          ws,
          was.filter((id) => id !== l.id),
        );
        tellRemoved(name, () => toolBars.set(ws, was));
      },
      reducedMotion() ? 0 : GONE_MS,
    );
  }

  /**
   * Put the ghost back and change nothing (`flyBack`), or, for a lift that
   * was a tap or a long press, drop it where it is.
   */
  private settle(l: Lift, flyBack: boolean): void {
    if (this.lift !== l) return;
    if (!flyBack) {
      this.clear(l, false);
      return;
    }
    // The others return to their places as the ghost flies back to its own.
    l.open = false;
    for (const t of [...l.tiles, ...l.lead, ...l.trail]) Dock.slide(t, 0);
    this.host.bar().classList.remove('dock-room');
    l.ghost.classList.remove('dock-ghost--out');
    this.host.previewOrder(l.ids);
    // From the bar the ghost goes back to its gap; from the window, to its tile.
    const home = l.origin.window ? l.home : { x: l.extra ? l.slots[l.ids.length] : l.centres[l.from], y: l.midY };
    this.fly(l, home.x, home.y, () => this.clear(l, false));
  }

  private fly(l: Lift, x: number, y: number, done: () => void): void {
    l.ghost.classList.add('dock-ghost--home');
    l.ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    this.end(l, done, reducedMotion() ? 0 : MOVE_MS + 10);
  }

  /** From here the lift is over: nothing follows the pointer, the keys are free again, and `done` runs once the ghost has landed. */
  private end(l: Lift, done: () => void, ms: number): void {
    cancelAnimationFrame(l.raf);
    l.raf = 0;
    toolBars.lifted = false;
    this.landing = l;
    window.setTimeout(() => {
      done();
      this.landing = null;
    }, ms);
    this.lift = null;
  }

  /** The lift that is flying to its place, so a fast new press waits for it. */
  private landing: Lift | null = null;

  /** Everything the lift put on the page comes off. `keepOrder`: the caller sets the new order right after. */
  private clear(l: Lift, keepOrder: boolean): void {
    l.ghost.remove();
    for (const t of [...l.tiles, ...l.lead, ...l.trail]) t.style.transform = '';
    for (const t of l.tiles) t.classList.remove('dock-gap');
    l.extra?.classList.remove('dock-gap');
    l.origin.tile?.classList.remove('dock-origin');
    this.host.bar().classList.remove('dock-active', 'dock-room');
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
