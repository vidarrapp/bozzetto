import { onTap } from '../ui/dom';
import { DEFAULT_BARS, slotAction, toolBars } from '../sculpt/tools/bars';
import { chordLabel, keymap } from '../ui/keymap';
import { TOOLS, toolById, type ToolDef, type Workspace } from '../sculpt/tools/registry';
import { addToBar, removeFromBar } from '../sculpt/ui/dockNotes';
import { openTileMenu } from '../sculpt/ui/tileMenu';
import { toolIcon } from '../sculpt/ui/toolIcon';
import type { LibraryContext, LibraryView } from './AssetLibrary';

/** What the Tools tab asks of the page it is on (the tool bar, which holds the tool in hand and the dock). */
export interface ToolsHost {
  /** The workspace whose bar is showing. */
  workspace(): Workspace;
  /** The tool in hand, by id, or null. */
  inHand(): string | null;
  /** Take a tool in hand, as a tap on the bar does. */
  pick(id: string): void;
  /** Whether tools can be used here at all (Present looks and does not sculpt). */
  canUse(): boolean;
  /** A press on a tile that may lift: the dock takes it; `menu` is what a long press without moving opens. */
  lift(e: PointerEvent, id: string, tile: HTMLElement, menu: () => void): void;
  /** The last press on a tile was a lift or a slip, so not a tap. */
  swallowing(): boolean;
  /** The tool in hand, the workspace or the bar changed. */
  onState(fn: () => void): () => void;
}

const WORKSPACE_NAME: Record<Workspace, string> = { sculpt: 'Sculpt', paint: 'Paint' };

/** The tools a bar can hold: brushes with an engine and an icon, of a workspace, in the order their default bar has them. */
function usableTools(): ToolDef[] {
  const out: ToolDef[] = [];
  for (const ws of ['sculpt', 'paint'] as const) {
    for (const id of DEFAULT_BARS[ws]) {
      const def = toolById(id);
      if (def) out.push(def);
    }
  }
  // A tool of the registry that no default bar names stands after them.
  for (const def of TOOLS) {
    if (def.kind === 'brush' && def.engine !== null && def.icon && def.workspace && !out.includes(def)) out.push(def);
  }
  return out;
}

interface Tile {
  def: ToolDef;
  el: HTMLButtonElement;
  mark: HTMLSpanElement;
}

/**
 * The Tools tab: every tool the app ships with, in two groups, Sculpt and
 * Paint, the one of the workspace you are in first. A tap takes the tool in
 * hand; a lift (the dock's, from here onto the bar) puts it on the bar; a
 * long press without moving opens its menu. Copies of your own, under Mine,
 * come with a later step.
 */
export class ToolsView implements LibraryView {
  private root: HTMLDivElement | null = null;
  private ctx!: LibraryContext;
  private readonly tiles: Tile[] = [];
  private readonly groups = new Map<Workspace, { box: HTMLElement; head: HTMLElement }>();
  private readonly empty = document.createElement('p');
  private readonly mine = document.createElement('p');
  private offState: (() => void) | null = null;
  private offBars: (() => void) | null = null;
  private offKeys: (() => void) | null = null;

  constructor(private readonly host: ToolsHost) {}

  mount(body: HTMLElement, ctx: LibraryContext): void {
    this.ctx = ctx;
    const root = document.createElement('div');
    root.className = 'lib-tools';
    this.root = root;
    const defs = usableTools();
    for (const ws of ['sculpt', 'paint'] as const) {
      const box = document.createElement('section');
      box.className = 'lib-group';
      box.dataset.group = ws;
      const head = document.createElement('h3');
      head.className = 'lib-group__head';
      head.textContent = WORKSPACE_NAME[ws];
      const grid = document.createElement('div');
      grid.className = 'lib-grid';
      for (const def of defs.filter((d) => d.workspace === ws)) {
        const tile = this.makeTile(def);
        this.tiles.push(tile);
        grid.appendChild(tile.el);
      }
      box.append(head, grid);
      root.appendChild(box);
      this.groups.set(ws, { box, head });
    }
    this.empty.className = 'lib-later lib-empty';
    this.empty.textContent = 'Nothing called that.';
    this.mine.className = 'lib-later lib-empty';
    this.mine.textContent = 'Copies you make of a tool show here.';
    root.append(this.empty, this.mine);
    body.appendChild(root);
    this.offState = this.host.onState(() => this.paint());
    this.offBars = toolBars.onChange(() => this.paint());
    // A key rebound in Preferences shows on the tiles as it does on the bar.
    this.offKeys = keymap.onChange(() => this.paint());
    this.refresh();
  }

