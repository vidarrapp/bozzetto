import type { SavedScene } from './ScenePersist';
import { validSavedScene } from './ScenePersist';
import type { SculptSession } from './SculptSession';
import { sanitizeScene } from './sanitize';
import { inflateEach } from '../../viewer/inflate';
import type { BufferEntry, Layout } from '../../../shared/bozz';
import { MAGIC, MAX_DEPTH, MAX_NAME, SceneFileError, damaged, notAScene, pad4, readLayout } from '../../../shared/bozz';

/**
 * Scene files for guests (WS5): the same v3 SavedScene the autosave keeps,
 * packed into one binary container so work leaves the device. Layout before
 * compression, all little-endian:
 *
 *   u32 magic 'BOZ1' | u32 headerLen | header JSON | pad4 | blob region
 *
 * The header is the SavedScene with every typed array swapped for
 * {"__buf": n} against a buffers table of {t: 'f32'|'u32', off, len}. The
 * whole container is gzipped when CompressionStream exists; the reader
 * sniffs the gzip magic, so uncompressed files stay valid. The walk is
 * shape-agnostic on both sides - new SavedScene fields ride along without
 * touching this module.
 */

/**
 * The most a scene file may unpack to (shared/bozz.ts says why 1 GiB). The
 * container's constants, its errors and readLayout() live there, where the
 * server reads an upload's header with the same code (docs/accounts.md §4).
 */
export { MAX_SCENE_BYTES } from '../../../shared/bozz';

/** An object or a material with its name, if it has one, no longer than a reader takes. */
function capName<T extends { name?: unknown }>(o: T): T {
  return typeof o.name === 'string' && o.name.length > MAX_NAME ? { ...o, name: o.name.slice(0, MAX_NAME) } : o;
}

export async function packScene(scene: SavedScene): Promise<Blob> {
  const blobs: Uint8Array[] = [];
  const table: BufferEntry[] = [];
  let cursor = 0;
  const claim = (t: 'f32' | 'u32', a: Float32Array | Uint32Array): { __buf: number } => {
    blobs.push(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    table.push({ t, off: cursor, len: a.length });
    cursor += pad4(a.byteLength);
    return { __buf: table.length - 1 };
  };
  const strip = (v: unknown): unknown => {
    if (v instanceof Float32Array) return claim('f32', v);
    if (v instanceof Uint32Array) return claim('u32', v);
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = strip(val);
      return out;
    }
    return v;
  };

  // The project link is the autosave's business (see SavedScene.project):
  // a file leaves the device, and must not carry a pointer to the owner's
  // server project with it, nor to a copy on this device's shelf.
  const { project: _link, unsent: _unsent, synced: _synced, ...portable } = scene;
  // A name past what a reader takes (shared/bozz.ts MAX_NAME: this app's
  // own reader and the server's both refuse it) would make a file nothing
  // opens, nor any server keeps: cut to it here, where every file is made.
  const named = {
    ...portable,
    meshes: portable.meshes.map(capName),
    ...(portable.materials ? { materials: portable.materials.map(capName) } : {}),
  };
  const header = new TextEncoder().encode(JSON.stringify({ scene: strip(named), buffers: table }));
  const headPad = pad4(header.length);
  const raw = new Uint8Array(8 + headPad + cursor);
  const dv = new DataView(raw.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, header.length, true);
  raw.set(header, 8);
  for (let i = 0; i < blobs.length; i++) raw.set(blobs[i], 8 + headPad + table[i].off);

  if (typeof CompressionStream === 'undefined') return new Blob([raw]);
  const gz = new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(gz).blob();
}

/**
 * Inflate a gzipped container a chunk at a time: the header first, which
 * says how big the whole is, and then exactly that much into one buffer,
 * set aside once. A stream that runs on past what its header said, or
 * claims more than a scene can be, is stopped where it is.
 */
