import { meshToGLB, objToGLB } from './glb';

// Dedicated worker: convert OBJ text to a .glb off the main thread so the UI
// stays responsive while a sequence is processed. The finished GLB is gzipped
// here too (quantized int16 geometry deflates well); the viewer inflates by
// magic sniff, so the bytes stay drop-in wherever a raw .glb was accepted.
// Sculpt capture (WS5) reuses the same worker with raw arrays instead of OBJ
// text: {id, positions, indices} in (transferred), the same gzipped GLB out.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

interface Job {
  id: number;
  text?: string;
  zUp?: boolean;
  positions?: Float32Array;
  indices?: Uint32Array;
  /** Linear vertex colours; present only for painted model publishes. */
  colors?: Float32Array;
}

async function gzip(bytes: ArrayBuffer): Promise<ArrayBuffer> {
  // Every WebGPU-era browser has CompressionStream; raw GLB is a valid
  // fallback anyway since the viewer sniffs before inflating.
  if (typeof CompressionStream === 'undefined') return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

ctx.onmessage = (e: MessageEvent) => {
  const { id, text, zUp, positions, indices, colors } = e.data as Job;
  try {
    const { glb, tris } =
      positions && indices
        ? { glb: meshToGLB(positions, indices, colors), tris: indices.length / 3 }
        : objToGLB(text ?? '', zUp);
    void gzip(glb).then((packed) => {
      ctx.postMessage({ id, glb: packed, tris }, [packed]);
    });
  } catch (err) {
    ctx.postMessage({ id, error: (err as Error).message });
  }
};
