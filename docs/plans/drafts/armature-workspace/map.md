# Armature and Sculpt: what the code does today (read-only map of the repository at 6168830, 2026-11-18)

Nothing was edited. Paths are relative to the repo root. "mode.ts" means `src/armature/mode.ts` (2436 lines) or `src/sculpt/mode.ts` (2902 lines), as named.

## 1. Entry and boot

**Routing is `src/main.ts` only, and it routes just two addresses.**
- Lines 43-58: `workspace = (!id && (sculpt=1 || armature=1)) || (id && present=1 && review!=1)`. A workspace awaits `ensureDeviceChoice()` first.
- Line 59: `!id && sculpt=1` calls `bootSculpt()` (line 164).
- Line 63: `!id && armature=1` calls `bootArmature()` (line 411).
- If both flags are present, Sculpt wins because it is tested first.
- Every other mode string below is read inside the mode itself, not in `main.ts`.

| Parameter | Where read | Notes |
|---|---|---|
| `?project=`, `?template=`, `?scope=admin` | each mode separately | Sculpt: `sculpt/mode.ts:150-153`, `openProjectAtBoot` / `openTemplateAtBoot`. Armature: `armature/mode.ts:190-215`, `fetchArmatureProject` / `fetchArmatureTemplate`. Both strip the parameters with `history.replaceState` once read. Both ask "Open X? work in progress will be replaced" unless `takeOpen()` (`ui/openToken.ts`) says the card already asked. |
| `?lib=`, `?obj=1` | Sculpt only | `sculpt/mode.ts:150`, `:298` (OBJ through `bridge/objHandoff`). |
| `?handoff=1` | Sculpt only | `sculpt/mode.ts:2298`. |
| `?scene=1` | Armature only | `armature/mode.ts:207`. Sculpt's Armature step sends it. |
| `?paint=1` | Sculpt only | `sculpt/mode.ts:2468` calls `enterPaint()`. `setPaintAddress` (`:1655-1665`) writes and clears it with `replaceState`. |
| `?from=` | `ui/origin.ts` | Where File > Close goes. The hand-off addresses (`/?sculpt=1&handoff=1`, `/?armature=1&scene=1`) do not carry it. |
| `?tl=<id>&sculpt=1` | `main.ts:239-262` | A dev spike that mounts Sculpt over a project's viewer. |
| `?tl=<id>&present=1` | `main.ts:128-146` | The owner's Present page for a published project. It is a different thing from Sculpt's Present workspace (`present/open`). |

**Both boots are identical in shape.**
- Show `SculptSplash`.
- `sculptStandaloneProject()` (`sculpt/standalone.ts`) builds a synthetic one-frame manifest with a placeholder cube.
- `mountViewer(viewport, manifest, source, setStatus)` returns a `Viewer`.
- `addGalleryLink()`, then `mountSculptMode(viewer)` or `mountArmatureMode(viewer)`.
- Both functions are typed `(viewer: Viewer): Promise<() => void>`. Neither receives an app element, a strip or a shell. Each builds its own `TitleStrip`, panels and menus and appends them to `document.body`.
- `main.ts:184`, `:260` and `:433` discard the returned disposer, so the app never calls it.

**Globals**
- `window.__bozzetto` is the `Viewer`, set at `viewer/mountViewer.ts:78`. `present/workspace.ts:267` deletes it.
- `window.__sculpt` is set at `sculpt/mode.ts:2388` and deleted in the disposer at `:2485`.
- `window.__armature` is set at `armature/mode.ts:2368` and deleted at `:2430`.
- `mountViewerParts` also builds, per page: `Help`, `FpsMeter`, the stall log, `installShortcuts` and `pageChrome()`. It builds no `LookPanels`, because `opts.look` is not passed.
- Sculpt builds its own `LookPanels` at `sculpt/mode.ts:2019`: owner `sculpt`, tabs lighting/camera/render, shown only in Present (CSS at `shell.css:1156`).
- Armature has no `LookPanels`. Its panels are Armature, Material and Reference (View menu list at `armature/mode.ts:2056-2060`).

## 2. The Viewer

**Both pages use the same `Viewer` class instance type.** The same standalone project is booted, so a merge would not need a second viewer. What each mode does to it:

