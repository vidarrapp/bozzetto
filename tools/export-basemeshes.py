"""
Export the Blender Studio Human Base Meshes bundle (CC0) into Bozzetto's
base-mesh files: public/assets/basemeshes/<id>.bzm plus thumbs/<id>.png.

    blender -b --python tools/export-basemeshes.py -- --bundle <dir> [--out <dir>] [--only <id,...>]
    python tools/export-basemeshes.py --bundle <dir>          # with the bpy wheel

<dir> is the unpacked human-base-meshes-bundle-vX.Y.Z folder (it holds
human_base_meshes_bundle.blend). The output folder defaults to
public/assets/basemeshes next to this repo's tools/ folder.

What comes out
--------------
One .bzm per catalogue entry below. A file holds one or more PARTS (a body
and its two eyes, say), each an independent welded mesh:

    'BZM1'  u32 version=1  u32 partCount  u32 reserved
    per part:
      u32 nameLen, name (utf-8, zero-padded to 4 bytes)
      u32 nVerts, u32 nFaces, u32 indexBytes (2 or 4)
      f32 offset[3]      the part's centre relative to the asset's centre
      f32 positions[nVerts*3]
      u16|u32 faces[nFaces*4]   quads; a triangle's 4th index is 0xFFFF / 0xFFFFFFFF
      zero padding to a 4-byte boundary

After the parts, optionally, the parts' POLY GROUPS (2026-11-01; a reader
from before it stops after the parts and never sees them):

    'GRPS'  u32 version=1  u32 partCount
    per part:
      u32 nGroups            0: the part has no groups (one face set, or none)
      per group: u32 nameLen, name (utf-8, zero-padded to 4 bytes)
      u32 indexBytes (1 or 2), then one group index a face (u8|u16),
      zero padding to a 4-byte boundary

A part's groups are its sculpt FACE SETS (Blender's `.sculpt_face_set`
face attribute), as the evaluated mesh carries them at the exported
level: each set a group, numbered by its first face and named by body
region from FACE_SET_NAMES below (Blender's face sets have numbers, not
names). A
voxel-remeshed blockout has no face sets left; tools/basemesh-groups.mjs
gives it its lumps' names instead (each face the nearest lump), and this
script runs it after writing the shells when node is on the PATH.

Everything is little-endian, in metres, Y up, facing +Z (Blender's Z up
and -Y forward rotated: x, z, -y). Each part's positions are relative to
its own bounding-box centre so the app can pivot it on itself; `offset`
puts the parts back together. Quads are kept because the app's
multiresolution stack subdivides quads cleanly; only n-gons (rare, one in
the whole bundle) are fanned into triangles.

Which level of each asset ships is decided per entry: `level` is the
Multires or Subdivision Surface level to evaluate at (0 = the base mesh).
The 'blockout' figures - Blender's "primitive" bodies, which are 50 separate
subdivided lumps - are voxel-remeshed here into one closed shell so the app
gets a single sculptable object; `voxel` is the voxel size in metres. With
`parts=True` a second file, <id>-parts.bzm, keeps every lump as its own
part, hierarchy order (pelvis first), named for people ("Upper arm L"), for
the app's "as parts" option and as the mannequin's segments.

Blender warns about invalid drivers on the primitive bodies' mask
modifiers when the file opens; harmless, and those modifiers are switched
off here anyway.
"""

import os
import shutil
import struct
import subprocess
import sys

import bpy

TRI16 = 0xFFFF
TRI32 = 0xFFFFFFFF

