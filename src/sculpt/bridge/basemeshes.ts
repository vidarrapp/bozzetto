import Utils from '@sculpt-vendor/misc/Utils';

/**
 * The base-mesh library: Blender Studio's Human Base Meshes (CC0), exported
 * by tools/export-basemeshes.py into public/assets/basemeshes as .bzm
 * files, one per entry below, with the bundle's own previews as thumbnails.
 *
 * A file is a list of PARTS - a figure and its two eyes, say - each a
 * welded quad mesh with its own centre, plus the offset that puts the parts
 * back together. The app adds the parts as separate objects in one undo
 * step (SculptSession.adoptBaseMesh), scaled together so the figure lands
 * at the canonical sculpt size the primitives use.
 *
 * Files are fetched when a tile is picked, not with the shell: the library
 * is 8 MB and a session touches one or two of them. The service worker
 * keeps what was fetched (vite.config.ts), so a figure used once is there
 * offline.
 *
 * Format (little-endian; tools/export-basemeshes.py writes it):
 *   'BZM1' u32 version=1 u32 partCount u32 reserved
 *   per part: u32 nameLen, name (zero-padded to 4), u32 nVerts, u32 nFaces,
 *             u32 indexBytes (2|4), f32 offset[3], f32 positions[nVerts*3],
 *             u16|u32 faces[nFaces*4] (a triangle's 4th index is all ones)
 */
export type BaseMeshGroup = 'body' | 'head' | 'part';

export interface BaseMeshInfo {
  id: string;
  /** The tile's name, and the object's name in the scene. */
  label: string;
  /** The style, under the name: realistic, stylized, planar... */
  note: string;
  group: BaseMeshGroup;
  /** Faces in the file, all parts, before the app subdivides. */
  faces: number;
  /** Kilobytes fetched. */
  kb: number;
  /**
   * false keeps the facets: the planar skull is a study of planes, and a
   * smooth subdivision would round every one of them off.
   */
  smooth?: boolean;
  /**
   * A blockout's other file: the same figure as its separate lumps, one
   * part per body segment in hierarchy order, for adding "as parts".
   */
  parts?: string;
  /** Who made it, for the tile's tooltip; the bundle is CC0 regardless. */
  by: string;
}

export const BASE_MESH_GROUPS: { group: BaseMeshGroup; title: string }[] = [
  { group: 'body', title: 'Figures' },
  { group: 'head', title: 'Heads' },
  { group: 'part', title: 'Parts' },
];

const DAN = 'Dan Ulrich';
const JULIEN = 'Julien Kaspar';
const PAUL = 'Paul Kotelevets';
const TONATIUH = 'Tonatiuh de San Julián';

/**
 * The entries, in tile order. `faces` and `kb` are what the exporter
 * printed; they only feed the tooltip, so a re-export that drifts a little
 * does no harm.
 */
export const BASE_MESHES: BaseMeshInfo[] = [
  // Figures. The realistic pair is scan data at multires level 1; the
  // stylized pair is Blender Studio's "Snow" and "Rain" topology. The
  // blockouts are the bundle's "primitive" figures - fifty subdivided lumps
  // in Blender - voxel-remeshed by the exporter into one shell, which is
  // the closest thing to a posed mannequin to start a figure from.
  { id: 'body-male-realistic', label: 'Male body', note: 'realistic', group: 'body', faces: 43428, kb: 848, by: DAN },
  { id: 'body-female-realistic', label: 'Female body', note: 'realistic', group: 'body', faces: 43428, kb: 848, by: DAN },
  { id: 'body-male-stylized', label: 'Male body', note: 'stylized', group: 'body', faces: 14164, kb: 276, by: JULIEN },
  { id: 'body-female-stylized', label: 'Female body', note: 'stylized', group: 'body', faces: 14164, kb: 276, by: JULIEN },
  { id: 'blockout-male-realistic', label: 'Male blockout', note: 'realistic', group: 'body', faces: 50672, kb: 990, by: `${PAUL}, ${JULIEN}`, parts: 'blockout-male-realistic-parts' },
  { id: 'blockout-female-realistic', label: 'Female blockout', note: 'realistic', group: 'body', faces: 42224, kb: 825, by: `${PAUL}, ${JULIEN}`, parts: 'blockout-female-realistic-parts' },
  { id: 'blockout-male-stylized', label: 'Male blockout', note: 'stylized', group: 'body', faces: 52344, kb: 1022, by: PAUL, parts: 'blockout-male-stylized-parts' },
  { id: 'blockout-female-stylized', label: 'Female blockout', note: 'stylized', group: 'body', faces: 39040, kb: 763, by: PAUL, parts: 'blockout-female-stylized-parts' },
  // Heads. Realistic is the sculpting-topology scan with its eyes; planar
  // is the "planes of the head" study at multires level 2; generic is a
  // 316-face cage, the one to start a head from scratch on.
  { id: 'head-realistic', label: 'Head', note: 'realistic', group: 'head', faces: 14298, kb: 279, by: DAN },
  { id: 'head-stylized', label: 'Head', note: 'stylized', group: 'head', faces: 5798, kb: 112, by: JULIEN },
  { id: 'head-planar', label: 'Head', note: 'planar', group: 'head', faces: 5056, kb: 99, by: PAUL },
  { id: 'head-generic', label: 'Head', note: 'low poly', group: 'head', faces: 316, kb: 6, by: PAUL },
  { id: 'head-blockout', label: 'Head', note: 'blockout', group: 'head', faces: 44264, kb: 865, by: `${PAUL}, ${JULIEN}`, parts: 'head-blockout-parts' },
  // Parts. One hand and one foot each; Mirror in the Scene panel makes the
  // other side.
  { id: 'hand-realistic', label: 'Hand', note: 'realistic', group: 'part', faces: 3298, kb: 64, by: DAN },
  { id: 'hand-stylized', label: 'Hand', note: 'stylized', group: 'part', faces: 880, kb: 17, by: JULIEN },
  { id: 'foot-realistic', label: 'Foot', note: 'realistic', group: 'part', faces: 5952, kb: 116, by: DAN },
  { id: 'foot-stylized', label: 'Foot', note: 'stylized', group: 'part', faces: 798, kb: 16, by: JULIEN },
  { id: 'eye-realistic', label: 'Eye', note: 'realistic', group: 'part', faces: 944, kb: 19, by: DAN },
  { id: 'eye-stylized', label: 'Eye', note: 'stylized', group: 'part', faces: 832, kb: 16, by: JULIEN },
  { id: 'jaw-realistic', label: 'Jaw', note: 'realistic', group: 'part', faces: 5470, kb: 105, by: DAN },
  { id: 'jaw-stylized', label: 'Jaw', note: 'stylized', group: 'part', faces: 6308, kb: 126, by: JULIEN },
  { id: 'skull-realistic', label: 'Skull', note: 'realistic', group: 'part', faces: 11634, kb: 228, by: `${PAUL}, ${TONATIUH}` },
  { id: 'skull-planar', label: 'Skull', note: 'planar', group: 'part', faces: 898, kb: 18, smooth: false, by: TONATIUH },
];

