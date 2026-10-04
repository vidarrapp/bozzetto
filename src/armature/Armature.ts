import {
  Bone,
  Box3,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  type Intersection,
  type Material,
} from 'three';
import { rigById, type BoneDef, type IKChainDef, type JointLimits, type RigDefinition } from './rig';
import { canonicalName, retargetGeometry, type ReadRig } from './glbRig';

/** A figure whose geometry and weights come from a file, not from boxes. */
export interface ImportedFigure {
  geometry: BufferGeometry;
  /** The file's skeleton order, as the app's bone names. */
  boneOrder: string[];
}

/** Metres to scene units: the default sculpt sphere is about 48 across. */
export const SCENE_SCALE = 50;

export interface ArmatureState {
  v: 1;
  preset: string;
  root: { position: [number, number, number]; quaternion: [number, number, number, number] };
  /** Pose Euler per bone, degrees, XYZ on the bone's own frame; absent = rest. */
  pose: Record<string, [number, number, number]>;
  /** Per-part size (cross-section) and length; absent = 1. */
  proportions: Record<string, { size: number; length: number }>;
  /** IK handles held in place, and where: world position per chain id. */
  pins?: Record<string, [number, number, number]>;
  /** Where each chain's hinge aims, degrees around the limb; absent = 0. */
  aims?: Record<string, number>;
  /** Feet on the ground stand flat (the Reach section's box); absent = on. */
  plant?: boolean;
}

export interface Proportions {
  size: number;
  length: number;
}

const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _e = new Euler();
const RAD = Math.PI / 180;

/** The bones that stand on the ground: the name every rig here gives a foot. */
const FOOT = /^foot(\.[LR])?$/;
/**
 * How near its rest height an ankle must be for the foot to count as on
 * the ground, in metres: a centimetre and a half, so a foot put down by
 * hand lands, and one lifted by any visible amount is off.
 */
const GROUND_BAND = 0.015;
/**
 * How near its target a reach must bring its handle to be done, in scene
 * units: a fifth of a millimetre on the figure.
 */
const REACHED = 0.01;

/**
 * A posable figure: the rig's bones as a three.js Bone tree, every block
 * part in one SkinnedMesh, and the pose and proportions on top.
 *
 * Two things about the build are deliberate. Each bone gets a leaf child,
 * its PART bone, and the part's vertices are skinned to that leaf rather
 * than to the bone itself: proportions are a scale on the part bone, and
 * a leaf's scale reaches no child, so a thicker thigh does not thicken the
 * shin and no rotated child ever shears. Length instead moves the child
 * joint out along the bone, which is the one thing about a longer part
 * the rest of the body should notice.
 *
 * The other is that the pose is kept apart from the rest: a bone's
 * quaternion is rest * pose, and limits and mirroring work on the pose.
 * Mirroring reflects through the pelvis's own frame, so a turned figure
 * still mirrors across its own middle.
 */
export class Armature {
  readonly rig: RigDefinition;
  readonly mesh: SkinnedMesh;
  readonly skeleton: Skeleton;
  readonly root: Bone;
  readonly bones = new Map<string, Bone>();
  readonly partBones = new Map<string, Bone>();
  /** Each part's box in its bone's frame, for highlights and pickers. */
  readonly partGeometry = new Map<string, BufferGeometry>();
  /**
   * Mirror pose edits onto the other side (the Armature panel's box). Off
   * to begin with (owner call): a figure is posed a limb at a time far more
   * often than both at once.
   */
  symmetry = false;
  /**
   * Stand a foot flat whenever its sole is at the ground (the Reach
   * section's box): after a reach, a pin re-solve, a pose reset.
   */
  plantFeet = true;

  private readonly defs = new Map<string, BoneDef>();
  private readonly rest = new Map<string, { local: Quaternion; offset: Vector3; length: number }>();
  /** Each bone's rest frame in the world: its orientation and its head. */
  private readonly restWorld = new Map<string, { q: Quaternion; head: Vector3 }>();
  /** How far along its bone each chain's effector point sits, 0 head to 1 tail. */
  private readonly effectorAt = new Map<string, number>();
  /** The rig's feet, the bones planting stands on the ground. */
  private readonly feet: string[] = [];
  private readonly pose = new Map<string, Quaternion>();
  private readonly props = new Map<string, Proportions>();
  private readonly limits = new Map<string, JointLimits>();
  /** Skeleton index of a part bone -> the bone it belongs to. */
  private readonly partOwner = new Map<number, string>();

  /** Metres to scene units for this figure (the app's, or 1 for an export). */
  readonly scale: number;

