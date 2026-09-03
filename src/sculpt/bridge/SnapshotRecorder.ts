import Enums from '@sculpt-vendor/misc/Enums';
import { FRAMES_STORE, FRAME_META_STORE, withNamedStore } from './ScenePersist';
import { mergeSceneArrays } from './SceneFile';
import type { SculptSession } from './SculptSession';

/**
 * Sculpt-to-timelapse capture (WS5, plan 6.6/6.6b): a Procreate-style
 * always-on recorder. Edits mark it pending (the same pushState/stroke-end
 * seams the autosave uses); an idle callback then snapshots the visible
 * scene (merged, matrix-baked - bounded copies only), ships it to the
 * convert worker for the standard quantize+gzip GLB encode, and appends
 * the finished bytes to IndexedDB, so the timelapse survives reloads like
 * the scene does. Nothing runs during a stroke; when sculpting outruns
 * idle time, consecutive strokes coalesce into one frame (the plan's
 * accepted degradation; interval capture is a later option).
 *
 * The stored bytes are exactly what the gallery upload endpoint takes, so
 * "save to gallery" is a straight walk of the store.
 */

export interface CapturedFrameMeta {
  seq: number;
  tris: number;
  /** Wall-clock capture time (future pacing modes read this). */
  t: number;
  bytes: number;
}

/** Stop capturing past this much stored gzipped GLB (iPad-safe headroom). */
const BUDGET_BYTES = 500 * 1024 * 1024;
/** rIC ceiling: capture at most this stale even on a busy main thread. */
const IDLE_TIMEOUT_MS = 3000;
/** Re-check cadence when the idle slot lands mid-action. */
const RETRY_MS = 400;
const PREF_KEY = 'bozzetto-sculpt-record';

export class SnapshotRecorder {
  private metas: CapturedFrameMeta[] = [];
  private totalBytes = 0;
  private nextSeq = 0;
  private enabled = false;
  /** Whether the frame store opened; a failed store is never re-enabled. */
  private storageOk = true;
  /** The stored on/off choice, or null when the user never touched it. */
  private pref: 'on' | 'off' | null = null;
  /** install() has read the frame index; before that, seq/metas are blank. */
  private ready = false;
  /** A role default that arrived before the store was read. */
  private pendingDefault: boolean | null = null;
  private pending = false;
  private scheduled = false;
  private busy = false;
  private disposed = false;
  private lastSig = '';
  private worker: Worker | null = null;
  private jobId = 0;
  private readonly unwraps: Array<() => void> = [];

  /** Frame count / byte total moved (drives the palette readout). */
  onChange: (() => void) | null = null;
  /** Capture turned itself off (budget reached, or storage failed). */
  onStopped: ((reason: 'budget' | 'error') => void) | null = null;

  constructor(private readonly session: SculptSession) {}

  /**
   * Capture starts OFF for guests (owner call): they have no way to publish
   * the frames, so recording only spends their storage. The admin probe
   * calls applyDefault(true) once it confirms a session - and an explicit
   * choice, stored by the File panel's checkbox, beats either default.
   */
  async install(): Promise<void> {
    try {
      const stored = localStorage.getItem(PREF_KEY);
      this.pref = stored === 'on' || stored === 'off' ? stored : null;
    } catch {
      /* storage-blocked contexts have no stored choice */
    }
    if (this.pref) this.enabled = this.pref === 'on';
    try {
      const keys = (await withNamedStore(FRAME_META_STORE, 'readonly', (s) =>
        s.getAllKeys(),
      )) as number[];
      const recs = (await withNamedStore(FRAME_META_STORE, 'readonly', (s) => s.getAll())) as Omit<
        CapturedFrameMeta,
        'seq'
      >[];
      this.metas = recs.map((m, i) => ({ ...m, seq: keys[i] }));
      this.totalBytes = this.metas.reduce((sum, m) => sum + m.bytes, 0);
      this.nextSeq = keys.length > 0 ? keys[keys.length - 1] + 1 : 0;
    } catch {
      // No frame storage (private window): capture quietly stands down,
      // and no later default may wake it.
      this.enabled = false;
      this.storageOk = false;
    }

    this.ready = true;
    if (this.pendingDefault !== null) {
      const on = this.pendingDefault;
      this.pendingDefault = null;
      this.applyDefault(on);
    }

    const sm = this.session.getStateManager();
    this.wrap(sm, 'pushState');
    this.wrap(this.session.getSculptManager(), 'end');

    // Seed frame 0 with the starting state so playback opens on the raw
    // subject rather than the first stroke's result.
    if (this.enabled && this.metas.length === 0) this.edited();
  }

  private wrap(target: object, method: string): void {
    const t = target as Record<string, (...a: unknown[]) => unknown>;
    const orig = t[method].bind(target);
    t[method] = (...args: unknown[]) => {
      const out = orig(...args);
      this.edited();
      return out;
    };
    this.unwraps.push(() => {
      t[method] = orig;
    });
  }

