// Poly groups for the base-mesh library's remeshed blockouts, from the
// lumps they were remeshed from.
//
//   node tools/basemesh-groups.mjs [--check] [--dir <folder>] [id ...]
//
// tools/export-basemeshes.py voxel-remeshes each "primitive" figure of
// Blender Studio's Human Base Meshes (CC0), fifty-odd separate lumps, into
// one closed shell (<id>.bzm), and keeps the lumps as they were in a
// second file (<id>-parts.bzm), named for people ("Upper arm L"). The
// shell itself remembers nothing of the lumps. This tool gives it back
// their names as poly groups: each face of the shell goes to the lump
// whose surface is nearest its centre, then each group keeps its largest
// connected piece, the stray faces at the creases between lumps going to
// the group they border most. A lump that leaves fewer than MIN_FACES
// faces on the surface (an eye under a 7 mm remesh is a face or two) has
// no group, its faces going to the group they border most, and a left and
// right pair goes together, so the two sides always match. The groups are written into
// the shell's file as its group section (BZM1's optional 'GRPS' trailer,
// src/sculpt/bridge/basemeshes.ts), which a reader from before it ignores.
//
// tools/export-basemeshes.py runs this after it writes the shells (when
// node is on the PATH; otherwise run it by hand after the export), so a
// re-export keeps the groups.
//
// With --check it only reports what it would write; --dir reads and writes
// another folder than public/assets/basemeshes.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
let dir = join(here, '..', 'public', 'assets', 'basemeshes');
const TRI16 = 0xffff;
const TRI32 = 0xffffffff;
/** Fewer faces than this on the surface, and a lump (with its other side) has no group. */
const MIN_FACES = 10;

/** The parts of a .bzm file, and where its parts end (the trailer starts). */
export function readBzm(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(...buf.subarray(0, 4));
  if (magic !== 'BZM1') throw new Error('not a .bzm file');
  const count = dv.getUint32(8, true);
  let off = 16;
  const parts = [];
  for (let p = 0; p < count; p++) {
    const nameLen = dv.getUint32(off, true);
    off += 4;
    const name = new TextDecoder().decode(buf.subarray(off, off + nameLen));
    off += nameLen + ((4 - (nameLen % 4)) % 4);
    const nVerts = dv.getUint32(off, true);
    const nFaces = dv.getUint32(off + 4, true);
    const ib = dv.getUint32(off + 8, true);
    off += 12;
    const offset = [dv.getFloat32(off, true), dv.getFloat32(off + 4, true), dv.getFloat32(off + 8, true)];
    off += 12;
    const positions = new Float32Array(nVerts * 3);
    for (let i = 0; i < nVerts * 3; i++) positions[i] = dv.getFloat32(off + i * 4, true);
    off += nVerts * 12;
    const faces = new Uint32Array(nFaces * 4);
    for (let i = 0; i < nFaces * 4; i++) {
      const v = ib === 2 ? dv.getUint16(off + i * 2, true) : dv.getUint32(off + i * 4, true);
      faces[i] = (ib === 2 && v === TRI16) || v === TRI32 ? TRI32 : v;
    }
    off += nFaces * 4 * ib;
    off += (4 - (off % 4)) % 4;
    parts.push({ name, offset, positions, faces });
  }
  return { parts, end: off };
}

/** The trailer: 'GRPS' u32 1 u32 partCount, then per part u32 nGroups, names, u32 indexBytes, indices. */
export function groupsTrailer(perPart) {
  const chunks = [];
  const u32 = (...xs) => {
    const b = new Uint8Array(xs.length * 4);
    const dv = new DataView(b.buffer);
    xs.forEach((x, i) => dv.setUint32(i * 4, x, true));
    chunks.push(b);
  };
  const pad = (n) => {
    if (n % 4) chunks.push(new Uint8Array(4 - (n % 4)));
  };
  chunks.push(new TextEncoder().encode('GRPS'));
  u32(1, perPart.length);
  for (const g of perPart) {
    if (!g) {
      u32(0);
      continue;
    }
    u32(g.names.length);
    for (const n of g.names) {
      const b = new TextEncoder().encode(n);
      u32(b.length);
      chunks.push(b);
      pad(b.length);
    }
    const ib = g.names.length <= 256 ? 1 : 2;
    u32(ib);
    const idx = ib === 1 ? Uint8Array.from(g.faces) : new Uint8Array(Uint16Array.from(g.faces).buffer);
    chunks.push(idx);
    pad(idx.length);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Squared distance from p to triangle abc (Ericson, Real-Time Collision Detection 5.1.5). */
function triDist2(px, py, pz, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = px - a[0], apy = py - a[1], apz = pz - a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  const d = (x, y, z) => (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
  if (d1 <= 0 && d2 <= 0) return d(a[0], a[1], a[2]);
  const bpx = px - b[0], bpy = py - b[1], bpz = pz - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return d(b[0], b[1], b[2]);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return d(a[0] + v * abx, a[1] + v * aby, a[2] + v * abz);
  }
  const cpx = px - c[0], cpy = py - c[1], cpz = pz - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return d(c[0], c[1], c[2]);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return d(a[0] + w * acx, a[1] + w * acy, a[2] + w * acz);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return d(b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2]));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return d(a[0] + abx * v + acx * w, a[1] + aby * v + acy * w, a[2] + abz * v + acz * w);
}

