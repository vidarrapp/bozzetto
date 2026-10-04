# Bozzetto

<img width="1915" height="956" alt="bozzetto_v1_screenshot_vidarrapp" src="https://github.com/user-attachments/assets/6a8b27f6-5806-422b-ac81-89909a84751d" />

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
| `/create/` | Timelapse uploader (**Create → Upload timelapse**), no sign-in |
| `/admin/` | Projects and the full editor, publishes to the gallery |

Runs entirely on Cloudflare Pages, Functions, D1 and R2. No server to run yourself.

## Install as an app

Bozzetto installs to the home screen and launches fullscreen. That is the way to use sculpt mode on an iPad. The gallery's **Install** button walks you through it.

**iPad / iPhone (Safari):** Share button → **Add to Home Screen** → **Add**.

**Android (Chrome):** **⋮** menu → **Add to Home screen** → confirm.

**Installed, Bozzetto works offline.** A service worker precaches the app with its base meshes, mannequins and default environment, so it opens, sculpts and poses with no network at all. The gallery still shows your work in progress and the projects you saw last time; the other environments download once and are kept. Only opening a timelapse you have never played needs a connection.

Sculpts autosave to browser storage whether installed or not. Nothing uploads unless you sign in and publish or save to the library. On iPad, installing also protects that storage: home-screen apps are exempt from the eviction that clears ordinary browsing data. Deleting the app still takes it, which is why a guest's **Save to library** downloads a file.

## Sculpt

