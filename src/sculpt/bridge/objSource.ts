import Subdivision from '@sculpt-vendor/editing/Subdivision';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { ParsedObjPolygons } from '../../admin/glb';
import {
  MAX_SOURCE_CORNERS,
  MAX_SOURCE_LINES,
  MAX_SOURCE_TEXT_BYTES,
  MAX_SOURCE_VERTICES,
} from '../../../shared/bozz';

/**
 * The file's own numbering, kept for an object imported from OBJ (owner
 * decision): level 0 of its stack is the file's vertices and faces, and
 * File > Export OBJ, with the object selected, writes level 0 back in the
 * file's order, so an artist can bring a model from Maya or 3ds Max, sculpt it
 * here and take it back with the same vertex ids (blend shapes, skinning
 * and UVs keyed on vertex order still line up).
 *
 * The record (ObjSource) rides the object through the scene file and the
 * autosave (SavedMesh.source). It holds what the engine does not:
 *
 * - which level-0 vertex each file vertex became. The import welds by
 *   position (seams would tear under the brush otherwise), so two file
 *   vertices can share one; both still export, at its place. A vertex no
 *   face uses never reaches the engine and keeps its file position;
 * - the faces as the file wrote them, whole (the engine keeps quads and
 *   triangles; a pentagon is a quad and a triangle there), with their vt
 *   ids, and the vt lines verbatim: sculpting does not move UVs. Normals
 *   are not kept, since they change; the export writes `f v/vt` or `f v`;
 * - the o, g, usemtl, s and mtllib lines, each with the number of faces
 *   before it, so they go back where they stood;
 * - level 0 as the import built it (`base`), and the transform from the
 *   file's space to that level's local space (Z-up's turn);
 * - the scale folded into the vertices since (`bake`, bakeScale.ts): the
 *   fit to 25 cm, Set scale and a scene's move from metres to centimetres
 *   each map the object's local space, and the record composes the maps.
 *   The export takes level 0 back through them before the file's own
 *   transform, and a vertex that came back within the floats' rounding of
 *   where the import put it is written as the file wrote it, so an
 *   unsculpted object still exports exactly. The gizmo moves the matrix,
 *   which the export leaves out: it is in the file's own space and units.
 *
 * What level 0 is, for the export: the level whose subdivision gives the
 * surface on the top level, as the top level is on screen or as stepping
 * up to it would make it. The engine's own way down (lowerAnalysis)
 * copies each vertex's place on the level above, which is where the
 * subdivision smoothed it to, so a level 0 reached that way has shrunk
 * from the file's even where nothing was sculpted. Instead the change the
 * sculpting made to the top level is carried down one level at a time, as
 * the change on the level below whose subdivision comes closest to it
 * (least squares over every vertex above), and added to the level 0 the
 * import built: an unsculpted object exports as the file was, a move of
 * level 0 itself (or any map that moves every vertex alike, such as a
 * scale) exactly, and a sculpted one as the cage of what is on screen.
 */

/** A file vertex no face uses; a corner with no texture coordinate. */
export const NO_INDEX = 0xffffffff;
/** Utils.TRI_INDEX: the fourth index of an engine face that is a triangle. */
const TRI_INDEX = 4294967295;

/** What the export says when the object's level 0 is no longer the file's. */
export const STALE_MESSAGE =
  "This object's topology has changed since it was imported, so its original numbering is gone. Use Export OBJ instead.";

/** The turn a Z-up file takes into the engine: (x, y, z) -> (x, z, -y), column-major. */
const Z_UP: readonly number[] = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
const IDENTITY: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The lines kept beside the vt lines (glb.ts keeps the same ones). */
const KEPT_LINE = /^(o|g|usemtl|s|mtllib)(\s|$)/;
const UV_LINE = /^vt(\s|$)/;

