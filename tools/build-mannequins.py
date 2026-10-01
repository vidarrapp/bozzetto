"""
Build the Armature mode's mannequins from the Blender Studio Human Base
Meshes bundle (CC0): the bundle's "primitive" figures, fifty separate lumps
each, rigged onto Bozzetto's own bones and exported as skinned .glb files
the app reads like any rigged model.

    blender -b --python tools/build-mannequins.py -- --bundle <dir> [--out <dir>] [--only <id,...>]
    python tools/build-mannequins.py --bundle <dir>          # with the bpy wheel

Or inside Blender: open the bundle's human_base_meshes_bundle.blend, open
this file in the Text editor (Text > Open), set the OPTIONS below if the
defaults do not suit, and Run Script. The rigged figures appear in the
scene, spaced out along X, and the .glb files are written.

Each lump belongs to one bone (a thigh lump to thigh.L, the deltoid to
upperarm.L, every toe to foot.L, the ears and eyes to the head) and
follows it rigidly, which is how the app's box figure works too. The bones
themselves are the rig from tools/rig.json (the app's placeholder figure:
names, kinds, hints, limits, mirrors, reach chains); only their positions
come from the lumps: a joint in a chain from where a lump overlaps the one
it hangs off, a hip from the middle of its half of the pelvis, a shoulder
from the middle of the deltoid and the neck from its lump's centre line,
a third of the way up. The hinges (forearm, shin) get limits of their
own, folding the anatomical way through a range sized from the bend the
figure rests with, which is the bundle's own A-pose.

What the app reads: bone names with .L/.R, bz_kind / bz_hint / bz_mirror
and bz_limit_x/y/z on the bones (Custom Properties, exported as extras),
bz_rig on the armature object with the reach chains. See
src/armature/glbRig.ts.

Run inside Blender with the bundle open to look at the result; the
mannequin lands in the scene beside the bundle's own figures.
"""

import json
import math
import os
import re
import sys

import bpy
from mathutils import Vector

# --- OPTIONS (for the Text editor; the command line overrides them) --------
# The unpacked bundle folder, the one holding human_base_meshes_bundle.blend.
# Left empty, the file open in Blender is taken to be the bundle.
BUNDLE = ""
# Where the .glb files go. Left empty: the repository's public/assets/armature
# when this script was opened from the repository, else beside the bundle.
OUT = ""
# Which figures to build: "" for all four, or ids separated by commas, e.g.
# "mannequin-male-realistic".
ONLY = ""
# Where rig.json is (the app's rig). Left empty it is looked for beside this
# script, then beside any text block opened from disk, then in the working
# folder. Fill it in if you pasted the script rather than opening the file.
RIG_JSON = ""
# Whether to write the .glb files. Off, the figures are only built in the
# scene, to look at and edit; export by hand from File > Export > glTF 2.0
# with Custom Properties on, the armature and its mesh selected.
EXPORT = True
# Re-running clears the figures the last run made, so a tweak-and-run loop
# does not pile up copies.
REPLACE_PREVIOUS = True
# ---------------------------------------------------------------------------

BUNDLE_BLEND = 'human_base_meshes_bundle.blend'

FIGURES = [
    dict(id='mannequin-male-realistic', label='Realistic male', src='Body Male - Primitve (Realistic)', rig='placeholder-male'),
    dict(id='mannequin-female-realistic', label='Realistic female', src='Body Female - Primitve (Realistic)', rig='placeholder-female'),
    dict(id='mannequin-male-stylized', label='Stylized male', src='Body Male - Primitve (Stylized)', rig='placeholder-male'),
    dict(id='mannequin-female-stylized', label='Stylized female', src='Body Female - Primitive (Stylized)', rig='placeholder-female'),
]

