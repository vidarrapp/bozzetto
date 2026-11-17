Rake group: anatomy map. Read-only; nothing was edited, built or run.

The group is one tool, RakeBrush (src/sculpt/bridge/tools.ts:1507-1868), installed in the vendor slot Enums.Tools.RAKE = 13 (src/sculpt/vendor/misc/Enums.js:35, src/sculpt/bridge/SculptSession.ts:380). "Tines", "presets" and "scrape" are parts of that one brush, not separate tools. Block 1 is the brush, Block 2 the presets, Block 3 the Shift swap. File paths below are relative to /home/user/bozzetto.

======================================================================
BLOCK 1: RAKE (RakeBrush extends vendor Brush, implements StrengthCmBrush)
======================================================================

Identity / UI entry
- Toolbar slot 7: icon fi-ss-shredder, svg slot name 'smooth' (src/sculpt/ui/SculptToolbar.ts:264). Hotkey '7', action id tool.rake (src/ui/keymap.ts:99; dispatched at src/sculpt/bridge/InputShell.ts:2471).
- Constructor (tools.ts:1550-1556):
  - _idAlpha = null (no stencil alpha).
  - _clay = false (the vendor clay path is unused).
  - _spacing = RAKE_SPACING 0.06 (tools.ts:106).
  - applyPreset('coarse') (DEFAULT_RAKE_PRESET, tools.ts:1115).
- Inherited from vendor Brush (src/sculpt/vendor/editing/tools/Brush.js:11-18): _radius 50 px, _negative false, _culling false, _accumulate true, _lockPosition false.
- strengthUnit 'cm'. defaultStrength is the coarse preset's 0.3 (tools.ts:1508-1509).

INPUTS
- Position: the screen mouse position (device px). Each dab re-picks at an interpolated mouse position (vendor SculptBase.js:145-153, 166-173). The dab centre c is the local-space ray hit (tools.ts:1639).
- Pressure, two different terms:
  - (a) The cut depth uses the 0..1 "layer" term, strengthPressureTerm() → Tablet.getPressureLayer (tools.ts:192-194, 1597-1599, 1713). Patched in dynamics.ts:140-146 as 1 + amount*(curve(p) - 1). It is 1 for a mouse or finger (Tablet.pen false, InputShell.ts:557-575).
  - (b) The scrape rate uses the 0..2 swing term, Tablet.getPressureIntensity: intensity = RAKE_SCRAPE_STRENGTH 0.6 * swing (tools.ts:112, 1625). Swing is 1 + amount*(2*curve(p) - 1) (dynamics.ts:120-128).
  - Rake dynamics default to size 0, strength 1 (the fallback at dynamics.ts:75; the Rake is not in DEFAULTS, dynamics.ts:57-61).
  - Pressure on radius goes through Tablet.getPressureRadius in Picking.computeWorldRadius2 (src/sculpt/vendor/math3d/Picking.js:393-403). It is constant by default (size amount 0).
- Tilt: not used anywhere.
- Stroke direction: yes, the dab-to-dab delta of the local hit points, projected into the tangent plane (tools.ts:1641-1654).
- View direction: used only in getFrontVertices (vertex normal · eyeDir ≤ 0, SculptBase.js:215-230). That set drives the area normal, the plane fit and the level fit. The cut set itself is not view-culled (see Vertex selection). Under symmetry the eye direction is mirrored with the ray (Picking.js:213-224).
- Modifiers, from the press handler in InputShell.ts:1441-1492:
  - Alt flips _negative for the stroke (InputShell.ts:1486-1492), as do the toolbar Negative latch and arm (InputShell.ts:380-392).
  - Shift swaps the tool to SMOOTH for the whole stroke (InputShell.ts:1447-1464). The rake does not run under Shift.
  - Ctrl swaps to MASKING (InputShell.ts:1444-1446).
  - Ctrl+Shift drag is the loop mask (InputShell.ts:1430).
  - Discrepancy: the class comment (tools.ts:1455) and tools.ts:1717 say "the stroke's Ctrl flips it". In practice Ctrl never reaches the rake; Alt or the Negative button flips it.
- Invert: comp = (invert XOR _negative) ? -1 : +1 (tools.ts:1718). comp +1 carves grooves inward along -n; comp -1 raises ridges.

