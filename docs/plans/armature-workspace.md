# Plan: Armature as a workspace of the same scene

Status: plan for Vidar, 2026-11-18. Nothing is built. Decided the same day:
stages 1 and 2 below are the priority; posing a figure that has already been
sculpted is a stretch goal and will more likely be a tool of its own.

What was asked for: Armature should be a tab like Sculpt, Paint and Present, in
the same scene, so the pose can be changed and the work picked up again with
no page change and no question.

---

## 1. Where we are

Armature and Sculpt are two pages that share one viewer class and most of the
shell's code, but each builds its own top bar, menus, panels, keys, undo and
saving.

- **Going to Sculpt** bakes the posed mannequin into triangles, stores them on
  the device, loads the Sculpt page, and Sculpt voxel-remeshes them into a new
  object called "Figure". The remesh is needed: the mannequin is open at the
  joints, and only the remesh gives Sculpt a closed surface with subdivision
  levels.
- **Nothing ties the Figure to its pose.** The hand-off record is deleted on
  arrival, and the scene has no field for an armature. Going back to Armature
  asks "Make a new armature for this scene?" and starts a new figure.
- **Two of everything.** The armature in progress is kept on the device beside
  the scene, not in it. Armature projects in the library are their own kind,
  with their own file. Each page has its own look, its own references board,
  its own undo history.
- **Sculpt cannot tell whether a Figure has been sculpted** since it arrived:
  only whether the scene as a whole has changed.

## 2. What it becomes

One page, four workspaces: **Armature, Sculpt, Paint, Present**. `Shift`+`1` to
`4` and the path move between them, as between the other three today.

**The armature belongs to the scene.** It is saved with it everywhere the
scene is saved (the work in progress, a `.bozz` file, a library project), so
one file holds the pose and the sculpt.

**In Armature** you see the mannequin with its handles, on the floor, and the
scene's other objects around it as context (they cannot be picked there). The
Armature tab is at the left; Material and Reference at the right are the same
panels, and the same pictures, as in Sculpt. One armature per scene for now,
and only one is ever edited at a time; the saved form allows several later.

**A figure is made only when you press the button** (decided 2026-11-18):
never by changing tab. The button, **Remesh to a figure**, is in the Armature
tab's Figure section and in Sculpt's Model tab.

- **Before a figure is made**, the posed mannequin is what you see in Sculpt,
  Paint and Present too, and it is listed in the Scene tab. It cannot be
  sculpted or painted. A stroke on it asks once:
  `Remesh "Figure" to sculpt it?` with **Remesh** and Cancel, and Remesh makes
  the figure and lets the next stroke land.
- **Once a figure is made**, the mannequin shows only in Armature, and the
  figure stands in its place everywhere else.
- **Changing the pose later never changes the figure by itself.** The Figure
  section of the Armature tab says where things stand and what the button
  will do, so the workflow is plain without any question:

  | State | The section says | The button |
  | --- | --- | --- |
  | No figure yet | No figure yet. | Remesh to a figure |
  | Figure untouched, pose as it was | The figure matches the pose. | (greyed) |
  | Figure untouched, pose changed | The pose has changed since the figure was made. | Remesh: the figure is rebuilt in place (same object, name, material and place in the Scene list) |
  | Figure sculpted or painted | "Figure" has been sculpted and keeps its shape. | Remesh as a new figure |

  The Resolution slider sits beside the button, as today.

**One undo history.** A pose change is a step in the scene's history like a
stroke, so Undo walks back through poses and strokes in the order they were
made, in whichever workspace you are.

**One look, one working view** (decided 2026-11-18). The scene has one look,
set in Present. Armature shows the working view Sculpt shows, with the floor
on, so changing tab does not change the light or rebuild anything.

**Scene files for everything** (decided 2026-11-18). A scene carries its
armature, Save file writes a `.bozz`, and Save to library always saves a
scene. There are next to no saved armatures and no other users yet, so the old
kinds get the least that is decent: an `.armature` file, an armature project
in the library and an armature left in progress by an older version each open
as a new scene with that armature; nothing writes those kinds any more.

## 3. The hard parts, from the code

The full map of today's code, with files and line numbers, is in
`docs/plans/drafts/armature-workspace/map.md`.