| Aspect | Sculpt | Armature |
|---|---|---|
| Subject | `viewer.enterSculpt(...)` (`mode.ts:396`) swaps `display.geometry` and sets `inSculpt` (`Viewer.ts:2963`). Extra objects go through `addSculptExtra`. | Never calls `enterSculpt`. `viewer.setSculptVisible(false)` hides the cube (`:334`). `viewer.adoptMesh(armature.mesh)` (`:329`, `Viewer.ts:1175`) puts the SkinnedMesh in `sculptExtras` and the scene. |
| Floor | `lockFloor(session.getUnits() ? 0 : null)` (`:384`). Null follows the subject for old scenes. `setGround('off')` (`:588`). | `lockFloor(0)` (`:167`), then `lockFloor(armature.bounds().min.y)` per figure (`:313`, `holdFloor`). Always fixed. Leaves the ground mode alone. |
| Disposers | Restore the floor with `lockFloor(viewer.manifestFloor())` (`:2578`). | Restore the floor with `lockFloor(viewer.manifestFloor())` (`:2407`). |
| Shadows / lights | Fill and rim lights disabled, shadows master on (`:459-465`), `scene.environment = null` (`:467`). | `lighting.keyOnlyShadows = true` (`:177`). Fill and rim stay on but do not cast (`Lighting.ts:306`, `:411`, `:423`, `:679`). Environment kept. |
| AO / pipeline | `setAO({enabled:false})` (`:469`) and `setSculptShading(true)`, which switches to the cavity composite and drops GTAO and DoF (`Viewer.ts:3021`, `:3360-3375`). DoF off (`:462`). | Touches neither. It runs the viewer pipeline (GTAO and DoF as the look says). Handle quads write an MRT with `normal` and `wire` set to 0 so AO is not darkened (`handleViews.ts:295`). |
| Materials | Clay albedo, roughness, flat shading, `setSculptVertexColor`, `setSculptVertexPBR` (`:470-490`). Per-object materials via `MaterialLibrary`. | `MaterialPanel(viewer, {sculpting:true})` over the shared display material. The geometry carries white `color` and a `materialsPBR` attribute so the sculpt shaders can read it (`Armature.ts:343`). |
| Fast frames | `fastFrames = true` (`:1362`), probe says stroke or move. | `fastFrames = true` (`:848`), probe says move while `dragUnderway()`. |
| Shadow and subject bounds | `setShadowSubject(...)` supplies every visible object's octree bound (`:407`). | `fitSubject(box)` (`:352`) measures `skinPad`. `Viewer.liveShadowBox` uses the bone box only when no `shadowSubject` is set (`Viewer.ts:2913-2920`). |
| Frame hooks | `viewer.onTick`, `viewer.onPostControls`, `setZoomFocus`, `lighting.setRigFollow` (`:922-935`, `:1106`). | None of these. |
| `tapToFocus` | Set false at `:779`, restored true at `:2559`. | Set false at `:182`, never restored. |
| Look | The look lives under its own autosave key (`loadSculptLook`). A scene opened explicitly brings its `.look`. | The look rides inside `ArmatureFile.look` (`armature/mode.ts:1399`). |

**What would collide on one viewer at once**
- `setSculptVisible` is called by Sculpt's `reconcile()` (`:683`, visibility of the primary display). It would fight Armature's `setSculptVisible(false)`.
- `lockFloor` has two policies. `shadowSubject` wins over the skinned bone box, so the figure would drop out of the shadow fit.
- Sculpt's cavity pipeline against Armature's GTAO pipeline. Sculpt turns off fill and rim lights and the environment. Armature relies on them.
- `fastFrames` and `interactionProbe` are one slot each. `chrome.onChange` is one slot (`pageChrome()` is shared).
- `viewer.materials.onAlbedoChange` and `onPbrChange` are claimed by Sculpt (`:512`, `:540`).
- The `sculptExtras` list is shared, and `Viewer.skinnedSubjects()` reads it.

## 3. What Armature mode owns

**The figure (`src/armature/Armature.ts`, 2203 lines)**
- Rigs are `RigDefinition` from `rig.ts`: two block presets (`placeholder-male` and `placeholder-female`, 13 `part:` entries) and four mannequin GLBs (`figures.ts`, `/assets/armature/<id>.glb`, loaded by `glbRig.ts`).
- There is one `SkinnedMesh`, named `armature` (`Armature.ts:~316` for imports and `:375` for blocks). Parts are not separate meshes: each part is a box merged into one geometry, skinned to a `<bone>:part` bone, so proportions live on part bones.
- `userData.locked = 0`, `frustumCulled = false`, and `mesh.add(this.root)`.
- It enters the scene only through `viewer.adoptMesh` (`mode.ts:329`, `:1558`, `:1534`). `replaceFigure` (`:1516`) disposes the old `Armature` and adopts a new one.
- `SCENE_SCALE = 100` (a centimetre per unit).

**Handles and overlay (`handleViews.ts`)**
- `HandleKit` draws ring, box, arrow, dash and floor shapes as camera-facing quads with shader strokes in CSS pixels.
- In the scene, `viewer.scene.add(handleGroup)` (`mode.ts:637`) and `plantGroup` (`:~660`), plus three `TransformControls` helpers.
- `setHandleViewport` (`handleViews.ts:114`) is module-global.
- `ResizeObserver` on the canvas (`mode.ts:644`).

**Gizmo**
- Three `TransformControls`, for rotate, move and scale (`:379-395`), with a scale proxy and a root proxy.
- They are separate from Sculpt's `TransformGizmo` (`bridge/transform`).

**Panels**
- `ArmaturePanel` extends `SidePanel` (id `armature`, left; `ArmaturePanel.ts:42-77`). It holds Figure, joint, part, handles, plant, and a "Send to Sculpt" section with a resolution slider, default 120 (`:55`).
- `MaterialPanel` (id `material`, right), and `ReferencePanel` / `ReferenceView` / `ArrangeButton`. The board is `ReferenceBoard('armature')`, stored under `refs:armature`. Sculpt's is `refs:sculpt`.
- The panel ids `material` and `reference` are the same strings Sculpt uses. `panelMemory.panelIsOpen` takes the first DOM match, and `panel-set` events open both.