/** Every lump's triangles in the shared frame, with the lump each came from, in a uniform grid. */
function lumpGrid(lumps, cell) {
  const tris = [];
  lumps.forEach((p, li) => {
    const P = (i) => [p.positions[i * 3] + p.offset[0], p.positions[i * 3 + 1] + p.offset[1], p.positions[i * 3 + 2] + p.offset[2]];
    for (let f = 0; f < p.faces.length / 4; f++) {
      const q = p.faces.subarray(f * 4, f * 4 + 4);
      tris.push([P(q[0]), P(q[1]), P(q[2]), li]);
      if (q[3] !== TRI32) tris.push([P(q[0]), P(q[2]), P(q[3]), li]);
    }
  });
  const grid = new Map();
  const key = (i, j, k) => `${i},${j},${k}`;
  tris.forEach((t, n) => {
    const lo = [0, 1, 2].map((a) => Math.floor(Math.min(t[0][a], t[1][a], t[2][a]) / cell));
    const hi = [0, 1, 2].map((a) => Math.floor(Math.max(t[0][a], t[1][a], t[2][a]) / cell));
    for (let i = lo[0]; i <= hi[0]; i++)
      for (let j = lo[1]; j <= hi[1]; j++)
        for (let k = lo[2]; k <= hi[2]; k++) {
          const kk = key(i, j, k);
          let list = grid.get(kk);
          if (!list) grid.set(kk, (list = []));
          list.push(n);
        }
  });
  /** The lump nearest p, and the distance: rings of cells outward until the best is closer than the next ring. */
  const nearest = (x, y, z) => {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    let best = Infinity;
    let lump = -1;
    const seen = new Set();
    for (let r = 0; r < 64; r++) {
      for (let i = ci - r; i <= ci + r; i++)
        for (let j = cj - r; j <= cj + r; j++)
          for (let k = ck - r; k <= ck + r; k++) {
            if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== r) continue;
            const list = grid.get(key(i, j, k));
            if (!list) continue;
            for (const n of list) {
              if (seen.has(n)) continue;
              seen.add(n);
              const t = tris[n];
              const d2 = triDist2(x, y, z, t[0], t[1], t[2]);
              if (d2 < best) {
                best = d2;
                lump = t[3];
              }
            }
          }
      if (lump >= 0 && Math.sqrt(best) <= r * cell) break;
    }
    return { lump, dist: Math.sqrt(best) };
  };
  return nearest;
}

