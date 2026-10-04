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
 *
 * Signed in, Save to library puts a scene on the server instead (see
 * SceneProjects), and the shelf keeps that project's latest bytes as its
 * device copy, under the project's id, for opening offline. Those entries
 * carry projectId; an entry without one exists on this device only, which
 * browser storage cannot promise to keep through a reinstall. A save that
 * could not upload leaves one of those, marked unsent, so it can go up
 * later from its card.
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
  /**
   * The server project this entry is a copy of. Set, the entry is that
   * project's device cache - stored under the project's id, so there is
   * one per project, and what an offline open of it falls back to. Absent,
   * the scene exists on this device and nowhere else.
   */
  projectId?: string;
  /**
   * A Save to library that could not upload (the sign-in had expired, or
   * there was no connection) kept the scene here instead. Its card says
   * Not uploaded and offers Upload to Projects whoever is signed in,
   * since the save was the owner's; the next save of the same scene that
   * does upload takes this copy's place.
   */
  unsent?: boolean;
  /**
   * For an unsent re-save, the project that save was updating: Upload to
   * Projects updates it in place rather than making a second one.
   */
  uploadTo?: string;
  /**
   * The unsent copy this project copy was uploaded from, by its id before
   * the move. The scene in Sculpt that copy was kept for still knows it by
   * that id, and finds its project through this rather than making a
   * second project at its next save.
   */
  sentFrom?: string;
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

/**
 * Keep the device copy of a server project, under the project's id: what
 * an offline open of it falls back to. Replaces the previous copy; a save
 * that could not take a picture keeps the picture the copy had.
 */
export async function cacheProjectScene(
  projectId: string,
  info: { name: string; bytes: ArrayBuffer; objects: number; tris: number; thumb?: Blob },
): Promise<LibraryEntry> {
  const prior = await getLibraryEntry(projectId);
  const thumb = info.thumb ?? prior?.thumb;
  const entry: LibraryEntry = {
    id: projectId,
    projectId,
    name: info.name,
    savedAt: Date.now(),
    objects: info.objects,
    tris: info.tris,
    bytes: info.bytes.byteLength,
    ...(thumb ? { thumb } : {}),
  };
  await data('readwrite', (s) => s.put(info.bytes, projectId));
  await meta('readwrite', (s) => s.put(entry, projectId));
  return entry;
}

/**
 * Keep a scene whose Save to library could not upload: the bytes that
 * would have gone up, on the shelf, marked unsent. `id` is the copy an
 * earlier failed save of the same scene left, which this one replaces -
 * one card per scene, however many times the save is tried - keeping the
 * name it may have been given since. `uploadTo` is the project the save was
 * updating, if it was a re-save.
 */
export async function keepUnsent(info: {
  id?: string | null;
  name: string;
  bytes: ArrayBuffer;
  objects: number;
  tris: number;
  thumb?: Blob;
  uploadTo?: string | null;
}): Promise<LibraryEntry> {
  const prior = info.id ? await getLibraryEntry(info.id) : null;
  const thumb = info.thumb ?? prior?.thumb;
  const entry: LibraryEntry = {
    id: info.id || newId(),
    name: prior?.name || info.name,
    savedAt: Date.now(),
    objects: info.objects,
    tris: info.tris,
    bytes: info.bytes.byteLength,
    unsent: true,
    ...(info.uploadTo ? { uploadTo: info.uploadTo } : {}),
    ...(thumb ? { thumb } : {}),
  };
  // Geometry first, as saveToLibrary does: no card without a scene behind it.
  await data('readwrite', (s) => s.put(info.bytes, entry.id));
  await meta('readwrite', (s) => s.put(entry, entry.id));
  return entry;
}

/**
 * A device-only entry has just been uploaded as `projectId`: it becomes
 * that project's device copy. Moved, not copied, to the project's key, so
 * there is never a second card for the same scene - a later save from
 * Sculpt writes to the same key. Written first and removed second, so an
 * interruption leaves two copies rather than none.
 */
export async function markUploaded(id: string, projectId: string, name?: string): Promise<LibraryEntry | null> {
  const entry = await getLibraryEntry(id);
  const bytes = await loadLibraryBytes(id);
  if (!entry || !bytes) return null;
  // Sent now: what the unsent marks said is no longer true of it, but
  // where it came from is what the scene it was kept for will ask.
  const { unsent, uploadTo: _uploadTo, ...kept } = entry;
  const moved: LibraryEntry = {
    ...kept,
    id: projectId,
    projectId,
    ...(name ? { name } : {}),
    ...(unsent ? { sentFrom: id } : {}),
  };
  await data('readwrite', (s) => s.put(bytes, projectId));
  await meta('readwrite', (s) => s.put(moved, projectId));
  if (id !== projectId) await deleteLibraryScene(id);
  return moved;
}

/** The project copy an unsent copy became when its card uploaded it, or null. */
export async function findSentCopy(unsentId: string): Promise<LibraryEntry | null> {
  return (await listLibrary()).find((e) => e.sentFrom === unsentId && !!e.projectId) ?? null;
}

/** One entry's card information, or null. */
export async function getLibraryEntry(id: string): Promise<LibraryEntry | null> {
  try {
    return ((await meta('readonly', (s) => s.get(id))) as LibraryEntry | undefined) ?? null;
  } catch {
    return null;
  }
}

/** An entry's packed .bozz bytes as stored, for uploading it as it is. */
export async function loadLibraryBytes(id: string): Promise<ArrayBuffer | null> {
  try {
    return ((await data('readonly', (s) => s.get(id))) as ArrayBuffer | undefined) ?? null;
  } catch {
    return null;
  }
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
    const bytes = await loadLibraryBytes(id);
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
