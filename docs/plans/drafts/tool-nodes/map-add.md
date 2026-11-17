TOOL ANATOMY: Standard (clay) / ClayStrips, Inflate, Crease
(Read-only pass. Line numbers are file:line. "Vendor" means src/sculpt/vendor/editing/tools/. "tools.ts" means src/sculpt/bridge/tools.ts.)

====================================================================
SHARED PIPELINE (all three tools run through this; each block below lists only what differs)
====================================================================
Registration: SculptSession.ts:373-386 puts the Bozzetto subclasses into the vendor slots: BRUSH -> ClayStripsBrush, CREASE -> CreaseBrush, INFLATE -> InflateBrush. Toolbar slots: SculptToolbar.ts:256-259 (Crease=1, Standard (clay)=3, Inflate=4). Hotkeys: keymap.ts:93-96 (tool.crease '1', tool.clay '3', tool.inflate '4').

Stroke lifecycle
- Press: InputShell.ts:1441-1517. Ctrl swaps in MASKING for the stroke, Shift swaps in SMOOTH (PAINT_BLUR over Paint) (1444-1464). Polarity is set at 1485-1493: `_negative = ctrl ? !alt : alt ? !base : base`. `base` is the toolbar Negative latch, flipped once more by the one-shot arm. Ctrl+Shift starts a loop-mask drag instead of a stroke (1430). Pressure is read before start (1513). Then SculptManager.start -> SculptBase.start (SculptBase.js:39-63) does: intersectionMouseMeshes, initAlpha on both pickings, pushState (one undo state per stroke, :57/:70-72), stores _lastMouse, then startSculpt -> sculptStroke.
- Consequence: at press, dist = 0 <= minSpacing, so a press that does not move lays NO dab (SculptBase.js:133-140).
- Move: InputShell.ts:1772-1777 calls feedPressure, worldScale.sync, preUpdate, update. preUpdate re-picks main and mirror (SculptBase.js:80-96). update -> sculptStroke (SculptBase.js:98-102).
- Dab sampler: sculptStroke (SculptBase.js:128-159) works in SCREEN pixels.
  - minSpacing = _spacing x _radius(px) x pixelRatio (:137). This uses the radius without pressure.
  - N = floor(dist/minSpacing) dabs go evenly along the straight line from the last mouse position to the current one, and the last dab lands exactly on the current pointer. Real spacing is therefore in [minSpacing, 2 x minSpacing). The leftover distance is dropped.
  - Each dab re-raycasts (makeStroke). If both sides miss, the loop stops (:149).
  - One pressure value serves every dab of a pointermove. There are no coalesced events and no stroke smoothing or lazy mouse.
- Per dab: makeStroke (SculptBase.js:166-195). It raycasts, calls pickVerticesInSphere(localRadius2) and computePickedNormal, then runs stroke(picking) for the main side. After that it raycasts the mirror on the surface the main dab left (BOZZETTO EDIT :174-180), copies the main local radius to the mirror (:187), and runs stroke(pickingSym).
- After each pointermove: updateRender -> updateMeshBuffers (SculptBase.js:161-164, 197-203).
- Release: InputShell endStroke (2193-2202) calls SculptManager.end -> SculptBase.end -> balanceOctree (SculptBase.js:65-68), then StateManager.cleanNoop drops an empty undo state (StateManager.js:132-138). restoreStrokeTool puts back the previous `_negative` and tool index (InputShell.ts:2237-2247).
- Continuous (timer) mode exists but is never enabled (SculptManager.js:18, 58-81).

Radius
- `_radius` is in screen px (SculptPanel Size slider 5-500, typed value >= 1: SculptPanel.ts:195-209; InputShell.ts:174-176).
- Conversion to world: Picking.computeWorldRadius2 (Picking.js:393-402) offsets the projected hit point by getScreenRadius() x Tablet.getPressureRadius() px and unprojects. Local radius^2 = world radius^2 / scale^2 (:404-408). This is redone for every dab at that dab's hit depth.
- Optional world-scale mode (worldScale.ts:1-35, off by default) derives `_radius` px from a world radius at the depth under the cursor.

