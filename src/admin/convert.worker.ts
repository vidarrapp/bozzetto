import { objToGLB } from './glb';

// Dedicated worker: convert OBJ text to a .glb off the main thread so the UI
// stays responsive while a sequence is processed.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

interface Job {
  id: number;
  text: string;
  zUp: boolean;
}

ctx.onmessage = (e: MessageEvent) => {
  const { id, text, zUp } = e.data as Job;
  try {
    const { glb, tris } = objToGLB(text, zUp);
    ctx.postMessage({ id, glb, tris }, [glb]);
  } catch (err) {
    ctx.postMessage({ id, error: (err as Error).message });
  }
};
