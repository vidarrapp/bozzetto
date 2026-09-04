import type { Manifest } from '../types/manifest';
import { validateManifest } from '../types/manifest';
import { appAsset, apiFetch, isDesktop } from '../net/origin';

/**
 * The seam between the viewer and where its bytes come from (frames, HDRIs,
 * matcaps). Everything the viewer loads is a manifest path or an absolute
 * asset path; an AssetSource turns that path into bytes. Two implementations
 * exist: HttpSource (the live site, over the network) and EmbeddedSource (a
 * self-contained single-file export, reading inlined base64). The viewer is
 * unaware of which it has, so the same code runs online and offline.
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
    if (isDesktop() && !this.manifestUrl.startsWith(window.location.origin)) {
      const u = new URL(this.manifestUrl);
      const r = await apiFetch(u.pathname + u.search);
      if (!r.ok || !r.bytes) throw new Error(`Failed to load manifest (${r.status})`);
      return validateManifest(JSON.parse(new TextDecoder().decode(r.bytes)));
    }
    const res = await fetch(this.manifestUrl);
    if (!res.ok) throw new Error(`Failed to load manifest (${res.status})`);
    return validateManifest(await res.json());
  }

  async getBytes(path: string): Promise<ArrayBuffer> {
    // Two kinds of path arrive here and they resolve differently.
    //
    // FRAME MEDIA belongs to the project, so it resolves against the
    // manifest: API manifests carry root-absolute /media/... (landing on
    // whichever host served them) and the bundled demo carries relative
    // frames/sd/0000.glb (landing beside its own manifest). Both are
    // already correct and must be left alone.
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
    // In the desktop shell, frames belonging to a REMOTE project are
    // cross-origin and a renderer fetch would be refused - the deployment
    // sends no CORS headers. Those go out through the main process like
    // every other server call. Frames of the bundled demo resolve onto the
    // app's own protocol and stay a plain fetch.
    if (isDesktop() && !url.startsWith(window.location.origin)) {
      const r = await apiFetch(new URL(url).pathname + new URL(url).search);
      if (!r.ok || !r.bytes) throw new Error(`Failed to load ${path} (${r.status})`);
      return r.bytes;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
    return res.arrayBuffer();
  }
}

/** The shape injected as `window.__BOZZETTO__` by a single-file export. */
export interface EmbeddedRegistry {
  /** The raw (unvalidated) manifest object. */
  manifest: unknown;
  /** Asset bytes as base64, keyed by the exact path the viewer requests. */
  assets: Record<string, string>;
}

/** Offline source: everything is inlined as base64, nothing touches the network. */
export class EmbeddedSource implements AssetSource {
  constructor(private readonly registry: EmbeddedRegistry) {}

  async getManifest(): Promise<Manifest> {
    return validateManifest(this.registry.manifest);
  }

  async getBytes(path: string): Promise<ArrayBuffer> {
    // Keys are stored without a query string, so a cache-busting `?v=` on a
    // matcap (or a `?v=` frame version) still resolves to the embedded bytes.
    const b64 = this.registry.assets[path] ?? this.registry.assets[stripQuery(path)];
    if (b64 === undefined) throw new Error(`Embedded asset not found: ${path}`);
    return base64ToArrayBuffer(b64);
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

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
