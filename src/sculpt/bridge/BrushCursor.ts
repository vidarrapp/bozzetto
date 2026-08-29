/**
 * Brush cursor (plan 7.6, reworked in the WS2f behavior pass). One SVG
 * overlay draws every representation, with the surface-aligned ring built
 * by PROJECTING a world-space circle to screen each update:
 *
 * - On a surface hit: a ring around the picked point in the tangent plane,
 *   at the true world brush radius, plus a center dot and a strength line
 *   along the normal (length = radius x intensity).
 * - Off the mesh (only when the caller asks: Move's volumetric aim, b/s
 *   size adjustment): a screen-space ring at the pointer.
 *
 * Projection replaced the old scene-side Line ring deliberately: WebGPU
 * caps GL lines at one device pixel, which vanished on high-resolution
 * displays; an SVG stroke stays a crisp CSS-pixel width on every backend,
 * and one code path now styles, dims and hides all cursor pieces.
 *
 * Visibility policy lives in InputShell; this class renders what it is
 * told. `root.dataset.mode` mirrors the active representation for tests.
 */

const RING_SEGMENTS = 48;

type StrokeStyle = null | 'dot' | 'dim';

/** World -> container CSS px; null when the point is behind the camera. */
export type CursorProjector = (p: [number, number, number]) => [number, number] | null;

interface SurfaceState {
  point: [number, number, number];
  normal: [number, number, number];
  worldRadius: number;
}

export class BrushCursor {
  private readonly root: SVGSVGElement;
  private readonly ringPath: SVGPathElement;
  private readonly screenRing: SVGCircleElement;
  private readonly dot: SVGCircleElement;
  private readonly strength: SVGLineElement;

  private projector: CursorProjector | null = null;
  private surface: SurfaceState | null = null;
  private mode: 'hidden' | 'screen' | 'surface' = 'hidden';
  private anchored = false;
  private x = 0;
  private y = 0;
  private radiusCss = 50;
  private intensity = 0.5;
  private lastAnchorCss = 0;
  private anchorWorldRadius = 0;

  constructor(container: HTMLElement) {
    const NS = 'http://www.w3.org/2000/svg';
    this.root = document.createElementNS(NS, 'svg');
    this.root.setAttribute('class', 'sculpt-cursor');
    this.ringPath = document.createElementNS(NS, 'path');
    this.ringPath.setAttribute('class', 'sculpt-cursor__ring');
    this.screenRing = document.createElementNS(NS, 'circle');
    this.screenRing.setAttribute('class', 'sculpt-cursor__ring');
    this.dot = document.createElementNS(NS, 'circle');
    this.dot.setAttribute('class', 'sculpt-cursor__dot');
    this.dot.setAttribute('r', '2.5');
    this.strength = document.createElementNS(NS, 'line');
    this.strength.setAttribute('class', 'sculpt-cursor__strength');
    this.root.append(this.ringPath, this.screenRing, this.dot, this.strength);
    container.appendChild(this.root);
    this.applyMode('hidden');
  }

  /** Wire the world-to-screen projection (mode.ts supplies the camera). */
  setProjector(projector: CursorProjector): void {
    this.projector = projector;
  }

  /** Track the pointer (CSS px, container-relative), unless anchored. */
  moveTo(x: number, y: number): void {
    if (this.anchored) return;
    this.x = x;
    this.y = y;
    if (this.mode === 'screen') this.renderScreen();
  }

  /**
   * Surface under the cursor, in world space, or null to drop the surface
   * representation. Ignored while anchored (b/s adjustment freezes it).
   */
  setSurface(
    point: [number, number, number] | null,
    normal?: [number, number, number],
    worldRadius?: number,
  ): void {
    if (this.anchored) return;
    if (!point || !normal || !worldRadius) {
      this.surface = null;
      if (this.mode === 'surface') this.applyMode('hidden');
      return;
    }
    this.surface = { point, normal, worldRadius };
    this.applyMode('surface');
    this.renderSurface();
  }

  /** Screen-space ring at the pointer (Move's off-model aim, b/s adjust). */
  showScreen(): void {
    if (this.anchored) return;
    this.surface = null;
    this.applyMode('screen');
    this.renderScreen();
  }

  hide(): void {
    if (this.anchored) return;
    this.surface = null;
    this.applyMode('hidden');
  }

  /** Re-project the cached surface (camera moved under a still pointer). */
  refresh(): void {
    if (this.mode === 'surface' && this.surface) this.renderSurface();
  }

  private flashTimer = 0;
  private flashOwned = false;

  /**
   * Brief screen-ring feedback for keyboard size/strength nudges when
   * nothing else is showing (iPad pencils without hover never see the
   * ring otherwise). A visible surface ring already shows the change;
   * an existing screen ring (Move aim) just re-renders and stays.
   */
  flashScreen(ms: number): void {
    if (this.anchored || this.mode === 'surface') return;
    const created = this.mode === 'hidden';
    if (created) this.applyMode('screen');
    this.renderScreen();
    if (created) {
      this.flashOwned = true;
      clearTimeout(this.flashTimer);
      this.flashTimer = window.setTimeout(() => {
        if (this.flashOwned && this.mode === 'screen') this.applyMode('hidden');
      }, ms);
    }
  }

