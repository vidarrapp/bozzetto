# Bozzetto

<img width="2358" height="1339" alt="bozzetto_screenshot_261007" src="https://github.com/user-attachments/assets/cd4ab67a-714c-424e-821d-310b5602ff8a" />


A *bozzetto* is the small clay study a sculptor makes before the real piece, where the rough form gets worked out.

Bozzetto is a studio in the browser to pose, sculpt, render and timelapse. Set up a mannequin for reference or as the start of a figure, sculpt in clay with an Apple Pencil or a mouse, light and render it, and capture every stage as real geometry to play back as a timelapse you can relight, orbit and scrub. Not a pre-rendered video.

It installs to an iPad's home screen and works offline, and there are desktop builds for macOS, Windows and Linux. Built as a study and teaching tool, and as a way to render out content. Shared under MIT for anyone who finds it useful.

**Live at [bozzetto.vidarrapp.se](https://bozzetto.vidarrapp.se)**

| Where | What |
| --- | --- |
| `/` | Gallery |
| `/?sculpt=1` | Sculpt mode |
| `/?sculpt=1&project=<id>` | A scene from Projects, open in Sculpt |
| `/?armature=1` | Armature mode |
| `/?tl=<id>` | Viewer |
| `/?me`, `/?account` | My projects and Account, once the site has accounts |
| `/create/` | Uploader for models and timelapses (**Create → Upload Model(s)**), no sign-in |
| `/admin/` | Projects and the full editor, publishes to the gallery |

## Install as an app

Bozzetto installs to the home screen and launches fullscreen. That is the way to use sculpt mode on an iPad. The gallery's **Install** button walks you through it.

**iPad / iPhone (Safari):** Share button → **Add to Home Screen** → **Add**.

**Android (Chrome):** **⋮** menu → **Add to Home screen** → confirm.

**Installed, Bozzetto works offline.** A service worker precaches the app with its base meshes, mannequins and default environment, so it opens, sculpts and poses with no network at all. The gallery still shows your work in progress and the projects you saw last time; the other environments download once and are kept. Only opening a timelapse you have never played needs a connection.

**Updates download in the background, and the app says so:** a notice in the corner shows the download's progress, and afterwards names the version it updated to. On the gallery an update goes in straight away; anywhere else the notice offers **Reload**, which saves your work first.

Sculpts autosave to browser storage whether installed or not. Nothing uploads unless you sign in and publish or save to the library. There are no analytics and no ads; the privacy notice and terms are at `/legal/`. On iPad, installing also protects that storage: home-screen apps are exempt from the eviction that clears ordinary browsing data. Deleting the app still takes it, which is why a guest's **Save to library** downloads a file.

## Sculpt

Pick **Create → New Sculpt** in the [gallery](https://bozzetto.vidarrapp.se). No sign-in needed, and nothing leaves your device unless you sign in and save to the library or publish.

- **Ten brushes** on `1`–`0`: Crease, Move, Standard clay, Inflate, Pinch, Flatten, Rake, Drag, Polish, Paint. `Alt` carves, `Shift` smooths from any brush. Without a keyboard, tap the toolbar's **Negative** button to carve the next stroke, or long-press it to carve every stroke until you tap it again.
- **Brush character** is tunable per tool, and every brush keeps its own size, so each comes back at the size you left it. Clay lays ribbon-like strips. Move starts on the model, like every brush, and drags a soft ball of it, with a Falloff slider from soft to sharp. Polish flattens surfaces while keeping edges crisp, with a Plane lock slider from follow to flatten. Crease has Profile and Pinch sliders, from a broad trough to a knife line.
- **Stencils.** The Rake combs grooves through a stroke-aligned stencil. Clay can take one too, off by default. A Spacing slider sets how far the brush travels between stamps.
- **Apple Pencil pressure** drives brush strength through the stroke, with per-brush response curves.
- **Masking** with `Ctrl`, plus blur, sharpen, invert, clear, and **Extract** to turn a masked region into a new object, all in the Model panel's **Mask** section, which acts on the active object.
- **Mirror symmetry** per brush, on across X by default, each brush with its own axis. Hovering shows the mirrored brush ring.
- **Topology**: a multiresolution stack, dynamic topology with stroke detail sliders, and voxel remesh up to 512 voxels across, its grid drawn over the view while you hold the resolution slider. A remesh the device cannot spare the memory for is refused with the reason. **Delete highest**, beside **Rebuild** in the Model panel, drops the top level of the stack with its detail, in one undo step.
- **Painting**: vertex-paint albedo with an HSV picker, alt-click to sample, or drag the swatch onto the viewport to pick a colour off the screen, as the background's and the lights' swatches do. Flood fill, and `Shift` blurs the paint under the brush. Named materials per object, each with albedo, roughness and metalness.
- **Create menu** in the Scene panel: seven primitives (sphere, cube, cylinder, torus, cone, capsule, plane) and a **base-mesh library**, Blender Studio's CC0 [Human Base Meshes](https://www.blender.org/download/demo-files/#asset-bundles): male and female figures in realistic and stylized topology, voxel-remeshed blockout figures, heads (realistic, stylized, planar, low-poly cage, blockout), hands, feet, eyes, jaws and skulls. A figure arrives with its eyes as separate objects, one undo step, at the same size as a primitive; a blockout arrives as one remeshed shell or, with the menu's switch, as its fifty separate lumps. The files are precached with the app, so the whole library works offline.
- **Object transforms**: a unified move/rotate/scale gizmo whose centre moves across the screen, single modes on `W`/`E`/`R`, with a settings panel for which handles show. Multi-object scenes with an outliner, whose rows `↑` and `↓` step through (`Shift` extends the selection), a Select tool (`Q`) with marquee and Maya-style modifiers, and duplicate, delete, mirror, radial copies, merge (a voxel union) and the gizmo all working on the whole selection. Locked objects draw as if masked. **Solo** (`Alt`+`Q`, or the Scene panel's **Solo** button) shows the active object alone until you press it again.
- **Present mode**: the **Present** button in the top row, beside Capture, or `Shift`+`P` (rebindable in Preferences), shows the model on its own. The toolbar, the brush rail, the Scene, Model and Tool panels, the brush ring and the object stats go, and the brushes, the gizmo and every key that edits are locked, while orbit, pan and zoom carry on, fingers included. The Render panel stays for the lights, environment, material (with **Sculpt colours** / **Plain colour**), ambient occlusion, depth of field and background. A bar along the bottom has a **Turntable**, a slow turn about the model's vertical axis at the speed its slider sets, which any press, touch or wheel on the view stops and the timelapse never records; **Save image**, a PNG at twice the window (twice the screen's pixel density, at most 4096 pixels across) with its smoothing finished and no interface in it, downloaded as `<title>.png` or, in the desktop app, saved where its dialog says; and **Done**. `Tab` hides the Render panel and the top row too. **Done**, the button or `Esc` puts the interface back as it was, the open panels, the tool and the brush with it. **Save to library** and the Capture window's publish from Present mode store the view (camera position, target and lens) and the whole look, its tone mapping included, as the project's own, so the viewer and its gallery card open the model at that camera and look, and the thumbnail is of the presented view.
- **Full render controls** while sculpting: lighting, matcaps, tone mapping, ambient occlusion, depth of field, environment and camera. The look saves with your scene.
- **Panels**: Scene, the object list, and Model, the active object's material, topology and mask, dock down the left edge; Render and Tool, the active brush's settings, down the right. One panel per edge is open at a time, and an edge's tabs stay clear of each other on every iPad screen.
- **Timelapse capture**: mesh snapshots after each stroke, stored locally, publishable to the gallery. The **Capture** button in the top row, beside File and Edit, opens a floating window with **Record timelapse**, the frame count, **Clear frames** and the two publish forms. It blocks nothing, so you keep sculpting with it open; drag it by its title bar, and it stays where you put it for the session. Close it with its button, the Capture button or `Esc`. Recording is off until you tick the box, and the device remembers the choice. It only records where the timelapse can go somewhere: signed in on the web or the iPad, including once that sign-in has expired (the reel waits for **Sign in again**), or in the desktop app. A guest on the web has no Capture button and records nothing.
- **Files**: `.bozz` save and open for the whole scene, plus OBJ import and export.
- **Scene library**: signed in, **Save to library** stores the scene in Projects on the server, private until you make it public, with its progress shown while it uploads; saving again updates the same project in place, and a copy stays on the device so the scene still opens offline. With accounts on it goes to your own **My projects** instead, whoever you are signed in as, the owner included: private, with no id or visibility to choose, and counted against your storage; when that is full the scene stays on the device, and the notice says how full (for example "Your storage is full (248 of 250 MB)"). Signed out it downloads a `.bozz` file (the share sheet, on an iPad), because browser storage does not survive a reinstall, and **Keep on this device** still puts a scene on the device's own shelf. Saved scenes appear as gallery cards with a thumbnail, object and triangle counts and their size; open one with a tap, rename it in place, delete it when you are done. A card for a scene kept only on the device says so, and signed in it offers **Upload to Projects**. A save whose upload cannot go, because the sign-in has expired or there is no connection, keeps the scene on the device as **Not uploaded**, with **Upload to Projects** on its card, and the notice says which it was; an expired sign-in comes with **Sign in again**, which goes through the login and back to the same scene. Separate from the autosave, which still resumes your work in progress.
- **Made for iPad**: fingers navigate in every tool, one to orbit and two to pan and zoom, and only the Pencil and the mouse sculpt, select or move objects (**Edit → Preferences** lets fingers sculpt too, for working without a pen). A finger tap still selects in the Select tool and under the gizmo. A resting palm never blocks the Pencil, a long press brings up none of Safari's callouts, loupes or menus, and the touch toolbar covers keyboard-less use. Carving is a tap on **Negative** rather than a finger held on it while you draw, because a fingertip on the glass hides the Pencil from the page until it lifts.
- **Reload-safe**: your work autosaves to IndexedDB, a few seconds after the first change and then at most once a minute while you keep working, and straight away when you leave sculpt mode or the page or the app goes to the background. The autosave also remembers which project in Projects the scene came from, so after a reload **Save to library** still updates it; a `.bozz` file never carries that link. Unfinished work shows in the gallery as an "In progress" card, beside any scenes you saved to the library, labelled as what it is: on this device only, lost with a reinstall or a cleared browser.

## Armature mode

<img width="2362" height="1331" alt="bozzetto_armature_mode" src="https://github.com/user-attachments/assets/d5b59363-7006-47af-a572-f3089ad40c87" />

A posable figure of its own, for reference or as the start of a sculpt.
Pick **Create → New Armature** in the gallery (or open `/?armature=1`). No
sign-in, and everything stays on your device.

- **Figures.** A new armature starts on the realistic male mannequin,
  one of four: Blender Studio's CC0 "primitive" base meshes, male and
  female in realistic and stylized proportions, rigged onto the app's
  bones by `tools/build-mannequins.py`. The Figure list also offers the
  block placeholders (male and female); each lump follows its bone
  rigidly, so a mannequin poses, reaches and sends to Sculpt exactly like
  the blocks. The mannequins, about a megabyte each, are precached with
  the app, so all four are there offline; the autosave and `.armature`
  files only name them. The blocks are code and always there, so they are
  the fallback when a mannequin cannot be fetched (offline before the
  service worker has precached it) or a saved model cannot be read.

- **Pose.** Tap or click a part and its joint's rotate gizmo appears, clamped to
  that joint's limits: hinges (elbows, knees) show one ring plus a little
  twist, ball joints three. Symmetry (`X`, off to begin with) mirrors every
  edit to the other side through the pelvis's own frame. The pelvis is the
  root: its gizmo moves and turns the whole figure (`W` selects it). The
  selection stays while you orbit, pan and zoom, from on the figure or off
  it; a tap on empty space lets it go, and a tap on another part moves it.
- **Reach.** A ball sits at each hand, the middle of each foot and the top
  of the head. Drag one and the limb reaches for it, inside the same joint
  limits; a foot is held by its middle, so it pivots there rather than
  swinging round its toe. A target past a joint's reach, a ball dragged
  too far or a pin the pelvis has left behind, settles the limb at the
  nearest pose the limits allow, rather than flicking between poses as
  the drag goes on. **Pin** a ball and it holds its place in the world
  while the rest of the figure moves, so the pelvis can drop into a crouch
  with the feet planted or the body can lean away from a hand that stays
  put. The violet ball in the hips moves the whole figure: drag it and the
  figure follows the pointer across the view, as the pelvis gizmo's centre
  moves it, the pinned balls holding their places, and the drag is one undo
  step. Both feet start pinned where they stand, and **Reset pose** moves
  every pin to where the reset leaves its hand or foot. A tap on a hand,
  foot or head ball selects it, with a move gizmo that reaches the limb as
  a drag of the ball does. With **Plant feet**
  on (the Reach section's box, on by default), a foot on the ground stands
  flat, facing the way the figure faces, after every reach, pin and reset,
  and a ring on the floor marks it. Planting stands a foot flat; the pins
  are what keep it in its place, with planting on or off:
  in a deep crouch it stays as flat as the ankle bends, then the heel lifts.
  A foot off the ground follows its shin; one on the ground can still be
  turned by hand, until the next reach or move of the pelvis stands it flat
  again. The balls take the click over the parts: a press within 18 pixels
  of one takes it, even where a part is in front.
- **Aim.** A smaller ball sits at each knee and elbow. Drag it and the bend
  swings around the limb without moving the hand or the foot: a knee points
  forward, an elbow back, as the figure faces, and each starts where it
  points at rest. A knee or elbow turned by hand keeps its new direction.
  The Tool panel has the same as an **Aim** slider when a knee or elbow is
  selected.
- **The floor.** Every figure stands with its soles on the floor, as it is
  loaded and as one figure replaces another; a saved pose comes back as it
  was saved. The floor stays put in Armature mode: the Render panel's
  **Ground** offers no pedestal, which would move it.
- **Proportions.** Per part, *size* scales the cross-section and *length*
  stretches the part along its bone and moves the child joints with it.
  Mirrored while symmetry is on.
- **Your own figure.** **File → Load model…** takes a rigged `.glb`: its
  bones become the rig, its skin becomes the shape. Joint limits and reach
  chains are read from the file's custom properties where they exist and
  worked out from the bones where they do not, and the panel says which it
  got. `tools/blender_armature.py` builds the same rig inside Blender, from
  the same numbers, so a figure modelled against it drops straight in; see
  `tools/README.md`.
- **Files.** The figure autosaves on this device and shows as a card in the
  gallery, with a picture of it taken as you leave through the Gallery
  link. **File → Save** writes an `.armature` file (plain JSON: preset,
  pose, proportions, pins and the lighting; not the picture), **File → Open**
  reads one back.
- **Send to Sculpt** voxelises the posed figure into one closed object at
  the resolution on the slider (up to 512; the voxel grid shows over the
  figure while you hold it) and opens Sculpt mode with it; a sculpt with work in
  it gets the figure as an extra object instead. A resolution the device
  cannot spare the memory for is refused before it leaves.

| Input | Action |
| --- | --- |
| Click a part | Select it (rotate gizmo at its joint) |
| Click off the figure | Deselect |
| Click a hand, foot or head ball | Select it (move gizmo) |
| Drag a ball | Reach that hand, foot or head towards it |
| Drag, on the figure or off it | Orbit, keeping the selection |
| Drag a small ball | Aim that knee or elbow around the limb |
| Drag the ball in the hips | Move the whole figure, pinned hands and feet staying put |
| `X` | Symmetry on / off |
| `W` / `E` / `T` | Move the pelvis · rotate the selection · both at once |
| `Shift`+`R` | Reset the pose |
| `Esc` | Deselect |
| `Ctrl`+`Z`, `Ctrl`+`Shift`+`Z` | Undo, redo |
| `Ctrl`+`Enter` | Send to Sculpt |
| `F` / `A` | Frame the figure |
| `L` (hold + drag) | Move the key light: across swings it round the figure, up and down raises and lowers it. While `L` is held the drag does nothing else |

## Make your own timelapse

The public editor at [`/create`](https://bozzetto.vidarrapp.se/create/) runs entirely in your browser. Nothing uploads, and there is no account.

1. In the gallery, pick **Create → Upload Model(s)**, or open [`/create`](https://bozzetto.vidarrapp.se/create/) directly.
2. Drop in `.obj` or `.glb` files, one per stage, named so they sort in order. Tick **OBJ files are Z-up** for Blender and most DCC exports.
3. Set a title, pick **Timelapse** or **Model**, and set the playback FPS.
4. Set up the look in the right-hand panel, then orbit to your angle.
5. Optionally add **stages** to name key frames. They become scrubber markers.
6. Press **Export .html** for one self-contained file that opens offline.
7. Export MP4 or GIF from **Record reel**.

A single mesh works too: drop one file and get a shareable 3D model on one page.

## Desktop app

A packaged build for macOS, Windows and Linux, for when you want Bozzetto as a
real application: native **Open** and **Save** over `.bozz` files (double-click
one to open it), a window title that names the open document and marks unsaved
changes, a save prompt before closing, recent files, and crash recovery.

Download it from the [latest release](https://github.com/vidarrapp/bozzetto/releases/latest),
or from the gallery's **Install** card, which leads with the build for your
platform. Every environment, base mesh and mannequin ships inside it.

It is local by default and makes no network requests at all. Point it at a
Bozzetto server under **Server → Server Settings** if you want to publish
from it; signing in opens a real window. On a server with accounts
that is the site's own sign-in, which leads with a code by email (a passkey on
a phone or a security key works too), and Server Settings then says which
account you are signed in as; on one without, it is Cloudflare Access. Signed
in, **File → Save to Library** and the Capture window's publishing save to My
projects on that server (Projects, without accounts), as they do on the web;
without a server the scene stays on this machine. **Sign Out** ends the
session on the server as well as in the app.

**Known issue:** after signing in to a server, the app can stop responding
for a few minutes on some machines when v-sync is off. Turning **V-sync** on
under **Edit → Preferences → Desktop** avoids it. We are looking for reports
of this from real hardware.

## Features

### Viewer

- Per-frame geometry streaming. Frames are gzipped, position-quantized GLBs, roughly 3–4× smaller than raw meshes. Frames near the playhead are prefetched, the rest fill in behind.
- Timelapses that fit the device memory budget buffer whole, so scrubbing and looping never reload. Larger ones keep a budget's worth around the playhead.
- WebGPU through three.js's node renderer, with automatic WebGL 2 fallback. Same materials, shadows, AO and depth of field on either backend.
- Real-time relighting: a multi-light rig with two presets, per-light toggles and colours, rig rotation, and soft VSM shadows.
- Material modes: lit PBR and matcaps, with a wireframe overlay, in smooth or flat shading. A sculpt published with paint shows its own colours, or one plain colour that the albedo sets.
- Ten matcaps in a thumbnail gallery. Tone mapping is selectable: None, Neutral, AgX or Cinematic.
- HDRI environment lighting with three background modes and separate rotation for the rig and the HDRI. The HDRI's intensity runs 0 to 2, where 1 is a fill that leaves the key light's modelling alone, and the plate shown as the background has its own brightness.
- Ground-truth ambient occlusion and node-based depth of field, both adjustable.
- Adaptive quality that backs off render cost when the frame rate drops.
- DCC-style orbit, pan and dolly, with a saved camera per project.

### Gallery

- The site's templates as thumbnail cards, badged **Template**, led by a **Create** tile, whose menu stacks **New Sculpt**, **New Armature** and **Upload Model(s)** (the uploader, for a model or a timelapse), and your own sculpt and armature in progress. A model or a timelapse plays in the viewer; a scene opens in Sculpt as a copy that is yours to keep, with **Save to library**, and never a change to the template.
- Signed in, the gallery is your whole list, the templates included: private projects carry a **Private** badge and every card a switch to change it, making a project public makes it a template, and the scenes you saved to the library sit beside the device's own, opening in Sculpt, to rename, delete or make public. Guests see the templates the gallery lists, and nothing else.
- Every card for something kept only in this browser, the work in progress and the scenes kept on the device, says that a reinstall or clearing the browser loses it.
- **Install** and **Log in**, which becomes **Projects** once signed in, and **Log in** again when the sign-in expires, said once under the title with **Sign in again**. With accounts on, **Sign in** and **Install** for a guest; signed in, **My projects** and an **@handle** menu (**Account**, **Sign out**), and **Owner tools** for the owner. The foot links the Privacy notice and the Terms.
- The **Install** card also offers the desktop app, reading the latest GitHub release so the links never point at a stale version, and leading with the build for the visitor's platform.

### Public editor (`/create/`)

- No sign-in, no backend. Frames are converted in the browser and nothing uploads.
- The preview is the real viewer, with the same Render panel as the full editor.
- Exports a self-contained `.html` with viewer, frames and assets inlined.

### Editor (`/admin/`)

- Create a project from a title, then drop in a sequence of `.obj` or `.glb` files.
- OBJ to glTF-binary conversion runs in a Web Worker, overlapped with upload.
- Set up the look in the preview and press **Save look** to store the opening state.
- Mark stages, capture any frame as the gallery thumbnail, and rename or re-configure from **Settings**.
- Every project is public or private: **Settings** has the choice, and so does each row of the project list. Public makes it a template, the site's rather than yours. Each row also has a **Template** switch: on, the project belongs to no one, and **Private** says whether the gallery lists it; off, it is yours again, and private. Publishing from Sculpt asks too, public unless you choose otherwise. Scenes saved from Sculpt are listed as well, and open there; a template's opens the template itself, to edit.
- **Record reel** exports the timelapse or a turntable spin as MP4 or GIF, up to 1080p, with a choice of aspect.
- Export a self-contained `.html` that opens offline.

## Controls

Every slider shows the value it is set to while you drag it, in a bubble
under the handle. Double-click a slider (double-tap on touch) to type a
value instead: Enter or a press anywhere else applies it, `Esc` keeps what
was there. A typed value may go past the slider's travel: the handle stays
at that end and the row shows the value. It is held only to what the
setting can be, so an intensity never goes below zero, a roughness stays
within 0 to 1, and an angle wraps round.

Every key below can be changed under **Edit → Preferences** (`Ctrl`+`,`). The
guide (`H`) shows whatever keys are set. At its foot it names the version
running, the release and the commit it was built from, as in
`0.5.3 (2e735c6)`, with **Check for updates** beside it. The desktop app names
it there and, on macOS, in its About panel, and has nothing to check: it
updates by release.

| Input | Action |
| --- | --- |
| Left drag | Orbit |
| Middle drag, or `Cmd` / `Shift` + drag *(two-finger drag on touch)* | Pan |
| Right drag / scroll | Zoom |
| `Space` | Play / pause |
| `←` / `→` | Step frame |
| `F` | Focus (frame the model) |
| `A` | Frame the whole scene |
| Double-click *(double-tap on touch)* | Set focus point |
| `1` | Lit (PBR) |
| `2`–`9` | Matcaps |
| `Shift`+`W` | Wireframe overlay |
| `Shift`+`S` | Shadows on / off |
| `G` | Cycle ground |
| `Tab` | Show / hide panels |
| `H` | Hotkey guide |

### Sculpt mode

| Input | Action |
| --- | --- |
| Drag on the mesh, with the pen or the mouse | Sculpt (`Alt` carves, as does the toolbar's **Negative** button: a tap carves the next stroke, a long press every stroke until a tap; `Shift` smooths; with the paint brush, `Shift` blurs the paint) |
| Drag off the mesh, or one finger anywhere in any tool | Orbit |
| Two-finger drag / pinch | Pan / zoom, even on the model |
| Finger tap | In the Select tool, select what is under it (on nothing, clear the selection); under the gizmo, select the object tapped. **Edit → Preferences → Fingers sculpt too** makes a finger work like the mouse instead |
| `Ctrl` + drag | Paint mask (`+Alt` unmasks) |
| `Ctrl` + `A` / `C` / `I` / `H` / `E` | Mask all · clear / invert / hide mask · extract masked region |
| `1`–`9`, `0` | Brushes |
| `Q` | Select tool: click selects, `Shift` adds, `Ctrl`+drag removes, `Ctrl`+`Shift`+drag adds, drag a marquee (pen or mouse; a finger orbits), `Alt`+drag orbits. In the Scene list, `Ctrl`+click toggles and `Shift`+click takes a range |
| `Ctrl`+`M` | Mirror the selected objects across the brush's symmetry axis (the Scene panel's Mirror button offers X/Y/Z and radial copies) |
| `Ctrl`+`J` | Merge the selected objects into one, through voxel space at the Model panel's remesh resolution |
| `Alt`+`Q` | Solo: only the active object shows, and the solo follows when another becomes active. Again brings the others back as they were. The Scene panel's **Solo** button does the same without a keyboard; the panel says **Solo** while it is on, and a click on that or on any eye ends it |
| `↑` / `↓` | The previous / next object in the Scene list becomes active, as a click on its row does, wrapping at the ends; `Shift`+`↑` / `↓` extends the selection to it, as `Shift`+click does |
| `B` / `S` (hold, then drag with the pen down) | Brush size / strength (`[` `]` and `;` `'` step them) |
| `F` / `A` | Frame the model / the whole scene |
| `X` | Mirror symmetry for the current brush |
| `T` | Transform gizmo (all handles; its centre moves the object across the screen). Click an object to move the gizmo to it, `Shift`+click adds it to the selection, `Ctrl`+click removes it; the selection moves together |
| `W` / `E` / `R` | Move / rotate / scale gizmo (`T` again, or a brush key, returns to sculpting) |
| `P` | Frame meter |
| `Ctrl`+`D`, `D` / `Shift`+`D` | Subdivide · step subdivision level |
| `←` `→` | Turntable |
| `G` | Cycle the stage |
| `L` (hold + drag) | Move the key light |
| `Shift`+`S` | Shadows on / off |
| `Shift`+`W` | Wireframe overlay |
| `Ctrl`+`Z` / `Ctrl`+`Shift`+`Z` | Undo / redo |
| Double-click a Scene row | Rename the object |
| `Tab` | Closes panels, then hides the interface, the Capture window with it. `Tab` or `Esc` returns, the window where it was |
| `Shift`+`P` | Present mode: the model alone with the Render panel, brushes locked, a turntable and Save image. `Shift`+`P`, **Done** or `Esc` leaves |
| `Esc` in the Capture window | Closes the window |

URL switches: `?dev` reveals a developer section, `?q=low|medium|high` forces a quality tier. `?perfdebug=1` lists the last stalls and heavy operations with their times, and in sculpt mode `?inputdebug=1` logs pen and touch input; both can be on at once, and **Edit → Preferences → Diagnostics** keeps either on without the switch.

## Changelog

### Unreleased

- **Sculpt: Present mode.** A **Present** button beside Capture in the top row, and `Shift`+`P` (rebindable), show the model on its own: the toolbar, the brush rail, the side panels, the brush ring and the stats go, and the brushes, the gizmo and the keys that edit are locked, while orbit, pan and zoom work as ever, by finger on the iPad too. The Render panel stays, with **Sculpt colours** / **Plain colour** in its Material section while presenting. A bar at the foot of the screen turns the model on a **Turntable** at a speed you set (a press, touch or wheel on the view stops it, and it never reaches the timelapse), and **Save image** downloads a clean, fully smoothed PNG at twice the window's resolution (the desktop app asks where). `Tab` still hides the interface, the Render panel with it. **Done**, `Shift`+`P` or `Esc` brings everything back as it was: the open panels, the tool, the brush, the gizmo. The scene and the autosave are untouched throughout.
- **Publishing from Present mode keeps the presentation.** **Save to library** and the Capture window's **Publish model** / **Publish timelapse** from Present mode store the camera (position, target, lens) and the whole look, now with its tone mapping, as the project's own, and the viewer opens the published project at that camera, under that look and grade. Outside Present mode publishing is as before.
- **Gallery pictures are 4:5 portraits.** Every thumbnail the app takes - a publish, Save to library, the In progress cards of Sculpt and Armature, the editor's **Save thumbnail** - is the largest 4:5 portrait centred on the view (or on the capture guide's frame), at 800 × 1000 pixels, so the gallery's and the Projects page's 4:5 frames are filled edge to edge. Older pictures of other shapes still show whole in those frames, undistorted.
- **The legal pages are complete.** The terms and the privacy notice carry the owner's decisions in place of their placeholders: `bozzetto@vidarrapp.se` for questions, requests and reports; what templates may be used for; artistic nudity in figure work allowed, pornographic content not; and how long each kind of data is kept. Both are now version 2026-10-08, the version a new account accepts.
- **Sharper shadows, fitted to the subject.** Each light's shadow map now covers the subject's own bounds as the light sees it, instead of a square three times its size, and follows them: an object added, moved or scaled, a remesh, a stroke that grows the model, a posed figure, a light turned. Close up, it covers only the part of the subject in view, so a close-up gets the whole map. With softness off, the shadow under a chin no longer shows large jagged steps: on the default sphere a texel is about a third of what it was framed whole and about a ninth close up. Softness is kept in the scene's terms, so a shadow's edge is as soft at any framing, and Sculpt, Armature and the viewer fit the same way, so a published look shadows as it did in Sculpt.
- **The rim light casts its shadow.** It lit the far side of the model straight through it. It now casts by default, on every quality tier (phones and tablets get a smaller map), and its **Casts shadow** box still turns it off. Looks saved before this - the autosave, `.bozz` files, armatures and published projects - had the box off only because that was the default, so they open with the rim casting; a look saved from now on keeps its box as it was saved.
- **Armature: the clavicles mirror with symmetry on.** A shoulder lifted, dropped or swung forward - by its sliders, its gizmo or a drag of the hand - now moves the other shoulder as its mirror image, as every other joint does, on the mannequins and the blocks alike. Before, the copy came out half a turn twisted about the collarbone and stuck at the end of its limits. Saved poses open as they were.

### v1.4.1

**Armatures in My projects, undo in Armature mode, the floor locked, and the passkey fallback.** Desktop app 0.6.1.

- **Armature: the selection stays while you look around.** A part is selected when a tap or click lifts, so an orbit, a pan or a zoom - by mouse, wheel or fingers, begun on the figure or off it - leaves the part selected with its gizmo. A tap on empty space lets it go; a tap on another part moves it. A tap on a hand, foot or head ball now selects that ball, larger and lit, with a move gizmo that reaches the limb; a drag of a ball reaches as it always did, one undo step, and brings up no gizmo.
- **Armature: what Plant feet does, shown.** Planting stands a foot that is on the floor flat on it, and a ring on the floor now marks each foot it holds; off, a foot tilts with its shin. The pins, not planting, are what keep a foot in its place while the pelvis moves, which is why turning planting off moved no foot. The Reach section says so.
- **Armature: the figure on the floor, and the floor held.** Each figure stands with its soles on the floor as it loads and as it replaces another - a raised one included - while a saved pose comes back as saved. The floor no longer moves in Armature mode: the Render panel's **Ground** has no pedestal there, and `G` cycles past it.
- **A grey backdrop for Sculpt and Armature.** A new scene or figure, and **Reset look**, start on a neutral grey (#333333, 20 % on the colour picker's V); a saved look keeps its own. The viewer still follows the theme.
- **Create, as three buttons.** The gallery's Create menu stacks **New Sculpt**, **New Armature** and **Upload Model(s)**, the same width; the last opens the uploader, which takes a model or a timelapse.
- **Armature projects in the library.** **File → Save to library** in Armature mode keeps the figure as a project of its own, as Sculpt keeps a scene: in **My projects** when you are signed in (the owner's **Projects** with accounts off), with a picture of the current view, created the first time and updated in place after; a guest still gets a `.armature` file. The **In progress** armature card on the gallery saves it the same way. The project is the pose, pins, aims, proportions, symmetry and look on one of the built-in figures (a model loaded from a file stays on its device); it opens back in Armature mode from **My projects** (**Open**, and **Download** as a `.armature` file), and the owner's **Template** switch makes one a gallery card badged **Armature** that opens a copy in Armature mode. Opened files are checked field by field, and a figure Bozzetto does not have stands on the realistic male mannequin, saying so. The viewer does not play an armature.
- **Armature: the panel on the left.** The Armature panel docks on the left edge with the same tab as Sculpt's Scene and Model panels, clear of the top row; Render keeps the right edge, and both can be open together.
- **Armature: undo and redo, as in Sculpt.** `Ctrl+Z` and `Ctrl+Shift+Z`, the same keys as Sculpt's (rebinding them in Preferences changes both modes), and undo and redo buttons at the foot of the left edge, where Sculpt has them. Every pose change is a step: a drag of a ball or a gizmo is one step however long it runs, a panel slider one step once it is let go, and a pin, a reset, a mirror, symmetry or a change of figure one each. The last 100 steps are kept; New, Open and Load model start over.
- **Storage counted from the files.** The owner's bootstrap counts the projects it claims from storage, which before said they weighed nothing, and says when it ran out of room to count them all; **Recount** carries on across as many requests as an account's projects take; and the **Template** switch weighs a project from before the counting first, so the usage it moves is what the project holds.

### v1.4

**Accounts, ready for the site's owner to switch on; templates in the gallery; colour picked off the view.** Desktop app 0.6.0.

**The gallery shows the site's templates.**

- **Templates in the gallery.** What the gallery shows is now the site's templates, each card badged **Template**. A model or a timelapse still plays in the viewer. A scene opens in Sculpt as a copy that belongs to no project, so **Save to library** keeps it as your own, as it does any new scene: a `.bozz` download for a guest, a new private project when you are signed in, and never a save over the template; nothing of it goes on the device's shelf. Opening one asks first when there is work in progress on the device, as every card does, and Sculpt asks when the link came from elsewhere. Signed in, the gallery and the Projects page list the templates beside your own work, those taken off the gallery too; making a project public makes it a template, which the **Private** switch now says, and each row on the Projects page has a **Template** switch beside it. On, the project belongs to no one and **Private** says whether the gallery lists it; off, it is yours again, and private. **Open in Sculpt** there still opens a template itself, to edit, and saves it back there.
- **Ready for a files host.** Once the server names one for the templates' files (`files.vidarrapp.se`), their pictures and files come from there. The pictures are asked for in a way the installed app can keep, as it keeps the others, when the build is told the host (`VITE_MEDIA_ORIGIN`), and the desktop app asks its own server for the same files. The installed app never keeps what accounts add for signing in, the account itself or a member's own files, and the site's Content-Security-Policy, still report-only, names the files hosts.

**Accounts, off until the site's owner switches them on.** Until then none of it shows: the site is as it was, with templates, and Cloudflare Access signs the owner in.

- **Sign in with a passkey or a code.** The gallery's top row has **Sign in**, which opens a dialog over the page instead of leaving it, so whatever is on the page stays put: **Use a passkey**, the passkeys the device keeps for the site among the email field's suggestions, or **Email me a code**, six digits that work once, for ten minutes, and can be sent again after a minute. Where the browser offers no passkey, as Safari did on an iPad keeping its passkeys in 1Password, the dialog asks for your handle, and **Try again** asks for that account's passkeys by name, the code still beside it. After a sign-in by code a passkey is offered, and offered again next time if you skip it; on an iPad or iPhone the offer also says that Bozzetto on the Home Screen keeps a sign-in of its own, to sign in to there too. Where the page's address is not the one passkeys belong to (a preview, an IP address), or the browser has none, only codes are offered, saying why, and Account adds no passkey there. Signed in, the top row has **My projects** and your **@handle**, which holds **Account** and **Sign out**; the owner also has **Owner tools**. For offline use the installed app keeps who is signed in (never the address), until you sign out, and the site's own settings.
- **Join with an invite.** An invite link opens **Join**. The invite is checked as it opens and your handle as you type it (free, taken, reserved, or held for 90 days after someone gave it up); then your email address, a box to confirm you are 13 or older and accept the Terms, including the content policy, and Cloudflare's bot check, which only shows itself when it needs you. A code comes by mail to finish; in a computer's browser the mail also carries a link that finishes it in the browser that asked, and the tab that asked carries on by itself.
- **Save to library and Capture for everyone signed in.** **Save to library** in Sculpt saves to your own **My projects**, whoever you are, the owner included, with no id or visibility to choose, and saving again updates the same project; a guest still gets a `.bozz` file. A save that finds the sign-in gone keeps the scene on the device as **Not uploaded**, and **Sign in again** on its notice opens the sign-in dialog in place, then saves; an upload from a gallery card does the same. If your storage is full, the scene stays too, and the notice says so with the numbers, for example "Your storage is full (248 of 250 MB)". **Upload to My projects** on a gallery card sends a scene kept only on the device. The Capture window publishes a timelapse or a model to **My projects** too, by title alone, and recording works for anyone signed in.
- **My projects.** **My projects** (`/?me`) lists your own work: how much of your storage it takes, as a bar with what is stored, what an upload in progress holds and your quota (250 MB), then a card for each project with its picture, title, kind, size and date. **Open** opens a scene in Sculpt and a timelapse or a model in the viewer; **Download** saves a scene's `.bozz` file, or a zip of a timelapse's or a model's frames with its settings; **Rename** changes the title (up to 200 characters); **Delete** asks first, then removes it from the server and from the device. Offline the page shows the list as it was last seen, and only a scene the device has a copy of opens.
- **Account.** **Account** (`/?account`) changes your handle, once in 30 days, and your address, by a code sent to the new one, which the old one is told of. It adds, renames and removes passkeys, and lists where you are signed in, to sign any of it out, or everywhere else. Adding or removing a passkey and changing the address ask you to confirm it is you, with a passkey or a code, when your sign-in is more than ten minutes old; so do **Download my data** and **Delete account**.
- **Download my data.** **Account → Download my data** gathers everything the site keeps about your account and your projects' files, and zips them in the browser: `account.json`, a folder per project with its settings, scene, picture and frames, and a `README.txt` saying what each is. In a browser that can, you choose where the zip goes and it is written there as it is made; elsewhere it downloads once it is complete. Over 200 MB, which an iPad has to hold in memory, it can also be downloaded a project at a time.
- **Delete account.** **Account → Delete account** asks you to type your handle, then deletes the account and everything in it a step at a time, showing how much is left, and takes you to the gallery, signed out; a mail tells you it has begun. The device's copies of your projects go with it; scenes kept only on the device stay. If it stops part way, **Finish deleting** carries it on, and the site's owner can finish it too.
- **A suspended account is told why.** An account the owner has suspended is told so in the top row, the gallery, Sculpt and Account, and the mail it was sent gives the reason. It is offered **Sign out**, never a sign-in, since signing in again would not lift it, and its **Save to library** downloads a `.bozz` file instead. Its work is kept.
- **The owner's account.** `/admin/` offers **Create your account** the first time: a handle and the terms, for the address Cloudflare Access signed you in with. Your projects become the account's, and a passkey is offered. From then on the owner tools want the account signed in as well as Access, and ask for it in the dialog, in place.
- **Owner tools: Invites, Users and Audit.** `/admin/` has tabs beside **Projects** for the owner's tools over accounts: make and withdraw invite links, each shown once as it is made, with **Copy**; see the accounts, with their storage against the quota, and suspend or unsuspend one (the reason is mailed to its holder), sign one out everywhere, set its quota, count its storage again, or finish a deletion it left half done (flagged once it has waited a day); and read the audit log, filtered by action or subject. Refusals are said as sentences: your own account is never suspended or signed out from there, and an action an account has moved past since the page drew it says so and shows it as it now is.
- **Desktop app: sign in with your account.** On a server with accounts, **Server → Sign In** opens the site's own sign-in in its window, leading with a code by email; the mail carries no link, which would open another browser, and a passkey on a phone or a security key works too. The window closes by itself once you are in, its sign-in marked as the app's, and **Server Settings** says which account you are signed in as, asking the server rather than trusting what the app keeps: a sign-in ended elsewhere reads as ended, and **Sign In** starts afresh. **Save to Library** and the Capture window's publishing go to your own **My projects**, the owner's too, as on the web. **Sign Out** ends the session on the server, then lets the app's cookies go. On a server without accounts, Cloudflare Access signs you in, as before.
- **Privacy notice and Terms.** `/legal/privacy.html` and `/legal/terms.html`, the Terms with the content policy and how to report content, linked from Join, Account and the gallery's foot, and kept for offline use. The owner's decisions are still to be written in, in brackets.

**Colour picked off the view, the remesh's grid, and a passkey check.**

- **Sculpt colours or one plain colour.** A sculpt published from Sculpt mode carries its paint as vertex colours, which stood in for the albedo, so the Render panel's albedo did nothing to it. A model with colours now gets a **Colour** switch in the Material section: **Sculpt colours**, the default, with no albedo row since it would do nothing, or **Plain colour**, which sets the paint aside for the albedo. The choice is part of the look: **Save look** keeps it, the single-file export carries it, and a look saved before it opens on the model's own colours. Sculpt mode always shows its paint.
- **Pick a background or light colour off the view.** The background's swatch and each light's now pick as the paint brush's does, in Sculpt, Armature and the editors' previews: drag the swatch onto the view and the colour under the pointer is applied as you move, read from the frame as it was when the drag began. Let go over the view to keep it, or anywhere off it, over a panel say, to put the colour back. The Pinch icon stands in as the cursor until there is an eyedropper. Letting go over the swatch no longer opens its picker.
- **A larger colour picker.** The saturation/value field and the hue strip are twice the size, and the picker opens beside its panel rather than over the panel's rows, still fitting beside an open panel on an iPad held upright. The H row is gone, since the hue strip sets the hue; S and V take typed values like every other slider.
- **See the voxel grid, up to 512.** While the remesh **Resolution** slider is held, in the Model panel or in Armature's Send to Sculpt, the grid the remesh will build is drawn over the view: its cells on the three faces of the object's box nearest the camera, with a caption giving one voxel's size on screen and the memory the remesh will take. The resolution now goes to 512, on the slider and typed (it stopped at 300 and 400). A remesh, merge or Send to Sculpt that would need more memory than the device can spare, a quarter of what the browser reports or 1 GB where it reports nothing (Safari), is refused before it starts, saying how high this object can go, instead of taking the tab down; the remesher also gives its working memory back when it is done.
- **Passkey check.** Accounts sign in with passkeys and guard sign-up with Cloudflare's Turnstile, and a test page finds out whether those work where it matters most: on the iPad, in Safari and in the app installed on the Home Screen, which keeps its own sign-ins and where passkey prompts are reported to misbehave. **Edit → Preferences → Diagnostics → Passkey check…**, or `/?passkeycheck`, opens it, offline too. It says how the page was opened and what the browser offers, creates a test passkey, signs in with it, with any passkey for the site and from an email field's suggestions, and loads the bot check with Cloudflare's test key; **Copy report** copies every result as text. Nothing is sent to Bozzetto's server. The test passkey is a real entry in the device's password manager, named "Bozzetto passkey check" with the date, and the page says how to delete it. The desktop app has no such page.

### v1.3.5

**Verified sign-in, refused forgeries and crafted files, confined desktop file access.** Desktop app 0.5.5.

**The server checks who is asking, and from where.**

- **Access verification is required.** The header Cloudflare Access adds to name who signed in can be sent by anyone wherever Access does not front a route, and without `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` the server believed it. Now every admin request on a deployed host has its Access token verified as well, and until both variables are set the admin routes answer 503, "Access verification is not configured", rather than fall back to the header (see [docs/deployment.md](docs/deployment.md)). `DEV_ADMIN` works on `localhost` only, and an identity counts only on paths under `/admin/`. `ADMIN_EMAILS` stays optional.
- **Writes from other sites are refused.** The Access cookie goes with any request a signed-in browser sends, including one a page on another site makes it send. A write the browser marks as coming from another origin is now refused, and the writes that take JSON insist on `application/json`, which another site cannot send without the browser asking first. The editor, Sculpt and the desktop app are unaffected.
- **Sign in again stays on the site.** `/admin/login?next=/.//evil.example/x` sent the browser to `//evil.example/x`, which it reads as another site. It now always answers with a full address on the site itself.
- **A bad request is refused for what it is.** Malformed JSON was an internal error and is now a 400. A frame upload with no index was stored as the first frame, overwriting it; it is refused, as is an index past the 10,000-frame limit. A thumbnail must be a JPEG, as every client makes it. Project data is measured in bytes, as the database counts it, so text in scripts that take several bytes a character can no longer pass the 1.5 MB limit.
- **Headers for the site and its files.** No page of the site can be framed by another (it is never embedded), browsers are told to use HTTPS only and not to guess file types, the camera, microphone, location and USB are switched off, and a Content-Security-Policy runs in report-only mode, reporting to the browser's console what it would block before it is enforced. Files from `/media` are served sandboxed and to this site's own pages only, and the owner's API answers are never cached.

**The app asks before a link replaces your work, and refuses what it cannot trust.**

- **Opening a scene by its link asks first.** A link to `/?sculpt=1&lib=<id>` or `&project=<id>` opened that scene in place of the work on the device without a word: the captured frames went at once and the autosave was written over a few seconds later, and such a link can come from any page. Now Sculpt asks, "Open "…"? The work in progress on this device will be replaced.", whenever there is work or a reel to lose, and **Cancel** carries on with the work as it was. The gallery's cards and the Projects page ask before they go, as before, and Sculpt does not ask again after them. A link whose id is malformed opens nothing.
- **A bad file is refused, not half opened.** A `.bozz` file of a few kilobytes could inflate to a gigabyte, name one array a thousand times or claim levels it did not have, and the tab ran out of memory; one with a material id or a brush curve Sculpt did not expect opened, then threw, and the autosave kept it, so Sculpt would not start from then on. Scene files are now read a piece at a time and refused, with the reason, as soon as they stop adding up or pass what a scene can be (1 GiB unpacked; timelapse frames 512 MiB). What can be mended is mended on the way in: a material that is not one is dropped, a curve that is not one is linear again, a colour is a colour. An autosave that cannot be read is set aside with "Your last sculpt could not be restored, so Sculpt started a new one" rather than stopping the boot.
- **`?nosw` asks first.** It takes the app's offline copy off the device and keeps it off, and any page could link to it. Now it asks, and **Cancel** changes nothing.
- **Sign out.** Signed in, the gallery and the Projects page have **Sign out** beside **Projects**, so a sign-in need not stay behind on a device you are done with. It forgets the sign-in on this device, removes the device's copies of your private lists, and signs out of Cloudflare Access, which ends the session everywhere it was used; the gallery is then a guest's, and scenes kept on the device stay. The desktop app signs out in Server settings, as before.
- **The device's copies of your private lists go with the sign-in.** The installed app kept your project list, private projects included, for thirty days so that it showed offline, and kept private thumbnails with it. Now the list goes as soon as the app finds the sign-in gone (signed out, expired or refused), and private thumbnails are not kept at all. The device remembers when you last signed in, and no longer your email address.

**The desktop app reads, writes and opens only what you choose.**

- **Files only where you say.** The page inside the desktop app named the file Save wrote to, and could ask the app to read any file by its path, so a page with something wrong in it could have written over, or read, any file you can. Now only the app itself knows where the open document is. Save writes that document, or asks where when there is none; Save As asks, starting at the document as before; and the page can read back only a file you opened or one in your recent files, while a request for anything else is refused without the path said back. Open, Open Recent, a double-clicked `.bozz`, Save, Save As and crash recovery work as they did.
- **Links leave the app as web pages and mail only.** A link that leaves the app goes to your browser when it is `https:`, or `http:` to this machine (`localhost`, `127.0.0.1`, `[::1]`, where a server of your own answers), and to your mail program when it is `mailto:`. Anything else, `file:` and `smb:` among them, which the system would open, run or mount, now goes nowhere, from the app's window and from the sign-in window alike. The sign-in window is sandboxed, as the app's own is, and is granted no permissions. The app tells its own pages by their host, so `bozzetto://app.example` no longer passes for `bozzetto://app`, and `bozzetto://` serves the app's own host only.
- **A locked-down build.** The packaged app no longer runs as Node when `ELECTRON_RUN_AS_NODE` is set, ignores `NODE_OPTIONS` and `--inspect`, loads its code from its own archive only, checks that archive on macOS and Windows before using it, keeps its cookies (the server sign-in among them) encrypted on disk, and gives `file:` pages no extra rights (Electron's fuses). Builds are unsigned, so the build signs the Mac app ad hoc again after setting them, as a Mac needs to open it.
- **Signing in or out tells the page.** Signing in or out in **Server → Server Settings** (or the **Server** menu) now makes the page ask again who it is for. Before, the publish forms and **Save to Library** went on acting on the sign-in found when the page loaded. Signing out also drops the owner's cached answers, as the web's **Sign out** does.
- **Electron 44.5.1** (was 44.2.0).
- **No auto-update files.** A build no longer writes the `latest*.yml` files an auto-updater reads; the app has none, and releases carry the installers only.

### v1.3.4

**Faster frames, anti-aliasing when still, v-sync off on the desktop, and update notices.** Desktop app 0.5.4.

- **Fast frames while you sculpt, pose or move the view.** Browsers draw in step with the display, so a frame that takes a little longer than one refresh waits for the next, and 60 frames a second drop to 30. While a stroke is under way, ambient occlusion now holds still: the frame keeps the AO it had before the pen went down and skips the work of drawing it again, so nothing changes outside the brush, and the AO under the stroke catches up as you let go. While the view, the gizmo or a pose is moving, the AO steps aside, and it fades back in over about a sixth of a second once things stop. The fill and rim shadows hold under a stroke and take turns redrawing while things move; the key light's shadow always redraws. This is Sculpt and Armature mode only: the viewer, published projects and embeds draw every frame in full. **Edit → Preferences → Performance → While sculpting, posing or moving the view** has **Fast frames** (the default) and **Full look**, which draws every frame as a still one.
- **Navigation follows your hand more closely, at any frame rate.** The view used to ease after a drag by a fixed share of each frame, so half of a drag showed after eight frames, about 130 ms at 60 frames a second and twice that at 30. Now it follows closely while the pointer, or your fingers, hold it (half of a move shows within two frames), and the easing is measured in time rather than frames, so it feels the same at 30, 60 or 144 frames a second. Letting go still coasts, about as far as before for the same flick.
- **Panels no longer blur the view behind them, and their opacity is yours to set.** Every panel, chip, menu and window used to blur what was behind it, and the browser redrew that blur on every frame the view moved, on the same graphics card the frame needs. The blur is gone everywhere. **Edit → Preferences → Appearance → Panel opacity** sets how much of the view shows through, from 60% to fully solid at 100%, and the panels follow the slider as you drag it; they start at 95% (they were 88% in the dark theme and 92% in the light, blurred).
- **Preferences has Performance and Diagnostics.** **Performance** holds the choice above, and anti-aliasing and adaptive quality (below). **Diagnostics** keeps the **Frame meter**, the **Stall log** and the **Input log** on across reloads, so the web version needs no `?perfdebug=1` or `?inputdebug=1` to show them (those still work). The stall log now shows over the viewer and Armature mode too; the input log is Sculpt's.
- **The frame meter says where the time goes.** `P` (or the Diagnostics box) shows the frame rate and the display's refresh rate as measured, how many refreshes passed without a new frame, the main thread's milliseconds per frame (split into the stroke, the loop and handing the frame to the GPU), the GPU's where the browser can time it (Chrome can; elsewhere an estimate, or "not available"), and the budget one refresh allows, with a verdict: **GPU short**, **CPU short**, **within budget**, or **capped**, when frames come at a steady 30 a second with time to spare, which is a limit set by the browser, the system or the display (Chrome's Energy Saver does this on battery) rather than anything the app can lift. It also shows the time from a pointer event to its frame, draw calls and triangles, whether frames are fast or full, and what the last stroke or drag compiled or allocated (nothing, by design). It remembers whether it was on. An adapter that tells the page nothing, as Firefox and Zen do, reads **not reported by this browser**.
- **Anti-aliasing once the view is still.** Smoothing edges with 4× multisampling cost something on every frame, under the pen too. Sculpt and Armature now draw without it while anything changes, and smooth a view left still for a second: sixteen frames, each nudged by a fraction of a pixel, are averaged over the next quarter of a second or so, then held, the same image on every frame, and a held frame draws nothing but that average. A stroke, a drag, the view moving, a key, a panel control or any change to the look goes back to the sharp frame at once. **Edit → Preferences → Performance → Anti-aliasing** has **When still** (the default), **Always** (4× multisampling on every frame, as before) and **Off**. Thumbnails and gallery cards are smoothed whatever the choice (Armature's card, taken as the page closes, is one frame, drawn down small enough that it hardly shows). The viewer, published projects and embeds keep 4× multisampling. The frame meter's **AA** row reads `9/16` while it smooths and `16/16 held` when it is done.
- **Adaptive quality, both ways.** A view whose frames kept missing the display used to lower its resolution, once, two seconds after it opened, and never raise it again. Now frames are judged a second at a time, everywhere: two bad seconds in a row lighten them a step, applied only between strokes and drags with the view still, and eight good seconds with room to spare bring a step back. The steps, in order: GTAO's samples halved, then its resolution halved (only where GTAO is drawn), softer shadows (half the blur samples, the fill and rim redrawn every other frame), the resolution down a quarter at a time to one pixel per point on a high-density screen, and last the shadow maps halved. A step that fails again straight away waits half a minute before it is tried again, a minute the time after. Frames held up by the CPU step nothing down, since lighter GPU work would not help them. No step compiles a shader, and anti-aliasing is never one of them. **Edit → Preferences → Performance → Adaptive quality** (on by default) turns it off, and the frame meter's **quality** row says what is turned down.
- **Desktop: each frame as soon as it is ready.** V-sync is off in the desktop app by default (owner call): a frame shows as soon as it is drawn instead of waiting for the display's next refresh, a refresh less between the pen and the screen. The app paces itself instead: a second after everything stops (no input, no playback, no stroke or drag, the view still and nothing left to smooth) it draws at the display's refresh rate, and on battery it never draws faster than that, working or not. **Edit → Preferences → Desktop** has **V-sync**, to hold every frame for the display as a browser does, and, on Windows and macOS, **Use the high-performance GPU**, on by default, which runs the app on a laptop's faster graphics chip where it has two. Both take effect when Bozzetto next starts (they live in `launch.json`, in the app's settings folder). The frame meter budgets by the display's refresh rate as the system reports it, and its **pacing** row says whether frames are paced, and why.
- **Opening a saved scene just opens it.** A scene opened from a gallery card or from Projects used to show the same notice as the autosave coming back, with **Start fresh** offering to throw away the scene just asked for. Now it opens without a notice. Only the autosave coming back on its own says so, with **Start fresh**; a project that opens from this device's copy because Projects could not be reached says that, and why, with nothing to press.
- **The app says when it updates.** Updates used to go in silently, and only on the gallery, so an iPad could stay on an old version with nothing to say so. Now a notice in the bottom-right corner says **Downloading update…**, with a bar for how much of it has arrived. On the gallery it then says **Updating…** and goes straight in; anywhere else it says **Update ready** with **Reload**, which saves the work first, as leaving for the gallery does (Sculpt's autosave, Armature's save), and asks before reloading if it cannot. After the reload it says, once, **Updated to** and the version. An update that cannot install says **Update failed** with **Try again**, and the browser's console names the file it stopped at and what the server answered. The notice blocks nothing, stays under the Capture window and clear of the toolbar, the transport and an open panel, and goes with the interface on `Tab`. The desktop app has none: it updates by release.
- **The version, in the hotkey guide.** The guide's foot names the version running, the release and the commit it was built from, as in `0.5.3 (2e735c6)`, so which build a device is on has an answer on the device. **Check for updates** beside it says **Up to date**, or finds the new version and starts its download. The desktop app names its version there and, on macOS, in the About panel, without the check.
- **An expired sign-in says so, and the save is kept.** Cloudflare Access sessions run out, and an app installed on an iPad keeps a sign-in of its own, apart from Safari's. Once it had run out, **Save to library** said "the server could not be reached" with the server up, and the app went on offering the owner's things: Access's redirect to its login page failed the way no network does, and the offline copy of the sign-in answered in its place. Now the app tells the two apart. The gallery shows **Log in** and says once that the sign-in has expired. **Save to library** keeps the scene on the device, its card marked **Not uploaded** with **Upload to Projects**, and the notice offers **Sign in again**, which stores the work, goes through the Access login and comes back to the same scene, its project included; the next save that goes through replaces the kept copy. With no connection the scene is kept the same way, and the notice says that instead. **Upload to Projects** on a card, publishing and the Capture window say the sign-in has expired and offer **Sign in again** too; recording carries on meanwhile. Offline, the last sign-in still stands.
- **The environment's intensity on a scale you can use, and the backdrop apart from it.** At 1 the default environment filled the key light's shadow side in almost as brightly as the key itself, and the values in use sat at the very bottom of the slider. Intensity 1 now means what 0.2 did: the slider's 0 to 2, in hundredths, covers the old 0 to 0.4 (it ran 0 to 3), and an environment starts at 1, the old 0.2 (it started at the old 1). The HDRI shown as the background has its own **Bg brightness** beside Bg blur, 0 to 2 and 1 to begin with (the plate as the old intensity 1 showed it), so it no longer goes dark or bright with the lighting. Everything saved before, looks, the autosave, `.bozz` files, armatures, published projects and single-file exports, opens exactly as it rendered: a record without the new scale's mark is read on the old one. A look saved from now on, in a file or a published project, opened in an older build (the desktop app until its next release) gets an environment five times too strong there.
- **`L` in Armature mode.** Hold `L` and drag to move the key light, as in Sculpt: across swings it round the figure, up and down raises and lowers it. While `L` is held the drag does nothing else: no orbit, no part picked, no gizmo or ball dragged. Rebind it under **Edit → Preferences**.
- **Capture is a window.** The docked Capture panel is gone: a **Capture** button in the top row, beside File and Edit, opens **Record timelapse**, the frame count, **Clear frames** and both publish forms in a floating window. It blocks nothing, so you keep sculpting with it open. Drag it by its title bar; close it with its button, the Capture button, or `Esc` while it has the focus. It stays where you left it for the session, comes back on screen if the window shrinks, follows the theme and hides with the interface on `Tab`.
- **Recording only where it can go somewhere.** A timelapse leaves the device only by publishing, which needs the sign-in, so recording is allowed signed in, on the web and the iPad, and in the desktop app. A guest on the web has no Capture button and records nothing, whatever the device remembered. Frames recorded before stay where they are, and New clears them as it always has. Signing in later, through the publish forms or elsewhere before coming back to the page, brings the button. An autosave that stops itself now also says so on screen, for everyone: a guest has no Capture window to read the note in.
- **The Model panel docks on the left, under Scene.** The left edge holds Scene then Model, the right Render then Tool. Each edge still opens one panel at a time; the tabs keep clear of each other, and of an open panel on their own edge, on every iPad screen in either orientation; and the albedo picker opens beside the panel rather than over its sliders.
- **Mask and Extract move to the Model panel.** The Tool panel's Mask section (darkening, Blur, Sharpen, Invert, Clear, and Extract with its thickness) is a section of the Model panel now, acting on the active object as before. The mask keys and the Mask brush are unchanged; `Ctrl`+`E` extracts at the Model panel's thickness.
- **Delete highest.** The Model panel's Topology section drops the top level of the active object's subdivision stack, from a button beside **Rebuild** (it was **Delete highest level**, on a row of its own). If that level was selected, the selection moves to the new top. It is one undo step, and undo brings the level back with its detail; with one level left the button is disabled.
- **Ambient occlusion outside sculpt mode again.** The Render panel applied its own starting AO model each time it was built, and that model was Cavity, which only sculpt mode draws, so the viewer, published projects, the editor's and the uploader's previews and their single-file exports, and Armature mode rendered with no AO at all, whatever had been saved. Outside sculpt mode the panel offers GTAO and Off, starts on GTAO at its defaults, and keeps what the project or the look saved; sculpt mode keeps Cavity, GTAO and Off. A sculpt published on Cavity now goes out on GTAO, and an armature saved on it comes back on GTAO. A project whose look was saved in the editor while this was broken carries AO off and opens with it off: save its look again on GTAO.

- **Type a value into any slider.** A double-click, or a double-tap on an iPad, turns a slider into a number field in its place, with the number keyboard; Enter or a press anywhere else applies what you typed and `Esc` cancels. A typed value may go past the slider's travel, as in Maya: the handle stays at the end and the row shows the value, and it saves with the look, the brush or the figure like any other. Only what the setting can be holds it back (no intensity below zero, no roughness past 1, angles wrap). This covers the Render, Tool, Model and Armature panels and both tracks of the brush rail, where a brush can now be wider than 500 px. Double-clicking the depth-of-field Focus slider keeps a tap-to-focus lock until you type a focus.
- **Slider ranges fit the values in use.** Light intensity runs 0 to 5 (was 0 to 8), and the HDRI's intensity is on a scale of its own (see above). The cavity's radius runs 2 to 12 px (was 2 to 24: past about 12 px it stamps ghosts of an edge onto the surface behind it). Looks saved with values past the new ranges load as they were, the handle at the end and the value shown.
- **Ambient occlusion without the black outlines.** GTAO counted anything within a depth band as an occluder, in full, so a dark band traced every silhouette in front of another surface and the shading stopped dead at the edge of the radius; its noise pattern was never smoothed out, and past strength 1 the blend went below zero and printed black. An occluder now fades with its distance, the term is denoised along each surface, and strength deepens the term (it is now an exponent) instead of clipping it, so the whole 0 to 2 travel is usable. Defaults are radius 0.3 and strength 1 (were 0.5 and 1). The GTAO pass now costs nothing while another model is chosen, and a scene saved on GTAO opens on GTAO; it used to come back as Cavity.

- **The gallery and the browser tab** read "Pose, sculpt, render and timelapse", and **Upload timelapse** moved from the top row into the Create tile's menu.
- **Scenes saved to the library go to Projects.** Signed in, **File → Save to library** uploads the scene to the server as a private project, in parts with its progress shown, and keeps a copy on the device; saving again updates the same project in place, and the autosave remembers which project that is across reloads (a `.bozz` file never carries it). Your gallery and the Projects page list these scenes with a thumbnail, object and triangle counts and size, to open in Sculpt, rename, delete or make public. `/?sculpt=1&project=<id>` opens one; offline, the copy on the device opens instead.
- **Signed out, Save to library downloads a file.** Browser storage goes with a reinstall (owner report: a sculpt saved on an iPad was gone with the app), so a guest's **Save to library** saves a `.bozz` file, the share sheet on an iPad, and the menu says so. **Keep on this device** still puts a scene on the device's shelf, so nothing a guest could do before is gone.
- **Work kept only on the device says so.** The "In progress" cards and every scene kept on the device carry a note: on this device only, a reinstall or clearing the browser loses it. Signed in, such a card offers **Upload to Projects**, which makes it a project and marks the card as uploaded.
- **A scene opened from a gallery card opens as File → Open would.** It comes back under the look it was saved with, and starts a timelapse of its own rather than continuing the reel recorded on the scene it replaces, since a publish must never mix two scenes. This holds for the device's own cards too.
- **Projects are public or private.** A private project is left out of the public gallery, list and manifests, and `/media` will not serve its files to anyone: its owner reads them through `/admin/api/media`, behind Cloudflare Access. Your gallery shows a **Private** badge and a switch on each card; the editor's **Settings** and each row of the project list have the choice too, and the publish forms in Sculpt ask, public unless you choose otherwise. Everything published before stays public. Apply migration `0002_visibility.sql` (`npm run db:migrate`) before this deploys: the API reads its new column.
- **A reach past a joint's limits settles.** A hand or foot asked to go further than its joints can turn, a pinned foot the pelvis has been dragged away from, say, now comes to rest at the nearest pose the limits allow and stays there from one move to the next. The reach used to swing each joint as if it had no limits and then clamp the swing axis by axis, which could land on a pose nothing like the nearest: a foot pinned past the hip's reach ended 40 units off its pin on the realistic male where the leg can get within 8, and on the stylized female the next move flipped the thigh 22° and threw the foot further off. Reaches the limits allow go as they did.

### v1.3.3

**Carve by tap, arrows through the outliner, size per brush, and a stall log.** Desktop app 0.5.3.

- **Timelapse capture starts off, for everyone.** It used to start on for the signed-in owner; now nobody records until they tick **Record timelapse** in the Capture panel, and the choice, on or off, is remembered on the device as before. A frame per stroke is a merge of the scene and an IndexedDB write after every stroke, and those writes are one suspect in the freezes seen on an iPad.
- **The autosave writes at most once a minute.** It wrote a second and a half after every burst of strokes, and each write serialises the whole scene and hands it to IndexedDB, which Safari can hold the page up on. Now the first change after a quiet spell is saved five seconds later and anything after that once a minute at most, however steadily you sculpt (every five minutes for very large meshes, as before). Leaving sculpt mode or the page, or the app going to the background, still saves at once; a crash can cost up to a minute of work.
- **Diagnostics for freezes.** The render loop notes every gap between frames longer than 300 ms, and the heavy jobs note how long they took and how many triangles the active object had: the autosave's serialise and its write, the capture's hand-off to its worker and its write, the wireframe's edge rebuild, the full upload after a topology change, subdivision level changes, voxel remesh and merge, and thumbnails. The last 64 stay in the page, so `__bozzettoPerf.recent()` in the console lists them after the fact, newest first, and `?perfdebug=1` shows them over sculpt mode, so a freeze reads as "autosave write 2.41 s" on the device itself. `?inputdebug=1` gains a status line: whether the input believes a stroke is under way and with which device, how many touches it counts as down, and how long since the pen was last heard from. Both overlays can be on at once.
- **The Tool panel's World-scale box follows an opened scene.** Opening a scene saved with world scale set the other way switched the scale but left the box showing the old setting, whichever tool was up.
- **Negative carves the next stroke on a tap.** A tap on the toolbar's **Negative** button arms carving for one stroke, with the Pencil or the mouse, and the arm clears when that stroke ends; you can orbit first, a stroke that cannot carve (a smooth, a mask) leaves it armed, and a second tap disarms it. Armed, the button is outlined in rust. A long press, just over half a second, latches carving on for every stroke, as a tap did before, and fills the button; a tap lets it go. `Alt` does the opposite of whatever the button says, so an `Alt` stroke while it is armed raises, and spends the arm. There is no hold-to-carve on an iPad, and a web page cannot offer one: a fingertip on the glass hides the Pencil from the page until the finger lifts, so a finger held on the button would stop the very stroke it was meant to carve.
- **The arrow keys walk the Scene list.** `↑` and `↓` move the active object to the row above or below, wrapping from the last row to the first and back, exactly as a click on that row would: the gizmo moves to it (or lets go, for a hidden or locked object, which are rows like any other) and the Select tool's highlights follow. The list scrolls to keep the row in view. With `Shift` the step extends the selection the way a `Shift`+click does, so a `Shift` step that wraps round takes the whole list. A name being edited keeps the keys, an open File or Edit menu still walks its own items, and all four can be rebound under **Edit → Preferences**.
- **Every brush keeps its own size.** Pick a brush, by its key or on the toolbar, and it comes back at the size you left it; the Tool panel's **Size** slider and the rail show that size, and moving either sizes that brush alone. Every brush starts at the size they all shared before, so nothing changes until you size one. The sizes save with the scene, in the autosave and in `.bozz` files, in world or screen scale, and switching the scale keeps each brush the size it looks; a scene saved before this opens with every brush at the one size it carried. Paint keeps its own size like any brush, and its `Shift` blur uses it. Smooth under `Shift` and Mask under `Ctrl` keep no size of their own and stroke as before: at the size of the brush in hand in world scale, at their own fixed size in screen scale. Select and the gizmo have no size; while either is up, the rail sizes the brush you go back to. Strength and every other setting work as they did.

### v1.3.2

**Fingers navigate, and the iPad keeps out of the way.** Desktop app 0.5.2.

- **Fingers navigate; the Pencil and the mouse sculpt.** In every tool, brushes, Select and the gizmo alike, one finger orbits and two pan and zoom, and a finger never starts a stroke, a marquee, a gizmo drag or a colour sample. The Select tool no longer loses its navigation to the marquee. A finger tap does what a click does where a tap means something: in the Select tool it selects what is under it, or clears the selection on nothing, and under the gizmo it selects the object tapped, without nudging the view first. Where the system delivers a pen and a finger together (Surface, Android), a pen landing while a finger turns the view takes over and the view stops where it is, and a finger that lands during a stroke does nothing until it lifts; on an iPad a fingertip on the glass still hides the Pencil until it lifts, below anything a web page can reach (a palm does not). **Edit → Preferences** has the choice, **Fingers: navigate only** (the default) or **Fingers sculpt too**, the old behaviour, for sculpting without a pen; it is kept in the browser with the hotkeys.
- **Nothing from the OS on a long press.** A finger or Pencil held still on the canvas (an armature ball included), the toolbar, the brush sliders, undo and redo, or a panel's edge tab no longer arms Safari's long press, which cancels the touch at about half a second: a held undo could stop repeating, a paused slider or ball drag could let go, and a slow tap on a button could come to nothing. The toolbar buttons and the panel tabs act on the lift of a tap now, which is what lets them refuse it. There is no context menu outside text fields and links, no long-press callout or loupe, no page pinch or double-tap zoom, no rubber-banding, no text selection on labels, and no image drags out of the app. A press anywhere outside a text field (an object being renamed, say) lets go of it, so the keyboard and its dictation key go away. What iPadOS keeps for itself, the system edge swipes, the Pencil's corner swipes and dictation inside a field you are typing in, a web page cannot turn off.
- **Zoom all the way in.** The camera comes within 2% of the subject's radius of where it is looking, by pinch, wheel or `Ctrl`+drag, where it stopped at 40% after a frame, and the near plane follows it in so nothing close is clipped. Every route stops at the same floor and the same ceiling, ten radii or twice the framing distance for a long lens, and a step is the same proportion of the distance however close you are, so zooming back out always works. A camera restored from a saved scene used to take its limits from wherever it was saved and could come back unable to zoom out; `F` and `A` now also stop an orbit still easing out instead of drifting off the framing.
- **Move starts on the model.** A press just outside the outline used to grab the silhouette; now a Move stroke starts on the surface like every other brush, and a press off the model does what it does with any brush (the mouse and the pen orbit, a finger navigates). The grab keeps its soft ball falloff and the Falloff slider.

### v1.3.1

**A drag handle in the hips and solo mode.** Desktop app 0.5.1.

- **The mannequins' necks turn higher up.** The neck joint sat where the neck lump meets the chest, down inside the chest; it now sits on the lump's centre line a third of the way up, on all four mannequins, so the neck's gizmo and its turn are in the neck. It stops short of the lump's middle, which lifted a shelf out of the back of the chest when the neck bent; bent 30° forward, a neck still lifts a lip there, smaller than that shelf. The head still turns at the base of the skull.
- **A ball in the hips moves the figure.** A violet ball the size of the reach balls sits halfway along the pelvis, on the mannequins and the blocks alike. Drag it and the whole figure follows the pointer in the plane facing the camera, as the pelvis gizmo's centre moves it, the pinned balls holding their places all the way; the drag is one undo step, and no gizmo comes up. It hides with the IK handles and takes a press within 18 pixels, like the other balls.
- **Solo in Sculpt.** `Alt`+`Q`, or on a touch screen the **Solo** button under the Scene panel's object list, shows the active object alone: every other object is hidden from the brush and from picking as well as from view. Make another object active, from the Scene panel, with the Select tool or by an undo, and the solo moves to it. Press either again and the others come back as they were, anything hidden with the outliner's eye staying hidden. While it is on, the button stays pressed and the Scene panel says **Solo** on its tab and beside its title, where a click ends it, as does a click on any eye. It is a view, not an edit: nothing goes on the undo stack or into a saved scene, and saves, timelapse frames and published models still carry every object the eye shows.
- **Undoing an add while another object is active** no longer leaves the undone object drawn in the viewport.

### v1.3

**Armature mode for everyone, planted feet and the models offline.** Desktop app 0.5.0.

- **Armature mode for everyone.** Every visitor's gallery now leads with the **Create** tile, which starts a new sculpt or a new armature, and shows an armature in progress as a card; `/?armature=1` opens for anyone, and the desktop app, which hid the mode for want of a sign-in, has it too. Publishing and the Projects chip stay the owner's. An update to the app no longer reloads the mode under you: as in Sculpt, it waits for the gallery.
- **The base meshes, the mannequins and the default environment are precached**, so they work offline from the first visit rather than once used; before, a new armature offline came up as blocks when its mannequin had never been fetched. The install grows from about 4.6 MB to about 20 MB, and the other five environments still download on first use. The precache revisions each file by its content, so a re-exported model reaches every installed copy with its next update, and the caches the models were kept in before are cleared. The matcaps load offline too: they were precached all along but asked for under a versioned address the precache did not match, so offline they only appeared while the browser's own cache still held them.
- **A new armature starts on the realistic male mannequin** rather than the blocks, which stay in the Figure list and stand in whenever a mannequin cannot be fetched or a saved model cannot be read.
- **Mirrored parts face outward.** The bundle's right-hand lumps are its left ones mirrored with a negative scale, which the export baked in with their faces turned inward: the mannequins' right limbs, eyes and ears, and the right-hand lumps of a blockout added as parts, rendered inside out. The exporters now reverse mirrored parts' winding and check every part's signed volume. The one-object blockouts, the other base meshes and Send to Sculpt come out as before.
- **The mannequins' hips sit lower**, in the middle of each half of the pelvis; placed at the top of the thigh lump, which reaches up past the joint, they sat 2.5 to 4.5 cm too high.
- **The deltoid moves with the arm.** The shoulder lump rides on the upper arm rather than the clavicle, with the joint in its middle, so a raised arm turns the shoulder cap about its own centre, as on a wooden mannequin, instead of swinging out from under it.
- **Knees fold forward and elbows back on every mannequin.** With no limits in the files, the app took each hinge's fold from the bend it rests with, and the stylized male's knees rest a fraction of a degree past straight, so they bent backwards. The mannequins now carry their own knee and elbow limits, sized from each figure's rest bend.
- **The hips open outward.** Their side limits were the wrong way round: a leg stopped 20° out to the side and crossed 60°, by its foot's ball or the Side slider alike. It now opens 60° and crosses 20°, on the mannequins and the blocks, and the shoulders, which had the same fault, lift 30° and drop 20° rather than the reverse.
- **The head reaches through the spine.** Dragging the head's ball bends the neck, the chest and now the spine too, so a head drawn forward or aside takes the back with it.
- **Symmetry starts off** in Armature mode. A figure is posed a limb at a time far more often than both at once; `X` and the panel's box still turn it on.
- **Both feet start pinned** where the figure stands, so the pelvis can crouch or lean from the first drag with the feet on the ground; a file from before pins were saved opens the same way. **Reset pose** moves every pin to where the reset leaves its hand or foot, rather than pulling the figure back into the old pose on the next move.
- **Pinned feet no longer snap round when the pelvis moves.** A knee's aim was read around the line from the hip to the foot's ball, which sits well ahead of the ankle; against that line a nearly straight leg's knee reads as pointing backwards, so the first solve after the pelvis moved turned each leg half round, on every figure. It is read around the hip-to-ankle line now. Three smaller snaps went with it: the aim's forward turns with the figure instead of staying world forward, each knee and elbow starts from where it points at rest instead of being swung round on its first solve (by up to 37° on the mannequins), and one turned by hand keeps its direction. A pin beyond the leg's reach leaves the foot as near as the leg gets.
- **The feet reach from their middle.** A foot's ball and pin sit halfway along the foot rather than at the toe, so a pinned foot pivots about its middle instead of swinging round its toe; the hands and the head are still held by their tips. Files saved earlier have their foot pins moved to mid-foot as they open.
- **Plant feet.** A foot on the ground stands flat, facing the way the figure faces, after a reach, a pinned foot's re-solve or a pose reset; in a deep crouch it stays as flat as the ankle bends, then the heel lifts. A foot off the ground follows its shin as before. On by default, with a box in the Reach section, and saved with the figure.
- **The balls win the click.** A press within 18 pixels of a reach or aim ball takes it, even with a part in front; the knee and elbow balls used to lose most presses to the limb around them. They are also in place from the start, where they waited at the figure's feet until the first click.
- **The armature's gallery card has a picture**: the figure, photographed without its balls and gizmo as you leave through the Gallery link and, where there is time, as the page closes. It is kept with the autosave; the `.armature` file leaves it out.

### v1.2

**Base meshes, mannequins and a quad wireframe.** Desktop app 0.4.0.

- A **base-mesh library** in the Scene panel's Create menu: Blender Studio's CC0 Human Base Meshes as thumbnail tiles. Male and female figures in realistic and stylized topology, each with its eyes as separate objects; voxel-remeshed blockout figures, which can also arrive as their fifty separate lumps; heads (realistic, stylized, planar, a low-poly cage, a blockout); hands, feet, eyes, jaws and skulls. Fetched on first use and kept for offline.
- Three more primitives: cone, capsule and an upright plane.
- **Mannequins in Armature mode**: the same bundle's primitive figures rigged onto the app's bones, male and female, realistic and stylized, beside the block placeholders. They pose, reach, pin, aim and send to Sculpt like the blocks. Built by `tools/build-mannequins.py`, which also runs inside Blender for editing.
- The **wireframe overlay draws quads as quads** in sculpt mode, from the mesh's own edges rather than its triangles.
- Clay takes two photographed stencils, Thumbed and Cracked; the hand-drawn one retires.
- Offline: the UI fonts precache and the sign-in answer is kept, so an installed app keeps its owner features without a network.
- Browser smoke tests live in the repository: `npm run e2e:build`.

### v1.1

**Sculpt mode (alpha).** Bozzetto can now sculpt, not just play back. Built on [SculptGL](https://github.com/stephomi/sculptgl)'s editing core, ported onto Bozzetto's WebGPU/WebGL2 pipeline with one canvas, one camera and one look.

- Ten brushes with per-tool settings, pen pressure with response curves, and 64-deep undo.
- Rake brush with stroke-aligned stencils. Clay takes stencils too, off by default. Per-brush dab spacing.
- Crease Profile and Pinch sliders, from a broad trough to a knife line.
- Polish brush replacing Twist, flattening surfaces while keeping edges crisp.
- Masking, Extract, per-brush mirror symmetry with a mirrored hover ring.
- Multiresolution, dynamic topology and voxel remesh.
- Vertex painting, per-object named materials, and an HSV colour picker shared across the app.
- Unified transform gizmo with `W`/`E`/`R` modes and a multi-object outliner, a Select tool with marquee, mirror and radial copies.
- Every hotkey editable under Edit → Preferences, on the web and in the desktop app.
- A **File** menu in the top row (new, open, save, save to library, OBJ import and export), and five docked panels: Capture and Scene left; Render, Model and Tool right.
- Ten new matcaps in a gallery popout, and selectable tone mapping.
- Timelapse capture from sculpt sessions, publishable to the gallery.
- `.bozz` scene files, OBJ import and export.
- iPad support: two-finger navigation, palm rejection, touch toolbar, home-screen install.
- Autosave to IndexedDB with an "In progress" gallery card.

### v1.01

- Compressed frames: gzipped GLBs with int16-quantized positions, roughly 3–4× smaller.
- Playback buffering with a loaded-frames bar and a buffering indicator.
- Set the depth-of-field focus by double-clicking the model.
- Context-aware loading messages, wireframe opacity fixes, and staging in unlit modes.

### v1.0

First public release.

- WebGPU renderer on three.js's node pipeline, with WebGL 2 fallback.
- Sculpt timelapses streamed as real per-frame geometry.
- Three-point lighting rig, soft VSM shadows, HDRI environment lighting.
- Ground-truth ambient occlusion and depth of field.
- Studio floor and PBR pedestal staging.
- In-browser editor exporting a self-contained `.html`, plus MP4/GIF reel export.
- Gallery of portrait thumbnails.

## Source

The code is on [GitHub](https://github.com/vidarrapp/bozzetto) under the MIT
licence, and the app can be built and run from it; [`docs/`](docs/) has the
notes for that.

## Credits

- Sculpt mode is built on [SculptGL](https://github.com/stephomi/sculptgl)'s editing core, MIT, by Stephane GINIER. The vendored source and its license live in `src/sculpt/vendor/`.
- Toolbar icons: [Uicons by Flaticon](https://www.flaticon.com/uicons).
- The base-mesh library is Blender Studio's [Human Base Meshes bundle](https://www.blender.org/download/demo-files/#asset-bundles) v1.4.1, CC0, by Dan Ulrich, Julien Kaspar, Paul Kotelevets and Tonatiuh de San Julián. Exported by `tools/export-basemeshes.py`; see `public/assets/basemeshes/LICENSE.txt`.
- The mannequins are the same bundle's primitive figures, by Paul Kotelevets and Julien Kaspar, rigged onto Bozzetto's bones by `tools/build-mannequins.py`; see `public/assets/armature/LICENSE.txt`.

## License

MIT — see [LICENSE](LICENSE).
