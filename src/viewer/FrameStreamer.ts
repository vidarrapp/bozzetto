import { BufferGeometry, Material, Mesh, Texture } from 'three';
import type { Object3D } from 'three';
import { getGLTFLoader } from '../loaders/gltf';
import type { FrameEntry, Tier } from '../types/manifest';

export interface FrameStreamerOptions {
  /** Frames to keep resident ahead of the playhead (forward-biased). */
  ahead?: number;
  /** Frames to keep resident behind the playhead. */
  behind?: number;
}

/**
 * Fetch / prefetch / cache / dispose of per-frame geometry (design doc §5).
 *
 * Because frames are independent meshes at a low framerate, this is a
 * prefetch-and-cache problem, not a codec problem. A sliding window of decoded
 * geometries is kept resident around the playhead; everything outside the
 * window is disposed so VRAM stays bounded by the window, not the sequence.
 */
export class FrameStreamer {
  private readonly cache = new Map<number, BufferGeometry>();
  private readonly inflight = new Map<number, Promise<BufferGeometry>>();
  private readonly ahead: number;
  private readonly behind: number;

  constructor(
    /** URL of the manifest; frame paths resolve relative to it. */
    private readonly manifestUrl: string,
    /** Frames in ordinal order (index 0 = first frame). */
    private readonly frames: FrameEntry[],
    private readonly tier: Tier,
    opts: FrameStreamerOptions = {},
  ) {
    this.ahead = opts.ahead ?? 12;
    this.behind = opts.behind ?? 3;
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
        // Drop the result if the frame fell out of the window while loading.
        if (this.inWindowOf.has(ordinal)) {
          this.cache.set(ordinal, geom);
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

  /** Set of ordinals currently inside the prefetch window. */
  private inWindowOf = new Set<number>();

  /**
   * Update the playhead: prefetch the window around it and evict everything
   * outside. Called every time the target frame changes.
   */
  setPlayhead(ordinal: number): void {
    const count = this.frames.length;
    const window = new Set<number>();
    for (let i = -this.behind; i <= this.ahead; i++) {
      const idx = ordinal + i;
      if (idx >= 0 && idx < count) window.add(idx);
    }
    this.inWindowOf = window;

    // Evict resident geometries outside the window.
    for (const idx of [...this.cache.keys()]) {
      if (!window.has(idx)) {
        this.cache.get(idx)!.dispose();
        this.cache.delete(idx);
      }
    }

    // Prefetch missing frames, closest-to-playhead first.
    const wanted = [...window].sort(
      (a, b) => Math.abs(a - ordinal) - Math.abs(b - ordinal),
    );
    for (const idx of wanted) {
      if (!this.cache.has(idx) && !this.inflight.has(idx)) {
        void this.ensure(idx).catch((err) => {
          console.error(`Frame ${idx} failed to load:`, err);
        });
      }
    }
  }

  dispose(): void {
    for (const geom of this.cache.values()) geom.dispose();
    this.cache.clear();
    this.inflight.clear();
    this.inWindowOf.clear();
  }

  private async load(ordinal: number): Promise<BufferGeometry> {
    const frame = this.frames[ordinal];
    if (!frame) throw new Error(`No frame at ordinal ${ordinal}`);
    const path =
      this.tier === 'hd' && frame.hd ? frame.hd : frame.sd;
    const url = new URL(path, this.manifestUrl).href;

    const gltf = await getGLTFLoader().loadAsync(url);

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
