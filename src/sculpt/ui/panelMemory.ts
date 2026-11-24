/**
 * Which panel was open on each side, kept per workspace (Armature, Sculpt,
 * Paint, Present: WorkspacePanels, built by the shell), so a visit starts as
 * the last one ended.
 *
 * The panels announce themselves on 'bozzetto:panel-open' and
 * 'bozzetto:panel-close' ({id, side}); this listens, keeps the latest open
 * id per side, and writes it down. Starting it opens what was stored, by
 * 'bozzetto:panel-set', which each panel answers to by its id. Stored state
 * is a list of ids; of two on one side only the first is opened (an older
 * or hand-edited store; the panels would close one another anyway).
 */

import { deviceStore } from '../../ui/deviceStorage';

/** The panels' ids by side, as they announce themselves. */
const SIDES: Record<string, 'left' | 'right'> = {
  scene: 'left',
  model: 'left',
  armature: 'left',
  layers: 'left',
  material: 'right',
  reference: 'right',
  sculpt: 'right',
  // Present's own (Sculpt's page builds them; Armature's has none).
  lighting: 'left',
  camera: 'left',
  render: 'left',
  output: 'right',
};

const key = (mode: string): string => `bz.panels.${mode}`;

/** The ids stored for `mode`, at most one per side, known panels only. */
export function storedPanels(mode: string): string[] {
  let list: unknown = [];
  try {
    list = JSON.parse(deviceStore.get(key(mode)) ?? '[]');
  } catch {
    // A blocked or corrupt store: nothing was open.
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of list) {
    const side = typeof id === 'string' ? SIDES[id] : undefined;
    if (!side || seen.has(side)) continue;
    seen.add(side);
    out.push(id as string);
  }
  return out;
}

/** Open or close a panel by its id: the View menu's panel items. */
export function setPanel(id: string, open: boolean): void {
  window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id, open } }));
}

/** The class a panel's root carries, by the id it announces under. */
const ROOT: Record<string, string> = {
  scene: '.panel--scene',
  model: '.panel--model',
  layers: '.panel--layers',
  material: '.panel--material',
  reference: '.panel--reference',
  sculpt: '.panel--sculpt',
  armature: '.panel--armature',
  lighting: '.panel--lighting',
  camera: '.panel--camera',
  render: '.panel--render',
  frames: '.panel--frames',
  // The owner's Present of a published project (present/): its two own tabs.
  project: '.panel--project',
  output: '.panel--output',
};

/** Whether the panel with this id is open now. */
export function panelIsOpen(id: string): boolean {
  const root = document.querySelector(ROOT[id] ?? '.panel--none');
  return !!root && !root.classList.contains('panel--collapsed');
}

// --- The workspaces of the Sculpt page --------------------------------------------

export type WorkspaceKey = 'armature' | 'sculpt' | 'paint' | 'present';

/** The panels each workspace has: what a stored list may name for it. */
const OF: Record<WorkspaceKey, string[]> = {
  armature: ['armature', 'material', 'reference'],
  sculpt: ['scene', 'model', 'layers', 'sculpt', 'material', 'reference'],
  paint: ['scene', 'layers', 'sculpt', 'material', 'reference'],
  present: ['lighting', 'camera', 'render', 'material', 'output'],
};

/** What a workspace opens the first time (Sculpt as it always began: nothing). */
const FIRST_VISIT: Record<WorkspaceKey, string[]> = {
  armature: [],
  sculpt: [],
  paint: ['layers', 'sculpt'],
  present: ['output'],
};

/**
 * Sculpt, Paint and Present each remember their own panels, one a side,
 * kept on the device like the other modes'. `go` puts the one you leave
 * away (its record stays as it stood) and opens what the one you enter last
 * had. Nothing else in the switch opens or closes a panel; what the panels
 * do while it runs is not the person's doing and is not recorded.
 */
export class WorkspacePanels {
  private current: WorkspaceKey;
  private readonly open: Partial<Record<'left' | 'right', string>> = {};
  private applying = true;
  /** Not recording: the page is asleep (Studio.sleep). */
  private paused = false;
  /** What each workspace had when it was left, for a device that keeps nothing. */
  private readonly seen: Partial<Record<WorkspaceKey, string[]>> = {};

  private readonly onOpen = (e: Event): void => {
    const d = (e as CustomEvent<{ id?: string }>).detail;
    const side = d?.id ? SIDES[d.id] : undefined;
    if (this.applying || this.paused || !d?.id || !side || !OF[this.current].includes(d.id)) return;
    this.open[side] = d.id;
    this.save();
  };
  private readonly onClose = (e: Event): void => {
    const d = (e as CustomEvent<{ id?: string }>).detail;
    const side = d?.id ? SIDES[d.id] : undefined;
    if (this.applying || this.paused || !d?.id || !side || this.open[side] !== d.id) return;
    delete this.open[side];
    this.save();
  };

  constructor(start: WorkspaceKey) {
    this.current = start;
    window.addEventListener('bozzetto:panel-open', this.onOpen);
    window.addEventListener('bozzetto:panel-close', this.onClose);
    this.apply();
  }

  /** The workspace whose panels are up. */
  now(): WorkspaceKey {
    return this.current;
  }

  /** The ids a workspace opens now: what it last had, or its first visit's. */
  wanted(ws: WorkspaceKey): string[] {
    const kept = this.seen[ws];
    if (kept) return kept;
    let raw: string | null | undefined = null;
    try {
      raw = deviceStore.get(key(ws));
    } catch {
      // A blocked store: a first visit.
    }
    if (raw === null || raw === undefined) return FIRST_VISIT[ws];
    return storedPanels(ws).filter((id) => OF[ws].includes(id));
  }

  /** Leave the current workspace and open the panels of `to`. */
  go(to: WorkspaceKey): void {
    if (to === this.current) return;
    this.current = to;
    this.apply();
  }

  /** Open the current workspace's panels again: a panel that did not exist when it was entered is built now (Armature, loaded on first use). */
  reapply(): void {
    this.apply();
  }

  /** Stop recording what the panels do (the page is put away); `resume` carries on from the state they have. */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  dispose(): void {
    window.removeEventListener('bozzetto:panel-open', this.onOpen);
    window.removeEventListener('bozzetto:panel-close', this.onClose);
  }

  private apply(): void {
    this.applying = true;
    const want = this.wanted(this.current);
    for (const id of Object.values(this.open)) if (id && !want.includes(id)) setPanel(id, false);
    delete this.open.left;
    delete this.open.right;
    for (const id of want) {
      const side = SIDES[id];
      if (!side || this.open[side]) continue;
      this.open[side] = id;
      setPanel(id, true);
    }
    this.applying = false;
  }

  private save(): void {
    const ids = Object.values(this.open).filter((id): id is string => !!id);
    this.seen[this.current] = ids;
    try {
      deviceStore.set(key(this.current), JSON.stringify(ids));
    } catch {
      // The panels still work; they just start as they did next time.
    }
  }
}
