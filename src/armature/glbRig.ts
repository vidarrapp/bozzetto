import { Box3, Matrix4, Quaternion, Vector3, type Bone, type BufferGeometry, type Object3D, type SkinnedMesh } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BoneDef, IKChainDef, JointLimits, RigDefinition, Vec3 } from './rig';

/**
 * Read a rig out of a rigged .glb - the bones, what each joint is and how
 * far it turns, and the chains a hand or a foot reaches on - so a figure
 * modelled in Blender can be posed here.
 *
 * The file is the source of truth for a preset it describes; the
 * placeholder rigs in rig.ts only stand in until one arrives.
 *
 * Almost everything is DERIVED rather than demanded. A glTF carries the
 * bone tree, the rest transforms and the skin weights by construction, and
 * those alone are enough to pose a figure; the extras a Blender export can
 * add (`bz_limit_x`, `bz_kind`, `bz_rig`) are read where they exist and
 * inferred where they do not, so a model exported without them is stiff
 * and sensible rather than broken. What is inferred is reported, so the
 * app can say which parts of a file it had to guess at.
 *
 * One trap worth naming: three sanitises node names on the way in and on
 * the way out, because animation binding paths reserve some characters. A
 * bone called `clavicle.L` in Blender arrives here as `clavicleL`. Names
 * are put back into the app's own form before anything matches on them.
 */

export interface ReadRig {
  rig: RigDefinition;
  /** The skinned mesh the rig belongs to, with its geometry and weights. */
  mesh: SkinnedMesh;
  /** Bone names as they were in the file, by the name the app uses. */
  sourceNames: Record<string, string>;
  /** What the file did not say and had to be worked out. */
  inferred: string[];
}

/** A ball joint with nothing said about it turns this much. */
const BALL_LIMITS: JointLimits = { x: [-60, 60], y: [-45, 45], z: [-60, 60] };
/** A hinge with nothing said about it: the way it already bends, and back. */
const HINGE_RANGE = 150;

/**
 * `clavicleL` -> `clavicle.L`, `LeftForeArm` -> `forearm.L`, and anything
 * unrecognised through unchanged. Blender's `.L`/`.R` is the form the app
 * speaks; three strips the dot, and other riggers write the side in front.
 */
export function canonicalName(raw: string): string {
  const name = raw.trim();
  const known = /^(pelvis|hips?|root|spine\d*|chest|upperchest|neck|head|clavicle|shoulder|upperarm|forearm|lowerarm|hand|thigh|upperleg|shin|lowerleg|calf|foot|toe)/i;
  const side = (s: string): string => (s.toLowerCase().startsWith('l') ? 'L' : 'R');
  // Left/Right in front, as Mixamo and many riggers write it.
  const front = name.match(/^(?:mixamorig:?)?(left|right|l|r)[_.\s-]?([A-Za-z].*)$/i);
  if (front && known.test(front[2])) return `${lowerFirst(front[2])}.${side(front[1])}`;
  // A side on the end, with or without the separator three strips.
  const back = name.match(/^(.*?)[_.\s-]?(left|right|[LR])$/);
  if (back && back[1] && known.test(back[1])) return `${lowerFirst(back[1])}.${side(back[2])}`;
  return lowerFirst(name);
}

