import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';

/**
 * Brush cursor (plan 7.6). Two representations share one API:
 *
 * - On a surface hit, a 3D ring aligned to the picked normal, drawn in the
 *   scene at the intersection point: circle at the world brush radius, a
 *   center dot, and a line along the normal whose length shows strength
 *   (radius x intensity, i.e. 10x the standard brush's true displacement).
 * - Off the mesh, a screen-space SVG fallback ring at the pointer.
 *
 * While the user holds b/s to adjust, the cursor anchors: the surface (or
 * screen position) freezes and the ring/line update in place. Materials draw
 * with depthTest off and a late renderOrder, so the ring stays legible over
 * the mesh regardless of the composite (cavity/AO never touch line color
 * meaningfully).
 */

const ACCENT = 0xbb5b33;
/** Smoothing reads as water-on-clay: the cursor cools to blue. */
const SMOOTH_BLUE = 0x4d8fd1;
const RING_SEGMENTS = 64;

export class BrushCursor {
  // Screen-space fallback (SVG).
  private readonly root: SVGSVGElement;
  private readonly circle: SVGCircleElement;
  private readonly dot: SVGCircleElement;
  private readonly line: SVGLineElement;

  // Surface-aligned representation (scene objects).
  private readonly group = new Group();
  private readonly ring3d: Line;
  private readonly dot3d: Line;
  private readonly strengthLine: Line;
  private readonly up = new Vector3(0, 0, 1);
  private readonly quat = new Quaternion();
  private readonly normal = new Vector3();

  private anchored = false;
  private x = 0;
  private y = 0;
  private intensity = 0.5;
  private mat!: LineBasicMaterial;
  private ringMat!: LineBasicMaterial;

  constructor(container: HTMLElement, private readonly scene: Scene) {
    const NS = 'http://www.w3.org/2000/svg';
    this.root = document.createElementNS(NS, 'svg');
    this.root.setAttribute('class', 'sculpt-cursor');
    this.circle = document.createElementNS(NS, 'circle');
    this.circle.setAttribute('class', 'sculpt-cursor__ring');
    this.dot = document.createElementNS(NS, 'circle');
    this.dot.setAttribute('class', 'sculpt-cursor__dot');
    this.dot.setAttribute('r', '2');
    this.line = document.createElementNS(NS, 'line');
    this.line.setAttribute('class', 'sculpt-cursor__strength');
    this.root.append(this.circle, this.dot, this.line);
    this.root.style.display = 'none';
    container.appendChild(this.root);

    const mat = new LineBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    this.mat = mat;
    // The ring dims independently mid-stroke; the dot stays the anchor.
    this.ringMat = mat.clone();

    // Closed circles as plain Lines (first point repeated): WebGPURenderer
    // does not draw LineLoop. Unit radius; group scale carries the world size.
    const circlePoints = (segments: number, radius: number): Float32Array => {
      const out = new Float32Array((segments + 1) * 3);
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        out[i * 3] = Math.cos(a) * radius;
        out[i * 3 + 1] = Math.sin(a) * radius;
      }
      return out;
    };
    const ringGeom = new BufferGeometry();
    ringGeom.setAttribute('position', new BufferAttribute(circlePoints(RING_SEGMENTS, 1), 3));
    this.ring3d = new Line(ringGeom, this.ringMat);

    // Center dot: a tiny fixed-fraction circle of the ring radius.
    const dotGeom = new BufferGeometry();
    dotGeom.setAttribute('position', new BufferAttribute(circlePoints(12, 0.03), 3));
    this.dot3d = new Line(dotGeom, mat);

