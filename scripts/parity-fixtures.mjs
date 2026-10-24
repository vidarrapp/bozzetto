#!/usr/bin/env node
// Parity fixtures for the sculpt brushes: records, per brush x mesh, the
// web engine's exact input, dabs and output, so a port of the brushes can
// be tested against it. See docs/parity-fixtures.md.
//
//   node scripts/parity-fixtures.mjs [outDir]            record (default scratchpad/parity)
//   node scripts/parity-fixtures.mjs [outDir] --verify   re-run and compare to outDir
//   options: --tol=1e-6 (verify tolerance), --only=<brush>[,<brush>] (subset),
//            --outputs (verify the meshes out and the dabs only, not the
//            parameter records and meta: for a change that renames knobs
//            but must not move a vertex)
//
// Runs under plain Node: the vendored SculptGL core is render-less (its
// Mesh has no GL buffers here), so the real sources - SculptSession with
// its tool table, the bridge brushes, the vendored tools, Picking - are
// bundled with esbuild (already installed: wrangler depends on it, and
// Vite 8 takes it as a peer) and driven directly. The few browser globals
// the modules touch are stubbed below. The camera is a fixed,
// double-precision orthographic one (the engine only ever calls
// project/unproject on it), so nothing depends on a viewport or a GPU.
//
// No randomness and no wall clock: two runs write identical files.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));

// --- arguments ---------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (const a of argv) {
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    flags.set(k, v ?? true);
  } else positional.push(a);
}
if (flags.has('help')) {
  console.log('usage: node scripts/parity-fixtures.mjs [outDir] [--verify [--outputs]] [--tol=1e-6] [--only=Brush,...]');
  process.exit(0);
}
const outDir = resolve(positional[0] ?? join(repo, 'scratchpad', 'parity'));
const verify = flags.has('verify');
const tol = flags.has('tol') ? Number(flags.get('tol')) : 1e-6;
const only = typeof flags.get('only') === 'string' ? new Set(flags.get('only').split(',')) : null;
const outputsOnly = flags.has('outputs');

// --- browser globals the modules touch ---------------------------------------

