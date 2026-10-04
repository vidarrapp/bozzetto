import Enums from '@sculpt-vendor/misc/Enums';
import { FRAMES_STORE, FRAME_META_STORE, withNamedStore } from './ScenePersist';
import { mergeSceneArrays } from './SceneFile';
import type { SculptSession } from './SculptSession';
import { formatMs, perfLog } from '../../viewer/perfLog';

/**
 * Sculpt-to-timelapse capture (WS5, plan 6.6/6.6b): a Procreate-style
 * recorder, off until the Capture window's checkbox turns it on, and only
 * where the recording can go somewhere (recordingAllowed). Edits mark
 * it pending (the same pushState/stroke-end seams the autosave uses); an
 * idle callback then snapshots the visible scene (merged, matrix-baked -
 * bounded copies only), ships it to the convert worker for the standard
 * quantize+gzip GLB encode, and appends the finished bytes to IndexedDB, so
 * the timelapse survives reloads like the scene does. Nothing runs during a
 * stroke; when sculpting outruns idle time, consecutive strokes coalesce
 * into one frame (the plan's accepted degradation; interval capture is a
 * later option).
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
  /**
   * The geometry fingerprint the frame was captured at, so a reload can
   * pick up the duplicate check where it left off. Absent on frames from
   * before it was stored.
   */
  sig?: string;
}

/** Stop capturing past this much stored gzipped GLB (iPad-safe headroom). */
const BUDGET_BYTES = 500 * 1024 * 1024;
/**
 * And this many frames: the gallery's metadata PUT refuses more (see
 * GallerySave's MAX_GALLERY_FRAMES), so a longer reel could never be
 * published anyway.
 */
const MAX_FRAMES = 10000;
/** rIC ceiling: capture at most this stale even on a busy main thread. */
const IDLE_TIMEOUT_MS = 3000;
/** Re-check cadence when the idle slot lands mid-action. */
const RETRY_MS = 400;
const PREF_KEY = 'bozzetto-sculpt-record';

/**
 * Whether a timelapse recorded here can go anywhere (owner call). A reel
 * only ever leaves the device by publishing, and publishing needs the
 * gallery's sign-in, so a guest on the web would be spending the device's
 * storage, and a write per stroke, on frames nothing can take anywhere. A
 * signed-in session records, on the web and the iPad alike (the sign-in
 * probe answers offline too, from the service worker's copy), so does the
 * owner's device once that sign-in has expired (the reel waits for Sign
 * in again), and so does the desktop app, signed in or not.
 */
export function recordingAllowed(where: { desktop: boolean; signedIn: boolean }): boolean {
  return where.desktop || where.signedIn;
}

