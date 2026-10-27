import Utils from '@sculpt-vendor/misc/Utils';
import type { SculptMesh } from '@sculpt-vendor/mesh/Mesh';

/**
 * The Smooth brush's Surface mode (owner call, 2026-10-24: an option,
 * Average stays the default). On a voxel-remeshed mesh the umbrella
 * average of the Average mode reads the connectivity, not the form: edge
 * lengths vary, and poles of valence 3 and 5 to 8 pull their average
 * sideways and in or out, so a smoothed patch keeps small bumps and dents
 * at the poles. Surface mode reads the form instead. Per vertex in the
 * dab:
 *
 * 1. Neighbours by distance, not by edge rings: the points within
 *    r = SURFACE_K * (the vertex's mean ring edge length), from a uniform
 *    grid built once per dab over the dab's vertices plus a margin. Fewer
 *    than SURFACE_MIN_PTS found: r grows by SURFACE_GROW, at most
 *    SURFACE_GROW_STEPS times. More than SURFACE_MAX_PTS: the nearest
 *    SURFACE_MAX_PTS are kept. A neighbour whose vertex normal faces away
 *    from the vertex's (dot <= 0) is the other side of a thin wall and is
 *    left out. The vertex itself is left out too, as the umbrella
 *    average leaves it out: the surface is the one its neighbours
 *    describe.
 * 2. Weights: a Gaussian, (exp(-q^2) - exp(-1)) / (1 - exp(-1)), q = d / h,
 *    h the search radius (or, when capped, 1.15 x the farthest kept
 *    point), evaluated as its quadratic in q^2 (KERNEL_B): zero at the
 *    support's edge, so a point entering or leaving it changes nothing at
 *    once. (Wendland's (1 - q)^4 (4q + 1) was tried: it gives
 *    the farther half of the points so little weight that the fit,
 *    six coefficients on what is left, follows the noise.)
 * 3. A weighted PCA plane: the weighted centroid and covariance, the
 *    normal the covariance's smallest eigenvector (closed form for a
 *    symmetric 3x3), turned to agree with the vertex normal. When the
 *    smallest eigenvalue is over SURFACE_PLANAR of the middle one, the
 *    points are no plane and the vertex normal stands in.
 * 4. A weighted least-squares height field over that plane,
 *    h(u, v) = a u^2 + b uv + c v^2 + d u + e v + f (in units of h, by a
 *    6x6 Cholesky), or the plane itself when the fit is ill-conditioned:
 *    fewer than 6 neighbours, a spread whose middle-to-largest
 *    eigenvalue ratio is under SURFACE_SPREAD (all in a line), or a
 *    Cholesky pivot ratio past SURFACE_COND.
 * 5. The target is the vertex moved along the plane normal onto the
 *    fitted surface (held to h); the vertex moves toward it by
 *    s = min(1, intensity) * mask * alpha, the Average mode's weight.
 * 6. A light tangential relax after: each vertex moves within its tangent
 *    plane (the fitted normal) toward the area-weighted centroid of its
 *    one-ring faces, by relax * s, so the triangles even out without the
 *    surface leaving its form. Boundary vertices are not relaxed.
 *
 * Both passes are Jacobi: every target is computed from the positions as
 * they were, then all are written. The fit reads `field`: the current
 * positions, or the stroke-start proxy for vertices this stroke has
 * touched when the tool does not accumulate. All scratch is held here and
 * grown, never shrunk; nothing is precomputed over the mesh.
 */
export const SURFACE_K = 3;
export const SURFACE_MIN_PTS = 12;
export const SURFACE_MAX_PTS = 30;
export const SURFACE_GROW = 1.3;
export const SURFACE_GROW_STEPS = 2;
export const SURFACE_PLANAR = 0.5;
export const SURFACE_SPREAD = 0.05;
export const SURFACE_COND = 1e8;
/** The kernel's support when the neighbour count is capped, past the farthest kept point. */
export const SURFACE_CAP_SUPPORT = 1.15;
/** The grid's cell count is held to this; past it the cells grow. */
export const SURFACE_MAX_CELLS = 1048576;
/** The Relax slider's default. */
export const SURFACE_RELAX = 0.25;

/** The mesh arrays the smoother reads (the vendored Mesh facade). */
interface RingMesh extends SculptMesh {
  getVerticesRingVertStartCount(): Uint32Array;
  getVerticesRingVert(): Uint32Array | number[][];
  getVerticesRingFaceStartCount(): Uint32Array;
  getVerticesRingFace(): Uint32Array | number[][];
  getVerticesOnEdge(): Uint8Array;
  getVerticesStateFlags(): Uint32Array;
  intersectSphere(c: number[], r2: number, collectLeaves: boolean): Uint32Array;
  getVerticesFromFaces(iFaces: Uint32Array): Uint32Array;
}