Vertex selection
- Picking.pickVerticesInSphere (Picking.js:273-307). It is Euclidean, NOT topological: an octree sphere test, then faces, then vertices, then a squared-distance test against the hit point in local space.
- Vertices touching a hidden poly-group face are dropped (:283, :294). Hidden faces cannot be hit (:229-232).
- Every vertex in the sphere is flagged with SCULPT_FLAG (:285, :300).
- Dyntopo, when the mesh is dynamic, runs before deformation (SculptBase.js:370-418). It subdivides and decimates within the radius (d2Max = r^2 x (1.1-sub) x 0.2) and returns the sculpt-flagged vertices.
- Front-facing test: getFrontVertices keeps n . eyeDir <= 0 (SculptBase.js:215-230). eyeDir is the ray direction, mirrored for the mirror side (Picking.js:214-225).
- `_culling` stays false in all three tools (Brush.js:15, Inflate.js:12, Crease.js:12), and nothing in Bozzetto sets it. So back-facing vertices inside the sphere ARE deformed.

Mask and alpha
- Every falloff is multiplied by mAr[ind+2], the mask (1 = free, 0 = masked).
- Alphas are retired. ClayStrips and Crease set `_idAlpha = null` (tools.ts:895, 1909). Inflate keeps the vendor numeric 0, which looks up nothing, so getAlpha = 1 (Picking.js:62-64).

Proxy ("stroke-start position")
- updateProxy (SculptBase.js:276-293) copies a vertex position into `_vertProxy` the first time the stroke touches it. "First time" is judged by STATE_FLAG, which pushState bumps once per stroke (StateManager.js:71-72).
- On dyntopo meshes the proxy IS the live vertex array (MeshDynamic.js:59-61).

Pressure (dynamics.ts installs patched Tablet getters, 114-152)
- getPressureRadius / getPressureIntensity = 1 + amount x (2 x curve(p) - 1), a swing of 0..2x (:120-132).
- getPressureLayer = 1 for mouse or finger (Tablet.pen false, set at InputShell.ts:557-575). For a pen it is 1 + amount x (curve(p) - 1), a 0..1 term (:140-146).
- Curves: linear p, soft p^0.6, firm p^1.8 (:36-40).
- Per-tool defaults (:57-61): Crease has size 1 and strength 1. Clay and Inflate have size 0 and strength 1.
- All three cm brushes read strengthPressureTerm() = getPressureLayer (tools.ts:192-194). The vendor-computed `intensity` (x getPressureIntensity) is ignored or unreachable in all three.
- Tilt, twist, azimuth and altitude are not read anywhere in src (grep). Stroke direction and stroke tangent are not used by any of the three. Picking.updateAlpha's lookAt was only used for alpha orientation.

Strength unit
- Strength is in cm (StrengthCmBrush, tools.ts:48-63, 175-184). Slider 0-5 step 0.01, typed up to 50 (InputShell.ts:716-721, 1204-1211). The ; and ' keys step 0.05.
- Converted to local units as S_local = S / mesh.getScale() (Mesh.js:327-329).
- Fractions saved before the change convert through LEGACY_STRENGTH (tools.ts:202-220).

Symmetry
- Per brush: SymmetryStore (symmetry.ts:18-56), default on, axis X.
- applyBrushSymmetry and writeSymmetryAxis set vendor `_symmetry` and each mesh's symmetry normal (SculptSession.ts:714-765).
- Mirror plane origin = mesh centre + normal x offset x localRadius (Mesh.js:331-336). The mirror ray is the mirrored near and far points (Picking.js:214-219).

Post-dab
- mesh.updateGeometry(faces of the verts, verts) (Mesh.js:388-407) recomputes face normals and AABBs, then the normals of EVERY vertex of the changed faces (BOZZETTO EDIT :390-397). Normals are unit length, area-weighted and normalised (:556-568). Then the octree is updated and the dirty ring is passed to GeometrySync.
- None of the three tools runs a smoothing pass.

Undo
- One StateGeometry, or StateDynamic under dyntopo, per stroke. Each dab calls pushVertices, which snapshots only first-touched vertices (StateGeometry.js:38-56). Both symmetry sides go into the same state. Dyntopo also calls pushFaces (SculptBase.js:394).
- Stack depth 64 (SculptSession.ts:366).

Tool panel rows common to these three (SculptPanel.ts)
- Size 5-500 px (195-209).
- Pressure: size 0-1 step 0.05, plus Size curve select (shown only when > 0) (214-237).
- Strength in cm (240-257).
- Pressure: strength 0-1 step 0.05, plus Strength curve (258-281).
- Spacing 0.02-0.6 step 0.01, typed value >= 0.02 (288-295; SPACING_MIN InputShell.ts:186).
- Symmetry section: Mirror sculpting checkbox ('x') and axis (676-705).
- The Shift-Smooth group (Mode Average/Surface, Relax, Strength) heads every brush via fillShiftSmooth (144, 401-426).
- Negative button on the toolbar: tap arms one stroke, long press latches (SculptToolbar.ts:130-198).

