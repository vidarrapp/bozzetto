## Shared stroke infrastructure in Bozzetto sculpt: how it works now, with file:line

Read-only. Nothing was edited, built or run.

### 0. Layers, top to bottom
1. **DOM input.** `InputShell` handles pointer and keyboard. It installs capture-phase listeners on the viewer container (InputShell.ts:495-530).
2. **Vendor dispatcher.** `SculptManager` holds one live tool index and the `_tools[]` instances (SculptManager.js:8-56).
3. **Tool lifecycle.** `SculptBase` covers start, sculptStroke, makeStroke, stroke and end (SculptBase.js:39-212).
4. **Picking.** `Picking` does the ray hit, the vertex gather and the radius (Picking.js:157-422). It uses `CameraAdapter` (CameraAdapter.ts:26-57).
5. **Mesh update.** `Mesh.updateGeometry` recomputes normals and the octree, then feeds the dirty ring to the bridge (Mesh.js:388-406).
6. **GPU sync.** `GeometrySync` uploads ranged three.js `BufferAttribute`s (GeometrySync.ts:292-420). The viewer's rAF draws.

`SculptSession` is the "main" object the vendor core calls (SculptSession.ts:269-410). Its constructor swaps Bozzetto's brushes into the vendor registry (SculptSession.ts:373-405).

### 1. Stroke lifecycle

