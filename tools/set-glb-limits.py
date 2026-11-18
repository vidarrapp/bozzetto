#!/usr/bin/env python3
"""Write the app's joint limits into the shipped mannequins, without Blender.

The mannequins under public/assets/armature carry their joint limits on
their bones (bz_limit_x/y/z, written by tools/build-mannequins.py from
tools/rig.json). After a change of the limits in src/armature/rig.ts:

    npm run rig:json
    python3 tools/set-glb-limits.py            # rewrites the four files
    python3 tools/set-glb-limits.py --check    # exit 1 if a file is out of step

Ball joints take all three ranges from rig.json. A hinge (forearm, shin)
keeps the fold range the build worked out from that figure's own rest bend
(x) and takes only its twist (y) from rig.json. Nothing else in a file is
touched: the JSON chunk is rewritten and padded, the binary chunk is copied.
"""
import glob
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
GLB_MAGIC, JSON_CHUNK = 0x46546C67, 0x4E4F534A


def rig_limits():
    with open(os.path.join(HERE, 'rig.json'), encoding='utf-8') as f:
        rig = json.load(f)
    # Both presets carry the same limits; the first is the one the build reads.
    return {b['name']: b for b in rig['presets'][0]['bones']}


def patch(path, bones, write):
    with open(path, 'rb') as f:
        data = f.read()
    magic, version, _length = struct.unpack_from('<III', data, 0)
    size, kind = struct.unpack_from('<II', data, 12)
    if magic != GLB_MAGIC or version != 2 or kind != JSON_CHUNK:
        raise SystemExit(f'{path}: not a glTF 2 binary')
    doc = json.loads(data[20:20 + size].decode('utf-8'))
    rest = data[20 + size:]
    changed = []
    for node in doc.get('nodes', []):
        extras = node.get('extras')
        bone = bones.get(node.get('name'))
        if not extras or 'bz_limit_x' not in extras or not bone:
            continue
        want = dict(bone['limits'])
        if bone['kind'] == 'hinge':
            want['x'] = extras['bz_limit_x']
        if bone['kind'] == 'root':
            continue
        for axis in 'xyz':
            key = f'bz_limit_{axis}'
            if list(extras[key]) != list(want[axis]):
                extras[key] = list(want[axis])
                changed.append(f"{node['name']}.{axis}")
    if changed and write:
        text = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
        text += b' ' * (-len(text) % 4)
        out = struct.pack('<III', GLB_MAGIC, 2, 12 + 8 + len(text) + len(rest)) + struct.pack('<II', len(text), JSON_CHUNK) + text + rest
        with open(path, 'wb') as f:
            f.write(out)
    return changed


def main():
    check = '--check' in sys.argv[1:]
    bones = rig_limits()
    stale = False
    for path in sorted(glob.glob(os.path.join(ROOT, 'public', 'assets', 'armature', '*.glb'))):
        changed = patch(path, bones, not check)
        name = os.path.basename(path)
        if changed:
            stale = True
            print(f"{name}: {'out of step' if check else 'set'} ({len(changed)} ranges)")
        else:
            print(f'{name}: in step')
    if check and stale:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
