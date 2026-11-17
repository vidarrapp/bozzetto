# Tool library and dock-style tool bar: design

Read-only. Nothing was edited. Sources read: src/sculpt/ui/SculptToolbar.ts, src/sculpt/ui/SculptPanel.ts, src/ui/keymap.ts, src/ui/dom.ts, src/ui/settings.ts, src/ui/deviceStorage.ts, src/sculpt/ui/shell.css (the tool bar at 503-630, the edge controls, panels), src/sculpt/ui/viewMenu.ts, src/sculpt/ui/statusToast.ts, src/sculpt/mode.ts:1394-1458, docs/ui-spec.md, docs/HANDOFF.md, docs/plans/reference-and-measure.md.

## 0. Summary

- **Where the library lives.** It is a sheet that rises out of the tool bar. A Library button at the bar's right end opens it, and so does View > Tool library. It is not a section of the Tool panel and not a menu in the strip.
- **The bar.** Select (Q) stays first and Transform (T) stays last. Between them are up to 10 places. The keys 1 to 9, then 0, follow the order of those places. Unlike macOS, the bar has an upper limit. When it is full, a tool dropped on the bar replaces the one under it.
- **Gestures.**
  - Pencil and finger: a long press (600 ms, the same as Negative's) lifts a tile.
  - Mouse: press and drag lifts it straight away, and a long press also works.
  - Once lifted, drag along the bar to move the tile. The other tiles slide aside and their digits change live as you go.
  - Drag the tile off the bar and let go to remove it. A notice offers Undo.
  - A long press that ends without moving opens the tile's menu.
- **A tool in hand that is not on the bar** shows as a temporary tile with no digit, after the last docked tool. This is the macOS "running app" idea. Hold it and drag it in to keep it.
- **Duplicates.** A copy is a new library entry with its own name, icon and settings, so it is not the same entry placed on the bar twice.
- **Storage.** The order and your own tools are kept on the device through `deviceStore`, so they follow the saving choice. Tool settings still ride the scene, as today.

## 1. Where the library lives

| Option | Verdict |
|---|---|
| Section of the Tool panel | No. The Tool panel is "how the tool in hand behaves" (SculptPanel.ts:44-52), and the one-home rule (ui-spec §3.2) keeps "which tools" out of it. It is closed while sculpting, so that the Size and Strength edge fields can show (ui-spec §6). It sits at the right edge, about 600 px from the bar on an iPad. A list of 13 or more tools above the settings would push the tool's own rows down. |
| Menu in the title strip | No. Menus are command lists that shut on any press outside them; they are not drag sources. The strip is 24 px at the top, about 740 px of travel from the bar on an 820 px tall iPad. |
| **Sheet above the bar** | **Yes.** Its bottom edge sits flush on the bar's top in the same `--bz-panel` fill, so the bar and the sheet read as one box, the way a showing folder tab joins its panel. The drag from a row down to the bar is 40-400 px. |

Ways to open and close it:

- **Library button.** A 44 px tile at the bar's far right, after Transform with an extra 8 px of space. Icon `fi-ss-apps` (it is in uicons solid straight). Tip: "Tool library". While the sheet is open the button has the `--bz-hover` fill, the way an open menu's name has its fill. There is no close button: as with a folder tab, pressing the Library button again closes the sheet.
- **View menu.** A checked item "Tool library", in the panels group after "Tool panel" (viewMenu.ts:80-90). No default key; the action `ui.toolLibrary` can be bound in Preferences. The free plain letters in sculpt mode are c, g, i, j, k, m, n, o, u, v, y and z.
- **Closing.** It closes on the Library button, the View item, Tab (it counts as a panel for `PANEL_CLOSE_ALL_EVENT`), Esc when nothing is being dragged, Present, and Hide interface.
- **Tapping a row** picks that tool and closes the sheet ("Tap a tool to use it"). Drags keep the sheet open.
- **Right-click on empty bar space** (mouse) opens a menu with "Tool library" and "Reset tool bar".

## 2. The bar

Order: `[Select q] [place 1] … [place n] (temporary tile) [Transform t] · [Library]`, with n from 0 to 10.

**Default bar.** The same as today, so nobody's keys change: 1 Crease, 2 Move, 3 Standard clay, 4 Inflate, 5 Pinch, 6 Flatten, 7 Rake, 8 Drag, 9 Polish, 0 Paint.

**Measurements.** Tiles stay 44 px with 4 px gaps and 8/12 px padding (shell.css:519-560).

| | Width |
|---|---|
| Today, 12 tiles | 596 px |
| Full bar plus Library: 13 × 44 + 12 × 4 + 8 + 24 | **652 px** |
| With a temporary tile (+44 +4 +8) | **708 px** |
| Height | 60 px, plus the safe area |

**Fixed ends.**
- Select and Transform cannot be lifted or removed, and nothing can be dropped beyond them. A drop before Select becomes place 1; a drop after Transform becomes the last place.
- A long press on Select or Transform shows the name tip for as long as it is held. ui-spec §4 asks for that ("a long press … on a tool shows its name"); today the tip only shows on `:hover` or `:focus-visible` (shell.css:621-628).
- The Library button cannot be lifted either.

**Tile states**

| State | Look |
|---|---|
| Rest | `--bz-text` icon at 22 px. Key badge at the bottom right, Martian Mono 11 px, `--bz-text-2` (hidden while View > Hotkeys on tools is off). |
| Hover (mouse or Pencil hover) | `--bz-hover` fill; the name tip above, as today. |
| Tool in hand | Orange fill; icon and badge in `--bz-on-accent`. |
| Pressed, before 600 ms | No change. The lift is the feedback; a tap acts on release, as with `onTap`. |
| Lifted | A ghost scales to 1.1 (48 px) over 120 ms ease-out, with the `--bz-raised` fill and `--bz-raised-shadow`; orange if it is the tool in hand. Its name tip shows above it at all times. Its own place stays as a 44 px empty gap. **Every place shows its digit while something is lifted, even with Hotkeys on tools off** (the iPad default, settings.ts:56-67), so you can see which keys move. |
| Dragging over the bar | The gap follows the insertion point. Neighbours slide 48 px using `transform` (no reflow) over 120 ms ease-out, and their badges show the digit they will have after the drop. |
| Dragging off the bar (remove zone) | The gap closes. The ghost drops to 50 % opacity. The tip reads "Let go to remove". |
| Over a tile, bar full (drag from the library) | That tile dims to 40 %. The tip reads "Replace Pinch". |
| Between tiles, bar full | No gap opens. The tip reads "The bar is full. Drop on a tool to replace it". |
| Disabled (a node tool that cannot run) | Icon in `--bz-text-3`. A tap gives a notice (§12). |
| Temporary tile | Orange (it is the tool in hand), no badge, 8 px extra space before it. It grows in from 0 width over 120 ms and fades out when another tool is picked. Tip: "Rake 2 · not on the tool bar". |

**Motion.** A drop flies the ghost into the gap over 120 ms. A remove shrinks the ghost to 0.6 and fades it at the drop point over 160 ms (no cloud). A cancel flies it back over 160 ms. With `prefers-reduced-motion` there is no movement, only jumps, matching shell.css:1590-1600.

## 3. What a library entry shows

**Sheet layout.**
- Heading "Tool library", 700 20/24, the panel heading style.
- One hint line, 13 px `--bz-text-2`: "Hold a tool, then drag it onto the bar. The keys 1 to 0 follow the bar's order."
- Sections, each with a section header:
  - **Sculpt:** Standard clay, Crease, Move, Inflate, Pinch, Flatten, Polish, Rake, Drag, Smooth.
  - **Paint and mask:** Paint, Mask.
  - **Measure:** Calipers, once it is built.
  - **My tools:** your copies and node tools, in the order made. While empty it says: "Duplicate a tool to keep a second set of its settings."
- A pinned footer with quiet 28 px buttons: "New tool…" on the left (once the node editor exists) and "Reset tool bar" on the right.
- No search field until the library passes about 30 entries.
- Select and Transform are not listed; the hint covers them.

**Row**, 44 px tall:
- The icon in a 44 × 44 square, drawn exactly as the bar tile, so what you drag looks like what lands. Orange if it is the tool in hand.
- 8 px of space, then two lines: the name (13/16 `--bz-text`, one line, ellipsis) and a description of 30 characters or fewer (13/16 `--bz-text-2`).
- At the right, if the tool is on the bar: its key in a 20 × 20 hairline kbd box, Mono 11 px. It is shown whatever Hotkeys on tools says, because it also means "on the bar, in place N".
- No lime in the rows; the key box says it all.

**Descriptions** (plain words, each 30 characters or fewer):

| Tool | Description |
|---|---|
| Standard clay | Builds up strips of clay |
| Crease | Sharp grooves and folds |
| Move | Moves a region with the pen |
| Inflate | Swells the surface out |
| Pinch | Tightens ridges and creases |
| Flatten | Planes toward a flat level |
| Polish | Flattens, keeps edges sharp |
| Rake | Parallel grooves, like a comb |
| Drag | Pulls the surface along |
| Smooth | Evens the surface (Shift) |
| Paint | Paints colour on the surface |
| Mask | Protects the surface (Ctrl) |
| Calipers | Measures between two points |
| A copy | Copy of Standard clay |
| A node tool | The user's own line, or "Made with nodes · 7 nodes" |

**Smooth and Mask as bar tools.** Offering them is new: today they can only be reached with Shift and Ctrl (SculptToolbar.ts:262-263; ui-spec §8). That means an iPad with no keyboard has no way to paint a mask. Docked, Shift still smooths and Ctrl still masks from any tool.
- A docked Mask needs Alt and the Negative button to mean "unmask". Today InputShell.ts:1489-1491 sets Mask's `_negative` from Ctrl and Alt and ignores the latch; that has to change for a docked Mask.
- A docked Smooth shows its own Size, Pressure and Spacing rows, which no UI can reach today. The Shift-smooth group already hides itself for Smooth (SculptPanel.ts:456-459).

**Row menu** (long press then let go without moving, or right-click):
- "Put on the tool bar" adds the tool at the end. When the bar is full this item is greyed out with the hint "The bar is full (10)". On a tool already on the bar it reads "Remove from tool bar" instead.
- "Duplicate"
- "Name and icon…" (your own tools only)
- "Edit nodes…" (node tools)
- "Reset settings"
- "Help" (opens the tool's Help topic)
- "Delete…" (your own tools only)

"Put on the tool bar" is the way in that needs no drag.

## 4. Adding a tool from the library

1. Lift a row: long press with the Pencil or a finger, or press and move 4 px with a mouse. The ghost is the 44 px icon tile, scaled to 1.1. The row itself stays where it is, because the library never loses an entry to a drag.
2. **Bar not full.** When the pointer enters the bar band (from 56 px above the bar's top edge down to the screen's foot), a gap opens at the insertion index. The bar grows 48 px and re-centres over 120 ms, and the digits renumber live. Letting go puts the tool in that place. There is no notice, since the bar shows the result.
3. **Bar full (10).** Only a drop on a tile does anything, and it replaces that tile (the "Replace X" state). The tool that was replaced goes back to being an entry in the library only.
   - Notice: "Clay soft took Pinch's place (5)." with [Undo].
   - If the replaced tool was the tool in hand, it stays in hand as the temporary tile.
4. **Already on the bar.** Dragging an entry that is already on the bar moves it: its bar tile becomes the gap.
5. **Dropped anywhere else.** The ghost flies back to its row and nothing changes.

**Insertion index.** It is the number of cached tile centres to the left of the pointer's x position. The centres are read once at lift time, and again after the bar scrolls on a phone. An 8 px hysteresis around each centre stops the gap flickering. No layout is read while moving.

## 5. Moving along the bar

Lift a tile and drag it sideways. The other tiles make room, dock-style, so every tool between the old place and the new one shifts by one place, and its key with it. Those badges show the new digits during the drag. Letting go gives no notice.

The alternative is a swap, where moving 3 onto 7 exchanges just the two and no other key changes. It is listed as an open question, because digits that follow the order make "the others make room" renumber the tools between.

## 6. Removing a tool (drag off)

- **The remove zone** is either of these:
  - more than 56 px above the bar's top edge;
  - more than 24 px past either end of the bar, at the bar's own height.

  With the sheet open, the sheet itself is in the zone, so dragging a tile back up into the library removes it.
- **Feedback.** The gap closes, the ghost drops to 50 % opacity, and the tip reads "Let go to remove". Lifting the pointer shrinks and fades the ghost over 160 ms, and the tiles to its right slide back and renumber.
- **Undo.** Notice: "Pinch is off the tool bar. It stays in the library." with [Undo] (the notice-with-button pattern in statusToast.ts:40-61, held 8 s). Undo puts the tool back in its old place with its old key.
  - Bar edits never go into the sculpt history: Ctrl+Z never moves tools, just as tool settings are not in the history today.
  - Undo is not needed for much, since the tool is still in the library.
- **Removing the tool in hand** is allowed. It stays in hand as the temporary tile, as an app keeps running after it leaves the Dock.
- **Cancel.** Esc, `pointercancel`, the window losing focus, or a second pointer going down all fly the ghost home and change nothing.
- **Mid-stroke.** Presses on the bar are refused while a stroke runs, as `selectBrush` already refuses (InputShell.ts:2566-2570).

## 7. Hotkeys follow the bar

**Keymap.**
- Replace the ten `tool.*` rows (keymap.ts:93-102) with `slot.1` … `slot.10`.
  - Group: "Tool bar".
  - Labels: "Tool bar, place 1" … "place 10".
  - Default chords: '1' … '9', '0'.
- `tool.select` (q) and `gizmo.toggle` (t) are unchanged.
- Viewer mode's 1-9 material keys are a different mode and are not affected.

**Dispatch.** InputShell.ts:2458-2479 becomes a single case: `slot.N` resolves to the entry in that place, which is then picked. A key for a place that is empty gives a plain 4 s notice: "No tool in place 8. Open the Tool library to add one." Digit keys are ignored while something is lifted.

**Badges** read `keymap.chordFor('slot.N')`:
- Today the badge and the tip's `<kbd>` print the literal digit from the tuple (SculptToolbar.ts:359-383), so a rebind in Preferences already leaves them wrong. This fixes that.
- A chord with a modifier gets no badge; the tip shows it in full via `chordLabel`.

**Migration.** At load, an old override on `tool.crease` … `tool.paint` in `bozzetto-keymap` moves to the `slot.N` that tool held by default. Today `load()` drops unknown ids (keymap.ts:408). Because the default bar is today's order, every rebound key keeps picking the same tool.

**The guide and Preferences** show the current tool beside each place, for example "1 · Tool bar, place 1: Crease", read when they are drawn.

**Help.** The "Default hotkey: **N**" lines (help/content/tools.ts:41-156) become: "Its key is its place on the tool bar; on the default bar it is **1**."

**Tests.** The e2e suite finds tool buttons by badge text (tests/e2e/smoke.mjs:3545, 3552, 3564). The defaults keep those working. Add `data-tool="crease"` and `data-place="1"` so the tests stop depending on keys.

## 8. Limits and overflow

- At most 10 places, one per digit, and as few as 0. With 0 the bar is Select, Transform and Library; Select and Transform play the Finder and Trash roles.
- No gaps: with 7 tools the keys are 1 to 7, and 8, 9 and 0 give the empty-place notice.
- No overflow row. The library holds everything, and the temporary tile covers "in hand but not docked".
- One entry can be on the bar only once. A second copy with other settings is a separate entry (§9).

## 9. Duplicates (two copies of one tool)

**Making a copy.**
- "Duplicate", from a tile menu or a row menu, makes a new entry under My tools: same kind, a copy of the original's current settings (size, strength, dynamics, curve, spacing, symmetry, and the tool's own extras such as Pinch, Plane lock or the Rake knobs), named "Standard clay 2", then 3, and so on.
- The "Name and icon" window opens at once with the name selected, because two tiles with the same icon are hard to tell apart.

**The "Name and icon" window.** A window with one primary button:
- Name field, 24 characters at most; it is used in the tip and the Tool panel heading.
- An icon grid of 44 px squares, 6 columns, from a curated set of uicons solid straight glyphs: the current ten plus, for example, brush, pencil, pen-nib, knife, hammer, feather, leaf, stamp, eraser, scissors, spoon, shovel, cube, mountain, bolt, star. All of these exist in the package.
  - The selected one gets the four corner brackets (decided 2026-11-10).
  - Any new glyph must be added to the generated icon subset (src/ui/icons.ts:1-6; tests/e2e/icons.mjs fails a class that is not in it).
- Buttons: Save (primary) and Cancel.

**Names.** Built-in names are fixed, because Help topics are named after them. Your own tools can be renamed.

**Deleting a copy.**
- Heading: "Delete Clay soft?"
- Body: "It comes off the tool bar and its settings are lost. Strokes it made stay."
- Buttons: Delete (primary, orange, as decided 2026-11-10) and Cancel.
- If the deleted tool was in hand, the hand moves to place 1, or to Standard clay if the bar is empty.

**Settings model** (recommended; open question 5):
- Settings ride the scene for every tool, built-in or copy, as decided today (mode.ts:1394-1415).
- A tool the scene has no settings for starts from its settings as last left on this device. The library entry keeps that copy.
- Built-ins keep their numeric scene keys. Your own tools are keyed by their string id in a new `settings.tools` table. Today the sanitiser only accepts keys of 1-3 digits (sanitize.ts:36, 80-89).
- In the engine, picking a copy loads its settings into the one vendor instance of its kind. The per-tool side stores (DynamicsStore, SymmetryStore, the world-scale sizes, curves) become keyed by entry id instead of by `Enums.Tools`.

## 10. Reset to the default bar

- "Reset tool bar" is in the sheet's footer and in the bar's right-click menu.
- It puts back the ten default tools in the default order. Settings and My tools are untouched; copies simply come off the bar.
- No confirmation window, since it can be undone. Notice: "Tool bar reset to the default." with [Undo].
- Hotkey rebinds are separate and are reset in Preferences.

## 11. Persistence

Stored through `deviceStore` (localStorage), following the device choice exactly as the keymap and settings do (keymap.ts:265-277, 402-424):

```
bozzetto-toolbar  {"v":1,"bar":["crease","move","clay","inflate","pinch","flatten","rake","drag","polish","paint"]}
bozzetto-tools    {"v":1,"tools":[{"id":"u-3f9k2a","kind":"clay","name":"Clay soft","icon":"fi-ss-feather","settings":{…},"made":1763100000000}]}
```

- **Built-in ids** are stable words: crease, move, clay, inflate, pinch, flatten, polish, rake, drag, smooth, paint, mask, calipers. One table of tool kinds (id, enum, name, icon, svg slot, description, section, Help topic) replaces TOOL_NAMES (SculptToolbar.ts:47-61), the toolbar tuple (255-270) and the ten keymap rows.
- **Writes.** The bar is written only when it differs from the default, as the keymap and settings do.
- **Sanitising on load:**
  - unknown ids are dropped;
  - repeats are dropped after the first;
  - the bar is cut at 10;
  - a node tool with a newer graph format is kept but cannot run.

  A write that fails (quota or blocked storage) keeps working for the page, and shows once: "The tool bar could not be saved on this device."
- **Storage choice:**
  - None: nothing is read or written, and the bar starts at the default.
  - Declined: arranging works for the visit. The first change gives one notice per visit: "Saving on this device is off, so the tool bar goes back to the default next time."
  - Keep: saved. On a first "keep", what an earlier visit kept is loaded. When saving is turned on again later, what is on screen is written.
- **Scope.** It is per device, not per account and not per scene: an iPad and a desktop can have different bars, which suits their different inputs. Another tab picks up a change on its next load; the last write wins.
- **Size.** Node graphs are a few KB of JSON, well inside localStorage.

## 12. Tools made in the node editor

- They appear under My tools like copies. The description is the user's own line (30 characters at most), or "Made with nodes · 7 nodes", followed by the key box if the tool is on the bar. They have the same row menu, plus "Edit nodes…".
- **Making one.** "New tool…" in the footer opens the editor with "Start from: Standard clay / Crease / … / Empty".
- **Saving.** "Save" updates the entry in place, so every tile and every scene that uses that id gets the new behaviour. "Save as new tool" makes a new id.
- **A graph that does not validate.**
  - The row's description shows in orange (orange for errors, decided 2026-11-10): "Needs fixing".
  - The tile is dimmed.
  - A tap gives the notice "Clay ribbon cannot run." with [Open nodes].
- **A graph from a newer Bozzetto.** The row reads "Made in a newer Bozzetto" in `--bz-text-2`. It is kept and cannot be picked.
- **Scenes.** They store settings by entry id. A scene opened on a device without that tool keeps the record untouched for the round trip and ignores it.
- **Later:** carry the definitions in `.bozz`, with "This scene uses 2 tools you do not have" and [Add to library]; and export or import a single tool file.

## 13. Pencil, finger and mouse

| | Pencil | Finger | Mouse |
|---|---|---|---|
| Pick | Tap (lift on the tile) | Tap | Click |
| Lift a tile or row | Long press, 600 ms | Long press, 600 ms | Press and move 4 px, or a long press |
| Menu | Long press, then let go within 8 px | Same | Right-click |
| Moving before 600 ms | More than 8 px is a slip: neither a tap nor a lift (as `liftedOn`) | Sideways on a phone bar scrolls it; vertical in the sheet scrolls it | Starts the drag |
| Ghost position | Centred on the nib | 48 px above the finger, so the finger does not cover it | Centred on the cursor |
| Name tip | When lifted; and on hover with Pencil hover | When lifted | On hover (as today) |

- **Why the Pencil waits for a long press on the bar.** The bar is under the working hand, and a quick Pencil flick across it should not reorder anything. It also gives one rule for the Pencil and the finger, everywhere. The mouse keeps desktop drag. Owner question 6 is whether the Pencil should also drag straight away.
- **One long-press duration.** Move `LATCH_MS` (SculptToolbar.ts:29) to dom.ts as `LONG_PRESS_MS` and share it with Negative.
- **Mechanics**, the same as Negative's (SculptToolbar.ts:122-191):
  - timestamps from the events, not the timer, decide;
  - `touchstart` preventDefault stops the iOS callout and drag at about 450 ms (dom.ts:78-91);
  - no `setPointerCapture`, because Safari cancels a captured touch when a second one lands;
  - `pointermove`, `pointerup` and `pointercancel` are heard on the window during a lift;
  - `-webkit-touch-callout: none` and `user-select: none` on the bar and the sheet.

  Haptics are not available on iPad web, so all feedback is visual.
- **A finger on the glass** hides the Pencil (SculptToolbar.ts:71-79). That does not matter here, because a drag uses one pointer, and a second pointer cancels it.
- **Code.** One drag module serves both bar tiles and library rows. The ghost is a fixed element that moves with `translate3d`, one update per animation frame. Nothing runs during a stroke.

## 14. iPad 1180 × 820 and phone 390 × 844

**iPad landscape 1180 × 820**
- **Bar:** 652 px when full, at x 264-916, 60 px tall, sitting on the home-indicator safe area. Panels already end 16 px above it (shellLayout's foot rule).
- **Sheet:** 540 px wide (two columns of 258 + 8 + 2 × 8 padding), centred at x 320-860, so it clears both 304 px panels (0-304 and 876-1180) by 16 px. Both side panels can stay open.
- **Height:** as tall as its content, at most 50 % of the screen (410 px), with the footer pinned. It sits on the bar's top edge.
- **Sections:** full width, with the rows in two columns. Sculpt takes 5 rows; Paint and mask, 1; Measure, 1. That is about 550 px with the headers, so the sheet scrolls inside itself.

**iPad portrait 820 × 1180, and anything under 1100 px wide** (one panel open in all, ui-spec §6)
- The same 540 px sheet, centred.
- Opening it closes an open panel it would overlap, and opening a panel closes it.
- Maximum height 590 px.

**Phone 390 × 844**
- **Bar:**
  - It scrolls sideways under 620 px, as today (shell.css:532-537).
  - The Library button is pinned outside the scroller at the right end, so about 6.5 tiles show.
  - The tool in hand is kept in view (keepInView, SculptToolbar.ts:320-327).
  - While dragging near either 32 px end of the scroller, it auto-scrolls 4 to 12 px per frame.
  - Worth checking on a phone: the buttons cancel `touchstart` (dom.ts:91), which likely stops a swipe that starts on a button from scrolling the bar. The dock's press handler should scroll the bar itself on more than 8 px of sideways travel before the long press.
- **Sheet:** full width, at most half the screen (422 px), above the bar, from y about 328 to 750. One column of 366 px rows that scrolls inside. Opening it closes any open panel sheet (one sheet at a time, ui-spec §6).
- **Remove zone:** the same 56 px rule. With the sheet open, the sheet is the zone.

## 15. Wording

| Where | Text |
|---|---|
| Bar button and View item | Tool library |
| Sheet hint | Hold a tool, then drag it onto the bar. The keys 1 to 0 follow the bar's order. |
| Sections | Sculpt · Paint and mask · Measure · My tools |
| Empty My tools | Duplicate a tool to keep a second set of its settings. |
| Footer | New tool… · Reset tool bar |
| Drag tips | (the tool's name) · Let go to remove · Replace Pinch · The bar is full. Drop on a tool to replace it |
| Temporary tile tip | Rake 2 · not on the tool bar |
| Tile menu | Tool settings · Duplicate · Name and icon… · Remove from tool bar |
| Row menu | Put on the tool bar / Remove from tool bar · Duplicate · Name and icon… · Edit nodes… · Reset settings · Help · Delete… |
| Notices | Pinch is off the tool bar. It stays in the library. [Undo] · Clay soft took Pinch's place (5). [Undo] · Tool bar reset to the default. [Undo] · No tool in place 8. Open the Tool library to add one. |
| Delete window | Delete Clay soft? / It comes off the tool bar and its settings are lost. Strokes it made stay. / Delete · Cancel |
| Keymap rows | Tool bar, place 1 … Tool bar, place 10 (group "Tool bar") |
| Help line | Its key is its place on the tool bar; on the default bar it is **1**. |

## 16. Open questions for Vidar

These are written in the HANDOFF format. I did not write them to docs/HANDOFF.md because this pass was read-only. Whoever adds them should commit and push them, as CLAUDE.md asks.

```
- [ ] 2026-11-14: Where the tool library opens: a sheet rising from the tool bar, from a Library button at the bar's right end and View > Tool library (recommended); a section of the Tool panel; or a menu in the title strip (blocks: the tool library)
- [ ] 2026-11-14: Moving a tool along the bar: the others make room and the tools between get new keys, shown on the badges during the drag (dock style, recommended); or the two tools swap places so no other key changes (blocks: the tool bar drag)
- [ ] 2026-11-14: A full bar (10 tools): a tool dropped on it replaces the one under it (recommended); or the bar may hold more than 10, the extra ones with no key (blocks: the tool library)
- [ ] 2026-11-14: Smooth and Mask in the library as tools that can go on the bar, Shift and Ctrl still working as now; this gives an iPad with no keyboard a way to mask. Yes (recommended) or keep them reached by Shift and Ctrl only (blocks: the library's contents)
- [ ] 2026-11-14: Copies of a tool with their own settings: settings keep riding the scene, and a tool the scene has no settings for starts from its settings as last left on this device, built-ins included (recommended); or copies keep their settings on the device only, outside the scene (blocks: Duplicate)
- [ ] 2026-11-14: Lifting a tool off the bar: Pencil and finger with a long press of 600 ms, the same as the Carve button, and a mouse by dragging straight away (recommended); or the Pencil also drags straight away (blocks: the tool bar drag)
- [ ] 2026-11-14: Calipers once the bar follows the library: a library tool that gets a digit when put on the bar, not on the default bar (recommended); or a fixed tool beside Transform with its own letter key, as the plan said (blocks: Calipers' place)
```

## 17. Existing issues found on the way

- Tool badges and tip keys are literal digits (SculptToolbar.ts:255-270, 359-383), so a rebind in Preferences already shows the wrong key. Section 7 fixes this.
- Help hard-codes "Default hotkey: **N**" for each tool (help/content/tools.ts:41-156).
- The spec's "a long press on a tool shows its name" (ui-spec §4) is not built: the tip shows only on `:hover` and `:focus-visible` (shell.css:621-628).
- Mask cannot be painted on an iPad with no keyboard (it is Ctrl only), and Smooth's own Size, Pressure and Spacing rows can never be reached. Section 3 offers both as library tools.
- Likely, to check on a phone: the scrolling bar may not scroll from a swipe that starts on a button, because `onTap` cancels `touchstart` (dom.ts:91; shell.css:532-537).
- Several tool settings are not saved at all: Move's falloff, Crease's Pinch, and Polish's Plane lock and Build-up (SculptPanel.ts:314, 342, 364, 378). Copies of those tools would lose them too until they are given a saved field.
