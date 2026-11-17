Anatomy of the Paint, Paint blur, Mask, loop mask and poly-groups-as-selection tools (read only, nothing edited)

Path prefixes: V = src/sculpt/vendor, B = src/sculpt/bridge, UI = src/sculpt/ui.

=== SHARED STROKE PIPELINE (Paint, Paint blur and the Mask stroke) ===

- Press (B/InputShell.ts:1441-1606), in order:
  - Modifier swap: ctrl swaps in Mask; shift swaps in Paint blur over Paint, Smooth elsewhere (1441-1464).
  - Polarity (1485-1493), locked-object probe (1500-1510), worldScale.sync (1512), feedPressure (1513).
  - feedPressure: a pen sets Tablet.pressure = e.pressure; mouse and touch get 0.5 (557-575).
  - SculptManager.start calls SculptBase.start (V/editing/tools/SculptBase.js:39-63):
    - ray-pick all meshes (V/math3d/Picking.js:157-192): nearest hit, faces of hidden groups skipped (229-232);
    - initAlpha, then the mirror pick;
    - pushState opens the stroke's undo state;
    - startSculpt calls sculptStroke with a travel of 0, so there is NO dab on the press (SculptBase.js:74-78, 128-140).
- Continuous (timer) mode is never on: SculptManager.js:18, and no TS code sets it.
- Per move (InputShell.ts:1771-1777): feedPressure, worldScale.sync, preUpdate (re-pick at the pointer, SculptBase.js:80-96), then update and sculptStroke.
- Dab sampling (SculptBase.js:128-159):
  - spacing in px = _spacing x _radius x pixelRatio (137);
  - nothing happens until the travel since the last dab exceeds it;
  - then floor(dist/spacing) dabs are spaced evenly on the screen segment, so the real gap is between 1x and 2x the spacing;
  - one render per move.
  - No lazy mouse or stabiliser, and coalesced events are not used.
- Each dab (makeStroke, SculptBase.js:166-195):
  - Ray-cast at the dab's screen point on the active mesh.
  - Radius per dab: world radius = distance from the 3D hit to unproject(screen hit + _radius x pixelRatio x getPressureRadius px) (Picking.js:393-402); local r = world / mesh scale (404-408).
  - In world scale, which is on at mount (src/sculpt/mode.ts:1256), _radius is re-derived on each move from the brush in hand's world radius at the cursor depth (B/worldScale.ts:146-150, 280-296).
  - Vertex gather (Picking.js:273-307): octree sphere query, then a Euclidean test |v - hit|^2 < r^2 in object space. Any vertex touching a hidden poly-group face is skipped (283-294). Not topological.
  - computePickedNormal: inverse-distance lerp of the picked face's corner normals (418-448).
  - stroke(picking) runs first; then the mirrored side is picked on the surface the dab left (Bozzetto edit, 174-193).
  - The mirrored pick takes the primary pick's radius (187). A primary miss has r = 0 (Picking.js:268), so the mirrored dab then selects nothing.
- Pressure (B/dynamics.ts:114-132):
  - factor = 1 + amount x (curve(p) x 2 - 1); curves: linear p, soft p^0.6, firm p^1.8 (36-40).
  - Keyed on the tool index that is STROKING (InputShell.ts:482), not the brush in hand.
  - Defaults are size 0 / strength 1; Paint is size 1 / strength 1 (dynamics.ts:57-61, 75).
- Culling: _culling is false in every vendor tool and never set in TS (grep finds no assignment). The front-facing filter (SculptBase.js:215-230) never runs, so back-side vertices inside the sphere are affected.
- Not used by these tools: tilt, stroke direction, area normal/centre, plane fit. Stroke direction only orients the alpha frame (Picking.js:81-101), and alphas are retired.
- End: pointerup calls endStroke (InputShell.ts:2193-2197): SculptManager.end runs tool.end; SculptBase.end does balanceOctree (65-68); then cleanNoop drops an empty undo state (V/states/StateManager.js:132-138); then restoreStrokeTool (2237-2247).
- Undo:
  - One state per stroke: StColorAndMaterial, or StDynamic on a dynamic-topology mesh (StateManager.js:38-43).
  - pushVertices snapshots each vertex's colour and material the first time this state touches it (StateColorAndMaterial.js:37-58).

=== 1. PAINT ===

