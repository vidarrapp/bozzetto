import type { BufferGeometry, Object3D } from 'three';
import type { ParsedObjPolygons } from '../../admin/glb';

/**
 * Import model: the formats Sculpt reads besides OBJ (owner decision,
 * 2026-11-25): .glb, a self-contained .gltf, .stl and .ply. Geometry only.
 * three's own loaders read them, loaded on first use, and the result is
 * the same parsed form the OBJ path feeds (glb.ts ParsedObjPolygons), so
 * everything after it is the OBJ import's: one object, each mesh of the
 * file a poly group, the weld, the size and the up axis. Vertices that
 * share a place are joined here too (STL shares none; a GLB splits them
 * at UV and normal seams), which also keeps the record small.
 * Colours, materials, textures, rigs and animations are left behind.
 */

export type ModelFormat = 'obj' | 'glb' | 'gltf' | 'stl' | 'ply';

/** What the pickers offer. */
export const MODEL_ACCEPT = '.obj,.glb,.gltf,.stl,.ply';

/** The format a file name says, or null. */
export function modelFormat(fileName: string): ModelFormat | null {
  const m = /\.(obj|glb|gltf|stl|ply)$/i.exec(fileName);
  return m ? (m[1].toLowerCase() as ModelFormat) : null;
}

/** Whether the Z-up switch applies: a glTF is Y-up by definition. */
export function modelUsesZUp(format: ModelFormat): boolean {
  return format !== 'glb' && format !== 'gltf';
}

/** Same tolerance as the import's own weld (objSource.ts WELD). */
const WELD = 1e4;

/** Collects triangles from meshes, joining vertices that share a place. */
class Collector {
  private readonly places = new Map<string, number>();
  private readonly pos: number[] = [];
  readonly tris: number[] = [];
  readonly extras: { line: string; at: number }[] = [];

  private vertex(x: number, y: number, z: number): number {
    const key = `${Math.round(x * WELD)},${Math.round(y * WELD)},${Math.round(z * WELD)}`;
    let id = this.places.get(key);
    if (id === undefined) {
      id = this.pos.length / 3;
      this.places.set(key, id);
      this.pos.push(x, y, z);
    }
    return id;
  }

  /** One mesh's triangles; `to` moves a point into the file's space. */
  add(geometry: BufferGeometry, name: string | null, to?: (v: [number, number, number]) => void): void {
    const attr = geometry.getAttribute('position');
    if (!attr) return;
    const index = geometry.getIndex();
    const count = index ? index.count : attr.count;
    const ids = new Map<number, number>();
    const p: [number, number, number] = [0, 0, 0];
    const first = this.tris.length;
    const at = this.tris.length / 3;
    for (let i = 0; i + 2 < count; i += 3) {
      const tri: number[] = [];
      for (let k = 0; k < 3; k++) {
        const src = index ? index.getX(i + k) : i + k;
        let id = ids.get(src);
        if (id === undefined) {
          p[0] = attr.getX(src);
          p[1] = attr.getY(src);
          p[2] = attr.getZ(src);
          if (to) to(p);
          id = Number.isFinite(p[0] + p[1] + p[2]) ? this.vertex(p[0], p[1], p[2]) : -1;
          ids.set(src, id);
        }
        tri.push(id);
      }
      if (tri.every((v) => v >= 0)) this.tris.push(tri[0], tri[1], tri[2]);
    }
    if (name !== null && this.tris.length > first) this.extras.push({ line: `o ${name}`, at });
  }

  done(): ParsedObjPolygons {
    const n = this.tris.length / 3;
    return {
      positions: Float64Array.from(this.pos),
      faceSizes: new Uint32Array(n).fill(3),
      faceVerts: Uint32Array.from(this.tris),
      faceUVs: null,
      uvLines: [],
      extras: this.extras,
    };
  }
}

/** A mesh's name as a group name: one line, no stray spaces. */
function groupName(name: string, n: number): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 100) || `Mesh ${n}`;
}

const NO_GEOMETRY = (what: string): Error => new Error(`No geometry found in that ${what} file.`);

/** A .gltf names its buffers and images by address unless it carries them; only a self-contained one is read. */
function checkSelfContained(text: string): void {
  let json: { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('That .gltf file is not readable: it is not valid glTF.');
  }
  const outside = [...(json.buffers ?? []), ...(json.images ?? [])].some((b) => typeof b?.uri === 'string' && !b.uri.startsWith('data:'));
  if (outside) throw new Error('That .gltf file needs other files beside it. Save it as .glb, which holds everything in one file.');
}

/**
 * Read a model file as the OBJ import's parsed form. Throws, in plain
 * words, when the file cannot be read or holds no triangles.
 */
export async function parseModel(format: ModelFormat, data: ArrayBuffer): Promise<ParsedObjPolygons> {
  if (format === 'obj') {
    const { parseObjPolygons } = await import('../../admin/glb');
    return parseObjPolygons(new TextDecoder().decode(data));
  }
  const out = new Collector();
  try {
    if (format === 'stl') {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      out.add(new STLLoader().parse(data), null);
    } else if (format === 'ply') {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
      const geometry = new PLYLoader().parse(data);
      if (!geometry.getIndex() && geometry.getAttribute('position')?.count < 3) throw NO_GEOMETRY('.ply');
      out.add(geometry, null);
    } else {
      let source: ArrayBuffer | string = data;
      if (format === 'gltf') {
        source = new TextDecoder().decode(data);
        checkSelfContained(source);
      }
      const { getGLTFLoader } = await import('../../loaders/gltf');
      const gltf = await new Promise<{ scene: Object3D }>((ok, no) => getGLTFLoader().parse(source, '', ok, (e) => no(e.error ?? e)));
      gltf.scene.updateMatrixWorld(true);
      let n = 0;
      gltf.scene.traverse((o) => {
        const mesh = o as Object3D & { isMesh?: boolean; geometry?: BufferGeometry };
        if (!mesh.isMesh || !mesh.geometry) return;
        const m = mesh.matrixWorld.elements;
        n++;
        out.add(mesh.geometry, groupName(mesh.name, n), (v) => {
          const [x, y, z] = v;
          v[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
          v[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
          v[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        });
      });
    }
  } catch (err) {
    const what = format === 'gltf' ? '.gltf' : `.${format}`;
    if (err instanceof Error && /^(No geometry|That \.gltf)/.test(err.message)) throw err;
    // The loader's own words are about its internals; the person is told what to do.
    throw new Error(`That ${what} file is not readable. It is damaged, or it is not a real ${what} file.`);
  }
  const parsed = out.done();
  if (!parsed.faceSizes.length) throw NO_GEOMETRY(format === 'gltf' ? '.gltf' : `.${format}`);
  return parsed;
}
