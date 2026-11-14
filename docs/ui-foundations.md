# Bozzetto application layer: foundations

The visual foundations of Bozzetto's interface. Gestalt v2 was written for
print, the web and video; an application needs things those rules leave
out or forbid. This layer keeps Gestalt's identity and gives the app its
own foundations (owner call, 2026-11-11). `docs/ui-spec.md` covers layout
and behaviour and still holds, except where this document says otherwise.

Drawn on the mockup canvas, top row: "Sculpt · application layer",
"Sculpt, Edit menu open · application layer" and "Foundations and
controls · application layer".

**Dark theme only.** A paper theme is not part of this layer. A native
iOS app, later, will also have to answer to Apple's Liquid Glass; this
layer does not try to.

## What it keeps from Gestalt

- Orange and lime, and the hand-drawn logotype.
- Familjen Grotesk for labels and titles, Martian Mono for values.
- Square corners.
- The icons (Flaticon Uicons, solid straight).
- The splash and the gallery's logotype.
- The voice of the copy: sentence case, plain words.

## What it replaces

| Gestalt rule | In the app | Why |
| --- | --- | --- |
| Black and white only, no grey | A neutral grey scale | An interface ranks things by tone: secondary text, unavailable controls, hover, selection, one surface over another. And a pure black or white frame changes how the model beside it reads; 3D and video apps use neutral dark grey for that reason |
| No shadows | Menus, tooltips and windows have a 1px lighter border and a shadow | Something that floats has to separate from what is under it |
| Hover changes only the pointer | Hover lightens the control | Both platforms answer the pointer, and so does a hovering Pencil |
| Orange for active, pressed, chosen and errors | Orange for what is active, an amount, and the one main action; red for errors and deletes | One job per colour |
| Lines are never dividers | 1px separators between groups in panels and menus | Dense panels need them |
| Disabled is a dashed outline | Unavailable is dimmer text on the same control | The platform convention |
| Hovered menu row turns bold | Hovered menu row takes the hover fill | The platform convention |
| Every control answers to a 44px target | No such rule | Every control is pressed with a pen, a mouse or a hotkey |

## Surfaces

| Name | Value | Used for |
| --- | --- | --- |
| Strip | #1b1b1b | The title strip; a tab that is behind |
| Viewport | #222222 | The Sculpt and Armature viewport |
| Panel | #2c2c2c | Panels (at the Panel opacity preference), the tool bar |
| Raised | #333333 | Menus, tooltips, windows, notices: with a 1px #555555 border and a shadow |
| Control | #3a3a3a | Buttons, selects |
| Hover | #4b4b4b | A hovered control or row; a selected row; the preset in use; an open menu's name; the box of a switch |

## Text and lines

| Name | Value | Used for |
| --- | --- | --- |
| Text | #f2f2f2 | Labels, values, titles |
| Secondary | #b3b3b3 | Section headers, hotkeys in menus, captions, readout keys, the tab behind. On the Hover fill it is 4.2:1, so a hotkey or hint on a hovered row is Text |
| Unavailable | #7d7d7d | Text and icons of a control that cannot be used; the star that is not pressed. Never text that is read (3.4:1 on the panel) |
| Hint | #a3a3a3 | Faint text that is read: the placeholder of a field, the word for a key with none. 4.5:1 or more on the strip, viewport, panel, raised and control greys; dimmer than Secondary |
| Field line | #5c5c5c | The line under a field |
| Separator | #444444 | Between sections of a panel and groups of a menu |

## Colour

| Name | Value | Its one job |
| --- | --- | --- |
| Orange | #ff5a1f | The tool in hand; the amount in a field; the one main action of a window; the focus outline. Text on it is black |
| Lime | #c6ff00 | The knob of a switch that is on |
| Red | #ab0000 | Something went wrong; an action that cannot be undone. Never a switch that is off: off is neutral, as on macOS and iPadOS. A fill only, with white text on it (7.7:1); on the greys it is under 2:1, so never text, an icon or a line |
| Red text | #ff6b6b | Red as text (error lines), as an icon or a stroke, and as the trash icon and "Delete account…" under the pointer or on focus, which are grey and white at rest: the light red that reaches 4.5:1 on the panel and the raised grey |
| Lime, as a button | #c6ff00 | The recommended action (`.btn--recommended`): the one step the person should take next, one to a screen, such as Keep on this device in the first-visit window. Text on it is black. A window has this or the orange main action, not both |

The view axes keep their own red, green and blue.

Play and pause in the transport is a regular button like the others; its
icon is light grey at rest and white while pressed or while playing, in the
viewer, in review mode and in Present alike, never orange (owner call,
2026-11-14). The viewer therefore
has no orange action; orange stays the line's played part and the focus
outline.

## States

| | Rest | Hover | Pressed | Selected or on | Unavailable | Focus |
| --- | --- | --- | --- | --- | --- | --- |
| Button | Control | Hover | Strip | | Control, dim text | 2px orange outline, 2px off |
| Main action | Orange | | | | | |
| Delete | Red | | | | | |
| Tool | No fill | Hover | | Orange, icon black | | |
| Tab | Strip, secondary text | Text brightens | | Panel surface, joined to the panel | | |
| Field | Line and orange amount | Label brightens | Dragging | Label bold when changed from default | Dim | |
| Switch | Hover-grey box, grey knob at the left (off) | | | Same box, lime knob at the right (on) | | |
| Menu row | No fill | Hover | | A check before it | Dim, with the reason | |
| List row | No fill | Control | | Hover | | |

## Type

- Labels, buttons, menus: Familjen Grotesk 13px. Panel and window
  titles: Familjen Grotesk bold, 20px and 17px.
- Values: Martian Mono 11px, as typed ("3 cm", "0.50"), not forced to
  capitals.
- Section headers: Martian Mono 11px in capitals, secondary colour.
- Nothing under 11px.

## Open

- Whether a field changed from its default shows its label in bold.
- The gallery and the viewer in this layer are not drawn yet.
