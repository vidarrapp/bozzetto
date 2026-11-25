import type { Viewer } from '../viewer/Viewer';
import { pageChrome, type ChromeToggle } from '../ui/ChromeToggle';
import { settings } from '../ui/settings';
import { beforeLeaving } from '../ui/leaving';
import type { KeyMode } from '../ui/keymap';
import { mountAccountHandle } from '../ui/account/menu';
import { helpMenuItems } from '../help/menu';
import { MaterialPanel, type MaterialPanelOptions } from '../ui/MaterialPanel';
import { ReferenceBoard } from '../reference/board';
import { ReferencePanel } from '../reference/ReferencePanel';
import { ReferenceView } from '../reference/ReferenceView';
import { ArrangeButton } from '../reference/ArrangeButton';
import { AssetLibrary } from '../library/AssetLibrary';
import { installIntake } from '../reference/intake';
import { TitleStrip, type PathStep, type Readout, type Workspace as WorkspaceId } from '../sculpt/ui/TitleStrip';
import { TopMenu, type MenuItem } from '../sculpt/ui/TopMenu';
import { HistoryButtons, type HistoryHooks } from '../sculpt/ui/BrushSliders';
import { DetailsOverlay, type DetailLine } from '../sculpt/ui/DetailsOverlay';
import type { SidePanel } from '../sculpt/ui/SidePanel';
import { WorkspacePanels } from '../sculpt/ui/panelMemory';
import '../sculpt/ui/shell.css';
import { Hidden, watchAdditions } from './hidden';

/**
 * The shell of the page (step A of docs/plans/armature-workspace.md).
 *
 * A page builds one Studio. It owns what every workspace shares and is
 * built once: the title strip (the workspace path and the readout), the four
 * menus (empty frames, filled from the workspace in front), the edge column
 * with Undo and Redo, the details overlay, the chrome toggle's wiring, the
 * leaving guard, the Material and Reference panels with the page's one
 * reference board, the Asset library window, and the memory of which panels each workspace had open.
 *
 * A workspace is something the shell hosts (`Workspace`). The shell asks
 * the one in front for its menu items, its path, its readout, its details
 * and its history, and never reaches into a workspace's internals; a switch
 * is `go(to)`, which asks both for leave and enter. Only the workspace in
 * front is asked anything, and only it hears the pointer and the keys
 * (a workspace binds its own listeners in `enter` and lets them go in
 * `leave`, as Armature does with suspend and resume).
 */

export type { WorkspaceId, PathStep, Readout, DetailLine, MenuItem, HistoryHooks };

/** The menus a workspace has items for; Help is the shell's. */
export interface WorkspaceMenus {
  file: MenuItem[];
  edit: MenuItem[];
  view: MenuItem[];
}

/** What a workspace gives the shell. */
export interface Workspace {
  readonly id: WorkspaceId;
  /** Which keymap rows are its own (keymap.actionFor(e, keyMode)). */
  readonly keyMode: KeyMode;
  /** The menus' items, read whenever the shell refreshes them and each time a menu opens. */
  menus(): WorkspaceMenus;
  /**
   * What the steps of the path do from here, for the steps the shell does not
   * decide: it makes every step to a hosted workspace a `go`, and this
   * replaces or adds to those (Armature's Sculpt step sends and changes page,
   * Paint and Present are not reachable from there, with the reason).
   */
  path(): Partial<Record<WorkspaceId, PathStep>>;
  /**
   * The workspace's own panels, besides the shared Material and Reference.
   * The shell silences what the one it switches to does not have
   * (SidePanel.setSuspended) and wakes what it has.
   */
  panels: { left: SidePanel[]; right: SidePanel[] };
  /** The title strip's readout. */
  readout(): Readout;
  /** The details overlay's lines; null leaves it as it is (Present shows none). */
  details(): DetailLine[] | null;
  /** Undo and Redo, the edge column's buttons. */
  history: HistoryHooks;
  /** False to refuse becoming the front, from the workspace named (null at the start). Mid-stroke, for one. */
  mayEnter?(from: WorkspaceId | null): boolean;
  /** False to refuse being left for `to`. */
  mayLeave?(to: WorkspaceId): boolean;
  /** Show its things, take the pointer and the keys. */
  enter(from: WorkspaceId | null): void;
  /** Put them away. */
  leave(to: WorkspaceId): void;
  /** Write what it keeps before the page goes (a sign-in again, an update). False: something could not be stored. */
  beforeLeavingPage(): Promise<boolean> | boolean;
  /** Told each time it is the front and the shell repaints (path, menus): for what is its own to show. */
  shown?(): void;
  /** Once a pass of the readout's timer, after the readout and the details: for headings that follow the work. */
  tick?(): void;
}

