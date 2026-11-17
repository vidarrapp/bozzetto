# Judge

Winner: pragmatic

## Scores

### stages
coverage 7.5, speed 8, iPad 8.5, buildable 7

Every tool gets a row, and the arithmetic checks against the code. Clay: rate = min(0.5, gain/r) x p, plane C0 + N x +-0.1r, one-sided min(1, curve x rate x mask) x h (tools.ts:946-1053). Crease: gather plus crest, gather not flipped by Negative (tools.ts:1963-1981). Smooth: the cap goes on intensity x P before the mask, and amt.fraction with cap 1 gives min(1,IP) x mask (tools.ts:503-505, Smooth.js:38-61). Pinch: uncapped. Polish: the held normal as a state read delayed by one dab. Weak spots: (1) The fixed column's own rule, 'refuse a binding from a later stage', would refuse the Rake. frame.formPlane and frame.levelRef in Reference read form positions and scrape records owned by acc.track in stage 7, and acc.stopAtDepth in stage 7 clamps the share inside a stage-6 Action. In the code that clamp sits in the middle of one fused expression (tools.ts:1826-1845). The design admits it is 'least modular', but the column does not model the dependency. (2) A dab can stop with or without the geometry update, and the design does not say which. Clay and Polish return before updateGeometry (tools.ts:942, 670), while the Rake's form-plane return still updates (rake() returns into stroke(), which then calls updateGeometry). The Rake also writes prev[side] and prevAcross before that stop. (3) The channel table maps Colour to StateColorAndMaterial, but pushStateColorAndMaterial gives StDynamic on a dyntopo mesh (StateManager.js:38-43), and Paint refines. (4) One RecipeTool sits in a RECIPE slot, but canBeContinuous is an enum switch (SculptManager.js:58-69). Grab recipes therefore need a vendor edit, which is not flagged. Speed: the three kernel tiers are the most credible plan for user tools. Built-ins run today's loops unchanged; user chains get 20 monomorphic (source x shape) Action kernels plus pooled pass-by-pass arrays, with no copying and no WASM. iPad: an accordion of eight cards, chips, a 'fits this slot' sheet, input sources picked from a short list, port shape for rate, and the editor in the right panel with the real model live beside it. This is the most Pencil-friendly editor of the three. Buildable: ids first, then recipes as data, then the runtime with two-way parity in CI. It assumes the parity fixtures prove fidelity, but they run with symmetry off and dyntopo off (docs/parity-fixtures.md).

### dataflow
coverage 9, speed 7.5, iPad 6.5, buildable 4.5

The most exact coverage. I checked its per-tool graphs against the loops and they hold up. Pinch's grouping q x ((k x mask) x alpha) matches Pinch.js:59. Inflate's ((amount x q)/|n|) x mask matches tools.ts:2040-2049. Crease's two terms are added in the right order. The generated bz.clay.ts matches tools.ts:917-1053 term for term: commit when rate <= 0, stop with no update on a null normal, areaCenter as plain doubles (SculptBase.js:255-273). Drag's legacy sampler is right: i from 0, the previous position first, one dab at the press via step=Infinity, 0.15 x _radius with no dpr, mirror re-seeded each event (Drag.js:16-53). The Rake is right too: kept updated by this dab's scrape before the room calculation, the conditional vertex-memory write (`amount !== 0 || had || ref`), the form-plane stop that still updates the mesh, and memory written before the stop. Stop dab with or without update, and per-write cancel lists, are the only correct model of the early-return semantics in any design. It also covers the loop mask, the mask commands and Ctrl+click as Tap/Once graphs. Minor slips: it reads the e2e check 'a touch on a toolbar button cannot arm a long press' (smoke.mjs:3549) as conflicting with a dock long press, but that check is about the OS default and stays compatible. And tol-0 generation from graphs needs expression variants it never names: Polish uses Math.hypot and divide-normalisation (tools.ts:726-750), where areaNormal uses sqrt and a reciprocal multiply (SculptBase.js:245-251). Speed: fused build-time built-ins could beat today (the Rake goes from about 7 loops to 3, and the front-list allocation goes). But edited tools run as WASM, with attributes copied in and out every dab, native nodes bouncing to JS between passes, async compiles, and nothing measured on an iPad. iPad: the Recipe view is good and the probes are excellent. The wired canvas (pen draws, finger pans, lasso, cutting wires) is the hardest thing to get right on a Pencil, and the Try viewport tests on parity meshes rather than on the user's own sculpt. Buildable: a compiler, a JS printer, a WASM printer, a reference interpreter, a GraphTool, a canvas, a Try viewport and probes. This is the largest scope. Every built-in has to be regenerated from a graph at tol 0, and the fixtures do not cover symmetry or dyntopo.

