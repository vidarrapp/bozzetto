import type { AssetSource } from '../viewer/AssetSource';
import type { Viewer } from '../viewer/Viewer';
import { matcapAssetUrls } from '../viewer/Materials';
import { envAssetUrl } from '../viewer/Environment';
import { buildSingleFileHtml } from './singleFile.js';

/**
 * Browser-side glue for the single-file export, shared by the admin editor and
 * the public /create editor. The pure HTML assembly lives in singleFile.js; this
 * module gathers the bytes (frames through the viewer's AssetSource, shared
 * static assets fetched fresh) and triggers the download.
 */

export interface Asset {
  path: string;
  bytes: Uint8Array;
}

/** A manifest-shaped object: enough for the gather and the embedded registry. */
export interface ExportManifest {
  frames: { sd: string }[];
  environment?: unknown;
  title?: unknown;
  defaults?: unknown;
  [key: string]: unknown;
}

/** Overlay the live preview's current look onto a base manifest for export. */
export function buildExportManifest(base: ExportManifest, p: Viewer): ExportManifest {
  return {
    ...base,
    lighting: p.lighting.serialize(),
    material: p.materials.getMaterialState(),
    environment: p.environment.getState(),
    ao: p.getAOState(),
    camera: p.getCameraState(),
    defaults: { ...(base.defaults as object), material: p.getMaterial() },
  };
}

/**
 * Fetch bytes bypassing the HTTP cache. The shared matcaps and HDRIs are served
 * with a long max-age, so a plain fetch can hand back a stale copy from before
 * the asset was updated; a unique query plus `reload` guarantees the current
 * file is what gets embedded.
 */
async function fetchFresh(path: string): Promise<Uint8Array> {
  const bust = `${path}${path.includes('?') ? '&' : '?'}_export=${Date.now()}`;
  const res = await fetch(bust, { cache: 'reload' });
  if (!res.ok) throw new Error(`Failed to fetch ${path} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Every byte the embedded viewer will request, keyed exactly as it asks for
 * them: frames through the source (network or in-memory), and the matcaps and
 * selected HDRI fetched fresh.
 */
export async function collectAssets(manifest: ExportManifest, source: AssetSource): Promise<Asset[]> {
  const frames = await Promise.all(
    manifest.frames.map(async (f) => ({
      path: f.sd,
      bytes: new Uint8Array(await source.getBytes(f.sd)),
    })),
  );

  const staticPaths = [...matcapAssetUrls()];
  const envId = (manifest.environment as { id?: string } | null)?.id;
  if (envId) {
    const url = envAssetUrl(envId);
    if (url) staticPaths.push(url);
  }
  const statics = await Promise.all(
    staticPaths.map(async (path) => ({ path, bytes: await fetchFresh(path) })),
  );

  return [...frames, ...statics];
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: 'reload' });
  if (!res.ok) throw new Error(`Failed to fetch ${url} (${res.status}) — build the site first`);
  return res.text();
}

/** Gather everything and assemble the self-contained HTML document. */
export async function buildExportHtml(manifest: ExportManifest, source: AssetSource): Promise<string> {
  const [assets, viewerJs, css] = await Promise.all([
    collectAssets(manifest, source),
    fetchText('/embed/viewer.js'),
    fetchText('/embed/embed.css'),
  ]);
  return buildSingleFileHtml({
    manifest: manifest as unknown,
    assets,
    viewerJs,
    css,
    title: typeof manifest.title === 'string' ? manifest.title : undefined,
  });
}

/** Trigger a browser download of an in-memory blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
