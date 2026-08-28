# Sculpt Mode for Bozzetto: Implementation Plan

Consumer: Claude Code, working inside the `bozzetto` repository.
Author: planning session between Vidar Rapp and Claude, 2026-08-27.

Pinned references (all file/line citations in this document were verified at these exact commits; re-verify before relying on a line number if either repo has moved):

- `stephomi/sculptgl` @ `8e45dafc0f7906e5238dfffc1a2df742bd25f29d` (master, last commit 2023-09-16, MIT, (c) 2019 Stephane GINIER)
- `vidarrapp/bozzetto` @ `64ad0229b025db088b7311988321b733037aaa1f`
- `three` @ `0.184.0` (bozzetto's current dependency)

## 0. Provenance legend

Every non-obvious claim in this document carries one of these tags:

- `[Verified]` read directly from source at the pinned commits.
- `[Decision]` locked by the project owner in the planning session. Do not relitigate; ask if blocked.
- `[Proposal]` recommended approach; Claude Code may adjust with a note in the PR description.
- `[Estimate]` speculative sizing; treat as orientation, not commitment.
- `[Verify-in-WS]` a specific check that must be performed during the named workstream before depending on it.

## 1. Goal

Add a 3D sculpting mode to Bozzetto by porting SculptGL's editing core onto Bozzetto's existing three.js node-based rendering pipeline (WebGPU with WebGL2 fallback), sharing one canvas and one look with the viewer. While sculpting, capture timelapse frames as real mesh snapshots at the end of strokes, plus an optional recorded camera track, feeding Bozzetto's existing frame/convert/manifest/export pipeline.

Non-goals for this effort:

- No second renderer. SculptGL's WebGL1 engine, shaders, and GUI are not vendored. `[Decision]`
- No Electron/standalone build. `[Decision]`
- No SculptGL file formats (.sgl, their OBJ/PLY/STL exporters). Base meshes enter through Bozzetto's existing loaders or generated primitives. `[Decision]`
- Paint tool (per-vertex albedo/roughness/metalness painting) is deferred past v1; the data attributes still flow through the bridge so it can be enabled later. `[Decision]`
- Transform tool + Gizmo are deferred past v1 (see 4.2 for why this is a large scope win). `[Decision]`

## 2. Locked decisions

1. Full port (the "Option B" from planning): keep SculptGL's simulation core, delete its render/GUI layers, and bridge into Bozzetto's `Viewer`. `[Decision]`
2. yagui is removed entirely. The sculpt UI is built from Bozzetto's own UI primitives and standards (`src/ui/Panel.ts`, `src/ui/dom.ts`, `src/ui/shortcuts.ts`, `src/ui/theme.ts`, CSS tokens in `src/style.css`). `[Decision]`
3. Bozzetto's camera (`src/viewer/Controls.ts`) is the only camera. SculptGL's `Camera` class is not vendored; a thin adapter satisfies the editing core's needs. `[Decision]`
4. Timelapse frames are mesh snapshots (not screenshots), produced at end of stroke and converted through the existing quantize+gzip worker path. `[Decision]`
5. Vendored SculptGL code keeps its upstream MIT LICENSE file; upstream assets (matcaps, environments, anything credited in their README) are NOT copied. `[Decision]`

## 3. Reference map (read these first)

### SculptGL (at pinned commit)

| What | Where | Notes |
|---|---|---|
| Stroke-end funnel | `src/SculptGL.js:375` `onDeviceUp()` | All pointer-release paths route here (called from :187, :217, :360). `this._action` holds what just ended. `[Verified]` |
| Action enum | `src/misc/Enums.js` | `SCULPT_EDIT`, `MASK_EDIT`, `CAMERA_*`. `[Verified]` |
| Dirty-region API | `src/mesh/Mesh.js:387` `updateGeometry(iFaces, iVerts)` | Recomputes incremental normals + octree for modified sets. This is the GeometrySync feed. `[Verified]` |
| Geometry accessors | `src/mesh/Mesh.js:148` `getVertices()`, `:240` `getTriangles()` | Backing arrays are over-allocated for dynamic growth; always slice by `getNbVertices()` / `getNbTriangles()`. `[Verified accessors; over-allocation: Verify-in-WS0]` |
| Per-vertex PBR + mask | `src/mesh/MeshData.js:14` `_materialsPBR` | Float32Array, 3 components: roughness / metallic / masking. Mask visualization keys off component z. `[Verified]` |
| Undo/redo | `src/states/StateManager.js` | `pushStateCustom` (:18), `pushStateAddRemove` (:24) cover non-stroke geometry ops (remesh, subdivision, add/remove). Per-stroke `pushStateGeometry` fires at stroke START via `src/editing/tools/SculptBase.js:64`. `[Verified]` |
| Picking | `src/math3d/Picking.js` | Camera use limited to `unproject` (:396) and `project` (:400). CPU octree raycast, renderer-independent. `[Verified]` |
| Dynamic topology draw mode | `src/mesh/dynamic/MeshDynamic.js:124,144,247` | Has a non-indexed drawArrays path (WebGL1-era). See 6.1. `[Verified]` |
| Scene graph + primitives | `src/Scene.js` | `getMeshes` :153, `setOrUnsetMesh` :200, `addNewMesh` :548, `addSphere` :500, `addCube` :508, `addCylinder` :516, `addTorus` :524, default sphere :100. These port into `SculptSession`. `[Verified]` |
| Tools | `src/editing/tools/` | Brush, Crease, Drag, Flatten, Inflate, LocalScale, Masking, Move, Paint, Pinch, Smooth, Transform, Twist (+ SculptBase, Tools registry). `[Verified]` |
| Behavior parity oracle | https://stephaneginier.com/sculptgl/ | Live upstream build for comparing tool feel when in doubt. |

### Bozzetto (at pinned commit)

| What | Where | Notes |
|---|---|---|
| Frame GLB writer | `src/admin/glb.ts:97` `meshToGLB(positions: Float32Array, indices: Uint32Array)` | Exactly the shapes the sculpt core produces. `[Verified]` |
| Convert worker | `src/admin/convert.worker.ts` (onmessage :26) | Currently accepts `{id, text, zUp}` OBJ text; replies `{id, glb, tris}` with transfer. Extend with a raw-arrays message (see 6.6). `[Verified]` |
| Normals policy | `src/viewer/FrameStreamer.ts:293` | `computeVertexNormals()` only when the attribute is absent. Live mode supplies SculptGL's incremental normals, so nothing recomputes. `[Verified]` |
| Manifest types | `src/types/manifest.ts` | `ManifestCamera` already has `position`, `target`, `focalLength`, `dof`. Extend per section 8. `[Verified]` |
| UI primitives | `src/ui/Panel.ts` (698 lines), `src/ui/dom.ts`, `src/ui/shortcuts.ts`, `src/ui/editorLayout.ts`, `src/ui/theme.ts` | See section 7. `[Verified]` |
| Partial GPU uploads | `three@0.184.0` `src/renderers/webgpu/utils/WebGPUAttributeUtils.js:177-216` | `updateRanges` applied as per-range `device.queue.writeBuffer`; full write only when no ranges set. The webgl-fallback backend has equivalent handling. This is the enabling fact for live sculpting on the node pipeline. `[Verified]` |

## 4. Vendor scope and cut list

### 4.1 What gets vendored (as-is JavaScript, minimally edited)

| Subsystem | LOC | Fate |
|---|---|---|
| `src/editing/` | 5,876 | Vendor. Tools, subdivision, remesh, surface nets, hole filling. |
| `src/mesh/` | 4,338 | Vendor, minus `RenderData.js` (deleted; see seams). |
| `src/math3d/` | 1,799 | Vendor, minus `Camera.js` (replaced by adapter). |
| `src/states/` | 776 | Vendor. |
| `src/misc/` | 584 | Vendor. |
| `src/files/` | 1,734 | NOT vendored (Bozzetto loaders + primitives cover input). `[Decision]` |
| `src/worker/` | 2,205 | NOT vendored (deflate/z-worker zip machinery for .sgl; dropped with the file formats). `[Verified contents; Decision]` |
| `src/render/`, `src/drawables/`, `src/gui/` | 1,396 + 780 + 4,540 | NOT vendored. Replaced by Bozzetto pipeline + bridge overlays + new UI. |
| `src/Scene.js`, `src/SculptGL.js` | 672 + 510 | NOT vendored as-is. Their non-GL logic (scene graph, primitives, input state machine) is PORTED into TypeScript bridge files (`SculptSession.ts`, `InputShell.ts`). |

Net vendored: about 13.3k LOC of JS. `[Verified LOC via wc -l]`

### 4.2 Seam table: every cross-import from vendored code into deleted code

There are exactly seven. `[Verified via grep at pinned commit]`

| Import | Resolution |
|---|---|
| `editing/SculptManager.js:1` imports `drawables/Selection` | Replace with bridge `Overlays.ts` exposing the same small surface SculptManager uses (the brush circle). Tag edit `// BOZZETTO EDIT`. |
| `editing/Gizmo.js:2` imports `drawables/Primitives` | Deferred: exclude `Gizmo.js` and `tools/Transform.js` from the v1 build (edit `tools/Tools.js` registry). This also removes 7 of the 9 `getCamera()` call sites (all in Gizmo :346, :383, :428, :450, :478, :535, :574), shrinking the v1 camera adapter to two methods. `[Verified call sites]` |
| `mesh/RenderData.js:2-3` imports `render/Buffer`, `render/shaders/ShaderMatcap` | `RenderData.js` is deleted entirely; the `Mesh` facade's render hooks route to GeometrySync instead. |
| `mesh/Mesh.js:5` imports `render/ShaderLib` | Remove; shader-mode fields (matcap id, flat shading, wireframe flags) become plain data the bridge/materials read. |
| `mesh/multiresolution/Multimesh.js:3` imports `render/Buffer` | Multires resolution swap becomes `GeometrySync.rebind()` (new attributes over the new resolution's arrays). |
| `math3d/Picking.js:5` imports `gui/GuiTR` | Tiny shim module returning the handful of strings (or strip the alert path). |

Rule: vendored files are edited ONLY at these seams plus the `Mesh` facade's buffer-update methods (`updateBuffers` / `updateGeometryBuffers` family around `Mesh.js:1976-1982`). Every edit is marked `// BOZZETTO EDIT: <reason>`. Algorithmic internals are never modified.

## 5. Target layout and build configuration

```
src/sculpt/
  vendor/               SculptGL JS at pinned commit (editing, mesh, math3d, states, misc)
  vendor/LICENSE        upstream MIT license, unmodified
  bridge/
    GeometrySync.ts
    CameraAdapter.ts
    InputShell.ts       ported SculptGL.js input state machine
    SculptSession.ts    ported Scene.js scene graph + primitives
    Overlays.ts         brush ring, symmetry indicator
    materialNodes.ts    mask tint hook for Materials.ts
    SnapshotRecorder.ts
    types/sculptgl.d.ts ambient module declarations for the seam imports only
  ui/
    SculptPanel.ts
    hotkeys.ts
  mode.ts               mount/unmount sculpt mode into the Viewer
```

Build/config changes `[Proposal]`:

1. Codemod vendor imports once: SculptGL uses bare root paths (`from 'mesh/Mesh'`). Rewrite mechanically to a single prefix: `from '@sculpt-vendor/mesh/Mesh'` for the five vendored roots. One sed pass, committed separately so the vendor drop stays diffable against upstream.
2. `vite.config.ts` AND `vite.embed.config.ts`: `resolve.alias['@sculpt-vendor'] = '/src/sculpt/vendor'`.
3. `tsconfig.json`: add `"paths": { "@sculpt-vendor/*": ["./src/sculpt/vendor/*"] }`. Keep `allowJs` off: tsc then ignores the vendored `.js` (typecheck stays green and strict for everything else) while Vite bundles it. The bridge imports vendor modules through the ambient declarations in `types/sculptgl.d.ts`, which only need to cover the seam surface (Mesh, SculptManager, Tools/Enums, StateManager, Picking, MeshStatic/MeshDynamic/Multimesh constructors). `[Verified tsconfig: strict, include ["src"], moduleResolution bundler]`
4. New runtime deps: `gl-matrix` (vendor core uses it throughout). `hammerjs` only if WS2 keeps SculptGL's touch handling; see 6.3. No `file-saver`, no `raw-loader` (the glsl concern died with `src/render/`).

## 6. Bridge component specifications

### 6.1 GeometrySync (replaces RenderData)

Owns one `THREE.BufferGeometry` per sculpt mesh, wrapping the vendor's typed arrays.

- Attributes: `position` (f32 x3), `normal` (f32 x3), `color` (f32 x3), `materialsPBR` (f32 x3: roughness, metallic, masking), plus a `Uint32` index.
- Backing arrays are the vendor's over-allocated arrays; use `geometry.setDrawRange(0, nbTriangles * 3)` to draw only the live region, and rebuild attributes (GPU rebind) whenever the vendor swaps/grows a backing array or a multires level switch occurs.
- Dirty updates: `Mesh.updateGeometry(iFaces, iVerts)` provides the modified vertex/face id sets each stroke step. Map vertex ids to spans: sort, merge with a gap threshold (start at 4096 elements `[Proposal]`), cap at ~64 ranges, otherwise fall back to a full-array write. Emit as `attribute.addUpdateRange(offset, count)` + `needsUpdate = true`. `[Verified that r184 WebGPU and webgl-fallback honor updateRanges per-range]`
- `[Verify-in-WS1]` whether the renderer clears `updateRanges` after upload in r184 or whether GeometrySync must call `clearUpdateRanges()` itself after commit.
- Normals: pass the vendor's incrementally updated normals straight through. Never call `computeVertexNormals` in live mode (`FrameStreamer.ts:293` already only computes when absent, so playback stays consistent).
- Dynamic topology: force the indexed path first (the drawArrays mode at `MeshDynamic.js:124` exists for WebGL1-era index limits; 32-bit indices are guaranteed on both Bozzetto backends). `[Verify-in-WS1]` that MeshDynamic behaves correctly with drawArrays disabled; if not, implement a non-indexed geometry variant as the contingency.
- Commit cadence: coalesce to one commit per animation frame during a stroke.

### 6.2 CameraAdapter

v1 surface is exactly two methods, consumed by `Picking.js:396,400`:

- `unproject(x, y, z) -> vec3` (gl-matrix)
- `project(vec3) -> [sx, sy, sz]`

Implement over the Viewer's three camera + canvas size, deriving gl-matrix view/projection from `camera.matrixWorldInverse` / `camera.projectionMatrix` per frame. `[Verify-in-WS0]` grep the vendored tree for `getCamera().` and any direct `._` camera field access to confirm the surface is closed (planning-session grep across `editing` + `math3d` found only the nine sites listed in 4.2; Gizmo's seven are deferred with it).

### 6.3 InputShell (ported from SculptGL.js)

Port the `onDeviceDown/Move/Up` state machine and the `Enums.Action` model; strip all render and yagui calls. Key integration subtlety: interaction arbitration. In sculpt mode the InputShell decides per SculptGL's rules (pick-hit + modifier keys) whether a drag is a sculpt stroke, a mask edit, or camera navigation; camera actions are forwarded to Bozzetto's `Controls` rather than reimplemented. `[Proposal]` Keep pointer-event handling and pressure; decide during WS2 whether hammerjs is still needed for touch gestures or whether Pointer Events cover it (prefer dropping the dependency if parity holds).

InputShell emits the events the recorder consumes:

- `strokeCommitted` from `onDeviceUp` when the ended action was `SCULPT_EDIT` (optionally `MASK_EDIT`, off by default `[Proposal]`).
- `cameraMoveEnded` when the ended action was `CAMERA_*`.

### 6.4 SculptSession (ported from Scene.js, non-GL parts)

Mesh list management (`getMeshes`, `setOrUnsetMesh`, `addNewMesh`, remove), primitives (`addSphere/addCube/addCylinder/addTorus`, default sphere on empty), plus a `fromBufferGeometry` entry so meshes loaded through Bozzetto's existing loaders become sculptable `MeshStatic` instances.

### 6.5 Overlays and material hooks

- Brush ring: replaces `drawables/Selection`. A line-loop positioned from the last picking hit (point + normal), radius = current world brush radius; screen-space fallback ring when no surface hit. Render after post-processing or with state that keeps it out of GTAO/DoF; acceptance is "ring never AO-darkened or defocused". `[Proposal on technique; requirement is a Decision]`
- Symmetry indicator: line/plane per mesh symmetry state.
- Mask tint: in `Materials.ts`, darken shaded color by the `materialsPBR` z channel in lit, matcap, and normal modes. `[Verify-in-WS3]` the exact mask semantics (which end of 0..1 is "masked") against `tools/Masking.js` and the upstream live build before wiring the tint direction.
- Stroke-time quality: hook the existing adaptive-quality tier to drop GTAO/DoF cost while a stroke is active (pointer down with `SCULPT_EDIT`).

### 6.6 SnapshotRecorder (the timelapse feature)

- Triggers: `strokeCommitted` (6.3) plus a `StateManager` wrapper emitting `topologyCommitted` for `pushStateCustom` / `pushStateAddRemove` ops (remesh, subdivision, add/remove). Note the per-stroke `pushStateGeometry` fires at stroke START (`SculptBase.js:64`); it is a "an edit is beginning" signal, never a capture trigger.
- Snapshot: copy `getVertices().subarray(0, nbV*3)` and `getTriangles()` sliced to `nbT*3` coerced to `Uint32Array`, for the currently active resolution; transfer both to the convert worker.
- Worker extension: add a message variant to `convert.worker.ts`, keeping the existing one intact:

```ts
type ConvertRequest =
  | { id: number; text: string; zUp: boolean }            // existing OBJ path
  | { id: number; positions: Float32Array; indices: Uint32Array }; // new raw path
```

The raw path calls the same quantize+gzip flow that `meshToGLB` feeds today, replying `{id, glb, tris}` with transfer. Only compressed frames stay resident on the main thread.
- Capture settings: `mode: 'everyStroke' | 'interval'` with `everyStroke` as the default (`[Decision]`, section 12; interval stays available, 2000 ms when chosen), memory budget with spill-to-OPFS beyond it, max frame count, and a per-frame wall-clock timestamp recorded at capture.
- Camera track: since the camera is native, sample `Controls` directly: a keyframe on `cameraMoveEnded` plus ~10 Hz sampling while a camera action is live, storing `{t, position, target, focalLength}`. Wheel/dolly paths must also record; `[Verify-in-WS5]` which Controls paths bypass the action state machine.

#### 6.6b Frictionless capture: consume the undo stack (WS2 review) `[Decision]`

Answering "how do we snapshot without hurting sculpting performance": the
work is already paid for. Every stroke begins with `pushStateGeometry`,
which snapshots exactly the vertices the stroke goes on to touch; the undo
stack therefore already holds a per-stroke delta history. Capture becomes a
deferred CONSUMER of undo states instead of an eager producer of copies:

- Nothing capture-related runs during a stroke or in the render loop. The
  recorder only marks states dirty (an integer watermark against
  `_curUndoIndex`).
- An idle pass (`requestIdleCallback`, falling back to a short timer after
  the last pointer/key activity) materializes one compact frame per
  not-yet-captured state: bounded main-thread array copies, then transfer
  to the convert worker for the existing quantize+gzip raw path (6.6).
  Frames beyond the memory budget spill to OPFS; upload also happens only
  from idle time (never while a pointer is down), with a `pagehide`
  best-effort flush. WS5 owns the manifest/chunking details.
- `StateManager.STACK_LENGTH` was raised 15 -> 64 in WS2 (the fuzz needs
  50; capture benefits from the headroom). When sculpting outruns idle
  time and a state is about to fall off the cap (`pushState` shift), it is
  drained into a pending-capture queue first, so no frame is ever lost.
- Per-stroke deltas cannot describe topology transitions. At topology
  boundaries (dyntopo toggle, ctrl+d subdivision, remesh, level steps,
  add/remove undo) the recorder takes an explicit full snapshot instead;
  those are discrete click-scale actions, never inside the stroke loop.
- Undo/redo themselves need no special casing for capture: walking the
  watermark forward captures the states that exist NOW; a user undoing
  past captured frames simply yields a timelapse that shows the sculpt,
  the mistake, and the recovery, which is the honest record we want.

#### 6.6c Reload persistence (shipped with WS2, pulled forward) `[Decision]`

A reload (or iOS evicting the home-screen app) must not lose work.
Upstream keeps sessions via its .sgl serialization, which section 4.2
cut; ScenePersist.ts does the same natively and goes one step past
.sgl: the WHOLE multiresolution stack autosaves to IndexedDB, byte-
faithful per level (vertices, live normals, colors, materials, detail
vectors), plus base topology (higher levels re-derive by subdivision),
transform, selection and symmetry. Same performance contract as 6.6b:
edits only mark a dirty flag (StateManager pushState/undo/redo wrapped
instance-side, no vendor edits); the serialize + put runs debounced in
idle time plus a visibilitychange/pagehide flush. Normal-size meshes
debounce at 1.5s; past 1.6M top-level tris the debounce stretches to a
five-minute cadence (WS2c review: those puts are tens of MB, but big
sculpts deserve saving too), with hide/dispose flushes bypassing the
gap. On sculpt entry a saved scene replaces the default sphere, with a
"Restored your last sculpt / Start fresh" toast; restore uses plain
setSelection (never the analysis/synthesis walk) so a stale top and
its details come back exactly, and post-reload level steps are bit-
identical to pre-reload ones. Undo history is the one thing that does
not survive (nor does upstream's): states reference live mesh object
graphs (AddRemove states hold whole meshes), so persisting them is a
large, bug-prone serialization surface for marginal value; the WS5
capture flow keeps long-term history as timelapse frames instead.

## 7. GUI specification (yagui replacement)

### 7.1 Standards (all `[Verified]` at the pinned bozzetto commit)

- Panels are instances of `Panel` (`src/ui/Panel.ts`): `PanelOptions`, collapse API (`toggleCollapsed/setCollapsed/isCollapsed`), `refreshControls()`, `dispose()`. The sculpt panel is a `Panel`, laid out through `EditorLayout` alongside the existing look panel.
- Rows are built with `src/ui/dom.ts` helpers: `div(className)`, `labelRow(label, control)`, `selectEl(...)`. Sliders and buttons must mirror the construction the existing look panel uses; do not invent parallel widget markup. Read the look panel's slider/button building code before writing any control.
- Tokens only, never literal colors or radii: `--bg --text --muted --text-muted --panel-bg --panel-border --control-bg --hover --accent --accent-hover --accent-soft --primary --radius --font-body --font-display --font-spec`. Theme switching rides `data-theme` on `<html>` via `src/ui/theme.ts` (`initTheme/getTheme/setTheme`, `bozzetto:themechange` event, `THEME_BG` warm ink `#1c1814` / warm paper `#f1ebe1`); both themes must pass visual review.
- Hotkeys go through the `installShortcuts(viewer, handlers)` pattern (`src/ui/shortcuts.ts`), with an uninstaller returned for mode teardown.

### 7.2 Sculpt panel structure `[Proposal]`

Sections, in order: Tool (button grid with hotkey hints; active tool uses `--accent`), Brush (radius, intensity, negative toggle; per-tool extras appear via `refreshControls()` on tool change), Symmetry (on/off, axis), Topology (dyntopo on/off + detail, multires subdivide/step up/step down, voxel remesh + resolution), Scene (add primitive, import mesh via existing loaders, clear), Capture (record toggle, mode, frame count + memory readout, finish -> hands frames to the timelapse project).

States to specify for every control: default, hover, active, disabled, and the two themes. Edge states: empty scene (Scene section prompts a primitive), recording with zero frames, memory budget reached (visible spill notice).

### 7.2b Touch toolbar (WS1 review rounds 5-6) `[Decision]`

Keyboards are rare on iPads, so a bottom toolbar ships ahead of the full
WS4 panel: a hold-to-carve Negative button pinned in the left corner
(strokes invert while held, exactly like holding alt; round 6 changed it
from a toggle per testing feedback) and the digit brushes centered,
labeled to match the hotkeys (1-6 at round 5, all nine digits since
WS2). Buttons and hotkeys stay in sync both ways.

Icons (WS2b): Flaticon uicons via the @flaticon/flaticon-uicons npm
package, solid straight style (fi-ss-*) for the brushes and thin
straight (fi-ts-*) for the Negative mode button (review pick; the
lighter face sets the modifier apart), with the hotkey digit kept as a
corner badge. Negative gestures: hold = momentary carve, double-tap =
latch carving on, a single tap unlatches (WS2 review). Vidar's picks where the npm release ships them; closest
in-pack stand-ins otherwise (the npm release trails the site), see the
results log for the exact per-brush mapping and substitutions.
Attribution ("Uicons by Flaticon") lives in the README credits. Built from the house tokens with 44px touch targets;
it sits above the transport bar when sculpting over a loaded project.

Tool-default deviation (round 6): the Crease brush defaults to the
raised ridge (upstream ships negative, the carving valley); alt or the
Negative button carves.

### 7.3 Hotkeys `[Proposal, resolve in WS4]`

Draft mapping mirrors SculptGL defaults where free; WS4 starts by enumerating keys already claimed by `ShortcutHandlers` (the README documents at least `g` for ground cycling) and resolving collisions in a single table committed with the code. No hotkey ships undocumented.

Locked ahead of WS4: while sculpt mode is active, the `1`-`9` hotkeys select sculpting brushes (tools), overriding the viewer's material-preset bindings (`1` = Lit (PBR), `2..n` = matcaps). The viewer bindings return when sculpt mode exits. The brush-to-digit assignment itself is settled in the WS4 collision table. `[Decision]`

Also locked (section 12): the mapping is Bozzetto-first overall. The viewer's DoF hotkey (`b`) is REMOVED entirely (viewer included; DoF stays toggleable in the settings panel), freeing `b` for brush size. `[Decision]`

### 7.4 Hotkey table (Vidar's map, WS1 review round) `[Decision, collisions noted]`

Active only while sculpt mode is mounted; captured ahead of the viewer's
shortcut listener so viewer bindings (digits = material presets, `w` =
wireframe, `s` = shading, `r` = reset view, `f` = frame model) are overridden
and return on exit.

| Key | Action | Notes |
|---|---|---|
| left drag on mesh | sculpt stroke | miss = orbit (unchanged) |
| alt held during stroke | negative sculpting | ZBrush parity; Alt keydown is captured/preventDefaulted so Firefox's menu bar never grabs it |
| shift + left drag | smooth stroke | temporary Smooth tool while held (ZBrush parity; review round 3) |
| alt + click | select model under cursor | inert until multi-mesh ships |
| alt + q | isolate model | reserved (multi-mesh) |
| ctrl + left drag | mask (paint) | temporary Masking tool while held |
| ctrl + alt + left drag | unmask | Masking tool, negative |
| ctrl + z / ctrl + shift + z | undo / redo | |
| ctrl + d | subdivide (add a level) | top level only; confirm dialog past 4M tris (upstream parity, restored after a 4070 held 60fps at 4M), hard ceiling 16M |
| d | step up a subdivision level | |
| shift + d | step down a subdivision level | |
| b | brush size (hold + drag horizontally) | ring stays anchored while adjusting |
| s | brush strength (hold + drag vertically, up = stronger) | The source map listed `s` for both brush strength and shadows; resolved as `s` = strength, `shift+s` = shadows, and Vidar confirmed the split. Vertical per review round 2. |
| shift + s | toggle shadows on/off | confirmed |
| x | symmetry toggle | |
| q | brush mode | reserved (returns from gizmo when Transform ships; Maya-style QWER) |
| w / e / r | gizmo move / rotate / scale | reserved; Transform tool is deferred past v1 |
| l (hold) + drag | rotate light rig | horizontal drag = rig azimuth; HDRI rotation follows |
| f | frame the whole current mesh | revised in review round 3. The orbit pivot separately follows the work: each stroke end re-pivots to the last edit point, projected onto the current view ray so the view itself never moves (round 6: the naive re-target made the view jump) |
| 1 | Crease brush | |
| 2 | Move brush | (SculptGL "Move"; drag-style) |
| 3 | Standard brush, clay mode on | default tool |
| 4 | Inflate brush | |
| 5 | Pinch brush | |
| 6 | Flatten brush | |
| 7 | Smooth brush | WS2; shift+drag remains the hold-to-smooth shortcut |
| 8 | Drag brush | WS2 |
| 9 | Twist brush | WS2 |

LocalScale did not get a digit (all nine are taken); it ships through the
WS4 tool palette instead. Transform and Paint stay deferred per section 2.

### 7.5 Sculpt-mode defaults (WS1 review round) `[Decision]`

Chosen for GPU cost after the first PC test ("not too great"; iPad untested):

- Lighting: key light only (fill and rim disabled; the cheap hemisphere
  ambient stays so the dark side reads). Shadows off by default
  (`shift+s` re-enables).
- Depth of field: off by default in sculpt mode (and its viewer hotkey is
  gone; the settings panel still toggles it).
- GTAO: out of the render graph entirely in sculpt mode (not merely
  strength 0, which still pays the pass). Decided after the first RTX
  3060 numbers: ~10 fps at both 196k and 786k tris meant the cost was
  resolution-bound post-processing, not triangles; removing it (plus the
  HDRI sampling) took the machine to a stable 30 fps at every level. In
  its place, an 8-tap depth-only SSAO keeps creases reading. (Round 2
  used a normal-divergence cavity term; with flat shading every facet
  edge is a normal discontinuity, which painted a grid at low
  subdivision levels - depth ignores facet normals, so round 3 replaced
  it.) GTAO returns as an opt-in render option later (WS4 palette).
- HDRI environment: not sampled in sculpt mode (scene.environment is
  null; restored on exit). IBL cost is per-fragment in the PBR shader,
  so the cheapest environment is none; the hemisphere ambient plus key
  light carry the look. Also a later render option.
- Material: flat shading by default in sculpt mode.
- Stage: ground/floor/pedestal hidden by default in sculpt mode (review
  round 4: the stage hid the sculpt's underside); g or the panel cycles
  it back, and the saved mode returns on exit.
- Entry: /?sculpt=1 boots a project-less sculpt session on a synthetic
  one-frame manifest (no API call, no timelapse load, no transport bar,
  no environment fetch); the gallery Sculpt! link points there. The
  ?tl=<id>&sculpt=1 form remains for sculpting over a loaded project.
- Stylus pressure (round 8): PointerEvent pressure feeds the vendored
  Tablet state during strokes, swaying BOTH brush radius and intensity
  (factors 0.75/0.75; vendor default enabled radius only). The
  PointerEvent spec reports 0.5 - Tablet's neutral - for pressed
  pressure-less devices, so mouse and plain touch behave unchanged;
  pressure resets to neutral at stroke end so hover picking never sees
  stale values. The factors become palette sliders in WS4.
- The settings panel drives ALL sculpt shading (review round 3): the
  sculpt geometry is adopted by the viewer's display mesh, so material
  mode, albedo/roughness/metalness, matcaps, smooth/flat and the
  wireframe overlay work unchanged. The panel gains a master Shadows
  toggle (viewer and sculpt, synced with shift+s), and the depth of
  field section hides while sculpting (DoF is a view/render-mode
  concern).
- Default sphere: about 50k triangles (24,576 quads), down from ~200k, with
  the retained multiresolution levels available for `d` / `shift+d`
  stepping and `ctrl+d` subdivision beyond.
- The look panel's settings still apply on top; these are only the mount
  defaults, and the previous viewer state is restored on unmount.

### 7.6 Brush cursor (WS1 review round) `[Decision]`

WS2 review addition: the cursor (ring, dot, strength line, both the 3D
and the SVG fallback representations) turns blue (#4d8fd1) whenever
smoothing is effective - the Smooth tool selected, or shift held (the
temp-smooth preview and the stroke itself). Restored with the tool on
release.


Two representations behind one cursor (review round 2): over the mesh, a
3D ring aligned to the picked surface normal, drawn at the intersection
point at the tool's world radius, with a center dot and a line along the
normal whose length shows strength (radius x intensity, i.e. 10x the
standard brush's true displacement). Off the mesh, a screen-space DOM
fallback ring at the pointer. While holding `b`/`s` to adjust, the cursor
anchors in place and the ring/line update live. Aligned-vs-screen becomes
a tools-palette option later (WS4). The ring draws depth-test-off with a
late render order so the composite never obscures it; the 3D
symmetry-plane indicator remains WS3.

The hotkey guide (H) is mode-aware: it shows the sculpt table while
sculpt mode is active and the viewer table otherwise. The gallery
carries a "Sculpt!" link that opens sculpt mode directly (review
round 2).

## 8. Manifest and viewer extensions `[Proposal]`

Extend `src/types/manifest.ts` additively (existing timelapses unaffected):

```ts
interface ManifestTiming { origin: string; timestampsMs: number[]; }   // per frame
interface CameraKey { t: number; position: number[]; target: number[]; focalLength?: number; }
interface ManifestCameraTrack { keys: CameraKey[]; }
// ManifestConfig gains timing?: ManifestTiming
// Manifest gains cameraTrack?: ManifestCameraTrack
// ManifestDefaults gains followRecordedCamera?: boolean
```

Viewer additions: a transport toggle "recorded camera" that interpolates between keys (position/target lerp, focal length lerp), defaulting off with the DCC camera as today; playback pacing modes `fixed-fps` (current behavior) and `realtime-scaled` (map `timestampsMs` with min/max clamps), with the mp4 exporter honoring the same pacing.

## 9. Workstreams and acceptance criteria

Ordered; each lands as its own reviewed change.

- WS0 Vendor + spike (go/no-go). Vendor at pinned hash, codemod, aliases, d.ts shims; GeometrySync v0 (position+normal, full-array uploads); CameraAdapter (two methods); minimal InputShell (Brush, Smooth, Drag, hardcoded keys, no overlays); ported `addSphere`. Acceptance: sculpting visibly works on WebGPU AND on the forced WebGL2 fallback; median frame time during a continuous stroke at ~1M triangles measured and recorded in `docs/sculpt-spike-results.md`. Go threshold `[Proposal, owner-adjustable]`: under 16 ms median on the dev machine, or a written optimization path.
- WS1 GeometrySync complete. updateRanges coalescing, growth/rebind, dyntopo indexed validation (contingency: non-indexed variant), multires swap via the Multimesh seam, color + materialsPBR attributes. Acceptance: dyntopo sculpt and multires level switching stable; per-stroke upload bytes logged and bounded.
- WS2 Tools + undo/redo + masking. All tools except Transform and Paint; StateManager wired; symmetry functional; hammerjs decision made. Acceptance: per-tool parity pass against the upstream live build; 50-deep undo/redo fuzz without corruption.
- WS3 Overlays + materials. Brush ring, symmetry indicator, mask tint (direction verified), stroke-time adaptive quality. Acceptance: ring unaffected by GTAO/DoF; frame time during stroke within the WS0 budget with effects enabled.
- WS4 GUI. Section 7 in full. Acceptance: tokens only (no literal colors), both themes pass, collapse works, `refreshControls` drives per-tool options, hotkey table implemented with zero collisions, `npm run typecheck` green.
- WS5 Capture + manifest + playback. Section 6.6 and 8; `/create` gains a "start sculpting" entry whose finished frames flow into the normal project; single-file `.html` export includes sculpt-born frames; mp4 pacing modes. Acceptance: a 50-stroke sculpt plays back in the viewer with identical look to live; recorded-camera toggle interpolates smoothly; export round-trips.
- WS6 Cleanup. LICENSE placement verified, no upstream assets present, README changelog entry, dead flags removed.

## 10. Risks and mitigations

- Scattered dirty indices defeating range coalescing (dyntopo reorders vertices): the full-write fallback bounds the worst case; if full writes dominate, per-attribute double-buffering or a compaction pass is the next lever. `[Proposal]`
- Post-effects cost during strokes: adaptive-quality hook (6.5) is mandatory, not optional.
- Vendored JS drifting from typecheck reality: the d.ts seam shims are the contract; any bridge/vendor mismatch must fail `npm run typecheck`, so keep shims minimal and honest.
- Hotkey collisions with viewer shortcuts: WS4 collision table before implementation.
- Line-number drift: all citations pinned to the two hashes at the top; re-grep before editing if HEAD has moved.

## 11. Estimates

`[Estimate]` WS0: 2-3 days. WS1: 3-5. WS2: 4-6. WS3: 2-4. WS4: 3-5. WS5: 3-5. WS6: 1-2. These assume single-developer focus and no upstream surprises; the WS0 spike exists precisely to invalidate them cheaply.

## 12. Open questions, answered at WS0 review (2026-08-27)

All five are now locked. `[Decision]` on each.

1. Reference hardware for the go/no-go numbers: iPad Air and a desktop PC.
   The WS0 container numbers (docs/sculpt-spike-results.md) are a floor;
   re-run the spike measurement on these two before treating any perf
   number as final.
2. v1 tool set confirmed: everything except Transform and Paint.
3. Hotkeys are Bozzetto-first (no SculptGL muscle-memory constraint).
   Vidar supplies a ZBrush-style map for the WS4 collision table; known so
   far: `1`-`9` select brushes (7.3), `b` is brush size. Note `b` currently
   toggles depth of field in the viewer shortcuts; in sculpt mode the
   sculpt binding wins, same override rule as the digits.
4. Default capture mode: every stroke (`mode: 'everyStroke'`); the
   interval mode remains available as an option.
5. Entry points: sculpt mode ships in both `/create` and `/admin`,
   surfaced by sign-in state. Signed in to the admin interface -> the
   /admin editor flow; not signed in -> the public /create flow.

## 12b. Backlog (noted for later, not scheduled)

- File menu: save / load sculpts (serialize the active mesh; likely the
  OPFS spill store from 6.6 doubles as the save target).
- Export to OBJ from sculpt mode (positions + faces; the CLI parser is
  the round-trip test).

## 13. Operating rules for Claude Code

- Read the reference map (section 3) files before writing code; verify any cited line number at the pinned hashes before relying on it.
- Never modify vendored algorithmic internals; edits only at the seams in 4.2, each tagged `// BOZZETTO EDIT: <reason>`.
- ASCII only in code, comments, and identifiers. No em-dashes in any authored text or docs.
- `npm run typecheck` must stay green after every workstream; the vendor stays plain JS outside typecheck by design.
- Keep the upstream `LICENSE` at `src/sculpt/vendor/LICENSE` from the first vendor commit.
- Small commits, one workstream per PR-sized change, each with a short results note (what was verified, what deviated from this document and why).
- When tool behavior is ambiguous, compare against the upstream live build rather than guessing; note the comparison in the change description.