### pragmatic
coverage 8, speed 7, iPad 8, buildable 8.5

It covers all 15 stroke tools, the loop mask and the commands, with recipes close to the code. It keeps each effect's exact expression and calls the product grouping parity-relevant (profile.ts:719-721). It catches the TWIST-slot quirk (Polish's skipped re-pick) and puts the Stroke-node outlines for Grab, Drag along, Hold at press and Drag a line straight from today's overrides. Errors: (1) 'nothing skips the rest of this side's dab, with no geometry update' is applied to Fit plane to form. The Rake's form-plane null in fact still runs updateGeometry. (2) Its undo table also omits StDynamic for colour on dyntopo meshes (StateManager.js:38-43). (3) Separate passes at tol 0 is a claim it rightly says must be proven. It never notes the hypot versus sqrt split. Its distinctive and correct findings: the parity fixtures run with symmetry off and dyntopo off, so they must be extended before anything moves. I confirmed this in docs/parity-fixtures.md. canBeContinuous needs a tagged vendor edit for slots >= 15. Per-vertex stroke tables (about 28 MB at 1M vertices) should be pooled per mesh, not per tool. And the recipe semantics become a contract with the Bozzetto core: HANDOFF.md:85-95 records Clay matched between core and engine to 0.00001 cm. Speed: built-ins stay on fused loops; this is the same guarantee as stages. Made tools fall straight to Float64 field passes (the Rake would need five) with no composed tier between, so their speed is the weakest of the three, though the 1.3x latency gate and zero allocation per dab are sound. iPad: a Recipe section inside the Tool panel, stage lists, 'from' selects, long press to reorder effects, a live Values readout, and tests on the real model with mesh undo. Good, but more cramped than stages' dedicated editor. Buildable: the best phasing. Phase 1 delivers the dock, the library and variants (Duplicate as a new instance of the same class) on the existing brushes, which is the user's first ask. Each tool is then ported one at a time with a three-way tol-0 comparison before its class is deleted, and the canvas comes only if it is needed.

## Graft