async function inflateScene(bytes: ArrayBuffer): Promise<{ raw: Uint8Array; layout: Layout }> {
  if (typeof DecompressionStream === 'undefined') {
    throw new SceneFileError('This browser cannot read compressed scene files');
  }
  // Chunks are kept as they come until there are as many bytes as the
  // header needs, and only then joined: a joined copy per chunk would cost
  // the square of a long header.
  const s = {
    parts: [] as Uint8Array[],
    have: 0,
    need: 8,
    layout: null as Layout | null,
    out: null as Uint8Array | null,
    got: 0,
  };
  try {
    await inflateEach(bytes, (chunk) => {
      if (s.out) {
        if (s.got + chunk.length > s.out.length) throw notAScene();
        s.out.set(chunk, s.got);
        s.got += chunk.length;
        return;
      }
      s.parts.push(chunk);
      s.have += chunk.length;
      if (s.have < s.need) return;
      const head = new Uint8Array(s.have);
      let at = 0;
      for (const p of s.parts) {
        head.set(p, at);
        at += p.length;
      }
      s.parts = [head];
      const read = readLayout(head);
      if (typeof read === 'number') {
        s.need = read;
        return;
      }
      if (head.length > read.size) throw notAScene();
      s.layout = read;
      s.out = new Uint8Array(read.size);
      s.out.set(head);
      s.got = head.length;
      s.parts = [];
    });
  } catch (err) {
    if (err instanceof SceneFileError) throw err;
    throw damaged('it does not decompress'); // the stream's own failure: bad or cut-off gzip
  }
  if (!s.layout || !s.out || s.got < s.out.length) throw damaged('it ends early');
  return { raw: s.out, layout: s.layout };
}

/**
 * The header's scene with its arrays put back. Each array is copied out of
 * the file once - the scene owns its arrays - and a reference to one that
 * was copied already is refused: the old reader copied an array again for
 * every reference to it.
 */
function revive(layout: Layout, raw: Uint8Array): unknown {
  const used = new Set<number>();
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH) throw damaged('it nests too deeply');
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    if (!v || typeof v !== 'object') return v;
    const ref = (v as { __buf?: unknown }).__buf;
    if (ref !== undefined) {
      if (typeof ref !== 'number' || !Number.isInteger(ref)) throw damaged('a bad array reference');
      const e = layout.buffers[ref];
      if (!e) throw damaged('a missing array');
      if (used.has(ref)) throw damaged('an array used twice');
      used.add(ref);
      // In range: readLayout put every entry inside `size`, and the file is that long.
      const start = layout.blobBase + e.off;
      const copy = raw.slice(start, start + e.len * 4);
      return e.t === 'f32' ? new Float32Array(copy.buffer) : new Uint32Array(copy.buffer);
    }
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      // JSON.parse makes "__proto__" an own key; assigned, it would set the
      // copy's prototype instead. No scene field is called that.
      if (k === '__proto__') continue;
      out[k] = walk(val, depth + 1);
    }
    return out;
  };
  return walk(layout.scene, 0);
}

/** Parse a scene file; throws with a human-readable reason on bad input. */
export async function unpackScene(bytes: ArrayBuffer): Promise<SavedScene> {
  const sniff = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  let raw: Uint8Array;
  let layout: Layout;
  if (sniff.length === 2 && sniff[0] === 0x1f && sniff[1] === 0x8b) {
    ({ raw, layout } = await inflateScene(bytes));
  } else {
    raw = new Uint8Array(bytes);
    const read = readLayout(raw);
    if (typeof read === 'number') throw notAScene(); // shorter than its own header
    if (raw.length > read.size) throw notAScene();
    if (raw.length < read.size) throw damaged('it ends early');
    layout = read;
  }
  const scene = revive(layout, raw);
  if (!validSavedScene(scene)) throw damaged('its objects do not add up');
  // Every field checked before anything is swapped in (sanitize.ts).
  const clean = sanitizeScene(scene);
  // Nor is a link taken from one: which project a scene belongs to is
  // decided by how it was opened, never by what a file claims.
  delete clean.project;
  delete clean.unsent;
  delete clean.synced;
  return clean;
}

/**
 * The scene as Wavefront OBJ: every object with its matrix baked in,
 * triangulated, 1-based indices with a running offset. No normals - every
 * consumer recomputes them (and Bozzetto's own importer would too).
 */