/** The record of an object imported from OBJ (SavedMesh.source, version 1). */
export interface ObjSource {
  v: 1;
  /** How many `v` lines the file had. */
  nbFileVertices: number;
  /** For each file vertex, the level-0 vertex it became, or NO_INDEX for one no face uses. */
  toEngine: Uint32Array;
  /** The file positions of the vertices no face uses, three each, in file order. */
  loose: Float32Array;
  /** Level 0 as the import built it, in its local space: three a level-0 vertex. */
  base: Float32Array;
  /** Corners a face, and the faces' file vertex ids (0-based), as the file wrote them. */
  faceSizes: Uint32Array;
  faceVerts: Uint32Array;
  /** Each corner's vt id (0-based) or NO_INDEX; null when the file gave none. */
  faceUVs: Uint32Array | null;
  /** How many vt lines; they are the first lines of `text`. */
  nbUVs: number;
  /** The vt lines, then the kept lines, joined by newlines, as UTF-8 in a u32 array. */
  textBytes: number;
  text: Uint32Array | null;
  /** For each kept line, how many faces come before it. */
  extraAt: Uint32Array | null;
  /** File space to level-0 local space, a column-major 4x4. */
  fileToLocal: number[];
  /**
   * The local space `base` is in to the object's local space now, a
   * column-major affine 4x4: what bakeScale folded in since (composeBake).
   * Absent for none (every record from before it).
   */
  bake?: number[];
}

/** Compose a map of the object's local space (v' = A v, bakeScale.ts) onto the record's `bake`. */
export function composeBake(src: ObjSource, a: ArrayLike<number>): void {
  const b = src.bake ?? [...IDENTITY];
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  src.bake = out;
}

/** The record's level 0 (`base`) in the object's local space now: through `bake`. */
export function bakedBase(src: ObjSource): Float32Array {
  const b = src.bake;
  if (!b) return src.base;
  const out = new Float32Array(src.base.length);
  for (let i = 0; i < out.length; i += 3) {
    const [x, y, z] = apply(b, src.base[i], src.base[i + 1], src.base[i + 2]);
    out[i] = x;
    out[i + 1] = y;
    out[i + 2] = z;
  }
  return out;
}

/**
 * Level 0 for the export (level0ForExport, in the object's local space
 * now) back in the space `base` is in, through the inverse of `bake`. A
 * coordinate that comes back within the floats' rounding of `base` (a few
 * parts in ten million of the object's size) is `base`'s exactly: the bake
 * rounded it on the way in, and an unmoved vertex exports as it was read.
 */
export function unbakeLevel0(src: ObjSource, level0: Float64Array): Float64Array {
  const b = src.bake;
  if (!b) return level0;
  const back = invertAffine(b) ?? [...IDENTITY];
  const base = src.base;
  let size = 0;
  for (let i = 0; i < base.length; i++) size = Math.max(size, Math.abs(base[i]));
  const eps = 4e-6 * size;
  const out = new Float64Array(level0.length);
  for (let i = 0; i < out.length; i += 3) {
    const p = apply(back, level0[i], level0[i + 1], level0[i + 2]);
    for (let k = 0; k < 3; k++) out[i + k] = Math.abs(p[k] - base[i + k]) <= eps ? base[i + k] : p[k];
  }
  return out;
}

/** What an import builds: level 0 for the engine, and the record. */
export interface ObjBuild {
  vertices: Float32Array;
  faces: Uint32Array;
  /** Null when the file is past what a record keeps (MAX_SOURCE_*): it imports without one. */
  source: ObjSource | null;
}

/** Welding tolerance, in file units: what three's mergeVertices used before. */
const WELD = 1e4;

const apply = (m: readonly number[], x: number, y: number, z: number): [number, number, number] => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/**
 * Level 0 and the record from a parsed file. Vertices that faces use are
 * welded by position, in file order, so level 0 numbers them as the file
 * does with the welded and the loose ones taken out. Faces keep their
 * corners: a triangle or a quad as it is, a larger polygon as quads and a
 * triangle fanned from its first corner, a face the weld folded as the
 * triangles that are left.
 */
