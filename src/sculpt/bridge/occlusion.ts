import { mat4 } from 'gl-matrix';
import Picking from '@sculpt-vendor/math3d/Picking';
import Utils from '@sculpt-vendor/misc/Utils';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';
import type { SculptSession } from './SculptSession';

/**
 * Which vertices of a dab the camera cannot see, for Project: a vertex is
 * hidden when something nearer to the camera covers its place on screen: a
 * triangle of a visible object (its own surface or another object's), the
 * vertex's own triangles aside. The vertex is lifted a little off the surface
 * along its normal (a thousandth of the dab's radius) first, so a surface
 * never occludes itself and a grazing one does not speckle. Hidden poly groups
 * and hidden objects are not in the way. The eye is the real camera's, so the
 * mirrored dab of symmetry is tested the same way.
 *
 * Method. This is the same answer as a ray from each vertex to the eye
 * through the octree (the vendored `intersectRay`), which costs about 17
 * microseconds a vertex and so several times what the rest of a dab costs on
 * a million vertices. A pinhole camera sees every point of that ray at one
 * pixel, so the test is flat: does a triangle cover that pixel nearer than
 * the vertex? The screen is cut into tiles of 48 px. A tile, the first time a
 * dab reaches it, gathers (one walk of each octree, inside the pyramid from
 * the eye over the tile) the triangles that cover any of it and bins them by
 * the screen cells they overlap; a vertex then looks at the triangles of its
 * own cell only: a point in the triangle's screen shape, then the triangle's
 * depth there (1/w is linear across the shape). The tiles stay while a stroke
 * goes on with the camera and the objects where they are (the geometry does
 * not change in a Project stroke), so a dab pays only for the tiles it
 * newly reaches.
 */

interface Cell {
  _children: Cell[];
  _aabbLoose: ArrayLike<number>;
  _iFaces: ArrayLike<number>;
}

/** An object's vertices on screen (x, y, w), valid while `seen[v]` is the stroke's epoch. */
interface Screen {
  xyw: Float32Array;
  seen: Uint32Array;
}

interface Tile {
  /** The tile's corner on screen, px. */
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  /** Cells to the pixel. */
  icw: number;
  ich: number;
  head: Int32Array<ArrayBuffer>;
  /** The deepest vertex (w) this tile's triangles were gathered for. */
  wLimit: number;
}

const TILE = 48;
/** The most triangle-to-cell entries kept in a stroke's tiles before they are made again (a few tens of MB). */
const KEEP = 4_000_000;

interface Stroke {
  key: Float64Array | null;
  epoch: number;
  tiles: Array<Tile | undefined>;
  tilesX: number;
  tilesY: number;
  screens: Map<object, Screen>;
  nTri: number;
  nEnt: number;
}

let stroke: Stroke = fresh();
let triV: Int32Array<ArrayBuffer> = new Int32Array(3 * 4096);
let triS: Int32Array<ArrayBuffer> = new Int32Array(4096);
let triBox: Float32Array<ArrayBuffer> = new Float32Array(4 * 4096);
let entTri: Int32Array<ArrayBuffer> = new Int32Array(8192);
let entNext: Int32Array<ArrayBuffer> = new Int32Array(8192);
let epochNo = 0;

function fresh(): Stroke {
  return { key: null, epoch: ++epochNo, tiles: [], tilesX: 0, tilesY: 0, screens: new Map(), nTri: 0, nEnt: 0 };
}

/** Forget the tiles (a stroke is over). */
export function releaseOcclusion(): void {
  stroke = fresh();
}

function grow(a: Int32Array<ArrayBuffer>, need: number): Int32Array<ArrayBuffer> {
  if (a.length >= need) return a;
  const b = new Int32Array(Math.max(need, a.length * 2));
  b.set(a);
  return b;
}

/**
 * For each of `ids` (vertices of `mesh`), 1 when the camera cannot see it.
 * `radius` is the dab's radius in the object's own space (it sets the lift).
 */