/** Each face's neighbour across each edge (-1 open), four a face. */
function neighbours(faces) {
  const n = faces.length / 4;
  const nb = new Int32Array(n * 4).fill(-1);
  const edges = new Map();
  for (let f = 0; f < n; f++) {
    const m = faces[f * 4 + 3] === TRI32 ? 3 : 4;
    for (let k = 0; k < m; k++) {
      const a = faces[f * 4 + k];
      const b = faces[f * 4 + ((k + 1) % m)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const o = edges.get(key);
      if (o === undefined) edges.set(key, f * 4 + k);
      else {
        nb[f * 4 + k] = o >> 2;
        nb[o] = f;
      }
    }
  }
  return nb;
}

/**
 * Each group's largest connected piece kept; every other piece joins the
 * group it borders most, until nothing moves.
 */
function onePieceEach(labels, nb) {
  const n = labels.length;
  for (let pass = 0; pass < 20; pass++) {
    const comp = new Int32Array(n).fill(-1);
    const sizes = [];
    const compLabel = [];
    const stack = [];
    for (let s = 0; s < n; s++) {
      if (comp[s] >= 0) continue;
      const c = sizes.length;
      sizes.push(0);
      compLabel.push(labels[s]);
      comp[s] = c;
      stack.push(s);
      while (stack.length) {
        const f = stack.pop();
        sizes[c]++;
        for (let k = 0; k < 4; k++) {
          const o = nb[f * 4 + k];
          if (o >= 0 && comp[o] < 0 && labels[o] === labels[f]) {
            comp[o] = c;
            stack.push(o);
          }
        }
      }
    }
    const biggest = new Map();
    sizes.forEach((sz, c) => {
      const l = compLabel[c];
      if (!biggest.has(l) || sizes[biggest.get(l)] < sz) biggest.set(l, c);
    });
    let moved = 0;
    const border = new Map();
    for (let f = 0; f < n; f++) {
      const c = comp[f];
      if (biggest.get(compLabel[c]) === c) continue;
      for (let k = 0; k < 4; k++) {
        const o = nb[f * 4 + k];
        if (o < 0 || comp[o] === c) continue;
        let m = border.get(c);
        if (!m) border.set(c, (m = new Map()));
        m.set(labels[o], (m.get(labels[o]) ?? 0) + 1);
      }
    }
    for (let f = 0; f < n; f++) {
      const m = border.get(comp[f]);
      if (!m) continue;
      let best = -1;
      let bestN = -1;
      for (const [l, cnt] of m) if (cnt > bestN || (cnt === bestN && l < best)) [best, bestN] = [l, cnt];
      if (best >= 0 && best !== labels[f]) {
        labels[f] = best;
        moved++;
      }
    }
    if (!moved) break;
  }
}

/** The shell's groups from its lumps: names in lump order (those with faces), one index a face. */
export function shellGroups(shell, lumps) {
  // Both files centre their whole on its bounding box; the shell's grows
  // a little all round in the remesh, so the centres agree.
  const nearest = lumpGrid(lumps, 0.02);
  const sp = shell.positions;
  const sf = shell.faces;
  const n = sf.length / 4;
  const labels = new Int32Array(n);
  let far = 0;
  let sum = 0;
  for (let f = 0; f < n; f++) {
    const m = sf[f * 4 + 3] === TRI32 ? 3 : 4;
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < m; k++) {
      const v = sf[f * 4 + k];
      x += sp[v * 3];
      y += sp[v * 3 + 1];
      z += sp[v * 3 + 2];
    }
    const r = nearest(x / m + shell.offset[0], y / m + shell.offset[1], z / m + shell.offset[2]);
    labels[f] = r.lump;
    sum += r.dist;
    far = Math.max(far, r.dist);
  }
  const nb = neighbours(sf);
  onePieceEach(labels, nb);
  // Too small to be worth a group: the lump and its other side, into
  // what they border most.
  const count = new Map();
  for (const l of labels) count.set(l, (count.get(l) ?? 0) + 1);
  const side = (name) => name.replace(/ [LR]$/, '');
  const small = new Set();
  lumps.forEach((p, i) => {
    const pair = lumps.map((q, j) => j).filter((j) => side(lumps[j].name) === side(p.name) && /( [LR])$/.test(lumps[j].name) === /( [LR])$/.test(p.name));
    if (pair.some((j) => (count.get(j) ?? 0) < MIN_FACES)) small.add(i);
  });
  for (let pass = 0; pass < 50; pass++) {
    let left = 0;
    const next = Int32Array.from(labels);
    for (let f = 0; f < n; f++) {
      if (!small.has(labels[f])) continue;
      left++;
      const tally = new Map();
      for (let k = 0; k < 4; k++) {
        const o = nb[f * 4 + k];
        if (o >= 0 && !small.has(labels[o])) tally.set(labels[o], (tally.get(labels[o]) ?? 0) + 1);
      }
      let best = -1;
      let bestN = 0;
      for (const [l, c] of tally) if (c > bestN || (c === bestN && l < best)) [best, bestN] = [l, c];
      if (best >= 0) next[f] = best;
    }
    labels.set(next);
    if (!left) break;
  }
  const used = [...new Set(labels)].sort((a, b) => a - b);
  const to = new Map(used.map((l, i) => [l, i]));
  const faces = Uint32Array.from(labels, (l) => to.get(l));
  const counts = new Array(used.length).fill(0);
  for (const g of faces) counts[g]++;
  return { names: used.map((l) => lumps[l].name), faces, counts, meanMm: (sum / n) * 1000, farMm: far * 1000, missing: lumps.filter((_, i) => !to.has(i)).map((p) => p.name) };
}

const SHELLS = ['blockout-male-realistic', 'blockout-female-realistic', 'blockout-male-stylized', 'blockout-female-stylized', 'head-blockout'];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const at = args.indexOf('--dir');
  if (at >= 0) dir = args.splice(at, 2)[1];
  const ids = args.filter((a) => !a.startsWith('--'));
  for (const id of ids.length ? ids : SHELLS) {
    const path = join(dir, `${id}.bzm`);
    const buf = readFileSync(path);
    const shell = readBzm(buf);
    const lumps = readBzm(readFileSync(join(dir, `${id}-parts.bzm`))).parts;
    const t0 = performance.now();
    const g = shellGroups(shell.parts[0], lumps);
    const ms = performance.now() - t0;
    console.log(`${id}: ${g.names.length} groups of ${lumps.length} lumps, ${g.faces.length} faces, centre to lump ${g.meanMm.toFixed(1)} mm mean, ${g.farMm.toFixed(1)} mm worst (${ms.toFixed(0)} ms)`);
    console.log('    ' + g.names.map((nm, i) => `${nm} ${g.counts[i]}`).join(', '));
    if (g.missing.length) console.log(`    no faces on the surface: ${g.missing.join(', ')}`);
    if (check) continue;
    const trailer = groupsTrailer(shell.parts.map((_, i) => (i === 0 ? g : null)));
    const out = new Uint8Array(shell.end + trailer.length);
    out.set(buf.subarray(0, shell.end));
    out.set(trailer, shell.end);
    writeFileSync(path, out);
    console.log(`    wrote ${path} (${(out.length / 1024).toFixed(0)} KB, groups ${(trailer.length / 1024).toFixed(0)} KB)`);
  }
}
