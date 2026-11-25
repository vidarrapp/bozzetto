import type { Box3, Mesh } from 'three';
import type { Workspace, WorkspaceId } from '../studio/Studio';
import type { SidePanel } from '../sculpt/ui/SidePanel';
import { statusToast, type StatusToast } from '../sculpt/ui/statusToast';
import type { ArmatureHost } from './host';
import type { ArmatureMount } from './mode';

/**
 * Armature as a workspace of the Sculpt page, loaded when it is first entered
 * (docs/plans/armature-workspace.md, step C).
 *
 * This file is the only part of Armature the page carries from its start: a
 * few hundred bytes of facade the shell registers beside Sculpt, Paint and
 * Present. Its code (armature/mode.ts and what it pulls in: the rigs, the
 * handles, the mannequin loader) and the four mannequin files are fetched by
 * the first `enter`, and the switch is not held up by it: the path shows
 * Armature as current at once, a quiet notice says "Loading Armature…", and a
 * way back to another workspace is as open as ever. Left before the load ends,
 * the workspace finishes loading put away.
 *
 * Until it has been entered once, the page has no armature and nothing of it
 * is drawn. From then on the mannequin is part of the scene: shown with its
 * handles in Armature, and as it stands in the other workspaces until a figure
 * has been made from it (ArmatureHost.figureMade).
 */

/** What the page does for the workspace in front, besides what the shell does. */
export interface ArmaturePage {
  host: ArmatureHost;
  /**
   * Put Sculpt away for Armature (`true`): its tools and its ring, its keys and its pointer, the
   * Paint workspace if that is what it was in. Back (`false`): what Sculpt had.
   */
  hold(on: boolean, from: WorkspaceId | null): void;
  /** The armature's state changed in a way the page's panels show (the Scene row, the Model tab's Figure section). */
  changed(): void;
}

/** What the page asks of the armature, whether or not its code has been loaded. */
export interface ArmatureSlot {
  /** The workspace to register with the shell. */
  workspace: Workspace;
  /** Armature has been loaded into this page: the scene has an armature, and its mannequin is drawn. */
  present(): boolean;
  /** Resolves once the load a first entry began has ended (at once when none began). */
  ready(): Promise<void>;
  /** The loaded workspace's own handle, or null before the first entry. */
  mount(): ArmatureMount | null;
  /** The armature's name, for the Scene tab. */
  name(): string;
  /** What the mannequin is called (the label of the Armature tab's Preset select), for the Scene row. */
  label(): string;
  /** The Scene row's eye: whether the mannequin is shown outside Armature. */
  shown(): boolean;
  setShown(shown: boolean): void;
  /** The mannequin's own material (the Material tab's Surface section); null before the load. */
  surface(): { albedo: string; roughness: number; metalness: number } | null;
  setSurface(patch: Partial<{ albedo: string; roughness: number; metalness: number }>): void;
  /** The mannequin's mesh while it is drawn outside Armature (no figure yet), for a press that may land on it; null otherwise. */
  mannequin(): Mesh | null;
  /** The posed mannequin's world box added into `out`, while it is drawn; false when it is not. */
  shadowBox(out: Box3): boolean;
  /** A figure was made, or the step that made it undone: the mannequin goes or comes back, and the panels follow. */
  figureChanged(): void;
  /** The posed mannequin as world triangles (Remesh to a figure); null before the load. */
  bake(): { positions: Float32Array; indices: Uint32Array } | null;
}

export function armatureWorkspace(page: ArmaturePage): ArmatureSlot {
  const { host } = page;
  let mount: ArmatureMount | null = null;
  let loading: Promise<void> | null = null;
  /** The workspace is in front, or on its way there. */
  let wanted = false;
  let notice: StatusToast | null = null;
  const none: Workspace['panels'] = { left: [], right: [] };
  const panels = (): Workspace['panels'] => mount?.workspace.panels ?? none;

  const load = async (): Promise<void> => {
    notice = statusToast('Loading Armature…');
    try {
      const { mountArmatureMode } = await import('./mode');
      mount = await mountArmatureMode(host.viewer, host);
      notice.clear();
      notice = null;
      if (!wanted) {
        // Left before it was ready: it stands put away, as any visit's end leaves it.
        for (const p of panels().left.concat(panels().right) as SidePanel[]) p.setSuspended(true);
        mount.workspace.leave('sculpt');
      } else {
        // The panels it had open last time open now that they exist.
        host.studio.panels?.reapply();
      }
      host.studio.refresh();
      page.changed();
    } catch (err) {
      console.error(err);
      notice?.fail('Armature could not be loaded. Check the connection and try again.');
      notice = null;
      loading = null;
      if (wanted) host.studio.go('sculpt');
    }
  };

  const workspace: Workspace = {
    id: 'armature',
    keyMode: 'armature',
    // Until it is loaded there is nothing of Armature's to offer: the menus are empty, the path is the shell's.
    menus: () => mount?.workspace.menus() ?? { file: [], edit: [], view: [] },
    path: () => mount?.workspace.path() ?? {},
    get panels() {
      return panels();
    },
    readout: () => mount?.workspace.readout() ?? { name: null, state: null },
    details: () => mount?.workspace.details() ?? null,
    history: {
      undo: () => mount?.workspace.history.undo(),
      redo: () => mount?.workspace.history.redo(),
      canUndo: () => mount?.workspace.history.canUndo() ?? false,
      canRedo: () => mount?.workspace.history.canRedo() ?? false,
    },
    mayLeave: (to) => mount?.workspace.mayLeave?.(to) ?? true,
    enter: (from) => {
      wanted = true;
      page.hold(true, from);
      if (mount) mount.workspace.enter(from);
      else loading ??= load();
    },
    leave: (to) => {
      wanted = false;
      mount?.workspace.leave(to);
      page.hold(false, to);
    },
    beforeLeavingPage: () => mount?.workspace.beforeLeavingPage() ?? true,
  };

  return {
    workspace,
    present: () => mount !== null,
    ready: () => loading ?? Promise.resolve(),
    mount: () => mount,
    name: () => mount?.armatureName() ?? 'Armature',
    label: () => mount?.label() ?? 'Armature',
    shown: () => mount?.shown() ?? true,
    setShown: (shown) => {
      mount?.setShown(shown);
      page.changed();
    },
    surface: () => mount?.surface() ?? null,
    setSurface: (patch) => mount?.setSurface(patch),
    mannequin: () => mount?.outside() ?? null,
    shadowBox: (out) => mount?.shadowBox(out) ?? false,
    figureChanged: () => {
      if (!mount) return;
      mount.showOutside(!host.figureMade());
      mount.figureChanged();
      page.changed();
    },
    bake: () => mount?.bake() ?? null,
  };
}