DAB SPACING / SAMPLING
- Screen-space resampling (SculptBase.sculptStroke, SculptBase.js:128-159). minSpacing = _spacing(0.06) * _radius(px) * pixelRatio (SculptBase.js:137). The segment since the last event is split into floor(dist / minSpacing) equal steps, one makeStroke per step. Nothing happens if dist ≤ minSpacing.
- World-scale mode rewrites _radius from a pinned world radius before each step, so the spacing tracks world size (src/sculpt/bridge/worldScale.ts:6-34; InputShell.ts:1512, 1775).
- No lazy mouse or stroke smoothing.
- Continuous (timer) mode is possible (SculptManager.js:58-81) but _continuous is false by default.

STROKE LIFECYCLE
- Press: InputShell.ts:1517 → SculptManager.start → RakeBrush.start (tools.ts:1601-1618).
  - Clears prev.main/sym and strokeAcross. cuts.begin() bumps the StrokeMoves stroke id (tools.ts:291-293), so every older entry counts as "form".
  - super.start (SculptBase.js:39-63) does the hit test, picking.initAlpha, pushState (undo state) and startSculpt → sculptStroke. That makes no dab because dist = 0.
  - Then prev[side] = the press intersection point and fromPress[side] = true, for both sides when symmetry is on.
- Move: InputShell.ts:1771-1789 runs feedPressure, worldScale.sync, preUpdate (re-pick) and update → sculptStroke → N × makeStroke → stroke(picking) for the main side, then a re-pick of the mirrored side on the already-modified surface and stroke(pickingSym) (BOZZETTO EDIT, SculptBase.js:174-195). It then syncs the cursor tines and axis (InputShell.ts:1782-1783).
- Release: endStroke → SculptManager.end → SculptBase.end → mesh.balanceOctree (SculptBase.js:65-68), then StateManager.cleanNoop (InputShell.ts:2192-2200). restoreStrokeTool restores _negative and the swapped tool (InputShell.ts:2237-2247). The cursor tine axis is cleared (InputShell.ts:2179). RakeBrush has no end() override.
- Computed once per stroke: the StrokeMoves id, the press point (the seed for the first direction) and the per-side frame memory.
- Computed per dab, everything else: picked set, front set, area normal, step, direction, form plane, level reference, depth, spacing factor.
- Persists across strokes: prevAcross[side] (the fallback axis), the cuts/scraped buffers (grown, never shrunk, tools.ts:295-308, 1732-1736).

PER-DAB FLOW (RakeBrush.stroke, tools.ts:1621-1676; an edited copy of vendor Brush.stroke)
1. iVertsInRadius = picking.getPickedVertices() (tools.ts:1623).
2. If !_accumulate, updateProxy. Inactive by default (tools.ts:1627).
3. Undo: StateManager.pushVertices(iVertsInRadius) (tools.ts:1628).
4. dynamicTopology(picking): subdivide/decimate in the sphere when the mesh is dynamic (tools.ts:1629; SculptBase.js:370-418).
5. iVertsFront = getFrontVertices(..., eyeDir). If _culling (false), iVertsInRadius = front (tools.ts:1631-1632).
6. picking.setIdAlpha(null) (tools.ts:1633).
7. n0 = areaNormal(front): the mask-weighted mean of vertex normals, normalized (SculptBase.js:233-252). Return if it has zero length (tools.ts:1635-1637).
8. Direction (tools.ts:1641-1666):
   - d = c - prev[side]; step = min(radius, |d|).
   - If step > 1e-4 * radius: along = norm(tangent(d, n0)), and directionFrom = 'press' or 'previous-dab'.
   - across = norm(n0 × along).
   - Fallback 1: prevAcross[side] re-tangented ('previous-stroke').
   - Fallback 2: world X (or Y if |n.x| ≥ 0.9) made tangent ('fallback'). In both fallbacks along = across × n0.
   - Stores prev[side] = c, prevAcross[side]; strokeAcross = across on the main side only (tools.ts:1667-1670).
9. rake(...) (tools.ts:1672), then mesh.updateGeometry(faces of iVerts, iVerts): normals and octree, per dab (tools.ts:1674-1675).

