import { originOf } from '../../ui/origin';
import { showPreferences } from '../../ui/Preferences';
import type { KeyMode } from '../../ui/keymap';
import type { MenuItem } from './TopMenu';

/**
 * The shape every title strip shares: File, Edit, View, Moderation (the
 * viewer, when it has an item), Help. This file has the two that differ
 * most between places, File and Edit, as groups in one fixed order; View
 * is viewMenu.ts and Help is help/menu.ts. A place gives the items it has
 * and the rest are left out, not shown greyed out.
 */

/** Groups joined by one line each; an empty group is skipped. */
export function joinGroups(...groups: Array<MenuItem[] | undefined>): MenuItem[] {
  const out: MenuItem[] = [];
  for (const g of groups) {
    if (!g?.length) continue;
    if (out.length) out.push({ separator: true });
    out.push(...g);
  }
  return out;
}

/** What File holds, in its order. Close is always last, with where it goes. */
export interface FileGroups {
  /** New sculpt / New armature, Open…. */
  start?: MenuItem[];
  /** Save file, Save to library, Keep on this device (Present's one Save). */
  save?: MenuItem[];
  /** Import OBJ…, Z-up OBJ import, Load model…, Export OBJ, then the ways to another place: Send to Sculpt, New sculpt from this, Edit in Present. */
  transfer?: MenuItem[];
  /** Publish…. */
  publish?: MenuItem[];
  /** Close: the action; the hint is the page the person came from. */
  close: () => void | Promise<void>;
  /** Where Close goes, as a hint; the page the person came from unless the place says (the viewer's origin changes). */
  closeHint?: () => string;
}

/** The File menu's rows: the groups in their one order, Close last. */
export function fileMenuItems(g: FileGroups): MenuItem[] {
  return joinGroups(g.start, g.save, g.transfer, g.publish, [{ label: 'Close', hint: g.closeHint ?? originOf().hint, action: g.close }]);
}

/** Edit: Undo and Redo where the place has them, the place's own items, then Preferences… last. */
export function editMenuItems(g: { history?: MenuItem[]; own?: MenuItem[]; mode: KeyMode }): MenuItem[] {
  return joinGroups(g.history, g.own, [{ label: 'Preferences…', action: () => showPreferences(g.mode) }]);
}
