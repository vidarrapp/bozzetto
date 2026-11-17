# Bozzetto interface spec

How Bozzetto's interface is laid out and behaves, on Gestalt v2. It is
written for Bozzetto Web first and for the desktop version after it: both
are built from this one document. Colour, type and the look of each
control come from Gestalt v2 (`README.md` and `bozzetto-interface.md` in
the system) and from the "Controls and states" board on the mockup canvas.
This spec adds structure and behaviour, and says where the mockup should
change.

**The look is now set by `docs/ui-foundations.md`** (2026-11-11): a grey
scale, hover, separators, raised menus, red for errors, dark theme only.
Where this spec describes how something looks (outlines on controls,
the bold hovered menu row, the paper theme) the foundations win. Layout
and behaviour here still hold.

Written 2026-11-10. Sections marked **Proposed** depart from the mockup or
the system as they stand and wait for the owner's yes (see Decisions).

## 1. What it was measured against

The mockup was compared with the system and with how current
professional apps solve the same problems.

| Question | Final Cut Pro (Mac, iPad) | Figma | iPad sculpting and painting apps | Bozzetto takes |
| --- | --- | --- | --- | --- |
| Where the commands live | The system menu bar on the Mac; a compact toolbar on iPad | In-window menu on the web, the system menu bar in the desktop app | Icons that open popovers | One list of commands, shown as an in-window bar on the web and as the system menu bar on the desktop |
| Where settings live | One inspector on the right, with tabs, showing what is selected | Structure on the left, properties on the right, one panel each | Popovers from the top bar | A tabbed panel on each side, one open per side |
| Tools | Tool menu in the toolbar | A bar at the bottom centre | A column or bar at an edge | The bar at the bottom centre |
| Brush size and strength | Not applicable | Not applicable | Upright sliders on the edge by the free hand | Upright sliders on the left edge, tall enough for a thumb |
| Size of controls on iPad | Larger rows than on the Mac, for fingers | Mostly a desktop app | Small, dense controls, because the Pencil is precise | One size for pen and mouse; nothing sized for a finger |
| Hiding the interface | Full-screen viewer | Hide UI command | Full-screen toggle | Hide interface, in View and on a key |
| The main outward action | Share, top right | Share, top right | Export in a menu | Publish, top right |
| What you are working on | Project name in the title area | File name in the title area | Not shown | Project name and the object readout in the title strip |

## 2. Evaluation of the mockup

### What holds up and stays

- The full-screen viewport with the interface around its edges.
- The split of the four panels: Scene and Model on the left (what is in
  the scene, and the selected object), Tool and Render on the right (how
  the tool behaves, how the picture looks).
- Panels only as tall as their content, translucent, with the opacity as a
  preference.
- The tool bar at the bottom centre, icon only, the active tool in orange.
- Fields in the Blender manner: label left, value right, the amount as an
  orange line; drag to change, double-click to type.
- Upright brush sliders on the left edge.
- Menus that read like any application's: hung under their name, the
  hovered row bold, reasons on unavailable items, submenus.
- The view axes with the symmetry plane.
- Black, white, orange and lime, with lime for switches and orange for
  what is active.

### What should change

1. **Nothing says which project is open or whether it is saved.** Every
   app compared shows the document's name at the top. The title strip
   gains the project name and its saved state.
2. **The system's 44px target rule does not fit a pen app.** Stacked
   28px rows cannot each have a 44px target, and with a Pencil nothing
   needs one. The rule does not apply to Bozzetto (section 4).
3. **Four panels that can all be open at once do not fit a laptop or an
   iPad.** Two open on one side each get half the height and both scroll.
   Final Cut and Figma show one panel per side and switch by tab. One
   open panel per side, with folder tabs (section 6).
4. **The menu bar is a web answer.** On the desktop the same commands
   belong in the system's menu bar, and on iPad in the system's menu.
   The spec defines commands once and lets each platform show them its
   own way (section 5).
5. **Help was a "?" icon; it is now a menu.** The order is File, Edit,
   View, Help. The "?" icon goes.
6. **The brush sliders are 96px tall and 16px wide in the mockup.** They
   become 160px tall with a 44px wide drag zone, and a left-handed
   setting moves them to the right edge.
7. **Hotkey digits and key hints assume a keyboard.** On an iPad without
   one they are noise, and a web page cannot tell whether a keyboard is
   attached. Both become View toggles, on by default with a mouse and
   off by default on a touch screen.
