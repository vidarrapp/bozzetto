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
  the scene, and the selected object), Tool and Material on the right (how
  the tool behaves, how the surface looks); the look of the scene is Present's
  Lighting, Camera and Render.
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
  drag. Depth of field (Enabled, then Aperture and Focus) is part of the
  Camera panel's one section, not a section of its own.
- **Three look panels** (owner call, 2026-11-17: Sculpt had too many tabs;
  they replace the one Render panel). **Lighting**, **Camera** and **Render**
  are Present's tabs at the left, in Sculpt's Present and in the Present
  workspace; Sculpt and Armature have none. **Lighting**: Rig (the select,
  grouped Built in and My rigs, reading Custom when the lights match none;
  Save rig…, Import rig…, Manage in one row), Lights (Shadows, each light
  with Enabled, Intensity, Azimuth, Elevation, Colour, Casts shadow and
  Softness, Rotate rig) and Environment light (HDRI, Intensity, Rotation).
  **Camera**: Lens, Depth of field with Aperture and Focus. **Render**: Tone
  (Tone mapping), Ambient occlusion (Model, Strength, Radius), Background and
  ground (Background, Bg colour or Bg blur and Bg brightness, Ground, the
  surface rows, Pedestal width, Floor offset), Developer with ?dev, and Reset
  look at the foot, which puts all three back to the look the scene or project
  opened with (in the viewer, the published look; the view stays, and a
  visitor's changes are never saved). The public viewer and review mode have
  the Lighting tab alone, at the right after Material, with the rig select and
  no Save, Import or Manage. Material is never in these panels.
- **Rigs.** A rig is the lights and the ambient and nothing else (no camera,
  no background). Built in: Three-point, Key only, Rembrandt, Butterfly,
  Split, Rim, Top light, Under light, Soft front, and Raking key. My rigs are
  kept on this device (`bz.rigs`, following the storage choice). A `.bozzrig`
  file is JSON: `format`, `version`, `name`, a list of `lights` each with a
  `type` (today `directional`, with `id` key, fill or rim) and its values, and
  `ambient`. Import checks every field, holds numbers to the sliders' limits,
  and refuses anything else with a plain notice. Sharing rigs through the
  Community is later work.
- **Move the key light** without a keyboard: View, **Move light** (Sculpt,
  Armature, Present) arms the next drag on the view as a move of the key light,
  across and up as with the L key, then lets go; Esc or the item again cancels.
  The light turns by movement made since the press (or since L went down, for a
  hovering mouse): the first event only sets the reference, so a finger or Pencil
  that lands away from the last pointer position does not make the light jump.
  **In Present** the keys 1, 2 and 3 (keymap actions `present.light1` to `3`,
  group Lighting, rebindable) pick which light L and Move light turn: Key, Fill,
  Rim, as the Lighting tab lists them; Key when Present is entered. A pick says
  "Key light", "Fill light" or "Rim light" on the status line, or "Fill is off"
  for a light that is off (it still turns, the tab shows its angles). While L is
  held or Move light is armed, and for 1.5 s after a pick, one marker per light
  that is on is drawn on a 2D canvas over the view (src/sculpt/ui/LightMarkers.ts,
  like the calipers' lines, so no render pass draws it and no saved picture holds
  it): a disc with a short line toward the subject, in the direction the light
  comes from, the same size on screen at any zoom; the picked one orange
  (`--bz-orange`), the others `--bz-text-hint`. Sculpt and Paint show no markers.
  **Cavity**, Sculpt's form shading, is a switch on the Material tab's Display
  section with Strength and Radius under it.
- **Hotkey guide per workspace.** The guide (H) is drawn from the keymap for the
  workspace the page is in: Armature, Sculpt, Paint and Present each have a
  title ("Present hotkeys") and a table, and it redraws when the workspace
  changes while it is open. Present's table is its own whichever workspace it
  was entered from. The keymap knows which actions work in Present (`present:
  true` on the action, or `mode: 'present'` for one that means something only
  there, with `presentLabel` where the words differ); Present's key handling
  (InputShell) and its guide are both built from that, so a new Present key is
  one keymap entry. A key that means different things in two workspaces (1, 2,
  3; L) is listed in each with what it does there; a clash is only a clash
  within one workspace. Preferences has a Present tab beside Sculpt, Paint and
  Viewer.
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
  OBJ, Remesh to a figure (Armature's File menu: the posed mannequin made into a figure, in this scene), New sculpt from this, Edit in Present; Publish…;
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
  Armature, Sculpt, Paint and Present where the place has the workspace path,
  the one you are in and any that cannot be reached greyed out with the reason.
  On the Sculpt page each shows its key (Shift+1 to 4, `ws.*`).
  In Paint the panel toggles are Scene, Layers, Material, Tool and Reference.
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

- Scene panel (an empty scene shows the Create choices in the panel itself: see "New scene")
- Model panel
- Layers panel
- Material panel
- Tool panel
- Reference panel
- Lighting, Camera and Render panels (in Present)
- Move light
- Hide interface

- Armature (Shift+1), Sculpt (Shift+2), Paint (Shift+3) and Present (Shift+4)
  (see "The three workspaces as tabs")

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
│ Scene Model Layers   │      │ Tool Material Reference │  tabs
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
- In Present from Sculpt the readout is `Image W × H` (the size in pixels of
  the picture Save image writes: the window at its saving ratio) and
  `Lens N mm`, values in Martian Mono, both following the Camera tab live.
  A step of the path that cannot be pressed is dim and says why in its title
  and, held for a moment by a finger or the Pencil, in a small box under the
  strip (plain words that say what to do: "Present works from Sculpt. Go to
  Sculpt first.").

### Details overlay

- Plain text at the top left of the 3D view in Sculpt, Paint and Armature: no box,
  no background, only the view's faint soft shade under the letters (no outline), 11 to 13px, Familjen Grotesk for names and labels and Martian
  Mono for numbers; values in the light text colour, names in the second one. One fact a line, only those that
  apply. Sculpt: the active object's name, Tris, Quads (when the mesh has
  quads), Verts, Level n of m (when it has levels), Objects n (with "n
  selected" when more than one is), Size height by width by depth in cm
  (real units only), Symmetry X, Y or Z when on, Masked n% when anything is
  masked, Hidden groups n, and Layer (the active layer's name, Base when the
  base is active) when the object has layers; in Paint the Layer line is the
  active paint layer (or group), Base when Base is active, when the object has
  paint layers. Armature: the figure's name,
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
  Sculpt: left Scene, Model, Layers; right Tool, Material, Reference.
  Armature: left Armature; right Material, Reference (the page's own, the
  same as in Sculpt and Paint). Present from Sculpt:
  left Lighting, Camera, Render; right Material, Output. The Present
  workspace (owner): left Lighting, Camera, Render; right Frames, Project,
  Material, Output. The viewer and review mode: right Material, Lighting,
  nothing at the left. The View menu lists the panels in this order (in
  Sculpt, the set that is showing). One panel is open per side.
- **Save image** has one button, in Present's Output panel. Publish, in the
  strip, stays Present's one orange main action. The
  bar along the bottom holds the turntable's play and Speed only. The
  viewer's and the published Present's transport shortens, evenly, while a
  panel is open on either side, so it never runs under one.
- **Strength** reads in cm for the brushes that move the surface by a depth
  (Clay, Inflate, Crease, the Rake) and in percent for the rest (Smooth,
  Flatten, Polish, Pinch, Move, Paint, Mask), whose strength is a share of
  the way, of the drag or of an amount, not a depth.
- **Loading.** While the boot overlay (the splash) is up nothing else shows:
  the overlay stands over the strip, tabs and top row.
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

**The armature in the scene (0.7.17).** Its Scene row is named for the
mannequin: the label the Armature tab's Preset select shows (a model from a
file: the file's name without its extension), never the scene's name. The row
has the object row's eye (same icon, states and hit size) before the bone
mark, and no lock, material select or delete. The eye hides the mannequin in
Sculpt, Paint and Present (no shadow, no press, out of F, A and the stage
fit); in Armature it always shows and the eye reads as on. A tap on the row
marks it as an object's row is marked and takes the mark off the objects. The
mannequin has its own material (Albedo, Roughness, Metalness; default the
scene's first material). The Material tab's Surface section is the mannequin's
in Armature, in Sculpt and Paint with no object selected, and while the row is
the last thing tapped; the Material row then reads Armature. The eye and the
material are kept in the armature's record on the device (`mannequin`); an old
record has neither. Remesh to a figure assigns the figure that material.

### The Reference panel

Pictures to look at while you work (`src/reference/`), on the right after
Tool, with Material before it.

- **Top:** Add picture… (the system picker, no `capture` attribute, so an
  iPad offers Photo Library, Take Photo and Choose File) and Paste. Ctrl or
  Cmd+V adds a picture while the panel is open; Edit > Paste picture does it
  from the menu. A picture dropped on the panel is a tile on the board; one
  dropped on the view is added and placed in the view where it fell. Under
  them, one button, **Arrange** / **Lock**, greyed until a picture is in the
  view.
- **Board:** a single column of cards, newest first, square corners. A card
  is the thumbnail with the name and the size (mono) beside it, and under
  them a row of five icons, each at least 44px wide, with the glyphs of the
  row over a picture in the view: **In view** (eye; a toggle, orange while
  the picture is in the view), **Match view** (camera; greyed, with "Match
  view: lock the picture first" as its tip, until the picture was locked in
  the view), **Flip** and **Greyscale** (toggles, orange while on), **Delete**
  (trash, red under the pointer, asking first). Each names itself on hover and
  on a long press (the edge buttons' tip). There is no More menu. The card
  whose picture is in the view has the grey selected fill (orange is for focus
  only). A tap on a tile only selects it. **A tile is dragged into the
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
- **Blend modes.** Each card in the Reference panel has a select beside its
  thumbnail (owner, 2026-11-18: not in the view), in Photoshop's order and
  groups (`src/ui/blendModes.ts`, shared with the Paint workspace's layers):
  **Behind** first (drawn behind the model by the viewer), then the modes
  that CSS has a match for (`CSS_BLEND_MODES`): Normal | Darken, Multiply, Color Burn |
  Lighten, Screen, Color Dodge, Linear Dodge (Add) | Overlay, Soft Light, Hard
  Light | Difference, Exclusion | Hue, Saturation, Color, Luminosity (the
  first is labelled **Behind the model** there). Opacity applies to every mode.
  The pictures over the model are drawn by the viewer, not by the page (a
  browser does not blend a page element with the accelerated canvas under it
  in Safari): `src/viewer/refBlend.ts` composites them in the view's own
  output, after tone mapping, in display space, with the W3C compositing
  formulas, so a picture shows its own colours at Normal 100% and each mode
  matches what CSS gives. There are four slots; with more pictures in the view
  the topmost four blend (lowest first, the later above). Place, size,
  opacity, mode, flip and greyscale are uniforms and texture contents: no
  shader is built when they change or when the number of pictures does (the
  composite joins the output the first time a picture is shown, and slots in
  no use are skipped by one uniform test). Never in a thumbnail, a saved
  image, a turntable or a publish render (as the backdrop), and none in
  Present. The frames and the row of tools are page elements as before; the
  picture layer is empty and pass-through (suites `refBlend`,
  `refBlendEdges`). Only the topmost Behind picture is drawn behind the
  model, the right way up and under its frame: `Viewer.setBackdrop` takes the
  frame's place from the top of the view down, which is how `screenUV` runs
  on both backends (suite `refBehindUp`).
- **Arranging (unlocked).** Putting a picture in the view turns it on. Every
  picture in the view has a thin outline, four corner marks and a row of
  five icon buttons at its top edge (inside the top edge when there is no
  room above), each 44px with its name on hover and long press: **Lock**
  (ends arranging for all pictures), **Fit** (fill the view, keeping the
  aspect), **Flip** (mirror), **Greyscale**, **Remove from view** (a cross;
  the picture stays on the board). Flip and Greyscale show they are on by an
  orange icon alone, no filled square. **Opacity** is in the same row, to the
  right of the icons (owner, 2026-11-18: one bar of tools): a slider, 0 to
  100 %, built as the app's slider rows are (a press anywhere on it and a
  drag scrubs, never moving the picture; a double tap types a value). The
  whole row is kept inside the view and clear of the bars and panels, even
  where it is wider than the picture. It is light marks with the faint
  shade (no dark box).
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
- **The bar is a list of tool ids** (`src/sculpt/tools/bars.ts`), one per
  workspace, read from one place: Sculpt's brushes between Select and
  Transform, Paint's six tools after Select. The tools themselves, with
  their names, icons, one-line descriptions, Help topics and the list of
  their settings, are one table (`src/sculpt/tools/registry.ts`). The ten
  number keys are the actions `slot.1` to `slot.10` ("Tool bar, place
  1" and so on): each picks whatever sits in that place of the current
  workspace's bar, so a badge, a tooltip, the hotkey guide and
  Preferences all read the place. Select, Transform and Calipers have no
  place and keep Q, T and C. A key rebound before places existed
  (`tool.crease`, `paint.erase` and the like) carries over to the place
  that tool holds on the default bar.
- **The dock: the order is the person's.** A long press on a brush's tile
  (600 ms, Pencil or finger, the same timing as Carve's latch; the events'
  own timestamps decide) lifts it; a mouse also lifts it by pressing and
  moving 4px. Select, Transform and Calipers cannot be lifted. A press that
  moves more than 8px before the long press is a slip: neither a tap nor a
  lift. The lifted tile is a ghost a little larger than the tile (centred on
  the Pencil or the mouse, 48px above a finger) with the tool's name above
  it; its place stays as a gap, and while anything is lifted every place
  shows its digit, even with Hotkeys on tools off. Along the bar the others
  slide aside (transform, 140ms ease-out, none with reduced motion) and
  their badges show the digit they will have; letting go puts the tool there
  (no notice; the tool in hand stays in hand). Esc, a cancelled pointer, the
  window losing focus or a second pointer going down fly the ghost back and
  change nothing. Nothing lifts mid-stroke, and the number keys wait while a
  tool is lifted.
- **Taking a tool off the bar.** Letting go of a tile lifted from the bar
  more than 56px above it or 24px past its ends takes the tool off that
  bar. Out of the zone the ghost dims to half, so the outcome shows before
  letting go, and the others close the gap and show the digits they will
  have. On letting go the ghost shrinks away (160ms) and a notice says
  "Clay is off the tool bar. It is still in the library." with Undo, which
  puts the tool back in its old place. A bar may be emptied; Select,
  Transform and Calipers stay. Each workspace's order is kept through
  `deviceStore` as `bozzetto-toolbar`, `{ v: 2, sculpt?: { ids, known },
  paint?: { ids, known } }`, only for an order that differs from the default.
  `known` is the list of tools the app had for that bar when the record was
  written: on load, only tools that are in the default bar and not in
  `known` are appended (a tool a later version added); tools that are not in
  the registry, not brushes of that workspace, or repeats are dropped. A
  `v: 1` record (`{ sculpt?: ids, paint?: ids }`) is read as before, every
  missing tool appended. With saving off the order holds for the visit and
  one notice says it will not be kept. **View > Reset tool bar** (Sculpt and
  Paint, greyed while the bar is the default) puts the default order back,
  removed tools included, with a notice that has Undo.
- **Ten tools at most.** A bar holds one tool for each of the ten place keys
  (`ToolBars.limit`). A lift towards a full bar from the window or the extra
  tile does not start, and the menus' Add to tool bar adds nothing; either way
  a notice says "The tool bar is full (10 tools). Take one off to add
  another." Tool groups, for more tools on one key, wait for 1.0.
- **A tool in hand that is not on the bar** shows as one extra tile after
  the last tool of the bar (before Transform), orange as the tool in hand,
  with no digit and a dashed line inside it that says it is not kept. Its
  name tip reads "Rake, not on the tool bar". Picking another tool makes it
  go; lifting it and putting it on the bar keeps the tool there.
- **The tile's menu.** A long press on a tile that ends without moving
  (the lift is the long press; it did not go further than 8px) opens a small
  menu at the tile in the app's menu look: **Tool settings** (takes the
  tool in hand and opens the Tool panel) and **Remove from tool bar**, or
  **Add to tool bar** for the extra tile. It closes on a tap outside, on Esc
  and on a choice.
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
- **Poly groups and dynamic topology.** With dynamic topology on, an object keeps its groups (they follow the triangles and may drift) but they cannot be made or edited: the Model panel's Groups note says "Poly groups need dynamic topology off." with a Turn off dynamic topology button, the making buttons are off, and Ctrl+G says the same notice. Show, hide, isolate and the colour switch still work.
- **Measure section** (Model panel, after Poly groups): the pinned
  measurements of the selected object, a row each with its name (tap to
  rename), its length in the mono face, a mirror toggle, the eye and the
  trash. A mirrored one shows a line under it with the other length and
  the difference. A delete is not a sculpt undo step; the section
  offers Undo for the last one deleted.


### Asset library window

- **The picture tabs** (`src/library/TileViews.ts`; the lists they and the
  panels' pickers share are `assets.ts`, `modelAssets.ts` and the data in
  `Lighting.ts`: nothing else lists a matcap, a rig, an environment or a
  Create choice). A tile is a 48px picture over its name, at least 64px,
  and its touches are the window's (`touch-action: pan-y`), so a drag on
  it scrolls and only a tap uses it. The one in use is orange, as the tool
  in hand is, and read again every half second while the tab shows (the
  panels, the hotkeys and a restored look change it). **Models**: the
  Create choices in their groups (Primitives, Armatures, Base
  meshes: Figures, Heads, Parts); a tap does what the Create choice does.
  **Materials**: the group Matcaps, ten tiles with the matcap's own
  picture, a tap sets the mode to Matcap and the matcap, and the line "Lit
  shows the materials again (Material tab)." under it. **Lighting**: the
  ten built-in rigs, each a grey ball under it; Scene holds the saved rigs
  ("Rigs you save in the Lighting tab show here."). **HDRIs**: None, then
  the six; Scene holds the one environment this scene uses, or the line
  "This scene has no environment light." and a tap does nothing there; the `.hdr` file is fetched only on the tap, the tile shows a
  mark ("…", no change of size) while it comes, a failed fetch says
  "Garage could not be loaded. The environment is as it was." in the foot
  and changes nothing. An environment entry carries a list of files so
  more resolutions can come from a server later. **Shows in Present.**
  is said in the foot when a rig or an HDRI is applied where it is not
  drawn: Present always draws them, a working view only while its mode is
  Lit (a matcap ignores the lights). Pictures: `public/assets/rigs` and
  `public/assets/env/thumbs`, made by `tools/render-library-thumbs.mjs`.
  **Models**: Scene lists the scene's objects in the Scene panel's order
  as name tiles (the armature too), the active one marked; a tap selects it
  as a tap on its row does. Empty: "Nothing in this scene yet." **Tools**:
  Scene says "Tools kept in a scene will show here." Every Scene list
  follows the scene as it changes, and the search filters it by name.

- **One floating window**, "Asset library", over the view (`src/library`,
  owned by the Studio shell so every workspace can open it). It has no
  backdrop: the view under it stays live, a stroke on the model works with
  it open, and only presses that start on the window are its own. Raised
  grey with the 1px border and shadow of a window (docs/ui-foundations.md),
  at z-index 30: above the panels, below the menus, the notices and every
  asking window.
- **Place and size.** About 420 by 480px, right of the middle, under the
  strip and clear of the tool bar and the edge column. Dragged by its title
  row (mouse, finger, Pencil; the row owns its touches) and resized from
  the lower right corner (a 44px square). It is kept inside the view when
  the page is resized. Place, size and last tab are kept through
  `deviceStore` as `bozzetto-library`, `{ v: 1, x, y, w, h, tab }`; the
  window itself does not reopen after a reload.
- **Opening and closing.** A small **Library** button in the heading of the
  Tool panel, and **View > Asset library**, a toggle in Sculpt, Paint and
  Present (no key). The × in the title row is an icon button with the label
  Close. Esc closes it when the focus is inside it. Tab hides it with the
  rest of the interface; it is not closed by the panels' first Tab.
- **Tabs and where from.** Tools, Models, Materials, Lighting and HDRIs,
  always all five. A tab's body is a view registered for it (`AssetLibrary.register`:
  `mount`, `refresh`, `dispose`); a tab with none says one quiet line, for
  example "Materials come to the library in a later version." Under the
  tabs, two buttons, **Library** and **Scene** on every tab (Scene is what
  this scene itself holds of the tab's kind; the Community comes with a
  later step and is not shown; room is left), and a **Search** field that
  filters the tiles showing by name as you type ("Nothing called that." when
  none match). Scene on Tools says "Tools kept in a scene will show here."
- **The Tools tab, Bozzetto.** Every tool a bar can hold, in two groups
  with small headings, **Sculpt** and **Paint**, the workspace you are in
  first. A tile is at least 64px, the tool's icon with its name under it
  and, while the tool is on its bar, its key there in the corner (the bar's
  own digit; a dot for a place with no plain key). The tool in
  hand has the orange tile, as on the bar. **Tap** takes the tool in hand.
  A tool of the other workspace is dimmed, and a tap on it says "This is a
  Paint tool. It is used in Paint." (or the Sculpt wording) in the window's
  foot and does nothing else; in Present a tap says "Tools are not used in
  Present."
- **Lifting from the window** is the dock's (same long press, same mouse
  drag; only a tool of the workspace you are in lifts, and nothing lifts
  mid-stroke). The tile stays and dims. Over the bar the gap opens at the
  insertion point exactly as for a move: for a tool that is not on the bar
  the bar's box widens and the tiles go where the layout will put them, so
  nothing jumps when the order is set. Letting go on the bar puts the tool
  at that place (a tool already on the bar moves there); letting go anywhere
  else flies the ghost back to its tile. A long press on a tile that ends
  without moving opens its menu: **Use**, and **Add to tool bar** or
  **Remove from tool bar**.

### Edge controls

- Left edge, bottom up: Negative (Carve), Smooth, Mask, Undo, Redo, Solo, then the brush
  strength and size sliders. Smooth ("Smooth (hold Shift)") and Mask ("Mask (hold Ctrl)")
  press as Carve does: a tap arms the next stroke only (orange icon), a long press latches
  (the same orange) until a tap. A stroke then goes as if the key were held when it began;
  Mask with Carve on unmasks. They let go of each other, a held key wins, nothing is saved.
  In Paint, Smooth is named Blur and shows with the Paint tool only; Mask stays; Carve is
  away. In Present and Armature none shows. No box behind them; each is black or white
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
  Negative, Smooth and Mask buttons. The
  desktop and any native iPad version can revisit it.

### Armature handles

The figure's controls are outlines, as an animation program draws control
curves, not balls (owner decision, 2026-11-14 and 2026-11-17). Every
handle is neutral (`--bz-text`, white under the pointer) and orange
(`--bz-orange`) only while selected or dragged. Each is drawn over the
figure, with a stroke of 2 px (3 px when orange) and a faint soft shade
under it (`--bz-view-shade-line`, no hard dark border) so it reads over pale clay, and
each has an invisible pick circle 44 px across.

- **Reach** (hands, feet): a ring that faces the camera, 22 px in radius (RING_RADIUS), centred on the middle of the hand's or foot's own geometry as posed (the middle of the part's box; the reach itself is aimed at the effector point, and a press keeps its offset from it, so nothing jumps). Pinned, a small
  dot in its middle. A tap selects it, with the move gizmo. A double-click or double-tap, or a Pencil or finger press held
  still for LONG_PRESS_MS (600 ms; a second finger, or travel past 4 px, cancels it; a mouse has the double-click), pins it or frees it, one undo step; the long press acts while the press is still
  down, and its lift does nothing more. The double-tap window is 350 ms and 24 px (6 px for a mouse).
  The pole targets, the look-at target and the hip box do not pin.
- **Root**: a wire box (12 edges), the same box the pelvis part shows when it is selected (the part's own
  box, 8 mm off its faces, with the pelvis's proportions and turn), so the two never disagree. It is orange
  while dragged or while the pelvis is selected. A tap or click on it (travel within the tap distance)
  selects the hips and brings up the move arrows and the turn rings together, at the box's middle; the hips
  turn about that middle, and pinned and planted feet hold. A press that drags moves the whole figure in the
  screen plane and leaves the selection as it was. The box takes the press before the part under it.
- **Pole** (knee, elbow): an arrowhead on a point the person places, joined to the joint by a thin
  dashed line. It starts out from the joint, half the limb segment above it away (in front of a
  knee, behind an elbow). Dragging it moves it in the plane that faces the camera through where it
  is, anywhere on the screen, under the pointer (never onto the limb's line: within a centimetre of
  it the target stays); the joint turns toward it. The point is held in the frame of what the limb
  hangs from (the pelvis for a leg, the chest for an arm), not in the world, so it goes with the
  body when the hips are moved or turned and stays on the body while a hand or foot moves
  (Armature.POLES_IN_BODY_FRAME). It is kept in the record, in every undo step, mirrored by Mirror
  pose and symmetry, put back out from the joint by Reset pose; turning a joint of the limb by hand,
  or the panel's Aim, carries it out along the way the joint now points, at its distance. Tapped it is
  selected, and its move gizmo moves it. Dimmer while the joint cannot bend toward it.
- **Look-at** (head): the same arrowhead and dashed line, to a point in the
  scene (kept in the record, in every undo step, mirrored by Mirror pose and
  put back a head and a half in front of the face by Reset pose; a record with
  none gets it there). Dragging it moves it in the plane that faces the camera
  through where it is, anywhere on the screen, under the pointer. The head
  faces it all the time, after anything that changes the figure: the head and
  the neck are worked out from the chest as it stands, as a turn and a tilt
  with no roll, so they are a function of the body's pose and the point (the
  hips away and back leave the head as it was). The neck takes about half the
  turn; while the point is dragged the chest and spine take a little (about
  12 and 6 percent), from where they stood as the drag began, and keep it.
  Up to 80 degrees to a side and 60 up or down from the chest; past that the
  head holds at the limit, the point stays where it was put, and the point and
  its line are drawn dimmer. Turning the head or the neck by hand carries the
  point out along the head's new facing at its distance; turning the chest or
  spine leaves it. The hips never move.
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
  apply on every drawn frame of a drag (the Weight slider's `input`, coalesced
  by `LayerControls`) while the highest level is on screen; from a lower level
  the level on screen follows by scaling the layer's (or group's) effect on it
  (`SculptLayers.follow`: taken from two real updates the first time, kept for
  the next drags until a stroke or another edit), and the release always does
  the real update.
- Changing the active layer, a weight or visibility, Add, Duplicate,
  Flatten, Delete are undo steps. Remesh, merge, split and dynamic topology
  ask to flatten the layers first ("Flatten the layers of "Sphere"?", button
  "Flatten and remesh"); Cancel leaves everything.
- Saved per object in the scene (`SavedMesh.layers`, version 1: name,
  weight, visible, and the sparse displacements of the highest level), in the
  autosave, `.bozz` files and the library.
## Layers panels: Photoshop's model (second pass)

Both Layers panels (sculpt, paint) have the same three parts, top to bottom.
**Controls** of the picked layer or group (`LayerControls`): the Weight slider
(sculpt, typed -1000 to 1000%) or a blend mode select with Pass through first
(groups only) and the Opacity slider (paint) on one row; greyed out with Base
picked. **The list**: one row a layer, about 32px, no field inside a row: the
grip, the eye, a fold arrow (groups), a 16px colour swatch (fill layers), the
name, a mask mark (struck through when off), a quiet value in mono where it is
not the default ("Multiply 60%", "55%"), the row menu; layers of a group are
indented and fold away; Base is last with no eye and a menu holding Flatten all.
**The foot bar** (`LayerBar`): bare icons at the right, each 44 by 32 with the
panel's hover fill, a name on hover and on a long press (the edge buttons' tip),
greyed out when they do not apply. Paint, left to right: New layer
(`fi-ss-layers`), New fill layer (`fi-ss-fill`), Add mask
(`fi-ss-customize-edit`), New group (`fi-ss-folder`), Delete (`fi-ss-trash`);
Sculpt has the same without the fill layer. One level of groups: Group is greyed out inside a group. A mask is a
byte a vertex of the highest level (255 shows the layer, 0 hides it where the
working mask protected), saved run-length; records are version 2 and old
records open.

## The four workspaces as tabs

Armature, Sculpt, Paint and Present are tabs of one page (owner, 2026-11-18):
from any of them to any other in one step, and each keeps its own panels and
tool. The page is the Sculpt page: `/?sculpt=1` opens it on Sculpt,
`/?armature=1` on Armature (with the `project=`, `template=` and `scope=` of an
armature, which Armature reads and cleans off the address), and the address
follows the workspace (`armature=1` while Armature is in front, `sculpt=1`
when it is left, `paint=1` as before).

- **Armature is loaded on first use, or at the start for a scene that has
  one.** When the device keeps an armature record (`hasArmature`), the page
  loads it put away once the first frame is on screen (`ArmatureSlot.preload`;
  the "Loading Armature…" notice only after half a second), so the mannequin
  stands in Sculpt, Paint and Present after a reload. A new sculpt clears the
  record. Otherwise its code and the four mannequin files
  are fetched the first time the workspace is entered (`src/armature/
  workspace.ts` is the facade the page carries), so Sculpt starts as fast as it
  did. The path shows Armature current at once, a quiet notice says "Loading
  Armature…", and the switch is not held up: another step still works, and
  the load ends put away if it is used.
- **One working view.** Armature shows Sculpt's view (its light, its shading,
  the cavity pass, flat clay, the one look of the scene) with the floor shown
  and fixed where the mannequin stands, so changing tab changes nothing but
  the tools. `src/armature/viewerNeeds.ts` lists what Armature still asks of
  the viewer on entering and gives back on leaving: the fixed floor, the
  ground shown, and the pose drag counted as a move for the frame meter. The
  shadows' bound (Sculpt's) takes the posed mannequin in while it is drawn.
  Sculpt's tool bar, brush fields, Solo, Negative and ring are put away in
  Armature (`body.armature-ws`); Undo, Redo and Arrange stay on the edge
  column, and Undo and Redo act on the workspace in front (Armature has its
  own steps until there is one history).
