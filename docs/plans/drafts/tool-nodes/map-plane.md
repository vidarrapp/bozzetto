TOOL ANATOMY: FLATTEN, POLISH, PINCH, SMOOTH (+ retired TWIST)
Read-only study. Nothing was edited, built or run.
Path shorthands: V = src/sculpt/vendor/editing/tools, VM = src/sculpt/vendor/math3d, B = src/sculpt/bridge, UI = src/sculpt/ui.

======================================================================
0. SHARED PIPELINE (every tool below inherits it unless its block says otherwise)
======================================================================
Registry: SculptSession puts its own classes into the vendor slots. TWIST becomes PolishBrush (B/SculptSession.ts:377), FLATTEN becomes FlattenBrush (:390) and SMOOTH becomes StableSmooth (:403-405). PINCH keeps the vendor Pinch class (V/Tools.js:23; there is no bridge override).

Inputs common to all:
- Position: the pointer in device px. Each dab re-casts a ray from the screen point (VM/Picking.js:195-266) and gets the hit point c in mesh-local space. Faces of hidden poly groups are not hit (Picking.js:229-232).
- Pressure: Tablet.pressure. A pen gives its real pressure. Mouse and touch are held at 0.5 (B/InputShell.ts:557-575).
  - Strength factor P = Tablet.getPressureIntensity(), patched by DynamicsStore to P = 1 + amount*(curve(p)*2-1) (B/dynamics.ts:120-128).
  - Curves: linear p, soft p^0.6, firm p^1.8 (dynamics.ts:36-40).
  - Defaults for these tools: strength amount 1, size amount 0 (dynamics.ts:57-61,75). So P runs 0..2, a mouse gives P=1, and the radius is constant.
  - Radius factor = getPressureRadius(), the same formula on the size amount (dynamics.ts:129-132).
- Tilt and stroke direction: not read by any of these tools. Twist reads screen angular motion (see its block).
- View direction: picking.getEyeDirection(), the ray direction in local space (Picking.js:222-225). It is used for front-facing tests.
- Modifiers (handled once, at press, in InputShell.onPointerDown):
  - Ctrl swaps in MASKING for the stroke (InputShell.ts:1443-1446).
  - Shift swaps in SMOOTH for the stroke, or PAINT_BLUR over Paint (1447-1463).
  - Ctrl+Shift is the loop-mask drag, not a stroke (1430-1433).
  - Polarity: if the tool has `_negative`, then `_negative = ctrl ? !alt : alt ? !base : base`. Here base is the tool's own default, flipped by the toolbar Negative latch and the one-shot arm (1480-1492). It is restored at release by restoreStrokeTool (2236-2247).

Radius:
- `_radius` is in screen px (default 50, V/Flatten.js:9 etc.).
- Local radius: rWorld2 = sqDist(hit, unproject(project(hit) + _radius*pixelRatio*radiusFactor)), then rLocal2 = rWorld2 / meshScale^2 (Picking.js:393-408). It is recomputed at every dab's hit.
- In world scale, `_radius` is derived from a stored world radius at the depth under the cursor (B/worldScale.ts:146-150).

Stroke lifecycle:
- Press: SculptBase.start (V/SculptBase.js:39-63).
  - Ray-casts all meshes and picks the mesh.
  - initAlpha. Picks the mirrored side if symmetry is on.
  - pushState: one undo state per stroke (states/StateManager.js:45-50; STATE_FLAG++ at :71).
  - Sets _lastMouse = mouse, then startSculpt → sculptStroke. Because the distance is still 0, NO dab is laid at the press (SculptBase.js:133-140). The first dab comes only after the pointer has travelled more than the spacing.
- Move (InputShell.ts:1772-1777): feedPressure, worldScale.sync, preUpdate, update → sculptStroke (SculptBase.js:128-159).
  - minSpacing = spacing * _radius * pixelRatio, in SCREEN px (:137). Default spacing is 0.15 (:26).
  - N = floor(dist / minSpacing) dabs, evenly spaced along the screen segment from the last position to now, the last one exactly at the pointer (:142-153). Leftover distance is not carried over.
  - Each dab is makeStroke (:166-195):
    1. Ray-cast at the dab's screen point, pickVerticesInSphere(rLocal2), computePickedNormal.
    2. stroke(picking) for the main side.
    3. THEN the mirrored picking ray-casts on the surface the main dab left, copies the main side's radius, picks, and runs stroke(pickingSym) (Bozzetto edit, :174-193).
  - After the dabs: updateRender (GPU buffers).
