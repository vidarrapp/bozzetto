import { BufferGeometry, Material, Mesh, Texture } from 'three';
import type { Object3D } from 'three';
import { getGLTFLoader } from '../loaders/gltf';
import type { AssetSource } from './AssetSource';
import type { FrameEntry, Tier } from '../types/manifest';

export interface FrameStreamerOptions {
  /** Frames to prefetch eagerly ahead of the playhead (forward-biased). */
  ahead?: number;
  /** Frames near behind the playhead that are protected from eviction. */
  behind?: number;
  /** Resident-geometry byte budget; defaults to a device-sized heuristic. */
  budgetBytes?: number;
}

/** Background-fill fetches kept in flight beyond the near window. */
const BACKGROUND_CONCURRENCY = 2;

/**
 * Resident-geometry budget when none is given: sized from device memory where
 * the browser reports it (Chrome's navigator.deviceMemory, in GB). The budget
 * counts raw attribute bytes; the real footprint is roughly double (the CPU
 * typed arrays plus their GPU buffer copies), which is what these values are
 * chosen around.
 */
function defaultBudgetBytes(): number {
  const gb = (navigator as { deviceMemory?: number }).deviceMemory;
  if (gb && gb >= 8) return 512 << 20;
  if (gb && gb <= 4) return 128 << 20;
  return 256 << 20;
}

/**
 * Fetch / prefetch / cache / dispose of per-frame geometry (design doc §5).
 *
 * Because frames are independent meshes at a low framerate, this is a
 * prefetch-and-cache problem, not a codec problem. Frames near the playhead
 * are fetched eagerly; beyond them, a slow background fill walks forward
 * (wrapping, since playback loops) until every frame is resident or a memory
 * budget is reached. A sequence that fits the budget therefore ends up cached
 * whole — scrubbing and looping never reload — while a larger one keeps the
 * budget's worth of frames around the playhead, evicting the furthest first.
 */
export class FrameStreamer {
  private readonly cache = new Map<number, BufferGeometry>();
  private readonly bytes = new Map<number, number>();
  private residentBytes = 0;
  private readonly inflight = new Map<number, Promise<BufferGeometry>>();
  private readonly ahead: number;
  private readonly behind: number;
  private readonly budget: number;
  private playhead = 0;
  private backgroundInflight = 0;
  private disposed = false;

  /** Fired whenever a frame finishes decoding into the cache (drives buffer UI). */
  onResident: (() => void) | null = null;

  constructor(
    /** Where frame bytes come from (network or embedded). */
    private readonly source: AssetSource,
    /** Frames in ordinal order (index 0 = first frame). */
    private readonly frames: FrameEntry[],
    private readonly tier: Tier,
    opts: FrameStreamerOptions = {},
  ) {
    this.ahead = opts.ahead ?? 12;
    this.behind = opts.behind ?? 3;
    this.budget = opts.budgetBytes ?? defaultBudgetBytes();
  }

  /** Already-decoded geometry for `ordinal`, or null if not resident yet. */
  get(ordinal: number): BufferGeometry | null {
    return this.cache.get(ordinal) ?? null;
  }

  has(ordinal: number): boolean {
    return this.cache.has(ordinal);
  }

  /** Begin (or reuse) a decode for `ordinal`. Resolves when resident. */
  ensure(ordinal: number): Promise<BufferGeometry> {
    const cached = this.cache.get(ordinal);
    if (cached) return Promise.resolve(cached);

    const pending = this.inflight.get(ordinal);
    if (pending) return pending;

    const job = this.load(ordinal)
      .then((geom) => {
        this.inflight.delete(ordinal);
        // Keep the result while it's still wanted: near the playhead, or in
        // budget (allowing the landing frame itself to overshoot — eviction
        // trims on the next playhead move). Otherwise it raced an eviction
        // decision and is dropped.
        if (!this.disposed && (this.nearWindow.has(ordinal) || this.residentBytes < this.budget)) {
          const size = geometryBytes(geom);
          this.cache.set(ordinal, geom);
          this.bytes.set(ordinal, size);
          this.residentBytes += size;
          this.onResident?.();
        } else {
          geom.dispose();
        }
        return geom;
      })
      .catch((err) => {
        this.inflight.delete(ordinal);
        throw err;
      });

    this.inflight.set(ordinal, job);
    return job;
  }

  /**
   * Index of the most recent resident frame at or before `ordinal`, or null.
   * Used for the playback hold so an out-of-order load never flashes a future
   * frame and snaps back.
   */
  nearestResidentAtOrBefore(ordinal: number): number | null {
    let best: number | null = null;
    for (const idx of this.cache.keys()) {
      if (idx <= ordinal && (best === null || idx > best)) best = idx;
    }
    return best;
  }

  /** Contiguous resident runs as inclusive [start, end] ordinals, ascending. */
  bufferedRanges(): Array<[number, number]> {
    const resident = [...this.cache.keys()].sort((a, b) => a - b);
    const ranges: Array<[number, number]> = [];
    for (const idx of resident) {
      const last = ranges[ranges.length - 1];
      if (last && idx === last[1] + 1) last[1] = idx;
      else ranges.push([idx, idx]);
    }
    return ranges;
  }

  /** Index of the nearest resident frame to `ordinal`, or null if none. */
  nearestResident(ordinal: number): number | null {
    if (this.cache.has(ordinal)) return ordinal;
    let best: number | null = null;
    let bestDist = Infinity;
    for (const idx of this.cache.keys()) {
      const dist = Math.abs(idx - ordinal);
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
    }
    return best;
  }

  /** Ordinals near the playhead: prefetched eagerly, protected from eviction. */
  private nearWindow = new Set<number>();