- **The mannequin and the figure.** A figure is made only by pressing
  **Remesh to a figure** (the Figure section of the Armature tab, the Figure
  section at the top of the Model tab, Armature's File menu, Ctrl+Enter in
  Armature, or Remesh in the question below), never by changing tab. It is
  the posed mannequin baked to world triangles and voxelised at the
  Resolution (one slider, shared by the two panels) into one object named
  Figure, in one undo step (a scene with nothing done to it makes way for it;
  one with work keeps its objects; pressed again it adds Figure 2); a grid
  the device cannot spare is refused with the reason. Until a figure stands in
  the scene the posed mannequin is drawn in Sculpt, Paint and Present too,
  without handles, listed in the Scene tab as a row of its own (the bone
  icon, its name, no eye, lock, material or delete), and takes no strokes:
  a stroke that starts on it asks once a visit `Remesh "Figure" to sculpt
  it?`, text `Sculpting needs a surface of its own. The armature keeps its pose,
  and you can make another figure from it later.`, with **Remesh** (an ordinary
  main action, not the danger style) and Cancel; Cancel leaves everything as
  it was and the press goes to the view. Once a figure stands in the scene
  (its step is in the history: undoing it brings the mannequin back) the
  mannequin shows only in Armature. The scene has an armature when the device keeps
  its record, loaded at the start of the page.
