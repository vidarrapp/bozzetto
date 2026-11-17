# Tool graphs: a blueprint node system that compiles to Bozzetto's brush loops

# Tool graphs for Bozzetto

This is a read-only design, dated 2026-11-14. Paths are relative to /home/user/bozzetto. Nothing was edited, built or run.

## 1. Summary

- **A tool is a graph that describes one dab.** For grab tools it describes one pointer move. Around the graph sits a small header: how dabs are laid, which settings appear in the Tool panel, what Shift, Ctrl and Alt do, the presets, the icon and the name.
- **The runtime keeps the parts every tool shares.** These are the parts that make strokes safe and fast today: pointer routing, the modifier stand-ins, picking, the mirrored side, undo, the normal and octree update, and the GPU upload. A graph cannot break undo or symmetry because it never touches them. It only says what it writes.
- **Every value has a rate.** It runs either kept across strokes, once per stroke, once per pointer move, once per dab (on each side), or once per vertex (a *field*).
  - A field becomes a per-dab value only through a **Reduce** node.
  - A value reaches the next dab only through a **Remember** node.
  - These two rules let the compiler turn a graph into the same few tight loops the hand-written brushes are made of.
- **What the compiler does:**
  - It fuses every per-vertex node between two reductions into one loop over the typed arrays.
  - It splits vectors into plain number locals and lifts per-dab maths out of the loop.
  - It reads settings as uniforms, so a slider change never recompiles.
  - For the built-in tools the output is today's loop, line for line, and the existing parity fixtures prove it (`scripts/parity-fixtures.mjs --verify --outputs`).
- **Where the compiler runs:**
  - Shipped tools compile at build time to TypeScript.
  - The site's planned Content-Security-Policy has no `'unsafe-eval'` (public/_headers:42). So a tool edited on the iPad cannot be turned into JavaScript at run time.
  - It compiles to WebAssembly instead, which the same policy allows (`'wasm-unsafe-eval'`).
  - A reference interpreter runs the same intermediate form for tests and as a fallback.
- **About 75 primitive nodes and 8 native nodes cover every current tool** (see the coverage table).
  - Native nodes hold the parts that are algorithms rather than formulas: dynamic topology, the connected pick, the neighbour average, the Surface smooth fit, the Rake's level reference, the loop-mask cut, the mirror match and the poly-group region.
  - They have typed ports like any other node but cannot be opened.
- **Editing on the iPad:**
  - Most edits happen in a **Recipe view**: one card per stage, each swapped from a short list.
  - A **Try sphere** sits beside it.
  - The full graph opens underneath for Pencil wiring, with probes that show any wire's value live on the Try mesh.
- **Saving:** tools are JSON files (`.bztool`). They are kept in the device's tool library in IndexedDB, can be exported, and are embedded in any `.bozz` that uses them. Each file has a format version and each node type has its own version.

## 2. What a graph describes and what the runtime keeps

| Runtime keeps (never a node) | Where it is today |
|---|---|
| Pointer routing, pen over finger, two-finger cancel | InputShell.ts:1283-1352 |
| Shift/Ctrl stand-ins, restored at release | InputShell.ts:1441-1464, 2237-2247 |
| Polarity from Alt, the Negative latch and arm | InputShell.ts:1480-1493 |
| Hit test, active mesh, hidden poly groups excluded | Picking.js:157-307 |
| One undo state per stroke, first-touch snapshots, cleanNoop | SculptBase.js:57; StateGeometry.js:38-57; StateManager.js:132-138 |
| Rest snapshot (updateProxy) before the undo push | SculptBase.js:276-293 |
| Mirrored side: mirrored ray, radius copied from the main side, run after the main dab | SculptBase.js:166-195 |
| Normals, octree, dirty ranges, GPU upload; balanceOctree at the end | Mesh.js:388-407; GeometrySync.ts:292-420 |
| World-scale sizing | worldScale.ts |
| Cursor drawing | BrushCursor.ts |

**How it plugs in.** One adapter class, `GraphTool extends SculptBase`, takes a slot in SculptManager's tool table like any vendor tool.
- Its `stroke(picking)` fills a dab context and calls the tool's compiled kernel.
- Its `startSculpt` and `sculptStroke` come from the graph's Stroke node.
- `canBeContinuous` follows from the sampler: Each move is not continuous.
- The built-in tools move onto it one at a time, each behind the parity fixtures, so no tool ever runs on two engines at once.

Runtime loop:

```
press    stand-in for Shift/Ctrl, polarity; hit test; open the undo state the graph's writes need
         (geometry, colour+material, or dynamic); per side: stroke-rate nodes, memory reset
move     pen sample -> move-rate nodes (pressure, pointer delta)
         Stroke node -> dab points; for each:
           main    ray -> Hit -> Brush radius -> Pick -> Refine topology -> rest snapshot -> pushVertices
                   -> dab-rate nodes and vertex passes -> commit (updateGeometry, or colour/mask update)
           mirror  mirrored ray on the surface the main dab left; radius copied; same graph, Side = mirror
           both sides miss -> stop sampling this move
         updateRender once
release  balanceOctree; cleanNoop; restore the stand-in and polarity
```

## 3. Data: types and rates

| Type | What it is | Port shape |
|---|---|---|
| Number | f64 | circle |
| Whole number | int | small circle |
| Yes/no | bool; a yes/no per vertex is a selection | half circle |
| Vector | 3D point or direction, mesh-local | square |
| Colour | linear RGB | square with a notch |
| Plane | point and unit normal | diamond |
| Frame | origin, normal, across, along | diamond with a dot |
| Quadric | 6 coefficients over a frame (a + bx + cy + dx² + exy + fy²) | hexagon |
| Curve | a ProfileCurve with its preset list | triangle |
| Region | the dab's vertex ids, in pick order | bar |
| Ray / Screen point | picking inputs | arrow |