  constructor(rig: RigDefinition, material: Material, scale = SCENE_SCALE, imported?: ImportedFigure) {
    this.scale = scale;
    this.rig = rig;
    const worldQ = new Map<string, Quaternion>();
    const worldP = new Map<string, Vector3>();

    // 1. Bones with their rest frames. Local Y runs head to tail; local X
    // follows the hinted world axis on BOTH sides, so the left and right
    // frames are mirror images in Y and Z with X shared - the one layout
    // in which a single limit table can serve both sides (see limitsFor).
    for (const def of rig.bones) {
      this.defs.set(def.name, def);
      const head = new Vector3().fromArray(def.head).multiplyScalar(scale);
      const tail = new Vector3().fromArray(def.tail).multiplyScalar(scale);
      const y = tail.clone().sub(head);
      const length = y.length();
      y.normalize();
      const hint = def.hint === 'x' ? new Vector3(1, 0, 0) : def.hint === 'y' ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
      const x = hint.clone().sub(y.clone().multiplyScalar(hint.dot(y)));
      if (x.lengthSq() < 1e-8) x.set(0, 0, 1).sub(y.clone().multiplyScalar(y.z));
      x.normalize();
      const z = new Vector3().crossVectors(x, y).normalize();
      const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
      worldQ.set(def.name, q);
      worldP.set(def.name, head);
      this.restWorld.set(def.name, { q: q.clone(), head: head.clone() });
      if (FOOT.test(def.name)) this.feet.push(def.name);
      const bone = new Bone();
      bone.name = def.name;
      this.bones.set(def.name, bone);
      const local = def.parent ? worldQ.get(def.parent)!.clone().invert().multiply(q) : q.clone();
      const offset = def.parent
        ? head.clone().sub(worldP.get(def.parent)!).applyQuaternion(worldQ.get(def.parent)!.clone().invert())
        : head.clone();
      this.rest.set(def.name, { local, offset, length });
      bone.position.copy(offset);
      bone.quaternion.copy(local);
      this.pose.set(def.name, new Quaternion());
      this.props.set(def.name, { size: 1, length: 1 });
      const part = new Bone();
      part.name = `${def.name}:part`;
      bone.add(part);
      this.partBones.set(def.name, part);
      if (def.parent) this.bones.get(def.parent)!.add(bone);
    }
    const rootDef = rig.bones.find((b) => !b.parent)!;
    this.root = this.bones.get(rootDef.name)!;
    for (const def of rig.bones) this.limits.set(def.name, this.limitsFor(def, worldQ));
    for (const c of rig.ik) {
      const at = c.effectorAt;
      if (typeof at === 'number' && Number.isFinite(at)) this.effectorAt.set(c.effector, Math.min(1, Math.max(0, at)));
    }
    this.restAims();

    // 2. The parts, one box each, in bind space (the rest pose), skinned to
    // their part bone. Built after the tree so rest world matrices exist.
    const skeletonBones: Bone[] = [];
    for (const def of rig.bones) skeletonBones.push(this.bones.get(def.name)!);
    for (const def of rig.bones) {
      this.partOwner.set(skeletonBones.length, def.name);
      skeletonBones.push(this.partBones.get(def.name)!);
    }
    this.root.updateMatrixWorld(true);

    // A figure read from a file brings its own geometry and its own
    // weights. Every weight moves from a bone to that bone's PART bone,
    // which is where proportions live; a part bone sits on its bone with
    // no transform of its own, so the bind pose is unchanged and a vertex
    // split between two bones stays split between their two parts.
    if (imported) {
      const partIndex = new Map<string, number>();
      for (const def of rig.bones) {
        partIndex.set(def.name, skeletonBones.indexOf(this.partBones.get(def.name)!));
      }
      const geometry = retargetGeometry(imported.geometry, scale, (i) => {
        const name = imported.boneOrder[i];
        return (name !== undefined ? partIndex.get(name) : undefined) ?? 0;
      });
      this.mesh = new SkinnedMesh(geometry, material);
      this.mesh.name = 'armature';
      this.mesh.frustumCulled = false;
      this.mesh.userData.locked = 0;
      this.mesh.add(this.root);
      this.skeleton = new Skeleton(skeletonBones);
      this.mesh.bind(this.skeleton);
      this.measureImportedParts();
      return;
    }

    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const skinIndex: number[] = [];
    const skinWeight: number[] = [];
    for (const def of rig.bones) {
      if (!def.part) continue;
      const restLen = this.rest.get(def.name)!.length;
      const len = (def.part.length ?? restLen / scale) * scale;
      const box = new BoxGeometry(def.part.width * scale, len, def.part.depth * scale);
      // Parts with their own length sit centred on the bone; the others
      // run from the joint to the tail so length scaling starts there.
      box.translate(0, def.part.length ? restLen / 2 : len / 2, 0);
      this.partGeometry.set(def.name, box);
      const world = this.partBones.get(def.name)!.matrixWorld;
      const partIndex = skeletonBones.indexOf(this.partBones.get(def.name)!);
      const base = positions.length / 3;
      const pos = box.getAttribute('position');
      const nrm = box.getAttribute('normal');
      const nm = new Matrix4().copy(world);
      for (let i = 0; i < pos.count; i++) {
        _v.fromBufferAttribute(pos, i).applyMatrix4(world);
        positions.push(_v.x, _v.y, _v.z);
        _v.fromBufferAttribute(nrm, i).transformDirection(nm);
        normals.push(_v.x, _v.y, _v.z);
        skinIndex.push(partIndex, 0, 0, 0);
        skinWeight.push(1, 0, 0, 0);
      }
      const idx = box.getIndex()!;
      for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i));
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
    // The sculpt materials can read these; give them something sane.
    geometry.setAttribute('color', new Float32BufferAttribute(new Array(positions.length).fill(1), 3));
    const pbr = new Float32Array(positions.length);
    for (let i = 0; i < pbr.length; i += 3) {
      pbr[i] = 0.3;
      pbr[i + 1] = 0;
      pbr[i + 2] = 1;
    }
    geometry.setAttribute('materialsPBR', new BufferAttribute(pbr, 3));
    geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndex, 4));
    geometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeight, 4));
    geometry.setIndex(indices);

    this.mesh = new SkinnedMesh(geometry, material);
    this.mesh.name = 'armature';
    this.mesh.frustumCulled = false;
    this.mesh.userData.locked = 0;
    this.mesh.add(this.root);
    this.skeleton = new Skeleton(skeletonBones);
    this.mesh.bind(this.skeleton); // bind matrix = the identity, inverses from the rest pose
  }

  /**
   * A figure from a file has no boxes to highlight, so each part's shape
   * is measured instead: the vertices that belong mostly to a bone, in
   * that bone's own frame. A part with nothing weighted to it gets
   * nothing, and simply does not light up.
   */
  private measureImportedParts(): void {
    const pos = this.mesh.geometry.getAttribute('position');
    const skin = this.mesh.geometry.getAttribute('skinIndex');
    const weight = this.mesh.geometry.getAttribute('skinWeight');
    if (!pos || !skin || !weight) return;
    const partOf = new Map<number, string>();
    for (const [index, name] of this.partOwner) partOf.set(index, name);
    const boxes = new Map<string, Box3>();
    const v = new Vector3();
    const local = new Matrix4();
    const inverse = new Map<string, Matrix4>();
    this.root.updateMatrixWorld(true);
    for (const [name, bone] of this.bones) inverse.set(name, bone.matrixWorld.clone().invert());
    for (let i = 0; i < pos.count; i++) {
      let best = -1;
      let bestW = 0;
      for (const axis of ['x', 'y', 'z', 'w'] as const) {
        const w = weight[`get${axis.toUpperCase() as 'X' | 'Y' | 'Z' | 'W'}`](i);
        if (w > bestW) {
          bestW = w;
          best = skin[`get${axis.toUpperCase() as 'X' | 'Y' | 'Z' | 'W'}`](i);
        }
      }
      const name = best >= 0 ? partOf.get(best) : undefined;
      if (!name) continue;
      local.copy(inverse.get(name)!);
      v.fromBufferAttribute(pos, i).applyMatrix4(local);
      const box = boxes.get(name) ?? new Box3().makeEmpty();
      box.expandByPoint(v);
      boxes.set(name, box);
    }
    for (const [name, box] of boxes) {
      if (box.isEmpty()) continue;
      const size = box.getSize(new Vector3());
      const centre = box.getCenter(new Vector3());
      const g = new BoxGeometry(Math.max(size.x, 1e-3), Math.max(size.y, 1e-3), Math.max(size.z, 1e-3));
      g.translate(centre.x, centre.y, centre.z);
      this.partGeometry.set(name, g);
    }
  }

  /**
   * The limits for a bone. The right side's ranges come from the left's
   * by reflection: an axis the mirror maps onto itself turns the other
   * way, so its range flips; an axis the mirror negates keeps its sign.
   */
  private limitsFor(def: BoneDef, worldQ: Map<string, Quaternion>): JointLimits {
    if (!def.mirror || !def.name.endsWith('.R')) return def.limits;
    const left = this.defs.get(def.mirror);
    if (!left) return def.limits;
    const qL = worldQ.get(left.name)!;
    const qR = worldQ.get(def.name)!;
    const flip = (axis: Vector3): boolean => {
      const aL = axis.clone().applyQuaternion(qL);
      aL.x = -aL.x; // reflected across the sagittal plane
      const aR = axis.clone().applyQuaternion(qR);
      return aL.dot(aR) > 0; // maps onto itself: the angle turns the other way
    };
    const range = (r: [number, number], f: boolean): [number, number] => (f ? [-r[1], -r[0]] : r);
    return {
      x: range(left.limits.x, flip(new Vector3(1, 0, 0))),
      y: range(left.limits.y, flip(new Vector3(0, 1, 0))),
      z: range(left.limits.z, flip(new Vector3(0, 0, 1))),
    };
  }

  def(name: string): BoneDef | undefined {
    return this.defs.get(name);
  }

  limitsOf(name: string): JointLimits {
    return this.limits.get(name) ?? { x: [0, 0], y: [0, 0], z: [0, 0] };
  }

  /** Bone names in rig order. */
  boneNames(): string[] {
    return this.rig.bones.map((b) => b.name);
  }

  // --- pose -----------------------------------------------------------------

  /** The pose rotation (on top of the rest) as XYZ Euler degrees. */
  getPoseEuler(name: string): [number, number, number] {
    const q = this.pose.get(name);
    if (!q) return [0, 0, 0];
    _e.setFromQuaternion(q, 'XYZ');
    return [_e.x / RAD, _e.y / RAD, _e.z / RAD];
  }

  /**
   * Set a bone's pose from Euler degrees, clamped to its limits, and
   * mirror it onto the other side when symmetry is on. Returns the angles
   * that were actually applied.
   */
  setPoseEuler(name: string, x: number, y: number, z: number, mirror = this.symmetry): [number, number, number] {
    const l = this.limitsOf(name);
    const cx = clamp(x, l.x);
    const cy = clamp(y, l.y);
    const cz = clamp(z, l.z);
    const q = this.pose.get(name);
    const bone = this.bones.get(name);
    const rest = this.rest.get(name);
    if (!q || !bone || !rest) return [0, 0, 0];
    q.setFromEuler(_e.set(cx * RAD, cy * RAD, cz * RAD, 'XYZ'));
    bone.quaternion.copy(rest.local).multiply(q);
    if (mirror) this.mirrorPoseFrom(name);
    return [cx, cy, cz];
  }

  /**
   * After a gizmo drag wrote straight into the bone's quaternion: take the
   * pose back out, clamp it, and put it back (plus the mirror). Returns
   * true when the limits bit.
   */
  clampPose(name: string, mirror = this.symmetry): boolean {
    const bone = this.bones.get(name);
    const rest = this.rest.get(name);
    if (!bone || !rest) return false;
    _q.copy(rest.local).invert().multiply(bone.quaternion);
    _e.setFromQuaternion(_q, 'XYZ');
    const want: [number, number, number] = [_e.x / RAD, _e.y / RAD, _e.z / RAD];
    const got = this.setPoseEuler(name, want[0], want[1], want[2], mirror);
    return got.some((v, i) => Math.abs(v - want[i]) > 1e-6);
  }

  /** Copy a bone's pose, reflected, onto its mirror bone. */
  mirrorPoseFrom(name: string): void {
    const def = this.defs.get(name);
    if (!def?.mirror) return;
    const from = this.bones.get(name)!;
    const to = this.bones.get(def.mirror)!;
    const restTo = this.rest.get(def.mirror)!;
    // World orientations relative to the pelvis, reflected across its YZ.
    this.root.updateMatrixWorld(true);
    const rootQ = new Quaternion();
    this.root.getWorldQuaternion(rootQ);
    const rootInv = rootQ.clone().invert();
    from.getWorldQuaternion(_q);
    _q.premultiply(rootInv); // in the pelvis frame
    _q.set(_q.x, -_q.y, -_q.z, _q.w); // the reflection of a rotation across YZ
    _q.premultiply(rootQ); // back to the world
    // pose = restLocal^-1 * parentWorld^-1 * mirroredWorld
    const parent = to.parent as Bone | null;
    if (parent) {
      parent.getWorldQuaternion(_q2);
      _q.premultiply(_q2.invert());
    }
    _q.premultiply(_q2.copy(restTo.local).invert());
    _e.setFromQuaternion(_q, 'XYZ');
    this.setPoseEuler(def.mirror, _e.x / RAD, _e.y / RAD, _e.z / RAD, false);
  }

  /**
   * Every joint back to the rest pose (the root stays where it is). The
   * feet on the ground stand flat, and every pin moves to where its handle
   * now is: a pin left behind would pull the figure straight back into the
   * pose it came from on the next move of the pelvis.
   */
  resetPose(): void {
    this.clearPose();
    this.restAims();
    if (this.plantFeet) this.plantGrounded();
    for (const id of [...this.pins.keys()]) this.setPinned(id, true);
  }

  /** Every joint's pose back to rest, and nothing else. */
  private clearPose(): void {
    for (const name of this.pose.keys()) this.setPoseEuler(name, 0, 0, 0, false);
  }

  /**
   * The left side's pose onto the right, or the other way round, and the
   * copied limbs' aims with it, read from where their knees and elbows now
   * point: left at their old values, the next solve would turn the copied
   * limbs back.
   */
  mirrorPose(from: 'L' | 'R'): void {
    for (const def of this.rig.bones) {
      if (def.mirror && def.name.endsWith(`.${from}`)) this.mirrorPoseFrom(def.name);
    }
    const to = from === 'L' ? '.R' : '.L';
    for (const c of this.rig.ik) if (c.effector.endsWith(to)) this.readAim(c);
  }

  // --- proportions ------------------------------------------------------------

  getProportions(name: string): Proportions {
    return { ...(this.props.get(name) ?? { size: 1, length: 1 }) };
  }

  /**
   * Where the figure stands, as the root's offset from its own rest: the
   * one thing that carries over when the figure changes. Copying the root's
   * raw transform instead would hand a mannequin the blocks' pelvis frame,
   * and the two figures' pelvis bones need not rest the same way.
   */
  placement(): { position: Vector3; quaternion: Quaternion } {
    const rest = this.rest.get(this.root.name)!;
    return {
      quaternion: this.root.quaternion.clone().multiply(rest.local.clone().invert()),
      position: this.root.position.clone().sub(rest.offset),
    };
  }

  setPlacement(p: { position: Vector3; quaternion: Quaternion }): void {
    const rest = this.rest.get(this.root.name)!;
    this.root.quaternion.copy(p.quaternion).multiply(rest.local);
    this.root.position.copy(rest.offset).add(p.position);
  }

  /**
   * Size scales the part's cross-section, length the part along its bone
   * and moves the child joints out with it. Mirrored to the other side
   * when symmetry is on.
   */
  setProportions(name: string, p: Partial<Proportions>, mirror = this.symmetry): void {
    const cur = this.props.get(name);
    const def = this.defs.get(name);
    if (!cur || !def) return;
    const { size, length } = PROPORTION_LIMITS;
    if (typeof p.size === 'number') cur.size = Math.min(size.max, Math.max(size.min, p.size));
    if (typeof p.length === 'number') cur.length = Math.min(length.max, Math.max(length.min, p.length));
    this.partBones.get(name)!.scale.set(cur.size, cur.length, cur.size);
    for (const child of this.rig.bones) {
      if (child.parent !== name) continue;
      const rest = this.rest.get(child.name)!;
      this.bones.get(child.name)!.position.set(rest.offset.x, rest.offset.y * cur.length, rest.offset.z);
    }
    if (mirror && def.mirror) this.setProportions(def.mirror, { ...cur }, false);
  }

  // --- inverse kinematics ------------------------------------------------------------

  /**
   * Handles held in place: chain id -> world position. A pinned hand or
   * foot stays where it is while the pelvis moves, which is what makes a
   * figure lean, crouch or reach without its feet sliding.
   */
  private readonly pins = new Map<string, Vector3>();

  /** Where each chain's knee or elbow points, degrees around the limb. */
  private readonly aims = new Map<string, number>();

  chains(): IKChainDef[] {
    return this.rig.ik;
  }

  /** Which chain a bone bends for, if any (its hinge, or a link of it). */
  chainOfHinge(bone: string): IKChainDef | undefined {
    return this.rig.ik.find(
      (c) => c.poleRef && c.links.some((n) => n === bone && this.defs.get(n)?.kind === 'hinge'),
    );
  }

  getAim(id: string): number {
    return this.aims.get(id) ?? 0;
  }

  /**
   * Take the aim of every chain a joint belongs to from where its knee or
   * elbow now points: for a joint turned by hand (and its mirror, when
   * symmetry turned that too), so the next solve keeps the limb where the
   * hand put it. Left alone, the aim swung it straight back on the first
   * move of the pelvis - a snap.
   */
  followAims(bone: string, mirror = this.symmetry): void {
    const other = mirror ? this.defs.get(bone)?.mirror : null;
    for (const c of this.rig.ik) {
      if (c.links.includes(bone) || (other && c.links.includes(other))) this.readAim(c);
    }
  }

  /** A chain's aim, from where its knee or elbow points now; a straight limb keeps the one it had. */
  private readAim(c: IKChainDef): void {
    const knee = this.hingeWorld(c.id, new Vector3());
    const a = knee ? this.aimFromPoint(c.id, knee) : null;
    if (a !== null) this.aims.set(c.id, wrap180(a));
  }

  /**
   * Every aim back to where its hinge points at rest. A rig's knees rest
   * turned in or out of straight forward and its elbows off straight back -
   * by twelve to thirty-seven degrees on the figures here - and an aim of
   * zero swung a fresh or reset limb round by that much on its first solve.
   */
  private restAims(): void {
    this.aims.clear();
    for (const c of this.rig.ik) {
      const hingeIndex = c.links.findIndex((n) => this.defs.get(n)?.kind === 'hinge');
      const base = hingeIndex >= 0 ? this.restWorld.get(c.links[hingeIndex + 1] ?? '') : undefined;
      const hinge = hingeIndex >= 0 ? this.restWorld.get(c.links[hingeIndex]) : undefined;
      const end = this.restWorld.get(c.effector);
      if (!c.poleRef || !base || !hinge || !end) continue;
      const a = this.aroundLimb(c, base.head, end.head, hinge.head, new Quaternion());
      if (a) this.aims.set(c.id, wrap180(a));
    }
  }

  /**
   * Aim a chain's hinge: the knee or elbow swings around the line from the
   * shoulder (or hip) to the hand (or foot), which leaves the hand where it
   * is and turns the limb's bend plane. Mirrored to the other side with
   * its sign flipped, since the reference direction is shared.
   */
  setAim(id: string, degrees: number, mirror = this.symmetry): void {
    const c = this.chain(id);
    if (!c?.poleRef) return;
    this.aims.set(id, wrap180(degrees));
    if (mirror && c.mirror) this.aims.set(c.mirror, wrap180(-degrees));
  }

  chain(id: string): IKChainDef | undefined {
    return this.rig.ik.find((c) => c.id === id);
  }

  isPinned(id: string): boolean {
    return this.pins.has(id);
  }

  /** Pin a handle where it stands now, or let it go. */
  setPinned(id: string, on: boolean): void {
    if (!on) {
      this.pins.delete(id);
      return;
    }
    const c = this.chain(id);
    if (!c) return;
    this.pins.set(id, this.effectorWorld(c.effector, new Vector3()));
  }

  /**
   * Pin both feet where they stand, which is how a new figure starts
   * (owner call): the pelvis can move from the first drag without taking
   * the feet off the ground.
   */
  pinFeet(): void {
    for (const c of this.rig.ik) if (FOOT.test(c.effector)) this.setPinned(c.id, true);
  }

  /** Whether a bone is one of the feet planting stands on the ground. */
  isFoot(bone: string): boolean {
    return this.feet.includes(bone);
  }

  /**
   * Aim a chain's hinge AND keep the limb's end where it is: the aim turns
   * the bend plane, the re-solve puts the hand or foot back on the mark it
   * held before the turn (its pin, if it has one). Without the second step
   * a joint limit met during the turn would drag the end along with it.
   */
  aimChain(id: string, degrees: number, mirror = this.symmetry): void {
    const c = this.chain(id);
    if (!c?.poleRef) return;
    const holds: Array<{ id: string; at: Vector3 }> = [];
    const hold = (chainId: string): void => {
      const ch = this.chain(chainId);
      if (!ch) return;
      holds.push({ id: chainId, at: this.pins.get(chainId)?.clone() ?? this.effectorWorld(ch.effector, new Vector3()) });
    };
    hold(id);
    if (mirror && c.mirror) hold(c.mirror);
    this.setAim(id, degrees, mirror);
    for (const h of holds) this.reach(h.id, h.at, 10, false);
  }

  /** Where a chain's hinge joint sits in the world (its aim handle's place). */
  hingeWorld(chainId: string, out: Vector3): Vector3 | null {
    const c = this.chain(chainId);
    const hinge = c?.links.find((n) => this.defs.get(n)?.kind === 'hinge');
    const bone = hinge ? this.bones.get(hinge) : undefined;
    if (!c?.poleRef || !bone) return null;
    this.mesh.updateMatrixWorld(true);
    return out.setFromMatrixPosition(bone.matrixWorld);
  }

  /**
   * The aim angle a world point asks for: where that point sits around the
   * limb's own line, from its base joint to the joint at its end (the hip
   * to the ankle, the shoulder to the wrist). This is what a drag on the
   * knee or elbow handle means, and how the solver reads a hinge.
   */
  aimFromPoint(chainId: string, point: Vector3): number | null {
    const c = this.chain(chainId);
    const hingeIndex = c ? c.links.findIndex((n) => this.defs.get(n)?.kind === 'hinge') : -1;
    const base = c && hingeIndex >= 0 ? this.bones.get(c.links[hingeIndex + 1]) : undefined;
    const end = c ? this.bones.get(c.effector) : undefined;
    if (!c?.poleRef || !base || !end) return null;
    this.root.updateMatrixWorld(true);
    const from = new Vector3().setFromMatrixPosition(base.matrixWorld);
    const to = new Vector3().setFromMatrixPosition(end.matrixWorld);
    return this.aroundLimb(c, from, to, point);
  }

  /**
   * A point's angle around the line from `from` to `to`, in degrees from the
   * rig's reference direction squared up to that line; null where the line
   * is too short or the point sits on it.
   *
   * The reference turns with the bone the limb hangs from, the pelvis for
   * a leg and the chest for an arm: "forward" is the figure's forward. Read
   * as a fixed world direction, a figure turned by its pelvis had every
   * knee swung back to face the old way on the next solve.
   */
  private aroundLimb(
    c: IKChainDef,
    from: Vector3,
    to: Vector3,
    point: Vector3,
    frame = this.limbFrame(c, new Quaternion()),
  ): number | null {
    if (!c.poleRef) return null;
    const axis = new Vector3().subVectors(to, from);
    if (axis.lengthSq() < 1e-8) return null;
    axis.normalize();
    // Zero aim is the rig's reference direction, squared up to the limb.
    const ref = new Vector3().fromArray(c.poleRef).applyQuaternion(frame);
    const zero = ref.clone().sub(axis.clone().multiplyScalar(ref.dot(axis)));
    if (zero.lengthSq() < 1e-6) {
      const up = new Vector3(0, 1, 0).applyQuaternion(frame);
      zero.copy(up).sub(axis.clone().multiplyScalar(up.dot(axis)));
    }
    if (zero.lengthSq() < 1e-6) return null;
    zero.normalize();
    const want = new Vector3().subVectors(point, from);
    want.sub(axis.clone().multiplyScalar(want.dot(axis)));
    if (want.lengthSq() < 1e-6) return null;
    want.normalize();
    const side = new Vector3().crossVectors(zero, want).dot(axis);
    return (Math.atan2(side, zero.dot(want)) * 180) / Math.PI;
  }

  /**
   * How far the bone a chain hangs from - the parent of its last link - has
   * turned from its rest, in the world. The chain's own links are no use
   * for this: the solve turns them.
   */
  private limbFrame(c: IKChainDef, out: Quaternion): Quaternion {
    const top = this.bones.get(c.links[c.links.length - 1]);
    const anchor = top?.parent;
    const rest = anchor ? this.restWorld.get(anchor.name) : undefined;
    if (!anchor || !rest || this.bones.get(anchor.name) !== anchor) return out.identity();
    return anchor.getWorldQuaternion(out).multiply(_q2.copy(rest.q).invert());
  }

  /**
   * Where a chain's handle sits on its effector bone, in the world: the
   * point `effectorAt` of the way from the bone's head to its tail, which
   * is the tail unless the chain says otherwise (a foot says its middle).
   * `at` asks for another point along the bone.
   */
  effectorWorld(bone: string, out: Vector3, at = this.effectorAt.get(bone) ?? 1): Vector3 {
    const b = this.bones.get(bone);
    const rest = this.rest.get(bone);
    if (!b || !rest) return out.set(0, 0, 0);
    this.mesh.updateMatrixWorld(true);
    const p = this.props.get(bone) ?? { size: 1, length: 1 };
    return out.set(0, rest.length * p.length * at, 0).applyMatrix4(b.matrixWorld);
  }

  /** Where a bone's joint, its head, is in the world. */
  jointWorld(bone: string, out = new Vector3()): Vector3 | null {
    const b = this.bones.get(bone);
    if (!b) return null;
    this.mesh.updateMatrixWorld(true);
    return out.setFromMatrixPosition(b.matrixWorld);
  }

  /**
   * Where the root's ball sits in the world: halfway along the pelvis bone,
   * which is the middle of the blocks' pelvis and inside the mannequins'
   * hips. The root's own joint is at the bottom of the blocks' pelvis, and
   * under the centre of its gizmo.
   */
  rootHandleWorld(out: Vector3): Vector3 {
    return this.effectorWorld(this.root.name, out, 0.5);
  }

  /**
   * Reach a handle towards a world point. A foot that would stand on the
   * ground there is planted on it (see plantOn); anything else reaches as
   * a limb always has, a foot following its shin. After a foot's reach the
   * other feet on the ground stand flat too, since a mirrored reach moves
   * the other leg as well.
   */
  reach(chainId: string, target: Vector3, iterations = 12, mirror = this.symmetry, plant = this.plantFeet): void {
    const c = this.chain(chainId);
    if (!c || !this.bones.has(c.effector)) return;
    this.reachChain(c, target, iterations, mirror, plant);
    if (plant && this.isFoot(c.effector)) this.plantGrounded(this.heldFeet(c.effector));
  }

  /** One chain's reach, planted where the ground is and planting is on. */
  private reachChain(c: IKChainDef, target: Vector3, iterations: number, mirror: boolean, plant: boolean): void {
    if (plant && this.isFoot(c.effector) && this.plantOn(c, target, iterations, mirror)) return;
    this.solve(c, target, iterations, mirror, this.effectorAt.get(c.effector) ?? 1);
  }

  /**
   * Plant a foot with its handle on `target`, if a flat foot there stands
   * on the ground: the ankle is solved for the place a flat foot puts it,
   * then the foot is stood flat on it. Solving for the ankle rather than
   * the handle is what keeps a pinned foot on its pin: flattening a foot
   * after the leg has reached turns it about the ankle and carries the
   * handle off the mark by the whole of the correction.
   *
   * The ankle's limits can stop a foot short of flat - a deep crouch
   * folds the ankle further than it goes - and then the handle misses by
   * what the foot still leans, so the ankle is aimed again for the foot as
   * it stands, a round or two more. False, with the leg wherever the solve
   * left it, when the ankle does not end on the ground: the point is out of
   * reach of a flat foot, or the lean has lifted the heel; the caller then
   * reaches as for a foot in the air.
   */
  private plantOn(c: IKChainDef, target: Vector3, iterations: number, mirror: boolean): boolean {
    const foot = c.effector;
    const rest = this.rest.get(foot);
    if (!rest) return false;
    const p = this.props.get(foot) ?? { size: 1, length: 1 };
    const along = new Vector3(0, rest.length * p.length * (this.effectorAt.get(foot) ?? 1), 0);
    const ankle = along.applyQuaternion(this.flatQuaternion(foot, new Quaternion())).negate().add(target);
    if (!this.onGround(foot, ankle.y)) return false;
    const now = new Vector3();
    const tip = new Vector3();
    const next = new Vector3();
    for (let round = 0; round < 3; round++) {
      this.solve(c, ankle, iterations, mirror, 0);
      this.jointWorld(foot, now);
      if (!this.onGround(foot, now.y)) return false;
      this.setFlat(foot);
      this.effectorWorld(foot, tip);
      next.copy(now).add(target).sub(tip);
      if (next.distanceToSquared(ankle) < 1e-4) break;
      ankle.copy(next);
    }
    return true;
  }

  /**
   * Where the figure faces: its placement's turn about world Y, without
   * any lean or roll (the twist part of a swing-twist split, which is the
   * same whichever order the lean was put on in).
   */
  private heading(out: Quaternion): Quaternion {
    const rest = this.rest.get(this.root.name)!;
    out.copy(this.root.quaternion).multiply(_q2.copy(rest.local).invert());
    out.set(0, out.y, 0, out.w);
    return out.lengthSq() < 1e-12 ? out.identity() : out.normalize();
  }

  /** A foot's world orientation standing flat: as it rests, turned the way the figure faces. */
  private flatQuaternion(foot: string, out: Quaternion): Quaternion {
    this.heading(out);
    const restQ = this.restWorld.get(foot)?.q;
    return restQ ? out.multiply(restQ) : out;
  }

  /**
   * Stand a foot flat on the ground: the pose that gives it its flat
   * orientation under the shin as the shin now stands, clamped to the
   * ankle's limits like any pose. It turns about the ankle, so nothing
   * above the foot moves.
   */
  private setFlat(foot: string): void {
    const bone = this.bones.get(foot);
    const rest = this.rest.get(foot);
    if (!bone?.parent || !rest) return;
    this.root.updateMatrixWorld(true);
    const want = this.flatQuaternion(foot, new Quaternion());
    const parentQ = bone.parent.getWorldQuaternion(new Quaternion());
    // pose = restLocal^-1 * parentWorld^-1 * wantedWorld
    want.premultiply(parentQ.invert()).premultiply(parentQ.copy(rest.local).invert());
    _e.setFromQuaternion(want, 'XYZ');
    this.setPoseEuler(foot, _e.x / RAD, _e.y / RAD, _e.z / RAD, false);
  }

  /** Whether an ankle at height `y` has its foot on the ground: near the height it rests at. */
  private onGround(foot: string, y: number): boolean {
    const rest = this.restWorld.get(foot);
    return !!rest && Math.abs(y - rest.head.y) <= GROUND_BAND * this.scale;
  }

  /** Stand flat every foot whose ankle is on the ground, but those in `skip`. */
  private plantGrounded(skip?: Set<string>): void {
    const ankle = new Vector3();
    for (const foot of this.feet) {
      if (skip?.has(foot) || !this.jointWorld(foot, ankle)) continue;
      if (this.onGround(foot, ankle.y)) this.setFlat(foot);
    }
  }

  /**
   * The feet whose planting their own solve decides: every pinned one, and
   * `also`, a foot just reached. Flattening one of those about its ankle
   * afterwards would carry its handle off the mark it was solved for.
   */
  private heldFeet(also?: string): Set<string> {
    const out = new Set<string>();
    if (also) out.add(also);
    for (const id of this.pins.keys()) {
      const foot = this.chain(id)?.effector;
      if (foot) out.add(foot);
    }
    return out;
  }

  /**
   * Bring a point on the chain's effector bone - `at` of the way from its
   * head to its tail - to a world point, by cyclic coordinate descent:
   * each link in turn swings so the point sits, seen from that joint, on
   * the target instead of where it is, and the swing stays INSIDE the
   * joint's limits, so a knee cannot bend backwards to get there and a
   * symmetric figure mirrors as it reaches.
   *
   * Inside them, not clamped into them afterwards (see turnWithin): each
   * Euler axis of a swing clamped on its own lands on a turn nothing like
   * the nearest one the joint can make. A pinned foot past its reach ended
   * forty units off its pin where the leg could get within eight, and the
   * next solve flipped it somewhere else again (owner report: "pretty
   * spazzy").
   *
   * A target past reach is then settled by descent (see settle): the
   * nearest pose the limits allow, which a second solve of the same target
   * leaves where it is.
   *
   * three ships a CCD solver, and it is not usable here: it clamps
   * `link.rotation`, the bone's whole local rotation, while a limit in this
   * rig is a range on the POSE - what the joint has been turned by, on top
   * of a rest orientation that is not the identity. Feeding it these limits
   * would clamp the rest away. The loop below is the same algorithm over
   * the representation that has the limits in it.
   */
  private solve(c: IKChainDef, target: Vector3, iterations: number, mirror: boolean, at: number): void {
    // The hinge in the chain - the elbow or the knee - is not left to the
    // descent: a straight limb is where CCD fails. With the effector,
    // the target and the joints all on one line the swing axis is
    // undefined, and worse, the descent's measure is the ANGLE between
    // "where the hand is" and "where it should be", which a straight arm
    // pointing right at a nearer target already scores perfectly. A
    // planted foot under a dropping pelvis is exactly that case, and the
    // leg would stay poker-straight forever. The hinge is solved instead:
    // the triangle of the two bones and the distance to the target has one
    // answer, and the law of cosines gives it directly, every pass.
    const hingeIndex = c.links.findIndex((n) => this.defs.get(n)?.kind === 'hinge');
    const twoBone = hingeIndex >= 0 && hingeIndex + 1 < c.links.length;
    const hinge = twoBone ? c.links[hingeIndex] : null;
    const tip = new Vector3();
    const off = (): number => this.effectorWorld(c.effector, tip, at).distanceTo(target);
    // The poses a solve can go back to: the links, and their mirrors when
    // the other side follows.
    const held = [...c.links];
    for (const n of c.links) {
      const m = mirror ? this.defs.get(n)?.mirror : null;
      if (m) held.push(m);
    }
    const start = this.keepPoses(held);
    const best = this.keepPoses(held);
    let least = off();
    let improved = false;
    let stall = 0;
    for (let i = 0; i < iterations; i++) {
      if (twoBone) this.bendHinge(c, hingeIndex, target, mirror, at);
      // The aim gets the first passes; the rest belong to position. An aim
      // the joint cannot twist to would otherwise push every pass while
      // the descent pulls back, and the two would never settle - so the
      // hand's place wins and the aim is honoured as far as it reaches.
      if (twoBone && i < 2) this.aimHinge(c, hingeIndex, target, mirror);
      this.turnLinks(c, target, at, mirror, hinge, null, 1);
      const d = off();
      if (d < REACHED) return;
      // The pass that left the point nearest is the one kept. A pass can
      // leave it further off on the way there - the triangle and the aim
      // both move it, and the swings make up for that over the next pass
      // or two - so only the passes after the aim's count as stalling.
      if (d < least - 1e-6) {
        least = d;
        improved = true;
        this.keepPoses(held, best);
        stall = 0;
      } else if ((!twoBone || i >= 2) && ++stall >= 2) break;
    }
    this.restorePoses(held, best);
    if (least >= REACHED) this.settle(c, target, at, mirror, hinge, held, start, improved ? best : null, off);
  }

  /**
   * The passes stopped short of the target: it is past reach, or nearly,
   * and the nearest pose the limits allow is found by descent over every
   * axis of every link (the hinge's twist apart, which no pass turns:
   * free here, it swung the moment a target slipped past the passes'
   * reach). The descent never moves the point further off, so it ends
   * where a second solve would begin, and that solve leaves it there - a
   * target just past reach no longer flickers from one answer to another
   * on every move.
   *
   * Descent finds the nearest pose of the valley it starts in, and a leg
   * swinging across past its hip has two: twisted one way at the hip with
   * the knee bent, or the other way with it straight, the first nearly
   * twice as near. So it starts from where the solve began, from the
   * passes' best, and from the hip (or shoulder) twisted to each end of
   * its range with the rest of the limb at rest; and the answer from where
   * the solve began stands unless another lands clearly nearer. That keeps
   * a dragged limb in its valley from one move to the next, rather than
   * jumping to another for a hair's gain.
   */
  private settle(
    c: IKChainDef,
    target: Vector3,
    at: number,
    mirror: boolean,
    hinge: string | null,
    held: string[],
    start: Quaternion[],
    best: Quaternion[] | null,
    off: () => number,
  ): void {
    const descend = (from: Quaternion[], seed?: (links: ChainLink[]) => void): number => {
      this.restorePoses(held, from);
      this.turnLinks(c, target, at, mirror, null, hinge, 256, seed);
      return off();
    };
    const near = descend(start);
    const kept = this.keepPoses(held);
    let other = Infinity;
    const otherPoses = this.keepPoses(held);
    const tryFrom = (from: Quaternion[], seed?: (links: ChainLink[]) => void): void => {
      const d = descend(from, seed);
      if (d < other) {
        other = d;
        this.keepPoses(held, otherPoses);
      }
    };
    if (best) tryFrom(best);
    const base = hinge ? c.links[c.links.indexOf(hinge) + 1] : null;
    for (const end of base ? [0, 1] : []) {
      tryFrom(start, (links) => {
        for (const l of links) {
          if (!l.free) continue;
          for (let k = 0; k < 3; k++) l.e[k] = Math.min(l.hi[k], Math.max(l.lo[k], 0));
          if (l.name === base) l.e[1] = end ? l.hi[1] : l.lo[1];
          l.moved = true;
        }
      });
    }
    let length = 0;
    for (const n of c.links) length += (this.rest.get(n)?.length ?? 0) * (this.props.get(n)?.length ?? 1);
    const clearly = Math.max(0.02 * near, 0.01 * length, 1e-3);
    this.restorePoses(held, other < near - clearly ? otherPoses : kept);
  }

  /** The poses of `names`, kept to be put back; into `out` when given. */
  private keepPoses(names: string[], out: Quaternion[] = names.map(() => new Quaternion())): Quaternion[] {
    names.forEach((n, i) => out[i].copy(this.pose.get(n) ?? _q.identity()));
    return out;
  }

  private restorePoses(names: string[], from: Quaternion[]): void {
    names.forEach((n, i) => {
      const q = this.pose.get(n);
      const bone = this.bones.get(n);
      const rest = this.rest.get(n);
      if (!q || !bone || !rest) return;
      q.copy(from[i]);
      bone.quaternion.copy(rest.local).multiply(q);
    });
  }

  /**
   * Turn the chain's links, nearest the handle first, each as near the
   * target as its limits let it bring the point: one round, or up to
   * `rounds` while the point keeps coming nearer. `skip` is a link left as
   * it is, `hold` one whose twist is; `seed` sets the links to start from.
   * Worked on as numbers (see ChainPose) and written back once, from the
   * top of the chain down, so a mirrored joint is copied onto a parent
   * already turned.
   */
  private turnLinks(
    c: IKChainDef,
    target: Vector3,
    at: number,
    mirror: boolean,
    skip: string | null,
    hold: string | null,
    rounds: number,
    seed?: (links: ChainLink[]) => void,
  ): void {
    const chain = this.chainPose(c, target, at, hold);
    if (!chain) return;
    seed?.(chain.links);
    chain.forward();
    let d = chain.off();
    for (let r = 0; r < rounds; r++) {
      chain.sweep(skip);
      const now = chain.off();
      if (d - now < 1e-6) break;
      d = now;
      chain.forward();
    }
    for (const l of chain.links) {
      if (l.free && l.moved) this.setPoseEuler(l.name, l.e[0] / RAD, l.e[1] / RAD, l.e[2] / RAD, mirror);
    }
  }

  /**
   * A chain as numbers, in the frame of the bone it hangs from: the bones
   * from the top link down to the effector's parent, each with its place
   * on its parent, its rest, its pose and its limits (`hold`'s twist
   * pinned where it is); the handle point on the last of them; and the
   * target. Null when the top link is not above the effector, which no
   * chain here has.
   */
  private chainPose(c: IKChainDef, target: Vector3, at: number, hold: string | null): ChainPose | null {
    const effector = this.bones.get(c.effector);
    const top = this.bones.get(c.links[c.links.length - 1]);
    const base = top?.parent;
    const restE = this.rest.get(c.effector);
    if (!effector || !top || !base || !restE) return null;
    const path: Bone[] = [];
    for (let b = effector.parent; b; b = b.parent) {
      path.unshift(b as Bone);
      if (b === top) break;
    }
    if (path[0] !== top) return null;
    this.root.updateMatrixWorld(true);
    const out = new ChainPose();
    base.worldToLocal(out.target.copy(target));
    for (const bone of path) {
      const free = c.links.includes(bone.name);
      const rest = this.rest.get(bone.name);
      if (free && !rest) return null;
      const e = free ? this.getPoseEuler(bone.name) : [0, 0, 0];
      const l = free ? this.limitsOf(bone.name) : { x: [0, 0], y: [0, 0], z: [0, 0] };
      const link: ChainLink = {
        name: bone.name,
        free,
        offset: bone.position.clone(),
        local: free ? rest!.local.clone() : bone.quaternion.clone(),
        e: [e[0] * RAD, e[1] * RAD, e[2] * RAD],
        lo: [l.x[0] * RAD, l.y[0] * RAD, l.z[0] * RAD],
        hi: [l.x[1] * RAD, l.y[1] * RAD, l.z[1] * RAD],
        moved: false,
        head: new Vector3(),
        frame: new Quaternion(),
        turn: new Quaternion(),
      };
      if (bone.name === hold) link.lo[1] = link.hi[1] = link.e[1];
      out.links.push(link);
    }
    const p = this.props.get(c.effector) ?? { size: 1, length: 1 };
    out.point.set(0, restE.length * p.length * at, 0).applyQuaternion(effector.quaternion).add(effector.position);
    return out;
  }

  /**
   * Turn the limb about the line from its base joint to the target until
   * the hinge points where the aim says. That line runs through the
   * effector, so this never moves the hand or the foot - only the plane
   * the elbow or knee lives in. The step is the DIFFERENCE from where the
   * hinge points now, so it converges instead of accumulating.
   *
   * Where it points now is read against the limb's own line, to the ankle
   * or the wrist, not against the line to the handle. A foot held by its
   * middle, or by its toe as it used to be, sits well ahead of the ankle,
   * and against the line to it the knee of a nearly straight leg reads as
   * pointing backwards: the first solve after the pelvis moved turned the
   * whole leg half round to "fix" it, which is how pinned feet snapped
   * round when the hips were dragged (owner report).
   *
   * The limb turns as far towards the aim as its base joint's limits
   * allow, and no further: the whole turn clamped axis by axis is some
   * other turn, one that carries the hand or foot off its mark.
   */
  private aimHinge(c: IKChainDef, hingeIndex: number, target: Vector3, mirror: boolean): void {
    const baseName = c.links[hingeIndex + 1];
    const base = this.bones.get(baseName);
    const hinge = this.bones.get(c.links[hingeIndex]);
    const end = this.bones.get(c.effector);
    const rest = this.rest.get(baseName);
    if (!c.poleRef || !base || !hinge || !end || !rest) return;
    this.root.updateMatrixWorld(true);
    const basePos = new Vector3().setFromMatrixPosition(base.matrixWorld);
    const axis = new Vector3().subVectors(target, basePos);
    if (axis.lengthSq() < 1e-8) return;
    axis.normalize();
    const now = this.aroundLimb(
      c,
      basePos,
      new Vector3().setFromMatrixPosition(end.matrixWorld),
      new Vector3().setFromMatrixPosition(hinge.matrixWorld),
    );
    if (now === null) return; // a straight limb has no bend plane
    const delta = wrap180(this.getAim(c.id) - now);
    if (Math.abs(delta) < 0.05) return;
    const baseQ = base.getWorldQuaternion(new Quaternion());
    // pose = restLocal^-1 * parentWorld^-1 * turnedWorld
    const toPose = new Quaternion();
    if (base.parent) (base.parent as Bone).getWorldQuaternion(toPose);
    toPose.invert().premultiply(_q2.copy(rest.local).invert());
    const swing = new Quaternion();
    const turned = new Quaternion();
    const l = this.limitsOf(baseName);
    const poseFor = (degrees: number): Euler => {
      swing.setFromAxisAngle(axis, degrees * RAD);
      turned.copy(baseQ).premultiply(swing).premultiply(toPose);
      return _e.setFromQuaternion(turned, 'XYZ');
    };
    const fits = (e: Euler): boolean => within(e.x / RAD, l.x) && within(e.y / RAD, l.y) && within(e.z / RAD, l.z);
    let part = 1;
    if (!fits(poseFor(delta))) {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2;
        if (fits(poseFor(delta * mid))) lo = mid;
        else hi = mid;
      }
      part = lo;
    }
    if (Math.abs(delta * part) < 0.05) return;
    const e = poseFor(delta * part);
    this.setPoseEuler(baseName, e.x / RAD, e.y / RAD, e.z / RAD, mirror);
  }

  /**
   * The hinge angle that makes the limb span the distance to the target:
   * two bone lengths and the distance are a triangle, and the interior
   * angle at the hinge follows from the law of cosines. Bends the way the
   * joint is allowed to bend, and straightens out for anything further
   * away than the limb is long.
   */
  private bendHinge(c: IKChainDef, hingeIndex: number, target: Vector3, mirror: boolean, at: number): void {
    const hinge = c.links[hingeIndex];
    const base = this.bones.get(c.links[hingeIndex + 1]);
    const knee = this.bones.get(hinge);
    if (!base || !knee) return;
    this.root.updateMatrixWorld(true);
    const basePos = new Vector3().setFromMatrixPosition(base.matrixWorld);
    const kneePos = new Vector3().setFromMatrixPosition(knee.matrixWorld);
    const tip = this.effectorWorld(c.effector, new Vector3(), at);
    const a = basePos.distanceTo(kneePos);
    // The hinge-to-tip distance is fixed: nothing between them bends.
    const b = kneePos.distanceTo(tip);
    if (a < 1e-6 || b < 1e-6) return;
    const d = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, basePos.distanceTo(target)));
    const cos = Math.min(1, Math.max(-1, (a * a + b * b - d * d) / (2 * a * b)));
    const wanted = (Math.acos(cos) * 180) / Math.PI;
    // What the joint measures NOW, and the change from it - not an absolute
    // angle. A foot is not on the line of its shin (nor a hand of its
    // forearm), so a straight leg does not read 180 degrees at the knee,
    // and setting the angle outright would fold it by that error on every
    // solve. The difference is exact whatever the shape below the joint.
    const toBase = basePos.sub(kneePos).normalize();
    const toTip = tip.sub(kneePos).normalize();
    const now = (Math.acos(Math.min(1, Math.max(-1, toBase.dot(toTip)))) * 180) / Math.PI;
    const l = this.limitsOf(hinge);
    const cur = this.getPoseEuler(hinge);
    // Which way the joint bends: toward the end of its range with the room
    // in it. Not "whichever end is positive" - an elbow that rests a few
    // degrees bent has a little positive range for straightening, and that
    // is not the way it folds.
    const sign = Math.abs(l.x[0]) > Math.abs(l.x[1]) ? -1 : 1;
    this.setPoseEuler(hinge, cur[0] + sign * (now - wanted), cur[1], cur[2], mirror);
  }

  /**
   * Put every pinned handle back on its mark, then stand flat whichever
   * other feet are on the ground. Run after anything that moves a pinned
   * limb without meaning to - the pelvis being dragged, a joint further up
   * the chain being turned, a part getting longer. `except` is a chain
   * just reached, left as that reach put it; `plant` false leaves every
   * foot's turn as it is, for a foot being turned by hand.
   */
  applyPins(except?: string, plant = this.plantFeet): void {
    for (const [id, target] of this.pins) {
      const c = this.chain(id);
      if (c && id !== except) this.reachChain(c, target, 10, false, plant);
    }
    if (plant) this.plantGrounded(this.heldFeet(except ? this.chain(except)?.effector : undefined));
  }

  /** Move a pin to where its handle stands now (it was just dragged). */
  repin(id: string): void {
    if (this.pins.has(id)) this.setPinned(id, true);
  }

  // --- picking, bounds, export ----------------------------------------------------

  /** The bone whose part a raycast hit, from the face's skin indices. */
  boneAt(hit: Intersection): string | null {
    if (!hit.face) return null;
    const skin = this.mesh.geometry.getAttribute('skinIndex');
    const weight = this.mesh.geometry.getAttribute('skinWeight');
    const i = hit.face.a;
    // The heaviest joint on the vertex, not the first: a piece that spans
    // a joint is split between two of them, and the first is arbitrary.
    let best = skin.getX(i);
    if (weight) {
      let bestW = weight.getX(i);
      const rest: Array<['Y' | 'Z' | 'W', number]> = [
        ['Y', weight.getY(i)],
        ['Z', weight.getZ(i)],
        ['W', weight.getW(i)],
      ];
      for (const [axis, w] of rest) {
        if (w > bestW) {
          bestW = w;
          best = skin[`get${axis}`](i);
        }
      }
    }
    return this.partOwner.get(best) ?? null;
  }

  /** The bone a skin index (a part bone's place in the skeleton) belongs to. */
  boneOfSkinIndex(i: number): string | null {
    return this.partOwner.get(i) ?? null;
  }

  /** World-space bounds of the posed figure. */
  bounds(): Box3 {
    this.mesh.updateMatrixWorld(true);
    this.mesh.computeBoundingBox();
    return this.mesh.boundingBox!.clone();
  }

  /** The posed figure as world-space triangles (Send to Sculpt). */
  bakeWorld(): { positions: Float32Array; indices: Uint32Array } {
    this.mesh.updateMatrixWorld(true);
    this.skeleton.update();
    const pos = this.mesh.geometry.getAttribute('position');
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      // applyBoneTransform skins the vector it is given; it does not read the vertex.
      _v.fromBufferAttribute(pos, i);
      this.mesh.applyBoneTransform(i, _v);
      _v.applyMatrix4(this.mesh.matrixWorld);
      out[i * 3] = _v.x;
      out[i * 3 + 1] = _v.y;
      out[i * 3 + 2] = _v.z;
    }
    const idx = this.mesh.geometry.getIndex()!;
    return { positions: out, indices: new Uint32Array(idx.array as ArrayLike<number>) };
  }

  /** A highlight mesh for one part, in the part bone's frame (add it to that bone). */
  partHighlight(name: string, material: Material): Mesh | null {
    const g = this.partGeometry.get(name);
    if (!g) return null;
    const m = new Mesh(g, material);
    m.name = 'armature-highlight';
    m.frustumCulled = false;
    return m;
  }

  // --- state -----------------------------------------------------------------------

  serialize(): ArmatureState {
    const pose: ArmatureState['pose'] = {};
    for (const name of this.pose.keys()) {
      const e = this.getPoseEuler(name);
      if (e.some((v) => Math.abs(v) > 1e-6)) pose[name] = e.map((v) => +v.toFixed(3)) as [number, number, number];
    }
    const proportions: ArmatureState['proportions'] = {};
    for (const [name, p] of this.props) {
      if (p.size !== 1 || p.length !== 1) proportions[name] = { ...p };
    }
    const pins: NonNullable<ArmatureState['pins']> = {};
    for (const [id, p] of this.pins) pins[id] = [p.x, p.y, p.z];
    const aims: NonNullable<ArmatureState['aims']> = {};
    for (const [id, a] of this.aims) if (a) aims[id] = +a.toFixed(2);
    return {
      v: 1,
      preset: this.rig.id,
      root: { position: this.root.position.toArray() as [number, number, number], quaternion: this.root.quaternion.toArray() as [number, number, number, number] },
      pose,
      proportions,
      pins,
      aims,
      plant: this.plantFeet,
    };
  }

  /**
   * Apply a saved state (same preset). Unknown bones are ignored.
   *
   * A state written before feet were planted (it has no `plant`) is brought
   * up to date on the way in: its feet on the ground stand flat, and its
   * foot pins move to the middle of the foot, where the reach takes hold
   * now. They were held at the toe, and the first move of the pelvis would
   * have pulled each foot forward by half its length to put its middle
   * there. Its aims are read from its pose: they were measured another way
   * then, and the first solve would have turned each limb to match. One
   * older still, saved before pins were, is a new figure as far as pins
   * go, and gets its feet pinned.
   *
   * A state written since was planted as it was made, so it is taken as it
   * stands: planting it again would undo a foot turned by hand on the
   * ground, and undo, redo and a reload would each show something other
   * than what was saved.
   */
  restore(state: ArmatureState): void {
    if (state.root) {
      this.root.position.fromArray(state.root.position);
      this.root.quaternion.fromArray(state.root.quaternion);
    }
    this.clearPose();
    for (const name of this.props.keys()) this.setProportions(name, { size: 1, length: 1 }, false);
    for (const [name, p] of Object.entries(state.proportions ?? {})) {
      if (this.props.has(name)) this.setProportions(name, p, false);
    }
    for (const [name, e] of Object.entries(state.pose ?? {})) {
      if (this.pose.has(name) && Array.isArray(e)) this.setPoseEuler(name, e[0], e[1], e[2], false);
    }
    this.aims.clear();
    for (const [id, a] of Object.entries(state.aims ?? {})) {
      if (this.chain(id) && typeof a === 'number' && Number.isFinite(a)) this.aims.set(id, wrap180(a));
    }
    this.plantFeet = state.plant !== false;
    this.pins.clear();
    for (const [id, p] of Object.entries(state.pins ?? {})) {
      if (this.chain(id) && Array.isArray(p) && p.length === 3) this.pins.set(id, new Vector3(p[0], p[1], p[2]));
    }
    this.mesh.updateMatrixWorld(true);
    if (state.plant === undefined) {
      for (const c of this.rig.ik) this.readAim(c);
      if (this.plantFeet) this.plantGrounded();
      for (const id of [...this.pins.keys()]) {
        const c = this.chain(id);
        if (c && (this.effectorAt.get(c.effector) ?? 1) !== 1) this.setPinned(id, true);
      }
    }
    if (state.pins === undefined) this.pinFeet();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    for (const g of this.partGeometry.values()) g.dispose();
    this.mesh.removeFromParent();
  }
}

