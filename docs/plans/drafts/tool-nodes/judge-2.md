# Judge

Winner: pragmatic

## Scores

### pragmatic
coverage 8, speed 8, iPad 7, buildable 9

Every current tool maps, and so do Twist, Local scale and the loop mask. Two coverage errors. (1) Its undo rule 'colour or mask: StateColorAndMaterial' is wrong on dynamic meshes: StateManager.pushStateColorAndMaterial pushes StDynamic when mesh.isDynamic (StateManager.js:38-43), and Paint and Paint blur refine topology. (2) Its rule 'a node returns nothing, skip the rest of this side's dab, with no geometry update' fits Clay, Flatten and Polish. It does not fit the Rake: RakeBrush.stroke writes prev, fromPress, prevAcross and strokeAcross before rake() (tools.ts:1667-1670). A null formPlane only returns from rake() (1705), and stroke() still calls updateGeometry (1674-1675). Speed: the built-in tools keep today's loops word for word, so they carry no risk. Made tools run separate Float64 passes (the Rake would be 5) behind gates G1-G6 in the latency suite. The per-vertex stroke tables are pooled per mesh, not per tool. Buildability is the best of the three, and its facts check out. It is the only design that saw the parity fixtures run with symmetry off and dynamic topology off (docs/parity-fixtures.md:69) and says to extend them first. Phase 1 variants on runtime indices of 15 and up do need the tagged canBeContinuous edit, since SculptManager.js:58-69 switches on the enum. TOOL_ICONS is needed because build-icon-subset.py only puts in the font the fi-ss names that appear in the source. It keeps tool.X actions (unbound) and covers library tools that sit off the dock. It also cites the 2026-11-11 decision that hold buttons are impossible, which makes the case for Smooth and Mask on the bar. iPad: the Recipe cards with 'from' selects and the live Values readout suit a Pencil. Putting them at the foot of an already long Tool panel is cramped: the Rake panel already holds about 17 rows, then Smooth (Shift), then Symmetry.

### stages
coverage 8, speed 8, iPad 8, buildable 7

Coverage is complete and careful. It has pen-input source rules ('own / the tool in hand' for stand-ins), per-node mirror rules (Turn negates, Sideways stays the same), delayed state reads to break Polish's cycle, and position sources (live, first touch, rest, form). Errors: its channel table maps Colour and Mask to StateColorAndMaterial only, which misses StDynamic on dynamic meshes (StateManager.js:38-43). It leaves undefined whether 'ends the side's dab' still updates the mesh, which matters for the Rake's form-plane return (tools.ts:1705 against 1674). Stop at depth is a coupled node that only works in the Rake's arrangement. Speed: the built-in tools bind to signature-matched kernels that are today's loops, and a test enforces that binding. The composed WeightSpec (source x shape monomorphic loops) is the cheapest generic path in any design, with a plan walk under 30 us. Buildability costs: about 11 actions x 20 variants is roughly 220 hand-written loops unless a build step generates them. A single RECIPE host slot means rebinding plans on one instance. 'Two-way parity at tol 0' assumes fixtures that do not yet cover symmetry or dynamic topology. iPad: the strongest editor. A fixed 8-card column at panel width, the live model beside it, nodes filtered to the slot with prerequisites added in one tap, menu equivalents for every drag, Scribble into typed fields, problems in plain words, and a panel preview. Its 'grid of Uicons' icon picker ignores the font subset.

### dataflow
coverage 9, speed 7, iPad 6, buildable 4

The most faithful coverage, and the only design that gets the hard edge cases right. Its write-driven undo includes StDynamic. Stop dab has variants (with or without the update, and which memory writes each stop cancels), which is exactly the Rake's tools.ts:1667-1675/1705 behaviour. It also has an explicit Jacobi rule, Record nodes for lastDab, a Cursor output, the layer cap as a group, and loop mask, group mask and Fill as stroke kinds. Speed: built-in tools compiled at build time with fused passes (Clay 2 passes against 3, Rake 3 against about 7, the front-list allocation gone) can beat today's. But the deformation loop is a minority of a dab's cost, so the gain is small. Made tools on WebAssembly copy the region in and out on every dab, and the native nodes run in JS between passes, forcing more round trips. WebAssembly has no pow, yet Hardness (1-d)^1.5, Paint's (1-d)^0.1 and Move's falloffPow need it per vertex. None of this is measured. Buildability is far the heaviest: an IR, a JS printer, a WASM printer, a reference interpreter, a canvas editor, a Try viewport and probes. Regenerating and checking in the built-in kernels also puts every built-in at parity risk, behind fixtures that skip symmetry and dynamic topology. Minor misread: smoke.mjs:3549 tests that the OS long press is suppressed (the touchstart default is cancelled). The Negative button's app-level long press already satisfies that, so the dock does not change the test. iPad: about 75 primitive maths nodes make any non-trivial graph (the Rake) unmanageable on a canvas. The workspace page takes the sculptor away from their model to a Try sphere. Probes that paint a field onto the mesh are excellent, though.

## Graft