# id, label, source datablock (object or collection asset), export options
ASSETS = [
    # --- bodies ---------------------------------------------------------
    dict(id='body-male-realistic', src='Body Male - Realistic', level=1),
    dict(id='body-female-realistic', src='Body Female - Realistic', level=1),
    dict(id='body-male-stylized', src='Body Male - Stylized', level=0),
    dict(id='body-female-stylized', src='Body Female - Stylized', level=0),
    dict(id='blockout-male-realistic', src='Body Male - Primitve (Realistic)', level=1, voxel=0.007, parts=True),
    dict(id='blockout-female-realistic', src='Body Female - Primitve (Realistic)', level=1, voxel=0.007, parts=True),
    dict(id='blockout-male-stylized', src='Body Male - Primitve (Stylized)', level=1, voxel=0.007, parts=True),
    dict(id='blockout-female-stylized', src='Body Female - Primitive (Stylized)', level=1, voxel=0.007, parts=True),
    # --- heads ----------------------------------------------------------
    dict(id='head-realistic', src='Head (Sculpting) - Realistic', level=1),
    dict(id='head-stylized', src='Head - Stylized', level=0),
    dict(id='head-planar', src='Head - Planar', level=2),
    dict(id='head-generic', src='Head - Generic Topology', level=0),
    dict(id='head-blockout', src='Head - Primitives', level=1, voxel=0.002, parts=True),
    # --- parts ----------------------------------------------------------
    dict(id='hand-realistic', src='Hand  - Realistic', level=1),
    dict(id='hand-stylized', src='Hand - Stylized ', level=0),
    dict(id='foot-realistic', src='Foot - Realistic', level=1),
    dict(id='foot-stylized', src='Foot - Stylized ', level=0),
    dict(id='eye-realistic', src='Eye - Realistic', level=0),
    dict(id='eye-stylized', src='Eye - Stylized', level=0),
    dict(id='jaw-realistic', src='Jaw - Realistic', level=0),
    dict(id='jaw-stylized', src='Jaw - Stylized ', level=0),
    dict(id='skull-realistic', src='Skull - Realistic', level=0),
    dict(id='skull-planar', src='Skull - Planar', level=0),
]

# Parts of a collection asset that are left out: the realistic heads carry
# a flat iris disc inside each sclera, useless as a sculpt object.
SKIP_PART = ('.iris.',)


def parse_args():
    argv = sys.argv
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    else:
        argv = argv[1:]
    here = os.path.dirname(os.path.abspath(__file__))
    opts = {'bundle': None, 'out': os.path.join(here, '..', 'public', 'assets', 'basemeshes'), 'only': None}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--bundle':
            opts['bundle'] = argv[i + 1]; i += 2
        elif a == '--out':
            opts['out'] = argv[i + 1]; i += 2
        elif a == '--only':
            opts['only'] = set(argv[i + 1].split(',')); i += 2
        else:
            raise SystemExit(f'unknown argument {a!r}')
    if not opts['bundle']:
        raise SystemExit('--bundle <unpacked bundle folder> is required')
    return opts


def source_objects(name):
    """The mesh objects behind an asset: the object itself, or every mesh in
    the collection asset (minus the skipped parts)."""
    ob = bpy.data.objects.get(name)
    if ob is not None:
        return [ob]
    col = bpy.data.collections.get(name)
    if col is None:
        raise SystemExit(f'no object or collection named {name!r} in the bundle')
    return [o for o in col.all_objects if o.type == 'MESH' and not any(s in o.name for s in SKIP_PART)]


def set_levels(ob, level):
    """Evaluate at one Multires/Subdivision level; masks and the like off."""
    for m in ob.modifiers:
        if m.type == 'MULTIRES':
            m.levels = min(level, m.total_levels)
            m.show_viewport = True
        elif m.type == 'SUBSURF':
            m.levels = level
            m.show_viewport = level > 0
        elif m.type == 'MIRROR':
            m.show_viewport = True
        else:
            m.show_viewport = False


FACE_SET = ('.sculpt_face_set', 'sculpt_face_set')


def face_sets_of(me):
    """The evaluated mesh's face set a polygon, or None when it has none."""
    for name in FACE_SET:
        a = me.attributes.get(name)
        if a is not None and a.domain == 'FACE' and len(a.data) == len(me.polygons):
            vals = [0] * len(a.data)
            a.data.foreach_get('value', vals)
            return vals
    return None


