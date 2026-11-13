/**
 * Which panel was open on each side, kept per mode (Sculpt and Armature
 * each have their own), so a visit starts as the last one ended.
 *
 * The panels announce themselves on 'bozzetto:panel-open' and
 * 'bozzetto:panel-close' ({id, side}); this listens, keeps the latest open
 * id per side, and writes it down. Starting it opens what was stored, by
 * 'bozzetto:panel-set', which each panel answers to by its id. Stored state
 * is a list of ids; of two on one side only the first is opened (an older
 * or hand-edited store; the panels would close one another anyway).
 */

import { deviceStore } from '../../ui/deviceStorage';

/** The panels' ids by side, as they announce themselves ('settings' is the Render panel). */
const SIDES: Record<string, 'left' | 'right'> = {
  scene: 'left',
  model: 'left',
  material: 'left',
  armature: 'left',
  sculpt: 'right',
  settings: 'right',
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

/** Open what `mode` last had open, then keep its record current. Returns the way out. */
export function rememberPanels(mode: string): () => void {
  const open: Partial<Record<'left' | 'right', string>> = {};
  for (const id of storedPanels(mode)) open[SIDES[id]] = id;
  let applying = true;
  const save = (): void => {
    if (applying) return;
    try {
      const ids = Object.values(open).filter((id): id is string => !!id);
      if (ids.length) deviceStore.set(key(mode), JSON.stringify(ids));
      else deviceStore.remove(key(mode));
    } catch {
      // The panels still work; they just start closed next time.
    }
  };
  const onOpen = (e: Event): void => {
    const d = (e as CustomEvent<{ id?: string; side?: string }>).detail;
    const side = d?.id ? SIDES[d.id] : undefined;
    if (!d?.id || !side) return;
    open[side] = d.id;
    save();
  };
  const onClose = (e: Event): void => {
    const d = (e as CustomEvent<{ id?: string }>).detail;
    const side = d?.id ? SIDES[d.id] : undefined;
    if (!d?.id || !side || open[side] !== d.id) return;
    delete open[side];
    save();
  };
  window.addEventListener('bozzetto:panel-open', onOpen);
  window.addEventListener('bozzetto:panel-close', onClose);
  for (const id of Object.values(open)) {
    if (id) window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id, open: true } }));
  }
  applying = false;
  return () => {
    window.removeEventListener('bozzetto:panel-open', onOpen);
    window.removeEventListener('bozzetto:panel-close', onClose);
  };
}

/** Open or close a panel by its id: the View menu's panel items. */
export function setPanel(id: string, open: boolean): void {
  window.dispatchEvent(new CustomEvent('bozzetto:panel-set', { detail: { id, open } }));
}

/** The class a panel's root carries, by the id it announces under. */
const ROOT: Record<string, string> = {
  scene: '.panel--scene',
  model: '.panel--model',
  material: '.panel--material',
  sculpt: '.panel--sculpt',
  armature: '.panel--armature',
  settings: '.panel--render',
  // The owner's Present of a published project (present/): its two own tabs.
  project: '.panel--project',
  output: '.panel--output',
};

/** Whether the panel with this id is open now. */
export function panelIsOpen(id: string): boolean {
  const root = document.querySelector(ROOT[id] ?? '.panel--none');
  return !!root && !root.classList.contains('panel--collapsed');
}