From stages:
- The editor as a full-width replacement of the right panel, with the live model beside it, instead of a folded section at the foot of the Tool panel.
- The fixed, numbered stage column with node lists filtered to the slot, prerequisites added in one tap ('needs Remember this stroke's moves. Add it'), and menu equivalents (Move left, Move right, Remove) for every long-press drag.
- Problems shown in plain words, with a tool that has a problem dimmed on the dock; port shape by rate (round, square, diamond) with a legend; 'Panel preview'.
- The explicit 'own / the tool in hand' table for each stand-in's Size, Strength, Profile, Spacing and Pressure, and per-node mirror rules.
- The signature-matched built-in kernel rule, plus a CI test that every built-in recipe binds its fused kernel. Pragmatic's 'known shape' matching is this, stated as a rule.
- The composed WeightSpec (Distance, shape, Mask folded into monomorphic loops for each source x shape pair) as the middle tier between pragmatic's fused loops and its Float64 passes. It cuts made-tool cost: the Rake's 5 passes would come close to fused.
- The 'Speed: as the built-in / slower (custom parts)' footer.

From dataflow:
- Stop-dab variants: whether the mesh update still runs, and which memory writes each stop cancels. Pragmatic's single 'nothing means no update' rule breaks Rake parity (tools.ts:1667-1675 against 1705).
- Undo kind chosen from the writes, StDynamic included (StateManager.js:38-43).
- The two validator rules: a field reaches a per-dab value only through a Reduce, and a value reaches the next dab only through Remember. Also the explicit Jacobi rule: no reading an attribute this dab has written.
- Setting roles (size, strength, spacing, pressureSize, curve and so on), so the b/s/l held-key drags, the ; and ' steps, world scale and the strength migrations find any tool's settings without typeof probes.
- Probes that paint a per-vertex field in grey scale, but on the live model rather than a Try sphere.
- Record nodes compiled out unless tests ask, the structure hash that sends settings-only variants to the fused kernel, the Layer cap group, and custom tools embedded in .bozz files.
- WebAssembly kept as the later back end for made tools only. The CSP's 'wasm-unsafe-eval' (public/_headers:42) allows it.

## Gaps

1. No hover rate, and no full cursor contract for tools users make. The cursor is driven by checks on Enums.Tools:
- syncCursorTines checks Enums.Tools.RAKE (InputShell.ts:645-653).
- strokeAcross feeds the tine axis (655-670).
- The mid-stroke 'dim' versus 'dot' style is picked for SMOOTH, PAINT_BLUR and RAKE (1580-1588).
- The smoothing tint is set by tool index (setSmoothing, around line 609).
- The Rake's hover axis follows smoothed pointer motion before any stroke exists.
None of the designs evaluates anything at hover time. Dataflow's out.cursor is the closest but runs only within a stroke.

2. The parity proof has holes. The fixtures record with symmetry off and dynamic topology off (docs/parity-fixtures.md:69). The 'tol 0 proves it' claims in stages and dataflow therefore never test:
- the mirror order, or Drag's mirror pick before the main dab;
- DabSteps per side;
- StDynamic and refinement before each dab;
- the Shift and Ctrl swaps;
- world scale.
Only pragmatic says to extend the fixtures first. None names a fixture for the Rake's early return when the form plane is null, or for two strokes in a row (the Rake's prevAcross lasts the tool's lifetime).

3. Icons for imported tools. build-icon-subset.py puts into the offline font only the fi-ss-* names the source mentions. An icon chosen from a 'grid of Uicons' (stages) or a picker (dataflow), or arriving in an imported .bztool, renders blank unless it is in a list kept in the source. Only pragmatic covers this.

4. The real costs of a dab on the iPad are left alone. Each design budgets only its own interpretation overhead. Untouched:
- CameraAdapter.compute() multiplies two matrices, inverts one and allocates on every project and unproject call (CameraAdapter.ts:26-57), several times per dab per side;
- fresh Uint32Array copies of the picked, front, face and ring lists on every dab;
- synchronous work on every pointermove, with no rAF batching and no coalesced events;
- a full upload on every dynamic-topology step.
A runtime rewrite is the natural time to cache the inverse once per event and pool those lists. No design takes it.

5. Undo rules for colour on dynamic meshes. Stages and pragmatic map Colour and Mask to StColorAndMaterial, but Paint and Paint blur refine topology, and pushStateColorAndMaterial then pushes StDynamic. Their 'one channel per tool' validator also needs to treat refinement as a topology write.

6. Assorted smaller holes:
- The settings for refine-under-the-brush (subdivide and decimate factors) are global, and no design says whether a tool's recipe owns them.
- The per-tool help in src/help/content/tools.ts is hand-written, and nothing produces help for variants or made tools.
- Dock and library edits have no undo.
- The shared 'Smooth (Shift)' settings and a Smooth placed on the dock as its own tool both claim the same settings, and no design gives a clean rule for which wins. Pragmatic flags this but does not resolve it.
- Dataflow's WebAssembly path needs pow, imported or written out, for Hardness, the Paint presets and Move's falloff power.

7. None of the designs could write its open questions into docs/HANDOFF.md, because every pass was read-only, though CLAUDE.md requires it. The merged list needs to be written and pushed by a step that is allowed to write.
