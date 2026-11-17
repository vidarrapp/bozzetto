# Tools built from nodes: a recipe model that rebuilds today's sculpt tools exactly, then opens them up

Paths are relative to /home/user/bozzetto. This pass only read code and git history. Nothing was edited, built or run.

## 1. The short answer

- **A tool becomes a record.** The record holds:
  - an id, a name and an icon;
  - a recipe: a small graph of coarse nodes;
  - the values of the recipe's parameters, and its presets;
  - what Shift, Ctrl and Alt do while the tool is in hand.

  The ten tools on the bar today, plus Smooth, Mask, Paint blur, Twist and Local scale, become fifteen built-in records. Their recipes rebuild today's code exactly.
- **Nodes are coarse.** A node works on a whole dab (a set of vertices, a plane, a number), never on a single vertex. The arithmetic for each vertex stays inside a few effect nodes, and those loops are today's loops, moved rather than rewritten.
  - A recipe adds a few dozen function calls per dab on top of today's work.
  - The vertex loops of the built-in tools are the same code that runs now.
- **The outline of a stroke is fixed and is not a node.** These steps always run, in this order:
  1. pick;
  2. undo snapshot;
  3. refine topology;
  4. the mirrored side;
  5. normals and octree;
  6. upload to the GPU;
  7. end of stroke.

  Nodes fill the open slots in that outline. That is why any tool a person builds stays fast, undoable and symmetric.
- **Order of work.** Each step ships on its own, and every step is checked with the parity fixtures at `--outputs --tol=0`.
  1. Tool ids and a Tool panel built from data. No visible change.
  2. The library and the dock, with Duplicate. A duplicate keeps the recipe and changes only settings, so this needs no node editor.
  3. The node runtime under the existing tools, one tool at a time. Each one is proven bit-identical before its old class is deleted.
  4. A Recipe section in the Tool panel. Each stage is picked from a list, which suits the Pencil.
  5. A node canvas with wires, last, and only if the Recipe section proves too narrow.

## 2. What in the code shapes this design

- **Every tool already has the same `stroke()` shape**, in this order:
  - the picked set;
  - intensity times pressure;
  - the proxy update;
  - `pushVertices`;
  - `dynamicTopology`;
  - the front set;
  - the frame;
  - the loop;
  - `updateGeometry`.

  See `SculptBase.js:166-195` and each override in `tools.ts`. The runtime keeps that shape. The frame, the amount, the falloff and the loop become the parts a person chooses.
- **The order of floating-point operations is part of behaviour.** `profile.ts:719-721` writes the quartic "exactly as the vendored loops write it (the order of operations is part of parity)". Products are grouped differently in different tools:
  - Clay: `min(1, curve*rate*mask)*h`.
  - Inflate: `amount*q`, then `/|n|`, then `*= mask*alpha`.
  - Crease: `vx + dx*gather + anx*crest`.

  A shared loop that groups those products another way moves vertices in the last bit. So each effect node keeps the exact expression of the loop it came from.
- **ProfileCurve already uses the trick this design generalises** (`profile.ts:649-660`). While a curve is exactly a preset's, the preset's closed form runs; the first edit switches to the baked table. In the same way, while a group of effects matches a known shape, a fused loop runs. An edit that leaves the known shapes falls back to separate passes over per-vertex buffers.
- **No generated code.** The Content-Security-Policy allows only `'self' 'wasm-unsafe-eval'` for scripts (`public/_headers:42`; it is Report-Only today and is planned to be enforced). So `new Function` is ruled out, and a shared tool file has to be data anyway. Recipes are interpreted once per dab, over kernels that ship with the app.
- **Everything is keyed by the vendor tool number:**
  - `sanitize.ts:36` accepts 1-3 digit keys;
  - dynamics, symmetry, curves, strength and spacing are stored by number;
  - so are `TOOL_NAMES` and the Tool panel's `if/else` (`SculptPanel.ts:302-394`).

  Tools that people make need string ids.
- **The check already exists.** `scripts/parity-fixtures.mjs` runs the real sources under Node and compares results at `--outputs --tol=0` (`docs/parity-fixtures.md`). It covers symmetry off and dynamic topology off only, so it has to be extended before any loop moves.
- **The icon font holds only the glyphs the source names** (`scripts/build-icon-subset.py`), so icons work offline. A user tool's icon is therefore picked from a list kept in the source, and that list is part of the subset.
- **Pencil tilt and coalesced events are never read** (a grep for them finds nothing in `src`). They are new inputs the node set can offer to new tools, but never to the built-ins.

## 3. A tool

```ts
interface ToolRecord {
  id: string;            // 'bz.clay' for a built-in, 'u.<uuid>' for one a person made
  rev: number;           // goes up on every saved change
  name: string;
  icon: string;          // a glyph from TOOL_ICONS (in the font subset)
  recipe: { builtin: string; rev: number; linked: boolean } | Graph;
  values: Record<string, number | boolean | string>;  // 'nodeId.param' -> value
  curves: Record<string, StoredCurve>;                // curvesRev 2 anchors, as today
  presets?: ParamPreset[];                            // the Rake's Fine..Scraper
  dynamics: BrushDynamics;
  symmetry: BrushSymmetry;
  shift: string | null;  // stand-in tool id: 'bz.smooth', or 'bz.paint-blur' for Paint
  ctrl: string | null;   // 'bz.mask'
  alt: 'negative' | 'pick-colour' | 'unmask' | null;
  borrows?: ('radiusPx' | 'strength' | 'curve')[];    // stand-ins only (Paint blur)
}
```

There are three kinds of tool:
- **Built-in:** a fixed recipe shipped with the app.
- **Variant:** a built-in's recipe with other values, a name and an icon. This is what Duplicate makes.
- **Made:** a tool with its own graph.

Most of what people want ("a softer clay", "a Smooth on the bar") is a variant and needs no editor.

## 4. When nodes run

### Rates

| Rate | When | What runs |
| --- | --- | --- |
| stroke | once at the press (after the pick) and at release | Strength, Negative, the press hit, seeding of the stroke's memory |
| move | once per pointer event | pressure (one value per event, as today); anchored strokes (Grab, Hold at press); screen readings (Angle around press, Sideways travel, Point on ray) |
| dab | once per dab per side | everything that turns a vertex set into a number, a direction or a plane |
| vertex | only inside the shape, limit and effect nodes, over the dab's set | the loops |

- A node's rate is the highest of its own rate and its inputs' rates.
- A slower value may feed a faster node. A faster value can feed a slower one only through a memory node, which hands out the previous dab's value. Those memory nodes are also the only place a recipe may loop back on itself.

### The fixed outline of one dab (for Spaced dabs; it mirrors `SculptBase.makeStroke` and `stroke()`)