Where: Enums.Tools.PAINT = 8 (V/misc/Enums.js:27). Class PaintBrush, B/tools.ts:2071-2142, extends V/editing/tools/Paint.js. Registered at B/SculptSession.ts:391. Hotkey 0 (src/ui/keymap.ts:102), toolbar slot 10 (UI/SculptToolbar.ts:267-269).

- Inputs:
  - hit position;
  - pen pressure drives both strength and size (amounts 1/1 by default);
  - alt at press is the eyedropper (InputShell.ts:1473-1478); shift at press swaps to Paint blur; ctrl swaps to Mask;
  - no _negative, so there is no invert (the toolbar arm waits for a stroke that can invert, 381-388).
- Spacing: 0.05 x radius (SculptSession.ts:393).
- Per dab (Paint.stroke, Paint.js:88-107):
  - intensity = _intensity x getPressureIntensity (90);
  - pushVertices (93);
  - dynamicTopology (94): on a dynamic-topology mesh, painting subdivides and decimates the area (SculptBase.js:370-418);
  - updateAlpha and setIdAlpha(null) (99-100); PaintBrush never calls getAlpha;
  - paint() (101);
  - updateDuplicateColorsAndMaterials and updateDrawArrays (103-106).
- Selection: the shared sphere around the hit. The mask is a weight, not a filter.
- Falloff:
  - d = |v - hit| / r, clamped at 1 (tools.ts:2116-2120); weight = curve.sample(d) (2123).
  - Presets (B/profile.ts:738-742, 787-790, 850-855): Hard (1-d)^0.1, Default (1-d)^0.5 (the vendor's hardness 0.75), Soft (1-d), Airbrush (1-d)^3.
  - On an unedited preset the exact kernel runs; an edited curve reads a 256-entry table with linear interpolation (profile.ts:649-657).
- Reference frame: the hit point only.
- Operation:
  - w = curve(d) x min(1, intensity) x mask_v (tools.ts:2110, 2124);
  - c <- c(1-w) + C w (2127-2131);
  - C is _color in linear RGB; the sRGB hex from the picker is converted (InputShell.ts:750-757).
  - Roughness and metalness writes are switched off (mode.ts:465-469), so the code at tools.ts:2133-2139 is dormant.
- Accumulation:
  - A multiplicative lerp per dab: after n overlaps c_n = C + (c0 - C)(1-w)^n. It converges on C and the cap at 1 prevents overshoot (2058-2070).
  - There is no per-stroke cap: denser spacing or a slower stroke gives more opaque paint.
- Symmetry: per brush (on, X by default; B/symmetry.ts:19-30), mirrored dab as described above.
- Post: updateColorBuffer, plus updateMaterialBuffer only when PBR channels are written (Paint.js:54-66). No normal update.
- Undo: pushStateColorAndMaterial at start, unless the eyedropper is active (Paint.js:31-34).
- Special:
  - Eyedropper: no undo state. pickColor on press, and again on every move while held (Paint.js:36-52, 68-86). It takes a polyLerp of the picked face's corner colours (Picking.js:424-448), and the callback refreshes the picker (InputShell.ts:502-505).
  - Fill button calls paintAll (Paint.js:156-196): every vertex with mask > 0, weight = mask, one undo step (InputShell.ts:1161-1167). It ignores hidden groups.
- Tool panel (UI/SculptPanel.ts):
  - Colour: HSV picker, Fill, and a drag-the-swatch picker over the view (165-189).
  - Size 5-500, step 1 (195-209). Pixels in screen scale; in world scale on real units each step is 0.02 cm (worldScale.ts:51, 160-163).
  - Pressure: size 0-1, step 0.05, plus Size curve Linear/Soft/Firm (214-237).
  - Strength 0-1, step 0.01, a fraction (240-257; InputShell.ts:716-721). Default 0.75 (Paint.js:12).
  - Pressure: strength 0-1, plus Strength curve (258-281).
  - Spacing 0.02-0.6, step 0.01 (288-295).
  - Profile curve editor (383-387).
  - Symmetry section: on/off and axis X/Y/Z (682-706).
  - No "Smooth (Shift)" section for Paint (456-459).

=== 2. PAINT BLUR ===

Where: Enums.Tools.PAINT_BLUR = 14 (Enums.js:38). Class PaintBlurBrush, B/tools.ts:2152-2202. Registered at SculptSession.ts:396-400. The only way to reach it is shift+press over Paint (InputShell.ts:1447-1460).

- At press: _radius and _intensity are copied from Paint (1456-1457). It holds Paint's own ProfileCurve object (SculptSession.ts:399).
- Not copied from Paint:
  - spacing: its own SculptBase default 0.15 (SculptBase.js:26);
  - dynamics: its own entry, size 0 / strength 1 linear, which no UI can edit. So the blur's size does NOT follow pressure, though Paint's does.
- Inputs: hit and pressure (strength) only. No invert, no alt.
- Per dab (tools.ts:2165-2201):
  - intensity = _intensity x pressure factor (2167);
  - pushVertices (2168); dynamicTopology (2169); culling is skipped;
  - L = laplacianSmooth over the COLOUR array (2177-2178; SculptBase.js:296-368). L is the 1-ring mean, computed from the colours before the dab. Border vertices average only their border neighbours (when there are at least 2), and vertices with 2 or fewer neighbours keep their own value;
  - f = min(1, curve(d) x intensity x mask) (2192-2193);
  - c <- c(1-f) + L f (2194-2197);
  - updateDuplicateColorsAndMaterials and drawArrays (2199-2200).
- Reference frame: the hit point. Accumulation: per dab, repeated strokes diffuse further; no cap beyond f <= 1.
- Symmetry: the brush in hand's (Paint's). The swap never calls applyBrushSymmetry (SculptSession.ts:707-722).
- Undo and post: inherited from Paint.
- Cursor: blue smoothing tint, and a dim ring mid-stroke (InputShell.ts:612, 1582-1585).
- Panel: nothing of its own.