def evaluated_geometry(ob, dg, with_sets=False):
    """World-space, Y-up positions and polygon index lists of an object as
    evaluated with its modifiers (and, with `with_sets`, its face set a
    polygon, or None)."""
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    sets = None
    try:
        if with_sets:
            sets = face_sets_of(me)
        mw = ev.matrix_world
        verts = []
        for v in me.vertices:
            p = mw @ v.co
            verts.append((p.x, p.z, -p.y))
        # The primitive figures' right-hand parts are the left ones mirrored,
        # with a negative scale: a matrix with a negative determinant. A
        # reflection turns every polygon's corners the other way round, so
        # baked into world space as authored its faces would wind inward and
        # its normals point into the part. Blender allows for that when it
        # draws an object through its matrix; baked, the corners have to be
        # put back in order here. The first corner stays first, so a quad
        # split into triangles from it is cut along the same diagonal as its
        # mirror image. (The Y-up swap is a rotation and changes nothing.)
        polys = [tuple(p.vertices) for p in me.polygons]
        if mw.determinant() < 0:
            polys = [(q[0],) + q[:0:-1] for q in polys]
    finally:
        ev.to_mesh_clear()
    if with_sets:
        return verts, polys, sets
    return verts, polys


def remeshed(parts, voxel, dg):
    """Join evaluated parts into one mesh, voxel-remesh and smooth it, and
    hand back the single closed shell (Y-up, world space)."""
    verts, faces = [], []
    for ob in parts:
        v, p = evaluated_geometry(ob, dg)
        base = len(verts)
        verts.extend(v)
        faces.extend([tuple(base + i for i in poly) for poly in p])
    # Back to Blender's frame for the modifier stack: (x, y, z)_app -> (x, -z, y)
    me = bpy.data.meshes.new('bz_join')
    me.from_pydata([(x, -z, y) for (x, y, z) in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new('bz_join', me)
    bpy.context.scene.collection.objects.link(ob)
    rm = ob.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = voxel
    rm.use_smooth_shade = True
    sm = ob.modifiers.new('smooth', 'SMOOTH')
    sm.factor = 0.5
    sm.iterations = 3
    dg.update()
    out = evaluated_geometry(ob, dg)
    bpy.context.scene.collection.objects.unlink(ob)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return out


# The bundle's part names, made readable: 'GEO-arm_upper_male_primitive_realistic.L'
# is "Upper arm L". Tokens not listed are title-cased as they are.
PART_LABELS = {
    'pelvis': 'Pelvis', 'belly': 'Belly', 'chest': 'Chest', 'neck': 'Neck', 'head': 'Head',
    'breast': 'Breast', 'breasts': 'Breasts',
    'shoulder': 'Shoulder', 'arm_upper': 'Upper arm', 'arm_lower': 'Forearm', 'hand': 'Hand',
    'finger_index': 'Index finger', 'finger_middle': 'Middle finger', 'finger_ring': 'Ring finger',
    'finger_pinky': 'Little finger', 'thumb': 'Thumb',
    'leg_upper': 'Thigh', 'leg_lower': 'Shin', 'foot': 'Foot',
    'toe_big': 'Big toe', 'toe_index': 'Second toe', 'toe_middle': 'Middle toe',
    'toe_ring': 'Fourth toe', 'toe_pinky': 'Little toe',
    'ear': 'Ear', 'eye': 'Eye', 'eyelid_upper': 'Upper eyelid', 'eyelid_lower': 'Lower eyelid',
    'nose': 'Nose', 'nose_bridge': 'Nose bridge',
}


def part_token(ob):
    """The bare body-part token of a bundle part ('arm_upper') and its side
    ('L', 'R' or ''), with the sex, style and Blender's numbering stripped."""
    import re
    n = ob.name.lower()
    n = re.sub(r'^geo-', '', n)
    side = ''
    m = re.search(r'\.(l|r)$', n)
    if m:
        side = m.group(1).upper()
        n = n[:m.start()]
    n = re.sub(r'\.\d+', '', n)
    # 'primitive', and the bundle's 'primitve' where it is spelt that way
    n = re.sub(r'_(male|female)_primiti?ve_(realistic|stylized)$', '', n)
    n = re.sub(r'_primiti?ve_(male|female)_(realistic|stylized)$', '', n)
    n = re.sub(r'_primiti?ve$', '', n)
    n = n.replace('teo_', 'toe_')
    return n, side


def readable_name(ob):
    token, side = part_token(ob)
    label = PART_LABELS.get(token) or token.replace('_', ' ').capitalize()
    return f'{label} {side}' if side else label


def hierarchy_order(objs):
    """Parents before children, the root first, so the app selects the
    pelvis (or the head) after adding a figure's parts."""
    names = {o.name for o in objs}

    def depth(o):
        d = 0
        while o.parent is not None and o.parent.name in names:
            o = o.parent
            d += 1
        return d

    return sorted(objs, key=lambda o: (depth(o), o.name))


def part_name(ob, asset_id):
    """The main part is named after the asset (the app labels it); a companion
    takes its suffix: 'GEO-body_male_realistic.eye.L' -> 'Eye L', and the
    realistic heads' scleras are just eyes to the app."""
    if ob.parent is None or '.' not in ob.name:
        return asset_id
    tail = ob.name.split('.', 1)[1].replace('sclera', 'eye')
    return ' '.join(w.capitalize() if len(w) > 1 else w for w in tail.split('.'))


def quads_of(polys, sets=None):
    """Polygon index lists -> flat quad list (tri marker as None), fanning
    n-gons; with `sets` (one a polygon), also each quad's polygon's set."""
    out = []
    out_sets = []
    for i, p in enumerate(polys):
        if len(p) == 4:
            n = 1
            out.append(p)
        elif len(p) == 3:
            n = 1
            out.append((p[0], p[1], p[2], None))
        else:
            n = len(p) - 2
            for k in range(1, len(p) - 1):
                out.append((p[0], p[k], p[k + 1], None))
        if sets is not None:
            out_sets.extend([sets[i]] * n)
    if sets is not None:
        return out, out_sets
    return out


# --- face set names -----------------------------------------------------
#
# Blender's face sets are numbers. These tables name each mesh's sets by
# body region (Vidar's call, 2026-11-01), worked out from each set's
# geometry in the bundle v1.4.1 (centroid, extent, side of X = 0 and which
# sets it borders; the probe printed them per mesh). L and R are the
# model's own sides: in Blender's front view the figures face -Y, so the
# model's left is +X. A mesh built with a Mirror modifier has one set for
# both sides, named in the plural ("Thighs"). A name ending in a number
# ("Mouth lining 1") is a set whose region is a best guess. A set missing
# from its table is "Face set <n>" and is printed as a warning.

def _digits(prefix, side, ids):
    """Finger or toe segments: ids for base, middle, tip and nail."""
    parts = ('base', 'middle', 'tip')
    out = {}
    for i, part in zip(ids[:3], parts):
        out[i] = f'{prefix} {part} {side}'
    if len(ids) > 3:
        nail = 'Thumbnail' if prefix == 'Thumb' else (prefix.replace(' finger', ' fingernail') if 'finger' in prefix else prefix.replace(' toe', ' toenail'))
        out[ids[3]] = f'{nail} {side}'
    return out


def _body_realistic():
    t = {
        1: 'Torso', 2: 'Eye socket L', 3: 'Eye socket R', 4: 'Ear L', 5: 'Ear R',
        7: 'Upper lip', 8: 'Lower lip', 22: 'Mouth area', 17: 'Head and neck',
        9: 'Hand L', 10: 'Hand R', 11: 'Forearm R', 12: 'Forearm L',
        20: 'Upper arm R', 21: 'Upper arm L', 19: 'Waist', 18: 'Pelvis',
        23: 'Thigh R', 24: 'Thigh L', 16: 'Shin R', 15: 'Shin L',
        13: 'Foot R', 14: 'Foot L', 26: 'Forefoot R', 25: 'Forefoot L',
        # The right big toe has a base of its own; the left one's is in the forefoot.
        31: 'Big toe base R', 36: 'Big toe tip R', 37: 'Big toenail R',
        46: 'Big toe tip L', 47: 'Big toenail L',
    }
    for side, toes in (('R', ((27, 32, 38, 42), (28, 33, 39, 43), (29, 34, 40, 44), (30, 35, 41, 45))),
                       ('L', ((48, 49, 50, 51), (52, 53, 54, 55), (56, 57, 58, 59), (60, 61, 62, 63)))):
        for name, ids in zip(('Second toe', 'Middle toe', 'Fourth toe', 'Little toe'), toes):
            t.update(_digits(name, side, ids))
    for side, fingers in (('R', ((84, 85, 86, 87), (88, 89, 90, 91), (92, 93, 94, 95), (96, 97, 98, 99), (100, 101, 102, 103))),
                          ('L', ((80, 81, 82, 83), (76, 77, 78, 79), (72, 73, 74, 75), (68, 69, 70, 71), (64, 65, 66, 67)))):
        for name, ids in zip(('Thumb', 'Index finger', 'Middle finger', 'Ring finger', 'Little finger'), fingers):
            t.update(_digits(name, side, ids))
    return t


# The stylized fingers, the same numbers on the figures and the hand.
_STYLIZED_FINGERS = {
    'Thumb': (288, 285, 284), 'Index finger': (278, 283, 282), 'Middle finger': (277, 279, 272),
    'Ring finger': (280, 274, 275), 'Little finger': (281, 286, 276),
}


def _fingers(plural):
    t = {}
    for name, ids in _STYLIZED_FINGERS.items():
        for i, part in zip(ids, ('base', 'middle', 'tip')):
            t[i] = f'{name} {part}s' if plural else f'{name} {part}'
    return t


# The stylized head, on the figures and on its own (one Mirror modifier: both sides in one set).
_HEAD_STYLIZED = {
    44: 'Head', 6: 'Neck', 46: 'Jaw', 45: 'Nose', 29: 'Ears', 27: 'Eye areas 1', 28: 'Eyelids',
    37: 'Eye sockets', 47: 'Upper lip', 48: 'Lower lip', 49: 'Mouth interior',
}

FACE_SET_NAMES = {
    'body-realistic': _body_realistic(),
    'body-stylized': {
        **_HEAD_STYLIZED, **_fingers(True), 359: 'Thumb bases',
        259: 'Torso', 260: 'Shoulders', 258: 'Pelvis', 263: 'Upper arms', 262: 'Forearms', 273: 'Hands',
        256: 'Thighs', 257: 'Shins', 288: 'Ankles', 316: 'Feet', 317: 'Forefeet',
        318: 'Big toes', 319: 'Second toes', 320: 'Middle toes', 321: 'Fourth toes', 322: 'Little toes',
    },
    'head-realistic': {
        11: 'Cranium', 8: 'Upper face', 2: 'Eye socket R', 3: 'Eye socket L', 4: 'Ear R', 5: 'Ear L',
        9: 'Nose', 6: 'Mouth', 7: 'Jaw', 10: 'Neck', 12: 'Neck base',
    },
    'head-stylized': {**_HEAD_STYLIZED, 359: 'Neck base'},
    'eye-stylized': {358: 'Sclera', 53: 'Iris', 52: 'Pupil'},
    'hand-realistic': {
        24: 'Hand', 10: 'Fingernails',
        23: 'Thumb base', 22: 'Thumb middle', 21: 'Thumb tip',
        19: 'Index finger base', 16: 'Index finger middle', 3: 'Index finger tip',
        18: 'Middle finger base', 15: 'Middle finger middle', 4: 'Middle finger tip',
        17: 'Ring finger base', 14: 'Ring finger middle', 5: 'Ring finger tip',
        13: 'Little finger base', 12: 'Little finger middle', 11: 'Little finger tip',
    },
    'hand-stylized': {**_fingers(False), 273: 'Hand', 262: 'Wrist', 287: 'Wrist cap'},
    'foot-realistic': {
        13: 'Ankle', 1: 'Foot', 12: 'Forefoot', 3: 'Toe tips 1', 2: 'Toenails', 8: 'Big toe',
        9: 'Second toe base', 4: 'Second toe middle', 10: 'Middle toe base', 5: 'Middle toe middle',
        11: 'Outer toes 1', 6: 'Outer toes 2',
    },
    'foot-stylized': {
        316: 'Foot', 317: 'Forefoot', 288: 'Ankle', 323: 'Ankle cap',
        318: 'Big toe', 319: 'Second toe', 320: 'Middle toe', 321: 'Fourth toe', 322: 'Little toe',
    },
    'skull-realistic': {
        7: 'Cranium', 1: 'Frontal bone', 9: 'Parietal L', 18: 'Parietal R', 6: 'Temporal L', 16: 'Temporal R',
        5: 'Zygomatic L', 15: 'Zygomatic R', 4: 'Maxilla L', 14: 'Maxilla R', 8: 'Sphenoid 1 L', 17: 'Sphenoid 1 R',
        2: 'Nasal bone L', 12: 'Nasal bone R', 3: 'Lacrimal L', 13: 'Lacrimal R', 11: 'Nasal septum', 10: 'Vomer',
        33: 'Mandible', 34: 'Upper teeth', 35: 'Lower teeth',
    },
    'skull-planar': {1: 'Cranium', 2: 'Face', 6: 'Cheekbones 1', 4: 'Mandible', 5: 'Teeth'},
}


def _teeth(rows):
    t = {}
    for (jaw, side), ids, names in rows:
        for i, n in zip(ids, names):
            t[i] = f'{jaw} {n} {side}'
    return t


_REAL_TEETH = ('central incisor', 'lateral incisor', 'canine', 'first premolar', 'second premolar', 'first molar', 'second molar')
FACE_SET_NAMES['jaw-realistic'] = {
    31: 'Tongue', 93: 'Upper gum', 155: 'Lower gum', 157: 'Mouth lining 1',
    **_teeth((
        (('Lower', 'L'), (158, 165, 166, 167, 168, 169, 170), _REAL_TEETH),
        (('Upper', 'L'), (171, 159, 160, 161, 162, 163, 164), _REAL_TEETH),
        (('Lower', 'R'), (172, 179, 180, 181, 182, 183, 184), _REAL_TEETH),
        (('Upper', 'R'), (185, 173, 174, 175, 176, 177, 178), _REAL_TEETH),
    )),
}
_STYL_TEETH = ('central incisor', 'lateral incisor', 'canine', 'premolar', 'first molar', 'second molar', 'third molar')
FACE_SET_NAMES['jaw-stylized'] = {
    351: 'Tongue', 352: 'Tongue base', 353: 'Upper gum', 354: 'Upper gum top', 355: 'Lower gum', 356: 'Lower gum base',
    **_teeth((
        (('Upper', 'L'), (323, 328, 326, 324, 329, 327, 325), _STYL_TEETH),
        (('Upper', 'R'), (330, 335, 333, 331, 336, 334, 332), _STYL_TEETH),
        (('Lower', 'L'), (337, 342, 339, 338, 343, 341, 340), _STYL_TEETH),
        (('Lower', 'R'), (344, 349, 346, 345, 350, 348, 347), _STYL_TEETH),
    )),
}


def face_set_table(asset_id, ob):
    """The names table for one part of an asset, or None."""
    if '.eye.' in ob.name or asset_id == 'eye-stylized':
        return FACE_SET_NAMES['eye-stylized']
    key = asset_id.replace('-male', '').replace('-female', '')
    return FACE_SET_NAMES.get(key)


def groups_of(face_sets, table=None, label=''):
    """Face sets (one a face) -> (names, one group index a face), the
    groups numbered by first face and named from `table` (face set number
    -> name; "Face set <n>" where it has none); None for fewer than two."""
    if not face_sets:
        return None
    order = {}
    for v in face_sets:
        if v not in order:
            order[v] = len(order)
    if len(order) < 2:
        return None
    names = []
    for i, v in enumerate(order):
        name = (table or {}).get(v)
        if name is None:
            name = f'Face set {i + 1}'
            print(f'  WARNING {label}: face set {v} has no name in FACE_SET_NAMES')
        names.append(name)
    if len(set(names)) != len(names):
        raise SystemExit(f'{label}: two face sets share a name')
    unused = sorted(set(table or {}) - set(order))
    if table and unused:
        print(f'  WARNING {label}: FACE_SET_NAMES has sets the mesh does not: {unused}')
    return names, [order[v] for v in face_sets]


def groups_trailer(groups):
    """The 'GRPS' section: `groups` one a part, (names, indices) or None."""
    chunks = [struct.pack('<4sII', b'GRPS', 1, len(groups))]
    for g in groups:
        if g is None:
            chunks.append(struct.pack('<I', 0))
            continue
        names, idx = g
        chunks.append(struct.pack('<I', len(names)))
        for n in names:
            nb = n.encode('utf-8')
            chunks.append(struct.pack('<I', len(nb)) + nb + b'\0' * (-len(nb) % 4))
        one = len(names) <= 256
        chunks.append(struct.pack('<I', 1 if one else 2))
        body = struct.pack(f'<{len(idx)}{"B" if one else "H"}', *idx)
        chunks.append(body + b'\0' * (-len(body) % 4))
    return b''.join(chunks)


def bbox(verts):
    xs = [v[0] for v in verts]; ys = [v[1] for v in verts]; zs = [v[2] for v in verts]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def signed_volume(verts, quads):
    """The volume a closed part encloses, positive when its faces wind
    outward: each face fanned into triangles, each triangle the signed
    volume a . (b x c) / 6 of the tetrahedron it makes with the part's
    centre. (Taken about the centre, as the file stores the part, so an
    open shell - the stylized jaw - still reads sensibly.)"""
    lo, hi = bbox(verts)
    c = tuple((lo[i] + hi[i]) / 2 for i in range(3))
    p = [(v[0] - c[0], v[1] - c[1], v[2] - c[2]) for v in verts]
    total = 0.0
    for q in quads:
        corners = [i for i in q if i is not None]
        ax, ay, az = p[corners[0]]
        for k in range(1, len(corners) - 1):
            bx, by, bz = p[corners[k]]
            cx, cy, cz = p[corners[k + 1]]
            total += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6
    return total


def check_outward(file_id, parts):
    """Each part's signed volume, printed; a negative one faces inward
    (it would render inside out) and stops the export before the file is
    written. Returns the volumes, in the parts' order."""
    vols = [signed_volume(verts, quads) for _, verts, quads in parts]
    inward = [name for (name, _, _), v in zip(parts, vols) if v < 0]
    if inward:
        for (name, _, _), v in zip(parts, vols):
            print(f'    {name}: vol={v * 1e6:+.1f} cm3')
        raise SystemExit(f'{file_id}: faces wind inward (negative volume) on ' + ', '.join(inward))
    return vols


def write_bzm(path, parts, groups=None):
    """parts: list of (name, verts, quads) in the shared asset frame;
    groups: None, or one a part, (names, one index a quad) or None."""
    allv = [v for _, verts, _ in parts for v in verts]
    lo, hi = bbox(allv)
    centre = tuple((lo[i] + hi[i]) / 2 for i in range(3))
    chunks = [struct.pack('<4sIII', b'BZM1', 1, len(parts), 0)]
    stats = []
    for name, verts, quads in parts:
        plo, phi = bbox(verts)
        pc = tuple((plo[i] + phi[i]) / 2 for i in range(3))
        offset = tuple(pc[i] - centre[i] for i in range(3))
        nb = name.encode('utf-8')
        two = len(verts) < 0xFFFF
        chunks.append(struct.pack('<I', len(nb)))
        chunks.append(nb + b'\0' * (-len(nb) % 4))
        chunks.append(struct.pack('<III', len(verts), len(quads), 2 if two else 4))
        chunks.append(struct.pack('<3f', *offset))
        flat = []
        for v in verts:
            flat.extend((v[0] - pc[0], v[1] - pc[1], v[2] - pc[2]))
        chunks.append(struct.pack(f'<{len(flat)}f', *flat))
        marker = TRI16 if two else TRI32
        idx = []
        for q in quads:
            idx.extend(marker if i is None else i for i in q)
        chunks.append(struct.pack(f'<{len(idx)}{"H" if two else "I"}', *idx))
        if two and len(idx) % 2:
            chunks.append(b'\0\0')
        stats.append((name, len(verts), len(quads), sum(1 for q in quads if q[3] is None)))
    if groups and any(g is not None for g in groups):
        chunks.append(groups_trailer(groups))
    data = b''.join(chunks)
    with open(path, 'wb') as f:
        f.write(data)
    return len(data), stats, tuple(hi[i] - lo[i] for i in range(3))


def write_thumb(idblock, path, size=96):
    pv = idblock.preview
    if pv is None or pv.image_size[0] == 0:
        print(f'  no preview for {idblock.name!r}')
        return False
    w, h = pv.image_size
    img = bpy.data.images.new('bz_thumb', w, h, alpha=True)
    img.pixels = pv.image_pixels_float[:]
    img.scale(size, size)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    return True


def main():
    opts = parse_args()
    blend = os.path.join(opts['bundle'], 'human_base_meshes_bundle.blend')
    if not os.path.exists(blend):
        raise SystemExit(f'{blend} not found')
    out = os.path.abspath(opts['out'])
    os.makedirs(os.path.join(out, 'thumbs'), exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(blend))
    manifest = []
    shells = []
    for entry in ASSETS:
        if opts['only'] and entry['id'] not in opts['only']:
            continue
        objs = source_objects(entry['src'])
        for ob in objs:
            set_levels(ob, entry['level'])
        dg = bpy.context.evaluated_depsgraph_get()
        dg.update()
        if entry.get('voxel'):
            verts, polys = remeshed(objs, entry['voxel'], dg)
            parts = [(entry['id'], verts, quads_of(polys))]
            groups = None
        else:
            parts = []
            groups = []
            # The main part first (the one that is not parented to another
            # part), then the rest in name order, so the app selects the body
            # rather than an eye after adding.
            ordered = sorted(objs, key=lambda o: (o.parent is not None, o.name))
            for ob in ordered:
                verts, polys, sets = evaluated_geometry(ob, dg, with_sets=True)
                quads, quad_sets = quads_of(polys, sets if sets is not None else [0] * len(polys))
                parts.append((part_name(ob, entry['id']), verts, quads))
                label = f"{entry['id']} {ob.name}"
                groups.append(groups_of(quad_sets, face_set_table(entry['id'], ob), label) if sets is not None else None)
        path = os.path.join(out, f"{entry['id']}.bzm")
        vols = check_outward(entry['id'], parts)
        size, stats, dims = write_bzm(path, parts, groups)
        if groups:
            for (name, _, _), g in zip(parts, groups):
                print(f'    {name}: ' + (f'{len(g[0])} face sets' if g else 'no face sets'))
        if entry.get('voxel'):
            shells.append(entry['id'])
        if entry.get('parts'):
            split = []
            for ob in hierarchy_order(objs):
                verts, polys = evaluated_geometry(ob, dg)
                split.append((readable_name(ob), verts, quads_of(polys)))
            pvols = check_outward(f"{entry['id']}-parts", split)
            psize, pstats, _ = write_bzm(os.path.join(out, f"{entry['id']}-parts.bzm"), split)
            print(f"{entry['id']}-parts: {len(split)} parts verts={sum(x[1] for x in pstats)} "
                  f"faces={sum(x[2] for x in pstats)} {psize / 1024:.0f} KB: "
                  + ', '.join(x[0] for x in pstats))
            for x, v in zip(pstats, pvols):
                print(f'    {x[0]}: vol={v * 1e6:+.1f} cm3')
        idblock = bpy.data.objects.get(entry['src']) or bpy.data.collections.get(entry['src'])
        write_thumb(idblock, os.path.join(out, 'thumbs', f"{entry['id']}.png"))
        faces = sum(s[2] for s in stats)
        verts = sum(s[1] for s in stats)
        ad = idblock.asset_data
        print(f"{entry['id']}: {len(parts)} part(s) verts={verts} faces={faces} "
              f"dims=({dims[0]:.2f}, {dims[1]:.2f}, {dims[2]:.2f}) m {size / 1024:.0f} KB  "
              f"author={ad.author!r}")
        for s, v in zip(stats, vols):
            print(f'    {s[0]}: v={s[1]} f={s[2]} tris={s[3]} vol={v * 1e6:+.1f} cm3')
        manifest.append(dict(id=entry['id'], parts=len(parts), verts=verts, faces=faces, bytes=size, author=ad.author))
    print('MANIFEST', manifest)
    # The remeshed shells' groups, from their lumps (tools/basemesh-groups.mjs).
    if shells:
        tool = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'basemesh-groups.mjs')
        node = shutil.which('node')
        if node:
            subprocess.run([node, tool, '--dir', out, *shells], check=True)
        else:
            print(f'node is not on the PATH: run `node tools/basemesh-groups.mjs --dir {out} ' + ' '.join(shells) + '` for the shells\' groups.')


main()