export function buildFromObj(parsed: ParsedObjPolygons, zUp: boolean): ObjBuild {
  const m = zUp ? Z_UP : IDENTITY;
  const P = parsed.positions;
  const nbFile = P.length / 3;
  const used = new Uint8Array(nbFile);
  for (let i = 0; i < parsed.faceVerts.length; i++) used[parsed.faceVerts[i]] = 1;
  const toEngine = new Uint32Array(nbFile).fill(NO_INDEX);
  const byPlace = new Map<string, number>();
  const engine: number[] = [];
  const loose: number[] = [];
  for (let i = 0; i < nbFile; i++) {
    const x = P[i * 3];
    const y = P[i * 3 + 1];
    const z = P[i * 3 + 2];
    if (!used[i]) {
      // Not a number reaches nothing; it is kept as the origin.
      loose.push(Number.isFinite(x) ? x : 0, Number.isFinite(y) ? y : 0, Number.isFinite(z) ? z : 0);
      continue;
    }
    const [lx, ly, lz] = apply(m, x, y, z);
    const key = `${Math.round(lx * WELD)},${Math.round(ly * WELD)},${Math.round(lz * WELD)}`;
    let id = byPlace.get(key);
    if (id === undefined) {
      id = engine.length / 3;
      byPlace.set(key, id);
      engine.push(lx, ly, lz);
    }
    toEngine[i] = id;
  }

  const faces: number[] = [];
  const sizes = parsed.faceSizes;
  let at = 0;
  for (let f = 0; f < sizes.length; f++) {
    const n = sizes[f];
    const ring: number[] = [];
    for (let k = 0; k < n; k++) {
      const e = toEngine[parsed.faceVerts[at + k]];
      if (ring[ring.length - 1] !== e) ring.push(e);
    }
    at += n;
    while (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop();
    if (ring.length < 3) continue;
    if (new Set(ring).size === ring.length) {
      // Quads from the first corner while four are left, then a triangle.
      let k = 0;
      while (ring.length - 1 - k >= 3) {
        faces.push(ring[0], ring[k + 1], ring[k + 2], ring[k + 3]);
        k += 2;
      }
      if (ring.length - 1 - k === 2) faces.push(ring[0], ring[k + 1], ring[k + 2], TRI_INDEX);
    } else {
      // Welded onto itself: the fan's triangles that still have three corners.
      for (let k = 1; k + 1 < ring.length; k++) {
        const a = ring[0];
        const b = ring[k];
        const c = ring[k + 1];
        if (a !== b && b !== c && a !== c) faces.push(a, b, c, TRI_INDEX);
      }
    }
  }
  if (!faces.length) throw new Error('No geometry found in that OBJ file.');
  const vertices = new Float32Array(engine);
  return { vertices, faces: Uint32Array.from(faces), source: record(parsed, m, toEngine, loose, vertices) };
}

/** The record, or null when the file is past what one keeps. */
function record(
  parsed: ParsedObjPolygons,
  m: readonly number[],
  toEngine: Uint32Array,
  loose: number[],
  vertices: Float32Array,
): ObjSource | null {
  const nbFile = toEngine.length;
  if (nbFile > MAX_SOURCE_VERTICES || parsed.faceVerts.length > MAX_SOURCE_CORNERS) return null;
  if (parsed.uvLines.length > MAX_SOURCE_LINES) return null;
  // Too many naming lines to keep: the faces and the UVs matter more.
  const extras = parsed.extras.length > MAX_SOURCE_LINES ? [] : parsed.extras;
  const lines = [...parsed.uvLines, ...extras.map((e) => e.line)];
  const bytes = lines.length ? new TextEncoder().encode(lines.join('\n')) : new Uint8Array(0);
  if (bytes.length > MAX_SOURCE_TEXT_BYTES) return null;
  let text: Uint32Array | null = null;
  if (bytes.length) {
    text = new Uint32Array(Math.ceil(bytes.length / 4));
    new Uint8Array(text.buffer).set(bytes);
  }
  return {
    v: 1,
    nbFileVertices: nbFile,
    toEngine,
    loose: new Float32Array(loose),
    base: new Float32Array(vertices),
    faceSizes: parsed.faceSizes,
    faceVerts: parsed.faceVerts,
    faceUVs: parsed.faceUVs,
    nbUVs: parsed.uvLines.length,
    textBytes: bytes.length,
    text,
    extraAt: extras.length ? Uint32Array.from(extras.map((e) => e.at)) : null,
    fileToLocal: [...m],
  };
}

/** The record's text as its lines: the vt lines, then the kept lines. */
function lines(src: ObjSource): string[] {
  if (!src.text || !src.textBytes) return [];
  return new TextDecoder().decode(new Uint8Array(src.text.buffer, src.text.byteOffset, src.textBytes)).split('\n');
}

/**
 * A record as a scene brings it (sanitize.ts), held to what the export
 * reads: every index within its count, every size within the ceilings,
 * the text the lines it says, the transform one that can be undone.
 * `nbEngine` is the object's level-0 vertex count. Throws saying what is
 * wrong; returns the record's own fields and no others.
 */
export function sanitizeSource(v: unknown, nbEngine: number): ObjSource {
  const bad = (why: string): never => {
    throw new Error(why);
  };
  if (!v || typeof v !== 'object' || Array.isArray(v)) bad('it is not one');
  const r = v as Record<string, unknown>;
  if (r.v !== 1) bad('a version this app does not read');
  const nbFile = r.nbFileVertices;
  if (typeof nbFile !== 'number' || !Number.isSafeInteger(nbFile) || nbFile < 1 || nbFile > MAX_SOURCE_VERTICES) bad('its vertex count');
  const n = nbFile as number;
  const toEngine = r.toEngine;
  if (!(toEngine instanceof Uint32Array) || toEngine.length !== n) bad('its vertex map');
  let nbLoose = 0;
  for (const e of toEngine as Uint32Array) {
    if (e === NO_INDEX) nbLoose++;
    else if (e >= nbEngine) bad('a vertex past level 0');
  }
  const finite = (a: Float32Array): boolean => a.every(Number.isFinite);
  const loose = r.loose;
  if (!(loose instanceof Float32Array) || loose.length !== nbLoose * 3 || !finite(loose)) bad('its loose vertices');
  const base = r.base;
  if (!(base instanceof Float32Array) || base.length !== nbEngine * 3 || !finite(base)) bad('its level 0');
  const sizes = r.faceSizes;
  const corners = r.faceVerts;
  if (!(sizes instanceof Uint32Array) || sizes.length < 1) bad('its face sizes');
  if (!(corners instanceof Uint32Array) || corners.length > MAX_SOURCE_CORNERS) bad('its faces');
  let sum = 0;
  for (const s of sizes as Uint32Array) {
    if (s < 3) bad('a face of fewer than three corners');
    sum += s;
  }
  if (sum !== (corners as Uint32Array).length) bad('faces that do not add up');
  for (const c of corners as Uint32Array) if (c >= n) bad('a face past the file vertices');
  const nbUVs = r.nbUVs;
  if (typeof nbUVs !== 'number' || !Number.isSafeInteger(nbUVs) || nbUVs < 0 || nbUVs > MAX_SOURCE_LINES) bad('its texture coordinate count');
  const uvs = r.faceUVs;
  if (uvs !== null) {
    if (!(uvs instanceof Uint32Array) || uvs.length !== sum) bad('its texture corners');
    for (const t of uvs as Uint32Array) if (t !== NO_INDEX && t >= (nbUVs as number)) bad('a texture corner past the vt lines');
  }
  const textBytes = r.textBytes;
  if (typeof textBytes !== 'number' || !Number.isSafeInteger(textBytes) || textBytes < 0 || textBytes > MAX_SOURCE_TEXT_BYTES) bad('its text size');
  const text = r.text;
  if (textBytes === 0 ? text !== null : !(text instanceof Uint32Array) || text.length !== Math.ceil((textBytes as number) / 4)) bad('its text');
  const extraAt = r.extraAt;
  if (extraAt !== null) {
    if (!(extraAt instanceof Uint32Array) || extraAt.length > MAX_SOURCE_LINES) bad('its kept lines');
    let last = 0;
    for (const a of extraAt as Uint32Array) {
      if (a < last || a > (sizes as Uint32Array).length) bad('a kept line out of place');
      last = a;
    }
  }
  const m = r.fileToLocal;
  if (!Array.isArray(m) || m.length !== 16 || !m.every((x) => typeof x === 'number' && Number.isFinite(x))) bad('its transform');
  const mm = m as number[];
  if (mm[3] !== 0 || mm[7] !== 0 || mm[11] !== 0 || mm[15] !== 1 || !invertAffine(mm)) bad('a transform that cannot be undone');
  const bk = r.bake;
  if (bk !== undefined) {
    if (!Array.isArray(bk) || bk.length !== 16 || !bk.every((x) => typeof x === 'number' && Number.isFinite(x))) bad('its folded scale');
    const bb = bk as number[];
    if (bb[3] !== 0 || bb[7] !== 0 || bb[11] !== 0 || bb[15] !== 1 || !invertAffine(bb)) bad('a folded scale that cannot be undone');
  }
  const out: ObjSource = {
    v: 1,
    nbFileVertices: n,
    toEngine: toEngine as Uint32Array,
    loose: loose as Float32Array,
    base: base as Float32Array,
    faceSizes: sizes as Uint32Array,
    faceVerts: corners as Uint32Array,
    faceUVs: uvs as Uint32Array | null,
    nbUVs: nbUVs as number,
    textBytes: textBytes as number,
    text: text as Uint32Array | null,
    extraAt: extraAt as Uint32Array | null,
    fileToLocal: [...mm],
    ...(Array.isArray(bk) ? { bake: [...(bk as number[])] } : {}),
  };
  // The text is the lines it says: the vt lines, then one a kept line.
  const nbExtras = out.extraAt?.length ?? 0;
  let ls: string[];
  try {
    ls = textBytes ? new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(out.text!.buffer, out.text!.byteOffset, out.textBytes)).split('\n') : [];
  } catch {
    return bad('text that is not UTF-8');
  }
  if (ls.length !== out.nbUVs + nbExtras) bad('text that is not its lines');
  for (let i = 0; i < ls.length; i++) {
    if (i < out.nbUVs ? !UV_LINE.test(ls[i].trim()) : !KEPT_LINE.test(ls[i].trim())) bad('a line that is not what it says');
  }
  return out;
}

