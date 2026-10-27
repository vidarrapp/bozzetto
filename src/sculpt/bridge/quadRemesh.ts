import type { CleanupReport } from './quadMesh';
import { stageInfo, type QuadRemeshReply, type QuadRemeshRequest } from './quadRemeshProtocol';

/**
 * The page's side of Quad remesh: one worker (quadRemesh.worker.ts),
 * started on first use and kept for the next run, so QuadriFlow is
 * fetched and compiled once a session. Cancel terminates it outright -
 * QuadriFlow cannot be stopped from outside mid-solve - and the next run
 * starts a fresh one.
 */

export interface QuadRemeshOptions {
  /** Target face count, QuadriFlow's -f. */
  target: number;
  /** Keep sharp edges (-sharp). */
  sharp: boolean;
  /** Keep open borders (-boundary). */
  boundary: boolean;
  /** Adaptive quad size (-adaptive). */
  adaptive: boolean;
  /** The solver's random seed; fixed, so a run repeats exactly. */
  seed?: number;
}

export interface QuadRemeshResult {
  positions: Float32Array;
  faces: Uint32Array;
  quads: number;
  triangles: number;
  report: CleanupReport;
  args: number[];
  ms: { total: number; cleanup: number; solve: number };
}

export interface QuadRemeshProgress {
  /** QuadriFlow's stage index (qf_wasm.cpp), -2 and -1 for the worker's own. */
  stage: number;
  name: string;
  label: string;
  /** Where the bar is, 0 to 100. */
  percent: number;
}

/** A refusal or failure, with nothing applied. */
export class QuadRemeshError extends Error {
  constructor(
    message: string,
    readonly kind: 'input' | 'solver' | 'empty' | 'cancelled',
    readonly report?: CleanupReport,
  ) {
    super(message);
    this.name = 'QuadRemeshError';
  }
}

export interface QuadRemeshJob {
  promise: Promise<QuadRemeshResult>;
  cancel(): void;
}

/** Target faces: the slider's range, and the default's clamp (owner call). */
export const QUAD_TARGET = { min: 500, max: 50000 } as const;

/** The default target for an object of this many faces: a quarter, clamped. */
export function defaultQuadTarget(faces: number): number {
  return Math.round(Math.min(QUAD_TARGET.max, Math.max(QUAD_TARGET.min, faces / 4)));
}

let worker: Worker | null = null;
let seq = 0;
let busy: { id: number; reject: (e: Error) => void } | null = null;

function getWorker(): Worker {
  if (!worker) worker = new Worker(new URL('./quadRemesh.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

function dropWorker(): void {
  worker?.terminate();
  worker = null;
}

/**
 * Remesh positions (local space, three a vertex) and SculptGL faces (four
 * a face) into quads. The arrays are the caller's to give away: they are
 * transferred. One run at a time; a second cancels the first.
 */
export function quadRemesh(
  positions: Float32Array,
  faces: Uint32Array,
  opts: QuadRemeshOptions,
  onProgress?: (p: QuadRemeshProgress) => void,
): QuadRemeshJob {
  if (busy) {
    busy.reject(new QuadRemeshError('Cancelled.', 'cancelled'));
    busy = null;
    dropWorker();
  }
  const id = ++seq;
  const w = getWorker();
  let settle: ((e: Error | null, r?: QuadRemeshResult) => void) | null = null;
  const promise = new Promise<QuadRemeshResult>((resolve, reject) => {
    settle = (e, r) => {
      settle = null;
      if (busy?.id === id) busy = null;
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if (e) reject(e);
      else resolve(r!);
    };
    busy = { id, reject: (e) => settle?.(e) };
  });
  // Stage percentages only move forward: a late message never pulls the bar back.
  let last = -1;
  const onMessage = (e: MessageEvent<QuadRemeshReply>): void => {
    const m = e.data;
    if (!m || m.id !== id) return;
    if (m.type === 'stage') {
      const info = stageInfo(m.stage);
      last = Math.max(last, info.at);
      onProgress?.({ stage: m.stage, name: m.name, label: info.label, percent: last });
    } else if (m.type === 'done') {
      onProgress?.({ stage: 8, name: 'done', label: 'Done', percent: 100 });
      settle?.(null, { positions: m.positions, faces: m.faces, quads: m.quads, triangles: m.triangles, report: m.report, args: m.args, ms: m.ms });
    } else if (m.type === 'error') {
      // A failure inside the wasm may leave its worker in any state; the
      // next run gets a fresh one.
      if (m.kind !== 'input') dropWorker();
      settle?.(new QuadRemeshError(m.message, m.kind, m.report));
    }
  };
  const onError = (e: ErrorEvent): void => {
    e.preventDefault();
    dropWorker();
    settle?.(new QuadRemeshError(e.message ? `Quad remesh failed: ${e.message}` : 'Quad remesh could not start.', 'solver'));
  };
  w.addEventListener('message', onMessage);
  w.addEventListener('error', onError);
  const req: QuadRemeshRequest = {
    type: 'run',
    id,
    base: new URL(import.meta.env.BASE_URL, location.href).href,
    version: __QUADRIFLOW_VERSION__,
    positions,
    faces,
    target: Math.round(opts.target),
    sharp: opts.sharp,
    boundary: opts.boundary,
    adaptive: opts.adaptive,
    seed: opts.seed ?? 0,
  };
  w.postMessage(req, [positions.buffer, faces.buffer]);
  return {
    promise,
    cancel: () => {
      if (!settle) return;
      dropWorker();
      settle(new QuadRemeshError('Quad remesh was cancelled.', 'cancelled'));
    },
  };
}