| Rate | Runs | Glyph fill | Wire |
|---|---|---|---|
| Kept | survives strokes (Rake's previous across) | ring | dotted |
| Stroke | once at the press, per side | ring with a dot | dotted |
| Move | once per pointer event | hollow | thin |
| Dab | once per dab, per side | hollow | thin |
| Vertex (field) | once per vertex of the region | filled | thick |

**Rules.** They are checked while editing, and an error shows in plain words on the node.
1. A node runs at the fastest rate among its inputs. A slower value feeds faster nodes as it is.
2. A field turns into a per-dab value only through a Reduce node.
3. A value crosses to a later dab only through Remember, or to a later stroke only through Remember with the lifetime Kept. A graph has no other cycles.
4. One Pick per graph. Its centre and radius cannot depend on the region, because they are worked out before it.
5. Neighbour average reads a mesh attribute (Position, Colour, Mask or a vertex memory), never a computed field. The neighbours lie outside the region, and only attributes exist there.
6. Within one dab, every read of an attribute sees the dab's input. This is the Jacobi order the vendor loops use. An attribute the dab writes cannot be read again in that dab ("read it in the next dab").
7. Writes come last. A dab writes positions, colour or mask: one kind, matching the three undo state kinds.

## 4. The node set

Type shorthand: n number, i whole number, b yes/no, v vector, c colour. The rate follows a dot: ·k kept, ·s stroke, ·m move, ·d dab, ·v vertex. Display names are plain sentence case; the ids are what the files store.

### A. Stroke (exactly one per tool)

| id | Name | Ports | Notes |
|---|---|---|---|
| stroke.spaced | Spaced dabs | spacing n·k, radius px n·d (before pressure) → dab point | SculptBase.sculptStroke: floor(dist/(spacing·r·dpr)) dabs, the last at the pointer, none at the press. Options for Drag's legacy sampling: from the previous position, a dab at the press, no pixel ratio, mirror picked before the main dab. |
| stroke.eachMove | Each move | → dab point = pointer | One dab per pointer event, no spacing (Move, Twist, LocalScale). Option: hit at the press only. |
| stroke.dragLine | Drag line | → start px·s, end px·m | Preview each frame, apply on release, nothing on cancel (loop mask). |
| stroke.tap | Tap | → point | A press that stays within 6 px (Ctrl+click group mask). |
| stroke.once | Once | | Actions such as Fill, Invert mask and Clear mask. |

### B. Pen, pointer and view

| id | Name | Ports | Notes |
|---|---|---|---|
| in.pen | Pen | → pressure n·m, is pen b·m, tilt, azimuth, altitude n·m | Mouse and finger read 0.5 and not a pen (InputShell.ts:557-575). Tilt is new: no current tool reads it. |
| in.pressure | Pressure response | pressure, is pen, amount n·k, curve (Linear/Soft/Firm)·k → swing n·m, layer n·m | swing = 1 + a(2c(p)−1); layer = pen ? 1 + a(c(p)−1) : 1 (dynamics.ts:120-146). |
| in.pointer | Pointer | → now, previous, press, delta (screen px) | |
| in.view | View | → eye direction v·d, ray at a screen point | Already mirrored on the mirror side. |
| in.negative | Negative | → b·s; option: starts negative | The runtime resolves Alt, the latch and the arm. A tool without this node has no Negative, and the toolbar button greys out. |
| in.side | Side | → is mirror b·d, sign n·d | |
| in.mesh | Mesh | → scale n·s, symmetry plane | |
| in.setting | Setting | → any type ·k | Shown in the Tool panel (section 7). |

### C. Hit, radius and region

| id | Name | Ports | Notes |
|---|---|---|---|
| pick.hit | Hit | screen point (or "at the press") → point v, picked normal v, face, depth | Picked normal = inverse-distance mix of the hit face's corner normals (Picking.js:418-448). A miss ends that side's dab. |
| pick.radius | Brush radius | size (px or world, role size), size swing → local radius n·d, radius px | Picking.computeWorldRadius2 plus world scale. The mirror side copies the main side's. |
| pick.sphere | Pick sphere | centre v·d, radius → region | Euclidean octree pick, hidden groups always out. Rate: each dab or at the press. |
| pick.connected | Pick connected | hit, radius → region | Native. Ring flood inside the ball (Move). |
| pick.whole | Whole mesh | → region; option: include hidden | For actions. Fill ignores hidden groups today. |
| pick.refine | Refine topology | region → region | Native. Dynamic topology inside the radius (SculptBase.js:370-418). |

### D. Vertex attributes (fields over the region)

| id | Name | Notes |
|---|---|---|
| attr.position | Position | As the dab found it. |
| attr.rest | Rest position | Where this stroke first touched the vertex (the vendor proxy; the live position on dynamic meshes). Reading it makes the runtime take the snapshot before the undo push. |
| attr.press | Press position | The region's positions at the press (Move's vProxy). Needs a region picked at the press. |
| attr.normal | Normal | Unit, from the last update. |
| attr.mask | Mask | 1 free, 0 masked. |
| attr.colour | Colour | |
| attr.neighbourAverage | Neighbour average | Native. Takes an attribute and gives the one-ring mean with the vendor's border rule (laplacianSmooth, SculptBase.js:296-368). It is held in a Float32 scratch, as the vendor's is, so results stay bit-exact. |

### E. Maths (any rate)

