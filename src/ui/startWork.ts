import { requireSaving } from './deviceChoice';
import { failNotice } from '../sculpt/ui/statusToast';
import { markOpen } from './openToken';

/**
 * The ways to start work, as the gallery's Create card and the pages' File
 * menu both offer them: a new sculpt, a new armature, an OBJ opened in Sculpt.
 */

/**
 * Create > Import OBJ: the picked file opens in Sculpt as a new scene, its
 * one object imported as File > Import OBJ imports one (welded, sized as
 * every import is). The file goes over in IndexedDB (bridge/objHandoff),
 * since Sculpt is another page load. Like New Sculpt it replaces the work
 * in progress, so it asks first when there is some to lose, and tells the
 * tab it asked (ui/openToken), or Sculpt would ask again.
 */
export async function importObj(file: File): Promise<void> {
  if (!/\.obj$/i.test(file.name)) {
    failNotice(`"${file.name}" is not an .obj file.`);
    return;
  }
  const [store, handoffs] = await Promise.all([import('../sculpt/bridge/ScenePersist'), import('../sculpt/bridge/objHandoff')]);
  const name = handoffs.objName(file.name);
  // The file crosses to Sculpt through the device's storage, so it needs saving on.
  if (!(await requireSaving('Import OBJ needs to keep the file on this device.'))) return;
  const hasWork = await store.hasSavedScene().catch(() => false);
  const atRisk = hasWork && !(await inProject(store));
  if (atRisk && !confirm(`Open "${name}" as a new sculpt? The work in progress on this device will be replaced.`)) return;
  let id: string;
  try {
    id = (await handoffs.saveObjHandoff({ name: file.name, text: await file.text() })).id;
  } catch (err) {
    failNotice(`Could not open "${name}": this browser would not hold the file (${err instanceof Error ? err.message : String(err)}).`);
    return;
  }
  markOpen('obj', id);
  window.location.href = '/?sculpt=1&obj=1';
}

/**
 * Start a fresh sculpt. Sculpt mode restores the autosave on entry, so
 * without this the tile quietly RESUMED the work in progress instead of
 * starting anything new. Ask, then clear the scene and its look before
 * going in.
 */
export async function startSculpt(): Promise<void> {
  const store = await import('../sculpt/bridge/ScenePersist');
  // The scene itself, not its snapshot: the picture is only written on
  // the way out through the gallery link, so a reload, a closed tab or
  // iOS evicting the page left saved work that this silently RESUMED
  // instead of replacing - the one thing this tile promises not to do.
  const hasWork = await store.hasSavedScene().catch(() => false);
  // Work that is its project's as saved (inProject) loses nothing: there
  // is no card for it, and no question either.
  const atRisk = hasWork && !(await inProject(store));
  if (atRisk && !confirm('Start a new sculpt? The work in progress on this device will be replaced.')) {
    return;
  }
  if (hasWork) {
    await store.clearSavedScene();
    // The look too: "new" has to mean new. Leaving it behind is how a
    // light set flat in one session kept arriving in the next one, with
    // a fresh sphere lit by it and no obvious cause.
    await store.clearSculptLook();
  }
  window.location.href = '/?sculpt=1';
}

/** Start a fresh armature, replacing the one in progress after asking. */
export async function startArmature(): Promise<void> {
  const store = await import('../armature/persist');
  const hasWork = await store.hasArmature().catch(() => false);
  if (hasWork && !confirm('Start a new armature? The one in progress on this device will be replaced.')) {
    return;
  }
  if (hasWork) await store.clearArmature();
  window.location.href = '/?armature=1';
}


/**
 * Is the sculpt autosave its project's as saved, with nothing else of it
 * only here? A Save to library went up (or the project was opened),
 * nothing has been edited since (SavedScene.synced), and no copy a failed
 * save kept is waiting to go up - the project's own card opens the same
 * work. The autosave stays, as the recovery copy it is; it only needs no
 * card of its own.
 */
export async function inProject(store: typeof import('../sculpt/bridge/ScenePersist')): Promise<boolean> {
  const status = await store.loadSceneStatus();
  return !!status?.synced && !!status.project && !status.unsent;
}


/** Ask for one .obj file and open it as a new sculpt (the pages' File > Import OBJ…). */
export function chooseObj(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.obj';
  input.hidden = true;
  input.className = 'create-obj-input';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.remove();
    if (file) void importObj(file);
  });
  document.body.appendChild(input);
  input.click();
}
