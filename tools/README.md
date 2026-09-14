# The armature rig, in Blender

`blender_armature.py` builds Bozzetto's rig inside Blender from the app's
own numbers, so a figure modelled against it drops straight into Armature
mode. `rig.json` holds those numbers and is generated from the app source
(`npm run rig:json`); nothing here retypes them.

```bash
# a .blend to work in
blender --background --python tools/blender_armature.py -- \
    --preset placeholder-male --out ~/bozzetto-male.blend

# or open Blender, load the script in the Text editor and press Run Script
```

Options: `--preset placeholder-male|placeholder-female`, `--out <.blend>`,
`--glb <.glb>`, `--no-blocks` for the skeleton on its own.

## What you get

- **BZ_Armature**, with the bones the app knows by name: `pelvis`, `spine`,
  `chest`, `neck`, `head`, and `clavicle`, `upperarm`, `forearm`, `hand`,
  `thigh`, `shin`, `foot` in `.L` and `.R` pairs.
- Each bone carries `bz_kind` (`root`, `ball` or `hinge`), `bz_hint`,
  `bz_limit_x/y/z` (degrees, `[min, max]`, `[0, 0]` locks an axis) and
  `bz_mirror`, plus a **Limit Rotation** constraint that enforces the same
  ranges while you pose in Blender. The app reads the properties; the
  constraint is for your comfort.
- The IK chains and the figure's height as `bz_rig` on the armature object.
- One box per part, `part_<bone>`, weighted 1.0 to its bone and parented to
  the armature.

## Modelling against it

Replace a box with your own mesh and keep the vertex group named after the
bone. Parts that span a joint are the exception: give a kneecap, an elbow
or a scapula weights in **both** groups, around 50/50, and linear skinning
turns it half-way with the joint, which is what makes the seam read.

Keep to the rest pose the rig is built in: an A-pose, arms 40° below
horizontal. The app poses from there, and its joint limits are measured
from there.

You may move a joint (a longer forearm, a wider pelvis) - the app reads the
rest positions out of the file. Adding or renaming a bone is a code change
as well: the rig lives in `src/armature/rig.ts`.

## Units and axes

Metres. The app's world is glTF's: **Y up, the figure facing +Z**. Blender
is Z up with a character facing −Y, which is exactly what the glTF exporter
converts to, so the script places the rig at `(x, −z, y)` and the export
puts it back. Build and export with the defaults and the app receives what
you see.

A bone's local **Y runs head to tail**; its local **X** is the world axis
named by `bz_hint`, squared up to the bone; **Z** completes the pair. Left
and right share their X, so one table of limits serves both sides and a
pose mirrors by reflection.

## Exporting for the app

File → Export → glTF 2.0 (.glb), with:

- **Include → Custom Properties** on. Without it the rig arrives as a
  skeleton with no rules.
- **Transform → +Y Up** on (the default).
- Apply modifiers off, so the armature modifier stays a rig rather than
  being baked into the mesh.

The app will read the bone hierarchy and rest transforms, the skinned
meshes and their weights, and the custom properties. Until that loader
lands the placeholder boxes stand in, and the rig they stand on is this
one.