- **Number:** Add, Subtract, Multiply, Divide, Negate, Min, Max, Clamp, Abs, Sqrt, Power, Floor, Select (if), Compare (< ≤ > ≥ =), And, Or, Not, Constant.
- **Vector:** Add, Subtract, Scale, Dot, Cross, Length, Distance, Normalise (also gives an ok yes/no), Part along, Part across (v − n(v·n)), Mix, Make, Split, Mirror point (across the mesh's symmetry plane), Rotate about axis, Closest point on ray (Geometry.vertexOnLine).
- **Colour:** Mix, From sRGB.

### F. Falloff

| id | Name | Ports | Notes |
|---|---|---|---|
| fall.distance | Normalised distance | from v·v, centre v·d, radius → d n·v | sqrt(dx²+dy²+dz²)/r, in that order. |
| fall.quartic | Quartic | d → n | Written as the vendor writes it: d2 = d·d; 3·d2·d2 − 4·d2·d + 1. |
| fall.curve | Profile curve | t → n·v; also line integral n·d, preset | ProfileCurve.sample: the exact kernel while on a preset, the 256-entry table after an edit. Presets: Clay, Crease, Polish, Paint, Tine (profile.ts:820-862). Shown in the panel as the curve editor. |
| fall.tineSlot | Tine slot | u n·v, tines i·k, width n·k → slot centre, t | t = abs(u − centre)/(width/N). |
| fall.chord | Disc chord | u → sqrt(max(0, 1−u²)) | |
| fall.inside | Inside | d → d < 1 | |

### G. Reduce (field to a per-dab value)

Every reduce takes an optional selection ("where") and an optional weight. The sums run in pick order, so a fused loop produces the same sums the separate loops did.

| id | Name | Notes |
|---|---|---|
| red.sum, red.mean, red.count, red.min, red.max | Sum, Mean, Count, Min, Max | |
| red.areaNormal | Area normal (group) | Normalise(Sum(Normal × Mask)) where the vertex faces the camera, plus ok (SculptBase.js:233-252). |
| red.areaCentre | Area centre (group) | Sum(Position × Mask)/Sum(Mask) (SculptBase.js:255-273). |
| red.facesCamera | Faces camera | Normal · eye ≤ 0, as a selection. Replaces the getFrontVertices copy. |
| red.fitPlane | Fit plane (group) | Mean, then least-squares height slopes over a seed frame (formPlane, tools.ts:1184-1226). |
| red.levelReference | Level reference | Native. Quadric fit, then the median of the cell maxima, then a refit (levelSurface, tools.ts:1303-1413). |
| flow.stopDab | Stop dab | If yes, this side's dab ends. Writes never happen on a stopped dab. Each memory write names which stops cancel it (all by default). Option: still finish the mesh update. Clay stops with no update, Polish with no update, and the Rake's form-plane stop finishes the update. |
| flow.switch | Switch | A choice setting picks between subgraphs. Every branch is compiled, so switching never recompiles (Smooth's Average/Surface). |

### H. Frames and stroke maths (per dab)

| id | Name | Notes |
|---|---|---|
| frame.offsetPlane | Offset plane | plane + n × distance |
| frame.make | Make frame | normal and direction → across = n × along, re-tangented; fallback input |
| frame.strokeDirection | Stroke direction (group) | Hit, normal, Remember (previous hit, per side, starts at the press hit), Remember (previous across, Kept), world-axis fallback → along, across, step, came from (Rake, tools.ts:1641-1666) |
| frame.dabStep | Dab step (group) | min(r, distance from this side's previous hit); the previous hit starts at the press (DabSteps, tools.ts:248-270) |
| frame.gripPlane | Grip plane (group) | Polish's banded refit (section 5.5) |
| frame.screenAngle | Screen angle | press, previous and current pointer, dead zone → signed angle; negated on the mirror side (Twist) |
| frame.quadric | Quadric value and slope | at (x, y) over a frame |

### I. Strength

| id | Name | Notes |
|---|---|---|
| str.share | Share of stroke (group) | (max(0,S)·layer/scale)·(step/(I·r)) for Inflate, Crease and Rake |
| str.clayRate | Clay rate (group) | min(cap, ((gain·(S/scale)·(spacing/0.1))/I)/r)·layer |
| str.fraction | Fraction | min(1, x), the cap every fraction tool carries |

### J. Memory

| id | Name | Notes |
|---|---|---|
| mem.remember | Remember | Value in, start value, lifetime (Stroke or Kept), per side (the default) or shared → the previous value. It is read at the start of the dab and written after the commit. |
| mem.vertex | Vertex memory | Up to 4 channels (vector or number) for this stroke, shared by both sides, with one validity flag. Read gives the value and whether it is valid. Write takes a "when" input and records the value with the position the vertex is left at. A vertex that dynamic topology moved or renumbered reads as invalid (StrokeMoves, tools.ts:284-341). |

### K. Write (terminal)

| id | Name | Notes |
|---|---|---|
| out.displace | Displace positions | Ordered terms, each added in turn (v + t1 + t2, as Crease writes it), plus a where. |
| out.setPosition | Set positions | Smooth's mix, Twist's rotation, Surface smooth. |
| out.fromPress | Set from press | Every region vertex goes back to its press position, on both sides, and then each side adds its displacement (Move). |
| out.colour | Write colour | |
| out.mask | Write mask | Clamped to 0..1. |

From these writes the runtime chooses the undo state kind, what to push and which update to run.

### L. Tool outputs

| id | Name | Notes |
|---|---|---|
| out.cursor | Cursor | Ring style (dot or dim) and tint; tines (count, width, taper, across axis from the main side). |
| out.record | Record | Names a dab value for the tests and the parity recorder (lastDab, lastStrengthDab). Compiled out unless recording is on. |

### M. Native nodes

Refine topology, Pick connected, Neighbour average, Surface smooth fit, Level reference, Loop side, Mirror match and Group region (plus Grow region for the mask blur action).
- Each is a pass boundary.
- Each runs in JavaScript between passes and declares a cost class.

### N. Groups

Any selection of nodes can become a group with typed boundary ports. Groups are inlined at compile time, so they cost nothing.
- The built-in groups are read-only. They can be duplicated and opened.
- The built-in groups are Area normal, Area centre, Fit plane, Stroke direction, Dab step, Share of stroke, Clay rate, Grip plane, Tine cut, Stop at depth and Layer cap.
- Every Recipe card is one of these groups.

## 5. How a graph runs and compiles

### 5.1 The stages of one dab
1. Pre-pick: the dab-rate nodes that Pick needs (Brush radius, a moving centre for Drag).
2. Pick and Refine (runtime).
3. Region-dependent passes and the per-dab maths between them.
4. Commit (runtime).

Stroke-rate nodes run after the press pick and move-rate nodes run before the move's dabs. The compiler emits one function for each: `onPress`, `onMove`, `prePick`, `dab`.

### 5.2 Passes
- Every vertex-rate node is given a pass: one more than the latest Reduce result it depends on.
- A Reduce runs in the pass of its inputs. A native node ends a pass.
- Writes run in the last pass.
- A field needed in a later pass is computed again if it is cheap (8 operations or fewer). Otherwise it is stored in a scratch arena of Float64Arrays, sized at stroke start to the largest region.
- Selections become early `continue`s.
- Unused outputs are dropped, so an unwired Faces camera costs nothing.

### 5.3 Lowering rules (these keep parity)
- Vectors split into x, y, z locals: no arrays and no allocation in the loop.
- Settings are one object of fixed shape (a uniform block) read per dab. Moving a slider never recompiles; only structure and choice options do.
- Floating-point arithmetic is never reordered. A built-in graph is wired in the grouping its loop uses:
  - Pinch's `q *= k * mask * alpha` is q × ((k × mask) × alpha).
  - Polish's `anx * distToPlane * frac` is (n × s) × frac.
  - Predicates are emitted exactly as the node defines them (keep if ≤ 0), including what they do with NaN.
- The retired alpha (always 1) is dropped. Multiplying by 1 is exact.
- Curves call `curve.sample(t)` exactly as today, keeping the exact preset kernels.
- No compile and no allocation from pen-down to pen-up. The latency suite already asserts this for builds (tests/e2e/latency.mjs:1-6).
  - Compiling happens when the tool is edited or loaded.
  - A new kernel takes over at the next press.

### 5.4 Example: Standard (clay)

The graph, written out:
```
Spaced dabs(Spacing = 0.1) -> Hit -> Brush radius(Size 50 px, swing of Pressure response(size 0))
Pick sphere -> Refine topology
front = Faces camera
N, ok = Area normal(where front);  Stop dab(not ok, no update)
C0 = Area centre(where front)
C  = C0 + N x Select(Negative, -0.1 r, 0.1 r)
rate = Clay rate(Strength cm, Mesh scale, Spacing, max(1e-3, Profile.integral), r, layer; gain 1.5, cap 0.5)
-- per vertex, where rate > 0 --
h = Dot(Position - C, N);  where h x Select(Negative, -1, 1) <= 0 and Inside(Distance(Position, hit) / r)
Displace( -(N x (Fraction(Profile(d) x rate x Mask) x h)) )
```

The generated code is checked in, and CI regenerates it and requires no diff:
```ts
// src/sculpt/tools/compiled/bz.clay.ts — generated from tools/graphs/bz.clay.bztool (compiler 1). Do not edit.
export function dab(k: DabContext, p: ClayUniforms): DabResult {
  const vAr = k.vAr, nAr = k.nAr, mAr = k.mAr, iv = k.region, n = iv.length;
  const ex = k.eye[0], ey = k.eye[1], ez = k.eye[2];
  // pass 1: Faces camera + Area normal + Area centre, fused (each sum in the same order as before)
  let snx = 0, sny = 0, snz = 0, sx = 0, sy = 0, sz = 0, sm = 0;
  for (let i = 0; i < n; ++i) {
    const ind = iv[i] * 3;
    if (!(nAr[ind] * ex + nAr[ind + 1] * ey + nAr[ind + 2] * ez <= 0.0)) continue;
    const f = mAr[ind + 2];
    snx += nAr[ind] * f; sny += nAr[ind + 1] * f; snz += nAr[ind + 2] * f;
    sm += f; sx += vAr[ind] * f; sy += vAr[ind + 1] * f; sz += vAr[ind + 2] * f;
  }
  let len = Math.sqrt(snx * snx + sny * sny + snz * snz);
  if (len === 0.0) return STOP_NO_UPDATE;
  len = 1.0 / len;
  const nx = snx * len, ny = sny * len, nz = snz * len;
  const r = k.radius;
  const layer = pressureLayer(k.pen, k.pressure, p.pressureStrength, p.strengthCurve); // dynamics.ts:140-146
  const integral = Math.max(1e-3, p.profile.lineIntegral());
  const gain = (1.5 * (Math.max(0, p.strength) / k.scale) * (p.spacing / 0.1)) / integral;
  const rate = Math.min(0.5, gain / r) * layer;
  const off = k.negative ? -(0.1 * r) : 0.1 * r;
  const ax = sx / sm + nx * off, ay = sy / sm + ny * off, az = sz / sm + nz * off;
  if (!(rate > 0)) return COMMIT;
  // pass 2: deform
  const comp = k.negative ? -1.0 : 1.0, cx = k.hit[0], cy = k.hit[1], cz = k.hit[2], curve = p.profile;
  for (let i = 0; i < n; ++i) {
    const ind = iv[i] * 3;
    const vx = vAr[ind], vy = vAr[ind + 1], vz = vAr[ind + 2];
    const h = (vx - ax) * nx + (vy - ay) * ny + (vz - az) * nz;
    if (h * comp > 0.0) continue;
    const dx = vx - cx, dy = vy - cy, dz = vz - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / r;
    if (d >= 1.0) continue;
    const m = Math.min(1, curve.sample(d) * rate * mAr[ind + 2]) * h;
    vAr[ind] -= nx * m; vAr[ind + 1] -= ny * m; vAr[ind + 2] -= nz * m;
  }
  return COMMIT;
}
```

This is ClayStripsBrush.stroke and flattenClay (tools.ts:917-1053) with two differences:
- the front list is no longer allocated;
- three loops become one.

### 5.5 Example with memory and three passes: Polish

```
pass 1  front = Faces camera;  N0 = Area normal(where front) [read only while held is empty];  C0 = Area centre(where front)
dab     held = Remember(per side, Stroke);  seed = Select(held valid, held, N0);  Stop dab(no seed, no update)
pass 2  inlier = front and abs(Dot(Position - C0, seed)) <= 0.25 r and Length(Normal) >= 1e-10
                 and Dot(Normal, seed) / Length(Normal) >= 0.5
        c = Mean(Position, where inlier);  ns = Sum(Normal, where inlier);  count = Count(where inlier)
dab     Stop dab(count < 8 or Length(ns) < 1e-10, no update)
        n = Normalise(ns);  if held valid: n = Normalise(held x s + n x (1 - s)), s = Clamp(Plane lock, 0, 0.95)
        held <- n  (cancelled by both stops)
pass 3  s = Dot(Position - c, n);  where abs(s) <= 0.25 r, not (Negative and s < 0), the same normal gate, d < 1
        Displace( -((n x s) x Fraction(Build-up x (Strength x swing) x Profile(d) x Mask)) )
```

### 5.6 Back ends and the site's script policy
- **Shipped tools.** The compiler's JavaScript printer runs in Node at build time (scripts/compile-tools.mjs, beside generate-sample.mjs). The parity fixtures are the gate: `--verify --outputs` at tol 0 for each ported tool, and 1e-6 as the floor.
- **Tools edited on the device.** `new Function` needs `'unsafe-eval'`, which the policy leaves out (public/_headers:42).
  - Instead, a WebAssembly printer turns the same passes into a module, compiled with the async `WebAssembly.compile`. The policy allows this through `'wasm-unsafe-eval'`.
  - JavaScript glue copies the region's needed attributes into the module's memory, runs each pass and copies the writes back.
  - Curves sample their 256-entry table there. Exact preset kernels only matter for parity, and parity only binds the built-ins.
  - Native nodes run in JavaScript between passes.
  - A user copy whose structure still matches a built-in (only settings changed) is matched by a structure hash. It uses the build-time JavaScript kernel, so variants are always full speed.
- **Reference interpreter.** It evaluates the intermediate form one node at a time over whole fields. The tests use it as the oracle against both printers on the fixture meshes. It is also the fallback when a module fails to compile; the editor then says the tool runs slowly.
- **Rejected:** serving generated scripts from the service worker at a same-origin URL. That is an eval the policy cannot see.
- **WGSL later.** The intermediate form is ready for it: passes are data-parallel, the memory has a fixed shape, and the per-vertex parts have no loops that depend on data. It only pays once positions live on the GPU. Picking, the octree and undo are on the CPU today, and a readback each dab is too slow on an iPad.

### 5.7 Speed

| Tool | Passes over the region, compiled | Loops today |
|---|---|---|
| Standard, Flatten | 2 | 3, plus the front-list allocation |
| Polish | 3 | 4 or 5, plus the allocation |
| Inflate, Crease, Pinch, Paint, Mask, Drag | 1 | 1 |
| Smooth (Average), Paint blur | neighbour average + 1 | the same; the blur's per-dab Float32Array (tools.ts:2176) moves to the arena |
| Smooth (Surface) | native | the same |
| Move, Twist, LocalScale | 1 per move | 1 |
| Rake | 3, plus Level reference when on | about 7 |

Built-in tools come out equal to today or faster. A user tool on WebAssembly pays for copying in and out (about two light passes) and runs its own passes fused.
- The editor measures the milliseconds per dab on the Try sphere and shows the cost against Standard ("1.2× Standard").
- It warns above 1.5×.
- The limits are 400 nodes, 8 passes, 16 Remember slots and 4 vertex memories.

## 6. Memory, symmetry and pressure

**Memory.**
- Remember is per side by default. This is what Polish's held normal (tools.ts:616-626) and DabSteps already do by hand.
- The Kept lifetime covers the Rake's previous-stroke across axis.
- Vertex memory is shared by the sides and keyed by vertex, like StrokeMoves. Its tables grow with the mesh and are kept across strokes, as the Rake's are.

**Symmetry.**
- The runtime runs the dab graph per side: the main side first, then the mirrored side picked on the surface the main dab left (the M2-8 order).
- A graph sees its side only through the Side node and Screen angle.
- Set from press adds the two sides' moves where they overlap, as Move does now.
- A tool declares "Mirror: per brush", which is the default, or "never". Transform is "never". The loop mask uses its native Mirror match.

**Pressure.**
- Pressure is one value per pointer move for all of that move's dabs, as today.
- Pressure response nodes give each tool its own size and strength channels. The patched Tablet getters, keyed by tool index (InputShell.ts:482), go away.
- Stand-ins keep their own hidden dynamics to stay faithful (see the open questions).
- Later, as Stroke options that are off by default:
  - per-dab interpolation of pressure;
  - coalesced events;
  - tilt and azimuth on the Pen node.

## 7. Settings, the Tool panel, presets and stand-ins

**Exposing a setting.** Any input port can be shown in the Tool panel. The spec is data:

```json
{ "port": ["n9", "strength"], "role": "strength", "label": "Strength", "unit": "cm",
  "min": 0, "max": 5, "step": 0.01, "typedMax": 50, "default": 1.5, "section": "main", "order": 30 }
```

- **Units:** cm (converted by the mesh scale in the graph), px or world (size), fraction, count, degrees, yes/no, choice, colour, curve.
- **Show when:** a setting can depend on another, e.g. the Size curve only while Pressure: size is above 0, and Relax only in Surface mode.
- **Roles** let shell features find any tool's setting: size, strength, spacing, pressureSize, sizeCurve, pressureStrength, strengthCurve, colour, curve. That covers the ; and ' strength keys, the s/b held-key drags, world-scale sizing and the strength-calibration conversions.

**The panel becomes data-driven.**
- It replaces the if/else at SculptPanel.ts:302-394.
- The shared rows keep their order because they are exposed ports of the shared nodes.
- The Symmetry section belongs to the runtime.
- "Smooth (Shift)" shows under any tool whose Shift stand-in is Smooth.
- A setting that is not exposed is not shown. Move's "Pressure: strength", which does nothing today, would go.

**Presets** are named sets of setting values and curve presets. The Rake's Fine, Comb, Coarse, Chisel and Scraper come over unchanged. A preset button stays lit while every value matches, the curve included, which fixes today's gap where an edited tine curve leaves the button lit.

A **variant** is a library entry that points at a base tool and changes only settings. It needs no compile.

**Keys and stand-ins.** In the tool header:
- `alt`: negative, pick colour or none.
- `shift` and `ctrl`: a library tool id plus what the stand-in inherits from the tool in hand: symmetry, world size, Size, Strength, and a linked curve.
- The faithful defaults are:
  - Shift → Smooth (inherits symmetry and world size);
  - Paint's Shift → Paint blur (also inherits Size and Strength, and its curve is linked to Paint's);
  - Ctrl → Mask (Alt only, ignoring the latch).
- Stand-ins are library tools, not dock tools.

## 8. Identity, saving and versions

**Identity.**
- Tools get stable string ids: `bz.clay`, `bz.crease`, `bz.move`, `bz.inflate`, `bz.pinch`, `bz.flatten`, `bz.rake`, `bz.drag`, `bz.polish`, `bz.paint`, `bz.smooth`, `bz.paintBlur`, `bz.mask`, `bz.twist`, `bz.localScale`, and `user.<uuid>` for tools people make.
- The library can offer the retired Twist and LocalScale at no cost.
- A fixed map from the vendor enum numbers (Enums.js:18-38) reads every table in old scenes, which are keyed by numbers with 1-3 digit keys (ScenePersist.ts:21-83; sanitize.ts).
- Runtime slots in SculptManager are allocated per id.

**File (`.bztool`).** JSON with no code in it:

```json
{ "format": "bozzetto-tool", "formatVersion": 1, "id": "user.7f3c…", "name": "Clay buildup",
  "icon": "fi-ss-screwdriver", "version": 4, "base": { "id": "bz.clay", "version": 3 },
  "stroke": { "type": "stroke.spaced", "v": 1 },
  "keys": { "alt": "negative", "shift": { "tool": "bz.smooth", "inherit": ["symmetry", "worldSize"] },
            "ctrl": { "tool": "bz.mask", "inherit": ["symmetry", "worldSize"] } },
  "nodes": [ { "id": "n7", "type": "fall.curve", "v": 1, "at": [520, 300], "options": { "presets": "clay" } } ],
  "links": [ ["n1", "point", "n3", "centre"] ],
  "settings": [ ], "presets": [ ], "groups": [ ], "cursor": { "style": "ring" } }
```

**Versions.**
- Every node type carries `v`. The registry upgrades old nodes step by step, the way curvesRev and STRENGTH_REV migrate today.
- A file with an unknown node type, or a newer format, still loads into the library but is disabled, with the words "Made with a newer Bozzetto". It is never dropped.
- A user copy remembers its `base`, so the editor can say "Standard has changed since you copied it".
- Compiled modules are cached by structure hash plus compiler version.

**Where things are saved.**
- The tool library lives in IndexedDB on the device, with an autosave after each edit, like sculpts.
- Export and import go through `.bztool` files, or `.bztools` for a set, zipped with client-zip, which is already a dependency. On iPad they reach the Files app through the share sheet.
- A scene still carries each tool's setting values, now keyed by tool id. It also embeds the definitions of the custom tools it uses, so a `.bozz` handed on opens with its tools.
- On import, a tool with the same id but a different hash is kept beside the existing one ("Rake (from scene)").

**Untrusted input.**
- A strict validator in the manner of sanitize.ts admits only node types from the registry, bounded sizes and clamped numbers.
- Since there is no code to run, a shared tool can at worst be slow, and the editor limits catch that.

## 9. Editing on the iPad with the Pencil

**Way in.** Use "Edit tool" in the Tool panel header, or "Edit" on a library card. A built-in tool says "Duplicate to edit" first. The editor is a workspace page:
- the Recipe column;
- the graph canvas;
- a Try viewport with the parity meshes (sphere, plane, cube), with Reset and its own undo.

In portrait these are three tabs. Edits compile in the background. A tool with errors keeps its last good version on the dock.

**Recipe view.** One row per stage. Tapping a stage lists its choices, each a built-in group with fixed ports, so every swap is type-safe:

| Stage | Choices |
|---|---|
| Dabs | Spaced dabs · Each move (grab) · Drag line |
| Area | Sphere · Connected, at the press · Whole mesh; Refine topology on/off; fit on the faces toward me only |
| Frame | Hit normal · Each vertex's normal · Area plane · Held plane (Polish) · Form plane (Rake) · Toward the brush centre · Pointer on the view plane (Move) · Turn about the view (Twist) |
| Falloff | Profile curve with its presets · Quartic · None |
| Amount | Length per stroke (cm) · Fraction per dab · Follows the pointer |
| Move | Raise toward the plane · Onto the plane, one side or both · Along the normal · Pinch toward the centre · Neighbour average · Surface fit · Rotate · Scale · Paint · Blur colour · Mask |
| Limits | Never past the plane · Stop at depth · Layer cap · Band · Tines |
| Keys | Alt, Shift, Ctrl |

A stage edited beyond its cards shows "Custom".

**Canvas gestures.** The pen draws and the finger moves the view, as in Sculpt.
- **Pencil:**
  - drag a node's title to move it;
  - drag from a port to draw a wire, and lift on a port to connect it (ports that can take the value stay bright, the rest dim);
  - lift on empty canvas to open node search, filtered to what can take that value;
  - draw across a wire to cut it;
  - draw a loop around nodes to select them, then Group, Duplicate or Delete.
- **Finger:** one finger pans and two fingers zoom. One finger on a node moves it and a tap selects it, so touch works as well as the Pencil.
- **Long press (600 ms, the Negative button's timer pattern, SculptToolbar.ts:130-211):**
  - lifts a node with its wires;
  - dropping it on a wire inserts it;
  - dragging it off the canvas edge or onto the bin deletes it, the same gesture as on the dock.
- **Ports:** tapping a port gives Show in Tool panel, Set value and Disconnect. Hit targets are 44 pt.
- **Inspector:** a bottom sheet holds the selected node's settings, using the Tool panel's scrub sliders (BrushSliders).
- **Mouse:** drag on empty canvas to lasso; middle-drag or space-drag to pan; scroll to zoom.
- **Keyboard (shortcuts only):** Delete, Cmd+D, Cmd+G, Tab for search, Cmd+Z.
- **History:** the editor keeps its own undo, separate from the sculpt's.

**Look (Gestalt v2).**
- Grey nodes with square corners.
- Orange only for the selected node and for focus.
- Lime for a valid drop target and for switches that are on.
- Port shape shows the type and fill shows the rate (section 3), so no colour coding is needed.
- Values in Martian Mono, names in Familjen Grotesk.
- Icons from Uicons solid straight, including the tool icon picker.

**Probes.** Tap a wire to pin a probe. A per-dab value shows as a number or vector chip, updated with each Try stroke. A field paints the Try mesh in grey scale with its minimum and maximum. The cost chip stays in the corner.

## 10. Where the library and dock touch the graphs

- The dock is an ordered list of up to 10 tool ids between the fixed Select and Transform. It is saved per device, as the keymap is.
- The hotkeys become slot actions `slot.1` to `slot.10` (1-9, 0) that resolve to whatever tool sits in the slot. Badges read `keymap.chordFor`, which ends the hard-coded digits at SculptToolbar.ts:255-270 and the switch at InputShell.ts:2456-2479.
- Long press to lift a tool, drag along the row to reorder, drag off the row to remove, drag from the library to add.
- Stand-ins and actions stay off the dock.
- Graph tools, variants and built-ins all look the same to the dock: an id, a name and an icon.

## 11. Order of work
1. Tool ids, the data-driven Tool panel, the library and dock, and variants. Built-in tools stay hand-written. This is the visible win, and it needs no compiler.
2. The intermediate form, the build-time JavaScript printer and `GraphTool`. Port the built-ins one at a time behind the parity fixtures, then retire their `stroke()` bodies.
3. Measure on the iPad: a WebAssembly spike that runs the clay graph against the built-in, at about 1M vertices.
4. The WebAssembly printer, the reference interpreter, the editor (Recipe first, then the canvas), the Try viewport and probes.
5. Files and sharing, tilt and per-dab pressure, more native nodes.

## 12. Open questions for Vidar

These are written in the docs/HANDOFF.md line format, for the parent to record. This pass was read-only.

- [ ] 2026-11-14: How should tools you edit on the iPad run: (a) compiled to WebAssembly, which keeps the site's planned script policy (recommended); (b) allow 'unsafe-eval' in the policy so they compile to plain JavaScript (simpler, weaker policy); (c) interpreted only, slower? (blocks: the graph editor's back end)
- [ ] 2026-11-14: When Drag becomes a graph, should it keep its quirks (it trails the pen by one sub-step, its spacing ignores the screen's pixel ratio, it picks the mirrored side before the main dab) or should they be fixed? Fixing moves Drag strokes slightly. (blocks: Drag's graph)
- [ ] 2026-11-14: The Tool panel will show only what a tool uses (Move's "Pressure: strength" would go) and will save every setting with the scene, including Move falloff, Crease pinch, Polish plane lock and build-up, and Mask strength, which are not saved today: agree? (blocks: the data-driven panel)
- [ ] 2026-11-14: Shift smooth, Ctrl mask and Paint's blur keep their own hidden pressure settings and their own spacing today. Keep that, or have them follow the tool in hand? (blocks: stand-ins)
- [ ] 2026-11-14: Brush settings ride with the scene today. Should a library tool's settings live in the library on the device, with the scene keeping a copy, or stay with the scene? (blocks: persistence)
- [ ] 2026-11-14: May each tool choose its own Shift and Ctrl tools (say, Shift on the Rake polishes), or should they stay Smooth and Mask everywhere? (blocks: the Keys stage)


## Coverage

Each row gives the tool as a graph in the node set above, node by node, written in the evaluation order used for parity. "Pick" means Hit → Brush radius → Pick sphere, with hidden groups always excluded. "d" is Normalised distance. "swing" and "layer" come from the tool's Pressure response. Defaults are given in brackets.

| Tool | Graph, node by node | Memory | Native nodes | What cannot be expressed, or needs a flag |
|---|---|---|---|---|
| Standard (clay) | Spaced dabs [0.1] → Pick [50 px] → Refine topology. **Pass 1:** Faces camera; Area normal (Stop dab, no update, if not ok); Area centre. **Dab:** Offset plane(centre, N, Select(Negative, −0.1r, 0.1r)); Clay rate(Strength cm [1.5], Mesh scale, Spacing, max(1e-3, Profile.integral), r, layer; gain 1.5, cap 0.5). **Pass 2**, skipped when rate ≤ 0: h = Dot(Position − plane point, N); where h × Select(Negative, −1, 1) ≤ 0 and Inside(d from Position); Displace(−(N × (Fraction(Profile[Clay: Plateau](d) × rate × Mask) × h))). | none | Refine topology | Nothing missing. The vendor's plain-brush branch is unreachable and is not ported. |
| Inflate | Spaced dabs [0.15] → Pick → Refine topology. **Dab:** Dab step (Remember the previous hit per side, starting at the press hit); amount = Share of stroke(Strength cm [0.5], layer, scale, step, integral constant 1.2, r) × Select(Negative, −1, 1). **Pass:** d = Distance(Rest position, hit)/r, where d < 1; f = ((amount × Quartic(d)) / Length(Normal)) × Mask; Displace(Normal × f). | Remember: previous hit (per side) | Refine topology | Nothing. Rest position is the live position on dynamic meshes, as today. |
| Crease | Spaced dabs [0.05] → Pick [25 px; size and strength pressure 1] → Refine topology. **Dab:** Dab step; amount = Share of stroke(Strength cm [0.75], …, max(1e-3, Profile[Crease: Sharp].integral)); brush = Select(Negative, −amount, amount); pinchK = (amount / r) × Pinch [0.625]. **Pass:** g = hit − Rest position; d = Length(g)/r, where d < 1; Displace(g × (Quartic(d) × Mask × pinchK), picked normal × (Profile(d) × Mask × brush)), with the two terms added in that order. Negative starts off. | Remember: previous hit | Refine topology | Nothing. The gather does not flip with Negative, as today. |
| Flatten | Spaced dabs [0.15] → Pick → Refine topology. **Pass 1:** Faces camera; Area normal (Stop dab, no update); Area centre. **Dab:** k = Fraction(Strength [0.75] × swing). **Pass 2:** s = Dot(Position − centre, N); where s × Select(Negative, −1, 1) ≤ 0 and d < 1 (live position); Displace(−(N × (Quartic(d) × (((s × k) × Mask))))). Negative starts on (shave). | none | Refine topology | Nothing. The proxy branch is dead today and is not ported. |
| Polish | Spaced dabs [0.15] → Pick → Refine topology. **Pass 1:** Faces camera; Area normal (read while held is empty); Area centre. **Dab:** held = Remember(per side, Stroke); seed = Select(held valid, held, N0) (Stop dab if none). **Pass 2:** inlier = front and abs(Dot(Position − C0, seed)) ≤ 0.25r and Length(Normal) ≥ 1e-10 and Dot(Normal, seed)/Length(Normal) ≥ 0.5; Mean(Position), Sum(Normal), Count, each where inlier. **Dab:** Stop dab(count < 8 or the normal is degenerate); n = Normalise; mix with held by Clamp(Plane lock [0], 0, 0.95); held ← n. **Pass 3:** s = Dot(Position − c, n); where abs(s) ≤ clip, not (Negative and s < 0), the normal gate and d < 1; Displace(−((n × s) × Fraction(Build-up [0.8] × (Strength [0.9] × swing) × Profile[Polish: Default](d) × Mask))). | Remember: held normal (per side, reset at the press) | Refine topology | Nothing. The Twist slot's skipped re-pick does not matter, because every dab re-picks. |
| Pinch | Spaced dabs [0.15] → Pick → Refine topology. **Dab:** k = (Strength [0.75] × swing) × 0.05 × Select(Negative, −1, 1). **Pass:** g = hit − Position; d = Length(g)/r (no Inside test, as today); Displace(g × (Quartic(d) × (k × Mask))). | none | Refine topology | Nothing. |
| Smooth (Average) | Shift stand-in. Spaced dabs [0.15, its own] → Pick (its own Size [50 px], or the tool in hand's world size) with no refine. L = Neighbour average(Position), held in Float32 (Jacobi). s = (Fraction(Strength [0.75] × swing) × Mask). Set positions(Position × (1 − s) + L × s). Switch(Mode) picks this branch. | none | Neighbour average | Nothing. Its own dynamics stay as hidden settings. |
| Smooth (Surface) | Same Stroke and Pick. Switch(Mode = Surface) → Surface smooth fit(region, hit, r, strength = Fraction(Strength × swing) × Mask, Relax [0.25], live positions) → Set positions. | none | Surface smooth fit: the gather out to r + min(r, 3·lmax·1.69), the grid, the 30 nearest neighbours, weighted PCA, the 6×6 Cholesky quadric, the clamped move along the fitted normal, then the tangential relax | The fit's insides (neighbour search, PCA, solve) are one native node and cannot be edited as nodes. |
| Move (VolumetricMove) | Each move. **At the press:** Hit, Brush radius, Pick connected (at the press), Press position. **Each move:** P = Closest point on ray(View.ray(pointer), C = press hit); Δ = P − C; dir = Select(Negative, Normalise(face normal at the press face, live) × (Select(pointer.now.x < pointer.press.x, −1, 1) × Length(Δ)), Δ) × Strength [0.25]. **Pass:** f = Power(Max(Quartic(Distance(Press position, C)/r), 0), Falloff [1]) × Mask; Set from press(dir × f), with the two sides adding. | Region and press snapshot (Stroke) | Pick connected | Nothing missing. The strength pressure is simply not wired, so its dead row goes away. Falloff becomes a saved setting. |
| Drag | Spaced dabs with the legacy Drag flags: 0.15·r without the pixel ratio, from the previous position, a dab at the press, the mirror picked before the main dab on static meshes. **Each move:** centre[mirror] ← Mirror point(centre[main]). **Pre-pick:** newC = Closest point on ray(View.ray(dab point), centre); dir = newC − centre; centre ← newC. Pick sphere(newC, Brush radius) → Refine topology. **Pass:** Displace(dir × (Quartic(Distance(Position, newC)/r) × Mask)). No Strength setting; size pressure [0]. | Remember: centre (per side) | Refine topology | Faithful only through the legacy sampler flags (open question). |
| Twist (vendor, retired) | Each move. **At the press:** Hit, Brush radius [75], axis = −eye. **Each move:** Pick sphere(press hit), re-picked → Refine topology; θ = Screen angle(press, previous, now; dead zone 30 px), negated on the mirror side. **Pass:** Set positions(Rotate about axis(Position − C, axis, θ × Quartic(d) × Mask) + C). | none | Refine topology | Nothing. It can return as a library tool. |
| LocalScale (vendor, unreachable) | Each move. **At the press:** Hit, Brush radius. **Each move:** Pick sphere(press hit) → Refine topology; dx = pointer.now.x − pointer.previous.x. **Pass:** Displace((Position − C) × (Quartic(d) × (dx × 0.01) × Mask)). | none | Refine topology | Nothing. It has no floor, as today; a Clamp can be added. |
| Rake (tines, scrape, Stop at depth, presets) | Spaced dabs [0.06] → Pick → Refine topology. **Pass 1:** Faces camera; Area normal n0, whose Stop dab (no update) also cancels the frame memory writes; Vertex memory read (cut v, scraped v, kept n, one validity); form = Position − cut where valid; the form's masked mean over front. **Dab:** Stroke direction(hit, n0, Remember the previous hit (per side, from the press), from press, Remember the previous across (Kept), world-axis fallback) → across0, along0, step. **Pass 2:** Fit plane slopes(form, Mask, where front, n0, across0, along0) → plane P, n (Stop dab, still updating the mesh, if everything is masked). **Dab:** across = Normalise(Part across(across0, n)) or across0; along = Cross(across, n); depth = Strength cm [0.3] × layer / scale; spacingFactor = step / (1.2r); comp = Select(Invert ≠ Negative, −1, 1); intensity = 0.6 × swing. When Stop at depth is on and depth > 0: Level reference(form − scraped where valid, front, Mask, P, n, across, along, hit, r, Tines, comp, depth) → quadric, offset. **Pass 3**, where d < 1 and Mask > 0: o = Position − cut − scraped; scrape: rate = Fraction(Scrape × Quartic(d) × intensity × Mask), h = Dot((Position − cut) − P, n), term1 = −((n × h) × rate), scraped −= n·h·rate, kept × (1 − rate). Tine: u and w by Dot with across and along over r; Tine slot(u, Tines, Tine width) → centre, t; prof = Select(t < 1, Profile[Tine: Round](t), 0); Disc chord; alongFall = Quartic(abs(w)/max(1e-6, chord)); full; share. Stop at depth clamp: Quadric value and slope, stood, sunk, room, share = Select(room > 0, Min(share, room), 0). amount = −comp × share; Displace(term1, n × amount); Vertex memory write cut += n × amount (when amount ≠ 0, valid or level), scraped, kept. Presets Fine, Comb, Coarse, Chisel and Scraper set Tines, Tine width, Strength, Scrape, Taper, Invert, Stop at depth and the tine curve. Cursor(tines, width, taper, the main side's across). | Remember ×3 (previous hit, from press, across); Vertex memory (cut, scraped, kept) | Refine topology, Level reference | Nothing. Level reference (cell maxima and median, quadric refit) is native. lastDab becomes Record nodes. The preset light now compares the curve too, a small behaviour fix. |
| Paint | Spaced dabs [0.05] → Pick [size and strength pressure 1] → Refine topology. **Pass:** d = Min(Distance(Position, hit)/r, 1); w = Profile[Paint: Default](d) × (Fraction(Strength [0.75] × swing) × Mask); Write colour(Colour × (1 − w) + From sRGB(Colour setting) × w). Keys: Alt is pick colour (the runtime eyedropper, no undo, a mix of the face's corner colours); Shift is Paint blur. Fill: an action of Once → Whole mesh (include hidden, as today) → where Mask > 0 → Write colour(mix by Mask). | none | Refine topology | The eyedropper is a key behaviour of the tool, not a node. The dormant roughness and metalness writes are not ported. |
| Paint blur | Shift stand-in for Paint. Spaced dabs [0.15, its own] → Pick (Size and Strength copied from Paint at the press) → Refine topology. L = Neighbour average(Colour), held in Float32. f = Fraction(Profile[linked to Paint's](Min(d, 1)) × (Strength × swing) × Mask); Write colour(Colour × (1 − f) + L × f). Hidden dynamics [size 0, strength 1]. | none | Neighbour average, Refine topology | Nothing. |
| Mask (stroke) | Ctrl stand-in. Spaced dabs [0.15] → Pick (its own 50 px, or the world size) with no refine. Polarity is Alt only: masks unless Alt, latch ignored. **Pass:** d = Min(d, 1); f = Power(1 − d, 2 × (1 − Hardness [0.25])) × (Select(Negative, −1, 1) × Strength [1] × swing); Write mask(Clamp(Mask + f, 0, 1)). | none | none | Nothing. Related masking gestures: **Ctrl+click on a group:** Tap → Group region → Write mask(0, or 1 with Alt), written into the open stroke state. **Ctrl+tap off the mesh, Mask all, Clear, Invert, Sharpen:** Once → Whole mesh → Write mask. **Mask blur:** Grow region(Mask < 1, one ring) → Neighbour average(Mask) → Write mask. **Extract:** makes a new mesh, so it stays a command. |
| Loop mask | Drag line (preview each frame, apply at release) → Loop side (crossed edge, edge-loop walk, then ring trace, then plane fallback, cached) → Write mask(Select(Alt, 1, 0)) → Mirror match (spatial hash, skipped when the cut is the symmetry plane); the overlay output is the cut line. | cut cache | Loop side, Mirror match | Expressible, but it is all native. Better kept as a built-in gesture, off the dock. Its floods ignore hidden groups, as today. |
| Poly groups as selection | Hiding is a runtime filter on every stroke. Group region serves the masking actions above. | | Group region | Isolate, show all, From mask, By angle and the rest are Model panel commands, outside the tool graphs. |
| Transform (gizmo) | Not a vertex tool. Object matrices through three.js TransformControls, the channel box, companions moving about the active origin, one StateCustom per drag. | | | Not expressed. It stays a fixed tool at the right end of the dock. The vendor's masked matrix mix could be an action (Mix(Position, Matrix × Position, Mask)) but is not needed. |
| ClayStrips layer cap (removed 2026-11-10) | Layer cap group: Vertex memory "built" (number) → room = Layer − built; move = Select(room > 0, Min(move, room), 0); built += move. It uses the same machinery as the Rake's Stop at depth. | Vertex memory | none | Nothing. It is offered in the library as a group under Limits. |

## Risks

1. **Size of the job.** This is a compiler, two printers, an interpreter, a runtime adapter, an editor and a file format.
   - Mitigation: the order in section 11. The library, dock and variants ship first with the hand-written brushes. Each built-in moves to graphs only behind the parity fixtures. The editor waits for an iPad measurement.

2. **Parity drift.** Floating-point results depend on the order of operations.
   - Pinch's `q *= k * mask * alpha` groups the right-hand side first.
   - The neighbour average goes through a Float32 scratch.
   - A NaN behaves differently under `<= 0` than under `> 0`.
   - Mitigation: the compiler never reassociates, the natives keep the vendor's precision, predicates are emitted as written, and the gate is `parity-fixtures --verify --outputs` at tol 0 for every ported tool.

3. **Speed of tools edited on the device.**
   - WebAssembly adds a copy in and out each dab. Graphs can grow to many passes. The native nodes run between passes.
   - On an iPad at about 1M vertices this is not yet measured.
   - Mitigation: a spike before the editor is built; the cost chip and the warning above 1.5×; the limits (400 nodes, 8 passes); and a variant whose structure matches a built-in always uses the build-time kernel.

4. **The site's script policy.**
   - JavaScript generated at run time needs `'unsafe-eval'`, which public/_headers:42 leaves out. The policy is report-only today, but it is meant to be enforced.
   - The WebAssembly route is more work than plain JavaScript, and some browsers limit synchronous compiles on the main thread, so the async compile is mandatory.
   - Serving generated scripts through the service worker would hide an eval from the policy and is rejected.

5. **Being faithful to today's quirks.**
   - Drag's trailing sub-step, its spacing without the pixel ratio and its early mirror pick.
   - Move's "Pressure: strength" row, which does nothing.
   - Settings that are never saved: Move falloff, Crease pinch, Polish lock and build-up, Mask strength.
   - Stand-ins with hidden dynamics.
   - The Rake's lastDab is shared by both sides.
   - Each needs an owner call (the open questions). Fixing any of them moves strokes, and the parity fixtures must be re-recorded on purpose.

6. **Memory semantics under dynamic topology.**
   - Vertex memory must keep StrokeMoves' rule of checking the exact stored position.
   - Rest position must stay the live array on dynamic meshes.
   - Regions are renumbered by refinement, so all memory has to be keyed by vertex, never by region index.
   - Vertex memory tables grow with the mesh: about 28 bytes per vertex per family, roughly 28 MB at 1M vertices. Several user tools with memory need one shared pool, or tables freed when a tool leaves the hand.

7. **Where a dab ends.**
   - Faithfulness needs Stop dab variants: with or without the mesh update, and with a per-write list of which stops cancel a memory write (the Rake updates its frame memory before its form-plane stop).
   - Users may find this subtle. The defaults are safe (cancel everything, no update), and the built-in graphs set the exceptions.

8. **Identity migration.**
   - Every table today is keyed by vendor enum numbers: tool slots, dynamics, symmetry, curves, strength, world size, sanitize's 1-3 digit keys, and LEGACY_STRENGTH.
   - Old scenes, and older builds reading new scenes, need the fixed enum-to-id map and, for a while, dual writing.
   - The e2e suite finds toolbar buttons by badge digit (tests/e2e/smoke.mjs:3545-3564). It also asserts that a touch on a toolbar button cannot arm a long press, which the dock's long press to lift changes.
   - The help text hard-codes "Default hotkey: N".

9. **Editing graphs on an iPad is hard to get right.** Wiring with a Pencil, small ports and mistaking a pan for a lasso are the known problems.
   - Mitigation: the Recipe view as the main way in, 44 pt targets, the rule that the pen draws and the finger moves the view, long press on the dock's timer pattern, and the Try sphere with probes. This still needs testing on the device with Vidar.

10. **Versioning over years.** Node type upgraders accumulate, and built-in updates drift away from user copies.
    - Mitigation: a `v` per node type, the `base` reference with a "has changed since you copied it" notice, and a disabled state rather than deletion for files from newer builds.

11. **Shared tool files are untrusted input.** They carry no code, but a hostile or careless graph can be heavy enough to stall strokes.
    - Mitigation: a strict validator with registry-only node types and bounded sizes; limits measured at compile time; the cost check on the Try sphere before a tool reaches the dock.

12. **Changing a tool while sculpting.** Compiles are async, and a new kernel must never swap in mid-stroke. It takes over at the next press; a graph with errors keeps the last good kernel.

13. **Scope creep toward the GPU.** WGSL only pays once positions live on the GPU. Picking, the octree, undo and the normal update are all on the CPU now, and a readback each dab on an iPad would cost more than it saves. The intermediate form keeps that door open without committing to it.

14. **Recording the open questions.** This pass was read-only, so they are not yet in docs/HANDOFF.md as CLAUDE.md asks. The parent step has to write and push them.