export function sceneToOBJ(session: SculptSession): string {
  const out: string[] = ['# Bozzetto sculpt export'];
  let offset = 0;
  for (const mesh of session.getMeshes()) {
    const name = session.getMeshName(mesh).replace(/\s+/g, '_');
    out.push(`o ${name}`);
    const m = mesh.getMatrix();
    // A mirrored object (Scene > Mirror) carries its reflection in the
    // matrix; baked, that turns the triangles inside out unless their
    // winding is reversed with it.
    const flip = mirrors(m);
    const v = mesh.getVertices();
    const nb = mesh.getNbVertices();
    for (let i = 0; i < nb; i++) {
      const x = v[i * 3];
      const y = v[i * 3 + 1];
      const z = v[i * 3 + 2];
      const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
      out.push(`v ${fmt(wx)} ${fmt(wy)} ${fmt(wz)}`);
    }
    const tris = mesh.getTriangles();
    const nbTris = mesh.getNbTriangles();
    for (let i = 0; i < nbTris; i++) {
      const a = tris[i * 3] + 1 + offset;
      const b = tris[i * 3 + 1] + 1 + offset;
      const c = tris[i * 3 + 2] + 1 + offset;
      out.push(flip ? `f ${a} ${c} ${b}` : `f ${a} ${b} ${c}`);
    }
    offset += nb;
  }
  out.push('');
  return out.join('\n');
}

/** True when a mesh matrix reflects (a negative determinant): Scene > Mirror. */
export function mirrors(m: Float32Array | number[]): boolean {
  const det =
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2]);
  return det < 0;
}

/** Six significant digits: plenty at normalized sculpt scale, half the bytes. */
function fmt(n: number): string {
  return Number.isFinite(n) ? Number(n.toPrecision(6)).toString() : '0';
}

/**
 * The visible scene as one mesh: every object at its CURRENT resolution,
 * matrix baked, concatenated with offset indices. This is the frame payload
 * for capture and gallery saves (one GLB per frame, like every other
 * Bozzetto timelapse). Bounded copies only - no allocation is proportional
 * to anything but the live geometry.
 */
export function mergeSceneArrays(
  session: SculptSession,
  withColors = false,
): {
  positions: Float32Array;
  indices: Uint32Array;
  tris: number;
  colors?: Float32Array;
} | null {
  // The eye means "not part of the picture": a hidden reference blockout
  // was being merged into every timelapse frame and every published model
  // (review finding). The eye, not the flag: solo hides the other objects
  // only from the view, and a frame recorded under it is still the scene.
  const meshes = session.getMeshes().filter((m) => session.eyeVisible(m));
  if (meshes.length === 0) return null;
  let nbV = 0;
  let nbT = 0;
  for (const mesh of meshes) {
    nbV += mesh.getNbVertices();
    nbT += mesh.getNbTriangles();
  }
  if (nbV === 0 || nbT === 0) return null;
  const positions = new Float32Array(nbV * 3);
  const indices = new Uint32Array(nbT * 3);
  // Colours need no transform - they ride along per vertex as they are.
  const colors = withColors ? new Float32Array(nbV * 3) : undefined;
  let vOff = 0;
  let iOff = 0;
  for (const mesh of meshes) {
    const m = mesh.getMatrix();
    const v = mesh.getVertices();
    const nb = mesh.getNbVertices();
    for (let i = 0; i < nb; i++) {
      const x = v[i * 3];
      const y = v[i * 3 + 1];
      const z = v[i * 3 + 2];
      positions[(vOff + i) * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      positions[(vOff + i) * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      positions[(vOff + i) * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    if (colors) colors.set(mesh.getColors().subarray(0, nb * 3), vOff * 3);
    const tris = mesh.getTriangles();
    const nbTris = mesh.getNbTriangles();
    if (mirrors(m)) {
      // The reflection in the matrix would turn the baked triangles inside
      // out; reversing the winding keeps them facing the way they render.
      for (let i = 0; i < nbTris; i++) {
        indices[iOff + i * 3] = tris[i * 3] + vOff;
        indices[iOff + i * 3 + 1] = tris[i * 3 + 2] + vOff;
        indices[iOff + i * 3 + 2] = tris[i * 3 + 1] + vOff;
      }
    } else {
      for (let i = 0; i < nbTris * 3; i++) indices[iOff + i] = tris[i] + vOff;
    }
    vOff += nb;
    iOff += nbTris * 3;
  }
  return { positions, indices, tris: nbT, colors };
}

export { downloadBlob } from '../../ui/download';

/** sculpt-20260830-1415.bozz style stamp. */
export function stampName(ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `sculpt-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}