function installGlobals() {
  globalThis.window ??= globalThis;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// --- the engine, bundled from source -----------------------------------------

async function loadEngine() {
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    throw new Error('esbuild not found (it comes with wrangler): run npm ci');
  }
  const entry = `
    export { SculptSession } from './src/sculpt/bridge/SculptSession';
    export { DynamicsStore } from './src/sculpt/bridge/dynamics';
    export { default as Multimesh } from '@sculpt-vendor/mesh/multiresolution/Multimesh';
    export { default as Subdivision } from '@sculpt-vendor/editing/Subdivision';
    export { default as Picking } from '@sculpt-vendor/math3d/Picking';
    export { default as Tablet } from '@sculpt-vendor/misc/Tablet';
    export { default as Enums } from '@sculpt-vendor/misc/Enums';
    export { default as Utils } from '@sculpt-vendor/misc/Utils';
  `;
  const dir = mkdtempSync(join(tmpdir(), 'bozzetto-parity-'));
  const outfile = join(dir, 'engine.mjs');
  try {
    await esbuild.build({
      stdin: { contents: entry, resolveDir: repo, loader: 'ts', sourcefile: 'parity-entry.ts' },
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'es2022',
      outfile,
      tsconfig: join(repo, 'tsconfig.json'),
      alias: { '@sculpt-vendor': join(repo, 'src/sculpt/vendor') },
      loader: { '.png': 'empty', '.css': 'empty', '.svg': 'empty' },
      logLevel: 'error',
    });
    installGlobals();
    // Multimesh.addLevel times itself on the console; keep the output ours.
    const { time, timeEnd } = console;
    console.time = () => {};
    console.timeEnd = () => {};
    const mod = await import(pathToFileURL(outfile).href);
    return { ...mod, restoreConsole: () => Object.assign(console, { time, timeEnd }) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- the fixed camera --------------------------------------------------------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const xform = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

/**
 * Orthographic, in doubles: screen x right, y down (device px, as the
 * engine's mouse coordinates), depth z in [0, 1] along the view direction.
 * The engine reads only project() and unproject() (CameraAdapter's surface).
 */
class OrthoCamera {
  constructor({ width, height, target, viewDir, up, pixelSize, depthRange }) {
    this.width = width;
    this.height = height;
    this.target = target;
    this.d = norm(viewDir);
    this.r = norm(cross(this.d, up));
    this.u = cross(this.r, this.d);
    this.s = pixelSize;
    this.depth = depthRange;
  }
  unproject(x, y, z) {
    const a = (x - this.width / 2) * this.s;
    const b = (this.height / 2 - y) * this.s;
    const c = (z - 0.5) * this.depth;
    const { target: o, r, u, d } = this;
    return [o[0] + a * r[0] + b * u[0] + c * d[0], o[1] + a * r[1] + b * u[1] + c * d[1], o[2] + a * r[2] + b * u[2] + c * d[2]];
  }
  project(v) {
    const rel = sub(v, this.target);
    return [this.width / 2 + dot(rel, this.r) / this.s, this.height / 2 - dot(rel, this.u) / this.s, 0.5 + dot(rel, this.d) / this.depth];
  }
  describe() {
    return {
      kind: 'orthographic',
      width: this.width,
      height: this.height,
      target: this.target,
      viewDirection: this.d,
      right: this.r,
      up: this.u,
      pixelSize: this.s,
      depthRange: this.depth,
      unproject: 'world = target + (x - width/2)*pixelSize*right + (height/2 - y)*pixelSize*up + (z - 0.5)*depthRange*viewDirection',
    };
  }
}

// --- meshes ------------------------------------------------------------------

const CANVAS = { width: 1024, height: 768 };
const VIEW_DIR = [-0.25, -0.2, -1];
/** Pen pressure per dab (the press is always neutral, 0.5). */
const PRESSURES = [0.5, 0.65, 0.8, 0.4, 0.5];

const MESHES = {
  cube: {
    construction:
      "SculptSession's 8-vertex quad cube (buildQuadCubeBase, the base of both Sphere and Cube) in a Multimesh, two Multimesh.addLevel() with Subdivision.LINEAR = true (the Cube primitive's own linear rule, so the corners stay), added with addNewMesh. Identity matrix.",
    build(E, session) {
      const mesh = new E.Multimesh(session.buildQuadCubeBase());
      E.Subdivision.LINEAR = true;
      mesh.addLevel();
      mesh.addLevel();
      E.Subdivision.LINEAR = false;
      session.addNewMesh(mesh);
      return mesh;
    },
    // Across the front face (z = 0.5) and over its right edge.
    path: [
      [-0.3, -0.12, 0.5],
      [-0.12, -0.05, 0.5],
      [0.05, 0.02, 0.5],
      [0.2, 0.08, 0.5],
      [0.32, 0.12, 0.5],
      [0.44, 0.16, 0.5],
    ],
    radiusOfExtent: 0.3,
  },
  sphere: {
    construction:
      "SculptSession.addSphere() (the app's default sphere: the quad cube, Catmull-Clark, on real units 25 cm tall in its vertices (one unit a centimetre), centred on its origin, its matrix the lift onto the floor), then deleteHighestLevel() once, leaving the 6144-quad level selected.",
    build(E, session) {
      const mesh = session.addSphere();
      session.deleteHighestLevel();
      return mesh;
    },
    // On the front of the sphere, given as unit directions from its centre.
    sphericalPath: [
      [-0.35, -0.15, 1],
      [-0.2, -0.08, 1],
      [-0.05, 0.0, 1],
      [0.1, 0.07, 1],
      [0.25, 0.13, 1],
      [0.4, 0.2, 1],
    ],
    radiusOfExtent: 0.3,
  },
  plane: {
    construction:
      "SculptSession.addPrimitive('plane') (three's PlaneGeometry(1.6, 1.6, 24, 24) welded into triangles, upright facing +z, on real units 50 cm across in its vertices (one unit a centimetre), centred on its origin, its matrix the lift onto the floor), then deleteHighestLevel() three times, leaving level 0: all triangles, with a boundary.",
    build(E, session) {
      const mesh = session.addPrimitive('plane');
      while (session.deleteHighestLevel());
      return mesh;
    },
    // From inside the plane to its right boundary, on a plane 1.6 across
    // (three's own size): scaled to the plane as built (pathSpan).
    pathSpan: 1.6,
    path: [
      [0.1, -0.05, 0],
      [0.25, 0.02, 0],
      [0.4, 0.08, 0],
      [0.55, 0.14, 0],
      [0.68, 0.19, 0],
      [0.78, 0.24, 0],
    ],
    radiusOfExtent: 0.3,
  },
};

function localBounds(mesh) {
  const v = mesh.getVertices();
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0, n = mesh.getNbVertices() * 3; i < n; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], v[i + k]);
      hi[k] = Math.max(hi[k], v[i + k]);
    }
  }
  return { lo, hi };
}

/** A fixed two-tone colour across the mesh (split at the local centre's x), so the blur has an edge to blur. */
function paintTwoTone(mesh) {
  const { lo, hi } = localBounds(mesh);
  const cx = (lo[0] + hi[0]) / 2;
  const v = mesh.getVertices();
  const c = mesh.getColors();
  for (let i = 0, n = mesh.getNbVertices() * 3; i < n; i += 3) {
    const left = v[i] < cx;
    c[i] = left ? 0.8 : 0.2;
    c[i + 1] = left ? 0.3 : 0.4;
    c[i + 2] = left ? 0.2 : 0.9;
  }
  mesh.updateDuplicateColorsAndMaterials();
}