# Which bone a lump follows, by the lump's bare name (see part_token). The
# shoulder lump, the deltoid, rides on the upper arm: on the clavicle it
# stayed put while a raised arm swung out from under it (owner report).
BONE_OF = {
    'pelvis': 'pelvis', 'belly': 'spine',
    'chest': 'chest', 'breast': 'chest', 'breasts': 'chest',
    'neck': 'neck',
    'head': 'head', 'ear': 'head', 'eye': 'head', 'eyelid_upper': 'head', 'eyelid_lower': 'head',
    'nose': 'head', 'nose_bridge': 'head',
    'shoulder': 'upperarm', 'arm_upper': 'upperarm', 'arm_lower': 'forearm',
    'hand': 'hand', 'finger_index': 'hand', 'finger_middle': 'hand', 'finger_ring': 'hand',
    'finger_pinky': 'hand', 'thumb': 'hand',
    'leg_upper': 'thigh', 'leg_lower': 'shin',
    'foot': 'foot', 'toe_big': 'foot', 'toe_index': 'foot', 'toe_middle': 'foot', 'toe_ring': 'foot',
    'toe_pinky': 'foot',
}
# The lump that IS the segment, for placing the joint; the rest ride along.
# The clavicle owns no lump now, but its head is still where the shoulder
# lump meets the chest.
PRIMARY = {
    'pelvis': 'pelvis', 'spine': 'belly', 'chest': 'chest', 'neck': 'neck', 'head': 'head',
    'clavicle': 'shoulder', 'upperarm': 'arm_upper', 'forearm': 'arm_lower', 'hand': 'hand',
    'thigh': 'leg_upper', 'shin': 'leg_lower', 'foot': 'foot',
}
# Which way each hinge folds, as the sign of a pose rotation about the
# bone's own X: the knee swings the ankle back (+), the elbow swings the
# hand forward (-). The placeholder rig in rig.ts folds them the same way;
# hinge_limits checks that it still does.
HINGE_FOLD = {'shin': 1, 'forearm': -1}
# How far a hinge folds from straight, how far it opens past straight, and
# the twist it keeps, in degrees.
HINGE_RANGE = 150
HINGE_OPEN = 5
HINGE_TWIST = [-20, 20]
# Vertices this close to the centre plane (metres) are on it: they belong
# to neither half of a lump that straddles it.
CENTRE_BAND = 1e-3
# Where the neck turns: on the neck lump's centre line, this fraction of
# the lump's height up from its lowest vertex. That is where the lump
# leaves the chest at the back on the realistic male, and a little above
# that line on the other three, so the joint sits clearly inside the neck
# at rest. A full 30 degree forward bend still lifts a lip at the back of
# the neck, a little smaller than from higher up: turned about the lump's
# middle, the neck lifted a shelf out of the back under that bend, a rigid
# lump swinging its lower half the other way. Where the lump meets the
# chest, the chain rule's joint, kept the base seated but sat down inside
# the chest and read as off (owner report).
NECK_JOINT_AT = 0.32


def script_dir():
    """Where this script lives, when that can be known: run from a file
    (__file__ is set) or from a text block opened from disk."""
    try:
        return os.path.dirname(os.path.abspath(__file__))
    except NameError:
        pass
    for text in bpy.data.texts:
        if text.filepath and 'mannequin' in os.path.basename(text.filepath):
            return os.path.dirname(bpy.path.abspath(text.filepath))
    return None


def find_rig_json(given):
    tried = []
    if given:
        tried.append(bpy.path.abspath(given))
    here = script_dir()
    if here:
        tried.append(os.path.join(here, 'rig.json'))
    for text in bpy.data.texts:
        if text.filepath:
            tried.append(os.path.join(os.path.dirname(bpy.path.abspath(text.filepath)), 'rig.json'))
    tried.append(os.path.join(os.getcwd(), 'rig.json'))
    tried.append(os.path.join(os.getcwd(), 'tools', 'rig.json'))
    for path in tried:
        if os.path.isfile(path):
            return path
    raise SystemExit('rig.json not found. Set RIG_JSON at the top of the script to its full path. '
                     'Looked in:\n  ' + '\n  '.join(tried))


