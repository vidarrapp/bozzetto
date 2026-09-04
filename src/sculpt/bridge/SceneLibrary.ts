import { openDb, withNamedStore, LIBRARY_STORE, LIBRARY_DATA_STORE } from './ScenePersist';
import { packScene, unpackScene } from './SceneFile';
import type { SavedScene } from './ScenePersist';

/**
 * The local scene library: sculpts you chose to keep, on this device.
 *
 * Deliberately beside the autosave rather than instead of it. The autosave
 * is one slot of work-in-progress that you never asked to save and would
 * hate to lose; the library is a shelf you put things on. They answer
 * different questions, so "New sculpt" still resumes the slot and nothing
 * about that behaviour changes.
 *
 * Metadata and geometry live in SEPARATE stores under the same id, the way
 * the autosave splits its snapshot from its scene. The gallery lists every
 * entry on load, and a list that dragged each scene's vertex arrays along
 * would cost tens of megabytes to draw a row of cards.
 */

/** A card's worth of information: everything but the geometry. */
export interface LibraryEntry {
  id: string;
  name: string;
  savedAt: number;
  objects: number;
  tris: number;
  /** Packed size in bytes, so the gallery can show what it is costing. */
  bytes: number;
  /** JPEG of the viewport when it was saved; absent if the capture failed. */
  thumb?: Blob;
}

const meta = <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  withNamedStore(LIBRARY_STORE, mode, op);

const data = <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
  withNamedStore(LIBRARY_DATA_STORE, mode, op);

/** `Sculpt 30 Aug 14:15` - the default name, and renameable afterwards. */
export function defaultSceneName(when = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const month = when.toLocaleString(undefined, { month: 'short' });
  return `Sculpt ${when.getDate()} ${month} ${p(when.getHours())}:${p(when.getMinutes())}`;
}

function newId(): string {
  // Enough entropy for a shelf on one device, and no dependency on
  // crypto.randomUUID, which older iPadOS Safari does not have.
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Put a scene on the shelf. Geometry is packed to the same format as a
 * `.bozz` file, so a library entry and a saved file are the same bytes -
 * exporting one later is a download, not a conversion.
 */
export async function saveToLibrary(
  scene: SavedScene,
  info: { name?: string; thumb?: Blob; objects: number; tris: number },
): Promise<LibraryEntry> {
  const blob = await packScene(scene);
  const bytes = await blob.arrayBuffer();
  const entry: LibraryEntry = {
    id: newId(),
    name: info.name?.trim() || defaultSceneName(),
    savedAt: Date.now(),
    objects: info.objects,
    tris: info.tris,
    bytes: bytes.byteLength,
    ...(info.thumb ? { thumb: info.thumb } : {}),
  };
  // Geometry first: a metadata row with no scene behind it would show a
  // card that cannot open, which is worse than no card.
  await data('readwrite', (s) => s.put(bytes, entry.id));
  try {
    await meta('readwrite', (s) => s.put(entry, entry.id));
  } catch (err) {
    await data('readwrite', (s) => s.delete(entry.id)).catch(() => undefined);
    throw err;
  }
  return entry;
}

/** Every entry, newest first. Metadata only - no geometry is read. */
export async function listLibrary(): Promise<LibraryEntry[]> {
  try {
    const all = (await meta('readonly', (s) => s.getAll())) as LibraryEntry[];
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return []; // storage blocked or absent: an empty shelf, not an error
  }
}

/** The scene behind an entry, or null when the geometry has gone missing. */
export async function loadFromLibrary(id: string): Promise<SavedScene | null> {
  try {
    const bytes = (await data('readonly', (s) => s.get(id))) as ArrayBuffer | undefined;
    if (!bytes) return null;
    return await unpackScene(bytes);
  } catch {
    return null;
  }
}

export async function renameLibraryScene(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const entry = (await meta('readonly', (s) => s.get(id))) as LibraryEntry | undefined;
  if (!entry) return;
  await meta('readwrite', (s) => s.put({ ...entry, name: trimmed }, id));
}

/** Remove an entry and its geometry. Metadata first, so a half-delete
 *  leaves orphaned bytes rather than a card that opens nothing. */
export async function deleteLibraryScene(id: string): Promise<void> {
  await meta('readwrite', (s) => s.delete(id)).catch(() => undefined);
  await data('readwrite', (s) => s.delete(id)).catch(() => undefined);
}

/** Total bytes on the shelf, for the File panel's storage line. */
export async function libraryBytes(): Promise<number> {
  return (await listLibrary()).reduce((n, e) => n + e.bytes, 0);
}

/**
 * Drop geometry with no metadata pointing at it. Only reachable if a
 * delete was interrupted between its two stores; cheap enough to run at
 * mount rather than reason about.
 */
export async function pruneOrphanedGeometry(): Promise<number> {
  try {
    const [entries, ids] = await Promise.all([
      listLibrary(),
      data('readonly', (s) => s.getAllKeys()) as Promise<IDBValidKey[]>,
    ]);
    const known = new Set(entries.map((e) => e.id));
    const orphans = ids.filter((k) => typeof k === 'string' && !known.has(k));
    for (const id of orphans) await data('readwrite', (s) => s.delete(id));
    return orphans.length;
  } catch {
    return 0;
  }
}

/** Close over the shared db handle so callers need not import it. */
export const libraryDb = openDb;
