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
panels, and the same pictures, as in Sculpt.

**In Sculpt, Paint and Present** the mannequin is not shown. Its **figure** is:
the object Sculpt makes from the pose.

**The figure follows the pose until you work on it** (stage 2):

- The first time you leave Armature, the figure is made, with no question.
- While the figure is untouched, a changed pose rebuilds it in place when you
  leave Armature: same object, same name, same material, same place in the
  Scene list.
- Once the figure has been sculpted or painted it keeps its shape. A changed
  pose then says so in a notice with a button, and nothing is replaced:
  `"Figure" has been sculpted, so it keeps its shape.` `[Add the new pose as a figure]`
- The Armature tab's "Send to Sculpt" section becomes **Figure**: the
  Resolution slider, whether the figure is following the pose or has been
  sculpted, and **Add as a new figure**.

**One undo history.** A pose change is a step in the scene's history like a
stroke, so Undo walks back through poses and strokes in the order they were
made, in whichever workspace you are.

**One look.** The scene has one look, set in Present. Armature shows the
working view Sculpt shows, with the floor on, so changing tab does not change
the light or rebuild anything (question 1 below).

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
| Making the figure is a voxel remesh on the main thread; nobody has measured it | Measure it first on the iPad's quality tier. If it is longer than a blink, it moves off the main thread and the mannequin stays on screen until the figure is ready, so a switch is never held up. |
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
Sculpt page, loaded on first use. The armature is saved in the scene. The
first switch to Sculpt makes the figure. `?armature=1` opens the page on
Armature; the old page is gone. An armature left in progress by an older
version is still offered in the gallery and opens as a new scene.

**D. One undo history.**

**E. The figure follows the pose (stage 2).** The link, the rebuild in place
while untouched, the notice once sculpted, the Figure section, and the remesh
moved off the main thread if step C's measurement says so.

**F. Tidy up.** The gallery's cards, Open recent, the Create window, Help, the
library (question 5), and the tests.

Steps A and B are safe to start at once: they change nothing a person sees and
do not depend on the answers below.

## 5. Questions for Vidar

These are also in `docs/HANDOFF.md`.

1. **How Armature looks.** The same working view as Sculpt, with the floor
   shown, so changing tab changes nothing but the tools (recommended: an
   instant switch, and the rendered look is one key away in Present). Or keep
   today's rendered Armature view with soft shadows and ambient occlusion,
   which means the picture changes on every switch.
2. **Figures per scene.** One armature and one following figure per scene to
   begin with, saved in a form that allows several later (recommended). Or
   several figures from the start.
3. **Making the figure.** The first time you leave Armature the figure is made
   by itself (recommended; otherwise Sculpt opens empty after posing). Or only
   when you press a button.
4. **A changed pose after sculpting.** A notice with "Add the new pose as a
   figure", and the switch goes ahead (recommended; nothing stops a switch).
   Or a question before the switch, as first described.
5. **The library and files.** A scene carries its armature, and Save to
   library always saves a scene. Armature projects and templates already in
   the library still open, as a new scene with that armature. `.armature`
   files still open; Save file writes a `.bozz` (recommended). Or keep
   armature-only projects and files as a kind of their own.
6. **A model loaded into Armature from a file** cannot go to the library
   today. In a scene: it stays on the device and in a `.bozz` file, and Save
   to library sends the scene without it and says so (recommended, as
   reference pictures are handled). Or allow it to be uploaded.

## 6. Not in this plan

- Posing a figure after it has been sculpted (binding the sculpt to the bones):
  a stretch goal, likely a separate tool.
- More than one armature in a scene, beyond keeping the saved form open to it.
- Changes to the mannequins, the handles or the solver.
