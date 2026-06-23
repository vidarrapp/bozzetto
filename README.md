# Bozzetto
<img width="1915" height="956" alt="bozzetto_v1_screenshot_vidarrapp" src="https://github.com/user-attachments/assets/6a8b27f6-5806-422b-ac81-89909a84751d" />

A *bozzetto* is the small clay study a sculptor makes before starting the real piece, the place where the rough form gets worked out. Bozzetto applies that idea to sculpt timelapses: instead of a pre-rendered turntable video, every stage of a sculpt is stored as real 3D geometry you can relight, orbit, and step through.

There are a few parts:

- A viewer that plays a timelapse back as a sequence of meshes. You can watch a form emerge from rough volumes to a finished surface, relight it, switch shading modes, and scrub through the stages.
- A public editor (`/create`) that builds a timelapse in the browser and exports it as one self-contained file you can open offline. No sign-in, and nothing is uploaded.
- A full editor (`/admin`) that publishes timelapses to the gallery, behind a login, with a saved look and thumbnail per project.

It runs entirely on Cloudflare (Pages, Functions, D1, and R2), so there is no server to run yourself.

Live at [bozzetto.vidarrapp.se](https://bozzetto.vidarrapp.se). The viewer is at `/?tl=<id>`, the public editor at `/create/`, and the full editor at `/admin/`.

## Changelog

### v1.01

Bug fixes and UI polish.

- **Context-aware loading** — the overlay now reads "Loading model…" or "Loading timelapse…" to match the project, and reports the environment as its own load phase so the HDRI is ready before the subject appears.
- **Wireframe opacity** — the white and black wireframe overlays share a consistent slider that spans the full opacity range.
- **Stage in unlit modes** — the floor, shadow-catcher, and pedestal options now show in matcap and normal shading, not just lit PBR.
- **Fixed a black screen when cycling the ground (`g`)** — toggling shadow-casting at runtime rebuilt the WebGPU shadow-map targets and left the node pipeline with a stale (null) shadow texture; shadows are now always cast and the stage only swaps the receiver.

### v1.0

First public release.

- **WebGPU renderer** built on three.js's node pipeline, with an automatic WebGL 2 fallback so it runs everywhere.
- **Sculpt timelapses** streamed as real per-frame geometry — relight, orbit, and scrub the form as it emerges.
- **Real-time relighting**: a three-point rig, soft (VSM) shadows, and HDRI image-based lighting with an adjustable background blur.
- **Ground-truth ambient occlusion (GTAO)** and node-based **depth of field**.
- **Presentation staging** — a fading studio floor or a PBR pedestal under the subject.
- **In-browser editor** (no sign-in) that exports a self-contained single-file `.html`, plus **reel and turntable export** (MP4 / GIF) and thumbnail capture with aspect guides (9:16 / 4:5 / 1:1 / 16:9).
- **Gallery** of full-bleed portrait thumbnails.

## Make your own (no sign-in)

The quickest way in is the public editor at [`/create`](https://bozzetto.vidarrapp.se/create/). It runs entirely in your browser: you build a timelapse and download it as a single self-contained `.html`. Nothing is uploaded, and there is no account to set up.

1. Open [`/create`](https://bozzetto.vidarrapp.se/create/).
2. Drop in a sequence of `.obj` or `.glb` files, one mesh per stage of your sculpt, named so they sort in order. Tick **OBJ files are Z-up** if they came from a Z-up tool such as Blender. They convert in the browser as the progress bar fills.
3. Set up the look in the floating panel on the right: lighting, material, environment, and camera. Orbit to the angle you want.
4. Optionally add **stages** to mark and name key frames; they become markers on the exported file's scrubber.
5. Press **Export .html**. You get one file with the viewer, frames, and assets all inlined. It opens offline straight from disk, so you can email it, drop it in a shared folder, or keep it as an archive.

A single mesh works too: drop one file and you get a shareable 3D model on one HTML page. To publish timelapses to the gallery instead of downloading a file, use the full editor at `/admin/` (see the tutorial below).

## Features

### Viewer

- Per-frame geometry streaming. One persistent mesh has its geometry swapped each frame, with prefetch and eviction around the playhead so playback does not stall. If the next frame is not decoded yet, it holds the nearest one that is.
- Renders on WebGPU through three.js's node-based renderer, with an automatic WebGL 2 fallback when WebGPU is unavailable; the same materials, shadows, ambient occlusion, and depth of field run on either backend.
- Real-time relighting with a multi-light rig and soft (VSM) shadows.
- Material modes: lit PBR (albedo, roughness, metalness), matcaps, view-space normals, and a wireframe overlay, each with smooth or flat shading.
- HDRI image-based lighting (PMREM) with selectable environments, three background modes (theme colour, solid colour, blurred HDRI), and separate rotation for the light rig and the HDRI.
- Ground-truth ambient occlusion (GTAO) with adjustable strength and radius, composited in the node post-processing graph. It can be turned off.
- Depth of field (a node-based gather): aperture and a focus plane that tracks the orbit target. Off by default.
- A device quality tier plus adaptive quality that backs off render cost when the frame rate drops.
- A DCC-style camera (orbit, pan, dolly) with a saved camera per project, a light/dark theme, an on-screen hotkey guide, and a bottom transport bar with a scrubber and stage markers.

### Public editor (`/create/`)

- No sign-in and no backend. Frames are converted and held in the browser; nothing is uploaded.
- The preview is the real viewer, with the same floating look panel as the full editor.
- One button exports a self-contained `.html` with the viewer, frames, and assets inlined, ready to share or archive.

### Editor (`/admin/`)

- Create a project from a title (the id is slugged from it), then drag and drop a sequence of `.obj` or `.glb` files.
- OBJ to glTF-binary conversion runs in the browser inside a Web Worker, with conversion and upload overlapped.
- The preview is the real viewer. Set up lighting, material, environment, AO, and camera in the floating panel, then use Save look to store the exact opening state.
- Mark stages (named frames with a short description) that appear on the scrubber, and capture any frame as the gallery thumbnail.
- Full-window preview with floating side panels that slide out of the way (press Tab to hide them).
- Export a finished timelapse as one self-contained `.html`, with the viewer, frames, and assets all inlined, that opens offline straight from disk.

### Platform

- Serverless on Cloudflare: project metadata in D1 (SQLite), binary meshes in R2, and every API route as a Pages Function.
- Admin writes sit behind Cloudflare Access. Public reads and the viewer are open.
- A dependency-free Node CLI (`scripts/obj-to-timelapse.mjs`) produces the same frames as the in-browser converter, byte for byte, so timelapses can also be built offline.

## Controls

| Input | Action |
| --- | --- |
| Left drag | Orbit |
| Middle drag | Pan |
| Right drag / scroll | Zoom |
| `Space` | Play / pause |
| `←` `A` / `→` `D` | Step frame |
| `F` | Focus (frame the model) |
| `1` | Lit (PBR) |
| `2`… | Matcaps |
| `S` | Smooth / flat shading |
| `W` | Wireframe overlay |
| `G` | Ground shadow |
| `Tab` | Show / hide panels |
| `H` | Hotkey guide |

A few URL switches help when debugging the renderer: `?dev` reveals a developer section in the control panel, and `?q=low|medium|high` forces a quality tier.

## Getting started

Requires Node 18 or newer.

### Viewer only (no backend)

```bash
npm install
npm run dev      # generates a demo timelapse, then starts Vite
```

Open the localhost URL it prints. With no backend running, the viewer falls back to a bundled synthetic bust at `?tl=demo` that roughs out from big volumes to a faceted surface, which exercises every rendering feature without any real capture data.

### Full stack (viewer, editor, and API) locally

The editor and the APIs are Cloudflare Pages Functions, so run them with Wrangler against a local D1 and R2:

```bash
cp wrangler.toml.example wrangler.toml
npm run db:migrate:local          # apply migrations to the local D1
npm run cf:dev                    # build, then `wrangler pages dev`
```

To use the editor locally without setting up Cloudflare Access, set `DEV_ADMIN = "true"` in the `[vars]` block of `wrangler.toml`. Keep that local only and never set it in production. The editor lives at `/admin/`.

### Useful scripts

```bash
npm run build               # type-check + static production build into dist/
npm run preview             # serve the production build
npm run export <id>         # build first, then bundle a timelapse into <id>.html
npm run typecheck           # app types
npm run typecheck:functions # Pages Functions types
npm run db:migrate          # apply D1 migrations to the remote database
```

## Tutorial

A walkthrough from a blank project to a finished timelapse you can share. It assumes you have the app running locally (see Getting started) or are using the live site.

### 1. Look at the viewer first

Before making anything, get a feel for what you are building toward. Run `npm run dev`, open the printed URL, and go to `/?tl=demo`. This is a bundled synthetic bust that roughs out from big volumes to a faceted surface. Drag to orbit, scroll to zoom, press `Space` to play, and use the bar along the bottom to scrub through the stages. Press `H` at any time for the full list of hotkeys.

### 2. Prepare your frames

A timelapse is just a sequence of meshes, one per stage of a sculpt. Export each stage from your sculpting tool as an `.obj` or `.glb` file, named so they sort in order (for example `sculpt_001.obj`, `sculpt_002.obj`, and so on). Lower triangle counts play back more smoothly, so a few thousand to a few hundred thousand triangles per frame is a comfortable range.

### 3. Create a project

Open `/admin/` and create a project from a title. The id is slugged from the title, and is what you load the viewer by later.

If you are running locally, set `DEV_ADMIN = "true"` in `wrangler.toml` first so the editor opens without Cloudflare Access (see Getting started).

### 4. Add your frames

Drag the whole sequence onto the dropzone, or pick the files. If they came from a Z-up tool such as Blender or most DCC apps, tick **OBJ files are Z-up** so they are rotated to the viewer's Y-up. The files convert in the browser and upload while you watch the progress bar. When it finishes, the live preview appears.

### 5. Set up the look

The preview is the real viewer, with a floating control panel on the right (press `Tab` to hide it). Pick a lighting preset, a material, and an HDRI environment, then orbit to the camera angle you want. When it looks right, press **Save look**. That stores the exact opening state, the camera included, so anyone who opens the timelapse sees it the way you framed it.

### 6. Annotate and finish

Add **stages** to mark and name key frames; they appear as markers on the scrubber. Press **Save thumbnail** to grab the current frame as the gallery image. Your timelapse is now live at `/?tl=<id>`.

### 7. Share it

There are two ways to hand it off:

- **A link.** When you deploy from your own Cloudflare project, the timelapse is already live at its `/?tl=<id>` URL. Send the link.
- **A single file.** Press **Export .html** in the editor's Export section to download one self-contained `.html` with the viewer, frames, and assets inlined. It opens straight from disk with no internet connection, so you can email it, drop it in a shared folder, or keep it as an archive. Build the site at least once first, since the export reuses the built viewer bundle.

### Doing it from the command line

You can build a timelapse without the editor or a database. A dependency-free Node script converts a folder of frames into a static timelapse under `public/timelapses/<id>/`:

```bash
node scripts/obj-to-timelapse.mjs <inputDir> <id> [--fps=4] [--title="..."] [--z-up]
```

It loads by id the same way (`?tl=<id>`) and is served straight from `dist/`, which is handy when you want to commit a fixed timelapse alongside the app. To turn one into a shareable single file, build the site and export it by id:

```bash
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
    quality.ts, pcss.ts    device tiers + optional PCSS shadows
  ui/                      Panel, Transport, Help, FpsMeter, theme, shortcuts, Landing
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

The site is hosted on [Cloudflare Pages](https://pages.cloudflare.com/) through the GitHub integration, so every push to `main` builds and deploys.

- Build command is `npm run build` and the output directory is `dist`.
- The `prebuild` step generates the demo timelapse, so those assets ship in `dist/` without being committed.
- Bindings (Pages, then Settings, then Functions): a D1 database bound as `DB` and an R2 bucket bound as `BUCKET`. Apply migrations with `npm run db:migrate`.
- Admin auth: put a Cloudflare Access application in front of the admin surface (`/admin*`, including `/admin/api/*`). Add every hostname you edit from, both the `*.pages.dev` domain and any custom domain, or writes from an uncovered host will return 403. You can also set an `ADMIN_EMAILS` var to limit which identities may write.
- Production is served at `bozzetto.vidarrapp.se`, attached as a custom domain on the Pages project.

`wrangler.toml` is gitignored; the committed `wrangler.toml.example` is the template. Production bindings live in the dashboard rather than the repo.

## License

MIT.
