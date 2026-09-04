import Enums from '@sculpt-vendor/misc/Enums';
import type { SculptSession } from './SculptSession';
import type { LookState } from '../../viewer/Viewer';
import type { SculptMaterial } from './materials';
import type { BrushDynamics } from './dynamics';

/**
 * Workspace preferences that ride with a scene: how the brushes are set up,
 * not what the mesh looks like. Saved so a session (or a .bozz handed to
 * someone else) opens with the brushes behaving as they did when it was
 * made.
 */
export interface SculptSettings {
  /** World-scale brush sizing, and the pinned radius when it is on. */
  worldScale: boolean;
  worldRadius?: number;
  /** Per-brush pressure dynamics, keyed by the vendor tool index. */
  dynamics?: Record<number, BrushDynamics>;
  /** The paint brush's colour, sRGB hex. */
  paintColor?: string;
  /** Per-tool dab spacing (fraction of the radius), by vendor tool index. */
  spacing?: Record<number, number>;
  /** Per-tool stencil choice, by vendor tool index; null is "no stencil". */
  alphas?: Record<number, string | null>;
  /** The rake's stencil, from before alphas went per-tool. Read, not written. */
  rakeAlpha?: string;
}

/**
 * Reload-safe sculpting: the active mesh autosaves to IndexedDB so a page
 * reload (or iOS evicting the home-screen app) never loses work. Upstream
 * SculptGL keeps sessions through its .sgl serialization, which Bozzetto cut
 * by plan decision (section 4.2); this is the same idea done natively, and
 * goes one step past .sgl: the WHOLE multiresolution stack survives (every
 * level's arrays plus its detail vectors, byte-faithful, including a stale
 * top when sculpting happened below it), where .sgl flattens to the current
 * level. Undo history is the one thing neither keeps.
 *
 * Performance contract (same spirit as the capture design, plan 6.6b):
 * nothing runs during a stroke. Edits only mark a dirty flag via wrapped
 * StateManager entry points; the actual serialize + write happens in idle
 * time, debounced, plus a best-effort flush when the tab goes hidden. Big
 * meshes (past FAST_SAVE_TRIS at the top level) stretch the debounce to a
 * five-minute cadence instead of skipping autosave, since their puts are
 * tens of megabytes.
 */

export interface SavedLevel {
  nbVertices: number;
  vertices: Float32Array;
  /**
   * Live vertex normals. Not derivable at restore time: incremental stroke
   * updates accumulate in a different float order than a full recompute,
   * and synthesis builds its tangent frames from these, so bit-faithful
   * level restoration requires the live values. Null only in upgraded v1
   * records (single level, recompute stands in).
   */
  normals: Float32Array | null;
  colors: Float32Array;
  materials: Float32Array;
  /** Detail vectors from the last analysis crossing, null if never crossed. */
  detailsXYZ: Float32Array | null;
  detailsRGB: Float32Array | null;
  detailsPBR: Float32Array | null;
}

/** One scene object: its multires stack, topology, transform and name. */
export interface SavedMesh {
  /** Display name (outliner); absent in upgraded older records. */
  name?: string;
  /** Base (lowest) level topology; higher levels re-derive by subdivision. */
  nbBaseFaces: number;
  baseFaces: Uint32Array;
  /** Level 0 = base ... last = top; the live selection is `sel`. */
  levels: SavedLevel[];
  sel: number;
  matrix: Float32Array;
  /** Mirror-plane normal (local space); absent in older records = X. */
  sym?: number[];
  /** Which material this object uses (v4); absent means the first one. */
  materialId?: string;
  /** Outliner eye/padlock; absent means visible and unlocked. */
  visible?: boolean;
  locked?: boolean;
  /**
   * Whether a paint stroke owns this object's colours. Persisted because it
   * decides whether editing a material may overwrite them, and getting that
   * wrong after a reload would silently eat someone's painting.
   */
  painted?: boolean;
}

export interface SavedScene {
  /** 4 adds the material library; 3 records load unchanged, without one. */
  v: 3 | 4;
  savedAt: number;
  /** Every scene object (multi-mesh since WS4: extractions, added shapes). */
  meshes: SavedMesh[];
  /** Index of the selected mesh. */
  active: number;
  symmetry: boolean;
  /**
   * Look-dev settings, so a .bozz file opens under the lighting it was
   * saved in. Optional: records written before this, and the autosave
   * (which keeps the look under its own key, so a slider drag never
   * rewrites a multi-megabyte vertex payload), have none.
   */
  look?: LookState;
  /**
   * The scene's materials. Absent in v3, where every object simply takes
   * the default - the per-vertex colours were always saved, so an older
   * scene still LOOKS right; it just has no library behind it.
   */
  materials?: SculptMaterial[];
  /** Brush workspace settings (v4 addition; absent means the defaults). */
  settings?: SculptSettings;
}