/**
 * How far a part may be scaled: the panel's sliders run 0.5 to 2, and a
 * value typed past them is held here (and the same holds for a saved one).
 */
export const PROPORTION_LIMITS = {
  size: { min: 0.2, max: 4 },
  length: { min: 0.3, max: 3 },
} as const;

function clamp(v: number, r: [number, number]): number {
  return Math.min(r[1], Math.max(r[0], v));
}

/** Degrees into (-180, 180], so an aim difference takes the short way round. */
function wrap180(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}

/** Whether an angle is inside a range, to a ten-thousandth of a degree. */
function within(v: number, r: [number, number]): boolean {
  return v >= r[0] - 1e-4 && v <= r[1] + 1e-4;
}

/** One bone of a chain being solved, as numbers (see ChainPose). */
interface ChainLink {
  name: string;
  /** A link of the chain, or a bone between two links, held as it is. */
  free: boolean;
  /** Its head, in its parent's frame. */
  offset: Vector3;
  /** Its rest turn, or for a held bone its whole turn. */
  local: Quaternion;
  /** Its pose, XYZ Euler radians, and the limits on that. */
  e: [number, number, number];
  lo: [number, number, number];
  hi: [number, number, number];
  moved: boolean;
  /** From forward(): where its joint is, what its pose turns from, and its whole turn. */
  head: Vector3;
  frame: Quaternion;
  turn: Quaternion;
}

