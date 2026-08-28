import Enums from '@sculpt-vendor/misc/Enums';
import Tablet from '@sculpt-vendor/misc/Tablet';
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
  /** Stroke end: move the orbit pivot to the last edit point. */
  focusEdit(point: [number, number, number]): void;
  /** shift+s: toggle shadows; returns the new state (unused, for parity). */
  toggleShadows(): void;
  /** l + drag: rotate the light rig by a degree delta. */
  rotateLightRig(deltaDeg: number): void;
}

/** Hold-key adjust modes for brush size (b) and strength (s). */
type AdjustMode = 'radius' | 'intensity' | null;

const RADIUS_MIN = 5;
const RADIUS_MAX = 500;

export class InputShell {
  /** Fired when the selected brush changes (digit keys or toolbar). */
  onToolChange: (() => void) | null = null;

  private pointerId = -1;
  /** Sticky negative base (toolbar toggle); alt inverts relative to it. */
  private negativeBase = false;
  /** Tool whose _negative was overridden for the current stroke, if any. */
  private negativeOverride: { tool: SculptTool; prev: boolean } | null = null;
  /** Tool index swapped out for a ctrl-mask stroke, if any. */
  private maskPrevTool = -1;
  private adjust: AdjustMode = null;
  /** ctrl+press that missed the mesh: pending whole-mask gesture (WS2). */
  private maskGesture: { x: number; y: number; pointerId: number } | null = null;
  /** Shift held = smoothing (temp tool); the cursor previews it in blue. */
  private shiftHeld = false;
  private lKeyHeld = false;
  private lastClientX = 0;
  private lastClientY = 0;
  /** Last pointer position in viewport-absolute px (adjust/light drags). */
  private lastAbsX = 0;
  private lastAbsY = 0;

  constructor(
    private readonly session: SculptSession,
    private readonly container: HTMLElement,
    private readonly cursor: BrushCursor,
    private readonly hooks: InputShellHooks,
  ) {}

  install(): void {
    // Pen pressure sways both brush radius and intensity (vendor defaults
    // enable radius only). Factors become palette sliders in WS4.
    Tablet.radiusFactor = 0.75;
    Tablet.intensityFactor = 0.75;
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
  }

  // --- pointer machine ----------------------------------------------------

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return; // middle/right stay with OrbitControls
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
      // Upstream parity: a ctrl press that MISSES the mesh is a whole-mask
      // gesture. Released in place = invert the mask; dragged = clear it.
      if (e.ctrlKey && !e.metaKey) {
        this.maskGesture = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
        s._action = Enums.Action.MASK_EDIT;
        e.preventDefault();
        e.stopPropagation(); // no orbit under a mask gesture
        return;
      }
      s._action = Enums.Action.NOTHING;
      return; // no hit: the event continues on to OrbitControls (orbit)
    }

    s._action = Enums.Action.SCULPT_EDIT;
    this.pointerId = e.pointerId;
    try {
      s.getCanvas().setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events carry no active pointer; capture is best-effort.
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
    this.cursor.show();

    if (s._action !== Enums.Action.SCULPT_EDIT || e.pointerId !== this.pointerId) {
      // Hover: align the ring to the surface under the cursor (fresh pick).
      const surf = s.hoverSurface(true);
      this.cursor.setSurface(surf ? surf.point : null, surf?.normal, surf?.worldRadius);
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    // Upstream onDeviceMove, sculpt branch: refresh picking, then stroke.
    this.feedPressure(e);
    s.getSculptManager().preUpdate();
    s.getSculptManager().update();

    // The stroke just refreshed picking; reuse it for the ring (no re-pick).
    const strokeSurf = s.hoverSurface(false);
    this.cursor.setSurface(
      strokeSurf ? strokeSurf.point : null,
      strokeSurf?.normal,
      strokeSurf?.worldRadius,
    );

    s._lastMouseX = s._mouseX;
    s._lastMouseY = s._mouseY;
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const s = this.session;

    if (this.maskGesture && e.pointerId === this.maskGesture.pointerId) {
      // A cancelled pointer (browser gesture takeover) aborts, not inverts.
      if (e.type !== 'pointercancel') {
        const moved =
          Math.hypot(e.clientX - this.maskGesture.x, e.clientY - this.maskGesture.y) > 6;
        const masking = s.getSculptManager().getTool(Enums.Tools.MASKING);
        if (moved) masking.clear?.();
        else masking.invert?.();
      }
      this.maskGesture = null;
      s._action = Enums.Action.NOTHING;
      e.stopPropagation();
      s.render();
      return;
    }

    if (e.pointerId !== this.pointerId) return;
    this.pointerId = -1;

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

  private readonly onPointerLeave = (): void => {
    this.cursor.hide();
  };

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
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    const s = this.session;
    const key = e.key.toLowerCase();

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

    // ctrl chords first.
    if (e.ctrlKey || e.metaKey) {
      if (key === 'z') {
        if (e.shiftKey) s.redo();
        else s.undo();
        this.claim(e);
      } else if (key === 'd') {
        s.subdivide();
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

  private beginAdjust(mode: Exclude<AdjustMode, null>): void {
    this.adjust = mode;
    this.cursor.moveTo(this.lastClientX, this.lastClientY);
    this.cursor.beginAnchorScale(this.currentTool()._radius);
    this.cursor.setAnchored(true);
    this.cursor.show();
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
  setNegativeBase(on: boolean): void {
    this.negativeBase = on;
  }

  getNegativeBase(): boolean {
    return this.negativeBase;
  }

  /** Swallow a claimed key so the viewer's shortcut bindings stay dormant. */
  private claim(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }
}