From dataflow:
(1) Its dab-termination model. A stop runs either with or without updateGeometry (Clay and Polish skip it, tools.ts:942, 670; the Rake's form-plane stop updates), and each memory write lists the stops that cancel it (the Rake writes prev and prevAcross before the stop). Pragmatic's single 'nothing skips, no update' rule gets the Rake wrong.
(2) Its rate model: Kept, Stroke, Move, Dab, Vertex. Add a Kept lifetime to pragmatic's memory table explicitly, and the rule that a field reaches a dab value only through a Reduce.
(3) Its per-tool graphs written in evaluation order with explicit product grouping (Pinch q x ((k x mask) x alpha), Inflate ((a x q)/|n|) x mask). Use them as the 'reference expression' pragmatic says each node must carry. Add the variants for Math.hypot against sqrt, and divide against reciprocal-multiply normalisation (Polish, tools.ts:726-750, against areaNormal, SculptBase.js:245-251).
(4) Setting roles (size, strength, spacing, pressureSize, strengthCurve and the rest), so the ; and ' keys, the s/b held-key drags, world scale and the legacy strength conversions can find any tool's knobs.
(5) out.cursor as a node, and the Record node in place of lastDab and lastStrengthDab.
(6) Structure-hash matching, so a user copy that changes only settings binds the built-in fused kernel.
(7) Probes that paint a field on the mesh in grey scale, added to pragmatic's Values readout.
(8) Tap and Once stroke kinds, which make Ctrl+click group mask and the mask commands first-class.

From stages:
(1) The composed-kernel tier. A WeightSpec of Distance, one shape and the mask compiles into about 20 hand-written monomorphic Action loops. Put it between pragmatic's fused built-ins and its Float64 field passes, so a typical made tool stays near built-in speed without WASM.
(2) Two-way parity in CI: each built-in through its kernel at tol 0, and forced through the generic path within 1e-6. Keep pragmatic's stricter three-way tol-0 check per port, but run stages' generic check permanently.
(3) The dedicated Tool editor: eight closed 56 px cards replacing the right panel, chips, a sheet listing only the nodes that fit a slot, prerequisite offers in one tap ('needs Remember this stroke's moves. Add it'), the port-shape legend, a Panel preview, and a 'Speed: as the built-in / slower' footer.
(4) The explicit own-or-tool-in-hand table for every stand-in setting.
(5) Sanitizer caps (4 nodes per stage, 3 Actions, 32 nodes) and refusing __proto__-style keys.
(6) A pressure row shows only when a node reads it. This fixes Move's dead 'Pressure: strength' without a special case.

Keep from pragmatic itself:
- Phase 1 dock and variants on the existing classes.
- Extending the fixtures to symmetry, dyntopo, Negative, mouse pressure, world scale and the swaps before any loop moves.
- Per-mesh pooling of vertex memory.
- The tagged vendor edit to canBeContinuous.
- Writing node semantics down as a Bozzetto core contract.

## Gaps

1. **No design has a hover rate.**
   - The Rake's tine cursor and its hover axis come from InputShell, not from the brush. The axis is perpendicular to the smoothed pointer motion. Both are read only when getToolIndex() === Enums.Tools.RAKE (InputShell.ts:645-670).
   - A Rake variant or a made tool with tines therefore loses its cursor, unless the graph can be evaluated read-only before the press: tine count, width and taper, and the axis from hover motion.
   - The rate models in all three designs start at the press. out.cursor in dataflow and 'Tines draws the cursor' elsewhere cover only the stroke.

2. **Ctrl+click group mask is hard-wired to the vendor Mask tool and to an empty stroke state.**
   - The click checks getToolIndex() === MASKING and state === click.state && state.isNoop() (InputShell.ts:1546-1555, 1886-1898). It works only because Spaced dabs lays no dab at the press.
   - Each design lets you change things that break it:
     - stages: Mask moves to a RECIPE_STAND_IN slot, and Spaced dabs has a 'dab at press' option;
     - dataflow and pragmatic: each tool may pick its own Ctrl tool.
   - None turns 'this stroke can become a group click' into a capability of the tool.

3. **World-scale stand-ins and the shared Smooth settings.**
   - STAND_INS in worldScale.ts:61-65 is a set keyed by enum, and its comment says stand-ins 'keep no size of their own'.
   - The owner decision of 2026-10-27 (HANDOFF.md:39) is one shared Smooth setting set for every brush (StableSmooth.smoothSettings).
   - The designs that put Smooth or Mask on the dock with their own Size rows (pragmatic), or let each tool pick its own Shift tool (dataflow, and the header in pragmatic), collide with both. None says how a docked Smooth's world size, and a Shift-Smooth's borrowed one, can coexist, or whether a per-tool Shift stand-in overrides the 2026-10-27 decision.
   - This should be a new open question for Vidar.

4. **Per-tool legacy setting migrations are not assigned to tool definitions.**
   - The migrations: LEGACY_STRENGTH fraction to cm (tools.ts:202-220), the Rake's legacy `depth` x 3 cm and `plateau` to scrape (tools.ts:1088-1094, sanitize.ts:243-255), and the per-table revisions SPACING_REV, STRENGTH_REV, PROFILE_REV and SMOOTH_REV.
   - Only the key migration (enum to string id) is designed. No design gives a recipe a settings migrator for its old saved values, or says which node owns the cm calibration.

5. **The float-exactness taxonomy is incomplete.**
   - The designs talk about product grouping, but not about the other expression choices that change bits: Math.hypot against sqrt(x²+y²+z²), x/len against x*(1/len), Float32 scratch for the Laplacian, and predicates on NaN.
   - Polish alone uses hypot and division (tools.ts:726-750); the area estimators use sqrt and a reciprocal (SculptBase.js:245-251).
   - The generic Length and Normalise nodes in all three designs would differ from Polish in the last bit. This matters for any tol-0 claim on a path other than the moved loops: dataflow's graph-generated built-ins and pragmatic's separate passes.

6. **Undo under dynamic topology for colour tools.**
   - pushStateColorAndMaterial gives StDynamic on a dynamic mesh (StateManager.js:38-43), and Paint and Paint blur refine (Paint.js:94).
   - The channel and undo tables in stages and pragmatic map colour to StColorAndMaterial only. Dataflow lists 'dynamic' but does not tie it to the channel.

7. **The parity fixtures do not cover what the designs lean on.**
   - The fixtures run symmetry off, dynamic topology off, a pen, one dab per move, and only the default parameters (docs/parity-fixtures.md).
   - The designs most depend on per-side memory (DabSteps, held normals, Stroke axes), the mirror-after-dab order (SculptBase.js:174-193), Drag's mirror-before order, and vertex memory that survives dyntopo (StrokeMoves).
   - Only pragmatic notices. None budgets fixtures for grab tools on the mirrored side, where overlapping vertices sum (Move.js:90-107).

8. **Multiresolution levels.**
   - Vertex memory, rest positions and stroke-start proxies are said to be 'per mesh' or 'keyed by vertex', but no design says what happens when the level on screen changes between strokes. The Rake's prevAcross is kept for the tool's lifetime. The loop mask already caches per level and per undo index (loopMask.ts:568-578).
   - Stroke-local memory keyed by vertex id must also be keyed to the mesh data or level.
