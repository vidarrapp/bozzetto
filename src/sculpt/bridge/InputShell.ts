import Enums from '@sculpt-vendor/misc/Enums';
import Tablet from '@sculpt-vendor/misc/Tablet';
import { DynamicsStore } from './dynamics';
import { isTextEntryTarget, tabShouldMoveFocus } from '../../ui/dom';
import type { SculptTool } from '@sculpt-vendor/editing/tools/SculptBase';
import type { SculptSession } from './SculptSession';
import type { BrushCursor } from './BrushCursor';

/**
 * Ported from SculptGL.js's onDeviceDown/Move/Up state machine (plan 6.3),
 * with Bozzetto's arbitration and the plan 7.4 hotkey table. Listeners sit on
 * the viewer container in the capture phase, ahead of OrbitControls' canvas
 * handlers and the viewer's window shortcuts: a pointer-down that hits the
 * mesh starts a stroke and swallows the event; a miss falls through and
 * orbits. Claimed keys stopPropagation so the viewer bindings they shadow
 * (digits, w/s/r/f...) stay dormant until sculpt mode unmounts.
 *
 * Stroke modifiers, ZBrush-style: alt inverts the stroke (negative) for
 * tools that support it; ctrl paints mask, ctrl+alt unmasks (the Masking
 * tool is swapped in just for the stroke). Alt keydown is preventDefaulted
 * so Firefox's menu bar never steals the modifier.
 */

/** Environment hooks the shell drives outside the vendored core. */
export interface InputShellHooks {
  /** f: frame the whole current mesh. */
  frameModel(): void;
  /** Stroke end: remember where the work was, WITHOUT moving the view. */
  focusEdit(point: [number, number, number]): void;
  /** A drag that missed the mesh is about to orbit / has finished. */
  orbitBegin(): void;
  orbitEnd(): void;
  /** shift+s: toggle shadows; returns the new state (unused, for parity). */
  toggleShadows(): void;
  /** l + drag: rotate the light rig by a degree delta. */
  rotateLightRig(deltaDeg: number): void;
  /** Arrow keys: turntable step around the subject (degrees). */
  orbitY(deltaDeg: number): void;
  /** ctrl + drag off the model: dolly by a multiplier (>1 out, <1 in). */
  dolly(factor: number): void;
  /** Tab: close open panels, then clear the standing interface. */
  toggleChrome(): void;
  /** ctrl+h: show/hide the mask tint (the mask itself stays). */
  toggleMaskTint(): void;
  /** ctrl+e: extract the masked region at the palette's thickness. */
  extractMasked(): void;
}

/** Hold-key adjust modes for brush size (b) and strength (s). */
type AdjustMode = 'radius' | 'intensity' | null;

const RADIUS_MIN = 5;
const RADIUS_MAX = 500;
/**
 * Stroke-start grace: the full ring stays up this long before the
 * mid-stroke reduction, so pencils without hover (iPad) still see the
 * brush outline at the moment it lands (review request).
 */
const STROKE_REDUCE_DELAY_MS = 250;
/** Screen-ring feedback duration for keyboard size/strength nudges. */
const NUDGE_FLASH_MS = 450;
/** Wheel-key steps (TourBox et al.): intensity per tick; size is ~6%. */
const INTENSITY_STEP = 0.03;
/**
 * Turntable stepping, retuned after wheel testing: a degree per tick was
 * too coarse to creep with and 8 degrees too slow to spin with, so the base
 * step is finer and the acceleration much steeper. The multiplier is the
 * tick RATE raised to a power, which spreads the range where a wheel
 * actually lives:
 *
 *   250ms gap (creeping)  x1   -> 0.4 deg      25ms gap (spinning) x60 -> 24 deg
 *   100ms gap             x5   -> 2.1 deg      50ms gap            x18 -> 7.2 deg
 */