====================================================================
TOOL 1: Standard (clay)   [Enums.Tools.BRUSH, ClayStripsBrush extends vendor Brush]
====================================================================
There is only one class. "ClayStrips" is the Bozzetto subclass name for the Standard slot (tools.ts:829-863, 863-1054). The vendor flags are left at their defaults: `_clay = true`, `_accumulate = true`, `_lockPosition = false`, `_culling = false`, `_negative = false` (Brush.js:11-18). So only the clay branch runs. The vendor's plain-brush branch (displace along the picked normal, quartic, 0.1 x intensity x r: Brush.js:56-89; tools.ts:931-939, 982-1002) is unreachable.

Inputs
- Hit point (local).
- Pressure: getPressureLayer only (tools.ts:907-909, 947). Line 919's `intensity` feeds only the dead branch.
- eyeDir: front-vertex set for the plane fit (925).
- Polarity: `_negative` (alt, latch, arm).
- Not used: tilt, stroke direction, picked normal.

Spacing and lifecycle
- `_spacing` = CLAY_SPACING 0.1 (tools.ts:97, 898). The vendor default is 0.15.
- There is no per-stroke state: no proxy update because accumulate is true (921), and no DabSteps.
- Everything is computed per dab. lastLayerOffset, lastRate and lastStrengthDab are recorded for parity and tests (953-963).

Vertex selection
- The shared sphere pick, then dyntopo (923).
- iVertsFront = front-facing subset (925). It is used ONLY for the plane fit.
- Displacement applies to ALL iVertsInRadius, back faces included, because culling is off (926).

Reference frame (per dab, refitted every dab; tools.ts:941-969)
- N = areaNormal(iVertsFront): the mask-weighted sum of vertex normals, normalised (SculptBase.js:233-252). If the length is 0 (all masked, or no front vertices) the dab is abandoned with no geometry update (942).
- C0 = areaCenter(iVertsFront): the mask-weighted centroid (SculptBase.js:255-273).
- C = C0 + N x (negative ? -off : off), where off = 0.1 x r_local (952, 964-969).

Rate (the strength-in-cm mapping, tools.ts:946-951; class comment 842-856)
- I = curve.lineIntegral(), floored at 1e-3.
- g = CLAY_GAIN(1.5) x S_local x (spacing/0.1) / I.
- rate = min(CLAY_MAX_RATE 0.5, g/r) x p.
- If rate <= 0, nothing moves (970).

Operation (flattenClay, tools.ts:1010-1053; a copy of vendor Flatten.flatten, Flatten.js:42-79)
For each v in the sphere:
- h = (v - C) . N
- skip if h x comp > 0, where comp = negative ? -1 : 1. Only vertices BELOW the raised plane move (above it when negative). (1040-1041)
- d = |v_current - hit| / r. Accumulate means the live position is used, not the proxy. Skip if d >= 1. (1042-1046)
- v -= N x min(1, curve.sample(d) x rate x mask) x h (1048-1051). This is a one-sided fractional move toward a plane, along N. The min(1) means a vertex never passes the plane.

Falloff
- ProfileCurve(CLAY_PROFILES, 'plateau') (tools.ts:867).
- Presets (profile.ts:828-833):
  - Plateau: plateau(0.8) = 1 to d = 0.8, then quartic((d-0.8)/0.2). I = 1.84.
  - Soft: quartic 3d^4 - 4d^3 + 1. I = 1.2.
  - Flat: 1. I = 2.0.
  - Round: sqrt(1-d^2). I = 1.571.
  (I values computed numerically.)
- Sampling uses the exact kernel while the curve is unedited; after an edit it reads a 256-entry LUT with linear interpolation (profile.ts:27-35, 649-657).
- lineIntegral uses Simpson's rule with 512 intervals and is cached per revision (670-678).

Accumulation and caps
- Additive per dab, but self-limiting. Each dab goes at most 50% of the way to a plane 0.1 r above the local area centre. The plane rides up on built material, so a stroke builds to roughly 0.65 r at most (class comment 853-855).
- The build is calibrated, not exact. CLAY_GAIN was measured: strength 1.5 gives 1.62 cm on the sphere and 1.44 cm on the plane (80-88).
- No layer cap and no StrokeMoves. The 2026-10-31..11-10 form-fitted, fill-to-plane version was removed (857-861).

Symmetry
- Shared mechanism. There is no per-side state, so the mirror dab fits its own plane on the mirrored surface.

Post-processing
- mesh.updateGeometry(faces of the verts, verts) (973-974).
- No smoothing.