/**
 * A chain's bones as plain numbers, in the frame of the bone it hangs
 * from, so a link can be turned and the handle point followed without the
 * scene graph: a descent over every axis of every link would otherwise
 * update the whole skeleton's matrices hundreds of times a solve.
 */
class ChainPose {
  /** From the top link down to the effector's parent. */
  readonly links: ChainLink[] = [];
  /** The handle point, in the frame of the last of them. */
  readonly point = new Vector3();
  readonly target = new Vector3();
  /** Where the handle point is now. */
  readonly tip = new Vector3();

  forward(): void {
    let up: ChainLink | null = null;
    for (const l of this.links) {
      if (up) {
        l.head.copy(l.offset).applyQuaternion(up.turn).add(up.head);
        l.frame.copy(up.turn).multiply(l.local);
      } else {
        l.head.copy(l.offset);
        l.frame.copy(l.local);
      }
      l.turn.copy(l.frame).multiply(poseTurn(l.e, _cq));
      up = l;
    }
    if (up) this.tip.copy(this.point).applyQuaternion(up.turn).add(up.head);
  }

  off(): number {
    return this.tip.distanceTo(this.target);
  }

  /**
   * One round, nearest the handle first: each link turned within its
   * limits to bring the point nearest the target, with the links below it
   * as they now are. The joints below a turned link are stale until the
   * next forward(), and nothing here reads them.
   */
  sweep(skip: string | null): void {
    for (let k = this.links.length - 1; k >= 0; k--) {
      const l = this.links[k];
      if (!l.free || l.name === skip) continue;
      _cu.subVectors(this.tip, l.head).applyQuaternion(_cq.copy(l.turn).invert());
      _cw.subVectors(this.target, l.head).applyQuaternion(_cq.copy(l.frame).invert());
      if (!turnWithin(l.e, _cu, _cw, l.lo, l.hi)) continue;
      l.moved = true;
      l.turn.copy(l.frame).multiply(poseTurn(l.e, _cq));
      this.tip.copy(_cu).applyQuaternion(l.turn).add(l.head);
    }
  }
}