// --- brushes -----------------------------------------------------------------

/**
 * The brushes, by the tool slot SculptSession installs them in. `mode`
 * says how a dab is driven (see drive()).
 */
const BRUSHES = [
  { name: 'ClayStripsBrush', tool: 'BRUSH', bridge: true, mode: 'dab' },
  { name: 'CreaseBrush', tool: 'CREASE', bridge: true, mode: 'dab' },
  { name: 'PolishBrush', tool: 'TWIST', bridge: true, mode: 'dab' },
  { name: 'VolumetricMove', tool: 'MOVE', bridge: true, mode: 'move' },
  { name: 'StableSmooth', tool: 'SMOOTH', bridge: true, mode: 'dab' },
  { name: 'RakeBrush', tool: 'RAKE', bridge: true, mode: 'dab' },
  { name: 'PaintBlurBrush', tool: 'PAINT_BLUR', bridge: true, mode: 'dab', colors: true },
  { name: 'FlattenBrush', tool: 'FLATTEN', bridge: true, mode: 'dab' },
  { name: 'Inflate', tool: 'INFLATE', mode: 'dab' },
  { name: 'Pinch', tool: 'PINCH', mode: 'dab' },
  { name: 'Drag', tool: 'DRAG', mode: 'drag' },
  { name: 'PaintBrush', tool: 'PAINT', bridge: true, mode: 'dab', colors: true },
  { name: 'Masking', tool: 'MASKING', mode: 'dab', mask: true },
];

const ENTRY_POINTS = {
  dab:
    'Press: SculptManager.start(false) (SculptBase.start: picking.intersectionMouseMeshes, setOrUnsetMesh, picking.initAlpha, pushState, startSculpt, which makes no dab at zero distance). Each dab: Tablet.pressure set, SculptManager.preUpdate(), then the per-dab body of SculptBase.sculptStroke: tool.makeStroke(mouseX, mouseY, picking, null) (intersectionMouseMesh, pickVerticesInSphere(rLocal2), computePickedNormal, tool.stroke(picking)) and tool.updateRender(); tool._lastMouseX/Y = the dab. That is exactly what sculptStroke does when the pointer moved between 1x and 2x the dab spacing. Release: SculptManager.end() (octree rebalance), StateManager.cleanNoop().',
  move:
    'Press: SculptManager.start(false) (Move.startSculpt -> initMoveData: pickVerticesInSphereTopological, vProxy = positions at the press). Each pointer move: Tablet.pressure set, SculptManager.preUpdate() (a no-op mid-stroke for Move), SculptManager.update() -> Move.sculptStroke: copyVerticesProxy (positions back to the press copy), updateMoveDir, move(), updateGeometry. Release: SculptManager.end(), StateManager.cleanNoop().',
  drag:
    'Press: SculptManager.start(false) (startSculpt -> Drag.sculptStroke at zero distance: one makeStroke at the press). Each pointer move: Tablet.pressure set, SculptManager.preUpdate() (a no-op mid-stroke for Drag), SculptManager.update() -> Drag.sculptStroke, which runs makeStroke from the LAST mouse position, floor(dist / (0.15 * _radius)) times (moves here are 0.2 * _radius px, so once each). Drag.makeStroke: updateDragDir (intersection slides to the closest point on the current ray; dir = new - old), pickVerticesInSphere, computePickedNormal, Drag.stroke. Release: SculptManager.end(), StateManager.cleanNoop().',
};

/** Parameter fields recorded for every tool, when the tool has them. */
const PARAM_FIELDS = [
  '_radius',
  '_intensity',
  '_hardness',
  '_negative',
  '_clay',
  '_culling',
  '_accumulate',
  '_lockPosition',
  '_idAlpha',
  '_spacing',
  '_tangent',
  '_topoCheck',
  '_thickness',
  '_color',
  '_material',
  '_writeAlbedo',
  '_writeRoughness',
  '_writeMetalness',
  '_pickColor',
  'layer',
  'gain',
  'planeLock',
  'pinch',
  'falloffPow',
  // The tine rake.
  'tines',
  'tineWidth',
  'depth',
  'plateau',
  'taper',
  'invert',
  'presetId',
];

/**
 * A tool's profile curve (src/sculpt/bridge/profile.ts): the preset its
 * anchors are exactly (null once edited), the Bezier anchors with their
 * handles (the scene file's curvesRev 2 form), whether the preset's exact
 * kernel stands in for the table, and the baked table.
 */
function curveRecord(curve) {
  return {
    preset: curve.presetId,
    anchors: curve.serialize().anchors,
    exactKernel: curve.exactKernel,
    table: Array.from(curve.lut),
  };
}