- **Panels.** Armature: left Armature; right Material, Reference (the same
  two panels and the same board as in the other workspaces; pictures on the
  old Armature board are added to the page's board once, on first load). The
  Armature tab's sections: Mannequin, Joint, Proportions, Reach, Figure
  (where things stand, Resolution, Remesh to a figure).

- **Keys.** `ws.armature` Shift+1, `ws.sculpt` Shift+2, `ws.paint` Shift+3,
  `ws.present` Shift+4 (rebindable, in the View menu and the hotkey guide),
  each straight to that workspace from any other; the one you are in does
  nothing. These are the only workspace keys: Shift+B and Shift+P are gone
  (`ui.paint` and `ui.present` no longer exist; a rebind of either made in
  Preferences carries over to `ws.paint` / `ws.present` when the keymap
  loads). Esc does not leave Present (owner, 2026-11-18): it closes the
  menu, window or field that is open and shows a hidden interface, as
  everywhere. A chord is Shift and the
  digit's physical key (`event.code`, `Digit1` to `Digit4`), so a Swedish keyboard (Shift+2 types
  `"`) and a US one (`@`) agree; where a keyboard sends no `code` the key does
  not match (nothing guesses from the character).
- **Panels.** Each workspace keeps which panel is open on each side (at most
  one a side), on the device (`bz.panels.sculpt`, `.paint`, `.present`).
  Entering opens what it last had and puts the other's away. First visit:
  Sculpt as it always began; Paint with Layers at the left and Tool at the
  right; Present with Output at the right and nothing at the left. Present of
  a published project (the owner's Frames and Project tabs) is another page
  with its own memory in the page only; it does not share Present's.
- **Tool.** Paint comes back to the paint tool it last had (kept on the
  device); Sculpt to the one it left.
- **Nothing stops a switch.** It is refused only mid-stroke or mid-drag. No
  question is asked on the way between the four. Kept across a switch: the camera, the active object and
  selection, the undo history, symmetry and the scene's look. Present entered
  from Paint is left by a key or the path to the workspace asked for (the
  turntable stopped, a clip being saved cancelled), landing on that
  workspace's own panels and tool.

## The Paint workspace

A workspace of the Sculpt page, as Present from Sculpt is: **Armature ›
Sculpt › Paint › Present**. Shift+3 (the keymap's `ws.paint`, rebindable)
goes in; View, Paint and the path's Paint step go in too, and Shift+2, the
path's Sculpt step and View, Sculpt come out. The page's address has `paint=1` while it is up
(`/?sculpt=1&paint=1` opens in it). The body carries `paint-ws`.

- **Bar.** Select on q, then Paint, Erase, Blur, Fill, Pick and Project on 1
  to 6 (the keymap's `paint.*` rows, mode `paint`, which also lists the Sculpt
  keys that still answer there). No brushes, Calipers, Transform or the left
  edge's Negative; Undo, Redo, Solo and the size and strength fields stay.
  Sculpt's bar has no paint tool and its 0 is free. Shift over Paint blurs;
  over any other Paint tool it does nothing.
- **Tabs.** Left: Scene, Layers (paint layers here, sculpt layers in Sculpt).
  Right: Tool, Material, Reference. Model and Render are not Paint's (Render
  returns in Present, entered from Paint). Paint keeps its own open panels
  (first visit: Layers and Tool) and comes back to its last paint tool.
- **Present from Paint** is left by Shift+3 to Paint (or any other). The View menu's panel
  items are the workspace's own.
- **Colour.** Nothing to switch on: paint shows in Sculpt, Paint and Present
  from Sculpt whatever the look says, so entering Paint neither changes
  Colour nor says anything. Colour is one control, in the Material tab's
  Display section after Mode, in Sculpt, Paint and Present from Sculpt (and not
  in the Render tab): **Albedo and paint** (the albedo times the paint, the
  default), **Albedo only** or **Paint only** (the paint as picked, as under a
  white albedo; the object's albedo is not changed). It chooses which factor
  the shader uses and rewrites nothing. It is stored in the look as
  `colourSource` ('both', 'albedo', 'paint') beside `vertexColors`, which is
  true for the first and last and false for Albedo only, so a look from
  before opens right (false is Albedo only, true Albedo and paint) and a
  build from before reads a new one sensibly. A publish writes what is seen:
  the product, the paint alone for Paint only, and for Albedo only the product
  with the look saying Plain colour. Over a published model with colours the
  viewer keeps its two choices, Sculpt colours (the model's own colours) and
  Plain colour (its albedo).
- **Paint layers** use `ui/layerList.ts` with a reorder handle (a 44px grip at
  the row's left, `touch-action: none`, a line shows the drop place), a blend
  mode select (`ui/blendModes.ts`, 27 modes in Photoshop's six groups, a
  disabled line between groups) and an Opacity slider (0 to 100%). Menu:
  Rename, Duplicate, Merge down, Clear, Delete (red). Base's menu: Clear (back
  to white, one undo step; nothing happens while Base holds no paint) and Flatten
  all. Merge down composes the layer, with its own blend mode, opacity and
  mask, onto the stored colours of the layer below (Base for the lowest
  layer); the lower layer keeps its own mode, opacity and mask, so the result
  equals merging two Normal layers and then setting the mode. Base at the
  bottom is paintable. A stroke on a layer that is hidden or
  at 0% does not start and says why; Erase with Base picked says to pick a
  layer (Base is opaque).
- **Dynamic topology.** An object with it on has no paint layers (the Layers
  tab says "Paint layers need dynamic topology off." with a plain button,
  Turn off dynamic topology; Sculpt's Layers tab has the same with "Layers need
  dynamic topology off."). It can be painted without layers, the vendor's own
  way, in white or the paint blended with white under the brush (new
  triangles never get the albedo, which is not in the colours). On entering
  Paint with an active object that has it on, and when the active object
  changes to one in Paint, a notice (statusToast, about 8 s, not blocking) says
  `Paint layers need dynamic topology off for "Sphere".` with a Turn off
  button, once for each object a visit to the page; nothing holds up the
  switch. Turn off is the Model panel's switch for that object: one undo step,
  the shape and colours stay, the surface is triangles.
- **The albedo multiplies the paint.** The shown colour is the object's
  material albedo times its paint, in linear space, per object and always.
  Base is white and opaque until painted, so an unpainted object is its
  albedo, and making a layer or a stroke copies nothing from the albedo. The
  paint is exactly what was picked and nothing stored is altered by the
  albedo: a pure red stroke is red times clay under a clay albedo, red as
  picked under a white one, and a change of Albedo is a value the shader
  reads (`userData.albedo` on each object's display mesh), no recomposite, at
  any mesh size. Matcap draws the paint alone, as it always did. Assigning a
  material to a painted object keeps its paint and asks nothing. Pick returns
  the paint colour.
- **Data.** Four bytes a vertex of the highest level (sRGB colour, alpha) a
  layer, allocated on its first stroke; Base is linear floats, three a vertex.
  The mesh's own colours are the paint alone; publishing writes the albedo
  times the paint as the vertex colours (the viewer shows a published model's
  colours in place of its albedo, as before), and OBJ export writes no
  colours. Saved per object as `SavedMesh.paintLayers` (version 2, sparse).
  Scene records are version 5; in a version 4 or older one the albedo is in the
  colours, so on opening a painted object gets a white albedo (a copy of a
  shared material, named "<name> (painted)") and an unpainted one white
  colours. Every stroke and every layer change is one undo step. Remesh,
  merge, split and dynamic topology ask once to flatten the sculpt and the
  paint layers.

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
- The Lighting tab's Rig names the lights as they are: Three-point (all
  three on), Key only (Sculpt's opening look), another built-in rig, one of
  My rigs, or Custom.

## New scene (0.7.19)

A new scene has no object (owner, 2026-11-25: the default sphere felt like Blender's default cube). A first visit with
nothing kept, File, New sculpt and the gallery's new sculpt all give an empty scene; a kept or opened scene opens as it
was. The address option `?start=sphere` begins a new scene with the default sphere (the tests use it; it does nothing to a
kept or opened scene).

- **The Scene panel opens on Create** in a scene that is empty when the page loads. Its empty state replaces the list, the
  Create button, the Material row and the Floor offset: a line, "Add something to start.", then the Create menu's own
  choices as tiles, built by the same code as the menu so the two cannot differ. Each choice is at least 44 px; the
  choices scroll inside the panel. Choosing one adds it, selects it and frames it, and the panel returns to its list.
  Deleting the last object, or undoing the first add, brings the empty state back. A panel the person closed does not
  reopen by itself during a visit.
- **Create choices, in order:** Primitives (seven picture tiles, picture above the name, as tall as the armature tiles), Base meshes (Figures, Heads, Parts, with the "Blockouts as" switch), then
  **Armatures**: one tile for each mannequin and block figure the Armature tab's Preset select offers, picture and label.
  Pictures are `public/assets/armature/thumbs/<id>.png`, 96 x 96, made by `tools/render-armature-thumbs.mjs`.
- **An armature tile** makes that mannequin the scene's armature in its rest pose and goes to the Armature workspace,
  loading Armature first (the "Loading Armature…" notice). One armature a scene for now: when the current one has been posed
  or had its proportions changed, the tile asks first, "Replace the armature?", text "Its pose and proportions will be
  lost.", buttons Replace (danger) and Cancel.
- An empty scene is not written to the autosave (ScenePersist), and File, New sculpt clears the kept record so a reload stays
  empty.
