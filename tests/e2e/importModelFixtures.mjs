// Small model files for the importModel suite: one cube (8 corners, 12
// triangles or 6 quads) in each format Import model reads, and a broken
// file of each kind. `writeFixtures(dir)` returns name -> path.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A cube two across, centred on the origin: corners in the order x fastest, then y, then z. */
export const CORNERS = [
  [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
];
/** Twelve triangles, wound outwards. */
export const TRIS = [
  [0, 2, 3], [0, 3, 1], [4, 5, 7], [4, 7, 6], [0, 1, 5], [0, 5, 4],
  [2, 6, 7], [2, 7, 3], [0, 4, 6], [0, 6, 2], [1, 3, 7], [1, 7, 5],
];
const QUADS = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];

function obj() {
  return [...CORNERS.map((c) => `v ${c.join(' ')}`), ...QUADS.map((q) => `f ${q.map((i) => i + 1).join(' ')}`), ''].join('\n');
}

/** A binary glTF: one node (moved 10 along x, scaled 2) holding a unit cube of 24 corners (split at its normals). */
function glb() {
  const pos = [];
  const idx = [];
  const faces = [
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
    [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  ];
  for (const [, corners] of faces) {
    const base = pos.length / 3;
    for (const c of corners) pos.push(c[0] / 2, c[1] / 2, c[2] / 2);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const pb = Buffer.from(new Float32Array(pos).buffer);
  const ib = Buffer.from(new Uint16Array(idx).buffer);
  const bin = Buffer.concat([pb, ib]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Box node', mesh: 0, translation: [10, 0, 0], scale: [2, 2, 2] }],
    meshes: [{ name: 'Box', primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pb.length },
      { buffer: 0, byteOffset: pb.length, byteLength: ib.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const padded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'latin1');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + js.length + 8 + padded.length, 8);
  const c1 = Buffer.alloc(8);
  c1.writeUInt32LE(js.length, 0);
  c1.write('JSON', 4, 'latin1');
  const c2 = Buffer.alloc(8);
  c2.writeUInt32LE(padded.length, 0);
  c2.write('BIN\0', 4, 'latin1');
  return Buffer.concat([head, c1, js, c2, padded]);
}

function stlBinary() {
  const b = Buffer.alloc(84 + TRIS.length * 50);
  b.write('cube', 0, 'latin1');
  b.writeUInt32LE(TRIS.length, 80);
  TRIS.forEach((t, i) => {
    const o = 84 + i * 50 + 12; // the normal is left zero
    t.forEach((v, k) => CORNERS[v].forEach((x, a) => b.writeFloatLE(x, o + k * 12 + a * 4)));
  });
  return b;
}

function stlAscii() {
  const out = ['solid cube'];
  for (const t of TRIS) {
    out.push('  facet normal 0 0 0', '    outer loop', ...t.map((v) => `      vertex ${CORNERS[v].join(' ')}`), '    endloop', '  endfacet');
  }
  out.push('endsolid cube', '');
  return out.join('\n');
}

function plyAscii() {
  return [
    'ply', 'format ascii 1.0', `element vertex ${CORNERS.length}`, 'property float x', 'property float y', 'property float z',
    `element face ${TRIS.length}`, 'property list uchar int vertex_indices', 'end_header',
    ...CORNERS.map((c) => c.join(' ')), ...TRIS.map((t) => `3 ${t.join(' ')}`), '',
  ].join('\n');
}

function plyBinary() {
  const head = Buffer.from(
    ['ply', 'format binary_little_endian 1.0', `element vertex ${CORNERS.length}`, 'property float x', 'property float y', 'property float z',
      `element face ${TRIS.length}`, 'property list uchar int vertex_indices', 'end_header', ''].join('\n'),
  );
  const v = Buffer.alloc(CORNERS.length * 12);
  CORNERS.forEach((c, i) => c.forEach((x, a) => v.writeFloatLE(x, i * 12 + a * 4)));
  const f = Buffer.alloc(TRIS.length * 13);
  TRIS.forEach((t, i) => {
    f.writeUInt8(3, i * 13);
    t.forEach((x, k) => f.writeInt32LE(x, i * 13 + 1 + k * 4));
  });
  return Buffer.concat([head, v, f]);
}

/** Write every fixture into `dir`; the broken ones are named `broken.<ext>`. */
export function writeFixtures(dir) {
  const files = {
    'cube.obj': obj(),
    'cube.glb': glb(),
    'cube.stl': stlBinary(),
    'cube ascii.stl': stlAscii(),
    'cube.ply': plyBinary(),
    'cube ascii.ply': plyAscii(),
    // A file of each kind that cannot be read: no triangles, or not the format at all.
    'broken.obj': 'v 0 0 0\nv 1 0 0\n',
    'broken.glb': Buffer.concat([glb().subarray(0, 40)]),
    'broken.stl': 'solid empty\nendsolid empty\n',
    'broken.ply': 'this is not a ply file',
    'outside.gltf': JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'cube.bin', byteLength: 4 }] }),
  };
  const out = {};
  for (const [name, data] of Object.entries(files)) {
    out[name] = join(dir, name);
    writeFileSync(out[name], data);
  }
  return out;
}