- Per dab, inside stroke():
  - pushVertices(iVerts). The first touch in a stroke saves the original position (states/StateGeometry.js:38-57).
  - Optional dynamicTopology (SculptBase.js:370-418).
  - The operation.
  - mesh.updateGeometry(facesOf(iVerts), iVerts): face AABB and normals, the normals of EVERY vertex of the touched faces (Bozzetto edit, vendor/mesh/Mesh.js:388-398), octree update.
- Release: tool.end → mesh.balanceOctree (SculptBase.js:65-68), then StateManager.cleanNoop (InputShell.ts:2193-2197).

Vertex selection (default):
- pickVerticesInSphere: Euclidean sphere of rLocal2 around the hit, using octree cells (Picking.js:273-303).
- Vertices of hidden poly-group faces are dropped (:282-294).
- The topological variant (pickVerticesInSphereTopological, :318-390) is NOT used by these tools.

Mask:
- mAr[ind+2], where 1 means free and 0 fully masked (V/Masking.js:144-146). Every operation multiplies by it.

Alpha:
- picking.getAlpha(x,y,z) returns 1 whenever no stencil texture is set (Picking.js:62-79).
- Stencils are retired. ALPHAS holds only the 'none' key (Picking.js:463-467), so `_idAlpha = 0` resolves to undefined and the alpha is 1.

Culling:
- `_culling` is false on every tool below and is exposed nowhere.
- getFrontVertices keeps vertices whose n·eye <= 0 (SculptBase.js:215-230).

Symmetry:
- Per brush, from SymmetryStore (default on, X axis) (B/symmetry.ts:182-220).
- Installed when a brush is picked (B/SculptSession.ts:707-725). The Shift and Ctrl swaps never install their own, so they mirror the way the brush in hand does.
- The mirror is the ray reflected across mesh.getSymmetryOrigin/Normal (Picking.js:210-216).