8. **Section headers carry numbers ("01 Material").** A number implies an
   order to follow, and folding sections have none. Inspectors in the
   apps compared use the name alone. The numbers are dropped.
9. **Publish is three levels down.** It is the app's one outward action.
   Final Cut and Figma keep theirs at the top right, and so does this.
10. **Long operations have no shape.** Remesh, quad remesh, save and
    export need a progress line and a Cancel (section 9).
11. **There are no context menus.** Right-click on the Mac and long-press
    on iPad are how people expect to reach an object's commands
    (section 7).

## 3. Principles

1. **The work comes first.** The viewport fills the window. Every part of
   the interface can be hidden, and hiding is one command.
2. **One home for each thing.** A setting lives in one panel and a
   command in one menu. A control is never shown twice at once.
3. **Surfaces are boxes, controls are outlined.** A panel, a tab, the
   tool bar, a menu and the title strip are plain `ground` boxes with no
   outline. A 1px outline means "this can be pressed or filled in": a
   panel button, a select, an input, a switch, the Create tile, a window,
   a notice.
4. **One size for a pen and a mouse.** The iPad and the desktop show the
   same controls at the same sizes.
5. **Commands are defined once.** The menus, the hotkeys, the hotkey
   guide, context menus and Help all read from one list.
6. **The platform's conventions win over invention.** Menu order, key
   names, where Settings lives, how a window closes: as the platform
   does it.

## 4. Size and input

**One size, for a pen and a mouse** (owner call, 2026-11-11). Bozzetto on
iPad is used with an Apple Pencil, which points as precisely as a mouse.
Painting apps built for the Pencil keep small, dense controls for that
reason. So the iPad gets the same sizes as the desktop: 28px rows and
panel buttons, 13px labels, 11px values, the 24px title strip. There is
no separate touch density. An earlier draft of this spec had one, with
44px rows; it made the panels huge and is withdrawn.

- **Fingers only navigate.** Orbit, pan and zoom are the fingers' job.
  Every control, the tools included, is pressed with the pen, a mouse or
  a hotkey (owner call, 2026-11-11). So no control is sized for a
  finger. The tools stay at 44px and the edge controls at 40px because
  that is how they are drawn, not as touch targets.
- **Brush sliders.** 160px tall on the left edge, slim, with a 44px wide
  drag zone, as the edge sliders of a painting app are. (The mockup's
  first drawing had them at 96px.)
- **Slider rows.** The whole row is the touch target (owner call,
  2026-11-13): press the name, the value or the line and drag sideways to
  move the value from where it is, the row's width being the slider's
  whole travel. A tap changes nothing, and a drag up or down scrolls the
  panel. A double press still opens the number field. On a touch screen
  the line ignores presses itself; a mouse on a desktop keeps the plain
  slider (click to jump). The brush sliders on the left edge have their own
  drag. Depth of field (Enabled, then Aperture and Focus) is the last part
  of the Render panel's Camera section, not a section of its own.
