import { mayStore } from './deviceStorage';

/**
 * The quiet word after a scene's or an armature's name in the title strip:
 * where its work is kept.
 *
 *   Saved               it matches its last save to the library
 *   Edited              it has changes the library does not
 *   Kept on this device only the autosave holds it (keeping on device is on)
 *   nothing             saving is off: the strip's own "Not saved" note
 *                       says so (TitleStrip), once
 */
export function sceneStateWord(s: { linked: boolean; synced: boolean }): string | null {
  if (s.linked && s.synced) return 'Saved';
  if (!mayStore()) return null;
  return s.linked ? 'Edited' : 'Kept on this device';
}