Panel
- Shared rows.
- "Profile" curve editor (Clay profile): 2-8 Bezier anchors, presets as above (SculptPanel.ts:319-325; profile.ts:86-93).
- Strength default 1.5 cm (tools.ts:79, 899).
- Spacing default 0.1.
- Radius default 50 px (vendor Brush.js:11).

Special
- The clay path borrows Flatten's projection loop.
- RakeBrush (tools.ts:1507+) also extends Brush. It is a separate tool and out of scope here.

====================================================================
TOOL 2: Inflate   [Enums.Tools.INFLATE, InflateBrush extends vendor Inflate]
====================================================================
Inputs
- Hit point.
- Pressure via strengthPressureTerm (tools.ts:2025). The vendor `intensity` argument is ignored (2013).
- Polarity: `_negative` (deflate).
- eyeDir only if culling were on (it is not: Inflate.js:26-27).
- Not used: tilt, stroke direction, picked normal.

Spacing and lifecycle
- `_spacing` = 0.15, the inherited SculptBase default (SculptBase.js:26). Not overridden.
- Per stroke: start() clears DabSteps, and on success DabSteps.begin records the press hit point for each side (tools.ts:2005-2010, 248-270).
- Per dab, vendor stroke (Inflate.js:17-35):
  - updateProxy (21), so the first-touch positions are kept.
  - pushVertices (23).
  - dynamicTopology (24).
  - updateAlpha / setIdAlpha (29-30).
  - inflate(...) (31).
  - updateGeometry (34).

Vertex selection
- The shared Euclidean sphere, with culling off. Back faces in the sphere move.

Reference frame
- None shared. Each vertex uses its own current normal nAr. That normal was refreshed by the previous dab's updateGeometry ring update.

Strength share (tools.ts:2025-2032; class comment 1985-1992)
- step = DabSteps.step(side, hit, r) = min(r, |hit - previous hit for that side|) (265-269).
- amount = (S x p / scale) x step / (1.2 x r). 1.2 is QUARTIC_LINE_INTEGRAL (223).
- Sign is flipped by `_negative`.
- The first dab's step is measured from the press point.

Operation (tools.ts:2033-2054; vendor Inflate.js:38-74)
- d = |v_proxy - hit| / r, from the stroke-first-touch position on static meshes. Skip if d >= 1.
- f = quartic(d) x amount / |n_v| x mask x alpha(=1).
- v += n_v x f. That is, displace along the vertex's own normal. Normals are unit now (Mesh.js:556-568), so dividing by |n| is about 1.

Falloff
- Hard-coded quartic 3d^4 - 4d^3 + 1 (2040-2041). There is no profile curve.

Accumulation and caps
- Per-dab additive. The cm share makes one straight pass at full pressure move the centre line by about S, whatever the spacing or radius.
- No cap: overlapping passes or scrubbing keep adding. No StrokeMoves and no layer limit.
- The proxy only freezes the falloff distance.

Symmetry
- Shared. DabSteps keeps a separate previous hit for 'main' and 'sym' (sideOf, tools.ts:273).

Post-processing
- updateGeometry only.

Panel
- Shared rows only. No extras.
- Strength default 0.5 cm (tools.ts:100, 2002).
- Radius default 50 px (Inflate.js:9).

====================================================================
TOOL 3: Crease   [Enums.Tools.CREASE, CreaseBrush extends vendor Crease]
====================================================================
Inputs
- Hit point.
- Picked normal: the inverse-distance-weighted vertex normals of the hit face, normalised (Picking.js:418-448). The vendor passes it as aNormal (Crease.js:31).
- Pressure via strengthPressureTerm (tools.ts:1951). Dynamics default: size amount 1 AND strength amount 1 (dynamics.ts:58). So with a pen the radius swings 0..2x with pressure, while the screen spacing still uses the radius without pressure.
- Polarity: `_negative`. The vendor ships true (Crease.js:11), but InputShell sets it to false at install, giving a raised ridge by default; alt or Negative carves (InputShell.ts:523-527).
- Not used: tilt, stroke direction.

Spacing and lifecycle
- `_spacing` = CREASE_SPACING 0.05 (tools.ts:124, 1911).
- Per stroke: DabSteps clear and begin at start (1914-1919).
- Per dab, vendor stroke (Crease.js:17-35): updateProxy, pushVertices, dynamicTopology, updateAlpha / setIdAlpha, crease(), updateGeometry.

Vertex selection
- The shared Euclidean sphere, with culling off.

Reference frame
- Fixed per dab: the picked normal n_p and the hit point c.