const TRI = Utils.TRI_INDEX;
/**
 * The kernel, in x = q^2: (1 - x)(1 - KERNEL_B x), which is the Gaussian
 * (exp(-x) - exp(-1)) / (1 - exp(-1)) to within 0.01 over [0, 1] (the
 * two agree at 0, 1/2 and 1), without an exp or a square root per point.
 */
const KERNEL_B = 0.488;

function growF64(a: Float64Array<ArrayBuffer>, n: number): Float64Array<ArrayBuffer> {
  return a.length >= n ? a : new Float64Array(Math.ceil(n * 1.5) + 64);
}
function growI32(a: Int32Array<ArrayBuffer>, n: number): Int32Array<ArrayBuffer> {
  return a.length >= n ? a : new Int32Array(Math.ceil(n * 1.5) + 64);
}

/** What one dab did, for the tests and the parity fixtures. */
export interface SurfaceDabStats {
  vertices: number;
  gathered: number;
  quadric: number;
  plane: number;
  normalFallback: number;
  meanNeighbours: number;
  ms: number;
}

export class SurfaceSmoother {
  // Per dab vertex.
  private lbar = new Float64Array(0);
  private out = new Float64Array(0);
  private nrm = new Float64Array(0);
  private step = new Float64Array(0);
  // The gathered set and its grid.
  private gIds = new Int32Array(0);
  private gPos = new Float64Array(0);
  private gNrm = new Float64Array(0);
  private cellOf = new Int32Array(0);
  private cellStart = new Int32Array(0);
  private cellItems = new Int32Array(0);
  // The gathered set again, in cell order (what the queries walk).
  private sIds = new Int32Array(0);
  private sPos = new Float64Array(0);
  private sNrm = new Float64Array(0);
  // One query's candidates.
  private cIdx = new Int32Array(0);
  private cD2 = new Float64Array(0);
  private cRel = new Float64Array(0);
  // The 6x6 system.
  private readonly A = new Float64Array(36);
  private readonly b = new Float64Array(6);
  private readonly sol = new Float64Array(6);
  /** smallestEigen's answer: l0, l1, l2, then the unit eigenvector of l0. */
  private readonly eig = new Float64Array(6);

  /** The last dab's counts (cheap; read by the tests). */
  last: SurfaceDabStats | null = null;

