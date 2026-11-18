/**
 * The tool bars: for each workspace, the ordered list of tool ids its bar
 * holds (the brushes between Select and Transform in Sculpt, the six tools
 * after Select in Paint). The default is the order the bars have always had.
 *
 * The number keys follow it: `slot.1` to `slot.10` pick whatever sits in
 * that place of the current workspace's bar. Badges, tooltips, the hotkey
 * guide and Preferences read the place from here too, so the one thing a
 * later change of the order has to touch is this list (and keep it).
 */
import { deviceStore, DeviceStorageOff, mayStore, onDeviceChoice } from '../../ui/deviceStorage';
import { toolById, type Workspace } from './registry';

/** localStorage: the orders that differ from the default, as `{ v: 1, sculpt?: ids, paint?: ids }`. Kept through deviceStore, so it follows the saving choice. */
export const BARS_KEY = 'bozzetto-toolbar';

/** The keys 1 to 9 and 0: a bar may hold more tools than this, and those past the tenth have no key. */
export const PLACE_COUNT = 10;

/** Today's order, the default of each workspace's bar. */
export const DEFAULT_BARS: Readonly<Record<Workspace, readonly string[]>> = {
  sculpt: ['bz.crease', 'bz.move', 'bz.clay', 'bz.inflate', 'bz.pinch', 'bz.flatten', 'bz.rake', 'bz.drag', 'bz.polish'],
  paint: ['bz.paint', 'bz.erase', 'bz.blur', 'bz.fill', 'bz.pick', 'bz.project'],
};

/** The action id of a place: `slot.1` to `slot.10`. */
export const slotAction = (place: number): string => `slot.${place}`;

/** The place (1 to 10) an action id names, or 0 when it is not a place. */
export function placeOfAction(id: string): number {
  const m = /^slot\.(\d{1,2})$/.exec(id);
  const n = m ? Number(m[1]) : 0;
  return n >= 1 && n <= PLACE_COUNT ? n : 0;
}

type Listener = () => void;

const WORKSPACES: readonly Workspace[] = ['sculpt', 'paint'];

/**
 * A stored order made safe: what is not a string, is not a tool the bar can
 * hold, or repeats is dropped, and the tools of the default bar that the
 * stored one lacks (a tool a later version added) are appended in the
 * default order, so none is ever lost to an old record.
 */
export function sanitizeOrder(ws: Workspace, raw: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const own = DEFAULT_BARS[ws];
  if (Array.isArray(raw)) {
    for (const id of raw) {
      if (typeof id !== 'string' || seen.has(id) || !own.includes(id)) continue;
      const def = toolById(id);
      if (!def || def.kind !== 'brush' || def.engine === null || !def.icon) continue;
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of own) if (!seen.has(id)) out.push(id);
  return out;
}

export class ToolBars {
  private readonly orders: Record<Workspace, string[]> = { sculpt: [...DEFAULT_BARS.sculpt], paint: [...DEFAULT_BARS.paint] };
  private readonly listeners = new Set<Listener>();
  /** Something is lifted off a bar (the dock's drag): the number keys wait. */
  lifted = false;
  /** Told once per visit when an order could not be kept because saving on this device is off. */
  onNotKept: (() => void) | null = null;
  private toldNotKept = false;

  constructor() {
    this.load();
    // Saving was allowed after the order was changed (or at all): what a visit left is read if nothing was changed yet, else what is on screen is written.
    onDeviceChoice((now) => {
      if (now !== 'keep') return;
      if (WORKSPACES.every((ws) => this.isDefault(ws))) {
        this.load();
        for (const fn of this.listeners) fn();
      } else this.save();
    });
  }

  /** Whether a workspace's bar is in the order it ships with. */
  isDefault(ws: Workspace): boolean {
    const a = this.orders[ws];
    const d = DEFAULT_BARS[ws];
    return a.length === d.length && a.every((id, i) => id === d[i]);
  }

  /** Put the default order back on a bar; the order it had is returned, for an Undo. */
  reset(ws: Workspace): readonly string[] {
    const was = this.orders[ws];
    this.orders[ws] = [...DEFAULT_BARS[ws]];
    this.save();
    for (const fn of this.listeners) fn();
    return was;
  }

  private load(): void {
    try {
      const raw = deviceStore.get(BARS_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      for (const ws of WORKSPACES) {
        const stored = (parsed as Record<string, unknown>)[ws];
        if (stored !== undefined) this.orders[ws] = sanitizeOrder(ws, stored);
      }
    } catch {
      // A blocked or corrupt store: the default orders stand.
    }
  }

  /** Written only when an order differs from the default; with nothing to keep the record goes. */
  private save(): void {
    try {
      const out: Record<string, unknown> = { v: 1 };
      let any = false;
      for (const ws of WORKSPACES) {
        if (this.isDefault(ws)) continue;
        out[ws] = this.orders[ws];
        any = true;
      }
      if (any) deviceStore.set(BARS_KEY, JSON.stringify(out));
      else deviceStore.remove(BARS_KEY);
    } catch (err) {
      // The order still holds for this visit; it says so once when that is because saving is off.
      if ((err instanceof DeviceStorageOff || !mayStore()) && !this.toldNotKept) {
        this.toldNotKept = true;
        this.onNotKept?.();
      }
    }
  }

  /** The ids on a workspace's bar, in order. */
  order(ws: Workspace): readonly string[] {
    return this.orders[ws];
  }

  /** The tool in a place (1 is the first), or undefined when the place is empty. */
  idAt(ws: Workspace, place: number): string | undefined {
    return this.orders[ws][place - 1];
  }

  /** The place a tool holds on a workspace's bar (1 is the first), or 0 when it is not on it. */
  placeOf(ws: Workspace, id: string): number {
    return this.orders[ws].indexOf(id) + 1;
  }

  /**
   * Put a new order on a bar and keep it on the device (when the person
   * allows that). Ids that are not tools, and repeats, are left out.
   */
  set(ws: Workspace, ids: readonly string[]): void {
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const id of ids) {
      const def = toolById(id);
      if (!def || def.kind !== 'brush' || seen.has(id)) continue;
      seen.add(id);
      clean.push(id);
    }
    this.orders[ws] = clean;
    this.save();
    for (const fn of this.listeners) fn();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** The bars the app runs on. */
export const toolBars = new ToolBars();

/**
 * The keymap action an old build kept a tool's key under (`tool.crease` in
 * Sculpt, `paint.erase` in Paint), and the place that tool holds on its
 * default bar: a rebind saved under the old id carries over to that place.
 */
export function legacyKeyMoves(): Array<[from: string, to: string]> {
  const out: Array<[string, string]> = [];
  for (const ws of ['sculpt', 'paint'] as const) {
    DEFAULT_BARS[ws].forEach((id, i) => out.push([`${ws === 'sculpt' ? 'tool' : 'paint'}.${id.replace(/^bz\./, '')}`, slotAction(i + 1)]));
  }
  return out;
}
