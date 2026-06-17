import type { Manifest } from '../types/manifest';
import { validateManifest } from '../types/manifest';

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
    const res = await fetch(this.manifestUrl);
    if (!res.ok) throw new Error(`Failed to load manifest (${res.status})`);
    return validateManifest(await res.json());
  }

  async getBytes(path: string): Promise<ArrayBuffer> {
    const url = new URL(path, this.manifestUrl).href;
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
