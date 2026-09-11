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
  /** Mirror pose edits onto the other side (the Armature panel's box). */
  symmetry = true;

  private readonly defs = new Map<string, BoneDef>();
  private readonly rest = new Map<string, { local: Quaternion; offset: Vector3; length: number }>();
  private readonly pose = new Map<string, Quaternion>();
  private readonly props = new Map<string, Proportions>();
  private readonly limits = new Map<string, JointLimits>();
  /** Skeleton index of a part bone -> the bone it belongs to. */
  private readonly partOwner = new Map<number, string>();

  constructor(rig: RigDefinition, material: Material) {
    this.rig = rig;
    const worldQ = new Map<string, Quaternion>();
    const worldP = new Map<string, Vector3>();

    // 1. Bones with their rest frames. Local Y runs head to tail; local X
    // follows the hinted world axis on BOTH sides, so the left and right
    // frames are mirror images in Y and Z with X shared - the one layout
    // in which a single limit table can serve both sides (see limitsFor).
    for (const def of rig.bones) {
      this.defs.set(def.name, def);
      const head = new Vector3().fromArray(def.head).multiplyScalar(SCENE_SCALE);
      const tail = new Vector3().fromArray(def.tail).multiplyScalar(SCENE_SCALE);
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

    // 2. The parts, one box each, in bind space (the rest pose), skinned to
    // their part bone. Built after the tree so rest world matrices exist.
    const skeletonBones: Bone[] = [];
    for (const def of rig.bones) skeletonBones.push(this.bones.get(def.name)!);
    for (const def of rig.bones) {
      this.partOwner.set(skeletonBones.length, def.name);
      skeletonBones.push(this.partBones.get(def.name)!);
    }
    this.root.updateMatrixWorld(true);
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const skinIndex: number[] = [];
    const skinWeight: number[] = [];
    for (const def of rig.bones) {
      if (!def.part) continue;
      const restLen = this.rest.get(def.name)!.length;
      const len = (def.part.length ?? restLen / SCENE_SCALE) * SCENE_SCALE;
      const box = new BoxGeometry(def.part.width * SCENE_SCALE, len, def.part.depth * SCENE_SCALE);
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

  /** Every joint back to the rest pose (the root stays where it is). */
  resetPose(): void {
    for (const name of this.pose.keys()) this.setPoseEuler(name, 0, 0, 0, false);
  }

  /** The left side's pose onto the right, or the other way round. */
  mirrorPose(from: 'L' | 'R'): void {
    for (const def of this.rig.bones) {
      if (def.mirror && def.name.endsWith(`.${from}`)) this.mirrorPoseFrom(def.name);
    }
  }

  // --- proportions ------------------------------------------------------------

  getProportions(name: string): Proportions {
    return { ...(this.props.get(name) ?? { size: 1, length: 1 }) };
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
    if (typeof p.size === 'number') cur.size = Math.min(4, Math.max(0.2, p.size));
    if (typeof p.length === 'number') cur.length = Math.min(3, Math.max(0.3, p.length));
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

  chains(): IKChainDef[] {
    return this.rig.ik;
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

  /** Where a bone's far end is in the world (the point a handle sits on). */
  effectorWorld(bone: string, out: Vector3): Vector3 {
    const b = this.bones.get(bone);
    const rest = this.rest.get(bone);
    if (!b || !rest) return out.set(0, 0, 0);
    this.mesh.updateMatrixWorld(true);
    const p = this.props.get(bone) ?? { size: 1, length: 1 };
    return out.set(0, rest.length * p.length, 0).applyMatrix4(b.matrixWorld);
  }

  /**
   * Reach a handle towards a world point, by cyclic coordinate descent:
   * each link in turn swings so the effector points from that joint at the
   * target instead of at itself, and the swing is written back THROUGH the
   * pose clamp, so a knee cannot bend backwards to get there and a
   * symmetric figure mirrors as it reaches.
   *
   * three ships a CCD solver, and it is not usable here: it clamps
   * `link.rotation`, the bone's whole local rotation, while a limit in this
   * rig is a range on the POSE - what the joint has been turned by, on top
   * of a rest orientation that is not the identity. Feeding it these limits
   * would clamp the rest away. The loop below is the same algorithm over
   * the representation that has the limits in it.
   */
  reach(chainId: string, target: Vector3, iterations = 12, mirror = this.symmetry): void {
    const c = this.chain(chainId);
    if (!c || !this.bones.has(c.effector)) return;
    const tip = new Vector3();
    const toTip = new Vector3();
    const toTarget = new Vector3();
    const joint = new Vector3();
    const swing = new Quaternion();
    const parentQ = new Quaternion();
    const linkQ = new Quaternion();
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
    for (let i = 0; i < iterations; i++) {
      if (twoBone) this.bendHinge(c, hingeIndex, target, mirror);
      let moved = false;
      for (const name of c.links) {
        // The hinge is the triangle's, not the descent's.
        if (twoBone && this.defs.get(name)?.kind === 'hinge') continue;
        const link = this.bones.get(name);
        const rest = this.rest.get(name);
        if (!link || !rest) continue;
        this.root.updateMatrixWorld(true);
        this.effectorWorld(c.effector, tip);
        joint.setFromMatrixPosition(link.matrixWorld);
        toTip.subVectors(tip, joint);
        toTarget.subVectors(target, joint);
        if (toTip.lengthSq() < 1e-10 || toTarget.lengthSq() < 1e-10) continue;
        toTip.normalize();
        toTarget.normalize();
        if (toTip.dot(toTarget) > 0.999999) continue; // already pointing there
        swing.setFromUnitVectors(toTip, toTarget);
        // The swing is in world space: take it round to the link's own pose.
        link.getWorldQuaternion(linkQ);
        linkQ.premultiply(swing);
        if (link.parent) (link.parent as Bone).getWorldQuaternion(parentQ);
        else parentQ.identity();
        linkQ.premultiply(parentQ.invert());
        linkQ.premultiply(_q2.copy(rest.local).invert());
        _e.setFromQuaternion(linkQ, 'XYZ');
        this.setPoseEuler(name, _e.x / RAD, _e.y / RAD, _e.z / RAD, mirror);
        moved = true;
      }
      if (!moved) break;
      this.root.updateMatrixWorld(true);
      this.effectorWorld(c.effector, tip);
      if (tip.distanceToSquared(target) < 1e-4) break;
    }
  }

  /**
   * The hinge angle that makes the limb span the distance to the target:
   * two bone lengths and the distance are a triangle, and the interior
   * angle at the hinge follows from the law of cosines. Bends the way the
   * joint is allowed to bend, and straightens out for anything further
   * away than the limb is long.
   */
  private bendHinge(c: IKChainDef, hingeIndex: number, target: Vector3, mirror: boolean): void {
    const hinge = c.links[hingeIndex];
    const base = this.bones.get(c.links[hingeIndex + 1]);
    const knee = this.bones.get(hinge);
    if (!base || !knee) return;
    this.root.updateMatrixWorld(true);
    const basePos = new Vector3().setFromMatrixPosition(base.matrixWorld);
    const kneePos = new Vector3().setFromMatrixPosition(knee.matrixWorld);
    const tip = this.effectorWorld(c.effector, new Vector3());
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
    const sign = l.x[1] > 0.5 ? 1 : -1;
    this.setPoseEuler(hinge, cur[0] + sign * (now - wanted), cur[1], cur[2], mirror);
  }

  /**
   * Put every pinned handle back on its mark. Run after anything that moves
   * a pinned limb without meaning to - the pelvis being dragged, a joint
   * further up the chain being turned, a part getting longer.
   */
  applyPins(except?: string): void {
    for (const [id, target] of this.pins) {
      if (id !== except) this.reach(id, target, 10, false);
    }
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
    return this.partOwner.get(skin.getX(hit.face.a)) ?? null;
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
    return {
      v: 1,
      preset: this.rig.id,
      root: { position: this.root.position.toArray() as [number, number, number], quaternion: this.root.quaternion.toArray() as [number, number, number, number] },
      pose,
      proportions,
      pins,
    };
  }

  /** Apply a saved state (same preset). Unknown bones are ignored. */
  restore(state: ArmatureState): void {
    if (state.root) {
      this.root.position.fromArray(state.root.position);
      this.root.quaternion.fromArray(state.root.quaternion);
    }
    this.resetPose();
    for (const name of this.props.keys()) this.setProportions(name, { size: 1, length: 1 }, false);
    for (const [name, p] of Object.entries(state.proportions ?? {})) {
      if (this.props.has(name)) this.setProportions(name, p, false);
    }
    for (const [name, e] of Object.entries(state.pose ?? {})) {
      if (this.pose.has(name) && Array.isArray(e)) this.setPoseEuler(name, e[0], e[1], e[2], false);
    }
    this.pins.clear();
    for (const [id, p] of Object.entries(state.pins ?? {})) {
      if (this.chain(id) && Array.isArray(p) && p.length === 3) this.pins.set(id, new Vector3(p[0], p[1], p[2]));
    }
    this.mesh.updateMatrixWorld(true);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    for (const g of this.partGeometry.values()) g.dispose();
    this.mesh.removeFromParent();
  }
}

function clamp(v: number, r: [number, number]): number {
  return Math.min(r[1], Math.max(r[0], v));
}

/** A fresh figure of a preset, sharing the given material. */
export function buildArmature(preset: string, material: Material): Armature {
  return new Armature(rigById(preset), material);
}