def parse_args():
    """The command line after `--`, else the OPTIONS block."""
    opts = {'bundle': BUNDLE, 'out': OUT, 'only': set(ONLY.split(',')) if ONLY else None,
            'rig': RIG_JSON, 'export': EXPORT, 'replace': REPLACE_PREVIOUS}
    argv = sys.argv
    # Blender passes the script's own arguments after `--`; the bpy wheel
    # runs the file as a plain Python script, where they follow it directly.
    if '--' in argv:
        argv = argv[argv.index('--') + 1:]
    elif argv and os.path.basename(argv[0]).startswith('build-mannequins'):
        argv = argv[1:]
    else:
        argv = []
    if argv:
        i = 0
        while i < len(argv):
            a = argv[i]
            if a == '--bundle':
                opts['bundle'] = argv[i + 1]; i += 2
            elif a == '--out':
                opts['out'] = argv[i + 1]; i += 2
            elif a == '--only':
                opts['only'] = set(argv[i + 1].split(',')); i += 2
            elif a == '--rig':
                opts['rig'] = argv[i + 1]; i += 2
            elif a == '--no-export':
                opts['export'] = False; i += 1
            else:
                raise SystemExit(f'unknown argument {a!r}')
    return opts


def open_bundle(bundle):
    """Have the bundle open: already open in Blender, or opened from the
    folder given. Interactively, another file stays put - replacing the file
    you are looking at (and the Text editor with it) is not this script's
    call - so the message says what to open instead."""
    current = bpy.data.filepath
    if bundle:
        blend = os.path.abspath(os.path.join(bpy.path.abspath(bundle), BUNDLE_BLEND))
        if not os.path.exists(blend):
            raise SystemExit(f'{blend} not found')
        if current and os.path.abspath(current) == blend:
            return blend
        if current and not bpy.app.background:
            raise SystemExit(f'Open {blend} in Blender first, then run the script (BUNDLE points at a '
                             f'different file from the one that is open).')
        bpy.ops.wm.open_mainfile(filepath=blend)
        return blend
    if not current or os.path.basename(current) != BUNDLE_BLEND:
        raise SystemExit(f'Open the bundle\'s {BUNDLE_BLEND} in Blender first, or set BUNDLE at the top of '
                         f'the script (or pass --bundle) to the unpacked bundle folder.')
    return current


def output_dir(given, blend):
    if given:
        return os.path.abspath(bpy.path.abspath(given))
    here = script_dir()
    if here:
        repo = os.path.abspath(os.path.join(here, '..', 'public', 'assets', 'armature'))
        if os.path.isdir(os.path.dirname(repo)):
            return repo
    return os.path.join(os.path.dirname(blend), 'mannequins')


def clear_previous():
    """Remove what an earlier run made, and only that: everything this
    script creates is stamped, so nothing hand-made is touched."""
    doomed = [o for o in bpy.data.objects if o.get('bz_generated')]
    for ob in doomed:
        data = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Armature):
                bpy.data.armatures.remove(data)
    return len(doomed)


# --- the bundle's lumps ---------------------------------------------------

def part_token(ob):
    """'GEO-arm_upper_male_primitive_realistic.L' -> ('arm_upper', 'L')."""
    n = ob.name.lower()
    n = re.sub(r'^geo-', '', n)
    side = ''
    m = re.search(r'\.(l|r)$', n)
    if m:
        side = m.group(1).upper()
        n = n[:m.start()]
    n = re.sub(r'\.\d+', '', n)
    n = re.sub(r'_(male|female)_primiti?ve_(realistic|stylized)$', '', n)
    n = re.sub(r'_primiti?ve_(male|female)_(realistic|stylized)$', '', n)
    n = re.sub(r'_primiti?ve$', '', n)
    n = n.replace('teo_', 'toe_')
    return n, side