/** The inverse of an affine column-major 4x4, or null when it has none. */
function invertAffine(m: readonly number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-12) || !Number.isFinite(det)) return null;
  const k = 1 / det;
  // Rows of the inverse 3x3.
  const r = [
    [A * k, (c * h - b * i) * k, (b * f - c * e) * k],
    [B * k, (a * i - c * g) * k, (c * d - a * f) * k],
    [C * k, (b * g - a * h) * k, (a * e - b * d) * k],
  ];
  const t = [m[12], m[13], m[14]];
  const out = [...IDENTITY];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) out[col * 4 + row] = r[row][col];
    out[12 + row] = -(r[row][0] * t[0] + r[row][1] * t[1] + r[row][2] * t[2]);
  }
  return out;
}

/**
 * A coordinate as short as it can be written and still read back as the
 * same 32-bit float: the engine holds floats, so more digits would be
 * noise, and an unmoved vertex comes back as its file wrote it (to seven
 * significant digits).
 */
function num(x: number): string {
  if (!Number.isFinite(x)) return '0';
  const f = Math.fround(x);
  for (let p = 1; p < 10; p++) {
    const s = f.toPrecision(p);
    if (Math.fround(Number(s)) === f) return String(Number(s));
  }
  return String(f);
}

/**
 * The file again, from the record and level 0 in local space (`level0`,
 * three a level-0 vertex): a comment, the kept lines from before the
 * first face, every v line in the file's order (a loose vertex where the
 * file had it, a welded pair both at their vertex's place), the vt lines
 * as written, and the faces whole with the kept lines between them.
 */
