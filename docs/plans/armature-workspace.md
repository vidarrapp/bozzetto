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

**B. Armature can be put away (nothing visible).** Every listener, timer and
viewer setting of Armature's goes behind suspend and resume, its teardown gaps
are closed, and what it keeps in module-wide state moves into the instance.
Tested by mounting, suspending and resuming it on its own page.

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