const _cq = new Quaternion();
const _cu = new Vector3();
const _cw = new Vector3();
const _ta = new Vector3();
const _tb = new Vector3();
const _tq = new Quaternion();
const _ts = new Quaternion();
const _te = new Euler();
/** How far past a limit a pose still counts as on it, in radians. */
const EDGE = 1e-6;

function poseTurn(e: [number, number, number], out: Quaternion): Quaternion {
  return out.setFromEuler(_te.set(e[0], e[1], e[2], 'XYZ'));
}

/**
 * Turn a joint so `u`, a point in its posed frame, comes as near as its
 * limits allow to `w`, the target in its rest frame (a turn keeps the
 * point's distance from the joint, so nearest is pointing most nearly at
 * it). `e` is the pose, XYZ Euler radians in [lo, hi], changed in place;
 * the return says whether it moved.
 *
 * The free swing comes first - the shortest turn that points the joint at
 * the target, as CCD has always taken it, and the best this joint can do
 * - and inside the limits it stands, so a reach the limits allow goes
 * exactly as it always did. Past them the answer is not that swing
 * clamped axis by axis, which can be a turn nothing like it, but a
 * descent over the three axes inside their ranges, from whichever of the
 * clamped swing and the pose as it is lies nearer. Each axis on its own
 * has an exact answer (see bestAngle), so no step moves the point further
 * off, and the same pose and target always give the same turn.
 */