function toolParams(tool) {
  const out = {};
  for (const f of PARAM_FIELDS) {
    if (!(f in tool)) continue;
    const v = tool[f];
    if (typeof v === 'function') continue; // Pinch.pinch, Crease.crease: methods, not settings
    out[f] = ArrayBuffer.isView(v) ? Array.from(v) : v === undefined ? null : v;
  }
  if (tool.curve && typeof tool.curve.serialize === 'function') out.curve = curveRecord(tool.curve);
  return out;
}

/**
 * What the app does to the tools past SculptSession's constructor, which
 * cannot run here (it lives in DOM-bound code): mirrored, one line per
 * source, and recorded in each file.
 */
function appInstall(E, session) {
  const m = session.getSculptManager();
  const T = E.Enums.Tools;
  const dynamics = new E.DynamicsStore(() => m.getToolIndex());
  dynamics.install(); // InputShell.install
  m.getTool(T.CREASE)._negative = false; // InputShell.install: raised ridge by default
  const paint = m.getTool(T.PAINT);
  paint._writeRoughness = false; // mode.ts: paint owns colour only
  paint._writeMetalness = false;
  m.getTool(T.BRUSH)._clay = true; // InputShell.selectBrush(BRUSH)
  m._symmetry = false; // symmetry off for the fixtures
  return dynamics;
}

const APP_INSTALL_NOTES = [
  'SculptSession constructor: the tool table (VolumetricMove, ClayStripsBrush, PolishBrush in the TWIST slot, RakeBrush, CreaseBrush, FlattenBrush, PaintBrush, PaintBlurBrush, StableSmooth; PaintBrush._spacing = 0.05; PaintBlurBrush.curve = PaintBrush.curve, one shared object).',
  'InputShell.install: DynamicsStore.install() (per-brush pressure: Crease and Paint size 1 strength 1, Drag 0/0, the rest size 0 strength 1, linear curves; Tablet.getPressureLayer for the clay layer); Crease._negative = false. InputShell.feedPressure: Tablet.pen = true for a pen event (here, every press and move).',
  'mode.ts: Paint._writeRoughness = Paint._writeMetalness = false.',
  'InputShell.selectBrush(BRUSH): _clay = true (already the default).',
  'PaintBlur is the shift swap over Paint (InputShell): it takes Paint._radius and _intensity at the press, and reads Paint\'s own profile curve.',
  'Masking is the ctrl swap: _negative = !altKey = true (masks).',
  'World-scale sizing (worldScale.ts) puts every brush, stand-ins included, on one world radius at mount; here each tool._radius (px) is set so that radius is radiusOfExtent * the mesh world extent on the fixed camera.',
  'Symmetry off (SculptManager._symmetry = false). Dynamic topology off (Multimesh, static).',
];

// --- recording helpers -------------------------------------------------------

const arr = (a) => Array.from(a);
const f32 = (a, n) => Array.from(a.subarray(0, n));

function snapshotMesh(mesh) {
  const nv = mesh.getNbVertices();
  return {
    positions: f32(mesh.getVertices(), nv * 3),
    normals: f32(mesh.getNormals(), nv * 3),
    colors: f32(mesh.getColors(), nv * 3),
    materials: f32(mesh.getMaterials(), nv * 3),
  };
}

function uniformTriples(a) {
  for (let i = 3; i < a.length; i++) if (a[i] !== a[i % 3]) return null;
  return a.slice(0, 3);
}