export interface StudioOptions {
  /** The scope the page's reference board keeps its pictures under: 'sculpt' on the Sculpt page, 'armature' on Armature's. Merging the boards is this one value. */
  referenceScope: 'sculpt' | 'armature';
  /** The Material panel the page has (the Surface section only where there is an object to speak for). */
  material: MaterialPanelOptions;
}

/** How often the readout and the details are written again. */
const PASS_MS = 500;

export class Studio {
  readonly viewer: Viewer;
  readonly strip: TitleStrip;
  readonly menus: { file: TopMenu; edit: TopMenu; view: TopMenu; help: TopMenu };
  /** The edge column: the one `.bz-edge`, with Undo and Redo; a workspace adds its own buttons to `el`. */
  readonly edge: { el: HTMLDivElement; history: HistoryButtons };
  readonly details: DetailsOverlay;
  readonly chrome: ChromeToggle;
  readonly material: MaterialPanel;
  /** The Asset library: one floating window every workspace can open; a workspace gives its tabs their contents (`library.register`). */
  readonly library: AssetLibrary;
  readonly reference: { board: ReferenceBoard; panel: ReferencePanel; view: ReferenceView; arrange: ArrangeButton };
  /** Which panels each workspace had open; built by `beginPanels`. */
  panels: WorkspacePanels | null = null;

  private readonly spaces = new Map<WorkspaceId, Workspace>();
  private front: Workspace | null = null;
  /** What the shell put on the page: asleep, all of it is put away. */
  private readonly ownDom: HTMLElement[];
  private readonly hidden = new Hidden();
  private asleep = false;
  private offLeaving: (() => void) | null = null;
  private offIntake: (() => void) | null = null;
  private offSettings: (() => void) | null = null;
  private timer = 0;
  private disposed = false;

  constructor(viewer: Viewer, opts: StudioOptions) {
    this.viewer = viewer;
    const added = watchAdditions([document.body, viewer.captureCanvas.parentElement]);

    this.strip = new TitleStrip();
    mountAccountHandle(this.strip);
    this.chrome = pageChrome();
    this.strip.onToggleChrome = () => this.chrome.toggle();

    // The edge column, Undo and Redo at its foot; Sculpt's brush sliders, Solo and Negative stand in it too.
    const history = new HistoryButtons({
      undo: () => this.front?.history.undo(),
      redo: () => this.front?.history.redo(),
      canUndo: () => this.front?.history.canUndo() ?? false,
      canRedo: () => this.front?.history.canRedo() ?? false,
    });
    const edge = document.createElement('div');
    edge.className = 'bz-edge';
    edge.appendChild(history.el);
    document.body.appendChild(edge);
    this.edge = { el: edge, history };

    // The menus are frames: their rows are read from the workspace in front.
    const frame = (label: string, cls: string): TopMenu => new TopMenu(label, [], cls, this.strip.menus, true);
    this.menus = {
      file: frame('File', 'file-menu--file'),
      edit: frame('Edit', 'file-menu--edit'),
      view: frame('View', 'file-menu--view'),
      help: new TopMenu('Help', helpMenuItems(), 'file-menu--help', this.strip.menus, true),
    };
    this.menus.file.beforeOpen = () => this.refreshMenu('file');
    this.menus.edit.beforeOpen = () => this.refreshMenu('edit');
    this.menus.view.beforeOpen = () => this.refreshMenu('view');

    this.details = new DetailsOverlay();

    // The reference pictures: on this device only, one board, panel and view for the page.
    const board = new ReferenceBoard(opts.referenceScope);
    const panel = new ReferencePanel(board);
    const view = new ReferenceView(board, viewer);
    const arrange = new ArrangeButton(board);
    arrange.mount(edge);
    panel.setPlacer((id, x, y) => view.placeAt(id, x, y));
    this.reference = { board, panel, view, arrange };
    this.material = new MaterialPanel(viewer, opts.material);
    this.library = new AssetLibrary();
    this.ownDom = added();
    this.listen();
  }