1. Pick at the dab's screen point; gather the set (Sphere or Connected sphere); compute the picked normal.
2. If any node reads Stroke-start positions, call `updateProxy`. This comes before the undo push, as today, because the push sets STATE_FLAG.
3. Undo snapshot of the set (`pushVertices`).
4. Refine topology, if the recipe has it and the mesh is dynamic.
5. The front-facing subset, if a node asks for it.
6. The dab nodes, in sorted order. If a node returns *nothing* (no front vertices, no grip), the rest of this side's dab is skipped, with no geometry update. That is today's early return in Clay, Flatten and Polish.
7. The vertex pass: a fused loop, or separate passes.
8. `mesh.updateGeometry` after a change of shape; `updateDuplicateColorsAndMaterials` and the buffer upload after a change of colour or mask.

Then the mirrored side runs steps 1-8 with its own memory bank. It is picked on the surface the main dab left and takes the main side's radius. After all the dabs of one pointer event comes `updateRender`. At release:
- `balanceOctree`;
- `cleanNoop`;
- the stand-in tool and Negative are restored.

The other stroke nodes have outlines of their own, each taken from today's code:
- **Grab** (Move): restore both sides' rest positions, then apply both, then update both.
- **Drag along** (Drag): sub-steps along the pointer, and the mirror picked before the dab on static meshes.
- **Hold at press** (Twist, Local scale): one step per event at the press point.
- **Drag a line** (Loop mask): a preview every frame and the change at release.

### Undo

The runtime picks the kind of undo state from what the recipe writes:
- shape: StateGeometry, or StateDynamic on a dynamic mesh;
- colour or mask: StateColorAndMaterial;
- Pick colour: no state.

A recipe that writes two of these is refused in version 1.

### Compiling a recipe

A recipe is compiled when a tool is picked or edited. Never mid-stroke: `selectBrush` already refuses during a stroke. Compiling:
- checks types and rates and sorts the nodes;
- gives each dab value a slot in a `Float64Array` (two banks, main and mirror);
- takes per-vertex buffers from a pool;
- chooses the fused loop for each group of effects, by its shape;
- resolves which rows the Tool panel shows.

The result is a `Plan`: arrays of step functions bound to slot numbers. While stroking it does no map lookups, makes no closures, uses no strings and allocates nothing.

```ts
type Step = (ctx: DabContext, r: Float64Array) => boolean;  // false: nothing, skip the rest of this side's dab
interface Plan {
  stroke: StrokeKind;
  atPress: Step[]; perMove: Step[]; perDab: Step[];
  pass: FusedPass | FieldPass[];
  writes: 'shape' | 'colour' | 'mask';
  banks: [Float64Array, Float64Array];  // main, mirror
}
```

### The vertex pass

- Effects that follow each other on the same set run in one pass. Their order is the order in which their terms are added (Crease: the gather, then the crest).
- If the group's shape is known, one fused loop runs. That loop is today's code.
- Otherwise each node gets its own loop over a `Float64Array` that holds each vertex's position as doubles. The result is written to the `Float32` vertex array once, at the end.
- Today's loops also work in doubles and round to float32 only when they store. So, provided each node's expression is today's to the operation, the two paths give the same bits. That is a claim to prove, not to assume: the fixtures check both paths (section 12).

## 5. Port types

| Type | Holds | Example |
| --- | --- | --- |
| Number | a double | Strength, rate, angle |
| Yes/no | a boolean | Negative |
| Choice | an enum | Mode: Average or Surface |
| Point | a position in mesh space | Hit, area centre |
| Direction | a unit vector in mesh space | picked normal, area normal |
| Plane | a point and a normal | Clay's raised plane |
| Frame | a point, normal, across, along | the Rake's tine frame |
| Surface | a frame, a quadric and a lift | the Rake's reference for Stop at depth |
| Curve | a ProfileCurve (sample, line integral, presets) | Profile |
| Colour | linear RGB | Paint colour |
| Screen point | device px | pointer, press pixel |
| Vertices | a Uint32 index list | the dab's set and its front part |
| Per vertex | one double per vertex of a set, plus a flag for vertices the pass still works on | distance, weight, height |
| Per vertex vector | three doubles per vertex | form positions, moves |
| Positions | which positions a node reads: current, stroke start, rest or form | Distance, Height over plane |

- Any dab value may also be *nothing*.
- Screen readings carry a symmetry tag:
  - *even*: the same on both sides (Sideways travel, Left of press);
  - *odd*: negated on the mirrored side (Angle around press). Twist does this today by swapping arguments.

## 6. The nodes

**Stroke (one per tool).** These own the picking, the mirrored side and the commit.

| Node | Outputs | Used by | Parameters |
| --- | --- | --- | --- |
| Spaced dabs | Hit, Picked normal, Eye direction, Radius (local), Screen radius, Side, Press hit | every brush | Spacing (a row). Hidden: mirror after the dab (default) or before; re-pick on move |
| Grab | Press hit, Rest positions, the pointer's ray | Move | Pick once at the press, restore and reapply every move |
| Drag along | Centre (moved), Delta | Drag | Sub-step 0.15 of the radius. Hidden: ignores the pixel ratio; mirror picked before the dab |
| Hold at press | Press hit, Press pixel, Pointer, Previous pointer, Eye at press | Twist, Local scale | none |
| Drag a line | the line | Loop mask | none |
| Once | (none) | commands: Fill, mask All, Clear, Invert, Blur, Sharpen | none |

**Inputs**

