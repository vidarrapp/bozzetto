# Asset library: what exists today (read-only map of the repository, 2026-11-18)

Where the plan says "not found", I looked and found nothing. Line numbers are from the files as they stand now.

**Note on the plan document:** `docs/HANDOFF.md:14` says the decision "Plan: docs/plans/asset-library.md". That file does **not exist** (`docs/plans/` holds only `armature-workspace.md`, `reference-and-measure.md`, `tool-library-and-nodes.md` and `drafts/`).

The tool library plan already sketches a material library and a single tabbed window ("One window with tabs", `docs/plans/tool-library-and-nodes.md`, section 3, after "A material library on the same pattern"). It lists Tools, Materials and Light rigs only. HDRIs, matcaps and the Community are not in it.

---

## 1. Materials in Sculpt

**Record.** `SculptMaterial` is `{id, name, albedo (sRGB hex), roughness 0..1, metalness 0..1}` (`src/sculpt/bridge/materials.ts:14-22`).
- `MATERIAL_ID = /^m\d{1,9}$/` (line 25).
- `DEFAULT_MATERIAL` is `{albedo '#fed9a8', roughness 0.5, metalness 0}` (line 28).
- There is no three.js material per record. Roughness and metalness are written into each vertex (`materialsPBR.x/.y`). The albedo is read by the shader from each display mesh's `userData` and multiplied by the paint in the `color` attribute (header comment, lines 7-13).

**Creation.**
- The constructor creates "Clay" (line 56).
- `create(name?)` makes "Material N" with the defaults (line 68).
- The only UI that creates one is the "New*" entry at the end of the Scene panel's Material select. It asks for a name with `askText` and then creates and assigns (`src/sculpt/ui/ScenePanel.ts:726-762`).

**Rename and delete.**
- `remove(id)` exists. It refuses to delete the last material and reassigns users to material[0] (line 76).
- `update()` takes a name patch.
- I found no UI that renames or deletes a material. `library.remove` is not called outside `materials.ts`. `mode.ts` calls only `loadFrom`, `saveInto`, `list`, `materialFor` and `update` (lines 268, 518-521, 1599-1605, 2308).

**Assignment.**
- Per object, by mesh id (`assign`, line 100).
- Done only from the Scene panel's "Material" select under the object list (`ScenePanel.ts:726`).
- The select is disabled for a locked object.
- Duplicate objects keep the same material (`adoptCopy`, line 112).

**Sharing.**
- Many objects can point at one material id.
- `update()` changes it for all users: it rewrites roughness and metalness across every mesh that uses it (line 150).
- Editing the material from the Material panel therefore edits the shared one, not a copy.

**Saved in the scene.**
- `scene.materials` holds the list, and `materialId` and `painted` ride on each saved mesh by index (`saveInto`, line 187; `SavedScene.materials?` at `ScenePersist.ts:256`).
- On load, `sanitizeMaterials` (`src/sculpt/bridge/sanitize.ts:214-230`) caps the list at `MAX_MATERIALS = 1024`. It keeps only well-formed ids and clamps the numbers. A name is cut to 200 characters by `MAX_NAME` (line 35).
- A scene older than version 5 is migrated by `whitenOldPaint`. Scene v < 5 carries the albedo baked into its colours.