  /** What the shell listens to and runs on its own: not while the page is asleep. */
  private listen(): void {
    const { board, panel, view } = this.reference;
    this.offIntake = installIntake(board, () => panel.isOpen(), (items, x, y) => {
      // Dropped on the view: each picture stands where it fell, side by side if there were several.
      let n = 0;
      for (const item of items) if (view.placeAt(item.id, x + n * 24, y + n * 24)) n++;
      return n > 0;
    });
    // Switched on after being off: the lines are read afresh at once.
    this.offSettings = settings.onChange(() => this.paintDetails());
    this.timer = window.setInterval(() => this.paint(), PASS_MS);
    // The leaving guard: whoever is in front writes what it keeps.
    this.offLeaving = beforeLeaving(async () => (await this.front?.beforeLeavingPage()) ?? true);
  }

  private unlisten(): void {
    this.offIntake?.();
    this.offIntake = null;
    this.offSettings?.();
    this.offSettings = null;
    window.clearInterval(this.timer);
    this.timer = 0;
    this.offLeaving?.();
    this.offLeaving = null;
  }

  /** The strip's chrome button names what it does now; the page's chrome toggle calls this (`chrome.onChange`). */
  readonly chromeChanged = (hidden: boolean): void => this.strip.setChromeHidden(hidden);

  // --- workspaces ---------------------------------------------------------------------------

  /** Host a workspace. The first one is the front until `go` says otherwise (`start`). */
  register(ws: Workspace): void {
    this.spaces.set(ws.id, ws);
  }

  /** The id of the workspace in front, or null before `start`. */
  now(): WorkspaceId | null {
    return this.front?.id ?? null;
  }

  /** The workspaces the shell hosts, in the order they were registered. */
  hosted(): WorkspaceId[] {
    return [...this.spaces.keys()];
  }

  /**
   * Which panels each workspace had open, kept and opened again as the page
   * is left and returns: begun by the page once its panels exist.
   */
  beginPanels(id: WorkspaceId): void {
    this.panels ??= new WorkspacePanels(id);
  }

  /** The workspace in front takes the page: its menus, path, readout and history, and the leaving guard. */
  start(id: WorkspaceId): void {
    const ws = this.spaces.get(id);
    if (!ws) throw new Error(`Studio: no workspace "${id}"`);
    this.front = ws;
    ws.enter(null);
    this.refresh();
  }

  /**
   * To another workspace, by the path, the View menu or the keys. Nothing is
   * asked of the person: it is refused (false) when the one in front or the
   * one asked for says so (mid-stroke), and a step to a workspace the shell
   * does not host is the front's own `path()` step, run as it is.
   */
  go(to: WorkspaceId): boolean {
    const from = this.front;
    if (!from || to === from.id || this.asleep) return false;
    const next = this.spaces.get(to);
    if (!next) {
      const step = from.path()[to];
      if (!step || !('action' in step)) return false;
      step.action();
      return true;
    }
    if (from.mayLeave?.(to) === false || next.mayEnter?.(from.id) === false) return false;
    from.leave(to);
    next.enter(from.id);
    this.front = next;
    this.silence(from, next);
    // Idempotent where the workspace has done it itself in its own order (Sculpt's Present).
    this.panels?.go(to);
    this.refresh();
    return true;
  }

  /**
   * The workspace in front changed by its own doing (a test's call, an
   * address that opens Paint): the shell follows, and repaints the path and
   * the menus. Where the workspace is not hosted nothing happens.
   */
  follow(id: WorkspaceId): void {
    const ws = this.spaces.get(id);
    if (!ws) return;
    const from = this.front;
    this.front = ws;
    if (from && from !== ws) this.silence(from, ws);
    this.refresh();
  }