/** The single-mesh v2 format, upgraded on read. */
interface SavedSceneV2 {
  v: 2;
  savedAt: number;
  name?: string;
  nbBaseFaces: number;
  baseFaces: Uint32Array;
  levels: SavedLevel[];
  sel: number;
  matrix: Float32Array;
  symmetry: boolean;
}

/** The pre-multires single-level format, upgraded on read. */
interface SavedSceneV1 {
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
/** WS5 capture: gzipped GLB frame bytes by sequence number. */
export const FRAMES_STORE = 'frames';
/** WS5 capture: small per-frame metadata ({tris, t, bytes}) by sequence. */
export const FRAME_META_STORE = 'frameMeta';
/**
 * The local scene library. Split in two for the same reason the autosave
 * splits its snapshot from its scene: the gallery lists every entry on
 * load, and metadata carrying its own vertex arrays would cost tens of
 * megabytes to draw a row of cards.
 */
export const LIBRARY_STORE = 'library';
export const LIBRARY_DATA_STORE = 'libraryData';
const KEY = 'current';
/**
 * Small companion record to the saved scene: a thumbnail plus the counts the
 * gallery card shows. Kept apart from the scene itself so the landing page
 * can read it without inflating a multi-megabyte vertex payload.
 */
const SNAPSHOT_KEY = 'currentSnapshot';
/**
 * The sculpt session's look-dev settings, kept beside the scene rather than
 * inside it: the look changes on its own rhythm (a slider drag, a light
 * rotation) and must not drag the whole vertex payload through a rewrite.
 */
const LOOK_KEY = 'currentLook';

export interface SculptSnapshot {
  /** JPEG of the viewport as it was left. */
  thumb: Blob;
  savedAt: number;
  objects: number;
  tris: number;
}

/**
 * Keep the sculpt session's look. Without this, leaving sculpt mode and
 * coming back reset the lighting, AO, material and camera to the mount
 * defaults, losing whatever had been set up.
 */
export async function saveSculptLook(look: LookState): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(look, LOOK_KEY));
  } catch {
    // Private windows / blocked storage: the look is simply not remembered.
  }
}

/**
 * Forget the saved sculpt look, so the next entry falls back to the mount
 * defaults. Without this a look saved in a bad state - a light dragged flat,
 * say - restored faithfully on every entry with no way out of it.
 */
export async function clearSculptLook(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(LOOK_KEY));
  } catch {
    // Nothing to clear (or storage unavailable); either way we are done.
  }
}

/** The saved sculpt look, or null when there is none. */
export async function loadSculptLook(): Promise<LookState | null> {
  try {
    return ((await withStore('readonly', (s) => s.get(LOOK_KEY))) as LookState) ?? null;
  } catch {
    return null;
  }
}

/** Remember what the work looked like, for the gallery's "in progress" card. */
export async function saveSculptSnapshot(snap: SculptSnapshot): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(snap, SNAPSHOT_KEY));
  } catch {
    // A missing snapshot only costs the card its picture.
  }
}

/**
 * Is there a saved scene at all? The snapshot beside it is only written on
 * the way out through the gallery link, so a reload, a closed tab or iOS
 * evicting the page leaves the scene with no picture - and gating on the
 * snapshot alone let "New sculpt" quietly resume that work instead of
 * replacing it. count(), not get(): the record is megabytes of vertex
 * arrays and this only needs to know it is there.
 */
export async function hasSavedScene(): Promise<boolean> {
  try {
    return (await withStore('readonly', (s) => s.count(KEY))) > 0;
  } catch {
    return false; // storage blocked: nothing to resume, nothing to clear
  }
}

export async function loadSculptSnapshot(): Promise<SculptSnapshot | null> {
  try {
    const rec = (await withStore('readonly', (s) => s.get(SNAPSHOT_KEY))) as
      | SculptSnapshot
      | undefined;
    return rec?.thumb instanceof Blob ? rec : null;
  } catch {
    return null;
  }
}
/** Above this many top-level tris, saves run on the slow cadence instead. */
const FAST_SAVE_TRIS = 1600000;
/**
 * Above this, skip writes entirely (the ctrl+d ceiling allows 16M-tri tops
 * whose stack payload would reach hundreds of MB; a failed put would risk
 * the store). The last in-budget save stays in place for restore.
 */
