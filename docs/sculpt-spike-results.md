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

# WS1 results (GeometrySync complete + review-round feedback)

Recorded 2026-08-27, same headless container as WS0 (numbers remain a
floor; reference hardware per section 12 is iPad Air / desktop PC).

## What landed

- Ranged GPU uploads: Mesh.updateGeometry feeds its dirty vertex ids
  through a new tagged seam; GeometrySync coalesces them (4096-element
  merge gap, 64-range cap, full-upload fallback) into attribute
  updateRanges. Resolved [Verify-in-WS1]: both r184 backends apply
  updateRanges per range and clear them after upload
  (WebGPUAttributeUtils.js:226, WebGLAttributeUtils.js:221), so ranges
  accumulate correctly across stroke steps between renders and the bridge
  never clears them itself.
- color + materialsPBR attributes now ride the same geometry (full-update
  path; the mask tint consumes them in WS3).
- Upload accounting on the debug handle (__sculpt.sync.stats): during a
  20-step brush stroke on the 49k sphere, 10 ranged commits, 0 full
  commits, last commit 72,048 elements versus a ~442k-element full
  upload. Bounded and logged per the acceptance.
- Dynamic topology validated on the indexed path (drawArrays stays off):
  toggle to MeshDynamic, sculpt (topology updates run; a null-guard seam
  was added for getShowWireframe, which MeshDynamic checks per stroke),
  toggle back to static. Backing-array swaps rebuild attributes (6
  rebuilds across the dyntopo session in the test).
- Multiresolution: d / shift+d step levels, ctrl+d subdivides (top level
  only, capped at 1.6M tris), all with proper undo states
  (StateMultiresolution SELECTION / SUBDIVISION); verified 49,152 ->
  12,288 -> 49,152 -> 196,608 and a ctrl+z that drops the subdivision.
- Review-round feedback implemented (plan 7.4-7.6): the hotkey table
  (undo/redo, symmetry, brush digits 1-6, b/s hold-drag size/strength,
  shift+s shadows, l+drag light rig, reserved q/w/e/r), alt as the
  negative-stroke modifier with Alt captured so Firefox's menu bar never
  steals it (verified: an alt stroke reduces the mean radius), ctrl /
  ctrl+alt mask strokes wired (mask semantics verified in WS3), f frames
  at the last tool position (orbit pivot verified moving ~25 world units
  to the stroke site), the screen-space brush cursor (dot + ring +
  strength line), sculpt defaults (key light only, shadows off, DoF off,
  ~49k default sphere), and the viewer's DoF hotkey removed.

## Notes and deviations

- The source hotkey map assigned `s` to both brush strength and the
  shadows toggle; resolved as s = strength, shift+s = shadows (flagged in
  plan 7.4 for veto).
- alt+click currently both selects (stroke start selects the mesh under
  the cursor, upstream behavior) and sculpts a negative dab; a pure
  select-without-sculpt gesture is deferred until multi-mesh ships.
- Sim-bench figures on this shared container vary with tool choice and
  CPU load run-to-run; treat docs numbers as floors and re-measure on the
  reference hardware once deployed.

# WS1 round 2 (RTX 3060 feedback)

Reference-hardware numbers (laptop RTX 3060, Firefox, WebGPU): 30-50 fps
panning / 20-40 sculpting at 49k tris, but ~10 fps at BOTH 196k and 786k.
Equal fps at 4x the triangles means the cost was resolution-bound
post-processing, not geometry - GTAO. Changes landed in response, all
verified headless (ws1b suite) plus a regression pass of the WS1 suite:

- Sculpt shading path: pipeline output swaps to scene color x a 4-tap
  screen-space cavity term (from the existing MRT normals); GTAO and the
  DoF gather leave the graph entirely (they were only uniform-muted
  before, still paying their passes). GTAO becomes an opt-in later.
- No HDRI environment sampling in sculpt (scene.environment null,
  restored on exit); hemisphere ambient + key light carry the look.
- Flat shading by default on the sculpt subject.
- Brush cursor: surface-aligned 3D ring (closed Line strips;
  WebGPURenderer does not draw LineLoop) at the world brush radius with
  center dot and normal-aligned strength line; screen-space fallback off
  the mesh. Strength adjust (hold s) is now a vertical drag, up =
  stronger. Fixed a real adjust bug the tests caught: stale/mixed
  coordinate tracking made a second b/s hold jump the value.
- Mode-aware hotkey guide (H) and a gallery "Sculpt!" entry link.
- Note: at 786k the next ctrl+d would be 3.1M tris, above the 1.6M cap,
  so the refusal Vidar saw was the cap working as intended. Whether the
  cap should rise is a reference-hardware question.
