/**
 * How the Armature mode draws its controls: outlines, the way animation
 * programs draw control curves, not filled balls.
 *
 *   ring    a reach handle: a circle that always faces the camera. Pinned,
 *           the same ring with a small filled dot in its middle.
 *   box     the root's: the wire box round the hips, in the pelvis's own frame.
 *   arrow   a pole or look-at target: an arrowhead outline, turned on the
 *           page to point away from the joint or the head it belongs to.
 *   dash    the thin dashed line from that joint to its target.
 *   floor   the ring under a planted foot, flat on the floor.
 *
 * Every shape is drawn by its fragment shader from a distance in CSS
 * pixels, so a stroke is 2 px at every zoom and on every screen, with a
 * thin dark casing that reads over pale clay and over the dark ground, and
 * the same on the WebGPU backend and on the WebGL2 fallback (a line's width
 * is 1 px on both, and a quad is the one thing that is the same on both).
 * The quads are placed by the vertex shader from the camera, so a moving
 * view needs no work from the page: sizes in pixels hold themselves.
 *
 * Handles are neutral (the interface's light grey; white under the pointer)
 * and orange - the interface's one colour for the thing in hand - only
 * while selected or dragged.
 */
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Mesh, PlaneGeometry, Vector2, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  fwidth,
  length,
  max,
  min,
  mix,
  modelWorldMatrix,
  mrt,
  mod,
  positionGeometry,
  screenDPR,
  uniform,
  uv,
  varying,
  vec2,
  vec4,
} from 'three/tsl';

export type HandleShape = 'ring' | 'box' | 'arrow' | 'dash' | 'floor';
export type HandleState = 'rest' | 'hover' | 'hot';

/** Sizes in CSS pixels. */
export const RING_RADIUS = 22;
const RING_HALF = RING_RADIUS + 6;
const DOT_RADIUS = RING_RADIUS * 0.31;
const ARROW_HALF = 16;
/** The arrowhead: its tip, the depth of its base below the middle, and half its base. */
const ARROW_TIP = 11;
const ARROW_BASE = 8;
const ARROW_WING = 9.5;
/** Half the width of the strip a dashed line is cut from, and the dash and its gap. */
const DASH_HALF = 3;
const DASH_LENGTH = 5;
const DASH_PERIOD = 9;
/** How far short of the arrow's middle the dashes stop, so they end at its base. */
const DASH_STOP = ARROW_BASE;
/** The dark casing on each side of a stroke. */
const EDGE_PX = 1.25;
/** Stroke widths in CSS pixels at rest and selected or dragged. */
const STROKE = { rest: 2, hot: 3 };
const DASH_STROKE = { rest: 1, hot: 1.6 };

/** The interface's colours (src/app-layer/tokens.css), read once; the fallbacks are the same values. */
function tokens(): { rest: string; hover: string; hot: string; edge: string } {
  const read = (name: string, fallback: string): string => {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    rest: read('--bz-text-2', '#b3b3b3'),
    hover: read('--bz-white', '#ffffff'),
    hot: read('--bz-orange', '#ff5a1f'),
    edge: read('--bz-strip', '#1b1b1b'),
  };
}

// Shared by every handle's material: the page size the shaders measure pixels against.
const viewCss = uniform(new Vector2(1, 1));
const edgeColour = uniform(new Color('#1b1b1b'));

/** Tell the shaders how big the canvas is on the page, in CSS pixels. */
export function setHandleViewport(width: number, height: number): void {
  viewCss.value.set(Math.max(1, width), Math.max(1, height));
}

export interface HandleView {
  name: string;
  shape: HandleShape;
  mesh: Mesh;
  material: MeshBasicNodeMaterial;
  /** What the shaders read: stroke colour, stroke width in px, the pinned dot (0 or 1). */
  colour: { value: Color };
  thick: { value: number };
  dot: { value: number };
  /** Arrow: the joint or head it points away from. Dash: its two ends. */
  toward: { value: Vector3 };
  from: { value: Vector3 };
  state: HandleState;
}

/** TSL's typings are exact to each expression's shape; the shaders here are written against this loose one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tsl = any;

const toClip = (world: Tsl): Tsl => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1));

/** A signed distance in px (negative inside the stroke) painted: light stroke, dark casing, soft edges. */
const paint = (d: Tsl, stroke: Tsl, edge: Tsl): { rgb: Tsl; alpha: Tsl } => {
  const aa = max(fwidth(d), float(0.0001));
  const inside = clamp(float(0.5).sub(d.div(aa)), 0, 1);
  const outside = clamp(float(0.5).sub(d.sub(edge).div(aa)), 0, 1);
  return {
    rgb: mix(edgeColour, stroke, clamp(inside.div(max(outside, float(0.001))), 0, 1)),
    alpha: outside,
  };
};