**Title strip menus (`mode.ts:1951-2072`, shared `menuShape` / `viewMenu` / `recentMenu`)**
- File: New armature, Open…, Open recent, Rename…, Save file, Save to library or Sign in, Load model…, Send to Sculpt, Close. Its own `TopMenu`, not Sculpt's `FileMenu`.
- Edit: Undo, Redo, Paste picture, Preferences.
- View: frame all, wireframe, shadows, details, move light, references, panels, Hide interface, and the workspace list.
- Help: `helpMenuItems()`.
- Workspace path (`workspaceNow`, `:1900`): current `armature`; Sculpt step runs `send(panel.resolution)`. Paint and Present steps are `{unavailable: 'Paint works from Sculpt. Go to Sculpt first.'}` (and the same wording for Present).

**Keymap and dispatch**
- 15 rows with `mode:'armature'` (`ui/keymap.ts:166-184`), including `arm.symmetry` x, `arm.move` w, `arm.rotate` e, `arm.gizmo` t, `arm.scale` r, `arm.resetPose` shift+r, `arm.deselect` Escape, `arm.send` ctrl+enter, `arm.light` hold l, and `arm.undo` / `arm.redo` with `sameKeyAs` Sculpt's.
- Dispatch: `window.addEventListener('keydown', onKey, true)` at `:2172`. It calls `keymap.actionFor(e,'armature')`, and keys it does not own fall through with `default: return` to the viewer's shortcuts.
- Sculpt binds the same chords for different actions: x brush symmetry, w/e/t/r gizmo. They never clash today only because only one mode is mounted. `KeyMode` is `'sculpt'|'view'|'armature'|'paint'` (`keymap.ts:19`).

**Undo history**
- Local, in `mode.ts` `:1286-1368`: `undoStack` / `redoStack` of `JSON.stringify({s: armature.serialize(), y: symmetry})` strings, `HISTORY_LIMIT = 100`, `commit()`, `commitSoon()`, and a 400 ms slider settle.
- Buttons are `HistoryButtons` in a `div.bz-edge` appended to `document.body` (`:1382-1386`).
- It is entirely separate from `session.getStateManager()` in Sculpt. Sculpt's own `.bz-edge` is `BrushSliders.root` (`BrushSliders.ts:172`), so a second `.bz-edge` would exist.

**Details overlay.** `new DetailsOverlay()` (`:2074`), name / height / tris / joint lines, repainted on a 500 ms `setInterval` (`:2094`).

**Body classes.** Armature adds none of its own. `TitleStrip` adds `bz-shell` (`TitleStrip.ts:158`), and `.armature-hist` is styled in `shell.css:1120`.

**Listeners (all added once, never removed while the page lives)**
- Window: `pointerup` (`:1283`), `pointercancel` (`:1284`), `bozzetto:look-reset` (`:1485`), `pagehide` (`:1493`), `keydown` (`:2172`), `keyup` (`:2177`), `blur` (`:2184`).
- Document: `input` (`:1476`) and `change` (`:1477`).
- Canvas: `pointerdown` (`:1281`) and `pointermove` (`:1282`).
- A `beforeLeaving` store (`:1504`), `onDeviceChoice` (`:1433`, never unsubscribed even in the disposer), `settings.onChange` x2, a 500 ms `setInterval`, and a `ResizeObserver`.
- Two hidden `<input type=file>` appended to `body` (`:1805`, `:1815`).

**Teardown**
- There is a complete disposer returned by `mountArmatureMode` (`:2371-2432`). It removes the listeners, disposes the controls, the figure, the panels, the strip and the menus, restores the look and lights, and dispatches `bozzetto:sculptmode {active:false, mode:'view'}`. No caller invokes it and no test does.
- Gaps in it: `viewer.tapToFocus` is not restored; `onDeviceChoice` is not unsubscribed; the highlight `wash` material is not disposed; `setHandleViewport` and the module caches `figureReads` / `parsed` / `pending` are module-level.
- In practice the app relies on the page being left (`leaveForGallery` at `:1493`, `window.location.href = originOf().href`).

## 4. What Sculpt owns that would collide

