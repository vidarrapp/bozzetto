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
ClayStripsBrush, CreaseBrush, PolishBrush, VolumetricMove, StableSmooth
(on its default Average mode), StableSmooth-surface (the same tool in its
Surface mode, below), RakeBrush, FlattenBrush, PaintBrush and PaintBlurBrush, and the vendored
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
preset       the preset id the anchors are exactly, or null once edited
anchors      [{t, v, in: [t, v], out: [t, v], corner}, ...]: 2 to 8 anchors,
             t from the dab centre (0) to its edge (1), sorted, the first at
             t = 0 and the last at 1, v the weight there, both in [0, 1];
             in and out the handles as absolute plot points (the first
             anchor has no in, the last no out); corner present (true) only
             on a corner anchor. This is the scene file's curvesRev 2 form.
exactKernel  true when the preset's closed form stands in for the table
table        256 weights, table[i] = curve(i / 255)
```

Between two anchors A and B the curve is the cubic Bezier with control
points A, A.out, B.in, B: `x(s)` from the t's and `y(s)` from the v's,
`s` in [0, 1]. Every handle's t lies within its segment
(`A.t <= A.out.t <= B.t`, `A.t <= B.in.t <= B.t`), which keeps `x(s)`
non-decreasing, so the curve is a function of t. The weight at t is
`clamp(y(s), 0, 1)` where `x(s) = t`, solved per segment by Newton from
`s = (t - A.t) / (B.t - A.t)`, keeping the bracket and bisecting when a
step leaves it (to `|x(s) - t| < 1e-14`). A handle's v may leave [0, 1]
(to -0.5 .. 1.5); the weight never does. A brush loop reads the table: `t`
clamped to [0, 1], `x = t * 255`, `i = floor(x)`,
`table[i] + (table[i + 1] - table[i]) * (x - i)`.

The fixtures recorded before the Bezier anchors (curvesRev 1, one day in
October 2026) held `points` instead, [t, v] pairs read through a monotone
cubic; the brushes' outputs are the same in both (below).

While a curve's anchors are exactly a preset's that carries a closed form
(`exactKernel`), the loop evaluates that form instead, and `table` holds it
baked: the kernel is the truth, and the preset's anchors are how the editor
draws it and where an edit starts. Every default preset is one, and each is
the falloff the brush had before the curves, operation for operation, which
is why the default brushes' outputs did not move by a single bit when the
curves came in, nor when the curves became Bezier anchors
(`--verify --outputs --tol=0` against a recording from before each):

| brush | default preset | closed form, `q(d) = 3d^4 - 4d^3 + 1` |
| --- | --- | --- |
| ClayStripsBrush | `plateau` | `d <= 0.8 ? 1 : q((d - 0.8) / (1 - 0.8))` |
| CreaseBrush | `sharp` | `pow(q(d), 12)` (the crest; the pinch keeps `q(d)`) |
| PolishBrush | `default` | `d <= 0.35 ? 1 : q((d - 0.35) / (1 - 0.35))` |
| PaintBrush, PaintBlurBrush | `default` | `pow(1 - d, 2 * (1 - 0.75))` |
| RakeBrush (tine profile) | `round` (Coarse) | `sqrt(1 - t^2)` |

The presets' anchors are fitted to their kernels (two to four anchors,
minimising the largest difference over t, handles rounded to four places).
The largest difference between a preset's Bezier and its kernel, over
200001 evenly spaced t:

| tool | preset | anchors | max difference |
| --- | --- | --- | --- |
| Clay | Plateau | 4 | 2.9e-4 |
| Clay | Soft | 3 | 1.3e-4 |
| Clay | Flat | 2 | exact |
| Clay | Round | 2 | 1.9e-4 |
| Crease | Sharp | 4 | 1.8e-3 |
| Crease | Medium | 4 | 5.0e-4 |
| Crease | Soft | 3 | 1.3e-4 |
| Polish | Default | 4 | 2.2e-4 |
| Polish | Wide | 4 | 1.6e-4 |
| Polish | Narrow | 3 | 1.1e-3 |
| Paint | Hard | 3 | 9.3e-3 to t = 0.999; 0.17 in the last thousandth, where `(1 - d)^0.1` falls from 0.5 to 0 |
| Paint | Default | 2 | 2.1e-5 |
| Paint | Soft | 2 | exact |
| Paint | Airbrush | 2 | 1.9e-5 |
| Rake tine | Round | 2 | 1.9e-4 |
| Rake tine | V | 2 | exact |
| Rake tine | Flat | 4 | 3.2e-4 |
| Rake tine | Soft | 3 | 1.3e-4 |

Only an edited curve is read from its table, so these differences never
reach a brush on a preset.

Every weight is still multiplied by the mask (`materials[i*3+2]`), the
crease's crest included: before, the mask sat inside the crest's power,
`pow(q * mask, 12)`; it is outside now, `curve(d) * mask`, the same at the
fixtures' mask of 1.

## The tine rake's dab

The rake (`RakeBrush`) lays `tines` tines across the brush, perpendicular
to the stroke, and cuts a groove under each. Since 2026-10-24 it is a
standard brush, not a clay one: each dab displaces along the normal and the
dabs add up (a second pass cuts deeper), where it used to move each vertex
toward a target height over a plane. Each dab's record holds:

```
tines, width, depth, scrape, taper the knobs as the dab used them
invert         the effective direction (Invert, flipped by _negative)
pressureTerm   the depth's pressure term (the clay layer's: pressureLayer)
strengthTerm   min(1, _intensity) / RAKE_STRENGTH (1 at the default 0.6)
depthLocal     depth * radiusLocal * pressureTerm * strengthTerm, local
               units: what one stroke cuts
