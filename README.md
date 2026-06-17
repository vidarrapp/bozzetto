# Bozzetto

A *bozzetto* is the small preparatory model a sculptor makes before the real thing — the rough study where the form is worked out. Bozzetto is a web app for **sculpt timelapses** built in that spirit: instead of a pre-rendered turntable video, every stage of a sculpt is kept as **real 3D geometry** you can relight, orbit, and step through.

It's two things in one:

- a **viewer** that plays a timelapse back as a sequence of meshes — watch a form emerge from big volumes to finished surface, relight it, swap shading modes, and study how it resolves over time;
- a **browser-based editor** for building those timelapses — drag in a sequence of `.obj`/`.glb` files, convert them in the browser, tune the look, mark up stages, and publish.

The whole thing runs on Cloudflare's edge (Pages + Functions + D1 + R2), so there's no server to operate.

🔗 **Live:** [bozzetto.vidarrapp.se](https://bozzetto.vidarrapp.se) · viewer at `/?tl=<id>`, editor at `/admin/`

---

## Features

**Viewer**
- Per-frame geometry streaming — one persistent mesh whose geometry is swapped per frame, with prefetch/eviction so playback never stalls (it holds the nearest decoded frame until the next is ready).
- Real-time relighting: a multi-light rig with soft (VSM) dynamic shadows, plus an optional PCSS contact-hardening mode.
- Material modes: lit PBR (albedo / roughness / metalness), matcaps, view-space normals, and a wireframe overlay — with smooth/flat shading.
- HDRI image-based lighting (PMREM) with selectable environments, background modes (theme colour / solid / blurred HDRI), and independent rig + HDRI rotation.
- Screen-space ambient occlusion (GTAO on capable devices, SSAO fallback), toggleable.
- Device-tiered quality plus adaptive quality that sheds cost if the frame rate dips.
- DCC-style camera (orbit / pan / dolly) with a saved camera per project, light/dark theme, an on-screen hotkey guide, and a bottom transport with a scrubber and stage markers.

**Editor** (`/admin/`)
- Create a project (the id is slugged from the title), then drag-and-drop a sequence of `.obj` or `.glb` files.
- OBJ → glTF-binary conversion happens **in the browser**, in a Web Worker, with conversion and upload pipelined together.
- Live preview using the real viewer; tune lighting, material, environment, AO and camera in a floating panel and **Save look** to persist the exact opening state.
- Define **stages** (named frames with descriptions) that show up on the scrubber, and capture any frame as the gallery thumbnail.
- Full-window preview with floating, slide-out side panels (press `Tab` to hide them all).

**Platform**
- Serverless on Cloudflare: project metadata in **D1** (SQLite), binary meshes in **R2**, all API routes as **Pages Functions**.
- Admin writes are gated by **Cloudflare Access**; public read + viewer are open.
- A pure-Node CLI (`scripts/obj-to-timelapse.mjs`) produces byte-identical frames to the in-browser converter, so you can build timelapses offline too.

---

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

---

## How it works

```
Browser                          Cloudflare edge
┌────────────────────┐           ┌─────────────────────────────────────────┐
│ Viewer  /?tl=<id>  │──GET────▶ │ /api/projects/:id   → manifest (D1)      │
│  three.js renderer │──GET────▶ │ /media/<id>/...     → frame .glb (R2)    │
│                    │           │                                          │
│ Editor  /admin/    │──POST───▶ │ /admin/api/...      → writes (Access ✓)  │
│  OBJ→GLB in worker │   .glb    │   D1 (metadata)  +  R2 (meshes)          │
└────────────────────┘           └─────────────────────────────────────────┘
```

**Manifest-driven.** Nothing about a timelapse is hardcoded in the viewer — frame paths, counts, fps, stages, defaults, the saved look, and the camera all come from a manifest. For API projects the manifest is shaped on the fly from the D1 row (`functions/_shared/projects.ts`); for the bundled demo it's a static JSON file. The schema and its validator live in `src/types/manifest.ts`.

**Data model.** A project is one row in the D1 `projects` table (`id`, `title`, `mode`, `fps`, timestamps) plus a JSON `data` blob holding `defaults`, `camera`, `lighting`, `material`, `environment`, `ao`, `stages`, and the `frames` list. The frame meshes themselves are R2 objects under `projects/<id>/frames/sd/NNNN.glb`, served immutably via `/media/...` with a cache-busting `?v=<updated_at>`.

**In-browser conversion.** Dropping `.obj` files runs `parseObj` → `writeGlb` (`src/admin/glb.ts`) inside a worker: positions and indices are extracted, normals recomputed smooth, and Z-up sources optionally rotated to glTF's Y-up. Pre-made `.glb` files pass through untouched. The same code is a port of the CLI pipeline, so editor-made and CLI-made frames are identical on the wire.

**Auth.** Write endpoints call `requireAdmin`, which only passes when Cloudflare Access has injected a `Cf-Access-Authenticated-User-Email` header (optionally narrowed by an `ADMIN_EMAILS` allowlist). Reads and the viewer are unauthenticated.

---

## Getting started

Requires Node 18+.

### Viewer only (no backend)

```bash
npm install
npm run dev      # generates a demo timelapse, then starts Vite
```

Open the printed localhost URL. With no backend running, the viewer falls back to a bundled synthetic bust — `?tl=demo` — that roughs out from big volumes to a faceted surface, exercising every rendering feature without any capture data.

### Full stack (viewer + editor + API) locally

The editor and APIs are Cloudflare Pages Functions, so run them with Wrangler against a local D1 + R2:

```bash
cp wrangler.toml.example wrangler.toml
npm run db:migrate:local          # apply migrations to the local D1
npm run cf:dev                    # build, then `wrangler pages dev`
```

To use the editor locally without setting up Cloudflare Access, set `DEV_ADMIN = "true"` in the `[vars]` block of `wrangler.toml` (local only — never in production). The editor lives at `/admin/`.

### Useful scripts

```bash
npm run build               # type-check + static production build into dist/
npm run preview             # serve the production build
npm run typecheck           # app types
npm run typecheck:functions # Pages Functions types
npm run db:migrate          # apply D1 migrations to the remote database
```

---

## Creating a timelapse

### From the editor (recommended)

1. Open `/admin/` and create a project from a title.
2. Drag in a naturally-sorted sequence of `.obj` (or `.glb`) frames — tick **OBJ files are Z-up** if they came from a Z-up DCC tool.
3. Tune lighting, material, environment, AO and camera in the floating panel and **Save look**.
4. Add **stages** to annotate key frames, **Save thumbnail**, and the project is live at `/?tl=<id>`.

### From the command line

A dependency-free Node script produces a complete static timelapse under `public/timelapses/<id>/`:

```bash
node scripts/obj-to-timelapse.mjs <inputDir> <id> [--fps=4] [--title="…"] [--z-up]
```

Static timelapses load by id the same way (`?tl=<id>`) and are served straight from `dist/` — handy for committing a fixed timelapse alongside the app without touching the database.

---

## Project layout

```
index.html                app shell (viewer)
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
    convert.ts, *.worker   in-browser OBJ→GLB conversion pipeline
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
  obj-to-timelapse.mjs     CLI: OBJ sequence → static timelapse
```

---

## Deployment

Hosted on [Cloudflare Pages](https://pages.cloudflare.com/) via the GitHub integration — every push to `main` builds and deploys.

- **Build command:** `npm run build` · **Output directory:** `dist`
- The `prebuild` step generates the demo timelapse, so those assets ship in `dist/` without being committed.
- **Bindings** (Pages → Settings → Functions): a **D1** database bound as `DB` and an **R2** bucket bound as `BUCKET`. Apply migrations with `npm run db:migrate`.
- **Admin auth:** put a Cloudflare Access application in front of the admin surface (`/admin*`, including `/admin/api/*`). Add every hostname you edit from — both the `*.pages.dev` domain and any custom domain — or writes from the uncovered host will 403. Optionally set an `ADMIN_EMAILS` var to restrict which identities can write.
- Production is served at `bozzetto.vidarrapp.se`, attached as a custom domain on the Pages project.

`wrangler.toml` is gitignored (the committed `wrangler.toml.example` is the template); production bindings live in the dashboard, not in the repo.

---

## License

MIT.