  /**
   * One dab over `iVerts` (the dab's vertices, already pushed for undo).
   * `center` and `radius` are the dab's (local); `alpha` is the picking's
   * stencil weight at a point; `useProxy` reads the stroke-start positions
   * for the fit.
   */
  run(
    mesh: SculptMesh,
    iVerts: Uint32Array,
    intensity: number,
    center: number[],
    radius: number,
    alpha: (x: number, y: number, z: number) => number,
    useProxy: boolean,
    relax: number,
  ): void {
    const t0 = performance.now();
    const m = mesh as RingMesh;
    const nb = iVerts.length;
    if (!nb) return;
    const vAr = m.getVertices();
    const nAr = m.getNormals();
    const mAr = m.getMaterials();
    const proxy = m.getVerticesProxy();
    const flags = m.getVerticesStateFlags();
    const stateFlag = (Utils as unknown as { STATE_FLAG: number }).STATE_FLAG;
    const readProxy = useProxy && proxy !== vAr;
    const fieldOf = (id: number): Float32Array => (readProxy && flags[id] === stateFlag ? proxy : vAr);

    const vrvSC = m.getVerticesRingVertStartCount();
    const vrvAll = m.getVerticesRingVert();
    const ringVerts = vrvAll instanceof Array ? vrvAll : null;
    const vrfSC = m.getVerticesRingFaceStartCount();
    const vrfAll = m.getVerticesRingFace();
    const ringFaces = vrfAll instanceof Array ? vrfAll : null;
    const onEdge = m.getVerticesOnEdge();
    const fAr = m.getFaces();

    // 1. Each vertex's mean ring edge length, on the field.
    this.lbar = growF64(this.lbar, nb);
    const lbar = this.lbar;
    let lsum = 0;
    let lmax = 0;
    let lcount = 0;
    for (let i = 0; i < nb; ++i) {
      const id = iVerts[i];
      const F = fieldOf(id);
      const px = F[id * 3];
      const py = F[id * 3 + 1];
      const pz = F[id * 3 + 2];
      let ring: ArrayLike<number>;
      let s0: number;
      let s1: number;
      if (ringVerts) {
        ring = ringVerts[id];
        s0 = 0;
        s1 = ring.length;
      } else {
        ring = vrvAll as Uint32Array;
        s0 = vrvSC[id * 2];
        s1 = s0 + vrvSC[id * 2 + 1];
      }
      let sum = 0;
      for (let k = s0; k < s1; ++k) {
        const j = ring[k];
        const G = fieldOf(j);
        const ex = G[j * 3] - px;
        const ey = G[j * 3 + 1] - py;
        const ez = G[j * 3 + 2] - pz;
        sum += Math.sqrt(ex * ex + ey * ey + ez * ez);
      }
      const l = s1 > s0 ? sum / (s1 - s0) : 0;
      lbar[i] = l;
      if (l > 0) {
        lsum += l;
        lcount++;
        if (l > lmax) lmax = l;
      }
    }
    if (!lcount) return;
    const lmean = lsum / lcount;
    for (let i = 0; i < nb; ++i) if (!(lbar[i] > 0)) lbar[i] = lmean;

    // 2. The gathered set: the dab's sphere plus the widest search radius.
    const grow = Math.pow(SURFACE_GROW, SURFACE_GROW_STEPS);
    const margin = Math.min(radius, SURFACE_K * lmax * grow);
    const R = radius + margin;
    const R2 = R * R;
    const cx = center[0];
    const cy = center[1];
    const cz = center[2];
    const cand = m.getVerticesFromFaces(m.intersectSphere(center, R2, false));
    const nc = cand.length;
    this.gIds = growI32(this.gIds, nc);
    this.gPos = growF64(this.gPos, nc * 3);
    this.gNrm = growF64(this.gNrm, nc * 3);
    const gIds = this.gIds;
    const gPos = this.gPos;
    const gNrm = this.gNrm;
    let ng = 0;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bz0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    let bz1 = -Infinity;
    for (let k = 0; k < nc; ++k) {
      const id = cand[k];
      const j = id * 3;
      const dx = vAr[j] - cx;
      const dy = vAr[j + 1] - cy;
      const dz = vAr[j + 2] - cz;
      if (dx * dx + dy * dy + dz * dz >= R2) continue;
      const F = fieldOf(id);
      const x = F[j];
      const y = F[j + 1];
      const z = F[j + 2];
      gIds[ng] = id;
      gPos[ng * 3] = x;
      gPos[ng * 3 + 1] = y;
      gPos[ng * 3 + 2] = z;
      gNrm[ng * 3] = nAr[j];
      gNrm[ng * 3 + 1] = nAr[j + 1];
      gNrm[ng * 3 + 2] = nAr[j + 2];
      if (x < bx0) bx0 = x;
      if (y < by0) by0 = y;
      if (z < bz0) bz0 = z;
      if (x > bx1) bx1 = x;
      if (y > by1) by1 = y;
      if (z > bz1) bz1 = z;
      ng++;
    }

    // 3. The grid: cells of the mean search radius, counting-sorted.
    let cs = Math.max(SURFACE_K * lmean, 1e-12);
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (;;) {
      nx = Math.floor((bx1 - bx0) / cs) + 1;
      ny = Math.floor((by1 - by0) / cs) + 1;
      nz = Math.floor((bz1 - bz0) / cs) + 1;
      if (nx * ny * nz <= SURFACE_MAX_CELLS) break;
      cs *= 1.5;
    }
    const ncell = nx * ny * nz;
    this.cellStart = growI32(this.cellStart, ncell + 1);
    this.cellOf = growI32(this.cellOf, ng);
    this.cellItems = growI32(this.cellItems, ng);
    const cellStart = this.cellStart;
    const cellOf = this.cellOf;
    const cellItems = this.cellItems;
    cellStart.fill(0, 0, ncell + 1);
    const inv = 1 / cs;
    for (let g = 0; g < ng; ++g) {
      const ix = Math.min(nx - 1, Math.floor((gPos[g * 3] - bx0) * inv));
      const iy = Math.min(ny - 1, Math.floor((gPos[g * 3 + 1] - by0) * inv));
      const iz = Math.min(nz - 1, Math.floor((gPos[g * 3 + 2] - bz0) * inv));
      const c = ix + nx * (iy + ny * iz);
      cellOf[g] = c;
      cellStart[c + 1]++;
    }
    for (let c = 0; c < ncell; ++c) cellStart[c + 1] += cellStart[c];
    // Fill with a running cursor per cell (cellStart shifted back after).
    for (let g = 0; g < ng; ++g) cellItems[cellStart[cellOf[g]]++] = g;
    this.sIds = growI32(this.sIds, ng);
    this.sPos = growF64(this.sPos, ng * 3);
    this.sNrm = growF64(this.sNrm, ng * 3);
    const sIds = this.sIds;
    const sPos = this.sPos;
    const sNrm = this.sNrm;
    for (let k = 0; k < ng; ++k) {
      const g = cellItems[k];
      sIds[k] = gIds[g];
      sPos[k * 3] = gPos[g * 3];
      sPos[k * 3 + 1] = gPos[g * 3 + 1];
      sPos[k * 3 + 2] = gPos[g * 3 + 2];
      sNrm[k * 3] = gNrm[g * 3];
      sNrm[k * 3 + 1] = gNrm[g * 3 + 1];
      sNrm[k * 3 + 2] = gNrm[g * 3 + 2];
    }
    for (let c = ncell; c > 0; --c) cellStart[c] = cellStart[c - 1];
    cellStart[0] = 0;

    // 4. The fit, per dab vertex.
    this.out = growF64(this.out, nb * 3);
    this.nrm = growF64(this.nrm, nb * 3);
    this.step = growF64(this.step, nb);
    const out = this.out;
    const nrmOut = this.nrm;
    const stepOut = this.step;
    const strength = Math.min(1, intensity);
    const A = this.A;
    const bv = this.b;
    const sol = this.sol;
    let nQuad = 0;
    let nPlane = 0;
    let nNormalFb = 0;
    let neighbourSum = 0;

    for (let i = 0; i < nb; ++i) {
      const id = iVerts[i];
      const j3 = id * 3;
      const vx = vAr[j3];
      const vy = vAr[j3 + 1];
      const vz = vAr[j3 + 2];
      out[i * 3] = vx;
      out[i * 3 + 1] = vy;
      out[i * 3 + 2] = vz;
      stepOut[i] = 0;
      const s = strength * mAr[j3 + 2] * alpha(vx, vy, vz);
      // The vertex normal (unit), for orientation and the thin-wall test.
      let ux = nAr[j3];
      let uy = nAr[j3 + 1];
      let uz = nAr[j3 + 2];
      const ul = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (ul > 0) {
        ux /= ul;
        uy /= ul;
        uz /= ul;
      }
      nrmOut[i * 3] = ux;
      nrmOut[i * 3 + 1] = uy;
      nrmOut[i * 3 + 2] = uz;
      if (!(s > 0)) continue;
      const F = fieldOf(id);
      const qx = F[j3];
      const qy = F[j3 + 1];
      const qz = F[j3 + 2];

      // Neighbours within r, grown while too few.
      let r = SURFACE_K * lbar[i];
      let cnt = 0;
      for (let attempt = 0; ; attempt++) {
        cnt = this.query(qx, qy, qz, r, id, ux, uy, uz, ul > 0, bx0, by0, bz0, inv, nx, ny, nz);
        if (cnt >= SURFACE_MIN_PTS || attempt >= SURFACE_GROW_STEPS) break;
        r *= SURFACE_GROW;
      }
      const cIdx = this.cIdx;
      const cD2 = this.cD2;
      let h = r;
      if (cnt > SURFACE_MAX_PTS) {
        selectNearest(cIdx, cD2, cnt, SURFACE_MAX_PTS);
        cnt = SURFACE_MAX_PTS;
        let far = 0;
        for (let k = 0; k < cnt; ++k) if (cD2[k] > far) far = cD2[k];
        h = Math.sqrt(far) * SURFACE_CAP_SUPPORT;
      }
      neighbourSum += cnt;
      if (cnt < 3) continue; // nothing to fit: the vertex stays
      const ih = 1 / h;
      const ih2 = ih * ih;

      // The kept points about the vertex in units of h, contiguous, with
      // their weights; then the weighted centroid and covariance in one
      // pass (raw moments, centred after: the coordinates are O(1) here).
      this.cRel = growF64(this.cRel, cnt * 3);
      const rel = this.cRel;
      let sw = 0;
      let mx = 0;
      let my = 0;
      let mz = 0;
      let a00 = 0;
      let a01 = 0;
      let a02 = 0;
      let a11 = 0;
      let a12 = 0;
      let a22 = 0;
      for (let k = 0; k < cnt; ++k) {
        const x = cD2[k] * ih2;
        const w = x >= 1 ? 0 : (1 - x) * (1 - KERNEL_B * x);
        cD2[k] = w; // the weight from here on
        const g = cIdx[k] * 3;
        const px = (sPos[g] - qx) * ih;
        const py = (sPos[g + 1] - qy) * ih;
        const pz = (sPos[g + 2] - qz) * ih;
        rel[k * 3] = px;
        rel[k * 3 + 1] = py;
        rel[k * 3 + 2] = pz;
        sw += w;
        mx += w * px;
        my += w * py;
        mz += w * pz;
        a00 += w * px * px;
        a01 += w * px * py;
        a02 += w * px * pz;
        a11 += w * py * py;
        a12 += w * py * pz;
        a22 += w * pz * pz;
      }
      if (!(sw > 0)) continue;
      const isw = 1 / sw;
      mx *= isw;
      my *= isw;
      mz *= isw;
      a00 = a00 * isw - mx * mx;
      a01 = a01 * isw - mx * my;
      a02 = a02 * isw - mx * mz;
      a11 = a11 * isw - my * my;
      a12 = a12 * isw - my * mz;
      a22 = a22 * isw - mz * mz;
      const eig = this.eig;
      const hasEig = smallestEigen(a00, a01, a02, a11, a12, a22, eig);
      let nx3: number;
      let ny3: number;
      let nz3: number;
      let planar = false;
      if (hasEig && eig[0] <= SURFACE_PLANAR * eig[1]) {
        nx3 = eig[3];
        ny3 = eig[4];
        nz3 = eig[5];
        planar = true;
        if (ul > 0 && nx3 * ux + ny3 * uy + nz3 * uz < 0) {
          nx3 = -nx3;
          ny3 = -ny3;
          nz3 = -nz3;
        }
      } else if (ul > 0) {
        nx3 = ux;
        ny3 = uy;
        nz3 = uz;
        nNormalFb++;
      } else continue;
      // The tangent frame.
      let t1x: number;
      let t1y: number;
      let t1z: number;
      if (Math.abs(nx3) < 0.9) {
        // (1, 0, 0) made tangent
        t1x = 1 - nx3 * nx3;
        t1y = -nx3 * ny3;
        t1z = -nx3 * nz3;
      } else {
        t1x = -ny3 * nx3;
        t1y = 1 - ny3 * ny3;
        t1z = -ny3 * nz3;
      }
      const tl = 1 / Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z);
      t1x *= tl;
      t1y *= tl;
      t1z *= tl;
      const t2x = ny3 * t1z - nz3 * t1y;
      const t2y = nz3 * t1x - nx3 * t1z;
      const t2z = nx3 * t1y - ny3 * t1x;

      // The quadratic height field over the plane through the centroid.
      let quad = false;
      const spread = planar ? eig[1] / Math.max(eig[2], 1e-300) : 0;
      if (cnt >= 6 && spread >= SURFACE_SPREAD) {
        // The weighted moments of u, v up to the fourth order and of h
        // against the basis [u2, uv, v2, u, v, 1]: the normal equations'
        // 21 entries are 15 distinct moments.
        let m40 = 0;
        let m31 = 0;
        let m22 = 0;
        let m13 = 0;
        let m04 = 0;
        let m30 = 0;
        let m21 = 0;
        let m12 = 0;
        let m03 = 0;
        let m20 = 0;
        let m11 = 0;
        let m02 = 0;
        let m10 = 0;
        let m01 = 0;
        let m00 = 0;
        let b0 = 0;
        let b1 = 0;
        let b2 = 0;
        let b3 = 0;
        let b4 = 0;
        let b5 = 0;
        for (let k = 0; k < cnt; ++k) {
          const w = cD2[k];
          if (w <= 0) continue;
          const dx = rel[k * 3] - mx;
          const dy = rel[k * 3 + 1] - my;
          const dz = rel[k * 3 + 2] - mz;
          const u = dx * t1x + dy * t1y + dz * t1z;
          const v = dx * t2x + dy * t2y + dz * t2z;
          const wh = w * (dx * nx3 + dy * ny3 + dz * nz3);
          const wu = w * u;
          const wv = w * v;
          const wuu = wu * u;
          const wuv = wu * v;
          const wvv = wv * v;
          m00 += w;
          m10 += wu;
          m01 += wv;
          m20 += wuu;
          m11 += wuv;
          m02 += wvv;
          m30 += wuu * u;
          m21 += wuu * v;
          m12 += wvv * u;
          m03 += wvv * v;
          m40 += wuu * u * u;
          m31 += wuu * u * v;
          m22 += wuu * v * v;
          m13 += wvv * v * u;
          m04 += wvv * v * v;
          b0 += wh * u * u;
          b1 += wh * u * v;
          b2 += wh * v * v;
          b3 += wh * u;
          b4 += wh * v;
          b5 += wh;
        }
        // Upper triangle, row-major.
        A[0] = m40;
        A[1] = m31;
        A[2] = m22;
        A[3] = m30;
        A[4] = m21;
        A[5] = m20;
        A[7] = m22;
        A[8] = m13;
        A[9] = m21;
        A[10] = m12;
        A[11] = m11;
        A[14] = m04;
        A[15] = m12;
        A[16] = m03;
        A[17] = m02;
        A[21] = m20;
        A[22] = m11;
        A[23] = m10;
        A[28] = m02;
        A[29] = m01;
        A[35] = m00;
        bv[0] = b0;
        bv[1] = b1;
        bv[2] = b2;
        bv[3] = b3;
        bv[4] = b4;
        bv[5] = b5;
        quad = cholesky6(A, bv, sol);
      }
      // The current position in the frame (the move is applied to it, so
      // a proxy fit and a moved vertex still meet the surface under it).
      const cxh = (vx - qx) * ih - mx;
      const cyh = (vy - qy) * ih - my;
      const czh = (vz - qz) * ih - mz;
      const uc = cxh * t1x + cyh * t1y + czh * t1z;
      const vc = cxh * t2x + cyh * t2y + czh * t2z;
      const hc = cxh * nx3 + cyh * ny3 + czh * nz3;
      let ht = 0;
      if (quad) {
        ht = sol[0] * uc * uc + sol[1] * uc * vc + sol[2] * vc * vc + sol[3] * uc + sol[4] * vc + sol[5];
        nQuad++;
      } else nPlane++;
      let delta = ht - hc;
      if (delta > 1) delta = 1;
      else if (delta < -1) delta = -1;
      delta *= h * s;
      out[i * 3] = vx + nx3 * delta;
      out[i * 3 + 1] = vy + ny3 * delta;
      out[i * 3 + 2] = vz + nz3 * delta;
      nrmOut[i * 3] = nx3;
      nrmOut[i * 3 + 1] = ny3;
      nrmOut[i * 3 + 2] = nz3;
      stepOut[i] = s;
    }
    for (let i = 0; i < nb; ++i) {
      const j3 = iVerts[i] * 3;
      vAr[j3] = out[i * 3];
      vAr[j3 + 1] = out[i * 3 + 1];
      vAr[j3 + 2] = out[i * 3 + 2];
    }

