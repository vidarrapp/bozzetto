import type { SavedScene } from './ScenePersist';
import { validSavedScene } from './ScenePersist';
import type { SculptSession } from './SculptSession';

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

const MAGIC = 0x315a4f42; // "BOZ1"

interface BufferEntry {
  t: 'f32' | 'u32';
  off: number;
  len: number;
}

export async function packScene(scene: SavedScene): Promise<Blob> {
  const blobs: Uint8Array[] = [];
  const table: BufferEntry[] = [];
  let cursor = 0;
  const claim = (t: 'f32' | 'u32', a: Float32Array | Uint32Array): { __buf: number } => {
    blobs.push(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    table.push({ t, off: cursor, len: a.length });
    cursor += (a.byteLength + 3) & ~3;
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

  const header = new TextEncoder().encode(JSON.stringify({ scene: strip(scene), buffers: table }));
  const headPad = (header.length + 3) & ~3;
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

/** Parse a scene file; throws with a human-readable reason on bad input. */
export async function unpackScene(bytes: ArrayBuffer): Promise<SavedScene> {
  let raw = new Uint8Array(bytes);
  if (raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot read compressed scene files');
    }
    const plain = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    raw = new Uint8Array(await new Response(plain).arrayBuffer());
  }
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw.length < 8 || dv.getUint32(0, true) !== MAGIC) {
    throw new Error('Not a Bozzetto scene file');
  }
  const headerLen = dv.getUint32(4, true);
  const headPad = (headerLen + 3) & ~3;
  const parsed = JSON.parse(new TextDecoder().decode(raw.subarray(8, 8 + headerLen))) as {
    scene: unknown;
    buffers: BufferEntry[];
  };
  const blobBase = raw.byteOffset + 8 + headPad;
  const revive = (v: unknown): unknown => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const ref = (v as { __buf?: number }).__buf;
      if (typeof ref === 'number') {
        const e = parsed.buffers[ref];
        if (!e) throw new Error('Corrupt scene file (missing buffer)');
        // Copy out of the file buffer so the scene owns its arrays.
        return e.t === 'f32'
          ? new Float32Array(raw.buffer.slice(blobBase + e.off, blobBase + e.off + e.len * 4))
          : new Uint32Array(raw.buffer.slice(blobBase + e.off, blobBase + e.off + e.len * 4));
      }
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) out[k] = revive(val);
      return out;
    }
    if (Array.isArray(v)) return v.map(revive);
    return v;
  };
  const scene = revive(parsed.scene);
  if (!validSavedScene(scene)) throw new Error('Scene file failed validation');
  return scene;
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
      out.push(`f ${a} ${b} ${c}`);
    }
    offset += nb;
  }
  out.push('');
  return out.join('\n');
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
): { positions: Float32Array; indices: Uint32Array; tris: number } | null {
  const meshes = session.getMeshes();
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
    const tris = mesh.getTriangles();
    const nbTris = mesh.getNbTriangles();
    for (let i = 0; i < nbTris * 3; i++) indices[iOff + i] = tris[i] + vOff;
    vOff += nb;
    iOff += nbTris * 3;
  }
  return { positions, indices, tris: nbT };
}

/** Trigger a browser download for generated bytes. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the click a beat before the URL dies (Safari needs it).
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** sculpt-20260830-1415.bozz style stamp. */
export function stampName(ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `sculpt-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}