function turnWithin(
  e: [number, number, number],
  u: Vector3,
  w: Vector3,
  lo: [number, number, number],
  hi: [number, number, number],
): boolean {
  if (u.lengthSq() < 1e-12 || w.lengthSq() < 1e-12) return false;
  const was = [e[0], e[1], e[2]];
  _ta.copy(u).applyQuaternion(poseTurn(e, _tq)).normalize();
  _tb.copy(w).normalize();
  if (_ta.dot(_tb) > 0.999999) return false; // already pointing there
  _te.setFromQuaternion(_tq.premultiply(_ts.setFromUnitVectors(_ta, _tb)), 'XYZ');
  const swung: [number, number, number] = [_te.x, _te.y, _te.z];
  let inside = true;
  for (let k = 0; k < 3; k++) {
    if (swung[k] < lo[k] - EDGE || swung[k] > hi[k] + EDGE) inside = false;
    swung[k] = Math.min(hi[k], Math.max(lo[k], swung[k]));
  }
  if (inside || along(swung, u, w) > along(e, u, w)) {
    e[0] = swung[0];
    e[1] = swung[1];
    e[2] = swung[2];
  }
  if (!inside) descend(e, u, w, lo, hi);
  return Math.abs(e[0] - was[0]) + Math.abs(e[1] - was[1]) + Math.abs(e[2] - was[2]) > 1e-9;
}