| Fact today | What the plan does |
| --- | --- |
| Each page adds its window, document and canvas listeners once and never removes them; the two take the same keys (x, w, e, r, t) for different things | Each workspace gets a real suspend and resume. Only the workspace in front hears the pointer and the keys. |
| Two undo histories of different kinds, two Undo and Redo columns | Armature's steps are recorded in the scene's history as steps of their own (as layer operations are). One column. |
| Two viewer setups that contradict each other: the floor rule, which lights are on, ambient occlusion against cavity shading, what counts as the subject for shadows | One setup per workspace, applied on entering and put back on leaving, as Present does today. With the working view shared (question 1) the difference is small: the floor, the mannequin shown or hidden, the shadow fit. |
| The scene record lists exactly what it keeps, and has no armature | A new `armature` field through every place a scene is written, read, checked and packed. Old scenes open without one. |
| A figure is an ordinary object with nothing saying where it came from or whether it was edited | A figure remembers which armature and pose made it, and whether it is still untouched. The first stroke, paint, remesh, layer or transform on it ends that, and undoing that step restores it. |
| Making the figure is a voxel remesh on the main thread; nobody has measured it | It runs only on the button now, never on a switch, so it holds nothing up. Measure it all the same, and show progress as Quad remesh does if it is more than a moment. |
| Armature's code and four mannequin files (about 1 MB each) load with its page | They load the first time Armature is opened, not with Sculpt. Sculpt must start as fast as it does today. |
| About 35 test suites open Armature by its address and five assert the page change | `?armature=1` stays a valid address (the page, opened on Armature). The five hand-off suites are rewritten for the switch; the rest should hold. |

## 4. Order of work

Each step ships on its own and leaves the app working.

**A. One shell (nothing visible).** The top bar, menus, edge column and shared
panels are built once by the page, and Sculpt plugs into them. Armature is
still its own page.

