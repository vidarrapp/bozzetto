// Dedicated worker: Quad remesh through QuadriFlow (WebAssembly, built by
// tools/quadriflow-wasm/build.sh into public/quadriflow/). The module is
// fetched the first time a remesh runs, compiled once and instantiated
// afresh for every run, so a run that aborts inside the wasm leaves
// nothing behind for the next one. The input is cleaned here first
// (quadMesh.ts), off the page's thread.
import {
  cleanForQuadriFlow,
  facesInverted,
  flipFaces,
  parseObjFaces,
  PointGrid,
  refusal,
  vertexNormals,
  writeObj,
  type CleanupReport,
} from './quadMesh';
import type { QuadRemeshReply, QuadRemeshRequest } from './quadRemeshProtocol';

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  onmessage: ((e: MessageEvent<QuadRemeshRequest>) => void) | null;
};

interface QuadriFlowModule {
  FS: {
    writeFile(path: string, data: string): void;
    readFile(path: string, opts: { encoding: 'utf8' }): string;
    unlink(path: string): void;
  };
  ccall(name: string, ret: string, types: string[], args: unknown[]): number;
}
type Factory = (opts: Record<string, unknown>) => Promise<QuadriFlowModule>;

let factory: Promise<{ make: Factory; wasm: WebAssembly.Module }> | null = null;

/** The module and its compiled wasm, fetched once (the worker's lifetime). */
function load(base: string, version: string): Promise<{ make: Factory; wasm: WebAssembly.Module }> {
  if (!factory) {
    factory = (async () => {
      const q = `?v=${encodeURIComponent(version)}`;
      const url = new URL(`quadriflow/quadriflow.mjs${q}`, base).href;
      const mod = (await import(/* @vite-ignore */ url)) as { default: Factory };
      const res = await fetch(new URL(`quadriflow/quadriflow.wasm${q}`, base).href);
      if (!res.ok) throw new Error(`QuadriFlow could not be loaded (${res.status}).`);
      const wasm = await WebAssembly.compile(await res.arrayBuffer());
      return { make: mod.default, wasm };
    })();
    factory.catch(() => {
      factory = null;
    });
  }
  return factory;
}

const post = (msg: QuadRemeshReply, transfer: Transferable[] = []): void => ctx.postMessage(msg, transfer);

/** What a throw from inside the wasm says, in words for the notice. */
function describe(err: unknown): string {
  if (err && typeof err === 'object' && 'status' in err && (err as { name?: string }).name === 'ExitStatus') {
    return 'QuadriFlow stopped partway on this surface. Try more target faces, or Voxel remesh first.';
  }
  if (err instanceof WebAssembly.RuntimeError) return `QuadriFlow failed on this surface (${err.message}). Try more target faces, or Voxel remesh first.`;
  if (err instanceof RangeError || /memory/i.test(String((err as Error)?.message ?? ''))) return 'QuadriFlow ran out of memory on this surface.';
  if (err instanceof Error) return err.message;
  return 'QuadriFlow failed on this surface.';
}

async function run(req: QuadRemeshRequest): Promise<void> {
  const t0 = performance.now();
  post({ type: 'stage', id: req.id, stage: -2, name: 'module' });
  const { make, wasm } = await load(req.base, req.version);
  post({ type: 'stage', id: req.id, stage: -1, name: 'cleanup' });
  const clean = cleanForQuadriFlow(req.positions, req.faces);
  const why = refusal(clean.report);
  if (why) {
    post({ type: 'error', id: req.id, message: why, kind: 'input', report: clean.report });
    return;
  }
  const tLoad = performance.now();
  const qf = await make({
    print: () => {},
    printErr: () => {},
    onStage: (i: number, name: string) => post({ type: 'stage', id: req.id, stage: i, name }),
    instantiateWasm(imports: WebAssembly.Imports, done: (inst: WebAssembly.Instance, mod: WebAssembly.Module) => void) {
      void WebAssembly.instantiate(wasm, imports).then((inst) => done(inst, wasm));
      return {};
    },
  });
  qf.FS.writeFile('/in.obj', writeObj(clean.positions, clean.triangles));
  const args = ['/in.obj', '/out.obj', req.target, req.sharp ? 1 : 0, req.boundary ? 1 : 0, req.adaptive ? 1 : 0, req.seed];
  const tRun = performance.now();
  try {
    qf.ccall('qf_run', 'number', ['string', 'string', 'number', 'number', 'number', 'number', 'number'], args);
  } catch (err) {
    post({ type: 'error', id: req.id, message: describe(err), kind: 'solver', report: clean.report });
    return;
  }
  let text = '';
  try {
    text = qf.FS.readFile('/out.obj', { encoding: 'utf8' });
  } catch {
    // Reported as empty below.
  }
  const out = parseObjFaces(text);
  if (!out.faces.length) {
    post({ type: 'error', id: req.id, message: 'QuadriFlow returned no faces for this surface. Try more target faces, or Voxel remesh first.', kind: 'empty', report: clean.report });
    return;
  }
  // QuadriFlow keeps the surface but not always its winding: the faces
  // are turned to agree with the input's.
  const grid = new PointGrid(clean.positions);
  if (facesInverted(out, grid, vertexNormals(clean.positions, clean.triangles))) flipFaces(out.faces);
  post(
    {
      type: 'done',
      id: req.id,
      positions: out.positions,
      faces: out.faces,
      quads: out.quads,
      triangles: out.triangles,
      report: clean.report as CleanupReport,
      args: args.slice(2) as number[],
      ms: { total: performance.now() - t0, cleanup: tLoad - t0, solve: performance.now() - tRun },
    },
    [out.positions.buffer, out.faces.buffer],
  );
}

ctx.onmessage = (e: MessageEvent<QuadRemeshRequest>) => {
  const req = e.data;
  if (req?.type !== 'run') return;
  run(req).catch((err: unknown) => post({ type: 'error', id: req.id, message: describe(err), kind: 'solver' }));
};