/** The shapes' materials and the one quad they are drawn on; dispose when the mode ends. */
/** The twelve edges of the cube from -1 to 1, each a four-corner strip (see the box shape). */
function cubeEdgeGeometry(): BufferGeometry {
  const corner = (i: number): number[] => [i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1];
  const a: number[] = [];
  const b: number[] = [];
  const side: number[] = [];
  const index: number[] = [];
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      const base = a.length / 3;
      for (const [along, across] of [[0, -1], [0, 1], [1, 1], [1, -1]]) {
        a.push(...corner(i));
        b.push(...corner(i | bit));
        side.push(along, across);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(new Array(a.length).fill(0), 3));
  g.setAttribute('edgeA', new Float32BufferAttribute(a, 3));
  g.setAttribute('edgeB', new Float32BufferAttribute(b, 3));
  g.setAttribute('side', new Float32BufferAttribute(side, 2));
  g.setIndex(index);
  return g;
}

/** The shapes' materials and the one quad they are drawn on; dispose when the mode ends. */
export class HandleKit {
  private readonly quad = new PlaneGeometry(2, 2);
  private readonly floorQuad = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  private readonly cubeEdges = cubeEdgeGeometry();
  private readonly made: HandleView[] = [];
  private readonly colours = tokens();

  constructor() {
    edgeColour.value.set(this.colours.edge);
  }

  create(shape: HandleShape, name: string): HandleView {
    const colour = uniform(new Color(this.colours.rest));
    const thick = uniform(STROKE.rest);
    const pin = uniform(0);
    const toward = uniform(new Vector3());
    const from = uniform(new Vector3());
    const material = new MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthTest = shape === 'floor';
    material.depthWrite = false;
    material.side = DoubleSide;
    material.toneMapped = false;
    material.fog = false;
    const centre = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;
    const local = uv().mul(2).sub(1);
    const edge = float(EDGE_PX);
    let out: { rgb: Tsl; alpha: Tsl };

    if (shape === 'ring') {
      const clip = toClip(centre);
      const offset = positionGeometry.xy.mul(RING_HALF * 2).div(viewCss);
      material.vertexNode = vec4(clip.xy.add(offset.mul(clip.w)), clip.z, clip.w);
      const p = local.mul(RING_HALF);
      const r = length(p);
      const ring = abs(r.sub(RING_RADIUS)).sub(thick.mul(0.5));
      const centreDot = r.sub(DOT_RADIUS).add(float(1).sub(pin).mul(1000));
      out = paint(min(ring, centreDot), colour, edge);
    } else if (shape === 'box') {
      // The twelve edges of a unit cube carried by the mesh's own matrix,
      // each a strip between its two ends, a fixed width on the page.
      const ea = attribute('edgeA', 'vec3');
      const eb = attribute('edgeB', 'vec3');
      const side = attribute('side', 'vec2');
      const a = toClip(modelWorldMatrix.mul(vec4(ea, 1)).xyz);
      const b = toClip(modelWorldMatrix.mul(vec4(eb, 1)).xyz);
      const pa = a.xy.div(a.w).mul(viewCss).mul(0.5);
      const pb = b.xy.div(b.w).mul(viewCss).mul(0.5);
      const d = pb.sub(pa);
      const dir = d.div(max(length(d), float(0.0001)));
      const across = vec2(dir.y.negate(), dir.x);
      const spot = pa.add(d.mul(side.x)).add(across.mul(side.y.mul(DASH_HALF)));
      material.vertexNode = vec4(spot.div(viewCss.mul(0.5)), 0.5, 1);
      const band = abs(varying(side.y).mul(DASH_HALF)).sub(thick.mul(0.5));
      out = paint(band, colour, edge);
    } else if (shape === 'arrow') {
      // The quad is turned on the page so its +y points away from the joint or head it belongs to.
      const clipC = toClip(centre);
      const clipJ = toClip(toward);
      const ndcDelta = clipJ.xy.div(clipJ.w).sub(clipC.xy.div(clipC.w));
      const px = ndcDelta.mul(viewCss).mul(0.5);
      const len = length(px);
      // Pointing away from the joint, the way it aims: the quad's +y is the direction from the joint.
      const dir = mix(vec2(0, 1), px.div(max(len, float(0.0001))), clamp(len.mul(1000), 0, 1)).negate();
      const right = vec2(dir.y, dir.x.negate());
      const spot = positionGeometry.xy.mul(ARROW_HALF);
      const turned = right.mul(spot.x).add(dir.mul(spot.y));
      const offset = turned.mul(2).div(viewCss);
      material.vertexNode = vec4(clipC.xy.add(offset.mul(clipC.w)), clipC.z, clipC.w);
      const p = local.mul(ARROW_HALF);
      const run = Math.hypot(ARROW_TIP + ARROW_BASE, ARROW_WING);
      const tip = vec2(0, ARROW_TIP);
      const left = vec2(-(ARROW_TIP + ARROW_BASE) / run, ARROW_WING / run);
      const rightEdge = vec2((ARROW_TIP + ARROW_BASE) / run, ARROW_WING / run);
      const sides = max(dot(p.sub(tip), left), dot(p.sub(tip), rightEdge));
      const head = max(p.y.negate().sub(ARROW_BASE), sides);
      out = paint(abs(head).sub(thick.mul(0.5)), colour, edge);
    } else if (shape === 'dash') {
      // A strip between two world points, cut into dashes, stopping short of the arrow at its far end.
      const a = toClip(from);
      const b = toClip(toward);
      const pa = a.xy.div(a.w).mul(viewCss).mul(0.5);
      const pb = b.xy.div(b.w).mul(viewCss).mul(0.5);
      const d = pb.sub(pa);
      const len = length(d);
      const dir = d.div(max(len, float(0.0001)));
      const across = vec2(dir.y.negate(), dir.x);
      const along = positionGeometry.x.mul(0.5).add(0.5);
      const spot = pa.add(d.mul(along)).add(across.mul(positionGeometry.y.mul(DASH_HALF)));
      material.vertexNode = vec4(spot.div(viewCss.mul(0.5)), 0.5, 1);
      const lenPx = varying(len);
      const s = uv().x.mul(lenPx);
      const t = abs(mod(s, float(DASH_PERIOD)).sub(DASH_PERIOD / 2)).sub(DASH_LENGTH / 2);
      const band = abs(uv().y.mul(2).sub(1).mul(DASH_HALF)).sub(thick.mul(0.5));
      const stop = s.sub(lenPx.sub(DASH_STOP));
      out = paint(max(max(t, band), stop), colour, edge);
    } else {
      // On the floor, in world space: pixels from how fast the radius changes under the pixel.
      const r = length(local);
      const ringAt = 1 / 1.1;
      const px = abs(r.sub(ringAt)).div(max(fwidth(r), float(0.00001)));
      out = paint(px.sub(thick.mul(screenDPR).mul(0.5)), colour, edge.mul(screenDPR));
    }
    material.colorNode = out.rgb;
    material.opacityNode = out.alpha;
    // Into the scene pass's colour alone: a handle is no surface, so the
    // normals the ambient occlusion reads (and the wire target) are left as
    // the figure left them, where an alpha of 0 under the blending keeps
    // what is there. Written over the whole quad, they put a dark box round
    // every handle.
    material.mrtNode = mrt({ output: vec4(out.rgb, out.alpha), normal: vec4(0, 0, 0, 0), wire: vec4(0, 0, 0, 0) }) as unknown as typeof material.mrtNode;
    const mesh = new Mesh(shape === 'floor' ? this.floorQuad : shape === 'box' ? this.cubeEdges : this.quad, material);
    if (shape === 'box') mesh.matrixAutoUpdate = false;
    mesh.name = name;
    mesh.renderOrder = shape === 'floor' ? 20 : 30;
    mesh.frustumCulled = false;
    const handle: HandleView = {
      name,
      shape,
      mesh,
      material,
      colour: colour as unknown as { value: Color },
      thick: thick as unknown as { value: number },
      dot: pin as unknown as { value: number },
      toward: toward as unknown as { value: Vector3 },
      from: from as unknown as { value: Vector3 },
      state: 'rest',
    };
    this.made.push(handle);
    return handle;
  }

