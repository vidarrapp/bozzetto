import { withNamedStore } from './ScenePersist';

/**
 * The gallery's Create > Import OBJ, carried into Sculpt. The gallery and
 * Sculpt are separate page loads (`/?sculpt=1` boots the app afresh), so
 * the picked file goes through IndexedDB, as the Armature mode's figure
 * does (armature/persist SculptHandoff): the gallery puts it, and Sculpt
 * takes it on a boot whose address carries `?obj=1`, deleting it, so a
 * reload does not import it twice. Only a page of this site can put one;
 * the address alone brings nothing.
 */
export interface ObjHandoff {
  kind: 'bozzetto-obj';
  v: 1;
  /** Names this handoff, for the gallery's "asked already" (ui/openToken, `obj:<id>`). */
  id: string;
  /** The object's name: the file's, without `.obj`. */
  name: string;
  /** The file, as text. */
  text: string;
  /** Whether to turn a Z-up export to Y-up, as File > Import OBJ's toggle does. */
  zUp: boolean;
  savedAt: number;
}

// The same IndexedDB store the sculpt autosave uses, under a key of its own.
const STORE = 'scene';
const KEY = 'objHandoff';
/** Long enough for the tab to get there; one left behind by a page that never arrived is not taken later. */
const FRESH_MS = 10 * 60 * 1000;
/** The longest object name kept, as a scene's names are (sanitize.ts). */
const MAX_NAME = 200;

/** An object's name from a file's: no extension, no control characters, at most 200 characters. */
export function objName(fileName: string): string {
  const name = fileName
    .replace(/\.obj$/i, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME);
  return name || 'Imported';
}

/** Put the file for Sculpt to take. Throws when storage refuses it, which the gallery says. */
export async function saveObjHandoff(file: { name: string; text: string; zUp?: boolean }): Promise<ObjHandoff> {
  const rec: ObjHandoff = {
    kind: 'bozzetto-obj',
    v: 1,
    id: Math.random().toString(36).slice(2, 12),
    name: objName(file.name),
    text: file.text,
    zUp: file.zUp === true,
    savedAt: Date.now(),
  };
  await withNamedStore(STORE, 'readwrite', (s) => s.put(rec, KEY));
  return rec;
}

/**
 * Read the handoff and remove it. Null when there is none, when it is not
 * one (a record of another shape under the key), or when it is stale.
 */
export async function takeObjHandoff(): Promise<ObjHandoff | null> {
  try {
    const rec = (await withNamedStore(STORE, 'readonly', (s) => s.get(KEY))) as Partial<ObjHandoff> | undefined;
    if (!rec) return null;
    await withNamedStore(STORE, 'readwrite', (s) => s.delete(KEY));
    if (rec.kind !== 'bozzetto-obj' || typeof rec.text !== 'string' || typeof rec.id !== 'string') return null;
    if (typeof rec.savedAt !== 'number' || Math.abs(Date.now() - rec.savedAt) > FRESH_MS) return null;
    return {
      kind: 'bozzetto-obj',
      v: 1,
      id: rec.id,
      name: objName(typeof rec.name === 'string' ? rec.name : ''),
      text: rec.text,
      zUp: rec.zUp === true,
      savedAt: rec.savedAt,
    };
  } catch {
    return null;
  }
}
