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
  /** The shadows switch the Render panel has (Shift+S). */
  shadows?: { get: () => boolean; toggle: () => void };
  /** The tool bar's digits: a setting, so the mode that has a tool bar says so. */
  toolKeys?: boolean;
  /** The panels this mode has, in the order of the menu: [id, name]. */
  panels: Array<[id: string, name: string]>;
  hideInterface: () => void;
  /**
   * The workspaces, as the path in the strip has them (the same current and
   * steps, read on each open): the way to the others from a window too
   * narrow for the path. The one you are in and a step that cannot be taken
   * show greyed out, with the reason. Left out where the place has no path.
   */
  workspace?: () => { current: Workspace; steps: Partial<Record<Workspace, PathStep>> };
}

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
  const colours = h.groupColors;
  if (colours) {
    looks.push({ label: 'Poly group colours', key: keyFor('groups.show'), checked: colours.get, toggle: () => colours.toggle() });
  }
  if (h.toolKeys) {
    looks.push({
      label: 'Hotkeys on tools',
      checked: () => settings.get('toolKeys') === 'on',
      toggle: (on) => settings.set('toolKeys', on ? 'on' : 'off'),
    });
  }
  group(...looks);

  const hide = h.hideInterface;
  group(
    ...h.panels.map(
      ([id, name]): MenuItem => ({
        label: `${name} panel`,
        checked: () => panelIsOpen(id),
        toggle: (on) => setPanel(id, on),
      }),
    ),
    { label: 'Hide interface', key: keyFor('ui.chrome'), action: hide },
  );

  // The workspaces, as the path in the strip has them: the one you are in
  // and the ones that are not reachable stay in the list, greyed out, the
  // reason where there is one.
  if (h.workspace) {
    const way = h.workspace;
    const spaces: MenuItem[] = [];
    for (const [id, label] of [['armature', 'Armature'], ['sculpt', 'Sculpt'], ['present', 'Present']] as const) {
      const step = (): PathStep | undefined => way().steps[id];
      const here = (): boolean => way().current === id;
      spaces.push({
        label,
        key: id === 'present' ? keyFor('ui.present') : undefined,
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