Strength share (tools.ts:1951-1961)
- step = DabSteps.step(side, c, r).
- I = crest curve lineIntegral, floored at 1e-3.
- amount = (S x p / scale) x step / (I x r).
- brushFactor = negative ? -amount : amount.
- pinchK = (amount / r) x pinch. The gather follows the crest. Upstream used 0.07 x intensity (Crease.js:50-53).

Operation (tools.ts:1963-1981; vendor Crease.js:54-73)
- P0 = proxy (first-touch) position.
- d = |c - P0| / r. Skip if d >= 1.
- gather = quartic(d) x mask x pinchK
- crest = curve.sample(d) x mask x brushFactor
- v += (c - P0) x gather + n_p x crest
- This is a pinch toward the dab centre point (3-D, not projected onto a plane) plus a displacement along the picked normal. The pinch direction does not flip with Negative.
- The alpha multiply is gone. Upstream's crest was pow(falloff, 5) x 0.07 x intensity x r (Crease.js:68).

Falloff
- Gather: quartic, always (1973).
- Crest: ProfileCurve(CREASE_PROFILES, 'sharp') (1900). Presets (profile.ts:836-840):
  - Sharp: quartic^12. I = 0.526.
  - Medium: quartic^5 (upstream). I = 0.714.
  - Soft: quartic. I = 1.2.

Accumulation and caps
- Per-dab additive. The crest is cm-calibrated per straight pass, as in Inflate. No cap.
- The gather is measured from the proxy position toward each new dab centre, so repeated dabs can keep pulling past the line. There is no clamp.

Symmetry
- Shared, with DabSteps per side.

Post-processing
- updateGeometry only.

Panel (SculptPanel.ts:326-346)
- Shared rows.
- "Profile" curve editor (Crease profile).
- "Pinch" 0-2.5 step 0.1, typed value >= 0. Default CREASE_PINCH 0.625; 1 is upstream (tools.ts:122, 1902).
- Strength default 0.75 cm (126, 1910).
- Spacing default 0.05.
- Radius default 25 px (Crease.js:9).

====================================================================
PRIMITIVES THAT RECUR ACROSS THESE TOOLS
====================================================================
1. Screen-space dab sampler: linear subdivision of pointer motion at spacing x radius_px, re-raycast per dab, one pressure value per event (SculptBase.sculptStroke).
2. Pick context per dab: hit point, hit face, interpolated picked normal, eye direction, and the screen-to-world-to-local radius conversion with the pressure radius factor (Picking).
3. Vertex gather: Euclidean sphere by octree, hidden poly-group filter, optional front-facing filter, optional dyntopo refine inside the radius before deforming.
4. Distance-to-falloff: d = |P_ref - c| / r, where P_ref is either the live position or the stroke-first-touch proxy. Weight comes from a quartic or a ProfileCurve (closed-form kernel, or a 256-entry LUT after an edit). Then x mask x alpha (alpha is always 1 now).
5. Reference-frame estimators: areaNormal and areaCenter (mask-weighted, over front vertices), picked normal, per-vertex normal, and a plane offset along the normal (+-0.1 r).
6. Displacement operators: along a fixed vector (crest along n_p); along the per-vertex normal (inflate); a one-sided fractional step toward a plane, clamped not to pass it (clay); gather toward the dab centre (crease pinch). Each is a scalar weight x a direction, summed per vertex.
7. Strength-as-length amortiser: amount = (S x p / scale) x step / (I x r), with DabSteps holding a per-side previous hit (Inflate, Crease). Clay's variant is a rate gain = min(cap, k x S x spacing-ratio / (I x r)) x p.
8. Pressure terms: getPressureLayer (0..1 amount, used by all three), getPressureRadius (0..2x size), and per-tool amount plus curve (linear, soft, firm).
9. Polarity: the `_negative` flag, resolved per stroke from alt, the latch and the arm. It flips the sign or the plane side, never the gather direction.
10. Symmetry: a mirrored ray across a per-mesh plane, the same local radius, the mirror dab run after the main dab on the updated surface, and any per-side state kept separately.
11. Post-dab update: updateGeometry (face normals, unit ring vertex normals, octree, dirty ring to the GPU), a buffer upload per pointer event, and balanceOctree at stroke end.
12. Undo: one state per stroke, first-touch vertex snapshots per dab (plus faces under dyntopo), and cleanNoop at the end.
13. Proxy snapshot: the stroke-first-touch position via STATE_FLAG (updateProxy). It only matters on static meshes.
14. Parameter surface: radius (px or world), strength (cm or 0..1), pressure amount and curve per channel, spacing, profile curve with presets, tool scalars (pinch), per-brush symmetry on/axis, and the Shift-smooth settings.