export function writeOriginalObj(src: ObjSource, level0: Float64Array | Float32Array): string {
  const back = invertAffine(src.fileToLocal) ?? [...IDENTITY];
  const text = lines(src);
  const extraAt = src.extraAt ?? new Uint32Array(0);
  const out: string[] = ['# Bozzetto sculpt export, original numbering'];
  let x = 0;
  const kept = (before: number): void => {
    while (x < extraAt.length && extraAt[x] <= before) out.push(text[src.nbUVs + x++]);
  };
  kept(0);
  let li = 0;
  for (let i = 0; i < src.nbFileVertices; i++) {
    const e = src.toEngine[i];
    if (e === NO_INDEX) {
      out.push(`v ${num(src.loose[li * 3])} ${num(src.loose[li * 3 + 1])} ${num(src.loose[li * 3 + 2])}`);
      li++;
      continue;
    }
    const [fx, fy, fz] = apply(back, level0[e * 3], level0[e * 3 + 1], level0[e * 3 + 2]);
    out.push(`v ${num(fx)} ${num(fy)} ${num(fz)}`);
  }
  for (let i = 0; i < src.nbUVs; i++) out.push(text[i]);
  let at = 0;
  for (let f = 0; f < src.faceSizes.length; f++) {
    kept(f);
    const n = src.faceSizes[f];
    const corners: string[] = [];
    for (let k = 0; k < n; k++) {
      const t = src.faceUVs ? src.faceUVs[at + k] : NO_INDEX;
      const v = src.faceVerts[at + k] + 1;
      corners.push(t === NO_INDEX ? `${v}` : `${v}/${t + 1}`);
    }
    at += n;
    out.push(`f ${corners.join(' ')}`);
  }
  kept(Infinity);
  out.push('');
  return out.join('\n');
}

