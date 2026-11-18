# Plan: the tool library, the dock, and tools built from nodes

Status: design for Vidar, 2026-11-17, with his answers of the same day worked in
(section 11). Nothing is built. It replaces the drafts
in `docs/plans/drafts/tool-nodes/` as the plan to build from; the drafts stay
as the detailed record (how each tool works today, three full designs, two
reviews). Section 12 lists what is taken from which draft.

What was asked for:

1. A **tool library**, and a tool bar that works like the macOS Dock: drag
   tools on, drag them along, long press to lift one, drag it off to remove
   it. The ten number keys follow whatever order the bar is in.
2. **Tools built from nodes**, in the manner of Blueprints, designed so that
   every sculpt tool Bozzetto has today can be rebuilt from them.
3. The same system for the **Paint workspace's brushes** (a full set of 2D
   painting brushes on vertex colour).
4. A **contrast brush** for Sculpt, whose result is kept on an ordinary sculpt
   layer (the answer to "blend modes on sculpt layers").

---

## 1. The short version

- **The dock and the library come first and need no nodes.** They work on the
  tools as they are today. A copy of a tool with its own name, icon and
  settings ("a softer clay", "Rake for hair") is most of what a library is for,
  and it needs no editor at all.
- **A tool becomes a record**: a name, an icon, a recipe, its settings, and
  what Shift, Ctrl and Alt do while it is in hand. The tools Bozzetto ships
  become built-in records. A copy is the same recipe with other settings. A
  made tool has a recipe of its own.
- **A recipe is a short list of coarse nodes in fixed stages**: how the stroke
  is laid, which vertices a dab takes, what it measures there, how much it
  does, the shape of its falloff, and what it does to each vertex. A node works
  on a whole dab, never on one vertex, so a recipe costs a few dozen calls per
  dab and nothing per vertex.
- **The stroke's outline is fixed and is not a node**: pick, undo, refine,
  the mirrored side, normals, upload, end of stroke, and the hand-over to the
  active layer. Nodes fill the open places in it. That is why a tool somebody
  builds is still fast, undoable, symmetric and layer-aware without them
  doing anything for it.
- **Today's tools must not change by one bit.** Each built-in keeps the vertex
  loop it has now. A tool is moved onto the node runtime only after tests show
  the same vertices, to the last bit, as before the move.
- **The editor is a column of stage cards first, wires later.** The recipe is
  a graph underneath either way. Picking each part from a short list suits
  the Pencil; drawing wires on a canvas is the largest and riskiest piece, and
  it can be added later without redoing anything. This is the one place the
  plan departs from "Blueprints"; agreed 2026-11-17.

Order of work, each step shipping on its own:

| Step | What the person gets | Size |
|---|---|---|
| 0 | Nothing visible: tools get names instead of numbers, the Tool panel is built from data | one package |
| 1 | **The dock and the library**, Smooth and Mask as tools you can put on the bar, copies of tools with their own settings, tool files to pass on | two packages |
| 2 | Nothing visible: the node runtime under each tool, one tool at a time | about ten small packages |
| 3 | **The tool editor**, the contrast brush and the first new paint brushes | three packages |
| 4 | A wired canvas, only if step 3 proves too narrow | one large package |

---

## 2. The dock

Each workspace with tools has its own bar: **Sculpt** and **Paint**. Armature
and Present have none.

- **Order.** `[Select q] [place 1] [place 2] … [Transform t]`. Select and
  Transform are modes, not library tools: they stay at the ends and cannot be
  lifted. In Paint the bar is `[Select q] [places]`. The library is opened
  from the Tool panel's heading and the View menu, not from the bar.
- **Keys follow the bar.** The keys 1 to 9 and 0 pick whatever sits in places
  1 to 10. The bar may hold more tools than that; those past the tenth have
  no number key. Move a tool and its key moves with it. The badges, the hotkey guide,
  Preferences and Help all read the place, so they are never wrong. A key for
  an empty place says "No tool in place 8. Open the Tool library to add one."
- **The default bars are today's**, so nobody's keys change: Sculpt has
  Crease, Move, Standard clay, Inflate, Pinch, Flatten, Rake, Drag, Polish;
  Paint has Paint, Erase, Blur, Fill, Pick, Project. Calipers keeps its place
  and its C key.