*Done (suite `studioShell`).* `src/studio/Studio.ts` is the shell a page builds
once: `new Studio(viewer, { referenceScope, material })`. It owns the title
strip with the path and the readout (one `TitleStrip`), the four menus as
frames (`studio.menus`), the edge column (`studio.edge`: the one `.bz-edge`,
with Undo and Redo at its foot; Sculpt's brush rail stands in it), the details
overlay, the chrome toggle's wiring, the leaving guard, the one Material panel
and the one Reference panel, view and board (`studio.reference`; the board's
scope is the `referenceScope` option, so merging the boards later is one
value), and the memory of which panels each workspace had open
(`studio.panels`, begun by `beginPanels`). What a workspace gives it:

```ts
interface Workspace {
  id: 'armature' | 'sculpt' | 'paint' | 'present';
  keyMode: KeyMode;                          // which keymap rows are its own
  menus(): { file; edit; view: MenuItem[] }; // read when the shell refreshes and each time a menu opens
  path(): Partial<Record<WorkspaceId, PathStep>>;  // steps the shell does not host, or overrides of them
  panels: { left: SidePanel[]; right: SidePanel[] };  // its own, besides Material and Reference
  readout(): Readout;                        // the strip's readout, written every 500 ms and on repaint()
  details(): DetailLine[] | null;            // null leaves the overlay as it is (Present)
  history: { undo; redo; canUndo; canRedo }; // the edge column's buttons
  mayEnter?(from); mayLeave?(to);            // false refuses (mid-stroke)
  enter(from); leave(to);                    // show and take the keys; put away
  beforeLeavingPage(): Promise<boolean> | boolean;   // the shell's guard asks the one in front
  shown?(); tick?();                         // each repaint of the path; each readout pass
}
```

The shell: `register(ws)`, `start(id)`, `go(to)` (asks `mayLeave` and
`mayEnter`, then `leave` and `enter`, silences with `SidePanel.setSuspended`
the panels the new front does not have, opens the new front's remembered
panels; a step to a workspace the shell does not host is the front's own
`path()` step), `follow(id)` (for a workspace that moved by its own doing:
the console, an address), `way()` (the path as the strip and the View menu
read it: a `go` for every hosted workspace, replaced by `path()`), `refresh()`
and `refreshMenus()`, `repaint()` (the readout and the details only), and
`sleep()`/`wake()` (the whole shell put away, for a page whose only workspace
is suspended: Armature's `suspend()` on its own page).

On the Sculpt page, `src/sculpt/workspaces.ts` registers Sculpt, Paint and
Present, which share the one controller in `mode.ts` as they did. A way into
Sculpt or Paint does the controller's work (Paint saves what Sculpt had up and
Sculpt puts Paint away; each stays under Present, which returns to it) and the
way out of Present is Present's own (`leave(to)`), landing on the workspace
asked for. The Armature step of the path is the one thing the shell does not
host: Sculpt's `path()` says it asks, then changes page. On the Armature page
the shell hosts Armature alone: `enter` is `resume`, `leave` is `suspend` of
its own things, and `suspend()` (the tests' hook and step B's contract)
is that plus `studio.sleep()`.

What step C can rely on:

- Register the Armature workspace on the Sculpt page's shell next to the other
  three (`studio.register`), build the shell once with `referenceScope`
  `'sculpt'`, and `go('armature')` does the switching: Sculpt's step then
  needs no `path()` override. The shell never hides itself on a `go`; only
  `sleep()` does, and it is for a page with nothing else to show. Do not call
  `suspend()` (it sleeps the shell); call what the workspace's `leave` calls.
- Each workspace silences and wakes only its own panels (`panels`); the
  shared Material and Reference panels are never silenced by a `go`, and
  their options are the page's (`StudioOptions.material`), so Armature's
  Material panel (`sculpting` only) and Sculpt's (surface, cavity, colour)
  will have to be one set of options.
- The edge column is built by the shell; a workspace adds its own buttons to
  `studio.edge.el` in `enter` and takes them out in `leave`. Sculpt's rail
  (fields, Solo, Negative) is added once at mount and would need the same.
- Armature's page keeps its own `watchAdditions` window for what only
  Armature added (`ownedDom`); the shell's pieces are the shell's.
- One workspace's `beforeLeavingPage` is asked, the front's; a workspace put
  away must have written what it keeps in `leave` (Armature's `suspend` does).
- The keys: each workspace binds its own listeners in `enter` and removes
  them in `leave` (Armature's `subscriptions`); Sculpt's `InputShell` is one
  listener for the three workspaces of the page and tells Paint's keys
  by the controller's own state.

**B. Armature can be put away (nothing visible).** Every listener, timer and
viewer setting of Armature's goes behind suspend and resume, its teardown gaps
are closed, and what it keeps in module-wide state moves into the instance.
Tested by mounting, suspending and resuming it on its own page.

*Done (suite `armatureSuspend`).* `mountArmatureMode` returns its disposer with
`suspend({ figure: 'show' | 'hide' })`, `resume()` and `isSuspended()` on it
(the test page has the same on `window.__armature`). What the next step can
rely on:

- Suspended, Armature has no listener on the window, the document or the canvas
  (its keys never reach `keymap.actionFor`, so the same keys can belong to
  another workspace), no timer, no observer and no settings or device-choice
  subscription; the transform gizmos are disconnected from the canvas and the
  side panels no longer answer `bozzetto:panel-open`, `panel-set` or the Tab
  close-all. Its DOM (strip, menus, panels, edge column, details, reference
  view) is `display: none`, its scene objects are hidden, not disposed. The
  figure stays drawn only with `figure: 'show'`. Resume puts all of it back
  with the pose, selection, gizmo mode, open panels and undo history as they
  were; nothing is fetched.
- What Armature sets on the viewer is one list, `src/armature/viewerNeeds.ts`,
  applied by `apply()` (mount, resume) and undone by `undo()` (suspend,
  dispose): the Floor offset, `lockFloor`, the fill's and rim's Casts shadow,
  `keyOnlyShadows`, `tapToFocus`, the primary subject's visibility,
  anti-aliasing, `fastFrames`, `interactionProbe`, `chrome.onChange` and the
  subject fit. Undo restores what the viewer had when the list was last
  applied; resume writes back what Armature held. Step C changes the list there.
- Module-wide state: the handle shaders' uniforms moved into `HandleKit`; the
  mannequin rigs (`figureReads`), the parsed models and the fetched files stay
  shared across mounts, as read-only caches that make a second mount fetch
  nothing. Mount, dispose, mount works on one page; the disposer now also
  restores `tapToFocus`, unsubscribes the device-choice listener and disposes
  the highlight material.
- Left for the shared shell: `body.bz-shell` (set by the title strip, removed
  only when Armature is disposed), the `bozzetto:sculptmode` event (sent on
  mount and dispose, not on suspend), the look (background, light colours) and
  the panel ids `material` and `reference`, which Sculpt uses too.

**C. Armature in the page (stage 1).** Armature opens as a workspace of the
Sculpt page, loaded on first use, in Sculpt's working view with the floor on.
The armature is saved in the scene. The posed mannequin shows in every
workspace until a figure is made, and Remesh to a figure (the button, in
Armature and in Sculpt's Model tab, and the question on a first stroke) makes
it. `?armature=1` opens the page on Armature; the old page is gone.

**D. One undo history.**

**E. The figure and its pose (stage 2).** The figure remembers the armature
and pose it was made from and whether it is still untouched; the Figure
section's four states; Remesh rebuilding an untouched figure in place, or
adding a new one once it has been sculpted.

**F. Tidy up.** The gallery's cards, Open recent, the Create window, Help, the
old kinds opening as new scenes, and the tests.

Steps A and B are safe to start at once: they change nothing a person sees and
do not depend on the answers below.

## 5. Decisions (Vidar, 2026-11-18) and what is still open

Recorded in `docs/HANDOFF.md` as well.

1. **How Armature looks:** the same working view as Sculpt.
2. **Figures per scene:** one for now, several perhaps later; only one is
   edited at a time.
3. **Making the figure:** only by pressing a button, in Armature or in Sculpt.
   Never by changing tab.
4. **A changed pose after sculpting:** no question; a clear workflow in the
   Armature tab. A question only when someone tries to sculpt on the armature
   itself.
5. **Library and files:** scene files for everything from now on.
6. **Still open: a model loaded into Armature from a file.** It cannot go to
   the library today. Recommended: it stays on the device and in a `.bozz`
   file, and Save to library sends the scene without it and says so, as
   reference pictures are handled. Or allow it to be uploaded.

## 6. Not in this plan

- Posing a figure after it has been sculpted (binding the sculpt to the bones):
  a stretch goal, likely a separate tool.
- More than one armature in a scene, beyond keeping the saved form open to it.
- Changes to the mannequins, the handles or the solver.
