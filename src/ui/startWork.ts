import { requireSaving } from './deviceChoice';
import { failNotice } from '../sculpt/ui/statusToast';
import { markOpen } from './openToken';
import { askWindow } from './askWindow';

/**
 * The ways to start work, as the gallery's Create card and the pages' File
 * menu both offer them: a new scene, a new armature, a model opened in Sculpt.
 */

/**
 * Create > Import model: the picked file (.obj, .glb, .gltf, .stl, .ply) opens
 * in Sculpt as a new scene, its one object imported as File > Import model
 * imports one (welded, sized as every import is). The file goes over in
 * IndexedDB (bridge/objHandoff), as bytes, since Sculpt is another page
 * load. Like New scene it replaces the work
 * in progress, so it asks first when there is some to lose, and tells the
 * tab it asked (ui/openToken), or Sculpt would ask again.
 */
export async function importObj(file: File): Promise<void> {
  const { modelFormat } = await import('../sculpt/bridge/modelImport');
  const format = modelFormat(file.name);
  if (!format) {
    failNotice(`"${file.name}" is not a model Sculpt reads. Use .obj, .glb, .stl or .ply.`);
    return;
  }
  const [store, handoffs] = await Promise.all([import('../sculpt/bridge/ScenePersist'), import('../sculpt/bridge/objHandoff')]);
  const name = handoffs.objName(file.name);
  // The file crosses to Sculpt through the device's storage, so it needs saving on.
  if (!(await requireSaving('Import model needs to keep the file on this device.'))) return;
  const hasWork = await store.hasSavedScene().catch(() => false);
  const atRisk = hasWork && !(await inProject(store));
  if (
    atRisk &&
    !(await askWindow({
      title: `Open "${name}" as a new scene?`,
      text: 'The work in progress on this device will be replaced.',
      yes: 'Replace',
      danger: true,
    }))
  ) {
    return;
  }
  let id: string;
  try {
    id = (await handoffs.saveObjHandoff(format === 'obj' ? { name: file.name, text: await file.text() } : { name: file.name, bytes: await file.arrayBuffer(), format })).id;
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
  const armatures = await import('../armature/persist');
  // The scene's armature goes with it: a new scene has none.
  const hasWork = (await store.hasSavedScene().catch(() => false)) || (await armatures.hasArmature());
  // Work that is its project's as saved (inProject) loses nothing: there
  // is no card for it, and no question either.
  const atRisk = hasWork && !(await inProject(store));
  if (
    atRisk &&
    !(await askWindow({
      title: 'Start a new scene?',
      text: 'The work in progress on this device will be replaced.',
      yes: 'Start new',
      danger: true,
    }))
  ) {
    return;
  }
  if (hasWork) {
    await store.clearSavedScene(true);
    await armatures.clearArmature();
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
  if (
    hasWork &&
    !(await askWindow({
      title: 'Start a new armature?',
      text: 'The one in progress on this device will be replaced.',
      yes: 'Start new',
      danger: true,
    }))
  ) {
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


/** Ask for one model file and open it as a new scene (the pages' File > Import model…). */
export function chooseObj(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.obj,.glb,.gltf,.stl,.ply';
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
