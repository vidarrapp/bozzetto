# Bozzetto
<img width="1915" height="956" alt="bozzetto_v1_screenshot_vidarrapp" src="https://github.com/user-attachments/assets/6a8b27f6-5806-422b-ac81-89909a84751d" />

A *bozzetto* is the small clay study a sculptor makes before starting the real piece, the place where the rough form gets worked out. 

The Bozzetto web application applies that idea to sculpt timelapses: instead of a pre-rendered turntable video, every stage of a sculpt is stored as real 3D geometry you can relight, orbit, and step through.
It's built as a study and teaching tool primarily, as well as a nice way to render out content and timelapses. I built this for my own use, but am sharing it with an MIT license for any who find it useful!

Bozzetto has a few parts:

- A viewer that plays a timelapse back as a sequence of meshes. You can watch a form emerge from rough volumes to a finished surface, relight it, switch shading modes, and scrub through the stages.
- A public editor (`/create`) that builds a timelapse in the browser and exports it as one self-contained file you can open offline. No sign-in, and nothing is uploaded.
- A full editor (`/admin`) that publishes timelapses to the gallery, behind a login, with a saved look and thumbnail per project.

It runs entirely on Cloudflare (Pages, Functions, D1, and R2), so there is no server to run yourself.

Live at [bozzetto.vidarrapp.se](https://bozzetto.vidarrapp.se). The viewer is at `/?tl=<id>`, sculpt mode at `/?sculpt=1`, the public editor at `/create/`, and the full editor at `/admin/`.

## Install as an app (iPad, iPhone & Android)

Bozzetto ships a web-app manifest and home-screen icons, so it installs like an app and launches fullscreen from its own icon — which is the way to use sculpt mode on an iPad. The gallery's **Install** button walks you through it; the steps are:

**iPad / iPhone (Safari):**
1. Open **bozzetto.vidarrapp.se** in Safari.
2. Tap the **Share** button (the square with an arrow — top right on iPad, bottom on iPhone).
3. Scroll the sheet and choose **Add to Home Screen**, then tap **Add**.

**Android (Chrome):**
1. Open **bozzetto.vidarrapp.se** in Chrome.
2. Open the **⋮** menu and choose **Add to Home screen** (some versions say **Install app**), then confirm.

Your sculpts autosave to the browser's storage either way, installed or not — and nothing ever uploads unless you sign in and publish.

## Changelog

### v1.1

**Sculpt mode (alpha)** — Bozzetto can now sculpt, not just play back. Built on [SculptGL](https://github.com/stephomi/sculptgl)'s editing core (MIT, by Stephane GINIER), ported onto Bozzetto's WebGPU/WebGL2 node pipeline with one canvas, one camera, and one look. Click **Sculpt!** in the gallery to try it - it opens a clean sculpt scene directly, no timelapse loaded.

- **Sculpting** — drag on the mesh to sculpt, drag off it to orbit; hold `Alt` to carve (negative), `Shift` to smooth, `Ctrl` to mask, `Ctrl+Alt` to unmask. Nine brushes on `1`–`9` (Crease, Move, Standard clay, Inflate, Pinch, Flatten, Rake, Drag, Polish), `X` toggles symmetry, `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo — history is 64 deep and fuzz-tested.
- **ZBrush-informed brushes** — the Standard brush lays down clay-strip-style ribbon layers (flat-topped falloff, thicker build plane); the Move brush grabs volumetrically, so you can pull a silhouette starting from just outside the outline (with an aim ring off-model), with a softer, broader falloff. **Polish** replaces Twist on `9` (hPolish-style): each stroke grips a working plane from the face it starts on — an outlier-rejected fit that a neighbouring face can't tilt — and holds it with tunable give — the **Plane lock** slider in the brush's palette rows runs from follow (rides gentle curvature without flattening it) to locked (planarizes chatter hardest) — pulling nearby geometry flat onto it from **both** sides (bumps shave, dents fill: a polish, not a carve) while everything beyond a narrow band stays put. That's what lets it smooth a surface right over an edge and leave the edge — or a corner — crisp where Flatten melts it: the far face never joins the plane. `Alt` switches to trim, shave-only. With symmetry on, each side grips its own plane — the mirror is a real polish, not a projection of the pen side's.
- **Painting** — `0` selects the paint brush, the tenth button on the toolbar. Sculpt albedo comes from per-vertex colour, so an object starts filled with its material colour and a stroke paints on top of that; changing the material colour re-fills anything you haven't painted yet, and never touches what you have. **Alt + click** samples a colour off the model. Colours are picked with an **HSV picker** — a saturation/value spectrum with a hue strip, plus numeric H, S and V — and the same control now sets the material albedo, which used to be the browser's RGB box. Painted colour rides the autosave and `.bozz` files like the rest of the mesh; it is not recorded into timelapses. Paint owns **colour only**: the upstream tool also wrote its own roughness and metalness into every stroke (defaults 0.3 and 0.95 — which is why painted areas came out mirror-shiny), and now it never touches them — the surface response stays the object's material. Scenes saved while the bug lived heal on load: painted objects get their material's roughness/metalness re-stamped, colours untouched.
- **Object transforms** — a gizmo at last: the toolbar's Transform button shows the unified manipulator (translate arrows with view-plane handles, the three rotate rings plus Maya's screen-space outer ring, scale cubes inside), while `W`, `E` and `R` expose one mode each — move, rotate, scale — and `Q` returns to sculpting, as does picking any brush. Tap another object and the gizmo hops to it. Each completed drag is one undo entry, the camera is parked while a handle is held, and a moved object persists like any other edit. The unified gizmo is trimmed of the handles that stacked on top of each other: the view-plane translate centre and the two-axis translate/scale planes leave (they remain in the single modes, where nothing overlaps them), and the uniform-scale cube in the middle grows into an easy target. (The vendored SculptGL transform drew through the GL pipeline Bozzetto cut, so the gizmo is three.js's TransformControls driving the same matrices.)
- **Per-object materials** — the **Scene** panel gains a material dropdown for the selected object, plus **New material**. A material is a name with an albedo, roughness and metalness, and the **Model** panel's Material section edits whichever material the selection points at — so those sliders are per-object, and they live beside the other per-object controls rather than among the scene-wide Render settings. There are no extra three.js materials behind this: sculpt albedo comes from the per-vertex colour attribute and roughness and metalness from the two channels SculptGL keeps beside the mask, so a material is simply those values written across an object's vertices. One shader, any number of materials, and a paint stroke is the same write at a smaller radius — which is why painting and material assignment compose instead of fighting. Editing a material leaves painted objects' colours alone (their strokes are work); re-assigning one asks first, because the fill can't be undone selectively.
- **Masking** — paint masks with `Ctrl`; masked areas darken on the model (ZBrush-style, in every material mode) and resist every brush. `Ctrl+C` clears, `Ctrl+I` inverts, and `Ctrl+H` hides the tint without releasing the mask itself. A `Ctrl`-click on empty space still inverts the whole mask; a `Ctrl`-*drag* out there zooms instead (clearing moved to `Ctrl+C`, which is what freed the drag).
- **Brush cursor** — a crisp ring aligned to the surface under the cursor at the true brush radius, with a center dot and a strength line along the normal. It turns blue whenever you're smoothing (the Smooth brush, or holding `Shift`), gets out of the way mid-stroke, ZBrush-style (sculpt brushes keep just the center dot, Smooth keeps a dimmed ring), and disappears entirely off the model or while orbiting — no more ring chasing your camera drags. Adjusting size/strength (`B`/`S`) never orbits the camera. Hold `B` and drag sideways for size, `S` and drag up/down for strength; the cursor anchors in place while adjusting.
- **Pen pressure** — Apple Pencil and other styluses drive brush strength fully through the stroke while brush size stays constant; mouse and plain touch are unaffected. A pen's pressure is taken as reported, zeros included, so lifting the tip ends the stroke quietly instead of stamping a dot — the reading as the pen leaves the glass *is* zero, and treating it as a neutral mid-pressure made the lightest moment of a stroke land as the heaviest. Full pressure can double a brush's strength — which is fine for clay, and was catastrophic for **Smooth**: its blend is only meaningful up to "land exactly on the neighbours' average", and past that every dab amplifies the bumps it should erase, shattering the mesh in seconds. Smoothing strength now caps at that mathematical ceiling, so pressing harder means *fully smooth*, never chaos.
- **Detail** — the default sphere is ~50k triangles with a multiresolution stack: `D` / `Shift+D` step levels, `Ctrl+D` subdivides, and a small "Subdiv 2/4" pill announces every level move. Past ~4M triangles a dialog asks before continuing (fast machines hold 60 fps well beyond it; the hard ceiling is 16M). The palette's Topology section puts the same stack on screen: a discrete **Level** slider with a `2/4` readout beside it, and **Lower / Higher / Subdivide / Rebuild** buttons — Rebuild is SculptGL's reversion, building a *coarser* level under the lowest one so an imported or remeshed model gains room to block out. **Dynamic topology** has its checkbox there too, and asks before switching on (it rebuilds the surface under every stroke and flattens the level stack — `Ctrl+Z` undoes the switch); its stroke subdivision/decimation sliders sit under it and fold away entirely while it is off, instead of posing as dead scene-wide controls. Turning it off (or voxel remeshing) now hands back an object that can subdivide again, where it used to come back stripped of its level stack for good.
- **Sculpt rendering defaults** — a warm clay material (`#fed9a8` at 0.5 roughness, rather than the viewer's neutral grey — it reads form better under a single key light, and it is what the app is for), flat shading, a single key light, shadows on, no depth of field, no HDRI sampling, the stage (floor/pedestal) hidden so the sculpt's underside stays visible (`G` brings it back), and GTAO replaced by a lightweight depth-based cavity SSAO. The cavity term measures *concavity* — the centre pixel against the average of opposed depth taps — so a slope or a sphere's limb reads zero however steep it is on screen, silhouettes reject themselves, and only genuine creases darken; it never grids on flat-shaded facets because facet normals are not consulted at all. (It also actually works now: the original pass read its camera range inside the output quad, where a fullscreen pass's own near/far made every depth identical, so it had been computing exactly nothing since it was written.) Everything returns to the saved look when leaving sculpt mode.
- **Touch toolbar** — a bottom bar for keyboard-less iPads: a Negative button in the left corner, the nine brushes synced with the hotkeys (each with an icon, [Uicons by Flaticon](https://www.flaticon.com/uicons), and its hotkey digit as a corner badge), and the hide-interface eye on the right. **Tap** Negative to carve and it stays on until you tap it again; **hold** it while you draw and it's momentary, like holding `Alt`. (Holding took three rounds to get right: a stationary finger on a control makes iOS arm its long-press gesture after ~450ms, cancel the touch and then ignore the Pencil entirely. The toolbar sits outside the viewport, which had opted out of that gesture years ago; now it does too.)
- **Look-dev parity in sculpt** — the Render panel gives sculpt mode the same controls the admin editor has: material mode, albedo, roughness, matcaps, smooth/flat, wireframe, the **full light rig** (intensity, angles, colour, per-light shadows), camera, environment, and an **Ambient occlusion** section where you pick the model — Off, **Cavity (SSAO)**, or **GTAO** — each with its own strength and radius. Sculpt defaults to Cavity and to shadows **on**; depth of field is there too, with the same Enabled/Aperture/Focus controls as the editor.
- **Corner stats** — the top-left shows the active object's name and a live triangle count (the name column grows into a scene outliner later).
- **iPad: your palm is fine, a finger is not** — iPadOS delivers only one *kind* of touch to a web page at a time, so a finger resting on the screen makes an Apple Pencil invisible to the browser: no event is generated at all, and no web app can work around it (four rounds of fixes went into proving that; the mechanism is in `docs/sculpt-mode-implementation.md` §6.6e). Resting your **hand** while you draw is fine — iPadOS rejects a palm before it ever counts as a touch, in either order. What costs you the Pencil is a deliberate **finger**: holding a toolbar button, or a fingertip parked on the glass. Lift it and the pen comes back.
- **World-scale brush size** — a **World-scale size** checkbox in the Sculpt panel's Brush section. By default the brush is a fixed number of *screen pixels*, so it covers less of the model the closer you get and more the further away; useful for detailing, but it means a brush size is not a measurement you can rely on. It is ticked by default — a brush size that means something is worth more than one that rescales with the camera — and the radius is then a distance *on the mesh* that stays the same size however you zoom, and the size slider, the `B` drag and the `[` `]` keys all drive that world size — full travel is a brush as wide as the model. The cursor ring grows and shrinks on screen to show it, the strength line with it, and the dabs stay as closely spaced relative to the brush zoomed out as zoomed in. Switching modes keeps the brush the size it looks right now.
- **Orbit around your work** — the pivot follows your strokes, but the view no longer moves when it does. Setting it used to swing the model across the screen at the end of every stroke, which was worse than the problem it solved; a stroke now only records where you were working, and the *next* drag turns about that point, holding it still on screen while everything rotates around it. Panning and zooming keep working through it: `Cmd` or `Shift` + drag pans (a two-finger drag on touch), `Ctrl` + drag off the model zooms, and `F` hands the pivot back to the model's centre. On touch, **two fingers always navigate** — even planted squarely on the model, which is the only place there is once you're zoomed in: a second finger joining a fresh touch-stroke turns the whole thing into the gesture it was meant to be (the accidental dab is undone), while a stroke you'd clearly begun on purpose keeps its work and just hands the camera over. Fingers resting during a Pencil stroke are still ignored.
- **Turntable** — `←` / `→` spin the model about its own centre (never the stroke pivot, so it stays a turntable wherever you've been working), with a much wider acceleration range: a slow wheel creeps at well under a degree a tick, a fast one covers ~20°, and a quick spin coasts briefly before settling (on the clock, so the glide is the same length on any machine).
- **Continue where you left off** — leaving sculpt mode for the gallery snapshots the viewport, and your unfinished sculpt appears there as an "In progress" card. Clicking it drops you straight back in with the scene restored. **New sculpt** is the other tile, and it asks first: entering sculpt mode always restores the autosave, so without the question it would quietly resume the work in progress rather than start anything. Saying yes clears the scene, its recorded frames and the saved look together — "new" means new, so a light left flat in one session does not arrive in the next one lighting a fresh sphere.
- **Zoom with the pen** — `Ctrl` + drag off the model zooms, so an Apple Pencil can frame a shot without a two-finger pinch; drag down to pull back, up to move in. `Ctrl` on the model still paints mask, and a `Ctrl`-click off it still inverts the mask — tap versus drag decides.
- **One top row everywhere** — page actions on the left, global ones on the right, the same chip in every mode and on every page: the gallery, the sculpt view, `/create` and the admin editor all share it, rather than the three different treatments the same idea used to get. The gallery's first tile starts a **New sculpt** for everyone — it used to be a top-row Sculpt chip for guests, and the tile reads much clearer. Guests get **Log in**; signed in it becomes **Projects**, the way back into the editor. **Upload timelapse** is always there.
- **Hotkey guide** — a `?` button beside the Ink/Paper toggle opens it (`H` still works, and isn't reachable on a keyboard-less iPad). The sculpt table is grouped Sculpting / Masking / Navigation / Brushes / Subdiv / Lighting / Interface.
- **Scene keys** — `F` fits the model in view without changing the angle you are looking from (and re-centres the orbit on it); `L` + drag moves the key light — sideways swings it around the model, up and down raises and lowers it, so it can come from anywhere rather than only turning on one axis — the Render panel's elevation/azimuth sliders follow the drag, and the whole rig follows your orbiting like the model is turning in your hand, so the underside is lit when you look at it from below. The `H` hotkey guide switches between the viewer and sculpt tables automatically.
- **Sculpt palette** — a docked Sculpt panel (right edge, below Render): the top section is named for the **active brush** — Polish, Paint, Standard clay — so it is always clear whose settings the sliders drive; brush size and strength sliders with their per-brush pressure dynamics (toggles and response curves) underneath, the active brush's feel sliders (Move falloff, clay-strip shape), mask tools (darken slider, blur/sharpen/invert/clear, and **Extract** with a thickness slider — the masked region becomes a new object), Topology and Remesh live in the **Model** panel now, beside the object's material values. Cavity/SSAO lives in the Render panel with the rest of the shading.
- **Five docked panels** — **File** over **Scene** on the left; **Render**, **Tool** and **Model** stacked on the right, each a labelled tab you pull out. **Tool** (the old Sculpt panel) is everything about how the active brush behaves; **Model** is everything about the selected object's substance: its material values (albedo, roughness, metalness — moved out of Render, where they dressed per-object properties as scene-wide controls), the Topology section and Remesh. Render keeps the scene-wide viewing choices: material mode, matcaps, shading, wireframe, lighting, camera, environment, AO — and now **the full depth-of-field controls**, so a look set while sculpting carries everything the editor could set. The editor's right panel is also called **Render** now (it was "Look dev"), one name across the whole suite. Only one panel per edge is open at a time (they'd cover each other's tab), but a left and a right panel happily share the screen — and an open right panel tucks away the collapsed tabs its body would cover, so the Tool and Model tabs no longer float over an open Render panel; they return the moment it closes. **Scene** is the outliner: each object's row carries an **eye** (visibility) and a **padlock** (edit lock) before the name, and the selected row a **trash can** after it; click selects, **double-click renames** in place. A hidden object drops out of the viewport and out of picking; a locked one stays visible and selectable, but strokes and the transform gizmo refuse it and orbit instead. Both flags ride the autosave and `.bozz` files. Adding goes through a wide **Create** button right under the list (Sphere/Cube/Cylinder/Torus); deleting asks a plain `Delete "Sphere 2"?` — `Ctrl+Z` brings the object back, like any other edit. Sculpting is multi-object, so extractions and added shapes render, sculpt, persist and undo alongside the original. The selection's material dropdown sits beneath Create, and its trailing **New*** entry makes a new material (it asks for a name) — no separate button. **Render** is the old Settings panel, renamed for what it actually does.
- **Matcaps render true, and there are ten more of them** — a matcap is a picture of a sphere, so a rendered sphere should reproduce it exactly; ours didn't (measured against the source PNGs: half brightness, and the blue-grey matcap rendered *brown*). Two causes, both fixed: the sculpt vertex fill multiplied every matcap by the object's albedo (matcaps now render pure — paint and albedo stay stored and keep working in Lit, mask darkening still shows), and the ACES film curve re-graded art that was already display-referred (matcap mode now bypasses tone mapping; the sRGB transform stays). After the fix the rendered sphere matches the source matcap to within ~1%. The matcap set is the ten-strong **VR pack** (Blender format, flattened at import so their transparent surrounds never read white at grazing angles; it replaced the four house matcaps outright), picked from a **thumbnail gallery popout** — a round trigger swatch in the Render panel's Material section showing the active matcap opens the grid beside the panel, and it stays open for rapid A/B-ing until you click elsewhere — keys `2`–`9` still jump to the first eight. **Tone mapping is a choice now, not a constant**: the Camera section offers None (linear), Neutral (Khronos), AgX and Cinematic (ACES, the shipped default), saved with the look — and whatever you choose, matcap mode renders ungraded, because that is the fidelity contract above.
- **Symmetry you can see** — with mirror symmetry on, hovering the model draws a faint dashed ring where the other half of the stroke will land. It is the only always-visible sign that symmetry is on, and it disappears the moment you start drawing: mid-stroke you want the one cursor, on the side you are working (owner call).
- **The corner you actually work in** — the brush size and strength sliders moved to the bottom left, under the File and Scene tabs and clear of the Negative button, with the history buttons below them: **redo above, undo at the bottom**, where a thumb reaches first. Toolbar buttons now brighten on hover in both states; before, the hover tint replaced the button's own background (so the Negative button went *darker*), and pressing a button left it looking untouched until the pointer moved away, because the active rust colour lost to the hover rule.
- **Transform keys moved to `W`/`E`/`R`** — move, rotate, scale, where every other 3D app puts them, with `Q` still returning to the clay. That also gives `T` back to the frame-rate meter, which had quietly become unreachable when scale took the key.
- **A Rake, and dab spacing you can set** — digit `7` is a **Rake**: the clay brush stamping through a stroke-aligned stencil, so it combs grooves instead of laying a smooth ribbon. Smooth keeps the tool, just not the digit — holding `Shift` still smooths from any brush, which is how it was mostly reached anyway. The Tool panel gains a **stencil picker** for the rake (thumbnails, three across, because the difference between "bars" and "fine bars" doesn't survive a small swatch) and a **Spacing** slider for every brush that stamps along a stroke: how far the brush travels between dabs, as a fraction of its radius. Upstream fixed that at 0.15 for everything; it is the difference between a continuous ribbon and a row of separate dabs, and a rake only combs at all when its stamps overlap, so the rake starts at 0.06. Move and Drag don't get the row — they deform from a single anchor rather than stamping. Both the spacing and the chosen stencil ride the autosave and `.bozz` files. (None of the rake needed new machinery: the vendored core already rebuilt a stencil's orientation from the stroke's own direction on every dab, and every tool already multiplied its falloff by the sampled alpha. What was missing was images and a way to choose one.)
- **Why some rake stencils bite and others don't** — worth knowing before you wonder whether the brush is broken. The stencil is mapped onto the square inscribed in the brush disc, so a tine's width on the model is about 0.7× its width in the image; across the nine that lands between 10.7% of the brush diameter and 1.4%. Rendering a stroke through every one of them at a default brush on an unsubdivided sphere sorted them cleanly: **10.7% gives three separated grooves, 6.7% gives fine chattery tines, and below about 6% a tine is thinner than the gap between vertices — it falls between them and the stroke comes out looking like plain clay.** Shape matters as well as width, which is why two stencils sit above that line and still barely register: their tines are *dots* rather than full-height bars, so little of the stroke's length gets covered. The picker is ordered by that result, the default is the widest, and the fine ones are kept because they do come alive on a subdivided mesh or at a much larger brush — not because they work everywhere. One is a deliberate outlier: its hand-drawn strands wander sideways as they run, so it lays down irregular *chatter* rather than grooves, which is a texture worth having. Nine stencils ship; four are ZBrush's stock rake alphas, standing in until hand-authored ones land.
- **Stencils on the clay brush, off by default** — an alpha is not a rake-only idea: the vendored core samples the stencil per vertex inside *every* tool's loop, so what decided which brushes could have one was the panel, not the engine. Standard clay now declares its own set and the Tool panel's stencil picker serves any brush that does, led by an **off** swatch — clay starts there, because its job is a clean ribbon and a texture is something you reach for rather than something you should have to switch off. The **Spacing** slider is the same one, in the same place: it already applied to every brush that stamps along a stroke, and it is what turns a stencil from a row of separate stamps into a continuous texture, so there is no second control to learn. Clay borrows the rake's images for now — and the fine stencils that read poorly as a rake, because their tines comb below the vertex spacing, are the *interesting* ones here, where the job is surface texture rather than separated grooves. Each tool remembers its own stencil, and the choices ride the autosave and `.bozz` files (scenes saved with the older single-rake field still load).
- **The Crease brush's two knobs** — a crease does two things at once and upstream hardcoded the balance: it pulls the surface sideways *toward* the stroke (the pinch, which gathers a ridge into an edge) and pushes it along the normal by a steep power of the falloff (the crest, whose exponent is what makes the cut narrow rather than a dent). Both are the brush's character, and both are sliders now. **Profile** runs from a broad round trough to a knife line — at its softest a stroke moves about four times the material it does at its sharpest, spread wide instead of concentrated. **Pinch** runs from zero, which carves a groove without drawing the surface into it, through upstream's setting and on to a gather that sharpens the edge as the cut deepens. Both start exactly where upstream had them, so the brush feels unchanged until you move something.
- **The review's second pass** — the findings that needed a decision or a bigger change, done after the first batch shipped. **Autosave no longer gives up on the first hiccup**: a write aborted by an iPad app switch used to disable it for the rest of the session with nothing on screen to say so, and hours of sculpting went unsaved; transient failures retry with backoff, and if it truly stops (a full device) the File panel says so where Save file is. **Your work in progress is found again**: the gallery's "In progress" card and the "New sculpt" confirmation used to key off the thumbnail, which is only written when you leave through the Gallery link, so closing the tab left saved work with no card at all and a "New sculpt" that silently resumed it. Both now ask the storage itself. **The brush unit stopped rescanning the mesh**: world-scale sizing measured the model by walking every vertex, three to six times per pointer event, which on a subdivided sculpt cost about a millisecond a call; it reads the bound the engine already keeps. Publishing a very long reel fails immediately with the count instead of after uploading every frame, and the single-file export no longer risks a broken file (a stage description containing `<!--<script` could end the inline script early) or an out-of-memory tab (it built tens of millions of tiny strings while encoding).
- **A full code review, and what it caught** — every subsystem read against a checklist of bugs, correctness, performance and security, with each finding reproduced before it was fixed. The ones you would have felt: opening a `.bozz` file wiped the colours off every painted object; a corrupt or half-written file emptied the scene *before* rebuilding, so a bad file cost you the work on screen; two-finger navigation left a stray dab once a session passed ~64 edits; orbiting with the paint brush selected quietly marked the object "painted", after which the material colour stopped applying (and it stuck, across saves); the transform gizmo could not be dragged by touch at all, only by mouse; a published *painted* model carried its colours in a layout WebGPU refuses, so it rendered only on the WebGL2 fallback; objects hidden with the eye were still baked into published models and captured frames; holding `Ctrl+D` walked the mesh up several subdivision levels at the key-repeat rate; and a stroke that landed while an autosave was in flight was never rescheduled. Paint and mask strokes also stopped re-uploading an attribute they never touched, which halves the per-step GPU traffic on dense meshes. On the server side: the admin editor's error page no longer injects a URL parameter as HTML, uploads are size-capped, saved project fields are shape-checked, and the admin gate can verify the Cloudflare Access JWT itself rather than trusting a header (set `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`).
- **Panels show only what applies** — a control whose master switch is off no longer sits there dead: each light in the rig folds down to its checkbox while disabled, the depth-of-field Aperture/Focus rows hide until DoF is enabled, the ground's surface sliders appear only for a floor or pedestal (and the width slider only for the pedestal), the **Bg colour** swatch only for a solid-colour background, and the HDRI knobs — intensity, rotation and background blur, now grouped together right under the picker — vanish while no HDRI is loaded. The same rule runs through the other palettes: dynamic topology's stroke sliders and the pen-pressure **curve** selectors fold away with their checkboxes. In both sculpt and the editor; the panels got noticeably shorter without losing a control. The panel scrollbar is themed to match (a slim panel-border thumb instead of the browser slab).
- **Boot splash** — entering sculpt mode plays the handwritten Bozzetto logo writing itself (2.5 s) over the loading overlay, in an ink or paper variant to match the theme — the videos' backgrounds are the design system's warm ink and paper, so they melt into the page. It plays **once per browser session**: the first sculpt boot says hello, later loads go straight to work. A tap skips it, it can never hold the boot past a few seconds even if the video fails to load, `?nosplash=1` suppresses it outright (automation), and `prefers-reduced-motion` keeps the plain loading text.
- **Timelapse capture** — sculpting records itself, Procreate-style: after each stroke (in idle time, never during one) the scene is snapshotted, quantized and gzipped to a timelapse frame by a worker, and stored in the browser alongside the autosave — captured frames survive reloads. The File panel's Capture section shows a live frame/size readout with a record toggle and a Clear button; capture stands down by itself past a ~500 MB frame budget. Recording starts **off for guests** (they have no way to publish the frames, so it would only spend their storage) and on for a signed-in admin; the toggle's choice sticks across sessions either way.
- **Hide the interface** — `Tab` works in two stages: the first press closes any open panel, and a second, with nothing left open, clears the standing interface — the panels and their docked tabs, the brush row, the Gallery link and the theme toggle. What stays is what you work with and read: the brush sliders, undo/redo, the Negative button, the object stats, and any toast, tooltip or hotkey guide. The toolbar's hide button stays too, so there's always a visible way back on a device with no `Tab` key; `Esc` also exits, and the state never survives a reload. The prompt fades as you learn it — spelled out the first couple of times, then a whisper, then nothing.
- **Save, open, export** — the File panel keeps your work beyond the browser: **New scene** starts over from a clean sphere (clearing any recorded frames, after asking), **Save file** writes the full scene (every object, the whole subdivision stack, masks, symmetry) as a compact `.bozz` file, **Open file** loads one back (asking first if the current scene holds work that is not already in a file, and clearing the old scene's recorded frames along with it, so a timelapse never spans two scenes), **Export OBJ** writes the visible scene for other apps, and **Import OBJ** below it brings a mesh in as a new sculptable object (with a **Z-up** toggle for DCC exports — Blender and friends — and the same weld/normalize path the primitives use, so an import sculpts, persists and undoes like anything else). All of it stays on your device — the sculpt page is public, and nothing uploads.
- **Publish to the gallery (admin)** — signed in through Cloudflare Access, two extra forms appear in the File panel: publish the captured **timelapse** as a real gallery project (each frame a normal Bozzetto GLB frame), or publish the current scene as a single-frame **model** project. Guests never see these; the endpoints are Access-gated regardless.
- **Symmetry controls** — the palette gains a Symmetry section: the mirror checkbox (synced with the `X` key) and an X/Y/Z axis choice per object, both remembered by the autosave.
- **Side sliders** — two minimal vertical sliders on the left edge, Procreate-style: brush size (log-scaled) and strength. Dragging shows a centered preview ring so you see the size land; the nubs track every other way of changing the brush (keys, `B`/`S` drags, tool switches). Below them, **undo/redo buttons** (again where Procreate puts them): tap to step, hold to walk the history, greyed out when there's nothing left in that direction — no keyboard needed on the iPad.
- **Wheel-friendly keys** — made for mapping to controller wheels (TourBox and friends): `[` / `]` step brush size, the two keys below them (`;` / `'`) step strength (with a brief on-screen ring and strength line so you see both without hover), and `←` / `→` turn the model one degree per tick, accelerating up to 8× when the wheel spins fast.
- **Web app** — a web-app manifest plus home-screen icons: add Bozzetto to your iPad or phone home screen and it launches fullscreen as its own app. The icon is the handwritten **B** from the new Bozzetto logotype, cream on warm ink — the design asset lives in `scripts/icons/bozzetto-icon-ink.svg` and ships as the SVG favicon plus rasters (the earlier Flaticon *sculpture* glyph and its `generate-icons.mjs` treatments remain in `scripts/` for history). The full wordmark waits in `public/assets/bozzetto-script-{ink,paper}.svg` for the gallery. The manifest was always there, but nothing ever said so: a guest's top row now offers **Install**, a short card with Safari's Add to Home Screen steps (share button, top right on iPad, bottom on iPhone; Chrome's equivalent gets a line too). It hides itself when already running installed.
- **Reload-safe sculpting** — your sculpt autosaves to the browser (IndexedDB) after every edit, in idle time so strokes never pay for it. Reload the page or get evicted by iOS and the sculpt comes back exactly as it was — the full subdivision-level stack included, one better than SculptGL's own session save — with a "Start fresh" escape hatch. Very large meshes (past ~1.6M triangles) save on a five-minute cadence instead of after every edit. Undo history doesn't survive a reload. The scene format is at **v4**, which adds the material library, each object's assignment and whether it has been painted, plus each object's outliner flags — hidden and locked; v3 files still open, and simply take the default material — their per-vertex colours were always saved, so they look exactly as they did.
- **The look comes back too** — lighting, environment, AO, material, shadows and the camera are saved with the session, under their own key so a slider drag never rewrites a multi-megabyte vertex payload. Leave for the gallery and come back and the studio is as you left it. A `.bozz` file carries its look as well, so opening one restores the lighting it was saved in, and publishing a sculpt to the gallery publishes the look with it — the same fields the editor's **Save look** writes. Because it persists, it needs a way out: **Reset look**, at the top of the Render panel's Lighting section, goes back to the defaults sculpt mode starts from and forgets the stored one, so a look set up badly is never permanent.
- **UI polish** — interface text and links are unselectable (modifier-heavy sculpting kept selecting button text); real text fields still select normally.
- **Viewer change** — the `B` depth-of-field hotkey is removed (DoF lives in the Render panel); in sculpt mode number keys select brushes instead of materials.

Still ahead: playing captured sculpt timelapses with a recorded camera track, and pacing modes for playback/export.

### v1.01

Bug fixes and UI polish.

- **Context-aware loading** — the overlay now reads "Loading model…" or "Loading timelapse…" to match the project, and reports the environment as its own load phase so the HDRI is ready before the subject appears.
- **Compressed frames** — newly converted frames are written as gzipped GLBs with int16-quantized positions and no stored normals (the viewer recomputes them), roughly 3–4× smaller, so timelapses load and buffer much faster. Existing timelapses keep playing unchanged and get the smaller format when re-published.
- **Playback buffering** — timelapse playback now waits for a few frames to load before starting (and whenever loading falls behind) instead of silently skipping ahead. A bar under the scrubber shows which frames are loaded, and a "Buffering…" pill appears while playback catches up. The whole timelapse is buffered in the background when it fits in memory (a device-sized budget), so the bar fills once and playback, looping, and scrubbing stay instant.
- **DoF Controls and focus** — You can now set the focus by double-clicking directly on the model (or a double-tap on touch devices), rather than using the slider in the panel.
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
- **Gallery** of portrait thumbnails.

## Make your own (no sign-in)

The quickest way to get started is the public editor at [`/create`](https://bozzetto.vidarrapp.se/create/). It runs entirely in your browser: you build a timelapse and download it as a single self-contained `.html`. Nothing is uploaded, and there is no account to set up!

1. Open [`/create`](https://bozzetto.vidarrapp.se/create/).
2. Drop in a sequence of `.obj` or `.glb` files, one mesh per stage of your sculpt, named so they sort in order. Tick **OBJ files are Z-up** if they came from a Z-up tool such as Blender. They convert in the browser as the progress bar fills.
3. Give it a title (it names the downloaded file), pick **Timelapse** or **Model**, and set the playback FPS — the preview picks the rate up live.
4. Set up the look in the floating panel on the right: lighting, material, environment, and camera. Orbit to the angle you want.
5. Optionally add **stages** to mark and name key frames; they become markers on the exported file's scrubber.
6. Press **Export .html**. You get one file with the viewer, frames, and assets all inlined. It opens offline straight from disk, so you can email it, drop it in a shared folder, or keep it as an archive.
7. You can also export MP4/GIF timelapse or turntable animations with the **Record reel** section.

A single mesh works too: drop one file and you get a shareable 3D model on one HTML page. To publish timelapses to the gallery instead of downloading a file, use the full editor at `/admin/` (see the tutorial below).

## Features

### Gallery

- The landing page lists published projects as thumbnail cards (badged *timelapse* or *model*, with a frame count), and leads with a **New sculpt** tile — plus your own "In progress" sculpt when one is waiting.
- The top row keeps **Install** (for visitors who haven't added the app yet), **Upload timelapse**, and **Log in** — which becomes **Projects** for the signed-in owner.

### Viewer

- Per-frame geometry streaming. Frames are stored as gzipped, position-quantized GLBs (roughly 3–4× smaller than the raw meshes) and unpacked natively on load; earlier uncompressed frames still play unchanged. One persistent mesh has its geometry swapped each frame, with the frames near the playhead prefetched eagerly and the rest of the sequence filled in slowly in the background. A timelapse that fits the device's memory budget ends up buffered whole — scrubbing and looping never reload — while larger ones keep the budget's worth of frames around the playhead. If loading falls behind, playback buffers — waiting for a short run of frames instead of skipping ahead — with a loaded-frames bar under the scrubber and a buffering indicator.
- Renders on WebGPU through three.js's node-based renderer, with an automatic WebGL 2 fallback when WebGPU is unavailable; the same materials, shadows, ambient occlusion, and depth of field run on either backend.
- Real-time relighting with a multi-light rig — two presets (Three-point, and a raking key for form studies), per-light toggles and colours, a master shadows switch, rig rotation — and soft (VSM) shadows.
- Material modes: lit PBR (albedo, roughness, metalness) and matcaps, plus a wireframe overlay, each with smooth or flat shading.
- HDRI image-based lighting (PMREM) with selectable environments, three background modes (theme colour, solid colour, blurred HDRI), and separate rotation for the light rig and the HDRI.
- Ground-truth ambient occlusion (GTAO) with adjustable strength and radius, composited in the node post-processing graph. It can be turned off.
- Depth of field (a node-based gather): aperture and a focus plane that tracks the orbit target. Off by default.
- A device quality tier plus adaptive quality that backs off render cost when the frame rate drops.
- A DCC-style camera (orbit, pan, dolly) with a saved camera per project, a light/dark theme, an on-screen hotkey guide, and a bottom transport bar with a scrubber and stage markers.

### Sculpt mode

- Ten brushes on `1`–`0`: Crease, a volumetric **Move** that can grab a silhouette from just outside it, **Standard clay** laying ribbon-like strips, Inflate, Pinch, Flatten, a **Rake** that combs grooves through a stroke-aligned stencil (nine to pick from; `Shift` still smooths from any brush), Drag, an hPolish-style **Polish** that flattens surfaces while keeping edges crisp (with a Plane lock slider from *follow* to *flatten*), and **Paint**. Apple Pencil pressure drives strength through the stroke; per-brush pressure response is configurable (toggles + curves).
- **Masking** (`Ctrl` paints, darkens on the model, resists every brush) with blur/sharpen/invert/clear and **Extract** — the masked region becomes a new object. **Mirror symmetry** with a per-object axis choice.
- **Topology**: a multiresolution stack (discrete level slider, Subdivide, and Rebuild — reversion that adds a *coarser* level), dynamic topology with stroke detail sliders, and voxel remesh.
- **Vertex painting & per-object materials**: paint albedo with an HSV picker (alt-click samples off the model), assign named materials per object, and edit a material's albedo/roughness/metalness in the Model panel. Paint is colour-only; the surface response stays the material's.
- **Object transforms**: a unified move/rotate/scale gizmo from the toolbar, single modes on `W`/`E`/`R`, `Q` back to the clay; multi-object scenes with an outliner (visibility eyes, edit locks, double-click rename).
- **Five docked panels**: File and Scene on the left; Render (scene-wide look: lighting, AO — cavity SSAO or GTAO — depth of field, environment, camera, material mode/matcaps/shading), Tool (the active brush's settings) and Model (the object's material values, Topology, Remesh) on the right.
- **A real look**: everything the editor's Render panel can set works while sculpting, persists with the session and with `.bozz` files, publishes with your models, and resets in one click.
- **Timelapse capture**: idle-time mesh snapshots after each stroke, stored locally, publishable to the gallery when signed in as the admin (Cloudflare Access).
- **Files**: `.bozz` save/open (the full scene — every object, subdivision stack, masks, materials, look), **OBJ import** (Z-up toggle for DCC exports) and **OBJ export**. All device-local for guests.
- **Made for iPad**: two fingers always navigate (even on the model), a resting palm never blocks the Pencil, the toolbar covers keyboard-less use, and `Tab`'s hide-the-interface staging keeps the screen clean.
- **Reload-safe**: every edit schedules an idle-time autosave to IndexedDB (huge scenes save on a slower cadence; past ~8M triangles the last in-budget save is what restores). An unfinished sculpt shows in the gallery as an "In progress" card — its picture and counts reflect the last time you left sculpt mode for the gallery; work abandoned by closing the tab still restores through the New sculpt entry.

### Public editor (`/create/`)

- No sign-in and no backend. Frames are converted and held in the browser; nothing is uploaded.
- The preview is the real viewer, with the same floating Render panel as the full editor.
- One button exports a self-contained `.html` with the viewer, frames, and assets inlined, ready to share or archive.

### Editor (`/admin/`)

- Create a project from a title (the id is slugged from it), then drag and drop a sequence of `.obj` or `.glb` files.
- OBJ to glTF-binary conversion runs in the browser inside a Web Worker, with conversion and upload overlapped.
- The preview is the real viewer. Set up lighting, material, environment, AO, and camera in the floating panel, then use Save look to store the exact opening state.
- Mark stages (named frames with a short description) that appear on the scrubber, and capture any frame as the gallery thumbnail.
- Full-window preview with floating side panels that slide out of the way (press Tab to hide them).
- Export a finished timelapse as one self-contained `.html`, with the viewer, frames, and assets all inlined, that opens offline straight from disk.
- **Record reel**: export the timelapse or a turntable spin (2–8 s, either direction) as MP4 (H.264, where the browser has WebCodecs) or GIF, at 1080p/720p (or 480p/360p GIF), with a choice of aspect.
- A **Settings** block renames the project, sets its playback FPS (1–30), and switches it between a timelapse and a single-frame model.
- The project list at `/admin/` shows every project with its thumbnail; from there you open the editor or the live viewer, or delete a project (uploaded meshes included).

### Platform

- Serverless on Cloudflare: project metadata in D1 (SQLite), binary meshes in R2, and every API route as a Pages Function.
- Admin writes sit behind Cloudflare Access. Public reads and the viewer are open.
- A dependency-free Node CLI (`scripts/obj-to-timelapse.mjs`) produces the same compact frame format as the in-browser converter (identical geometry; the gzip streams may differ byte-wise), so timelapses can also be built offline.

## Controls

| Input | Action |
| --- | --- |
| Left drag | Orbit |
| Middle drag, or `Cmd` / `Shift` + drag *(two-finger drag on touch)* | Pan |
| Right drag / scroll | Zoom |
| `Space` | Play / pause |
| `←` `A` / `→` `D` | Step frame |
| `F` | Focus (frame the model) |
| Double-click *(double-tap on touch)* | Set focus point (tap-to-focus) |
| `1` | Lit (PBR) |
| `2`–`5` | Matcaps |
| `S` | Smooth / flat shading |
| `W` | Wireframe overlay |
| `G` | Cycle ground (shadow / floor / pedestal / off) |
| `Tab` | Show / hide panels |
| `H` | Hotkey guide |

### Sculpt mode

| Input | Action |
| --- | --- |
| Drag on the mesh | Sculpt (`Alt` carves, `Shift` smooths) |
| Drag off the mesh | Orbit (around your last stroke; `F` re-frames) |
| Two-finger drag / pinch | Pan / zoom — always, even on the model |
| `Ctrl` + drag | Paint mask (`+Alt` unmasks); off the mesh: drag zooms, tap inverts the whole mask |
| `Ctrl` + `C` / `I` / `H` / `E` | Clear / invert / hide mask · extract masked region |
| `1`–`9`, `0` | Brushes (Crease, Move, Clay, Inflate, Pinch, Flatten, Rake, Drag, Polish, Paint) |
| `B` / `S` (hold + drag) | Brush size / strength (`[` `]` and `;` `'` step them) |
| `X` | Mirror symmetry (hovering shows a faint mirrored brush ring) |
| `W` / `E` / `R`, `Q` | Move / rotate / scale gizmo · back to sculpting |
| `T` | Frame-rate meter |
| `Ctrl`+`D`, `D` / `Shift`+`D` | Subdivide · step subdivision level |
| `←` `→` | Turntable (repeats accelerate; wheel-friendly) |
| `G` | Cycle the stage (floor / pedestal / off) |
| `L` (hold + drag) | Move the key light (across / up) |
| `Shift`+`S` | Shadows on / off |
| `Ctrl`+`Z` / `Ctrl`+`Shift`+`Z` | Undo / redo |
| Double-click a Scene row | Rename the object |
| `Tab` | First press closes panels, second hides the interface; `Tab` or `Esc` brings it back |

A few URL switches help when debugging the renderer: `?dev` reveals a developer section in the control panel, and `?q=low|medium|high` forces a quality tier.

## Getting started

Requires Node 18 or newer.

### Gallery

- The landing page lists published projects as thumbnail cards (badged *timelapse* or *model*, with a frame count), and leads with a **New sculpt** tile — plus your own "In progress" sculpt when one is waiting.
- The top row keeps **Install** (for visitors who haven't added the app yet), **Upload timelapse**, and **Log in** — which becomes **Projects** for the signed-in owner.

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
    quality.ts             device quality tiers
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
- Admin auth: put a Cloudflare Access application in front of the admin surface (`/admin*`, including `/admin/api/*`). Add every hostname you edit from, both the `*.pages.dev` domain and any custom domain, or writes from an uncovered host will return 403. You can also set an `ADMIN_EMAILS` var to limit which identities may write. **Recommended**: also set `ACCESS_TEAM_DOMAIN` (your `<team>.cloudflareaccess.com` host) and `ACCESS_AUD` (the application's audience tag) — with both present the admin routes verify the Access JWT itself (signature, audience, issuer, expiry) rather than trusting the injected email header, which is only unforgeable while an Access application actually fronts every admin hostname.
- Production is served at `bozzetto.vidarrapp.se`, attached as a custom domain on the Pages project.

`wrangler.toml` is gitignored; the committed `wrangler.toml.example` is the template. Production bindings live in the dashboard rather than the repo.

## Credits

- Sculpt mode is built on [SculptGL](https://github.com/stephomi/sculptgl)'s editing core — MIT, by Stephane GINIER; the vendored source and its license live in `src/sculpt/vendor/`.
- Toolbar icons: [Uicons by Flaticon](https://www.flaticon.com/uicons) (`@flaticon/flaticon-uicons`, solid straight style). The app icon is the handwritten Bozzetto **B** (house artwork); the earlier `sculpture` glyph stays in `scripts/icons/` for history.

## License

MIT — see [LICENSE](LICENSE).
