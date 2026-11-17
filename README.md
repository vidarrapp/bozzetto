# Bozzetto

<img width="1180" height="820" alt="Bozzetto Screenshot" src="docs/screenshots/bozzetto.jpg" />

A *bozzetto* is the small clay study a sculptor makes before the real piece, where the rough form gets worked out.

Bozzetto is a studio in the browser to pose, sculpt and present. Set up a mannequin for reference or as the start of a figure, sculpt in clay with an Apple Pencil or a mouse, then light it, render it and publish it. The four workspaces follow that order: **Armature**, **Sculpt**, **Paint**, **Present**.

It installs to an iPad's home screen and works offline. Built as a study and teaching tool, and as a way to render out content. Shared under MIT for anyone who finds it useful.

**Live at [bozzetto.vidarrapp.se](https://bozzetto.vidarrapp.se)**

## Install as an app

Bozzetto installs to the home screen and opens fullscreen. That is the way to use it on an iPad. The gallery's **Install** button walks you through it.

- **iPad and iPhone (Safari):** Share button, **Add to Home Screen**, **Add**.
- **Android (Chrome):** the **⋮** menu, **Add to Home screen**, confirm.

Installed, it works offline: the app, the base meshes, the mannequins and the default lighting are all on the device. Updates download in the background and a notice says when one is ready.

Your work autosaves on your device. Nothing uploads unless you sign in and save or publish. There are no analytics and no ads. Deleting the app deletes the work kept on the device, so save a file or sign in for anything you want to keep.

## Armature

<img width="1180" height="820" alt="Bozzetto Screenshot - Armature mode" src="docs/screenshots/armature.jpg" />

A posable figure, for reference or as the start of a sculpt. Pick **Create → New Armature** in the gallery. No sign-in needed.

- **Figures.** Four mannequins, male and female in realistic and stylized proportions, plus two block figures. You can also load your own rigged `.glb`.
- **Pose.** Tap a part to turn its joint, held within the joint's limits. Symmetry (`X`) mirrors the pose to the other side.
- **Reach.** Drag the ring at a hand or a foot and the limb follows. Pin a ring to hold it in place while the rest of the figure moves. An arrowhead out from each knee and elbow aims the bend, and the one in front of the face makes the head, neck and a little of the back look at it.
- **Feet on the floor.** Feet stand flat on the floor and stay planted through a crouch or a lean.
- **Proportions.** Change the size and length of each part.
- **Send to Sculpt.** Turns the posed figure into one clay object and opens it in Sculpt.
- **Files.** The figure autosaves and shows as a card in the gallery. **File → Save** writes an `.armature` file.

## Sculpt

<img width="1180" height="820" alt="Bozzetto Screenshot - Sculpt mode" src="docs/screenshots/sculpt.jpg" />

Pick **Create → New Sculpt** in the gallery. No sign-in needed, and nothing leaves your device unless you sign in and save or publish.

- **Brushes.** Nine on `1` to `9`: Crease, Move, Standard clay, Inflate, Pinch, Flatten, Rake, Drag and Polish. `Shift` smooths and `Alt` carves from any brush. Each brush keeps its own size and settings.
- **Pencil pressure.** Apple Pencil pressure drives the strength of the stroke. Strength is set in centimetres for the brushes that push the surface.
- **Profile curves.** Clay, Crease, Polish and the Rake's tines each have a falloff curve you can edit, with presets.
- **Masking.** Paint a mask with `Ctrl`, mask one side of an edge loop with `Ctrl`+`Shift`+drag, and extract a masked region as a new object.
- **Poly groups.** Split an object into coloured groups by mask, by angle or by piece. Show, hide and mask by group.
- **Topology.** Subdivision levels, dynamic topology, voxel remesh and quad remesh.
- **Symmetry.** Mirror across X, Y or Z, set per brush.
- **Materials.** Set a material per object. Painting has its own workspace, **Paint**.
- **Objects.** Several objects in one scene, with a list to select, hide and lock them, a move, rotate and scale gizmo, and Duplicate, Mirror, Radial copies and Merge.
- **Create.** Primitives at real sizes and a library of base meshes: figures, heads, hands, feet and skulls.
- **Real sizes.** One unit is a centimetre, and the interface shows centimetres and millimetres.
- **Files.** Save and open `.bozz` scenes. Import and export OBJ, keeping the file's vertex order where it can.
- **Made for iPad.** Fingers orbit, pan and zoom. The Pencil sculpts. A resting palm is ignored.
- **Autosave.** Work in progress is kept on the device and shows in the gallery as an **In progress** card.

## Paint

<!-- Screenshot slot for the owner: docs/screenshots/paint.jpg, 1180x820, Paint with the Layers tab open. -->

Colour the model in layers. Open **Paint** from the path at the top, with **View**, **Paint**, or with `Shift`+`B`; the same scene as Sculpt, so go back and forth freely. Paint adds `?paint=1` to the address, so a reload opens it again.

- **Six tools.** Paint, Erase, Blur, Fill, Pick and Project on `1` to `6`, with Select on `Q`. Paint takes `Alt`+click to pick a colour and `Shift` to blur. The brush's size, strength, falloff, pressure and symmetry, the mask and hidden poly groups work as they do in Sculpt.
- **Paint layers.** A **Layers** tab with an eye, a name, a blend mode and an opacity a layer, newest on top, over a fixed **Base** (the colour the object had), which you can paint on too. Drag a layer by its handle to reorder; the menu has Rename, Duplicate, Merge down, Clear and Delete, and **Flatten all** is at the foot.
- **Blend modes.** Photoshop's 27, in its groups: Normal and Dissolve, the darken, lighten and contrast groups, Difference and its kin, and Hue, Saturation, Color and Luminosity.
- **Project.** Paints a reference picture that is in the view onto the model under the brush, through the brush's falloff, onto the points that face you.
- **Any level.** Paint on any subdivision level; the colour is kept on the highest one and every level shows it. Remesh and the like ask once to flatten both the sculpt and the paint layers.
- **Saved with the scene.** Layers, modes and opacities are saved in the `.bozz` file and the autosave; publishing and export use the colours as they show.

## Present

<img width="1180" height="820" alt="Bozzetto Screenshot - Present mode" src="docs/screenshots/present.jpg" />

Light the piece, render it and publish it. Open **Present** from the path at the top of Sculpt, or with `Shift`+`P`.

- **Render.** Lights with soft shadows, environment lighting, ten matcaps, tone mapping, ambient occlusion, depth of field, ground and background.
- **Turntable.** A slow turn around the piece. `Space` starts and stops it.
- **Output.** **Save image** saves a PNG. **Record reel** saves a turntable or a timelapse as MP4 or GIF, with a choice of aspect.
- **Publish.** Signed in, publish the piece as a model. It opens for others at the camera and look you set, and the card picture is your view.
- **Frames.** A timelapse is a sequence of `.obj` or `.glb` files, one per stage. Add them on the **Frames** tab, name the stages, and set the playback speed.

## Gallery and viewer

- **Gallery.** The site's templates as cards, led by a **Create** tile with **New Sculpt**, **New Armature**, **Import OBJ** and **Create timelapse**. Your work in progress and the scenes kept on your device show here too.
- **Viewer.** A published model or timelapse plays as real geometry, not a video. Orbit it, relight it, change the material, and scrub a timelapse stage by stage.

## Accounts and Community

Sculpting and posing need no account. An account lets you keep work on the site and share it. Joining is by invite, and signing in uses a passkey or a code sent by email.

- **My projects.** Your saved scenes, models and timelapses, with your storage use. Open, rename, download or delete them.
- **Community.** Work that members share, newest first. Sort it, search by title or handle, and star what you like.
- **Sharing.** A model or timelapse in My projects has a **Share to Community** switch. Shared work is reviewed before it shows. It is to look at: there is nothing to download or copy.
- **Report.** **Moderation**, then **Report…** in the viewer sends a reviewer a report.
- **Account.** Change your handle and address, manage passkeys, see where you are signed in, download your data, or delete the account.

## Controls

Every key can be changed under **Edit → Preferences**. **Help → Hotkeys** (`H`) lists the keys as they are set. Double-click a slider to type a value.

### Everywhere

| Input | Action |
| --- | --- |
| Left drag, or one finger | Orbit |
| Middle drag, `Shift`+drag, or two fingers | Pan |
| Right drag, scroll, or pinch | Zoom |
| `F` / `A` | Frame the model / the whole scene |
| `Tab` | Hide and show the interface |
| `H` | Hotkeys |
| `Ctrl`+`Z` / `Ctrl`+`Shift`+`Z` | Undo / redo |

### Armature

| Input | Action |
| --- | --- |
| Tap a part | Select it and turn its joint |
| Drag a ball | Reach with that hand, foot or head |
| Drag a small ball | Aim that knee or elbow |
| Drag the ball in the hips | Move the whole figure |
| `X` | Symmetry on or off |
| `W` / `E` / `R` | Move the pelvis / rotate the selection / scale the selected part |
| `Shift`+`R` | Reset the pose |
| `Ctrl`+`Enter` | Send to Sculpt |

### Sculpt

| Input | Action |
| --- | --- |
| Drag on the model with the pen or mouse | Sculpt (`Alt` carves, `Shift` smooths) |
| `1` to `9` | Brushes |
| `B` / `S`, held while dragging | Brush size / strength |
| `X` | Symmetry for the current brush |
| `Ctrl`+drag | Paint a mask (`Alt` unmasks) |
| `Ctrl`+`Shift`+drag across the model | Mask one side of an edge loop |
| `Ctrl`+`A` / `C` / `I` / `E` | Mask all / clear / invert / extract |
| `Ctrl`+`G` | Masked faces into a new poly group |
| `Shift`+`F` | Poly group colours on or off |
| `Ctrl`+`Shift`+click | Show one poly group alone |
| `Q` | Select tool |
| `T`, or `W` / `E` / `R` | Transform gizmo, or move / rotate / scale alone |
| `Alt`+`Q` | Solo the active object |
| `Ctrl`+`D` | Subdivide |
| `Ctrl`+`M` / `Ctrl`+`J` | Mirror / merge the selected objects |
| `Shift`+`W` | Wireframe |
| `Shift`+`B` | Paint |
| `Shift`+`P` | Present |

### Paint

| Input | Action |
| --- | --- |
| `1` to `6` | Paint, Erase, Blur, Fill, Pick, Project |
| `Alt`+click | Pick a colour (with Paint) |
| `Shift`+drag | Blur the paint (with Paint) |
| `Q` | Select tool |
| `Shift`+`B` | Back to Sculpt |
| `Shift`+`P` | Present (and back to Paint) |

The size and strength keys, symmetry, the mask, undo and redo, subdivision and the view keys are as in Sculpt.

### Present and the viewer

| Input | Action |
| --- | --- |
| `Space` | Play or pause (in Present, the turntable) |
| `←` / `→` | Step a frame |
| `1`, `2` to `9` | Lit, or a matcap |
| `Shift`+`S` | Shadows on or off |
| `G` | Cycle the ground |
| `L`, held while dragging | Move the key light |
| `Esc` | Leave Present |

## Changelog

### Unreleased

- **Render leaves Sculpt, and Present gets Lighting, Camera and Render.** Sculpt and Armature have no Render tab any more. Present has three tabs at the left: **Lighting** (the rig, the lights, the HDRI as a light), **Camera** (lens, depth of field) and **Render** (tone, ambient occlusion, background and ground, and Reset look at the foot). The public viewer shows **Lighting** alone, after Material. In Present of a published project, Frames and Project now stand at the right.
- **Lighting rigs.** The Lighting tab has a Rig list: Three-point, Key only, Rembrandt, Butterfly, Split, Rim, Top light, Under light, Soft front and Raking key. **Save rig…** keeps the lights under a name on this device; **Manage** renames, deletes and exports a rig as a small `.bozzrig` file, and **Import rig…** reads one, so rigs can be passed on.
- **Move light from the View menu.** Without a keyboard, View, **Move light** makes the next drag on the view move the key light, then lets go (Esc cancels). Holding L still works. Cavity shading is now a switch on the Material tab in Sculpt.
- **A Paint workspace.** Painting moves out of Sculpt into its own workspace, **Paint**, between Sculpt and Present in the path at the top (`Shift`+`B`, or **View**, **Paint**). Its bar has Paint, Erase, Blur, Fill, Pick and Project on `1` to `6`, and its **Layers** tab keeps the colour in layers over a **Base**, each with an eye, a blend mode from Photoshop's list and an opacity, and a handle to drag it into another place. Paint on any subdivision level; Merge down, Clear, Duplicate and Flatten all are there, and every change undoes in one press. **Project** paints a reference picture in the view onto the model. Sculpt loses its Paint brush and the `0` key, which is free.
- **Details in the view.** The object's numbers moved out of the top bar into plain text at the top left of the view: its name, Tris, Quads, Verts, Level, Objects, Size in cm, Symmetry, Masked, Hidden groups and the active layer in Sculpt, and the figure's name, height and selected joint in Armature. **View > Details** (or Shift + I) hides and shows it, and the Pencil and fingers work straight through it. The top bar keeps only the scene's name and where it is saved.
- **Sharper, smoother shadows when you stop.** On iPad and other devices that draw simpler shadows, the shadow is drawn at full size and with more blur samples as soon as the view is still, so edges are crisp and a high Softness stays smooth. While you stroke or turn the view nothing changes. Strong iPads (eight cores) now start on the medium quality tier instead of the low one, and step down by themselves if frames get slow.
- **Controls drawn as outlines.** In Armature the handles are now grey outlines like an animation program's controls, not coloured balls: a ring at each hand and foot (with a dot when pinned), a frame round the hips, and an arrowhead out from each knee and elbow on a dashed line. They turn white under the pointer and orange only when selected or dragged, and each can be picked with a finger.
- **The head looks.** The head's handle is now a look-at arrowhead in front of the face. Drag it and the head turns to face it, with the neck turning about half as far and the upper back a little, held within a comfortable range; it no longer pulls the body around. Old figures open as they were, and the head's pin is gone.
- **Sculpt layers.** A new **Layers** tab on the left, after Model, keeps what you sculpt on separate layers, newest on top, with **Base** at the bottom. Each layer has an eye, a name and a weight slider from 0 to 100%; double tap the slider and type a value to go further, or below zero (-100 turns the layer inside out). Work on any subdivision level, step up and down, and the layer's slider moves all of it. Duplicate, **Flatten into base** and Delete are in each row's menu, and **Flatten all** is at the foot. Layers are saved with the project; remesh, merge and the like ask to flatten them first.
- **Clearer Create window.** New Sculpt is the one lime, recommended choice, and Create timelapse is shown to the owner only, since timelapses are not offered to users right now. Help now opens with Armature, Sculpt and Present.
- **Slider names when you use them.** The Size and Strength sliders at the left edge name themselves while a finger, the Pencil or the mouse is on them, and on a mouse hover, and are plain lines otherwise. Solo, Negative, Undo and Redo show their name on hover and when you hold them.
- **A hotkey guide that fits.** Esc closes it, it scrolls inside when the window is short, the keys stay on one line, the descriptions line up, and its gestures cover touch and the Pencil.
- **Buttons and badges in Familjen Grotesk.** The Create tile and window, the In progress badge and other buttons and badges are in sentence case instead of Martian Mono capitals, and Help's Close is a plain button.
- **Panel labels without hotkeys.** The Render panel says Wireframe, and the key is in its tooltip and the View menu.
- **A truthful lighting preset.** Sculpt opens with the key light alone and the Preset now says Key only (Three-point has the fill and rim on). Change a light and it reads Custom. Saved scenes look as they did.
- **Questions in the app's own window.** Delete, New sculpt, Delete highest level, opening over work in progress, Close without saving and the like now ask in a Bozzetto window that names the thing and puts the verb on the button. Anything that loses work is a red button with the focus on Cancel; Esc or a tap outside cancels.
- **Material moves to the right.** The Material tab is now on the right everywhere, next to Render: Tool, Material, Render in Sculpt; Material, Render in Armature, the viewer and review; Material, Render, Output in Present. Material and Render share a side, so opening one closes the other.
- **View on the pages.** The gallery, Community, My projects, Account, Review and Owner tools now read File, View, Help, with View listing the pages.
- **Every scene has a name.** The top bar in Sculpt and Armature always starts with the scene's name, "Study 14 Nov" for a new one (numbered if you already have one by that name). Tap the name to rename it, or use **File > Rename…**, and the gallery's In progress card shows the same name.
- **Where your work is kept.** A quiet word after the name says **Saved** (it matches your last save to the library), **Edited** (it has changes the library does not), **Kept on this device**, or, with saving turned off, the one **Not saved**.
- **Saving when signed out.** Signed out, **File** shows **Save file**, and **Sign in to save to library** where the site has accounts, instead of a second item that only downloaded a file.
- **References.** A new **Reference** tab on the right, before Render, holds pictures to look at while you work: add one from your photos, the camera or a file, paste or drop one, then drag its thumbnail into the view. Pictures in the view float, several at once, and can be moved, scaled, mirrored, set to a Photoshop-style blend mode (or Behind the model) at an opacity, and then locked so the Pencil and your fingers go straight through them to the model. **Match view** puts the camera back as it was when a picture was locked. Pictures stay on your device and are never uploaded, for anyone; **Save file** can carry them (**Include references**).
- **Calipers.** A new tool (C, after Transform) measures the distance between two points on the model in centimetres: tap or press with the Pencil twice, drag an end to move it, and pin the measurement to keep it with the scene and compare it with others in the Model panel's **Measure** section. With symmetry on, **Mirror** adds the other side and shows the difference.
- **Hiding the interface slides.** Tab (or the eye button) now slides the left tabs and the brush controls out to the left, the right tabs out to the right, the tool bar and transport down and the menu bar up, and brings them back the same way; with reduced motion it is instant as before.
- **Sliders you can grab anywhere.** On a phone or iPad, press anywhere on a slider's row (its name, its number or its line) and drag sideways to change it, so a slider at 0 or full is no longer hard to catch. A plain tap does nothing, and dragging up or down still scrolls the panel. Depth of field now sits under **Camera** in the Render panel.
- **One Render panel.** Render now has the same sections everywhere (Lighting, Camera with depth of field, Environment, Ambient occlusion), with every light's controls and **Reset look** in Sculpt, Armature, Present, the viewer and review, and in the viewer **Material** is a tab beside Render, as in the workspaces.
- **One menu on every page.** The gallery, Community, My projects, Account, Review and Owner tools now have the same top menu as Sculpt, with **File**, **View** and **Help**, the page's name in the middle and **Sign in** or your @handle at the right.
- **Your @handle in the editors.** When you are signed in, your @handle menu with **Account** and **Sign out** is at the right end of the top bar in Sculpt, Armature, Present and the viewer.
- **A sharp top bar on iPad.** The top row on the pages and in the editors stays sharp while you scroll, because only the content scrolls.
- **Open recent.** **File > Open recent** lists the last ten projects you opened or saved, in any mode, newest first, and opens one in its own mode.
- **The same menus everywhere.** Sculpt, Armature, Present and the viewer now have File, Edit, View and Help in that order, with the same items in the same places and **Preferences…** at the end of Edit. The viewer's View menu has one **Frame all** (on `F`) and **Shadows**, and its Help has all three topics.
- **A Material tab.** Albedo, Roughness and Metalness, with the mode, shading and wireframe, now sit together in a **Material** panel, a tab on the right between Tool and Render. The Model panel starts at Topology and the Render panel at Lighting.
- **Your choice about saving.** On first visit Bozzetto asks whether to keep your work, settings and an offline copy on this device. You can change it under Edit > Preferences.
- **Pages in the new look.** My projects, Community, Account, Review and Owner tools share the title strip and one footer. Lists are rows, galleries are cards, and delete is a trash icon.
- **Present is one workspace.** Creating a timelapse and editing a published project both happen in Present, which has a **Frames** tab for the files.
- **The viewer in the new frame.** A published piece opens under the same title strip as the workspaces, with the transport along the foot.
- **File and Moderation in the viewer.** The viewer has a **File** menu, with **New sculpt from this** on the site's templates, **Edit in Present** for the owner, and **Close**, which goes back to Community, My projects, Review or the gallery, whichever you came from. **Report…** and the review actions are in a **Moderation** menu, and play and pause is a plain button whose icon lights up while playing.
- **Sign-in window.** Email comes first, then **Use a passkey**, then **Email me a code**.
- **Stars.** A star is white when pressed and grey when not.
- **Card pictures fill their tile.** Gallery, Community and My projects cards are 4:5, the shape the pictures are taken at, so they no longer show bands at the sides.
- **Easier to read.** Placeholder text, hotkeys on a hovered menu row and red error text have more contrast. Red buttons are a deeper red with white labels.
- **Phone.** The title strip is taller on a phone and its menus no longer overlap the tabs under it.
- **Wireframe with ambient occlusion.** The wireframe no longer draws dark smudges and broken lines when ambient occlusion is on.
- **Hotkeys.** The Hotkeys button at the foot of the Render panel is gone. Use **Help → Hotkeys** or `H`.
- **Smaller download.** The app downloads about 0.7 MB less in fonts.

### v0.6.4

- **New interface.** The app has a dark grey, square look. Sculpt and Armature share a title strip with File, Edit, View and Help, and the paper theme is gone.
- **Three workspaces.** Armature, Sculpt and Present are workspaces with a path between them. Present has Render and Output tabs and a Publish button.
- **Help menu.** Help topics cover every tool and option, and About and credits lists what the app uses.
- **Rake and Clay.** The Rake stops at depth, with a Stop at depth option. Clay is gentler and follows the surface. Strength is now a length in centimetres.
- **Brush curves.** Brush falloffs are curves you draw in the Tool panel. The tine rake is a new brush, Smooth gains a Surface mode, and brush alphas are removed.
- **Poly groups.** Faces can be grouped, coloured with `Shift`+`F`, hidden and split into objects. Blender base meshes open with groups.
- **New masking and remesh.** `Ctrl`+`Shift` and a drag masks one side of an edge loop. The Model panel gains Quad remesh with a progress bar and Cancel.
- **Smaller changes.** Zoom goes toward the work, the last object can be deleted, and ambient occlusion stays on while you turn the model. Shadows after poly group colours are fixed.

### v0.6.3

- **Centimetres.** Sizes are real lengths in centimetres. Older scenes open as before, with a Set scale banner asking how tall the object really is.
- **Channel box.** The Tool panel shows Translate, Rotate and Scale values for the active object, which you can type into.
- **Community.** The gallery has a Community page with sort, search, stars, author pages, Share to Community from My projects, and Report.
- **Review.** The owner and moderators review shared work on a Review page with Queue, Reports, History and Gallery tabs.
- **OBJ.** Create gains Import OBJ, and an imported OBJ keeps its vertex and face order when exported. Create timelapse saves to My projects when signed in.
- **Real sizes.** Primitives and mannequins come at real sizes, and the floor is fixed, with a Floor offset control.
- **Armature and viewer.** Proportions move the joints, `R` scales a part, and only the key light casts a shadow by default. Hold `L` to move the key light in the viewer.
- **Other changes.** Solo moves to the brush rail and each account gets 500 MB. A pen barrel button no longer leaves the view turning, and the gallery scrolls in Firefox. Timelapse recording is removed from the web app.

### v1.4.2

- **Present mode.** A Present button and `Shift`+`P` show the model alone, with a turntable and Save image.
- **Save turntable.** Present can save the turntable as an MP4 or GIF, and `Space` starts and stops it.
- **Publishing from Present.** The published project keeps the camera and the whole look.
- **Gallery pictures.** Thumbnails are 4:5 portraits.
- **Shadows.** Shadows are sharper because they are fitted to the subject, and the rim light now casts its shadow.
- **Armature.** The clavicles now mirror with symmetry on.
- **In progress card.** Work already saved to the library no longer shows a separate In progress card.
- **Legal pages.** The terms and privacy notice are complete.

### v1.4.1

- **Armature selection.** A part stays selected while you orbit, pan or zoom, and tapping a hand, foot or head ball selects it.
- **Armature floor.** Figures stand on the floor and the floor no longer moves. Plant feet now shows a ring under each held foot.
- **Armature undo.** Undo and redo work as in Sculpt, with `Ctrl+Z` and `Ctrl+Shift+Z`, and the Armature panel docks on the left.
- **Armature projects.** Save to library keeps a figure as a project in My projects, which opens back in Armature mode.
- **Backdrop.** Sculpt and Armature start on a neutral grey backdrop.
- **Create.** The Create menu has three buttons: New Sculpt, New Armature and Upload Model(s).

### v1.4

- **Templates.** The gallery shows the site's templates. A scene template opens in Sculpt as a copy, and Save to library keeps it as your own.
- **Accounts.** You can sign in with a passkey or an emailed code and join by invite. Accounts stay off until the site's owner switches them on.
- **My projects.** It lists your work and storage, and lets you open, download, rename and delete projects. Save to library goes there when signed in.
- **Account.** Change your handle, address and passkeys, and see where you are signed in. Download my data zips everything the site keeps about you, and Delete account removes it.
- **Owner tools.** Owner tools gained Invites, Users and Audit tabs.
- **Colour.** A painted model gets a Sculpt colours or Plain colour switch. Drag a background or light swatch onto the view to pick a colour, in a larger picker.
- **Voxel grid.** The remesh grid is drawn while you hold the Resolution slider, and Resolution goes up to 512. A remesh too big for the device is refused with a message.
- **Passkey check.** A test page under Preferences, Diagnostics checks whether passkeys work on your device.

### v1.3.5

- **Scene links ask first.** Opening a scene by its link asks before it replaces the work on the device.
- **Bad files.** A damaged or oversized `.bozz` file is refused with a reason instead of crashing the tab. An autosave that cannot be read is set aside and Sculpt starts fresh.
- **Sign out.** Sign out forgets the sign-in and removes the device's copies of your private lists.
- **Safer sign-in.** The server verifies sign-ins more strictly and refuses writes from other sites.

### v1.3.4

- **Faster frames.** Sculpt and Armature keep ambient occlusion still under a stroke. Preferences, Performance offers Fast frames or Full look.
- **Smoother view.** Navigation follows your hand more closely at any frame rate, and edges are smoothed once the view is still. Anti-aliasing can be set to When still, Always or Off.
- **Adaptive quality.** The app lowers quality when frames run slow and restores it when they recover. Panels no longer blur the view, and Panel opacity is set under Preferences, Appearance.
- **Diagnostics.** The Frame meter, Stall log and Input log are in Preferences, Diagnostics.
- **Updates.** A notice says when the app is downloading or has installed an update. The hotkey guide shows the version and a Check for updates button.
- **Projects.** Save to library uploads a private project when signed in and downloads a `.bozz` file when signed out. Projects can be public or private. An expired sign-in is reported clearly, and the scene is kept as Not uploaded.
- **Interface.** Capture is a floating window. The Model panel docks on the left under Scene with Mask and Extract inside it. Double-click or double-tap a slider to type a value.
- **Look and Armature.** Environment intensity has a more usable scale and the HDRI background has Bg brightness. GTAO no longer draws black outlines. `L` moves the key light in Armature, and a reach past a joint's limits settles on the nearest allowed pose.

### v1.3.3

- **Negative on a tap.** A tap on Negative carves the next stroke, and a long press latches carving on.
- **Arrow keys.** `↑` and `↓` walk the Scene list, and `Shift` extends the selection.
- **Brush sizes.** Every brush keeps its own size.
- **Autosave.** The autosave writes at most once a minute, which helps iPad freezes.
- **Timelapse capture.** Capture starts off for everyone until you tick Record timelapse.
- **Fix.** The World-scale box in the Tool panel now follows an opened scene.

### v1.3.2

- **Fingers navigate.** In every tool one finger orbits and two pan and zoom. The Pencil and mouse sculpt. Preferences has a Fingers sculpt too option.
- **iPad long press.** A long press on the canvas, toolbar or panels no longer triggers Safari actions or cancels the touch.
- **Zoom.** You can zoom much closer to the model, and zooming back out always works.
- **Move.** A Move stroke now starts on the model surface like other brushes.

### v1.3.1

- **Solo.** `Alt`+`Q` shows the active object alone in Sculpt.
- **Hip ball.** A violet ball in the hips of the Armature figure moves the whole figure.
- **Necks.** The mannequins' necks turn higher up.
- **Fix.** Undoing an add while another object is active no longer leaves the object drawn.

### v1.3

- **Armature for everyone.** The Create tile starts a new sculpt or armature for every visitor, and an armature in progress shows as a card.
- **Offline.** The base meshes, mannequins and default environment work offline from the first visit.
- **Default figure.** A new armature starts on the realistic male mannequin.
- **Mannequin fixes.** Mirrored right limbs no longer render inside out, the hips sit lower, the deltoid moves with the arm, and knees and elbows bend the right way.
- **Hips and joints.** The hips open outward and the head reaches through the spine.
- **Feet.** Both feet start pinned, and Plant feet keeps a foot on the ground flat. Pinned feet no longer snap round when the pelvis moves.
- **Armature defaults.** Symmetry starts off, and the balls win the click over nearby parts.
- **Gallery card.** The armature's gallery card has a picture of the figure.

### v1.2

- **Base meshes.** The Create menu offers Blender Studio's Human Base Meshes, including figures, heads, hands, feet, eyes, jaws and skulls.
- **Primitives.** Cone, capsule and an upright plane are new.
- **Mannequins.** Armature mode has male and female, realistic and stylized mannequins beside the blocks.
- **Wireframe.** The wireframe overlay draws quads as quads.
- **Clay.** Clay takes two photographed stencils, Thumbed and Cracked.
- **Offline.** The UI fonts work offline.

### v1.1

- **Sculpt mode (alpha).** Bozzetto can now sculpt, with ten brushes, pen pressure, 64-deep undo, masking, Extract and mirror symmetry.
- **Brushes.** Rake, Polish and Crease with Profile and Pinch sliders were added.
- **Topology.** Multiresolution, dynamic topology and voxel remesh are available.
- **Paint.** Vertex painting, named materials and an HSV colour picker are included.
- **Objects.** A transform gizmo on `W`, `E` and `R`, a multi-object outliner, a Select tool, and mirror and radial copies.
- **Hotkeys.** Every hotkey is editable under Edit, Preferences.
- **Files.** A File menu handles new, open, save, save to library, and OBJ import and export, with `.bozz` scene files.
- **Other.** Ten new matcaps, selectable tone mapping, timelapse capture, iPad support and autosave with an In progress gallery card.

### v1.01

- **Smaller frames.** Timelapse frames are about 3 to 4 times smaller.
- **Playback.** A loaded-frames bar and a buffering indicator were added.
- **Depth of field.** Double-click the model to set the focus.
- **Fixes.** Loading messages are clearer, and wireframe opacity and staging in unlit modes were fixed.

### v1.0

- **First public release.** It has a WebGPU renderer with a WebGL 2 fallback.
- **Timelapses.** Sculpt timelapses stream as real per-frame geometry.
- **Lighting.** A three-point rig, soft shadows and HDRI environment lighting.
- **Rendering.** Ambient occlusion and depth of field.
- **Staging.** A studio floor and pedestal.
- **Editor.** An in-browser editor exports a self-contained `.html`, plus MP4 and GIF reels.
- **Gallery.** The gallery shows portrait thumbnails.

## Source

The code is on [GitHub](https://github.com/vidarrapp/bozzetto) under the MIT
licence, and the app can be built and run from it; [`docs/`](docs/) has the
notes for that.

## Credits

- Sculpt mode is built on [SculptGL](https://github.com/stephomi/sculptgl)'s editing core, MIT, by Stephane GINIER. The vendored source and its license live in `src/sculpt/vendor/`.
- Quad remesh is [QuadriFlow](https://github.com/hjwdzh/QuadriFlow), BSD-3, by Jingwei Huang, Yichao Zhou, Matthias Niessner, Jonathan Shewchuk and Leonidas Guibas, compiled to WebAssembly by `tools/quadriflow-wasm/build.sh`, with LEMON, pcg32, Eigen and the Boost Graph Library compiled in; their licences are in `THIRD_PARTY_NOTICES.md`.
- Toolbar icons: [Uicons by Flaticon](https://www.flaticon.com/uicons).
- The base-mesh library is Blender Studio's [Human Base Meshes bundle](https://www.blender.org/download/demo-files/#asset-bundles) v1.4.1, CC0, by Dan Ulrich, Julien Kaspar, Paul Kotelevets and Tonatiuh de San Julián. Exported by `tools/export-basemeshes.py`; see `public/assets/basemeshes/LICENSE.txt`.
- The mannequins are the same bundle's primitive figures, by Paul Kotelevets and Julien Kaspar, rigged onto Bozzetto's bones by `tools/build-mannequins.py`; see `public/assets/armature/LICENSE.txt`.

## License

MIT. See [LICENSE](LICENSE).