VERTEX SELECTION
- Sphere: Euclidean, picking.pickVerticesInSphere(localRadius²) (Picking.js:273-305), via octree cells, inside the sphere around the hit point. It is not topological; the topological variant at Picking.js:318-390 is not used by the rake.
- Radius: _radius is screen px. computeWorldRadius2 offsets the projected hit by _radius * pressureRadius px and unprojects at the hit depth (Picking.js:393-403). local² = world² / meshScale² (Picking.js:405-408). In world-scale mode the slider pins the world radius (worldScale.ts). The mirrored side reuses the main local radius (SculptBase.js:187).
- Hidden poly groups: faces of hidden groups are not hit (Picking.js:229-232), and their vertices are left out of the picked set (Picking.js:282-294).
- Front-facing: only for the frame fits. The cut loop runs over all picked vertices, backfacing ones in the sphere included (_culling false, no UI toggle).
- Inner loop: dist = |vProxy - c| / radius with vProxy = current positions (accumulate) (tools.ts:1696, 1771-1775). Skip if dist ≥ 1 or mask ≤ 0 (tools.ts:1775-1777).
- Mask: mAr[ind+2] (1 = free, 0 = masked) multiplies the area normal and centre weights, the scrape rate and the cut (tools.ts:1776, 1798, 1824-1825).

REFERENCE FRAME (rake(), tools.ts:1691-1749)
- Form: front-vertex positions minus this stroke's own recorded cut, from StrokeMoves.form (tools.ts:316-329, 1703). An entry is valid only for this stroke id and while the stored position is bit-identical; that survives dyntopo renumbering (tools.ts:310-314).
- formPlane (tools.ts:1184-1226, called at 1704):
  - Centre = the mask-weighted mean of the form.
  - Normal = n0 refined by a weighted least-squares height field z = sa*x + sb*y over n0's tangent axes (a0 = across0, b0 = along0): n = norm(n0 - sa*a0 - sb*b0). The fit is skipped when degenerate (det threshold, tools.ts:1218-1224).
  - Returns null if everything is masked, and the dab aborts (tools.ts:1705).
- Axes are re-orthogonalized to the fitted n: across = norm(tangent(across0, n)), along = across × n (tools.ts:1708-1709).
- Two origins:
  - Plane point P = the form mean (ax, ay, az); used by the scrape and level.
  - Dab centre c = the pick point; used for dist, u and w.
- One displacement direction per dab: the fitted plane normal n. Per-vertex normals are not used.
- No grab start point and no view-plane frame.

OPERATION PER VERTEX (single pass, tools.ts:1769-1866)
Let p = vProxy - c, k = this stroke's cut so far (0 if no valid entry), v = current position.

