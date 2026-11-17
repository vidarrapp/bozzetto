# Tool recipes: one fixed eight-stage stroke pipeline, every current sculpt tool a preset of it

# Tool recipes: a fixed stroke pipeline with typed stages

## 1. The idea in one paragraph

A sculpt tool is a recipe: a fixed column of eight stages that every stroke passes through, top to bottom. Each stage is a slot that holds one node, or a short chain of two to four nodes. The column never changes shape. A tool is the choice of node in each slot plus their settings. Today's tools differ from each other in two or three slots. Clay, Flatten and Polish share everything up to Reference and differ there and in the side setting of the same "Pull to plane" action. Inflate and Crease share their Sample, Reach and Strength nodes. Wiring is implicit. Each stage publishes typed values, and a node input picks one of the compatible values published above it, from a short list. There are no free-hanging wires, so there is no canvas to pan or zoom on an iPad. Built-in tools are read-only recipes. They run today's own loops, moved into kernels, so they run exactly as fast as now and give the same result. Editing a recipe makes a copy that runs on generic kernels, which are tested against those same built-in loops.

The internal stage names (Input, Sample, Select, Frame, Weight, Operate, Accumulate, Post) stay in code and in files. The interface uses plain names:

| # | Code name | On screen | What it decides |
|---|---|---|---|
| 1 | Input | **Pen** | size, strength, pressure response, Invert, colour |
| 2 | Sample | **Dabs** | how pointer motion becomes dabs or grab events |
| 3 | Select | **Reach** | which vertices a dab can touch |
| 4 | Frame | **Reference** | the point, plane, normal or direction the action is measured against |
| 5 | Weight | **Falloff and strength** | how much each vertex moves (shape) and how much the dab moves (amount) |
| 6 | Operate | **Action** | what happens to each vertex (push, pull to plane, average, paint ...) |
| 7 | Accumulate | **Over the stroke** | how dabs add up: add, reapply from the press, stroke memory, caps |
| 8 | Post | **Finish** | passes after the move (even out spacing); the commit is automatic |

