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
import struct
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


def evaluated_geometry(ob, dg):
    """World-space, Y-up positions and polygon index lists of an object as
    evaluated with its modifiers."""
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    try:
        mw = ev.matrix_world
        verts = []
        for v in me.vertices:
            p = mw @ v.co
            verts.append((p.x, p.z, -p.y))
        polys = [tuple(p.vertices) for p in me.polygons]
    finally:
        ev.to_mesh_clear()
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


def quads_of(polys):
    """Polygon index lists -> flat quad list (tri marker as None), fanning n-gons."""
    out = []
    for p in polys:
        if len(p) == 4:
            out.append(p)
        elif len(p) == 3:
            out.append((p[0], p[1], p[2], None))
        else:
            for k in range(1, len(p) - 1):
                out.append((p[0], p[k], p[k + 1], None))
    return out


def bbox(verts):
    xs = [v[0] for v in verts]; ys = [v[1] for v in verts]; zs = [v[2] for v in verts]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def write_bzm(path, parts):
    """parts: list of (name, verts, quads) in the shared asset frame."""
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
        else:
            parts = []
            # The main part first (the one that is not parented to another
            # part), then the rest in name order, so the app selects the body
            # rather than an eye after adding.
            ordered = sorted(objs, key=lambda o: (o.parent is not None, o.name))
            for ob in ordered:
                verts, polys = evaluated_geometry(ob, dg)
                parts.append((part_name(ob, entry['id']), verts, quads_of(polys)))
        path = os.path.join(out, f"{entry['id']}.bzm")
        size, stats, dims = write_bzm(path, parts)
        if entry.get('parts'):
            split = []
            for ob in hierarchy_order(objs):
                verts, polys = evaluated_geometry(ob, dg)
                split.append((readable_name(ob), verts, quads_of(polys)))
            psize, pstats, _ = write_bzm(os.path.join(out, f"{entry['id']}-parts.bzm"), split)
            print(f"{entry['id']}-parts: {len(split)} parts verts={sum(x[1] for x in pstats)} "
                  f"faces={sum(x[2] for x in pstats)} {psize / 1024:.0f} KB: "
                  + ', '.join(x[0] for x in pstats))
        idblock = bpy.data.objects.get(entry['src']) or bpy.data.collections.get(entry['src'])
        write_thumb(idblock, os.path.join(out, 'thumbs', f"{entry['id']}.png"))
        faces = sum(s[2] for s in stats)
        verts = sum(s[1] for s in stats)
        ad = idblock.asset_data
        print(f"{entry['id']}: {len(parts)} part(s) verts={verts} faces={faces} "
              f"dims=({dims[0]:.2f}, {dims[1]:.2f}, {dims[2]:.2f}) m {size / 1024:.0f} KB  "
              f"author={ad.author!r}")
        for s in stats:
            print(f'    {s[0]}: v={s[1]} f={s[2]} tris={s[3]}')
        manifest.append(dict(id=entry['id'], parts=len(parts), verts=verts, faces=faces, bytes=size, author=ad.author))
    print('MANIFEST', manifest)


main()