- **Size:** the Size row, World-scale size, Pressure: size and Size curve. It feeds the stroke node's radius, which goes into `Picking.computeWorldRadius2`, so pressure on size works as today. Spacing still uses the radius without pressure.
- **Strength:** unit cm or fraction; default, slider maximum, typed limit, and the step for the `;` and `'` keys. Outputs the value and a local length (cm divided by the mesh's scale).
- **Pressure:** the scale is either Swing 0 to 2 (`getPressureIntensity`) or Amount 0 to 1 (`getPressureLayer`, which is 1 for a mouse or a finger). Rows: Pressure: strength and Strength curve.
- **Negative:**
  - parameters: starts on or off, follows the Negative button or only Alt, and an Invert row that is XORed in (the Rake);
  - it resolves `ctrl ? !alt : alt ? !base : base` at the press (`InputShell.ts:1485-1493`).
- **Colour.**
- **Point on ray:** the closest point on the current ray to an anchor.
- **Left of press.**
- **Angle around press:** a 30 px dead zone; odd.
- **Sideways travel:** px since the last event.
- **Pen tilt** (new; no tool uses it today): altitude and azimuth.
- **Glue:** Number, Add, Subtract, Multiply, Divide, Min, Max, Clamp, Negate if, Choose, Scale, Length, Normalize, Cross, Tangent part.

**Amount**

- **Step from last dab:** remembered per side and seeded at the press; the distance is held to the radius (DabSteps).
- **Curve integral:** `max(1e-3, lineIntegral)`, cached by the curve's revision.
- **Stroke share:** S·p/scale·step/(I·r). Used by Inflate, Crease and the Rake.
- **Clay rate:** min(cap, gain·S·(spacing/0.1)/I/r)·p. Gain 1.5 and cap 0.5 are hidden.
- **Cap at 1.**

**Area (vertex sets)**

- **Sphere:** octree, Euclidean, hidden groups left out.
- **Connected sphere:** the topological walk.
- **Refine topology.**
- **Facing the view.**
- **Whole object, Group, Masked part:** for commands only.
- **Edge loop side:** walks the loop, else traces the ring, else takes the plane's half.

**Reference**

- **Area normal:** gives *nothing* at length 0.
- **Area centre.**
- **Raise plane:** point plus normal times height times the radius, its sign flipped by Negative.
- **Plane grip:** a band, a facing gate, a minimum number of inliers, then a refit. Gives a plane or *nothing*.
- **Hold normal:** memory per side; blends with stickiness.
- **Stroke axes:** memory per side; falls back to the last stroke's across, then to world X or Y.
- **Fit plane to form.**
- **Fit reference surface:** a quadric, a robust upper offset and a band.
- **Glue:** Make plane, Make frame.

**Memory**

- **Stroke-start positions:** the vendor proxy, set at first touch.
- **Rest positions:** Move's snapshot at the press.
- **Stroke moves:** what this stroke moved each vertex by, plus the position it left the vertex at. It stays correct through dynamic topology because the stored position is compared bit for bit (StrokeMoves). Its output, Form, is the position with this stroke's moves taken back out.
- **Stroke record:** extra numbers kept per vertex for this stroke (the Rake's scrape and "kept").

**Shape (per vertex)**

- **Distance:**
  - parameters: from a point, using a Positions source;
  - at the rim: skip, clamp at 1 (Paint) or no test (Pinch).
- **Falloff:** Quartic, Quartic to a power, Soft edge (1-d)^e, Curve, or Even.
- **Curve:** a profile curve with a family of presets.
- **Mask.**
- **Tines:** count, width, taper and curve; outputs the share and the full depth.
- **Along the chord.**
- **Height over plane.**
- **Glue:** Multiply, Clamp.

**Limit**

- **Stop at depth:** a floor or ceiling taken from a reference surface. It clamps the next push.
- **Cap at 1.**

**Effects (per vertex)**

| Effect | Inputs | Used by |
| --- | --- | --- |
| Push along | Direction, Weight, Amount | Crease crest, Rake cut |
| Push along vertex normal | Weight, Amount (divides by \|n\|) | Inflate |
| Pull to plane | Plane, Weight, Rate; parameters Side (below, flipped by Negative; or both), Band, Facing gate, Heights from (current or form), Cap at plane | Clay, Flatten, Polish, Rake scrape |
| Pull to point | Point, Weight, Amount, Positions | Pinch, Crease gather |
| Translate | Vector, Weight; from current or rest positions | Move, Drag |
| Rotate | Axis, Centre, Angle, Weight | Twist |
| Scale about | Centre, Factor, Weight | Local scale |
| Average neighbours | Weight; channel shape, colour or mask; always capped at 1 | Smooth (Average), Paint blur, the mask's Blur |
| Fit to surface | Weight, Relax | Smooth (Surface) |
| Blend colour | Colour, Weight | Paint |
| Pick colour | Hit | Paint with Alt |
| Add to mask | Weight, sign | Mask |
| Set mask | Vertices, value | Loop mask, Ctrl+click on a group |
| Mirror by position | Vertices in, vertices out | the loop mask's mirror |

Every effect weighs by the mask; only effects that write the mask leave it out.

The commit steps are not nodes: Undo snapshot, Update normals and octree, Upload, End of stroke.

Effects that move toward a target (Average neighbours, Pull to plane) keep their cap at 1. Overshooting is never meaningful (the comment on StableSmooth explains why), and a cap a person could switch off would let a tool blow the mesh apart.

## 7. Memory nodes and their lifetimes

| Node | Kept | Lasts | Today |
| --- | --- | --- | --- |
| Step from last dab | per side | a stroke, seeded from the press | DabSteps |
| Hold normal | per side | a stroke | Polish `held.main` and `held.sym` |
| Stroke axes | per side | the last dab within a stroke; the across axis lasts as long as the tool | Rake `prev`, `fromPress`, `prevAcross` |
| Stroke-start positions | per vertex, shared by both sides | a stroke | the vendor proxy and STATE_FLAG |
| Rest positions | per side | a stroke | Move `vProxy` |
| Stroke moves, Stroke record | per vertex, shared | a stroke, and only while the stored position still matches | StrokeMoves, `scraped` |

- Reading a memory node gives the previous value. Writing to it takes effect at the end of the dab.
- Tables kept per vertex belong to a pool for each mesh in the runtime, not to each tool. Only one tool strokes at a time, and a stroke id tells their entries apart. So ten made tools do not each hold their own copy of a table that is about 28 MB on a 1M-vertex mesh.

## 8. Pressure and the modifier keys

- Pressure is a node per use. The Rake uses two on the one strength channel: Amount for the cut, and Swing times 0.6 for the scrape.
- The size channel lives in Size and is applied at pick time, as today.
- The dynamics entry is still keyed by the tool that is stroking (`InputShell.ts:482`). So stand-ins keep their own entries (Smooth, Mask, Paint blur), exactly as now.
- The modifier keys stay at tool level, outside recipes:
  - Shift: the tool's `shift` stand-in;
  - Ctrl: `ctrl` (Mask);
  - Ctrl+Shift: the loop mask;
  - Alt: the tool's `alt` action.
- A stand-in borrows from the brush in hand:
  - always its symmetry;
  - its world size, in world scale;
  - for Paint blur, also Paint's px radius, strength and curve object (`InputShell.ts:1447-1463`).
- Stand-ins become ordinary library tools. A Smooth placed on the bar uses its own Size, Pressure and Spacing rows, which today never appear. On an iPad without a keyboard this is the only way to reach Smooth or Mask: the 2026-11-11 decision says hold-to-modify buttons cannot be done in the web app.

## 9. Parameters in the Tool panel

Each recipe lists the parameters it shows:

```ts
interface Shown {
  param: string;                 // 'pinch.amount'
  label: string;                 // plain words: 'Pinch'
  kind: 'range' | 'choice' | 'check' | 'curve' | 'presets' | 'colour' | 'button';
  min?: number; max?: number; step?: number;
  typedMin?: number; typedMax?: number;
  unit?: 'cm' | 'px' | 'fraction' | 'deg';
  showWhen?: { param: string; op: '>' | '==' | '!='; value: number | string | boolean };
}
```

- **The rows at the head come from the standard nodes, in today's order:**
  1. World-scale size, Size, Pressure: size and Size curve (shown only when the amount is above 0);
  2. Strength, Pressure: strength and Strength curve;
  3. Spacing.

  The tool's own rows follow, in the order the recipe lists them.
- **The two groups below them depend on the tool:**
  - the Smooth (Shift) group shows when the tool's Shift stand-in is a Smooth;
  - the Symmetry section shows for every brush.
- **What goes away:** this replaces the `if/else` in `SculptPanel.refreshBrush`, and the `typeof` probes in InputShell become questions to the recipe.
- **Every shown value is saved.** That also fixes the four knobs that are not saved today: Move's falloff, Crease's Pinch, and Polish's Plane lock and Build-up.

## 10. Presets

- **Curve presets** stay as they are: the ProfileCurve families and their exact kernels.
- **Parameter presets** are `{ id, label, values, curvePresets }`, and a preset's button is lit while the values match. The Rake's Fine, Comb, Coarse, Chisel and Scraper move over unchanged. Today the profile curve is not compared, so editing the tine curve leaves the button lit; that is kept unless Vidar decides otherwise.
- **A variant** is a whole-tool preset that has been given a name, an icon and a place in the library.

## 11. Performance guarantees

| | Guarantee | Gate |
| --- | --- | --- |
| G1 | The built-in tools run fused loops: the vertex code is the code running today | parity at tol 0; the latency suite's "stroke steps per mesh size" within 2% at 1M vertices on iPad, and at the desktop sizes |
| G2 | The work per dab is a few dozen calls bound to slots, well under 0.1 ms per pointer event | as G1 |
| G3 | The runtime allocates nothing per dab. Registers and field buffers grow at stroke start (×1.25 + 64, as `StrokeMoves.ensure` does) and are kept. The vendor's own allocations stay as today | allocation check in the latency suite |
| G4 | Compiling takes 2 ms or less and never happens during a stroke. An edit made mid-stroke waits for the release | unit timing |
| G5 | Limits: 64 nodes, 4 effects per pass, 8 curves; Whole object only with Once | sanitiser |
| G6 | Separate passes (made tools only) stay within 1.3× the vertex-loop time of the nearest built-in. The editor shows the last stroke's ms per dab next to Standard's, and marks a tool as slow when it is over that | latency suite, run on made tools too |

- Everything stays on the main thread, as today. Each dab has to pick the surface the previous dab left, and the mesh lives on the main thread, so a round trip to a worker would only add latency.
- WebAssembly is allowed by the CSP and is a later option for the separate passes. It is not needed for parity.
- Memory for separate passes is about 4 MB at roughly 10 fields for a 50k-vertex dab, which is fine on an iPad.

## 12. Keeping today's tools identical

1. **The runtime re-hosts the same code.**
   - Stroke nodes are `SculptBase.sculptStroke` and `makeStroke`, and the Move, Drag, Twist and LocalScale overrides, moved into place.
   - Picking, StateManager, `Mesh.updateGeometry` and the Tablet getters are not touched.
2. **Each effect, shape and reference node is the loop or function it came from, moved word for word.**
   - Its reference expression is written into the node's specification.
   - The fused path and the separate-pass path both implement that expression.
3. **Extend the fixtures before anything moves.** Today they cover none of these, so add each, recorded with the current code:
   - symmetry on (mirror after the dab, and Drag's before);
   - dynamic topology on;
   - Negative on;
   - mouse pressure;
   - world scale;
   - the Shift and Ctrl swaps;
   - Twist and Local scale.
4. **Port one tool per change, compared three ways at tol 0:**
   - the old class;
   - the recipe with its fused loop;
   - the recipe forced to separate passes (a test flag).

   Then delete the class. `--outputs` already exists for changes that rename knobs but must not move a vertex.
5. **Quirks are kept as hidden parameters named for what they do:**
   - Drag's sub-step ignores the pixel ratio and picks the mirror before the dab;
   - Pinch has no test at the rim;
   - Local scale has no floor;
   - Polish does not re-pick before an update (the old Twist slot);
   - the stand-ins keep their own dynamics.

   They are never shown in the panel.
6. **The values the tests read stay readable.** The recorders that tests and the parity script read (`lastDab`, `lastStrengthDab`, `lastRate`) become one debug recorder that each node writes into, only while it is switched on.

## 13. Saving, versions and files

### Ids

Built-in tools get string ids, each mapped to its vendor enum: `bz.crease`, `bz.move`, `bz.clay`, `bz.inflate`, `bz.pinch`, `bz.flatten`, `bz.rake`, `bz.drag`, `bz.polish`, `bz.paint`, `bz.smooth`, `bz.paint-blur`, `bz.mask`, `bz.twist`, `bz.local-scale`. Made tools are `u.<uuid>`, from `crypto.randomUUID`, which works offline.

### The scene record (SculptSettings, new fields)

- `tools: { [id]: { rev, values, curves, dynamics, symmetry, radius, spacing, strength } }` and `toolsRev: 1`.
- The existing numeric tables (radius, dynamics, spacing, curves, strength, rake, smooth, symmetry) are still written for the built-ins. An installed iPad app can be a version behind and still has to read a newer scene's brush settings. The old revision fields (SPACING_REV, STRENGTH_REV, PROFILE_REV, SMOOTH_REV) are read as before.
- A scene carries the full records of the variants and made tools it holds settings for, so the work opens the same anywhere. On opening a scene that holds a tool this device lacks, the app offers "Add to library".
- The autosave contract stays: nothing runs during a stroke; a change only marks the scene dirty.

### On the device

- IndexedDB holds a store of ToolRecords.
- `deviceStore` holds `bozzetto-dock` (tool ids, at most 10) and `bozzetto-library` (order and groups).
- Both follow the device-storage choice. With saving off, the library lives only for the session, and the app says so.

### Versions

1. **The file envelope** has `formatVersion`. A later major version is not run. The tool is kept as "Needs a newer Bozzetto", with its JSON intact so that exporting it again loses nothing.
2. **Node types are `name@major`.** A major version's behaviour is fixed for good, and old majors stay registered with their kernels, as preset kernels are kept today. A new optional parameter whose default reproduces the old behaviour does not need a new major.
3. **Each built-in recipe has a `rev`**, plus migrations that carry values across renamed nodes. A linked variant follows its built-in's newer revisions. A made tool is frozen: it names node majors, so it keeps behaving as it did. Whether variants should follow is a question for Vidar.
4. **A content hash** (SHA-256 of the canonical JSON, through `crypto.subtle`) catches duplicates on import and tells an edited copy from the same tool.

### Files

- The format is `.bztool`, JSON holding one tool or several.
- **Export:** File > Export tool…, or from a tool's menu. On iPad it uses `navigator.share({ files })` (AirDrop, Files); elsewhere a download. All offline.
- **Import:** File > Import…, dragging a file onto the window on a desktop, or a `.bozz` that carries tools.
- **Checks on import,** like `sanitize.ts`:
  - every value is held to its parameter's range;
  - the limits in G5 apply;
  - names are at most 200 characters;
  - an icon outside TOOL_ICONS falls back to the icon of the tool it was made from;
  - the file is data only.

```json
{
  "format": "bozzetto-tool", "formatVersion": 1,
  "tools": [{
    "id": "u.0b7d4c1e-5a9f-4e7b-9a51-3f6c2d8e1a44", "rev": 3, "hash": "sha256:…",
    "name": "Soft inflate", "icon": "fi-ss-expand-arrows-alt",
    "recipe": { "nodes": [
      { "id": "dabs",   "type": "spaced-dabs@1", "params": { "spacing": 0.15 } },
      { "id": "sphere", "type": "sphere@1", "in": { "centre": "dabs.hit", "radius": "dabs.radius" } },
      { "id": "refine", "type": "refine-topology@1", "in": { "set": "sphere.set" } },
      { "id": "start",  "type": "stroke-start-positions@1", "in": { "set": "refine.set" } },
      { "id": "step",   "type": "step-from-last-dab@1", "in": { "hit": "dabs.hit", "radius": "dabs.radius" } },
      { "id": "str",    "type": "strength@1", "params": { "unit": "cm", "value": 0.3 } },
      { "id": "press",  "type": "pressure@1", "params": { "scale": "amount" } },
      { "id": "share",  "type": "stroke-share@1", "params": { "integral": 1.2 },
        "in": { "strength": "str.local", "pressure": "press.value", "step": "step.value", "radius": "dabs.radius" } },
      { "id": "neg",    "type": "negative@1" },
      { "id": "amt",    "type": "negate-if@1", "in": { "value": "share.value", "if": "neg.on" } },
      { "id": "dist",   "type": "distance@1",
        "in": { "set": "refine.set", "from": "dabs.hit", "radius": "dabs.radius", "positions": "start.positions" } },
      { "id": "fall",   "type": "falloff@1", "params": { "shape": "curve", "presets": "clay", "preset": "soft" }, "in": { "d": "dist.d" } },
      { "id": "push",   "type": "push-along-vertex-normal@1", "in": { "set": "refine.set", "weight": "fall.w", "amount": "amt.value" } }
    ],
    "shown": [ { "param": "fall.curve", "label": "Profile", "kind": "curve" } ] },
    "values": {}, "dynamics": { "size": { "amount": 0, "curve": "linear" }, "strength": { "amount": 1, "curve": "soft" } },
    "symmetry": { "on": true, "axis": "x" }, "shift": "bz.smooth", "ctrl": "bz.mask", "alt": "negative"
  }]
}
```

## 14. Editing on an iPad with the Pencil

### The Recipe section (the first editor)

It is a folded section at the foot of the Tool panel, also reached from the tool's menu (Edit recipe).

- **Stages run top to bottom, in plain words:** Stroke, Area, Reference, Amount, Shape, Effects, Limit.
  - Each stage is one card: the node's name on a select-like button, then its parameters as the panel's usual compact rows. Pencil scrub, typed values and the curve editor all work there.
- **Tapping the name lists the nodes that fit that stage**, each with one plain line (for example "Area plane: the average plane of the surface under the brush"). Picking one swaps it in, and its inputs connect by type.
- **Wiring is done by choosing.** Where more than one value fits, the input shows a small "from" select listing the matching values upstream. For example, Direction: Picked normal, Area normal, Plane normal or View. Drawing lines with a Pencil on a small canvas is the hard part, and this removes it.
- **Effects:**
  - the Effects stage holds one to four effects, in order, and "Add effect" appends one;
  - a long press (600 ms, the Negative button's LATCH_MS) lifts a card so it can be reordered;
  - dragging it off the panel removes it, the same gesture as the dock.
- **Each parameter row has a "Show in Tool panel" switch,** lime while on.
- **A Values switch** prints each node's outputs from the last dab in Martian Mono, live while stroking, for tuning.
- **Trying a change:**
  - edits apply from the next stroke, and the model stays on screen, so trying a change takes one stroke;
  - mesh Undo takes the test stroke back;
  - recipe edits have their own Undo and Redo in the section's heading.
- **Built-ins are read-only.** Editing one offers "Duplicate to edit".

### The node canvas (later, optional)

It opens as a window over the viewport: the Raised surface, #333 with a 1px #555 border. It shows the same data as nodes and wires.

- **Hands and inputs:**
  - the Pencil moves nodes and draws wires from port to port;
  - one finger pans and two fingers zoom;
  - Pencil hover on iPad Pro, and mouse hover, show a port's type and last value.
- **Drawing a wire:**
  - while it is drawn, the ports that accept it light lime and the rest dim;
  - letting go on empty canvas opens the node list filtered to what fits, with a search field that Scribble can write into;
  - dropping a node on a wire splices it in.
- **Selecting and moving nodes:**
  - a tap selects a node (an orange outline, the one focus), and its parameters show in a strip at the side;
  - a long press lifts it, and dragging it off the window deletes it.
- **Ports show their type by shape,** because colour is reserved:
  - circle: a number;
  - triangle: a point or direction;
  - diamond: a plane, frame or surface;
  - square: a value per vertex;
  - half circle: yes/no;
  - wave: a curve.

  Type names are set in Martian Mono.
- **Look:**
  - nodes use the Panel surface (#2c2c2c), with square corners and titles in Familjen Grotesk;
  - each node carries a small tag naming its rate;
  - wires are 1.5 px grey.
- **Build:**
  - hand-built DOM with one SVG layer for the wires, as BrushCursor already is;
  - input handling copies the Negative button: preventDefault on touchstart, event timestamps, and no pointer capture for touch on Safari.

## 15. What the library and dock need from this

- **The dock stores tool ids.**
  - Its slots are new keymap actions `slot.1` to `slot.10`, with default keys 1-9 and 0.
  - Select (q) and Transform (t) stay fixed at the two ends; they are modes, not library tools.
  - Badges, tooltips and the help text read `keymap.chordFor('slot.N')`. The help's "Default hotkey: **N**" and the e2e lookups by badge text (`tests/e2e/smoke.mjs:3545-3564`) change first.
- **The per-tool actions (`tool.crease` and the rest) stay, unbound by default.** They are for people who want a key on a tool wherever it sits. An existing rebind of one carries over to it.
- **The library holds:**
  - the ten built-ins, plus Smooth, Mask, Paint blur, Twist and Local scale;
  - variants and made tools;
  - grouped as Shape, Surface, Grab, Paint and mask, and Mine.
- **Tapping an entry makes it the tool in hand,** even if it is not on the bar. It then has no slot and no digit.
- **The library opens from** a Library button in the Tool panel's heading, and from the menu strip.
- **One gesture language everywhere:** a long press lifts, dragging off removes. It works the same in the dock, the library, the Recipe's effects and the canvas.

## 16. Order of work, with the check for each step

**Phase 0: ids and a Tool panel built from data (nothing visible changes)**
- A ToolDef registry with the string ids.
- A parameter schema on each current class; SculptPanel builds its rows from the schema.
- A per-tool settings record, with the numeric tables still written.
- The `slot.N` actions; badges and help read from the keymap; the e2e suite finds buttons by `data-tool`.
- Checks:
  - parity `--verify --outputs --tol=0` unchanged;
  - the profileCurves, strengthCm, tineRake and smoke suites pass;
  - a scene saved by the new build opens in the previous build with the same brush settings.

**Phase 1: library, dock and variants (still the current classes)**
- The dock record and its gestures: reorder, insert, and drag off to remove. The hotkeys follow the order.
- The library window.
- Duplicate: a new instance of the same class, registered at a runtime index of 15 or above, with its own values. This needs a tagged vendor edit so that `canBeContinuous` asks the tool instead of switching on the enum.
- Rename, and an icon from TOOL_ICONS.
- Variants saved, carried in scenes and `.bozz` files, and exported and imported as `.bztool`.
- Smooth, Mask, Paint blur, Twist and Local scale can go on the bar.
- Checks: touch e2e for the dock gestures (no pointer capture on Safari); a variant's fixtures equal its base's at equal values.

**Phase 2: the runtime under the classes (nothing visible changes)**
- 2.0: Extend the fixtures (section 12).
- 2.1: GraphTool extends SculptBase. Spaced dabs is moved over word for word.
- 2.2: One tool per change, simplest first:
  1. Pinch, Flatten, Inflate, Clay (no memory per side);
  2. Paint, Mask, Paint blur (colour and mask writes);
  3. Smooth: Average, then Surface;
  4. Crease (DabSteps and two effects);
  5. Polish (held normal, grip);
  6. Twist, Local scale, Drag, Move (the other stroke nodes);
  7. the Rake last (StrokeMoves, Stroke record, levels, presets, cursor tines).
- Each change is checked three ways at tol 0 and against the latency suite (G1), then its class is deleted.

**Phase 3: the Recipe section**
1. First read-only ("How this tool works").
2. Then swapping a node within a stage, the "from" inputs, Show in Tool panel, and saving made tools.

**Phase 4: the node canvas.** Only if Phase 3 proves too narrow.

**Phase 5: new inputs as opt-in nodes for new tools only.** Pen tilt, and later coalesced pointer events (they would change sampling, so never on built-ins).

## 17. Open questions for Vidar

This pass was read-only, so these are not yet in docs/HANDOFF.md as CLAUDE.md asks. The next step should add them under "## Open questions for Vidar" and push:

- [ ] 2026-11-14: Tools made with Duplicate: follow later fixes to the built-in they came from (as Clay changed on 2026-11-10), or stay exactly as they were made (blocks: Duplicate in the tool library)
- [ ] 2026-11-14: Smooth, Mask and Paint blur as library tools that can go on the tool bar, so an iPad without a keyboard can reach them; or keep them on Shift and Ctrl only (blocks: nothing)
- [ ] 2026-11-14: Twist and Local scale (in the engine, unreachable today) in the library: yes or no (blocks: nothing)
- [ ] 2026-11-14: Move's "Pressure: strength" row does nothing (Move reads pressure only for its size). Drop it when Move's rows come from its recipe, or keep it (blocks: Phase 0 of the tool library)
- [ ] 2026-11-14: Building tools: a Recipe section in the Tool panel first, choosing each part from a list, with the wired node canvas later or never; or the node canvas from the start (blocks: Phase 3)
- [ ] 2026-11-14: The old clay layer (one exact layer over the surface the stroke started on, removed 2026-11-10) as a library tool "Clay layer" beside Standard: yes or no (relates to the open clay question of 2026-11-10)
- [ ] 2026-11-14: A Rake preset's button stays lit after its tine profile is edited (only the knobs are compared). Keep that, or count the profile too

## Coverage

Rows follow the node names in section 6. In "Rows", "the usual head" means Size, Pressure: size, Strength, Pressure: strength and Spacing. Every brush also gets the Symmetry section, and, where its Shift stand-in is Smooth, the Smooth (Shift) group.

| Tool | Recipe, node by node | What cannot be expressed |
| --- | --- | --- |
| **Standard (clay)** `bz.clay` | **Stroke and area:** Spaced dabs (Spacing 0.1); Sphere; Refine topology; Facing the view (used only for the fit).<br>**Reference:** Area normal on the front set (*nothing* skips the dab); Area centre on the front set; Negative; Raise plane (centre + normal × 0.1 × Radius, sign by Negative).<br>**Amount:** Strength (cm, 1.5) to a local length; Pressure (Amount 0 to 1); Curve (Clay family, Plateau); Curve integral; Clay rate (gain 1.5 and cap 0.5 hidden, × Spacing / 0.1).<br>**Shape:** Distance (from Hit, current positions, skip at the rim); Falloff (Curve); Mask.<br>**Effect:** Pull to plane (every picked vertex, front or not; Side below, flipped by Negative; weight min(1, curve × rate × mask) × height; skipped when rate ≤ 0).<br>**Rows:** the usual head, then Profile. | Nothing.<br>The vendor's plain-brush branch is unreachable today and is not ported; if wanted it is Push along (Picked normal).<br>Today's only cap is the rate cap. The layer cap removed on 2026-11-10 is expressible as a variant: Stroke moves, then Fit plane to form, then Raise plane by Strength, then Pull to plane at full rate, recording into Stroke moves. |
| **Inflate** `bz.inflate` | **Stroke and area:** Spaced dabs (0.15); Sphere; Refine topology.<br>**Memory:** Stroke-start positions (proxy before the undo push); Step from last dab (per side, from the press).<br>**Amount:** Strength (cm, 0.5); Pressure (Amount); Stroke share (integral 1.2); Negative to Negate if.<br>**Shape:** Distance (Hit, stroke-start positions); Falloff (Quartic); Mask.<br>**Effect:** Push along vertex normal (amount × w, divided by \|n\|, × mask).<br>**Rows:** the usual head. | Nothing. |
| **Crease** `bz.crease` | **Stroke and area:** Spaced dabs (0.05); Sphere; Refine topology.<br>**Memory and reference:** Stroke-start positions; Picked normal; Step from last dab.<br>**Amount:** Strength (cm, 0.75); Pressure (Amount; Size pressure 1 by default); Curve (Crease family, Sharp); Curve integral; Stroke share; Negative to Negate if, on the crest only; Number Pinch 0.625, so gather = share ÷ Radius × Pinch.<br>**Shape:** Distance (Hit, stroke-start positions).<br>**Effects, in this order:** Pull to point (Hit, from stroke-start positions, Quartic × mask × gather), then Push along (Picked normal, Curve × mask × ±share).<br>**Rows:** the usual head, Profile, Pinch. | Nothing. The gather's lack of a clamp is kept. |
| **Flatten** `bz.flatten` | **Stroke and area:** Spaced dabs (0.15); Sphere; Refine topology; Facing the view.<br>**Reference:** Area normal (*nothing* skips); Area centre.<br>**Amount:** Strength (fraction 0.75) × Pressure (Swing), then Cap at 1; Negative (starts on).<br>**Shape:** Distance (Hit, current positions); Falloff (Quartic).<br>**Effect:** Pull to plane (Side below, flipped by Negative, so by default the high side is shaved; -n·s·q·k·mask·alpha).<br>**Rows:** the usual head. | Nothing. The dead proxy branch is dropped. |
| **Polish** `bz.polish` | **Stroke and area:** Spaced dabs (0.15; hidden: no re-pick before an update, the old Twist slot's); Sphere; Refine topology; Facing the view.<br>**Reference:** Hold normal (Plane lock 0 to 0.95, per side), seeded on the first dab by Area normal; Area centre as the seed point; Plane grip (band 0.25 × Radius, facing gate 0.5, at least 8 inliers; *nothing* skips), whose normal is written back into Hold normal.<br>**Amount:** Strength (fraction 0.9) × Pressure (Swing); Number Build-up 0.8; Curve (Polish family, Default).<br>**Shape:** Distance (Hit, current positions).<br>**Effect:** Pull to plane (Side both, or above only while Negative; band; facing gate; fraction min(1, gain × intensity × curve × mask)).<br>**Rows:** the usual head, Plane lock, Profile, Build-up. | Nothing. The one loop in the recipe runs through Hold normal, a memory node. |
| **Pinch** `bz.pinch` | **Stroke and area:** Spaced dabs; Sphere; Refine topology.<br>**Amount:** Strength (0.75) × Pressure (Swing) × Number 0.05, then Negate if Negative.<br>**Shape:** Distance (Hit, current positions, no rim test, hidden); Falloff (Quartic).<br>**Effect:** Pull to point (Hit, current positions; (c - p) × q × k × mask × alpha).<br>**Rows:** the usual head. | Nothing. The uncapped gain is kept. |
| **Smooth (Average and Surface)** `bz.smooth` | **Stroke and area:** Spaced dabs (0.15, its own); Sphere, with no Refine topology.<br>**Amount:** Strength (0.75) × Pressure (Swing, its own dynamics entry).<br>**Choice Mode:**<br>- Average: Cap at 1, then Average neighbours (shape; even weight × mask; Jacobi; the boundary and valence rules).<br>- Surface: Fit to surface (min(1, strength × P) × mask; Relax 0.25).<br>**Stand-in:** for Shift from every brush but Paint; borrows symmetry, and world size in world scale.<br>**Rows:** Strength, Mode, Relax (Surface only). They show in the Smooth (Shift) group, or as Smooth's own panel when it is on the bar. | Fit to surface stays one coarse node: its wide gather, grid, PCA, quadric and relax are not split, because splitting would gain nothing and cost speed. Smooth's own Size, Pressure and Spacing rows become reachable when it is on the bar. |
| **Move (VolumetricMove)** `bz.move` | **Stroke:** Grab (Connected sphere at the press; rest snapshot; every move restores then reapplies, both sides restored before either applies).<br>**Reference:** Point on ray (anchor Press hit), minus Press hit; Strength (fraction 0.25) to Scale; Negative to Choose: Picked normal (re-read every move) × Length × (Left of press ? -1 : 1).<br>**Shape:** Distance (Press hit, rest positions); Falloff (Quartic to a power: "Falloff (sharp-soft)" 0.3 to 1); Mask.<br>**Effect:** Translate (from rest positions).<br>**Rows:** Size, Pressure: size, Strength, Falloff. | Nothing.<br>The recipe has no Pressure on strength, so today's "Pressure: strength" row, which has no effect, would not appear (open question).<br>Falloff becomes saved. |
| **Drag** `bz.drag` | **Stroke:** Drag along (sub-steps 0.15 × px radius; hidden: ignores the pixel ratio, samples from the previous position, mirror centre re-seeded from the main centre, mirror picked before the dab on static meshes).<br>**Area:** Sphere at the moved centre; Refine topology.<br>**Shape:** Distance (centre, current positions); Falloff (Quartic); Mask.<br>**Effect:** Translate (Delta; no strength).<br>**Rows:** Size, Pressure: size. | Nothing. The quirks are kept, hidden. |
| **Twist** `bz.twist` (in the engine, unreachable today) | **Stroke:** Hold at press.<br>**Area:** Sphere at the press hit, re-gathered every move; Refine topology.<br>**Reference:** Eye at press, then Negate, as the axis; Angle around press (dead zone 30 px; odd).<br>**Shape:** Distance; Falloff (Quartic); Mask.<br>**Effect:** Rotate (axis through the press hit, angle × w). | Nothing. |
| **Local scale** `bz.local-scale` (unreachable today) | **Stroke:** Hold at press.<br>**Area:** Sphere; Refine topology.<br>**Amount:** Sideways travel × 0.01.<br>**Shape:** Distance; Falloff (Quartic); Mask.<br>**Effect:** Scale about (press hit). | Nothing. The missing floor is kept; a made tool can add Clamp. |
| **Rake, tines, scrape and presets** `bz.rake` | **Stroke and area:** Spaced dabs (0.06); Sphere; Refine topology; Facing the view.<br>**Reference:**<br>- Area normal (*nothing* skips).<br>- Stroke axes (per side; the first direction from the press; fallback the last stroke's across, then world X or Y; the across axis lasts as long as the tool).<br>- Stroke moves, giving Form on the front set; Fit plane to form (*nothing* skips); Make frame re-tangents the axes to it.<br>- Stroke record (scrape xyz, kept).<br>- Fit reference surface (only with Stop at depth and depth > 0; at least 24 vertices, otherwise the plane; N × N cell medians; band 0.2).<br>**Amount:** Strength (cm) × Pressure (Amount) ÷ scale gives the depth; Pressure (Swing) × 0.6 gives the scrape intensity; Step from last dab ÷ (1.2 × R) gives the spacing factor; Negative XOR Invert gives the side; Curve (Tine family).<br>**Shape:** Distance (Hit, current positions; the pass also skips vertices with mask ≤ 0).<br>**Pass, in this order:**<br>1. Pull to plane (the scrape: both sides, heights from Form, rate min(1, scrape × quartic × intensity × mask), recorded in Stroke record).<br>2. Tines (Count, Width, Taper) × Along the chord, giving the share and the full depth.<br>3. Stop at depth (floor, or ceiling for ridges).<br>4. Push along (plane normal, -side × share, recorded in Stroke moves).<br>**Presets:** Fine, Comb, Coarse, Chisel, Scraper (knobs, strength and tine-curve preset). Tines also draws the cursor's tine circles, and Stroke axes gives the hover axis.<br>**Rows:** the usual head, Presets, Tines, Tine width, Scrape, Taper, Invert, Stop at depth, Tine profile. | Expressible. This pass most needs its fused loop for speed (five separate passes otherwise). The single shared `lastDab` recorder is kept. |
| **Paint** `bz.paint` | **Stroke and area:** Spaced dabs (0.05); Sphere; Refine topology (on a dynamic mesh painting refines, as today).<br>**Amount:** Strength (0.75) × Pressure (Swing; Size pressure 1), then Cap at 1; Colour; Curve (Paint family, Default).<br>**Shape:** Distance (Hit, clamp at 1); Mask.<br>**Effect:** Blend colour.<br>**Alt:** Pick colour (no undo; picks at the press and on every move). Shift stand-in: Paint blur. Fill is a command: Once + Whole object, weight = mask.<br>**Rows:** Colour, then the usual head, Profile; no Smooth group. | The roughness and metal writes, switched off today, are not in Blend colour version 1. |
| **Paint blur** `bz.paint-blur` | **Stand-in:** for Shift over Paint; borrows Paint's px radius, strength and curve object.<br>**Stroke and area:** Spaced dabs (0.15, its own); Sphere; Refine topology.<br>**Amount:** Pressure (Swing; its own entry, size 0).<br>**Shape:** Distance; Falloff (Paint's Curve) × strength × P × mask, then Cap at 1.<br>**Effect:** Average neighbours (colour, from the colours as they were before the dab). | Nothing. |
| **Mask stroke** `bz.mask` | **Stand-in:** for Ctrl.<br>**Stroke and area:** Spaced dabs (0.15); Sphere, with no Refine topology.<br>**Amount:** Negative (Alt only, so Ctrl masks and Ctrl+Alt unmasks); Strength 1 (not shown, not saved) × Pressure (Swing, its own entry).<br>**Shape:** Distance; Falloff (Soft edge, exponent 1.5).<br>**Effect:** Add to mask (±, clamped 0 to 1).<br>Ctrl+click on a group is Set mask on Group, in the same undo state. | The tap off the mesh (invert) and Ctrl+drag (zoom) stay gestures of the shell, not recipe parts. |
| **Loop mask** | **Stroke:** Drag a line (a preview every frame, the change at release, nothing on pointercancel).<br>**Area:** Edge loop side (walk the loop, else trace the ring, else take the plane's half; cached per mesh); Mirror by position (when symmetry is on).<br>**Effect:** Set mask (0, or 1 with Alt). | Only as one coarse node: it is an algorithm over topology, not a rule per vertex. Its floods ignore hidden groups, as today. |
| **Mask commands, Fill, groups as selection** | Once + Whole object, Group or Masked part.<br>Effects: Average neighbours (mask) for Blur, Set mask for All, Clear and group mask, Invert, and a threshold for Sharpen. | They stay commands in the Model panel, not library tools. Extract and making groups stay commands. |
| **Select, Transform gizmo** | Not tools in this sense: object matrices through three's TransformControls, no vertex set, and an undo of their own. They stay fixed at the two ends of the dock. | Not expressible, and they don't need to be. The vendor Transform's matrix blend could become an Apply matrix effect; no current tool needs one. |
| **Shared machinery** | These are tool-level settings, not nodes:<br>- symmetry per tool, and the mirrored dab after the main one;<br>- world scale, inside Size;<br>- the stand-ins and what they borrow;<br>- the Negative button's arm and latch;<br>- dynamics keyed by the stroking tool;<br>- one undo state per stroke and cleanNoop. | Nothing missing. They stay in the runtime so that no recipe can break them. |

## Risks

1. **Bit-exactness has to be proven node by node.**
   - Separate passes over Float64 buffers match today's loops only if each node's expression matches the loop's, operation for operation. One product grouped differently moves vertices by a last bit, and the tol-0 check fails.
   - Today the fixtures cover none of these: symmetry, dynamic topology, Negative, mouse pressure, world scale, the Shift and Ctrl swaps, Twist and Local scale. They must be extended and recorded before any loop moves.
   - Every port is then compared three ways: the old class, the recipe's fused loop, and the recipe forced to separate passes.
2. **Speed on the iPad.**
   - Made tools that fall to separate passes cost more; the Rake would take five passes.
   - Field pools take about 4 MB for a 50k-vertex dab.
   - The per-vertex stroke tables are about 28 MB at 1M vertices if each tool holds its own. Mitigations:
     - pool them per mesh;
     - keep the built-ins on fused loops;
     - gate on the latency suite's stroke steps per mesh size;
     - show a speed readout in the editor;
     - enforce graph limits.
3. **Scope.** A wired node editor in hand-built DOM, for Pencil, touch and mouse, is a large project with no framework. A half-finished editor is worse than none. Ship the library, variants and the Recipe section first; build the canvas only if they prove too narrow.
4. **Coupling to the vendor code.**
   - `SculptManager._tools[]` and `canBeContinuous` switch on enum numbers (Polish lives in the TWIST slot).
   - Move and Drag override `sculptStroke`.
   - InputShell probes tool fields with `typeof`.

   Variants need runtime indices of 15 or more and a tagged vendor edit. Missing one of these probes silently changes behaviour.
5. **Hidden quirks spread into made tools.** Examples: Drag's sub-step ignores the pixel ratio, Drag picks the mirror before the dab, and Pinch has no rim test. A tool made from a built-in inherits them without anyone seeing it. A later major version of a node can fix them for new tools only.
6. **Saving and migration.**
   - Moving from number keys to string ids, while still writing the old tables for older installed builds, has many paths to keep in step; sanitize must accept the new keys.
   - The four knobs that start being saved (Move's falloff, Crease's Pinch, Polish's Plane lock and Build-up) are lost again if the scene is reopened in an older build.
   - Writing the scene must stay off the stroke path.
7. **Linked versus frozen.** Linked variants change behaviour when a built-in is retuned, as Clay was on 2026-11-10. Frozen made tools keep behaviour that was replaced for a reason. This needs Vidar's call (section 17).
8. **Shared files are data only, but can still be bad.**
   - Values are clamped and graphs limited, but a file can still describe a slow or useless tool. Whole object per dab is refused by the stroke node's rules.
   - Unknown node types must be kept intact under "Needs a newer Bozzetto", not dropped.
   - The CSP rules out generated code for good. That is a feature, but it caps how fast a made tool's passes can be.
9. **Hotkeys that move with the dock.**
   - Muscle memory changes when tools move.
   - The help hard-codes "Default hotkey: N".
   - The e2e suite finds buttons by badge text (`tests/e2e/smoke.mjs:3545-3564`).

   All of these must change before the order can.
10. **Stand-ins as ordinary tools.** A Smooth on the bar uses its own size and dynamics; Shift-Smooth borrows the brush in hand's symmetry and world size, and Paint blur also Paint's radius, strength and curve. These rules break easily once stand-ins live in the library, and the dynamics keying by the stroking tool has to be kept.
11. **Long press on iPad** fights iOS callouts and text selection. Follow the Negative button's proven pattern: preventDefault on touchstart, event timestamps, no pointer capture for touch.
12. **Bozzetto Studio.** The recipe format and node meanings may become a contract with the native core. Each node's reference expression must be written down precisely and covered by fixtures, or the two engines will drift.
13. **Undo.** Version 1 refuses recipes that write two channels (shape and colour). A later change that allows them needs a combined undo state.
14. **The open questions are not recorded yet.** This pass was read-only, so the questions in section 17 are not in `docs/HANDOFF.md` as CLAUDE.md requires. The next step that may write should add them and push.
