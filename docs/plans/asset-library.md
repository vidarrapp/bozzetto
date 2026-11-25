# Plan: the dock and the Asset library

Status: plan for Vidar, 2026-11-18. Nothing is built.

Decided so far (2026-11-17 and 18): the tool bar becomes a dock; one shared
**Asset library** window with tabs for **Tools**, **Materials** (the current
matcaps included), **Lighting** (light rigs) and **HDRIs**; the window can
also browse and search the **Community** for assets. Node-based brushes wait
for the 1.0 release on Rust, so the tools here are today's tools and copies of
them with their own settings.

This replaces the library parts of `docs/plans/tool-library-and-nodes.md`,
which stays as the record of the node design. What exists today for each kind
of asset, with files and lines, is in `docs/plans/drafts/asset-library/map.md`.

---

## 1. The short version

- **The dock** is the tool bar, rearranged by hand: long press to lift a tool,
  drag it along the bar, drag it off to remove it. The number keys follow the
  order.
- **The Asset library** is one floating window that stays open while you
  work. Four tabs. In each, three places an asset can come from: what ships
  with **Bozzetto**, what is **Mine** on this device, and the **Community**.
- **An asset is a small file** you can keep, pass on and share: a tool
  (`.bztool`), a material (`.bozzmat`), a matcap (a picture), a light rig
  (`.bozzrig`, exists today), an HDRI (`.hdr`).
- **The Community part needs new server work and a new promise.** Today the
  Community shows works that can be looked at and never copied. Shared assets
  are the opposite: they exist to be taken and used. That is the one large
  decision in this plan (section 6).

Order of work, each step shipping on its own:

| Step | What you get | Size |
| --- | --- | --- |
| 1 | Nothing visible: tools get names instead of numbers; the Tool panel is built from data | one package |
| 2 | **The dock:** lift, move, keys follow | one package |
| 3 | **The window, with Tools:** drag in and out of the bar, copies of tools, tool files | one to two packages |
| 4 | **Lighting and HDRIs tabs:** the rig library moves in; your own HDRIs | one package |
| 5 | **Materials tab:** ready-made materials, your own, matcaps and your own matcaps | one to two packages |
| 6 | **Community:** share, browse, search and add assets | server and client, the largest step |

Steps 1 to 5 need no server change and work offline.

---

## 2. The dock

Sculpt and Paint each have their own bar.

- **Order.** `[Select q] [tools…] [Transform t] [Calipers c]` in Sculpt,
  `[Select q] [tools…]` in Paint. Select, Transform and Calipers keep their
  places and keys and cannot be lifted.
- **Keys follow the bar.** `1` to `9` and `0` pick whatever sits in the ten
  places. A bar holds ten tools and no more (Vidar, 2026-11-24): a full bar
  refuses another tool and says so. **Tool groups** are the way to more, for
  1.0 on the Rust core with the tool copies: one place holding several
  tools, the place showing the one last used, its key pressed again cycling
  them (only while that place's tool is in hand, with the new tool's name
  shown, so a habitual press does not switch tools unseen), a tap on the
  place already in hand opening the group's tools above the bar for the
  Pencil, and "Add to group" in the tile's menu before any drop-onto-a-tile
  gesture.
  Badges, the hotkey guide, Preferences and Help read the place.
- **Lift:** a long press with Pencil or finger (600 ms, as Carve latches); a
  mouse may also just press and drag. The lifted tile follows the pointer
  with its name above it, and every place shows its digit while something is
  lifted.
- **Move:** the others make room and their digits change as you go.
- **Remove:** drag it off the bar. A notice says it is still in the library,
  with Undo. Removing comes with step 3, when there is a library to get it
  back from.
- **A tool in hand that is not on the bar** shows as one extra tile with no
  digit; drop it in to keep it.
- **A wide bar scrolls sideways** and keeps the tool in hand in view.
- **A long press that ends without moving** opens the tile's menu: Tool
  settings, Duplicate, Name and icon…, Remove from tool bar.