export function hiddenFromCamera(session: SculptSession, mesh: SculptMesh, ids: ArrayLike<number>, radius: number): Uint8Array {
  const count = ids.length;
  const out = new Uint8Array(count);
  if (!count) return out;
  const cam = session.getCamera();
  const eye = cam.eye();
  const S = cam.screenMatrix();
  const H = cam.canvasHeight();
  const W = cam.canvasWidth();
  const ex = eye[0];
  const ey = eye[1];
  const ez = eye[2];

  const own = mesh;
  const targets: SculptMesh[] = [own];
  for (const m of session.getMeshes()) if (m !== own && m.isVisible()) targets.push(m);

  // The tiles are good while the camera and the objects stand as they were.
  const key = new Float64Array(16 + targets.length * 17);
  for (let i = 0; i < 16; i++) key[i] = S[i];
  targets.forEach((m, t) => {
    const mm = m.getMatrix();
    for (let i = 0; i < 16; i++) key[16 + t * 17 + i] = mm[i];
    key[16 + t * 17 + 16] = m.getNbFaces();
  });
  const same = stroke.key && stroke.key.length === key.length && stroke.key.every((v, i) => v === key[i]);
  if (!same || stroke.nEnt > KEEP) {
    stroke = fresh();
    stroke.key = key;
  }
  const st = stroke;
  const tilesX = Math.ceil(W / TILE);
  const tilesY = Math.ceil(H / TILE);
  if (st.tilesX !== tilesX || st.tilesY !== tilesY) {
    st.tilesX = tilesX;
    st.tilesY = tilesY;
    st.tiles = new Array(tilesX * tilesY);
  }

  const M = own.getMatrix();
  const vAr = own.getVertices();
  const nAr = own.getNormals();
  const lift = Math.max(radius, 1e-9) * 1e-3 * own.getScale();

  // The candidates: the lifted starting point's place on screen and its depth.
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  const sw = new Float32Array(count);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let wMax = 0;
  for (let i = 0; i < count; i++) {
    const v = ids[i];
    const lx = vAr[v * 3];
    const ly = vAr[v * 3 + 1];
    const lz = vAr[v * 3 + 2];
    const nx = nAr[v * 3];
    const ny = nAr[v * 3 + 1];
    const nz = nAr[v * 3 + 2];
    let gx = M[0] * nx + M[4] * ny + M[8] * nz;
    let gy = M[1] * nx + M[5] * ny + M[9] * nz;
    let gz = M[2] * nx + M[6] * ny + M[10] * nz;
    const k = lift / (Math.sqrt(gx * gx + gy * gy + gz * gz) || 1);
    gx *= k;
    gy *= k;
    gz *= k;
    const wx = M[0] * lx + M[4] * ly + M[8] * lz + M[12] + gx;
    const wy = M[1] * lx + M[5] * ly + M[9] * lz + M[13] + gy;
    const wz = M[2] * lx + M[6] * ly + M[10] * lz + M[14] + gz;
    const w = S[3] * wx + S[7] * wy + S[11] * wz + S[15];
    const px = (S[0] * wx + S[4] * wy + S[8] * wz + S[12]) / w;
    const py = H - (S[1] * wx + S[5] * wy + S[9] * wz + S[13]) / w;
    sx[i] = px;
    sy[i] = py;
    sw[i] = w;
    if (w <= 1e-9 || px < 0 || py < 0 || px >= W || py >= H) continue;
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
    if (w > wMax) wMax = w;
  }
  if (x1 < x0) return out;

  // The tiles the dab reaches; those not made yet (or made for a shallower dab) are made now.
  const wLimit = wMax * 1.03;
  const tx0 = Math.max(0, Math.floor((x0 - 1) / TILE));
  const tx1 = Math.min(tilesX - 1, Math.floor((x1 + 1) / TILE));
  const ty0 = Math.max(0, Math.floor((y0 - 1) / TILE));
  const ty1 = Math.min(tilesY - 1, Math.floor((y1 + 1) / TILE));
  const SM = mat4.create();
  const slots = new Map<SculptMesh, Screen>();
  for (const m of targets) {
    const n = m.getNbVertices();
    let c = st.screens.get(m);
    if (!c || c.seen.length < n) {
      c = { xyw: new Float32Array(n * 3), seen: new Uint32Array(n) };
      st.screens.set(m, c);
    }
    slots.set(m, c);
  }

  const buildTile = (tx: number, ty: number): Tile => {
    const tileX0 = tx * TILE;
    const tileY0 = ty * TILE;
    const tileX1 = tileX0 + TILE;
    const tileY1 = tileY0 + TILE;
    // The pyramid from the eye over the tile, as four planes, in world space.
    const corners: Array<[number, number, number]> = [];
    for (const [px, py] of [[tileX0 - 1, tileY0 - 1], [tileX1 + 1, tileY0 - 1], [tileX1 + 1, tileY1 + 1], [tileX0 - 1, tileY1 + 1]]) {
      const p = cam.unproject(px, py, 0);
      corners.push([p[0] - ex, p[1] - ey, p[2] - ez]);
    }
    const mid = [0, 0, 0];
    for (const c of corners) for (let k = 0; k < 3; k++) mid[k] += c[k];
    const planes: number[][] = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      let n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] < 0) n = n.map((x) => -x);
      planes.push(n);
    }
    const t0 = st.nTri;
    let nTri = t0;
    for (let slot = 0; slot < targets.length; slot++) {
      const m = targets[slot];
      const Mt = m.getMatrix() as unknown as mat4;
      mat4.multiply(SM, S as unknown as mat4, Mt);
      const inv = mat4.create();
      mat4.invert(inv, Mt);
      const el = [
        inv[0] * ex + inv[4] * ey + inv[8] * ez + inv[12],
        inv[1] * ex + inv[5] * ey + inv[9] * ez + inv[13],
        inv[2] * ex + inv[6] * ey + inv[10] * ez + inv[14],
      ];
      const pl = planes.map((n) => [
        Mt[0] * n[0] + Mt[1] * n[1] + Mt[2] * n[2],
        Mt[4] * n[0] + Mt[5] * n[1] + Mt[6] * n[2],
        Mt[8] * n[0] + Mt[9] * n[1] + Mt[10] * n[2],
      ]);
      const mv = m.getVertices();
      const mf = m.getFaces();
      const nv = m.getNbVertices();
      const scr = slots.get(m)!;
      const xyw = scr.xyw;
      const seen = scr.seen;
      const epoch = st.epoch;
      const hidden = Picking.hiddenFaces?.(m) ?? null;
      const root = (m as unknown as { _meshData?: { _octree?: Cell } })._meshData?._octree;
      if (!root) continue;
      const isOwn = slot === 0;
      const tri = Utils.TRI_INDEX;
      // The depth (w) as a linear function of the object's own coordinates, for the octree's boxes.
      const wa = SM[3];
      const wb = SM[7];
      const wc = SM[11];
      const wd = SM[15];

      const place = (v: number): void => {
        const o = v * 3;
        const lx = mv[o];
        const ly = mv[o + 1];
        const lz = mv[o + 2];
        const w = SM[3] * lx + SM[7] * ly + SM[11] * lz + SM[15];
        xyw[o] = (SM[0] * lx + SM[4] * ly + SM[8] * lz + SM[12]) / w;
        xyw[o + 1] = H - (SM[1] * lx + SM[5] * ly + SM[9] * lz + SM[13]) / w;
        xyw[o + 2] = w;
        seen[v] = epoch;
      };
      const addTri = (a: number, b: number, c: number): void => {
        if (seen[a] !== epoch) place(a);
        if (seen[b] !== epoch) place(b);
        if (seen[c] !== epoch) place(c);
        const w0 = xyw[a * 3 + 2];
        const w1 = xyw[b * 3 + 2];
        const w2 = xyw[c * 3 + 2];
        // Behind the eye, or nothing of it nearer than the deepest vertex: it hides nothing (a triangle across the eye's plane is passed by).
        if (w0 <= 1e-9 || w1 <= 1e-9 || w2 <= 1e-9) return;
        if (w0 > wLimit && w1 > wLimit && w2 > wLimit) return;
        const xa = xyw[a * 3];
        const xb = xyw[b * 3];
        const xc = xyw[c * 3];
        const ya = xyw[a * 3 + 1];
        const yb = xyw[b * 3 + 1];
        const yc = xyw[c * 3 + 1];
        let minx = xa;
        let maxx = xa;
        if (xb < minx) minx = xb;
        else if (xb > maxx) maxx = xb;
        if (xc < minx) minx = xc;
        else if (xc > maxx) maxx = xc;
        let miny = ya;
        let maxy = ya;
        if (yb < miny) miny = yb;
        else if (yb > maxy) maxy = yb;
        if (yc < miny) miny = yc;
        else if (yc > maxy) maxy = yc;
        if (maxx < tileX0 - 1e-3 || minx > tileX1 + 1e-3 || maxy < tileY0 - 1e-3 || miny > tileY1 + 1e-3) return;
        if (nTri * 3 + 3 > triV.length) {
          triV = grow(triV, nTri * 3 + 3);
          triS = grow(triS, nTri + 1);
          const bigger = new Float32Array((triV.length / 3) * 4);
          bigger.set(triBox);
          triBox = bigger;
        }
        triV[nTri * 3] = a;
        triV[nTri * 3 + 1] = b;
        triV[nTri * 3 + 2] = c;
        triS[nTri] = (slot << 1) | (isOwn ? 1 : 0);
        triBox[nTri * 4] = minx;
        triBox[nTri * 4 + 1] = maxx;
        triBox[nTri * 4 + 2] = miny;
        triBox[nTri * 4 + 3] = maxy;
        nTri++;
      };

      // One walk of the octree: only the boxes inside the pyramid and not entirely deeper than the dab's deepest vertex.
      const stack: Cell[] = [root];
      while (stack.length) {
        const cell = stack.pop()!;
        const bb = cell._aabbLoose;
        let outside = false;
        for (let p = 0; p < 4 && !outside; p++) {
          const n = pl[p];
          const px = n[0] >= 0 ? bb[3] : bb[0];
          const py = n[1] >= 0 ? bb[4] : bb[1];
          const pz = n[2] >= 0 ? bb[5] : bb[2];
          if (n[0] * (px - el[0]) + n[1] * (py - el[1]) + n[2] * (pz - el[2]) < 0) outside = true;
        }
        if (outside) continue;
        const wmin = wd + (wa >= 0 ? wa * bb[0] : wa * bb[3]) + (wb >= 0 ? wb * bb[1] : wb * bb[4]) + (wc >= 0 ? wc * bb[2] : wc * bb[5]);
        if (wmin > wLimit) continue;
        const kids = cell._children;
        if (kids.length === 8) {
          for (let i = 0; i < 8; i++) stack.push(kids[i]);
          continue;
        }
        const faces = cell._iFaces;
        for (let i = 0; i < faces.length; i++) {
          const f = faces[i];
          if (hidden && hidden[f]) continue;
          const k = f * 4;
          const a = mf[k];
          const b = mf[k + 1];
          const c = mf[k + 2];
          const q = mf[k + 3];
          addTri(a, b, c);
          if (q !== tri && q < nv) addTri(a, c, q);
        }
      }
    }

    // The tile's grid: a cell about half a triangle on screen (at least 0.4 px; the tile is made once, the test of a vertex is the cost that stays), the triangles binned by the cells they cover.
    let mean = 0;
    for (let t = t0; t < nTri; t++) mean += triBox[t * 4 + 1] - triBox[t * 4] + triBox[t * 4 + 3] - triBox[t * 4 + 2];
    const cell = Math.max(0.4, nTri > t0 ? mean / (4 * (nTri - t0)) : 1);
    const nx = Math.max(1, Math.min(120, Math.ceil(TILE / cell)));
    const ny = nx;
    const icw = nx / TILE;
    const ich = ny / TILE;
    const head = new Int32Array(nx * ny).fill(-1);
    let nEnt = st.nEnt;
    for (let t = t0; t < nTri; t++) {
      const cx0 = Math.max(0, Math.floor((triBox[t * 4] - 1e-3 - tileX0) * icw));
      const cx1 = Math.min(nx - 1, Math.floor((triBox[t * 4 + 1] + 1e-3 - tileX0) * icw));
      const cy0 = Math.max(0, Math.floor((triBox[t * 4 + 2] - 1e-3 - tileY0) * ich));
      const cy1 = Math.min(ny - 1, Math.floor((triBox[t * 4 + 3] + 1e-3 - tileY0) * ich));
      if (cx0 > cx1 || cy0 > cy1) continue;
      const need = nEnt + (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
      if (need > entTri.length) {
        entTri = grow(entTri, need);
        entNext = grow(entNext, need);
      }
      for (let yy = cy0; yy <= cy1; yy++) {
        for (let xx = cx0; xx <= cx1; xx++) {
          const h = yy * nx + xx;
          entTri[nEnt] = t;
          entNext[nEnt] = head[h];
          head[h] = nEnt++;
        }
      }
    }
    st.nTri = nTri;
    st.nEnt = nEnt;
    return { x0: tileX0, y0: tileY0, nx, ny, icw, ich, head, wLimit };
  };

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const old = st.tiles[ty * tilesX + tx];
      if (!old || old.wLimit < wMax) st.tiles[ty * tilesX + tx] = buildTile(tx, ty);
    }
  }

  // Each vertex against the triangles of its own cell.
  const EPS = 1e-3;
  const screensOf = targets.map((m) => slots.get(m)!.xyw);
  for (let i = 0; i < count; i++) {
    const px = sx[i];
    const py = sy[i];
    if (sw[i] <= 1e-9 || px < 0 || py < 0 || px >= W || py >= H) continue;
    const tile = st.tiles[Math.min(tilesY - 1, Math.floor(py / TILE)) * tilesX + Math.min(tilesX - 1, Math.floor(px / TILE))];
    if (!tile) continue;
    const cxi = Math.min(tile.nx - 1, Math.max(0, Math.floor((px - tile.x0) * tile.icw)));
    const cyi = Math.min(tile.ny - 1, Math.max(0, Math.floor((py - tile.y0) * tile.ich)));
    const invO = 1 / sw[i];
    const v = ids[i];
    for (let e = tile.head[cyi * tile.nx + cxi]; e >= 0; e = entNext[e]) {
      const t = entTri[e];
      const a = triV[t * 3];
      const b = triV[t * 3 + 1];
      const c = triV[t * 3 + 2];
      const flags = triS[t];
      if ((flags & 1) !== 0 && (a === v || b === v || c === v)) continue;
      const xyw = screensOf[flags >> 1];
      const xa = xyw[a * 3];
      const ya = xyw[a * 3 + 1];
      const e1x = xyw[b * 3] - xa;
      const e1y = xyw[b * 3 + 1] - ya;
      const e2x = xyw[c * 3] - xa;
      const e2y = xyw[c * 3 + 1] - ya;
      const d = e1x * e2y - e2x * e1y;
      if (d > -1e-12 && d < 1e-12) continue;
      const rx = px - xa;
      const ry = py - ya;
      const id = 1 / d;
      const b1 = (rx * e2y - e2x * ry) * id;
      const b2 = (e1x * ry - rx * e1y) * id;
      const b0 = 1 - b1 - b2;
      if (b0 < -EPS || b1 < -EPS || b2 < -EPS) continue;
      // Perspective-correct depth: 1/w is linear across the triangle's shape on screen.
      const inv = b0 / xyw[a * 3 + 2] + b1 / xyw[b * 3 + 2] + b2 / xyw[c * 3 + 2];
      if (inv > invO * (1 + 2e-6)) {
        out[i] = 1;
        break;
      }
    }
  }
  return out;
}
