/**
 * Brush cursor (plan 7.6, reworked in the WS2f behavior pass). One SVG
 * overlay draws every representation, with the surface-aligned ring built
 * by PROJECTING a world-space circle to screen each update:
 *
 * - On a surface hit: a ring around the picked point in the tangent plane,
 *   at the true world brush radius, plus a center dot.
 * - Off the mesh (only when the caller asks: the b/s size adjustment and
 *   the slider and keyboard nudges): a screen-space ring at the pointer.
 * - The strength indicator (owner call, 2026-10-31), only while the
 *   strength is being adjusted (setStrengthShown; InputShell decides when):
 *   for a brush whose strength is a length, a line from the centre along
 *   the surface normal as tall as a stroke pushes (setStrength), with the
 *   value beside it; for a 0..1 strength (the capped brushes, Move) the
 *   value alone, no line, since that strength is no height.
 *
 * Projection replaced the old scene-side Line ring deliberately: WebGPU
 * caps GL lines at one device pixel, which vanished on high-resolution
 * displays; an SVG stroke stays a crisp CSS-pixel width on every backend,
 * and one code path now styles, dims and hides all cursor pieces.
 *
 * With the Rake in hand (setTines) the ring is drawn faint and one small
 * circle per tine sits inside it, on the rake's across axis (see
 * renderTines).
 *
 * Visibility policy lives in InputShell; this class renders what it is
 * told. `root.dataset.mode` mirrors the active representation for tests.
 */

const RING_SEGMENTS = 48;
/** Points per tine circle: small circles, so fewer than the ring. */
const TINE_SEGMENTS = 16;
/** How far one hover move (a full one, TINE_TURN_PX or more) turns the tines' direction toward its own. */
const TINE_TURN_RATE = 0.35;
/** A move this long (CSS px) counts in full; shorter ones count in proportion, so jitter barely turns the tines. */
const TINE_TURN_PX = 6;
/** The tapered tines' opacity floor: an outer tine of Taper 1 still shows. */
const TINE_FADE_FLOOR = 0.2;
/** Gradient ids, unique per cursor in the document. */
let tineGradientSeq = 0;

/** What the cursor last drew for the rake's tines (the tests read it). */
export interface TineProbe {
  count: number;
  width: number;
  taper: number;
  /** Where the across axis came from: the stroke's own dabs, or the hover motion. */
  source: 'stroke' | 'hover';
  /** The across axis, world space, unit. */
  across: [number, number, number];
  /** Each tine circle's world radius: the brush's x width / count. */
  radius: number;
}

type StrokeStyle = null | 'dot' | 'dim';

/** What the strength indicator last drew (the tests read it). */
export interface StrengthProbe {
  shown: boolean;
  /** The line's world length (null: a 0..1 strength, no line). */
  length: number | null;
  label: string;
  /** The line's ends on screen, CSS px (null when no line is drawn). */
  from: [number, number] | null;
  to: [number, number] | null;
  /** The surface point and unit normal the line stands on (null in screen mode). */
  point: [number, number, number] | null;
  normal: [number, number, number] | null;
}