// --- level 0 for the export ------------------------------------------------------------

/** Run a vendor call on a level with other positions in place of its own, then put its own back. */
function withPositions<T>(level: SculptMesh, positions: Float32Array | Float64Array, run: () => T): T {
  const data = level.getMeshData();
  const own = data._verticesXYZ;
  data._verticesXYZ = positions;
  try {
    return run();
  } finally {
    data._verticesXYZ = own;
  }
}

/**
 * The top level's positions as they are on screen, or, with a lower level
 * selected, as stepping up to the top would make them: each level above
 * the selected one synthesised from the one below with its detail
 * vectors, as higherLevel does, and every array it wrote put back after,
 * so nothing on screen or in the stack has changed.
 */
function topSurface(levels: SculptMesh[], sel: number): Float32Array {
  const top = levels.length - 1;
  const read = (): Float32Array => levels[top].getVertices().slice(0, levels[top].getNbVertices() * 3);
  if (sel >= top) return read();
  const kept: [SculptMesh, Float32Array, Float32Array, Float32Array][] = [];
  try {
    for (let k = sel + 1; k <= top; k++) {
      const m = levels[k];
      const n = m.getNbVertices() * 3;
      kept.push([m, m.getVertices().slice(0, n), m.getColors().slice(0, n), m.getMaterials().slice(0, n)]);
      if (m._detailsXYZ && m._detailsRGB && m._detailsPBR && m.higherSynthesis) m.higherSynthesis(levels[k - 1]);
      else Subdivision.partialSubdivision(levels[k - 1], m.getVertices(), m.getColors(), m.getMaterials());
    }
    return read();
  } finally {
    for (const [m, v, c, mat] of kept) {
      m.getVertices().set(v);
      m.getColors().set(c);
      m.getMaterials().set(mat);
    }
  }
}

