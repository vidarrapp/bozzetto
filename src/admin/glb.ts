/**
 * Pure OBJ → glTF-binary conversion, ported from scripts/obj-to-timelapse.mjs
 * so frames made in the editor are byte-identical to CLI-made ones. No DOM,
 * Worker, or Node APIs here — it runs in a worker and is unit-testable.
 *
 * Indices are always emitted as UINT (Uint32), matching the CLI writer, which
 * keeps every chunk 4-byte aligned.
 */

export interface ParsedMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export function parseObj(text: string, zUp = false): ParsedMesh {
  const verts: number[] = [];
  const indices: number[] = [];

  for (const line of text.split('\n')) {
    if (line[0] === 'v' && line[1] === ' ') {
      const p = line.split(/\s+/);
      let x = parseFloat(p[1]);
      let y = parseFloat(p[2]);
      let z = parseFloat(p[3]);
      if (zUp) {
        // Z-up (DCC) -> Y-up (glTF): (x, y, z) -> (x, z, -y).
        const ny = z;
        const nz = -y;
        y = ny;
        z = nz;
      }
      verts.push(x, y, z);
    } else if (line[0] === 'f' && line[1] === ' ') {
      const tokens = line.trim().split(/\s+/).slice(1);
      const vertexCount = verts.length / 3;
      const face = tokens.map((tok) => {
        let n = parseInt(tok.split('/')[0], 10);
        if (n < 0) n = vertexCount + n; // relative index
        else n -= 1; // OBJ is 1-based
        return n;
      });
      // Triangulate an n-gon as a fan.
      for (let i = 1; i < face.length - 1; i++) {
        indices.push(face[0], face[i], face[i + 1]);
      }
    }
  }

  return { positions: new Float32Array(verts), indices: Uint32Array.from(indices) };
}

/** Smooth per-vertex normals from positions + indices (respects OBJ winding). */
export function computeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const e1x = positions[b] - positions[a];
    const e1y = positions[b + 1] - positions[a + 1];
    const e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a];
    const e2y = positions[c + 1] - positions[a + 1];
    const e2z = positions[c + 2] - positions[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const idx of [a, b, c]) {
      n[idx] += nx;
      n[idx + 1] += ny;
      n[idx + 2] += nz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

export function meshToGLB(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
): ArrayBuffer {
  const idxLen = indices.byteLength;
  const posLen = positions.byteLength;
  const nrmLen = normals.byteLength;
  const binLen = idxLen + posLen + nrmLen; // already a multiple of 4

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }

  const vertCount = positions.length / 3;
  const gltf = {
    asset: { version: '2.0', generator: 'bozzetto obj-to-timelapse' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1, NORMAL: 2 }, indices: 0, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5125, count: indices.length, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: vertCount, type: 'VEC3', min, max },
      { bufferView: 2, componentType: 5126, count: vertCount, type: 'VEC3' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: idxLen, target: 34963 },
      { buffer: 0, byteOffset: idxLen, byteLength: posLen, target: 34962 },
      { buffer: 0, byteOffset: idxLen + posLen, byteLength: nrmLen, target: 34962 },
    ],
    buffers: [{ byteLength: binLen }],
  };

  const json = padBytes(new TextEncoder().encode(JSON.stringify(gltf)), 0x20);
  const binPadded = (binLen + 3) & ~3;
  const total = 12 + 8 + json.length + 8 + binPadded;

  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true); // version
  dv.setUint32(8, total, true);
  dv.setUint32(12, json.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  u8.set(json, 20);

  let o = 20 + json.length;
  dv.setUint32(o, binPadded, true);
  dv.setUint32(o + 4, 0x004e4942, true); // "BIN\0"
  o += 8;
  u8.set(new Uint8Array(indices.buffer, indices.byteOffset, idxLen), o);
  u8.set(new Uint8Array(positions.buffer, positions.byteOffset, posLen), o + idxLen);
  u8.set(new Uint8Array(normals.buffer, normals.byteOffset, nrmLen), o + idxLen + posLen);
  // Any trailing bin-pad bytes stay 0x00, matching the CLI writer.
  return out;
}

function padBytes(bytes: Uint8Array, fill: number): Uint8Array {
  const rem = bytes.length % 4;
  if (rem === 0) return bytes;
  const out = new Uint8Array(bytes.length + (4 - rem));
  out.set(bytes);
  out.fill(fill, bytes.length);
  return out;
}

export function objToGLB(text: string, zUp = false): { glb: ArrayBuffer; tris: number } {
  const { positions, indices } = parseObj(text, zUp);
  if (positions.length === 0 || indices.length === 0) {
    throw new Error('No geometry parsed from OBJ');
  }
  const normals = computeNormals(positions, indices);
  return { glb: meshToGLB(positions, normals, indices), tris: indices.length / 3 };
}

/** Best-effort triangle count for a pre-made .glb (informational). */
export function glbTris(glb: ArrayBuffer): number {
  try {
    const dv = new DataView(glb);
    if (dv.getUint32(0, true) !== 0x46546c67) return 0;
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen))) as {
      accessors?: { count: number }[];
      meshes?: { primitives?: { indices?: number; attributes?: { POSITION?: number } }[] }[];
    };
    const accessors = json.accessors ?? [];
    let tris = 0;
    for (const mesh of json.meshes ?? []) {
      for (const prim of mesh.primitives ?? []) {
        const acc =
          prim.indices != null ? accessors[prim.indices] : accessors[prim.attributes?.POSITION ?? -1];
        if (acc) tris += acc.count / 3;
      }
    }
    return Math.floor(tris);
  } catch {
    return 0;
  }
}