    // Strength line along local +Z (the picked normal after orientation);
    // its z-scale is the intensity, so world length = radius x intensity.
    const lineGeom = new BufferGeometry();
    lineGeom.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 1]), 3));
    this.strengthLine = new Line(lineGeom, mat);

    this.group.add(this.ring3d, this.dot3d, this.strengthLine);
    this.group.visible = false;
    this.group.renderOrder = 999;
    this.group.traverse((o) => {
      o.frustumCulled = false;
      o.renderOrder = 999;
    });
    scene.add(this.group);
  }

  /** Track the pointer (CSS px, container-relative), unless anchored. */
  moveTo(x: number, y: number): void {
    if (this.anchored) return;
    this.x = x;
    this.y = y;
    this.layout();
  }

  /**
   * Surface under the cursor, in world space (point, unit normal, brush
   * radius), or null when the pointer is off the mesh. Chooses which
   * representation shows. Ignored while anchored.
   */
  setSurface(
    point: [number, number, number] | null,
    normal?: [number, number, number],
    worldRadius?: number,
  ): void {
    if (this.anchored) return;
    if (!point || !normal || !worldRadius) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.root.style.display = 'none';
    this.group.position.set(point[0], point[1], point[2]);
    this.normal.set(normal[0], normal[1], normal[2]).normalize();
    this.quat.setFromUnitVectors(this.up, this.normal);
    this.group.quaternion.copy(this.quat);
    this.group.scale.setScalar(Math.max(worldRadius, 1e-4));
    this.strengthLine.scale.z = this.intensity;
  }

  /** Freeze (b/s adjust) or release the cursor position. */
  setAnchored(anchored: boolean): void {
    this.anchored = anchored;
  }

  /** Smooth active (tool 7 or held shift): the whole cursor turns blue. */
  setSmoothing(on: boolean): void {
    const hex = on ? SMOOTH_BLUE : ACCENT;
    this.mat.color.setHex(hex);
    this.ringMat.color.setHex(hex);
    this.root.classList.toggle('is-smooth', on);
  }

  /**
   * Mid-stroke reduction (ZBrush-style, WS2 review): while the stroke is
   * down, sculpt brushes keep only the center dot so the deforming surface
   * stays readable; Smooth keeps its ring but dimmed (the outline matters
   * there, obtrusiveness does not). The strength line rests either way.
   * null restores the full hover cursor.
   */
  setStrokeStyle(style: null | 'dot' | 'dim'): void {
    this.ring3d.visible = style !== 'dot';
    this.strengthLine.visible = style === null;
    this.ringMat.opacity = style === 'dim' ? 0.3 : 0.85;
    this.root.classList.toggle('is-dot-only', style === 'dot');
    this.root.classList.toggle('is-dim', style === 'dim');
  }

  /** Update to the tool's screen radius (CSS px) and strength (0..1). */
  setBrush(radiusCss: number, intensity: number): void {
    this.intensity = Math.min(1, Math.max(0, intensity));
    const r = Math.max(2, radiusCss);
    this.circle.setAttribute('r', String(r));
    this.line.setAttribute('y2', String(-r * this.intensity));
    this.strengthLine.scale.z = this.intensity;
    // While anchored on a surface, grow the 3D ring with the screen radius:
    // scale proportionally so the adjustment reads at the anchored spot.
    if (this.anchored && this.group.visible && this.lastAnchorCss > 0) {
      this.group.scale.setScalar(this.anchorWorldRadius * (r / this.lastAnchorCss));
    }
    this.layout();
  }

  private lastAnchorCss = 0;
  private anchorWorldRadius = 0;

  /** Record the radius pair at anchor time so b-adjust can rescale the ring. */
  beginAnchorScale(radiusCss: number): void {
    this.lastAnchorCss = Math.max(2, radiusCss);
    this.anchorWorldRadius = this.group.scale.x;
  }

  show(): void {
    if (!this.group.visible) this.root.style.display = '';
  }

  hide(): void {
    if (this.anchored) return;
    this.root.style.display = 'none';
    this.group.visible = false;
  }

  private layout(): void {
    this.root.style.transform = `translate(${this.x}px, ${this.y}px)`;
  }

  dispose(): void {
    this.root.remove();
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const mesh = o as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } };
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    });
  }
}