  private makeTile(def: ToolDef): Tile {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'lib-tile';
    el.dataset.tool = def.id;
    el.appendChild(toolIcon(def.slot ?? def.id, def.icon ?? ''));
    const name = document.createElement('span');
    name.className = 'lib-tile__name';
    name.textContent = def.name;
    const mark = document.createElement('span');
    mark.className = 'lib-tile__mark';
    mark.setAttribute('aria-hidden', 'true');
    el.append(name, mark);
    // A tap uses the tool; a press that lifts or slips is not a tap (the dock decides, on its own window listeners).
    onTap(el, () => this.use(def), () => this.host.swallowing());
    el.addEventListener('pointerdown', (e) => {
      if (def.workspace === this.host.workspace() && this.host.canUse()) this.host.lift(e, def.id, el, () => this.openMenu(def, el));
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return { def, el, mark };
  }

  /** A tap: the tool in hand, or, for one of the other workspace, where it is used. */
  private use(def: ToolDef): void {
    if (!this.host.canUse()) {
      this.ctx.say('Tools are not used in Present.');
      return;
    }
    if (def.workspace !== this.host.workspace()) {
      const ws = def.workspace ?? 'sculpt';
      this.ctx.say(`This is a ${WORKSPACE_NAME[ws]} tool. It is used in ${WORKSPACE_NAME[ws]}.`);
      return;
    }
    this.host.pick(def.id);
  }

  private openMenu(def: ToolDef, el: HTMLElement): void {
    const ws = def.workspace;
    if (!ws) return;
    const kept = toolBars.placeOf(ws, def.id) > 0;
    openTileMenu(
      el,
      [
        { label: 'Use', action: () => this.use(def) },
        kept ? { label: 'Remove from tool bar', action: () => removeFromBar(ws, def.id) } : { label: 'Add to tool bar', action: () => addToBar(ws, def.id) },
      ],
      false,
    );
  }

  refresh(): void {
    if (!this.root) return;
    const mine = this.ctx.where() === 'mine';
    const q = this.ctx.query();
    const ws = this.host.workspace();
    // The group of the workspace you are in comes first.
    const order: Workspace[] = ws === 'paint' ? ['paint', 'sculpt'] : ['sculpt', 'paint'];
    for (const w of order) {
      const g = this.groups.get(w);
      if (g) this.root.insertBefore(g.box, this.empty);
    }
    let shown = 0;
    for (const t of this.tiles) {
      const match = !mine && (!q || t.def.name.toLowerCase().includes(q));
      t.el.hidden = !match;
      if (match) shown++;
    }
    for (const [w, g] of this.groups) {
      g.box.hidden = mine || !this.tiles.some((t) => t.def.workspace === w && !t.el.hidden);
    }
    this.empty.hidden = mine || shown > 0;
    this.mine.hidden = !mine;
    this.paint();
  }

  /** The marks, the tool in hand and the dimming of the other workspace's tools. */
  private paint(): void {
    if (!this.root) return;
    const ws = this.host.workspace();
    const hand = this.host.inHand();
    const usable = this.host.canUse();
    for (const t of this.tiles) {
      const own = t.def.workspace === ws && usable;
      const place = t.def.workspace ? toolBars.placeOf(t.def.workspace, t.def.id) : 0;
      const kept = place > 0;
      // The key of its place on the bar, as the bar's own badge has it; a dot where the place has no plain key.
      const chord = place >= 1 && place <= 10 ? keymap.chordFor(slotAction(place)) : null;
      t.mark.textContent = !kept ? '' : chord && !chord.includes('+') ? (chord.length === 1 ? chord : chordLabel(chord)) : '•';
      t.el.classList.toggle('is-hand', own && hand === t.def.id);
      t.el.classList.toggle('is-other', !own);
      t.el.classList.toggle('is-kept', kept);
      t.el.setAttribute('aria-label', `${t.def.name}${kept ? ', on the tool bar' : ''}`);
    }
  }

  dispose(): void {
    this.offState?.();
    this.offBars?.();
    this.offState = null;
    this.offBars = null;
    this.offKeys?.();
    this.offKeys = null;
    this.root?.remove();
    this.root = null;
    this.tiles.length = 0;
  }
}