export class SnapshotRecorder {
  private metas: CapturedFrameMeta[] = [];
  private totalBytes = 0;
  private nextSeq = 0;
  /** The choice in force: the box, or a stored "on" (capture records only while allowed too). */
  private enabled = false;
  /**
   * Whether recording can go anywhere here (recordingAllowed). The mount
   * says so once it knows; until then, and for good for a guest on the
   * web, nothing is recorded whatever the stored choice is - the choice
   * itself is kept, and frames already stored are left alone.
   */
  private allowed = false;
  /** Whether the frame store opened; a failed store is never re-enabled. */
  private storageOk = true;
  /** The stored on/off choice, or null when the user never touched it. */
  private pref: 'on' | 'off' | null = null;
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
   * Capture starts OFF for everyone, the signed-in owner included (owner
   * call). It used to start on for the owner, but a frame per stroke is a
   * merge on the main thread and an IndexedDB write every time, and those
   * writes are a suspect in the iPad freezes; a timelapse is now something
   * you ask for. The Capture window's Record timelapse box stores that
   * choice, on or off, and only a stored "on" turns capture on here - and
   * then only while recording is allowed (setAllowed).
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
      // Resume the duplicate check from the last stored frame: the
      // checkbox seeds a frame on switching on, and after a reload that was
      // a copy of the frame already on disk.
      this.lastSig = this.metas.length > 0 ? (this.metas[this.metas.length - 1].sig ?? '') : '';
    } catch {
      // No frame storage (private window): capture quietly stands down,
      // and the checkbox cannot wake it.
      this.enabled = false;
      this.storageOk = false;
    }

    const sm = this.session.getStateManager();
    this.wrap(sm, 'pushState');
    this.wrap(this.session.getSculptManager(), 'end');

    // Seed frame 0 with the starting state so playback opens on the raw
    // subject rather than the first stroke's result.
    if (this.isEnabled() && this.metas.length === 0) this.edited();
    // The checkbox was painted before the stored choice was read; now that
    // it and the frame count are in, let the panel catch up.
    this.onChange?.();
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
    if (!this.isEnabled() || this.disposed) return;
    this.pending = true;
    this.schedule();
  }

  /** Whether capture is recording: switched on, and allowed here. */
  isEnabled(): boolean {
    return this.enabled && this.allowed;
  }

  /** Whether recording can go anywhere here (see recordingAllowed). */
  isAllowed(): boolean {
    return this.allowed;
  }

  setEnabled(on: boolean): void {
    this.enabled = on && this.storageOk;
    this.pref = on ? 'on' : 'off';
    try {
      localStorage.setItem(PREF_KEY, this.pref);
    } catch {
      /* preference just won't stick */
    }
    if (this.isEnabled()) this.edited();
  }

  /**
   * Where recording can go somewhere, as the mount works it out: the
   * desktop app at once, the web once the sign-in probe answers with an
   * email, or says the owner's sign-in has expired - at boot, or later
   * from the publish forms' re-check. Called
   * before or after install(), as often as the answer comes. Allowed with
   * the choice already on, recording starts as a tick on the box starts
   * it, from the scene as it stands; the duplicate check keeps a reload's
   * resumed reel from gaining a copy of its last frame.
   */
  setAllowed(allowed: boolean): void {
    if (allowed === this.allowed) return;
    this.allowed = allowed;
    if (this.isEnabled()) this.edited();
    else this.pending = false;
    this.onChange?.();
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
    if (this.isEnabled()) this.edited(); // re-seed the starting frame
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
    if (this.disposed || !this.isEnabled() || this.busy || !this.pending) return;
    if (this.session._action !== Enums.Action.NOTHING) {
      setTimeout(() => this.schedule(), RETRY_MS);
      return;
    }
    // The main thread's share of a frame, for the perf log: the merged
    // copy, its fingerprint and the transfer to the worker.
    const t0 = performance.now();
    const merged = mergeSceneArrays(this.session);
    this.pending = false;
    if (!merged) return;
    const sig = this.signature(merged.positions, merged.tris);
    if (sig === this.lastSig) {
      // Mask-only or no-op edit: no new frame, though the merge was paid.
      perfLog.record('capture hand-off', performance.now() - t0, 'unchanged, not sent');
      return;
    }
    this.busy = true;
    try {
      const encoding = this.encodeFrame(merged.positions, merged.indices);
      perfLog.record('capture hand-off', performance.now() - t0);
      const glb = await encoding;
      // As with the autosave, put() clones on the main thread; the entry
      // keeps that apart from the browser's share of the write.
      const w0 = performance.now();
      let put = 0;
      await withNamedStore(FRAMES_STORE, 'readwrite', (s) => {
        const p0 = performance.now();
        const req = s.put(glb, this.nextSeq);
        put = performance.now() - p0;
        return req;
      });
      const meta = { tris: merged.tris, t: Date.now(), bytes: glb.byteLength, sig };
      await withNamedStore(FRAME_META_STORE, 'readwrite', (s) => s.put(meta, this.nextSeq));
      perfLog.record('capture write', performance.now() - w0, `put ${formatMs(put)}`);
      this.metas.push({ seq: this.nextSeq, ...meta });
      this.nextSeq++;
      this.totalBytes += glb.byteLength;
      this.lastSig = sig;
      this.onChange?.();
      if (this.totalBytes > BUDGET_BYTES || this.metas.length >= MAX_FRAMES) {
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
