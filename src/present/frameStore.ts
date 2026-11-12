import { frameFromFile, runPool } from '../admin/convert';
import type { AssetSource } from '../viewer/AssetSource';
import { HttpSource, stripQuery } from '../viewer/AssetSource';
import type { Manifest } from '../types/manifest';

/**
 * The frames of the Present workspace's working copy (present/): the
 * sequence as it stands on the page, in order, before it is saved. A frame
 * is either one that is already on the site (`url`, read through the
 * owner's routes) or one converted here from a file and held in memory
 * (`glb`). Add, move, remove and clear change this list alone; nothing
 * reaches the server until the one Save, and the viewer plays the list
 * through `FramesSource`, whatever mix of the two it holds.
 */

/** The server's frame list cap (functions/_shared/projects.ts), checked before a byte goes up. */
export const MAX_FRAMES = 10_000;

export interface FrameItem {
  /** Stable while the frame is on the page, whatever its place (a row's key). */
  key: number;
  /** The file's name, or "Frame N" for one that came from the site. */
  name: string;
  tris: number;
  /** What is held in memory for it: the converted file's size, 0 for a frame on the site. */
  bytes: number;
  /** The converted file; null for a frame that is on the site. */
  glb: ArrayBuffer | null;
  /** Where the site serves it, when it is there; and the place (index) it has there. */
  url: string | null;
  index: number | null;
}

/** The path the viewer is told for the frame at a place in the list. */
export const framePath = (i: number): string => `frames/sd/${String(i).padStart(4, '0')}.glb`;

const naturalSort = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

let nextKey = 1;
export const newKey = (): number => nextKey++;

/** The frames the list's entries make, as the manifest and the server write them. */
export const manifestFrames = (entries: readonly FrameItem[]): Manifest['frames'] =>
  entries.map((f, i) => ({ index: i, sd: framePath(i), hd: null, tris: f.tris }));

/**
 * Where the viewer's bytes come from: a frame path names a place in the
 * list, and the list says whether its bytes are held or on the site. Every
 * other path (matcaps, the environment) is the app's own, through `base`.
 */
export class FramesSource implements AssetSource {
  entries: readonly FrameItem[] = [];
  private manifest: Manifest | null = null;

  constructor(private readonly base: HttpSource) {}

  setManifest(manifest: Manifest): void {
    this.manifest = manifest;
  }

  async getManifest(): Promise<Manifest> {
    if (!this.manifest) throw new Error('FramesSource: manifest not set');
    return this.manifest;
  }

  getBytes(path: string): Promise<ArrayBuffer> {
    const at = /^frames\/sd\/(\d{4})\.glb$/.exec(stripQuery(path));
    if (!at) return this.base.getBytes(path);
    return this.bytesOf(this.entries[Number(at[1])]);
  }

  /** One frame's bytes, held or fetched. */
  async bytesOf(entry: FrameItem | undefined): Promise<ArrayBuffer> {
    if (!entry) throw new Error('That frame is not in the list');
    if (entry.glb) return entry.glb;
    if (entry.url) return this.base.getBytes(entry.url);
    throw new Error('That frame has no file');
  }
}

/** The files a person gave, the .obj and .glb ones, in natural order (frame2 before frame10). */
export function framesFiles(list: readonly File[]): File[] {
  return list.filter((f) => /\.(obj|glb)$/i.test(f.name)).sort((a, b) => naturalSort(a.name, b.name));
}

/**
 * Convert files into frames, four at a time, telling `tick` as each one
 * finishes. Resolves in the files' order; the first refusal rejects.
 */
export async function convertFiles(
  files: readonly File[],
  zUp: boolean,
  tick: (done: number) => void,
): Promise<FrameItem[]> {
  let done = 0;
  const tasks = files.map((file) => async (): Promise<FrameItem> => {
    const { glb, tris } = await frameFromFile(file, zUp);
    tick(++done);
    return { key: newKey(), name: file.name, tris, bytes: glb.byteLength, glb, url: null, index: null };
  });
  return runPool(tasks, 4);
}

/** The frames of a project on the site, as entries (the owner's manifest names where each is served). */
export function entriesFromProject(frames: ReadonlyArray<{ index: number; tris: number; sd?: string | null }>): FrameItem[] {
  return [...frames]
    .sort((a, b) => a.index - b.index)
    .map((f) => ({
      key: newKey(),
      name: `Frame ${f.index + 1}`,
      tris: f.tris,
      bytes: 0,
      glb: null,
      url: f.sd ?? null,
      index: f.index,
    }));
}

/** The bytes held in memory for the list, in megabytes. */
export const heldMegabytes = (entries: readonly FrameItem[]): number => entries.reduce((s, f) => s + f.bytes, 0) / 1e6;