**UI.**
- Material tab, `src/ui/MaterialPanel.ts`: a "Surface" section (active object's material name read-only, Albedo picker, Roughness, Metalness) and a "Display" section (`MaterialControls` in `src/ui/Panel.ts`). Its own comment says "assigning is the Scene panel's" (line 99).
- No list of materials anywhere in the Material tab.

**Ready-made materials.** Not found. `grep` for preset or ready-made materials gives nothing. The tool library plan's material library (shipped set, "My materials") is only a plan.

**Per-device store of materials.** Not found. Materials live only in the scene (autosave in IndexedDB, `.bozz` files, library saves). Published models bake the albedo into the vertex colours (`albedoLinear`, line 133).

**Look-level material (a separate thing).**
- `MaterialState {albedo, roughness, metalness, flatShading, matcapIndex, vertexColors?, colourSource?}` is part of the look (`src/viewer/Materials.ts:20-45`).
- `Viewer.getLook()` / `applyLook()` carry it (`Viewer.ts:2213-2260`).
- It is stored with the look: in IndexedDB key `currentLook` for Sculpt (`ScenePersist.ts:402`), in `.bozz` as `look?`, and in project `data.material` for published projects (`functions/_shared/types.ts:122-123`).
- In Sculpt the active object's own material wins over the look's.

---

## 2. Matcaps

**List.** Ten, defined at `src/viewer/Materials.ts:62-72` as ids `vr01`..`vr10`, labels "VR01".."VR10".
- The comment says it is the owner-supplied "VR pack" (Blender format), flattened at import by radial edge bleed (script `scratchpad matcap-flatten.py`).
- The four older house matcaps were retired.
- `MatcapConfig` (line 47) is `{id, label, url}` and is not exported.
- `matcaps()` returns `{id,label}[]` (line 257). `matcapIndex` is a number into this list.

**Files.** `public/assets/matcaps/vr01.png`..`vr10.png`.
- 512x512, 8-bit RGB PNG.
- 76.9 to 96.6 KB each, about 0.9 MB in total.
- Thumbnails at `public/assets/matcaps/thumbs/<id>.png`, about 4 KB each, 41 KB in total.
- `clay.png` (35.7 KB) also sits in the folder but is not in the list, and nothing under `src/` references it. It is generated by `scripts/generate-sample.mjs:401`.

**Loading.**
- All ten are requested when `Materials` is constructed (`:92`), through `source.getBytes`, a blob URL and an `Image` (`loadMatcap`, line 567).
- URL is `?v=<ASSET_VERSION>`, currently `'2'` (`src/viewer/assetVersion.ts`). Bump it when a PNG is replaced.
- Precached by the service worker: `vite.config.ts:154-155,168-169` includes `'assets/**/*.png'`, and `ignoreURLParametersMatching: [/^v$/]` (line 195) lets the `?v=` requests hit the precache.
- `public/_headers:12` gives `/assets/matcaps/*` a 7-day Cache-Control.

**Choosing in the UI.**
- Panel.ts line 242-253: a "Mode" select built from `viewer.materials.modes`. Those are exactly two: `lit` "Lit (PBR)" and `matcap` "Matcap" (Materials.ts:88-91). There are no "others".
- With Mode = Matcap, a round thumbnail trigger opens a body-mounted popover gallery. It is `matcapPicker` in `src/ui/MatcapPicker.ts`, shown by `Panel.ts:422-439` only if there is more than one matcap.
- Hotkeys are in `src/ui/keymap.ts:155-163`, mode `view`: `1` = Lit, `2`..`9` = matcap 1..8 (so VR09 and VR10 have no key). Handled in `src/ui/shortcuts.ts:140-163`. Picking a matcap by key also switches Mode to Matcap.

**What a matcap replaces.**
- `setMatcapIndex` swaps `MeshMatcapNodeMaterial.matcap` and clamps an out-of-range index (`Materials.ts:261-272`).
- The comment at `Materials.ts:~360-366` says "a matcap renders PURE": the albedo and the paint never tint it, and roughness, metalness and lights are not used.
- What still applies on top: the mask darkening and the lock darkening (both modes), and poly-group colours.
- The shadow pass is skipped for it, because `modes[].lit` is false for `matcap`.

**Matcap in the look.** `MaterialState.matcapIndex` is an index, not an id (`sanitize.ts:360` clamps to 0..1000). Reordering or inserting matcaps would change what saved looks show.

**User-added matcaps.** Not possible. The list is a compile-time constant and nothing loads a user image. The closest existing intake of a user's picture is `src/reference/image.ts`. It decodes, scales to 2048 px, re-encodes to JPEG (or PNG if any pixel is transparent) and so drops EXIF.

---

## 3. Light rigs

**Built-in rigs.** `PRESETS` in `src/viewer/Lighting.ts:141`, ten of them. Ids and labels:
- `three_point` "Three-point"
- `key_only` "Key only"
- `raking_key` "Raking key (form study)"
- `rembrandt` "Rembrandt"
- `butterfly` "Butterfly"
- `split` "Split"
- `rim` "Rim"
- `top_light` "Top light"
- `under_light` "Under light"
- `soft_front` "Soft front"

Sculpt's default is `key_only` (`tests/e2e/lookTabs.mjs:99`).

**In-memory types.** `Lighting.ts`:
- `RigLight` (line 246) is `{type:'directional', id key|fill|rim, enabled, intensity, color, azimuth, elevation, castShadow, softness}`.
- `RigValues` (line 258) is `{lights: RigLight[], ambient: {intensity, sky, ground}}`.
- Methods: `presetRig` (264), `activePreset` (352), `matchesRig` (359), `rigValues` (380), `applyRig` (406), `applyPreset` (417).

**Record format.** `.bozzrig`, JSON (`src/ui/rigLibrary.ts`).
- Shape: `{format:'bozzrig', version:1, name, lights:[...], ambient:{...}}` (`rigFileText`, line 112).
- File name `<slug>.bozzrig` (`rigFileName`).
- Extension and format constants at lines 33-34.

**Validation on import (`parseRigFile`, line 126).**
- Text larger than 64 KiB is refused (`MAX_FILE_BYTES`, line 37).
- JSON parse must succeed, `format === 'bozzrig'`, and `version` must be a number from 1 to 1 (newer is refused with "made by a newer version").
- `readRig` (line 91) demands 1 to 32 lights.
- Light types other than `directional` are silently skipped.
- Each light must have an id in key/fill/rim, no duplicate ids, boolean `enabled` and `castShadow`, numeric `intensity`, `azimuth`, `elevation`, `softness`, and a hex `color`.
- Every number is clamped to `RIG_LIMITS` (line 25): intensity 0..5, azimuth -180..180, elevation -20..90, softness 0..16, ambient 0..2.
- Missing lights become switched off (`NO_LIGHT`).
- Ambient is optional with defaults.
- Errors are plain sentences shown by `tellWindow`.
- Name: `cleanRigName` is one line, trimmed, at most 60 characters (`MAX_NAME`).

**Device store.**
- localStorage key `bz.rigs` through `deviceStore` (line 35). It holds a JSON array of `{id, name, rig}`.
- `myRigs()` re-validates every entry through `readRig` on each read and caps the list at `MAX_RIGS = 100`. A bad store reads as empty.
- Writes go through `writeRigs`, which returns false when `deviceStore.set` throws (saving off or quota full).
- Event `bozzetto:rigs-changed` (`RIGS_CHANGED_EVENT`, line 150) refreshes open Lighting tabs.
- A rig saved under an existing name (case-insensitive) replaces it after a confirm (`rigNamed`).
- Ids are `r<time36><rand>`.

**UI (`src/ui/lookPanels.ts`, `LightingPanel`).**
- `buildRig` (line 230): a "Rig" select with optgroups "Built in" and "My rigs", plus a hidden "Custom" option that shows when the lights match nothing (`syncRig`, line 294).
- Below it, if `opts.rigLibrary` (line 79): buttons "Save rig…" (askText for the name, `saveCurrent`, line 309), "Import rig…" (hidden file input accepting `.bozzrig,application/json,.json`, `importFile`, line 340) and "Manage".
- Import applies the rig at once and also saves it to My rigs.
- "Manage" toggles an inline list (`.rig-manage__row`) with Rename, Export (`downloadBlob`) and Delete (danger `askWindow`) per row. Empty text: "No saved rigs yet. Save rig keeps the lights as they are." (line 376).
- If the device will not keep things, the notice is "Rigs are kept on this device, and keeping things on this device is off." (`notKept`, line 331).

**Where the rig list is shown.**
- Present workspace's Lighting tab, with the full library: `src/present/workspace.ts:314`, `rigLibrary: true`.
- Sculpt's own Present: `src/sculpt/mode.ts:2090`, `rigLibrary: true`.
- The public viewer and review mode: `src/viewer/viewerFrame.ts:76`, tabs `['lighting']`, `rigLibrary: false` (select only, nothing saved).
- `mountViewer.ts:88` passes it through.
- Sculpt and Armature have no Lighting tab. Their key light is moved with L or View > Move light.

**Rigs in the look.** `LightingState` (`Lighting.ts:77`) records key, fill, rim, ambient and `rigRotation`, not the rig's name. A rig is a set of values applied to the lights. Nothing links a scene to "which rig".

**`bozzrig` in the e2e tests.** The `.bozzrig` file name pattern and the rig names appear in `tests/e2e/lookTabs.mjs`.

---

## 4. HDRIs / environments

**List.** `ENVIRONMENTS` (`src/viewer/Environment.ts:75-82`), a hard-coded array. Six entries, `{id, label, file}`:

| id | label | file |
|---|---|---|
| `studio-neutral` | Neutral studio | `/assets/env/studio-neutral.hdr` |
| `studio-photo` | Photo studio | `/assets/env/studio-photo.hdr` |
| `overcast` | Soft overcast | `/assets/env/overcast.hdr` |
| `interior-warm` | Warm interior | `/assets/env/interior-warm.hdr` |
| `garage` | Garage | `/assets/env/garage.hdr` |
| `plaza` | Outdoor plaza | `/assets/env/plaza.hdr` |

**Files.** `public/assets/env/*.hdr`, Radiance RGBE, all 1024x512 (the header says `-Y 512 +X 1024`).
- Sizes: garage 1,718,216 B; interior-warm 1,698,243; overcast 1,615,142; plaza 1,601,746; studio-neutral 1,578,021; studio-photo 1,534,910. Whole folder 9.7 MB with the README.
- **The folder's `README.md` is stale.** It says to use 2k files, 4 to 10 MB, `.exr` supported, "pick any 3", and "entries without a file are hidden automatically". Files are 1k, about 1.5 to 1.7 MB each, only `.hdr` is loaded (`HDRLoader`), and the six entries are always listed.

**Precache against on demand** (`vite.config.ts`).
- Only `assets/env/studio-neutral.hdr` is precached (line 172, comment 163-169).
- The other five are fetched on first use, then kept by a runtime `CacheFirst` rule `bozzetto-env`. It has `maxEntries: 8` and a 90-day maximum age (lines 349-360).
- `maximumFileSizeToCacheInBytes` is 6 MiB (line 200).
- `public/_headers:9` gives `/assets/env/*` a 7-day Cache-Control.

**Choosing.**
- Lighting tab, section "Environment light" (`lookPanels.ts:543-564`): a "HDRI" select with "None" plus the six, then Intensity (0..2, scaled by `ENV_INTENSITY_SCALE = 0.2`) and Rotation (0..360). Those two rows are hidden under "None".
- Render tab, "Background and ground" (`buildBackground`, line 796): a "Background" select Theme / Solid colour / HDRI, "Bg colour", "Bg blur" 0..1, "Bg brightness" 0..2.
- The HDRI background uses the same loaded map as the lighting one, so with Background = HDRI and HDRI = None you get the theme colour.

**Stored in the look.** `EnvState` (`Environment.ts:21-35`) is `{v:2, id|null, intensity, background 'theme'|'color'|'hdri', bgColor, rotation, blur, bgBrightness}`.
- It goes into `Viewer.getLook().environment`, so: the Sculpt look in IndexedDB, `.bozz` files, and project `data.environment` for published work.
- An id that names no environment becomes "none" (`setEnvironment`, line 155: "An id that names no environment (a file's, say) is none").
- `sanitizeLook` handles `environment` (`sanitize.ts:365`).
- `applyState` rescales records without `v` (version 1).

**User-supplied HDRI today.** Not possible.
- No file input.
- The only path is `ENVIRONMENTS.find(id)`, then `loadViaBlob(source, cfg.file, 'image/vnd.radiance', ...)` (`Environment.ts:169`), which calls `source.getBytes('/assets/...')`. `HttpSource.getBytes` fetches `/assets/` paths only (`AssetSource.ts:31-37`).
- An unknown id in a file becomes none, so a shared look cannot name a custom HDRI.

**Processing on load.**
- `HDRLoader` decodes (Environment.ts:20, `loader.loadAsync`).
- `mapping = EquirectangularReflectionMapping`.
- `pmrem.fromEquirectangular(equirect)`, using the node renderer's `PMREMGenerator` from `three/webgpu` (line 119; the comment at lines 113-118 says it works on both WebGPU and WebGL backends).
- The equirect texture is also kept as the background and disposed when switching (`disposeMaps`).
- A "Loading environment…" hint shows during the load (`Viewer.ts:788-795`). A token drops superseded loads.
- **Time and memory figures: not found anywhere in the repo.**

**Limits that would apply to user files.**
- CSP (`public/_headers`, last lines) is **Report-Only**, not enforced: `connect-src 'self' blob: data: https://api.github.com https://files.vidarrapp.se https://files-staging.vidarrapp.se`; `img-src 'self' blob: data: <files hosts>`; `worker-src 'self' blob:`.
- A blob URL fetch (what `loadViaBlob` does) is allowed by `connect-src blob:`.
- A separate `Content-Security-Policy: frame-ancestors 'none'` is enforced.
- No code limits the size of an HDRI.
- The service worker `maximumFileSizeToCacheInBytes` of 6 MiB applies to precache only.
- `HDRLoader` takes only Radiance `.hdr`. There is no EXR loader imported.
- A sanity check would be needed for dimensions: 4k or 8k HDRs would make big PMREM work and big textures.

---

## 5. Floating windows that exist

Only one is movable and non-modal.

**`PublishWindow`** (`src/sculpt/ui/PublishWindow.ts`, 305 lines). Frame classes `float-window`, `__bar`, `__title`, `__close`, `__body` (CSS at `src/style.css:4299-4366`, restyled at 6199-6262).
- **Non-modal:** `role=dialog`, `aria-modal=false`. Nothing dims or blocks; a press elsewhere leaves it open.
- **Drag:** pointer events on the title bar with `setPointerCapture`; `touchstart` is `preventDefault`ed on the bar so iOS gives no callout; the bar has `touch-action: none` (CSS) and the close button also `touch-action: none`.
- **Position:** clamped to the screen with `EDGE = 8` and `TOP = 30` (`clamp`, line 218), reclamped on `resize`, and kept as put (`pos`) so a narrow screen does not lose where it was left.
- **Remembered position:** `sessionStorage` key `bozzetto-publish-window` (`readPosition` / `writePosition`). This is per browser session, **not** `deviceStore`, so it is not remembered between visits and does not follow the saving choice.
- **Focus and Esc:** the window is focusable (`tabIndex=-1`). Esc is handled on the window's own `keydown`, so it only closes when the window has focus. After opening from the keyboard, or after a drag, it takes the focus. On a mouse or touch tap it deliberately does not, so Tab still hides the interface.
- **Hiding with the interface:** `body.chrome-hidden .float-window` is hidden by CSS (line 2435).
- **Z-index:** `.float-window { z-index: 20 }`, above docked panels (15) and under the hotkey guide (25) and top row (30), menus (32) and modals (40) (CSS comment, lines 4294-4298). Width 268 px, `max-height: calc(100vh - 54px)`, body scrolls.
- **Opening:** its own chip (a "Publish" strip button via `onTap`); the window opens under the chip, clear of docked right-hand panels (`underChip`).
- The `ReferenceView` excludes `.float-window` from "over the view" tests (`ReferenceView.ts:255`).
- Not reusable as is: the class has no tab support, one fixed title and a hard-wired chip and `publishSlot`. The CSS classes and the drag, clamp and persistence logic are the reusable parts.

**Preferences** (`src/ui/Preferences.ts`, `.dsettings`): **modal**.
- Full-screen backdrop `position: fixed; inset: 0; z-index: 200; background rgb(0 0 0 / 55%)` (`style.css:3516-3523`), a card of 460 px width.
- Adds `has-modal` to the body, which stops hotkeys and Tab.
- Esc on a window-level capture listener, only while open and not capturing a key (lines 351-359). A press on the backdrop closes it.
- No drag and no remembered position.

**Help window** (`src/help/HelpWindow.ts`): **modal**, on Preferences' chrome (`dsettings help-win`).
- `aria-modal=true` and `has-modal`.
- A Tab focus trap inside the card.
- Esc and backdrop close.
- Arrow keys walk the topic list.
- Focus returns to the previous element.
- It has a filter box over titles and bodies (`searchText`), which is a possible pattern for a library's search.
- No drag and no remembered position.

**`askWindow` / `askText` / `tellWindow`** (`src/ui/askWindow.ts`): **modal**.
- `.install-overlay` with `z-index: 40`, `has-modal`, focus trap.
- Esc and backdrop both mean "no".
- In danger mode, Enter never confirms.
- Opening one of these while a non-modal library window is open puts `has-modal` on the body, so the hotkeys and Tab stand down while it is up. The rig Rename, Delete and Save flows already do exactly this.

**Reusable list parts.**
- `src/ui/layerList.ts` (483 lines): `LayerList.render(rows, activeId)` draws newest-first rows with eye, rename-on-tap and a row menu, and takes reorder or drop hooks only where given. It is built around layers (`LayerRowData`, blend and opacity controls, groups, mask badges), not general items.
- `src/ui/rowMenu.ts` (104 lines): `rowMenu(label, items[], className)` returns `{wrap, trigger, items}`. It is a "More" button whose list is `.file-menu` placed under the button, closes on outside press, Esc or scroll or resize, and the arrows walk it. It is generic and directly reusable for a row's menu.

**Thumbnails elsewhere.**
- `Viewer.captureThumbnail(width = 800, smooth = true)` (`Viewer.ts:2564`) draws the current frame into a 4:5 canvas (`THUMB_ASPECT = 4/5`, `THUMB_WIDTH = 800`, `THUMB_HEIGHT = 1000`, lines 346-348). It centres on the capture guide's frame if one is up, and calls `canvas.toBlob(..., 'image/jpeg', 0.82)`. The renderer is held for readback and `smooth` takes 16 jittered samples.
- Sculpt's library card thumbnail is a JPEG `thumb: Blob` in the IndexedDB snapshot (`SculptSnapshot`, `ScenePersist.ts:405`).
- Landing cards use `setPicture` (`src/ui/Landing.ts`). The service worker keeps thumbnails in cache `bozzetto-thumbs` (`vite.config.ts:96`).
- The material library plan wants "a small lit sphere" per material and a stroke picture per tool. Nothing renders a preview sphere today. The matcap thumbnails are static PNGs.

---

## 6. Device storage

**`src/ui/deviceStorage.ts`.**
- States: `DeviceChoice = 'none' | 'keep' | 'declined'` (line 41).
- `CHOICE_KEY = 'bozzetto-device-choice'` in localStorage holds `'keep'` and nothing else. `DECLINED_KEY = 'bozzetto-device-declined'` is in sessionStorage, for this tab session only.
- `mayStore()` is true only for `keep`.
- `deviceStore.get` returns null unless `keep`; `set` throws `DeviceStorageOff` unless `keep`; `remove` does nothing unless `keep`; `forget` always removes (sign-in end only).
- Listeners via `onDeviceChoice`; `storage` events from other tabs are followed.
- The window that asks is `src/ui/deviceChoice.ts`.
- **Every IndexedDB write also goes through this choice**, via `openDb` in `ScenePersist.ts:557`. The service worker registration also follows it (`src/ui/serviceWorker.ts`).

**localStorage keys in use** (all through `deviceStore`):
- `bozzetto-settings`
- `bozzetto-keymap`
- `bozzetto-recent`
- `bozzetto-version`
- `bozzetto-splash-seen`
- `bozzetto-signed-in`
- `bozzetto-sign-in-expiry-told`
- `bozzetto-present-speed`
- `bozzetto-open`
- `bozzetto-no-sw`
- `bozzetto-account-deleted`
- `bozzetto-share-note:<userId>`
- `bozzetto:blockout-parts`
- `bz.reference.show`
- `bz.scale.notnow.*`
- the gizmo and paint-tool memories
- **`bz.rigs`**

All are small strings. The largest is the rig list: at most 100 rigs, each a few hundred bytes of JSON. There is no size measurement anywhere.

**IndexedDB.** Database `bozzetto-sculpt`, version 4 (`ScenePersist.ts:372,564`), stores `scene` (autosave `current`, `currentSnapshot`, `currentLook`, `currentStatus`), `library` and `libraryData` (the local scene library, split into metadata plus data because "tens of megabytes" of vertex payloads), and OBJ hand-off records (`objHandoff`). The scene payloads are the multi-megabyte part; the code says so but gives no figures.

**Cache API:** `bozzetto-thumbs`, `bozzetto-env`, `bozzetto-community`, `bozzetto-my-projects`, `bozzetto-me`, `bozzetto-config`, `bozzetto-whoami`, `bozzetto-quadriflow`, `bozzetto-projects`, and the precache (about 20 MB per `vite.config.ts` comment).

**Quota handling.**
- The autosave handles `QuotaExceededError` by disabling itself and telling the panel (`ScenePersist.ts:1029-1035`; `PublishWindow.showAutosaveStopped`, line 163).
- **No device storage meter and no `navigator.storage.estimate()` or `persist()` anywhere** (grep returns nothing).
- The "storage meter" in `src/ui/account/myProjects.ts:289-335` is the **server-side account quota** (`GET /api/me` usage `{used, reserved, quota}`), not the device.

**How the rig library follows the choice.** `myRigs()` reads through `deviceStore.get`, so it reads as an empty list unless `keep`. `saveRig`, `renameRig` and `deleteRig` end in `deviceStore.set`, which throws `DeviceStorageOff` and returns false. The UI then shows "keeping things on this device is off". Within one tab session with saving off, a saved rig is not even kept in memory. A rig import still applies to the lights.

---

## 7. The Community, client side

**Files:** `src/ui/community/{page,share,star,credit,review,reviewActions,reviewViewer}.ts` and `src/net/community.ts`. Address forms are in vite's navigation allowlist comment (`vite.config.ts:208-212`): `/?community`, `/?u=<handle>`, `/?review`, `/?tl=<id>`, `/?me`.

**Page** (`page.ts`).
- `renderCommunity(app, handle|null)`.
- 24 cards a page with "Load more", driven by a cursor.
- Sort select: Newest (default), Oldest, Most viewed, Most starred (`COMMUNITY_SORTS`, `net/community.ts:90`).
- Search over titles and `@handle`, limited to `MAX_SEARCH = 100` characters, debounced 300 ms.
- Sort and `q` are kept in the address with `replaceState`.
- Author page `/?u=<handle>`: search titles only; no such member shows "No such member".
- Accounts off shows "The Community is not open on this site".
- Offline, the service worker shows the last guest list (NetworkFirst, 4 s timeout, only responses with `cache-control: public, max-age=60`).

**Card** (`communityCard`, `page.ts:253`).
- 4:5 picture, title, `@author` link, mode word, day shared.
- **Mode label map is only `{model, timelapse}`** (`page.ts:241`); any other mode shows as "model".
- Star toggle in the picture's corner for a signed-in member who is not the author (`star.ts`, `POST /api/me/stars/:id`).
- A card opens `/?tl=<id>&from=...` (view only).
- **No counts are shown to the public.** The author sees views and stars on My projects, reviewers on the Review page.

**CommunityItem shape** (`net/community.ts:15`): `{id, title, mode, fps, shared_at, author:{handle}, thumb, media, starred?}`. `thumb` is validated to be a path or http(s) URL.

**Starred.** My projects "Starred" tab (`starredPage`, `GET /api/me/stars`).

**Report.** `credit.ts` (`mountCommunityCredit`): in the viewer for a work from the Community, "by @handle", a Moderation menu with "Report…" for a signed-in non-author, a Star in the strip, and for owner or moderators a "Review" entry. Reasons: nudity, minors, stolen, spam, other, with an optional note up to 500 characters (`REPORT_REASONS`, `functions/_shared/community.ts:40`).
- `recordView(id)` posts a view when the work is opened.
- Guests get no Report and no Share (the terms name an address to write to).

**Review and moderation.** `/?review&tab=queue|gallery|reports|history` (`review.ts`, `reviewActions.ts`), and review mode `/?tl=<id>&review=1` (`reviewViewer.ts`). The owner and moderators only. Actions: approve, reject (reason), hide (reason), unhide, dismiss.
- `review.ts:368`: kind label is "Timelapse" if `timelapse`, else "Model".

**What can be shared.**
- `shareable(p) = p.mode === 'model' || p.mode === 'timelapse'` (`share.ts:48`).
- A scene or an armature shows the hint "Publish a model of it to share it."
- Armature, scene or any asset kind is not shareable.

**Share to Community from My projects.**
- `shareControls` (`share.ts:68`) renders a single "Share to Community" checkbox on a card, with a status line (Pending review / Public in Community / Rejected: reason / Hidden, under review).
- On the first share per account on this device, a note is shown (`firstShareNote`, remembered under `bozzetto-share-note:<userId>`).
- It then calls `shareProject(id, on)` in `net/account.ts`. Withdrawing asks first when public or hidden.
- Cards are disabled offline or with no frames.
- A 429 says "as many projects as a day allows".

**Opening or copying something from the Community.**
- It is **view only**: the viewer offers nothing to copy or download (`page.ts` header; `docs/accounts.md:767`).
- "New sculpt from this" exists, but only for **templates**. `File > New sculpt from this` in the viewer of a template (`src/viewer/newSculpt.ts`) sends the visible frame as OBJ through the IndexedDB hand-off and navigates to `/?sculpt=1&obj=1`. Whether it is also offered from the Community page I did not check. `credit.ts` and `newSculpt.ts` are the places to look.
- Templates are the owner's public projects (`template = 1`, `visibility = 'public'`). A scene template opens as a copy at `/?sculpt=1&template=<id>` and an armature template at `/?armature=1&template=<id>` (`Landing.ts:676-683,776-797`). `main.ts:243` offers it for models and timelapses.
- So the only "pull something from the site into my own work" path today is templates, which only the owner can make.

---

## 8. The Community, server side

**Storage.**
- **D1** (binding `DB`) for rows. Migrations `migrations/0001`-`0005`:
  - `projects` has the shared columns `shared`, `shared_at`, `reviewed_at`, `reviewed_by`, `review_reason`, `views`, `stars`, plus `owner_id`, `template`, `storage_prefix`, `bytes`.
  - Tables: `users`, `credentials`, `sessions`, `pending_auth`, `invites`, `pending_uploads`, `upload_parts`, `audit_log`, `rate_limits`, `reports`, `stars`, `view_marks`, `retired_handles`, `dev_outbox`.
- **R2** (binding `BUCKET`) for files. Key is `users/<uid>/projects/<id>/<file>` for members, or legacy `projects/<id>/<file>`.
- No KV. `wrangler.toml.example` shows only D1 and R2.
- The Cache API is used for open media. Details are in the `media.ts` header comment.

**Routes under `functions/`.**
- `api/community/[[path]].ts` is GET `/api/community` (list). `api/community/u/[handle].ts`, `api/community/[id]/report.ts`, `api/community/[id]/view.ts`.
- `api/me/*`:
  - `projects` (list and create at `index.ts`, `[id].ts`, `[id]/{armature,frames,scene,share,thumb}`)
  - `stars` (`index.ts`, `[id].ts`)
  - `media`, `export`, `delete`, `account`, `passkeys`, `sessions`, `email`
- `api/mod/*` (`queue`, `reports`, `shared`, `history`, `counts`, `projects/[id]`, `projects/[id]/review`, `media`).
- `admin/api/*` (owner tools: `projects`, `projects/[id]/{armature,frames,scene,template,thumb}`, `users`, `invites`, `audit`, `media`, `owner/bootstrap`). `functions/admin/login.ts`.
- Media: `media/[[path]].ts` and `m/[[path]].ts` (open routes). `public/_routes.json` includes `/api/*`, `/admin/api/*`, `/admin/login`, `/media/*`, `/m/*`.
- Auth: `api/auth/*` (email code or link, WebAuthn passkeys, register, invite, handle check).
- Public lists: `api/projects/index.ts` and `[id].ts` (templates and manifests).
- Dev-only `api/dev/*` routes also exist.

**Roles and accounts.**
- `owner` (unique, partial unique index), `moderator`, `member` (`UserRow`, `types.ts:111`); status `active` / `suspended` / `deleting`.
- Reviewers are the owner and moderators (`requireModerator`, `auth/permissions.ts`).
- A moderator cannot act on their own project; the owner can review their own, and the owner's shares go public at once and stay public through edits (`UNLIST`, `projects.ts:~118`).
- Account sign-in is passkeys and email. Join has Turnstile and an invite.

**Sharing state machine.** `functions/_shared/community.ts` header (lines 14-30):
- `none` -> `pending` -> `public` (approve) / `rejected`.
- `public` -> `pending` on any member write of content or title.
- `public` -> `hidden` (reviewer, or HIDE_AFTER = 2 distinct members' open reports).
- `hidden` -> `public` (unhide); anything -> `none` (withdraw).

**Listing and search.**
- `listCommunity`, sort `new|old|views|stars` with a base64url JSON cursor.
- Page of 24 (1 to 48).
- `q` matches the title or the author's handle using `instr(lower(...))` (not LIKE; D1 refuses long LIKE patterns), and `@name` matches the handle only.
- No session cookie gives `public, max-age=60` and `Vary: Cookie`; a signed-in member gets `private, no-store` plus `starred` per card.
- Only rows with `OPEN` are listed: `shared = 'public'` and an active author, or a listed template (`projects.ts:~100`).
- A card's `thumb` is `<media>/thumb.jpg?v=<updated_at>`.

**Modes the server accepts.**
- Type: `ProjectMode = 'timelapse' | 'model' | 'scene' | 'armature'` (`functions/_shared/types.ts:6`).
- Runtime list: `PROJECT_MODES` (`projects.ts:74`); `isFileMode` (`:76`) for scene and armature.
- `createMemberProject` rejects anything else with a 400 (`projects.ts:492`). `createProject` (owner) silently falls back to `timelapse` (`:~418`). A patch can change mode only between model and timelapse, and not for file modes (`:616`).
- **Sharing is limited separately:** `SHARE_MODES = ['model', 'timelapse']` (`community.ts:34`), enforced at `community.ts:353`, which gives a 400 with `reason: mode`.
- **File names are a fixed set:** `PROJECT_FILE = /^(scene\.bozz|armature\.json|thumb\.jpg|frames\/sd\/\d{4}\.glb)$/` (`projects.ts:59`). Nothing else is stored or served; the key is never taken from the URL.

**Upload validation (`functions/_shared/content.ts`).**
- Everything is checked in memory before R2 sees a byte.
- Scene: first part is gzip (`1f 8b 08`) or `BOZ1`. Its header is inflated (at most 1 MiB, `MAX_SERVER_HEADER`), read with `readLayout` and `checkHeader` from `shared/bozz.ts`, and the gzip trailer on the last part must equal the size the header states. Errors: 415 `bad_type` and 422 `bad_scene`.
- Thumbnail: only checks the first bytes are `FF D8 FF` (`checkThumb`). **Nothing checks its dimensions or that it decodes.** Size is capped at 1 MiB.
- Frame: glTF binary, plain or gzipped; header magic, version 2, and the declared length equal to the real length.
- Armature (`checkArmatureFile`): gzip or plain JSON of at most `ARMATURE_MAX_BYTES = 4 MiB` unpacked. It must be UTF-8, one object, `v === 1`, a known figure (`ARMATURE_FIGURES` list in `shared/armature.ts`), no `__proto__` key, nesting depth limited, and `units` absent or `cm`/`m`. This is the only existing "small JSON file" kind and the closest model for a tool, material or rig.
- Served content type is chosen from the file name, never the stored type (`media.ts:~20`). Responses carry `x-content-type-options: nosniff` and `content-security-policy: default-src 'none'; sandbox`.

**Limits (`functions/_shared/config.ts`, `MEMBER_LIMITS`).**
- Scene file 100 MiB; upload part 8 MiB (maximum 32 MiB); frame 32 MiB; thumbnail 1 MiB.
- 500 projects per account; 10,000 frames per project; quota 500 MiB for a member (owner 10 GiB per the comment); 10 passkeys.
- Per-project JSON `data` is at most 1,500,000 bytes (`MAX_DATA_BYTES`).
- Title at most 200 characters.
- Rate limits (D1 `rate_limits`, `auth/ratelimit.ts`): 20 shares a day per account, 10 reports a day, 200 star changes a day, view counts 300 an hour per IP. Auth limits include 3 mails per 15 minutes per address and 5 registrations an hour per IP.
- I found **no rate limit on uploads or project creation** beyond the 500-project cap and the quota (grep for `enforce(` outside auth finds only share, report and star).
- The Workers Free subrequest limit of 50 is mentioned as a design constraint (`quota.ts`, recount).

**Adding a new kind: what the armature mode touched.** Server, files mentioning `armature`:
- `functions/_shared/types.ts` (the type)
- `functions/_shared/projects.ts` (the `PROJECT_FILE` regex, `PROJECT_MODES`, `isFileMode`, `newSceneId` prefix, the 400 message, patch rule)
- `functions/_shared/armatureFile.ts` (new; storing, quota reserve and refund, `updated_at`, `UNLIST`)
- `functions/_shared/content.ts` (`checkArmatureFile`)
- `functions/_shared/media.ts` (`Kind`, `kindOf`, `TYPES`, cache rules at lines 91 and 352, download suffix at 376)
- `functions/_shared/http.ts` (`bad_armature` error code)
- `functions/_shared/community.ts` (comment and `SHARE_MODES` exclude it)
- `shared/armature.ts` (new; limits and parser shared with the client)
- routes `functions/api/me/projects/[id]/armature.ts`, `functions/admin/api/projects/[id]/armature.ts`
- comments in `functions/api/me/projects/index.ts` and `functions/admin/api/projects/index.ts`
- `functions/api/me/export.ts` also reads `PROJECT_FILE`, so a new file name flows into "Download my data"
- no migration was needed ("mode has no CHECK", `0002_visibility.sql`)
- tests: `tests/functions/suites/armature-projects.mjs` and `content.mjs`, `media.mjs`, `uploads.mjs`
- `docs/accounts.md` lines 399-401 and 335

Client, files naming the armature mode in project lists:
- `src/admin/api.ts:41` (type comment only), `src/admin/main.ts:301`
- `src/ui/Landing.ts:159,163,776-808`
- `src/ui/account/myProjects.ts:357-370,422-429,577-589`
- `src/ui/community/share.ts` (not shareable)
- `src/main.ts:54,61,406` (boot and open)
- `src/net/account.ts` (mode is typed `string`)
- armature-side readers and writers under `src/armature/` (`project.ts`, `persist.ts`, `file.ts`)

**What a new "small JSON" kind (tool, material, rig) would need, going by that path, and what is awkward.**
- A new mode, or a new file name in `PROJECT_FILE` plus a `Kind`, a `TYPES` entry, a content check and a size cap. Plus the type, `PROJECT_MODES`, the 400 message and the patch rule.
- The route, quota reserve and refund code, and the client's save and list code would be copied from the armature path.
- **The community list is built on projects:** each card needs a `thumb.jpg`, a title and an `author`, and the viewer opens `/?tl=<id>`. A material, rig or tool would need a thumbnail and a way to be fetched, not viewed.
- **The share path** moves the file in place (nothing is copied; `shared = 'public'` on the owner's own row). A "pull to my device" for a shared asset would need a new download route. Today the open media route serves `scene` only as a download and the public never gets a copy of anyone's files; the policy is written into the first-share note and the terms.
- **A large binary (HDRI):** a frame's cap is 32 MiB and a scene part is up to 32 MiB with R2 multipart up to 100 MiB. An HDRI would fit a "single-file kind" under 100 MiB. There would be no existing validator for Radiance headers, so `content.ts` would need one (magic `#?RADIANCE`, `FORMAT=32-bit_rle_rgbe`, a `-Y h +X w` line, sane dimensions). It would count against the 500 MiB quota.

---

## 9. Licensing and credits

- `LICENSE` at the root: MIT, for Bozzetto itself.
- `THIRD_PARTY_NOTICES.md` is the full legal record. It has sections Code, Fonts, "Models and images" with subsections "Human Base Meshes (Blender Studio)", "Environment maps (HDRIs)" and "Other images", plus the `Uicons by Flaticon` entry under Code (line 145).
- In-app credits: `src/help/credits.ts` (`CREDIT_GROUPS`), shown in the Help window's About and credits topic (`ABOUT_TOPIC = 'about'`, `src/help/HelpWindow.ts:42`). The header says an e2e check reads `THIRD_PARTY_NOTICES.md` and fails if a credit name is not a heading there.
- **HDRIs:** "The six environment maps ... are from Poly Haven, CC0 1.0 ... resized for the web and saved again from Adobe Photoshop" (`THIRD_PARTY_NOTICES.md:718-731`; `credits.ts` "Environment maps (HDRIs)"). The files' headers do say "Made with Adobe Photoshop" (checked for interior-warm and plaza). **The repo does not record which Poly Haven asset each file is** (no names, URLs per file, or authors).
- **Matcaps:** "`vr01.png` to `vr10.png` ... are the owner's own work. `clay.png` is generated by `scripts/generate-sample.mjs`" (`THIRD_PARTY_NOTICES.md:735`). `matcaps.ts` comment calls them "owner-supplied, Blender format". No licence file in the matcaps folder, and no per-file licence text.
- **Mannequins and base meshes:** Blender Studio Human Base Meshes v1.4.1, CC0, with `public/assets/basemeshes/LICENSE.txt` and `public/assets/armature/LICENSE.txt`.
- **Fonts:** OFL 1.1, licences in `public/assets/fonts/licenses/`.
- **Icons:** Uicons by Flaticon, free licence with attribution (credits note "Icons: Uicons by Flaticon").
- Nothing in the repo describes a licence for **user-supplied or Community-shared assets**, other than the content policy and terms pages (`public/legal/terms.html`, `privacy.html`) and the first-share note ("All rights stay with the authors", Community page tagline).

---

## 10. Tests that cover these areas

E2E (`tests/e2e/run.mjs`, one suite per exported function; `node tests/e2e/run.mjs <suite>`):
- **Rig library:** `tests/e2e/lookTabs.mjs`, suites `lookRigs` (each built-in rig applies; Rig select groups), `lookRigLibrary` (Save, rename, delete with cancel, export `.bozzrig` file name and JSON shape, import, malformed and wild files refused, `localStorage['bz.rigs']`), `lookTabs` (tab sets per workspace; the three buttons exist on Lighting; Sculpt default rig `key_only`), `lookViewer`, `lookMoveLight`.
- **Matcap choice:** `tests/e2e/material.mjs`, suites `material` (Mode select to Matcap changes the viewer and the gallery appears, lines 164-167), `materialNoObject`, `materialArmature`, `materialPresent`. No test for the 2-9 keys or for `matcapIndex` clamping was found.
- **HDRI choice:** `tests/e2e/smoke.mjs`, suite `envScale` (line 7166; the HDRI select set to `studio-neutral`, Intensity range 0..2 and default 1, the `v: 2` record, old-record rescale, plate brightness) and the Intensity checks near lines 6220-6276 (inside a suite I did not name; it is above `envScale`, inside `typedArmature`'s neighbourhood). There is no test of the list of six environments or that each file loads.
- **Community page and sharing:** `tests/e2e/community.mjs` suite `community` (the full path: Share with the first-share note, queue, approve, listing, Report, auto-hide at two reports, owner share, search and sort, stars, views, Starred tab), `tests/e2e/accounts.mjs` suite `accounts` (My projects, share switch), `tests/e2e/pages.mjs` suite `pages`.
- **Windows:** `tests/e2e/askWindow.mjs` (`askWindow`), `tests/e2e/help.mjs`, `tests/e2e/deviceStorage.mjs` (`deviceStorage`), and Publish window checks in `shell.mjs`, `present.mjs`, `presentEdges.mjs`, `latency.mjs`, `smoke.mjs`.
- **Armature project path:** `tests/e2e/armatureProjects.mjs`, `armatureSuspend.mjs`.

Function (server) suites in `tests/functions/suites/`:
- `community.mjs`, `community-stats.mjs` (list, cursor, search, share and its limit, UNLIST flip, reports, review actions, roles)
- `content.mjs` (upload type checks), `uploads.mjs`, `media.mjs`, `media-private.mjs`, `quota.mjs`, `limits.mjs`, `ratelimit.mjs`
- `armature-projects.mjs`, `templates.mjs`, `templates-list.mjs`, `export.mjs`
- `migration.mjs`, `deletion.mjs`, `isolation.mjs`, `visibility.mjs`, `routes.mjs`

Not found: any unit test of `rigLibrary.ts` on its own (it is exercised through the browser suites), and any test of `Environment`'s loading of a bad or user file.

---

## The ten facts that most constrain a shared Asset library with a Community tab

1. **The Community is a list of projects.** A card is a project row (`projects` with `shared='public'`) with a `thumb.jpg`, a `mode` and an `author`. Cards open the viewer at `/?tl=<id>`, view only, and the server's stated policy is that nothing of another member's is copied or downloaded (`docs/accounts.md:767`, `share.ts` first-share note, `page.ts` header). "Pull from the Community" needs a new download route and a change to that promise and to the terms.
2. **The server accepts exactly four project modes** (`timelapse|model|scene|armature`), and only two can be shared (`SHARE_MODES = ['model','timelapse']`, `community.ts:34`). The mode and file-name set is spread over at least 8 server files (`types.ts`, `projects.ts` in 5 places, `media.ts` in 6, `content.ts`, `http.ts`, `community.ts`, `armatureFile.ts`, `shared/armature.ts`, two routes) and the client's lists in `Landing.ts`, `myProjects.ts`, `share.ts`, `page.ts:241`, `review.ts:368`, `main.ts`. Several of them silently fall back to "model" or "timelapse" for an unknown mode.
3. **Files are a closed set.** `PROJECT_FILE` allows only `scene.bozz`, `armature.json`, `thumb.jpg` and `frames/sd/NNNN.glb`. Each file kind has its own content check; the thumbnail check is magic bytes only (`FF D8 FF`) with a 1 MiB cap, no decode.
4. **Quota and limits are per account and per project.** Member quota 500 MiB, 500 projects, thumbnail 1 MiB, frame 32 MiB, scene 100 MiB, armature JSON 4 MiB unpacked. Shares are 20 a day, reports 10, stars 200; no upload rate limit. A small JSON asset as its own project would burn one of the 500 project slots and one thumbnail each. The D1 `projects.data` column is capped at 1.5 MB.
5. **HDRIs are 1.5 to 1.7 MB each (1024x512 Radiance `.hdr`), six of them; only `studio-neutral.hdr` is precached.** The others are cached after first use (`CacheFirst`, 8 entries, 90 days). The list is a hard-coded array and ids are the only thing a look stores. A user HDRI has no loader path, no id scheme in looks, and no limit on size or dimensions (the folder README's "2k, 4 to 10 MB, EXR" is out of date). The PMREM work is done on the main thread's renderer at load, with no recorded time or memory figure.
6. **Matcaps are ten fixed 512x512 PNGs (about 90 KB each), all precached and all fetched when `Materials` is built; looks store a numeric `matcapIndex`.** The keys cover only the first eight. Adding, removing or reordering would change saved looks, so user matcaps need ids, not indices. They are the only precached assets in the library, so they define the "offline" baseline. A matcap ignores albedo, paint, roughness, metalness and lights.
7. **Materials are scene data, not assets.** A material is `{id m<N>, name, albedo, roughness, metalness}` with ids local to a scene; objects are bound by index in the file. There is no ready-made set, no device store, no rename or delete UI, and editing a material changes it for every object that uses it. Importing one means creating a new `m<N>` id in the target scene and assigning it.
8. **The rig library is the one finished model.** `.bozzrig` v1 JSON, 64 KiB cap, per-field validation with clamping, 100 rigs, localStorage `bz.rigs` through `deviceStore` (so it follows keep/declined/none), `bozzetto:rigs-changed` event, shown in three places (Present's Lighting tab, Sculpt's Present, the public viewer select only). Anything new for the library should copy its shape. Rigs are not stored in looks by name.
9. **`deviceStore` is all-or-nothing and small-data only.** With saving off nothing is written or read (even a rig saved this session is lost), and writes throw `DeviceStorageOff`. localStorage holds only small strings. There is no storage estimate, persist request or device meter anywhere, and IndexedDB (`bozzetto-sculpt` v4, stores `scene`, `library`, `libraryData`) is the only place for large device data. Any large binary kept on the device (an HDRI, a matcap image) must go in IndexedDB or the Cache API, and it must go through the same choice. The "storage meter" in My projects is the server quota only.
10. **Window frame: only `float-window` (PublishWindow) is movable and non-modal.** It has a title bar drag, clamping, `touch-action: none`, z-index 20 and its position in `sessionStorage` only. It has no tabs and is hard-wired to one chip and one slot. Everything else is modal (`has-modal`, z-index 40 or 200): Preferences, Help, `askWindow`, device question. Any rename, delete or replace question asked from a library window will take over the page and stop hotkeys while it is up. The rig library already does this with `askWindow`/`askText`/`tellWindow`. Also: `docs/plans/asset-library.md`, named in `docs/HANDOFF.md:14`, does not exist yet. The CSP is Report-Only, so it would not block a user's file but also gives no protection yet. HDRI, matcap and rig credits exist only as one paragraph each in `THIRD_PARTY_NOTICES.md` and `src/help/credits.ts`, with no per-file source for the HDRIs and no licence file for the matcaps.