  /** The path as the strip has it: the front, and what each other step does. */
  way(): { current: WorkspaceId; steps: Partial<Record<WorkspaceId, PathStep>> } {
    const ws = this.front;
    if (!ws) return { current: 'sculpt', steps: {} };
    const steps: Partial<Record<WorkspaceId, PathStep>> = {};
    for (const id of this.spaces.keys()) if (id !== ws.id) steps[id] = { action: () => void this.go(id) };
    return { current: ws.id, steps: { ...steps, ...ws.path() } };
  }

  /** The panels the workspace left does not have in common with the one entered are silenced; the entered one's are woken. */
  private silence(from: Workspace, next: Workspace): void {
    const own = (ws: Workspace): SidePanel[] => [...ws.panels.left, ...ws.panels.right];
    const keep = new Set(own(next));
    for (const p of own(from)) if (!keep.has(p)) p.setSuspended(true);
    for (const p of keep) p.setSuspended(false);
  }

  // --- what the shell paints -------------------------------------------------------------------

  /** The path, the menus, the readout and the details, from the workspace in front. */
  refresh(): void {
    const ws = this.front;
    if (!ws || this.disposed) return;
    const way = this.way();
    this.strip.setWorkspace(way.current, way.steps);
    this.refreshMenus();
    ws.shown?.();
    this.library.refresh();
    this.paint();
  }

  /** The readout and the details, written again now (the workspace's work moved them); written only where they changed. */
  repaint(): void {
    this.paint();
  }

  private paint(): void {
    const ws = this.front;
    if (!ws || this.asleep) return;
    this.strip.setReadout(ws.readout());
    ws.tick?.();
    this.paintDetails();
  }

  private paintDetails(): void {
    const ws = this.front;
    if (!ws || !this.details.isOn()) return;
    const lines = ws.details();
    if (lines) this.details.set(lines);
  }

  /** Read the three menus again from the workspace in front (a role became known, a workspace changed). */
  refreshMenus(): void {
    for (const kind of ['file', 'edit', 'view'] as const) this.refreshMenu(kind);
  }

  private refreshMenu(kind: 'file' | 'edit' | 'view'): void {
    const ws = this.front;
    if (!ws) return;
    this.menus[kind].setItems(ws.menus()[kind]);
  }

  /** The edge column's Undo and Redo, read again (polled by the workspace where it changes without telling). */
  refreshHistory(): void {
    this.edge.history.refresh();
  }

  // --- putting the page away (Armature suspended on its own page) ------------------------------

  /**
   * The whole shell out of sight and hearing: its DOM, its panels, its timer,
   * its intake and its guard. Used where a page puts its only workspace away
   * (Armature's suspend); a page that hosts several never needs it, the
   * workspaces' own enter and leave do the switching.
   */
  sleep(): void {
    if (this.asleep) return;
    for (const m of Object.values(this.menus)) m.close();
    this.library.close();
    this.asleep = true;
    this.unlisten();
    this.panels?.pause();
    for (const p of this.sharedPanels()) p.setSuspended(true);
    for (const p of this.front ? [...this.front.panels.left, ...this.front.panels.right] : []) p.setSuspended(true);
    this.hidden.hide(this.ownDom.filter((el) => el.isConnected));
  }

  wake(): void {
    if (!this.asleep) return;
    this.asleep = false;
    this.hidden.show();
    for (const p of this.sharedPanels()) p.setSuspended(false);
    for (const p of this.front ? [...this.front.panels.left, ...this.front.panels.right] : []) p.setSuspended(false);
    this.panels?.resume();
    this.listen();
    // The path and the menus are as they were left (nothing rebuilt: the rows carry listeners).
    this.paint();
  }

  isAsleep(): boolean {
    return this.asleep;
  }

  private sharedPanels(): SidePanel[] {
    return [this.material, this.reference.panel];
  }

  /** The elements the shell put on the page (for a host that hides or counts them). */
  elements(): HTMLElement[] {
    return this.ownDom.filter((el) => el.isConnected);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unlisten();
    this.panels?.dispose();
    this.panels = null;
    this.reference.arrange.dispose();
    this.reference.view.dispose();
    this.reference.panel.dispose();
    this.reference.board.dispose();
    this.material.dispose();
    this.library.dispose();
    this.details.dispose();
    for (const m of Object.values(this.menus)) m.dispose();
    this.edge.history.dispose();
    this.edge.el.remove();
    this.strip.dispose();
    this.hidden.show();
  }
}
