import { chordLabel, keymap } from '../../ui/keymap';
import { settings } from '../../ui/settings';
import type { MenuItem } from './TopMenu';
import { panelIsOpen, setPanel } from './panelMemory';

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
  wireframe?: { get: () => boolean; toggle: () => void };
  groupColors?: { get: () => boolean; toggle: () => void };
  /** The tool bar's digits: a setting, so the mode that has a tool bar says so. */
  toolKeys?: boolean;
  /** The panels this mode has, in the order of the menu: [id, name]. */
  panels: Array<[id: string, name: string]>;
  hideInterface: () => void;
  /**
   * The workspaces, as the path in the strip has them: the way to the
   * others from a window too narrow for the path. Each is left out where
   * the mode cannot go there.
   */
  armature?: () => void;
  sculpt?: { action: () => void; enabled?: () => boolean };
  present?: () => void;
}

/**
 * The View menu of the title strip, for Sculpt and Armature: framing, the
 * viewport's own switches, which panels are open, Hide interface, the workspaces.
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
  if (h.frameAll) frames.push({ label: 'Frame all', key: keyFor('view.frameAll'), action: h.frameAll });
  group(...frames);

  const looks: MenuItem[] = [];
  const wire = h.wireframe;
  if (wire) looks.push({ label: 'Wireframe', key: keyFor('view.wireframe'), checked: wire.get, toggle: () => wire.toggle() });
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

  const spaces: MenuItem[] = [];
  if (h.armature) spaces.push({ label: 'Armature', action: h.armature });
  if (h.sculpt) spaces.push({ label: 'Sculpt', action: h.sculpt.action, enabled: h.sculpt.enabled });
  if (h.present) spaces.push({ label: 'Present', key: keyFor('ui.present'), action: h.present });
  group(...spaces);
  return items;
}
