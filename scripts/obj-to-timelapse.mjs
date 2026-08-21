/**
 * Convert a sequence of OBJ (or pre-made GLB) files into a Bozzetto timelapse:
 * one decimated .glb per frame plus a manifest.json (design doc §11).
 *
 * Usage:
 *   node scripts/obj-to-timelapse.mjs <inputDir> <id> [options]
 *
 * Options:
 *   --fps=<n>        playback rate (default 4)
 *   --title="..."    display title (default: the id)
 *   --z-up           treat OBJ as Z-up and convert to Y-up (default: Y-up)
 *
 * Input: one .obj per frame in <inputDir>, sorted naturally by filename
 * (e.g. model_0001.obj, model_0002.obj, ...). UVs/materials are ignored (the
 * viewer's modes don't need them), and normals aren't stored at all — the
 * viewer recomputes the same smooth normals on load. Frames are written as
 * gzipped GLBs with int16-quantized positions (KHR_mesh_quantization), the
 * same compact format the in-browser converter produces; the viewer inflates
 * by content sniff, so the files keep their .glb names. Output is written to
 * public/timelapses/<id>/ and, unlike the demo, is NOT gitignored — commit it
 * and push to deploy.
 *
 * Pure Node, no dependencies.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC = join(ROOT, 'public');

// --- args ---------------------------------------------------------------
const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  args
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v ?? true];
    }),
);

const [inputDir, id] = positional;
if (!inputDir || !id) {
  console.error('Usage: node scripts/obj-to-timelapse.mjs <inputDir> <id> [--fps=4] [--title="..."] [--z-up]');
  process.exit(1);
}
const fps = Number(flags.fps ?? 4);
const title = typeof flags.title === 'string' ? flags.title : id;
const zUp = Boolean(flags['z-up']);

// --- gather frames ------------------------------------------------------
const naturalSort = (a, b) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const objFiles = readdirSync(inputDir)
  .filter((f) => f.toLowerCase().endsWith('.obj'))
  .sort(naturalSort);

if (objFiles.length === 0) {
  console.error(`No .obj files found in ${inputDir}`);
  process.exit(1);
}

// --- OBJ parsing --------------------------------------------------------
function parseObj(text) {
  const verts = []; // flat [x,y,z, ...]
  const indices = [];

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
 * load. Mirrors src/admin/glb.ts.
 */
function quantizePositions(positions) {
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

// --- minimal glTF-binary (.glb) writer ----------------------------------
// Compact frame format, mirroring src/admin/glb.ts: quantized int16 positions
// (KHR_mesh_quantization, dequant transform on the node), uint16 indices when
// the mesh is small enough, and no normals (the viewer recomputes them).
function meshToGLB({ positions, indices }) {
  const vertCount = positions.length / 3;
  const { quantized, center, half, qMin, qMax } = quantizePositions(positions);

  const smallIndex = vertCount <= 0xffff;
  const indexArray = smallIndex ? Uint16Array.from(indices) : indices;
  const indexType = smallIndex ? 5123 : 5125; // USHORT vs UINT

  const idxBytes = Buffer.from(indexArray.buffer, indexArray.byteOffset, indexArray.byteLength);
  const posBytes = Buffer.from(quantized.buffer, quantized.byteOffset, quantized.byteLength);
  const idxLen = idxBytes.length;
  const idxPadded = (idxLen + 3) & ~3;
  const posLen = posBytes.length;
  const bin = Buffer.concat([idxBytes, Buffer.alloc(idxPadded - idxLen), posBytes]);

  const gltf = {
    asset: { version: '2.0', generator: 'bozzetto obj-to-timelapse' },
    extensionsUsed: ['KHR_mesh_quantization'],
    extensionsRequired: ['KHR_mesh_quantization'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: center, scale: half }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0, mode: 4 }] }],
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
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: idxLen, target: 34963 },
      { buffer: 0, byteOffset: idxPadded, byteLength: posLen, target: 34962 },
    ],
    buffers: [{ byteLength: bin.length }],
  };

  const jsonBuf = pad(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const binBuf = pad(bin, 0x00);
  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuf.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);

  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binBuf]);
}

function pad(buf, fill) {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]);
}

// --- convert ------------------------------------------------------------
const framesDir = join(PUBLIC, 'timelapses', id, 'frames', 'sd');
mkdirSync(framesDir, { recursive: true });

const frameEntries = [];
objFiles.forEach((file, i) => {
  const { positions, indices } = parseObj(readFileSync(join(inputDir, file), 'utf8'));
  if (positions.length === 0 || indices.length === 0) {
    console.error(`Skipping ${file}: no geometry parsed`);
    return;
  }
  const glb = meshToGLB({ positions, indices });
  // Stored gzipped (the viewer inflates by magic sniff); the .glb name stays
  // so manifests and URLs are format-agnostic.
  const packed = gzipSync(glb);
  const name = `${String(i).padStart(4, '0')}.glb`;
  writeFileSync(join(framesDir, name), packed);
  frameEntries.push({ index: i, sd: `frames/sd/${name}`, hd: null, tris: indices.length / 3 });
  console.log(
    `  ${file} -> ${name} (${(indices.length / 3).toLocaleString()} tris, ` +
      `${(packed.length / 1024).toFixed(0)} KB)`,
  );
});

const manifest = {
  id,
  title,
  config: { frameCount: frameEntries.length, fps, ext: 'glb', tiers: ['sd'], frameStartIndex: 0 },
  defaults: { frame: 0, playing: true, material: 'flat', lightingPreset: 'three_point' },
  camera: { autoFrame: true },
  frames: frameEntries,
  stages: [],
};
writeFileSync(
  join(PUBLIC, 'timelapses', id, 'manifest.json'),
  JSON.stringify(manifest, null, 2),
);

console.log(
  `\nWrote ${frameEntries.length} frames + manifest to public/timelapses/${id}/.\n` +
    `Commit and push to deploy, then view at  /?tl=${id}`,
);