    // 5. The tangential relax, on the positions just written.
    if (relax > 0) {
      for (let i = 0; i < nb; ++i) {
        const id = iVerts[i];
        const j3 = id * 3;
        const vx = vAr[j3];
        const vy = vAr[j3 + 1];
        const vz = vAr[j3 + 2];
        out[i * 3] = vx;
        out[i * 3 + 1] = vy;
        out[i * 3 + 2] = vz;
        const s = stepOut[i] * relax;
        if (!(s > 0) || onEdge[id] === 1) continue;
        let ring: ArrayLike<number>;
        let s0: number;
        let s1: number;
        if (ringFaces) {
          ring = ringFaces[id];
          s0 = 0;
          s1 = ring.length;
        } else {
          ring = vrfAll as Uint32Array;
          s0 = vrfSC[id * 2];
          s1 = s0 + vrfSC[id * 2 + 1];
        }
        let sa = 0;
        let gx = 0;
        let gy = 0;
        let gz = 0;
        for (let k = s0; k < s1; ++k) {
          const f = ring[k] * 4;
          const a = fAr[f] * 3;
          const b = fAr[f + 1] * 3;
          const c = fAr[f + 2] * 3;
          const d = fAr[f + 3];
          let ar = triArea(vAr, a, b, c);
          sa += ar;
          gx += (ar * (vAr[a] + vAr[b] + vAr[c])) / 3;
          gy += (ar * (vAr[a + 1] + vAr[b + 1] + vAr[c + 1])) / 3;
          gz += (ar * (vAr[a + 2] + vAr[b + 2] + vAr[c + 2])) / 3;
          if (d !== TRI) {
            const d3 = d * 3;
            ar = triArea(vAr, a, c, d3);
            sa += ar;
            gx += (ar * (vAr[a] + vAr[c] + vAr[d3])) / 3;
            gy += (ar * (vAr[a + 1] + vAr[c + 1] + vAr[d3 + 1])) / 3;
            gz += (ar * (vAr[a + 2] + vAr[c + 2] + vAr[d3 + 2])) / 3;
          }
        }
        if (!(sa > 0)) continue;
        let dx = gx / sa - vx;
        let dy = gy / sa - vy;
        let dz = gz / sa - vz;
        const n0 = nrmOut[i * 3];
        const n1 = nrmOut[i * 3 + 1];
        const n2 = nrmOut[i * 3 + 2];
        const dn = dx * n0 + dy * n1 + dz * n2;
        dx -= n0 * dn;
        dy -= n1 * dn;
        dz -= n2 * dn;
        out[i * 3] = vx + dx * s;
        out[i * 3 + 1] = vy + dy * s;
        out[i * 3 + 2] = vz + dz * s;
      }
      for (let i = 0; i < nb; ++i) {
        const j3 = iVerts[i] * 3;
        vAr[j3] = out[i * 3];
        vAr[j3 + 1] = out[i * 3 + 1];
        vAr[j3 + 2] = out[i * 3 + 2];
      }
    }
    this.last = {
      vertices: nb,
      gathered: ng,
      quadric: nQuad,
      plane: nPlane,
      normalFallback: nNormalFb,
      meanNeighbours: neighbourSum / nb,
      ms: performance.now() - t0,
    };
  }

  /**
   * The gathered points within r of q (not `self`, not facing away from
   * the unit normal u when `useNormal`): their indices into cIdx and their
   * squared distances into cD2. Returns the count.
   */
  private query(
    qx: number,
    qy: number,
    qz: number,
    r: number,
    self: number,
    ux: number,
    uy: number,
    uz: number,
    useNormal: boolean,
    bx0: number,
    by0: number,
    bz0: number,
    inv: number,
    nx: number,
    ny: number,
    nz: number,
  ): number {
    const r2 = r * r;
    const ix0 = Math.max(0, Math.floor((qx - r - bx0) * inv));
    const iy0 = Math.max(0, Math.floor((qy - r - by0) * inv));
    const iz0 = Math.max(0, Math.floor((qz - r - bz0) * inv));
    const ix1 = Math.min(nx - 1, Math.floor((qx + r - bx0) * inv));
    const iy1 = Math.min(ny - 1, Math.floor((qy + r - by0) * inv));
    const iz1 = Math.min(nz - 1, Math.floor((qz + r - bz0) * inv));
    const sPos = this.sPos;
    const sNrm = this.sNrm;
    const sIds = this.sIds;
    const cellStart = this.cellStart;
    let cnt = 0;
    for (let iz = iz0; iz <= iz1; ++iz) {
      for (let iy = iy0; iy <= iy1; ++iy) {
        const row = nx * (iy + ny * iz);
        for (let ix = ix0; ix <= ix1; ++ix) {
          const c = row + ix;
          for (let k = cellStart[c], e = cellStart[c + 1]; k < e; ++k) {
            const g3 = k * 3;
            const dx = sPos[g3] - qx;
            const dy = sPos[g3 + 1] - qy;
            const dz = sPos[g3 + 2] - qz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 >= r2 || sIds[k] === self) continue;
            if (useNormal && sNrm[g3] * ux + sNrm[g3 + 1] * uy + sNrm[g3 + 2] * uz <= 0) continue;
            if (cnt >= this.cIdx.length) {
              const ni = new Int32Array(cnt * 2 + 64);
              ni.set(this.cIdx);
              this.cIdx = ni;
              const nd = new Float64Array(cnt * 2 + 64);
              nd.set(this.cD2);
              this.cD2 = nd;
            }
            this.cIdx[cnt] = k;
            this.cD2[cnt] = d2;
            cnt++;
          }
        }
      }
    }
    return cnt;
  }
}