const SKIP_SAVE_TRIS = 8000000;
/** Idle debounce: coalesce a burst of strokes into one write. */
const FAST_SAVE_GAP_MS = 1500;
/** Big-mesh cadence: at most one multi-ten-MB put every five minutes. */
const SLOW_SAVE_GAP_MS = 5 * 60 * 1000;
/**
 * Consecutive failed writes before autosave gives up on the session. One
 * failure is usually weather, not climate: an iPad app switch freezes the
 * tab and aborts the put the hide flush just started, and the frame
 * recorder can trip the quota between two of its own writes. Giving up on
 * the first one meant sculpting for hours with nothing being saved and
 * only a console line to show for it.
 */
const MAX_WRITE_FAILURES = 3;
/** First retry gap after a failed write; doubles per consecutive failure. */
const RETRY_GAP_MS = 5000;

/**
 * One DB for all sculpt persistence. v2 added the capture frame stores, v3
 * the scene library. Every version creates whatever is missing rather than
 * branching on oldVersion, so a browser arriving from any earlier version
 * ends up with the full set.
 */
export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      for (const store of [
        STORE,
        FRAMES_STORE,
        FRAME_META_STORE,
        LIBRARY_STORE,
        LIBRARY_DATA_STORE,
      ]) {
        if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Run one request against a named store (shared with the capture store). */
export async function withNamedStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const req = op(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const withStore = <T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => withNamedStore(STORE, mode, op);

function validLevel(l: SavedLevel): boolean {
  const n = l.nbVertices * 3;
  return (
    l.vertices instanceof Float32Array &&
    l.vertices.length === n &&
    (l.normals === null || l.normals?.length === n) &&
    l.colors?.length === n &&
    l.materials?.length === n &&
    (l.detailsXYZ === null || l.detailsXYZ?.length === n) &&
    (l.detailsRGB === null || l.detailsRGB?.length === n) &&
    (l.detailsPBR === null || l.detailsPBR?.length === n)
  );
}

function validMesh(m: SavedMesh): boolean {
  return (
    m.baseFaces instanceof Uint32Array &&
    m.baseFaces.length === m.nbBaseFaces * 4 &&
    Array.isArray(m.levels) &&
    m.levels.length > 0 &&
    m.levels.every(validLevel) &&
    m.sel >= 0 &&
    m.sel < m.levels.length &&
    m.matrix?.length === 16
  );
}

/** The saved scene, or null when there is none (or storage is unavailable). */
export async function loadSavedScene(): Promise<SavedScene | null> {
  try {
    const rec = (await withStore('readonly', (s) => s.get(KEY))) as
      | SavedScene
      | SavedSceneV2
      | SavedSceneV1
      | undefined;
    if (!rec) return null;
    if (rec.v === 1) {
      // Pre-multires format: one level whose faces are the base topology.
      if (
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
      return {
        v: 3,
        savedAt: rec.savedAt,
        meshes: [
          {
            nbBaseFaces: rec.nbFaces,
            baseFaces: rec.faces,
            levels: [
              {
                nbVertices: rec.nbVertices,
                vertices: rec.vertices,
                normals: null,
                colors: rec.colors,
                materials: rec.materials,
                detailsXYZ: null,
                detailsRGB: null,
                detailsPBR: null,
              },
            ],
            sel: 0,
            matrix: rec.matrix,
          },
        ],
        active: 0,
        symmetry: rec.symmetry,
      };
    }
    if (rec.v === 2) {
      const mesh: SavedMesh = {
        name: rec.name,
        nbBaseFaces: rec.nbBaseFaces,
        baseFaces: rec.baseFaces,
        levels: rec.levels,
        sel: rec.sel,
        matrix: rec.matrix,
      };
      if (!validMesh(mesh)) return null;
      return { v: 3, savedAt: rec.savedAt, meshes: [mesh], active: 0, symmetry: rec.symmetry };
    }
    return validSavedScene(rec) ? rec : null;
  } catch {
    return null; // private windows / blocked storage: sculpt still works
  }
}

/** Structural check for a v3/v4 record (shared with the .bozz file loader). */
export function validSavedScene(rec: unknown): rec is SavedScene {
  const r = rec as SavedScene | undefined;
  return (
    !!r &&
    (r.v === 3 || r.v === 4) &&
    Array.isArray(r.meshes) &&
    r.meshes.length > 0 &&
    r.meshes.every(validMesh) &&
    r.active >= 0 &&
    r.active < r.meshes.length
  );
}

/**
 * Drop every captured timelapse frame. Starting a new sculpt discards the
 * recording with the scene it belongs to - a timelapse of work you just
 * replaced is not much use - matching the File panel's New scene button.
 */
export async function clearSculptFrames(): Promise<void> {
  for (const store of [FRAMES_STORE, FRAME_META_STORE]) {
    try {
      await withNamedStore(store, 'readwrite', (s) => s.clear());
    } catch {
      // Storage unavailable; nothing to clear.
    }
  }
}

export async function clearSavedScene(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(SNAPSHOT_KEY));
    await withStore('readwrite', (s) => s.delete(KEY));
  } catch {
    // Nothing to clear (or storage unavailable); either way we're done.
  }
}

export class ScenePersist {
  private dirty = false;
  private disabled = false;
  private failures = 0;
  /** Earliest a retry may run, after a failed write backed off. */
  private retryAt = 0;

  /** Autosave stopped ITSELF (a full store, or writes that kept failing). */
  onStopped: ((reason: 'quota' | 'error') => void) | null = null;
  private cancelScheduled: (() => void) | null = null;
  private lastSave = 0;
  private saving = false;
  private readonly unwraps: Array<() => void> = [];

  /**
   * Last chance to add to a record before it is written - the material
   * library rides here, since the session that serialises the geometry
   * knows nothing about it.
   */
  decorate: ((scene: SavedScene) => void) | null = null;

  constructor(private readonly session: SculptSession) {}

  install(): void {
    // Every undoable edit (stroke start, mask op, topology op) funnels
    // through pushState; undo/redo change geometry without pushing. Wrapping
    // the instance keeps the vendor untouched. Stroke END must re-mark too:
    // pushState fires at stroke start, so an idle save landing mid-stroke
    // would otherwise clear the flag while the stroke's tail goes unsaved
    // (found by the persistence suite as a partial-stroke restore).
    const sm = this.session.getStateManager();
    this.wrap(sm, 'pushState');
    this.wrap(sm, 'undo');
    this.wrap(sm, 'redo');
    this.wrap(this.session.getSculptManager(), 'end');
    // Symmetry is part of the saved scene but changes without a state push.
    this.wrap(this.session, 'toggleSymmetry');
    this.wrap(this.session, 'setSymmetryAxis');
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

  /**
   * The debounce gap for the current subject: burst-coalescing for normal
   * meshes, a five-minute cadence once the top level passes FAST_SAVE_TRIS
   * (those puts are tens of megabytes). Event flushes (hidden, pagehide,
   * dispose) bypass the gap either way.
   */
  private minGapMs(): number {
    return this.session.topLevelTriangles() > FAST_SAVE_TRIS
      ? SLOW_SAVE_GAP_MS
      : FAST_SAVE_GAP_MS;
  }

  /** Note an edit; the write happens later, in idle time. */
  markDirty(): void {
    if (this.disabled) return;
    this.dirty = true;
    if (this.cancelScheduled) return;
    const run = (): void => {
      this.cancelScheduled = null;
      const wait = Math.max(this.lastSave + this.minGapMs(), this.retryAt) - Date.now();
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
    // Never serialize a half-finished stroke: stay dirty and let the
    // stroke-end wrap reschedule.
    if (this.session._action === Enums.Action.SCULPT_EDIT) return;
    if (this.session.topLevelTriangles() > SKIP_SAVE_TRIS) return;
    const scene = this.session.serializeScene();
    if (!scene) return;
    this.decorate?.(scene);
    this.dirty = false;
    this.saving = true;
    try {
      await withStore('readwrite', (s) => s.put(scene, KEY));
      this.lastSave = Date.now();
      this.failures = 0;
    } catch (err) {
      // The record never landed, so stay dirty and come back to it. A FULL
      // store is different - retrying a tens-of-MB put against one just
      // burns battery - so that stops at once, and either way the panel is
      // told, because silent loss of autosave is the worst outcome here.
      this.dirty = true;
      this.failures++;
      const quota = (err as DOMException | null)?.name === 'QuotaExceededError';
      if (quota || this.failures >= MAX_WRITE_FAILURES) {
        this.disabled = true;
        console.warn('sculpt autosave disabled:', err);
        this.onStopped?.(quota ? 'quota' : 'error');
      } else {
        this.retryAt = Date.now() + RETRY_GAP_MS * 2 ** (this.failures - 1);
        console.warn('sculpt autosave write failed, retrying:', err);
      }
    } finally {
      this.saving = false;
      // An edit that landed WHILE this put was in flight found flush()
      // returning early on `saving` and nothing scheduled behind it, so the
      // last stroke before a pause stayed unsaved until some later edit
      // happened to re-arm the debounce (review finding). Re-arm here.
      if (this.dirty && !this.disabled) this.markDirty();
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
