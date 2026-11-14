# Plan: References, and Measure (proportions and calipers)

Status: draft for Vidar, 2026-11-14. Nothing is built.

Two features for the sculptor at the iPad, both about seeing the form
correctly rather than making it:

1. **References**: a board of pictures beside and over the work, in the spirit
   of PureRef, with pictures taken by the iPad's camera when out and about.
2. **Measure**: real heights, a proportion guide in heads, and a calipers
   tool that measures between two points in 3D.

Neither changes the geometry. Both are saved with the scene.

---

## 1. References

### Where it lives

A new tab on the right, **Reference**, after Tool and before Render in Sculpt
and Armature. It is about what you look at while you work, which is what the
right side already serves (the tool in hand, the light). Not in Present or the
viewer at first.

On a phone the one-panel rule holds: opening Reference closes the panel on the
other side.

### The board

The panel holds the scene's pictures as a grid of thumbnails, newest first,
with a row of actions at the top:

- **Add picture…** opens the system picker. On iPad and iPhone the same picker
  offers Photo Library, Take Photo and Choose File, so taking a picture out and
  about needs nothing extra. (`<input type="file" accept="image/*">` with no
  `capture` attribute, so the choice stays with the person.)
- **Paste**: an image on the clipboard is added (Edit > Paste, Ctrl+V).
- **Drop**: pictures dragged onto the panel or the view (iPad split view,
  desktop).

A picture in the grid has a row menu: Show over the view, Show beside,
Mirror, Greyscale, Delete. Delete asks nothing and is undone by Undo, as
deleting an object is.

### Showing a picture

One picture is "on" at a time, shown one of two ways:

- **Beside**: a floating window over the view's corner, sized and moved by its
  title bar like the hotkey guide, with pinch to zoom and two fingers to pan
  inside it. This is the PureRef part: a picture you glance at.
- **Over the view**: the picture fills the view behind the model (as a
  backdrop) or in front of it at an opacity (as a tracing film). A slider sets
  the opacity, a switch sets behind or in front. Lined up with a front or side
  camera, this is how a sculptor checks a silhouette and proportions against a
  photo.

In both, **Mirror** flips the picture left to right and **Greyscale** drops
the colour, so values can be judged alone.

### Pencil and touch rules

- A picture over the view never takes the Pencil: strokes go to the model
  through it. It is moved and scaled only from its own panel row (and with
  two fingers while its row is selected, never by default).
- The beside window takes touches only on its own frame; the Pencil on the
  model around it sculpts as always.
- Tab hides the beside window with the rest of the interface; a picture over
  the view stays (it is part of what you are looking at), with its own switch
  in View: **Reference over the view**.

### Storage

- Pictures are stored with the scene: in the autosave (IndexedDB, as the scene
  is, only when keeping on the device is on) and inside the `.bozz` file and a
  library project, so a study opens with its references.
- Each picture is downscaled on import to at most 2048 px on its long side and
  stored as JPEG (quality about 0.85; PNG kept only when it has transparency),
  so a board of ten photos stays well under the size of the sculpt itself.
- Location data in photos (EXIF) is dropped on import. Nothing is uploaded
  anywhere except as part of a project the person saves to the library.

### Later, not in the first build

- A shared board across scenes ("My references").
- Several pictures over the view at once, placed in 3D on planes (front, side,
  top), as in modelling apps.
- An eyedropper from a picture into the colour picker (belongs with painting).

---

## 2. Measure

### Real units first

New scenes are already in real units (centimetres). A scene opened from an OBJ
without units asks Set scale. Measure works only in a scene with real units;
in one without, its controls say "Set the scene's scale first" with a button
for it.

### Proportion guide

A guide drawn in the view beside the active object, in **View > Proportion
guide** and in a **Measure** section of the Model panel:

- A vertical line from the floor to the top of the object's bounds, with its
  height in centimetres at the top.
- **Head height** in cm, set by typing or by picking: Pick head asks for two
  taps on the model (crown, chin) and fills it in.
- Tick marks every head along the line, numbered 1, 2, 3… from the top, and the
  total as "7.5 heads" next to the height.
- **Canon** presets set the head count a figure should be and draw a faint
  target line at that height: 7½ heads (natural), 8 heads (idealised), 8½
  (heroic), plus Custom. Choosing one does not resize the model; it shows where
  the model stands against it.
- Optional landmark ticks for the chosen canon at the common divisions (chin,
  nipples, navel, crotch, knees), labelled only on hover or tap so the guide
  stays quiet.

The guide stands on the floor plane at the object's side facing the camera,
turns with the view so it always reads, and is hidden by Tab with the rest of
the interface. It is drawn in the interface's grey with orange only for the
selected tick or value, as Gestalt v2 asks.

### Calipers (the Measure tool)

A tool in the tool bar, **Calipers**, with its own hotkey, used like a
sculptor's callipers:

- Tap or Pencil on the model to set the first point, then the second. A line
  joins them with its length in cm (to one decimal) at its middle; the points
  snap to the surface.
- Drag either end to move it along the surface. A third tap starts a new
  measurement and keeps the last one until another tool is picked.
- **Pin** keeps a measurement in the scene (it is saved with it), so two sides
  can be compared: pin the left forearm, measure the right. Pinned ones are
  listed in the Measure section with their lengths, and can be renamed or
  deleted there.
- With symmetry on, a measurement can be mirrored to the other side with one
  button, and the two lengths are shown together with their difference.
- **Distance** is the straight 3D distance between the points. A later
  **Along surface** option (a geodesic, like a tape measure) is listed below as
  later work.

Calipers changes nothing on the model; Undo does not step through
measurements, but deleting a pinned one can be undone.

### The icon

Uicons (the app's one icon set) has rulers and a measuring tape but no
calipers. Two choices:

- draw a calipers glyph in the same solid, straight style as an SVG, kept with
  the few SVG icons the tool bar already uses; or
- use `fi-ss-ruler-combined` until a drawn one is ready.

Recommended: draw it, since the tool bar is where it will be seen most.

### Later, not in the first build

- Along surface (geodesic) distance.
- Angles between three points.
- Measuring in Present and in the viewer, for published pieces.
- A proportion guide driven by the armature's own joints in Armature.

---

## 3. Sculpt layers (where they would go)

Painting is planned as its own mode later, so paint layers wait for it. Sculpt
layers belong to the model, so they belong on the left with the model's own
things: a **Layers** section at the top of the Model panel (or its own left tab
if it grows), with a strength slider per layer, show/hide, and the active layer
taking strokes. Not part of this plan; noted so the right side's new tab does
not take its place.

---

## 4. Build order

1. **Measure, part one**: the proportion guide and head height (no new tool,
   no new storage beyond a few numbers in the scene's settings). Smallest, and
   it uses real units already in place.
2. **Calipers**: the tool, its icon, pinned measurements saved with the scene.
3. **References**: the tab, the board, beside and over the view, storage in
   autosave, `.bozz` and the library.

Each step: an e2e suite (taps and Pencil on the model, saved and reopened
scene, Tab hiding, phone width), README Unreleased line, Help topic, and a look
at it on the iPad before the next step.

## 5. Questions for Vidar

See `docs/HANDOFF.md`, Open questions, entries dated 2026-11-14 about
References and Measure.