function gitInfo() {
  const run = (c) => {
    try {
      return execSync(c, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  return {
    webCommit: run('git rev-parse HEAD'),
    date: run('git log -1 --format=%cI'),
    webDirty: (run('git status --porcelain --untracked-files=no') ?? '') !== '',
  };
}

/** Numeric constants declared at the top level of the bridge tools (STRIPS_*, POLISH_*, CREASE_*, ...). */
function bridgeConstants() {
  const src = readFileSync(join(repo, 'src/sculpt/bridge/tools.ts'), 'utf8');
  const out = {};
  for (const m of src.matchAll(/^const ([A-Z][A-Z0-9_]*) = (-?[0-9.]+(?:e-?[0-9]+)?);/gm)) out[m[1]] = Number(m[2]);
  return out;
}

// --- one brush on one mesh -----------------------------------------------------

async function record(E, meshKey, brush) {
  const spec = MESHES[meshKey];
  const T = E.Enums.Tools;
  const index = T[brush.tool];
  const canvas = { width: CANVAS.width, height: CANVAS.height, clientWidth: CANVAS.width, style: {} };
  // The camera is placed once the mesh exists; the session only stores it.
  const camHolder = { cam: null };
  const camera = {
    project: (v) => camHolder.cam.project(v),
    unproject: (x, y, z) => camHolder.cam.unproject(x, y, z),
  };
  const session = new E.SculptSession(camera, canvas, () => {});
  const dynamics = appInstall(E, session);
  try {
    const mesh = spec.build(E, session);
    session.clearHistory();
    paintTwoTone(mesh);

    const matrix = arr(mesh.getMatrix());
    const scale = mesh.getScale();
    const { lo, hi } = localBounds(mesh);
    const wlo = xform(matrix, lo);
    const whi = xform(matrix, hi);
    const extent = Math.max(whi[0] - wlo[0], whi[1] - wlo[1], whi[2] - wlo[2]);
    const center = [(wlo[0] + whi[0]) / 2, (wlo[1] + whi[1]) / 2, (wlo[2] + whi[2]) / 2];
    const cam = new OrthoCamera({
      ...CANVAS,
      target: center,
      viewDir: VIEW_DIR,
      up: [0, 1, 0],
      pixelSize: (1.6 * extent) / CANVAS.height,
      depthRange: 100 * extent,
    });
    camHolder.cam = cam;

    // The stroke path in local space, then on screen.
    let localPath = spec.path;
    if (spec.pathSpan) {
      const k = (hi[0] - lo[0]) / spec.pathSpan;
      localPath = spec.path.map((p) => p.map((v) => v * k));
    }
    if (spec.sphericalPath) {
      const c = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      const rho = (hi[0] - lo[0]) / 2;
      localPath = spec.sphericalPath.map((d) => {
        const n = norm(d);
        return [c[0] + rho * n[0], c[1] + rho * n[1], c[2] + rho * n[2]];
      });
    }
    const screenPath = localPath.map((p) => cam.project(xform(matrix, p)).slice(0, 2));

    const manager = session.getSculptManager();
    manager.setToolIndex(index);
    const tool = manager.getTool(index);
    const worldRadius = spec.radiusOfExtent * extent;
    const pixelRadius = worldRadius / cam.s / session.getPixelRatio();
    tool._radius = pixelRadius;
    if (index === T.PAINT_BLUR) {
      // The shift swap over Paint (InputShell): Paint's size and strength;
      // the profile curve is Paint's own object already (SculptSession).
      const paint = manager.getTool(T.PAINT);
      tool._radius = paint._radius = pixelRadius;
      tool._intensity = paint._intensity ?? 0.75;
    }
    if (index === T.MASKING) tool._negative = true; // ctrl, no alt

    const picking = session.getPicking();
    const pressureState = () => ({
      pressure: E.Tablet.pressure,
      pen: !!E.Tablet.pen,
      pressureIntensity: E.Tablet.getPressureIntensity(),
      pressureRadius: E.Tablet.getPressureRadius(),
      pressureLayer: E.Tablet.getPressureLayer ? E.Tablet.getPressureLayer() : 1,
    });
    const pickState = (p) => ({
      intersection: arr(p.getIntersectionPoint()),
      normal: arr(p.getPickedNormal()),
      eyeDirection: arr(p.getEyeDirection()),
      pickedFace: p.getPickedFace(),
      radiusLocal2: p.getLocalRadius2(),
      radiusLocal: Math.sqrt(p.getLocalRadius2()),
      radiusWorld2: p.getWorldRadius2(),
      radiusWorld: Math.sqrt(p.getWorldRadius2()),
    });

    // Record every engine dab where the engine makes it.
    const dabs = [];
    let mouse = null;
    if (brush.mode === 'move') {
      const orig = tool.move.bind(tool);
      tool.move = (iVerts, c, r2, moveData, p) => {
        dabs.push({
          mouse,
          ...pressureState(),
          ...pickState(p),
          center: arr(c),
          radiusLocal2: r2,
          radiusLocal: Math.sqrt(r2),
          moveDir: arr(moveData.dir),
          picked: arr(iVerts),
        });
        return orig(iVerts, c, r2, moveData, p);
      };
    } else {
      const orig = tool.stroke.bind(tool);
      tool.stroke = (p, sym) => {
        const d = {
          mouse,
          ...pressureState(),
          ...pickState(p),
          screenRadius: tool.getScreenRadius() * E.Tablet.getPressureRadius(),
          intensity: (tool._intensity ?? null) === null ? null : tool._intensity * E.Tablet.getPressureIntensity(),
          picked: arr(p.getPickedVertices()),
        };
        if (brush.mode === 'drag') d.dragDir = arr(tool._dragDir);
        // Clay's build plane: layer x radius x layerPressure, as the dab used it.
        if ('lastLayerOffset' in tool) {
          d.layerPressure = tool.layerPressure();
          tool.lastLayerOffset = NaN;
        }
        if ('lastDab' in tool) tool.lastDab = null;
        const out = orig(p, sym);
        if ('lastLayerOffset' in tool) d.layerOffset = Number.isNaN(tool.lastLayerOffset) ? null : tool.lastLayerOffset;
        if ('lastDab' in tool) {
          // The tine rake's dab: its knobs, the depth it carved to, and the
          // frame (across axis, stroke direction, plane) it laid the tines in.
          d.rake = tool.lastDab ? { ...tool.lastDab } : null;
          tool.lastDab = null;
        }
        dabs.push(d);
        return out;
      };
    }

    const input = snapshotMesh(mesh);
    const faces = arr(mesh.getFaces().subarray(0, mesh.getNbFaces() * 4));
    const params = toolParams(tool);
    const dyn = { ...dynamics.get(index) };

    // Press. The pressures are a pen's (InputShell sets Tablet.pen per
    // event; a mouse would read as full pressure for the clay layer).
    const [px, py] = screenPath[0];
    E.Tablet.pressure = 0.5;
    E.Tablet.pen = true;
    session._mouseX = px;
    session._mouseY = py;
    mouse = [px, py];
    if (!manager.start(false)) throw new Error(`${brush.name} on ${meshKey}: the press missed the mesh`);
    session._action = E.Enums.Action.SCULPT_EDIT;
    session._lastMouseX = px;
    session._lastMouseY = py;
    const press = { mouse: [px, py], pressure: 0.5, ...pickState(picking), localTarget: localPath[0] };

    // The moves.
    const moves = [];
    if (brush.mode === 'dab') {
      for (let k = 1; k < screenPath.length; k++) {
        const [x, y] = screenPath[k];
        E.Tablet.pressure = PRESSURES[k - 1];
        session._mouseX = x;
        session._mouseY = y;
        mouse = [x, y];
        moves.push({ mouse, pressure: E.Tablet.pressure, localTarget: localPath[k] });
        manager.preUpdate();
        tool.makeStroke(x, y, picking, null);
        tool.updateRender();
        tool._lastMouseX = x;
        tool._lastMouseY = y;
        session._lastMouseX = x;
        session._lastMouseY = y;
      }
    } else {
      // Off the surface: the pointer pulls right and up from the press.
      const step = (brush.mode === 'drag' ? 0.2 : 0.4) * tool._radius;
      const dir = norm([1, -0.6, 0]);
      for (let k = 1; k <= 5; k++) {
        const x = px + dir[0] * step * k;
        const y = py + dir[1] * step * k;
        E.Tablet.pressure = PRESSURES[k - 1];
        session._mouseX = x;
        session._mouseY = y;
        mouse = [x, y];
        moves.push({ mouse, pressure: E.Tablet.pressure });
        manager.preUpdate();
        manager.update();
        session._lastMouseX = x;
        session._lastMouseY = y;
      }
    }
    manager.end();
    session.getStateManager().cleanNoop();
    session._action = E.Enums.Action.NOTHING;
    E.Tablet.pressure = 0.5;
    E.Tablet.pen = false;

    const output = snapshotMesh(mesh);
    const res = {
      mesh: {
        key: meshKey,
        construction: spec.construction,
        nbVertices: mesh.getNbVertices(),
        nbFaces: mesh.getNbFaces(),
        nbQuads: mesh.getNbQuads(),
        nbTriangles: mesh.getNbTriangles(),
        matrix,
        scale,
        localBounds: { min: lo, max: hi },
        worldExtent: extent,
      },
      brush: {
        name: brush.name,
        className: tool.constructor.name,
        source: brush.bridge ? 'src/sculpt/bridge/tools.ts' : `src/sculpt/vendor/editing/tools/${tool.constructor.name}.js`,
        toolIndex: index,
        toolSlot: brush.tool,
        params,
        dynamics: dyn,
        radius: { radiusOfExtent: spec.radiusOfExtent, world: worldRadius, pixel: tool._radius, pixelRatio: session.getPixelRatio() },
        entryPoint: ENTRY_POINTS[brush.mode],
      },
      camera: cam.describe(),
      input: {
        positions: input.positions,
        faces,
        normals: input.normals,
      },
      press,
      moves,
      dabs,
      output: { positions: output.positions, normals: output.normals },
    };
    const uMat = uniformTriples(input.materials);
    if (brush.colors) {
      res.input.colors = input.colors;
      res.output.colors = output.colors;
    }
    if (brush.mask || brush.colors) {
      res.input.materials = input.materials;
      res.output.materials = output.materials;
    } else {
      res.input.materialsUniform = uMat; // every vertex: [roughness, metalness, mask]
      if (!uMat) res.input.materials = input.materials;
    }
    if (brush.mask) {
      res.input.mask = input.materials.filter((_, i) => i % 3 === 2);
      res.output.mask = output.materials.filter((_, i) => i % 3 === 2);
    }
    return res;
  } finally {
    dynamics.dispose();
    session.dispose();
  }
}

// --- the run -------------------------------------------------------------------

const FORMAT = {
  units: 'All points, normals and radii are in the mesh LOCAL space unless named world; mesh.matrix (column-major 4x4, gl-matrix layout) takes local to world, and mesh.scale is its uniform scale.',
  floats: 'positions, normals, colors and materials are the engine Float32Array values written as JSON numbers (each the exact float32 value as a double); nothing is rounded. Dab and camera values are doubles as the engine computed them.',
  faces: 'input.faces is the engine face array: 4 indices per face. A quad is [a, b, c, d]; a triangle is [a, b, c, TRI_INDEX] with TRI_INDEX = 4294967295 (Utils.TRI_INDEX). Winding is the engine order (counter-clockwise seen from outside). Faces do not change during a fixture.',
  materials: 'materials are per-vertex triples [roughness, metalness, mask]; mask 1 = unmasked, 0 = fully masked. Every falloff is multiplied by the mask. materialsUniform gives the one triple every vertex has when they are all equal.',
  colors: 'colors are per-vertex linear RGB triples. Every fixture starts from a two-tone colouring (x < the local bounds centre: [0.8, 0.3, 0.2], else [0.2, 0.4, 0.9]).',
  dabs: 'dabs lists every call the engine made to the tool (stroke(picking), or for VolumetricMove move()), in order, with the Picking state at that moment: intersection (the dab centre the loops use), normal (picked normal, interpolated vertex normals of the picked face), eyeDirection, radiusLocal2 (what the loops use), the world radius it came from, picked (the vertex indices in the order the engine iterates them), pressure, pen and the Tablet factors (pressureIntensity, pressureRadius, pressureLayer), for ClayStripsBrush layerPressure (the term the dab used, pressureLayer) and layerOffset (the build plane offset along the area normal, local units: layer * radiusLocal * layerPressure, negated in the loop when _negative), and for RakeBrush rake: the tine rake dab (tines, width, depth, plateau, taper, invert as the dab applied it, depthLocal = depth * radiusLocal * pressureTerm, the across axis and stroke direction (along) it laid the tines on, where that direction came from, and the area plane, areaNormal and areaCenter, the latter over the stroke-start positions). press is the pointer-down, which is not a dab except for Drag.',
  moves: 'moves are the pointer positions after the press (device px on the fixed camera), with the local-space point each was aimed at (localTarget) where the path is on the surface.',
  output: 'output holds the state after the stroke ended: positions and normals always, colors/materials/mask where the brush writes them.',
  curves: 'brush.params.curve, for the brushes on a profile curve (ClayStripsBrush, CreaseBrush, PolishBrush, PaintBrush and PaintBlurBrush, which reads PaintBrush\'s, and RakeBrush\'s tine profile): preset (the preset id the anchors are exactly, or null), anchors (the cubic Bezier: [{t, v, in: [t, v], out: [t, v], corner}], t from the dab centre 0 to its edge 1, sorted, the ends at 0 and 1, the first without in and the last without out, every handle\'s t within its segment), exactKernel (true when the preset\'s closed form is evaluated instead of the table, see docs/parity-fixtures.md), table (256 weights at t = i / 255, the Bezier or the kernel baked; a loop reads it with linear interpolation).',
};

async function main() {
  const E = await loadEngine();
  const git = gitInfo();
  const meta = {
    ...git,
    generator: 'scripts/parity-fixtures.mjs',
    runtime: `node ${process.version} (V8 ${process.versions.v8}); the engine sources bundled with esbuild, no browser`,
    engine: {
      vendor: 'SculptGL, stephomi/sculptgl @ 8e45dafc0f7906e5238dfffc1a2df742bd25f29d (MIT, (c) 2019 Stephane Ginier), vendored in src/sculpt/vendor with BOZZETTO EDIT markers (render/GUI removed, per-tool _spacing, RAKE and PAINT_BLUR slots).',
      bridgeTools: 'src/sculpt/bridge/tools.ts',
      bridgeConstants: bridgeConstants(),
      TRI_INDEX: E.Utils.TRI_INDEX,
      tablet: 'Tablet.getPressureIntensity/getPressureRadius are replaced by DynamicsStore.install: factor = 1 + amount * (curve(pressure) * 2 - 1), amount per brush and channel (meta.brushes[].dynamics), curve linear by default. DynamicsStore.install also adds Tablet.getPressureLayer, the clay layer\'s pressure term: 1 when Tablet.pen is false (a mouse or a finger) or the strength amount is 0, else 1 + strengthAmount * (strengthCurve(pressure) - 1), on the 0..1 scale (linear at full amount: the pressure itself). Every stroke here is a pen (Tablet.pen = true).',
      appInstall: APP_INSTALL_NOTES,
    },
    pressures: { press: 0.5, moves: PRESSURES },
    format: FORMAT,
  };

  const results = new Map();
  const brushParams = {};
  for (const brush of BRUSHES) {
    if (only && !only.has(brush.name)) continue;
    for (const meshKey of Object.keys(MESHES)) {
      const r = await record(E, meshKey, brush);
      brushParams[brush.name] = { toolSlot: r.brush.toolSlot, toolIndex: r.brush.toolIndex, className: r.brush.className, params: r.brush.params, dynamics: r.brush.dynamics };
      results.set(`${brush.name}.${meshKey}.json`, r);
    }
  }
  E.restoreConsole();

  const files = new Map();
  for (const [name, r] of results) {
    files.set(name, { format: FORMAT, meta: { ...meta, brushes: { [r.brush.name]: brushParams[r.brush.name] } }, ...r });
  }
  files.set('index.json', {
    meta: { ...meta, brushes: brushParams },
    files: [...results.entries()].map(([name, r]) => ({
      file: name,
      brush: r.brush.name,
      mesh: r.mesh.key,
      nbVertices: r.mesh.nbVertices,
      dabs: r.dabs.length,
    })),
  });

  if (verify) return verifyAgainst(files);

  mkdirSync(outDir, { recursive: true });
  // Files an earlier recording made that this one does not (alpha-rake06.json
  // from before the alphas were retired) would read as part of it.
  for (const n of readdirSync(outDir)) if (n.endsWith('.json') && !files.has(n)) rmSync(join(outDir, n));
  let total = 0;
  for (const [name, body] of files) {
    const text = JSON.stringify(body) + '\n';
    writeFileSync(join(outDir, name), text);
    total += text.length;
  }
  for (const [name, r] of results) {
    const moved = maxDelta(r.input.positions, r.output.positions);
    console.log(`${name.padEnd(34)} ${String(r.mesh.nbVertices).padStart(5)} verts  ${r.dabs.length} dabs  max move ${moved.toExponential(3)}`);
  }
  console.log(`wrote ${files.size} files (${(total / 1e6).toFixed(1)} MB) to ${outDir}`);
}

function maxDelta(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** Walk two JSON values: numbers within tol, everything else equal. */
function compare(a, b, path, out, ignore) {
  if (ignore.has(path)) return;
  if (typeof a === 'number' && typeof b === 'number') {
    const d = Math.abs(a - b);
    if (!(d <= tol) && !(Number.isNaN(a) && Number.isNaN(b))) out.bad.push(`${path}: ${b} (recorded) vs ${a} (now)`);
    out.max = Math.max(out.max, Number.isFinite(d) ? d : 0);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      out.bad.push(`${path}: shape differs`);
      return;
    }
    for (let i = 0; i < a.length; i++) compare(a[i], b[i], `${path}[${i}]`, out, ignore);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) compare(a[k], b[k], path ? `${path}.${k}` : k, out, ignore);
    return;
  }
  if (a !== b) out.bad.push(`${path}: ${JSON.stringify(b)} (recorded) vs ${JSON.stringify(a)} (now)`);
}

function verifyAgainst(files) {
  if (!existsSync(outDir)) {
    console.error(`no fixtures at ${outDir}`);
    process.exit(2);
  }
  // Provenance may differ between the recording and now; it is reported, not failed.
  const ignore = new Set(['meta.webCommit', 'meta.date', 'meta.webDirty', 'meta.runtime']);
  let failed = 0;
  const onDisk = new Set(readdirSync(outDir).filter((n) => n.endsWith('.json')));
  for (const [name, now] of files) {
    if (!onDisk.has(name)) {
      if (only && name === 'index.json') continue;
      console.log(`MISSING ${name}`);
      failed++;
      continue;
    }
    const recorded = JSON.parse(readFileSync(join(outDir, name), 'utf8'));
    if (name === 'index.json' && only) continue;
    const out = { bad: [], max: 0 };
    if (outputsOnly) {
      // What the brush did, not how its knobs are recorded.
      const pick = (r) => (r && r.output ? { input: r.input, press: r.press, moves: r.moves, dabs: r.dabs, output: r.output } : null);
      if (!pick(recorded)) continue;
      compare(pick(now), pick(recorded), '', out, ignore);
    } else compare(now, recorded, '', out, ignore);
    const prov = recorded.meta && recorded.meta.webCommit !== now.meta.webCommit ? ` (recorded at ${recorded.meta.webCommit?.slice(0, 7)}, now ${now.meta.webCommit?.slice(0, 7)})` : '';
    if (out.bad.length) {
      failed++;
      console.log(`FAIL ${name}: ${out.bad.length} difference(s), max numeric ${out.max.toExponential(3)}${prov}`);
      for (const l of out.bad.slice(0, 8)) console.log(`     ${l}`);
    } else {
      console.log(`ok   ${name}  max numeric difference ${out.max.toExponential(3)}${prov}`);
    }
  }
  if (!only) for (const n of onDisk) if (!files.has(n)) console.log(`extra file on disk (not produced now): ${n}`);
  console.log(failed ? `${failed} file(s) differ beyond ${tol}` : `all ${files.size} files match within ${tol}`);
  process.exit(failed ? 1 : 0);
}

await main();