const dot = (a: Float64Array, b: Float64Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** A level's subdivision as a sparse matrix: a row for each vertex of the level above, its weights on this level's vertices. */
interface Rule {
  start: Uint32Array;
  cols: Uint32Array;
  vals: Float64Array;
}

/** The vendor arrays a level's rings are read from (Mesh.js). */
interface Rings {
  getFaces(): Uint32Array | Int32Array;
  getVerticesRingFaceStartCount(): Uint32Array;
  getVerticesRingFace(): Uint32Array;
}

/**
 * One level's subdivision (Subdivision.partialSubdivision: where every
 * vertex of the level above goes), as a matrix read off the vendor's own
 * code rather than written again. The subdivision is linear and local:
 * each vertex above is a weighted sum of the corners of the faces around
 * one vertex here. So it is run on a field that is 1 on a set of vertices
 * no two of which share a star (a vertex and the corners of its faces),
 * and 0 elsewhere, and each vertex above gets its weight on the one
 * vertex of the set it sees; a second coordinate carrying each vertex's
 * own number says which that was. The sets are a colouring at two faces'
 * distance: a few dozen runs.
 */
function subdivisionRule(level: SculptMesh, nbUp: number): Rule {
  const n = level.getNbVertices();
  const rings = level as unknown as Rings;
  const faces = rings.getFaces();
  const vrf = rings.getVerticesRingFaceStartCount();
  const ringFaces = rings.getVerticesRingFace();
  // Each vertex's star: itself and the corners of the faces around it.
  const start = new Uint32Array(n + 1);
  const star: number[] = [];
  const seen = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    start[i] = star.length;
    seen[i] = i;
    star.push(i);
    for (let k = vrf[i * 2], end = k + vrf[i * 2 + 1]; k < end; k++) {
      const f = ringFaces[k] * 4;
      for (let c = 0; c < 4; c++) {
        const v = faces[f + c];
        if (v === TRI_INDEX || v >= n || seen[v] === i) continue;
        seen[v] = i;
        star.push(v);
      }
    }
  }
  start[n] = star.length;
  // Colours: no two vertices of one colour in any star.
  const color = new Int32Array(n).fill(-1);
  const stamp: number[] = [];
  let nbColors = 0;
  for (let j = 0; j < n; j++) {
    for (let a = start[j]; a < start[j + 1]; a++) {
      const centre = star[a];
      for (let b = start[centre]; b < start[centre + 1]; b++) {
        const c = color[star[b]];
        if (c >= 0) stamp[c] = j + 1;
      }
    }
    let c = 0;
    while (stamp[c] === j + 1) c++;
    color[j] = c;
    if (c >= nbColors) nbColors = c + 1;
  }
  const probe = new Float64Array(n * 3);
  const out = new Float64Array(nbUp * 3);
  const colors = new Float32Array(nbUp * 3);
  const materials = new Float32Array(nbUp * 3);
  // Typed and grown by doubling: a level of a million vertices has some
  // ten million weights, which plain arrays would hold at several times
  // the bytes.
  let size = 0;
  let rows = new Uint32Array(nbUp * 8 || 8);
  let cols = new Uint32Array(rows.length);
  let vals = new Float64Array(rows.length);
  const push = (r: number, j: number, w: number): void => {
    if (size === rows.length) {
      const grow = <T extends Uint32Array | Float64Array>(a: T): T => {
        const b = new (a.constructor as { new (n: number): T })(a.length * 2);
        b.set(a);
        return b;
      };
      rows = grow(rows);
      cols = grow(cols);
      vals = grow(vals);
    }
    rows[size] = r;
    cols[size] = j;
    vals[size] = w;
    size++;
  };
  for (let c = 0; c < nbColors; c++) {
    probe.fill(0);
    for (let j = 0; j < n; j++) {
      if (color[j] !== c) continue;
      probe[j * 3] = 1;
      probe[j * 3 + 1] = j + 1;
    }
    withPositions(level, probe, () => Subdivision.partialSubdivision(level, out, colors, materials));
    for (let r = 0; r < nbUp; r++) {
      const w = out[r * 3];
      if (w === 0) continue;
      const j = Math.round(out[r * 3 + 1] / w) - 1;
      if (j < 0 || j >= n || color[j] !== c) continue;
      push(r, j, w);
    }
  }
  // Rows in order (a counting sort).
  const rowStart = new Uint32Array(nbUp + 1);
  for (let e = 0; e < size; e++) rowStart[rows[e] + 1]++;
  for (let r = 0; r < nbUp; r++) rowStart[r + 1] += rowStart[r];
  const fill = rowStart.slice(0, nbUp);
  const colArr = new Uint32Array(size);
  const valArr = new Float64Array(size);
  for (let e = 0; e < size; e++) {
    const at = fill[rows[e]]++;
    colArr[at] = cols[e];
    valArr[at] = vals[e];
  }
  return { start: rowStart, cols: colArr, vals: valArr };
}

/** out = S x, three numbers a vertex (x on this level, out on the level above). */
function mul(m: Rule, x: Float64Array, out: Float64Array): void {
  const rows = m.start.length - 1;
  for (let i = 0; i < rows; i++) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (let a = m.start[i]; a < m.start[i + 1]; a++) {
      const j = m.cols[a] * 3;
      const w = m.vals[a];
      sx += w * x[j];
      sy += w * x[j + 1];
      sz += w * x[j + 2];
    }
    out[i * 3] = sx;
    out[i * 3 + 1] = sy;
    out[i * 3 + 2] = sz;
  }
}

