/**
 * The .bozz scene container, as both sides read it: the app, which packs
 * and opens scenes (src/sculpt/bridge/SceneFile.ts), and the server, which
 * holds an upload's first part to it before R2 sees a byte
 * (functions/_shared/content.ts, docs/accounts.md §4). Layout before
 * compression, all little-endian:
 *
 *   u32 magic 'BOZ1' | u32 headerLen | header JSON | pad4 | blob region
 *
 * The header is the SavedScene with every typed array swapped for
 * {"__buf": n} against a buffers table of {t: 'f32'|'u32', off, len}.
 *
 * readLayout() and what it throws are SceneFile.ts's own, moved here
 * unchanged. checkHeader() is what validSavedScene (ScenePersist.ts) and
 * sanitize.ts ask of a scene that can be answered without its arrays'
 * contents, so the server can refuse a scene the app would refuse from
 * its header alone.
 *
 * This file is compiled by both tsconfig.json and tsconfig.functions.json,
 * so it may use nothing a browser or a Worker lacks: no DOM, no streams.
 */

export const MAGIC = 0x315a4f42; // "BOZ1"

/**
 * The most a scene file may unpack to. The largest scene Sculpt makes is
 * one object at the subdivision ceiling (SculptSession: 16M triangles at
 * the top level, about 8M vertices). Its top level is 84 bytes a vertex -
 * positions, normals, colours and materials, and three detail vectors, 12
 * bytes each - and the levels below add a third again: about 900 MB, a
 * size the autosave already declines to write (ScenePersist). 1 GiB is
 * above that and is reached by nothing legitimate; a file that claims more,
 * or inflates past it, is refused before it is held.
 */
export const MAX_SCENE_BYTES = 1024 * 1024 * 1024;

/** The header is the look, materials, settings and a few fields an object: kilobytes in practice. */
const MAX_HEADER_BYTES = 16 * 1024 * 1024;

/** How deep the header may nest. A scene's goes six levels down. */
export const MAX_DEPTH = 32;

/** A refusal of the file itself, as against the stream failing under it. */
export class SceneFileError extends Error {}

export const notAScene = (): SceneFileError => new SceneFileError('This file is not a Bozzetto scene');
const tooLarge = (): SceneFileError => new SceneFileError('This scene is too large to open');
export const damaged = (why: string): SceneFileError => new SceneFileError(`This scene file is damaged (${why})`);

/** Up to a multiple of four. Not `(n + 3) & ~3`, which is 32-bit and goes negative past 2^31. */
export const pad4 = (n: number): number => Math.ceil(n / 4) * 4;

export interface BufferEntry {
  t: 'f32' | 'u32';
  off: number;
  len: number;
}

/** What a container's header says: the scene with its arrays as references, and where they are. */
export interface Layout {
  scene: unknown;
  buffers: BufferEntry[];
  /** Where the blob region starts. */
  blobBase: number;
  /** Where the file ends, header and every array included. */
  size: number;
}

/**
 * The layout from a container's first bytes - or, until the header is all
 * there, how many bytes it takes to say. Everything the header claims is
 * checked against everything else before a byte is set aside for it: its
 * own length, each array's place and size, and what they come to together.
 */
export function readLayout(head: Uint8Array): Layout | number {
  if (head.length < 8) return 8;
  const dv = new DataView(head.buffer, head.byteOffset, 8);
  // The magic alone settles most files that are not scenes, early.
  if (dv.getUint32(0, true) !== MAGIC) throw notAScene();
  const headerLen = dv.getUint32(4, true);
  if (headerLen === 0 || headerLen > MAX_HEADER_BYTES) throw notAScene();
  if (head.length < 8 + headerLen) return 8 + headerLen;
  let parsed: { scene?: unknown; buffers?: unknown } | null;
  try {
    parsed = JSON.parse(new TextDecoder().decode(head.subarray(8, 8 + headerLen))) as typeof parsed;
  } catch {
    throw notAScene();
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.buffers)) throw notAScene();
  const buffers = parsed.buffers as BufferEntry[];
  let end = 0;
  let declared = 0;
  for (const e of buffers) {
    if (
      !e ||
      (e.t !== 'f32' && e.t !== 'u32') ||
      !Number.isSafeInteger(e.off) ||
      !Number.isSafeInteger(e.len) ||
      e.off < 0 ||
      e.len < 0
    ) {
      throw damaged('a bad buffer entry');
    }
    end = Math.max(end, e.off + e.len * 4);
    declared += e.len * 4;
  }
  const blobBase = 8 + pad4(headerLen);
  const size = blobBase + pad4(end);
  if (size > MAX_SCENE_BYTES) throw tooLarge();
  // Each array comes out as a copy, so the copies together may be no
  // bigger than the region they come out of. Otherwise a few kilobytes of
  // header could point a thousand entries at one region and ask for a
  // thousand copies of it.
  if (declared > size - blobBase) throw damaged('arrays that overlap');
  return { scene: parsed.scene, buffers, blobBase, size };
}

// --- the header, held to what the app will open -----------------------------------