function lowerFirst(s: string): string {
  const t = s.replace(/^mixamorig:?/i, '');
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/** Which world axis a bone's own X sits closest to, as the app's `hint`. */
function hintFor(x: Vector3): 'x' | 'y' | 'z' {
  const ax = Math.abs(x.x);
  const ay = Math.abs(x.y);
  const az = Math.abs(x.z);
  return ay > ax && ay >= az ? 'y' : az > ax ? 'z' : 'x';
}

function readLimits(bone: Object3D): JointLimits | null {
  const d = bone.userData as Record<string, unknown>;
  const axis = (key: string): [number, number] | null => {
    const v = d[key];
    return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number')
      ? [v[0] as number, v[1] as number]
      : null;
  };
  const x = axis('bz_limit_x');
  const y = axis('bz_limit_y');
  const z = axis('bz_limit_z');
  return x && y && z ? { x, y, z } : null;
}

/**
 * Pull a rig out of a loaded glTF. Throws only when there is nothing to
 * work with - no skinned mesh, or a skin with no bones.
 */
export function rigFromGLTF(gltf: GLTF, id = 'imported', label = 'Imported figure'): ReadRig {
  const meshes: SkinnedMesh[] = [];
  gltf.scene.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) meshes.push(o as SkinnedMesh);
  });
  if (meshes.length === 0) throw new Error('That file has no skinned mesh: the model needs to be bound to a rig.');
  const mesh = meshes.reduce((a, b) =>
    b.geometry.getAttribute('position').count > a.geometry.getAttribute('position').count ? b : a,
  );
  const bones = mesh.skeleton.bones;
  if (bones.length === 0) throw new Error('That file has a skin with no bones in it.');

  const inferred: string[] = [];
  const sourceNames: Record<string, string> = {};
  const canon = new Map<Bone, string>();
  const used = new Set<string>();
  for (const bone of bones) {
    let name = canonicalName(bone.name);
    while (used.has(name)) name += '_';
    used.add(name);
    canon.set(bone, name);
    sourceNames[name] = bone.name;
  }

  // Rest transforms, as the file has them.
  gltf.scene.updateMatrixWorld(true);
  const world = new Map<Bone, Matrix4>();
  for (const bone of bones) world.set(bone, bone.matrixWorld.clone());
  const meshInverse = new Matrix4().copy(mesh.matrixWorld).invert();
  for (const m of world.values()) m.premultiply(meshInverse);

  const head = (bone: Bone): Vector3 => new Vector3().setFromMatrixPosition(world.get(bone)!);
  const axisOf = (bone: Bone, column: number): Vector3 =>
    new Vector3().setFromMatrixColumn(world.get(bone)!, column).normalize();

  const boneParent = (b: Bone): Bone | null => {
    let p: Object3D | null = b.parent;
    while (p) {
      if (bones.includes(p as Bone)) return p as Bone;
      p = p.parent;
    }
    return null;
  };
  const childrenOf = new Map<Bone, Bone[]>();
  for (const bone of bones) childrenOf.set(bone, []);
  for (const bone of bones) {
    const p = boneParent(bone);
    if (p) childrenOf.get(p)!.push(bone);
  }

  /**
   * A bone's far end. glTF stores joints, not bones with a length, so the
   * tail is where the next joint is - the child that carries on straightest
   * when there are several, and a step along the bone's own axis when there
   * are none.
   */
  const tailOf = (bone: Bone): Vector3 => {
    const kids = childrenOf.get(bone)!;
    const from = head(bone);
    const y = axisOf(bone, 1);
    if (kids.length === 1) return head(kids[0]);
    if (kids.length > 1) {
      let best = kids[0];
      let bestDot = -Infinity;
      for (const k of kids) {
        const d = head(k).sub(from).normalize().dot(y);
        if (d > bestDot) {
          bestDot = d;
          best = k;
        }
      }
      return head(best);
    }
    const parent = boneParent(bone);
    const len = parent ? head(bone).distanceTo(head(parent)) * 0.6 : 0.1;
    return from.clone().addScaledVector(y, Math.max(len, 1e-3));
  };

  // --- the rig's own facts, if the file carries them ------------------------
  interface Declared {
    id?: string;
    label?: string;
    height?: number;
    ik?: IKChainDef[];
  }
  let declared: Declared | null = null;
  const raw = (mesh.userData as Record<string, unknown>).bz_rig;
  if (typeof raw === 'string') {
    try {
      declared = JSON.parse(raw) as Declared;
    } catch {
      inferred.push('bz_rig was not readable JSON; the chains were worked out from the names');
    }
  }

  // --- the bones ------------------------------------------------------------
  const defs: BoneDef[] = [];
  const byName = new Map<string, Bone>();
  for (const bone of bones) byName.set(canon.get(bone)!, bone);
  let missingLimits = 0;
  for (const bone of bones) {
    const name = canon.get(bone)!;
    const parent = boneParent(bone);
    const h = head(bone);
    const t = tailOf(bone);
    const kind: BoneDef['kind'] = !parent ? 'root' : kindOf(bone);
    const limits = readLimits(bone) ?? inferLimits(bone, kind);
    if (!readLimits(bone) && kind !== 'root') missingLimits++;
    defs.push({
      name,
      parent: parent ? canon.get(parent)! : null,
      head: [h.x, h.y, h.z],
      tail: [t.x, t.y, t.z],
      hint: hintFor(axisOf(bone, 0)),
      limits,
      // The geometry comes from the file, so no block is described here.
      part: null,
      mirror: mirrorOf(name),
      kind,
    });
  }
  if (missingLimits) {
    inferred.push(`${missingLimits} joint${missingLimits === 1 ? '' : 's'} had no limits in the file; sensible ones were used`);
  }

  /** A hinge bends one way and rests bent; a limb's middle bone is one. */
  function kindOf(bone: Bone): BoneDef['kind'] {
    const d = (bone.userData as Record<string, unknown>).bz_kind;
    if (d === 'hinge' || d === 'ball' || d === 'root') return d;
    const name = canon.get(bone)!;
    if (/^(forearm|lowerarm|shin|lowerleg|calf)/i.test(name)) return 'hinge';
    return 'ball';
  }

  /**
   * A joint with nothing said about it. A hinge keeps the way it already
   * bends - which is why a rest pose with a little bend in it is worth
   * having - and a ball gets a range that will not embarrass anyone.
   */
  function inferLimits(bone: Bone, kind: BoneDef['kind']): JointLimits {
    if (kind === 'root') return { x: [0, 0], y: [0, 0], z: [0, 0] };
    if (kind !== 'hinge') return { ...BALL_LIMITS };
    const parent = boneParent(bone);
    if (!parent) return { ...BALL_LIMITS };
    const bend = signedBend(parent, bone);
    // Bent already: fold further that way, straighten by what it has.
    const rest = Math.abs(bend) < 0.5 ? 6 * Math.sign(bend || 1) : bend;
    const r = (v: number): number => Math.round(v * 10) / 10;
    return rest < 0
      ? { x: [r(-HINGE_RANGE - rest), r(-rest)], y: [-20, 20], z: [0, 0] }
      : { x: [r(-rest), r(HINGE_RANGE - rest)], y: [-20, 20], z: [0, 0] };
  }

  /** How far a bone turns from its parent, about its own X. */
  function signedBend(parent: Bone, bone: Bone): number {
    const u = axisOf(parent, 1);
    const v = axisOf(bone, 1);
    const k = axisOf(bone, 0);
    const cross = new Vector3().crossVectors(u, v);
    return (Math.atan2(cross.dot(k), u.dot(v)) * 180) / Math.PI;
  }

  function mirrorOf(name: string): string | null {
    const m = name.match(/^(.*)\.([LR])$/);
    if (!m) return null;
    const other = `${m[1]}.${m[2] === 'L' ? 'R' : 'L'}`;
    return byName.has(other) ? other : null;
  }

  // --- the chains -----------------------------------------------------------
  let ik: IKChainDef[] = [];
  if (declared?.ik?.length) {
    ik = declared.ik
      .map((c) => ({
        ...c,
        id: canonicalName(c.id),
        effector: canonicalName(c.effector),
        links: c.links.map(canonicalName),
        mirror: c.mirror ? canonicalName(c.mirror) : null,
      }))
      .filter((c) => byName.has(c.effector) && c.links.every((l) => byName.has(l)));
    if (ik.length !== declared.ik.length) {
      inferred.push('some chains in bz_rig named bones the skin does not have; those were dropped');
    }
  }
  if (ik.length === 0) {
    ik = inferChains();
    if (ik.length) inferred.push(`${ik.length} reach chains were worked out from the bone names`);
  }

  /** Hands, feet and the head reach; the two or three bones above them bend. */
  function inferChains(): IKChainDef[] {
    const out: IKChainDef[] = [];
    for (const [name, bone] of byName) {
      const isHand = /^hand(\.[LR])?$/.test(name);
      const isFoot = /^foot(\.[LR])?$/.test(name);
      const isHead = /^head$/.test(name);
      if (!isHand && !isFoot && !isHead) continue;
      const links: string[] = [];
      let up = boneParent(bone);
      const depth = isHead ? 2 : isFoot ? 2 : 3;
      while (up && links.length < depth) {
        links.push(canon.get(up)!);
        up = boneParent(up);
      }
      if (links.length < 2) continue;
      const side = name.endsWith('.L') ? 'Left' : name.endsWith('.R') ? 'Right' : '';
      const base = isHand ? 'hand' : isFoot ? 'foot' : 'Head';
      out.push({
        id: name,
        label: `${side} ${base}`.trim(),
        effector: name,
        links,
        mirror: mirrorOf(name),
        // A knee points the way it already bends; an elbow the other way.
        poleRef: poleFor(links),
      });
    }
    return out;
  }

  /** The direction a limb's hinge already points, as its aim's zero. */
  function poleFor(links: string[]): Vec3 | undefined {
    const hingeName = links.find((n) => defs.find((d) => d.name === n)?.kind === 'hinge');
    const hinge = hingeName ? byName.get(hingeName) : undefined;
    const base = hingeName ? byName.get(links[links.indexOf(hingeName) + 1] ?? '') : undefined;
    if (!hinge || !base) return undefined;
    const axis = head(hinge).sub(head(base));
    if (axis.lengthSq() < 1e-8) return undefined;
    // Where the joint sits off the line from the limb's base to its end.
    const end = tailOf(hinge);
    const line = end.clone().sub(head(base));
    if (line.lengthSq() < 1e-8) return undefined;
    line.normalize();
    const off = axis.clone().sub(line.clone().multiplyScalar(axis.dot(line)));
    if (off.lengthSq() < 1e-8) return undefined;
    off.normalize();
    return [round(off.x), round(off.y), round(off.z)];
  }

  const box = new Box3().setFromObject(mesh);
  const height = declared?.height ?? Math.max(0.1, box.max.y - box.min.y);
  return {
    rig: {
      id: declared?.id ?? id,
      label: declared?.label ?? label,
      height,
      bones: defs,
      ik,
    },
    mesh,
    sourceNames,
    inferred,
  };
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * The file's geometry, ready for the app's skeleton: scaled into scene
 * units and with every weight moved from a bone to that bone's PART bone,
 * which is where the app keeps a part's proportions. A part bone sits on
 * its bone with no transform of its own, so the bind pose is unchanged and
 * a vertex split between two bones stays split between their two parts.
 */
export function retargetGeometry(
  geometry: BufferGeometry,
  scale: number,
  boneIndexToPart: (index: number) => number,
): BufferGeometry {
  const out = geometry.clone();
  const pos = out.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) * scale, pos.getY(i) * scale, pos.getZ(i) * scale);
  }
  pos.needsUpdate = true;
  const skin = out.getAttribute('skinIndex');
  if (skin) {
    for (let i = 0; i < skin.count; i++) {
      skin.setXYZW(
        i,
        boneIndexToPart(skin.getX(i)),
        boneIndexToPart(skin.getY(i)),
        boneIndexToPart(skin.getZ(i)),
        boneIndexToPart(skin.getW(i)),
      );
    }
    skin.needsUpdate = true;
  }
  return out;
}

export { Quaternion };