function triArea(v: Float32Array, a: number, b: number, c: number): number {
  const ux = v[b] - v[a];
  const uy = v[b + 1] - v[a + 1];
  const uz = v[b + 2] - v[a + 2];
  const wx = v[c] - v[a];
  const wy = v[c + 1] - v[a + 1];
  const wz = v[c + 2] - v[a + 2];
  const cx = uy * wz - uz * wy;
  const cy = uz * wx - ux * wz;
  const cz = ux * wy - uy * wx;
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/** Partial sort (quickselect): the k smallest d2 to the front of (idx, d2). */
function selectNearest(idx: Int32Array, d2: Float64Array, n: number, k: number): void {
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = d2[(lo + hi) >> 1];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (d2[i] < pivot) i++;
      while (d2[j] > pivot) j--;
      if (i <= j) {
        const td = d2[i];
        d2[i] = d2[j];
        d2[j] = td;
        const ti = idx[i];
        idx[i] = idx[j];
        idx[j] = ti;
        i++;
        j--;
      }
    }
    if (k - 1 <= j) hi = j;
    else if (k - 1 >= i) lo = i;
    else break;
  }
}

/**
 * The eigenvalues of a symmetric 3x3 (closed form, l0 <= l1 <= l2) and the
 * unit eigenvector of the smallest, into `out` as [l0, l1, l2, x, y, z];
 * false when it is not defined (a zero matrix, or a repeated smallest
 * eigenvalue).
 */