class Lump:
    """One evaluated lump: world-space vertices, polygons, and its own
    oriented box (the local bounds under the object's matrix)."""

    def __init__(self, ob, dg):
        self.ob = ob
        self.token, self.side = part_token(ob)
        ev = ob.evaluated_get(dg)
        me = ev.to_mesh()
        try:
            mw = ev.matrix_world
            self.local = [v.co.copy() for v in me.vertices]
            self.world = [mw @ v for v in self.local]
            # The bundle's right-hand lumps are the left ones mirrored, with
            # a negative scale: a matrix with a negative determinant. A
            # reflection turns every polygon's corners the other way round,
            # so baked into world space as authored its faces would wind
            # inward and its normals point into the lump. Blender allows for
            # that when it draws an object through its matrix; baked, the
            # corners have to be put back in order here. The first corner
            # stays first, so a quad split into triangles from it is cut
            # along the diagonal that mirrors the left lump's.
            self.mirrored = mw.determinant() < 0
            self.polys = [tuple(p.vertices) for p in me.polygons]
            if self.mirrored:
                self.polys = [(q[0],) + q[:0:-1] for q in self.polys]
        finally:
            ev.to_mesh_clear()
        self.matrix = ev.matrix_world.copy()
        self.inverse = self.matrix.inverted()
        lo = Vector((min(v.x for v in self.local), min(v.y for v in self.local), min(v.z for v in self.local)))
        hi = Vector((max(v.x for v in self.local), max(v.y for v in self.local), max(v.z for v in self.local)))
        self.lo, self.hi = lo, hi
        self.centre = self.matrix @ ((lo + hi) / 2)

    def contains(self, p):
        q = self.inverse @ p
        return all(self.lo[i] <= q[i] <= self.hi[i] for i in range(3))

    def bone(self):
        base = BONE_OF.get(self.token)
        if base is None:
            return None
        if base in ('pelvis', 'spine', 'chest', 'neck', 'head'):
            return base
        return f'{base}.{self.side}' if self.side else None


def lumps_of(colname, dg):
    col = bpy.data.collections.get(colname)
    if col is None:
        raise SystemExit(f'no collection named {colname!r} in the bundle')
    objs = [o for o in col.all_objects if o.type == 'MESH']
    for ob in objs:
        for m in ob.modifiers:
            if m.type == 'SUBSURF':
                m.levels = 1
                m.show_viewport = True
            elif m.type != 'MIRROR':
                m.show_viewport = False
    dg.update()
    lumps = [Lump(o, dg) for o in objs]
    recentre(lumps)
    return lumps


def signed_volume(points, polys):
    """The volume a closed mesh encloses, positive when its faces wind
    outward: each face fanned into triangles, each triangle the signed
    volume a . (b x c) / 6 of the tetrahedron it makes with the origin."""
    total = 0.0
    for poly in polys:
        a = points[poly[0]]
        for k in range(1, len(poly) - 1):
            total += a.dot(points[poly[k]].cross(points[poly[k + 1]])) / 6
    return total


def check_outward(fig, lumps):
    """Every lump that goes into the figure is closed, so its signed
    volume says which way it faces: a negative one would render inside
    out. Printed for each, and the build stops on one that faces inward."""
    inward = []
    for l in lumps:
        if l.bone() is None:
            continue
        vol = signed_volume(l.world, l.polys)
        note = '  (mirrored, winding reversed)' if l.mirrored else ''
        print(f"    {l.ob.name:48s} {vol * 1e6:+10.1f} cm3{note}")
        if vol < 0:
            inward.append(l.ob.name)
    if inward:
        raise SystemExit(f"{fig['id']}: faces wind inward (negative volume) on " + ', '.join(inward))


def lump(lumps, token, side=''):
    for l in lumps:
        if l.token == token and l.side == side:
            return l
    raise SystemExit(f'no {token} lump' + (f' on the {side} side' if side else ''))


def primary(lumps, bone):
    base, _, side = bone.partition('.')
    return lump(lumps, PRIMARY[base], side)


def centroid(points):
    c = Vector((0.0, 0.0, 0.0))
    for p in points:
        c += p
    return c / len(points)


def half_centroid(l, side):
    """The middle of one side of a lump that straddles the centre line
    (x > 0 is the figure's left). A few of the realistic male's pelvis
    vertices sit a hair off the centre plane; counted on one side, they
    would pull that hip 3 mm in and 4 mm down from its mirror image."""
    sign = 1 if side == 'L' else -1
    return centroid([p for p in l.world if sign * p.x > CENTRE_BAND])