  private edited(): void {
    if (!this.enabled || this.disposed) return;
    this.pending = true;
    this.schedule();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on && this.storageOk;
    this.pref = on ? 'on' : 'off';
    try {
      localStorage.setItem(PREF_KEY, this.pref);
    } catch {
      /* preference just won't stick */
    }
    if (this.enabled) this.edited();
  }

  /**
   * The role-based default (guests off, admins on), applied only when the
   * user has never made a choice of their own. Arrives asynchronously from
   * the admin probe, possibly before or after install() finished.
   */
  applyDefault(on: boolean): void {
    if (this.pref !== null || !this.storageOk || this.disposed) return;
    // Before install() has read the frame index, nextSeq is 0 and metas is
    // empty: seeding now would write over the first stored frame.
    if (!this.ready) {
      this.pendingDefault = on;
      return;
    }
    if (this.enabled === on) return;
    this.enabled = on;
    if (on) this.edited();
    this.onChange?.(); // the File panel's checkbox follows
  }

  frameCount(): number {
    return this.metas.length;
  }

  bytes(): number {
    return this.totalBytes;
  }

  frameMetas(): readonly CapturedFrameMeta[] {
    return this.metas;
  }

  readFrame(seq: number): Promise<ArrayBuffer> {
    return withNamedStore(FRAMES_STORE, 'readonly', (s) => s.get(seq)) as Promise<ArrayBuffer>;
  }

  async clear(): Promise<void> {
    await withNamedStore(FRAMES_STORE, 'readwrite', (s) => s.clear());
    await withNamedStore(FRAME_META_STORE, 'readwrite', (s) => s.clear());
    this.metas = [];
    this.totalBytes = 0;
    this.nextSeq = 0;
    this.lastSig = '';
    this.onChange?.();
    if (this.enabled) this.edited(); // re-seed the starting frame
  }

  private schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    const run = (): void => {
      this.scheduled = false;
      void this.tick();
    };
    // Safari has no requestIdleCallback; a short timeout approximates it.
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    } else {
      setTimeout(run, 250);
    }
  }

  private async tick(): Promise<void> {
    if (this.disposed || !this.enabled || this.busy || !this.pending) return;
    if (this.session._action !== Enums.Action.NOTHING) {
      setTimeout(() => this.schedule(), RETRY_MS);
      return;
    }
    const merged = mergeSceneArrays(this.session);
    this.pending = false;
    if (!merged) return;
    const sig = this.signature(merged.positions, merged.tris);
    if (sig === this.lastSig) return; // mask-only or no-op edit: no new frame
    this.busy = true;
    try {
      const glb = await this.encodeFrame(merged.positions, merged.indices);
      await withNamedStore(FRAMES_STORE, 'readwrite', (s) => s.put(glb, this.nextSeq));
      const meta = { tris: merged.tris, t: Date.now(), bytes: glb.byteLength };
      await withNamedStore(FRAME_META_STORE, 'readwrite', (s) => s.put(meta, this.nextSeq));
      this.metas.push({ seq: this.nextSeq, ...meta });
      this.nextSeq++;
      this.totalBytes += glb.byteLength;
      this.lastSig = sig;
      this.onChange?.();
      if (this.totalBytes > BUDGET_BYTES) {
        this.enabled = false;
        this.onStopped?.('budget');
      }
    } catch {
      this.enabled = false;
      this.onStopped?.('error');
    } finally {
      this.busy = false;
      if (this.pending) this.schedule(); // edits landed while encoding
    }
  }

  /** Cheap geometry fingerprint: counts plus a strided position sum. */
  private signature(positions: Float32Array, tris: number): string {
    let sum = 0;
    for (let i = 0; i < positions.length; i += 31) sum += positions[i];
    return `${positions.length}|${tris}|${sum}`;
  }

  /** GLB-encode one mesh on the shared worker (also used by model save). */
  encodeFrame(
    positions: Float32Array,
    indices: Uint32Array,
    colors?: Float32Array,
  ): Promise<ArrayBuffer> {
    if (!this.worker) {
      this.worker = new Worker(new URL('../../admin/convert.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    return new Promise((resolve, reject) => {
      const id = ++this.jobId;
      const w = this.worker!;
      const onMsg = (e: MessageEvent): void => {
        const d = e.data as { id: number; glb?: ArrayBuffer; error?: string };
        if (d.id !== id) return;
        w.removeEventListener('message', onMsg);
        if (d.glb) resolve(d.glb);
        else reject(new Error(d.error ?? 'frame encode failed'));
      };
      w.addEventListener('message', onMsg);
      const transfer = [positions.buffer, indices.buffer];
      if (colors) transfer.push(colors.buffer);
      w.postMessage({ id, positions, indices, colors }, transfer);
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const undo of this.unwraps) undo();
    this.unwraps.length = 0;
    this.worker?.terminate();
    this.worker = null;
  }
}
