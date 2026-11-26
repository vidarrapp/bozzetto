import { chordLabel, keymap } from '../../ui/keymap';
import { settings } from '../../ui/settings';
import type { MenuItem } from './TopMenu';
import { panelIsOpen, setPanel } from './panelMemory';
import type { PathStep, Workspace } from './TitleStrip';

/** The hotkey bound to an action as the guide writes it, read on each open so a rebind shows; '' when unbound. */
export const keyFor =
  (id: string) =>
  (): string => {
    const chord = keymap.chordFor(id);
    return chord ? chordLabel(chord) : '';
  };

/** What the View menu acts on, where the mode has it; an item without its hook is left out. */
export interface ViewHooks {
  frameSelected?: () => void;
  frameAll?: () => void;
  /** The action whose key Frame all shows, where it is not view.frameAll (the viewer frames with F). */
  frameAllKey?: string;
  wireframe?: { get: () => boolean; toggle: () => void };
  groupColors?: { get: () => boolean; toggle: () => void };
  /** The shadows switch (Shift+S). */
  shadows?: { get: () => boolean; toggle: () => void };
  /**
   * Move light: arms the next drag on the view as a move of the key light
   * (one drag, then it lets go; Esc or the item again cancels). The touch way to
   * what holding L does.
   */
  moveLight?: { get: () => boolean; toggle: () => void };
  /** The details overlay (a setting: ui/DetailsOverlay); where the view has one. */
  details?: boolean;
  /** The proportion guide beside the subject (a setting of the scene; sculpt/bridge/guide.ts). */
  proportionGuide?: { get: () => boolean; toggle: () => void };
  /** The Reference pictures in the view, shown or hidden all at once. */
  referenceShow?: { get: () => boolean; toggle: () => void };
  /** Arrange (unlock) the pictures in the view; `key` says the mode answers its hotkey. */
  referenceArrange?: { get: () => boolean; toggle: () => void; key?: boolean };
  /** The tool bar's digits: a setting, so the mode that has a tool bar says so. */
  toolKeys?: boolean;
  /** Reset tool bar: the default order back on this workspace's bar (greyed out while it is the default). */
  toolBar?: { isDefault: () => boolean; reset: () => void };
  /** The Asset library window, a toggle (no key for now). */
  assetLibrary?: { get: () => boolean; toggle: () => void };
  /** The panels this mode has, in the order of the menu: [id, name]. */
  panels: Array<[id: string, name: string, enabled?: () => boolean]>;
  /** Keep the panels as given, not in the order of the other places' tabs (the viewer's Lighting is at the right). */
  panelsInOrder?: boolean;
  hideInterface: () => void;
  /**
   * The workspaces, as the path in the strip has them (the same current and
   * steps, read on each open): the way to the others from a window too
   * narrow for the path. The one you are in and a step that cannot be taken
   * show greyed out, with the reason. Left out where the place has no path.
   */
  workspace?: () => { current: Workspace; steps: Partial<Record<Workspace, PathStep>> };
  /** The workspace keys (ws.*, Shift+1 to 4) are heard here: Sculpt's page; the others' menus show none. */
  workspaceKeys?: boolean;
}

/** The panels in tab order (the left side, then the right). */
const PANEL_ORDER = ['scene', 'model', 'layers', 'armature', 'lighting', 'camera', 'render', 'frames', 'project', 'sculpt', 'material', 'reference', 'output'];
const panelRank = (id: string): number => {
  const i = PANEL_ORDER.indexOf(id);
  return i < 0 ? PANEL_ORDER.length : i;
};

/**
 * The View menu of the title strip, the same shape in every place: framing,
 * the viewport's own switches, which panels are open, Hide interface, the
 * workspaces; each group only where the place has it.
 * Each item is the existing command - the same function its hotkey runs -
 * with that hotkey shown at the right; the switches carry a check.
 */
