/**
 * Generate a synthetic demo timelapse so the viewer runs out of the box.
 *
 * Produces, under /public:
 *   timelapses/demo/frames/sd/0000.glb ...   independent per-frame meshes
 *   timelapses/demo/manifest.json            data contract (design doc §11)
 *   assets/matcaps/clay.png                   default clay matcap (design §8)
 *
 * Each frame is an independently-built icosphere displaced by evolving noise:
 * lumpy "big volumes" early, secondary forms and surface detail emerging over
 * time, with the subdivision level alternating per frame so consecutive frames
 * never share topology — exactly the unique-topology contract the app expects.
 *
 * Pure Node (fs + zlib), no dependencies. Writes a minimal but valid glTF
 * binary container and a hand-rolled PNG; both load through the standard
 * GLTFLoader / TextureLoader unchanged.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC = join(ROOT, 'public');

const FRAME_COUNT = 24;
const FPS = 4;
const SCALE = 1.0;

const STAGES = [
  { name: 'Big Volumes', frame: 0, desc: 'Mass relationships first.', sub: 1 },
  { name: 'Form Block-In', frame: 6, desc: 'Major planes established.', sub: 2 },
  { name: 'Secondary Forms', frame: 12, desc: 'Brow and nose resolve.', sub: 2 },
  { name: 'Surface Detail', frame: 18, desc: 'Final faceted surface.', sub: 3 },
];

// ---------------------------------------------------------------------------
// Vector helpers (plain objects, kept tiny)
// ---------------------------------------------------------------------------
const v = (x, y, z) => ({ x, y, z });
const sub = (a, b) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) =>
  v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => {
  const l = len(a) || 1;
  return v(a.x / l, a.y / l, a.z / l);
};
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (x) => x * x * (3 - 2 * x);
const ramp = (t, a, b) => clamp01((t - a) / (b - a));

// ---------------------------------------------------------------------------
// Icosphere: subdivided icosahedron, returned as unit-sphere directions + faces
// ---------------------------------------------------------------------------
function icosphere(subdivisions) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    v(-1, t, 0), v(1, t, 0), v(-1, -t, 0), v(1, -t, 0),
    v(0, -1, t), v(0, 1, t), v(0, -1, -t), v(0, 1, -t),
    v(t, 0, -1), v(t, 0, 1), v(-t, 0, -1), v(-t, 0, 1),
  ].map(norm);

  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];

  const midCache = new Map();
  const midpoint = (a, b) => {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    const cached = midCache.get(key);
    if (cached !== undefined) return cached;
    const m = norm(v(
      (verts[a].x + verts[b].x) / 2,
      (verts[a].y + verts[b].y) / 2,
      (verts[a].z + verts[b].z) / 2,
    ));
    const idx = verts.push(m) - 1;
    midCache.set(key, idx);
    return idx;
  };

  for (let s = 0; s < subdivisions; s++) {
    const next = [];
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }

  return { dirs: verts, faces };
}

// ---------------------------------------------------------------------------
// Sculpt displacement: a vertically-stretched blob that roughs out lumpy, then
// resolves smoother with an emerging brow and nose and late surface detail.
// ---------------------------------------------------------------------------
function pseudoNoise(p) {
  return (
    Math.sin(p.x * 1.7 + p.y * 2.3) * Math.cos(p.z * 1.9 - p.x * 0.7) +
    Math.sin(p.y * 2.9 + p.z * 1.3) * 0.6 +
    Math.sin(p.z * 3.1 - p.x * 2.1) * 0.4
  ) / 2;
}

const BROW_AXIS = norm(v(0, 0.18, 1));
const NOSE_AXIS = norm(v(0, -0.06, 1));
const bump = (d, axis, width) =>
  Math.exp(-((1 - dot(d, axis)) / width));

function sculptRadius(d, t) {
  const elong = 1 + 0.28 * d.y; // egg/bust-ish stretch
  const big = pseudoNoise(v(d.x * 1.6, d.y * 1.6, d.z * 1.6));
  const med = pseudoNoise(v(d.x * 3.5 + 5, d.y * 3.5, d.z * 3.5 - 3));
  const fine = pseudoNoise(v(d.x * 9 + 11, d.y * 9 - 7, d.z * 9 + 2));

  const aBig = 0.32 * (1 - smoothstep(t)) + 0.05;
  const aMed = 0.15 * ramp(t, 0.25, 0.7);
  const aBrow = 0.18 * ramp(t, 0.35, 0.85);
  const aNose = 0.24 * ramp(t, 0.5, 0.95);
  const aFine = 0.05 * ramp(t, 0.6, 1);

  return (
    elong +
    aBig * big +
    aMed * med +
    aBrow * bump(d, BROW_AXIS, 0.5) +
    aNose * bump(d, NOSE_AXIS, 0.22) +
    aFine * fine
  );
}

// ---------------------------------------------------------------------------
// Build one frame's geometry (positions, smooth normals, outward-wound indices)
// ---------------------------------------------------------------------------
function buildFrame(frameIndex) {
  const t = frameIndex / (FRAME_COUNT - 1);
  // Subdivision from the active stage, alternating ±1 per frame so consecutive
  // frames differ in topology (no vertex correspondence).
  const stage = [...STAGES].reverse().find((s) => frameIndex >= s.frame);
  const subdiv = stage.sub + (frameIndex % 2);

  const { dirs, faces } = icosphere(subdiv);

  const vertCount = dirs.length;
  const positions = new Float32Array(vertCount * 3);
  for (let i = 0; i < vertCount; i++) {
    const d = dirs[i];
    const r = sculptRadius(d, t) * SCALE;
    positions[i * 3] = d.x * r;
    positions[i * 3 + 1] = d.y * r;
    positions[i * 3 + 2] = d.z * r;
  }

  const indices = new Uint32Array(faces.length * 3);
  const normals = new Float32Array(vertCount * 3);
  const pos = (i) => v(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);

  for (let f = 0; f < faces.length; f++) {
    let [a, b, c] = faces[f];
    const pa = pos(a), pb = pos(b), pc = pos(c);
    let n = cross(sub(pb, pa), sub(pc, pa));
    const centroid = v((pa.x + pb.x + pc.x) / 3, (pa.y + pb.y + pc.y) / 3, (pa.z + pb.z + pc.z) / 3);
    // Ensure outward winding + normal.
    if (dot(n, centroid) < 0) {
      [b, c] = [c, b];
      n = v(-n.x, -n.y, -n.z);
    }
    indices[f * 3] = a;
    indices[f * 3 + 1] = b;
    indices[f * 3 + 2] = c;
    for (const i of [a, b, c]) {
      normals[i * 3] += n.x;
      normals[i * 3 + 1] += n.y;
      normals[i * 3 + 2] += n.z;
    }
  }
  for (let i = 0; i < vertCount; i++) {
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    const l = Math.hypot(nx, ny, nz) || 1;
    normals[i * 3] = nx / l;
    normals[i * 3 + 1] = ny / l;
    normals[i * 3 + 2] = nz / l;
  }

  return { positions, normals, indices, tris: faces.length };
}

// ---------------------------------------------------------------------------
// Minimal glTF-binary (.glb) writer
// ---------------------------------------------------------------------------
function meshToGLB({ positions, normals, indices }) {
  const idxBytes = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
  const posBytes = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength);
  const nrmBytes = Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength);

  const idxLen = idxBytes.length;
  const posLen = posBytes.length; // all multiples of 4 → already aligned
  const nrmLen = nrmBytes.length;
  const bin = Buffer.concat([idxBytes, posBytes, nrmBytes]);

  // POSITION accessor requires min/max.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const val = positions[i + k];
      if (val < min[k]) min[k] = val;
      if (val > max[k]) max[k] = val;
    }
  }

  const vertCount = positions.length / 3;
  const gltf = {
    asset: { version: '2.0', generator: 'bozzetto sample generator' },
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
    buffers: [{ byteLength: bin.length }],
  };

  const jsonBuf = pad(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const binBuf = pad(bin, 0x00);

  const total = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4); // version
  header.writeUInt32LE(total, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binBuf.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

  return Buffer.concat([header, jsonHeader, jsonBuf, binHeader, binBuf]);
}

function pad(buf, fill) {
  const rem = buf.length % 4;
  if (rem === 0) return buf;
  return Buffer.concat([buf, Buffer.alloc(4 - rem, fill)]);
}

// ---------------------------------------------------------------------------
// Procedural clay matcap PNG (sphere shaded from upper-left)
// ---------------------------------------------------------------------------
function makeMatcapPNG(size = 256) {
  const L = norm(v(-0.4, 0.6, 0.7));
  const base = v(0.62, 0.42, 0.34); // linear clay
  const data = Buffer.alloc(size * size * 4);

  const encode = (lin) => Math.round(clamp01(Math.pow(clamp01(lin), 1 / 2.2)) * 255);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = ((px + 0.5) / size) * 2 - 1;
      const ny = 1 - ((py + 0.5) / size) * 2;
      const r2 = nx * nx + ny * ny;
      const o = (py * size + px) * 4;

      let cr, cg, cb;
      if (r2 > 1) {
        cr = base.x * 0.1; cg = base.y * 0.1; cb = base.z * 0.1;
      } else {
        const nz = Math.sqrt(1 - r2);
        const N = v(nx, ny, nz);
        const diff = Math.max(0, dot(N, L));
        const H = norm(v(L.x, L.y, L.z + 1));
        const spec = Math.pow(Math.max(0, dot(N, H)), 24) * 0.25;
        const rim = Math.pow(1 - nz, 3) * 0.15;
        const shade = 0.18 + 0.95 * diff;
        cr = base.x * shade + spec + rim * 0.5;
        cg = base.y * shade + spec + rim * 0.6;
        cb = base.z * shade + spec + rim * 0.8;
      }
      data[o] = encode(cr);
      data[o + 1] = encode(cg);
      data[o + 2] = encode(cb);
      data[o + 3] = 255;
    }
  }
  return encodePNG(size, size, data);
}

// Minimal PNG (8-bit RGBA, single IDAT)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  // 10,11,12 = compression, filter, interlace = 0

  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Write everything
// ---------------------------------------------------------------------------
const framesDir = join(PUBLIC, 'timelapses', 'demo', 'frames', 'sd');
const matcapDir = join(PUBLIC, 'assets', 'matcaps');
mkdirSync(framesDir, { recursive: true });
mkdirSync(matcapDir, { recursive: true });

const frameEntries = [];
let totalBytes = 0;
for (let i = 0; i < FRAME_COUNT; i++) {
  const geom = buildFrame(i);
  const glb = meshToGLB(geom);
  const name = `${String(i).padStart(4, '0')}.glb`;
  writeFileSync(join(framesDir, name), glb);
  totalBytes += glb.length;
  frameEntries.push({ index: i, sd: `frames/sd/${name}`, hd: null, tris: geom.tris });
}

const manifest = {
  id: 'demo',
  title: 'Demo bust (synthetic)',
  config: { frameCount: FRAME_COUNT, fps: FPS, ext: 'glb', tiers: ['sd'], frameStartIndex: 0 },
  defaults: { frame: 0, playing: true, material: 'lit', lightingPreset: 'three_point' },
  camera: { autoFrame: true },
  frames: frameEntries,
  stages: STAGES.map(({ name, frame, desc }) => ({ name, frame, desc })),
};
writeFileSync(
  join(PUBLIC, 'timelapses', 'demo', 'manifest.json'),
  JSON.stringify(manifest, null, 2),
);

writeFileSync(join(matcapDir, 'clay.png'), makeMatcapPNG(256));

console.log(
  `Generated ${FRAME_COUNT} frames (${(totalBytes / 1024).toFixed(0)} KB total), ` +
    `manifest.json, and clay matcap under public/.`,
);