- The bars are kept on the device. Bar edits are not sculpt history, and
  nothing on the bar can be pressed during a stroke.

Still open from before: how Smooth and Mask are reached without a keyboard
(buttons beside Carve, tools for the bar, or both). The dock does not wait
for it.

---

## 3. The Asset library window

**One window.** Floating over the view, movable, not blocking the work under
it, staying open while you drag from it and try things. It remembers its
place and size on the device. Esc closes it when it has the focus; Tab hides
it with the rest of the interface.

**How it opens.** A **Library** button in the heading of the Tool panel, the
Material tab and the Lighting tab, each opening the window on its own tab;
and **View › Asset library**.

**Layout.**

```
┌ Asset library ─────────────────────────────── × ┐
│ Tools   Materials   Lighting   HDRIs            │
├─────────────────────────────────────────────────┤
│ [Bozzetto] [Mine] [Community]      Search…      │
│                                                 │
│  ▢ Standard   ▢ Crease   ▢ Move   ▢ Inflate     │
│  ▢ Pinch      ▢ Flatten  ▢ Polish ▢ Rake        │
│  …                                              │
├─────────────────────────────────────────────────┤
│ Import…                              42 assets  │
└─────────────────────────────────────────────────┘
```

- **Tabs** across the top: the four kinds. All four are always there, so
  assets can be browsed and tidied from any workspace. Where an asset cannot
  be seen (a light rig while sculpting), using it still works and the window
  says "Shows in Present".
- **Where from:** Bozzetto, Mine, Community, as three buttons under the tabs.
  The search field searches the one that is showing.
