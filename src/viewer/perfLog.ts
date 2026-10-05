/**
 * Where the main thread went: a small ring of render stalls and timed heavy
 * operations, for freezes that only happen on a real device.
 *
 * The owner sees an iPad stop for seconds at a time while sculpting a light
 * model, orbiting included, and then recover by itself. That is the main
 * thread held up, not the renderer, and the suspects all run after a stroke
 * (the autosave and the timelapse capture both write to IndexedDB, which
 * Safari is known to block the page on). Rather than guess which, the
 * viewer's render loop records every gap between frames past STALL_MS, and
 * the heavy operations record how long they took and how big the model was,
 * so a freeze reads as "stall 2.41 s" next to "autosave write 2.40 s".
 *
 * Always on, because the point is to read it after the fact: a
 * performance.now() either side of work that is expensive anyway, and no
 * allocation once the ring is full. `__bozzettoPerf.recent()` in the console
 * lists it, newest first; the stall log shows it (Preferences > Diagnostics,
 * or `?perfdebug=1`), in every mode.
 */

export interface PerfEntry {
  /** What happened: 'stall', 'autosave write', 'voxel remesh', ... */
  what: string;
  /**
   * How long it took, in ms; for a stall, the gap between two frames. A run
   * folded into one entry (see record) keeps its longest.
   */
  ms: number;
  /** How many times in a row it happened, each within FOLD_MS of the last. */
  n: number;
  /** The active sculpt mesh's triangles at the time; 0 outside sculpt mode. */
  tris: number;
  /** performance.now() when it was recorded (the last of a run). */
  t: number;
  /** The wall clock at the same moment, to match an entry to a report. */
  at: number;
  /** A detail of the longest occurrence, such as the synchronous part of a write. */
  note: string;
}

/** Frames further apart than this are a stall worth recording. */
export const STALL_MS = 300;

const CAPACITY = 64;
/**
 * The same operation again within this long folds into the entry before it.
 * Dynamic topology queues a full upload, and with the wireframe on rebuilds
 * the edges, on every step of a stroke; one line per step would push
 * everything else out of the ring within a second of sculpting.
 */
const FOLD_MS = 1000;

export class PerfLog {
  /** In arrival order until full; after that a ring whose oldest slot is `head`. */
  private readonly ring: PerfEntry[] = [];
  private head = 0;
  private newest: PerfEntry | null = null;
  /** Bumped on every record, so a display can tell there is news. */
  version = 0;
  /**
   * The active mesh's triangle count. Sculpt mode points it at its session
   * while it is mounted; outside it entries carry 0.
   */
  triangles: (() => number) | null = null;

  /**
   * Note one operation. Repeats of the newest entry's kind within FOLD_MS
   * are counted into it rather than added, keeping the longest; anything in
   * between ends the run, so the order of events survives the folding.
   */
  record(what: string, ms: number, note = ''): void {
    const t = performance.now();
    const at = Date.now();
    const tris = this.triangles ? this.triangles() : 0;
    this.version++;
    const last = this.newest;
    if (last && last.what === what && t - last.t < FOLD_MS) {
      last.n++;
      last.t = t;
      last.at = at;
      last.tris = tris;
      if (ms > last.ms) {
        last.ms = ms;
        last.note = note;
      }
      return;
    }
    let e: PerfEntry;
    if (this.ring.length < CAPACITY) {
      e = { what, ms, n: 1, tris, t, at, note };
      this.ring.push(e);
    } else {
      // Full: the oldest entry is overwritten in place, not replaced.
      e = this.ring[this.head];
      this.head = (this.head + 1) % CAPACITY;
      e.what = what;
      e.ms = ms;
      e.n = 1;
      e.tris = tris;
      e.t = t;
      e.at = at;
      e.note = note;
    }
    this.newest = e;
  }

  /** Up to `limit` entries, newest first, as copies: the ring reuses its own. */
  recent(limit = CAPACITY): PerfEntry[] {
    const out: PerfEntry[] = [];
    const len = this.ring.length;
    for (let i = 0; i < len && out.length < limit; i++) {
      out.push({ ...this.ring[(this.head - 1 - i + 2 * len) % len] });
    }
    return out;
  }

  clear(): void {
    this.ring.length = 0;
    this.head = 0;
    this.newest = null;
    this.version++;
  }
}

/** A duration as the log prints it: "0.8 ms", "380 ms", "2.41 s". */
export function formatMs(ms: number): string {
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** The one log, shared by the render loop and everything it times. */
export const perfLog = new PerfLog();

// A stable name, so the log can be read from the console after a freeze
// without having switched anything on first.
(window as unknown as { __bozzettoPerf?: PerfLog }).__bozzettoPerf = perfLog;