- **One Render panel.** The same everywhere (owner call, 2026-11-14:
  "consolidate the render panel so it matches everywhere"): Sculpt,
  Armature, Sculpt's Present, the Present workspace, the public viewer and
  review mode. Sections Lighting, Camera (with depth of field),
  Environment, Ambient occlusion, in that order; the full per-light rig;
  a Reset look button, which goes back to the look the scene or project
  opened with (in the viewer, the published look; the view stays, and a
  visitor's changes are never saved). Material is never in it: it is the
  Material tab at the right in every place, the viewer and review mode
  included (Display section only, as in Present). What a place cannot do
  stays out of the panel, not out of the order: Cavity (SSAO) only in plain
  Sculpt, Pedestal and Floor offset only where the floor allows them, and
  the Developer section only with ?dev. The viewer's tab row is Material and Render at
  the right, nothing at the left, and fits a 390px phone.
- **Keyboard.** A web page cannot tell whether an iPad has a keyboard
  attached, and the iPad runs the web app. So the hotkey digits on the
  tools and the key hints above the tool bar are two View toggles
  ("Hotkeys on tools", "Viewport hints"), on by default with a mouse and
  off by default on a touch screen, and remembered.
- **Pen.** Hovering with a pen shows what hovering with a mouse shows.
  A long press with a pen or finger opens the context menu, and on a tool
  shows its name.
- **Left-handed** (Preferences): the brush sliders and the corner
  controls move to the right edge, and the view axes to the left.

## 5. Commands and menus

A command has a name, an action, an optional hotkey, an optional reason
it is unavailable, and for toggles a checked state. The existing keymap
grows into this list.

**Where commands show**

| Platform | Menus |
| --- | --- |
| Web | An in-window bar at the left of the title strip |
| Mac desktop | The system menu bar: Bozzetto, File, Edit, View, Window, Help. About, Settings and Quit move to the Bozzetto menu, as the Mac expects |
| Windows desktop | An in-window bar, as on the web. Preferences stays under Edit |
| iPad | The web app, so the in-window bar |

**The menus, in order**

Groups are separated by space. `›` opens a submenu. Hotkeys are the
defaults and follow the platform's names.

**One shape in every place.** Sculpt, Armature, Present (from Sculpt and
the workspace) and the public viewer, review mode included, have the same
menus in the same order: File, Edit, View, Moderation (the viewer only,
and only while it has an item), Help. An item the place has no action for
is left out, not shown greyed out; the same item has the same label, hint
style and key wherever it shows. The groups below are the order in every
place, each only where the place has it.

- **File:** New (New sculpt, New armature), Open…, Open recent (Sculpt, Armature and the Present workspace; not the viewer); Rename… (Sculpt and
  Armature), Save file, Save to library (for whoever can save to one; a
  guest sees **Sign in to save to library** instead where the site has
  accounts, and nothing extra where it has none), Keep on this device
  (the Present workspace has one Save, or Save to its place); Import OBJ…, Z-up OBJ import, Load model…, Export
  OBJ, Send to Sculpt, New sculpt from this, Edit in Present; Publish…;
  Close, always last, with the page it returns to as its hint.
- **Open recent** is a row with a chevron that opens a second list beside
  the menu (flipped to the left at the screen's edge; on a phone it takes
  the menu's place, with a Back row on top). Right or Enter opens it, Left
  or Esc closes just it. It lists up to 10 projects, newest first, one list
  for every mode: a library project, an armature project, a published
  project opened in the Present workspace, a scene kept on this device. Each
  row is the name with "Sculpt · My projects · 2 hours ago" under it. A file
  opened from disk is not listed (an iPad cannot reopen one). A project that
  is gone is said so in a notice and leaves the list; "Clear list" is the
  last row. Greyed out with "Nothing opened yet" while empty. Only ids, kind,
  place, name and time are kept, through the device storage choice; signing
  out clears the entries that needed the account.
- **Edit:** Undo, Redo where the place has undo; the place's own items;
  Preferences… last, in every place. The viewer and the Present workspace
  have Preferences… alone.
- **View:** Frame selected (where there is a selection), Frame all;
  Wireframe, Shadows, Poly group colours and Hotkeys on tools (Sculpt);
  the panel toggles for the tabs the place has, then Hide interface; then
  Armature, Sculpt and Present where the place has the workspace path, the
  one you are in and any that cannot be reached greyed out with the reason.
  In the viewer there is one subject, so one Frame all, on F. Cycle ground
  is G only, and stays in the hotkey guide.
- **Help:** Help topics, Hotkeys, About and credits, from one list.

**File**

- New sculpt
- Open…
- Open recent ›
- Close (returns to the gallery)

- Save
- Include references (a switch, on by default; Save file only: Save to
  library and Publish never carry pictures)
- Save a copy to this device
- Save to library

- Import ›  OBJ…, with "Z-up" as a checked item in the submenu
- Export ›  OBJ

- Publish…

**Edit**

- Undo
- Redo

- Duplicate
- Delete
- Merge (says "Needs 2 objects" when it cannot)

- Paste picture (adds the clipboard's picture to the Reference panel)

- Mirror ›  Across X, Across Y, Across Z
- Radial copies ›

- Preferences… (on the Mac: Settings…, in the Bozzetto menu)

**View**

- Frame selected
- Frame all

- Wireframe
- Poly group colours
- Viewport hints
- Hotkeys on tools
- View axes

- References (a switch: shows or hides every picture in the view)
- Arrange references (a switch, Alt+R in Sculpt: unlocks the pictures in the
  view so they can be moved, scaled and set up; locks them again)

- Scene panel
- Model panel
- Layers panel
- Material panel
- Tool panel
- Reference panel
- Render panel
- Hide interface

- Present mode

Every toggle in View carries a check, so the menu keeps a check column.

**Help**

- Help topics
- Hotkeys

- Check for updates
- About and credits (on the Mac: About Bozzetto, in the Bozzetto menu)

Commands on one object's parts (split groups, delete hidden) stay in the
Model panel, not in a menu. Every place has the three Help items.

**The pages' menu.** The gallery, Community, member pages, My projects,
Account, Review and Owner tools have the same title strip as the
workspaces (same height, look, phone rules), made by `src/ui/pageNav.ts`
from `TitleStrip` with its `page` option: no hide button, no workspace path.
There are no corner chips and no logotype in the row (the gallery keeps its
big logotype and tagline in the page).

- **File:** New sculpt, New armature, Import OBJ…. What the gallery's
  Create card offers, with the same question about saving on this device
  that Import OBJ asks.
  The Create window lists New Sculpt (the one recommended, lime choice),
  New Armature and Import OBJ; Create timelapse is added for the owner only
  (timelapses are not offered to users, PRODUCT.md).
- **View:** Gallery, Community (with accounts), My projects (signed in, not
  suspended), Review with what waits in its name (owner and moderators),
  Owner tools (the owner). Each only for whoever may see it today; the page
  you are on has the check.
- **Help:** the same three items. Hotkeys opens the guide on a page too.
- **Middle:** the page's name: Gallery, Community, @handle, My projects,
  Account, Review, Owner tools.
- **Right:** a guest sees Install (where shown today) and Sign in as strip
  buttons; signed in, the @handle menu (Account, Sign out); a suspended
  account sees Suspended, which says why, and Sign out.
- **The @handle menu** is also at the right end of every workspace and
  viewer strip when signed in, last before the hide button. Star, Publish,
  Save and Not saved stay to its left.

**The document never scrolls.** On a page html and body are the screen's
height and the strip is fixed at the top; the content scrolls inside its own
container below it (`.page-scroll`), and in the workspaces and the viewer
nothing scrolls. iPadOS 26 blurs whatever sits at the top edge once the
document itself scrolls, and there is no CSS switch to turn that off.

## 6. Layout

```
┌──────────────────────────────────────────────────────────────┐
│ File Edit View Help    Project · state            Publish │  title strip
├─────────────┐                                   ┌─────────────┤
│ Scene Model Layers   │      │ Tool Material Reference Render │  tabs
│┌───────────┐│                                   │┌───────────┐│
││   open    ││            viewport               ││   open    ││  one open
││   panel   ││                                   ││   panel   ││  per side
│└───────────┘│                                   │└───────────┘│
│ size   │                                          │          │
│ strength         hints (keyboard only)            │          │
│ solo undo redo  ┌────────────────────┐      axes  │          │
│ negative        │      tools         │            │          │
└─────────────────┴────────────────────┴────────────┴──────────┘
```

### Title strip

- Left: the menus (web, Windows, iPad). On the Mac desktop this space
  holds the window's close, minimise and zoom buttons instead.
- Centre: the project's name in bold. The object's numbers are not here:
  they are the details overlay's (below). In
  Sculpt and Armature the name is always there: a new scene is named as a
  dated study ("Study 14 Nov", with " 2" and so on when this device's
  scenes have one by that name). Tapping it puts a field in its place
  (Enter or leaving it renames, Esc keeps the old name); File > Rename…
  does the same. After the name, in regular weight and the quiet grey, one
  state word: **Saved** (matches its last save to the library),
  **Edited** (has changes the library does not), **Kept on this device**
  (only the autosave has it), or none while saving is off, when the
  strip's own **Not saved** at the right says so, once. Other places show
  "Edited" after an unsaved project's name.
- Right: Publish, a quiet button, then the signed-in account's @handle menu, then the hide-interface icon.
- It is the one band that runs edge to edge.

### Details overlay

- Plain text at the top left of the 3D view in Sculpt and Armature: no box,
  no background, only the view's faint soft shade under the letters (no outline), 11 to 13px, Familjen Grotesk for names and labels and Martian
  Mono for numbers; values in the light text colour, names in the second one. One fact a line, only those that
  apply. Sculpt: the active object's name, Tris, Quads (when the mesh has
  quads), Verts, Level n of m (when it has levels), Objects n (with "n
  selected" when more than one is), Size height by width by depth in cm
  (real units only), Symmetry X, Y or Z when on, Masked n% when anything is
  masked, Hidden groups n, and Layer (the active layer's name, Base when the
  base is active) when the object has layers. Armature: the figure's name,
  Height, Tris, the selected joint or handle, Symmetry when on.
- It stands under the strip and the tab row. With a left panel open it moves
  to the right of the panel. Tab hides it with the left side of the interface.
- It never takes input (pointer-events none): the Pencil and fingers reach
  the model through it. View > Details (key Shift + I) shows and hides it;
  on by default, kept on the device. It is not the frame meter (P).
- Numbers are written when they change (selection, stroke end, subdivide,
  level change, mask change, layer change; read twice a second), not per frame.

### Panels

- Each side has one panel, docked under the title strip (owner call,
  2026-11-11: one panel open per side, with folder tabs). Material is on the
  right everywhere (owner call, 2026-11-17). Tab order, left to right.
  Sculpt: left Scene, Model, Layers; right Tool, Material, Reference,
  Render. Armature: left Armature; right Material, Reference, Render.
  Present from Sculpt: right Material, Render, Output. The Present
  workspace: left Frames, Project; right Material, Render, Output. The
  viewer and review mode: right Material, Render, nothing at the left. The
  View menu lists the panels in this order. Material and Render share a
  side, so opening one closes the other.
- **A phone** (599px and narrower, a finger). The open panel is a sheet
  docked at the bottom: the full width, at most half the window tall, above
  the tool bar or transport, scrolling inside; the 3D view is not resized and
  its upper half stays clear for the Pencil and fingers. The tabs of both
  sides share one row (up to three left, four right) set smaller with a
  44px least width, and tighter again where a narrow screen needs it. The
  tool bar fades at the edge where more tools are out of sight. Every word
  and button in the strip has a 44px hit area while the strip stays 32px.
  The viewer's strip keeps the project title, cut with an ellipsis. The
  step you are in opens a small list of the three workspaces.
- **Folder tabs.** Above the panel sit its two tabs, each a box of the
  panel's own surface, 2px apart. The tab that is showing is 28px tall,
  joined to the panel with no gap, its name bold. The other is 26px
  tall, so it stops 2px short of the panel, its name regular: a tab
  behind, still plainly a thing to press.
- Pressing the other tab swaps what the panel shows. Pressing the tab
  that is showing closes the panel; there is no separate close button.
  Closed, both tabs stay at the edge as two 26px boxes, and pressing one
  opens the panel on it.
- Under the tabs the panel's heading names what it is about: the
  selected object in Model, the tool in hand in Tool.
- A panel is 304px wide and as tall as its content, up to 16px above
  whatever sits below it on that edge; past that it scrolls inside.
- Each panel remembers which of its sections are folded, and which panel
  was open on each side, per mode.
- The desktop version may later let a side show both panels at once on a
  tall display. It is not part of this spec.

### The Reference panel

Pictures to look at while you work (`src/reference/`), on the right after
Tool and before Render.

- **Top:** Add picture… (the system picker, no `capture` attribute, so an
  iPad offers Photo Library, Take Photo and Choose File) and Paste. Ctrl or
  Cmd+V adds a picture while the panel is open; Edit > Paste picture does it
  from the menu. A picture dropped on the panel is a tile on the board; one
  dropped on the view is added and placed in the view where it fell. Under
  them, one button, **Arrange** / **Lock**, greyed until a picture is in the
  view.
- **Board:** a two-column grid of thumbnails, newest first, square corners.
  The tile whose picture is in the view has the grey selected fill (orange is
  for focus only). Under each: its name, what is on it (In view, Mirrored,
  Grey) or its size in mono, and a **More** row menu: Place in view (Remove
  from view when it is in), Match view (greyed with the hint "Lock the picture
  first" until the picture was locked in the view), Mirror, Greyscale,
  Delete. A tap on a tile only selects it. **A tile is dragged into the
  view**: the picture follows the finger, the Pencil or the mouse, is placed
  where it is let go at a default size, and Arrange turns on. A mouse or the
  Pencil starts the drag on a move of 6px; a finger starts it after a hold of
  350ms or a clear sideways move (14px, mostly across), because the panel
  scrolls up and down under a finger. Delete asks first, in a window whose button is
  red; the app's Undo is the stroke history and does not hold pictures.
- **One kind of picture in the view.** A reference in the view is a floating
  picture with a place, a size, an opacity, a blend mode, mirror and
  greyscale; several may be there at once. Small in a corner at Normal 100%
  is a picture to glance at; fitted across the view at Multiply 30% is a film
  to trace on. The place is stored relative to the centre of the view (in
  units of its shorter side), so it survives a resize or a turn of the device.
- **Blend modes.** The Look pop-up has a select in Photoshop's order and
  groups (`src/ui/blendModes.ts`, shared with the Paint workspace's layers):
  **Behind** first (drawn behind the model by the viewer), then the modes the
  browser can blend live over the 3D view, as an element with
  `mix-blend-mode` over the canvas: Normal | Darken, Multiply, Color Burn |
  Lighten, Screen, Color Dodge, Linear Dodge (Add) | Overlay, Soft Light, Hard
  Light | Difference, Exclusion | Hue, Saturation, Color, Luminosity. Opacity
  applies to every mode. Only the topmost Behind picture is drawn behind the
  model.
- **Arranging (unlocked).** Putting a picture in the view turns it on. Every
  picture in the view has a thin outline, four corner marks and a row of
  five icon buttons at its top edge (inside the top edge when there is no
  room above), each 44px with its name on hover and long press: **Lock**
  (ends arranging for all pictures), **Fit** (fill the view, keeping the
  aspect), **Flip** (mirror), **Look** (a small pop-up: blend mode, Opacity,
  Greyscale), **Remove from view** (a cross; the picture stays on the board).
  A finger, the mouse or the Pencil drags a picture to move it; a pinch or
  the wheel scales it; a corner is dragged to resize it, the opposite corner
  staying. Arranging is not kept: a scene opens locked.
- **Locked.** No outlines or icons, and every picture is `pointer-events:
  none`: the Pencil, fingers and mouse reach the model as if nothing were
  there. Locking keeps the camera (position, target, lens) with each picture
  in the view; **Match view** in a tile's menu puts the camera back.
- **Arrange button.** A lock in the left edge column with Solo, Undo, Redo and
  Negative (in Armature, beside Undo and Redo), shown only while a picture is
  in the view: neutral when locked, an orange icon (no square) while
  arranging; a tap toggles. **View > Arrange references** and the top button
  of the panel do the same.
- **Input.** The picture layer is never an input target. Only the frames
  drawn while arranging take a pointer, and only on the pictures themselves,
  so the model outside them is worked as always. Tab hides the outlines and
  icons with the interface; the pictures stay, until **View > References** is
  switched off. Present shows none.
- **Keeping.** On this device only, never uploaded: in the browser's storage
  beside the autosave (keyed by the scene, and by the library project's id
  too, so reopening that project here brings them back) when keeping on the
  device is on, for the page when it is off. A new sculpt starts with none.
  Save file carries them with **File > Include references** (on by default);
  Save to library and Publish send the scene alone, and a thumbnail or saved
  image is drawn without a picture behind the model. A project opened on
  another device opens without them, and the note under the grid says
  "References stay on the device they were added on."
- **Import.** At most 2048px on the long side, JPEG at quality 0.85 (PNG only
  with transparency), and no metadata: the picture is drawn again on a canvas,
  which drops EXIF, its place and time included.

### Tool bar

- Bottom centre, flush to the edge, as wide as its tools.
- Where it does not fit (under about 620px wide) it scrolls sideways and
  keeps the active tool in view.
- On devices with a home indicator it sits above the safe area.
- On a phone, where it scrolls, it fades at each edge that has more tools
  behind it and snaps to the tools as it scrolls.
- **Calipers** (hotkey C) is the last button, after Transform. It is not
  a brush: it measures between two points on the model and edits
  nothing. Its icon is the Uicons ruler until a drawn calipers glyph is
  dropped in as `icons/calipers.svg` in the tool bar's icon folder. In
  a scene without real units its Tool panel says "Set the scene's scale
  first" with a Set scale button.
- **Calipers on the view.** A line with an end dot at each point, drawn
  over the model with a dark halo so it reads on pale clay and on the
  dark ground; the length in centimetres to one decimal in a small
  label at the middle, in the mono face on a raised grey box, kept
  inside the view. The one being made carries a Pin button in its
  label. Orange appears only on the end held by the pen or a finger. A
  pinned measurement is a lighter grey, a mirror is dashed. All of it is
  interface: Tab and Present hide it. It never takes the Pencil away from
  the model, and two fingers still navigate.
- **Measure section** (Model panel, after Poly groups): the pinned
  measurements of the selected object, a row each with its name (tap to
  rename), its length in the mono face, a mirror toggle, the eye and the
  trash. A mirrored one shows a line under it with the other length and
  the difference. A delete is not a sculpt undo step; the section
  offers Undo for the last one deleted.

### Edge controls

- Left edge, bottom up: Negative, Undo, Redo, Solo, then the brush
  strength and size sliders. No box behind them; each is black or white
  from the brightness of the picture behind it.
- Size and strength show only while the Tool panel is closed, and for a
  moment when changed by a hotkey while it is open.
- Undo and Redo are always shown (owner call, 2026-11-11), as well as
  being in Edit.
- Right edge, bottom: the view axes. They only show; they are not
  pressed (owner call, 2026-11-11).

### Narrow and short windows

| Window | Change |
| --- | --- |
| Under 1100px wide | One panel open in all, not one per side |
| Under 600px wide (a phone) | Not a target platform (owner, 2026-11-17): it works for a quick demo, and panels open as they do on an iPad. Tabs are one row under the title strip, set a little smaller so they fit; the step you are in opens a list of the workspaces |
| Under 600px tall | Hints hide; panels use the full height between the strip and the tool bar |

## 7. Controls

The look and the states of every control are on the "Controls and
states" board. This section adds behaviour.

- **Field.** Drag along the row to change. Double-click or press Enter to
  type; Enter accepts, Escape restores. Shift drags fine, Ctrl or Cmd in
  steps. A value with no upper limit shows no orange amount. The arrow
  keys change a focused field by one step.
- **Reset.** A field's context menu has "Reset to default". A value that
  differs from its default shows its label in bold (**Proposed**), so a
  changed setting can be found at a glance.
- **Switch, select, presets, panel button, section header:** as the
  board shows. A select opens a menu of the same kind as the title
  strip's menus.
- **List row** (objects, poly groups): the selected row is inverted.
  Rows are renamed in place by double-click. Icon buttons at the row's
  right (show, hide) are 16px with a row-high target.
- **Context menu.** Right-click, or a long press. The same component as
  a menu. On an object row: Rename, Duplicate, Delete, Solo, Hide. On
  the viewport: Frame selected, Frame all, and the display toggles. On a
  field: Reset to default, Copy value, Paste value.
- **Tooltip.** Every icon-only control shows its name, and its hotkey
  when a keyboard is present, after 600ms of hover or on a long press.
  Plain text, no box, placed beside the control away from the edge.
- **Hover** changes the pointer and nothing else, except the bold row in
  a menu.
- **Focus** is the 2px outline. Tab moves between controls inside a
  panel or window; F6 moves between the title strip, the panels and the
  tool bar.

## 8. Viewport hints and modifiers

- The keys that change the current tool (Shift Smooth, Ctrl Mask, Alt
  Carve) sit above the tool bar, each key in a hairline box, when
  "Viewport hints" is on in View.
- Holding a button with the free hand to smooth, mask or carve while the
  pen draws cannot be done reliably in a web page on iPad (looked into
  before; it needs a native app). Touch keeps what it has today: the
  Negative button, and Smooth and Mask reached as they are now. The
  desktop and any native iPad version can revisit it.

### Armature handles

The figure's controls are outlines, as an animation program draws control
curves, not balls (owner decision, 2026-11-14 and 2026-11-17). Every
handle is neutral (`--bz-text-2`, white under the pointer) and orange
(`--bz-orange`) only while selected or dragged. Each is drawn over the
figure, with a stroke of 2 px (3 px when orange) and a thin dark casing
(`--bz-strip`) so it reads over pale clay and over the dark ground, and
each has an invisible pick circle 44 px across.

- **Reach** (hands, feet): a ring that faces the camera. Pinned, a small
  dot in its middle. A tap selects it, with the move gizmo.
- **Root**: a rectangle framing the hips; drag it and the whole figure
  moves. It is orange while dragged or while the pelvis is selected.
- **Pole** (knee, elbow): an arrowhead out from the joint along the way it
  points, half the limb segment above it away (in front of a knee, behind
  an elbow), pointing at the joint it aims, joined to it by a thin dashed
  line. Dragging it turns the joint toward it.
- **Look-at** (head): the same arrowhead and dashed line, a head and a
  half in front of the face. Dragging it turns the head to face it, the
  neck about half as far and the chest and spine a little (about 12 and 6
  percent), measured from the chest: up to 80 degrees to a side and 60 up
  or down, past which the head holds at the limit. The hips never move.
- **Floor ring** under a planted foot: a flat ring, neutral.

## 9. Windows, notices and progress

- **Window** (Preferences, Publish, Help, Set scale, a confirmation): a
  `ground` box with a 1px outline, its name in the heading style, one
  primary button and the rest quiet. Escape closes it. On a phone it
  fills the screen. A confirmation of something that cannot be undone
  names the thing in its heading ("Delete Head?") and its button repeats
  the verb. Every question is the app's own window (`src/ui/askWindow.ts`),
  never the browser's `confirm()`, `alert()` or `prompt()`; the one native
  prompt left is the leave prompt of `beforeunload`, which browsers allow
  nothing else for. Two styles: danger (anything that cannot be undone or
  loses work) has a red button with a white label, the focus on Cancel and
  no Enter to confirm; normal (a safe main action) has the orange button
  focused, so Enter confirms. Cancel is always there; Esc and a tap
  outside the window cancel.
- **Notice.** One at a time, above the hints at the bottom centre. A
  plain notice leaves after 4 seconds. One that reports a failure is the
  orange box and stays until dismissed, with the action to take as a
  button where there is one.
- **Progress.** An operation that can take over a second shows a line
  that fills in orange, the same line a field has, with what is
  happening above it and Cancel beside it, in place of the notice. The
  viewport stays visible behind it.
- **Tip.** A lime box, shown once, dismissed for good by its close mark.

## 10. Additions to make in Gestalt v2

`bozzetto-interface.md` should gain, once agreed:

1. The Help menu, and the order File, Edit, View, Moderation (where there is one), Help.
2. The 44px target rule does not apply to Bozzetto: every control is
   pressed with a pen, a mouse or a hotkey.
3. One panel per side with folder tabs, as specified here.
4. The project name in the title strip.
5. Surfaces carry no outline; an outline means a control.
6. Hotkey digits and key hints as View toggles, off by default on a
   touch screen.
7. Section headers without numbers.
8. Notices, progress and context menus as specified above.

## 11. Building it

The mockup and this spec are the target, and each screen is built to
match them directly. The earlier plan repainted the old layout first and
moved the layout later; that produced an in-between look and is dropped.

1. **Foundations.** The system's tokens and fonts and the command list. The work already done on tokens and fonts carries
   over.
2. **The controls**, once, to the Controls board.
3. **Sculpt**: title strip and menus, tabbed panels, tool bar, edge
   controls, hints, view axes, context menus.
4. **Armature**, which shares Sculpt's shell.
5. **Gallery and viewer.**
6. **Windows, notices and progress.**
7. **Clean-up**: the old stylesheet and fonts.

Each step is compared against the mockup by screenshot, in both themes
and at the desktop and iPad sizes, before it ships.


## Sculpt layers

The **Layers** tab, left, after Model (`panel--layers`; View menu item
"Layers panel" after Model panel). From the top: **Add layer** (the one plain
button, never orange), the list, **Flatten all**. The list is
`src/ui/layerList.ts`, with no sculpt knowledge, so the Paint workspace can
reuse it with one more control a row (a blend mode select).

- Newest layer on top, a fixed **Base** row at the bottom. A row is an eye,
  the name (a tap on the active row's name renames it), a menu (Rename,
  Duplicate, Flatten into base, Delete in red) and under them a Weight
  slider, 0 to 100% of travel, with typed values to plus or minus 1000%
  (double tap or double click) shown as typed. The active row has the
  selected-row fill; Base is active when no layer is. Hit areas are at least
  44px high.
- A layer's data lives on the object's highest level. Any level may be on
  screen while sculpting with a layer active; only a hidden layer or one at
  0% refuses a stroke ("Show the layer to sculpt on it."). Weight changes
  apply live while the highest level is on screen and on release otherwise.
- Changing the active layer, a weight or visibility, Add, Duplicate,
  Flatten, Delete are undo steps. Remesh, merge, split and dynamic topology
  ask to flatten the layers first ("Flatten the layers of "Sphere"?", button
  "Flatten and remesh"); Cancel leaves everything.
- Saved per object in the scene (`SavedMesh.layers`, version 1: name,
  weight, visible, and the sparse displacements of the highest level), in the
  autosave, `.bozz` files and the library.
## Clarity rules (design critique, 2026-11)

- The edge sliders' names (Size, Strength) show only while the slider is
  pressed or hovered: Familjen Grotesk 11px, secondary grey, beside the
  value, no box. The edge buttons (Solo, Negative, Undo, Redo) name
  themselves on hover and on a long press, as the tool bar's do.
- Esc closes the hotkey guide first; it scrolls inside, chips never wrap and
  descriptions align left in one column.
- Martian Mono capitals are for values and small section headers only;
  buttons, chips and badges are Familjen Grotesk in sentence case.
- Panel labels carry no hotkeys; the key is in the tooltip and the View menu.
- The Render panel's Preset names the lights as they are: Three-point (all
  three on), Key only (Sculpt's opening look), Raking key, or Custom.
