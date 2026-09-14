/**
 * Rig definitions for the Armature mode: a named tree of bones with rest
 * positions, joint limits and a block part per bone. Units are metres
 * (the figure is scaled into the scene on build), Y is up, the figure
 * faces +Z, and every bone's local Y runs from its head to its tail
 * (Blender's convention, so the owner's rigged .glb presets will read the
 * same way).
 *
 * Joint limits are Euler ranges in degrees on the bone's own frame, for
 * the pose rotation applied on top of the rest orientation: a hinge has a
 * range on one axis and none on the others. Frames on the left and right
 * are mirror images of each other, so one set of limits serves both sides
 * and a pose mirrors by reflection.
 *
 * The placeholder presets here are boxes in an A-pose with an eight-head
 * canon; the owner's low-poly planar figures replace the parts, not the
 * rig, when they arrive.
 */

export type Vec3 = [number, number, number];

/**
 * The neutral pose is not a mannequin's straight line (owner call): a
 * relaxed arm keeps a few degrees at the elbow, a leg a few at the knee.
 * It reads as alive rather than assembled, and it hands the reach solver a
 * bend plane from the first drag - a limb straight to the millimetre has
 * none, and has to be given one.
 *
 * The joint limits below are written the anatomical way, measured from
 * STRAIGHT, and shifted onto the rest by `fromRest`: an elbow that rests
 * seven degrees in can still straighten by seven, and bends by the rest.
 */
const ELBOW_REST = 7;
/** How far forward the knee sits at rest, in metres on a 1.80 m figure. */
const KNEE_FORWARD = 0.015;

/** An anatomical range, in degrees from straight, as seen from the rest pose. */
function fromRest(range: [number, number], restBend: number): [number, number] {
  const round = (v: number): number => Math.round(v * 10) / 10;
  return [round(range[0] - restBend), round(range[1] - restBend)];
}

/** How far a child bone turns from its parent, signed about the hinge axis. */
function bendBetween(parent: Vec3, child: Vec3, axis: Vec3): number {
  const u = unit(parent);
  const v = unit(child);
  const k = unit(axis);
  const cross: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const side = cross[0] * k[0] + cross[1] * k[1] + cross[2] * k[2];
  const along = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return (Math.atan2(side, along) * 180) / Math.PI;
}

