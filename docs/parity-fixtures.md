# Brush parity fixtures

`scripts/parity-fixtures.mjs` records what the web engine's sculpt brushes do,
exactly, so a port of the brushes to another language can be tested against
it. For each brush and each of three meshes it writes one JSON file: the mesh
going in, every dab the engine made with the values it used, and the mesh
coming out.

## Running it

```bash
node scripts/parity-fixtures.mjs [outDir]            # record (default scratchpad/parity, gitignored)
node scripts/parity-fixtures.mjs [outDir] --verify   # re-run, compare to outDir within 1e-6
node scripts/parity-fixtures.mjs out --only=PaintBrush,Drag --tol=1e-9
node scripts/parity-fixtures.mjs old --verify --outputs --tol=0   # what the brushes did, not how their knobs are recorded
```

`--outputs` compares each file's input, press, moves, dabs and output and
nothing else: the check for a change that renames or reshapes a brush's
knobs but must not move a vertex. A recording that holds files this run does
not make (`alpha-rake06.json` from before the alphas were retired) is
cleaned of them when a new one is written over it.

It needs `npm ci` and nothing else: no build, no browser. The real sources
(`SculptSession` with its tool table, the bridge brushes in
`src/sculpt/bridge/tools.ts`, the vendored SculptGL tools and `Picking`) are
bundled with esbuild (installed with wrangler) and run under Node. The vendored
core is render-less, so the only browser piece stubbed is a no-op
`ResizeObserver` (the brush stencils, and the PNG decoding that served them,
went with the alphas in October 2026). What the app sets on the
tools outside the session (InputShell's pressure dynamics and Crease
polarity, mode.ts's paint flags, the shift and ctrl swaps) is mirrored in
`appInstall()` and listed in `meta.engine.appInstall`.

The run is deterministic (no randomness, no clock): two runs write identical
files. When the fixtures were introduced they were also replayed in the live
test build in Chromium, through `window.__sculpt`, and matched bit for bit,
the live tools' default parameters and dynamics included.

## What is recorded

Meshes, built through the session as the app builds them:

| key | mesh | vertices | faces |
| --- | --- | --- | --- |
| `cube` | the quad cube, two linear subdivisions (the Cube primitive's rule), identity matrix | 98 | 96 quads |
| `sphere` | `addSphere()`, the default sphere, one level down from the top: 25 cm tall in its vertices, matrix a translation | 6146 | 6144 quads |
| `plane` | `addPrimitive('plane')`, level 0: triangles, with a boundary: 50 cm across in its vertices, matrix a translation | 625 | 1152 triangles |

One world unit is a centimetre (October 2026, `src/viewer/units.ts`), and a
new object's size is built into its vertices with its matrix at scale 1. The
fixtures were re-recorded for it: the sphere's and the plane's local
coordinates are their real sizes in centimetres (they used to be three's own
small sizes under a matrix scale of about 0.3), so every file's positions,
radii and moves are about 30 to 100 times what they were, the plane's stroke
path is given on a plane 1.6 across and scaled to the one built
(`pathSpan`), and every move relative to the mesh's size is as it was: the
engine has no absolute length in it. The cube is built directly, not as a
primitive, and is as it was; its files changed with the shared `meta`.

Brushes, each with the defaults the app installs: the bridge brushes
ClayStripsBrush, CreaseBrush, PolishBrush, VolumetricMove, StableSmooth,
RakeBrush, FlattenBrush, PaintBrush and PaintBlurBrush, and the vendored
Inflate, Pinch, Drag and Masking. FlattenBrush and PaintBrush are the
vendored Flatten and Paint with the per-dab intensity capped at 1 (fixtures
recorded before that were named `Flatten.*` and `Paint.*`). Symmetry is off and dynamic topology is off. Every brush
has the same world radius on a mesh (0.3 of its world extent), as world-scale
sizing starts them; the pixel radius that gives it on the fixed camera is in
`brush.radius`.

The stroke: a press and five pointer moves. For the surface brushes the
pointer follows a fixed path across the mesh (over the cube's right edge,
onto the plane's right boundary), one dab per move. Move and Drag pull off the
surface instead. Pressure is 0.5 at the press and 0.5, 0.65, 0.8, 0.4, 0.5 on
the moves, which matters for the brushes whose dynamics use it. The
pressures are a pen's (`Tablet.pen` is set, as InputShell sets it for a
pen event): a mouse or a finger reports no pressure, and the clay layer
then takes the full term, 1.

The pressure terms (`meta.engine.tablet`): the strength and size factors are
`1 + amount * (curve(pressure) * 2 - 1)`, from 0 to 2 at full amount. The
clay layer's term is on the 0..1 scale instead: `1 + amount *
(curve(pressure) - 1)` with the strength channel's amount and curve, which at
the default full amount and linear curve is the pressure itself; it is 1 for
a mouse or a finger, or when the strength amount is 0.

## The camera and the dabs

The camera is a fixed orthographic one in doubles (`camera` in each file),
looking down `[-0.25, -0.2, -1]`. Mouse positions are device pixels on it.
Each dab goes through the engine's own path, named in `brush.entryPoint`:
`SculptManager.start` for the press, then per move what `sculptStroke` does
for one dab (`makeStroke`: pick at the pointer, gather the vertices within
the radius, interpolate the normal, `stroke(picking)`), or for Move and Drag
`SculptManager.update` itself. The release is `SculptManager.end`.

`dabs` holds every call the engine made to the tool, in order, with the
Picking state at that moment, all in mesh local space:

- `intersection`: the dab centre the loops use; `normal`: the picked normal;
  `eyeDirection`.
- `radiusLocal2` (what the loops use) and `radiusLocal`, and the world radius
  and screen radius they came from (`radiusWorld2`, `screenRadius`).
- `picked`: the vertex indices in the order the engine walks them.
- `pressure`, `pen` (always true here: the strokes are a pen's), and the
  factors it gave (`pressureIntensity`, `pressureRadius`, and
  `pressureLayer`, the clay layer's pressure term); `intensity` is the
  tool's strength times the factor.
- Clay: `layerPressure`, the layer term the dab used, and `layerOffset`, how
  far the build plane sits off the area centre along the area normal, in
  local units: `layer * radiusLocal * layerPressure` (negated in the loop
  when `_negative`). The layer follows pressure, so `layerPressure` is
  `pressureLayer`.
- Drag: `dragDir`. VolumetricMove: `center` (the press), `moveDir`.
- Rake: `rake`, the tine rake's dab (below).

`press` is the pointer-down; it is not a dab, except for Drag, whose first
dab is at the press.

## Profile curves

Clay, Crease, Polish, Paint (and the PaintBlur swap, which reads Paint's own
curve object) and the Rake's tines weigh each vertex by a profile curve
(`src/sculpt/bridge/profile.ts`), recorded per brush in
`brush.params.curve`:

```
preset       the preset id the points are exactly, or null once edited
points       [[t, v], ...]: 2 to 16 control points, t from the dab centre (0)
             to its edge (1), sorted, the first at t = 0 and the last at 1,
             v the weight there, all in [0, 1]
exactKernel  true when the preset's closed form stands in for the table
table        256 weights, table[i] = curve(i / 255)
```

The curve between the points is a monotone cubic (Fritsch-Carlson): Hermite
segments whose tangents are the average of the neighbouring secants (0 where
they differ in sign, and at the ends the end secant), scaled back where
`alpha^2 + beta^2 > 9` so that no segment overshoots its two points. A brush
loop reads the table: `t` clamped to [0, 1], `x = t * 255`, `i = floor(x)`,
`table[i] + (table[i + 1] - table[i]) * (x - i)`.

While a curve's points are exactly a preset's that carries a closed form
(`exactKernel`), the loop evaluates that form instead, and `table` holds it
baked. Every default preset is one, and each is the falloff the brush had
before the curves, operation for operation, which is why the default
brushes' outputs did not move by a single bit when the curves came in
(`--verify --outputs --tol=0` against a recording from before):

| brush | default preset | closed form, `q(d) = 3d^4 - 4d^3 + 1` |
| --- | --- | --- |
| ClayStripsBrush | `plateau` | `d <= 0.8 ? 1 : q((d - 0.8) / (1 - 0.8))` |
| CreaseBrush | `sharp` | `pow(q(d), 12)` (the crest; the pinch keeps `q(d)`) |
| PolishBrush | `default` | `d <= 0.35 ? 1 : q((d - 0.35) / (1 - 0.35))` |
| PaintBrush, PaintBlurBrush | `default` | `pow(1 - d, 2 * (1 - 0.75))` |
| RakeBrush (tine profile) | `round` (Coarse) | `sqrt(1 - t^2)` |

Every weight is still multiplied by the mask (`materials[i*3+2]`), the
crease's crest included: before, the mask sat inside the crest's power,
`pow(q * mask, 12)`; it is outside now, `curve(d) * mask`, the same at the
fixtures' mask of 1.

## The tine rake's dab

The rake (`RakeBrush`) lays `tines` tines across the brush, perpendicular
to the stroke, and carves a groove under each. Each dab's record holds:

```
tines, width, depth, plateau, taper the knobs as the dab used them
invert         the effective direction (Invert, flipped by _negative)
pressureTerm   the depth's pressure term (the clay layer's: pressureLayer)
depthLocal     depth * radiusLocal * pressureTerm, local units
across         the unit axis the tines are laid along (tangent, across the stroke)
along          the unit stroke direction (along = across x areaNormal)
directionFrom  'press' (first dab: from the press point), 'previous-dab',
               'previous-stroke' (too short to point: the last axis kept) or
               'fallback' (any tangent, the brush's very first stroke)
areaNormal     the plane's normal, fitted to the stroke-start positions
areaCenter     the plane's point: the mask-weighted mean of the front
               vertices' stroke-start positions
```

The frame: `n0` is the engine's area normal of the front vertices; the
direction is the intersection minus the previous dab's (the press point for
the first dab of a stroke), made tangent to `n0`; `across0 = n0 x along0`.
The plane's point is `areaCenter` above. Its normal is `n0` corrected by a
least-squares fit of the stroke-start positions' height over `n0` against
their `across0` and `along0` coordinates (mask-weighted sums
`Sxx, Sxy, Syy, Sxz, Syz`; `a, b` solve the 2x2 system;
`areaNormal = normalize(n0 - a * across0 - b * along0)`), and `across`
is `across0` made tangent to it, `along = across x areaNormal`.

Per vertex in `picked` (positions `p` are the proxy, the stroke-start
positions; `v` the current ones; `r` = radiusLocal; `c` = intersection):

```
dist = |p - c| / r;  skip if dist >= 1
u = (p - c) . across / r;  w = (p - c) . along / r
k = clamp(floor((u + 1) * tines / 2), 0, tines - 1)
centre = (k + 0.5) / tines * 2 - 1
t = |u - centre| / (width / tines)
prof = t < 1 ? tineProfile(t) : 0
alongFall = q(min(1, |w| / sqrt(max(1e-12, 1 - u^2))))
rate = min(1, alongFall * min(1, intensity) * mask);  skip if rate <= 0
s = invert ? -1 : 1
h0 = s * (p - areaCenter) . areaNormal      stroke-start height
h  = s * (v - areaCenter) . areaNormal      current height
base = h0 > 0 ? h0 * (1 - plateau) : h0
groove = -depthLocal * prof * (1 - taper * |centre|)
target = base + (groove - base) * prof
if h > target: v += areaNormal * s * (target - h) * rate
```

So a groove converges on its depth rather than piling up dab on dab, the
surface only ever moves inward (outward with Invert), and between the tines
a ridge standing proud of the plane comes down to `1 - plateau` of its height (Plateau, the rake's knob: 0
cuts grooves only, 1 levels the ridges onto the plane).
The rake keeps `_accumulate = false` and runs `updateProxy` on every dab
itself.

## JSON layout

```
format      how to read the arrays (also below)
meta        webCommit, date (that commit's), webDirty, runtime, engine
            (vendor version, bridgeConstants, appInstall notes), pressures,
            brushes: {name: {toolSlot, params, dynamics}}
mesh        key, construction, nbVertices, nbFaces, matrix, scale, bounds
brush       name, className, source, toolIndex, params, dynamics, radius,
            entryPoint; params.curve for the brushes on a profile curve
camera      the orthographic camera
input       positions, faces, normals; colors and materials for Paint,
            PaintBlur and Masking, mask for Masking; elsewhere
            materialsUniform, the one [roughness, metalness, mask] triple
            every vertex has
press, moves, dabs
output      positions, normals; colors, materials, mask where written
```

`index.json` lists the files and holds the meta with every brush's
parameters.

- Positions, normals, colours and materials are the engine's Float32Array
  values as JSON numbers, each the exact float32 value; nothing is rounded.
- `faces`: four indices per face. A quad is `[a, b, c, d]`, a triangle
  `[a, b, c, TRI_INDEX]` with `TRI_INDEX = 4294967295`.
- `materials` are `[roughness, metalness, mask]` per vertex; mask 1 is
  unmasked. Every fixture starts unmasked and two-toned (left of the local
  centre `[0.8, 0.3, 0.2]`, right `[0.2, 0.4, 0.9]`).

## Notes for a port

- The engine computes in doubles and stores into Float32Arrays: every write to
  positions, normals, colours or materials rounds to float32. Compute in f64
  and store f32 to match bit for bit; computing in f32 drifts by about 1e-7.
- Summation order matters at that level. The area normal and centre (Clay,
  Flatten, Polish) sum the front vertices in `picked` order; smoothing and
  vertex normals sum rings in the engine's ring order (built from the faces
  at mesh init). Use the recorded order where it is given.
- Normals are not unit length. A face normal is the unnormalised cross
  product (a quad's is the sum of its two triangles'), and a vertex normal is
  the plain mean of its ring's face normals. After each dab the engine
  updates the face and vertex normals of what it touched, and the next dab
  reads them (front test, area normal, picked normal, Polish's gate).
- Proxy positions: Inflate, Crease and the Rake (and Clay with accumulate
  off) read `vProxy`, the position of each vertex when the stroke first
  touched it.
- VolumetricMove is not cumulative: each update puts the picked vertices back
  to their press positions and applies the latest `moveDir`.
- Drag stamps from the previous pointer position, one event behind.
- Flatten and Polish on the flat plane, and Polish on the cube's flat face,
  move nothing: a correct port moves nothing there too.

## Re-recording

The fixtures describe the engine at `meta.webCommit`. Re-record them whenever
a brush changes; `--verify` against the old files shows what moved. The
clay brush and the rake have their own constants (`CLAY_*`, `RAKE_*` in
`meta.engine.bridgeConstants`): clay is spacing 0.1, the Plateau curve and a
pressure-driven layer of 0.1; the rake is spacing 0.06, strength 0.6 and the
Coarse preset (4 Round tines, width 0.7, depth 0.1, Plateau 0.5, no
taper). Retuning one re-records only its own fixtures.

October 2026: the brushes moved onto profile curves and the stencil rake
became the tine rake. Clay, Crease, Polish, Paint and PaintBlur recorded the
same outputs bit for bit (their parameter records changed: `plateau` and
`profile` gave way to `curve`); the Rake's files are a new brush, and
`alpha-rake06.json` is gone with the stencils.
