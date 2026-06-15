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
 * (e.g. model_0001.obj, model_0002.obj, ...). Normals are recomputed smooth
 * from the geometry; UVs/materials are ignored (the viewer's modes don't need
 * them). Output is written to public/timelapses/<id>/ and, unlike the demo,
 * is NOT gitignored — commit it and push to deploy.
 *
 * Pure Node, no dependencies.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

  return {
    positions: new Float32Array(verts),
    indices:
      verts.length / 3 > 65535
        ? new Uint32Array(indices)
        : Uint32Array.from(indices),
  };
}

/** Smooth per-vertex normals from positions + indices (respects OBJ winding). */
function computeNormals(positions, indices) {
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

// --- minimal glTF-binary (.glb) writer ----------------------------------
function meshToGLB({ positions, normals, indices }) {
  const idxBytes = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
  const posBytes = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength);
  const nrmBytes = Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength);

  const idxLen = idxBytes.length;
  const posLen = posBytes.length;
  const nrmLen = nrmBytes.length;
  const bin = Buffer.concat([idxBytes, posBytes, nrmBytes]);

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const val = positions[i + k];
      if (val < min[k]) min[k] = val;
      if (val > max[k]) max[k] = val;
    }
  }

  const componentType = indices instanceof Uint32Array ? 5125 : 5123; // UINT vs USHORT
  const vertCount = positions.length / 3;
  const gltf = {
    asset: { version: '2.0', generator: 'bozzetto obj-to-timelapse' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1, NORMAL: 2 }, indices: 0, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType, count: indices.length, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: vertCount, type: 'VEC3', min, max },
      { bufferView: 2, componentType: 5126, count: vertCount, type: 'VEC3' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: idxLen, target: 34963 },
      { buffer: 0, byteOffset: idxLen, byteLength: posLen, target: 34962 },
      { buffer: 0, byteOffset: idxLen + posLen, byteLength: nrmLen, target: 34962 },
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
  const normals = computeNormals(positions, indices);
  const glb = meshToGLB({ positions, normals, indices });
  const name = `${String(i).padStart(4, '0')}.glb`;
  writeFileSync(join(framesDir, name), glb);
  frameEntries.push({ index: i, sd: `frames/sd/${name}`, hd: null, tris: indices.length / 3 });
  console.log(`  ${file} -> ${name} (${(indices.length / 3).toLocaleString()} tris)`);
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
