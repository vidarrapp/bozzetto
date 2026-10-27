import type { CleanupReport } from './quadMesh';

/**
 * The messages between the page (quadRemesh.ts) and the Quad remesh
 * worker (quadRemesh.worker.ts).
 */
export interface QuadRemeshRequest {
  type: 'run';
  id: number;
  /** Where public/ is served from (the site's root), for quadriflow/*. */
  base: string;
  /** The wasm build's content hash, so a new build is fetched afresh. */
  version: string;
  /** Local space, three a vertex. */
  positions: Float32Array;
  /** Four a face, TRI_INDEX for a triangle's fourth. */
  faces: Uint32Array;
  target: number;
  sharp: boolean;
  boundary: boolean;
  adaptive: boolean;
  seed: number;
}

export type QuadRemeshReply =
  | { type: 'stage'; id: number; stage: number; name: string }
  | {
      type: 'done';
      id: number;
      positions: Float32Array;
      faces: Uint32Array;
      quads: number;
      triangles: number;
      report: CleanupReport;
      /** What qf_run was called with after the two paths: faces, sharp, boundary, adaptive, seed. */
      args: number[];
      ms: { total: number; cleanup: number; solve: number };
    }
  | { type: 'error'; id: number; message: string; kind: 'input' | 'solver' | 'empty'; report?: CleanupReport };

/**
 * The stages a run reports, in order: the two of the worker's own (the
 * module's download, the cleanup), then QuadriFlow's (qf_wasm.cpp's
 * qf_stage calls; slope only with adaptive sizing). Each with where the
 * bar starts and what the panel says. The bar's shares are measured on
 * spheres of 10k to 25k triangles at 2000 to 8000 faces, where the index
 * map (the flow solve and the quad extraction) takes most of the time.
 */
export const QF_STAGES: ReadonlyArray<{ stage: number; name: string; label: string; at: number }> = [
  { stage: -2, name: 'module', label: 'Loading QuadriFlow', at: 0 },
  { stage: -1, name: 'cleanup', label: 'Cleaning the surface', at: 1 },
  { stage: 0, name: 'load', label: 'Reading the surface', at: 3 },
  { stage: 1, name: 'initialize', label: 'Building the hierarchy', at: 6 },
  { stage: 2, name: 'orientations', label: 'Orientation field', at: 12 },
  { stage: 3, name: 'slope', label: 'Adaptive sizing', at: 19 },
  { stage: 4, name: 'scale', label: 'Scale field', at: 21 },
  { stage: 5, name: 'positions', label: 'Position field', at: 23 },
  { stage: 6, name: 'index map', label: 'Extracting quads', at: 40 },
  { stage: 7, name: 'write', label: 'Writing the mesh', at: 97 },
];

export function stageInfo(stage: number): { label: string; at: number } {
  const s = QF_STAGES.find((x) => x.stage === stage);
  return s ? { label: s.label, at: s.at } : { label: 'Working', at: 0 };
}
