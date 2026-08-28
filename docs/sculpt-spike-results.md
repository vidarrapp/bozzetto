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

# WS1 round 3 (stable-30 feedback)

RTX 3060 after round 2: a stable 30 fps at every subdivision level (the
6-to-60 swings are gone), shadows cost only a couple of fps. Round 3
changes, verified by the ws1b suite plus a WS1 regression pass:

- The cavity term gridded on flat-shaded facets (every facet edge is a
  normal discontinuity at low subdivision). Replaced with an 8-tap
  depth-only SSAO: depth ignores facet normals, so only real creases
  occlude. Tunable strength/radius uniforms remain for the palette.
- The settings panel now drives all sculpt shading: enterSculpt adopts
  the sculpt geometry onto the viewer's display mesh (with the vendor
  matrix), so material mode, albedo/roughness/metalness, matcaps,
  smooth/flat and the wireframe overlay work through the existing
  machinery. Flat shading is applied as the sculpt default through the
  material state and restored on exit.
- Master Shadows toggle in the panel (viewer + editor + sculpt), backed
  by a new Lighting.setShadowsMaster that gates every light without
  touching the per-light config; shift+s drives the same switch. The
  DoF panel section hides while sculpt mode is active.
- shift + left drag = temporary Smooth stroke (ZBrush parity).
- f now frames the whole current mesh; the orbit pivot instead follows
  the work automatically (each stroke end re-pivots to the last edit).
- ctrl+d cap raised 1.6M -> 4M tris per Vidar.
- Test-only fix: the pivot-follow changed the view between scripted
  strokes, so the WS1 suite reframes (f) before its alt stroke.

# WS1 round 4 (clean entry + stage)

- /?sculpt=1 is a project-less sculpt entry: a synthetic one-frame
  "model" manifest on an in-memory source, so nothing fetches from the
  API, no timelapse loads, and no transport bar appears; the gallery
  Sculpt! link points there. ?tl=<id>&sculpt=1 still works for
  sculpting over a loaded project.
- The stage (ground/floor/pedestal) is hidden by default in sculpt mode
  (it hid the sculpt's underside); g or the panel cycles it back, and
  the saved mode returns on exit.
- Verified headless: standalone page has no transport, ground off, the
  overlay clears, strokes work; the project-based entry and the full
  WS1 suite still pass.

# WS1 round 5 (touch toolbar)

- Bottom sculpt toolbar for keyboard-less iPads: Negative toggle in the
  left corner (sticky base, XORed with alt per stroke) and the six digit
  brushes centered, numbered 1-6 per Vidar. Buttons and hotkeys stay in
  sync both ways (InputShell.selectBrush is the shared path and emits
  onToolChange). House tokens, 44px targets, safe-area padding, raised
  above the transport when sculpting over a loaded project.
- Verified headless: toolbar renders 1-6, the Negative toggle makes a
  plain Inflate stroke carve inward with no Alt involved, digit keys
  highlight the matching button, and the full prior suite still passes.
- Field report on round 3/4 (RTX 3060): "much snappier".

# WS1 round 6 (view-stable pivot, hold-to-carve, crease default)

- Stroke-end pivot no longer moves the view: the edit point is projected
  onto the current view ray and only the target's depth changes (camera
  position and look direction verified bit-identical in the suite:
  posMoved ~1e-14, dirDrift ~1e-16, target depth moved ~3 units). The
  earlier naive re-target visibly jumped the view at every stroke end.
- The toolbar Negative button is hold-to-carve (pointerdown engages,
  lift releases), matching held alt; two-finger iPad flow works because
  the button lives outside the viewer container's input arbitration.
- Crease defaults inverted from upstream: ridge by default, alt or the
  Negative hold carves the valley.
- Backlog noted in the plan (12b): file save/load menu, OBJ export.

Round 6 follow-up: the WS1 suite regression seen during this round was a
test-geometry collision, not a product bug. The round-5 toolbar (raised
above the transport in the ?tl=...&sculpt=1 flow) covers the bottom band
of the tiny 480x360 test viewport, and the suite's multires stroke
coordinate landed on the brush row (the WS1 suite had not been re-run in
round 5 to catch it). Verified via elementFromPoint; the suite strokes
now stay clear of the toolbar and both suites pass on the shipped code.

# WS1 round 7 (iOS standalone viewport)

