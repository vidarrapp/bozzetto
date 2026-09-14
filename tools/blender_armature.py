"""
Build Bozzetto's armature in Blender, from the app's own numbers.

TWO WAYS TO RUN IT, and the options work differently in each.

1. Blender's Text editor: edit the OPTIONS block a few lines below, then
   press Run Script. There is no command line there, so that block is the
   dial. Re-running replaces what the last run made.

2. A terminal:

       blender --background --python tools/blender_armature.py -- \
           --preset placeholder-female --out ~/bozzetto-female.blend

   --preset  placeholder-male | placeholder-female   (default: male)
   --out     path to save a .blend
   --glb     path to export a .glb straight away
   --no-blocks   the skeleton only, no placeholder boxes
   --keep    leave anything an earlier run made in place

What it makes:

  * An Armature object, BZ_Armature, with the bones the app knows by name
    (pelvis, spine, chest, neck, head, and clavicle/upperarm/forearm/hand,
    thigh/shin/foot in .L and .R pairs), at the app's rest positions and
    with the app's roll, so a bone's local X, Y and Z mean the same thing
    in both places.
  * Each bone carries its joint limits and its kind as custom properties,
    and a Limit Rotation constraint that enforces them while you pose in
    Blender. The app reads the properties; the constraint is for you.
  * One box per part, named part_<bone>, each already weighted 1.0 to its
    bone and parented to the armature. Replace a box with your own mesh,
    keep the vertex group, and it rides the rig.
  * The IK chains and the figure's height on the armature object, so the
    app can read the rig out of an exported .glb.

The numbers come from tools/rig.json, which is generated from
src/armature/rig.ts by `npm run rig:json`. Do not retype them here: one
source, two readers.

Axes. The app is glTF's world - metres, Y up, the figure facing +Z.
Blender is Z up and a character faces -Y, which is exactly what the glTF
exporter converts to, so this script places the rig at (x, -z, y) and the
export puts it back. Build and export with the defaults (+Y up) and the
app receives what you see here.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

# --- OPTIONS (for the Text editor; the command line overrides them) --------
# Which figure to build.
PRESET = "placeholder-male"  # or "placeholder-female"
# The placeholder boxes, or the bare skeleton.
WITH_BLOCKS = True
# Where to save, if you want the run to write a file. "" means don't.
SAVE_BLEND = ""  # e.g. "/home/you/bozzetto-male.blend"
EXPORT_GLB = ""  # e.g. "/home/you/bozzetto-male.glb"
# Re-running the script clears what the last run made, so a tweak-and-run
# loop does not pile up BZ_Armature.001, .002, ... Turn this off to keep
# several figures in one file.
REPLACE_PREVIOUS = True
# Where rig.json is. Left empty it is looked for beside this script, which
# is right whenever the two travel together. Fill it in if you pasted the
# script into a new text block rather than opening the file.
RIG_JSON = ""
# ---------------------------------------------------------------------------


def find_rig_json():
    """
    rig.json lives beside this script. Blender can run a script from a file
    (where __file__ points at it) or from a pasted text block (where it does
    not), so try the likely places and say plainly which were tried.
    """
    tried = []
    if RIG_JSON:
        tried.append(bpy.path.abspath(RIG_JSON))
    try:
        tried.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "rig.json"))
    except NameError:
        pass
    # A text block opened from disk knows its own path.
    for text in bpy.data.texts:
        if text.filepath:
            tried.append(os.path.join(os.path.dirname(bpy.path.abspath(text.filepath)), "rig.json"))
    cwd = os.getcwd()
    tried.append(os.path.join(cwd, "rig.json"))
    tried.append(os.path.join(cwd, "tools", "rig.json"))
    for path in tried:
        if os.path.isfile(path):
            return path
    raise SystemExit(
        "rig.json not found. Set RIG_JSON at the top of the script to its "
        "full path. Looked in:\n  " + "\n  ".join(tried)
    )


# --- the app's world, in Blender's ------------------------------------------
def to_blender(p):
    """App (x, y up, z forward) -> Blender (x, -z forward, y up)."""
    return Vector((p[0], -p[2], p[1]))


def hint_axis(name):
    return {"x": Vector((1.0, 0.0, 0.0)), "y": Vector((0.0, 1.0, 0.0)), "z": Vector((0.0, 0.0, 1.0))}[name]


def bone_frame(bone):
    """
    The bone's rest frame the way the app derives it: Y from head to tail,
    X the hinted world axis squared up to Y, Z their cross product. In
    Blender space, so it can be handed to align_roll.
    """
    head = to_blender(bone["head"])
    tail = to_blender(bone["tail"])
    y = (tail - head)
    length = y.length
    y.normalize()
    # The hint is an APP axis; convert it the same way as a position would
    # be, without the translation (to_blender is linear, so this is it).
    hint = to_blender(list(hint_axis(bone["hint"])))
    x = hint - y * hint.dot(y)
    if x.length < 1e-6:
        fallback = to_blender([0.0, 0.0, 1.0])
        x = fallback - y * fallback.dot(y)
    x.normalize()
    z = x.cross(y)
    z.normalize()
    return head, tail, length, x, y, z


def clear_previous():
    """
    Remove what an earlier run made, and only that: everything this script
    creates is stamped, so a hand-made object of the same name survives.
    """
    doomed = [o for o in bpy.data.objects if o.get("bz_generated")]
    for obj in doomed:
        data = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        # The mesh or armature behind it goes too, unless something else
        # is still using it.
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Armature):
                bpy.data.armatures.remove(data)
    return len(doomed)


def build(preset_id, with_blocks=True):
    rig = None
    with open(find_rig_json(), "r", encoding="utf-8") as fh:
        data = json.load(fh)
    for p in data["presets"]:
        if p["id"] == preset_id:
            rig = p
    if rig is None:
        names = ", ".join(p["id"] for p in data["presets"])
        raise SystemExit("no such preset: %s (have %s)" % (preset_id, names))

    # Whatever the file was doing, this starts from object mode.
    if bpy.context.object is not None and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    arm_data = bpy.data.armatures.new("BZ_Armature")
    arm_obj = bpy.data.objects.new("BZ_Armature", arm_data)
    arm_obj["bz_generated"] = True
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.show_in_front = True
    arm_data.display_type = "OCTAHEDRAL"

    # --- bones -------------------------------------------------------------
    bpy.ops.object.mode_set(mode="EDIT")
    frames = {}
    for bone in rig["bones"]:
        head, tail, length, x, y, z = bone_frame(bone)
        frames[bone["name"]] = (head, tail, length, x, y, z)
        eb = arm_data.edit_bones.new(bone["name"])
        eb.head = head
        eb.tail = tail
        # align_roll turns the bone about its own axis until its local Z
        # points as asked - which is how the app's X ends up where the app
        # puts it, since the frame is right-handed either way.
        eb.align_roll(z)
    for bone in rig["bones"]:
        if not bone["parent"]:
            continue
        eb = arm_data.edit_bones[bone["name"]]
        eb.parent = arm_data.edit_bones[bone["parent"]]
        # Connected only where the joint really is the parent's tip, so the
        # clavicles and the thighs stay free to sit where they sit.
        eb.use_connect = (eb.head - eb.parent.tail).length < 1e-6
    bpy.ops.object.mode_set(mode="OBJECT")

    # --- what each bone is, and how far it may turn -------------------------
    for bone in rig["bones"]:
        b = arm_data.bones[bone["name"]]
        b["bz_kind"] = bone["kind"]
        b["bz_hint"] = bone["hint"]
        b["bz_limit_x"] = list(bone["limits"]["x"])
        b["bz_limit_y"] = list(bone["limits"]["y"])
        b["bz_limit_z"] = list(bone["limits"]["z"])
        if bone.get("mirror"):
            b["bz_mirror"] = bone["mirror"]
        pb = arm_obj.pose.bones[bone["name"]]
        pb.rotation_mode = "XYZ"
        if bone["kind"] == "root":
            continue
        c = pb.constraints.new("LIMIT_ROTATION")
        c.name = "Bozzetto limits"
        c.owner_space = "LOCAL"
        for axis in ("x", "y", "z"):
            lo, hi = bone["limits"][axis]
            setattr(c, "use_limit_%s" % axis, True)
            setattr(c, "min_%s" % axis, math.radians(lo))
            setattr(c, "max_%s" % axis, math.radians(hi))

    # --- the rig's own facts, for the app to read out of a .glb -------------
    arm_obj["bz_rig"] = json.dumps(
        {"id": rig["id"], "label": rig["label"], "height": rig["height"], "ik": rig["ik"]},
        separators=(",", ":"),
    )

    if not with_blocks:
        return arm_obj

    # --- a box per part, weighted to its bone -------------------------------
    for bone in rig["bones"]:
        part = bone.get("part")
        if not part:
            continue
        head, tail, length, x, y, z = frames[bone["name"]]
        # The app's rule: a part with a length of its own sits centred on
        # the joint, the rest run from the joint out to the tail.
        box_len = part.get("length") or length
        offset = (length if part.get("length") else box_len) / 2.0
        w, d = part["width"] / 2.0, part["depth"] / 2.0
        lo, hi = offset - box_len / 2.0, offset + box_len / 2.0
        verts = [
            (-w, lo, -d), (w, lo, -d), (w, hi, -d), (-w, hi, -d),
            (-w, lo, d), (w, lo, d), (w, hi, d), (-w, hi, d),
        ]
        faces = [
            (0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
            (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
        ]
        mesh = bpy.data.meshes.new("part_%s" % bone["name"])
        mesh.from_pydata(verts, [], faces)
        mesh.update()
        obj = bpy.data.objects.new("part_%s" % bone["name"], mesh)
        obj["bz_generated"] = True
        bpy.context.scene.collection.objects.link(obj)
        # Into the bone's rest frame: the box is built with Y along the bone.
        obj.matrix_world = Matrix((
            (x.x, y.x, z.x, head.x),
            (x.y, y.y, z.y, head.y),
            (x.z, y.z, z.z, head.z),
            (0.0, 0.0, 0.0, 1.0),
        ))
        vg = obj.vertex_groups.new(name=bone["name"])
        vg.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = arm_obj
        obj.parent = arm_obj
        obj.matrix_parent_inverse = arm_obj.matrix_world.inverted()
    return arm_obj


def main():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    # The OPTIONS block is the default; a flag on the command line wins.
    preset = PRESET
    out = SAVE_BLEND or None
    glb = EXPORT_GLB or None
    blocks = WITH_BLOCKS
    replace = REPLACE_PREVIOUS
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--preset" and i + 1 < len(argv):
            preset = argv[i + 1]
            i += 1
        elif a == "--out" and i + 1 < len(argv):
            out = argv[i + 1]
            i += 1
        elif a == "--glb" and i + 1 < len(argv):
            glb = argv[i + 1]
            i += 1
        elif a == "--no-blocks":
            blocks = False
        elif a == "--keep":
            replace = False
        i += 1

    if replace:
        gone = clear_previous()
        if gone:
            print("cleared %d object(s) from an earlier run" % gone)
    arm = build(preset, blocks)
    print(
        "built %s: %d bones%s"
        % (preset, len(arm.data.bones), "" if blocks else " (skeleton only)")
    )
    if out:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(out))
        print("saved %s" % out)
    if glb:
        # export_extras carries bz_rig and the per-bone limits into the
        # file; without it the app gets a skeleton with no rules.
        bpy.ops.export_scene.gltf(
            filepath=os.path.abspath(glb),
            export_format="GLB",
            export_extras=True,
            export_yup=True,
            export_apply=False,
        )
        print("exported %s" % glb)


if __name__ == "__main__":
    main()