stepLocal      |intersection - previous intersection| (the press point for
               the first dab of a stroke), held to radiusLocal
spacingFactor  stepLocal / (RAKE_ALONG_INTEGRAL * radiusLocal), the
               dab's share of a stroke before the chord (RAKE_ALONG_INTEGRAL
               = 1.2, the quartic's integral over [-1, 1])
across         the unit axis the tines are laid along (tangent, across the stroke)
along          the unit stroke direction (along = across x areaNormal)
directionFrom  'press' (first dab: from the press point), 'previous-dab',
               'previous-stroke' (too short to point: the last axis kept) or
               'fallback' (any tangent, the brush's very first stroke)
areaNormal     the plane's normal, fitted to the form (below)
areaCenter     the plane's point: the mask-weighted mean of the front
               vertices' form positions
```

The form: a vertex's current position minus the cut this stroke has made
there (`cut`, the sum of the cut moves below, kept per vertex for the
stroke; it starts at 0 on every vertex at the press, and an entry no longer
counts once the vertex is not where the rake left it, as after dynamic
topology). The frame: `n0` is the engine's area normal of the front
vertices; the direction is the intersection minus the previous dab's (the
press point for the first dab of a stroke), made tangent to `n0`;
`across0 = n0 x along0`. The plane's point is `areaCenter` above. Its
normal is `n0` corrected by a least-squares fit of the form positions'
height over `n0` against their `across0` and `along0` coordinates
(mask-weighted sums `Sxx, Sxy, Syy, Sxz, Syz`; `a, b` solve the 2x2 system;
`areaNormal = normalize(n0 - a * across0 - b * along0)`), and `across` is
`across0` made tangent to it, `along = across x areaNormal`. The cuts go
along `areaNormal` (the engine's area normal over the picked one: one
face's normal tilts with the flank of a groove just cut; the fitted one is
the form's at the dab, so on a curved form the tines cut straight in).

Per vertex in `picked` (positions `p` are what the distances read: the
current positions while `_accumulate` is on, the default, and the
stroke-start proxy when it is off, as vendor `Brush.brush`; `v` the current
ones; `r` = radiusLocal; `c` = intersection; `n` = areaNormal):

```
dist = |p - c| / r;  skip if dist >= 1 or mask <= 0
// 1. scrape: the form toward the plane, the cut riding along
if scrape > 0:
  rate = min(1, scrape * q(dist) * intensity * mask)
  v -= n * ((v - cut - areaCenter) . n) * rate
// 2. cut
u = (p - c) . across / r;  w = (p - c) . along / r
k = clamp(floor((u + 1) * tines / 2), 0, tines - 1)
centre = (k + 0.5) / tines * 2 - 1
t = |u - centre| / (width / tines)
prof = t < 1 ? tineProfile(t) : 0
chord = sqrt(max(0, 1 - u^2))
alongFall = |w| / max(1e-6, chord) >= 1 ? 0 : q(|w| / max(1e-6, chord))
s = invert ? -1 : 1
amount = -s * depthLocal * prof * (1 - taper * |centre|) * alongFall * mask
         * spacingFactor / max(RAKE_MIN_CHORD, chord)
v += n * amount;  cut += n * amount
```

`intensity` is the dab's (`_intensity * pressureIntensity`). The spacing
factor: a vertex's along falloff summed over dabs `stepLocal` apart is
about `chord * r / stepLocal * 1.2`, so `spacingFactor / chord` makes one
stroke add up to `depthLocal` on every tine, whatever the spacing or the
stroke speed (RAKE_MIN_CHORD = 0.2 holds the factor at the disc's rim).
Scrape 0 leaves the form as it was between the grooves; 1 planes the
footprint onto the plane and cuts the grooves into the flat. A scene's
saved `plateau`, from before Scrape, is read as the scrape.

## Smooth's Surface mode

`StableSmooth-surface.*` is the Smooth tool (the SMOOTH slot) after
`setSmooth({ mode: 'surface' })`, the default Relax 0.25; `brush.params`
records `smoothMode` and `relax` (and `_accumulate`, true), and each dab
`surface`: its counts (`vertices`, `gathered`, `quadric`, `plane`,
`normalFallback`, `meanNeighbours`). The constants are `SURFACE_*` in
`meta.engine.bridgeConstants` (from `src/sculpt/bridge/surfaceSmooth.ts`).
`StableSmooth.*` (Average) did not change by a bit when the mode came in.

Per dab (`picked` the dab's vertices, after `_culling`; `p` the fit's
positions, the current ones, or with `_accumulate` false the stroke-start
proxy for vertices this stroke has touched; `x` the current ones; all in
doubles, written to float32 at the end of each pass):

```
lbar_i    mean of |p_j - p_i| over the 1-ring (ring order); the dab's mean
          stands in for a vertex with none
gathered  intersectSphere(c, (r + m)^2) faces -> vertices, kept when
          |x - c| < r + m, m = min(r, SURFACE_K * max(lbar) * 1.3^2)
grid      cubic cells of SURFACE_K * mean(lbar) over the gathered p
          (grown 1.5x while over 1048576 cells), counting-sorted
per vertex i, s = min(1, intensity) * mask_i * alpha(x_i); skip if s <= 0
  n_i     the unit vertex normal
  N       gathered points within r_i = SURFACE_K * lbar_i of p_i, not i,
          with normal . n_i > 0; while |N| < 12, r_i *= 1.3 (twice at most);
          past 30 the 30 nearest (quickselect), h = 1.15 * the farthest,
          else h = r_i; fewer than 3: the vertex stays
  w       x = d^2 / h^2, w = (1 - x)(1 - 0.488 x)  (the Gaussian
          (e^-x - e^-1) / (1 - e^-1) within 0.009)
  plane   weighted centroid m and covariance of (p - p_i) / h; the
          normal is the smallest eigenvector (closed form), turned to
          agree with n_i; if l0 > 0.5 l1 (or undefined), n_i instead
  frame   t1 = (1,0,0) made tangent if |n.x| < 0.9 else (0,1,0); t2 = n x t1
  fit     if |N| >= 6 and l1 / l2 >= 0.05: weighted least squares of
          h(u,v) = a u^2 + b uv + c v^2 + d u + e v + f over the points'
          (u, v, height) about m, 6x6 Cholesky; refused (the plane, h = 0)
          when a pivot is not positive or max/min pivot > 1e8
  move    (u, v, height) of x_i about m in units of h;
          delta = clamp(h(u, v) - height, -1, 1) * h * s; x_i += n * delta
relax (relax > 0, not on a boundary): c_i = the area-weighted centroid of
  the 1-ring faces' triangles (a quad as (a,b,c), (a,c,d)) on the moved
  positions; x_i += relax * s * (c_i - x_i) with its n component removed
```

Both passes compute every vertex from the positions before the pass, then
write them all.

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
- Proxy positions: Inflate and Crease (and Clay and the Rake with
  accumulate off) read `vProxy`, the position of each vertex when the
  stroke first touched it.
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
Coarse preset (4 Round tines, width 0.7, depth 0.1, Scrape 0.25, no
taper), with RAKE_ALONG_INTEGRAL and RAKE_MIN_CHORD for its spacing
factor. Retuning one re-records only its own fixtures.

October 2026: the brushes moved onto profile curves and the stencil rake
became the tine rake. Clay, Crease, Polish, Paint and PaintBlur recorded the
same outputs bit for bit (their parameter records changed: `plateau` and
`profile` gave way to `curve`); the Rake's files are a new brush, and
`alpha-rake06.json` is gone with the stencils.

October 2026, the day after: the profile curves became cubic Bezier
anchors with handles (owner feedback: too many points to edit). Every
brush recorded the same outputs bit for bit (`--verify --outputs --tol=0`
against a recording made just before); `brush.params.curve` holds
`anchors` where it held `points`.

2026-10-24: the rake became a standard brush (owner feedback: Invert only
raised ridges where the surface lay below the fitted plane), and Scrape
replaced Plateau. Only the Rake's files changed: every other brush recorded
the same outputs and dabs bit for bit (`--verify --outputs --tol=0` against
a recording made just before; their meta changed with the rake's new
constants).

2026-10-27: Smooth got a Surface mode (owner call, 2026-10-24: an
option, Average the default). `StableSmooth-surface.*` are new files; every
other brush, StableSmooth (Average) included, recorded the same outputs and
dabs bit for bit (`--verify --outputs --tol=0` against a recording made
just before, at f5159c6); StableSmooth's parameter record gained
`smoothMode`, `relax` and `_accumulate`, and the meta the `SURFACE_*`
constants.
