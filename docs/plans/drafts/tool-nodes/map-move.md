TOOL ANATOMY: Move / Drag / Twist / LocalScale / Transform (Bozzetto Web, read-only survey)

Paths are relative to /home/user/bozzetto. "V/" = src/sculpt/vendor/, "B/" = src/sculpt/bridge/, "U/" = src/sculpt/ui/.

Where each tool stands today:
- Move: vendor Move.js, overridden by B/tools.ts VolumetricMove. Installed at B/SculptSession.ts:373. Toolbar digit 2 (U/SculptToolbar.ts:257), keymap src/ui/keymap.ts:94.
- Drag: vendor Drag.js, used unchanged. Digit 8 (U/SculptToolbar.ts:265, keymap.ts:100).
- Twist: vendor Twist.js is instantiated (V/editing/tools/Tools.js:20, V/editing/SculptManager.js:50-56) but its slot is overwritten by PolishBrush (B/SculptSession.ts:377). The Twist slot (digit 9) is Polish. The vendor Twist is dead code.
- LocalScale: vendor LocalScale.js, registered at index 11 (Tools.js:13,29; V/misc/Enums.js:30). There is no toolbar button and no hotkey; setToolIndex is only called from B/InputShell.ts:1446,1462,2243,2576. It cannot be reached from the UI.
- Transform: vendor Transform.js is NOT registered ("deferred past v1", Tools.js:14), because its GL Gizmo was cut. The live tool is B/transform.ts TransformGizmo, built on three's TransformControls (doc at :46-71). It is wired in src/sculpt/mode.ts:1205-1244, keys t/w/e/r (keymap.ts:61-64), toolbar U/SculptToolbar.ts:287.

Plumbing all five share:
- Not continuous: SculptManager.canBeContinuous returns false for TWIST/MOVE/DRAG/LOCALSCALE/TRANSFORM (V/editing/SculptManager.js:58-69). So SculptBase.preUpdate returns before re-picking mid-stroke (V/editing/tools/SculptBase.js:85-86). The picking intersection point and radius stay where the press left them unless the tool moves them itself (only Drag does).
- Press (B/InputShell.ts):
  - ctrl swaps to Mask (:1444-1446); shift swaps to Smooth (:1447-1463).
  - Polarity: if `'_negative' in tool`, the toolbar latch/arm and Alt set `tool._negative` (:1484-1493).
  - Locked-object probe (:1500-1511), worldScale.sync (:1513), feedPressure (:1514), SculptManager.start (:1517), seed `_lastMouseX/Y` (:1604-1605).
- SculptBase.start (SculptBase.js:39-63): intersectionMouseMeshes, setOrUnsetMesh, initAlpha, picks the mirrored side, pushState (one undo state per stroke), seeds `tool._lastMouseX/Y`, then startSculpt.
- Per pointermove (InputShell.ts:1772-1777, then :1790-1791): feedPressure, worldScale.sync, preUpdate, update, then `session._lastMouseX = _mouseX`.
  - One update per pointer event. No coalesced events, no lazy-mouse, tilt is never read (no tiltX/altitude anywhere in src).
- Release: SculptBase.end calls balanceOctree (SculptBase.js:65-68), then StateManager.cleanNoop (InputShell.ts:2193-2199).
- Radius: `_radius` is CSS px, times the pixel ratio (SculptBase.js:448-450), times Tablet.getPressureRadius.
  - It is turned into a world radius at the hit depth (V/math3d/Picking.js:393-402); the local radius² is world² / scale² (:404-408).
  - World scale is on by default (mode.ts:1257 worldScale.begin). It pins a world radius per brush and converts it to px at the picked depth (B/worldScale.ts:146-150, depth at :280-292).
  - Pressure size factor = 1 + amount·(2·curve(p) − 1) (B/dynamics.ts:120-132).
