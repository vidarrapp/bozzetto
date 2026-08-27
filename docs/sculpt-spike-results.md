# WS0 spike results (sculpt mode)

Per docs/sculpt-mode-implementation.md section 9, WS0. Recorded 2026-08-27.

## What landed

- Vendor drop at the pinned upstream hash (8e45daf), unmodified, minus
  mesh/RenderData.js and math3d/Camera.js. Upstream LICENSE kept at
  src/sculpt/vendor/LICENSE.
- Mechanical import codemod to the @sculpt-vendor prefix; aliases in both
  vite configs and tsconfig paths. Vendor stays outside typecheck (allowJs
  off); the bridge imports it through src/sculpt/bridge/types/sculptgl.d.ts.
- Seam edits, every one tagged "BOZZETTO EDIT": Mesh.js (render-less guards
  plus the updateGeometryBuffers/updateBuffers bridge hooks), MeshStatic.js,
  Multimesh.js (no low-render buffers), SculptManager.js (Selection ->
  bridge Overlays stub), Picking.js (GuiTR -> shim), Tools.js (Transform and
  its Gizmo chain excluded from the v1 build).
- Bridge: GeometrySync v0 (position + normal + index, full-array uploads,
  rebind on array swap), CameraAdapter (unproject/project over the three
  camera, matching upstream's viewport convention exactly), InputShell
  (capture-phase arbitration ahead of OrbitControls), SculptSession (the
  ported main-object surface: 18 methods, 6 fields), mode.ts mount/unmount.
- Dev entry: `?sculpt=1` on a viewer URL mounts sculpt mode on the default
  sphere (real entry ships with WS5). Debug handle: window.__sculpt.
- WS0 keys: 1 Brush, 2 Smooth, 3 Drag (digits are brush keys in sculpt mode
  by decision; full table in WS4).

## Verified (automated, headless Chromium against the built site)

- A pointer Brush stroke across the default sphere (98,306 verts / 196,608
  tris) displaces vertices; the result renders through Bozzetto's node
  pipeline (lit, shadowed, themed) with the deformation clearly visible.
- Arbitration: the camera does not move at all during a sculpt stroke; a
  drag that misses the mesh orbits normally through OrbitControls; tool
  hotkeys switch tools.
- Multiresolution addLevel() mid-session (196,608 -> 786,432 tris) works
  through the GeometrySync rebind path, and strokes at the higher
  resolution run.
- Upstream verify items closed: getVertices()/getTriangles() backing arrays
  are over-allocated as suspected (GeometrySync bounds all reads and draws
  by getNbVertices/getNbTriangles); the camera-adapter surface is closed at
  two methods (grep confirmed no other getCamera call sites outside the
  deferred Gizmo).

## Measured (stroke simulation cost, renderer excluded)

Per-step cost of the full stroke path (picking, tool stroke, incremental
normals + octree, GeometrySync full-array commit), 60-step continuous
stroke, median over the run:

| Resolution | median | p90 | max |
|---|---|---|---|
| 196,608 tris | 4.3 ms | 8.8 ms | 12.8 ms |
| 786,432 tris | 21.8 ms | 33.3 ms | 82.1 ms |

## Caveats and the go call

- Hardware: a shared cloud container with NO GPU (SwiftShader software GL).
  Rendered frame time here (~2.7 s/frame at 480x360 with GTAO on a 200k-tri
  mesh) says nothing about real hardware; the numbers above deliberately
  exclude rendering. WebGPU could not be exercised headlessly (context
  creation fails; the WebGL2 fallback carried the run) - re-verify on the
  reference machine, which is also open question 1 in the plan.
- At the ~800k-tri point the sim median (21.8 ms) is above the plan's 16 ms
  guideline on this weak CPU. Written optimization path, in order: WS1
  updateRanges coalescing (v0 re-uploads the full over-allocated arrays
  every commit, the dominant avoidable cost), per-tool dirty-set reuse, and
  the plan's own contingencies (double-buffering / compaction). At the
  default 196k resolution the spike is comfortably under budget on even
  this hardware.
- Call: GO for WS1, with the range-coalescing work treated as the first
  item rather than an optimization afterthought.