=== 3. MASK (painted mask stroke) ===

Where: Enums.Tools.MASKING = 10 (Enums.js:29). V/editing/tools/Masking.js, with no Bozzetto subclass. Reached by ctrl+press with any brush (InputShell.ts:1444-1446). No toolbar slot.

- Inputs:
  - hit position;
  - ctrl masks, ctrl+alt unmasks: _negative = !alt (1491). The toolbar Negative latch and arm are ignored (1489);
  - pressure drives strength only, through MASKING's own dynamics entry.
- Settings: _radius 50 px, _hardness 0.25, _intensity 1.0, spacing 0.15 (Masking.js:13-21; SculptBase.js:26).
  - Radius: in world scale it follows the brush in hand (worldScale.ts:53-65, InputShell.ts:2597-2599); in screen scale it keeps its own 50 px.
  - None of these is exposed, and the strength is not saved (InputShell.ts:1235-1237).
- Per dab: Paint.prototype.stroke (Masking.js:37-39), with dynamicTopology made a no-op (41-44), then paint() (47-72).
- Falloff: fixed (1-d)^(2(1-0.25)) = (1-d)^1.5 (55, 68), times getAlpha. getAlpha returns 1 because ALPHAS[0] is undefined (Picking.js:62-64, 467-468).
- Operation:
  - m <- clamp(m + s x (1-d)^1.5 x I, 0, 1), where s = -1 to mask and +1 to unmask (56, 69-70);
  - m is materials[v*3+2]: 1 is unmasked, 0 fully masked;
  - I is not capped (2x at a full pen press), but the clamp holds the result.
- Accumulation: additive per dab and saturating; at 0.15 spacing it fills quickly.
- Reference frame: the hit point. Selection: the shared sphere. Symmetry: the brush in hand's.
- Post: updateDuplicateColorsAndMaterials, then updateMaterialBuffer (Masking.js:29-35).
- Undo: one pushStateColorAndMaterial per stroke (24-27).
- Related gestures:
  - Ctrl+click on the model that stays within 6 CSS px while the stroke's state is still empty: maskGroup, written into that same undo state (InputShell.ts:1546-1555, 1886-1898).
  - Ctrl+press off the mesh: a tap inverts the mask, a drag dollies (1520-1534, 1729-1745, 1864-1876).
- Whole-mask operations:
  - maskAll, ctrl+A (149-168): every vertex to 0.
  - clear, ctrl+C (125-141): every masked vertex to 1.
  - invert, ctrl+I (170-183): 1 - m for every vertex; undo is a StateCustom.
  - Blur (83-102): vertices with m < 1, grown by one ring, take the Laplacian of the materials field; only the mask channel is written.
  - Sharpen (104-123): m > 0.5 goes to min(m + 0.1, 1), anything else to 0.
  - Extract, ctrl+E (366-401): vertices with m < 0.5 and their faces become a shell of the set thickness, offset by 0.0002 x the object radius, its border smoothed by 3 Smooth passes, added as a new mesh.
  - Where they live: keymap.ts:69-76, InputShell.ts:2349-2367, and Model panel buttons (UI/ModelPanel.ts:406-439).
  - Model panel ranges: Darken 0.05-1, step 0.05; Extract thickness 0-30 mm, step 0.5, default 5 mm (legacy scenes 0-6, step 0.1) (ModelPanel.ts:48-49, 717-737).
  - All of these ignore hidden groups.