- Pressure on strength: none of these tools calls Tablet.getPressureIntensity. Only Pinch, Brush, Crease, Smooth, Inflate, Paint, Flatten and the bridge brushes do (grep). Pressure reaches them only through the radius, at pick time.
- Mask: `mAr[ind+2]`, 1 = free and 0 = masked (V/editing/tools/Masking.js:16,56,70). It multiplies every weight.
- Alpha: `picking.getAlpha()` returns 1, because `_idAlpha = 0` and no alpha is registered (Picking.js:62-64). Stencils are retired (B/tools.ts:632).
- Hidden poly groups: the ray skips hidden faces (Picking.js:229-232), and both vertex picks skip their vertices (sphere :282-294; topological walk :342-374).
- After each op: mesh.updateGeometry updates face normals and AABBs, normals for the whole ring of touched faces (Bozzetto edit), the octree and the GPU dirty ranges (V/mesh/Mesh.js:388-407). Then updateMeshBuffers and render (SculptBase.js:161-164,197-203).
- Undo: one StGeometry (or StDynamic under dyntopo) per stroke (V/states/StateManager.js:45-50). pushVertices records each vertex's position the first time it is touched in that state (V/states/StateGeometry.js:38-56).
- Symmetry:
  - A second Picking with xSym mirrors the ray across the mesh's symmetry plane (Picking.js:214-219).
  - It is per brush (on/off and axis, B/symmetry.ts:11-30), installed by applyBrushSymmetry (SculptSession.ts:718-725, 757-764) when a brush is picked (InputShell.ts:2583).
  - The shift/ctrl swaps keep the brush's own symmetry.
- Spacing: SculptBase.sculptStroke's `_spacing` sub-stepping (SculptBase.js:128-159) is NOT used by any of these four tools; each overrides sculptStroke. The panel hides Spacing for MOVE and DRAG (InputShell.ts:771-775).

=====================================================================
MOVE (VolumetricMove)
=====================================================================
Files: V/editing/tools/Move.js; B/tools.ts:343-408 (VolumetricMove); B/tools.ts:41-46 (MOVE_FALLOFF_POW).

