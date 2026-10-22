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
node scripts/parity-fixtures.mjs out --only=Paint,Drag --tol=1e-9
```

It needs `npm ci` and nothing else: no build, no browser. The real sources
(`SculptSession` with its tool table, the bridge brushes in
`src/sculpt/bridge/tools.ts`, the vendored SculptGL tools and `Picking`) are
bundled with esbuild (installed with Vite) and run under Node. The vendored
core is render-less, so the only browser pieces are stubbed: a no-op
`ResizeObserver`, and `fetch`, `createImageBitmap` and a canvas that serve
and decode the brush stencils from `public/assets/alphas` (8-bit greyscale
PNGs, which decode to the same bytes in a browser). What the app sets on the
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
| `sphere` | `addSphere()`, the default sphere, one level down from the top | 6146 | 6144 quads |
| `plane` | `addPrimitive('plane')`, level 0: triangles, with a boundary | 625 | 1152 triangles |

Brushes, each with the defaults the app installs: the bridge brushes
ClayStripsBrush, CreaseBrush, PolishBrush, VolumetricMove, StableSmooth,
RakeBrush and PaintBlurBrush, and the vendored Flatten, Inflate, Pinch, Drag,
Paint and Masking. Symmetry is off and dynamic topology is off. Every brush
has the same world radius on a mesh (0.3 of its world extent), as world-scale
sizing starts them; the pixel radius that gives it on the fixed camera is in
`brush.radius`.

The stroke: a press and five pointer moves. For the surface brushes the
pointer follows a fixed path across the mesh (over the cube's right edge,
onto the plane's right boundary), one dab per move. Move and Drag pull off the
surface instead. Pressure is 0.5 at the press and 0.5, 0.65, 0.8, 0.4, 0.5 on
the moves, which matters for the brushes whose dynamics use it.

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
- `pressure`, and the factors it gave (`pressureIntensity`,
  `pressureRadius`); `intensity` is the tool's strength times the factor.
- Drag: `dragDir`. VolumetricMove: `center` (the press), `moveDir`.
- Rake: `alpha`, the stencil frame after the dab (`origin`, `side`,
  `lookAt`). The stencil itself is in `alpha-rake06.json`.

`press` is the pointer-down; it is not a dab, except for Drag, whose first
dab is at the press.

## JSON layout

```
format      how to read the arrays (also below)
meta        webCommit, date (that commit's), webDirty, runtime, engine
            (vendor version, bridgeConstants, appInstall notes), pressures,
            brushes: {name: {toolSlot, params, dynamics}}
mesh        key, construction, nbVertices, nbFaces, matrix, scale, bounds
brush       name, className, source, toolIndex, params, dynamics, radius,
            entryPoint, alpha (Rake)
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
- Proxy positions: Inflate and Crease (and Clay with accumulate off) read
  `vProxy`, the position of each vertex when the stroke first touched it.
- VolumetricMove is not cumulative: each update puts the picked vertices back
  to their press positions and applies the latest `moveDir`.
- Drag stamps from the previous pointer position, one event behind.
- Flatten and Polish on the flat plane, and Polish on the cube's flat face,
  move nothing: a correct port moves nothing there too.

## Re-recording

The fixtures describe the engine at `meta.webCommit`. Re-record them whenever
a brush changes. The clay brush's tuning (`STRIPS_PLATEAU`, `STRIPS_LAYER`)
is about to change, so the ClayStripsBrush fixtures, and RakeBrush's, which
is the clay brush through a stencil, must be re-recorded after that.
`--verify` against the old files shows what moved.