- **Each asset is a tile:** a picture, its name, and a small mark if it is in
  use (on the bar, on an object, the scene's rig). Tiles are large enough for
  a finger.
- **Tap** uses it. **Lift** (the same long press as the bar) drags it: a tool
  onto the bar, a material onto an object in the view. **The tile's menu:**
  Use, Duplicate, Name…, Export, Share to Community, Delete….
- **Import…** reads a file of any of the kinds and puts it on the right tab.

**What each tab holds**

| Tab | Bozzetto | Mine | Using one |
| --- | --- | --- | --- |
| **Tools** | every tool the app has, by workspace: Sculpt's brushes, Paint's tools, Twist and Local scale | copies of tools with their own settings, name and icon | takes it in hand; lift it onto the bar to keep it there |
| **Materials** | a ready-made set (clays, plaster, wax, bronze, stone, a neutral white for painting), and the ten matcaps | materials saved from the Material tab; matcap pictures you add | a material goes onto the selected objects; a matcap switches the view to it |
| **Lighting** | the ten light rigs | rigs saved from the Lighting tab (today's My rigs) | sets the scene's lights |
| **HDRIs** | the six environments | `.hdr` files you add | sets the scene's environment light |

**Pictures.** Rigs, materials and HDRIs get a small rendered ball, made when
the asset is saved and kept with it. A matcap is its own picture. A tool shows
its icon first; a picture of its stroke on a plane is worth trying later.

### What changes for each kind

- **Tools.** A tool asset is one of the app's tools with its own settings
  (size, strength, pressure, curve, spacing, symmetry, its own knobs), a name
  and an icon. Duplicate makes one. A copy follows later fixes to the tool it
  came from. Icons come from a set kept in the app.
- **Materials.** Today a material lives only inside a scene, there is no
  ready-made set, and nothing renames or deletes one. This adds the set, Save
  to my materials, and Rename and Delete in the Material tab. Using a library
  material copies it into the scene, so the scene still opens the same
  anywhere.
- **Matcaps.** A matcap is not a material in the same sense: it replaces the
  lighting for the whole view and ignores albedo, paint and lights. In the
  library it sits on the Materials tab as its own group. Scenes remember a
  matcap by its place in a fixed list of ten today; they must remember it by
  name before anyone can add one, or old scenes would show the wrong picture.
- **Lighting.** The rig library is the one part that exists (save, rename,
  delete, export and import as `.bozzrig`). It moves into the window and the
  Lighting tab keeps its Rig select.
- **HDRIs.** The six are fixed in the app today and no file can be loaded.
  This adds your own, kept on your device only: a Radiance `.hdr`, brought
  down to 2k on the device if it is larger, since bigger ones are slow to
  prepare and heavy to hold. HDRIs are not shared by members (section 6).

### Where assets are kept

- **On the device,** in one store for all kinds, following the saving choice.
  Pictures and HDRIs are too large for where the rigs sit today, so the store
  moves to the device's database and today's rigs move with it. With saving
  off, the library still works for the visit and says it will not be kept.
- **In the scene:** what a scene uses travels with it, as now for materials.
  A scene that uses your own matcap or HDRI carries that file in its `.bozz`.
- **As files:** every asset exports and imports as its own small file, with
  every number held to its range on the way in.
- **Published work** is the open point: the public viewer can only load what
  ships with the app (question 5).

---

## 4. Order of work in more detail

**Step 1. Names and data (nothing visible).** Tools get word ids
(`bz.clay`…) in place of the engine's numbers, still writing the old numbered
tables so an older installed app reads a newer scene. The Tool panel's rows
are built from each tool's list of settings. The four settings that are not
saved today (Move's falloff, Crease's pinch, Polish's plane lock and
build-up) start being saved. Place keys replace per-tool keys.

**Step 2. The dock.** Lift and move, the keys following, the bars kept on the
device, Sculpt and Paint each with their own. No remove yet.

**Step 3. The window and the Tools tab.** The window's frame, built with all
four tabs from the start (the other three say "Coming" until their step).
Bozzetto and Mine. Drag to the bar, drag off, Duplicate, Name and icon,
`.bztool` export and import, the one device store.

**Built so far (Unreleased).** The window has Models, Materials, Lighting and HDRIs tabs (Models is new, second in the row). Models holds the Create choices, Materials the ten matcaps, Lighting the ten built-in rigs and the saved rigs under Mine, HDRIs None and the six environments, fetched on the tap. They and the panels' pickers are built from one list each (`src/library/assets.ts`, `modelAssets.ts`), so the two cannot differ. Still waiting: your own copies (a rig's save, rename and delete are still the Lighting tab's), your own `.hdr` files and matcap pictures, sharing, the Community, and more and larger HDRIs from the server (an entry already carries a list of files).

**Step 4. Lighting and HDRIs.** The rig library moves into the window and the
store. HDRI tiles for the six, and your own `.hdr` files, with the scene
remembering an HDRI of yours and carrying it in its file.

**Step 5. Materials.** The ready-made set, My materials, Rename and Delete,
drag onto an object; matcaps remembered by name, the ten in the window, your
own matcap pictures.

**Step 6. Community.** Section 6.

Steps 4 and 5 can be built side by side once step 3's frame and store exist.
Step 1 touches the tool bar and Tool panel only, so it can run beside the
Armature shell work.

---

## 5. What stays out

- Node-based brushes and the tool editor: 1.0, on Rust.
- Per-object matcaps, textures, PBR maps: not in Bozzetto Web.
- Automatic updates of an asset taken from the Community: a taken asset is
  your own copy.
- A device storage meter. Worth adding once HDRIs are kept on the device; not
  needed to start.

---

## 6. The Community

### What is true today

- The Community is a list of **works** (models and timelapses). A card opens
  the viewer. Nothing can be copied or downloaded, and the terms and the note
  shown at a first share say so.
- The server accepts four kinds of project and exactly four file names, each
  with its own check. Only two kinds can be shared.
- Every shared work is reviewed before it is public, can be reported, and is
  hidden after two reports until a reviewer looks.

### What assets need

1. **A second promise.** A shared asset can be taken and used by anyone. That
   has to be said plainly where it is shared, and the terms need a section
   for it, beside "all rights stay with the authors" for works.
2. **Their own place on the server,** not more project kinds: an assets list
   with its own files, limits and counts, reusing the report, star and search
   machinery that works have. Works stay view-only and untouched. An asset
   should not use up one of an account's 500 project places.
3. **A check for each kind on upload,** as scenes and armatures have: tools,
   materials and rigs are small files of numbers and a name, checked field by
   field; a matcap is a picture with a limit on its size; an HDRI is the
   large one and needs its own header check and a cap on its dimensions and
   bytes.
4. **Moderation by kind** (Vidar, 2026-11-18):

   | Kind | Who may share | Before it is public | Afterwards |
   | --- | --- | --- | --- |
   | Tools, materials, light rigs | any member | nothing: they hold only numbers and a name, so the worst they can carry is a vulgar or hateful name | the owner and moderators can rename or hide one; members can report one |
   | Matcaps | any member, who confirms the picture is their own work | looked at by a reviewer, as a shared work is, since it is a picture | the same, and Report has "not theirs" among its reasons |
   | HDRIs | the owner only, for now: files from Poly Haven under CC0 | nothing | the owner manages them |

   Members cannot share HDRIs. If that is opened later, the sharer will have
   to state the source and confirm the CC0 status, so it can be checked.
   Everyone can keep any HDRI they like on their own device (step 4), and
   take the owner's from the Community.
5. **Editing by the owner and moderators.** A reviewer's view of an asset has
   **Rename** and **Hide** (with a reason the author sees) and Unhide, and
   the Review page gets an Assets tab listing what is shared, newest first,
   with its reports. This is the "way to be edited" the light moderation of
   tools, materials and rigs depends on.
6. **Taking one.** A new open address serves a public asset's file. In the
   window, Community tiles have **Add to mine**, which copies it to the
   device with its author's name kept on it.

### In the window

The Community button on each tab lists that kind: search by name or
`@handle`, sort by newest or most starred, a star on each tile for signed-in
members, **Add to mine** on every tile, and Report in the tile's menu.
Sharing is **Share to Community** on one of your own tools, materials, rigs
or matcaps (not HDRIs), with a first note that says what sharing an asset
means; for a matcap the note also asks you to confirm the picture is yours. Offline, the Community button
says it needs a connection, and what you added earlier keeps working.

---

## 7. Decisions and questions

Recorded in `docs/HANDOFF.md` as well.

**Decided (Vidar, 2026-11-18)**

- Tools, materials and light rigs are light to moderate: public when shared,
  with the owner and moderators able to rename or hide them.
- Matcaps can be added and shared by members, who confirm they own them; as
  pictures they are looked at before they are public.
- HDRIs in the Community come from the owner only, from Poly Haven under CC0.
  Members do not share HDRIs for now, but can keep any HDRI on their own
  device. Whether members may share them later, with a stated source and a
  confirmed licence, is still being thought about.

**Still open**

1. **What sharing an asset means.** Anyone may take it and use it in their
   own work, with no credit needed, and the sharer says it is theirs to give
   (recommended: the simplest rule, and it matches the CC0 of the HDRIs and
   mannequins). Or credit is required, and the app carries the author's name
   with the asset wherever it goes.
2. **Who can take from the Community.** Anyone, signed in or not; an account
   is needed only to share, star and report (recommended). Or members only.
3. **Published work that uses your own matcap or HDRI.** The public viewer
   can load only what ships with the app. Recommended: the published project
   carries the file, built with the Community step; until then publishing
   says the viewer will show the nearest built-in. Or always fall back.
4. **Tabs in every workspace.** All four always shown, and using an asset
   that cannot be seen from here says where it shows (recommended). Or a tab
   shows only in the workspaces where it applies.
5. **Smooth and Mask without a keyboard** (open since 2026-11-17): buttons
   beside Carve that arm them for the next strokes, tools for the bar, or
   both.

## Where assets live (2026-11-25)

Assets are kept either on Bozzetto, as shared community assets a person subscribes to or likes and as what they save to their own library (which is online too), or in the scene itself. **Library** is the button for the first, **Scene** for the second (on every tab). Saving your own tools and presets online, subscribing and liking wait for the Rust core.
