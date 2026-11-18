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
import { toolById, type Workspace } from './registry';

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

export class ToolBars {
  private readonly orders: Record<Workspace, string[]> = { sculpt: [...DEFAULT_BARS.sculpt], paint: [...DEFAULT_BARS.paint] };
  private readonly listeners = new Set<Listener>();

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
   * Put a new order on a bar. Ids that are not tools of that workspace, and
   * repeats, are left out. Not kept anywhere yet: storing it is for whoever
   * lets the person change it.
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