/** The strength indicator's content (InputShell.syncCursorStrength). */
export interface StrengthInfo {
  /** World length of the line: strength in cm x the pressure term; null for a 0..1 strength. */
  length: number | null;
  /** The value beside it: "0.30 cm", "75%". */
  label: string;
  /** The brush's world radius, to scale the line on the screen ring off the model (0: unknown). */
  worldRadius: number;
}

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
  private readonly ghostPath: SVGPathElement;
  private readonly screenRing: SVGCircleElement;
  private readonly dot: SVGCircleElement;
  private readonly strength: SVGLineElement;
  private readonly strengthLabel: SVGTextElement;
  private readonly tinePath: SVGPathElement;
  private readonly tineGradient: SVGLinearGradientElement;
  private readonly tineStops: SVGStopElement[];

  private projector: CursorProjector | null = null;
  private surface: SurfaceState | null = null;
  /** The mirrored ring, or null: symmetry off, or a stroke is in progress. */
  private mirror: { point: [number, number, number]; normal: [number, number, number] } | null =
    null;
  private mode: 'hidden' | 'screen' | 'surface' = 'hidden';
  private anchored = false;
  private x = 0;
  private y = 0;
  private radiusCss = 50;
  /** The indicator's content, or null for a tool without a strength (Drag). */
  private strengthInfo: StrengthInfo | null = null;
  /** Whether the strength is being adjusted, which is when the indicator shows. */
  private strengthShown = false;
  /** What the indicator last drew (the tests read it). */
  readonly strengthProbe: StrengthProbe = { shown: false, length: null, label: '', from: null, to: null, point: null, normal: null };
  private lastAnchorCss = 0;
  private anchorWorldRadius = 0;
  /** The mid-stroke reduction in force (setStrokeStyle). */
  private strokeStyle: StrokeStyle = null;

  // The rake's tines (setTines): 0 tines is any other brush.
  private tineCount = 0;
  private tineWidth = 0;
  private tineTaper = -1;
  /** The stroke's across axis (world), while a rake stroke has one: setTineAxis. */
  private strokeAxis: [number, number, number] = [0, 0, 0];
  private hasStrokeAxis = false;
  /**
   * The hover direction on screen, smoothed: an axis, not an arrow (a
   * stroke back and forth lays the tines the same way), so it is kept as
   * the doubled angle's cosine and sine and averaged in that form. Starts
   * on the screen horizontal.
   */
  private hoverC2 = 1;
  private hoverS2 = 0;
  private lastMoveX = NaN;
  private lastMoveY = NaN;
  /** The tines last drawn, or null when none were (the tests read it). */
  tineProbe: TineProbe | null = null;

  constructor(container: HTMLElement) {
    const NS = 'http://www.w3.org/2000/svg';
    this.root = document.createElementNS(NS, 'svg');
    this.root.setAttribute('class', 'sculpt-cursor');
    this.ringPath = document.createElementNS(NS, 'path');
    this.ringPath.setAttribute('class', 'sculpt-cursor__ring');
    // The mirrored ring: where symmetry will put the other half of this
    // stroke. Hover only - see setSurface.
    this.ghostPath = document.createElementNS(NS, 'path');
    this.ghostPath.setAttribute('class', 'sculpt-cursor__ring sculpt-cursor__ghost');
    this.screenRing = document.createElementNS(NS, 'circle');
    this.screenRing.setAttribute('class', 'sculpt-cursor__ring');
    this.dot = document.createElementNS(NS, 'circle');
    this.dot.setAttribute('class', 'sculpt-cursor__dot');
    this.dot.setAttribute('r', '2.5');
    this.strength = document.createElementNS(NS, 'line');
    this.strength.setAttribute('class', 'sculpt-cursor__strength');
    this.strengthLabel = document.createElementNS(NS, 'text');
    this.strengthLabel.setAttribute('class', 'sculpt-cursor__strength-label');
    // The rake's tines: every circle in one path, faded toward the edges
    // by a gradient laid along the across axis when there is a taper.
    const defs = document.createElementNS(NS, 'defs');
    this.tineGradient = document.createElementNS(NS, 'linearGradient');
    const gradientId = `sculpt-cursor-tines-${++tineGradientSeq}`;
    this.tineGradient.setAttribute('id', gradientId);
    this.tineGradient.setAttribute('gradientUnits', 'userSpaceOnUse');
    this.tineStops = [0, 0.5, 1].map((offset) => {
      const stop = document.createElementNS(NS, 'stop');
      stop.setAttribute('class', 'sculpt-cursor__tine-stop');
      stop.setAttribute('offset', String(offset));
      this.tineGradient.appendChild(stop);
      return stop;
    });
    defs.appendChild(this.tineGradient);
    this.tinePath = document.createElementNS(NS, 'path');
    this.tinePath.setAttribute('class', 'sculpt-cursor__tines');
    this.tinePath.setAttribute('stroke', `url(#${gradientId})`);
    this.ringPath.classList.add('sculpt-cursor__ring--main');
    this.root.append(defs, this.ghostPath, this.ringPath, this.tinePath, this.screenRing, this.dot, this.strength, this.strengthLabel);
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
    this.turnTines(x - this.lastMoveX, y - this.lastMoveY);
    this.lastMoveX = x;
    this.lastMoveY = y;
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
    mirror?: { point: [number, number, number]; normal: [number, number, number] } | null,
  ): void {
    if (this.anchored) return;
    // Callers that pass no mirror get none: the stroke path leaves it out,
    // which is what keeps the mirrored ring a HOVER affordance (owner
    // call - mid-stroke you want the one dot on the side you are working).
    this.mirror = mirror ?? null;
    if (!point || !normal || !worldRadius) {
      this.surface = null;
      if (this.mode === 'surface') this.applyMode('hidden');
      return;
    }
    this.surface = { point, normal, worldRadius };
    this.applyMode('surface');
    this.renderSurface();
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
   * an existing screen ring (an earlier flash) just re-renders and stays.
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

  /**
   * Update to the tool's screen radius (CSS px). Its strength is
   * setStrength's: a tool with none (Drag moves as far as the pointer
   * goes) draws no indicator at all rather than one drawn wrong.
   */
  setBrush(radiusCss: number, intensity: number | null): void {
    if (intensity === null) this.strengthInfo = null;
    this.radiusCss = Math.max(2, radiusCss);
    if (this.anchored && this.surface && this.lastAnchorCss > 0 && this.anchorWorldRadius > 0) {
      this.surface.worldRadius = this.anchorWorldRadius * (this.radiusCss / this.lastAnchorCss);
    }
    if (this.mode === 'surface') this.renderSurface();
    else if (this.mode === 'screen') this.renderScreen();
  }

  /** The strength indicator's content (null: a tool without a strength). Drawn while shown. */
  setStrength(info: StrengthInfo | null): void {
    this.strengthInfo = info;
    this.renderStrength();
  }

  /** Show or hide the strength indicator (InputShell: only while the strength is adjusted). */
  setStrengthShown(on: boolean): void {
    if (on === this.strengthShown) return;
    this.strengthShown = on;
    this.renderStrength();
  }

  /**
   * The rake's tines (count, width as a fraction of each tine's slot,
   * taper 0..1), or a count of 0 for every other brush: the plain ring.
   * Cheap to call every move: nothing changes unless a value did.
   */
  setTines(count: number, width: number, taper: number): void {
    if (count === this.tineCount && width === this.tineWidth && taper === this.tineTaper) return;
    const was = this.tineCount;
    this.tineCount = count > 0 ? count : 0;
    this.tineWidth = width;
    this.tineTaper = taper;
    if ((was > 0) !== (this.tineCount > 0)) this.root.classList.toggle('is-rake', this.tineCount > 0);
    if (this.tineCount > 0) {
      // The depth fades as 1 - taper x |centre| across the rake: the
      // opacity follows it, linear from the middle out to the rim.
      const edge = TINE_FADE_FLOOR + (1 - TINE_FADE_FLOOR) * (1 - Math.min(1, Math.max(0, taper)));
      this.tineStops[0].setAttribute('stop-opacity', String(edge));
      this.tineStops[1].setAttribute('stop-opacity', '1');
      this.tineStops[2].setAttribute('stop-opacity', String(edge));
    }
    if (this.mode === 'surface') this.renderSurface();
  }

  /**
   * The across axis a rake stroke is laying its tines on (world space),
   * or null to go back to the hover direction (the stroke ended, or has
   * not dabbed yet).
   */
  setTineAxis(axis: readonly [number, number, number] | null): void {
    if (axis) {
      this.strokeAxis[0] = axis[0];
      this.strokeAxis[1] = axis[1];
      this.strokeAxis[2] = axis[2];
    }
    this.hasStrokeAxis = !!axis;
  }

  /** One pointer move's turn of the hover direction (see hoverC2). */
  private turnTines(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy);
    if (!(len >= 0.5)) return; // the first move (NaN), or a still pointer
    const k = TINE_TURN_RATE * Math.min(1, len / TINE_TURN_PX);
    // cos 2a and sin 2a of the move's angle a.
    const c = dx / len;
    const s = dy / len;
    this.hoverC2 += (c * c - s * s - this.hoverC2) * k;
    this.hoverS2 += (2 * c * s - this.hoverS2) * k;
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
    const was = this.strokeStyle;
    this.strokeStyle = style;
    this.root.classList.toggle('is-dot-only', style === 'dot');
    this.root.classList.toggle('is-dim', style === 'dim');
    // The ring was not kept up to date while hidden (renderSurface): draw
    // it where the surface is now, before it shows again.
    if (was === 'dot' && style !== 'dot' && this.mode === 'surface') this.renderSurface();
  }

  private applyMode(mode: 'hidden' | 'screen' | 'surface'): void {
    this.flashOwned = false; // any explicit mode change outlives the flash
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.root.style.display = mode === 'hidden' ? 'none' : '';
    this.ringPath.style.display = mode === 'surface' ? '' : 'none';
    this.tinePath.style.display = mode === 'surface' ? '' : 'none';
    this.screenRing.style.display = mode === 'screen' ? '' : 'none';
    // The strength indicator draws in both live modes, so keyboard nudges
    // read on the flashed screen ring too (hover-less pencils).
    this.renderStrength();
  }

  /** Project the world-space ring/dot/strength line into the SVG. */
  /**
   * One ring in the tangent plane at `point`, as SVG path data. Shared by
   * the brush ring and the symmetry ghost, which differ only in where they
   * sit and how loudly they are drawn.
   */
  private ringPathData(
    point: [number, number, number],
    normal: [number, number, number],
    r: number,
  ): string {
    const project = this.projector;
    if (!project) return '';
    const [px, py, pz] = point;
    let [nx, ny, nz] = normal;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
    let ux: number;
    let uy: number;
    let uz: number;
    if (Math.abs(ny) < 0.98) {
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
    return d && started ? `${d}Z` : d;
  }

  private renderSurface(): void {
    const s = this.surface;
    const project = this.projector;
    if (!s || !project) return;
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

    // Hidden under a stroke's dot-only reduction: 48 projected points and a
    // path string per move for nothing, so it waits until the ring shows.
    if (this.strokeStyle !== 'dot') {
      this.ringPath.setAttribute('d', this.ringPathData(s.point, s.normal, s.worldRadius));
    }
    this.renderTines(s);
    // The mirrored ring rides the same projection; an empty d hides it.
    this.ghostPath.setAttribute(
      'd',
      this.mirror ? this.ringPathData(this.mirror.point, this.mirror.normal, s.worldRadius) : '',
    );

    this.dot.setAttribute('cx', String(center[0]));
    this.dot.setAttribute('cy', String(center[1]));
    this.renderStrength();
  }

  /**
   * The strength indicator, while shown: on the surface, a line from the
   * centre along the unit normal, the strength's world length (a stroke's
   * push at the current pressure); on the screen ring off the model, a
   * vertical line scaled as the ring is (the brush's world radius to its
   * screen radius). The value sits beside the line's tip, or beside the
   * dot for a 0..1 strength, which draws no line.
   */
  private renderStrength(): void {
    const info = this.strengthInfo;
    const probe = this.strengthProbe;
    const live = this.strengthShown && !!info && (this.mode === 'surface' || this.mode === 'screen');
    probe.shown = live;
    probe.length = info?.length ?? null;
    probe.label = info?.label ?? '';
    probe.from = null;
    probe.to = null;
    probe.point = null;
    probe.normal = null;
    if (!live || !info) {
      this.strength.style.display = 'none';
      this.strengthLabel.style.display = 'none';
      return;
    }
    let from: [number, number] | null = null;
    let to: [number, number] | null = null;
    if (this.mode === 'surface' && this.surface && this.projector) {
      const s = this.surface;
      from = this.projector(s.point);
      if (from && info.length !== null) {
        const [nx, ny, nz] = s.normal;
        const l = Math.hypot(nx, ny, nz) || 1;
        const n: [number, number, number] = [nx / l, ny / l, nz / l];
        const h = info.length;
        to = this.projector([s.point[0] + n[0] * h, s.point[1] + n[1] * h, s.point[2] + n[2] * h]);
        probe.point = [s.point[0], s.point[1], s.point[2]];
        probe.normal = n;
      }
    } else if (this.mode === 'screen') {
      from = [this.x, this.y];
      if (info.length !== null && info.worldRadius > 0) to = [this.x, this.y - (this.radiusCss * info.length) / info.worldRadius];
    }
    if (from && to) {
      this.strength.setAttribute('x1', from[0].toFixed(1));
      this.strength.setAttribute('y1', from[1].toFixed(1));
      this.strength.setAttribute('x2', to[0].toFixed(1));
      this.strength.setAttribute('y2', to[1].toFixed(1));
      this.strength.style.display = '';
      probe.from = from;
      probe.to = to;
    } else {
      this.strength.style.display = 'none';
    }
    if (from) {
      // Beside the tip, or the dot; to the right, clear of the line.
      const at = to ?? from;
      this.strengthLabel.setAttribute('x', (at[0] + 8).toFixed(1));
      this.strengthLabel.setAttribute('y', (at[1] + 4).toFixed(1));
      this.strengthLabel.textContent = info.label;
      this.strengthLabel.style.display = '';
    } else {
      this.strengthLabel.style.display = 'none';
    }
  }

  /**
   * The rake's tines: N circles in the tangent plane, centred on the across
   * axis at (k + 0.5) / N x 2 - 1 of the radius, each the tine's
   * half-width, radius x width / N, as RakeBrush cuts them. The across
   * axis is the stroke's own while a stroke has one (setTineAxis); on
   * hover it is perpendicular to the smoothed pointer motion, carried onto
   * the surface through the projection.
   */
  private renderTines(s: SurfaceState): void {
    const N = this.tineCount;
    const project = this.projector;
    if (!N || !project) {
      if (this.tineProbe) {
        this.tinePath.setAttribute('d', '');
        this.tineProbe = null;
      }
      return;
    }
    // Hidden with the ring under the dot-only reduction.
    if (this.strokeStyle === 'dot') return;
    const r = s.worldRadius;
    const [px, py, pz] = s.point;
    let [nx, ny, nz] = s.normal;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
    // The across axis, a, in the tangent plane.
    let ax = 0;
    let ay = 0;
    let az = 0;
    let fromStroke = false;
    if (this.hasStrokeAxis) {
      // The rake's own axis, as is: it lies in the plane the rake fitted
      // to the form, which a groove just cut can tilt the picked face's
      // normal away from. Only one along the normal is no axis.
      const [x, y, z] = this.strokeAxis;
      const l = Math.hypot(x, y, z);
      fromStroke = l > 1e-9 && Math.abs(x * nx + y * ny + z * nz) < 0.9 * l;
      if (fromStroke) {
        ax = x;
        ay = y;
        az = z;
      }
    }
    if (!fromStroke) {
      // A tangent basis (e, f), as the ring's.
      let ex = 1;
      let ey = 0;
      let ez = 0;
      if (Math.abs(ny) < 0.98) {
        const l = Math.hypot(nz, nx) || 1;
        ex = nz / l;
        ez = -nx / l;
      }
      const fx = ny * ez - nz * ey;
      const fy = nz * ex - nx * ez;
      const fz = nx * ey - ny * ex;
      // The screen direction, carried onto the surface: solve J [a b] = d
      // with J the screen images of e and f.
      const half = Math.atan2(this.hoverS2, this.hoverC2) / 2;
      const dx = Math.cos(half);
      const dy = Math.sin(half);
      const c0 = project(s.point);
      const c1 = project([px + ex * r, py + ey * r, pz + ez * r]);
      const c2 = project([px + fx * r, py + fy * r, pz + fz * r]);
      let wx = ex;
      let wy = ey;
      let wz = ez;
      if (c0 && c1 && c2) {
        const j1x = c1[0] - c0[0];
        const j1y = c1[1] - c0[1];
        const j2x = c2[0] - c0[0];
        const j2y = c2[1] - c0[1];
        const det = j1x * j2y - j2x * j1y;
        if (Math.abs(det) > 1e-6 * (j1x * j1x + j1y * j1y + j2x * j2x + j2y * j2y)) {
          const a = (dx * j2y - j2x * dy) / det;
          const b = (j1x * dy - dx * j1y) / det;
          wx = ex * a + fx * b;
          wy = ey * a + fy * b;
          wz = ez * a + fz * b;
        }
      }
      // Across = normal x along.
      ax = ny * wz - nz * wy;
      ay = nz * wx - nx * wz;
      az = nx * wy - ny * wx;
    }
    const aLen = Math.hypot(ax, ay, az) || 1;
    ax /= aLen;
    ay /= aLen;
    az /= aLen;
    // Along = across x normal: the circles' second axis.
    let bx = ay * nz - az * ny;
    let by = az * nx - ax * nz;
    let bz = ax * ny - ay * nx;
    const bLen = Math.hypot(bx, by, bz) || 1;
    bx /= bLen;
    by /= bLen;
    bz /= bLen;
    const tr = (r * this.tineWidth) / N;
    let d = '';
    for (let k = 0; k < N; k++) {
      const u = (((k + 0.5) / N) * 2 - 1) * r;
      const cx = px + ax * u;
      const cy = py + ay * u;
      const cz = pz + az * u;
      let started = false;
      for (let i = 0; i < TINE_SEGMENTS; i++) {
        const t = (i / TINE_SEGMENTS) * Math.PI * 2;
        const ca = Math.cos(t) * tr;
        const sa = Math.sin(t) * tr;
        const pt = project([cx + ax * ca + bx * sa, cy + ay * ca + by * sa, cz + az * ca + bz * sa]);
        if (!pt) {
          started = false;
          continue;
        }
        d += `${started ? 'L' : 'M'}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`;
        started = true;
      }
      if (started) d += 'Z';
    }
    this.tinePath.setAttribute('d', d);
    // The taper's fade runs along the across axis, rim to rim.
    const g0 = project([px - ax * r, py - ay * r, pz - az * r]);
    const g1 = project([px + ax * r, py + ay * r, pz + az * r]);
    if (g0 && g1) {
      this.tineGradient.setAttribute('x1', g0[0].toFixed(1));
      this.tineGradient.setAttribute('y1', g0[1].toFixed(1));
      this.tineGradient.setAttribute('x2', g1[0].toFixed(1));
      this.tineGradient.setAttribute('y2', g1[1].toFixed(1));
    }
    const probe = this.tineProbe ?? (this.tineProbe = { count: 0, width: 0, taper: 0, source: 'hover', across: [0, 0, 0], radius: 0 });
    probe.count = N;
    probe.width = this.tineWidth;
    probe.taper = this.tineTaper;
    probe.source = fromStroke ? 'stroke' : 'hover';
    probe.across[0] = ax;
    probe.across[1] = ay;
    probe.across[2] = az;
    probe.radius = tr;
  }

  private renderScreen(): void {
    this.screenRing.setAttribute('cx', String(this.x));
    this.screenRing.setAttribute('cy', String(this.y));
    this.screenRing.setAttribute('r', String(this.radiusCss));
    this.dot.setAttribute('cx', String(this.x));
    this.dot.setAttribute('cy', String(this.y));
    this.renderStrength();
  }

  dispose(): void {
    this.root.remove();
  }
}