/** How far along `w` the pose `e` carries `u`: three's XYZ order turns Z first, then Y, then X. */
function along(e: [number, number, number], u: Vector3, w: Vector3): number {
  const cz = Math.cos(e[2]);
  const sz = Math.sin(e[2]);
  const x1 = cz * u.x - sz * u.y;
  const y1 = sz * u.x + cz * u.y;
  const cy = Math.cos(e[1]);
  const sy = Math.sin(e[1]);
  const x2 = cy * x1 + sy * u.z;
  const z2 = -sy * x1 + cy * u.z;
  const cx = Math.cos(e[0]);
  const sx = Math.sin(e[0]);
  return x2 * w.x + (cx * y1 - sx * z2) * w.y + (sx * y1 + cx * z2) * w.z;
}

/**
 * Coordinate descent over a pose's three Euler axes, each set in turn to
 * the angle in its range that carries `u` furthest along `w` with the
 * other two as they are.
 */
function descend(
  e: [number, number, number],
  u: Vector3,
  w: Vector3,
  lo: [number, number, number],
  hi: [number, number, number],
): void {
  for (let round = 0; round < 32; round++) {
    let change = 0;
    // X turns last, so it sees u after Z and Y have: Ry Rz u.
    const cz = Math.cos(e[2]);
    const sz = Math.sin(e[2]);
    const px = cz * u.x - sz * u.y;
    const py = sz * u.x + cz * u.y;
    const pz = u.z;
    let cy = Math.cos(e[1]);
    let sy = Math.sin(e[1]);
    const qz = -sy * px + cy * pz;
    change = Math.max(change, bestAngle(e, 0, py * w.y + qz * w.z, py * w.z - qz * w.y, lo, hi));
    // Y sees Rz u, against w turned back through X.
    const cx = Math.cos(e[0]);
    const sx = Math.sin(e[0]);
    const my = cx * w.y + sx * w.z;
    const mz = -sx * w.y + cx * w.z;
    change = Math.max(change, bestAngle(e, 1, px * w.x + pz * mz, pz * w.x - px * mz, lo, hi));
    // Z sees u itself, against w turned back through X and then Y.
    cy = Math.cos(e[1]);
    sy = Math.sin(e[1]);
    const nx = cy * w.x - sy * mz;
    change = Math.max(change, bestAngle(e, 2, u.x * nx + u.y * my, u.x * my - u.y * nx, lo, hi));
    if (change < 1e-9) break;
  }
}

