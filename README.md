# bozzetto

A *bozzetto* is the small preparatory model a sculptor makes before the real thing: the rough study where the form is worked out. This is a web-based 3D viewer for sculpt timelapses, built in that spirit.

Each timelapse plays back as a sequence of independent decimated meshes, one per stage, so you can watch a form emerge from big volumes to finished surface. Unlike a pre-rendered turntable, every frame is real geometry: relight it with a three-point rig and dynamic shadows, orbit it freely, swap shading modes, and study how the form resolves over time.

## Features

- Real-time three-point lighting with dynamic shadows
- Swappable material modes (lit PBR, matcap, view-space normals, wireframe)
- Smooth DCC-style camera navigation
- Streamed per-frame geometry with a simple manifest-driven format

## Getting started

Requires Node 18+.

```bash
npm install
npm run dev      # generates a demo timelapse, then starts Vite
```

Open the printed localhost URL. The viewer loads a timelapse by id from the
query string — `?tl=demo` (the default) plays a synthetic bust that roughs out
from big volumes to a faceted surface, so every feature is exercised without
any real capture data.

```bash
npm run build    # type-check + static production build into dist/
npm run preview  # serve the production build locally
```

The build is fully static and CDN-friendly: `dist/` can be dropped onto any
edge host, with the frame meshes served as immutable, long-cache assets.

## Controls

| Input | Action |
| --- | --- |
| Left drag | Orbit |
| Middle drag | Pan |
| Right drag / scroll | Zoom |
| Space | Play / pause |
| ← / → | Step frame |
| `1`–`5` | Material mode |
| `R` | Reset view |
| `G` | Toggle ground shadow |

## Project layout

```
src/
  main.ts               app entry: reads ?tl=<id>, boots the viewer
  types/manifest.ts     the manifest data contract (+ validation)
  loaders/gltf.ts       shared GLTFLoader + meshopt decoder
  viewer/
    Viewer.ts           scene, renderer, camera, render loop
    Lighting.ts         three-point rig, presets, dynamic shadows
    Materials.ts        material registry + mode switching
    FrameStreamer.ts    fetch / prefetch / cache / dispose of frames
    Timeline.ts         playback clock, fps, stage jumps, scrub
    Controls.ts         OrbitControls with a DCC button mapping
  ui/Panel.ts           the control panel
scripts/
  generate-sample.mjs   builds the demo frames, manifest, and matcap
public/timelapses/<id>/ per-timelapse assets (manifest + frame meshes)
```

## Adding a timelapse

Each timelapse is a directory under `public/timelapses/<id>/` containing a
`manifest.json` and a set of per-frame `.glb` meshes. Drop the assets in, then
load `?tl=<id>`. Nothing about the layout is hardcoded in the viewer — frame
paths, counts, fps, stages, and defaults all come from the manifest. The schema
(and a TypeScript type for it) lives in `src/types/manifest.ts`; the offline
pipeline that produces the meshes is the artist's, and `generate-sample.mjs`
shows the exact format a manifest and its frames must follow.

## Deployment

The site is hosted on [Cloudflare Pages](https://pages.cloudflare.com/) using the
GitHub git integration: every push to `main` triggers a build and deploy. The
Pages project's build configuration is:

- **Build command:** `npm run build`
- **Build output directory:** `dist`

The build's `prebuild` step generates the demo timelapse, so those assets ship in
`dist/` without being committed. Production is served at `bozzetto.vidarrapp.se`,
attached as a custom domain on the Pages project.

## Status

Early development. The v1 viewer is implemented: real-time three-point
relighting with dynamic shadows, swappable material modes (lit PBR, clay
matcap, view-space normals, wireframe, flat clay), DCC-style camera navigation,
and manifest-driven per-frame geometry streaming with a prefetch/eviction
window. Two-tier (sd/hd) streaming, worker-thread decode, and segment-bundled
frames are deferred — the schema and architecture leave room for them.
