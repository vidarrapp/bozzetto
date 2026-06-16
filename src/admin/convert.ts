import { glbTris } from './glb';

/**
 * Main-thread side of frame conversion: drives the OBJ worker, passes pre-made
 * GLBs through untouched, and provides a small concurrency pool so conversion
 * (CPU, in the worker) overlaps with uploads (network).
 */

export interface Frame {
  glb: ArrayBuffer;
  tris: number;
}

interface WorkerReply {
  id: number;
  glb?: ArrayBuffer;
  tris?: number;
  error?: string;
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (f: Frame) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const { id, glb, tris, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error || !glb) p.reject(new Error(error ?? 'conversion failed'));
      else p.resolve({ glb, tris: tris ?? 0 });
    };
  }
  return worker;
}

function convertObj(text: string, zUp: boolean): Promise<Frame> {
  const id = ++seq;
  return new Promise<Frame>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, text, zUp });
  });
}

/** Read one input file into a frame GLB: convert .obj, pass .glb through. */
export async function frameFromFile(file: File, zUp: boolean): Promise<Frame> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.glb')) {
    const glb = await file.arrayBuffer();
    return { glb, tris: glbTris(glb) };
  }
  if (name.endsWith('.obj')) {
    return convertObj(await file.text(), zUp);
  }
  throw new Error(`Unsupported file: ${file.name}`);
}

/** Run async tasks with a bounded number in flight, preserving result order. */
export async function runPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  async function lane(): Promise<void> {
    for (let i = next++; i < tasks.length; i = next++) {
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, lane));
  return results;
}