Field report: as an iOS home-screen web app in fullscreen, framing put
the model centred on the BOTTOM edge (half offscreen). Cause: iOS
standalone apps settle their viewport after load and often skip the
window resize event, so the canvas kept the stale boot-time height and
the render centre sat at the visible bottom edge. Fixes:

- A ResizeObserver on the viewer container is now the resize source of
  truth (fires on the actual box change regardless of which events the
  platform sends); the window resize listener stays as belt and braces.
  Verified headless by shrinking the container with no window resize:
  the canvas buffer tracks exactly.
- viewport-fit=cover added to all three entry pages (also required for
  the toolbar's env(safe-area-inset-bottom) to be non-zero on notched
  devices in standalone mode).

# WS1 round 8 (stylus pressure)

- PointerEvent pressure now feeds the vendored Tablet state on stroke
  start and every stroke move, swaying both radius (factor 0.75, the
  vendor default) and intensity (0.75, enabled per Vidar; upstream
  shipped it off). Mouse and plain touch report 0.5 while pressed (the
  spec value), which is exactly Tablet's neutral, so they are unchanged;
  the value resets to neutral at stroke end so hover picking never sees
  stale pressure.
- Verified headless with synthetic pen strokes: identical stroke at
  pressure 0.15 vs 0.95 produced total deformation 0.8 vs 130.9 (the
  radius and intensity scaling compound), and Tablet reads 0.5 after
  the stroke. Full suite plus the WS1 regression pass.

# WS1 round 9 (web-app manifest)

- manifest.webmanifest (name Bozzetto, display fullscreen with the spec
  fallback chain, scope /, start_url /, house colors) linked from all
  three entry pages, plus apple-mobile-web-app metas (opaque black
  status bar to match the ink theme) and apple-touch-icon.