Common Tool panel rows (UI/SculptPanel.ts):
- World-scale size checkbox (97-107).
- Size 5..500, step 1, typed minimum 1 (35-42, 195-209).
- Pressure: size 0..1 step 0.05, with Size curve (shown only when the amount is above 0) (214-237).
- Strength 0..1 step 0.01 for fraction tools (240-257; spec at B/InputShell.ts:716-721; ; and ' keys step 0.03, :221).
- Pressure: strength 0..1, with Strength curve (258-281).
- Spacing 0.02..0.6 step 0.01, typed minimum 0.02 (288-295).
- Symmetry section: "Mirror sculpting" checkbox and X/Y/Z buttons (676-701).
- "Smooth (Shift)" group (441-487; hidden for Paint, Paint blur, Mask and Smooth, 456-459).
- Strength for all four tools is a capped 0..1 fraction, not cm (B/tools.ts:48-57).

======================================================================
1. FLATTEN  (FlattenBrush, B/tools.ts:516-582; flow from V/Flatten.js:17-39)
======================================================================
Slot and key: FLATTEN, '6' (UI/SculptToolbar.ts:261; src/ui/keymap.ts:98).

Defaults (Flatten.js:6-15): radius 50 px, intensity 0.75, `_negative` TRUE, culling false, idAlpha 0, lockPosition false.

Inputs:
- Hit position, pressure (P), eye direction (for the plane fit), mask.
- Alt or Negative flips `_negative`. No other modifiers.

Sampling and lifecycle:
- Shared spacing (0.15 by default, editable).
- Everything is computed per dab. Nothing is kept per stroke.

Vertex selection:
- Shared sphere pick.
- Then dynamicTopology (Flatten.js:23).
- iVertsFront = front-facing subset (:25). Culling is off, so the back-facing vertices in the sphere ARE moved.
- The plane comes from the front vertices only.
- The sphere is Euclidean, not topological. Hidden poly groups are excluded.

Reference frame (per dab, from the current surface):
- aNormal = normalize(Σ mask_i * n_i) over the front vertices (SculptBase.js:233-252).
- aCenter = Σ mask_i * p_i / Σ mask_i over the front vertices (:255-273).
- If there are no front vertices (null normal) the dab does nothing (Flatten.js:29-31).
- The falloff centre is the hit point c, not aCenter.

Falloff:
- The vendor quartic inline: q(d) = 3d^4 - 4d^3 + 1, with d = |p - c| / r. Vertices with d >= 1 are skipped (tools.ts:569-575).
- It is not a ProfileCurve. There is no curve UI.

Operation (tools.ts:559-579):
- s = (p - aCenter) · aNormal.
- comp = _negative ? -1 : +1. Skip the vertex if s*comp > 0.
  - Default (comp -1): only vertices ON or ABOVE the plane move. Bumps are shaved.
  - Alt: only vertices BELOW the plane move. Dents are filled.
- Δp = -aNormal * s * q(d) * k * mask * alpha, with k = min(1, intensity*P).
  - The cap at tools.ts:561 is the Bozzetto change. Upstream lets k reach 1.5 and overshoot the plane.

Accumulation and caps:
- Per-dab multiplicative approach to a plane that is refitted each dab.
- At k=1 and q=1 a vertex lands exactly on the plane. There is no stroke-level cap.
- The proxy branch is dead: `_accumulate` is never set on Flatten, so vProxy = vAr (tools.ts:548-549; Flatten.js:47).

Symmetry: the shared dual stroke(). Each side fits its own plane.
Post-processing: updateGeometry only. No smoothing pass.
Undo: shared.

Tool panel:
- The common rows only. No extras branch (SculptPanel.ts:302-393 has no FLATTEN case).
- Help text: src/help/content/tools.ts:94-102.

Special: the "one-sided by default" polarity, which makes it a shave rather than a true flatten.

======================================================================
2. POLISH  (PolishBrush extends Flatten, B/tools.ts:584-827; in the TWIST slot)
======================================================================
Slot and key: TWIST enum, '9', label "Polish" (SculptToolbar.ts:266; keymap.ts:101; SculptSession.ts:368-377).

TWIST-slot side effect:
- SculptManager.canBeContinuous() is false for TWIST (vendor/editing/SculptManager.js:58-69).
- So preUpdate skips its per-move re-pick (SculptBase.js:85-86).
- This is harmless, because makeStroke re-casts per dab. Polish uses SculptBase.sculptStroke, not Twist's.

Defaults:
- intensity 0.9, `_negative` false (two-sided), idAlpha null (tools.ts:628-633).
- planeLock POLISH_STICK = 0 (:157, :610).
- gain POLISH_GAIN = 0.8 (:158, :614).
- curve ProfileCurve(POLISH_PROFILES, 'default') (:612).
- Constants: clip band POLISH_CLIP = 0.25 * radius (:155); minimum inliers POLISH_MIN_GRIP = 8 (:159); normal gate POLISH_NORMAL_COS = 0.5, about 60° (:169).
- Radius 50 px and spacing 0.15 are inherited.

Inputs:
- Hit position, P, eye direction (front subset), vertex normals.
- Alt or Negative gives shave-only ("trim").

Lifecycle:
- start() and end() clear the held normals (:640-649).
- Per stroke: a held plane normal for EACH symmetry side, `held.main` and `held.sym` (:623-626, side chosen at :667-668).
- Per dab: the plane centre is re-anchored and the normal is refit and blended.

Vertex selection:
- Sphere pick, then dynamicTopology (:661).
- The front set is always computed and used for the fit (:663). Culling is off, so moves apply to the whole set, but the normal gate below effectively excludes back faces.

Reference frame (gripPlane, :694-761):
- Seed normal: the held normal, or areaNormal(front) on the first dab. seedC = areaCenter(front) on every dab (:703-709).
- Inliers: front vertices with |(p - seedC)·seed| <= clip AND (n_v/|n_v|)·seed >= 0.5 (:718-740).
- Refit: centre = the UNWEIGHTED mean of inlier positions. Normal = normalize(Σ inlier vertex normals). This is an average of normals, not PCA.
- Fewer than 8 inliers, or a degenerate normal: the dab does nothing (:741-743, :670).
- Blend with the held normal: n = normalize(h*s + n*(1-s)), s = clamp(planeLock, 0, 0.95) (:747-758). Then held = n (:759).

Falloff:
- curve.sample(d), d = |p - c| / r from the hit, skipped when d >= 1 (:813-820).
- ProfileCurve: the exact kernel while the curve is still on a preset, otherwise a 256-entry LUT with linear interpolation (B/profile.ts:649-658).
- Presets (profile.ts:843-847):
  - Default: plateau(0.35), full weight to 0.35r, then the quartic.
  - Wide: plateau(0.65).
  - Narrow: quartic².
- plateau(p) is defined at profile.ts:730-736.

Operation (polish, :769-826):
- s = (p - c_plane) · n.
- Skip if |s| > clip (:803). Features off the plane are untouched.
- Skip if shaveOnly and s < 0 (:804).
- Skip if the vertex-normal gate fails, the same 0.5 test (:807-812).
- frac = min(1, gain * intensity*P * curve(d) * mask) (:821).
- Δp = -n * s * frac (:822-824). This is two-sided by default: bumps go down, dents come up.
- No alpha term: setIdAlpha(null) (:672), and getAlpha is never called.

Accumulation and caps:
- Per dab, frac is capped at 1, so a vertex never overshoots the plane.
- The held normal gives the stroke stability. With lock 0 the plane follows the surface freely.

Symmetry: dual stroke() with independent held normals per side (the reason is given at :616-622).
Post-processing: updateGeometry only.
Undo: shared.

Tool panel extras (SculptPanel.ts:347-382):
- "Plane lock (follow-flatten)" 0..0.95, step 0.05.
- Profile curve editor ("Polish profile").
- "Build-up" (gain) 0.2..2, step 0.1, typed minimum 0.
- Plus the common rows.
- It is in InputShell.CURVE_TOOLS, so its curve is saved (InputShell.ts:825).

Special:
- An outlier-rejected fit (slab plus normal gate) that keeps edges sharp.
- A per-stroke held plane.
- A minimum-grip refusal.
- The doc comment is at tools.ts:584-602 and the constant notes at :128-169.

======================================================================
3. PINCH  (vendor V/Pinch.js, no override)
======================================================================
Slot and key: PINCH, '5' (SculptToolbar.ts:260; keymap.ts:97).

Defaults (Pinch.js:6-15): radius 50 px, intensity 0.75, `_negative` false, culling false, idAlpha 0, lockPosition false.

Inputs: hit position, P, mask. Alt or Negative inverts (pushes outward).

Lifecycle: per dab only, at the shared spacing.

Vertex selection:
- Sphere pick, then dynamicTopology (:23).
- Optional culling (:25-26), off.

Reference frame: the hit point c only. No normal and no plane.

Falloff:
- q(d), the vendor quartic inline, d = |c - p| / r (:56-59).
- There is NO explicit d >= 1 guard. It relies on the sphere pick.

Operation (:45-62):
- k = 0.05 * intensity*P, negated if `_negative`.
- Δp = (c - p) * q(d) * k * mask * alpha.
- This is a straight 3-D pull toward the hit point, not tangential. On curved forms it also pulls the surface in or out along the chord.

Accumulation and caps:
- Per-dab additive. No cap on intensity*P (up to 1.5 times 0.05 = 0.075 of the distance per dab at the centre).
- Not stroke-stable.

Symmetry: shared. Post-processing: updateGeometry. Undo: shared.
Tool panel: the common rows only, no extras (help at src/help/content/tools.ts:84-92).
Special: the hard-coded 0.05 gain.

======================================================================
4. SMOOTH  (StableSmooth extends vendor Smooth, B/tools.ts:409-514; V/Smooth.js; Surface mode in B/surfaceSmooth.ts)
======================================================================
Access:
- No toolbar slot and no digit. The Rake took '7' (SculptToolbar.ts:262-264).
- It is only reached through Shift+drag from any brush except Paint (keymap.ts:53; InputShell.ts:1447-1463).
- The swap happens at press and is restored at release.

Effective inputs during a Shift stroke:
- Radius: in screen scale, Smooth's OWN `_radius` (50 px, Smooth.js:10), not the brush in hand's. In world scale, the world radius of the brush in hand (worldScale.ts:53-65, 146-150).
- Spacing: Smooth's own `_spacing` 0.15, not exposed in the UI.
- Pressure: the SMOOTH tool's own dynamics entry, because DynamicsStore reads getToolIndex() (InputShell.ts:482). Defaults: strength amount 1, size 0.
- Symmetry: the brush in hand's (SculptSession.ts:707-713).
- No `_negative`, so Alt and Negative have no effect (InputShell.ts:1487).

Defaults:
- intensity 0.75 (SMOOTH_STRENGTH, tools.ts:31).
- smoothMode 'average' (:434), relax 0.25 (SURFACE_RELAX, surfaceSmooth.ts:68).
- `_accumulate` true (:442), so the Surface fit reads the current positions.
- `_tangent` false (Smooth.js:13), with no UI.

Lifecycle and selection:
- Per dab. Sphere pick.
- NO dynamicTopology call in either mode (Smooth.js:18-35; tools.ts:475-501).
- Culling is off.

4a. Average mode (default): vendor stroke, with the cap
- L_i = umbrella average of the one-ring vertex neighbours (SculptBase.js:296-368).
  - A boundary vertex averages only its boundary neighbours, when it has 2 or more.
  - A vertex of valence 2 or less stays where it is.
  - Jacobi: every L is computed into a scratch buffer before any write.
- p ← p*(1-s) + L*s, with s = min(1, intensity*P) * mask * alpha (Smooth.js:38-61; cap at tools.ts:503-505).
- NO radial falloff: the weight is uniform over the whole sphere.
- The tangent and along-normal variants carry the same cap (:507-513). They are used elsewhere: Subdivision.js:427-429, Remesh.js:328-330.
- Why the cap: P can reach 2, and for k > 1 the lerp diverges (doc at tools.ts:410-425).

4b. Surface mode (tools.ts:475-501, then SurfaceSmoother.run, surfaceSmooth.ts:145-690)
Flow:
- updateProxy if useProxy (off by default), pushVertices, optional culling, updateAlpha.
- run(mesh, iVerts, intensity, c, r, alpha, useProxy, relax).

Per dab:
1. lbar_i = the mean ring edge length of each dab vertex (:177-220).
2. Gather: octree sphere of radius R = r + min(r, 3*lmax*1.3^2), filtered by current position (:222-270). Hidden-group vertices are NOT filtered as fit points here, but they are never moved, since iVerts came from the hidden-aware pick.
3. Uniform grid with cell size 3*lmean, at most 1,048,576 cells (:272-321).
4. Per vertex, with s = min(1, intensity) * mask * alpha (:330, :349); skipped if s <= 0.
   - Neighbours within r_i = 3*lbar_i (SURFACE_K), excluding the vertex itself and any neighbour whose normal·n_i <= 0 (thin-wall test) (:370, :738-739).
   - The radius grows ×1.3 up to 2 times while there are fewer than 12 points (:372-376).
   - Over 30 points: keep the 30 nearest, h = 1.15 × the farthest kept (:380-386). Fewer than 3: skip (:388).
   - Weight w = (1-x)(1-0.488x), x = d²/h², which approximates a Gaussian (:84-88, :409).
   - Weighted PCA: the normal is the smallest eigenvector, oriented to agree with n_i, if λ0 <= 0.5*λ1; otherwise the vertex normal is used (:440-461; closed form at :806-897).
   - Quadratic height field h(u,v) = au² + buv + cv² + du + ev + f by 6×6 Cholesky (:484-577; :904-935). Used if cnt >= 6, λ1/λ2 >= 0.05 and the pivot ratio <= 1e8. Otherwise the plane.
   - Move along the fitted normal: δ = clamp(ht - hc, -1, 1) * h * s (:578-601).
   - Jacobi write (:603-608).
5. Tangential relax (:610-680):
   - Move toward the area-weighted centroid of the one-ring faces, projected into the tangent plane, by relax*s.
   - Boundary vertices are not relaxed. Jacobi.
6. Stats are written to `.last` (:681-689).

Accumulation: per-dab lerp toward a target, capped at k <= 1 in both modes. No stroke memory.
Symmetry: dual stroke(). Post-processing: updateGeometry (plus the relax pass in Surface mode). Undo: shared.

Tool panel:
- "Smooth (Shift)" group at the foot of every brush's panel except Paint (SculptPanel.ts:441-487):
  - Strength 0..1, step 0.01.
  - Mode select Average / Surface.
  - Relax 0..1, step 0.05, shown in Surface only (buildSmooth, 403-426).
- One shared setting set for all brushes, saved through serializeSmooth and loadSmooth (InputShell.ts:884-903).
- Smooth's own Size, Pressure and Spacing rows never appear, because it is never the active tool from the UI.

======================================================================
5. TWIST  (vendor V/Twist.js, RETIRED: not in the registry; PolishBrush took its slot)
======================================================================
For completeness, the one rotational primitive in this group:
- Radius 75 (:10).
- startSculpt records the 2-D press point and axis = -eyeDir (:23-43).
- Its own sculptStroke override has NO dab spacing: one stroke per move event (:46-66).
- The centre stays at the press-time hit: TWIST is non-continuous, so preUpdate never re-picks (SculptManager.js:60; SculptBase.js:85-86).
- angle = signedAngle2d(mouse - pressPt, lastMouse - pressPt). Ignored while the pointer is within 30 px of the press point (:88-99).
- Each vertex is rotated about the axis through c by angle * q(d) * mask * alpha (:116-123).
- The mirrored side passes the mouse positions in swapped order, so its angle is reversed (:61).
- updateAlpha(false) (:79).

======================================================================
RECURRING PRIMITIVES (candidate nodes)
======================================================================
1. Stroke sampler: screen-space dabs at spacing × screen radius, N = floor(dist / min), ending at the pointer, no dab at press (SculptBase.js:128-159). Twist's variant is per event, with a 2-D press anchor and an angle delta.
2. Dab context: re-cast hit c, rLocal from the screen radius × pressure-size unprojected at depth (or world scale), eye direction, picked normal (Picking.js:195-266, 393-445).
3. Vertex set: Euclidean sphere pick minus hidden groups. Then optional dyntopo refine, front-facing filter, mask weight (mAr[2]) and alpha weight.
4. Pressure scalar P = 1 + amount*(curve(p)*2-1), per tool (dynamics.ts:120-132).
5. Polarity flag `_negative` from alt × latch × arm (InputShell.ts:1480-1492).
6. Falloff: inline quartic q(d), or ProfileCurve.sample (kernel or LUT), or none (Smooth).
7. Frame estimators: areaNormal and areaCenter (mask-weighted, front set); robust banded refit with a normal gate; a held normal blended by stickiness per stroke per side; local PCA plane plus quadric height field (Surface).
8. Operations:
   - Project toward a plane by fraction k, one-sided or two-sided (Flatten, Polish).
   - Pull toward or away from a point (Pinch).
   - Lerp toward the umbrella Laplacian (Average).
   - Move along the fitted normal onto a local surface, then a tangential relax (Surface).
   - Rotate about an axis through a point (Twist).
9. Gates and caps: min(1, k) to avoid overshoot; slab |s| <= clip; normal-agreement cos >= 0.5; minimum-inlier refusal; d < 1.
10. Symmetry: run the same stroke() on a mirrored picking, main side first, with per-side state where a tool keeps any.
11. Commit: pushVertices (first touch per stroke), updateGeometry (normals of the touched faces' vertices, octree); at the end balanceOctree and cleanNoop; one undo state per stroke.
12. Modifier tool-swap at press (Shift → Smooth with its own radius, spacing and dynamics in screen scale; Ctrl → Mask), restored at release.