Pick **Create → New sculpt** in the [gallery](https://bozzetto.vidarrapp.se). No sign-in needed, and nothing leaves your device unless you sign in and save to the library or publish.

- **Ten brushes** on `1`–`0`: Crease, Move, Standard clay, Inflate, Pinch, Flatten, Rake, Drag, Polish, Paint. `Alt` carves, `Shift` smooths from any brush. Without a keyboard, tap the toolbar's **Negative** button to carve the next stroke, or long-press it to carve every stroke until you tap it again.
- **Brush character** is tunable per tool, and every brush keeps its own size, so each comes back at the size you left it. Clay lays ribbon-like strips. Move starts on the model, like every brush, and drags a soft ball of it, with a Falloff slider from soft to sharp. Polish flattens surfaces while keeping edges crisp, with a Plane lock slider from follow to flatten. Crease has Profile and Pinch sliders, from a broad trough to a knife line.
- **Stencils.** The Rake combs grooves through a stroke-aligned stencil. Clay can take one too, off by default. A Spacing slider sets how far the brush travels between stamps.
- **Apple Pencil pressure** drives brush strength through the stroke, with per-brush response curves.
- **Masking** with `Ctrl`, plus blur, sharpen, invert, clear, and **Extract** to turn a masked region into a new object, all in the Model panel's **Mask** section, which acts on the active object.
- **Mirror symmetry** per brush, on across X by default, each brush with its own axis. Hovering shows the mirrored brush ring.
- **Topology**: a multiresolution stack, dynamic topology with stroke detail sliders, and voxel remesh. **Delete highest level** in the Model panel drops the top level of the stack with its detail, in one undo step.
- **Painting**: vertex-paint albedo with an HSV picker, alt-click to sample, or drag the swatch onto the viewport to pick a colour off the screen. Flood fill, and `Shift` blurs the paint under the brush. Named materials per object, each with albedo, roughness and metalness.
- **Create menu** in the Scene panel: seven primitives (sphere, cube, cylinder, torus, cone, capsule, plane) and a **base-mesh library**, Blender Studio's CC0 [Human Base Meshes](https://www.blender.org/download/demo-files/#asset-bundles): male and female figures in realistic and stylized topology, voxel-remeshed blockout figures, heads (realistic, stylized, planar, low-poly cage, blockout), hands, feet, eyes, jaws and skulls. A figure arrives with its eyes as separate objects, one undo step, at the same size as a primitive; a blockout arrives as one remeshed shell or, with the menu's switch, as its fifty separate lumps. The files are precached with the app, so the whole library works offline.
- **Object transforms**: a unified move/rotate/scale gizmo whose centre moves across the screen, single modes on `W`/`E`/`R`, with a settings panel for which handles show. Multi-object scenes with an outliner, whose rows `↑` and `↓` step through (`Shift` extends the selection), a Select tool (`Q`) with marquee and Maya-style modifiers, and duplicate, delete, mirror, radial copies, merge (a voxel union) and the gizmo all working on the whole selection. Locked objects draw as if masked. **Solo** (`Alt`+`Q`, or the Scene panel's **Solo** button) shows the active object alone until you press it again.
- **Full render controls** while sculpting: lighting, matcaps, tone mapping, ambient occlusion, depth of field, environment and camera. The look saves with your scene.
- **Panels**: Scene, the object list, and Model, the active object's material, topology and mask, dock down the left edge; Render and Tool, the active brush's settings, down the right. One panel per edge is open at a time, and an edge's tabs stay clear of each other on every iPad screen.
- **Timelapse capture**: mesh snapshots after each stroke, stored locally, publishable to the gallery. The **Capture** button in the top row, beside File and Edit, opens a floating window with **Record timelapse**, the frame count, **Clear frames** and the two publish forms. It blocks nothing, so you keep sculpting with it open; drag it by its title bar, and it stays where you put it for the session. Close it with its button, the Capture button or `Esc`. Recording is off until you tick the box, and the device remembers the choice. It only records where the timelapse can go somewhere: signed in on the web or the iPad, including once that sign-in has expired (the reel waits for **Sign in again**), or in the desktop app. A guest on the web has no Capture button and records nothing.
- **Files**: `.bozz` save and open for the whole scene, plus OBJ import and export.
- **Scene library**: signed in, **Save to library** stores the scene in Projects on the server, private until you make it public, with its progress shown while it uploads; saving again updates the same project in place, and a copy stays on the device so the scene still opens offline. Signed out it downloads a `.bozz` file (the share sheet, on an iPad), because browser storage does not survive a reinstall, and **Keep on this device** still puts a scene on the device's own shelf. Saved scenes appear as gallery cards with a thumbnail, object and triangle counts and their size; open one with a tap, rename it in place, delete it when you are done. A card for a scene kept only on the device says so, and signed in it offers **Upload to Projects**. A save whose upload cannot go, because the sign-in has expired or there is no connection, keeps the scene on the device as **Not uploaded**, with **Upload to Projects** on its card, and the notice says which it was; an expired sign-in comes with **Sign in again**, which goes through the login and back to the same scene. Separate from the autosave, which still resumes your work in progress.
- **Made for iPad**: fingers navigate in every tool, one to orbit and two to pan and zoom, and only the Pencil and the mouse sculpt, select or move objects (**Edit → Preferences** lets fingers sculpt too, for working without a pen). A finger tap still selects in the Select tool and under the gizmo. A resting palm never blocks the Pencil, a long press brings up none of Safari's callouts, loupes or menus, and the touch toolbar covers keyboard-less use. Carving is a tap on **Negative** rather than a finger held on it while you draw, because a fingertip on the glass hides the Pencil from the page until it lifts.
- **Reload-safe**: your work autosaves to IndexedDB, a few seconds after the first change and then at most once a minute while you keep working, and straight away when you leave sculpt mode or the page or the app goes to the background. The autosave also remembers which project in Projects the scene came from, so after a reload **Save to library** still updates it; a `.bozz` file never carries that link. Unfinished work shows in the gallery as an "In progress" card, beside any scenes you saved to the library, labelled as what it is: on this device only, lost with a reinstall or a cleared browser.

## Armature mode

A posable figure of its own, for reference or as the start of a sculpt.
Pick **Create → New armature** in the gallery (or open `/?armature=1`). No
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

- **Pose.** Click a part and its joint's rotate gizmo appears, clamped to
  that joint's limits: hinges (elbows, knees) show one ring plus a little
  twist, ball joints three. Symmetry (`X`, off to begin with) mirrors every
  edit to the other side through the pelvis's own frame. The pelvis is the
  root: its gizmo moves and turns the whole figure (`W` selects it).
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
  every pin to where the reset leaves its hand or foot. With **Plant feet**
  on (the Reach section's box, on by default), a foot on the ground stands
  flat, facing the way the figure faces, after every reach, pin and reset:
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
  the resolution on the slider and opens Sculpt mode with it; a sculpt with work in
  it gets the figure as an extra object instead.

| Input | Action |
| --- | --- |
| Click a part | Select it (rotate gizmo at its joint) |
| Drag a ball | Reach that hand, foot or head towards it |
| Drag off the figure | Orbit |
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

1. In the gallery, pick **Create → Upload timelapse**, or open [`/create`](https://bozzetto.vidarrapp.se/create/) directly.
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

It is local by default and makes no network requests at all. Point it at your
own Cloudflare deployment under **Server → Server Settings** if you want to
publish from it; signing in opens Cloudflare Access in a real window. Signed
in there, **File → Save to Library** saves to Projects on that server, as it
does on the web; without a server it keeps the scene on this machine.

```bash
npm run desktop        # build and run
npm run dist:desktop   # package for the host platform, into release/
```

Each installer format has to be built on (or for) its own platform:

| Target | Where it builds | Notes |
| --- | --- | --- |
| Linux AppImage | anywhere | `npx electron-builder --linux AppImage` |
| Windows portable | anywhere | `npx electron-builder --win --dir` gives `release/win-unpacked` with `Bozzetto.exe` — zip and ship |
| Windows installer | Windows, or Linux with wine | `npx electron-builder --win nsis`; without wine it fails with `spawn wine ENOENT` |
| macOS dmg | macOS only | Apple's tooling cannot be cross-run |

### Releasing

`.github/workflows/release.yml` builds all three platforms and attaches the
installers to a GitHub Release. The version comes from `package.json`, and the
tag must match it. Either push the tag:

```bash
npm version 0.1.0        # bumps package.json and commits and tags v0.1.0
git push --follow-tags   # the tag push starts the release build
```

or run **Release desktop** from the **Actions** tab with the version filled
in, and the workflow tags `main` itself.

The workflow opens a draft release, builds on all three platforms, and
publishes the release once every installer is on it (a failed platform leaves
it a draft to look at). The macOS build is universal, one app for Apple
Silicon and Intel. The site's Install card reads the latest published
release, so it picks the new version up on its own; edit the generated notes
on GitHub whenever you like.

Run it from the **Actions** tab with the version left empty to test a build
without releasing; that path publishes nothing and leaves the installers as
downloadable artifacts. No secrets to configure — it uses the token Actions
provides.

Builds are unsigned. macOS Gatekeeper and Windows SmartScreen will warn until
you add a Developer ID certificate and notarization (macOS) or a code-signing
certificate (Windows). For signing in CI, set `CSC_LINK` and
`CSC_KEY_PASSWORD` as repository secrets and drop the
`CSC_IDENTITY_AUTO_DISCOVERY: false` line from the workflow.

## Features

### Viewer

- Per-frame geometry streaming. Frames are gzipped, position-quantized GLBs, roughly 3–4× smaller than raw meshes. Frames near the playhead are prefetched, the rest fill in behind.
- Timelapses that fit the device memory budget buffer whole, so scrubbing and looping never reload. Larger ones keep a budget's worth around the playhead.
- WebGPU through three.js's node renderer, with automatic WebGL 2 fallback. Same materials, shadows, AO and depth of field on either backend.
- Real-time relighting: a multi-light rig with two presets, per-light toggles and colours, rig rotation, and soft VSM shadows.
- Material modes: lit PBR and matcaps, with a wireframe overlay, in smooth or flat shading.
- Ten matcaps in a thumbnail gallery. Tone mapping is selectable: None, Neutral, AgX or Cinematic.
- HDRI environment lighting with three background modes and separate rotation for the rig and the HDRI. The HDRI's intensity runs 0 to 2, where 1 is a fill that leaves the key light's modelling alone, and the plate shown as the background has its own brightness.
- Ground-truth ambient occlusion and node-based depth of field, both adjustable.
- Adaptive quality that backs off render cost when the frame rate drops.
- DCC-style orbit, pan and dolly, with a saved camera per project.

### Gallery

- Published projects as thumbnail cards, badged *timelapse* or *model*, led by a **Create** tile, which starts a new sculpt or a new armature or opens the timelapse uploader, and your own sculpt and armature in progress.
- Signed in, the gallery is your whole list: private projects carry a **Private** badge and every card a switch to change it, and the scenes you saved to the library sit beside the device's own, opening in Sculpt, to rename, delete or make public. Guests see public projects only.
- Every card for something kept only in this browser, the work in progress and the scenes kept on the device, says that a reinstall or clearing the browser loses it.
- **Install** and **Log in**, which becomes **Projects** once signed in, and **Log in** again when the sign-in expires, said once under the title with **Sign in again**.
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
- Every project is public or private: **Settings** has the choice, and so does each row of the project list. Publishing from Sculpt asks too, public unless you choose otherwise. Scenes saved from Sculpt are listed as well, and open there.
- **Record reel** exports the timelapse or a turntable spin as MP4 or GIF, up to 1080p, with a choice of aspect.
- Export a self-contained `.html` that opens offline.

### Platform

- Serverless on Cloudflare: metadata in D1, meshes and scene files in R2, every API route a Pages Function. A scene saved from Sculpt is a `.bozz` file in R2 beside its thumbnail, uploaded in parts.
- Admin writes sit behind Cloudflare Access, and so does every read of a private project: the public list, manifests and `/media` serve public projects only, and a private project's files come through `/admin/api/media`, so one cannot be fetched by guessing its id. Public reads and the viewer are open.
- A dependency-free Node CLI (`scripts/obj-to-timelapse.mjs`) builds the same frame format offline.
- A service worker precaches about 20 MB: the app shell with its fonts, the base-mesh library, the mannequins and the default environment. The other HDRIs, the gallery list and the sign-in answer are cached as they are used, so an installed app keeps working offline, owner features included. The kept sign-in answer stands in only when there is no network: an expired sign-in reaches the app as what it is, Cloudflare Access's redirect to its login, and is not taken for being offline. `?nosw` unregisters it and stays off (`?sw` re-enables), so a bad cache is a link rather than a reinstall.
- The desktop build serves the app from a custom protocol (a secure context, which WebGPU and IndexedDB both need) with no Node in the renderer. Server calls go through the main process, so a deployment needs no CORS changes to be publishable to from the app.

## Controls

Every slider shows the value it is set to while you drag it, in a bubble
under the handle. Double-click a slider (double-tap on touch) to type a
value instead: Enter or a press anywhere else applies it, `Esc` keeps what
was there. A typed value may go past the slider's travel: the handle stays
at that end and the row shows the value. It is held only to what the
setting can be, so an intensity never goes below zero, a roughness stays
within 0 to 1, and an angle wraps round.

Every key below can be changed under **Edit → Preferences** (`Ctrl`+`,`). The
guide (`H`) shows whatever keys are set.

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
| `P` | Frame-rate meter |
| `Ctrl`+`D`, `D` / `Shift`+`D` | Subdivide · step subdivision level |
| `←` `→` | Turntable |
| `G` | Cycle the stage |
| `L` (hold + drag) | Move the key light |
| `Shift`+`S` | Shadows on / off |
| `Shift`+`W` | Wireframe overlay |
| `Ctrl`+`Z` / `Ctrl`+`Shift`+`Z` | Undo / redo |
| Double-click a Scene row | Rename the object |
| `Tab` | Closes panels, then hides the interface, the Capture window with it. `Tab` or `Esc` returns, the window where it was |
| `Esc` in the Capture window | Closes the window |

URL switches: `?dev` reveals a developer section, `?q=low|medium|high` forces a quality tier. In sculpt mode, `?perfdebug=1` lists the last stalls and heavy operations with their times, and `?inputdebug=1` logs pen and touch input; both can be on at once.

## Changelog

### Unreleased

Live on the web; in the next desktop release.

- **An expired sign-in says so, and the save is kept.** Cloudflare Access sessions run out, and an app installed on an iPad keeps a sign-in of its own, apart from Safari's. Once it had run out, **Save to library** said "the server could not be reached" with the server up, and the app went on offering the owner's things: Access's redirect to its login page failed the way no network does, and the offline copy of the sign-in answered in its place. Now the app tells the two apart. The gallery shows **Log in** and says once that the sign-in has expired. **Save to library** keeps the scene on the device, its card marked **Not uploaded** with **Upload to Projects**, and the notice offers **Sign in again**, which stores the work, goes through the Access login and comes back to the same scene, its project included; the next save that goes through replaces the kept copy. With no connection the scene is kept the same way, and the notice says that instead. **Upload to Projects** on a card, publishing and the Capture window say the sign-in has expired and offer **Sign in again** too; recording carries on meanwhile. Offline, the last sign-in still stands.
- **The environment's intensity on a scale you can use, and the backdrop apart from it.** At 1 the default environment filled the key light's shadow side in almost as brightly as the key itself, and the values in use sat at the very bottom of the slider. Intensity 1 now means what 0.2 did: the slider's 0 to 2, in hundredths, covers the old 0 to 0.4 (it ran 0 to 3), and an environment starts at 1, the old 0.2 (it started at the old 1). The HDRI shown as the background has its own **Bg brightness** beside Bg blur, 0 to 2 and 1 to begin with (the plate as the old intensity 1 showed it), so it no longer goes dark or bright with the lighting. Everything saved before, looks, the autosave, `.bozz` files, armatures, published projects and single-file exports, opens exactly as it rendered: a record without the new scale's mark is read on the old one. A look saved from now on, in a file or a published project, opened in an older build (the desktop app until its next release) gets an environment five times too strong there.
- **`L` in Armature mode.** Hold `L` and drag to move the key light, as in Sculpt: across swings it round the figure, up and down raises and lowers it. While `L` is held the drag does nothing else: no orbit, no part picked, no gizmo or ball dragged. Rebind it under **Edit → Preferences**.
- **Capture is a window.** The docked Capture panel is gone: a **Capture** button in the top row, beside File and Edit, opens **Record timelapse**, the frame count, **Clear frames** and both publish forms in a floating window. It blocks nothing, so you keep sculpting with it open. Drag it by its title bar; close it with its button, the Capture button, or `Esc` while it has the focus. It stays where you left it for the session, comes back on screen if the window shrinks, follows the theme and hides with the interface on `Tab`.
- **Recording only where it can go somewhere.** A timelapse leaves the device only by publishing, which needs the sign-in, so recording is allowed signed in, on the web and the iPad, and in the desktop app. A guest on the web has no Capture button and records nothing, whatever the device remembered. Frames recorded before stay where they are, and New clears them as it always has. Signing in later, through the publish forms or elsewhere before coming back to the page, brings the button. An autosave that stops itself now also says so on screen, for everyone: a guest has no Capture window to read the note in.
- **The Model panel docks on the left, under Scene.** The left edge holds Scene then Model, the right Render then Tool. Each edge still opens one panel at a time; the tabs keep clear of each other, and of an open panel on their own edge, on every iPad screen in either orientation; and the albedo picker opens beside the panel rather than over its sliders.
- **Mask and Extract move to the Model panel.** The Tool panel's Mask section (darkening, Blur, Sharpen, Invert, Clear, and Extract with its thickness) is a section of the Model panel now, acting on the active object as before. The mask keys and the Mask brush are unchanged; `Ctrl`+`E` extracts at the Model panel's thickness.
- **Delete highest level.** The Model panel's Topology section drops the top level of the active object's subdivision stack. If that level was selected, the selection moves to the new top. It is one undo step, and undo brings the level back with its detail; with one level left the button is disabled.
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

## Getting started

Requires Node 18 or newer.

### Viewer only (no backend)

```bash
npm install
npm run dev      # generates a demo timelapse, then starts Vite
```

With no backend running, the viewer falls back to a synthetic bust at `?tl=demo`.
It is a test fixture and ships in neither the live site nor the desktop app;
`npm run build:test` is the build that keeps it, which is what the test suites
need.

### Full stack (viewer, editor, and API)

The editor and APIs are Cloudflare Pages Functions, so run them with Wrangler against a local D1 and R2:

```bash
cp wrangler.toml.example wrangler.toml
npm run db:migrate:local          # apply migrations to the local D1
npm run cf:dev                    # build, then `wrangler pages dev`
```

Set `DEV_ADMIN = "true"` in the `[vars]` block of `wrangler.toml` to use the editor locally without Cloudflare Access. Keep that local only.

### Scripts

```bash
npm run build               # type-check + static production build into dist/
npm run build:test          # the same, keeping the demo timelapse the suites need
npm run preview             # serve the production build
npm run export <id>         # bundle a timelapse into <id>.html
npm run typecheck           # app types
npm run typecheck:functions # Pages Functions types
npm run check:functions     # the Functions against a local wrangler pages dev (D1, R2)
npm run db:migrate          # apply D1 migrations to the remote database
npm run e2e:build           # test build, then the browser smoke tests (needs Playwright)
npm run e2e -- <suite ...>  # the smoke tests against the current test build
npm run desktop             # build and run the desktop app
npm run dist:desktop        # package the desktop app for this platform, into release/
```

The Blender scripts behind the base meshes and the mannequins, and the
`rig:*` scripts beside them, are described in `tools/README.md`.

## Tutorial

From a blank project to a published timelapse.

1. **Look at the viewer first.** Run `npm run dev` and open `/?tl=demo` for a synthetic sample. Drag to orbit, `Space` to play, `H` for hotkeys.
2. **Prepare your frames.** Export each stage as `.obj` or `.glb`, named so they sort in order (`sculpt_001.obj`, `sculpt_002.obj`). A few thousand to a few hundred thousand triangles per frame plays back comfortably.
3. **Create a project.** Open `/admin/` and create from a title. The id is slugged from it.
4. **Add your frames.** Drop the sequence on the dropzone. Tick **OBJ files are Z-up** for Blender and most DCC exports. They convert and upload together.
5. **Set up the look.** Pick lighting, material and environment, orbit to your angle, then press **Save look**.
6. **Annotate and finish.** Add stages to mark key frames, then **Save thumbnail**. It is live at `/?tl=<id>`.
7. **Share it.** Send the link, or press **Export .html** for one self-contained file that opens offline.

### From the command line

Build a timelapse without the editor or a database:

```bash
node scripts/obj-to-timelapse.mjs <inputDir> <id> [--fps=4] [--title="..."] [--z-up]
npm run build
npm run export <id>          # writes a self-contained <id>.html
```

## Project layout

```
index.html                 app shell: gallery, viewer, sculpt and armature
admin/index.html           app shell (editor)
create/index.html          app shell (timelapse uploader)
src/
  main.ts                  entry: ?tl=<id> boots the viewer, ?sculpt=1 and
                           ?armature=1 their modes, anything else the gallery
  types/manifest.ts        the manifest data contract (+ validation)
  loaders/gltf.ts          shared GLTFLoader setup
  viewer/
    Viewer.ts              scene, renderer, camera, render loop
    AssetSource.ts         where bytes come from: network or inlined export
    mountViewer.ts         boots the viewer + UI, shared by both entries
    Lighting.ts            multi-light rig, presets, VSM shadows
    Materials.ts           material registry + mode switching
    Environment.ts         HDRI image-based lighting + background
    Controls.ts            OrbitControls with a DCC button mapping
    FrameStreamer.ts       fetch / prefetch / cache / dispose of frames
    Timeline.ts            playback clock, fps, stage jumps, scrub
    quality.ts             device quality tiers
  armature/
    mode.ts                armature entry: figure, handles, gizmo, files, Send to Sculpt
    Armature.ts            the posable figure: bones, limits, IK, pins, planting
    rig.ts, glbRig.ts      the built-in rigs, and the reader for a rigged .glb
    figures.ts             the mannequins
  sculpt/
    mode.ts                sculpt entry: mounts the session, panels, autosave
    bridge/                the Bozzetto side: input, tools, alphas, persistence
    ui/                    toolbar, File menu, Capture window, Tool/Model/Scene panels, sliders
    vendor/                vendored SculptGL editing core (MIT)
  ui/                      Panel, Transport, Help, FpsMeter, theme, Landing,
                           Preferences and its settings, touch guards
  create/                  the timelapse uploader's entry
  desktop/, net/           the desktop shell's renderer side, and where API calls go
  embed/main.ts            entry for the self-contained single-file export
  export/singleFile.js     pure bundler core shared by the editor and CLI
  admin/
    main.ts                editor router (list / per-project)
    editor.ts              project editor: upload, preview, look, stages, export
    convert.ts, *.worker   in-browser OBJ to GLB conversion pipeline
    glb.ts                 pure OBJ parse + glTF-binary writer
    api.ts                 typed client for the Functions API
electron/                  the desktop app: main process, bozzetto:// protocol, server bridge
public/assets/             matcaps, environments, fonts, brush stencils, base meshes, mannequins
functions/
  api/                     public read API (project list + manifest), public projects only
  admin/api/               Access-gated API: the owner's list and manifests, writes
                           (projects, frames, thumb, scene uploads), and media/ for
                           private projects' files
  media/[[path]].ts        streams public projects' files from R2
  _shared/                 D1/R2 helpers, manifest shaping, auth
migrations/                D1 schema
scripts/
  generate-sample.mjs      builds the demo frames + manifest
  obj-to-timelapse.mjs     CLI: OBJ sequence to a static timelapse
  export-single-file.mjs   CLI: timelapse to a self-contained .html
tools/
  export-basemeshes.py     Blender: the CC0 base-mesh bundle to public/assets/basemeshes
  build-mannequins.py      Blender: the bundle's figures rigged into public/assets/armature
  blender_armature.py      Blender: the armature rig, to model against
  rig.json, *.mjs          the rig for the Blender scripts, and test figures
tests/e2e/                 browser smoke tests: npm run e2e:build (needs Playwright)
tests/functions/           the Functions against wrangler pages dev: npm run check:functions
```

## Deployment

Hosted on [Cloudflare Pages](https://pages.cloudflare.com/) through the GitHub integration, so every push to `main` builds and deploys.

- Build command `npm run build`, output directory `dist`.
- The `prebuild` step generates the demo timelapse, so those assets ship without being committed.
- Bindings (Pages → Settings → Functions): a D1 database bound as `DB` and an R2 bucket bound as `BUCKET`. Apply migrations with `npm run db:migrate`, before the code that needs them deploys: from `0002_visibility.sql` on, every list, manifest and media read asks for the `visibility` column.
- Admin auth: put a Cloudflare Access application in front of `/admin*`, including `/admin/api/*`. Add every hostname you edit from, both `*.pages.dev` and any custom domain. Set `ADMIN_EMAILS` to limit which identities may write. Also set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` so the admin routes verify the Access JWT directly.
- The Access application's session duration decides how often the installed app asks to sign in again (Zero Trust → Access → Applications → the app → Session Duration).
- Production is served at `bozzetto.vidarrapp.se` as a custom domain on the Pages project.

Without Wrangler at hand, a migration can go in through the D1 dashboard's
**Console**: run the file's statements one at a time, then record it so a later
`npm run db:migrate` skips it. A database first set up without `db:migrate`
has no bookkeeping table yet, so create it as Wrangler would:

```sql
CREATE TABLE IF NOT EXISTS d1_migrations(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO d1_migrations (name) VALUES ('0001_init.sql'), ('0002_visibility.sql');
```

`wrangler.toml` is gitignored. The committed `wrangler.toml.example` is the template.

## Credits

- Sculpt mode is built on [SculptGL](https://github.com/stephomi/sculptgl)'s editing core, MIT, by Stephane GINIER. The vendored source and its license live in `src/sculpt/vendor/`.
- Toolbar icons: [Uicons by Flaticon](https://www.flaticon.com/uicons).
- The base-mesh library is Blender Studio's [Human Base Meshes bundle](https://www.blender.org/download/demo-files/#asset-bundles) v1.4.1, CC0, by Dan Ulrich, Julien Kaspar, Paul Kotelevets and Tonatiuh de San Julián. Exported by `tools/export-basemeshes.py`; see `public/assets/basemeshes/LICENSE.txt`.
- The mannequins are the same bundle's primitive figures, by Paul Kotelevets and Julien Kaspar, rigged onto Bozzetto's bones by `tools/build-mannequins.py`; see `public/assets/armature/LICENSE.txt`.

## License

MIT — see [LICENSE](LICENSE).