const ORBIT_STEP_DEG = 0.4;
const ORBIT_ACCEL_REF_MS = 250;
const ORBIT_ACCEL_POW = 1.8;
const ORBIT_ACCEL_MAX = 60;
/**
 * ctrl-drag zoom: per-pixel exponent, so a drag of the same length changes
 * the framing by the same proportion however close you already are. About
 * 2x per 170px.
 */
const ZOOM_DRAG_RATE = 0.004;
/**
 * How far a ctrl press off the model may wander and still count as a tap.
 * Generous enough for a Pencil, which never lands perfectly still.
 */
const CTRL_DRAG_SLOP = 8;

export class InputShell {
  /** Fired when the selected brush changes (digit keys or toolbar). */
  onToolChange: (() => void) | null = null;
  /** Fired whenever brush radius/strength/selection may have moved. */
  onBrushChange: (() => void) | null = null;

  private pointerId = -1;
  /** Device that owns the current stroke, so a Pencil can outrank a finger. */
  private strokePointerType = '';
  /**
   * Why the last pointerdown was accepted or dropped. The finger-blocks-the-
   * Pencil report has survived three fixes, each aimed at a different guess;
   * ?inputdebug=1 prints this so the next report says which one it is
   * instead of "nothing happens".
   */
  private verdict: ((text: string) => void) | null = null;
  /** Strokes begun since mount; the toolbar reads it to tell a hold from a tap. */
  private strokes = 0;
  /** Pointer that fell through to an orbit, or -1. */
  private orbitPointer = -1;
  /** Sticky negative base (toolbar toggle); alt inverts relative to it. */
  private negativeBase = false;
  /** Tool whose _negative was overridden for the current stroke, if any. */
  private negativeOverride: { tool: SculptTool; prev: boolean } | null = null;
  /** Tool index swapped out for a ctrl-mask stroke, if any. */
  private maskPrevTool = -1;
  private adjust: AdjustMode = null;
  /**
   * ctrl+press that missed the mesh. Which gesture it is stays undecided
   * until the pointer either travels (zoom) or lifts in place (invert the
   * whole mask), the same tap-vs-drag split upstream used to choose
   * between inverting and clearing.
   */
  private ctrlEmpty: {
    x: number;
    y: number;
    lastY: number;
    pointerId: number;
    dragging: boolean;
  } | null = null;
  /** Shift held = smoothing (temp tool); the cursor previews it in blue. */
  private shiftHeld = false;
  private lKeyHeld = false;
  private strokeReduceTimer = 0;
  private lastOrbitTime = 0;
  private lastOrbitDir = 0;
  private lastClientX = 0;
  private lastClientY = 0;
  /** Last pointer position in viewport-absolute px (adjust/light drags). */
  private lastAbsX = 0;
  private lastAbsY = 0;

  constructor(
    private readonly session: SculptSession,
    private readonly container: HTMLElement,
    private readonly cursor: BrushCursor,
    /** Also read by the toolbar, which offers a pointer route to some of these. */
    readonly hooks: InputShellHooks,
  ) {}

  /** Per-brush pressure dynamics (the WS4 palette binds to this). */
  readonly dynamics = new DynamicsStore(() => this.session.getSculptManager().getToolIndex());

  install(): void {
    // Pen pressure routing lives in the dynamics store (per-brush toggles
    // and curves; defaults: size constant, strength fully dynamic).
    this.dynamics.install();
    Tablet.pressure = 0.5;
    this.container.addEventListener('pointerdown', this.onPointerDown, true);
    this.container.addEventListener('pointermove', this.onPointerMove, true);
    this.container.addEventListener('pointerup', this.onPointerUp, true);
    this.container.addEventListener('pointercancel', this.onPointerUp, true);
    this.container.addEventListener('pointerleave', this.onPointerLeave, true);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    this.syncCursorBrush();
    // Review decision: invert the Crease default (upstream ships _negative
    // true, a carving valley; Bozzetto defaults to the raised ridge, and alt
    // or the Negative button carves).
    const crease = this.session.getSculptManager().getTool(Enums.Tools.CREASE);
    if (crease && '_negative' in crease) crease._negative = false;
    // Hint that keyboard modifiers matter here (and match SculptGL's feel).
    this.session.setCanvasCursor('crosshair');
  }