  /** Freeze (b/s adjust) or release the cursor position. */
  setAnchored(anchored: boolean): void {
    this.anchored = anchored;
    if (anchored && this.mode === 'hidden') {
      // Off-model size/strength adjust still deserves a ring to read.
      this.applyMode('screen');
      this.renderScreen();
    }
  }

  /** Record the radius pair at anchor time so b-adjust can rescale the ring. */
  beginAnchorScale(radiusCss: number): void {
    this.lastAnchorCss = Math.max(2, radiusCss);
    this.anchorWorldRadius = this.surface ? this.surface.worldRadius : 0;
  }

  /** Update to the tool's screen radius (CSS px) and strength (0..1). */
  setBrush(radiusCss: number, intensity: number): void {
    this.intensity = Math.min(1, Math.max(0, intensity));
    this.radiusCss = Math.max(2, radiusCss);
    if (this.anchored && this.surface && this.lastAnchorCss > 0 && this.anchorWorldRadius > 0) {
      this.surface.worldRadius = this.anchorWorldRadius * (this.radiusCss / this.lastAnchorCss);
    }
    if (this.mode === 'surface') this.renderSurface();
    else if (this.mode === 'screen') this.renderScreen();
  }

  /** Smooth active (tool 7 or held shift): the whole cursor turns blue. */
  setSmoothing(on: boolean): void {
    this.root.classList.toggle('is-smooth', on);
  }

  /**
   * Mid-stroke reduction (ZBrush-style, WS2 review): while the stroke is
   * down, sculpt brushes keep only the center dot so the deforming surface
   * stays readable; Smooth keeps its ring but dimmed. The strength line
   * rests either way. null restores the full hover cursor.
   */
  setStrokeStyle(style: StrokeStyle): void {
    this.root.classList.toggle('is-dot-only', style === 'dot');
    this.root.classList.toggle('is-dim', style === 'dim');
  }

  private applyMode(mode: 'hidden' | 'screen' | 'surface'): void {
    this.flashOwned = false; // any explicit mode change outlives the flash
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.root.style.display = mode === 'hidden' ? 'none' : '';
    this.ringPath.style.display = mode === 'surface' ? '' : 'none';
    this.strength.style.display = mode === 'surface' ? '' : 'none';
    this.screenRing.style.display = mode === 'screen' ? '' : 'none';
  }

  /** Project the world-space ring/dot/strength line into the SVG. */
  private renderSurface(): void {
    const s = this.surface;
    const project = this.projector;
    if (!s || !project) return;
    const [px, py, pz] = s.point;
    const center = project(s.point);
    if (!center) {
      // Behind the camera: blank the overlay but keep mode + cache so a
      // later refresh() can bring it back.
      this.root.style.display = 'none';
      this.root.dataset.mode = 'surface-behind';
      return;
    }
    this.root.style.display = '';
    this.root.dataset.mode = 'surface';

    // Tangent basis for the ring plane.
    let [nx, ny, nz] = s.normal;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
    let ux: number;
    let uy: number;
    let uz: number;
    if (Math.abs(ny) < 0.98) {
      // u = normalize(n x up)
      ux = nz;
      uy = 0;
      uz = -nx;
    } else {
      ux = 1;
      uy = 0;
      uz = 0;
    }
    const uLen = Math.hypot(ux, uy, uz) || 1;
    ux /= uLen;
    uy /= uLen;
    uz /= uLen;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;

    const r = s.worldRadius;
    let d = '';
    let started = false;
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      const ca = Math.cos(a) * r;
      const sa = Math.sin(a) * r;
      const pt = project([px + ux * ca + vx * sa, py + uy * ca + vy * sa, pz + uz * ca + vz * sa]);
      if (!pt) {
        started = false;
        continue;
      }
      d += `${started ? 'L' : 'M'}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`;
      started = true;
    }
    if (d && started) d += 'Z';
    this.ringPath.setAttribute('d', d);

    this.dot.setAttribute('cx', String(center[0]));
    this.dot.setAttribute('cy', String(center[1]));

    const tipLen = r * this.intensity;
    const tip = project([px + nx * tipLen, py + ny * tipLen, pz + nz * tipLen]);
    if (tip) {
      this.strength.setAttribute('x1', String(center[0]));
      this.strength.setAttribute('y1', String(center[1]));
      this.strength.setAttribute('x2', String(tip[0]));
      this.strength.setAttribute('y2', String(tip[1]));
      this.strength.style.visibility = '';
    } else {
      this.strength.style.visibility = 'hidden';
    }
  }

  private renderScreen(): void {
    this.screenRing.setAttribute('cx', String(this.x));
    this.screenRing.setAttribute('cy', String(this.y));
    this.screenRing.setAttribute('r', String(this.radiusCss));
    this.dot.setAttribute('cx', String(this.x));
    this.dot.setAttribute('cy', String(this.y));
  }

  dispose(): void {
    this.root.remove();
  }
}