**Sculpt-only pieces**
- `InputShell` (`bridge/InputShell.ts`, constructed at `mode.ts:1158`): listens on the canvas's parent container, capture phase, for `pointerdown`, `pointermove`, `pointerup`, `pointercancel` and `pointerleave` (`:544-548`). On `window` it listens for `keydown` and `keyup` (`:549-550`, mode `'paint'` or `'sculpt'` at `:2472`), plus `blur`, `resize` and `scroll` (`:554-556`).
- `SculptToolbar`, `BrushSliders` (the left `.bz-edge` column, which also gets Armature's Arrange button), `SculptPanel`, `ScenePanel`, `ModelPanel`, `LayersPanel`, `LookPanels`, `PublishWindow`, `PresentMode`, `FileMenu`, `MeasureOverlay`, `TransformGizmo`, `BrushCursor`, `ScenePersist` (`persist`), `fileActions`, `MaterialLibrary`.
- Sculpt's dispose is the large block `:2490-2600`, also never called by `main.ts`.

**Shared code already used by both** (the new workspace can reuse them as they are)
- `src/sculpt/ui/TitleStrip.ts`: `bz-shell` body class, `startShellLayout()` (resize / MutationObserver / transitionend observers), and the 4-step path with `data-workspace`.
- `TopMenu`, `menuShape` (`fileMenuItems`, `editMenuItems`), `viewMenu` (it lists `armature`, `sculpt`, `paint`, `present`), `recentMenu`.
- `panelMemory.rememberPanels(mode)` (keys `bz.panels.<mode>`) and `SHELL_LAYOUT_EVENT`.
- `SidePanel`, `DetailsOverlay`, `statusToast`, `HistoryButtons`, `VoxelOverlay`, `shell.css`.
- `pageChrome()` (a single shared `ChromeToggle`), `Help` and `Preferences`.
- `keymap` (one table).
- `MaterialPanel`, `ReferenceBoard` / `Panel` / `View`.
- `leaving.beforeLeaving`.

**Per page, not shared:** each mode builds its own `TitleStrip`, menus, panels and edge controls.

**How Sculpt hides things for Present and Paint (the model a new workspace follows)**
- `enterPresent()` (`:1376-1410`) records what was up (chrome hidden, which side panels were open, Select tool, gizmo mode, mask tint). Then:
  - It exits the tools (`input.exitSelect()`, `exitMeasure()`, `exitTransform()`).
  - It collapses the side panels (`setCollapsed(true)`).
  - It sets `input.presenting = true` and calls `cursor.hide()`.
  - It adds `body.presenting`, calls `viewer.materials.setPresenting(true)`, and dispatches `bozzetto:present`.
  - It returns a closure that undoes all of it.
- CSS under `body.presenting` hides `.sculpt-toolbar__brushes`, `.sculpt-sliders`, `.bz-edge` and panels other than Lighting, Camera, Render, Output and Material (`shell.css:1137-1160`, `:2062`).
- `PresentMode` (`ui/Present.ts:251-275`) wraps it with `enter()` and `leave()`, then dispatches `SHELL_LAYOUT_EVENT`.
- `enterPaint()` / `leavePaint()` (`:1671-1718`): remember `paintWas {tool, model, select, gizmo}`, exit select, measure and transform, collapse the Model panel, set `input.paintMode`, add `body.paint-ws`, call `toolbar.setWorkspace(true)`, `layersPanel.setPaint(true)`, `input.selectBrush(PAINT)`, dispatch `bozzetto:sculptmode {mode:'paint'}`, `setPaintAddress(true)`, `paintPath()`, `SHELL_LAYOUT_EVENT`.
- `workspaceNow()` (`:1723`) returns `current` and the `steps` for the strip and the View menu. The strip gets `strip.setWorkspace(...)` from `paintPath()` (`:2456`), and the View menu is rebuilt with `viewMenu.setItems(viewItems())` in the same function.
- The Armature step is `{action: () => goArmature()}` (`:1726`).

**Announcements to Help and Preferences:** `bozzetto:sculptmode` with `detail.mode` (`sculpt`, `paint`, `armature`, `view`). Listeners are `Help.ts:83` / `:189` and `Preferences.ts:36`. Sculpt dispatches `{active:true}` at `:2471`.

## 5. Saving

**Armature in progress**
- Module `src/armature/persist.ts`. Store: IndexedDB `bozzetto-sculpt`, object store `scene`, key `currentArmature` (`persist.ts:~99`). It uses `withNamedStore` from `ScenePersist`, the same database the Sculpt autosave uses (that one is key `current`).
- The record is `ArmatureFile`: `{kind:'bozzetto-armature', v:1, name, state: ArmatureState, look?, savedAt, model?: ArrayBuffer, modelName?, thumb?: Blob, project?: {id,title,scope?}, synced?, symmetry?, units?, forScene?}`.
- `ArmatureState` (`Armature.ts:41-55`) is `v:1`, `preset`, `root`, `pose`, `proportions`, `pins`, `aims`, `plant`.
- `flushSave` (`mode.ts:1417`) writes the whole record, debounced 400 ms (`SAVE_GAP_MS`), and also on `pagehide` and `beforeLeaving`. It does nothing while `mayStore()` is false.

**`.armature` file (`armature/file.ts`)**
- `packArmature` writes the autosave record as JSON and drops `model`, `thumb`, `project`, `synced`, `symmetry` and `forScene`. `unpackArmature` checks `kind` and `state.preset`.
- Opening one is `openFile` (`mode.ts:1573`), after `onCentimetres`. It can also open a library project's `armature.json`.

**Armature projects in the library**
- Format: `shared/armature.ts`. `armature.json` is `{kind:'bozzetto-armature-project', v:1, figure, name, state(less preset), symmetry, look, savedAt, units}`, gzipped, at most 4 MiB, with a depth limit of 16 and `__proto__` / `constructor` / `prototype` refused.
- Allowed figures are the 6 ids in `ARMATURE_FIGURES`. A model loaded from a file is not uploadable (`mode.ts:1872`).
- Save: `uploadArmature` (`armature/project.ts:230`) with `libraryProjects(scope).create({mode:'armature', title})`, then `armatureUpload`, then `uploadThumb` (best effort). Server mode is `'armature'`, file `armature.json` (`functions/_shared/media.ts:12`, `armatureFile.ts`).
- Open: `?armature=1&project=<id>[&scope=admin]` or `&template=<id>`. `fetchArmatureProject` / `fetchArmatureTemplate` run through `sceneManifest` / `templateManifest`, `readArmatureProject` and `sanitizeArmatureState`.
- Thumbnail: `capture()` (`mode.ts:1451`) renders with the handles, gizmo and wash hidden, as a 4:5 JPEG, 800x1000 (the test asserts that).
- Links to it:
  - My projects (`ui/account/myProjects.ts:359`).
  - The owner's Projects (`admin/main.ts:353`).
  - The gallery card `armatureProjectCard` (`Landing.ts:781-815`).
  - `uploadKeptArmature` (`project.ts:322`) for the gallery's In progress card.
- The `ArmatureLink {id,title,scope?}` is kept in the autosave (`project` field), and `synced` marks "saved as it stands".

**Gallery "In progress" card for the armature:** `armatureCard` (`Landing.ts:265`): reads `loadArmature()`, shows `thumb`, links to `/?armature=1`, offers upload for signed-in users or a `.armature` download, and a note on whether it is in the library. Open recent: `recordRecent({kind:'armature',...})` at `mode.ts:1829`, href via `recentHref` (`sculpt/ui/recentMenu.ts:11`). The list is `bozzetto-recent` (max 10). It opens with `window.location.assign`, a full page load.

**Sculpt scene**
- `SavedScene` (`bridge/ScenePersist.ts:230`): `v: 3|4|5` (written as 5 at `SculptSession.ts:2320`), `savedAt`, `meshes: SavedMesh[]`, `active`, `symmetry`, plus optional `look`, `materials`, `settings`, `units`, `scaleDismissed`, `project`, `unsent`, `synced`, `name`, `references`.
- Autosave: `ScenePersist` writes `current`, with a `currentStatus` / `currentSnapshot` companion and the look under `currentLook`.
- `.bozz`: `shared/bozz.ts` (magic `BOZ1`, a header JSON with typed arrays swapped for `{__buf:n}`), packed and unpacked by `SceneFile.ts`. `packScene` drops `project`, `unsent`, `synced` and `name`, and keeps `references` only with `keepReferences`.
- Server scene: mode `'scene'`, file `scene.bozz`. `checkHeader` (`shared/bozz.ts:207`) is used by `functions/_shared/content.ts:136`.

**Is there room for extra per-scene data?**
- Yes, by optional top-level fields. This is how `look`, `materials`, `settings`, `units` and `references` ride.
- Per-object optional fields with their own `v` (`source`, `groups`, `layers`, `paintLayers`, `measures`) are the second pattern.
- To make a new field survive, each of these must list it:
  - `SavedScene` (`ScenePersist.ts:230`).
  - `SculptSession.serializeScene()` (`:2311`) / `replaceScene` (`:2558`).
  - `sanitizeScene` (`bridge/sanitize.ts:460-482`), an explicit allow-list. Unknown fields are dropped there.
  - `packScene` (what a file keeps or strips).
- `checkHeader` does not reject extra top-level keys. It checks `v` in 3/4/5, `meshes` and `active`. References are the one existing field that is kept only in a file and never uploaded.

## 6. The hand-off

**`saveHandoff` / `takeHandoff` (`armature/persist.ts`)**
- Same IndexedDB `scene` store, key `sculptHandoff`.
- `takeHandoff` reads, deletes, and returns null unless `positions` is a `Float32Array` and `indices` a `Uint32Array`.
- `SculptHandoff` fields: `v:1`, `name`, `positions: Float32Array`, `indices: Uint32Array`, `resolution`, `look?`, `savedAt`, `units?`, `floor?`, `addToScene?`.

**`send()` in Armature (`armature/mode.ts:1634-1680`)**
- Bakes with `armature.bakeWorld()`.
- Runs `checkRemesh(boxOfPositions(bake.positions), resolution)`. A `RemeshTooLarge` becomes a toast and the figure stays.
- `requireSaving('Send to Sculpt needs to keep the figure on this device.')`.
- `saveHandoff({v:1, name:'Figure', positions, indices, resolution, look: viewer.getLook(), savedAt, units: UNITS, floor: viewer.floorHeight() ?? 0, addToScene? from forScene})`.
- `forScene = false`, then `await snapshot()` (picture and `flushSave`), then `window.location.href = '/?sculpt=1&handoff=1'`.
- Triggers: File > Send to Sculpt (`:1996`), the panel button (`ArmaturePanel.ts:167`), `arm.send` ctrl+enter (`:2150`), the path's Sculpt step (`:1909`).

**What Sculpt does (`sculpt/mode.ts:2298-2336`)**
- It loads and deletes the record. `untouched = !fileActions.hasWork() && !handoff.addToScene`.
- If untouched, it calls `session.setUnits(UNITS)`.
- `handoffPositions(h, floor)` (`:2822`) converts units (cm, m, or the legacy 50-per-metre scale) and lifts the figure so its floor matches the scene's.
- `session.addVoxelised(handoff.name, positions, handoff.indices, handoff.resolution)` (`SculptSession.ts:1205`): `setRemeshResolution`, `checkRemesh`, `mergeVertices`, a triangle `MeshStatic`, `Remesh.remesh` via `remeshAt`, `uniqueMeshName(name)` ("Figure", "Figure 2" ...), then `addNewMesh`, which does `pushStateAdd` (undoable).
- On `RemeshTooLarge`, it retries at `err.fits` and shows a toast.
- If untouched, it deletes every other mesh (the default sphere). Then `persist.markDirty()` and `viewer.frameBounds(...)`. The address is cleaned with `replaceState`.
- `hasWork()` is `!sceneOnDisk || stateManager.getCurrentState() !== cleanState` (`:1579`). A restored autosave counts as work, so a figure then always arrives as an added object.
- **`handoff.look` is never read by Sculpt** (no use found in `sculpt/mode.ts`). The look the figure was lit with does not cross.

**`goArmature` in Sculpt (`:2436-2455`)**
- `hasArmature()` checks for a draft.
- `askWindow({title:'Make a new armature for this scene?', text:'The figure you send back is added to this scene as a new object. Nothing in the scene is replaced.' + (draft ? ' The armature in progress on this device will be replaced.' : ''), yes:'New armature', danger: draft})`.
- On yes: `present?.leave()`, `snapshot()`, `persist.flush()`, `storeLook()`, then `location.href = '/?armature=1&scene=1'`.
- Armature (`:207-214`) with `scene=1` sets `saved = null` (a brand-new figure whatever the autosave held), strips the parameter, and `forScene` is kept in the autosave (`flushSave` at `:1423`).
- The code comment at `sculpt/mode.ts:2430` says it plainly: nothing in the scene records an armature it came from.

**Is anything kept tying a Figure to its armature or pose? No.**
- The handoff is deleted on arrival and the scene record has no field for it.
- The Figure is only a named mesh (`getMeshName`), with its name made unique.
- The armature autosave (`currentArmature`) stays on the device after a send, but nothing in the scene points to it.
- Not found: a per-object "origin", "pose" or "armature id" field anywhere in `SavedMesh`.

**Can Sculpt tell whether a Figure has been sculpted since it arrived? Not today.**
- The only tracking is scene-wide: the state manager's current state against `cleanState`, `persist.markDirty` (a scene-wide dirty flag), and `session.sceneEpoch`.
- No per-object edit counter or flag was found. Each object does have its own `layers`, `paintLayers`, `groups`, `measures` and `materialId` records, and the `painted` flag (`SavedMesh.painted`).
- The undo stack holds the Figure's add state as the oldest entry after a hand-off, because `session.clearHistory()` (`:~380`) ran before the figure was added.

## 7. The figure's geometry

**`bakeWorld()` (`Armature.ts:1793`)**
- `mesh.updateMatrixWorld`, `skeleton.update()`, then for every vertex `mesh.applyBoneTransform(i, v)` and `applyMatrix4(mesh.matrixWorld)`.
- It returns `{positions: Float32Array (world, centimetres), indices: Uint32Array(copy of index)}`. Normals, skin, colours and materials are not carried.

**Size**
- Mannequin GLBs, measured here from the files: male realistic 35,904 triangles (18,050 vertices), female realistic 36,704 (18,454), male stylized 31,948 (16,072), female stylized 34,616 (17,410). Each file is 0.9 to 1.05 MB (`public/assets/armature/`).
- The two block presets are boxes: 13 parts x 12 triangles, about 156 triangles.
- Blocks overlap and are open at joints, which is why a voxel remesh follows (the comment at `SculptSession.ts:1198`).

**Remesh time:** not found measured anywhere in the repo.
- `addVoxelised` runs on the main thread (no worker).
- `perfLog.record('voxel remesh')` exists only for `voxelRemesh` (`:1072`), not for `addVoxelised`.
- `remeshBudget.ts` prices memory only: a dense grid at 36 bytes per cell, longest side cut into `resolution` cells, padded 1.51 cells, resolution 8 to 512, default 120, device share 1/4 of memory.

**Could the baked mesh be shown in Sculpt without remeshing? Not as is.**
- Sculpt objects are vendor `Multimesh` / `MeshStatic` with quad-capable faces, subdivision levels, vertex colours, a mask and materials (`SavedMesh`).
- The baked data is non-welded triangles (vertex per corner), open at the joints. `addVoxelised` welds with `mergeVertices` before it needs a closed shell, so a direct add would be an open, disconnected soup with no normals or colours.
- The mannequin files are skinned single meshes, which are probably closer to closed than the block parts. No code path adds a baked mesh to a `Multimesh` without the remesh.

## 8. Tests and addresses

**Opening Armature**
- `openArmature(page, base)` in `tests/e2e/lib.mjs:199` does `goto(`${base}/?armature=1`)` and waits for `window.__armature` (90 s).
- Direct `goto` of `/?armature=1`: `smoke.mjs:2281`, `:7697` (`&q=low`), `shell.mjs:414` (`&from=`), `webgpuHang.mjs:37`, `deviceStorage.mjs:336`, `:588`, `:658`, and several in `armatureProjects.mjs`.

**`window.__armature` methods the tests call** (counts across `tests/e2e`):
- `.armature` (34), `.state` (16), `.handleLook` (15), `.select` (14), `.undo` (10).
- `.turn`, `.selectHandle`, `.save`, `.handlePosition`, `.ballOnScreen`, `.send`, `.gizmo`, `.figure`, `.history`, `.handleNames`, `.saveToLibrary`, `.picked`, `.selected`, `.rootBox`, `.snapshot`, `.panel`, `.onScreen`, `.link`, `.hover`, `.hingePosition`, `.handlePalette`, `.role`, `.redo`, `.reach`, `.plantLooks`, `.pack`, `.moveRoot`, `.file`, `.commit`, `.open`.
- `reference.mjs:399` reads `__armature.viewMenu`, which the handle does not define (the access is optional-chained).

**Hand-off suites (5), all in `tests/e2e`**
- `armatureProjects.mjs`: `armatureSendThumb` (waits for `handoff=1`, then checks the gallery card's picture).
- `units.mjs`: `unitsArmature` (`:556-575`, Send keeps the feet on the floor, Figure 169.4 cm tall).
- `deviceStorage.mjs`: `deviceStorage` (`:620-680`, the saving-off question).
- `tweaks.mjs`: `voxelGrid` (`:636-660`, Send at 512 on a small device refused, and a roomy-device send arrives at the most that fits).
- `shell.mjs`: `shellWorkspaces` (`:555-590`, the Armature step asks "Make a new armature for this scene?").
- Server side, unaffected by addresses: `tests/functions/suites/armature-projects.mjs`, `admin.mjs`, `community.mjs`.

**Suites that open Armature: about 35 suites in 22 e2e files**
- That is 33 found by a script that checks each suite body (and the helpers it calls) for `armature=1`, `__armature` or `openArmature`, plus `armatureControls` and `armatureLook` (exported as `{ armatureControls, armatureLook }`), which that script missed.
- Files: `armatureControls`, `armatureProjects`, `clarity`, `clayTabPen`, `detailsOverlay`, `deviceStorage`, `docScroll`, `help`, `latency`, `lookTabs`, `material`, `menuShape`, `presentEdges`, `recentMenu`, `reference`, `shadows`, `shell`, `smoke`, `studyName`, `tweaks`, `units`, `webgpuHang`.
- Of 203 suites counted in total, about 35 depend on `?armature=1` booting Armature on its own and on `window.__armature` existing after that load.
- If `?armature=1` stays a valid address that opens the Sculpt page on its Armature workspace, most of these keep working as long as `window.__armature` still appears and the standalone surface (menus, panels) matches.
- Those that would change regardless: the five hand-off suites, which assert the page change (`waitForURL handoff=1`) and `window.__sculpt` after it; the suites that check Armature has no Scene, Model or Layers panels, or specific menu rows (`menuShape`, `shell`, `help`, `detailsOverlay`); and the `smoke.mjs:7697` service-worker offline check.

## 9. Other "one page, one mode" assumptions

- `ui/updates.ts:105-122`: `reloadIsFree()` treats `sculpt` or `armature` in the query as "do not reload an update under the user". It would also need `?armature=1` and `?sculpt=1` to be the same page.
- `ui/leaving.ts`: a `beforeLeaving` set. Sculpt registers at `sculpt/mode.ts:2415` and Armature at `armature/mode.ts:1504`. Two modes mounted together would both run, each doing its own snapshot.
- `ui/origin.ts`: `from=` is read from the address at click time. The hand-off and `Armature step` addresses drop it.
- `vite.config.ts:205-210`: `navigateFallbackAllowlist: [/^\/(?:\?.*)?$/]` serves the shell for `/` with any query. Precache includes `assets/armature/*.glb` (4 MB). The worker is "prompt" mode, so a running page keeps its worker (`:150-160`). `ui/serviceWorker.ts` registers at boot in `main()`.
- `main.ts:46-58`: `workspace` for the first-run device question is `sculpt=1 || armature=1` for two cases only.
- `ui/startWork.ts`: `startArmature()` clears the armature autosave and does `location.href='/?armature=1'` (`:105`). `startSculpt()` does `/?sculpt=1` (`:86`). `importObj` uses `/?sculpt=1&obj=1`. Landing's Create window (`Landing.ts:190-250`) has New Sculpt, New Armature, Import OBJ (and Create timelapse for the owner), with the "A posable figure to reference, or to send to Sculpt as a base." hint.
- `ui/Landing.ts` and the project pages hard-code `/?armature=1&...` and `/?sculpt=1&...` addresses at: `Landing.ts:284`, `:289`, `:797`; `ui/account/myProjects.ts:357-370`; `admin/main.ts:353`, `:366`; `sculpt/ui/recentMenu.ts:11`.
- `ReferenceBoard` scope is `'sculpt' | 'armature'` (`reference/board.ts:149`), so the two have separate boards. `panelMemory` is keyed per mode.
- Help content (`src/help/content/*.ts`) presents Armature as a separate mode: `modes.ts:96-113` (the "Armature mode" topic with its own File items), `:43`, `:67`, `:69` (the path **Armature › Sculpt › Paint › Present**), `basics.ts:12-19`, `:56` ("In Armature"), `panels.ts:147`, `:174`, `:210`, `:244`. The Help guide switches key tables on `bozzetto:sculptmode`.
- Comments in `armature/mode.ts` still say the Render panel is built on the `bozzetto:sculptmode` event (`:168`) and that Armature has a Render panel; Render moved to Present on 2026-11-17.
- `docs/HANDOFF.md:6`: "stages 1 and 2 are the priority; stage 3 is a stretch goal ... Plan to be written in docs/plans/". No plan file for it exists yet (`docs/plans/` has `reference-and-measure.md`, `tool-library-and-nodes.md`).

## The ten hardest facts for the merge

1. **Both modes bind global input and neither removes it in practice.** Armature adds 7 window listeners (`armature/mode.ts:1283, 1284, 1485, 1493, 2172, 2177, 2184`), 2 document listeners (`:1476`, `:1477`) and 2 canvas listeners (`:1281`, `:1282`). `InputShell` adds 5 on its container and 5 on window (`InputShell.ts:544-556`). Both disposers exist (`armature/mode.ts:2371`, `sculpt/mode.ts:2490`) but `main.ts` throws them away, so a workspace switch cannot call them as written.
2. **Same keys, different actions, same table.** Armature x / w / e / t / r (`keymap.ts:166-170`) match Sculpt x, w, e, t, r (`:69-73`). `actionFor(e, mode)` picks by mode, but both handlers run on the same `window.keydown` capture and each calls `stopPropagation` / `preventDefault` when it claims one. A workspace must gate one of them; neither has a suspend switch except InputShell's `presenting` / `paintMode` flags.
3. **Two undo histories with different shapes.** Sculpt uses the vendor state manager. Armature uses `undoStack` / `redoStack` JSON strings with a limit of 100 (`mode.ts:1286-1368`) and buttons in its own `.bz-edge`. One page has one Undo / Redo edge column (`BrushSliders.ts:172`).
4. **Two incompatible viewer configurations.** Sculpt: cavity composite with GTAO off, fill and rim lights off, no environment, flat clay, ground off, floor `0` or `null` by units. Armature: GTAO pipeline, key light only casts, environment kept, floor fixed at the figure's soles. The two `lockFloor` calls (`armature/mode.ts:167`, `:313` and `sculpt/mode.ts:384`) and `setSculptVisible` (Sculpt's `reconcile` at `:683`, Armature `:334`) are the clearest direct conflicts. `Viewer.liveShadowBox` (`Viewer.ts:2913`) prefers `shadowSubject`, so the figure falls out of the shadow fit.
5. **The look has two homes.** Sculpt: `currentLook` key plus `SavedScene.look`. Armature: `ArmatureFile.look`. The hand-off's `look` field is written (`armature/mode.ts:1667`) and never read by Sculpt. In one scene there is one `viewer.getLook()`.
6. **The scene record has no place that survives as is.** An armature field must be added to `SavedScene`, `serializeScene`, `replaceScene`, `sanitizeScene` (explicit allow-list, `sanitize.ts:460`) and `packScene`. Server `checkHeader` (`shared/bozz.ts:207`) would accept an extra top-level key. The armature lives today under `currentArmature` in the same IndexedDB (`persist.ts`), independent of the scene autosave.
7. **A Figure is not linked to anything.** The handoff is deleted on arrival (`persist.ts takeHandoff`), the object is a plain `Multimesh` named "Figure", and Sculpt has no per-object edit flag: only the scene-wide `stateManager` compare (`sculpt/mode.ts:1579`) and `persist.markDirty`. "Unsculpted" would need a new mechanism (for example a hash of the remeshed result, or a per-object stroke counter). Note that voxel-remeshing is what gives the object its multires structure, so a pose update means redoing `addVoxelised` and replacing the mesh in place.
8. **The figure's geometry cannot go straight into Sculpt.** It is a skinned triangle mesh of about 32,000 to 37,000 triangles (blocks: about 156), baked as an unwelded vertex-per-corner soup, and only `addVoxelised` (`SculptSession.ts:1205`) makes it an object. That runs synchronously on the main thread. No timing is recorded in the repo, and `remeshBudget` can refuse it on small devices (see `tweaks.voxelGrid`).
9. **Shared panel ids and edge elements.** `material` and `reference` panel ids exist in both modes (`SidePanel`, `panelMemory SIDES` / `ROOT`). `panel-set` events open all matching panels, `panelIsOpen` takes the first DOM match, and each mode creates its own `ReferenceBoard` with scope `sculpt` or `armature` (`refs:` keys). Both create a `.bz-edge` element.
10. **Page-level reload and address assumptions.** `?armature=1` and `?sculpt=1` are two entries in `main.ts`, in `updates.ts reloadIsFree`, in the service worker allow-list pattern, in Landing, My projects, the owner Projects page, Open recent and the Create window; `?paint=1` and `?scene=1` are read inside the modes; File > Close and the hand-off addresses lose `from=`. Armature projects and scene projects are two server modes with two file formats (`armature.json`, `scene.bozz`) and two gallery cards.
11. **Tests.** About 35 suites in 22 e2e files boot Armature through `openArmature` / `/?armature=1` and `window.__armature` (`lib.mjs:199`). Five suites assert the page change (`waitForURL handoff=1`, then `window.__sculpt`): `armatureSendThumb`, `unitsArmature`, `deviceStorage`, `voxelGrid`, `shellWorkspaces`.
12. **The Armature mode is not torn down cleanly even when it is asked to be.** The disposer does not restore `viewer.tapToFocus` (set false at `armature/mode.ts:182`), does not unsubscribe `onDeviceChoice` (`:1433`), and never disposes the highlight material. `handleViews.setHandleViewport` and the figure caches (`figureReads`, `parsed`, `pending`) are module-level, so a second mount would reuse them.
13. **The workspace path already exists but the Armature step is a page change both ways.** `TitleStrip` has the four steps (`TitleStrip.ts:65`), Sculpt's Armature step is `goArmature` (a question and `location.href`), and Armature's Sculpt step is `send()` (`mode.ts:1909`). Paint and Present are marked "unavailable" in Armature.