/** How a base mesh is added; only a blockout with a parts file honours it. */
export interface AddBaseMeshOptions {
  /** Every lump as its own object, rather than the one remeshed shell. */
  parts?: boolean;
}

export function baseMeshById(id: string): BaseMeshInfo | undefined {
  return BASE_MESHES.find((b) => b.id === id);
}

export function baseMeshUrl(id: string): string {
  return `/assets/basemeshes/${id}.bzm`;
}

export function baseMeshThumbUrl(id: string): string {
  return `/assets/basemeshes/thumbs/${id}.png`;
}

export interface BaseMeshPart {
  name: string;
  /** The part's centre relative to the figure's centre, metres. */
  offset: [number, number, number];
  /** Relative to the part's own centre, metres, Y up, facing +Z. */
  positions: Float32Array;
  /** Four indices a face; a triangle's fourth is Utils.TRI_INDEX. */
  faces: Uint32Array;
}

export interface BaseMeshFile {
  parts: BaseMeshPart[];
}

const MAGIC = 'BZM1';

export function parseBaseMesh(buf: ArrayBuffer): BaseMeshFile {
  const dv = new DataView(buf);
  const fail = (why: string): never => {
    throw new Error(`Not a base mesh file: ${why}`);
  };
  if (buf.byteLength < 16) fail('too short');
  let magic = '';
  for (let i = 0; i < 4; i++) magic += String.fromCharCode(dv.getUint8(i));
  if (magic !== MAGIC) fail('bad magic');
  const version = dv.getUint32(4, true);
  if (version !== 1) fail(`version ${version}`);
  const count = dv.getUint32(8, true);
  let off = 16;
  const need = (bytes: number): void => {
    if (off + bytes > buf.byteLength) fail('truncated');
  };
  const parts: BaseMeshPart[] = [];
  for (let p = 0; p < count; p++) {
    need(4);
    const nameLen = dv.getUint32(off, true);
    off += 4;
    need(nameLen);
    const name = new TextDecoder().decode(new Uint8Array(buf, off, nameLen));
    off += nameLen + ((4 - (nameLen % 4)) % 4);
    need(24);
    const nVerts = dv.getUint32(off, true);
    const nFaces = dv.getUint32(off + 4, true);
    const indexBytes = dv.getUint32(off + 8, true);
    off += 12;
    const offset: [number, number, number] = [
      dv.getFloat32(off, true),
      dv.getFloat32(off + 4, true),
      dv.getFloat32(off + 8, true),
    ];
    off += 12;
    need(nVerts * 12);
    // Sliced copies: the typed views must start on their own alignment,
    // which the writer guarantees, but a copy owes nothing to the layout.
    const positions = new Float32Array(buf.slice(off, off + nVerts * 12));
    off += nVerts * 12;
    const faces = new Uint32Array(nFaces * 4);
    if (indexBytes === 2) {
      need(nFaces * 8);
      const u16 = new Uint16Array(buf.slice(off, off + nFaces * 8));
      for (let i = 0; i < u16.length; i++) faces[i] = u16[i] === 0xffff ? Utils.TRI_INDEX : u16[i];
      off += nFaces * 8;
    } else if (indexBytes === 4) {
      need(nFaces * 16);
      faces.set(new Uint32Array(buf.slice(off, off + nFaces * 16)));
      off += nFaces * 16;
    } else {
      fail(`index size ${indexBytes}`);
    }
    for (let i = 0; i < faces.length; i++) {
      const v = faces[i];
      if (v !== Utils.TRI_INDEX && v >= nVerts) fail('index out of range');
    }
    parts.push({ name, offset, positions, faces });
  }
  if (!parts.length) fail('no parts');
  return { parts };
}

/** Fetch and parse one entry's file. */
export async function loadBaseMesh(id: string): Promise<BaseMeshFile> {
  const res = await fetch(baseMeshUrl(id));
  if (!res.ok) throw new Error(`Base mesh "${id}" failed to load (${res.status})`);
  return parseBaseMesh(await res.arrayBuffer());
}