Outside the column, each tool has its own **name, icon, Symmetry default, Shift and Ctrl stand-ins, cursor, panel layout and actions** (Paint's Fill).

## 2. Types, ports and rates

Every port has a **kind** and a **rate**.

**Kinds** (all geometry is in mesh-local space, as in the vendor code; lengths are local units; cm becomes local units only inside the Amount nodes, as S / mesh.getScale()):

- Number, Angle
- Point, Vector, Direction (unit)
- Plane {point, direction}
- Frame {point, n, across, along} (orthonormal)
- Reference surface {plane, quadric a..f, offset} (the Rake's pre-stroke surface)
- Ray {near, far}
- Screen point (device px; never mirrored, so a consumer states its own mirror rule)
- Switch (boolean)
- Colour (linear RGB)
- Curve (a ProfileCurve handle: sample(t), lineIntegral())
- Vertex set (Uint32Array of ids, the side, the mesh)

**Rates:**

- **Stroke**: set at the press, constant for the stroke.
- **Dab**: once per dab per symmetry side, or once per pointer event for grab tools.
- **Vertex**: a field, one value per vertex of the dab's set. A Number field is a Float32Array of n, a Vector field 3n, a Switch field a gate, a Colour field 3n.

**Rules:**

- A value may go **up** a rate: stroke to dab to vertex, broadcast.
- It never goes **down** without a **reducer** node. The reducers are Average surface, Grip plane, Stroke-start plane and Pre-stroke surface. They read a vertex set or field and output a dab value. This is what keeps the per-vertex part a closed set of array kernels.
- Each kind has its own port shape: a **round** port is one value per dab, a **square** port one value per stroke, a **diamond** port one value per vertex. This follows Blender's field ports. Port kind is shown by shape, not colour, so the Gestalt grey scale holds.
- **State reads are delayed by one dab.** A node that keeps state, such as Hold the normal, publishes the previous dab's value as a separate output ("from the last dab"). Polish's loop (the held normal seeds the grip, the grip updates the held normal) is therefore a DAG within a dab, with no cycle.

**Channels.** An Action writes Position, Colour or Mask. All Actions in one tool must write the same channel. The compiler checks this, because the channel picks the stroke's undo state and its commit:

| Channel | Undo state | Commit |
|---|---|---|
| Position | StateGeometry, or StateDynamic on a dynamic mesh | updateGeometry: ring normals, octree, dirty ranges to GeometrySync |
| Colour | StateColorAndMaterial | updateDuplicateColorsAndMaterials plus the colour upload |
| Mask | StateColorAndMaterial | updateDuplicateColorsAndMaterials plus the material upload |

**Position sources.** Distance, Pull to point and the plane heights all take a position source:

- **live**: the current vAr.
- **first touch**: the position when this stroke first touched the vertex. This is updateProxy through STATE_FLAG; on a dynamic mesh it is the live array, as today.
- **rest**: a snapshot of the set at the press (Move's vProxy).
- **form**: live minus this stroke's recorded move. It needs "Remember this stroke's moves" (the Rake's StrokeMoves, dyntopo-safe because each entry is checked against its stored position).

## 3. Node catalogue

Ids are stable and go into files. Each node type carries a version `v`. "Mirror" says how a node's output is mirrored for the symmetry side. "auto" means it is computed from the mirrored picking, so it is already mirrored.

### 3.1 Pen (Input)

| Id | Name | Out | Settings | Notes |
|---|---|---|---|---|
| `in.size` | Size | radius px (dab, after size pressure); radius px without pressure (for spacing) | size 5-500 px or world size; source: own / the tool in hand / the tool in hand in world scale only | world scale drives `_radius` from a world size at the cursor depth, as worldScale.ts does |
| `in.strength` | Strength | S (stroke) | unit cm or fraction; range; default; source: own / the tool in hand | cm: slider 0-5, typed to 50; fraction 0-1 |
| `in.pressure` | Pressure | **swing** 1 + a(2c(p) - 1), 0..2; **amount** 1 + a(c(p) - 1) for a pen, 1 for mouse or finger | channel size or strength; amount 0-1; curve Linear / Soft p^0.6 / Firm p^1.8 | replaces DynamicsStore's per-enum table; one panel row per channel as today |
| `in.invert` | Invert | negative (stroke switch) | starts inverted (Flatten yes, Crease no); Invert setting (the Rake's "Invert (raise ridges)", XOR); source: Alt and the Negative button / Ctrl+Alt only (Mask: negative = !alt, ignores the button) | resolved once at press as InputShell does now: ctrl ? !alt : alt ? !base : base |
| `in.colour` | Colour | colour (stroke) | colour; Alt picks colour (eyedropper on/off) | the eyedropper is a Pen setting, not a graph |
| `in.tilt` (later) | Tilt | altitude, azimuth (dab) | none | no current tool reads tilt; it is listed so the slot exists |

### 3.2 Dabs (Sample), one node

| Id | Name | Out (per dab, per side) | Settings | State |
|---|---|---|---|---|
| `sample.spaced` | Spaced dabs | centre (hit point), ray, picked normal, eye direction, r (local, from px times size pressure, unprojected at the hit depth), step (distance to this side's previous dab, at most r, the first from the press), hit | spacing 0.02-0.6 (times the unpressured px radius times pixelRatio); dab at press: no (today) | per side: previous centre (DabSteps) |
| `sample.trail` | Drag steps | moving centre (closest point on the current ray to the previous centre), move vector (new minus old), r | step 0.15 x r; legacy: no pixel ratio, starts at the previous sample, one dab at the press, mirror centre re-seeded as mirror(main) each event, mirror picked before the main dab on static meshes | per side: centre |
| `sample.grab` | Grab | anchor (press hit, per side), press picked normal, picked normal at the anchor now, ray now (mirrored per side), pointer px, previous px, press px | re-pick a sphere at the anchor each event: no (Move) / yes (Twist, Local scale); dead zone px (Twist 30) | per side: anchor |

One evaluation per pointer event; no spacing. The host skips the per-move re-pick, as `canBeContinuous` false does now.

The Dabs stage is also where coalesced events, lazy mouse and per-dab interpolated pressure would go later, as settings on these nodes.

### 3.3 Reach (Select)

| Id | Name | Out | Settings |
|---|---|---|---|
| `select.sphere` | Sphere | vertices (set); facing (set where n · eye ≤ 0, computed only when a node reads it) | refine under the brush (dynamic topology, before the action) yes/no; back faces: move (today) / leave; when: each dab / each event |
| `select.connected` | Connected sphere | the same, from a topological flood inside the sphere (pickVerticesInSphereTopological) | when: once at the press (Move) / each dab |

Hidden poly groups are always left out (Picking hooks). Each dab's undo capture is done by the runtime: pushVertices before refine, the same order as today.

### 3.4 Reference (Frame), dab rate, a chain of up to 4

| Id | Name | In → Out | Settings | State / mirror |
|---|---|---|---|---|
| `frame.centre` | Brush centre | → point (always published) | none | auto |
| `frame.normal` | Surface normal | → direction (the picked normal at the centre) | none | auto |
| `frame.average` | Average surface | facing set, source live/form → plane (mask-weighted area centre and area normal), valid | none | ends the side's dab when the normal has zero length |
| `frame.raise` | Raise plane | plane, r, negative → plane | by x r (0.1); Invert flips the side | none |
| `frame.grip` | Grip plane | facing set, seed direction, seed centre → plane, valid | band 0.25 r; facing 0.5 (60°); fewest points 8; unweighted centre, mean normal | none |
| `frame.hold` | Hold the normal | direction → direction; also the last dab's direction | Plane lock 0-0.95 | per stroke, per side |
| `frame.formPlane` | Stroke-start plane | facing set (form), direction, axes → plane (form mean; normal from a weighted least-squares height fit) | none | needs `acc.track` |
| `frame.strokeDir` | Stroke direction | centre, the side's previous centre, direction → frame (n, across, along), source (press, previous dab, previous stroke, fallback) | none | per side; across kept from the previous stroke |
| `frame.levelRef` | Pre-stroke surface | facing set, frame, scrape records → reference surface | fewest points 24, band 0.2 x depth, one cell per tine | per dab |
| `frame.rayPoint` | Point on the pointer ray | anchor, ray → point P, vector P − C, length | none | auto |
| `frame.alongNormal` | Along the normal | picked normal now, length, pointer px, press px → vector ±length x n | legacy sign: the pen left of the press point is minus | Move's Alt mode |
| `frame.viewAxis` | View axis at press | → direction (−eye at the press) | none | per side |
| `frame.turn` | Turn of the pointer | pointer, previous, press px → angle | dead zone 30 px | mirror: negate |
| `frame.sideways` | Sideways travel | pointer, previous → number Δx x 0.01 | per px 0.01 | mirror: same |
| `frame.byInvert` | By Invert | a, b, negative → a or b | none | generic; Move uses it to pick between its two vectors |

### 3.5 Falloff and strength (Weight)

The shape is one or two named weight chains (vertex rate). The amount is one or two dab scalars.

| Id | Name | In → Out | Settings |
|---|---|---|---|
| `w.distance` | Distance | centre, r, position source → d (field, in radii) | skip at 1 yes/no; clamp at 1 (Paint) |
| `w.curve` | Profile | d → field | curve: family (Clay, Crease, Polish, Paint, Tine) with presets and 2-8 anchors; the exact kernel on a preset, a 256-entry LUT once edited |
| `w.quartic` | Quartic | d → field | power (1; Move's Falloff 0.3-1, max(f,0)^pow) |
| `w.hardness` | Hardness | d → (1−d)^(2(1−h)) | hardness (Mask 0.25 gives a power of 1.5) |
| `w.even` | Even | → 1 | none (Smooth's Average mode has no falloff) |
| `w.tines` | Tines | frame, r, source → share weight, full weight | tines 2-12, tine width, taper, tine profile curve; along: quartic over the disc chord; 1/max(0.2, chord) |
| `w.mask` | x Mask | field → field x mAr[+2] | on by default; off for Mask |
| `w.band` | Near the plane | plane, source → gate | half-width 0.25 r (Polish) |
| `w.facing` | Facing the plane | plane → gate n_v · n ≥ cos | cos 0.5 |
| `w.multiply` | Multiply | field, field → field | generic, so its field is written to a scratch array |
| `amt.fraction` | Strength (fraction) | S, pressure swing or none → amount | gain (Pinch 0.05, Polish Build-up 0.8, Rake scrape 0.6 x Scrape); cap at 1 yes/no |
| `amt.share` | Strength (cm), shared over the stroke | S cm, pressure amount, step, r, integral → S·p/scale · step/(I·r) | integral from a Profile node, or fixed (quartic 1.2) |
| `amt.rate` | Strength (cm) as a build rate | S cm, pressure amount, r, spacing, integral → min(cap, gain·S·(spacing/0.1)/(I·r))·p | gain 1.5, cap 0.5 (Clay) |
| `amt.full` | Full | → 1 | none |
| `amt.scale` | Scale amount | amount, r → amount x factor (÷ r) | factor (the Crease's Pinch 0-2.5); divide by radius yes/no |

### 3.6 Action (Operate), up to 3, run in order per vertex

| Id | Name | Per vertex | Settings |
|---|---|---|---|
| `op.push` | Push along | Δ = ±dir · w · a | direction from Reference; Invert flips |
| `op.inflate` | Push along normals | Δ = ±(n_v/\|n_v\|) · w · a | Invert flips |
| `op.toPlane` | Pull to plane | Δ = −n · h · min(1, w·a), h = (p − o) · n | side: below / above / both; Invert: below ↔ above, or both → above (Polish trim); heights from live / form plus this stroke's cut (Rake) |
| `op.toPoint` | Pull to point | Δ = ±(c − p_src) · w · a | source live / first touch; Invert flips yes (Pinch) / no (Crease gather) |
| `op.translate` | Move by | Δ = vec · w · a | none |
| `op.rotate` | Turn about | v' = R(axis, angle·w)(v − c) + c | none |
| `op.scale` | Scale about | Δ = (v − c) · f · w | floor: none (legacy) / stop at −0.9 |
| `op.average` | Average with neighbours | lerp to the one-ring mean by min(1, w·a); Jacobi | channel position / colour / mask; tangent only no/yes; boundary vertices average their boundary neighbours; valence 2 or less stays |
| `op.fitSurface` | Fit to the surface | weighted PCA plane plus a quadric height field per vertex, move along the fitted normal; Jacobi | reach 3 x the mean edge, 12 to 30 points, thin-wall test (one node: its own gather and grid stay inside it) |
| `op.paint` | Blend to colour | c ← lerp(c, C, w · min(1, a)) | none |
| `op.mask` | Add mask | m ← clamp(m ∓ w·a, 0, 1) | Invert: mask or unmask |

### 3.7 Over the stroke (Accumulate)

| Id | Name | What it does |
|---|---|---|
| `acc.add` | Add each dab | The default. Each dab writes onto the live positions. |
| `acc.fromRest` | From the press each time | Takes the rest snapshot at the press. Each event restores every side's set, then applies every side's action, so overlapping sides sum, as Move does now. It needs Reach "once at the press" and Grab. |
| `acc.track` | Remember this stroke's moves | StrokeMoves per vertex (the move k, plus the scrape s and the kept product). It gives "form" positions and feeds the caps. The tables persist and grow like StrokeMoves. |
| `acc.stopAtDepth` | Stop at depth | Per vertex, limits a Push along's share to the room left under the Pre-stroke surface (above it for ridges), using the full weight. It needs `acc.track`, a `frame.levelRef`, and the Rake's arrangement: optional Pull to plane, then Push along. |
| `acc.layer` | One layer per stroke | Caps the form-relative push at Strength. This is the 2026-10-31 to 2026-11-10 clay, which no preset uses. |

### 3.8 Finish (Post)

| Id | Name | What it does |
|---|---|---|
| `post.relax` | Even out spacing | Tangential relax toward the area-weighted centroid of the one-ring faces, by Relax x s. Boundary vertices are not moved. Jacobi. This is Surface smooth's second pass, now usable after any Action. |
| (implicit) | Commit | By channel, as in section 2. At release: balanceOctree, cleanNoop, restore the swaps. |

Retired and dead paths get no nodes: alpha stencils, continuous (timer) mode and `_lockPosition`. A future `w.stencil` could fill the Weight slot without any change to the pipeline.

## 4. Evaluation model, and keeping strokes as fast as today

**Host.** A single vendor-slot class, `RecipeTool extends SculptBase`, sits in two new enum slots: `RECIPE` (the tool in hand) and `RECIPE_STAND_IN` (the Shift or Ctrl tool). New enum values are fine; existing ones must not change, because they are serialised. The host holds a compiled **plan** and exposes the ad hoc fields the shell already probes (`_radius`, `_intensity`, `_negative`, `_spacing`, `curve`), so worldScale, the cursor and the panel keep working during the move. SculptManager still sees one tool index.

**Compile when the recipe changes, never per stroke.** The compiler:

1. Resolves bindings and checks kinds and rates.
2. Topologically sorts each stage's chain.
3. Sorts the work into `onPress`, `onEvent`, `perDab(side)`, `vertexKernels` and `onRelease`.
4. Allocates node state.
5. Picks kernels.

The validator refuses: a binding to a value from a later stage, more than 4 nodes in a stage, more than 3 Actions, mixed channels, and a cap with no tracker. It reports each in plain words.

**Per event and per dab**, for side in main, then sym (the mirror is re-picked on the surface the main dab left, as SculptBase.makeStroke does now):

```
pick(side) → Reach (capture undo, refine) → Reference chain (may end the side's dab)
→ amounts (dab scalars) → Action kernels with caps inline → Finish passes → commit(side)
```

The upload happens once per pointer event, as today.

**No code generation at run time.** The site's CSP (`public/_headers`, report-only for now) allows `script-src 'self' 'wasm-unsafe-eval'` and no `unsafe-eval`. A runtime JIT would break once it is enforced, so every kernel is hand-written TypeScript, built ahead of time.

There are three kernel tiers:

1. **Built-in kernels.** Each built-in recipe has a signature: its exact node chain with settings left free. When a recipe matches, the compiler binds the built-in kernel. That kernel is today's loop moved out of `tools.ts` and the vendor tools, unchanged: flattenClay, the Rake loop, gripPlane/polish, the Crease, Inflate and Pinch loops, SurfaceSmoother.run, VolumetricMove and the Paint, blur and Mask loops. Changing a setting keeps the built-in kernel. Swapping a node drops to tier 2. A test asserts that every built-in recipe compiles to its built-in kernel, so a built-in can never quietly fall to the slow path.
2. **Composed kernels.** A Weight chain of `w.distance` plus one shape node plus `w.mask` is not written out as an array. It compiles to a small WeightSpec {centre, r, source, shape kind, curve, mask on}. Each Action kernel has one loop per (source x shape) pair: 4 sources x 5 shapes = 20 small monomorphic variants, written at build time. Every branch on settings sits outside the loop. There are no per-vertex function calls through node objects and no closures. This matches today's fused loops in instruction count.
3. **Pass-by-pass.** Gates and generic Multiply nodes write Float32Arrays from a scratch pool. The pool is sized to the largest gathered set and grown x1.25, like StrokeMoves, so a dab allocates nothing beyond what picking already allocates. Each such node adds one pass over n floats. That is small beside the per-dab normal and octree update and the sphere gathers, which dominate a dab's cost (shared map, section 10).

**Budgets, measured with the existing tools:**

- **Built-ins:** no measurable change, since the loops are identical. Checked with `scripts/parity-fixtures.mjs --verify --outputs --tol=0` and the frame meter's `onWork` timing on a ~1M-vertex mesh on the iPad.
- **Composed and pass-by-pass:** at most 1.5x the deformation loop of the nearest built-in. The plan walk itself (about 10 to 30 calls per dab per side) should stay under 30 µs.
- **In the editor**, the footer says "Speed: as the built-in" or "Speed: slower (custom parts)".

**Two-way parity proves the recipes are faithful.** For each built-in recipe, CI runs the parity fixtures twice:

1. through its built-in kernel, which must match today's recordings at tol 0;
2. forced through the composed and pass-by-pass kernels, which must match within 1e-6.

The second run is what proves that the recipe, read node by node, really is the tool. A user's edit then starts from a generic path that has already been tested.

Workers and GPU compute stay out, as today. A plan is plain data and could move to a worker later, but SharedArrayBuffer needs cross-origin isolation, which the site does not have.

## 5. State

Each node type declares the state it keeps, with a lifetime. The runtime allocates it, keys it by side where the node says so, and resets it:

| Lifetime | Reset | Examples |
|---|---|---|
| dab | every dab | grip inliers, level grid |
| stroke | at the press (begin) | DabSteps' previous centre (per side), Hold the normal (per side), Grab anchor and rest snapshot (per side), StrokeMoves id bump |
| tool | when the recipe unloads | Stroke direction's across from the previous stroke (per side), StrokeMoves and scraped buffers (by vertex, shared by both sides, grown, never shrunk) |

Per-side keys are `main` and `sym`, as `sideOf` does now. Vertex-keyed stroke memory is shared by both sides because it is keyed by vertex id, as now.

Debug records (the RakeDab-style `last`) are declared by nodes and filled only when tests ask.

## 6. Symmetry

Symmetry is a tool-level wrapper, not a node. Each tool keeps its own on/axis default, as SymmetryStore does, keyed by tool id.

**Order.** The plan runs `perDab(main)`, re-picks the mirror on the updated surface, then runs `perDab(sym)`.

**What mirrors automatically.** Values computed from the mirrored picking are already mirrored: points, the picked normal, eye direction, rays and sets.

**Screen-derived values** declare their mirror rule in the catalogue:

- Turn of the pointer: negate. This gives M·R(n,θ)·M = R(Mn, −θ), as Twist swaps its arguments now.
- Sideways travel: same.
- Along the normal's left/right sign: same as the main side.

**Grab tools.** Grab keeps an anchor, a set and a rest snapshot per side. With From the press each time, both sides are restored before either applies, so their effects sum where they overlap.

**Stand-ins** inherit the tool in hand's symmetry, as now.

**Legacy order.** Drag's mirror-before-main order on static meshes is a legacy setting on Drag steps (an open question below).

## 7. Pressure and dynamics

The Pen stage holds two `in.pressure` nodes, Size and Strength. Each has an amount and a curve. This replaces `DynamicsStore`, which is keyed by enum. Every node that consumes pressure picks the response it reads:

- **Size** goes into Dabs' r as the swing (0..2). Spacing still uses the radius without pressure, as now.
- **Fraction strengths** (`amt.fraction`) read the swing.
- **cm strengths** (`amt.share`, `amt.rate`) read the amount, which is 1 for a mouse or finger.
- **The Rake reads both from one Strength row**: the cut reads the amount, the scrape reads 0.6 x the swing.

A pressure row shows in the panel only when some node reads it. That fixes Move showing "Pressure: strength" though nothing reads it. The defaults per built-in are today's DEFAULTS: Crease and Paint size 1 and strength 1, Drag 0 and 0, everything else 0 and 1.

## 8. Stand-ins (Shift and Ctrl)

Each tool names its stand-ins:

- Shift: Smooth by default; Paint uses Paint blur.
- Ctrl: Mask.

A stand-in is an ordinary recipe. Every Pen setting of a stand-in says where it takes its value from: **own**, or **the tool in hand**. That makes today's implicit rules explicit:

| Stand-in | Size | Strength | Profile | Spacing | Pressure |
|---|---|---|---|---|---|
| Smooth | own px in screen scale, the tool in hand's in world scale | own | none | own 0.15 | own |
| Paint blur | the tool in hand's (Paint), copied at the press | the tool in hand's | the tool in hand's | own 0.15 | own |
| Mask | own px in screen scale, the tool in hand's in world scale | own (1.0) | none | own | own |

All three take the tool in hand's symmetry.

The "Smooth (Shift)" group at the foot of a tool's panel is the stand-in's exposed settings: Strength, Mode and Relax. They are shared across tools, as now. Ctrl+click group mask, the tap off the mesh that inverts the mask, the Ctrl drag zoom and the Ctrl+Shift loop mask stay shell gestures, not recipes.

## 9. Exposed settings, the Tool panel, presets

**Exposed settings.** Any node setting can be **shown in the Tool panel**. Each exposed entry records: the node path, label, widget (slider, select, switch, curve editor, colour, buttons), range, step, typed minimum and maximum, unit (px, cm, fraction, degrees, count), and a group heading. The panel is generated in this order:

1. The "Smooth (Shift)" group, when the Shift stand-in is Smooth.
2. The exposed rows in pipeline order. That reproduces today's order: Size, Pressure: size, Size curve, Strength, Pressure: strength, Strength curve, Spacing, then the extras.
3. Tool actions (Fill).
4. The Symmetry section.

This replaces the hard-coded `if/else` in SculptPanel.refreshBrush. Settings that today are not saved (Move's Falloff, Crease's Pinch, Polish's Plane lock and Build-up) get saved, because saving is generic.

**Choices.** An exposed **choice** switches a slot between alternatives the recipe lists. Smooth's Mode (Average or Surface) is one. It swaps `op.average` for `op.fitSurface` plus `post.relax`, and Relax shows only for Surface.

**Tool presets** are named bundles of exposed values, curves included. The Rake's Fine, Comb, Coarse, Chisel and Scraper are presets. A preset button lights while every value matches. This now includes the tine curve, which today is not compared: a small change in behaviour.

**Tools versus presets.** "Duplicate as a new tool" turns a preset into its own tool in the library.

## 10. Identity, saving, files, versions

**Ids.** Built-in tools get string ids that map to the old enums, e.g. `bz.clay` (BRUSH 0), `bz.polish` (TWIST 2), `bz.rake` (13). User tools get `user:<uuid>` (crypto.randomUUID, with a getRandomValues fallback for older iPadOS).

Every table keyed by enum moves to string keys behind a revision bump, migrating numbers to `bz.*`:

- dynamics, symmetry, world-scale sizes and STAND_INS
- CURVE_TOOLS, the strength skip list and LEGACY_STRENGTH
- TOOL_NAMES and the scene settings tables

sanitize.ts today accepts only keys of 1 to 3 digits. It must accept `bz.[a-z]+` and `user:[0-9a-f-]{36}`.

**The library** lives in IndexedDB on the device, next to `deviceStore`, so it works offline in the installed app. Built-in recipes ship in the bundle and are read-only. Editing one makes "Standard (clay) copy". A user copy stores its whole recipe, not a reference, so an app update never changes a user's tool. The library can say "The built-in changed since you copied it" later.

**Files.** `.bztool` holds one tool. `.bztools` holds a library plus the dock order. Both are JSON. They are gzipped when CompressionStream exists, with the same magic-sniffing reader as .bozz. They are saved and opened through the same download, share sheet and file picker path as .bozz files. Files hold **data only**: node ids from the app's catalogue, never code, so sharing one is safe. Loading goes through a sanitizer that:

- accepts only known node ids;
- clamps every setting to its node's declared range;
- caps counts (4 nodes per stage, 3 Actions, 32 nodes in all) and string lengths;
- refuses `__proto__`-style keys, as isCurveId does now.

**Versions.**

- The file has `format: "bozzetto-tool"`, `version`, and `catalogue` (the node set's version).
- Each node has `v`.
- Migrations are pure functions from node@v to node@v+1, kept forever.
- A file that names a node or version this app does not know loads, but stays disabled with "Made with a newer Bozzetto". The app never guesses.

```json
{ "format": "bozzetto-tool", "version": 1, "catalogue": 1,
  "id": "user:…", "name": "Clay, soft edge", "icon": "fi-ss-screwdriver", "basedOn": "bz.clay@1",
  "pen":    [{"id":"size","node":"in.size","v":1,"p":{"px":50}},
             {"id":"ps","node":"in.pressure","v":1,"p":{"channel":"size","amount":0,"curve":"linear"}},
             {"id":"pt","node":"in.pressure","v":1,"p":{"channel":"strength","amount":1,"curve":"linear"}},
             {"id":"str","node":"in.strength","v":1,"p":{"unit":"cm","value":1.5}},
             {"id":"inv","node":"in.invert","v":1,"p":{"startsInverted":false}}],
  "dabs":   [{"id":"dab","node":"sample.spaced","v":1,"p":{"spacing":0.1}}],
  "reach":  [{"id":"sel","node":"select.sphere","v":1,"p":{"refine":true,"backFaces":"move"}}],
  "reference": [{"id":"area","node":"frame.average","v":1,"in":{"set":"sel.facing"}},
                {"id":"pl","node":"frame.raise","v":1,"in":{"plane":"area.plane"},"p":{"by":0.1}}],
  "falloff":[{"id":"d","node":"w.distance","v":1,"p":{"source":"live"}},
             {"id":"w","node":"w.curve","v":1,"in":{"d":"d.d"},"p":{"family":"clay","preset":"soft"}},
             {"id":"m","node":"w.mask","v":1,"in":{"f":"w.out"}},
             {"id":"a","node":"amt.rate","v":1,"in":{"integral":"w.integral"},"p":{"gain":1.5,"cap":0.5}}],
  "action": [{"id":"op","node":"op.toPlane","v":1,"in":{"plane":"pl.plane","w":"m.out","amount":"a.amount"},"p":{"side":"below"}}],
  "stroke": [{"id":"acc","node":"acc.add","v":1}], "finish": [],
  "show": ["size.px","ps.amount","ps.curve","str.value","pt.amount","pt.curve","dab.spacing","w.curve"],
  "presets": [], "standIns": {"shift":"bz.smooth","ctrl":"bz.mask"}, "symmetry": {"on":true,"axis":"x"}
}
```

## 11. Editing a recipe on an iPad with a Pencil

**Where.** "Edit tool" opens from the Tool panel's header and from the library sheet. The **Tool editor** takes the place of the right panel, at the panel's width (about 400 px). The view stays live beside it, so every change is tried with the next stroke. That is the whole test loop. There is no separate test canvas.

The editor header holds:

- the tool name (tap to rename) and its icon (tap for a grid of Uicons solid straight icons);
- Undo and Redo for edits, separate from sculpt undo;
- More: Duplicate, Reset to the built-in, Save as file, Delete;
- Done.

**The column.** Eight stage cards, top to bottom. A closed card is one 56 px row: the stage's number and plain name, then its nodes as chips left to right, e.g. "Average surface → Raise plane 0.1". One card is open at a time. An open card shows each node's settings with the same widgets as the Tool panel (BrushSliders and CurveEditor), so there is nothing new to learn. The open card has the orange focus outline. Everything else is grey scale. Targets are at least 44 px.

**Swapping and adding.**

- **Swap.** Tap a node's name to get a sheet of the nodes that **fit this slot**. Each has a one-line plain description and a small line diagram. Nodes that do not fit are not listed.
- **Prerequisites.** A node that fits but needs another one says so and offers it in one tap: "Stroke-start plane needs Remember this stroke's moves. Add it."
- **Add.** A "+" chip at the end of a chain adds a node.

**Inputs without wires.** Each input shows as a chip naming its source, e.g. "Plane: Raise plane". Tap it for a short list of the compatible values from the stages above, each marked with its port shape (round, square, diamond). That is the whole wiring model. A legend explains the three shapes once.

**Gestures: the same as the dock.**

- **Long press** (600 ms, timed by event timestamps, no pointer capture on touch, touchstart preventDefault, as the Negative button does) lifts a chip.
- **Drag along the chain** to reorder.
- **Drag off the card** to remove.
- **Tap** opens. Every drag has a menu equivalent (Move left, Move right, Remove) for anyone who does not drag.
- **Typed values** use the slider's typed field. iPadOS Scribble lets the Pencil write numbers straight into it.
- Pencil hover, where the iPad has it, can show a node's description. Nothing depends on hover.

**Showing settings in the Tool panel.** Each setting row has a "Show in Tool panel" switch at its right, lime when on. "Panel preview" at the foot shows the Tool panel as it will look.

**Problems** show on the card in red text, in plain words, e.g. "Needs a plane from Reference". A tool with a problem can be saved but shows dimmed in the dock and cannot stroke.

A full wiring view (a DAG canvas) is not part of v1. It could come later as a read-only view.

## 12. Where this meets the library and the dock

- Tools are identified by recipe id, so the dock is an ordered list of ids.
- New keymap actions `dock.slot1` … `dock.slot10` (default 1-9, 0) replace `tool.crease` … `tool.paint`.
  - Migration moves any rebinding of `tool.X` to the slot where X sits.
  - q (Select) and t (Transform) stay fixed at the two ends. They are not recipes.
- InputShell's action switch becomes `selectTool(dock.at(n))`.
- Badges and tooltip `<kbd>` read `keymap.chordFor('dock.slotN')`. That also fixes today's stale badge after a rebind.
- With the default dock in today's order, the e2e suite's badge lookups keep working.
- Long press to detach and drag off to remove reuse the Negative button's timer pattern, the same as the editor's chips.

## 13. Build order

1. **Ids.** String tool ids and the table migration; slot hotkeys and keymap-driven badges. The dock can ship on top of this alone.
2. **Recipes as data.** Each built-in recipe written out node by node. The Tool panel is generated from exposed settings. The host still calls today's classes, so the stroke path is unchanged.
3. **The runtime.** RecipeTool plus the plan compiler. The built-in kernels are extracted from the classes. Two-way parity runs in CI.
4. **Duplicate and edit.** The composed and pass-by-pass kernels, the Tool editor, and validation.
5. **Sharing.** `.bztool` and `.bztools` files, import and export, and tool presets for all tools.
6. **New nodes**: tilt, lazy mouse and coalesced events in Dabs, `w.stencil`, auto smooth in Finish.

## 14. Open questions for Vidar

These should go into docs/HANDOFF.md under "## Open questions for Vidar". This pass was read-only, so they are not written there yet.

- [ ] 2026-11-14: Once tools live in a library, where do a tool's settings (size, strength, curves, rake knobs) live: with the tool on this device (one Clay everywhere), or per scene as today (blocks: tool ids and the settings migration)
- [ ] 2026-11-14: When Drag, Move and Local scale become presets, keep their old behaviour exactly or fix it in the same change. The behaviour in question: Drag lags one step behind the pen, ignores screen density and mirrors before the main dab; Move's Alt direction depends on which side of the press point the pen is; Local scale can turn a part inside out (blocks: the parity tests for those presets)
- [ ] 2026-11-14: Bring Twist and Local scale back as library tools (both fit the node set), or leave them out (blocks: nothing)
- [ ] 2026-11-14: Offer the earlier Standard that laid exactly one layer per stroke (removed 2026-11-10) as a library tool, or not (blocks: nothing)
- [ ] 2026-11-14: Should a .bozz file carry copies of the user-made tools its scene used, so they come along to another device (blocks: the .bozz settings format)
- [ ] 2026-11-14: Tool editor: in the right panel with the view live beside it, so each change is tried with a stroke, or full screen (blocks: the editor layout)


## Coverage

Notation: Pen | Dabs | Reach | Reference | Falloff and strength (shape; amount) | Action | Over the stroke / Finish. "x Mask" is `w.mask`. Defaults are today's values.

| Tool | Pen | Dabs | Reach | Reference | Falloff and strength | Action | Over the stroke / Finish | Panel (shown settings) | Cannot be expressed / caveats |
|---|---|---|---|---|---|---|---|---|---|
| Standard (clay), ClayStrips (`bz.clay`, BRUSH 0) | size 50 px, size pressure 0; Strength 1.5 cm; strength pressure 1 (amount response); Invert from Alt and Negative | Spaced dabs 0.1 | Sphere, refine yes, back faces move | Average surface (facing set, ends the dab on zero normal) → Raise plane 0.1 r (Invert flips) | Distance (live) → Profile (Clay family, Plateau) → x Mask; amount: Strength (cm) as a build rate (gain 1.5, cap 0.5, integral from the Profile) | Pull to plane, side below (Invert → above), min(1, w·rate) | Add each dab / none | Size, Pressure: size + curve, Strength (cm), Pressure: strength + curve, Spacing, Profile | Nothing missing. The vendor's dead plain-brush branch would be Push along (picked normal) and is not carried. The removed one-layer clay is expressible as Stroke-start plane + One layer per stroke |
| Inflate (`bz.inflate`, 1) | size 50, size pressure 0; 0.5 cm; strength pressure 1; Invert | Spaced dabs 0.15 (gives step per side) | Sphere, refine yes | Brush centre | Distance (first touch) → Quartic → x Mask; amount: Strength (cm) shared (integral fixed 1.2) | Push along normals (Invert flips) | Add each dab / none | common rows | Nothing missing |
| Crease (`bz.crease`, 6) | size 25, size pressure 1; 0.75 cm; strength pressure 1; Invert, starts inverted: no | Spaced dabs 0.05 | Sphere, refine yes | Brush centre; Surface normal (picked) | w1 = Distance (first touch) → Quartic → x Mask; w2 = same d → Profile (Crease family, Sharp) → x Mask; a = Strength (cm) shared (integral from the crest Profile); a2 = Scale amount (a ÷ r x Pinch 0.625) | 1) Pull to point (centre, first touch, w1, a2, Invert does not flip) 2) Push along picked normal (w2, a, Invert flips) | Add each dab / none | common rows + Profile, Pinch | Nothing missing. Gather has no limit (legacy, kept) |
| Flatten (`bz.flatten`, 4) | 50 px; fraction 0.75; strength pressure 1 (swing); Invert starts inverted: yes | Spaced dabs 0.15 | Sphere, refine yes | Average surface | Distance (live) → Quartic → x Mask; amount: Strength (fraction), cap 1 | Pull to plane, side below with starts-inverted → above (shave); Alt → below (fill) | Add each dab / none | common rows | Nothing missing |
| Polish (`bz.polish`, TWIST 2) | 50 px; fraction 0.9; swing; Invert (Alt → trim) | Spaced dabs 0.15 | Sphere, refine yes | Average surface (seed on the first dab) → Grip plane (seed direction = Hold the normal's last value, else the average; band 0.25 r, facing 0.5, fewest 8) → Hold the normal (Plane lock 0, per side) | Distance (live) → Profile (Polish, Default) → x Mask → x Near the plane (0.25 r) → x Facing the plane (0.5); amount: Strength (fraction), gain 0.8 (Build-up), no cap on the amount | Pull to plane, both sides (Invert → above only), min(1, w·a) | Add each dab / none | common rows + Plane lock, Profile, Build-up | Nothing missing. The seed loop is a one-dab-delayed state read, so there is no cycle |
| Pinch (`bz.pinch`, 5) | 50 px; fraction 0.75; swing; Invert | Spaced dabs 0.15 | Sphere, refine yes | Brush centre | Distance (live) → Quartic → x Mask; amount: Strength (fraction), gain 0.05, uncapped | Pull to point (live, Invert flips) | Add each dab / none | common rows | Nothing missing |
| Smooth, Average (`bz.smooth`, 3; the Shift stand-in) | size own 50 px (the tool in hand's in world scale); fraction 0.75 own; own pressure (strength 1); no Invert | Spaced dabs 0.15 | Sphere, refine no | none | Even → x Mask; amount: Strength (fraction), cap 1 | Average with neighbours (position, Jacobi, boundary rule, valence ≤ 2 kept) | Add each dab / none | as the "Smooth (Shift)" group: Strength, Mode | Nothing missing. The unused tangent variant is a setting on the same node |
| Smooth, Surface (same tool, Mode = Surface) | as Average | Spaced dabs 0.15 | Sphere, refine no | none | Even → x Mask; amount: Strength (fraction), cap 1 | Fit to the surface (reach 3 edges, 12 to 30 points, PCA plane plus quadric, thin-wall test, clamp ±h) | Add each dab / Even out spacing (Relax 0.25) | Strength, Mode, Relax | Expressed, but Fit to the surface is one coarse node: its own wider gather and uniform grid are not separate nodes |
| Move, VolumetricMove (`bz.move`, 9) | size 50, size pressure at the press only; fraction 0.25; strength pressure: none; Invert (Alt → along the normal) | Grab (no re-pick) | Connected sphere, once at the press, refine no | Point on the pointer ray (→ P − C); Along the normal (legacy left/right sign); By Invert picks between them | Distance (rest) → Quartic, power 1 (Falloff) → x Mask; amount: Strength (fraction), no pressure | Move by (vector x w x a) | From the press each time (rest snapshot; both sides restored, then applied, overlaps sum) / none | Size, Pressure: size + curve, Strength, Falloff (now saved) | Nothing missing. "Pressure: strength" stops showing, since no node reads it. The Alt sign is a legacy setting |
| Drag (`bz.drag`, 7) | size, size pressure 0; no strength; no Invert | Drag steps (0.15 r, legacy: no pixel ratio, starts at the previous sample, dab at the press, mirror re-seeded each event, mirror picked before the main dab on static meshes) | Sphere at the new centre each step, refine yes | the step's move vector (new − old centre, from Drag steps) | Distance (live, from the new centre) → Quartic → x Mask; amount: Full | Move by | Add each dab / none | Size, Pressure: size + curve | Nothing missing. The trail, density and mirror order are legacy flags (open question) |
| Twist (vendor, retired; would be `bz.twist`) | size 75; no strength; no Invert | Grab (re-pick at the anchor each event, dead zone 30 px) | Sphere at the press point, refine yes | Brush centre (press); View axis at press (per side); Turn of the pointer (mirror: negate) | Distance (live) → Quartic → x Mask; amount: Full | Turn about (axis, centre, angle x w) | Add each dab (incremental) / none | Size | Nothing missing |
| Local scale (vendor, unreachable; would be `bz.localScale`, 11) | size 50; no strength | Grab (re-pick each event) | Sphere at the press point, refine yes | Brush centre; Sideways travel (Δx x 0.01, mirror: same) | Distance (live) → Quartic → x Mask; amount: Full | Scale about (floor: none, legacy) | Add each dab / none | Size | Nothing missing. Inversion is kept unless the floor setting is turned on |
| Rake, with Fine / Comb / Coarse / Chisel / Scraper (`bz.rake`, 13) | size 50, size pressure 0; Strength cm (preset: Coarse 0.3); strength pressure 1, read as amount by the cut and swing by the scrape; Invert = Alt XOR "Invert (raise ridges)" | Spaced dabs 0.06 (gives step per side) | Sphere, refine yes, back faces move | Average surface (n0; ends on zero) → Stroke direction (per side; press, previous dab, previous stroke or world-X fallback) → Stroke-start plane (form mean, least-squares normal; axes re-orthogonalised) → Pre-stroke surface (only with Stop at depth; quadric + cell-median offset, 24 points, band 0.2) | w_scrape = Distance (live) → Quartic → x Mask; w_cut = Tines (count, width, taper, tine profile Round/V/Flat/Soft, chord quartic, 1/max(0.2, chord)) → x Mask, plus the full weight for the cap; a_cut = Strength (cm) shared (integral fixed 1.2); a_scrape = Strength (fraction), gain 0.6 x Scrape | 1) Pull to plane (both sides, heights from form + cut, w_scrape, a_scrape) 2) Push along the frame normal (w_cut, a_cut; −comp, so Invert raises ridges) | Remember this stroke's moves (k, s, kept) → Stop at depth (on) / none | common rows + preset buttons, Tines, Tine width, Scrape, Taper, Invert, Stop at depth, Tine profile; tine cursor from Tines | Expressed, but Stop at depth is valid only in this arrangement (optional Pull to plane, then Push along) and reads the scrape records; it is the least modular node. Presets are tool presets. The preset light now also compares the curve (behaviour change) |
| Paint (`bz.paint`, 8) | size, size pressure 1; fraction 0.75, swing 1; Colour; Alt picks colour (eyedropper, no undo state) | Spaced dabs 0.05 | Sphere, refine yes (paint subdivides under dynamic topology) | Brush centre | Distance (live, clamp at 1) → Profile (Paint family, Default) → x Mask; amount: Strength (fraction) | Blend to colour (w x min(1, a)); channel Colour | Add each dab / commit colour | Colour, Size, both pressure rows, Strength, Spacing, Profile; action: Fill | Fill (paintAll) and the eyedropper are tool actions or Pen settings, not graph nodes. Roughness and metalness writes stay dormant |
| Paint blur (`bz.paintBlur`, 14; Paint's Shift stand-in) | size, strength and profile from the tool in hand at the press; own pressure (size 0, strength 1) | Spaced dabs 0.15 (own) | Sphere, refine yes | Brush centre | Distance (live) → Profile (the tool in hand's) → x Mask; amount: Strength (fraction) | Average with neighbours (channel colour, min(1, w·a), Jacobi) | Add each dab / commit colour | none of its own | Nothing missing |
| Masking (`bz.mask`, 10; the Ctrl stand-in) | size own 50 px (the tool in hand's in world scale); fraction 1.0 own; own pressure; Invert source Ctrl+Alt only (negative = !alt) | Spaced dabs 0.15 | Sphere, refine no | Brush centre | Distance (live) → Hardness 0.25 (power 1.5), with x Mask off; amount: Strength (fraction), uncapped | Add mask (clamp 0..1); channel Mask | Add each dab / commit material | none (as today) | The related gestures stay shell gestures, not recipes: Ctrl+click group mask, tap off the mesh to invert, Ctrl drag to zoom |
| Outside the pipeline | none | none | none | none | none | none | none | none | Select (q) and Transform (t, the three.js gizmo; matrix-only, no vertex set) stay fixed at the dock's ends. Loop mask (edge-loop walk, ring trace, flood), the whole-mask commands, poly-group commands and the unregistered vendor Transform.js are not stroke tools. A future Region sampler could host the loop mask, but it is left built-in |

## Risks

1. **Speed on the generic path.** A user-edited recipe that leaves its built-in kernel adds passes over the vertex set.
   - Mitigations:
     - built-in tools always compile to today's loops, and a test enforces it;
     - composed kernels cover the common Distance → shape → Mask chain with no extra pass;
     - scratch arrays are pooled, with no per-dab allocation;
     - the editor shows "Speed: slower (custom parts)".
   - Budget: at most 1.5x the deformation loop, measured on a ~1M-vertex mesh on the iPad with the frame meter. The deformation loop is a minority of a dab's cost; picks, normals and the octree dominate.

2. **No runtime code generation.** The CSP (`script-src 'self' 'wasm-unsafe-eval'`, report-only today) forbids eval and new Function, so a JIT compiler for graphs is ruled out for good. Every kernel variant must be written or generated at build time, which caps how freely per-vertex maths can be composed. Per-vertex expression nodes beyond Multiply are deliberately left out of v1.

3. **Two coarse nodes.** The Rake's Stop at depth and Surface smooth's Fit to the surface are expressed faithfully, but as coupled or coarse nodes, not fine-grained ones. Stop at depth reads the scrape records and works only in the Rake's arrangement. Fit to the surface keeps its own gather and grid inside. Users will not get full freedom there, and the validator has to explain why in plain words.

4. **Legacy quirks against clean presets.** Drag's one-step trail, missing pixel ratio and mirror order, Move's Alt sign, Local scale's inversion and Crease's unbounded gather must be kept as legacy flags to pass parity. Fixing them changes the feel and needs Vidar's call (open question). The flags must not leak into the editor as clutter.

5. **The id migration.** Every table keyed by enum moves to string keys:
   - dynamics, symmetry, world-scale sizes and STAND_INS
   - CURVE_TOOLS, the strength skip list and LEGACY_STRENGTH
   - TOOL_NAMES, the panel and help text
   - the scene settings in the autosave and in .bozz files

   This touches persistence and sanitize.ts, whose keys are 1-3 digits today. Old autosaves and files must keep loading, which needs revision bumps and conversion tests. Vidar's answer on whether settings live per device or per scene changes the shape of the migration.

6. **Parity test cost.** Two-way parity (the built-in kernel at tol 0, the generic path within 1e-6) doubles the fixture runs and needs each kernel's float operations kept in the same order. Without it, "every tool is a preset" would be a claim, not a fact.

7. **Stand-in coupling.** Today's implicit rules become explicit "own / the tool in hand" settings, and getting one wrong changes how Shift-smooth or Paint blur feel. The rules are: stand-ins take the tool in hand's symmetry and world size, but their own dynamics and spacing; Paint blur shares Paint's curve object. The shared "Smooth (Shift)" settings must stay one set across tools.

8. **Users can build tools that tear meshes.** Examples: uncapped pushes, Local scale with no floor, Pull to point with no limit. Guardrails:
   - node ranges clamp in the sanitizer;
   - the default caps stay on;
   - one undo per stroke stays;
   - but Bozzetto cannot make every combination safe.

9. **Scope.** The Tool editor is a large hand-built DOM job: accordion cards, pickers, long-press drag, validation and panel preview, with no UI framework. Recommendation: ship ids, slot hotkeys and the dock with built-in recipes first (build steps 1-2). The stroke path is then untouched, and the editor follows only after the runtime and parity are proven.

10. **Version debt.** User tools pin node versions, and catalogue migrations must be kept forever. A file from a newer app loads disabled rather than guessing. That is safe but can surprise someone moving between an updated desktop and an iPad on an older cached service worker.

11. **The host class.** It replaces SculptBase's sculptStroke and makeStroke for recipes, but must keep the shell's ad hoc field probes working (`_radius`, `_negative`, `_spacing`, `curve`; typeof checks in InputShell). Until the shell reads recipes directly, this is a compatibility layer to maintain.