  dispose(): void {
    this.dynamics.dispose();
    this.container.removeEventListener('pointerdown', this.onPointerDown, true);
    this.container.removeEventListener('pointermove', this.onPointerMove, true);
    this.container.removeEventListener('pointerup', this.onPointerUp, true);
    this.container.removeEventListener('pointercancel', this.onPointerUp, true);
    this.container.removeEventListener('pointerleave', this.onPointerLeave, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    this.session.setCanvasCursor('default');
  }

  /**
   * Feed stylus pressure to the vendored Tablet state. The PointerEvent spec
   * reports 0.5 for pressed pressure-less devices (mouse, plain touch), which
   * is exactly Tablet's neutral value, so no per-device casing is needed;
   * a few browsers report 0 for active pressure-less touches, mapped back to
   * neutral here.
   */
  private feedPressure(e: PointerEvent): void {
    Tablet.pressure = e.buttons && e.pressure > 0 ? e.pressure : 0.5;
  }

  /** Mirror upstream setMousePosition: device pixels relative to the canvas. */
  private setMouse(e: PointerEvent): void {
    const s = this.session;
    const canvas = s.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const ratio = s.getPixelRatio();
    s._mouseX = (e.clientX - rect.left) * ratio;
    s._mouseY = (e.clientY - rect.top) * ratio;
    this.lastClientX = e.clientX - rect.left;
    this.lastClientY = e.clientY - rect.top;
  }

  private currentTool(): SculptTool {
    return this.session.getSculptManager().getCurrentTool();
  }

  /** Push the active tool's radius/strength/color into the cursor overlay. */
  private syncCursorBrush(): void {
    const tool = this.currentTool();
    this.cursor.setBrush(tool._radius, tool._intensity);
    const idx = this.session.getSculptManager().getToolIndex();
    this.cursor.setSmoothing(idx === Enums.Tools.SMOOTH || this.shiftHeld);
    this.onBrushChange?.();
  }

  // --- brush value access (side sliders + future palette) -----------------

  /**
   * Not every tool carries both: Drag, Twist, LocalScale and Transform have
   * no _intensity, and Transform has no _radius either. Callers get a
   * usable number rather than undefined; use hasBrushIntensity() to decide
   * whether a control for it should exist at all.
   */
  getBrushRadius(): number {
    const r = this.currentTool()._radius;
    return typeof r === 'number' ? r : RADIUS_MIN;
  }

  getBrushIntensity(): number {
    const i = this.currentTool()._intensity;
    return typeof i === 'number' ? i : 0;
  }

  hasBrushRadius(): boolean {
    return typeof this.currentTool()._radius === 'number';
  }

  hasBrushIntensity(): boolean {
    return typeof this.currentTool()._intensity === 'number';
  }

  /** Set radius directly (slider drags); flashes a centered preview ring. */
  setBrushRadius(px: number): void {
    this.currentTool()._radius = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, px));
    this.syncCursorBrush();
    this.centerFlash();
  }

  setBrushIntensity(v: number): void {
    this.currentTool()._intensity = Math.min(1, Math.max(0, v));
    this.syncCursorBrush();
    this.centerFlash();
  }

  /** Preview ring mid-viewport while a slider drags (Procreate-style). */
  private centerFlash(): void {
    this.cursor.moveTo(this.container.clientWidth / 2, this.container.clientHeight / 2);
    this.cursor.flashScreen(NUDGE_FLASH_MS);
  }

  // --- pointer machine ----------------------------------------------------

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return; // middle/right stay with OrbitControls
    // One stroke at a time: a finger landing mid-stroke (to hold a modifier
    // button, or just resting) must not restart or steal the pen's stroke.
    // A Pencil is the exception and outranks a finger, because on an iPad
    // the hand rests on the glass: a touch that got in first has to hand the
    // stroke over, not lock the pen out for as long as the finger stays down.
    if (this.pointerId !== -1 && e.pointerId !== this.pointerId) {
      if (e.pointerType !== 'pen' || this.strokePointerType === 'pen') {
        this.verdict?.(`drop ${e.pointerType}: ${this.strokePointerType} owns the stroke`);
        return;
      }
      this.verdict?.(`pen takes over from ${this.strokePointerType}`);
      this.abandonStroke();
    }
    // While adjusting brush size/strength (b/s) or dragging the light rig
    // (l), the press belongs to that gesture: never let it start an orbit.
    if (this.adjust || this.lKeyHeld) {
      this.verdict?.(`drop ${e.pointerType}: ${this.adjust ?? 'light'} drag owns it`);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const s = this.session;
    this.setMouse(e);

    // alt+click (no drag intent resolvable here): select the mesh under the
    // cursor. With a single mesh this is a no-op; it exists for multi-mesh.
    // The same press still sculpts negatively if dragged, matching ZBrush
    // where alt affects the stroke, so selection only runs on a miss-free
    // ctrl-less press and does not consume the event.

    // Temporary tool swaps for the stroke: ctrl = mask, shift = smooth
    // (ZBrush muscle memory). Restored on release.
    const tools = Enums.Tools;
    if (e.ctrlKey && !e.metaKey) {
      this.maskPrevTool = s.getSculptManager().getToolIndex();
      s.getSculptManager().setToolIndex(tools.MASKING);
    } else if (e.shiftKey) {
      this.maskPrevTool = s.getSculptManager().getToolIndex();
      s.getSculptManager().setToolIndex(tools.SMOOTH);
    }
    // The ring reflects the tool actually stroking (radius and the blue
    // smoothing tint for shift strokes); restored on release.
    if (this.maskPrevTool >= 0) this.syncCursorBrush();

    // Stroke polarity: the sticky toolbar base XOR alt, per tool support
    // (mask: alt = unmask, base ignored).
    const tool = this.currentTool();
    if ('_negative' in tool) {
      const prev = !!tool._negative;
      const base = this.negativeBase ? !prev : prev;
      tool._negative = e.ctrlKey ? !e.altKey : e.altKey ? !base : base;
      this.negativeOverride = { tool, prev };
    }

    this.feedPressure(e); // before start: the first dab already feels it
    const canEdit = s.getSculptManager().start(false);
    if (!canEdit) {
      this.restoreStrokeTool();
      // A ctrl press that MISSES the mesh: tap inverts the whole mask
      // (upstream parity), drag zooms - the Pencil needs a zoom that is not
      // a pinch. Clearing moved to ctrl+c, which is what freed the drag.
      if (e.ctrlKey && !e.metaKey) {
        this.ctrlEmpty = {
          x: e.clientX,
          y: e.clientY,
          lastY: e.clientY,
          pointerId: e.pointerId,
          dragging: false,
        };
        e.preventDefault();
        e.stopPropagation(); // no orbit under either gesture
        return;
      }
      s._action = Enums.Action.NOTHING;
      // No hit: the event continues on to OrbitControls, which will orbit.
      // Tell the host so it can re-centre that rotation on the last stroke.
      this.orbitPointer = e.pointerId;
      this.verdict?.(`orbit ${e.pointerType} (missed the mesh)`);
      this.hooks.orbitBegin();
      return;
    }

    s._action = Enums.Action.SCULPT_EDIT;
    this.strokes++;
    this.pointerId = e.pointerId;
    this.strokePointerType = e.pointerType;
    this.verdict?.(`stroke ${e.pointerType}`);
    // Mid-stroke the cursor gets out of the way (review decision): sculpt
    // brushes keep the center dot only; Smooth keeps a dimmed ring. The
    // reduction waits a beat so hover-less pencils see the outline land.
    const strokeTool = s.getSculptManager().getToolIndex();
    const strokeStyle = strokeTool === Enums.Tools.SMOOTH ? ('dim' as const) : ('dot' as const);
    clearTimeout(this.strokeReduceTimer);
    this.strokeReduceTimer = window.setTimeout(() => {
      // A Move grab begun outside the outline keeps its full ring: it is the
      // only thing showing where the grab reaches, and reducing it to a dot
      // leaves the pen with no indication it is affecting anything.
      if (this.pointerId !== -1 && !this.grabbingFromOutside()) {
        this.cursor.setStrokeStyle(strokeStyle);
      }
    }, STROKE_REDUCE_DELAY_MS);
    // NOT for touch. Capturing a touch pointer is what Safari punishes: the
    // moment a second pointer arrives it cancels the captured one, and on
    // iPadOS that second pointer is the Pencil. A finger resting anywhere
    // then blocked pen input entirely. Mouse and pen still capture, where
    // it buys tracking outside the canvas and costs nothing.
    if (e.pointerType !== 'touch') {
      try {
        s.getCanvas().setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events carry no active pointer; capture is best-effort.
      }
    }
    e.preventDefault();
    e.stopPropagation();
    s._lastMouseX = s._mouseX;
    s._lastMouseY = s._mouseY;
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const s = this.session;
    const prevAbsX = this.lastAbsX;
    const prevAbsY = this.lastAbsY;
    this.lastAbsX = e.clientX;
    this.lastAbsY = e.clientY;

    // Hold-l light rotation rides pointer movement, sculpt-free.
    if (this.lKeyHeld) {
      this.hooks.rotateLightRig((e.clientX - prevAbsX) * 0.5);
      return;
    }

    // Hold-b / hold-s adjust on the anchored brush: size is a horizontal
    // drag, strength a vertical one (up = stronger).
    if (this.adjust) {
      const dx = e.clientX - prevAbsX;
      const dy = prevAbsY - e.clientY;
      const tool = this.currentTool();
      if (this.adjust === 'radius') {
        tool._radius = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, tool._radius + dx));
      } else {
        tool._intensity = Math.min(1, Math.max(0, tool._intensity + dy * 0.005));
      }
      this.syncCursorBrush();
      return;
    }

    this.setMouse(e);
    this.cursor.moveTo(this.lastClientX, this.lastClientY);

    // ctrl off the model: past the slop this is a zoom, and vertical travel
    // dollies. Pixels-to-factor is exponential so the step is proportional
    // at any distance, and dragging up zooms IN, matching the wheel.
    if (this.ctrlEmpty && e.pointerId === this.ctrlEmpty.pointerId) {
      const g = this.ctrlEmpty;
      if (!g.dragging && Math.hypot(e.clientX - g.x, e.clientY - g.y) > CTRL_DRAG_SLOP) {
        g.dragging = true;
        // Measure from here, so crossing the slop does not jump the camera.
        g.lastY = e.clientY;
      }
      if (g.dragging) {
        const dy = e.clientY - g.lastY;
        g.lastY = e.clientY;
        this.hooks.dolly(Math.exp(dy * ZOOM_DRAG_RATE));
      }
      this.cursor.hide();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (s._action !== Enums.Action.SCULPT_EDIT || e.pointerId !== this.pointerId) {
      // A held button that is not our stroke is a camera drag (or a zoom
      // drag): the cursor gets out of the way entirely, and skipping the
      // hover raycast keeps orbiting cheap.
      if (e.buttons !== 0) {
        this.cursor.hide();
        return;
      }
      // Hover: ring on the surface under the cursor. Off the mesh, no
      // cursor at all - except Move, whose volumetric grab can start out
      // there and deserves an aim ring (review policy).
      const surf = s.hoverSurface(true);
      if (surf) {
        this.cursor.setSurface(surf.point, surf.normal, surf.worldRadius);
      } else if (this.currentToolIndex() === Enums.Tools.MOVE) {
        this.cursor.showScreen();
      } else {
        this.cursor.hide();
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    // Upstream onDeviceMove, sculpt branch: refresh picking, then stroke.
    this.feedPressure(e);
    s.getSculptManager().preUpdate();
    s.getSculptManager().update();

    // The stroke just refreshed picking; reuse it for the ring (no re-pick).
    // Except for a volumetric Move grab begun outside the silhouette: there
    // the picked point sits on the mesh while the pen is off it, so the
    // ring would abandon the pointer entirely. Keep it under the pen.
    if (this.grabbingFromOutside()) {
      this.cursor.moveTo(this.lastClientX, this.lastClientY);
      this.cursor.showScreen();
    } else {
      const strokeSurf = s.hoverSurface(false);
      this.cursor.setSurface(
        strokeSurf ? strokeSurf.point : null,
        strokeSurf?.normal,
        strokeSurf?.worldRadius,
      );
    }

    s._lastMouseX = s._mouseX;
    s._lastMouseY = s._mouseY;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const s = this.session;

    if (this.orbitPointer === e.pointerId) {
      this.orbitPointer = -1;
      this.hooks.orbitEnd();
    }

    if (this.ctrlEmpty && e.pointerId === this.ctrlEmpty.pointerId) {
      const gesture = this.ctrlEmpty;
      this.ctrlEmpty = null;
      s._action = Enums.Action.NOTHING;
      // Never travelled, so it was a tap: invert the whole mask. A
      // cancelled pointer aborts rather than inverting.
      if (!gesture.dragging && e.type !== 'pointercancel') {
        s.getSculptManager().getTool(Enums.Tools.MASKING).invert?.();
        s.render();
      }
      e.stopPropagation();
      return;
    }

    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;
    this.strokePointerType = '';
    clearTimeout(this.strokeReduceTimer);
    this.cursor.setStrokeStyle(null);

    if (s._action === Enums.Action.SCULPT_EDIT) {
      // Upstream onDeviceUp: octree rebalance + drop no-op undo entries.
      s.getSculptManager().end();
      s.getStateManager().cleanNoop();
      e.stopPropagation();
      // The orbit pivot follows the work: turn around the last edit point.
      const edit = s.lastEditWorldPoint();
      if (edit) this.hooks.focusEdit(edit);
    }
    this.restoreStrokeTool();
    Tablet.pressure = 0.5; // neutral, so hover picking never sees stale pressure
    s._action = Enums.Action.NOTHING;
    s.render();
  };

  private readonly onPointerLeave = (e: PointerEvent): void => {
    // Capture-phase leave fires for every descendant crossing (canvas to
    // overlay chips and back); only the container's own leave means the
    // pointer left the viewport.
    if (e.target === this.container) this.cursor.hide();
  };

  /**
   * Close out the stroke a finger had started, so the Pencil can begin its
   * own: the same tidy-up a lift does (octree rebalance, drop a no-op undo
   * entry, pivot follows the work), minus the event bookkeeping.
   */
  private abandonStroke(): void {
    const s = this.session;
    if (s._action === Enums.Action.SCULPT_EDIT) {
      s.getSculptManager().end();
      s.getStateManager().cleanNoop();
      const edit = s.lastEditWorldPoint();
      if (edit) this.hooks.focusEdit(edit);
    }
    clearTimeout(this.strokeReduceTimer);
    this.cursor.setStrokeStyle(null);
    this.restoreStrokeTool();
    this.pointerId = -1;
    this.strokePointerType = '';
    s._action = Enums.Action.NOTHING;
  }

  /** Route pointerdown decisions to the on-device log (?inputdebug=1). */
  setVerdictSink(sink: ((text: string) => void) | null): void {
    this.verdict = sink;
  }

  /** Undo the per-stroke negative override and mask tool swap. */
  private restoreStrokeTool(): void {
    if (this.negativeOverride) {
      this.negativeOverride.tool._negative = this.negativeOverride.prev;
      this.negativeOverride = null;
    }
    if (this.maskPrevTool >= 0) {
      this.session.getSculptManager().setToolIndex(this.maskPrevTool);
      this.maskPrevTool = -1;
    }
    this.syncCursorBrush();
  }

  // --- keyboard (plan 7.4) ------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (isTextEntryTarget(e)) return;
    const s = this.session;
    const key = e.key.toLowerCase();

    // Tab clears the screen for focused work. Claimed here in the capture
    // phase so it shadows the viewer's Tab (which toggles the Render panel)
    // exactly the way the digit and w/s/f/d bindings are shadowed - but
    // only when Tab is not busy being Tab (see tabShouldMoveFocus).
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (tabShouldMoveFocus(e)) return;
      this.hooks.toggleChrome();
      return this.claim(e);
    }

    // Keep Firefox from opening the menu bar on the negative modifier.
    if (e.key === 'Alt') {
      e.preventDefault();
      return;
    }

    // Holding shift means "the next stroke smooths"; preview it on the ring.
    if (e.key === 'Shift' && !this.shiftHeld) {
      this.shiftHeld = true;
      this.syncCursorBrush();
    }

    // Wheel-mappable keys (TourBox review request), bound by PHYSICAL code
    // so controller macros and non-US layouts agree: brackets step brush
    // size, the row below (; and ') steps strength - modifier-free, since
    // shift belongs to the smooth override - and arrows turn the model a
    // degree per tick.
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        if (!e.shiftKey) this.nudgeRadius(e.code === 'BracketRight' ? 1 : -1);
        return this.claim(e);
      }
      if (e.code === 'Semicolon' || e.code === 'Quote') {
        this.nudgeIntensity((e.code === 'Quote' ? 1 : -1) * INTENSITY_STEP);
        return this.claim(e);
      }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        const dir = e.code === 'ArrowLeft' ? -1 : 1;
        const now = performance.now();
        const gap = now - this.lastOrbitTime;
        // Same-direction ticks accelerate by their rate; a direction change
        // or a pause resets to the base degree.
        const mult =
          dir === this.lastOrbitDir && gap > 0
            ? Math.min(ORBIT_ACCEL_MAX, Math.max(1, (ORBIT_ACCEL_REF_MS / gap) ** ORBIT_ACCEL_POW))
            : 1;
        this.lastOrbitTime = now;
        this.lastOrbitDir = dir;
        this.hooks.orbitY(dir * ORBIT_STEP_DEG * mult);
        return this.claim(e);
      }
    }

    // ctrl chords first. The mask trio mirrors ZBrush; ctrl+c and ctrl+h
    // shadow browser Copy and History, so they are only claimed here where
    // the text-entry guard above has already let real typing through.
    if (e.ctrlKey || e.metaKey) {
      if (key === 'z') {
        if (e.shiftKey) s.redo();
        else s.undo();
        this.claim(e);
      } else if (key === 'd') {
        s.subdivide();
        this.claim(e);
      } else if (key === 'c') {
        this.maskTool()?.clear?.();
        s.render();
        this.claim(e);
      } else if (key === 'i') {
        this.maskTool()?.invert?.();
        s.render();
        this.claim(e);
      } else if (key === 'e') {
        this.hooks.extractMasked();
        this.claim(e);
      } else if (key === 'h') {
        // Hides the mask's darkening, not the mask: strokes keep respecting
        // it, you just stop looking at it.
        this.hooks.toggleMaskTint();
        this.claim(e);
      }
      return;
    }

    if (e.altKey) {
      if (key === 'q') this.claim(e); // isolate: reserved for multi-mesh
      return;
    }

    switch (key) {
      case 'd':
        s.stepSubdivision(e.shiftKey ? -1 : 1);
        return this.claim(e);
      case 'b':
        if (!this.adjust) this.beginAdjust('radius');
        return this.claim(e);
      case 's':
        if (e.shiftKey) {
          this.hooks.toggleShadows();
        } else if (!this.adjust) {
          this.beginAdjust('intensity');
        }
        return this.claim(e);
      case 'x':
        s.toggleSymmetry();
        return this.claim(e);
      case 'l':
        this.lKeyHeld = true;
        return this.claim(e);
      case 'f':
        this.hooks.frameModel();
        return this.claim(e);
      // Reserved: q returns from the future gizmo; w/e/r are its modes.
      case 'q':
      case 'w':
      case 'e':
      case 'r':
        return this.claim(e);
      case '1':
        return this.selectTool(Enums.Tools.CREASE, e);
      case '2':
        return this.selectTool(Enums.Tools.MOVE, e);
      case '3':
        return this.selectTool(Enums.Tools.BRUSH, e);
      case '4':
        return this.selectTool(Enums.Tools.INFLATE, e);
      case '5':
        return this.selectTool(Enums.Tools.PINCH, e);
      case '6':
        return this.selectTool(Enums.Tools.FLATTEN, e);
      case '7':
        return this.selectTool(Enums.Tools.SMOOTH, e);
      case '8':
        return this.selectTool(Enums.Tools.DRAG, e);
      case '9':
        return this.selectTool(Enums.Tools.TWIST, e);
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    if (e.key === 'Alt') e.preventDefault();
    if (e.key === 'Shift' && this.shiftHeld) {
      this.shiftHeld = false;
      this.syncCursorBrush();
    }
    if (key === 'b' && this.adjust === 'radius') this.endAdjust();
    if (key === 's' && this.adjust === 'intensity') this.endAdjust();
    if (key === 'l') this.lKeyHeld = false;
  };

  /** One wheel tick of brush size: ~6 percent, at least 2px, clamped. */
  private nudgeRadius(dir: number): void {
    const tool = this.currentTool();
    const step = Math.max(2, tool._radius * 0.06) * dir;
    tool._radius = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, tool._radius + step));
    this.syncCursorBrush();
    this.cursor.flashScreen(NUDGE_FLASH_MS);
  }

  private nudgeIntensity(delta: number): void {
    const tool = this.currentTool();
    tool._intensity = Math.min(1, Math.max(0, tool._intensity + delta));
    this.syncCursorBrush();
    this.cursor.flashScreen(NUDGE_FLASH_MS);
  }

  private beginAdjust(mode: Exclude<AdjustMode, null>): void {
    this.adjust = mode;
    this.cursor.moveTo(this.lastClientX, this.lastClientY);
    this.cursor.beginAnchorScale(this.currentTool()._radius);
    this.cursor.setAnchored(true);
    this.syncCursorBrush();
  }

  private endAdjust(): void {
    this.adjust = null;
    this.cursor.setAnchored(false);
  }

  private selectTool(index: number, e: KeyboardEvent, init?: (tool: SculptTool) => void): void {
    this.selectBrush(index, init);
    this.claim(e);
  }

  /** Select a brush (digit keys and the touch toolbar share this path). */
  selectBrush(index: number, init?: (tool: SculptTool) => void): void {
    const manager = this.session.getSculptManager();
    manager.setToolIndex(index);
    const tool = manager.getCurrentTool();
    if (index === Enums.Tools.BRUSH) tool._clay = true; // standard = clay on
    init?.(tool);
    this.syncCursorBrush();
    this.onToolChange?.();
  }

  currentToolIndex(): number {
    return this.session.getSculptManager().getToolIndex();
  }

  /** Sticky stroke inversion (the toolbar's Negative toggle). */
  /** How many strokes have started (monotonic). */
  strokeCount(): number {
    return this.strokes;
  }

  setNegativeBase(on: boolean): void {
    this.negativeBase = on;
  }

  getNegativeBase(): boolean {
    return this.negativeBase;
  }

  /** True mid-stroke when Move grabbed the mesh from outside its outline. */
  private grabbingFromOutside(): boolean {
    const tool = this.currentTool() as unknown as { grabbedFromOutside?: boolean };
    return tool.grabbedFromOutside === true;
  }

  /** The masking tool carries the whole-mask operations (clear/invert). */
  private maskTool(): SculptTool | undefined {
    return this.session.getSculptManager().getTool(Enums.Tools.MASKING);
  }

  /** Swallow a claimed key so the viewer's shortcut bindings stay dormant. */
  private claim(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }
}
