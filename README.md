# Bozzetto

A *bozzetto* is the small clay study a sculptor makes before starting the real piece, the place where the rough form gets worked out. Bozzetto applies that idea to sculpt timelapses: instead of a pre-rendered turntable video, every stage of a sculpt is stored as real 3D geometry you can relight, orbit, and step through.

There are two parts:

- A viewer that plays a timelapse back as a sequence of meshes. You can watch a form emerge from rough volumes to a finished surface, relight it, switch shading modes, and scrub through the stages.
- A browser-based editor for building those timelapses. You drop in a sequence of `.obj` or `.glb` files, convert them in the browser, set up the look, mark the stages, and publish.

It runs entirely on Cloudflare (Pages, Functions, D1, and R2), so there is no server to run yourself.

Live at [bozzetto.vidarrapp.se](https://bozzetto.vidarrapp.se). The viewer is at `/?tl=<id>` and the editor is at `/admin/`.

## Features

### Viewer

- Per-frame geometry streaming. One persistent mesh has its geometry swapped each frame, with prefetch and eviction around the playhead so playback does not stall. If the next frame is not decoded yet, it holds the nearest one that is.
- Real-time relighting with a multi-light rig and soft (VSM) shadows. An optional PCSS mode gives contact-hardening shadows.
- Material modes: lit PBR (albedo, roughness, metalness), matcaps, view-space normals, and a wireframe overlay, each with smooth or flat shading.
- HDRI image-based lighting (PMREM) with selectable environments, three background modes (theme colour, solid colour, blurred HDRI), and separate rotation for the light rig and the HDRI.
- Screen-space ambient occlusion, using GTAO where the device can handle it and falling back to SSAO. It can be turned off.
- A device quality tier plus adaptive quality that backs off render cost when the frame rate drops.
- A DCC-style camera (orbit, pan, dolly) with a saved camera per project, a light/dark theme, an on-screen hotkey guide, and a bottom transport bar with a scrubber and stage markers.

### Editor (`/admin/`)

- Create a project from a title (the id is slugged from it), then drag and drop a sequence of `.obj` or `.glb` files.
- OBJ to glTF-binary conversion runs in the browser inside a Web Worker, with conversion and upload overlapped.
- The preview is the real viewer. Set up lighting, material, environment, AO, and camera in the floating panel, then use Save look to store the exact opening state.
- Mark stages (named frames with a short description) that appear on the scrubber, and capture any frame as the gallery thumbnail.
- Full-window preview with floating side panels that slide out of the way (press Tab to hide them).

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

A few URL switches help when debugging the renderer: `?dev` reveals a developer section in the control panel, `?q=low|medium|high` forces a quality tier, and `?shadows=pcss` swaps the shadow algorithm.

## How it works

```
Browser                          Cloudflare edge
┌────────────────────┐           ┌─────────────────────────────────────────┐
│ Viewer  /?tl=<id>  │──GET────▶ │ /api/projects/:id   → manifest (D1)      │
│  three.js renderer │──GET────▶ │ /media/<id>/...     → frame .glb (R2)    │
│                    │           │                                          │
│ Editor  /admin/    │──POST───▶ │ /admin/api/...      → writes (Access)    │
│  OBJ to GLB worker │   .glb    │   D1 (metadata)  +  R2 (meshes)          │
└────────────────────┘           └─────────────────────────────────────────┘
```

**Manifest-driven.** Nothing about a timelapse is hardcoded in the viewer. Frame paths, counts, fps, stages, defaults, the saved look, and the camera all come from a manifest. For API projects that manifest is built from the D1 row at request time (`functions/_shared/projects.ts`); for the bundled demo it is a static JSON file. The schema and its validator are in `src/types/manifest.ts`.

**Data model.** A project is one row in the D1 `projects` table (`id`, `title`, `mode`, `fps`, and timestamps) plus a JSON `data` blob holding `defaults`, `camera`, `lighting`, `material`, `environment`, `ao`, `stages`, and the `frames` list. The frame meshes are R2 objects under `projects/<id>/frames/sd/NNNN.glb`, served immutably through `/media/...` with a `?v=<updated_at>` cache-buster.

**In-browser conversion.** Dropping `.obj` files runs `parseObj` then `writeGlb` (`src/admin/glb.ts`) inside a worker. Positions and indices are pulled out, normals are recomputed smooth, and Z-up sources are rotated to glTF's Y-up if you ask for it. Existing `.glb` files pass straight through. That code is a port of the CLI pipeline, so frames made in the editor and frames made on the command line come out identical.

**Auth.** Write endpoints call `requireAdmin`, which only passes once Cloudflare Access has added a `Cf-Access-Authenticated-User-Email` header (optionally narrowed by an `ADMIN_EMAILS` allowlist). Reads and the viewer need no auth.

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
npm run typecheck           # app types
npm run typecheck:functions # Pages Functions types
npm run db:migrate          # apply D1 migrations to the remote database
```

## Creating a timelapse

### From the editor (recommended)

1. Open `/admin/` and create a project from a title.
2. Drag in a naturally sorted sequence of `.obj` (or `.glb`) frames. Tick **OBJ files are Z-up** if they came from a Z-up DCC tool.
3. Set up lighting, material, environment, AO, and camera in the floating panel, then press **Save look**.
4. Add **stages** to annotate key frames, press **Save thumbnail**, and the project is live at `/?tl=<id>`.

### From the command line

A dependency-free Node script writes a complete static timelapse under `public/timelapses/<id>/`:

```bash
node scripts/obj-to-timelapse.mjs <inputDir> <id> [--fps=4] [--title="..."] [--z-up]
```

Static timelapses load by id the same way (`?tl=<id>`) and are served straight from `dist/`. This is useful when you want to commit a fixed timelapse with the app and skip the database.

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
    Lighting.ts            multi-light rig, presets, VSM shadows
    Materials.ts           material registry + mode switching
    Environment.ts         HDRI image-based lighting + background
    Controls.ts            OrbitControls with a DCC button mapping
    FrameStreamer.ts       fetch / prefetch / cache / dispose of frames
    Timeline.ts            playback clock, fps, stage jumps, scrub
    quality.ts, pcss.ts    device tiers + optional PCSS shadows
  ui/                      Panel, Transport, Help, FpsMeter, theme, shortcuts, Landing
  admin/
    main.ts                editor router (list / per-project)
    editor.ts              project editor: upload, preview, look, stages
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