function smallestEigen(
  a00: number,
  a01: number,
  a02: number,
  a11: number,
  a12: number,
  a22: number,
  out: Float64Array,
): boolean {
  const p1 = a01 * a01 + a02 * a02 + a12 * a12;
  const q = (a00 + a11 + a22) / 3;
  let l0: number;
  let l1: number;
  let l2: number;
  if (p1 <= 1e-30 * (a00 * a00 + a11 * a11 + a22 * a22 + 1e-300)) {
    l0 = Math.min(a00, a11, a22);
    l2 = Math.max(a00, a11, a22);
    l1 = a00 + a11 + a22 - l0 - l2;
  } else {
    const b00 = a00 - q;
    const b11 = a11 - q;
    const b22 = a22 - q;
    const p2 = b00 * b00 + b11 * b11 + b22 * b22 + 2 * p1;
    const p = Math.sqrt(p2 / 6);
    const ip = 1 / p;
    const c00 = b00 * ip;
    const c11 = b11 * ip;
    const c22 = b22 * ip;
    const c01 = a01 * ip;
    const c02 = a02 * ip;
    const c12 = a12 * ip;
    let r = (c00 * (c11 * c22 - c12 * c12) - c01 * (c01 * c22 - c12 * c02) + c02 * (c01 * c12 - c11 * c02)) / 2;
    if (r < -1) r = -1;
    else if (r > 1) r = 1;
    const phi = Math.acos(r) / 3;
    l2 = q + 2 * p * Math.cos(phi);
    l0 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
    l1 = 3 * q - l0 - l2;
  }
  if (!(l2 > 0)) return false;
  // The smallest's eigenvector: the largest cross product of two rows of A - l0 I.
  const r0x = a00 - l0;
  const r0y = a01;
  const r0z = a02;
  const r1x = a01;
  const r1y = a11 - l0;
  const r1z = a12;
  const r2x = a02;
  const r2y = a12;
  const r2z = a22 - l0;
  const ax = r0y * r1z - r0z * r1y;
  const ay = r0z * r1x - r0x * r1z;
  const az = r0x * r1y - r0y * r1x;
  const bx = r0y * r2z - r0z * r2y;
  const by = r0z * r2x - r0x * r2z;
  const bz = r0x * r2y - r0y * r2x;
  const cx = r1y * r2z - r1z * r2y;
  const cy = r1z * r2x - r1x * r2z;
  const cz = r1x * r2y - r1y * r2x;
  const da = ax * ax + ay * ay + az * az;
  const db = bx * bx + by * by + bz * bz;
  const dc = cx * cx + cy * cy + cz * cz;
  let x: number;
  let y: number;
  let z: number;
  let d: number;
  if (da >= db && da >= dc) {
    x = ax;
    y = ay;
    z = az;
    d = da;
  } else if (db >= dc) {
    x = bx;
    y = by;
    z = bz;
    d = db;
  } else {
    x = cx;
    y = cy;
    z = cz;
    d = dc;
  }
  if (!(d > 1e-24 * l2 * l2 * l2 * l2)) return false;
  const il = 1 / Math.sqrt(d);
  out[0] = l0;
  out[1] = l1;
  out[2] = l2;
  out[3] = x * il;
  out[4] = y * il;
  out[5] = z * il;
  return true;
}

