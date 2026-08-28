import type { SculptSession } from './SculptSession';

/**
 * Reload-safe sculpting: the active mesh autosaves to IndexedDB so a page
 * reload (or iOS evicting the home-screen app) never loses work. Upstream
 * SculptGL keeps sessions through its .sgl serialization, which Bozzetto cut
 * by plan decision (section 4.2); this is the same idea done natively, and
 * it stores what .sgl stores: the CURRENT resolution's arrays. Lower multires
 * levels and the undo history do not survive a reload (upstream parity).
 *
 * Performance contract (same spirit as the capture design, plan 6.6b):
 * nothing runs during a stroke. Edits only mark a dirty flag via wrapped
 * StateManager entry points; the actual serialize + write happens in idle
 * time, debounced, plus a best-effort flush when the tab goes hidden.
 */

export interface SavedScene {
  v: 1;
  savedAt: number;
  nbVertices: number;
  nbFaces: number;
  vertices: Float32Array;
  colors: Float32Array;
  materials: Float32Array;
  faces: Uint32Array;
  matrix: Float32Array;
  symmetry: boolean;
}

const DB_NAME = 'bozzetto-sculpt';
const STORE = 'scene';
const KEY = 'current';
/** Don't autosave meshes beyond this (a 1.6M-tri put is a ~60MB write). */
const MAX_SAVE_TRIS = 1600000;
/** Idle debounce: coalesce a burst of strokes into one write. */
const SAVE_MIN_GAP_MS = 1500;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** The saved scene, or null when there is none (or storage is unavailable). */
export async function loadSavedScene(): Promise<SavedScene | null> {
  try {
    const rec = (await withStore('readonly', (s) => s.get(KEY))) as SavedScene | undefined;
    if (
      !rec ||
      rec.v !== 1 ||
      !(rec.vertices instanceof Float32Array) ||
      !(rec.faces instanceof Uint32Array) ||
      rec.vertices.length !== rec.nbVertices * 3 ||
      rec.colors?.length !== rec.nbVertices * 3 ||
      rec.materials?.length !== rec.nbVertices * 3 ||
      rec.faces.length !== rec.nbFaces * 4 ||
      rec.matrix?.length !== 16
    ) {
      return null;
    }
    return rec;
  } catch {
    return null; // private windows / blocked storage: sculpt still works
  }
}

export async function clearSavedScene(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(KEY));
  } catch {
    // Nothing to clear (or storage unavailable); either way we're done.
  }
}

export class ScenePersist {
  private dirty = false;
  private disabled = false;
  private cancelScheduled: (() => void) | null = null;
  private lastSave = 0;
  private saving = false;
  private readonly unwraps: Array<() => void> = [];

  constructor(private readonly session: SculptSession) {}

  install(): void {
    // Every undoable edit (stroke start, mask op, topology op) funnels
    // through pushState; undo/redo change geometry without pushing. Wrapping
    // the instance keeps the vendor untouched.
    const sm = this.session.getStateManager();
    this.wrap(sm, 'pushState');
    this.wrap(sm, 'undo');
    this.wrap(sm, 'redo');
    document.addEventListener('visibilitychange', this.onHidden);
    window.addEventListener('pagehide', this.onHidden);
  }

  private wrap(target: object, method: string): void {
    const t = target as Record<string, (...a: unknown[]) => unknown>;
    const orig = t[method].bind(target);
    t[method] = (...args: unknown[]) => {
      const out = orig(...args);
      this.markDirty();
      return out;
    };
    this.unwraps.push(() => {
      t[method] = orig;
    });
  }

  /** Note an edit; the write happens later, in idle time. */
  markDirty(): void {
    if (this.disabled) return;
    this.dirty = true;
    if (this.cancelScheduled) return;
    const run = (): void => {
      this.cancelScheduled = null;
      const wait = this.lastSave + SAVE_MIN_GAP_MS - Date.now();
      if (wait > 0) {
        const t = window.setTimeout(run, wait);
        this.cancelScheduled = () => clearTimeout(t);
        return;
      }
      void this.flush();
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback && w.cancelIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: 3000 });
      this.cancelScheduled = () => w.cancelIdleCallback?.(id);
    } else {
      const t = window.setTimeout(run, 600);
      this.cancelScheduled = () => clearTimeout(t);
    }
  }

  /** Serialize and write now (used by the idle pass, hide events, tests). */
  async flush(): Promise<void> {
    if (!this.dirty || this.saving || this.disabled) return;
    const mesh = this.session.getMesh();
    if (!mesh || mesh.getNbTriangles() > MAX_SAVE_TRIS) return;
    const scene = this.session.serializeScene();
    if (!scene) return;
    this.dirty = false;
    this.saving = true;
    try {
      await withStore('readwrite', (s) => s.put(scene, KEY));
      this.lastSave = Date.now();
    } catch (err) {
      // Quota or storage failure: stop trying quietly (sculpting continues).
      this.disabled = true;
      console.warn('sculpt autosave disabled:', err);
    } finally {
      this.saving = false;
    }
  }

  /**
   * Stop persisting for good (the start-fresh path): without this, the
   * reload's own pagehide flush would re-save the scene that was just
   * cleared.
   */
  disable(): void {
    this.disabled = true;
    this.dirty = false;
    this.cancelScheduled?.();
    this.cancelScheduled = null;
  }

  private readonly onHidden = (e: Event): void => {
    if (e.type === 'pagehide' || document.visibilityState === 'hidden') {
      void this.flush();
    }
  };

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onHidden);
    window.removeEventListener('pagehide', this.onHidden);
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    for (const undo of this.unwraps) undo();
    this.unwraps.length = 0;
    void this.flush();
  }
}