/** Long enough for any name a person types, as sanitize.ts cuts one (its MAX_NAME). */
export const MAX_NAME = 200;
/** More materials than anyone makes, as sanitize.ts keeps (its MAX_MATERIALS). */
export const MAX_MATERIALS = 1024;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Whether the scene a layout describes is one the app would open, as far
 * as its header can say: what validSavedScene and sanitize.ts check that
 * needs no array's contents, and what revive() refuses on its walk. Throws
 * a SceneFileError naming the first thing wrong:
 *
 * - every value at most MAX_DEPTH deep, and no field called `__proto__`;
 * - every array reference an integer naming an entry of the table, and no
 *   entry named twice;
 * - a version the app reads (3 or 4), at least one object, and a selected
 *   object among them;
 * - per object: its faces a u32 array of four a face, at least one level
 *   and a selected level among them, a matrix of 16; per level: at least
 *   one vertex, positions, colours and materials f32 arrays of three a
 *   vertex, and normals and the three detail vectors the same or null;
 * - names of at most MAX_NAME characters, at most MAX_MATERIALS materials;
 * - at most MAX_SCENE_BYTES unpacked, as readLayout already holds it to.
 *
 * What it cannot see - a face naming a vertex past the last, a matrix that
 * is not finite - the app checks or mends when it opens the file.
 */
export function checkHeader(layout: Layout): void {
  const { buffers } = layout;
  if (layout.size > MAX_SCENE_BYTES) throw tooLarge();
  const used = new Set<number>();
  // revive()'s walk, without the copies: what it would refuse, refused.
  const walk = (v: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) throw damaged('it nests too deeply');
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (!v || typeof v !== 'object') return;
    const ref = (v as { __buf?: unknown }).__buf;
    if (ref !== undefined) {
      if (typeof ref !== 'number' || !Number.isInteger(ref)) throw damaged('a bad array reference');
      if (!buffers[ref]) throw damaged('a missing array');
      if (used.has(ref)) throw damaged('an array used twice');
      used.add(ref);
      return;
    }
    for (const [k, val] of Object.entries(v)) {
      if (k === '__proto__') throw damaged('a field called __proto__');
      walk(val, depth + 1);
    }
  };
  walk(layout.scene, 0);

  /** The table entry a field refers to, or null when it is not a reference. */
  const entry = (v: unknown): BufferEntry | null => {
    const ref = isRec(v) ? v.__buf : undefined;
    return typeof ref === 'number' ? (buffers[ref] ?? null) : null;
  };
  /** An array of `kind` and `len` numbers, where the walk has already checked the reference itself. */
  const array = (v: unknown, kind: BufferEntry['t'], len: number): boolean => {
    const e = entry(v);
    return !!e && e.t === kind && e.len === len;
  };
  const name = (v: unknown, what: string): void => {
    if (typeof v === 'string' && v.length > MAX_NAME) throw damaged(`${what} has a name over ${MAX_NAME} characters`);
  };

  const scene = layout.scene;
  if (!isRec(scene)) throw damaged('it holds no scene');
  if (scene.v !== 3 && scene.v !== 4) throw damaged('a version this app does not read');
  const meshes = scene.meshes;
  if (!Array.isArray(meshes) || meshes.length === 0) throw damaged('it has no objects');
  if (typeof scene.active !== 'number' || !Number.isInteger(scene.active) || scene.active < 0 || scene.active >= meshes.length) {
    throw damaged('no object is selected');
  }
  meshes.forEach((m: unknown, i: number) => {
    const object = `object ${i + 1}`;
    if (!isRec(m)) throw damaged(`${object} is not one`);
    const faces = m.nbBaseFaces;
    if (typeof faces !== 'number' || !Number.isSafeInteger(faces) || faces <= 0) throw damaged(`${object} has no faces`);
    if (!array(m.baseFaces, 'u32', faces * 4)) throw damaged(`${object} has faces of the wrong kind or size`);
    const levels = m.levels;
    if (!Array.isArray(levels) || levels.length === 0) throw damaged(`${object} has no levels`);
    if (typeof m.sel !== 'number' || !Number.isInteger(m.sel) || m.sel < 0 || m.sel >= levels.length) {
      throw damaged(`${object} selects no level`);
    }
    const matrix = entry(m.matrix);
    if (!(matrix ? matrix.len === 16 : Array.isArray(m.matrix) && m.matrix.length === 16)) {
      throw damaged(`${object} has no matrix`);
    }
    name(m.name, object);
    levels.forEach((l: unknown, j: number) => {
      const level = `${object}, level ${j}`;
      if (!isRec(l)) throw damaged(`${level} is not one`);
      const n = l.nbVertices;
      if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0) throw damaged(`${level} has no vertices`);
      const fits = (v: unknown) => array(v, 'f32', n * 3);
      const fitsOrNull = (v: unknown) => v === null || fits(v);
      if (
        !fits(l.vertices) ||
        !fits(l.colors) ||
        !fits(l.materials) ||
        !fitsOrNull(l.normals) ||
        !fitsOrNull(l.detailsXYZ) ||
        !fitsOrNull(l.detailsRGB) ||
        !fitsOrNull(l.detailsPBR)
      ) {
        throw damaged(`${level} has arrays of the wrong kind or size`);
      }
    });
  });
  const materials = scene.materials;
  if (Array.isArray(materials)) {
    if (materials.length > MAX_MATERIALS) throw damaged(`more than ${MAX_MATERIALS} materials`);
    for (const m of materials) if (isRec(m)) name(m.name, 'a material');
  }
}