Stage 1, Scrape (tools.ts:1797-1809), if scrape > 0:
  rate = min(1, scrape * quartic(dist) * intensity * mask)
    where intensity = 0.6 * pressureIntensity, the 0..2 swing
  h = ((v - k) - P) · n        (the form's height above the plane, so the cut rides along)
  v -= n * h * rate            (capped so the vertex never passes the plane, from both sides)
  quartic(d) = 3d^4 - 4d^3 + 1 (src/sculpt/bridge/profile.ts:723-727)

Stage 2, Tine cut (tools.ts:1811-1854):
  u = (p · across) / R,  w = (p · along) / R
  slot = clamp(floor((u + 1) * N / 2), 0, N - 1)
  centre = ((slot + 0.5) / N) * 2 - 1
  halfWidth = tineWidth / N                          (tools.ts:1712)
  t = |u - centre| / halfWidth
  prof = t < 1 ? curve.sample(t) : 0                 (tine cross-section)
  chord = sqrt(max(0, 1 - u^2))
  aw = |w| / max(1e-6, chord)
  alongFall = aw < 1 ? quartic(aw) : 0               (along-stroke falloff over the disc chord)
  depth = max(0, strength_cm) * pressureLayer / mesh.getScale()   (tools.ts:1715)
  spacingFactor = step / (1.2 * R)                   (RAKE_ALONG_INTEGRAL 1.2, tools.ts:1125, 1716)
  full = depth * prof * (1 - taper * |centre|) * mask
  share = depth * prof * (1 - taper * |centre|) * alongFall * mask * spacingFactor / max(0.2, chord)
          (RAKE_MIN_CHORD 0.2, tools.ts:1127)
  amount = -comp * share
  v += n * amount;  k += n * amount
- Write v (tools.ts:1855-1857). Record k with the read-back position in StrokeMoves (tools.ts:1859).

Stage 2', Stop at depth (level, on by default) (tools.ts:1730-1749, 1826-1845; levelSurface at 1303-1413):
- Per dab, when level && depth > 0:
  - Take the front-vertex form with this stroke's scrape also removed (scraped[id*4..+2], tools.ts:1737-1744). That gives the pre-stroke surface.
  - levelSurface fits a mask-weighted quadric a + bx + cy + dx² + exy + fy² over the plane, with x, y in radii, using the Gauss solver at tools.ts:1237-1267. It needs at least 24 live vertices (LEVEL_MIN_VERTICES, tools.ts:1129); otherwise the plane itself is used.
  - Upper side: grid the disc into N×N cells of one slot each from c. Each cell keeps its max height over the quadric; offset = the vertex-count-weighted median of the cell maxima (tools.ts:1383-1406).
  - Refit with vertices lower than offset - 0.2*depth raised to that band (LEVEL_BAND, tools.ts:1131), then take the median again (tools.ts:1407-1411).
  - sgn = comp mirrors it for ridges (min per cell, offset below).
- Per vertex:
  - o = the pre-stroke position (v - k - s).
  - stood = (o - P)·n - (quadric(x, y) + offset).
  - kept = Π(1 - rate) over the dabs, the fraction of height the scrape left.
  - sunk = k·n - slope-corrected tangential part of k * kept.
  - over = stood * kept + sunk.
  - room = comp * over + full.
  - share = room > 0 ? min(share, room) : 0.
  - The floor is the reference minus the whole stroke depth; for ridges a ceiling above.
- Scrape bookkeeping (s, kept) goes into the `scraped` Float32Array, 4 per vertex (tools.ts:1548, 1789-1808, 1860-1865).
- With level off, every pass cuts deeper (plain standard-brush accumulation).

ACCUMULATION AND CAPS
- Per-dab additive displacement along the per-dab fitted normal (standard brush, tools.ts:1441-1457).
- Strength in cm: one full-pressure stroke sums to `depth` at the tine centre whatever the radius, spacing or speed. The spacing compensation is step / (1.2 * chord * R), and the step is held to R (tools.ts:1117-1125, 1494-1500, 1649).
- The frame is stroke-stable (StrokeMoves); the displacement itself is not.
- Caps:
  - Scrape rate min(1, …), never past the plane.
  - Level floor or ceiling, per vertex, from the pre-stroke reference.
  - Strength range 0..50 cm (set clamps at tools.ts:1586).
- No layer cap otherwise; with level off, passes stack without limit.

SYMMETRY
- Per-brush on/axis store, default on across X (src/sculpt/bridge/symmetry.ts:18-30). Installed on brush pick: SculptSession.applyBrushSymmetry (SculptSession.ts:718-725), called from InputShell.ts:2584. Toggle with x (keymap.ts:60, InputShell.ts:2436) or the Symmetry section in the panel (SculptPanel.ts:676-700).
- The mirrored Picking mirrors the ray across mesh.getSymmetryOrigin/Normal (Picking.js:213-219).
- The rake keeps an independent frame per side: prev, prevAcross and fromPress keyed 'main'/'sym' (tools.ts:1530-1532, 1638). StrokeMoves and scraped are shared, keyed by vertex.
- lastDab is a single field, overwritten by whichever side dabs last (tools.ts:1750), despite the "per side" doc comment (tools.ts:1133).

POST-PROCESSING
- mesh.updateGeometry per dab (normals and octree). balanceOctree at stroke end.
- No smoothing pass inside the rake.
- Dyntopo runs before the op each dab.

UNDO
- One geometry state per stroke (pushState in SculptBase.start, SculptBase.js:57, 70-72).
- pushVertices for every dab's sphere before the move (tools.ts:1628).
- pushFaces / topology for dyntopo (SculptBase.js:384, 394).
- Mirrored dabs land in the same state. cleanNoop at the end drops an empty stroke (InputShell.ts:2197).
- Tool settings are not in undo.

TOOL PANEL SETTINGS (src/sculpt/ui/SculptPanel.ts)
Shared rows:

| Row | Range / default | Where |
|---|---|---|
| Size | 5..500 px or world units (typed min 1) | 195-207 |
| Pressure: size | 0..1, default 0 for the rake | 221-236 |
| Size curve | Linear / Soft p^0.6 / Firm p^1.8 (dynamics.ts:36-40) | 214-220 |
| Strength | cm, 0..5 slider, step 0.01, typed to 50 (InputShell.ts:716-721; tools.ts:58-63) | 245-257 |
| Pressure: strength | 0..1, default 1 | 266-280 |
| Strength curve | as Size curve | 258-264 |
| Spacing | 0.02..0.6, step 0.01, default 0.06 (InputShell.ts:770-788) | 287-293 |

Rake rows (buildRake, SculptPanel.ts:507-562; called at 389):

| Row | Range / default | Where |
|---|---|---|
| Preset buttons | Fine / Comb / Coarse / Chisel / Scraper; lit while presetId matches | 514-533, refreshed 716-721 |
| Tines | 2..12, integer, step 1 (RAKE_TINES_MIN/MAX, tools.ts:114-115) | 542 |
| Tine width | 0.1..1, step 0.05; the fraction of each tine's slot | 543 |
| Scrape | 0..1, step 0.05 | 544 |
| Taper | 0..1, step 0.05; depth * (1 - taper * abs(centre)) | 545 |
| Invert (raise ridges) | checkbox | 546-551 |
| Stop at depth | checkbox, plus a hint line | 552-560 |
| Tine profile | curve editor; presets Round (dome sqrt(1 - t²), default), V (1 - t), Flat (plateau 0.7), Soft (quartic) (profile.ts:858-863, tools.ts:1518) | 561 |

- Curve evaluation: the exact kernel while the anchors are a preset's; otherwise a 256-entry LUT with linear interpolation (profile.ts:629-657, 705-714).

Footer group "Smooth (Shift)", shared by every brush (SculptPanel.ts:441-490): Strength 0..1, Mode Average/Surface, Relax 0..1 (Surface only).

Symmetry section: Mirror sculpting checkbox and X/Y/Z buttons.

Setters:
- RakeBrush.set clamps each knob and clears presetId unless every knob equals the preset's (tools.ts:1580-1594). The profile curve is not compared, so editing the tine curve leaves the preset button lit.
- Changing Strength anywhere calls rake.set({}) to re-check the preset (InputShell.ts:1203-1211, 1270-1271).

ANYTHING SPECIAL
- Cursor: one circle per tine on the across axis, centres at (k + 0.5)/N*2 - 1, radius R*width/N, opacity fading with taper (src/sculpt/bridge/BrushCursor.ts:443-474, 677-720).
  - On hover the axis is perpendicular to the smoothed pointer motion; during a stroke it is rake.strokeAcross (InputShell.ts:645-670).
  - Mid-stroke style is 'dim' (ring kept faint) rather than 'dot' (InputShell.ts:1580-1588).
  - Tines are hidden while Shift is held (InputShell.ts:647).
- Persistence: SavedRake {tines, width, strength, scrape, taper, invert, level, preset} (src/sculpt/bridge/ScenePersist.ts:86-92; InputShell.ts:865-882; read through src/sculpt/bridge/sanitize.ts:243-255).
  - sanitize clamps tines to 0..64, then set() clamps to 2..12.
  - Legacy fields: `plateau` maps to scrape. `depth` (a fraction of the radius) becomes strength via depth * 3 cm (STRENGTH_CALIBRATION_RADIUS) (tools.ts:1088-1094, 1585-1587). An old 0..1 strength converts with rake fraction 0.6 = 0.3 cm (tools.ts:202-220).
  - The tine curve is saved in the shared curves table (InputShell.ts:824-862, CURVE_TOOLS includes RAKE).
  - Load order: preset first, then knobs (src/sculpt/mode.ts:1444-1447).
- Debug and test surface: lastDab: RakeDab holds every per-dab term (tools.ts:1134-1162, 1750-1768).
- History: tine rake 7ab5c02, Standard-brush model plus Scrape 38cadc2, cm strength 2d39e2a, Stop at depth 564dbe0/f4b9533. Notes in docs/sculpt-mode-implementation.md:581-607.

======================================================================
BLOCK 2: RAKE PRESETS (RAKE_PRESETS, tools.ts:1108-1115)
======================================================================
Data-only bundles. applyPreset sets every knob, the strength and the tine profile (tools.ts:1559-1566).

| id | tines | width | strength | scrape | taper | invert | level | profile |
|---|---|---|---|---|---|---|---|---|
| fine | 8 | 0.45 | 0.15 cm | 0.15 | 0 | false | true | v |
| comb | 12 | 0.5 | 0.12 cm | 0.1 | 0 | false | true | round |
| coarse (default) | 4 | 0.7 | 0.3 cm | 0.25 | 0 | false | true | round |
| chisel | 3 | 0.75 | 0.25 cm | 0.5 | 0 | false | true | flat |
| scraper | 5 | 0.8 | 0.15 cm | 1 | 0 | false | true | flat |

The strengths are the old Depth fractions times the 3 cm calibration radius (tools.ts:1103-1107). The panel button lights while the knobs match (tools.ts:1591-1593).

======================================================================
BLOCK 3: SHIFT WHILE THE RAKE IS IN HAND (a tool swap, not rake code)
======================================================================
Shift at press sets the tool to StableSmooth (Enums.Tools.SMOOTH) for the stroke (InputShell.ts:1447-1464). It is restored on release (InputShell.ts:2237-2247).

The Smooth stroke:
- Uses the shared Smooth settings (SculptPanel.ts:441-490).
- In world scale it takes the rake's size (worldScale.ts:51-65).
- Takes the rake's symmetry, because the swap skips applyBrushSymmetry (SessionSculpt.ts:707-713).

Its anatomy belongs to the Smooth group map.

======================================================================
RECURRING PRIMITIVES (seen in the Rake and shared with other tools)
======================================================================
1. Dab scheduler: screen-space resampling at spacing * radius_px * pixelRatio; one pick and one stroke per dab; mirrored pick after the main dab (SculptBase.js:128-195).
2. Radius resolve: screen px → world radius by unprojecting at the hit depth (× pressure radius), or a pinned world radius; then local = world / scale (Picking.js:393-408; worldScale.ts).
3. Vertex gather: Euclidean sphere via the octree, hidden-poly-group filter (Picking.js:273-305). A topological variant exists (Picking.js:318-390).
4. Front filter: vertex normal · eye ≤ 0 (SculptBase.js:215-230).
5. Mask weight mAr[i*3+2], multiplied into weights and moves; mask ≤ 0 skipped.
6. Frame estimators: area normal (mask-weighted normal mean), area centre (mask-weighted mean), least-squares plane fit (formPlane), quadric fit plus robust upper-side offset (levelSurface).
7. Stroke-direction frame: tangent of the dab-to-dab delta, across = n × along, with fallbacks; kept per symmetry side (also the vendor alpha frame, Picking.js:81-100).
8. Falloff evaluators: quartic(d) and ProfileCurve.sample(t) (kernel or LUT), plus lineIntegral for spacing compensation (profile.ts:649-678, 723-727). Rake-specific separable shapes: across = tine profile on a periodic slot coordinate; along = quartic over the disc chord.
9. Strength-as-length with spacing compensation: amount = strength_cm * pressureLayer / scale * step / (integral * R); the step is the distance between dab hits, clamped to R. The rake uses its own copy; Crease and Inflate share the DabSteps class (tools.ts:248-270).
10. Pressure channels: getPressureRadius (size), getPressureIntensity (0..2 swing), getPressureLayer (0..1 amount); per-brush amount and curve (dynamics.ts).
11. Ops: "pull toward a plane by min(1, rate) * height" (scrape, Clay, Flatten, Polish) and "displace along one normal by an amount" (the cut, Standard, Inflate, Crease).
12. Stroke-stable bookkeeping: StrokeMoves, a per-vertex move recorded for this stroke and validated by the exact stored position (dyntopo-safe); "form = position - this stroke's moves" (tools.ts:284-341).
13. Clamp to floor or ceiling from a pre-stroke reference (the level cap).
14. Polarity: the per-stroke _negative override (Alt, Negative latch/arm) XOR a per-tool invert flag.
15. Momentary tool swaps on modifiers: Shift → Smooth (or the paint blur), Ctrl → Mask, applied at the press and restored at release.
16. Per-brush stores: size, strength, spacing, dynamics, symmetry, profile curve, plus a preset bundle that sets several knobs and a curve at once.
17. Lifecycle hooks: start (undo state, seed per-stroke state); per dab (pushVertices → dyntopo → op → updateGeometry); end (balanceOctree, cleanNoop).
