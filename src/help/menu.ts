import { chordLabel, keymap } from '../ui/keymap';
import type { MenuItem } from '../sculpt/ui/TopMenu';
import { ABOUT_TOPIC, showHelp } from './HelpWindow';

/** What Help.ts listens for: open or close the hotkey guide (the same as its key). */
export const HOTKEY_GUIDE_EVENT = 'bozzetto:hotkey-guide';

/** Ask the hotkey guide to open or close; the viewer's Help.ts answers it. */
export function toggleHotkeyGuide(): void {
  window.dispatchEvent(new Event(HOTKEY_GUIDE_EVENT));
}

/** The items of the Help menu in the top row of Sculpt and Armature. */
export function helpMenuItems(): MenuItem[] {
  return [
    { label: 'Help topics', action: () => showHelp() },
    {
      label: 'Hotkeys',
      key: () => {
        const chord = keymap.chordFor('ui.help');
        return chord ? chordLabel(chord) : '';
      },
      action: () => toggleHotkeyGuide(),
    },
    { label: 'About and credits', action: () => showHelp(ABOUT_TOPIC) },
  ];
}