  /**
   * Update the playhead: trim to budget, fetch the near window eagerly, then
   * keep the background fill walking. Called every time the target frame
   * changes.
   */
  setPlayhead(ordinal: number): void {
    this.playhead = ordinal;
    const count = this.frames.length;
    const near = new Set<number>();
    for (let i = -this.behind; i <= this.ahead; i++) {
      const idx = ordinal + i;
      if (idx >= 0 && idx < count) near.add(idx);
    }
    this.nearWindow = near;

    this.evictOverBudget();

    // Fetch missing near-window frames, closest-to-playhead first.
    const wanted = [...near].sort(
      (a, b) => Math.abs(a - ordinal) - Math.abs(b - ordinal),
    );
    for (const idx of wanted) {
      if (!this.cache.has(idx) && !this.inflight.has(idx)) {
        void this.ensure(idx).catch((err) => {
          console.error(`Frame ${idx} failed to load:`, err);
        });
      }
    }

    this.fillBackground();
  }

  /**
   * While over budget, evict the resident frame furthest from the playhead
   * (circular distance — playback loops, so frames just behind ordinal 0 are
   * "close" when the playhead nears the end). Near-window frames are exempt,
   * so a budget smaller than the window degrades to windowed streaming.
   */
  private evictOverBudget(): void {
    const count = this.frames.length;
    while (this.residentBytes > this.budget) {
      let victim = -1;
      let victimDist = -1;
      for (const idx of this.cache.keys()) {
        if (this.nearWindow.has(idx)) continue;
        const linear = Math.abs(idx - this.playhead);
        const dist = Math.min(linear, count - linear);
        if (dist > victimDist) {
          victimDist = dist;
          victim = idx;
        }
      }
      if (victim < 0) return;
      this.cache.get(victim)!.dispose();
      this.cache.delete(victim);
      this.residentBytes -= this.bytes.get(victim) ?? 0;
      this.bytes.delete(victim);
    }
  }

  /**
   * Background fill: a few slow fetches walking forward from the near window's
   * edge (wrapping) until the whole sequence is resident or the budget is
   * spent. Each completion pulls the next candidate, so the walk follows the
   * playhead wherever it has moved since.
   */
  private fillBackground(): void {
    while (this.backgroundInflight < BACKGROUND_CONCURRENCY) {
      if (this.disposed || this.residentBytes >= this.budget) return;
      const next = this.nextBackgroundOrdinal();
      if (next === null) return;
      this.backgroundInflight++;
      void this.ensure(next)
        .catch((err) => {
          console.error(`Frame ${next} failed to load:`, err);
        })
        .finally(() => {
          this.backgroundInflight--;
          this.fillBackground();
        });
    }
  }

  /** Next unfetched ordinal walking forward (wrapped) from the window edge. */
  private nextBackgroundOrdinal(): number | null {
    const count = this.frames.length;
    for (let step = 0; step < count; step++) {
      const idx = (((this.playhead + this.ahead + 1 + step) % count) + count) % count;
      if (!this.cache.has(idx) && !this.inflight.has(idx)) return idx;
    }
    return null;
  }

  dispose(): void {
    this.disposed = true;
    for (const geom of this.cache.values()) geom.dispose();
    this.cache.clear();
    this.bytes.clear();
    this.residentBytes = 0;
    this.inflight.clear();
    this.nearWindow.clear();
  }

  private async load(ordinal: number): Promise<BufferGeometry> {
    const frame = this.frames[ordinal];
    if (!frame) throw new Error(`No frame at ordinal ${ordinal}`);
    const path =
      this.tier === 'hd' && frame.hd ? frame.hd : frame.sd;

    // Parse from bytes (not a URL) so the same path works whether the bytes
    // arrive over the network or from an embedded base64 registry.
    const bytes = await this.source.getBytes(path);
    const gltf = await getGLTFLoader().parseAsync(bytes, '');

    let geometry: BufferGeometry | null = null;
    gltf.scene.traverse((obj: Object3D) => {
      const mesh = obj as Mesh;
      if (!geometry && mesh.isMesh && mesh.geometry) {
        geometry = mesh.geometry as BufferGeometry;
      }
    });
    if (!geometry) {
      throw new Error(`No mesh found in frame ${ordinal} (${path})`);
    }

    // Decimated exports may omit normals; compute them so shading reads.
    const geom = geometry as BufferGeometry;
    if (!geom.getAttribute('normal')) geom.computeVertexNormals();
    geom.computeBoundingBox();
    geom.computeBoundingSphere();

    // The loaded glTF brings materials/textures we never use (the viewer owns
    // materials). Dispose them so they don't leak; keep the geometry.
    disposeUnusedGltfResources(gltf.scene, geom);

    return geom;
  }
}

/** Attribute + index bytes of a geometry (the budgeted quantity). */
function geometryBytes(geom: BufferGeometry): number {
  let total = geom.index ? geom.index.array.byteLength : 0;
  for (const attr of Object.values(geom.attributes)) {
    total += attr.array.byteLength;
  }
  return total;
}

/** Dispose every material/texture under `root`, except `keepGeometry`. */
function disposeUnusedGltfResources(
  root: Object3D,
  keepGeometry: BufferGeometry,
): void {
  root.traverse((obj: Object3D) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as Material | Material[] | undefined;
    const materials = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const m of materials) {
      for (const value of Object.values(m as unknown as Record<string, unknown>)) {
        if (value instanceof Texture) value.dispose();
      }
      m.dispose();
    }
    if (mesh.geometry && mesh.geometry !== keepGeometry) {
      mesh.geometry.dispose();
    }
  });
}
