import Utils from '@sculpt-vendor/misc/Utils';

/**
 * The edges of a sculpt mesh as the mesh has them - a quad is four edges,
 * not the five its two triangles would draw - for the wireframe overlay
 * (owner request: quads drawn as quads).
 *
 * Every interior edge is walked twice, once from each face, and a boundary
 * edge once. Rather than a hash set, which is slow for the millions of edge
 * slots a top multires level has, the directed edges are bucketed by their
 * lower vertex in two counting passes and each bucket, a handful of
 * entries, is deduplicated in place. Linear in the number of faces, and no
 * topology tables are needed - the dynamic-topology mesh keeps none.
 *
 * Returns a flat index of vertex pairs, two per edge, for a LineSegments.
 */
export function faceEdges(faces: Uint32Array | Int32Array, nbFaces: number, nbVertices: number): Uint32Array {
  const TRI = Utils.TRI_INDEX;
  // Pass 1: how many directed edges start at each lower vertex.
  const count = new Uint32Array(nbVertices + 1);
  let slots = 0;
  for (let f = 0; f < nbFaces; f++) {
    const o = f * 4;
    const a = faces[o];
    const b = faces[o + 1];
    const c = faces[o + 2];
    const d = faces[o + 3];
    const n = d === TRI ? 3 : 4;
    count[a < b ? a : b]++;
    count[b < c ? b : c]++;
    if (n === 3) {
      count[c < a ? c : a]++;
    } else {
      count[c < d ? c : d]++;
      count[d < a ? d : a]++;
    }
    slots += n;
  }
  // Bucket starts, by prefix sum; `fill` walks each bucket as it is filled.
  const start = new Uint32Array(nbVertices + 1);
  let acc = 0;
  for (let v = 0; v < nbVertices; v++) {
    start[v] = acc;
    acc += count[v];
  }
  start[nbVertices] = acc;
  const fill = start.slice(0, nbVertices);
  const hi = new Uint32Array(slots);
  const put = (a: number, b: number): void => {
    if (a < b) hi[fill[a]++] = b;
    else hi[fill[b]++] = a;
  };
  for (let f = 0; f < nbFaces; f++) {
    const o = f * 4;
    const a = faces[o];
    const b = faces[o + 1];
    const c = faces[o + 2];
    const d = faces[o + 3];
    put(a, b);
    put(b, c);
    if (d === TRI) {
      put(c, a);
    } else {
      put(c, d);
      put(d, a);
    }
  }
  // Pass 2: each bucket in place, dropping the repeats; buckets are the
  // vertex's valence, a handful, so the inner scan is cheap.
  let edges = 0;
  for (let v = 0; v < nbVertices; v++) {
    const s = start[v];
    const e = start[v + 1];
    let kept = s;
    for (let i = s; i < e; i++) {
      const h = hi[i];
      let seen = false;
      for (let j = s; j < kept; j++) {
        if (hi[j] === h) {
          seen = true;
          break;
        }
      }
      if (!seen) hi[kept++] = h;
    }
    count[v] = kept - s; // reused: unique edges from v
    edges += kept - s;
  }
  const out = new Uint32Array(edges * 2);
  let w = 0;
  for (let v = 0; v < nbVertices; v++) {
    const s = start[v];
    const e = s + count[v];
    for (let i = s; i < e; i++) {
      out[w++] = v;
      out[w++] = hi[i];
    }
  }
  return out;
}
