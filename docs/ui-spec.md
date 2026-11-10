# Bozzetto interface spec

How Bozzetto's interface is laid out and behaves, on Gestalt v2. It is
written for Bozzetto Web first and for the desktop version after it: both
are built from this one document. Colour, type and the look of each
control come from Gestalt v2 (`README.md` and `bozzetto-interface.md` in
the system) and from the "Controls and states" board on the mockup canvas.
This spec adds structure and behaviour, and says where the mockup should
change.

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
| Touch | Larger rows and controls on iPad than on the Mac | Mostly a desktop app | Large targets throughout | Two densities from the same parts: compact for a mouse, touch for fingers and a pen |
| Hiding the interface | Full-screen viewer | Hide UI command | Full-screen toggle | Hide interface, in View and on a key |
| The main outward action | Share, top right | Share, top right | Export in a menu | Publish, top right (**Proposed**) |
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
2. **Rows of 28px cannot be touched reliably.** The system asks for 44px
   targets, and stacked 28px rows cannot each have one. Final Cut on iPad
   solves this with larger rows. Bozzetto gets two densities (section 4).
3. **Four panels that can all be open at once do not fit a laptop or an
   iPad.** Two open on one side each get half the height and both scroll.
   Final Cut and Figma show one panel per side and switch by tab. One
   open panel per side (**Proposed**, section 6).
4. **The menu bar is a web answer.** On the desktop the same commands
   belong in the system's menu bar, and on iPad in the system's menu.
   The spec defines commands once and lets each platform show them its
   own way (section 5).
5. **Help was a "?" icon; it is now a menu.** The order is File, Edit,
   View, Help. The "?" icon goes.
6. **The brush sliders are 96px tall and 16px wide in the mockup.** That
   is a mouse size. On touch they are 160px tall with a 44px wide target,
   and a left-handed setting moves them to the right edge.
7. **Hotkey digits and key hints assume a keyboard.** On an iPad without
   one they are noise, and a web page cannot tell whether a keyboard is
   attached. Both become View toggles, on by default in compact density
   and off in touch.
8. **Section headers carry numbers ("01 Material").** A number implies an
   order to follow, and folding sections have none. Inspectors in the
   apps compared use the name alone. Drop the numbers (**Proposed**).
9. **Publish is three levels down.** It is the app's one outward action.
   Final Cut and Figma keep theirs at the top right (**Proposed**).
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
4. **The same parts at two sizes.** Compact for a mouse and keyboard,
   touch for fingers and a pen. Nothing else differs between them.
5. **Commands are defined once.** The menus, the hotkeys, the hotkey
   guide, context menus and Help all read from one list.
6. **The platform's conventions win over invention.** Menu order, key
   names, where Settings lives, how a window closes: as the platform
   does it.

## 4. Density and input

| | Compact | Touch |
| --- | --- | --- |
| When | The main pointer is a mouse or trackpad | The main pointer is a finger or a pen |
| Row height (field, switch row, list row, menu row) | 28px | 44px |
| Panel button | 28px tall | 44px tall |
| Tool button | 44px | 52px |
| Title strip | 24px (28px on the Mac desktop) | 44px |
| Type | 13px labels, 11px values | The same |
| Brush sliders | 96px tall | 160px tall, 44px wide target |

- The density follows the pointer, not the screen size: an iPad with a
  trackpad attached still starts in touch, because the pen is in use.
  Preferences offers Automatic, Compact and Touch.
- **Keyboard.** A web page cannot tell whether an iPad has a keyboard
  attached, and the iPad runs the web app. So the hotkey digits on the
  tools and the key hints above the tool bar are two View toggles
  ("Hotkeys on tools", "Viewport hints"), on by default in compact and
  off in touch, and remembered.
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
Model panel, not in a menu. The viewer and the gallery have no Help menu.

## 6. Layout

```
┌──────────────────────────────────────────────────────────────┐
│ File Edit View Help    Project · Object · Tris · Level  Publish │  title strip
├─────────────┐                                   ┌─────────────┤
│ Scene Model │                                   │ Tool Render │  tabs
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
- Right: Publish (**Proposed**), then the hide-interface icon.
- It is the one band that runs edge to edge.

### Panels

- Each side has a row of tabs under the title strip: Scene and Model on
  the left, Tool and Render on the right. A tab is a `ground` box with
  the panel's name set horizontally.
- **One panel is open per side** (**Proposed**). Pressing a tab opens its
  panel under the tabs; pressing the open panel's tab
  closes it; the panel's header has no close button of its own. Opening
  the other tab on that side swaps them. The open panel's tab is
  inverted, like an open menu's name. The header names what the panel is
  about: the selected object in Model, the tool in hand in Tool.
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
- Right edge, bottom: the view axes. Pressing an axis turns the view to
  look along it (**Proposed**).

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

1. The Help menu, and the order File, Edit, View, Help.
2. The two densities, and that row height is 44px in touch.
3. One open panel per side, with the open panel's tab inverted.
4. The project name in the title strip.
5. Surfaces carry no outline; an outline means a control.
6. Hotkey digits and key hints as View toggles, off by default in touch.
7. Section headers without numbers, if agreed.
8. Notices, progress and context menus as specified above.

## 11. Building it

The mockup and this spec are the target, and each screen is built to
match them directly. The earlier plan repainted the old layout first and
moved the layout later; that produced an in-between look and is dropped.

1. **Foundations.** The system's tokens and fonts, the command list, the
   density switch. The work already done on tokens and fonts carries
   over.
2. **The controls**, once, to the Controls board, in both densities.
3. **Sculpt**: title strip and menus, tabbed panels, tool bar, edge
   controls, hints, view axes, context menus.
4. **Armature**, which shares Sculpt's shell.
5. **Gallery and viewer.**
6. **Windows, notices and progress.**
7. **Clean-up**: the old stylesheet and fonts.

Each step is compared against the mockup by screenshot, in both themes
and both densities, before it ships. The mockup gains iPad boards in
touch density before step 3 starts.