function unit(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** Turn a direction about an axis (Rodrigues), for a joint that rests bent. */
function turn(v: Vec3, axis: Vec3, degrees: number): Vec3 {
  const a = (degrees * Math.PI) / 180;
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const [kx, ky, kz] = [axis[0] / n, axis[1] / n, axis[2] / n];
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dot = kx * v[0] + ky * v[1] + kz * v[2];
  const cross: Vec3 = [ky * v[2] - kz * v[1], kz * v[0] - kx * v[2], kx * v[1] - ky * v[0]];
  return [
    v[0] * c + cross[0] * s + kx * dot * (1 - c),
    v[1] * c + cross[1] * s + ky * dot * (1 - c),
    v[2] * c + cross[2] * s + kz * dot * (1 - c),
  ];
}

/**
 * A bone's local X the way the app derives it: the hinted world axis,
 * squared up to the bone. The joint that rests bent turns about this.
 */
function localX(dir: Vec3, hint: Vec3): Vec3 {
  const d = dir[0] * hint[0] + dir[1] * hint[1] + dir[2] * hint[2];
  const x: Vec3 = [hint[0] - dir[0] * d, hint[1] - dir[1] * d, hint[2] - dir[2] * d];
  const n = Math.hypot(x[0], x[1], x[2]) || 1;
  return [x[0] / n, x[1] / n, x[2] / n];
}

/** Euler ranges in degrees, [min, max] per local axis; [0, 0] locks an axis. */
export interface JointLimits {
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

export interface BoneDef {
  name: string;
  /** Parent bone name; the root has none and moves with the gizmo instead. */
  parent: string | null;
  /** Rest joint position, metres. */
  head: Vec3;
  /** Rest end position, metres: local +Y points from head to tail. */
  tail: Vec3;
  /** Which world axis local X follows (mirrored on the right side). */
  hint: 'x' | 'y' | 'z';
  limits: JointLimits;
  /** The block for this bone: cross-section in metres; length follows the bone. */
  part: { width: number; depth: number; length?: number } | null;
  /** The bone on the other side, when there is one (L/R pairs). */
  mirror: string | null;
  /** Ordinary joint, a hinge (one ring in the gizmo), or the root. */
  kind: 'root' | 'ball' | 'hinge';
}

/**
 * An IK handle: a point you drag, the bone whose far end follows it, and
 * the bones that bend to get it there (nearest the handle first). The
 * effector itself is not a link - the hand's own rotation is yours to set.
 */
export interface IKChainDef {
  id: string;
  label: string;
  effector: string;
  links: string[];
  mirror: string | null;
  /**
   * Where the hinge points when its aim is zero, as a world direction: a
   * knee forward, an elbow back. The aim angle swings the bend around the
   * limb from there, which is what keeps a solved leg from choosing its
   * own plane (the "pole vector" of a rigged limb).
   */
  poleRef?: Vec3;
}

export interface RigDefinition {
  id: string;
  label: string;
  /** Overall height, metres, for framing and the scene scale. */
  height: number;
  bones: BoneDef[];
  /** The handles this rig offers; absent means posing by joint only. */
  ik: IKChainDef[];
}

/** The presets on offer; the owner's own figures join this list. */
export const RIG_PRESETS: Array<{ id: string; label: string }> = [
  { id: 'placeholder-male', label: 'Male (placeholder blocks)' },
  { id: 'placeholder-female', label: 'Female (placeholder blocks)' },
];

export function rigById(id: string): RigDefinition {
  return id === 'placeholder-female' ? placeholderHuman('female') : placeholderHuman('male');
}

const deg = (min: number, max: number): [number, number] => [min, max];
const NONE: [number, number] = [0, 0];

interface Body {
  height: number;
  shoulderHalf: number; // clavicle reach from the spine
  hipHalf: number; // thigh head offset from the centre
  pelvisWidth: number;
  chestWidth: number;
  headSize: number;
  armThick: number;
  legThick: number;
}

const MALE: Body = {
  height: 1.8,
  shoulderHalf: 0.19,
  hipHalf: 0.1,
  pelvisWidth: 0.34,
  chestWidth: 0.38,
  headSize: 0.2,
  armThick: 0.1,
  legThick: 0.16,
};

const FEMALE: Body = {
  height: 1.68,
  shoulderHalf: 0.165,
  hipHalf: 0.105,
  pelvisWidth: 0.36,
  chestWidth: 0.32,
  headSize: 0.19,
  armThick: 0.085,
  legThick: 0.15,
};

/**
 * A placeholder human: boxes on an eight-head canon in an A-pose - arms 40
 * degrees below horizontal, and neither the elbows nor the knees locked
 * straight. Left is +X. The right side is the mirror of the left, built by
 * the same code with x negated.
 */
export function placeholderHuman(sex: 'male' | 'female'): RigDefinition {
  const b = sex === 'male' ? MALE : FEMALE;
  const h = b.height / 1.8; // everything below is drawn for 1.80 m and scaled
  const s = (v: number): number => v * h;
  const bones: BoneDef[] = [];
  const add = (d: BoneDef): void => {
    bones.push(d);
  };

  // --- the centre line ---------------------------------------------------
  add({
    name: 'pelvis',
    parent: null,
    head: [0, s(1.0), 0],
    tail: [0, s(1.1), 0],
    hint: 'x',
    limits: { x: NONE, y: NONE, z: NONE },
    part: { width: b.pelvisWidth * h, depth: s(0.22), length: s(0.2) },
    mirror: null,
    kind: 'root',
  });
  add({
    name: 'spine',
    parent: 'pelvis',
    head: [0, s(1.1), 0],
    tail: [0, s(1.3), 0],
    hint: 'x',
    limits: { x: deg(-35, 30), y: deg(-30, 30), z: deg(-25, 25) },
    part: { width: s(0.28), depth: s(0.2) },
    mirror: null,
    kind: 'ball',
  });
  add({
    name: 'chest',
    parent: 'spine',
    head: [0, s(1.3), 0],
    tail: [0, s(1.5), 0],
    hint: 'x',
    limits: { x: deg(-25, 25), y: deg(-30, 30), z: deg(-20, 20) },
    part: { width: b.chestWidth * h, depth: s(0.24) },
    mirror: null,
    kind: 'ball',
  });
  add({
    name: 'neck',
    parent: 'chest',
    head: [0, s(1.52), 0],
    tail: [0, s(1.6), 0],
    hint: 'x',
    limits: { x: deg(-30, 40), y: deg(-50, 50), z: deg(-30, 30) },
    part: { width: s(0.11), depth: s(0.11) },
    mirror: null,
    kind: 'ball',
  });
  add({
    name: 'head',
    parent: 'neck',
    head: [0, s(1.6), 0],
    tail: [0, s(1.8), 0],
    hint: 'x',
    limits: { x: deg(-40, 30), y: deg(-60, 60), z: deg(-35, 35) },
    part: { width: b.headSize * 0.8 * h, depth: b.headSize * h, length: b.headSize * 1.1 * h },
    mirror: null,
    kind: 'ball',
  });

  // --- a side, then its mirror ---------------------------------------------
  const side = (sign: 1 | -1): void => {
    const sfx = sign > 0 ? '.L' : '.R';
    const other = sign > 0 ? '.R' : '.L';
    const X = (v: number): number => sign * s(v);
    // The upper arm runs 40 degrees below horizontal; the forearm carries
    // on from the elbow, a few degrees into its bend.
    const armDir: Vec3 = [
      sign * Math.cos((40 * Math.PI) / 180),
      -Math.sin((40 * Math.PI) / 180),
      0,
    ];
    const foreDir = turn(armDir, localX(armDir, [1, 0, 0]), -ELBOW_REST);
    const step = (from: Vec3, dir: Vec3, len: number): Vec3 => [
      from[0] + dir[0] * s(len),
      from[1] + dir[1] * s(len),
      from[2] + dir[2] * s(len),
    ];
    const shoulder: Vec3 = [X(b.shoulderHalf + 0.02), s(1.48), 0];
    const elbow = step(shoulder, armDir, 0.3);
    const wrist = step(elbow, foreDir, 0.27);
    const fingertip = step(wrist, foreDir, 0.18);
    add({
      name: 'clavicle' + sfx,
      parent: 'chest',
      head: [X(0.02), s(1.48), 0],
      tail: [X(b.shoulderHalf + 0.02), s(1.49), 0],
      hint: 'y',
      limits: { x: deg(-15, 15), y: deg(-10, 10), z: deg(-20, 30) },
      part: { width: s(0.05), depth: s(0.05) },
      mirror: 'clavicle' + other,
      kind: 'ball',
    });
    add({
      name: 'upperarm' + sfx,
      parent: 'clavicle' + sfx,
      head: shoulder,
      tail: elbow,
      hint: 'x',
      limits: { x: deg(-100, 100), y: deg(-90, 90), z: deg(-110, 110) },
      part: { width: b.armThick * h, depth: b.armThick * h },
      mirror: 'upperarm' + other,
      kind: 'ball',
    });
    add({
      name: 'forearm' + sfx,
      parent: 'upperarm' + sfx,
      head: elbow,
      tail: wrist,
      hint: 'x',
      // A hinge: bends forward, with a little twist. It rests bent, so the
      // range it can still reach is measured from there.
      limits: { x: fromRest(deg(-150, 0), -ELBOW_REST), y: deg(-45, 45), z: NONE },
      part: { width: b.armThick * 0.85 * h, depth: b.armThick * 0.85 * h },
      mirror: 'forearm' + other,
      kind: 'hinge',
    });
    add({
      name: 'hand' + sfx,
      parent: 'forearm' + sfx,
      head: wrist,
      tail: fingertip,
      hint: 'x',
      limits: { x: deg(-70, 70), y: deg(-30, 30), z: deg(-35, 35) },
      part: { width: s(0.09), depth: s(0.035) },
      mirror: 'hand' + other,
      kind: 'ball',
    });

    // The leg rests with its knee a little forward rather than locked
    // straight. Turning the shin would have swung the foot backwards
    // instead, so the hip and the ankle stay where the figure stands and
    // the KNEE is the thing that moves - which is also what a relaxed leg
    // does. A centimetre and a half of it is about four degrees; the exact
    // angle is measured below rather than assumed, since it follows from
    // the proportions.
    const hip: Vec3 = [X(b.hipHalf), s(0.98), 0];
    const knee: Vec3 = [X(b.hipHalf + 0.03), s(0.52), s(KNEE_FORWARD)];
    const ankle: Vec3 = [X(b.hipHalf + 0.04), s(0.1), 0];
    const toe: Vec3 = [X(b.hipHalf + 0.04), s(0.03), s(0.2)];
    const thighDir: Vec3 = [knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]];
    const shinDir: Vec3 = [ankle[0] - knee[0], ankle[1] - knee[1], ankle[2] - knee[2]];
    const kneeBend = bendBetween(thighDir, shinDir, localX(shinDir, [1, 0, 0]));
    add({
      name: 'thigh' + sfx,
      parent: 'pelvis',
      head: hip,
      tail: knee,
      hint: 'x',
      // Forward a long way, back a little, out to the side more than in.
      limits: { x: deg(-120, 30), y: deg(-45, 45), z: deg(-20, 60) },
      part: { width: b.legThick * h, depth: b.legThick * h },
      mirror: 'thigh' + other,
      kind: 'ball',
    });
    add({
      name: 'shin' + sfx,
      parent: 'thigh' + sfx,
      head: knee,
      tail: ankle,
      hint: 'x',
      // A hinge: the foot swings back, with a little twist, from a knee
      // that already rests a few degrees in.
      limits: { x: fromRest(deg(0, 150), kneeBend), y: deg(-15, 15), z: NONE },
      part: { width: b.legThick * 0.7 * h, depth: b.legThick * 0.7 * h },
      mirror: 'shin' + other,
      kind: 'hinge',
    });
    add({
      name: 'foot' + sfx,
      parent: 'shin' + sfx,
      head: ankle,
      tail: toe,
      hint: 'x',
      limits: { x: deg(-45, 30), y: deg(-20, 20), z: deg(-20, 20) },
      part: { width: s(0.1), depth: s(0.07) },
      mirror: 'foot' + other,
      kind: 'ball',
    });
  };
  side(1);
  side(-1);

  const BACK: Vec3 = [0, 0, -1];
  const FORWARD: Vec3 = [0, 0, 1];
  const ik: IKChainDef[] = [
    { id: 'hand.L', label: 'Left hand', effector: 'hand.L', links: ['forearm.L', 'upperarm.L', 'clavicle.L'], mirror: 'hand.R', poleRef: BACK },
    { id: 'hand.R', label: 'Right hand', effector: 'hand.R', links: ['forearm.R', 'upperarm.R', 'clavicle.R'], mirror: 'hand.L', poleRef: BACK },
    { id: 'foot.L', label: 'Left foot', effector: 'foot.L', links: ['shin.L', 'thigh.L'], mirror: 'foot.R', poleRef: FORWARD },
    { id: 'foot.R', label: 'Right foot', effector: 'foot.R', links: ['shin.R', 'thigh.R'], mirror: 'foot.L', poleRef: FORWARD },
    { id: 'head', label: 'Head', effector: 'head', links: ['neck', 'chest'], mirror: null },
  ];

  return {
    id: sex === 'male' ? 'placeholder-male' : 'placeholder-female',
    label: sex === 'male' ? 'Male (placeholder blocks)' : 'Female (placeholder blocks)',
    height: b.height,
    bones,
    ik,
  };
}
