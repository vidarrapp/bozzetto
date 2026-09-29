# Bozzetto

<img width="1915" height="956" alt="bozzetto_v1_screenshot_vidarrapp" src="https://github.com/user-attachments/assets/6a8b27f6-5806-422b-ac81-89909a84751d" />

A *bozzetto* is the small clay study a sculptor makes before the real piece, where the rough form gets worked out.

Bozzetto is a sculpting and timelapse tool for the browser. Sculpt in 3D, capture every stage as real geometry, and play it back as a timelapse you can relight, orbit and scrub. Not a pre-rendered video.

Built as a study and teaching tool, and as a way to render out content. Shared under MIT for anyone who finds it useful.

**Live at [bozzetto.vidarrapp.se](https://bozzetto.vidarrapp.se)**

| Where | What |
| --- | --- |
| `/` | Gallery |
| `/?sculpt=1` | Sculpt mode |
| `/?tl=<id>` | Viewer |
| `/create/` | Public editor, no sign-in |
| `/admin/` | Full editor, publishes to the gallery |

Runs entirely on Cloudflare Pages, Functions, D1 and R2. No server to run yourself.

## Install as an app

Bozzetto installs to the home screen and launches fullscreen. That is the way to use sculpt mode on an iPad. The gallery's **Install** button walks you through it.

**iPad / iPhone (Safari):** Share button → **Add to Home Screen** → **Add**.

**Android (Chrome):** **⋮** menu → **Add to Home screen** → confirm.

**Installed, Bozzetto works offline.** A service worker precaches the app, so it opens and sculpts with no network at all. The gallery still shows your work in progress and the projects you saw last time; environments download once and are kept. Only opening a timelapse you have never played needs a connection.

Sculpts autosave to browser storage whether installed or not. Nothing uploads unless you sign in and publish. On iPad, installing also protects that storage: home-screen apps are exempt from the eviction that clears ordinary browsing data.

## Sculpt

Click **New sculpt** in the [gallery](https://bozzetto.vidarrapp.se). No sign-in, and everything stays on your device.

- **Ten brushes** on `1`–`0`: Crease, Move, Standard clay, Inflate, Pinch, Flatten, Rake, Drag, Polish, Paint. `Alt` carves, `Shift` smooths from any brush.
- **Brush character** is tunable per tool. Clay lays ribbon-like strips. Move grabs volumetrically, so you can pull a silhouette from outside the outline. Polish flattens surfaces while keeping edges crisp, with a Plane lock slider from follow to flatten. Crease has Profile and Pinch sliders, from a broad trough to a knife line.
- **Stencils.** The Rake combs grooves through a stroke-aligned stencil. Clay can take one too, off by default. A Spacing slider sets how far the brush travels between stamps.
- **Apple Pencil pressure** drives brush strength through the stroke, with per-brush response curves.
- **Masking** with `Ctrl`, plus blur, sharpen, invert, clear, and **Extract** to turn a masked region into a new object.
- **Mirror symmetry** per brush, on across X by default, each brush with its own axis. Hovering shows the mirrored brush ring.
- **Topology**: a multiresolution stack, dynamic topology with stroke detail sliders, and voxel remesh.
- **Painting**: vertex-paint albedo with an HSV picker, alt-click to sample, or drag the swatch onto the viewport to pick a colour off the screen. Flood fill, and `Shift` blurs the paint under the brush. Named materials per object, each with albedo, roughness and metalness.
- **Create menu** in the Scene panel: seven primitives (sphere, cube, cylinder, torus, cone, capsule, plane) and a **base-mesh library**, Blender Studio's CC0 [Human Base Meshes](https://www.blender.org/download/demo-files/#asset-bundles): male and female figures in realistic and stylized topology, voxel-remeshed blockout figures, heads (realistic, stylized, planar, low-poly cage, blockout), hands, feet, eyes, jaws and skulls. A figure arrives with its eyes as separate objects, one undo step, at the same size as a primitive; a blockout arrives as one remeshed shell or, with the menu's switch, as its fifty separate lumps. Files fetch on first use and stay cached.
- **Object transforms**: a unified move/rotate/scale gizmo whose centre moves across the screen, single modes on `W`/`E`/`R`, with a settings panel for which handles show. Multi-object scenes with an outliner, a Select tool (`Q`) with marquee and Maya-style modifiers, and duplicate, delete, mirror, radial copies, merge (a voxel union) and the gizmo all working on the whole selection. Locked objects draw as if masked.
- **Full render controls** while sculpting: lighting, matcaps, tone mapping, ambient occlusion, depth of field, environment and camera. The look saves with your scene.
- **Timelapse capture**: mesh snapshots after each stroke, stored locally, publishable to the gallery.
- **Files**: `.bozz` save and open for the whole scene, plus OBJ import and export.
- **Scene library**: **Save to library** keeps a sculpt on the device. Saved scenes appear as gallery cards with a thumbnail, object and triangle counts and their size; open one with a tap, rename it in place, delete it when you are done. Separate from the autosave, which still resumes your work in progress.
- **Made for iPad**: two fingers always navigate, a resting palm never blocks the Pencil, and the touch toolbar covers keyboard-less use.
- **Reload-safe**: every edit autosaves to IndexedDB. Unfinished work shows in the gallery as an "In progress" card, beside any scenes you saved to the library.

## Desktop app

A packaged build for macOS, Windows and Linux, for when you want Bozzetto as a
real application: native **Open** and **Save** over `.bozz` files (double-click
one to open it), a window title that names the open document and marks unsaved
changes, a save prompt before closing, recent files, and crash recovery.

It is local by default and makes no network requests at all. Point it at your
own Cloudflare deployment under **Server → Server Settings** if you want to
publish from it; signing in opens Cloudflare Access in a real window.

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

## Armature mode

A posable figure of its own, for reference or as the start of a sculpt.
Signed-in only for now: pick **Create → New armature** in the gallery (or
open `/?armature=1`); guests see the plain New sculpt tile.

- **Figures.** A new armature starts on the realistic male mannequin,
  one of four: Blender Studio's CC0 "primitive" base meshes, male and
  female in realistic and stylized proportions, rigged onto the app's
  bones by `tools/build-mannequins.py`. The Figure list also offers the
  block placeholders (male and female); each lump follows its bone
  rigidly, so a mannequin poses, reaches and sends to Sculpt exactly like
  the blocks. A mannequin is fetched the first time it is used (about a
  megabyte) and kept for offline use; the autosave and `.armature` files
  only name it. The blocks are code and always there, so they are the
  fallback when a mannequin cannot be fetched (offline, never seen) or a
  saved model cannot be read.

- **Pose.** Click a part and its joint's rotate gizmo appears, clamped to
  that joint's limits: hinges (elbows, knees) show one ring plus a little
  twist, ball joints three. Symmetry (`X`, off to begin with) mirrors every
  edit to the other side through the pelvis's own frame. The pelvis is the
  root: its gizmo moves and turns the whole figure (`W` selects it).
- **Reach.** A ball sits at each hand, the middle of each foot and the top
  of the head. Drag one and the limb reaches for it, inside the same joint
  limits; a foot is held by its middle, so it pivots there rather than
  swinging round its toe. **Pin** a ball and it holds its place in the world
  while the rest of the figure moves, so the pelvis can drop into a crouch
  with the feet planted or the body can lean away from a hand that stays
  put. Both feet start pinned where they stand, and **Reset pose** moves
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
| `X` | Symmetry on / off |
| `W` / `E` / `T` | Move the pelvis · rotate the selection · both at once |
| `Shift`+`R` | Reset the pose |
| `Esc` | Deselect |
| `Ctrl`+`Z`, `Ctrl`+`Shift`+`Z` | Undo, redo |
| `Ctrl`+`Enter` | Send to Sculpt |
| `F` / `A` | Frame the figure |

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

## Make your own timelapse

The public editor at [`/create`](https://bozzetto.vidarrapp.se/create/) runs entirely in your browser. Nothing uploads, and there is no account.

1. Open [`/create`](https://bozzetto.vidarrapp.se/create/).
2. Drop in `.obj` or `.glb` files, one per stage, named so they sort in order. Tick **OBJ files are Z-up** for Blender and most DCC exports.
3. Set a title, pick **Timelapse** or **Model**, and set the playback FPS.
4. Set up the look in the right-hand panel, then orbit to your angle.
5. Optionally add **stages** to name key frames. They become scrubber markers.
6. Press **Export .html** for one self-contained file that opens offline.
7. Export MP4 or GIF from **Record reel**.

A single mesh works too: drop one file and get a shareable 3D model on one page.

## Features

### Viewer

- Per-frame geometry streaming. Frames are gzipped, position-quantized GLBs, roughly 3–4× smaller than raw meshes. Frames near the playhead are prefetched, the rest fill in behind.
- Timelapses that fit the device memory budget buffer whole, so scrubbing and looping never reload. Larger ones keep a budget's worth around the playhead.
- WebGPU through three.js's node renderer, with automatic WebGL 2 fallback. Same materials, shadows, AO and depth of field on either backend.
- Real-time relighting: a multi-light rig with two presets, per-light toggles and colours, rig rotation, and soft VSM shadows.
- Material modes: lit PBR and matcaps, with a wireframe overlay, in smooth or flat shading.
- Ten matcaps in a thumbnail gallery. Tone mapping is selectable: None, Neutral, AgX or Cinematic.
- HDRI environment lighting with three background modes and separate rotation for the rig and the HDRI.
- Ground-truth ambient occlusion and node-based depth of field, both adjustable.
- Adaptive quality that backs off render cost when the frame rate drops.
- DCC-style orbit, pan and dolly, with a saved camera per project.

### Gallery

- Published projects as thumbnail cards, badged *timelapse* or *model*, led by a **New sculpt** tile and your own in-progress sculpt.
- **Install**, **Upload timelapse**, and **Log in**, which becomes **Projects** once signed in.
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
- **Record reel** exports the timelapse or a turntable spin as MP4 or GIF, up to 1080p, with a choice of aspect.
- Export a self-contained `.html` that opens offline.

### Platform

- Serverless on Cloudflare: metadata in D1, meshes in R2, every API route a Pages Function.
- Admin writes sit behind Cloudflare Access. Public reads and the viewer are open.
- A dependency-free Node CLI (`scripts/obj-to-timelapse.mjs`) builds the same frame format offline.
- A service worker precaches the ~4.4 MB app shell, fonts included; HDRIs, base meshes, the gallery list and the sign-in answer are cached as they are used, so an installed app keeps working offline, owner features included. `?nosw` unregisters it and stays off (`?sw` re-enables), so a bad cache is a link rather than a reinstall.
- The desktop build serves the app from a custom protocol (a secure context, which WebGPU and IndexedDB both need) with no Node in the renderer. Server calls go through the main process, so a deployment needs no CORS changes to be publishable to from the app.

## Controls

Every slider shows the value it is set to while you drag it, in a bubble
under the handle.

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
| Drag on the mesh | Sculpt (`Alt` carves, `Shift` smooths; with the paint brush, `Shift` blurs the paint) |
| Drag off the mesh | Orbit |
| Two-finger drag / pinch | Pan / zoom, even on the model |
| `Ctrl` + drag | Paint mask (`+Alt` unmasks) |
| `Ctrl` + `A` / `C` / `I` / `H` / `E` | Mask all · clear / invert / hide mask · extract masked region |
| `1`–`9`, `0` | Brushes |
| `Q` | Select tool: click selects, `Shift` adds, `Ctrl`+drag removes, `Ctrl`+`Shift`+drag adds, drag a marquee, `Alt`+drag orbits. In the Scene list, `Ctrl`+click toggles and `Shift`+click takes a range |
| `Ctrl`+`M` | Mirror the selected objects across the brush's symmetry axis (the Scene panel's Mirror button offers X/Y/Z and radial copies) |
| `Ctrl`+`J` | Merge the selected objects into one, through voxel space at the Model panel's remesh resolution |
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
| `Tab` | Closes panels, then hides the interface. `Tab` or `Esc` returns |

URL switches: `?dev` reveals a developer section, `?q=low|medium|high` forces a quality tier.

## Changelog

### Unreleased

- **A new armature starts on the realistic male mannequin** rather than the block placeholders. The blocks stay in the Figure list and stand in whenever a mannequin cannot be fetched (offline, never seen) or a saved model cannot be read.
- **Mirrored parts face outward.** The bundle's right-hand lumps are its left ones mirrored with a negative scale, and baking that into the exported positions turned their faces inward: the mannequins' right limbs, eyes and ears rendered inside out. The exporters now reverse the winding of mirrored parts and check every part's signed volume. The blockouts added as parts had the same fault on their right-hand lumps, the right eye and ear among them. The one-object blockouts, voxel-remeshed from those lumps, come out unchanged, as do the other base meshes, whose eyes were never mirrored; so does Send to Sculpt, whose voxel pass tells inside from outside without reading the winding.
- **The mannequins' hips sit lower**, in the middle of each half of the pelvis. They were placed at the top of the thigh lump, which reaches up past the joint, and sat 2.5 to 4.5 cm too high.
- **The deltoid moves with the arm.** The shoulder lump now rides on the upper arm rather than the clavicle, and the shoulder joint sits in its middle, so a raised arm turns the shoulder cap about its own centre, as on a wooden mannequin, instead of swinging out from under it.
- **Knees fold forward and elbows back on every mannequin.** The stylized male's knees bent backwards: the files carried no knee or elbow limits, and the app took the fold direction from the bend each joint rests with, which on that figure was a fraction of a degree past straight. The mannequins now carry their own knee and elbow limits, folding the anatomical way through a range sized from each figure's rest bend.
- **The hips open outward, as they should.** A leg taken out to the side stopped at 20° and one taken across went on to 60°, by its foot's ball or the thigh's Side slider alike: the hips' side limits were the wrong way round. A leg now opens 60° and crosses 20°, on the mannequins and the blocks. The shoulders had the same fault and now lift 30° and drop 20°, where they lifted 20° and dropped 30°.
- **The head reaches through the spine.** Dragging the head's ball bends the neck, the chest and now the spine too, so a head drawn forward or aside takes the back with it.
- **Symmetry starts off** in Armature mode. A figure is posed a limb at a time far more often than both at once; `X` and the panel's box still turn it on.
- **Both feet start pinned**, where the new figure stands, so the pelvis can drop into a crouch or lean from the first drag without the feet leaving the ground. A file from before pins were saved opens the same way, and **Reset pose** now moves every pin to where the reset leaves its hand or foot instead of pulling the figure back into the old pose on the next move.
- **Pinned feet no longer snap round when the pelvis moves.** A knee's aim was read around the line from the hip to the foot's ball, which sits well ahead of the ankle, and against that line the knee of a nearly straight leg reads as pointing backwards: the first solve after the pelvis moved turned each leg half round to put it right, on every figure. It is read around the hip-to-ankle line now, and three smaller snaps of the same kind went with it: the aim's forward turns with the figure rather than staying world forward, each knee and elbow starts from where it points at rest rather than being swung to straight forward or back on its first solve (by up to 37° on the mannequins), and one turned by hand keeps its new direction. A pin beyond the leg's reach leaves the foot as near as the leg gets.
- **The feet reach from their middle.** A foot's ball and its pin sit halfway along the foot rather than at the toe, so a pinned foot pivots about its middle instead of swinging round its toe; the hands and the head are held by their tips as before. Files saved earlier have their foot pins moved to the middle of the foot as they open.
- **Plant feet.** A foot on the ground stands flat, facing the way the figure faces, after a reach, a pinned foot's re-solve or a pose reset; in a deep crouch it stays as flat as the ankle bends, then the heel lifts. A foot off the ground follows its shin as before. On by default, with a box in the Reach section, and kept with the figure.
- **The balls win the click.** A press within 18 pixels of a reach or aim ball takes it, even where a part is in front of the ball; the knee and elbow balls used to lose most presses to the limb around them. The balls are also in place from the start, where they used to wait at the figure's feet until the first click.
- **The armature's gallery card has a picture.** The figure is photographed without its balls and gizmo as you leave through the Gallery link, and as the page closes where there is time, and the picture is kept with the autosave; the `.armature` file leaves it out.

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
npm run db:migrate          # apply D1 migrations to the remote database
```

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
index.html                 app shell (viewer)
admin/index.html           app shell (editor)
src/
  main.ts                  viewer entry: reads ?tl=<id>, boots the viewer
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
  sculpt/
    mode.ts                sculpt entry: mounts the session, panels, autosave
    bridge/                the Bozzetto side: input, tools, alphas, persistence
    ui/                    toolbar, File menu, Tool/Model/Scene/Capture panels, sliders
    vendor/                vendored SculptGL editing core (MIT)
  ui/                      Panel, Transport, Help, FpsMeter, theme, Landing
  embed/main.ts            entry for the self-contained single-file export
  export/singleFile.js     pure bundler core shared by the editor and CLI
  admin/
    main.ts                editor router (list / per-project)
    editor.ts              project editor: upload, preview, look, stages, export
    convert.ts, *.worker   in-browser OBJ to GLB conversion pipeline
    glb.ts                 pure OBJ parse + glTF-binary writer
    api.ts                 typed client for the Functions API
functions/
  api/                     public read API (project list + manifest)
  admin/api/               Access-gated write API (projects, frames, thumb)
  media/[[path]].ts        streams frame meshes from R2
  _shared/                 D1/R2 helpers, manifest shaping, auth
migrations/                D1 schema
scripts/
  generate-sample.mjs      builds the demo frames + manifest
  obj-to-timelapse.mjs     CLI: OBJ sequence to a static timelapse
  export-single-file.mjs   CLI: timelapse to a self-contained .html
tools/
  export-basemeshes.py     Blender: the CC0 base-mesh bundle to public/assets/basemeshes
  blender_armature.py      Blender: the armature rig, to model against
tests/e2e/                 browser smoke tests: npm run e2e:build (needs Playwright)
```

## Deployment

Hosted on [Cloudflare Pages](https://pages.cloudflare.com/) through the GitHub integration, so every push to `main` builds and deploys.

- Build command `npm run build`, output directory `dist`.
- The `prebuild` step generates the demo timelapse, so those assets ship without being committed.
- Bindings (Pages → Settings → Functions): a D1 database bound as `DB` and an R2 bucket bound as `BUCKET`. Apply migrations with `npm run db:migrate`.
- Admin auth: put a Cloudflare Access application in front of `/admin*`, including `/admin/api/*`. Add every hostname you edit from, both `*.pages.dev` and any custom domain. Set `ADMIN_EMAILS` to limit which identities may write. Also set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` so the admin routes verify the Access JWT directly.
- Production is served at `bozzetto.vidarrapp.se` as a custom domain on the Pages project.

`wrangler.toml` is gitignored. The committed `wrangler.toml.example` is the template.

## Credits

- Sculpt mode is built on [SculptGL](https://github.com/stephomi/sculptgl)'s editing core, MIT, by Stephane GINIER. The vendored source and its license live in `src/sculpt/vendor/`.
- Toolbar icons: [Uicons by Flaticon](https://www.flaticon.com/uicons).
- The base-mesh library is Blender Studio's [Human Base Meshes bundle](https://www.blender.org/download/demo-files/#asset-bundles) v1.4.1, CC0, by Dan Ulrich, Julien Kaspar, Paul Kotelevets and Tonatiuh de San Julián. Exported by `tools/export-basemeshes.py`; see `public/assets/basemeshes/LICENSE.txt`.

## License

MIT — see [LICENSE](LICENSE).