/**
 * Set axis `k` of `e` to the angle in its range that maximises
 * a cos t + b sin t, which is what a point turned about one axis projects
 * to. The peak is at atan2(b, a); out of range, the better end is the
 * answer, since within one turn a sinusoid rises to no other peak.
 * Returns how far the axis moved.
 */
function bestAngle(
  e: [number, number, number],
  k: number,
  a: number,
  b: number,
  lo: [number, number, number],
  hi: [number, number, number],
): number {
  const was = e[k];
  if (hi[k] - lo[k] < 1e-12) e[k] = lo[k];
  else if (a * a + b * b > 1e-18) {
    const peak = Math.atan2(b, a);
    if (peak >= lo[k] && peak <= hi[k]) e[k] = peak;
    else e[k] = a * Math.cos(lo[k]) + b * Math.sin(lo[k]) >= a * Math.cos(hi[k]) + b * Math.sin(hi[k]) ? lo[k] : hi[k];
  }
  return Math.abs(e[k] - was);
}

/** A fresh figure of a preset, sharing the given material. */
export function buildArmature(preset: string, material: Material): Armature {
  return new Armature(rigById(preset), material);
}

/** A figure read from a rigged file, sharing the given material. */
export function importArmature(read: ReadRig, material: Material): Armature {
  return new Armature(read.rig, material, SCENE_SCALE, {
    geometry: read.mesh.geometry,
    boneOrder: read.mesh.skeleton.bones.map((b) => read.sourceNames
      ? Object.keys(read.sourceNames).find((k) => read.sourceNames[k] === b.name) ?? canonicalName(b.name)
      : canonicalName(b.name)),
  });
}
