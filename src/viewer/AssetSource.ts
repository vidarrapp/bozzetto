import type { Manifest } from '../types/manifest';
import { validateManifest } from '../types/manifest';
import { appAsset } from '../net/origin';

/**
 * The seam between the viewer and where its bytes come from (frames, HDRIs,
 * matcaps). Everything the viewer loads is a manifest path or an absolute
 * asset path; an AssetSource turns that path into bytes. Two implementations
 * exist: HttpSource (the live site, over the network) and MemorySource (the
 * /create editor, frames held in memory). The viewer is unaware of which it
 * has.
 */
export interface AssetSource {
  getManifest(): Promise<Manifest>;
  /** Bytes for a path. Frame paths are manifest-relative; assets are absolute. */
  getBytes(path: string): Promise<ArrayBuffer>;
}

/** Live network source: paths resolve against the manifest URL and fetch. */
export class HttpSource implements AssetSource {
  constructor(private readonly manifestUrl: string) {}

  async getManifest(): Promise<Manifest> {
    const res = await fetch(this.manifestUrl);
    if (!res.ok) throw new Error(`Failed to load manifest (${res.status})`);
    return validateManifest(await res.json());
  }

  async getBytes(path: string): Promise<ArrayBuffer> {
    // Two kinds of path arrive here and they resolve differently.
    //
    // FRAME MEDIA belongs to the project, so it resolves against the
    // manifest: API manifests carry root-absolute /media/... (landing on
    // whichever host served them), or a full address on the server's files
    // host, and the bundled demo carries relative frames/sd/0000.glb
    // (landing beside its own manifest). All are already correct and must
    // be left alone.
    //
    // APP ASSETS - matcaps and HDRIs, requested through this same method -
    // belong to the app, and are root-absolute too. Resolving those against
    // the manifest is only invisible while the app and the project share an
    // origin. In the desktop shell they do not, and opening a remote
    // project would fetch ten matcaps and a 1.5 MB HDRI off the user's own
    // deployment - slow at best, and grey materials against a fork whose
    // /assets/ differ.
    if (path.startsWith('/assets/')) {
      const res = await fetch(appAsset(path));
      if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
      return res.arrayBuffer();
    }
    const url = new URL(path, this.manifestUrl).href;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return res.arrayBuffer();
  }
}

/** Drop a `?query` / `#hash` so asset keys are stable across cache versions. */
export function stripQuery(path: string): string {
  return path.replace(/[?#].*$/, '');
}

/**
 * In-memory source for the public /create editor: frame bytes are held as they
 * are converted (never uploaded), and shared assets (matcaps, HDRIs) fall back
 * to a cache-bypassed fetch from the site. Lets the live preview run the real
 * viewer with no backend.
 */
export class MemorySource implements AssetSource {
  private readonly frames = new Map<string, ArrayBuffer>();
  private manifest: Manifest | null = null;

  setManifest(manifest: Manifest): void {
    this.manifest = manifest;
  }

  putFrame(path: string, bytes: ArrayBuffer): void {
    this.frames.set(stripQuery(path), bytes);
  }

  clearFrames(): void {
    this.frames.clear();
  }

  async getManifest(): Promise<Manifest> {
    if (!this.manifest) throw new Error('MemorySource: manifest not set');
    return this.manifest;
  }

  async getBytes(path: string): Promise<ArrayBuffer> {
    const inMem = this.frames.get(stripQuery(path));
    if (inMem) return inMem;
    const res = await fetch(path, { cache: 'reload' });
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return res.arrayBuffer();
  }
}

/**
 * Fetch bytes through the source and hand a loader a URL it can consume. Used
 * for assets whose three.js loader is URL-based (HDRI, matcap textures): the
 * bytes become a same-origin blob: URL, which loads even from a file:// page.
 */
export async function loadViaBlob<T>(
  source: AssetSource,
  path: string,
  mime: string,
  load: (url: string) => Promise<T>,
): Promise<T> {
  const bytes = await source.getBytes(path);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    return await load(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