- Placeholder icons generated procedurally (scripts/generate-icons.mjs,
  dependency-free PNG writer): the default sculpt sphere in clay-rust
  on warm ink, sized 512/192/180 and maskable-safe. Swap by replacing
  public/icons/* when the real icon arrives (or rerun the script after
  editing it).
- Note: iOS commonly keeps the URL the page was added from as the
  launch URL regardless of start_url, so adding from /?sculpt=1 keeps
  launching straight into sculpt mode.

# WS2 results (full toolset, masking, undo/redo fuzz)

## What landed

- Digits 7/8/9 select Smooth, Drag and Twist (InputShell, touch toolbar
  and the help overlay all extended); the full plan 7.4 digit row is now
  live. LocalScale gets no digit and ships via the WS4 palette; Transform
  and Paint stay deferred per plan section 2.
- Upstream mask parity for presses that miss the mesh while holding ctrl:
  release in place inverts the whole mask, dragging clears it. On-mesh
  ctrl strokes still paint (alt unmasks), as landed in WS1.
- StateManager.STACK_LENGTH raised 15 -> 64: the acceptance fuzz walks 50+
  states, and the WS5 capture design (plan 6.6b) consumes undo states as
  timelapse deltas, so the deeper history pays twice.
- Seam gap found by the fuzz and fixed: Masking/Paint/undo paths call
  updateColorBuffer/updateMaterialBuffer on the render-less mesh, which
  dereferenced the null _renderData. Those two Mesh.js methods now route
  to a new GeometrySync.onColorsMaterials hook (color + materialsPBR
  attribute refresh, rebuild on array swap) behind BOZZETTO EDIT tags.

## Verified (automated, headless Chromium against the built site)

- Tool smoke: each digit 1-9 strokes, pushes exactly one undo state, and
  undoes back to a bit-identical checksum.
- Symmetry: a right-side stroke moves both halves with x mirroring on.
- Masking: painted mask resists sculpting (masked-side displacement 2.09
  vs 67.6 free under the same inflate stroke); ctrl-click empty inverts
  (mask mean 0.856 -> 0.144); ctrl-drag empty clears (mask uniform 1.0).
  Semantics confirmed: materialsPBR z = 1 free, 0 fully masked, which
  also settles the WS3 tint direction (tint where z is LOW).
- Fuzz: 52 state-pushing ops (random strokes across all nine tools with
  random polarity/pressure, multires level steps every ninth op, a
  dyntopo on/off round trip), then a full 52-deep undo walk verifying
  every intermediate state, a full redo walk, a 30-step random undo/redo
  walk, and a finite-data sweep. Three seeds pass (1337, 7, 424242).

## Findings worth keeping

- Multires level-step undo/redo is approximate by upstream design. A
  SELECTION state stores no vertex snapshot; undoing it re-runs the
  analysis/synthesis recompute. Two error sources, both measured with a
  minimal repro: (1) detail vectors round-trip a per-vertex tangent-frame
  rotation in float32, drifting <= ~5e-13 per component on a clean
  round trip; (2) the real one: a boundary's detail vectors are only
  recomputed when crossing DOWN, so sculpting a lower level and stepping
  up synthesizes the high level from stale details, and undoing that step
  re-analyzes onto a re-projection of the sculpt (measured max 4.4e-4 per
  component, checksum-sum drift 0.1-0.4 per crossing; scales with how
  much was sculpted since the last down-crossing). Relative error is
  ~1e-5 of the coordinate scale: invisible in use, structure (level,
  counts) restores exactly, and every piece involved is unmodified
  vendored upstream code. The fuzz models it honestly: comparisons are
  bit-exact until the walk crosses its first level step, after which
  structure stays exact and the vertex sum gets a 1.0 tolerance (~60x
  under a lost stroke, the real-bug signal); a strokes-only fuzz variant
  (NO_SUBDIV + NO_DYNTOPO) runs fully bit-exact as the sharp instrument.
- Upstream undo bookkeeping is index-based: StateManager.undo() only
  decrements _curUndoIndex (entries stay parked for redo) and the next
  push truncates the tail, so _undos.length is NOT the live state count.
  Tests must read _curUndoIndex + 1. (Cost one debugging round: a
  length-based probe made healthy strokes look like they pushed nothing.)
- Twist strokes need angular sweep around the pick point: a straight
  drag has constant bearing and can push a state yet produce zero net
  displacement. Smoke strokes use a bent path, and the fuzz trusts the
  undo stack, not checksum deltas, to decide whether an op landed.
- Pointer Events remain sufficient for every WS2 gesture; hammerjs stays
  out (plan 6.3 note stands).

# WS2b (toolbar icons)

- Flaticon uicons (npm @flaticon/flaticon-uicons v3.3.1), solid straight
  style, imported as the package's own stylesheet so font URLs survive
  package upgrades; the woff2 only downloads when a glyph first renders,
  i.e. in sculpt mode. Hotkey digits stay on the buttons as corner
  badges. Attribution added to the README credits.
- Per-brush mapping. Vidar's picks, where the npm release has them in
  solid straight: Crease = scalpel, Standard = screwdriver (review pick,
  replacing the initial brush stand-in), Inflate = paintbrush-pencil,
  Smooth = shredder, Twist = pen-swirl, Negative = reflect-vertical
  (review pick, replacing the flip-horizontal stand-in; solid straight
  variant of the fi-tr embed Vidar pasted, keeping one font family).
  Flatten = the real scraper (newer than the npm 3.3.1 release), landed
  as an inline-SVG override (icons/flatten.svg) from Vidar's download;
  the invert idea for Negative was dropped with the reflect pick, so no
  SVG needed there. Unassigned
  brushes got in-pack picks: Move = arrows, Pinch = compress,
  Drag = hand-back-fist. All swappable one string per brush in
  SculptToolbar.ts when better picks land.
- Inline-SVG override path (follow-up round): src/sculpt/ui/icons/
  <slot>.svg (crease/move/standard/.../negative) raw-inlines into that
  button at build time via import.meta.glob, recolored through
  currentColor and sized like the font glyphs; no file means the font
  glyph stands. Verified end to end with a throwaway flatten.svg
  (rendered, themed, removed again). Awaiting Vidar's scraper and
  invert downloads to land as flatten.svg and negative.svg.

# WS2c (reload persistence)

- ScenePersist.ts: the active mesh autosaves to IndexedDB
  (bozzetto-sculpt/scene/current) so reloads and iOS app eviction keep
  the work; a saved scene replaces the default sphere on entry, with a
  Restored toast offering Start fresh (clears the store, reloads; the
  persist hook is hard-disabled first so the reload's own pagehide
  flush cannot resurrect the cleared scene).
- Zero stroke-loop cost: StateManager pushState/undo/redo are wrapped
  on the instance (no vendor edits) to set a dirty flag; the serialize
  (bounded copies of the live regions) and IDB put run in idle time,
  debounced 1.5s, plus a visibilitychange/pagehide best-effort flush.
  Storage failure (quota, private windows) disables autosave quietly;
  sculpting is unaffected.
- Saved payload = what upstream .sgl stores: current level only, plus
  transform and symmetry. Lower multires levels and undo history do
  not survive a reload (upstream parity); meshes past 1.6M tris skip
  autosave (~60MB puts).
- Restore path reuses the proven convertToStaticMesh construction
  (OPTIMIZE off around init) wrapped in a fresh Multimesh, no
  normalize (the saved matrix carries scale).
- Verified headless (persist-test.mjs): flush -> reload restores
  bit-exact (checksum, symmetry, toast); sculpt + undo on the restored
  mesh stay exact; the debounced autosave persists without an explicit
  flush; Start fresh returns to the default sphere with nothing
  restored after. WS1/WS1b/WS2 suites now clear the store on boot so
  runs stay deterministic.

# WS2c round 2 (full-stack persistence + big-mesh cadence)

- Review corrections: the "matching upstream .sgl" limits were parity,
  not necessity. v2 format now persists the WHOLE multires stack; and
  meshes past 1.6M top-level tris autosave on a five-minute cadence
  (review request) instead of being skipped - the debounce gap is
  size-dependent (1.5s normal, 300s big), with hide/dispose flushes
  bypassing it either way.
- v2 payload per level: vertices, live normals, colors, materials, and
  the three detail-vector arrays (null until an analysis crossing);
  plus base faces only (higher-level topology re-derives exactly by
  re-running the deterministic subdivision), selection, transform,
  symmetry. v1 records upgrade on read (single level, no normals).
- Restore rebuilds levels via addLevel then overwrites every array
  with the saved bytes; face aabbs/normals and octrees rebuild
  deterministically (pure per-face functions); selection is set with
  plain setSelection, never the analysis/synthesis walk, so a stale
  top and its detail vectors come back exactly as saved. Any shape
  mismatch throws and falls back to a fresh sphere (record cleared).
- Finding: vertex normals are NOT reproducible by recompute. Live
  normals accumulate through incremental stroke updates in a different
  float order than a full recompute, and synthesis builds its tangent
  frames from them, so a recompute-at-restore made post-reload level
  steps diverge from pre-reload ones by the re-projection scale
  (~0.09 checksum-sum). Persisting live normals (+25 percent payload)
  restores them verbatim; the debug harness confirms every synthesis
  input round-trips byte-identical.
- Verified headless: everything from the first WS2c suite, plus: sculpt
  BELOW the top level, reload, current level bit-exact, stack shape and
  selection preserved, and a post-reload step up equals the pre-reload
  step up bit-exactly (only possible if verts, details AND normals all
  round-tripped).
- Undo history stays unpersisted, now as an explicit decision (plan
  6.6c): states reference live mesh object graphs (AddRemove states
  hold entire meshes), a large serialization surface for marginal
  value; WS5 capture keeps long-term history as timelapse frames.

# WS2b round 2 (Negative button gestures + thin icon)

- Double-tap on the Negative button latches carving on (no held finger
  needed); while latched a single tap unlatches, and holding still
  works as the momentary carve. 350ms double-tap window, pointer-event
  based (works for touch, pen and mouse alike); a triple tap nets out
  to a momentary carve.
- Icon swapped to reflect-vertical in the THIN straight face
  (fi-ts-*, review pick): visually separates the mode-modifier button
  from the solid-straight brush icons. Costs a second lazily-loaded
  uicons font family, fetched only when the toolbar renders.
- ws1b extended: hold/release, double-tap latch, single-tap unlatch
  all asserted through synthetic pointer taps.

# WS2d (subdivision headroom)

- After the RTX 4070 SUPER run held a locked 60 fps at the 4M-tri cap
  (once Chrome's crashed GPU process was restarted out of software
  rendering), ctrl+d now gates instead of capping there: past 4M
  result-tris a confirm dialog warns about weaker devices (restoring
  upstream GuiTopology's dialog behavior), with a 16M hard ceiling for
  browser memory.
- Autosave interplay: past 8M top-level tris ScenePersist skips writes
  entirely instead of attempting multi-hundred-MB puts; the last
  in-budget save stays in place for restore, and the 1.6M slow-cadence
  band continues to cover the 1.6M-8M range.
- Level toast (same round): a transient "Subdiv N/M" pill above the
  toolbar announces every multires level move - d / shift+d, ctrl+d,
  and undo/redo that land on another level (SculptSession.onLevelChange
  fires from the step/subdivide paths plus an undo/redo level-signature
  diff). Repeated steps reuse the pill and reset its fade.