export function viewMenuItems(h: ViewHooks): MenuItem[] {
  const items: MenuItem[] = [];
  const group = (...part: MenuItem[]): void => {
    if (!part.length) return;
    if (items.length) items.push({ separator: true });
    items.push(...part);
  };
  const frames: MenuItem[] = [];
  if (h.frameSelected) frames.push({ label: 'Frame selected', key: keyFor('view.frame'), action: h.frameSelected });
  if (h.frameAll) frames.push({ label: 'Frame all', key: keyFor(h.frameAllKey ?? 'view.frameAll'), action: h.frameAll });
  group(...frames);

  const looks: MenuItem[] = [];
  const wire = h.wireframe;
  if (wire) looks.push({ label: 'Wireframe', key: keyFor('view.wireframe'), checked: wire.get, toggle: () => wire.toggle() });
  const shadows = h.shadows;
  if (shadows) looks.push({ label: 'Shadows', key: keyFor('view.shadows'), checked: shadows.get, toggle: () => shadows.toggle() });
  if (h.details) {
    looks.push({
      label: 'Details',
      key: keyFor('view.details'),
      checked: () => settings.get('details') === 'on',
      toggle: (on) => settings.set('details', on ? 'on' : 'off'),
    });
  }
  const light = h.moveLight;
  if (light) looks.push({ label: 'Move light', checked: light.get, toggle: () => light.toggle() });
  const ruler = h.proportionGuide;
  if (ruler) looks.push({ label: 'Proportion guide', checked: ruler.get, toggle: () => ruler.toggle() });
  const colours = h.groupColors;
  if (colours) {
    looks.push({ label: 'Poly group colours', key: keyFor('groups.show'), checked: colours.get, toggle: () => colours.toggle() });
  }
  const refs = h.referenceShow;
  if (refs) looks.push({ label: 'References', checked: refs.get, toggle: () => refs.toggle() });
  const arrange = h.referenceArrange;
  if (arrange) {
    looks.push({ label: 'Arrange references', key: arrange.key ? keyFor('view.arrange') : undefined, checked: arrange.get, toggle: () => arrange.toggle() });
  }
  if (h.toolKeys) {
    looks.push({
      label: 'Hotkeys on tools',
      checked: () => settings.get('toolKeys') === 'on',
      toggle: (on) => settings.set('toolKeys', on ? 'on' : 'off'),
    });
  }
  const bar = h.toolBar;
  if (bar) looks.push({ label: 'Reset tool bar', enabled: () => !bar.isDefault(), action: bar.reset });
  group(...looks);

  const hide = h.hideInterface;
  const library = h.assetLibrary;
  group(
    ...(h.panelsInOrder ? [...h.panels] : [...h.panels].sort((a, b) => panelRank(a[0]) - panelRank(b[0]))).map(
      ([id, name, enabled]): MenuItem => ({
        label: `${name} panel`,
        enabled,
        checked: () => panelIsOpen(id),
        toggle: (on) => setPanel(id, on),
      }),
    ),
    ...(library ? [{ label: 'Asset library', checked: library.get, toggle: () => library.toggle() } satisfies MenuItem] : []),
    { label: 'Hide interface', key: keyFor('ui.chrome'), action: hide },
  );

  // The workspaces, as the path in the strip has them: the one you are in
  // and the ones that are not reachable stay in the list, greyed out, the
  // reason where there is one.
  if (h.workspace) {
    const way = h.workspace;
    const spaces: MenuItem[] = [];
    for (const [id, label] of [['armature', 'Armature'], ['sculpt', 'Sculpt'], ['paint', 'Paint'], ['present', 'Present']] as const) {
      const step = (): PathStep | undefined => way().steps[id];
      const here = (): boolean => way().current === id;
      spaces.push({
        label,
        key: h.workspaceKeys ? keyFor(`ws.${id}`) : undefined,
        enabled: () => !here() && 'action' in (step() ?? {}),
        hint: () => {
          if (here()) return 'Where you are';
          const s = step();
          return s && 'unavailable' in s ? s.unavailable : '';
        },
        action: () => {
          const s = step();
          if (s && 'action' in s) s.action();
        },
      });
    }
    group(...spaces);
  }
  return items;
}