  /** Neutral at rest, white under the pointer, orange (and thicker) when selected or dragged. */
  paint(h: HandleView, state: HandleState, pinned = false): void {
    h.state = state;
    h.colour.value.set(state === 'hot' ? this.colours.hot : state === 'hover' ? this.colours.hover : this.colours.rest);
    const widths = h.shape === 'dash' ? DASH_STROKE : STROKE;
    h.thick.value = state === 'hot' ? widths.hot : widths.rest;
    h.dot.value = pinned ? 1 : 0;
  }

  /** What a handle is drawn as right now, read back from what the shaders read. */
  look(h: HandleView): { shape: HandleShape; state: HandleState; colour: string; thick: number; dot: boolean } {
    return {
      shape: h.shape,
      state: h.state,
      colour: h.colour.value.getHexString(),
      thick: h.thick.value,
      dot: h.dot.value > 0.5,
    };
  }

  /** The three colours, as hex without the hash: for tests that read the scene. */
  palette(): { rest: string; hover: string; hot: string; edge: string } {
    const hex = (s: string): string => new Color(s).getHexString();
    return { rest: hex(this.colours.rest), hover: hex(this.colours.hover), hot: hex(this.colours.hot), edge: hex(this.colours.edge) };
  }

  /** Let a handle go (a figure change builds new ones). */
  release(h: HandleView): void {
    h.mesh.removeFromParent();
    h.material.dispose();
    const i = this.made.indexOf(h);
    if (i >= 0) this.made.splice(i, 1);
  }

  dispose(): void {
    for (const h of this.made) {
      h.mesh.removeFromParent();
      h.material.dispose();
    }
    this.made.length = 0;
    this.quad.dispose();
    this.floorQuad.dispose();
    this.cubeEdges.dispose();
  }
}