- The mask as an input to other tools: it weights Paint (tools.ts:2124) and the blur (2192), and weights areaNormal and areaCenter (SculptBase.js:233-273).

=== 4. LOOP MASK ===

Where: B/loopMask.ts, class LoopMasker. Gesture in InputShell.ts:941-1064 and 1426-1433. Ctrl+shift+drag with any brush.

- Inputs:
  - drag start and the current or end point in CSS px, times pixelRatio (974-979);
  - alt, read live and at release, means unmask (1013, 1718);
  - the camera's project and unproject.
  - No pressure, radius or tilt.
  - A drag under 6 CSS px (LOOP_CLICK_SLOP, 157) is a click: groupVisibilityClick (1022).
- Lifecycle:
  - begin: _action = MASK_EDIT, cursor hidden (948-971);
  - once per frame (rAF): pick, then a preview that tints the side 45% of the way to the goal and restores it afterwards (982-1001; loopMask.ts:927-955);
  - release: apply (1004-1030);
  - pointercancel or a lost window focus applies nothing (1055-1064).
- Hit: ray pick at the drag's midpoint, stepping outward along the drag by max(2/len, 0.005) until something is hit. Hidden faces are skipped by Picking, and locked objects are refused (loopMask.ts:581-608).
- Crossed edge: the picked face's edges are projected to screen and intersected with the drag line; the crossing nearest the midpoint wins, with a 1e6 penalty on border edges (622-651).
- Reference plane: through the hit point P, containing the face normal N (the cross product of the face's diagonals, 656-675). The plane's own normal is the drag direction laid on the tangent plane: the ray 10 px along the drag, met with the tangent plane (676-698).
- Finding the cut:
  - If both faces across the crossed edge are quads, walk the edge loop both ways (walkLoop 278-308, called at 714-769). The walk goes through regular vertices (4 quads around, not on a border) and stops at a pole, a border, where it closes, or where it crosses itself.
  - Side: flood the faces from the face past the crossing, barred by the loop's edges (floodFaces 311-335).
  - If that flood leaks to the other side, fall back to the ring: signed distance to the plane, traced face to face across the faces it cuts (traceRing 427-479). Side: a vertex flood from the picked face's corners on the far side, barred by the edges the ring crosses (floodVertices 359-399; 771-806).
  - If that leaks too, 'plane': every vertex with d >= 0 in the connected part (807-815).
- Topology: built per level (adjacency, vertex-face lists, regular and border flags; 135-245). Cached per mesh data, faces and counts, plus the undo index on a dynamic mesh (568-578). The cut is cached while the drag stays on the same loop and side (743-750, 913-919).
- Selection type: topological or plane-based. No radius, falloff or culling, and back faces are included.
- Hidden groups: hidden faces cannot be the hit, but the loop and ring traces and the floods never check hidden (loopMask.ts has no hidden check), so a cut can run through and mask hidden faces.
- Operation: binary, m := 0 to mask or 1 to unmask, for every side vertex, the loop's own included (921-924, 977-984).
- Symmetry: when live symmetry is on (the brush in hand's), each side vertex is mirrored across the object's symmetry plane and matched to the nearest vertex in a spatial hash within 0.75 x the typical edge length (821-863). Skipped when the cut is the symmetry plane: offset under 2 edges and |plane . n| > 0.9 (830).
- Undo: one pushStateColorAndMaterial, then pushVertices for the changed vertices only; nothing is pushed when nothing changed (969-991).
- Post: Masking.updateAndRenderMask (985-987).
- Overlay: the cut line in world space with a front-facing flag per point, and a note when it fell back (866-884; InputShell.ts:989-1000).
- Settings: none.

=== 5. POLY GROUPS AS SELECTION ===

Where: B/polyGroups.ts.

- Data: one u32 per level-0 face, plus names, hidden flags and colours per group. A level-k face takes its ancestor floor(f / 4^k), or a parent map after a Rebuild. A dynamic-topology mesh keeps its groups in MeshDynamic._facesGroups (6-57).
- Hiding as a filter:
  - hiddenFaces and hiddenVertices are installed as Picking hooks (291-298, 570-607); a vertex counts as hidden when any hidden face touches it.
  - Ray hits skip hidden faces (Picking.js:229-232). Both sphere picks skip hidden vertices (283-294, 342-374).
  - So every brush stroke (sculpt, Paint, blur, Mask) leaves hidden groups exactly as they were.
  - Hidden groups are not drawn and not framed (mode.ts:1070-1080).
  - Not respected by: the whole-mask operations, Paint's Fill, and the loop mask's floods.
- Ctrl+shift+click (InputShell.ts:1037-1053):
  - isolate: show a group alone;
  - invert: on the only group showing, hide it and show the rest (polyGroups.ts:1095-1119);
  - on empty space: showAll (1074-1080).
- Ctrl+click (alt unmasks): maskGroup (1175-1208) sets m := 0 or 1 on every vertex of the group's visible faces on the level on screen. Binary, no falloff, no symmetry, written into the mask stroke's open undo state.
- Ctrl+G / From mask: fromMask (825-891).
  - A face qualifies when all its corners have m < 0.5 and it is not hidden.
  - Faces are rounded down to level 0 by share: a base face joins when more than half of its faces qualify (roundDown 773-788).
  - A new group is made and the mask cleared, in one undo step.
- Other ways to make groups:
  - By angle: a dihedral flood. Slider 1-90, step 1; typed 1-179 (923-964; ModelPanel.ts:474-490).
  - Auto: one group per connected piece (1021-1028).
  - Visible: every face that shows into one new group (994-1014).
  - By UV islands, Clear all, Remove unused.
  - Each list row has an eye (setHidden 1064-1071), rename, colour and delete (1127-1167).
  - All of these are in the Model panel, not the Tool panel (ModelPanel.ts:441-529).
- Undo: each edit is one StateCustom holding a per-face diff plus copies of the names, hidden flags and colours (702-755).

=== RECURRING PRIMITIVES ===

1. Stroke sampler: screen-space dab interpolation at spacing x radius px; no dab on the press; a fresh ray-cast per dab (SculptBase.js:128-195).
2. Ray pick: nearest hit on visible meshes, hidden faces skipped. Gives the hit point, the face, an interpolated normal and a mirrored pick.
3. Radius resolver: screen px (or a world radius converted to px), times the size-pressure factor, unprojected to a world radius, then a local radius^2.
4. Sphere vertex gather: octree query plus a Euclidean test, hidden vertices excluded. Optional extras: a front-facing filter (present but off), dynamic-topology refinement (Paint and blur only), and a topological variant (Picking.js:318-391; none of these tools use it).
5. Falloff: normalised distance into a ProfileCurve (exact kernel or 256-entry table), or a fixed pow (Mask).
6. Weight: falloff x strength x pressure factor x mask (x alpha), capped at 1.
7. Per-vertex channel operations:
   - lerp toward a constant (paint);
   - lerp toward the 1-ring mean, through laplacianSmooth run on any field (colour blur, mask Blur);
   - additive with a clamp (mask stroke);
   - set to a constant (loop mask, group mask, clear, maskAll, fill);
   - 1 - m (invert);
   - threshold step (sharpen).
8. Region selectors other than the sphere:
   - mask thresholds (< 0.5, < 1, > 0);
   - group membership and visibility;
   - face flood across unbarred edges, vertex flood;
   - edge-loop walk, plane-ring trace, a plane's half-space.
9. Symmetry, three ways: a mirrored ray pick per dab (strokes), a position mirror through a spatial hash (loop mask), none (maskGroup and the whole-mask operations).
10. Undo:
    - open a colour+material (or dynamic) state at start, snapshot each vertex the first time a dab touches it, and drop the state at the end if it stayed empty;
    - one-shot operations use a single state or a StateCustom.
11. Post: updateDuplicateColorsAndMaterials, a colour or material buffer upload, and a render. Normals are never updated, since these tools change no geometry (except Paint and blur's dynamic-topology refinement).
12. Modifier routing:
    - Stand-ins are swapped in at the press: ctrl for Mask; shift for Smooth, or Paint blur over Paint.
    - Alt means negative for sculpt brushes, the eyedropper for Paint, and unmask for Mask.
    - Stand-ins inherit the brush in hand's symmetry and, in world scale, its size.
    - They keep their own dynamics entry and spacing, which no UI can edit (Paint blur 0.15 against Paint's 0.05; size pressure 0 against Paint's 1).
13. Pressure dynamics: an amount and a curve per channel (size, strength), per tool index.
