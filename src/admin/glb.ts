/**
 * Pure OBJ → glTF-binary conversion, mirrored by scripts/obj-to-timelapse.mjs
 * so frames made in the editor are equivalent to CLI-made ones. No DOM,
 * Worker, or Node APIs here — it runs in a worker and is unit-testable.
 *
 * Frames are written compact (design doc §5): positions quantized to int16
 * (KHR_mesh_quantization) with the dequantization transform on the glTF node,
 * uint16 indices when the mesh is small enough, and no normals — the viewer
 * recomputes identical smooth normals on load. The caller then gzips the
 * whole GLB (the viewer inflates by magic sniff), which the quantized data
 * compresses far better than raw floats did.
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

/**
 * Quantize float positions to symmetric int16 around the mesh centre. The
 * dequantization (q / 32767 * half + center, per axis) goes on the glTF node
 * as scale + translation; the viewer bakes it back into float positions on
 * load. Error is halfExtent / 32767 per axis — microns at bust scale.
 */
function quantizePositions(positions: Float32Array): {
  quantized: Int16Array;
  center: number[];
  half: number[];
  qMin: number[];
  qMax: number[];
} {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  // A flat axis quantizes to 0 everywhere; scale 1 keeps the node well-formed.
  const half = [0, 1, 2].map((k) => (max[k] - min[k]) / 2 || 1);

  const quantized = new Int16Array(positions.length);
  const qMin = [32767, 32767, 32767];
  const qMax = [-32767, -32767, -32767];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const q = Math.round(((positions[i + k] - center[k]) / half[k]) * 32767);
      const c = Math.max(-32767, Math.min(32767, q));
      quantized[i + k] = c;
      if (c < qMin[k]) qMin[k] = c;
      if (c > qMax[k]) qMax[k] = c;
    }
  }
  return { quantized, center, half, qMin, qMax };
}

export function meshToGLB(
  positions: Float32Array,
  indices: Uint32Array,
  colors?: Float32Array,
): ArrayBuffer {
  const vertCount = positions.length / 3;
  const { quantized, center, half, qMin, qMax } = quantizePositions(positions);

  // uint16 indices whenever every vertex is addressable; uint32 otherwise.
  const smallIndex = vertCount <= 0xffff;
  const indexArray = smallIndex ? Uint16Array.from(indices) : indices;
  const indexType = smallIndex ? 5123 : 5125; // USHORT vs UINT

  // Vertex colour, when a publish carries paint: normalized ubyte VEC4 -
  // core glTF, and the loader hands it back as the `color` attribute. The
  // floats are LINEAR (the sculpt attribute is), and glTF's COLOR_0 is
  // linear too, so this is a straight scale, not an sRGB encode.
  //
  // VEC4, not VEC3, because of the GPU: three maps a normalized ubyte
  // attribute to a 4-component vertex format (there is no unorm8x3 in
  // WebGPU) while the array stride stays itemSize * 1 byte. A VEC3 colour
  // therefore asked WebGPU for stride 3 with a format needing 4, which the
  // spec rejects - a painted published model failed pipeline validation on
  // every WebGPU browser and rendered only on the WebGL2 fallback. The pad
  // byte (alpha 255) costs one byte a vertex and makes the stride legal;
  // the shader still reads it as vec3.
  const vertCountForColor = positions.length / 3;
  const colorArray =
    colors && colors.length === positions.length
      ? (() => {
          const out = new Uint8Array(vertCountForColor * 4);
          for (let i = 0; i < vertCountForColor; i++) {
            for (let c = 0; c < 3; c++) {
              out[i * 4 + c] = Math.round(Math.max(0, Math.min(1, colors[i * 3 + c])) * 255);
            }
            out[i * 4 + 3] = 255;
          }
          return out;
        })()
      : null;

  const idxLen = indexArray.byteLength;
  const idxPadded = (idxLen + 3) & ~3;
  const posLen = quantized.byteLength;
  const posPadded = colorArray ? (posLen + 3) & ~3 : posLen;
  const colLen = colorArray ? colorArray.byteLength : 0;
  const binLen = idxPadded + posPadded + colLen;

  const attributes: Record<string, number> = { POSITION: 1 };
  if (colorArray) attributes.COLOR_0 = 2;

  const gltf = {
    asset: { version: '2.0', generator: 'bozzetto obj-to-timelapse' },
    extensionsUsed: ['KHR_mesh_quantization'],
    extensionsRequired: ['KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: center, scale: half }],
    meshes: [{ primitives: [{ attributes, indices: 0, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: indexType, count: indices.length, type: 'SCALAR' },
      {
        bufferView: 1,
        componentType: 5122, // SHORT
        normalized: true,
        count: vertCount,
        type: 'VEC3',
        min: qMin,
        max: qMax,
      },
      ...(colorArray
        ? [
            {
              bufferView: 2,
              componentType: 5121, // UBYTE
              normalized: true,
              count: vertCount,
              type: 'VEC4', // see the colorArray note: 4-byte stride for the GPU
            },
          ]
        : []),
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: idxLen, target: 34963 },
      { buffer: 0, byteOffset: idxPadded, byteLength: posLen, target: 34962 },
      ...(colorArray
        ? [{ buffer: 0, byteOffset: idxPadded + posPadded, byteLength: colLen, target: 34962 }]
        : []),
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
  u8.set(new Uint8Array(indexArray.buffer, indexArray.byteOffset, idxLen), o);
  u8.set(new Uint8Array(quantized.buffer, quantized.byteOffset, posLen), o + idxPadded);
  if (colorArray) u8.set(colorArray, o + idxPadded + posPadded);
  // Alignment gaps and trailing bin pad stay 0x00, matching the CLI writer.
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
  return { glb: meshToGLB(positions, indices), tris: indices.length / 3 };
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