- **Lift.** Pencil and finger: a long press (600 ms, the same as the Negative
  button's latch). Mouse: press and drag, or a long press. A lifted tile grows
  a little and follows the pointer; its name shows above it. Every place shows
  its digit while something is lifted, so you see which keys are about to
  move.
- **Move along the bar.** The others make room, and their digits change as
  you go.
- **Drag off to remove.** Above the bar or past its ends the tile fades and
  says "Let go to remove". A notice follows: "Pinch is off the tool bar. It
  stays in the library." with Undo. Nothing is ever lost by this: the tool is
  still in the library with its settings.
- **No fixed limit.** The first ten places have the digits. When the bar is
  wider than the screen has room for, it scrolls sideways and keeps the tool
  in hand in view.
- **A tool in hand that is not on the bar** shows as one extra tile with no
  digit, as a running app does in the Dock. Lift it and drop it in to keep it.
- **A long press that ends without moving** opens the tile's menu: Tool
  settings, Duplicate, Name and icon…, Remove from tool bar.
- Bar edits are not sculpt history: Undo never moves tools. Nothing on the bar
  can be pressed during a stroke, as today.

The mechanics follow the Negative button's, which are proven on the iPad: the
events' own timestamps decide a long press, `touchstart` is cancelled so iOS
shows no callout, and no pointer capture is used for touch.

## 3. The library

- **Where.** Opened by a **Library** button in the Tool panel's heading and by
  **View › Tool library** (decided). The library is a **floating window over
  the view** (decided 2026-11-18): it can be moved, it does not block the work
  under it, and it stays open while tools are dragged from it to the bar and
  tried on the model, as the Publish window floats today. It opens near the
  tool bar, so the first drag is short, and remembers where it was left. One
  press on its close button, the Library button or Esc shuts it.
- **What it lists**, in sections, two columns of rows on the iPad:
  - **Sculpt:** Standard clay, Crease, Move, Inflate, Pinch, Flatten, Polish,
    Rake, Drag, Smooth, and later Contrast.
  - **Mask and measure:** Mask, Calipers.
  - **Paint** (in the Paint workspace the window shows this section first):
    Paint, Erase, Blur, Fill, Pick, Project, and later the new brushes.
  - **My tools:** copies and made tools. Empty, it says "Duplicate a tool to
    keep a second set of its settings."
- **A row** is the tool's tile exactly as it looks on the bar, its name, one
  short line ("Sharp grooves and folds"), and its key in a small box if it is
  on the bar. Worth trying: a small picture of the tool's stroke on a flat
  plane, made from the tool itself, in place of the line of text.
- **Tap** a row to take that tool in hand. **Lift** a row (same gesture as the
  bar) to drag it onto the bar. The row's menu has "Put on the tool bar" for
  those who would rather not drag, then Duplicate, Name and icon…, Edit…,
  Reset settings, Help, Delete….
- **Smooth and Mask without a keyboard.** Today they are reached only with
  Shift and Ctrl, so an iPad without a keyboard cannot paint a mask at all.
  Still open: buttons beside the Carve button at the edge that arm Smooth or
  Mask for the next strokes, as Carve arms itself (Vidar leans this way for
  modifiers), tools in the library that can go on the bar, or both. Shift and
  Ctrl keep working from every tool either way. Each tool picks which Smooth
  mode its Shift uses; the size is the tool in hand's (decided).

### Copies

**Duplicate** makes a new entry under My tools: the same tool with a copy of
its current settings (size, strength, pressure, curve, spacing, symmetry and
its own knobs), named "Standard clay 2". The Name and icon window opens at
once, because two tiles with the same icon are hard to tell apart. Icons come
from a set kept in the app (the icon font holds only what the source names, so
a free choice from the whole icon family is not possible offline).

### Where things are kept

- **The bars and My tools** are kept on the device (they follow the saving
  choice), not per scene and not per account: an iPad and a desktop can have
  different bars.
- **Tool settings keep riding the scene**, as today. A scene also carries the
  full record of every copy and made tool it has settings for, so the work
  opens the same anywhere; opening a scene with a tool this device lacks
  offers "Add to library".
- **A tool file**, `.bztool`, exports one tool or several (the Share sheet on
  the iPad, a download elsewhere) and imports them again, with every number
  held to its range, as light rigs are passed on today with `.bozzrig`.
  Sharing tools through the Community is later work.

---

### A material library on the same pattern

Decided 2026-11-18: materials get a library like the tools', in a floating
window of the same kind. A sketch, to be designed properly before it is built:

- **Opened** by a Library button in the Material tab's heading and View ›
  Material library. The same window frame, rows and gestures as the tool
  library, so the two are learned once.
- **What it lists:** the materials in this scene (each a small lit sphere, its
  name, and how many objects use it), a set that ships with the app (clays,
  plaster, wax, bronze, stone, a neutral white for painting), and **My
  materials**, kept on the device.
- **Use:** tap a material to give it to the selected objects; drag it onto an
  object in the view to give it to that one. Duplicate, Name…, Delete… in the
  row menu, and **Save to My materials** from the Material tab.
- **Passing on:** a small `.bozzmat` file, as light rigs have `.bozzrig` and
  tools will have `.bztool`. Scenes keep carrying their own materials, so the
  work opens the same anywhere.
- With the material's colour multiplying the paint (decided 2026-11-18), the
  neutral white is what a painter picks to see paint exactly as picked.

The light rig library (Lighting tab, built) can move into the same window
frame later, so all three libraries look and behave alike.

**One window with tabs** (Vidar, 2026-11-18: possibly; recommended here): a
single Library window with the tabs **Tools**, **Materials** and **Light
rigs**, in place of one window each. Each Library button opens it on its own
tab (the Tool panel's on Tools, the Material tab's on Materials, the Lighting
tab's on Light rigs), a tab shows only in the workspaces where it applies, and
the window keeps one place and one size. It costs nothing extra if the window
is built with tabs from the start, so the tool library's first step should
build the frame that way even while Tools is its only tab.

---

## 4. A tool as a record

```ts
interface ToolRecord {
  id: string;        // 'bz.clay' for a built-in, 'u.<uuid>' for a person's own
  name: string;
  icon: string;      // from the app's tool icon set
  workspace: 'sculpt' | 'paint';
  recipe: { builtin: string; linked: boolean } | Recipe;
  values: Record<string, number | boolean | string>;   // 'node.param' -> value
  curves: Record<string, StoredCurve>;
  presets?: ParamPreset[];                              // the Rake's Fine … Scraper
  dynamics: BrushDynamics;                              // pressure on size and strength
  symmetry: BrushSymmetry;
  shift: string | null;   // the tool Shift swaps in: 'bz.smooth', or 'bz.blur' in Paint
  ctrl: string | null;    // 'bz.mask'
  alt: 'negative' | 'pick-colour' | 'unmask' | null;
  cursor: 'ring' | 'dim' | 'dot' | 'tines';
  migrate?: number;       // which built-in settings migrations have run
}
```

Three kinds of tool:

- **Built-in:** shipped with the app; its recipe cannot be edited, only copied.
- **Copy:** a built-in's recipe with other settings, a name and an icon.
- **Made:** a tool with its own recipe.

Built-in ids are words (`bz.clay`, `bz.crease`, `bz.move`, `bz.inflate`,
`bz.pinch`, `bz.flatten`, `bz.polish`, `bz.rake`, `bz.drag`, `bz.smooth`,
`bz.mask`, `bz.twist`, `bz.local-scale`, `bz.paint`, `bz.erase`, `bz.blur`,
`bz.fill`, `bz.pick`, `bz.project`, `bz.calipers`). Today everything is keyed
by the vendored engine's tool number; step 0 replaces that with these ids
while still writing the old numbered tables, because an installed iPad app can
be a version behind and must still read a newer scene's settings.

---

## 5. Recipes: what a node is and when it runs

### The fixed outline of a dab

For the ordinary brush (dabs laid along the stroke) one dab on one side is:

1. Pick the surface at the dab's point; gather the vertices in reach.
2. Remember stroke-start positions, if any node reads them.
3. Undo snapshot of those vertices.
4. Refine the surface, if the object uses dynamic topology.
5. **The recipe's nodes**, in order, then **the vertex pass**.
6. Update normals and the search tree; upload what changed.

Then the mirrored side does the same with its own memory, picked on the
surface the first side left. At release the stroke is closed and the active
layer takes what the stroke did.

None of that is a node, and no recipe can break it. In particular:

- **Layers need nothing from a recipe.** A sculpt stroke changes positions;
  the active sculpt layer records the difference when the stroke ends, as it
  does today. A paint stroke writes colour and alpha into the active paint
  layer through the same door every paint tool uses now; the stack is
  composited after. A layer's mask is multiplied into every effect's weight by
  the runtime, beside the sculpt mask. A fill layer or a group refuses the
  stroke before it starts, whatever the tool.
- **Undo is chosen from what the recipe writes**: shape, colour or mask, and
  the dynamic-topology kind whenever the surface is refined, colour tools
  included.

### When nodes run

| Rate | When | Examples |
|---|---|---|
| Kept | lasts as long as the tool | the Rake's last stroke direction |
| Stroke | once at the press, and at release | Strength, Negative, the press point |
| Move | once per pointer event | pressure, the pointer's ray |
| Dab | once per dab per side | the area's normal, a plane, an amount |
| Vertex | inside the shape and effect nodes only | distance, falloff, the move itself |

Rules the editor enforces: a per-vertex value becomes a per-dab value only
through a node that reduces it (an average, a fit); a value reaches the next
dab only through a memory node; no node reads what the same dab has already
written. These three rules are what keep recipes free of loops and surprises.

### The stages and their nodes

A recipe is a column of seven stages. Each holds one node, except Effects
(up to three) and Memory (as needed).

| Stage | The question it answers | Nodes |
|---|---|---|
| **Stroke** | How is the stroke laid on the surface? | Spaced dabs · Grab (Move) · Drag along (Drag) · Hold at press (Twist, Local scale) · Drag a line (Loop mask) · Tap · Once (commands) |
| **Area** | Which vertices does a dab take? | Sphere · Connected sphere · Facing the view · Whole object, Group, Masked part (commands only) · Edge loop side |
| **Reference** | What does the dab measure there? | Picked normal · Area normal · Area centre · Raise plane · Plane grip · Hold normal · Stroke axes · Fit plane to form · Fit reference surface · **Picture under the brush** (Project) · **Colour under the brush** (smudge) |
| **Amount** | How much does it do? | Strength (cm or fraction) · Pressure (swing or amount) · Negative · Step from last dab · Stroke share · Clay rate · Curve integral · Cap at 1 · **Jitter** (a random number per dab) |
| **Shape** | How does it fall off across the dab? | Distance · Falloff (quartic, soft edge, curve, even) · Profile curve · Tines · Along the chord · Height over plane · **Stamp** (a picture laid in the dab's plane) · **Noise** (a grain fixed to the surface) |
| **Effects** | What happens to each vertex? | Push along · Push along vertex normal · Pull to plane · Pull to point · Translate · Rotate · Scale about · Average neighbours · Fit to surface · **Exaggerate** · Blend colour · Erase · Pick colour · Add to mask · Set mask |
| **Limit** | What stops it? | Stop at depth · Cap at 1 · **Stroke cap** (no more than so much per stroke) |
| **Memory** | What is remembered between dabs? | Stroke-start positions · Rest positions · Stroke moves · Stroke record · **Carried colour** |

The nodes in bold are new; everything else is a piece of a tool that exists
today, moved, not rewritten. Small arithmetic (add, multiply, clamp, choose)
is available between stages but hidden inside the cards, not shown as nodes of
its own.

Values that flow between nodes have a type (number, yes/no, point, direction,
plane, frame, curve, colour, a vertex set, a value per vertex). An input only
offers the upstream values that fit it, so wiring is choosing from a short
list.

### Every current tool, as a recipe

The full node-by-node table, checked against the code, is in
`drafts/tool-nodes/design-pragmatic.md` (Coverage). In short:

| Tool | Stroke | What makes it itself |
|---|---|---|
| Standard clay | Spaced dabs | Raise plane over the area's centre, Clay rate, Pull to plane from below |
| Crease | Spaced dabs | two effects in order: Pull to point (the gather), then Push along the picked normal by a Stroke share |
| Inflate | Spaced dabs | Stroke share, Push along vertex normal, from stroke-start positions |
| Pinch | Spaced dabs | Pull to point |
| Flatten | Spaced dabs | Area normal and centre, Pull to plane, Negative on by default |
| Polish | Spaced dabs | Hold normal (memory), Plane grip, Pull to plane on both sides |
| Rake | Spaced dabs | Stroke axes, Stroke moves, Fit plane to form, Tines along the chord, Stop at depth, a scrape then a cut |
| Smooth | Spaced dabs | Average neighbours, or Fit to surface |
| Move | Grab | Rest positions, Translate from rest, falloff to a power |
| Drag | Drag along | Translate by the pointer's travel |
| Twist, Local scale | Hold at press | Rotate, Scale about (in the engine today, not reachable) |
| Mask | Spaced dabs | Add to mask; a Ctrl tap on a group is Tap plus Set mask |
| Loop mask | Drag a line | Edge loop side, Set mask |
| Paint | Spaced dabs | Blend colour |
| Erase | Spaced dabs | Erase (lowers the layer's alpha) |
| Blur | Spaced dabs | Average neighbours on colour and alpha |
| Fill | Tap | Whole object, Blend colour through the mask |
| Pick | Tap | Pick colour, no undo |
| Project | Spaced dabs | Picture under the brush, Facing the view, Blend colour |
| Select, Transform, Calipers | | Not recipes: they move objects or measure, and stay as they are |

Nothing a current tool does is left out. Each tool's odd corners (Drag ignores
the screen's pixel ratio, Pinch has no test at the rim, Polish does not pick
again before an update) are kept as hidden settings of their nodes, named for
what they do, so the built-ins stay exact and a later version of a node can
drop the quirk for new tools only.

---

## 6. The contrast brush

**What it does.** Where Smooth moves each vertex toward the calm surface
under the brush, Contrast moves it away from it: hollows get deeper, ridges
get higher, and the relief reads more strongly. With Negative it flattens the
relief instead, without rounding the large form as Smooth does.

**Recipe.** Spaced dabs; Sphere; Fit reference surface (the calm surface: the
same fit the Rake's Stop at depth uses, wide enough to ignore the detail);
Strength times Pressure; Distance and Falloff; the new effect **Exaggerate**:
`move = (position − its point on the calm surface) × amount × weight`, held to
a small part of the brush radius per dab so it cannot blow the surface apart.

**On a layer.** It changes positions like any brush, so with a sculpt layer
active the stroke is recorded on that layer and the layer's Weight then turns
the added contrast up, down or negative. That is the "contrast as an ordinary
add layer" you asked for, and it needs nothing new in the layer system.

It is the first made tool: built with the editor's parts, shipped as a
built-in, and a proof that a useful tool can be made without new engine code
beyond one effect node.

## 7. Paint brushes on vertex colour

The Paint workspace's six tools become recipes like the sculpt tools. The new
nodes give the brush kinds a painter expects, within what vertex colour can
hold (the detail is the mesh's: a stamp or a grain can be no finer than the
vertices under it).

| A painter's idea | How a recipe makes it |
|---|---|
| Hard round, soft round | Falloff or a Profile curve |
| Opacity against flow (an airbrush that builds up, a marker that does not) | **Stroke cap**: remembers how much each vertex has taken this stroke and stops at the cap |
| A shaped tip (bristles, chalk, a sponge) | **Stamp**: a small grey picture laid in the dab's plane, turned with the stroke or at random |
| Scatter and jitter | **Jitter** on the dab's place, size, turn, strength and colour |
| Grain (canvas, noise) | **Noise** fixed to the surface, multiplied into the weight |
| Smudge | **Colour under the brush** read at the last dab, kept in **Carried colour**, blended in at this one |
| Wet mixing | Carried colour mixed with the brush colour by an amount |
| Dodge, burn, saturate | Blend colour with a blend mode (the 27 modes already in `src/paint/blend.ts`) |
| Clone from a picture | Picture under the brush (Project, today) |
| Pen tilt | a new input, offered to new tools only |

A first set to ship with the editor: Round (today's Paint), Soft airbrush,
Marker, Chalk, Sponge, Stipple, Smudge, Dodge and burn. Each is a recipe, not
code, so the set can grow without a release of engine work.

Later work, not in this plan: painting on textures instead of vertices, PBR
layers and UDIMs belong to Bozzetto Studio.

---

## 8. Speed, and keeping today's tools exact

Three tiers, chosen when a tool is picked, never during a stroke:

1. **Built-in loops.** A recipe whose structure matches a built-in's runs that
   tool's loop as it is today. A copy that changes only settings matches too,
   so every copy is as fast as its original. A test in CI checks that each
   built-in recipe binds its own loop.
2. **Composed loops.** A made tool whose weight is the usual one (distance,
   one falloff shape, the masks) runs one of a small set of hand-written loops
   per effect. Most made tools land here, near built-in speed.
3. **Separate passes.** Anything else runs each node as its own pass over
   pooled buffers. It is slower, and the editor says so ("Speed: slower,
   custom parts") with the last stroke's time per dab.

No code is generated from recipes: the site's content policy forbids it, and a
shared tool file must be data only. Limits hold what a file can ask for: 32
nodes, three effects, eight curves, and whole-object work only in commands.
The runtime allocates nothing per dab; per-vertex stroke memory is pooled per
mesh, not per tool, and is keyed to the level on screen.

**Proof before every move.**

- First the parity fixtures are extended, recorded with today's code, to what
  they do not cover now: symmetry on, dynamic topology on, Negative, a mouse,
  world scale, the Shift and Ctrl swaps, two strokes in a row, the Rake's
  early exits, Twist and Local scale, and the paint tools into a layer.
- Then one tool per change, compared three ways with no tolerance at all: the
  old class, the recipe on its built-in loop, and the recipe forced through
  the general path. Where the general path cannot match the last bit (the
  tools differ in how they take a length or normalise), the general path is
  held to one part in a million and the built-in loop stays the truth.
- The latency suite gates each move: stroke time within 2% at each mesh size.
- While the runtime is being built, the known per-dab waste is removed with
  it: the camera's inverse is computed once per event instead of on every
  projection, and the vertex lists are pooled instead of copied.

What every tool needs from the shell becomes a property of the tool instead of
a test on its number: its **cursor** (ring, dim, dot or tines, including the
Rake's tine preview before the press), whether a **Ctrl tap masks a group**,
which settings the held-key drags and the `;` and `'` keys change (each
setting carries a role: size, strength, spacing), and its own **settings
migrations** (the old strength scale, the Rake's old depth).

---

## 9. The tool editor

Opened from a tool's menu (**Edit…**; on a built-in it offers "Duplicate to
edit") or **New tool…** in the library, starting from any existing tool or
from empty.

- **It replaces the right panel** while open, at panel width, with the model
  live beside it. You edit, make a stroke on your own sculpt, and Undo takes
  the stroke back. Recipe edits have their own Undo in the editor's heading.
- **A column of stage cards**, numbered, in the order of section 5. A closed
  card is one line: the stage, the node's name, its main value. Open, it shows
  the node's settings as ordinary panel rows (scrub, type a value, the curve
  editor).
- **Tap a node's name** to swap it: the list shows only nodes that fit that
  stage, each with one plain line ("Area normal: the average direction the
  surface faces under the brush"). What a node needs is offered in one tap
  ("Needs: Remember this stroke's moves. Add it").
- **Inputs are chosen, not drawn.** Where more than one value fits, the input
  has a small "from" select (Direction from: Picked normal, Area normal, Plane
  normal, View).
- **Effects** hold up to three cards; a long press lifts one to reorder it,
  dragging it off removes it (the dock's gesture), and each has Move up, Move
  down and Remove in its menu.
- **Show in Tool panel**: a switch on each setting decides whether the tool's
  own panel shows it. A **Panel preview** shows the result.
- **See what a node gives**: a Values switch prints each node's numbers from
  the last dab; a per-vertex value can be painted on the model in grey for a
  moment, so a falloff or a grain can be seen where it lands.
- **Problems in plain words** at the top ("Pull to plane has no plane. Pick
  one in Reference."), and a tool with a problem is dimmed on the bar.

**The wired canvas** (step 4) would show the same recipe as boxes and wires in
a window over the view, for recipes the column makes awkward. It is designed
in `drafts/tool-nodes/design-pragmatic.md` §14 and is only worth building if
people outgrow the column.

---

## 10. Order of work

**Step 0. Names and data (nothing visible).** A registry of tools with word
ids; the Tool panel's rows built from each tool's list of settings instead of
one long if/else; the ten place keys; badges and Help reading the keymap;
tests finding tools by `data-tool`. The four settings that are not saved today
(Move's falloff, Crease's pinch, Polish's plane lock and build-up) start being
saved. Check: fixtures unchanged, and a scene saved by the new build opens in
the old one with the same settings.

**Step 1. The dock and the library.** Sections 2 and 3: both bars, the
gestures, the library window, Duplicate, Name and icon,
tools in scenes and `.bztool` files. Still today's tool classes: a copy is
another instance of the same class. Check: touch tests for lift, move, remove
and replace; a copy's strokes equal its original's at equal settings.

**Step 2. The runtime (nothing visible).** Fixtures first, then one tool per
change, simplest first: Pinch, Flatten, Inflate, Clay; Paint, Erase, Blur,
Mask; Fill, Pick, Project; Smooth; Crease; Polish; Twist, Local scale, Drag,
Move; the Rake last. Each is proven as section 8 says, then its old class is
deleted.

**Step 3. The editor and the first made tools.** Read-only first ("How this
tool works" on every tool, which is also good Help); then swapping nodes,
inputs, Show in Tool panel and saving; then Contrast and the first paint
brushes, built with it.

**Step 4. The wired canvas.** Only if needed.

**Later.** Pen tilt and finer pointer sampling as inputs for new tools only
(they would change how the built-ins feel); tools shared through the
Community; a combined undo so one tool may change shape and colour together.

Steps 0 and 1 can start now. The one open point, how Smooth and Mask are
reached without a keyboard, does not hold them up.

---

## 11. Decisions (Vidar, 2026-11-17) and what is still open

Recorded in `docs/HANDOFF.md` as well.

1. **Where the library opens:** a Library button in the Tool panel's heading,
   and View › Tool library.
2. **The editor:** a column of stage cards; the wired canvas later or never.
   A thumbnail of the tool's stroke on a plane is worth trying.
3. **Moving a tool along the bar:** dock style; the others make room and the
   keys follow.
4. **A full bar:** more than ten tools are allowed; only the first ten have
   number keys.
5. **Smooth and Mask without a keyboard:** still open. Possibly bar tools;
   buttons beside Carve may suit modifiers better.
6. **Smooth's settings:** each tool picks its own Smooth mode; the size comes
   from the tool in hand.
7. **Copies:** a copy follows later fixes to the tool it came from.
8. **Twist and Local scale:** in the library.
9. **Calipers:** keeps its place beside Transform and its C key.
10. **Move's "Pressure: strength" row:** dropped.

## 12. What comes from which draft

Both reviews chose the **pragmatic** design as the base: the dock and copies
first on today's classes, tools ported one at a time behind bit-exact checks,
no generated code, the canvas last.

Taken from **stages**: the fixed, numbered stage column and the editor in
place of the right panel; nodes filtered to the stage, with what they need
offered in one tap; the composed loops as the middle speed tier; the test that
each built-in binds its own loop; the speed line in the editor; the limits on
what a file may ask for.

Taken from **dataflow**: the rates and the three rules of section 5; a stop
that may or may not still update the surface, and which memory writes it
cancels (the Rake needs both kinds); undo chosen from what is written,
dynamic topology included; settings with roles; matching a copy to its
built-in loop by structure; painting a per-vertex value on the model; Tap and
Once as kinds of stroke.

Added here, not in any draft: the Paint workspace and its own bar; layers as
part of the fixed outline (sculpt layers, paint layers, layer masks, fill
layers and groups); the paint nodes of section 7; Contrast; the cursor and the
group tap as properties of a tool (the reviews' first two gaps); settings
migrations per tool; stroke memory keyed to the level on screen; and the
per-dab clean-up. Phone layouts are left out: phones are not a target.
