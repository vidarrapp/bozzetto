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
- **Stencils.** The Rake combs grooves through a stroke-aligned stencil, nine to choose from. Clay can take one too, off by default. A Spacing slider sets how far the brush travels between stamps.
- **Apple Pencil pressure** drives brush strength through the stroke, with per-brush response curves.
- **Masking** with `Ctrl`, plus blur, sharpen, invert, clear, and **Extract** to turn a masked region into a new object.
- **Mirror symmetry** with a per-object axis. Hovering shows the mirrored brush ring.
- **Topology**: a multiresolution stack, dynamic topology with stroke detail sliders, and voxel remesh.
- **Painting**: vertex-paint albedo with an HSV picker, alt-click to sample. Named materials per object, each with albedo, roughness and metalness.
- **Object transforms**: a unified move/rotate/scale gizmo, single modes on `W`/`E`/`R`. Multi-object scenes with an outliner.
- **Full render controls** while sculpting: lighting, matcaps, tone mapping, ambient occlusion, depth of field, environment and camera. The look saves with your scene.
- **Timelapse capture**: mesh snapshots after each stroke, stored locally, publishable to the gallery.
- **Files**: `.bozz` save and open for the whole scene, plus OBJ import and export.
- **Scene library**: **Save to library** keeps a sculpt on the device. Saved scenes appear as gallery cards with a thumbnail, object and triangle counts and their size; open one with a tap, rename it in place, delete it when you are done. Separate from the autosave, which still resumes your work in progress.
- **Made for iPad**: two fingers always navigate, a resting palm never blocks the Pencil, and the touch toolbar covers keyboard-less use.
- **Reload-safe**: every edit autosaves to IndexedDB. Unfinished work shows in the gallery as an "In progress" card, beside any scenes you saved to the library.

## Desktop app

A packaged build for macOS, Windows and Linux, for when you want Bozzetto as a
real application: native **Open** and **Save** over `.bozz` files, a window
title that names the open document, recent files, and crash recovery.

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

### Releasing

`.github/workflows/release.yml` builds all three platforms and attaches the
installers to a GitHub Release:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Run it from the **Actions** tab instead to test a build without tagging; that
path publishes nothing and leaves the installers as downloadable artifacts.
No secrets to configure — it uses the token Actions provides.

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
- A service worker precaches the ~3.5 MB app shell; HDRIs and the gallery list are cached as they are used. `?nosw` unregisters it and stays off (`?sw` re-enables), so a bad cache is a link rather than a reinstall.
- The desktop build serves the app from a custom protocol (a secure context, which WebGPU and IndexedDB both need) with no Node in the renderer. Server calls go through the main process, so a deployment needs no CORS changes to be publishable to from the app.

## Controls

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
| Drag on the mesh | Sculpt (`Alt` carves, `Shift` smooths) |
| Drag off the mesh | Orbit |
| Two-finger drag / pinch | Pan / zoom, even on the model |
| `Ctrl` + drag | Paint mask (`+Alt` unmasks) |
| `Ctrl` + `A` / `C` / `I` / `H` / `E` | Mask all · clear / invert / hide mask · extract masked region |
| `1`–`9`, `0` | Brushes |
| `B` / `S` (hold + drag) | Brush size / strength (`[` `]` and `;` `'` step them) |
| `F` / `A` | Frame the model / the whole scene |
| `X` | Mirror symmetry |
| `W` / `E` / `R`, `Q` | Move / rotate / scale gizmo · back to sculpting |
| `T` | Frame-rate meter |
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

### v1.1

**Sculpt mode (alpha).** Bozzetto can now sculpt, not just play back. Built on [SculptGL](https://github.com/stephomi/sculptgl)'s editing core, ported onto Bozzetto's WebGPU/WebGL2 pipeline with one canvas, one camera and one look.

- Ten brushes with per-tool settings, pen pressure with response curves, and 64-deep undo.
- Rake brush with nine stroke-aligned stencils. Clay takes stencils too, off by default. Per-brush dab spacing.
- Crease Profile and Pinch sliders, from a broad trough to a knife line.
- Polish brush replacing Twist, flattening surfaces while keeping edges crisp.
- Masking, Extract, mirror symmetry with a mirrored hover ring.
- Multiresolution, dynamic topology and voxel remesh.
- Vertex painting, per-object named materials, and an HSV colour picker shared across the app.
- Unified transform gizmo with `W`/`E`/`R` modes and a multi-object outliner.
- Five docked panels: File and Scene left, Render, Tool and Model right.
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

With no backend running, the viewer falls back to a bundled synthetic bust at `?tl=demo`.

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
npm run preview             # serve the production build
npm run export <id>         # bundle a timelapse into <id>.html
npm run typecheck           # app types
npm run typecheck:functions # Pages Functions types
npm run db:migrate          # apply D1 migrations to the remote database
```

## Tutorial

From a blank project to a published timelapse.

1. **Look at the viewer first.** Open `/?tl=demo` and get a feel for it. Drag to orbit, `Space` to play, `H` for hotkeys.
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
    ui/                    toolbar, Tool/Model/Scene/File panels, sliders
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

## License

MIT — see [LICENSE](LICENSE).