**pointerdown** (InputShell.ts:1283-1604):
- **Routing.** Touch goes to finger navigation (1297-1303). Pointer arbitration lets a pen outrank a finger. A second finger joining a finger stroke abandons it and undoes the dab if the stroke is younger than 250 ms (1323-1352).
- **Held keys.** b, s and l take the press (1364-1367; heldKeyPress 1616).
- **Modes.** Select mode (1378-1397), the transform gizmo (1400-1424) and the Ctrl+Shift loop-mask drag (1430-1433) each take the press.
- **Momentary tool swaps.** Ctrl sets MASKING (1444-1446). Shift sets SMOOTH, or PAINT_BLUR over Paint, copying Paint's radius and strength (1447-1462). The swap is just `setToolIndex`; the previous index is stashed in `maskPrevTool`.
- **Paint.** Alt makes Paint's stroke an eyedropper via `_pickColor` (1473-1478).
- **Polarity.** `_negative` is set from the toolbar latch, the arm and Alt, and saved for restore (1480-1493).
- **Locked objects.** A pre-pick refuses the stroke and orbits instead (1500-1510).
- **Start.** `worldScale.sync()` sets `_radius` from the depth under the press (1512). `feedPressure` (1513, 557-576) runs, then `SculptManager.start(false)` (1517).
  - Inside, `SculptBase.start` picks every visible mesh and makes the hit mesh active via `setOrUnsetMesh` (SculptBase.js:43-48; SculptSession.ts:548-572). That active mesh is then rebound to the main `GeometrySync` (mode.ts:733-740).
  - It also picks the mirrored side, `pushState()` (the stroke's one undo entry) and `startSculpt()`, which lays the first dab (SculptBase.js:50-63).
- **A miss.** Ctrl off the mesh becomes a tap (invert mask) or a drag (zoom) (1523-1534). Anything else falls through to OrbitControls (1535-1541).
- **A hit.** `_action = SCULPT_EDIT` (1544). The ring shrinks to a dot or dims after 250 ms (1583-1589). Pointer capture is taken, except for touch (Safari caveat, 1590-1601).

**pointermove** during a stroke (InputShell.ts:1747-1792):
- `feedPressure` and `worldScale.sync()` run, then `SculptManager.preUpdate()` and `update()` (1776-1777).
- `preUpdate` re-picks at the current pointer for continuous-capable tools (SculptBase.js:80-96). TWIST/Polish, MOVE, DRAG and LOCALSCALE skip it (SculptManager.js:58-69).
- `update` calls `sculptStroke` (SculptBase.js:98-102). That divides the travel since the last dab into steps of `spacing * _radius * pixelRatio` (SculptBase.js:133-153; per-tool `_spacing`, a Bozzetto edit at SculptBase.js:21-26 and 137). Each step calls `makeStroke`.
- `makeStroke` (SculptBase.js:166-195) runs, in order:
  1. Ray-pick the active mesh.
  2. `pickVerticesInSphere` and `computePickedNormal`.
  3. `stroke(picking, false)`.
  4. Pick the mirrored side on the surface the dab just left (a Bozzetto edit, 174-179).
  5. `stroke(pickingSym, true)`.
- After all dabs, `updateRender()` calls `updateMeshBuffers()` (static mesh: `updateGeometryBuffers`; dynamic topology: `updateBuffers`) and then `render()`, i.e. `requestRender` (SculptBase.js:155-203; SculptSession.ts:610-612).
- The ring reuses the stroke's picking via `hoverSurface(false)` (InputShell.ts:1781-1787). Timing goes to the frame meter through `onWork` (1792; mode.ts:1294).
- Each pointermove is handled synchronously. There is no `getCoalescedEvents` and no rAF batching of strokes. Hover picking, by contrast, is deferred to once a frame (`hoverDue`, 1764; `flushHover` 1802-1820, called from mode.ts:842-843).

**The shared shape of `stroke()`** (vendor Brush.js:21-54, mirrored in every Bozzetto override, e.g. tools.ts:917-973):
1. `getPickedVertices`.
2. Intensity = `_intensity * Tablet.getPressureIntensity()`.
3. `updateProxy` where the tool has no accumulation.
4. `stateManager.pushVertices(iVerts)` (undo snapshot).
5. `dynamicTopology(picking)` (SculptBase.js:370-418).
6. `getFrontVertices` (215-230).
7. A frame from `areaNormal`/`areaCenter`, each weighted by the mask in `mAr[i*3+2]` (233-273).
8. The deformation loop with falloff × mask.
9. `mesh.updateGeometry(getFacesFromVertices(iVerts), iVerts)`.

Paint and Mask write colours and materials instead and call `updateDuplicateColorsAndMaterials` (Paint.js:104; Masking.js:29-35).

**Mesh to GPU:**
- `Mesh.updateGeometry` updates face AABBs and normals, then the normals of every vertex on the changed faces (a Bozzetto edit, Mesh.js:390-397), then `updateOctree`. It hands the vertex ring to `_bridgeSync.onDirtyGeometry` (Mesh.js:403-405).
- `GeometrySync.onDirtyGeometry` appends the ids to a JS `number[]` (GeometrySync.ts:292-300).
- `onGeometryBuffers` (302-315) runs `commitGeometry` (369-420). That sorts the ids in a reused `Int32Array` and coalesces spans, merging gaps of 4096 elements or less and capping at 64 ranges, otherwise uploading the full arrays (25-27, 444-474). It then calls `addUpdateRange` on position and normal.
- three.js performs the per-range GPU writes at the next render. Ranges accumulate across several moves in a frame (GeometrySync.ts:12-21).
- Colour and material changes flag the whole attribute dirty, only the one that changed (322-337).
- Dynamic topology goes through `onAllBuffers`, a full upload on every step (344-367).
- A swapped backing array (growth, dynamic topology, level change) triggers a full attribute rebuild (130-146, 188-206).
- Upload only marks `viewer.invalidate()` (mode.ts:344-347). Objects other than the active one get their own `GeometrySync` (mode.ts:606-643).

**pointerup** (InputShell.ts:1827-1914):
- Ctrl+click on a poly group (1883-1896).
- `endStroke`: `SculptManager.end()` → `tool.end()` → `balanceOctree()` (SculptBase.js:65-68; Mesh.js:1736-1756), then `stateManager.cleanNoop()`. Timed; ends of 16 ms or more go to the perf log (2193-2202).
- `focusEdit` sets the orbit pivot (1903-1904).
- `restoreStrokeTool` undoes the swap and the `_negative` override (2237-2248). `spendArm` follows. `Tablet.pressure` returns to 0.5 (1908).

**Dead upstream paths:**
- Continuous mode: `_continuous` is never set true, so the `setInterval` path at SculptManager.js:18, 75-81 never runs.
- `_lockPosition` is false on every tool, so `updateSculptLock` never runs (SculptBase.js:104-126).
- Drag, Move, LocalScale and Twist override `sculptStroke`/`startSculpt` with anchor-based flows (Drag.js:16; Move.js:27-110; LocalScale.js:13,23; Twist.js:23,46).
- LOCALSCALE is in the registry but has no key, button or panel. `Enums.Tools.TRANSFORM` (12) has no instance (Tools.js:14).

### 2. Tool registry and selection
- **Identity.** A tool is a vendor `Enums.Tools` integer (Enums.js:18-40, "shouldn't change (serialized)"). RAKE=13 and PAINT_BLUR=14 are Bozzetto additions.
- **Registry.** Tools.js:16-29 builds it, and `SculptManager.init` instantiates every tool once (SculptManager.js:50-56). `SculptSession` then overwrites slots with Bozzetto classes:
  - VolumetricMove, ClayStripsBrush in BRUSH, PolishBrush in TWIST, RakeBrush, CreaseBrush, InflateBrush, FlattenBrush, PaintBrush, PaintBlurBrush and StableSmooth (SculptSession.ts:373-405).
  - Paint gets `_spacing` 0.05 (393), and the blur shares Paint's curve object (398).
  - Pinch, Drag, Masking and LocalScale stay vendor.
- **The tool surface the bridge uses** is ad hoc fields on the instance: `_radius`, `_intensity`, `_negative`, `_spacing`, `_color`, `_pickColor`, `curve` and so on (types/sculptgl.d.ts:284-325). Capability checks are `typeof` probes (InputShell.ts:696-781, 1169).
- **Selection** goes through `InputShell.selectBrush(index)` (InputShell.ts:2565-2586):
  1. Refused mid-stroke.
  2. Exits the gizmo and Select mode.
  3. `setToolIndex`.
  4. Forces `_clay = true` on BRUSH.
  5. `session.applyBrushSymmetry(index)`.
  6. `syncCursorBrush`.
  7. `onToolChange`, which chains toolbar `refresh` and `SculptPanel.refreshBrush` (SculptToolbar.ts:297; mode.ts:1845-1849).
- **Select and Transform are not vendor tools.** Select (q) is a shell mode, `selectMode` (InputShell.ts:907-946). Transform (t) is the three.js gizmo reached through `hooks.transformToggle`. Their toolbar buttons call `onToggleSelect`/`onToggleTransform` (SculptToolbar.ts:273-289). `uiMode()` tells the panel which one is up (InputShell.ts:912-916).

### 3. Per-tool settings: where they live, the panel, persistence
- **Storage.** On the tool instance: `_radius` (screen px), `_intensity`, `_spacing`, `curve`, and the Rake/Smooth/Move/Crease/Polish fields. Side stores keyed by tool index:
  - `DynamicsStore` (dynamics.ts:66-112)
  - `SymmetryStore` (symmetry.ts:182-220)
  - world-scale per-brush sizes (worldScale.ts:72-76, 219-240)
- **Panel.** `SculptPanel.refreshBrush` rebuilds the rows for the active index on every tool change (SculptPanel.ts:125-394):
  - Common rows: Size (195), Pressure: size and its curve (213-235), Strength and its pressure (240-284), Spacing (288-295).
  - Per-tool extras are a hard-coded `if/else` on `Enums.Tools` (302-394), each building its own controls: Move falloff, the clay/crease/polish/paint curves, Crease pinch, Polish plane lock and build-up, the Rake block (buildRake), and Smooth.
  - "Smooth (Shift)" shows under every brush except Paint (441-488). Symmetry is a section of its own (676-708).
  - The panel is named from `TOOL_NAMES` (SculptToolbar.ts:47-61).
- **Persistence: brush settings ride the scene, not the device.**
  - `collectSettings` puts world scale, sizes, dynamics, paint colour, spacing, curves, strength, rake, smooth and symmetry into `SavedScene.settings` (mode.ts:1399-1415; schema ScenePersist.ts:21-83).
  - `applySettings` restores them in a set order: the Rake preset before strength before curves (mode.ts:1432-1458).
  - They are written by the autosave (`persist.decorate`, mode.ts:1962-1970; IndexedDB) and by .bozz saves (mode.ts:1501-1504).
  - Any change calls `input.onBrushSettingsChange`, which marks the autosave dirty (mode.ts:1989).
  - Each table has its own revision number for migration (SPACING_REV InputShell.ts:182, STRENGTH_REV 239, PROFILE_REV profile.ts:95, SMOOTH_REV ScenePersist.ts:115).
  - Tables are `Record<number, …>`, sanitised with keys of 1-3 digits (sanitize.ts:36, 80-89, 202-262).
- **Not persisted at all:**
  - Move falloff, Crease pinch, Polish plane lock and build-up. Their setters do not call `onBrushSettingsChange`, and `SculptSettings` has no field for them (SculptPanel.ts:314, 342, 364, 378).
  - The active tool. It starts at BRUSH (SculptManager.js:11) and nothing restores it.
  - The toolbar order, which is fixed in code.
- **Device-level preferences** go through `deviceStore`: the keymap under `bozzetto-keymap` (keymap.ts:181, 402-424), app settings including `toolKeys`, the badge-visibility toggle (settings.ts:116), and gizmo parts (mode.ts:1247,1750).

### 4. Tool bar slots and hotkeys: three hand-kept tables
- **keymap.** One action per tool, not per slot, with default chords: `tool.select` q, then `tool.crease` 1, `tool.move` 2, `tool.clay` 3, `tool.inflate` 4, `tool.pinch` 5, `tool.flatten` 6, `tool.rake` 7, `tool.drag` 8, `tool.polish` 9, `tool.paint` 0 (keymap.ts:92-102). `gizmo.toggle` is t (61).
  - Chords are matched by physical key (keymap.ts:200-224). `actionForChord` is a linear scan (306-312).
  - Users rebind in Preferences. `rebind` unbinds any other action on the chord in a shared mode, and overrides persist per device (340-355).
- **InputShell.** A `switch` maps action id to `Enums.Tools` (InputShell.ts:2456-2479), inside `onKeyDown`, which asks `keymap.actionFor(e,'sculpt')` (2280).
- **SculptToolbar.** A literal tuple array of `[enum, badge digit, aria label, svg slot name, icon class, tip]` (SculptToolbar.ts:255-270). Buttons are built in that order between Select and Transform (273-289), each wired `onTap` → `input.selectBrush(id)` (278).
  - The badge and tooltip `<kbd>` are the literal digit (359-383). They are not `keymap.chordFor`, so a rebind in Preferences already leaves the badge wrong today.
  - The e2e suite finds buttons by badge text (tests/e2e/smoke.mjs:3545, 3552, 3564).
  - Help text also hard-codes "Default hotkey: **N**" (help/content/tools.ts:41-156).
- **Buttons.** `onTap` handles the tap only: it preventDefaults touchstart to kill the iOS callout, and acts on lifts that land on the button (ui/dom.ts:88-114).
- **Negative button.** It is the one with long-press logic: its own 600 ms timer, measured by event timestamps, with no pointer capture because of Safari (SculptToolbar.ts:29, 130-211). That is the existing pattern for long-press-to-detach.

### 5. Symmetry
- **Per brush.** `SymmetryStore` (symmetry.ts:182-220), with the default on, X axis.
- **Applying it.** `applyBrushSymmetry(tool)` sets the vendor's single live flag `sculptManager._symmetry` and writes the axis into every mesh's shared symmetry normal (SculptSession.ts:714-766). It is called from `selectBrush` and `applySettings`, never on Shift or Ctrl swaps, so stand-ins inherit the brush in hand's symmetry.
- **The mirror itself.** A second `Picking(this, true)` (SculptSession.ts:407) mirrors the ray across the mesh's local plane (Picking.js:216-221). `makeStroke` runs the whole per-dab pipeline again for that side (SculptBase.js:182-193); the mirrored radius is copied from the main side (187).
- **Ring.** The mirrored ring is drawn on hover only (SculptSession.ts:2139-2169; InputShell.ts:1813-1818).
- **Bozzetto side state.** Brushes with their own per-side state keep it keyed `main`/`sym` (tools.ts:248-281, `sideOf` 282).

### 6. Pressure dynamics
- **Input.** `feedPressure` writes `Tablet.pressure` and `Tablet.pen`. A pen reports its real pressure, zero included; mouse and touch get 0.5 (InputShell.ts:557-576).
- **Patched getters.** `DynamicsStore.install` (dynamics.ts:114-152) replaces the vendor Tablet getters (Tablet.js:7-13) with per-tool lookups:
  - `getPressureIntensity` and `getPressureRadius` return `1 + amount*(curve(p)*2-1)`.
  - `getPressureLayer` returns a 0..1 term used by the cm brushes (`strengthPressureTerm`, tools.ts:192-194).
- **Curves.** linear, soft = p^0.6, firm = p^1.8 (dynamics.ts:36-40).
- **Defaults.** Crease and Paint have both size and strength on, Drag neither, everything else strength only (57-61).
- **Where it is read.** Radius pressure enters through `Picking.computeWorldRadius2` (Picking.js:393-402). Intensity pressure is read by each `stroke()`.
- **Keying quirk.** The store is keyed by `getToolIndex()` (InputShell.ts:482). During a Shift or Ctrl swap a stroke therefore uses Smooth's or Mask's dynamics entry, which has no UI.

### 7. Profiles
- **Model.** `ProfileCurve` holds 2-8 Bezier anchors, baked into a 256-entry `Float64Array` LUT on change (profile.ts:579-718).
- **Sampling.** `sample(t)` is the per-vertex read, a lerp in the LUT. While the anchors equal a preset with a closed-form kernel it calls that kernel exactly, for parity (profile.ts:649-660, 704-712).
- **Strength sharing.** `lineIntegral()`, cached by revision, is how cm-strength brushes share one stroke's displacement among its dabs (profile.ts:670-679; e.g. tools.ts:944-947).
- **Presets.** CLAY, CREASE, POLISH, PAINT and TINE (profile.ts:820-862).
- **Which tools have curves.** `InputShell.CURVE_TOOLS` lists BRUSH, CREASE, TWIST, PAINT and RAKE (InputShell.ts:825), with serialize and load at 836-863.
- **Undo.** None for curves (profile.ts:575-578).

### 8. Picking
- `intersectionMouseMeshes` tests every visible mesh, keeps the nearest, then computes the radius (Picking.js:157-192).
- `intersectionMouseMesh` tests one mesh (195-203).
- `intersectionRayMesh` collects octree ray candidates, then runs triangle and quad tests, skipping hidden poly-group faces (206-270, 229-230).
- `pickVerticesInSphere` runs an octree sphere query, then a distance test per vertex. It sets `SCULPT_FLAG` and builds the result in the shared scratch pool (`Utils.getMemory`, Utils.js:169-174), copied out (Picking.js:273-307).
- `pickVerticesInSphereTopological` is the ring-walk version Move uses (Picking.js:318-391; Move.js:42-46).
- **Radius.** `computeWorldRadius2` projects the hit, offsets it by the screen radius × pressure and unprojects. World scale instead drives `_radius` from a pinned world size each press and move (worldScale.ts:146-151).
- **Poly-group hooks.** `Picking.hiddenFaces` and `Picking.hiddenVertices` are installed by polyGroups (Picking.js:470-477; polyGroups.ts:292-293).
- **Camera.** `CameraAdapter.project`/`unproject` re-multiply and invert a 4x4 matrix on every call (CameraAdapter.ts:26-57). That happens several times per dab per side.

### 9. Undo
- **One state per stroke**, opened at start (SculptBase.js:57, 70-72):
  - `StateGeometry` for a static mesh, `StateDynamic` under dynamic topology (StateManager.js:46-51).
  - `StateColorAndMaterial` for Paint and Mask (Paint.js:31-34; Masking.js:24-27).
- **Capture.** Vertices are captured lazily per dab: `pushVertices` dedupes by `STATE_FLAG` into plain JS arrays (StateManager.js:93-96; StateGeometry.js:38-57). Dynamic topology also pushes faces (SculptBase.js:384, 394).
- **Stroke end.** `cleanNoop` drops empty states (StateManager.js:131-137; InputShell.ts:2197).
- **Stack.** Depth is 64 (SculptSession.ts:366). Undo and redo are blocked mid-stroke (638-650). `historyStep` fires the active-object and level notices (658-675).
- **Two-finger cancel.** It compares state identity, not depth (InputShell.ts:1336-1342).
- **Autosave.** It wraps `pushState`, `undo`, `redo` and `SculptManager.end` to mark itself dirty (ScenePersist.ts:762-776).
- **Settings.** Tool settings are not in the history.

### 10. Performance-sensitive loops
- **Dabs per move:** floor(dist / (spacing·r·dpr)). The spacing floor is 0.02 because tighter stalls (InputShell.ts:186). Each dab does:
  - 1-2 ray picks and sphere gathers, doubled with symmetry
  - several fresh `Uint32Array` copies: picked vertices, front vertices, the face/vertex lists and the `updateGeometry` ring (Mesh.js:396, 669-698; SculptBase.js:217-229)
  - the deformation loop over typed arrays (`vAr`, `nAr`, `mAr` Float32)
  - the normal and octree update for the ring
  - a `push` per vertex into the GeometrySync dirty list and the undo arrays

  Plus one extra `preUpdate` raycast per move.
- **Once per move:** sort and coalesce, `addUpdateRange`, and an SVG ring rebuild (48 projections), skipped in dot mode (BrushCursor.ts:530-576, 596).
- **Once per stroke end:** `balanceOctree` (logged if 16 ms or more).
- **Existing mitigations:**
  - pixel ratio cached by a ResizeObserver (SculptSession.ts:349-363, 430-433)
  - canvas rect cached per press (InputShell.ts:310-316)
  - hover picks once per frame
  - reused sort buffer (GeometrySync.ts:425-436)
  - colour versus material uploads split
  - Bozzetto brushes reuse grown typed tables (`StrokeMoves`, tools.ts:284-353)
  - `Utils.releaseMemory` after a remesh (Utils.js:176-182)
- **Dynamic topology:** a full upload on every step (GeometrySync.ts:338-367).

### 11. Workers and GPU
- **No worker and no GPU compute on the stroke path.** Everything runs on the main thread in JS.
- **The only worker** is the quad remesh (quadRemesh.ts:69-128, quadRemesh.worker.ts).
- **GPU use** is upload plus draw only. Mask, roughness and metalness ride the `materialsPBR` attribute (GeometrySync.ts:134; viewer/Materials.ts:119-135). The provoking-vertex order differs between WebGPU and WebGL2 (mode.ts:343).
- **The brush cursor is an SVG overlay**, not GPU lines (BrushCursor.ts:1-30, 319, 579-608).

### 12. Facts that bear on the tool library, the dock and the node graph
- **Everything is keyed by the vendor enum integer:**
  - `_tools[]`, the dynamics defaults, symmetry, world-scale STAND_INS (worldScale.ts:61-65)
  - CURVE_TOOLS, the strength skip list (InputShell.ts:1236-1238) and LEGACY_STRENGTH (tools.ts:200-205)
  - TOOL_NAMES, the panel `if/else`, help text, and every scene-record table

  Tools users build or duplicate need their own stable id. Today's tables only accept 1-3 digit keys.
- **Hotkeys are bound per tool, not per slot.** Making hotkeys follow dock order means slot actions, e.g. slot.1-slot.10, resolved to whatever tool sits in that slot. The three tables in section 4 collapse into one slot list, and the badges have to read from keymap.
- **Long-press-to-detach** has to bypass `onTap` and copy Negative's timer pattern. No pointer capture on touch; preventDefault on touchstart.
- **Momentary stand-ins** (Smooth, Mask, Paint blur) are a different kind of tool from toolbar tools. They borrow the brush in hand's symmetry and world size, but have their own dynamics and, in screen scale, their own pixel radius.
- **Natural node boundaries already in the shared pipeline:**
  - **Stroke sampler:** spaced dabs (SculptBase.sculptStroke) or an anchored grab (Move, Drag)
  - **Gather:** sphere or topological pick, minus hidden faces, optionally front-facing only, weighted by mask
  - **Frame:** picked normal, area normal and centre, stroke direction (DabSteps, rake across)
  - **Falloff:** `ProfileCurve.sample`
  - **Strength:** `_intensity` × pressure dynamics, or the cm share via `lineIntegral`
  - **Operator:** displace along normal, flatten to plane, Laplacian or surface smooth, pinch, move by delta, colour blend, mask write
  - **Commit:** pushVertices, updateGeometry, GeometrySync

  Symmetry and dynamic topology wrap the whole per-dab chain. Any node runtime has to keep the inner per-vertex loop as typed-array code; per-vertex graph interpretation would multiply the per-dab cost listed in section 10.