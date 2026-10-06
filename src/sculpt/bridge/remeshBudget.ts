/**
 * What a voxel remesh costs in memory, and whether this device can spare
 * it (owner request: up to 512 voxels, with a clear refusal rather than a
 * tab that dies). Shared by Sculpt's Remesh and Merge and by Armature's
 * Send to Sculpt, which all run the same remesher at one resolution.
 *
 * The vendored remesher (editing/Remesh.js) builds a DENSE grid over the
 * bounding box of what it remeshes: the longest side cut into `resolution`
 * cells, padded by 1.51 cells all round. Every cell carries its distance
 * (4 bytes), a colour and a material (12 + 12) and three crossed-edge
 * flags (3) in one buffer, and while the flood fill runs a tag (1) and a
 * stack slot (4) beside it: 36 bytes a cell at the peak. A cube's grid at
 * 512 is 516 cells a side, 137 million cells, 4.6 GiB. The surface it
 * then builds - the vertices, the mesh around them, their copies for the
 * GPU - costs a few hundred bytes a vertex, about one vertex per cell the
 * surface passes through; the grid box's own surface stands in for that
 * count, which few closed shapes inside it come near.
 */

/** A world-space box as the vendored core writes one: min x, y, z, then max x, y, z. */
export type Box6 = ArrayLike<number>;

/** The resolutions a remesh takes (owner call: up from 400 to 512). */
export const REMESH_LIMITS = { min: 8, max: 512 } as const;

const BYTES_PER_CELL = 36;
const BYTES_PER_SURFACE_CELL = 400;
const GiB = 2 ** 30;
const MiB = 2 ** 20;
/**
 * One remesh may take a quarter of what the browser says the device has:
 * the page, the scene and its undo history, the browser and everything
 * else running all share the rest.
 */
const DEVICE_SHARE = 1 / 4;
/**
 * Where the browser does not say (Safari and Firefox keep
 * navigator.deviceMemory to themselves, so every iPad lands here): the
 * share of a 4 GB device, on the safe side of most. Chrome's reading is
 * rounded down to a power of two and capped at 8, so 2 GB is its most.
 */
const FALLBACK_BUDGET = 4 * GiB * DEVICE_SHARE;

/** The grid Remesh.js builds over `box`: its cell size, its corner and its cells along each axis. */
export interface VoxelGrid {
  step: number;
  min: [number, number, number];
  dims: [number, number, number];
}

export function voxelGrid(box: Box6, resolution: number): VoxelGrid | null {
  const size = [box[3] - box[0], box[4] - box[1], box[5] - box[2]];
  const step = Math.max(size[0], size[1], size[2]) / resolution;
  if (!(step > 0) || !Number.isFinite(step)) return null;
  // Remesh.js's createVoxelData, to the cell.
  const pad = step * 1.51;
  const cells = (s: number): number => Math.ceil((s + 2 * pad) / step);
  return {
    step,
    min: [box[0] - pad, box[1] - pad, box[2] - pad],
    dims: [cells(size[0]), cells(size[1]), cells(size[2])],
  };
}

/** Bytes a remesh of `box` at `resolution` holds at its peak (see the module comment). */
export function remeshBytes(box: Box6, resolution: number): number {
  const g = voxelGrid(box, resolution);
  if (!g) return 0;
  const [x, y, z] = g.dims;
  return x * y * z * BYTES_PER_CELL + 2 * (x * y + y * z + z * x) * BYTES_PER_SURFACE_CELL;
}

/** What this device can spare for one remesh, read each time (a test sets it). */
export function remeshBudget(): number {
  const gb = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory;
  return typeof gb === 'number' && Number.isFinite(gb) && gb > 0 ? gb * GiB * DEVICE_SHARE : FALLBACK_BUDGET;
}

/** The highest resolution whose remesh of `box` fits the budget. */
export function maxRemeshResolution(box: Box6, budget = remeshBudget()): number {
  let lo: number = REMESH_LIMITS.min;
  let hi: number = REMESH_LIMITS.max;
  if (remeshBytes(box, hi) <= budget) return hi;
  // The bytes only grow with the resolution, so halve the range.
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (remeshBytes(box, mid) <= budget) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** "610 MB", "4.6 GB": a size as the refusal and the overlay say it. */
export function formatBytes(n: number): string {
  return n >= GiB ? `${(n / GiB).toFixed(1)} GB` : `${Math.max(1, Math.round(n / MiB))} MB`;
}

/** A remesh refused for its size, before anything was built: the message says what would fit. */
export class RemeshTooLarge extends Error {
  constructor(
    readonly resolution: number,
    readonly bytes: number,
    readonly budget: number,
    /** The highest resolution that fits, for this object on this device. */
    readonly fits: number,
  ) {
    super(
      `A remesh at ${resolution} would need about ${formatBytes(bytes)}, more than this device can spare ` +
        `(about ${formatBytes(budget)}). For this object, ${fits} is the most it can take.`,
    );
    this.name = 'RemeshTooLarge';
  }
}

/** Throw RemeshTooLarge when a remesh of `box` at `resolution` would not fit. */
export function checkRemesh(box: Box6, resolution: number): void {
  const budget = remeshBudget();
  const bytes = remeshBytes(box, resolution);
  if (bytes > budget) throw new RemeshTooLarge(resolution, bytes, budget, maxRemeshResolution(box, budget));
}

/** The world box of triangles given as positions (Armature's baked figure). */
export function boxOfPositions(positions: ArrayLike<number>): number[] {
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < box[k]) box[k] = v;
      if (v > box[k + 3]) box[k + 3] = v;
    }
  }
  return box;
}