Inputs
- Pointer position (device px). The ray is unprojected at z 0 and 0.1 and brought into mesh-local space with the inverse matrix (Move.js:146-151).
- Press position, used as the anchor.
- View direction: eyeDir is refreshed (Move.js:170-172) but nothing in Move reads it.
- Alt / Negative button: sets `_negative` (defined at Move.js:13, so InputShell's polarity logic applies, :1487-1493). This switches to "along normal" mode.
- shift turns the stroke into Smooth; ctrl turns it into Mask.
- Pressure: radius only, once, at the press (dynamics default size 0: dynamics.ts:75). Strength pressure is ignored.
- Tilt: not used.

Lifecycle (once per stroke vs per event)
- Press, once (startSculpt overrides SculptBase's, so the press itself does not deform):
  - initMoveData (Move.js:27-40, 42-62) picks the vertex set once (:43-46).
  - Grab centre C = the press hit point (:47).
  - pushVertices for the whole set (:50).
  - Snapshots their rest positions into `vProxy` (:54-61).
  - Mirrored side: intersectionMouseMesh, setLocalRadius2 copies the main radius, then its own set, centre and proxy (:32-39).
- Each pointermove (sculptStroke :77-110):
  - Restore every picked vertex from vProxy (:90-92, copyVerticesProxy :64-75).
  - Compute dir (:96, :100) and apply (:97, :101).
  - updateGeometry on both sets (:104-107).
- No dab spacing. One evaluation per event.
- The vertex set, the centre, the radius and the falloff weights are all fixed for the stroke.
- Release: SculptBase.end (balanceOctree).

Vertex selection
- Topological (`_topoCheck = true`, Move.js:12,43-44): pickVerticesInSphereTopological (Picking.js:318-391).
  - Seeds from the first vertex of the picked face that lies inside the sphere (:345-349).
  - Floods vertex rings, keeping vertices with |v − C|² ≤ r² (:356-386).
  - Result: the connected component within the ball. Parts nearby that are not connected (a neighbouring finger) are not grabbed.
- The radius is a world radius derived from the screen radius at the press; the sphere is in mesh-local space.
- No backface culling (Move has no `_culling`). Hidden groups are excluded. Mask is applied as a weight.

Falloff
- d = |v_rest − C| / r, using vProxy rest positions, so the weights are stroke-stable (tools.ts:392-398).
- f = 3d⁴ − 4d³ + 1 (:399-400).
- VolumetricMove adds f = max(f,0)^falloffPow (:401, "CHANGED"). Default 1 (tools.ts:46,359), which is the upstream curve.
- Then f *= mask · alpha (:402).

Reference frame
- Grab centre C, fixed at the press.
- P = Geometry.vertexOnLine(C, near, far), the closest point on the current ray to C (V/math3d/Geometry.js:334-342).
- Under perspective this keeps the grab point at roughly constant depth; it moves in the plane perpendicular to the ray.

Operation
- Normal mode: v = v_rest + dir·f, with dir = intensity · (P − C) (Move.js:166,168; tools.ts:403-405).
  - At intensity 1 the centre follows the pointer exactly. The default 0.25 (tools.ts:363) moves it a quarter of the pointer's travel.
- Negative/Alt mode:
  - len = |P − C|.
  - dir = intensity · normalize(pickedNormal) · (mouseX < _lastMouseX ? −len : +len) (Move.js:161-164,168).
  - `_lastMouseX` is set at the press (SculptBase.js:58) and Move never updates it, so the sign means "is the pointer left of the press point".
  - pickedNormal is re-interpolated each event at the picked face from the current vertex normals (Picking.js:418-422), so it drifts as the surface deforms.

Accumulation / caps
- Absolute and stroke-stable: restore, then apply, every event.
- No accumulation and no cap. Fully event-rate independent.
- This is not StrokeMoves (that class serves the rake/clay); the vendor vProxy snapshot is what makes it stable.

Symmetry
- A separate moveDataSym (Move.js:19-23).
- updateMoveDir mirrors near/far across the plane (:154-159), then computes the mirrored side's dir from its own centre.
- Overlapping vertices receive both displacements, added together (proxies restored first, :90-92, then both moves).

Post-processing / undo
- updateGeometry per event. No smoothing. No dyntopo (Move never calls dynamicTopology).
- One undo state per stroke; vertices pushed once at the press.

Tool panel (U/SculptPanel.ts)
- Size: 5..500 px, or world units/cm under world scale (:196-208; RADIUS_MIN/MAX :35-36).
- Pressure: size 0..1, step 0.05, plus a Size curve (Linear / Soft p^0.6 / Firm p^1.8) (:214-237; dynamics.ts:36-40).
- Strength 0..1 as a fraction (:240-257; InputShell.strengthSpec :713-718).
- Pressure: strength 0..1 and its Strength curve (:258-281). Shown, but it has no effect: Move never reads getPressureIntensity.
- No Spacing (InputShell.ts:771-775).
- Extras: "Falloff (sharp-soft)" 0.3..1, step 0.05, typed min 0.05 (:302-318).
- Plus the Symmetry section and the Shift-smooth group (shiftSmooths :456-459).

Persistence
- Strength, radius, dynamics and symmetry persist per tool (B/ScenePersist.ts:20-80).
- falloffPow is NOT persisted: no field exists, and a grep finds no serializer.

Special
- The "Volumetric" name means euclidean (ball) weights over a topological pick.
- The old off-silhouette grab was removed (tools.ts:343-356): Move must start on the surface.

=====================================================================
DRAG
=====================================================================
File: V/editing/tools/Drag.js (no Bozzetto override).

Inputs
- Pointer position. Ray per sub-step (Drag.js:125-130).
- Pressure: radius only, recomputed per sub-step (:143, then Picking.js:398). Dynamics defaults are size 0 and strength 0 (dynamics.ts:60), so it is constant.
- No `_intensity` and no `_negative` (constructor :7-14), so Alt and the Negative button do nothing.
- shift turns the stroke into Smooth; ctrl turns it into Mask.
- No tilt. View direction is only refreshed (eyeDir :144-146).

Lifecycle
- Press: SculptBase.start, then startSculpt, then sculptStroke.
  - With dist = 0, step = 1/floor(0) = Infinity and dx becomes NaN, but the loop still runs once at the press position.
- Each pointermove, sub-stepping (Drag.js:16-53):
  - minSpacing = 0.15 · _radius, hard-coded (:25). It ignores `_spacing` and ignores the pixel ratio that the Bozzetto edit adds to SculptBase (SculptBase.js:137), so on a 2x screen the spacing is half as wide.
  - n = floor(dist / minSpacing) sub-steps at lastMouse + k·Δ for k = 0..n−1 (:27-47). The first sample is the previous position; the current pointer position is never sampled in this event, so the drag trails by one sub-step.
  - `tool._lastMouseX/Y` is updated at the end (:51-52).
- Per sub-step (makeStroke :55-73):
  - updateDragDir moves the centre (:57).
  - pickVerticesInSphere around the NEW centre (:58), then computePickedNormal (:59).
  - stroke: pushVertices (:80), dynamicTopology (:81), drag (:85), updateGeometry (:87-88).
- Nothing is computed once per stroke except the undo state.

Vertex selection
- Euclidean sphere (octree intersectSphere, then a distance test, Picking.js:273-307), re-picked every sub-step at the moving centre.
- Not topological: it grabs across gaps. No culling. Hidden groups excluded. Mask as a weight.

Falloff
- The plain quartic f = 3d⁴ − 4d³ + 1, with d measured from the NEW centre on current positions, times mask and alpha (Drag.js:109-115).
- No pow and no curve.

Reference frame
- Moving centre: newC = vertexOnLine(oldC, near, far) (:139-140).
- It never re-hits the surface: the centre floats at the depth it was grabbed.

Operation
- v += dir·f, with dir = newC − oldC in local units (:141, :116-118).
- Translate by the drag delta, per sub-step. Material under the brush is carried along, snake-hook style.

Accumulation / caps
- Additive per sub-step. No cap. There is no strength at all: the full pointer delta.

Symmetry
- At each sculptStroke the mirrored centre is re-seeded as mirror(main centre) (:36-40).
- Per sub-step the mirrored side gets mirrored rays (:132-138), its own dir (`_dragDirSym`), and the same radius (:66).
- Drag overrides makeStroke, so the Bozzetto M2-8 ordering ("dab first, then pick the mirrored side", SculptBase.js:174-193) does NOT apply.
  - Non-dyntopo: the mirrored side is picked BEFORE the main dab moves anything (Drag.js:64-71).
  - Dyntopo: the main side dabs first (:61-62).

Post-processing / undo
- Dynamic topology per sub-step (subdivide/decimate around the centre, SculptBase.js:370-418).
- updateGeometry per sub-step.
- One undo state per stroke; vertices are pushed per sub-step, first touch only.

Tool panel
- Size, Pressure: size and Size curve (SculptPanel.ts:196-237).
- No Strength rows (hasBrushIntensity is false, InputShell.ts:1169-1171; panel :238-240). No Spacing. No extras.
- Symmetry section and Shift-smooth group.

=====================================================================
TWIST (vendor; replaced by Polish in its slot)
=====================================================================
File: V/editing/tools/Twist.js. Unreachable in Bozzetto, as stated above.

Inputs
- Pointer position and session `_lastMouseX/Y` (Twist.js:48-51). That value is the previous event's position, because InputShell writes it after each update (:1790).
- View direction: the rotation axis = −eyeDir at the press (:41).
- No pressure on the angle; the radius is fixed at the press. No modifiers of its own (no `_negative`). No tilt.

Lifecycle
- Press: initTwistData (:23-43) picks a sphere and stores the rotation axis n = −eyeDir and the 2D centre = press pixel (:40-42).
  - startSculpt overrides SculptBase's, so the press does not deform.
- Each pointermove (:46-66): re-pick the sphere around the fixed press point (:54), then stroke (:55). No sub-stepping and no spacing.

Vertex selection
- Euclidean sphere around the fixed 3D press point, re-picked per event on current positions.
- Optional backface cull, `_culling = false` (:11, :76-77; getFrontVertices keeps dot(n, eye) ≤ 0, SculptBase.js:215-230).
- Hidden groups excluded. Mask as a weight.

Falloff
- The quartic, times angle, times mask, times alpha (:115-118).

Reference frame
- Centre = 3D press point. Axis = view direction at the press.
- The angle is measured in screen space around the press pixel.

Operation
- Dead zone: if |mouse − pressPx| < 30 px, nothing happens (:92-93).
- θ = signedAngle2d(normalize(mouse − c2d), normalize(last − c2d)) (:94-99; Geometry.js:309-315).
- Per vertex: q = axisAngle(n, θ·f), then v = q·(v − C) + C (:119-126).

Accumulation
- Incremental per event: it rotates current positions. Event-rate dependent only through sampling. No cap.

Symmetry
- The mirrored picking has its own −eyeDir axis (:34).
- stroke(pickingSym, lx, ly, mx, my) swaps current and last (:61), which negates θ: a correct mirror, since M·R(n,θ)·M = R(Mn, −θ).
- The mirrored side is picked after the main dab.

Post-processing / undo
- dynamicTopology (:74), updateGeometry (:83-84). Undo is pushVertices per event.

Panel: none. The TWIST slot shows Polish's rows (SculptPanel.ts:347+).

=====================================================================
LOCALSCALE (vendor; registered but unreachable)
=====================================================================
File: V/editing/tools/LocalScale.js.

Inputs
- Horizontal pointer delta only: Δx = mouseX − session._lastMouseX, in device px (LocalScale.js:25).
- No pressure on the amount; the radius is fixed at the press. No modifiers. No view direction except for culling. No tilt.

Lifecycle
- Press: startSculpt only primes the mirrored picking (:13-20). The press does not deform.
- Each pointermove (:23-39): pick the sphere at the fixed press point (:28), then stroke (:29). No spacing.

Vertex selection
- Euclidean sphere at the fixed press point, re-picked per event.
- `_culling = false` (:9, :49-50). Hidden groups excluded. Mask as a weight.

Falloff
- The quartic, times (Δx·0.01), times mask, times alpha (:65, :78-81).

Reference frame
- Centre = 3D press point.

Operation
- v += (v − C)·f, a per-vertex scale of (1 + 0.01·Δx·f) about C (:82-84).
- Right grows; left shrinks.

Accumulation
- Incremental per event. No cap. No floor, so a large leftward Δx can reach or pass zero and invert.

Symmetry
- The mirrored side uses the same Δx (:31-37). Scaling is invariant under the mirror.

Post-processing / undo
- dynamicTopology (:47), updateGeometry (:56-57). pushVertices per event.

Panel: none. Default `_radius` 50 (:8).

=====================================================================
TRANSFORM GIZMO (Bozzetto: B/transform.ts; vendor Transform.js unused)
=====================================================================

Live tool: TransformGizmo (object-level, matrix only)

Inputs
- Pointer, through TransformControls' own canvas listeners.
- hoverAt re-runs the handle hit test for touch presses (transform.ts:158-167; InputShell.ts:1400-1406).
- Camera right/up and distance (uniform scale, :509-514).
- Keys: t toggles the unified gizmo, w/e/r pick one mode (keymap.ts:61-64; InputShell.ts:2444-2455). Picking any brush exits (InputShell.ts:2573).
- Click on an object re-targets it; Shift adds and Ctrl removes from the selection (InputShell.ts:1408-1416, 1144-1149).
- A press that misses orbits (:1419-1423).
- No pressure, no tilt, no Alt polarity.

Lifecycle
- enter(mode, mesh) attaches a proxy Object3D decomposed from the mesh matrix (:192-227).
- applyMode enables and attaches the wanted controls (:248-271).
- beginDrag, once per drag (:412-427):
  - scaleStart, proxyStart and the `before` matrix.
  - The companions: the selected, visible, unlocked meshes (mode.ts:1223-1224) with their start matrices.
  - The other controls are disabled ("one drag at a time"); OrbitControls is parked (mode.ts:1217-1220).
- Each objectChange (:132-136): tameUniformScale, clampScale, writeBack.
- endDrag records undo and calls onCommit, which marks the autosave dirty (:429-441; mode.ts:1225-1228).

Selection
- Whole objects. There is no vertex set, no mask, no poly groups and no radius.
- Target = the active mesh if visible and unlocked (mode.ts:710-713).

Reference frame
- The active object's matrix and origin. TransformControls defaults to world space; no `space` is set and there is no snapping.
- Handle sizes: scale 0.6, translate 0.85, rotate 1.05 (:126).

Operation
- writeBack (:536-551): mesh matrix = proxy TRS.
- Each companion: M_c = (P_now · P_start⁻¹) · M_c,start (:544-549). The group transforms about the active object's origin.
- Uniform scale is rewritten (:503-516):
  - travel = Δ·right + Δ·up, on the drag plane, in world units.
  - s = s_start · exp(travel / (camDist · 0.35)) (UNIFORM_SCALE_TRAVEL, :36).
- Per-axis floor: |s| ≥ 1% of the starting value, and the sign never flips (SCALE_FLOOR :44; :524-533).
- Nothing is baked into vertices. bakeScale.ts freezes scale only on create/import/Set scale (B/bakeScale.ts:1-10).

Undo
- One StateCustom per drag holding every moved matrix before and after (:463-487).
- Skipped when nothing moved (tolerance 1e-9, :465).
- The channel box commits the same way (applyMatrices :449-460).

Symmetry: none (symmetry.ts:5-6; the panel hides that section, SculptPanel.ts:139-142).

Tool panel (SculptPanel.ts:152-157, 570-588, 634-660)
- Channel box (U/ChannelBox.ts:1-18): Translate XYZ (cm on real units), Rotate as Euler XYZ in degrees, Scale as a factor.
  - With several objects, a value they share shows and a differing one is blank. Each commit is one undo step.
- Checkboxes: Move arrows / Move planes / Rotate rings / Scale boxes / Screen move (centre) / Uniform scale (in R), from ALL_PARTS (:26-33).
  - What is turned off is detached, not hidden (:394-409).
  - Saved per device under "bozzetto-gizmo-parts" (mode.ts:1246-1251).

Special: the unified-mode trim (:327-410)
- The centre is a big view-plane translate octahedron.
- Arrow pickers cover the arrow head only.
- The free-rotate sphere, the uniform-scale cube and all two-axis planes are detached.

Vendor Transform.js, for reference only (it deforms vertices, with the mask)
- start: the gizmo takes the press, or else picks or selects a mesh (Transform.js:31-50).
- Mid-drag the Gizmo writes the mesh's edit matrix E (V/editing/Gizmo.js:497-680):
  - rotate: angle = 7·dist / min(canvas W, H) (:515);
  - axis translate: line-line intersection (:533-570);
  - plane translate: ray-plane intersection (:572-610);
  - scale: (|vec − origin| − |offset|) / |offset|, floored at −0.99 (:645).
- end: per selected mesh, pushState (squash for every mesh after the first), pushVertices(unmasked), then applyEditMatrix (Transform.js:52-73):
  - v' = v·(1 − m) + (E·v)·m (:83-91);
  - the centre is transformed and E reset to identity (:93-94).

=====================================================================
RECURRING PRIMITIVES (across these tools)
=====================================================================
1. Screen ray: unproject (x, y) at z 0 and 0.1, into mesh-local space by the inverse matrix, mirrored for the symmetric side. Used by Move, Drag and all picking (Picking.js:195-219; Move.js:146-159; Drag.js:125-138).
2. Closest point on the ray to an anchor, Geometry.vertexOnLine: a view-plane 3D delta at constant depth (Move, Drag).
3. Anchor choice:
   - fixed press hit point (Move, Twist, LocalScale);
   - moving, re-anchored centre (Drag);
   - object origin / matrix (Transform).
   The press-fixed anchor falls out of canBeContinuous = false.
4. Vertex set:
   - euclidean sphere, octree (Drag, Twist, LocalScale);
   - topological flood inside the sphere (Move);
   - whole object (Transform).
   Pick once per stroke (Move) or per event/sub-step (the others). All pick in local space from a screen radius converted at the hit depth.
5. Filters before weighting: hidden poly groups (always), optional front-facing cull (Twist, LocalScale), dyntopo refinement (Drag, Twist, LocalScale).
6. Weight w = falloff(|v − C| / r) · mask · alpha.
   - Falloff is the quartic 3d⁴ − 4d³ + 1; Move adds a power.
   - Distance is taken from rest positions (Move) or current positions (the others).
7. Screen-input reducers:
   - ray-projected delta (Move, Drag);
   - signed horizontal Δx (LocalScale);
   - angle around the press pixel, with a dead zone (Twist);
   - sign of x relative to the press (Move negative);
   - signed exponential travel (gizmo uniform scale).
8. A weighted affine op about the anchor:
   - translate v + w·d (Move, Drag);
   - scale v + w·s·(v − C) (LocalScale);
   - rotate R(n, w·θ)(v − C) + C, with the weight on the angle (Twist);
   - matrix lerp v·(1 − m) + E·v·m (vendor Transform);
   - matrix write, no per-vertex op (Bozzetto gizmo).
9. Application mode:
   - absolute and stroke-stable: restore the rest snapshot and reapply (Move vProxy);
   - incremental per event/sub-step (Drag, Twist, LocalScale);
   - delta from the press matrix (gizmo).
10. Symmetry pass: mirrored picking with its own anchor and direction, the same local radius, the op re-run. Rotation sense is flipped by swapping arguments (Twist). Effects sum where the sides overlap.
11. Stroke lifecycle hooks: start (pick, pushState, init once) / update (per pointermove, optional sub-steps) / end (balanceOctree, cleanNoop).
12. Post: updateGeometry (face normals, ring vertex normals, octree, dirty GPU ranges) and render. No smoothing pass in any of the five.
13. Undo: one geometry state per stroke with first-touch vertex capture, or one StateCustom of matrices per gizmo drag.
14. Pressure enters only as the radius factor at pick time (Tablet.getPressureRadius). None of these five reads the strength pressure.

Findings
- Move shows "Pressure: strength" and its curve, but they do nothing (Move ignores getPressureIntensity).
- Move's Falloff (falloffPow) is not saved in SculptSettings.
- Drag's sub-step spacing is hard-coded to 0.15·_radius and skips the pixel ratio. It samples from the previous position and never the current one, so it trails by one sub-step.
- Drag picks the mirrored side before the main dab on non-dyntopo meshes, so the M2-8 ordering fix does not reach it.
- LocalScale and the vendor Twist cannot be reached. Vendor Transform is not registered.
