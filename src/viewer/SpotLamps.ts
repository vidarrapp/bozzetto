import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  type PerspectiveCamera,
  Ray,
  Vector3,
  type Box3,
} from 'three';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { SPOT_IDS, type Lighting, type SpotId } from './Lighting';

/** The lamp's size in the scene, in centimetres: a short shade with its small end at the light. */
const LAMP_LENGTH = 9;
const LAMP_FRONT = 4;
const LAMP_BACK = 2.2;
/** A press this close to a lamp, in CSS pixels, is on it (a finger's reach). */
const LAMP_REACH_PX = 28;
/** The longest the cone's outline is drawn, in cm (the scene's units). */
const CONE_REACH = 30;
const QUIET = '#a3a3a3';
const CONE_SEGMENTS = 48;
const CONE_SPOKES = 8;

interface Lamp {
  group: Group;
  body: Mesh;
  cone: LineSegments;
}

/** A unit cone for the outline: the apex at the origin, a circle of radius 1 at z = 1, and spokes between. */
function coneGeometry(): BufferGeometry {
  const pts: number[] = [];
  const at = (i: number): [number, number] => [Math.cos((i / CONE_SEGMENTS) * Math.PI * 2), Math.sin((i / CONE_SEGMENTS) * Math.PI * 2)];
  for (let i = 0; i < CONE_SEGMENTS; i++) {
    const [x0, y0] = at(i);
    const [x1, y1] = at(i + 1);
    pts.push(x0, y0, 1, x1, y1, 1);
  }
  for (let i = 0; i < CONE_SPOKES; i++) {
    const [x, y] = at((i * CONE_SEGMENTS) / CONE_SPOKES);
    pts.push(0, 0, 0, x, y, 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  return g;
}

/**
 * The spot lights drawn in the scene (owner's rule for lights that have a
 * place): a small lamp at the spot's position pointing along its aim, and
 * the cone's outline out to the aim, in real units. They are scene objects
 * drawn into the wire overlay's target (Viewer.buildPipeline), so the model
 * hides them where it is in front and GTAO never sees them; the picked
 * one is orange, the others grey. Shown in Present only, and never while a
 * picture is made (the Viewer hides the group for every capture and
 * readback).
 */
export class SpotLamps {
  readonly group = new Group();
  private readonly quiet = { mesh: new MeshBasicNodeMaterial({ color: QUIET, transparent: true, opacity: 1, depthWrite: false }), line: new LineBasicNodeMaterial({ color: QUIET, transparent: true, opacity: 1, depthWrite: false }) };
  private readonly hot = { mesh: new MeshBasicNodeMaterial({ color: '#ff5a1f', transparent: true, opacity: 1, depthWrite: false }), line: new LineBasicNodeMaterial({ color: '#ff5a1f', transparent: true, opacity: 1, depthWrite: false }) };
  /** Every material, for the pipeline to give its overlay target. */
  readonly materials = [this.quiet.mesh, this.quiet.line, this.hot.mesh, this.hot.line];
  private readonly lamps = new Map<SpotId, Lamp>();
  private readonly shade = (() => {
    // Along +z toward the aim: a cylinder's axis is y, turned onto z; the small end at the origin (the light), the shade behind it.
    const g = new CylinderGeometry(LAMP_FRONT, LAMP_BACK, LAMP_LENGTH, 20, 1, false);
    g.rotateX(Math.PI / 2); // axis onto z, top (radius LAMP_FRONT) toward +z
    g.translate(0, 0, -LAMP_LENGTH / 2);
    return g;
  })();
  private readonly cone = coneGeometry();
  private readonly pos = new Vector3();
  private readonly aim = new Vector3();
  private readonly tmp = new Vector3();
  private readonly ray = new Ray();
  private picked: SpotId | null = null;
  private wanted = false;
  private hidden = false;
  private hotColour = '';

  constructor() {
    this.group.name = 'spot-lamps';
    this.group.visible = false;
  }

  /** Present is up: the lamps are drawn. */
  setWanted(on: boolean): void {
    this.wanted = on;
    this.sync();
  }

  /** A picture is being made: they are not. */
  setHidden(on: boolean): void {
    this.hidden = on;
    this.sync();
  }

  setPicked(id: SpotId | null): void {
    this.picked = id;
    this.refreshColours();
  }

  private sync(): void {
    this.group.visible = this.wanted && !this.hidden;
  }

  isWanted(): boolean {
    return this.wanted;
  }

  isShown(): boolean {
    return this.group.visible;
  }

  /** The ids of the lamps drawn now, for the tests. */
  shownIds(): SpotId[] {
    return this.group.visible ? [...this.lamps.entries()].filter(([, l]) => l.group.visible).map(([id]) => id) : [];
  }

  private lampFor(id: SpotId): Lamp {
    let lamp = this.lamps.get(id);
    if (lamp) return lamp;
    const group = new Group();
    group.name = `spot-lamp-${id}`;
    const body = new Mesh(this.shade, this.quiet.mesh);
    const cone = new LineSegments(this.cone, this.quiet.line);
    for (const o of [body, cone]) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.frustumCulled = false;
      o.renderOrder = 3;
    }
    group.add(body, cone);
    this.group.add(group);
    lamp = { group, body, cone };
    this.lamps.set(id, lamp);
    return lamp;
  }

  /** Once a render: each spot's lamp where its light is, pointing at its aim, the cone to the aim. */
  update(lighting: Lighting): void {
    if (!this.wanted) return;
    for (const id of SPOT_IDS) {
      const placed = lighting.spotPlacement(id, this.pos, this.aim);
      const lamp = this.lamps.get(id);
      if (!placed) {
        if (lamp) lamp.group.visible = false;
        continue;
      }
      const l = lamp ?? this.lampFor(id);
      l.group.visible = true;
      l.group.position.copy(this.pos);
      l.group.lookAt(this.aim);
      // The outline shows the cone's direction and spread near the lamp, not all the way to the aim:
      // drawn to the aim it was a huge funnel across the view. A quarter of the way, at most CONE_REACH.
      const reach = Math.max(Math.min(this.pos.distanceTo(this.aim) * 0.25, CONE_REACH), 1e-3);
      const spread = reach * Math.tan(placed.angle);
      l.cone.scale.set(spread, spread, reach);
      l.cone.visible = placed.enabled;
      const hot = id === this.picked;
      const set = hot ? this.hot : this.quiet;
      if (l.body.material !== set.mesh) l.body.material = set.mesh;
      if (l.cone.material !== set.line) l.cone.material = set.line;
    }
  }

  /** The orange of the interface, read once the page has its theme. */
  refreshColours(): void {
    const orange = getComputedStyle(document.documentElement).getPropertyValue('--bz-orange').trim();
    if (orange && orange !== this.hotColour) {
      this.hotColour = orange;
      this.hot.mesh.color.set(orange);
      this.hot.line.color.set(orange);
    }
  }

  /**
   * The lamp under a press (client pixels), if the spot is in the view and
   * not behind the subject: the nearest within a finger's reach. A lamp
   * the subject's bounds hide is not reached, so a press on the model
   * always reaches the model.
   */
  hit(clientX: number, clientY: number, camera: PerspectiveCamera, rect: DOMRect, subject: Box3, lighting: Lighting): SpotId | null {
    // Wanted, not shown: a picture being made hides the lamps for a moment, and a press then still finds one.
    if (!this.wanted) return null;
    camera.updateMatrixWorld();
    let best: SpotId | null = null;
    let bestPx = LAMP_REACH_PX;
    for (const id of SPOT_IDS) {
      const placed = lighting.spotPlacement(id, this.pos, this.aim);
      if (!placed) continue;
      // The middle of the shade, a little back from the light.
      this.aim.sub(this.pos).normalize();
      this.tmp.copy(this.pos).addScaledVector(this.aim, -LAMP_LENGTH / 2);
      const world = this.tmp.clone();
      const p = world.clone().project(camera);
      if (!(p.z >= -1 && p.z <= 1)) continue;
      const x = rect.left + (p.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-p.y * 0.5 + 0.5) * rect.height;
      const px = Math.hypot(x - clientX, y - clientY);
      if (px > bestPx) continue;
      if (!subject.isEmpty()) {
        const dir = world.clone().sub(camera.position);
        const dist = dir.length();
        this.ray.set(camera.position, dir.normalize());
        const at = this.ray.intersectBox(subject, this.tmp.set(0, 0, 0));
        if (at && at.distanceTo(camera.position) < dist) continue;
      }
      bestPx = px;
      best = id;
    }
    return best;
  }

  dispose(): void {
    this.shade.dispose();
    this.cone.dispose();
    for (const m of this.materials) m.dispose();
  }
}
