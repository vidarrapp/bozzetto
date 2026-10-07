# Development

Putting the site on Cloudflare is in [deployment.md](deployment.md), building and releasing the desktop app in [desktop.md](desktop.md), and what the app does in the [README](../README.md).

## Getting started

Requires Node 20 or newer; CI and the deployment use 22.

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
npm run build:desktop       # the desktop build alone, into dist-desktop/
xvfb-run -a node tests/e2e/desktop.mjs  # the desktop app's own suite, on a virtual display
npm run dist:desktop        # package the desktop app for this platform, into release/
```

The Blender scripts behind the base meshes and the mannequins, and the
`rig:*` scripts beside them, are described in `tools/README.md`.

### URL switches

Beside the ones under Controls in the [README](../README.md#controls), `?canvasmsaa=1` gives the canvas its own MSAA again, as it had before, to compare a frame against.

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

## Platform

- Serverless on Cloudflare: metadata in D1, meshes and scene files in R2, every API route a Pages Function. A scene saved from Sculpt is a `.bozz` file in R2 beside its thumbnail, uploaded in parts.
- Admin writes sit behind Cloudflare Access, and so does every read of a private project: the public list, manifests and `/media` serve public projects only, and a private project's files come through `/admin/api/media`, so one cannot be fetched by guessing its id. Public reads and the viewer are open.
- Accounts, behind `ACCOUNTS_ENABLED`: members join by invite and sign in with passkeys or six-digit email codes, in a dialog over the page, with Turnstile keeping out bots. Sessions are cookies the page cannot read, and once the owner has an account the owner tools want it signed in as well as Access. Each account keeps its own projects on `/api/me`, which mirror the owner's routes, within a quota (250 MB; the owner's 10 GB); their files come only through a private route that no cache keeps. **Download my data** is zipped in the browser with client-zip, a file at a time, and an account is deleted a step at a time until nothing of it is left.
- A dependency-free Node CLI (`scripts/obj-to-timelapse.mjs`) builds the same frame format offline.
- A service worker precaches about 20 MB: the app shell with its fonts, the base-mesh library, the mannequins and the default environment. The other HDRIs, the gallery list and the sign-in answer (with accounts on, the account, without its address, the site's settings and the list of My projects, never their files) are cached as they are used, so an installed app keeps working offline, owner features included; signing out, or a sign-in that has gone, drops what was kept of the account. The kept sign-in answer stands in only when there is no network: an expired sign-in reaches the app as what it is, Cloudflare Access's redirect to its login, and is not taken for being offline. `?nosw` unregisters it and stays off (`?sw` re-enables), so a bad cache is a link rather than a reinstall.
- The desktop build serves the app from a custom protocol (a secure context, which WebGPU and IndexedDB both need) with no Node in the renderer. Server calls go through the main process, so a deployment needs no CORS changes to be publishable to from the app.

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
                           Preferences and its settings, touch guards, the
                           service worker and its update notices
  ui/account/              accounts: the sign-in dialog, Join, Account,
                           My projects, the data download's zip
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
public/legal/              the Privacy notice and the Terms
functions/
  _middleware.ts           runs first for every Function: the files host, cross-site
                           writes, and who is asking
  api/                     the public list and manifests (the templates), /api/config,
                           and, with accounts on, auth/ (signing in) and me/ (an
                           account's own projects, files and settings)
  admin/api/               the owner tools, behind Access and the owner's account:
                           projects and templates, uploads, media/ for private files,
                           invites, users, the audit log
  m/, media/               the templates' files, on the files host and on this one
  _shared/                 D1/R2 helpers, manifest shaping, sessions and passkeys,
                           mail and Turnstile, quota and uploads
shared/bozz.ts             the scene file's reader, shared by the app and the Functions
migrations/                D1 schema
scripts/
  app-version.mjs          the version a build says it is: package.json's + the commit
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