/**
 * Solve the 6x6 symmetric system (upper triangle of A, row-major) by
 * Cholesky into `x`. False when a pivot is not positive or the pivots'
 * ratio passes SURFACE_COND (the condition number it stands in for).
 */
function cholesky6(A: Float64Array, b: Float64Array, x: Float64Array): boolean {
  // Mirror the upper triangle.
  for (let i = 0; i < 6; ++i) for (let j = 0; j < i; ++j) A[i * 6 + j] = A[j * 6 + i];
  let pmax = 0;
  let pmin = Infinity;
  for (let j = 0; j < 6; ++j) {
    let s = A[j * 6 + j];
    for (let k = 0; k < j; ++k) s -= A[j * 6 + k] * A[j * 6 + k];
    if (!(s > 0)) return false;
    if (s > pmax) pmax = s;
    if (s < pmin) pmin = s;
    const l = Math.sqrt(s);
    A[j * 6 + j] = l;
    for (let i = j + 1; i < 6; ++i) {
      let t = A[i * 6 + j];
      for (let k = 0; k < j; ++k) t -= A[i * 6 + k] * A[j * 6 + k];
      A[i * 6 + j] = t / l;
    }
  }
  if (pmax > SURFACE_COND * pmin) return false;
  for (let i = 0; i < 6; ++i) {
    let s = b[i];
    for (let k = 0; k < i; ++k) s -= A[i * 6 + k] * x[k];
    x[i] = s / A[i * 6 + i];
  }
  for (let i = 5; i >= 0; --i) {
    let s = x[i];
    for (let k = i + 1; k < 6; ++k) s -= A[k * 6 + i] * x[k];
    x[i] = s / A[i * 6 + i];
  }
  return true;
}
