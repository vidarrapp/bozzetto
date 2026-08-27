import Enums from '@sculpt-vendor/misc/Enums';
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
  private pointerId = -1;
  /** Tool whose _negative was overridden for the current stroke, if any. */
  private negativeOverride: { tool: SculptTool; prev: boolean } | null = null;
  /** Tool index swapped out for a ctrl-mask stroke, if any. */
  private maskPrevTool = -1;
  private adjust: AdjustMode = null;
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
    this.container.addEventListener('pointerdown', this.onPointerDown, true);
    this.container.addEventListener('pointermove', this.onPointerMove, true);
    this.container.addEventListener('pointerup', this.onPointerUp, true);
    this.container.addEventListener('pointercancel', this.onPointerUp, true);
    this.container.addEventListener('pointerleave', this.onPointerLeave, true);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    this.syncCursorBrush();
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

  /** Push the active tool's radius/strength into the cursor overlay. */
  private syncCursorBrush(): void {
    const tool = this.currentTool();
    this.cursor.setBrush(tool._radius, tool._intensity);
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

    // alt = negative for tools that support it (mask: alt = unmask).
    const tool = this.currentTool();
    if ('_negative' in tool) {
      const prev = !!tool._negative;
      // Masking's convention is negative=true to paint mask, so alt flips
      // toward unmask; for sculpt tools alt flips toward carving in.
      tool._negative = e.ctrlKey ? !e.altKey : e.altKey ? !prev : prev;
      this.negativeOverride = { tool, prev };
    }

    const canEdit = s.getSculptManager().start(false);
    if (!canEdit) {
      this.restoreStrokeTool();
      s._action = Enums.Action.NOTHING;
      return; // no hit: the event continues on to OrbitControls (orbit)
    }

    s._action = Enums.Action.SCULPT_EDIT;
    this.pointerId = e.pointerId;
    s.getCanvas().setPointerCapture(e.pointerId);
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
        return this.selectTool(Enums.Tools.BRUSH, e, (tool) => {
          tool._clay = true; // standard brush ships with clay mode on
        });
      case '4':
        return this.selectTool(Enums.Tools.INFLATE, e);
      case '5':
        return this.selectTool(Enums.Tools.PINCH, e);
      case '6':
        return this.selectTool(Enums.Tools.FLATTEN, e);
      case '7':
      case '8':
      case '9':
        return this.claim(e); // reserved for future brushes
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const key = e.key.toLowerCase();
    if (e.key === 'Alt') e.preventDefault();
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
    const manager = this.session.getSculptManager();
    manager.setToolIndex(index);
    init?.(manager.getCurrentTool());
    this.syncCursorBrush();
    this.claim(e);
  }

  /** Swallow a claimed key so the viewer's shortcut bindings stay dormant. */
  private claim(e: KeyboardEvent): void {
    e.preventDefault();
    e.stopPropagation();
  }
}
