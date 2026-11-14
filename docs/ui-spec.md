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
  Material tab at the left in every place, the viewer and review mode
  included (Display section only, as in Present). What a place cannot do
  stays out of the panel, not out of the order: Cavity (SSAO) only in plain
  Sculpt, Pedestal and Floor offset only where the floor allows them, and
  the Developer section only with ?dev. The viewer's tab row is Material at
  the left and Render at the right, and fits a 390px phone.
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

- **File:** New (New sculpt, New armature), Open…, Open recent (Sculpt, Armature and the Present workspace; not the viewer); Save file, Save to
  library, Keep on this device (the Present workspace has one Save, or
  Save to its place); Import OBJ…, Z-up OBJ import, Load model…, Export
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

- Scene panel
- Model panel
- Material panel
- Tool panel
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
- **Go:** Gallery, Community (with accounts), My projects (signed in, not
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
│ File Edit View Help    Project · Object · Tris · Level  Publish │  title strip
├─────────────┐                                   ┌─────────────┤
│ Scene Model Material │                          │ Tool Render │  tabs
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
- Centre: the project's name in bold, then the readout of the selected
  object (name, triangles, level), keys regular and values bold. An
  unsaved project shows "Edited" after its name, in regular weight.
  Under 900px wide the readout drops the triangle count, then the level.
- Right: Publish, a quiet button, then the signed-in account's @handle menu, then the hide-interface icon.
- It is the one band that runs edge to edge.

### Panels

- Each side has one panel, docked under the title strip: Scene, Model and
  Material share the left one, Tool and Render the right one (owner call,
  2026-11-11: one panel open per side, with folder tabs).
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

### Tool bar

- Bottom centre, flush to the edge, as wide as its tools.
- Where it does not fit (under about 620px wide) it scrolls sideways and
  keeps the active tool in view.
- On devices with a home indicator it sits above the safe area.

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
| Under 600px wide (a phone) | An open panel is a sheet across the bottom, at most half the height, above the tool bar. Tabs become a row under the title strip |
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

## 9. Windows, notices and progress

- **Window** (Preferences, Publish, Help, Set scale, a confirmation): a
  `ground` box with a 1px outline, its name in the heading style, one
  primary button and the rest quiet. Escape closes it. On a phone it
  fills the screen. A confirmation of something that cannot be undone
  names the thing in its heading ("Delete Head?") and its primary button
  repeats the verb.
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