def tip(child, parent):
    """The child lump's end nearest the parent: its tenth of vertices that
    reach furthest toward the parent's centre, averaged."""
    axis = (parent.centre - child.centre)
    if axis.length < 1e-6:
        return child.centre.copy()
    axis.normalize()
    ranked = sorted(child.world, key=lambda p: -(p - child.centre).dot(axis))
    return centroid(ranked[: max(8, len(ranked) // 10)])


def joint(child, parent):
    """Where a lump hangs off the one above it. Lumps overlap at every
    joint in these figures, and a joint in a chain sits between the centre
    of that overlap and the parent lump's end. Where lumps barely touch,
    the child's tip stands in."""
    inside = [p for p in child.world if parent.contains(p)]
    if len(inside) < 8:
        return tip(child, parent)
    # The overlap's centre leans into the parent by half the overlap's
    # depth, and the parent's own tip leans past the joint by about as
    # much: the joint is between them.
    return (centroid(inside) + tip(parent, child)) / 2


def recentre(lumps):
    """Stand the figure at the origin: hips on the centre line, the lowest
    point on the ground. The bundle parks its figures in a row."""
    pelvis = next(l for l in lumps if l.token == 'pelvis')
    offset = Vector((pelvis.centre.x, pelvis.centre.y, min(p.z for l in lumps for p in l.world)))
    for l in lumps:
        l.world = [p - offset for p in l.world]
        l.matrix.translation -= offset
        l.inverse = l.matrix.inverted()
        l.centre -= offset
    return offset


def farthest(points, origin, direction):
    best = max(points, key=lambda p: (p - origin).dot(direction))
    return origin + direction * max(0.0, (best - origin).dot(direction))


# --- the rig, from the app's numbers ------------------------------------------

def load_rig(path, preset_id):
    with open(path, 'r', encoding='utf-8') as fh:
        data = json.load(fh)
    for p in data['presets']:
        if p['id'] == preset_id:
            return p
    raise SystemExit(f'no preset {preset_id!r} in {path}')


def to_blender(p):
    """App (x, y up, z forward) -> Blender (x, -z forward, y up)."""
    return Vector((p[0], -p[2], p[1]))


def hint_axis(name):
    return {'x': Vector((1.0, 0.0, 0.0)), 'y': Vector((0.0, 1.0, 0.0)), 'z': Vector((0.0, 0.0, 1.0))}[name]


def frame_x(head, tail, hint):
    """The app's bone frame - Y head to tail, X the hinted world axis
    squared up to Y - as its X, in Blender space."""
    y = (tail - head).normalized()
    h = to_blender(list(hint_axis(hint)))
    x = h - y * h.dot(y)
    if x.length < 1e-6:
        fb = to_blender([0.0, 0.0, 1.0])
        x = fb - y * fb.dot(y)
    return x.normalized()


def frame_z(head, tail, hint):
    """The Z that align_roll needs for the app's frame, in Blender space."""
    return frame_x(head, tail, hint).cross((tail - head).normalized()).normalized()


def rest_bend(heads, tails, bone, parent, hint):
    """How far a bone turns from its parent at rest, in degrees about its
    own X: the angle from the parent's direction to its own, which is what
    a pose rotation about X adds to. The app's signedBend (glbRig.ts)
    measures the same on the exported file: Blender space and the app's
    differ by a rotation, which changes neither the angle nor its sign."""
    u = (tails[parent] - heads[parent]).normalized()
    v = (tails[bone] - heads[bone]).normalized()
    k = frame_x(heads[bone], tails[bone], hint)
    return math.degrees(math.atan2(u.cross(v).dot(k), u.dot(v)))


def fold_of(x):
    """Which way the app folds a hinge with these X limits: toward the end
    of the range with the room in it (bendHinge in Armature.ts)."""
    return -1 if abs(x[0]) > abs(x[1]) else 1


def hinge_limits(rig, heads, tails):
    """Limits for the hinges, and the bend each one rests with.

    Left to the app, a hinge's fold direction is read off its rest bend,
    and a knee that rests all but straight is a coin toss: the stylized
    male's, a fraction of a degree past straight while its hips sat
    higher, was read as folding backwards (owner report). So the direction
    here is the anatomical one, HINGE_FOLD, and only the size of the range
    comes from the rest: with r the rest bend measured the way the joint
    folds (below zero for a joint that rests a little past straight), it
    folds HINGE_RANGE - r further and opens r + HINGE_OPEN, to HINGE_OPEN
    past straight. A shin gets [-r - 5, 150 - r], a forearm
    [-(150 - r), r + 5]. Both sides are written, as rig.json has them; the
    app takes the right's from the left."""
    limits, bends = {}, {}
    for bone in rig['bones']:
        if bone['kind'] != 'hinge':
            continue
        name = bone['name']
        fold = HINGE_FOLD.get(name.partition('.')[0])
        if fold is None:
            raise SystemExit(f'{name} is a hinge with no fold direction in HINGE_FOLD')
        if fold_of(bone['limits']['x']) != fold:
            raise SystemExit(f"{name} folds the other way in rig.json ({bone['limits']['x']}); HINGE_FOLD is out of step")
        bend = rest_bend(heads, tails, name, bone['parent'], bone['hint'])
        r = fold * bend
        lo, hi = sorted((fold * (HINGE_RANGE - r), -fold * (r + HINGE_OPEN)))
        # A rest further past straight than HINGE_OPEN is still a pose the
        # joint has to be able to hold.
        x = [round(min(lo, 0.0), 1), round(max(hi, 0.0), 1)]
        if fold_of(x) != fold:
            raise SystemExit(f'{name} rests {r:.1f} degrees folded: the app would read {x} as folding the other way')
        limits[name] = {'x': x, 'y': list(HINGE_TWIST), 'z': [0, 0]}
        bends[name] = bend
    return limits, bends


def place_bones(rig, lumps):
    """Head and tail for every bone, in Blender world space, from the lumps."""
    byname = {b['name']: b for b in rig['bones']}
    heads, tails = {}, {}
    P = lambda bone: primary(lumps, bone)

    # Joints down each chain: where the child lump meets its parent lump.
    heads['spine'] = joint(P('spine'), P('pelvis'))
    heads['chest'] = joint(P('chest'), P('spine'))
    # The neck turns part way up its lump (NECK_JOINT_AT); the head still
    # turns where it meets the neck, at the base of the skull.
    neck = P('neck').world
    low, high = min(p.z for p in neck), max(p.z for p in neck)
    middle = centroid(neck)
    heads['neck'] = Vector((middle.x, middle.y, low + NECK_JOINT_AT * (high - low)))
    heads['head'] = joint(P('head'), P('neck'))
    for s in ('L', 'R'):
        heads[f'clavicle.{s}'] = joint(P(f'clavicle.{s}'), P('chest'))
        # The shoulder turns about the middle of the deltoid, which moves
        # with the arm, the way a wooden mannequin's shoulder cap does.
        heads[f'upperarm.{s}'] = centroid(lump(lumps, 'shoulder', s).world)
        heads[f'forearm.{s}'] = joint(P(f'forearm.{s}'), P(f'upperarm.{s}'))
        heads[f'hand.{s}'] = joint(P(f'hand.{s}'), P(f'forearm.{s}'))
        # A hip sits in the middle of its half of the pelvis. The top of
        # the thigh lump, which placed it before, reaches up past the joint
        # and put the hips 2.5 to 4.5 cm too high (owner report, most
        # visible on the female figures).
        heads[f'thigh.{s}'] = half_centroid(lump(lumps, 'pelvis'), s)
        heads[f'shin.{s}'] = joint(P(f'shin.{s}'), P(f'thigh.{s}'))
        heads[f'foot.{s}'] = joint(P(f'foot.{s}'), P(f'shin.{s}'))
    # The root sits between the hips, on the centre line (x = 0 once the
    # figure is recentred), and so does the rest of the spine.
    hips = (heads['thigh.L'] + heads['thigh.R']) / 2
    heads['pelvis'] = Vector((0.0, hips.y, hips.z))
    for name in ('spine', 'chest', 'neck', 'head'):
        heads[name].x = 0.0

    # Tails: the next joint down the chain, or the end of the lump group.
    chain = {
        'pelvis': 'spine', 'spine': 'chest', 'chest': 'neck', 'neck': 'head',
    }
    for s in ('L', 'R'):
        chain[f'clavicle.{s}'] = f'upperarm.{s}'
        chain[f'upperarm.{s}'] = f'forearm.{s}'
        chain[f'forearm.{s}'] = f'hand.{s}'
        chain[f'thigh.{s}'] = f'shin.{s}'
        chain[f'shin.{s}'] = f'foot.{s}'
    for name, nxt in chain.items():
        tails[name] = heads[nxt].copy()
    # The root points straight up, as the app's own rig does, whatever the
    # spine above it leans: its frame is the figure's frame, and the app
    # carries that frame from figure to figure when the preset changes.
    tails['pelvis'] = heads['pelvis'] + Vector((0.0, 0.0, 0.1))
    group = lambda bone: [p for l in lumps if l.bone() == bone for p in l.world]
    up = Vector((0.0, 0.0, 1.0))
    forward = Vector((0.0, -1.0, 0.0))
    tails['head'] = farthest(group('head'), heads['head'], up)
    for s in ('L', 'R'):
        along = heads[f'hand.{s}'] - heads[f'forearm.{s}']
        along.normalize()
        tails[f'hand.{s}'] = farthest(group(f'hand.{s}'), heads[f'hand.{s}'], along)
        tails[f'foot.{s}'] = farthest(group(f'foot.{s}'), heads[f'foot.{s}'], forward)
    for name in byname:
        if name not in heads or name not in tails:
            raise SystemExit(f'no placement for bone {name}')
    return heads, tails


# --- building it in Blender -------------------------------------------------------

def build_figure(fig, rig, lumps):
    heads, tails = place_bones(rig, lumps)
    hinges, bends = hinge_limits(rig, heads, tails)
    if bpy.context.object is not None and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')

    arm_data = bpy.data.armatures.new(f"BZ_{fig['id']}")
    arm_obj = bpy.data.objects.new(f"BZ_{fig['id']}", arm_data)
    arm_obj['bz_generated'] = True
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.show_in_front = True
    bpy.ops.object.mode_set(mode='EDIT')
    for bone in rig['bones']:
        eb = arm_data.edit_bones.new(bone['name'])
        eb.head = heads[bone['name']]
        eb.tail = tails[bone['name']]
        eb.align_roll(frame_z(eb.head.copy(), eb.tail.copy(), bone['hint']))
    for bone in rig['bones']:
        if not bone['parent']:
            continue
        eb = arm_data.edit_bones[bone['name']]
        eb.parent = arm_data.edit_bones[bone['parent']]
        eb.use_connect = (eb.head - eb.parent.tail).length < 1e-6
    bpy.ops.object.mode_set(mode='OBJECT')
    for bone in rig['bones']:
        b = arm_data.bones[bone['name']]
        b['bz_kind'] = bone['kind']
        b['bz_hint'] = bone['hint']
        if bone.get('mirror'):
            b['bz_mirror'] = bone['mirror']
        limits = hinges.get(bone['name'], bone['limits'])
        b['bz_limit_x'] = list(limits['x'])
        b['bz_limit_y'] = list(limits['y'])
        b['bz_limit_z'] = list(limits['z'])
        pb = arm_obj.pose.bones[bone['name']]
        pb.rotation_mode = 'XYZ'
    height = max(p.z for l in lumps for p in l.world) - min(p.z for l in lumps for p in l.world)
    bz_rig = json.dumps(
        {'id': fig['id'], 'label': fig['label'], 'height': round(height, 3), 'ik': rig['ik']},
        separators=(',', ':'),
    )
    arm_obj['bz_rig'] = bz_rig

    # One mesh of every lump, each vertex in the group of its bone.
    verts, faces, groups = [], [], {}
    for l in lumps:
        bone = l.bone()
        if bone is None:
            print(f"  skipping {l.ob.name!r}: no bone for {l.token!r}")
            continue
        base = len(verts)
        verts.extend(l.world)
        faces.extend([tuple(base + i for i in poly) for poly in l.polys])
        groups.setdefault(bone, []).extend(range(base, base + len(l.world)))
    me = bpy.data.meshes.new(f"BZ_{fig['id']}_mesh")
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    ob = bpy.data.objects.new(f"BZ_{fig['id']}_mesh", me)
    ob['bz_generated'] = True
    ob['bz_rig'] = bz_rig  # on the skin too: the app reads it off the mesh
    bpy.context.scene.collection.objects.link(ob)
    for bone, idx in groups.items():
        vg = ob.vertex_groups.new(name=bone)
        vg.add(idx, 1.0, 'REPLACE')
    ob.parent = arm_obj
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm_obj
    return arm_obj, ob, heads, tails, height, hinges, bends


def export_glb(arm_obj, ob, path):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    arm_obj.select_set(True)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_extras=True,
        export_apply=True,
        export_skins=True,
        export_animations=False,
        export_morph=False,
        export_materials='NONE',
        export_texcoords=False,
        export_normals=True,
        export_yup=True,
    )


def main():
    opts = parse_args()
    blend = open_bundle(opts['bundle'])
    rig_path = find_rig_json(opts['rig'])
    out = output_dir(opts['out'], blend)
    if opts['export']:
        os.makedirs(out, exist_ok=True)
    if opts['replace']:
        gone = clear_previous()
        if gone:
            print(f'cleared {gone} object(s) from the previous run')
    dg = bpy.context.evaluated_depsgraph_get()
    built = []
    for fig in FIGURES:
        if opts['only'] and fig['id'] not in opts['only']:
            continue
        rig = load_rig(rig_path, fig['rig'])
        lumps = lumps_of(fig['src'], dg)
        print(f"{fig['id']}: lump volumes")
        check_outward(fig, lumps)
        arm_obj, ob, heads, tails, height, hinges, bends = build_figure(fig, rig, lumps)
        note = ''
        if opts['export']:
            path = os.path.join(out, f"{fig['id']}.glb")
            export_glb(arm_obj, ob, path)
            note = f", {os.path.getsize(path) / 1024:.0f} KB to {path}"
        built.append(arm_obj)
        print(f"{fig['id']}: {len(lumps)} lumps, {len(ob.data.vertices)} verts, {len(ob.data.polygons)} faces, "
              f"{height:.2f} m{note}")
        for name in ('pelvis', 'spine', 'chest', 'neck', 'head', 'clavicle.L', 'upperarm.L', 'forearm.L', 'hand.L', 'thigh.L', 'shin.L', 'foot.L'):
            h, t = heads[name], tails[name]
            print(f"    {name:12s} head=({h.x:6.3f},{h.y:6.3f},{h.z:6.3f}) tail=({t.x:6.3f},{t.y:6.3f},{t.z:6.3f}) len={(t - h).length:.3f}")
        for s in ('L', 'R'):
            hip, shoulder = heads[f'thigh.{s}'], heads[f'upperarm.{s}']
            print(f"    {s}: hip at z {hip.z:.3f} ({100 * hip.z / height:.1f}% of the height), shoulder at z {shoulder.z:.3f}; "
                  f"rest bend knee {bends[f'shin.{s}']:+.2f}, elbow {bends[f'forearm.{s}']:+.2f} degrees about X "
                  f"-> shin x {hinges[f'shin.{s}']['x']}, forearm x {hinges[f'forearm.{s}']['x']}")
    # Every figure is built and exported standing at the origin; in the
    # scene they are then spaced out along X to be looked at side by side.
    # Put an armature back at X = 0 before exporting it by hand.
    for k, arm_obj in enumerate(built):
        arm_obj.location.x = 1.5 * k


main()