/** out = S^T y. */
function mulT(m: Rule, y: Float64Array, out: Float64Array): void {
  out.fill(0);
  const rows = m.start.length - 1;
  for (let i = 0; i < rows; i++) {
    const yx = y[i * 3];
    const yy = y[i * 3 + 1];
    const yz = y[i * 3 + 2];
    for (let a = m.start[i]; a < m.start[i + 1]; a++) {
      const j = m.cols[a] * 3;
      const w = m.vals[a];
      out[j] += w * yx;
      out[j + 1] += w * yy;
      out[j + 2] += w * yz;
    }
  }
}

/**
 * How strongly the answer is held to where it starts, against the
 * subdivision's own weight: a safeguard only. A level's subdivision
 * determines it (the level above has about four times its vertices), so
 * nothing should be left for the floats' rounding to decide.
 */
const HOLD = 1e-9;

/**
 * The change on this level whose subdivision comes closest to the change
 * `y` on the level above, every vertex up there counted (least squares,
 * by conjugate gradients on the normal equations). A change that is the
 * subdivision of one here, as a move of level 0 is, comes back exactly; a
 * sculpted one comes back as the cage that subdivides closest to it. `x`
 * is the start, and is overwritten: the change on this level's own
 * vertices as they sit above.
 */
function solve(m: Rule, y: Float64Array, x: Float64Array): Float64Array {
  const n = x.length;
  const rhs = new Float64Array(n);
  mulT(m, y, rhs);
  for (let i = 0; i < n; i++) rhs[i] += HOLD * x[i];
  const up = new Float64Array(y.length);
  const apply = (v: Float64Array, out: Float64Array): void => {
    mul(m, v, up);
    mulT(m, up, out);
    for (let i = 0; i < n; i++) out[i] += HOLD * v[i];
  };
  const r = new Float64Array(n);
  const p = new Float64Array(n);
  const q = new Float64Array(n);
  apply(x, q);
  for (let i = 0; i < n; i++) r[i] = rhs[i] - q[i];
  p.set(r);
  let rr = dot(r, r);
  const tol = 1e-26 * (dot(rhs, rhs) || 1);
  for (let it = 0; it < 1000 && rr > tol; it++) {
    apply(p, q);
    const pq = dot(p, q);
    if (!(pq > 0)) break;
    const alpha = rr / pq;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i];
      r[i] -= alpha * q[i];
    }
    const next = dot(r, r);
    const beta = next / rr;
    rr = next;
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i];
  }
  return x;
}

/**
 * Level 0 for the export, in local space, three a level-0 vertex. With
 * one level it is that level. Otherwise: the top level as it stands
 * (topSurface), less what the import's level 0 alone subdivides to by the
 * same arithmetic, is what the sculpting changed; a change smaller than
 * the floats' own rounding is no change. That is carried down one level
 * at a time (solve: the change below that subdivides closest to it), and
 * added to the import's level 0. Reads the stack and changes nothing.
 */
export function level0ForExport(levels: SculptMesh[], sel: number, base: Float32Array): Float64Array {
  const top = levels.length - 1;
  const nb0 = levels[0].getNbVertices() * 3;
  if (top === 0) return Float64Array.from(levels[0].getVertices().subarray(0, nb0));
  const current = topSurface(levels, sel);
  let pure: Float32Array = base;
  for (let k = 0; k < top; k++) {
    const n = levels[k + 1].getNbVertices() * 3;
    const out = new Float32Array(n);
    const below = pure;
    withPositions(levels[k], below, () => Subdivision.partialSubdivision(levels[k], out, new Float32Array(n), new Float32Array(n)));
    pure = out;
  }
  let scale = 0;
  for (let i = 0; i < current.length; i++) scale = Math.max(scale, Math.abs(current[i]));
  const eps = 4e-6 * scale;
  let change: Float64Array = new Float64Array(current.length);
  let any = false;
  for (let i = 0; i < current.length; i++) {
    const d = current[i] - pure[i];
    if (Math.abs(d) > eps) {
      change[i] = d;
      any = true;
    }
  }
  const out = Float64Array.from(base);
  if (!any) return out;
  for (let k = top - 1; k >= 0; k--) {
    const n = levels[k].getNbVertices() * 3;
    change = solve(subdivisionRule(levels[k], change.length / 3), change, change.slice(0, n));
  }
  for (let i = 0; i < nb0; i++) out[i] += change[i];
  return out;
}
